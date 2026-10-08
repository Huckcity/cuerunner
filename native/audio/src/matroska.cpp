#include "matroska.h"

#include "m4a_platform.h"
#include "util.h"

#include <cstdio>
#include <cstring>
#include <vector>

// The element ids and the variable-length integers below are EBML's (RFC 8794) and
// Matroska's (RFC 9559). Only the handful of elements that say whether there is sound, and
// what it is, are read; everything else is stepped over by its size.

namespace ws {
namespace {

constexpr uint32_t kEbml = 0x1A45DFA3;
constexpr uint32_t kDocType = 0x4282;
constexpr uint32_t kSegment = 0x18538067;
constexpr uint32_t kInfo = 0x1549A966;
constexpr uint32_t kTimestampScale = 0x2AD7B1;
constexpr uint32_t kDuration = 0x4489;
constexpr uint32_t kTracks = 0x1654AE6B;
constexpr uint32_t kTrackEntry = 0xAE;
constexpr uint32_t kTrackType = 0x83;
constexpr uint32_t kCodecId = 0x86;
constexpr uint32_t kAudio = 0xE1;
constexpr uint32_t kSamplingFrequency = 0xB5;
constexpr uint32_t kChannels = 0x9F;
constexpr uint32_t kCluster = 0x1F43B675;

constexpr int64_t kAudioTrackType = 2;
// The headers sit at the front of every file a muxer writes for playback; past this much
// without finding them, the file is not one this reads.
constexpr int64_t kScanLimitBytes = 64LL * 1024 * 1024;
constexpr int kMaxElements = 8192;
// A string or a number element larger than this is not one of the few read here.
constexpr int64_t kMaxValueBytes = 256;

struct Reader {
  std::FILE* file = nullptr;
  int64_t length = 0;

  bool readAt(int64_t offset, void* out, size_t bytes) const {
    if (offset < 0 || offset + static_cast<int64_t>(bytes) > length) return false;
    if (std::fseek(file, static_cast<long>(offset), SEEK_SET) != 0) return false;
    return std::fread(out, 1, bytes, file) == bytes;
  }
};

struct Element {
  uint32_t id = 0;
  int64_t payload = 0;  // first byte of the data
  int64_t end = 0;      // first byte after the data (the parent's end for an unknown size)
};

// One EBML variable-length integer at `pos`: its width from the first byte's leading zeros.
// `keepMarker` keeps the width marker in the value, which is how element ids are written.
bool readVint(const Reader& reader, int64_t pos, bool keepMarker, uint64_t& value, int& width, bool& unknown) {
  unsigned char first = 0;
  if (!reader.readAt(pos, &first, 1) || first == 0) return false;
  width = 1;
  while ((first & (0x80 >> (width - 1))) == 0) width++;
  if (width > 8 || (keepMarker && width > 4)) return false;
  unsigned char bytes[8] = {};
  if (!reader.readAt(pos, bytes, static_cast<size_t>(width))) return false;
  uint64_t v = keepMarker ? bytes[0] : (bytes[0] & (0xFF >> width));
  bool allOnes = (bytes[0] & (0xFF >> width)) == (0xFF >> width);
  for (int i = 1; i < width; i++) {
    v = (v << 8) | bytes[i];
    if (bytes[i] != 0xFF) allOnes = false;
  }
  value = v;
  unknown = !keepMarker && allOnes;
  return true;
}

bool readElement(const Reader& reader, int64_t pos, int64_t parentEnd, Element& out) {
  uint64_t id = 0;
  uint64_t size = 0;
  int idWidth = 0;
  int sizeWidth = 0;
  bool unknownId = false;
  bool unknownSize = false;
  if (!readVint(reader, pos, true, id, idWidth, unknownId)) return false;
  if (!readVint(reader, pos + idWidth, false, size, sizeWidth, unknownSize)) return false;
  out.id = static_cast<uint32_t>(id);
  out.payload = pos + idWidth + sizeWidth;
  if (unknownSize) {
    out.end = parentEnd;
  } else {
    if (size > static_cast<uint64_t>(parentEnd - out.payload)) return false;
    out.end = out.payload + static_cast<int64_t>(size);
  }
  return out.payload <= parentEnd;
}

bool readUnsigned(const Reader& reader, const Element& element, uint64_t& value) {
  const int64_t bytes = element.end - element.payload;
  if (bytes < 0 || bytes > 8) return false;
  unsigned char data[8] = {};
  if (bytes > 0 && !reader.readAt(element.payload, data, static_cast<size_t>(bytes))) return false;
  value = 0;
  for (int64_t i = 0; i < bytes; i++) value = (value << 8) | data[i];
  return true;
}

bool readFloat(const Reader& reader, const Element& element, double& value) {
  const int64_t bytes = element.end - element.payload;
  unsigned char data[8] = {};
  if (bytes == 0) {
    value = 0.0;
    return true;
  }
  if ((bytes != 4 && bytes != 8) || !reader.readAt(element.payload, data, static_cast<size_t>(bytes))) return false;
  if (bytes == 4) {
    uint32_t bits = 0;
    for (int i = 0; i < 4; i++) bits = (bits << 8) | data[i];
    float f = 0.0f;
    std::memcpy(&f, &bits, 4);
    value = static_cast<double>(f);
  } else {
    uint64_t bits = 0;
    for (int i = 0; i < 8; i++) bits = (bits << 8) | data[i];
    std::memcpy(&value, &bits, 8);
  }
  return true;
}

bool readString(const Reader& reader, const Element& element, std::string& value) {
  const int64_t bytes = element.end - element.payload;
  if (bytes < 0 || bytes > kMaxValueBytes) return false;
  std::vector<char> data(static_cast<size_t>(bytes));
  if (bytes > 0 && !reader.readAt(element.payload, data.data(), static_cast<size_t>(bytes))) return false;
  value.assign(data.begin(), data.end());
  const size_t nul = value.find('\0');
  if (nul != std::string::npos) value.resize(nul);
  return true;
}

struct AudioTrack {
  bool found = false;
  double sampleRate = 8000.0;
  int64_t channels = 1;
  std::string codec;
};

void readTrackEntry(const Reader& reader, const Element& entry, AudioTrack& track) {
  int64_t type = 0;
  double rate = 8000.0;
  int64_t channels = 1;
  std::string codec;
  int64_t pos = entry.payload;
  while (pos < entry.end) {
    Element child;
    if (!readElement(reader, pos, entry.end, child)) return;
    if (child.id == kTrackType) {
      uint64_t value = 0;
      if (readUnsigned(reader, child, value)) type = static_cast<int64_t>(value);
    } else if (child.id == kCodecId) {
      readString(reader, child, codec);
    } else if (child.id == kAudio) {
      int64_t inner = child.payload;
      while (inner < child.end) {
        Element field;
        if (!readElement(reader, inner, child.end, field)) break;
        if (field.id == kSamplingFrequency) {
          readFloat(reader, field, rate);
        } else if (field.id == kChannels) {
          uint64_t value = 0;
          if (readUnsigned(reader, field, value)) channels = static_cast<int64_t>(value);
        }
        if (field.end <= inner) break;
        inner = field.end;
      }
    }
    if (child.end <= pos) return;
    pos = child.end;
  }
  if (type == kAudioTrackType && !track.found) {
    track.found = true;
    track.sampleRate = rate;
    track.channels = channels;
    track.codec = codec;
  }
}

}  // namespace

MatroskaParse parseMatroskaAudioInfo(const std::string& path, Mp4AudioInfo& out, std::string& error) {
  Reader reader;
  reader.file = std::fopen(path.c_str(), "rb");
  if (reader.file == nullptr) {
    error = "cannot open file";
    return MatroskaParse::NotMatroska;
  }
  std::fseek(reader.file, 0, SEEK_END);
  reader.length = static_cast<int64_t>(std::ftell(reader.file));
  struct Closer {
    std::FILE* f;
    ~Closer() { std::fclose(f); }
  } closer{reader.file};

  Element header;
  if (!readElement(reader, 0, reader.length, header) || header.id != kEbml) {
    error = "not a Matroska file";
    return MatroskaParse::NotMatroska;
  }
  std::string docType = "matroska";
  for (int64_t pos = header.payload; pos < header.end;) {
    Element child;
    if (!readElement(reader, pos, header.end, child)) break;
    if (child.id == kDocType) readString(reader, child, docType);
    if (child.end <= pos) break;
    pos = child.end;
  }
  if (docType != "matroska" && docType != "webm") {
    error = "an EBML file that is not Matroska or WebM (" + docType + ")";
    return MatroskaParse::NotMatroska;
  }

  Element segment;
  if (!readElement(reader, header.end, reader.length, segment) || segment.id != kSegment) {
    error = "Matroska file has no segment";
    return MatroskaParse::Malformed;
  }

  uint64_t timestampScale = 1000000;  // nanoseconds per tick, by default a millisecond
  double durationTicks = -1.0;
  bool sawTracks = false;
  AudioTrack track;
  int visited = 0;
  const int64_t scanEnd = segment.end < kScanLimitBytes ? segment.end : kScanLimitBytes;
  for (int64_t pos = segment.payload; pos < scanEnd && visited < kMaxElements; visited++) {
    Element child;
    if (!readElement(reader, pos, segment.end, child)) break;
    if (child.id == kInfo) {
      for (int64_t inner = child.payload; inner < child.end;) {
        Element field;
        if (!readElement(reader, inner, child.end, field)) break;
        if (field.id == kTimestampScale) {
          uint64_t value = 0;
          if (readUnsigned(reader, field, value) && value > 0) timestampScale = value;
        } else if (field.id == kDuration) {
          readFloat(reader, field, durationTicks);
        }
        if (field.end <= inner) break;
        inner = field.end;
      }
    } else if (child.id == kTracks) {
      sawTracks = true;
      for (int64_t inner = child.payload; inner < child.end;) {
        Element entry;
        if (!readElement(reader, inner, child.end, entry)) break;
        if (entry.id == kTrackEntry) readTrackEntry(reader, entry, track);
        if (entry.end <= inner) break;
        inner = entry.end;
      }
    } else if (child.id == kCluster) {
      // The media itself: the headers are behind us.
      break;
    }
    if (child.end <= pos) break;
    pos = child.end;
  }

  if (durationTicks > 0.0) out.durationMs = durationTicks * static_cast<double>(timestampScale) / 1.0e6;
  if (!sawTracks) {
    error = "Matroska file has no track list";
    return MatroskaParse::Malformed;
  }
  if (!track.found) {
    error = "this video has no sound track";
    return MatroskaParse::NoAudio;
  }
  out.sampleRate = static_cast<int>(track.sampleRate + 0.5);
  out.channels = static_cast<int>(track.channels);
  std::memset(out.codec, 0, sizeof(out.codec));
  std::strncpy(out.codec, track.codec.c_str(), sizeof(out.codec) - 1);
  if (out.sampleRate <= 0 || out.channels <= 0) {
    error = "Matroska audio track has no rate or channel count";
    return MatroskaParse::Malformed;
  }
  out.frames = out.durationMs > 0.0 ? static_cast<int64_t>(out.durationMs * out.sampleRate / 1000.0) : -1;
  out.ok = true;
  return MatroskaParse::Ok;
}

}  // namespace ws
