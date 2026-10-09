#include "stream.h"

#include "util.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <thread>
#include <vector>

namespace ws {
namespace {

/** How much of the ring an acquire fills before it publishes the slot: enough that a start —
 *  at the top of the file or anywhere in it — has its first frames before the decode thread
 *  has come round once. */
constexpr int64_t kPrefillMs = 250;
/** The smallest pad worth holding: a join's crossfade and the frames either side of it. */
constexpr int64_t kMinPadFrames = 2048;

bool repeats(const VoiceSlice& region) { return region.playCount != 1; }

/** What the read-ahead wants held next: a region's loop, or a landing at a jump's target. */
struct PadWant {
  int64_t target = 0;
  int64_t frames = 0;
  int tag = 0;
  PadKind kind = PadKind::Landing;
  /** Whether the ring's own decode will run through the target before the voice needs it, so
   *  the pad can be copied out of the ring — the same samples the first pass played. */
  bool capturable = false;
};

int64_t firstFrame(double frame) { return static_cast<int64_t>(std::floor(frame)); }

}  // namespace

StreamPool::StreamPool() {
  scratch_.resize(static_cast<size_t>(kMaxChunkFrames) * static_cast<size_t>(kMaxOutputChannels));
}

StreamPool::~StreamPool() { closeAll(); }

int64_t StreamPool::readSource(Source& source, float* out, int64_t frames) {
  if (testReadDelayUs_ > 0) std::this_thread::sleep_for(std::chrono::microseconds(testReadDelayUs_));
  return source.readFrames(out, frames);
}

int StreamPool::acquire(const std::string& path, int64_t prerollMs, int64_t maxBytesPerVoice, int64_t maxTotalBytes,
                        StreamRefusal& refusal, std::string& error, SourceInfo& info, const StartOptions* options,
                        const std::string& cueId) {
  refusal = StreamRefusal::None;
  int index = -1;
  for (int i = 0; i < kMaxStreams; i++) {
    bool expected = false;
    if (slots_[i].claimed.compare_exchange_strong(expected, true, std::memory_order_acq_rel)) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    // The stream-slot count is engine-internal (it is not a declared bound), and the
    // wire has always answered a stream it could not open with `decode`; only the
    // declared total budget is a refusal code of its own.
    error = "no free streaming slot (limit is " + std::to_string(kMaxStreams) + ")";
    return -1;
  }

  StreamSlot& slot = slots_[index];
  // The file is opened with the slot claimed but unpublished: the filler is told about a
  // slot only once its ring is real, and `openSource` can take as long as it likes
  // without stalling a decode pass or blocking another acquire.
  std::unique_ptr<Source> source = openSource(path, error);
  if (!source) {
    refusal = StreamRefusal::Decode;
    slot.claimed.store(false, std::memory_order_release);
    return -1;
  }
  info = source->info();

  const int channels = info.channels > 0 ? info.channels : 2;
  const int sampleRate = info.sampleRate > 0 ? info.sampleRate : 48000;
  int64_t capacityFrames = sampleRate * prerollMs / 1000;
  if (capacityFrames < 4096) capacityFrames = 4096;
  const int64_t bytesPerFrame = static_cast<int64_t>(channels) * static_cast<int64_t>(sizeof(float));
  // The per-voice ring is capped by the caller's byte budget — the declaration's when a
  // configuration names none.
  const int64_t byteCap = maxBytesPerVoice > 0 ? maxBytesPerVoice : limitValue(LimitId::StreamMaxBytesPerVoice);
  if (capacityFrames * bytesPerFrame > byteCap) capacityFrames = byteCap / bytesPerFrame;
  if (capacityFrames < 4096) {
    // The frame floor keeps a short pre-roll a real ring, but the byte cap is a declared
    // bound: when it is below the floor the cap wins, or a caller asking for a tiny ring
    // would get one above what it allowed. One frame is the smallest workable ring.
    capacityFrames = std::max<int64_t>(1, std::min<int64_t>(4096, byteCap / bytesPerFrame));
  }

  // The voice's path through the file, as the mixer will play it (plan.h): what the pads
  // follow. A start that names no plan is one region, the whole file, played once.
  StartOptions plain;
  const StartOptions& start = options != nullptr ? *options : plain;
  const double sourceEnd = info.frames >= 0 ? static_cast<double>(info.frames) : 1.0e18;
  const PlannedStart planned = planVoice(start, sampleRate, sourceEnd, false, slot.plan);
  int planCount = planned.sliceCount;
  if (planCount == 0) {
    slot.plan[0].startFrame = planned.segmentStart;
    slot.plan[0].endFrame = planned.segmentEnd;
    slot.plan[0].playCount = start.loopCount == 0 ? 1 : (start.loopCount < 0 ? -1 : start.loopCount + 1);
    slot.plan[0].sliceIndex = 0;
    planCount = 1;
  }

  // The pads come out of what the per-voice bound leaves beside the ring. Each is big enough
  // for the longest region the plan loops (and the frames just past it), or a landing,
  // whichever is the more — so any pad can serve any jump — and no bigger than an even share
  // of what is left. A loop longer than that plays its passes from a pad as long as one can
  // be, with the rest from the ring.
  const int64_t tailFrames = padTailFrames(sampleRate);
  const int64_t landingFrames = std::max<int64_t>(kMinPadFrames, sampleRate * kLandingMs / 1000);
  int64_t wantedPad = landingFrames;
  for (int i = 0; i < planCount; i++) {
    if (!repeats(slot.plan[i])) continue;
    const int64_t length = static_cast<int64_t>(std::ceil(slot.plan[i].endFrame)) - firstFrame(slot.plan[i].startFrame);
    wantedPad = std::max(wantedPad, length + tailFrames);
  }
  int64_t padFrames = std::min(wantedPad, (byteCap / bytesPerFrame - capacityFrames) / kPadsPerStream);
  if (padFrames < kMinPadFrames) padFrames = 0;

  // The declared total streaming budget, read as the pool's own accounting: the ring is
  // reserved against the resident total before it is allocated, so a refusal here is
  // exactly the figure `info()` reports — and two acquires racing cannot both be let
  // past a budget with room for one. Pads give way first: smaller, then none, before the
  // ring itself is refused.
  int64_t reserved = 0;
  if (maxTotalBytes > 0) {
    int64_t resident = residentBytes_.load(std::memory_order_relaxed);
    for (;;) {
      const int64_t room = maxTotalBytes - resident - capacityFrames * bytesPerFrame;
      int64_t pads = padFrames;
      if (room < pads * kPadsPerStream * bytesPerFrame) pads = std::max<int64_t>(0, room / (kPadsPerStream * bytesPerFrame));
      if (pads < kMinPadFrames) pads = 0;
      reserved = (capacityFrames + pads * kPadsPerStream) * bytesPerFrame;
      if (resident + reserved > maxTotalBytes) {
        refusal = StreamRefusal::Limit;
        error = "the streaming budget is full (streamMaxTotalBytes " + std::to_string(maxTotalBytes) +
                "): a further " + std::to_string(capacityFrames * bytesPerFrame) + " bytes would exceed it";
        slot.claimed.store(false, std::memory_order_release);
        return -1;
      }
      if (residentBytes_.compare_exchange_weak(resident, resident + reserved, std::memory_order_acq_rel)) {
        padFrames = pads;
        break;
      }
    }
  } else {
    reserved = (capacityFrames + padFrames * kPadsPerStream) * bytesPerFrame;
    residentBytes_.fetch_add(reserved, std::memory_order_relaxed);
  }

  // Built unpublished, by this thread alone: the ring's storage, the pads', and the ring's
  // first frames — read from where the voice starts, so a start at an offset is not a wait
  // for a reposition. Where the voice starts at the top of a region it loops, the pad for the
  // loop is copied out of those same frames.
  slot.pcm.assign(static_cast<size_t>(capacityFrames * channels), 0.0f);
  slot.source = std::move(source);
  slot.path = path;  // the pad reader opens it; nothing reads it before the slot is published
  slot.channels = channels;
  slot.sampleRate = sampleRate;
  slot.sourceFrames = info.frames;
  slot.capacityFrames = capacityFrames;
  slot.prerollFrames = capacityFrames;  // the ring is the pre-roll budget
  slot.padFrames = padFrames;
  slot.landingFrames = std::min(landingFrames, padFrames);
  slot.tailFrames = tailFrames;
  slot.planCount = planCount;
  slot.planSliced = planned.sliceCount > 0;
  slot.voiceRegion.store(planned.sliceCount > 0 ? planned.sliceIndex : 0, std::memory_order_relaxed);
  slot.voiceSegmentStart.store(firstFrame(planned.segmentStart), std::memory_order_relaxed);
  slot.voiceSegmentEnd.store(static_cast<int64_t>(std::ceil(std::min(planned.segmentEnd, 9.0e18))), std::memory_order_relaxed);
  slot.reader.reset();
  slot.readerFrame = -1;
  for (StreamPad& pad : slot.pads) {
    pad.pcm.assign(static_cast<size_t>(padFrames * channels), 0.0f);
    pad.capacityFrames = padFrames;
    pad.state.store(static_cast<int>(PadState::Free), std::memory_order_relaxed);
    pad.filled.store(0, std::memory_order_relaxed);
    pad.tag.store(-1, std::memory_order_relaxed);
    pad.unwanted.store(false, std::memory_order_relaxed);
    pad.pinned.store(false, std::memory_order_relaxed);
    pad.wanted = 0;
    pad.capture = false;
  }
  slot.eof.store(false, std::memory_order_relaxed);
  slot.underruns.store(0, std::memory_order_relaxed);
  slot.ring.configure(slot.pcm.data(), capacityFrames, channels, static_cast<double>(sampleRate));
  const int64_t startFrame = firstFrame(planned.position);
  if (startFrame > 0) {
    const bool ok = slot.source->seekToFrame(startFrame);
    slot.eof.store(!ok, std::memory_order_relaxed);
  }
  slot.ring.resetForSeek(startFrame);
  const int64_t prefill = std::min<int64_t>(capacityFrames, sampleRate * kPrefillMs / 1000);
  while (!slot.eof.load(std::memory_order_relaxed) && slot.ring.writeFrame() - startFrame < prefill) {
    if (!fillOne(slot)) break;
  }
  tendPads(slot);

  // Published under the pool's mutex: a decode pass sees a slot as in use only with a
  // configured ring behind it, and `release` cannot be tearing the slot down meanwhile.
  {
    std::lock_guard<std::mutex> lock(mutex_);
    slot.cueId = cueId;
    slot.sequence = sequence_.fetch_add(1, std::memory_order_relaxed) + 1;
    slot.inUse.store(true, std::memory_order_release);
  }
  return index;
}

StreamSlot* StreamPool::at(int index) {
  if (index < 0 || index >= kMaxStreams) return nullptr;
  return &slots_[index];
}

const StreamSlot* StreamPool::at(int index) const {
  if (index < 0 || index >= kMaxStreams) return nullptr;
  return &slots_[index];
}

void StreamPool::release(int index, bool wait) {
  std::lock_guard<std::mutex> lock(mutex_);
  releaseLocked(index, wait);
}

// The teardown itself, for callers that already hold the mutex: the slot stops being filled
// before anything it holds is freed, and the storage goes with it. A slot that was never
// published is not this call's to reclaim — its claim belongs to the acquire that is still
// building it. A seek still preparing a pad holds the slot's pad lock: a caller that may wait
// waits for it, and the service thread (`wait` false), which answers every connection's
// acknowledgements, leaves the release to a later pass of `fillAll` instead.
void StreamPool::releaseLocked(int index, bool wait) {
  if (index < 0 || index >= kMaxStreams) return;
  StreamSlot& slot = slots_[index];
  if (!slot.inUse.load(std::memory_order_acquire)) return;
  std::unique_lock<std::mutex> pads(slot.padMutex, std::defer_lock);
  if (wait) {
    pads.lock();
  } else if (!pads.try_lock()) {
    slot.releaseDeferred = true;
    return;
  }
  slot.releaseDeferred = false;
  slot.inUse.store(false, std::memory_order_release);
  residentBytes_.fetch_sub(slot.ringBytes(), std::memory_order_relaxed);
  slot.source.reset();
  slot.reader.reset();
  slot.readerFrame = -1;
  slot.pcm.clear();
  slot.pcm.shrink_to_fit();
  for (StreamPad& pad : slot.pads) {
    pad.state.store(static_cast<int>(PadState::Free), std::memory_order_relaxed);
    pad.filled.store(0, std::memory_order_relaxed);
    pad.pcm.clear();
    pad.pcm.shrink_to_fit();
    pad.capacityFrames = 0;
  }
  slot.capacityFrames = 0;
  slot.prerollFrames = 0;
  slot.padFrames = 0;
  slot.planCount = 0;
  slot.path.clear();
  slot.cueId.clear();
  // The slot is free again for the pool to hand out: the claim goes with the publication.
  slot.claimed.store(false, std::memory_order_release);
}

int64_t StreamPool::releaseByPath(const std::string& path) {
  std::lock_guard<std::mutex> lock(mutex_);
  int64_t released = 0;
  for (int i = 0; i < kMaxStreams; i++) {
    if (slots_[i].inUse.load(std::memory_order_acquire) && slots_[i].path == path) {
      releaseLocked(i);
      released++;
    }
  }
  return released;
}

bool StreamPool::fillOne(StreamSlot& slot) {
  if (slot.ring.seekPending()) {
    const int64_t target = slot.ring.pendingSeekTarget();
    const bool ok = slot.source != nullptr && slot.source->seekToFrame(target);
    slot.ring.resetForSeek(target);
    slot.eof.store(!ok, std::memory_order_relaxed);
    if (!slot.ring.finishSeek(target)) return false;  // asked for somewhere else meanwhile
    if (!ok) return false;
  }

  const int64_t capacity = slot.ring.capacityFrames();
  int64_t produced = 0;
  while (produced < kMaxChunkFrames) {
    const int64_t write = slot.ring.writeFrame();
    const int64_t free = capacity - (write - slot.ring.readFrame());
    if (free <= 0) break;
    const int64_t room = capacity - (write % capacity);
    int64_t want = std::min<int64_t>({free, room, kMaxChunkFrames - produced});
    if (want <= 0) break;
    float* dest = slot.ring.writePtr(write);
    const int64_t got = slot.source != nullptr ? readSource(*slot.source, dest, want) : 0;
    if (got <= 0) {
      slot.eof.store(true, std::memory_order_relaxed);
      break;
    }
    slot.ring.publish(write + got);
    produced += got;
    if (got < want) break;
  }
  return produced > 0;
}

bool StreamPool::ensureReader(StreamSlot& slot) {
  if (slot.reader) return true;
  std::string error;
  slot.reader = openSource(slot.path, error);
  slot.readerFrame = 0;
  return slot.reader != nullptr;
}

/**
 * A free pad for a filler holding the slot's pad lock, or -1 when taking one would leave
 * fewer than `keepFree` behind: the read-ahead keeps one back so a seek always has a pad to
 * land on.
 */
int StreamPool::claimPad(StreamSlot& slot, int keepFree) {
  int free = 0;
  int first = -1;
  for (int k = 0; k < kPadsPerStream; k++) {
    const int state = slot.pads[k].state.load(std::memory_order_acquire);
    if (state == static_cast<int>(PadState::Free) || state == static_cast<int>(PadState::Retired)) {
      free++;
      if (first < 0) first = k;
    }
  }
  if (first < 0 || free <= keepFree) return -1;
  StreamPad& pad = slot.pads[first];
  pad.unwanted.store(false, std::memory_order_relaxed);
  pad.pinned.store(false, std::memory_order_relaxed);
  pad.filled.store(0, std::memory_order_relaxed);
  pad.state.store(static_cast<int>(PadState::Filling), std::memory_order_release);
  return first;
}

/**
 * Moves one pad on: copies what the ring now holds of it (a captured pad), or reads a chunk
 * with the pad reader (`mayRead`). A captured pad whose frames the ring has dropped, or moved
 * away from, carries on from the reader. Returns whether the reader was used.
 */
bool StreamPool::fillPadChunk(StreamSlot& slot, StreamPad& pad, bool mayRead) {
  const int channels = slot.channels;
  const int64_t target = pad.target.load(std::memory_order_relaxed);
  int64_t filled = pad.filled.load(std::memory_order_relaxed);
  bool usedReader = false;
  if (pad.capture && !slot.ring.seekPending()) {
    // The ring holds [read, write) and is the only writer of it: frames this thread published
    // stay put until it writes over them, which it is not doing now. While the ring is moving
    // there is nothing to copy, and nothing to decide until it has moved.
    const int64_t next = target + filled;
    const int64_t read = slot.ring.readFrame();
    const int64_t write = slot.ring.writeFrame();
    if (next >= read && next < write) {
      const int64_t take = std::min(write - next, pad.wanted - filled);
      for (int64_t frame = 0; frame < take; frame++) {
        std::memcpy(pad.pcm.data() + (filled + frame) * channels, slot.ring.readPtr(next + frame),
                    sizeof(float) * static_cast<size_t>(channels));
      }
      filled += take;
    } else if (next < read) {
      // The ring has gone past: the rest comes from the reader.
      pad.capture = false;
    } else if (slot.eof.load(std::memory_order_relaxed) && next >= write) {
      pad.wanted = filled;  // the file ends inside the pad
    }
    // Otherwise the ring has not got there yet: it will, and the copy carries on then.
  }
  if (!pad.capture && filled < pad.wanted && mayRead && ensureReader(slot)) {
    usedReader = true;
    const int64_t next = target + filled;
    bool ok = true;
    if (slot.readerFrame != next) {
      ok = slot.reader->seekToFrame(next);
      slot.readerFrame = ok ? next : -1;
    }
    const int64_t want = std::min<int64_t>(kMaxChunkFrames, pad.wanted - filled);
    const int64_t got = ok ? readSource(*slot.reader, pad.pcm.data() + filled * channels, want) : 0;
    if (got > 0) {
      filled += got;
      slot.readerFrame += got;
    }
    if (got < want) pad.wanted = filled;  // the end of the file, or a reader that cannot go on
  }
  pad.filled.store(filled, std::memory_order_relaxed);
  if (filled >= pad.wanted) {
    pad.state.store(static_cast<int>(filled > 0 ? PadState::Ready : PadState::Free), std::memory_order_release);
  }
  return usedReader;
}

/**
 * The read-ahead. From the region the voice is in, the plan names what the voice will need
 * held: this region's loop, when it repeats, and the next two jumps after it — a region that
 * loops, or one the voice lands in from somewhere it does not run on from. Each is claimed
 * while a pad stays free for a seek, and filled a chunk a pass; a loop the ring will run
 * through on its own is copied out of the ring as it does, so its later passes are the very
 * samples its first one played. What the plan no longer names is marked for the audio thread
 * to give back.
 */
void StreamPool::tendPads(StreamSlot& slot) {
  if (slot.padFrames <= 0 || slot.planCount <= 0) return;
  std::unique_lock<std::mutex> lock(slot.padMutex, std::try_to_lock);
  if (!lock.owns_lock()) return;  // a seek is preparing its landing; the next pass will do

  const int count = slot.planCount;
  const int current = std::max(0, std::min(count - 1, slot.voiceRegion.load(std::memory_order_acquire)));
  const int64_t ringRead = slot.ring.readFrame();
  const int64_t ringReach = ringRead + slot.ring.capacityFrames();
  auto loopWant = [&](int region, bool linear) {
    const VoiceSlice& slice = slot.plan[region];
    PadWant want;
    want.target = firstFrame(slice.startFrame);
    want.frames = std::min(slot.padFrames, static_cast<int64_t>(std::ceil(slice.endFrame)) - want.target + slot.tailFrames);
    want.tag = region;
    want.kind = PadKind::Loop;
    // The ring runs through the loop's start before the voice gets there when nothing on the
    // way moves it, and it has not passed that start already.
    want.capturable = linear && want.target >= ringRead;
    return want;
  };

  PadWant wants[3];
  int wanted = 0;
  if (repeats(slot.plan[current])) wants[wanted++] = loopWant(current, true);
  bool linear = true;  // the path from here runs on without a jump
  for (int j = current + 1; j < count && wanted < 3; j++) {
    const bool jump = slot.plan[j].startFrame != slot.plan[j - 1].endFrame;
    if (jump) linear = false;
    if (repeats(slot.plan[j])) {
      wants[wanted++] = loopWant(j, linear);
    } else if (jump) {
      const int64_t target = firstFrame(slot.plan[j].startFrame);
      // A short jump ahead lands inside the ring's own window: no pad, the ring has it.
      if (target >= ringRead && target + slot.landingFrames < ringReach) continue;
      PadWant want;
      want.target = target;
      want.frames = slot.landingFrames;
      want.tag = j;
      want.kind = PadKind::Landing;
      wants[wanted++] = want;
    }
  }
  if (slot.sourceFrames > 0) {
    for (int w = 0; w < wanted; w++) wants[w].frames = std::max<int64_t>(0, std::min(wants[w].frames, slot.sourceFrames - wants[w].target));
  }

  auto matches = [](const StreamPad& pad, const PadWant& want) {
    return pad.tag.load(std::memory_order_relaxed) == want.tag &&
           pad.kind.load(std::memory_order_relaxed) == static_cast<int>(want.kind) &&
           pad.target.load(std::memory_order_relaxed) == want.target;
  };
  // What the plan no longer names: a pad still being filled for it is let go here, and a
  // Ready one is marked for the audio thread, which alone can tell whether it is reading it.
  for (StreamPad& pad : slot.pads) {
    const int state = pad.state.load(std::memory_order_acquire);
    if (state != static_cast<int>(PadState::Filling) && state != static_cast<int>(PadState::Ready)) continue;
    if (pad.pinned.load(std::memory_order_acquire)) continue;
    bool named = false;
    for (int w = 0; w < wanted && !named; w++) named = matches(pad, wants[w]) && wants[w].frames > 0;
    if (named) continue;
    if (state == static_cast<int>(PadState::Filling)) pad.state.store(static_cast<int>(PadState::Free), std::memory_order_release);
    else pad.unwanted.store(true, std::memory_order_release);
  }

  bool readerUsed = false;
  for (int w = 0; w < wanted; w++) {
    const PadWant& want = wants[w];
    if (want.frames <= 0) continue;
    int index = -1;
    for (int k = 0; k < kPadsPerStream && index < 0; k++) {
      const int state = slot.pads[k].state.load(std::memory_order_acquire);
      if ((state == static_cast<int>(PadState::Filling) || state == static_cast<int>(PadState::Ready)) &&
          matches(slot.pads[k], want)) {
        index = k;
      }
    }
    if (index < 0) {
      index = claimPad(slot, 1);
      if (index < 0) break;
      StreamPad& pad = slot.pads[index];
      pad.target.store(want.target, std::memory_order_relaxed);
      pad.tag.store(want.tag, std::memory_order_relaxed);
      pad.kind.store(static_cast<int>(want.kind), std::memory_order_relaxed);
      pad.wanted = want.frames;
      pad.capture = want.capturable;
    }
    StreamPad& pad = slot.pads[index];
    pad.unwanted.store(false, std::memory_order_relaxed);
    if (pad.state.load(std::memory_order_acquire) != static_cast<int>(PadState::Filling)) continue;
    // Captured pads all move every pass (a copy); the reader reads for one pad a pass.
    if (fillPadChunk(slot, pad, !readerUsed)) readerUsed = true;
  }
}

int StreamPool::prepareSeek(const std::string& cueId, double positionMs, int& slotIndex) {
  slotIndex = -1;
  std::unique_lock<std::mutex> lock(mutex_);
  StreamSlot* found = nullptr;
  for (int i = 0; i < kMaxStreams; i++) {
    StreamSlot& slot = slots_[i];
    if (!slot.inUse.load(std::memory_order_acquire) || slot.releaseDeferred || slot.cueId != cueId) continue;
    if (found == nullptr || slot.sequence > found->sequence) {
      found = &slot;
      slotIndex = i;
    }
  }
  if (found == nullptr) return -1;
  StreamSlot& slot = *found;
  // The pad lock is taken before the pool's is let go, so the slot cannot be released under
  // this (release takes both, in the same order); the decode pass is not held up meanwhile.
  std::unique_lock<std::mutex> pads(slot.padMutex);
  lock.unlock();
  if (slot.padFrames <= 0 || slot.sampleRate <= 0) return -1;

  double frame = positionMs * static_cast<double>(slot.sampleRate) / 1000.0;
  int tag = 0;
  if (slot.planSliced) {
    // Where the mixer will land it: the slice that holds the place, clamped into it.
    tag = sliceForPosition(slot.plan, slot.planCount, frame);
    frame = std::max(slot.plan[tag].startFrame, std::min(frame, slot.plan[tag].endFrame));
  } else {
    // Clamped into the region the voice may play now, as the mixer clamps it.
    const double start = static_cast<double>(slot.voiceSegmentStart.load(std::memory_order_acquire));
    const double end = static_cast<double>(slot.voiceSegmentEnd.load(std::memory_order_acquire));
    frame = std::max(start, std::min(frame, end));
  }
  int64_t target = std::max<int64_t>(0, firstFrame(frame));
  if (slot.sourceFrames > 0) target = std::min(target, slot.sourceFrames - 1);
  // A place the ring already holds, with room to land on, is served from the ring.
  const int64_t read = slot.ring.readFrame();
  const int64_t margin = slot.sampleRate / 10;
  if (!slot.ring.seekPending() && target >= read + margin && target + margin < slot.ring.writeFrame()) return -2;

  const int index = claimPad(slot, 0);
  if (index < 0 || !ensureReader(slot)) {
    if (index >= 0) slot.pads[index].state.store(static_cast<int>(PadState::Free), std::memory_order_release);
    return -1;
  }
  StreamPad& pad = slot.pads[index];
  pad.target.store(target, std::memory_order_relaxed);
  pad.tag.store(tag, std::memory_order_relaxed);
  pad.kind.store(static_cast<int>(PadKind::Landing), std::memory_order_relaxed);
  pad.pinned.store(true, std::memory_order_release);
  pad.wanted = slot.landingFrames;
  if (slot.sourceFrames > 0) pad.wanted = std::min(pad.wanted, slot.sourceFrames - target);
  pad.capture = false;
  while (pad.state.load(std::memory_order_acquire) == static_cast<int>(PadState::Filling)) {
    fillPadChunk(slot, pad, true);
  }
  if (pad.state.load(std::memory_order_acquire) != static_cast<int>(PadState::Ready)) {
    pad.pinned.store(false, std::memory_order_release);
    return -1;
  }
  return index;
}

void StreamPool::fillAll() {
  std::lock_guard<std::mutex> lock(mutex_);
  for (int i = 0; i < kMaxStreams; i++) {
    StreamSlot& slot = slots_[i];
    if (!slot.inUse.load(std::memory_order_acquire)) continue;
    if (slot.releaseDeferred) {
      releaseLocked(i, false);
      continue;
    }
    fillOne(slot);
    tendPads(slot);
  }
}

void StreamPool::closeAll() {
  std::lock_guard<std::mutex> lock(mutex_);
  for (int i = 0; i < kMaxStreams; i++) releaseLocked(i);
  residentBytes_.store(0, std::memory_order_relaxed);
}

int StreamPool::activeStreams() const {
  int count = 0;
  for (int i = 0; i < kMaxStreams; i++) {
    if (slots_[i].inUse.load(std::memory_order_acquire)) count++;
  }
  return count;
}

int64_t StreamPool::underruns() const {
  int64_t total = 0;
  for (int i = 0; i < kMaxStreams; i++) {
    total += static_cast<int64_t>(slots_[i].underruns.load(std::memory_order_relaxed));
  }
  return total;
}

}  // namespace ws
