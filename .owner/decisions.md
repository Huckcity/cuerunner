# Decisions

One entry per decision: date, decision, why, what was rejected.

## 2026-11-08: Marlowe owns the project; CI/CD runs on Slipway

Adam handed the project to an autonomous owner, with CI/CD on Slipway (app.slipway.systems) so that the project also serves as a real-world test of Slipway. Rejected: keeping CI on GitHub Actions (hosted minutes run out, and it would teach Slipway nothing).

## 2026-11-18: fork PRs keep GitHub's Linux lanes; everyone else is on Slipway

Slipway starts nothing for a fork's pull request (PIPELINE_SPEC section 2), which makes it safe on self-hosted runners but leaves a fork with no CI. So the GitHub Linux lanes (typecheck, unit-test linux, electron-install, e2e linux, integration, native-engine) now run only when `head.repo.full_name != github.repository`; same-repository PRs run them on Slipway alone. macOS and Windows stay on GitHub until Slipway has runners. Rejected: deleting the Linux lanes (a stranger's PR would get no feedback), and any self-hosted runner reachable from a fork.

## 2026-11-19: the Slipway soak is manual until publishing is solved

`.slipway/soak.yaml` has no schedule: the GitHub nightly still publishes `soak-latest.json` to the website through Pages, and a second nightly would double host load for no consumer. Rejected: scheduling both, and dropping the GitHub publish step before the site has another feed.
