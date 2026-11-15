// Game entities: the player, the five enemy classes plus the boss, player
// and enemy projectiles, the Aegis Lance, pickups, particles and floating
// combat text. All motion is stepped at a fixed 60 Hz by the main loop;
// every random choice comes from the run's seeded RNG.

import {
  ARENA, ARENA_BOTTOM, ARENA_RIGHT, ENEMY_SHOTS, LANCE, PALETTE, PICKUPS, PLAYER,
} from './config.js';
import { angleDelta, angleTo, clamp, dist } from './random.js';

let nextId = 1;
export function freshId() {
  return nextId++;
}

// ---------------------------------------------------------------- player

export function makePlayer() {
  return {
    x: 640,
    y: 560,
    angle: -Math.PI / 2,
    hp: PLAYER.maxHp,
    maxHp: PLAYER.maxHp,
    shield: 0,
    maxShield: PLAYER.maxShield,
    fireTimer: 0,
    boltCount: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirX: 0,
    dashDirY: -1,
    dashTrail: [],
    invuln: 0,
    overdrive: 0,
    overdriveCharge: 0,
    lance: null,
    alive: true,
    thruster: 0,
  };
}

// ---------------------------------------------------------------- enemies

export const ENEMY_DEFS = {
  swarmer: {
    radius: 13, hp: 2, speed: 165, score: 100, color: '#ff2a4b', rim: '#ff99aa', shape: 'triangle',
  },
  gunner: {
    radius: 20, hp: 5, speed: 85, score: 200, color: '#ff7b00', rim: '#ffd080', shape: 'hexagon',
  },
  charger: {
    radius: 24, hp: 8, speed: 65, score: 300, color: '#ff1ec8', rim: '#ffb0f0', shape: 'square',
  },
  weaver: {
    radius: 22, hp: 6, speed: 105, score: 350, color: '#a844ff', rim: '#e2b8ff', shape: 'hourglass',
  },
  bulwark: {
    radius: 28, hp: 12, speed: 55, score: 450, color: '#ff5e7e', rim: '#ffc2cf', shape: 'octagon',
  },
};

export function makeEnemy(kind, x, y, rng) {
  const def = ENEMY_DEFS[kind];
  const e = {
    id: freshId(),
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: rng.angle(),
    radius: def.radius,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed,
    score: def.score,
    color: def.color,
    rim: def.rim,
    shape: def.shape,
    flash: 0,
    t: rng.range(0, 10),
    fireTimer: rng.range(1.2, 2.4),
    // Charger state machine.
    state: 'seek',
    stateTimer: 0,
    lockAngle: 0,
    rushX: 0,
    rushY: 0,
    // Weaver strafe direction.
    strafeDir: rng.chance(0.5) ? 1 : -1,
    strafeTimer: rng.range(1, 2.5),
  };
  return e;
}

export function makeBoss(x, y) {
  return {
    id: freshId(),
    kind: 'boss',
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 56,
    hp: 240,
    maxHp: 240,
    speed: 70,
    score: 5000,
    color: '#ff0033',
    rim: '#ff8899',
    shape: 'dodecagon',
    flash: 0,
    t: 0,
    phase: 1,
    nodesRegenerated: false,
    // Three orbiting Diamond Armor Nodes.
    nodes: [
      { angle: 0, hp: 16, maxHp: 16, alive: true },
      { angle: (Math.PI * 2) / 3, hp: 16, maxHp: 16, alive: true },
      { angle: (Math.PI * 4) / 3, hp: 16, maxHp: 16, alive: true },
    ],
    nodeOrbit: 78,
    nodeAngle: 0,
    attackTimer: 2.0,
    attackKind: 0,
    beamTelegraph: 0,
    beamTimer: 0,
    summonTimer: 6,
    ringCount: 12,
    fireTimer: 0,
  };
}

export function bossNodePositions(boss) {
  return boss.nodes.map((node) => ({
    x: boss.x + Math.cos(boss.nodeAngle + node.angle) * boss.nodeOrbit,
    y: boss.y + Math.sin(boss.nodeAngle + node.angle) * boss.nodeOrbit,
    node,
  }));
}

// Step one enemy for dt seconds. Returns nothing; appends fired projectiles
// to `shots` and may set `events` flags the caller reads.
export function stepEnemy(e, player, dt, rng, shots, events) {
  e.t += dt;
  if (e.flash > 0) e.flash -= dt;
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = Math.max(1, dist(e.x, e.y, player.x, player.y));
  const ux = dx / d;
  const uy = dy / d;

  if (e.kind === 'swarmer') {
    // Fast sinusoidal pursuit.
    const wobble = Math.sin(e.t * 5) * 0.7;
    const px = -uy * wobble;
    const py = ux * wobble;
    const mx = ux + px;
    const my = uy + py;
    const m = Math.max(0.001, Math.sqrt(mx * mx + my * my));
    e.x += (mx / m) * e.speed * dt;
    e.y += (my / m) * e.speed * dt;
    e.angle = angleTo(e.x, e.y, player.x, player.y);
  } else if (e.kind === 'gunner') {
    // Hold 210-320px range, strafe slowly, fire an aimed orb every 2.1s.
    const target = d < 210 ? -1 : d > 320 ? 1 : 0;
    e.x += ux * target * e.speed * dt;
    e.y += uy * target * e.speed * dt;
    e.x += -uy * Math.sin(e.t * 0.8) * 30 * dt;
    e.y += ux * Math.sin(e.t * 0.8) * 30 * dt;
    e.angle = angleTo(e.x, e.y, player.x, player.y);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && d < 560) {
      e.fireTimer = 2.1;
      shots.push(makeEnemyShot('orb', e.x, e.y, e.angle, ENEMY_SHOTS.orbSpeed));
      events.fired = true;
    }
  } else if (e.kind === 'charger') {
    if (e.state === 'seek') {
      e.x += ux * e.speed * dt;
      e.y += uy * e.speed * dt;
      e.angle = angleTo(e.x, e.y, player.x, player.y);
      if (d < 380) {
        e.state = 'lock';
        e.stateTimer = 0.75;
        e.lockAngle = e.angle;
      }
    } else if (e.state === 'lock') {
      // Dashed magenta telegraph: track the player loosely, then commit.
      e.stateTimer -= dt;
      e.lockAngle += angleDelta(e.lockAngle, angleTo(e.x, e.y, player.x, player.y)) * 1.4 * dt;
      e.angle = e.lockAngle;
      if (e.stateTimer <= 0) {
        e.state = 'rush';
        e.stateTimer = 0.55;
        e.rushX = Math.cos(e.lockAngle);
        e.rushY = Math.sin(e.lockAngle);
        events.chargerRush = true;
      }
    } else if (e.state === 'rush') {
      e.stateTimer -= dt;
      e.x += e.rushX * 560 * dt;
      e.y += e.rushY * 560 * dt;
      if (e.stateTimer <= 0) {
        e.state = 'recover';
        e.stateTimer = 0.8;
      }
    } else {
      e.stateTimer -= dt;
      if (e.stateTimer <= 0) e.state = 'seek';
    }
  } else if (e.kind === 'weaver') {
    // Lateral strafe with slow approach; 3-way diamond spread every 2.5s.
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafeTimer = rng.range(1.2, 2.4);
      e.strafeDir *= -1;
    }
    e.x += ux * e.speed * 0.45 * dt + -uy * e.strafeDir * e.speed * 0.85 * dt;
    e.y += uy * e.speed * 0.45 * dt + ux * e.strafeDir * e.speed * 0.85 * dt;
    e.angle = angleTo(e.x, e.y, player.x, player.y);
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && d < 600) {
      e.fireTimer = 2.5;
      for (const off of [-0.28, 0, 0.28]) {
        shots.push(makeEnemyShot('diamond', e.x, e.y, e.angle + off, ENEMY_SHOTS.diamondSpeed));
      }
      events.fired = true;
    }
  } else if (e.kind === 'bulwark') {
    // Slow advance, always facing the player; frontal shield is checked at hit time.
    e.x += ux * e.speed * dt;
    e.y += uy * e.speed * dt;
    e.angle = angleTo(e.x, e.y, player.x, player.y);
  }
  // Keep enemies inside the arena.
  e.x = clamp(e.x, ARENA.x + e.radius, ARENA_RIGHT - e.radius);
  e.y = clamp(e.y, ARENA.y + e.radius, ARENA_BOTTOM - e.radius);
}

// ---------------------------------------------------------------- projectiles

export function makeBolt(x, y, angle, damage, twin) {
  return {
    id: freshId(),
    x,
    y,
    vx: Math.cos(angle) * PLAYER.boltSpeed,
    vy: Math.sin(angle) * PLAYER.boltSpeed,
    angle,
    damage,
    twin,
    life: 1.6,
  };
}

export function makeEnemyShot(kind, x, y, angle, speed) {
  const radius = kind === 'orb' ? ENEMY_SHOTS.orbRadius : kind === 'diamond' ? ENEMY_SHOTS.diamondRadius : ENEMY_SHOTS.siegeRadius;
  return {
    id: freshId(),
    kind,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    life: 6,
  };
}

export function makeLance(x, y, angle, bounces, speedMul) {
  return {
    x,
    y,
    angle,
    vx: Math.cos(angle) * LANCE.speedOut * speedMul,
    vy: Math.sin(angle) * LANCE.speedOut * speedMul,
    state: 'out',
    bouncesLeft: bounces,
    hoverTimer: LANCE.hoverTime,
    trail: [],
    hitIds: new Set(),
    damageMul: 1,
    speedMul,
  };
}

// ---------------------------------------------------------------- pickups

export function makePickup(kind, x, y) {
  return {
    id: freshId(),
    kind,
    x,
    y,
    t: 0,
    life: 14,
    radius: kind === 'spark' ? PICKUPS.sparkRadius : kind === 'repair' ? PICKUPS.repairRadius : PICKUPS.shieldRadius,
  };
}

// Roll a drop for a killed enemy. Repair only when the player is hurt,
// shield only when a pip is free; sparks are the common drop.
export function rollDrop(enemy, player, rng, upgrades) {
  const sparkP = PICKUPS.sparkChance;
  const repairP = player.hp < player.maxHp ? PICKUPS.repairChance : 0;
  const shieldP = player.shield < player.maxShield ? PICKUPS.shieldChance : 0;
  const roll = rng.next();
  if (roll < sparkP) return makePickup('spark', enemy.x, enemy.y);
  if (roll < sparkP + repairP) return makePickup('repair', enemy.x, enemy.y);
  if (roll < sparkP + repairP + shieldP) return makePickup('shield', enemy.x, enemy.y);
  return null;
}

// ---------------------------------------------------------------- particles & text

export function makeParticles(x, y, color, count, rng, speed = 220, life = 0.6) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = rng.angle();
    const sp = rng.range(speed * 0.3, speed);
    out.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rng.range(life * 0.5, life),
      maxLife: life,
      size: rng.range(2, 5),
      color,
      spin: rng.range(-6, 6),
      angle: rng.angle(),
    });
  }
  return out;
}

export function makeRing(x, y, color, maxRadius = 90, life = 0.45) {
  return {
    x, y, radius: 6, maxRadius, life, maxLife: life, color,
  };
}

export function makeFloatText(x, y, text, color, size = 15) {
  return {
    x, y, text, color, size, life: 1.0, maxLife: 1.0,
  };
}

// ---------------------------------------------------------------- helpers

export function insideArena(x, y, margin = 0) {
  return x > ARENA.x + margin && x < ARENA_RIGHT - margin && y > ARENA.y + margin && y < ARENA_BOTTOM - margin;
}

export function clampToArena(e, radius) {
  e.x = clamp(e.x, ARENA.x + radius, ARENA_RIGHT - radius);
  e.y = clamp(e.y, ARENA.y + radius, ARENA_BOTTOM - radius);
}

export { PALETTE };
