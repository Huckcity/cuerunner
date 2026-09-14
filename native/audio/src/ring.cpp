#include "ring.h"

#include <algorithm>

namespace ws {

void StreamRing::configure(float* storage, int64_t capacityFrames, int channels, double sampleRate) {
  storage_ = storage;
  capacityFrames_ = capacityFrames > 0 ? capacityFrames : 1;
  channels_ = channels > 0 ? channels : 1;
  sampleRate_ = sampleRate;
  writeFrame_.store(0, std::memory_order_relaxed);
  readFrame_.store(0, std::memory_order_relaxed);
  seekTarget_.store(-1, std::memory_order_relaxed);
}

int64_t StreamRing::freeFrames() const {
  const int64_t write = writeFrame_.load(std::memory_order_acquire);
  const int64_t read = readFrame_.load(std::memory_order_acquire);
  const int64_t used = write - read;
  const int64_t free = capacityFrames_ - used;
  return free > 0 ? free : 0;
}

int64_t StreamRing::availableFrames() const {
  const int64_t write = writeFrame_.load(std::memory_order_acquire);
  const int64_t read = readFrame_.load(std::memory_order_acquire);
  const int64_t used = write - read;
  if (used <= 0) return 0;
  return used < capacityFrames_ ? used : capacityFrames_;
}

}  // namespace ws
