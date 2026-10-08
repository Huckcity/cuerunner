// What a layer draws from: a video element, a decoded image, or text drawn into a canvas.
// Each is something both renderers can take as it is — a `TexImageSource` for the GPU, an
// image for the 2D context — with its size and whether it has changed since it was last
// uploaded.

import type { TextStyle } from '../../../shared/ipc/output'

export interface Drawable {
  /** What is drawn. */
  element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
  width: number
  height: number
  /** Bumped whenever the pixels change and must be uploaded again (every frame, for video). */
  version: number
  /** Whether there is anything to draw yet. */
  ready: boolean
}

export function createVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video')
  // The sound is the engine's. The element never makes one: muted, and its volume at nothing.
  video.muted = true
  video.volume = 0
  video.playsInline = true
  video.preload = 'auto'
  // The scheme answers with CORS so the frame can be drawn into WebGL and read back.
  video.crossOrigin = 'anonymous'
  video.disablePictureInPicture = true
  video.src = src
  return video
}

export function createImage(src: string): HTMLImageElement {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = src
  return image
}

/** The CSS font a text style is drawn in. */
export function fontOf(style: Pick<TextStyle, 'bold' | 'italic' | 'fontSize' | 'fontFamily'>): string {
  const family = style.fontFamily.trim() === '' ? 'sans-serif' : `"${style.fontFamily.replace(/"/g, '')}", sans-serif`
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${Math.max(1, Math.round(style.fontSize))}px ${family}`
}

/** How far text is kept from the output's edge, and how much room a line gets. */
export const TEXT_PADDING = 0.15
export const LINE_HEIGHT = 1.25

/**
 * Draws a block of text into `canvas`, sized to the text: one line per line of the cue's
 * text, aligned the way the grid position reads (left on the left, right on the right).
 */
export function drawText(canvas: HTMLCanvasElement, style: TextStyle): void {
  const context = canvas.getContext('2d')
  if (context === null) return
  const font = fontOf(style)
  context.font = font
  const lines = style.text.split(/\r?\n/)
  const size = Math.max(1, style.fontSize)
  const pad = Math.ceil(size * TEXT_PADDING)
  const lineHeight = Math.ceil(size * LINE_HEIGHT)
  const width = Math.max(1, Math.ceil(Math.max(...lines.map(line => context.measureText(line).width), 1)) + pad * 2)
  const height = Math.max(1, lineHeight * lines.length + pad * 2)
  canvas.width = width
  canvas.height = height
  // The canvas was resized, which resets its state: the font is set again.
  context.font = font
  context.clearRect(0, 0, width, height)
  context.fillStyle = /^#[0-9a-fA-F]{6}$/.test(style.color) ? style.color : '#ffffff'
  context.textBaseline = 'middle'
  const align: CanvasTextAlign = style.position.endsWith('left') ? 'left' : style.position.endsWith('right') ? 'right' : 'center'
  context.textAlign = align
  const x = align === 'left' ? pad : align === 'right' ? width - pad : width / 2
  lines.forEach((line, index) => {
    context.fillText(line, x, pad + lineHeight * index + lineHeight / 2)
  })
}

/**
 * A test pattern for lining an output up: a grid, the centre and the edges marked, the
 * corners named, colour bars, and the output's name and size — drawn at the output's own
 * resolution so a pixel on it is a pixel on the projector.
 */
export function drawTestPattern(canvas: HTMLCanvasElement, width: number, height: number, label: string): void {
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) return
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff']
  const barWidth = width / bars.length
  const barTop = height * 0.62
  bars.forEach((colour, index) => {
    context.fillStyle = colour
    context.fillRect(index * barWidth, barTop, Math.ceil(barWidth), height * 0.14)
  })
  context.strokeStyle = '#808080'
  context.lineWidth = Math.max(1, Math.round(height / 540))
  const step = Math.max(8, Math.round(height / 10))
  for (let x = 0; x <= width; x += step) {
    context.beginPath(); context.moveTo(x + 0.5, 0); context.lineTo(x + 0.5, height); context.stroke()
  }
  for (let y = 0; y <= height; y += step) {
    context.beginPath(); context.moveTo(0, y + 0.5); context.lineTo(width, y + 0.5); context.stroke()
  }
  context.strokeStyle = '#ffffff'
  context.lineWidth = Math.max(2, Math.round(height / 270))
  context.strokeRect(context.lineWidth / 2, context.lineWidth / 2, width - context.lineWidth, height - context.lineWidth)
  context.beginPath()
  context.arc(width / 2, height / 2, Math.min(width, height) * 0.4, 0, Math.PI * 2)
  context.moveTo(width / 2 - step / 2, height / 2); context.lineTo(width / 2 + step / 2, height / 2)
  context.moveTo(width / 2, height / 2 - step / 2); context.lineTo(width / 2, height / 2 + step / 2)
  context.stroke()
  context.fillStyle = '#ffffff'
  context.font = `600 ${Math.round(height / 14)}px "IBM Plex Sans", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, width / 2, height * 0.32)
  context.font = `400 ${Math.round(height / 24)}px "IBM Plex Mono", monospace`
  context.fillText(`${width} × ${height}`, width / 2, height * 0.44)
  context.font = `400 ${Math.round(height / 30)}px "IBM Plex Mono", monospace`
  const inset = height / 20
  context.textAlign = 'left'
  context.fillText('TL', inset, inset)
  context.fillText('BL', inset, height - inset)
  context.textAlign = 'right'
  context.fillText('TR', width - inset, inset)
  context.fillText('BR', width - inset, height - inset)
}
