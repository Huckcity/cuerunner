<!-- bmad:context -->
<!-- Verified 2026-09-17 against 31b9731. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## cuerunner

Electron + React + TypeScript show control for live performance, a QLab alternative for Windows, with the audio engine in a native C++ process of its own — a renderer crash does not stop the sound. Main owns fs, sockets, the licence and the engine; the renderer has no Node access and talks through `window.cuerunner` only. The contract is `_bmad-output/specs/spec-cuerunner/SPEC.md` (what is being built) and `_bmad-output/planning-artifacts/architecture/architecture-cuerunner-2026-09-17/ARCHITECTURE-SPINE.md` (AD-1..AD-25, how the parts must agree — read the AD before changing what it binds). `README.md` is builder-facing; `website/docs/*.mjs` is operator-facing.

## Policy

- Branch per change off `main`, then a PR: `ci.yml` runs only on `pull_request` to `main`, so a direct push is untested and its only automated consequence is the website deploy.
- Every change lands with the test that keeps it true; UI changes also need an e2e spec in `e2e/`. Never weaken product behaviour to green a test — spec-side failures get spec-side fixes.

## Where things are

- Process contexts: `src/main`, `src/preload/index.ts` (the only bridge), `src/shared` (wire types; `src/shared/ipc/` is the declared IPC surface), `src/renderer/src`, `native/audio`.
- Tests: unit `src/**/*.test.ts(x)` (vitest), e2e `e2e/*.spec.ts` (Playwright against real Electron), integration `integration/specs`, native `native/audio/tests/*.mjs`.
- UI work: `src/renderer/src/App.css` (`:root` tokens are the authority) and `.claude/skills/cuerunner-design/`.
- CI topology and homelab caveats live in the workflow headers (`.github/workflows/*.yml`); runner labels in `.github/actionlint.yaml`.

## Running and verifying

- `npm test` = `vitest run` plus a `pretest` hook that builds the C++ engine; bare `npx vitest` is watch mode and skips the engine. `npm run typecheck` runs two tsconfig projects.
- `npm run test:e2e` builds first, then runs Playwright under Xvfb via `scripts/run-e2e.js`; `xvfb-run` must be on PATH on Linux and `--headed` is the deliberate opt-out. Run e2e on the self-hosted runners, not in a dev session — a macOS run takes the desktop over.
- `npm run test:native` is eleven Node scripts, not vitest, ending in `matrix-bench`, which exits non-zero below the 2x realtime floor; on Linux its pre-hook downloads and builds the pinned FFmpeg (needs network, `make`, a C++ compiler).
- `npm run test:integration` skips the cases whose peer, console or desk is absent, each on its own variable: the vendor tests need `EOS_TARGET` or `EOS_REPLAY`, the desk cases `DESK_HOST` with `DESK_PROFILE` (and `DESK_MIDI_CHANNEL` for a desk on a cable), `MSC_HOST` for the console, and `AH_MIDI_PORT` with `AH_DESK_TARGET` for the MIDI Control bridge. `npm run soak` runs 2 minutes unless `--minutes` says otherwise.
- Node: `engines.node` declares the floor; `scripts/published-floors.test.ts` holds it to the README's prerequisite line and to the majors CI's lanes pin, and `scripts/published-numbers.test.ts` holds every published figure to the run report it came from — the README, the contract and the served tree. Run `actionlint` before editing `.github/workflows/`: no lane runs it for you.
- Operator-visible changes update the page's own module under `website/docs/` — `pages.mjs` composes GUIDES, REFERENCE, PRICING, SUPPORT and INTEROP — and run `node website/build-docs.mjs` in the same commit, held by `scripts/docs-build.test.ts`; UI changes also need `npm run screenshots`.

## Conventions that differ from defaults

- A new IPC channel is declared once: its name in that domain's `<DOMAIN>_CHANNELS` table, its bridge members, and its payloads — which stay in `src/shared/<domain>.ts` where another process already uses the shape (`network`, `osc`, `playback` and `license` name their request shapes there and only the channels live under `src/shared/ipc/`), while audio's table and bridge are in `src/shared/audio.ts`. The preload, `src/main/ipc/handlers.ts`, `src/renderer/src/env.d.ts` and the `src/test/setup.ts` mock all derive from that declaration, so a member added at either end fails typecheck until the other end follows; a push channel also needs its channel in `EVENT_CHANNELS` (`src/shared/ipc/index.ts`), the type both `sendToWindow` and the preload's `subscribe` take. Two of `app`'s channels are registered per window in `src/main/index.ts` through `src/main/ipc/windowHandlers.ts`, outside `handlers.ts`, and `src/main/ipc/parity.test.ts` is the gate that fails the build when the declaration and main's registrations disagree.
- Renderer code may not import Node or Electron (`tsconfig.web.json` has no Node types); `tsconfig.node.json`'s allow-list back into the renderer (`utils/scriptDocument.ts`, `utils/waveform.ts`) is deliberately minimal.
- No linter or formatter exists; `npm run typecheck` is the static gate. Match surrounding style.
- Window copy: four text tones clear 4.5:1, held by `scripts/theme.test.ts` and `e2e/legibility.spec.ts` — do not add a fifth grey; every label/control pair is a `.field-row`; a hint fits one line, longer text belongs in `website/docs/reference.mjs`; cue icons are drawn in `src/renderer/src/utils/cueIcons.tsx`, never typed.
- Cue list: array order is running order and children follow their parent by `parentId`; inside a timeline group `timelineOffset` decides firing.

## Known pitfalls

- Prose outlives refactors here: a moved symbol keeps its old name and its old line numbers in the docs — `README.md` named `CueRunner.ts` long after `engine/CueEngine.ts` replaced it. When a symbol moves, grep the prose, not just the code.
- Published numbers are read from runs, never typed — the README carries the 2x floor the `matrix-bench` gate enforces, and the 8.7x/43x measurements live in `quality-and-proof.md` as one run's own record rather than as a claim.
- Bound every read: repeated fixes landed because a load, archive or scan allocated before anything could refuse (64 MiB workspace ceiling, per-entry archive caps). A new read path needs its bound.
- Fixes have been applied to the wrong cause before; confirm the cause with the lane that ran (spine AD-24).
- Tests repeatedly asserted before the async work landed (saved file, finished archive). Wait on the artifact, not on the UI being up; the CI retry in `playwright.config.ts` is not a licence to leave a race.
- Structural list edits lose children: keep a group's subtree together on move, drop and duplicate, and never let a top-level drop join the trailing group.

<!-- /bmad:context -->
