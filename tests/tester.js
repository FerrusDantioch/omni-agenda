'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ics': 'text/calendar; charset=utf-8',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toHHMM(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function removeDirWithRetry(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return;
  for (let i = 0; i < 6; i += 1) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch {
      if (i < 5) {
        const until = Date.now() + 150;
        while (Date.now() < until) { /* brief sync wait on Windows file lock */ }
      }
    }
  }
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// =====================================================================
// Static HTTP server (127.0.0.1:0)
// =====================================================================

function startServer(rootDir) {
  let serverOffline = false;
  let offlineHitUrls = [];
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    if (serverOffline) {
      offlineHitUrls.push(req.url);
      req.socket.destroy();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let pathname;
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      pathname = decodeURIComponent(parsed.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (pathname === '/') pathname = '/index.html';

    const segments = pathname.split('/').filter(Boolean);
    if (segments.some((seg) => seg.startsWith('.') || seg === '..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const absPath = path.resolve(rootDir, ...segments);
    if (absPath !== rootDir && !absPath.startsWith(rootDir + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (pathname === '/sw.js') {
      headers['Service-Worker-Allowed'] = '/';
    }

    const body = fs.readFileSync(absPath);
    headers['Content-Length'] = String(body.length);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        setServerOffline(value) {
          serverOffline = Boolean(value);
        },
        resetOfflineHits() {
          offlineHitUrls = [];
        },
        getOfflineHits() {
          return [...offlineHitUrls];
        },
        async close() {
          for (const socket of sockets) socket.destroy();
          server.closeAllConnections?.();
          await new Promise((resClose) => server.close(() => resClose()));
        },
      });
    });
  });
}

// =====================================================================
// Chromium binary discovery + CDP WebSocket driver (fallback when Playwright absent)
// =====================================================================

function findChromiumExecutable() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }

  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files (x86)\\Microsoft\\EdgeCore\\157.0.4341.60\\msedge.exe');
    const edgeCoreDir = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';
    if (fs.existsSync(edgeCoreDir)) {
      try {
        for (const sub of fs.readdirSync(edgeCoreDir)) {
          candidates.push(path.join(edgeCoreDir, sub, 'msedge.exe'));
        }
      } catch {
        // Ignore directory read error
      }
    }
    candidates.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform !== 'win32') {
    for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'microsoft-edge']) {
      try {
        const out = execFileSync('which', [bin], { encoding: 'utf8' }).trim();
        if (out && fs.existsSync(out)) return out;
      } catch {
        // Ignore missing binary
      }
    }
  }
  return null;
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionListeners = new Map();
    this.globalListeners = new Map();

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString('utf8'));
      if (msg.id) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message} (${msg.error.code})`));
        } else {
          entry.resolve(msg.result || {});
        }
        return;
      }
      if (msg.method) {
        if (msg.sessionId) {
          const map = this.sessionListeners.get(msg.sessionId);
          const fns = map?.get(msg.method);
          if (fns) {
            for (const fn of fns) fn(msg.params || {});
          }
        }
        const gFns = this.globalListeners.get(msg.method);
        if (gFns) {
          for (const fn of gFns) fn(msg.params || {}, msg.sessionId || null);
        }
      }
    });

    ws.addEventListener('close', () => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error(`CDP WebSocket closed while waiting for ${entry.method}`));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(sessionId, method, fn) {
    if (!sessionId) {
      if (!this.globalListeners.has(method)) this.globalListeners.set(method, new Set());
      this.globalListeners.get(method).add(fn);
      return () => this.globalListeners.get(method)?.delete(fn);
    }
    if (!this.sessionListeners.has(sessionId)) this.sessionListeners.set(sessionId, new Map());
    const map = this.sessionListeners.get(sessionId);
    if (!map.has(method)) map.set(method, new Set());
    map.get(method).add(fn);
    return () => map.get(method)?.delete(fn);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore
    }
  }
}

async function launchCdpDriver({ baseOrigin, tmpRoot, externalRequests, consoleErrors }) {
  const exe = findChromiumExecutable();
  if (!exe) {
    throw new Error('Aucun navigateur Chromium (Edge/Brave/Chrome) trouvé sur la machine.');
  }

  const userDataDir = path.join(tmpRoot, 'cdp-profile');
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-gpu',
    '--disable-features=Translate',
    'about:blank',
  ];

  const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let stderrBuf = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timeout démarrage Chromium CDP (${exe}): ${stderrBuf}`));
    }, 15000);

    const onChunk = (chunk) => {
      stderrBuf += chunk.toString('utf8');
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderrBuf);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    proc.stderr.on('data', onChunk);
    proc.stdout.on('data', onChunk);
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium s'est arrêté prématurément (code ${code}): ${stderrBuf}`));
    });
  });

  if (typeof WebSocket !== 'function') {
    throw new Error('Node WebSocket global indisponible dans cette version de Node.');
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout connexion WebSocket CDP')), 10000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Erreur WebSocket CDP: ${err.message || err}`));
    }, { once: true });
  });

  const cdp = new CdpClient(ws);
  let ctxCounter = 0;
  const activeContexts = new Set();

  function wrapCdpPage({ sessionId, targetId, browserContextId, ctxDownloadDir, downloadsMap, isOfflineRef, expectOfflineErrorsRef }) {
    let closed = false;
    let loadResolvers = [];

    cdp.on(sessionId, 'Page.loadEventFired', () => {
      const pending = loadResolvers;
      loadResolvers = [];
      for (const res of pending) res();
    });

    cdp.on(sessionId, 'Runtime.exceptionThrown', (params) => {
      const desc = params.exceptionDetails?.exception?.description
        || params.exceptionDetails?.text
        || 'Uncaught exception';
      consoleErrors.push(`[pageerror] ${desc}`);
    });

    cdp.on(sessionId, 'Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error') return;
      const text = (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (expectOfflineErrorsRef.value && /ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to load resource/i.test(text)) {
        return;
      }
      consoleErrors.push(`[console.error] ${text}`);
    });

    cdp.on(sessionId, 'Page.javascriptDialogOpening', (params) => {
      consoleErrors.push(`[native-dialog] ${params.type}: ${params.message}`);
      cdp.send('Page.handleJavaScriptDialog', { accept: false }, sessionId).catch(() => {});
    });

    cdp.on(sessionId, 'Fetch.requestPaused', ({ requestId, request }) => {
      const url = request.url || '';
      const allowed = url.startsWith(baseOrigin) || url.startsWith('blob:') || url.startsWith('data:') || url === 'about:blank';
      if (!allowed) {
        externalRequests.push(url);
        cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
      } else {
        cdp.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
      }
    });

    const handleDownloadBegin = (params) => {
      if (params.guid) {
        downloadsMap.set(params.guid, {
          guid: params.guid,
          filename: params.suggestedFilename || 'download',
          completed: false,
        });
      }
    };
    const handleDownloadProgress = (params) => {
      if (params.guid && params.state === 'completed') {
        const entry = downloadsMap.get(params.guid) || { guid: params.guid, filename: params.guid };
        entry.completed = true;
        downloadsMap.set(params.guid, entry);
      }
    };
    cdp.on(sessionId, 'Browser.downloadWillBegin', handleDownloadBegin);
    cdp.on(sessionId, 'Browser.downloadProgress', handleDownloadProgress);
    const unsubGlobalBegin = cdp.on(null, 'Browser.downloadWillBegin', handleDownloadBegin);
    const unsubGlobalProgress = cdp.on(null, 'Browser.downloadProgress', handleDownloadProgress);

    async function evaluate(fn, ...args) {
      const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
      const res = await cdp.send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      if (res.exceptionDetails) {
        const msg = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation error';
        throw new Error(msg);
      }
      return res.result?.value;
    }

    async function waitForFunction(fn, arg = null, { timeout = 15000 } = {}) {
      const deadline = Date.now() + timeout;
      let lastErr = null;
      while (Date.now() < deadline) {
        try {
          const val = await evaluate(fn, arg);
          if (val) return val;
        } catch (err) {
          lastErr = err;
          // Ignore transient execution context destroyed errors during page reload
        }
        await sleep(30);
      }
      throw new Error(`waitForFunction timeout (${timeout}ms)${lastErr ? `: ${lastErr.message}` : ''}`);
    }

    async function waitForSelector(selector, { visible = true, timeout = 15000 } = {}) {
      await waitForFunction(({ sel, vis }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        if (!vis) return true;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }, { sel: selector, vis: visible }, { timeout });
    }

    async function clickPoint(x, y) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    }

    async function click(selector, opts = {}) {
      await cdp.send('Target.activateTarget', { targetId }).catch(() => {});
      await waitForSelector(selector, { visible: true, timeout: opts.timeout || 15000 });
      const box = await evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: Boolean(el.disabled) };
      }, selector);
      if (!box) throw new Error(`click: introuvable ${selector}`);
      if (box.disabled) throw new Error(`click: désactivé ${selector}`);
      await clickPoint(box.x, box.y);
    }

    async function clickByText(selector, textSubstring, opts = {}) {
      await cdp.send('Target.activateTarget', { targetId }).catch(() => {});
      const timeout = opts.timeout || 15000;
      const box = await waitForFunction(({ sel, txt }) => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ');
        const nodes = [...document.querySelectorAll(sel)];
        for (const el of nodes) {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || el.closest('[inert]')) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (norm(el.textContent).includes(norm(txt))) {
            if (el.disabled) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      }, { sel: selector, txt: textSubstring }, { timeout });
      await clickPoint(box.x, box.y);
    }

    async function fill(selector, value) {
      await waitForSelector(selector, { visible: true });
      await evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`fill: introuvable ${sel}`);
        el.focus();
        const proto = el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { sel: selector, val: String(value) });
    }

    async function select(selector, value) {
      await waitForSelector(selector, { visible: true });
      await evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`select: introuvable ${sel}`);
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { sel: selector, val: String(value) });
    }

    async function setChecked(selector, checked) {
      await waitForSelector(selector, { visible: true });
      const current = await evaluate((sel) => Boolean(document.querySelector(sel)?.checked), selector);
      if (current !== Boolean(checked)) {
        await click(selector);
      }
    }

    async function goto(url) {
      const waitLoad = new Promise((resolve) => {
        const t = setTimeout(resolve, 15000);
        loadResolvers.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
      await cdp.send('Page.navigate', { url }, sessionId);
      await waitLoad;
      await waitForFunction(() => document.readyState === 'complete', null, { timeout: 10000 });
    }

    async function reload() {
      const waitLoad = new Promise((resolve) => {
        const t = setTimeout(resolve, 15000);
        loadResolvers.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
      await cdp.send('Page.reload', {}, sessionId);
      await waitLoad;
      await waitForFunction(() => document.readyState === 'complete', null, { timeout: 10000 });
    }

    async function goBack() {
      await evaluate(() => history.back());
    }

    async function setViewportSize({ width, height }) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 600,
      }, sessionId);
    }

    async function waitForDownload(actionFn, timeout = 15000) {
      const existingGuids = new Set(downloadsMap.keys());
      await evaluate(() => {
        window.__testBlobDownloads = [];
      }).catch(() => {});

      await actionFn();

      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        for (const [guid, info] of downloadsMap.entries()) {
          if (!existingGuids.has(guid) && info.completed) {
            const guidPath = path.join(ctxDownloadDir, guid);
            const namedPath = path.join(ctxDownloadDir, info.filename);
            const filePath = fs.existsSync(guidPath) ? guidPath : (fs.existsSync(namedPath) ? namedPath : null);
            if (filePath) {
              return { filename: info.filename, text: fs.readFileSync(filePath, 'utf8') };
            }
          }
        }
        const blobCaptured = await evaluate(() => {
          const list = window.__testBlobDownloads;
          return Array.isArray(list) && list.length > 0 ? list[list.length - 1] : null;
        }).catch(() => null);
        if (blobCaptured) {
          return { filename: blobCaptured.filename, text: blobCaptured.text };
        }
        await sleep(40);
      }
      throw new Error(`waitForDownload timeout (${timeout}ms)`);
    }

    async function close() {
      if (closed) return;
      closed = true;
      unsubGlobalBegin();
      unsubGlobalProgress();
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }

    return {
      sessionId,
      browserContextId,
      goto,
      reload,
      goBack,
      evaluate,
      waitForFunction,
      waitForSelector,
      click,
      clickByText,
      fill,
      select,
      setChecked,
      setViewportSize,
      waitForDownload,
      close,
      _setOffline(offline) {
        return cdp.send('Network.emulateNetworkConditions', {
          offline: Boolean(offline),
          latency: 0,
          downloadThroughput: offline ? 0 : -1,
          uploadThroughput: offline ? 0 : -1,
        }, sessionId);
      },
    };
  }

  return {
    name: 'CDP (Chromium headless)',
    async newContext({ initScripts = [], viewport = { width: 1280, height: 800 } } = {}) {
      const ctxDownloadDir = path.join(tmpRoot, `downloads-${++ctxCounter}`);
      fs.mkdirSync(ctxDownloadDir, { recursive: true });
      const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
      activeContexts.add(browserContextId);

      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allowAndName',
        browserContextId,
        downloadPath: ctxDownloadDir,
        eventsEnabled: true,
      });

      const pages = [];
      const downloadsMap = new Map();
      const isOfflineRef = { value: false };
      const expectOfflineErrorsRef = { value: false };

      const blobSpyScript = `(() => {
        const blobTexts = new Map();
        const origCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function(obj) {
          const url = origCreate(obj);
          if (obj && typeof obj.text === 'function') {
            obj.text().then((t) => blobTexts.set(url, t)).catch(() => {});
          }
          return url;
        };
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
          if (this.hasAttribute('download') && this.href && this.href.startsWith('blob:')) {
            const filename = this.getAttribute('download') || 'download';
            const text = blobTexts.get(this.href);
            if (typeof text === 'string') {
              window.__testBlobDownloads = window.__testBlobDownloads || [];
              window.__testBlobDownloads.push({ filename, text });
            }
          }
          return origClick.apply(this, arguments);
        };
      })();`;

      const allScripts = [blobSpyScript, ...initScripts];

      return {
        async newPage() {
          const { targetId } = await cdp.send('Target.createTarget', {
            url: 'about:blank',
            browserContextId,
          });
          const { sessionId } = await cdp.send('Target.attachToTarget', {
            targetId,
            flatten: true,
          });
          await cdp.send('Page.enable', {}, sessionId);
          await cdp.send('Runtime.enable', {}, sessionId);
          await cdp.send('Network.enable', {}, sessionId);
          await cdp.send('Fetch.enable', {
            patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }],
          }, sessionId);
          await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: viewport.width < 600,
          }, sessionId);

          for (const source of allScripts) {
            await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId);
          }

          const page = wrapCdpPage({
            sessionId,
            targetId,
            browserContextId,
            ctxDownloadDir,
            downloadsMap,
            isOfflineRef,
            expectOfflineErrorsRef,
          });
          if (isOfflineRef.value) await page._setOffline(true);
          pages.push(page);
          return page;
        },

        async setOffline(offline) {
          isOfflineRef.value = Boolean(offline);
          for (const page of pages) {
            await page._setOffline(offline).catch(() => {});
          }
          try {
            const { targetInfos } = await cdp.send('Target.getTargets');
            for (const info of targetInfos || []) {
              if (info.browserContextId === browserContextId && info.type === 'service_worker') {
                const { sessionId: swSession } = await cdp.send('Target.attachToTarget', {
                  targetId: info.targetId,
                  flatten: true,
                });
                await cdp.send('Network.enable', {}, swSession);
                await cdp.send('Network.emulateNetworkConditions', {
                  offline: Boolean(offline),
                  latency: 0,
                  downloadThroughput: offline ? 0 : -1,
                  uploadThroughput: offline ? 0 : -1,
                }, swSession);
                await cdp.send('Target.detachFromTarget', { sessionId: swSession }).catch(() => {});
              }
            }
          } catch {
            // SW target attachment is best-effort
          }
        },

        setExpectOfflineErrors(val) {
          expectOfflineErrorsRef.value = Boolean(val);
        },

        async close() {
          for (const page of pages) {
            await page.close();
          }
          pages.length = 0;
          activeContexts.delete(browserContextId);
          await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
        },
      };
    },

    async close() {
      for (const ctxId of activeContexts) {
        await cdp.send('Target.disposeBrowserContext', { browserContextId: ctxId }).catch(() => {});
      }
      activeContexts.clear();
      cdp.close();
      if (proc.exitCode === null) {
        proc.kill('SIGTERM');
        await Promise.race([
          new Promise((resolve) => proc.once('exit', resolve)),
          sleep(2000),
        ]);
        if (proc.exitCode === null) {
          proc.kill('SIGKILL');
          await Promise.race([
            new Promise((resolve) => proc.once('exit', resolve)),
            sleep(1000),
          ]);
        }
      }
    },
  };
}

// =====================================================================
// Playwright driver (used when playwright package is installed, e.g. in CI)
// =====================================================================

async function launchPlaywrightDriver({ pw, baseOrigin, externalRequests, consoleErrors }) {
  const browser = await pw.chromium.launch({ headless: true });

  function wrapPwPage(pwPage, expectOfflineErrorsRef) {
    pwPage.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message || err}`);
    });
    pwPage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (expectOfflineErrorsRef.value && /ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to load resource/i.test(text)) {
        return;
      }
      consoleErrors.push(`[console.error] ${text}`);
    });
    pwPage.on('dialog', async (dialog) => {
      consoleErrors.push(`[native-dialog] ${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
    });

    return {
      async goto(url) {
        await pwPage.goto(url, { waitUntil: 'load' });
      },
      async reload() {
        await pwPage.reload({ waitUntil: 'load' });
      },
      async goBack() {
        await pwPage.goBack({ waitUntil: 'commit' }).catch(async () => {
          await pwPage.evaluate(() => history.back());
        });
      },
      evaluate(fn, ...args) {
        if (args.length <= 1) return pwPage.evaluate(fn, args[0]);
        return pwPage.evaluate(({ f, a }) => {
          // eslint-disable-next-line no-new-func
          const reconstructed = new Function(`return (${f})`)();
          return reconstructed(...a);
        }, { f: fn.toString(), a: args });
      },
      async waitForFunction(fn, arg = null, { timeout = 15000 } = {}) {
        const handle = await pwPage.waitForFunction(fn, arg, { timeout });
        return handle.jsonValue();
      },
      async waitForSelector(selector, { visible = true, timeout = 15000 } = {}) {
        await pwPage.waitForSelector(selector, { state: visible ? 'visible' : 'attached', timeout });
      },
      async click(selector, opts = {}) {
        await pwPage.locator(selector).first().click({ timeout: opts.timeout || 15000 });
      },
      async clickByText(selector, textSubstring, opts = {}) {
        const timeout = opts.timeout || 15000;
        const loc = pwPage.locator(`${selector}:visible`, { hasText: textSubstring }).first();
        await loc.click({ timeout });
      },
      async fill(selector, value) {
        await pwPage.locator(selector).first().fill(String(value));
      },
      async select(selector, value) {
        await pwPage.locator(selector).first().selectOption(String(value));
      },
      async setChecked(selector, checked) {
        await pwPage.locator(selector).first().setChecked(Boolean(checked));
      },
      async setViewportSize(size) {
        await pwPage.setViewportSize(size);
      },
      async waitForDownload(actionFn, timeout = 15000) {
        const [dl] = await Promise.all([
          pwPage.waitForEvent('download', { timeout }),
          actionFn(),
        ]);
        const filePath = await dl.path();
        return { filename: dl.suggestedFilename(), text: fs.readFileSync(filePath, 'utf8') };
      },
      async close() {
        await pwPage.close();
      },
    };
  }

  return {
    name: 'Playwright (Chromium headless)',
    async newContext({ initScripts = [], viewport = { width: 1280, height: 800 } } = {}) {
      const context = await browser.newContext({ acceptDownloads: true, viewport });
      const expectOfflineErrorsRef = { value: false };
      await context.route('**/*', (route) => {
        const url = route.request().url();
        const allowed = url.startsWith(baseOrigin) || url.startsWith('blob:') || url.startsWith('data:') || url === 'about:blank';
        if (!allowed) {
          externalRequests.push(url);
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });

      for (const script of initScripts) {
        await context.addInitScript({ content: script });
      }

      return {
        async newPage() {
          const pwPage = await context.newPage();
          return wrapPwPage(pwPage, expectOfflineErrorsRef);
        },
        async setOffline(offline) {
          await context.setOffline(Boolean(offline));
        },
        setExpectOfflineErrors(val) {
          expectOfflineErrorsRef.value = Boolean(val);
        },
        async close() {
          await context.close();
        },
      };
    },
    async close() {
      await browser.close();
    },
  };
}

// =====================================================================
// Shared UI helper macros
// =====================================================================

async function waitForUnlockedApp(page, timeout = 15000) {
  await page.waitForFunction(() => {
    if (document.documentElement.hasAttribute('data-locked')) return false;
    const btn = document.getElementById('bouton-nouveau-rdv');
    const pageEl = document.querySelector('#livre > .page');
    const pwdEl = document.querySelector('#reglages-mot-de-passe > *');
    if (!btn || !pageEl || !pwdEl) return false;
    const rect = btn.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, null, { timeout });
}

async function waitForLockScreen(page, timeout = 15000) {
  await page.waitForFunction(() => (
    document.documentElement.hasAttribute('data-locked')
    && Boolean(document.querySelector('#verrouillage-formulaire form input[type="password"]'))
  ), null, { timeout });
}

async function enablePasswordViaUI(page, password = 'mon chat dort') {
  await page.click('a[href="#/reglages"]');
  await page.clickByText('#reglages-mot-de-passe button', 'Activer un mot de passe');
  await page.waitForSelector('dialog[open] input[type="password"]');
  await page.evaluate((pwd) => {
    const dlg = document.querySelector('dialog[open]');
    const inputs = [...dlg.querySelectorAll('input[type="password"]')];
    for (const inp of inputs) {
      inp.value = pwd;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const cb = dlg.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
  }, password);
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForFunction(() => {
    if (document.querySelector('dialog[open]')) return false;
    const msg = document.getElementById('message-mot-de-passe')?.textContent || '';
    return msg.includes('Mot de passe activé');
  }, null, { timeout: 20000 });
}

async function unlockViaUI(page, password = 'mon chat dort') {
  await waitForLockScreen(page);
  await page.fill('#verrouillage-formulaire input[type="password"]', password);
  await page.click('#verrouillage-formulaire button[type="submit"]');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-locked'), null, { timeout: 20000 });
}

async function createEventViaUI(page, opts) {
  await page.click('#bouton-nouveau-rdv');
  await page.waitForSelector('#fenetre-entree[open] input[name="title"]');
  await page.fill('#fenetre-entree input[name="title"]', opts.title);
  await page.fill('#fenetre-entree input[name="date"]', opts.date);
  if (opts.allDay) {
    await page.setChecked('#fenetre-entree input[name="allDay"]', true);
    if (opts.endDate) await page.fill('#fenetre-entree input[name="endDate"]', opts.endDate);
  } else {
    if (opts.startTime) await page.fill('#fenetre-entree input[name="startTime"]', opts.startTime);
    if (opts.endTime) await page.fill('#fenetre-entree input[name="endTime"]', opts.endTime);
  }
  if (opts.location !== undefined) {
    await page.fill('#fenetre-entree input[name="location"]', opts.location);
  }
  if (opts.reminderMinutes !== undefined) {
    await page.select('#fenetre-entree select[name="reminderMinutes"]', String(opts.reminderMinutes));
  }
  if (opts.recurrenceFreq) {
    await page.select('#fenetre-entree select[name="recurrenceFreq"]', opts.recurrenceFreq);
    if (opts.recurrenceInterval !== undefined) {
      await page.fill('#fenetre-entree input[name="recurrenceInterval"]', String(opts.recurrenceInterval));
    }
    if (opts.recurrenceEndMode) {
      await page.select('#fenetre-entree select[name="recurrenceEndMode"]', opts.recurrenceEndMode);
    }
    if (opts.recurrenceUntil) {
      await page.fill('#fenetre-entree input[name="recurrenceUntil"]', opts.recurrenceUntil);
    }
    if (opts.recurrenceCount !== undefined) {
      await page.fill('#fenetre-entree input[name="recurrenceCount"]', String(opts.recurrenceCount));
    }
  }
  await page.click('#fenetre-entree button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('fenetre-entree')?.open, null, { timeout: 10000 });
}

// =====================================================================
// Init scripts for specific deterministic scenarios
// =====================================================================

const CLOCK_AND_VISIBILITY_INIT_SCRIPT = `(() => {
  const RealDate = Date;
  const origNow = RealDate.now.bind(RealDate);
  const origSetTimeout = window.setTimeout.bind(window);
  const origClearTimeout = window.clearTimeout.bind(window);
  let virtualOffset = 0;
  let seq = 1;
  const timers = new Map();
  let fakeVisibility = null;

  Date.now = () => origNow() + virtualOffset;

  window.setTimeout = function(fn, delay = 0, ...args) {
    if (typeof fn !== 'function') return origSetTimeout(fn, delay, ...args);
    const ms = Math.max(0, Number(delay) || 0);
    if (ms < 5000) {
      return origSetTimeout(fn, ms, ...args);
    }
    const id = 'vt-' + (++seq);
    const deadline = Date.now() + ms;
    const realId = origSetTimeout(() => {
      timers.delete(id);
      fn(...args);
    }, ms);
    timers.set(id, { realId, deadline, fn, args });
    return id;
  };

  window.clearTimeout = function(id) {
    if (typeof id === 'string' && id.startsWith('vt-')) {
      const entry = timers.get(id);
      if (entry) {
        origClearTimeout(entry.realId);
        timers.delete(id);
      }
      return;
    }
    return origClearTimeout(id);
  };

  window.__advanceTime = function(ms) {
    virtualOffset += ms;
    const now = Date.now();
    for (const [id, entry] of [...timers.entries()]) {
      if (entry.deadline <= now) {
        origClearTimeout(entry.realId);
        timers.delete(id);
        entry.fn(...entry.args);
      }
    }
  };

  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    || Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get() {
      return fakeVisibility !== null ? fakeVisibility : (desc?.get ? desc.get.call(document) : 'visible');
    },
  });

  window.__setVisibility = function(state) {
    fakeVisibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };
})();`;

const NOTIFICATION_SPY_INIT_SCRIPT = `(() => {
  window.__notifs = [];
  const FakeNotification = function(title, options) {
    window.__notifs.push({ via: 'Notification', title, options });
  };
  Object.defineProperty(FakeNotification, 'permission', {
    configurable: true,
    get: () => 'granted',
  });
  FakeNotification.requestPermission = async () => 'granted';
  window.Notification = FakeNotification;

  if (typeof ServiceWorkerRegistration !== 'undefined') {
    ServiceWorkerRegistration.prototype.showNotification = async function(title, options) {
      window.__notifs.push({ via: 'ServiceWorkerRegistration', title, options });
    };
  }
})();`;

// =====================================================================
// Static SW & verifier helper (Scenario j)
// =====================================================================

function parseSwFilesFromDisk() {
  const swText = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const match = /const FILES\s*=\s*\[([\s\S]*?)\];/.exec(swText);
  assert.ok(match, 'sw.js: liste FILES introuvable');
  return [...match[1].matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]);
}

// =====================================================================
// Main E2E Suite
// =====================================================================

async function main() {
  const requirePlaywright = process.env.CI === 'true'
    || process.env.CI === '1'
    || process.argv.includes('--playwright-only');

  let pw = null;
  try {
    pw = await import('playwright');
  } catch {
    pw = null;
  }

  if (!pw && requirePlaywright) {
    console.error(
      'ERREUR FATALE : le paquet npm "playwright" est introuvable alors que '
      + (process.env.CI ? 'CI=true/1' : '--playwright-only')
      + ' est actif.\nInstalle Playwright avec : npm install --no-save playwright && npx playwright install chromium',
    );
    process.exit(1);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-agenda-e2e-'));
  const externalRequests = [];
  const consoleErrors = [];
  let server = null;
  let driver = null;
  const failures = [];
  let passed = 0;

  try {
    server = await startServer(ROOT);
    const { baseUrl } = server;

    driver = pw
      ? await launchPlaywrightDriver({ pw, baseOrigin: baseUrl, externalRequests, consoleErrors })
      : await launchCdpDriver({ baseOrigin: baseUrl, tmpRoot, externalRequests, consoleErrors });

    console.log(`Exécution des tests Omni-Agenda via ${driver.name} sur ${baseUrl}\n`);

    async function runScenario(name, fn) {
      try {
        await fn();
        passed += 1;
        console.log(`✓ ${name}`);
      } catch (error) {
        failures.push({ name, error });
        console.error(`✗ ${name}`);
        console.error(`  ${error.stack || error.message}`);
      }
    }

    // (a) /tests/tests.html
    await runScenario('a) Suite tests/tests.html (>= 82 tests, 0 échec, stockage propre)', async () => {
      const ctx = await driver.newContext();
      try {
        const page = await ctx.newPage();
        await page.goto(`${baseUrl}/tests/tests.html`);
        await page.waitForFunction(() => {
          const resume = document.getElementById('resume');
          return Array.isArray(window.testResults) && window.testResults.length > 0 && resume?.className.includes('is-');
        }, null, { timeout: 30000 });

        const info = await page.evaluate(async () => {
          const dbs = indexedDB.databases ? await indexedDB.databases() : [];
          return {
            results: window.testResults,
            summary: document.getElementById('resume')?.textContent || '',
            lsCount: localStorage.length,
            dbNames: dbs.map((d) => d.name),
          };
        });

        assert.ok(info.results.length >= 82, `Attendu >= 82 tests, obtenu ${info.results.length}`);
        const failedTests = info.results.filter((r) => !r.ok);
        assert.equal(failedTests.length, 0,
          `Tests échoués: ${failedTests.map((t) => `${t.name}: ${t.message}`).join(' | ')}`);
        assert.equal(info.lsCount, 0, `localStorage non vide après tests.html (${info.lsCount})`);
        assert.equal(info.dbNames.length, 0, `IndexedDB non vide après tests.html (${info.dbNames.join(', ')})`);
        console.log(`   (${info.summary})`);
      } finally {
        await ctx.close();
      }
    });

    // (b) Auto-lock (inactivity + visibilitychange + pagehide/pageshow bfcache)
    await runScenario('b) Verrouillage automatique (inactivité, masquage onglet, pagehide/pageshow bfcache)', async () => {
      const ctx = await driver.newContext({ initScripts: [CLOCK_AND_VISIBILITY_INIT_SCRIPT] });
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        await enablePasswordViaUI(page, 'mon chat dort');
        await page.select('#auto-lock-delai', '1');
        await sleep(100);
        await page.click('a[href="#/"]');
        await waitForUnlockedApp(page);

        // 1. Inactivity timeout (1 minute)
        await page.evaluate(() => window.__advanceTime(61000));
        await waitForLockScreen(page, 20000);

        // Unlock
        await unlockViaUI(page, 'mon chat dort');
        await waitForUnlockedApp(page);

        // 2. visibilitychange when autoLockOnHide enabled
        await page.click('a[href="#/reglages"]');
        await page.setChecked('#auto-lock-masque', true);
        await sleep(100);
        await page.click('a[href="#/"]');
        await waitForUnlockedApp(page);

        await page.evaluate(() => window.__setVisibility('hidden'));
        await waitForLockScreen(page, 20000);

        // Unlock
        await unlockViaUI(page, 'mon chat dort');
        await waitForUnlockedApp(page);

        // 3. pagehide persisted: true (synchronous suspendForBfcache)
        const lockedOnPageHide = await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
          return document.documentElement.hasAttribute('data-locked');
        });
        assert.equal(lockedOnPageHide, true, 'pagehide persisted doit poser data-locked immédiatement');

        // 4. pageshow persisted: true (triggerLock -> reload)
        await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await waitForLockScreen(page, 20000);
      } finally {
        await ctx.close();
      }
    });

    // (c) Multi-tab BroadcastChannel (lock propagation + reminder dedup)
    await runScenario('c) Multi-onglets BroadcastChannel (verrouillage partagé & déduplication rappels)', async () => {
      // c1: Cross-tab lockApp() & isolated pageshow { broadcast: false }
      const ctxLock = await driver.newContext();
      try {
        const tab1 = await ctxLock.newPage();
        const tab2 = await ctxLock.newPage();
        await tab1.goto(baseUrl);
        await tab2.goto(baseUrl);
        await waitForUnlockedApp(tab1);
        await waitForUnlockedApp(tab2);

        try {
          await enablePasswordViaUI(tab1, 'mon chat dort');
        } catch (err) {
          const st = await tab1.evaluate(() => ({
            dlg: document.querySelector('dialog[open]')?.textContent?.slice(0, 200) || null,
            msg: document.getElementById('message-mot-de-passe')?.textContent || '',
            hash: location.hash,
            histState: history.state,
            verrHidden: document.getElementById('bouton-verrouiller')?.hidden,
            locked: document.documentElement.hasAttribute('data-locked'),
          })).catch(() => null);
          throw new Error(`${err.message} | tab1 state: ${JSON.stringify(st)}`);
        }
        await waitForLockScreen(tab2, 20000);

        await unlockViaUI(tab2, 'mon chat dort');
        await waitForUnlockedApp(tab2);

        await tab1.click('#bouton-verrouiller');
        await waitForLockScreen(tab1, 20000);
        await waitForLockScreen(tab2, 20000);

        await unlockViaUI(tab1, 'mon chat dort');
        await unlockViaUI(tab2, 'mon chat dort');
        await waitForUnlockedApp(tab1);
        await waitForUnlockedApp(tab2);

        // pageshow persisted on tab1 uses { broadcast: false } so tab2 must stay unlocked
        await tab1.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await waitForLockScreen(tab1, 20000);
        await sleep(500);
        const tab2Locked = await tab2.evaluate(() => document.documentElement.hasAttribute('data-locked'));
        assert.equal(tab2Locked, false, 'pageshow persisted sur onglet 1 ne doit pas verrouiller onglet 2');
      } finally {
        await ctxLock.close();
      }

      // c2: Multi-tab reminder/notification dedup (n1 + n2 === 1)
      const ctxNotif = await driver.newContext({ initScripts: [NOTIFICATION_SPY_INIT_SCRIPT] });
      try {
        const tab1 = await ctxNotif.newPage();
        const tab2 = await ctxNotif.newPage();
        await tab1.goto(baseUrl);
        await tab2.goto(baseUrl);
        await waitForUnlockedApp(tab1);
        await waitForUnlockedApp(tab2);
        await sleep(400);

        const now = new Date();
        const start = new Date(now.getTime() + 5 * 60000);
        const end = new Date(start.getTime() + 30 * 60000);
        await createEventViaUI(tab1, {
          title: 'Rappel Dédupliqué',
          date: toISODate(start),
          startTime: toHHMM(start),
          endTime: toHHMM(end),
          reminderMinutes: '15',
        });

        await tab1.waitForFunction(() => Boolean(localStorage.getItem('omni-agenda:rappels-affiches')), null, { timeout: 10000 });
        await sleep(500);

        const n1 = await tab1.evaluate(() => window.__notifs.length);
        const n2 = await tab2.evaluate(() => window.__notifs.length);
        assert.equal(n1 + n2, 1, `Attendu exactement 1 notification entre 2 onglets (n1=${n1}, n2=${n2})`);

        const storageCheck = await tab1.evaluate(() => ({
          shown: JSON.parse(localStorage.getItem('omni-agenda:rappels-affiches') || 'null'),
          salt: localStorage.getItem('omni-agenda:rappels-sel'),
        }));
        assert.equal(storageCheck.shown?.v, 2, 'rappels-affiches doit être au format v:2');
        assert.ok(Array.isArray(storageCheck.shown?.codes) && storageCheck.shown.codes.length === 1);
        assert.ok(typeof storageCheck.salt === 'string' && storageCheck.salt.length > 0, 'rappels-sel manquant');
      } finally {
        await ctxNotif.close();
      }
    });

    // (d) Mobile Back (popstate) discard confirmation on dirty entry panel
    await runScenario('d) Bouton Retour mobile (popstate) avec confirmation sur fiche modifiée', async () => {
      const ctx = await driver.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        await page.click('#bouton-nouveau-rdv');
        await page.waitForSelector('#fenetre-entree[open] input[name="title"]');
        await page.fill('#fenetre-entree input[name="title"]', 'Brouillon non enregistré');

        // First Back -> confirmation dialog opens; cancel keeps form open with text
        await page.goBack();
        await page.waitForFunction(() => {
          const dlg = document.querySelector('dialog.panel-small[open]');
          return dlg && dlg.textContent.replace(/\s+/g, ' ').includes('Abandonner la saisie ?');
        }, null, { timeout: 10000 });

        await page.clickByText('dialog.panel-small[open] button', 'Continuer la saisie');
        await page.waitForFunction(() => !document.querySelector('dialog.panel-small[open]'), null, { timeout: 10000 });

        const preserved = await page.evaluate(() => ({
          open: Boolean(document.getElementById('fenetre-entree')?.open),
          title: document.querySelector('#fenetre-entree input[name="title"]')?.value || '',
        }));
        assert.equal(preserved.open, true, 'La fenêtre d’entrée doit rester ouverte après annulation');
        assert.equal(preserved.title, 'Brouillon non enregistré', 'La saisie doit être préservée');

        // Second Back -> confirm discard closes entry panel without saving
        await page.goBack();
        await page.waitForFunction(() => {
          const dlg = document.querySelector('dialog.panel-small[open]');
          return dlg && dlg.textContent.replace(/\s+/g, ' ').includes('Abandonner la saisie ?');
        }, null, { timeout: 10000 });

        await page.click('dialog.panel-small[open] button.btn-danger');
        await page.waitForFunction(() => !document.getElementById('fenetre-entree')?.open, null, { timeout: 10000 });

        const emptyVisible = await page.evaluate(() => !document.getElementById('accueil-vide')?.hidden);
        assert.equal(emptyVisible, true, 'L’entrée abandonnée ne doit pas avoir été enregistrée');
      } finally {
        await ctx.close();
      }
    });

    // (e) eraseEverything() full purge
    await runScenario('e) eraseEverything() : purge complète IDB + localStorage', async () => {
      const ctx = await driver.newContext({ initScripts: [NOTIFICATION_SPY_INIT_SCRIPT] });
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        await createEventViaUI(page, {
          title: 'Donnée confidentielle',
          date: '2026-10-21',
          startTime: '10:00',
          endTime: '11:00',
        });

        await page.click('a[href="#/reglages"]');
        await page.waitForSelector('#bouton-exporter');
        await page.waitForDownload(() => page.click('#bouton-exporter'));
        await page.waitForFunction(() => (
          document.getElementById('derniere-sauvegarde')?.textContent?.includes('Dernier export')
        ), null, { timeout: 10000 });

        await enablePasswordViaUI(page, 'mon chat dort');
        await page.select('#auto-lock-delai', '1');
        await page.setChecked('#auto-lock-masque', true);
        await sleep(150);

        // Trigger a due reminder while protected so encrypted rappels-affiches & rappels-sel exist
        await page.click('a[href="#/"]');
        await waitForUnlockedApp(page);
        const now = new Date();
        const start = new Date(now.getTime() + 5 * 60000);
        const end = new Date(start.getTime() + 30 * 60000);
        await createEventViaUI(page, {
          title: 'Rappel Secret',
          date: toISODate(start),
          startTime: toHHMM(start),
          endTime: toHHMM(end),
          reminderMinutes: '15',
        });
        await page.waitForFunction(() => Boolean(localStorage.getItem('omni-agenda:rappels-affiches')), null, { timeout: 10000 });

        await page.click('#bouton-verrouiller');
        await waitForLockScreen(page, 20000);

        await page.click('.lock-forgot summary');
        await page.click('.lock-forgot button.btn-danger');
        await page.waitForFunction(() => {
          const dlg = document.querySelector('dialog.panel-small[open]');
          return dlg && dlg.textContent.replace(/\s+/g, ' ').includes('Tout effacer ?');
        }, null, { timeout: 10000 });
        await page.click('dialog.panel-small[open] button.btn-danger');

        await waitForUnlockedApp(page, 20000);

        const postErase = await page.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('omni-agenda', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const entriesCount = await new Promise((resolve, reject) => {
            const tx = db.transaction('entries', 'readonly');
            const req = tx.objectStore('entries').count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const settingsKeys = await new Promise((resolve, reject) => {
            const tx = db.transaction('settings', 'readonly');
            const req = tx.objectStore('settings').getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          db.close();
          return {
            entriesCount,
            settingsKeys,
            rappelsAffiches: localStorage.getItem('omni-agenda:rappels-affiches'),
            rappelsSel: localStorage.getItem('omni-agenda:rappels-sel'),
            apparence: JSON.parse(localStorage.getItem('omni-agenda:apparence') || 'null'),
            emptyWelcomeVisible: !document.getElementById('accueil-vide')?.hidden,
          };
        });

        assert.equal(postErase.entriesCount, 0, 'entries doit être vide après eraseEverything()');
        for (const forbiddenKey of ['protection', 'lastExportAt', 'autoLockMinutes', 'autoLockOnHide']) {
          assert.ok(!postErase.settingsKeys.includes(forbiddenKey),
            `Clé "${forbiddenKey}" doit être purgée de IndexedDB settings`);
        }
        assert.equal(postErase.rappelsAffiches, null, 'omni-agenda:rappels-affiches doit être supprimé');
        assert.equal(postErase.rappelsSel, null, 'omni-agenda:rappels-sel doit être supprimé');
        assert.equal(postErase.apparence?.locked, false, 'apparence.locked doit être false');
        assert.equal(postErase.emptyWelcomeVisible, true, 'Accueil vide doit réapparaître');
      } finally {
        await ctx.close();
      }
    });

    // (f) Lock-gated search
    await runScenario('f) Recherche locale (accents/ligatures/casse) et garde de verrouillage', async () => {
      const ctx = await driver.newContext();
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        await createEventViaUI(page, {
          title: 'Médecin Café Œuvre',
          date: '2026-10-21',
          startTime: '10:00',
          endTime: '11:00',
          location: 'Élysée',
        });

        await page.fill('#champ-recherche', 'medecin cafe oeuvre');
        await page.waitForFunction(() => {
          const sec = document.getElementById('recherche-resultats');
          const status = document.getElementById('recherche-statut')?.textContent || '';
          return sec && !sec.hidden && status.includes('1 résultat');
        }, null, { timeout: 10000 });
        const listText1 = await page.evaluate(() => document.getElementById('recherche-liste')?.textContent || '');
        assert.ok(listText1.includes('Médecin Café Œuvre'));

        await page.fill('#champ-recherche', 'ELYSEE');
        await page.waitForFunction(() => (
          document.getElementById('recherche-liste')?.textContent?.includes('Médecin Café Œuvre')
        ), null, { timeout: 10000 });

        await enablePasswordViaUI(page, 'mon chat dort');
        await page.click('a[href="#/"]');
        await waitForUnlockedApp(page);

        await page.fill('#champ-recherche', 'medecin');
        await page.waitForFunction(() => !document.getElementById('recherche-resultats')?.hidden, null, { timeout: 10000 });

        // Trigger suspendForBfcache via pagehide persisted: true
        const afterBfcache = await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
          return {
            locked: document.documentElement.hasAttribute('data-locked'),
            queryVal: document.getElementById('champ-recherche')?.value,
            listCount: document.getElementById('recherche-liste')?.children.length,
            resultsHidden: document.getElementById('recherche-resultats')?.hidden,
          };
        });
        assert.equal(afterBfcache.locked, true, 'pagehide doit verrouiller');
        assert.equal(afterBfcache.queryVal, '', 'Le champ de recherche doit être vidé au verrouillage');
        assert.equal(afterBfcache.listCount, 0, 'La liste de résultats doit être vidée au verrouillage');
        assert.equal(afterBfcache.resultsHidden, true, 'La section résultats doit être masquée au verrouillage');

        // Probe search lock gate even if data-locked is removed from DOM while isLocked() === true
        const blockedWhenLocked = await page.evaluate(() => {
          document.documentElement.removeAttribute('data-locked');
          const inp = document.getElementById('champ-recherche');
          inp.value = 'medecin';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('search', { bubbles: true }));
          return {
            listCount: document.getElementById('recherche-liste')?.children.length,
            resultsHidden: document.getElementById('recherche-resultats')?.hidden,
          };
        });
        await sleep(200);
        assert.equal(blockedWhenLocked.listCount, 0, 'La recherche doit rester bloquée tant que isLocked() est vrai');
        assert.equal(blockedWhenLocked.resultsHidden, true);
      } finally {
        await ctx.close();
      }
    });

    // (g) Recurrences across Day, Month, and Week views
    await runScenario('g) Récurrences (weekly & daily) dans les vues Jour, Mois et Semaine', async () => {
      const ctx = await driver.newContext();
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        await createEventViaUI(page, {
          title: 'Standup Hebdo',
          date: '2026-10-05',
          startTime: '09:00',
          endTime: '09:30',
          recurrenceFreq: 'weekly',
          recurrenceInterval: '1',
          recurrenceEndMode: 'count',
          recurrenceCount: '3',
        });

        // Day view on 2026-10-12
        await page.click('button[data-view="day"]');
        await page.fill('#aller-a-la-date', '2026-10-12');
        await page.waitForFunction(() => (
          document.querySelector('#livre > .page .entry-title')?.textContent === 'Standup Hebdo'
          && (document.querySelector('#livre > .page .entry-recurrence')?.textContent || '').includes('Toutes les semaines')
        ), null, { timeout: 10000 });

        await page.click('#livre > .page .entry-main');
        await page.waitForSelector('#fenetre-entree[open]');
        const detailsText = await page.evaluate(() => document.getElementById('fenetre-entree')?.textContent || '');
        assert.ok(detailsText.includes('Occurrence') && detailsText.includes('Lundi 12 octobre 2026'),
          `Fiche détails doit afficher Occurrence (Lundi 12 octobre 2026), reçu: ${detailsText}`);
        assert.ok(detailsText.includes('Première date') && detailsText.includes('Lundi 5 octobre 2026'),
          `Fiche détails doit afficher Première date (Lundi 5 octobre 2026), reçu: ${detailsText}`);
        await page.click('#fenetre-entree button[aria-label="Fermer"]');
        await page.waitForFunction(() => !document.getElementById('fenetre-entree')?.open);

        // Month view: 5, 12, 19 Oct have marker; 26 Oct does NOT
        await page.click('button[data-view="month"]');
        await page.waitForFunction(() => Boolean(document.querySelector('#livre > .page .month-grid')), null, { timeout: 10000 });
        const monthMarkers = await page.evaluate(() => ({
          oct05: Boolean(document.querySelector('#livre > .page .month-day[data-date="2026-10-05"] .marker-event')),
          oct12: Boolean(document.querySelector('#livre > .page .month-day[data-date="2026-10-12"] .marker-event')),
          oct19: Boolean(document.querySelector('#livre > .page .month-day[data-date="2026-10-19"] .marker-event')),
          oct26: Boolean(document.querySelector('#livre > .page .month-day[data-date="2026-10-26"] .marker-event')),
        }));
        assert.deepEqual(monthMarkers, { oct05: true, oct12: true, oct19: true, oct26: false });

        // Daily recurrence in Week view
        await createEventViaUI(page, {
          title: 'Sport Quotidien',
          date: '2026-10-05',
          startTime: '07:00',
          endTime: '07:30',
          recurrenceFreq: 'daily',
          recurrenceInterval: '1',
          recurrenceEndMode: 'count',
          recurrenceCount: '3',
        });

        await page.click('button[data-view="week"]');
        await page.fill('#aller-a-la-date', '2026-10-05');
        await page.waitForFunction(() => {
          const matches = [...document.querySelectorAll('#livre > .page .entry-main')]
            .filter((el) => el.querySelector('.entry-title')?.textContent === 'Sport Quotidien');
          return matches.length === 3;
        }, null, { timeout: 10000 });

        const focusKeys = await page.evaluate(() => (
          [...document.querySelectorAll('#livre > .page .entry-main')]
            .filter((el) => el.querySelector('.entry-title')?.textContent === 'Sport Quotidien')
            .map((el) => el.getAttribute('data-focus-key'))
        ));
        assert.equal(focusKeys.length, 3);
        assert.equal(new Set(focusKeys).size, 3, `Les 3 occurrences doivent avoir 3 data-focus-key distincts (${focusKeys.join(', ')})`);
      } finally {
        await ctx.close();
      }
    });

    // (h) All-day events (journée entière)
    await runScenario('h) Événements journée entière (formulaire, persistance rechargement, tri en tête)', async () => {
      const ctx = await driver.newContext();
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        await createEventViaUI(page, {
          title: 'Tôt le matin',
          date: '2026-10-21',
          startTime: '00:00',
          endTime: '01:00',
        });

        await page.click('#bouton-nouveau-rdv');
        await page.waitForSelector('#fenetre-entree[open] input[name="allDay"]');
        await page.fill('#fenetre-entree input[name="title"]', 'Congé Annuel');
        await page.fill('#fenetre-entree input[name="date"]', '2026-10-21');
        await page.setChecked('#fenetre-entree input[name="allDay"]', true);

        const fieldStates = await page.evaluate(() => ({
          startDisabled: document.querySelector('#fenetre-entree input[name="startTime"]')?.disabled,
          endDisabled: document.querySelector('#fenetre-entree input[name="endTime"]')?.disabled,
          endDateDisabled: document.querySelector('#fenetre-entree input[name="endDate"]')?.disabled,
        }));
        assert.deepEqual(fieldStates, { startDisabled: true, endDisabled: true, endDateDisabled: false });

        await page.click('#fenetre-entree button[type="submit"]');
        await page.waitForFunction(() => !document.getElementById('fenetre-entree')?.open);

        // Reload and check persistence + ordering
        await page.reload();
        await waitForUnlockedApp(page);
        await page.fill('#aller-a-la-date', '2026-10-21');

        await page.waitForFunction(() => (
          document.querySelectorAll('#livre > .page:first-child .entry-title').length >= 2
        ), null, { timeout: 10000 });

        const dayCheck = await page.evaluate(() => {
          const firstPage = document.querySelector('#livre > .page');
          const titles = [...firstPage.querySelectorAll('.entry-title')].map((el) => el.textContent);
          const allDayItem = firstPage.querySelector('.entry-all-day');
          return {
            titles,
            hasAllDayClass: Boolean(allDayItem),
            allDayTimeLabel: allDayItem?.querySelector('.entry-time')?.textContent || '',
          };
        });
        assert.equal(dayCheck.hasAllDayClass, true, 'Classe .entry-all-day attendue');
        assert.equal(dayCheck.allDayTimeLabel, 'Journée entière');
        assert.deepEqual(dayCheck.titles.slice(0, 2), ['Congé Annuel', 'Tôt le matin'],
          `Journée entière doit apparaître avant 00:00 (${dayCheck.titles.join(', ')})`);
      } finally {
        await ctx.close();
      }
    });

    // (i) .ics Export (protected mode password + plaintext warning + RFC 5545)
    await runScenario('i) Export .ics (confirmation mot de passe, avertissement clair, RFC 5545)', async () => {
      const ctx = await driver.newContext();
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        await createEventViaUI(page, {
          title: 'Congé ICS',
          date: '2026-10-21',
          allDay: true,
        });
        await createEventViaUI(page, {
          title: 'Réunion ICS',
          date: '2026-10-05',
          startTime: '09:00',
          endTime: '10:00',
          recurrenceFreq: 'weekly',
          recurrenceInterval: '1',
          recurrenceEndMode: 'count',
          recurrenceCount: '3',
        });

        await enablePasswordViaUI(page, 'mon chat dort');
        await page.click('#bouton-exporter-ics');

        await page.waitForFunction(() => {
          const dlg = document.querySelector('dialog.panel-small[open]');
          return dlg && dlg.textContent.replace(/\s+/g, ' ').includes('Exporter en clair (.ics) ?');
        }, null, { timeout: 10000 });

        const warningText = await page.evaluate(() => (
          (document.querySelector('dialog.panel-small[open]')?.textContent || '').replace(/\s+/g, ' ')
        ));
        assert.ok(warningText.includes('ne permet pas le chiffrement'), 'Avertissement export en clair manquant');

        // Wrong password must fail without download
        await page.fill('dialog.panel-small[open] input[type="password"]', 'mauvais');
        await page.click('dialog.panel-small[open] button[type="submit"]');
        await page.waitForFunction(() => {
          const err = document.querySelector('dialog.panel-small[open] .form-error');
          return err && !err.hidden && err.textContent.includes('Mot de passe incorrect');
        }, null, { timeout: 20000 });

        // Correct password triggers .ics download
        await page.fill('dialog.panel-small[open] input[type="password"]', 'mon chat dort');
        const dl = await page.waitForDownload(() => page.click('dialog.panel-small[open] button[type="submit"]'), 20000);

        assert.match(dl.filename, /^omni-agenda-\d{4}-\d{2}-\d{2}\.ics$/);
        await page.waitForFunction(
          () => Boolean(document.querySelector('#message-sauvegarde .notice')),
          null,
          { timeout: 10000 },
        );
        const noticeText = await page.evaluate(() => document.getElementById('message-sauvegarde')?.textContent || '');
        assert.ok(noticeText.includes("Ce fichier n'est pas chiffré"));

        assert.ok(dl.text.startsWith('BEGIN:VCALENDAR\r\n'), 'ICS doit commencer par BEGIN:VCALENDAR\\r\\n');
        assert.ok(dl.text.endsWith('END:VCALENDAR\r\n'), 'ICS doit finir par END:VCALENDAR\\r\\n');
        assert.equal(/(?<!\r)\n/.test(dl.text), false, 'ICS ne doit contenir aucun \\n nu (RFC 5545 CRLF)');

        const unfolded = dl.text.replace(/\r\n[ \t]/g, '');
        assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20261021'), 'ICS doit contenir DTSTART;VALUE=DATE:20261021');
        assert.ok(unfolded.includes('DTEND;VALUE=DATE:20261022'), 'ICS doit contenir DTEND;VALUE=DATE:20261022');
        assert.ok(unfolded.includes('RRULE:FREQ=WEEKLY;COUNT=3'), 'ICS doit contenir RRULE:FREQ=WEEKLY;COUNT=3');
      } finally {
        await ctx.close();
      }
    });

    // (j) Service Worker registration, cache completeness, offline reload & static reciprocal check
    await runScenario('j) Service Worker (cache complet, rechargement hors ligne, repli navigation, contrôle statique)', async () => {
      const ctx = await driver.newContext();
      try {
        const page = await ctx.newPage();
        await page.goto(baseUrl);
        await waitForUnlockedApp(page);

        const swReady = await page.evaluate(() => Promise.race([
          navigator.serviceWorker.ready.then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), 15000)),
        ]));
        assert.equal(swReady, true, 'Service Worker non prêt dans les 15s');

        const expectedFiles = parseSwFilesFromDisk();
        const cacheAudit = await page.evaluate(async () => {
          const keys = await caches.keys();
          const targetName = keys.find((k) => k.startsWith('omni-agenda-v'));
          if (!targetName) return { keys, targetName: null, paths: [] };
          const cache = await caches.open(targetName);
          const reqs = await cache.keys();
          const paths = reqs.map((r) => new URL(r.url).pathname);
          return { keys, targetName, paths };
        });

        assert.ok(cacheAudit.targetName, `Cache omni-agenda-v* introuvable (trouvé: ${cacheAudit.keys.join(', ')})`);
        const cachedPathSet = new Set(cacheAudit.paths);
        assert.ok(cachedPathSet.has('/__copie-complete__'), 'Marqueur ./__copie-complete__ absent du cache SW');

        for (const file of expectedFiles) {
          const expectedPathname = file === './' ? '/' : `/${file}`;
          assert.ok(cachedPathSet.has(expectedPathname),
            `Fichier SW manquant du Cache Storage: ${file} (${expectedPathname})`);
        }

        // Reload so SW controls page
        await page.reload();
        await waitForUnlockedApp(page);
        const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
        assert.equal(hasController, true, 'navigator.serviceWorker.controller doit être actif après reload()');

        // Enable offline mode on both browser and HTTP server
        ctx.setExpectOfflineErrors(true);
        await ctx.setOffline(true);
        server.setServerOffline(true);
        server.resetOfflineHits();

        await page.reload();
        await waitForUnlockedApp(page);
        const offlineBrand = await page.evaluate(() => document.querySelector('.brand-name')?.textContent || '');
        assert.equal(offlineBrand, 'Omni-Agenda');
        assert.ok(!server.getOfflineHits().includes('/'), 'Le rechargement hors ligne / ne doit pas provenir du serveur');

        await page.goto(`${baseUrl}/url-inexistante-hors-ligne`);
        await waitForUnlockedApp(page);
        const fallbackBrand = await page.evaluate(() => document.querySelector('.brand-name')?.textContent || '');
        assert.equal(fallbackBrand, 'Omni-Agenda', 'Le repli de navigation hors ligne doit servir index.html');
      } finally {
        server.setServerOffline(false);
        ctx.setExpectOfflineErrors(false);
        await ctx.setOffline(false).catch(() => {});
        await ctx.close();
      }

      // Run static reciprocal check (tests/verifier-statique.mjs)
      execFileSync(process.execPath, [path.join(ROOT, 'tests', 'verifier-statique.mjs')], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    });

    // (k) Runtime invariants: 0 external requests, 0 console/page errors
    await runScenario('k) Zéro requête externe et zéro erreur console/pageerror', async () => {
      assert.deepEqual(externalRequests, [], `Requêtes externes détectées: ${externalRequests.join(', ')}`);
      assert.deepEqual(consoleErrors, [], `Erreurs console/pageerror détectées: ${consoleErrors.join(' | ')}`);
    });
  } finally {
    if (driver) {
      await driver.close().catch(() => {});
    }
    if (server) {
      await server.close().catch(() => {});
    }
    removeDirWithRetry(tmpRoot);
  }

  const total = passed + failures.length;
  console.log(`\n${passed}/${total} scénarios E2E réussis.`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
