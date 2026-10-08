// The page every video output draws in, and the floating timer's.
//
// An output is a canvas the size it composes at, letterboxed into its window, redrawn every
// display refresh from the stage's plan. Main tells it what it is and what to show; it tells
// main what it showed. It reads nothing from disk and runs no cue: its media arrives by URL
// through main's own scheme, and every time it is given is on the engine's clock.

import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/700.css'
import './output.css'
import type { OutputEvent, OutputWindowBridge, OutputWindowCommand, OutputWindowInit, TimerFeed } from '../../../shared/ipc/output'
import type { TimerMode } from '../../../shared/visual'
import { EngineClock } from './engineClock'
import { Stage, timerText } from './stage'
import { GlRenderer } from './renderGl'
import { CanvasRenderer } from './render2d'
import type { Renderer } from './render'

declare global {
  interface Window {
    cuerunnerOutput: OutputWindowBridge
    /** What the acceptance suite reads an output through: its pixels, and what it is showing. */
    __cuerunnerOutput?: {
      renderer(): 'webgl' | 'canvas'
      size(): { width: number; height: number }
      pixel(x: number, y: number): number[]
      showing(): Array<{ cueId: string; opacity: number }>
    }
  }
}

const bridge = window.cuerunnerOutput
const role = new URLSearchParams(location.search).get('role') === 'timer' ? 'timer' : 'output'

if (role === 'timer') void runTimer()
else void runOutput()

async function runOutput(): Promise<void> {
  const root = document.getElementById('stage') as HTMLDivElement
  const canvas = document.createElement('canvas')
  canvas.className = 'output-canvas'
  root.appendChild(canvas)
  const banner = element('div', 'output-banner')
  const identify = element('div', 'output-identify')
  root.append(banner, identify)

  let pending: OutputEvent[] = []
  let flushing: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    flushing = null
    if (pending.length === 0) return
    const events = pending
    pending = []
    void bridge.report({ events }).catch(() => {})
  }

  let renderer: Renderer | null = null
  const clock = new EngineClock(() => bridge.clock(), delta => stage.rebase(delta))
  const stage = new Stage({
    now: () => clock.now(),
    toEngine: local => clock.toEngine(local),
    emit: event => {
      pending.push(event)
      if (flushing === null) flushing = setTimeout(flush, 16)
    },
    release: key => renderer?.release(key)
  })

  const gl = GlRenderer.create(canvas)
  renderer = gl ?? new CanvasRenderer(canvas)
  void bridge.report({ events: [], renderer: renderer.kind }).catch(() => {})

  let missing: { label: string } | null = null
  const drawBanner = (): void => {
    const lines: string[] = []
    if (missing !== null) lines.push(`${missing.label} is not connected — showing here instead`)
    const warp = stage.warp()
    if (renderer !== null && !renderer.pins && warp !== null && warp.corners.some(c => c.x !== 0 || c.y !== 0)) {
      lines.push('Corner pin needs the GPU, which this machine is not giving the output — drawn unpinned')
    }
    banner.textContent = lines.join(' · ')
    banner.hidden = lines.length === 0
  }

  const configure = (init: Pick<OutputWindowInit, 'output' | 'width' | 'height' | 'displayMissing'>): void => {
    stage.configure(init.output, init.width, init.height)
    renderer?.resize(init.width, init.height)
    canvas.width = init.width
    canvas.height = init.height
    missing = init.displayMissing
    document.title = init.output === null ? 'Cuerunner Output' : `${init.output.name} — Cuerunner`
    drawBanner()
  }

  let identifyUntil = 0
  const handle = (commands: OutputWindowCommand[]): void => {
    for (const command of commands) {
      switch (command.kind) {
        case 'layer':
          stage.apply(command.command)
          // A picture was just asked for: a fresh reading keeps it on time.
          if (command.command.op === 'play') void clock.poll()
          break
        case 'output':
          configure(command)
          break
        case 'testPattern':
          stage.setTestPattern(command.on)
          break
        case 'identify':
          identify.textContent = command.label
          identifyUntil = performance.now() + Math.max(0, command.untilMs - Date.now())
          identify.hidden = false
          break
        case 'timer':
          stage.setTimer(command.feed, command.mode)
          break
      }
    }
  }

  // Subscribed before the first state is asked for, so nothing sent in between is lost.
  bridge.onCommands(handle)
  clock.start()
  const init = await bridge.ready()
  configure(init)
  stage.setTimer(init.timer, init.timerMode)
  stage.setTestPattern(init.testPattern)
  for (const layer of init.layers) stage.apply({ op: 'play', layer })
  for (const command of init.commands) stage.apply(command)
  void document.fonts.ready.then(() => stage.redrawText())

  window.__cuerunnerOutput = {
    renderer: () => renderer!.kind,
    size: () => ({ width: canvas.width, height: canvas.height }),
    pixel: (x, y) => readPixel(canvas, x, y),
    showing: () => stage.showing()
  }

  const tick = (): void => {
    try {
      renderer?.draw(stage.frame())
    } catch (error) {
      console.error('output frame failed:', error)
    }
    if (!identify.hidden && performance.now() > identifyUntil) identify.hidden = true
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

async function runTimer(): Promise<void> {
  document.body.classList.add('timer-window')
  document.title = 'Timer — Cuerunner'
  const root = document.getElementById('stage') as HTMLDivElement
  const digits = element('div', 'timer-digits')
  root.appendChild(digits)
  let feed: TimerFeed = { elapsedFrom: null, remaining: null }
  let mode: TimerMode = 'remaining'
  const clock = new EngineClock(() => bridge.clock(), delta => {
    feed = {
      elapsedFrom: feed.elapsedFrom === null ? null : feed.elapsedFrom + delta,
      remaining: feed.remaining === null ? null : { ...feed.remaining, endsAt: feed.remaining.endsAt + delta }
    }
  })
  bridge.onCommands(commands => {
    for (const command of commands) {
      if (command.kind === 'timer') {
        feed = command.feed
        mode = command.mode
      }
    }
  })
  clock.start()
  const init = await bridge.ready()
  feed = init.timer
  mode = init.timerMode
  const draw = (): void => {
    const text = timerText(mode, feed, clock.now())
    digits.textContent = text === '' ? '—' : text
    digits.title = mode === 'remaining' && feed.remaining !== null ? feed.remaining.label : ''
  }
  setInterval(draw, 100)
  draw()
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  node.hidden = true
  return node
}

function readPixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  const probe = document.createElement('canvas')
  probe.width = 1
  probe.height = 1
  const context = probe.getContext('2d')
  if (context === null) return []
  context.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1)
  return Array.from(context.getImageData(0, 0, 1, 1).data)
}
