// Mulberry32 — the only source of randomness in gameplay.
// The spec forbids Math.random in gameplay; every roll, spawn pick and jitter
// goes through an instance of this class, seeded from the spec's seed plus the
// run seed so staged shots are reproducible.

export class Mulberry32 {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  // Next float in [0, 1).
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Integer in [min, max).
  int(min, max) {
    return min + Math.floor(this.next() * (max - min));
  }

  // Float in [min, max).
  range(min, max) {
    return min + this.next() * (max - min);
  }

  // Pick one element of a non-empty array.
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  // True with probability p.
  chance(p) {
    return this.next() < p;
  }

  // A random angle in radians.
  angle() {
    return this.next() * Math.PI * 2;
  }
}

// Small vector helpers shared by the simulation.
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function length(x, y) {
  return Math.sqrt(x * x + y * y);
}

export function dist(ax, ay, bx, by) {
  return length(ax - bx, ay - by);
}

export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// Shortest signed turn from angle a towards angle b.
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
