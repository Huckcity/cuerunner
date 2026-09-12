#pragma once

#include "source.h"

#include <cstdint>
#include <string>

namespace ws {

struct Mp4AudioInfo {
  int sampleRate = 0;
  int channels = 0;
  int64_t frames = -1;
  double durationMs = 0.0;
  char codec[8] = {};
  bool ok = false;
};

// Reads the container headers of an .m4a/.mp4 (ISO BMFF) file. This is metadata only:
// duration, channel count, sample rate and the sample-entry codec.
bool parseMp4AudioInfo(const std::string& path, Mp4AudioInfo& out, std::string& error);

// A decoder for M4A/AAC (and any other MP4 audio codec the platform decodes).
std::unique_ptr<Source> openM4aSource(const std::string& path, std::string& error, SourceError* errorCode = nullptr);

}  // namespace ws
