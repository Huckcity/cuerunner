#include "drift.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace ws {
namespace {

/**
 * The controller's gains, on the fill error in seconds of buffer. Proportional 0.3 corrects
 * an excess over about three seconds; integral 0.02 gives the loop a natural frequency of
 * 0.14 rad/s, just past critical damping — slow enough that the correction is never heard as
 * pitch (a few parts per million once locked) and fast enough to lock a 1000 ppm clock error
 * inside half a minute. The nudge is held to ±0.5 %: no device clock is that far off, and a
 * ring that needs more has stalled and is resynced.
 */
constexpr double kProportional = 0.3;
constexpr double kIntegral = 0.02;
constexpr double kMaxAdjust = 0.005;
/** The fill is averaged over this long before the controller reads it, seconds. */
constexpr double kFillAverageSeconds = 1.0;
/** Headroom kept above the largest delivery and one block's need, ms. */
constexpr double kMarginMs = 3.0;
/**
 * Headroom learned from the writer: a delivery that arrives late enough to bring the buffer
 * within a quarter of the margin of running dry adds a millisecond, at most once a second
 * and to at most this much. A writer whose callbacks wander is given the room it needs
 * before it underruns rather than after, and one that does not keeps the latency it had.
 */
constexpr double kMaxLearnedMs = 40.0;
constexpr double kLearnStepMs = 1.0;
constexpr double kLearnCooldownSeconds = 1.0;

float catmullRom(float p0, float p1, float p2, float p3, float t) {
  const float t2 = t * t;
  const float t3 = t2 * t;
  return 0.5f * ((2.0f * p1) + (-p0 + p2) * t + (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3) * t2 +
                 (-p0 + 3.0f * p1 - 3.0f * p2 + p3) * t3);
}

}  // namespace

DriftRing::DriftRing() {
  for (auto& peak : peaks_) peak.store(0.0f, std::memory_order_relaxed);
}

void DriftRing::configure(int channels, int inRate, double latencyMs, int expectedChunk) {
  channels_ = std::clamp(channels, 1, kMaxOutputChannels);
  if (ring_.size() < static_cast<size_t>(kRingFrames) * static_cast<size_t>(channels_)) {
    ring_.assign(static_cast<size_t>(kRingFrames) * static_cast<size_t>(channels_), 0.0f);
  }
  inRate_.store(inRate > 0 ? inRate : 48000, std::memory_order_release);
  latencyMs_ = std::max(0.0, latencyMs);
  lastPushAt_.store(0.0, std::memory_order_relaxed);
  writeHead_.store(0, std::memory_order_relaxed);
  releasedHead_.store(0, std::memory_order_relaxed);
  maxChunk_.store(std::max(0, expectedChunk), std::memory_order_relaxed);
  underruns_.store(0);
  overruns_.store(0);
  resyncs_.store(0);
  latencyPublished_.store(0.0, std::memory_order_relaxed);
  targetPublished_.store(0.0, std::memory_order_relaxed);
  ratioPublished_.store(0.0, std::memory_order_relaxed);
  for (auto& peak : peaks_) peak.store(0.0f, std::memory_order_relaxed);
  resetRequested_.store(true, std::memory_order_release);
}

void DriftRing::setInRate(int rate) {
  if (rate <= 0 || rate == inRate_.load(std::memory_order_acquire)) return;
  inRate_.store(rate, std::memory_order_release);
  requestReset();
}

void DriftRing::push(const float* frames, int count, double at) {
  if (count <= 0 || channels_ <= 0 || ring_.empty()) return;
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
    const size_t slot = static_cast<size_t>((write + static_cast<uint64_t>(i)) & (kRingFrames - 1)) * stride;
    std::memcpy(&ring_[slot], frames + static_cast<size_t>(i) * stride, stride * sizeof(float));
  }
  if (count > maxChunk_.load(std::memory_order_relaxed)) maxChunk_.store(count, std::memory_order_relaxed);
  lastPushAt_.store(at, std::memory_order_relaxed);
  writeHead_.store(write + static_cast<uint64_t>(count), std::memory_order_release);
}

bool DriftRing::pull(float* out, int frames, int outRate, double now) {
  const size_t stride = static_cast<size_t>(channels_);
  if (frames <= 0 || outRate <= 0 || channels_ <= 0) return false;
  const int inRate = inRate_.load(std::memory_order_acquire);
  if (resetRequested_.exchange(false, std::memory_order_acq_rel) || inRate != lockedRate_) {
    primed_ = false;
    integral_ = 0.0;
    adjust_ = 0.0;
    learned_ = 0.0;
    sinceLearned_ = kLearnCooldownSeconds;
    lockedRate_ = inRate;
  }

  const double base = static_cast<double>(inRate) / static_cast<double>(outRate);
  const double need = static_cast<double>(frames) * base * (1.0 + kMaxAdjust) + 4.0;
  const double chunk = static_cast<double>(std::max(1, maxChunk_.load(std::memory_order_relaxed)));
  const double framesPerMs = static_cast<double>(inRate) / 1000.0;
  target_ = latencyMs_ > 0.0 ? std::max(need, latencyMs_ * framesPerMs)
                             : need + chunk + (kMarginMs + learned_) * framesPerMs;
  const double dt = static_cast<double>(frames) / static_cast<double>(outRate);
  sinceLearned_ += dt;
  const double write = static_cast<double>(writeHead_.load(std::memory_order_acquire));

  const auto silence = [&]() {
    std::memset(out, 0, static_cast<size_t>(frames) * stride * sizeof(float));
    return false;
  };

  if (!primed_) {
    // Nothing is played until the target is there to be held: starting short is an
    // underrun a block later.
    if (write < target_ + 2.0) return silence();
    readPos_ = write - target_;
    fillAverage_ = target_ + chunk / 2.0;
    primed_ = true;
  }

  double available = write - readPos_;
  // What the writer has made since it last delivered, estimated from when that was: the
  // buffer the controller holds is what is buffered on both sides of the writer's callback,
  // so a period handed over in one piece is not read as the buffer jumping by a period.
  // Without it, a writer whose period matches the reader's block reads as a buffer that does
  // not move at all between deliveries — and a clock error shows up as a step every few
  // seconds rather than a slope the controller can follow.
  const double sinceDelivery = now - lastPushAt_.load(std::memory_order_relaxed);
  const double undelivered = std::clamp(sinceDelivery * static_cast<double>(inRate), 0.0, chunk);
  if (available < need) {
    // The writer stopped delivering (or never kept up): silence, and lock again once the
    // buffer is back at its target — with more room, since the room it had was not enough.
    underruns_.fetch_add(1, std::memory_order_relaxed);
    learned_ = std::min(kMaxLearnedMs, learned_ + 2.0 * kLearnStepMs);
    primed_ = false;
    return silence();
  }
  if (latencyMs_ <= 0.0 && available - need < 0.25 * kMarginMs * framesPerMs && sinceLearned_ >= kLearnCooldownSeconds &&
      learned_ < kMaxLearnedMs) {
    learned_ += kLearnStepMs;
    sinceLearned_ = 0.0;
  }
  const double runaway = target_ + std::max(4.0 * target_, 0.2 * static_cast<double>(inRate));
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
  // The target is for what is delivered; the average also counts what is waiting on the
  // writer's side, half a period on average, so that half is where the two meet.
  const double error = (fillAverage_ - (target_ + chunk / 2.0)) / static_cast<double>(inRate);
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
  // The age of what is played, from when the writer made it: the buffer, plus half a
  // delivery on average — a sample waits on the writer's side until its whole period is
  // handed over.
  latencyPublished_.store(fillAverage_ * 1000.0 / static_cast<double>(inRate), std::memory_order_relaxed);
  targetPublished_.store(target_ * 1000.0 / static_cast<double>(inRate), std::memory_order_relaxed);
  ratioPublished_.store(adjust_ * 1e6, std::memory_order_relaxed);
  return true;
}

}  // namespace ws
