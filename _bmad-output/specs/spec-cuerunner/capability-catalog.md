# Capability catalog

The operator-facing contract behind SPEC.md's CAP-1 … CAP-9. Read with `SPEC.md` and `../../planning-artifacts/architecture/architecture-cuerunner-2026-09-17/ARCHITECTURE-SPINE.md`, which holds the invariants these surfaces must satisfy — where this catalogue says what exists, the spine says what must stay true about it.

## Cue model

Twenty-one cue types (`CUE_TYPES`, `src/shared/cue.ts`).

| Type | What it does |
| --- | --- |
| audio | Plays WAV/AIFF/FLAC/MP3/M4A/Ogg; other sample rates resampled live (pitch unchanged); Trim silence below −60 dBFS without rewriting the region; Rate 0.25×–4×; Fade in, and a Fade out the engine lands on the end of the region or last loop; Loop (vamp) released by a devamp cue; Routing Automatic/Matrix/Silent. |
| midi | Sends MIDI messages to a chosen port. |
| osc | Sends one or more OSC messages over UDP, in order, each to one of the show's named OSC patches or to a host and port of its own; a message whose patch was deleted is not sent and the run says so. |
| wait | Holds for a duration. |
| fade | Fades the level of every cue it names over time — a sound's volume and pan in the audio engine, a light's intensity in the lighting engine, a picture's opacity on its output (a video's sound by volume and pan), every cue inside a group it names — and can stop them when done. A show saved with one target reads it as a list of one and keeps that spelling until the targets are edited. |
| stop | Stops everything, or any set of cues it names — groups whole, groups first — at once or with a fade-out. A show saved with one target reads it as a list of one and keeps that spelling until the targets are edited. |
| group | Runs children as Sequence / All at once / Random / Timeline / Playlist; the last fires one child per GO. Duration is derived. |
| network | HTTP request from the main process (no CORS); holds until the server answers or the 5000 ms timeout. |
| script | JavaScript on its own worker thread; timeout default 60000 ms (0 = forever); `include()` and `shell()` (default 10000 ms, workspace folder); not sandboxed; 200-line log cap per run. It reads its includes through `script:readFile`. |
| scene | Recalls a scene: writes that scene's DCA membership to the desk, then the mic's mute, addressing nothing outside the controlled set — a channel the scene places is open, one it does not place is closed, and a mic that changes fader keeps playing and takes the new fader's position. With no scene chosen it refuses and says so rather than sending an empty set, which the desk would read as *close everything*. |
| devamp | Releases the engine's loop; with no target it refuses with an error rather than guessing. |
| msc | Sends MIDI Show Control. |
| light | Fades the lighting rig to a look over sACN or Art-Net: each level is a fixture's or a group's parameter, 0–1, resolved against the show's patch, over the cue's duration on its curve. What it does not name tracks — stays where earlier cues left it — and a later cue that sets the same parameter takes it (latest takes precedence); intensity may instead combine highest takes precedence. Effects (sine, triangle, square, saw; a group's spread makes a chase) keep moving after the fade. Stopping it freezes its fade and leaves the light on; a Stop cue with a fade-out releases it home; a Fade cue moves its intensity to a share of what it set. |
| mic | Mutes or unmutes one Sennheiser EW-DX radio mic at its receiver — mute and unmute, never a toggle, because a toggle run twice leaves the mic as the first run found it. The receiver is asked afterwards and a mute that did not happen is an error on the cue, never a mic left open in silence. With no mic chosen it does nothing and says so. |
| memo | A note in the stack: its name and notes, the first line of the note on the row. GO completes it at once, so a chain runs through it and it never holds the show. |
| midiFile | Plays a Standard MIDI File (formats 0/1/2, tempo map, SMPTE timing) to one MIDI port from main, on an absolute high-resolution clock; Rate 0.25×–4×, start/end region, loop count (−1 until stopped), per-channel filter/remap, transpose (channel 10 exempt unless asked); a start part-way chases program, bank, controllers, RPN/NRPN, pitch bend and pressure; stop releases every note it started and lifts the sustain pedal; panic adds All Notes Off. A file that is not MIDI, a region with nothing in it or a port that is not there refuses with a sentence. |
| control | Acts on the cues it names: start, stop, pause, resume, load (to a time into the cue, ready for an instant GO), reset, go to (moves the playhead), arm or disarm — QLab's Start/Stop/Pause/Resume/Load/Reset/GoTo/Arm/Disarm cues in one. Completes at once, never acts on itself, and with no target does nothing and says so. |
| timecode | Runs a SMPTE clock from a start time — MTC to a MIDI port, LTC from an engine output channel, ArtTimeCode to an address, in any mix — at 24, 25, 29.97 drop-frame, 29.97 non-drop or 30 fps, to an end time or until stopped; jam sync starts it from the incoming clock and carries it through a dropout. Pause, resume and locate from the inspector. With no output chosen it refuses and says so. |
| video | Plays a video file on a video output: start/end trim, loop (finite or for ever), fade in and a fade out that lands on the end, hold last frame, pause/resume/seek, per-cue geometry (fit/fill/stretch/native, position, scale, rotation, crop) applied live, layer and level, crossfade from what is on the output. Its sound is an ordinary engine voice — level, pan, routing matrix, fades, meters — kept on the picture's clock by the output. |
| image | Shows a still on a video output for its duration (or until stopped), with fades, geometry, layer and level, and crossfade. |
| text | Draws text on a video output — font, size, colour, bold/italic, nine-point position — with fades, layer and level, for its duration or until stopped. |
| camera | Shows a live picture on a video output — a capture device on this machine (webcam, USB, HDMI capture) or a network stream (HTTP video, HLS, MJPEG) — with fades, layer, level, blend and geometry, until stopped; a device that is not connected is said across the output. |
| input | Live Input: plays channels of an input device through the engine as a voice — level, pan, routing matrix or output patch, fade in (any drawn shape) and a fade out on stop — until stopped or for its duration. The input runs on its own clock behind an adaptive drift resampler, so a separate interface works; the inspector meters it and reads its latency. Pause, show-wide pause, Fade cues and PANIC reach it. With no channel chosen it refuses and says so. |

Common fields, with defaults: Number (text, not a position — inserting never renumbers), Name, Colour (8), Notes (first line shows in the live/next bar), Pre-wait 0, Post-wait 0, Advance none/on start/on end, "If fired again" ignore/restart, Armed on, Triggers.

## Playback and transport

- GO (Space) fires the cue to the right of the live/next bar, then advances to the next armed cue; disarmed cues are skipped. Selection is a bulk-edit tool, not a second transport.
- An audio cue does not hold the show unless Advance is On end; a network cue holds until answer or timeout; a script holds until it finishes.
- STOP (Esc) stops sound, waits, sequences and scripts; a stopped cue runs no post-wait and does not auto-advance; a stopped group finishes nothing. Stopping a child does not stop the group (a sequence steps on; a timeline stops waiting; a playlist's pass stays put).
- PANIC (Shift+Esc, the Playback menu, OSC `/cuerunner/panic`, MIDI All Sound Off CC 120 = 0 on any listened port) stops with a 200 ms fade and releases stuck controls; there is deliberately no transport button for it. The sender is written to the log.
- The repeat guard (Settings → General, default 300 ms, 0 = off, show-wide) swallows a second GO from the space bar, a trigger or a console; the per-cue re-fire policy defaults to ignore (restart is opt-in).
- Triggers fire exactly as GO, including pre-wait and advance. OSC addresses match exactly — no wildcards — and a MIDI trigger matches port + channel + note (velocity ignored) or a CC (value ignored).

## Surfaces

- **Live/next bar** — what is playing (number, name, first notes line, elapsed vs remaining) and what GO fires next; with several running cues it names the longest-running and counts the rest.
- **Cue list** — running order, one row per cue, group chevrons, context actions (duplicate, delete, colour, arm); undo last 50 edits, one stack for list, scenes, desk setup, cast and mic plot.
- **Inspector** — per-type tabs plus a Last run block (when it ran, how long, what went wrong).
- **Dock** — one panel at a time: selected cue, run log (last 500 lines, unsaved, repeats collapsed), timeline (timeline groups), Monitor, Wireless, Script.
- **Waveform** — start/end trims draggable, split with movable boundaries, zoom 1×–32× (header `−`/`+` or Ctrl+wheel, cursor-anchored), wheel pan, and playhead follow while playing; the cursor belongs to its cue.
- **Monitor** — what is listening, what arrived, devices discovered; alarms appear above the panel and in the transport bar.
- **Scenes view** — grid of the show's faders × scenes (rows are the faders by number, columns the scenes, with the `Out` column first); a row holds exactly one thing — a strip, or an ensemble over several of them, built in the grid's own builder and applied there — and the column's own recall is what moves the desk. A padlock in the grid's corner locks the show and unlocks it; the column the desk is on says so in its title.
- **Script panel** — plain-text script file, numbered lines, cues pinned to lines, A−/A+; the panel follows the show.
- **Tablet view** — the same view in a browser; access code; cannot fire a cue, edit the show, or stop anything.
- **Wireless** — the plot, batteries and alarms, sortable by trouble; Report tab (lowest battery, worst signal, swaps). It consumes one telemetry JSON document whose field names are the contract: `channels[]` with `id` required; `name`, `batteryPercent`, `batteryMinutes`, `rfDbm`, `audioLevel`, `muted`, `frequencyMhz` optional, and absent fields show nothing rather than zero.
- **Showfile** — history of the last 200 saves inside the file; Compare; three-way Merge; Bundle export/import.
- **Operational caps** — log 500 lines, undo 50, history 200 saves, monitor 300 lines / 200 entries, script 200 lines per run, bundle ≈ 4 GB, decoded cache 512 MB / 100 files.

## Formats, ports, protocols

- `.cuerunner` — JSON: cues and show setup, not the audio; deterministic bytes for the same show and folder; the shape is declared and checked on load — a file this build does not recognise is refused rather than guessed at, and only the grouping repair runs, reporting what it changed.
- `.cuerunnerx` — bundle: a zip of `show.cuerunner` + `media/`, fixed timestamps, checksummed import, ~4 GB media ceiling (the 64-bit zip extension is not written).
- Ports: OSC in 53000 (UDP); tablet view 53100 (read-only, access code); backup machine 53110 with partner gone after 3000 ms (bounds 1000–30000); desk MIDI over TCP 51325; the SQ's native control service 51326, whose session is kept alive by a datagram to UDP 51324 each second; device discovery browses `_netaudio-arc._udp.local` and `_netaudio-cmc._udp.local`, gone after 30 s.
- Desks: Allen & Heath SQ — DCA membership over its native control service, mutes over the desk link's MIDI — and Avantis, over the desk link's documented assignment and mute forms; ETC Eos over OSC (in and out); MSC both directions; desk buttons as GO/BACK.

## Platforms and requirements

- Windows 10+, macOS 12+, or 64-bit Linux (experimental AppImage; MIDI needs `libasound2-dev` at build time).
- Two or more cores (four comfortable, and what the project is tested on), 8 GB RAM, any disk, no GPU required.
- The decoded-audio cache is bounded (512 MB / 100 files); a file whose decoded form exceeds 32 MB streams from disk.
- Distribution: Windows NSIS, macOS DMG, Linux AppImage, released to the download host and GitHub Releases; nothing publishes on merge.
