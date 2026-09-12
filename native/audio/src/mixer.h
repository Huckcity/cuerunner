// The mixer and its scheduler. Everything here runs on the audio thread: commands are
// applied at block starts but every verb carries an absolute frame, so a start, a stop
// or a fade lands on the exact sample it was asked for even if a socket thread, the
// renderer or the whole world stalls. No allocation, no locks, no file I/O.
#pragma once

#include "cache.h"
#include "ring.h"
#include "stream.h"
#include "wsaudio.h"

#include <atomic>
#include <cstdint>

namespace ws {

struct ReclaimItem {
  int streamSlot = -1;
  CacheEntry* cacheEntry = nullptr;
};

struct FadeRamp {
  bool active = false;
  double from = 0.0;
  double to = 0.0;
  int64_t startFrame = 0;
  int64_t endFrame = 0;
  Curve curve = Curve::Linear;
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
  int channels = 0;
  int sampleRate = 0;
  int64_t sourceFrames = -1;

  double position = 0.0;           // source frames from the start of the file
  double segmentStartFrame = 0.0;  // where a loop repeats back to
  double segmentEndFrame = 0.0;    // exclusive end of the segment
  int loopCount = 0;
  int loopsCompleted = 0;
  bool lengthUnknown = false;      // streaming file whose length is not stated

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
  int crosspointCount = 0;
  Crosspoint crosspoints[kMaxCrosspoints] = {};

  EndReason pendingReason = EndReason::Complete;
};

class Mixer {
 public:
  Mixer(DecodedCache& cache, StreamPool& streams, SpscQueue<Event, 1024>& events,
        SpscQueue<ReclaimItem, 512>& reclaim);

  void configure(int deviceChannels, int sampleRate);
  void reset();

  // Applies one command at the current block boundary. Absolute `whenMs` inside the
  // command still lands on its exact frame.
  void apply(const Command& cmd);

  // Renders `frames` interleaved frames into `out` (cleared by the caller).
  void render(float* out, int frames, int channels);

  void advanceClock(int frames) { clockFrames_ += frames; }

  // Publishes the externally visible state under a seqlock (odd = being written).
  void writeSnapshot(MixSnapshot& target, std::atomic<uint32_t>& seq, double clockMs,
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

 private:
  Voice* findVoice(const char* cueId);
  Voice* freeVoice();
  void beginVoice(Voice& voice, int64_t frame);
  Voice* startVoice(const Command& cmd);
  void stopVoice(Voice& voice, int64_t frame, double fadeFrames, EndReason reason);
  void finishVoice(Voice& voice, int64_t frame, EndReason reason);
  void cancelVoice(Voice& voice, int64_t frame, int& canceled);
  void panic(double atFrame, double fadeFrames);
  void reclaim(Voice& voice);
  void reclaimResourcesForCommand(const Command& cmd);
  void retryReclaims();

  double paramValue(const Voice& voice, int param, int64_t frame) const;
  static double rampValue(const FadeRamp& ramp, int64_t frame);
  static double curveShape(double t, Curve curve);
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
};

}  // namespace ws
