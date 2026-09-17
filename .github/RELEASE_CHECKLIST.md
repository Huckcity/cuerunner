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
- [ ] **The installers are signed — and, on macOS, notarised.**
      `build.yml` signs from repository secrets and verifies its own work: Windows uses
      `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` and checks the result with
      `Get-AuthenticodeSignature`; macOS uses `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` and
      notarises with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, then
      checks with `codesign`, `spctl` and `stapler validate`. A build with no
      certificates is *not* failed — it logs a `::warning::` and produces unsigned
      installers — so look for that warning on the run page before announcing anything.
      An unsigned binary will not be installed on a venue machine, whatever the release
      notes say.
- [ ] **If the Windows installer contains ASIO, the Steinberg agreement is signed.**
      The engine hosts ASIO drivers only when Steinberg's ASIO SDK was present at build time
      (`CUERUNNER_ASIO_SDK`; see *Packaging prerequisites* in `README.md`), and the SDK's
      proprietary licence — the one a closed-source application uses — permits *building*
      against it but permits *publishing* a build that links it only under the License
      Agreement signed by Steinberg. So before a release that ships ASIO either the signed
      agreement is on file and the binary is the one that was tested with it, or the release
      is built without the SDK (the default: no `CUERUNNER_ASIO_SDK` in the build environment,
      the log line says `native-audio: ASIO off`, and no ASIO device is offered anywhere).
      Check the `build-windows` job's log for which of the two it was; a build that silently
      gained ASIO is the failure this item exists to catch.
- [ ] Dispatch **Release** from `main` and watch it finish.
- [ ] Confirm `build.yml` ran against the published release and the Windows, macOS and Linux
      installers are on the release page.
