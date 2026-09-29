// The cell the engine publishes its state through: one writer, several readers, and a
// record that must never arrive half one publish and half the next.
//
// Every record written here is a single number repeated through the whole payload, so a
// torn read has no way to look right: two words that disagree are the failure. Run under
// ThreadSanitizer (snapshot-cell.mjs does when the compiler has it) it is also the check
// that the cell has no data race at all, which a plain seqlock has by construction.

#include "snapshot_cell.h"

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <thread>
#include <vector>

namespace {

struct Wide {
  double clockMs = 0.0;
  uint64_t words[40] = {};
  uint32_t tail = 0;
};

// A size that is not a multiple of eight, so the last word is a partial one.
struct Odd {
  unsigned char bytes[13] = {};
};

std::atomic<int> failures{0};

void fail(const char* what) {
  if (failures.fetch_add(1) < 5) std::fprintf(stderr, "  FAIL %s\n", what);
}

constexpr int kPublishes = 200000;

template <typename T, typename Fill, typename Check>
void hammer(Fill fill, Check check) {
  ws::SnapshotCell<T> cell;
  std::atomic<bool> done{false};
  std::vector<std::thread> readers;
  std::atomic<int> reads{0};
  for (int r = 0; r < 3; r++) {
    readers.emplace_back([&] {
      T seen;
      while (!done.load(std::memory_order_acquire)) {
        cell.read(seen);
        if (!check(seen)) fail("a record was torn");
        reads.fetch_add(1, std::memory_order_relaxed);
      }
    });
  }
  std::thread writer([&] {
    T value;
    for (int i = 1; i <= kPublishes; i++) {
      fill(value, static_cast<uint32_t>(i));
      cell.publish(value);
    }
    done.store(true, std::memory_order_release);
  });
  writer.join();
  for (std::thread& reader : readers) reader.join();
  if (reads.load() == 0) fail("no reader ever read");
}

}  // namespace

int main() {
  // Nothing published yet reads back as the default record, not garbage.
  {
    ws::SnapshotCell<Wide> empty;
    Wide out;
    out.tail = 99;
    empty.read(out);
    if (out.tail != 0 || out.words[39] != 0) fail("an unpublished cell is not the default record");
  }

  hammer<Wide>(
      [](Wide& v, uint32_t n) {
        v.clockMs = static_cast<double>(n);
        for (uint64_t& word : v.words) word = n;
        v.tail = n;
      },
      [](const Wide& v) {
        for (uint64_t word : v.words) {
          if (word != static_cast<uint64_t>(v.clockMs)) return false;
        }
        return v.tail == static_cast<uint32_t>(v.clockMs);
      });

  hammer<Odd>(
      [](Odd& v, uint32_t n) {
        for (unsigned char& b : v.bytes) b = static_cast<unsigned char>(n);
      },
      [](const Odd& v) {
        for (unsigned char b : v.bytes) {
          if (b != v.bytes[0]) return false;
        }
        return true;
      });

  // One member, read without the rest: the clock read behind every timer in the window.
  {
    ws::SnapshotCell<Wide> cell;
    std::atomic<bool> done{false};
    std::thread reader([&] {
      double last = 0.0;
      while (!done.load(std::memory_order_acquire)) {
        const double now = cell.readMember<double>(offsetof(Wide, clockMs));
        if (now < last) fail("the clock went backwards");
        last = now;
      }
    });
    Wide value;
    for (int i = 1; i <= kPublishes; i++) {
      value.clockMs = static_cast<double>(i);
      cell.publish(value);
    }
    done.store(true, std::memory_order_release);
    reader.join();
    if (cell.readMember<double>(offsetof(Wide, clockMs)) != static_cast<double>(kPublishes))
      fail("the last publish is not the one a member read returns");
    const uint32_t tail = cell.readMember<uint32_t>(offsetof(Wide, tail));
    (void)tail;
  }

  if (failures.load() != 0) {
    std::fprintf(stderr, "snapshot-cell: %d failure(s)\n", failures.load());
    return 1;
  }
  std::printf("snapshot-cell: ok (%d publishes, 3 readers, whole records only)\n", kPublishes);
  return 0;
}
