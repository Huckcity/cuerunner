#include "loudness.h"

#include <algorithm>
#include <cmath>

namespace ws {
namespace {

constexpr double kPi = 3.14159265358979323846;
/** BS.1770's offset, which puts a full-scale 1 kHz sine in one channel at −3.01 LUFS. */
constexpr double kLoudnessOffset = -0.691;
constexpr double kAbsoluteGate = -70.0;
constexpr double kRelativeGate = -10.0;

double loudnessOf(double meanSquare) { return kLoudnessOffset + 10.0 * std::log10(meanSquare); }

}  // namespace

LoudnessMeter::LoudnessMeter(int sampleRate, int channels)
    : sampleRate_(std::max(1, sampleRate)), channels_(std::max(1, channels)) {
  const double fs = static_cast<double>(sampleRate_);
  // The two stages of the K-weighting filter, from the analogue prototypes BS.1770's 48 kHz
  // coefficients were drawn from, so a file at any rate is weighted by the same curve.
  {
    const double f0 = 1681.974450955533;
    const double gainDb = 3.999843853973347;
    const double q = 0.7071752369554196;
    const double k = std::tan(kPi * f0 / fs);
    const double vh = std::pow(10.0, gainDb / 20.0);
    const double vb = std::pow(vh, 0.4996667741545416);
    const double a0 = 1.0 + k / q + k * k;
    shelf_.b0 = (vh + vb * k / q + k * k) / a0;
    shelf_.b1 = 2.0 * (k * k - vh) / a0;
    shelf_.b2 = (vh - vb * k / q + k * k) / a0;
    shelf_.a1 = 2.0 * (k * k - 1.0) / a0;
    shelf_.a2 = (1.0 - k / q + k * k) / a0;
  }
  {
    const double f0 = 38.13547087602444;
    const double q = 0.5003270373238773;
    const double k = std::tan(kPi * f0 / fs);
    const double a0 = 1.0 + k / q + k * k;
    highPass_.b0 = 1.0;
    highPass_.b1 = -2.0;
    highPass_.b2 = 1.0;
    highPass_.a1 = 2.0 * (k * k - 1.0) / a0;
    highPass_.a2 = (1.0 - k / q + k * k) / a0;
  }

  // The true-peak interpolator: a windowed-sinc low pass at the original Nyquist, split
  // into one fractional-delay filter per output phase, each normalised to unity at DC.
  oversample_ = sampleRate_ < 96000 ? 4 : (sampleRate_ < 192000 ? 2 : 1);
  const int length = oversample_ * tapsPerPhase_;
  std::vector<double> prototype(static_cast<size_t>(length));
  const double centre = static_cast<double>(length - 1) / 2.0;
  for (int n = 0; n < length; n++) {
    const double x = (static_cast<double>(n) - centre) / static_cast<double>(oversample_);
    const double sinc = x == 0.0 ? 1.0 : std::sin(kPi * x) / (kPi * x);
    // Blackman window across the whole prototype.
    const double w = 0.42 - 0.5 * std::cos(2.0 * kPi * n / (length - 1)) + 0.08 * std::cos(4.0 * kPi * n / (length - 1));
    prototype[static_cast<size_t>(n)] = sinc * w;
  }
  phases_.assign(static_cast<size_t>(length), 0.0);
  for (int phase = 0; phase < oversample_; phase++) {
    double sum = 0.0;
    for (int tap = 0; tap < tapsPerPhase_; tap++) sum += prototype[static_cast<size_t>(phase + tap * oversample_)];
    for (int tap = 0; tap < tapsPerPhase_; tap++) {
      phases_[static_cast<size_t>(phase * tapsPerPhase_ + tap)] =
          prototype[static_cast<size_t>(phase + tap * oversample_)] / (sum != 0.0 ? sum : 1.0);
    }
  }

  state_.resize(static_cast<size_t>(channels_));
  for (ChannelState& channel : state_) channel.history.assign(static_cast<size_t>(tapsPerPhase_), 0.0f);
  subBlockFrames_ = std::max<int64_t>(1, static_cast<int64_t>(std::llround(fs * 0.1)));
}

/** BS.1770's channel weights: the surrounds of a 5.1 file count 1.41, its LFE not at all. */
double LoudnessMeter::weight(int channel) const {
  if (channels_ == 6) {
    if (channel == 3) return 0.0;
    if (channel >= 4) return 1.41;
  }
  return 1.0;
}

void LoudnessMeter::feed(const float* samples, int64_t frames) {
  for (int64_t frame = 0; frame < frames; frame++) {
    const float* values = samples + static_cast<size_t>(frame) * static_cast<size_t>(channels_);
    double weighted = 0.0;
    for (int c = 0; c < channels_; c++) {
      const double x = static_cast<double>(values[c]);
      ChannelState& state = state_[static_cast<size_t>(c)];

      // K-weighting, two direct-form-II-transposed sections.
      const double y1 = shelf_.b0 * x + state.z1[0];
      state.z1[0] = shelf_.b1 * x - shelf_.a1 * y1 + state.z2[0];
      state.z2[0] = shelf_.b2 * x - shelf_.a2 * y1;
      const double y2 = highPass_.b0 * y1 + state.z1[1];
      state.z1[1] = highPass_.b1 * y1 - highPass_.a1 * y2 + state.z2[1];
      state.z2[1] = highPass_.b2 * y1 - highPass_.a2 * y2;
      weighted += weight(c) * y2 * y2;

      // Peaks: the sample's own, and the waveform's between this sample and the last.
      const double level = std::fabs(x);
      if (level > samplePeak_) samplePeak_ = level;
      state.history[static_cast<size_t>(state.historyAt)] = values[c];
      state.historyAt = (state.historyAt + 1) % tapsPerPhase_;
      if (oversample_ == 1) {
        if (level > truePeak_) truePeak_ = level;
        continue;
      }
      for (int phase = 0; phase < oversample_; phase++) {
        double y = 0.0;
        const double* taps = &phases_[static_cast<size_t>(phase * tapsPerPhase_)];
        // tap 0 meets the newest sample.
        int at = state.historyAt - 1;
        for (int tap = 0; tap < tapsPerPhase_; tap++) {
          if (at < 0) at += tapsPerPhase_;
          y += taps[tap] * static_cast<double>(state.history[static_cast<size_t>(at)]);
          at--;
        }
        const double peak = std::fabs(y);
        if (peak > truePeak_) truePeak_ = peak;
      }
    }
    subBlockEnergy_ += weighted;
    if (++subBlockFill_ == subBlockFrames_) {
      subBlocks_.push_back(subBlockEnergy_ / static_cast<double>(subBlockFrames_));
      subBlockEnergy_ = 0.0;
      subBlockFill_ = 0;
    }
  }
}

bool LoudnessMeter::integrated(double& lufs) const {
  // Each gating block is four sub-blocks: 400 ms, stepped by 100 ms.
  if (subBlocks_.size() < 4) return false;
  std::vector<double> blocks;
  blocks.reserve(subBlocks_.size() - 3);
  for (size_t i = 0; i + 3 < subBlocks_.size(); i++) {
    const double meanSquare = (subBlocks_[i] + subBlocks_[i + 1] + subBlocks_[i + 2] + subBlocks_[i + 3]) / 4.0;
    if (meanSquare > 0.0 && loudnessOf(meanSquare) > kAbsoluteGate) blocks.push_back(meanSquare);
  }
  if (blocks.empty()) return false;
  double sum = 0.0;
  for (double block : blocks) sum += block;
  const double relativeGate = loudnessOf(sum / static_cast<double>(blocks.size())) + kRelativeGate;
  double gatedSum = 0.0;
  size_t gated = 0;
  for (double block : blocks) {
    if (loudnessOf(block) > relativeGate) {
      gatedSum += block;
      gated++;
    }
  }
  if (gated == 0) return false;
  lufs = loudnessOf(gatedSum / static_cast<double>(gated));
  return true;
}

}  // namespace ws
