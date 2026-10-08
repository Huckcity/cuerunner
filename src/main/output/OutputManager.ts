// The output windows: one persistent window per output the show declares, and the floating
// timer. Main owns them — they are made when the show declares an output and live until it
// stops declaring it, so a cue that follows another lands on a canvas that was never taken
// down, and nothing about running a show depends on the control window being alive to draw.
//
// Placement is the machine's (placements.ts): fullscreen on a display, or a window. A display
// that is not there is not a failure — the output opens as a window with a banner across it
// saying which display it was meant for, and moves back the moment the display returns.
//
// The control window is not single any more in the sense the spine's AD-17 warned about: the
// broadcast, the close handshake and the settings state still belong to the one control
// window, and every output window is told apart from it here (`isOutputWindow`), so nothing
// addressed to "the window" lands on a projector.

import { BrowserWindow, app, dialog, screen } from 'electron'
import { join } from 'node:path'
import { liveWindow } from '../ipc/broadcast'
import { refuseNavigation } from '../safety/navigation'
import { reportMainError } from '../errors'
import { OutputRegistry } from './registry'
import type { MachinePlacements } from './placements'
import { OUTPUT_WINDOW_CHANNELS } from '../../shared/ipc/outputWindow'
import {
  type LayerCommand,
  type OutputCommandResult,
  type OutputEvent,
  type OutputSnapshot,
  type OutputWindowCommand,
  type OutputWindowInit,
  type OutputWindowReport,
  type TimerFeed,
  type TimerWindowState
} from '../../shared/ipc/output'
import {
  IMAGE_FILE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
  type DisplayInfo,
  type OutputPlacement,
  type OutputStatus,
  type VideoOutput
} from '../../shared/visual'
import { compositionSize } from '../../shared/visualGeometry'
import type { AudioClockReading } from '../../shared/audio'

/** A window placed nowhere in particular opens at this size, on the primary display. */
const FLOATING_DEFAULT = { width: 640, height: 360 }
/** The floating timer's own size. */
const TIMER_WINDOW = { width: 360, height: 140 }
/** How long a window has to have stopped moving before its place is written down. */
const PLACE_SETTLE_MS = 400
/** How long identify draws each output's name. */
export const IDENTIFY_MS = 3000
/** A preview's width; its height follows the output's shape. */
const PREVIEW_WIDTH = 320

interface OutputWindow {
  outputId: string
  win: BrowserWindow
  ready: boolean
  renderer: 'webgl' | 'canvas' | null
  width: number
  height: number
  displayMissing: { label: string } | null
  testPattern: boolean
  settle: ReturnType<typeof setTimeout> | null
}

export interface OutputManagerDeps {
  placements: MachinePlacements
  /** The engine's clock, for the windows to keep their pictures on; null when it cannot answer. */
  clock(): Promise<AudioClockReading | null>
  /** Hands events to the control window. */
  publish(events: OutputEvent[]): void
}

/** The windows this manager made, so the rest of main can tell them from the control window. */
const outputWindows = new WeakSet<BrowserWindow>()

/** Whether a window is an output (or the floating timer) rather than the window the show is run from. */
export function isOutputWindow(win: BrowserWindow | null | undefined): boolean {
  return win !== null && win !== undefined && outputWindows.has(win)
}

export class OutputManager {
  private readonly registry = new OutputRegistry()
  private readonly windows = new Map<string, OutputWindow>()
  private timerWin: BrowserWindow | null = null
  private timerFeed: TimerFeed = { elapsedFrom: null, remaining: null }
  private watchingDisplays = false
  private closing = false
  private restored = false

  constructor(private readonly deps: OutputManagerDeps) {}

  // ── The show's outputs ──────────────────────────────────────────────────────

  configure(outputs: VideoOutput[]): void {
    if (this.closing) return
    this.watchDisplays()
    // The first word from the control window is when the machine's own windows come back:
    // the floating timer, if it was left open.
    if (!this.restored) {
      this.restored = true
      this.restoreTimerWindow()
    }
    const change = this.registry.configure(outputs)
    for (const outputId of change.removed) this.removeOutput(outputId)
    for (const output of change.added) this.openOutput(output)
    for (const output of change.changed) {
      const entry = this.windows.get(output.id)
      if (entry === undefined) continue
      const size = this.sizeFor(output, this.deps.placements.placement(output.id))
      entry.width = size.width
      entry.height = size.height
      if (!entry.win.isDestroyed()) entry.win.setTitle(`${output.name} — Cuerunner`)
      this.send(entry, { kind: 'output', output, width: size.width, height: size.height, displayMissing: entry.displayMissing })
      this.publishStatus(entry)
    }
  }

  snapshot(): OutputSnapshot {
    return {
      outputs: this.registry.list().map(output => this.statusOf(output.id)),
      displays: this.displays(),
      timerWindow: this.deps.placements.timerWindow()
    }
  }

  async place(outputId: string, placement: OutputPlacement): Promise<OutputStatus | null> {
    const output = this.registry.get(outputId)
    if (output === null) return null
    await this.deps.placements.place(outputId, placement)
    // A window cannot be moved between fullscreen on one display and a window on another
    // reliably on every platform, so it is made again where it now belongs. The pictures it
    // was showing come back with it, on the engine clock (registry.ts).
    this.closeWindow(outputId)
    this.openOutput(output)
    return this.statusOf(outputId)
  }

  // ── Pictures ────────────────────────────────────────────────────────────────

  layer(command: LayerCommand): OutputCommandResult {
    const routed = this.registry.route(command)
    switch (routed.kind) {
      case 'refused':
        return { ok: false, error: routed.error }
      case 'nowhere':
        return { ok: true }
      case 'all':
        for (const entry of this.windows.values()) this.send(entry, { kind: 'layer', command: routed.command })
        return { ok: true }
      case 'output': {
        if (routed.takeDownFrom !== undefined && command.op === 'play') {
          const from = this.windows.get(routed.takeDownFrom)
          if (from !== undefined) {
            this.send(from, { kind: 'layer', command: { op: 'stop', cueId: command.layer.cueId, fadeMs: 0, at: command.layer.at } })
          }
        }
        const entry = this.windows.get(routed.outputId)
        if (entry !== undefined) this.send(entry, { kind: 'layer', command: routed.command })
        return { ok: true }
      }
    }
  }

  /** Everything off every output: a panic, from whichever surface raised it. */
  panic(fadeMs: number): void {
    this.layer({ op: 'clear', fadeMs, at: 0 })
  }

  identify(): void {
    const until = Date.now() + IDENTIFY_MS
    for (const entry of this.windows.values()) {
      const output = this.registry.get(entry.outputId)
      if (output !== null) this.send(entry, { kind: 'identify', label: output.name, untilMs: until })
    }
  }

  testPattern(outputId: string, on: boolean): OutputCommandResult {
    const entry = this.windows.get(outputId)
    if (entry === undefined) return { ok: false, error: 'that output is not open' }
    entry.testPattern = on
    this.send(entry, { kind: 'testPattern', on })
    this.publishStatus(entry)
    return { ok: true }
  }

  async preview(outputId: string): Promise<string | null> {
    const entry = this.windows.get(outputId)
    if (entry === undefined || !entry.ready || !liveWindow(entry.win)) return null
    try {
      const image = await entry.win.webContents.capturePage()
      if (image.isEmpty()) return null
      return image.resize({ width: PREVIEW_WIDTH, quality: 'good' }).toDataURL()
    } catch {
      // A window that is between frames, or going away: no picture this time.
      return null
    }
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  timer(feed: TimerFeed): void {
    this.timerFeed = feed
    for (const entry of this.windows.values()) {
      const output = this.registry.get(entry.outputId)
      if (output !== null) this.send(entry, { kind: 'timer', feed, mode: output.timer.mode })
    }
    if (this.timerWin !== null && liveWindow(this.timerWin)) {
      sendCommands(this.timerWin, [{ kind: 'timer', feed, mode: this.deps.placements.timerWindow().mode }])
    }
  }

  async timerWindow(state: TimerWindowState): Promise<TimerWindowState> {
    const next = await this.deps.placements.setTimerWindow(state)
    if (!next.open) {
      if (this.timerWin !== null && !this.timerWin.isDestroyed()) this.timerWin.destroy()
      this.timerWin = null
    } else if (this.timerWin === null || this.timerWin.isDestroyed()) {
      this.openTimerWindow()
    } else {
      sendCommands(this.timerWin, [{ kind: 'timer', feed: this.timerFeed, mode: next.mode }])
    }
    return next
  }

  /** Opens what the machine says should be open when the app starts: the floating timer. */
  restoreTimerWindow(): void {
    if (this.deps.placements.timerWindow().open) this.openTimerWindow()
  }

  async pickFile(parent: BrowserWindow | null, kind: 'video' | 'image'): Promise<string | null> {
    const extensions = kind === 'video' ? [...VIDEO_FILE_EXTENSIONS] : [...IMAGE_FILE_EXTENSIONS]
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: kind === 'video' ? 'Video' : 'Images', extensions }]
    }
    const result = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }

  // ── The output windows' own door ────────────────────────────────────────────

  /** A window has loaded and asks what it is. */
  windowReady(sender: Electron.WebContents): OutputWindowInit {
    if (this.timerWin !== null && !this.timerWin.isDestroyed() && this.timerWin.webContents === sender) {
      return {
        role: 'timer',
        output: null,
        width: TIMER_WINDOW.width,
        height: TIMER_WINDOW.height,
        layers: [],
        commands: [],
        testPattern: false,
        displayMissing: null,
        timer: this.timerFeed,
        timerMode: this.deps.placements.timerWindow().mode
      }
    }
    const entry = this.entryFor(sender)
    const output = entry === undefined ? null : this.registry.get(entry.outputId)
    if (entry === undefined || output === null) {
      return {
        role: 'output', output: null, width: 16, height: 16, layers: [], commands: [],
        testPattern: false, displayMissing: null, timer: this.timerFeed, timerMode: 'off'
      }
    }
    entry.ready = true
    const replay = this.registry.replay(entry.outputId)
    this.publishStatus(entry)
    return {
      role: 'output',
      output,
      width: entry.width,
      height: entry.height,
      layers: replay.layers,
      commands: replay.commands,
      testPattern: entry.testPattern,
      displayMissing: entry.displayMissing,
      timer: this.timerFeed,
      timerMode: output.timer.mode
    }
  }

  windowReport(sender: Electron.WebContents, report: OutputWindowReport): void {
    const entry = this.entryFor(sender)
    if (entry === undefined) return
    if (report.renderer !== undefined && report.renderer !== entry.renderer) {
      entry.renderer = report.renderer
      this.publishStatus(entry)
    }
    const events = (Array.isArray(report.events) ? report.events : []).slice(0, 256)
    let layersMoved = false
    for (const event of events) {
      if (event.kind === 'gone') {
        this.registry.gone(event.cueId, entry.outputId)
        layersMoved = true
      }
      if (event.kind === 'first-frame' || event.kind === 'dissolved') layersMoved = true
    }
    if (events.length > 0) this.deps.publish(events)
    if (layersMoved) this.publishStatus(entry)
  }

  clock(): Promise<AudioClockReading | null> {
    return this.deps.clock()
  }

  // ── Teardown ────────────────────────────────────────────────────────────────

  /** The control window is going: so is every output, and nothing reopens them. */
  closeAll(): void {
    this.closing = true
    for (const outputId of [...this.windows.keys()]) this.closeWindow(outputId)
    if (this.timerWin !== null && !this.timerWin.isDestroyed()) this.timerWin.destroy()
    this.timerWin = null
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private entryFor(sender: Electron.WebContents): OutputWindow | undefined {
    for (const entry of this.windows.values()) {
      if (!entry.win.isDestroyed() && entry.win.webContents === sender) return entry
    }
    return undefined
  }

  private displays(): DisplayInfo[] {
    try {
      const primary = screen.getPrimaryDisplay()
      return screen.getAllDisplays().map((display, index) => ({
        id: display.id,
        label: display.label !== '' ? display.label : `Display ${index + 1}`,
        bounds: { ...display.bounds },
        scaleFactor: display.scaleFactor,
        primary: display.id === primary.id
      }))
    } catch {
      return []
    }
  }

  private watchDisplays(): void {
    if (this.watchingDisplays) return
    this.watchingDisplays = true
    // A projector switched on after the show was opened, or one whose cable was pulled: the
    // outputs placed on it are made again where they now belong.
    const replace = (): void => {
      if (this.closing) return
      for (const output of this.registry.list()) {
        const placement = this.deps.placements.placement(output.id)
        if (placement.displayId === null) continue
        const entry = this.windows.get(output.id)
        const present = this.displays().some(display => display.id === placement.displayId)
        const wasMissing = entry?.displayMissing !== null && entry?.displayMissing !== undefined
        if (present === wasMissing) {
          this.closeWindow(output.id)
          this.openOutput(output)
        }
      }
    }
    screen.on('display-added', replace)
    screen.on('display-removed', replace)
  }

  private sizeFor(output: VideoOutput, placement: OutputPlacement): { width: number; height: number } {
    const display = placement.fullscreen && placement.displayId !== null
      ? this.displays().find(candidate => candidate.id === placement.displayId) ?? null
      : null
    return compositionSize(
      { width: output.width, height: output.height },
      display === null ? null : { width: display.bounds.width, height: display.bounds.height, scaleFactor: display.scaleFactor }
    )
  }

  private openOutput(output: VideoOutput): void {
    if (this.closing) return
    const placement = this.deps.placements.placement(output.id)
    const displays = this.displays()
    const display = placement.displayId === null ? null : displays.find(candidate => candidate.id === placement.displayId) ?? null
    const missing = placement.displayId !== null && display === null
      ? { label: placement.displayLabel || `display ${placement.displayId}` }
      : null
    const fullscreen = placement.fullscreen && display !== null
    const primary = displays.find(candidate => candidate.primary) ?? displays[0]
    const floatingBounds = placement.bounds ?? (primary === undefined
      ? { x: 40, y: 40, ...FLOATING_DEFAULT }
      : {
          x: Math.round(primary.bounds.x + (primary.bounds.width - FLOATING_DEFAULT.width) / 2),
          y: Math.round(primary.bounds.y + (primary.bounds.height - FLOATING_DEFAULT.height) / 2),
          ...FLOATING_DEFAULT
        })
    const bounds = fullscreen && display !== null
      ? display.bounds
      : display !== null && placement.bounds === null
        ? { x: display.bounds.x + 40, y: display.bounds.y + 40, ...FLOATING_DEFAULT }
        : floatingBounds

    const win = new BrowserWindow({
      ...bounds,
      title: `${output.name} — Cuerunner`,
      backgroundColor: '#000000',
      show: false,
      frame: !fullscreen,
      fullscreen,
      // A fullscreen output never takes the keyboard from the control window: the operator's
      // GO must not land on a projector. A window can be focused, so it can be moved.
      focusable: !fullscreen,
      skipTaskbar: fullscreen,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/output.js'),
        sandbox: true,
        // An output draws every frame whether or not anyone is looking at the machine it
        // runs on; a throttled one would hold its pictures still.
        backgroundThrottling: false,
        // A picture is muted: its sound is the engine's. Nothing here asks to play audio.
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    outputWindows.add(win)
    win.setMenu(null)
    // The element is muted in the page as well; this is the belt to that brace — an output
    // window never makes a sound of its own.
    win.webContents.setAudioMuted(true)
    refuseNavigation(win.webContents)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const size = this.sizeFor(output, placement)
    const entry: OutputWindow = {
      outputId: output.id,
      win,
      ready: false,
      renderer: null,
      width: size.width,
      height: size.height,
      displayMissing: missing,
      testPattern: false,
      settle: null
    }
    this.windows.set(output.id, entry)

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      if (fullscreen) win.showInactive()
      else win.show()
    })
    if (!fullscreen) {
      const remember = (): void => {
        if (entry.settle !== null) clearTimeout(entry.settle)
        entry.settle = setTimeout(() => {
          entry.settle = null
          if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
          const current = this.deps.placements.placement(output.id)
          void this.deps.placements.place(output.id, { ...current, bounds: win.getBounds() }).catch(() => {})
        }, PLACE_SETTLE_MS)
      }
      win.on('move', remember)
      win.on('resize', remember)
    }
    // An output closed by hand (its window's own close button) is reopened by nothing: the
    // show still declares it, and the panel offers to put it back.
    win.on('closed', () => {
      if (entry.settle !== null) clearTimeout(entry.settle)
      if (this.windows.get(output.id) === entry) {
        this.windows.delete(output.id)
        this.publish([{ kind: 'status', status: this.statusOf(output.id) }])
      }
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      entry.ready = false
      reportMainError(`[main] output "${output.name}" stopped drawing: ${details.reason}`)
      // Reloaded in place: the pictures come back from the record, on the engine clock.
      setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.reload()
      }, 500)
    })
    win.webContents.on('console-message', details => {
      if (details.level === 'warning' || details.level === 'error') {
        console.error(`[output ${output.name}] ${details.message} (${details.sourceId}:${details.lineNumber})`)
      }
    })
    forwardKeys(win)
    loadOutputPage(win, 'output')
  }

  private openTimerWindow(): void {
    if (this.closing) return
    const primary = this.displays().find(display => display.primary)
    const win = new BrowserWindow({
      width: TIMER_WINDOW.width,
      height: TIMER_WINDOW.height,
      ...(primary === undefined ? {} : {
        x: primary.bounds.x + primary.bounds.width - TIMER_WINDOW.width - 24,
        y: primary.bounds.y + 24
      }),
      title: 'Timer — Cuerunner',
      backgroundColor: '#000000',
      alwaysOnTop: true,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/output.js'),
        sandbox: true,
        backgroundThrottling: false
      }
    })
    outputWindows.add(win)
    win.setMenu(null)
    win.webContents.setAudioMuted(true)
    refuseNavigation(win.webContents)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
    win.on('closed', () => {
      if (this.timerWin === win) {
        this.timerWin = null
        // Closed by hand: the machine remembers that it was put away.
        if (!this.closing) void this.deps.placements.setTimerWindow({ ...this.deps.placements.timerWindow(), open: false }).catch(() => {})
      }
    })
    this.timerWin = win
    forwardKeys(win)
    loadOutputPage(win, 'timer')
  }

  private closeWindow(outputId: string): void {
    const entry = this.windows.get(outputId)
    if (entry === undefined) return
    this.windows.delete(outputId)
    if (entry.settle !== null) clearTimeout(entry.settle)
    if (!entry.win.isDestroyed()) entry.win.destroy()
  }

  private removeOutput(outputId: string): void {
    this.closeWindow(outputId)
    // The pictures on an output that is gone are gone: their cues hear it, and stop.
    const events: OutputEvent[] = this.registry.withdraw(outputId).map(cueId => ({ kind: 'gone', cueId, outputId }))
    if (events.length > 0) this.publish(events)
  }

  private statusOf(outputId: string): OutputStatus {
    const entry = this.windows.get(outputId)
    const output = this.registry.get(outputId)
    const placement = this.deps.placements.placement(outputId)
    const size = output === null ? { width: 0, height: 0 } : this.sizeFor(output, placement)
    return {
      outputId,
      open: entry !== undefined && entry.ready && !entry.win.isDestroyed(),
      width: entry?.width ?? size.width,
      height: entry?.height ?? size.height,
      renderer: entry?.renderer ?? null,
      displayMissing: entry?.displayMissing !== null && entry?.displayMissing !== undefined,
      placement,
      layers: this.registry.cuesOn(outputId),
      testPattern: entry?.testPattern ?? false
    }
  }

  private publishStatus(entry: OutputWindow): void {
    this.publish([{ kind: 'status', status: this.statusOf(entry.outputId) }])
  }

  private publish(events: OutputEvent[]): void {
    try {
      this.deps.publish(events)
    } catch (error) {
      reportMainError(`[main] output events could not reach the window: ${String(error)}`)
    }
  }

  private send(entry: OutputWindow, command: OutputWindowCommand): void {
    sendCommands(entry.win, [command])
  }
}

/** Electron's accelerator name for a key, as `sendInputEvent` takes it. */
export function keyCodeOf(key: string): string {
  const named: Record<string, string> = {
    ' ': 'Space', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown'
  }
  return named[key] ?? key
}

/**
 * The keyboard belongs to the show, wherever it is pressed. A floating output, or the timer,
 * can take focus — it is a window the operator moves — and a GO pressed while it has it would
 * otherwise land on a page with nothing to do with it. The key is handed to the control
 * window, which is given the focus back, so the next one goes there directly.
 */
function forwardKeys(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return
    const control = BrowserWindow.getAllWindows().find(other => !isOutputWindow(other) && !other.isDestroyed())
    if (control === undefined || !liveWindow(control)) return
    event.preventDefault()
    const modifiers: Array<'shift' | 'control' | 'alt' | 'meta'> = []
    if (input.shift) modifiers.push('shift')
    if (input.control) modifiers.push('control')
    if (input.alt) modifiers.push('alt')
    if (input.meta) modifiers.push('meta')
    if (input.type === 'keyDown') control.focus()
    control.webContents.sendInputEvent({ type: input.type, keyCode: keyCodeOf(input.key), modifiers })
  })
}

function sendCommands(win: BrowserWindow, commands: OutputWindowCommand[]): void {
  if (!liveWindow(win)) return
  try {
    win.webContents.send(OUTPUT_WINDOW_CHANNELS.commands, commands)
  } catch {
    // Disposed between the check and the send: the window reloads, and the record replays.
  }
}

function loadOutputPage(win: BrowserWindow, role: 'output' | 'timer'): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/output.html?role=${role}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/output.html'), { query: { role } })
  }
}

/** Whether the app is in a state to make windows at all: tests import this without one. */
export function canMakeWindows(): boolean {
  try {
    return app.isReady()
  } catch {
    return false
  }
}
