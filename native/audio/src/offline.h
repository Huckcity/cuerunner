// Offline rendering: a deterministic CLI mode that drives the real mixer, scheduler,
// decoders and cache with a caller-owned clock, instead of a device. CI uses it to
// assert actual output samples, exact start/stop/fade indices and matrix routing.
#pragma once

#include "engine.h"

#include <string>

namespace ws {

struct OfflineOptions {
  std::string scriptPath;
  std::string outPath;
  std::string eventsPath;
  int64_t maxFrames = -1;  // safety cap when the script does not give one
};

// Renders the script to `outPath` and prints a JSON summary (including every event
// and every command result) to stdout. Returns 0 on success.
int runOfflineRender(EngineOptions engineOptions, const OfflineOptions& options);

}  // namespace ws
