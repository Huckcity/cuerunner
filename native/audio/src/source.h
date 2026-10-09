// Decoders. A Source is a pull interface over one media file: it reports the file's
// real format, sample rate, channel count and length, and produces interleaved float
// frames. Everything here runs off the audio thread (command thread for whole-file
// decode, decode thread for streaming).
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace ws {

enum class Format { Unknown = 0, Wav, Mp3, Ogg, Flac, M4a, Aiff, Matroska };

const char* formatName(Format format);

/** Why a file could not be opened, so callers can report it precisely. */
enum class SourceError {
  None = 0,
  Unreadable,          // missing, or not media we can parse
  UnsupportedFormat,   // a format we do not decode at all
  DecoderUnavailable,  // the format needs a decoder this build/session does not have
  NoAudioTrack         // a video container with no sound in it: a picture, not a failure
};

struct SourceInfo {
  Format format = Format::Unknown;
  int sampleRate = 0;
  int channels = 0;
  int64_t frames = -1;  // -1 when the stream does not state its length
  int64_t fileBytes = 0;
  bool canSeek = false;
};

/**
 * A file's identity to a cache that outlives one open: its size and modification time.
 * Two reads of the same path with the same stamp are the same media; a file edited in
 * place between them is not, however equal its length.
 */
struct FileStamp {
  int64_t bytes = 0;
  int64_t modified = 0;
};

FileStamp fileStampOf(const std::string& path);

class Source {
 public:
  virtual ~Source() = default;
  virtual SourceInfo& info() = 0;
  // Reads up to `frames` interleaved float frames. Returns frames read; 0 means EOF.
  virtual int64_t readFrames(float* out, int64_t frames) = 0;
  // Repositions to an absolute frame. Returns false when the stream cannot seek.
  virtual bool seekToFrame(int64_t frame) = 0;
};

// Opens a media file for streaming decode. On failure returns null and fills `error`
// with a human-readable reason (including "format unavailable on this platform").
std::unique_ptr<Source> openSource(const std::string& path, std::string& error, SourceError* errorCode = nullptr);

// Decodes an entire file into interleaved float. Used for files small enough to cache.
bool decodeWholeFile(const std::string& path, std::vector<float>& out, SourceInfo& info, std::string& error);

}  // namespace ws
