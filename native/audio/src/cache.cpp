#include "cache.h"

#include "util.h"

#include <algorithm>
#include <vector>

namespace ws {

void DecodedCache::configure(int64_t maxBytes, int maxFiles, int64_t maxFileBytes) {
  std::lock_guard<std::mutex> lock(mutex_);
  maxBytes_ = maxBytes;
  maxFiles_ = maxFiles;
  maxFileBytes_ = maxFileBytes;
}

CacheEntry* DecodedCache::findLocked(const std::string& path) {
  const auto it = byPath_.find(path);
  if (it == byPath_.end()) return nullptr;
  return it->second;
}

CacheEntry* DecodedCache::pin(const std::string& path, bool& cacheHit, bool& bypassed, std::string& error) {
  cacheHit = false;
  bypassed = false;

  std::lock_guard<std::mutex> lock(mutex_);
  if (CacheEntry* existing = findLocked(path)) {
    if (existing->resident) {
      existing->lastUse = ++useClock_;
      existing->refCount.fetch_add(1, std::memory_order_acq_rel);
      hits_++;
      cacheHit = true;
      return existing;
    }
  }

  std::vector<float> decoded;
  SourceInfo info;
  if (!decodeWholeFile(path, decoded, info, error)) return nullptr;
  misses_++;

  const int64_t frames = info.channels > 0
                             ? static_cast<int64_t>(decoded.size() / static_cast<size_t>(info.channels))
                             : 0;
  const int64_t bytes = static_cast<int64_t>(decoded.size() * sizeof(float));
  if (frames <= 0 || bytes <= 0) {
    error = "media file decoded to nothing";
    return nullptr;
  }
  if (bytes > maxFileBytes_ || maxFileBytes_ <= 0) {
    // Too big to keep: this file streams. It is never inserted, so it cannot evict
    // anything the show already has warm.
    bypassed = true;
    bypassed_++;
    return nullptr;
  }

  CacheEntry* entry = findLocked(path);
  if (entry == nullptr) {
    auto created = std::make_unique<CacheEntry>();
    created->path = path;
    entry = created.get();
    entries_.push_back(std::move(created));
  }

  // Make room before adopting the new buffer, never evicting anything pinned.
  auto residentUsage = [this](int64_t& residentBytes, int& residentCount) {
    residentBytes = 0;
    residentCount = 0;
    for (const auto& candidate : entries_) {
      if (!candidate->resident) continue;
      residentBytes += candidate->decodedBytes;
      residentCount++;
    }
  };
  int64_t residentBytes = 0;
  int residentCount = 0;
  residentUsage(residentBytes, residentCount);
  while (residentBytes + bytes > maxBytes_ || residentCount + 1 > maxFiles_) {
    const int64_t before = residentBytes;
    evictLocked();
    residentUsage(residentBytes, residentCount);
    if (before == residentBytes) break;  // nothing left that can be evicted
  }

  entry->info = info;
  entry->frames = frames;
  entry->channels = info.channels;
  entry->sampleRate = info.sampleRate;
  entry->data = std::move(decoded);
  entry->decodedBytes = bytes;
  entry->resident = true;
  entry->lastUse = ++useClock_;
  entry->refCount.store(1, std::memory_order_release);
  byPath_[path] = entry;
  return entry;
}

void DecodedCache::noteBypass() {
  std::lock_guard<std::mutex> lock(mutex_);
  bypassed_++;
}

bool DecodedCache::isResident(const std::string& path) const {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = byPath_.find(path);
  return it != byPath_.end() && it->second->resident;
}

void DecodedCache::release(CacheEntry* entry) {
  if (entry == nullptr) return;
  entry->refCount.fetch_sub(1, std::memory_order_acq_rel);
}

void DecodedCache::evictLocked() {
  CacheEntry* victim = nullptr;
  for (const auto& candidate : entries_) {
    if (!candidate->resident) continue;
    if (candidate->refCount.load(std::memory_order_acquire) > 0) continue;
    if (victim == nullptr || candidate->lastUse < victim->lastUse) victim = candidate.get();
  }
  if (victim == nullptr) return;
  victim->data.clear();
  victim->data.shrink_to_fit();
  victim->decodedBytes = 0;
  victim->frames = 0;
  victim->resident = false;
  byPath_.erase(victim->path);
  evictions_++;
}

void DecodedCache::maintain() {
  std::lock_guard<std::mutex> lock(mutex_);
  int64_t residentBytes = 0;
  int residentCount = 0;
  for (const auto& candidate : entries_) {
    if (!candidate->resident) continue;
    residentBytes += candidate->decodedBytes;
    residentCount++;
  }
  while (residentCount > maxFiles_ || residentBytes > maxBytes_) {
    const int64_t before = residentBytes;
    evictLocked();
    residentBytes = 0;
    residentCount = 0;
    for (const auto& candidate : entries_) {
      if (!candidate->resident) continue;
      residentBytes += candidate->decodedBytes;
      residentCount++;
    }
    if (before == residentBytes) break;
  }
}

bool DecodedCache::waveformFromResident(const std::string& path, int points, std::vector<float>& values,
                                        int& channels, int& sampleRate, int64_t& frames) {
  std::lock_guard<std::mutex> lock(mutex_);
  CacheEntry* entry = findLocked(path);
  if (entry == nullptr || !entry->resident) return false;
  entry->lastUse = ++useClock_;
  channels = entry->channels;
  sampleRate = entry->sampleRate;
  frames = entry->frames;
  values.assign(static_cast<size_t>(points) * 2, 0.0f);
  for (int i = 0; i < points; i++) {
    values[static_cast<size_t>(i) * 2] = 1.0e30f;
    values[static_cast<size_t>(i) * 2 + 1] = -1.0e30f;
  }
  const int fold = std::min(channels, 2);
  for (int64_t frame = 0; frame < frames; frame++) {
    const int64_t index = std::min<int64_t>(points - 1, frame * points / frames);
    for (int c = 0; c < fold; c++) {
      const float value = entry->data[static_cast<size_t>(frame) * static_cast<size_t>(channels) + static_cast<size_t>(c)];
      const size_t bucket = static_cast<size_t>(index) * 2;
      if (value < values[bucket]) values[bucket] = value;
      if (value > values[bucket + 1]) values[bucket + 1] = value;
    }
  }
  for (int i = 0; i < points; i++) {
    // A bucket no sample landed in stays a flat line rather than a sentinel.
    if (values[static_cast<size_t>(i) * 2] > values[static_cast<size_t>(i) * 2 + 1]) {
      values[static_cast<size_t>(i) * 2] = 0.0f;
      values[static_cast<size_t>(i) * 2 + 1] = 0.0f;
    }
  }
  return true;
}

CacheStats DecodedCache::stats() const {
  std::lock_guard<std::mutex> lock(mutex_);
  CacheStats out;
  out.limitBytes = maxBytes_;
  out.maxFiles = maxFiles_;
  out.maxFileBytes = maxFileBytes_;
  out.hits = hits_;
  out.misses = misses_;
  out.evictions = evictions_;
  out.bypassed = bypassed_;
  for (const auto& candidate : entries_) {
    if (!candidate->resident) continue;
    out.entries++;
    out.bytes += candidate->decodedBytes;
    if (candidate->refCount.load(std::memory_order_acquire) > 0) {
      out.pinnedEntries++;
      out.pinnedBytes += candidate->decodedBytes;
    }
  }
  return out;
}

}  // namespace ws
