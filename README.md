# WinsLab

A cross-platform **QLab alternative** for Windows and macOS — professional show-control software for managing audio, MIDI, OSC, and network cues in live performance and broadcast environments.

Built with Electron, React, TypeScript, and Zustand. Source-available under the [Functional Source License 1.1, MIT future license](./LICENSE) — see [License](#license).

**Operator documentation:** the [user guide](https://huckcity.github.io/winslab/guide.html) covers
running a show — workspaces, timing and advance, every cue type, the run log, and
troubleshooting. Its source is [`website/guide.html`](./website/guide.html).

## Features

The cue stack is free, and so is everything in it. The show services and the views
around them are **WinsLab Pro** — one license key, checked on the machine. See
[WinsLab Pro](#winslab-pro) and the [user guide](https://huckcity.github.io/winslab/guide.html#pro).

### Free

- **9 Cue Types**: Audio, MIDI, OSC, Wait, Fade, Stop, Group, Network, and Script cues (the tenth, Scene, drives the desk from the stack and is part of Pro)
- **Audio Playback**: per-cue level, pan, rate, and trim with fade-in, loop counts, and a clickable waveform
- **MIDI Control**: Send MIDI messages to external instruments and gear
- **OSC Integration**: Send Open Sound Control messages for networked control
- **Show Sequencing**: Group cues, set auto-advance, pre/post-wait delays, and arm/disarm
- **Session Log**: cue run results, script output, and failures in a bottom panel
- **Workspace Management**: Save/load `.wlab` JSON workspaces with undo/redo
- **Durable Saves**: atomic writes with a `.bak` of the previous version, autosaved recovery snapshots, and a crash banner instead of a silent reset
- **Cross-Platform**: Windows (NSIS installer) and macOS (DMG) builds, plus an experimental Linux AppImage
- **Timeline Mode**: Visual timeline-based show layout (alternative to list view), with blocks that snap end to end

### WinsLab Pro

Everything below is in the same download and is unlocked by a key, not by another
installer:

- **The show around the cue stack**: OSC and MIDI input, the show monitor, network presence, and the wireless service that reads a telemetry source
- **Wireless and the mic plot**: who is wearing which pack, the alarm before a battery dies on someone with an entrance, a swap log, and the night's report
- **Triggers**: a cue that fires from an OSC address or a MIDI note with nobody's hand on GO
- **The script panel**: the script beside the stack, cues pinned to its lines, and the tablet companion that serves it over the show network
- **Scenes and the desk**: the view the show is run from, with desk groups driven over MIDI or OSC, and scene cues in the stack

## Getting Started

### Prerequisites

- Node.js 20+ (Node 24 also supported)
- npm or yarn
- macOS 10.15+, Windows 10+, or Linux (for building)

### Installation

```bash
# Clone the repository
git clone https://github.com/Huckcity/winslab.git
cd winslab

# Install dependencies (add --legacy-peer-deps if npm reports ERESOLVE)
npm install

# Start dev server with hot reload
npm run dev
```

> **npm 11.16+ / v12**: Install scripts (native compilation for `midi`, Electron binary download, `esbuild` binary) require explicit approval. This project ships an `allowScripts` allowlist in `package.json` that pre-approves these packages. If you see "install scripts blocked" warnings or `Error: Electron uninstall` when launching, the project's postinstall step patches the known Node 26 zip-extraction bug, detects a missing Electron binary, repairs it automatically, and prints manual recovery steps if that fails.

### Try the demo workspace

Every build ships a demo show — `resources/demo/Demo Show.wlab` — with one of each cue type
covered: a sequence group, a timeline group, audio with fades, MIDI, OSC, a network request, a
script, and a stop cue. Open it from **WinsLab ▾ → Open Demo Workspace**, or from the button in
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

WinsLab ships an **experimental Linux AppImage**. Audio, OSC, network, and script cues work
normally. MIDI cues are **unavailable** on Linux unless you install ALSA development headers
(`libasound2-dev`) before installing dependencies — the native `midi` module needs them at
build time.

### Build from source

```bash
# Install ALSA headers (for MIDI support — optional otherwise)
sudo apt-get install -y libasound2-dev

# Clone and install
git clone https://github.com/Huckcity/winslab.git
cd winslab
npm install

# Run in development
npm run dev

# Package an AppImage into dist/
npm run dist:linux
```

The AppImage is written to `dist/WinsLab-<version>.AppImage`. If your distro has no FUSE,
extract and run it instead:

```bash
./dist/WinsLab-*.AppImage --appimage-extract-and-run
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
configured correctly"*, that's distro-wide Chromium sandbox policy, not WinsLab: either fix
the helper (`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod
4755 node_modules/electron/dist/chrome-sandbox`) or launch with `ELECTRON_DISABLE_SANDBOX=1`.

## Architecture

WinsLab is structured as an Electron app with three distinct layers communicating exclusively over IPC:

```
Renderer Layer (React/Zustand)
  ├─ window.winslab (IPC bridge via contextBridge)
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
the cue's timeout, 5 s by default) before moving on. Requests are issued from the app
window, so target servers must return CORS headers.

Every cue type shows a **Last Run** section in its own inspector tab: when it last fired,
how long it took, and the reason for any failure — the HTTP status and start of the
response body for network cues (cut off at 4000 characters with a truncation marker), the
message for a script that threw or timed out, or the port an audio, MIDI or OSC cue could
not reach. A cue that could not do what it says is marked failed rather than passed over;
an OSC message that leaves the machine and is never received still counts as sent, since
UDP reports nothing. Run results are runtime state — they are never written to the
`.wlab` file.

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

Script cues are not sandboxed — a workspace file is executable code, so only open `.wlab`
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
  `<name>.wlab.bak`. A save that fails says so in a notice bar and the log; it never leaves
  a half-written file.
- Unsaved work is snapshotted to the user-data folder every 30 s. The next launch offers it
  back with Recover / Discard, and saving or discarding clears it.
- A renderer crash reloads the window and explains itself in a banner; the interface's own
  errors, and the main process's, are logged and mirrored into the session log.
- STOP and PANIC abandon work that is still in flight — a network request or script that
  settles afterwards cannot resume the show.

### Audio Engine

Playback runs in a native engine — `native/audio/`, built to `native/audio/build/winslab-audio`
— that the main process starts as a child and talks to over a local socket (Unix domain
socket, named pipe on Windows) in newline-delimited JSON. The renderer never sees media
bytes and never touches a decoder: `window.winslab.audio` is a set of execution verbs
(`prepare`, `start`, `stop`, `stopAll`, `seek`, `cancel`, `routing`, `fade`, `progress`,
`panic`, `clock`, `info`, `devices`, `configure`, `waveform`) whose times are all
milliseconds on the engine's own sample clock. `src/shared/audio.ts` is the contract both
processes and the engine speak.

- **Device I/O**: miniaudio (MIT-0). Windows WASAPI shared **and** exclusive, macOS Core
  Audio, Linux PulseAudio / ALSA / JACK. Exclusive access is requested, never assumed: if
  the device or mode asked for cannot be honoured, `configure` fails and says why.
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
  count, exclusive state, buffer/period frames and a latency marked measured, estimated or
  unknown — plus cache and streaming pressure for the warnings the UI shows.

#### Packaging prerequisites

- A C++17 toolchain: `cc`/`c++` (or `clang`) on Linux/macOS, MSVC or clang on Windows.
  `npm run dist:*` builds the engine first through `npm run build:native`.
- **Linux M4A/AAC**: the app ships an LGPL-only FFmpeg helper (pinned source, SHA-256 and
  release-signature verified, `--disable-gpl --disable-nonfree --disable-version3`) at
  `native/audio/build/decoders/ffmpeg`, packaged to `resources/audio/decoders`. Build it
  with `npm run build:ffmpeg`; without it, M4A files report a visible "decoder unavailable"
  error instead of failing silently. Windows and macOS need nothing extra.
- **ASIO**: not shipped. Supporting it requires Steinberg's ASIO SDK present at build time
  (dual-licensed GPLv3/proprietary) plus `MA_ENABLE_ASIO`; no ASIO device is listed and no
  ASIO support is claimed until that SDK is available under a signed agreement.
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
```

Clean-checkout entrypoints, exactly as CI runs them: `npm run typecheck`, `npm test`,
`npm run test:native`, `npm run test:e2e`, `npm run dist:linux`. On Windows the compiler
must be on `PATH` (`ilammy/msvc-dev-cmd@v1` does that in CI); on Linux and macOS `cc`/`c++`
are enough. `dist:linux` and the `test:native` pre-step build the M4A helper on a machine
that does not have it yet; CI caches `native/audio/build/decoders` under a key derived from
the build script so an unchanged pin is never rebuilt.

`test:native` drives the real mixer, scheduler, decoders and cache with a caller-owned
clock and asserts actual output samples: exact start/stop/fade frames, matrix routing,
loops, seeks, streaming, cache bounds and M4A decoding. It is the acceptance proof for
playback behaviour, and it needs no audio hardware. `npm run test:native:device` adds the
live-device checks (real channel counts, exclusive refusal, capture tee, panic silence).


### State Management

Zustand store (`src/renderer/src/store/index.ts`) maintains:
- `cues: Cue[]` — flat workspace cue array
- `selectedId` — currently selected cue
- `isDirty` — unsaved changes flag
- `running: Map<string, RunningCue>` — live playback state
- Undo/redo stacks (`past`, `future`)

## Project Structure

```
winslab/
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

Workspaces are saved as `.wlab` files (JSON format matching the `Workspace` interface):

```json
{
  "name": "My Show",
  "cues": [
    {
      "id": "uuid",
      "type": "audio",
      "number": "1",
      "name": "Intro Music",
      "filePath": "/path/to/file.mp3",
      "outputs": [{ "volume": 1, "pan": 0 }],
      "preWait": 0,
      "postWait": 0,
      "advance": "on-end",
      "isArmed": true
      // ... other fields
    }
  ],
  "audioSettings": { /* output device */ },
  "midiSettings": { /* default output port */ }
}
```

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
- **`build.yml`**: Runs when a release is published, or manually
  - Tests, then builds the Windows (NSIS), macOS (DMG) and Linux (AppImage) installers
  - Uploads to R2 (Cloudflare) and GitHub Releases
- **`release.yml`**: Semantic versioning with `semantic-release` — run it by hand from
  `main` (Actions → Release → Run workflow). Merging to `main` publishes nothing on its
  own, so a release happens only when it is meant to.

[`RELEASE_CHECKLIST.md`](./.github/RELEASE_CHECKLIST.md) is what a release engineer walks
before that dispatch, including the check that keeps this file's limitations honest.

## Known Limitations

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
  and run-log messages and network response bodies are cut off at 4000 characters
- A save gives no confirmation beyond the dirty dot clearing
- Group rows derive their length from their children for timeline and sequence groups; playlist
  and random groups show `–`
- OSC input is part of WinsLab Pro: with no license the app sends OSC and does not listen
  for it

The [user guide](https://huckcity.github.io/winslab/guide.html) documents the behaviour of each of
these in the context of the feature it affects.

## Contributing

1. Create a branch: `git checkout -b feature/my-feature`
2. Make changes with tests
3. Run `npm test && npm run typecheck` (and `npm run test:e2e` for UI changes)
4. Commit with conventional commits: `feat:`, `fix:`, `chore:`, etc.
5. Push and create a pull request

See `CLAUDE.md` for detailed development guidelines.

## WinsLab Pro

The Pro features listed above ship in the same app. A license key turns them on, and
keys are verified on the machine they are entered on:

- **Nothing is sent anywhere.** The key is signed by the issuer and checked against a
  public key compiled into the app, so a venue machine with no internet unlocks exactly
  like any other, and using a key tells nobody that it was used.
- **Enter it once**: *WinsLab ▾ → Settings… → License*. The license is kept beside the
  app's other settings in the user-data directory (`license.key`); it belongs to the
  computer it was entered on, not to a workspace or a show file.
- **A session keeps the license it started with.** The key is checked when the app starts
  and when one is entered, so a show that began licensed finishes licensed: a key that
  runs out overnight locks the next launch rather than the performance.
- **A key is not bound to a machine.** Verification is offline by design and nothing
  counts activations, so one key can be entered on more than one computer. Keeping to one
  machine per operator is a matter of trust between the issuer and the buyer — an
  activation server, or a machine id collected before the sale, is what changing that
  would take.
- **Show files are never affected.** A workspace written with Pro opens anywhere, keeping
  its scenes, its mic plot and its triggers, and saves back exactly as it arrived. On an
  unlicensed machine the Pro surfaces show a lock, the show services do not start, and a
  scene cue fired from the stack records that it needs a license and lets the rest of the
  show run.
- **A key can be deactivated**, which returns the machine to the free feature set.

### Issuing keys

Keys are minted offline. The private half of the product key is not in this repository
and must never be committed; it lives on the issuer's machine at
`~/.winslab/license-private.pem` (mode 600).

```bash
npm run license:keygen                                  # once: write a pair, print the public half
npm run license:issue -- --name "Theatre X" \
  --expires 2027-09-12 --id WSP-ABC123                  # mint a key for a customer
npm run license:verify -- "WSL1-…"                      # check a key against the shipped public key
```

`src/main/license/publicKey.ts` holds the public keys a build trusts, so rotating a key
means adding the new one there and releasing: existing keys keep verifying as long as
their public key stays in the list. A key's text is base32 in groups of eight, carrying
who it is for, an id to match it to a sale, and an optional last day (UTC, good through
the end of it).

**Development and E2E** mint their own keys: `WINSLAB_LICENSE_PUBLIC_KEY` overrides the
trusted key, and it is honoured only when the app is running from a source tree
(`!app.isPackaged`). A packaged build ignores it. E2E specs that need the Pro surfaces
launch with `launchApp({ license: mintLicense() })`; see `e2e/license.spec.ts` for the
gate itself.

## Support

- **Issues**: [GitHub Issues](https://github.com/Huckcity/winslab/issues)
- **Feedback**: The fastest way to shape Winslab is to file an issue with your use case — "I run sound for X and need Y" directly drives the roadmap.

## Licence

Winslab is source-available under the [Functional Source License 1.1, MIT future licence](./LICENSE) (FSL-1.1-MIT). In short:

- **Use it for anything, including paid work.** Running a show, a tour, a venue, a broadcast — commercial use is permitted, and so are internal tools and professional services built around it.
- **Don't sell it as a competing product.** You may not offer Winslab, or something substantially similar, as a commercial product or service of your own.
- **Every release becomes MIT two years after it is published**, irrevocably. FSL exists to keep this product alive while it is being built, not to hold it back forever.

The versions published before this licence (up to and including v0.13.0) were released under MIT and stay under MIT — that grant cannot be withdrawn.
