// Verification driver for SHATTERLANCE (Node 22, standard library only).
// Drives the Playwright Chromium binary over CDP with the built-in
// WebSocket client. No npm packages, no network beyond localhost.
//
//   node tools/capture.mjs shots      capture the 4 staged screenshots
//   node tools/capture.mjs playtest   scripted playtest: start, play,
//                                     pause/resume, draft, boss, victory,
//                                     game over, restart
//   node tools/capture.mjs autopilot  full bot run to a verdict
//
// Every mode reports page errors, console errors and outside requests;
// a non-zero exit means something failed.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`;
const PORT = 8931;
const DEBUG_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jpegSize(buf) {
  // Scan JPEG markers for the SOF frame: width and height.
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = [];
    this.requests = [];
    this.consoleErrors = [];
    this.pageErrors = [];
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg.method, msg.params ?? {});
      }
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(fn) {
    this.handlers.push(fn);
  }

  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
    return r.result?.value;
  }

  async key(type, code, key, keyCode) {
    await this.send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }

  async pressKey(code, key, keyCode) {
    await this.key('rawKeyDown', code, key, keyCode);
    await this.key('keyUp', code, key, keyCode);
  }

  async waitFor(fn, timeoutMs, label) {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
      await sleep(250);
    }
  }
}

async function launchChrome() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--window-size=1280,720',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--user-data-dir=/tmp/shatterlance-chrome-profile',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return chrome;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  chrome.kill();
  throw new Error('chromium did not start');
}

async function newPage(chrome) {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const cdp = new Cdp(ws);
  cdp.on((method, params) => {
    if (method === 'Network.requestWillBeSent') {
      cdp.requests.push(params.request.url);
    } else if (method === 'Runtime.exceptionThrown') {
      cdp.pageErrors.push(JSON.stringify(params.exceptionDetails).slice(0, 500));
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      cdp.consoleErrors.push(params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500));
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      cdp.pageErrors.push(`${params.entry.source}: ${params.entry.text}`.slice(0, 500));
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  return { cdp, targetId: target.id };
}

async function startServer() {
  const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT)], { cwd: HERE, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (res.ok) return server;
    } catch {
      // Not up yet.
    }
    await sleep(250);
  }
  server.kill();
  throw new Error('serve.ts did not start');
}

function report(cdp, label) {
  const outside = cdp.requests.filter((u) => !u.startsWith(`http://127.0.0.1:${PORT}`) && !u.startsWith('data:') && u !== 'about:blank');
  const internalErrors = cdp.pageErrors.filter((e) => !e.includes('favicon'));
  console.log(`--- ${label} ---`);
  console.log(`requests: ${cdp.requests.length} total, ${outside.length} outside localhost`);
  if (outside.length > 0) console.log(`outside: ${outside.join(', ')}`);
  console.log(`page errors: ${internalErrors.length}`);
  for (const e of internalErrors) console.log(`  PAGE ERROR: ${e}`);
  console.log(`console errors: ${cdp.consoleErrors.length}`);
  for (const e of cdp.consoleErrors) console.log(`  CONSOLE ERROR: ${e}`);
  console.log(`game errors: see debug() output`);
  return outside.length === 0 && internalErrors.length === 0 && cdp.consoleErrors.length === 0;
}

async function captureShot(cdp, shot, outDir = join(HERE, 'screenshots')) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html${shot.query}` });
  await cdp.waitFor(async () => cdp.evaluate('window.__shotReady === true'), 30000, `shotReady ${shot.name}`);
  await sleep(200);
  const debug = await cdp.evaluate('window.__shatter && window.__shatter.game ? window.__shatter.game.debug() : null');
  console.log(`${shot.name}: state=${debug?.state} wave=${debug?.wave} enemies=${debug?.enemies} bolts=${debug?.bolts} shots=${debug?.enemyShots} errors=${JSON.stringify(debug?.errors)}`);
  let quality = 80;
  for (;;) {
    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality });
    const buf = Buffer.from(shot1.data, 'base64');
    if (buf.length <= 262144 || quality <= 50) {
      const dims = jpegSize(buf);
      writeFileSync(join(outDir, shot.name), buf);
      console.log(`  wrote ${join(outDir, shot.name)}: ${buf.length} bytes, ${dims ? `${dims.w}x${dims.h}` : 'unknown dims'}, quality ${quality}`);
      return { name: shot.name, bytes: buf.length, dims };
    }
    quality -= 10;
  }
}

async function runShots() {
  const server = await startServer();
  const chrome = await launchChrome();
  let ok = true;
  try {
    const { cdp } = await newPage(chrome);
    const shots = JSON.parse(readFileSync(process.env.SHOTS_FILE ?? join(HERE, 'shots.json'), 'utf8'));
    const outDir = process.env.SHOTS_OUT ?? join(HERE, 'screenshots');
    for (const shot of shots) await captureShot(cdp, shot, outDir);
    ok = report(cdp, 'shots') && ok;
  } finally {
    chrome.kill();
    server.kill();
  }
  if (!ok) process.exitCode = 1;
}

async function runPlaytest() {
  const server = await startServer();
  const chrome = await launchChrome();
  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  try {
    const { cdp } = await newPage(chrome);
    const debug = () => cdp.evaluate('window.__shatter.game.debug()');

    // 1. Title.
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?bot=1` });
    await cdp.waitFor(async () => cdp.evaluate('window.__shotReady === true'), 15000, 'page load');
    let d = await debug();
    check('title screen shows', d.state === 'title', JSON.stringify(d));

    // 2. Launch with Enter, play a few seconds with the bot.
    await cdp.pressKey('Enter', 'Enter', 13);
    await sleep(500);
    d = await debug();
    check('Enter launches the game', d.state === 'playing', `state=${d.state}`);
    await sleep(6000);
    d = await debug();
    check('playing: kills and fire active', d.state === 'playing' && (d.kills > 0 || d.enemies > 0), `enemies=${d.enemies} bolts=${d.bolts} kills=${d.kills} score=${d.score}`);

    // 3. Pause and resume with P.
    await cdp.pressKey('KeyP', 'p', 80);
    await sleep(300);
    d = await debug();
    check('P pauses', d.state === 'paused', `state=${d.state}`);
    await cdp.pressKey('KeyP', 'p', 80);
    await sleep(300);
    d = await debug();
    check('P resumes', d.state === 'playing', `state=${d.state}`);

    // 4. Draft: clear wave 1 for real (bot fights it). The bot picks a card
    // the same frame the draft opens, so the draft state itself is
    // transient here — wave 2 starting with an upgrade applied proves the
    // draft opened and a pick landed. The draft screen itself is verified
    // separately below via the staged ?shot=draft scene.
    await cdp.waitFor(async () => (await debug()).wave >= 2, 120000, 'wave 2 after wave 1');
    d = await debug();
    check('wave 1 clears into wave 2 with an upgrade applied', d.state === 'playing' && d.wave === 2 && Object.values(d.upgrades).some((v) => v > 0), `wave=${d.wave} upgrades=${JSON.stringify(d.upgrades)}`);

    // 4b. Draft screen, staged deterministically: 3 cards, all readable.
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?shot=draft&seed=1` });
    await cdp.waitFor(async () => cdp.evaluate('window.__shotReady === true'), 30000, 'draft shotReady');
    d = await debug();
    check('draft screen shows 3 distinct cards', d.state === 'draft' && d.draftCards.length === 3 && new Set(d.draftCards).size === 3, `cards=${d.draftCards.join(',')}`);

    // 4c. Draft pick by a real key press on the live game. The staged page
    // above is frozen (no game loop), so the pick is tested live: bot off,
    // draft opened, Digit2 pressed, bot back on for the boss fight.
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?bot=1` });
    await cdp.waitFor(async () => cdp.evaluate('window.__shotReady === true'), 15000, 'page reload');
    await cdp.pressKey('Enter', 'Enter', 13);
    await sleep(500);
    await cdp.evaluate('(() => { const g = window.__shatter.game; g.botEnabled = false; g.openDraft(); })()');
    await sleep(200);
    d = await debug();
    check('live draft opens with 3 cards', d.state === 'draft' && d.draftCards.length === 3, `cards=${d.draftCards.join(',')}`);
    const before = await cdp.evaluate('JSON.stringify(window.__shatter.game.upgrades)');
    await cdp.pressKey('Digit2', '2', 50);
    await sleep(400);
    d = await debug();
    const after = await cdp.evaluate('JSON.stringify(window.__shatter.game.upgrades)');
    check('key 2 picks the middle card and wave 2 starts', d.state === 'playing' && d.wave === 2 && before !== after, `state=${d.state} wave=${d.wave} upgrades=${after}`);
    await cdp.evaluate('(() => { window.__shatter.game.botEnabled = true; })()');

    // 5. Boss wave: jump the live game to wave 6 and let the bot fight it.
    await cdp.evaluate(`(() => { const g = window.__shatter.game; g.enemies.length = 0; g.pendingSpawns.length = 0; g.director.queue.length = 0; g.startWave(6); })()`);
    await cdp.waitFor(async () => (await debug()).bossHp !== null, 15000, 'boss spawns');
    d = await debug();
    check('boss spawns on wave 6', d.bossHp !== null && d.bossHp > 0 && d.bossHp <= 240, `bossHp=${d.bossHp}`);
    await cdp.waitFor(async () => {
      const s = await debug();
      return s.state === 'victory' || s.state === 'gameover';
    }, 300000, 'boss verdict');
    d = await debug();
    check('boss fight reaches a verdict', d.state === 'victory' || d.state === 'gameover', `state=${d.state} score=${d.score} kills=${d.kills} bossHp=${d.bossHp}`);

    // 6. Restart with R from the end screen.
    await cdp.pressKey('KeyR', 'r', 82);
    await sleep(500);
    d = await debug();
    check('R restarts from the end screen', d.state === 'playing' && d.wave === 1 && d.score === 0, `state=${d.state} wave=${d.wave}`);

    // 7. Game over: bot off (it would dash through the orb), drop the
    // player to 1 HP and put a real orb exactly on them — the next step's
    // collision path ends the game.
    await cdp.evaluate(`(() => { const g = window.__shatter.game; g.botEnabled = false; g.player.hp = 1; g.player.shield = 0; g.player.invuln = 0; g.enemyShots.push({ id: 999999, kind: 'orb', x: g.player.x, y: g.player.y, vx: 0, vy: 0, radius: 7, life: 6 }); })()`);
    await cdp.waitFor(async () => (await debug()).state === 'gameover', 15000, 'game over');
    d = await debug();
    check('lethal orb hit ends the game', d.state === 'gameover', `state=${d.state} hp=${d.hp}`);
    await cdp.pressKey('KeyR', 'r', 82);
    await sleep(500);
    d = await debug();
    check('R restarts from game over', d.state === 'playing' && d.wave === 1, `state=${d.state}`);

    // 8. Mute toggle.
    await cdp.pressKey('KeyM', 'm', 77);
    await sleep(200);
    const muted = await cdp.evaluate('window.__shatter.game.muted');
    check('M toggles mute', muted === true, `muted=${muted}`);

    const clean = report(cdp, 'playtest');
    check('no page errors, console errors or outside requests', clean);
  } finally {
    chrome.kill();
    server.kill();
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`playtest: ${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exitCode = 1;
}

async function runAutopilot() {
  const server = await startServer();
  const chrome = await launchChrome();
  try {
    const { cdp } = await newPage(chrome);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?bot=1` });
    await cdp.waitFor(async () => cdp.evaluate('window.__shotReady === true'), 15000, 'page load');
    await cdp.pressKey('Enter', 'Enter', 13);
    const started = Date.now();
    let lastLog = 0;
    for (;;) {
      await sleep(2000);
      const d = await cdp.evaluate('window.__shatter.game.debug()');
      const elapsed = (Date.now() - started) / 1000;
      if (elapsed - lastLog >= 20) {
        lastLog = elapsed;
        console.log(`t=${elapsed.toFixed(0)}s state=${d.state} wave=${d.wave} score=${d.score} hp=${d.hp} kills=${d.kills} enemies=${d.enemies} bossHp=${d.bossHp}`);
      }
      if (d.state === 'victory' || d.state === 'gameover') {
        console.log(`AUTOPILOT VERDICT: ${d.state} score=${d.score} kills=${d.kills} wave=${d.wave} time=${elapsed.toFixed(1)}s upgrades=${JSON.stringify(d.upgrades)} errors=${JSON.stringify(d.errors)}`);
        break;
      }
      if (elapsed > 900) {
        console.log(`AUTOPILOT TIMEOUT at ${elapsed.toFixed(0)}s: state=${d.state} wave=${d.wave} score=${d.score}`);
        process.exitCode = 1;
        break;
      }
    }
    report(cdp, 'autopilot');
  } finally {
    chrome.kill();
    server.kill();
  }
}

const mode = process.argv[2];
if (mode === 'shots') await runShots();
else if (mode === 'playtest') await runPlaytest();
else if (mode === 'autopilot') await runAutopilot();
else {
  console.error('usage: node tools/capture.mjs <shots|playtest|autopilot>');
  process.exitCode = 2;
}
