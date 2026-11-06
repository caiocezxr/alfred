import { LH as PAGE_H, LW as PAGE_W } from './typeset'

const VS = `#version 300 es
precision highp float;
precision highp int;
in vec2 aUV;
uniform vec2 uPage;
uniform float uSide;
uniform int uLeaf;
uniform vec2 uA;
uniform vec2 uD;
uniform float uR;
uniform float uF;
uniform float uPeak;
uniform vec2 uView;
uniform vec3 uXf;
uniform float uDist;
out vec2 vUV;
out vec3 vN;
out vec2 vQ;
out float vTheta;
out vec2 vWorld;
out float vZ;

float prof(float u) { return uPeak * (1.0 - exp(-u / 0.045)) * (1.0 - 0.42 * u * u); }
float dprof(float u) {
  float e = exp(-u / 0.045);
  return uPeak * ((e / 0.045) * (1.0 - 0.42 * u * u) + (1.0 - e) * (-0.84 * u)) / uPage.x;
}

void main() {
  vec2 q = aUV * uPage;
  float u = aUV.x;
  float f = uLeaf == 1 ? uF : 1.0;
  float h = prof(u) * f;
  float g = dprof(u) * f;
  vec3 n = normalize(vec3(-g, 0.0, 1.0));
  vec3 p = vec3(q, h);
  float theta = 0.0;
  if (uLeaf == 1) {
    vec2 perp = vec2(-uD.y, uD.x);
    float s = dot(q - uA, uD);
    float t = dot(q - uA, perp);
    float r = max(uR, 0.0001);
    float PI = 3.14159265;
    if (s > 0.0) {
      if (s < PI * r) {
        theta = s / r;
        vec2 xy = uA + uD * (r * sin(theta)) + perp * t;
        p = vec3(xy, h + r * (1.0 - cos(theta)));
        n = normalize(vec3(-uD * sin(theta), cos(theta)));
      } else {
        theta = PI;
        vec2 xy = uA - uD * (s - PI * r) + perp * t;
        p = vec3(xy, h + 2.0 * r);
        vec2 gr = vec2(g, 0.0);
        vec2 rg = gr - 2.0 * dot(gr, uD) * uD;
        n = normalize(vec3(rg, -1.0));
      }
    }
  }
  float wx = uSide * p.x;
  float k = uDist / (uDist - p.z);
  float sx = wx * k;
  float sy = uPage.y * 0.5 + (p.y - uPage.y * 0.5) * k;
  vec2 css = vec2(uXf.y + sx * uXf.x, uXf.z + sy * uXf.x);
  gl_Position = vec4(css.x / uView.x * 2.0 - 1.0, 1.0 - css.y / uView.y * 2.0, -(p.z + 40.0 * theta / 3.14159265) / 900.0, 1.0);
  vUV = aUV;
  vN = vec3(uSide * n.x, n.y, n.z);
  vQ = q;
  vTheta = theta;
  vWorld = vec2(wx, p.y);
  vZ = p.z;
}
`

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
in vec3 vN;
in vec2 vQ;
in float vTheta;
in vec2 vWorld;
in float vZ;
uniform sampler2D uTexF;
uniform sampler2D uTexB;
uniform int uLeaf;
uniform int uHasF;
uniform int uHasB;
uniform float uFlipF;
uniform float uFlipB;
uniform float uF;
uniform vec2 uPage;
uniform int uShadow;
uniform float uSame;
uniform vec2 uSA;
uniform vec2 uSD;
uniform float uSR;
uniform float uStr;
uniform float uTurnSide;
uniform float uAlpha;
uniform float uBias;
out vec4 outColor;

const vec3 L = vec3(-0.34, -0.42, 1.0);
const float PI = 3.14159265;

float sdRect(vec2 p, vec2 size) {
  vec2 d = max(-p, p - size);
  float o = length(max(d, 0.0));
  float i = min(max(d.x, d.y), 0.0);
  return o + i;
}

float shadowAt(vec2 q) {
  vec2 perp = vec2(-uSD.y, uSD.x);
  float r = max(uSR, 0.0001);
  float sq = dot(q - uSA, uSD);
  float curl = 0.0;
  if (sq > 0.0) {
    float w = 10.0 + r * 1.1;
    curl = exp(-max(sq - r * 0.85, 0.0) / w);
  }
  vec3 ln = normalize(L);
  vec2 lt = vec2(uTurnSide * ln.x, ln.y) / ln.z;
  float hgt = 2.0 * r + 4.0;
  vec2 qo = q + lt * hgt;
  float so = dot(qo - uSA, uSD);
  float to = dot(qo - uSA, perp);
  float sv = PI * r - so;
  vec2 v = uSA + uSD * sv + perp * to;
  float soft = 5.0 + r * 0.35;
  float sd = sdRect(v, uPage);
  float drop = (1.0 - smoothstep(-soft * 0.4, soft, sd)) * (1.0 - smoothstep(-soft, 0.0, so));
  return clamp(max(curl * 0.62, drop * 0.42), 0.0, 1.0) * uStr;
}

void main() {
  vec3 n = normalize(vN);
  bool front = uLeaf == 0 || n.z >= 0.0;
  if (!front) n = -n;
  float u = vUV.x;
  float tu = front ? mix(u, 1.0 - u, uFlipF) : mix(u, 1.0 - u, uFlipB);
  vec2 tc = vec2(tu, vUV.y);
  vec4 tex = front ? (uHasF == 1 ? texture(uTexF, tc, uBias) : vec4(0.965, 0.935, 0.87, 1.0)) : (uHasB == 1 ? texture(uTexB, tc, uBias) : vec4(0.965, 0.935, 0.87, 1.0));
  vec3 col = tex.rgb;
  vec3 ln = normalize(L);
  float lam = max(dot(n, ln), 0.0) / ln.z;
  float light = mix(1.0, lam, 0.8);
  float rest = uLeaf == 1 ? uF : 1.0;
  float ao = 1.0 - (0.46 * exp(-u / 0.022) + 0.13 * exp(-u / 0.10)) * rest;
  float edge = 1.0 - 0.07 * smoothstep(0.93, 1.0, u) - 0.035 * ((1.0 - smoothstep(0.0, 0.03, vUV.y)) + smoothstep(0.97, 1.0, vUV.y));
  vec3 hv = normalize(ln + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, hv), 0.0), 40.0) * 0.07 * (uLeaf == 1 ? smoothstep(0.02, 0.6, vTheta) : 0.0);
  float grad = 1.035 - 0.05 * (vWorld.y / uPage.y) + 0.018 * (-vWorld.x / uPage.x);
  col *= light * ao * edge * grad;
  if (!front) col *= 0.965;
  col += vec3(1.0, 0.93, 0.8) * spec;
  if (uShadow == 1 && (uLeaf == 0 || vTheta < 0.0005)) {
    vec2 q = uLeaf == 0 ? vec2(uSame * vQ.x, vQ.y) : vQ;
    float sh = shadowAt(q);
    col *= 1.0 - sh * 0.62;
    col = mix(col, col * vec3(0.98, 0.93, 0.86), sh * 0.6);
  }
  if (uLeaf == 1) {
    float inner = smoothstep(PI * 0.55, PI, vTheta) * (1.0 - smoothstep(PI * 0.98, PI, vTheta));
    col *= 1.0 - 0.10 * inner;
    float lift = smoothstep(0.0, 1.2, vTheta) * (1.0 - smoothstep(1.2, 2.2, vTheta));
    col *= 1.0 + 0.035 * lift;
  }
  col = mix(col, col * vec3(1.02, 0.995, 0.96), 0.5);
  vec2 pp = vUV * uPage;
  float rad = 5.0;
  vec2 cd = vec2(max(pp.x - (uPage.x - rad), 0.0), max(max(rad - pp.y, pp.y - (uPage.y - rad)), 0.0));
  float corner = 1.0 - smoothstep(rad - 0.9, rad + 0.3, length(cd));
  vec2 fw = max(fwidth(pp), vec2(1e-4));
  float ex = (uPage.x - pp.x) / fw.x;
  float ey = min(pp.y, uPage.y - pp.y) / fw.y;
  float aa = clamp(min(ex, ey) + 0.15, 0.0, 1.0);
  float cov = corner * aa;
  if (cov <= 0.001) discard;
  float a = uAlpha * cov;
  outColor = vec4(col * a, a);
}
`

export type TurnGeom = { side: number; A: [number, number]; d: [number, number]; r: number; f: number; str: number }

export type DrawState = {
  left: number
  right: number
  leaf?: { side: number; front: number; back: number; geom: TurnGeom }
  fade?: { left: number; right: number; t: number }
}

export type Xform = { vw: number; vh: number; dpr: number; s: number; gx: number; top: number; cx: number; cy: number; cw: number; ch: number }

export class CurlRenderer {
  gl: WebGL2RenderingContext
  prog: WebGLProgram
  vao: WebGLVertexArrayObject
  count: number
  loc: Record<string, WebGLUniformLocation | null> = {}
  tex = new Map<number, { t: WebGLTexture; used: number; key: string }>()
  xf: Xform = { vw: 1, vh: 1, dpr: 1, s: 1, gx: 0, top: 0, cx: 0, cy: 0, cw: 1, ch: 1 }
  probe: WebGLFramebuffer | null = null
  warmed = false
  aniso: number = 0
  anisoExt: { TEXTURE_MAX_ANISOTROPY_EXT: number } | null = null
  tick = 0
  bias = 0

  canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: 'high-performance' })
    if (!gl) throw new Error('webgl2')
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(p, 0, 'aUV')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    this.prog = p
    const names = ['uPage', 'uSide', 'uLeaf', 'uA', 'uD', 'uR', 'uF', 'uPeak', 'uView', 'uXf', 'uDist', 'uTexF', 'uTexB', 'uHasF', 'uHasB', 'uFlipF', 'uFlipB', 'uShadow', 'uSame', 'uSA', 'uSD', 'uSR', 'uStr', 'uTurnSide', 'uAlpha', 'uBias']
    for (const n of names) this.loc[n] = gl.getUniformLocation(p, n)

    const NX = 64
    const NY = 40
    const verts: number[] = []
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) verts.push(i / NX, j / NY)
    const idx: number[] = []
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i
        idx.push(a, a + 1, a + NX + 1, a + 1, a + NX + 2, a + NX + 1)
      }
    this.count = idx.length
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const vb = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const ib = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    const ext = gl.getExtension('EXT_texture_filter_anisotropic')
    if (ext) {
      this.anisoExt = ext
      this.aniso = Math.min(4, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
    }
  }

  setXform(xf: Xform) {
    this.xf = xf
    const w = Math.round(xf.cw * xf.dpr)
    const h = Math.round(xf.ch * xf.dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const st = this.canvas.style
    st.left = xf.cx + 'px'
    st.top = xf.cy + 'px'
    st.width = xf.cw + 'px'
    st.height = xf.ch + 'px'
  }

  has(i: number, key: string) {
    const e = this.tex.get(i)
    return !!e && e.key === key
  }

  upload(i: number, src: TexImageSource, key: string) {
    const gl = this.gl
    let e = this.tex.get(i)
    if (!e) {
      e = { t: gl.createTexture()!, used: 0, key }
      this.tex.set(i, e)
    }
    e.key = key
    e.used = ++this.tick
    gl.bindTexture(gl.TEXTURE_2D, e.t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (this.anisoExt) gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, this.aniso)
    this.touch(e.t)
    if (this.tex.size > 14) {
      let oldest = -1
      let ou = Infinity
      for (const [k, v] of this.tex) if (v.used < ou && k !== i) {
        ou = v.used
        oldest = k
      }
      if (oldest >= 0) {
        gl.deleteTexture(this.tex.get(oldest)!.t)
        this.tex.delete(oldest)
      }
    }
  }

  keyOf(i: number) {
    return this.tex.get(i)?.key ?? null
  }

  clear() {
    for (const e of this.tex.values()) this.gl.deleteTexture(e.t)
    this.tex.clear()
  }

  dispose() {
    this.clear()
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (this.probe) gl.deleteFramebuffer(this.probe)
    this.probe = null
    gl.deleteProgram(this.prog)
    gl.deleteVertexArray(this.vao)
  }

  private touch(t: WebGLTexture) {
    const gl = this.gl
    if (!this.probe) {
      const pt = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, pt)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.probe = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.probe)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pt, 0)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probe)
    gl.viewport(0, 0, 1, 1)
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    const L = this.loc
    gl.uniform2f(L.uPage, PAGE_W, PAGE_H)
    gl.uniform1f(L.uPeak, 0)
    gl.uniform2f(L.uView, PAGE_W, PAGE_H)
    gl.uniform3f(L.uXf, 1, 0, 0)
    gl.uniform1f(L.uDist, 3000)
    gl.uniform1i(L.uTexF, 0)
    gl.uniform1i(L.uTexB, 1)
    gl.uniform1f(L.uSide, 1)
    gl.uniform1i(L.uLeaf, 0)
    gl.uniform1i(L.uShadow, 0)
    gl.uniform1f(L.uF, 1)
    gl.uniform1f(L.uFlipF, 0)
    gl.uniform1f(L.uAlpha, 1)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.uniform1i(L.uHasF, 1)
    gl.uniform1i(L.uHasB, 0)
    for (const b of [-20, 20]) {
      gl.uniform1f(L.uBias, b)
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.flush()
  }

  private bindTex(unit: number, i: number) {
    const gl = this.gl
    const e = this.tex.get(i)
    gl.activeTexture(gl.TEXTURE0 + unit)
    if (e) {
      e.used = ++this.tick
      gl.bindTexture(gl.TEXTURE_2D, e.t)
      return 1
    }
    gl.bindTexture(gl.TEXTURE_2D, null)
    return 0
  }

  private drawPage(opts: { side: number; leaf: boolean; front: number; back: number; flipF: number; flipB: number; geom?: TurnGeom; shadow?: TurnGeom; alpha: number }) {
    const gl = this.gl
    const L = this.loc
    gl.uniform1f(L.uSide, opts.side)
    gl.uniform1i(L.uLeaf, opts.leaf ? 1 : 0)
    gl.uniform1i(L.uHasF, this.bindTex(0, opts.front))
    gl.uniform1i(L.uHasB, this.bindTex(1, opts.back))
    gl.uniform1f(L.uFlipF, opts.flipF)
    gl.uniform1f(L.uFlipB, opts.flipB)
    gl.uniform1f(L.uAlpha, opts.alpha)
    const g = opts.geom
    if (g) {
      gl.uniform2f(L.uA, g.A[0], g.A[1])
      gl.uniform2f(L.uD, g.d[0], g.d[1])
      gl.uniform1f(L.uR, g.r)
      gl.uniform1f(L.uF, g.f)
    } else {
      gl.uniform1f(L.uF, 1)
    }
    const s = opts.shadow
    if (s && s.str > 0.001) {
      gl.uniform1i(L.uShadow, 1)
      gl.uniform1f(L.uSame, opts.side === s.side ? 1 : -1)
      gl.uniform2f(L.uSA, s.A[0], s.A[1])
      gl.uniform2f(L.uSD, s.d[0], s.d[1])
      gl.uniform1f(L.uSR, s.r)
      gl.uniform1f(L.uStr, s.str)
      gl.uniform1f(L.uTurnSide, s.side)
    } else {
      gl.uniform1i(L.uShadow, 0)
    }
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0)
  }

  draw(st: DrawState | null) {
    const gl = this.gl
    const xf = this.xf
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    if (!st) return
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    const L = this.loc
    gl.uniform2f(L.uPage, PAGE_W, PAGE_H)
    gl.uniform1f(L.uPeak, 19)
    gl.uniform2f(L.uView, xf.cw, xf.ch)
    gl.uniform3f(L.uXf, xf.s, xf.gx - xf.cx, xf.top - xf.cy)
    gl.uniform1f(L.uDist, 3000)
    gl.uniform1i(L.uTexF, 0)
    gl.uniform1i(L.uTexB, 1)
    gl.uniform1f(L.uBias, this.bias)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    const sh = st.leaf?.geom
    this.drawPage({ side: -1, leaf: false, front: st.left, back: -1, flipF: 1, flipB: 0, shadow: sh, alpha: 1 })
    this.drawPage({ side: 1, leaf: false, front: st.right, back: -1, flipF: 0, flipB: 1, shadow: sh, alpha: 1 })
    if (st.fade) {
      this.drawPage({ side: -1, leaf: false, front: st.fade.left, back: -1, flipF: 1, flipB: 0, alpha: st.fade.t })
      this.drawPage({ side: 1, leaf: false, front: st.fade.right, back: -1, flipF: 0, flipB: 1, alpha: st.fade.t })
    }
    if (st.leaf) {
      const lf = st.leaf
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      const mirrored = lf.side < 0
      this.drawPage({ side: lf.side, leaf: true, front: lf.front, back: lf.back, flipF: mirrored ? 1 : 0, flipB: mirrored ? 0 : 1, geom: lf.geom, shadow: lf.geom, alpha: 1 })
      gl.disable(gl.DEPTH_TEST)
    }
  }
}
