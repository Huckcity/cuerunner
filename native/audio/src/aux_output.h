// Extra output devices: a second (third, …) interface the show plays on beside the one the
// engine opened, each one named by the output patches that use it.
//
// The mixer is one mixer whatever a show plays on. Every voice is a voice of it — so the
// master, the meters, a pause, the show-wide pause, a panic, fades and their drawn shapes,
// slices and live inputs reach a cue on an extra device exactly as they reach one on the main
// device — and a patch that names an extra device is summed into a block of that device's own
// rather than onto the main outputs (mixer.h, `Bus::aux`). That block is written into the
// device's drift lock (drift.h) on the main device's timeline, and the device's own callback
// reads it at the device's pace through the resampler its controller keeps in step. Two
// interfaces never share a clock — a few hundred parts per million apart is ordinary — and
// without the lock a cue sent to both drifts out of phase by tens of milliseconds a minute;
// with it, the extra device is held sample-locked to the main one behind a fixed, reported
// buffer, and never under- or overruns.
//
// A device is opened when a patch first names it and kept open, so its first cue starts on a
// stream that is already running and already locked. One that fails — unplugged, taken by
// another application, its driver gone — is reported in the device-loss path's own words,
// the voices on its patches end `device-lost`, and everything else plays on; its patches fall
// back to the main device's outputs of the same numbers until it is opened again.
//
// Two test devices stand in for hardware where there is none (`test:out-a`, `test:out-b`):
// the offline backend always offers them and a device backend only when asked for them
// (`--test-outputs`). On the offline backend one runs on simulated time with a configurable
// clock error, period and callback jitter, so minutes of drift render in seconds and the same
// render is the same every run; with a capture path, each writes what it played to a WAV of
// its own beside the engine's, which is how a test reads the two devices' alignment back from
// the samples.
#pragma once

#include "drift.h"
#include "wavwrite.h"
#include "wsaudio.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace ws {

/** What opening an extra output device asks for. Everything but the device and the buffer
 *  applies to a test device only: a real device keeps its own channels and period. */
struct OutputOpenOptions {
  std::string device;
  /** A test device's rate; 0 is the main device's. A real device is asked for the main rate. */
  int sampleRate = 0;
  int channels = 2;
  /** How far a test device's clock is off its stated rate, parts per million. */
  double skewPpm = 0.0;
  /** How many frames a test device asks for at once: a device's period; 0 is 10 ms. */
  int periodFrames = 0;
  /** The buffer the drift controller holds, ms; 0 sizes it from the main device's blocks. */
  double latencyMs = 0.0;
  /** How late a test device's callbacks may each be, ms. */
  double jitterMs = 0.0;
};

/** One extra output device's state, as `outputStatus` reports it. */
struct OutputStatus {
  int slot = -1;
  std::string device;
  std::string name;
  int channels = 0;
  int sampleRate = 0;
  bool running = false;
  /** Lost since it was opened: its patches are on the main device until it is opened again. */
  bool failed = false;
  bool synthetic = false;
  /** Why it failed or would not open; empty while it plays. */
  std::string error;
  /** What the drift lock holds between the main device's timeline and this device, a
   *  one-second average, ms: the part of this device's offset from the main one the engine
   *  adds. */
  double latencyMs = 0.0;
  /** The buffer the controller is holding, ms. */
  double targetMs = 0.0;
  /** The device's own buffer, ms, from its period and periods (an estimate; 0 for a test device). */
  double deviceLatencyMs = 0.0;
  /** How fast this device's clock runs against the main device's, ppm, as the lock measures it. */
  double driftPpm = 0.0;
  /** The main device's largest block so far, frames. */
  int periodFrames = 0;
  uint64_t underruns = 0;
  uint64_t overruns = 0;
  uint64_t resyncs = 0;
  /** Frames this device has played. */
  uint64_t playedFrames = 0;
  /** The engine clock (ms) when this device's stream began: where its frame 0 sits on the
   *  main device's timeline, which is what a test measures the offset of the two against. */
  double startedAtMs = 0.0;
};

/** An output device a patch can name, as `outputs` lists it. */
struct OutputDeviceInfo {
  std::string id;
  std::string name;
  int channels = 0;
  int sampleRate = 0;
  bool isDefault = false;
  bool synthetic = false;
};

/** What the engine tells an extra device about where it is opened. */
struct AuxHost {
  /** The engine's audio system ("auto", "wasapi", …): an extra device opens on the same one,
   *  so its id means what the main device list says it means. */
  std::string backend;
  /** The main device's rate: what the mixer writes this device's blocks at. */
  int mainRate = 48000;
  bool offline = false;
  /** The engine clock, ms, now. */
  double clockMs = 0.0;
  /** Where a test device tees what it plays, as a base path; empty for no tee. */
  std::string capturePath;
};

class AuxOutput {
 public:
  AuxOutput();
  ~AuxOutput();
  AuxOutput(const AuxOutput&) = delete;
  AuxOutput& operator=(const AuxOutput&) = delete;

  // ── Render thread ────────────────────────────────────────────────────────────────────
  /** Writes the block the mixer made for this device, delivered at `at` (seconds). */
  void push(const float* frames, int count, double at);
  /** Offline only: runs every callback a simulated device has due by `now` (seconds). */
  void advanceSimulation(double now);

  // ── The device's callback (or its stand-in) ────────────────────────────────────────
  /** Fills `frames` of the device's output from the lock, at the device's pace. */
  void render(float* out, int frames, double now);

  // ── Control thread ───────────────────────────────────────────────────────────────────
  bool open(const OutputOpenOptions& options, const AuxHost& host, std::string& error);
  /** Stops and releases the device; the slot is free again. */
  void close();
  /** Stops a failed device's stream and keeps the slot, so its patches can wait for it. */
  void halt();
  /** The main device reopened at another rate: the lock relocks to it. */
  void setSourceRate(int rate) { ring_.setInRate(rate); }
  OutputStatus status(int slot) const;
  /** Service thread: a real device whose stream has stopped on its own is failed. */
  void checkHealth();

  /** Any thread: the device has gone. The service thread reports it (`takeFailure`). */
  void fail(const std::string& message);
  /** Service thread: the failure not yet reported, once. */
  bool takeFailure(std::string& message);

  bool running() const { return state_.load(std::memory_order_acquire) == kRunning; }
  bool failed() const { return state_.load(std::memory_order_acquire) == kFailed; }
  bool inUse() const { return state_.load(std::memory_order_acquire) != kFree; }
  bool synthetic() const { return synthetic_; }
  const std::string& device() const { return device_; }
  const std::string& name() const { return name_; }
  int channels() const { return ring_.channels(); }
  bool expectedStop() const { return expectedStop_.load(std::memory_order_acquire); }

 private:
  static constexpr int kFree = 0;
  static constexpr int kStopped = 1;
  static constexpr int kRunning = 2;
  static constexpr int kFailed = 3;

  struct Device;

  bool openReal(const OutputOpenOptions& options, const AuxHost& host, std::string& error);
  void syntheticThread();
  void stopStream();
  /** One period of a test device: its block from the lock, teed when asked. */
  void consume(int frames, double now);

  std::atomic<int> state_{kFree};
  std::atomic<bool> pushing_{false};
  std::atomic<bool> pulling_{false};
  std::atomic<bool> expectedStop_{false};
  std::atomic<bool> failurePending_{false};
  mutable std::mutex failureMutex_;
  std::string failure_;

  std::string device_;
  std::string name_;
  OutputOpenOptions options_;
  int outRate_ = 48000;
  bool synthetic_ = false;
  bool simulated_ = false;
  double skewPpm_ = 0.0;
  int periodFrames_ = 0;
  double jitterMs_ = 0.0;
  uint64_t jitterSeed_ = 0;
  bool jitterDrawn_ = false;
  double pendingJitter_ = 0.0;
  double lastDue_ = 0.0;
  double startedAt_ = 0.0;  // seconds on the engine clock
  double deviceLatencyMs_ = 0.0;
  std::atomic<uint64_t> played_{0};

  DriftRing ring_;
  std::vector<float> scratch_;
  WavWriter tee_;

  std::unique_ptr<Device> deviceState_;
  std::thread syntheticThread_;
  std::atomic<bool> syntheticStop_{false};
};

/**
 * The engine's extra output devices: up to `kMaxAuxOutputs`, one per device, opened when a
 * patch names one and kept open. A device keeps its slot for as long as it is open or failed,
 * which is what the mixer's buses address it by.
 */
class AuxOutputs {
 public:
  void configure(bool offline, bool testOutputs, const std::string& backend, const std::string& capturePath) {
    offline_ = offline;
    testOutputs_ = testOutputs || offline;
    backend_ = backend;
    capturePath_ = capturePath;
  }
  void setBackend(const std::string& backend) {
    std::lock_guard<std::mutex> lock(mutex_);
    backend_ = backend;
  }
  /**
   * Opens `options.device` (or finds it open), on the slot it already holds when it has
   * failed. Its slot, or -1 with the reason in `error`.
   */
  int open(const OutputOpenOptions& options, int mainRate, double clockMs, std::string& error);
  /** The slot `device` holds, open or failed, or -1. */
  int find(const std::string& device) const;
  /** Closes the device in `slot`. */
  void close(int slot);
  /** Stops a failed device's stream, keeping its slot; `name` is what it is called. */
  void halt(int slot, std::string& name);
  void closeAll();
  AuxOutput& at(int slot) { return outputs_[slot]; }
  const AuxOutput& at(int slot) const { return outputs_[slot]; }
  std::vector<OutputStatus> status() const;
  bool list(std::vector<OutputDeviceInfo>& out, std::string& error) const;
  bool testOutputs() const { return testOutputs_; }
  void setSourceRate(int rate);
  /** Render thread, offline: every simulated device's callbacks due by `now`. */
  void advanceSimulation(double now);
  /** Service thread: real devices whose streams stopped on their own are failed. */
  void checkHealth();
  /** Service thread: the next failure to report — its slot, or -1 when there is none. */
  int takeFailure(std::string& message);

 private:
  /** `find`, with the lock already held — a device's name is only written under it. */
  int findLocked(const std::string& device) const;
  /** With the lock held: how many slots are open or failed, into `inUse_`. */
  void recount();

  AuxOutput outputs_[kMaxAuxOutputs];
  // How many slots are open or failed: written under `mutex_`, read by the service loop so a
  // show on one device skips the extra devices' checks whole.
  std::atomic<int> inUse_{0};
  mutable std::mutex mutex_;
  bool offline_ = false;
  bool testOutputs_ = false;
  std::string backend_ = "auto";
  std::string capturePath_;
};

/** Whether `device` names one of the engine's test output devices (`test:out-…`). */
bool isTestOutput(const std::string& device);

}  // namespace ws
