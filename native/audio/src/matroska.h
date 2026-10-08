// Matroska and WebM: the container a video cue's file is often in, read for its audio track.
//
// Only the headers are read here — the EBML header, the segment's Info (its timescale and
// duration) and its Tracks — enough to say whether the file carries sound, at what rate, in
// how many channels, and for how long. Decoding is the platform's (the same FFmpeg helper an
// M4A is decoded by, on Linux and macOS), and the picture is not this process's business at
// all: the output window decodes it.
#pragma once

#include "m4a.h"

#include <string>

namespace ws {

enum class MatroskaParse {
  Ok,
  NotMatroska,  // no EBML header, or a DocType that is neither matroska nor webm
  NoAudio,      // a well-formed file with no audio track
  Malformed     // a header that does not hold together
};

// Reads the container headers of a .mkv/.webm file. `out` carries the first audio track's
// rate, channel count and codec id prefix, and the segment's duration.
MatroskaParse parseMatroskaAudioInfo(const std::string& path, Mp4AudioInfo& out, std::string& error);

// A decoder for the first audio track of a Matroska/WebM file.
std::unique_ptr<Source> openMatroskaSource(const std::string& path, std::string& error, SourceError* errorCode = nullptr);

}  // namespace ws
