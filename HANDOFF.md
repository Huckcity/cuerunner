# Handoff

Branch: `feat/network-script-inspectors` — 19 commits ahead of `main` (`fbd9961 chore(release): 0.7.3`).
Nothing is merged; the website deploys only from `main`.

The branch name reflects where the work started. It now covers six batches: the Network and Script
cue inspectors, per-cue run results, a session log panel, a round of fixes, the website user guide,
and the sweep through the outstanding-items list that this note was rewritten for.

---

## What landed

| Area | Commits |
|---|---|
| Network + Script cue inspectors | `feat(inspector): add Network and Script cue inspectors` |
| Per-cue run results (`Last Run`) | `feat(inspector): report the last run of network and script cues` |
| Session log panel (`LOG` button) | `feat(log): add a session log panel for cue runs and script output` |
| Ctrl shortcuts, Playlist stepping, audio Loop count, Stop inspector | `fix(cue-list)`, `feat(group)`, `fix(audio)`, `feat(inspector)` |
| Website user guide + generated screenshots + README corrections | `docs(site)`, `docs(readme)` |
| **Outstanding items 1–4 and 6–10** | `fix(cues)`, `refactor(settings)`, `feat(menu)`, `fix(inspector)`, `feat(cue-list)`, `docs` |

### The last batch, item by item

1. **Fade cue** — `Curve` now shapes the ramp; `Opacity` is gone from the model and the Property
   select. `AudioPlayer.setVolume`/`setPan` take a fourth `curve` argument.
2. **Per-cue output device and channel pair** — removed from `AudioOutput`, the defaults, and the
   README/guide. Decided rather than deferred: real multi-output is a redesign (see below).
3. **Settings that were stored but unused** — `sampleRate`/`bufferSize` are gone and the dialog now
   reports the live `AudioContext` sample rate and base latency; `midiSettings.outputPortName` is
   the fallback for a MIDI cue with no port of its own; `inputPortName` is gone.
4. **Disarmed cues** — `data-armed` on the row, dimmed name and type icon, `disarmed` pill.
5. **OSC input** — deliberately deferred. Still send-only.
6. **Stop cue** — new `Wait for fade` option holds the cue open until the tail has finished.
7. **Undo/redo** — native Edit menu with accelerators, see the gotcha below.
8. **Network response body** — read through a byte-budgeted reader, capped at 4000 characters with a
   truncation marker, shown in `Last Run`.
9. **Wait inspector copy** — names the Advance control again.
10. **Group duration** — derived for sequence and timeline groups in the cue list; still `–` for
    playlist and random groups.
11. **Smaller items** — the looping-cue progress bar now tracks the whole run (`runFraction`).
    The rest are recorded as limitations in the guide and README rather than fixed.

---

## Notable engine changes worth knowing before editing

- **Undo/redo is menu-owned.** `src/main/index.ts` sends `app:menu-action` (`undo` | `redo`);
  `App.tsx` subscribes and routes a focused text field to `document.execCommand` instead of the cue
  history. `CueList` deliberately no longer handles `Ctrl/Cmd+Z`: Electron can deliver one real
  keystroke to both the menu and the page, which would undo twice. Menu accelerators are **not**
  reachable from CDP-synthesised key events or `webContents.sendInputEvent` — that was measured, see
  `e2e/menu-undo.spec.ts`, which drives the menu item from the main process instead.
- **Fade curves.** Non-linear curves schedule `setValueCurveAtTime` with a 64-point envelope
  (`shapeCurve`); `cancelScheduledValues` always runs first because Web Audio rejects a second
  overlapping curve on the same param.
- **`AudioProgress` has two fractions.** `fraction` is the position inside the file (the waveform
  playhead); `runFraction` spans the whole run including loop repeats (the cue row bar).
- **Network bodies** are capped by `NETWORK_BODY_LIMIT` in `CueRunner.ts`, following the same
  4000-character rule as the log. The cue still completes only after the read.
- **`StopCue.waitForFade`** registers its timer under `cue.id`, so `stop()` and `panic()` cancel it.
- **`RunnerDeps` gained `getMidiDefaultPort`**, wired in `useCueRunner.ts`.
- **Workspace migration** now normalises `waitForFade` and drops the retired `deviceId`/
  `channelPair` output fields. `migrateWorkspace` is exported and has its first tests
  (`src/main/workspace/migrate.test.ts`, which stubs `electron`).

---

## Verification

```bash
npm test              # 327 passing (11 files)
npm run typecheck     # clean
npm run test:e2e      # 99 passing (builds first)
```

E2E drives the real built app. The network and log specs start a local CORS server
(`startServer()` in `e2e/helpers.ts`); the shell specs are POSIX-only and skip on Windows.

Docs tooling:

```bash
npm run screenshots   # regenerate website/assets/guide/* (needs a build)
npm run site          # serve website/ on http://localhost:8080
```

Screenshot size follows the host display scale — the last regeneration produced 2560×1536 images
where the previous commit had 1600×919. Expect a binary diff when they are regenerated elsewhere.

---

## Outstanding items

None of these are regressions; each is a limit that is now documented as such.

### 1. OSC is send-only

`osc:startListener` exists end to end (preload, main handler, `OscEngine.startListener`) but no
renderer component calls it, so incoming OSC cannot trigger cues. Deferred by choice: the receive
semantics need deciding first (does an address match a cue's address, a group, or a learned
binding?) plus a settings toggle and an E2E.

### 2. Legacy `autoContinue` / `autoFollow` are dropped, not converted

`migrateCue` deletes both fields and leaves `advance` at `none`. The guide and README now say so.
The names suggest `on-end` and `on-start`, but nothing in this repo defines their semantics — they
predate the initial commit — so a mapping would be a guess. Confirm against a real old `.wlab`
before adding one.

### 3. Caps are fixed

`LOG_LIMIT` (500 entries) and `LOG_MESSAGE_LIMIT` (4000 chars) in `store/index.ts`,
`MAX_RUN_LOG_LINES` (200) and `NETWORK_BODY_LIMIT` (4000) in `CueRunner.ts`. None are configurable.

### 4. `include()` has no module semantics

No exports, no shared scope between files.

### 5. No "recently saved" confirmation

The dirty dot clearing is the only signal that a save happened.

### 6. Multi-output does not exist

Per-cue device and channel routing was removed from the cue model rather than implemented. Real
multi-output needs one `AudioContext` per device, or a Web Audio graph per output, plus per-device
decode caching — a redesign, not a wiring job.

### 7. Smaller items

- A network cue's response body is capped at 4000 characters with no way to see the rest.
- Group rows show no length for playlist and random groups; their length is not knowable without
  stepping through them.
- A disarmed cue fired with GO returns silently: no log line, no state change, no selection move
  (`go()` bails on `!cue.isArmed`). The row marker is the only explanation on screen.

---

## Local-only state (will not follow you to another machine)

- `stash@{0}` — "wip package-lock.json (pre-existing on fix/deselect-cues)". An uncommitted
  `package-lock.json` change that was in the tree when this branch was created; it looked like an
  npm-install artifact (0.7.1 header, ~485 pruned optional/peer entries). Left untouched, and still
  uncommitted.
- The two dead-variable removals in `WorkspaceManager.ts` (`groupIdx`, `RECENT_KEY`) were also in
  the tree when the last batch started; they rode along in `refactor(settings): drop the audio and
  MIDI settings nothing read`.
- Local branches `fix/deselect-cues`, `fix/group-reorder`, `fix/node26-electron-extract` are
  pushed; `fix/deselect-cues` was checked out when the stash was taken.

## CI note

One full E2E run reported `Worker teardown timeout of 20000ms exceeded`. The worker in question
had run only `groups.spec.ts` and `smoke.spec.ts`, and it did not reproduce across 6 subsequent
runs on this branch or 10 on `main`. It looks like load noise from 8 concurrent Electron
instances on an 8-core machine (E2E runs on macOS in CI). Worth knowing before chasing it.
