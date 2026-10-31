# Quality and proof

How the product's claims are held and which lane owns which claim. Read with `SPEC.md`; the harness itself is an adopted companion (`INTEGRATION-HARNESS.md`).

## The bar

- Each fix lands with the test that keeps it true — a data-loss bug that sat in a test hole is the pattern being closed.
- Never weaken product behaviour to green a test; spec-side failures get spec-side fixes.
- E2E drives real Electron windows; the suite runs on self-hosted runners (Linux `ubox`, the Mac mini, Windows `win-ci`), not on a developer's desktop.
- Delivered roadmap items are each held by a named unit test and E2E spec (the landed table in `ROADMAP.md`): durations, settings modal, field-saved feedback, batch colour, expand/collapse, trigger guard, cue split, transients, vamps.

## Suites and lanes

- **Unit:** Vitest (`npm test`) — 125 files / 1550 tests at the audit close (2026-09-16).
- **Native acceptance:** `npm run test:native` — `offline.mjs` (124 checks, including section 20 transients), `device-failure.mjs` (12), `asio-rules.mjs` (56), plus pace, analysis-priority, long-file-start, stream-seek, stack, stream-stall and matrix-bench suites. Fixture-based; no hardware needed.
- **E2E:** Playwright per OS.
- **Assertion discipline:** every integration assertion reads the peer's wire view or the desk's own reply, never the app's self-report of what it sent. The one case that cannot is the end-to-end MSC case: a console's command arrives on a cable this machine owns, so there is no wire view to read, and the case says so where it lives (`INTEGRATION-HARNESS.md` §11 decision 5).

## Lanes and claims

Two tables, read by `scripts/lane-claims.test.ts`: where each lane runs, held to the workflow
file it names, and the claim each lane carries today, held against the copy that states it. The
harness decides what a lane may claim (`INTEGRATION-HARNESS.md` §2, §11 decisions 2, 4 and 5);
these tables say which of those claims the lanes carry now. The words are declared in
`website/docs/lane-claims.mjs`, beside the phrase `NOT_YET_PROVED`, for the served pages the
claims are written on (`interop.html` today) — a status changed here without the declaration that carries it fails the
guard.

### Lanes, and where each runs

A lane with two jobs takes a row each: the vendor lane's Eos half is `eos-windows`, and
`ah-windows` is the A&H desk path through MIDI Control's virtual port (`INTEGRATION-HARNESS.md`
§8). The hardware row's runner is the label the workflow names, so a desk on another network is
a run on a runner that can reach it: that label in `integration-hardware.yml` is the one thing
a desk elsewhere changes.

| Lane | Workflow | Job | Trigger | Runner | Tag | Suite |
|---|---|---|---|---|---|---|
| `peers` | `.github/workflows/ci.yml` | `integration` | `pull_request` | `[ubuntu-24.04]` | — | `npm run test:integration` |
| `vendor` | `.github/workflows/integration-vendor.yml` | `eos-windows` | `workflow_dispatch` | `[self-hosted, windows, x64, win-ci]` | `@vendor` | `npm run test:integration` |
| `vendor` | `.github/workflows/integration-vendor.yml` | `ah-windows` | `workflow_dispatch` | `[self-hosted, windows, x64, win-ci]` | `@ah` | `npm run test:integration` |
| `hardware` | `.github/workflows/integration-hardware.yml` | `hardware` | `workflow_dispatch` | `[self-hosted, linux, x64, ubox]` | `@hardware` | `npm run test:integration` |
| `asio` | `.github/workflows/ci.yml` | `e2e` | `pull_request` | `[windows-2025]` | — | `npm run test:native:asio` |

The `Suite` column is the command the lane's own job runs, held to that job's step: the four
integration rows run one suite with different `--grep`s, and the ASIO lane's step runs the native
smoke — the `e2e` job's Windows half, whose condition selects the `windows` matrix entry, which
is the runner this row names.

### Claims, and the lane behind each

A status is one of four words, and `—` in the lane column is a claim no lane carries: `proved`
means a lane has run it and it holds; `witnessed` means a person ran it on real hardware and the
repository holds what they saw; `unproven` means the lane that would carry it exists and has not
run; `unclaimed` means no lane carries it and it stands nowhere.

`witnessed` exists because no lane will ever run every receiver and desk a show meets, and a claim
that was measured on one should not wait for a lane that is never coming. Its lane column is `—`
and its evidence is a capture under `integration/fixtures`, held to the same bar as the capture a
`proved` row rests on: provenance naming the device, the version *the device itself* gave, the day
and who recorded it, and a row that states that version and that day. It is weaker than `proved`
in one way and one only — nothing re-runs it, so a newer firmware leaves the row standing at the
version it names — and the capture is replayed through the code by the unit suite on every run, so
the code that reads what was seen cannot drift from it. The served copy carries no phrase
behind a witnessed claim; the phrase says "nothing has run this", and something has. A lane that skips is a
lane that has not run, so the claim it would carry stays exactly where this table leaves it; a
lane that ran and failed has proved nothing either, nor has one that got through only part of
what it carries — a `proved` row here is standing evidence that a lane has run and got through,
while each run states its own status in its own vocabulary, in the job summary and in the report
it leaves behind, and a lane that is not reported as having passed leaves its claim here (AD-24).

| Claim | Lane | Status | Evidence |
|---|---|---|---|
| Eos desk acceptance | `vendor` | `proved` | ETCnomad on `win-ci`, green in CI since 2026-09-15 (`INTEGRATION-HARNESS.md` §11 decision 3): the console's own `/eos/get/version` answered `3.3.9.25`, and `integration/fixtures/vendor/eos-ubox-win.json` — Eos `3.3.9.25`, read from the console, recorded 2026-09-15 — is that session (`INTEGRATION-HARNESS.md` §10 M2) |
| The peers' wire format | `peers` | `proved` | an independently written implementation of the vendors' documents, and nothing wider: `harness-*.spec.ts` holds each peer to its own vendor's documents — and, since Story 11.5, the SQ's own control service to the capture the harness holds of an SQ-6 rather than to a document — and the lane replays `integration/fixtures/vendor/eos-ubox-win.json` through `EOS_REPLAY` — Eos `3.3.9.25`, recorded 2026-09-15 — with no console present. Validated only while the vendor lane keeps running: quiet, the peers are unvalidated (`INTEGRATION-HARNESS.md` §2) |
| ASIO hosting | `asio` | `unproven` | the `e2e (windows)` lane's ASIO device smoke step runs on a GitHub-hosted runner, which has no ASIO SDK and no driver, so its report says `unproven` with that reason. It was proved on a maintainer's machine with a real driver before the project moved to hosted runners; a run with a driver installed is what would prove it again. |
| A&H desk acceptance | `hardware` | `unproven` | the `hardware` job, dispatched with `desk_host`/`desk_profile` against a real SQ or Avantis — no peer stands in for a desk there, a peer answers for the wire, never for what a desk does with it. The job has now run: **run `36260514612`, 2026-09-26, `refs/heads/main` @ `5629a2cd`, against the SQ-6 of §6 at 192.168.0.226:51325**, and its own report is 4 passed, 1 skipped, 0 failed — the desk answering its own mute get at the input's page (53 ms), a scene recall moving the mic's own mute with the desk's value saying so (341 ms), the key press at the surface running the show (12.3 s, the press carried by an operator at the desk), and the two mics handed from one fader to the other and back (603 ms), with the console case skipped ("no console named — set MSC_HOST …"). The lane's status for that run is `skipped` rather than `passed`, and AD-24 leaves this row where it is until a run carries every case: what is missing is a console on a cable beside the desk. Earlier, two developer runs against the same SQ-6 (firmware 1.6.1) carried these cases through `integration/deskRelay.ts`, because the desk's MIDI service refuses a second connection from the same host (§6) — 2026-09-21 under the pre-11.2 shape (a scene recall moving its DCA 1) and 2026-09-26 under this one |
| The MIDI Control bridge | `vendor` | `unproven` | the `ah-windows` job, gated on `AH_MIDI_PORT` so an unprovisioned runner reports it skipped; no run has happened, so the bridge is an expectation rather than a measurement (`INTEGRATION-HARNESS.md` §11 decision 4) |
| The MSC end-to-end case | `hardware` | `unproven` | the `hardware` job's console case, on the cable `msc_host` names; no console has transmitted one, and the desk ranges do not transmit MSC at all (`INTEGRATION-HARNESS.md` §11 decision 5). Run `36260514612` (2026-09-26) carried the case and reported it skipped with that reason, which is the row's evidence now rather than the absence of a run |
| The peer's model of a real desk | `hardware` | `unproven` | what the `hardware` job checks against a desk: the SQ/Avantis peer is a model of a desk and the vendor lane's "MIDI bytes are MIDI bytes" stays assumed. Run `36260514612` (2026-09-26) put that model in front of the SQ-6 and its four desk cases passed — the read-back value form at the input's page, the scene-recall handling and the message a real key press sends behaved as the peer models them — and it found one place where the peer is wider: the desk's MIDI service refuses a second connection from the same host, which the peer answers several of by default and `DeskPeerOptions.singleClient` models (`INTEGRATION-HARNESS.md` §6, §10 M3, §11 decision 2). The SQ's native control service — the route a Scenes recall writes membership through — has a model of its own as of Story 11.5: `integration/peers/sqNative.ts`, one protocol per module beside the MIDI peer, so the frame half runs on the peers lane on every pull request (`desk-sq.spec.ts` drives a recall through it, `harness-desk.spec.ts` holds it to the capture with no app). What is still outside every peer is the desk's own answer on that route: the capture holds no frame in which the desk reports a membership and no keepalive datagram, so the model says nothing about either |
| The SQ's native assignment protocol | `hardware` | `unproven` | the desk's own control service on 51326, which an SQ's recall writes its membership over: the write form is measured — an SQ-6 on firmware 1.6.1, recorded 2026-09-22, the capture and the frames held in the harness (`INTEGRATION-HARNESS.md` §6, §10 M3) — and replayed on every pull request by the peers lane's model of that service, `integration/peers/sqNative.ts`, whose four pairs and flags are matched against the capture's own bytes by `desk-sq.spec.ts`. The harness's own relay carries that route now (`integration/deskRelay.ts`, its `native` carriage): `harness-desk-relay.spec.ts` holds the carriage to a native peer on a loopback address of its own — the client's frames at the desk, the desk's frames at every client, the leave port's `BYE.`, the keepalive's width and a record of the last bytes each way — and `desk-relayed.spec.ts` drives the app through the relay with both of the desk's models behind it, so a recall's membership and its mic are asserted on the two models' own records with no desk anywhere. `desk-hardware.spec.ts` starts its relay with the carriage and reads the pair and flag frames the two recalls wrote out of the relay's record, beside the desk's own mute values. The `hardware` job has been dispatched against a real SQ-6 with `desk_host`/`desk_profile` (run `36260514612`, 2026-09-26) — but that run's show dialled the relay's MIDI service alone, so no membership frame left the runner at all — and no dispatch since has carried this route to a desk; the read form is not measured and the desk's own answer is outside every peer, so a recall's base is Cuerunner's own record of what it sent |
| Hosting a real driver on the other backends | — | `unclaimed` | no lane runs `npm run test:native:device`: the ASIO lane hosts a driver on Windows, and WASAPI, Core Audio, ALSA and JACK are exercised through the offline and silent backends, so nothing here says a real driver is hosted on any of them |
| Live discovery | — | `unclaimed` | no lane runs a device that announces itself: the announce path is held by unit suites alone, and no run here has a Dante endpoint (or any other announcing device) on the wire |
| Sennheiser EW-DX receivers | — | `witnessed` | a Dante EM 4 (receiver firmware `4.0.0`, SSC protocol 2.4) read by hand on 2026-10-02 with two bodypacks linked, kept as `integration/fixtures/vendor/ew-dx-em4-2026-10-02.json`: the receiver's own firmware and identity answers, its mDNS reply, and one subscription's snapshot and pushes. `src/main/ewdx/capture.test.ts` replays it through the mapping, the client and discovery on every run, over a real local socket and real TLS. No lane runs a receiver, and no EM 2 has been run at all, so the claim is the EM 4's and stands at firmware `4.0.0` |
| Muting an EW-DX channel | — | `witnessed` | a Dante EM 4 (receiver firmware `4.0.0`, SSC protocol 2.4) written to by hand on 2026-10-02 on a channel with a pack linked and in nobody's show, and put back as it was: `integration/fixtures/vendor/ew-dx-em4-mute-2026-10-02.json` holds ten requests — the body is exactly `{"mute": <boolean>}`, a write answers 200 with no body, the state is read back as `mute`, writing the state a channel is already in is not an error, and a channel the receiver does not have, or a mute that is not a boolean, is a 400 with no body. `src/main/ewdx/muteCapture.test.ts` holds the fake receiver to answering each of them as the real one did, and the client to sending exactly the writes that were captured. No lane runs a receiver, and no EM 2 has been written to |
| Firmware equality | — | `unclaimed` | no lane claims it: every fixture records the version it came from, and nothing here says a later Eos build behaves like the one the vendor lane ran |

## Engine tolerances and benchmarks

- Stated tolerances, carried in the soak report so claims can be checked: start ≤ one 512-frame block at 48 kHz (10.67 ms) + 5 ms slack = **15.67 ms**; clock drift **≤ 0.5%**.
- **Nightly soak:** eight one-hour shards, each a generated show with a different seed against the silent pacer (real mixer and sample clock, no device); a faults job; fan-in to `soak-latest.json`, rendered by `website/reliability.html`. A one-minute soak runs on every PR.
- Soak asserts zero xruns, zero stream underruns, zero dropped chunks, starts within tolerance, clock within bound, no frozen voice, and no leaks past the cache/stream budgets.
- Matrix benchmark: 0.71× → ~11× realtime after the A3 fix; **CI floor 2×**; measured worst supported mix 8.7× realtime, typical 43× — measured on a Ryzen 7 5800X, one core, at the benchmark's 24 voices × 32 outputs × 64 crosspoints, in the A3 campaign `ENGINE-REVIEW-2-AND-ROADMAP.md` records. The README's benchmark table carried these two figures until Story 6.2 removed it; what the project publishes now is the 2× floor, as the gate `matrix-bench` exits non-zero below.
- Build-run evidence (dev machine, ten-minute longest): 0 xruns / 0 underruns / 0 dropped chunks; worst start delay 10.33 ms; drift < 0.005%.

## Release gates

- Signed and notarised installers on both platforms; the build workflow verifies signatures when
  the signing configuration is supplied, and without it it warns and ships unsigned — and says so
  where the artifacts are described: each packaging job records whether its build was signed, and
  the `release` job composes a section into the release notes naming every installer signed,
  signed and notarised, or unsigned, with a venue machine's refusal of an unsigned one. An
  installer is never presented as signed that no run signed.
- Windows signs through Azure Trusted Signing rather than from a certificate held here: the signing
  key stays in Azure, and `scripts/trusted-signing.ts` decides from four resource identifiers
  (repository variables, which name the account and its certificate profile) and three Entra
  credentials (secrets, which authenticate) whether a given run signs, handing electron-builder the
  `azureSignOptions` flags only when all seven are there. The configuration is per run rather than
  declared in `package.json` because electron-builder's Windows signer refuses a build it cannot
  authenticate instead of shipping it unsigned (electron-builder#9623) — a static declaration
  would turn every unsigned build into a failed one. An identity configured halfway is refused,
  and `scripts/release-path.test.ts` holds the recording, the packaging step and the packaged
  config to that decision, while `scripts/trusted-signing.test.ts` holds the decision itself to the
  four states an environment can be in.
- A signed Steinberg ASIO agreement is required before publishing a build linking the SDK, and the
  release path enforces it: with the SDK present and `native/audio/third_party/ASIO-AGREEMENT.md`
  uncommitted — the record of the signed agreement, written when it is signed — the Windows
  installer is withheld from the release page, the notes and the R2 mirror. The mirror also
  removes the `latest/` name the withheld installer's card points at, so the card answers `404`
  until a release carries that file again rather than serving an earlier release's installer under
  this release's name, and the notes' withheld bullet is what explains it. The SDK is supplied
  out-of-band via `CUERUNNER_ASIO_SDK` and is never committed.
- Each release publishes the digests of the bytes it carries, composed from those bytes and never
  typed: the `release` job attaches a `SHA256SUMS` beside the assets its notes list, under the
  names the page carries them by, and the mirror writes its own as it copies and uploads it to
  `latest/SHA256SUMS`, under the names the cards link. A sums file is a way to check a download
  against the release that describes it, not a signature: nothing here signs it, and the download
  surface links `latest/SHA256SUMS` and the release notes rather than stating a state of its own.
- Nothing publishes from a ref that is not a tag: the release job and its R2 mirror test the ref
  and the jobs they need. Packaging from a branch dispatch stays possible — that is how this path
  is exercised without publishing — and publication from one does not exist.
- The packaging run is started by `release.yml` dispatching `build.yml` for the tag it cut, after
  semantic-release cuts it: a release published with the repository's own token creates no
  workflow run, so `build.yml`'s `release: published` trigger is not the path that publishes
  anything, and a release carrying no installers is a dispatch that did not happen.
- `npm run test:native:asio` hosts the machine's installed driver on `win-ci` — the only lane
  that reaches ASIO hosting: its own note states `ASIO hosting: proved` when the driver smoke
  played through a driver, and `ASIO hosting: unproven`, with the machine's state as the reason,
  when it hosted none, which is what a runner with no interface says (conversion and buffer-size
  rules run on Linux as `asio-rules`).
- Release checklist (`.github/RELEASE_CHECKLIST.md`); releases run the tests, then upload to R2 and GitHub Releases; nothing publishes on merge.

## Verification boundaries

- Source-verified only, no fault-injection or device claim: A1.1 double-open, A1.2 driver-request reopen, A2.2's native latched-off branch, A2.4–A2.6 second-driver refusal and mid-session latency restatement.
- A8b.4 remains confidence 0.4 — needs `dumpbin /dependents` plus one clean-Windows launch before acting.
- B1 (first-open consent UI) was declined; a docs sentence only.
- `website/reliability.html` currently publishes nothing — `soak-latest.json` is absent — and says so; a number on that page must always come from a run.
