// The mixer and its scheduler. Everything here runs on the audio thread: commands are
// applied at block starts but every verb carries an absolute frame, so a start, a stop
// or a fade lands on the exact sample it was asked for even if a socket thread, the
// renderer or the whole world stalls. No allocation, no locks, no file I/O.
#pragma once

#include "cache.h"
#include "live_input.h"
#include "ring.h"
#include "snapshot_cell.h"
#include "stream.h"
#include "wsaudio.h"

#include <atomic>
#include <cstdint>
#include <mutex>
#include <vector>

namespace ws {

struct ReclaimItem {
  int streamSlot = -1;
  CacheEntry* cacheEntry = nullptr;
};

struct FadeRamp {
  bool active = false;
  // Beside `active`, in what was its padding, so a ramp is no bigger for carrying a shape.
  Curve curve = Curve::Linear;
  double from = 0.0;
  double to = 0.0;
  int64_t startFrame = 0;
  int64_t endFrame = 0;
  /** The drawn shape when `curve` is `Table`: kept beside the voices rather than in them
   *  (`Mixer::rampTables_`), so the voices the render loop walks every frame stay small. */
  const CurveTable* table = nullptr;
};

/** One slice of a voice's file, in source frames: a region and how often it plays. */
struct VoiceSlice {
  double startFrame = 0.0;
  double endFrame = 0.0;
  int playCount = 1;  // -1: until released
};

/**
 * An output patch as the mixer holds it: a bus with its own channels, mapped onto device
 * outputs, with its own fader and meter. Voices routed through a patch are mixed into the
 * bus first; the bus is faded, metered and then summed onto the outputs its map names — of
 * the main device, or of the extra output device `aux` names while that device is open.
 */
struct Bus {
  bool defined = false;
  int channels = 0;
  int map[kMaxOutputChannels] = {};  // patch channel -> device output, -1 for none
  double gainTarget = 1.0;
  double gainCurrent = 1.0;
  float peak[kMaxOutputChannels] = {};
  /** The extra output device this patch plays on (aux_output.h), or -1 for the main one. A
   *  device that is not open leaves the patch on the main device's outputs of the same
   *  numbers, so a cue patched to an interface that is not there is still heard. */
  int aux = -1;
};

// One destination gain for the explicit matrix. The output channel is not stored: the
// taps are grouped by output and `voice.tapStart` slices them, so the render loop walks
// only the taps that feed the output being written. Eight bytes against Crosspoint's
// twelve keeps the indexed list smaller than the raw one it replaces.
struct Tap {
  int inputChannel = 0;
  float gain = 1.0f;
};

struct Voice {
  bool active = false;
  char cueId[kMaxCueIdLen] = {};
  char runId[32] = {};
  VoiceState state = VoiceState::Idle;

  const float* cachedData = nullptr;
  int64_t cachedFrames = 0;
  CacheEntry* cacheEntry = nullptr;
  int streamSlot = -1;
  /** The ring this voice's stream slot holds, in bytes; 0 when cache-backed. */
  int64_t streamBytes = 0;
  int channels = 0;
  int sampleRate = 0;
  int64_t sourceFrames = -1;

  double position = 0.0;           // source frames from the start of the file
  double segmentStartFrame = 0.0;  // where a loop repeats back to
  double segmentEndFrame = 0.0;    // exclusive end of the segment
  int loopCount = 0;
  int loopsCompleted = 0;
  bool lengthUnknown = false;      // streaming file whose length is not stated
  // The stream ring is parked somewhere else while it repositions (a start at an
  // offset, a seek, a loop wrap): samples it cannot serve yet are not starvation, so
  // they must not be counted as underruns.
  bool awaitingSeek = false;

  int64_t startFrame = 0;  // device frame the voice becomes audible
  int64_t stopFrame = -1;  // device frame the voice goes silent (-1 = not stopping)
  bool started = false;

  double volume = 1.0;
  double pan = 0.0;
  double trim = 1.0;
  double rate = 1.0;
  FadeRamp ramps[kMaxRampParams];
  FadeRamp fadeIn;
  FadeRamp stopFade;

  bool automaticRouting = true;
  Tap taps[kMaxCrosspoints] = {};
  // tapStart[output] .. tapStart[output + 1] is the slice of `taps` for that output,
  // built once when the routing is applied. Empty when the two are equal.
  int tapStart[kMaxOutputChannels + 1] = {};

  EndReason pendingReason = EndReason::Complete;

  // A pause holds the voice where it stands: it renders nothing, its position does not
  // move, and no frame-stamped thing about it (a ramp, a scheduled stop, a start still to
  // come) spends time. `pauseAt` is the frame the hold takes, after `holdRamp` has taken
  // the voice down so the stop does not click; `pausedSince` is the frame it took, which a
  // resume shifts every stamped field by. Both -1 while the voice is not held.
  int64_t pauseAt = -1;
  int64_t pausedSince = -1;
  // The frame a resume lets the voice go at; -1 while none is pending. A resume is applied
  // at a block boundary but names its own frame, and the voice stays held until that frame
  // rather than drifting through the frames before it in silence.
  int64_t resumeAt = -1;
  FadeRamp holdRamp;

  // Kept last, after everything the render loop reads for every voice on every frame.

  /** The output patch this voice is mixed into, or -1 for the device's own channels. */
  int patch = -1;
  /** A live voice's input feed, or -1 for a file; the feed channel behind each of its own
   *  channels is `Mixer::inputMaps_`. */
  int inputFeed = -1;

  // A sliced voice plays its slices in order: `sliceIndex` is the one sounding, and
  // `slicePlays` how many passes of it are done. A release lets the slice finish the pass it
  // is in and moves on — or ends the voice there, when the release asked for that.
  int sliceCount = 0;
  int sliceIndex = 0;
  int slicePlays = 0;
  bool sliceRelease = false;
  bool stopAtPassEnd = false;
};

class Mixer {
 public:
  Mixer(DecodedCache& cache, StreamPool& streams, SpscQueue<Event, 1024>& events,
        SpscQueue<ReclaimItem, 512>& reclaim);

  /** The live inputs live voices read; pulled once per block whether a voice reads them or not. */
  void attachInputs(InputFeeds* inputs) { inputs_ = inputs; }

  /**
   * Allocates the patches' mixing space, once, on the calling (control) thread — before the
   * first patch is defined, so a show with no patches never pays for it and the audio thread
   * never allocates. The render thread only touches it for a defined patch, and a patch is
   * only defined by a command queued after this returns.
   */
  void prepareBuses() {
    std::call_once(busesPrepared_, [this] { busScratch_.assign(kBusStride * static_cast<size_t>(kMaxPatches), 0.0f); });
  }

  /**
   * Allocates the extra output devices' mixing space, once, on the control thread — before
   * the first one is opened, so a show on one device never pays for it and the audio thread
   * never allocates. The render thread only touches a slot an `AuxOutput` command opened.
   */
  void prepareAux() {
    std::call_once(auxPrepared_, [this] { auxScratch_.assign(kBusStride * static_cast<size_t>(kMaxAuxOutputs), 0.0f); });
  }
  /** Whether any extra output device is open: the one test a show on one device pays. */
  bool anyAux() const { return anyAux_; }
  /** An extra output device's channel count while it is open, else 0. */
  int auxChannels(int slot) const { return slot >= 0 && slot < kMaxAuxOutputs ? auxChannels_[slot] : 0; }
  /** The block last rendered for an extra output device, interleaved at its channel count. */
  const float* auxBlock(int slot) const { return auxScratch_.data() + static_cast<size_t>(slot) * kBusStride; }

  void configure(int deviceChannels, int sampleRate);
  void reset();

  // Applies one command at the current block boundary. Absolute `whenMs` inside the
  // command still lands on its exact frame.
  void apply(const Command& cmd);

  // Renders `frames` interleaved frames into `out` (cleared by the caller).
  void render(float* out, int frames, int channels);

  /**
   * Ends every voice that never began to sound, as `cancelled` — the same end a voice
   * that never started gets from a panic. The engine calls this only where nothing will
   * render the queue again: a start applied behind a device's loss would otherwise sit
   * published as playing for ever, with no block to become audible on and nothing to end
   * it.
   */
  void cancelUnstartedVoices();

  void advanceClock(int frames) { clockFrames_ += frames; }

  // Builds the externally visible state in `staging` — which only the writing thread
  // touches — and publishes it through `cell`, where readers copy it out whole.
  void writeSnapshot(MixSnapshot& staging, SnapshotCell<MixSnapshot>& cell, double clockMs,
                     uint64_t renderedFrames) const;

  int64_t clockFrames() const { return clockFrames_; }
  int sampleRate() const { return sampleRate_; }
  int channels() const { return deviceChannels_; }
  int activeVoiceCount() const;
  bool hasActiveVoices() const { return activeVoiceCount() > 0; }
  int streamingVoiceCount() const;

  uint64_t underruns() const { return underruns_.load(std::memory_order_relaxed); }
  uint64_t voicesEndedCount() const { return voicesEnded_.load(std::memory_order_relaxed); }
  uint64_t droppedEvents() const { return droppedEvents_; }
  double masterGain() const { return masterTarget_; }

 private:
  Voice* findVoice(const char* cueId);
  Voice* freeVoice();
  void beginVoice(Voice& voice, int64_t frame);
  Voice* startVoice(const Command& cmd);
  void indexRouting(Voice& voice, const Crosspoint* points, int count);
  void stopVoice(Voice& voice, int64_t frame, double fadeFrames, EndReason reason);
  void finishVoice(Voice& voice, int64_t frame, EndReason reason);
  void cancelVoice(Voice& voice, int64_t frame, int& canceled);
  bool pauseVoice(Voice& voice, int64_t frame);
  bool resumeVoice(Voice& voice, int64_t frame);
  void letGo(Voice& voice, int64_t frame);
  void applyMaster(float* out, int frames, int channels);
  /**
   * Silences everything at `atFrame`: a voice that never started ends `cancelled`, and
   * one that was sounding ends with `soundingReason` — the reason the panic happened,
   * which only the caller knows.
   */
  void panic(double atFrame, double fadeFrames, EndReason soundingReason);
  void reclaim(Voice& voice);
  void reclaimResourcesForCommand(const Command& cmd);
  void retryReclaims();
  /** Points a streaming voice's ring at a frame, marking the reposition as expected. */
  void requestStreamSeek(Voice& voice, int64_t frame);

  double paramValue(const Voice& voice, int param, int64_t frame) const;
  static double rampValue(const FadeRamp& ramp, int64_t frame);
  static double curveShape(double t, Curve curve);
  static double shapeAt(const FadeRamp& ramp, double t);
  /** Moves a sliced voice on past the end of its slice: another pass, the next slice, or the end. */
  void advanceSlices(Voice& voice, int64_t frame);
  void mixBuses(float* out, int frames, int channels);
  /** The master level onto every open extra output device, ramped as the main one is, and metered. */
  void masterAux(int frames, double from, double to);
  /** A lost extra output device: the voices on its patches end, and the device stops being mixed. */
  void loseAux(int slot);
  float* auxData(int slot) { return auxScratch_.data() + static_cast<size_t>(slot) * kBusStride; }
  template <bool Special>
  void mixVoiceFrame(Voice& voice, int64_t frame, int64_t blockStart, float* outFrame, int channels);
  float* busData(int slot) { return busScratch_.data() + static_cast<size_t>(slot) * kBusStride; }
  int voiceIndex(const Voice& voice) const { return static_cast<int>(&voice - voices_); }
  VoiceSlice* slicesOf(const Voice& voice) { return voiceSlices_[voiceIndex(voice)]; }
  bool sampleOf(const Voice& voice, int64_t frame, int channel, float& out) const;

  void emit(const Event& event);
  void emitState(const Voice* voice, bool playing);
  void snapshotVoice(const Voice& voice, VoiceSnapshot& out) const;

  DecodedCache& cache_;
  StreamPool& streams_;
  SpscQueue<Event, 1024>& events_;
  SpscQueue<ReclaimItem, 512>& reclaim_;

  Voice voices_[kMaxVoices];
  int deviceChannels_ = 2;
  int sampleRate_ = 48000;
  int64_t clockFrames_ = 0;
  uint64_t nextRunId_ = 1;
  std::atomic<uint64_t> underruns_{0};
  std::atomic<uint64_t> voicesEnded_{0};
  uint64_t droppedEvents_ = 0;
  int pendingStreams_[kMaxVoices] = {};
  int pendingStreamCount_ = 0;
  // The master level: where it is asked to be, and where the last block left it. A change is
  // ramped across the next block, so a fader moved while the show plays does not click.
  double masterTarget_ = 1.0;
  double masterCurrent_ = 1.0;
  // Each output channel's peak over the block last rendered, for the snapshot's meter.
  int meterChannels_ = 0;
  float blockPeak_[kMaxOutputChannels] = {};

  // The output patches' buses, their mixing space (one block of every channel a bus can
  // have, per bus, allocated once), and each device output's own fader.
  static constexpr size_t kBusStride = static_cast<size_t>(kMaxOutputFrames) * static_cast<size_t>(kMaxOutputChannels);
  Bus buses_[kMaxPatches];
  std::vector<float> busScratch_;
  std::once_flag busesPrepared_;
  double outputGainTarget_[kMaxOutputChannels] = {};
  double outputGainCurrent_[kMaxOutputChannels] = {};
  bool outputsAtUnity_ = true;
  // The extra output devices: each open one's channel count, its block (one block of every
  // channel it can have, allocated once like the buses'), and its meter.
  int auxChannels_[kMaxAuxOutputs] = {};
  bool anyAux_ = false;
  std::vector<float> auxScratch_;
  std::once_flag auxPrepared_;
  float auxPeak_[kMaxAuxOutputs][kMaxOutputChannels] = {};
  InputFeeds* inputs_ = nullptr;
  // What a voice holds that the render loop reads only at an edge — a slice boundary, a drawn
  // fade — kept out of `Voice` and indexed by its slot, so the per-frame walk over the voices
  // touches as little memory as it did before slices and shapes existed.
  VoiceSlice voiceSlices_[kMaxVoices][kMaxSlices] = {};
  int inputMaps_[kMaxVoices][kMaxOutputChannels] = {};
  CurveTable rampTables_[kMaxVoices][kMaxRampParams + 1] = {};
};

}  // namespace ws
