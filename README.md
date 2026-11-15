# SHATTERLANCE — Neon Arena Shooter

A high-contrast, deterministic top-down neon arena shooter for the
make.fun best-game-01 competition. Pilot a nimble chevron fighter armed
with rapid-fire Kinetic Bolts and a throwable, wall-ricocheting Aegis
Lance. Pierce armored shields, dash through enemy bullets to vaporize
them, draft transformative Module Upgrades between waves, and shatter
The Crimson Architect on wave 6.

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/LeviosaEXC/best-game-01-shatterlance/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/LeviosaEXC/best-game-01-shatterlance/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

## How to play

Serve the game and open it in a desktop browser:

```
node serve.ts
```

Then open http://localhost:8080. No build step, no network requests —
every asset is code and canvas drawing.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D or arrows | Move (8 directions) |
| Mouse | Aim |
| Hold left mouse | Fire Kinetic Bolts |
| Right mouse or E | Throw / recall the Aegis Lance |
| Space or Shift | Phase Dash (vaporizes bullets, brief invulnerability) |
| Q or F | Nova Overdrive at 100% charge |
| 1 / 2 / 3 or click | Pick a Module Upgrade card between waves |
| P or Esc | Pause / resume |
| M | Mute / unmute sound and music |
| R | Quick restart (paused, defeated, victorious) |
| Enter or Space | Launch from the title screen |

## The game

- **6 waves** in a 1232x630 framed arena: Swarmers, Gunners, Chargers,
  Weavers, Bulwarks, then the boss — The Crimson Architect, a massive
  dodecagon with three orbiting Diamond Armor Nodes, radial bullet
  rings, siege-bomb fans, swarmer summons, and a phase-2 beam volley.
- **Aegis Lance**: pierces all enemies and shields, bounces off walls
  for +35% damage per bounce, hovers, then recalls. Catching it shaves
  0.35s off the dash cooldown.
- **Phase Dash**: 1080 px/s for 0.16s, vaporizes bullets within 46px
  for score and Overdrive charge.
- **8 Module Upgrades** drafted 1-of-3 after each wave: Twin-Linked
  Bolts, Ricochet Mastery, Tempest Dash, Arc Conductor, Magnetic Core,
  Hull Reinforce, Shatter Lance, Overclock Matrix.
- **Scoring**: kills and grazes build a combo up to x5.0; wave clears
  pay +500 x wave. Best score is saved locally. Victory ranks:
  S ≥ 40,000, A ≥ 25,000, B ≥ 14,000.
- **Sound**: fully synthesized WebAudio SFX and a procedural 128 BPM
  synthwave sequencer. No audio files.

## Determinism

The simulation runs at a fixed 60 Hz with a Mulberry32 seeded RNG
(seed `0x5A77E201`); there is no `Math.random` in gameplay. Staged
screenshots are reproducible: open `?shot=title|play|boss|draft|victory|over&seed=<n>`
and the game renders that exact scene, then sets `window.__shotReady`.

## Layout

- `game/index.html` — the page (canvas + module script)
- `game/src/config.js` — tuning constants and palette
- `game/src/random.js` — Mulberry32 RNG and vector helpers
- `game/src/input.js` — keyboard and mouse state
- `game/src/audio.js` — WebAudio SFX and the music sequencer
- `game/src/entities.js` — player, enemies, boss, projectiles, pickups, particles
- `game/src/waves.js` — wave director and boss attack cycle
- `game/src/render.js` — all canvas drawing, HUD, and screens
- `game/src/bot.js` — deterministic play bot (staging and scripted verification only)
- `game/src/shots.js` — deterministic screenshot staging
- `game/src/main.js` — fixed-step loop, state machine, collisions, scoring
- `main.ts` — the make.fun hand-in program
- `serve.ts` — local static server for development
- `shots.json` — the four screenshot scenes
