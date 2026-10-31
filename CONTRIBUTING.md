# Contributing to Cuerunner

Thanks for helping. Bug reports and "I run sound for X and need Y" issues are as useful as code:
[GitHub Issues](https://github.com/Huckcity/cuerunner/issues).

## Making a change

1. Branch off `main`: `git checkout -b feature/my-feature`.
2. Make the change with the test that keeps it true. Never weaken product behaviour to get a test
   to pass.
3. Run the checks:

   ```bash
   npm test
   npm run typecheck
   ```

4. Commit with [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
   `chore:` and so on.
5. Push and open a pull request against `main`. CI runs only on pull requests, so a direct push
   is untested.

## UI changes

A UI change also needs an end-to-end spec in `e2e/`. Run it, then the suite:

```bash
node scripts/run-e2e.js e2e/<spec>.spec.ts
npm run test:e2e
```

These open real Electron windows. On Linux they run on a private Xvfb display (`xvfb-run` must be
on `PATH`), so nothing appears on your desktop. On Windows and macOS they use your session's
display, so expect your desktop to be taken over while they run.

## Docs changes

Operator-facing docs are generated. Edit the page's module under `website/docs/`, then run this and
commit the result with your change:

```bash
node website/build-docs.mjs
```

UI changes also need `npm run screenshots`, so the guide shows what the app shows.

## Where to read more

- [`README.md`](./README.md): building and how the parts fit together.
- [`AGENTS.md`](./AGENTS.md): conventions and known pitfalls.
- [`SECURITY.md`](./SECURITY.md): how to report a vulnerability. Please don't open a public issue
  for one.

Contributions are accepted under the project's [MIT License](./LICENSE).
