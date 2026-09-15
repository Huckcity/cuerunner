#include "onsets.h"

#include <algorithm>
#include <cmath>

namespace ws {
namespace {

constexpr double kPi = 3.14159265358979323846;

// 21.3ms of a 48kHz file: long enough to resolve a 1kHz note's pitch, short enough that
// a hit is a step inside it rather than a fade.
constexpr int kFrameSize = 1024;
// A 256-sample hop is 5.3ms at 48kHz — fine enough that a slice boundary lands on the
// hit rather than beside it. Above 96kHz the same musical detail costs twice the
// transforms, so the hop doubles there.
constexpr int kHopUnder96k = 256;
constexpr int kHopFrom96k = 512;

// The adaptive threshold: a frame counts as an onset when its flux stands this far
// above the window's median, and this many deviations clear of how much the window
// wobbles. 1.0 is the default sensitivity, so the default multiplier is 2.5; the
// multiplier is what the caller's sensitivity moves, and higher is stricter.
constexpr double kMedianScale = 1.5;
constexpr double kDeviationScale = 6.0;
// Digital silence must never trigger, and every term above is zero there: this is the
// floor a rise has to clear to be a rise at all.
constexpr double kFluxFloor = 1e-6;
// One hop of the sliding sample buffer is the room the analysis needs; a second gives
// the copy something to do between compactions.
constexpr int kBufferFrames = kFrameSize + kHopUnder96k + kFrameSize;

}  // namespace

FrameFft::FrameFft(int size) : size_(size), half_(size / 2) {
  re_.assign(static_cast<size_t>(half_), 0.0);
  im_.assign(static_cast<size_t>(half_), 0.0);
  reverse_.assign(static_cast<size_t>(half_), 0);
  twiddleCos_.assign(static_cast<size_t>(half_), 1.0);
  twiddleSin_.assign(static_cast<size_t>(half_), 0.0);
  untangleCos_.assign(static_cast<size_t>(half_), 1.0);
  untangleSin_.assign(static_cast<size_t>(half_), 0.0);
  for (int j = 0; j < half_; j++) {
    // e^{-2 pi i j / half} for the transform, e^{-2 pi i j / size} for the untangle.
    const double a = 2.0 * kPi * j / half_;
    const double b = kPi * j / half_;
    twiddleCos_[j] = std::cos(a);
    twiddleSin_[j] = -std::sin(a);
    untangleCos_[j] = std::cos(b);
    untangleSin_[j] = -std::sin(b);
  }
  int bits = 0;
  while ((1 << bits) < half_) bits++;
  for (int i = 0; i < half_; i++) {
    int value = 0;
    for (int bit = 0; bit < bits; bit++) {
      if (i & (1 << bit)) value |= 1 << (bits - 1 - bit);
    }
    reverse_[i] = value;
  }
}

void FrameFft::transform() {
  const int n = half_;
  for (int i = 0; i < n; i++) {
    const int j = reverse_[i];
    if (j > i) {
      std::swap(re_[i], re_[j]);
      std::swap(im_[i], im_[j]);
    }
  }
  for (int length = 2; length <= n; length <<= 1) {
    const int step = n / length;
    const int halfLength = length >> 1;
    for (int base = 0; base < n; base += length) {
      for (int j = 0; j < halfLength; j++) {
        const int twiddle = j * step;
        const double c = twiddleCos_[twiddle];
        const double s = twiddleSin_[twiddle];
        const int even = base + j;
        const int odd = even + halfLength;
        const double xr = re_[odd] * c - im_[odd] * s;
        const double xi = re_[odd] * s + im_[odd] * c;
        re_[odd] = re_[even] - xr;
        im_[odd] = im_[even] - xi;
        re_[even] += xr;
        im_[even] += xi;
      }
    }
  }
}

void FrameFft::magnitudes(const double* frame, double* magnitudes) {
  // Pack the real pairs into a half-length complex frame: x[2i] + i*x[2i+1].
  for (int i = 0; i < half_; i++) {
    re_[i] = frame[2 * i];
    im_[i] = frame[2 * i + 1];
  }
  transform();

  // Unpack: with E and O the transforms of the even and odd samples, the frame's own
  // bins are X[k] = E[k] + W_size^k * O[k], and both come out of Z.
  for (int k = 1; k < half_; k++) {
    const double zr = re_[k];
    const double zi = im_[k];
    const double pr = re_[half_ - k];   // the real part of conj(Z[half - k]) ...
    const double pi = -im_[half_ - k];  // ... and its imaginary part.
    const double er = 0.5 * (zr + pr);
    const double ei = 0.5 * (zi + pi);
    const double orr = 0.5 * (zi - pi);
    const double oi = -0.5 * (zr - pr);
    const double c = untangleCos_[k];
    const double s = untangleSin_[k];
    const double xr = er + c * orr - s * oi;
    const double xi = ei + c * oi + s * orr;
    magnitudes[k - 1] = std::sqrt(xr * xr + xi * xi);
  }
}

OnsetDetector::OnsetDetector(int sampleRate, double sensitivity, int maxOnsets)
    : sampleRate_(sampleRate),
      hop_(sampleRate < 96000 ? kHopUnder96k : kHopFrom96k),
      frameSize_(kFrameSize),
      binCount_(kFrameSize / 2 - 1),
      maxOnsets_(maxOnsets),
      sensitivity_(sensitivity),
      fft_(kFrameSize) {
  // A quarter second of frames: long enough to know what this file has been doing
  // around a hit, short enough to follow a tempo change.
  windowLength_ = std::max(3, static_cast<int>(std::lround(0.25 * sampleRate_ / hop_)));
  // Two onsets closer together than 60ms are one hit heard twice — a doubled attack, a
  // room reflection. The spacing rounds up, so the gap is a floor rather than a hope.
  spacingFrames_ = std::max(1, static_cast<int>(std::ceil(0.06 * sampleRate_ / hop_)));

  hann_.resize(static_cast<size_t>(frameSize_));
  for (int i = 0; i < frameSize_; i++) {
    hann_[i] = 0.5 * (1.0 - std::cos(2.0 * kPi * i / (frameSize_ - 1)));
  }
  windowed_.assign(static_cast<size_t>(frameSize_), 0.0);
  spectrum_.assign(static_cast<size_t>(binCount_), 0.0);
  previous_.assign(static_cast<size_t>(binCount_), 0.0);
  samples_.assign(static_cast<size_t>(kBufferFrames), 0.0f);
  fluxRing_.assign(static_cast<size_t>(windowLength_), 0.0);
  scratch_.assign(static_cast<size_t>(windowLength_), 0.0);
  deviations_.assign(static_cast<size_t>(windowLength_), 0.0);
  onsetsMs_.reserve(static_cast<size_t>(std::max(1, std::min(maxOnsets_, 256))));
}

bool OnsetDetector::feed(const float* samples, int64_t frames, int channels) {
  if (capped_ || channels <= 0 || samples == nullptr) return !capped_;

  int64_t done = 0;
  while (done < frames) {
    if (end_ == samples_.size()) {
      // The window slides: what has already been analysed is dead weight, and moving
      // the live tail back is what keeps the buffer one frame long instead of one
      // file long.
      const size_t live = end_ - start_;
      std::copy(samples_.begin() + static_cast<std::ptrdiff_t>(start_),
                samples_.begin() + static_cast<std::ptrdiff_t>(end_), samples_.begin());
      start_ = 0;
      end_ = live;
    }
    const size_t room = samples_.size() - end_;
    const size_t take = static_cast<size_t>(
        std::min<int64_t>(static_cast<int64_t>(room), frames - done));
    for (size_t i = 0; i < take; i++) {
      const size_t index = static_cast<size_t>(done) + i;
      const float first = samples[index * static_cast<size_t>(channels)];
      const float second = channels >= 2 ? samples[index * static_cast<size_t>(channels) + 1] : first;
      samples_[end_ + i] = 0.5f * (first + second);
    }
    end_ += take;
    done += static_cast<int64_t>(take);

    while (end_ - start_ >= static_cast<size_t>(frameSize_)) {
      analyseFrame();
      start_ += static_cast<size_t>(hop_);
      // The cap was reached: the caller stops reading and the file's tail is never
      // scanned at all.
      if (capped_) return false;
    }
  }
  return true;
}

void OnsetDetector::analyseFrame() {
  const float* frame = samples_.data() + start_;
  for (int i = 0; i < frameSize_; i++) {
    windowed_[static_cast<size_t>(i)] = static_cast<double>(frame[i]) * hann_[static_cast<size_t>(i)];
  }
  fft_.magnitudes(windowed_.data(), spectrum_.data());

  double flux = 0.0;
  if (hasPrevious_) {
    for (int bin = 0; bin < binCount_; bin++) {
      const double rise = spectrum_[static_cast<size_t>(bin)] - previous_[static_cast<size_t>(bin)];
      if (rise > 0.0) flux += rise;
    }
    // Normalised by the bin count, so one flux number means the same thing whatever
    // the frame size and sampling rate are.
    flux /= static_cast<double>(binCount_);
  }

  fluxRing_[ringWrite_] = flux;
  ringWrite_ = (ringWrite_ + 1) % fluxRing_.size();
  ringCount_ = std::min(ringCount_ + 1, fluxRing_.size());

  // This frame's arrival is what lets the frame half a window earlier be judged. The
  // ring then holds exactly that frame's window, so no sliding arithmetic is needed.
  const int64_t half = static_cast<int64_t>(windowLength_) / 2;
  const int64_t judgeable = frameIndex_ - half;
  if (judged_ <= judgeable) {
    decide(judged_);
    judged_++;
  }

  std::swap(previous_, spectrum_);
  hasPrevious_ = true;
  frameIndex_++;
}

void OnsetDetector::finish() {
  // The frames the lag was still holding back: there is no more future to wait for, so
  // they are judged against the window the file ends with.
  while (judged_ < frameIndex_) {
    decide(judged_);
    judged_++;
  }
  if (inRun_) {
    inRun_ = false;
    accept(runFrame_, runFlux_);
  }
}

void OnsetDetector::decide(int64_t frame) {
  const double flux = fluxBack(static_cast<size_t>(frameIndex_ - frame));
  const double median = ringMedian();
  const double deviation = ringDeviation(median);
  // The deviation term is what keeps a steady tone or a wash of noise quiet: in both,
  // every frame rises as much as its neighbours do, so no frame stands six deviations
  // clear of the window. In silence both terms are zero and the floor catches it.
  const bool overThreshold = flux > median * (1.0 + kMedianScale * sensitivity_) &&
                             flux >= kDeviationScale * deviation && flux > kFluxFloor;
  if (overThreshold) {
    // Peak picking: a run of frames over the threshold is one onset, and the frame it
    // peaks on is where the hit actually began.
    if (!inRun_ || flux > runFlux_) {
      inRun_ = true;
      runFrame_ = frame;
      runFlux_ = flux;
    }
  } else if (inRun_) {
    inRun_ = false;
    accept(runFrame_, runFlux_);
  }
}

void OnsetDetector::accept(int64_t frame, double flux) {
  if (static_cast<int>(onsetsMs_.size()) >= maxOnsets_) {
    capped_ = true;
    return;
  }
  if (!onsetsMs_.empty() && frame - lastFrame_ < spacingFrames_) {
    // Too close to the last one to be a separate hit: keep the stronger of the two,
    // because the stronger edge is the one that says when it began.
    if (flux > lastFlux_) {
      onsetsMs_.back() = frameTimeMs(frame);
      lastFrame_ = frame;
      lastFlux_ = flux;
    }
    return;
  }
  onsetsMs_.push_back(frameTimeMs(frame));
  lastFrame_ = frame;
  lastFlux_ = flux;
  if (static_cast<int>(onsetsMs_.size()) >= maxOnsets_) capped_ = true;
}

double OnsetDetector::frameTimeMs(int64_t frame) const {
  // The middle of the analysis window, not its start: the Hann weights are heaviest
  // there, so that is the instant the frame is really about. Reporting the window's
  // first sample would date every onset half a frame — 10.7ms at 48kHz — early, which
  // is the difference between a slice boundary landing on the hit and landing beside it.
  const double centre = static_cast<double>(frame) * static_cast<double>(hop_) + 0.5 * frameSize_;
  return centre * 1000.0 / static_cast<double>(sampleRate_);
}

double OnsetDetector::fluxBack(size_t back) const {
  // The frames a judgement can ask for are the ones the ring still holds: at most half
  // a window back, because that is how far the judged frame lags the newest.
  return fluxRing_[(ringWrite_ + fluxRing_.size() - 1 - back) % fluxRing_.size()];
}

size_t OnsetDetector::ringStart() const {
  return (ringWrite_ + fluxRing_.size() - ringCount_) % fluxRing_.size();
}

double OnsetDetector::ringMedian() {
  const size_t count = ringCount_;
  const size_t start = ringStart();
  for (size_t i = 0; i < count; i++) {
    scratch_[i] = fluxRing_[(start + i) % fluxRing_.size()];
  }
  // The lower of the two middle values when the count is even — which is what a file
  // shorter than a window has. Taking the upper one there would let the frames around
  // a hit raise its own threshold out of reach.
  const size_t middle = (count - 1) / 2;
  std::nth_element(scratch_.begin(), scratch_.begin() + static_cast<std::ptrdiff_t>(middle),
                   scratch_.begin() + static_cast<std::ptrdiff_t>(count));
  return scratch_[middle];
}

double OnsetDetector::ringDeviation(double median) {
  const size_t count = ringCount_;
  const size_t start = ringStart();
  for (size_t i = 0; i < count; i++) {
    deviations_[i] = std::fabs(fluxRing_[(start + i) % fluxRing_.size()] - median);
  }
  const size_t middle = (count - 1) / 2;
  std::nth_element(deviations_.begin(), deviations_.begin() + static_cast<std::ptrdiff_t>(middle),
                   deviations_.begin() + static_cast<std::ptrdiff_t>(count));
  return deviations_[middle];
}

}  // namespace ws
