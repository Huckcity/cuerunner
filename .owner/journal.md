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

Open question for next session: does Slipway pick the pipeline up after merge (needs the repository linked to the project and the file on main; the first PR cannot run it)? If not, file a needs-adam issue to link the repo. GitHub workflows stay until the Slipway lanes are proven green; `scripts/public-runners.test.ts` still applies.

Next: confirm the first Slipway run, then port e2e (Linux) and native, then retire the matching GitHub lanes.
