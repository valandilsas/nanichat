#!/usr/bin/env node
/**
 * Regenerates the REAL screenshots of the integrated tutorial (public/tutorial/<platform>/<step-id>.png) from a DEMO
 * instance with 100% fictitious data (fake provider, no network). Callouts (numbered orange outlines) are drawn in the
 * page right before each capture; they never change data.
 *
 *   node docs/manual/tools/capture-tutorial.mjs
 *
 * Safety: random free port (never 3000/3100), data dirs under /tmp, writes ONLY public/tutorial/<platform>/<step-id>.png
 * (see capture-guards.mjs). Facebook Pages are on by default in the app, so the demo server of the Instagram phase gets SOCIAL_DESK_FACEBOOK_PAGES=0 (Instagram-only discovery) and only the Facebook phase leaves them on.
 * Only the processes started here are stopped (by PID); temp dirs and the Chrome profile are removed at the end.
 * Env: CHROME_BIN, CAPTURE_DEBUG=1, TUTORIAL_CAPTURE_PORT (testing the guards), TUTORIAL_CAPTURE_DATA_PARENT (idem).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeDataDir, assertSafePort, assertTutorialOutput } from './capture-guards.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const DATA_PARENT = process.env.TUTORIAL_CAPTURE_DATA_PARENT || '/tmp';
const VIEW_W = 1200;
const VIEW_H = 800;
const SCALE = 1;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (message) => process.stdout.write(`[capture-tutorial] ${message}\n`);
const produced = [];

let PORT = 0;
let BASE = '';

const children = []; // { name, child }

function spawnTracked(name, command, args, options) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => { if (process.env.CAPTURE_DEBUG) process.stderr.write(`[${name}] ${chunk}`); });
  children.push({ name, child });
  return child;
}

async function stopChild(entry) {
  const { child } = entry;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

async function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); });
    server.on('error', fail);
  });
}

async function startServer(dataDir, extraEnv = {}) {
  const child = spawnTracked('demo-server', process.execPath, ['--import', 'tsx', 'docs/manual/tools/demo-server.ts'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), LOCAL_SOCIAL_DATA_DIR: dataDir, SOCIAL_DESK_FACEBOOK_PAGES: '0', ...extraEnv },
  });
  const entry = children.find((item) => item.child === child);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error('demo server exited early (run with CAPTURE_DEBUG=1)');
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return entry;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('demo server did not become ready');
}

async function runSeed(dataDir) {
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'docs/manual/tools/seed-demo.ts'], {
      cwd: ROOT, env: { ...process.env, LOCAL_SOCIAL_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('exit', (code) => { if (code === 0) { log(`seed: ${out.trim()}`); done(); } else fail(new Error(`seed failed: ${out}`)); });
  });
}

/* ------------------------------------ CDP ------------------------------------ */

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((done, fail) => { this.ws.addEventListener('open', done); this.ws.addEventListener('error', fail); });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: ok, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}`)); else ok(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((ok, reject) => {
      this.pending.set(id, { resolve: ok, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method) {
    return new Promise((done) => {
      const list = this.listeners.get(method) ?? [];
      const listener = (params) => { this.listeners.set(method, (this.listeners.get(method) ?? []).filter((item) => item !== listener)); done(params); };
      list.push(listener);
      this.listeners.set(method, list);
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}


// Page-side helpers (installed on every document).
const PAGE_HELPERS = `
(() => {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
  window.__h = {
    find(selector, wanted, exact = true) {
      return [...document.querySelectorAll(selector)].filter(visible).find((el) => exact ? text(el) === wanted : text(el).includes(wanted)) || null;
    },
    click(selector, wanted, exact = true) {
      const el = this.find(selector, wanted, exact);
      if (!el) throw new Error('not found: ' + selector + ' ' + wanted);
      el.scrollIntoView({ block: 'center' }); el.click(); return true;
    },
    field(label) {
      return [...document.querySelectorAll('label.field')].filter(visible).find((l) => { const s = l.querySelector(':scope > span'); return s && text(s).startsWith(label); }) || null;
    },
    control(label) { const f = this.field(label); return f ? f.querySelector('input, select, textarea') : null; },
    focus(label) {
      const el = this.control(label);
      if (!el) throw new Error('no control: ' + label);
      el.scrollIntoView({ block: 'center' }); el.focus(); if (el.select) el.select(); return true;
    },
    setSelect(el, value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
    },
    busy() { return !!document.querySelector('.loading-line'); },
    errorToast() { const el = document.querySelector('.toast.error'); return el ? text(el) : ''; },
    dismissToasts() { document.querySelectorAll('.toast button').forEach((b) => b.click()); },
    hide(selector) { document.querySelectorAll(selector).forEach((el) => { el.style.display = 'none'; }); },
    rect(el) { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; },
    /** Numbered callout: orange rounded outline around el plus a numbered badge on its top-left corner. */
    mark(el, number, pad = 5) {
      const r = this.rect(el);
      const box = document.createElement('div');
      box.setAttribute('data-callout', String(number));
      box.style.cssText = 'position:absolute;pointer-events:none;z-index:99999;box-sizing:border-box;border:3px solid #d9480f;border-radius:10px;'
        + 'left:' + (r.x - pad) + 'px;top:' + (r.y - pad) + 'px;width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px;';
      const badge = document.createElement('div');
      badge.textContent = String(number);
      badge.style.cssText = 'position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:#d9480f;color:#fff;'
        + 'font:700 15px/26px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35);';
      box.appendChild(badge);
      document.body.appendChild(box);
      return true;
    },
    clearMarks() { document.querySelectorAll('[data-callout]').forEach((el) => el.remove()); },
  };
})();
`;

/* --------------------------------- browser driver --------------------------------- */

class Browser {
  async launch() {
    const debugPort = await freePort();
    this.profile = mkdtempSync(join(DATA_PARENT, 'social-tutorial-chrome-'));
    spawnTracked('chrome', CHROME, [
      '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${this.profile}`,
      `--window-size=${VIEW_W},${VIEW_H}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
      '--disable-extensions', '--disable-background-networking', '--lang=es-CO', '--accept-lang=es-CO,es', '--mute-audio',
      '--disable-features=Translate', 'about:blank',
    ], {});
    let target;
    for (let attempt = 0; attempt < 60 && !target; attempt++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        target = list.find((item) => item.type === 'page');
      } catch { /* not ready */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome DevTools endpoint not available');
    this.cdp = new Cdp(target.webSocketDebuggerUrl);
    await this.cdp.ready;
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });
    await this.cdp.send('Emulation.setLocaleOverride', { locale: 'es-CO' }).catch(() => {});
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: SCALE, mobile: false });
  }

  async eval(expression) {
    const result = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async goto(url) {
    const loaded = this.cdp.once('Page.loadEventFired');
    await this.cdp.send('Page.navigate', { url });
    await loaded;
    await this.waitFor('!!document.querySelector("main.page")');
  }

  async waitFor(expression, timeout = 30000, label = expression) {
    const started = Date.now();
    for (;;) {
      let value = false;
      try { value = await this.eval(`!!(${expression})`); } catch { value = false; }
      if (value) return value;
      if (Date.now() - started > timeout) throw new Error(`Timed out waiting for: ${label}`);
      await sleep(120);
    }
  }

  async settle() {
    await this.waitFor('!window.__h.busy()', 30000, 'data loaded');
    await sleep(500);
  }

  click(selector, text, exact = true) { return this.eval(`window.__h.click(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${exact})`); }
  nav(label) { return this.click('nav button', label); }

  async fill(label, value) {
    await this.eval(`window.__h.focus(${JSON.stringify(label)})`);
    await this.cdp.send('Input.insertText', { text: value });
  }

  /**
   * Draws numbered callouts and saves public/tutorial/<platform>/<id>.png cropped to the union of `region` elements
   * (JS expressions returning elements) plus `pad` px. `marks` = [JS expression returning an element, ...] numbered 1..n.
   */
  async shot(platform, id, { region, marks = [], pad = 24, padX = pad, maxHeight = 900 }) {
    const output = assertTutorialOutput(ROOT, platform, id);
    await this.eval('window.__h.dismissToasts(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); window.scrollTo(0, 0); window.__h.clearMarks();');
    const problem = await this.eval('window.__h.errorToast()');
    if (problem) throw new Error(`Error toast on screen: ${problem}`);
    await sleep(250);
    for (const [index, expression] of marks.entries()) {
      const ok = await this.eval(`(() => { const el = (${expression}); if (!el) return false; return window.__h.mark(el, ${index + 1}); })()`);
      if (!ok) throw new Error(`${platform}/${id}: callout target ${index + 1} not found`);
    }
    const boxes = await this.eval(`[${region.map((expression) => `(${expression})`).join(',')}].map((el) => el ? window.__h.rect(el) : null)`);
    if (boxes.some((box) => !box)) throw new Error(`${platform}/${id}: region element not found`);
    const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padX);
    const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - pad);
    const right = Math.min(VIEW_W, Math.max(...boxes.map((box) => box.x + box.width)) + padX);
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + pad;
    const height = Math.min(bottom - top, maxHeight);
    const pageHeight = await this.eval('Math.ceil(document.documentElement.scrollHeight)');
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: Math.max(VIEW_H, Math.ceil(top + height), pageHeight), deviceScaleFactor: SCALE, mobile: false });
    await sleep(350);
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: left, y: top, width: right - left, height, scale: 1 } });
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: SCALE, mobile: false });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, Buffer.from(data, 'base64'));
    produced.push(output);
    log(`saved ${platform}/${id}.png (${statSync(output).size} bytes)`);
    await this.eval('window.__h.clearMarks()');
  }

  close() { this.cdp?.close(); }
}

/* ------------------------------------ scenarios ------------------------------------ */

const FAKE_TOKEN = 'DEMO-TOKEN-NOT-REAL';
const HIDE_TUTORIAL = 'window.__h.hide(".tutorial-block")';
const FORM = '[...document.querySelectorAll("form.form-panel")].find((f) => f.querySelector("h3")?.textContent === "Nueva conexión")';
const field = (label) => `window.__h.field(${JSON.stringify(label)})`;
const button = (text, exact = true) => `window.__h.find("button", ${JSON.stringify(text)}, ${exact})`;

async function openConnections(browser) {
  await browser.goto(BASE);
  await browser.waitFor('window.__h.find("button.mode-pill", "Dry Run · Activo")');
  await browser.nav('Conexiones');
  await browser.waitFor('document.getElementById("conn-name")');
  await browser.settle();
}

async function instagramPhase(browser) {
  log('Instagram: fresh demo data');
  await openConnections(browser);
  await browser.fill('Nombre', 'Cuenta principal');
  await browser.fill('Token de acceso', FAKE_TOKEN);
  await browser.eval(HIDE_TUTORIAL);
  await browser.shot('instagram', 'pegar-token', {
    region: [FORM], padX: 12,
    marks: [field('Tipo de acceso'), field('Token de acceso'), button('Guardar conexión cifrada')],
  });
  await browser.click('button', 'Guardar conexión cifrada');
  await browser.waitFor('window.__h.find("button", "Probar y descubrir")');
  await browser.settle();
  await browser.click('button', 'Probar y descubrir');
  await browser.waitFor('window.__h.find("strong", "@tu_otra_cuenta") && window.__h.find("span.status-badge", "Validada", false)', 30000, 'discovered accounts');
  await browser.settle();
  await browser.eval(HIDE_TUTORIAL);
  await browser.shot('instagram', 'probar-descubrir', {
    region: [`document.querySelector("#conn-title").closest("section")`, `document.querySelector(".conn-columns")`],
    marks: [button('Probar y descubrir'), `[...document.querySelectorAll(".list-row")].find((r) => r.textContent.includes("@tu_cuenta") && !r.textContent.includes("@tu_otra") && r.querySelector("button")).querySelector("button")`],
  });
}

async function facebookPhase(browser) {
  log('Facebook: fresh demo data, Pages enabled in the demo process only');
  await openConnections(browser);
  await browser.fill('Nombre', 'Mi Página de Facebook');
  await browser.eval(`window.__h.setSelect(window.__h.control('Tipo de acceso'), 'facebook_login')`);
  await browser.waitFor('document.querySelector("[aria-label=\\"Ayuda de Facebook Login\\"]")');
  await browser.fill('Token de acceso', FAKE_TOKEN);
  await browser.eval(HIDE_TUTORIAL);
  await browser.shot('facebook', 'pegar-token', {
    region: [FORM], padX: 12,
    marks: [field('Tipo de acceso'), field('Token de acceso'), `document.querySelector("[aria-label=\\"Ayuda de Facebook Login\\"]")`, button('Guardar conexión cifrada')],
  });
  await browser.click('button', 'Guardar conexión cifrada');
  await browser.waitFor('window.__h.find("button", "Probar y descubrir")');
  await browser.settle();
  await browser.click('button', 'Probar y descubrir');
  await browser.waitFor('window.__h.find("strong", "Tu Página de ejemplo") && window.__h.find("span.status-badge", "Validada", false)', 30000, 'discovered Page');
  await browser.settle();
  await browser.eval(HIDE_TUTORIAL);
  await browser.shot('facebook', 'probar-seleccionar', {
    region: [`document.querySelector("#conn-title").closest("section")`, `document.querySelector(".conn-columns")`],
    marks: [button('Probar y descubrir'), `[...document.querySelectorAll(".list-row")].find((r) => r.textContent.includes("Tu Página de ejemplo") && r.querySelector("button")).querySelector("button")`],
  });
}

async function reviewPhase(browser) {
  log('Instagram: seeded demo data (Revisión pendiente)');
  await browser.goto(BASE);
  await browser.waitFor('window.__h.find("button.mode-pill", "Dry Run · Activo")');
  await browser.waitFor('[...document.querySelectorAll("select[aria-label=\\"Filtrar por cuenta\\"] option")].some((o) => o.textContent === "@tu_cuenta")');
  await browser.eval(`(() => { const s = document.querySelector('select[aria-label="Filtrar por cuenta"]'); const o = [...s.options].find((x) => x.textContent === '@tu_cuenta'); window.__h.setSelect(s, o.value); return true; })()`);
  await browser.settle();
  await browser.nav('Revisión pendiente');
  await browser.waitFor('window.__h.find("span.count-badge", "6 pendientes")', 30000, '6 pending');
  await browser.settle();
  await browser.eval(`window.__h.setSelect(window.__h.control('Ventana'), '7d')`);
  await browser.click('button#backlog-start', 'Iniciar análisis');
  await browser.waitFor('document.querySelector(".scan-summary")', 60000, 'scan summary');
  await browser.waitFor('window.__h.find("span.count-badge", "6 pendientes")', 30000, '6 pending after analysis');
  await browser.settle();
  await browser.shot('instagram', 'comprobar-revision', {
    region: [`document.querySelector(".analyze-panel")`, `document.querySelector(".pending-review > .section-h")`, `document.querySelector(".pending-review > .section-h + *")`],
    marks: [field('Ventana'), `document.getElementById("backlog-start")`, `document.querySelector(".scan-summary")`, `document.querySelector(".pending-review .count-badge")`],
    maxHeight: 900,
  });
}

/* -------------------------------------- main -------------------------------------- */

async function main() {
  PORT = process.env.TUTORIAL_CAPTURE_PORT ? Number(process.env.TUTORIAL_CAPTURE_PORT) : await freePort();
  assertSafePort(PORT);
  assertSafeDataDir(join(DATA_PARENT, 'probe'));
  BASE = `http://127.0.0.1:${PORT}`;
  const dirs = [];
  const browser = new Browser();
  try {
    await browser.launch();
    const newDir = (name) => { const dir = assertSafeDataDir(mkdtempSync(join(DATA_PARENT, `social-tutorial-${name}-`))); dirs.push(dir); return dir; };

    const serverA = await startServer(newDir('a'));
    await instagramPhase(browser);
    await stopChild(serverA);

    const serverC = await startServer(newDir('c'), { SOCIAL_DESK_FACEBOOK_PAGES: '1' });
    await facebookPhase(browser);
    await stopChild(serverC);

    const dirB = newDir('b');
    await runSeed(dirB);
    const serverB = await startServer(dirB);
    await reviewPhase(browser);
    await stopChild(serverB);
  } finally {
    browser.close();
    for (const entry of [...children].reverse()) await stopChild(entry);
    await sleep(300);
    for (const dir of [...dirs, browser.profile].filter(Boolean)) rmSync(dir, { recursive: true, force: true });
  }
  log(`done: ${produced.length} images`);
}

main().catch((error) => {
  process.stderr.write(`[capture-tutorial] FAILED: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
