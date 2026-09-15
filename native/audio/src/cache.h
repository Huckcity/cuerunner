// Decoded-audio cache. Small files are decoded once into interleaved float and kept
// for reuse; oversized files never enter it (they stream), so a long file can never
// evict the small files a show actually revisits. Entries are pinned by a lock-free
// reference count: the audio thread only ever decrements, the cache thread only ever
// frees at zero.
#pragma once

#include "source.h"
#include "wsaudio.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace ws {

/**
 * The envelope of a region of a resident entry: `points` buckets of interleaved min/max
 * covering [startFrame, endFrame) of the file, with `frames` the file's whole length
 * whatever the region. The region is resolved against the entry's own frame count.
 */
struct ResidentEnvelope {
  std::vector<float> values;
  int channels = 0;
  int sampleRate = 0;
  int64_t frames = -1;
  int64_t startFrame = 0;
  int64_t endFrame = 0;
};

struct CacheStats {
  int entries = 0;
  int64_t bytes = 0;
  int64_t limitBytes = 0;
  int maxFiles = 0;
  int64_t maxFileBytes = 0;
  uint64_t hits = 0;
  uint64_t misses = 0;
  uint64_t evictions = 0;
  uint64_t bypassed = 0;
  int pinnedEntries = 0;
  int64_t pinnedBytes = 0;
};

struct CacheEntry {
  std::string path;
  SourceInfo info{};
  std::vector<float> data;
  int64_t frames = 0;
  int channels = 0;
  int sampleRate = 0;
  int64_t decodedBytes = 0;
  std::atomic<int> refCount{0};
  uint64_t lastUse = 0;
  bool resident = false;
};

class DecodedCache {
 public:
  void configure(int64_t maxBytes, int maxFiles, int64_t maxFileBytes);

  // Decodes (or finds) the file and returns it pinned — the caller must call
  // `release()` when the voice using it has ended. On a cache miss that exceeds the
  // per-file limit, returns nullptr with `bypassed` set: that file must stream.
  CacheEntry* pin(const std::string& path, bool& cacheHit, bool& bypassed, std::string& error);

  void release(CacheEntry* entry);

  // Records a prepare that never entered the cache because the file is oversized.
  void noteBypass();

  // Whether a decoded copy is resident right now. Deliberately does not touch the LRU
  // order or any counter: probing a workspace must not change what the cache holds.
  bool isResident(const std::string& path) const;

  // Evicts unpinned least-recently-used entries back under the byte and count limits.
  void maintain();

  // Computes min/max buckets from a resident entry while holding the cache lock, so a
  // concurrent eviction cannot free the samples mid-scan. Returns false when the file
  // is not resident (the caller then streams the file).
  bool waveformFromResident(const std::string& path, int points, const RegionQuery& region, ResidentEnvelope& out);

  CacheStats stats() const;

 private:
  CacheEntry* findLocked(const std::string& path);
  void evictLocked();

  mutable std::mutex mutex_;
  std::vector<std::unique_ptr<CacheEntry>> entries_;
  std::unordered_map<std::string, CacheEntry*> byPath_;
  uint64_t useClock_ = 0;
  int64_t maxBytes_ = 0;
  int maxFiles_ = 0;
  int64_t maxFileBytes_ = 0;
  uint64_t hits_ = 0;
  uint64_t misses_ = 0;
  uint64_t evictions_ = 0;
  uint64_t bypassed_ = 0;
};

}  // namespace ws
