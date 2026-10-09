// Streaming decode. A long file is decoded by a background thread into a bounded
// pre-roll ring; the audio thread only ever reads published frames and never opens a
// file, seeks a decoder or blocks.
//
// The ring is linear: it holds the file from where the voice is, onward. Every jump in the
// voice's path — a loop back to its start, a skip over slices that play no times, a seek —
// lands in a *pad* instead: a held copy of the frames at the jump's target, decoded before the
// voice gets there (AD-29). A loop that fits in a pad plays from it for every pass after the
// first, and the ring stays parked where the loop ends, so the way out of a vamp is the next
// frame of the ring. A jump to anywhere else plays the pad while the ring moves to where the
// pad ends. The voice never waits on a reposition: what it cannot read is an underrun, and is
// counted as one.
#pragma once

#include "plan.h"
#include "ring.h"
#include "source.h"
#include "wsaudio.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace ws {

enum class PadState : int { Free = 0, Filling = 1, Ready = 2, Retired = 3 };
enum class PadKind : int { Loop = 0, Landing = 1 };

/**
 * One pad: a run of the file's frames held in memory, from `target` for `filled` frames.
 *
 * Ownership moves with `state`, so no lock is shared with the audio thread. A pad is claimed
 * (Free or Retired → Filling) only by a thread holding the slot's `padMutex` — the decode
 * thread for the read-ahead, a command thread for a seek — which fills it and publishes it
 * Ready. Only the audio thread reads a Ready pad, and only the audio thread retires one
 * (Ready → Retired), once nothing it plays needs it: so a pad is never refilled under a voice
 * that is still reading it.
 */
struct StreamPad {
  std::vector<float> pcm;  // capacityFrames × the slot's channels, allocated with the slot
  int64_t capacityFrames = 0;
  std::atomic<int> state{static_cast<int>(PadState::Free)};
  std::atomic<int64_t> target{0};
  std::atomic<int64_t> filled{0};
  /** The plan region it serves, and whether it is that region's loop or a landing in it. */
  std::atomic<int> tag{-1};
  std::atomic<int> kind{static_cast<int>(PadKind::Landing)};
  /** Set by the read-ahead on a Ready pad its plan no longer needs; the audio thread retires it
   *  once it is not reading it. */
  std::atomic<bool> unwanted{false};
  /** A seek's pad, between being prepared and the seek being applied: not the read-ahead's to
   *  give away, whatever the plan says. */
  std::atomic<bool> pinned{false};
  // The filler's own state, under the slot's padMutex.
  int64_t wanted = 0;
  bool capture = false;  // filled from the ring's own decode rather than the pad reader's

  /** Whether the pad holds `frame` for the audio thread to read. */
  bool holds(int64_t frame) const {
    if (state.load(std::memory_order_acquire) != static_cast<int>(PadState::Ready)) return false;
    const int64_t first = target.load(std::memory_order_relaxed);
    return frame >= first && frame < first + filled.load(std::memory_order_relaxed);
  }
  int64_t end() const { return target.load(std::memory_order_relaxed) + filled.load(std::memory_order_relaxed); }
};

struct StreamSlot {
  /**
   * Reserved by an acquire that is still opening the file: the slot is this caller's, and
   * nothing else may take it. Deliberately not what the filler looks at — a slot whose
   * ring is still being built is not one to decode into.
   */
  std::atomic<bool> claimed{false};
  /**
   * Published: the ring is configured over its own storage and may be filled. Set as
   * `acquire`'s last act and cleared as `release`'s first, both under the pool's mutex,
   * so the filler never sees a slot half-built or half-freed.
   */
  std::atomic<bool> inUse{false};
  StreamRing ring;
  std::unique_ptr<Source> source;
  std::string path;
  std::vector<float> pcm;  // the ring's storage, bounded pre-roll frames
  int64_t capacityFrames = 0;
  int64_t prerollFrames = 0;
  int channels = 0;
  int sampleRate = 0;
  int64_t sourceFrames = -1;
  std::atomic<bool> eof{false};
  std::atomic<uint64_t> underruns{0};

  // The pads, the plan they follow, and the second decoder that fills them, so the ring's own
  // never has to move for one. `padMutex` serialises the pads' fillers (the decode thread, a
  // command thread preparing a seek) and the reader; the audio thread never takes it.
  StreamPad pads[kPadsPerStream];
  int64_t padFrames = 0;
  int64_t landingFrames = 0;
  int64_t tailFrames = 0;
  std::unique_ptr<Source> reader;
  int64_t readerFrame = -1;
  std::mutex padMutex;
  VoiceSlice plan[kMaxSlices];
  int planCount = 0;
  bool planSliced = false;
  /** The plan region the voice is in, published by the audio thread for the read-ahead, and the
   *  region it may play now (a release widens a cue's own loop to the end of the file), which a
   *  seek's landing is clamped into exactly as the mixer clamps the seek. */
  std::atomic<int> voiceRegion{0};
  std::atomic<int64_t> voiceSegmentStart{0};
  std::atomic<int64_t> voiceSegmentEnd{0};
  /** The cue the slot was acquired for, and the order it was acquired in: a seek finds the
   *  newest slot its cue holds. Written under the pool's mutex. */
  std::string cueId;
  uint64_t sequence = 0;
  /** A release the service thread could not finish without waiting on a seek; under the pool's mutex. */
  bool releaseDeferred = false;

  /**
   * Everything this slot holds, in bytes — its ring and its pads: the achieved figure the
   * per-voice bound bought, and the same figure the pool adds to its resident total.
   */
  int64_t ringBytes() const {
    const int64_t frames = capacityFrames + padFrames * kPadsPerStream;
    return frames * static_cast<int64_t>(channels) * static_cast<int64_t>(sizeof(float));
  }
};

/** Why an acquire did not open a ring: a decode failure, or a bound that refuses. */
enum class StreamRefusal { None, Decode, Limit };

/**
 * The streaming decode pool.
 *
 * A slot's *structure* — which source it holds, the storage its ring is configured over —
 * is mutated by `acquire` and `release` (both documented as command-thread calls) and read
 * by `fillAll` (the decode thread). Those are different threads, so `mutex_` is what makes
 * the three atomic with respect to each other: a fill never overlaps a slot being built or
 * freed, which is the whole reason a slot is published (`inUse`) only once its ring is
 * real. The audio thread is not a party to it — it reads the ring's own atomic protocol and
 * the slot's atomics, and frees nothing — so no fill or teardown can block a callback.
 */
class StreamPool {
 public:
  StreamPool();
  ~StreamPool();

  /**
   * Opens a decoder and allocates a bounded ring, and the pads the voice's plan needs.
   * Returns the slot index, or -1 with `refusal` and `error` filled. `maxBytesPerVoice`
   * caps the ring and its pads together and `maxTotalBytes` is the declared streaming
   * budget: a ring that would take the pool's resident total past it is refused
   * (`StreamRefusal::Limit`, naming the budget) rather than allocated, so the total never
   * exceeds it; pads are made smaller, or left out, before a ring is refused. The ring is
   * filled from where the voice starts before the slot is published, so the first frame
   * is there when the voice asks for it. Called from a command thread.
   */
  int acquire(const std::string& path, int64_t prerollMs, int64_t maxBytesPerVoice, int64_t maxTotalBytes,
              StreamRefusal& refusal, std::string& error, SourceInfo& info, const StartOptions* options = nullptr,
              const std::string& cueId = std::string());
  StreamSlot* at(int index);
  const StreamSlot* at(int index) const;
  // Frees a slot after the voice using it has ended. Called from a command thread, or from the
  // service thread with `wait` false: a slot a seek is still preparing a pad in is then freed
  // by a later decode pass rather than waited for.
  void release(int index, bool wait = true);
  int64_t releaseByPath(const std::string& path);
  // One decode pass over every in-use slot: its ring, then its pads. Called from the decode thread.
  void fillAll();
  // Flushes everything (device teardown / shutdown).
  void closeAll();

  /**
   * Readies a seek's landing for `cueId`'s newest stream: the frames from `positionMs`, held
   * in a pad before the seek is sent, so the voice lands on them rather than waiting for its
   * ring to move. Returns the pad (pinned until the seek is applied), -2 when the ring already
   * holds the position and no pad is needed, or -1 when there is no stream, no free pad or no
   * decode. Called from a command thread; it decodes, so it takes as long as a read does.
   */
  int prepareSeek(const std::string& cueId, double positionMs, int& slotIndex);

  int activeStreams() const;
  int64_t residentBytes() const { return residentBytes_.load(std::memory_order_relaxed); }
  int64_t underruns() const;

  /** Test only: a pause before every read a decoder makes, to stand in for a slow disk. */
  void setTestReadDelayUs(int64_t micros) { testReadDelayUs_ = micros; }

 private:
  bool fillOne(StreamSlot& slot);
  /** The read-ahead: the pads the plan wants next, claimed, filled a chunk at a time, and the
   *  ones it no longer wants marked for the audio thread to give back. */
  void tendPads(StreamSlot& slot);
  bool fillPadChunk(StreamSlot& slot, StreamPad& pad, bool mayRead);
  bool ensureReader(StreamSlot& slot);
  int claimPad(StreamSlot& slot, int keepFree);
  int64_t readSource(Source& source, float* out, int64_t frames);
  /** `release`'s body, for the callers that already hold `mutex_`. */
  void releaseLocked(int index, bool wait = true);
  static constexpr int64_t kMaxChunkFrames = 8192;

  /**
   * Guards the slots' structure against everything but the audio thread: `acquire`,
   * `release`, `releaseByPath`, `fillAll` and `closeAll`. Held across a fill, which is a
   * bounded chunk of decode, and across the publish/teardown of a slot — never across
   * `openSource`, which the `claimed` flag reserves the slot for instead.
   */
  mutable std::mutex mutex_;
  StreamSlot slots_[kMaxStreams];
  std::atomic<int64_t> residentBytes_{0};
  std::atomic<uint64_t> sequence_{0};
  std::vector<float> scratch_;
  int64_t testReadDelayUs_ = 0;
};

}  // namespace ws
