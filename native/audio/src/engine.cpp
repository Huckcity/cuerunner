// windows.h defines `min` and `max` as function-like macros, and miniaudio pulls
// windows.h in on Windows. Without this, every std::min and std::max in this file is a
// syntax error there (MSVC C2589: illegal token on right side of '::').
#if defined(_WIN32)
#define NOMINMAX
#endif

#include "engine.h"

#include "util.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <thread>

#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_GENERATION
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

namespace ws {
namespace {

constexpr int kBackgroundTickMs = 2;
constexpr int kAckTimeoutMs = 2000;

std::string maResultText(ma_result result) { return std::string(ma_result_description(result)); }

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
    const ma_result result = ma_context_init(list, 1, nullptr, &context);
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
    ma_context_uninit(&state->context);
    error = {"device", std::string("cannot open audio device") +
                          (options_.exclusive ? " in exclusive mode" : "") + ": " + maResultText(result)};
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
    ma_device_uninit(&state->device);
    ma_context_uninit(&state->context);
    error = {"device", std::string("cannot start audio device: ") + maResultText(startResult)};
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
  std::unique_lock<std::mutex> lock(deviceMutex_, std::try_to_lock);
  if (!lock.owns_lock()) return;
  if (device_ == nullptr || !device_->deviceReady) return;
  const ma_device_state state = ma_device_get_state(&device_->device);
  if (state == ma_device_state_stopped || state == ma_device_state_stopping) {
    deviceRunning_.store(false, std::memory_order_release);
    failDeviceFromCallback("audio device stopped unexpectedly");
  }
}

void Engine::handleBackgroundWork() {
  if (deviceFailed_.load(std::memory_order_acquire)) {
    deviceFailed_.store(false, std::memory_order_release);
    std::string message;
    {
      std::lock_guard<std::mutex> lock(errorMutex_);
      message = lastError_.empty() ? std::string("audio device failed") : lastError_;
    }
    failDevice(message);
    Command command;
    command.kind = Command::Panic;
    command.fadeMs = 0.0;
    AckResult ack;
    EngineError ignored;
    submitCommand(command, ack, ignored);
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

  Event event;
  while (events_.pop(event)) {
    if (event.kind == Event::Ack) {
      resolveAck(event);
      continue;
    }
    if (eventCallback_) eventCallback_(event);
  }
}

void Engine::resolveAck(const Event& event) {
  std::lock_guard<std::mutex> lock(ackMutex_);
  AckResult& slot = acks_[event.ackId];
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
    std::lock_guard<std::mutex> lock(commandMutex_);
    if (!commands_.push(command)) {
      error = {"limit", "audio engine command queue is full"};
      releaseCommandResources(command);
      return false;
    }
  }

  if (options_.backend == "offline") {
    // Single-threaded mode: the caller owns the clock, so the queued command is applied
    // here and the service work runs here rather than on a background thread.
    Command queued;
    while (commands_.pop(queued)) mixer_.apply(queued);
    handleBackgroundWork();
  }

  std::unique_lock<std::mutex> lock(ackMutex_);
  const bool arrived = ackCv_.wait_for(lock, std::chrono::milliseconds(kAckTimeoutMs), [&] {
    return acks_.find(ackId) != acks_.end() || !running_.load(std::memory_order_acquire);
  });
  const auto it = acks_.find(ackId);
  if (!arrived || it == acks_.end()) {
    error = {"engine", "audio engine did not acknowledge the command"};
    return false;
  }
  ack = it->second;
  acks_.erase(it);
  return true;
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

  const double now = clockMs();
  if (whenMs > now + static_cast<double>(options_.scheduleHorizonMs)) {
    error = {"limit", "start is scheduled beyond the engine horizon"};
    return false;
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
    const int slot = streams_.acquire(file.path, options_.streamPrerollMs, options_.streamMaxVoiceBytes, streamError, info);
    if (slot < 0) {
      error = {"decode", streamError};
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
  out.startAtMs = std::max(whenMs, now);
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
  out.protocol = 1;
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
    if (device_->periodFrames > 0 && device_->internalSampleRate > 0) {
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
  const EngineOptions previous = options_;
  EngineOptions updated = options_;
  if (request.hasDeviceId) updated.deviceId = request.deviceId == "default" ? std::string() : request.deviceId;
  if (request.hasSampleRate) updated.sampleRate = request.sampleRate;
  if (request.hasChannels) updated.channels = request.channels;
  if (request.hasExclusive) updated.exclusive = request.exclusive;
  if (request.hasBufferFrames) updated.bufferFrames = request.bufferFrames;

  // Asking for what is already running is a no-op: bouncing the device would interrupt
  // audio and produce a stop/start cycle nobody asked for (the window re-sends its
  // settings on every launch and every settings change).
  if (updated.deviceId == options_.deviceId && updated.sampleRate == options_.sampleRate &&
      updated.channels == options_.channels && updated.exclusive == options_.exclusive &&
      updated.bufferFrames == options_.bufferFrames) {
    return true;
  }

  // Changing the device is a restart: every voice belongs to the old stream format.
  CommandResultDTO ignored;
  EngineError ignoredError;
  stopAll(0.0, ignored, ignoredError);
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
  device_.reset();
  noteDeliberateStop(false);
  options_ = updated;
  if (!startDevice(error)) {
    options_ = previous;
    EngineError restoreError;
    if (!startDevice(restoreError)) {
      std::lock_guard<std::mutex> errorLock(errorMutex_);
      lastError_ = "cannot reopen the previous audio device: " + restoreError.message;
      failDevice(lastError_);
    }
    restartCapture();
    return false;
  }
  restartCapture();
  return true;
}

void Engine::restartCapture() {
  capture_.stop();
  if (options_.capturePath.empty()) return;
  std::string captureError;
  if (!capture_.start(options_.capturePath, mixer_.sampleRate(), mixer_.channels(), captureError)) {
    logError("capture failed: %s", captureError.c_str());
  }
}

bool Engine::waveform(const std::string& filePath, int points, WaveformDTO& out, EngineError& error) {
  bool truncated = false;
  if (points < 1) {
    error = {"invalid", "waveform needs at least one point"};
    return false;
  }
  if (points > kMaxWaveformPoints) {
    points = kMaxWaveformPoints;
    truncated = true;
  }

  std::vector<float> values(static_cast<size_t>(points) * 2, 0.0f);
  for (int i = 0; i < points; i++) {
    values[static_cast<size_t>(i) * 2] = 1.0e30f;
    values[static_cast<size_t>(i) * 2 + 1] = -1.0e30f;
  }
  int sampleRate = 0;
  int channels = 0;
  int64_t frames = -1;
  if (cache_.waveformFromResident(filePath, points, values, channels, sampleRate, frames)) {
    // Served from the decoded copy: no disk pass, no media bytes moving anywhere.
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
    if (frames <= 0) {
      // The length is not stated: count it once, then scan with the real total so the
      // buckets line up. Memory stays bounded either way.
      std::vector<float> chunk(static_cast<size_t>(8192) * static_cast<size_t>(channels));
      int64_t total = 0;
      for (;;) {
        const int64_t got = source->readFrames(chunk.data(), 8192);
        if (got <= 0) break;
        total += got;
      }
      frames = total;
      source->seekToFrame(0);
    }
    std::vector<float> chunk(static_cast<size_t>(8192) * static_cast<size_t>(channels));
    int64_t consumed = 0;
    for (;;) {
      const int64_t got = source->readFrames(chunk.data(), 8192);
      if (got <= 0) break;
      const int64_t base = consumed;
      for (int64_t frame = 0; frame < got; frame++) {
        const int64_t absolute = base + frame;
        const int64_t index = frames > 0 ? std::min<int64_t>(points - 1, absolute * points / frames) : 0;
        for (int c = 0; c < std::min(channels, 2); c++) {
          const float sample = chunk[frame * channels + c];
          if (sample < values[static_cast<size_t>(index) * 2]) values[static_cast<size_t>(index) * 2] = sample;
          if (sample > values[static_cast<size_t>(index) * 2 + 1]) values[static_cast<size_t>(index) * 2 + 1] = sample;
        }
      }
      consumed += got;
    }
    frames = consumed;
  }

  for (int i = 0; i < points; i++) {
    if (values[static_cast<size_t>(i) * 2] > values[static_cast<size_t>(i) * 2 + 1]) {
      values[static_cast<size_t>(i) * 2] = 0.0f;
      values[static_cast<size_t>(i) * 2 + 1] = 0.0f;
    }
  }
  out.filePath = filePath;
  out.buckets = points;
  out.values = std::move(values);
  out.sampleRate = sampleRate;
  out.channels = channels;
  out.durationMs = frames > 0 ? static_cast<double>(frames) * 1000.0 / static_cast<double>(sampleRate) : 0.0;
  out.truncated = truncated;
  return true;
}

}  // namespace ws
