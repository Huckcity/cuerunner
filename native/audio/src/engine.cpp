// windows.h defines `min` and `max` as function-like macros, and miniaudio pulls
// windows.h in on Windows. Without this, every std::min and std::max in this file is a
// syntax error there (MSVC C2589: illegal token on right side of '::').
#if defined(_WIN32)
#define NOMINMAX
#endif

// miniaudio's implementation, compiled in this file and nowhere else. The define has to be
// in place before the header's first inclusion anywhere in this translation unit, and
// asio_backend.h below includes it for its types — so this comes first, before every other
// header, or the implementation silently is not compiled and the link fails on ma_*.
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio_setup.h"

#include "engine.h"

#include "asio_backend.h"  // a no-op unless this build has the ASIO SDK
#include "onsets.h"
#include "util.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>
#include <thread>

namespace ws {
namespace {

constexpr int kBackgroundTickMs = 2;
constexpr int kAckTimeoutMs = 2000;

// An onset scan's sensitivity bounds. Out of range is either a typo or an attempt to
// make the threshold meaningless: 0.1 asks for a rise 1.15x the median flux and 10.0 for
// one 16x the median, which is as far as the calibration means anything. Clamped rather
// than refused, the way an oversized waveform point count is.
constexpr double kMinOnsetSensitivity = 0.1;
constexpr double kMaxOnsetSensitivity = 10.0;

// A silence scan's threshold bounds, in dBFS. Out of range is either a typo or an
// attempt to ask a question the samples cannot answer: below -120 dBFS the line sits
// under the noise floor of any 24-bit converter, where what it separates is dither from
// dither, and above 0 dBFS nothing short of a clipped sample can cross it. Clamped
// rather than refused, the way an oversized waveform point count is.
constexpr double kMinSilenceThresholdDb = -120.0;
constexpr double kMaxSilenceThresholdDb = 0.0;

/**
 * The region length above which a waveform envelope is tapped rather than read through.
 * At this length a bucket is already wider than a pixel of wall time on a full-width
 * panel, so the transient a tap misses is one that could not have been drawn — and
 * reading it through instead would cost a pass over the media: 0.4 ms per second of it,
 * measured, which is eighteen seconds of a twelve-hour file. Below it, every sample is
 * read: half a second of work at the very most.
 */
constexpr int64_t kExactWaveformSeconds = 1500;
/** The media one tap covers, at most: a window per bucket, whichever is shorter. */
constexpr int64_t kSampleWindowMs = 1000;
/** Envelope and onset answers kept per engine: a show's files, with room for a few
 *  windows inside them. */
constexpr size_t kMaxAnalysisCacheEntries = 64;

int64_t msFrame(double ms, int sampleRate) {
  if (!(ms > 0.0) || sampleRate <= 0) return 0;
  return static_cast<int64_t>(ms * static_cast<double>(sampleRate) / 1000.0 + 0.5);
}

double frameMs(int64_t frame, int sampleRate) {
  return sampleRate > 0 && frame > 0 ? static_cast<double>(frame) * 1000.0 / static_cast<double>(sampleRate) : 0.0;
}

/** Regions are keys: unbounded is one key, a bounded window is its own. */
bool sameRegion(const RegionQuery& a, const RegionQuery& b) {
  if (a.bounded != b.bounded) return false;
  return !a.bounded || (a.startMs == b.startMs && a.endMs == b.endMs);
}

std::string maResultText(ma_result result) { return std::string(ma_result_description(result)); }

/**
 * The refusal a whole-file scan returns when the engine is stopping under it: there is
 * no client left to read the answer by then, only a process waiting to go down.
 */
bool cancelledScan(EngineError& error) {
  error = {"cancelled", "the engine is stopping; the scan was not finished"};
  return false;
}

// The session identity is minted per process, not derived from the clock: a respawned
// engine starts its frame counter at zero again, and the id is the only thing that says
// so. Random rather than monotonic because nothing persists across a respawn — a
// collision would need two live engines, which cannot happen on one socket.
std::string mintSessionId() {
  std::random_device device;
  const uint64_t value = (static_cast<uint64_t>(device()) << 32) ^ static_cast<uint64_t>(device());
  char buffer[17] = {};
  std::snprintf(buffer, sizeof(buffer), "%016llx", static_cast<unsigned long long>(value));
  return std::string(buffer);
}

std::string formatNameOf(ma_format format) {
  switch (format) {
    case ma_format_f32: return "f32";
    case ma_format_s16: return "s16";
    case ma_format_s24: return "s24";
    case ma_format_s32: return "s32";
    case ma_format_u8: return "u8";
    default: return "unknown";
  }
}

std::string backendNameOf(ma_backend backend) {
  switch (backend) {
    case ma_backend_wasapi: return "wasapi";
    case ma_backend_coreaudio: return "coreaudio";
    case ma_backend_alsa: return "alsa";
    case ma_backend_pulseaudio: return "pulseaudio";
    case ma_backend_jack: return "jack";
    // There is one custom backend in this engine and it is ASIO: miniaudio has no ASIO of
    // its own, so the backend is registered through the custom hook (see asio_backend.cpp).
    case ma_backend_custom: return "asio";
    case ma_backend_null: return "silent";
    default: return "unknown";
  }
}

bool parseBackendName(const std::string& name, ma_backend& out) {
  if (name == "wasapi") { out = ma_backend_wasapi; return true; }
  if (name == "coreaudio") { out = ma_backend_coreaudio; return true; }
  if (name == "alsa") { out = ma_backend_alsa; return true; }
  if (name == "pulseaudio" || name == "pulse" || name == "pipewire") { out = ma_backend_pulseaudio; return true; }
  if (name == "jack") { out = ma_backend_jack; return true; }
  if (name == "asio") { out = ma_backend_custom; return true; }
  return false;
}

std::vector<ma_backend> defaultBackends() {
#if defined(_WIN32)
  return {ma_backend_wasapi};
#elif defined(__APPLE__)
  return {ma_backend_coreaudio};
#else
  return {ma_backend_pulseaudio, ma_backend_alsa, ma_backend_jack};
#endif
}

bool backendSupportsExclusive(ma_backend backend) {
  return backend == ma_backend_wasapi || backend == ma_backend_coreaudio;
}

std::string deviceIdToString(const ma_device_id& id, ma_backend backend) {
  switch (backend) {
    case ma_backend_wasapi: {
      std::string out;
      // WASAPI ids are WCHAR strings; keep the ASCII form the device reports.
      for (size_t i = 0; i < sizeof(id.wasapi) / sizeof(id.wasapi[0]) && id.wasapi[i] != 0; i++) {
        out.push_back(static_cast<char>(id.wasapi[i] & 0xFF));
      }
      return out.empty() ? std::string("wasapi-default") : out;
    }
    case ma_backend_pulseaudio: return id.pulse[0] != '\0' ? std::string(id.pulse) : std::string("pulse-default");
    case ma_backend_alsa: return id.alsa[0] != '\0' ? std::string(id.alsa) : std::string("alsa-default");
    case ma_backend_coreaudio: return id.coreaudio[0] != '\0' ? std::string(id.coreaudio) : std::string("coreaudio-default");
    case ma_backend_jack: return "jack-" + std::to_string(id.jack);
    case ma_backend_custom: return id.custom.s[0] != '\0' ? std::string(id.custom.s) : std::string("asio-default");
    default: return "device-" + std::to_string(id.nullbackend);
  }
}

void sleepMs(double ms) {
  if (ms <= 0.0) return;
  std::this_thread::sleep_for(std::chrono::microseconds(static_cast<int64_t>(ms * 1000.0)));
}

bool finiteNumber(double value) { return std::isfinite(value); }

}  // namespace

struct Engine::DeviceState {
  ma_context context{};
  ma_device device{};
  bool contextReady = false;
  bool deviceReady = false;
  ma_backend backend = ma_backend_null;
  std::string backendName;
  int sampleRate = 48000;
  int channels = 2;
  int internalSampleRate = 48000;
  bool exclusive = false;
  int bufferFrames = -1;
  int periodFrames = -1;
  std::string deviceName;
  std::string deviceId;
  std::string format = "f32";
  std::string internalFormat = "f32";
  // What only the backend can say: the latency its own driver states (in samples, measured
  // from the hardware rather than derived from the period size), and anything about this
  // device the operator should be told in the engine's warnings. The latency is the
  // open-time snapshot; info() re-reads ASIO's live figure, which kAsioLatenciesChanged
  // can restate mid-session.
  double reportedLatencyMs = -1.0;
  std::string backendNote;
  std::map<std::string, ma_device_id> ids;
};

namespace {

void deviceDataCallback(ma_device* device, void* output, const void* input, ma_uint32 frameCount) {
  (void)input;
  auto* engine = static_cast<Engine*>(device->pUserData);
  if (engine == nullptr) return;
  engine->renderOfflineBlock(static_cast<float*>(output), static_cast<int>(frameCount));
}

// The one place that decides whether a backend notification means the device was lost.
// miniaudio's device thread posts `stopped` whenever it leaves its loop, which includes
// every stop this engine asked for — a reconfigure, or shutdown — so the fact that the
// engine is stopping deliberately is part of the decision, not an afterthought.
const char* classifyDeviceNotification(int type, bool expectedStop) {
  if (expectedStop) return nullptr;
  switch (type) {
    case ma_device_notification_type_stopped: return "audio device stopped unexpectedly";
    case ma_device_notification_type_interruption_began:
      return "audio device was interrupted (exclusive access or format change)";
    case ma_device_notification_type_unlocked: return "exclusive device access was lost";
    default: return nullptr;  // started / rerouted / interruption_ended are informational
  }
}

void deviceNotificationCallback(const ma_device_notification* notification) {
  auto* engine = static_cast<Engine*>(notification->pDevice->pUserData);
  if (engine == nullptr) return;
  const char* failure = classifyDeviceNotification(notification->type, engine->isExpectedDeviceStop());
  if (failure != nullptr) engine->failDeviceFromCallback(failure);
}

}  // namespace

Engine::Engine() : mixer_(cache_, streams_, events_, reclaim_) {
  cache_.configure(options_.cacheMaxBytes, options_.cacheMaxFiles, options_.cacheMaxFileBytes);
  sessionId_ = mintSessionId();
}

Engine::Engine(const EngineOptions& options) : Engine() {
  options_ = options;
  cache_.configure(options_.cacheMaxBytes, options_.cacheMaxFiles, options_.cacheMaxFileBytes);
}

Engine::~Engine() { stop(); }

void Engine::setEventCallback(std::function<void(const Event&)> callback) { eventCallback_ = callback; }

void Engine::handleSimulatedNotification(int type) {
  // Only reachable with the silent/offline backends (protocol gates it), and it drives
  // the same classification the backend callback uses.
  const char* failure = classifyDeviceNotification(type, isExpectedDeviceStop());
  if (failure != nullptr) failDeviceFromCallback(failure);
}

void Engine::failDeviceFromCallback(const std::string& message) {
  deviceFailures_.fetch_add(1, std::memory_order_relaxed);
  deviceFailed_.store(true, std::memory_order_release);
  // Whatever the backend did to lose it, this device is not rendering any more — the
  // reason it counts as lost. Recorded where the failure is classified rather than after
  // the drain, so a tick that came too late to take the device can tell this device from
  // one a reconfigure has opened since: a running device is not the one that failed.
  deviceRunning_.store(false, std::memory_order_release);
  std::lock_guard<std::mutex> lock(errorMutex_);
  lastError_ = message;
}

void Engine::failDevice(const std::string& message) {
  {
    std::lock_guard<std::mutex> lock(errorMutex_);
    lastError_ = message;
  }
  Event event;
  event.kind = Event::Error;
  copyStr(event.code, sizeof(event.code), "device");
  copyStr(event.message, sizeof(event.message), message);
  event.atMs = clockMs();
  if (eventCallback_) eventCallback_(event);
}

bool initBackendContext(const std::string& backend, ma_context& context, ma_backend& resolved,
                        std::string& reason) {
  std::vector<ma_backend> candidates;
  if (backend == "auto") {
    candidates = defaultBackends();
  } else {
    // ASIO is the one backend that can be missing from a build entirely: the SDK it needs
    // cannot be shipped with this source, so a build without it refuses by name and says
    // why, rather than reporting that no backend could be initialised.
    if (backend == "asio") {
#if !defined(CUERUNNER_ASIO)
      reason = "this engine was built without ASIO support (the Steinberg ASIO SDK was not present at build time)";
      return false;
#endif
    }
    ma_backend forced;
    if (!parseBackendName(backend, forced)) {
      reason = "unknown audio backend '" + backend + "'";
      return false;
    }
    candidates = {forced};
  }
  bool ready = false;
  for (ma_backend candidate : candidates) {
    ma_backend list[1] = {candidate};
    ma_context_config config = ma_context_config_init();
#if defined(CUERUNNER_ASIO)
    if (candidate == ma_backend_custom) {
      // The custom hook is how a backend with its own driver arrives: miniaudio knows the
      // device model, the backend knows ASIO — including which COM apartment a driver can be
      // created in, which is not the one this thread is in (see DriverThread in
      // asio_backend.cpp), so nothing here has to be done in any particular order.
      config.custom = asio::backendCallbacks();
    }
#endif
    const ma_result result = ma_context_init(list, 1, &config, &context);
    if (result == MA_SUCCESS) {
      resolved = candidate;
      ready = true;
      break;
    }
    reason = backendNameOf(candidate) + ": " + maResultText(result);
  }
  return ready;
}

bool Engine::startDevice(EngineError& error) {
  auto state = std::make_unique<DeviceState>();
  std::string lastReason;

  if (!initBackendContext(options_.backend, state->context, state->backend, lastReason)) {
    error = {"device", "no audio backend could be initialised (" + lastReason + ")"};
    return false;
  }
  state->backendName = backendNameOf(state->backend);
  state->contextReady = true;

  ma_device_id deviceId{};
  const ma_device_id* pDeviceId = nullptr;
  bool haveRequestedId = false;
  if (!options_.deviceId.empty() && options_.deviceId != "default") {
    // Enumerate so the id string resolves to the backend's id struct.
    ma_device_info* playbackInfos = nullptr;
    ma_uint32 playbackCount = 0;
    ma_device_info* captureInfos = nullptr;
    ma_uint32 captureCount = 0;
    if (ma_context_get_devices(&state->context, &playbackInfos, &playbackCount, &captureInfos, &captureCount) ==
        MA_SUCCESS) {
      for (ma_uint32 i = 0; i < playbackCount; i++) {
        const std::string id = deviceIdToString(playbackInfos[i].id, state->backend);
        state->ids[id] = playbackInfos[i].id;
        if (id == options_.deviceId) {
          deviceId = playbackInfos[i].id;
          haveRequestedId = true;
        }
      }
    }
    if (!haveRequestedId) {
      ma_context_uninit(&state->context);
      error = {"device", "requested audio device '" + options_.deviceId + "' was not found"};
      return false;
    }
    pDeviceId = &deviceId;
  }

  ma_device_config config = ma_device_config_init(ma_device_type_playback);
  config.playback.pDeviceID = pDeviceId;
  config.playback.format = ma_format_f32;
  config.playback.channels = options_.channels > 0 ? static_cast<ma_uint32>(options_.channels) : 0;
  config.playback.shareMode = options_.exclusive ? ma_share_mode_exclusive : ma_share_mode_shared;
  config.sampleRate = options_.sampleRate > 0 ? static_cast<ma_uint32>(options_.sampleRate) : 0;
  config.periodSizeInFrames = options_.bufferFrames > 0 ? static_cast<ma_uint32>(options_.bufferFrames) : 0;
  config.periods = 3;
  config.performanceProfile = ma_performance_profile_low_latency;
  config.dataCallback = deviceDataCallback;
  config.notificationCallback = deviceNotificationCallback;
  config.pUserData = this;

  const ma_result result = ma_device_init(&state->context, &config, &state->device);
  if (result != MA_SUCCESS) {
    // A backend that knows why says so in its own words; miniaudio's generic result would
    // otherwise be all an operator sees.
    const std::string detail = backendDetail(*state);
    ma_context_uninit(&state->context);
    error = {"device", std::string("cannot open audio device") +
                          (options_.exclusive ? " in exclusive mode" : "") + ": " +
                          (detail.empty() ? maResultText(result) : detail)};
    return false;
  }
  state->deviceReady = true;

  char name[MA_MAX_DEVICE_NAME_LENGTH + 1] = {};
  if (ma_device_get_name(&state->device, ma_device_type_playback, name, sizeof(name), nullptr) != MA_SUCCESS) {
    copyStr(name, sizeof(name), "(default output)");
  }
  state->deviceName = name;
  state->sampleRate = static_cast<int>(state->device.sampleRate);
  state->channels = static_cast<int>(state->device.playback.channels);
  state->internalSampleRate = static_cast<int>(state->device.playback.internalSampleRate);
  state->format = formatNameOf(state->device.playback.format);
  state->internalFormat = formatNameOf(state->device.playback.internalFormat);
  state->exclusive = options_.exclusive;
  const int periodFrames = static_cast<int>(state->device.playback.internalPeriodSizeInFrames);
  const int periods = static_cast<int>(state->device.playback.internalPeriods);
  state->periodFrames = periodFrames > 0 ? periodFrames : -1;
  state->bufferFrames = periodFrames > 0 && periods > 0 ? periodFrames * periods : -1;
#if defined(MA_HAS_WASAPI)
  if (state->backend == ma_backend_wasapi) {
    const ma_uint32 actual = state->device.wasapi.actualBufferSizeInFramesPlayback;
    if (actual > 0) state->bufferFrames = static_cast<int>(actual);
  }
#endif
#if defined(CUERUNNER_ASIO)
  if (state->backend == ma_backend_custom) {
    // ASIO is exclusive by construction: the driver is held for as long as the stream
    // runs, and no other application can open it meanwhile. The request that means
    // "exclusive" on WASAPI has nothing to add here, and the readout says what is true.
    state->exclusive = true;
    // ASIO is the one backend whose driver states its own latency, in samples, from what
    // it knows about its hardware rather than from the period size we asked for.
    state->reportedLatencyMs = asio::contextLatencyMs(state->context);
    state->backendNote = asio::contextNote(state->context);
  }
#endif
  ma_device_info runningInfo{};
  if (ma_device_get_info(&state->device, ma_device_type_playback, &runningInfo) == MA_SUCCESS) {
    state->deviceId = deviceIdToString(runningInfo.id, state->backend);
  } else if (haveRequestedId) {
    state->deviceId = options_.deviceId;
  } else {
    state->deviceId.clear();
  }

  mixer_.configure(state->channels, state->sampleRate);
  renderScratch_.assign(static_cast<size_t>(kMaxOutputFrames) * static_cast<size_t>(state->channels), 0.0f);

  const ma_result startResult = ma_device_start(&state->device);
  if (startResult != MA_SUCCESS) {
    const std::string detail = backendDetail(*state);
    ma_device_uninit(&state->device);
    ma_context_uninit(&state->context);
    error = {"device", std::string("cannot start audio device: ") +
                          (detail.empty() ? maResultText(startResult) : detail)};
    return false;
  }

  device_ = std::move(state);
  deviceRunning_.store(true, std::memory_order_release);
  return true;
}

bool Engine::startSilent(EngineError& error) {
  const int channels = options_.channels > 0 ? options_.channels : 2;
  mixer_.configure(channels, options_.sampleRate);
  silentScratch_.assign(static_cast<size_t>(kMaxOutputFrames) * static_cast<size_t>(channels), 0.0f);
  error = {};
  return true;
}

void Engine::stopAudioThreads() {
  if (device_ != nullptr) {
    deviceRunning_.store(false, std::memory_order_release);
    noteDeliberateStop(true);
    if (device_->deviceReady) {
      ma_device_stop(&device_->device);
      ma_device_uninit(&device_->device);
    }
    if (device_->contextReady) ma_context_uninit(&device_->context);
    device_.reset();
    noteDeliberateStop(false);
  }
}

bool Engine::start(const EngineOptions& options, EngineError& error) {
  if (running_.load()) return true;
  options_ = options;
  cache_.configure(options_.cacheMaxBytes, options_.cacheMaxFiles, options_.cacheMaxFileBytes);

  if (options_.backend == "offline") {
    const int channels = options_.channels > 0 ? options_.channels : 2;
    mixer_.configure(channels, options_.sampleRate);
    renderScratch_.assign(static_cast<size_t>(kMaxOutputFrames) * static_cast<size_t>(channels), 0.0f);
    running_.store(true, std::memory_order_release);
    return true;
  }

  if (options_.backend == "silent") {
    if (!startSilent(error)) return false;
    silentStop_.store(false, std::memory_order_relaxed);
    silent_ = std::thread([this] { silentLoop(); });
    silentStarted_ = true;
  } else {
    if (!startDevice(error)) return false;
    deviceStarted_ = true;
  }

  restartCapture();

  if (options_.backend != "offline") {
    backgroundStop_.store(false, std::memory_order_relaxed);
    background_ = std::thread([this] { backgroundLoop(); });
  }
  running_.store(true, std::memory_order_release);
  return true;
}

void Engine::stop() {
  const bool wasRunning = running_.exchange(false, std::memory_order_acq_rel);
  if (!wasRunning && !background_.joinable() && !silent_.joinable()) {
    stopAudioThreads();
    return;
  }
  backgroundStop_.store(true, std::memory_order_release);
  if (background_.joinable()) background_.join();
  silentStop_.store(true, std::memory_order_release);
  if (silent_.joinable()) silent_.join();
  silentStarted_ = false;
  capture_.stop();
  stopAudioThreads();
  deviceStarted_ = false;
  {
    std::lock_guard<std::mutex> lock(ackMutex_);
    ackCv_.notify_all();
  }
  streams_.closeAll();
  mixer_.reset();
}

void Engine::backgroundLoop() {
  int tick = 0;
  while (!backgroundStop_.load(std::memory_order_acquire)) {
    handleBackgroundWork();
    if ((tick++ % 100) == 0) cache_.maintain();
    sleepMs(kBackgroundTickMs);
  }
  handleBackgroundWork();
}

// Some backends report a genuine loss only by leaving the started state (miniaudio
// deliberately posts no notification when the underlying stream dies on its own), so the
// service loop checks the device state as well. It never blocks on deviceMutex_: a
// reconfigure holds that lock while it waits for a command ack this same thread resolves.
void Engine::checkDeviceHealth() {
  if (!deviceRunning_.load(std::memory_order_acquire)) return;
  if (expectedDeviceStop_.load(std::memory_order_acquire)) return;
  std::string restartReason;
  {
    std::unique_lock<std::mutex> lock(deviceMutex_, std::try_to_lock);
    if (!lock.owns_lock()) return;
    if (device_ == nullptr || !device_->deviceReady) return;
    const ma_device_state state = ma_device_get_state(&device_->device);
    if (state == ma_device_state_stopped || state == ma_device_state_stopping) {
      deviceRunning_.store(false, std::memory_order_release);
      failDeviceFromCallback("audio device stopped unexpectedly");
      return;
    }
#if defined(CUERUNNER_ASIO)
    if (device_->backend == ma_backend_custom) {
      // An ASIO driver whose hardware went away stops calling back without saying so, so
      // silence is the only evidence there is — and it is enough: this backend is either
      // rendering blocks or it is not.
      if (asio::contextStalled(device_->context)) {
        deviceRunning_.store(false, std::memory_order_release);
        failDeviceFromCallback(asio::contextMessage(device_->context));
        return;
      }
      // Blocks the driver itself caught are the same fact as an xrun measured here, from
      // the one side that can see the hardware's deadline.
      const uint64_t reported = asio::takeDropouts(device_->context);
      if (reported > 0) xruns_.fetch_add(reported, std::memory_order_relaxed);
      asio::takeRestartRequest(device_->context, restartReason);
    }
#endif
  }
  // Outside the lock: reopening the device takes it again, and this is the one place that
  // knows a driver asked for its stream to be rebuilt.
  if (!restartReason.empty()) reopenAfterBackendRequest(restartReason);
}

void Engine::handleBackgroundWork() {
  // A drain the device lock refused is tried again on every tick. A reader that held the
  // lock for a moment must not cost the desk the ends the loss owes it, and the drain
  // itself skips a device a reconfigure has opened in the meantime.
  if (drainPending_.load(std::memory_order_acquire)) {
    drainPending_.store(!drainLostDevice(), std::memory_order_release);
  }
  if (deviceFailed_.load(std::memory_order_acquire)) {
    deviceFailed_.store(false, std::memory_order_release);
    std::string message;
    {
      std::lock_guard<std::mutex> lock(errorMutex_);
      message = lastError_.empty() ? std::string("audio device failed") : lastError_;
    }
    failDevice(message);
    // Ack-free on purpose: this is the service thread, and it is the only thread that
    // resolves acknowledgements. submitCommand here would wait the full ack timeout for
    // an answer queued unread behind it in the event loop below, stalling every other
    // command's acknowledgement with it. The render thread applies this in queue order —
    // and the reason is the loss's own: what this panic ends was not stopped, it was
    // lost, which is what the renderer's `device-lost` handling is for.
    Command command;
    command.kind = Command::Panic;
    command.fadeMs = 0.0;
    command.reason = EndReason::DeviceLost;
    submitInternalCommand(command);
    // The device that failed may never render again, and an ended line that waits on a
    // thread that is gone is a show left reading as playing. Where this thread can prove
    // nothing else will render — it ends the stream itself, the reopen's own precedent —
    // it applies the queue, so the loss reaches the desk from inside this tick.
    drainPending_.store(!drainLostDevice(), std::memory_order_release);
  }

  // Acks first, then the file work. A command's acknowledgement is a promise to the
  // connection thread, which is waiting on it with a deadline, and everything below can
  // take real time: a stream fill decodes, and a reposition inside one decodes forward
  // to its target. An ack queued before that work starts is answered before it starts —
  // a start that is already audible is not reported as one that never arrived.
  Event event;
  while (events_.pop(event)) {
    if (event.kind == Event::Ack) {
      resolveAck(event);
      continue;
    }
    if (eventCallback_) eventCallback_(event);
  }

  ReclaimItem item;
  while (reclaim_.pop(item)) {
    if (item.cacheEntry != nullptr) cache_.release(static_cast<CacheEntry*>(item.cacheEntry));
    if (item.streamSlot >= 0) streams_.release(item.streamSlot);
  }
  streams_.fillAll();

  // The state check is cheap but not free; a hundred milliseconds of latency on a device
  // that has already gone is plenty.
  if ((healthTick_++ % 50) == 0) checkDeviceHealth();
}

/**
 * Applies the command queue on the service thread, once the device it belongs to can no
 * longer render it.
 *
 * A device the engine has lost is one whose render thread is gone: miniaudio's worker
 * left its loop, or an ASIO driver stopped calling back and nothing else calls the mixer
 * at all. The failure's panic — and anything else queued behind it — would then sit in
 * the queue until something opened a device again, and the voices it ends would stay
 * published as playing. A reconnect replies to the same situation by stopping the old
 * device and draining the queue itself; this is that precedent where the device is gone
 * rather than replaced, and the stop is what makes it legal: `ma_device_stop` returns
 * from the driver's own stop for ASIO (which is the driver's promise that the callback
 * has finished and will not come back) and only after miniaudio's worker has left its
 * loop for every other backend, so nothing is left that could pop this single-consumer
 * queue or touch the mixer beside this thread.
 *
 * Returns false when the device lock was held — a reader is in `info()` for a moment, or
 * a reconfigure is replacing the device — because that is a wait this thread may not take
 * (a reconfigure waits for an acknowledgement only the service thread resolves). The
 * caller keeps `drainPending_` set and tries again on its next tick; a device a
 * reconfigure has since opened is skipped rather than stopped.
 *
 * A backend with no device to lose is not this path's business: the silent backend's loop
 * and the offline caller's pump are still running after a failure, and they apply the
 * queue themselves — the offline backend already did, where the panic was queued.
 */
bool Engine::drainLostDevice() {
  if (options_.backend == "silent" || options_.backend == "offline") return true;
  std::unique_lock<std::mutex> lock(deviceMutex_, std::try_to_lock);
  // The lock is held by a reader for a moment, or by a reconfigure that is replacing the
  // device. Neither is a wait this thread may take (a reconfigure waits on an
  // acknowledgement only this thread resolves), so the drain reports that it did not run
  // and the next tick tries again.
  if (!lock.owns_lock()) return false;
  // A device is running: a reconfigure has opened one since the failure, and its own
  // stop-then-drain applied the queue this call owes — stopping what it opened would take
  // the show off a device that never failed.
  if (deviceRunning_.load(std::memory_order_acquire)) return true;
  // No device at all is the simplest form of "nothing will render this queue": the engine
  // was started with a device backend and has none open, so the queue is this thread's.
  if (device_ != nullptr) {
    noteDeliberateStop(true);
    if (device_->deviceReady) ma_device_stop(&device_->device);
    noteDeliberateStop(false);
  }
  applyQueuedCommands();
  // A client's start can land behind the panic in the same apply: the voice it made is
  // real to the mixer and nothing will ever render it, so it is ended here rather than
  // left published as playing with no end coming. Nothing else applies this queue while
  // this thread holds the device, so what this loop sees is what the apply left.
  mixer_.cancelUnstartedVoices();
  // Nothing will render what the apply left — this thread just ended the voices that were
  // playing a moment ago — so the published state is written here, the way a rendered
  // block writes it: `info()` and `progress()` read that snapshot, and on a device-backend
  // loss there is no block left to refresh it.
  mixer_.writeSnapshot(snapshot_, snapshotSeq_,
                       static_cast<double>(mixer_.clockFrames()) * 1000.0 /
                           static_cast<double>(mixer_.sampleRate()),
                       renderedFrames_.load(std::memory_order_relaxed));
  return true;
}

void Engine::resolveAck(const Event& event) {
  std::lock_guard<std::mutex> lock(ackMutex_);
  const auto waiting = acks_.find(event.ackId);
  // The sender erased its entry when it gave up (a timeout, or the engine stopping under
  // it). An answer is only ever owed to a waiter that is still there; keeping this one
  // would put an entry in the map that nothing will ever take out again.
  if (waiting == acks_.end()) return;
  AckResult& slot = waiting->second;
  slot.resolved = true;
  slot.applied = event.ackApplied;
  slot.canceled = event.ackCanceled;
  slot.voices = event.ackVoices;
  slot.state = event.state;
  slot.positionMs = event.ackPositionMs;
  ackCv_.notify_all();
}

bool Engine::submitCommand(Command& command, AckResult& ack, EngineError& error) {
  if (!running_.load(std::memory_order_acquire)) {
    error = {"engine", "audio engine is not running"};
    releaseCommandResources(command);
    return false;
  }
  const uint64_t ackId = nextAckId_.fetch_add(1, std::memory_order_relaxed) + 1;
  command.ackId = ackId;
  {
    // The entry is reserved before the command is queued, not created by the answer: the
    // render thread can apply a command and post its ack before this thread gets to wait,
    // and an ack that arrives first has to find the entry it belongs to.
    std::lock_guard<std::mutex> lock(ackMutex_);
    acks_[ackId] = AckResult{};
  }
  {
    std::lock_guard<std::mutex> lock(commandMutex_);
    if (!commands_.push(command)) {
      error = {"limit", "audio engine command queue is full"};
      releaseCommandResources(command);
      std::lock_guard<std::mutex> release(ackMutex_);
      acks_.erase(ackId);
      return false;
    }
  }

  if (options_.backend == "offline") {
    // Single-threaded mode: the caller owns the clock, so the queued command is applied
    // here and the service work runs here rather than on a background thread.
    applyQueuedCommands();
    handleBackgroundWork();
  }

  std::unique_lock<std::mutex> lock(ackMutex_);
  const bool arrived = ackCv_.wait_for(lock, std::chrono::milliseconds(kAckTimeoutMs), [&] {
    const auto waiting = acks_.find(ackId);
    return (waiting != acks_.end() && waiting->second.resolved) || !running_.load(std::memory_order_acquire);
  });
  const auto it = acks_.find(ackId);
  if (!arrived || it == acks_.end() || !it->second.resolved) {
    // The wait is over either way, so the entry goes with it: an answer that arrives
    // after this leaves no trace in the map, which is what keeps the acks a command
    // never received from accumulating for the life of the engine.
    if (it != acks_.end()) acks_.erase(it);
    error = {"engine", "audio engine did not acknowledge the command"};
    return false;
  }
  ack = it->second;
  acks_.erase(it);
  return true;
}

void Engine::submitInternalCommand(Command& command) {
  // ackId 0 is a command the render thread applies without answering (see Mixer::apply):
  // there is no waiter to wake and no entry for an answer to land in.
  command.ackId = 0;
  {
    std::lock_guard<std::mutex> lock(commandMutex_);
    if (!commands_.push(command)) {
      releaseCommandResources(command);
      logError("internal audio command dropped: the command queue is full");
      return;
    }
  }
  // Offline mode has neither a render thread nor a service thread: the caller's pump is
  // the only thing that applies commands, so this one is applied here, exactly as a
  // client command is in submitCommand.
  if (options_.backend == "offline") applyQueuedCommands();
}

void Engine::applyQueuedCommands() {
  Command command;
  while (commands_.pop(command)) mixer_.apply(command);
}

void Engine::releaseCommandResources(Command& command) {
  if (command.cacheEntry != nullptr) cache_.release(static_cast<CacheEntry*>(command.cacheEntry));
  if (command.streamSlot >= 0) streams_.release(command.streamSlot);
  command.cacheEntry = nullptr;
  command.streamSlot = -1;
}

void Engine::silentLoop() {
  const int channels = mixer_.channels();
  const int block = std::max(64, options_.bufferFrames);
  silentScratch_.assign(static_cast<size_t>(block) * static_cast<size_t>(channels), 0.0f);
  const double blockMs = 1000.0 * static_cast<double>(block) / static_cast<double>(mixer_.sampleRate());
  double next = steadyNowMs() + blockMs;
  while (!silentStop_.load(std::memory_order_acquire)) {
    renderAudio(silentScratch_.data(), block);
    const double now = steadyNowMs();
    // A real device consumes frames in real time whatever the engine is doing, and this
    // loop stands in for that device: the deadline advances by exactly one block however
    // late the machine made the iteration, so a starved pacer renders the blocks it owes
    // until it is back in phase. Rebasing the deadline to `now` after a late iteration —
    // what this used to do — threw that wall time away for good, and the show clock, which
    // only advances with rendered frames, ran slow with it: a cue's 3000 ms wait then took
    // 5-9 s of wall time on a contended runner.
    if (next > now) sleepMs(next - now);
    next += blockMs;
  }
}

void Engine::renderAudio(float* out, int frames) {
  if (frames <= 0) return;
  const double startedMs = steadyNowMs();
  const int channels = mixer_.channels();
  int remaining = frames;
  float* target = out;
  while (remaining > 0) {
    const int chunk = std::min(remaining, kMaxOutputFrames);
    std::memset(target, 0, static_cast<size_t>(chunk) * static_cast<size_t>(channels) * sizeof(float));
    Command command;
    while (commands_.pop(command)) mixer_.apply(command);
    mixer_.render(target, chunk, channels);
    mixer_.advanceClock(chunk);
    if (capture_.active()) capture_.write(target, chunk);
    renderedFrames_.fetch_add(static_cast<uint64_t>(chunk), std::memory_order_relaxed);
    target += static_cast<size_t>(chunk) * static_cast<size_t>(channels);
    remaining -= chunk;
  }
  const double blockMs = 1000.0 * static_cast<double>(frames) / static_cast<double>(mixer_.sampleRate());
  if (steadyNowMs() - startedMs > blockMs) xruns_.fetch_add(1, std::memory_order_relaxed);
  mixer_.writeSnapshot(snapshot_, snapshotSeq_,
                       static_cast<double>(mixer_.clockFrames()) * 1000.0 / static_cast<double>(mixer_.sampleRate()),
                       renderedFrames_.load(std::memory_order_relaxed));
}

void Engine::renderOfflineBlock(float* out, int frames) { renderAudio(out, frames); }

void Engine::pump() { handleBackgroundWork(); }

double Engine::snapshotClockMs() const {
  for (;;) {
    const uint32_t first = snapshotSeq_.load(std::memory_order_acquire);
    if ((first & 1u) != 0u) continue;
    const double value = snapshot_.clockMs;
    const uint32_t second = snapshotSeq_.load(std::memory_order_acquire);
    if (first == second) return value;
  }
}

void Engine::copySnapshot(MixSnapshot& out) const {
  for (;;) {
    const uint32_t first = snapshotSeq_.load(std::memory_order_acquire);
    if ((first & 1u) != 0u) continue;
    out = snapshot_;
    const uint32_t second = snapshotSeq_.load(std::memory_order_acquire);
    if (first == second) return;
  }
}

double Engine::clockMs() const { return snapshotClockMs(); }

bool Engine::prepare(const std::string& cueId, const std::string& filePath, PrepareDTO& out, EngineError& error) {
  if (cueId.empty() || cueId.size() >= kMaxCueIdLen) {
    error = {"invalid", "missing or over-long cue id"};
    return false;
  }
  std::string openError;
  SourceError openCode = SourceError::None;
  std::unique_ptr<Source> probe = openSource(filePath, openError, &openCode);
  if (probe == nullptr) {
    error = {openCode == SourceError::DecoderUnavailable ? "format-unavailable" : "decode", openError};
    return false;
  }
  SourceInfo info = probe->info();
  probe.reset();

  bool streaming = false;
  bool cacheHit = false;
  int64_t decodedBytes = 0;
  const int64_t estimatedBytes =
      info.frames >= 0 ? info.frames * static_cast<int64_t>(info.channels) * 4 : -1;
  if (estimatedBytes < 0) {
    // The length is not stated, so the decoded size cannot be known without decoding the
    // whole thing first. Streaming is the only honest decision at this point.
    streaming = true;
    cache_.noteBypass();
  } else if (estimatedBytes > options_.cacheMaxFileBytes) {
    streaming = true;
    cache_.noteBypass();
  } else {
    bool bypassed = false;
    std::string cacheError;
    CacheEntry* entry = cache_.pin(filePath, cacheHit, bypassed, cacheError);
    if (entry != nullptr) {
      decodedBytes = entry->decodedBytes;
      info = entry->info;
      cache_.release(entry);
    } else if (bypassed) {
      streaming = true;
    } else {
      error = {"decode", cacheError.empty() ? std::string("could not decode media file") : cacheError};
      return false;
    }
  }

  {
    std::lock_guard<std::mutex> lock(prepareMutex_);
    PreparedFile& prepared = prepared_[cueId];
    prepared.path = filePath;
    prepared.info = info;
    prepared.streaming = streaming;
  }

  out.cueId = cueId;
  out.filePath = filePath;
  out.format = formatName(info.format);
  out.sampleRate = info.sampleRate;
  out.channels = info.channels;
  out.frames = info.frames;
  out.fileBytes = info.fileBytes;
  out.durationMs = info.sampleRate > 0 && info.frames >= 0
                       ? static_cast<double>(info.frames) * 1000.0 / static_cast<double>(info.sampleRate)
                       : 0.0;
  out.streaming = streaming;
  out.cacheHit = cacheHit;
  out.decodedBytes = decodedBytes;
  return true;
}

bool Engine::probe(const std::string& filePath, ProbeDTO& out, EngineError& error) {
  // Container headers only. A workspace footprint must be cheap enough to ask about every
  // cue in the show, and must not fill, pin, evict or count anything in the cache.
  std::string openError;
  SourceError openCode = SourceError::None;
  std::unique_ptr<Source> source = openSource(filePath, openError, &openCode);
  if (source == nullptr) {
    error = {openCode == SourceError::DecoderUnavailable ? "format-unavailable" : "decode", openError};
    return false;
  }
  const SourceInfo info = source->info();

  out.filePath = filePath;
  out.format = formatName(info.format);
  out.sampleRate = info.sampleRate;
  out.channels = info.channels;
  out.frames = info.frames;
  out.fileBytes = info.fileBytes;
  out.durationMs = info.sampleRate > 0 && info.frames >= 0
                       ? static_cast<double>(info.frames) * 1000.0 / static_cast<double>(info.sampleRate)
                       : 0.0;
  if (info.frames >= 0 && info.channels > 0) {
    out.decodedBytes = info.frames * static_cast<int64_t>(info.channels) * 4;
    out.streaming = out.decodedBytes > options_.cacheMaxFileBytes;
  } else {
    out.decodedBytes = -1;
    out.streaming = true;  // an unknown length always streams: it can never be sized
  }
  out.resident = cache_.isResident(filePath);
  return true;
}

bool Engine::startCue(const std::string& cueId, double whenMs, const StartOptions& options, StartResultDTO& out,
                      EngineError& error) {
  if (cueId.empty() || cueId.size() >= kMaxCueIdLen) {
    error = {"invalid", "missing or over-long cue id"};
    return false;
  }
  if (!finiteNumber(whenMs) || !finiteNumber(options.rate) || !finiteNumber(options.volume) ||
      !finiteNumber(options.pan) || !finiteNumber(options.trim) || !finiteNumber(options.startTimeMs) ||
      !finiteNumber(options.fadeInMs) || (options.endTimeMs >= 0.0 && !finiteNumber(options.endTimeMs))) {
    error = {"invalid", "start options contain a non-finite value"};
    return false;
  }
  if (options.rate <= 0.0) {
    error = {"invalid", "playback rate must be greater than zero"};
    return false;
  }
  if (options.loopCount < -1) {
    error = {"invalid", "loop count must be -1 or greater"};
    return false;
  }
  if (options.crosspointCount < 0 || options.crosspointCount > kMaxCrosspoints) {
    error = {"invalid", "too many crosspoints"};
    return false;
  }
  if (options.startTimeMs < 0.0) {
    error = {"invalid", "start time cannot be negative"};
    return false;
  }

  PreparedFile file;
  {
    std::lock_guard<std::mutex> lock(prepareMutex_);
    const auto it = prepared_.find(cueId);
    if (it == prepared_.end()) {
      error = {"not-prepared", "cue has no prepared media (call prepare first)"};
      return false;
    }
    file = it->second;
  }

  Command command;
  command.kind = Command::Start;
  copyStr(command.cueId, sizeof(command.cueId), cueId);
  command.whenMs = whenMs;
  command.options = options;
  for (int i = 0; i < options.crosspointCount; i++) {
    const Crosspoint& point = options.crosspoints[i];
    if (point.inputChannel < 0 || point.inputChannel >= file.info.channels || point.outputChannel < 0 ||
        point.outputChannel >= kMaxOutputChannels || !finiteNumber(point.gain)) {
      error = {"invalid", "crosspoint is outside the media or device channel range"};
      return false;
    }
  }

  bool cacheHit = false;
  bool bypassed = file.streaming;
  std::string decodeError;
  CacheEntry* entry = file.streaming ? nullptr : cache_.pin(file.path, cacheHit, bypassed, decodeError);
  if (entry != nullptr) {
    command.cacheEntry = entry;
    command.cacheFrames = entry->frames;
    command.cacheChannels = entry->channels;
    command.cacheSampleRate = entry->sampleRate;
  } else if (bypassed) {
    SourceInfo info;
    std::string streamError;
    StreamRefusal refusal = StreamRefusal::None;
    const int slot = streams_.acquire(file.path, options_.streamPrerollMs, options_.streamMaxBytesPerVoice,
                                      options_.streamMaxTotalBytes, refusal, streamError, info);
    if (slot < 0) {
      // The declared total budget refuses with its own code; anything else that stopped
      // the open keeps the `decode` the wire has always answered it with.
      error = {refusal == StreamRefusal::Limit ? "limit" : "decode", streamError};
      return false;
    }
    command.streamSlot = slot;
    command.cacheFrames = info.frames;
    command.cacheChannels = info.channels;
    command.cacheSampleRate = info.sampleRate;
  } else {
    error = {"decode", decodeError.empty() ? std::string("could not open media file") : decodeError};
    return false;
  }

  const unsigned long long runNumber = nextRunId_.fetch_add(1, std::memory_order_relaxed);
  std::snprintf(command.runId, sizeof(command.runId), "run-%llu", runNumber);

  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  if (!ack.applied) {
    error = {"limit", "no free voice for this cue"};
    return false;
  }

  out.cueId = cueId;
  out.runId = command.runId;
  out.state = ack.state == static_cast<int>(VoiceState::Scheduled) ? "scheduled" : "playing";
  out.startAtMs = std::max(whenMs, clockMs());
  return true;
}

bool Engine::stopCue(const std::string& cueId, double fadeMs, double whenMs, CommandResultDTO& out, EngineError& error) {
  if (!finiteNumber(fadeMs) || fadeMs < 0.0 || !finiteNumber(whenMs)) {
    error = {"invalid", "stop needs a non-negative fade"};
    return false;
  }
  Command command;
  command.kind = Command::Stop;
  copyStr(command.cueId, sizeof(command.cueId), cueId);
  command.fadeMs = fadeMs;
  command.whenMs = whenMs;
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.applied = ack.applied;
  return true;
}

bool Engine::stopAll(double fadeMs, CommandResultDTO& out, EngineError& error) {
  if (!finiteNumber(fadeMs) || fadeMs < 0.0) {
    error = {"invalid", "stop needs a non-negative fade"};
    return false;
  }
  Command command;
  command.kind = Command::StopAll;
  command.fadeMs = fadeMs;
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.applied = ack.applied;
  return true;
}

bool Engine::seekCue(const std::string& cueId, double positionMs, double whenMs, SeekResultDTO& out,
                     EngineError& error) {
  if (!finiteNumber(positionMs) || positionMs < 0.0 || !finiteNumber(whenMs)) {
    error = {"invalid", "seek needs a non-negative position"};
    return false;
  }
  Command command;
  command.kind = Command::Seek;
  copyStr(command.cueId, sizeof(command.cueId), cueId);
  command.positionMs = positionMs;
  command.whenMs = whenMs;
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.positionMs = ack.positionMs;
  out.state = ack.applied ? "playing" : "stopped";
  if (ack.applied && ack.state == static_cast<int>(VoiceState::Scheduled)) out.state = "scheduled";
  if (ack.applied && ack.state == static_cast<int>(VoiceState::Fading)) out.state = "fading";
  return true;
}

/**
 * Ends a voice's loop and plays it out to the end of the file — or to `endMs` when one
 * is named, which is where a cue trimmed of its trailing silence stops hearing the file.
 *
 * The whole verb is the one transition a vamp needs: the voice keeps its position, its
 * gain envelope and its routing, and only the region it is allowed to play changes — so
 * the release is heard as the music continuing, not as a splice. A voice whose file has
 * no known length has no end to play out to, and a voice that is not looping is not
 * vamping, so neither is released; the caller is told which it got.
 */
bool Engine::releaseCue(const std::string& cueId, double whenMs, bool hasEnd, double endMs, CommandResultDTO& out,
                        EngineError& error) {
  if (!finiteNumber(whenMs)) {
    error = {"invalid", "release needs a finite time"};
    return false;
  }
  if (hasEnd && !finiteNumber(endMs)) {
    error = {"invalid", "release needs a finite end"};
    return false;
  }
  Command command;
  command.kind = Command::Release;
  copyStr(command.cueId, sizeof(command.cueId), cueId);
  command.whenMs = whenMs;
  command.hasEndMs = hasEnd;
  command.endMs = endMs;
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.applied = ack.applied;
  return true;
}

bool Engine::cancelCue(const std::string& cueId, double whenMs, CancelResultDTO& out, EngineError& error) {
  if (!finiteNumber(whenMs)) {
    error = {"invalid", "cancel needs a finite time"};
    return false;
  }
  Command command;
  command.kind = Command::Cancel;
  copyStr(command.cueId, sizeof(command.cueId), cueId);
  command.whenMs = whenMs;
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.canceled = ack.canceled;
  return true;
}

bool Engine::fadeCue(const std::string& cueId, int param, double value, double durationMs, int curve, double whenMs,
                     CommandResultDTO& out, EngineError& error) {
  if (param < 0 || param >= kMaxRampParams) {
    error = {"invalid", "unknown fade parameter"};
    return false;
  }
  if (!finiteNumber(value) || !finiteNumber(durationMs) || durationMs < 0.0 || !finiteNumber(whenMs)) {
    error = {"invalid", "fade needs finite, non-negative arguments"};
    return false;
  }
  if (param == static_cast<int>(Param::Rate) && value <= 0.0) {
    error = {"invalid", "rate must be greater than zero"};
    return false;
  }
  if (curve < 0 || curve > 2) {
    error = {"invalid", "unknown fade curve"};
    return false;
  }
  Command command;
  command.kind = Command::Fade;
  copyStr(command.cueId, sizeof(command.cueId), cueId);
  command.param = static_cast<Param>(param);
  command.value = value;
  command.durationMs = durationMs;
  command.curve = static_cast<Curve>(curve);
  command.whenMs = whenMs;
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.applied = ack.applied;
  return true;
}

bool Engine::routeCue(const std::string& cueId, bool automatic, const std::vector<Crosspoint>& points,
                      CommandResultDTO& out, EngineError& error) {
  if (points.size() > static_cast<size_t>(kMaxCrosspoints)) {
    error = {"invalid", "too many crosspoints"};
    return false;
  }
  PreparedFile file;
  {
    std::lock_guard<std::mutex> lock(prepareMutex_);
    const auto it = prepared_.find(cueId);
    if (it != prepared_.end()) file = it->second;
  }
  for (const Crosspoint& point : points) {
    if (point.outputChannel < 0 || point.outputChannel >= kMaxOutputChannels || point.inputChannel < 0 ||
        !finiteNumber(point.gain)) {
      error = {"invalid", "crosspoint is out of range"};
      return false;
    }
    if (file.info.channels > 0 && point.inputChannel >= file.info.channels) {
      error = {"invalid", "crosspoint input channel is outside the media"};
      return false;
    }
  }
  Command command;
  command.kind = Command::Routing;
  copyStr(command.cueId, sizeof(command.cueId), cueId);
  command.routingAutomatic = automatic;
  command.routingCount = static_cast<int>(points.size());
  for (size_t i = 0; i < points.size(); i++) command.routing[i] = points[i];
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.applied = ack.applied;
  return true;
}

bool Engine::panic(double fadeMs, PanicResultDTO& out, EngineError& error) {
  if (!finiteNumber(fadeMs) || fadeMs < 0.0) {
    error = {"invalid", "panic needs a non-negative fade"};
    return false;
  }
  Command command;
  command.kind = Command::Panic;
  command.fadeMs = fadeMs;
  AckResult ack;
  if (!submitCommand(command, ack, error)) return false;
  out.atMs = clockMs();
  out.stoppedVoices = ack.voices;
  return true;
}

bool Engine::progress(const std::string& cueId, VoiceSnapshot& out, bool& found) const {
  MixSnapshot snapshot;
  copySnapshot(snapshot);
  found = false;
  for (int i = 0; i < snapshot.voiceCount; i++) {
    if (cueId == snapshot.voices[i].cueId) {
      out = snapshot.voices[i];
      found = true;
      return true;
    }
  }
  return true;
}

InfoDTO Engine::info() const {
  std::lock_guard<std::mutex> lock(deviceMutex_);
  InfoDTO out;
  out.version = kEngineVersion;
  out.protocol = options_.declaredProtocol;
  out.sessionId = sessionId_;
  MixSnapshot snapshot;
  copySnapshot(snapshot);
  out.active = snapshot.active;
  out.activeVoices = snapshot.activeVoices;
  for (int i = 0; i < snapshot.voiceCount; i++) out.activeCues.push_back(snapshot.voices[i]);
  out.cache = cache_.stats();
  const CacheStats stats = out.cache;
  out.residentBytes = stats.bytes + streams_.residentBytes();
  out.streamingVoices = snapshot.streamingVoices;
  out.streamBufferBytes = streams_.residentBytes();
  out.streamBufferLimitBytes = options_.streamMaxTotalBytes;
  const int64_t streamBytes = streams_.residentBytes();
  out.decodeQueueDepth = streams_.activeStreams();
  out.decodeUnderruns = decodeUnderruns_.load() + static_cast<uint64_t>(mixer_.underruns());
  out.xruns = xruns_.load();
  out.droppedChunks = droppedChunks_.load();
  {
    std::lock_guard<std::mutex> lock(errorMutex_);
    out.lastError = lastError_;
  }

  if (device_ != nullptr) {
    out.backend = device_->backendName;
    out.deviceId = device_->deviceId;
    out.deviceName = device_->deviceName;
    out.sampleRate = device_->sampleRate;
    out.channels = device_->channels;
    out.format = device_->format;
    out.exclusive = device_->exclusive;
    out.bufferFrames = device_->bufferFrames;
    out.periodFrames = device_->periodFrames;
#if defined(CUERUNNER_ASIO)
    // ASIO states its own latency and can restate it mid-session (kAsioLatenciesChanged),
    // which the open-time snapshot would miss for the rest of the show: ask the live
    // context on every readout, falling back to the snapshot when the driver will not say.
    const double liveLatencyMs =
        (device_->backend == ma_backend_custom) ? asio::contextLatencyMs(device_->context) : -1.0;
    const double driverLatencyMs = liveLatencyMs > 0.0 ? liveLatencyMs : device_->reportedLatencyMs;
#else
    const double driverLatencyMs = device_->reportedLatencyMs;
#endif
    if (driverLatencyMs > 0.0) {
      out.latencyMs = driverLatencyMs;
      out.latencySource = "driver";
    } else if (device_->periodFrames > 0 && device_->internalSampleRate > 0) {
      const double periods = device_->bufferFrames > 0 ? static_cast<double>(device_->bufferFrames) /
                                                             static_cast<double>(device_->periodFrames)
                                                       : 1.0;
      out.latencyMs = static_cast<double>(device_->periodFrames) * periods * 1000.0 /
                      static_cast<double>(device_->internalSampleRate);
      out.latencySource = "estimated";
    } else {
      out.latencyMs = -1.0;
      out.latencySource = "unknown";
    }
    if (device_->internalSampleRate != device_->sampleRate && device_->internalSampleRate > 0) {
      out.warnings.push_back("device runs at " + std::to_string(device_->internalSampleRate) +
                             " Hz; the engine resamples from " + std::to_string(device_->sampleRate) + " Hz");
    }
    if (!device_->backendNote.empty()) out.warnings.push_back(device_->backendNote);
  } else if (options_.backend == "silent") {
    out.backend = "silent";
    out.deviceName = "(silent backend - no device I/O)";
    out.sampleRate = mixer_.sampleRate();
    out.channels = mixer_.channels();
    out.latencyMs = -1.0;
    out.latencySource = "unknown";
    out.warnings.push_back("no audio device: the silent backend is running (explicit opt-in)");
  } else {
    out.backend = "none";
    out.sampleRate = mixer_.sampleRate();
    out.channels = mixer_.channels();
    out.latencyMs = -1.0;
    out.latencySource = "unknown";
  }

  if (out.streamingVoices > 0 && options_.streamMaxTotalBytes > 0 &&
      streamBytes * 4 > options_.streamMaxTotalBytes * 3) {
    out.warnings.push_back("streaming pre-roll is using " + std::to_string(streamBytes / (1024 * 1024)) +
                           " MiB of the " + std::to_string(options_.streamMaxTotalBytes / (1024 * 1024)) +
                           " MiB budget");
  }
  if (out.decodeUnderruns > 0) {
    out.warnings.push_back("streaming underruns: " + std::to_string(out.decodeUnderruns) +
                           " (audio waited for the disk)");
  }
  if (out.xruns > 0) out.warnings.push_back("device callback xruns: " + std::to_string(out.xruns));
  if (out.droppedChunks > 0) out.warnings.push_back("dropped media chunks: " + std::to_string(out.droppedChunks));
  if (!out.lastError.empty()) out.warnings.push_back(out.lastError);
  if (device_ == nullptr && options_.backend != "silent" && options_.backend != "offline") {
    out.warnings.push_back("audio engine has no device");
  }
  return out;
}

bool Engine::devices(std::vector<DeviceDTO>& out, EngineError& error) const {
  out.clear();
  std::lock_guard<std::mutex> lock(deviceMutex_);
  if (options_.backend == "silent" || options_.backend == "offline") {
    error = {"device", "device enumeration is unavailable with the " + options_.backend + " backend"};
    return false;
  }

  // Enumeration must not require an open device: --list-devices and the settings
  // dialog both ask before anything is playing.
  ma_context temporary{};
  ma_context* context = nullptr;
  ma_backend resolved = ma_backend_null;
  if (device_ != nullptr && device_->contextReady) {
    context = &device_->context;
    resolved = device_->backend;
  } else {
    std::string reason;
    if (!initBackendContext(options_.backend, temporary, resolved, reason)) {
      error = {"device", "no audio backend could be initialised (" + reason + ")"};
      return false;
    }
    context = &temporary;
  }

  ma_device_info* playbackInfos = nullptr;
  ma_uint32 playbackCount = 0;
  ma_device_info* captureInfos = nullptr;
  ma_uint32 captureCount = 0;
  const ma_result result =
      ma_context_get_devices(context, &playbackInfos, &playbackCount, &captureInfos, &captureCount);
  if (result != MA_SUCCESS) {
    if (context == &temporary) ma_context_uninit(&temporary);
    error = {"device", std::string("cannot enumerate devices: ") + maResultText(result)};
    return false;
  }
  for (ma_uint32 i = 0; i < playbackCount; i++) {
    const ma_device_info& basic = playbackInfos[i];
    ma_device_info detailed{};
    const ma_result detailResult =
        ma_context_get_device_info(context, ma_device_type_playback, &basic.id, &detailed);
    DeviceDTO dto;
    dto.id = deviceIdToString(basic.id, resolved);
    dto.name = basic.name;
    dto.isDefault = basic.isDefault == MA_TRUE;
    dto.exclusive = backendSupportsExclusive(resolved);
    if (detailResult == MA_SUCCESS) {
      int maxChannels = 0;
      int minRate = 0;
      int maxRate = 0;
      std::vector<int> rates;
      std::vector<std::string> formats;
      for (ma_uint32 f = 0; f < detailed.nativeDataFormatCount; f++) {
        const auto& native = detailed.nativeDataFormats[f];
        const std::string format = formatNameOf(native.format);
        if (std::find(formats.begin(), formats.end(), format) == formats.end()) formats.push_back(format);
        if (native.channels > static_cast<ma_uint32>(maxChannels)) maxChannels = static_cast<int>(native.channels);
        if (native.sampleRate > 0) {
          if (minRate == 0 || static_cast<int>(native.sampleRate) < minRate) minRate = static_cast<int>(native.sampleRate);
          if (static_cast<int>(native.sampleRate) > maxRate) maxRate = static_cast<int>(native.sampleRate);
          if (std::find(rates.begin(), rates.end(), static_cast<int>(native.sampleRate)) == rates.end()) {
            rates.push_back(static_cast<int>(native.sampleRate));
          }
        }
      }
      std::sort(rates.begin(), rates.end());
      dto.channels = maxChannels;
      dto.minSampleRate = minRate;
      dto.maxSampleRate = maxRate;
      dto.sampleRates = rates;
      dto.formats = formats;
      dto.defaultSampleRate = rates.empty() ? 0 : rates[rates.size() / 2];
    }
    out.push_back(dto);
  }
  if (context == &temporary) ma_context_uninit(&temporary);
  return true;
}

bool Engine::configureDevice(const DeviceRequest& request, EngineError& error) {
  std::lock_guard<std::mutex> lock(deviceMutex_);
  if (device_ == nullptr) {
    error = {"device", "device configuration is unavailable with the " + options_.backend + " backend"};
    return false;
  }
  // The silent and offline backends are spawn-time modes for a build or a test — they have
  // no device at all — so there is nothing to switch to at runtime.
  if (request.hasBackend && (request.backend == "silent" || request.backend == "offline")) {
    error = {"device", "the " + request.backend + " backend has no device to configure"};
    return false;
  }
  const EngineOptions previous = options_;
  EngineOptions updated = options_;
  if (request.hasBackend) updated.backend = request.backend;
  if (request.hasDeviceId) updated.deviceId = request.deviceId == "default" ? std::string() : request.deviceId;
  if (request.hasSampleRate) updated.sampleRate = request.sampleRate;
  if (request.hasChannels) updated.channels = request.channels;
  if (request.hasExclusive) updated.exclusive = request.exclusive;
  if (request.hasBufferFrames) updated.bufferFrames = request.bufferFrames;

  // Refuse what can be refused before anything is torn down. An unknown backend, or one
  // this build cannot open (ASIO without the SDK) is a refusal that costs nothing;
  // computing it after the teardown would stop every voice and close the device to
  // answer a request it could have refused. The window re-sends its settings on every
  // show load, so a workspace naming an unavailable backend must not interrupt playback
  // to say no.
  if (request.hasBackend && request.backend != "auto" && request.backend != options_.backend) {
#if !defined(CUERUNNER_ASIO)
    if (request.backend == "asio") {
      error = {"device", "this engine was built without ASIO support (the Steinberg ASIO SDK was not present at build time)"};
      return false;
    }
#endif
    ma_backend probe;
    if (!parseBackendName(request.backend, probe)) {
      error = {"device", "unknown audio backend '" + request.backend + "'"};
      return false;
    }
  }

  // Asking for what is already running is normally a no-op: bouncing the device would
  // interrupt audio and produce a stop/start cycle nobody asked for (the window re-sends
  // its settings on every launch and every settings change). The exception is a device
  // that has latched off — the health check saw the stream die and nothing has reopened
  // it since. Identical settings are then exactly the request the device needs, so the
  // same options become a reopen rather than a shrug; the window re-sends them on every
  // mount and settings change, which is how a returned interface comes back.
  if (!deviceRunning_.load(std::memory_order_acquire)) {
    return reopenDeviceLocked(updated, previous, error);
  }
  if (updated.backend == options_.backend && updated.deviceId == options_.deviceId &&
      updated.sampleRate == options_.sampleRate && updated.channels == options_.channels &&
      updated.exclusive == options_.exclusive && updated.bufferFrames == options_.bufferFrames) {
    return true;
  }
  return reopenDeviceLocked(updated, previous, error);
}

bool Engine::reopenDeviceLocked(const EngineOptions& updated, const EngineOptions& previous, EngineError& error) {
  // Changing the device is a restart: every voice belongs to the old stream format. The
  // stop is queued ack-free — a driver-request reopen is on the service thread, which is
  // the only thread that resolves acks, so waiting for one here burns the whole ack
  // timeout with deviceMutex_ held — and it is applied below, once the old device has
  // stopped rendering, so the voices are really stopped before the new format arrives.
  Command stopEverything;
  stopEverything.kind = Command::StopAll;
  stopEverything.fadeMs = 0.0;
  submitInternalCommand(stopEverything);
  capture_.stop();
  deviceRunning_.store(false, std::memory_order_release);
  noteDeliberateStop(true);
  if (device_->deviceReady) {
    ma_device_stop(&device_->device);
    ma_device_uninit(&device_->device);
    device_->deviceReady = false;
  }
  if (device_->contextReady) {
    ma_context_uninit(&device_->context);
    device_->contextReady = false;
  }
  // Nothing is rendering the mixer now, so this thread may: the stop lands here, in the
  // mixer's old frame domain and before startDevice() reconfigures it for the new device.
  // The queue is empty afterwards, so nothing queued for the old device can reach the new
  // one, and a start that arrives during the reopen is applied after this stop, as asked.
  applyQueuedCommands();
  device_.reset();
  noteDeliberateStop(false);
  options_ = updated;
  if (!startDevice(error)) {
    options_ = previous;
    EngineError restoreError;
    if (!startDevice(restoreError)) {
      // failDevice takes errorMutex_ itself: holding it across the call would be the
      // same thread locking a non-recursive mutex twice and would hang right here, with
      // deviceMutex_ held, on the one path that exists to report the failure.
      failDevice("cannot reopen the previous audio device: " + restoreError.message);
    }
    restartCapture();
    return false;
  }
  restartCapture();
  return true;
}

/**
 * A driver has asked for its stream to be rebuilt — its control panel changed the buffer
 * size, or its clock changed the rate. The device is reopened with the same settings: the
 * backend reads the driver's new buffer size and rate as it opens, which is exactly what
 * the request means. The operator is told, because the show stopped for a moment to do it.
 */
void Engine::reopenAfterBackendRequest(const std::string& reason) {
  std::lock_guard<std::mutex> lock(deviceMutex_);
  if (device_ == nullptr) return;
  const EngineOptions current = options_;
  EngineError error;
  if (!reopenDeviceLocked(current, current, error)) {
    // The message is built before failDevice is called, never under errorMutex_: the
    // lock is taken inside failDevice, on this thread, and a second lock of it here
    // would deadlock the service thread — Engine::stop()'s join would then never return.
    failDevice("cannot reopen the audio device after a driver request: " + error.message);
    return;
  }
  std::lock_guard<std::mutex> errorLock(errorMutex_);
  lastError_ = reason;
}

std::string Engine::backendDetail(const DeviceState& state) {
#if defined(CUERUNNER_ASIO)
  if (state.backend == ma_backend_custom) return asio::contextMessage(state.context);
#else
  (void)state;
#endif
  return std::string();
}

void Engine::restartCapture() {
  capture_.stop();
  if (options_.capturePath.empty()) return;
  std::string captureError;
  if (!capture_.start(options_.capturePath, mixer_.sampleRate(), mixer_.channels(), captureError)) {
    logError("capture failed: %s", captureError.c_str());
  }
}

/**
 * The envelope of a region, in `points` buckets of interleaved min/max.
 *
 * Two ways to measure it, and the file's own length chooses: a region short enough to
 * read through is read sample by sample, and a long one — where a bucket is wider than
 * a pixel of wall time and a transient inside it could not be drawn anyway — is tapped,
 * one short window per bucket, reached by seeking. Taps are what make the envelope of a
 * twelve-hour file cost a quarter of a second instead of eighteen, and the seek table
 * the MP3 index builds is what makes a tap cheap.
 *
 * Results are kept, keyed by the file's stamp and the exact question asked, so the
 * second look at a file is the first look's answer.
 */
bool Engine::waveformCached(const std::string& filePath, int points, const RegionQuery& region,
                            const FileStamp& stamp, WaveformDTO& out) {
  std::lock_guard<std::mutex> lock(analysisCacheMutex_);
  for (WaveformCacheEntry& entry : waveformCache_) {
    if (entry.filePath != filePath || entry.points != points || !sameRegion(entry.region, region)) continue;
    if (entry.stamp.bytes != stamp.bytes || entry.stamp.modified != stamp.modified) continue;
    entry.lastUse = ++analysisCacheClock_;
    out = entry.result;
    return true;
  }
  return false;
}

void Engine::cacheWaveform(const std::string& filePath, int points, const RegionQuery& region, const FileStamp& stamp,
                           const WaveformDTO& result) {
  std::lock_guard<std::mutex> lock(analysisCacheMutex_);
  for (auto it = waveformCache_.begin(); it != waveformCache_.end(); ++it) {
    if (it->filePath == filePath && it->points == points && sameRegion(it->region, region)) {
      waveformCache_.erase(it);
      break;
    }
  }
  WaveformCacheEntry entry;
  entry.filePath = filePath;
  entry.points = points;
  entry.region = region;
  entry.stamp = stamp;
  entry.result = result;
  entry.lastUse = ++analysisCacheClock_;
  waveformCache_.push_back(std::move(entry));
  while (waveformCache_.size() > kMaxAnalysisCacheEntries) {
    auto victim = waveformCache_.begin();
    for (auto it = waveformCache_.begin(); it != waveformCache_.end(); ++it) {
      if (it->lastUse < victim->lastUse) victim = it;
    }
    waveformCache_.erase(victim);
  }
}

bool Engine::onsetsCached(const std::string& filePath, double sensitivity, int maxOnsets, const RegionQuery& region,
                          const FileStamp& stamp, OnsetDTO& out) {
  std::lock_guard<std::mutex> lock(analysisCacheMutex_);
  for (OnsetCacheEntry& entry : onsetCache_) {
    if (entry.filePath != filePath || !sameRegion(entry.region, region)) continue;
    if (entry.sensitivity != sensitivity || entry.maxOnsets != maxOnsets) continue;
    if (entry.stamp.bytes != stamp.bytes || entry.stamp.modified != stamp.modified) continue;
    entry.lastUse = ++analysisCacheClock_;
    out = entry.result;
    return true;
  }
  return false;
}

void Engine::cacheOnsets(const std::string& filePath, double sensitivity, int maxOnsets, const RegionQuery& region,
                         const FileStamp& stamp, const OnsetDTO& result) {
  std::lock_guard<std::mutex> lock(analysisCacheMutex_);
  for (auto it = onsetCache_.begin(); it != onsetCache_.end(); ++it) {
    if (it->filePath == filePath && it->sensitivity == sensitivity && it->maxOnsets == maxOnsets &&
        sameRegion(it->region, region)) {
      onsetCache_.erase(it);
      break;
    }
  }
  OnsetCacheEntry entry;
  entry.filePath = filePath;
  entry.sensitivity = sensitivity;
  entry.maxOnsets = maxOnsets;
  entry.region = region;
  entry.stamp = stamp;
  entry.result = result;
  entry.lastUse = ++analysisCacheClock_;
  onsetCache_.push_back(std::move(entry));
  while (onsetCache_.size() > kMaxAnalysisCacheEntries) {
    auto victim = onsetCache_.begin();
    for (auto it = onsetCache_.begin(); it != onsetCache_.end(); ++it) {
      if (it->lastUse < victim->lastUse) victim = it;
    }
    onsetCache_.erase(victim);
  }
}

bool Engine::silenceCached(const std::string& filePath, double thresholdDb, const FileStamp& stamp, SilenceDTO& out) {
  std::lock_guard<std::mutex> lock(analysisCacheMutex_);
  for (SilenceCacheEntry& entry : silenceCache_) {
    if (entry.filePath != filePath || entry.thresholdDb != thresholdDb) continue;
    if (entry.stamp.bytes != stamp.bytes || entry.stamp.modified != stamp.modified) continue;
    entry.lastUse = ++analysisCacheClock_;
    out = entry.result;
    return true;
  }
  return false;
}

void Engine::cacheSilence(const std::string& filePath, double thresholdDb, const FileStamp& stamp,
                          const SilenceDTO& result) {
  std::lock_guard<std::mutex> lock(analysisCacheMutex_);
  for (auto it = silenceCache_.begin(); it != silenceCache_.end(); ++it) {
    if (it->filePath == filePath && it->thresholdDb == thresholdDb) {
      silenceCache_.erase(it);
      break;
    }
  }
  SilenceCacheEntry entry;
  entry.filePath = filePath;
  entry.thresholdDb = thresholdDb;
  entry.stamp = stamp;
  entry.result = result;
  entry.lastUse = ++analysisCacheClock_;
  silenceCache_.push_back(std::move(entry));
  while (silenceCache_.size() > kMaxAnalysisCacheEntries) {
    auto victim = silenceCache_.begin();
    for (auto it = silenceCache_.begin(); it != silenceCache_.end(); ++it) {
      if (it->lastUse < victim->lastUse) victim = it;
    }
    silenceCache_.erase(victim);
  }
}

bool Engine::waveform(const std::string& filePath, int points, const RegionQuery& region, WaveformDTO& out,
                      EngineError& error) {
  if (points < 1) {
    error = {"invalid", "waveform needs at least one point"};
    return false;
  }
  bool truncated = false;
  if (points > kMaxWaveformPoints) {
    points = kMaxWaveformPoints;
    truncated = true;
  }

  const FileStamp stamp = fileStampOf(filePath);
  if (waveformCached(filePath, points, region, stamp, out)) return true;

  WaveformDTO result;
  result.filePath = filePath;
  result.buckets = points;
  result.truncated = truncated;

  // A resident copy is the cheapest and most complete answer there is: it is the whole
  // file in memory, so the region is scanned in full whatever its length.
  ResidentEnvelope resident;
  if (cache_.waveformFromResident(filePath, points, region, resident)) {
    result.values = std::move(resident.values);
    result.channels = resident.channels;
    result.sampleRate = resident.sampleRate;
    result.startMs = frameMs(resident.startFrame, resident.sampleRate);
    result.endMs = frameMs(resident.endFrame, resident.sampleRate);
    result.durationMs = frameMs(resident.frames, resident.sampleRate);
    result.sampled = false;
    cacheWaveform(filePath, points, region, stamp, result);
    out = std::move(result);
    return true;
  }

  std::string openError;
  SourceError openCode = SourceError::None;
  std::unique_ptr<Source> source = openSource(filePath, openError, &openCode);
  if (source == nullptr) {
    error = {openCode == SourceError::DecoderUnavailable ? "format-unavailable" : "decode", openError};
    return false;
  }
  const SourceInfo info = source->info();
  result.channels = info.channels;
  result.sampleRate = info.sampleRate;
  if (result.channels <= 0 || result.sampleRate <= 0) {
    error = {"decode", "media file reports an invalid format"};
    return false;
  }
  const int sampleRate = result.sampleRate;
  int64_t frames = info.frames;
  if (frames <= 0) {
    // The length is not stated: count it once, then scan with the real total so the
    // buckets line up. Memory stays bounded either way.
    std::vector<float> chunk(static_cast<size_t>(8192) * static_cast<size_t>(result.channels));
    int64_t total = 0;
    for (;;) {
      if (analysisCancelled()) return cancelledScan(error);
      const int64_t got = source->readFrames(chunk.data(), 8192);
      if (got <= 0) break;
      total += got;
    }
    frames = total;
    source->seekToFrame(0);
  }

  int64_t startFrame = region.bounded ? msFrame(region.startMs, sampleRate) : 0;
  int64_t endFrame = region.bounded ? msFrame(region.endMs, sampleRate) : frames;
  if (startFrame < 0) startFrame = 0;
  if (startFrame > frames) startFrame = frames;
  if (endFrame < startFrame) endFrame = startFrame;
  if (endFrame > frames) endFrame = frames;

  result.durationMs = frameMs(frames, sampleRate);
  result.startMs = frameMs(startFrame, sampleRate);
  result.endMs = frameMs(endFrame, sampleRate);

  const int64_t span = endFrame - startFrame;
  const bool longRegion = span > static_cast<int64_t>(sampleRate) * kExactWaveformSeconds;
  result.sampled = longRegion && info.canSeek;

  result.values.assign(static_cast<size_t>(points) * 2, 0.0f);
  for (int i = 0; i < points; i++) {
    result.values[static_cast<size_t>(i) * 2] = 1.0e30f;
    result.values[static_cast<size_t>(i) * 2 + 1] = -1.0e30f;
  }
  const int fold = std::min(result.channels, 2);

  if (!result.sampled) {
    std::vector<float> chunk(static_cast<size_t>(8192) * static_cast<size_t>(result.channels));
    if (startFrame > 0 && !source->seekToFrame(startFrame)) {
      error = {"decode", "media file cannot be positioned"};
      return false;
    }
    int64_t consumed = startFrame;
    while (consumed < endFrame) {
      if (analysisCancelled()) return cancelledScan(error);
      const int64_t want = std::min<int64_t>(8192, endFrame - consumed);
      const int64_t got = source->readFrames(chunk.data(), want);
      if (got <= 0) break;
      for (int64_t frame = 0; frame < got; frame++) {
        const int64_t index = span > 0
                                  ? std::min<int64_t>(points - 1, (consumed + frame - startFrame) * points / span)
                                  : 0;
        for (int c = 0; c < fold; c++) {
          const float sample =
              chunk[static_cast<size_t>(frame) * static_cast<size_t>(result.channels) + static_cast<size_t>(c)];
          const size_t bucket = static_cast<size_t>(index) * 2;
          if (sample < result.values[bucket]) result.values[bucket] = sample;
          if (sample > result.values[bucket + 1]) result.values[bucket + 1] = sample;
        }
      }
      consumed += got;
    }
  } else {
    const int64_t bucketFrames = std::max<int64_t>(1, span / points);
    const int64_t windowFrames = std::max<int64_t>(
        64, std::min<int64_t>(bucketFrames, static_cast<int64_t>(sampleRate) * kSampleWindowMs / 1000));
    std::vector<float> chunk(static_cast<size_t>(windowFrames) * static_cast<size_t>(result.channels));
    for (int i = 0; i < points; i++) {
      if (analysisCancelled()) return cancelledScan(error);
      const int64_t bucketStart = startFrame + span * i / points;
      const int64_t bucketEnd = startFrame + span * (i + 1) / points;
      const int64_t tap = bucketStart + (bucketEnd - bucketStart) / 2;
      const int64_t wanted = std::min<int64_t>(windowFrames, endFrame - tap);
      if (wanted <= 0 || !source->seekToFrame(tap)) continue;
      int64_t got = 0;
      while (got < wanted) {
        const int64_t read =
            source->readFrames(chunk.data() + static_cast<size_t>(got) * static_cast<size_t>(result.channels),
                               wanted - got);
        if (read <= 0) break;
        got += read;
      }
      for (int64_t frame = 0; frame < got; frame++) {
        for (int c = 0; c < fold; c++) {
          const float sample =
              chunk[static_cast<size_t>(frame) * static_cast<size_t>(result.channels) + static_cast<size_t>(c)];
          const size_t bucket = static_cast<size_t>(i) * 2;
          if (sample < result.values[bucket]) result.values[bucket] = sample;
          if (sample > result.values[bucket + 1]) result.values[bucket + 1] = sample;
        }
      }
    }
  }

  for (int i = 0; i < points; i++) {
    // A bucket no sample landed in stays a flat line rather than a sentinel.
    if (result.values[static_cast<size_t>(i) * 2] > result.values[static_cast<size_t>(i) * 2 + 1]) {
      result.values[static_cast<size_t>(i) * 2] = 0.0f;
      result.values[static_cast<size_t>(i) * 2 + 1] = 0.0f;
    }
  }

  cacheWaveform(filePath, points, region, stamp, result);
  out = std::move(result);
  return true;
}

bool Engine::onsets(const std::string& filePath, double sensitivity, int maxOnsets, const RegionQuery& region,
                    OnsetDTO& out, EngineError& error) {
  if (!std::isfinite(sensitivity)) {
    error = {"invalid", "sensitivity must be a finite number"};
    return false;
  }
  sensitivity = std::clamp(sensitivity, kMinOnsetSensitivity, kMaxOnsetSensitivity);
  bool truncated = false;
  if (maxOnsets <= 0) {
    maxOnsets = kMaxOnsets;
  } else if (maxOnsets > kMaxOnsets) {
    maxOnsets = kMaxOnsets;
    truncated = true;
  }

  const FileStamp stamp = fileStampOf(filePath);
  if (onsetsCached(filePath, sensitivity, maxOnsets, region, stamp, out)) return true;

  OnsetDTO result;
  result.filePath = filePath;

  int sampleRate = 0;
  int channels = 0;
  int64_t frames = -1;
  int64_t startFrame = 0;
  int64_t endFrame = -1;  // to the end of the file
  std::vector<double> onsetsMs;

  // A file the show has already decoded is scanned straight out of the cache: no disk
  // pass and no second decode, so a scan costs nothing on a file that is playing.
  CacheEntry* resident = nullptr;
  if (cache_.isResident(filePath)) {
    bool cacheHit = false;
    bool bypassed = false;
    std::string cacheError;
    resident = cache_.pin(filePath, cacheHit, bypassed, cacheError);
  }
  if (resident != nullptr && (resident->channels <= 0 || resident->sampleRate <= 0)) {
    // An entry that cannot describe itself is no better than the file.
    cache_.release(resident);
    resident = nullptr;
  }

  if (resident != nullptr) {
    channels = resident->channels;
    sampleRate = resident->sampleRate;
    frames = resident->frames;
    startFrame = region.bounded ? msFrame(region.startMs, sampleRate) : 0;
    endFrame = region.bounded ? msFrame(region.endMs, sampleRate) : frames;
    if (startFrame < 0) startFrame = 0;
    if (startFrame > frames) startFrame = frames;
    if (endFrame > frames) endFrame = frames;
    if (endFrame < startFrame) endFrame = startFrame;
    OnsetDetector detector(sampleRate, sensitivity, maxOnsets);
    // One call: the samples are already in memory, so hitting the cap only stops the
    // analysis early, not any reading.
    detector.feed(resident->data.data() + static_cast<size_t>(startFrame) * static_cast<size_t>(channels),
                  endFrame - startFrame, channels);
    detector.finish();
    onsetsMs = detector.onsetsMs();
    truncated = truncated || detector.capped();
    cache_.release(resident);
  } else {
    std::string openError;
    std::unique_ptr<Source> source = openSource(filePath, openError);
    if (source == nullptr) {
      error = {"decode", openError};
      return false;
    }
    const SourceInfo info = source->info();
    channels = info.channels;
    sampleRate = info.sampleRate;
    frames = info.frames;
    if (channels <= 0 || sampleRate <= 0) {
      error = {"decode", "media file reports an invalid format"};
      return false;
    }
    startFrame = region.bounded ? msFrame(region.startMs, sampleRate) : 0;
    if (startFrame < 0) startFrame = 0;
    if (frames > 0) {
      if (startFrame > frames) startFrame = frames;
      endFrame = region.bounded ? std::min(msFrame(region.endMs, sampleRate), frames) : -1;
    } else if (region.bounded) {
      endFrame = msFrame(region.endMs, sampleRate);
    }
    // A window that ends before it starts is an empty window, not one that runs to the
    // end of the file: `-1` stays what it is, which is the whole file from here on.
    if (region.bounded && endFrame >= 0 && endFrame < startFrame) endFrame = startFrame;
    if (startFrame > 0 && !source->seekToFrame(startFrame)) {
      error = {"decode", "media file cannot be positioned"};
      return false;
    }
    OnsetDetector detector(sampleRate, sensitivity, maxOnsets);
    std::vector<float> chunk(static_cast<size_t>(8192) * static_cast<size_t>(channels));
    int64_t consumed = startFrame;
    for (;;) {
      if (analysisCancelled()) return cancelledScan(error);
      int64_t want = 8192;
      if (endFrame >= 0) {
        want = std::min<int64_t>(want, endFrame - consumed);
        if (want <= 0) break;
      }
      const int64_t got = source->readFrames(chunk.data(), want);
      if (got <= 0) break;
      // False means the cap was reached: the rest of the file is not read at all.
      if (!detector.feed(chunk.data(), got, channels)) break;
      consumed += got;
    }
    detector.finish();
    onsetsMs = detector.onsetsMs();
    truncated = truncated || detector.capped();
  }

  // The detector counts from the first sample it was fed, and a windowed scan starts
  // mid-file: every time it reports is that far into the file again.
  const double startMs = frameMs(startFrame, sampleRate);
  if (startMs > 0.0) {
    for (double& onset : onsetsMs) onset += startMs;
  }

  result.onsetsMs = std::move(onsetsMs);
  result.durationMs = frameMs(frames, sampleRate);
  result.sampleRate = sampleRate;
  result.channels = channels;
  result.truncated = truncated;
  result.startMs = startMs;
  result.endMs = endFrame >= 0 ? frameMs(endFrame, sampleRate) : result.durationMs;
  cacheOnsets(filePath, sensitivity, maxOnsets, region, stamp, result);
  out = std::move(result);
  return true;
}

/**
 * A file's audible extent, in one pass over its samples.
 *
 * Every frame's channels are compared against one linear threshold, so the answer is
 * the caller's own definition of silence rather than a gate that opens and closes: the
 * scan is where a trim's two edges come from, and an edge that wandered with the noise
 * floor would move a cue under the operator. The whole file is read, but only the two
 * frame indices that matter are kept, so a long file costs a pass and two numbers.
 */
bool Engine::silence(const std::string& filePath, double thresholdDb, SilenceDTO& out, EngineError& error) {
  if (!std::isfinite(thresholdDb)) {
    error = {"invalid", "thresholdDb must be a finite number"};
    return false;
  }
  thresholdDb = std::clamp(thresholdDb, kMinSilenceThresholdDb, kMaxSilenceThresholdDb);

  const FileStamp stamp = fileStampOf(filePath);
  if (silenceCached(filePath, thresholdDb, stamp, out)) return true;

  SilenceDTO result;
  result.filePath = filePath;

  const double threshold = std::pow(10.0, thresholdDb / 20.0);
  int64_t firstFrame = -1;
  int64_t lastFrame = -1;
  int64_t consumed = 0;
  const auto fold = [&](const float* samples, int64_t frames, int channels) {
    for (int64_t frame = 0; frame < frames; frame++) {
      const float* values = samples + static_cast<size_t>(frame) * static_cast<size_t>(channels);
      for (int channel = 0; channel < channels; channel++) {
        if (std::fabs(static_cast<double>(values[channel])) <= threshold) continue;
        if (firstFrame < 0) firstFrame = consumed + frame;
        lastFrame = consumed + frame;
        // One channel over the line makes the frame audible; the rest cannot move the
        // edge.
        break;
      }
    }
    consumed += frames;
  };

  int sampleRate = 0;
  int channels = 0;
  int64_t frames = -1;

  // A file the show has already decoded is scanned straight out of the cache: no disk
  // pass and no second decode, so a scan costs nothing on a file that is playing.
  CacheEntry* resident = nullptr;
  if (cache_.isResident(filePath)) {
    bool cacheHit = false;
    bool bypassed = false;
    std::string cacheError;
    resident = cache_.pin(filePath, cacheHit, bypassed, cacheError);
  }
  if (resident != nullptr && (resident->channels <= 0 || resident->sampleRate <= 0)) {
    // An entry that cannot describe itself is no better than the file.
    cache_.release(resident);
    resident = nullptr;
  }

  if (resident != nullptr) {
    channels = resident->channels;
    sampleRate = resident->sampleRate;
    frames = resident->frames;
    fold(resident->data.data(), frames, channels);
    cache_.release(resident);
  } else {
    std::string openError;
    std::unique_ptr<Source> source = openSource(filePath, openError);
    if (source == nullptr) {
      error = {"decode", openError};
      return false;
    }
    const SourceInfo info = source->info();
    channels = info.channels;
    sampleRate = info.sampleRate;
    frames = info.frames;
    if (channels <= 0 || sampleRate <= 0) {
      error = {"decode", "media file reports an invalid format"};
      return false;
    }
    std::vector<float> chunk(static_cast<size_t>(8192) * static_cast<size_t>(channels));
    for (;;) {
      if (analysisCancelled()) return cancelledScan(error);
      const int64_t got = source->readFrames(chunk.data(), 8192);
      if (got <= 0) break;
      fold(chunk.data(), got, channels);
    }
  }

  // A file whose length is not stated — an MP3 with no Xing frame — reports what the
  // scan actually read; a stated length is the better number when there is one.
  result.durationMs = frameMs(frames > 0 ? frames : consumed, sampleRate);
  result.sampleRate = sampleRate;
  result.channels = channels;
  result.silent = firstFrame < 0;
  if (result.silent) {
    // Nothing crossed the threshold: the bounds are the whole file, because a file with
    // no sound in it has no silence at its edges to trim.
    result.startMs = 0.0;
    result.endMs = result.durationMs;
  } else {
    result.startMs = frameMs(firstFrame, sampleRate);
    // The last audible sample is a sample long, so the edge is its far side: the trim
    // keeps the sample that was heard and drops what follows it.
    result.endMs = frameMs(lastFrame + 1, sampleRate);
  }
  cacheSilence(filePath, thresholdDb, stamp, result);
  out = std::move(result);
  return true;
}

}  // namespace ws
