#include "source.h"

#include "m4a.h"
#include "util.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>

#include "dr_flac.h"
#include "dr_mp3.h"
#include "dr_wav.h"
#define STB_VORBIS_HEADER_ONLY
#include "stb_vorbis.c"
#undef STB_VORBIS_HEADER_ONLY

namespace ws {
namespace {

int64_t fileSizeOf(const std::string& path) {
  struct stat st{};
  if (::stat(path.c_str(), &st) != 0) return 0;
  return static_cast<int64_t>(st.st_size);
}

// Reads a 4-byte magic without assuming anything about the file.
bool readMagic(const std::string& path, unsigned char* out, size_t count) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (f == nullptr) return false;
  const size_t got = std::fread(out, 1, count, f);
  std::fclose(f);
  return got == count;
}

Format sniffFormat(const std::string& path) {
  unsigned char magic[12] = {};
  if (!readMagic(path, magic, sizeof(magic))) return Format::Unknown;
  if (std::memcmp(magic, "RIFF", 4) == 0 && std::memcmp(magic + 8, "WAVE", 4) == 0) return Format::Wav;
  if (std::memcmp(magic, "fLaC", 4) == 0) return Format::Flac;
  if (std::memcmp(magic, "OggS", 4) == 0) return Format::Ogg;
  if (std::memcmp(magic, "FORM", 4) == 0 &&
      (std::memcmp(magic + 8, "AIFF", 4) == 0 || std::memcmp(magic + 8, "AIFC", 4) == 0)) {
    return Format::Aiff;
  }
  if (std::memcmp(magic + 4, "ftyp", 4) == 0) return Format::M4a;
  if (std::memcmp(magic, "ID3", 3) == 0) return Format::Mp3;
  // Raw MP3 frame sync: 11 bits set.
  if (magic[0] == 0xFF && (magic[1] & 0xE0) == 0xE0) return Format::Mp3;
  return Format::Unknown;
}

// --- WAV -------------------------------------------------------------------

class WavSource final : public Source {
 public:
  bool open(const std::string& path, std::string& error) {
    if (!drwav_init_file(&wav_, path.c_str(), nullptr)) {
      // dr_wav closes the FILE* itself when init fails, and it frees what it allocated
      // on the way out. Uninitializing a decoder that never initialized therefore
      // closes/frees the same object twice — glibc aborts on it — so the destructor
      // must only uninit what really initialized. A truncated WAV from the cue list
      // used to take the engine and the running show down with it.
      error = "not a readable WAV file";
      return false;
    }
    initialized_ = true;
    info_.format = Format::Wav;
    info_.sampleRate = static_cast<int>(wav_.sampleRate);
    info_.channels = static_cast<int>(wav_.channels);
    info_.frames = static_cast<int64_t>(wav_.totalPCMFrameCount);
    info_.canSeek = true;
    return true;
  }
  ~WavSource() override {
    if (initialized_) drwav_uninit(&wav_);
  }
  SourceInfo& info() override { return info_; }
  int64_t readFrames(float* out, int64_t frames) override {
    return static_cast<int64_t>(drwav_read_pcm_frames_f32(&wav_, static_cast<drwav_uint64>(frames), out));
  }
  bool seekToFrame(int64_t frame) override {
    return drwav_seek_to_pcm_frame(&wav_, static_cast<drwav_uint64>(frame)) == DRWAV_SUCCESS;
  }

 private:
  drwav wav_{};
  bool initialized_ = false;
  SourceInfo info_{};
};

// --- MP3 -------------------------------------------------------------------

// dr_mp3 can stream through callbacks; that keeps a long file off the heap.
class Mp3Source final : public Source {
 public:
  struct FileIo {
    std::FILE* file = nullptr;
  };

  static size_t onRead(void* user, void* out, size_t bytes) {
    auto* io = static_cast<FileIo*>(user);
    return std::fread(out, 1, bytes, io->file);
  }
  static drmp3_bool32 onSeek(void* user, int offset, drmp3_seek_origin origin) {
    auto* io = static_cast<FileIo*>(user);
    const int whence = origin == DRMP3_SEEK_SET ? SEEK_SET : (origin == DRMP3_SEEK_END ? SEEK_END : SEEK_CUR);
    return std::fseek(io->file, offset, whence) == 0 ? DRMP3_TRUE : DRMP3_FALSE;
  }
  static drmp3_bool32 onTell(void* user, drmp3_int64* cursor) {
    auto* io = static_cast<FileIo*>(user);
    const long pos = std::ftell(io->file);
    if (pos < 0) return DRMP3_FALSE;
    *cursor = static_cast<drmp3_int64>(pos);
    return DRMP3_TRUE;
  }

  bool open(const std::string& path, std::string& error) {
    io_.file = std::fopen(path.c_str(), "rb");
    if (io_.file == nullptr) {
      error = "cannot open file";
      return false;
    }
    if (!drmp3_init(&mp3_, onRead, onSeek, onTell, nullptr, &io_, nullptr)) {
      // Same contract as dr_wav: a failed init frees what it allocated and must not be
      // uninitialized afterwards. A truncated MP3 is a refusal, not an abort.
      error = "not a readable MP3 file";
      return false;
    }
    initialized_ = true;
    info_.format = Format::Mp3;
    info_.sampleRate = static_cast<int>(mp3_.sampleRate);
    info_.channels = static_cast<int>(mp3_.channels);
    const drmp3_uint64 frames = drmp3_get_pcm_frame_count(&mp3_);
    info_.frames = frames > 0 ? static_cast<int64_t>(frames) : -1;
    info_.canSeek = true;
    return true;
  }
  ~Mp3Source() override {
    if (initialized_) drmp3_uninit(&mp3_);
    if (io_.file != nullptr) std::fclose(io_.file);
  }
  SourceInfo& info() override { return info_; }
  int64_t readFrames(float* out, int64_t frames) override {
    return static_cast<int64_t>(drmp3_read_pcm_frames_f32(&mp3_, static_cast<drmp3_uint64>(frames), out));
  }
  bool seekToFrame(int64_t frame) override {
    return drmp3_seek_to_pcm_frame(&mp3_, static_cast<drmp3_uint64>(frame)) == DRMP3_TRUE;
  }

 private:
  drmp3 mp3_{};
  bool initialized_ = false;
  FileIo io_{};
  SourceInfo info_{};
};

// --- FLAC ------------------------------------------------------------------

class FlacSource final : public Source {
 public:
  bool open(const std::string& path, std::string& error) {
    flac_ = drflac_open_file(path.c_str(), nullptr);
    if (flac_ == nullptr) {
      error = "not a readable FLAC file";
      return false;
    }
    info_.format = Format::Flac;
    info_.sampleRate = static_cast<int>(flac_->sampleRate);
    info_.channels = static_cast<int>(flac_->channels);
    info_.frames = flac_->totalPCMFrameCount > 0 ? static_cast<int64_t>(flac_->totalPCMFrameCount) : -1;
    info_.canSeek = true;
    return true;
  }
  ~FlacSource() override {
    if (flac_ != nullptr) drflac_close(flac_);
  }
  SourceInfo& info() override { return info_; }
  int64_t readFrames(float* out, int64_t frames) override {
    return static_cast<int64_t>(drflac_read_pcm_frames_f32(flac_, static_cast<drflac_uint64>(frames), out));
  }
  bool seekToFrame(int64_t frame) override {
    return drflac_seek_to_pcm_frame(flac_, static_cast<drflac_uint64>(frame)) == DRFLAC_TRUE;
  }

 private:
  drflac* flac_ = nullptr;
  SourceInfo info_{};
};

// --- OGG Vorbis ------------------------------------------------------------

class VorbisSource final : public Source {
 public:
  bool open(const std::string& path, std::string& error) {
    int code = 0;
    vorbis_ = stb_vorbis_open_filename(path.c_str(), &code, nullptr);
    if (vorbis_ == nullptr) {
      char buf[64];
      std::snprintf(buf, sizeof(buf), "not a readable Ogg Vorbis file (error %d)", code);
      error = buf;
      return false;
    }
    const stb_vorbis_info vi = stb_vorbis_get_info(vorbis_);
    info_.format = Format::Ogg;
    info_.sampleRate = static_cast<int>(vi.sample_rate);
    info_.channels = static_cast<int>(vi.channels);
    const unsigned int frames = stb_vorbis_stream_length_in_samples(vorbis_);
    info_.frames = frames > 0 ? static_cast<int64_t>(frames) : -1;
    info_.canSeek = true;
    return true;
  }
  ~VorbisSource() override {
    if (vorbis_ != nullptr) stb_vorbis_close(vorbis_);
  }
  SourceInfo& info() override { return info_; }
  int64_t readFrames(float* out, int64_t frames) override {
    const int got = stb_vorbis_get_samples_float_interleaved(
        vorbis_, info_.channels, out, static_cast<int>(frames) * info_.channels);
    return got < 0 ? 0 : got;
  }
  bool seekToFrame(int64_t frame) override {
    return stb_vorbis_seek(vorbis_, static_cast<unsigned int>(frame)) != 0;
  }

 private:
  stb_vorbis* vorbis_ = nullptr;
  SourceInfo info_{};
};

// --- AIFF / AIFF-C ---------------------------------------------------------
//
// IFF container: FORM <size> AIFF|AIFC, then chunks. COMM carries channels, frames,
// bit depth and the 80-bit sample rate; SSND carries the samples. AIFF is big-endian
// PCM; AIFF-C adds a compression id, of which NONE/twos/sowt/fl32/FL32/raw are
// handled here. Anything else is reported as unsupported rather than guessed at.

double readExtended80(const unsigned char* b) {
  const int sign = (b[0] & 0x80) ? -1 : 1;
  const int exponent = ((b[0] & 0x7F) << 8) | b[1];
  uint64_t mantissa = 0;
  for (int i = 0; i < 8; i++) mantissa = (mantissa << 8) | b[2 + i];
  if (exponent == 0 && mantissa == 0) return 0.0;
  if (exponent == 0x7FFF) return 0.0;
  return sign * std::ldexp(static_cast<double>(mantissa), exponent - 16383 - 63);
}

uint32_t readBE32(const unsigned char* b) {
  return (static_cast<uint32_t>(b[0]) << 24) | (static_cast<uint32_t>(b[1]) << 16) |
         (static_cast<uint32_t>(b[2]) << 8) | static_cast<uint32_t>(b[3]);
}
uint16_t readBE16(const unsigned char* b) {
  return static_cast<uint16_t>((static_cast<uint16_t>(b[0]) << 8) | static_cast<uint16_t>(b[1]));
}

class AiffSource final : public Source {
 public:
  bool open(const std::string& path, std::string& error);
  ~AiffSource() override {
    if (file_ != nullptr) std::fclose(file_);
  }
  SourceInfo& info() override { return info_; }
  int64_t readFrames(float* out, int64_t frames) override;
  bool seekToFrame(int64_t frame) override;

 private:
  bool readChunk(int64_t& pos, int64_t limit, std::vector<unsigned char>& out);

  std::FILE* file_ = nullptr;
  SourceInfo info_{};
  int64_t dataStart_ = 0;
  int64_t dataBytes_ = 0;
  int bitDepth_ = 16;
  char compression_[5] = {'N', 'O', 'N', 'E', '\0'};
  int64_t nextFrame_ = 0;
  std::vector<unsigned char> raw_;
  std::vector<unsigned char> pending_;
  int64_t pendingFrames_ = 0;
  int64_t pendingOffset_ = 0;
};

bool AiffSource::open(const std::string& path, std::string& error) {
  file_ = std::fopen(path.c_str(), "rb");
  if (file_ == nullptr) {
    error = "cannot open file";
    return false;
  }
  std::fseek(file_, 0, SEEK_END);
  const int64_t limit = std::ftell(file_);
  std::fseek(file_, 0, SEEK_SET);

  int64_t pos = 0;
  std::vector<unsigned char> header;
  if (!readChunk(pos, limit, header) || header.size() < 12 || std::memcmp(header.data(), "FORM", 4) != 0) {
    error = "not an AIFF file";
    return false;
  }
  const bool aifc = std::memcmp(header.data() + 8, "AIFC", 4) == 0;
  if (!aifc && std::memcmp(header.data() + 8, "AIFF", 4) != 0) {
    error = "not an AIFF file";
    return false;
  }

  int64_t frames = -1;
  int channels = 0;
  double sampleRate = 0.0;
  bool haveSsnd = false;
  while (pos + 8 <= limit) {
    std::vector<unsigned char> chunk;
    const int64_t chunkStart = pos;
    if (!readChunk(pos, limit, chunk) || chunk.size() < 8) break;
    const char* id = reinterpret_cast<const char*>(chunk.data());
    const uint32_t size = readBE32(chunk.data() + 4);
    if (std::memcmp(id, "COMM", 4) == 0 && chunk.size() >= 8 + 18) {
      const unsigned char* p = chunk.data() + 8;
      channels = readBE16(p);
      frames = static_cast<int64_t>(readBE32(p + 2));
      bitDepth_ = readBE16(p + 6);
      sampleRate = readExtended80(p + 8);
      if (aifc && chunk.size() >= 8 + 22) {
        std::memcpy(compression_, chunk.data() + 8 + 18, 4);
        compression_[4] = '\0';
      }
    } else if (std::memcmp(id, "SSND", 4) == 0 && chunk.size() >= 8 + 8) {
      const uint32_t offset = readBE32(chunk.data() + 8);
      dataStart_ = chunkStart + 8 + 8 + static_cast<int64_t>(offset);
      const int64_t chunkData = static_cast<int64_t>(size) - 8 - static_cast<int64_t>(offset);
      dataBytes_ = chunkData > 0 ? chunkData : 0;
      if (limit - dataStart_ < dataBytes_) dataBytes_ = limit - dataStart_;
      haveSsnd = true;
    }
    pos = chunkStart + 8 + static_cast<int64_t>(size) + (size & 1);
  }

  if (channels <= 0 || sampleRate <= 0.0 || !haveSsnd) {
    error = "AIFF file is missing COMM or SSND";
    return false;
  }

  const int bytesPerSample = (bitDepth_ + 7) / 8;
  const int64_t bytesPerFrame = static_cast<int64_t>(channels) * bytesPerSample;
  if (bytesPerFrame <= 0) {
    error = "AIFF file has an invalid frame size";
    return false;
  }
  if (frames < 0) frames = dataBytes_ / bytesPerFrame;
  if (frames * bytesPerFrame > dataBytes_) frames = dataBytes_ / bytesPerFrame;

  const bool known = std::strcmp(compression_, "NONE") == 0 || std::strcmp(compression_, "twos") == 0 ||
                     std::strcmp(compression_, "sowt") == 0 || std::strcmp(compression_, "raw ") == 0 ||
                     std::strcmp(compression_, "fl32") == 0 || std::strcmp(compression_, "FL32") == 0 ||
                     std::strcmp(compression_, "fl64") == 0 || std::strcmp(compression_, "FL64") == 0;
  if (!known) {
    error = std::string("unsupported AIFF compression '") + compression_ + "'";
    return false;
  }

  info_.format = Format::Aiff;
  info_.sampleRate = static_cast<int>(sampleRate + 0.5);
  info_.channels = channels;
  info_.frames = frames;
  info_.canSeek = true;
  raw_.resize(static_cast<size_t>(bytesPerFrame) * 8192);
  return true;
}

bool AiffSource::readChunk(int64_t& pos, int64_t limit, std::vector<unsigned char>& out) {
  if (pos + 8 > limit) return false;
  if (std::fseek(file_, static_cast<long>(pos), SEEK_SET) != 0) return false;
  unsigned char head[8];
  if (std::fread(head, 1, 8, file_) != 8) return false;
  const uint32_t size = readBE32(head + 4);
  const int64_t total = 8 + static_cast<int64_t>(size);
  if (total < 8 || pos + total > limit) return false;
  out.resize(static_cast<size_t>(total));
  std::memcpy(out.data(), head, 8);
  if (size > 0 && std::fread(out.data() + 8, 1, size, file_) != size) return false;
  pos += total;
  return true;
}

namespace {

inline float decodePcmSample(const unsigned char* p, int bitDepth, bool littleEndian, bool isFloat) {
  if (isFloat) {
    if (bitDepth == 64) {
      double v = 0.0;
      unsigned char tmp[8];
      for (int i = 0; i < 8; i++) tmp[i] = littleEndian ? p[i] : p[7 - i];
      std::memcpy(&v, tmp, 8);
      return static_cast<float>(v);
    }
    float v = 0.0f;
    unsigned char tmp[4];
    for (int i = 0; i < 4; i++) tmp[i] = littleEndian ? p[i] : p[3 - i];
    std::memcpy(&v, tmp, 4);
    return v;
  }
  switch (bitDepth) {
    case 8: {
      const int v = static_cast<int>(static_cast<int8_t>(p[0]));
      return static_cast<float>(v) / 128.0f;
    }
    case 16: {
      int16_t v = 0;
      unsigned char tmp[2];
      for (int i = 0; i < 2; i++) tmp[i] = littleEndian ? p[i] : p[1 - i];
      std::memcpy(&v, tmp, 2);
      return static_cast<float>(v) / 32768.0f;
    }
    case 24: {
      int32_t v = 0;
      if (littleEndian) {
        v = (static_cast<int32_t>(p[0]) | (static_cast<int32_t>(p[1]) << 8)) |
            (static_cast<int32_t>(p[2]) << 16);
      } else {
        v = (static_cast<int32_t>(p[0]) << 16) | (static_cast<int32_t>(p[1]) << 8) | static_cast<int32_t>(p[2]);
      }
      if ((v & 0x00800000) != 0) v |= ~0x00FFFFFF;
      return static_cast<float>(v) / 8388608.0f;
    }
    case 32: {
      int32_t v = 0;
      unsigned char tmp[4];
      for (int i = 0; i < 4; i++) tmp[i] = littleEndian ? p[i] : p[3 - i];
      std::memcpy(&v, tmp, 4);
      return static_cast<float>(v) / 2147483648.0f;
    }
    default: return 0.0f;
  }
}

}  // namespace

int64_t AiffSource::readFrames(float* out, int64_t frames) {
  if (frames <= 0 || info_.channels <= 0) return 0;
  const int bytesPerSample = (bitDepth_ + 7) / 8;
  const int64_t bytesPerFrame = static_cast<int64_t>(info_.channels) * bytesPerSample;
  const bool isFloat = std::strcmp(compression_, "fl32") == 0 || std::strcmp(compression_, "FL32") == 0 ||
                       std::strcmp(compression_, "fl64") == 0 || std::strcmp(compression_, "FL64") == 0;
  const bool littleEndian = std::strcmp(compression_, "sowt") == 0 || std::strcmp(compression_, "FL32") == 0 ||
                            std::strcmp(compression_, "FL64") == 0;

  int64_t produced = 0;
  while (produced < frames) {
    if (pendingFrames_ <= 0) {
      const int64_t remaining = info_.frames - nextFrame_;
      if (remaining <= 0) break;
      const int64_t chunkFrames = remaining < 8192 ? remaining : 8192;
      const size_t want = static_cast<size_t>(chunkFrames) * static_cast<size_t>(bytesPerFrame);
      if (std::fseek(file_, static_cast<long>(dataStart_ + nextFrame_ * bytesPerFrame), SEEK_SET) != 0) break;
      const size_t got = std::fread(raw_.data(), 1, want, file_);
      const int64_t gotFrames = static_cast<int64_t>(got / static_cast<size_t>(bytesPerFrame));
      if (gotFrames <= 0) break;
      pendingFrames_ = gotFrames;
      pendingOffset_ = 0;
      nextFrame_ += gotFrames;
    }
    const int64_t take = (frames - produced) < pendingFrames_ ? (frames - produced) : pendingFrames_;
    const unsigned char* src = raw_.data() + static_cast<size_t>(pendingOffset_) * static_cast<size_t>(bytesPerFrame);
    float* dst = out + produced * info_.channels;
    for (int64_t f = 0; f < take; f++) {
      for (int c = 0; c < info_.channels; c++) {
        dst[f * info_.channels + c] =
            decodePcmSample(src + static_cast<size_t>(f) * static_cast<size_t>(bytesPerFrame) +
                                static_cast<size_t>(c) * static_cast<size_t>(bytesPerSample),
                            bitDepth_, littleEndian, isFloat);
      }
    }
    produced += take;
    pendingOffset_ += take;
    pendingFrames_ -= take;
  }
  return produced;
}

bool AiffSource::seekToFrame(int64_t frame) {
  if (frame < 0) frame = 0;
  if (info_.frames >= 0 && frame > info_.frames) frame = info_.frames;
  nextFrame_ = frame;
  pendingFrames_ = 0;
  pendingOffset_ = 0;
  return true;
}

}  // namespace

const char* formatName(Format format) {
  switch (format) {
    case Format::Wav: return "wav";
    case Format::Mp3: return "mp3";
    case Format::Ogg: return "ogg";
    case Format::Flac: return "flac";
    case Format::M4a: return "m4a";
    case Format::Aiff: return "aiff";
    default: return "unknown";
  }
}

std::unique_ptr<Source> openSource(const std::string& path, std::string& error, SourceError* errorCode) {
  if (errorCode != nullptr) *errorCode = SourceError::None;
  Format format = sniffFormat(path);
  if (format == Format::Unknown) {
    error = "unrecognised media format (expected wav, mp3, ogg, flac, m4a or aiff)";
    if (errorCode != nullptr) *errorCode = SourceError::Unreadable;
    return nullptr;
  }

  std::unique_ptr<Source> source;
  switch (format) {
    case Format::Wav: {
      auto wav = std::make_unique<WavSource>();
      if (!wav->open(path, error)) return nullptr;
      source = std::move(wav);
      break;
    }
    case Format::Mp3: {
      auto mp3 = std::make_unique<Mp3Source>();
      if (!mp3->open(path, error)) return nullptr;
      source = std::move(mp3);
      break;
    }
    case Format::Flac: {
      auto flac = std::make_unique<FlacSource>();
      if (!flac->open(path, error)) return nullptr;
      source = std::move(flac);
      break;
    }
    case Format::Ogg: {
      auto vorbis = std::make_unique<VorbisSource>();
      if (!vorbis->open(path, error)) return nullptr;
      source = std::move(vorbis);
      break;
    }
    case Format::Aiff: {
      auto aiff = std::make_unique<AiffSource>();
      if (!aiff->open(path, error)) return nullptr;
      source = std::move(aiff);
      break;
    }
    case Format::M4a: {
      SourceError code = SourceError::None;
      source = openM4aSource(path, error, &code);
      if (!source) {
        if (errorCode != nullptr) *errorCode = code == SourceError::None ? SourceError::Unreadable : code;
        return nullptr;
      }
      break;
    }
    default:
      error = "unrecognised media format";
      return nullptr;
  }

  SourceInfo& info = source->info();
  info.fileBytes = fileSizeOf(path);
  if (info.sampleRate <= 0 || info.channels <= 0) {
    error = "media file reports an invalid sample rate or channel count";
    if (errorCode != nullptr) *errorCode = SourceError::Unreadable;
    return nullptr;
  }
  return source;
}

bool decodeWholeFile(const std::string& path, std::vector<float>& out, SourceInfo& info, std::string& error) {
  std::unique_ptr<Source> source = openSource(path, error);
  if (!source) return false;
  info = source->info();
  if (info.frames > 0) {
    out.reserve(static_cast<size_t>(info.frames) * static_cast<size_t>(info.channels));
  }
  std::vector<float> chunk(static_cast<size_t>(8192) * static_cast<size_t>(info.channels));
  for (;;) {
    const int64_t got = source->readFrames(chunk.data(), 8192);
    if (got <= 0) break;
    out.insert(out.end(), chunk.begin(), chunk.begin() + static_cast<size_t>(got) * static_cast<size_t>(info.channels));
    if (info.frames > 0 && static_cast<int64_t>(out.size() / static_cast<size_t>(info.channels)) >= info.frames) break;
  }
  const int64_t decodedFrames = info.channels > 0 ? static_cast<int64_t>(out.size() / static_cast<size_t>(info.channels)) : 0;
  if (decodedFrames <= 0) {
    error = "media file decoded to zero frames";
    return false;
  }
  if (info.frames < 0) info.frames = decodedFrames;
  return true;
}

}  // namespace ws
