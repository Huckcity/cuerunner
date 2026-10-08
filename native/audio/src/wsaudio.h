// Cuerunner native audio engine — shared types.
//
// Everything the audio thread touches lives in fixed-size pods: voices, commands and
// events are all preallocated arrays with lock-free handoff between threads. Nothing
// on the audio path allocates, locks, opens a file or calls a process.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <vector>

namespace ws {

inline constexpr const char* kEngineVersion = "1.0.0";

/**
 * The wire protocol this build speaks: the greeting it opens a connection with and the
 * `protocol` in `info()`. The verb set that goes with it is the table in protocol.cpp,
 * held against the declaration in src/shared/audio.ts by src/main/audio/audioWire.test.ts.
 * There is one copy of this number, in code, tests and docs: this one.
 */
inline constexpr int kWireProtocolVersion = 4;

/**
 * How a declared bound treats a request that asks past it. `Refuse` is a request that
 * does not happen, with an answer that says what refused it: the schedule horizon and
 * the streaming budget name the bound and its value, and the other refusals keep the
 * wire's existing wording (an over-bound matrix answers `invalid`, a start with no free
 * voice answers `limit` without naming one). `ClampAndReport` applies what it can and
 * publishes the achieved figure — `info()`'s device figures and cache/media counters, a
 * reply's `truncated`, a voice's `streamBytes`. The regime of each bound is the
 * declaration's, not a choice made at the site.
 */
enum class LimitRegime { Refuse, ClampAndReport };

/** The name each bound is declared under in `AUDIO_LIMITS` (src/shared/audio.ts). */
enum class LimitId : int {
  MaxVoices = 0,
  MaxCrosspoints,
  MaxOutputChannels,
  MaxWaveformPoints,
  ScheduleHorizonMs,
  CacheMaxBytes,
  CacheMaxFiles,
  CacheMaxFileBytes,
  StreamMaxBytesPerVoice,
  StreamMaxTotalBytes,
  Count
};

/** One bound both ends share: its declared name, value and regime. */
struct Limit {
  const char* name;
  int64_t value;
  LimitRegime regime;
};

/**
 * The declaration's bounds as native data: the native copy of `AUDIO_LIMITS` in
 * src/shared/audio.ts, which the engine cannot include. This is the one home of these
 * values on this side — the constants below, `EngineOptions`' defaults, every
 * enforcement site, the limit flags' help and the `limits` section of `--protocol` all
 * read it — and src/main/audio/audioWire.test.ts holds the two copies to each other, so
 * a name, value or regime edited at one end alone fails there.
 */
inline constexpr Limit kLimits[] = {
    {"maxVoices", 64, LimitRegime::Refuse},
    {"maxCrosspoints", 64, LimitRegime::Refuse},
    {"maxOutputChannels", 32, LimitRegime::ClampAndReport},
    {"maxWaveformPoints", 4096, LimitRegime::ClampAndReport},
    {"scheduleHorizonMs", 10000, LimitRegime::Refuse},
    {"cacheMaxBytes", 512LL * 1024 * 1024, LimitRegime::ClampAndReport},
    {"cacheMaxFiles", 100, LimitRegime::ClampAndReport},
    {"cacheMaxFileBytes", 32LL * 1024 * 1024, LimitRegime::ClampAndReport},
    {"streamMaxBytesPerVoice", 16LL * 1024 * 1024, LimitRegime::ClampAndReport},
    {"streamMaxTotalBytes", 128LL * 1024 * 1024, LimitRegime::Refuse},
};

inline constexpr size_t kLimitCount = static_cast<size_t>(LimitId::Count);
static_assert(sizeof(kLimits) / sizeof(kLimits[0]) == kLimitCount, "every declared bound has one table entry");

// An id addresses an entry by position, so the two tables are only in step if each id
// points at the entry carrying its own name: a reordered table alone would otherwise
// re-point every limitValue() while the count and the printed JSON still agreed with
// themselves — and the printed names would be unchanged, so the wire comparison would
// not catch it either.
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::MaxVoices)].name) == "maxVoices",
              "LimitId::MaxVoices must address the maxVoices entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::MaxCrosspoints)].name) == "maxCrosspoints",
              "LimitId::MaxCrosspoints must address the maxCrosspoints entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::MaxOutputChannels)].name) == "maxOutputChannels",
              "LimitId::MaxOutputChannels must address the maxOutputChannels entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::MaxWaveformPoints)].name) == "maxWaveformPoints",
              "LimitId::MaxWaveformPoints must address the maxWaveformPoints entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::ScheduleHorizonMs)].name) == "scheduleHorizonMs",
              "LimitId::ScheduleHorizonMs must address the scheduleHorizonMs entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::CacheMaxBytes)].name) == "cacheMaxBytes",
              "LimitId::CacheMaxBytes must address the cacheMaxBytes entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::CacheMaxFiles)].name) == "cacheMaxFiles",
              "LimitId::CacheMaxFiles must address the cacheMaxFiles entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::CacheMaxFileBytes)].name) == "cacheMaxFileBytes",
              "LimitId::CacheMaxFileBytes must address the cacheMaxFileBytes entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::StreamMaxBytesPerVoice)].name) == "streamMaxBytesPerVoice",
              "LimitId::StreamMaxBytesPerVoice must address the streamMaxBytesPerVoice entry");
static_assert(std::string_view(kLimits[static_cast<size_t>(LimitId::StreamMaxTotalBytes)].name) == "streamMaxTotalBytes",
              "LimitId::StreamMaxTotalBytes must address the streamMaxTotalBytes entry");

/** A bound's declared value: what a site enforces and a default carries unless moved. */
inline constexpr int64_t limitValue(LimitId id) { return kLimits[static_cast<size_t>(id)].value; }

// The fixed-size arrays below are sized from the declaration, so a bound moved there
// moves every array and refusal with it — and a declared bound the `int` these sizes
// take could not hold is a compile error rather than a truncated array.
static_assert(limitValue(LimitId::MaxVoices) > 0 && limitValue(LimitId::MaxVoices) <= std::numeric_limits<int>::max(),
              "the declared maxVoices must fit the int arrays sized from it");
static_assert(limitValue(LimitId::MaxCrosspoints) > 0 && limitValue(LimitId::MaxCrosspoints) <= std::numeric_limits<int>::max(),
              "the declared maxCrosspoints must fit the int arrays sized from it");
static_assert(limitValue(LimitId::MaxOutputChannels) > 0 && limitValue(LimitId::MaxOutputChannels) <= std::numeric_limits<int>::max(),
              "the declared maxOutputChannels must fit the int arrays sized from it");
static_assert(limitValue(LimitId::MaxWaveformPoints) > 0 && limitValue(LimitId::MaxWaveformPoints) <= std::numeric_limits<int>::max(),
              "the declared maxWaveformPoints must fit the int point count");

constexpr int kMaxVoices = static_cast<int>(limitValue(LimitId::MaxVoices));
constexpr int kMaxCrosspoints = static_cast<int>(limitValue(LimitId::MaxCrosspoints));
constexpr int kMaxOutputChannels = static_cast<int>(limitValue(LimitId::MaxOutputChannels));
constexpr int kMaxCueIdLen = 64;
constexpr int kMaxPathLen = 4096;
constexpr int kMaxRampParams = 4;
constexpr int kMaxStreams = 16;
constexpr int kMaxRampsPerParam = 4;
constexpr int kMaxWaveformPoints = static_cast<int>(limitValue(LimitId::MaxWaveformPoints));
constexpr int kMaxOnsets = 20000;

/**
 * The part of a file a whole-file read is asked about. Unbounded is the whole file; a
 * bounded query is a window into it, which is what a zoomed panel asks for and what
 * keeps a long file's reads proportional to what is on screen rather than to its length.
 */
struct RegionQuery {
  bool bounded = false;
  double startMs = 0.0;
  double endMs = 0.0;
};

/**
 * A scan's answer: where notes or hits begin in a media file.
 *
 * A time is the middle of the analysis frame that caught the attack — an onset is the
 * instant of the hit itself, and that is as close as a 1024-sample window gets to it.
 * Results of this shape are built on the command thread that asked for them and read
 * there — the audio callback never touches one.
 */
struct OnsetDTO {
  std::string filePath;
  std::vector<double> onsetsMs;  // ascending; the frame centre that caught each onset
  double durationMs = 0.0;
  int sampleRate = 0;
  int channels = 0;
  bool truncated = false;  // the scan hit the cap and stopped early
  // The part of the file this answer covers, in ms from its start: the whole file
  // unless the request named a region.
  double startMs = 0.0;
  double endMs = 0.0;
};

/**
 * A scan's answer: a file's audible extent, so a cue can play the part of it that has
 * sound in it rather than the silence at its edges.
 *
 * Both bounds are times in ms from the file's own start, which is what makes trimming
 * a region like any other. `startMs` is the first sample above the threshold and
 * `endMs` the far side of the last one — the whole length of the sample that was heard,
 * so a file whose last audible frame is N ends at (N + 1) samples' worth of ms.
 *
 * A file that never crosses the threshold is `silent`, and its bounds are the whole of
 * what the scan read rather than nothing at all: a quiet ambience has no silence at its
 * edges to trim, and a cue trimmed to no length at all would play nothing.
 */
struct SilenceDTO {
  std::string filePath;
  double startMs = 0.0;
  double endMs = 0.0;
  double durationMs = 0.0;  // the whole length of what the scan read
  int sampleRate = 0;
  int channels = 0;
  bool silent = false;
};

constexpr int kMaxOutputFrames = 4096;

enum class Curve : int { Linear = 0, SCurve = 1, Logarithmic = 2 };
enum class Param : int { Volume = 0, Pan = 1, Trim = 2, Rate = 3 };
enum class VoiceState : int { Idle = 0, Scheduled = 1, Playing = 2, Fading = 3, Stopped = 4 };
enum class EndReason : int { Complete = 0, Stopped = 1, Replaced = 2, Cancelled = 3, DeviceLost = 4, Error = 5 };

struct Crosspoint {
  int inputChannel = 0;
  int outputChannel = 0;
  float gain = 1.0f;
};

struct StartOptions {
  double startTimeMs = 0.0;
  double endTimeMs = -1.0;  // < 0 means "to the end of the file"
  int loopCount = 0;        // 0 = once, N = N repeats (N+1 plays), -1 = forever
  double rate = 1.0;
  double trim = 1.0;
  double volume = 1.0;
  double pan = 0.0;
  double fadeInMs = 0.0;
  bool automatic = true;  // outputs === null in the contract
  int crosspointCount = 0;
  Crosspoint crosspoints[kMaxCrosspoints] = {};
};

struct VoiceSnapshot {
  char cueId[kMaxCueIdLen] = {};
  char runId[32] = {};
  int state = static_cast<int>(VoiceState::Idle);
  double elapsedMs = 0.0;
  double durationMs = 0.0;
  double fraction = 0.0;
  double runFraction = 0.0;
  double startedAtMs = 0.0;
  int loopsCompleted = 0;
  bool active = false;
  /** The streaming ring this voice holds, in bytes; 0 for a cache-backed voice. */
  int64_t streamBytes = 0;
};

// Snapshot of everything the mixer publishes each block, carried by a SnapshotCell
// (snapshot_cell.h) so a reader never waits on the audio thread and never sees a torn
// record. It is copied as 8-byte words, so everything in it is trivially copyable.
struct MixSnapshot {
  double clockMs = 0.0;
  uint64_t renderedFrames = 0;
  int activeVoices = 0;
  int streamingVoices = 0;
  bool active = false;
  uint64_t underruns = 0;
  uint64_t xruns = 0;
  int voiceCount = 0;
  VoiceSnapshot voices[kMaxVoices] = {};
};

struct Event {
  enum Kind : int { Ended = 0, Error = 1, Panic = 2, State = 3, Ack = 4 } kind = Error;
  char cueId[kMaxCueIdLen] = {};
  bool hasCue = false;
  char runId[32] = {};
  bool hasRun = false;
  int reason = static_cast<int>(EndReason::Complete);
  int loopsCompleted = 0;
  char code[32] = {};
  char message[512] = {};
  double atMs = 0.0;
  double fadeMs = 0.0;
  bool activeGlobal = false;
  bool playing = false;
  int state = static_cast<int>(VoiceState::Idle);
  // Acknowledgements: a mutation verb's result is produced by the audio thread that
  // applied it, so the socket reply can be exact rather than a guess.
  uint64_t ackId = 0;
  bool ackApplied = false;
  int ackCanceled = 0;
  int ackVoices = 0;
  double ackPositionMs = 0.0;
};

// A command from a socket thread to the audio thread. Fixed size on purpose: the ring
// is preallocated, so scheduling can never allocate on the audio path.
struct Command {
  enum Kind : int {
    None = 0,
    Start = 1,
    Stop = 2,
    StopAll = 3,
    Seek = 4,
    Cancel = 5,
    Fade = 6,
    Routing = 7,
    Panic = 8,
    Shutdown = 9,
    Release = 10,
    // A hold on one voice where it stands, and the end of it: the voice keeps its place in
    // the file and every timed thing about it — a fade, a scheduled stop — waits with it.
    Pause = 11,
    Resume = 12
  } kind = None;

  char cueId[kMaxCueIdLen] = {};
  char runId[32] = {};
  double whenMs = 0.0;
  double fadeMs = 0.0;
  // A panic's end reason for the voices that were sounding: the caller's fact about why
  // it happened, because a device the engine lost and a PANIC the operator pressed are
  // not the same end. A voice that never started is `cancelled` whoever asked, since
  // there is nothing to fault in a voice that never made a sound.
  EndReason reason = EndReason::Stopped;
  double positionMs = 0.0;
  // A release's named end, in file ms: absent plays out to the end of the file.
  bool hasEndMs = false;
  double endMs = 0.0;
  Param param = Param::Volume;
  Curve curve = Curve::Linear;
  double value = 0.0;
  double durationMs = 0.0;
  StartOptions options;
  bool hasRouting = false;
  bool routingAutomatic = true;
  int routingCount = 0;
  Crosspoint routing[kMaxCrosspoints] = {};
  // Resources resolved on a command thread and handed over: a pinned CacheEntry
  // (stable address, never destroyed) or a StreamPool slot index. The audio thread
  // takes ownership of the pin/slot and reclaims it when the voice ends.
  void* cacheEntry = nullptr;
  int64_t cacheFrames = 0;
  int cacheChannels = 0;
  int cacheSampleRate = 0;
  int streamSlot = -1;
  bool hasSourceInfo = false;
  char filePath[kMaxPathLen] = {};
  uint64_t ackId = 0;
};

inline const char* voiceStateName(VoiceState s) {
  switch (s) {
    case VoiceState::Scheduled: return "scheduled";
    case VoiceState::Playing: return "playing";
    case VoiceState::Fading: return "fading";
    case VoiceState::Stopped: return "stopped";
    default: return "stopped";
  }
}

inline const char* endReasonName(EndReason r) {
  switch (r) {
    case EndReason::Stopped: return "stopped";
    case EndReason::Replaced: return "replaced";
    case EndReason::Cancelled: return "cancelled";
    case EndReason::DeviceLost: return "device-lost";
    case EndReason::Error: return "error";
    default: return "complete";
  }
}

inline bool isFadeParam(int value) { return value >= 0 && value < kMaxRampParams; }

}  // namespace ws
