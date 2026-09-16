// Cuerunner native audio engine — shared types.
//
// Everything the audio thread touches lives in fixed-size pods: voices, commands and
// events are all preallocated arrays with lock-free handoff between threads. Nothing
// on the audio path allocates, locks, opens a file or calls a process.
#pragma once

#include <atomic>
#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace ws {

inline constexpr const char* kEngineVersion = "1.0.0";

constexpr int kMaxVoices = 64;
constexpr int kMaxCrosspoints = 64;
constexpr int kMaxOutputChannels = 32;
constexpr int kMaxCueIdLen = 64;
constexpr int kMaxPathLen = 4096;
constexpr int kMaxRampParams = 4;
constexpr int kMaxPendingOps = 256;
constexpr int kMaxStreams = 16;
constexpr int kMaxRampsPerParam = 4;
constexpr int kMaxWaveformPoints = 4096;
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
};

// Snapshot of everything the mixer publishes each block, read under a seqlock so a
// reader never waits on the audio thread and never sees a torn record.
struct MixSnapshot {
  uint32_t seq = 0;
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
    Release = 10
  } kind = None;

  char cueId[kMaxCueIdLen] = {};
  char runId[32] = {};
  double whenMs = 0.0;
  double fadeMs = 0.0;
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
