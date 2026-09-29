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

}  // namespace

Mixer::Mixer(DecodedCache& cache, StreamPool& streams, SpscQueue<Event, 1024>& events,
             SpscQueue<ReclaimItem, 512>& reclaim)
    : cache_(cache), streams_(streams), events_(events), reclaim_(reclaim) {
  reset();
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
}

void Mixer::reset() {
  for (Voice& voice : voices_) voice = Voice{};
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

double Mixer::rampValue(const FadeRamp& ramp, int64_t frame) {
  if (!ramp.active) return 1.0;
  if (frame >= ramp.endFrame) return ramp.to;
  if (frame <= ramp.startFrame) return ramp.from;
  const double span = static_cast<double>(ramp.endFrame - ramp.startFrame);
  const double t = span > 0.0 ? static_cast<double>(frame - ramp.startFrame) / span : 1.0;
  return ramp.from + (ramp.to - ramp.from) * curveShape(t, ramp.curve);
}

double Mixer::paramValue(const Voice& voice, int param, int64_t frame) const {
  double base = 1.0;
  switch (param) {
    case static_cast<int>(Param::Volume): base = voice.volume; break;
    case static_cast<int>(Param::Pan): base = voice.pan; break;
    case static_cast<int>(Param::Trim): base = voice.trim; break;
    default: base = voice.rate; break;
  }
  const FadeRamp& ramp = voice.ramps[param];
  if (!ramp.active) return base;
  if (frame >= ramp.endFrame) return ramp.to;
  if (frame <= ramp.startFrame) return ramp.from;
  const double span = static_cast<double>(ramp.endFrame - ramp.startFrame);
  const double t = span > 0.0 ? static_cast<double>(frame - ramp.startFrame) / span : 1.0;
  return ramp.from + (ramp.to - ramp.from) * curveShape(t, ramp.curve);
}

bool Mixer::sampleOf(const Voice& voice, int64_t frame, int channel, float& out) const {
  if (frame < 0 || channel < 0 || channel >= voice.channels) return false;
  if (voice.cachedData != nullptr) {
    if (frame >= voice.cachedFrames) return false;
    out = voice.cachedData[frame * voice.channels + channel];
    return true;
  }
  if (voice.streamSlot >= 0) {
    const StreamSlot* slot = streams_.at(voice.streamSlot);
    if (slot == nullptr || !slot->inUse.load(std::memory_order_acquire)) return false;
    if (frame < slot->ring.readFrame() || frame >= slot->ring.writeFrame()) return false;
    out = slot->ring.readPtr(frame)[channel];
    return true;
  }
  return false;
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
  double segmentStart = options.startTimeMs * static_cast<double>(voice->sampleRate) / 1000.0;
  if (segmentStart < 0.0) segmentStart = 0.0;
  if (segmentStart > sourceEnd) segmentStart = sourceEnd;
  double segmentEnd = options.endTimeMs >= 0.0
                          ? options.endTimeMs * static_cast<double>(voice->sampleRate) / 1000.0
                          : sourceEnd;
  if (segmentEnd > sourceEnd) segmentEnd = sourceEnd;
  if (segmentEnd < segmentStart) segmentEnd = segmentStart;

  voice->segmentStartFrame = segmentStart;
  voice->segmentEndFrame = segmentEnd;
  voice->position = segmentStart;
  if (voice->streamSlot >= 0) {
    // A freshly acquired ring holds nothing yet, so the voice is positioning until the
    // first fill covers the frame it is asking for — whether or not it starts at an
    // offset. Counting those frames as starvation made an ordinary streamed start read
    // as "the audio waited for the disk".
    if (segmentStart > 0.0) requestStreamSeek(*voice, static_cast<int64_t>(segmentStart));
    else voice->awaitingSeek = true;
  }
  voice->loopCount = options.loopCount;
  voice->volume = options.volume;
  voice->pan = options.pan;
  voice->trim = options.trim;
  voice->rate = options.rate > 0.0 ? options.rate : 1.0;
  voice->automaticRouting = options.automatic;
  indexRouting(*voice, options.crosspoints, options.crosspointCount);

  voice->startFrame = atOrNow(cmd.whenMs, sampleRate_, clockFrames_);
  if (options.fadeInMs > 0.0) {
    voice->fadeIn.active = true;
    voice->fadeIn.from = 0.0;
    voice->fadeIn.to = 1.0;
    voice->fadeIn.startFrame = voice->startFrame;
    voice->fadeIn.endFrame = voice->startFrame + frameForMs(options.fadeInMs, sampleRate_);
    voice->fadeIn.curve = Curve::Linear;
  }
  emitState(voice, true);
  return voice;
}

void Mixer::stopVoice(Voice& voice, int64_t frame, double fadeFrames, EndReason reason) {
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
        if (target < voice->segmentStartFrame) target = voice->segmentStartFrame;
        if (target > voice->segmentEndFrame) target = voice->segmentEndFrame;
        voice->position = target;
        if (voice->streamSlot >= 0) {
          StreamSlot* slot = streams_.at(voice->streamSlot);
          if (slot != nullptr) {
            // The ring is addressed in absolute source frames, so a target the window
            // already covers is decoded and waiting: the jump plays out of the pre-roll
            // and nothing has to be repositioned. Asking for it anyway throws away
            // frames that were already read, reads them back off the disk, and leaves
            // the window empty under a voice that is playing — silence to the operator,
            // and an underrun to the counters, for a seek that needed no work at all.
            const int64_t frame = static_cast<int64_t>(target);
            if (frame < slot->ring.readFrame() || frame >= slot->ring.writeFrame()) {
              slot->eof.store(false, std::memory_order_relaxed);
              requestStreamSeek(*voice, frame);
            }
          }
        }
        ackState = static_cast<int>(voice->state);
        ackPositionMs = voice->sampleRate > 0 ? target * 1000.0 / static_cast<double>(voice->sampleRate) : 0.0;
        applied = true;
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

// A streaming decoder is filled forward from wherever it was opened, so any jump in the
// voice's position — a start at an offset, a seek, a loop back to the segment start —
// leaves the ring window parked on frames the voice will never ask for again. The voice
// then waits forever on a window that can never advance: silence and an underrun for
// every frame played. The window has to be moved with the voice, and the frames spent
// waiting for it are the reposition, not starvation.
void Mixer::requestStreamSeek(Voice& voice, int64_t frame) {
  if (voice.streamSlot < 0) return;
  StreamSlot* slot = streams_.at(voice.streamSlot);
  if (slot == nullptr) return;
  slot->ring.requestSeek(frame);
  voice.awaitingSeek = true;
}

void Mixer::render(float* out, int frames, int channels) {
  retryReclaims();
  const int64_t blockStart = clockFrames_;
  const int64_t blockEnd = blockStart + frames;

  for (int64_t frame = blockStart; frame < blockEnd; frame++) {
    float* outFrame = out + static_cast<size_t>(frame - blockStart) * static_cast<size_t>(channels);

    for (Voice& voice : voices_) {
      if (!voice.active) continue;
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
        const StreamSlot* slot = streams_.at(voice.streamSlot);
        if (slot != nullptr && slot->eof.load(std::memory_order_acquire) &&
            voice.position >= static_cast<double>(slot->ring.writeFrame())) {
          finishVoice(voice, frame, EndReason::Complete);
          continue;
        }
      }

      const double rate = paramValue(voice, static_cast<int>(Param::Rate), frame);
      const double ratio = static_cast<double>(voice.sampleRate) / static_cast<double>(sampleRate_) *
                           (rate > 0.0 ? rate : 1.0);
      const int64_t base = static_cast<int64_t>(std::floor(voice.position));
      const double frac = voice.position - static_cast<double>(base);

      // Once the ring covers the frame the voice is asking for, the reposition is done
      // and later starvation is starvation again.
      if (voice.awaitingSeek) {
        const StreamSlot* slot = streams_.at(voice.streamSlot);
        if (slot != nullptr && base >= slot->ring.readFrame() && base < slot->ring.writeFrame()) {
          voice.awaitingSeek = false;
        }
      }

      float sample[kMaxOutputChannels] = {};
      bool have = true;
      for (int channel = 0; channel < voice.channels; channel++) {
        float first = 0.0f;
        if (!sampleOf(voice, base, channel, first)) {
          have = false;
          break;
        }
        float second = first;
        if (frac > 0.0) {
          if (!sampleOf(voice, base + 1, channel, second)) {
            bool atEnd = false;
            if (voice.cachedData != nullptr) {
              atEnd = base + 1 >= voice.cachedFrames;
            } else if (voice.streamSlot >= 0) {
              const StreamSlot* slot = streams_.at(voice.streamSlot);
              atEnd = slot != nullptr && slot->eof.load(std::memory_order_acquire) &&
                      base + 1 >= slot->ring.writeFrame();
            }
            if (atEnd) {
              second = first;
            } else {
              have = false;
              break;
            }
          }
        }
        sample[channel] = static_cast<float>(static_cast<double>(first) +
                                             (static_cast<double>(second) - static_cast<double>(first)) * frac);
      }

      if (!have) {
        if (voice.streamSlot >= 0 && !voice.awaitingSeek) {
          StreamSlot* slot = streams_.at(voice.streamSlot);
          if (slot != nullptr) slot->underruns.fetch_add(1, std::memory_order_relaxed);
          underruns_.fetch_add(1, std::memory_order_relaxed);
        }
        continue;
      }

      if (voice.streamSlot >= 0) {
        StreamSlot* slot = streams_.at(voice.streamSlot);
        // Release the frame just played, not the next one: below rate 1 the same source
        // frame is played across several output frames, and releasing past it left the
        // voice asking for a frame the window had already dropped — silence and an
        // underrun per output frame, for good, on any cue playing a long file slower
        // than real time (a rate below 1, or a rate fade on the way down).
        if (slot != nullptr) slot->ring.release(base);
      }

      const double gain = paramValue(voice, static_cast<int>(Param::Volume), frame) *
                          paramValue(voice, static_cast<int>(Param::Trim), frame) * rampValue(voice.fadeIn, frame) *
                          rampValue(voice.stopFade, frame);

      double panLeft = 1.0;
      double panRight = 1.0;
      if (channels >= 2) {
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

      for (int output = 0; output < channels; output++) {
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
        outFrame[output] += static_cast<float>(contribution * gain);
      }

      voice.position += ratio;
      const double length = voice.segmentEndFrame - voice.segmentStartFrame;
      if (length > 0.0 && voice.position >= voice.segmentEndFrame) {
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
        // A streamed voice wraps back to frames the ring has long since passed, so the
        // window has to follow it back or the rest of the run plays nothing.
        if (voice.active) requestStreamSeek(voice, static_cast<int64_t>(voice.position));
      }
    }
  }
}

void Mixer::snapshotVoice(const Voice& voice, VoiceSnapshot& out) const {
  copyStr(out.cueId, sizeof(out.cueId), voice.cueId);
  copyStr(out.runId, sizeof(out.runId), voice.runId);
  out.state = static_cast<int>(voice.state);
  out.active = voice.active;
  out.startedAtMs = static_cast<double>(voice.startFrame) * 1000.0 / static_cast<double>(sampleRate_);
  out.loopsCompleted = voice.loopsCompleted;
  out.streamBytes = voice.streamBytes;
  const double positionMs = voice.sampleRate > 0
                                ? voice.position * 1000.0 / static_cast<double>(voice.sampleRate)
                                : 0.0;
  out.elapsedMs = positionMs;
  out.durationMs = voice.sourceFrames >= 0 && voice.sampleRate > 0
                       ? static_cast<double>(voice.sourceFrames) * 1000.0 / static_cast<double>(voice.sampleRate)
                       : 0.0;
  out.fraction = out.durationMs > 0.0 ? std::min(positionMs / out.durationMs, 1.0) : 0.0;

  const double length = voice.segmentEndFrame - voice.segmentStartFrame;
  if (voice.loopCount == 0 || length <= 0.0) {
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
  cell.publish(staging);
}

}  // namespace ws
