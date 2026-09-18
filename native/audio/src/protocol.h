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

// The verb a request line names, or "" when the line is not a JSON request. The
// transport reads this to decide which requests may run off the connection's thread —
// which is a decision about the wire, not about the verb, so it is answered here rather
// than by every caller parsing the line a second time.
std::string requestVerb(const std::string& line);

// Serializes one engine event as a protocol line, tagged with the session that produced
// it. Returns an empty string for acknowledgements, which are internal to the engine.
std::string eventLine(const Event& event, const std::string& sessionId);

// The wire's declaration as JSON: `protocol`, every verb with the fields it reads
// (nested fields included), every event with the fields its type carries, and the bounds
// both ends share with their values and regimes. This is the native copy of
// src/shared/audio.ts's AUDIO_WIRE and AUDIO_LIMITS, carried as the data
// handleRequestLine validates and reads defaults from; the two are held to each other by
// src/main/audio/audioWire.test.ts, and this is what `--protocol` prints — of the
// protocol the process would declare, which `--declare-protocol` may have changed.
std::string wireDeclarationJson(int protocol);

// The line a connection is opened with, before any request is read: the protocol this
// engine declares, so a client can refuse a build it does not speak while the
// connection is still empty. `protocol` is the build's own, or a dev declaration of
// another one.
std::string greetingLine(int protocol);

// Whether the verb's declared fields carry `whenMs` — the verbs whose request is placed
// on the engine's clock rather than acted on at the block that reads it. Asked by the
// offline runner, which stamps a script's `atMs` onto them.
bool wireVerbTakesWhenMs(const std::string& verb);

// Serializes engine info, used by several verbs and by the offline summary.
std::string infoJson(const InfoDTO& info);

}  // namespace ws
