# Cuerunner

A cross-platform **QLab alternative** for Windows and macOS — professional show-control software for managing audio, MIDI, OSC, and network cues in live performance and broadcast environments.

Built with Electron, React, TypeScript, and Zustand. Free and open source under the [MIT License](./LICENSE) — see [Licence](#licence).

**Documentation lives on the site**, not here:

- [Guides](https://cuerunner.app/guide.html) — first show, building a cue
  list, working with sound, running the show, and the services around it. Source in
  [`website/docs/guides.mjs`](./website/docs/guides.mjs).
- [Reference](https://cuerunner.app/reference/index.html) — every cue type
  and field, every setting, the keyboard table, the OSC and MIDI messages Cuerunner answers
  to, the script API and the file formats. Source in
  [`website/docs/reference.mjs`](./website/docs/reference.mjs).

Both are generated: edit the content modules and run `node website/build-docs.mjs`.

This README is for people building Cuerunner rather than running a show with it.

## What it is

An Electron app with three layers — main process, preload bridge, renderer — talking
exclusively over IPC. The renderer has no Node access; the audio engine is a native
process of its own, so a renderer crash does not stop the sound.

The **cue stack**: its cue types, groups and timelines, the waveform editor, the run log,
workspaces, undo — and the ears it needs: OSC and MIDI input, cue triggers, and the monitor
that shows what arrived. **The show around it**: wireless and the mic plot, scenes and the
desk, the script panel with its tablet view, redundant playback, and the showfile as a
versionable artifact: what each save changed, a comparison with another version, two people's
copies merged, and the show and its media bundled into one `.cuerunnerx`. Every feature runs on
every machine.

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
script, and a stop cue. The show's console carries two scenes as well — Act One and Wedding, four
strips each — so the Scenes view has a show in it the moment the demo is opened. Open it from
**Cuerunner ▾ → Open Demo Workspace**, or from the button in an empty cue list. It opens as an
unsaved example (so Save asks where to put your copy, and never writes over the bundled file) and
its audio is copied into the app's user data folder on open, which is where its cues read it from.
That file is the serialiser's own output rather than a hand-written example:
`npm run demo:write` (`scripts/regenerate-demo.ts`) is the recipe that writes it,
`npm run demo:check` says whether the shipped file is already those bytes, and
`src/main/workspace/demo.test.ts` holds a save of the freshly opened demo to them.

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
npm run dist:linux        # Build and package for Linux only (AppImage and .deb)
npm run screenshots       # Regenerate website/assets/guide images (requires build)
npm run demo:write        # Put resources/demo/Demo Show.cuerunner through the serialiser
npm run demo:check        # Fail if the shipped demo is not what that writes
npm run site              # Serve website/ locally on http://localhost:8080
```

`npm run screenshots` launches the built app, opens the demo workspace that ships with it, and
rewrites every image used by the user guide. Run it after any UI change so the guide cannot
drift from the product — and after a demo change, so the guide shows the demo users get.

`npm run demo:write` is the demo's own writer: the shipped show is the serialiser's output,
so edit the demo in `resources/demo/Demo Show.cuerunner` and run this to have the form —
settings defaults, audio routes, key order — written the way the app writes it.
`npm run demo:check` asks the same question without writing, which is what a shape change
leaves red until it has been run.

`npm run site` serves `website/` with no dependencies, so a page can be reviewed locally
before it deploys. Pass a port to override the default: `npm run site -- 3000`. The
[GitHub Pages workflow](./.github/workflows/deploy-website.yml) publishes the same directory
on every push to `main` that touches `website/**` — at `https://cuerunner.app`, the
repository's custom Pages domain. Its apex `A`/`AAAA` records and the `www` `CNAME` are
**DNS-only** in Cloudflare: GitHub issues that certificate itself, and a proxied record in
front of the origin is how the issuance fails.

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

# Package an AppImage and a .deb into dist/
npm run dist:linux
```

The AppImage is written to `dist/Cuerunner-<version>.AppImage`. If your distro has no FUSE,
extract and run it instead:

```bash
./dist/Cuerunner-*.AppImage --appimage-extract-and-run
```

The Debian package is written beside it, as `dist/cuerunner_<version>_amd64.deb`. Unlike the
AppImage it declares what it needs from the system — Electron's own libraries and ALSA
(`libasound2t64 | libasound2`) — so `apt` pulls those in:

```bash
sudo apt install ./dist/cuerunner_*_amd64.deb
```

The release pipeline publishes the `.deb` beside the AppImage — on the release page, and on the
mirror as `pub.cuerunner.app/latest/Cuerunner.deb` with its digest in `latest/SHA256SUMS` — and
`scripts/linux-packages.test.ts` holds it to its declared dependencies. A `.deb` install does not
replace itself: the app checks for a newer version like any other and sends the operator to the
download page for it (see Updates below).

### Troubleshooting `Error: Electron uninstall`

`electron-vite` throws this when the Electron binary is missing from
`node_modules/electron/dist` (no `path.txt`).

On **Node 26** this happens on every fresh install: the Electron download succeeds, but
extracting the ~200 MB zip deadlocks inside `extract-zip`'s dependency `fd-slicer@1.1.0`,
which uses `stream.destroyed` as its own EOF flag — on Node 26 that property is backed by
stream state, so the extraction stream ends without emitting `end`. Its `destroy()` returns
early for the same reason, so the stream never emits `close` either, and `stream.pipeline`
— which extract-zip awaits — never settles. Either way the process exits silently, with no
error and no non-zero status, and `dist/` is left holding a few half-written files.
(Verified: Node 24.9 extracts the same archive fine, Node 26.7 stalls on the first zip
entry; with the `end` half patched alone, the darwin-arm64 archive stops at its first
*stored* entry, a form the linux-x64 archive has not got.) CI builds on Node 24, which is
why released AppImages are unaffected.

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
  │   ├─ OscEngine (its own UDP sockets and OSC codec, osc/codec.ts)
  │   └─ WorkspaceManager (fs + file dialogs)
  └─ src/main/ipc/windowHandlers.ts (the per-window channels: close request, menu action)
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

`CueEngine` (in `src/renderer/src/engine/CueEngine.ts`, one instance held as `cueEngine`) is a singleton that sequences cue execution:

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
  signed — it is what permits publishing a binary built against the SDK under the SDK's
  proprietary licence. The pipeline enforces that
  rather than trusting a checklist: `build-windows` records whether its probe found an SDK,
  and withholds the installer — no upload, no release page, no mirror — when the build linked
  the SDK and `native/audio/third_party/ASIO-AGREEMENT.md` is not committed. That file is the
  record of the agreement being signed, written with its date and the parties when it is
  signed; its absence is the "not recorded" state the gate reads, and it is never committed
  as a placeholder. An unsigned build can still be built, tested and used internally; it is
  published only with the record in place.
- **Windows signing: Azure Trusted Signing.** The Windows installer is signed by Microsoft's
  Artifact Signing service, and the private key never leaves Azure — there is no certificate,
  no `.pfx` and no password for one in this repository. `electron-builder` does the signing
  through `win.azureSignOptions`, which cannot be declared in `package.json`: electron-builder's
  Windows signer *refuses the build* when it cannot authenticate rather than shipping unsigned
  (electron-builder#9623), so a repository with no identity configured would fail instead of
  producing the unsigned installer this pipeline promises. It is therefore configured per run,
  and the decision is `scripts/trusted-signing.ts` (`scripts/trusted-signing.test.ts` holds it
  to its states). Give the build:

  ```bash
  # repository variables — they name the service and authenticate nothing
  TRUSTED_SIGNING_PUBLISHER=CN=<the certificate's publisher>
  TRUSTED_SIGNING_ENDPOINT=https://<region>.codesigning.azure.net   # where the account was created
  TRUSTED_SIGNING_ACCOUNT=<the code signing account>
  TRUSTED_SIGNING_PROFILE=<the public-trust certificate profile>
  # repository secrets — a service principal with Trusted Signing Certificate Profile Signer
  AZURE_TENANT_ID=… AZURE_CLIENT_ID=… AZURE_CLIENT_SECRET=…
  ```

  and `npm run dist:win` signs the packaged binaries, the uninstaller and the installer;
  `build.yml` then checks the result with `Get-AuthenticodeSignature` and with the publisher it
  expects. All seven, or none: half of an identity is refused rather than treated as "do not
  sign". `electron-builder` 26.8.1 admits only `EnvironmentCredential`, so a federated or
  `az login` session is not an alternative here. macOS is unaffected and still signs from
  `MAC_CSC_LINK`.
  **The Windows runner needs the .NET 8 runtime.** Microsoft's signing provider
  (`Azure.CodeSigning.Dlib.dll`) is a .NET Core assembly, and signtool can only load it into
  a CoreCLR runtime; a machine with only .NET Framework fails every signing call while
  reporting `SignTool failed with exit code 3` and `The system cannot find the file specified`
  for a `signtool.exe` that is present and runs. `win-ci` has it installed
  (`C:\Program Files\dotnet`); a new runner needs the same before the first signed build.
- **macOS universal dmg**: the dmg carries one app per architecture, and the engine is one
  binary for both — `-arch x86_64 -arch arm64`, compiled at the floor
  `build.mac.minimumSystemVersion` declares — so `build.mac.x64ArchFiles` names
  `Contents/Resources/audio/**` as architecture-independent. That declaration is what lets
  `@electron/universal` merge the two stagings; without it packaging dies with
  `Detected file "Contents/Resources/audio/cuerunner-audio" ... not covered by the
  x64ArchFiles rule`, which is how the first packaging run of v0.14.0 failed.
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
npm run test:native:tsan    # the engine built with ThreadSanitizer: a minute of soak, then stops
                            # under load; any report fails (Linux)
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
getting those wrong is silent. The next is the cell the engine publishes its state through,
hammered by a writer and readers in a compiler-backed test of its own (`snapshot-cell.mjs`,
also built with ThreadSanitizer where the compiler has it). `test:native:tsan` builds the whole
engine that way and runs the soak and `shutdown-race.mjs` against it: the races it finds
pass every functional check and show up as a crash one run in a dozen. It is the acceptance proof for playback behaviour, and it
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
│   │   │   ├── handlers.ts          # Main process IPC handlers, one per declared channel
│   │   │   ├── windowHandlers.ts    # The two channels registered per window
│   │   │   └── parity.test.ts       # Fails the build when the declaration and the registrations disagree
│   │   ├── dmx/                     # sACN and Art-Net packets, the lighting state, its sockets and frame loop
│   │   └── index.ts                 # Electron main process entry
│   ├── preload/
│   │   └── index.ts                 # IPC bridge (context isolation)
│   └── renderer/
│       └── src/
│           ├── components/          # React components
│           ├── engine/              # CueEngine, scheduler, triggers, the desk send
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
  values, which are in the file the save replaced. An unedited save appends nothing, and no
  edit is a conversion: show files are not converted, so a save has nothing of that kind to
  record. The shape is declared and checked, and a file this build does not know is refused as
  it opens, by name, with nothing on disk touched.

An `.cuerunnerx` bundle is a zip holding `show.cuerunner` and a `media/` folder, with the showfile's media
paths relative to the archive root. Entries are stored uncompressed in name order with fixed
timestamps, so two bundles of one show are byte-identical, and each entry's CRC is checked on
the way out. A bundle carries up to about 4 GB of media — the format's limit without its 64-bit
extension, which this app does not write — and a show bigger than that is refused with a
sentence rather than written as an archive whose directory lies about its own offsets.

`WorkspaceManager` (main process) handles I/O. The shape is declared once, in
`src/shared/workspaceSections.ts` — the top-level sections, the sections a show's settings
carry, and the fields a cue of each type carries with the kind each is written as — and every
set of workspace bytes goes through one call that checks it, wherever a file is read: a show
opened from the recent list or the dialog, a bundle's show entry, a comparison's other side, a
recovery snapshot, the demo. A file this build does not know is refused — naming the file and
the fact, with what is on disk untouched — and a show file is never converted, so an older file
refusing to load is the accepted outcome rather than a regression. One read is the exception,
and it is the save's own: a save about to replace a file it cannot read keeps the history it
already had and replaces the file anyway.

A file is unknown when it is not JSON, when it carries no cue list, when its `version` is not
1, when it has a top-level section this build does not declare, when a cue type is outside the
declared set, when its settings carry a section this build does not declare, when its settings
leave out a section this build writes, when a field inside a settings section is one this build
does not write, when a declared field is missing from the section that carries it, when what a
declared field carries is not the JSON kind its own type writes — a string where this build
writes a number, a number where it writes a list of strings, or an entry of that list that is not
what the list carries — when that field carries `null` where the show's types allow no such thing,
when a cue has not got a field its own type requires — which is what a show saved before the
shapes below changed meets — when a declared cue field carries the wrong kind, down to an entry
of one of its lists: a number where a MIDI cue writes a list of messages, an entry of that list
that is not an object, a string where a crosspoint writes a number, or `null` where the cue's own
types allow none — or when what sits under `showSettings` is not a set of sections at all. What
is absent at the file's own top level is not checked, because the check reads what the
document carries: a file that omits `history`, `audioSettings`, `midiSettings`, `showSettings` or
`triggerGuard` reads, with the window standing its own defaults in for the sections a file has
not got and a load completing the one gate a file carries none of, `triggerGuard`. A
`showSettings` that is there is different: it has to be exactly the declared sections, each one
carrying exactly the declared fields. A cue is read the other way round: its declared fields are
held to the kinds their types write — `triggers`, `refire`, `scriptLine`, `trimSilence` and
`soundRegion` may be missing, the rest may not — and a field a cue carries that this build does
not declare, `media` among them, is kept rather than refused. Loading repairs a damaged cue
grouping and reports it as a note beside missing media, and it writes no file. There is no
conversion either way: a show whose settings predate the scene-owned fader assignment refuses,
and its channels, faders and placements are set up again in Show Settings and the Scenes grid.

The shape is held by tests — `src/main/workspace/migrate.test.ts` for the refusals and what a
load still does, `src/main/workspace/funnel.test.ts` for one case per entry point,
`e2e/desk-tcp.spec.ts` for a refused file reaching the window with the session left as it was —
and the sentences here, among the sites `scripts/showfile-prose.test.ts` reads.

## Testing

- **Unit Tests**: `npm test` (Vitest, jsdom environment)
  - Covers: CueEngine sequencing, store actions, audio playback, utilities
  - Location: `src/**/*.test.ts`, and the repository guards beside them in `scripts/**/*.test.ts`
    — `scripts/showfile-prose.test.ts` holds the workspace-format sentences above
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
# For the same gate on the Windows and Mac machines as well (see CI/CD below):
npm run local-ci
```

## CI/CD

Every lane runs on GitHub-hosted runners. **Do not register a self-hosted runner on this
repository:** a fork's pull request runs the workflow files in that pull request, which can name
any runner label. The two lanes that need real hardware (`integration-vendor.yml` and
`integration-hardware.yml`) only start by hand, and wait for a maintainer to attach a machine for
that run and remove it afterwards. `scripts/public-runners.test.ts` holds the workflow files to
this.

GitHub Actions workflows in `.github/workflows/`:

- **`ci.yml`**: Runs on pull requests
  - Typecheck and the Electron-install contract on Ubuntu, on Node 24 (LTS) and 26 (current)
  - Unit tests on all three platforms — Windows, macOS and Linux — on both Node majors: the
    suite is mostly the main process (the workspace and its atomic write, the audio wire, the
    redundancy service), which is where a platform shows up. The release tooling's own tests
    and the `chmod`-based refusal cases state their platform, because they need a POSIX shell
    or a mode that makes a write fail
  - E2E tests on Windows, macOS, and Linux (Ubuntu under Xvfb)
  - Integration tests on Linux: Cuerunner against the protocol peers for the console and the
    desk (no vendor software, no hardware)
- **`build.yml`**: Runs when a release is published, or manually
  - Tests, then builds the Windows (NSIS), macOS (DMG, and the zip a Mac updates itself from)
    and Linux (AppImage and `.deb`) installers, each with electron-builder's `latest*.yml` update
    feed beside it
  - Normally started by `release.yml`, which dispatches it for the tag it just cut; if a release
    ends up with no packaging run, start one by hand — `gh workflow run build.yml --ref <tag>` —
    because a release page with no assets means neither happened
  - Each packaging job records what it built — whether it was signed (Windows through Azure
    Trusted Signing, macOS from the certificate in the release secrets), whether the
    Windows build linked Steinberg's ASIO SDK — and the `release` job composes that into the
    release notes, appended to `semantic-release`'s own body: the notes name every installer
    signed, signed and notarised, or unsigned, and say that a venue machine refuses an
    unsigned one
  - Nothing publishes from a ref that is not a tag: a dispatch from a branch packages and
    stops there. A build that linked the SDK with no recorded agreement withholds its
    installer (`native/audio/third_party/ASIO-AGREEMENT.md`), and the same list the notes are
    composed from is what the release page carries and what the R2 mirror copies — the mirror
    removes every `latest/` name it writes that this release did not publish, so a withheld
    installer's card answers `404` rather than an earlier release's file under this release's
    name
  - Each surface publishes the digests of what it carries, composed from those bytes rather
    than typed: the release page attaches a `SHA256SUMS` beside the assets the notes list, and
    the mirror writes its own as it copies, at `pub.cuerunner.app/latest/SHA256SUMS`. A sums
    file is a way to check a download, not a signature
  - Uploads that list to R2 (Cloudflare) and GitHub Releases: the `pub.cuerunner.app/latest/`
    files the site's download cards point at, with the digests the cards link beside them
  - Serves the update feed the app checks: each platform's `latest*.yml` goes to `latest/`,
    rewritten so every file it names is this release's own copy under `versions/<tag>/` (the
    macOS zip is copied there only), and a feed is published only beside the installer it
    offers — a withheld Windows installer has no `latest.yml` either. The SHA-512 in a feed is
    electron-builder's digest of the bytes, which the app checks a download against before
    installing anything
- **`release.yml`**: Semantic versioning with `semantic-release` — run it by hand from
  `main` (Actions → Release → Run workflow). Merging to `main` publishes nothing on its
  own, so a release happens only when it is meant to. Cutting the tag is not enough on its
  own: a release published with the repository's own token starts no workflow, so this
  workflow dispatches `build.yml` for the tag it cut, which is what uploads the installers
  and fills the mirror — a release with no installers means that dispatch did not happen.
- **`download-report.yml`**: Says whether anyone is downloading the installers, and from
  where. Runs daily (and by hand) and reads Cloudflare's analytics for the host the
  download cards point at, `pub.cuerunner.app`, then comments the counts on the standing
  `Download report` issue — the run that finds the first downloads starts it, with *First
  downloads* as the post's first line, and a zero posts nothing and stays green. It needs
  the `CF_ANALYTICS_TOKEN` secret: a Cloudflare API token with *Zone Analytics:Read* on the
  `cuerunner.app` zone, stored with `gh secret set CF_ANALYTICS_TOKEN`. These are edge
  requests, not people — a resumed or ranged download, a re-click or a scanner adds counts
  — and only request paths and country codes are read. The app itself sends nothing; this
  is the download host counting what it served.

### Running the lanes yourself

`npm run local-ci` runs the same commands `ci.yml` runs on machines of your own, over ssh, for
feedback before a push:

```bash
npm run local-ci                     # every host, its own default lanes
npm run local-ci -- --hosts=win      # one host
npm run local-ci -- --lanes=unit     # one lane, wherever it is meaningful
npm run local-ci -- --list           # what would run, and where, without running it
```

It ships the working tree as a tar over ssh (nothing has to be committed; `node_modules`,
`.git` and the build outputs stay behind), installs only when `package-lock.json` changed, and
prints one `[host lane]` stream per step and a summary that says what each host did.

| Host | Where | Default lanes |
| --- | --- | --- |
| `linux` | this machine, taken as Linux — run the command from that box: the local host's platform is not read, so the Linux lanes are planned wherever it starts | typecheck, unit, native, integration, e2e |
| `win` | `adam@nuc-win-1`, a Windows machine with Node and MSVC installed | typecheck, unit |
| `mac` | `adam@mac.local`, a Mac, which needs Remote Login on before anything can reach it | typecheck, unit |

`LOCAL_CI_WIN`, `LOCAL_CI_MAC`, `LOCAL_CI_LINUX`, `LOCAL_CI_WIN_KEY` and `LOCAL_CI_MAC_KEY`
override those doors and keys, and are how you point this at your own machines. A host that does not answer is a `skipped` row rather than a failure, so a
run says what it did and what it could not (`scripts/lane-status.mjs`).

The e2e lane runs here, on Linux, where `scripts/run-e2e.js` gives Electron a private Xvfb
display. No host can run it over ssh: an Electron window needs a desktop session, so the script reports that reason rather than pretending to try.

[`RELEASE_CHECKLIST.md`](./.github/RELEASE_CHECKLIST.md) is what a release engineer walks
before that dispatch, including the check that keeps this file's limitations honest.

## Problem reports

*Cuerunner ▾ → Report a Problem…* composes a report (`src/main/report/report.ts`) and shows
all of it before anything leaves: versions, platform, the audio engine's state and last
words, the crash dumps Chromium left
beside the profile (named, not included), and the tail of the session log, with the home
folder replaced by `~`. Copy and Save stay on the machine; Email puts the text on the
clipboard and opens a `mailto:` to `orders@cuerunner.app` — a `mailto:` body cannot carry a
report, so the operator pastes it. The app sends nothing on its own:
`crashReporter.start({ uploadToServer: false })` keeps Chromium's dumps local, and
`scripts/report-address.test.ts` holds the app's address equal to the support page's.

## Known limitations

The operator-facing list is in the
[reference](https://cuerunner.app/reference/troubleshooting.html#limitations).
These are the ones that matter when building or packaging the app.

Playback and platform limits:

- MIDI is an optional native module: on Linux it needs the ALSA development headers
  (`libasound2-dev`) installed before dependencies, and on every platform node-gyp needs
  Python 3 and a C++ toolchain to build it (on Windows a real Python — the Microsoft Store
  alias is not one). `npm ci` exits 0 without a word when that build fails, so a build
  without it says so itself rather than swallowing a cue — a **MIDI unavailable** badge in
  the status bar opens Settings → MIDI, which gives the reason, and a MIDI cue that fires
  reports the failure in the run log. A packaging job is held to it:
  `scripts/verify-packaged-midi.mjs` fails `build.yml` when the packaged app has no addon
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
- OSC and MIDI input run on any machine: the app listens, triggers fire, and the monitor
  shows what arrived. The rest of the services — the desk link, the radios, the network
  devices and the second machine — start from what the show configures

Desk and console integration:

- A desk is reached over its own MIDI socket — an Allen & Heath SQ or Avantis on port 51325,
  set up in Show Settings → Channels — as well as through Allen & Heath MIDI Control's virtual
  ports. A cue that cannot reach the desk says so in the run log rather than doing nothing
- **A desk is told in its own arrangement, and a scene owns the assignment.** Show Settings →
  Channels names the desk — an SQ, an Avantis, or any desk that takes a note on and a note off
  — and the Scenes grid says which channels ride which fader, scene by scene. A recall writes
  two facts in that order: the **membership** (the channels the scene places, the faders it
  takes them off, over the route the desk takes it on — an SQ's own control service on its
  51326, outbound, held open with a keepalive datagram to the desk's UDP 51324, whose frames
  were measured from the desk; an Avantis's NRPN `40` on the desk link), and then the **mic's
  mute**, whose number is the channel's own and never a fader's, because a DCA is a control
  group and closing one is not how a mic is silenced. Nothing outside the show's own channels
  is named — the set Show Settings lists is the boundary — and a channel the scene leaves off
  every fader in that scene is closed. A mic that changes fader is never muted by the move: it
  keeps playing and takes the new fader's position. A profile with no assignment route — the
  note convention, OSC, and an SQ reached over a plain MIDI port, whose assignment needs the
  desk's own control service — reports that gap and writes the mute anyway; a placement past
  the desk's own DCA list (an SQ has eight, an Avantis sixteen), or a fader whose desk number
  points past it, is reported rather than going quiet. The fields this setup used to carry are
  deleted rather than deprecated: a strip has no fader select of its own and a fader has one
  desk number in place of the note and address overrides, and a show saved with either shape is
  refused on open rather than converted (see Workspace Format). The frames are the harness's
  `§6`, and
  `integration/specs/desk-sq.spec.ts` and `desk-avantis.spec.ts` hold the app to what each desk
  does with the bytes rather than to what the app sent — on the peers lane, whose counterpart is
  the harness's desk peers rather than a desk. Those peers model the desk's two services used
  here: the MIDI links, and — since the SQ's own control service was measured — a model of 51326
  written from that capture, which reads the frames a recall writes and answers as the capture
  says the desk answers. What no peer carries is the desk's own answer about a membership, so
  nothing here claims a desk has accepted one
- **A show run from the desk's own buttons, two ways.** A console reports a key press only
  when the key has been assigned to a console function, so the buttons a show runs from are
  spare **mute groups** — and, where a key that latches is not what a press means, **MIDI
  notes** beside them: Show Settings → Channels names which groups the operator's GO and BACK
  keys are and which notes two soft keys transmit. A group key toggles its group and the desk
  sends the mute, so the indicator latches; a key set to a note sends note on at `7F` while it
  is held and note off at `00` when it is let go, so a press that only means "next cue" leaves
  nothing lit. Either way one press is one step — GO to the next scene, BACK to the one before,
  in the order the Scenes view shows them — a key held down is not a repeat, and nothing is
  written back to the desk's own groups, because a latch is the desk's to own. A note that is
  also a cue's MIDI trigger does both — the cue fires and the show steps — since one message
  is two surfaces at once; that pairing is the operator's to make knowingly. The desk's
  messages are read by `utils/deskInput.ts`; the desk's report of its groups primes the app
  rather than moving it — a show opened onto a desk with a group already muted must not recall
  a scene by itself — a note has no get to prime it and is a press the first time, and the
  messages a recall writes are deliberately not read as a press: an SQ's groups are page `04`
  where a recall writes page `00`, and the notes a recall writes are inputs on the desk's own
  channel, where its groups live on another. The note route is offered where the **desk's own
  traffic** cannot be a note — an SQ, which mutes with NRPN — and not on an Avantis or a `note`
  desk, where a mute is a note and a read could be its own echo; it does not promise a note
  came from a hand, since a cue can put that note on the desk link too.
  `integration/specs/desk-buttons.spec.ts` drives both routes against the peer
- **Or any control that sends something.** A soft key assigned to a MIDI note, a footswitch, a
  scene recalled at the desk — whatever the desk transmits is a MIDI trigger on its own
  connection, and `Learn` writes the trigger from what arrives. A lighting console's own show
  control command is an `msc` trigger, matched on every field it carries, and the codes are held
  to the vendors' worked examples; `integration/specs/msc.spec.ts` drives a Show Control cue into
  the desk peer's SQ cue list and a key at that peer into a cue here — the peers lane, with a
  console on a cable left to the hardware lane

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
- **The settings belong to the machine.** `redundancy.json` in the user-data directory — both
  machines of a pair run the same workspace file, so a role written into the show would be
  read as the same answer by both of them. The interface the lights leave by and the sACN
  identity this machine sends as are kept there too (`dmx.json`)

The [reference](https://cuerunner.app/reference/troubleshooting.html#limitations)
carries the operator-facing half of this list, in the words an operator would look it up in.

## Contributing

1. Create a branch: `git checkout -b feature/my-feature`
2. Make changes with tests
3. Run `npm test && npm run typecheck` (and `npm run test:e2e` for UI changes)
4. Commit with conventional commits: `feat:`, `fix:`, `chore:`, etc.
5. Push and create a pull request

[CONTRIBUTING.md](./CONTRIBUTING.md) has the rest.

## Support

- **Issues**: [GitHub Issues](https://github.com/Huckcity/cuerunner/issues) come first.
- **Anything else**: write to `orders@cuerunner.app` — the address the
  [support page](https://cuerunner.app/support.html) publishes. It is one person reading it, so
  answers are best-effort.
- **Feedback**: The fastest way to shape Cuerunner is to file an issue with your use case — "I run sound for X and need Y" directly drives the roadmap.

## Licence

Cuerunner is free and open source under the [MIT License](./LICENSE).

- **ASIO.** Official Windows builds are built with Steinberg's ASIO SDK, under Steinberg's own
  agreement. The SDK is not in this repository and the MIT licence does not cover it (see
  `native/audio/third_party/DEPENDENCIES.json`), so a build from source has no ASIO unless you
  supply the SDK yourself — see *Packaging prerequisites*.
- **The name and logo.** The code licence does not grant the Cuerunner name or logo.
