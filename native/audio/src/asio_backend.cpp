// WinsLab's ASIO backend.
//
// Steinberg's ASIO SDK is the one dependency this engine cannot vendor: it is
// dual-licensed, and the proprietary half — the half a closed-source application has to
// use — forbids redistributing the SDK with anything that links it. A build therefore
// compiles this file only when the SDK is supplied out of band (WINSLAB_ASIO_SDK; see
// scripts/asio-sdk.mjs), and a build without it is unchanged: no ASIO device is listed,
// and `--backend asio` is refused with that reason rather than with silence.
//
// It arrives here as a miniaudio *custom* backend, not as a second device layer of its
// own. miniaudio has no ASIO support, but it has a hook for a backend that brings its own
// driver, and using it is what makes everything the engine already does about devices —
// enumeration, opening, the reopen that follows a settings change, the info readout, the
// resampler warning, device loss — work for ASIO without a single new convention. The
// engine tells the difference only where it must: this backend is `ma_backend_custom` and
// its name is "asio".
//
// Three things about ASIO shape the code below:
//
//   * The driver owns the buffers and calls back on its own thread. miniaudio's device
//     model is pull-shaped (a backend either blocks in onDeviceWrite or runs a loop of
//     its own); ASIO is push-shaped, like JACK. So this backend implements neither read
//     nor write nor a data loop — miniaudio then runs no thread of its own, calls
//     onDeviceStart/onDeviceStop directly, and the driver's thread arrives in
//     bufferSwitchTimeInfo. That combination is miniaudio's "asynchronous backend", and
//     it is the same one JACK uses.
//   * The driver's callback asks for one half of a double buffer, per channel, in the
//     driver's own sample type. The engine renders f32 interleaved, so every block is
//     converted and de-interleaved on the way out (asio_convert.h owns that arithmetic).
//   * There is no "the device is gone" notification. A driver whose interface was
//     unplugged either keeps calling back or stops calling back, and only the second is
//     visible from here — which is what the stall check at the bottom is for.
//
// The driver instance is this file's own COM object rather than the SDK's global loader:
// the loader keeps the instance when `init` fails, so a driver that was busy once could
// never be opened again in the same process, and it would report "already open" instead
// of the reason. Owning the instance makes the failure to report always the real one.
// Enumeration still goes through the SDK's `AsioDriverList`, which is a registry read and
// nothing more.
#include "asio_backend.h"

#if defined(WINSLAB_ASIO)

#if defined(_WIN32) && !defined(NOMINMAX)
// windows.h defines `min` and `max` as function-like macros, and the SDK's headers pull
// it in. (The C++ headers already define NOMINMAX on some toolchains, hence the guard.)
#define NOMINMAX
#endif

#include "asio_convert.h"
#include "util.h"
#include "wsaudio.h"

// The SDK's headers are written for a source file that has already brought in the Windows
// types it uses — CLSID, LONG, `interface`, IUnknown — and they read their own platform
// macros (WINDOWS, IEEE754_64FLOAT, ASIO_LITTLE_ENDIAN) out of asiosys.h. So the order
// matters and is the same one the SDK's own host example uses.
#include <windows.h>
#include <objbase.h>

#include <asiosys.h>
#include <asio.h>
#include <iasiodrv.h>
#include <asiolist.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <functional>
#include <future>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <iterator>
#include <map>
#include <mutex>
#include <new>
#include <queue>
#include <string>
#include <thread>
#include <vector>

namespace ws {
namespace asio {
namespace {

/**
 * How many output channels this backend will ever activate. The engine's mixer has the
 * same ceiling (kMaxOutputChannels), and a device opened at a higher channel count would
 * be a device the mixer cannot fill — so the driver's list is capped here and the
 * operator is told.
 */
constexpr int kChannelCap = kMaxOutputChannels;

/**
 * How long a started driver may go without calling back before the stream is called dead.
 * 1.5 s is nine blocks of the largest buffer a driver is likely to offer (8192 frames at
 * 48 kHz is 170 ms), so a loaded machine cannot trip it, and a driver whose hardware was
 * unplugged is noticed while the operator is still looking at the desk.
 */
constexpr int64_t kCallbackTimeoutMs = 1500;

/**
 * The sample rates asked of a driver during a capability probe. ASIO has no "what rates
 * do you support" call — only "can you do this one" — so the rates a professional
 * interface is likely to offer are the ones asked about.
 */
constexpr double kProbeRates[] = {44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0};

/** What one driver said about itself, kept so the device list is not a series of opens. */
struct DriverProbe {
  bool available = false;
  std::string reason;
  int channels = 0;
  std::vector<int> rates;
  ma_format format = ma_format_unknown;
};

struct AsioHost {
  // One driver instance, and therefore one device: ASIO gives an application the driver
  // it instantiated, and this engine plays through one.
  IASIO* driver = nullptr;
  std::string driverName;
  bool driverInitialised = false;
  bool buffersCreated = false;
  bool started = false;

  long driverOutputs = 0;
  int activeChannels = 0;
  long bufferFrames = 0;
  ASIOSampleRate sampleRate = 0.0;
  bool postOutput = false;
  long outputLatencyFrames = 0;

  ma_device* device = nullptr;
  ASIOBufferInfo infos[kChannelCap] = {};
  /**
   * The callback table handed to the driver at buffer creation, kept here rather than on the
   * stack of the function that made the buffers: a driver is entitled to keep this pointer
   * for as long as the buffers exist, and Steinberg's built-in one does — it reads a slot out
   * of it later, inside `ASIOStart`. On a stack frame that has been overwritten in the
   * meantime that slot is whatever happened to be there, and calling it is an access
   * violation with no clue in it (found on the Windows runner: `call r9` inside asiobtin.dll
   * with `r9` read from the stale struct). It lives as long as the host does.
   */
  ASIOCallbacks driverCallbacks = {};
  SampleType types[kChannelCap] = {};
  /** The engine's block, interleaved f32: what miniaudio hands the engine's renderer and
   *  what this backend then writes into the driver's per-channel buffers. Sized once, at
   *  buffer creation; the audio thread never allocates. */
  std::vector<float> interleaved;

  std::atomic<uint64_t> callbacks{0};
  std::atomic<int64_t> lastCallbackMs{0};
  std::atomic<uint64_t> dropouts{0};
  std::atomic<bool> latencyDirty{false};

  std::mutex textMutex;
  std::string message;       // why the last open or start failed
  std::string note;          // what the operator should know (the channel cap)
  std::string restartReason; // why the driver asked to be restarted
  bool restartPending = false;

  std::mutex probeMutex;
  std::map<std::string, DriverProbe> probes;
};

/**
 * ASIO's callback structure carries no user data, so the prepared host is found through a
 * file-scope pointer. That is exact rather than convenient: one driver instance per
 * process, one device per driver. It is set when the driver's buffers exist — the moment
 * the driver may start asking the host questions — and cleared when the instance is
 * released; the data path additionally requires `started`, because ASIO permits a driver
 * to call back only between start and stop.
 */
AsioHost* g_preparedHost = nullptr;

// The conversion table is pinned to the SDK's own numbering here, where the SDK is
// visible: asio_convert.h has no SDK to check itself against, and a drifted type number
// would write every sample into the wrong word.
static_assert(static_cast<int>(SampleType::Int16Msb) == ASIOSTInt16MSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int24Msb) == ASIOSTInt24MSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Msb) == ASIOSTInt32MSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Float32Msb) == ASIOSTFloat32MSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Float64Msb) == ASIOSTFloat64MSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Msb16) == ASIOSTInt32MSB16, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Msb18) == ASIOSTInt32MSB18, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Msb20) == ASIOSTInt32MSB20, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Msb24) == ASIOSTInt32MSB24, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int16Lsb) == ASIOSTInt16LSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int24Lsb) == ASIOSTInt24LSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Lsb) == ASIOSTInt32LSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Float32Lsb) == ASIOSTFloat32LSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Float64Lsb) == ASIOSTFloat64LSB, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Lsb16) == ASIOSTInt32LSB16, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Lsb18) == ASIOSTInt32LSB18, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Lsb20) == ASIOSTInt32LSB20, "sample type numbering");
static_assert(static_cast<int>(SampleType::Int32Lsb24) == ASIOSTInt32LSB24, "sample type numbering");

AsioHost* hostOf(const ma_context& context) { return static_cast<AsioHost*>(context.pUserData); }

void setMessage(AsioHost& host, const std::string& text) {
  std::lock_guard<std::mutex> lock(host.textMutex);
  host.message = text;
}

void setNote(AsioHost& host, const std::string& text) {
  std::lock_guard<std::mutex> lock(host.textMutex);
  host.note = text;
}

/** The driver's error codes, in words an operator can act on. */
std::string asioErrorText(ASIOError error) {
  switch (error) {
    case ASE_OK: return "ok";
    case ASE_SUCCESS: return "ok";
    case ASE_NotPresent: return "the driver is not present, or the device is in use by another application";
    case ASE_HWMalfunction: return "the driver reported a hardware malfunction";
    case ASE_InvalidParameter: return "the driver refused a parameter";
    case ASE_InvalidMode: return "the driver is in a mode it cannot stream in";
    case ASE_SPNotAdvancing: return "the driver's sample position is not advancing";
    case ASE_NoClock: return "the driver has no clock: nothing is clocking the device, or its rate is not supported";
    case ASE_NoMemory: return "the driver ran out of memory";
    default: {
      char buffer[32] = {};
      std::snprintf(buffer, sizeof(buffer), "0x%08lx", static_cast<unsigned long>(error));
      return std::string("error ") + buffer;
    }
  }
}

/**
 * The thread the driver lives on.
 *
 * ASIO drivers are in-process COM servers registered as `ThreadingModel=Apartment`, so they
 * can only be created, and called, from a single-threaded apartment. The engine's threads are
 * not that and cannot be made to be: miniaudio asks for the *multi*-threaded apartment on any
 * thread that initializes a context (`MA_COINIT_VALUE`), which on Windows happens for WASAPI
 * long before a show asks for ASIO, and a thread cannot change its apartment afterwards.
 * Making the engine's threads STA up front is not an option either: miniaudio's WASAPI device
 * notifications depend on the apartment it chose.
 *
 * So the backend owns one thread of its own, in an STA, and every driver call that is not the
 * driver's own callback runs there. Calls arrive as tasks through `run`, which blocks until
 * the answer is ready, so the caller's view is synchronous while the driver sees one thread.
 *
 * The thread is detached and lives as long as the process: a driver outlives any device, and
 * joining this thread at exit is a way to hang inside a driver's teardown.
 *
 * The one exception is the driver's callback thread, which is the driver's own: `outputReady`
 * and `getLatencies` are called from inside `processBlock` below and stay there. That is what
 * ASIO expects of a host — the interface has no proxy, and the driver is asking for those
 * calls from inside its own callback.
 */
class DriverThread {
 public:
  static DriverThread& instance() {
    static DriverThread thread;
    return thread;
  }

  template <typename Fn>
  auto run(Fn&& fn) -> decltype(fn()) {
    // Re-entrant by construction: a task that ends up here again (a call from inside a task)
    // would otherwise wait for itself.
    if (std::this_thread::get_id() == id_) return fn();

    using Result = decltype(fn());
    auto task = std::make_shared<std::packaged_task<Result()>>(std::forward<Fn>(fn));
    std::future<Result> answer = task->get_future();
    {
      std::lock_guard<std::mutex> lock(mutex_);
      queue_.emplace([task]() { (*task)(); });
    }
    wake_.notify_one();
    return answer.get();
  }

 private:
  DriverThread() {
    // The constructor does not return until the worker has its apartment and an id: without
    // that, a `run` arriving in the gap would find `id_` still equal to the *caller's* thread
    // id and execute the task inline, on a thread with no apartment of its own — which is
    // the E_NOINTERFACE this whole class exists to avoid, arriving as "the driver could not
    // be loaded".
    std::promise<void> ready;
    std::future<void> started = ready.get_future();
    worker_ = std::thread([this, &ready]() {
      CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
      id_ = std::this_thread::get_id();
      ready.set_value();
      loop();
    });
    started.wait();
    worker_.detach();
  }
  DriverThread(const DriverThread&) = delete;
  DriverThread& operator=(const DriverThread&) = delete;

  void loop() {
    for (;;) {
      std::function<void()> task;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        wake_.wait(lock, [this]() { return !queue_.empty(); });
        task = std::move(queue_.front());
        queue_.pop();
      }
      task();
    }
  }

  std::thread worker_;
  std::thread::id id_;  // set by the worker before the constructor returns
  std::mutex mutex_;
  std::condition_variable wake_;
  std::queue<std::function<void()>> queue_;
};

/**
 * The machine's installed drivers, built once and kept for the life of the process.
 *
 * Not an optimization: the SDK's `AsioDriverList` destructor calls `CoUninitialize`, and
 * `CoUninitialize` unloads the in-process DLLs loaded on that thread. A driver instance
 * created while a list is alive therefore dies with the list — the next call through its
 * vtable reads memory inside the driver DLL's *preferred* base, which is unmapped once the
 * DLL is gone, and that is an access violation (found exactly this way on the Windows
 * runner: `CoCreateInstance` returned an object, `createDriver`'s local list went out of
 * scope, and the first `init` faulted at `0x18002ab00`). The SDK's own loader keeps its list
 * for the same reason. Enumeration and CLSID lookups only read it, so sharing it across
 * threads is safe; construction is once, under a call_once.
 */
AsioDriverList& driverList() {
  static AsioDriverList* list = nullptr;
  static std::once_flag once;
  std::call_once(once, []() { list = new AsioDriverList(); });
  return *list;
}

/**
 * The machine's installed ASIO drivers, by the name the driver list gives.
 *
 * The name is read into a 32-byte buffer because that is ASIO's own convention for driver
 * names — the SDK's host example, its loader and its enumerator all spell it that way — and
 * a name read any longer would not match what the driver registered.
 */
std::vector<std::string> driverNames() {
  AsioDriverList& list = driverList();
  std::vector<std::string> names;
  const long count = list.asioGetNumDev();
  for (long index = 0; index < count; index++) {
    char name[32] = {};
    if (list.asioGetDriverName(static_cast<int>(index), name, sizeof(name)) == 0 && name[0] != '\0') {
      names.push_back(name);
    }
  }
  return names;
}

/**
 * Instantiates a driver by name.
 *
 * ASIO drivers register their class and their interface under the same id (there is no
 * shared interface id for `IASIO`), which is what the SDK's own host code passes to
 * `CoCreateInstance` as well.
 */
IASIO* createDriver(const std::string& name, std::string& error) {
  AsioDriverList& list = driverList();
  const long count = list.asioGetNumDev();
  CLSID clsid = {};
  bool found = false;
  for (long index = 0; index < count; index++) {
    char candidate[32] = {};
    if (list.asioGetDriverName(static_cast<int>(index), candidate, sizeof(candidate)) != 0) continue;
    if (name != candidate) continue;
    if (list.asioGetDriverCLSID(static_cast<int>(index), &clsid) != 0) break;
    found = true;
    break;
  }
  if (!found) {
    error = "the ASIO driver '" + name + "' is not installed";
    return nullptr;
  }
  void* instance = nullptr;
  const HRESULT result = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, clsid, &instance);
  if (FAILED(result) || instance == nullptr) {
    char buffer[32] = {};
    std::snprintf(buffer, sizeof(buffer), "0x%08lx", static_cast<unsigned long>(result));
    error = "the ASIO driver '" + name + "' could not be loaded (COM " + buffer + ")";
    return nullptr;
  }
  return static_cast<IASIO*>(instance);
}

/** Opens a driver, reads what can be asked before a stream exists, and lets it go. */
DriverProbe probeDriver(const std::string& name) {
  DriverProbe probe;
  std::string error;
  IASIO* driver = createDriver(name, error);
  if (driver == nullptr) {
    probe.reason = error;
    return probe;
  }

  char driverName[32] = {};
  if (driver->init(nullptr)) {
    driver->getDriverName(driverName);
    long inputs = 0;
    long outputs = 0;
    const ASIOError channelResult = driver->getChannels(&inputs, &outputs);
    if (channelResult == ASE_OK && outputs > 0) {
      probe.available = true;
      probe.channels = static_cast<int>(outputs);
      ASIOSampleRate current = 0.0;
      if (driver->getSampleRate(&current) == ASE_OK && current > 0.0) {
        probe.rates.push_back(static_cast<int>(current + 0.5));
      }
      for (double rate : kProbeRates) {
        if (driver->canSampleRate(rate) != ASE_OK) continue;
        const int value = static_cast<int>(rate + 0.5);
        if (std::find(probe.rates.begin(), probe.rates.end(), value) == probe.rates.end()) {
          probe.rates.push_back(value);
        }
      }
      std::sort(probe.rates.begin(), probe.rates.end());
      ASIOChannelInfo channel = {};
      channel.channel = 0;
      channel.isInput = ASIOFalse;
      if (driver->getChannelInfo(&channel) == ASE_OK) {
        const int raw = static_cast<int>(channel.type);
        if (isWritableSampleType(raw)) {
          switch (toSampleType(raw)) {
            case SampleType::Int16Msb:
            case SampleType::Int16Lsb: probe.format = ma_format_s16; break;
            case SampleType::Int24Msb:
            case SampleType::Int24Lsb: probe.format = ma_format_s24; break;
            case SampleType::Float32Msb:
            case SampleType::Float32Lsb: probe.format = ma_format_f32; break;
            default: probe.format = ma_format_s32; break;
          }
        }
      }
    } else if (outputs == 0 && channelResult == ASE_OK) {
      probe.reason = "the driver has no outputs";
    } else {
      probe.reason = "the driver would not say how many channels it has (" + asioErrorText(channelResult) + ")";
    }
  } else {
    char driverError[124] = {};
    driver->getErrorMessage(driverError);
    probe.reason = std::string("the driver would not initialize") +
                   (driverError[0] != '\0' ? std::string(": ") + driverError : std::string());
  }

  driver->Release();
  return probe;
}

/** The driver's probe, from the host's cache or from the driver itself. */
DriverProbe probeOf(AsioHost& host, const std::string& name) {
  std::lock_guard<std::mutex> lock(host.probeMutex);
  auto it = host.probes.find(name);
  if (it != host.probes.end()) return it->second;
  DriverProbe probe = probeDriver(name);
  host.probes[name] = probe;
  return probe;
}

/** Stops, disposes and releases the driver, in that order, whichever of them exists. */
void releaseDriver(AsioHost& host) {
  if (host.driver != nullptr) {
    if (host.started) {
      host.driver->stop();
      host.started = false;
    }
    if (host.buffersCreated) {
      host.driver->disposeBuffers();
      host.buffersCreated = false;
    }
    host.driver->Release();
    host.driver = nullptr;
  }
  host.driverInitialised = false;
  host.driverName.clear();
  host.device = nullptr;
  host.driverOutputs = 0;
  host.activeChannels = 0;
  host.bufferFrames = 0;
  host.postOutput = false;
  host.started = false;
  g_preparedHost = nullptr;
}

/** One block out: the engine's render, then into the driver's own words and channels. */
void renderBlock(AsioHost& host, long bufferIndex) {
  const long frames = host.bufferFrames;
  const int channels = host.activeChannels;
  if (host.device == nullptr || frames <= 0 || channels <= 0) return;

  float* block = host.interleaved.data();
  ma_device_handle_backend_data_callback(host.device, block, nullptr, static_cast<ma_uint32>(frames));

  const int index = static_cast<int>(bufferIndex & 1);
  for (int channel = 0; channel < channels; channel++) {
    void* destination = host.infos[channel].buffers[index];
    if (destination == nullptr) continue;
    const SampleType type = host.types[channel];
    const int step = bytesPerSample(type);
    auto* out = static_cast<uint8_t*>(destination);
    const float* source = block + channel;
    for (long frame = 0; frame < frames; frame++) {
      writeSample(out, type, source[static_cast<size_t>(frame) * static_cast<size_t>(channels)]);
      out += step;
    }
  }
}

/** The one path both ASIO buffer callbacks take. */
void processBlock(long doubleBufferIndex) {
  AsioHost* host = g_preparedHost;
  if (host == nullptr || !host->started) return;
  host->lastCallbackMs.store(static_cast<int64_t>(steadyNowMs()), std::memory_order_release);
  host->callbacks.fetch_add(1, std::memory_order_relaxed);
  if (host->latencyDirty.exchange(false, std::memory_order_acq_rel)) {
    long inputLatency = 0;
    long outputLatency = 0;
    if (host->driver->getLatencies(&inputLatency, &outputLatency) == ASE_OK) host->outputLatencyFrames = outputLatency;
  }
  renderBlock(*host, doubleBufferIndex);
  // Tells a driver that converts for the hardware that this block is finished, which can
  // save it a block of latency. Only a driver that asked for it gets it.
  if (host->postOutput) host->driver->outputReady();
}

void bufferSwitch(long doubleBufferIndex, ASIOBool directProcess) {
  (void)directProcess;
  processBlock(doubleBufferIndex);
}

ASIOTime* bufferSwitchTimeInfo(ASIOTime* params, long doubleBufferIndex, ASIOBool directProcess) {
  (void)directProcess;
  processBlock(doubleBufferIndex);
  // The engine's clock is its own rendered frame count rather than the driver's sample
  // position, so the time info is not read — but what the driver handed us is handed
  // back, because a host that returns anything else is a host a driver may not trust.
  return params;
}

void sampleRateDidChange(ASIOSampleRate rate) {
  AsioHost* host = g_preparedHost;
  if (host == nullptr) return;
  std::lock_guard<std::mutex> lock(host->textMutex);
  char buffer[160] = {};
  std::snprintf(buffer, sizeof(buffer),
                "the driver changed its sample rate to %.0f Hz; the device was reopened", rate);
  host->restartReason = buffer;
  host->restartPending = true;
}

long asioMessages(long selector, long value, void* message, double* opt) {
  (void)message;
  (void)opt;
  AsioHost* host = g_preparedHost;
  switch (selector) {
    case kAsioSelectorSupported:
      switch (value) {
        case kAsioEngineVersion:
        case kAsioResetRequest:
        case kAsioResyncRequest:
        case kAsioLatenciesChanged:
        case kAsioSupportsTimeInfo:
        case kAsioSupportsTimeCode:
        case kAsioCanReportOverload:
        case kAsioOverload:
          return 1L;
        default:
          return 0L;
      }
    case kAsioEngineVersion:
      return 2L;  // ASIO 2.0: the version that has this callback at all
    case kAsioSupportsTimeInfo:
      return 1L;  // the driver may use bufferSwitchTimeInfo instead of bufferSwitch
    case kAsioSupportsTimeCode:
      return 0L;  // nothing here follows timecode
    case kAsioResetRequest:
      // The driver's own settings changed and it wants the stream rebuilt; its control
      // panel is the usual way that happens. It cannot be rebuilt from in here — this is
      // the driver's thread — so the request is recorded, and the engine's device health
      // check reopens the device on it.
      if (host != nullptr) {
        std::lock_guard<std::mutex> lock(host->textMutex);
        host->restartReason = "the driver asked to be reset (a change in its own settings); the device was reopened";
        host->restartPending = true;
      }
      return 1L;
    case kAsioResyncRequest:
      // Non-fatal data loss: the driver's timestamp is no longer trustworthy. Nothing
      // here follows the driver's clock, but a dropout is a dropout and is counted as one.
      if (host != nullptr) host->dropouts.fetch_add(1, std::memory_order_relaxed);
      return 1L;
    case kAsioLatenciesChanged:
      if (host != nullptr) host->latencyDirty.store(true, std::memory_order_release);
      return 1L;
    case kAsioCanReportOverload:
      return static_cast<long>(ASE_SUCCESS);  // yes: tell us when a block is dropped
    case kAsioOverload:
      if (host != nullptr) host->dropouts.fetch_add(1, std::memory_order_relaxed);
      return 1L;
    default:
      return 0L;
  }
}

ma_result onContextInit(ma_context* pContext, const ma_context_config* pConfig, ma_backend_callbacks* pCallbacks) {
  (void)pConfig;
  AsioHost* host = new (std::nothrow) AsioHost();
  if (host == nullptr) return MA_OUT_OF_MEMORY;
  pContext->pUserData = host;
  *pCallbacks = backendCallbacks();
  return MA_SUCCESS;
}

ma_result onContextUninit(ma_context* pContext) {
  AsioHost* host = hostOf(*pContext);
  if (host != nullptr) {
    DriverThread::instance().run([&]() { releaseDriver(*host); });
    delete host;
  }
  pContext->pUserData = nullptr;
  return MA_SUCCESS;
}

ma_result enumerateDevicesOnDriverThread(ma_context* pContext, ma_enum_devices_callback_proc callback, void* pUserData) {
  if (callback == nullptr) return MA_INVALID_ARGS;
  const std::vector<std::string> names = driverNames();
  for (const std::string& name : names) {
    ma_device_info info = {};
    copyStr(info.name, sizeof(info.name), name);
    copyStr(info.id.custom.s, sizeof(info.id.custom.s), name);
    // ASIO has no notion of a system default device: the host remembers which driver it
    // used last, not the operating system.
    info.isDefault = MA_FALSE;
    if (callback(pContext, ma_device_type_playback, &info, pUserData) == MA_FALSE) break;
  }
  return MA_SUCCESS;
}

ma_result getDeviceInfoOnDriverThread(ma_context* pContext, ma_device_type deviceType, const ma_device_id* pDeviceID,
                                      ma_device_info* pDeviceInfo) {
  if (deviceType != ma_device_type_playback) return MA_NOT_IMPLEMENTED;
  AsioHost* host = hostOf(*pContext);
  if (host == nullptr || pDeviceInfo == nullptr) return MA_INVALID_ARGS;

  std::string name;
  if (pDeviceID != nullptr) name = pDeviceID->custom.s;

  // With a device open, the running driver's own state is the truth. Probing another
  // driver would instantiate a second one while the first is streaming, which is exactly
  // what an interface cannot do.
  DriverProbe probe;
  if (host->driver != nullptr) {
    if (name.empty()) name = host->driverName;
    if (name == host->driverName) {
      probe.available = host->driverOutputs > 0;
      probe.channels = static_cast<int>(host->driverOutputs);
      probe.rates.push_back(static_cast<int>(host->sampleRate + 0.5));
      probe.format = ma_format_f32;
    }
  } else {
    if (name.empty()) {
      const std::vector<std::string> names = driverNames();
      if (names.empty()) return MA_NO_DEVICE;
      name = names.front();
    }
    probe = probeOf(*host, name);
    if (!probe.available) return MA_NO_DEVICE;
  }

  copyStr(pDeviceInfo->name, sizeof(pDeviceInfo->name), name);
  copyStr(pDeviceInfo->id.custom.s, sizeof(pDeviceInfo->id.custom.s), name);
  pDeviceInfo->isDefault = MA_FALSE;
  pDeviceInfo->nativeDataFormatCount = 0;

  const ma_format format = probe.format != ma_format_unknown ? probe.format : ma_format_f32;
  const ma_uint32 channels = static_cast<ma_uint32>(probe.channels > 0 ? probe.channels : 1);
  for (int rate : probe.rates) {
    if (pDeviceInfo->nativeDataFormatCount >= std::size(pDeviceInfo->nativeDataFormats)) break;
    auto& entry = pDeviceInfo->nativeDataFormats[pDeviceInfo->nativeDataFormatCount++];
    entry.format = format;
    entry.channels = channels;
    entry.sampleRate = static_cast<ma_uint32>(rate);
    entry.flags = MA_DATA_FORMAT_FLAG_EXCLUSIVE_MODE;
  }
  if (pDeviceInfo->nativeDataFormatCount == 0) {
    auto& entry = pDeviceInfo->nativeDataFormats[pDeviceInfo->nativeDataFormatCount++];
    entry.format = format;
    entry.channels = channels;
    entry.sampleRate = 48000;
    entry.flags = MA_DATA_FORMAT_FLAG_EXCLUSIVE_MODE;
  }
  return MA_SUCCESS;
}

ma_result initDeviceOnDriverThread(ma_device* pDevice, const ma_device_config* pConfig, ma_device_descriptor* pDescriptorPlayback) {
  AsioHost* host = hostOf(*pDevice->pContext);
  if (host == nullptr) return MA_INVALID_OPERATION;
  if (pConfig->deviceType != ma_device_type_playback) return MA_NOT_IMPLEMENTED;
  if (host->driver != nullptr) return MA_DEVICE_NOT_INITIALIZED;

  std::string name;
  if (pConfig->playback.pDeviceID != nullptr) name = pConfig->playback.pDeviceID->custom.s;
  if (name.empty()) {
    const std::vector<std::string> names = driverNames();
    if (names.empty()) {
      setMessage(*host, "no ASIO driver is installed on this machine");
      return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
    }
    name = names.front();
  }

  std::string error;
  host->driver = createDriver(name, error);
  if (host->driver == nullptr) {
    setMessage(*host, error);
    return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
  }
  host->driverName = name;

  if (!host->driver->init(nullptr)) {
    char driverError[124] = {};
    host->driver->getErrorMessage(driverError);
    setMessage(*host, "cannot open the ASIO driver '" + name + "'" +
                          (driverError[0] != '\0' ? std::string(": ") + driverError
                                                  : std::string(": the driver would not initialize")));
    releaseDriver(*host);
    return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
  }
  host->driverInitialised = true;

  long inputs = 0;
  long outputs = 0;
  ASIOError result = host->driver->getChannels(&inputs, &outputs);
  if (result != ASE_OK || outputs <= 0) {
    setMessage(*host, "the ASIO driver '" + name + "' has no outputs" +
                          (result == ASE_OK ? std::string() : " (" + asioErrorText(result) + ")"));
    releaseDriver(*host);
    return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
  }
  host->driverOutputs = outputs;

  // How many of the driver's outputs to open. What the operator asked for wins (the
  // engine's channel setting), capped by what the mixer can fill and by what the driver
  // has; with nothing asked for, the whole interface.
  const long requested = pConfig->playback.channels > 0 ? static_cast<long>(pConfig->playback.channels) : outputs;
  long active = std::min(requested, static_cast<long>(kChannelCap));
  active = std::min(active, outputs);
  if (active <= 0) active = 1;
  host->activeChannels = static_cast<int>(active);
  if (outputs > active) {
    setNote(*host, "the driver offers " + std::to_string(outputs) + " outputs; this engine plays to " +
                       std::to_string(active) + " (the channel setting, capped at " + std::to_string(kChannelCap) + ")");
  }

  // Sample rate: the driver is asked for the rate the operator chose, and keeps its own
  // if it will not do it (an externally clocked interface). The engine's resampler covers
  // the difference, and the engine says so in its own words.
  ASIOSampleRate rate = 0.0;
  if (host->driver->getSampleRate(&rate) != ASE_OK) rate = 0.0;
  const double requestedRate = pConfig->sampleRate > 0 ? static_cast<double>(pConfig->sampleRate) : 0.0;
  if (requestedRate > 0.0 && std::fabs(rate - requestedRate) > 0.5) {
    if (host->driver->canSampleRate(requestedRate) == ASE_OK && host->driver->setSampleRate(requestedRate) == ASE_OK) {
      if (host->driver->getSampleRate(&rate) != ASE_OK) rate = requestedRate;
    }
  }
  if (!(rate > 0.0)) rate = requestedRate > 0.0 ? requestedRate : 48000.0;  // a driver that will not say
  host->sampleRate = rate;

  long minSize = 0;
  long maxSize = 0;
  long preferredSize = 0;
  long granularity = 0;
  result = host->driver->getBufferSize(&minSize, &maxSize, &preferredSize, &granularity);
  if (result != ASE_OK) {
    setMessage(*host, "the ASIO driver '" + name + "' would not say what buffer sizes it takes (" +
                          asioErrorText(result) + ")");
    releaseDriver(*host);
    return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
  }
  const long requestedSize = pConfig->periodSizeInFrames > 0 ? static_cast<long>(pConfig->periodSizeInFrames) : 0;
  const long bufferFrames = chooseBufferSize(requestedSize, minSize, maxSize, preferredSize, granularity);
  if (bufferFrames <= 0) {
    setMessage(*host, "the ASIO driver '" + name + "' reported no usable buffer size");
    releaseDriver(*host);
    return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
  }
  if (bufferFrames > static_cast<long>(kMaxOutputFrames)) {
    setMessage(*host, "the ASIO driver '" + name + "' will not run a buffer smaller than " +
                          std::to_string(bufferFrames) + " frames; this engine's limit is " +
                          std::to_string(kMaxOutputFrames));
    releaseDriver(*host);
    return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
  }
  host->bufferFrames = bufferFrames;

  // Only outputs are asked for: this engine plays.
  for (int channel = 0; channel < host->activeChannels; channel++) {
    host->infos[channel].isInput = ASIOFalse;
    host->infos[channel].channelNum = channel;
    host->infos[channel].buffers[0] = nullptr;
    host->infos[channel].buffers[1] = nullptr;
  }
  host->driverCallbacks.bufferSwitch = bufferSwitch;
  host->driverCallbacks.sampleRateDidChange = sampleRateDidChange;
  host->driverCallbacks.asioMessage = asioMessages;
  host->driverCallbacks.bufferSwitchTimeInfo = bufferSwitchTimeInfo;
  host->device = pDevice;
  g_preparedHost = host;
  result = host->driver->createBuffers(host->infos, host->activeChannels, bufferFrames, &host->driverCallbacks);
  if (result != ASE_OK) {
    setMessage(*host, "the ASIO driver '" + name + "' refused to create buffers of " + std::to_string(bufferFrames) +
                          " frames for " + std::to_string(host->activeChannels) + " channels (" + asioErrorText(result) + ")");
    releaseDriver(*host);
    return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
  }
  host->buffersCreated = true;

  // The word the driver wants each channel in, and the refusal if this build has no idea
  // what to do with one of them. Asked after the buffers exist, which is the order the
  // SDK's own host example uses.
  for (int channel = 0; channel < host->activeChannels; channel++) {
    ASIOChannelInfo channelInfo = {};
    channelInfo.channel = channel;
    channelInfo.isInput = ASIOFalse;
    if (host->driver->getChannelInfo(&channelInfo) != ASE_OK) {
      setMessage(*host, "the ASIO driver '" + name + "' would not describe its output channels");
      releaseDriver(*host);
      return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
    }
    const int raw = static_cast<int>(channelInfo.type);
    if (!isWritableSampleType(raw)) {
      const char* typeName = sampleTypeName(raw);
      setMessage(*host, "the ASIO driver '" + name + "' wants output channel " + std::to_string(channel) + " in " +
                            (typeName != nullptr ? std::string(typeName) : "sample type " + std::to_string(raw)) +
                            ", which this build cannot write");
      releaseDriver(*host);
      return MA_FAILED_TO_OPEN_BACKEND_DEVICE;
    }
    host->types[channel] = toSampleType(raw);
  }

  host->interleaved.assign(static_cast<size_t>(bufferFrames) * static_cast<size_t>(host->activeChannels), 0.0f);
  host->callbacks.store(0, std::memory_order_relaxed);
  host->dropouts.store(0, std::memory_order_relaxed);
  host->latencyDirty.store(false, std::memory_order_relaxed);
  host->lastCallbackMs.store(0, std::memory_order_relaxed);
  host->started = false;
  {
    std::lock_guard<std::mutex> lock(host->textMutex);
    host->message.clear();
    host->restartPending = false;
    host->restartReason.clear();
  }

  long inputLatency = 0;
  long outputLatency = 0;
  host->outputLatencyFrames = host->driver->getLatencies(&inputLatency, &outputLatency) == ASE_OK ? outputLatency : 0;
  host->postOutput = host->driver->outputReady() == ASE_OK;

  pDescriptorPlayback->format = ma_format_f32;  // the engine renders f32; the driver's own
                                                // word is written by this backend on the way out
  pDescriptorPlayback->channels = static_cast<ma_uint32>(host->activeChannels);
  pDescriptorPlayback->sampleRate = static_cast<ma_uint32>(rate + 0.5);
  pDescriptorPlayback->periodSizeInFrames = static_cast<ma_uint32>(bufferFrames);
  pDescriptorPlayback->periodSizeInMilliseconds = 0;
  pDescriptorPlayback->periodCount = 1;  // one buffer per callback; the driver double-buffers
  if (pDescriptorPlayback->channelMap[0] == MA_CHANNEL_NONE) {
    ma_channel_map_init_standard(ma_standard_channel_map_default, pDescriptorPlayback->channelMap,
                                 std::size(pDescriptorPlayback->channelMap), pDescriptorPlayback->channels);
  }
  return MA_SUCCESS;
}

ma_result uninitDeviceOnDriverThread(ma_device* pDevice) {
  AsioHost* host = hostOf(*pDevice->pContext);
  if (host != nullptr) releaseDriver(*host);
  return MA_SUCCESS;
}

ma_result startDeviceOnDriverThread(ma_device* pDevice) {
  AsioHost* host = hostOf(*pDevice->pContext);
  if (host == nullptr || host->driver == nullptr || !host->buffersCreated) return MA_DEVICE_NOT_INITIALIZED;

  // The ASIO contract is that the second half of the double buffer holds the audio the
  // hardware will play while the host fills the first, because the driver has nothing else
  // to send until the first callback. It is primed with silence: the engine has not
  // rendered a block yet, and it renders its first block from the first callback. Both
  // halves are cleared rather than only the one the contract names, because which half the
  // driver plays first is the driver's business and a garbage block at start is a click.
  for (int channel = 0; channel < host->activeChannels; channel++) {
    const size_t bytes = static_cast<size_t>(bytesPerSample(host->types[channel])) *
                         static_cast<size_t>(host->bufferFrames);
    for (int half = 0; half < 2; half++) {
      if (host->infos[channel].buffers[half] != nullptr) std::memset(host->infos[channel].buffers[half], 0, bytes);
    }
  }

  const ASIOError result = host->driver->start();
  if (result != ASE_OK) {
    setMessage(*host, "the ASIO driver '" + host->driverName + "' would not start (" + asioErrorText(result) + ")");
    return MA_FAILED_TO_START_BACKEND_DEVICE;
  }
  host->started = true;
  host->lastCallbackMs.store(static_cast<int64_t>(steadyNowMs()), std::memory_order_release);
  return MA_SUCCESS;
}

ma_result stopDeviceOnDriverThread(ma_device* pDevice) {
  AsioHost* host = hostOf(*pDevice->pContext);
  if (host == nullptr || host->driver == nullptr) return MA_SUCCESS;
  if (host->started) {
    host->driver->stop();
    host->started = false;
  }
  return MA_SUCCESS;
}

}  // namespace

/**
 * Every driver call below that is not the driver's own callback is made on the driver
 * thread (see DriverThread). These six functions are the whole of the engine's contact with
 * the driver: enumeration, device details, open, start, stop and close, each one task.
 */
ma_result onContextEnumerateDevices(ma_context* pContext, ma_enum_devices_callback_proc callback, void* pUserData) {
  return DriverThread::instance().run([&]() { return enumerateDevicesOnDriverThread(pContext, callback, pUserData); });
}

ma_result onContextGetDeviceInfo(ma_context* pContext, ma_device_type deviceType, const ma_device_id* pDeviceID,
                                 ma_device_info* pDeviceInfo) {
  return DriverThread::instance().run(
      [&]() { return getDeviceInfoOnDriverThread(pContext, deviceType, pDeviceID, pDeviceInfo); });
}

ma_result onDeviceInit(ma_device* pDevice, const ma_device_config* pConfig, ma_device_descriptor* pDescriptorPlayback,
                       ma_device_descriptor* pDescriptorCapture) {
  (void)pDescriptorCapture;
  return DriverThread::instance().run([&]() { return initDeviceOnDriverThread(pDevice, pConfig, pDescriptorPlayback); });
}

ma_result onDeviceStart(ma_device* pDevice) {
  return DriverThread::instance().run([&]() { return startDeviceOnDriverThread(pDevice); });
}

ma_result onDeviceStop(ma_device* pDevice) {
  return DriverThread::instance().run([&]() { return stopDeviceOnDriverThread(pDevice); });
}

ma_result onDeviceUninit(ma_device* pDevice) {
  return DriverThread::instance().run([&]() { return uninitDeviceOnDriverThread(pDevice); });
}

ma_backend_callbacks backendCallbacks() {
  ma_backend_callbacks callbacks = {};
  callbacks.onContextInit = onContextInit;
  callbacks.onContextUninit = onContextUninit;
  callbacks.onContextEnumerateDevices = onContextEnumerateDevices;
  callbacks.onContextGetDeviceInfo = onContextGetDeviceInfo;
  callbacks.onDeviceInit = onDeviceInit;
  callbacks.onDeviceUninit = onDeviceUninit;
  callbacks.onDeviceStart = onDeviceStart;
  callbacks.onDeviceStop = onDeviceStop;
  // No onDeviceRead/onDeviceWrite and no onDeviceDataLoop: that combination is what tells
  // miniaudio the backend is asynchronous, so it runs no thread of its own and the
  // driver's thread arrives through the callbacks above.
  callbacks.onDeviceRead = nullptr;
  callbacks.onDeviceWrite = nullptr;
  callbacks.onDeviceDataLoop = nullptr;
  callbacks.onDeviceDataLoopWakeup = nullptr;
  callbacks.onDeviceGetInfo = nullptr;
  return callbacks;
}

bool contextStalled(const ma_context& context) {
  AsioHost* host = hostOf(context);
  if (host == nullptr || !host->started) return false;
  const int64_t last = host->lastCallbackMs.load(std::memory_order_acquire);
  const int64_t now = static_cast<int64_t>(steadyNowMs());
  if (last == 0 || now - last <= kCallbackTimeoutMs) return false;
  setMessage(*host, "the ASIO driver '" + host->driverName + "' has not called back for " +
                        std::to_string(now - last) + " ms; the stream is not running");
  return true;
}

bool takeRestartRequest(const ma_context& context, std::string& reason) {
  AsioHost* host = hostOf(context);
  if (host == nullptr) return false;
  std::lock_guard<std::mutex> lock(host->textMutex);
  if (!host->restartPending) return false;
  host->restartPending = false;
  reason = host->restartReason;
  return true;
}

uint64_t takeDropouts(const ma_context& context) {
  AsioHost* host = hostOf(context);
  if (host == nullptr) return 0;
  return host->dropouts.exchange(0, std::memory_order_acq_rel);
}

double contextLatencyMs(const ma_context& context) {
  AsioHost* host = hostOf(context);
  if (host == nullptr || host->outputLatencyFrames <= 0 || !(host->sampleRate > 0.0)) return -1.0;
  return static_cast<double>(host->outputLatencyFrames) * 1000.0 / host->sampleRate;
}

std::string contextNote(const ma_context& context) {
  AsioHost* host = hostOf(context);
  if (host == nullptr) return std::string();
  std::lock_guard<std::mutex> lock(host->textMutex);
  return host->note;
}

std::string contextMessage(const ma_context& context) {
  AsioHost* host = hostOf(context);
  if (host == nullptr) return std::string();
  std::lock_guard<std::mutex> lock(host->textMutex);
  return host->message;
}

}  // namespace asio
}  // namespace ws

#endif  // WINSLAB_ASIO
