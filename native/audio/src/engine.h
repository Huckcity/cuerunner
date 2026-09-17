// The engine owns everything: the device or offline clock, the mixer, the cache, the
// streaming pool and the socket-facing verbs. Socket threads submit commands and wait
// for the audio thread's acknowledgement; the audio thread only ever touches the
// preallocated mixer state.
#pragma once

#include "cache.h"
#include "capture.h"
#include "mixer.h"
#include "source.h"
#include "stream.h"
#include "wsaudio.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace ws {

struct EngineOptions {
  std::string backend = "auto";  // auto|wasapi|coreaudio|alsa|pulseaudio|jack|asio|silent|offline
  std::string deviceId;
  int sampleRate = 48000;
  int channels = 0;  // 0 = device default
  bool exclusive = false;
  int bufferFrames = 512;
  std::string capturePath;
  /**
   * The protocol this engine declares: the greeting it opens every connection with and
   * the `protocol` in `info()`. `--declare-protocol` sets another one, which is how the
   * app's refusal of a build it does not speak is exercised against a real process.
   */
  int declaredProtocol = kWireProtocolVersion;
  int64_t cacheMaxBytes = 512LL * 1024 * 1024;
  int cacheMaxFiles = 100;
  int64_t cacheMaxFileBytes = 32LL * 1024 * 1024;
  int64_t streamPrerollMs = 2000;
  int64_t streamMaxTotalBytes = 128LL * 1024 * 1024;
  int64_t streamMaxVoiceBytes = 16LL * 1024 * 1024;
  int64_t scheduleHorizonMs = 10000;
  bool offline = false;
};

struct EngineError {
  std::string code;
  std::string message;
};

struct DeviceDTO {
  std::string id;
  std::string name;
  bool isDefault = false;
  int channels = 0;
  int defaultSampleRate = 0;
  int minSampleRate = 0;
  int maxSampleRate = 0;
  std::vector<int> sampleRates;
  std::vector<std::string> formats;
  bool exclusive = false;
};

/** Metadata only: no decode, no cache entry, no counters. */
struct ProbeDTO {
  std::string filePath;
  std::string format;
  double durationMs = 0.0;
  int sampleRate = 0;
  int channels = 0;
  int64_t frames = -1;
  int64_t fileBytes = 0;
  int64_t decodedBytes = -1;  // -1 when the length is not stated
  bool streaming = false;
  bool resident = false;
};

struct PrepareDTO {
  std::string cueId;
  std::string filePath;
  std::string format;
  double durationMs = 0.0;
  int sampleRate = 0;
  int channels = 0;
  int64_t frames = -1;
  int64_t fileBytes = 0;
  bool streaming = false;
  bool cacheHit = false;
  int64_t decodedBytes = 0;
};

struct StartResultDTO {
  std::string cueId;
  std::string runId;
  std::string state;
  double startAtMs = 0.0;
};

struct CommandResultDTO {
  double atMs = 0.0;
  bool applied = false;
};

struct CancelResultDTO {
  double atMs = 0.0;
  int canceled = 0;
};

struct SeekResultDTO {
  double atMs = 0.0;
  double positionMs = 0.0;
  std::string state;
};

struct PanicResultDTO {
  double atMs = 0.0;
  int stoppedVoices = 0;
};

struct WaveformDTO {
  std::string filePath;
  int buckets = 0;
  std::vector<float> values;  // interleaved min/max per bucket
  double durationMs = 0.0;     // the file's whole length, whatever the region
  int sampleRate = 0;
  int channels = 0;
  bool truncated = false;
  // The part of the file these buckets cover, in ms from its start: the whole file
  // unless the request named a region.
  double startMs = 0.0;
  double endMs = 0.0;
  /**
   * True when the buckets were measured from taps rather than every sample — what a
   * long region gets, so that drawing it costs a seek per bucket instead of a pass over
   * the media. A sampled envelope is only ever shown where one bucket is more than a
   * pixel of wall time, which is where a transient inside it could not be drawn anyway.
   */
  bool sampled = false;
};

struct InfoDTO {
  std::string name = "cuerunner-audio";
  std::string version;
  int protocol = kWireProtocolVersion;
  /** This process's identity. A respawned engine has a different one and counts from
   *  zero again; callers use it to tell a new session from a discontinuity. */
  std::string sessionId;
  std::string backend = "none";
  std::string deviceId;
  std::string deviceName;
  std::string format = "f32";
  int sampleRate = 48000;
  int channels = 2;
  bool exclusive = false;
  int bufferFrames = -1;  // -1 = unknown
  int periodFrames = -1;
  double latencyMs = 0.0;
  std::string latencySource = "unknown";
  bool active = false;
  int activeVoices = 0;
  std::vector<VoiceSnapshot> activeCues;
  CacheStats cache;
  int streamingVoices = 0;
  int64_t residentBytes = 0;
  int64_t streamBufferBytes = 0;
  int64_t streamBufferLimitBytes = 0;
  int64_t decodeQueueDepth = 0;
  uint64_t decodeUnderruns = 0;
  uint64_t xruns = 0;
  uint64_t droppedChunks = 0;
  std::string lastError;
  std::vector<std::string> warnings;
};

struct DeviceRequest {
  bool hasDeviceId = false;
  std::string deviceId;
  bool hasSampleRate = false;
  int sampleRate = 0;
  bool hasChannels = false;
  int channels = 0;
  bool hasExclusive = false;
  bool exclusive = false;
  bool hasBufferFrames = false;
  int bufferFrames = 0;
  /** The audio system to run on, when the caller names one ("auto", "wasapi", "asio"...).
   *  Changing it is a device change like any other: the device is reopened on the new
   *  backend, and the old one is put back if the new one will not open. */
  bool hasBackend = false;
  std::string backend;
};

class Engine {
 public:
  Engine();
  /**
   * Constructed with the options it is about to be asked about. `--list-devices` opens
   * nothing and never calls start() — which is the only other place options are taken in
   * — so without this a listing would always be of the default backend's devices, and
   * "which ASIO drivers are there" would be answered with WASAPI's device names.
   */
  explicit Engine(const EngineOptions& options);
  ~Engine();

  bool start(const EngineOptions& options, EngineError& error);
  void stop();
  bool running() const { return running_.load(std::memory_order_acquire); }

  void setEventCallback(std::function<void(const Event&)> callback);

  // Called from the backend's own callback thread when the device stops under us.
  // Only atomics are touched here; the background thread does the emitting and the
  // silencing. Kept public because the backend callback is a free function.
  void failDeviceFromCallback(const std::string& message);

  // Test-only: runs the real notification classification without hardware. The protocol
  // refuses it unless this engine has no device at all.
  void handleSimulatedNotification(int type);

  // Whether a device stop is one the engine asked for. miniaudio posts a `stopped`
  // notification from its device thread whenever the device leaves its loop — including
  // when the application called ma_device_stop() during a reconfigure or at shutdown —
  // so the notification alone cannot mean "the device was lost".
  bool isExpectedDeviceStop() const { return expectedDeviceStop_.load(std::memory_order_acquire); }
  void noteDeliberateStop(bool expected) { expectedDeviceStop_.store(expected, std::memory_order_release); }
  // True when the engine is running a real backend device right now.
  bool deviceIsRunning() const { return deviceRunning_.load(std::memory_order_acquire); }
  // No device in this backend (silent/offline): used to gate the test-only notification
  // injection so it can never stand in for a real device.
  bool hasNoDevice() const { return device_ == nullptr; }

  bool prepare(const std::string& cueId, const std::string& filePath, PrepareDTO& out, EngineError& error);
  bool probe(const std::string& filePath, ProbeDTO& out, EngineError& error);
  bool startCue(const std::string& cueId, double whenMs, const StartOptions& options, StartResultDTO& out,
                EngineError& error);
  bool stopCue(const std::string& cueId, double fadeMs, double whenMs, CommandResultDTO& out, EngineError& error);
  bool stopAll(double fadeMs, CommandResultDTO& out, EngineError& error);
  bool seekCue(const std::string& cueId, double positionMs, double whenMs, SeekResultDTO& out, EngineError& error);
  bool cancelCue(const std::string& cueId, double whenMs, CancelResultDTO& out, EngineError& error);
  /**
   * Ends a voice's loop and plays it out to the end of the file, from wherever the loop
   * is — or to `endMs` when `hasEnd` names one, which is where a cue trimmed of its
   * trailing silence stops hearing the file. The verb a devamp cue sends: the voice
   * leaves its loop without being restarted, so the release lands on the sample the
   * operator aimed at rather than at a seam.
   */
  bool releaseCue(const std::string& cueId, double whenMs, bool hasEnd, double endMs, CommandResultDTO& out,
                  EngineError& error);
  bool fadeCue(const std::string& cueId, int param, double value, double durationMs, int curve, double whenMs,
               CommandResultDTO& out, EngineError& error);
  bool routeCue(const std::string& cueId, bool automatic, const std::vector<Crosspoint>& points,
                CommandResultDTO& out, EngineError& error);
  bool panic(double fadeMs, PanicResultDTO& out, EngineError& error);
  bool progress(const std::string& cueId, VoiceSnapshot& out, bool& found) const;
  double clockMs() const;
  /** The identity minted when this engine instance was constructed. */
  const std::string& sessionId() const { return sessionId_; }
  InfoDTO info() const;
  bool devices(std::vector<DeviceDTO>& out, EngineError& error) const;
  bool configureDevice(const DeviceRequest& request, EngineError& error);
  bool waveform(const std::string& filePath, int points, const RegionQuery& region, WaveformDTO& out,
                EngineError& error);
  /**
   * Where notes or hits begin in a media file. `sensitivity` scales the adaptive
   * threshold — 1.0 is the default, higher is stricter and finds fewer onsets — and
   * `maxOnsets` caps the answer; a scan is bounded work, so a nonsense cap is clamped
   * and reported rather than refused. Each onset is reported at the middle of the
   * analysis frame that caught its attack, which is the closest a 1024-sample window
   * gets to the instant of the hit.
   */
  bool onsets(const std::string& filePath, double sensitivity, int maxOnsets, const RegionQuery& region, OnsetDTO& out,
              EngineError& error);
  /**
   * Where a file's sound starts and stops, from a scan of its samples: the first and
   * last frames whose samples rise above `thresholdDb` dBFS, and the whole length the
   * scan read. `thresholdDb` is clamped to a workable range rather than refused, the
   * way an oversized point count is. A file that never crosses the threshold answers
   * `silent` with its whole length as the bounds — a file that is quiet end to end has
   * no silence at its edges to trim.
   */
  bool silence(const std::string& filePath, double thresholdDb, SilenceDTO& out, EngineError& error);
  int64_t scheduleHorizonMs() const { return options_.scheduleHorizonMs; }
  const EngineOptions& options() const { return options_; }

  /**
   * Asks a whole-file scan in progress (a waveform envelope, an onset pass) to stop at
   * its next chunk. The transport's file-reading threads are joined as the process goes down,
   * and a twelve-hour file's scan would otherwise make that wait minutes long — after
   * the client that asked for it has gone. A cancelled scan reports an error; nothing
   * is left to receive it.
   */
  void cancelAnalysis() { analysisCancelled_.store(true, std::memory_order_release); }
  bool analysisCancelled() const { return analysisCancelled_.load(std::memory_order_acquire); }

  // Offline rendering drives the same mixer with a caller-owned clock. `pump` runs the
  // service work (acks, reclaims, stream fills) on the caller's thread, because the
  // offline mode deliberately has no background thread.
  void renderOfflineBlock(float* out, int frames);
  void pump();

 private:
  struct DeviceState;

  bool startDevice(EngineError& error);
  bool startSilent(EngineError& error);
  void stopAudioThreads();

  /**
   * Tears the open device down and opens `updated` in its place, putting `previous` back
   * if the new one will not open. The device mutex is the caller's to hold: this is the
   * body shared by a settings change and by a backend that asked to be reopened.
   */
  bool reopenDeviceLocked(const EngineOptions& updated, const EngineOptions& previous, EngineError& error);
  /** Reopens the device because the backend's own driver asked for it (its control panel
   *  changed the buffer size, its clock changed), with the sentence it gave as the reason. */
  void reopenAfterBackendRequest(const std::string& reason);
  /**
   * What the backend has to say about a device it has just failed to open, in its own
   * words; empty for every backend that has nothing to add, where miniaudio's own result
   * description is the best available answer.
   */
  static std::string backendDetail(const DeviceState& state);

  struct AckResult {
    bool ok = true;
    bool applied = false;
    int canceled = 0;
    int voices = 0;
    int state = static_cast<int>(VoiceState::Stopped);
    double positionMs = 0.0;
    std::string code;
    std::string message;
    /** The render thread has answered this entry. A waiter that gives up first erases its
     *  entry, so an answer that arrives afterwards is addressed to nobody and dropped. */
    bool resolved = false;
  };

  bool submitCommand(Command& command, AckResult& ack, EngineError& error);
  /**
   * Queues a command the engine issued to itself: no acknowledgement, no wait. Both
   * callers are threads that must not wait for one — the failure panic runs on the
   * service thread, which is the only thread that resolves acks, and a reconfigure
   * holds deviceMutex_ while it stops the voices (a driver-request reopen is on that
   * same service thread). The render thread applies it in queue order like any other
   * command, or the caller drains the queue itself with applyQueuedCommands().
   */
  void submitInternalCommand(Command& command);
  /**
   * Applies everything queued, on the calling thread. Valid only where the render thread
   * is not running: applying a command is the render thread's job and this is a
   * single-consumer queue. A reopen stops the old device first, so this is where the stop
   * it owes the old voices lands — in the old frame domain, before startDevice() changes
   * the format — and nothing queued for the old device is left for the new one.
   */
  void applyQueuedCommands();
  void releaseCommandResources(Command& command);
  void backgroundLoop();
  void silentLoop();
  void renderAudio(float* out, int frames);
  void handleBackgroundWork();
  void restartCapture();
  void checkDeviceHealth();
  void resolveAck(const Event& event);
  void failDevice(const std::string& message);
  double snapshotClockMs() const;
  void copySnapshot(MixSnapshot& out) const;
  std::string deviceIdString() const;

  EngineOptions options_;
  std::string sessionId_;
  DecodedCache cache_;
  StreamPool streams_;
  SpscQueue<Command, 512> commands_;
  SpscQueue<Event, 1024> events_;
  SpscQueue<ReclaimItem, 512> reclaim_;
  Mixer mixer_;
  CaptureWriter capture_;

  std::unique_ptr<DeviceState> device_;
  mutable std::mutex deviceMutex_;
  mutable std::mutex commandMutex_;
  mutable std::mutex prepareMutex_;
  mutable std::mutex ackMutex_;
  std::condition_variable ackCv_;
  std::unordered_map<uint64_t, AckResult> acks_;
  std::atomic<uint64_t> nextAckId_{0};

  /**
   * Envelope, onset and silence answers, kept per exact question asked and invalidated
   * by the file's own stamp. Reading a long file to answer one of these is the expensive
   * half of the panel, and a selection that comes back to a file — or an operator
   * zooming back out — asks the same question again.
   */
  struct WaveformCacheEntry {
    std::string filePath;
    int points = 0;
    RegionQuery region;
    FileStamp stamp;
    WaveformDTO result;
    uint64_t lastUse = 0;
  };
  struct OnsetCacheEntry {
    std::string filePath;
    double sensitivity = 1.0;
    int maxOnsets = 0;
    RegionQuery region;
    FileStamp stamp;
    OnsetDTO result;
    uint64_t lastUse = 0;
  };
  struct SilenceCacheEntry {
    std::string filePath;
    double thresholdDb = 0.0;
    FileStamp stamp;
    SilenceDTO result;
    uint64_t lastUse = 0;
  };
  bool waveformCached(const std::string& filePath, int points, const RegionQuery& region, const FileStamp& stamp,
                      WaveformDTO& out);
  void cacheWaveform(const std::string& filePath, int points, const RegionQuery& region, const FileStamp& stamp,
                     const WaveformDTO& result);
  bool onsetsCached(const std::string& filePath, double sensitivity, int maxOnsets, const RegionQuery& region,
                    const FileStamp& stamp, OnsetDTO& out);
  void cacheOnsets(const std::string& filePath, double sensitivity, int maxOnsets, const RegionQuery& region,
                   const FileStamp& stamp, const OnsetDTO& result);
  bool silenceCached(const std::string& filePath, double thresholdDb, const FileStamp& stamp, SilenceDTO& out);
  void cacheSilence(const std::string& filePath, double thresholdDb, const FileStamp& stamp, const SilenceDTO& result);
  std::mutex analysisCacheMutex_;
  std::vector<WaveformCacheEntry> waveformCache_;
  std::vector<OnsetCacheEntry> onsetCache_;
  std::vector<SilenceCacheEntry> silenceCache_;
  uint64_t analysisCacheClock_ = 0;

  struct PreparedFile {
    std::string path;
    SourceInfo info;
    // Decided once, at prepare: whether this cue streams instead of being cached. The
    // probe reports the same decision, so the UI can size a workspace without decoding.
    bool streaming = false;
  };
  std::map<std::string, PreparedFile> prepared_;

  mutable MixSnapshot snapshot_;
  mutable std::atomic<uint32_t> snapshotSeq_{0};
  std::atomic<bool> running_{false};
  std::atomic<bool> backgroundStop_{false};
  std::thread background_;
  std::thread silent_;
  std::atomic<uint64_t> renderedFrames_{0};
  std::atomic<uint64_t> silentDroppedFrames_{0};
  std::atomic<uint64_t> decodeUnderruns_{0};
  std::atomic<uint64_t> xruns_{0};
  std::atomic<uint64_t> droppedChunks_{0};
  std::atomic<uint64_t> deviceFailures_{0};
  std::atomic<bool> deviceFailed_{false};
  std::atomic<bool> deviceRunning_{false};
  std::atomic<bool> expectedDeviceStop_{false};
  std::atomic<bool> silentStop_{false};
  /** Set by cancelAnalysis(): a scan in progress stops at its next chunk. */
  std::atomic<bool> analysisCancelled_{false};
  int healthTick_ = 0;
  mutable std::mutex errorMutex_;
  mutable std::string lastError_;
  std::atomic<uint64_t> nextRunId_{1};

  std::vector<float> renderScratch_;
  std::vector<float> silentScratch_;
  std::function<void(const Event&)> eventCallback_;
  bool deviceStarted_ = false;
  bool silentStarted_ = false;
};

}  // namespace ws
