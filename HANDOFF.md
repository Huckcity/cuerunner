# Handoff

Branch: `feat/playback-engine-handoff` — PR [#68](https://github.com/Huckcity/winslab/pull/68), a
draft against `main`. 28 commits, all pushed, tree clean. Nothing is merged.

`main` is `b22e226 chore(release): 0.13.0`, and the branch carries **twenty-eight** commits: the
eighteen before this workstream are the WinsLab Pro and show-services work (`a4cddad` …
`d989880` — licence, scenes, triggers, wireless, the script panel and its companion) that this
branch was built on and that `main` does not have yet. The ten after them are the playback
rewrite.

The branch is the playback rewrite: the renderer stopped owning audio. Device I/O, the sample clock,
the scheduler, streaming and the decoded cache moved into a native engine, and the desk drives it
over a local socket. It also carries the E2E suite's private display, and the release is now
deliberate rather than automatic.

**Nothing publishes.** `release.yml` runs from `workflow_dispatch` only, so merging to `main`
publishes nothing; run *Actions → Release → Run workflow* from `main` when the version is wanted.
Latest release is still `v0.13.0`. Before that change, merging this branch would have cut `v0.14.0`
(feat/fix commits) and `build.yml` would have followed with installers.

---

## What landed

| Commit | What |
|---|---|
| `5fa7112` | `native/audio/**`: C++17 engine — device I/O, sample clock, scheduler, streaming, decoded cache, routing. Vendored decoders; LGPL-only FFmpeg helper for Linux AAC. |
| `b572dcc` | The desk drives it: `window.winslab.audio` verbs, cue times on the engine clock, routing matrix, workspace-relative media + one-pick relink, main-process panic/watchdog/network. |
| `371a323` | The fire path prepares its own media; GO from the cue list no longer fails with `not-prepared`. |
| `50dfa4a` | A prepare that outlasts the lookahead moves the run's end with the late start, instead of cutting the tail. |
| `cbeb3b7` | E2E runs on a private Xvfb and every test app is pinned to X11 (`--ozone-platform=x11`), so the suite never opens windows on the developer's desktop. |
| `eac809e` | The release gate above. |
| `e09b44e` | Windows build: object names from the file (not the path), MSVC found on PATH (`cl --version` is not a thing), crash test unpinned from Chromium's word for a dead renderer. |
| `e164ac6` | `NOMINMAX`: `windows.h`'s `min`/`max` macros vs `std::min`/`std::max` (MSVC C2589). |
| `08033fe` | Five headers include what they use (`<string>`, `<memory>`, `<vector>`, `<atomic>`, `<utility>`). |
| `a88ebde` | The E2E wrapper runs the Playwright CLI directly — Node refuses to spawn `npx.cmd` without a shell (EINVAL), which is why Windows never ran a test. |

### Verified locally (Linux)

`npm run typecheck`; `npm test` 902; `npm run test:e2e` 176; `npm run test:native` 74/74;
`npm run test:native:device` 26/26 against an isolated 8-channel null sink; a packaged build played
the demo walk-in twice with no inspector opened. Watching a full suite run from outside: the app's
window sits on the virtual display (`:99`), no Electron process holds the session's Wayland socket,
and 399 samples of the real display saw no new window.

### CI on PR #68

| Lane | State |
|---|---|
| typecheck, unit-test, native-engine, electron-install | green on both Node versions |
| **e2e (ubuntu-latest)** | **green** |
| e2e (windows-latest) | engine now compiles and links with MSVC; suite ran for the first time — **149 passed, 23 failed** (see below) |
| e2e (macos-latest) | 8–11 failures, all timing (see below) |

---

## Open problem 1 — macOS stalls the renderer's timers (product question, unresolved)

**Do not loosen the timing bounds to make this pass.** The bounds are the detector.

The chain, in code:

- `src/renderer/src/engine/audioEngineClient.ts:149` — `setInterval(() => this.tick(), TICK_MS)`,
  `TICK_MS = 25`. That interval is what refreshes the clock anchor and notifies subscribers.
- `src/renderer/src/engine/CueRunner.ts:153` — the scheduler is built on that:
  `new SampleScheduler(() => audioEngine.nowMs(), cb => audioEngine.onTick(cb))`.
- `nowMs()` extrapolates the engine's sample time with `performance.now()`, so *times* are right;
  what can be late is the *dispatch*, which rides a renderer timer.
- `grep -rn 'powerSaveBlocker\|powerMonitor' src/ native/` → nothing. The app never asks macOS to
  stay awake.

Measured on macOS runners: a 3000 ms wait took **8006 ms**; six 400 ms waits took **7114 ms**; the
first macOS CI run on the same commit took 5232 ms. That is a systematic 2–3× stretch, not jitter,
and it lands on waits and chains while audio playback stays sample-exact (the engine owns that
clock). Main-era CI was green on these same specs because Web Audio played *in the renderer* —
audible audio keeps an app out of App Nap. Audio now plays in a separate native process, so nothing
holds it off.

Two ways out, both for the owner of the product's stage behaviour to pick:

1. `powerSaveBlocker.start('prevent-app-suspension')` in main (recommended first try — one small
   change, and one CI round falsifies or confirms it). A show controller that gets napped while its
   window is hidden or nothing is playing is a stage risk in its own right.
2. Take dispatch off renderer timers — engine-pushed ticks, or dispatch `due` from main. Bigger, but
   immune by construction.

Affected specs (all of them predate this branch and were green on `main`-era CI): `sequencing.spec.ts`
(51, 72, 93, 125, 158, 188), `timeline-playback.spec.ts` (196, 219, 244), `playlist-group.spec.ts`
(27, 55), and the two off-screen tests in `main-safety.spec.ts` (187, 225).

## Open problem 2 — the engine dies at startup on Windows

Symptoms in the Windows lane: `.running-badge` stays `idle` after GO, the walk-in never reaches
`data-state="playing"`, and the only runtime engine line in the log is `audio engine connection
closed`. Several failures are downstream of it (`demo-workspace.spec.ts:79`,
`failure-reporting.spec.ts:71`, three `main-safety` panic tests, `settings.spec.ts:57`).

**Next step, one CI round:** tee the app's stderr into the test output (`e2e/helpers.ts`; the engine
prefixes its own lines with `[winslab-audio]`), so the engine names its own reason instead of being
guessed at. The binary path and named-pipe transport already handle Windows
(`src/main/audio/AudioEngine.ts:119-139`), and the silent backend is platform-independent
(`engine.cpp:364`), so the cause is further in.

Then, once playback works there: `show-monitor.spec.ts:106` (a port another program holds) is worth
reading closely — Windows' `SO_REUSEADDR` semantics differ from POSIX, and the test may be asserting
a POSIX behaviour. `media-footprint-warning.spec.ts:88` and the two `script-containment.spec.ts`
failures are still unclassified.

---

## Constraints and decisions worth keeping

- **ASIO stays out** until the signed Steinberg agreement and the licensed SDK exist. No GPL ASIO, no
  bundled ASIO, no no-op ASIO device entries, no claims of ASIO support.
- **Never weaken or re-pin product behaviour to green a test.** Spec-side failures get spec-side
  fixes. The unsaved-changes prompt and its dirty tracking stay as they are.
- Don't touch WinsLab Pro/licence gates; preserve atomic workspace writes, backups, recovery and the
  legacy migrations.
- **The E2E suite must not take over the desktop.** `scripts/run-e2e.js` gives it a private Xvfb on
  Linux; `e2e/helpers.ts` pins every test app to X11 because Electron 28+ auto-selects a Wayland
  session's compositor and ignores `DISPLAY` (`ELECTRON_OZONE_PLATFORM_HINT` is no longer read — the
  command line is the only lever). `npm run test:e2e:headed` is the deliberate opt-in to watch a run.
- **The crash test skips when the watchdog got there first.** A runner slow enough to starve the
  renderer past the three-second heartbeat panics before the crash lands, and a renderer that stopped
  answering cannot be crashed — that is the safety net working, not the test's subject. Don't "fix"
  it back to a hard failure.
- The two off-screen tests hide the window rather than minimise it: `minimize()` needs a window
  manager, and a bare Xvfb has none. Playwright also launches with
  `--disable-background-timer-throttling`, so those tests hold the sequencing contract, not the clamp
  that motivated `backgroundThrottling: false`.
- Any packaged smoke needs a fresh `dist/` (`npm run predist:linux && npx electron-vite build &&
  npx electron-builder --linux --dir`) — an old `dist/linux-unpacked` proves nothing. `dist/` and
  `out/` are gitignored.

## Recipes

```bash
npm run test:e2e -- e2e/<spec>.spec.ts     # builds first, runs on the private display
npm run test:e2e:headed -- e2e/<spec>.spec.ts   # same run, on your own display

# CI: what is running, and what it said
gh run list --branch feat/playback-engine-handoff
gh run watch <run-id> --exit-status
gh run view --job <job-id> --log | grep -E '✘|failed|passed'

# Isolated 8-channel sink, for anything that wants a real device
pactl load-module module-null-sink sink_name=winslab_acceptance channels=8 \
  channel_map=front-left,front-right,rear-left,rear-right,front-center,lfe,side-left,side-right \
  sink_properties=device.description=WinsLab-Acceptance
WINSLAB_AUDIO_BACKEND=pulseaudio WINSLAB_AUDIO_DEVICE=winslab_acceptance xvfb-run -a <app>
pactl unload-module <id>                   # afterwards
```

Engine env overrides: `WINSLAB_AUDIO_BIN`, `WINSLAB_AUDIO_BACKEND`, `WINSLAB_AUDIO_DEVICE`,
`WINSLAB_AUDIO_EXCLUSIVE`, `WINSLAB_AUDIO_SAMPLE_RATE`, `WINSLAB_AUDIO_SOCKET`,
`WINSLAB_TEST_AUDIO_CAPTURE` (dev builds, writes a WAV tee). Dev harness: `__winslabDevHarness`
(`safety()`, `engineInfo()`, `engineEvents()`), non-packaged builds only.

## What to do next, in order

1. macOS: decide between `powerSaveBlocker` and engine-side dispatch (problem 1), then take one CI
   round to see whether the stall goes.
2. Windows: capture the engine's stderr (problem 2), read its reason, fix it, re-run the lane.
3. Then the Windows failures still standing: `show-monitor` port semantics, `media-footprint-warning`,
   `script-containment`, and the timing class once playback works there.
4. Retire the compile-guarded native paths on real hardware: `npm run test:native:device` needs an
   actual device, and the Windows/macOS device code has only ever been compiled by CI.
5. ASIO, when the agreement and SDK arrive — behind `MA_ENABLE_ASIO`, enumerated honestly, proven by
   the offline and device suites.
6. PR #68 comes out of draft when the lanes are green and the user says so; the release is a separate,
   deliberate dispatch.
