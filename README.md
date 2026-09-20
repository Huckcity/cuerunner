# Cuerunner

A cross-platform **QLab alternative** for Windows and macOS — professional show-control software for managing audio, MIDI, OSC, and network cues in live performance and broadcast environments.

Built with Electron, React, TypeScript, and Zustand. Source-available under the [Functional Source License 1.1, MIT future license](./LICENSE) — see [License](#license).

**Documentation lives on the site**, not here:

- [Guides](https://huckcity.github.io/cuerunner/guide.html) — first show, building a cue
  list, working with sound, running the show, and the Pro features. Source in
  [`website/docs/guides.mjs`](./website/docs/guides.mjs).
- [Reference](https://huckcity.github.io/cuerunner/reference/index.html) — every cue type
  and field, every setting, the keyboard table, the OSC and MIDI messages Cuerunner answers
  to, the script API and the file formats. Source in
  [`website/docs/reference.mjs`](./website/docs/reference.mjs).

Both are generated: edit the content modules and run `node website/build-docs.mjs`.

This README is for people building Cuerunner rather than running a show with it.

## What it is

An Electron app with three layers — main process, preload bridge, renderer — talking
exclusively over IPC. The renderer has no Node access; the audio engine is a native
process of its own, so a renderer crash does not stop the sound.

The **cue stack is free**: eleven cue types, groups and timelines, the waveform editor,
the run log, workspaces, undo — and the ears it needs: OSC and MIDI input, cue triggers,
and the monitor that shows what arrived. **Cuerunner Pro** is the show around it —
wireless and the mic plot, scenes and the desk, the script panel with its tablet view,
redundant playback, and the showfile as a versionable artifact: what each save changed, a
comparison with another version, two people's copies merged, and the show and its media
bundled into one `.cuerunnerx`. One key, checked offline on the machine; see
[Cuerunner Pro](#cuerunner-pro) for how keys are issued.

## Getting Started

### What it needs to run

The audio engine is the part with a deadline: it has to render faster than the audio it plays.
`node native/audio/tests/matrix-bench.mjs` renders the heaviest supported mix — 24 voices ×
32 outputs × 64 crosspoints, resampling live, 44.1 kHz sources into a 48 kHz device — through the
same offline engine the acceptance suite drives, and exits non-zero below 2x realtime. That floor
is a gate rather than a result: the benchmark runs on every pull request, so a machine that cannot
keep up fails the build, while the multiple any one machine reaches is the benchmark's own output
and is not published here.

- **CPU**: any 64-bit machine from the last decade, two cores or more. What playback depends on
  is one core's throughput rather than core count. Four cores is comfortable, and is what this
  project is tested on.
- **Memory**: 8 GB. The decoded-audio cache is bounded by design — 512 MB, 100 files, and any
  single file whose decoded form would exceed 32 MB (about 90 seconds of stereo at 48 kHz)
  streams from disk instead of being held — so memory does not grow with file length.
- **Disk**: any. A stereo voice streams at roughly 380 KB/s, and a cue deep inside a long
  recording is entered through a seek table rather than decoded from its start. An SSD shortens
  show loading, not playback.
- **Graphics**: none required. Software rendering works; a GPU is nicer to look at.
- **OS**: Windows 10+, macOS 12+, or 64-bit Linux.

If a machine cannot keep up, that shows up rather than hiding: the engine counts the audio it
could not fill and warns about it, the show clock keeps wall time through a stall instead of
drifting, and a desk or console it cannot reach says so. The bounds themselves are held by the
acceptance suite in `native/audio/tests/`.

### Prerequisites

- Node 24 (what CI builds and tests on; Node 26 is exercised too)
- npm or yarn
- macOS 12+, Windows 10+, or Linux (for building)

### Installation

```bash
# Clone the repository
git clone https://github.com/Huckcity/cuerunner.git
cd cuerunner

# Install dependencies (add --legacy-peer-deps if npm reports ERESOLVE)
npm install

# Start dev server with hot reload
npm run dev
```

> **npm 11.16+ / v12**: Install scripts (native compilation for `midi`, Electron binary download, `esbuild` binary) require explicit approval. This project ships an `allowScripts` allowlist in `package.json` that pre-approves these packages. If you see "install scripts blocked" warnings or `Error: Electron uninstall` when launching, the project's postinstall step patches the known Node 26 zip-extraction bug, detects a missing Electron binary, repairs it automatically, and prints manual recovery steps if that fails.

### Try the demo workspace

Every build ships a demo show — `resources/demo/Demo Show.cuerunner` — with one of each cue type
covered: a sequence group, a timeline group, audio with fades, MIDI, OSC, a network request, a
script, and a stop cue. Open it from **Cuerunner ▾ → Open Demo Workspace**, or from the button in
an empty cue list. It opens as an unsaved example (so Save asks where to put your copy, and
never writes over the bundled file) and its audio is copied into the app's user data folder on
open, which is where its cues read it from.

### Development Commands

```bash
npm run dev                # Start electron-vite dev server with hot reload
npm run typecheck          # TypeScript type check (no emit)
npm test                   # Run unit tests (Vitest)
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Generate coverage report
npm run test:e2e          # Run E2E tests (Playwright, requires build; private display on Linux)
npm run test:e2e:headed   # Run E2E tests on your own display, so you can watch them
npm run build             # Build TypeScript/React only (no packaging)
npm run preview           # Preview built app without packaging
npm run dist              # Build and package for all platforms
npm run dist:win          # Build and package for Windows only
npm run dist:mac          # Build and package for macOS only
npm run dist:linux        # Build and package for Linux only (AppImage)
npm run screenshots       # Regenerate website/assets/guide images (requires build)
npm run site              # Serve website/ locally on http://localhost:8080
```

`npm run screenshots` launches the built app, opens the demo workspace that ships with it, and
rewrites every image used by the user guide. Run it after any UI change so the guide cannot
drift from the product — and after a demo change, so the guide shows the demo users get.

`npm run site` serves `website/` with no dependencies, so a page can be reviewed locally
before it deploys. Pass a port to override the default: `npm run site -- 3000`. The
[GitHub Pages workflow](./.github/workflows/deploy-website.yml) publishes the same directory
on every push to `main` that touches `website/**`.

## Linux

Cuerunner ships an **experimental Linux AppImage**. Audio, OSC, network, and script cues work
normally. MIDI cues are **unavailable** on Linux unless you install ALSA development headers
(`libasound2-dev`) before installing dependencies — the native `midi` module needs them at
build time.

### Build from source

```bash
# Install ALSA headers (for MIDI support — optional otherwise)
sudo apt-get install -y libasound2-dev

# Clone and install
git clone https://github.com/Huckcity/cuerunner.git
cd cuerunner
npm install

# Run in development
npm run dev

# Package an AppImage into dist/
npm run dist:linux
```

The AppImage is written to `dist/Cuerunner-<version>.AppImage`. If your distro has no FUSE,
extract and run it instead:

```bash
./dist/Cuerunner-*.AppImage --appimage-extract-and-run
```

### Troubleshooting `Error: Electron uninstall`

`electron-vite` throws this when the Electron binary is missing from
`node_modules/electron/dist` (no `path.txt`).

On **Node 26** this happens on every fresh install: the Electron download succeeds, but
extracting the ~200 MB zip deadlocks inside `extract-zip`'s dependency `fd-slicer@1.1.0`,
which uses `stream.destroyed` as its own EOF flag — on Node 26 that property is backed by
stream state, so the extraction stream ends without emitting `end`, the process exits
silently, and `dist/` is left holding a single half-written file. (Verified: Node 24.9
extracts the same archive fine, Node 26.7 stalls.) CI builds on Node 24, which is why
released AppImages are unaffected.

`npm install` fixes this automatically: the project's postinstall patches `fd-slicer`, then
re-runs Electron's install script if the binary is missing. If you still end up without a
binary (offline, proxy, corrupt npm cache):

```bash
# 1. Re-run the project's postinstall (patches fd-slicer, retries Electron)
node scripts/postinstall.js

# 2. Verify Electron is working
npx electron --version

# 3. Last resort — clean reinstall
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

If Electron starts but aborts with *"The SUID sandbox helper binary was found, but is not
configured correctly"*, that's distro-wide Chromium sandbox policy, not Cuerunner: either fix
the helper (`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod
4755 node_modules/electron/dist/chrome-sandbox`) or launch with `ELECTRON_DISABLE_SANDBOX=1`.

## Architecture

Cuerunner is structured as an Electron app with three distinct layers communicating exclusively over IPC:

```
Renderer Layer (React/Zustand)
  ├─ window.cuerunner (IPC bridge via contextBridge)
  │   └─ src/preload/index.ts
  │
Main Process Layer
  ├─ src/main/ipc/handlers.ts (ipcMain.handle)
  │   ├─ MidiEngine (using 'midi' npm package)
  │   ├─ OscEngine (using 'node-osc')
  │   └─ WorkspaceManager (fs + file dialogs)
```

**Key principle**: The renderer has **no direct Node.js access**. All I/O (file operations, MIDI, OSC, audio loading) goes through the IPC bridge.

### Cue Data Model

All cues extend `CueBase` and are stored in a flat array with `parentId` pointers for grouping:

```typescript
type CueType = 
  | "audio"    // Play audio file with level/pan, fade-in, loop control
  | "midi"     // Send MIDI messages
  | "osc"      // Send OSC packets over network
  | "wait"     // Pause for specified duration
  | "fade"     // Gradually change target cue's volume/pan
  | "stop"     // Stop audio playback
  | "group"    // Sequence or randomly play child cues
  | "network"  // Make HTTP request
  | "script";  // Execute JavaScript
```

Key fields affecting playback:
- `preWait` / `postWait` — delays before/after execution (ms)
- `advance: 'none' | 'on-start' | 'on-end'` — auto-advance behavior
- `isArmed` — disarmed cues are skipped by GO button
- `parentId` — null for top-level; otherwise references parent group

### Network and Script Cues

**Network cues** make an HTTP request when they fire. The show waits for the response (or
the cue's timeout, 5 s by default) before moving on. The request is made in the main
process rather than in the window, so a target on the show network needs no CORS headers.

Every cue type shows a **Last Run** section in its own inspector tab: when it last fired,
how long it took, and the reason for any failure — the HTTP status and start of the
response body for network cues (cut off at 4000 characters with a truncation marker), the
message for a script that threw or timed out, or the port an audio, MIDI or OSC cue could
not reach. A cue that could not do what it says is marked failed rather than passed over;
an OSC message that leaves the machine and is never received still counts as sent, since
UDP reports nothing. Run results are runtime state — they are never written to the
`.cuerunner` file.

The **log panel** (LOG button in the transport bar) records every firing: when the cue
started, what it did, the response status, and any failure. Script cues also send their
`console.log()` / `console.error()` output there, and `shell()` output is logged whether or
not the script prints it — this is the only place to read script output in a packaged
build, which has no DevTools. The log is a bounded session history (the last 500 entries)
and is not saved.

**Script cues** run JavaScript on a worker thread of their own, so a script that never
yields cannot freeze the interface: the timeout (a cue field, 60000 ms by default, 0 for
none) stops it and records a failure, and STOP or PANIC stops it early. `await` works, and
the cue waits for the script to finish. Two helpers are in scope:

- `shell(command, { timeout, cwd, env })` — runs a system command and resolves
  `{ stdout, stderr, code, signal }`. Commands start in the workspace folder and time out
  after 10 s by default.
- `include('path/to/file.js')` — runs another JavaScript file and resolves what it returned.
  Each file is read and run once per script run, wherever it is included from; an include inside
  an included file resolves against that file, and a cycle between files is reported as an error.

The script has no access to the interface (no `document`, no `window`); the helpers above
are the whole surface.

Script cues are not sandboxed — a workspace file is executable code, so only open `.cuerunner`
files you trust.

### Playback Engine

`CueRunner` (in `src/renderer/src/engine/CueRunner.ts`) is a singleton that sequences cue execution:

1. **Execution sequence**: pre-wait → execute → post-wait → onDone callback
2. **Groups**: Can run children sequentially or randomly
3. **Auto-advance**: Fires next cue either immediately after pre-wait ("on-start") or after completion ("on-end"). Handing over is one-way: a cue stopped before its end releases nothing, so an on-end cue that is stopped never fires the next cue, and an on-start successor — already fired at start — is a run of its own, so stopping the first cue does not recall it.
4. **Timers**: Tracked with keys like `"cueId"`, `"cueId:pre"`, `"cueId:post"` for cancellation
5. **STOP / PANIC**: Both abandon in-flight work (a network request or script that settles
   afterwards cannot resume the show). STOP cuts the audio; PANIC fades it out over 200 ms.
   A cue that is stopped — by STOP, by PANIC, or by the engine reporting its voice stopped —
   runs no post-wait and does not auto-advance, and a stopped group finishes nothing: the
   cues after it wait for the next GO.

### Failure Handling

- Saves go through a temporary file and a rename, and keep the previous version as
  `<name>.cuerunner.bak`. A save that fails says so in a notice bar and the log; it never leaves
  a half-written file.
- Unsaved work is snapshotted to the user-data folder every 30 s. The next launch offers it
  back with Recover / Discard, and saving or discarding clears it.
- A renderer crash reloads the window and explains itself in a banner; the interface's own
  errors, and the main process's, are logged and mirrored into the session log.
- STOP and PANIC abandon work that is still in flight — a network request or script that
  settles afterwards cannot resume the show.

### Audio Engine

Playback runs in a native engine — `native/audio/`, built to `native/audio/build/cuerunner-audio`
— that the main process starts as a child and talks to over a local socket (Unix domain
socket, named pipe on Windows) in newline-delimited JSON. The renderer never sees media
bytes and never touches a decoder: `window.cuerunner.audio` is a set of execution verbs
(`prepare`, `start`, `stop`, `stopAll`, `seek`, `cancel`, `routing`, `fade`, `progress`,
`panic`, `clock`, `info`, `devices`, `configure`, `waveform`) whose times are all
milliseconds on the engine's own sample clock. `src/shared/audio.ts` is the contract both
processes and the engine speak.

- **Device I/O**: miniaudio (MIT-0). Windows WASAPI shared **and** exclusive, macOS Core
  Audio, Linux PulseAudio / ALSA / JACK — and, on Windows, **ASIO** when Steinberg's SDK was
  present at build time (see *Packaging prerequisites*): one interface, its own driver, its
  own buffer sizes. Exclusive access is requested, never assumed: if the device or mode
  asked for cannot be honoured, `configure` fails and says why.
- **One device at a time**: one output device is opened, and devices are deliberately not
  aggregated into one. Clock discipline across devices belongs to the operating system (an
  aggregate device) or to a Dante/AES67 layer — not to the show software; a rig with more
  channels presents them on one device.
- **Sample rates**: files keep their own rate and the engine resamples into the device's,
  so a 44.1 kHz file on a 48 kHz rig plays at the right pitch and tempo. A cue whose file
  is not at the running rate says so under its file name, rather than leaving the operator
  to infer it.
- **Decoding**: WAV, MP3, FLAC (dr_libs) and Ogg Vorbis (stb_vorbis) are compiled in.
  M4A/AAC and ALAC use the platform codec — Media Foundation on Windows, AudioToolbox on
  macOS — and on Linux the LGPL-only FFmpeg helper described under *Packaging
  prerequisites* below.
- **Scheduling**: starts, stops and fades are scheduled on the mixer at exact frame
  indices, so a stalling renderer cannot smear a cue. Seeking moves the position without
  retriggering a fade-in.
- **Streaming and cache**: small files are decoded once and cached (bounded by bytes and
  file count, LRU with genuine hit promotion, pinned while a voice uses them). Files whose
  decoded size exceeds the per-file limit stream through a bounded pre-roll ring instead,
  and never evict the warm small files.
- **Routing**: a cue carries a level, a pan and a crosspoint matrix
  (`{inputChannel, outputChannel, gain}`, zero-based); `null` means automatic routing and
  `[]` is deliberate silence.
- **Honest reporting**: `info()` reports the achieved backend, device, sample rate, channel
  count, exclusive state, buffer/period frames and a latency marked driver, measured,
  estimated or unknown — the driver's own figure where the driver states one (ASIO does) —
  plus cache and streaming pressure for the warnings the UI shows.

#### Packaging prerequisites

- A C++17 toolchain: `cc`/`c++` (or `clang`) on Linux/macOS, MSVC or clang on Windows.
  `npm run dist:*` builds the engine first through `npm run build:native`.
- **Linux M4A/AAC**: the app ships an LGPL-only FFmpeg helper (pinned source, SHA-256 and
  release-signature verified, `--disable-gpl --disable-nonfree --disable-version3`) at
  `native/audio/build/decoders/ffmpeg`, packaged to `resources/audio/decoders`. Build it
  with `npm run build:ffmpeg`; without it, M4A files report a visible "decoder unavailable"
  error instead of failing silently. Windows and macOS need nothing extra.
- **ASIO (Windows, opt-in at build time)**: the engine hosts ASIO drivers when Steinberg's
  ASIO SDK is present when it is compiled, and does not mention ASIO when it is not. The SDK
  is not vendored — its licence forbids redistributing it, which is also why nothing in this
  repository contains it — so the path is supplied to the build:

  ```bash
  CUERUNNER_ASIO_SDK=/path/to/ASIOSDK npm run build:native      # Windows only
  ```

  `scripts/asio-sdk.mjs` reads that one variable (`ASIOSDK` is the directory holding
  `common/asio.h`); the engine then compiles `native/audio/src/asio_backend.cpp` and the
  SDK's own `host/pc/asiolist.cpp`, and the driver list grows an entry per installed ASIO
  driver. Without the variable, the build is exactly what it was: same sources, same
  binary, no ASIO devices, and `--backend asio` refused with "this engine was built without
  ASIO support". CI looks for the variable, then for `C:\asio-sdk\ASIOSDK`, and warns when
  neither exists.

  **Before shipping a build with ASIO in it**, the Steinberg ASIO License Agreement has to be
  signed — the SDK's proprietary licence is the one a closed-source application needs, and
  it is what permits publishing a binary built against the SDK. That is a release-checklist
  item, not a build-time one: an unsigned build can be built, tested and used internally,
  but not published.
- Source pins and licences for everything vendored live in
  `native/audio/third_party/DEPENDENCIES.json`; the FFmpeg helper's notice and licence
  texts sit next to the binary.

#### Native engine commands

The native artifacts are built **automatically and incrementally** by a pre-step that
every entrypoint which needs them runs through (`scripts/ensure-native.mjs`): `npm run
dev`, `build`, `test`, `test:e2e`, `preview`, `screenshots` and `dist*` all call it, so a
fresh checkout needs no manual build. It rebuilds the engine only when a source, vendored
header or the build script is newer than the binary — a warm checkout costs one `stat()` —
and it never rebuilds the pinned FFmpeg helper once it exists.

```bash
npm run ensure:native       # the pre-step itself: engine + (on Linux) M4A decoder
npm run build:native        # force an engine build into native/audio/build/
npm run build:ffmpeg        # force the packaged Linux M4A decoder (LGPL-only FFmpeg)
npm run test:native         # deterministic offline-render acceptance on real samples
npm run test:native:device  # live-device smoke (needs a real output device)
npm run test:native:asio    # ASIO smoke: enumerates drivers, then runs the device smoke
                            # against the first one (Windows, needs a driver installed)
```

Clean-checkout entrypoints, exactly as CI runs them: `npm run typecheck`, `npm test`,
`npm run test:native`, `npm run test:e2e`, `npm run dist:linux`. On Windows the compiler
must be on `PATH`: CI imports the MSVC environment with `vcvars64.bat` before anything that
builds the engine (`ci.yml`, `build.yml`); on Linux and macOS `cc`/`c++` are enough.
`dist:linux` and the `test:native` pre-step build the M4A helper on a machine that does not
have it yet; CI caches `native/audio/build/decoders` under a key derived from the build
script so an unchanged pin is never rebuilt.

`test:native` drives the real mixer, scheduler, decoders and cache with a caller-owned
clock and asserts actual output samples: exact start/stop/fade frames, matrix routing,
loops, the release that ends a loop and plays the tail out, seeks, streaming, cache
bounds, note (onset) detection and M4A decoding. Its first check is a compiler-backed one
with no engine in it — `native/audio/tests/asio-rules.mjs` compiles and runs
`tests/asio-rules.cpp`, which asserts the exact bytes ASIO's sample types are written in
and the buffer sizes a driver's min/max/granularity will accept, because every way of
getting those wrong is silent. It is the acceptance proof for playback behaviour, and it
needs no audio hardware. `npm run test:native:device` adds the live-device checks (real
channel counts, exclusive refusal, capture tee, panic silence), and
`npm run test:native:asio` is the same smoke against a real ASIO driver on Windows.


### State Management

Zustand store (`src/renderer/src/store/index.ts`) maintains:
- `cues: Cue[]` — flat workspace cue array
- `selectedId` — currently selected cue
- `isDirty` — unsaved changes flag
- `running: Map<string, RunningCue>` — live playback state
- Undo/redo stacks (`past`, `future`)

## Project Structure

```
cuerunner/
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   └── handlers.ts          # Main process IPC handlers
│   │   └── index.ts                 # Electron main process entry
│   ├── preload/
│   │   └── index.ts                 # IPC bridge (context isolation)
│   └── renderer/
│       └── src/
│           ├── components/          # React components
│           ├── engine/              # CueRunner, AudioPlayer
│           ├── store/               # Zustand state management
│           ├── types/               # TypeScript definitions (Cue, Workspace)
│           ├── utils/               # Helpers (cueDefaults, formatDuration)
│           ├── App.tsx              # Root component
│           └── index.css
├── e2e/                             # Playwright E2E tests
├── src/test/                        # Vitest setup & mocks
├── resources/                       # App icons, installer assets, the demo workspace
├── .github/workflows/               # CI/CD (typecheck, tests, build)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── electron.vite.config.ts
```

## Workspace Format

Workspaces are saved as `.cuerunner` files (JSON format matching the `Workspace` interface):

```json
{
  "version": 1,
  "id": "uuid",
  "name": "My Show",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "history": [
    {
      "at": "2026-09-15T19:40:12.511Z",
      "by": "adam",
      "machine": "stage-box",
      "cues": [{ "kind": "edited", "id": "uuid", "label": "1 Intro Music", "fields": ["volume"] }],
      "settings": []
    }
  ],
  "audioSettings": { "outputDeviceId": "default" },
  "midiSettings": { "outputPortName": "" },
  "triggerGuard": { "windowMs": 300 },
  "cues": [
    {
      "id": "uuid",
      "type": "audio",
      "number": "1",
      "name": "Intro Music",
      "filePath": "/path/to/file.mp3",
      "media": { "path": "walk-in.wav", "originalPath": "/path/to/file.mp3" },
      "volume": 1,
      "outputs": null,
      "preWait": 0,
      "postWait": 0,
      "advance": "on-end",
      "isArmed": true
      // ... other fields
    }
  ]
}
```

Two properties of this file are load-bearing, and both are held by tests
(`src/main/workspace/determinism.test.ts`, `src/main/workspace/history.test.ts`,
`src/main/workspace/writers.test.ts`, `e2e/showfile.spec.ts`):

- **The bytes are a function of the show and the folder it is saved into.** The file's `id` and
  `createdAt` belong to the show and are written back as they came; nothing carries a save
  timestamp. Saving a show that has not changed puts the same bytes back, so a workspace can
  live in version control without every save being a diff.
- **`history` records what a save changed, and only when it changed something.** Each entry
  names the cues added, removed, edited and moved and the settings that changed — not the old
  values, which are in the file the save replaced. An unedited save appends nothing; bringing
  an older file up to this version's shape is a change to the file rather than to the show and
  is not recorded as an edit.

An `.cuerunnerx` bundle is a zip holding `show.cuerunner` and a `media/` folder, with the showfile's media
paths relative to the archive root. Entries are stored uncompressed in name order with fixed
timestamps, so two bundles of one show are byte-identical, and each entry's CRC is checked on
the way out. A bundle carries up to about 4 GB of media — the format's limit without its 64-bit
extension, which this app does not write — and a show bigger than that is refused with a
sentence rather than written as an archive whose directory lies about its own offsets.

`WorkspaceManager` (main process) handles I/O and auto-migrates legacy fields on load: old
`childIds` arrays become `parentId` pointers, missing timing fields are filled with defaults,
the pre-`advance` `autoContinue`/`autoFollow` flags are dropped, a stop cue without
`waitForFade` gains `false`, and the retired per-output `deviceId` and `channelPair` fields are
dropped.

## Testing

- **Unit Tests**: `npm test` (Vitest, jsdom environment)
  - Covers: CueRunner sequencing, store actions, audio playback, utilities
  - Location: `src/**/*.test.ts`
  - Fakes timers for deterministic timing tests
- **E2E Tests**: `npm run test:e2e` (Playwright, requires build)
  - Tests UI interactions, drag/drop, playback flow
  - Location: `e2e/`
  - Use helpers from `e2e/helpers.ts`
  - The suite opens real Electron windows. On Linux it runs on a private Xvfb display
    (`scripts/run-e2e.js`), so no window ever appears on your desktop and a run over ssh
    behaves the same as one at the keyboard. Electron auto-selects a Wayland session's
    compositor and ignores `DISPLAY`, so every test launch passes `--ozone-platform=x11`;
    without that the windows would ignore the virtual display and open over whatever you
    are doing. `npm run test:e2e:headed` is the opt-in to run it on the display you are
    using instead.
  - Single spec: `npm run test:e2e -- e2e/<spec>.spec.ts`
- **Integration Tests**: `npm run test:integration` (Playwright, requires build)
  - Tests Cuerunner against the systems it meets in a venue — an ETC Eos console, and an
    Allen & Heath SQ or Avantis desk — with a peer standing in for the device
  - Location: `integration/specs`. The peers are `integration/peers/` and run on their own,
    which is what makes them useful outside a test run: `npm run peer:eos`, and
    `npm run peer:desk -- --profile sq` is a desk on a socket any client can point at
  - No vendor software and no hardware on this lane: the peers are implementations of the
    published protocols, and `harness-*.spec.ts` holds each one to its vendor's own
    documents with no application running at all. `INTEGRATION-HARNESS.md` is the plan, the
    lanes that *do* use the real console or a real desk, and what each lane claims
  - Single spec: `npm run test:integration -- integration/specs/<spec>.spec.ts`

**Before committing**:
```bash
npm test && npm run typecheck
# For UI changes, also run:
npm run test:e2e
```

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

- **`ci.yml`**: Runs on pull requests
  - Typecheck, unit tests, and the Electron-install contract on Ubuntu, on Node 24 (LTS)
    and 26 (current)
  - E2E tests on Windows, macOS, and Linux (Ubuntu under Xvfb)
  - Integration tests on Linux: Cuerunner against the protocol peers for the console and the
    desk (no vendor software, no hardware)
- **`build.yml`**: Runs when a release is published, or manually
  - Tests, then builds the Windows (NSIS), macOS (DMG) and Linux (AppImage) installers
  - Uploads to R2 (Cloudflare) and GitHub Releases
- **`release.yml`**: Semantic versioning with `semantic-release` — run it by hand from
  `main` (Actions → Release → Run workflow). Merging to `main` publishes nothing on its
  own, so a release happens only when it is meant to.

[`RELEASE_CHECKLIST.md`](./.github/RELEASE_CHECKLIST.md) is what a release engineer walks
before that dispatch, including the check that keeps this file's limitations honest.

## Known limitations

The operator-facing list is in the
[reference](https://huckcity.github.io/cuerunner/reference/troubleshooting.html#limitations).
These are the ones that matter when building or packaging the app.

Playback and platform limits:

- MIDI is an optional native module: on Linux it needs the ALSA development headers
  (`libasound2-dev`) installed before dependencies, and a build without it says so rather
  than swallowing a cue — a **MIDI unavailable** badge in the status bar opens Settings →
  MIDI, and a MIDI cue that fires reports the failure in the run log
- Network cues are sent by the main process as an ordinary HTTP client, so a target server
  needs no CORS headers; a cue still holds until the response or its timeout (5 s by default)
- Audio cues are written twice: relative to the show folder when the file sits inside it, and
  as the absolute path it had at the last save, so a show folder copied with its media keeps
  its links. A file still not found is listed in a missing-media bar — locating one file puts
  the rest of that folder back with it
- E2E tests open real windows: on Linux they run on a private Xvfb display, so they never
  take over the desktop and work over ssh. Windows and macOS runs use the session's display,
  and `npm run test:e2e:headed` runs the suite on your own display deliberately

Behaviour worth knowing before a show:

- Fixed caps: the run log keeps the last 500 lines, a single script run emits at most 200 lines,
  and run-log messages and network response bodies are cut off at 4000 characters. A showfile
  remembers its last 200 saves that changed something, and an entry naming more than 100 cues
  says how many more there were
- The showfile's history is written per save, so it says who saved a change and what that save
  moved, not who typed which keystroke. Two people editing one file at once is not a thing the
  format supports; the merge is for the two files that result
- A merge asks for the version the two sides started from, because two files alone cannot tell
  "I changed this" from "you changed it". A cue's audio file is not merged — the two copies
  resolved their media on two different machines — so a disagreement about it is reported and
  the show being merged into keeps its own
- A save gives no confirmation beyond the dirty dot clearing
- Group rows derive their length from their children for timeline and sequence groups; playlist
  and random groups show `–`
- OSC and MIDI input are free on any machine: the app listens, triggers fire, and the
  monitor shows what arrived. What a key turns on is the rest of the services — the desk
  link, the radios, the network devices and the second machine

Desk and console integration:

- A desk is reached over its own MIDI socket — an Allen & Heath SQ or Avantis on port 51325,
  set up in Show Settings → Channels — as well as through Allen & Heath MIDI Control's virtual
  ports. A cue that cannot reach the desk says so in the run log rather than doing nothing
- **A desk is told in its own arrangement.** Show Settings → Channels names the desk — an SQ,
  an Avantis, or any desk that takes a note on and a note off — and a DCA's message follows
  from what that desk's document says a mute is: an SQ's NRPN parameter on page 02, an
  Avantis's note-on at velocity `7F` to open and `3F` to close, on the channel four above its
  own. A DCA the profile cannot address (an SQ has eight, an Avantis sixteen) is reported
  rather than going quiet. The harness found the difference (`INTEGRATION-HARNESS.md` §7) and
  `integration/specs/desk-sq.spec.ts` and `desk-avantis.spec.ts` hold the app to what each
  desk does with the bytes rather than to what the app sent
- **A show run from the desk's own buttons.** A console reports a key press only when the key
  has been assigned to a console function, so the buttons a show runs from are spare **mute
  groups**: Show Settings → Channels says which group the operator's GO and BACK keys are,
  those two groups are assigned to keys at the desk, and pressing them walks the show's scenes
  — GO to the next, BACK to the one before, in the order the Scenes view shows them. No MIDI
  note is set up anywhere. The desk's message is read by `utils/deskInput.ts`; the desk's own
  report of its state primes the app rather than moving it — a show opened onto a desk with a
  group already muted must not recall a scene by itself — and a DCA's own mute deliberately is
  not read as a press, so a scene recall coming back off the desk cannot run the show.
  `integration/specs/desk-buttons.spec.ts` drives all of it against the peer
- **Or any control that sends something.** A soft key assigned to a MIDI note, a footswitch, a
  scene recalled at the desk — whatever the desk transmits is a MIDI trigger on its own
  connection, and `Learn` writes the trigger from what arrives. A lighting console's own show
  control command is an `msc` trigger, matched on every field it carries, and the codes are held
  to the vendors' worked examples; `integration/specs/msc.spec.ts` drives a Show Control cue into
  an SQ's cue list and a key at the desk into a cue here

Redundant playback:

- **Two machines, one show.** Both run Cuerunner with the same workspace open; one is set to
  *Live* and drives it, the other to *Standby* and mirrors it. What crosses the network is
  state rather than sound: which cue is running, how far into its file the engine has reached,
  what the operator has selected, and a fingerprint of the cue list so the two machines check
  they are running the same show rather than assuming it. The machine standing by also decodes
  the same media into its own engine, so a cue it picks up starts rather than decoding
- **A stated heartbeat, and a stated choice.** The pair says so five times a second, and a
  partner that has said nothing for three seconds (configurable) is declared gone — the same
  three seconds this app already gives a window that has stopped answering. What happens then
  is the operator's setting: *Tell me*, and the standby reports it and waits for a hand;
  *Take it over*, and it claims the show itself
- **A takeover picks the show up.** The playing audio cue goes back on the engine at the
  position it had reached plus the silence since the last beat, and the operator's place in
  the show comes across with it, so the next GO fires what the live machine would have fired.
  Everything else — a MIDI or OSC cue that has already gone out, a wait, a fade or a script
  that was half-way through, a cue that had finished and was waiting to hand over — is named
  in the run log rather than repeated. A machine that comes back after a takeover stands down
  instead of both machines playing the same cue, and a machine that took the show can hand it
  back. `e2e/redundancy.spec.ts` is the other machine: it speaks the protocol over a real
  socket, goes silent, and holds the app to the position the cue comes back at
- **The settings belong to the machine.** `redundancy.json` beside `license.key` — both
  machines of a pair run the same workspace file, so a role written into the show would be
  read as the same answer by both of them

The [reference](https://huckcity.github.io/cuerunner/reference/troubleshooting.html#limitations)
carries the operator-facing half of this list, in the words an operator would look it up in.

## Contributing

1. Create a branch: `git checkout -b feature/my-feature`
2. Make changes with tests
3. Run `npm test && npm run typecheck` (and `npm run test:e2e` for UI changes)
4. Commit with conventional commits: `feat:`, `fix:`, `chore:`, etc.
5. Push and create a pull request

## Cuerunner Pro

The Pro features listed above ship in the same app. A license key turns them on, and
keys are verified on the machine they are entered on:

- **Nothing is sent anywhere.** The key is signed by the issuer and checked against the
  public keys compiled into the app, so a venue machine with no internet unlocks exactly
  like any other, and using a key tells nobody that it was used.
- **Enter it once**: *Cuerunner ▾ → Settings… → License*. The license is kept beside the
  app's other settings in the user-data directory (`license.key`); it belongs to the
  computer it was entered on, not to a workspace or a show file. A machine's half of a
  redundant pair is kept the same way (`redundancy.json`), and for the same reason: both
  machines of a pair run the same workspace file, so which one is the main is a fact about
  the machine rather than about the show.
- **A key ends when it ends.** The key is checked when the app starts, when one is
  entered, and whenever anything asks what the license is; the app's own clock crosses a
  key's last day while it is open, with no operator action and no restart. The moment it
  crosses, the Pro services stop there and then — the desk link among them — and scene cues
  are refused from that instant, while a cue already playing keeps playing and the show
  file is untouched.
- **A renewed key puts the Pro half back** without a restart, and starts the services the
  show had configured.
- **A key is not bound to a machine.** Verification is offline by design and nothing
  counts activations, so one key can be entered on more than one computer. Keeping to one
  machine per operator is a matter of trust between the issuer and the buyer — an
  activation server, or a machine id collected before the sale, is what changing that
  would take.
- **Show files are never affected.** A workspace written with Pro opens anywhere, keeping
  its scenes, its mic plot and its triggers, and saves back exactly as it arrived. On an
  unlicensed machine the Pro surfaces show a lock, the Pro services do not start — the
  OSC and MIDI listeners do — and a scene cue fired from the stack records that it needs
  a license and lets the rest of the show run.
- **A key can be deactivated**, which returns the machine to the free feature set.

### Issuing keys

Keys are minted offline. The private half of the product key is not in this repository
and must never be committed; it lives on the issuer's machine at
`~/.cuerunner/license-private.pem` (mode 600).

```bash
npm run license:keygen                                  # once: write a pair, print the public half
npm run license:issue -- --name "Theatre X" \
  --expires 2027-09-12 --id CRN-ABC123                  # mint a key for a customer
npm run license:verify -- "CRN1-…"                    # check a key against the shipped public keys
```

**What the flags decide.** `--name` is the licensee as it will be shown to them; `--expires`
is the last day the key is good (UTC, inclusive) and is left off for a key that does not
lapse; `--id` is the sale's own identifier, carried inside the key and printed beside it,
so a key found in an email can be matched back to a row in the ledger without opening the
app.

**The ledger is a spreadsheet.** One row per key: id, licensee, date, what it was for
(trial, licence, venue, replacement) and the expiry. The `--id` is the join key. Nothing
else in the product keeps a record of a sale, and nothing needs to: the key carries who it
is for and until when, and the signature carries the rest.

**A trial is a key that lapses.**

```bash
npm run license:issue -- --name "Theatre X — trial" \
  --expires 2026-10-01 --id CRN-TRIAL-1414
```

Same surfaces and same services as a licence until the day passes, and then the machine
falls back to the free half — with the show file untouched, so the operator keeps the
scenes, the mic plot and the triggers they built during the trial.

**Refunds and deactivation.** Deactivating in Settings → Licence returns that machine to
the free half at once, and the key is not blacklisted anywhere, because nothing phones
home. A refund is the ledger row marked refunded plus a request to deactivate; the licence
text says a key is not transferable, and the honest enforcement of that is the ledger
rather than the app.

`src/main/license/publicKey.ts` holds the public keys a build trusts, so rotating a key
means adding the new one there and releasing: existing keys keep verifying as long as
their public key stays in the list. A key's text is base32 in groups of eight, carrying
who it is for, an id to match it to a sale, and an optional last day (UTC, good through
the end of it).

**Development and E2E** mint their own keys: `CUERUNNER_LICENSE_PUBLIC_KEY` replaces the
trusted set with one key of its own, and it is honoured only when the app is running from
a source tree (`!app.isPackaged`). A packaged build ignores it. `npm run dev:pro` does all
of that for a working session — a throwaway pair, a key signed with it, and a user-data
directory of its own under `~/.cuerunner-dev`, so the license your normal `npm run dev` is
never read, written or shown. E2E specs that need the Pro surfaces launch with
`launchApp({ license: mintLicense() })`; see `e2e/license.spec.ts` for the gate itself.

### Fulfilling an order

Every order is worked the same three steps, whether it came through the storefront's card
link or as a purchase order to the address on the
[pricing page](https://huckcity.github.io/cuerunner/pricing.html). None of them needs the
app, and nothing between them needs a server:

1. **Mint the key** for the sale, using the order's own id so the key can be matched back to
   it later:

   ```bash
   npm run license:issue -- --name "Theatre X" --id CRN-ABC123
   ```

   A key that ends — a rental or a trial — adds `--expires YYYY-MM-DD`, the last day it is
   good.
2. **Deliver it by email.** The buyer enters it in *Cuerunner ▾ → Settings… → License*; the
   key is checked on the machine and nothing is sent anywhere, so the email arriving is the
   whole of the delivery and the machine unlocks offline, exactly like any other.
3. **Record the row** in the ledger described above. The expiry column is the sale's own
   date: for a licence, the day the 12 months of updates end — the key keeps working past it
   — and for a rental or a trial, the same last day that went into `--expires`.

**A trial request is the same three steps**, and the only order that arrives without money
behind it. It comes to `orders@cuerunner.app`, the address the
[trial page](https://huckcity.github.io/cuerunner/trial.html) publishes, and the request is
answered like any other message. The key is minted with `--expires` set to the trial's last
day — 14 days out, the length the adopted model in
`_bmad-output/specs/spec-cuerunner/market-and-business.md` decides — delivered by email, and
recorded as a trial row in the ledger, with that same day in the expiry column. Nothing about
a request is automatic: a person reads it, mints, and replies.

## Support

- **The app, and the licence**: write to `orders@cuerunner.app` — the address the
  [support page](https://huckcity.github.io/cuerunner/support.html) publishes — and a reply
  comes back within one business day. Orders, trial requests and support are all answered from
  that one inbox.
- **Issues**: [GitHub Issues](https://github.com/Huckcity/cuerunner/issues)
- **Feedback**: The fastest way to shape Cuerunner is to file an issue with your use case — "I run sound for X and need Y" directly drives the roadmap.

## Licence

Cuerunner is source-available under the [Functional Source License 1.1, MIT future licence](./LICENSE) (FSL-1.1-MIT). In short:

- **Use it for anything, including paid work.** Running a show, a tour, a venue, a broadcast — commercial use is permitted, and so are internal tools and professional services built around it.
- **Don't sell it as a competing product.** You may not offer Cuerunner, or something substantially similar, as a commercial product or service of your own.
- **Every release becomes MIT two years after it is published**, irrevocably. FSL exists to keep this product alive while it is being built, not to hold it back forever.

The versions published before this licence (up to and including v0.13.0) were released under MIT and stay under MIT — that grant cannot be withdrawn.
