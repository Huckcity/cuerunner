# Release checklist

A release is deliberate: `release.yml` runs from `workflow_dispatch` only, so a merge to
`main` publishes nothing. Walk this list, then dispatch *Actions → Release → Run workflow*
from `main`. `semantic-release` cuts the version from the commits since the last tag, and
`release.yml` then dispatches `build.yml` for the tag it cut — a release published with the
repository's own token starts no workflow of its own, which is how releases came to carry no
installers at all — and that packaging run is what uploads them. A release with no installers
means that dispatch did not happen or failed.

Half of what this list used to assert, the pipeline now enforces and prints: each packaging job
records what it built — from the secrets that gate signing and from its own ASIO probe — the
`release` job composes that into the release notes, and a build that linked Steinberg's SDK with
no recorded agreement withholds its installer. Nothing publishes from a ref that is not a tag.
Read that section of the notes against the run page; it is the release's own statement of what
its artifacts are.

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
- [ ] **Read what the release notes say each installer is — and act on it rather than
      restating it.** `build.yml` signs and verifies its own work, and the two platforms are
      configured differently. **Windows signs through Azure Trusted Signing** and checks the
      result with `Get-AuthenticodeSignature`, which also fails when the certificate that
      signed is not the publisher the release claims. macOS still signs from a certificate in
      the repository secrets — `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` — and notarises with
      `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, then checks with `codesign`,
      `spctl` and `stapler validate`.
      **What decides a Windows build is signed is a configuration, not a certificate that can
      expire:** four repository variables — `TRUSTED_SIGNING_PUBLISHER`,
      `TRUSTED_SIGNING_ENDPOINT` (the region the account and its profile were created in),
      `TRUSTED_SIGNING_ACCOUNT`, `TRUSTED_SIGNING_PROFILE` — and three secrets,
      `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. `build-windows` decides
      from all seven through `scripts/trusted-signing.ts` before it packages anything, and
      hands electron-builder the `azureSignOptions` flags only when all seven are there.
      **Set all seven or none:** an identity configured halfway fails the job rather than
      shipping unsigned. With none of them the build is *not* failed — it logs a
      `::warning::`, produces unsigned installers, and the `release` job's section names them:
      signed, signed and notarised, or unsigned, every artifact the release page carries and
      the mirror serves. An unsigned binary will not be installed on a venue machine,
      whatever this list says, so an unsigned release is one to announce as unsigned or not
      to announce. The signing key itself never leaves Azure, so there is no certificate in
      this repository to renew, leak or revoke; what the `win-ci` runner does need is reach to
      PowerShell Gallery and to the regional endpoint, because electron-builder installs the
      `TrustedSigning` module per build.
- [ ] **The Steinberg agreement is signed before any ASIO-linked installer is published.**
      The engine hosts ASIO drivers only when Steinberg's ASIO SDK was present at build time
      (`CUERUNNER_ASIO_SDK`; see *Packaging prerequisites* in `README.md`), and the SDK's
      proprietary licence, which official builds use, permits *building*
      against it but permits *publishing* a build that links it only under the License
      Agreement signed by Steinberg. `build-windows` enforces that rather than trusting this
      list: when its probe found an SDK and `native/audio/third_party/ASIO-AGREEMENT.md` is
      not committed, the job warns, uploads nothing, and the notes name the installer
      withheld — nothing reaches the release page or the download mirror. A build with no SDK
      publishes its exe as usual, and the notes say it hosts no ASIO driver.
      **Signing the agreement is the human half**, and the record is the proof of it: when the
      agreement is signed, commit `native/audio/third_party/ASIO-AGREEMENT.md` — its date and
      the parties, no legal text — in the same commit that says it was signed. Never commit it
      as a placeholder: an empty record is the one thing that would let an unpublishable
      installer through, and no pipeline can tell the two apart.
- [ ] Dispatch **Release** from `main` and watch it finish. It cuts the tag and then starts the
      packaging run for that tag.
- [ ] **Watch for the packaging run against the tag that was just cut** — `Actions → Build`, or
      `gh run list --workflow=build.yml --limit 2`. If no run appears for the tag, start one by
      hand: `gh workflow run build.yml --ref <tag>`. The tag is the ref the publishing jobs
      admit, so a run started that way publishes exactly what the dispatch would have published.
- [ ] Confirm the packaging run went against that tag, that the notes' section names every
      installer's state, and that the Windows, macOS and Linux installers on the release page and
      in `latest/` are exactly the files that section accounts for, with the `SHA256SUMS` the
      section names sitting beside them on the page.
- [ ] **Check that the mirror the site's cards point at serves them.** `pub.cuerunner.app` is
      the public download host, and nothing in the pipeline can see it from the inside:

      ```bash
      curl -sI https://pub.cuerunner.app/latest/Cuerunner-Setup.exe
      curl -sI https://pub.cuerunner.app/latest/Cuerunner.dmg
      curl -sI https://pub.cuerunner.app/latest/Cuerunner.AppImage
      curl -sI https://pub.cuerunner.app/latest/Cuerunner.deb
      curl -sI https://pub.cuerunner.app/latest/SHA256SUMS
      ```

      The five names are the mirror's, not the notes' build names: the cards link these, and a
      release whose Windows installer the ASIO gate withheld has no
      `latest/Cuerunner-Setup.exe` at all. Each of the four file names has to answer `200` when
      the notes list its installer as published, and `404` when they list it as withheld — not a
      `200` with an earlier release's file behind it, which is the state the mirror now rules out
      by deleting each name it writes that this release did not copy. `latest/SHA256SUMS` always
      answers `200`: it is the one file the mirror composes rather than copies, naming the digest
      of each file it wrote under the name the cards link. Check the served bytes against it:

      ```bash
      curl -s https://pub.cuerunner.app/latest/Cuerunner.dmg | sha256sum
      ```

      The digest that prints has to be the one `latest/SHA256SUMS` carries for `Cuerunner.dmg`;
      the release page attaches a `SHA256SUMS` of its own, and that one names the assets as that
      page carries them (`Cuerunner Setup 0.14.0.exe` and the like), so the two files are not
      interchangeable — check a download against the list that sits beside it. Deleting needs
      the R2 token to permit delete: a red `upload-r2` whose log shows a refused `aws s3 rm`
      means the token lost that permission, and the earlier release's file is still standing at
      the name a card serves until the token is granted it again and the job is re-run. A `404`
      for a published name, a `200` for a withheld one, or a missing `SHA256SUMS` after a green
      packaging run points at the R2 bucket or its public hostname — the `R2_*` secrets and
      Cloudflare's side — rather than at this pipeline, and is to be reported rather than worked
      around.
- [ ] **Check the update feed the installed apps read.** The feeds are what every copy of the
      app checks against once a day, so they are checked as a download is:

      ```bash
      curl -s https://pub.cuerunner.app/latest/latest.yml
      curl -s https://pub.cuerunner.app/latest/latest-mac.yml
      curl -s https://pub.cuerunner.app/latest/latest-linux.yml
      ```

      Each has to carry this release's `version:`, and every `url:` and `path:` in it has to read
      `../versions/<tag>/…` — this release's own copy — and answer `200` when fetched against
      `latest/`. A release whose Windows installer was withheld leaves `latest.yml` offering the
      previous release, which is still a file that exists; that is expected, not a fault.
      Nothing here installs anything: an installed copy downloads only when its operator asks,
      and never while its show is running.

**Whether anyone is downloading is reported for you, from the host rather than the app.**
`download-report.yml` runs daily and, when the window has counts, comments them on the standing
`Download report` issue — the run that finds the first downloads starts it, with *First
downloads* as the post's first line. It reads Cloudflare's analytics for `pub.cuerunner.app` and
needs the `CF_ANALYTICS_TOKEN` secret to do it: a one-time
Cloudflare → My Profile → API Tokens → Create Token with *Zone Analytics:Read* on the
`cuerunner.app` zone, stored with `gh secret set CF_ANALYTICS_TOKEN`. The counts are edge
requests, not people — a resumed or ranged download, a re-click or a scanner adds requests — and
the app sends nothing itself; only request paths and country codes are read.

- [ ] **A release page with no assets means no packaging run happened, or the one that ran
      failed before its publishing jobs.** Check `gh run list --workflow=build.yml --limit 2` for
      a run against the tag before announcing anything, and read a red run as the cause: a run
      that failed before `release` and `upload-r2` leaves the release page and `latest/` exactly
      as they were. A run that reached the mirror and failed in it is the other case — the page
      may already carry the release while `latest/` holds part of it — so re-run that job (or
      dispatch `build.yml` for the tag again) rather than assuming nothing landed.
      **A re-cut leaves one duplicate to remove.** The recovery — delete the empty release and
      the tag, dispatch `release.yml` again — makes `@semantic-release/changelog` write the
      version's entry a second time from the same commit range, and it prepends rather than
      replaces: `CHANGELOG.md` then carries two `# [<version>]` sections with the older one cut
      short (this happened three times on 2026-09-21, and PR #146 kept only the newest). Check
      the top of the file after any re-cut and delete the older copy in the same PR as whatever
      else the release needed.
