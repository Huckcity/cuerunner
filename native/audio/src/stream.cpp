#include "stream.h"

#include "util.h"

#include <algorithm>
#include <vector>

namespace ws {

StreamPool::StreamPool() {
  scratch_.resize(static_cast<size_t>(kMaxChunkFrames) * static_cast<size_t>(kMaxOutputChannels));
}

StreamPool::~StreamPool() { closeAll(); }

int StreamPool::acquire(const std::string& path, int64_t prerollMs, int64_t maxBytesPerVoice, int64_t maxTotalBytes,
                        StreamRefusal& refusal, std::string& error, SourceInfo& info) {
  refusal = StreamRefusal::None;
  int index = -1;
  for (int i = 0; i < kMaxStreams; i++) {
    bool expected = false;
    if (slots_[i].inUse.compare_exchange_strong(expected, true, std::memory_order_acq_rel)) {
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
  std::unique_ptr<Source> source = openSource(path, error);
  if (!source) {
    refusal = StreamRefusal::Decode;
    slot.inUse.store(false, std::memory_order_release);
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

  // The declared total streaming budget, read as the pool's own accounting: the ring is
  // reserved against the resident total before it is allocated, so a refusal here is
  // exactly the figure `info()` reports — and two acquires racing cannot both be let
  // past a budget with room for one.
  const size_t bytes = static_cast<size_t>(capacityFrames) * static_cast<size_t>(bytesPerFrame);
  const int64_t reserved = static_cast<int64_t>(bytes);
  if (maxTotalBytes > 0) {
    int64_t resident = residentBytes_.load(std::memory_order_relaxed);
    for (;;) {
      if (resident + reserved > maxTotalBytes) {
        refusal = StreamRefusal::Limit;
        error = "the streaming budget is full (streamMaxTotalBytes " + std::to_string(maxTotalBytes) +
                "): a further " + std::to_string(bytes) + " bytes would exceed it";
        slot.inUse.store(false, std::memory_order_release);
        return -1;
      }
      if (residentBytes_.compare_exchange_weak(resident, resident + reserved, std::memory_order_acq_rel)) break;
    }
  } else {
    residentBytes_.fetch_add(reserved, std::memory_order_relaxed);
  }

  slot.pcm.resize(bytes / sizeof(float));
  slot.source = std::move(source);
  slot.path = path;
  slot.channels = channels;
  slot.sampleRate = sampleRate;
  slot.capacityFrames = capacityFrames;
  slot.prerollFrames = capacityFrames;  // the ring is the pre-roll budget
  slot.eof.store(false, std::memory_order_relaxed);
  slot.underruns.store(0, std::memory_order_relaxed);
  slot.ring.configure(slot.pcm.data(), capacityFrames, channels, static_cast<double>(sampleRate));
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

void StreamPool::release(int index) {
  if (index < 0 || index >= kMaxStreams) return;
  StreamSlot& slot = slots_[index];
  if (!slot.inUse.load(std::memory_order_acquire)) return;
  slot.inUse.store(false, std::memory_order_release);
  const int64_t bytes = static_cast<int64_t>(slot.pcm.size() * sizeof(float));
  residentBytes_.fetch_sub(bytes, std::memory_order_relaxed);
  slot.source.reset();
  slot.pcm.clear();
  slot.pcm.shrink_to_fit();
  slot.capacityFrames = 0;
  slot.prerollFrames = 0;
  slot.path.clear();
}

int64_t StreamPool::releaseByPath(const std::string& path) {
  int64_t released = 0;
  for (int i = 0; i < kMaxStreams; i++) {
    if (slots_[i].inUse.load(std::memory_order_acquire) && slots_[i].path == path) {
      release(i);
      released++;
    }
  }
  return released;
}

bool StreamPool::fillOne(StreamSlot& slot) {
  if (slot.ring.seekPending()) {
    const int64_t target = slot.ring.takeSeekTarget();
    const bool ok = slot.source != nullptr && slot.source->seekToFrame(target);
    slot.ring.resetForSeek(target);
    slot.eof.store(!ok, std::memory_order_relaxed);
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
    const int64_t got = slot.source != nullptr ? slot.source->readFrames(dest, want) : 0;
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

void StreamPool::fillAll() {
  for (int i = 0; i < kMaxStreams; i++) {
    StreamSlot& slot = slots_[i];
    if (!slot.inUse.load(std::memory_order_acquire)) continue;
    fillOne(slot);
  }
}

void StreamPool::closeAll() {
  for (int i = 0; i < kMaxStreams; i++) release(i);
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
