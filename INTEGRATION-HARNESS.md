# The integration harness

A plan for testing WinsLab against the systems it has to talk to in a real venue —
ETC Eos first, then the Allen & Heath SQ and Avantis desks — without a lighting rig or
a mixer on the bench, and without a human clicking in either app.

Written on `integration-test-harness`, off `main` at `e739956`. Nothing here is built
yet; the milestones are near the end, and what has to be decided before the first one
starts is the section after them.

---

## 1. The question the harness rests on, answered first

The hope was that the vendor's desktop applications are the desk, one to one, so a test
can talk to the software the way it would talk to the hardware. That is **true for ETC
and false for Allen & Heath**, and the difference decides the shape of everything below.

### ETC: ETCnomad *is* Eos

The software ETC ships for Windows and macOS is the console software, and it runs the
full show. Without a Nomad dongle it refuses to output DMX — but show control is not
DMX output, and ETC says so explicitly: OSC output works in ETCnomad **offline** mode
with no dongle, provided the machine has an active network interface
([ETC support: Can I Output OSC in ETCnomad Offline Mode?](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Can_I_Output_OSC_in_ETCnomad_Offline_Mode%3F)).

OSC goes both ways, and both ways are documented:

| Direction | What it is | Addresses |
|---|---|---|
| Into Eos | fire a cue | `/eos/cue/<list>/<cue>/<part>/fire`, `/eos/cue/fire=<cue>`, `/eos/key/<key>` |
| Into Eos | run a command line | `/eos/cmd=<text>` |
| Into Eos | ask for state | `/eos/get/version`, `/eos/get/cue/<list>/<cue>`, `/eos/get/cuelist/<n>/count`, … |
| Into Eos | subscribe to changes | `/eos/subscribe=1`, `/eos/subscribe/param/<p>` |
| Out of Eos | **a cue ran** | `/eos/out/event/cue/<list>/<cue>/<action> = <label>` (`fire`, `stop`, `resume`) |
| Out of Eos | what is on stage | `/eos/out/active/cue/text`, `/eos/out/pending/cue/text`, `/eos/out/previous/cue/text` |
| Out of Eos | answers | `/eos/out/get/...`, `/eos/out/ping`, `/eos/out/get/show/path` |
| Out of Eos | a live cue-list bank | `/eos/out/cuelist/<bank>/<cue index> = …`, configured with `/eos/cuelist/<n>/config/<list>/<prev>/<pending>` |

([OSC Dictionary](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/OSC_Dictionary.htm),
[OSC Show Control](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/Using_OSC_with_Eos/OSC_Show_Control.htm),
[OSC Get](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/Using_OSC_with_Eos/OSC_Third-Party_Integration/OSC_Get.htm).)

Transport is UDP (RX port and TX port, both configurable; ETC suggests 8000/8001 or
4703–4727) or TCP (listener on 3032, framing OSC 1.0 packet-length or OSC 1.1 SLIP —
[Eos OSC Setup](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/Using_OSC_with_Eos/Eos_OSC_Setup.htm)).
Enablement lives in `Setup > System > Show Control > OSC` (`{OSC RX}`, `{OSC TX}`, the
ports, the TX IP address) with `{UDP Strings & OSC}` switched on for the interface in
`ECU > Settings > Network > Interface Protocols`; `{Network List Receive}` is the master
gate for incoming MIDI/UDP/OSC and is on by default
([System > Show Control](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/07_Setup/01_System/System_Show_Control.htm)).

Two consequences worth their own line:

- **`/eos/out/event/cue/…` is the assertion.** A test does not have to believe WinsLab's
  log to know the cue fired; Eos says so, with the cue's label, on a socket.
- **`OSC Cue Send String` lets the desk be taught WinsLab-shaped addresses.** It is a
  format string with `%1` cue number, `%2` cue list, `%3` whole number, `%4` point,
  `%5` label — so an operator can make Eos say `/go/12` instead of
  `/eos/out/event/cue/1/12/fire`. That matters because triggers match OSC addresses
  literally (§3, G3).

Eos also speaks MIDI Show Control in and out (`MSC Receive`, `MSC Transmit`, Rx/Tx
device IDs, a cue-list filter) — the same roadmap item, B4 in
`ENGINE-REVIEW-2-AND-ROADMAP.md`, that WinsLab has not built yet.

### Allen & Heath: the desktop apps are not the desk

There are two A&H applications per range and neither is a mixer:

| App | What it is | Serves 51325? |
|---|---|---|
| SQ-MixPad (Windows/macOS/iOS/Android) | show/scene/strip editor offline; remote-control *client* online | no |
| Avantis Director (Windows/macOS) | offline showfile editor; online control client | no |

The MIDI-over-TCP endpoint is a service of the **mixer**: raw MIDI bytes to the desk's
IP on **port 51325** ([SQ MIDI Protocol](https://support.allen-heath.com/hc/en-gb/articles/47793519540497-SQ-MIDI-Protocol-Firmware-V1-6),
[Avantis MIDI TCP/IP Protocol](https://support.allen-heath.com/hc/en-gb/articles/45146889174801-Avantis-MIDI-TCP-IP-Protocol)).
There is a real report of MIDI-over-TCP against a *machine running Director* fixing a
scene-recall problem — but that rig had a MixRack and a surface; what was being
addressed was Director the client, not a simulated console
([A&H forum, dLive 1.40 … QLab](https://forums.allen-heath.com/t/dlive-1-40-s3000-dm64-10-ipads-dante-qlab-first-day-on-it/5549)).
A&H's own recommended pattern for show control is the one QLab users follow: install
**Allen & Heath MIDI Control**, which puts a virtual MIDI port on the machine and bridges
it to the desk over TCP
([External Control](https://support.allen-heath.com/hc/en-gb/articles/37282561723537-External-Control-integrating-A-H-systems-in-TCP-IP-environments),
[dLive for IT managers](https://www.allen-heath.com/content/uploads/2023/11/AH-dLive-for-IT-managers.pdf)).

So for SQ and Avantis there is no software desk to test against. What there *is* is a
published, MIDI-shaped protocol with tables — parameter numbers, channel maps, a SysEx
header — which is enough to write a faithful peer (§6), and a protocol peer is a better
CI citizen than a licensed desktop app anyway.

### What that means

- **Eos**: the vendor software is the counterpart. Test against the real thing, in CI,
  on the Windows runner.
- **Allen & Heath**: the counterpart is a peer we write from the published protocol, and
  the thing that keeps the peer honest is a hardware lane (a desk, when one is available)
  — not the vendor's desktop apps.

---

## 2. The three lanes, and what each one proves

Nothing is "covered" by one lane; the honesty is in saying which lane claims what.

| Lane | Where | Counterpart | Proves |
|---|---|---|---|
| **peers** | every PR, Linux (`ubox`) | `integration/peers/*` — an Eos OSC peer and an SQ/Avantis MIDI-TCP peer, both written from the vendor documents | WinsLab still emits the bytes and still reacts correctly to the bytes; the fixture contract has not moved |
| **vendor** | nightly + on demand, `ubox-win` (and the Mac mini if it earns a slot) | real ETCnomad, real A&H MIDI Control | the fixtures are still what the real software does; Eos is not just a peer we invented |
| **hardware** | on demand only, wherever a desk is | a real SQ or Avantis on the LAN | the peer is a fair model of the desk, and the vendor lane's assumption (MIDI bytes are MIDI bytes) holds |

Fixtures flow **from** the real thing **to** the fast lane: a `--record` run against real
Eos or a real desk writes captures into `integration/fixtures/`, and the peers replay
them. A capture carries its provenance in the file that holds it — device, firmware,
document issue, date, and which lane recorded it — because a fixture whose origin is
unknown is a fixture nobody can trust or retire.

The Linux PR lane deliberately does **not** claim: that Eos accepts the message, that a
desk does, or that firmware X behaves like firmware Y. Those are the vendor and hardware
lanes' claims, and if they go quiet for long enough the peers should be treated as
unvalidated rather than as evidence.

---

## 3. What WinsLab speaks today

| Path | Implementation | Reachable by a desk today |
|---|---|---|
| OSC out | `OscCue` → `src/main/osc/OscEngine.ts` (node-osc, UDP) | yes — Eos |
| OSC in | `src/main/services/OscInputService.ts`, default 53000 | yes — Eos, and any console |
| MIDI out | `MidiCue` / Scenes → `src/main/midi/MidiEngine.ts` (RtMidi ports) | via A&H MIDI Control only |
| MIDI in | `src/main/services/MidiInputService.ts`, port names polled every 2 s | via a virtual port |
| HTTP out | `NetworkCue` → `src/main/network/NetworkClient.ts` | not a desk protocol |
| Panic | OSC `/winslab/panic`, MIDI CC 120 = 0 | yes |
| Desk/scene messages | `utils/desk.ts` → note on/off, or OSC to `/dca/{n}/on` on port 8000 | partially |

Three gaps stand between that and the harness, in the order they bite:

**G1 — there is no MIDI-over-TCP output.** Both A&H ranges are controlled over TCP 51325.
`MidiEngine` is `getPortCount`/`openPort`/`sendMessage` on OS ports
(`src/main/midi/MidiEngine.ts`), and `midi:send` carries a port *name*; there is no path
to a socket. Today that means a virtual MIDI port plus A&H's MIDI Control application in
the middle, which is Windows/macOS-only and not automatable on the Linux runner. Two ways
out, and they are not exclusive:

- *(a) no product change*: the A&H lane runs on the Windows/macOS runners with MIDI
  Control installed, and the peer sits behind it. This is exactly the route users take
  today, so it is worth having regardless.
- *(b) a `midi-tcp` output in WinsLab*: a destination that is a host and port rather than
  a port name (default 51325), with running-status and SysEx discipline. This is the only
  way the A&H path is covered on the Linux lane, and it removes a vendor application from
  every operator's machine. **This is a product decision, not a harness one** — see §11.

Should (b) be taken, it borrows the shape the OSC kind already has rather than inventing
one: `DeskSettings` (`src/renderer/src/types/show.ts`) already carries `host` and `port`
beside `midiPort`/`midiChannel`, so the new kind reuses them, and `DeskMessage` grows the
matching variant beside its `midi` and `osc` cases — which also means a workspace
migration and its test, the way every other change to that union has had one. The
transport itself is a client socket with byte-stream discipline: messages split across
reads, several to a read, and SysEx reassembled to `F7`. That last part is what §6's
framing cases are for.

**G2 — no MSC.** Eos transmits and receives MIDI Show Control, and the SQ's cue list
answers to MSC `GO`/`LOAD`/`RESET`. WinsLab has neither. The harness can carry MSC
fixtures from day one (the desks' side is already published); the specs land when the
product does. B4 in the roadmap.

**G3 — triggers match OSC addresses literally.** `matchesTrigger` is an exact string
compare, by an explicit decision ("patterns and wildcards belong to the sender", held by
`src/renderer/src/engine/triggers.test.ts`). So `/eos/out/event/cue/1/<n>/fire` cannot be
watched by one trigger. The harness does not need it: the fixture carries one literal
trigger per cue it cares about, and Eos's `OSC Cue Send String` can be set to something
short (`/go/%1`) in the fixture showfile. No product change, and no scope creep into a
matching language.

---

## 4. Layout

```
integration/
  playwright.config.ts        per-suite config; testDir 'specs'; CI workers 1, retries 1
  fixtures/
    eos/                      captured OSC traffic + the showfile, each with provenance
    sq/  avantis/             byte vectors + the profile tables the peer is built from
  peers/
    eos.ts                    OSC peer: --live | --replay <fixture> | --record <out>
    desk.ts                   MIDI-TCP peer: --profile sq|avantis, --port, --control <port>
    control.ts                the peer control channel (HTTP on loopback) — shared
  specs/
    eos.spec.ts               WinsLab ↔ the Eos peer (and, tagged @vendor, real Eos)
    desk-sq.spec.ts           WinsLab ↔ the SQ peer
    desk-avantis.spec.ts      WinsLab ↔ the Avantis peer
    desk-hardware.spec.ts     @hardware only: the same assertions, a real desk
    harness.spec.ts           the peers tested against the documents, with no app
```

Scripts (the existing `scripts/run-e2e.js` already forwards stray arguments to
`playwright test` and gives Linux a private Xvfb, so no new runner wrapper is needed):

```json
"test:integration": "electron-vite build && node scripts/run-e2e.js --config integration/playwright.config.ts",
"peer:eos": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON integration/peers/eos.ts",
"peer:desk": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON integration/peers/desk.ts"
```

Specs import the helpers that already exist, from `../e2e/helpers`:

- `launchApp` / `closeApp` — the app, on a private display, with a license where a Pro
  surface is needed (`launchApp({ license: mintLicense() })`, as every existing spec does).
- `openFromRecent` — a fixture `.wlab` written into a temp directory and opened through
  the app's own recent list, no dialogs.
- `freePort` / `oscPortOfItsOwn` — a port for the peer, and a port of the app's own.
- `encodeOscMessage` / `sendOsc` to speak, and **`listenOsc` / `decodeOscMessage` to
  hear**: `listenOsc` returns `received` *and* `receivedAt`, which is what makes the
  timing assertion in §7 measurable without any new machinery.
- `pointDeskAtOsc` / `buildDeskShow` — the shape a desk-pointing helper has already; the
  TCP case wants the sibling (`pointDeskAtTcp`) rather than a second convention.

The MIDI side has one equivalent to build: a receive-side listener for a virtual port, so
WinsLab's MIDI input can be driven the way `listenOsc` drives its OSC input. On the Linux
runner that port is **`Midi Through Port-0`** — the ALSA sequencer's own loopback pair
(client 14, `RWe-`, in and out on one port), present on a stock kernel with no module and
no privileges; `snd-virmidi` would need a `modprobe` that the runner's sudoers rule does
not allow, which is the reason to use the one that is already there. macOS has IAC and
Windows has loopMIDI for the lanes that need them.

Ports are ephemeral and passed in: a spec starts its peer on port 0, reads the port back
over the control channel, and writes it into the fixture. That keeps a PR lane with two
desk profiles and one Eos peer from fighting over 51325 / 8000 / 53000.

The peers are usable with no app in the loop — `npm run peer:desk -- --profile sq` is a
desk on a socket that any client can point at (QLab over MIDI Control, Bitfocus
Companion, `protokol`, a colleague's script). That is the "as independent as possible"
part: the harness's device side is a tool, not a test fixture, and a piece of it can be
handed to someone integrating for real. `harness.spec.ts` exists so the peers are tested
against the documents rather than only against WinsLab.

---

## 5. The Eos peer

Three modes, one implementation:

- **`--live`** — a small Eos-shaped model: cue lists, cues with labels, a current and
  pending cue. Enough to develop against and to demo the harness without ETC software.
- **`--replay <fixture>`** — the same model, but every outbound message is the one the
  real console sent, in order, with recorded timing. This is what the PR lane runs.
- **`--record <out>`** — sits as the far end, forwards to real Eos, and writes both
  directions with timestamps and provenance. This is how fixtures are made, on the vendor
  lane or on a desk.

What it must model, because the specs lean on it:

1. Cue firing: `/eos/cue/<list>/<cue>/<part>/fire`, `/eos/cue/fire=<cue>`, `/eos/key/go_0`.
2. The event push: `/eos/out/event/cue/<list>/<cue>/<action> = <label>` on every fire,
   stop and resume. This is the primary assertion, and it must have Eos's shape — the
   label argument included — not a convenient one.
3. State queries and their answers: `/eos/get/version`, `/eos/get/cuelist/count`,
   `/eos/get/cue/<list>/count`, `/eos/get/cue/<list>/<cue>`, `/eos/get/show/path`,
   `/eos/ping` → `/eos/out/ping`; and the **empty-target packet** for a cue that does not
   exist, which is how the harness tests a console refusing an instruction.
4. The cue-list bank: `/eos/cuelist/<index>/config/<list>/<prev>/<pending>`, then
   `/eos/out/cuelist/<bank>` and `/eos/out/cuelist/<bank>/<index>` rows.
5. `/eos/subscribe=1` and `/eos/out/notify/...` after a change.
6. The `OSC Cue Send String` format string, so the fixture proving `/go/%1` lands as
   `/go/12` is a test and not a comment.
7. The two transports, eventually: UDP first (simplest to troubleshoot, and what the
   current WinsLab OSC engine speaks), TCP 3032 with both framings when there is a reason
   to care — WinsLab has no OSC-over-TCP client today, so this is another gap, written
   down here so it is a decision rather than a surprise.

`harness.spec.ts` drives this peer with the raw OSC encoder from `e2e/helpers` and asserts
the shapes above against the ETC pages quoted in §1. A peer that drifts from the document
fails its own spec, which is the closest thing to a test of a fixture.

---

## 6. The desk peer

One TCP server, two profiles, and the profiles are the whole point: SQ and Avantis share a
port and a byte-level format and differ in every table above it.

**Framing rules it must obey, and WinsLab must survive:**

- MIDI over a byte stream. One TCP segment is not one message; a message may be split
  across segments, several may arrive together, and SysEx is a length-unknown run
  terminated by `F7`. A section of the reads deliberately re-split on odd boundaries.
- **Running status**, which Avantis uses by default and SQ permits: a status byte is
  omitted when the previous message had the same one. The peer tests it; WinsLab's
  decoder has to be right about it.
- A connect-time burst: SQ units are reported to send traffic the moment a connection is
  accepted, so the client has to drain before it sends and must not treat unsolicited
  bytes as an error. Community-reported rather than in the specification
  ([magichao326/allen-heath-sq-midi-control, PROTOCOL.md](https://github.com/magichao326/allen-heath-sq-midi-control/blob/main/PROTOCOL.md)) —
  hence the fixture, and hence a test.

**SQ profile** (SQ MIDI Protocol Issue 5, firmware V1.5+; SQ+ documents differ, and the
issue number goes in the fixture's provenance):

- Scenes 1–128 `Bn 00 00 Cn <n-1>`; 129–256 bank `01`; 257–300 bank `02`. The desk sends
  the same message when a scene is recalled on its own screen — the desk-originated event
  the specs assert on. In cue-list mode the cue's *position* is addressed instead with
  banks `0A`/`0B`/`0C`, and the cue list also answers MSC `GO`, timed `GO`, `GO + cue`,
  `LOAD` and `RESET` ([Firmware V1.6](https://support.allen-heath.com/hc/en-gb/articles/47793519540497-SQ-MIDI-Protocol-Firmware-V1-6) —
  Issue 5 covers V1.5+ and stops at scenes, so the article is the newer document and the
  fixture records which one it was written from).
- Mutes: NRPN select (`Bn 63 MB`, `Bn 62 LB`, `Bn 06 00`) then `Bn 26 01` on / `Bn 26 00`
  off; increment (`Bn 60 00`) toggles. Level and mute parameter numbers come from the
  reference tables in issue 5.
- Levels: NRPN coarse+fine `Bn 06 VC` / `Bn 26 VF`, in either the 16384-step linear law or
  the 255-step audio law — the desk's `NRPN Fader Law` setting decides, and both are worth
  a case.
- Soft keys: notes from C3 (30) upward, `9N SK 7F` press, `8N SK 00` release.
- MIDI strips live on the MIDI channel one above the mixer's, with their own note/CC map.
- §3.7 "Getting values" — the A&H counterpart of Eos's `/eos/get`. Select the parameter
  (`Bn 63 MB`, `Bn 62 LB`) and finish with `Bn 60 7F` — the increment message carrying
  `7F` instead of `00` — and the desk answers with the parameter's current value. Every
  mute, level, pan/balance and assignment parameter in the document can be read back this
  way, which is what lets a spec assert on what the desk holds rather than on what WinsLab
  believes it sent.

**Avantis profile** (V2.0+, hex throughout):

- Base channel **N** ≤ 12, default range 12–16. Channel type by offset: inputs on `N`
  (`CH` 00–5F), mono/stereo groups on `N+1`, auxes `N+2`, matrices `N+3`, and FX sends,
  returns, mains, DCAs and mute groups on `N+4` (DCAs 36–45, mute groups 46–4D).
- Mute on: `9N CH 7F` then `9N CH 00`; mute off: `9N CH 3F` then `9N CH 00`. Received
  velocity `00` and note-off are ignored — a case each.
- Fader: NRPN parameter `17`, value from the published `LV` table. Main-mix assign: NRPN
  `18`, `≥ 40` on / `< 40` off. DCA and mute-group assign: NRPN `40`.
- Sends: SysEx with header `F0 00 00 1A 50 10 01 00`, then `0N 0D CH SndN SndCH LV F7`.
- Name and colour: get (`… 0N 01 CH F7` → reply `0N 02 CH <ascii> F7`), set (`0N 03`),
  colour get/set (`0N 04`/`0N 05`, `0N 06`). **The replies are the read-back**, and they
  are the cheapest way for the harness to assert what the desk thinks.
- Scenes: bank `00`–`03` then program change; the desk also *transmits* this when a scene
  is recalled from its own screen, which is the cue-shape for a desk-originated event.
- MMC for transport.

**What it asserts, via the control channel:** every message received (decoded, with
timestamp and connection id), the state it derives (scene, mutes, faders, assignments),
and what it has been asked to send back. **What it originates on command:** a scene
recall, a mute change, a fader move, a name/colour reply, a connection drop, a
malformed/truncated message, and a doubled scene recall (which is what the trigger guard
exists for).

---

## 7. Scenarios

Each is named with the assertion that would fail if the behaviour regressed. These are the
first slice, not the ceiling.

**Eos — the round trip in one spec**

1. WinsLab OSC cue `/eos/cue/1/12/fire` → the peer reports cue 12 current, and emits
   `/eos/out/event/cue/1/12/fire`. WinsLab's trigger on that literal address fires the
   next cue. Assert: the peer's cue state, and WinsLab's log naming the trigger's source.
2. Eos, configured with `OSC Cue Send String = /go/%1`, recalls cue 13 → the peer sends
   `/go/13` → the trigger fires. Assert the format string is what produced it.
3. A cue that does not exist: send `/eos/cue/1/999/fire`, peer answers with Eos's
   empty-target packet. Assert WinsLab stays up, logs it, and the next GO still fires.
4. `/eos/get/version` and `/eos/get/show/path` answered, and the answers surfaced where an
   operator would look. Assert the app is reading the console, not guessing.
5. Panic from the desk: peer sends WinsLab's `/winslab/panic` → assert silence
   (`capturedOutputPeak` from `e2e/helpers`, already built for this).
6. The desk goes away mid-show: the peer stops answering and stops emitting. Assert
   WinsLab reports the fault and does not stall the cue stack.
7. A doubled `/eos/out/event/cue/1/12/fire`, milliseconds apart — a console with two
   sends. Assert one firing, one log line, no double GO (the trigger guard, the way
   `e2e/trigger-guard.spec.ts` already holds it).

**SQ and Avantis**

1. Scene recall: a WinsLab scene sends `Bn 00 <bank>` + `Cn <prog>` for bank 1, 2 and 3
   boundaries (scene 1, 128, 129, 300 / 384 — the off-by-one is exactly where a hand-rolled
   encoder is wrong). Assert the bytes, and the peer's scene state.
2. Desk-originated scene: the peer recalls scene 7 on its own → WinsLab's MIDI trigger
   fires the bound cue. Assert the trigger fired and the log names the device.
3. DCAs: a scene opens and closes the DCAs it names, and only those. Assert NRPN parameter
   numbers and values against the profile tables — SQ's and Avantis's differ, which is why
   they are two specs and two profiles.
4. Mute semantics: Avantis velocity `00` and note-off are ignored; `40`–`7F` is on,
   `01`–`3F` off. Assert all three, because that is where a "sensible" implementation is
   wrong.
5. Framing: the peer splits a SysEx across three writes, coalesces four messages into one,
   and uses running status for a three-mute burst. Assert WinsLab decodes identically to
   the unsplit form.
6. Connect-time burst: the peer sends unsolicited bytes on accept. Assert WinsLab drains
   and its first message after that is still correct.
7. Connection loss and reconnect: dead socket at show open, and dropped mid-show. Assert a
   reported fault, no crash, and that the next scene recalls when the desk comes back.
8. Duplicate delivery: the peer sends the same scene recall twice. Assert one scene move.
9. Timing: a scene recall reaches the wire within the post-wait budget the cue claims.
   Assert the measured interval, not just the state.

**The peers, on their own** (`harness.spec.ts`) — every shape asserted in §5 and §6 against
the documented examples, with no application running. This is what lets a peer be handed
to someone else as a tool.

---

## 8. CI

| Where | Job | What runs |
|---|---|---|
| `ci.yml`, `[self-hosted, linux, x64, ubox]` | `integration` | `npm run test:integration` — peers only, no vendor software, no hardware. Failure uploads `test-results/`. |
| new `integration-vendor.yml`, schedule + `workflow_dispatch` | `eos-windows` on `[self-hosted, windows, x64, ubox-win]` | the Eos spec with `--grep @vendor` against the installed ETCnomad; recording mode available as an input |
| the same workflow, optional | `ah-macos` or `ah-windows` | the desk specs through A&H MIDI Control, proving the vendor-bridge route users actually take |
| `workflow_dispatch` only, `desk_host` input | `hardware` | `desk-hardware.spec.ts` against a real desk on the LAN, on whichever runner can reach it |

The nightly workflow follows the shape `soak.yml` already uses — schedule plus
`workflow_dispatch`, artifacts on failure, a report job, and `if: github.ref ==
refs/heads/main` where publishing is involved. Unlike the soak, a red integration night is
not automatically a product bug: it can be ETC shipping a new Eos build. The report says
which firmware and which version were under test, because that is what makes the
difference arguable.

Runtime budget: the peer lane is a handful of Electron launches and some sockets — minutes,
not tens of minutes — and it slots into the existing 20-minute e2e envelope. If it grows
past that, the split is by device, not by file.

---

## 9. The vendor lane, concretely (Eos first)

Provisioned once on the Windows guest, alongside the runner:

1. Install ETCnomad silently — the installer takes `/S`
   ([Deploying Eos Family Software v3](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Deploying_Eos_Family_Software_v3_via_a_Corporate_Network)) —
   pinned by version and hash, from ETC, into the guest image. **Never into the
   repository**: it is ETC's software and it does not belong in a git history.
2. Launch it the way ETC intends: `ETC_LaunchOffline.exe`, or the `.esf3d` show file by
   association. There is no documented headless mode and no documented `--showfile`
   switch, so the fixture showfile opens by association and the spec waits for the OSC
   endpoint to answer `/eos/get/version` before it starts asserting. That wait is also the
   harness's self-test: when it times out, the message names the setup step that is
   missing.
3. Machine-level settings, done once and checked by the spec: `{UDP Strings & OSC}` on the
   interface in the ECU, and the Windows firewall permitting UDP in and out for Eos.
4. Show-level settings, carried in the committed fixture showfile: `{OSC RX}`, `{OSC TX}`,
   RX and TX ports, the TX IP address pointing at the harness, `OSC Cue Send String`, a
   handful of cues, and a cue list. Built once by hand in the offline editor and committed
   as a fixture with its provenance — Eos's Setup travels with its show file, so this is
   configuration by artifact rather than by clicking.

The one thing to verify on the first run rather than assume: whether the OSC settings and
the interface-protocol switch really do travel with the showfile across machines, or
whether the interface setting has to be re-applied per machine. If the latter, it becomes
part of the runner's provisioning script, which is where a machine-level setting belongs
anyway.

For A&H there is nothing to install for the peer lane. The vendor lane's A&H job exists
only to exercise MIDI Control's bridge, so the app-side path users take is tested at least
once somewhere.

---

## 10. Milestones

Each ends in something observable, and each is useful on its own.

**M0 — the harness exists and the Eos round trip is green (Linux lane).**
Peers and specs skeleton, `eos.ts` in `--live` and `--replay`, the Eos fixture with
provenance, `harness.spec.ts`, the `integration` job in `ci.yml`.
*Acceptance*: `npm run test:integration` green on `ubox`; a peer running alone answers an
OSC client by hand; the workspace of scenarios 1, 3 and 7 passes; failure artifacts
uploaded.

**M1 — the desks, in the fast lane.**
`desk.ts` with both profiles, the framing and timing cases, the desk specs.
*Acceptance*: SQ and Avantis scene/DCA/mute cases green on Linux with no vendor software
installed. This is the point at which WinsLab's desk behaviour is covered by CI on every
PR — and the point at which §11's product decision has to have been made one way or the
other, because without a MIDI-over-TCP output the app-side half of these specs cannot run
on Linux.

**M2 — the vendor lane, and fixtures from the real thing.**
`--record` against real Eos; the ETCnomad install and provisioning on `ubox-win`; the
nightly workflow; the self-test that fails loudly with a checklist when the endpoint does
not answer.
*Acceptance*: a scheduled Windows run drives real Eos: WinsLab fires a cue in the console
software, Eos's own `/eos/out/event/cue/...` comes back and fires the next WinsLab cue, and
the run records a fixture that the Linux lane then replays.

**M3 — hardware, and MSC when the product has it.**
`desk-hardware.spec.ts` pointed at a real SQ or Avantis by `desk_host`; fixtures recorded
from the desk and replayed on Linux; MSC fixtures and specs when B4 lands.
*Acceptance*: the same assertions that pass against the peer pass against the desk, with
only the host changing; a recorded desk fixture is committed with its provenance and the
Linux lane replays it.

---

## 11. Risks, and the decisions this needs

**Decisions**

1. **MIDI-over-TCP output in WinsLab (G1).** Recommended: yes. It is the only way the A&H
   path is covered in the Linux lane, and it removes a vendor application from every
   operator's machine — A&H MIDI Control is a Windows/macOS install, and its absence is
   the difference between "WinsLab talks to the desk" and "WinsLab talks to this other
   program which talks to the desk". If the answer is no, the A&H lane still exists but
   lives only on the vendor lane, and the Linux PR lane tests the desk protocol against
   the peer through a virtual port rather than end to end.
2. **A desk to validate against.** The hardware lane is the only thing that keeps a peer
   honest over time, and it needs an SQ or Avantis reachable from a runner for a few
   hours, occasionally. Without one this is planned and untested.
3. **Where the vendor lane runs.** `ubox-win` is the natural home (WinsLab ships Windows
   first, and ETCnomad is its usual platform); the Mac mini is the fallback if the Windows
   guest proves hostile to Eos, and it is currently unmeasured either way.

**Risks**

- **Eos on the Windows guest is unmeasured.** ETCnomad is a GUI application with no
  documented headless switch, and it will be installed on Windows *Server* 2025 with
  Desktop Experience. The first M2 task is to find out, before any of the rest of M2 is
  built. If it will not run there, the lane moves to the Mac mini — which is closer to the
  desk-side reality anyway, since Eos on a Mac is common.
- **Firmware drift.** SQ and SQ+ have separate protocol documents, the Avantis document
  covers V2.0 and later, and Eos is on 3.3.x. Every fixture records the version it came
  from, and a vendor-lane run reports the version it tested, so a failure can be attributed
  to a build instead of to WinsLab.
- **A peer is not a desk.** The Eos peer is a model of a console we wrote from a manual;
  its value is regression detection, not truth. The fixtures are what keep it near the
  truth, and the hardware lane is what the fixtures are checked against.
- **The A&H MIDI Control lane is assumed to bridge to a peer.** MIDI Control is a virtual
  port joined to a TCP endpoint, and nothing in it should care whether the far end is a
  desk or `desk.ts` — but that is an expectation, not a measurement. If it refuses a
  non-desk target, the lane records from a real desk instead and the bridge route is
  covered by hand; the peer lane is unaffected either way.
- **Vendor-software licensing.** Installers are downloaded onto runners and never
  committed; the harness's own code is ours. The fixture showfiles are cue data we wrote.
- **The test that looks like a test.** A spec that asserts WinsLab sent what WinsLab's own
  encoder produced is circular. Every assertion in §7 is written against the peer's view
  of the wire or the desk's own reply, never against the app's report of itself.
