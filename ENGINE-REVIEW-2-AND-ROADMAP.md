# Handoff 2 — engine review and forward plan

Reviewed against the tree containing `native/audio` (6,762 lines of C++, miniaudio
backend) and the rewritten `CueRunner`. Part A is defects found in the new engine work.
Part B is what I think this product needs to become a thing an A1 chooses over QLab,
rather than a thing that technically competes with it.

Part A should be cleared before Cuerunner runs a performance. Part B is a year's shape,
not a backlog to start on Monday.

---

## Status — 2026-09-13

**Part A is cleared.** All five items are in `feat/playback-engine-handoff` (PR #68), each
with the test that keeps it true.

**B1 is built** in `feat/soak-and-faults` — the soak, the kill tests, the page the numbers
are published on, and signing wired into the release build. One half of B1 needed input
from outside this repository and is still *wired but unproven*: the certificates that make
the installers signed (the pipeline refuses to claim a signature it does not have). The
other half — a night on `main` for the nightly itself to run — stopped being a question of
money on 2026-09-13: see "Where CI runs" below.

**Where CI runs (2026-09-13).** Nothing in this repository runs on GitHub-hosted runners
any more, which is why the nightly is free:
`ubox` (Linux, six runner instances, and now a KVM guest running x64 Windows Server 2025
for the Windows lane and `build-windows`), and the Mac mini (the macOS lanes, arm64, which
is what the `.dmg` ships for). The pipeline was previously the binding constraint on how
often anything could be *tested* — the nightly alone would have been roughly 9 of a 3,000
-minute month, every night. It no longer is. `CLAUDE.md → CI runners` is the operational
document; the two hosts build themselves from `~/homelab/ci/`.

**The Windows machine B2 was waiting for exists** as of the same date, and has since stopped
being a guest: the Windows runner is a NUC of its own now (`ci/win-nuc` in the homelab repo,
labels `win-ci`), a real x64 Windows host in CI. The guest it replaced had no audio hardware
— it could *compile* an ASIO backend and exercise WASAPI's failure paths, and could be given
an emulated endpoint with one QEMU flag — and the NUC brings whatever endpoints that board
exposes; either way, verifying ASIO itself still needs a real interface, and the Steinberg
agreement is still the first gate.

**B2's ASIO half is built (2026-09-16), on `feat/asio-backend`.** The engine hosts ASIO
drivers when Steinberg's SDK is supplied to the build and does not mention ASIO when it is
not. Three things about how it is built are worth keeping:

- **It is a miniaudio custom backend, not a second device layer.** miniaudio has no ASIO
  support and does have a hook for a backend that brings its own driver; using it means
  ASIO arrives as `--backend asio` and `ma_backend_custom`, and everything the engine
  already does about devices — enumeration, the reopen that follows a settings change, the
  info readout, the resampler warning, device loss, the settings panel — works unchanged.
  The engine's only ASIO-shaped code is the sentence an operator gets when the build has no
  ASIO, the permission to switch backends through `configure`, the driver's own latency in
  the readout, and a health check that knows this backend cannot report a loss.
- **The SDK is not in the repository and cannot be.** Its proprietary half forbids
  redistribution, so nothing here vendors it: `scripts/asio-sdk.mjs` reads one variable
  (`CUERUNNER_ASIO_SDK`, the directory holding `common/asio.h`), the build compiles
  `asio_backend.cpp` and the SDK's own `host/pc/asiolist.cpp` only when it is set, and
  `ensure-native.mjs` treats a change in that state as a rebuild (a dev who drops the SDK
  in must not silently keep a binary without it). CI probes the variable, then
  `C:\asio-sdk\ASIOSDK`, and warns when neither exists. Publishing a build that links the
  SDK needs the signed agreement, and the build workflow reads the record of it for itself: `native/audio/third_party/ASIO-AGREEMENT.md` present and non-empty is that record, and a build that links the SDK without it **withholds its installer** — the job passes, the warning names the missing record, and nothing is uploaded for a release to publish or a mirror to copy (`build.yml`, the "Record what this installer is" step). The checklist describes the state; it is not what catches this.
- **The driver instance is the backend's own COM object**, not the SDK's global loader: the
  loader keeps the instance after a failed `init`, so a driver that was busy once could
  never be opened again in that process and would report "already open" instead of the
  reason. Enumeration still uses the SDK's `AsioDriverList`, which is a registry read.

What the device does, and what it costs, in the engine's own terms: the driver is asked for
the operator's sample rate and keeps its own if it refuses (an externally clocked
interface), in which case the engine resamples and says so; the buffer size requested is
snapped to what the driver's min/max/granularity accepts and the readout says what it gave;
the latency is the driver's own figure, published as `driver` rather than estimated; the
output channel count is the operator's setting capped by the mixer's 32 (a 64-output Dante
licence plays to 32, and the engine says so in a warning rather than pretending); an ASIO
device is reported as exclusive because it is; and a channel the driver wants in a type this
build cannot write (DSD) is refused by name before a buffer is created.

Two ASIO facts the engine has to work around, both handled and both stated: the interface
has **no "the device is gone" notification**, so a driver that stops calling back for 1.5
seconds is treated as a lost device (the blocks the driver itself reports as overloads or
resyncs are counted as xruns), and a driver that asks to be **reset** — its own control
panel changed the buffer size or the clock — gets the device reopened with its new numbers
and a line in the warnings saying that is what happened.

What is proven where: the sample-word conversion and the buffer-size rules are compiled and
run with no SDK and no driver (`native/audio/tests/asio-rules.cpp`, first in
`npm run test:native`, and it earned its keep immediately — it caught full scale coming back
as the most negative sample, because 1.0 × 2147483647.0f rounds up to 2^31 in float and the
int32 conversion of that is not what anyone wants); the Windows engine compiles and links
with the backend in it; and the hosting itself — instantiating a driver, creating its
buffers, rendering into them on its thread, and a panic landing in the driver's own buffer —
is what `npm run test:native:asio` proves on a machine that has one. The `win-ci` runner has
one: Steinberg's *built-in* ASIO driver, which drives whatever Windows endpoint the box has,
put there by `provision-asio.ps1` in `~/homelab/ci/win-nuc/`, so the lane hosts a real
driver on every run. **The agreement that lets a build containing the SDK be published is
what B2 still owes.**

That smoke paid for itself on its first runs. Every check but the last passed while the
ended event never reached the client — and a trace of the engine showed it emitting the
event and its background thread draining it, so the line was being lost in the listener. The
Windows pipe was opened for synchronous access, and Windows serializes I/O on such a handle:
a write from the event thread queued behind the connection thread's blocking read and only
completed when the client sent its next verb (3.5 s, measured, for one ended event). The
instances are overlapped now (`27353fc`), which is the fix the smoke was built to demand.

| Item | Commit | Held by |
|---|---|---|
| A1 session identity, and a show clock that survives a restart | `e12b4a8` | `e2e/engine-restart.spec.ts` (kills the engine child mid-sequence), `audioEngineClient.test.ts` |
| A2 pan applied only under automatic routing | `f7d0509` | `native/audio/tests/offline.mjs` — unity matrix to four outputs, five pan values |
| A3 crosspoints indexed once, not scanned per frame | `f7d0509` | `native/audio/tests/matrix-bench.mjs` — fails below 2× realtime |
| A4 exclusive mode as a device setting, with the engine readout | `1ebda57` | `e2e/settings.spec.ts`, `usePlaybackBridge.test.tsx` |
| A5 limitations rewritten, release checklist added | `1a676ba`, `89e683b` | `.github/RELEASE_CHECKLIST.md` |
| B1 the soak, nightly and on every pull request | `94c508d` | `native/audio/tests/soak.mjs`, `.github/workflows/soak.yml`, one minute of it in `ci.yml` |
| B1 the kill tests | `9f9da12` | `native/audio/tests/stream-stall.mjs`, the malformed-media section of `offline.mjs`, `e2e/device-loss.spec.ts` (plus the existing renderer-killed and engine-killed specs) |
| B1 the numbers, published | `94c508d` | `scripts/soak-report.mjs` → `soak-latest.json` → `website/reliability.html` |
| B1 signing and notarisation | `94172ba` | `.github/workflows/build.yml` signs from secrets and verifies its own artifact; `.github/RELEASE_CHECKLIST.md` |
| B4 the desk transport, and the lane that holds the peers to their documents | `d8e2137` | `src/main/midi/MidiTcpEngine.ts`, `src/main/services/MidiTcpService.ts`, and everything under `integration/` — two desk profiles, an Eos peer, a nightly vendor lane, one recorded console session |
| B4 the desk profiles, in the desk's own arrangement | `1b18e21` | `utils/desk.test.ts` for each profile's bytes, and `integration/specs/desk-sq.spec.ts` / `desk-avantis.spec.ts`, which assert the desk's own mute state |
| B5 redundant playback: the pair, the mirror, and the takeover | `c8109dc` | `src/shared/redundancy.test.ts` (the protocol, the verdicts and the takeover plan), `src/main/services/RedundancyService.test.ts` (a pair over real loopback sockets with the clock driven by the test), `src/renderer/src/engine/CueRunner.adopt.test.ts`, `src/renderer/src/hooks/useRedundancy.test.tsx`, `e2e/redundancy.spec.ts` — where the spec process *is* the live machine |
| B5 the machine's own half of the arrangement | `a872cba` | `src/main/redundancy/machine.test.ts` |
| B4 show control, both directions | `d9a4d93` | `utils/msc.test.ts` (the vendors' worked examples), the show-control cases in `CueRunner.test.ts` and `triggers.test.ts` / `inputGuard.test.ts`, and `integration/specs/msc.spec.ts` |

**Redundant playback (2026-09-15).** B5 is in, on `feat/redundancy-failover`, and it is
built the way this architecture allows rather than the way the paragraph above imagined it.
There is no headless engine to reuse: the cue list and its timers live in the window and the
sound lives in the native engine, so a second machine runs the *whole app* and what crosses
the wire is state rather than scheduled commands. All four bullets are covered — both
machines run the same show with one driving and one standing by; a heartbeat five times a
second with a stated three-second timeout and a stated choice between telling the operator
and taking over; a takeover that puts a playing audio cue back at the position it had
reached plus the silence since the last beat, with the operator's place in the show carried
across and everything that cannot be picked up named in the run log rather than faked; and a
status that says which machine is running the show, when the partner was last heard from,
whether the two have the same show open, and what this machine last did about it.

What it deliberately does not do is claim more than that. The two machines must have the
same file open — the status says plainly when they do not, and the digest carries a
fingerprint of the cue list so "the same show" is a claim and not a hope. Unsaved edits are
not mirrored: the cue stack is workspace content, and a backup that silently rewrote its own
copy of the show would be a second editor rather than a backup. A MIDI or OSC cue that has
already gone out is not repeated, a wait or a fade or a script that was half-way through is
not resumed, and a cue in its post-wait is already finished. Anything the machine standing by
was running by hand is stopped at the takeover, so what is playing afterwards is exactly what
the mirror said and nothing else. The other direction is handled too: a machine that hears a
higher term than its own stops driving *and stops playing*, so a manual takeover — the operator
pressing the button while the live machine is still answering — does not leave two machines
inside the same cue. Two machines both set to *Live* both believe they are driving, and the
status says so instead of choosing for them — the term that settles a returning machine is a
claim about who took the show over, not a lock on the operator's hands. And what no heartbeat
can tell apart is a dead machine and a dead network: a partition reads as silence, so a standby
on the far side of one takes the show over while the live machine plays on, and the live machine
stands down when the beats come back. The one second in which both are inside the same cue is
the trade a stated timeout makes, both machines say so while it is happening, and the guide's
limitations say it plainly.

The settings are per machine, in `redundancy.json` in the user-data directory, because both
machines run the same workspace file: a role written into the show would be read as the same
answer by both of them.

**Desk integration and the harness (2026-09-15).** B4's "console control profiles" has its
transport: a show now drives a desk over the desk's own MIDI socket (TCP 51325 —
`MidiTcpEngine` and `MidiTcpService`), so an SQ or an Avantis can be reached without Allen &
Heath's MIDI Control in the way, and the desk's own scene recalls come back into the triggers.

The same work produced the first half of a record of what the desks actually do:
`integration/` holds a peer per device written from the vendor documents (an ETC Eos console's
OSC, an SQ and an Avantis on the wire), a lane that drives them on every pull request, and a
nightly lane that drives real ETCnomad, records the session with its provenance, and replays it
on Linux. What that found is the missing half of B4's profile list: the app's DCA convention is
its own, and neither desk speaks it — an Avantis takes an open and ignores the close, an SQ
takes neither. Both that and MSC are since built (`feat/desk-profiles-and-msc`: the desk profiles
in `utils/desk.ts`, and Show Control in `utils/msc.ts`, `CueRunner` and the triggers); Art-Net
and sACN are untouched.

Measured, so the next reader does not have to re-derive it: the matrix benchmark went from
**0.71× to ~11× realtime** at 24 voices, 32 outputs (`kMaxOutputChannels` clamps the 64 in
A3's estimate) and 64 crosspoints, and a `Voice` is 128 bytes smaller than before it.

Three places the implementation differs from what this document prescribed, and why:

- **A1 is an epoch, not a task rebase.** The renderer keeps engine-time-to-show-time
  offsets per session, so the show clock is continuous across a replacement and no
  scheduled time moves. A wait cue mid-count keeps the rest of its time because none of
  its times were ever expressed in engine time; `CueRunner` only says what happened. Runs
  are watched by (session, run id) — the engine's run counter starts over with the engine
  — and a line that arrives late is translated on the clock it was written on.
- **A3 left the per-frame `paramValue` and pan computation alone.** Measured at ~9% of the
  render cost in the same benchmark; not worth the ramp-edge risk until the channel counts
  that motivated A3 arrive.
- **A4 does not show the device refusal on silent and offline backends.** Those backends
  refuse every device request by definition, including the one a window sends when it
  opens, and a red line that can never be cleared teaches people to ignore red lines. A
  real device's refusal is still shown, in the engine's own words.

### Part B after B1, in progress

- **B2 is built, both halves.** The half that is not ASIO (`efbbdf9`,
  `feat/device-rate-notice`): a cue whose file is not at the rig's rate says so under its
  file name — the engine resamples, so the pitch and tempo are right, but "right" and
  "stated" are different things, and the demo's own walk-in is 44.1 kHz on a 48 kHz engine.
  The one-device policy that belongs with it (no aggregate devices; clocking is the OS's or
  a Dante/AES67 layer's) is stated in the README and the guide. **ASIO is in as well**
  (`feat/asio-backend`, 2026-09-16; see Status): the engine hosts a driver when Steinberg's
  SDK is present at build time and says why when it is not, an operator picks the audio
  system in Settings → Audio, and the driver's own latency, buffer size and channel count
  are what the engine reports back. What remains outside this repository is the signed
  Steinberg agreement (needed to *publish* a build that links the SDK) and an ASIO driver
  installed on `win-ci` (needed for the smoke lane to test anything).
- **B6 is built** (`feat/showfile-history`): deterministic serialisation was the
  precondition and came first (`aabe177`, `feat/showfile-determinism`) — the renderer
  minted a fresh id and createdAt on every save, so pressing Save twice rewrote the show's
  identity. The identity now belongs to the show, and the bytes on disk are a function of
  the show and the folder it is saved into. On top of that: a save writes what it changed
  into the file's own history (and writes nothing when nothing changed); the diff behind
  that is a pure function of two workspaces, exposed as a comparison of the show against
  another file; a three-way merge between two people's copies, from the version they
  started from, with the cues both changed named rather than decided quietly; and a bundle
  that carries the show and every file it plays as one `.cuerunnerx`. Two determinism defects
  had to be fixed for the history to be honest — the cast migration minted channel ids
  with `crypto.randomUUID()`, so migrating one old file twice produced two different
  files, and the diff only compared a cue's media when one side carried the `media` key,
  which hid a relink in any file this build had not saved.

### B1, as built

- **The soak** (`native/audio/tests/soak.mjs`, `npm run soak`) drives a generated show
  through the engine's real mixer, scheduler and decoders on the silent pacer: hundreds of
  cues an hour at a 120–440 ms cadence, overlapping voices, fades on volume/pan/trim/rate,
  loops (finite and endless), seeks, routing changes and stop-alls, with the three short
  media cached and a 90-second file streaming. It asserts zero xruns, zero stream
  underruns, zero dropped chunks, every scheduled start inside a stated tolerance of its
  time on the sample clock, the engine clock within a stated drift of the wall clock, no
  voice active-but-frozen, and no leak past the cache and stream budgets. Deterministic
  from `--seed`; `--shard i --shards n` is what the nightly splits on; the JSON report is
  written whatever happens, including after a crash.
- **The nightly** (`.github/workflows/soak.yml`) runs eight one-hour shards (a GitHub job
  may not run six hours, and eight jobs fail separately), then a `faults` job, then fans
  the shard reports into one result (`scripts/soak-report.mjs`) and publishes it with the
  A one-minute soak runs on every pull request so the harness itself cannot rot.
  The cost note this paragraph used to carry — roughly nine hours of billed Linux runner
  time a night, on a private repository — is history: the shards now run on the homelab
  runner (`ubox`), so a night costs electricity. `workflow_dispatch` still takes `minutes`
  if a shorter night is wanted.
- **The kill tests.** Renderer killed mid-show and engine killed mid-show already existed
  (`e2e/reliability.spec.ts`, `e2e/engine-restart.spec.ts`). Added here: a media reader
  that stalls mid-stream (`native/audio/tests/stream-stall.mjs` — stops the engine for
  two seconds, asserts the wait is counted, warned about, survived, and that audio comes
  out of the other side), malformed media at the cue list (the section in `offline.mjs`),
  and the device taken away mid-show (`e2e/device-loss.spec.ts`, through a new
  `simulateDeviceLoss` harness verb that the engine refuses whenever a real device is
  open). All of them run nightly; the native ones run on every pull request.
- **The numbers are published, not written down.** The fan-in result goes to
  `soak-latest.json`, the nightly deploys it with the site, and `website/reliability.html`
  renders whatever is in that file — with an honest "nothing published yet" when it is
  absent, and no number anywhere that did not come from a run.
- **Signing** is wired into `build.yml`: Windows from `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`
  and verified with `Get-AuthenticodeSignature`; macOS from `MAC_CSC_LINK` /
  `MAC_CSC_KEY_PASSWORD` plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
  verified with `codesign`, `spctl` and `stapler validate`. With no certificate the build
  warns and produces an unsigned installer rather than failing — the certificate is
  external input, and the checklist is where that button is pressed.

Evidence from the runs used while building it, on the development machine — three
two-minute shards (seeds 3, 11, 29) and one ten-minute shard (seed 101): **0 xruns, 0
stream underruns, 0 dropped chunks** on every one; 192–227 cues started in the short
shards and 1050 in the ten-minute one; worst start delay 10.33 ms on all of them against
the stated 15.67 ms tolerance (one block of quantisation plus slack); clock drift within
0.005%; peaks of 16–24 voices with 4–10 of them streaming; resident media at most
5.1 MiB. Ten minutes is the longest run here; the eight-hour version is what the nightly
is for, and it has not had its first night yet — the workflow only runs from `main`.

### Three engine defects the B1 work found, all fixed with the test that keeps them fixed

- **A corrupted media file aborted the engine.** `dr_wav` and `dr_mp3` free their own
  state when init fails, and the source destructors uninitialized the failed decoder
  anyway — a double `fclose`/free, and glibc aborts the process. A truncated WAV in the
  cue list took the engine, and whatever was playing, down with it. `365cdc1`.
- **A streamed voice never followed its own position.** The ring window stayed where the
  decoder was opened, so a start at an offset, or a loop wrap on a long file, played
  silence forever with an underrun for every frame. Behind it sat `WavSource::seekToFrame`
  comparing `drwav_seek_to_pcm_frame()` — which answers `DRWAV_TRUE`/`DRWAV_FALSE` —
  against `DRWAV_SUCCESS`, so *every* WAV seek reported failure and flagged the stream
  EOF right after repositioning it. `14d9458`.
- **A streamed voice below real time starved permanently.** At a rate under 1 the same
  source frame serves several output frames, and the ring released one frame past the one
  being played, so a long file at half rate (or with a rate fade on the way down) played
  silence and counted an underrun per output frame, for good. `7050c45`.

- **A streamed start counted as starvation.** A newly acquired ring holds nothing yet, and
  that first wait was only exempted when the voice started at an offset — so an ordinary
  streamed start could be reported as "the audio waited for the disk". `595b125`.

The first two were found by writing the kill tests; the third by running the soak, and the
fourth by running it on eight channels. That is the argument for both halves of B1.

---

# Part A — fixes

## A1. The engine clock has no epoch, and restart silently kills the show

**Done — `e12b4a8`.** Implemented as an epoch rather than the task rebase described below;
see Status.

**Severity: show-stopping. Do this first.**

**Where:** `src/renderer/src/engine/audioEngineClient.ts:95` (`adoptClock`),
`src/main/audio/AudioEngine.ts:536` (`scheduleRestart`), `native/audio/src/engine.cpp:741`

**Problem:** the native clock is derived from `renderedFrames_`, so a respawned engine
starts counting from zero. `adoptClock` deliberately refuses any reading that would move
the show clock backwards and keeps projecting the old anchor forward from
`performance.now()`. That guard is correct for jitter and wrong for a restart.

The failure sequence, ninety minutes into a show:

1. The engine dies. `handleExit` respawns it after a backoff. Good so far.
2. The renderer's projection still reads ~5,400,000 ms. The new engine's clock reads ~40 ms.
3. Every command carries an absolute time near 5,400,000.
4. `Engine::startCue` compares against `scheduleHorizonMs` (10,000) and rejects with
   `"start is scheduled beyond the engine horizon"`.
5. The engine reports healthy. Every cue for the rest of the night is refused.

The operator sees a working app that will not fire anything, with no obvious cause.

**Change:** give the clock an identity.

- The engine mints a session id (monotonic counter or UUID) at startup.
- It returns that id on the connection handshake and on every `clock()` reply, and
  includes it in the `AudioEngineEvent` stream.
- `AudioEngineClient` records the session id alongside the anchor. When the id changes,
  re-anchor unconditionally, in either direction, and discard the old projection.
- Any scheduled task in `CueRunner` holding a time from the previous session is invalid.
  Rebase pending tasks onto the new clock rather than dropping them: a wait cue mid-count
  should resume with the remaining time, not vanish.
- Surface the restart in the session log and the playback-warnings bar. An engine restart
  during a show is something the operator must be told about, not something to paper over.

**Test:** integration test that kills the engine child mid-sequence, asserts the client
re-anchors, asserts the next cue fires, and asserts a warning was raised. `PlaybackSafety`
already has a dev harness that can drive this.

## A2. Pan is applied to outputs 0 and 1 even under an explicit matrix

**Done — `f7d0509`.**

**Severity: wrong audio, silently.**

**Where:** `native/audio/src/mixer.cpp`, in `Mixer::render`, immediately after the
crosspoint accumulation:

```cpp
if (output == 0) contribution *= panLeft;
else if (output == 1) contribution *= panRight;
```

**Problem:** this runs regardless of `voice.automaticRouting`. A mono cue routed
explicitly to outputs 0–3 at unity comes out 3 dB down on 0 and 1 (centre pan on a mono
voice is `cos(π/4)` on both sides) and unity on 2 and 3. The matrix the operator typed is
not the matrix that plays. Worse, it is the kind of error that gets blamed on the desk,
the amps or the room before anyone suspects the software.

**Change:** pan is a property of automatic routing only. Move the two lines inside the
`if (voice.automaticRouting)` branch. An explicit crosspoint list is the complete
statement of destination and level; nothing should be applied on top of it except the
voice gain envelope.

**Test:** offline render asserting that a mono source with an explicit unity matrix to
four outputs produces identical RMS on all four, at any pan value. The offline path in
`native/audio/tests/offline.mjs` is the right place.

## A3. Crosspoint lookup is in the innermost loop

**Done — `f7d0509`.** A per-output tap list built at apply time, with the benchmark below;
the per-frame `paramValue`/pan hoist was measured and deliberately not taken (Status).

**Severity: hard ceiling on channel count.**

**Where:** `native/audio/src/mixer.cpp`, the `for (int i = 0; i < voice.crosspointCount; i++)`
scan inside the per-output loop, inside the per-voice loop, inside the per-frame loop.

**Problem:** the cost is `frames × voices × channels × crosspoints`. At 48 kHz with 24
voices, 64 output channels and 64 crosspoints that is roughly 4.7 billion iterations a
second, almost all of them rejected by `point.outputChannel != output`. It will be fine
in testing with a stereo pair and fall over on the rig it was built for.

**Change:** build an output-indexed structure once, when the command is applied, not per
frame. Either a per-output list of `(inputChannel, gain)` pairs, or a dense
`gain[input][output]` array given the bounded `kMaxOutputChannels`. The inner loop then
walks only the crosspoints that feed the output being written.

While in there, the per-frame `paramValue` calls and the `cos`/`sin` pan computation are
also per-frame per-voice. Ramps are linear between control points, so gain can be
computed once per block and incremented per sample; pan only changes when its ramp is
active. Neither is urgent, but both become relevant at the same channel counts that make
A3 urgent, so measure them together.

**Test:** a benchmark in `native/audio/tests` that renders a fixed duration at 64
channels, 24 voices and a full matrix, and fails if realtime factor drops below a
threshold. Without a number in CI this regresses quietly.

## A4. Exclusive mode is reachable only by environment variable

**Done — `1ebda57`.** The environment variable stays as the spawn-time development
override; the setting is the product path, and a refusal keeps the engine's own words.

**Where:** `src/main/audio/AudioEngine.ts:336` (`CUERUNNER_AUDIO_EXCLUSIVE`)

On Windows, exclusive versus shared is the setting that determines whether a user gets
real channel counts, a sample rate that matches their session, and predictable latency.
It is not a developer flag. It belongs in the device section of Settings, with the
trade-off stated plainly: exclusive locks the device against everything else on the
machine, including system sounds and conferencing apps.

Add a device-capability readout next to it — backend, sample rate, channel count, buffer
size, current xrun and underrun counts. `Engine` already tracks all of it; the operator
just cannot see it. An A1 checking a rig before a show will want that page.

## A5. The README's Known Limitations is stale

**Done — `1a676ba`, `89e683b`.** The three entries below were rewritten against the code,
and `.github/RELEASE_CHECKLIST.md` now carries the check that keeps them honest.

Three entries describe behaviour the code no longer has: MIDI silently doing nothing (now
surfaced by `MidiStatusBadge`), network cues requiring CORS (now handled in
`src/main/network/NetworkClient.ts`), and audio cues storing absolute paths (now dual-written
relative and absolute by `WorkspaceManager`, with a relink flow in
`components/media/MissingMedia*`).

This matters more than normal housekeeping because the README is also the pitch. Anyone
evaluating Cuerunner reads that section and concludes the product has problems it fixed
weeks ago. Add a documentation check to the release checklist.

---

# Part B — what this product needs next

**Not started.** Nothing below has been built yet; it is kept as written.

The three fixes above make Cuerunner safe to run a show. They do not make it a product
anyone switches to. The rest of this is my view of what does, in the order I'd want it.

The organising principle: **do not chase QLab's feature list.** You will lose that race
and it is not where the market is soft. Win on the two things QLab is genuinely weak at —
redundancy and showfile management — and on the A1 workflow it ignores entirely.

## B1. Prove it does not fall over (immediate, and permanent)

**Done — `94c508d`, `9f9da12`, `94172ba`.** The soak, the kill tests, the page the
numbers are published on and the signing pipeline are in; see Status for what each one
asserts and for the two pieces that need input from outside the repository (certificates,
and a night on `main`).

The single biggest obstacle to adoption is not features. It is that "Electron" reads as
"will drop out" to exactly the people who must trust it, and they are right to think so
about most things built that way. You need an answer that is evidence, not assurance.

- **Soak test in CI.** An eight-hour automated show run through the offline pacer:
  hundreds of cues, overlapping voices, fades, loops, seeks, routing changes. Assert zero
  xruns, zero underruns, and cue timing within a stated tolerance of the sample clock.
  Run it nightly. Publish the result.
- **Kill tests.** Renderer killed mid-show, engine killed mid-show, device yanked
  mid-show, disk stalled mid-stream. Each asserts a defined behaviour, not a crash. A1
  and the streaming underrun path are both covered by this.
- **A public reliability page** with the numbers on it, and the architecture explained in
  one paragraph: the interface is Electron, the engine is a small native binary, the UI
  can die and the show continues. That sentence is your entire marketing position.
- **Signed and notarised installers** on both platforms. An unsigned binary will not get
  installed on a venue machine, full stop.

## B2. Audio I/O parity (required for the Windows market)

**Built — `feat/asio-backend`, 2026-09-16.** All three bullets below are in; see Status for
what each one does, what is proven where, and the one thing still owed from outside this
repository (the signed Steinberg agreement — the SDK, the driver and the lane are in place).

- **ASIO**, under the proprietary Steinberg agreement, behind the same backend interface
  as WASAPI and Core Audio, compiled conditionally so source builds without the SDK still
  work. Without it, Dante Virtual Soundcard users are capped at 16 channels presented as
  eight unsynchronised stereo devices, which is not a usable output stage. Dante is the
  backbone of the venues you are selling into.
- **Sample-rate and device-mismatch handling that says so.** If the file is 44.1 and the
  device is 48, the operator should see that stated, not discover it as a pitch shift.
- **Explicit "one device" policy.** Do not build aggregate-device support. Clock
  discipline across devices is a swamp; tell users to aggregate at the OS or Dante level.

## B3. Timecode (required for the target market)

LTC and MTC, chase and generate. A musical running click and tracks, anything with
video playback or automation to follow, anything cueing to a film — all of it assumes
timecode. Its absence rules Cuerunner out of those productions entirely, and it is not an
exotic feature; it is table stakes for the room you are trying to enter.

Chase is the harder half: the engine already has a sample clock, so the work is
disciplining that clock to an external reference without audible artefacts. Doing it in
the native engine, where the clock lives, is the only sane place.

## B4. Show Control integration depth

- **MSC (MIDI Show Control)** in and out. This is how sound talks to lighting and
  automation in a professional house. OSC and raw MIDI do not substitute.
- **Art-Net / sACN** output, at least for simple cue-light and house-light control.
- **Console control profiles** for the desks that actually appear in your market. You
  already have Scenes driving desk groups; a small library of known-good profiles is
  worth more than a generic protocol.

What is in place, and what the first run against hardware found:

- A show drives a desk over the desk's own MIDI socket (TCP 51325) as well as through Allen &
  Heath MIDI Control, and the desk's own messages come back into the triggers — the transport
  half of the third bullet.
- The first run against real hardware (ETC Eos v3.3.9.25, with a peer for each desk and the
  lanes in `INTEGRATION-HARNESS.md`) found the half that was missing: the app's DCA messages were
  its own convention, so an Avantis took an open and ignored a close, and an SQ took neither.

**The first two bullets' MSC half and the third bullet are built** (`feat/desk-profiles-and-msc`,
2026-09-15):

- **Console control profiles.** `DeskSettings.profile` names the desk — an SQ, an Avantis, or
  anything that takes a note on and a note off — and the arrangement follows from the desk's own
  document: an SQ's NRPN mute on page 02 (eight DCAs, parameters from zero), an Avantis's
  note-on at velocity `7F` on and `3F` off on the channel four above its own (sixteen DCAs). A
  DCA the profile cannot address says so instead of going quiet. A desk message is a sequence
  now, because an SQ's mute is four controllers where the generic arrangement is one note. Held
  by `utils/desk.test.ts`, and by both desk specs in `integration/`, which now assert the desk's
  own mute state rather than the bytes the app believes it sent.
- **Running the show from the desk's own buttons.** The same tables, read the other way:
  `DeskSettings.buttons` says which spare mute groups are the operator's GO and BACK keys, and
  `useDeskButtons` + `utils/deskInput.ts` read the message a key press makes the desk send —
  page 04's groups on an SQ, the mute-group notes on an Avantis — and walk the show's *scenes*
  with it (`sceneStep`), which is what those keys move on a desk that has no GO button. A
  button is a change rather than a message: the desk's own report primes the app, so a show
  opened onto a desk with a group muted does not recall a scene by itself, and a DCA's mute is
  deliberately not a button, so a recall coming back off the desk cannot run the show. Held by
  `utils/deskInput.test.ts`, the walk cases in `utils/scenes.test.ts`, and `desk-buttons.spec.ts`
  end to end.
- **MSC out.** A Show Control cue (`type: 'msc'`, a cue stack member) sends Go,
  Stop, Resume, Load or Reset with the receiving console's cue number and list, to the show's
  desk connection or to a MIDI port. `utils/msc.ts` is held to the vendors' worked examples
  (ETC's Go cue 5.4 of list 99, Allen & Heath's Go cue 12).
- **MSC in.** An `msc` trigger fires a cue on a console's own command, matched on every field
  the console sent, and the firing guard covers it so a doubled GO is one firing.
- **Still untouched: Art-Net and sACN.** The second bullet has not been started, and nothing
  above changes that: cue-light and house-light control need a different protocol, and the
  harness has nothing to hold it to yet.

## B5. Redundancy and failover (the flagship)

This is the thing to build the product's reputation on, and your architecture already
supports it in a way QLab's does not.

The engine is a headless process speaking a documented socket protocol. That means a
second machine can run the same engine, receive the same scheduled commands, and stand by
sample-aligned. The pieces:

- Main and backup both run the engine; the main drives, the backup mirrors cue state and
  pre-rolls the same media.
- A heartbeat between them with a stated timeout and a stated takeover behaviour.
- Deterministic takeover: the backup knows which cue is running and at what position, and
  picks up rather than restarting.
- A visible, honest status: which machine is live, whether the backup is in sync, when it
  last heard from its partner.

Every A1 currently rigs this by hand with two machines, a matrix and a prayer. Doing it
properly is worth more than any ten cue types.

**Built (2026-09-15), on `feat/redundancy-failover`, with one correction to the premise.**
There is no headless engine to point a second machine at: the cue stack and its timers live
in the window, and the sound lives in the native engine behind it. So a second machine runs
the whole app, and what crosses the network is state rather than scheduled commands — which
cue is running, how far into its file the engine has reached, what the operator has
selected, and a fingerprint of the cue list so "the same show" is checked rather than
assumed. All four bullets are in, and what the takeover does and does not carry is written
down in the status section above (`## Status`).

## B6. The showfile as a versionable artifact (your unfair advantage)

You do infrastructure engineering for a living. Nobody in this market treats a showfile
as a config artifact, and everybody suffers for it.

- **Deterministic serialisation.** Stable key order, no embedded timestamps, no
  reordering on save. Two saves of an unchanged workspace must be byte-identical. This is
  the precondition for everything else here and it is cheap now, expensive later.
  **Built first** (`aabe177`, and the key order moved into the serialiser itself since):
  held by `src/main/workspace/determinism.test.ts` and `e2e/showfile.spec.ts`.
- **Cue-level diff.** "What changed between preview and press night" as a view in the
  app, not a mystery. Show added, removed, moved and edited cues with the fields that
  changed. **Built**: `src/shared/showfile.ts` is the diff — added, removed, edited with
  the fields, and moved, where a move is the smallest set of cues that explains a
  reordering — and *Show History… / Compare Show…* read it out. What counts as a change is
  what a person typed: the route to a media file, the region a scan measured and a cue's
  identity are the app's own fields, so a show copied to another folder does not diff
  against itself.
- **A change log.** Who touched which cue, when. Sound designers, associates and deputies
  all edit the same file; today nobody can reconstruct what happened. **Built**: the save
  is the unit of authorship (a save is who wrote the file), and each one that changes the
  show appends an entry naming the cues and settings that moved. It travels in the
  `.cuerunner`, is bounded at two hundred entries, and an unedited save appends nothing —
  which is what keeps the file byte-identical and the history trustworthy.
- **Merge for the designer/associate split.** Two people working on different acts should
  not have to send files back and forth and lose work. **Built**: a three-way merge that
  asks for the version the two sides started from, takes a cue one side changed, blends a
  cue both sides changed in different fields, and names a cue both changed in the same
  field instead of deciding quietly. It writes a new file and leaves both inputs alone, so
  it is safe to run twice — the report's second button runs it again with the other side's
  choices. What it does not carry (the file a cue plays, the show's name) is stated.
- **A bundle format.** Workspace plus media as one artifact, so handover is one file.
  The relative-path work you just did is the foundation; the bundle is the payoff.
  **Built**: `src/main/workspace/bundle.ts` writes `show.cuerunner` and `media/` into a
  `.cuerunnerx` — a store-only zip, streamed, with fixed timestamps so two bundles of one show
  are the same bytes, CRC-checked on the way out, and refusing any name that would climb
  out of the folder it is extracted into. It opens in any file manager.

Together these turn "the showfile" from a thing people email around into something with a
history. That is a story no competitor is telling.

## B7. Deepen the A1 wedge (ongoing, and it is the actual product)

The mic plot, RF telemetry, battery alarms weighted by entrance, swap log and night
report are the reason someone installs Cuerunner rather than reading about it. Keep
investing here while everything above is happening.

- Direct integration with the monitoring protocols of the receiver brands your market
  uses, rather than a generic telemetry source.
- The night report as a real artifact — exportable, shareable, with the playback
  cleanliness numbers from B1 in it. "The show ran clean" as a document.
- Anything that shortens the tech-week feedback loop: fast cue creation from the script,
  bulk edits, a decent search.

## B8. Operator ergonomics and safety

- **Nothing may ever eat a GO press** (`c71ed05`): audited — `useKeyboard` is the
  renderer's only Space handler, every dialog listens for Escape and nothing else, no
  listener is on the capture path or stops immediate propagation, and every
  application-menu accelerator is a modified key — and held by `e2e/go-press.spec.ts`,
  which fires the show with each modal up in turn and with a dialog's own button focused,
  plus the one case where the space belongs to the field it was typed into.
- **Panic from the hardware** (`panicBindings.ts`, `handlers.ts`): OSC `/cuerunner/panic`
  and MIDI all-sound-off (CC 120 at value 0) are decided in `panicBindings.ts`, where a
  unit test can hold the decision, and acted on by `playbackSafety` in the main process —
  where the engine is — so a desk or a controller silences the show without the window.
  The guide documents both, and the menu's `Ctrl/Cmd+Shift+P`, under *Panic from the
  hardware*.
- **Resume-in-place after a crash** (`30288df`): the autosave snapshot carries the cue
  the session was standing on, the recovery notice names it, and recovering puts the
  selection back there — so the next GO fires what it would have fired. A *running* show
  is not handed back (voices, queues and the desk went with the process); the cue
  position is the part the operator resumes and the part a file can hold.
- Keyboard-first operation throughout, with the bindings documented on one page.

## B10. Explicitly deferred

Say no to these loudly, to yourself and in the docs:

- **Video.** It doubles the surface area — GPU compositing, codec licensing, edge
  blending, sync — and the wedge is sound. Interoperate with video playback over MSC and
  timecode instead of becoming it.
- **Plugin hosting.** VST in a show-control app is a support nightmare and a stability
  risk on the path that must never fail.
- **Cloud anything.** Venues run air-gapped or hostile networks. Local-first is a
  feature, not a limitation. Anything that requires the internet on press night is how you
  lose a venue permanently.

---

## Suggested sequencing

| Window | Work |
|---|---|
| Immediate | A1, A2, A3; then A4, A5 — **done 2026-09-13** |
| Done | B1 soak and kill tests, signing — **built 2026-09-13**, merged to `main`, and free to run nightly from then on (certificates still owed) |
| Done | **B2 is complete** — the rate-notice half is in (`efbbdf9`), and **ASIO is in** (`feat/asio-backend`, 2026-09-16): a custom backend behind the same device interface, built only when Steinberg's SDK is supplied out-of-band, with the driver's own rate/buffer/latency reported. What is owed is external to the code: the signed Steinberg agreement, to publish a build that links the SDK. The driver and the lane are in place — `win-ci` has Steinberg's built-in ASIO driver (`~/homelab/ci/win-nuc/provision-asio.ps1`) and the smoke hosts it there, which is how `27353fc` (the Windows pipe serialized its two directions) was found. **B6 is in** (`feat/showfile-history`): the diff, the change log, the merge and the bundle, on top of the precondition. |
| Then | B3 timecode, alongside B7. **B4's desks and MSC are in** (`feat/desk-profiles-and-msc`); Art-Net/sACN, the rest of B4, is not |
| The year | **B5 redundancy is in** (`feat/redundancy-failover`); **B6 is in** (`feat/showfile-history`) |
| Always | B7 wedge, B8 ergonomics |

If only one thing from Part B happens, make it B1. Reliability you can demonstrate is the
precondition for anyone caring about the rest.
