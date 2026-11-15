// The driver: one Chrome and one local server per session; each page in a fresh tab on the fake clock
// (see inpage.mjs), loaded with a query string, stepped frame by frame.
import fs from 'node:fs';
import path from 'node:path';
import { sleep, launchChrome, startServer } from './browser.mjs';
import { pageScript } from './inpage.mjs';

// Hides the text and the controls over the hero (.fs: the full-screen button), and the scroll bar, from the first frame on.
export const HIDE_CSS = '.title,.panel,.hint,.fs{display:none !important}body{overflow:hidden}';
// The instant the fake Date starts from (2026-11-15 00:00 UTC; the time zone is UTC too).
export const EPOCH = Date.UTC(2026, 10, 15);
const READY_MS = +(process.env.SKY_READY_MS || 180000);

// Today: the load event. A page that loads in parts sets data-sky on an element: "loading" in its markup,
// "ready" when it can draw, "failed" if it cannot.
const READY = `(() => {
  const el = document.querySelector('[data-sky]'), v = el && el.dataset.sky;
  if (v === 'failed') return 'failed';
  return document.readyState === 'complete' && (!el || v === 'ready') ? 'ready' : '';
})()`;
const RENDERER = `(() => { const g = document.createElement('canvas').getContext('webgl2');
  const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()`;

export class Session {
  static async start() {
    const s = new Session();
    s.server = await startServer();
    s.chrome = await launchChrome();
    s.warm = s.chrome.renderer === 'swiftshader';
    return s;
  }

  // Opens ROOT/index.html + query in a new tab and waits until it is ready.
  // opt: { w, h, dpr, hide (default true), seed, epoch (null: the real Date), trace: frames or 0 }
  async open(root, query = '', opt = {}) {
    if (query && !query.startsWith('?')) query = '?' + query;
    const { targetId } = await this.chrome.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.chrome.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId, opt);
    try {
      await this.load(page, root, query, opt);
    } catch (err) {
      await page.close();
      throw err;
    }
    return page;
  }

  async load(page, root, query, opt) {
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Log.enable');
    await page.size(opt.w || 1280, opt.h || 720, false);
    await page.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript({
      seed: opt.seed ?? 1, epoch: opt.epoch === undefined ? EPOCH : opt.epoch,
      hideCss: opt.hide === false ? '' : HIDE_CSS, trace: opt.trace ? { frames: opt.trace } : null }) });
    page.url = this.server.url(root) + query;
    await page.send('Page.navigate', { url: page.url });
    const t0 = Date.now();
    for (;;) {
      await sleep(100);
      let r = '';
      try { r = await page.eval(READY); } catch {}
      if (r === 'ready') break;
      if (r === 'failed') throw new Error(`${page.url}: the page says data-sky="failed"\n${page.errors.join('\n')}`);
      if (Date.now() - t0 > READY_MS) throw new Error(`${page.url}: not ready after ${READY_MS} ms\n${page.errors.join('\n')}`);
    }
    // Let real frames of the browser pass, so that resize and intersection observers have run before the
    // first fake frame.
    await page.eval('document.fonts.ready.then(() => window.__realFrame()).then(() => window.__realFrame()).then(() => 0)');
    page.readyMs = Date.now() - t0;
  }

  // The WebGL renderer string, from a blank tab (a context in the page itself would show in its trace).
  async renderer() {
    if (!this._renderer) {
      const { targetId } = await this.chrome.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await this.chrome.send('Target.attachToTarget', { targetId, flatten: true });
      const r = await this.chrome.send('Runtime.evaluate', { expression: RENDERER, returnByValue: true }, sessionId);
      this._renderer = r.result.value;
      await this.chrome.send('Target.closeTarget', { targetId });
    }
    return this._renderer;
  }

  close() {
    this.server?.close();
    this.chrome?.close();
  }
}

class Page {
  constructor(session, targetId, sessionId, opt) {
    Object.assign(this, { session, targetId, sessionId, opt, errors: [], warnings: [] });
    this.handler = (m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params;
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      else if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert' || p.type === 'warning')) {
        (p.type === 'warning' ? this.warnings : this.errors).push(p.args.map((a) => a.value ?? a.description).join(' '));
      } else if (m.method === 'Log.entryAdded' && !/favicon\.ico$/.test(p.entry.url || '')) {
        if (p.entry.level === 'error') this.errors.push(`${p.entry.text} ${p.entry.url || ''}`.trim());
        else if (p.entry.level === 'warning') this.warnings.push(p.entry.text);
      }
    };
    session.chrome.on(this.handler);
  }

  send(method, params) { return this.session.chrome.send(method, params, this.sessionId); }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  // n frames of ms each, in chunks, so that one evaluate does not run for minutes on the CPU renderer.
  async step(n, ms = 50) {
    while (n > 0) {
      const k = Math.min(n, 5);
      await this.eval(`window.__step(${k}, ${ms})`);
      n -= k;
    }
  }

  async size(w, h, wait = true) {
    this.w = w;
    this.h = h;
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: this.opt.dpr || 1, mobile: false });
    if (wait) await this.eval('window.__realFrame().then(() => window.__realFrame()).then(() => 0)');
  }

  // A CDP Input.dispatchMouseEvent object: { type, x, y, button, buttons, clickCount }.
  mouse(event) { return this.send('Input.dispatchMouseEvent', event); }

  // A PNG of the viewport, or of clip { x, y, width, height }; written to file if given.
  async shot(file, clip) {
    if (!this.session.warm) {
      // The first picture of a fresh GPU Chrome has come back white (seen in a window, 2026-11): throw it away.
      await this.send('Page.captureScreenshot', { format: 'png' });
      this.session.warm = true;
    }
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const png = Buffer.from(r.data, 'base64');
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, png);
    }
    return png;
  }

  draws() { return this.eval('JSON.stringify(window.__draws)').then(JSON.parse); }
  trace() { return this.eval('window.__trace()').then(JSON.parse); }

  async close() {
    this.session.chrome.off(this.handler);
    await this.session.chrome.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}
