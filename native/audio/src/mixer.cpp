#include "mixer.h"

#include "util.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace ws {
namespace {

constexpr double kHalfPi = 1.57079632679489661923;
// A segment longer than any real show; used when a stream does not state its length
// and no end time was given.
constexpr double kUnboundedSegment = 1.0e18;

int64_t frameForMs(double ms, int sampleRate) {
  if (!(ms > 0.0)) return 0;
  return static_cast<int64_t>(ms * static_cast<double>(sampleRate) / 1000.0 + 0.5);
}

int64_t atOrNow(double ms, int sampleRate, int64_t now) {
  const int64_t frame = frameForMs(ms, sampleRate);
  return frame > now ? frame : now;
}

// Kept out of line on purpose: a drawn shape is the rare case, and reading its table inline
// made every ramp's evaluation big enough that the compiler stopped inlining it into the
// per-frame loop — a call per voice per frame on a show with no drawn shape at all, which a
// sanitizer build turns into a missed device deadline.
#if defined(_MSC_VER)
__declspec(noinline)
#else
__attribute__((noinline))
#endif
double tableShare(const CurveTable* table, double t) {
  return table != nullptr ? curveTableValue(*table, t) : t;
}

}  // namespace

Mixer::Mixer(DecodedCache& cache, StreamPool& streams, SpscQueue<Event, 1024>& events,
             SpscQueue<ReclaimItem, 512>& reclaim)
    : cache_(cache), streams_(streams), events_(events), reclaim_(reclaim) {
  reset();
  for (int output = 0; output < kMaxOutputChannels; output++) {
    outputGainTarget_[output] = 1.0;
    outputGainCurrent_[output] = 1.0;
  }
}

void Mixer::configure(int deviceChannels, int sampleRate) {
  deviceChannels_ = std::max(1, std::min(kMaxOutputChannels, deviceChannels));
  const int rate = sampleRate > 0 ? sampleRate : 48000;
  // The clock is published as `clockFrames_ * 1000 / sampleRate_`, so the frames already
  // rendered have to come with it: a reopen that lands on another rate — the window's
  // Settings → Audio, a show whose stored rate differs, a driver that requested the
  // reopen — would otherwise step the show clock inside one engine session by the ratio
  // of the two rates. Three minutes at 44.1 kHz reported at 48 kHz is 14.6 s of clock
  // gone, and the window, which keeps the show on that clock, would schedule the rest of
  // the show fifteen seconds in the future. Rebasing keeps the milliseconds exactly
  // where they were, and the session's clock continuous.
  if (rate != sampleRate_ && sampleRate_ > 0 && clockFrames_ > 0) {
    clockFrames_ = static_cast<int64_t>(std::llround(
        static_cast<double>(clockFrames_) * static_cast<double>(rate) /
        static_cast<double>(sampleRate_)));
  }
  sampleRate_ = rate;
  joinFrames_ = joinCrossfadeFrames(rate);
}

void Mixer::reset() {
  for (Voice& voice : voices_) voice = Voice{};
  specialVoices_ = 0;
}

int Mixer::activeVoiceCount() const {
  int count = 0;
  for (const Voice& voice : voices_) {
    if (voice.active) count++;
  }
  return count;
}

int Mixer::streamingVoiceCount() const {
  int count = 0;
  for (const Voice& voice : voices_) {
    if (voice.active && voice.streamSlot >= 0) count++;
  }
  return count;
}

Voice* Mixer::findVoice(const char* cueId) {
  for (Voice& voice : voices_) {
    if (voice.active && std::strcmp(voice.cueId, cueId) == 0) return &voice;
  }
  return nullptr;
}

Voice* Mixer::freeVoice() {
  for (Voice& voice : voices_) {
    if (!voice.active) return &voice;
  }
  return nullptr;
}

double Mixer::curveShape(double t, Curve curve) {
  switch (curve) {
    case Curve::SCurve: return t * t * (3.0 - 2.0 * t);
    case Curve::Logarithmic: {
      const double denominator = 1.0 - std::exp(-4.0);
      return denominator > 0.0 ? (1.0 - std::exp(-4.0 * t)) / denominator : t;
    }
    default: return t;
  }
}

/** The share of a ramp done at `t`: its named curve, or the table it was drawn as. */
double Mixer::shapeAt(const FadeRamp& ramp, double t) {
  if (ramp.curve == Curve::Table) return tableShare(ramp.table, t);
  return curveShape(t, ramp.curve);
}

double Mixer::rampValue(const FadeRamp& ramp, int64_t frame) {
  if (!ramp.active) return 1.0;
  if (frame >= ramp.endFrame) return ramp.to;
  if (frame <= ramp.startFrame) return ramp.from;
  const double span = static_cast<double>(ramp.endFrame - ramp.startFrame);
  const double t = span > 0.0 ? static_cast<double>(frame - ramp.startFrame) / span : 1.0;
  return ramp.from + (ramp.to - ramp.from) * shapeAt(ramp, t);
}

double Mixer::paramValue(const Voice& voice, int param, int64_t frame) const {
  // The ramp's own arithmetic is `rampValue`'s, called only while a ramp runs: what is left
  // here stays small enough to be inlined into the frame loop, as it was before ramps had
  // drawn shapes — four calls per voice per frame otherwise, on every show.
  const FadeRamp& ramp = voice.ramps[param];
  if (ramp.active) return rampValue(ramp, frame);
  switch (param) {
    case static_cast<int>(Param::Volume): return voice.volume;
    case static_cast<int>(Param::Pan): return voice.pan;
    case static_cast<int>(Param::Trim): return voice.trim;
    default: return voice.rate;
  }
}

/**
 * One frame of the voice's file, interleaved. A cached voice has the whole file; a streamed
 * one looks where its last frame was found first (`src`: a pad, or -1 for the ring), then in
 * the ring, then in its other pads, and `src` says where this one was found.
 */
const float* Mixer::frameAt(const Voice& voice, int64_t frame, int& src) const {
  if (frame < 0) return nullptr;
  if (voice.cachedData != nullptr) {
    return frame < voice.cachedFrames ? voice.cachedData + frame * voice.channels : nullptr;
  }
  if (voice.streamSlot < 0) return nullptr;
  const StreamSlot* slot = streams_.at(voice.streamSlot);
  if (slot == nullptr || !slot->inUse.load(std::memory_order_acquire)) return nullptr;
  auto fromPad = [&](int k) {
    const StreamPad& pad = slot->pads[k];
    return pad.pcm.data() + (frame - pad.target.load(std::memory_order_relaxed)) * slot->channels;
  };
  if (src >= 0 && src < kPadsPerStream && slot->pads[src].holds(frame)) return fromPad(src);
  if (slot->ring.holds(frame)) {
    src = -1;
    return slot->ring.readPtr(frame);
  }
  for (int k = 0; k < kPadsPerStream; k++) {
    if (slot->pads[k].holds(frame)) {
      src = k;
      return fromPad(k);
    }
  }
  return nullptr;
}

bool Mixer::readSample(const Voice& voice, double position, int& src, float* out) const {
  const int64_t base = static_cast<int64_t>(std::floor(position));
  const double frac = position - static_cast<double>(base);
  const float* first = frameAt(voice, base, src);
  if (first == nullptr) return false;
  const float* second = first;
  if (frac > 0.0) {
    int nextSrc = src;
    second = frameAt(voice, base + 1, nextSrc);
    if (second == nullptr) {
      // The last frame of the file has nothing after it to be read towards; anything else
      // missing is a frame that is not there yet.
      bool atEnd = false;
      if (voice.cachedData != nullptr) {
        atEnd = base + 1 >= voice.cachedFrames;
      } else if (voice.streamSlot >= 0) {
        const StreamSlot* slot = streams_.at(voice.streamSlot);
        atEnd = slot != nullptr && slot->eof.load(std::memory_order_acquire) && !slot->ring.seekPending() &&
                base + 1 >= slot->ring.writeFrame();
      }
      if (!atEnd) return false;
      second = first;
    }
  }
  for (int channel = 0; channel < voice.channels; channel++) {
    out[channel] = static_cast<float>(static_cast<double>(first[channel]) +
                                      (static_cast<double>(second[channel]) - static_cast<double>(first[channel])) * frac);
  }
  return true;
}

void Mixer::emit(const Event& event) {
  if (!events_.push(event)) droppedEvents_++;
}

void Mixer::emitState(const Voice* voice, bool playing) {
  Event event;
  event.kind = Event::State;
  if (voice != nullptr) {
    copyStr(event.cueId, sizeof(event.cueId), voice->cueId);
    event.hasCue = true;
    copyStr(event.runId, sizeof(event.runId), voice->runId);
    event.hasRun = true;
    event.state = static_cast<int>(voice->state);
  }
  event.playing = playing;
  event.activeGlobal = hasActiveVoices();
  event.atMs = static_cast<double>(clockFrames_) * 1000.0 / static_cast<double>(sampleRate_);
  emit(event);
}

void Mixer::reclaimResourcesForCommand(const Command& cmd) {
  ReclaimItem item;
  item.streamSlot = cmd.streamSlot;
  item.cacheEntry = static_cast<CacheEntry*>(cmd.cacheEntry);
  if (item.streamSlot < 0 && item.cacheEntry == nullptr) return;
  if (!reclaim_.push(item)) {
    if (item.streamSlot >= 0 && pendingStreamCount_ < kMaxVoices) {
      pendingStreams_[pendingStreamCount_++] = item.streamSlot;
    } else if (item.cacheEntry != nullptr) {
      cache_.release(item.cacheEntry);
    }
  }
}

void Mixer::reclaim(Voice& voice) {
  ReclaimItem item;
  item.streamSlot = voice.streamSlot;
  item.cacheEntry = voice.cacheEntry;
  if (item.streamSlot < 0 && item.cacheEntry == nullptr) return;
  if (!reclaim_.push(item)) {
    // The queue is bounded and the audio thread must not wait on it: keep the slot in
    // a tiny overflow list that the next block retries.
    if (item.streamSlot >= 0 && pendingStreamCount_ < kMaxVoices) {
      pendingStreams_[pendingStreamCount_++] = item.streamSlot;
    } else if (item.cacheEntry != nullptr) {
      cache_.release(item.cacheEntry);  // a single atomic decrement, safe here
    }
  }
}

void Mixer::finishVoice(Voice& voice, int64_t frame, EndReason reason) {
  Event event;
  event.kind = Event::Ended;
  copyStr(event.cueId, sizeof(event.cueId), voice.cueId);
  event.hasCue = true;
  copyStr(event.runId, sizeof(event.runId), voice.runId);
  event.hasRun = true;
  event.reason = static_cast<int>(reason);
  event.loopsCompleted = voice.loopsCompleted;
  event.atMs = static_cast<double>(frame) * 1000.0 / static_cast<double>(sampleRate_);
  emit(event);

  reclaim(voice);
  voice.active = false;
  voice.state = VoiceState::Stopped;
  voice.cachedData = nullptr;
  voice.cacheEntry = nullptr;
  voice.streamSlot = -1;
  voice.pendingReason = reason;
  if (voice.special) {
    voice.special = false;
    specialVoices_--;
  }
  voicesEnded_.fetch_add(1, std::memory_order_relaxed);
  emitState(nullptr, false);
}

void Mixer::beginVoice(Voice& voice, int64_t frame) {
  voice.started = true;
  if (voice.segmentEndFrame <= voice.segmentStartFrame) {
    finishVoice(voice, frame, EndReason::Complete);
    return;
  }
  voice.state = VoiceState::Playing;
  emitState(&voice, true);
}

// Builds the output-indexed tap list for an explicit matrix. Called once when the
// routing is applied, never per frame: a counting sort stably groups the crosspoints by
// output channel and `tapStart` records each output's slice. Stability matters — the
// taps for one output stay in the order the operator gave them, so the accumulated sum
// is bit-for-bit what the per-frame scan produced. Crosspoints the scan would have
// rejected anyway (an output outside the device range, an input outside the source) are
// dropped here instead of being re-tested for every frame and output.
void Mixer::indexRouting(Voice& voice, const Crosspoint* points, int count) {
  count = std::max(0, std::min(kMaxCrosspoints, count));

  int counts[kMaxOutputChannels] = {};
  for (int i = 0; i < count; i++) {
    const Crosspoint& point = points[i];
    if (point.outputChannel < 0 || point.outputChannel >= kMaxOutputChannels) continue;
    if (point.inputChannel < 0 || point.inputChannel >= voice.channels) continue;
    counts[point.outputChannel]++;
  }

  int cursor[kMaxOutputChannels];
  int total = 0;
  for (int output = 0; output < kMaxOutputChannels; output++) {
    voice.tapStart[output] = total;
    cursor[output] = total;
    total += counts[output];
  }
  voice.tapStart[kMaxOutputChannels] = total;

  for (int i = 0; i < count; i++) {
    const Crosspoint& point = points[i];
    if (point.outputChannel < 0 || point.outputChannel >= kMaxOutputChannels) continue;
    if (point.inputChannel < 0 || point.inputChannel >= voice.channels) continue;
    Tap& tap = voice.taps[cursor[point.outputChannel]++];
    tap.inputChannel = point.inputChannel;
    tap.gain = point.gain;
  }
}

Voice* Mixer::startVoice(const Command& cmd) {
  if (Voice* existing = findVoice(cmd.cueId)) {
    finishVoice(*existing, clockFrames_, EndReason::Replaced);
  }

  Voice* voice = freeVoice();
  if (voice == nullptr) {
    Event event;
    event.kind = Event::Error;
    copyStr(event.cueId, sizeof(event.cueId), cmd.cueId);
    event.hasCue = true;
    copyStr(event.runId, sizeof(event.runId), cmd.runId);
    event.hasRun = true;
    copyStr(event.code, sizeof(event.code), "limit");
    copyStr(event.message, sizeof(event.message), "no free voice");
    event.atMs = static_cast<double>(clockFrames_) * 1000.0 / static_cast<double>(sampleRate_);
    emit(event);
    reclaimResourcesForCommand(cmd);
    return nullptr;
  }

  *voice = Voice{};
  copyStr(voice->cueId, sizeof(voice->cueId), cmd.cueId);
  copyStr(voice->runId, sizeof(voice->runId), cmd.runId);
  voice->active = true;
  voice->state = VoiceState::Scheduled;

  if (cmd.cacheEntry != nullptr) {
    auto* entry = static_cast<CacheEntry*>(cmd.cacheEntry);
    voice->cacheEntry = entry;
    voice->cachedData = entry->data.data();
    voice->cachedFrames = cmd.cacheFrames;
    voice->channels = cmd.cacheChannels;
    voice->sampleRate = cmd.cacheSampleRate;
    voice->sourceFrames = cmd.cacheFrames;
  } else if (cmd.options.inputFeed >= 0) {
    // A live voice: its samples are the feed's, already at the output's rate, and it has
    // no end of its own — it runs until it is stopped.
    voice->inputFeed = cmd.options.inputFeed;
    voice->channels = std::min(cmd.options.inputChannelCount, kMaxOutputChannels);
    for (int channel = 0; channel < voice->channels; channel++) {
      inputMaps_[voiceIndex(*voice)][channel] = cmd.options.inputChannels[channel];
    }
    voice->sampleRate = sampleRate_;
    voice->sourceFrames = -1;
    voice->lengthUnknown = true;
  } else if (cmd.streamSlot >= 0) {
    const StreamSlot* slot = streams_.at(cmd.streamSlot);
    voice->streamSlot = cmd.streamSlot;
    // The ring is allocated once, when the slot is acquired: its achieved size — what
    // the declared per-voice bound bought — is this voice's figure for its whole life.
    voice->streamBytes = slot != nullptr ? slot->ringBytes() : 0;
    voice->channels = cmd.cacheChannels > 0 ? cmd.cacheChannels : (slot != nullptr ? slot->channels : 2);
    voice->sampleRate = cmd.cacheSampleRate > 0 ? cmd.cacheSampleRate : (slot != nullptr ? slot->sampleRate : sampleRate_);
    voice->sourceFrames = cmd.cacheFrames;
    voice->lengthUnknown = cmd.cacheFrames < 0;
  }

  if (voice->channels > kMaxOutputChannels) voice->channels = kMaxOutputChannels;

  if (voice->channels <= 0 || voice->sampleRate <= 0) {
    // No usable source: fail loudly rather than play silence forever.
    Event event;
    event.kind = Event::Error;
    copyStr(event.cueId, sizeof(event.cueId), cmd.cueId);
    event.hasCue = true;
    copyStr(event.runId, sizeof(event.runId), cmd.runId);
    event.hasRun = true;
    copyStr(event.code, sizeof(event.code), "decode");
    copyStr(event.message, sizeof(event.message), "start had no usable source");
    event.atMs = static_cast<double>(clockFrames_) * 1000.0 / static_cast<double>(sampleRate_);
    emit(event);
    reclaim(*voice);
    voice->active = false;
    return nullptr;
  }

  const StartOptions& options = cmd.options;
  const double sourceEnd = voice->sourceFrames >= 0 ? static_cast<double>(voice->sourceFrames) : kUnboundedSegment;
  // The region, or the slices that replace it and its loop count, from the plan the stream
  // pool built the same way (plan.h): the voice starts in the slice that holds its start (a
  // seek can start it part-way through the cue) and plays them in order. A plan whose every
  // slice from the start is skipped is an empty region, which ends the voice as it begins —
  // complete, not the whole region played instead.
  const PlannedStart plan = planVoice(options, voice->sampleRate, sourceEnd, voice->inputFeed >= 0, slicesOf(*voice));
  voice->segmentStartFrame = plan.segmentStart;
  voice->segmentEndFrame = plan.segmentEnd;
  voice->position = plan.position;
  voice->sliceCount = plan.sliceCount;
  voice->sliceIndex = plan.sliceIndex;

  if (voice->streamSlot >= 0) {
    // The ring was filled from where the voice starts before the slot was handed over, so
    // the first frame is there. A ring that does not hold it is sent there, and the wait is
    // counted: nothing a start does is silence that goes unreported.
    publishRegion(*voice);
    const StreamSlot* slot = streams_.at(voice->streamSlot);
    const int64_t first = static_cast<int64_t>(std::floor(voice->position));
    if (slot != nullptr && (first < slot->ring.readFrame() || first >= slot->ring.readFrame() + slot->ring.capacityFrames())) {
      requestStreamSeek(*voice, first);
    }
  }
  voice->loopCount = options.loopCount;
  voice->volume = options.volume;
  voice->pan = options.pan;
  voice->trim = options.trim;
  voice->rate = options.rate > 0.0 ? options.rate : 1.0;
  voice->automaticRouting = options.automatic;
  voice->patch = options.patch >= 0 && options.patch < kMaxPatches ? options.patch : -1;
  indexRouting(*voice, options.crosspoints, options.crosspointCount);

  voice->startFrame = atOrNow(cmd.whenMs, sampleRate_, clockFrames_);
  if (options.fadeInMs > 0.0) {
    voice->fadeIn.active = true;
    voice->fadeIn.from = 0.0;
    voice->fadeIn.to = 1.0;
    voice->fadeIn.startFrame = voice->startFrame;
    voice->fadeIn.endFrame = voice->startFrame + frameForMs(options.fadeInMs, sampleRate_);
    voice->fadeIn.curve = Curve::Linear;
    if (options.fadeInShape.count >= 2) {
      voice->fadeIn.curve = Curve::Table;
      CurveTable& table = rampTables_[voiceIndex(*voice)][kMaxRampParams];
      table = options.fadeInShape;
      voice->fadeIn.table = &table;
    }
  }
  voice->special = voice->patch >= 0 || voice->inputFeed >= 0 || voice->sliceCount > 0;
  if (voice->special) specialVoices_++;
  emitState(voice, true);
  return voice;
}

void Mixer::stopVoice(Voice& voice, int64_t frame, double fadeFrames, EndReason reason) {
  if (voice.pausedSince >= 0) {
    // A held voice is already silent, and its stamped frames are not moving: a stop's fade
    // or its later frame would wait for a resume that is not coming. It ends where it is.
    finishVoice(voice, clockFrames_, voice.started ? reason : EndReason::Cancelled);
    return;
  }
  if (!voice.started) {
    // A run that was scheduled but never became audible: it is dropped, and the
    // caller's stop is reported as having applied.
    finishVoice(voice, frame, reason == EndReason::Stopped ? EndReason::Cancelled : reason);
    return;
  }
  if (fadeFrames <= 0.0) {
    if (frame <= clockFrames_) {
      finishVoice(voice, frame, reason);
      return;
    }
    // A cut scheduled for a later frame: keep playing until it, then stop exactly there.
    voice.stopFrame = frame;
    voice.stopFade.active = false;
    voice.pendingReason = reason;
    return;
  }
  voice.ramps[static_cast<int>(Param::Volume)].active = false;
  const double current = rampValue(voice.stopFade, frame);
  voice.stopFade.active = true;
  voice.stopFade.from = current;
  voice.stopFade.to = 0.0;
  voice.stopFade.startFrame = frame;
  voice.stopFade.endFrame = frame + static_cast<int64_t>(fadeFrames + 0.5);
  voice.stopFade.curve = Curve::Linear;
  voice.stopFrame = voice.stopFade.endFrame;
  voice.pendingReason = reason;
  voice.state = VoiceState::Fading;
  emitState(&voice, true);
}

void Mixer::cancelVoice(Voice& voice, int64_t frame, int& canceled) {
  for (int param = 0; param < kMaxRampParams; param++) {
    if (voice.ramps[param].active && voice.ramps[param].startFrame > frame) {
      voice.ramps[param].active = false;
      canceled++;
    }
  }
  if (voice.stopFrame > frame) {
    voice.stopFrame = -1;
    voice.stopFade.active = false;
    if (voice.state == VoiceState::Fading) voice.state = VoiceState::Playing;
    canceled++;
  }
  if (!voice.started && voice.startFrame > frame) {
    finishVoice(voice, frame, EndReason::Cancelled);
    canceled++;
  }
}

void Mixer::panic(double atFrame, double fadeFrames, EndReason soundingReason) {
  const int64_t frame = static_cast<int64_t>(atFrame);
  for (Voice& voice : voices_) {
    if (!voice.active) continue;
    if (!voice.started) {
      // It never made a sound: a start scheduled ahead of the panic, or one whose frame
      // has arrived with no block rendered since. Either way there is nothing in it the
      // caller's reason can be about, so it is cancelled whatever the reason was.
      finishVoice(voice, frame, EndReason::Cancelled);
      continue;
    }
    stopVoice(voice, frame, fadeFrames, soundingReason);
  }
  Event event;
  event.kind = Event::Panic;
  event.fadeMs = fadeFrames;
  event.atMs = static_cast<double>(frame) * 1000.0 / static_cast<double>(sampleRate_);
  emit(event);
}

// How long the edge of a pause takes: long enough that the cut and the restart do not
// click, short enough to read as the press.
static constexpr double kHoldEdgeMs = 8.0;

/**
 * Holds a voice where it stands from `frame`. A voice that is sounding is taken down over
 * the hold edge first and held once it is silent; one that has not begun yet is held at
 * once, so its start waits with it. A voice already held, or already on its way to being
 * held, is left as it is and the caller is told nothing changed.
 */
bool Mixer::pauseVoice(Voice& voice, int64_t frame) {
  if (voice.pausedSince >= 0) {
    // Already held: a pause that lands before a pending resume takes the resume back.
    if (voice.resumeAt < 0) return false;
    voice.resumeAt = -1;
    return true;
  }
  if (voice.pauseAt >= 0) return false;
  if (!voice.started || frame < voice.startFrame) {
    voice.pausedSince = std::max(frame, clockFrames_);
    return true;
  }
  // From wherever the edge stands now — all the way up, unless a resume is still bringing
  // the voice back — so a press in the middle of an edge does not jump.
  const double current = rampValue(voice.holdRamp, frame);
  const int64_t edge = frameForMs(kHoldEdgeMs, sampleRate_);
  voice.holdRamp.active = true;
  voice.holdRamp.from = current;
  voice.holdRamp.to = 0.0;
  voice.holdRamp.startFrame = frame;
  voice.holdRamp.endFrame = frame + edge;
  voice.holdRamp.curve = Curve::Linear;
  voice.pauseAt = frame + edge;
  return true;
}

/**
 * Lets a held voice go on from `frame`: the hold ends at that frame, in the render, so the
 * frames before it are still held rather than spent. A pause still taking hold is called
 * off where its edge has got to.
 */
bool Mixer::resumeVoice(Voice& voice, int64_t frame) {
  if (voice.pauseAt >= 0) {
    const double current = rampValue(voice.holdRamp, frame);
    voice.pauseAt = -1;
    voice.holdRamp.from = current;
    voice.holdRamp.to = 1.0;
    voice.holdRamp.startFrame = frame;
    voice.holdRamp.endFrame = frame + frameForMs(kHoldEdgeMs, sampleRate_);
    return true;
  }
  if (voice.pausedSince < 0 || voice.resumeAt >= 0) return false;
  voice.resumeAt = std::max(frame, voice.pausedSince);
  return true;
}

/**
 * The end of a hold, at the frame it was asked for. Every frame-stamped field moves on by
 * however long the voice was held — a fade half-way through is half-way through again, a
 * stop scheduled for two seconds after the pause is two seconds after the resume, a start
 * not yet reached is that much later — and the sound comes back over the hold edge.
 */
void Mixer::letGo(Voice& voice, int64_t frame) {
  const int64_t held = frame - voice.pausedSince;
  auto shift = [held](FadeRamp& ramp) {
    if (!ramp.active) return;
    ramp.startFrame += held;
    ramp.endFrame += held;
  };
  if (!voice.started) voice.startFrame += held;
  if (voice.stopFrame >= 0) voice.stopFrame += held;
  shift(voice.fadeIn);
  shift(voice.stopFade);
  for (FadeRamp& ramp : voice.ramps) shift(ramp);
  voice.pausedSince = -1;
  voice.resumeAt = -1;
  if (voice.started) {
    voice.holdRamp.active = true;
    voice.holdRamp.from = 0.0;
    voice.holdRamp.to = 1.0;
    voice.holdRamp.startFrame = frame;
    voice.holdRamp.endFrame = frame + frameForMs(kHoldEdgeMs, sampleRate_);
    voice.holdRamp.curve = Curve::Linear;
  } else {
    voice.holdRamp.active = false;
  }
}

void Mixer::cancelUnstartedVoices() {
  for (Voice& voice : voices_) {
    if (!voice.active || voice.started) continue;
    finishVoice(voice, clockFrames_, EndReason::Cancelled);
  }
}

void Mixer::apply(const Command& cmd) {
  const int64_t now = clockFrames_;
  bool applied = false;
  int canceled = 0;
  int ackVoices = 0;
  int ackState = static_cast<int>(VoiceState::Stopped);
  double ackPositionMs = 0.0;

  switch (cmd.kind) {
    case Command::Start: {
      Voice* voice = startVoice(cmd);
      applied = voice != nullptr;
      ackVoices = activeVoiceCount();
      if (voice != nullptr) ackState = static_cast<int>(voice->state);
      break;
    }
    case Command::Stop: {
      Voice* voice = findVoice(cmd.cueId);
      if (voice != nullptr) {
        if (!voice->started && voice->startFrame > now) {
          finishVoice(*voice, now, EndReason::Cancelled);
        } else {
          stopVoice(*voice, atOrNow(cmd.whenMs, sampleRate_, now), static_cast<double>(frameForMs(cmd.fadeMs, sampleRate_)),
                    EndReason::Stopped);
        }
        applied = true;
      }
      break;
    }
    case Command::StopAll: {
      const int64_t frame = atOrNow(cmd.whenMs, sampleRate_, now);
      for (Voice& voice : voices_) {
        if (!voice.active) continue;
        if (!voice.started && voice.startFrame > frame) {
          finishVoice(voice, frame, EndReason::Cancelled);
        } else {
          stopVoice(voice, frame, static_cast<double>(frameForMs(cmd.fadeMs, sampleRate_)), EndReason::Stopped);
        }
        applied = true;
      }
      break;
    }
    case Command::Release: {
      Voice* voice = findVoice(cmd.cueId);
      if (voice != nullptr && voice->sliceCount > 0) {
        // A sliced voice is released a slice at a time: the slice it is in finishes the pass
        // it is on, and the voice goes on into the next one — at the boundary, to the
        // sample — or ends there, when the release asked for that.
        voice->sliceRelease = true;
        voice->stopAtPassEnd = cmd.stopAtSliceEnd;
        applied = true;
        ackVoices = activeVoiceCount();
        break;
      }
      if (voice != nullptr && cmd.stopAtSliceEnd && voice->loopCount != 0) {
        // A loop asked to end where its pass does: this pass is its last.
        voice->loopCount = voice->loopsCompleted;
        applied = true;
        ackVoices = activeVoiceCount();
        break;
      }
      // A voice that is not looping is not vamping, and one whose file has no stated
      // length has no later to play to: either way there is nothing to release, and the
      // caller is told so rather than being told a change happened.
      if (voice != nullptr && voice->loopCount != 0 && voice->sourceFrames > 0) {
        // The released region starts at the top of the file rather than at the loop, so
        // the voice is free to play whatever lies between where it is now and the end.
        // Its position is left alone: the next sample it renders is the next sample of
        // the music, which is what makes the release sample-accurate.
        //
        // A cue trimmed of its trailing silence names where its sound stops, and that
        // edge replaces the file's own. Clamped to the media: a release past the end of
        // the file is only ever asking for all of it, and an end at the top of the file
        // leaves nothing to play — that empty region is finished below rather than left
        // with no end to reach.
        const double sourceEnd = static_cast<double>(voice->sourceFrames);
        const double sourceEndMs = sourceEnd * 1000.0 / static_cast<double>(voice->sampleRate);
        const double releasedEnd =
            cmd.hasEndMs
                ? static_cast<double>(frameForMs(std::clamp(cmd.endMs, 0.0, sourceEndMs), voice->sampleRate))
                : sourceEnd;
        voice->segmentStartFrame = 0.0;
        voice->segmentEndFrame = releasedEnd;
        voice->loopCount = 0;
        voice->loopsCompleted = 0;
        if (voice->streamSlot >= 0) publishRegion(*voice);
        if (releasedEnd <= 0.0) finishVoice(*voice, now, EndReason::Complete);
        applied = true;
      }
      ackVoices = activeVoiceCount();
      break;
    }
    case Command::Seek: {
      Voice* voice = findVoice(cmd.cueId);
      if (voice != nullptr) {
        double target = cmd.positionMs * static_cast<double>(voice->sampleRate) / 1000.0;
        if (voice->sliceCount > 0) {
          // A sliced voice moves to the slice that holds the place asked for, at its first
          // pass, so a load to a time inside a later slice plays on from that slice.
          const VoiceSlice* slices = slicesOf(*voice);
          int index = 0;
          while (index < voice->sliceCount - 1 && slices[index].endFrame <= target) index++;
          voice->sliceIndex = index;
          voice->slicePlays = 0;
          voice->sliceRelease = false;
          voice->segmentStartFrame = slices[index].startFrame;
          voice->segmentEndFrame = slices[index].endFrame;
        }
        if (target < voice->segmentStartFrame) target = voice->segmentStartFrame;
        if (target > voice->segmentEndFrame) target = voice->segmentEndFrame;
        const double continuation = voice->position;
        voice->position = target;
        // A seek is a join like a wrap (AD-29). The ring is addressed in absolute source
        // frames, so a target its window already covers is decoded and waiting and is played
        // from there; anywhere else, the command thread decoded the target into a pad before
        // the seek was sent, and the voice lands on that while the ring moves. Only a target
        // nothing holds sends the ring there with the voice waiting on it — counted.
        // A voice not yet sounding has nothing to crossfade from.
        beginJoin(*voice, voice->started ? continuation : -1.0);
        if (voice->streamSlot >= 0) publishRegion(*voice);
        ackState = static_cast<int>(voice->state);
        ackPositionMs = voice->sampleRate > 0 ? target * 1000.0 / static_cast<double>(voice->sampleRate) : 0.0;
        applied = true;
      }
      if (cmd.seekPad >= 0) {
        // The pad the seek was prepared on is the voice's now, or nobody's: either way it is
        // no longer held back for the seek.
        StreamSlot* slot = streams_.at(cmd.seekSlot);
        if (slot != nullptr && cmd.seekPad < kPadsPerStream) slot->pads[cmd.seekPad].pinned.store(false, std::memory_order_release);
      }
      break;
    }
    case Command::Cancel: {
      for (Voice& voice : voices_) {
        if (!voice.active) continue;
        if (std::strcmp(voice.cueId, cmd.cueId) != 0) continue;
        cancelVoice(voice, now, canceled);
      }
      applied = canceled > 0;
      break;
    }
    case Command::Pause: {
      Voice* voice = findVoice(cmd.cueId);
      if (voice != nullptr) {
        applied = pauseVoice(*voice, atOrNow(cmd.whenMs, sampleRate_, now));
        ackState = static_cast<int>(voice->state);
      }
      break;
    }
    case Command::Resume: {
      Voice* voice = findVoice(cmd.cueId);
      if (voice != nullptr) {
        applied = resumeVoice(*voice, atOrNow(cmd.whenMs, sampleRate_, now));
        ackState = static_cast<int>(voice->state);
      }
      break;
    }
    case Command::Master: {
      // Bounded where the window's fader is: silence up to twice unity, +6 dB.
      masterTarget_ = std::min(2.0, std::max(0.0, cmd.value));
      applied = true;
      break;
    }
    case Command::Fade: {
      Voice* voice = findVoice(cmd.cueId);
      if (voice != nullptr) {
        const int param = static_cast<int>(cmd.param);
        if (isFadeParam(param)) {
          const int64_t start = atOrNow(cmd.whenMs, sampleRate_, now);
          const double current = paramValue(*voice, param, start);
          FadeRamp& ramp = voice->ramps[param];
          ramp.active = false;
          if (cmd.durationMs <= 0.0) {
            switch (param) {
              case static_cast<int>(Param::Volume): voice->volume = cmd.value; break;
              case static_cast<int>(Param::Pan): voice->pan = cmd.value; break;
              case static_cast<int>(Param::Trim): voice->trim = cmd.value; break;
              default: voice->rate = cmd.value; break;
            }
          } else {
            ramp.active = true;
            ramp.from = current;
            ramp.to = cmd.value;
            ramp.startFrame = start;
            ramp.endFrame = start + static_cast<int64_t>(frameForMs(cmd.durationMs, sampleRate_));
            ramp.curve = cmd.curve;
            if (cmd.curve == Curve::Table) {
              CurveTable& table = rampTables_[voiceIndex(*voice)][param];
              table = cmd.shape;
              ramp.table = &table;
            }
          }
          applied = true;
        }
      }
      break;
    }
    case Command::Routing: {
      Voice* voice = findVoice(cmd.cueId);
      if (voice != nullptr) {
        voice->automaticRouting = cmd.routingAutomatic;
        indexRouting(*voice, cmd.routing, cmd.routingCount);
        applied = true;
      }
      break;
    }
    case Command::Bus: {
      if (cmd.busSlot >= 0 && cmd.busSlot < kMaxPatches) {
        Bus& bus = buses_[cmd.busSlot];
        const bool wasDefined = bus.defined;
        bus.defined = cmd.busDefined;
        definedBuses_ += (bus.defined ? 1 : 0) - (wasDefined ? 1 : 0);
        bus.channels = std::max(0, std::min(kMaxOutputChannels, cmd.busChannels));
        for (int channel = 0; channel < kMaxOutputChannels; channel++) {
          bus.map[channel] = channel < bus.channels ? cmd.busMap[channel] : -1;
        }
        // Bounded where the mixer's faders are: silence up to +12 dB.
        bus.gainTarget = std::min(4.0, std::max(0.0, cmd.value));
        // A patch that has just come into being starts at its level; one that is moved
        // ramps to it over the next block, so a fader does not click.
        if (!wasDefined) bus.gainCurrent = bus.gainTarget;
        bus.aux = cmd.busAux >= 0 && cmd.busAux < kMaxAuxOutputs ? cmd.busAux : -1;
        applied = true;
      }
      break;
    }
    case Command::OutputGains: {
      for (int output = 0; output < kMaxOutputChannels; output++) {
        outputGainTarget_[output] = std::min(4.0, std::max(0.0, static_cast<double>(cmd.outputGains[output])));
      }
      // The plain path is left until every output has arrived where it was sent, so a fader
      // brought back to 0 dB still ramps there.
      outputsAtUnity_ = false;
      applied = true;
      break;
    }
    case Command::AuxOutput: {
      if (cmd.auxSlot >= 0 && cmd.auxSlot < kMaxAuxOutputs && !auxScratch_.empty()) {
        auxChannels_[cmd.auxSlot] = std::max(0, std::min(kMaxOutputChannels, cmd.auxChannels));
        for (float& peak : auxPeak_[cmd.auxSlot]) peak = 0.0f;
        anyAux_ = false;
        for (int slot = 0; slot < kMaxAuxOutputs; slot++) anyAux_ = anyAux_ || auxChannels_[slot] > 0;
        applied = true;
      }
      break;
    }
    case Command::AuxLost: {
      if (cmd.auxSlot >= 0 && cmd.auxSlot < kMaxAuxOutputs) {
        ackVoices = activeVoiceCount();
        loseAux(cmd.auxSlot);
        applied = true;
      }
      break;
    }
    case Command::Panic: {
      ackVoices = activeVoiceCount();  // every voice this panic silences
      panic(atOrNow(cmd.whenMs, sampleRate_, now), static_cast<double>(frameForMs(cmd.fadeMs, sampleRate_)),
            cmd.reason);
      applied = true;
      break;
    }
    default: break;
  }

  if (cmd.ackId != 0) {
    Event event;
    event.kind = Event::Ack;
    event.ackId = cmd.ackId;
    event.ackApplied = applied;
    event.ackCanceled = canceled;
    event.ackVoices = ackVoices;
    event.state = ackState;
    event.ackPositionMs = ackPositionMs;
    event.cueId[0] = '\0';
    std::strncpy(event.cueId, cmd.cueId, sizeof(event.cueId) - 1);
    event.hasCue = cmd.cueId[0] != '\0';
    std::strncpy(event.runId, cmd.runId, sizeof(event.runId) - 1);
    event.hasRun = cmd.runId[0] != '\0';
    event.playing = false;
    event.activeGlobal = hasActiveVoices();
    event.atMs = static_cast<double>(clockFrames_) * 1000.0 / static_cast<double>(sampleRate_);
    emit(event);
  }
}

void Mixer::retryReclaims() {
  int remaining = 0;
  for (int i = 0; i < pendingStreamCount_; i++) {
    ReclaimItem item;
    item.streamSlot = pendingStreams_[i];
    if (reclaim_.push(item)) continue;
    pendingStreams_[remaining++] = pendingStreams_[i];
  }
  pendingStreamCount_ = remaining;
}

// A streaming decoder is filled forward from wherever it was moved to, so a jump in the
// voice's position that nothing has read ahead for leaves the ring parked on frames the voice
// will never ask for again. The ring is sent where the voice is; until it gets there the voice
// has nothing to play, and every frame of that is an underrun, counted as one (AD-29) — the
// read-ahead exists so that this is a fault, not the way a loop works.
void Mixer::requestStreamSeek(Voice& voice, int64_t frame) {
  if (voice.streamSlot < 0) return;
  StreamSlot* slot = streams_.at(voice.streamSlot);
  if (slot == nullptr) return;
  slot->ring.requestSeek(frame);
  voice.readSrc = -1;
  voice.ringTarget = -1;
}

void Mixer::publishRegion(const Voice& voice) {
  StreamSlot* slot = streams_.at(voice.streamSlot);
  if (slot == nullptr) return;
  slot->voiceSegmentStart.store(static_cast<int64_t>(std::floor(voice.segmentStartFrame)), std::memory_order_relaxed);
  slot->voiceSegmentEnd.store(static_cast<int64_t>(std::ceil(std::min(voice.segmentEndFrame, 9.0e18))), std::memory_order_relaxed);
  slot->voiceRegion.store(voice.sliceCount > 0 ? voice.sliceIndex : 0, std::memory_order_release);
}

/**
 * The join a jump makes (AD-29). `continuation` is where the file would have gone on had the
 * voice not jumped — the material it is leaving — or negative when nothing was sounding.
 *
 * Where the voice lands is read from whatever holds it: the cache; for a stream, the ring when
 * its window has it, or the pad the read-ahead (or a seek) decoded there. A pad is played while
 * the ring moves to where the pad ends — once the join's crossfade no longer needs the ring —
 * unless the ring is heading there anyway, as it is when a loop's pad ends where the ring is
 * parked. Nothing holding the target is the read-ahead's failure: the ring is sent there, and
 * the wait is counted as underruns.
 *
 * Where the sample landed on is within `kCleanJoinStep` of the one the file was going to play
 * next, the join is made sample for sample. Otherwise the two are crossfaded at equal power
 * over `kJoinCrossfadeMs`: the landing starts on its own frame, so a pass or a slice still
 * begins exactly where it did.
 */
void Mixer::beginJoin(Voice& voice, double continuation) {
  voice.xfadeLeft = 0;  // a join inside a join's crossfade starts from where it has got to
  // The material being left is read on from where the voice was reading it.
  const int leftSrc = voice.streamSlot >= 0 ? voice.readSrc : -2;
  const int64_t landing = static_cast<int64_t>(std::floor(voice.position));
  int inSrc = -1;
  const float* in = frameAt(voice, landing, inSrc);
  if (voice.streamSlot >= 0) {
    if (in == nullptr) {
      requestStreamSeek(voice, landing);
      return;
    }
    voice.readSrc = inSrc;
    voice.ringTarget = -1;
    if (inSrc >= 0) {
      const StreamSlot* slot = streams_.at(voice.streamSlot);
      voice.ringTarget = std::max<int64_t>(landing, slot->pads[inSrc].end() - slot->tailFrames);
    }
  }
  if (continuation >= 0.0 && in != nullptr) {
    const int64_t next = static_cast<int64_t>(std::floor(continuation));
    int outSrc = leftSrc;
    const float* out = frameAt(voice, next, outSrc);
    // Past the end of the file there is nothing to go on to: the waveform's next sample is
    // predicted from its last two, so a file made to loop meets itself cleanly, and where it
    // does not, the last sample played is held under the crossfade instead of silence — a
    // fade from silence would be a step of its own.
    float* held = xfadeHold_[voiceIndex(voice)];
    float predicted[kMaxOutputChannels] = {};
    if (out == nullptr) {
      int lastSrc = outSrc;
      const float* last = frameAt(voice, next - 1, lastSrc);
      int beforeSrc = lastSrc;
      const float* before = frameAt(voice, next - 2, beforeSrc);
      for (int channel = 0; channel < voice.channels; channel++) {
        const float a = last != nullptr ? last[channel] : 0.0f;
        const float b = before != nullptr ? before[channel] : a;
        predicted[channel] = 2.0f * a - b;
        held[channel] = a;
      }
    }
    float step = 0.0f;
    for (int channel = 0; channel < voice.channels; channel++) {
      step = std::max(step, std::fabs((out != nullptr ? out[channel] : predicted[channel]) - in[channel]));
    }
    if (step > kCleanJoinStep) {
      // A loop shorter than two crossfades gets one as long as half of it.
      const double length = (voice.segmentEndFrame - voice.segmentStartFrame) /
                            (static_cast<double>(voice.sampleRate) / static_cast<double>(sampleRate_));
      int frames = joinFrames_;
      if (length > 0.0 && length < 2.0 * frames) frames = std::max(1, static_cast<int>(length / 2.0));
      voice.xfadeLeft = frames;
      voice.xfadeTotal = frames;
      voice.xfadePos = continuation;
      voice.xfadeSrc = out != nullptr ? outSrc : kHeldSource;
    }
  }
  if (voice.xfadeLeft == 0) postRingTarget(voice);
}

void Mixer::postRingTarget(Voice& voice) {
  if (voice.ringTarget < 0 || voice.streamSlot < 0) return;
  const int64_t target = voice.ringTarget;
  voice.ringTarget = -1;
  StreamSlot* slot = streams_.at(voice.streamSlot);
  if (slot == nullptr) return;
  // Heading there already: the ring is linear from where it stands, and fills that far.
  const int64_t from = slot->ring.seekPending() ? slot->ring.pendingSeekTarget() : slot->ring.readFrame();
  if (target >= from && target < from + slot->ring.capacityFrames()) return;
  slot->ring.requestSeek(target);
}

void Mixer::blendOutgoing(Voice& voice, float* sample, double ratio) {
  float out[kMaxOutputChannels] = {};
  int src = voice.xfadeSrc;
  // The material being left is only ever under the landing: a frame of it that is not there
  // is silence in the fade, not a wait. Past the end of the file it is the last sample, held.
  if (src == kHeldSource) {
    const float* held = xfadeHold_[voiceIndex(voice)];
    for (int channel = 0; channel < voice.channels; channel++) out[channel] = held[channel];
  } else if (!readSample(voice, voice.xfadePos, src, out)) {
    for (int channel = 0; channel < voice.channels; channel++) out[channel] = 0.0f;
  } else {
    voice.xfadeSrc = src;
  }
  const double t = (static_cast<double>(voice.xfadeTotal - voice.xfadeLeft) + 0.5) / static_cast<double>(voice.xfadeTotal);
  const double in = std::sin(t * kHalfPi);
  const double away = std::cos(t * kHalfPi);
  for (int channel = 0; channel < voice.channels; channel++) {
    sample[channel] = static_cast<float>(static_cast<double>(sample[channel]) * in + static_cast<double>(out[channel]) * away);
  }
  voice.xfadePos += ratio;
  if (--voice.xfadeLeft == 0) postRingTarget(voice);
}

/**
 * After a streamed voice reads a frame: the read's source is remembered; a voice reading a
 * pad hands over to the ring once the ring holds the pad's last stretch (crossfading the two
 * when they differ — a decoder that does not seek to the sample — and switching outright when
 * they do not); and the ring frames the voice has finished with are released.
 */
void Mixer::afterStreamRead(Voice& voice, int src, int64_t base, double ratio) {
  StreamSlot* slot = streams_.at(voice.streamSlot);
  if (slot == nullptr) return;
  voice.readSrc = src;
  if (src >= 0) {
    const StreamPad& pad = slot->pads[src];
    const int64_t padEnd = pad.end();
    if (base >= padEnd - slot->tailFrames && slot->ring.holds(base) && slot->ring.holds(base + 1)) {
      const float* fromPad = pad.pcm.data() + (base - pad.target.load(std::memory_order_relaxed)) * slot->channels;
      const float* fromRing = slot->ring.readPtr(base);
      float step = 0.0f;
      for (int channel = 0; channel < voice.channels; channel++) step = std::max(step, std::fabs(fromPad[channel] - fromRing[channel]));
      if (step > kCleanJoinStep && voice.xfadeLeft == 0) {
        const int room = static_cast<int>(static_cast<double>(padEnd - base - 2) / std::max(ratio, 1e-9));
        const int frames = std::min(joinFrames_, room);
        if (frames > 0) {
          // From this frame: the pad at the voice's own place under the ring at the same place.
          voice.xfadeLeft = frames;
          voice.xfadeTotal = frames;
          voice.xfadePos = voice.position;
          voice.xfadeSrc = src;
        }
      }
      voice.readSrc = -1;
    }
    return;
  }
  // Released through the frame just played, not the next one: below rate 1 the same source
  // frame is played across several output frames, and releasing past it left the voice asking
  // for a frame the window had already dropped. A crossfade still reading the ring holds it
  // back to its own place.
  int64_t through = base;
  if (voice.xfadeLeft > 0 && voice.xfadeSrc == -1) through = std::min(through, static_cast<int64_t>(std::floor(voice.xfadePos)));
  if (through > slot->ring.readFrame()) slot->ring.release(through);
}

void Mixer::sweepPads(Voice& voice) {
  StreamSlot* slot = streams_.at(voice.streamSlot);
  if (slot == nullptr) return;
  for (int k = 0; k < kPadsPerStream; k++) {
    if (k == voice.readSrc || (voice.xfadeLeft > 0 && k == voice.xfadeSrc)) continue;
    StreamPad& pad = slot->pads[k];
    if (pad.state.load(std::memory_order_acquire) != static_cast<int>(PadState::Ready)) continue;
    if (!pad.unwanted.load(std::memory_order_acquire) || pad.pinned.load(std::memory_order_acquire)) continue;
    pad.state.store(static_cast<int>(PadState::Retired), std::memory_order_release);
  }
}

/**
 * One voice's frame: its sample, its gain and pan, and its routing into the device's outputs
 * or its patch's bus, then its position moved on. `Special` is a voice with something a plain
 * file voice does not have — a patch, a live input, slices — and the plain case is compiled
 * without them, so the matrix a show plays most of the time costs what it always did.
 */
template <bool Special>
void Mixer::mixVoiceFrame(Voice& voice, int64_t frame, int64_t blockStart, float* outFrame, int channels) {
  // Where this voice is mixed: the device's outputs, or the bus of the patch it plays
  // through. A patch that has gone (deleted while the voice played) leaves the voice on
  // the device's outputs rather than silent — a mis-patched cue stays audible.
  float* dest = outFrame;
  int destChannels = channels;
  if (Special && voice.patch >= 0) {
    const Bus& bus = buses_[voice.patch];
    if (bus.defined && bus.channels > 0) {
      dest = busData(voice.patch) + static_cast<size_t>(frame - blockStart) * static_cast<size_t>(bus.channels);
      destChannels = bus.channels;
    }
  }

  float sample[kMaxOutputChannels] = {};
  double ratio = 1.0;
  if (Special && voice.inputFeed >= 0) {
    // A live voice reads the block its feed delivered, already at the output's rate. A
    // feed that is not delivering is silence; the voice keeps its time.
    const float* block = inputs_ != nullptr ? inputs_->block(voice.inputFeed) : nullptr;
    const int stride = inputs_ != nullptr ? inputs_->channels(voice.inputFeed) : 0;
    if (block == nullptr || stride <= 0) {
      voice.position += 1.0;
      return;
    }
    const float* row = block + static_cast<size_t>(frame - blockStart) * static_cast<size_t>(stride);
    for (int channel = 0; channel < voice.channels; channel++) {
      const int source = inputMaps_[voiceIndex(voice)][channel];
      sample[channel] = source >= 0 && source < stride ? row[source] : 0.0f;
    }
  } else {
    const double rate = paramValue(voice, static_cast<int>(Param::Rate), frame);
    ratio = static_cast<double>(voice.sampleRate) / static_cast<double>(sampleRate_) * (rate > 0.0 ? rate : 1.0);
    int src = voice.readSrc;
    if (!readSample(voice, voice.position, src, sample)) {
      // A streamed frame that is not there is starvation, whatever the reason — a disk that
      // could not keep up, or a jump the read-ahead did not reach in time — and is counted.
      if (voice.streamSlot >= 0) {
        StreamSlot* slot = streams_.at(voice.streamSlot);
        if (slot != nullptr) slot->underruns.fetch_add(1, std::memory_order_relaxed);
        underruns_.fetch_add(1, std::memory_order_relaxed);
      }
      return;
    }
    if (voice.streamSlot >= 0) afterStreamRead(voice, src, static_cast<int64_t>(std::floor(voice.position)), ratio);
    if (voice.xfadeLeft > 0) blendOutgoing(voice, sample, ratio);
  }

  const double gain = paramValue(voice, static_cast<int>(Param::Volume), frame) *
                      paramValue(voice, static_cast<int>(Param::Trim), frame) * rampValue(voice.fadeIn, frame) *
                      rampValue(voice.stopFade, frame) * rampValue(voice.holdRamp, frame);

  double panLeft = 1.0;
  double panRight = 1.0;
  if (destChannels >= 2) {
    double pan = paramValue(voice, static_cast<int>(Param::Pan), frame);
    pan = std::max(-1.0, std::min(1.0, pan));
    if (voice.channels == 1) {
      const double x = (pan + 1.0) * 0.5;
      panLeft = std::cos(x * kHalfPi);
      panRight = std::sin(x * kHalfPi);
    } else if (pan <= 0.0) {
      panLeft = 1.0;
      panRight = std::sin((pan + 1.0) * kHalfPi);
    } else {
      panLeft = std::cos(pan * kHalfPi);
      panRight = 1.0;
    }
  }

  for (int output = 0; output < destChannels; output++) {
    double contribution = 0.0;
    if (voice.automaticRouting) {
      const int input = voice.channels == 1
                            ? (output < 2 ? 0 : -1)
                            : (output < voice.channels ? output : -1);
      if (input >= 0) contribution = sample[input];
      // Pan belongs to automatic routing. An explicit crosspoint list states its
      // own destinations and levels, so nothing is applied on top of it.
      if (output == 0) contribution *= panLeft;
      else if (output == 1) contribution *= panRight;
    } else {
      // The taps are grouped by output when the routing is applied, so this walks
      // only the crosspoints that feed the output being written.
      const int begin = voice.tapStart[output];
      const int end = voice.tapStart[output + 1];
      for (int t = begin; t < end; t++) {
        const Tap& tap = voice.taps[t];
        contribution += static_cast<double>(sample[tap.inputChannel]) * static_cast<double>(tap.gain);
      }
    }
    dest[output] += static_cast<float>(contribution * gain);
  }

  voice.position += ratio;
  if constexpr (Special) {
    if (voice.inputFeed >= 0) return;
    if (voice.sliceCount > 0) {
      if (voice.position >= voice.segmentEndFrame) advanceSlices(voice, frame);
      return;
    }
  }
  const double length = voice.segmentEndFrame - voice.segmentStartFrame;
  if (length > 0.0 && voice.position >= voice.segmentEndFrame) {
    const double continuation = voice.position;
    const double overshoot = voice.position - voice.segmentStartFrame;
    const int64_t wraps = static_cast<int64_t>(std::floor(overshoot / length));
    if (voice.loopCount < 0) {
      voice.loopsCompleted += static_cast<int>(wraps);
      voice.position -= static_cast<double>(wraps) * length;
    } else {
      const int64_t remaining = static_cast<int64_t>(voice.loopCount) - voice.loopsCompleted;
      if (wraps <= remaining) {
        voice.loopsCompleted += static_cast<int>(wraps);
        voice.position -= static_cast<double>(wraps) * length;
      } else {
        finishVoice(voice, frame + 1, EndReason::Complete);
      }
    }
    // The wrap is a join: a streamed voice lands in the pad its loop is held in, with the
    // ring parked where the loop ends (AD-29).
    if (voice.active) beginJoin(voice, continuation);
  }
}

void Mixer::render(float* out, int frames, int channels) {
  retryReclaims();
  const int64_t blockStart = clockFrames_;
  const int64_t blockEnd = blockStart + frames;

  // The live inputs deliver this block first — every feed that is open, whether a voice
  // reads it or not, so each one's controller stays locked to its device.
  if (inputs_ != nullptr && inputs_->anyOpen()) inputs_->pullAll(frames, sampleRate_, blockStart);
  // Each defined patch's bus starts the block empty.
  for (int slot = 0; slot < kMaxPatches && definedBuses_ > 0; slot++) {
    const Bus& bus = buses_[slot];
    if (!bus.defined || bus.channels <= 0) continue;
    std::memset(busData(slot), 0, static_cast<size_t>(frames) * static_cast<size_t>(bus.channels) * sizeof(float));
  }
  // So does each extra output device's.
  if (anyAux_) {
    for (int slot = 0; slot < kMaxAuxOutputs; slot++) {
      if (auxChannels_[slot] <= 0) continue;
      std::memset(auxData(slot), 0, static_cast<size_t>(frames) * static_cast<size_t>(auxChannels_[slot]) * sizeof(float));
    }
  }

  // Whether any voice has a patch, a live input or slices: read once a block, so a show using
  // none of them never reads those fields in the per-frame loop.
  const bool anySpecial = specialVoices_ > 0;

  // The pads the read-ahead has finished with, given back once a block (AD-29).
  for (Voice& voice : voices_) {
    if (voice.active && voice.streamSlot >= 0) sweepPads(voice);
  }

  for (int64_t frame = blockStart; frame < blockEnd; frame++) {
    float* outFrame = out + static_cast<size_t>(frame - blockStart) * static_cast<size_t>(channels);

    for (Voice& voice : voices_) {
      if (!voice.active) continue;
      // A held voice spends no time: nothing about it moves until it is let go.
      if (voice.pausedSince >= 0) {
        if (voice.resumeAt < 0 || frame < voice.resumeAt) continue;
        letGo(voice, frame);
      }
      if (voice.pauseAt >= 0 && frame >= voice.pauseAt) {
        voice.pausedSince = frame;
        voice.pauseAt = -1;
        continue;
      }
      if (frame < voice.startFrame) continue;
      if (!voice.started) {
        beginVoice(voice, frame);
        if (!voice.active) continue;
      }
      if (voice.stopFrame >= 0 && frame >= voice.stopFrame) {
        finishVoice(voice, frame, voice.pendingReason);
        continue;
      }
      if (voice.cachedData != nullptr && voice.position >= static_cast<double>(voice.cachedFrames)) {
        finishVoice(voice, frame, EndReason::Complete);
        continue;
      }
      if (voice.streamSlot >= 0) {
        // The end of a streamed file: the ring has read the last of it, the voice is past it,
        // and no pad holds where the voice is (a pad can hold the frames a moving ring does not).
        const StreamSlot* slot = streams_.at(voice.streamSlot);
        if (slot != nullptr && slot->eof.load(std::memory_order_acquire) && !slot->ring.seekPending() &&
            voice.position >= static_cast<double>(slot->ring.writeFrame()) &&
            (voice.readSrc < 0 || !slot->pads[voice.readSrc].holds(static_cast<int64_t>(std::floor(voice.position))))) {
          finishVoice(voice, frame, EndReason::Complete);
          continue;
        }
      }

      // Plain file voices take the path compiled without patches, live inputs or slices.
      if (anySpecial && voice.special) {
        mixVoiceFrame<true>(voice, frame, blockStart, outFrame, channels);
      } else {
        mixVoiceFrame<false>(voice, frame, blockStart, outFrame, channels);
      }
    }
  }
  mixBuses(out, frames, channels);
  applyMaster(out, frames, channels);
}

/**
 * A sliced voice has run past the end of its slice. The slice plays again while it has
 * passes left (for ever, for a vamp) unless a release asked it to make this pass its last;
 * then the voice goes on into the next slice — straight on, sample for sample, when the next
 * slice starts where this one ended, and with the frames past the edge carried into it when
 * skipped slices lie between — or ends, at the last slice or when the release said so.
 */
void Mixer::advanceSlices(Voice& voice, int64_t frame) {
  // Where the file would have gone on: what a jump below leaves, and crossfades from.
  const double continuation = voice.position;
  const int regionBefore = voice.sliceIndex;
  bool jumped = false;
  // A slice shorter than one step could otherwise be passed over many times in one frame;
  // a voice moves at most a slice's worth of passes per frame, which is all a frame can hold.
  for (int guard = 0; guard < kMaxSlices * 4 && voice.active && voice.position >= voice.segmentEndFrame; guard++) {
    const double over = voice.position - voice.segmentEndFrame;
    const VoiceSlice& slice = slicesOf(voice)[voice.sliceIndex];
    voice.slicePlays++;
    const bool again = !voice.sliceRelease && (slice.playCount < 0 || voice.slicePlays < slice.playCount);
    if (again) {
      voice.loopsCompleted++;
      voice.position = slice.startFrame + over;
      jumped = true;
      continue;
    }
    const bool stop = voice.sliceRelease && voice.stopAtPassEnd;
    voice.sliceRelease = false;
    if (stop || voice.sliceIndex + 1 >= voice.sliceCount) {
      finishVoice(voice, frame + 1, EndReason::Complete);
      return;
    }
    voice.sliceIndex++;
    voice.slicePlays = 0;
    const VoiceSlice& next = slicesOf(voice)[voice.sliceIndex];
    const bool contiguous = next.startFrame == slice.endFrame;
    voice.segmentStartFrame = next.startFrame;
    voice.segmentEndFrame = next.endFrame;
    voice.position = next.startFrame + over;
    if (!contiguous) jumped = true;
  }
  if (!voice.active) return;
  if (voice.streamSlot >= 0 && voice.sliceIndex != regionBefore) publishRegion(voice);
  // A wrap or a skip lands in what the read-ahead held for it (AD-29); running on into a slice
  // that starts where this one ended is no jump at all.
  if (jumped) beginJoin(voice, continuation);
}

/**
 * Each patch's bus onto the device outputs its map names: ramped from where its fader was to
 * where it is, metered after the fader, and summed — two patches on one output add up there,
 * as two cues on one output always have.
 */
void Mixer::mixBuses(float* out, int frames, int channels) {
  if (definedBuses_ == 0) return;
  for (int slot = 0; slot < kMaxPatches; slot++) {
    Bus& bus = buses_[slot];
    if (!bus.defined || bus.channels <= 0) continue;
    for (int channel = 0; channel < bus.channels; channel++) bus.peak[channel] = 0.0f;
    const float* data = busData(slot);
    const double from = bus.gainCurrent;
    const double to = bus.gainTarget;
    // The device it is mixed onto: the extra one it names while that is open, the main one
    // otherwise.
    float* dest = out;
    int destChannels = channels;
    if (bus.aux >= 0 && auxChannels_[bus.aux] > 0) {
      dest = auxData(bus.aux);
      destChannels = auxChannels_[bus.aux];
    }
    for (int frame = 0; frame < frames; frame++) {
      const double gain = from == to ? to : from + (to - from) * static_cast<double>(frame + 1) / static_cast<double>(frames);
      const float* row = data + static_cast<size_t>(frame) * static_cast<size_t>(bus.channels);
      float* outFrame = dest + static_cast<size_t>(frame) * static_cast<size_t>(destChannels);
      for (int channel = 0; channel < bus.channels; channel++) {
        const float value = static_cast<float>(static_cast<double>(row[channel]) * gain);
        const float level = std::fabs(value);
        if (level > bus.peak[channel]) bus.peak[channel] = level;
        const int output = bus.map[channel];
        if (output >= 0 && output < destChannels) outFrame[output] += value;
      }
    }
    bus.gainCurrent = to;
  }
}

/**
 * The output faders, the master level and the meter, over a block every voice and patch has
 * already been mixed into: each level is ramped from where the last block left it to where it
 * is asked to be, and each channel's peak is taken after them, so the meter reads what leaves
 * the engine.
 */
void Mixer::applyMaster(float* out, int frames, int channels) {
  const int metered = std::min(channels, kMaxOutputChannels);
  meterChannels_ = metered;
  for (int channel = 0; channel < metered; channel++) blockPeak_[channel] = 0.0f;
  const double from = masterCurrent_;
  const double to = masterTarget_;
  const bool flat = from == to;
  // One master for every device: the extra ones take the same ramp, from the same values.
  if (anyAux_) masterAux(frames, from, to);
  if (outputsAtUnity_) {
    for (int frame = 0; frame < frames; frame++) {
      const double gain = flat ? to : from + (to - from) * static_cast<double>(frame + 1) / static_cast<double>(frames);
      float* outFrame = out + static_cast<size_t>(frame) * static_cast<size_t>(channels);
      for (int channel = 0; channel < channels; channel++) {
        if (gain != 1.0) outFrame[channel] = static_cast<float>(static_cast<double>(outFrame[channel]) * gain);
        if (channel < metered) {
          const float level = std::fabs(outFrame[channel]);
          if (level > blockPeak_[channel]) blockPeak_[channel] = level;
        }
      }
    }
    masterCurrent_ = to;
    return;
  }
  for (int frame = 0; frame < frames; frame++) {
    const double progress = static_cast<double>(frame + 1) / static_cast<double>(frames);
    const double master = flat ? to : from + (to - from) * progress;
    float* outFrame = out + static_cast<size_t>(frame) * static_cast<size_t>(channels);
    for (int channel = 0; channel < channels; channel++) {
      double gain = master;
      if (channel < kMaxOutputChannels) {
        const double a = outputGainCurrent_[channel];
        const double b = outputGainTarget_[channel];
        gain *= a == b ? b : a + (b - a) * progress;
      }
      outFrame[channel] = static_cast<float>(static_cast<double>(outFrame[channel]) * gain);
      if (channel < metered) {
        const float level = std::fabs(outFrame[channel]);
        if (level > blockPeak_[channel]) blockPeak_[channel] = level;
      }
    }
  }
  masterCurrent_ = to;
  bool unity = true;
  for (int channel = 0; channel < kMaxOutputChannels; channel++) {
    outputGainCurrent_[channel] = outputGainTarget_[channel];
    if (outputGainTarget_[channel] != 1.0) unity = false;
  }
  outputsAtUnity_ = unity;
}

void Mixer::masterAux(int frames, double from, double to) {
  const bool flat = from == to;
  for (int slot = 0; slot < kMaxAuxOutputs; slot++) {
    const int channels = auxChannels_[slot];
    if (channels <= 0) continue;
    float* peaks = auxPeak_[slot];
    for (int channel = 0; channel < channels; channel++) peaks[channel] = 0.0f;
    float* data = auxData(slot);
    for (int frame = 0; frame < frames; frame++) {
      const double gain = flat ? to : from + (to - from) * static_cast<double>(frame + 1) / static_cast<double>(frames);
      float* row = data + static_cast<size_t>(frame) * static_cast<size_t>(channels);
      for (int channel = 0; channel < channels; channel++) {
        if (gain != 1.0) row[channel] = static_cast<float>(static_cast<double>(row[channel]) * gain);
        const float level = std::fabs(row[channel]);
        if (level > peaks[channel]) peaks[channel] = level;
      }
    }
  }
}

/**
 * An extra output device has gone. What was playing through its patches cannot be heard any
 * more, so those voices end the way a lost main device ends every voice — `device-lost`, at
 * once, a voice that had not begun yet `cancelled` — and nothing else is touched: the other
 * devices' voices play on, and the master, a pause and every fade carry on as they were. The
 * device stops being mixed, so its patches fall back to the main device's outputs of the same
 * numbers for anything started after this, until the device is opened again.
 */
void Mixer::loseAux(int slot) {
  const int64_t now = clockFrames_;
  if (auxChannels_[slot] > 0) {
    for (Voice& voice : voices_) {
      if (!voice.active || voice.patch < 0 || buses_[voice.patch].aux != slot) continue;
      finishVoice(voice, now, voice.started ? EndReason::DeviceLost : EndReason::Cancelled);
    }
  }
  auxChannels_[slot] = 0;
  for (float& peak : auxPeak_[slot]) peak = 0.0f;
  anyAux_ = false;
  for (int other = 0; other < kMaxAuxOutputs; other++) anyAux_ = anyAux_ || auxChannels_[other] > 0;
}

void Mixer::snapshotVoice(const Voice& voice, VoiceSnapshot& out) const {
  copyStr(out.cueId, sizeof(out.cueId), voice.cueId);
  copyStr(out.runId, sizeof(out.runId), voice.runId);
  out.state = static_cast<int>(voice.state);
  out.active = voice.active;
  out.startedAtMs = static_cast<double>(voice.startFrame) * 1000.0 / static_cast<double>(sampleRate_);
  out.loopsCompleted = voice.loopsCompleted;
  out.streamBytes = voice.streamBytes;
  // The slice the voice is in, numbered as the cue numbers them (skipped ones counted), and
  // the pass of it this is.
  if (voice.sliceCount > 0) {
    out.sliceIndex = slicesOf(voice)[voice.sliceIndex].sliceIndex;
    out.slicePass = voice.slicePlays + 1;
  } else {
    out.sliceIndex = -1;
    out.slicePass = 0;
  }
  const double positionMs = voice.sampleRate > 0
                                ? voice.position * 1000.0 / static_cast<double>(voice.sampleRate)
                                : 0.0;
  out.elapsedMs = positionMs;
  out.durationMs = voice.sourceFrames >= 0 && voice.sampleRate > 0
                       ? static_cast<double>(voice.sourceFrames) * 1000.0 / static_cast<double>(voice.sampleRate)
                       : 0.0;
  out.fraction = out.durationMs > 0.0 ? std::min(positionMs / out.durationMs, 1.0) : 0.0;

  const double length = voice.segmentEndFrame - voice.segmentStartFrame;
  // A sliced voice's progress is where it is in its file: a vamp holds the bar where the
  // music is, rather than sweeping it round each pass.
  if (voice.sliceCount > 0 || voice.loopCount == 0 || length <= 0.0) {
    out.runFraction = out.fraction;
  } else {
    const double consumed = static_cast<double>(voice.loopsCompleted) * length + (voice.position - voice.segmentStartFrame);
    if (voice.loopCount < 0) {
      out.runFraction = std::min(std::max((voice.position - voice.segmentStartFrame) / length, 0.0), 1.0);
    } else {
      const double total = length * static_cast<double>(voice.loopCount + 1);
      out.runFraction = total > 0.0 ? std::min(std::max(consumed / total, 0.0), 1.0) : 1.0;
    }
  }
}

void Mixer::writeSnapshot(MixSnapshot& staging, SnapshotCell<MixSnapshot>& cell, double clockMs,
                          uint64_t renderedFrames) const {
  staging.clockMs = clockMs;
  staging.renderedFrames = renderedFrames;
  staging.activeVoices = 0;
  staging.streamingVoices = 0;
  staging.underruns = underruns_.load(std::memory_order_relaxed);
  staging.voiceCount = 0;
  for (const Voice& voice : voices_) {
    if (!voice.active) continue;
    snapshotVoice(voice, staging.voices[staging.voiceCount]);
    staging.voiceCount++;
    staging.activeVoices++;
    if (voice.streamSlot >= 0) staging.streamingVoices++;
  }
  staging.active = staging.activeVoices > 0;
  staging.meterChannels = meterChannels_;
  for (int channel = 0; channel < kMaxOutputChannels; channel++) {
    staging.meterPeak[channel] = channel < meterChannels_ ? blockPeak_[channel] : 0.0f;
  }
  staging.masterGain = masterTarget_;
  cell.publish(staging);
}

/**
 * The meters only some shows have — each patch's, and each extra output device's — in a record
 * of their own: the main snapshot is copied word by word on every block and by every reader,
 * and a show with no patch and no extra device has nothing to add to it. Written only while a
 * patch is defined or an extra device is open, and once more when the last of them goes, so
 * their meters read zero.
 */
void Mixer::writeOptionalMeters(OptionalMeters& staging, SnapshotCell<OptionalMeters>& cell) const {
  const bool any = definedBuses_ > 0 || anyAux_;
  if (!any && !optionalMetersPublished_) return;
  for (int slot = 0; slot < kMaxPatches; slot++) {
    const Bus& bus = buses_[slot];
    staging.busChannels[slot] = bus.defined ? bus.channels : 0;
    for (int channel = 0; channel < kMaxOutputChannels; channel++) {
      staging.busPeak[slot][channel] = bus.defined && channel < bus.channels ? bus.peak[channel] : 0.0f;
    }
  }
  for (int slot = 0; slot < kMaxAuxOutputs; slot++) {
    staging.auxChannels[slot] = auxChannels_[slot];
    for (int channel = 0; channel < kMaxOutputChannels; channel++) {
      staging.auxPeak[slot][channel] = channel < auxChannels_[slot] ? auxPeak_[slot][channel] : 0.0f;
    }
  }
  optionalMetersPublished_ = any;
  cell.publish(staging);
}

}  // namespace ws
