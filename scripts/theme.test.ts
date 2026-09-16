// The design tokens, held to the thing they were rebuilt for: every tone the window
// writes text in has to be readable on every surface it can sit on.
//
// The app had seven greys and used the two darkest — #666 and #555 — for column headers,
// hints, empty values and placeholders, at 2.2–2.9:1 against the panels behind them.
//
// It reads src/renderer/src/App.css as text, so the rule holds for whatever that file
// says today rather than for a copy of its values kept here. It sits among the script
// tests rather than beside App.css because reading a file is Node's to do, and the
// renderer project has no Node types — which is the point of it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const css = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/src/App.css'),
  'utf-8'
)

/** Every `--name: value` in the `:root` block, which is where the tokens live. */
function tokens(): Map<string, string> {
  const from = css.indexOf(':root {')
  const root = css.slice(from, css.indexOf('\n}', from))
  const found = new Map<string, string>()
  for (const [, name, value] of root.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    found.set(name, value.trim())
  }
  return found
}

const token = (name: string): string => {
  const value = tokens().get(name)
  if (value === undefined) throw new Error(`App.css has no ${name}`)
  return value
}

/** Relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const full = hex.replace('#', '')
  const six = full.length === 3 ? full.split('').map(c => c + c).join('') : full
  const channels = [0, 2, 4]
    .map(i => parseInt(six.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** Contrast ratio between two opaque colours, 1:1 to 21:1. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** The four tones text is written in. --fg-disabled is deliberately not among them. */
const TEXT = ['--fg-primary', '--fg-body', '--fg-muted', '--fg-subtle']

/** Every surface those tones can sit on, darkest panel to lightest control. */
const SURFACES = [
  '--bg-well', '--bg-base', '--bg-raised', '--bg-surface', '--bg-card', '--bg-input'
]

/** WCAG AA for text below 18px, which is all of it. */
const AA = 4.5

describe('text tones', () => {
  it.each(TEXT)('%s is readable on every surface', name => {
    for (const surface of SURFACES) {
      const ratio = contrast(token(name), token(surface))
      expect(
        ratio,
        `${name} on ${surface} is ${ratio.toFixed(2)}:1, under ${AA}:1`
      ).toBeGreaterThanOrEqual(AA)
    }
  })

  it('keeps the tones apart, so each one means something', () => {
    const ratios = TEXT.map(name => contrast(token(name), token('--bg-surface')))
    // Ordered lightest to darkest, and far enough apart to tell by eye.
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeLessThan(ratios[i - 1])
      expect(ratios[i - 1] / ratios[i]).toBeGreaterThan(1.15)
    }
  })

  it('is the whole set: no CSS names a text tone the tokens do not', () => {
    const named = new Set(
      [...css.matchAll(/(--fg-[a-z-]+):/g)].map(([, name]) => name)
    )
    expect([...named].sort()).toEqual([...TEXT, '--fg-disabled'].sort())
  })
})

describe('accents and states', () => {
  // These carry meaning on their own — a red that reads as grey is a failure nobody
  // sees — so they are held to the same bar on the surfaces they are drawn on.
  it.each([
    '--accent-amber', '--accent-blue', '--ok-fg', '--warn-fg', '--danger-fg',
    '--state-running-fg', '--pill-fg', '--adv-fg'
  ])('%s is readable on the panels it is used on', name => {
    for (const surface of ['--bg-base', '--bg-surface', '--bg-card']) {
      const ratio = contrast(token(name), token(surface))
      expect(
        ratio,
        `${name} on ${surface} is ${ratio.toFixed(2)}:1, under ${AA}:1`
      ).toBeGreaterThanOrEqual(AA)
    }
  })

  it('GO carries white, and reads as the only saturated press in the window', () => {
    expect(contrast('#ffffff', token('--state-go'))).toBeGreaterThanOrEqual(AA)
    expect(contrast('#ffffff', token('--state-go-hover'))).toBeGreaterThanOrEqual(3)
  })
})

describe('surfaces', () => {
  it('steps from panel to panel, each one lighter than the last', () => {
    const steps = SURFACES.map(name => luminance(token(name)))
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i], `${SURFACES[i]} is not lighter than ${SURFACES[i - 1]}`)
        .toBeGreaterThan(steps[i - 1])
    }
  })

  it('keeps --fg-disabled below the readable tones, so it cannot pass as one', () => {
    expect(contrast(token('--fg-disabled'), token('--bg-surface'))).toBeLessThan(AA)
  })
})
