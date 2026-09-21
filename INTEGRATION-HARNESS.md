# The integration harness

A plan for testing Cuerunner against the systems it has to talk to in a real venue —
ETC Eos first, then the Allen & Heath SQ and Avantis desks — without a lighting rig or
a mixer on the bench, and without a human clicking in either app.

Merged as `d8e2137`. The transport of §3 G1 is in the tree with its unit and E2E tests, the
peers and the lanes above are built and green, and M2's acceptance has been met against real
hardware. The milestones at the end say what each lane still needs, and §11 records the
decisions — all of them now taken, in the direction this document recommended: the hardware
lane, the A&H vendor job and the end-to-end MSC case are built and unrun, and each of them
reports skipped rather than passed until its counterpart is there.

Since then, B4's two halves have landed. The desk is told in its own arrangement (§3, below):
`DeskSettings.profile` names the range, and an SQ's mute is the NRPN sequence its document
says rather than the note-on the app had been sending — which is what the desk specs found and
now hold. And show control exists in both directions: a Show Control cue sends MIDI Show
Control, an `msc` trigger answers a console's own command, and `msc.spec.ts` drives the round
trip against the peer's SQ profile. Art-Net and sACN output are still untouched.

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

- **`/eos/out/event/cue/…` is the assertion.** A test does not have to believe Cuerunner's
  log to know the cue fired; Eos says so, with the cue's label, on a socket.
- **`OSC Cue Send String` lets the desk be taught Cuerunner-shaped addresses.** It is a
  format string with `%1` cue number, `%2` cue list, `%3` whole number, `%4` point,
  `%5` label — so an operator can make Eos say `/go/12` instead of
  `/eos/out/event/cue/1/12/fire`. That matters because triggers match OSC addresses
  literally (§3, G3).

Eos also speaks MIDI Show Control in and out (`MSC Receive`, `MSC Transmit`, Rx/Tx
device IDs, a cue-list filter) — B4 in `ENGINE-REVIEW-2-AND-ROADMAP.md`, which Cuerunner now
has: the Show Control cue goes out and an `msc` trigger comes in. Eos's own MSC is not driven
by any lane here, because the Eos peer is an OSC console on a socket and MSC reaches a console
over MIDI.

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
  the thing that keeps the peer honest is the hardware lane — a real desk, on demand, §10
  M3 — not the vendor's desktop apps. What *is* testable about the vendor route is the
  bridge operators actually use: MIDI Control's virtual port, on the vendor lane's A&H job
  (§8, §9). The desktop apps themselves remain nothing to test against.

---

## 2. The three lanes, and what each one proves

Nothing is "covered" by one lane; the honesty is in saying which lane claims what.

| Lane | Where | Counterpart | Proves |
|---|---|---|---|
| **peers** | every PR, Linux (`ubox`) | `integration/peers/*` — an Eos OSC peer and an SQ/Avantis MIDI-TCP peer, both written from the vendor documents | Cuerunner still emits the bytes and still reacts correctly to the bytes; the fixture contract has not moved |
| **vendor** | nightly + on demand, `win-ci` (and the Mac mini if it earns a slot) | real ETCnomad (`eos-windows`), and A&H MIDI Control's virtual port joined to the desk peer (`ah-windows`) | the fixtures are still what the real software does; Eos is not just a peer we invented; and the bridge a desk is really driven through passes bytes both ways |
| **hardware** | on demand only, wherever a desk is (`integration-hardware.yml`, `desk_host`) | a real SQ or Avantis on the network — and, when a console is on a cable, the console itself (`msc_host`) | the peer is a fair model of the desk, the vendor lane's assumption (MIDI bytes are MIDI bytes) holds, and an `msc` trigger fires end to end from a console that transmits one (G2) |

All three are built. What is not true of any of them yet is that they have **run**: the
hardware lane and the A&H job have no run against their counterparts to point at, so what
each one would prove stays unproven, and each reports skipped — with the name of what is
missing — rather than passing on a machine that cannot carry it. §11 holds the decisions and
says, per lane, what remains unproven as a consequence.

Fixtures flow **from** the real thing **to** the fast lane: a `--record` run against real
Eos writes captures into `integration/fixtures/`, and the peers replay them. A capture carries
its provenance in the file that holds it — device, firmware, document issue, date, and which
lane recorded it — because a fixture whose origin is unknown is a fixture nobody can trust or
retire. The desk half has no recorder: nothing has been captured from a desk, so there is no
desk recording for the Linux lane to replay, and §10's M3 says so rather than leaving the
`--record` above to imply one.

The Linux PR lane deliberately does **not** claim: that Eos accepts the message, that a
desk does, or that firmware X behaves like firmware Y. Those are the vendor and hardware
lanes' claims, and if they go quiet for long enough the peers should be treated as
unvalidated rather than as evidence.

This section decides what a lane may claim; which of those claims the lanes carry today, with
each one's status and evidence, is the record's to state — its "Lanes and claims" tables in
`_bmad-output/specs/spec-cuerunner/quality-and-proof.md`, which `scripts/lane-claims.test.ts`
holds to these workflows and to the copy the pages serve. Each run leaves its own lanes'
statuses behind as well: the suite's reporter (`integration/lane-status.reporter.ts`) reports
every lane the run saw — `passed` when everything of that lane the job selected ran and passed,
`skipped` when it did not run — with the counts and the skip annotations' own reasons, in the
job summary and in `test-results/lane-status.json`, and the ASIO step's own note states whether
that machine hosted a driver, so a skipped lane is read as skipped and the claim it would carry
stays exactly where the record left it.

The native lane is the fourth, and it is not an integration with another system at all: the
Windows half of `ci.yml`'s `e2e` job runs `npm run test:native:asio`
(`native/audio/tests/asio-smoke.mjs`), whose counterpart is the machine's own installed driver —
Steinberg's built-in one or an interface's. It carries ASIO hosting and nothing wider: the
conversion and buffer-size rules run on every platform as `asio-rules`, and hosting a real driver
on WASAPI, Core Audio, ALSA or JACK is carried by no lane, because `npm run test:native:device`
runs in no workflow.

---

## 3. What Cuerunner speaks today

| Path | Implementation | Reachable by a desk today |
|---|---|---|
| OSC out | `OscCue` → `src/main/osc/OscEngine.ts` (node-osc, UDP) | yes — Eos |
| OSC in | `src/main/services/OscInputService.ts`, default 53000 | yes — Eos, and any console |
| MIDI out | `MidiCue` / Scenes → `src/main/midi/MidiEngine.ts` (RtMidi ports) | via A&H MIDI Control only |
| MIDI in | `src/main/services/MidiInputService.ts`, port names polled every 2 s | via a virtual port |
| HTTP out | `NetworkCue` → `src/main/network/NetworkClient.ts` | not a desk protocol |
| Panic | OSC `/cuerunner/panic`, MIDI CC 120 = 0 | yes |
| Desk/scene messages | `utils/desk.ts` → a per-desk arrangement (a note pair, or an SQ's NRPN mute) | yes |
| Show control out | `MscCue` → `midi:send` / `midi:sendTcp`, `utils/msc.ts` | yes — an SQ's cue list answers MSC |
| Show control in | `engine/triggers.ts`, `msc` triggers | a console that transmits one (Eos does; the sound desks do not — G2) |
| A desk's own buttons | a spare mute group assigned to a key, or an SQ soft key set to a MIDI note → `utils/deskInput.ts` → GO / BACK | yes — the message a key press makes the desk send |

Three gaps stood between that and the harness, in the order they bit. What became of each:

**G1 — there is no MIDI-over-TCP output.** Both A&H ranges are controlled over TCP 51325.
`MidiEngine` is `getPortCount`/`openPort`/`sendMessage` on OS ports
(`src/main/midi/MidiEngine.ts`), and `midi:send` carries a port *name*; there is no path
to a socket. Without one, a show reaches a desk only through A&H's MIDI Control
application, which is Windows/macOS-only and not automatable on the Linux runner.

**Decided, and built — both routes, the native one first.** A `midi-tcp` desk kind is now
in the app:

- `DeskSettings.kind` gains `midi-tcp` with `tcpPort` beside the host it shares with the
  OSC kind, and `DeskMessage` gains the matching variant; an older workspace is filled in
  by the same `normalizeShowSettings` spread that fills every other new field, and the E2E
  spec opens a file written without the field to prove it.
- `MidiTcpEngine` owns one socket per desk, frame it with `stream.ts`
  (running status, split messages, SysEx to `F7`) and encodes with the same `encode.ts`
  the port-based engine uses — one encoder, one framer, both unit-tested.
- `MidiTcpService` sits on the show runtime, so the desk's *own* messages — a scene
  recalled at the desk, an answer to a get — reach the triggers instead of only leaving.
- `midi:sendTcp` carries a scene's messages from the renderer, and the desk row in Show
  Settings → Channels is where an operator points it at the room.

A&H MIDI Control stays supported, and the vendor lane is where the desk path through it is
exercised, because it is still how anyone with a virtual port is driving their desk today:
`ah-windows` runs that path through MIDI Control's own virtual port, against the harness's
desk peer standing in for the desk (§8, §9). It is the one place the bridge is measured at
all, and until a run happens the bridge is an expectation rather than a measurement — §11
says so, and says what that leaves unproven.

**G2 — no MSC. Built.** The SQ's cue list answers MSC `GO`/`LOAD`/`RESET`, and Eos transmits
and receives it; Cuerunner now does both directions — a Show Control cue out, an `msc` trigger
in — with the codec (`utils/msc.ts`) held to the vendors' worked examples rather than to its own
opinion. `msc.spec.ts` drives the command into the peer's SQ and holds what the desk does with
it.

**What the sound desks do *not* do, and where that leaves the trigger half.** Neither an SQ nor
an Avantis transmits MSC, and neither has a GO key: the SQ's document describes MSC only as
something the cue list *accepts*, and this was written down here as a doubt ("no document here
says an SQ sends a command when its own GO is pressed") before a peer method existed to make it
concrete — the method is gone. So an `msc` trigger is for a console that transmits one, which is
a lighting console on a MIDI path (Eos does; §1), and the *hardware* lane is the only place it
can be driven end to end, because no peer here is a console on a cable. **That case is built**:
`desk-hardware.spec.ts` has the show listen on the MIDI input port the console's cable appears
as (`MSC_HOST`) and waits for the console's own command to fire the cue that answers it. Without
a desk named and a console transmitting it reports skipped, and the end-to-end path stays
unproven — a console's cable is the one counterpart this harness cannot supply.

What a sound desk is heard through instead is its own controls, and how far that reaches:

- **A soft key or footswitch assigned to a MIDI note** transmits on the press — "the SQ does not
  send note on/off messages when a Soft Key is pressed unless the Soft Key is set to a MIDI note
  on/off function", one sequential note per key from C3 (0x30). A plain MIDI trigger listens to
  it, and `msc.spec.ts` holds that path: a key pressed at the desk fires the cue bound to it.
  The same note runs the show's scenes when a show names it for GO or BACK (below), so one key
  can be both a trigger and a button — the operator assigns both knowingly, and no guard is
  added between them.
- **A scene recalled on the desk** transmits its bank and program change, which is the desk-originated
  case the desk specs already drive.
- **A mute group key is the button a show runs from**, and it is read: a console reports a key
  press only when the key does something the console can name — "these consoles do not provide a
  method to detect UDK/Soft button presses without assigning them to console functions" is how
  TheatreMix puts it — so a spare mute group is what the operator assigns to their key. The desk
  transmits the group's mute (the SQ "sends and receives absolute On or Off mute messages") and
  the show reads it in `utils/deskInput.ts`: page 04's groups on an SQ, the mute-group notes on
  an Avantis, and a DCA's own mute is deliberately *not* one of them, or a show would run itself
  when a scene moved the desk. `desk-buttons.spec.ts` drives it end to end.
- **A soft key set to a MIDI note is the button that does not latch** — a press that only means
  "next cue" leaves the desk alone. A show names a note for GO and another for BACK beside its
  groups; the reader takes the note-on as the press, the note-off as the release, and a repeat
  while the key is down as neither. **Offered only on an SQ**: the desk's own traffic there is
  NRPN, so a note cannot be that desk echoing the app back, while an Avantis's mute groups *are*
  notes and its surface keys latch, and on a `note` desk the notes are the app's own DCA mutes —
  a note route on either could read the app's own echo. What an Avantis should do instead is out
  of scope and unguessed. `desk-buttons.spec.ts` drives both routes in one show;
  the desk's own state and its mute page are what the cases assert, never the app's self-report.
  The *hardware* lane's key-press case stays the mute-group one (`desk-hardware.spec.ts`), run
  with a group assigned, so the note route is carried by the peers lane alone and no desk
  acceptance is claimed for it.

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
  peers/
    eos.ts                    the console: an OSC peer over UDP, `--tx-host`/`--tx-port` for
                              where its output goes, `--cue-send-string`, `--control` for a
                              read-only JSON view of what it thinks
    desk.ts                   the desk: MIDI over TCP, `--profile sq|avantis`, `--port`,
                              `--midi-channel`, `--fader-law`, `--control`, `--connect-burst`
  specs/
    harness-eos.spec.ts       the Eos peer held to ETC's own pages, no app running
    harness-desk.spec.ts      the desk peers held to the A&H documents, no app running
    eos.spec.ts               Cuerunner ↔ the Eos peer: fire a cue, answer the console
    eos-vendor.spec.ts        @vendor: the same chain against a real console — or against
                              a recording of one — and it skips itself when neither is named
    desk-sq.spec.ts           Cuerunner ↔ the SQ peer
    desk-avantis.spec.ts      Cuerunner ↔ the Avantis peer
    desk-midi-control.spec.ts @ah: Cuerunner ↔ the SQ/Avantis peer through A&H MIDI Control's
                              virtual port — the bridge route, on the vendor lane
    desk-hardware.spec.ts     @hardware: Cuerunner ↔ a real SQ or Avantis named by `DESK_HOST`,
                              and a console on a cable transmitting MSC (`MSC_HOST`); it skips
                              itself when neither is named
    eosFixture.ts             the console show: three cues, one of which answers
    deskFixture.ts            the one-mic show the desk specs drive
  fixtures/vendor/            recordings from the vendor lane, each carrying its provenance
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
- `openFromRecent` — a fixture `.cuerunner` written into a temp directory and opened through
  the app's own recent list, no dialogs.
- `freePort` / `oscPortOfItsOwn` — a port for the peer, and a port of the app's own.
- `encodeOscMessage` / `sendOsc` to speak, and **`listenOsc` / `decodeOscMessage` to
  hear**: `listenOsc` returns `received` *and* `receivedAt`, which is what makes the
  timing assertion in §7 measurable without any new machinery.
- `pointDeskAtOsc` / `buildDeskShow` — the shape a desk-pointing helper has already; the
  TCP case wants the sibling (`pointDeskAtTcp`) rather than a second convention.

The MIDI side has one equivalent to build: a receive-side listener for a virtual port, so
Cuerunner's MIDI input can be driven the way `listenOsc` drives its OSC input. On the Linux
runner that port is **`Midi Through Port-0`** — the ALSA sequencer's own loopback pair
(client 14, `RWe-`, in and out on one port), present on a stock kernel with no module and
no privileges; `snd-virmidi` would need a `modprobe` that the runner's sudoers rule does
not allow, which is the reason to use the one that is already there. macOS has IAC and
Windows has loopMIDI for the lanes that need them.

Ports are ephemeral and passed in: a spec starts its peer on port 0 and reads the bound
port back from the handle it got (`peer.port`), which is what keeps a PR lane with two desk
profiles and one Eos peer from fighting over 51325, 8000 or 53000. The control endpoint is
for a human at a keyboard, not for the specs.

The peers are usable with no app in the loop — `npm run peer:desk -- --profile sq` is a
desk on a socket that any client can point at (QLab over MIDI Control, Bitfocus
Companion, `protokol`, a colleague's script). That is the "as independent as possible"
part: the harness's device side is a tool, not a test fixture, and a piece of it can be
handed to someone integrating for real. `harness.spec.ts` exists so the peers are tested
against the documents rather than only against Cuerunner.

---

## 5. The Eos peer

Three modes, one implementation:

- **the model** — an Eos-shaped show: cue lists, cues with labels, a current and pending
  cue, answering on the socket.
- **`--upstream HOST:PORT` + `--record FILE`** — a recorder in front of a real console:
  every message is forwarded verbatim, everything the console sends back (to its configured
  OSC TX, which is the recorder) is relayed to `tx`, and the whole session is written down
  byte-exact with provenance. A recording names the console's own version, taken from its
  answer to `/eos/get/version` when it gave one.
- **`--replay FILE`** — a console that answered once, answering again: requests are matched
  by address and the console's replies go out in order, as fast as the consumer reads them.
  An address the recording never answered gets no answer, exactly as it did the first time.

`EOS_RECORD` runs `eos-vendor.spec.ts` through the recorder; `EOS_REPLAY` runs the same
spec against a recording with no console anywhere — which is how a nightly recording ends up
asserted on a Linux pull request.

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
   current Cuerunner OSC engine speaks), TCP 3032 with both framings when there is a reason
   to care — Cuerunner has no OSC-over-TCP client today, so this is another gap, written
   down here so it is a decision rather than a surprise.

`harness.spec.ts` drives this peer with the raw OSC encoder from `e2e/helpers` and asserts
the shapes above against the ETC pages quoted in §1. A peer that drifts from the document
fails its own spec, which is the closest thing to a test of a fixture.

---

## 6. The desk peer

One TCP server, two profiles, and the profiles are the whole point: SQ and Avantis share a
port and a byte-level format and differ in every table above it.

**Framing rules it must obey, and Cuerunner must survive:**

- MIDI over a byte stream. One TCP segment is not one message; a message may be split
  across segments, several may arrive together, and SysEx is a length-unknown run
  terminated by `F7`. A section of the reads deliberately re-split on odd boundaries.
- **Running status**, which Avantis uses by default and SQ permits: a status byte is
  omitted when the previous message had the same one. The peer tests it; Cuerunner's
  decoder has to be right about it.
- A connect-time burst: SQ units are reported to send traffic the moment a connection is
  accepted, so the client has to drain before it sends and must not treat unsolicited
  bytes as an error. Community-reported rather than in the specification
  ([magichao326/allen-heath-sq-midi-control, PROTOCOL.md](https://github.com/magichao326/allen-heath-sq-midi-control/blob/main/PROTOCOL.md)) —
  hence the fixture, and hence a test.

**What the desk does with a second client (measured, not read out of a document).** An SQ's
MIDI-over-TCP service serves one connection at a time. On an SQ-6 running firmware 1.6.1
(2026-09-21) the first connection is served and a second is accepted at the TCP level and reset
at once — before it sends anything, and whether or not it sends anything — so the rule is the
number of connections rather than the traffic on them, and what a losing client sees is a bare
`ECONNRESET`. A console is a single-user surface and a second MIDI client is not a thing it
serves; nothing in the documents says so, which is why the measurement is here. What the
measurement separates is one host's second connection from the first: whether the desk would
serve a client on another machine while this one is connected was not tested, so the rule this
rests on is "a second connection from the same host is refused", and the wording everywhere else
says the same.

Everything a lane needs from the desk at the same time therefore reaches it through
`integration/deskRelay.ts`: the relay holds the desk's single connection, the app's show is
pointed at the relay's address and so is the spec's own wire, bytes from a client go to the desk
as they arrived, and every byte the desk sends goes to every client attached. It answers
nothing of its own, and `specs/harness-desk-relay.spec.ts` holds it to that — including against
a peer told to refuse a second client exactly as the desk does, so the case fails without the
relay. This is the one place the desk peer is knowingly wider than the desk: it answers several
clients by default, because the app lane stands in for the desk's side of a conversation rather
than for its connection rule, and `DeskPeerOptions.singleClient` says which of the two a spec
means.

**The desk's other services (measured on the same run).** The same SQ-6 exposes a second TCP
service on **51326** that accepts several clients at once and answers neither a MIDI get nor a
universal SysEx identity request: it is not a second MIDI endpoint and no lane uses it. Its
being separate is what makes a control application compatible with Cuerunner's desk link:
TheatreMix 3.6, running under Wine, held 51326 while a get on 51325 was answered in 3 ms, so the
one-client rule belongs to the MIDI service rather than to the desk. The desk also answers
discovery: `SQ Find` sent to **UDP 51320** comes back from the desk's own 51320 with its model
name as NUL-terminated ASCII (`SQ-6`), which is how a third-party application finds and names it
with nothing configured. The whole set the observed client sent, from source port 32323 and once
per range, was `SQ Find`, `Qu-567 Find`, `GLD Find`, `Bridge Find`, `TLD Find` — one string per
A&H range, so a range that is not at that address has nothing to answer with. No lane here sends
or reads any of it, so the record's `Live discovery` stays unclaimed.

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
  reference tables in issue 5. Page 04's parameters 0–7 are the eight mute groups, which is
  also what a show's transport buttons are: `setMute(channel, group - 1, on, 0x04)` is the
  message a key assigned to that group makes the desk send.
- MIDI Show Control: the cue list answers a command — `F0 7F <device> 02 <format> <command>
  <cue in ASCII> 00 <cue list> F7` — so a GO moves the peer's own cue list and `state.cue`
  says where it is standing. LOAD and RESET leave the list standing somewhere too, and
  STOP/RESUME are recorded but move nothing, which is all this peer has a reason to model.
  A desk *receives* these: see G2 above for why nothing here has it transmit one.
- Soft keys: notes from C3 (0x30) upward, one per key, `pressSoftKey()` sending the press at
  velocity 7F and the release after it — the desk's own configurable button, and only a key
  assigned to a MIDI note sends anything.
- Levels: NRPN coarse+fine `Bn 06 VC` / `Bn 26 VF`, in either the 16384-step linear law or
  the 255-step audio law — the desk's `NRPN Fader Law` setting decides, and both are worth
  a case.
- Soft keys: notes from C3 (30) upward, `9N SK 7F` press, `8N SK 00` release.
- MIDI strips live on the MIDI channel one above the mixer's, with their own note/CC map.
- §3.7 "Getting values" — the A&H counterpart of Eos's `/eos/get`. Select the parameter
  (`Bn 63 MB`, `Bn 62 LB`) and finish with `Bn 60 7F` — the increment message carrying
  `7F` instead of `00` — and the desk answers with the parameter's current value. Every
  mute, level, pan/balance and assignment parameter in the document can be read back this
  way, which is what lets a spec assert on what the desk holds rather than on what Cuerunner
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

1. Cuerunner OSC cue `/eos/cue/1/12/fire` → the peer reports cue 12 current, and emits
   `/eos/out/event/cue/1/12/fire`. Cuerunner's trigger on that literal address fires the
   next cue. Assert: the peer's cue state, and Cuerunner's log naming the trigger's source.
2. Eos, configured with `OSC Cue Send String = /go/%1`, recalls cue 13 → the peer sends
   `/go/13` → the trigger fires. Assert the format string is what produced it.
3. A cue that does not exist: send `/eos/cue/1/999/fire`, peer answers with Eos's
   empty-target packet. Assert Cuerunner stays up, logs it, and the next GO still fires.
4. `/eos/get/version` and `/eos/get/show/path` answered, and the answers surfaced where an
   operator would look. Assert the app is reading the console, not guessing.
5. Panic from the desk: peer sends Cuerunner's `/cuerunner/panic` → assert silence
   (`capturedOutputPeak` from `e2e/helpers`, already built for this).
6. The desk goes away mid-show: the peer stops answering and stops emitting. Assert
   Cuerunner reports the fault and does not stall the cue stack.
7. A doubled `/eos/out/event/cue/1/12/fire`, milliseconds apart — a console with two
   sends. Assert one firing, one log line, no double GO (the trigger guard, the way
   `e2e/trigger-guard.spec.ts` already holds it).

**SQ and Avantis**

1. Scene recall: a Cuerunner scene sends `Bn 00 <bank>` + `Cn <prog>` for bank 1, 2 and 3
   boundaries (scene 1, 128, 129, 300 / 384 — the off-by-one is exactly where a hand-rolled
   encoder is wrong). Assert the bytes, and the peer's scene state.
2. Desk-originated scene: the peer recalls scene 7 on its own → Cuerunner's MIDI trigger
   fires the bound cue. Assert the trigger fired and the log names the device.
3. DCAs: a scene sends the arrangement the profile names for each DCA, and only those, over
   the desk's socket. What is asserted is the wire and the desk's own mute state — because
   **the desks and the app disagreed about the close half, and that disagreement was the
   harness doing its job**: Cuerunner used to close a DCA with a note-off (velocity 0), which an
   Avantis ignores outright (its OFF is a note-on at `01`–`3F`) and which an SQ does not read
   as a mute at all (its DCAs are NRPN parameters on page 02). The fix is the desk profile
   this document called B4's "console control profiles": the show names its desk and the
   arrangement follows, so the open *and* the close are asserted end to end, on the desk's own
   state rather than on the bytes being sent.
4. Mute semantics: Avantis velocity `00` and note-off are ignored; `40`–`7F` is on,
   `01`–`3F` off. Assert all three, because that is where a "sensible" implementation is
   wrong.
5. Framing: the peer splits a SysEx across three writes, coalesces four messages into one,
   and uses running status for a three-mute burst. Assert Cuerunner decodes identically to
   the unsplit form.
6. Connect-time burst: the peer sends unsolicited bytes on accept. Assert Cuerunner drains
   and its first message after that is still correct.
7. Connection loss and reconnect: dead socket at show open, and dropped mid-show. Assert a
   reported fault, no crash, and that the next scene recalls when the desk comes back.
8. Duplicate delivery: the peer sends the same scene recall twice. Assert one scene move.
9. Timing: a scene recall reaches the wire within the post-wait budget the cue claims.
   Assert the measured interval, not just the state.

**The desk's own buttons** (`desk-buttons.spec.ts`)

1. The desk's own report does not move the show. The peer connects with the GO group already
   muted, so its burst is the state a room could have been left in; the app has to prime on it
   rather than recall a scene the moment the show opens.
2. A mute group the show assigned as its GO key recalls the *next scene* and the desk moves with
   it — the assertion is both the recall's own log line and the peer's mute state, which is the
   app's DCA message arriving at the desk.
3. The next GO moves on, and BACK recalls the scene before. The BACK group is the one the desk's
   report never mentioned, so that press is also what proves the app's own get was answered: a
   group nothing has primed would swallow its first press.
4. A **DCA mute is not a button**: page 02 — the message the app sends itself — moved nothing,
   which is the case that keeps a show from running itself when a recall comes back off the desk.
5. A group nobody assigned does nothing.
6. The same state arriving twice steps once: the desk's own toggle is what tells one press from
   two, so the window the triggers use is not needed here.
7. A soft key on the show's **BACK note** stands the show back: the press is sent as its own
   `90 <note> 7F`, the release as its own `80 <note> 00`, and the step is counted once — with no
   mute-group message written to the desk, because nothing is latched and nothing has to be.
8. A soft key on the **GO note** moves the show on, sent as the whole tap the peer's own
   `pressSoftKey` makes.
9. A note **held down** repeats its note-on, and the repeat is not a second press: the show
   moves one scene, where a second press would have nowhere to go and would say so.
10. A note **nobody assigned** is silent, like a group nobody assigned.

**Show control, and a key assigned to a MIDI note** (`msc.spec.ts`)

1. A Show Control cue sends the command down the desk's own socket. The peer reads
   `F0 7F 7F 02 7F 01 31 32 00 F7` as Go cue 12 — its own list is standing there afterwards —
   and the assertion is on both the decoded command and the desk's cue.
2. A soft key the operator assigned to a MIDI note fires the cue that answers to it. The peer
   presses key 3, which is note 0x32, and the log names the message and the socket. This is the
   case that says a show can be driven from the desk without the desk having a GO key.
3. The same key twice inside the show's window fires once: the guard covers a desk button the
   way it covers a datagram, and the case waits past the window so the count is the guard's
   answer rather than the timing's.
4. A key the show does not listen to fires nothing — the trigger is one note, not "any traffic
   from the desk".
5. A mute key is *not* here, and cannot be: its message is the NRPN sequence the desk's own
   mutes are, and no trigger kind reads one. G2 says what building that would take.

**The peers, on their own** (`harness-eos.spec.ts`, `harness-desk.spec.ts`) — every shape
asserted in §5 and §6 against the documented examples, with no application running. This is
what lets a peer be handed to someone else as a tool.

**The hardware lane** (`desk-hardware.spec.ts`, `@hardware`) — pointed at a real SQ or Avantis
by `DESK_HOST`/`DESK_PROFILE`, and at a console's cable by `MSC_HOST`:

1. The desk answers for itself. The spec asks on a socket of its own the get its document
   describes — an SQ's value for DCA 1, an Avantis's name reply — and the shape of the answer
   is what the desk said rather than what the app believes it sent. The failure message is the
   desk's own settings checklist, because a desk that does not answer is a desk setting.
2. A scene recall moves the desk, and the desk's own value says so: the open and the close,
   each read back with a fresh get, on an SQ (an Avantis publishes no mute read-back, and the
   case reports itself skipped there).
3. A key pressed at the desk runs the show, and the desk moves with it. The operator assigns a
   spare mute group to the key and presses it; the show's walk lands on the scene, and the
   desk's own value changes with it. It needs a hand, and its failure message is the
   instruction.
4. A console transmitting show control fires the cue that answers it. The show listens on the
   MIDI input port the cable appears as and waits for the console's own command, which the run
   names field by field (device ID, format, command, cue) because a show control trigger
   compares each of them exactly. It needs a hand on the console's GO, and it is the one case
   here with no wire view to read: the app's log line naming the command and the port it came
   from is the only report there is.

**The A&H lane, through the bridge** (`desk-midi-control.spec.ts`, `@ah`) — the desk
conversation over MIDI Control's virtual port instead of the desk's socket, with the peer
listening where the bridge dials:

1. A scene recall reaches the desk as the bytes it takes: the peer's own view of the wire says
   the profile's message arrived, and the peer's state says the DCA moved. Nothing arriving
   fails with the bridge checklist — MIDI Control running, the port named, the address it
   bridges to.
2. The close is the same message with the other value, and the desk comes back down.
3. The desk's own scene recall comes back through the bridge and fires the cue, which is the
   half that says the bridge carries both directions.

---

## 8. CI

| Where | Job | What runs |
|---|---|---|
| `ci.yml`, `[self-hosted, linux, x64, ubox]` | `integration` | `npm run test:integration` — peers only, no vendor software, no hardware. Failure uploads `test-results/`. |
| `integration-vendor.yml`, schedule + `workflow_dispatch` | `eos-windows` on `[self-hosted, windows, x64, win-ci]` | the Eos spec with `--grep @vendor` against the installed ETCnomad; recording mode available as an input |
| the same workflow, same triggers, gated on `vars.AH_MIDI_PORT` | `ah-windows` on `[self-hosted, windows, x64, win-ci]` | the desk specs with `--grep @ah` through A&H MIDI Control's virtual port, against the harness's desk peer at the address the bridge dials — the vendor-bridge route users actually take. MIDI Control is provisioned by hand, so a runner that has not been provisioned **reports this job skipped** rather than failing the nightly; a run that has the variable does get the refusal below if the machine cannot produce the port |
| `integration-hardware.yml`, `workflow_dispatch` only — `desk_host`, `desk_profile`, `desk_channel`, `msc_host` | `hardware` on `[self-hosted, linux, x64, ubox]` — the label is the runner that can reach the desk, and it is the one thing a desk somewhere else changes | `desk-hardware.spec.ts` with `--grep @hardware` against a real desk, and the console's own show control when a cable is named. Steps fail the run, with the address or the port and what to check, when the named desk does not answer or the named cable is not one of this machine's MIDI inputs |

The hardware lane is dispatched rather than scheduled, because a desk is not on a runner and
nothing here pretends one is: a run names the desk it is about, and two of its cases need a hand
at the desk while it goes. Where the other lanes report their own skips in the test output, this
one also fails early — the guard step above — so a run against a desk nobody can reach says so
in a step rather than in a spec twenty minutes later.

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

Measured on the way in, so the next person does not have to find it out again:

- **The installer is a direct download with no login.** v3.3.9's "Consoles and ETCnomad PC"
  asset is `ETC_EosFamily_v3.3.9.25.exe` — 887 MB out of an 833 MB zip — behind ETC's
  [All Eos Family Software Versions](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/All_Eos_Family_Software_Versions)
  article. It is fetched onto the runner and **never into the repository**: it is ETC's
  software, and it does not belong in a git history.
- **`/S` is the silent switch** — ETC's
  [corporate deployment note](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Deploying_Eos_Family_Software_v3_via_a_Corporate_Network)
  uses it and nothing else, and it names the install path the check should look at:
  `%PROGRAMFILES%\ETC\EosFamily\v3\Eos\Eos.exe` (not `…\Electronic Theatre Controls\…`,
  which is what a guess looks like).
- **It has to run in the interactive session.** Started over SSH — Session 0 — the
  installer sits on a dialog nobody can see and never finishes. Started in the logged-in
  session (a scheduled task with `/IT`, the same trick the runner itself uses) it completes
  unattended. That is now true of the Windows host, `win-ci`: **Eos is installed there.**
- **The machine running it is not a small one any more.** It was first installed on the
  KVM guest — Server 2025 Standard Evaluation at 1024×768 with software D3D, outside ETC's
  supported list (they name Windows 7/8/10/11) and below Eos's stated minimums of 1920×1080,
  DirectX 11, 2 GB RAM. It runs on the NUC now: Windows 10 Pro 22H2, a real GPU, inside
  both. The guest stays as the fallback, and the caveat that used to sit here is about it
  alone.
- **OSC cannot be switched on from outside the GUI.** ETC's own guidance is explicit that
  the interface protocol (`Setup > Device Settings > Network > Interface Protocols > UDP
  Strings and OSC UDP`) and the OSC settings (`Setup > Show Control > OSC`) are console
  settings, and there is no settings file to seed: `C:\ProgramData\ETC\EosFamily\v3\` holds
  only the manual, the docs and the fixture data. So the last step of provisioning is a
  person — or a viewer on the guest's VNC — doing those two screens once.

The provisioning, then:

1. Install ETCnomad: fetch the asset, extract it, and run
   `ETC_EosFamily_v3.3.9.25.exe /S` **in the interactive session**.
2. Open it once and set, by hand: `{UDP Strings & OSC}` for the interface, and `{OSC RX}`,
   `{OSC TX}`, the RX port, and the TX destination pointed at this machine.
3. Leave a show open with a cue in cue list 1. Setup travels with Eos's show file, which is
   what makes *this* half configuration by artifact once it has been done once — but the
   first time it is a person sitting at the desk.

The self-test is the spec's first test: fire the show's "are you there" cue and wait for
`/eos/out/get/version` to come back. When it does not, the failure message *is* the
checklist above — console settings cannot be set from a test, so the message has to be the
walkthrough, and whoever reads it is standing in front of the desk.

The workflow refuses to pretend: a run on a runner without the software fails in the step
that checks for it (`C:\Program Files\ETC\EosFamily\v3\Eos\Eos.exe`), not in a spec twenty
minutes later.

### A&H MIDI Control, and the bridge it carries

For the peer lane there is nothing to install. The vendor lane's A&H job exists for one
reason: the bridge is the route an operator actually drives a desk through — MIDI Control
puts a virtual port on this machine and joins it to the desk's own TCP endpoint — and it is
worth measuring once (§2, §11). The peer stands in for the desk, so what the job measures
is the bridge rather than a desk: this machine's bytes going out through the virtual port and a
desk's answers coming back in.

MIDI Control is installed and started **by hand** on `win-ci`, for the same reason ETCnomad is:
it is a desktop application, and the port it creates is named by the machine rather than by
anything a workflow can set. What a run must have is that name — repository variable
`AH_MIDI_PORT` — and the address the bridge dials, `AH_DESK_TARGET` (`127.0.0.1:51325` by
default, where the job's own peer listens in the desk's place):

1. Install A&H MIDI Control on the runner and start it; it creates the virtual port while it
   runs.
2. Bridge that port to `127.0.0.1:51325` — the peer stands in for a desk.
3. Read the port's name off this machine's MIDI port list and set `AH_MIDI_PORT`; set
   `AH_DESK_TARGET` too if the bridge was pointed somewhere else.

The job is gated on that variable, so a runner nobody has provisioned reports it **skipped** —
which is what any lane without its counterpart does (§2) — and the nightly does not go red over
a machine that has not been set up yet. A run that does have the variable refuses to pretend:
the port has to be in *both* of the machine's MIDI lists, because the app sends to it and
listens on it, and the step that checks says which list is missing it, what it read instead and
what to do about it. **No run has happened yet**: the bridge is an expectation, not a
measurement, and §11 records what that leaves unproven.

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
installed. This is the point at which Cuerunner's desk behaviour is covered by CI on every
PR — and the point at which §11's product decision has to have been made one way or the
other, because without a MIDI-over-TCP output the app-side half of these specs cannot run
on Linux.

**M2 — the vendor lane, and fixtures from the real thing.**
Landed: the vendor spec (`eos-vendor.spec.ts`, tagged `@vendor`, skips itself without a
console), the nightly and on-demand workflow, the recorder and the replay in the peer, and
the mechanism proven in both directions *without* a console — a session recorded through the
recorder against a stand-in, then replayed with no console anywhere.

**Driven against real hardware** (ETC Eos v3.3.9.25, on `ubox-win`): the lane passes — the
app fires `/eos/cue/1/12/fire`, the console runs the cue, its own
`/eos/out/event/cue/1/12/fire` comes back, and the cue that answers it fires. The console's
`/eos/get/version` self-test answers `3.3.9.25` with fixture library `3.3.9.2`, which is the
documented shape, so the peer's model of that packet was right about the real thing.

On 2026-09-15 the same lane ran green **in CI** for the first time — on the NUC that replaced
the guest, after two fixes the run itself turned up: the machine needed PowerShell 7 (the
job's steps declare `shell: pwsh`, and the guest never had it, which is why no run had ever
reached a test), and the job needed its own tooling right — the tag quoted so pwsh stops
reading `@vendor` as a splat, and the MSVC environment imported before the native engine is
built.

The hardware also corrected the recorder, which is what the ladder is for: Eos sends *to* its
configured OSC UDP TX destination but *from an ephemeral port*, and the recorder had assumed
the console's answers would arrive from the console's own address — so it read them as client
traffic and forwarded them upstream instead of relaying them to `tx`. Direction is now read
from the address space ETC documents (`/eos/out/…` is the console speaking, everything else is
a client instructing it) rather than from where a datagram came from.

*Remaining*: nothing. A session from the console is committed — `integration/fixtures/vendor/
eos-ubox-win.json`, 2.8 KB, its provenance naming Eos `3.3.9.25` read from the console's own
`/eos/get/version` — and the Linux lane replays it with no console anywhere. The workflow is on
`main` since the merge, so `workflow_dispatch` can see it and the nightly schedule is live.
*Acceptance*: met — Cuerunner fired a cue in the console software, the console's own
`/eos/out/event/cue/1/12/fire` came back, the cue that answers it fired, and the recorded
session replays on Linux.

**M3 — hardware, and MSC when the product has it.**
**Built.** `desk-hardware.spec.ts`, tagged `@hardware`, pointed at a real SQ or Avantis by
`DESK_HOST` and `DESK_PROFILE`, on demand through `integration-hardware.yml` (§8). The show it
opens is the desk show with the counterpart's address changed, plus — because two of its cases
need them — the desk's own keys and, where a run names one, a console's cable; nothing else
about it changes. What the cases assert is the desk's own reply, read on the spec's own socket:
an SQ answers a get with the parameter's value in the NRPN form that sets it, an Avantis answers
a name get in its own header. Two cases need a hand at the desk while the run goes — a key
pressed on the surface, and the console's GO below — and their failure message is the
instruction; those two read the app's log line, which names the desk or the console it came
from, because a hand is the one thing no wire view can see. Against an SQ the key case also
reads the desk's own value moving, which is the app's message for the recalled scene arriving.
**MSC landed** with B4: `msc.spec.ts` drives a Show Control cue into the peer's SQ and fires a
cue from a soft key the operator assigned. What the *desk* does not do is transmit MSC — G2 —
so an `msc` trigger's end-to-end home is a console on a cable, which is the hardware lane: the
show listens on the MIDI input port the cable appears as (`MSC_HOST`) and the case is unproven
without a console transmitting.
**The desk's own buttons are read two ways**, so a show can be run from the surface whether the
key should latch or not: `desk-buttons.spec.ts` holds the desk's report at connect, GO and BACK
walking the scenes, the DCA mute that must not be read as a press, the duplicate delivery that is
one step, and — in the same show — two soft keys whose notes step it, with the release silent, a
held key not repeating and an unassigned note ignored. The mute-group route is the one the desk
assigns a key to; the note route is for a press that only ever means "next cue", and it is
offered only where the app's own traffic cannot be a note. What no lane here has is a desk to
press the key on — the hardware lane is where the message a key really sends is checked, and it
is checked by a hand: the operator assigns the show's GO group to a key and presses it. That case
stays the group one, so the note route is carried by the peer's model of the desk and nothing
wider.
*Acceptance*: met when a run happens. **A developer run against an SQ-6 (firmware 1.6.1) on
2026-09-21 passed all three cases a desk can carry** — the desk's own read-back, the scene recall
moving its DCA 1 (read back off the desk, through the relay), and a key press at the surface
running the show — and the console case reported skipped for want of a console. What has *not*
happened is the **job**: `integration-hardware.yml` has never been dispatched, so the lane has no
report of its own, and a report is what the record's rows are evidence of. The desk has to be
reachable from the runner for that, which is a cable rather than a change.
*Stays open*: **the recorded desk fixture.** Nothing has been captured from a desk, so there is
no desk recording for the Linux lane to replay — the desk peer has no recorder and no session has
been taken from one. That half of the milestone is where it was, and this is the line that says so
rather than leaving it to look done. Until a desk run happens, the peer's model of the desk, the
vendor lane's "MIDI bytes are MIDI bytes" assumption and the message a real key press sends stay
unproven (§11).

---

## 11. Risks, and the decisions this needs

**Decisions**

1. **MIDI-over-TCP output in Cuerunner (G1). — taken: yes.** It is in the tree (§3): the
   desk kind, the engine, the service, the bridge, the row, and the specs that hold them.
   The alternative — the A&H lane living only behind MIDI Control on the Windows and macOS
   runners — was not taken because it would have left the desk path untested on the lane
   that runs on every pull request, and because it leaves a vendor application in the way of
   every operator with a network cable.
2. **A desk to validate against. — taken: yes, on demand.** `desk-hardware.spec.ts` and
   `integration-hardware.yml` are in the tree (§8, §10 M3): a dispatch-only run that names the
   desk it is about (`desk_host`, `desk_profile`) and, when a console is on a cable, the MIDI
   input port its cable appears as (`msc_host`). It is the only thing that keeps a peer honest
   over time, and it needs an SQ or Avantis reachable from a runner for a few hours,
   occasionally — so nothing schedules against hardware nobody has, and a run is dispatched with
   somebody in front of the desk, because two of its cases need a hand: a key pressed on the
   surface and a console's GO. Its first case is a self-test whose failure message is the desk's
   own settings checklist, and its desk cases assert the desk's own replies, never the app's
   account of what it sent. The two hand-driven cases are the exception, and say so: a press and
   a console's GO arrive from outside, so what they assert is the app's log line — which names
   the desk or the console it came from — and, on an SQ, the desk's own value moving with it.
   **A run has now happened, and the job has not.** A developer run against an SQ-6 (firmware
   1.6.1) on 2026-09-21 passed the desk's own read-back, a scene recall moving its DCA 1 as the
   desk's own value reports it, and a key press at the surface running the show — so the message a
   real key press sends is measured rather than assumed, and the peer's read-back and scene shapes
   are held against a desk instead of only against its documents. Still unproven: the **job**
   (`integration-hardware.yml` has never been dispatched, so the lane has no report of its own),
   the vendor lane's "MIDI bytes are MIDI bytes" assumption, which belongs to the bridge, and the
   console case, which has no console. The lane reports skipped, never passed, without a desk
   named, and each claim's row moves only on the report that names it.
   **The desk is reached through a relay, and the checklist said otherwise until it was
   measured** (§6): an SQ's MIDI service refuses a second connection, resetting it the moment it
   is accepted, so a run that pointed both the app and this spec's own wire at the desk's address
   could not have passed whatever the desk was set to — the app's connection was the one being
   reset, and its scene recalls never reached the desk at all. `integration/deskRelay.ts` holds
   the desk's single connection and both clients connect there; its own spec
   (`specs/harness-desk-relay.spec.ts`, in the peers lane, so it runs on every pull request) holds
   it to being a relay rather than a desk. What the lane asserts is still the desk's own bytes —
   relayed verbatim, one hop that belongs to the harness rather than to the desk.
3. **Where the vendor lane runs. — answered: `win-ci`, with a fallback.** ETCnomad is
   installed there (§9), and the machine is Windows with a logged-in session, which is what
   a GUI application needs. The caveats that came with the guest — Server 2025 outside
   ETC's supported list, display and 3D below Eos's stated minimums — are the guest's, and
   the NUC is inside both. It has been green in CI since 2026-09-15; if it will not come
   up, the guest is the fallback, and the Mac mini is the machine after that.
4. **The A&H job. — taken: yes, as a sibling of `eos-windows`.** `ah-windows` runs the desk
   specs through A&H MIDI Control's virtual port, with the harness's desk peer where the bridge
   dials (§8, §9), because that bridge is the route an operator actually drives a desk through
   and no A&H desktop application is a desk (§1). MIDI Control is installed and started by hand
   on `win-ci`, and the job is gated on the variable that names the port — so a runner nobody
   has provisioned reports it skipped rather than failing the nightly, and a run that has the
   variable refuses to run without the port in both of the machine's MIDI lists. **No run has
   happened yet**: the bridge is an expectation
   rather than a measurement, and what that leaves unproven is that MIDI Control hands an
   application's bytes to a socket and a desk's answers back — mid-way traffic, and nothing about
   the desk itself. Desk acceptance for SQ and Avantis stays with the hardware lane; the peer
   lane still claims only the wire format.
5. **The end-to-end MSC lane. — taken: yes, riding the hardware lane.** §3 G2 makes a console
   on a cable its only home, so the case is in `desk-hardware.spec.ts`: the show listens on the
   MIDI input port the console's cable appears as (`msc_host`) and waits for the console's own
   command to fire the cue that answers it. A console's message arrives on a cable this machine
   owns, so there is no wire view to read it from and the app's log line — which names the
   command and the device it came from — is the only report there is; the case says so rather
   than borrowing a peer's evidence. Without a desk named and a console transmitting it reports
   skipped, and an `msc` trigger's end-to-end path stays unproven — no peer here is a console on
   a cable, and the desk ranges do not transmit MSC at all.

**Risks**

- **Eos on the Windows host — answered.** It installs (`/S`, from the interactive session)
  and it runs: the lane drove ETCnomad v3.3.9.25 on the guest, and since 2026-09-15 the same
  two vendor tests pass in CI, on the NUC. What used to be the caveat applied to the guest —
  Server 2025 outside ETC's supported list, display and 3D below Eos's minimums — and that
  guest is still the fallback if the NUC stops.
- **Firmware drift.** SQ and SQ+ have separate protocol documents, the Avantis document
  covers V2.0 and later, and Eos is on 3.3.x. Every fixture records the version it came
  from, and a vendor-lane run reports the version it tested, so a failure can be attributed
  to a build instead of to Cuerunner.
- **A peer is not a desk.** The Eos peer is a model of a console we wrote from a manual;
  its value is regression detection, not truth. The fixtures are what keep it near the
  truth, and the hardware lane is what the fixtures are checked against — built and **not yet
  run**, so nothing here says the model is right until a desk run happens (§10 M3, §11 decision
  2).
- **The A&H MIDI Control lane is assumed to bridge to a peer. — answered by the job, not yet
  measured.** MIDI Control is a virtual port joined to a TCP endpoint, and nothing in it should
  care whether the far end is a desk or `desk.ts` — but that is an expectation, and `ah-windows`
  (`--grep @ah`, against the peer listening where the bridge dials) is the measurement. Until a
  run happens the bridge stays an expectation, and if it refuses a non-desk target the lane
  records that, a real desk is what the hardware lane is for, and the peer lane is unaffected
  either way.
- **Vendor-software licensing.** Installers are downloaded onto runners and never
  committed; the harness's own code is ours. The fixture showfiles are cue data we wrote.
- **The test that looks like a test.** A spec that asserts Cuerunner sent what Cuerunner's own
  encoder produced is circular. Every assertion in §7 is written against the peer's view
  of the wire or the desk's own reply, never against the app's report of itself.
