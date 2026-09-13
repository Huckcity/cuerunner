# Handoff — the CI repair session

Short state note so this branch can be picked up on another machine. The long view
(Part A / Part B of the forward plan) is in `ENGINE-REVIEW-2-AND-ROADMAP.md`; this file
is only about where the tree and its checks stand right now. Delete it when it stops
being true.

## Where things are

- **Branch:** `feat/playback-engine-handoff` (PR #68 → `main`). Everything is pushed.
- **Tip when this was written:** `f9edb0a`.
- Working tree clean; no unpushed commits.

```
git fetch origin && git checkout feat/playback-engine-handoff && git pull
npm ci --legacy-peer-deps
```

## What is in this branch

- **Part A** (engine defects, five items) — cleared.
- **B1** — the soak and its nightly workflow, the kill tests, the reliability page and
  its published numbers, signing wired into the release build. Came in through the
  stacked PRs #70–#72.
- **B2, everything except ASIO** — a cue whose file is not at the rig's rate says so;
  the one-device policy is documented. ASIO itself is blocked on Steinberg's SDK and a
  Windows machine to verify on.
- **B6, the precondition** — the showfile is a deterministic artifact: the identity
  belongs to the show, not to a save.
- **CI repairs** (the reason this file exists): the dock layout bug, the invalid
  `build.yml` expressions, two specs that were wrong in ways CI could not explain, and
  failure messages that now carry their evidence.

## CI: what was red and why

Both long-standing red lanes were Windows and macOS e2e. Two causes, both fixed and
both pinned by a test:

1. **The cue list overflowed its own container on a short window.** `.app-main`'s
   implicit grid row is content-sized, so with less than the list's ~420px of vertical
   space the list grew past the box, was clipped by `overflow: hidden`, and still
   scrolled — selecting a cue near the end scrolled the clip and moved the list under the
   operator; rows past the clip could not be reached. Fixed with
   `grid-template-rows: minmax(0, 1fr)` (`src/renderer/src/App.css`), pinned by the
   short-window case in `e2e/dock.spec.ts`.
2. **`secrets` is not allowed in a step-level `if:`.** Asking for one makes GitHub reject
   the whole workflow file: every push produced a job-less "Build" failure with nothing
   on the page to read. The signing steps now decide in the shell. `actionlint` is clean
   over all four workflows — run it before editing them.

State on `f9edb0a`: Windows ✓, macOS ✓, typecheck/unit/native/electron-install ✓; the
ubuntu lane was still running when this was written (the two lanes before it passed).

Two things worth knowing when reading a failure:

- The runners' window is about **655px of content** on Windows and macOS, against 772
  locally on Linux, so any geometry assertion must be relative to the window it is in.
  That is why the dock's 60% assertion is written against `window.innerHeight`.
- `e2e/dock.spec.ts`, `e2e/showfile.spec.ts` and `e2e/device-loss.spec.ts` now print
  their evidence on failure: the layout geometry, and the engine's warnings, events and
  the session-log tail.

## Open

- **macOS `e2e/device-loss.spec.ts` flaked once in two runs** ("nothing played after the
  device came back"). The dump showed the second GO firing (`started` in the log), no
  voice for 15s, and 2 pacer xruns — the runner starving the engine rather than the
  engine refusing the start. Next step is to read the `engine events:` line on a repeat
  and decide between an engine-side reason and a longer wall budget.
- **The nightly soak has not had a night.** It only schedules from `main`.
- **Signing is wired but unproven**: no certificates in the repository, so the release
  build warns and ships unsigned.
- `feat/soak-and-faults`, `feat/device-rate-notice` and `feat/showfile-determinism` are
  merged; their local copies are stale leftovers and can be deleted.

## Commands that matter here

```bash
npm test                                   # unit
npm run test:native                        # engine acceptance + fault injection
npm run test:e2e                           # builds, then Playwright under Xvfb on Linux
npm run test:e2e -- e2e/dock.spec.ts       # one spec
npm run soak -- --minutes 2                # short show; --minutes 60 for a real one
gh run view <run-id> --log-failed           # CI failures
```
