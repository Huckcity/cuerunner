// windows.h, which miniaudio pulls in, defines `min` and `max` as macros (see engine.cpp).
#if defined(_WIN32)
#define NOMINMAX
#endif

#include "miniaudio_setup.h"

#include "ltc.h"

#include "source.h"
#include "util.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace ws {

// ── Rates and the label arithmetic ──────────────────────────────────────────

bool ltcRateFromName(const std::string& name, LtcRate& out) {
  if (name == "24") out = LtcRate::R24;
  else if (name == "25") out = LtcRate::R25;
  else if (name == "29.97df") out = LtcRate::R2997Df;
  else if (name == "29.97") out = LtcRate::R2997;
  else if (name == "30") out = LtcRate::R30;
  else return false;
  return true;
}

const char* ltcRateName(LtcRate rate) {
  switch (rate) {
    case LtcRate::R24: return "24";
    case LtcRate::R25: return "25";
    case LtcRate::R2997Df: return "29.97df";
    case LtcRate::R2997: return "29.97";
    case LtcRate::R30: return "30";
  }
  return "25";
}

int ltcNominal(LtcRate rate) {
  switch (rate) {
    case LtcRate::R24: return 24;
    case LtcRate::R25: return 25;
    default: return 30;
  }
}

double ltcFps(LtcRate rate) {
  switch (rate) {
    case LtcRate::R2997Df:
    case LtcRate::R2997: return 30000.0 / 1001.0;
    default: return static_cast<double>(ltcNominal(rate));
  }
}

bool ltcDropFrame(LtcRate rate) { return rate == LtcRate::R2997Df; }

namespace {
// A ten-minute block of drop-frame holds 17982 frames: one minute of 1800 and nine of 1798.
constexpr int64_t kDfPer10Min = 17982;
constexpr int64_t kDfPerMin = 1798;
}  // namespace

int64_t ltcFramesPerDay(LtcRate rate) {
  if (ltcDropFrame(rate)) return kDfPer10Min * 6 * 24;
  return static_cast<int64_t>(ltcNominal(rate)) * 60 * 60 * 24;
}

LtcFields ltcFieldsFromFrames(int64_t frames, LtcRate rate) {
  const int64_t day = ltcFramesPerDay(rate);
  int64_t n = ((frames % day) + day) % day;
  if (ltcDropFrame(rate)) {
    const int64_t tens = n / kDfPer10Min;
    const int64_t rest = n % kDfPer10Min;
    const int64_t skipped = rest < 2 ? 0 : 2 * ((rest - 2) / kDfPerMin);
    n += 18 * tens + skipped;
  }
  const int64_t nominal = ltcNominal(rate);
  LtcFields fields;
  fields.hours = static_cast<int>(n / (nominal * 3600));
  fields.minutes = static_cast<int>((n / (nominal * 60)) % 60);
  fields.seconds = static_cast<int>((n / nominal) % 60);
  fields.frames = static_cast<int>(n % nominal);
  fields.dropFrame = ltcDropFrame(rate);
  return fields;
}

int64_t ltcFramesFromFields(const LtcFields& fields, LtcRate rate) {
  const int64_t nominal = ltcNominal(rate);
  const int64_t labelled =
      ((static_cast<int64_t>(fields.hours) * 60 + fields.minutes) * 60 + fields.seconds) * nominal + fields.frames;
  if (!ltcDropFrame(rate)) return labelled;
  const int64_t minutes = static_cast<int64_t>(fields.hours) * 60 + fields.minutes;
  return labelled - 2 * (minutes - minutes / 10);
}

// ── The 80-bit word ──────────────────────────────────────────────────────────

namespace {

// Bits 64..79, in the order they are sent: what marks the end of a frame read forwards.
constexpr uint8_t kSync[16] = {0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1};

void putBits(uint8_t bits[80], int first, int count, uint32_t value) {
  for (int i = 0; i < count; i++) bits[first + i] = static_cast<uint8_t>((value >> i) & 1u);
}

uint32_t getBits(const uint8_t bits[80], int first, int count) {
  uint32_t value = 0;
  for (int i = 0; i < count; i++) value |= static_cast<uint32_t>(bits[first + i] & 1u) << i;
  return value;
}

}  // namespace

void ltcEncodeBits(const LtcFields& f, bool twentyFive, uint8_t bits[80]) {
  std::memset(bits, 0, 80);
  const uint32_t ub = f.userBits;
  putBits(bits, 0, 4, static_cast<uint32_t>(f.frames % 10));
  putBits(bits, 4, 4, ub & 0xf);
  putBits(bits, 8, 2, static_cast<uint32_t>(f.frames / 10));
  bits[10] = f.dropFrame ? 1 : 0;
  bits[11] = f.colorFrame ? 1 : 0;
  putBits(bits, 12, 4, (ub >> 4) & 0xf);
  putBits(bits, 16, 4, static_cast<uint32_t>(f.seconds % 10));
  putBits(bits, 20, 4, (ub >> 8) & 0xf);
  putBits(bits, 24, 3, static_cast<uint32_t>(f.seconds / 10));
  putBits(bits, 28, 4, (ub >> 12) & 0xf);
  putBits(bits, 32, 4, static_cast<uint32_t>(f.minutes % 10));
  putBits(bits, 36, 4, (ub >> 16) & 0xf);
  putBits(bits, 40, 3, static_cast<uint32_t>(f.minutes / 10));
  putBits(bits, 44, 4, (ub >> 20) & 0xf);
  putBits(bits, 48, 4, static_cast<uint32_t>(f.hours % 10));
  putBits(bits, 52, 4, (ub >> 24) & 0xf);
  putBits(bits, 56, 2, static_cast<uint32_t>(f.hours / 10));
  putBits(bits, 60, 4, (ub >> 28) & 0xf);
  for (int i = 0; i < 16; i++) bits[64 + i] = kSync[i];
  // The polarity bit makes the count of ones even, so every frame begins on the same edge.
  const int polarity = twentyFive ? 59 : 27;
  int ones = 0;
  for (int i = 0; i < 80; i++) ones += bits[i];
  bits[polarity] = static_cast<uint8_t>(ones & 1);
}

bool ltcDecodeBits(const uint8_t bits[80], LtcFields& out) {
  for (int i = 0; i < 16; i++) {
    if (bits[64 + i] != kSync[i]) return false;
  }
  const uint32_t fu = getBits(bits, 0, 4), ft = getBits(bits, 8, 2);
  const uint32_t su = getBits(bits, 16, 4), st = getBits(bits, 24, 3);
  const uint32_t mu = getBits(bits, 32, 4), mt = getBits(bits, 40, 3);
  const uint32_t hu = getBits(bits, 48, 4), ht = getBits(bits, 56, 2);
  if (fu > 9 || su > 9 || st > 5 || mu > 9 || mt > 5 || hu > 9) return false;
  LtcFields f;
  f.frames = static_cast<int>(ft * 10 + fu);
  f.seconds = static_cast<int>(st * 10 + su);
  f.minutes = static_cast<int>(mt * 10 + mu);
  f.hours = static_cast<int>(ht * 10 + hu);
  if (f.frames > 29 || f.hours > 23) return false;
  f.dropFrame = bits[10] != 0;
  f.colorFrame = bits[11] != 0;
  f.userBits = getBits(bits, 4, 4) | (getBits(bits, 12, 4) << 4) | (getBits(bits, 20, 4) << 8) |
               (getBits(bits, 28, 4) << 12) | (getBits(bits, 36, 4) << 16) | (getBits(bits, 44, 4) << 20) |
               (getBits(bits, 52, 4) << 24) | (getBits(bits, 60, 4) << 28);
  out = f;
  return true;
}

// ── The encoder ──────────────────────────────────────────────────────────────

void LtcEncoder::start(LtcRate rate, int64_t frame, float gain, int sampleRate) {
  rate_ = rate;
  frame_ = frame;
  gain_ = gain;
  cell_ = static_cast<double>(sampleRate) / (ltcFps(rate) * 80.0);
  phase_ = 0.0;
  bit_ = 0;
  midDone_ = false;
  level_ = 1.0f;
  paused_ = false;
  pendingPause_ = false;
  pendingLocate_ = -1;
  running_ = true;
  loadFrame();
}

void LtcEncoder::loadFrame() {
  ltcEncodeBits(ltcFieldsFromFrames(frame_, rate_), rate_ == LtcRate::R25, bits_);
}

void LtcEncoder::render(float* out, int frames, int stride) {
  if (!running_ || paused_) return;
  for (int i = 0; i < frames && !paused_; i++) {
    out[static_cast<size_t>(i) * static_cast<size_t>(stride)] += level_ * gain_;
    phase_ += 1.0;
    // A 1 flips in the middle of its cell as well as at the edge; a 0 only at the edge.
    if (!midDone_ && bits_[bit_] != 0 && phase_ >= cell_ * 0.5) {
      level_ = -level_;
      midDone_ = true;
    }
    if (phase_ >= cell_) {
      phase_ -= cell_;
      level_ = -level_;
      midDone_ = false;
      if (++bit_ == 80) {
        bit_ = 0;
        if (pendingLocate_ >= 0) {
          frame_ = pendingLocate_;
          pendingLocate_ = -1;
        } else {
          frame_ = (frame_ + 1) % ltcFramesPerDay(rate_);
        }
        loadFrame();
        if (pendingPause_) {
          pendingPause_ = false;
          paused_ = true;
          phase_ = 0.0;
          level_ = 1.0f;
        }
      }
    }
  }
}

// ── The decoder ──────────────────────────────────────────────────────────────

LtcDecoder::LtcDecoder(int sampleRate) : sampleRate_(sampleRate) {
  // From a 30 fps tape at four times speed to a 24 fps one at a quarter: far past what a
  // show runs at, and narrow enough that hiss between frames is never learned as a cell.
  // A pole for a high-pass near 10 Hz: far below the slowest cell, well above any drift.
  dcPole_ = 1.0 - (2.0 * 3.14159265358979323846 * 10.0) / static_cast<double>(sampleRate);
  minCell_ = static_cast<double>(sampleRate) / (30.0 * 80.0 * 4.0);
  maxCell_ = static_cast<double>(sampleRate) / (24.0 * 80.0 * 0.25);
  reset();
}

void LtcDecoder::reset() {
  sample_ = 0;
  previous_ = 0.0;
  dcIn_ = 0.0;
  dcOut_ = 0.0;
  envelope_ = 0.0f;
  sign_ = 0;
  lastEdge_ = -1.0;
  cell_ = 0.0;
  halfPending_ = false;
  filled_ = 0;
}

bool LtcDecoder::step(float sample, LtcDecoded& out) {
  const double raw = static_cast<double>(sample);
  dcOut_ = raw - dcIn_ + dcPole_ * dcOut_;
  dcIn_ = raw;
  const double x = dcOut_;
  // The envelope rises at once and falls over about 20 ms, so a fade or a quieter source
  // is followed within a frame or two and the threshold stays a fixed share of the line.
  const float magnitude = static_cast<float>(std::fabs(x));
  const float decay = 1.0f - 1.0f / (0.02f * static_cast<float>(sampleRate_));
  envelope_ = std::max(magnitude, envelope_ * decay);
  const double threshold = 0.3 * static_cast<double>(envelope_);
  bool completed = false;
  if (envelope_ > 1e-4f) {
    int next = sign_;
    if (x > threshold) next = 1;
    else if (x < -threshold) next = -1;
    if (next != sign_ && sign_ != 0) {
      // The edge is placed between the two samples where the line crossed the middle.
      double at = static_cast<double>(sample_);
      if ((previous_ < 0.0) != (x < 0.0) && previous_ != x) at = static_cast<double>(sample_) - x / (x - previous_);
      transition(at, out, completed);
    }
    sign_ = next;
  }
  previous_ = x;
  sample_++;
  return completed;
}

void LtcDecoder::transition(double at, LtcDecoded& out, bool& completed) {
  if (lastEdge_ < 0.0) {
    lastEdge_ = at;
    return;
  }
  const double interval = at - lastEdge_;
  lastEdge_ = at;
  if (interval < minCell_ * 0.4 || interval > maxCell_ * 1.2) {
    // A spike, or a silence: nothing either side of it belongs to the same word.
    halfPending_ = false;
    filled_ = 0;
    return;
  }
  if (cell_ <= 0.0) {
    cell_ = interval;
    return;
  }
  if (interval > cell_ * 1.5) {
    // Longer than any cell learned so far: what was learned was a half. Start again with
    // this as the cell, and lose the bits read on the wrong measure.
    cell_ = interval;
    halfPending_ = false;
    filled_ = 0;
    return;
  }
  if (interval > cell_ * 0.75) {
    if (halfPending_) {
      // A half with no partner: the word is broken, and the next sync starts it again.
      halfPending_ = false;
      filled_ = 0;
    }
    cell_ += 0.1 * (interval - cell_);
    pushBit(0, at, out, completed);
  } else if (interval < cell_ * 0.25) {
    halfPending_ = false;
    filled_ = 0;
  } else if (halfPending_) {
    halfPending_ = false;
    cell_ += 0.05 * (interval * 2.0 - cell_);
    pushBit(1, at, out, completed);
  } else {
    halfPending_ = true;
  }
  cell_ = std::min(maxCell_, std::max(minCell_, cell_));
}

void LtcDecoder::pushBit(uint8_t bit, double at, LtcDecoded& out, bool& completed) {
  std::memmove(window_, window_ + 1, 79);
  window_[79] = bit;
  if (filled_ < 80) filled_++;
  if (filled_ < 80) return;

  uint8_t bits[80];
  bool forward = true;
  for (int i = 0; i < 16; i++) {
    if (window_[64 + i] != kSync[i]) {
      forward = false;
      break;
    }
  }
  bool reverse = false;
  if (!forward) {
    // Backwards, the sync word arrives first and reversed: bit 79 first, down to 64.
    reverse = true;
    for (int i = 0; i < 16; i++) {
      if (window_[i] != kSync[15 - i]) {
        reverse = false;
        break;
      }
    }
  }
  if (!forward && !reverse) return;
  for (int i = 0; i < 80; i++) bits[i] = forward ? window_[i] : window_[79 - i];
  LtcFields fields;
  if (!ltcDecodeBits(bits, fields)) return;
  out.fields = fields;
  out.endSample = static_cast<int64_t>(std::llround(at));
  out.cellSamples = cell_;
  out.reverse = reverse;
  out.atMs = 0.0;
  completed = true;
  // The next word is the next 80 bits.
  filled_ = 0;
}

// ── The engine's LTC voices ─────────────────────────────────────────────────

bool LtcOutputs::post(const Command& command) {
  std::lock_guard<std::mutex> lock(postMutex_);
  Command placed = command;
  int slot = -1;
  {
    std::lock_guard<std::mutex> ids(idMutex_);
    for (int i = 0; i < kSlots; i++) {
      if (publishedIds_[i] == command.id) slot = i;
    }
    if (slot < 0 && command.op == Command::Start) {
      for (int i = 0; i < kSlots; i++) {
        if (publishedIds_[i].empty()) {
          slot = i;
          break;
        }
      }
    }
    if (slot < 0) return false;
    if (command.op == Command::Start) publishedIds_[slot] = command.id;
    if (command.op == Command::Stop) publishedIds_[slot].clear();
  }
  // The slot index travels in the first byte of the id: the audio thread only needs the slot.
  placed.id[0] = static_cast<char>(slot);
  placed.id[1] = 0;
  return queue_.push(placed);
}

void LtcOutputs::apply(const Command& command, int sampleRate) {
  const int index = static_cast<int>(static_cast<unsigned char>(command.id[0]));
  if (index < 0 || index >= kSlots) return;
  Slot& slot = slots_[index];
  switch (command.op) {
    case Command::Start:
      slot.channel = command.channel;
      slot.encoder.start(command.rate, command.frame, command.gain, sampleRate);
      slot.rate.store(static_cast<int>(command.rate), std::memory_order_relaxed);
      slot.channelPublished.store(command.channel, std::memory_order_relaxed);
      slot.state.store(1, std::memory_order_release);
      break;
    case Command::Stop:
      slot.encoder.stop();
      slot.state.store(0, std::memory_order_release);
      break;
    case Command::Pause:
      slot.encoder.pause();
      slot.state.store(2, std::memory_order_release);
      break;
    case Command::Resume:
      slot.encoder.resume();
      slot.state.store(1, std::memory_order_release);
      break;
    case Command::Locate:
      slot.encoder.locate(command.frame);
      break;
  }
  slot.frame.store(slot.encoder.frame(), std::memory_order_relaxed);
}

void LtcOutputs::render(float* out, int frames, int channels, int sampleRate) {
  Command command;
  while (queue_.pop(command)) apply(command, sampleRate);
  for (Slot& slot : slots_) {
    if (!slot.encoder.running()) continue;
    if (slot.channel >= 0 && slot.channel < channels) slot.encoder.render(out + slot.channel, frames, channels);
    slot.frame.store(slot.encoder.frame(), std::memory_order_relaxed);
  }
}

std::vector<LtcOutputs::SlotStatus> LtcOutputs::status() const {
  std::vector<SlotStatus> out;
  std::lock_guard<std::mutex> ids(idMutex_);
  for (int i = 0; i < kSlots; i++) {
    if (publishedIds_[i].empty()) continue;
    SlotStatus entry;
    entry.id = publishedIds_[i];
    entry.channel = slots_[i].channelPublished.load(std::memory_order_relaxed);
    entry.rate = static_cast<LtcRate>(slots_[i].rate.load(std::memory_order_relaxed));
    entry.frame = slots_[i].frame.load(std::memory_order_relaxed);
    const int state = slots_[i].state.load(std::memory_order_acquire);
    entry.running = state != 0;
    entry.paused = state == 2;
    out.push_back(entry);
  }
  return out;
}

// ── Listening on a capture device ───────────────────────────────────────────

struct LtcInput::Device {
  ma_context context;
  ma_device device;
  bool contextReady = false;
  bool deviceReady = false;
};

namespace {

void captureCallback(ma_device* device, void* output, const void* input, ma_uint32 frameCount) {
  (void)output;
  auto* self = static_cast<LtcInput*>(device->pUserData);
  if (self != nullptr && input != nullptr) {
    self->capture(static_cast<const float*>(input), static_cast<int>(frameCount),
                  static_cast<int>(device->capture.channels));
  }
}

}  // namespace

LtcInput::LtcInput() = default;

LtcInput::~LtcInput() { close(); }

bool LtcInput::listen(const std::string& deviceName, int channel, std::string& error) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (device_ != nullptr) {
    listening_.store(false, std::memory_order_release);
    if (device_->deviceReady) ma_device_uninit(&device_->device);
    if (device_->contextReady) ma_context_uninit(&device_->context);
    device_.reset();
  }
  auto device = std::make_unique<Device>();
  if (ma_context_init(nullptr, 0, nullptr, &device->context) != MA_SUCCESS) {
    error = "no audio system to listen on";
    return false;
  }
  device->contextReady = true;

  ma_device_info* playback = nullptr;
  ma_uint32 playbackCount = 0;
  ma_device_info* captures = nullptr;
  ma_uint32 captureCount = 0;
  const ma_device_id* chosen = nullptr;
  std::string chosenName = "the default input";
  if (ma_context_get_devices(&device->context, &playback, &playbackCount, &captures, &captureCount) == MA_SUCCESS) {
    for (ma_uint32 i = 0; i < captureCount; i++) {
      if (!deviceName.empty() && deviceName == captures[i].name) {
        chosen = &captures[i].id;
        chosenName = captures[i].name;
      }
    }
  }
  if (!deviceName.empty() && chosen == nullptr) {
    ma_context_uninit(&device->context);
    error = "no input named \"" + deviceName + "\"";
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
    error = "could not open " + chosenName;
    return false;
  }
  device->deviceReady = true;
  if (channel < 0 || channel >= static_cast<int>(device->device.capture.channels)) {
    ma_device_uninit(&device->device);
    ma_context_uninit(&device->context);
    error = chosenName + " has no channel " + std::to_string(channel + 1);
    return false;
  }
  channel_ = channel;
  sampleRate_ = static_cast<int>(device->device.sampleRate);
  decoder_ = std::make_unique<LtcDecoder>(sampleRate_);
  description_ = chosenName + ", channel " + std::to_string(channel + 1);
  device_ = std::move(device);
  listening_.store(true, std::memory_order_release);
  if (ma_device_start(&device_->device) != MA_SUCCESS) {
    listening_.store(false, std::memory_order_release);
    ma_device_uninit(&device_->device);
    ma_context_uninit(&device_->context);
    device_.reset();
    error = "could not start " + chosenName;
    return false;
  }
  return true;
}

void LtcInput::close() {
  std::lock_guard<std::mutex> lock(mutex_);
  listening_.store(false, std::memory_order_release);
  if (device_ == nullptr) return;
  if (device_->deviceReady) ma_device_uninit(&device_->device);
  if (device_->contextReady) ma_context_uninit(&device_->context);
  device_.reset();
  description_.clear();
}

void LtcInput::capture(const float* frames, int count, int channels) {
  if (!listening_.load(std::memory_order_acquire) || decoder_ == nullptr || channels <= 0) return;
  const double arrived = steadyNowMs();
  const double sampleMs = 1000.0 / static_cast<double>(sampleRate_);
  for (int i = 0; i < count; i++) {
    LtcDecoded decoded;
    if (decoder_->step(frames[static_cast<size_t>(i) * static_cast<size_t>(channels) + static_cast<size_t>(channel_)],
                       decoded)) {
      decoded.atMs = arrived - static_cast<double>(count - 1 - i) * sampleMs;
      queue_.push(decoded);  // a full queue drops the oldest reader's news, never blocks
    }
  }
}

std::vector<LtcDecoded> LtcInput::drain(size_t limit) {
  std::vector<LtcDecoded> out;
  LtcDecoded decoded;
  while (out.size() < limit && queue_.pop(decoded)) out.push_back(decoded);
  return out;
}

std::string LtcInput::description() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return description_;
}

bool ltcCaptureDevices(std::vector<std::pair<std::string, std::string>>& out, std::string& error) {
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
    for (ma_uint32 i = 0; i < captureCount; i++) out.emplace_back(captures[i].name, captures[i].name);
  }
  ma_context_uninit(&context);
  return true;
}

bool ltcDecodeFile(const std::string& path, int channel, std::vector<LtcDecoded>& out, int& sampleRate,
                   std::string& error) {
  std::unique_ptr<Source> source = openSource(path, error);
  if (source == nullptr) return false;
  const SourceInfo info = source->info();
  if (channel < 0 || channel >= info.channels) {
    error = "the file has no channel " + std::to_string(channel + 1);
    return false;
  }
  sampleRate = info.sampleRate;
  LtcDecoder decoder(info.sampleRate);
  std::vector<float> block(static_cast<size_t>(4096) * static_cast<size_t>(info.channels));
  for (;;) {
    const int64_t got = source->readFrames(block.data(), 4096);
    if (got <= 0) break;
    decoder.feed(block.data() + channel, static_cast<int>(got), info.channels,
                 [&](const LtcDecoded& decoded) { out.push_back(decoded); });
  }
  return true;
}

int printLtcDecode(const std::string& path, int channel) {
  std::vector<LtcDecoded> frames;
  int sampleRate = 0;
  std::string error;
  if (!ltcDecodeFile(path, channel, frames, sampleRate, error)) {
    std::printf("{\"ok\":false,\"error\":\"%s\"}\n", error.c_str());
    return 1;
  }
  std::printf("{\"ok\":true,\"sampleRate\":%d,\"frames\":[", sampleRate);
  for (size_t i = 0; i < frames.size(); i++) {
    const LtcDecoded& d = frames[i];
    std::printf("%s{\"hours\":%d,\"minutes\":%d,\"seconds\":%d,\"frames\":%d,\"dropFrame\":%s,"
                "\"reverse\":%s,\"endSample\":%lld,\"cellSamples\":%.4f}",
                i == 0 ? "" : ",", d.fields.hours, d.fields.minutes, d.fields.seconds, d.fields.frames,
                d.fields.dropFrame ? "true" : "false", d.reverse ? "true" : "false",
                static_cast<long long>(d.endSample), d.cellSamples);
  }
  std::printf("]}\n");
  return 0;
}

}  // namespace ws
