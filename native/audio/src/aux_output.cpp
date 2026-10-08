// windows.h, which miniaudio pulls in, defines `min` and `max` as macros (see engine.cpp).
#if defined(_WIN32)
#define NOMINMAX
#endif

#include "miniaudio_setup.h"

#include "aux_output.h"

#include "util.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstring>

namespace ws {

// engine.cpp: the audio system an engine runs on, and the ids its device list names devices
// by — an extra device is found by the id the main device list gave it — and the one place
// that decides whether a backend notification means a device was lost.
bool initBackendContext(const std::string& backend, ma_context& context, ma_backend& resolved, std::string& reason);
std::string auxDeviceIdString(const ma_device_id& id, ma_backend backend);
const char* auxClassifyNotification(int type, bool expectedStop);

namespace {

struct TestOutput {
  const char* id;
  const char* name;
};
constexpr TestOutput kTestOutputs[] = {{"test:out-a", "Test output A"}, {"test:out-b", "Test output B"}};

/**
 * The lock's start: four times the live input's bandwidth when it opens, falling back to it
 * with a ten-second time constant. A 300 ppm clock error is taken up in seconds rather than a
 * minute, and the settled loop is the live input's, which a late callback does not move.
 */
constexpr double kLockStartBoost = 3.0;
constexpr double kLockBoostSeconds = 10.0;

void auxDataCallback(ma_device* device, void* output, const void* input, ma_uint32 frameCount) {
  (void)input;
  auto* aux = static_cast<AuxOutput*>(device->pUserData);
  if (aux == nullptr || output == nullptr) return;
  aux->render(static_cast<float*>(output), static_cast<int>(frameCount), steadyNowMs() / 1000.0);
}

void auxNotificationCallback(const ma_device_notification* notification) {
  auto* aux = static_cast<AuxOutput*>(notification->pDevice->pUserData);
  if (aux == nullptr) return;
  const char* failure = auxClassifyNotification(notification->type, aux->expectedStop());
  if (failure != nullptr) aux->fail(failure);
}

/** Where a test device tees what it plays: beside the engine's own tee, named for it —
 *  `engine-output.wav` becomes `engine-output.test-out-a.wav`. */
std::string teePath(const std::string& base, const std::string& device) {
  std::string safe;
  for (const char c : device) safe.push_back(std::isalnum(static_cast<unsigned char>(c)) != 0 ? c : '-');
  const size_t dot = base.rfind('.');
  const size_t slash = base.find_last_of("/\\");
  if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return base + "." + safe + ".wav";
  return base.substr(0, dot) + "." + safe + base.substr(dot);
}

}  // namespace

bool isTestOutput(const std::string& device) {
  for (const TestOutput& output : kTestOutputs) {
    if (device == output.id) return true;
  }
  return false;
}

struct AuxOutput::Device {
  ma_context context;
  ma_device device;
  bool contextReady = false;
  bool deviceReady = false;
};

AuxOutput::AuxOutput() = default;

AuxOutput::~AuxOutput() { close(); }

void AuxOutput::push(const float* frames, int count, double at) {
  // Announced before the state is read, and a stop announces its state before it reads this:
  // whichever goes second sees the other, so a stop never reconfigures a ring this push is
  // still writing, and a push never starts on a device that is stopping.
  pushing_.store(true, std::memory_order_seq_cst);
  if (state_.load(std::memory_order_seq_cst) == kRunning) ring_.push(frames, count, at);
  pushing_.store(false, std::memory_order_seq_cst);
}

void AuxOutput::render(float* out, int frames, double now) {
  pulling_.store(true, std::memory_order_seq_cst);
  if (frames > 0) {
    if (state_.load(std::memory_order_seq_cst) == kRunning) {
      ring_.pull(out, frames, outRate_, now);
      played_.fetch_add(static_cast<uint64_t>(frames), std::memory_order_relaxed);
    } else if (ring_.channels() > 0 && synthetic_) {
      // A real device's buffer arrives silenced; a test device's is its own scratch.
      std::memset(out, 0, static_cast<size_t>(frames) * static_cast<size_t>(ring_.channels()) * sizeof(float));
    }
  }
  pulling_.store(false, std::memory_order_seq_cst);
}

void AuxOutput::consume(int frames, double now) {
  float* block = scratch_.data();
  render(block, frames, now);
  if (tee_.isOpen()) tee_.writeFrames(block, frames);
}

/**
 * A simulated device asks for each period when its own clock reaches it — so a skewed clock
 * takes slightly more or fewer frames per second of the main device's time than its stated
 * rate, exactly as a real interface would — and each callback runs late by its own draw from
 * zero to the jitter, never overtaking the one before it. Frame n of what it plays is heard at
 * `startedAt + n / trueRate` on the main device's timeline: the device's converter runs on its
 * clock, however late the callback that filled it ran.
 */
void AuxOutput::advanceSimulation(double now) {
  if (!simulated_ || state_.load(std::memory_order_acquire) != kRunning) return;
  const double trueRate = static_cast<double>(outRate_) * (1.0 + skewPpm_ * 1e-6);
  for (int guard = 0; guard < 4096; guard++) {
    if (!jitterDrawn_) {
      jitterSeed_ = jitterSeed_ * 6364136223846793005ULL + 1442695040888963407ULL;
      pendingJitter_ = static_cast<double>(jitterSeed_ >> 11) / 9007199254740992.0 * jitterMs_ / 1000.0;
      jitterDrawn_ = true;
    }
    const double played = static_cast<double>(played_.load(std::memory_order_relaxed));
    const double due = std::max(lastDue_, startedAt_ + played / trueRate + pendingJitter_);
    if (due > now) break;
    consume(periodFrames_, due);
    lastDue_ = due;
    jitterDrawn_ = false;
  }
}

void AuxOutput::syntheticThread() {
  const double trueRate = static_cast<double>(outRate_) * (1.0 + skewPpm_ * 1e-6);
  const double started = steadyNowMs() / 1000.0;
  while (!syntheticStop_.load(std::memory_order_acquire)) {
    const double due = started + static_cast<double>(played_.load(std::memory_order_relaxed)) / trueRate;
    const double wait = due - steadyNowMs() / 1000.0;
    if (wait > 0.0) {
      std::this_thread::sleep_for(std::chrono::microseconds(static_cast<int64_t>(std::min(wait, 0.02) * 1e6)));
      continue;
    }
    consume(periodFrames_, steadyNowMs() / 1000.0);
  }
}

bool AuxOutput::openReal(const OutputOpenOptions& options, const AuxHost& host, std::string& error) {
  auto state = std::make_unique<Device>();
  ma_backend resolved = ma_backend_null;
  std::string reason;
  if (!initBackendContext(host.backend, state->context, resolved, reason)) {
    error = "no audio system to open " + options.device + " on (" + reason + ")";
    return false;
  }
  state->contextReady = true;
  ma_device_info* playback = nullptr;
  ma_uint32 playbackCount = 0;
  ma_device_info* captures = nullptr;
  ma_uint32 captureCount = 0;
  ma_device_id chosen{};
  bool found = false;
  std::string name = options.device;
  if (ma_context_get_devices(&state->context, &playback, &playbackCount, &captures, &captureCount) == MA_SUCCESS) {
    for (ma_uint32 i = 0; i < playbackCount && !found; i++) {
      if (auxDeviceIdString(playback[i].id, resolved) != options.device) continue;
      chosen = playback[i].id;
      name = playback[i].name;
      found = true;
    }
  }
  if (!found) {
    ma_context_uninit(&state->context);
    error = "the output device " + options.device + " is not connected to this machine";
    return false;
  }
  ma_device_config config = ma_device_config_init(ma_device_type_playback);
  config.playback.pDeviceID = &chosen;
  config.playback.format = ma_format_f32;
  config.playback.channels = 0;
  // Asked for the main device's rate, so the lock's resampler only ever has the two clocks'
  // drift to take up; a device that cannot run at it is converted to by the backend.
  config.sampleRate = static_cast<ma_uint32>(host.mainRate);
  config.performanceProfile = ma_performance_profile_low_latency;
  config.dataCallback = auxDataCallback;
  config.notificationCallback = auxNotificationCallback;
  config.pUserData = this;
  const ma_result result = ma_device_init(&state->context, &config, &state->device);
  if (result != MA_SUCCESS) {
    ma_context_uninit(&state->context);
    error = "could not open " + name + ": " + ma_result_description(result);
    return false;
  }
  state->deviceReady = true;
  name_ = name;
  const int periodFrames = static_cast<int>(state->device.playback.internalPeriodSizeInFrames);
  const int periods = static_cast<int>(state->device.playback.internalPeriods);
  const int internalRate = static_cast<int>(state->device.playback.internalSampleRate);
  deviceLatencyMs_ = periodFrames > 0 && periods > 0 && internalRate > 0
                         ? static_cast<double>(periodFrames) * static_cast<double>(periods) * 1000.0 /
                               static_cast<double>(internalRate)
                         : 0.0;
  deviceState_ = std::move(state);
  return true;
}

bool AuxOutput::open(const OutputOpenOptions& options, const AuxHost& host, std::string& error) {
  if (running()) return true;
  // A device that failed keeps its slot while it is opened again, and keeps it if it will not
  // open: the patches that name it are waiting on this slot.
  const bool wasHeld = inUse();
  stopStream();
  const bool synthetic = isTestOutput(options.device);
  int channels = 0;
  int rate = 0;
  if (synthetic) {
    if (!(options.skewPpm >= -10000.0 && options.skewPpm <= 10000.0)) {
      error = "a test output's clock error must be within ±10000 ppm";
    } else if (options.sampleRate != 0 && (options.sampleRate < 8000 || options.sampleRate > 384000)) {
      error = "a test output runs between 8 and 384 kHz";
    } else if (options.periodFrames < 0 || options.periodFrames > kMaxOutputFrames) {
      error = "a test output's period is 1 to " + std::to_string(kMaxOutputFrames) + " frames";
    } else {
      channels = std::clamp(options.channels, 1, kMaxOutputChannels);
      rate = options.sampleRate > 0 ? options.sampleRate : host.mainRate;
      for (const TestOutput& output : kTestOutputs) {
        if (options.device == output.id) name_ = output.name;
      }
      deviceLatencyMs_ = 0.0;
    }
  } else if (openReal(options, host, error)) {
    channels = std::clamp(static_cast<int>(deviceState_->device.playback.channels), 1, kMaxOutputChannels);
    rate = static_cast<int>(deviceState_->device.sampleRate);
  }
  if (channels <= 0 || rate <= 0) {
    if (wasHeld) {
      std::lock_guard<std::mutex> lock(failureMutex_);
      failure_ = error;
      state_.store(kFailed, std::memory_order_seq_cst);
    } else {
      state_.store(kFree, std::memory_order_seq_cst);
    }
    return false;
  }

  options_ = options;
  device_ = options.device;
  outRate_ = rate;
  synthetic_ = synthetic;
  simulated_ = synthetic && host.offline;
  skewPpm_ = options.skewPpm;
  periodFrames_ = options.periodFrames > 0 ? options.periodFrames : std::max(1, rate / 100);
  jitterMs_ = std::clamp(options.jitterMs, 0.0, 100.0);
  jitterSeed_ = 0x2545F4914F6CDD1DULL;
  jitterDrawn_ = false;
  pendingJitter_ = 0.0;
  lastDue_ = 0.0;
  startedAt_ = host.clockMs / 1000.0;
  played_.store(0, std::memory_order_relaxed);
  // A device is opened when its show loads, long before its first cue: its lock starts fast
  // (drift.h) and settles to the gentle loop within half a minute.
  DriftTuning tuning;
  tuning.startBoost = kLockStartBoost;
  tuning.boostSeconds = kLockBoostSeconds;
  ring_.configure(channels, host.mainRate, options.latencyMs, 0, tuning);
  if (synthetic) scratch_.assign(static_cast<size_t>(periodFrames_) * static_cast<size_t>(channels), 0.0f);
  // A device opened again after a loss goes on teeing into the file it was teeing into, so
  // the capture holds the whole show rather than what came after the reconnect.
  if (synthetic && !host.capturePath.empty() && !tee_.isOpen()) {
    std::string teeError;
    if (!tee_.open(teePath(host.capturePath, device_), rate, channels, teeError)) {
      logError("test output tee failed: %s", teeError.c_str());
    }
  }
  {
    std::lock_guard<std::mutex> lock(failureMutex_);
    failure_.clear();
  }
  failurePending_.store(false, std::memory_order_release);
  state_.store(kRunning, std::memory_order_seq_cst);

  if (deviceState_ != nullptr) {
    expectedStop_.store(false, std::memory_order_release);
    const ma_result started = ma_device_start(&deviceState_->device);
    if (started != MA_SUCCESS) {
      error = "could not start " + name_ + ": " + ma_result_description(started);
      stopStream();
      if (wasHeld) {
        std::lock_guard<std::mutex> lock(failureMutex_);
        failure_ = error;
        state_.store(kFailed, std::memory_order_seq_cst);
      } else {
        state_.store(kFree, std::memory_order_seq_cst);
      }
      return false;
    }
  } else if (synthetic && !host.offline) {
    syntheticStop_.store(false, std::memory_order_release);
    syntheticThread_ = std::thread([this] { syntheticThread(); });
  }
  return true;
}

void AuxOutput::stopStream() {
  int expected = kRunning;
  state_.compare_exchange_strong(expected, kStopped, std::memory_order_seq_cst);
  // A push or a pull that began before the stop is a few microseconds of copying: it is let
  // finish, so nothing is left reading the ring or the device this tears down.
  while (pushing_.load(std::memory_order_seq_cst) || pulling_.load(std::memory_order_seq_cst)) {
    std::this_thread::yield();
  }
  syntheticStop_.store(true, std::memory_order_release);
  if (syntheticThread_.joinable()) syntheticThread_.join();
  if (deviceState_ != nullptr) {
    // The stop is the engine's own: the `stopped` notification miniaudio posts for it is not
    // a loss.
    expectedStop_.store(true, std::memory_order_release);
    if (deviceState_->deviceReady) ma_device_uninit(&deviceState_->device);
    if (deviceState_->contextReady) ma_context_uninit(&deviceState_->context);
    deviceState_.reset();
    expectedStop_.store(false, std::memory_order_release);
  }
}

void AuxOutput::halt() {
  const bool wasFailed = failed();
  stopStream();
  if (wasFailed) state_.store(kFailed, std::memory_order_seq_cst);
}

void AuxOutput::close() {
  stopStream();
  tee_.finalize();
  state_.store(kFree, std::memory_order_seq_cst);
  failurePending_.store(false, std::memory_order_release);
}

void AuxOutput::fail(const std::string& message) {
  // Only a device that is playing can be lost, and only once: a second notification for the
  // same loss, or one that lands while the engine is stopping it, says nothing new.
  int expected = kRunning;
  if (!state_.compare_exchange_strong(expected, kFailed, std::memory_order_seq_cst)) return;
  {
    std::lock_guard<std::mutex> lock(failureMutex_);
    failure_ = message;
  }
  failurePending_.store(true, std::memory_order_release);
}

bool AuxOutput::takeFailure(std::string& message) {
  if (!failurePending_.exchange(false, std::memory_order_acq_rel)) return false;
  std::lock_guard<std::mutex> lock(failureMutex_);
  message = failure_;
  return true;
}

void AuxOutput::checkHealth() {
  if (!running() || deviceState_ == nullptr || !deviceState_->deviceReady || expectedStop()) return;
  // Some backends report a genuine loss only by leaving the started state (see the main
  // device's health check in engine.cpp), so the state is the evidence.
  const ma_device_state state = ma_device_get_state(&deviceState_->device);
  if (state == ma_device_state_stopped || state == ma_device_state_stopping) fail("the device stopped unexpectedly");
}

OutputStatus AuxOutput::status(int slot) const {
  OutputStatus out;
  out.slot = slot;
  out.device = device_;
  out.name = name_.empty() ? device_ : name_;
  out.channels = ring_.channels();
  out.sampleRate = outRate_;
  out.running = running();
  out.failed = failed();
  out.synthetic = synthetic_;
  if (out.failed) {
    std::lock_guard<std::mutex> lock(failureMutex_);
    out.error = failure_;
  }
  // The lock holds what is buffered on both sides of the main device's callback; the block
  // the main device has not handed over yet is what it is playing itself, so it is not part
  // of this device's offset from it.
  const int mainRate = ring_.inRate();
  out.latencyMs = std::max(0.0, ring_.latencyMs() - static_cast<double>(ring_.maxChunk()) * 1000.0 /
                                                        static_cast<double>(mainRate > 0 ? mainRate : 48000));
  out.targetMs = ring_.targetMs();
  out.deviceLatencyMs = deviceLatencyMs_;
  // The controller steps through the main device's samples at (1 + held) times the nominal
  // ratio once locked: a device whose clock is fast by d takes 1 / (1 + d) of them per sample.
  const double held = ring_.heldPpm() * 1e-6;
  out.driftPpm = (1.0 / (1.0 + held) - 1.0) * 1e6;
  out.periodFrames = ring_.maxChunk();
  out.underruns = ring_.underruns();
  out.overruns = ring_.overruns();
  out.resyncs = ring_.resyncs();
  out.playedFrames = played_.load(std::memory_order_relaxed);
  out.startedAtMs = startedAt_ * 1000.0;
  return out;
}

// ── The set ──────────────────────────────────────────────────────────────────────────────

int AuxOutputs::find(const std::string& device) const {
  for (int slot = 0; slot < kMaxAuxOutputs; slot++) {
    if (outputs_[slot].inUse() && outputs_[slot].device() == device) return slot;
  }
  return -1;
}

int AuxOutputs::open(const OutputOpenOptions& options, int mainRate, double clockMs, std::string& error) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (options.device.empty() || options.device == "default") {
    error = "an extra output device is named by its id; the default device is the main one";
    return -1;
  }
  const bool test = isTestOutput(options.device);
  if (test && !testOutputs_) {
    error = "test outputs are not offered by this engine";
    return -1;
  }
  if (!test && options.device.rfind("test:", 0) == 0) {
    error = "there is no test output called \"" + options.device + "\"";
    return -1;
  }
  if (!test && offline_) {
    error = "the output device " + options.device + " is not connected to this machine";
    return -1;
  }
  int slot = find(options.device);
  if (slot >= 0 && outputs_[slot].running()) return slot;
  if (slot < 0) {
    for (int candidate = 0; candidate < kMaxAuxOutputs && slot < 0; candidate++) {
      if (!outputs_[candidate].inUse()) slot = candidate;
    }
  }
  if (slot < 0) {
    error = "every extra output device the engine can hold is open (" + std::to_string(kMaxAuxOutputs) + ")";
    return -1;
  }
  AuxHost host;
  host.backend = backend_;
  host.mainRate = mainRate;
  host.offline = offline_;
  host.clockMs = clockMs;
  host.capturePath = capturePath_;
  if (!outputs_[slot].open(options, host, error)) return -1;
  return slot;
}

void AuxOutputs::close(int slot) {
  if (slot < 0 || slot >= kMaxAuxOutputs) return;
  std::lock_guard<std::mutex> lock(mutex_);
  outputs_[slot].close();
}

void AuxOutputs::halt(int slot, std::string& name) {
  if (slot < 0 || slot >= kMaxAuxOutputs) return;
  std::lock_guard<std::mutex> lock(mutex_);
  outputs_[slot].halt();
  name = outputs_[slot].name().empty() ? outputs_[slot].device() : outputs_[slot].name();
}

void AuxOutputs::closeAll() {
  std::lock_guard<std::mutex> lock(mutex_);
  for (AuxOutput& output : outputs_) output.close();
}

std::vector<OutputStatus> AuxOutputs::status() const {
  std::lock_guard<std::mutex> lock(mutex_);
  std::vector<OutputStatus> out;
  for (int slot = 0; slot < kMaxAuxOutputs; slot++) {
    if (outputs_[slot].inUse()) out.push_back(outputs_[slot].status(slot));
  }
  return out;
}

bool AuxOutputs::list(std::vector<OutputDeviceInfo>& out, std::string& error) const {
  if (testOutputs_) {
    for (const TestOutput& output : kTestOutputs) out.push_back({output.id, output.name, 2, 0, false, true});
  }
  if (offline_) return true;
  std::string backend;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    backend = backend_;
  }
  if (backend == "silent") return true;
  ma_context context;
  ma_backend resolved = ma_backend_null;
  std::string reason;
  if (!initBackendContext(backend, context, resolved, reason)) {
    error = "no audio system to list output devices on (" + reason + ")";
    return false;
  }
  ma_device_info* playback = nullptr;
  ma_uint32 playbackCount = 0;
  ma_device_info* captures = nullptr;
  ma_uint32 captureCount = 0;
  if (ma_context_get_devices(&context, &playback, &playbackCount, &captures, &captureCount) == MA_SUCCESS) {
    for (ma_uint32 i = 0; i < playbackCount; i++) {
      OutputDeviceInfo info;
      info.id = auxDeviceIdString(playback[i].id, resolved);
      info.name = playback[i].name;
      info.isDefault = playback[i].isDefault != 0;
      ma_device_info detail;
      if (ma_context_get_device_info(&context, ma_device_type_playback, &playback[i].id, &detail) == MA_SUCCESS &&
          detail.nativeDataFormatCount > 0) {
        info.channels = static_cast<int>(detail.nativeDataFormats[0].channels);
        info.sampleRate = static_cast<int>(detail.nativeDataFormats[0].sampleRate);
      }
      out.push_back(info);
    }
  }
  ma_context_uninit(&context);
  return true;
}

void AuxOutputs::setSourceRate(int rate) {
  for (AuxOutput& output : outputs_) {
    if (output.inUse()) output.setSourceRate(rate);
  }
}

void AuxOutputs::advanceSimulation(double now) {
  for (AuxOutput& output : outputs_) output.advanceSimulation(now);
}

void AuxOutputs::checkHealth() {
  // Never a wait on the service thread: an open or a close in progress holds the lock for as
  // long as a device takes to open, and the next tick looks again.
  std::unique_lock<std::mutex> lock(mutex_, std::try_to_lock);
  if (!lock.owns_lock()) return;
  for (AuxOutput& output : outputs_) output.checkHealth();
}

int AuxOutputs::takeFailure(std::string& message) {
  for (int slot = 0; slot < kMaxAuxOutputs; slot++) {
    if (outputs_[slot].takeFailure(message)) return slot;
  }
  return -1;
}

}  // namespace ws
