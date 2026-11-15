// SHATTERLANCE — game orchestration: fixed 60 Hz timestep, state machine,
// collisions, scoring, wave flow, upgrades, and the boot code that wires the
// canvas to the page. Rendering lives in render.js, audio in audio.js.

import {
  ARENA, ARENA_BOTTOM, ARENA_RIGHT, LANCE, OVERDRIVE, PALETTE,
  PLAYER, PICKUPS, SCORING, SEED, STEP, UPGRADES,
} from './config.js';
import { Mulberry32, clamp, dist } from './random.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import {
  clampToArena, makeBolt, makeEnemy,
  makeFloatText, makeLance, makeParticles, makePlayer, makeRing, rollDrop,
  stepEnemy,
} from './entities.js';
import { WaveDirector, bossNodeHit, bulwarkShieldBlocks } from './waves.js';
import { Renderer, draftCardRects } from './render.js';
import { botDrive } from './bot.js';

const BEST_KEY = 'shatterlance-best';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.rng = new Mulberry32(SEED);
    this.state = 'title';
    this.time = 0;
    this.playTime = 0;
    this.best = 0;
    try {
      this.best = Number(window.localStorage.getItem(BEST_KEY) ?? 0) || 0;
    } catch {
      this.best = 0;
    }
    this.muted = false;
    this.player = makePlayer();
    this.enemies = [];
    this.bolts = [];
    this.enemyShots = [];
    this.pickups = [];
    this.particles = [];
    this.rings = [];
    this.floatTexts = [];
    this.lightning = [];
    this.pendingSpawns = [];
    this.director = new WaveDirector(this.rng);
    this.boss = null;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.combo = 1.0;
    this.comboTimer = 0;
    this.upgrades = {};
    for (const u of UPGRADES) this.upgrades[u.id] = 0;
    this.draftCards = [];
    this.draftSelected = -1;
    this.bannerText = '';
    this.bannerTimer = 0;
    this.trauma = 0;
    this.frameFlash = 0;
    this.frameColor = PALETTE.frame;
    this.finaleTimer = 0;
    this.timeScale = 1;
    this.victoryStats = null;
    this.lanceReadyTimer = 0;
    this.botEnabled = false;
    this.demoEnemies = [];
    this.buildTitleDemo();
    this.errors = [];
  }

  // ------------------------------------------------------------ setup

  buildTitleDemo() {
    this.demoEnemies = [];
    const kinds = ['swarmer', 'gunner', 'charger', 'weaver', 'bulwark'];
    for (let i = 0; i < 7; i++) {
      const e = makeEnemy(kinds[i % kinds.length], 0, 0, this.rng);
      e.orbitR = 150 + i * 32;
      e.orbitSpeed = 0.25 + i * 0.05;
      e.orbitAngle = (i / 7) * Math.PI * 2;
      this.demoEnemies.push(e);
    }
  }

  resetRun(seed) {
    this.rng = new Mulberry32((SEED ^ (seed >>> 0)) >>> 0);
    this.director = new WaveDirector(this.rng);
    this.player = makePlayer();
    this.enemies = [];
    this.bolts = [];
    this.enemyShots = [];
    this.pickups = [];
    this.particles = [];
    this.rings = [];
    this.floatTexts = [];
    this.lightning = [];
    this.pendingSpawns = [];
    this.boss = null;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.combo = 1.0;
    this.comboTimer = 0;
    this.upgrades = {};
    for (const u of UPGRADES) this.upgrades[u.id] = 0;
    this.draftCards = [];
    this.draftSelected = -1;
    this.bannerText = '';
    this.bannerTimer = 0;
    this.trauma = 0;
    this.frameFlash = 0;
    this.finaleTimer = 0;
    this.timeScale = 1;
    this.victoryStats = null;
    this.playTime = 0;
    this.time = 0;
    this.buildTitleDemo();
  }

  saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      try {
        window.localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        // Storage unavailable (private mode): best score just stays in memory.
      }
    }
  }

  startGame() {
    this.audio.ensure();
    this.audio.startMusic();
    this.resetRun(1);
    this.state = 'playing';
    this.startWave(1);
  }

  startWave(n) {
    this.wave = n;
    this.director.startWave(n);
    this.bannerText = n === 6 ? 'WAVE 6 — THE CRIMSON ARCHITECT' : `WAVE ${n}`;
    this.bannerTimer = 2.2;
    if (n === 6) this.audio.bossSiren();
  }

  openDraft() {
    const available = UPGRADES.filter((u) => this.upgrades[u.id] < u.max);
    const picks = [];
    const pool = [...available];
    while (picks.length < 3 && pool.length > 0) {
      const i = Math.floor(this.rng.next() * pool.length);
      picks.push(pool.splice(i, 1)[0]);
    }
    this.draftCards = picks.map((u) => ({ ...u, owned: this.upgrades[u.id] }));
    this.draftSelected = -1;
    this.state = 'draft';
    this.audio.draft();
  }

  selectDraft(index) {
    if (this.state !== 'draft') return;
    if (index < 0 || index >= this.draftCards.length) return;
    const card = this.draftCards[index];
    this.applyUpgrade(card.id);
    this.audio.draft();
    this.state = 'playing';
    this.startWave(this.wave + 1);
  }

  applyUpgrade(id) {
    this.upgrades[id] = Math.min(this.upgrades[id] + 1, UPGRADES.find((u) => u.id === id).max);
    if (id === 'hull') {
      this.player.maxHp += 1;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2);
      this.player.shield = Math.min(this.player.maxShield, this.player.shield + 1);
    }
  }

  get dashCooldownMax() {
    return PLAYER.dashCooldown * Math.pow(0.7, this.upgrades.tempest);
  }

  get fireInterval() {
    const base = PLAYER.fireInterval / (1 + 0.25 * this.upgrades.overclock);
    return this.player.overdrive > 0 ? base / OVERDRIVE.fireRateMul : base;
  }

  get moveSpeed() {
    const base = PLAYER.speed * (1 + 0.12 * this.upgrades.overclock);
    return this.player.overdrive > 0 ? base * OVERDRIVE.speedMul : base;
  }

  get magnetRadius() {
    return PICKUPS.magnetBase * Math.pow(2, this.upgrades.magnetic);
  }

  get overdriveGainMul() {
    return 1 + 0.5 * this.upgrades.magnetic;
  }

  // ------------------------------------------------------------ combat

  addCombo(amount) {
    this.combo = Math.min(SCORING.comboMax, this.combo + amount);
    this.comboTimer = SCORING.comboIdleReset;
  }

  addScore(amount, x, y, label) {
    const gained = Math.round(amount * this.combo);
    this.score += gained;
    if (x !== undefined) {
      this.floatTexts.push(makeFloatText(x, y, `+${gained}${label ? ` ${label}` : ''}`, '#eaf4ff', 15));
    }
    return gained;
  }

  damageEnemy(e, amount) {
    e.hp -= amount;
    e.flash = 0.06;
    if (e.hp <= 0) {
      this.killEnemy(e);
      return true;
    }
    return false;
  }

  killEnemy(e) {
    const index = this.enemies.indexOf(e);
    if (index !== -1) this.enemies.splice(index, 1);
    this.kills++;
    this.addCombo(0.15);
    this.addScore(e.score, e.x, e.y - e.radius - 8);
    this.particles.push(...makeParticles(e.x, e.y, e.color, e.kind === 'bulwark' ? 26 : 16, this.rng, 260, 0.7));
    this.rings.push(makeRing(e.x, e.y, e.color, 70, 0.4));
    this.audio.shatter(e.maxHp >= 8);
    const drop = rollDrop(e, this.player, this.rng, this.upgrades);
    if (drop) this.pickups.push(drop);
  }

  damageBoss(amount, fromLance) {
    const boss = this.boss;
    if (!boss || boss.hp <= 0) return;
    boss.hp -= amount;
    boss.flash = 0.06;
    if (boss.hp <= 0) {
      this.bossDefeated();
    }
  }

  bossDefeated() {
    this.addScore(this.boss.score, this.boss.x, this.boss.y - 70);
    this.kills++;
    this.particles.push(...makeParticles(this.boss.x, this.boss.y, '#ff0033', 90, this.rng, 420, 1.2));
    this.particles.push(...makeParticles(this.boss.x, this.boss.y, '#ffd500', 60, this.rng, 320, 1.0));
    this.rings.push(makeRing(this.boss.x, this.boss.y, '#ffd500', 260, 0.8));
    this.rings.push(makeRing(this.boss.x, this.boss.y, '#ff0033', 200, 0.7));
    this.audio.shatter(true);
    this.trauma = 1;
    this.enemyShots = [];
    this.state = 'finale';
    this.finaleTimer = 1.0;
    this.timeScale = 0.35;
  }

  damagePlayer() {
    const p = this.player;
    if (p.invuln > 0 || !p.alive) return;
    if (p.shield > 0) {
      p.shield -= 1;
      p.invuln = PLAYER.shieldInvuln;
      this.frameFlash = 0.4;
      this.frameColor = PALETTE.frameShield;
      this.audio.shieldClang();
      this.floatTexts.push(makeFloatText(p.x, p.y - 26, 'SHIELD ABSORB', '#55aaff', 15));
      return;
    }
    p.hp -= 1;
    this.combo = Math.max(1, this.combo / 2);
    p.invuln = PLAYER.hurtInvuln;
    this.trauma = 1;
    this.frameFlash = 0.5;
    this.frameColor = PALETTE.frameHurt;
    this.audio.hurt();
    this.particles.push(...makeParticles(p.x, p.y, '#ff2a4b', 18, this.rng, 280, 0.7));
    if (p.hp <= 0) {
      p.alive = false;
      this.saveBest();
      this.state = 'gameover';
      this.audio.gameOver();
      this.audio.stopMusic();
    }
  }

  throwLance() {
    const p = this.player;
    const angle = this.input.aimAngle(p.x, p.y);
    const bounces = LANCE.bounces + 2 * this.upgrades.ricochet;
    const speedMul = 1 + 0.25 * this.upgrades.ricochet;
    p.lance = makeLance(p.x + Math.cos(angle) * 20, p.y + Math.sin(angle) * 20, angle, bounces, speedMul);
    this.audio.lanceThrow();
  }

  // ------------------------------------------------------------ one fixed step

  step(dt) {
    this.time += dt;
    if (this.bannerTimer > 0) this.bannerTimer -= dt;
    if (this.frameFlash > 0) this.frameFlash -= dt;
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - dt * 1.4);

    if (this.state === 'title') {
      for (const e of this.demoEnemies) {
        e.orbitAngle += e.orbitSpeed * dt;
        e.x = 640 + Math.cos(e.orbitAngle) * e.orbitR;
        e.y = 390 + Math.sin(e.orbitAngle) * (e.orbitR * 0.62);
        e.angle += dt * 0.5;
        e.t += dt;
      }
      if (this.input.hit('Enter') || this.input.hit('Space') || this.input.mousePressed) {
        this.startGame();
      }
      return;
    }
    if (this.state === 'paused') {
      if (this.input.hit('KeyP') || this.input.hit('Escape') || this.input.hit('KeyR')) {
        if (this.input.hit('KeyR')) this.startGame();
        else this.state = 'playing';
      }
      this.handleHudClicks();
      return;
    }
    if (this.state === 'draft') {
      if (this.input.hit('Digit1')) this.selectDraft(0);
      else if (this.input.hit('Digit2')) this.selectDraft(1);
      else if (this.input.hit('Digit3')) this.selectDraft(2);
      if (this.input.mousePressed) {
        const rects = draftCardRects();
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (this.input.mouseX >= r.x && this.input.mouseX <= r.x + r.w && this.input.mouseY >= r.y && this.input.mouseY <= r.y + r.h) {
            this.selectDraft(i);
            break;
          }
        }
      }
      return;
    }
    if (this.state === 'victory' || this.state === 'gameover') {
      if (this.input.hit('KeyR') || this.input.hit('Enter') || this.input.hit('Space')) this.startGame();
      return;
    }
    if (this.state === 'finale') {
      this.finaleTimer -= dt / this.timeScale;
      this.updateParticles(dt);
      if (this.finaleTimer <= 0) {
        this.timeScale = 1;
        this.state = 'victory';
        this.saveBest();
        const rank = SCORING.ranks.find((r) => this.score >= r.min).rank;
        this.victoryStats = { score: this.score, rank, kills: this.kills, time: this.playTime, best: this.best };
        this.audio.victory();
      }
      return;
    }

    // --- playing
    this.playTime += dt;
    this.stepPlaying(dt);
  }

  stepPlaying(dt) {
    const p = this.player;
    const input = this.input;

    // Global keys.
    if (input.hit('KeyM')) {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
    }
    if (input.hit('KeyP') || input.hit('Escape')) {
      this.state = 'paused';
      return;
    }
    if (input.hit('KeyR')) {
      this.startGame();
      return;
    }
    this.handleHudClicks();

    // Combo decay.
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1.0;
    }

    // --- movement and dash
    const move = input.moveVector();
    p.angle = input.aimAngle(p.x, p.y);
    if (p.dashCooldown > 0) p.dashCooldown -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.overdrive > 0) p.overdrive -= dt;
    if ((input.hit('Space') || input.hit('ShiftLeft') || input.hit('ShiftRight')) && p.dashCooldown <= 0 && p.dashTimer <= 0) {
      const dx = move.x !== 0 || move.y !== 0 ? move.x : Math.cos(p.angle);
      const dy = move.x !== 0 || move.y !== 0 ? move.y : Math.sin(p.angle);
      const m = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      p.dashDirX = dx / m;
      p.dashDirY = dy / m;
      p.dashTimer = PLAYER.dashTime;
      p.dashCooldown = this.dashCooldownMax;
      p.invuln = Math.max(p.invuln, PLAYER.dashInvuln);
      this.audio.dash();
    }
    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      p.x += p.dashDirX * PLAYER.dashSpeed * dt;
      p.y += p.dashDirY * PLAYER.dashSpeed * dt;
      p.dashTrail.push({ x: p.x, y: p.y, angle: p.angle, life: 0.3 });
      // Vaporize bullets within 46px while dashing.
      for (let i = this.enemyShots.length - 1; i >= 0; i--) {
        const s = this.enemyShots[i];
        if (dist(p.x, p.y, s.x, s.y) < PLAYER.dashVaporizeRadius) {
          this.enemyShots.splice(i, 1);
          this.addCombo(0.1);
          this.addScore(SCORING.grazeScore, s.x, s.y, 'VAPORIZED');
          p.overdriveCharge = Math.min(1, p.overdriveCharge + 0.08 * this.overdriveGainMul);
          this.particles.push(...makeParticles(s.x, s.y, '#88ffff', 6, this.rng, 160, 0.4));
          this.audio.graze();
        }
      }
      if (p.dashTimer <= 0 && this.upgrades.tempest > 0) {
        // Tempest shockwave on arrival.
        this.rings.push(makeRing(p.x, p.y, '#00f0ff', 110, 0.45));
        for (const e of [...this.enemies]) {
          if (dist(p.x, p.y, e.x, e.y) < 110) this.damageEnemy(e, 1.5);
        }
        if (this.boss && dist(p.x, p.y, this.boss.x, this.boss.y) < 110 + this.boss.radius) {
          this.damageBoss(1.5, false);
        }
      }
    } else {
      p.x += move.x * this.moveSpeed * dt;
      p.y += move.y * this.moveSpeed * dt;
    }
    clampToArena(p, PLAYER.radius);
    p.thruster += dt;
    for (const g of p.dashTrail) g.life -= dt;
    p.dashTrail = p.dashTrail.filter((g) => g.life > 0);

    // --- primary fire
    p.fireTimer -= dt;
    if (input.mouseDown && p.fireTimer <= 0) {
      p.fireTimer = this.fireInterval;
      p.boltCount++;
      const twin = this.upgrades.twin > 0;
      const dmg = p.overdrive > 0 ? PLAYER.boltDamageOverdrive : PLAYER.boltDamage;
      const offsets = twin ? [-6, 6] : [0];
      for (const off of offsets) {
        const px = -Math.sin(p.angle) * off;
        const py = Math.cos(p.angle) * off;
        this.bolts.push(makeBolt(p.x + Math.cos(p.angle) * 20 + px, p.y + Math.sin(p.angle) * 20 + py, p.angle, twin ? PLAYER.twinDamage : dmg, twin));
      }
      this.audio.shoot(p.overdrive > 0);
    }

    // --- lance
    if (input.rightPressed || input.hit('KeyE')) {
      if (!p.lance) this.throwLance();
      else if (p.lance.state !== 'return') p.lance.state = 'return';
    }
    this.stepLance(dt);

    // --- overdrive
    if ((input.hit('KeyQ') || input.hit('KeyF')) && p.overdriveCharge >= 1 && p.overdrive <= 0) {
      p.overdrive = OVERDRIVE.duration + 2.5 * this.upgrades.overclock;
      p.overdriveCharge = 0;
      this.audio.overdrive();
      this.rings.push(makeRing(p.x, p.y, '#ffe666', 280, 0.6));
      for (let i = this.enemyShots.length - 1; i >= 0; i--) {
        const s = this.enemyShots[i];
        if (dist(p.x, p.y, s.x, s.y) < OVERDRIVE.clearRadius) {
          this.enemyShots.splice(i, 1);
          this.addCombo(0.1);
          this.addScore(SCORING.grazeScore, s.x, s.y, 'CLEARED');
          this.particles.push(...makeParticles(s.x, s.y, '#ffe666', 5, this.rng, 150, 0.4));
        }
      }
    }

    // --- waves and spawns
    const spawn = [];
    const events = {};
    this.director.step(dt, p, spawn, events);
    for (const s of spawn) this.pendingSpawns.push(s);
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const s = this.pendingSpawns[i];
      s.delay -= dt;
      if (s.delay <= 0) {
        this.pendingSpawns.splice(i, 1);
        this.enemies.push(makeEnemy(s.kind, s.x, s.y, this.rng));
      }
    }
    if (this.wave === 6 && this.director.bossSpawned && !this.boss) {
      this.boss = this.director.boss;
    }
    if (this.boss) {
      const bossEvents = {};
      const bossSpawn = [];
      this.director.stepBoss(this.boss, p, dt, this.enemyShots, bossSpawn, bossEvents);
      for (const s of bossSpawn) this.pendingSpawns.push(s);
      if (bossEvents.phase2) {
        this.floatTexts.push(makeFloatText(this.boss.x, this.boss.y - 80, 'PHASE 2 — NODES REGENERATED', '#ff8899', 18));
        this.audio.bossSiren();
      }
      if (bossEvents.beamTelegraph) this.audio.bossSiren();
    }

    // --- enemies
    const enemyEvents = {};
    for (const e of [...this.enemies]) {
      stepEnemy(e, p, dt, this.rng, this.enemyShots, enemyEvents);
    }
    // Enemy contact with the player.
    for (const e of [...this.enemies]) {
      if (dist(p.x, p.y, e.x, e.y) < e.radius + PLAYER.hitRadius) {
        if (p.invuln <= 0) this.damagePlayer();
        if (e.kind === 'swarmer') {
          this.killEnemy(e);
        } else if (e.hp > 0) {
          this.damageEnemy(e, 2);
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          e.x += (dx / d) * 40;
          e.y += (dy / d) * 40;
        }
        if (!p.alive) break;
      }
    }

    // --- bolts
    this.stepBolts(dt);
    // --- enemy shots
    this.stepEnemyShots(dt);
    // --- pickups
    this.stepPickups(dt);
    // --- fx
    this.updateParticles(dt);

    // --- wave clear
    if (p.alive && this.wave > 0 && this.wave < 6 && this.director.queue.length === 0 && this.pendingSpawns.length === 0 && this.enemies.length === 0 && this.state === 'playing') {
      const bonus = SCORING.waveClearBonus * this.wave;
      this.score += bonus;
      this.floatTexts.push(makeFloatText(640, 340, `WAVE ${this.wave} CLEAR  +${bonus}`, '#ffd500', 22));
      this.audio.waveClear();
      this.openDraft();
    }
  }

  stepLance(dt) {
    const p = this.player;
    const lance = p.lance;
    if (!lance) return;
    lance.trail.push({ x: lance.x, y: lance.y });
    if (lance.trail.length > 14) lance.trail.shift();
    if (lance.state === 'out') {
      lance.x += lance.vx * dt;
      lance.y += lance.vy * dt;
      let bounced = false;
      if (lance.x < ARENA.x + 8) {
        lance.x = ARENA.x + 8;
        lance.vx = Math.abs(lance.vx);
        bounced = true;
      } else if (lance.x > ARENA_RIGHT - 8) {
        lance.x = ARENA_RIGHT - 8;
        lance.vx = -Math.abs(lance.vx);
        bounced = true;
      }
      if (lance.y < ARENA.y + 8) {
        lance.y = ARENA.y + 8;
        lance.vy = Math.abs(lance.vy);
        bounced = true;
      } else if (lance.y > ARENA_BOTTOM - 8) {
        lance.y = ARENA_BOTTOM - 8;
        lance.vy = -Math.abs(lance.vy);
        bounced = true;
      }
      if (bounced) {
        lance.bouncesLeft -= 1;
        lance.damageMul *= 1 + LANCE.bounceDamageBonus;
        lance.angle = Math.atan2(lance.vy, lance.vx);
        this.frameFlash = 0.25;
        this.frameColor = PALETTE.frameLance;
        this.audio.lanceBounce();
        if (this.upgrades.shatter > 0) this.lanceBlast(lance.x, lance.y);
        if (lance.bouncesLeft < 0) lance.state = 'hover';
      }
    } else if (lance.state === 'hover') {
      lance.hoverTimer -= dt;
      if (lance.hoverTimer <= 0) lance.state = 'return';
    } else {
      // Return to the player.
      const dx = p.x - lance.x;
      const dy = p.y - lance.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const speed = LANCE.speedBack * lance.speedMul;
      lance.x += (dx / d) * speed * dt;
      lance.y += (dy / d) * speed * dt;
      lance.angle = Math.atan2(dy, dx);
      if (d < 26) {
        p.lance = null;
        p.dashCooldown = Math.max(0, p.dashCooldown - PLAYER.lanceCatchDashRefund);
        this.audio.lanceCatch();
        return;
      }
    }
    // Lance hits: pierces everything, including bulwark shields and boss nodes.
    const dmg = LANCE.damage * lance.damageMul;
    for (const e of [...this.enemies]) {
      if (lance.hitIds.has(e.id)) continue;
      if (dist(lance.x, lance.y, e.x, e.y) < e.radius + 12) {
        lance.hitIds.add(e.id);
        this.damageEnemy(e, dmg);
        this.audio.hit();
        if (this.upgrades.shatter > 0) this.lanceBlast(e.x, e.y);
      }
    }
    if (this.boss && this.boss.hp > 0) {
      // Nodes first: the lance shatters them on contact.
      const hitNode = bossNodeHit(this.boss, lance.x, lance.y, 12);
      if (hitNode && !lance.hitIds.has(`node-${hitNode.angle}`)) {
        lance.hitIds.add(`node-${hitNode.angle}`);
        hitNode.hp -= dmg;
        this.boss.flash = 0.06;
        this.audio.hit();
        if (hitNode.hp <= 0) {
          hitNode.alive = false;
          this.addCombo(0.15);
          this.addScore(100, this.boss.x, this.boss.y - 70, 'NODE DOWN');
          this.particles.push(...makeParticles(lance.x, lance.y, '#ffd500', 20, this.rng, 280, 0.7));
          this.audio.shatter(false);
        }
        if (this.upgrades.shatter > 0) this.lanceBlast(lance.x, lance.y);
      } else if (dist(lance.x, lance.y, this.boss.x, this.boss.y) < this.boss.radius + 12 && !lance.hitIds.has('boss')) {
        lance.hitIds.add('boss');
        this.damageBoss(dmg, true);
        this.audio.hit();
      }
    }
  }

  lanceBlast(x, y) {
    this.rings.push(makeRing(x, y, '#ff7b00', 90, 0.4));
    this.particles.push(...makeParticles(x, y, '#ff7b00', 14, this.rng, 240, 0.5));
    for (const e of [...this.enemies]) {
      if (dist(x, y, e.x, e.y) < 80) this.damageEnemy(e, 2.0);
    }
    if (this.boss && dist(x, y, this.boss.x, this.boss.y) < 80 + this.boss.radius) {
      this.damageBoss(2.0, true);
    }
  }

  stepBolts(dt) {
    const p = this.player;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = b.life <= 0 || b.x < ARENA.x || b.x > ARENA_RIGHT || b.y < ARENA.y || b.y > ARENA_BOTTOM;
      if (!dead) {
        // Boss nodes block frontal bolts; the lance pierces them.
        if (this.boss && this.boss.hp > 0) {
          const node = bossNodeHit(this.boss, b.x, b.y, 4);
          if (node) {
            node.hp -= b.damage;
            this.boss.flash = 0.06;
            this.audio.hit();
            if (node.hp <= 0) {
              node.alive = false;
              this.addCombo(0.15);
              this.addScore(100, b.x, b.y - 10, 'NODE DOWN');
              this.particles.push(...makeParticles(b.x, b.y, '#ffd500', 18, this.rng, 260, 0.6));
              this.audio.shatter(false);
            }
            dead = true;
          } else if (dist(b.x, b.y, this.boss.x, this.boss.y) < this.boss.radius + 4) {
            if (this.boss.nodes.some((n) => n.alive)) {
              // Nodes still up: the bolt is absorbed by the armor field.
              this.particles.push(...makeParticles(b.x, b.y, '#ff8899', 4, this.rng, 120, 0.3));
              dead = true;
            } else {
              this.damageBoss(b.damage, false);
              this.audio.hit();
              dead = true;
            }
          }
        }
        if (!dead) {
          for (const e of [...this.enemies]) {
            if (dist(b.x, b.y, e.x, e.y) < e.radius + 5) {
              if (e.kind === 'bulwark' && bulwarkShieldBlocks(e, b.x - b.vx * 0.02, b.y - b.vy * 0.02)) {
                this.particles.push(...makeParticles(b.x, b.y, '#ffffff', 5, this.rng, 140, 0.3));
                this.audio.shieldClang();
              } else {
                const killed = this.damageEnemy(e, b.damage);
                this.audio.hit();
                // Arc Conductor: every 4th bolt chains to 2 nearby foes.
                if (this.upgrades.arc > 0 && p.boltCount % 4 === 0) {
                  this.chainLightning(e, b);
                }
                void killed;
              }
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) this.bolts.splice(i, 1);
    }
  }

  chainLightning(fromEnemy, bolt) {
    const near = [...this.enemies]
      .filter((e) => e !== fromEnemy)
      .sort((a, b) => dist(fromEnemy.x, fromEnemy.y, a.x, a.y) - dist(fromEnemy.x, fromEnemy.y, b.x, b.y))
      .filter((e) => dist(fromEnemy.x, fromEnemy.y, e.x, e.y) < 200)
      .slice(0, 2);
    let sx = fromEnemy.x;
    let sy = fromEnemy.y;
    for (const e of near) {
      this.lightning.push({ x1: sx, y1: sy, x2: e.x, y2: e.y, life: 0.15 });
      this.damageEnemy(e, 1.0);
      sx = e.x;
      sy = e.y;
    }
    void bolt;
  }

  stepEnemyShots(dt) {
    const p = this.player;
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const s = this.enemyShots[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      const d = dist(p.x, p.y, s.x, s.y);
      if (s.life <= 0 || s.x < ARENA.x - 20 || s.x > ARENA_RIGHT + 20 || s.y < ARENA.y - 20 || s.y > ARENA_BOTTOM + 20) {
        this.enemyShots.splice(i, 1);
        continue;
      }
      // Graze: a bullet that passes within 40px without hitting.
      if (s.prevD !== undefined && !s.grazed && s.prevD < 40 && d > s.prevD && p.invuln <= 0) {
        s.grazed = true;
        this.addCombo(0.1);
        this.addScore(SCORING.grazeScore, s.x, s.y, 'GRAZE');
        p.overdriveCharge = Math.min(1, p.overdriveCharge + 0.06 * this.overdriveGainMul);
        this.audio.graze();
      }
      s.prevD = d;
      if (d < s.radius + PLAYER.hitRadius && p.invuln <= 0) {
        this.enemyShots.splice(i, 1);
        this.damagePlayer();
        if (!p.alive) return;
      }
    }
  }

  stepPickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.life -= dt;
      if (pk.life <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }
      const d = dist(p.x, p.y, pk.x, pk.y);
      if (d < this.magnetRadius) {
        const pull = 340 * dt;
        pk.x += ((p.x - pk.x) / Math.max(1, d)) * pull;
        pk.y += ((p.y - pk.y) / Math.max(1, d)) * pull;
      }
      if (d < pk.radius + 14) {
        this.pickups.splice(i, 1);
        if (pk.kind === 'repair') {
          p.hp = Math.min(p.maxHp, p.hp + 1);
          this.floatTexts.push(makeFloatText(p.x, p.y - 26, '+1 HULL', '#22ff66', 15));
          this.audio.heal();
        } else if (pk.kind === 'shield') {
          p.shield = Math.min(p.maxShield, p.shield + 1);
          this.floatTexts.push(makeFloatText(p.x, p.y - 26, '+1 SHIELD', '#55aaff', 15));
          this.audio.shieldPickup();
        } else {
          this.addCombo(0.1);
          this.addScore(SCORING.sparkScore, pk.x, pk.y - 10, 'SPARK');
          p.overdriveCharge = Math.min(1, p.overdriveCharge + PICKUPS.sparkOverdrive * this.overdriveGainMul);
          this.audio.spark();
        }
        this.particles.push(...makeParticles(pk.x, pk.y, '#f4f8ff', 8, this.rng, 150, 0.4));
      }
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.98;
      pt.vy *= 0.98;
      pt.angle += pt.spin * dt;
      pt.life -= dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      r.radius += (r.maxRadius - r.radius) * dt * 8;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const t = this.floatTexts[i];
      t.y -= 34 * dt;
      t.life -= dt;
      if (t.life <= 0) this.floatTexts.splice(i, 1);
    }
    for (let i = this.lightning.length - 1; i >= 0; i--) {
      this.lightning[i].life -= dt;
      if (this.lightning[i].life <= 0) this.lightning.splice(i, 1);
    }
  }

  handleHudClicks() {
    if (!this.input.mousePressed) return;
    const { mouseX, mouseY } = this.input;
    if (mouseX >= 1050 && mouseX <= 1146 && mouseY >= 12 && mouseY <= 52) {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
    } else if (mouseX >= 1158 && mouseX <= 1254 && mouseY >= 12 && mouseY <= 52) {
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
    }
  }

  // ------------------------------------------------------------ render

  render() {
    const r = this.renderer;
    const p = this.player;
    r.clear();
    const shakeX = Math.sin(this.time * 61) * this.trauma * this.trauma * 10;
    const shakeY = Math.cos(this.time * 53) * this.trauma * this.trauma * 10;
    const ctx = r.ctx;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    r.drawArena(this.frameFlash > 0 ? this.frameColor : PALETTE.frame, 0, 0);
    r.drawWarnings(this.director.warnings);
    r.drawPickups(this.pickups, this.time);
    if (this.state === 'title') {
      for (const e of this.demoEnemies) r.drawEnemy(e, this.time);
    } else {
      for (const e of this.enemies) r.drawEnemy(e, this.time);
      if (this.boss) r.drawBoss(this.boss, this.time);
    }
    r.drawBolts(this.bolts, p.overdrive > 0);
    r.drawLance(p.lance);
    r.drawEnemyShots(this.enemyShots);
    r.drawParticles(this.particles);
    r.drawRings(this.rings);
    r.drawFloatTexts(this.floatTexts);
    for (const l of this.lightning) r.drawArcLightning(l.x1, l.y1, l.x2, l.y2, this.rng);
    if (this.state !== 'title' && p.alive) r.drawPlayer(p, this.time);
    ctx.restore();

    if (this.state !== 'title') {
      r.drawHud({
        player: p,
        dashCooldownMax: this.dashCooldownMax,
        wave: Math.max(1, this.wave),
        combo: this.combo,
        score: this.score,
        best: this.best,
        muted: this.muted,
        paused: this.state === 'paused',
      });
    }
    if (this.bannerTimer > 0 && (this.state === 'playing' || this.state === 'finale')) {
      const alpha = Math.min(1, this.bannerTimer / 0.6, (2.2 - this.bannerTimer) / 0.3 + 0.2);
      r.drawWaveBanner(this.bannerText, Math.max(0, Math.min(1, alpha)));
    }
    if (this.state === 'title') {
      r.drawTitle(this.best, this.time);
    } else if (this.state === 'draft') {
      r.drawDraft(this.draftCards, this.draftSelected);
    } else if (this.state === 'paused') {
      r.drawPause();
    } else if (this.state === 'victory' && this.victoryStats) {
      const v = this.victoryStats;
      r.drawVictory(v.score, v.rank, v.kills, v.time, v.best);
    } else if (this.state === 'gameover') {
      r.drawGameOver(this.score, this.wave, this.kills, this.best);
    }
    if (this.state === 'playing') {
      r.drawCrosshair(this.input.mouseX, this.input.mouseY);
      const dashFrac = p.dashCooldown <= 0 ? 1 : 1 - p.dashCooldown / this.dashCooldownMax;
      r.drawCursorDashArc(p, dashFrac);
    }
  }

  // One fixed step plus input bookkeeping, as the live loop and the staging
  // driver both call it.
  fixedStep() {
    if (this.botEnabled) botDrive(this);
    this.step(STEP * this.timeScale);
    this.input.endFrame();
  }

  // Debug snapshot for the verification driver.
  debug() {
    return {
      state: this.state,
      wave: this.wave,
      score: this.score,
      best: this.best,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      shield: this.player.shield,
      kills: this.kills,
      combo: Number(this.combo.toFixed(2)),
      enemies: this.enemies.length,
      bossHp: this.boss ? this.boss.hp : null,
      bolts: this.bolts.length,
      enemyShots: this.enemyShots.length,
      pickups: this.pickups.length,
      overdrive: Number(this.player.overdriveCharge.toFixed(2)),
      overdriveActive: this.player.overdrive > 0,
      upgrades: { ...this.upgrades },
      draftCards: this.draftCards.map((c) => c.id),
      errors: [...this.errors],
    };
  }
}

// ---------------------------------------------------------------- boot

function boot() {
  const canvas = document.getElementById('game');
  const params = new URLSearchParams(window.location.search);
  const game = new Game(canvas);
  window.__shatter = { game, errors: game.errors };
  window.__shotReady = false;

  window.addEventListener('error', (event) => {
    game.errors.push(String(event.message ?? event.error ?? 'unknown error'));
  });
  const origConsoleError = console.error.bind(console);
  console.error = (...args) => {
    game.errors.push(args.map((a) => String(a)).join(' '));
    origConsoleError(...args);
  };

  const shot = params.get('shot');
  const bot = params.get('bot') === '1';
  if (bot) game.botEnabled = true;

  if (shot) {
    // Deterministic staging: simulate a fixed scene, render once, signal ready.
    import('./shots.js').then(({ stageGame }) => {
      stageGame(game, shot, Number(params.get('seed') ?? 1) >>> 0);
      window.__shotReady = true;
    }).catch((err) => {
      game.errors.push(`staging failed: ${String(err && err.message ? err.message : err)}`);
      window.__shotReady = true;
    });
    return;
  }

  // Live play: fixed-step accumulator on requestAnimationFrame.
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      game.fixedStep();
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
    game.render();
    window.__shotReady = true;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
