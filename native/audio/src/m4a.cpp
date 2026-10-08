#include "m4a.h"

#include "m4a_platform.h"
#include "matroska.h"
#include "util.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#if !defined(_WIN32)
#include <csignal>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace ws {
namespace {

int64_t fileLength(std::FILE* file) {
  const long current = std::ftell(file);
  if (std::fseek(file, 0, SEEK_END) != 0) return -1;
  const long end = std::ftell(file);
  std::fseek(file, current, SEEK_SET);
  return end < 0 ? -1 : static_cast<int64_t>(end);
}

bool readAt(std::FILE* file, int64_t offset, void* out, size_t bytes) {
  if (std::fseek(file, static_cast<long>(offset), SEEK_SET) != 0) return false;
  return std::fread(out, 1, bytes, file) == bytes;
}

uint32_t readBE32(const unsigned char* b) {
  return (static_cast<uint32_t>(b[0]) << 24) | (static_cast<uint32_t>(b[1]) << 16) |
         (static_cast<uint32_t>(b[2]) << 8) | static_cast<uint32_t>(b[3]);
}
uint64_t readBE64(const unsigned char* b) {
  return (static_cast<uint64_t>(readBE32(b)) << 32) | static_cast<uint64_t>(readBE32(b + 4));
}
uint16_t readBE16(const unsigned char* b) {
  return static_cast<uint16_t>((static_cast<uint16_t>(b[0]) << 8) | static_cast<uint16_t>(b[1]));
}

struct Box {
  char type[5] = {};
  int64_t start = 0;
  int64_t payload = 0;  // offset of first byte after the header
  int64_t end = 0;      // offset of first byte after the box
};

bool readBoxHeader(std::FILE* file, int64_t pos, int64_t limit, Box& box) {
  if (pos + 8 > limit) return false;
  unsigned char head[16];
  if (!readAt(file, pos, head, 8)) return false;
  uint64_t size = readBE32(head);
  std::memcpy(box.type, head + 4, 4);
  box.type[4] = '\0';
  int64_t header = 8;
  if (size == 1) {
    if (!readAt(file, pos + 8, head + 8, 8)) return false;
    size = readBE64(head + 8);
    header = 16;
  } else if (size == 0) {
    size = static_cast<uint64_t>(limit - pos);
  }
  if (size < static_cast<uint64_t>(header) || pos + static_cast<int64_t>(size) > limit) return false;
  box.start = pos;
  box.payload = pos + header;
  box.end = pos + static_cast<int64_t>(size);
  return true;
}

bool findBox(std::FILE* file, int64_t from, int64_t limit, const char* type, Box& out) {
  int64_t pos = from;
  while (pos + 8 <= limit) {
    Box box;
    if (!readBoxHeader(file, pos, limit, box)) return false;
    if (std::strcmp(box.type, type) == 0) {
      out = box;
      return true;
    }
    if (box.end <= pos) return false;
    pos = box.end;
  }
  return false;
}

// Audio sample entry (ISO 14496-12 §12.2.3 and QuickTime's SoundDescription v0/v1/v2).
//
// Layout after the sample entry header (size + type):
//   8   reserved[6]
//   14  data_reference_index
//   16  version            (2)
//   18  revision           (2)
//   20  vendor             (4)
//   24  channelcount       (2)      <- v0/v1 only
//   26  samplesize         (2)
//   28  pre_defined        (2)
//   30  reserved           (2)
//   32  samplerate         (4, 16.16 fixed)  <- v0/v1 only
// A version 2 entry replaces everything from 24 on with the "always" constants, a
// structure size, a 64-bit float sample rate and a 32-bit channel count.
bool parseSampleEntry(const unsigned char* data, size_t size, Mp4AudioInfo& out) {
  if (size < 36) return false;
  char format[5] = {};
  std::memcpy(format, data + 4, 4);
  const size_t base = 8;
  const uint16_t version = readBE16(data + base + 8);

  if (version == 2) {
    const size_t rateOffset = base + 8 + 4 + 8 + 8;  // version/revision/vendor, always[4], sizeOfStructOnly
    if (size < rateOffset + 12) return false;
    double rate = 0.0;
    std::memcpy(&rate, data + rateOffset, 8);
    const uint32_t channels = readBE32(data + rateOffset + 8);
    out.sampleRate = static_cast<int>(rate + 0.5);
    out.channels = static_cast<int>(channels);
    std::memcpy(out.codec, format, 5);
    return out.sampleRate > 0 && out.channels > 0;
  }

  const uint16_t channels = readBE16(data + base + 16);
  const uint32_t rateFixed = readBE32(data + base + 24);
  out.sampleRate = static_cast<int>(rateFixed >> 16);
  out.channels = static_cast<int>(channels);
  std::memcpy(out.codec, format, 5);
  return out.sampleRate > 0 && out.channels > 0;
}

}  // namespace

bool parseMp4AudioInfo(const std::string& path, Mp4AudioInfo& out, std::string& error) {
  std::FILE* file = std::fopen(path.c_str(), "rb");
  if (file == nullptr) {
    error = "cannot open file";
    return false;
  }
  const int64_t limit = fileLength(file);
  if (limit <= 0) {
    std::fclose(file);
    error = "cannot read file size";
    return false;
  }

  Box moov;
  if (!findBox(file, 0, limit, "moov", moov)) {
    std::fclose(file);
    error = "MP4 container has no moov box";
    return false;
  }

  // Movie header: overall duration for the file the renderer shows.
  Box mvhd;
  if (findBox(file, moov.payload, moov.end, "mvhd", mvhd)) {
    unsigned char head[32];
    if (readAt(file, mvhd.payload, head, sizeof(head))) {
      const unsigned char version = head[0];
      uint32_t timescale = 0;
      uint64_t duration = 0;
      if (version == 1) {
        timescale = readBE32(head + 20);
        duration = readBE64(head + 24);
      } else {
        timescale = readBE32(head + 12);
        duration = readBE32(head + 16);
      }
      if (timescale > 0) out.durationMs = static_cast<double>(duration) * 1000.0 / static_cast<double>(timescale);
    }
  }

  bool sawSound = false;
  int64_t pos = moov.payload;
  while (pos + 8 <= moov.end) {
    Box trak;
    if (!readBoxHeader(file, pos, moov.end, trak)) break;
    if (std::strcmp(trak.type, "trak") == 0) {
      Box mdia;
      if (findBox(file, trak.payload, trak.end, "mdia", mdia)) {
        Box hdlr;
        bool isAudio = false;
        if (findBox(file, mdia.payload, mdia.end, "hdlr", hdlr)) {
          unsigned char handler[12];
          if (readAt(file, hdlr.payload, handler, sizeof(handler))) {
            isAudio = std::memcmp(handler + 8, "soun", 4) == 0;
          }
        }
        if (isAudio) {
          sawSound = true;
          Box mdhd;
          int64_t frames = -1;
          if (findBox(file, mdia.payload, mdia.end, "mdhd", mdhd)) {
            unsigned char head[36];
            if (readAt(file, mdhd.payload, head, sizeof(head))) {
              const unsigned char version = head[0];
              if (version == 1) {
                const uint32_t timescale = readBE32(head + 20);
                const uint64_t duration = readBE64(head + 24);
                if (timescale > 0) frames = static_cast<int64_t>(duration);
                if (out.durationMs <= 0.0 && timescale > 0) {
                  out.durationMs = static_cast<double>(duration) * 1000.0 / static_cast<double>(timescale);
                }
              } else {
                const uint32_t timescale = readBE32(head + 12);
                const uint32_t duration = readBE32(head + 16);
                if (timescale > 0) frames = static_cast<int64_t>(duration);
                if (out.durationMs <= 0.0 && timescale > 0) {
                  out.durationMs = static_cast<double>(duration) * 1000.0 / static_cast<double>(timescale);
                }
              }
            }
          }
          Box minf;
          Box stbl;
          Box stsd;
          if (findBox(file, mdia.payload, mdia.end, "minf", minf) &&
              findBox(file, minf.payload, minf.end, "stbl", stbl) &&
              findBox(file, stbl.payload, stbl.end, "stsd", stsd)) {
            unsigned char entryHead[16];
            if (readAt(file, stsd.payload, entryHead, sizeof(entryHead))) {
              const uint32_t entryCount = readBE32(entryHead + 4);
              if (entryCount >= 1) {
                const int64_t entryStart = stsd.payload + 8;
                unsigned char entrySizeBytes[8];
                if (readAt(file, entryStart, entrySizeBytes, 8)) {
                  const uint32_t entrySize = readBE32(entrySizeBytes);
                  if (entrySize >= 8 && entrySize <= 4096 && entryStart + entrySize <= limit) {
                    std::vector<unsigned char> entry(entrySize);
                    if (readAt(file, entryStart, entry.data(), entrySize)) {
                      Mp4AudioInfo parsed;
                      if (parseSampleEntry(entry.data(), entry.size(), parsed)) {
                        out.sampleRate = parsed.sampleRate;
                        out.channels = parsed.channels;
                        std::memcpy(out.codec, parsed.codec, 5);
                        out.frames = frames;
                        out.ok = out.sampleRate > 0 && out.channels > 0;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    if (trak.end <= pos) break;
    pos = trak.end;
  }

  std::fclose(file);
  if (!out.ok) {
    if (!sawSound) {
      out.noAudioTrack = true;
      error = "this video has no sound track";
      return false;
    }
    error = "MP4 container has no decodable audio sample entry";
    return false;
  }
  if (out.frames < 0 && out.durationMs > 0.0) {
    out.frames = static_cast<int64_t>(out.durationMs * out.sampleRate / 1000.0);
  }
  return true;
}

// ---------------------------------------------------------------------------
// ffmpeg pipe decoder.
//
// Used as the platform decoder where no OS codec API exists (Linux; notably
// PulseAudio/PipeWire systems have no system AAC decoder), and as a fallback where
// one does. The user's own ffmpeg is executed outside the audio callback with a
// bounded pipe and a fixed sample format; nothing about it needs a bundled runtime.
// ---------------------------------------------------------------------------
#if !defined(_WIN32)

namespace {

// Resolution order: explicit override (tests/support), the decoder shipped next to the
// engine executable (the packaged build), then the system PATH as a development
// convenience. The packaged helper is a LGPL-only FFmpeg build, executed as a separate
// process; nothing links against it.
std::string selfDirectory() {
  char buffer[4096] = {};
  const ssize_t length = ::readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
  if (length <= 0) return {};
  std::string path(buffer, static_cast<size_t>(length));
  const size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? std::string() : path.substr(0, slash);
}

std::string findFfmpeg(std::string* missingOverride) {
  const char* override = std::getenv("CUERUNNER_FFMPEG");
  if (override != nullptr && override[0] != '\0') {
    if (missingOverride != nullptr && ::access(override, X_OK) != 0) *missingOverride = override;
    return override;
  }

  const char* resourceDir = std::getenv("CUERUNNER_DECODER_DIR");
  std::vector<std::string> packagedDirs;
  if (resourceDir != nullptr && resourceDir[0] != '\0') packagedDirs.push_back(resourceDir);
  const std::string self = selfDirectory();
  if (!self.empty()) {
    packagedDirs.push_back(self + "/decoders");            // <resources>/audio/decoders
    packagedDirs.push_back(self + "/audio/decoders");
    packagedDirs.push_back(self + "/../decoders");         // native/audio/build/../decoders
  }
  for (const std::string& dir : packagedDirs) {
    const std::string candidate = dir + "/ffmpeg";
    if (::access(candidate.c_str(), X_OK) == 0) return candidate;
  }

  const char* pathEnv = std::getenv("PATH");
  if (pathEnv == nullptr) return {};
  std::string paths(pathEnv);
  size_t start = 0;
  while (start <= paths.size()) {
    const size_t end = paths.find(':', start);
    const std::string dir = paths.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (!dir.empty()) {
      const std::string candidate = dir + "/ffmpeg";
      if (::access(candidate.c_str(), X_OK) == 0) return candidate;
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return {};
}

}  // namespace

class FfmpegPipeSource final : public Source {
 public:
  bool open(const std::string& path, const Mp4AudioInfo& meta, std::string& error, Format format = Format::M4a) {
    std::string missing;
    ffmpeg_ = findFfmpeg(&missing);
    if (!missing.empty()) {
      error = "M4A/AAC decoder not found: " + missing;
      return false;
    }
    if (ffmpeg_.empty()) {
      error = "M4A/AAC decoding needs the packaged decoder (or ffmpeg on PATH) on this platform; "
              "run npm run build:ffmpeg";
      return false;
    }
    path_ = path;
    info_.format = format;
    info_.sampleRate = meta.sampleRate > 0 ? meta.sampleRate : 48000;
    info_.channels = meta.channels > 0 ? meta.channels : 2;
    info_.frames = meta.frames;
    info_.canSeek = true;
    if (!spawn(0.0, error)) return false;

    // A helper that cannot decode exits at once. Read one frame now so a broken or
    // absent decoder is reported as a decoder error rather than looking like a silent,
    // empty file.
    std::vector<float> probe(static_cast<size_t>(info_.channels), 0.0f);
    if (readFrames(probe.data(), 1) <= 0) {
      closeChild();
      if (error.empty()) {
        error = "the M4A decoder produced no audio (is " + ffmpeg_ + " a working build?)";
      }
      return false;
    }
    pending_.assign(probe.begin(), probe.end());
    pendingOffset_ = 0;
    return true;
  }

  ~FfmpegPipeSource() override { closeChild(); }

  SourceInfo& info() override { return info_; }

  int64_t readFrames(float* out, int64_t frames) override {
    if (stream_ == nullptr || frames <= 0) return 0;
    const size_t channels = static_cast<size_t>(info_.channels);
    int64_t produced = 0;
    if (pendingOffset_ < pending_.size()) {
      const int64_t available = static_cast<int64_t>((pending_.size() - pendingOffset_) / channels);
      const int64_t take = frames < available ? frames : available;
      const size_t floats = static_cast<size_t>(take) * channels;
      std::memcpy(out, pending_.data() + pendingOffset_, floats * sizeof(float));
      pendingOffset_ += floats;
      produced += take;
    }
    if (produced < frames) {
      const size_t want = static_cast<size_t>(frames - produced) * channels * sizeof(float);
      const size_t got = std::fread(out + produced * static_cast<int64_t>(channels), 1, want, stream_);
      produced += static_cast<int64_t>(got / (channels * sizeof(float)));
    }
    return produced;
  }

  bool seekToFrame(int64_t frame) override {
    if (frame < 0) frame = 0;
    if (frame == positionFrames_) return true;
    const double seconds = static_cast<double>(frame) / static_cast<double>(info_.sampleRate);
    std::string error;
    pending_.clear();
    pendingOffset_ = 0;
    if (!spawn(seconds, error)) {
      logError("the M4A decoder could not seek: %s", error.c_str());
      return false;
    }
    positionFrames_ = frame;
    return true;
  }

 private:
  bool spawn(double startSeconds, std::string& error) {
    closeChild();
    int fds[2];
    if (::pipe(fds) != 0) {
      error = "cannot create decoder pipe";
      return false;
    }
    const pid_t pid = ::fork();
    if (pid < 0) {
      ::close(fds[0]);
      ::close(fds[1]);
      error = "cannot fork decoder process";
      return false;
    }
    if (pid == 0) {
      ::dup2(fds[1], STDOUT_FILENO);
      ::close(fds[0]);
      ::close(fds[1]);
      std::string rate = std::to_string(info_.sampleRate);
      std::string channels = std::to_string(info_.channels);
      std::string start = std::to_string(startSeconds);
      std::vector<std::string> args = {ffmpeg_, "-v", "error", "-nostdin"};
      if (startSeconds > 0.0) {
        args.push_back("-ss");
        args.push_back(start);
      }
      args.push_back("-i");
      args.push_back(path_);
      // Sound only: a video's picture and subtitles are not this helper's to read, and the
      // pinned build has no decoder for them to try.
      args.push_back("-vn");
      args.push_back("-sn");
      args.push_back("-dn");
      args.push_back("-f");
      args.push_back("f32le");
      args.push_back("-ac");
      args.push_back(channels);
      args.push_back("-ar");
      args.push_back(rate);
      args.push_back("pipe:1");
      std::vector<char*> argv;
      argv.reserve(args.size() + 1);
      for (std::string& arg : args) argv.push_back(arg.data());
      argv.push_back(nullptr);
      ::execvp(ffmpeg_.c_str(), argv.data());
      _exit(127);
    }
    ::close(fds[1]);
    stream_ = ::fdopen(fds[0], "rb");
    if (stream_ == nullptr) {
      ::close(fds[0]);
      error = "cannot open decoder stream";
      return false;
    }
    pid_ = pid;
    positionFrames_ = static_cast<int64_t>(startSeconds * info_.sampleRate);
    return true;
  }

  void closeChild() {
    // Kill first, then close the read end. The child is a pinned ffmpeg reading this pipe's
    // other side as its stdout, and the other order races it: our fclose makes its next
    // write an EPIPE, which at `-v error` it reports as "Error muxing a packet" and
    // "Terminating thread with return code -32 (Broken pipe)" — four lines of alarming
    // error text per decode, in a run where the decode was in fact fine. Stopping the child
    // before there is nothing to write to removes the race rather than hiding its output;
    // a real decode failure still arrives, because it happens while we are reading.
    if (pid_ > 0) {
      ::kill(pid_, SIGKILL);
      int status = 0;
      ::waitpid(pid_, &status, 0);
      pid_ = -1;
    }
    if (stream_ != nullptr) {
      std::fclose(stream_);
      stream_ = nullptr;
    }
  }

  std::string ffmpeg_;
  std::string path_;
  std::FILE* stream_ = nullptr;
  pid_t pid_ = -1;
  int64_t positionFrames_ = 0;
  std::vector<float> pending_;  // the frame read while probing the decoder at open
  size_t pendingOffset_ = 0;
  SourceInfo info_{};
};

#endif  // !_WIN32

std::unique_ptr<Source> openM4aSource(const std::string& path, std::string& error, SourceError* errorCode) {
  if (errorCode != nullptr) *errorCode = SourceError::None;
  Mp4AudioInfo meta;
  std::string metaError;
  const bool haveMeta = parseMp4AudioInfo(path, meta, metaError);
  if (!haveMeta && meta.noAudioTrack) {
    // A video with no sound is a picture and nothing else: said as such on every platform,
    // before any decoder is asked to make sound out of it.
    error = metaError;
    if (errorCode != nullptr) *errorCode = SourceError::NoAudioTrack;
    return nullptr;
  }

#if defined(_WIN32)
  {
    std::string platformError;
    std::unique_ptr<Source> source = openMediaFoundationSource(path, platformError);
    if (source != nullptr) return source;
    logLine("Media Foundation could not open the file: %s", platformError.c_str());
    error = platformError;
  }
#elif defined(__APPLE__)
  {
    std::string platformError;
    std::unique_ptr<Source> source = openAudioToolboxSource(path, platformError);
    if (source != nullptr) return source;
    logLine("AudioToolbox could not open the file: %s", platformError.c_str());
    error = platformError;
  }
#endif

#if !defined(_WIN32)
  if (!haveMeta) {
    error = metaError.empty() ? std::string("unrecognised M4A container") : metaError;
    if (errorCode != nullptr) *errorCode = SourceError::Unreadable;
    return nullptr;
  }
  auto pipe = std::make_unique<FfmpegPipeSource>();
  if (!pipe->open(path, meta, error)) {
    if (errorCode != nullptr) *errorCode = SourceError::DecoderUnavailable;
    return nullptr;
  }
  return pipe;
#else
  if (error.empty()) error = "no M4A decoder available";
  if (errorCode != nullptr) *errorCode = SourceError::DecoderUnavailable;
  return nullptr;
#endif
}

std::unique_ptr<Source> openMatroskaSource(const std::string& path, std::string& error, SourceError* errorCode) {
  if (errorCode != nullptr) *errorCode = SourceError::None;
  Mp4AudioInfo meta;
  std::string metaError;
  const MatroskaParse parsed = parseMatroskaAudioInfo(path, meta, metaError);
  if (parsed == MatroskaParse::NoAudio) {
    error = metaError;
    if (errorCode != nullptr) *errorCode = SourceError::NoAudioTrack;
    return nullptr;
  }
  if (parsed != MatroskaParse::Ok) {
    error = metaError.empty() ? std::string("unrecognised Matroska container") : metaError;
    if (errorCode != nullptr) *errorCode = SourceError::Unreadable;
    return nullptr;
  }
#if defined(_WIN32)
  {
    // Media Foundation reads WebM where the system has the extension for it; where it does
    // not, the sound is a format this machine cannot decode, and the picture still plays.
    std::string platformError;
    std::unique_ptr<Source> source = openMediaFoundationSource(path, platformError);
    if (source != nullptr) return source;
    error = platformError.empty() ? std::string("this machine has no decoder for the sound in a Matroska/WebM file") : platformError;
    if (errorCode != nullptr) *errorCode = SourceError::DecoderUnavailable;
    return nullptr;
  }
#else
  auto pipe = std::make_unique<FfmpegPipeSource>();
  if (!pipe->open(path, meta, error, Format::Matroska)) {
    if (errorCode != nullptr) *errorCode = SourceError::DecoderUnavailable;
    return nullptr;
  }
  return pipe;
#endif
}

}  // namespace ws
