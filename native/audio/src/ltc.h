// Linear timecode: SMPTE's 80-bit frame, written as biphase-mark audio and read back out
// of it.
//
// Each frame is 80 bit cells. The level flips at the edge of every cell, and flips again
// in the middle of a cell carrying a 1, so the signal has no polarity and no DC, and a
// reader that only sees transitions can tell a 0 (one long interval) from a 1 (two short
// ones) at any level and at any speed. The last 16 bits are a sync word that is not
// symmetric, which is what says where a frame ends — and, read backwards, that the tape
// is running backwards.
//
// Three parts live here. The codec is pure (fields to bits and back). The encoder is a
// voice the mixer adds to an output channel on the audio thread: it never allocates and
// never locks, and is driven by commands through a queue like every other voice. The
// decoder reads samples — from an offline file in the tests, or from a capture device the
// engine opens for it — and hands whole frames to the protocol thread through a queue.
#pragma once

#include "ring.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace ws {

/** The five rates, by the names the wire carries: "24", "25", "29.97df", "29.97", "30". */
enum class LtcRate : int { R24 = 0, R25 = 1, R2997Df = 2, R2997 = 3, R30 = 4 };

bool ltcRateFromName(const std::string& name, LtcRate& out);
const char* ltcRateName(LtcRate rate);
int ltcNominal(LtcRate rate);
double ltcFps(LtcRate rate);
bool ltcDropFrame(LtcRate rate);
int64_t ltcFramesPerDay(LtcRate rate);

/** The fields of one frame. User bits and the binary group flags are carried, not read. */
struct LtcFields {
  int hours = 0;
  int minutes = 0;
  int seconds = 0;
  int frames = 0;
  bool dropFrame = false;
  bool colorFrame = false;
  uint32_t userBits = 0;
};

/** The label a frame count reads as, wrapped into one day (drop-frame skipping included). */
LtcFields ltcFieldsFromFrames(int64_t frames, LtcRate rate);
/** The frame count a label names. */
int64_t ltcFramesFromFields(const LtcFields& fields, LtcRate rate);

/**
 * The 80 bits of a frame, bit 0 first. `twentyFive` moves the polarity bit to where 25 fps
 * keeps it (bit 59 rather than bit 27); it is set so the frame holds an even number of
 * ones, which keeps every frame starting on the same edge.
 */
void ltcEncodeBits(const LtcFields& fields, bool twentyFive, uint8_t bits[80]);
/** Reads a frame's bits (bit 0 first), refusing digits that are not BCD for a clock. */
bool ltcDecodeBits(const uint8_t bits[80], LtcFields& out);

/** One output's generator, rendered on the audio thread. */
class LtcEncoder {
 public:
  void start(LtcRate rate, int64_t frame, float gain, int sampleRate);
  void stop() { running_ = false; }
  /** Falls silent at the end of the word being written, so no half frame is left on the line. */
  void pause() { pendingPause_ = true; }
  /** Starts again with the next word, from the frame after the last one written. */
  void resume() {
    pendingPause_ = false;
    paused_ = false;
  }
  /** Moves to `frame` at the next frame boundary rather than mid-word. */
  void locate(int64_t frame) { pendingLocate_ = frame; }
  bool running() const { return running_; }
  bool paused() const { return paused_; }
  /** The frame being written now. */
  int64_t frame() const { return frame_; }
  /** Adds this generator's signal into `out`, one sample every `stride` floats. */
  void render(float* out, int frames, int stride);

 private:
  void loadFrame();

  LtcRate rate_ = LtcRate::R25;
  bool running_ = false;
  bool paused_ = false;
  bool pendingPause_ = false;
  int64_t frame_ = 0;
  int64_t pendingLocate_ = -1;
  float gain_ = 0.25f;
  double cell_ = 24.0;  // samples per bit cell
  double phase_ = 0.0;  // samples into the current cell
  int bit_ = 0;
  bool midDone_ = false;
  float level_ = 1.0f;
  uint8_t bits_[80] = {};
};

/** A frame the decoder read, and where in the stream it ended. */
struct LtcDecoded {
  LtcFields fields;
  /** Samples from the start of the stream to the end of the frame's last bit. */
  int64_t endSample = 0;
  /** Wall-clock ms (steady clock) that sample was heard, when the reader knows it. */
  double atMs = 0.0;
  /** Samples per bit cell when the frame was read: the speed the tape is running at. */
  double cellSamples = 0.0;
  bool reverse = false;
};

/**
 * Reads frames out of a stream of samples.
 *
 * The level is never trusted: a transition is a crossing of a threshold that follows the
 * signal's own envelope, with hysteresis, so a line that comes in at -30 dBFS, or that
 * swells and fades, or carries hiss, reads the same. The bit cell is learned from the
 * intervals between transitions and kept following them, which is what reads a clock
 * that is shuttling or not quite at its nominal speed.
 */
class LtcDecoder {
 public:
  explicit LtcDecoder(int sampleRate);
  void reset();
  /** Reads `frames` samples, one every `stride` floats; whole frames go to `sink`. */
  template <typename Sink>
  void feed(const float* samples, int frames, int stride, Sink&& sink) {
    for (int i = 0; i < frames; i++) {
      LtcDecoded decoded;
      if (step(samples[static_cast<size_t>(i) * static_cast<size_t>(stride)], decoded)) sink(decoded);
    }
  }
  /** One sample; true when it completed a frame, which is written to `out`. */
  bool step(float sample, LtcDecoded& out);
  int64_t position() const { return sample_; }

 private:
  void transition(double at, LtcDecoded& out, bool& completed);
  void pushBit(uint8_t bit, double at, LtcDecoded& out, bool& completed);

  int sampleRate_;
  double minCell_;
  double maxCell_;
  int64_t sample_ = 0;
  double previous_ = 0.0;
  // A DC blocker ahead of the threshold: a line with an offset on it still crosses the middle.
  double dcIn_ = 0.0;
  double dcOut_ = 0.0;
  double dcPole_ = 0.999;
  float envelope_ = 0.0f;
  int sign_ = 0;
  double lastEdge_ = -1.0;
  double cell_ = 0.0;
  bool halfPending_ = false;
  uint8_t window_[80] = {};
  int filled_ = 0;
};

/**
 * Up to four generators, each writing to one output channel: the engine's LTC voices.
 * Control threads post commands; the audio thread applies them at the top of a block and
 * renders. Positions are published as atomics so a status read never touches a voice.
 */
class LtcOutputs {
 public:
  static constexpr int kSlots = 4;

  struct Command {
    enum Op : int { Start, Stop, Pause, Resume, Locate } op = Start;
    char id[64] = {};
    int channel = 0;
    LtcRate rate = LtcRate::R25;
    int64_t frame = 0;
    float gain = 0.25f;
  };

  struct SlotStatus {
    std::string id;
    int channel = 0;
    LtcRate rate = LtcRate::R25;
    int64_t frame = 0;
    bool running = false;
    bool paused = false;
  };

  /** From a control thread; false when the queue is full. */
  bool post(const Command& command);
  /** From the audio thread, once a block. */
  void render(float* out, int frames, int channels, int sampleRate);
  std::vector<SlotStatus> status() const;

 private:
  struct Slot {
    char id[64] = {};
    int channel = 0;
    LtcEncoder encoder;
    std::atomic<int64_t> frame{0};
    std::atomic<int> state{0};  // 0 free, 1 running, 2 paused
    std::atomic<int> rate{1};
    std::atomic<int> channelPublished{0};
  };

  void apply(const Command& command, int sampleRate);

  std::mutex postMutex_;  // several connections may post; the queue has one producer
  SpscQueue<Command, 64> queue_;
  Slot slots_[kSlots];
  mutable std::mutex idMutex_;  // guards the published ids against the status read
  std::string publishedIds_[kSlots];
};

/**
 * Reads LTC from one channel of a capture device. The device is the engine's own
 * business: it is opened here, beside the playback device rather than in place of it, so
 * listening for the clock never interrupts the show's sound.
 */
class LtcInput {
 public:
  LtcInput();
  ~LtcInput();
  bool listen(const std::string& deviceId, int channel, std::string& error);
  void close();
  bool listening() const { return listening_.load(std::memory_order_acquire); }
  /** Frames read since the last call, oldest first; at most `limit`. */
  std::vector<LtcDecoded> drain(size_t limit);
  /** Called from the capture thread with interleaved frames. */
  void capture(const float* frames, int count, int channels);
  std::string description() const;

  struct Device;

 private:
  std::unique_ptr<Device> device_;
  std::unique_ptr<LtcDecoder> decoder_;
  SpscQueue<LtcDecoded, 256> queue_;
  std::atomic<bool> listening_{false};
  int channel_ = 0;
  int sampleRate_ = 48000;
  std::string description_;
  mutable std::mutex mutex_;
};

/** The capture devices there are, as {id, name} pairs, for a window to choose from. */
bool ltcCaptureDevices(std::vector<std::pair<std::string, std::string>>& out, std::string& error);

/** Decodes a whole file's channel offline: the native test's reader. */
bool ltcDecodeFile(const std::string& path, int channel, std::vector<LtcDecoded>& out, int& sampleRate,
                   std::string& error);

/** `--ltc-decode`: prints the frames a file's channel carries as one JSON object; the exit code. */
int printLtcDecode(const std::string& path, int channel);

}  // namespace ws
