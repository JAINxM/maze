// Lightweight SFX using the Web Audio API (no external files).
// Audio context needs a user gesture; call ensureUnlocked() from input events.

export class SoundFX {
  constructor() {
    this.enabled = true;
    this._ctx = null;
    this._unlocked = false;
  }

  setEnabled(value) {
    this.enabled = !!value;
  }

  async ensureUnlocked() {
    if (!this.enabled) return;
    if (this._unlocked) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this._ctx) this._ctx = new AudioCtx();
    try {
      if (this._ctx.state === "suspended") await this._ctx.resume();
      // One silent tick to mark it as unlocked across browsers.
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this._ctx.destination);
      osc.start();
      osc.stop(this._ctx.currentTime + 0.01);
      this._unlocked = true;
    } catch {
      // Ignore; some environments block audio.
    }
  }

  _beep({ freq = 440, dur = 0.06, type = "sine", gain = 0.06 } = {}) {
    if (!this.enabled) return;
    if (!this._ctx || !this._unlocked) return;
    const t0 = this._ctx.currentTime;

    const osc = this._ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);

    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(this._ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  click() {
    this._beep({ freq: 700, dur: 0.045, type: "square", gain: 0.04 });
  }

  move() {
    this._beep({ freq: 520, dur: 0.03, type: "triangle", gain: 0.03 });
  }

  blocked() {
    this._beep({ freq: 170, dur: 0.05, type: "sawtooth", gain: 0.04 });
  }

  win() {
    // Simple arpeggio.
    this._beep({ freq: 440, dur: 0.08, type: "sine", gain: 0.05 });
    setTimeout(() => this._beep({ freq: 554, dur: 0.08, type: "sine", gain: 0.05 }), 90);
    setTimeout(() => this._beep({ freq: 659, dur: 0.12, type: "sine", gain: 0.06 }), 180);
  }
}
