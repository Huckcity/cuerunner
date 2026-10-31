# Security

## Reporting a vulnerability

Please report it privately, not in a public issue:

- GitHub's [private vulnerability reporting](https://github.com/Huckcity/cuerunner/security/advisories/new), or
- email `orders@cuerunner.app`.

Say what you found and how to reproduce it.

## What to expect

This is a one-person project. Reports are handled on a best-effort basis, with no response-time
promise and no bug bounty.

## Supported versions

Only the latest release gets security fixes.

## Script cues

A workspace file can run code: script cues are not sandboxed by design. Opening a `.cuerunner` file
you do not trust is running code you do not trust, and that alone is not a vulnerability.
