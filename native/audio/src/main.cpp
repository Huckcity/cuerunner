// cuerunner-audio — the Cuerunner native playback engine.
//
// Two modes:
//   serve      listen on a local socket and execute playback verbs (the app's path)
//   offline    render a script to a WAV with deterministic sample-level output (CI)
//
// Everything else (device enumeration, limits, capture tee) is a flag on those.
#include "engine.h"
#include "offline.h"
#include "ltc.h"
#include "protocol.h"
#include "transport.h"
#include "util.h"

#include <clocale>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

ws::SocketServer* g_server = nullptr;
std::atomic<int> g_clientCount{0};

// With nobody connected, the engine must not keep a device open and a show playing: it
// silences everything and then exits unless a client comes back.
constexpr int kClientGraceSeconds = 3;

/** A dev declaration's ceiling. A protocol number is a small count; past this it is a typo. */

void onSignal(int) {
  if (g_server != nullptr) g_server->requestStop();
}

void usage() {
  std::fprintf(stderr,
               "cuerunner-audio %s\n"
               "usage:\n"
               "  cuerunner-audio --socket <path> [options]\n"
               "  cuerunner-audio --offline-render <script.json> --out <out.wav> [--events <events.jsonl>] [options]\n"
               "  cuerunner-audio --list-devices [options]\n"
               "options:\n"
               "  --backend <auto|wasapi|coreaudio|alsa|pulseaudio|jack|asio|silent|offline>\n"
               "  --device <id>              device id from --list-devices\n"
               "  --sample-rate <hz>         default 48000\n"
               "  --channels <n>             default: device channels\n"
               "  --exclusive <0|1>          request exclusive device access (WASAPI/CoreAudio)\n"
               "  --buffer-frames <n>        device period in frames, default 512\n"
               "  --capture <file.wav>       tee mixed output to a float WAV (dev/test)\n"
               "  --cache-max-bytes <n>      decoded cache byte budget (default: the declaration)\n"
               "  --cache-max-files <n>      decoded cache file count\n"
               "  --cache-max-file-bytes <n> files above this decoded size stream instead\n"
               "  --stream-preroll-ms <n>    decoded audio kept ahead per stream\n"
               "  --stream-max-bytes-per-voice <n>\n"
               "                             ring byte cap per streaming voice (0 = the declared bound)\n"
               "  --stream-max-total-bytes <n>\n"
               "                             total streaming budget (0 = no budget)\n"
               "  --schedule-horizon-ms <n>  how far ahead a stamped verb may be scheduled\n"
               "  --frames <n>               offline: render exactly this many frames\n"
               "  --protocol                 print the wire declaration: the protocol, every verb, every event and the shared bounds\n"
               "  --version\n",
               ws::kEngineVersion);
}

bool nextValue(int argc, char** argv, int& index, std::string& out) {
  if (index + 1 >= argc) return false;
  out = argv[++index];
  return true;
}

bool parseArgs(int argc, char** argv, ws::EngineOptions& engine, std::string& socketPath, std::string& scriptPath,
               std::string& outPath, std::string& eventsPath, bool& listDevices, bool& version, bool& protocol,
               int64_t& frames) {
  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    std::string value;
    if (arg == "--socket") {
      if (!nextValue(argc, argv, i, socketPath)) return false;
    } else if (arg == "--backend") {
      if (!nextValue(argc, argv, i, engine.backend)) return false;
    } else if (arg == "--device") {
      if (!nextValue(argc, argv, i, engine.deviceId)) return false;
    } else if (arg == "--sample-rate") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.sampleRate = std::atoi(value.c_str());
    } else if (arg == "--channels") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.channels = std::atoi(value.c_str());
    } else if (arg == "--exclusive") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.exclusive = value == "1" || value == "true";
    } else if (arg == "--buffer-frames") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.bufferFrames = std::atoi(value.c_str());
    } else if (arg == "--capture") {
      if (!nextValue(argc, argv, i, engine.capturePath)) return false;
    } else if (arg == "--cache-max-bytes") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.cacheMaxBytes = std::atoll(value.c_str());
    } else if (arg == "--cache-max-files") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.cacheMaxFiles = std::atoi(value.c_str());
    } else if (arg == "--cache-max-file-bytes") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.cacheMaxFileBytes = std::atoll(value.c_str());
    } else if (arg == "--stream-preroll-ms") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.streamPrerollMs = std::atoll(value.c_str());
    } else if (arg == "--stream-max-bytes-per-voice") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.streamMaxBytesPerVoice = std::atoll(value.c_str());
    } else if (arg == "--stream-max-total-bytes") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.streamMaxTotalBytes = std::atoll(value.c_str());
    } else if (arg == "--schedule-horizon-ms") {
      if (!nextValue(argc, argv, i, value)) return false;
      engine.scheduleHorizonMs = std::atoll(value.c_str());
    } else if (arg == "--offline-render") {
      if (!nextValue(argc, argv, i, scriptPath)) return false;
    } else if (arg == "--out") {
      if (!nextValue(argc, argv, i, outPath)) return false;
    } else if (arg == "--events") {
      if (!nextValue(argc, argv, i, eventsPath)) return false;
    } else if (arg == "--frames") {
      if (!nextValue(argc, argv, i, value)) return false;
      frames = std::atoll(value.c_str());
    } else if (arg == "--list-devices") {
      listDevices = true;
    } else if (arg == "--protocol") {
      protocol = true;
    } else if (arg == "--version") {
      version = true;
    } else if (arg == "--help" || arg == "-h") {
      usage();
      std::exit(0);
    } else {
      std::fprintf(stderr, "unknown option '%s'\n", arg.c_str());
      return false;
    }
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  // A path arrives from the app as UTF-8, and this engine opens files with the C runtime's
  // narrow functions — `fopen`, `stat`, and the decoders' own `*_init_file`. On Windows
  // those read a narrow path in the machine's ANSI code page unless told otherwise, so any
  // character outside ASCII named a file that was not there: a show kept under "Théâtre",
  // and the demo's own audio for anybody whose Windows user name has an accent in it,
  // because the demo is copied into their profile. With the character type set to UTF-8
  // the runtime converts the path as the UTF-8 it is. Only the character type: the number
  // format stays the C locale's, which is what the JSON on the wire is written in. A
  // runtime too old to know the code page answers null and is left as it was.
  std::setlocale(LC_CTYPE, ".UTF8");
#endif
  // `--ltc-decode <file.wav> [--channel <n>]`: reads the LTC on one channel of a file and
  // prints every frame it found — the native timecode test's reader (ltc.h). Handled
  // before the engine's own flags, because it opens no engine at all.
  if (argc >= 3 && std::string(argv[1]) == "--ltc-decode") {
    int channel = 0;
    if (argc >= 5 && std::string(argv[3]) == "--channel") channel = std::atoi(argv[4]);
    return ws::printLtcDecode(argv[2], channel);
  }
  ws::EngineOptions engineOptions;
  std::string socketPath;
  std::string scriptPath;
  std::string outPath;
  std::string eventsPath;
  bool listDevices = false;
  bool version = false;
  bool protocol = false;
  int64_t frames = -1;

  if (!parseArgs(argc, argv, engineOptions, socketPath, scriptPath, outPath, eventsPath, listDevices, version,
                 protocol, frames)) {
    usage();
    return 2;
  }
  if (protocol) {
    // The declaration this engine carries, as JSON — the verbs it validates requests
    // with, the bounds both ends share and the protocol connections open with.
    // src/main/audio/audioWire.test.ts compares it with the ones in src/shared/audio.ts.
    const std::string declaration = ws::wireDeclarationJson();
    std::printf("%s\n", declaration.c_str());
    return 0;
  }
  if (version) {
    std::printf("{\"name\":\"cuerunner-audio\",\"version\":\"%s\",\"protocol\":%d}\n", ws::kEngineVersion,
                ws::kWireProtocolVersion);
    return 0;
  }
  if (!scriptPath.empty()) {
    ws::OfflineOptions options;
    options.scriptPath = scriptPath;
    options.outPath = outPath.empty() ? std::string("offline.wav") : outPath;
    options.eventsPath = eventsPath;
    options.maxFrames = frames;
    return ws::runOfflineRender(engineOptions, options);
  }
  if (listDevices) {
    // The engine is several MiB of embedded queues, and Windows gives a thread one MiB of
    // stack: every Engine lives on the heap, on every path, so startup cannot overflow
    // before the process has printed a word. (It did: main died with 0xC00000FD.)
    // Its options come in at construction because nothing here calls start(): the list is
    // of the backend the caller named, not of whatever the platform defaults to.
    auto engine = std::make_unique<ws::Engine>(engineOptions);
    std::vector<ws::DeviceDTO> devices;
    ws::EngineError error;
    if (!engine->devices(devices, error)) {
      std::fprintf(stderr, "cannot enumerate devices: %s\n", error.message.c_str());
      return 3;
    }
    std::printf("{\"devices\":[");
    for (size_t i = 0; i < devices.size(); i++) {
      const ws::DeviceDTO& device = devices[i];
      std::printf("%s{\"id\":\"%s\",\"name\":\"%s\",\"isDefault\":%s,\"channels\":%d,\"defaultSampleRate\":%d,"
                  "\"minSampleRate\":%d,\"maxSampleRate\":%d,\"exclusive\":%s}",
                  i == 0 ? "" : ",", ws::jsonEscape(device.id).c_str(), ws::jsonEscape(device.name).c_str(),
                  device.isDefault ? "true" : "false", device.channels, device.defaultSampleRate,
                  device.minSampleRate, device.maxSampleRate, device.exclusive ? "true" : "false");
    }
    std::printf("]}\n");
    return 0;
  }
  if (socketPath.empty()) {
    usage();
    return 2;
  }

  auto engine = std::make_unique<ws::Engine>();
  ws::EngineError startError;
  if (!engine->start(engineOptions, startError)) {
    std::fprintf(stderr, "audio engine failed to start: %s (%s)\n", startError.message.c_str(),
                 startError.code.c_str());
    return 3;
  }

  ws::SocketServer server(*engine);
  g_server = &server;
  engine->setEventCallback([&server, &engine](const ws::Event& event) {
    const std::string line = ws::eventLine(event, engine->sessionId());
    if (!line.empty()) server.broadcast(line);
  });

  std::signal(SIGINT, onSignal);
  std::signal(SIGTERM, onSignal);

  server.setClientCountCallback([](int count) {
    g_clientCount.store(count);
    if (count == 0) return;  // handled by the watchdog below
    std::fprintf(stderr, "[cuerunner-audio] client connected (%d)\n", count);
  });

  std::string listenError;
  if (!server.listen(socketPath, listenError)) {
    std::fprintf(stderr, "%s\n", listenError.c_str());
    engine->stop();
    return 3;
  }

  std::thread watchdog([&server, &engine] {
    // Give the first client a generous window to connect, then treat an empty room as
    // the end of the session.
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    bool silenced = false;
    for (;;) {
      std::this_thread::sleep_for(std::chrono::milliseconds(200));
      const int count = g_clientCount.load();
      if (count > 0) {
        deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kClientGraceSeconds);
        silenced = false;
        continue;
      }
      if (std::chrono::steady_clock::now() < deadline) continue;
      if (!silenced) {
        std::fprintf(stderr, "[cuerunner-audio] no client connected; silencing and exiting\n");
        ws::CommandResultDTO ignored;
        ws::EngineError ignoredError;
        engine->stopAll(0.0, ignored, ignoredError);
        silenced = true;
        deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kClientGraceSeconds);
        continue;
      }
      server.requestStop();
      return;
    }
  });
  watchdog.detach();

  server.serve();
  engine->stop();
  return 0;
}
