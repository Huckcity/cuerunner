#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

namespace ws {

/**
 * One writer publishes a record; any number of readers copy it out without waiting on the
 * writer and without ever seeing a torn one.
 *
 * The classic seqlock keeps its payload in plain memory and lets a reader race the writer,
 * relying on the retry to discard what it read. That is a data race by the standard — the
 * compiler may break the idiom — so here the payload is atomic words, each stored and loaded
 * relaxed, and the sequence counter carries the ordering (Boehm, "Can seqlocks get along with
 * programming language memory models?"). On the machines this ships to a relaxed word store
 * is the plain store it always was, so the audio thread pays nothing for the guarantee.
 *
 * One writer at a time is the caller's contract; the audio thread is that writer, and the
 * device-loss drain writes only while it holds the device.
 */
template <typename T>
class SnapshotCell {
  static_assert(std::is_trivially_copyable<T>::value, "the payload is copied as words");

 public:
  /** Writer side. Never blocks, never allocates. */
  void publish(const T& value) noexcept {
    const uint32_t odd = seq_.load(std::memory_order_relaxed) + 1;
    seq_.store(odd, std::memory_order_relaxed);
    // The odd counter must be visible before any word of the new record is.
    std::atomic_thread_fence(std::memory_order_release);
    for (size_t i = 0; i < kWords; i++) {
      uint64_t word = 0;
      std::memcpy(&word, reinterpret_cast<const unsigned char*>(&value) + i * 8, chunkBytes(i));
      words_[i].store(word, std::memory_order_relaxed);
    }
    seq_.store(odd + 1, std::memory_order_release);
  }

  /** Reader side: the newest whole record. Retries while the writer is inside a publish. */
  void read(T& out) const noexcept {
    uint64_t copy[kWords];
    for (;;) {
      const uint32_t first = seq_.load(std::memory_order_acquire);
      if ((first & 1u) != 0u) continue;
      for (size_t i = 0; i < kWords; i++) copy[i] = words_[i].load(std::memory_order_relaxed);
      std::atomic_thread_fence(std::memory_order_acquire);
      if (seq_.load(std::memory_order_relaxed) == first) break;
    }
    std::memcpy(&out, copy, sizeof(T));
  }

  /** One member of the record, for a caller that wants the clock and not the whole thing. */
  template <typename M>
  M readMember(size_t offset) const noexcept {
    static_assert(std::is_trivially_copyable<M>::value && sizeof(M) <= 8, "one word or less");
    for (;;) {
      const uint32_t first = seq_.load(std::memory_order_acquire);
      if ((first & 1u) != 0u) continue;
      // A member never straddles two words: the record's own alignment sees to it.
      const uint64_t word = words_[offset / 8].load(std::memory_order_relaxed);
      std::atomic_thread_fence(std::memory_order_acquire);
      if (seq_.load(std::memory_order_relaxed) != first) continue;
      M value;
      std::memcpy(&value, reinterpret_cast<const unsigned char*>(&word) + offset % 8, sizeof(M));
      return value;
    }
  }

 private:
  static constexpr size_t kWords = (sizeof(T) + 7) / 8;
  static constexpr size_t chunkBytes(size_t i) { return i + 1 < kWords || sizeof(T) % 8 == 0 ? 8 : sizeof(T) % 8; }

  std::atomic<uint32_t> seq_{0};
  std::atomic<uint64_t> words_[kWords] = {};
};

}  // namespace ws
