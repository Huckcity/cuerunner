# Marlowe's journal

Newest entry at the bottom. Each entry: date, what was done and why, what shipped, what was learned, what is next, Slipway issues filed.

## 2026-11-08: handover (written by Adam's assistant when the project was handed to Marlowe)

Marlowe now owns this project end to end; the charter is `.claude/agents/marlowe.md`.

State at handover: v0.18.0 tagged but no release has assets (macOS e2e failed; Windows signing half-configured); latest/latest.yml missing on pub.cuerunner.app. CI on GitHub-hosted runners; macOS e2e advisory (#2); nightly soak intermittent; download report failing (no CF_ANALYTICS_TOKEN). User count unknown.

Next: start on `.owner/roadmap.md`. The Slipway organisation `huckcity` and this project's service-account token are being set up; if `slipway` cannot reach the project yet, open a `needs-adam` issue and work on something that does not need it.

## 2026-11-08: first session, first Slipway pipeline

Orient: org `huckcity` and project `cuerunner` reachable with the service token; no pipelines, no runs. Only open issue is #2 (macOS e2e). No open PRs.

Slipway friction: the charter's CLI install fails here (`api.github.com/.../slipway-releases/releases/latest` and the release download return 403 through this environment's proxy; the releases repo is public but holds only a README in git). Worked around by building `./cmd/slipway` from the read-only slipway checkout (`go build`). Not a Slipway bug as such; recorded so the charter's install step can be made robust.

Shipped: `.slipway/ci.yaml`, the Linux slice of ci.yml (typecheck and unit tests, Node 24 and 26, `node:N-bookworm` container, forks do not run on Slipway by spec). `slipway validate` passes. Not ported yet: windows/macOS lanes (no runners), e2e, integration, native, tsan, soak.

Result: the repository is linked and Slipway ran the pipeline on PR #6 (runs #1-#3) on runner `adam-desktop-slipway-1`. It fails before any of our code: in the job container, files the checkout step wrote are `Permission denied` even as root (SELinux label on the workspace mount, suspected). Filed slipway-systems/slipway#217 (dogfood, from:cuerunner). PR #6 is left open, not merged, until a run is green. The `.slipway/ci.yaml` on the branch is otherwise final. GitHub workflows stay until the Slipway lanes are proven green; `scripts/public-runners.test.ts` still applies.

Next: when #217 is fixed, rerun `ci` on PR #6, merge on green, then port e2e (Linux) and native, then retire the matching GitHub lanes.

### Update, same day (later)
The runner permission problem cleared on its own side (Adam or the host; slipway#217 and cuerunner#7 can be closed once confirmed). Run #4 then showed 3 unit-test failures that were mine: `recovery.test.ts` and `saveGuard.test.ts` rely on chmod denying access, which root bypasses, and the container ran as root. Fix: unit-test runs as the image's `node` user (`runuser -u node`). Run #5 green (typecheck and unit-test, Node 24 and 26). Merged PR #6. First Slipway-green lane for Cuerunner.

Next: port e2e (Linux, Xvfb) and native lanes; then retire the GitHub typecheck/unit-test Linux jobs; Windows and macOS wait for runners.

## 2026-11-09: Linux e2e lane on Slipway

Orient: no open PRs; only issue #2. Charter's CLI install still blocked here, built `slipway` from the checkout again (takes >2 min; no cached binary between sessions).

Shipped: PR #8 adds the `e2e` job to `.slipway/ci.yaml` (node:24 container, Xvfb, node user, FFmpeg helper built from source, artifacts on failure). Run #7 failed once on the FFmpeg download from ffmpeg.org (`curl -s --fail`, no reason shown, transient: a probe step right after reached it fine); run #8 green: e2e 15 min (decoder build 3.5 min, suite 10 min), typecheck and unit-test green. Probe step removed before merge.

Learned: a cached decoder (`slipway/cache` on native/audio/build/decoders) would save 3.5 min per run; not done yet. GitHub e2e Linux lane is now duplicated on Slipway; retire it after a few more green runs.

Next: native lane (`native.yml`) on Slipway; cache the decoder; then retire GitHub Linux lanes. Windows/macOS still need runners. No Slipway issues filed.

## 2026-11-10: native lanes written, blocked on runner

Orient: no open issues but #2, no open PRs. Built `slipway` from the checkout again (2.5 min; charter install still 403 here).

Shipped (not merged): PR #9 adds `native` (acceptance + 1 min soak) and `native-tsan` jobs to `.slipway/ci.yaml`; `slipway validate` ok. Run #10 never started: every job sat `waiting for an online runner in pool linux` for 7+ minutes, so the linux runner `adam-desktop-slipway-1` appears offline. Per charter I do not merge without green; PR #9 stays open. Also `slipway run watch` died with `stream error ... INTERNAL_ERROR` after ~10 s (polling `run get` worked); not filed yet, one occurrence.

Next: when a runner is back, let run #10 finish, fix native lane issues, merge; then decoder cache, retire GitHub Linux lanes.

## 2026-11-11: blocked on the offline runner

Orient: PR #9 (native engine and tsan lanes) is open; cuerunner#10 (needs-adam, filed yesterday) says the `linux` pool has no online runner. Adam has not answered. Built the `slipway` CLI from the checkout again (2.5 min).

Checked: run #11 on PR #9 failed with `queue_timeout`; I re-ran it (attempt 2) and 90s later it was still `waiting for an online runner in pool linux`. So the runner is still down; nothing in the pipeline is at fault.

Shipped: nothing. Without a runner I cannot get a green Slipway run, and the charter forbids merging CI work unproven or moving CI back to GitHub Actions. Did not invent other work.

Next: when #10 clears, watch run #11 on PR #9, merge on green, then cache the decoder, port integration, retire the matching GitHub Linux lanes. No Slipway issues filed (the outage is Adam's host, not a Slipway bug; the one gap worth noting is that a queued job waits 6 hours before `queue_timeout`).

### Update, 2026-11-11 (later)
The runner came back; run #11 on PR #9 passed all 7 jobs (native 7m47s, native-tsan 3m14s, e2e 17m38s, typecheck and unit-test on Node 24 and 26). Merged PR #9 after resolving a journal-only conflict. cuerunner#10 can be closed. Next: decoder cache, integration lane, then retire the matching GitHub Linux lanes.
