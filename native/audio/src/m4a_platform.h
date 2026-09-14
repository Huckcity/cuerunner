// Platform AAC/M4A decoders. Declared here, implemented per platform:
//   m4a_windows.cpp  — Media Foundation source reader
//   m4a_macos.cpp    — AudioToolbox ExtAudioFile
// Linux (and any platform without one) falls back to the separately executed FFmpeg
// helper, which the app ships as an LGPL-only build.
#pragma once

#include <memory>
#include <string>

namespace ws {

class Source;

#if defined(_WIN32)
std::unique_ptr<Source> openMediaFoundationSource(const std::string& path, std::string& error);
#endif

#if defined(__APPLE__)
std::unique_ptr<Source> openAudioToolboxSource(const std::string& path, std::string& error);
#endif

}  // namespace ws
