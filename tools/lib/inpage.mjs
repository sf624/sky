// The script that runs in the page before any of its own code (Page.addScriptToEvaluateOnNewDocument).
// install() is serialised with toString(), so it must not use anything from this module but its arguments.

// A 64-bit hash of bytes, in 32-bit words: an FNV-1a lane and a MurmurHash3 lane, each finished by Murmur's
// mixer. Not cryptographic: it tells uploads, read-backs and shader texts apart. Used in the page and in Node.
export function hashBytes(u8) {
  let a = 0x811c9dc5, b = 0x9e3779b9 ^ u8.length;
  const n = u8.length >> 2;
  const words = u8.byteOffset % 4 === 0 ? new Uint32Array(u8.buffer, u8.byteOffset, n) : null;
  const add = (x) => {
    a = Math.imul(a ^ x, 0x01000193);
    let k = Math.imul(x, 0xcc9e2d51);
    k = Math.imul((k << 15) | (k >>> 17), 0x1b873593);
    b ^= k;
    b = (Math.imul((b << 13) | (b >>> 19), 5) + 0xe6546b64) | 0;
  };
  for (let i = 0; i < n; i++) add(words ? words[i] : (u8[4 * i] | u8[4 * i + 1] << 8 | u8[4 * i + 2] << 16 | u8[4 * i + 3] << 24));
  for (let i = n * 4; i < u8.length; i++) add(u8[i]);
  const mix = (h) => {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0).toString(16).padStart(8, '0');
  };
  return mix(a) + mix(b);
}

// cfg: { seed, epoch (ms since 1970 for Date, or null for the real clock), hideCss, trace: { frames } or null }
function install(cfg, hashBytes) {
  // ---- The fake clock: performance.now and requestAnimationFrame advance only through __step. ----
  let now = 1000, frame = 0;
  const cbs = [];
  let seed = cfg.seed >>> 0;
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const realRaf = window.requestAnimationFrame.bind(window);
  // Resolves after a real frame of the browser (layout, observers): the page's own frames are fake.
  window.__realFrame = () => new Promise((r) => realRaf(() => r()));
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
  window.cancelAnimationFrame = () => {};
  window.__pending = () => cbs.length;
  // Date follows the fake clock from a fixed instant: the page reads the date for its default day, and the wall
  // clock for the frame time that sets its drawing size. With the real clock, both would change between runs.
  if (cfg.epoch !== null) {
    const RealDate = Date;
    const fakeNow = () => cfg.epoch + (now - 1000);
    const FakeDate = function (...a) {
      if (!new.target) return new RealDate(fakeNow()).toString();
      return a.length ? new RealDate(...a) : new RealDate(fakeNow());
    };
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = fakeNow;
    FakeDate.UTC = RealDate.UTC;
    FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }
  try { localStorage.clear(); } catch {}
  if (cfg.hideCss) {
    addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = cfg.hideCss;
      document.head.appendChild(st);
    });
  }

  // ---- WebGL: draw counts (always), and the trace (when asked). ----
  const P = WebGL2RenderingContext.prototype;
  const O = {};
  for (const n of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, n);
    if (typeof d.value === 'function' && n !== 'constructor') O[n] = d.value;
  }
  const canvasNames = new Map();
  const nameOf = (canvas) => {
    if (!canvasNames.has(canvas)) canvasNames.set(canvas, canvas.id || 'canvas' + (canvasNames.size + 1));
    return canvasNames.get(canvas);
  };
  // Per context: the bound framebuffers and the viewport, kept by hooks (so no getParameter is needed).
  const S = new WeakMap();
  const st = (gl) => {
    let s = S.get(gl);
    if (!s) S.set(gl, s = { drawFb: null, readFb: null, vp: null, unit: 0, units: [], att: new Map(), bufs: new Map(),
      tex: new Map(), dirty: new Map(), screen: false, ids: new Map(), count: {}, locs: new Map(), fbo: null });
    return s;
  };
  // window.__draws[canvas] = { screen, offscreen, size }: draw calls to the canvas, to framebuffers, and the
  // viewport of the last offscreen draw (the size the picture is drawn at).
  const draws = window.__draws = {};
  const countDraw = (gl) => {
    const s = st(gl), name = nameOf(gl.canvas);
    const d = draws[name] || (draws[name] = { screen: 0, offscreen: 0, size: '' });
    if (s.drawFb) {
      d.offscreen++;
      const vp = s.vp || [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight];
      d.size = vp[2] + 'x' + vp[3];
    } else d.screen++;
  };

  const T = { on: !!cfg.trace, logs: new Map(), sources: {} };
  const log = (canvas) => {
    let l = T.logs.get(canvas);
    if (!l) T.logs.set(canvas, l = []);
    return l;
  };
  const rec = (canvas, text) => { if (T.on) log(canvas).push([frame, text]); };

  // Enum names, for the arguments that are enums (by method and position).
  const ENUM = {};
  for (const k of Object.keys(WebGL2RenderingContext)) {
    const v = WebGL2RenderingContext[k];
    if (typeof v === 'number' && /^[A-Z0-9_]+$/.test(k) && !(v in ENUM)) ENUM[v] = k;
  }
  const POS = {
    activeTexture: [0], bindBuffer: [0], bindFramebuffer: [0], bindRenderbuffer: [0], bindTexture: [0],
    blendEquation: [0], blendEquationSeparate: [0, 1], blendFunc: [0, 1], blendFuncSeparate: [0, 1, 2, 3],
    bufferData: [0, 2], bufferSubData: [0], checkFramebufferStatus: [0], cullFace: [0], depthFunc: [0], disable: [0],
    enable: [0], drawArrays: [0], drawArraysInstanced: [0], drawElements: [0, 2], drawBuffers: [0],
    framebufferTexture2D: [0, 1, 2], framebufferTextureLayer: [0, 1], framebufferRenderbuffer: [0, 1, 2], frontFace: [0],
    generateMipmap: [0], getParameter: [0], getProgramParameter: [1], getShaderParameter: [1], hint: [0, 1],
    pixelStorei: [0], readBuffer: [0], readPixels: [4, 5], renderbufferStorage: [0, 1], texParameteri: [0, 1, 2],
    texParameterf: [0, 1], texStorage2D: [0, 2], texStorage3D: [0, 2], createShader: [0], vertexAttribPointer: [2],
    vertexAttribIPointer: [2], getShaderPrecisionFormat: [0, 1], invalidateFramebuffer: [0, 1], blitFramebuffer: [9],
    getTexParameter: [0, 1], getFramebufferAttachmentParameter: [0, 1, 2], beginQuery: [0], endQuery: [0],
    getQueryParameter: [1], samplerParameteri: [1, 2], stencilFunc: [0], stencilOp: [0, 1, 2], clearBufferfv: [0],
  };
  const enumPos = (m, n) => {
    if (m === 'texImage2D') return n >= 8 ? [0, 2, 6, 7] : [0, 2, 3, 4];
    if (m === 'texSubImage2D') return n >= 8 ? [0, 6, 7] : [0, 4, 5];
    if (m === 'texImage3D') return [0, 2, 7, 8];
    if (m === 'texSubImage3D') return [0, 8, 9];
    return POS[m] || [];
  };
  // The shortest decimal that gives the same 32-bit float: what the GPU receives.
  const f32 = (v) => {
    const x = Math.fround(v);
    if (Object.is(x, -0)) return '-0';
    if (!isFinite(x)) return String(x);
    for (let p = 1; p < 10; p++) { const t = x.toPrecision(p); if (Math.fround(+t) === x) return String(+t); }
    return String(x);
  };
  const MODES = ['POINTS', 'LINES', 'LINE_LOOP', 'LINE_STRIP', 'TRIANGLES', 'TRIANGLE_STRIP', 'TRIANGLE_FAN'];
  const num = (v, isEnum, m) => {
    if (isEnum && m && m.startsWith('draw') && MODES[v]) return MODES[v];
    if (isEnum && Number.isInteger(v) && v >= 0x100 && ENUM[v]) return ENUM[v];
    return Number.isInteger(v) ? String(v) : f32(v);
  };
  const KIND = { WebGLShader: 'shader', WebGLProgram: 'prog', WebGLTexture: 'tex', WebGLFramebuffer: 'fb',
    WebGLBuffer: 'buf', WebGLVertexArrayObject: 'vao', WebGLQuery: 'query', WebGLRenderbuffer: 'rb',
    WebGLSampler: 'sampler', WebGLSync: 'sync', WebGLTransformFeedback: 'xfb' };
  const idOf = (gl, o) => {
    const s = st(gl);
    let id = s.ids.get(o);
    if (!id) {
      const k = KIND[o.constructor.name] || o.constructor.name;
      s.count[k] = (s.count[k] || 0) + 1;
      s.ids.set(o, id = k + s.count[k]);
    }
    return id;
  };
  const bytes = (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  const textHash = (t) => hashBytes(new TextEncoder().encode(t));
  const fmt = (gl, m, i, v, isEnum) => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return num(v, isEnum, i === 0 && m);
    if (typeof v === 'string') return JSON.stringify(v);
    if (v instanceof WebGLUniformLocation) return st(gl).locs.get(v) || 'location?';
    if (v.constructor && KIND[v.constructor.name]) return idOf(gl, v);
    if (ArrayBuffer.isView(v) || Array.isArray(v)) {
      const n = v.length;
      if (Array.isArray(v) || n <= 16) return '[' + Array.from(v, (x) => (typeof x === 'number' ? num(x, isEnum) : String(x))).join(', ') + ']';
      return `${v.constructor.name}(${n}) #${hashBytes(bytes(v))}`;
    }
    if (v instanceof ArrayBuffer) return `ArrayBuffer(${v.byteLength}) #${hashBytes(new Uint8Array(v))}`;
    return v.constructor ? v.constructor.name : typeof v;
  };
  const result = (gl, r) => {
    if (r === undefined) return '';
    if (r && typeof r === 'object' && !ArrayBuffer.isView(r) && !Array.isArray(r) && !KIND[r.constructor.name]
      && !(r instanceof WebGLUniformLocation)) return ' = ' + (r.constructor.name === 'Object' ? 'object' : r.constructor.name);
    return ' = ' + fmt(gl, '', -1, r, false);
  };

  // The textures a draw writes to: the colour attachments of the bound framebuffer named by its draw buffers.
  const markDraw = (gl) => {
    const s = st(gl);
    if (!s.drawFb) { s.screen = true; return; }
    const att = s.att.get(s.drawFb) || {};
    const bufs = s.bufs.get(s.drawFb) || [gl.COLOR_ATTACHMENT0];
    for (const b of bufs) {
      const a = att[b];
      if (!a) continue;
      const key = idOf(gl, a.tex) + ' level ' + a.level;
      const d = s.dirty.get(key) || { tex: a.tex, level: a.level, layers: new Set() };
      d.layers.add(a.layer);
      s.dirty.set(key, d);
    }
  };
  // Reads back what the frame drew (textures and the canvas) and logs a hash of each. Uses the unwrapped
  // functions, its own framebuffer, and restores the read binding, so the page's state is left as it was.
  const readBack = (gl) => {
    const s = st(gl);
    O.getError.call(gl);
    if (s.dirty.size) {
      if (!s.fbo) s.fbo = O.createFramebuffer.call(gl);
      O.bindFramebuffer.call(gl, gl.READ_FRAMEBUFFER, s.fbo);
      O.readBuffer.call(gl, gl.COLOR_ATTACHMENT0);
      for (const [key, d] of [...s.dirty].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        const info = s.tex.get(d.tex);
        if (!info) { rec(gl.canvas, `readback ${key} unknown size`); continue; }
        const w = Math.max(1, info.w >> d.level), h = Math.max(1, info.h >> d.level);
        const byte = info.fmt === gl.RGBA8 || info.fmt === gl.RGBA;
        const parts = [];
        let ok = true;
        for (const layer of [...d.layers].sort((x, y) => x - y)) {
          if (layer === null) O.framebufferTexture2D.call(gl, gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, d.tex, d.level);
          else O.framebufferTextureLayer.call(gl, gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, d.tex, d.level, layer);
          const buf = byte ? new Uint8Array(w * h * 4) : new Float32Array(w * h * 4);
          O.readPixels.call(gl, 0, 0, w, h, gl.RGBA, byte ? gl.UNSIGNED_BYTE : gl.FLOAT, buf);
          if (O.getError.call(gl)) ok = false;
          parts.push(hashBytes(bytes(buf)));
        }
        O.framebufferTexture2D.call(gl, gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        const layers = d.layers.has(null) ? '' : ` layers ${d.layers.size}`;
        const h1 = parts.length === 1 ? parts[0] : textHash(parts.join(''));
        rec(gl.canvas, `readback ${key} ${ENUM[info.fmt] || info.fmt} ${w}x${h}${layers} = ${ok ? '#' + h1 : 'unreadable'}`);
      }
      O.bindFramebuffer.call(gl, gl.READ_FRAMEBUFFER, s.readFb);
      s.dirty.clear();
    }
    if (s.screen) {
      O.bindFramebuffer.call(gl, gl.READ_FRAMEBUFFER, null);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
      O.readPixels.call(gl, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      O.bindFramebuffer.call(gl, gl.READ_FRAMEBUFFER, s.readFb);
      rec(gl.canvas, `readback canvas ${w}x${h} = #${hashBytes(buf)}`);
      s.screen = false;
    }
  };
  const contexts = new Set();
  const endFrame = () => {
    if (T.on) for (const gl of contexts) if (!O.isContextLost.call(gl)) readBack(gl);
    frame++;
    if (cfg.trace && frame > cfg.trace.frames) T.on = false;
  };

  const DRAWS = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi']);
  for (const m of Object.keys(O)) {
    const orig = O[m];
    P[m] = function (...a) {
      const s = st(this);
      contexts.add(this);
      let text = null;
      if (T.on) {
        const pos = enumPos(m, a.length);
        const args = a.map((v, i) => {
          if (m === 'shaderSource' && i === 1) {
            const h = textHash(v);
            T.sources[h] = v;
            return 'src:' + h;
          }
          return fmt(this, m, i, v, pos.includes(i));
        });
        text = m + '(' + args.join(', ') + ')';
      }
      const r = orig.apply(this, a);
      // Keep the state the read-back and the draw counts need.
      if (m === 'bindFramebuffer') {
        if (a[0] === this.FRAMEBUFFER || a[0] === this.DRAW_FRAMEBUFFER) s.drawFb = a[1];
        if (a[0] === this.FRAMEBUFFER || a[0] === this.READ_FRAMEBUFFER) s.readFb = a[1];
      } else if (m === 'viewport') s.vp = a.slice(0, 4);
      else if (m === 'activeTexture') s.unit = a[0] - this.TEXTURE0;
      else if (m === 'bindTexture') (s.units[s.unit] || (s.units[s.unit] = {}))[a[0]] = a[1];
      else if (m === 'texStorage2D' || m === 'texStorage3D' || ((m === 'texImage2D' || m === 'texImage3D') && a[1] === 0 && a.length >= 8)) {
        const tex = (s.units[s.unit] || {})[a[0]];
        if (tex) s.tex.set(tex, { fmt: a[2], w: a[3], h: a[4] });
      } else if (m === 'framebufferTexture2D' || m === 'framebufferTextureLayer') {
        const fb = a[0] === this.READ_FRAMEBUFFER ? s.readFb : s.drawFb;
        if (fb) {
          const att = s.att.get(fb) || {};
          att[a[1]] = m === 'framebufferTexture2D' ? (a[3] ? { tex: a[3], level: a[4], layer: null } : null)
            : (a[2] ? { tex: a[2], level: a[3], layer: a[4] } : null);
          s.att.set(fb, att);
        }
      } else if (m === 'drawBuffers') { if (s.drawFb) s.bufs.set(s.drawFb, [...a[0]]); }
      else if (m === 'getUniformLocation' && r) s.locs.set(r, idOf(this, a[0]) + '.' + a[1]);
      if (DRAWS.has(m)) {
        if (m.startsWith('draw')) countDraw(this);
        if (T.on) markDraw(this);
      }
      if (text !== null) rec(this.canvas, text + result(this, r));
      return r;
    };
  }
  // Context creation and changes of the canvas size belong to the trace too.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const gl = getContext.call(this, type, attrs);
    if (gl instanceof WebGL2RenderingContext) contexts.add(gl);
    rec(this, `getContext(${JSON.stringify(type)}, ${JSON.stringify(attrs || {})})${gl ? '' : ' = null'}`);
    return gl;
  };
  for (const k of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
    Object.defineProperty(HTMLCanvasElement.prototype, k, { ...d, set(v) { rec(this, `canvas.${k} = ${v}`); d.set.call(this, v); } });
  }

  // Steps n frames of ms each: every queued callback runs with the new time. Frame 0 of the trace is all
  // that happens before the first step; frame k ends after the callbacks of step k.
  window.__step = (n, ms) => {
    for (let i = 0; i < n; i++) {
      if (frame === 0) endFrame();
      now += ms;
      for (const cb of cbs.splice(0)) {
        try { cb(now); } catch (e) { setTimeout(() => { throw e; }); }
      }
      endFrame();
    }
    return now;
  };
  window.__trace = () => {
    const canvases = [];
    for (const [canvas, lines] of T.logs) canvases.push({ name: nameOf(canvas), lines });
    return JSON.stringify({ frames: cfg.trace ? cfg.trace.frames : 0, canvases, sources: T.sources });
  };
}

export const pageScript = (cfg) => `(${install.toString()})(${JSON.stringify(cfg)}, ${hashBytes.toString()});`;
