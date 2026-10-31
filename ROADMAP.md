# Roadmap — the working list

Ten items from the desk, resolved into nine, each with what it means, where it lands in this
tree, what has to be true when it is done, and the decisions behind it. Anchors are file:line as
of `588da06`.

`ENGINE-REVIEW-2-AND-ROADMAP.md` is the other half of this: the year's shape, the engine,
the reasons. This is the tactical list beside it — nine entries, because the two Settings
complaints are one piece of work.

---

## Status — 2026-09-16

All nine are in, on `feat/roadmap-desk-r6-r9`. What each one is held by, so the next reader
does not have to re-derive it:

| # | Landed as | Held by |
|---|---|---|
| R1 | `2b890ba` | `utils/mediaLength` tests, `e2e/media-durations.spec.ts` |
| R2 | `ce9b14d` | `e2e/settings.spec.ts` (the box across tabs, the backdrop, the transport stood down), `e2e/go-press.spec.ts` |
| R3 | `2e6e4b9` | `components/common/Field.test.tsx`, `e2e/field-saved.spec.ts` |
| R4 | `608d409` | `store.test.ts`, `e2e/cue-multi-selection.spec.ts` |
| R5 | `c13634e` | `e2e/expand-collapse.spec.ts` |
| R6 | `a9298ba` | `engine/inputGuard.test.ts` (the decisions), a re-fire suite in `CueRunner.test.ts`, `e2e/trigger-guard.spec.ts` |
| R7 | `7175358` | `utils/cueSplit.test.ts`, `e2e/cue-split.spec.ts` (the split, the drag, the undo) |
| R8 | `8200f2e` | section 20 of `native/audio/tests/offline.mjs` (13 checks), `e2e/onsets.spec.ts` |
| R9 | `7175358` | the release block in `offline.mjs` (7 checks), three devamp cases in `CueRunner.test.ts`, `e2e/vamp.spec.ts` |

Two implementation notes worth carrying forward, because they differ from what the entries
below prescribe:

- **The firing window is measured from the firing that was allowed**, not from the attempts
  that were refused. A desk repeating every 100 ms would otherwise push the window out from
  under the next real message and the surface would never open again.
- **The devamp releases the engine's loop; it does not release everything.** A devamp with no
  target refuses with an error rather than guessing which cue was vamping, the same way a
  scene cue with no scene does.

---

## The review round — the desk's second pass

The desk's second pass over `feat/roadmap-desk-r6-r9`, on top of the nine. What it changed,
and what holds each piece:

- **A cue's name survives a split.** The pair was named from the cue's number (`Clip 3`),
  which named the operator's music for them; it is now the cue's own name, numbered —
  `Walk-in Music`, `Walk-in Music 2`. `utils/cueSplit.ts`, `store.splitAudioCueAt`,
  `e2e/cue-split.spec.ts`.
- **A device fault releases the show when it happens.** The engine panics what it holds the
  moment the device goes, but its per-voice `ended` lines follow the audio thread's
  acknowledgement — up to two seconds, during which every row still read as playing and the
  next GO on one of them was refused as a repeat of a cue that was making no sound. The
  release now rides with the fault line. `CueRunner.handleEngineEvent`, held by the device
  cases in `CueRunner.test.ts` and `e2e/device-loss.spec.ts`.
- **A track can carry more than one vamp section.** The model already allowed it — a section
  is a cue, each with its own region and its own devamp — so what this round added is the
  proof: `e2e/vamp.spec.ts` duplicates a cue, moves the copy's region, fires both and
  releases them one at a time.
- **The waveform zooms.** 1× to 32×, by the header's `−`/`+` or Ctrl+wheel, anchored on the
  cursor (and there is a wheel pan); while a cue plays, a window the playhead walks out of
  follows it back. `WaveformPanel.tsx`, `utils/waveform.ts` (the view), held by
  `e2e/waveform-view.spec.ts`.
- **The waveform cursor belongs to the cue it was placed on.** A time is a place in a file,
  so a cursor left on one track is not drawn on the next — and no split is offered on
  another track's cue at a time that happens to fall inside its region. `store.waveformCursor`
  (`{ cueId, ms }`), `CueContextMenu.tsx`.
- **Escape is the show's press.** It closes the cue list's context menu and cancels a rename;
  it does not drop the selection. An Escape that did took the waveform panel with it — the
  panel is drawn from the selection — and left the next GO firing nothing. `CueList.tsx`,
  `e2e/cue-selection.spec.ts`, and the waveform's own case in `e2e/waveform-view.spec.ts`.
- **The timeline and the waveform are framed off the window's edges.** Both are drawn across
  the whole window (the timeline in fullscreen; the waveform panel in the dock), which left
  a boundary grip at the start or the end of a file sitting half outside the window — a
  handle nobody can aim at. `TimelineEditor.css`, `WaveformPanel.css`, held by
  `e2e/waveform-view.spec.ts` and `e2e/timeline.spec.ts`.

---

| # | Item | Kind | Touches | Needs |
|---|---|---|---|---|
| R1 | Durations exist as soon as a file does | bug | renderer + IPC | — |
| R2 | Settings keeps its place, stays until dismissed, owns the keyboard | bug ×2 | renderer | — |
| R3 | A field tells you it saved | polish | renderer | — |
| R4 | Batch colour across a multi-selection | feature | renderer | selection model |
| R5 | Expand all / collapse all, top level only | feature | renderer | — |
| R6 | Block double triggers, by default | feature | renderer + settings | two guards |
| R7 | Split an audio cue — a duplicate with slices you can move | feature | renderer | R1 |
| R8 | Transients, to place slice boundaries | feature | engine + renderer | R7 |
| R9 | Vamps and devamps | feature | engine + renderer | R7's region editing |

The sequence is R1 through R7, then R9, then R8. R1 first because everything audio hangs off
measured durations. R2 and R3 are small, visible and independent. R4 and R5 make the stack
easier to operate before the audio work grows it. R6 is input hygiene, and its defaults should
land before a rig meets them. R7 builds the region editing every audio item after it wants; R9
follows immediately because that is the headline and it is those handles plus one engine verb;
R8 finishes by placing boundaries well once there are handles to snap them to.

---

## R1 · Durations exist as soon as a file does

**What you reported.** Audio cues carry no duration until you click them, and a group of
untouched audio cues shows no length on the timeline until each child has been measured.

**Why it is first.** Every other audio item hangs off it — the split point in R7, the slice
loop in R8 and the vamp section in R9 all need the file's length without anybody having
touched the cue.

**Today.** `duration` is written onto a cue by `syncCueDuration` (`store/index.ts:580`) from
three places, all incidental: choosing or changing the file in the inspector
(`AudioInspector.tsx:93`), opening the waveform panel (`WaveformPanel.tsx:58`), and firing the
cue (`CueRunner.ts:518`). A group's length is derived and never stored (`utils/cueDuration.ts`
`groupDurationMs`, consumed at `CueList.tsx:378`), so it is only ever as good as its
children's measured durations. Nothing measures a file when a workspace loads.

**Shape.** A measurement pass over the audio cues of a loaded workspace. `audio:probe`
already answers headers-only with `durationMs` — it is what `useWorkspaceFootprint.ts:29`
sweeps with — so this is a sequential, cancellable probe on load and on import, written back
through `syncCueDuration`. A file that is missing or unreadable needs a visible state, not a
silent zero, in the row and on the timeline block.

**Done when.** Loading a workspace fills every duration with nothing selected; a group's
length appears on its row and on the timeline without touching a child; a missing file is
legible as missing. Unit test for the pass, E2E that loads a workspace and reads both the
Duration cell and the timeline block width.

This is the whole of the timeline complaint as well: a block that does not represent its
track's length is a block whose child has no duration yet, and the two go away together. On
slow or network media the pass runs sequentially and fills in as it goes, with a pending state
on the cues that have not answered — the timeline is never more confident than its inputs.

---

## R2 · Settings keeps its place, and stays until dismissed

**What you reported.** The panel jumps around as you switch tabs; clicking outside it closes it.

**Today.** One file, and both have the same cause. `SettingsDialog.tsx` renders an overlay that
is `fixed; inset: 0; display: flex; align-items: center` (`SettingsDialog.css:1-9`) holding a
dialog that is `width: 520px` with **no height** and `max-height: 88vh` (`:11-21`). With no
height of its own, each tab re-centres the box, so the header, the tab strip and the ✕ all
move. Dismissal is three ways: backdrop click (`SettingsDialog.tsx:192`), Escape (`:179-183`),
and the ✕ (`:196`).

**Shape.** Give the dialog a stable box — a height, or an overlay that anchors rather than
centres — so the frame does not move between tabs, and drop the backdrop handler at `:192`.
The ✕ and Escape stay.

**And the transport stands down while it is open.** The dialog's Escape is not the only binding
that reaches the show: the global handler (`useCueRunner.ts:37-52`) maps Space to GO, Escape to
STOP and Shift+Escape to panic, and skips only events whose target is an input. So today, with
Settings open and focus on the dialog, one Escape both closes the panel and stops the show, and
Space fires a cue behind it. Decided: with the panel open, none of them act on cues — the panel
owns the keyboard, its own Escape closes it and does nothing else. That rule belongs to modal
surfaces generally (`PlotDialog.tsx:109` and `MissingMediaDialog.tsx:42` are the same shape and
should behave the same way), so the clean version is one piece of state that says a modal is up,
consulted by the transport bindings, rather than a special case for Settings.

**Done when.** An E2E asserts the dialog's bounding box is byte-identical across two tabs, that
a backdrop click leaves it open while ✕ still closes it, and that Space and Escape with the
panel open neither fire nor stop a running cue.

---

## R3 · A field tells you it saved

**What you asked for.** A subtle outer glow for a second or two, on blur, when the value
changed.

**Today.** There is no shared field component. Inspector fields are bare `<input>` and
`<select>` inside the `.field-row` convention (`Inspector.css:126-183`), committed to the store
on every keystroke through `updateCue` (`BasicTab.tsx:22` → `store/index.ts:475`, with no
equality guard). Settings has a local `NumberField` that commits on blur or Enter
(`SettingsDialog.tsx:40`), and two more private draft-then-commit copies
(`ScenesView.tsx:52`, `PlotDialog.tsx:36`), each carrying a `draft !== value` guard. There is
no toast, no `aria-live`, no per-field confirmation anywhere; the only save signal in the app
is the toolbar's dirty dot going out.

**What it is for.** Raw input boxes, and the question they leave open: a value typed and then
left, by clicking away or pressing Enter, gives no sign that anything took. QLab does not answer
it either — that is the bar. Confirmation, not novelty.

**Consequence for the design.** "On blur, when the value changed" needs a comparison most of the
app does not make today: the inspector commits on every keystroke (`updateCue`,
`store/index.ts:475`), so by the time blur arrives the value has long since been stored and the
flash is a *confirmation*, not a save. That makes the wrapper the place to put both the draft
and the comparison:

- A shared field component that holds a draft, compares against the committed value on blur and
  on Enter, and flashes when the two differ. The inspector's fields migrate onto it, which also
  retires three private copies of the same draft-then-commit pattern (`SettingsDialog.tsx:40`,
  `ScenesView.tsx:52`, `PlotDialog.tsx:36`).
- Commit timing does not change. Nothing here wants values held back until blur.

Scope is the text and number boxes. A checkbox or a select answers instantly — the tick is the
confirmation — and a slider fires continuously, so neither is in unless it asks to be.

The tokens for the flash exist: `--accent-blue-glow`, `--border-focus`, `--transition-fast`
(`App.css:40-43, 135-136`).

**Done when.** Changing a value and leaving the field flashes that field once; typing a value
back to what it was does not. Unit test for the comparison; E2E asserting the marker appears
and clears on one inspector field and one Settings field.

---

## R4 · Batch colour across a multi-selection

**Today.** Colour already exists end to end: `CueBase.colorLabel: CueColor` (`shared/cue.ts:64`),
edited only by the 8-swatch row in the Basics tab, drawn as `.col-color` on every row
(`CueRow.tsx`), persisted in the workspace and defaulted where a cue is created
(`cueDefaults.ts`) — not at load, which repairs a damaged cue grouping and completes the firing
guard a file carries none of, and reads everything else as it stands: the shape is declared and
checked and an older file is refused by name. What does not exist is multi-selection: the store
holds a single `selectedId` (`store/index.ts:108`) written by `select` (`:569`), and `CueRunner`
drives that one value to advance the selection as the show runs.

**Shape.** `selectedIds` with an anchor for shift-ranges, and three consumers brought along:
the row rendering and click/modifier handling in `CueList.tsx`, the context menu's target
(`CueContextMenu.tsx` has no colour or multi-target items today), and the engine's automatic
selection advance. The colour action then writes across the set as one undo step, using the
coalescing rule at `store/index.ts:324`.

**Done when.** Shift- and cmd-click select ranges and sets; one swatch pick colours all of them
as a single undoable change; the inspector shows what the set has in common. E2E for selection
and batch colour, unit test for the action.

**The rule for GO, since single selection is load-bearing for playback.** GO advances from the
last-clicked cue and the rest of the selection is inert: the selection is a bulk-edit tool, not
a second transport.

---

## R5 · Expand all / collapse all, top level only

**Today.** Collapse state is component-local `useState<Set<string>>` in `CueList.tsx`,
deliberately not persisted, toggled per group by the chevron in `CueRow.tsx`. There is no
expand-all anywhere.

**Shape.** The action has to reach that state from the toolbar (`.toolbar-actions` in
`Toolbar.tsx`), so the state moves into the store with two actions. Expand-all opens top-level
groups and leaves nested groups as the operator left them; collapse-all closes everything —
collapsing has no partial reading. State stays session-only, as it is today.

**Done when.** The button expands the top level without opening nested groups, collapses
everything, and resets sensibly on workspace load. E2E.

---

## R6 · Block double triggers, by default

You asked for both halves: the trigger and the re-fire.

**Today, exactly.** Triggers match in `engine/triggers.ts` (exact OSC address, MIDI identity,
armed cues only) and fire from `useCueTriggers.ts` through `cueRunner.goById`. There is no
debounce, cooldown, edge detection or minimum interval anywhere in the path: `OscInputService`
publishes every datagram, `MidiInputService` every decoded message, `ShowBus` batches at 50 ms
without filtering (rate limiting exists only for device readings), and the keyboard bindings in
`useCueRunner.ts` have no repeat guard — holding Space repeats through OS key-repeat. A re-fire
of a running cue is a **restart**: `CueRunner` cancels the old run, hard-stops the voice with
`fadeMs = 0`, and starts a fresh one; the engine also replaces by `cueId`. So today a bounced
MIDI note audibly truncates the cue and starts it again.

**Shape.** Two guards, both defaulting to blocked:

- **Trigger debounce**, beside `triggers.ts`, because it is a property of the trigger surface,
  not of the cue. MIDI wants an edge guard (fire on note-on, ignore repeats while held) plus a
  short bounce window; OSC is stateless per datagram so it needs the window alone. **One window,
  not one per kind** — see the paragraph below: an operator who has just watched a doubled note
  truncate a cue reaches for one number, and a per-kind table is three fields for a problem that
  was one. The edge guard is where the per-kind difference actually lives, and it is not a
  number.
- **Re-fire policy** on the cue: ignore while running (default) or restart (today's behaviour,
  kept as the opt-in). This one applies to every cue type, not only audio, and to the operator's
  GO as much as to a remote trigger.

**The window is configurable, and covers everything — including GO.** One value in
milliseconds, applied at every surface, the operator's own keyboard bindings included: a
double-tap on Space is exactly the accident this is for. It is a show-wide setting, so it
belongs in the workspace document beside `audioSettings` and `showSettings`
(`shared/workspace.ts:111,119`), as an optional section a load completes with the default when a
file carries none — `triggerGuard` — and the Settings dialog is where it is edited. None of the five
tabs the dialog then had (Audio, MIDI, Network, Wireless, License, `SettingsDialog.tsx:72-78`) is an honest home for
a value spanning keyboard, MIDI and OSC, so the field arrives with a General tab, first in the
list.

**Done when.** A duplicated OSC datagram fires once; a held MIDI note fires once; a double-tap
of Space fires once; a second GO on a running cue does nothing by default and still restarts a
cue configured to restart; the window is editable and survives a save and reload.

---

## R7 · Split an audio cue — a duplicate with slices you can move

**What you clarified.** A boundary chosen at the moment of splitting is rarely where it should
be, so the split has to stay adjustable. What this really is: **duplicate the cue, then move the
boundary** — for a track with a silence in the middle while dialogue happens, or any case where
a track has to be broken up so a cue from the stage can proceed.

**Today.** The cue already carries what a slice needs: `startTime` and `endTime` into the file
(edited in the inspector's *Time & Loops* tab), `loopCount` (`-1` is forever) as the loop
region, and a measured `duration` once R1 lands. The waveform panel is where a boundary is
visible — clicking sets the start time and `drawWaveform` (`utils/waveform.ts`) draws that
start marker — but there is no *end* handle and neither can be dragged. The app's only context
menu is the cue list's (`CueContextMenu.tsx`, contract in `e2e/context-menu.spec.ts`).

**Shape.**

1. **Split here** — a context-menu item that duplicates the cue at the cursor: the first keeps
   its identity, its triggers, its routing and its level over `[start, at)`; the copy takes
   `[at, end)` and the tail fade, named so the pair reads as a pair. One undo restores one cue.
2. **The waveform becomes a region editor** — draggable start and end handles on the slice.
   This is the piece that makes the split correctable, and it is the same control R9's vamp
   section wants, which is why vamps follows this and not the other way round.
3. Both halves are ordinary audio cues, so nothing else has to know about them: a group or a
   timeline can hold them, each keeps its own fades, and the join is a butt splice that is
   gain-continuous only if nothing changed across it — the operator's business, not the model's.

**Done when.** Splitting at the cursor produces two cues that together play what the original
played; either boundary can be dragged afterwards, with playback and the saved file following
it; one undo puts the original back. The capture harness (`CUERUNNER_TEST_AUDIO_CAPTURE`,
`e2e/helpers.ts`) can measure the halves, and an E2E drags a boundary and asserts the region.
The split point is wherever the waveform cursor is — the same cursor that already sets the start
time.

---

## R8 · Transients, to place slice boundaries

**Today.** Nothing analyses content. The waveform is a peak envelope computed by the engine
(`AUDIO_CHANNELS.waveform` → `WaveformPanel.tsx:55`), and the *loop* half already exists: a
region (`startTime`/`endTime`) with `loopCount`, `-1` meaning forever. What is missing is any
notion of where the musical boundaries are.

**Shape.** Onset detection over the decoded PCM — spectral flux or an envelope derivative with
an adaptive threshold — in the native engine, where the samples already are and where a result
can be cached per file the way peaks are. Running it over the peak envelope in the renderer is
cheaper and tempting; the envelope is a summary, so quiet attacks get lost and the results would
be a toy. Then the UI: onsets drawn on the waveform, the R7 handles snapping to them, and "loop
this slice" using the region the engine already loops. It sits after vamps in the sequence
because by then the handles exist and this only has to place them well.

**Done when.** A file with clear onsets shows them; slice points snap to them; looping a slice
loops inside the engine rather than re-triggering the cue. Fixture-based tests in the
`native/audio/tests/offline.mjs` pattern, plus E2E for the UI.

---

## R9 · Vamps and devamps

**Today.** Closer than it looks. A region plus `loopCount = -1` is already "loop this section
forever", and the native voice carries `segmentStartFrame`/`segmentEndFrame`, `loopCount` and
`loopsCompleted` (`native/audio/src/mixer.h`). What does not exist is a voice that *leaves* its
loop and continues — no named markers, no second region, no release verb — and no devamp cue.
The vamp section is R7's pair of handles with a loop on it, which is why it follows that work.

**Shape.**

1. **Engine.** A release — a verb that rewrites a live voice's segment end to the end of the
   file and clears the loop, or a two-phase vamp model in `StartOptions`. Verb validation lives
   at `native/audio/src/engine.cpp:714-815`, and `seek` (`:849`) is the shape of a live mutation.
2. **Cue model.** The vamp section on the audio cue (the same start/end the loop already uses),
   and a **Devamp** cue that targets a cue id — the `stop` and `fade` cues are the precedent for
   a cue whose job is to act on another cue.
3. **Behaviour.** A vamping cue reads as vamping rather than as playing-with-a-countdown; the
   devamp releases sample-accurately from wherever the loop is; STOP and panic still end it; a
   timeline or group run treats the vamp as "not finished yet".

**Done when.** Fire → loops in the vamp section indefinitely → devamp plays it out to the end,
sample-accurate, from inside a running group; two vamped cues can coexist; the release is covered
by a native test (offline) and the cue behaviour by E2E.

**Decided: Devamp is its own cue type.** Its own cue type rather than a command on an existing family, because that is the model
operators arrive with, and because `stop` and `fade` already set the precedent for a cue whose
job is to act on another cue: it targets an id, the way those do.

---

## Decisions

Answers recorded so the next reader does not re-ask them:

- **Timeline.** The item was only ever about blocks not representing a track's length until its
  duration is measured. R1 is the whole of it; there is no separate interaction work.
- **Settings and the transport.** With the panel open, no binding acts on cues — not Escape
  (STOP), not Space (GO), not Shift+Escape (panic). The panel owns the keyboard.
- **The save tell.** Raw input boxes, on blur or Enter, confirming that the value took — which
  is more than QLab gives. Commit timing does not change.
- **Debounce.** Covers everything, the operator's GO included, with the window configurable in
  Settings (a new General tab; stored in the workspace).
- **Split.** A duplication with slices, adjustable afterwards: boundaries are dragged on the
  waveform, not fixed at the moment of splitting. The split point is the waveform cursor.
- **Vamps.** Free, with Devamp as its own cue type.

Nothing here is waiting on an answer. What was left to the build — where the guard sits relative
to `triggers.ts`, how the "a modal is up" state is shaped, what the workspace section holding the
window is called — was answered by the build: `engine/inputGuard.ts` (the decision) held by
`CueRunner` (the one place every surface reaches, so `go()`, a trigger and the keyboard ask the
same guard), the store's existing `modals` counter, and `triggerGuard: { windowMs }` beside
`audioSettings` and `showSettings` in the workspace document, completed by the load with the
default when a file carries none, and edited in Settings → General.
