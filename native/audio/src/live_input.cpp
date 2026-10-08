// windows.h, which miniaudio pulls in, defines `min` and `max` as macros (see engine.cpp).
#if defined(_WIN32)
#define NOMINMAX
#endif

#include "miniaudio_setup.h"

#include "live_input.h"

#include "util.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

namespace ws {
namespace {

constexpr double kTwoPi = 6.28318530717958647692;

/**
 * The controller's gains, on the fill error in seconds of buffer. Proportional 0.3 corrects
 * an excess over about three seconds; integral 0.02 gives the loop a natural frequency of
 * 0.14 rad/s, just past critical damping — slow enough that the correction is never heard as
 * pitch (a few parts per million once locked) and fast enough to lock a 1000 ppm clock error
 * inside half a minute. The nudge is held to ±0.5 %: no device clock is that far off, and a
 * feed that needs more has stalled and is resynced.
 */
constexpr double kProportional = 0.3;
constexpr double kIntegral = 0.02;
constexpr double kMaxAdjust = 0.005;
/** The fill is averaged over this long before the controller reads it, seconds. */
constexpr double kFillAverageSeconds = 1.0;
/** Headroom kept above the largest delivery and one block's need, ms. */
constexpr double kMarginMs = 3.0;
/**
 * Headroom learned from the device: a delivery that arrives late enough to bring the buffer
 * within a quarter of the margin of running dry adds a millisecond, at most once a second
 * and to at most this much. A device whose callbacks wander is given the room it needs
 * before it underruns rather than after, and one that does not keeps the latency it had.
 */
constexpr double kMaxLearnedMs = 40.0;
constexpr double kLearnStepMs = 1.0;
constexpr double kLearnCooldownSeconds = 1.0;
/** The synthetic sources' level: −12 dBFS. */
constexpr float kToneLevel = 0.25f;
constexpr double kToneHz = 1000.0;
/** A ramp counts the input's frames modulo this, so a test can read the frame back. */
constexpr int64_t kRampPeriod = 1 << 16;

float catmullRom(float p0, float p1, float p2, float p3, float t) {
  const float t2 = t * t;
  const float t3 = t2 * t;
  return 0.5f * ((2.0f * p1) + (-p0 + p2) * t + (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3) * t2 +
                 (-p0 + 3.0f * p1 - 3.0f * p2 + p3) * t3);
}

void captureCallback(ma_device* device, void* output, const void* input, ma_uint32 frameCount) {
  (void)output;
  auto* feed = static_cast<InputFeed*>(device->pUserData);
  if (feed != nullptr && input != nullptr) feed->captured(input, frameCount);
}

bool isSynthetic(const std::string& device) { return device.rfind("test:", 0) == 0; }

}  // namespace

struct InputFeed::Device {
  ma_context context;
  ma_device device;
  bool contextReady = false;
  bool deviceReady = false;
};

InputFeed::InputFeed() {
  for (auto& peak : peaks_) peak.store(0.0f, std::memory_order_relaxed);
}

InputFeed::~InputFeed() { close(); }

void InputFeed::push(const float* frames, int count, double at) {
  if (count <= 0 || channels_ <= 0) return;
  const uint64_t write = writeHead_.load(std::memory_order_relaxed);
  const uint64_t released = releasedHead_.load(std::memory_order_acquire);
  if (write + static_cast<uint64_t>(count) - released > static_cast<uint64_t>(kRingFrames)) {
    // The reader has fallen a whole ring behind: what it has not read yet is older than
    // what is arriving, and the arrival is what is dropped — never a wait on a device thread.
    overruns_.fetch_add(1, std::memory_order_relaxed);
    return;
  }
  const size_t stride = static_cast<size_t>(channels_);
  for (int i = 0; i < count; i++) {
    const size_t at = static_cast<size_t>((write + static_cast<uint64_t>(i)) & (kRingFrames - 1)) * stride;
    std::memcpy(&ring_[at], frames + static_cast<size_t>(i) * stride, stride * sizeof(float));
  }
  if (count > maxChunk_.load(std::memory_order_relaxed)) maxChunk_.store(count, std::memory_order_relaxed);
  lastPushAt_.store(at, std::memory_order_relaxed);
  writeHead_.store(write + static_cast<uint64_t>(count), std::memory_order_release);
}

void InputFeed::captured(const void* frames, uint32_t count) {
  if (state_.load(std::memory_order_acquire) != kRunning) return;
  push(static_cast<const float*>(frames), static_cast<int>(count), steadyNowMs() / 1000.0);
}

/** Delivers one period of the synthetic source, from its own position, as delivered at `at`. */
void InputFeed::generate(int count, double at) {
  const int stride = channels_;
  count = std::min(count, static_cast<int>(scratch_.size()) / std::max(1, stride));
  for (int i = 0; i < count; i++) {
    const int64_t frame = generated_ + i;
    float value = 0.0f;
    if (kind_ == 1) {
      value = static_cast<float>(static_cast<double>(frame % kRampPeriod) / static_cast<double>(kRampPeriod)) - 0.5f;
    } else {
      value = kToneLevel * static_cast<float>(std::sin(kTwoPi * kToneHz * static_cast<double>(frame) /
                                                       static_cast<double>(inRate_)));
    }
    for (int c = 0; c < stride; c++) scratch_[static_cast<size_t>(i * stride + c)] = value;
  }
  generated_ += count;
  push(scratch_.data(), count, at);
}

/**
 * A simulated source delivers every period that its own clock has finished by the time the
 * output's block starts — so a skewed clock delivers slightly more or fewer frames per
 * second of output than its stated rate, exactly as a real device would.
 */
void InputFeed::advanceSimulation(int64_t clockFrame, int outRate) {
  const double now = static_cast<double>(clockFrame) / static_cast<double>(outRate);
  const double trueRate = static_cast<double>(inRate_) * (1.0 + skewPpm_ * 1e-6);
  const int period = periodFrames_ > 0 ? periodFrames_ : std::max(1, inRate_ / 100);
  for (;;) {
    // Each delivery is late by its own draw from 0 to the jitter — a device callback that a
    // busy machine did not schedule on time — and never overtakes the one before it.
    if (!jitterDrawn_) {
      jitterSeed_ = jitterSeed_ * 6364136223846793005ULL + 1442695040888963407ULL;
      const double unit = static_cast<double>(jitterSeed_ >> 11) / 9007199254740992.0;
      pendingJitter_ = std::max(lastDelivery_ - static_cast<double>(generated_ + period) / trueRate,
                                unit * jitterMs_ / 1000.0);
      jitterDrawn_ = true;
    }
    const double due = static_cast<double>(generated_ + period) / trueRate + pendingJitter_;
    if (due > now) break;
    generate(period, due);
    lastDelivery_ = due;
    jitterDrawn_ = false;
  }
}

void InputFeed::syntheticThread() {
  const double trueRate = static_cast<double>(inRate_) * (1.0 + skewPpm_ * 1e-6);
  const int period = periodFrames_ > 0 ? periodFrames_ : std::max(1, inRate_ / 100);
  const double started = steadyNowMs();
  while (!syntheticStop_.load(std::memory_order_acquire)) {
    const double due = started + static_cast<double>(generated_ + period) * 1000.0 / trueRate;
    const double wait = due - steadyNowMs();
    if (wait > 0.0) {
      std::this_thread::sleep_for(std::chrono::microseconds(static_cast<int64_t>(std::min(wait, 20.0) * 1000.0)));
      continue;
    }
    generate(period, steadyNowMs() / 1000.0);
  }
}

void InputFeed::stopSynthetic() {
  syntheticStop_.store(true, std::memory_order_release);
  if (synthetic_thread_.joinable()) synthetic_thread_.join();
}

void InputFeed::pull(int frames, int outRate, int64_t clockFrame) {
  // Announced before the state is read, and the close announces its state before it reads
  // this: whichever goes second sees the other, so a close never frees a buffer this pull
  // is still reading, and a pull never starts on a feed that is closing.
  pulling_.store(true, std::memory_order_seq_cst);
  if (state_.load(std::memory_order_seq_cst) == kRunning && frames > 0 && outRate > 0) {
    pullRunning(frames, outRate, clockFrame);
  }
  pulling_.store(false, std::memory_order_seq_cst);
}

void InputFeed::pullRunning(int frames, int outRate, int64_t clockFrame) {
  if (simulated_) advanceSimulation(clockFrame, outRate);
  if (resetRequested_.exchange(false, std::memory_order_acq_rel)) {
    primed_ = false;
    integral_ = 0.0;
    adjust_ = 0.0;
    learned_ = 0.0;
    sinceLearned_ = kLearnCooldownSeconds;
  }
  frames = std::min(frames, kMaxOutputFrames);
  const size_t stride = static_cast<size_t>(channels_);
  float* out = block_.data();

  const double base = static_cast<double>(inRate_) / static_cast<double>(outRate);
  const double need = static_cast<double>(frames) * base * (1.0 + kMaxAdjust) + 4.0;
  const double chunk = static_cast<double>(std::max(1, maxChunk_.load(std::memory_order_relaxed)));
  const double framesPerMs = static_cast<double>(inRate_) / 1000.0;
  target_ = latencyMs_ > 0.0 ? std::max(need, latencyMs_ * framesPerMs)
                             : need + chunk + (kMarginMs + learned_) * framesPerMs;
  const double dt = static_cast<double>(frames) / static_cast<double>(outRate);
  sinceLearned_ += dt;
  const double write = static_cast<double>(writeHead_.load(std::memory_order_acquire));

  const auto silence = [&]() {
    std::memset(out, 0, static_cast<size_t>(frames) * stride * sizeof(float));
  };

  if (!primed_) {
    // Nothing is played until the target is there to be held: starting short is an
    // underrun a block later.
    if (write < target_ + 2.0) {
      silence();
      return;
    }
    readPos_ = write - target_;
    fillAverage_ = target_ + chunk / 2.0;
    primed_ = true;
  }

  double available = write - readPos_;
  // What the device has captured since it last delivered, estimated from when that was: the
  // buffer the controller holds is what is buffered on both sides of the callback, so a
  // period handed over in one piece is not read as the buffer jumping by a period. Without
  // it, a device whose period matches the output's block reads as a buffer that does not
  // move at all between deliveries — and a clock error shows up as a step every few seconds
  // rather than a slope the controller can follow.
  const double now = simulated_ ? static_cast<double>(clockFrame) / static_cast<double>(outRate) : steadyNowMs() / 1000.0;
  const double sinceDelivery = now - lastPushAt_.load(std::memory_order_relaxed);
  const double undelivered = std::clamp(sinceDelivery * static_cast<double>(inRate_), 0.0, chunk);
  if (available < need) {
    // The device stopped delivering (or never kept up): silence, and lock again once the
    // buffer is back at its target — with more room, since the room it had was not enough.
    underruns_.fetch_add(1, std::memory_order_relaxed);
    learned_ = std::min(kMaxLearnedMs, learned_ + 2.0 * kLearnStepMs);
    primed_ = false;
    silence();
    return;
  }
  if (latencyMs_ <= 0.0 && available - need < 0.25 * kMarginMs * framesPerMs && sinceLearned_ >= kLearnCooldownSeconds &&
      learned_ < kMaxLearnedMs) {
    learned_ += kLearnStepMs;
    sinceLearned_ = 0.0;
  }
  const double runaway = target_ + std::max(4.0 * target_, 0.2 * static_cast<double>(inRate_));
  if (available > runaway) {
    // A stall that delivered its backlog at once: playing it would keep the whole backlog
    // as latency for good. The buffer goes back to its target, and that is counted.
    readPos_ = write - target_;
    fillAverage_ = target_ + chunk / 2.0;
    available = target_;
    resyncs_.fetch_add(1, std::memory_order_relaxed);
  }

  const double weight = std::min(1.0, dt / kFillAverageSeconds);
  fillAverage_ += weight * (available + undelivered - fillAverage_);
  // The target is for what is delivered; the average also counts what is waiting in the
  // device, half a period on average, so that half is where the two meet.
  const double error = (fillAverage_ - (target_ + chunk / 2.0)) / static_cast<double>(inRate_);
  integral_ = std::clamp(integral_ + error * dt, -kMaxAdjust / kIntegral, kMaxAdjust / kIntegral);
  adjust_ = std::clamp(kProportional * error + kIntegral * integral_, -kMaxAdjust, kMaxAdjust);
  const double step = base * (1.0 + adjust_);

  float blockPeak[kMaxOutputChannels] = {};
  for (int f = 0; f < frames; f++) {
    const int64_t index = static_cast<int64_t>(std::floor(readPos_));
    const float t = static_cast<float>(readPos_ - static_cast<double>(index));
    float* frameOut = out + static_cast<size_t>(f) * stride;
    for (size_t c = 0; c < stride; c++) {
      const int channel = static_cast<int>(c);
      const float value = catmullRom(sampleAt(index - 1, channel), sampleAt(index, channel),
                                     sampleAt(index + 1, channel), sampleAt(index + 2, channel), t);
      frameOut[c] = value;
      const float level = std::fabs(value);
      if (level > blockPeak[c]) blockPeak[c] = level;
    }
    readPos_ += step;
  }
  const int64_t floorRead = static_cast<int64_t>(std::floor(readPos_)) - 2;
  if (floorRead > 0) releasedHead_.store(static_cast<uint64_t>(floorRead), std::memory_order_release);

  for (size_t c = 0; c < stride && c < static_cast<size_t>(kMaxOutputChannels); c++) {
    if (blockPeak[c] > peaks_[c].load(std::memory_order_relaxed)) peaks_[c].store(blockPeak[c], std::memory_order_relaxed);
  }
  // The age of what is played, from when the device captured it: the buffer, plus half a
  // delivery on average — a sample waits in the device until its whole period is handed over.
  latencyPublished_.store(fillAverage_ * 1000.0 / static_cast<double>(inRate_), std::memory_order_relaxed);
  targetPublished_.store(target_ * 1000.0 / static_cast<double>(inRate_), std::memory_order_relaxed);
  ratioPublished_.store(adjust_ * 1e6, std::memory_order_relaxed);
}

bool InputFeed::open(const InputOpenOptions& options, int outRate, bool offline, std::string& error) {
  if (state_.load(std::memory_order_acquire) == kRunning) return true;
  if (deviceState_ != nullptr || synthetic_thread_.joinable()) close();

  const bool synthetic = isSynthetic(options.device);
  int channels = 0;
  int rate = 0;
  std::unique_ptr<Device> device;
  std::string name;
  if (synthetic) {
    const std::string kind = options.device.substr(5);
    if (kind != "tone" && kind != "ramp") {
      error = "there is no test input called \"" + options.device + "\"";
      return false;
    }
    if (!(options.skewPpm >= -10000.0 && options.skewPpm <= 10000.0)) {
      error = "a test input's clock error must be within ±10000 ppm";
      return false;
    }
    kind_ = kind == "ramp" ? 1 : 0;
    channels = std::clamp(options.channels, 1, kMaxOutputChannels);
    rate = options.sampleRate > 0 ? options.sampleRate : outRate;
    if (rate < 8000 || rate > 384000) {
      error = "a test input runs between 8 and 384 kHz";
      return false;
    }
    name = kind == "ramp" ? "Test ramp" : "Test tone (1 kHz, −12 dBFS)";
  } else {
    device = std::make_unique<Device>();
    if (ma_context_init(nullptr, 0, nullptr, &device->context) != MA_SUCCESS) {
      error = "no audio system to capture from";
      return false;
    }
    device->contextReady = true;
    ma_device_info* playback = nullptr;
    ma_uint32 playbackCount = 0;
    ma_device_info* captures = nullptr;
    ma_uint32 captureCount = 0;
    const ma_device_id* chosen = nullptr;
    name = "the default input";
    if (ma_context_get_devices(&device->context, &playback, &playbackCount, &captures, &captureCount) ==
        MA_SUCCESS) {
      for (ma_uint32 i = 0; i < captureCount; i++) {
        if (!options.device.empty() && options.device != "default" && options.device == captures[i].name) {
          chosen = &captures[i].id;
          name = captures[i].name;
        }
      }
    }
    if (!options.device.empty() && options.device != "default" && chosen == nullptr) {
      ma_context_uninit(&device->context);
      error = "no input named \"" + options.device + "\"";
      return false;
    }
    ma_device_config config = ma_device_config_init(ma_device_type_capture);
    config.capture.pDeviceID = chosen;
    config.capture.format = ma_format_f32;
    config.capture.channels = 0;
    config.sampleRate = 0;
    config.dataCallback = captureCallback;
    config.pUserData = this;
    if (ma_device_init(&device->context, &config, &device->device) != MA_SUCCESS) {
      ma_context_uninit(&device->context);
      error = "could not open " + name;
      return false;
    }
    device->deviceReady = true;
    channels = std::clamp(static_cast<int>(device->device.capture.channels), 1, kMaxOutputChannels);
    rate = static_cast<int>(device->device.sampleRate);
  }

  // Buffers sized once: the ring for this many channels, the block for the most a block can
  // ever be. The render thread is out of this slot (close() waited for it), so a resize here
  // races nothing.
  if (ring_.size() < static_cast<size_t>(kRingFrames) * static_cast<size_t>(channels)) {
    ring_.assign(static_cast<size_t>(kRingFrames) * static_cast<size_t>(channels), 0.0f);
  }
  if (block_.empty()) {
    block_.assign(static_cast<size_t>(kMaxOutputFrames) * static_cast<size_t>(kMaxOutputChannels), 0.0f);
  }
  device_ = options.device;
  name_ = name;
  channels_ = channels;
  inRate_ = rate;
  synthetic_ = synthetic;
  simulated_ = synthetic && offline;
  skewPpm_ = options.skewPpm;
  periodFrames_ = std::max(0, options.periodFrames);
  latencyMs_ = std::max(0.0, options.latencyMs);
  if (synthetic) {
    const int period = periodFrames_ > 0 ? periodFrames_ : std::max(1, rate / 100);
    scratch_.assign(static_cast<size_t>(period) * static_cast<size_t>(channels), 0.0f);
  }
  lastPushAt_.store(0.0, std::memory_order_relaxed);
  jitterMs_ = std::clamp(options.jitterMs, 0.0, 100.0);
  jitterSeed_ = 0x9E3779B97F4A7C15ULL;
  jitterDrawn_ = false;
  lastDelivery_ = 0.0;
  generated_ = 0;
  writeHead_.store(0, std::memory_order_relaxed);
  releasedHead_.store(0, std::memory_order_relaxed);
  maxChunk_.store(synthetic ? std::max(1, periodFrames_ > 0 ? periodFrames_ : rate / 100) : 0,
                  std::memory_order_relaxed);
  underruns_.store(0);
  overruns_.store(0);
  resyncs_.store(0);
  for (auto& peak : peaks_) peak.store(0.0f, std::memory_order_relaxed);
  resetRequested_.store(true, std::memory_order_release);
  deviceState_ = std::move(device);
  state_.store(kRunning, std::memory_order_seq_cst);

  if (deviceState_ != nullptr) {
    if (ma_device_start(&deviceState_->device) != MA_SUCCESS) {
      close();
      error = "could not start " + name;
      return false;
    }
  } else if (synthetic && !offline) {
    syntheticStop_.store(false, std::memory_order_release);
    synthetic_thread_ = std::thread([this] { syntheticThread(); });
  }
  return true;
}

void InputFeed::close() {
  if (state_.load(std::memory_order_acquire) == kRunning) state_.store(kStopped, std::memory_order_seq_cst);
  // A pull that began before the stop is a few microseconds of arithmetic: it is let finish.
  while (pulling_.load(std::memory_order_seq_cst)) std::this_thread::yield();
  stopSynthetic();
  if (deviceState_ != nullptr) {
    if (deviceState_->deviceReady) ma_device_uninit(&deviceState_->device);
    if (deviceState_->contextReady) ma_context_uninit(&deviceState_->context);
    deviceState_.reset();
  }
}

InputFeedStatus InputFeed::status(int slot) {
  InputFeedStatus out;
  out.slot = slot;
  out.device = device_;
  out.name = name_;
  out.channels = channels_;
  out.sampleRate = inRate_;
  out.running = running();
  out.synthetic = synthetic_;
  out.latencyMs = latencyPublished_.load(std::memory_order_relaxed);
  out.targetMs = targetPublished_.load(std::memory_order_relaxed);
  out.ratioPpm = ratioPublished_.load(std::memory_order_relaxed);
  out.periodFrames = maxChunk_.load(std::memory_order_relaxed);
  out.underruns = underruns_.load(std::memory_order_relaxed);
  out.overruns = overruns_.load(std::memory_order_relaxed);
  out.resyncs = resyncs_.load(std::memory_order_relaxed);
  out.capturedFrames = writeHead_.load(std::memory_order_relaxed);
  for (int c = 0; c < channels_ && c < kMaxOutputChannels; c++) {
    out.peaks.push_back(peaks_[c].exchange(0.0f, std::memory_order_relaxed));
  }
  return out;
}

int InputFeeds::find(const std::string& device) const {
  for (int i = 0; i < kMaxInputFeeds; i++) {
    if (feeds_[i].inUse() && feeds_[i].device() == device) return i;
  }
  return -1;
}

int InputFeeds::open(const InputOpenOptions& requested, int outRate, std::string& error) {
  std::lock_guard<std::mutex> lock(mutex_);
  // The default input has one name, whichever way it was asked for, so it is one feed.
  InputOpenOptions options = requested;
  if (options.device.empty()) options.device = "default";
  if (isSynthetic(options.device) && !testInputs_) {
    error = "test inputs are not offered by this engine";
    return -1;
  }
  int slot = find(options.device);
  if (slot >= 0 && feeds_[slot].running()) return slot;
  if (slot < 0) {
    for (int i = 0; i < kMaxInputFeeds && slot < 0; i++) {
      if (!feeds_[i].inUse()) slot = i;
    }
  }
  if (slot < 0) {
    error = "every live input the engine can hold is open (" + std::to_string(kMaxInputFeeds) + ")";
    return -1;
  }
  if (!feeds_[slot].open(options, outRate, offline_, error)) return -1;
  return slot;
}

bool InputFeeds::close(const std::string& device) {
  std::lock_guard<std::mutex> lock(mutex_);
  const int slot = find(device.empty() ? std::string("default") : device);
  if (slot < 0 || !feeds_[slot].running()) return false;
  feeds_[slot].close();
  return true;
}

void InputFeeds::closeAll() {
  std::lock_guard<std::mutex> lock(mutex_);
  for (InputFeed& feed : feeds_) feed.close();
}

void InputFeeds::pullAll(int frames, int outRate, int64_t clockFrame) {
  for (InputFeed& feed : feeds_) {
    if (feed.running()) feed.pull(frames, outRate, clockFrame);
  }
}

const float* InputFeeds::block(int slot) const {
  if (slot < 0 || slot >= kMaxInputFeeds) return nullptr;
  return feeds_[slot].block();
}

int InputFeeds::channels(int slot) const {
  if (slot < 0 || slot >= kMaxInputFeeds) return 0;
  return feeds_[slot].channels();
}

std::vector<InputFeedStatus> InputFeeds::status() {
  std::lock_guard<std::mutex> lock(mutex_);
  std::vector<InputFeedStatus> out;
  for (int i = 0; i < kMaxInputFeeds; i++) {
    if (feeds_[i].inUse()) out.push_back(feeds_[i].status(i));
  }
  return out;
}

bool InputFeeds::list(std::vector<InputDeviceInfo>& out, std::string& error) const {
  if (testInputs_) {
    out.push_back({"test:tone", "Test tone (1 kHz, −12 dBFS)", 2, 0, false, true});
    out.push_back({"test:ramp", "Test ramp", 1, 0, false, true});
  }
  if (offline_) return true;
  ma_context context;
  if (ma_context_init(nullptr, 0, nullptr, &context) != MA_SUCCESS) {
    error = "no audio system to list inputs on";
    return false;
  }
  ma_device_info* playback = nullptr;
  ma_uint32 playbackCount = 0;
  ma_device_info* captures = nullptr;
  ma_uint32 captureCount = 0;
  if (ma_context_get_devices(&context, &playback, &playbackCount, &captures, &captureCount) == MA_SUCCESS) {
    for (ma_uint32 i = 0; i < captureCount; i++) {
      InputDeviceInfo info;
      info.id = captures[i].name;
      info.name = captures[i].name;
      info.isDefault = captures[i].isDefault != 0;
      ma_device_info detail;
      if (ma_context_get_device_info(&context, ma_device_type_capture, &captures[i].id, &detail) == MA_SUCCESS &&
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

}  // namespace ws
