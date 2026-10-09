// A voice's path through its file: the regions it plays, in order, how often each plays,
// and where in them it starts. One function builds it, from a start's options, for the two
// sides that have to agree about it — the mixer, which plays the path, and the stream pool,
// whose read-ahead follows it (AD-29) — so they cannot disagree about where a slice begins.
#pragma once

#include "wsaudio.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace ws {

/** One slice of a voice's file, in source frames: a region and how often it plays. */
struct VoiceSlice {
  double startFrame = 0.0;
  double endFrame = 0.0;
  int playCount = 1;  // -1: until released (a skipped slice, 0, is never held)
  /** Where this slice stands in the cue's own `slices`, skipped ones counted: what `progress`
   *  reports as `slice.index`. Kept in what was this struct's padding. */
  int sliceIndex = 0;
};

/** Where a planned voice starts, and the region it starts in. */
struct PlannedStart {
  double segmentStart = 0.0;
  double segmentEnd = 0.0;
  double position = 0.0;
  /** Kept slices written to the caller's array; 0 for a voice without slices. */
  int sliceCount = 0;
  int sliceIndex = 0;
};

/**
 * The plan a start's options describe, over a file of `sourceEnd` frames at `sampleRate`.
 *
 * A slice that plays no times is left out here, once, rather than tested at every edge: the
 * slice before it then ends where a slice that does not start there begins, and the move
 * between them is a jump like any other. Skipped slices at the end leave the last kept one
 * the voice's last, so the voice ends where the skip begins. Every slice from where the voice
 * starts being skipped leaves an empty region, which ends the voice as it begins.
 */
inline PlannedStart planVoice(const StartOptions& options, int sampleRate, double sourceEnd, bool live,
                              VoiceSlice* slices) {
  PlannedStart plan;
  const double rate = static_cast<double>(sampleRate);
  double segmentStart = options.startTimeMs * rate / 1000.0;
  if (segmentStart < 0.0) segmentStart = 0.0;
  if (segmentStart > sourceEnd) segmentStart = sourceEnd;
  double segmentEnd = options.endTimeMs >= 0.0 ? options.endTimeMs * rate / 1000.0 : sourceEnd;
  if (segmentEnd > sourceEnd) segmentEnd = sourceEnd;
  if (segmentEnd < segmentStart) segmentEnd = segmentStart;
  plan.segmentStart = segmentStart;
  plan.segmentEnd = segmentEnd;
  plan.position = segmentStart;
  if (options.sliceCount <= 0 || live) return plan;

  int kept = 0;
  int skipped = 0;
  for (int i = 0; i < options.sliceCount && i < kMaxSlices; i++) {
    const SliceSpec& spec = options.slices[i];
    if (spec.playCount == 0) {
      skipped++;
      continue;
    }
    double start = spec.startMs * rate / 1000.0;
    double end = spec.endMs * rate / 1000.0;
    start = std::max(0.0, std::min(start, sourceEnd));
    end = std::max(start, std::min(end, sourceEnd));
    if (end <= start) continue;
    slices[kept].startFrame = start;
    slices[kept].endFrame = end;
    slices[kept].playCount = spec.playCount < 0 ? -1 : spec.playCount;
    slices[kept].sliceIndex = i;
    kept++;
  }
  if (skipped > 0 && (kept == 0 || slices[kept - 1].endFrame <= segmentStart)) {
    plan.segmentEnd = segmentStart;
    return plan;
  }
  if (kept > 0) {
    int index = 0;
    while (index < kept - 1 && slices[index].endFrame <= segmentStart) index++;
    plan.sliceCount = kept;
    plan.sliceIndex = index;
    plan.segmentStart = slices[index].startFrame;
    plan.segmentEnd = slices[index].endFrame;
    plan.position = std::max(segmentStart, slices[index].startFrame);
    if (plan.position >= plan.segmentEnd) plan.position = plan.segmentStart;
  }
  return plan;
}

/** The kept slice a file position falls in, as a seek finds it: the first that ends after it. */
inline int sliceForPosition(const VoiceSlice* slices, int count, double frame) {
  int index = 0;
  while (index < count - 1 && slices[index].endFrame <= frame) index++;
  return index;
}

/**
 * How long a join's crossfade lasts, and how big a step has to be to need one. A wrap, a skip
 * or a seek puts one place in the file straight after another; where the two do not meet —
 * the sample the voice jumps to is not where the waveform was going — that step is a click,
 * so the join is made over a short equal-power crossfade instead: the material the voice is
 * leaving plays on under the material it lands on for this long. A join whose step is within
 * `kCleanJoinStep` of where the waveform was going (a slice cut at a zero crossing, a loop
 * of steady tone) is made sample-for-sample, with no crossfade at all. Engine constants, the
 * same for every show (AD-29).
 */
inline constexpr double kJoinCrossfadeMs = 3.0;
inline constexpr float kCleanJoinStep = 1.0f / 1024.0f;
/** How much of the file a landing pad holds after a jump's target: the time the ring has to
 *  move to where the pad ends (AD-29). */
inline constexpr int64_t kLandingMs = 1000;
/** Pads one stream holds: the loop being played, two jumps ahead, and one kept free for a seek. */
inline constexpr int kPadsPerStream = 4;

/** A join's crossfade in output frames, at the device's rate. */
inline int joinCrossfadeFrames(int outputRate) {
  return static_cast<int>(std::lround(kJoinCrossfadeMs * static_cast<double>(outputRate) / 1000.0));
}

/** The source frames past a region's end its pad also holds, so a join's crossfade can play
 *  the material the voice is leaving out of the pad (at up to twice real time). */
inline int64_t padTailFrames(int sourceRate) {
  return static_cast<int64_t>(std::ceil(kJoinCrossfadeMs * static_cast<double>(sourceRate) / 1000.0)) * 2 + 4;
}

}  // namespace ws
