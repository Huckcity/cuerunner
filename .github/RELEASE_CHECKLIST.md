# Release checklist

A release is deliberate: `release.yml` runs from `workflow_dispatch` only, so a merge to
`main` publishes nothing. Walk this list, then dispatch *Actions → Release → Run workflow*
from `main`. `semantic-release` cuts the version from the commits since the last tag and
`build.yml` picks the published release up and uploads the installers.

- [ ] `main` is green in `ci.yml` (typecheck, unit, native, and the three E2E lanes) and
      the working tree is clean.
- [ ] **Re-read `Known Limitations` in `README.md` against the diff since the last release.**
      The section is a claim about the code, and it goes stale in the direction that costs
      the most: a limitation that was fixed but is still listed reads to an evaluator as a
      problem the product still has. Diff what actually changed, then check every entry:

      ```bash
      last=$(git describe --tags --abbrev=0)
      git log --oneline "$last"..HEAD
      git diff --stat "$last"..HEAD -- src e2e
      ```

      Every entry the diff left true stays as it is; every entry the diff made false is
      rewritten or deleted before dispatching, and the new wording names the behaviour the
      code now has. No release ships a limitation its own commits removed.
- [ ] Dispatch **Release** from `main` and watch it finish.
- [ ] Confirm `build.yml` ran against the published release and the Windows, macOS and Linux
      installers are on the release page.
