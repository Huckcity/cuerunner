// Windows M4A/AAC decoding through Media Foundation. This is the OS's own decoder —
// no third-party code and no extra licence — and it is a real source reader: pulling
// samples is sequential and seekable, memory stays bounded, and the decode happens on
// whatever thread asks (never the audio callback).
#include "m4a_platform.h"

#if defined(_WIN32)

#include "source.h"
#include "util.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <propvarutil.h>
#include <shlwapi.h>

#include <cstring>
#include <vector>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "ole32.lib")

namespace ws {
namespace {

std::wstring wideFromUtf8(const std::string& text) {
  if (text.empty()) return {};
  const int length = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0);
  std::wstring wide(static_cast<size_t>(length), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), wide.data(), length);
  return wide;
}

bool ensureMediaFoundation(std::string& error) {
  static bool started = false;
  if (started) return true;
  const HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_LITE);
  if (FAILED(hr)) {
    error = "Media Foundation could not be initialised";
    return false;
  }
  started = true;
  return true;
}

class MediaFoundationSource final : public Source {
 public:
  ~MediaFoundationSource() override {
    if (reader_ != nullptr) reader_->Release();
  }

  bool open(const std::string& path, std::string& error) {
    if (!ensureMediaFoundation(error)) return false;
    IMFSourceReader* reader = nullptr;
    HRESULT hr = MFCreateSourceReaderFromURL(wideFromUtf8(path).c_str(), nullptr, &reader);
    if (FAILED(hr) || reader == nullptr) {
      error = "Media Foundation cannot open the file";
      return false;
    }
    reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE);
    reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE);

    IMFMediaType* outputType = nullptr;
    MFCreateMediaType(&outputType);
    outputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    outputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float);
    hr = reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, outputType);
    outputType->Release();
    if (FAILED(hr)) {
      reader->Release();
      error = "Media Foundation has no decoder for this audio stream";
      return false;
    }

    IMFMediaType* current = nullptr;
    if (SUCCEEDED(reader->GetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, &current)) && current != nullptr) {
      UINT32 channels = 0;
      UINT32 sampleRate = 0;
      current->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channels);
      current->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &sampleRate);
      current->Release();
      info_.channels = static_cast<int>(channels);
      info_.sampleRate = static_cast<int>(sampleRate);
    }
    if (info_.channels <= 0 || info_.sampleRate <= 0) {
      reader->Release();
      error = "Media Foundation reported an invalid stream format";
      return false;
    }

    PROPVARIANT duration;
    PropVariantInit(&duration);
    if (SUCCEEDED(reader->GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE, MF_PD_DURATION, &duration)) &&
        duration.vt == VT_UI8) {
      const int64_t hundredNs = static_cast<int64_t>(duration.uhVal.QuadPart);
      info_.frames = hundredNs * info_.sampleRate / 10000000;
    }
    PropVariantClear(&duration);

    reader_ = reader;
    info_.format = Format::M4a;
    info_.canSeek = true;
    return true;
  }

  SourceInfo& info() override { return info_; }

  int64_t readFrames(float* out, int64_t frames) override {
    if (reader_ == nullptr || exhausted_ || frames <= 0) return 0;
    const int channels = info_.channels;
    int64_t produced = 0;
    while (produced < frames) {
      const int64_t pendingFrames = static_cast<int64_t>((pending_.size() - pendingOffset_) / static_cast<size_t>(channels));
      if (pendingFrames > 0) {
        const int64_t take = std::min(frames - produced, pendingFrames);
        std::memcpy(out + produced * channels, pending_.data() + pendingOffset_, static_cast<size_t>(take) * static_cast<size_t>(channels) * sizeof(float));
        pendingOffset_ += static_cast<size_t>(take) * static_cast<size_t>(channels);
        produced += take;
        continue;
      }

      DWORD flags = 0;
      IMFSample* sample = nullptr;
      const HRESULT hr = reader_->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, nullptr, &flags, nullptr, &sample);
      if (FAILED(hr)) {
        exhausted_ = true;
        if (sample != nullptr) sample->Release();
        break;
      }
      if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0) {
        exhausted_ = true;
        if (sample != nullptr) sample->Release();
        break;
      }
      if (sample == nullptr) continue;

      IMFMediaBuffer* buffer = nullptr;
      if (SUCCEEDED(sample->ConvertToContiguousBuffer(&buffer)) && buffer != nullptr) {
        BYTE* data = nullptr;
        DWORD length = 0;
        if (SUCCEEDED(buffer->Lock(&data, nullptr, &length)) && data != nullptr) {
          const size_t samples = length / sizeof(float);
          pending_.resize(samples);
          std::memcpy(pending_.data(), data, samples * sizeof(float));
          pendingOffset_ = 0;
          buffer->Unlock();
        }
        buffer->Release();
      }
      sample->Release();
    }
    nextFrame_ += produced;
    return produced;
  }

  bool seekToFrame(int64_t frame) override {
    if (reader_ == nullptr) return false;
    if (frame < 0) frame = 0;
    PROPVARIANT position;
    PropVariantInit(&position);
    position.vt = VT_I8;
    position.hVal.QuadPart = frame * 10000000 / (info_.sampleRate > 0 ? info_.sampleRate : 1);
    const HRESULT hr = reader_->SetCurrentPosition(GUID_NULL, position);
    PropVariantClear(&position);
    if (FAILED(hr)) return false;
    pending_.clear();
    pendingOffset_ = 0;
    exhausted_ = false;
    nextFrame_ = frame;
    return true;
  }

 private:
  SourceInfo info_{};
  IMFSourceReader* reader_ = nullptr;
  std::vector<float> pending_;
  size_t pendingOffset_ = 0;
  int64_t nextFrame_ = 0;
  bool exhausted_ = false;
};

}  // namespace

std::unique_ptr<Source> openMediaFoundationSource(const std::string& path, std::string& error) {
  auto source = std::make_unique<MediaFoundationSource>();
  if (!source->open(path, error)) return nullptr;
  return source;
}

}  // namespace ws

#endif  // _WIN32
