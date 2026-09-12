# Handoff

Branch: `feat/playback-engine-handoff` — PR [#68](https://github.com/Huckcity/winslab/pull/68), a
draft against `main`. 40 commits, all pushed, tree clean, CI green. Nothing is merged.

`main` is `b22e226 chore(release): 0.13.0`, and the branch carries **forty** commits
(`git rev-list --count origin/main..HEAD` — recount it rather than trusting this line). The first
eighteen are the WinsLab Pro and show-services work (`a4cddad` … `d989880` — licence, scenes,
triggers, wireless, the script panel and its companion) that this branch was built on and that `main`
does not have yet. The twenty-two after them are the playback rewrite (ten, `5fa7112` … `a88ebde`),
the keep-awake and silent-pacer fixes, the Windows startup repair and the diagnostics that found it,
the spec-stability work, and four handoff rewrites.

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
| `9d6bb3d` | `prevent-app-suspension` held for the app's whole life (`src/main/safety/keepAwake.ts`), asserted at launch through the dev harness. Tried against problem 1; what it does not fix is recorded there. |
| `4d8179a` | The silent pacer repays the wall time it loses instead of rebasing its deadline away, with `native/audio/tests/pace.mjs` as the deterministic acceptance (SIGSTOP a 500 ms hole, assert the clock keeps wall time). This is what problem 1 actually was. |
| `7aad479` | The Windows engine hands out one readable pipe instance: `listen()` left a connectable instance no thread read while the accept loop created its own, and Windows gives a connecting client the oldest one. |
| `0fa6d7a` | A failure on the Windows lane can name itself: the engine's stderr is kept (bounded) in main, reported with `engineStatus`, and the app's stdio is teed where Playwright prints none of it. |
| `d4ea050` | The engine is built on the heap. `sizeof(ws::Engine)` is 3.68 MiB and `main()` held one by value; Windows gives a thread one MiB, so the process died at entry with `0xC00000FD`. `native/audio/tests/stack.mjs` holds it. |
| `44d1af0` | The port-in-use assertion accepts `EACCES` as well as `EADDRINUSE` — Windows reports the former for a bind that clashes. |
| `8473eb9` | Two observation races removed: the demo spec polls the engine's voice count instead of reading it the instant the cue turns playing, and the post-wait pill gets a window long enough to be seen. |
| `ad22110` | One E2E retry, on CI only, reported as flaky rather than passed; locally there are none. |

### Verified locally (Linux)

`npm run typecheck`; `npm test` 905; `npm run test:e2e` 178 with `--workers=1`; `npm run test:native`
74 + 3 + 2 (pacer, then stack) — all re-run on Ubuntu 24.04 / Node 24.21 on the private Xvfb
display (`e2e: Electron windows open on a private virtual display; nothing appears on your screen`).
`npm run test:native:device` 26/26 against an isolated 8-channel null sink; a packaged build played
the demo walk-in twice with no inspector opened. Watching a full suite run from outside: the app's
window sits on the virtual display (`:99`), no Electron process holds the session's Wayland socket,
and 399 samples of the real display saw no new window.

Two things learned about running the suite locally, both worth keeping:

- **Playwright's default worker count is not safe for this app on macOS.** Locally
  `workers: process.env.CI ? 1 : undefined`, so a full run starts as many Electron instances as the
  machine can take; instances die at MIDI init (`MidiInCore::initialize: error creating OS-X MIDI
  client object (-304)`, then an uncaught `RtMidiError` terminates the process) and every assertion
  waiting on that window fails with it. The failing set moves run to run — seven specs in one full
  run, three of the same specs (different tests in them) in the next — which is what a dead window
  looks like rather than what a broken feature looks like. Fewer instances at once is
  the obvious lever and CI already pulls it (`workers: 1` under `CI`); the local serial run here was
  cancelled before it reported, so that is a hypothesis rather than a measurement. The uncaught
  `RtMidiError` taking main down is its own finding: a missing MIDI client is a condition to report,
  not to die of.
- **macOS has no private display.** `scripts/run-e2e.js` gives Linux its Xvfb; on a Mac the suite
  opens real windows on the logged-in desktop, so run it there only when that is wanted.

### CI on PR #68

**All lanes green** (`34722157438`): typecheck, unit-test, native-engine and electron-install on both
Node versions, and all three e2e lanes.

| Lane | State |
|---|---|
| typecheck, unit-test, native-engine, electron-install | green; the native lane runs the pacer and stack suites too |
| **e2e (ubuntu-latest)** | **green** — 176 passed, **1 flaky**: `network-script-inspectors.spec.ts:107` failed once and passed on the retry. The retry is CI-only and never silent: Playwright reports the spec as flaky and keeps the trace |
| **e2e (macos-latest)** | **green** — 178 passed, no retries; the unchanged `< 3800 ms` hidden-wait assertion passes, where it measured 8662 ms before `4d8179a` |
| **e2e (windows-latest)** | **green** — 174 passed, 4 platform skips, no retries; it had never passed before the heap fix below |

---

## Open problem 1 — macOS stalls the renderer's timers — **settled: it was the silent pacer**

It was never the renderer's timers, and it was never App Nap.

The E2E suite always runs the device-less backend (`e2e/helpers.ts` sets
`WINSLAB_AUDIO_BACKEND=silent`), and that backend's loop is the stand-in for a device. It paced
itself by rendering one block per iteration and, when an iteration ran late, rebasing its deadline —
`next = now + blockMs` (`engine.cpp:540-542`) — which threw the wall time it had lost away for good.
The show's clock advances only with rendered frames (`mixer_.advanceClock(chunk)` in `renderAudio`,
`engine.cpp:557`), and the renderer projects that clock (`audioEngineClient.ts`, the anchor and its
adoption rule), so on a contended runner the whole show ran slow.

Every observation fits that and nothing else did: a 3000 ms wait measured **5232**, **8006** and
**8662** ms of wall time across three rounds (a rate, not a clamp), audio stayed "sample-exact" on
its own slow clock, Linux was green, the failing set moved with contention, and holding
`prevent-app-suspension` (`9d6bb3d`) changed nothing — that stops suspension, not lost CPU, which is
what made the App Nap reading untenable.

`4d8179a` advances the deadline by exactly one block instead, so a starved pacer renders the blocks
it owes until it is back in phase; when it keeps up, nothing changes. Real devices are untouched —
hardware paces those.

**The acceptance needs no runner.** `native/audio/tests/pace.mjs` stalls the pacer with SIGSTOP for
500 ms and asserts the engine clock keeps wall time across it: 487 ms lost, slope 0.4609, on the old
code; nothing lost and back in phase on this one. It runs in `npm run test:native`, which the
native-engine lane already runs.

**Consequences worth keeping.** The renderer's 25 ms dispatch tick was not the weak link: do not move
dispatch into main or onto pushed engine ticks to fix this class — both designs were costed and both
would have dispatched faithfully to a slow clock. And "the show clock keeps wall time" is now held by
a test, so any future change to the pacer has to keep holding it.

**Do not loosen the timing bounds.** They were the detector.

The nine specs that were failing — `main-safety.spec.ts` (187, 225), `playlist-group.spec.ts`
(27, 55), `sequencing.spec.ts` (51, 93, 158), `timeline-playback.spec.ts` (196, 219) — predate this
branch and passed on the first macOS round after this fix.

## Open problem 2 — the engine dies at startup on Windows — **settled: a stack overflow**

The engine was several MiB of embedded queues — `sizeof(ws::Engine)` is **3.68 MiB**, most of it the
command and event queues — and `main()` held one **by value**. Windows gives a thread **one MiB** of
stack, so the process died at entry: exit code `0xC00000FD` (`STATUS_STACK_OVERFLOW`), empty stderr,
not even the `listening on …` line. Linux and macOS give the main thread eight MiB, which is why only
Windows saw it. Every Windows spec failed on a cause none of them could name.

`d4ea050` builds the engine with `make_unique` in all three entry paths (daemon, device listing,
offline renderer). Nothing else changed.

**How it was found, because the lane was blind.** The Windows runner showed no app stderr at all —
Playwright prints none of it there. So, in order: main now keeps the engine's stderr (bounded) and
reports it with `engineStatus` (`0fa6d7a`); the suite asserts the engine is up and prints the whole
status when it is not, which is what produced the exit code; and `launchApp` tees the app's stdio on
Windows. Along the way `7aad479` fixed a real bug the same investigation exposed — `listen()` created
a named-pipe instance that nothing read while the accept loop created a second one, and Windows hands
a connecting client the oldest instance, so the app could attach to the orphan and wait forever for
replies that could not come.

**Two failures that were never the engine**, once it started: `show-monitor.spec.ts` asserted
`EADDRINUSE` for an occupied port, which is the POSIX name — Windows reports `EACCES` (WSAEACCES) for
the same clash, and the app was right (`44d1af0`, which also covers the monitor alert). And the demo
spec read the engine's voice count the instant the cue turned playing, racing the start's lookahead
(`8473eb9`).

**The regression needs no runner.** `native/audio/tests/stack.mjs` starts the engine under
`ulimit -s 1024` — what Windows gives a thread — and asserts it comes up and answers. It reports
SIGSEGV on the old code and passes on this one, on Linux and macOS; Windows is covered by the suite's
engine-up assertion.

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
- **One E2E retry, on CI only.** Shared runners starve an Electron app in bursts, and the ubuntu lane
  had failed four different specs across runs — each one green in the runs either side of it and green
  on Linux/Xvfb locally. Playwright reports a retried spec as *flaky*, never as passed, and keeps the
  trace, so the count stays visible: the last green run used it once, for
  `network-script-inspectors.spec.ts:107`. Locally there are no retries — a flake is worth seeing.
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
(`safety()`, `engineInfo()`, `engineEvents()`, `keepAwakeHeld()`, `engineStatus()`), non-packaged
builds only.

## What to do next, in order

1. Retire the compile-guarded native paths on real hardware: `npm run test:native:device` needs an
   actual device, and the Windows/macOS device code has only ever been compiled by CI.
2. ASIO, when the agreement and SDK arrive — behind `MA_ENABLE_ASIO`, enumerated honestly, proven by
   the offline and device suites.
3. PR #68 comes out of draft when the user says so; the release is a separate, deliberate dispatch
   (Actions → Release → Run workflow from `main`).
