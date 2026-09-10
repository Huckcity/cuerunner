# WinsLab

A cross-platform **QLab alternative** for Windows and macOS — professional show-control software for managing audio, MIDI, OSC, and network cues in live performance and broadcast environments.

Built with Electron, React, TypeScript, and Zustand. Licensed under [MIT](./LICENSE).

**Operator documentation:** the [user guide](https://huckcity.github.io/winslab/guide.html) covers
running a show — workspaces, timing and advance, every cue type, the run log, and
troubleshooting. Its source is [`website/guide.html`](./website/guide.html).

## Features

- **9 Cue Types**: Audio, MIDI, OSC, Wait, Fade, Stop, Group, Network, and Script cues
- **Audio Playback**: per-cue level, pan, rate, and trim with fade-in, loop counts, and a clickable waveform
- **MIDI Control**: Send MIDI messages to external instruments and gear
- **OSC Integration**: Send Open Sound Control messages for networked control
- **Show Sequencing**: Group cues, set auto-advance, pre/post-wait delays, and arm/disarm
- **Session Log**: cue run results, script output, and failures in a bottom panel
- **Workspace Management**: Save/load `.wlab` JSON workspaces with undo/redo
- **Cross-Platform**: Windows (NSIS installer) and macOS (DMG) builds, plus an experimental Linux AppImage
- **Timeline Mode**: Visual timeline-based show layout (alternative to list view), with blocks that snap end to end

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

### Development Commands

```bash
npm run dev                # Start electron-vite dev server with hot reload
npm run typecheck          # TypeScript type check (no emit)
npm test                   # Run unit tests (Vitest)
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Generate coverage report
npm run test:e2e          # Run E2E tests (Playwright, requires build)
npm run test:e2e:headed   # Run E2E tests with visible browser
npm run build             # Build TypeScript/React only (no packaging)
npm run preview           # Preview built app without packaging
npm run dist              # Build and package for all platforms
npm run dist:win          # Build and package for Windows only
npm run dist:mac          # Build and package for macOS only
npm run dist:linux        # Build and package for Linux only (AppImage)
npm run screenshots       # Regenerate website/assets/guide images (requires build)
npm run site              # Serve website/ locally on http://localhost:8080
```

`npm run screenshots` launches the built app, opens a demo show from a temporary file,
drives the UI, and rewrites every image used by the user guide. Run it after any UI change so
the guide cannot drift from the product.

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

Both cue types show a **Last Run** section in the inspector: when the cue last fired, how
long it took, the HTTP status for network cues, the start of the response body for network
cues (cut off at 4000 characters with a truncation marker), and the reason for any failure.
Run results are runtime state — they are never written to the `.wlab` file.

The **log panel** (LOG button in the transport bar) records every firing: when the cue
started, what it did, the response status, and any failure. Script cues also send their
`console.log()` / `console.error()` output there, and `shell()` output is logged whether or
not the script prints it — this is the only place to read script output in a packaged
build, which has no DevTools. The log is a bounded session history (the last 500 entries)
and is not saved.

**Script cues** run JavaScript in the app window. `await` works, and the cue waits for the
script to finish. Two helpers are in scope:

- `shell(command, { timeout, cwd, env })` — runs a system command and resolves
  `{ stdout, stderr, code, signal }`. Commands start in the workspace folder and time out
  after 10 s by default.
- `include('path/to/file.js')` — runs another JavaScript file, resolved relative to the
  workspace file, with the same helpers available.

Script cues are not sandboxed — a workspace file is executable code, so only open `.wlab`
files you trust.

### Playback Engine

`CueRunner` (in `src/renderer/src/engine/CueRunner.ts`) is a singleton that sequences cue execution:

1. **Execution sequence**: pre-wait → execute → post-wait → onDone callback
2. **Groups**: Can run children sequentially or randomly
3. **Auto-advance**: Fires next cue either immediately after pre-wait ("on-start") or after completion ("on-end")
4. **Timers**: Tracked with keys like `"cueId"`, `"cueId:pre"`, `"cueId:post"` for cancellation
5. **Panic**: 200ms audio fadeout + hard stop all

### Audio Engine

`AudioPlayer` (in `src/renderer/src/engine/AudioPlayer.ts`) uses Web Audio API:

- Audio files read via IPC and decoded client-side
- Decoded `AudioBuffer`s cached (LRU, max 100)
- Per-cue playback chain: `BufferSource → GainNode (volume + fade) → trimGain → StereoPannerNode → destination`
- One shared `AudioContext` for the whole app, feeding the output device chosen in Settings
  (`AudioContext.setSinkId`). Each audio cue carries a single output with its own level and pan;
  per-cue device and channel-pair routing does not exist.

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
├── resources/                       # App icons, installer assets
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

**Before committing**:
```bash
npm test && npm run typecheck
# For UI changes, also run:
npm run test:e2e
```

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

- **`ci.yml`**: Runs on pull requests
  - Typecheck, unit tests (Ubuntu), E2E tests (macOS)
  - Node 20 with `--legacy-peer-deps`
- **`build.yml`**: Runs on version tags (`v*`)
  - Tests + builds Windows (NSIS) and macOS (DMG) installers
  - Uploads to R2 (Cloudflare) and GitHub Releases
- **`release.yml`**: Semantic versioning with `semantic-release`

## Known Limitations

Playback and platform limits:

- MIDI native module requires ALSA headers on Linux (not officially supported), and MIDI cues
  silently do nothing when the module is unavailable
- Network cues require appropriate CORS headers on target servers, and hold the cue until the
  response or timeout
- Audio cues store absolute file paths, so a `.wlab` moved without its audio loses those links
- E2E tests require display (run on macOS in CI, headless on Linux requires Xvfb)

Behaviour worth knowing before a show:

- Fixed caps: the run log keeps the last 500 lines, a single script run emits at most 200 lines,
  and run-log messages and network response bodies are cut off at 4000 characters
- `include()` has no module semantics — an included script cannot export anything, and each file
  runs in its own scope
- A save gives no confirmation beyond the dirty dot clearing
- Group rows derive their length from their children for timeline and sequence groups; playlist
  and random groups show `–`
- OSC is send-only; Winslab cannot receive OSC yet

The [user guide](https://huckcity.github.io/winslab/guide.html) documents the behaviour of each of
these in the context of the feature it affects.

## Contributing

1. Create a branch: `git checkout -b feature/my-feature`
2. Make changes with tests
3. Run `npm test && npm run typecheck` (and `npm run test:e2e` for UI changes)
4. Commit with conventional commits: `feat:`, `fix:`, `chore:`, etc.
5. Push and create a pull request

See `CLAUDE.md` for detailed development guidelines.

## Support

- **Issues**: [GitHub Issues](https://github.com/Huckcity/winslab/issues)
- **Feedback**: The fastest way to shape Winslab is to file an issue with your use case — "I run sound for X and need Y" directly drives the roadmap.
