// Streaming decode. A long file is decoded by a background thread into a bounded
// pre-roll ring; the audio thread only ever reads published frames and never opens a
// file, seeks a decoder or blocks. Seeking is a handshake: the audio thread posts a
// target, the decode thread flushes and repositions.
#pragma once

#include "ring.h"
#include "source.h"
#include "wsaudio.h"

#include <atomic>
#include <memory>
#include <vector>
#include <string>

namespace ws {

struct StreamSlot {
  std::atomic<bool> inUse{false};
  StreamRing ring;
  std::unique_ptr<Source> source;
  std::string path;
  std::vector<float> pcm;  // the ring's storage, bounded pre-roll frames
  int64_t capacityFrames = 0;
  int64_t prerollFrames = 0;
  int channels = 0;
  int sampleRate = 0;
  std::atomic<bool> eof{false};
  std::atomic<uint64_t> underruns{0};

  /**
   * The ring this slot holds, in bytes: the achieved figure the per-voice bound bought,
   * and the same figure the pool adds to its resident total.
   */
  int64_t ringBytes() const {
    return capacityFrames * static_cast<int64_t>(channels) * static_cast<int64_t>(sizeof(float));
  }
};

/** Why an acquire did not open a ring: a decode failure, or a bound that refuses. */
enum class StreamRefusal { None, Decode, Limit };

class StreamPool {
 public:
  StreamPool();
  ~StreamPool();

  /**
   * Opens a decoder and allocates a bounded ring. Returns the slot index, or -1 with
   * `refusal` and `error` filled. `maxBytesPerVoice` caps the ring and `maxTotalBytes`
   * is the declared streaming budget: a ring that would take the pool's resident total
   * past it is refused (`StreamRefusal::Limit`, naming the budget) rather than
   * allocated, so the total never exceeds it. Called from a command thread.
   */
  int acquire(const std::string& path, int64_t prerollMs, int64_t maxBytesPerVoice, int64_t maxTotalBytes,
              StreamRefusal& refusal, std::string& error, SourceInfo& info);
  StreamSlot* at(int index);
  const StreamSlot* at(int index) const;
  // Frees a slot after the voice using it has ended. Called from a command thread.
  void release(int index);
  int64_t releaseByPath(const std::string& path);
  // One decode pass over every in-use slot. Called from the decode thread.
  void fillAll();
  // Flushes everything (device teardown / shutdown).
  void closeAll();

  int activeStreams() const;
  int64_t residentBytes() const { return residentBytes_.load(std::memory_order_relaxed); }
  int64_t underruns() const;

 private:
  bool fillOne(StreamSlot& slot);
  static constexpr int64_t kMaxChunkFrames = 8192;

  StreamSlot slots_[kMaxStreams];
  std::atomic<int64_t> residentBytes_{0};
  std::vector<float> scratch_;
};

}  // namespace ws
