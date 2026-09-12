// Live capture tee. The audio thread pushes mixed frames into a bounded lock-free byte
// ring and returns immediately; a writer thread drains it to a float WAV. Used by the
// dev/test capture mode — never on by default.
#pragma once

#include "wavwrite.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace ws {

class CaptureWriter {
 public:
  ~CaptureWriter();

  bool start(const std::string& path, int sampleRate, int channels, std::string& error);
  // Called from the audio thread: bounded, non-blocking, drops (and counts) on overflow.
  void write(const float* frames, int64_t frameCount);
  void stop();
  bool active() const { return running_.load(std::memory_order_acquire); }
  uint64_t droppedBytes() const { return dropped_.load(std::memory_order_relaxed); }

 private:
  void threadMain();
  size_t space() const;
  size_t available() const;

  static constexpr size_t kRingBytes = 8 * 1024 * 1024;

  WavWriter writer_;
  std::vector<unsigned char> ring_;
  std::atomic<uint64_t> head_{0};
  std::atomic<uint64_t> tail_{0};
  std::atomic<uint64_t> dropped_{0};
  std::atomic<bool> running_{false};
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable cv_;
  bool stopping_ = false;
};

}  // namespace ws
