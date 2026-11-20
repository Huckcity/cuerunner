# Roadmap

Maintained by Marlowe. In order; the top item is next.

1. Port CI from GitHub Actions to Slipway (done: Linux typecheck, unit, e2e, native, tsan. Decoder cache verified 2026-11-16 (run #23). Integration lane ported 2026-11-17 (run #24). Next: watch stream-stall (one failure in run #18); GitHub Linux lanes now fork-PR-only (PR #19, 2026-11-18); macOS/Windows wait for runners). Soak ported as a manual Slipway pipeline (2026-11-19, PR #20/#21); next: how its result reaches the website, then schedule it and retire the GitHub nightly's compute, fork PRs safe; retire the GitHub workflows.
2. Ship a complete release through Slipway (blocked on needs-adam #22: runners and secrets; meanwhile build the Linux-only slice: packages, SHA256SUMS, staged feed): signed Windows installer, signed and notarised macOS build, Linux packages, SHA256SUMS, a verified latest/ feed.
3. Fix the macOS e2e timeout (#2) and the nightly soak flakes; make every lane blocking again.
4. Roadmap: timecode (B3 with B7), Art-Net/sACN (B4), ergonomics (B8).
