// Live inputs: a capture device's channels played through the mixer as a voice.
//
// A capture device runs on its own clock. Even two devices that claim the same rate drift
// apart by tens of parts per million, and a device at 44.1 kHz feeding an output at 48 kHz
// differs by design, so the samples it captures cannot be handed to the output one for one:
// the buffer between them would empty or overflow within minutes. Each feed therefore sits
// behind an adaptive resampler. The device's callback writes into a lock-free ring at the
// device's own pace; the render thread reads it once per block at the output's pace, through
// a cubic interpolator whose step is the nominal ratio of the two rates nudged by a
// controller that holds the ring's fill at a target. The controller is proportional-integral
// on the fill error, measured through a one-second average because the fill is a sawtooth —
// the device delivers in periods and the output takes in blocks — so the nudge is a few
// parts per million rather than a wobble. A fill that runs out (an underrun) or runs away
// (the device stalled and then delivered a backlog) is resynchronised to the target rather
// than played late, and counted.
//
// Feeds are kept open once opened, so a cue that goes live is instant: the stream is already
// running and already locked. A voice that reads a feed is an ordinary mixer voice — its
// level, pan, routing, fades, pause and panic are the mixer's — which is what lets a live
// input be faded and stopped the way a file is.
//
// Two synthetic sources stand in for a device where there is none (the test suite, a
// machine with no input): `test:tone`, a 1 kHz sine at −12 dBFS on every channel, and
// `test:ramp`, a sawtooth that counts the input's own frames so a test can read back, from
// the output alone, which input frame each output frame played — the latency, measured. On
// the offline backend a synthetic source runs on simulated time with a configurable clock
// error, so minutes of drift render in seconds and the same render is the same every run.
#pragma once

#include "wsaudio.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace ws {

/** What opening a feed asks for. The rate, skew and period only apply to a synthetic source. */
struct InputOpenOptions {
  std::string device;
  /** The rate a synthetic source runs at; 0 is the engine's output rate. A device keeps its own. */
  int sampleRate = 0;
  /** Channels a synthetic source has; a device keeps its own. */
  int channels = 2;
  /** How far a synthetic source's clock is off its stated rate, parts per million. */
  double skewPpm = 0.0;
  /** How many frames a synthetic source delivers at once: a device's period. */
  int periodFrames = 0;
  /** The buffer the controller holds, ms; 0 picks one from the periods it sees. */
  double latencyMs = 0.0;
  /** How late a synthetic source's deliveries may each be, ms: a callback the machine was slow to run. */
  double jitterMs = 0.0;
};

/** One feed's state, as `inputStatus` reports it. */
struct InputFeedStatus {
  int slot = -1;
  std::string device;
  std::string name;
  int channels = 0;
  int sampleRate = 0;
  bool running = false;
  bool synthetic = false;
  /** How old what the feed plays is when it is played (one-second average), ms: the buffer
   *  between the device and the output plus half a delivery period. */
  double latencyMs = 0.0;
  /** The fill the controller is holding the buffer at, ms. */
  double targetMs = 0.0;
  /** How far the controller has moved the resampler off the nominal ratio, ppm. */
  double ratioPpm = 0.0;
  /** The device's largest delivery so far, frames: what the target is sized from. */
  int periodFrames = 0;
  uint64_t underruns = 0;
  uint64_t overruns = 0;
  uint64_t resyncs = 0;
  uint64_t capturedFrames = 0;
  /** Each channel's peak since the last status read, linear. */
  std::vector<float> peaks;
};

/** A capture device as `inputs` lists it. */
struct InputDeviceInfo {
  std::string id;
  std::string name;
  int channels = 0;
  int sampleRate = 0;
  bool isDefault = false;
  bool synthetic = false;
};

class InputFeed {
 public:
  InputFeed();
  ~InputFeed();
  InputFeed(const InputFeed&) = delete;
  InputFeed& operator=(const InputFeed&) = delete;

  // ── Producer side: the device callback or a synthetic source's generator. ──────────────
  /**
   * Writes `count` interleaved frames, delivered at `at` (seconds, on the clock the reader
   * reads time on). Never blocks: a ring with no room drops and counts.
   */
  void push(const float* frames, int count, double at);

  // ── Consumer side: the render thread, once per block. ───────────────────────────────
  /**
   * Produces `frames` output-rate frames into the feed's block, resampled from the ring.
   * `clockFrame` is the output frame the block starts at, which a simulated source reads as
   * the time it has to have delivered up to.
   */
  void pull(int frames, int outRate, int64_t clockFrame);
  /** The block the last pull produced, interleaved at `channels()`; null when not running. */
  const float* block() const { return state_.load(std::memory_order_acquire) == kRunning ? block_.data() : nullptr; }
  int channels() const { return channels_; }

  bool running() const { return state_.load(std::memory_order_acquire) == kRunning; }
  bool inUse() const { return state_.load(std::memory_order_acquire) != kFree; }
  const std::string& device() const { return device_; }

  /** Control thread: makes this slot a feed of `options.device`, opened and started. */
  bool open(const InputOpenOptions& options, int outRate, bool offline, std::string& error);
  /** Control thread: stops the device; the slot keeps its buffers for a later reopen. */
  void close();
  InputFeedStatus status(int slot);

  /** Called by a real device's callback. */
  void captured(const void* frames, uint32_t count);

 private:
  static constexpr int kFree = 0;
  static constexpr int kStopped = 1;
  static constexpr int kRunning = 2;
  static constexpr int64_t kRingFrames = 1 << 16;

  struct Device;

  void pullRunning(int frames, int outRate, int64_t clockFrame);
  void generate(int count, double at);
  void advanceSimulation(int64_t clockFrame, int outRate);
  void syntheticThread();
  void stopSynthetic();
  float sampleAt(int64_t frame, int channel) const {
    return ring_[static_cast<size_t>(frame & (kRingFrames - 1)) * static_cast<size_t>(channels_) +
                 static_cast<size_t>(channel)];
  }

  std::atomic<int> state_{kFree};
  std::string device_;
  std::string name_;
  int channels_ = 0;
  int inRate_ = 48000;
  bool synthetic_ = false;
  bool simulated_ = false;  // a synthetic source on the offline backend: driven by pull()
  int kind_ = 0;            // 0 tone, 1 ramp
  double skewPpm_ = 0.0;
  int periodFrames_ = 0;
  double latencyMs_ = 0.0;
  double jitterMs_ = 0.0;
  uint64_t jitterSeed_ = 0;
  bool jitterDrawn_ = false;
  double pendingJitter_ = 0.0;
  double lastDelivery_ = 0.0;

  std::vector<float> ring_;
  std::vector<float> block_;
  std::atomic<uint64_t> writeHead_{0};
  std::atomic<uint64_t> releasedHead_{0};
  std::atomic<int> maxChunk_{0};
  std::atomic<bool> resetRequested_{false};
  std::atomic<bool> pulling_{false};
  std::atomic<double> lastPushAt_{0.0};
  std::vector<float> scratch_;  // a synthetic source's period, filled before it is pushed

  // Consumer-only state.
  bool primed_ = false;
  double readPos_ = 0.0;
  double fillAverage_ = 0.0;
  double integral_ = 0.0;
  double adjust_ = 0.0;
  double target_ = 0.0;
  double learned_ = 0.0;        // headroom learned from late deliveries, ms
  double sinceLearned_ = 0.0;   // seconds since it last grew

  // Synthetic source's generator position, frames.
  int64_t generated_ = 0;
  double simulatedDue_ = 0.0;

  std::atomic<uint64_t> underruns_{0};
  std::atomic<uint64_t> overruns_{0};
  std::atomic<uint64_t> resyncs_{0};
  std::atomic<double> latencyPublished_{0.0};
  std::atomic<double> targetPublished_{0.0};
  std::atomic<double> ratioPublished_{0.0};
  std::atomic<float> peaks_[kMaxOutputChannels];

  std::unique_ptr<Device> deviceState_;
  std::thread synthetic_thread_;
  std::atomic<bool> syntheticStop_{false};
};

/**
 * The engine's live inputs: up to `kMaxInputFeeds` feeds, one per device, opened on demand
 * and kept open. The render thread pulls every running feed once per block whether or not a
 * voice reads it, so the controller stays locked and a cue that goes live starts on a feed
 * that is already settled.
 */
class InputFeeds {
 public:
  /** Whether the synthetic sources are offered (the offline backend, or `--test-inputs`). */
  void configure(bool offline, bool testInputs) {
    offline_ = offline;
    testInputs_ = testInputs || offline;
  }
  /** Opens (or finds, already open) the feed for `options.device`; its slot, or -1. */
  int open(const InputOpenOptions& options, int outRate, std::string& error);
  /** Closes the feed for `device`; false when none was open. */
  bool close(const std::string& device);
  void closeAll();
  /** The slot holding `device`, running or not, or -1. */
  int find(const std::string& device) const;
  /** Render thread: pulls every running feed. */
  void pullAll(int frames, int outRate, int64_t clockFrame);
  const float* block(int slot) const;
  int channels(int slot) const;
  std::vector<InputFeedStatus> status();
  bool list(std::vector<InputDeviceInfo>& out, std::string& error) const;
  bool testInputs() const { return testInputs_; }

 private:
  InputFeed feeds_[kMaxInputFeeds];
  mutable std::mutex mutex_;
  bool offline_ = false;
  bool testInputs_ = false;
};

}  // namespace ws
