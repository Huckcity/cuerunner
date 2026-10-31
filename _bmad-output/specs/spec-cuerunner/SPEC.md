---
id: SPEC-cuerunner
companions: [capability-catalog.md, quality-and-proof.md, ../../planning-artifacts/architecture/architecture-cuerunner-2026-09-17/ARCHITECTURE-SPINE.md, ../../../INTEGRATION-HARNESS.md]
sources: [../../../ROADMAP.md, ../../../ENGINE-REVIEW-2-AND-ROADMAP.md, ../../../website/docs/guides.mjs, ../../../website/docs/reference.mjs, ../../../website/index.html, ../../../website/reliability.html, ../../../website/redundancy.html]
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.
>
> **Two layers.** This SPEC states *what is being built*. `ARCHITECTURE-SPINE.md` states *how the parts must agree* — 25 invariants, each carrying what it binds, what divergence it prevents and the rule that prevents it. Read both. The spine's `AD` IDs are stable, so a story may cite one directly.

# Cuerunner

## Why

The QLab-shaped job — one operator, one cue stack, sound plus MIDI, OSC and network cues, a GO button — has had no real option on Windows. QLab is macOS-only and says none is planned: the port is a rewrite, not a decision waiting to happen, so every Windows house is left out by construction. The nine-year answer to "what replaces QLab on Windows" has been "nothing, or buy a Mac mini", while the venues that need it most — schools, community theatre, churches, touring and rental houses — already run Windows machines and ASIO interfaces. Cuerunner is that option: a cue stack that runs a real show and the show services around it, free and open source. The chosen ground is where QLab is weakest — redundant playback, the showfile as a versionable artifact, desk integration, and reliability published from real runs rather than asserted.

## Capabilities

- **CAP-1 — Run a show from the cue stack**
  - **intent:** An operator can build and fire a full show: the cue types `CUE_TYPES` declares (the catalog's table), groups and timelines, GO/STOP/PANIC, pre/post waits, advance modes, triggers, undo and the run log.
  - **success:** Existing E2E suites drive real shows and CueRunner unit tests hold GO/advance/stop semantics; a fresh install fires and stops a multi-cue show.
- **CAP-2 — The sound survives the interface**
  - **intent:** Playback runs in a native engine process, so the UI can die mid-show and the sound continues; the operator can recover the window without dropping the show.
  - **success:** Kill tests on every PR and nightly (renderer killed, engine killed, device taken away) each assert a defined behaviour, not merely that the application did not crash; crash recovery restores cue position, never re-fires a running show.
- **CAP-3 — Starts and clocks within stated tolerances**
  - **intent:** A cue starts within one audio block plus slack (15.67 ms at 48 kHz / 512 frames) and the show clock holds wall time (≤0.5% drift) through an hour-long show with zero xruns and no leaks past the caches.
  - **success:** The nightly soak (eight one-hour seeded shards plus a faults job, fan-in to `soak-latest.json`) passes with zero xruns and underruns, and the reliability page renders those numbers — saying "nothing published" when absent; the 2× realtime floor on the worst supported mix is enforced on every PR by `matrix-bench` exiting non-zero below it. The measured multiple is whatever that run reports; it is never quoted from prose.
- **CAP-4 — Install and run on the supported platforms**
  - **intent:** An operator on Windows 10+ (primary), macOS 12+, or 64-bit Linux (experimental AppImage) can install and run; memory does not grow with file length.
  - **success:** Platform installers built in CI; E2E lanes on Windows, macOS and Linux-Xvfb; Windows and macOS installers signed and signature-verified by the build workflow when certificates are supplied.
- **CAP-5 — Windows pro-audio I/O, including ASIO**
  - **intent:** The engine plays through WASAPI shared/exclusive and, in a build given the Steinberg SDK, hosts ASIO drivers directly: one device up to the 32-channel ceiling, the driver owns rate and buffer (the engine resamples and says so), latency is the driver's own figure, and a driver that stops calling is treated as lost after 1.5 s with panic-and-reopen.
  - **success:** `npm run test:native:asio` hosts a real driver on win-ci every run; the ASIO rules (56 checks) and device-failure (12 checks) suites pass; device-loss E2E releases affected rows with the fault line.
- **CAP-6 — Redundant playback**
  - **intent:** Two machines on one workspace mirror whole-app state over the network; the standby takes over mid-cue, resuming the running audio at its position plus elapsed-since-last-beat and carrying the operator's place so the next GO matches.
  - **success:** Redundancy E2E (pair, handover) pass; both panels show "In sync" / "answering" / "warmed" as defined; the documented limits (no edit mirror, no one-shot replay, position at best a quarter-second old and not sample-aligned) remain true.
- **CAP-7 — The showfile is a versionable artifact**
  - **intent:** A workspace saves deterministic bytes, keeps its last 200 saves inside the file, compares with another version, three-way merges two people's copies (same-field conflicts named), and bundles the show and its media into one `.cuerunnerx` that round-trips.
  - **success:** Determinism tests hold bytes as a function of (show, folder) for files this machine writes; merge and bundle E2E pass; a file whose shape this build does not recognise is refused rather than guessed at.
- **CAP-8 — Integration with real desks and consoles**
  - **intent:** Cuerunner fires and answers ETC Eos over OSC both ways, drives Allen & Heath SQ and Avantis with per-desk semantics — a scene recall writes that scene's DCA membership to the desk and then the mic's mute, addressing nothing outside the controlled set (the SQ through its native control service, the Avantis through its documented assignment form, and each profile's mute its own route) — sends and answers MSC, and takes desk buttons as GO/BACK — integrating with the lighting job, not owning it.
  - **success:** The peer lane runs on every PR against the app and replays recorded fixtures; the vendor lane runs nightly against real ETCnomad on win-ci with its settings checklist; every assertion reads the peer's wire view or the desk's reply, never the app's self-report. Each lane claims only its own class: the peers prove the wire against an independently written implementation of the vendor's documents, never desk acceptance, and a lane that skips leaves its claim where it was. A recall's bound is held by its own case — no message names a channel outside the controlled set — and the hardware lane reads the SQ's own answer where the desk publishes one.
- **CAP-9 — Run-of-show ergonomics**
  - **intent:** The operator gets fast setup and clear run state: durations as soon as files load, cue split, waveform region editing with 1×–32× zoom and a per-cue cursor, timeline, batch colour and expand/collapse, save feedback, a show-wide repeat guard that defaults to blocked, transients computed in the engine, and vamps released by devamp cues.
  - **success:** Each item is held by its named unit test and E2E spec (the roadmap's landed table); transient checks in `offline.mjs` section 20; the devamp release checks in the offline suite.

## Constraints

- **A DCA is a control group, not a mute group:** assignment decides whose levels a fader controls and is a per-scene decision — a scene owns which of the show's channels ride which fader, mutes belong to the mic, and a channel may ride more than one fader unless the show turns that off. Where it does ride several, an SQ over the network can be asked for highest wins: the desk is told one membership at a time — the highest of the channel's faders, a muted one counting as -inf — and main moves it as the faders cross, read off the desk's MIDI service.
- **A recall writes only what the scene controls:** it writes the scene's membership and then the mic's mute, and addresses no channel outside the controlled set; the set is a setup fact (a count of channels and the desk number each one is), and the desk's I/O patch is never modelled or written.
- **A recall's base is the desk's own answer where the desk answers:** where a desk publishes no read — Avantis assignments and SQ assignments today — the base is what Cuerunner last sent, and a resync the operator can run is how the desk is put back in step.
- **Windows audio reality:** ASIO is required for the pro path (Dante Virtual Soundcard users otherwise cap at 16 channels as unsynchronised stereo pairs); the Steinberg SDK cannot be redistributed, so a signed agreement is a release gate before publishing a linking build.
- **One output device**, no aggregation; clocking belongs to the OS aggregate or Dante/AES67; the driver owns rate, buffer and channels.
- **Offline-first:** no phone-home, no cloud dependency; a venue machine with no internet runs exactly like any other.
- **The renderer is trusted, and that premise is load-bearing:** nothing untrusted is ever loaded into the window — main holds the socket and the ledger of what a panel may do. The window is sandboxed and its built page carries a Content-Security-Policy, but those are a second line behind the premise, not a replacement for it: neither was designed to contain hostile content. Bringing remote or user-authored content into the renderer is a redesign of this boundary, not a feature.
- **Performance floors in CI:** 2× realtime on the worst supported mix; engine limits 64 voices, 64 crosspoints, 32 output channels, 10 s schedule horizon.
- **Quality bar:** each fix lands with the test that keeps it true; never weaken product behaviour to green a test; E2E drives real Electron windows on the self-hosted runners.
- **Compatibility:** the saved shape is declared and checked, never migrated — a file whose shape this build does not recognise is refused rather than guessed at, and no legacy pass survives. The grouping repair with its load note and the unknown-cue-type refusal read a file this build wrote and is damaged, which is not compatibility. `.cuerunner`/`.cuerunnerx` formats are frozen facts.
- **Generated docs:** operator-visible changes update `website/docs/*.mjs` in the same commit; published numbers are read from runs, never typed.
- **Signed installers** are required for venue machines; certificates and the signed ASIO agreement are external inputs still owed.

## Non-goals

- No media-server territory beyond the show's own outputs: video, image and text cues play on video outputs (reopened 2026-10-08; spine AD-27), and show-wide projection mapping, live camera inputs and a media server's own timeline are still driven over network/OSC/MIDI.
- No plugin hosting (VST), no cloud features, no phone-home.
- Not a lighting console: Art-Net/sACN output from the cue list is a patch, faders to build a look, Light cues that fade it with tracking — and nothing past that: no programmer palettes, no console command line, no fixture library beyond a definition file read in; a show whose lighting is run from a desk keeps the desk.
- No writing a desk beyond the controlled set: a recall writes DCA membership and the mic's mute — and highest wins writes membership between recalls, for the channels a scene placed on several faders — and the desk's I/O patch and every channel outside the set are left exactly as they are.
- No audio-device aggregation.
- Redundancy is not an editor mirror, not a replay of one-shots, not sample-exact.
- No OSC wildcard/pattern matching; OSC input is UDP only; the tablet view is read-only by design.
- No concurrent editing of one showfile — merge is for the two files that result.
- Not distributed through app stores.

## Success signal

A Windows house that would have bought a Mac for QLab runs its show on Cuerunner instead: the cue stack for playback and the ears, the desk, redundancy and showfile work, installers that pass signing on a venue machine, and the nightly soak's own numbers on the reliability page.

## Assumptions

- The rename to Cuerunner is complete product-wide; the WinsLab names left in the CHANGELOG URLs and the download host are stale artifacts, not contract.
- Code and green tests are current state; the status-annotated documents are dated evidence.
- Windows 10+ is the primary supported platform, macOS 12+ maintained (the floor the pinned Electron 41.5.0 imposes), Linux (AppImage) experimental.
- The three integration lanes the harness names are built and none of their jobs has ever run: a dispatch-only hardware lane against a real SQ or Avantis on a named address, an A&H sibling job carrying the desk path through MIDI Control's virtual port, and an end-to-end `msc` case riding the hardware lane with a console on a cable. Each reports skipped without its counterpart, with what it is missing named, and no desk claim is made from either — a claim is only as strong as the lane that ran (`INTEGRATION-HARNESS.md` §11). The developer run against an SQ-6 on 2026-09-21 passed the cases a desk can carry and is not a lane's own report, so no claim row moved for it.
- The SQ's native control service has a peer, and the capture it was measured from runs on every pull request on Linux: `integration/peers/sqNative.ts` — an independent reader, decoder and answer set taken from `integration/fixtures/vendor/sq6-native-apply-2026-09-22.json` — is started by `desk-sq.spec.ts` beside the MIDI peer and drives a whole recall, and `harness-desk.spec.ts` holds the model itself to the capture with no application running (Story 11.5). What a peer cannot carry is the desk's own answer: the capture holds no membership frame and no keepalive datagram, so the read form stays open below and the SQ's claims stay where the record leaves them until a desk run.
- The desk profiles' channel ceilings (SQ 48 inputs, Avantis 96) are taken as the profiles' own numbers and have not been checked against the desks' published channel counts: a ceiling that is wrong would report a gap for a set the desk could take.

## Open Questions

- Is Linux in-spec in the support matrix or experimental only? (README lists 64-bit Linux as supported; the AppImage is called experimental and MIDI needs ALSA headers at build.)
- The v0.14.0 schedule question is answered: the release was dispatched, signed and published on 2026-09-21 (`CHANGELOG.md`).
- The copy audit's findings are cleared, re-checked 2026-09-27: `guides.mjs` links and text both read `pub.cuerunner.app`; `redundancy.html` shows the 53110 default and no `.wlab`; `README.md` carries neither the typed 8.7×/43× figures (the 2× floor the `matrix-bench` gate enforces is what it publishes) nor a Node 20 claim — its prerequisites line reads Node 24, which `engines.node` declares.
- Is an auto-update channel in scope? Distribution is installers plus GitHub Releases today.
- Are the Wave 3 items (Companion/remote command, LTC/MTC timecode, Shure receiver integration, Art-Net/sACN, cue print and QLab import) commitments this spec should carry, with dates?
- Is the SQ assignment read form measured — the desk's own answer, by changing a pair at its surface and diffing what it pushes — or does Cuerunner's record of what it sent stay the base, with resync the only correction?
- The desk's rule for a controlling client is measured for one host only: a client that dies without its goodbye leaves its control service mute until the desk is reset — does the app own leaving by the desk's own door before a hardware run counts?
