// The GPU renderer: WebGL 2.
//
// Every layer is a textured quad placed by its affine (visualGeometry.ts) and drawn
// premultiplied, back to front. A dissolve draws the two stacks into two framebuffers and
// mixes them; a warp draws the finished frame into a third and lays it onto the window through
// the corner pin's inverse, with the soft edges applied on the way (visualWarp.ts). With no
// warp and no dissolve a frame is one pass straight to the window.

import type { Frame, DrawItem, Renderer } from './render'
import { isIdentityWarp } from '../../../shared/visual'
import { warpSampler } from '../../../shared/visualWarp'

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

interface Target {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
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
  private readonly textures = new Map<string, Uploaded>()
  private targets: Target[] = []
  private width = 1
  private height = 1

  private constructor(private readonly gl: WebGL2RenderingContext) {
    this.quad = compile(gl, QUAD_VERTEX, QUAD_FRAGMENT)
    this.mix = compile(gl, FULL_VERTEX, MIX_FRAGMENT)
    this.warp = compile(gl, FULL_VERTEX, WARP_FRAGMENT)
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
    this.targets = [0, 1, 2].map(() => {
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
      this.drawItems(frame.overlays)
    } else {
      this.drawStack(finalTarget, frame.plan.draws)
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
    this.bind(target)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.drawItems(items)
  }

  private drawItems(items: DrawItem[]): void {
    const gl = this.gl
    gl.useProgram(this.quad)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(gl.getUniformLocation(this.quad, 'u_tex'), 0)
    gl.uniform2f(gl.getUniformLocation(this.quad, 'u_size'), this.width, this.height)
    for (const item of items) {
      if (!item.source.ready || item.source.width <= 0 || item.source.height <= 0) continue
      const texture = this.upload(item)
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

  private upload(item: DrawItem): WebGLTexture | null {
    const gl = this.gl
    let uploaded = this.textures.get(item.key)
    if (uploaded === undefined) {
      uploaded = { texture: this.newTexture(), version: -1 }
      this.textures.set(item.key, uploaded)
    }
    if (uploaded.version !== item.source.version) {
      gl.bindTexture(gl.TEXTURE_2D, uploaded.texture)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, item.source.element)
        uploaded.version = item.source.version
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
