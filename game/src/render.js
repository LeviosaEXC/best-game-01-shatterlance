// All canvas drawing: arena, entities, projectiles, particles, the HUD and
// every screen (title, upgrade draft, pause, victory, game over). No game
// logic lives here — the renderer only reads state.

import {
  ARENA, ARENA_BOTTOM, ARENA_RIGHT, HUD_H, PALETTE, SCORING, UPGRADES, VIEW_H, VIEW_W,
} from './config.js';
import { bossNodePositions } from './entities.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function poly(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

function regularPoly(ctx, x, y, sides, radius, rotation) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius]);
  }
  poly(ctx, pts);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  clear() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  // Arena floor, 56px tactical grid and the frame. frameColor flashes on
  // lance bounces, hull hits and shield absorbs.
  drawArena(frameColor, shakeX, shakeY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.fillStyle = PALETTE.arena;
    ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ARENA.x + 56; x < ARENA_RIGHT; x += 56) {
      ctx.moveTo(x, ARENA.y);
      ctx.lineTo(x, ARENA_BOTTOM);
    }
    for (let y = ARENA.y + 56; y < ARENA_BOTTOM; y += 56) {
      ctx.moveTo(ARENA.x, y);
      ctx.lineTo(ARENA_RIGHT, y);
    }
    ctx.stroke();
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.restore();
  }

  drawWarnings(warnings) {
    const ctx = this.ctx;
    for (const w of warnings) {
      const alpha = Math.min(1, w.t / 0.65);
      ctx.save();
      ctx.globalAlpha = alpha * (0.55 + 0.45 * Math.sin(w.t * 22));
      ctx.strokeStyle = '#ffd500';
      ctx.lineWidth = 3;
      const s = 16;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y - s);
      ctx.lineTo(w.x + s, w.y + s * 0.6);
      ctx.lineTo(w.x - s, w.y + s * 0.6);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPlayer(p, time) {
    const ctx = this.ctx;
    if (p.invuln > 0 && Math.floor(time * 14) % 2 === 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    // Thruster flame.
    const flame = 10 + Math.sin(time * 40) * 4 + (p.dashTimer > 0 ? 14 : 0);
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.moveTo(-12, 6);
    ctx.lineTo(-12 - flame, 0);
    ctx.lineTo(-12, -6);
    ctx.closePath();
    ctx.fill();
    // Dash afterimages.
    for (const ghost of p.dashTrail) {
      ctx.save();
      ctx.globalAlpha = ghost.life * 0.5;
      ctx.translate(ghost.x - p.x, ghost.y - p.y);
      ctx.rotate(ghost.angle);
      ctx.fillStyle = PALETTE.player;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-12, -11);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-12, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.rotate(p.angle);
    ctx.fillStyle = PALETTE.player;
    ctx.strokeStyle = PALETTE.playerOutline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -11);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.playerCore;
    ctx.beginPath();
    ctx.arc(2, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Overdrive halo.
    if (p.overdrive > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 10);
      ctx.strokeStyle = '#ffe666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEnemy(e, time) {
    const ctx = this.ctx;
    const flash = e.flash > 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = flash ? '#ffffff' : e.color;
    ctx.strokeStyle = e.rim;
    ctx.lineWidth = 2;
    if (e.shape === 'triangle') {
      ctx.rotate(e.angle);
      regularPoly(ctx, 0, 0, 3, e.radius + 3, 0);
      ctx.fill();
      ctx.stroke();
    } else if (e.shape === 'hexagon') {
      regularPoly(ctx, 0, 0, 6, e.radius, e.t * 0.6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff0d0';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.shape === 'square') {
      ctx.rotate(e.angle + Math.PI / 4);
      ctx.fillRect(-e.radius * 0.72, -e.radius * 0.72, e.radius * 1.44, e.radius * 1.44);
      ctx.strokeRect(-e.radius * 0.72, -e.radius * 0.72, e.radius * 1.44, e.radius * 1.44);
      // Charger telegraph: dashed magenta laser while locking.
      ctx.rotate(-(e.angle + Math.PI / 4));
      if (e.state === 'lock') {
        ctx.save();
        ctx.rotate(e.lockAngle);
        ctx.strokeStyle = '#ff1ec8';
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.radius, 0);
        ctx.lineTo(420, 0);
        ctx.stroke();
        ctx.restore();
      }
    } else if (e.shape === 'hourglass') {
      ctx.rotate(e.angle);
      const r = e.radius;
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.8);
      ctx.lineTo(r, -r * 0.8);
      ctx.lineTo(-r, r * 0.8);
      ctx.lineTo(r, r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.shape === 'octagon') {
      regularPoly(ctx, 0, 0, 8, e.radius, e.t * 0.3);
      ctx.fill();
      ctx.stroke();
      // Frontal energy shield: 130-degree white/coral arc.
      ctx.save();
      ctx.rotate(e.angle);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, e.radius + 5, -1.134, 1.134);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,94,126,0.5)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, e.radius + 5, -1.134, 1.134);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // HP bar for tougher enemies.
    if (e.hp < e.maxHp && e.maxHp > 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(e.x - 16, e.y - e.radius - 12, 32, 4);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - 16, e.y - e.radius - 12, 32 * (e.hp / e.maxHp), 4);
    }
  }

  drawBoss(boss, time) {
    const ctx = this.ctx;
    const flash = boss.flash > 0;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.fillStyle = flash ? '#ffffff' : boss.color;
    ctx.strokeStyle = boss.rim;
    ctx.lineWidth = 3;
    regularPoly(ctx, 0, 0, 12, boss.radius, boss.t * 0.2);
    ctx.fill();
    ctx.stroke();
    // Inner hexagon core.
    ctx.fillStyle = '#1a0208';
    regularPoly(ctx, 0, 0, 6, 26, -boss.t * 0.4);
    ctx.fill();
    ctx.strokeStyle = '#ff8899';
    ctx.lineWidth = 2;
    regularPoly(ctx, 0, 0, 6, 26, -boss.t * 0.4);
    ctx.stroke();
    ctx.fillStyle = '#ff0033';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Orbiting Diamond Armor Nodes.
    for (const pos of bossNodePositions(boss)) {
      if (!pos.node.alive) continue;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(boss.nodeAngle * 2);
      ctx.fillStyle = '#ffd500';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(10, 0);
      ctx.lineTo(0, 13);
      ctx.lineTo(-10, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (pos.node.hp < pos.node.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(pos.x - 12, pos.y - 20, 24, 3);
        ctx.fillStyle = '#ffd500';
        ctx.fillRect(pos.x - 12, pos.y - 20, 24 * (pos.node.hp / pos.node.maxHp), 3);
      }
    }
    // Boss HP bar across the top of the arena.
    const bw = 560;
    const bx = (VIEW_W - bw) / 2;
    const by = ARENA.y + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, 14);
    ctx.fillStyle = '#ff0033';
    ctx.fillRect(bx, by, bw * (boss.hp / boss.maxHp), 10);
    ctx.strokeStyle = '#ff8899';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, 10);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`THE CRIMSON ARCHITECT  —  PHASE ${boss.phase}`, VIEW_W / 2, by + 26);
    // Beam telegraph: twin yellow warning lines.
    if (boss.beamTelegraph > 0) {
      const base = Math.atan2(560 - boss.y, 640 - boss.x);
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(time * 24);
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 5;
      ctx.setLineDash([16, 10]);
      for (const off of [-0.12, 0.12]) {
        ctx.beginPath();
        ctx.moveTo(boss.x, boss.y);
        ctx.lineTo(boss.x + Math.cos(base + off) * 900, boss.y + Math.sin(base + off) * 900);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawBolts(bolts, overdrive) {
    const ctx = this.ctx;
    for (const b of bolts) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = overdrive ? PALETTE.boltOverdrive : PALETTE.bolt;
      roundRect(ctx, -8, -2.5, 16, 5, 2.5);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-3, -1, 8, 2);
      ctx.restore();
    }
  }

  drawLance(lance) {
    if (!lance) return;
    const ctx = this.ctx;
    // Trail.
    for (let i = 0; i < lance.trail.length; i++) {
      const p = lance.trail[i];
      ctx.save();
      ctx.globalAlpha = (i / lance.trail.length) * 0.55;
      ctx.fillStyle = PALETTE.lanceTrail;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * (i / lance.trail.length) + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(lance.x, lance.y);
    ctx.rotate(lance.angle);
    ctx.fillStyle = PALETTE.lance;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(8, -7);
    ctx.lineTo(-20, -4);
    ctx.lineTo(-20, 4);
    ctx.lineTo(8, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawEnemyShots(shots) {
    const ctx = this.ctx;
    for (const s of shots) {
      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.kind === 'orb') {
        ctx.fillStyle = '#ff5500';
        ctx.beginPath();
        ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff0d0';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.kind === 'diamond') {
        ctx.rotate(s.life * 6);
        ctx.fillStyle = '#d466ff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(7, 0);
        ctx.lineTo(0, 9);
        ctx.lineTo(-7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Siege bomb: 8-point spiked star.
        ctx.rotate(s.life * 3);
        ctx.fillStyle = '#ff1144';
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const r = i % 2 === 0 ? 12 : 5;
          const a = (i / 16) * Math.PI * 2;
          if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPickups(pickups, time) {
    const ctx = this.ctx;
    for (const p of pickups) {
      const bob = Math.sin(time * 4 + p.id) * 2;
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      if (p.kind === 'repair') {
        ctx.fillStyle = '#22ff66';
        ctx.strokeStyle = '#ccffdd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-4, -11);
        ctx.lineTo(4, -11);
        ctx.lineTo(4, -4);
        ctx.lineTo(11, -4);
        ctx.lineTo(11, 4);
        ctx.lineTo(4, 4);
        ctx.lineTo(4, 11);
        ctx.lineTo(-4, 11);
        ctx.lineTo(-4, 4);
        ctx.lineTo(-11, 4);
        ctx.lineTo(-11, -4);
        ctx.lineTo(-4, -4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'shield') {
        ctx.fillStyle = '#55aaff';
        ctx.strokeStyle = '#d0eaff';
        ctx.lineWidth = 2;
        regularPoly(ctx, 0, 0, 5, 14, -Math.PI / 2 + time * 1.5);
        ctx.fill();
        ctx.stroke();
      } else {
        // Energy spark: rotating 4-point star.
        ctx.rotate(time * 3);
        ctx.fillStyle = '#f4f8ff';
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(3, -3);
        ctx.lineTo(11, 0);
        ctx.lineTo(3, 3);
        ctx.lineTo(0, 11);
        ctx.lineTo(-3, 3);
        ctx.lineTo(-11, 0);
        ctx.lineTo(-3, -3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawParticles(particles) {
    const ctx = this.ctx;
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  drawRings(rings) {
    const ctx = this.ctx;
    for (const r of rings) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, r.life / r.maxLife) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFloatTexts(texts) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    for (const t of texts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
      ctx.fillStyle = t.color;
      ctx.font = `bold ${t.size}px system-ui, sans-serif`;
      // Keep centred text inside the viewport: long labels near a wall
      // would otherwise clip off the edge.
      const w = ctx.measureText(t.text).width;
      const x = Math.max(w / 2 + 8, Math.min(VIEW_W - w / 2 - 8, t.x));
      ctx.fillText(t.text, x, t.y);
      ctx.restore();
    }
  }

  drawArcLightning(x1, y1, x2, y2, rng) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#c07dff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const segs = 5;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const mx = x1 + (x2 - x1) * t + (rng.next() - 0.5) * 22;
      const my = y1 + (y2 - y1) * t + (rng.next() - 0.5) * 22;
      ctx.lineTo(mx, my);
    }
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ HUD

  drawHud(state) {
    const ctx = this.ctx;
    const p = state.player;
    ctx.save();
    ctx.fillStyle = PALETTE.hudBar;
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.strokeStyle = PALETTE.hudBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, HUD_H);
    ctx.lineTo(VIEW_W, HUD_H);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // Hull pips.
    ctx.fillStyle = PALETTE.muted;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('HULL', 20, 14);
    for (let i = 0; i < p.maxHp; i++) {
      ctx.fillStyle = i < p.hp ? '#00f0ff' : 'rgba(123,147,184,0.3)';
      ctx.beginPath();
      ctx.arc(66 + i * 18, 14, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shield pips.
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('SHIELD', 20, 40);
    for (let i = 0; i < p.maxShield; i++) {
      ctx.fillStyle = i < p.shield ? '#55aaff' : 'rgba(123,147,184,0.3)';
      regularPoly(ctx, 66 + i * 18, 40, 5, 7, -Math.PI / 2);
      ctx.fill();
    }
    // Dash bar.
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('DASH', 200, 14);
    const dashFrac = p.dashCooldown <= 0 ? 1 : 1 - p.dashCooldown / state.dashCooldownMax;
    ctx.fillStyle = 'rgba(123,147,184,0.3)';
    ctx.fillRect(246, 8, 90, 12);
    ctx.fillStyle = dashFrac >= 1 ? '#00f0ff' : '#1e6f7a';
    ctx.fillRect(246, 8, 90 * dashFrac, 12);
    // Lance status.
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('LANCE', 200, 40);
    const lanceText = !p.lance ? 'READY  [RMB / E]' : p.lance.state === 'out' ? 'THROWN' : p.lance.state === 'hover' ? 'HOVERING' : 'RETURNING';
    ctx.fillStyle = !p.lance ? '#ffd500' : PALETTE.text;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(lanceText, 246, 40);
    // Wave counter.
    ctx.fillStyle = PALETTE.muted;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('WAVE', 380, 14);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(`${state.wave} / 6`, 380, 38);
    // Overdrive gauge.
    ctx.fillStyle = PALETTE.muted;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('OVERDRIVE', 470, 14);
    const od = p.overdrive > 0 ? 1 : p.overdriveCharge;
    ctx.fillStyle = 'rgba(123,147,184,0.3)';
    ctx.fillRect(470, 26, 150, 12);
    ctx.fillStyle = p.overdrive > 0 ? '#ffe666' : od >= 1 ? '#ffd500' : '#7a6a1e';
    ctx.fillRect(470, 26, 150 * Math.min(1, od), 12);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(p.overdrive > 0 ? `ACTIVE ${p.overdrive.toFixed(1)}s` : od >= 1 ? 'READY  [Q]' : `${Math.floor(od * 100)}%`, 470, 50);
    // Combo.
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('COMBO', 660, 14);
    ctx.fillStyle = state.combo > 1 ? '#ffd500' : PALETTE.text;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(`x${state.combo.toFixed(1)}`, 660, 38);
    // Score.
    ctx.fillStyle = PALETTE.muted;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('SCORE', 780, 14);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(String(state.score), 780, 38);
    // Best.
    ctx.fillStyle = PALETTE.muted;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('BEST', 920, 14);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(String(state.best), 920, 38);
    // Sound and pause buttons (clickable regions, also M / P keys).
    ctx.fillStyle = '#0e1a30';
    ctx.strokeStyle = PALETTE.hudBorder;
    ctx.lineWidth = 1;
    roundRect(ctx, 1050, 12, 96, 40, 6);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, 1158, 12, 96, 40, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.muted ? 'MUTED [M]' : 'SOUND [M]', 1098, 33);
    ctx.fillText(state.paused ? 'RESUME [P]' : 'PAUSE [P]', 1206, 33);
    ctx.restore();
  }

  // ------------------------------------------------------------ screens

  dimScreen(alpha = 0.72) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(4,6,12,${alpha})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  titleText(text, y, size, color, bold = true) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = `${bold ? 'bold' : ''} ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, VIEW_W / 2, y);
  }

  drawTitle(best, time) {
    const ctx = this.ctx;
    this.dimScreen(0.55);
    // Gold shimmer on the title.
    const shimmer = 0.75 + 0.25 * Math.sin(time * 2);
    ctx.save();
    ctx.globalAlpha = shimmer;
    this.titleText('SHATTERLANCE', 150, 84, '#ffd500');
    ctx.restore();
    this.titleText('NEON ARENA  •  RICOCHET  •  DASH  •  SHATTER', 205, 20, PALETTE.text, false);
    this.titleText('Pilot the chevron fighter. Throw the Aegis Lance through', 258, 19, PALETTE.text, false);
    this.titleText('armored foes, dash through bullets, and shatter the boss.', 284, 19, PALETTE.text, false);
    this.titleText('WASD move  •  Mouse aim  •  Hold LMB fire  •  RMB / E lance', 330, 18, PALETTE.muted, false);
    this.titleText('SPACE dash  •  Q overdrive  •  P pause  •  M mute  •  R restart', 356, 18, PALETTE.muted, false);
    if (best > 0) this.titleText(`BEST SCORE  ${best}`, 398, 20, '#ffd500');
    const pulse = 0.6 + 0.4 * Math.sin(time * 4);
    ctx.save();
    ctx.globalAlpha = pulse;
    this.titleText('PRESS ENTER OR SPACE TO LAUNCH', 460, 26, PALETTE.player);
    ctx.restore();
    this.titleText('6 waves. 5 enemy classes. One boss. Rank S needs 40,000.', 520, 16, PALETTE.muted, false);
  }

  drawDraft(draftCards, selected) {
    const ctx = this.ctx;
    this.dimScreen(0.78);
    this.titleText('WAVE CLEARED — CHOOSE A MODULE', 120, 40, '#ffd500');
    this.titleText('Press 1, 2 or 3 — or click a card', 162, 18, PALETTE.muted, false);
    const cardW = 300;
    const cardH = 260;
    const gap = 32;
    const total = cardW * 3 + gap * 2;
    const startX = (VIEW_W - total) / 2;
    const y = 200;
    draftCards.forEach((card, i) => {
      const x = startX + i * (cardW + gap);
      const hot = selected === i;
      ctx.save();
      ctx.fillStyle = hot ? '#14263f' : '#0a101d';
      ctx.strokeStyle = hot ? card.color : PALETTE.hudBorder;
      ctx.lineWidth = hot ? 3 : 2;
      roundRect(ctx, x, y, cardW, cardH, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = card.color;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`[${i + 1}]`, x + cardW / 2, y + 34);
      ctx.fillStyle = PALETTE.text;
      ctx.font = 'bold 22px system-ui, sans-serif';
      this.wrapText(card.name, x + cardW / 2, y + 78, cardW - 32, 22);
      ctx.fillStyle = PALETTE.muted;
      ctx.font = '16px system-ui, sans-serif';
      this.wrapText(card.blurb, x + cardW / 2, y + 130, cardW - 32, 16);
      const owned = card.owned;
      ctx.fillStyle = owned >= card.max ? '#22ff66' : PALETTE.muted;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(owned >= card.max ? 'MAXED' : `Owned ${owned} / ${card.max}`, x + cardW / 2, y + cardH - 30);
      ctx.restore();
    });
  }

  wrapText(text, cx, y, maxWidth, lineHeight) {
    const ctx = this.ctx;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineHeight * 1.25));
  }

  drawPause() {
    this.dimScreen(0.72);
    this.titleText('PAUSED', 300, 56, PALETTE.text);
    this.titleText('P — resume    •    R — restart    •    M — mute', 370, 20, PALETTE.muted, false);
  }

  drawVictory(score, rank, kills, timeSec, best) {
    this.dimScreen(0.78);
    this.titleText('VICTORY', 140, 72, '#ffd500');
    this.titleText('THE CRIMSON ARCHITECT IS SHATTERED', 200, 20, PALETTE.text, false);
    this.titleText(`RANK  ${rank}`, 270, 44, rank === 'S' ? '#ffd500' : PALETTE.player);
    this.titleText(`SCORE  ${score}`, 330, 26, PALETTE.text);
    this.titleText(`KILLS  ${kills}     TIME  ${timeSec.toFixed(1)}s     BEST  ${best}`, 380, 19, PALETTE.muted, false);
    this.titleText('R — play again', 450, 20, PALETTE.player, false);
  }

  drawGameOver(score, wave, kills, best) {
    this.dimScreen(0.78);
    this.titleText('SHIP DESTROYED', 200, 56, '#ff2a4b');
    this.titleText(`You fell on wave ${wave}`, 280, 20, PALETTE.text, false);
    this.titleText(`SCORE  ${score}     KILLS  ${kills}     BEST  ${best}`, 330, 22, PALETTE.text);
    this.titleText('R — try again', 400, 20, PALETTE.player, false);
  }

  drawWaveBanner(text, alpha) {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, VIEW_W / 2, 300);
    ctx.restore();
  }

  drawCursorDashArc(player, frac) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = frac >= 1 ? '#00f0ff' : 'rgba(0,240,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.restore();
  }

  drawCrosshair(x, y) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(234,244,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 13, y);
    ctx.lineTo(x - 5, y);
    ctx.moveTo(x + 5, y);
    ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x, y - 5);
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x, y + 13);
    ctx.stroke();
    ctx.restore();
  }
}

// The three draft card rectangles, shared by the renderer and the click
// handling in the main loop so the two can never drift apart.
export function draftCardRects() {
  const cardW = 300;
  const cardH = 260;
  const gap = 32;
  const total = cardW * 3 + gap * 2;
  const startX = (VIEW_W - total) / 2;
  const y = 200;
  return [0, 1, 2].map((i) => ({
    x: startX + i * (cardW + gap),
    y,
    w: cardW,
    h: cardH,
  }));
}
