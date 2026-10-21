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
  /** inside a building: no wind, and the birds and water only through the windows */
  indoors?: boolean;
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

/** Wind gets louder with height (and comes in gusts, see Sounds.hear); birds follow the trees;
 * water fades in within this many metres. Indoors there is no wind: a steady wind in a room
 * sounds like a ceiling fan. */
export function levels(h: Hearing): { wind: number; birds: number; water: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const through = h.indoors ? 0.3 : 1;
  return {
    wind: h.indoors ? 0 : 0.06 + 0.6 * clamp(h.height / 600),
    birds: clamp(h.trees) * (1 - clamp(h.height / 700)) * through,
    water: clamp(1 - h.water / 160) * through,
  };
}

export class Sounds {
  private ctx: AudioContext;
  private master: GainNode;
  private wind: GainNode;
  private water: GainNode;
  private windFilter: BiquadFilterNode;
  private gust = 0.5;
  private nextGust = 0;
  private noise: AudioBuffer;
  private birdsLevel = 0;
  private nextBird = 0;
  private stepGain: GainNode;
  private fanGain: GainNode;
  private fanPulse: OscillatorNode;
  private nextTick = 0;

  constructor(volume: number) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(this.ctx.destination);
    this.noise = noiseBuffer(this.ctx, 4);

    // wind: noise through a slowly wandering band-pass
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "lowpass"; // air moving, not a whirr: a band-pass held at one pitch sounded like a fan
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.3;
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

    // a ceiling fan: air chopped by its blades (a low band of noise, pulsing at the blade rate)
    const whir = this.ctx.createBiquadFilter();
    whir.type = "bandpass";
    whir.frequency.value = 160;
    whir.Q.value = 1.1;
    const chop = this.ctx.createGain();
    chop.gain.value = 0.7;
    this.fanPulse = this.ctx.createOscillator();
    this.fanPulse.frequency.value = 2;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.3;
    this.fanPulse.connect(depth).connect(chop.gain);
    this.fanPulse.start();
    this.fanGain = this.ctx.createGain();
    this.fanGain.gain.value = 0;
    loop(this.ctx, this.noise).connect(whir).connect(chop).connect(this.fanGain).connect(this.master);
  }

  /** The running ceiling fans, a few times a second: how far each is (metres), how fast it turns
   * (turns a second), and whether it creaks (novel ¶93). The nearest ticks once a turn. */
  fans(running: { d: number; speed: number; creak: boolean }[]) {
    const t = this.ctx.currentTime;
    const near = (d: number) => Math.max(0, 1 - d / 14) ** 2;
    const level = running.reduce((a, f) => a + Math.min(1, f.speed) * near(f.d), 0);
    this.fanGain.gain.setTargetAtTime(Math.min(1, level) * 0.22, t, 0.4);
    const loudest = running.reduce<{ d: number; speed: number; creak: boolean } | null>((a, f) => (!a || f.speed * near(f.d) > a.speed * near(a.d) ? f : a), null);
    if (!loudest || loudest.speed < 0.05 || near(loudest.d) <= 0) return;
    this.fanPulse.frequency.setTargetAtTime(loudest.speed * 4, t, 0.5); // four blades
    if (t < this.nextTick) return;
    this.nextTick = t + 1 / loudest.speed;
    // once a turn: a soft tick from the bearing, and for an old fan a creak of the apparatus
    const at = t + 0.02;
    for (const [f, q, len, peak] of loudest.creak ? [[2600, 18, 0.05, 0.12], [520, 14, 0.35, 0.09]] : [[2600, 18, 0.05, 0.08]]) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * (0.9 + Math.random() * 0.2);
      bp.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak * near(loudest.d), at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      src.connect(bp).connect(g).connect(this.master);
      src.start(at, Math.random() * 3);
      src.stop(at + len + 0.05);
    }
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
    // gusts: the wind wanders between a breath and a blow every few seconds, so it never settles into a drone
    if (t > this.nextGust) {
      this.gust = 0.15 + 0.85 * Math.random() ** 1.5;
      this.nextGust = t + 2 + Math.random() * 5;
    }
    this.wind.gain.setTargetAtTime(l.wind * 0.35 * this.gust, t, 1.2);
    this.windFilter.frequency.setTargetAtTime(300 + 500 * this.gust + 300 * Math.min(1, h.height / 600), t, 1.5);
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

  /** A one-off sound the story calls for: a clatter, a creak, a crash, a splash ... */
  fx(name: string) {
    const ctx = this.ctx, t = ctx.currentTime;
    const shape: Record<string, { f: number; q: number; len: number; peak: number; hits: number }> = {
      clatter: { f: 3200, q: 3, len: 0.09, peak: 0.5, hits: 5 },
      creak: { f: 420, q: 12, len: 0.6, peak: 0.35, hits: 1 },
      crash: { f: 1400, q: 0.8, len: 0.5, peak: 0.7, hits: 4 },
      splash: { f: 1800, q: 0.5, len: 0.4, peak: 0.45, hits: 2 },
      gulp: { f: 300, q: 4, len: 0.12, peak: 0.4, hits: 3 },
      thud: { f: 120, q: 1, len: 0.25, peak: 0.8, hits: 1 },
      hiss: { f: 5000, q: 0.7, len: 1.2, peak: 0.25, hits: 1 },
      clink: { f: 4200, q: 30, len: 0.35, peak: 0.6, hits: 2 },
      gong: { f: 220, q: 40, len: 2.8, peak: 0.8, hits: 1 },
    };
    const s = shape[name] ?? shape.thud;
    for (let i = 0; i < s.hits; i++) {
      const at = t + i * (s.len * 0.7 + Math.random() * 0.05);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = s.f * (0.8 + Math.random() * 0.4);
      f.Q.value = s.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(s.peak, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + s.len);
      src.connect(f).connect(g).connect(this.master);
      src.start(at, Math.random() * 3);
      src.stop(at + s.len + 0.05);
    }
  }

  dispose() {
    void this.ctx.close();
  }
}
