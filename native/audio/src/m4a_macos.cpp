// macOS M4A/AAC (and anything else CoreAudio decodes) through AudioToolbox's
// ExtAudioFile. The OS codec, no third-party code, and a pull interface over a
// streaming read — the whole file never has to be resident.
#include "m4a_platform.h"

#if defined(__APPLE__)

#include "source.h"
#include "util.h"

#include <AudioToolbox/AudioToolbox.h>
#include <CoreFoundation/CoreFoundation.h>

#include <cstring>
#include <vector>

namespace ws {
namespace {

class AudioToolboxSource final : public Source {
 public:
  ~AudioToolboxSource() override {
    if (file_ != nullptr) ExtAudioFileDispose(file_);
  }

  bool open(const std::string& path, std::string& error) {
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(
        kCFAllocatorDefault, reinterpret_cast<const UInt8*>(path.c_str()), static_cast<CFIndex>(path.size()), false);
    if (url == nullptr) {
      error = "cannot resolve the media path";
      return false;
    }
    ExtAudioFileRef file = nullptr;
    OSStatus status = ExtAudioFileOpenURL(url, &file);
    CFRelease(url);
    if (status != noErr || file == nullptr) {
      error = "AudioToolbox cannot open the file (" + std::to_string(static_cast<int>(status)) + ")";
      return false;
    }

    AudioStreamBasicDescription fileFormat{};
    UInt32 size = sizeof(fileFormat);
    status = ExtAudioFileGetProperty(file, kExtAudioFileProperty_FileDataFormat, &size, &fileFormat);
    if (status != noErr || fileFormat.mChannelsPerFrame == 0) {
      ExtAudioFileDispose(file);
      error = "AudioToolbox reported an invalid stream format";
      return false;
    }

    AudioStreamBasicDescription client{};
    client.mSampleRate = fileFormat.mSampleRate;
    client.mFormatID = kAudioFormatLinearPCM;
    client.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    client.mChannelsPerFrame = fileFormat.mChannelsPerFrame;
    client.mBitsPerChannel = 32;
    client.mFramesPerPacket = 1;
    client.mBytesPerFrame = sizeof(float) * fileFormat.mChannelsPerFrame;
    client.mBytesPerPacket = client.mBytesPerFrame;
    status = ExtAudioFileSetProperty(file, kExtAudioFileProperty_ClientDataFormat, sizeof(client), &client);
    if (status != noErr) {
      ExtAudioFileDispose(file);
      error = "AudioToolbox cannot decode this stream to float PCM";
      return false;
    }

    SInt64 totalFrames = 0;
    size = sizeof(totalFrames);
    if (ExtAudioFileGetProperty(file, kExtAudioFileProperty_FileLengthFrames, &size, &totalFrames) == noErr &&
        totalFrames > 0) {
      info_.frames = static_cast<int64_t>(totalFrames);
    }

    file_ = file;
    info_.format = Format::M4a;
    info_.sampleRate = static_cast<int>(fileFormat.mSampleRate);
    info_.channels = static_cast<int>(fileFormat.mChannelsPerFrame);
    info_.canSeek = true;
    return true;
  }

  SourceInfo& info() override { return info_; }

  int64_t readFrames(float* out, int64_t frames) override {
    if (file_ == nullptr || frames <= 0) return 0;
    AudioBufferList bufferList{};
    bufferList.mNumberBuffers = 1;
    bufferList.mBuffers[0].mNumberChannels = static_cast<UInt32>(info_.channels);
    bufferList.mBuffers[0].mDataByteSize = static_cast<UInt32>(frames * info_.channels * sizeof(float));
    bufferList.mBuffers[0].mData = out;
    UInt32 wanted = static_cast<UInt32>(frames);
    const OSStatus status = ExtAudioFileRead(file_, &wanted, &bufferList);
    if (status != noErr) return 0;
    return static_cast<int64_t>(wanted);
  }

  bool seekToFrame(int64_t frame) override {
    if (file_ == nullptr) return false;
    if (frame < 0) frame = 0;
    return ExtAudioFileSeek(file_, static_cast<SInt64>(frame)) == noErr;
  }

 private:
  ExtAudioFileRef file_ = nullptr;
  SourceInfo info_{};
};

}  // namespace

std::unique_ptr<Source> openAudioToolboxSource(const std::string& path, std::string& error) {
  auto source = std::make_unique<AudioToolboxSource>();
  if (!source->open(path, error)) return nullptr;
  return source;
}

}  // namespace ws

#endif  // __APPLE__
