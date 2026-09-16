#!/usr/bin/env node
/**
 * The ASIO smoke: the real backend, on a machine with a real ASIO driver.
 *
 * ASIO is the one backend whose host code cannot be checked without a driver — the sample
 * conversion and the buffer-size rules are proven everywhere by asio-rules.mjs, and the
 * hosting itself (instantiating the driver, creating its buffers, rendering into them on
 * its thread, handling its reset requests) needs something that answers ASIO's interface.
 * This finds the drivers the machine has and runs the full device smoke against the first
 * one, which plays a tone, checks the engine's readout against what the driver says,
 * reconfigures it, pans it, plays it, and silences it.
 *
 *   node native/audio/tests/asio-smoke.mjs [--device <driver name>] [--require]
 *
 * A machine with no driver exits 0 with a note: that is the honest state of a runner with
 * no interface attached, and a test that pretended otherwise would be a test that could
 * never be green. `--require` turns the note into a failure, for a machine that is expected
 * to have one.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const binary =
  process.env.WINSLAB_AUDIO_BIN ??
  join(repoRoot, 'native', 'audio', 'build', process.platform === 'win32' ? 'winslab-audio.exe' : 'winslab-audio')

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback
}

const wanted = argValue('--device', null)
const required = process.argv.includes('--require')

if (process.platform !== 'win32') {
  console.log(`asio smoke — not Windows (${process.platform}): ASIO is a Windows backend here; skipped`)
  process.exit(0)
}

const listed = spawnSync(binary, ['--list-devices', '--backend', 'asio'], { encoding: 'utf8' })
if (listed.error) {
  console.error(`asio smoke — could not run the engine at ${binary}: ${listed.error.message}`)
  process.exit(1)
}
if (listed.status !== 0) {
  console.error(`asio smoke — the engine refused to enumerate ASIO drivers (status ${listed.status}):`)
  console.error((listed.stderr || '').trim())
  process.exit(1)
}

let devices = []
try {
  devices = JSON.parse(listed.stdout).devices ?? []
} catch (error) {
  console.error(`asio smoke — the engine's device list was not JSON: ${error.message}`)
  console.error(listed.stdout.trim())
  process.exit(1)
}

if (devices.length === 0) {
  const note = 'no ASIO driver is installed on this machine'
  if (required) {
    console.error(`asio smoke — ${note}, and --require was asked for`)
    process.exit(1)
  }
  console.log(`asio smoke — ${note}; skipped (install an interface's driver, or Steinberg's built-in one, to run this)`)
  process.exit(0)
}

const device = wanted !== null ? devices.find((entry) => entry.id === wanted) : devices[0]
if (device === undefined) {
  console.error(`asio smoke — no such ASIO driver: ${wanted}`)
  console.error(`installed: ${devices.map((entry) => entry.id).join(', ')}`)
  process.exit(1)
}

// The smoke plays to eight channels on its acceptance sink; an interface has however many
// outputs it has, and the engine's channel setting is what it will activate.
const channels = Math.max(1, Math.min(8, device.channels > 0 ? device.channels : 8))

console.log(`asio smoke — driver "${device.id}" (${device.channels} outputs), playing to ${channels}`)
const smoke = spawnSync(
  process.execPath,
  [
    join(here, 'device-smoke.mjs'),
    '--backend', 'asio',
    '--device', device.id,
    '--channels', String(channels)
  ],
  { stdio: 'inherit', env: { ...process.env, WINSLAB_AUDIO_BIN: binary } }
)
process.exit(smoke.status ?? 1)
