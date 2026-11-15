// SHATTERLANCE — tuning constants, palette and arena geometry.
// Every number here comes from the design spec; nothing is guessed at runtime.

export const VIEW_W = 1280;
export const VIEW_H = 720;
export const HUD_H = 64;

// The framed arena sits below the HUD bar, centred horizontally.
export const ARENA = { x: 24, y: 74, w: 1232, h: 630 };
export const ARENA_RIGHT = ARENA.x + ARENA.w;
export const ARENA_BOTTOM = ARENA.y + ARENA.h;

// Fixed-step simulation and the spec's seed.
export const STEP = 1 / 60;
export const SEED = 0x5a77e201;

// Palette (spec section 10).
export const PALETTE = {
  backdrop: '#04060c',
  arena: '#070b14',
  grid: '#101a2e',
  frame: '#234270',
  frameLance: '#ffd500',
  frameHurt: '#ff2a4b',
  frameShield: '#55aaff',
  hudBar: '#0a101d',
  hudBorder: '#1e355a',
  text: '#eaf4ff',
  muted: '#7b93b8',
  player: '#00f0ff',
  playerOutline: '#a0ffff',
  playerCore: '#ffffff',
  bolt: '#88ffff',
  boltOverdrive: '#ffe666',
  lance: '#ffd500',
  lanceTrail: '#ff9900',
  gold: '#ffd500',
  red: '#ff2a4b',
  orange: '#ff7b00',
  magenta: '#ff1ec8',
  violet: '#a844ff',
  coral: '#ff5e7e',
  scarlet: '#ff0033',
  green: '#22ff66',
  blue: '#55aaff',
  spark: '#f4f8ff',
};

// Player (spec section 4).
export const PLAYER = {
  radius: 16,
  hitRadius: 10,
  speed: 290,
  maxHp: 5,
  maxShield: 2,
  fireInterval: 0.125,
  boltSpeed: 880,
  boltDamage: 1.0,
  boltDamageOverdrive: 1.45,
  twinDamage: 0.68,
  dashSpeed: 1080,
  dashTime: 0.16,
  dashCooldown: 1.5,
  dashInvuln: 0.22,
  dashVaporizeRadius: 46,
  hurtInvuln: 1.3,
  shieldInvuln: 1.0,
  lanceCatchDashRefund: 0.35,
};

// Aegis Lance (spec section 6).
export const LANCE = {
  length: 40,
  width: 14,
  speedOut: 960,
  speedBack: 1150,
  damage: 3.5,
  bounceDamageBonus: 0.35,
  bounces: 3,
  hoverTime: 1.4,
};

// Nova Overdrive (spec section 3).
export const OVERDRIVE = {
  duration: 6.0,
  clearRadius: 260,
  fireRateMul: 1.6,
  speedMul: 1.25,
};

// Combo and scoring (spec section 9).
export const SCORING = {
  comboMax: 5.0,
  comboIdleReset: 4.2,
  grazeScore: 150,
  sparkScore: 150,
  waveClearBonus: 500,
  ranks: [
    { min: 40000, rank: 'S' },
    { min: 25000, rank: 'A' },
    { min: 14000, rank: 'B' },
    { min: 0, rank: 'C' },
  ],
};

// Enemy projectiles (spec section 6).
export const ENEMY_SHOTS = {
  orbSpeed: 275,
  orbRadius: 7,
  diamondSpeed: 250,
  diamondRadius: 9,
  siegeSpeed: 230,
  siegeRadius: 12,
  bossBeamSpeed: 445,
};

// Pickups (spec section 7).
export const PICKUPS = {
  repairRadius: 14,
  shieldRadius: 14,
  sparkRadius: 11,
  repairChance: 0.08,
  shieldChance: 0.06,
  sparkChance: 0.58,
  sparkOverdrive: 0.12,
  magnetBase: 90,
};

// Waves (spec section 8): counts are total spawns per wave; pacing is handled
// by the wave scheduler. Difficulty grows through spawn count and mix only,
// never through enemy HP inflation.
export const WAVES = [
  { n: 1, duration: 26, swarmers: 14, gunners: 4, chargers: 0, weavers: 0, bulwarks: 0 },
  { n: 2, duration: 30, swarmers: 16, gunners: 6, chargers: 5, weavers: 0, bulwarks: 0 },
  { n: 3, duration: 32, swarmers: 16, gunners: 7, chargers: 6, weavers: 6, bulwarks: 0 },
  { n: 4, duration: 34, swarmers: 18, gunners: 8, chargers: 7, weavers: 7, bulwarks: 4 },
  { n: 5, duration: 35, swarmers: 22, gunners: 9, chargers: 8, weavers: 8, bulwarks: 6 },
  { n: 6, duration: 0, boss: true },
];

export const SPAWN_WARNING = 0.65;

// The eight module upgrades (spec section 4).
export const UPGRADES = [
  {
    id: 'twin',
    name: 'Twin-Linked Bolts',
    max: 1,
    blurb: 'Fire 2 parallel Kinetic Bolts. +35% total damage.',
    color: '#88ffff',
  },
  {
    id: 'ricochet',
    name: 'Ricochet Mastery',
    max: 2,
    blurb: '+2 Lance wall bounces and +25% Lance speed per level.',
    color: '#ffd500',
  },
  {
    id: 'tempest',
    name: 'Tempest Dash',
    max: 2,
    blurb: '-30% Dash cooldown and a damaging shockwave on arrival.',
    color: '#00f0ff',
  },
  {
    id: 'arc',
    name: 'Arc Conductor',
    max: 1,
    blurb: 'Every 4th bolt chains lightning to 2 nearby foes.',
    color: '#a844ff',
  },
  {
    id: 'magnetic',
    name: 'Magnetic Core',
    max: 2,
    blurb: '2x pickup magnet radius and +50% Overdrive gain.',
    color: '#f4f8ff',
  },
  {
    id: 'hull',
    name: 'Hull Reinforce',
    max: 2,
    blurb: '+1 Max Hull, heal +2 Hull, +1 Shield pip.',
    color: '#22ff66',
  },
  {
    id: 'shatter',
    name: 'Shatter Lance',
    max: 1,
    blurb: 'Explosive plasma blasts on Lance hits and bounces.',
    color: '#ff7b00',
  },
  {
    id: 'overclock',
    name: 'Overclock Matrix',
    max: 2,
    blurb: '+25% fire rate, +12% speed, +2.5s Overdrive.',
    color: '#ffe666',
  },
];
