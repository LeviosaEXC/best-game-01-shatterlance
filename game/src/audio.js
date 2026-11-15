// WebAudio synthesis: every sound effect and the procedural synthwave
// sequencer are built from oscillators and a deterministic noise buffer.
// Zero external assets, zero network. The AudioContext is created lazily on
// the first user gesture so browsers allow it.

const BPM = 128;
const SIXTEENTH = 60 / BPM / 4;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.noiseBuffer = null;
    this.musicTimer = null;
    this.step = 0;
    this.nextStepTime = 0;
    // A minor-key synthwave bass line, 16 steps, in Hz.
    this.bassLine = [55, 0, 55, 65.41, 55, 0, 49, 55, 55, 0, 55, 65.41, 73.42, 65.41, 58.27, 49];
    this.arpNotes = [220, 261.63, 329.63, 440, 523.25, 440, 329.63, 261.63];
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
    // Deterministic noise: a fixed pseudo-random buffer built once.
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let s = 0x12345678;
    for (let i = 0; i < len; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = (s / 4294967296) * 2 - 1;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.15, vol = 0.3, when = 0, attack = 0.005 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, freq = 1200, q = 1, type = 'bandpass', when = 0, freqEnd = null }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // Named effects, one per game event.
  shoot(overdrive) {
    this.tone({ type: 'square', freq: overdrive ? 980 : 840, freqEnd: overdrive ? 320 : 260, dur: 0.07, vol: 0.12 });
  }

  lanceThrow() {
    this.noise({ dur: 0.22, vol: 0.25, freq: 900, freqEnd: 3200, q: 2 });
    this.tone({ type: 'sawtooth', freq: 300, freqEnd: 900, dur: 0.18, vol: 0.1 });
  }

  lanceBounce() {
    this.tone({ type: 'sine', freq: 1180, freqEnd: 1560, dur: 0.09, vol: 0.2 });
  }

  lanceCatch() {
    this.tone({ type: 'triangle', freq: 660, dur: 0.08, vol: 0.22 });
    this.tone({ type: 'triangle', freq: 990, dur: 0.1, vol: 0.2, when: 0.06 });
  }

  dash() {
    this.noise({ dur: 0.18, vol: 0.3, freq: 2400, freqEnd: 300, q: 1.2 });
  }

  graze() {
    this.tone({ type: 'sine', freq: 1900, freqEnd: 2600, dur: 0.06, vol: 0.16 });
  }

  hit() {
    this.noise({ dur: 0.08, vol: 0.2, freq: 900, q: 0.8 });
  }

  shieldClang() {
    this.tone({ type: 'triangle', freq: 1240, freqEnd: 820, dur: 0.16, vol: 0.25 });
    this.tone({ type: 'square', freq: 620, dur: 0.1, vol: 0.1 });
  }

  shatter(big) {
    this.noise({ dur: big ? 0.5 : 0.28, vol: big ? 0.5 : 0.32, freq: 700, freqEnd: 120, q: 0.7 });
    this.tone({ type: 'sine', freq: big ? 160 : 220, freqEnd: 40, dur: big ? 0.45 : 0.25, vol: 0.35 });
  }

  heal() {
    this.tone({ type: 'sine', freq: 523.25, dur: 0.1, vol: 0.2 });
    this.tone({ type: 'sine', freq: 783.99, dur: 0.14, vol: 0.2, when: 0.08 });
  }

  shieldPickup() {
    this.tone({ type: 'triangle', freq: 392, dur: 0.1, vol: 0.2 });
    this.tone({ type: 'triangle', freq: 587.33, dur: 0.14, vol: 0.2, when: 0.08 });
  }

  spark() {
    this.tone({ type: 'sine', freq: 1046.5, dur: 0.08, vol: 0.16 });
    this.tone({ type: 'sine', freq: 1567.98, dur: 0.12, vol: 0.16, when: 0.05 });
  }

  hurt() {
    this.tone({ type: 'sawtooth', freq: 220, freqEnd: 55, dur: 0.35, vol: 0.4 });
    this.noise({ dur: 0.25, vol: 0.3, freq: 400, freqEnd: 90 });
  }

  overdrive() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone({ type: 'triangle', freq: f, dur: 0.3, vol: 0.22, when: i * 0.07 });
    });
  }

  waveClear() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone({ type: 'triangle', freq: f, dur: 0.18, vol: 0.2, when: i * 0.09 });
    });
  }

  bossSiren() {
    for (let i = 0; i < 3; i++) {
      this.tone({ type: 'sawtooth', freq: 440, freqEnd: 880, dur: 0.3, vol: 0.18, when: i * 0.35 });
      this.tone({ type: 'sawtooth', freq: 880, freqEnd: 440, dur: 0.3, vol: 0.18, when: i * 0.35 + 0.32 });
    }
  }

  victory() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      this.tone({ type: 'triangle', freq: f, dur: 0.4, vol: 0.22, when: i * 0.12 });
    });
  }

  gameOver() {
    [392, 311.13, 233.08, 155.56].forEach((f, i) => {
      this.tone({ type: 'sawtooth', freq: f, dur: 0.5, vol: 0.2, when: i * 0.22 });
    });
  }

  draft() {
    this.tone({ type: 'sine', freq: 880, dur: 0.1, vol: 0.18 });
    this.tone({ type: 'sine', freq: 1174.66, dur: 0.16, vol: 0.18, when: 0.07 });
  }

  // Procedural 128 BPM 16th-note synthwave sequencer.
  startMusic() {
    this.ensure();
    if (!this.ctx || this.musicTimer) return;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 40);
  }

  stopMusic() {
    if (this.musicTimer) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  scheduleMusic() {
    if (!this.ctx || this.muted) return;
    while (this.nextStepTime < this.ctx.currentTime + 0.15) {
      const t = this.nextStepTime;
      const s = this.step % 16;
      const when = t - this.ctx.currentTime;
      // Sine kick on quarters.
      if (s % 4 === 0) this.musicTone('sine', 150, 42, 0.16, 0.5, when, this.musicGain);
      // High-passed noise hi-hat on off-8ths.
      if (s % 4 === 2) this.musicNoise(0.05, 0.12, 8000, when);
      // Low-passed sawtooth bass.
      const bass = this.bassLine[s];
      if (bass > 0) this.musicTone('sawtooth', bass, bass, 0.2, 0.16, when, this.musicGain, 320);
      // Escalating triangle arpeggio, louder every other bar.
      const arp = this.arpNotes[(s + Math.floor(this.step / 16) * 3) % this.arpNotes.length];
      this.musicTone('triangle', arp * 2, arp * 2, 0.12, 0.07, when, this.musicGain);
      this.step++;
      this.nextStepTime += SIXTEENTH;
    }
  }

  musicTone(type, freq, freqEnd, dur, vol, when, dest, lowpass = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + Math.max(0, when);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    if (lowpass > 0) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      gain.connect(filter);
      filter.connect(dest);
    } else {
      gain.connect(dest);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  musicNoise(dur, vol, freq, when) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + Math.max(0, when);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }
}
