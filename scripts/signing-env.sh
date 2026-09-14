#!/bin/sh
# The macOS signing environment electron-builder reads, from the secrets a build was
# given.
#
# An unset GitHub secret arrives as an *empty string*, and an empty secret must not
# become an empty CSC_LINK: electron-builder skips signing when the link is null, but an
# empty one is resolved as a certificate path and fails the build — so a release with no
# certificates configured would break instead of producing an unsigned app. Windows goes
# without this guard on purpose: its signer treats an empty WIN_CSC_LINK as "not
# signing" (app-builder-lib's windowsSignToolManager checks for the empty string), and
# passing the secrets straight through keeps that job on its own shell.
#
# Sourced, not run — it exports into the caller's shell, and it reads the environment
# rather than arguments because a POSIX shell does not pass arguments to a sourced
# script (`/bin/sh` on the runners is dash, where `. file arg` silently drops them):
#
#   SIGNING_LINK="$MAC_CSC_LINK" SIGNING_PASSWORD="$MAC_CSC_KEY_PASSWORD" . scripts/signing-env.sh
#
# Prints the ::warning:: a release reader is expected to notice when there is nothing to
# sign with; the checklist is where that warning is read.

link="$SIGNING_LINK"
password="$SIGNING_PASSWORD"

if [ -n "$link" ]; then
  CSC_LINK="$link"
  CSC_KEY_PASSWORD="$password"
  export CSC_LINK CSC_KEY_PASSWORD
  echo "macOS signing: certificate taken from MAC_CSC_LINK"
else
  echo "::warning::No macOS certificate is configured (MAC_CSC_LINK); the app will be unsigned and unnotarised."
fi
