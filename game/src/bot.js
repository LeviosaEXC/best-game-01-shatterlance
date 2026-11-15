// Deterministic play bot, used only by the staged screenshot scenes and by
// the scripted verification driver (?bot=1). It drives the same Input object
// a human would, so the game code under test is the real game code.

import { ARENA, ARENA_BOTTOM, ARENA_RIGHT } from './config.js';
import { dist } from './random.js';

// Draft pick priority for the bot: survive first, then damage.
const DRAFT_PRIORITY = ['hull', 'twin', 'ricochet', 'overclock', 'tempest', 'arc', 'magnetic', 'shatter'];

export function botPickDraft(draftCards) {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < draftCards.length; i++) {
    const card = draftCards[i];
    const rank = DRAFT_PRIORITY.indexOf(card.id);
    const score = (rank === -1 ? 0 : 8 - rank) + (card.owned === 0 ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function botDrive(game) {
  const input = game.input;
  const p = game.player;
  if (!p || !p.alive) return;
  if (game.state === 'draft') {
    game.selectDraft(botPickDraft(game.draftCards));
    return;
  }
  if (game.state !== 'playing' && game.state !== 'finale') return;

  // --- aim: nearest enemy, else the boss, else straight up.
  let target = null;
  let bestD = Infinity;
  for (const e of game.enemies) {
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  if (game.boss && game.boss.hp > 0) {
    const d = dist(p.x, p.y, game.boss.x, game.boss.y);
    if (d < bestD) {
      bestD = d;
      target = game.boss;
    }
  }
  if (target) {
    input.mouseX = target.x;
    input.mouseY = target.y;
  } else {
    input.mouseX = p.x;
    input.mouseY = p.y - 200;
  }
  input.mouseDown = true;

  // --- movement: keep ~200px from the nearest enemy, dodge incoming shots,
  // and stay inside the arena.
  let mx = 0;
  let my = 0;
  if (target) {
    const d = Math.max(1, bestD);
    const ux = (target.x - p.x) / d;
    const uy = (target.y - p.y) / d;
    if (d < 170) {
      mx -= ux;
      my -= uy;
    } else if (d > 320) {
      mx += ux * 0.7;
      my += uy * 0.7;
    } else {
      // Strafe around the target.
      mx += -uy * 0.8;
      my += ux * 0.8;
    }
  }
  // Dodge the nearest threatening shot.
  for (const s of game.enemyShots) {
    const d = dist(p.x, p.y, s.x, s.y);
    if (d < 90) {
      const ux = (s.x - p.x) / Math.max(1, d);
      const uy = (s.y - p.y) / Math.max(1, d);
      mx -= ux * 1.6;
      my -= uy * 1.6;
    }
  }
  // Drift back toward the arena centre when nothing presses.
  if (Math.abs(mx) < 0.1 && Math.abs(my) < 0.1) {
    mx = (640 - p.x) / 400;
    my = (390 - p.y) / 400;
  }
  // Keep out of the walls.
  if (p.x < ARENA.x + 90) mx += 1;
  if (p.x > ARENA_RIGHT - 90) mx -= 1;
  if (p.y < ARENA.y + 90) my += 1;
  if (p.y > ARENA_BOTTOM - 90) my -= 1;

  input.keys.clear();
  if (mx < -0.25) input.keys.add('KeyA');
  if (mx > 0.25) input.keys.add('KeyD');
  if (my < -0.25) input.keys.add('KeyW');
  if (my > 0.25) input.keys.add('KeyS');

  // --- dash through a close bullet.
  let danger = false;
  for (const s of game.enemyShots) {
    if (dist(p.x, p.y, s.x, s.y) < 70) {
      danger = true;
      break;
    }
  }
  if (danger && p.dashCooldown <= 0) input.pressed.add('Space');

  // --- lance: throw when the boss is up, when the target is a bulwark
  // (its frontal shield blocks every bolt, so only the lance pierces it),
  // or when a cluster is in line.
  if (!p.lance && game.lanceReadyTimer <= 0) {
    const nearestBulwark = target && target.kind === 'bulwark';
    if (game.boss || nearestBulwark || game.enemies.length >= 3) input.rightPressed = true;
  }

  // --- overdrive when charged and the field is busy.
  if (p.overdriveCharge >= 1 && p.overdrive <= 0 && (game.boss || game.enemies.length >= 6)) {
    input.pressed.add('KeyQ');
  }
}
