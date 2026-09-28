#include "protocol.h"

#include "util.h"
#include "wsaudio.h"

#include <cstdlib>
#include <cstring>
#include <string>

#include "cJSON.h"

namespace ws {
namespace {

const cJSON* member(const cJSON* object, const char* name) { return cJSON_GetObjectItemCaseSensitive(object, name); }

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

int paramFromName(const std::string& name) {
  if (name == "pan") return static_cast<int>(Param::Pan);
  if (name == "trim") return static_cast<int>(Param::Trim);
  if (name == "rate") return static_cast<int>(Param::Rate);
  return static_cast<int>(Param::Volume);
}

const char* stateName(int state) {
  return voiceStateName(static_cast<VoiceState>(state));
}

/**
 * The wire's declaration as native data: every verb with the fields its request carries,
 * each with its type, whether the verb can do what its name says without it, whether
 * `null` is a value of its own for it, and the default the engine takes when the field is
 * absent — plus, for an object or an array of them, the fields inside.
 *
 * This is the native copy of AUDIO_WIRE in src/shared/audio.ts, which the engine cannot
 * include. It is the one home of those defaults: the verb bodies read them through
 * `numberField`/`textField`/`booleanField` rather than repeating a literal beside the
 * table, handleRequestLine checks every present field against it, and `--protocol` prints
 * it; src/main/audio/audioWire.test.ts holds the two ends to each other.
 */
enum class WireFieldType { String, Number, Boolean, Object, Array };

struct WireField;

/** A set of declared fields: a verb's, an object's members, or an array's elements. */
struct WireFields {
  const WireField* fields = nullptr;
  size_t count = 0;
};

struct WireField {
  const char* name;
  WireFieldType type;
  bool required;
  /** A request may carry null for it, where null is a meaning of its own. */
  bool nullable;
  /**
   * The declared default in the field's own terms — a number's digits, a string's raw
   * text, "true"/"false" — or nullptr when the absent form is the null form, or when the
   * field is required. Read by the verb bodies and printed by `--protocol`.
   */
  const char* defaultValue;
  /** An object's members, or an array's elements; empty when the field has neither. */
  WireFields sub;
};

struct WireVerb {
  const char* name;
  WireFields declared;
};

/** The declared fields of an array, with their count taken from it. */
template <size_t N>
constexpr WireFields fieldsOf(const WireField (&fields)[N]) {
  return {fields, N};
}

// Shorthands for the table's entries. A field is either required, or it carries the value
// its absence takes — `wireNull` for the fields whose absent form is the null form (to the
// end of the file, automatic routing, a configure that leaves the device as it is).
constexpr WireField wireRequired(const char* name, WireFieldType type) {
  return {name, type, true, false, nullptr, {}};
}
constexpr WireField wireNumber(const char* name, const char* defaultValue) {
  return {name, WireFieldType::Number, false, false, defaultValue, {}};
}
constexpr WireField wireText(const char* name, const char* defaultValue) {
  return {name, WireFieldType::String, false, false, defaultValue, {}};
}
constexpr WireField wireFlag(const char* name, bool defaultValue) {
  return {name, WireFieldType::Boolean, false, false, defaultValue ? "true" : "false", {}};
}
constexpr WireField wireNull(const char* name, WireFieldType type, bool nullable) {
  return {name, type, false, nullable, nullptr, {}};
}
constexpr WireField wireRequiredObject(const char* name, WireFields sub) {
  return {name, WireFieldType::Object, true, false, nullptr, sub};
}
constexpr WireField wireOptionalObject(const char* name, WireFields sub) {
  return {name, WireFieldType::Object, false, true, nullptr, sub};
}
constexpr WireField wireOptionalElements(const char* name, WireFields sub) {
  return {name, WireFieldType::Array, false, true, nullptr, sub};
}

// One zero-based matrix connection, as `start.options.outputs` and `routing.outputs`
// carry it — the same declared shape in both, so the two cannot drift.
const WireField kCrosspointFields[] = {
    wireNumber("inputChannel", "-1"),
    wireNumber("outputChannel", "-1"),
    wireNumber("gain", "1"),
};

const WireField kStartOptionFields[] = {
    wireNumber("startTime", "0"),
    wireNull("endTime", WireFieldType::Number, true),
    wireNumber("loopCount", "0"),
    wireNumber("rate", "1"),
    wireNumber("trim", "1"),
    wireNumber("volume", "1"),
    wireNumber("pan", "0"),
    wireNumber("fadeInDuration", "0"),
    wireOptionalElements("outputs", fieldsOf(kCrosspointFields)),
};

const WireField kDeviceOptionFields[] = {
    wireNull("backend", WireFieldType::String, false),
    wireNull("deviceId", WireFieldType::String, true),
    wireNull("sampleRate", WireFieldType::Number, true),
    wireNull("channels", WireFieldType::Number, true),
    wireNull("exclusive", WireFieldType::Boolean, false),
    wireNull("bufferFrames", WireFieldType::Number, true),
};

const WireField kPrepareFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireRequired("filePath", WireFieldType::String),
};
const WireField kProbeFields[] = {
    wireRequired("filePath", WireFieldType::String),
};
const WireField kStartFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireNumber("whenMs", "0"),
    wireRequiredObject("options", fieldsOf(kStartOptionFields)),
};
const WireField kStopFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireNumber("fadeMs", "0"),
    wireNumber("whenMs", "0"),
};
const WireField kStopAllFields[] = {
    wireNumber("fadeMs", "0"),
};
const WireField kSeekFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireNumber("positionMs", "0"),
    wireNumber("whenMs", "0"),
};
const WireField kReleaseFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireNumber("whenMs", "0"),
    wireNull("endMs", WireFieldType::Number, true),
};
const WireField kCancelFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireNumber("whenMs", "0"),
};
const WireField kFadeFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireText("param", "volume"),
    wireNumber("value", "0"),
    wireNumber("durationMs", "0"),
    wireText("curve", "linear"),
    wireNumber("whenMs", "0"),
};
const WireField kRoutingFields[] = {
    wireRequired("cueId", WireFieldType::String),
    wireOptionalElements("outputs", fieldsOf(kCrosspointFields)),
};
const WireField kProgressFields[] = {
    wireRequired("cueId", WireFieldType::String),
};
const WireField kPanicFields[] = {
    wireNumber("fadeMs", "0"),
};
const WireField kConfigureFields[] = {
    wireOptionalObject("options", fieldsOf(kDeviceOptionFields)),
};
const WireField kWaveformFields[] = {
    wireRequired("filePath", WireFieldType::String),
    wireNumber("points", "512"),
    wireNull("startMs", WireFieldType::Number, false),
    wireNull("endMs", WireFieldType::Number, false),
};
const WireField kOnsetsFields[] = {
    wireRequired("filePath", WireFieldType::String),
    wireNumber("sensitivity", "1"),
    wireNumber("maxOnsets", "0"),
    wireNull("startMs", WireFieldType::Number, false),
    wireNull("endMs", WireFieldType::Number, false),
};
const WireField kSilenceFields[] = {
    wireRequired("filePath", WireFieldType::String),
    wireNumber("thresholdDb", "-60"),
};
const WireField kSimulateDeviceNotificationFields[] = {
    wireRequired("type", WireFieldType::String),
    wireFlag("deliberate", false),
};

// The dispatch chain below answers the same set, verb for verb and in the same order; it
// is the table that decides what a request must carry, what an absent field means and what
// `--protocol` prints.
const WireVerb kWireVerbs[] = {
    {"prepare", fieldsOf(kPrepareFields)},
    {"probe", fieldsOf(kProbeFields)},
    {"start", fieldsOf(kStartFields)},
    {"stop", fieldsOf(kStopFields)},
    {"stopAll", fieldsOf(kStopAllFields)},
    {"seek", fieldsOf(kSeekFields)},
    {"release", fieldsOf(kReleaseFields)},
    {"cancel", fieldsOf(kCancelFields)},
    {"fade", fieldsOf(kFadeFields)},
    {"routing", fieldsOf(kRoutingFields)},
    {"progress", fieldsOf(kProgressFields)},
    {"panic", fieldsOf(kPanicFields)},
    {"clock", {}},
    {"info", {}},
    {"devices", {}},
    {"configure", fieldsOf(kConfigureFields)},
    {"waveform", fieldsOf(kWaveformFields)},
    {"onsets", fieldsOf(kOnsetsFields)},
    {"silence", fieldsOf(kSilenceFields)},
    {"simulateDeviceNotification", fieldsOf(kSimulateDeviceNotificationFields)},
    {"shutdown", {}},
};

constexpr size_t kWireVerbCount = sizeof(kWireVerbs) / sizeof(kWireVerbs[0]);

/**
 * The wire's event set as native data: every event type `eventLine()` writes, and the
 * top-level fields it writes for that type. This is the native copy of
 * `AUDIO_WIRE.events` in src/shared/audio.ts, which the engine cannot include; it is what
 * `--protocol` prints beside the verbs, and src/main/audio/audioWire.test.ts holds the two
 * ends to each other.
 */
struct WireEventField {
  const char* name;
  WireFieldType type;
  /** A null is a meaning of its own for this field — an `error`'s ids, a `state`'s voice. */
  bool nullable;
};

struct WireEvent {
  const char* name;
  const WireEventField* fields;
  size_t count;
};

template <size_t N>
constexpr WireEvent wireEvent(const char* name, const WireEventField (&fields)[N]) {
  return {name, fields, N};
}

const WireEventField kEndedEventFields[] = {
    {"type", WireFieldType::String, false},
    {"cueId", WireFieldType::String, false},
    {"runId", WireFieldType::String, false},
    {"at", WireFieldType::Number, false},
    {"reason", WireFieldType::String, false},
    {"loopsCompleted", WireFieldType::Number, false},
    {"sessionId", WireFieldType::String, false}};
const WireEventField kErrorEventFields[] = {
    {"type", WireFieldType::String, false},
    {"at", WireFieldType::Number, false},
    // The fault belongs to the engine rather than to one cue: null is the meaning here.
    {"cueId", WireFieldType::String, true},
    {"runId", WireFieldType::String, true},
    {"code", WireFieldType::String, false},
    {"message", WireFieldType::String, false},
    {"sessionId", WireFieldType::String, false}};
const WireEventField kPanicEventFields[] = {
    {"type", WireFieldType::String, false},
    {"at", WireFieldType::Number, false},
    {"fadeMs", WireFieldType::Number, false},
    {"sessionId", WireFieldType::String, false}};
const WireEventField kStateEventFields[] = {
    {"type", WireFieldType::String, false},
    {"at", WireFieldType::Number, false},
    {"active", WireFieldType::Boolean, false},
    {"cueId", WireFieldType::String, true},
    {"runId", WireFieldType::String, true},
    {"playing", WireFieldType::Boolean, false},
    {"state", WireFieldType::String, true},
    {"sessionId", WireFieldType::String, false}};

const WireEvent kWireEvents[] = {
    wireEvent("ended", kEndedEventFields),
    wireEvent("error", kErrorEventFields),
    wireEvent("panic", kPanicEventFields),
    wireEvent("state", kStateEventFields),
};

constexpr size_t kWireEventCount = sizeof(kWireEvents) / sizeof(kWireEvents[0]);

const char* wireTypeName(WireFieldType type) {
  switch (type) {
    case WireFieldType::String:
      return "string";
    case WireFieldType::Number:
      return "number";
    case WireFieldType::Boolean:
      return "boolean";
    case WireFieldType::Object:
      return "object";
    case WireFieldType::Array:
      return "array";
  }
  return "value";
}

const char* wireTypeArticle(WireFieldType type) {
  return type == WireFieldType::Object || type == WireFieldType::Array ? "an" : "a";
}

bool wireValueMatches(WireFieldType type, const cJSON* value) {
  switch (type) {
    case WireFieldType::String:
      return cJSON_IsString(value) != 0;
    case WireFieldType::Number:
      return cJSON_IsNumber(value) != 0;
    case WireFieldType::Boolean:
      return cJSON_IsBool(value) != 0;
    case WireFieldType::Object:
      return cJSON_IsObject(value) != 0;
    case WireFieldType::Array:
      return cJSON_IsArray(value) != 0;
  }
  return false;
}

const WireVerb* wireVerbEntry(const std::string& verb) {
  for (size_t i = 0; i < kWireVerbCount; i++) {
    if (verb == kWireVerbs[i].name) return &kWireVerbs[i];
  }
  return nullptr;
}

/** The answer for a name the declaration does not carry: a field with no value, so a
 *  body that read one is reported rather than handed a literal of its own. */
const WireField& undeclaredField() {
  static const WireField kUndeclared = {nullptr, WireFieldType::Number, true, false, nullptr, {}};
  return kUndeclared;
}

const WireField& findField(const WireFields& scope, const char* name) {
  for (size_t i = 0; i < scope.count; i++) {
    if (std::strcmp(scope.fields[i].name, name) == 0) return scope.fields[i];
  }
  return undeclaredField();
}

/**
 * The declared field `name` of `verb`. A body that reads a name the declaration does not
 * carry would otherwise fall back to a literal of its own — the drift this table ends —
 * so the miss is reported and the request carries on with no value.
 */
const WireField& wireField(const std::string& verb, const char* name) {
  const WireVerb* entry = wireVerbEntry(verb);
  if (entry == nullptr) {
    logError("the wire declaration does not carry verb '%s'", verb.c_str());
    return undeclaredField();
  }
  const WireField& field = findField(entry->declared, name);
  if (field.name == nullptr) logError("the wire declaration does not carry %s.%s", verb.c_str(), name);
  return field;
}

/** The declared sub-field `name` of an object-typed (or array-elements) field. */
const WireField& subField(const WireField& owner, const char* name) {
  const WireField& field = findField(owner.sub, name);
  if (field.name == nullptr) logError("the wire declaration does not carry '%s'", name);
  return field;
}

/**
 * The number a request carries for a declared field, or the declared default. A field
 * whose absent form is the null form has no number to return: the body asks
 * `fieldHasValue` first, and one that does not is reported rather than defaulted.
 */
double numberField(const cJSON* owner, const WireField& field) {
  const cJSON* item = member(owner, field.name);
  if (item != nullptr && cJSON_IsNumber(item)) return item->valuedouble;
  if (field.defaultValue == nullptr) {
    if (!field.required) logError("the wire declaration gives '%s' no number to fall back on", field.name);
    return 0.0;
  }
  return std::strtod(field.defaultValue, nullptr);
}

/** The text a request carries for a declared field, or the declared default. */
std::string textField(const cJSON* owner, const WireField& field) {
  const cJSON* item = member(owner, field.name);
  if (item != nullptr && cJSON_IsString(item)) return std::string(item->valuestring);
  if (field.defaultValue == nullptr) {
    if (!field.required) logError("the wire declaration gives '%s' no text to fall back on", field.name);
    return std::string();
  }
  return std::string(field.defaultValue);
}

/** The flag a request carries for a declared field, or the declared default. */
bool booleanField(const cJSON* owner, const WireField& field) {
  const cJSON* item = member(owner, field.name);
  if (item != nullptr && cJSON_IsBool(item)) return cJSON_IsTrue(item) != 0;
  if (field.defaultValue == nullptr) {
    if (!field.required) logError("the wire declaration gives '%s' no flag to fall back on", field.name);
    return false;
  }
  return std::strcmp(field.defaultValue, "true") == 0;
}

/** True when the request names the field at all, null included. */
bool fieldPresent(const cJSON* owner, const WireField& field) { return member(owner, field.name) != nullptr; }

/** True when the request carries the field with a value: absent and an explicit null both
 *  mean the field's declared null form. */
bool fieldHasValue(const cJSON* owner, const WireField& field) {
  const cJSON* item = member(owner, field.name);
  return item != nullptr && !cJSON_IsNull(item);
}

std::string fieldsError(const WireFields& scope, const cJSON* owner, const std::string& path);

/**
 * The first thing wrong with one present value against its declaration — the wrong type,
 * null where the declaration does not allow it, or the same inside an object's members or
 * an array's elements — as the message the reply names it with, or "" when it matches.
 * `path` is the field's name on that message ("options.sampleRate", "outputs[0].gain").
 */
std::string valueError(const WireField& field, const cJSON* value, const std::string& path) {
  if (cJSON_IsNull(value)) {
    if (field.nullable) return std::string();
    return "'" + path + "' must be " + wireTypeArticle(field.type) + " " + wireTypeName(field.type);
  }
  if (!wireValueMatches(field.type, value)) {
    return "'" + path + "' must be " + wireTypeArticle(field.type) + " " + wireTypeName(field.type);
  }
  if (field.sub.count == 0) return std::string();
  if (field.type == WireFieldType::Object) return fieldsError(field.sub, value, path + ".");
  const int total = cJSON_GetArraySize(value);
  for (int i = 0; i < total; i++) {
    const cJSON* item = cJSON_GetArrayItem(value, i);
    const std::string itemPath = path + "[" + std::to_string(i) + "]";
    if (!cJSON_IsObject(item)) return "'" + itemPath + "' must be an object";
    const std::string error = fieldsError(field.sub, item, itemPath + ".");
    if (!error.empty()) return error;
  }
  return std::string();
}

std::string fieldsError(const WireFields& scope, const cJSON* owner, const std::string& path) {
  for (size_t i = 0; i < scope.count; i++) {
    const WireField& field = scope.fields[i];
    const cJSON* value = member(owner, field.name);
    if (value == nullptr) {
      if (field.required) return "missing required field '" + path + field.name + "'";
      continue;
    }
    const std::string error = valueError(field, value, path + field.name);
    if (!error.empty()) return error;
  }
  return std::string();
}

/**
 * The declaration's answer to a request: the first required field it is missing, or the
 * first present field that does not carry its declared type, as the message the reply
 * names it with — "" when the request carries what its verb declares. An unknown verb is
 * left to the dispatch chain, which names it with `unknown verb`.
 */
std::string requiredFieldError(const std::string& verb, const cJSON* root) {
  const WireVerb* entry = wireVerbEntry(verb);
  if (entry == nullptr) return std::string();
  return fieldsError(entry->declared, root, "");
}

/** One field of the declaration as JSON, nested fields included. */
std::string wireFieldJson(const WireField& field) {
  std::string out = "{\"type\":\"";
  out += wireTypeName(field.type);
  out += "\",\"required\":";
  out += field.required ? "true" : "false";
  if (field.nullable) out += ",\"nullable\":true";
  if (!field.required) {
    out += ",\"default\":";
    if (field.defaultValue == nullptr) out += "null";
    else if (field.type == WireFieldType::String) out += "\"" + jsonEscape(field.defaultValue) + "\"";
    else out += field.defaultValue;
  }
  if (field.sub.count > 0) {
    out += ",\"fields\":{";
    for (size_t i = 0; i < field.sub.count; i++) {
      if (i > 0) out += ',';
      out += "\"";
      out += field.sub.fields[i].name;
      out += "\":";
      out += wireFieldJson(field.sub.fields[i]);
    }
    out += "}";
  }
  out += '}';
  return out;
}

/**
 * The region a whole-file read is asked about: `startMs` and `endMs` together name a
 * window into the file, and neither leaves the read unbounded, which is the whole file.
 */
RegionQuery regionOf(const cJSON* root, const WireField& startMs, const WireField& endMs) {
  RegionQuery region;
  if (!fieldHasValue(root, startMs) || !fieldHasValue(root, endMs)) return region;
  region.bounded = true;
  region.startMs = numberField(root, startMs);
  region.endMs = numberField(root, endMs);
  return region;
}

// Parses the `outputs` field of the declaration it is handed: absent/null is automatic
// routing, [] is silence, an array is the crosspoint matrix. The declaration has already
// refused anything else, so this reads the values it declared.
bool parseOutputs(const cJSON* owner, const WireField& declared, StartOptions& out, bool& automatic, int& count,
                  Crosspoint* points, std::string& error) {
  const cJSON* outputs = member(owner, declared.name);
  automatic = true;
  count = 0;
  if (outputs == nullptr || cJSON_IsNull(outputs)) return true;
  automatic = false;
  const int total = cJSON_GetArraySize(outputs);
  if (total > kMaxCrosspoints) {
    error = "too many crosspoints";
    return false;
  }
  const WireField& inputChannel = subField(declared, "inputChannel");
  const WireField& outputChannel = subField(declared, "outputChannel");
  const WireField& gain = subField(declared, "gain");
  for (int i = 0; i < total; i++) {
    const cJSON* item = cJSON_GetArrayItem(outputs, i);
    Crosspoint point;
    point.inputChannel = static_cast<int>(numberField(item, inputChannel));
    point.outputChannel = static_cast<int>(numberField(item, outputChannel));
    point.gain = numberField(item, gain);
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

// Reads the options a `start` carries from the declaration: the declaration has already
// refused a missing or mistyped one, so every value here is the request's or the table's.
bool parseStartOptions(const cJSON* options, const WireField& declared, StartOptions& out, std::string& error) {
  const WireField& endTime = subField(declared, "endTime");
  out.startTimeMs = numberField(options, subField(declared, "startTime"));
  out.endTimeMs = fieldHasValue(options, endTime) ? numberField(options, endTime) : -1.0;
  out.loopCount = static_cast<int>(numberField(options, subField(declared, "loopCount")));
  out.rate = numberField(options, subField(declared, "rate"));
  out.trim = numberField(options, subField(declared, "trim"));
  out.volume = numberField(options, subField(declared, "volume"));
  out.pan = numberField(options, subField(declared, "pan"));
  out.fadeInMs = numberField(options, subField(declared, "fadeInDuration"));
  bool automatic = true;
  int count = 0;
  Crosspoint points[kMaxCrosspoints];
  if (!parseOutputs(options, subField(declared, "outputs"), out, automatic, count, points, error)) return false;
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
  // The achieved streaming ring, so a caller sees what the per-voice bound bought
  // rather than assuming the configured pre-roll; 0 for a cache-backed voice.
  cJSON_AddNumberToObject(object, "streamBytes", static_cast<double>(voice.streamBytes));
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

/** The regime as the declaration names it in `--protocol` and in `AUDIO_LIMITS`. */
const char* limitRegimeName(LimitRegime regime) {
  return regime == LimitRegime::Refuse ? "refuse" : "clamp-and-report";
}

/**
 * The declared bounds as JSON: one entry per bound, its value and its regime — the
 * native copy of `AUDIO_LIMITS` in src/shared/audio.ts, printed beside the verbs so
 * src/main/audio/audioWire.test.ts can hold the two ends equal.
 */
std::string limitsJson() {
  std::string out = "{";
  for (size_t i = 0; i < kLimitCount; i++) {
    if (i > 0) out += ',';
    out += '"';
    out += kLimits[i].name;
    out += "\":{\"value\":";
    out += std::to_string(kLimits[i].value);
    out += ",\"regime\":\"";
    out += limitRegimeName(kLimits[i].regime);
    out += "\"}";
  }
  out += '}';
  return out;
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

std::string wireDeclarationJson() {
  std::string out = "{\"protocol\":" + std::to_string(kWireProtocolVersion) + ",\"verbs\":{";
  for (size_t i = 0; i < kWireVerbCount; i++) {
    const WireVerb& verb = kWireVerbs[i];
    if (i > 0) out += ',';
    out += '"';
    out += verb.name;
    out += "\":{";
    for (size_t j = 0; j < verb.declared.count; j++) {
      const WireField& field = verb.declared.fields[j];
      if (j > 0) out += ',';
      out += '"';
      out += field.name;
      out += "\":";
      out += wireFieldJson(field);
    }
    out += '}';
  }
  out += "},\"events\":{";
  for (size_t i = 0; i < kWireEventCount; i++) {
    const WireEvent& event = kWireEvents[i];
    if (i > 0) out += ',';
    out += '"';
    out += event.name;
    out += "\":{";
    for (size_t j = 0; j < event.count; j++) {
      const WireEventField& field = event.fields[j];
      if (j > 0) out += ',';
      out += '"';
      out += field.name;
      out += "\":{\"type\":\"";
      out += wireTypeName(field.type);
      out += '"';
      if (field.nullable) out += ",\"nullable\":true";
      out += '}';
    }
    out += '}';
  }
  out += "},\"limits\":";
  out += limitsJson();
  out += '}';
  return out;
}

std::string greetingLine(int protocol) {
  return std::string("{\"greeting\":true,\"name\":\"cuerunner-audio\",\"version\":\"") + kEngineVersion +
         "\",\"protocol\":" + std::to_string(protocol) + "}";
}

bool wireVerbTakesWhenMs(const std::string& verb) {
  const WireVerb* entry = wireVerbEntry(verb);
  if (entry == nullptr) return false;
  for (size_t i = 0; i < entry->declared.count; i++) {
    if (std::strcmp(entry->declared.fields[i].name, "whenMs") == 0) return true;
  }
  return false;
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

  // The declaration decides what a request must carry, before any verb body reads it: a
  // required field that is missing or mistyped is an error that names it, never the
  // field's default. An unknown verb passes through to the chain below, which names it.
  const std::string fieldError = requiredFieldError(verb, root);
  if (!fieldError.empty()) {
    cJSON_Delete(root);
    return replyError(id, "invalid", fieldError);
  }

  // Every value a verb body reads comes from its declared field, so the default it falls
  // back to is the one the table carries — and prints — rather than a literal beside it.
  const auto declared = [&](const char* name) -> const WireField& { return wireField(verb, name); };
  const auto numberOf = [&](const char* name) { return numberField(root, wireField(verb, name)); };
  const auto textOf = [&](const char* name) { return textField(root, wireField(verb, name)); };
  const auto carries = [&](const char* name) { return fieldHasValue(root, wireField(verb, name)); };

  // `scheduleHorizonMs` is a bound that refuses, and it covers every verb whose declared
  // fields carry a `whenMs` — the stamped set the offline runner also reads, rather than
  // a list here. Checking it before the dispatch means no stamped verb can execute late
  // or be clamped silently, and a verb that gains a `whenMs` is covered the moment its
  // declaration does.
  if (wireVerbTakesWhenMs(verb)) {
    const double whenMs = numberOf("whenMs");
    const int64_t horizonMs = engine.scheduleHorizonMs();
    if (whenMs > engine.clockMs() + static_cast<double>(horizonMs)) {
      cJSON_Delete(root);
      return replyError(id, "limit",
                        verb + " is scheduled beyond the engine horizon (" + std::to_string(horizonMs) + " ms)");
    }
  }

  if (verb == "prepare") {
    PrepareDTO result;
    EngineError error;
    if (engine.prepare(textOf("cueId"), textOf("filePath"), result, error)) {
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
    if (engine.probe(textOf("filePath"), result, error)) {
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
    if (!parseStartOptions(optionsJson, declared("options"), options, parseError)) {
      out = replyError(id, "invalid", parseError);
    } else {
      StartResultDTO result;
      EngineError error;
      if (engine.startCue(textOf("cueId"), numberOf("whenMs"), options, result, error)) {
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
    if (engine.stopCue(textOf("cueId"), numberOf("fadeMs"), numberOf("whenMs"), result, error)) {
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
    if (engine.stopAll(numberOf("fadeMs"), result, error)) {
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
    if (engine.seekCue(textOf("cueId"), numberOf("positionMs"), numberOf("whenMs"), result, error)) {
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
    // `endMs`, when it carries a value, is a time in the file, not on the clock: it is
    // where a cue trimmed of its trailing silence stops hearing the file.
    if (engine.releaseCue(textOf("cueId"), numberOf("whenMs"), carries("endMs"), numberOf("endMs"), result, error)) {
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
    if (engine.cancelCue(textOf("cueId"), numberOf("whenMs"), result, error)) {
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
    const int param = paramFromName(textOf("param"));
    const int curve = curveFromName(textOf("curve"));
    if (engine.fadeCue(textOf("cueId"), param, numberOf("value"), numberOf("durationMs"), curve, numberOf("whenMs"),
                       result, error)) {
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
      if (!parseOutputs(root, declared("outputs"), scratch, automatic, count, parsed, parseError)) {
        parseFailed = true;
      } else {
        for (int i = 0; i < count; i++) points.push_back(parsed[i]);
      }
    }
    if (parseFailed) {
      out = replyError(id, "invalid", parseError);
    } else if (engine.routeCue(textOf("cueId"), automatic, points, result, error)) {
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
    engine.progress(textOf("cueId"), voice, found);
    if (!found) {
      out = replyOk(id, nullptr);
    } else {
      out = replyOk(id, voiceToJson(voice));
    }
  } else if (verb == "panic") {
    PanicResultDTO result;
    EngineError error;
    if (engine.panic(numberOf("fadeMs"), result, error)) {
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
    const WireField& optionsField = declared("options");
    const cJSON* options = member(root, optionsField.name);
    DeviceRequest request;
    if (options != nullptr && cJSON_IsObject(options)) {
      // `deviceId: null` asks for the system default; every other field's null (or
      // absence) means leave it as it is, which is the absence of the request field.
      const WireField& deviceId = subField(optionsField, "deviceId");
      if (fieldPresent(options, deviceId)) {
        request.hasDeviceId = true;
        request.deviceId = fieldHasValue(options, deviceId) ? textField(options, deviceId) : "default";
      }
      const WireField& sampleRate = subField(optionsField, "sampleRate");
      if (fieldHasValue(options, sampleRate)) {
        request.hasSampleRate = true;
        request.sampleRate = static_cast<int>(numberField(options, sampleRate));
      }
      const WireField& channels = subField(optionsField, "channels");
      if (fieldHasValue(options, channels)) {
        request.hasChannels = true;
        request.channels = static_cast<int>(numberField(options, channels));
      }
      const WireField& exclusive = subField(optionsField, "exclusive");
      if (fieldHasValue(options, exclusive)) {
        request.hasExclusive = true;
        request.exclusive = booleanField(options, exclusive);
      }
      const WireField& bufferFrames = subField(optionsField, "bufferFrames");
      if (fieldHasValue(options, bufferFrames)) {
        request.hasBufferFrames = true;
        request.bufferFrames = static_cast<int>(numberField(options, bufferFrames));
      }
      const WireField& backend = subField(optionsField, "backend");
      if (fieldHasValue(options, backend)) {
        request.hasBackend = true;
        request.backend = textField(options, backend);
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
    if (engine.waveform(textOf("filePath"), static_cast<int>(numberOf("points")),
                        regionOf(root, declared("startMs"), declared("endMs")), result, error)) {
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
    if (engine.onsets(textOf("filePath"), numberOf("sensitivity"), static_cast<int>(numberOf("maxOnsets")),
                      regionOf(root, declared("startMs"), declared("endMs")), result, error)) {
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
    if (engine.silence(textOf("filePath"), numberOf("thresholdDb"), result, error)) {
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
      const std::string type = textOf("type");
      const bool deliberate = booleanField(root, wireField(verb, "deliberate"));
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
