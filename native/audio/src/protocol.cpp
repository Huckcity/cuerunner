#include "protocol.h"

#include "util.h"
#include "wsaudio.h"

#include <cstring>
#include <string>

#include "cJSON.h"

namespace ws {
namespace {

const cJSON* member(const cJSON* object, const char* name) { return cJSON_GetObjectItemCaseSensitive(object, name); }

bool hasNumber(const cJSON* object, const char* name) {
  const cJSON* item = member(object, name);
  return item != nullptr && cJSON_IsNumber(item);
}

double number(const cJSON* object, const char* name, double fallback) {
  const cJSON* item = member(object, name);
  return item != nullptr && cJSON_IsNumber(item) ? item->valuedouble : fallback;
}

int integer(const cJSON* object, const char* name, int fallback) {
  return static_cast<int>(number(object, name, fallback));
}

std::string text(const cJSON* object, const char* name, const char* fallback) {
  const cJSON* item = member(object, name);
  return item != nullptr && cJSON_IsString(item) ? std::string(item->valuestring) : std::string(fallback);
}

int curveFromName(const std::string& name) {
  if (name == "sCurve") return static_cast<int>(Curve::SCurve);
  if (name == "logarithmic") return static_cast<int>(Curve::Logarithmic);
  return static_cast<int>(Curve::Linear);
}

/**
 * The region a whole-file read is asked about: `startMs` and `endMs` together name a
 * window into the file, and neither leaves the read unbounded, which is the whole file.
 */
RegionQuery regionOf(const cJSON* root) {
  RegionQuery region;
  if (!hasNumber(root, "startMs") || !hasNumber(root, "endMs")) return region;
  region.bounded = true;
  region.startMs = number(root, "startMs", 0.0);
  region.endMs = number(root, "endMs", 0.0);
  return region;
}

int paramFromName(const std::string& name) {
  if (name == "pan") return static_cast<int>(Param::Pan);
  if (name == "trim") return static_cast<int>(Param::Trim);
  if (name == "rate") return static_cast<int>(Param::Rate);
  return static_cast<int>(Param::Volume);
}

const char* stateName(int state) {
  return voiceStateName(static_cast<VoiceState>(state));
}

// Parses the `outputs` field: absent/null is automatic routing, [] is silence, an
// array is the crosspoint matrix.
bool parseOutputs(const cJSON* options, StartOptions& out, bool& automatic, int& count,
                  Crosspoint* points, std::string& error) {
  const cJSON* outputs = member(options, "outputs");
  automatic = true;
  count = 0;
  if (outputs == nullptr || cJSON_IsNull(outputs)) return true;
  if (!cJSON_IsArray(outputs)) {
    error = "outputs must be null or an array of crosspoints";
    return false;
  }
  automatic = false;
  const int total = cJSON_GetArraySize(outputs);
  if (total > kMaxCrosspoints) {
    error = "too many crosspoints";
    return false;
  }
  for (int i = 0; i < total; i++) {
    const cJSON* item = cJSON_GetArrayItem(outputs, i);
    if (!cJSON_IsObject(item)) {
      error = "crosspoint must be an object";
      return false;
    }
    Crosspoint point;
    point.inputChannel = integer(item, "inputChannel", -1);
    point.outputChannel = integer(item, "outputChannel", -1);
    point.gain = number(item, "gain", 1.0);
    if (point.inputChannel < 0 || point.outputChannel < 0) {
      error = "crosspoint channels must be zero-based and non-negative";
      return false;
    }
    points[count++] = point;
  }
  out.crosspointCount = count;
  for (int i = 0; i < count; i++) out.crosspoints[i] = points[i];
  return true;
}

bool parseStartOptions(const cJSON* options, StartOptions& out, std::string& error) {
  if (options == nullptr || !cJSON_IsObject(options)) {
    error = "start needs an options object";
    return false;
  }
  out.startTimeMs = number(options, "startTime", 0.0);
  const cJSON* endTime = member(options, "endTime");
  out.endTimeMs = endTime == nullptr || cJSON_IsNull(endTime) ? -1.0 : number(options, "endTime", -1.0);
  out.loopCount = integer(options, "loopCount", 0);
  out.rate = number(options, "rate", 1.0);
  out.trim = number(options, "trim", 1.0);
  out.volume = number(options, "volume", 1.0);
  out.pan = number(options, "pan", 0.0);
  out.fadeInMs = number(options, "fadeInDuration", 0.0);
  bool automatic = true;
  int count = 0;
  Crosspoint points[kMaxCrosspoints];
  if (!parseOutputs(options, out, automatic, count, points, error)) return false;
  out.automatic = automatic;
  out.crosspointCount = count;
  return true;
}

std::string replyOk(int id, cJSON* result) {
  cJSON* root = cJSON_CreateObject();
  cJSON_AddNumberToObject(root, "id", id);
  cJSON_AddBoolToObject(root, "ok", 1);
  if (result != nullptr) {
    cJSON_AddItemToObject(root, "result", result);
  } else {
    cJSON_AddNullToObject(root, "result");
  }
  char* text = cJSON_PrintUnformatted(root);
  std::string out = text != nullptr ? std::string(text) : std::string("{\"id\":0,\"ok\":false}");
  cJSON_free(text);
  cJSON_Delete(root);
  return out;
}

std::string replyError(int id, const std::string& code, const std::string& message) {
  cJSON* root = cJSON_CreateObject();
  cJSON_AddNumberToObject(root, "id", id);
  cJSON_AddBoolToObject(root, "ok", 0);
  cJSON* error = cJSON_CreateObject();
  cJSON_AddStringToObject(error, "code", code.c_str());
  cJSON_AddStringToObject(error, "message", message.c_str());
  cJSON_AddItemToObject(root, "error", error);
  char* text = cJSON_PrintUnformatted(root);
  std::string out = text != nullptr ? std::string(text) : std::string("{\"id\":0,\"ok\":false}");
  cJSON_free(text);
  cJSON_Delete(root);
  return out;
}



cJSON* voiceToJson(const VoiceSnapshot& voice) {
  cJSON* object = cJSON_CreateObject();
  cJSON_AddStringToObject(object, "cueId", voice.cueId);
  cJSON_AddStringToObject(object, "runId", voice.runId);
  cJSON_AddStringToObject(object, "state", stateName(voice.state));
  cJSON_AddBoolToObject(object, "playing", voice.active);
  cJSON_AddNumberToObject(object, "elapsedMs", voice.elapsedMs);
  cJSON_AddNumberToObject(object, "durationMs", voice.durationMs);
  cJSON_AddNumberToObject(object, "fraction", voice.fraction);
  cJSON_AddNumberToObject(object, "runFraction", voice.runFraction);
  cJSON_AddNumberToObject(object, "startedAtMs", voice.startedAtMs);
  cJSON_AddNumberToObject(object, "loopsCompleted", voice.loopsCompleted);
  return object;
}

cJSON* infoToJson(const InfoDTO& info) {
  cJSON* object = cJSON_CreateObject();
  cJSON_AddStringToObject(object, "name", info.name.c_str());
  cJSON_AddStringToObject(object, "version", info.version.c_str());
  cJSON_AddNumberToObject(object, "protocol", info.protocol);
  cJSON_AddStringToObject(object, "sessionId", info.sessionId.c_str());
  cJSON_AddStringToObject(object, "backend", info.backend.c_str());
  if (info.deviceId.empty()) cJSON_AddNullToObject(object, "deviceId");
  else cJSON_AddStringToObject(object, "deviceId", info.deviceId.c_str());
  cJSON_AddStringToObject(object, "deviceName", info.deviceName.c_str());
  cJSON_AddNumberToObject(object, "sampleRate", info.sampleRate);
  cJSON_AddNumberToObject(object, "channels", info.channels);
  cJSON_AddStringToObject(object, "format", info.format.c_str());
  cJSON_AddBoolToObject(object, "exclusive", info.exclusive);
  if (info.bufferFrames < 0) cJSON_AddNullToObject(object, "bufferFrames");
  else cJSON_AddNumberToObject(object, "bufferFrames", info.bufferFrames);
  if (info.periodFrames < 0) cJSON_AddNullToObject(object, "periodFrames");
  else cJSON_AddNumberToObject(object, "periodFrames", info.periodFrames);
  if (info.latencyMs < 0.0) cJSON_AddNullToObject(object, "latencyMs");
  else cJSON_AddNumberToObject(object, "latencyMs", info.latencyMs);
  cJSON_AddStringToObject(object, "latencySource", info.latencySource.c_str());
  cJSON_AddBoolToObject(object, "active", info.active);
  cJSON_AddNumberToObject(object, "activeVoices", info.activeVoices);
  cJSON* cues = cJSON_AddArrayToObject(object, "activeCues");
  for (const VoiceSnapshot& voice : info.activeCues) cJSON_AddItemToArray(cues, voiceToJson(voice));

  cJSON* cache = cJSON_CreateObject();
  cJSON_AddNumberToObject(cache, "entries", info.cache.entries);
  cJSON_AddNumberToObject(cache, "bytes", static_cast<double>(info.cache.bytes));
  cJSON_AddNumberToObject(cache, "limitBytes", static_cast<double>(info.cache.limitBytes));
  cJSON_AddNumberToObject(cache, "maxFiles", info.cache.maxFiles);
  cJSON_AddNumberToObject(cache, "maxFileBytes", static_cast<double>(info.cache.maxFileBytes));
  cJSON_AddNumberToObject(cache, "hits", static_cast<double>(info.cache.hits));
  cJSON_AddNumberToObject(cache, "misses", static_cast<double>(info.cache.misses));
  cJSON_AddNumberToObject(cache, "evictions", static_cast<double>(info.cache.evictions));
  cJSON_AddNumberToObject(cache, "bypassed", static_cast<double>(info.cache.bypassed));
  cJSON_AddNumberToObject(cache, "pinnedEntries", info.cache.pinnedEntries);
  cJSON_AddNumberToObject(cache, "pinnedBytes", static_cast<double>(info.cache.pinnedBytes));
  cJSON_AddItemToObject(object, "cache", cache);

  cJSON* media = cJSON_CreateObject();
  cJSON_AddNumberToObject(media, "activeVoices", info.activeVoices);
  cJSON_AddNumberToObject(media, "streamingVoices", info.streamingVoices);
  cJSON_AddNumberToObject(media, "residentBytes", static_cast<double>(info.residentBytes));
  cJSON_AddNumberToObject(media, "streamBufferBytes", static_cast<double>(info.streamBufferBytes));
  cJSON_AddNumberToObject(media, "streamBufferLimitBytes", static_cast<double>(info.streamBufferLimitBytes));
  cJSON_AddNumberToObject(media, "decodeQueueDepth", static_cast<double>(info.decodeQueueDepth));
  cJSON_AddNumberToObject(media, "decodeUnderruns", static_cast<double>(info.decodeUnderruns));
  cJSON_AddNumberToObject(media, "xruns", static_cast<double>(info.xruns));
  cJSON_AddNumberToObject(media, "droppedFileChunks", static_cast<double>(info.droppedChunks));
  cJSON_AddItemToObject(object, "media", media);

  if (info.lastError.empty()) cJSON_AddNullToObject(object, "lastError");
  else cJSON_AddStringToObject(object, "lastError", info.lastError.c_str());
  cJSON* warnings = cJSON_AddArrayToObject(object, "warnings");
  for (const std::string& warning : info.warnings) {
    cJSON_AddItemToArray(warnings, cJSON_CreateString(warning.c_str()));
  }
  return object;
}

}  // namespace

std::string infoJson(const InfoDTO& info) {
  cJSON* object = infoToJson(info);
  char* text = cJSON_PrintUnformatted(object);
  std::string out = text != nullptr ? std::string(text) : std::string("{}");
  cJSON_free(text);
  cJSON_Delete(object);
  return out;
}

std::string eventLine(const Event& event, const std::string& sessionId) {
  if (event.kind == Event::Ack) return {};
  cJSON* root = cJSON_CreateObject();
  cJSON* body = cJSON_CreateObject();
  cJSON_AddStringToObject(body, "sessionId", sessionId.c_str());
  switch (event.kind) {
    case Event::Ended:
      cJSON_AddStringToObject(body, "type", "ended");
      cJSON_AddStringToObject(body, "cueId", event.cueId);
      cJSON_AddStringToObject(body, "runId", event.runId);
      cJSON_AddNumberToObject(body, "at", event.atMs);
      cJSON_AddStringToObject(body, "reason", endReasonName(static_cast<EndReason>(event.reason)));
      cJSON_AddNumberToObject(body, "loopsCompleted", event.loopsCompleted);
      break;
    case Event::Error:
      cJSON_AddStringToObject(body, "type", "error");
      cJSON_AddNumberToObject(body, "at", event.atMs);
      if (event.hasCue) cJSON_AddStringToObject(body, "cueId", event.cueId);
      else cJSON_AddNullToObject(body, "cueId");
      if (event.hasRun) cJSON_AddStringToObject(body, "runId", event.runId);
      else cJSON_AddNullToObject(body, "runId");
      cJSON_AddStringToObject(body, "code", event.code);
      cJSON_AddStringToObject(body, "message", event.message);
      break;
    case Event::Panic:
      cJSON_AddStringToObject(body, "type", "panic");
      cJSON_AddNumberToObject(body, "at", event.atMs);
      cJSON_AddNumberToObject(body, "fadeMs", event.fadeMs);
      break;
    case Event::State:
      cJSON_AddStringToObject(body, "type", "state");
      cJSON_AddNumberToObject(body, "at", event.atMs);
      cJSON_AddBoolToObject(body, "active", event.activeGlobal);
      if (event.hasCue) cJSON_AddStringToObject(body, "cueId", event.cueId);
      else cJSON_AddNullToObject(body, "cueId");
      if (event.hasRun) cJSON_AddStringToObject(body, "runId", event.runId);
      else cJSON_AddNullToObject(body, "runId");
      cJSON_AddBoolToObject(body, "playing", event.playing);
      if (event.state == static_cast<int>(VoiceState::Idle)) cJSON_AddNullToObject(body, "state");
      else cJSON_AddStringToObject(body, "state", stateName(event.state));
      break;
    default:
      break;
  }
  cJSON_AddItemToObject(root, "event", body);
  char* text = cJSON_PrintUnformatted(root);
  std::string out = text != nullptr ? std::string(text) : std::string();
  cJSON_free(text);
  cJSON_Delete(root);
  return out;
}

std::string requestVerb(const std::string& line) {
  cJSON* root = cJSON_Parse(line.c_str());
  if (root == nullptr) return std::string();
  const std::string verb = text(root, "verb", "");
  cJSON_Delete(root);
  return verb;
}

std::string handleRequestLine(Engine& engine, const std::string& line, bool& shutdown) {
  shutdown = false;
  cJSON* root = cJSON_Parse(line.c_str());
  if (root == nullptr) return replyError(0, "invalid", "request is not valid JSON");
  const int id = integer(root, "id", 0);
  const std::string verb = text(root, "verb", "");
  std::string out;

  if (verb == "prepare") {
    PrepareDTO result;
    EngineError error;
    if (engine.prepare(text(root, "cueId", ""), text(root, "filePath", ""), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddStringToObject(body, "cueId", result.cueId.c_str());
      cJSON_AddStringToObject(body, "filePath", result.filePath.c_str());
      cJSON_AddStringToObject(body, "format", result.format.c_str());
      cJSON_AddNumberToObject(body, "durationMs", result.durationMs);
      cJSON_AddNumberToObject(body, "sampleRate", result.sampleRate);
      cJSON_AddNumberToObject(body, "channels", result.channels);
      if (result.frames < 0) cJSON_AddNullToObject(body, "frames");
      else cJSON_AddNumberToObject(body, "frames", static_cast<double>(result.frames));
      cJSON_AddNumberToObject(body, "fileBytes", static_cast<double>(result.fileBytes));
      cJSON_AddBoolToObject(body, "streaming", result.streaming);
      cJSON_AddBoolToObject(body, "cacheHit", result.cacheHit);
      cJSON_AddNumberToObject(body, "decodedBytes", static_cast<double>(result.decodedBytes));
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "probe") {
    ProbeDTO result;
    EngineError error;
    if (engine.probe(text(root, "filePath", ""), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddStringToObject(body, "filePath", result.filePath.c_str());
      cJSON_AddStringToObject(body, "format", result.format.c_str());
      cJSON_AddNumberToObject(body, "durationMs", result.durationMs);
      cJSON_AddNumberToObject(body, "sampleRate", result.sampleRate);
      cJSON_AddNumberToObject(body, "channels", result.channels);
      if (result.frames < 0) cJSON_AddNullToObject(body, "frames");
      else cJSON_AddNumberToObject(body, "frames", static_cast<double>(result.frames));
      cJSON_AddNumberToObject(body, "fileBytes", static_cast<double>(result.fileBytes));
      if (result.decodedBytes < 0) cJSON_AddNullToObject(body, "decodedBytes");
      else cJSON_AddNumberToObject(body, "decodedBytes", static_cast<double>(result.decodedBytes));
      cJSON_AddBoolToObject(body, "streaming", result.streaming);
      cJSON_AddBoolToObject(body, "resident", result.resident);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "start") {
    const cJSON* optionsJson = member(root, "options");
    StartOptions options;
    std::string parseError;
    if (!parseStartOptions(optionsJson, options, parseError)) {
      out = replyError(id, "invalid", parseError);
    } else {
      StartResultDTO result;
      EngineError error;
      if (engine.startCue(text(root, "cueId", ""), number(root, "whenMs", 0.0), options, result, error)) {
        cJSON* body = cJSON_CreateObject();
        cJSON_AddStringToObject(body, "cueId", result.cueId.c_str());
        cJSON_AddStringToObject(body, "runId", result.runId.c_str());
        cJSON_AddStringToObject(body, "state", result.state.c_str());
        cJSON_AddNumberToObject(body, "startAtMs", result.startAtMs);
        out = replyOk(id, body);
      } else {
        out = replyError(id, error.code, error.message);
      }
    }
  } else if (verb == "stop") {
    CommandResultDTO result;
    EngineError error;
    const double whenMs = hasNumber(root, "whenMs") ? number(root, "whenMs", 0.0) : 0.0;
    if (engine.stopCue(text(root, "cueId", ""), number(root, "fadeMs", 0.0), whenMs, result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddBoolToObject(body, "applied", result.applied);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "stopAll") {
    CommandResultDTO result;
    EngineError error;
    if (engine.stopAll(number(root, "fadeMs", 0.0), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddBoolToObject(body, "applied", result.applied);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "seek") {
    SeekResultDTO result;
    EngineError error;
    const double whenMs = hasNumber(root, "whenMs") ? number(root, "whenMs", 0.0) : 0.0;
    if (engine.seekCue(text(root, "cueId", ""), number(root, "positionMs", 0.0), whenMs, result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddNumberToObject(body, "positionMs", result.positionMs);
      cJSON_AddStringToObject(body, "state", result.state.c_str());
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "release") {
    CommandResultDTO result;
    EngineError error;
    const double whenMs = hasNumber(root, "whenMs") ? number(root, "whenMs", 0.0) : 0.0;
    // `endMs`, when present, is a time in the file, not on the clock: it is where a cue
    // trimmed of its trailing silence stops hearing the file.
    const bool hasEnd = hasNumber(root, "endMs");
    if (engine.releaseCue(text(root, "cueId", ""), whenMs, hasEnd, number(root, "endMs", 0.0), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddBoolToObject(body, "applied", result.applied);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "cancel") {
    CancelResultDTO result;
    EngineError error;
    const double whenMs = hasNumber(root, "whenMs") ? number(root, "whenMs", 0.0) : 0.0;
    if (engine.cancelCue(text(root, "cueId", ""), whenMs, result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddNumberToObject(body, "canceled", result.canceled);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "fade") {
    CommandResultDTO result;
    EngineError error;
    const double whenMs = hasNumber(root, "whenMs") ? number(root, "whenMs", 0.0) : 0.0;
    const int param = paramFromName(text(root, "param", "volume"));
    const int curve = curveFromName(text(root, "curve", "linear"));
    if (engine.fadeCue(text(root, "cueId", ""), param, number(root, "value", 0.0), number(root, "durationMs", 0.0),
                       curve, whenMs, result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddBoolToObject(body, "applied", result.applied);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "routing") {
    CommandResultDTO result;
    EngineError error;
    std::vector<Crosspoint> points;
    bool automatic = true;
    const cJSON* outputs = member(root, "outputs");
    bool parseFailed = false;
    std::string parseError;
    if (outputs != nullptr && !cJSON_IsNull(outputs)) {
      StartOptions scratch;
      int count = 0;
      Crosspoint parsed[kMaxCrosspoints];
      if (!parseOutputs(root, scratch, automatic, count, parsed, parseError)) {
        parseFailed = true;
      } else {
        for (int i = 0; i < count; i++) points.push_back(parsed[i]);
      }
    }
    if (parseFailed) {
      out = replyError(id, "invalid", parseError);
    } else if (engine.routeCue(text(root, "cueId", ""), automatic, points, result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddBoolToObject(body, "applied", result.applied);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "progress") {
    VoiceSnapshot voice;
    bool found = false;
    engine.progress(text(root, "cueId", ""), voice, found);
    if (!found) {
      out = replyOk(id, nullptr);
    } else {
      out = replyOk(id, voiceToJson(voice));
    }
  } else if (verb == "panic") {
    PanicResultDTO result;
    EngineError error;
    if (engine.panic(number(root, "fadeMs", 0.0), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddBoolToObject(body, "ok", 1);
      cJSON_AddNumberToObject(body, "at", result.atMs);
      cJSON_AddNumberToObject(body, "stoppedVoices", result.stoppedVoices);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "clock") {
    cJSON* body = cJSON_CreateObject();
    cJSON_AddNumberToObject(body, "clockMs", engine.clockMs());
    cJSON_AddStringToObject(body, "sessionId", engine.sessionId().c_str());
    out = replyOk(id, body);
  } else if (verb == "info") {
    InfoDTO info = engine.info();
    out = replyOk(id, infoToJson(info));
  } else if (verb == "devices") {
    std::vector<DeviceDTO> list;
    EngineError error;
    if (engine.devices(list, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON* array = cJSON_AddArrayToObject(body, "devices");
      for (const DeviceDTO& device : list) {
        cJSON* item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "id", device.id.c_str());
        cJSON_AddStringToObject(item, "name", device.name.c_str());
        cJSON_AddBoolToObject(item, "isDefault", device.isDefault);
        cJSON_AddNumberToObject(item, "channels", device.channels);
        cJSON_AddNumberToObject(item, "defaultSampleRate", device.defaultSampleRate);
        cJSON_AddNumberToObject(item, "minSampleRate", device.minSampleRate);
        cJSON_AddNumberToObject(item, "maxSampleRate", device.maxSampleRate);
        cJSON* rates = cJSON_AddArrayToObject(item, "sampleRates");
        for (int rate : device.sampleRates) cJSON_AddItemToArray(rates, cJSON_CreateNumber(rate));
        cJSON* formats = cJSON_AddArrayToObject(item, "formats");
        for (const std::string& format : device.formats) {
          cJSON_AddItemToArray(formats, cJSON_CreateString(format.c_str()));
        }
        cJSON_AddBoolToObject(item, "exclusive", device.exclusive);
        cJSON_AddItemToArray(array, item);
      }
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "configure") {
    const cJSON* options = member(root, "options");
    DeviceRequest request;
    if (options != nullptr && cJSON_IsObject(options)) {
      const cJSON* deviceId = member(options, "deviceId");
      if (deviceId != nullptr && cJSON_IsString(deviceId)) {
        request.hasDeviceId = true;
        request.deviceId = deviceId->valuestring;
      } else if (deviceId != nullptr && cJSON_IsNull(deviceId)) {
        request.hasDeviceId = true;
        request.deviceId = "default";
      }
      if (hasNumber(options, "sampleRate")) {
        request.hasSampleRate = true;
        request.sampleRate = integer(options, "sampleRate", 0);
      }
      if (hasNumber(options, "channels")) {
        request.hasChannels = true;
        request.channels = integer(options, "channels", 0);
      }
      const cJSON* exclusive = member(options, "exclusive");
      if (exclusive != nullptr && cJSON_IsBool(exclusive)) {
        request.hasExclusive = true;
        request.exclusive = cJSON_IsTrue(exclusive) != 0;
      }
      if (hasNumber(options, "bufferFrames")) {
        request.hasBufferFrames = true;
        request.bufferFrames = integer(options, "bufferFrames", 0);
      }
    }
    EngineError error;
    if (engine.configureDevice(request, error)) {
      out = replyOk(id, infoToJson(engine.info()));
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "waveform") {
    WaveformDTO result;
    EngineError error;
    if (engine.waveform(text(root, "filePath", ""), integer(root, "points", 512), regionOf(root), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddStringToObject(body, "filePath", result.filePath.c_str());
      cJSON_AddNumberToObject(body, "buckets", result.buckets);
      cJSON* values = cJSON_AddArrayToObject(body, "values");
      for (float value : result.values) cJSON_AddItemToArray(values, cJSON_CreateNumber(value));
      cJSON_AddNumberToObject(body, "durationMs", result.durationMs);
      cJSON_AddNumberToObject(body, "sampleRate", result.sampleRate);
      cJSON_AddNumberToObject(body, "channels", result.channels);
      cJSON_AddBoolToObject(body, "truncated", result.truncated);
      cJSON_AddNumberToObject(body, "startMs", result.startMs);
      cJSON_AddNumberToObject(body, "endMs", result.endMs);
      cJSON_AddBoolToObject(body, "sampled", result.sampled);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "onsets") {
    OnsetDTO result;
    EngineError error;
    if (engine.onsets(text(root, "filePath", ""), number(root, "sensitivity", 1.0),
                      integer(root, "maxOnsets", 0), regionOf(root), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddStringToObject(body, "filePath", result.filePath.c_str());
      cJSON_AddNumberToObject(body, "durationMs", result.durationMs);
      cJSON_AddNumberToObject(body, "sampleRate", result.sampleRate);
      cJSON_AddNumberToObject(body, "channels", result.channels);
      cJSON_AddBoolToObject(body, "truncated", result.truncated);
      cJSON_AddNumberToObject(body, "startMs", result.startMs);
      cJSON_AddNumberToObject(body, "endMs", result.endMs);
      cJSON* onsets = cJSON_AddArrayToObject(body, "onsetsMs");
      for (double onset : result.onsetsMs) cJSON_AddItemToArray(onsets, cJSON_CreateNumber(onset));
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "silence") {
    SilenceDTO result;
    EngineError error;
    if (engine.silence(text(root, "filePath", ""), number(root, "thresholdDb", -60.0), result, error)) {
      cJSON* body = cJSON_CreateObject();
      cJSON_AddStringToObject(body, "filePath", result.filePath.c_str());
      cJSON_AddNumberToObject(body, "startMs", result.startMs);
      cJSON_AddNumberToObject(body, "endMs", result.endMs);
      cJSON_AddNumberToObject(body, "durationMs", result.durationMs);
      cJSON_AddNumberToObject(body, "sampleRate", result.sampleRate);
      cJSON_AddNumberToObject(body, "channels", result.channels);
      cJSON_AddBoolToObject(body, "silent", result.silent);
      out = replyOk(id, body);
    } else {
      out = replyError(id, error.code, error.message);
    }
  } else if (verb == "simulateDeviceNotification") {
    // Test hook for the device-loss classification: it runs the same code the backend
    // callback runs, and is refused whenever a real device is open, so it cannot be
    // mistaken for (or mask) a genuine device event.
    if (!engine.hasNoDevice()) {
      out = replyError(id, "invalid", "simulateDeviceNotification is only available with the silent/offline backend");
    } else {
      const std::string type = text(root, "type", "stopped");
      const cJSON* deliberateItem = member(root, "deliberate");
      const bool deliberate = deliberateItem != nullptr && cJSON_IsTrue(deliberateItem) != 0;
      int notificationType = 1;  // ma_device_notification_type_stopped
      if (type == "interruption_began") notificationType = 2;
      else if (type == "unlocked") notificationType = 3;
      else if (type != "stopped") {
        out = replyError(id, "invalid", "unknown notification type '" + type + "'");
        notificationType = -1;
      }
      if (notificationType >= 0) {
        engine.noteDeliberateStop(deliberate);
        engine.handleSimulatedNotification(notificationType);
        engine.noteDeliberateStop(false);
        cJSON* body = cJSON_CreateObject();
        cJSON_AddBoolToObject(body, "ok", 1);
        out = replyOk(id, body);
      }
    }
  } else if (verb == "shutdown") {
    shutdown = true;
    cJSON* body = cJSON_CreateObject();
    cJSON_AddBoolToObject(body, "ok", 1);
    out = replyOk(id, body);
  } else {
    out = replyError(id, "invalid", "unknown verb '" + verb + "'");
  }

  cJSON_Delete(root);
  return out;
}

}  // namespace ws
