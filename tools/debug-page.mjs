// One-off page probe: load a URL, dump console/page errors and window state.
// Usage: node tools/debug-page.mjs "<url>" [waitMs]
import { spawn } from 'node:child_process';

const PORT = 8931;
const DEBUG_PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.argv[2];
const waitMs = Number(process.argv[3] ?? 5000);

const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const chrome = spawn(`${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1280,720',
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--user-data-dir=/tmp/shatterlance-debug-profile', 'about:blank',
], { stdio: 'ignore' });

try {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (res.ok) break;
    } catch { /* not up */ }
    await sleep(250);
  }
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) break;
    } catch { /* not up */ }
    await sleep(500);
  }
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.log('EXCEPTION:', JSON.stringify(msg.params.exceptionDetails).slice(0, 2000));
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      console.log(`CONSOLE ${msg.params.type}:`, msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 1000));
    } else if (msg.method === 'Log.entryAdded') {
      console.log(`LOG ${msg.params.entry.level}:`, msg.params.entry.text.slice(0, 1000));
    } else if (msg.method === 'Network.loadingFailed') {
      console.log('NET FAIL:', msg.params.errorText);
    } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      console.log('HTTP', msg.params.response.status, msg.params.response.url);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = id++;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(waitMs);
  const evalRes = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ ready: window.__shotReady, hasGame: !!window.__shatter, state: window.__shatter ? window.__shatter.game.state : null, errors: window.__shatter ? window.__shatter.game.errors : null })`,
    returnByValue: true,
  });
  console.log('STATE:', evalRes.result?.value);
  const evalRes2 = await send('Runtime.evaluate', {
    expression: `(() => { try { return document.documentElement.outerHTML.slice(0, 400); } catch (e) { return String(e); } })()`,
    returnByValue: true,
  });
  console.log('HTML:', evalRes2.result?.value);
} finally {
  chrome.kill();
  server.kill();
}
