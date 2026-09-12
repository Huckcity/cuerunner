// Minimal 32-bit float WAV writer. Used by the offline renderer and the live capture
// tee. While a capture is running the size fields stay at 0xFFFFFFFF so a reader can
// consume a file that is still being written; finalize() patches the real sizes.
#pragma once

#include <cstdint>
#include <cstdio>
#include <string>

namespace ws {

class WavWriter {
 public:
  bool open(const std::string& path, int sampleRate, int channels, std::string& error);
  bool writeFrames(const float* frames, int64_t count);
  // Rewrites the RIFF/data sizes in place. Safe while open.
  void patchHeader();
  void finalize();
  bool isOpen() const { return file_ != nullptr; }
  int64_t framesWritten() const { return framesWritten_; }
  int sampleRate() const { return sampleRate_; }
  int channels() const { return channels_; }

 private:
  std::FILE* file_ = nullptr;
  int sampleRate_ = 0;
  int channels_ = 0;
  int64_t framesWritten_ = 0;
};

}  // namespace ws
