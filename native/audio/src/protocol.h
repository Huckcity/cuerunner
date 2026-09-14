// The wire protocol: one JSON object per line. Requests carry an id and a verb;
// replies carry the same id and either a result or an error; events are pushed
// unsolicited. Media never crosses this boundary — paths do.
#pragma once

#include "engine.h"

#include <string>

namespace ws {

// Handles one request line and returns the reply line. `shutdown` is set when the
// caller asked the process to exit.
std::string handleRequestLine(Engine& engine, const std::string& line, bool& shutdown);

// Serializes one engine event as a protocol line, tagged with the session that produced
// it. Returns an empty string for acknowledgements, which are internal to the engine.
std::string eventLine(const Event& event, const std::string& sessionId);

// Serializes engine info, used by several verbs and by the offline summary.
std::string infoJson(const InfoDTO& info);

}  // namespace ws
