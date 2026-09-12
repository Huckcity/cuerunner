#include "stream.h"

#include "util.h"

#include <algorithm>
#include <vector>

namespace ws {

namespace {
// A slot's ring is capped by the caller's byte budget; this is the fallback when none
// is configured (16 MiB of interleaved float).
constexpr int64_t kFallbackVoiceBytes = 16 * 1024 * 1024;
}  // namespace

StreamPool::StreamPool() {
  scratch_.resize(static_cast<size_t>(kMaxChunkFrames) * static_cast<size_t>(kMaxOutputChannels));
}

StreamPool::~StreamPool() { closeAll(); }

int StreamPool::acquire(const std::string& path, int64_t prerollMs, int64_t maxBytesPerVoice, std::string& error,
                        SourceInfo& info) {
  int index = -1;
  for (int i = 0; i < kMaxStreams; i++) {
    bool expected = false;
    if (slots_[i].inUse.compare_exchange_strong(expected, true, std::memory_order_acq_rel)) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    error = "no free streaming slot (limit is " + std::to_string(kMaxStreams) + ")";
    return -1;
  }

  StreamSlot& slot = slots_[index];
  std::unique_ptr<Source> source = openSource(path, error);
  if (!source) {
    slot.inUse.store(false, std::memory_order_release);
    return -1;
  }
  info = source->info();

  const int channels = info.channels > 0 ? info.channels : 2;
  const int sampleRate = info.sampleRate > 0 ? info.sampleRate : 48000;
  int64_t capacityFrames = sampleRate * prerollMs / 1000;
  if (capacityFrames < 4096) capacityFrames = 4096;
  const int64_t bytesPerFrame = static_cast<int64_t>(channels) * static_cast<int64_t>(sizeof(float));
  const int64_t byteCap = maxBytesPerVoice > 0 ? maxBytesPerVoice : kFallbackVoiceBytes;
  if (capacityFrames * bytesPerFrame > byteCap) capacityFrames = byteCap / bytesPerFrame;
  if (capacityFrames < 4096) capacityFrames = 4096;

  const size_t bytes = static_cast<size_t>(capacityFrames) * static_cast<size_t>(bytesPerFrame);
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
  residentBytes_.fetch_add(static_cast<int64_t>(bytes), std::memory_order_relaxed);
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
