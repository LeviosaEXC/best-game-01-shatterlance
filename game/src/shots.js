// Deterministic staging for screenshots: each scene is built by running the
// real game simulation for a fixed simulated time from a fixed seed, then
// rendering one frame. No wall clock, no Math.random — the same seed always
// renders the same frame. The capture driver waits for window.__shotReady.

import { ARENA, ARENA_BOTTOM, ARENA_RIGHT, STEP } from './config.js';
import { dist } from './random.js';
import { makeBoss, makeBolt, makeEnemy, makeEnemyShot, makePickup } from './entities.js';

function simulate(game, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    game.fixedStep();
    if (game.state !== 'playing' && game.state !== 'finale') break;
  }
}

// Top up a staged play frame so it is dense and readable: many enemy
// classes on screen, player bolts in flight, enemy projectiles, a pickup.
function ensureDensity(game) {
  const rng = game.rng;
  const kinds = ['swarmer', 'swarmer', 'gunner', 'charger', 'weaver', 'bulwark'];
  while (game.enemies.length < 14) {
    const kind = kinds[Math.floor(rng.next() * kinds.length)];
    game.enemies.push(makeEnemy(
      kind,
      rng.range(ARENA.x + 80, ARENA_RIGHT - 80),
      rng.range(ARENA.y + 80, ARENA_BOTTOM - 80),
      rng,
    ));
  }
  if (game.bolts.length < 4 && game.enemies.length > 0) {
    const p = game.player;
    const t = game.enemies[0];
    const a = Math.atan2(t.y - p.y, t.x - p.x);
    for (let i = 0; i < 4; i++) {
      game.bolts.push(makeBolt(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20, a + (i - 1.5) * 0.03, 1, false));
    }
  }
  if (game.enemyShots.length < 3 && game.enemies.length > 0) {
    for (let i = 0; i < 3; i++) {
      const e = game.enemies[i % game.enemies.length];
      const a = Math.atan2(game.player.y - e.y, game.player.x - e.x);
      game.enemyShots.push(makeEnemyShot('orb', e.x, e.y, a, 275));
    }
  }
  if (game.pickups.length < 1) {
    game.pickups.push(makePickup('spark', game.player.x + 120, game.player.y - 60));
  }
}

function stagePlay(game, seed) {
  for (let attempt = 0; attempt < 3; attempt++) {
    game.resetRun(seed + attempt * 7919);
    game.state = 'playing';
    game.startWave(5);
    // Open with a dense field so the first seconds already feel alive.
    const kinds = ['swarmer', 'swarmer', 'swarmer', 'gunner', 'gunner', 'charger', 'weaver', 'bulwark'];
    for (let i = 0; i < 14; i++) {
      const kind = kinds[i % kinds.length];
      game.enemies.push(makeEnemy(
        kind,
        game.rng.range(ARENA.x + 80, ARENA_RIGHT - 80),
        game.rng.range(ARENA.y + 80, ARENA_BOTTOM - 80),
        game.rng,
      ));
    }
    game.botEnabled = true;
    simulate(game, 7);
    game.botEnabled = false;
    if (game.state === 'playing' && game.player.hp > 0) {
      ensureDensity(game);
      // Spread the field for readability: enemies piled on the player hide
      // the frame's middle, so relocate the closest ones to open space.
      let moved = 0;
      for (const e of game.enemies) {
        if (moved >= 5) break;
        if (dist(game.player.x, game.player.y, e.x, e.y) < 180) {
          e.x = game.rng.range(ARENA.x + 80, ARENA_RIGHT - 80);
          e.y = game.rng.range(ARENA.y + 80, ARENA_BOTTOM - 80);
          moved++;
        }
      }
      game.render();
      return true;
    }
  }
  // Fallback: render whatever the last attempt left, so the shot still exists.
  ensureDensity(game);
  game.render();
  return false;
}

function stageBoss(game, seed) {
  for (let attempt = 0; attempt < 3; attempt++) {
    game.resetRun(seed + attempt * 7919);
    game.state = 'playing';
    game.startWave(6);
    game.director.bossSpawned = true;
    game.director.boss = makeBoss(640, 220);
    game.boss = game.director.boss;
    game.botEnabled = true;
    simulate(game, 9);
    game.botEnabled = false;
    if (game.state === 'playing' && game.player.hp > 0 && game.boss && game.boss.hp > 0) {
      // A few swarmers join the boss for a busy frame.
      for (let i = 0; i < 3; i++) {
        game.enemies.push(makeEnemy(
          'swarmer',
          game.rng.range(ARENA.x + 100, ARENA_RIGHT - 100),
          game.rng.range(ARENA.y + 100, ARENA_BOTTOM - 100),
          game.rng,
        ));
      }
      ensureDensity(game);
      game.render();
      return true;
    }
  }
  ensureDensity(game);
  game.render();
  return false;
}

export function stageGame(game, scene, seed) {
  if (scene === 'title') {
    game.resetRun(seed);
    game.state = 'title';
    simulate(game, 3);
    game.render();
    return;
  }
  if (scene === 'play') {
    stagePlay(game, seed);
    return;
  }
  if (scene === 'boss') {
    stageBoss(game, seed);
    return;
  }
  if (scene === 'draft') {
    game.resetRun(seed);
    game.state = 'playing';
    game.startWave(1);
    game.score = 3240;
    game.kills = 14;
    game.combo = 2.5;
    game.player.hp = 4;
    game.openDraft();
    game.render();
    return;
  }
  if (scene === 'victory') {
    game.resetRun(seed);
    game.state = 'victory';
    game.wave = 6;
    game.score = 41230;
    game.kills = 87;
    game.playTime = 245.3;
    game.best = 41230;
    game.victoryStats = { score: 41230, rank: 'S', kills: 87, time: 245.3, best: 41230 };
    game.render();
    return;
  }
  if (scene === 'over') {
    game.resetRun(seed);
    game.state = 'gameover';
    game.score = 12340;
    game.wave = 3;
    game.kills = 41;
    game.best = 12340;
    game.player.hp = 0;
    game.player.alive = false;
    game.render();
    return;
  }
  // Unknown scene: fall back to the title.
  game.resetRun(seed);
  game.state = 'title';
  simulate(game, 3);
  game.render();
}
