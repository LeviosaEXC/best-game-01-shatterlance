// Wave director: builds each wave's spawn queue from the spec's mix,
// drips enemies in through edge warning chevrons, and runs the boss's
// attack cycle on wave 6. Difficulty grows through spawn count and mix
// only — enemy HP is never inflated.

import { ARENA, ARENA_BOTTOM, ARENA_RIGHT, ENEMY_SHOTS, SPAWN_WARNING, WAVES } from './config.js';
import { bossNodePositions, makeBoss, makeEnemy, makeEnemyShot } from './entities.js';
import { clamp } from './random.js';

export class WaveDirector {
  constructor(rng) {
    this.rng = rng;
    this.wave = 0;
    this.queue = [];
    this.spawnTimer = 0;
    this.waveTime = 0;
    this.waveDuration = 0;
    this.warnings = [];
    this.boss = null;
    this.bossSpawned = false;
    this.cleared = false;
  }

  startWave(n) {
    this.wave = n;
    this.waveTime = 0;
    this.cleared = false;
    this.warnings = [];
    if (n === 6) {
      this.boss = null;
      this.bossSpawned = false;
      this.queue = [];
      this.spawnTimer = 0.5;
      return;
    }
    const def = WAVES[n - 1];
    this.waveDuration = def.duration;
    // Build the queue: swarmers first so the opening feels alive at 0.4s,
    // gunners held back to ~9s, the rest interleaved through the wave.
    const list = [];
    for (let i = 0; i < def.swarmers; i++) list.push('swarmer');
    for (let i = 0; i < def.gunners; i++) list.push('gunner');
    for (let i = 0; i < def.chargers; i++) list.push('charger');
    for (let i = 0; i < def.weavers; i++) list.push('weaver');
    for (let i = 0; i < def.bulwarks; i++) list.push('bulwark');
    // Shuffle everything except the first few swarmers, which open the wave.
    const head = list.slice(0, 4);
    const rest = list.slice(4);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.queue = head.concat(rest);
    this.setQueueTotal(this.queue.length);
    this.spawnTimer = 0.4;
  }

  // Pick an edge spawn point away from the player.
  edgePoint(player) {
    const edge = this.rng.int(0, 4);
    const m = 30;
    let x;
    let y;
    if (edge === 0) {
      x = this.rng.range(ARENA.x + m, ARENA_RIGHT - m);
      y = ARENA.y + m;
    } else if (edge === 1) {
      x = this.rng.range(ARENA.x + m, ARENA_RIGHT - m);
      y = ARENA_BOTTOM - m;
    } else if (edge === 2) {
      x = ARENA.x + m;
      y = this.rng.range(ARENA.y + m, ARENA_BOTTOM - m);
    } else {
      x = ARENA_RIGHT - m;
      y = this.rng.range(ARENA.y + m, ARENA_BOTTOM - m);
    }
    // Nudge away if it lands on top of the player.
    if (Math.abs(x - player.x) < 120 && Math.abs(y - player.y) < 120) {
      x = clamp(player.x + (player.x < 640 ? 320 : -320), ARENA.x + m, ARENA_RIGHT - m);
      y = clamp(player.y + (player.y < 390 ? 220 : -220), ARENA.y + m, ARENA_BOTTOM - m);
    }
    return { x, y };
  }

  // Step the director. Returns spawned enemies through `spawn` and boss
  // events through the returned object.
  step(dt, player, spawn, events) {
    this.waveTime += dt;
    for (const w of this.warnings) w.t -= dt;
    this.warnings = this.warnings.filter((w) => w.t > 0);

    if (this.wave === 6) {
      if (!this.bossSpawned) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.bossSpawned = true;
          this.boss = makeBoss(640, 220);
          events.bossSpawned = true;
        }
      }
      return;
    }

    if (this.queue.length === 0) return;
    // Pace: one spawn every interval, tightened as the wave goes on so the
    // frame stays dense; never faster than 0.28s between spawns.
    const total = this.queueTotal();
    const done = total - this.queue.length;
    const frac = total === 0 ? 0 : done / total;
    const interval = Math.max(0.28, this.waveDuration / Math.max(1, total) * (1 - frac * 0.35));
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      const kind = this.queue.shift();
      // Gunners wait until ~9s into wave 1 so the opening is pure swarmers.
      if (kind === 'gunner' && this.wave === 1 && this.waveTime < 9 && this.queue.length > 0) {
        this.queue.push(kind);
        this.spawnTimer = 0.3;
        return;
      }
      const p = this.edgePoint(player);
      this.warnings.push({ x: p.x, y: p.y, kind, t: SPAWN_WARNING });
      spawn.push({ kind, x: p.x, y: p.y, delay: SPAWN_WARNING });
    }
  }

  queueTotal() {
    return this.queueTotalCache ?? 0;
  }

  setQueueTotal(n) {
    this.queueTotalCache = n;
  }

  waveRemaining() {
    return this.queue.length;
  }

  // Boss attack cycle: figure-8 patrol, radial rings, siege fans, summons,
  // and phase-2 beam volleys. Appends to `shots` and `spawn`.
  stepBoss(boss, player, dt, shots, spawn, events) {
    boss.t += dt;
    if (boss.flash > 0) boss.flash -= dt;
    boss.nodeAngle += dt * 1.1;
    // Figure-8 patrol around the arena centre.
    const cx = 640;
    const cy = 380;
    const tt = boss.t * 0.45;
    const tx = cx + Math.sin(tt) * 320;
    const ty = cy + Math.sin(tt * 2) * 130;
    boss.x += (tx - boss.x) * Math.min(1, dt * 1.6);
    boss.y += (ty - boss.y) * Math.min(1, dt * 1.6);

    // Phase 2: below half health, regenerate nodes once and add beam volleys.
    if (boss.phase === 1 && boss.hp <= boss.maxHp / 2) {
      boss.phase = 2;
      boss.ringCount = 16;
      if (!boss.nodesRegenerated) {
        boss.nodesRegenerated = true;
        for (const node of boss.nodes) {
          node.hp = node.maxHp;
          node.alive = true;
        }
        events.phase2 = true;
      }
    }

    boss.summonTimer -= dt;
    if (boss.summonTimer <= 0 && spawn.length < 3) {
      boss.summonTimer = 9;
      for (let i = 0; i < 2; i++) {
        const p = this.edgePoint(player);
        spawn.push({ kind: 'swarmer', x: p.x, y: p.y, delay: SPAWN_WARNING });
        this.warnings.push({ x: p.x, y: p.y, kind: 'swarmer', t: SPAWN_WARNING });
      }
      events.summon = true;
    }

    // Beam telegraph: twin yellow beams, then high-speed orbs.
    if (boss.beamTelegraph > 0) {
      boss.beamTelegraph -= dt;
      if (boss.beamTelegraph <= 0) {
        const base = Math.atan2(player.y - boss.y, player.x - boss.x);
        for (const off of [-0.12, 0.12]) {
          for (let i = 0; i < 5; i++) {
            const a = base + off + (i - 2) * 0.05;
            shots.push(makeEnemyShot('orb', boss.x, boss.y, a, ENEMY_SHOTS.bossBeamSpeed));
          }
        }
        events.beamFired = true;
      }
      return;
    }

    boss.attackTimer -= dt;
    if (boss.attackTimer > 0) return;
    const kind = boss.attackKind % 3;
    boss.attackKind++;
    if (kind === 0) {
      // Radial ring of orbs.
      const n = boss.ringCount;
      const offset = this.rng.angle();
      for (let i = 0; i < n; i++) {
        const a = offset + (i / n) * Math.PI * 2;
        shots.push(makeEnemyShot('orb', boss.x, boss.y, a, ENEMY_SHOTS.orbSpeed));
      }
      boss.attackTimer = 3.2;
      events.ring = true;
    } else if (kind === 1) {
      // 3-way siege bomb fan, aimed.
      const base = Math.atan2(player.y - boss.y, player.x - boss.x);
      for (const off of [-0.3, 0, 0.3]) {
        shots.push(makeEnemyShot('siege', boss.x, boss.y, base + off, ENEMY_SHOTS.siegeSpeed));
      }
      boss.attackTimer = 2.6;
      events.siege = true;
    } else {
      // Phase 2 adds beam volleys; phase 1 fires a second ring instead.
      if (boss.phase === 2) {
        boss.beamTelegraph = 0.9;
        boss.attackTimer = 3.4;
        events.beamTelegraph = true;
      } else {
        const n = boss.ringCount;
        const offset = this.rng.angle();
        for (let i = 0; i < n; i++) {
          const a = offset + (i / n) * Math.PI * 2;
          shots.push(makeEnemyShot('orb', boss.x, boss.y, a, ENEMY_SHOTS.orbSpeed + 15));
        }
        boss.attackTimer = 3.2;
        events.ring = true;
      }
    }
  }
}

// Whether a bolt hits a bulwark's frontal shield: the shield covers a
// 130-degree arc facing the bulwark's heading.
export function bulwarkShieldBlocks(enemy, fromX, fromY) {
  const incoming = Math.atan2(fromY - enemy.y, fromX - enemy.x);
  const facing = enemy.angle;
  let d = Math.abs(incoming - facing) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d < (130 * Math.PI / 180) / 2;
}

// Whether a bolt hits a boss armor node first (nodes block frontal bolts
// until shattered; the lance pierces them).
export function bossNodeHit(boss, x, y, radius) {
  for (const pos of bossNodePositions(boss)) {
    if (!pos.node.alive) continue;
    const dx = x - pos.x;
    const dy = y - pos.y;
    if (dx * dx + dy * dy < (radius + 13) * (radius + 13)) return pos.node;
  }
  return null;
}
