/* ============================================================================
   audio.js — every sound effect synthesized with the Web Audio API, no
   asset files (same no-files approach as air-drums/index.html). The
   AudioContext is created/resumed lazily via ensure(), which must be called
   from inside a user-gesture handler (the Start button click) — browsers
   refuse to start audio before that.
   ============================================================================ */

export class AudioEngine {
  constructor() {
    this.ctx = null;
  }

  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _envGain(attack, release, peak) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return gain;
  }

  _noiseBuffer(durationS) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * durationS);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  }

  _click(freq, peak = 0.25) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = this._envGain(0.001, 0.05, peak);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }

  playShot() {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this._noiseBuffer(0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 700;
    const noiseGain = this._envGain(0.004, 0.11, 0.5);
    noiseSrc.connect(filter).connect(noiseGain).connect(ctx.destination);
    noiseSrc.start();

    const thump = ctx.createOscillator();
    thump.type = 'square';
    thump.frequency.setValueAtTime(150, ctx.currentTime);
    thump.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.08);
    const thumpGain = this._envGain(0.002, 0.09, 0.4);
    thump.connect(thumpGain).connect(ctx.destination);
    thump.start();
    thump.stop(ctx.currentTime + 0.1);
  }

  playEmpty() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 190;
    const gain = this._envGain(0.001, 0.045, 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  playHit(headshot) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = headshot ? 1500 : 950;
    const gain = this._envGain(0.001, 0.09, 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  playReloadStart() {
    this._click(560);
  }

  playReloadDone() {
    this._click(880);
    setTimeout(() => this._click(1180), 90);
  }

  playLowAmmoBeep() {
    this._click(700, 0.15);
  }
}
