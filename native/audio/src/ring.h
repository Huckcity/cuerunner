// Lock-free handoff primitives. The audio thread is a producer for events and a
// consumer for commands and streamed audio; it never waits on a lock.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>

namespace ws {

template <typename T, size_t Capacity>
class SpscQueue {
 public:
  static_assert(Capacity >= 2, "capacity too small");
  static_assert((Capacity & (Capacity - 1)) == 0, "capacity must be a power of two");

  bool push(const T& value) {
    const uint64_t head = head_.load(std::memory_order_relaxed);
    const uint64_t tail = tail_.load(std::memory_order_acquire);
    if (head - tail >= Capacity) return false;
    buffer_[head & (Capacity - 1)] = value;
    head_.store(head + 1, std::memory_order_release);
    return true;
  }

  bool pop(T& out) {
    const uint64_t tail = tail_.load(std::memory_order_relaxed);
    const uint64_t head = head_.load(std::memory_order_acquire);
    if (tail == head) return false;
    out = buffer_[tail & (Capacity - 1)];
    tail_.store(tail + 1, std::memory_order_release);
    return true;
  }

  bool empty() const {
    return tail_.load(std::memory_order_acquire) == head_.load(std::memory_order_acquire);
  }

  size_t size() const {
    const uint64_t head = head_.load(std::memory_order_acquire);
    const uint64_t tail = tail_.load(std::memory_order_acquire);
    return static_cast<size_t>(head - tail);
  }

  static constexpr size_t capacity() { return Capacity; }

 private:
  std::atomic<uint64_t> head_{0};
  std::atomic<uint64_t> tail_{0};
  T buffer_[Capacity] = {};
};

// Bounded interleaved-float ring for one streaming voice, addressed in absolute
// source frames so a seek is a counter reset rather than a buffer copy. The producer
// (decode thread) only writes frames the consumer has released; the consumer (audio
// thread) only reads frames the producer has published.
class StreamRing {
 public:
  void configure(float* storage, int64_t capacityFrames, int channels, double sampleRate);

  // Producer side.
  int64_t writeFrame() const { return writeFrame_.load(std::memory_order_acquire); }
  int64_t readFrame() const { return readFrame_.load(std::memory_order_acquire); }
  int64_t freeFrames() const;
  float* writePtr(int64_t frame) {
    return storage_ + (frame % capacityFrames_) * channels_;
  }
  void publish(int64_t throughFrame) { writeFrame_.store(throughFrame, std::memory_order_release); }

  // Consumer side.
  int64_t availableFrames() const;
  const float* readPtr(int64_t frame) const {
    return storage_ + (frame % capacityFrames_) * channels_;
  }
  void release(int64_t throughFrame) { readFrame_.store(throughFrame, std::memory_order_release); }

  // Seek handshake: the consumer asks for a frame, the producer flushes, repositions
  // the decoder and bumps the generation. Until then the consumer renders silence.
  void requestSeek(int64_t frame) { seekTarget_.store(frame, std::memory_order_release); }
  bool seekPending() const { return seekTarget_.load(std::memory_order_acquire) >= 0; }
  int64_t takeSeekTarget() { return seekTarget_.exchange(-1, std::memory_order_acq_rel); }
  void resetForSeek(int64_t frame) {
    readFrame_.store(frame, std::memory_order_release);
    writeFrame_.store(frame, std::memory_order_release);
    generation_.fetch_add(1, std::memory_order_acq_rel);
  }
  uint64_t generation() const { return generation_.load(std::memory_order_acquire); }

  int64_t capacityFrames() const { return capacityFrames_; }
  int channels() const { return channels_; }
  double sampleRate() const { return sampleRate_; }

 private:
  float* storage_ = nullptr;
  int64_t capacityFrames_ = 0;
  int channels_ = 0;
  double sampleRate_ = 0.0;
  std::atomic<int64_t> writeFrame_{0};
  std::atomic<int64_t> readFrame_{0};
  std::atomic<int64_t> seekTarget_{-1};
  std::atomic<uint64_t> generation_{0};
};

}  // namespace ws
