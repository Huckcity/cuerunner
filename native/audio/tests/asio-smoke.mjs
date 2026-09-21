#!/usr/bin/env node
/**
 * The ASIO smoke: the real backend, on a machine with a real ASIO driver.
 *
 * ASIO is the one backend whose host code cannot be checked without a driver — the sample
 * conversion and the buffer-size rules are proven everywhere by asio-rules.mjs, and the
 * hosting itself (instantiating the driver, creating its buffers, rendering into them on
 * its thread, handling its reset requests) needs something that answers ASIO's interface.
 * This finds the drivers the machine has and runs the full device smoke against the
 * first one with outputs, which plays a tone, checks the engine's readout against
 * what the driver says, reconfigures it, pans it, plays it, and silences it.
 *
 *   node native/audio/tests/asio-smoke.mjs [--device <driver name>] [--require]
 *                                          [--report <path>] [--no-driver <state>]
 *
 * A machine with no driver exits 0 with a note: that is the honest state of a runner with
 * no interface attached, and a test that pretended otherwise would be a test that could
 * never be green. `--require` turns the note into a failure, for a machine that is expected
 * to have one.
 *
 * Every path out of this script also states the claim's status *for this run*: `ASIO hosting:
 * unproven` with the machine's state as the reason where nothing was hosted, and `proved` only
 * when the driver smoke played through a driver. The record's `proved` for `ASIO hosting` is a
 * standing fact about the lane; this note is what today's machine actually did, so a runner
 * with no interface never reads as proof of hosting (AD-24). `--report <path>` leaves the same
 * status behind as JSON, and `GITHUB_STEP_SUMMARY` gets it too when the environment names one.
 *
 * `--no-driver <state>` is for a caller that already knows the machine could not have hosted a
 * driver and can say why — the Windows lane's no-SDK branch, where the engine is built without
 * ASIO — so the status is stated from that state rather than from a driver list it never had.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  appendSummary,
  asioEntry,
  laneLine,
  reportOf,
  smokeOutcome,
  summaryBlock,
  writeReport
} from '../../../scripts/lane-status.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const binary =
  process.env.CUERUNNER_AUDIO_BIN ??
  join(repoRoot, 'native', 'audio', 'build', process.platform === 'win32' ? 'cuerunner-audio.exe' : 'cuerunner-audio')

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback
}

const wanted = argValue('--device', null)
const required = process.argv.includes('--require')
const reportPath = argValue('--report', null)
const statedState = argValue('--no-driver', null)

/**
 * The next step a reader takes, carried by the notes that leave nothing to smoke — including the
 * machine's own advice rather than repeating it at each of them.
 */
const GUIDANCE = "install an interface's driver, or Steinberg's built-in one, to run this"

/**
 * The lane's status for this machine, said once and left where it was asked for: the note, the
 * report and the job summary all come from here, so the three cannot disagree.
 */
function leave(claimStatus, reason, driver = null) {
  const entry = asioEntry({ claimStatus, reason, driver, machine: process.platform })
  const report = reportOf('native', [entry])
  console.log(`asio smoke — ${laneLine(entry)}`)
  if (reportPath !== null) {
    writeReport(reportPath, report)
    console.log(`asio smoke — the status is in ${reportPath}`)
  }
  appendSummary(summaryBlock(report.lanes, report.run))
}

/**
 * A machine that hosted no driver, with the state that says why. `--require` turns the note into
 * a failure for a machine that is supposed to have one; the exit code changes, the status never
 * does — nothing was hosted, so nothing was proved.
 */
function leaveUnproven(note, help = '') {
  if (required) console.error(`asio smoke — ${note}, and --require was asked for`)
  else console.log(`asio smoke — ${note}; skipped${help === '' ? '' : ` (${help})`}`)
  leave('unproven', note)
  process.exit(required ? 1 : 0)
}

/**
 * A machine the lane could not even ask — no engine to run, a refusal, a device list it cannot
 * read, a driver that is not there. The lane failed, and the claim is unproven for this run all
 * the same: nothing was hosted here either, so the note says so before the exit code does.
 */
function leaveUnanswered(note) {
  console.error(`asio smoke — ${note}`)
  leave('unproven', note)
  process.exit(1)
}

// A caller that knows the machine could not host a driver states it here, and that state is the
// reason: the engine's ASIO backend may not even be in the build.
if (statedState !== null) {
  leaveUnproven(statedState)
}

if (process.platform !== 'win32') {
  leaveUnproven(`not Windows (${process.platform}): ASIO is a Windows backend here`)
}

const listed = spawnSync(binary, ['--list-devices', '--backend', 'asio'], { encoding: 'utf8' })
if (listed.error) {
  leaveUnanswered(`could not run the engine at ${binary}: ${listed.error.message}`)
}
if (listed.status !== 0) {
  if ((listed.stderr || '').trim() !== '') console.error((listed.stderr || '').trim())
  leaveUnanswered(`the engine refused to enumerate ASIO drivers (status ${listed.status})`)
}

let devices = []
try {
  devices = JSON.parse(listed.stdout).devices ?? []
} catch (error) {
  if (listed.stdout.trim() !== '') console.error(listed.stdout.trim())
  leaveUnanswered(`the engine's device list was not JSON: ${error.message}`)
}

if (devices.length === 0) {
  leaveUnproven('no ASIO driver is installed on this machine', GUIDANCE)
}

const device = wanted !== null
  ? devices.find((entry) => entry.id === wanted)
  // The lane exists to prove driver hosting: the first driver *with outputs*, so a
  // zero-channel first driver cannot pass the lane without hosting anything.
  : devices.find((entry) => entry.channels > 0)
if (wanted !== null && device === undefined) {
  console.error(`asio smoke — installed: ${devices.map((entry) => entry.id).join(', ')}`)
  leaveUnanswered(`no such ASIO driver: ${wanted}`)
}
if (device === undefined) {
  leaveUnproven('no ASIO driver with outputs is installed on this machine', GUIDANCE)
}

// A driver with no outputs has nothing to play through, and that is the machine's state
// rather than the backend's: an ASIO driver drives hardware, so a runner with no working
// endpoint (no interface plugged in, no display audio) offers it nothing. The engine still
// enumerated it and read its channel list — that path is exercised — but the smoke cannot
// play a tone into a device that has no outputs, so it says so and stops. `--require` turns
// the note into a failure for a machine that is supposed to have an output.
if (!(device.channels > 0)) {
  console.log("asio smoke — an ASIO driver plays through the machine's own endpoints: with none")
  console.log('             attached (an interface, a working display-audio output) the driver has')
  console.log('             no outputs and there is nothing to smoke. The driver was still')
  console.log('             enumerated and instantiated by the engine.')
  leaveUnproven(`the ASIO driver "${device.id}" is listed with no channels on this machine`)
}

// The smoke plays to eight channels on its acceptance sink; an interface has however many
// outputs it has, and the engine's channel setting is what it will activate. A driver with
// no outputs never gets this far.
const channels = Math.min(8, device.channels)

console.log(`asio smoke — driver "${device.id}" (${device.channels} outputs), playing to ${channels}`)
const smoke = spawnSync(
  process.execPath,
  [
    join(here, 'device-smoke.mjs'),
    '--backend', 'asio',
    '--device', device.id,
    '--channels', String(channels)
  ],
  { stdio: 'inherit', env: { ...process.env, CUERUNNER_AUDIO_BIN: binary } }
)
const status = smoke.status ?? 1
const outcome = smokeOutcome(device.id, status)
leave(outcome.claimStatus, outcome.reason, outcome.driver)
process.exit(status)
