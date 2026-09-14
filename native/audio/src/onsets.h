// Onset (transient) detection: where a note or a hit begins in a media file.
//
// Spectral flux over Hann-windowed frames, with the threshold taken from the flux's own
// rolling median rather than from a fixed number, because a quiet acoustic take and a
// slammed drum are four orders of magnitude apart. The detector is fed as the samples
// are read, so a file never has to be held in memory and the scan can stop the moment
// the caller's cap is reached. Every buffer is sized in the constructor and feeding
// allocates nothing: this runs on a command thread, beside the mixer but never in it.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace ws {

/**
 * A radix-2 iterative FFT of one fixed size, with its tables built once: the scan runs
 * a transform per hop, so twiddles recomputed per frame would cost more than the
 * transform does. Frames are real, so pairs are packed into a half-size complex
 * transform and untangled afterwards — the same bins for half the work.
 */
class FrameFft {
 public:
  explicit FrameFft(int size);

  /** Fills `magnitudes` (size/2 - 1 entries) with bins 1..size/2-1 of `frame`. */
  void magnitudes(const double* frame, double* magnitudes);

 private:
  void transform();

  int size_ = 0;
  int half_ = 0;
  std::vector<double> re_;
  std::vector<double> im_;
  std::vector<double> twiddleCos_;
  std::vector<double> twiddleSin_;
  std::vector<double> untangleCos_;
  std::vector<double> untangleSin_;
  std::vector<int> reverse_;
};

/**
 * Spectral-flux onset detector.
 *
 * A frame's threshold comes from the flux of the frames around it — half a window
 * behind and half ahead — so it can only be judged once that much of the file's future
 * has arrived, and the answer is therefore independent of the chunk sizes the reader
 * happens to produce. The lag is the point: a file that opens mid-note has no past for
 * a threshold to stand on, and judged one-sided its own opening ripple would read as a
 * hit. (Reported times are unaffected — the frame is still the frame it was.)
 *
 * `sensitivity` scales the adaptive threshold — 1.0 is the default, higher is stricter
 * and finds fewer onsets — and `maxOnsets` caps the answer; both are the caller's
 * business to make sane (`Engine::onsets` clamps sensitivity to a workable range and
 * turns a missing cap into kMaxOnsets), so what arrives here is used as given. Once the
 * cap has been reached `feed` reports it, and the caller stops reading: the tail of the
 * file is never scanned.
 */
class OnsetDetector {
 public:
  OnsetDetector(int sampleRate, double sensitivity, int maxOnsets);

  /**
   * Feeds interleaved samples, in whatever chunk sizes the reader produces. Channels
   * past the first two are dropped and the first two are averaged: an onset is a
   * property of the moment, not of where the sound was placed in the image.
   *
   * Returns false once the cap has been reached; feeding again does nothing.
   */
  bool feed(const float* samples, int64_t frames, int channels);

  /** Judges the frames the lag still holds back, and closes the run that is open. */
  void finish();

  const std::vector<double>& onsetsMs() const { return onsetsMs_; }
  /** True when the scan stopped because it already had `maxOnsets` entries. */
  bool capped() const { return capped_; }

 private:
  void analyseFrame();
  void decide(int64_t frame);
  void accept(int64_t frame, double flux);
  double frameTimeMs(int64_t frame) const;
  double fluxBack(size_t back) const;
  double ringMedian();
  double ringDeviation(double median);
  size_t ringStart() const;

  int sampleRate_ = 0;
  int hop_ = 0;
  int frameSize_ = 0;
  int binCount_ = 0;
  int windowLength_ = 0;
  int spacingFrames_ = 0;
  int maxOnsets_ = 0;
  double sensitivity_ = 1.0;

  FrameFft fft_;
  std::vector<double> hann_;
  std::vector<double> windowed_;
  std::vector<double> spectrum_;
  std::vector<double> previous_;
  std::vector<float> samples_;
  size_t start_ = 0;
  size_t end_ = 0;
  int64_t frameIndex_ = 0;
  bool hasPrevious_ = false;

  std::vector<double> fluxRing_;
  size_t ringWrite_ = 0;
  size_t ringCount_ = 0;
  int64_t judged_ = 0;
  std::vector<double> scratch_;
  std::vector<double> deviations_;

  bool inRun_ = false;
  int64_t runFrame_ = 0;
  double runFlux_ = 0.0;
  bool capped_ = false;

  std::vector<double> onsetsMs_;
  int64_t lastFrame_ = 0;
  double lastFlux_ = 0.0;
};

}  // namespace ws
