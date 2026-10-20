// The valley's sounds (design §10.2), made live with Web Audio rather than
// recorded: wind that rises as you climb, birds where the trees are, water
// lapping near Sheetal Lake, and footsteps that sound like what you walk on.
// Generated, so there is nothing to download and no licence to credit.
//
// Browsers only allow sound after a click, so the game starts it from the
// click that starts walking.

export type Surface = "grass" | "earth" | "rock";
export type Hearing = {
  /** metres above the valley floor */
  height: number;
  /** 0-1: how wooded it is around you */
  trees: number;
  /** metres to the nearest water */
  water: number;
};

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return b;
}

function loop(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start();
  return s;
}

/** Wind gets louder with height; birds follow the trees; water fades in within this many metres. */
export function levels(h: Hearing): { wind: number; birds: number; water: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    wind: 0.12 + 0.55 * clamp(h.height / 600),
    birds: clamp(h.trees) * (1 - clamp(h.height / 700)),
    water: clamp(1 - h.water / 160),
  };
}

export class Sounds {
  private ctx: AudioContext;
  private master: GainNode;
  private wind: GainNode;
  private water: GainNode;
  private windFilter: BiquadFilterNode;
  private noise: AudioBuffer;
  private birdsLevel = 0;
  private nextBird = 0;
  private stepGain: GainNode;

  constructor(volume: number) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(this.ctx.destination);
    this.noise = noiseBuffer(this.ctx, 4);

    // wind: noise through a slowly wandering band-pass
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.wind = this.ctx.createGain();
    this.wind.gain.value = 0;
    loop(this.ctx, this.noise).connect(this.windFilter).connect(this.wind).connect(this.master);

    // water: low noise with a lapping swell
    const lap = this.ctx.createBiquadFilter();
    lap.type = "lowpass";
    lap.frequency.value = 520;
    const swell = this.ctx.createGain();
    swell.gain.value = 0.6;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 0.35;
    lfo.connect(lfoDepth).connect(swell.gain);
    lfo.start();
    this.water = this.ctx.createGain();
    this.water.gain.value = 0;
    loop(this.ctx, this.noise).connect(lap).connect(swell).connect(this.water).connect(this.master);

    this.stepGain = this.ctx.createGain();
    this.stepGain.gain.value = 0.5;
    this.stepGain.connect(this.master);
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  get state(): AudioContextState {
    return this.ctx.state;
  }

  pause() {
    void this.ctx.suspend();
  }

  resume() {
    void this.ctx.resume();
  }

  /** Called a few times a second with where you are. */
  hear(h: Hearing) {
    const l = levels(h);
    const t = this.ctx.currentTime;
    this.wind.gain.setTargetAtTime(l.wind * 0.35, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(380 + 160 * Math.sin(t * 0.21) + 240 * Math.min(1, h.height / 600), t, 1.5);
    this.water.gain.setTargetAtTime(l.water * 0.3, t, 0.6);
    this.birdsLevel = l.birds;
    if (t > this.nextBird) {
      if (Math.random() < this.birdsLevel) this.chirp();
      this.nextBird = t + 0.6 + Math.random() * 2.4;
    }
  }

  private chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2400 + Math.random() * 2200;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8; // somewhere in the trees around you
    pan.connect(this.master);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const s = t + i * (0.09 + Math.random() * 0.05);
      o.type = "sine";
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.15), s);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), s + 0.07);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05 * this.birdsLevel, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.1);
    }
  }

  /** One footstep, coloured by the ground under it. */
  step(surface: Surface, running: boolean) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = { grass: 2600, earth: 900, rock: 1800 }[surface] * (0.85 + Math.random() * 0.3);
    f.Q.value = surface === "rock" ? 2.5 : 0.9;
    const g = ctx.createGain();
    const peak = ({ grass: 0.18, earth: 0.3, rock: 0.34 }[surface]) * (running ? 1.3 : 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (surface === "rock" ? 0.07 : 0.14));
    src.connect(f).connect(g).connect(this.stepGain);
    src.start(t, Math.random() * 3);
    src.stop(t + 0.2);
  }

  dispose() {
    void this.ctx.close();
  }
}
