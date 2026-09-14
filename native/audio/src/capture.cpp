#include "capture.h"

#include "util.h"

#include <algorithm>
#include <chrono>
#include <cstring>

namespace ws {

CaptureWriter::~CaptureWriter() { stop(); }

bool CaptureWriter::start(const std::string& path, int sampleRate, int channels, std::string& error) {
  if (running_.load()) return true;
  if (!writer_.open(path, sampleRate, channels, error)) return false;
  ring_.assign(kRingBytes, 0);
  head_.store(0);
  tail_.store(0);
  dropped_.store(0);
  stopping_ = false;
  running_.store(true, std::memory_order_release);
  thread_ = std::thread([this] { threadMain(); });
  return true;
}

size_t CaptureWriter::space() const {
  const uint64_t head = head_.load(std::memory_order_relaxed);
  const uint64_t tail = tail_.load(std::memory_order_acquire);
  const uint64_t used = head - tail;
  return used >= kRingBytes ? 0 : static_cast<size_t>(kRingBytes - used);
}

size_t CaptureWriter::available() const {
  const uint64_t head = head_.load(std::memory_order_acquire);
  const uint64_t tail = tail_.load(std::memory_order_relaxed);
  const uint64_t used = head - tail;
  return used > kRingBytes ? kRingBytes : static_cast<size_t>(used);
}

void CaptureWriter::write(const float* frames, int64_t frameCount) {
  if (!running_.load(std::memory_order_acquire) || frames == nullptr || frameCount <= 0) return;
  const size_t bytes = static_cast<size_t>(frameCount) * static_cast<size_t>(writer_.channels()) * sizeof(float);
  if (bytes > space()) {
    dropped_.fetch_add(bytes, std::memory_order_relaxed);
    return;
  }
  const uint64_t head = head_.load(std::memory_order_relaxed);
  const size_t offset = static_cast<size_t>(head) % kRingBytes;
  const size_t first = std::min(bytes, kRingBytes - offset);
  std::memcpy(ring_.data() + offset, frames, first);
  if (first < bytes) std::memcpy(ring_.data(), reinterpret_cast<const unsigned char*>(frames) + first, bytes - first);
  head_.store(head + bytes, std::memory_order_release);
  cv_.notify_one();
}

void CaptureWriter::threadMain() {
  std::vector<unsigned char> scratch(256 * 1024);
  int64_t sinceFlush = 0;
  for (;;) {
    if (!running_.load(std::memory_order_acquire) && available() == 0) break;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      cv_.wait_for(lock, std::chrono::milliseconds(5),
                   [this] { return !running_.load() || available() > 0; });
    }
    const size_t bytes = available();
    if (bytes == 0) continue;

    const uint64_t tail = tail_.load(std::memory_order_relaxed);
    const size_t offset = static_cast<size_t>(tail) % kRingBytes;
    const size_t count = std::min(bytes, scratch.size());
    const size_t first = std::min(count, kRingBytes - offset);
    std::memcpy(scratch.data(), ring_.data() + offset, first);
    if (first < count) std::memcpy(scratch.data() + first, ring_.data(), count - first);
    tail_.store(tail + count, std::memory_order_release);

    const size_t frameBytes = sizeof(float) * static_cast<size_t>(writer_.channels());
    writer_.writeFrames(reinterpret_cast<const float*>(scratch.data()), static_cast<int64_t>(count / frameBytes));
    sinceFlush += static_cast<int64_t>(count);
    if (sinceFlush > (1 << 20)) {
      writer_.patchHeader();
      sinceFlush = 0;
    }
  }
  writer_.finalize();
}

void CaptureWriter::stop() {
  if (!running_.load()) {
    if (thread_.joinable()) thread_.join();
    return;
  }
  running_.store(false, std::memory_order_release);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    stopping_ = true;
  }
  cv_.notify_all();
  if (thread_.joinable()) thread_.join();
}

}  // namespace ws
