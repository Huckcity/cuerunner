// Loudness, the way a broadcast meter reads it: ITU-R BS.1770 as EBU R128 applies it.
//
// Integrated loudness is the mean power of the programme after K-weighting — a high shelf
// that models the head and a high pass that ignores rumble — over 400 ms blocks that overlap
// by three quarters, with two gates: blocks quieter than −70 LUFS are dropped outright, and
// then blocks more than 10 LU below the mean of what is left. That second gate is what keeps
// a cue with a long quiet tail reading as loud as its body sounds. The true peak is the
// highest the waveform reaches between its samples, read by oversampling four times (twice
// above 96 kHz) through an interpolation filter, because a signal whose samples stop short
// of full scale can still clip the converter that reconstructs it.
//
// The meter is pure arithmetic over interleaved floats, so the engine's whole-file scan and
// the native test drive the same code.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace ws {

/** A file's measurement, as the `loudness` verb answers it. */
struct LoudnessDTO {
  std::string filePath;
  /** Integrated loudness, LUFS; meaningless when `silent`. */
  double integratedLufs = 0.0;
  /** The highest inter-sample level, dBTP. */
  double truePeakDb = 0.0;
  /** The highest sample, dBFS. */
  double samplePeakDb = 0.0;
  /** Nothing in the file reached the absolute gate: it has no loudness to normalise. */
  bool silent = false;
  double durationMs = 0.0;
  int sampleRate = 0;
  int channels = 0;
};

class LoudnessMeter {
 public:
  LoudnessMeter(int sampleRate, int channels);
  /** Reads `frames` interleaved frames. */
  void feed(const float* samples, int64_t frames);
  /** Integrated loudness, LUFS, or false when no block passed the gates. */
  bool integrated(double& lufs) const;
  /** The true peak, linear (1.0 is full scale). */
  double truePeak() const { return truePeak_; }
  double samplePeak() const { return samplePeak_; }

 private:
  struct Biquad {
    double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;
  };
  struct ChannelState {
    double z1[2] = {0.0, 0.0};
    double z2[2] = {0.0, 0.0};
    std::vector<float> history;  // the interpolator's last taps, newest last
    int historyAt = 0;
  };

  double weight(int channel) const;

  int sampleRate_;
  int channels_;
  Biquad shelf_;
  Biquad highPass_;
  int oversample_ = 4;
  int tapsPerPhase_ = 32;
  std::vector<double> phases_;  // oversample_ x tapsPerPhase_
  std::vector<ChannelState> state_;

  int64_t subBlockFrames_ = 0;
  int64_t subBlockFill_ = 0;
  double subBlockEnergy_ = 0.0;   // channel-weighted sum of squares in the sub-block so far
  std::vector<double> subBlocks_;  // channel-weighted mean square per 100 ms sub-block
  double truePeak_ = 0.0;
  double samplePeak_ = 0.0;
};

}  // namespace ws
