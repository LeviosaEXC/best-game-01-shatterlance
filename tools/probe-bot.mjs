// Probe: run the bot live and log game state every 5s.
// Usage: node tools/probe-bot.mjs [seconds]
import { spawn } from 'node:child_process';

const PORT = 8931;
const DEBUG_PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seconds = Number(process.argv[2] ?? 120);

const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const chrome = spawn(`${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1280,720',
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--user-data-dir=/tmp/shatterlance-probe-profile', 'about:blank',
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
      console.log('EXCEPTION:', JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = id++;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?bot=1` });
  await sleep(1500);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  const started = Date.now();
  for (;;) {
    await sleep(5000);
    const d = await evaluate('window.__shatter.game.debug()');
    const q = await evaluate('({ q: window.__shatter.game.director.queue.length, pending: window.__shatter.game.pendingSpawns.length, px: Math.round(window.__shatter.game.player.x), py: Math.round(window.__shatter.game.player.y) })');
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`t=${elapsed}s state=${d.state} wave=${d.wave} score=${d.score} hp=${d.hp} kills=${d.kills} enemies=${d.enemies} queue=${q.q} pending=${q.pending} player=(${q.px},${q.py}) errors=${JSON.stringify(d.errors)}`);
    if (d.state === 'draft' || d.state === 'gameover' || d.state === 'victory') break;
    if (Date.now() - started > seconds * 1000) break;
  }
} finally {
  chrome.kill();
  server.kill();
}
