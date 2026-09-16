#include "util.h"

namespace ws {

void logLine(const char* fmt, ...) {
  std::fprintf(stderr, "[cuerunner-audio] ");
  va_list args;
  va_start(args, fmt);
  std::vfprintf(stderr, fmt, args);
  va_end(args);
  std::fprintf(stderr, "\n");
  std::fflush(stderr);
}

void logError(const char* fmt, ...) {
  std::fprintf(stderr, "[cuerunner-audio][error] ");
  va_list args;
  va_start(args, fmt);
  std::vfprintf(stderr, fmt, args);
  va_end(args);
  std::fprintf(stderr, "\n");
  std::fflush(stderr);
}

void copyStr(char* dst, size_t cap, const char* src) {
  if (cap == 0) return;
  if (src == nullptr) {
    dst[0] = '\0';
    return;
  }
  std::strncpy(dst, src, cap - 1);
  dst[cap - 1] = '\0';
}

void copyStr(char* dst, size_t cap, const std::string& src) { copyStr(dst, cap, src.c_str()); }

double steadyNowMs() {
  using clock = std::chrono::steady_clock;
  return std::chrono::duration<double, std::milli>(clock::now().time_since_epoch()).count();
}

std::string jsonEscape(const std::string& in) {
  std::string out;
  out.reserve(in.size() + 8);
  for (unsigned char c : in) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

}  // namespace ws
