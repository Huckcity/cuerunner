// The drift lock: a buffer between two clocks, read through a resampler that a controller
// keeps in step with the side that writes it.
//
// Two audio devices never share a clock. Even two that claim the same rate drift apart by
// tens of parts per million, and a device at 44.1 kHz feeding one at 48 kHz differs by
// design, so samples cannot be handed from one to the other one for one: the buffer between
// them would empty or overflow within minutes. Whatever crosses from one device's clock to
// another's crosses here. The writer delivers into a lock-free ring at its own pace, in
// whatever pieces it runs in; the reader takes from it at its own pace, through a cubic
// interpolator whose step is the nominal ratio of the two rates nudged by a controller that
// holds the ring's fill at a target. The controller is proportional-integral on the fill
// error, measured through a one-second average because the fill is a sawtooth — the writer
// delivers in periods and the reader takes in blocks — so the nudge is a few parts per million
// rather than a wobble. A fill that runs out (an underrun) or runs away (the writer stalled and
// then delivered a backlog) is resynchronised to the target rather than played late, and
// counted.
//
// Two places use it. A live input (live_input.h) writes from a capture device's callback and
// is read by the render thread at the output's rate. An extra output device (aux_output.h) is
// the same lock the other way round: the render thread writes each block it mixed for that
// device, and the device's own callback reads it at the device's pace — which is what holds a
// second interface sample-locked to the show's timeline instead of drifting away from it.
#pragma once

#include "wsaudio.h"

#include <atomic>
#include <cstdint>
#include <vector>

namespace ws {

/**
 * How a lock starts. A live input is played the moment it opens and keeps the gentle loop
 * throughout. An extra output device is opened when a show loads, long before its first cue,
 * and a fast start is worth more to it than anything: its loop starts with its bandwidth
 * raised by `startBoost` and lets the boost fall away over `boostSeconds`, so the clock error
 * is taken up in seconds and the settled lock is the gentle one, which no callback's lateness
 * moves.
 */
struct DriftTuning {
  double startBoost = 0.0;
  double boostSeconds = 1.0;
};

class DriftRing {
 public:
  static constexpr int64_t kRingFrames = 1 << 16;

  DriftRing();
  DriftRing(const DriftRing&) = delete;
  DriftRing& operator=(const DriftRing&) = delete;

  /**
   * Control thread, while neither end is running: the frame shape, the rate the writer
   * delivers at, the buffer the controller holds (`latencyMs`, 0 sizes it from the writer's
   * deliveries) and the delivery the writer is expected to make before it has made one.
   * Buffers are grown here and never on either end.
   */
  void configure(int channels, int inRate, double latencyMs, int expectedChunk, DriftTuning tuning = {});
  /** The writer's rate has changed (a device reopened at another rate): the reader relocks. */
  void setInRate(int rate);
  /** Asks the reader to start over: prime again, controller at rest. */
  void requestReset() { resetRequested_.store(true, std::memory_order_release); }

  // ── Writer ───────────────────────────────────────────────────────────────────────────
  /**
   * Writes `count` interleaved frames, delivered at `at` (seconds, on the clock the reader
   * reads time on). Never blocks: a ring with no room drops what arrives, and counts it.
   */
  void push(const float* frames, int count, double at);

  // ── Reader ───────────────────────────────────────────────────────────────────────────
  /**
   * Produces `frames` frames at `outRate` into `out`, interleaved at `channels()`, resampled
   * from the ring; `now` is the time on the writer's clock. Silence while the ring is filling
   * to its target or has run dry. False when what was written is silence.
   */
  bool pull(float* out, int frames, int outRate, double now);

  int channels() const { return channels_; }
  int inRate() const { return inRate_.load(std::memory_order_acquire); }
  uint64_t written() const { return writeHead_.load(std::memory_order_relaxed); }
  int maxChunk() const { return maxChunk_.load(std::memory_order_relaxed); }
  double lastPushAt() const { return lastPushAt_.load(std::memory_order_relaxed); }
  uint64_t underruns() const { return underruns_.load(std::memory_order_relaxed); }
  uint64_t overruns() const { return overruns_.load(std::memory_order_relaxed); }
  uint64_t resyncs() const { return resyncs_.load(std::memory_order_relaxed); }
  /** What is buffered between the two ends, a one-second average, ms of the writer's rate. */
  double latencyMs() const { return latencyPublished_.load(std::memory_order_relaxed); }
  /** The fill the controller is holding, ms. */
  double targetMs() const { return targetPublished_.load(std::memory_order_relaxed); }
  /** How far the controller has moved the resampler off the nominal ratio, ppm. */
  double ratioPpm() const { return ratioPublished_.load(std::memory_order_relaxed); }
  /** The part of that move the loop has learned and holds — the two clocks' difference, as
   *  the lock measures it — without the moment-to-moment correction on top, ppm. */
  double heldPpm() const { return heldPublished_.load(std::memory_order_relaxed); }
  /** Each channel's peak since the last call, linear; the peaks start again from zero. */
  float takePeak(int channel) {
    return channel >= 0 && channel < kMaxOutputChannels ? peaks_[channel].exchange(0.0f, std::memory_order_relaxed)
                                                        : 0.0f;
  }

 private:
  float sampleAt(int64_t frame, int channel) const {
    return ring_[static_cast<size_t>(frame & (kRingFrames - 1)) * static_cast<size_t>(channels_) +
                 static_cast<size_t>(channel)];
  }

  int channels_ = 0;
  double latencyMs_ = 0.0;
  DriftTuning tuning_;
  std::atomic<int> inRate_{48000};
  std::vector<float> ring_;
  std::atomic<uint64_t> writeHead_{0};
  std::atomic<uint64_t> releasedHead_{0};
  std::atomic<int> maxChunk_{0};
  std::atomic<bool> resetRequested_{false};
  std::atomic<double> lastPushAt_{0.0};

  // Reader-only state.
  int lockedRate_ = 0;
  bool primed_ = false;
  double readPos_ = 0.0;
  double fillAverage_ = 0.0;
  double integral_ = 0.0;  // the integral term, in the nudge's own units
  double adjust_ = 0.0;
  double lockedFor_ = 0.0;  // seconds since the loop last started from rest
  double target_ = 0.0;
  double learned_ = 0.0;        // headroom learned from late deliveries, ms
  double sinceLearned_ = 0.0;   // seconds since it last grew

  std::atomic<uint64_t> underruns_{0};
  std::atomic<uint64_t> overruns_{0};
  std::atomic<uint64_t> resyncs_{0};
  std::atomic<double> latencyPublished_{0.0};
  std::atomic<double> targetPublished_{0.0};
  std::atomic<double> ratioPublished_{0.0};
  std::atomic<double> heldPublished_{0.0};
  std::atomic<float> peaks_[kMaxOutputChannels];
};

}  // namespace ws
