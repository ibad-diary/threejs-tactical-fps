// Fully synthetic WebAudio: oscillators + noise buffers, no audio files.
export class AudioSys {
  constructor() {
    this.ctx = null; this.muted = false; this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  setMuted(m) { this.muted = m; }

  // Generic one-shot: noise through a filter + gain envelope, optionally a tone.
  burst({ dur = 0.12, type = 'bandpass', freq = 1200, q = 1, gain = 0.25,
          tone = null, toneFreq = 0, toneGain = 0, sweepTo = 0, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    out.connect(this.ctx.destination);
    if (this.noiseBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      src.connect(f); f.connect(out); src.start(t0); src.stop(t0 + dur + 0.05);
    }
    if (tone) {
      const o = this.ctx.createOscillator(); o.type = tone; o.frequency.setValueAtTime(toneFreq, t0);
      if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(toneGain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    }
  }

  shot(kind = 'rifle') {
    const p = kind === 'pistol' ? { freq: 1600, gain: 0.3, toneFreq: 160, toneGain: 0.25, sweepTo: 60 }
      : kind === 'smg' ? { freq: 2200, gain: 0.2, toneFreq: 200, toneGain: 0.18, sweepTo: 70 }
      : { freq: 900, gain: 0.32, toneFreq: 120, toneGain: 0.3, sweepTo: 50 };
    this.burst({ dur: 0.1, type: 'lowpass', ...p, tone: 'sine' });
  }
  // Distant bot shot: quieter, lowpassed.
  distantShot() { this.burst({ dur: 0.12, type: 'lowpass', freq: 500, gain: 0.06, tone: 'sine', toneFreq: 90, toneGain: 0.06, sweepTo: 45 }); }
  hit() { this.burst({ dur: 0.05, type: 'highpass', freq: 3000, gain: 0.15 }); }
  kill() {
    this.burst({ dur: 0.06, type: 'highpass', freq: 3000, gain: 0.2 });
    this.burst({ dur: 0.12, type: 'sine', freq: 800, gain: 0.18, tone: 'sine', toneFreq: 880, toneGain: 0.18, delay: 0.06 });
  }
  hurt() { this.burst({ dur: 0.15, type: 'lowpass', freq: 300, gain: 0.25, tone: 'sawtooth', toneFreq: 90, toneGain: 0.12, sweepTo: 50 }); }
  reload() {
    this.burst({ dur: 0.04, type: 'bandpass', freq: 1800, gain: 0.15 });
    this.burst({ dur: 0.04, type: 'bandpass', freq: 1200, gain: 0.15, delay: 0.18 });
    this.burst({ dur: 0.05, type: 'bandpass', freq: 2400, gain: 0.18, delay: 0.4 });
  }
  step() { this.burst({ dur: 0.05, type: 'lowpass', freq: 400, gain: 0.05 }); }
  beep(freq = 1200) { this.burst({ dur: 0.09, type: 'sine', freq, gain: 0.2, tone: 'sine', toneFreq: freq, toneGain: 0.2 }); }
  plant() { this.beep(1400); }
  explosion() {
    this.burst({ dur: 1.4, type: 'lowpass', freq: 500, gain: 0.6, tone: 'sine', toneFreq: 70, toneGain: 0.5, sweepTo: 30 });
  }
  roundWin() {
    for (const [f, d] of [[523, 0], [659, 0.12], [784, 0.24]]) {
      this.burst({ dur: 0.18, type: 'sine', freq: f, gain: 0.18, tone: 'sine', toneFreq: f, toneGain: 0.18, delay: d });
    }
  }
  roundLose() {
    for (const [f, d] of [[392, 0], [330, 0.15], [262, 0.3]]) {
      this.burst({ dur: 0.2, type: 'sine', freq: f, gain: 0.16, tone: 'sine', toneFreq: f, toneGain: 0.16, delay: d });
    }
  }
}
