#pragma once

#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>

namespace ws {

// Engine diagnostics go to stderr: main captures them, the app never parses them.
void logLine(const char* fmt, ...);
void logError(const char* fmt, ...);

// Copies into a fixed char buffer with truncation, always NUL-terminated.
void copyStr(char* dst, size_t cap, const char* src);
void copyStr(char* dst, size_t cap, const std::string& src);

double steadyNowMs();

std::string jsonEscape(const std::string& in);

}  // namespace ws
