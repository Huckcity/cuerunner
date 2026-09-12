#include "wavwrite.h"

#include <cstring>

namespace ws {
namespace {

constexpr int kHeaderBytes = 44;

void putU32(unsigned char* out, uint32_t value) {
  out[0] = static_cast<unsigned char>(value & 0xFF);
  out[1] = static_cast<unsigned char>((value >> 8) & 0xFF);
  out[2] = static_cast<unsigned char>((value >> 16) & 0xFF);
  out[3] = static_cast<unsigned char>((value >> 24) & 0xFF);
}

void putU16(unsigned char* out, uint16_t value) {
  out[0] = static_cast<unsigned char>(value & 0xFF);
  out[1] = static_cast<unsigned char>((value >> 8) & 0xFF);
}

}  // namespace

bool WavWriter::open(const std::string& path, int sampleRate, int channels, std::string& error) {
  if (sampleRate <= 0 || channels <= 0 || channels > 64) {
    error = "invalid WAV format";
    return false;
  }
  file_ = std::fopen(path.c_str(), "wb+");
  if (file_ == nullptr) {
    error = "cannot create " + path;
    return false;
  }
  sampleRate_ = sampleRate;
  channels_ = channels;
  framesWritten_ = 0;

  unsigned char header[kHeaderBytes] = {};
  std::memcpy(header, "RIFF", 4);
  putU32(header + 4, 0xFFFFFFFFu);
  std::memcpy(header + 8, "WAVE", 4);
  std::memcpy(header + 12, "fmt ", 4);
  putU32(header + 16, 16);
  putU16(header + 20, 3);  // WAVE_FORMAT_IEEE_FLOAT
  putU16(header + 22, static_cast<uint16_t>(channels));
  putU32(header + 24, static_cast<uint32_t>(sampleRate));
  putU32(header + 28, static_cast<uint32_t>(sampleRate * channels * 4));
  putU16(header + 32, static_cast<uint16_t>(channels * 4));
  putU16(header + 34, 32);
  std::memcpy(header + 36, "data", 4);
  putU32(header + 40, 0xFFFFFFFFu);
  if (std::fwrite(header, 1, kHeaderBytes, file_) != kHeaderBytes) {
    std::fclose(file_);
    file_ = nullptr;
    error = "cannot write WAV header";
    return false;
  }
  return true;
}

bool WavWriter::writeFrames(const float* frames, int64_t count) {
  if (file_ == nullptr || count <= 0) return file_ != nullptr;
  const size_t bytes = static_cast<size_t>(count) * static_cast<size_t>(channels_) * sizeof(float);
  if (std::fwrite(frames, 1, bytes, file_) != bytes) return false;
  framesWritten_ += count;
  return true;
}

void WavWriter::patchHeader() {
  if (file_ == nullptr) return;
  const int64_t dataBytes = framesWritten_ * static_cast<int64_t>(channels_) * 4;
  if (dataBytes > 0xFFFFFF00LL) return;  // beyond RIFF's 4 GiB addressing
  unsigned char sizes[8];
  putU32(sizes, static_cast<uint32_t>(dataBytes + kHeaderBytes - 8));
  putU32(sizes + 4, static_cast<uint32_t>(dataBytes));
  const long current = std::ftell(file_);
  std::fseek(file_, 4, SEEK_SET);
  std::fwrite(sizes, 1, 4, file_);
  std::fseek(file_, 40, SEEK_SET);
  std::fwrite(sizes + 4, 1, 4, file_);
  std::fseek(file_, current, SEEK_SET);
}

void WavWriter::finalize() {
  if (file_ == nullptr) return;
  patchHeader();
  std::fflush(file_);
  std::fclose(file_);
  file_ = nullptr;
}

}  // namespace ws
