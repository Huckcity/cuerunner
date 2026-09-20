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
- `npm run test:native` is ten Node scripts, not vitest, ending in `matrix-bench`, which exits non-zero below the 2x realtime floor; on Linux its pre-hook downloads and builds the pinned FFmpeg (needs network, `make`, a C++ compiler).
- `npm run test:integration` skips the vendor tests unless `EOS_TARGET` or `EOS_REPLAY` is set. `npm run soak` runs 2 minutes unless `--minutes` says otherwise.
- Node: `engines.node` declares the floor; `scripts/published-floors.test.ts` holds it to the README's prerequisite line and to the majors CI's lanes pin. Run `actionlint` before editing `.github/workflows/`.
- Operator-visible changes update `website/docs/guides.mjs` or `reference.mjs` and run `node website/build-docs.mjs` in the same commit; UI changes also need `npm run screenshots`.

## Conventions that differ from defaults

- A new IPC channel is declared once, in `src/shared/ipc/<domain>.ts`: its name in that domain's `<DOMAIN>_CHANNELS` table, its payloads, and its bridge interface. The preload, `src/main/ipc/handlers.ts`, `src/renderer/src/env.d.ts` and the `src/test/setup.ts` mock all derive from that declaration, so a channel or member added at either end fails typecheck until the other end follows.
- Renderer code may not import Node or Electron (`tsconfig.web.json` has no Node types); `tsconfig.node.json`'s allow-list back into the renderer (`utils/scriptDocument.ts`, `utils/waveform.ts`) is deliberately minimal.
- No linter or formatter exists; `npm run typecheck` is the static gate. Match surrounding style.
- Window copy: four text tones clear 4.5:1, held by `scripts/theme.test.ts` and `e2e/legibility.spec.ts` — do not add a fifth grey; every label/control pair is a `.field-row`; a hint fits one line, longer text belongs in `website/docs/reference.mjs`; cue icons are drawn in `src/renderer/src/utils/cueIcons.tsx`, never typed.
- Cue list: array order is running order and children follow their parent by `parentId`; inside a timeline group `timelineOffset` decides firing.

## Known pitfalls

- Prose outlives refactors here: `README.md` still names `CueRunner.ts` (lines 277, 442, 530), a module that does not exist. When a symbol moves, grep the prose, not just the code.
- Published numbers are read from runs, never typed — the README's 8.7x/43x benchmark figures are a recorded divergence.
- Bound every read: repeated fixes landed because a load, archive or scan allocated before anything could refuse (64 MiB workspace ceiling, per-entry archive caps). A new read path needs its bound.
- Fixes have been applied to the wrong cause before; confirm the cause with the lane that ran (spine AD-24).
- Tests repeatedly asserted before the async work landed (saved file, finished archive). Wait on the artifact, not on the UI being up; the CI retry in `playwright.config.ts` is not a licence to leave a race.
- Structural list edits lose children: keep a group's subtree together on move, drop and duplicate, and never let a top-level drop join the trailing group.

<!-- /bmad:context -->
