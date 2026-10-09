// The GPU renderer: WebGL 2.
//
// Every layer is a textured quad placed by its affine (visualGeometry.ts) and drawn
// premultiplied, back to front. A dissolve draws the two stacks into two framebuffers and
// mixes them; a warp draws the finished frame into a third and lays it onto the window through
// the corner pin's inverse, with the soft edges applied on the way (visualWarp.ts). With no
// warp and no dissolve a frame is one pass straight to the window.
//
// A layer with a blend mode other than normal needs the frame under it, which a draw cannot
// read from the buffer it is drawing into: a stack with one is built in two more buffers in
// turn — each blended layer read from one, written whole into the other — and copied to
// where the stack belongs once it is done (visualBlend.ts is the formula the shader is held
// to). A mask is laid over the finished pictures by multiplying the frame by it.

import type { Frame, DrawItem, MaskItem, Renderer } from './render'
import { isIdentityWarp } from '../../../shared/visual'
import { warpSampler } from '../../../shared/visualWarp'
import { LUMA_WEIGHTS, blendIndex } from '../../../shared/visualBlend'
import type { Drawable } from './sources'

const QUAD_VERTEX = `#version 300 es
in vec2 a_unit;
uniform mat3 u_place;
uniform vec2 u_size;
uniform vec4 u_src;
out vec2 v_tex;
void main() {
  vec3 p = u_place * vec3(a_unit, 1.0);
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_tex = u_src.xy + a_unit * u_src.zw;
}`

const QUAD_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform float u_opacity;
in vec2 v_tex;
out vec4 color;
void main() {
  color = texture(u_tex, v_tex) * u_opacity;
}`

const FULL_VERTEX = `#version 300 es
in vec2 a_unit;
out vec2 v_uv;
void main() {
  v_uv = a_unit;
  gl_Position = vec4(a_unit * 2.0 - 1.0, 0.0, 1.0);
}`

const MIX_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_before;
uniform sampler2D u_after;
uniform float u_t;
in vec2 v_uv;
out vec4 color;
void main() {
  color = mix(texture(u_before, v_uv), texture(u_after, v_uv), u_t);
}`

const WARP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform mat3 u_inverse;
uniform bool u_pinned;
uniform vec4 u_blend;
uniform float u_gamma;
in vec2 v_uv;
out vec4 color;
float ramp(float d, float w) {
  if (w <= 0.0) return 1.0;
  return pow(clamp(d / w, 0.0, 1.0), max(u_gamma, 0.1));
}
void main() {
  vec2 win = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 f = win;
  if (u_pinned) {
    vec3 h = u_inverse * vec3(win, 1.0);
    f = h.xy / h.z;
  }
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) {
    color = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float k = ramp(f.x, u_blend.x) * ramp(1.0 - f.x, u_blend.y) * ramp(f.y, u_blend.z) * ramp(1.0 - f.y, u_blend.w);
  vec4 c = texture(u_scene, vec2(f.x, 1.0 - f.y));
  color = vec4(c.rgb * k, 1.0);
}`

// One layer blended onto the frame under it, over the whole frame: where the layer is, the
// mode's formula; everywhere else, the frame as it was. `u_inverse` takes an output pixel back
// to the layer's unit square, the inverse of the affine that placed it.
const BLEND_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_backdrop;
uniform sampler2D u_tex;
uniform mat3 u_inverse;
uniform vec2 u_size;
uniform vec4 u_src;
uniform float u_opacity;
uniform int u_mode;
in vec2 v_uv;
out vec4 color;
float hardLight(float cb, float cs) {
  return cs <= 0.5 ? cb * 2.0 * cs : 1.0 - (1.0 - cb) * (1.0 - (2.0 * cs - 1.0));
}
float softD(float cb) {
  return cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
}
float separable(int mode, float cb, float cs) {
  if (mode == 1) return cb * cs;
  if (mode == 2) return cb + cs - cb * cs;
  if (mode == 3) return hardLight(cs, cb);
  if (mode == 4) return min(cb, cs);
  if (mode == 5) return max(cb, cs);
  if (mode == 6) {
    if (cb <= 0.0) return 0.0;
    if (cs >= 1.0) return 1.0;
    return min(1.0, cb / (1.0 - cs));
  }
  if (mode == 7) {
    if (cb >= 1.0) return 1.0;
    if (cs <= 0.0) return 0.0;
    return 1.0 - min(1.0, (1.0 - cb) / cs);
  }
  if (mode == 8) return hardLight(cb, cs);
  if (mode == 9) return cs <= 0.5 ? cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb) : cb + (2.0 * cs - 1.0) * (softD(cb) - cb);
  if (mode == 10) return abs(cb - cs);
  if (mode == 11) return cb + cs - 2.0 * cb * cs;
  return cs;
}
float channel(int mode, float cb, float cs, float a) {
  if (mode == 12) return clamp(cb + a * cs, 0.0, 1.0);
  if (mode == 13) return clamp(cb - a * cs, 0.0, 1.0);
  return clamp((1.0 - a) * cb + a * separable(mode, cb, cs), 0.0, 1.0);
}
void main() {
  vec4 b = texture(u_backdrop, v_uv);
  vec3 q = u_inverse * vec3(v_uv.x * u_size.x, (1.0 - v_uv.y) * u_size.y, 1.0);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
    color = b;
    return;
  }
  vec4 s = texture(u_tex, u_src.xy + q.xy * u_src.zw);
  float a = clamp(s.a * u_opacity, 0.0, 1.0);
  vec3 cs = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  color = vec4(channel(u_mode, b.r, cs.r, a), channel(u_mode, b.g, cs.g, a), channel(u_mode, b.b, cs.b, a), 1.0);
}`

const COPY_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_from;
in vec2 v_uv;
out vec4 color;
void main() {
  color = texture(u_from, v_uv);
}`

// The mask's share of the pictures at each pixel, as alpha: drawn with the frame multiplied
// by it. The image is the right way up in its texture, and the frame is not.
const MASK_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_mask;
uniform bool u_luma;
uniform bool u_invert;
uniform vec3 u_weights;
in vec2 v_uv;
out vec4 color;
void main() {
  vec4 m = texture(u_mask, vec2(v_uv.x, 1.0 - v_uv.y));
  float k = clamp(u_luma ? dot(m.rgb, u_weights) : m.a, 0.0, 1.0);
  if (u_invert) k = 1.0 - k;
  color = vec4(0.0, 0.0, 0.0, k);
}`

interface Target {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
}

/** The affine that placed a layer, turned round: output pixels back to its unit square, column-major. */
export function inverseAffine(m: readonly number[]): number[] | null {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  // u = ( d·x − c·y + (c·f − d·e)) / det;  v = (−b·x + a·y + (b·e − a·f)) / det
  return [d / det, -b / det, 0, -c / det, a / det, 0, (c * f - d * e) / det, (b * e - a * f) / det, 1]
}

interface Uploaded {
  texture: WebGLTexture
  version: number
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)
    if (shader === null) throw new Error('could not create a shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`shader did not compile: ${gl.getShaderInfoLog(shader) ?? ''}`)
    }
    gl.attachShader(program, shader)
  }
  gl.bindAttribLocation(program, 0, 'a_unit')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`shader did not link: ${gl.getProgramInfoLog(program) ?? ''}`)
  }
  return program
}

export class GlRenderer implements Renderer {
  readonly kind = 'webgl' as const
  readonly pins = true
  private readonly quad: WebGLProgram
  private readonly mix: WebGLProgram
  private readonly warp: WebGLProgram
  private readonly blend: WebGLProgram
  private readonly copy: WebGLProgram
  private readonly masking: WebGLProgram
  private readonly textures = new Map<string, Uploaded>()
  private targets: Target[] = []
  private width = 1
  private height = 1

  private constructor(private readonly gl: WebGL2RenderingContext) {
    this.quad = compile(gl, QUAD_VERTEX, QUAD_FRAGMENT)
    this.mix = compile(gl, FULL_VERTEX, MIX_FRAGMENT)
    this.warp = compile(gl, FULL_VERTEX, WARP_FRAGMENT)
    this.blend = compile(gl, FULL_VERTEX, BLEND_FRAGMENT)
    this.copy = compile(gl, FULL_VERTEX, COPY_FRAGMENT)
    this.masking = compile(gl, FULL_VERTEX, MASK_FRAGMENT)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  /** A renderer on this canvas, or null where the machine has no WebGL 2. */
  static create(canvas: HTMLCanvasElement): GlRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      // Kept, so the frame on screen can be read back: an output's pixels are what the
      // acceptance suite asserts, and a frame is redrawn every refresh anyway.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    })
    if (gl === null) return null
    try {
      return new GlRenderer(gl)
    } catch {
      return null
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.targets.length > 0) return
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const gl = this.gl
    for (const target of this.targets) {
      gl.deleteFramebuffer(target.framebuffer)
      gl.deleteTexture(target.texture)
    }
    // Before, after, the warp's scene, and the two a blended stack is built in by turns.
    this.targets = [0, 1, 2, 3, 4].map(() => {
      const texture = this.newTexture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const framebuffer = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      return { framebuffer, texture }
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  readPixel(x: number, y: number): number[] {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const out = new Uint8Array(4)
    // GL's rows count from the bottom; the frame's from the top.
    gl.readPixels(Math.floor(x), this.height - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return Array.from(out)
  }

  release(key: string): void {
    const uploaded = this.textures.get(key)
    if (uploaded === undefined) return
    this.gl.deleteTexture(uploaded.texture)
    this.textures.delete(key)
  }

  draw(frame: Frame): void {
    const gl = this.gl
    const sampler = warpSampler(frame.warp)
    const warped = !isIdentityWarp(frame.warp)
    const finalTarget = warped ? this.targets[2] : null

    if (frame.plan.kind === 'dissolve') {
      this.drawStack(this.targets[0], frame.plan.before)
      this.drawStack(this.targets[1], frame.plan.after)
      this.bind(finalTarget)
      gl.disable(gl.BLEND)
      gl.useProgram(this.mix)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.targets[1].texture)
      gl.uniform1i(gl.getUniformLocation(this.mix, 'u_before'), 0)
      gl.uniform1i(gl.getUniformLocation(this.mix, 'u_after'), 1)
      gl.uniform1f(gl.getUniformLocation(this.mix, 'u_t'), frame.plan.progress)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.activeTexture(gl.TEXTURE0)
      gl.enable(gl.BLEND)
      this.applyMask(finalTarget, frame.mask)
      this.drawItems(frame.overlays)
    } else {
      this.drawStack(finalTarget, frame.plan.draws)
      this.applyMask(finalTarget, frame.mask)
      this.drawItems(frame.overlays)
    }

    if (warped) {
      this.bind(null)
      gl.disable(gl.BLEND)
      gl.useProgram(this.warp)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.targets[2].texture)
      gl.uniform1i(gl.getUniformLocation(this.warp, 'u_scene'), 0)
      gl.uniform1i(gl.getUniformLocation(this.warp, 'u_pinned'), sampler === null ? 0 : 1)
      const m = sampler ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
      // Row-major in, column-major for GL.
      gl.uniformMatrix3fv(gl.getUniformLocation(this.warp, 'u_inverse'), false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
      const b = frame.warp.blend
      gl.uniform4f(gl.getUniformLocation(this.warp, 'u_blend'), b.left, b.right, b.top, b.bottom)
      gl.uniform1f(gl.getUniformLocation(this.warp, 'u_gamma'), frame.warp.gamma)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.enable(gl.BLEND)
    }
  }

  private bind(target: Target | null): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target === null ? null : target.framebuffer)
    gl.viewport(0, 0, this.width, this.height)
  }

  private drawStack(target: Target | null, items: DrawItem[]): void {
    const gl = this.gl
    if (items.every(item => item.blend === 'normal')) {
      this.bind(target)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.drawItems(items)
      return
    }
    // Built by turns in the last two buffers: a normal layer is drawn onto the one in hand, a
    // blended one is read against it into the other, which is then the one in hand.
    let current = this.targets[3]
    let spare = this.targets[4]
    this.bind(current)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    for (const item of items) {
      if (item.blend === 'normal') {
        this.bind(current)
        this.drawItems([item])
        continue
      }
      if (this.blendItem(current, spare, item)) [current, spare] = [spare, current]
    }
    this.copyInto(current, target)
  }

  /** One layer blended onto `backdrop`, the whole frame written into `into`. False if nothing was drawn. */
  private blendItem(backdrop: Target, into: Target, item: DrawItem): boolean {
    const gl = this.gl
    if (!item.source.ready || item.source.width <= 0 || item.source.height <= 0) return false
    const inverse = inverseAffine(item.placement.transform)
    const texture = this.upload(item.key, item.source)
    if (inverse === null || texture === null) return false
    this.bind(into)
    gl.disable(gl.BLEND)
    gl.useProgram(this.blend)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, backdrop.texture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(gl.getUniformLocation(this.blend, 'u_backdrop'), 0)
    gl.uniform1i(gl.getUniformLocation(this.blend, 'u_tex'), 1)
    gl.uniformMatrix3fv(gl.getUniformLocation(this.blend, 'u_inverse'), false, inverse)
    gl.uniform2f(gl.getUniformLocation(this.blend, 'u_size'), this.width, this.height)
    const s = item.placement.source
    gl.uniform4f(
      gl.getUniformLocation(this.blend, 'u_src'),
      s.x / item.source.width,
      s.y / item.source.height,
      s.width / item.source.width,
      s.height / item.source.height
    )
    gl.uniform1f(gl.getUniformLocation(this.blend, 'u_opacity'), Math.min(Math.max(item.opacity, 0), 1))
    gl.uniform1i(gl.getUniformLocation(this.blend, 'u_mode'), blendIndex(item.blend))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.activeTexture(gl.TEXTURE0)
    gl.enable(gl.BLEND)
    return true
  }

  private copyInto(from: Target, to: Target | null): void {
    const gl = this.gl
    this.bind(to)
    gl.disable(gl.BLEND)
    gl.useProgram(this.copy)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, from.texture)
    gl.uniform1i(gl.getUniformLocation(this.copy, 'u_from'), 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.enable(gl.BLEND)
  }

  /** The frame multiplied by the mask: the pictures show as much as it lets them. */
  private applyMask(target: Target | null, mask: MaskItem | null): void {
    if (mask === null || !mask.source.ready || mask.source.width <= 0 || mask.source.height <= 0) return
    const gl = this.gl
    const texture = this.upload(mask.key, mask.source)
    if (texture === null) return
    this.bind(target)
    gl.useProgram(this.masking)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(gl.getUniformLocation(this.masking, 'u_mask'), 0)
    gl.uniform1i(gl.getUniformLocation(this.masking, 'u_luma'), mask.mode === 'luma' ? 1 : 0)
    gl.uniform1i(gl.getUniformLocation(this.masking, 'u_invert'), mask.invert ? 1 : 0)
    gl.uniform3f(gl.getUniformLocation(this.masking, 'u_weights'), LUMA_WEIGHTS[0], LUMA_WEIGHTS[1], LUMA_WEIGHTS[2])
    // The frame's colour times the mask's share; its alpha left as it was.
    gl.blendFuncSeparate(gl.ZERO, gl.SRC_ALPHA, gl.ZERO, gl.ONE)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  private drawItems(items: DrawItem[]): void {
    const gl = this.gl
    gl.useProgram(this.quad)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(gl.getUniformLocation(this.quad, 'u_tex'), 0)
    gl.uniform2f(gl.getUniformLocation(this.quad, 'u_size'), this.width, this.height)
    for (const item of items) {
      if (!item.source.ready || item.source.width <= 0 || item.source.height <= 0) continue
      const texture = this.upload(item.key, item.source)
      if (texture === null) continue
      gl.bindTexture(gl.TEXTURE_2D, texture)
      const [a, b, c, d, e, f] = item.placement.transform
      gl.uniformMatrix3fv(gl.getUniformLocation(this.quad, 'u_place'), false, [a, b, 0, c, d, 0, e, f, 1])
      const s = item.placement.source
      gl.uniform4f(
        gl.getUniformLocation(this.quad, 'u_src'),
        s.x / item.source.width,
        s.y / item.source.height,
        s.width / item.source.width,
        s.height / item.source.height
      )
      gl.uniform1f(gl.getUniformLocation(this.quad, 'u_opacity'), item.opacity)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
  }

  private upload(key: string, source: Drawable): WebGLTexture | null {
    const gl = this.gl
    let uploaded = this.textures.get(key)
    if (uploaded === undefined) {
      uploaded = { texture: this.newTexture(), version: -1 }
      this.textures.set(key, uploaded)
    }
    if (uploaded.version !== source.version) {
      gl.bindTexture(gl.TEXTURE_2D, uploaded.texture)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.element)
        uploaded.version = source.version
      } catch {
        // A frame that is not there to read (a video between seeks): the last one stands.
      }
    }
    return uploaded.texture
  }

  private newTexture(): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }
}
