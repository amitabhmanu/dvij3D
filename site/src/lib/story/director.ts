// Story mode's director (design §10.4): plays a scene's beats in order.
//
// A beat either just plays (`do`), or asks the player for an action (`act`)
// and plays its consequences (`then`) once it's done. Everything the director
// does to the world goes through a Stage, which the game provides, so the
// director itself is plain logic and is unit tested with a fake stage.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Action = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- one key, the verb
export type Act = {
  objective: string;
  kind: "press" | "look-press" | "reach" | "use";
  target?: string | Vec2 | Vec3;
  radius?: number;
  hint?: Vec2;
};
export type Beat = { id: string; sources: string[]; do?: Action[]; act?: Act; then?: Action[] };
export type Scene = {
  scene: string; book: number; pages: number[]; title: string;
  /** Whose frame its places are in: the lodge's (the default) or another built place's ("temple-site"). */
  frame?: string;
  start: { pose: string; at?: Vec2; look?: "up" | Vec3 };
  cast?: { who: string; at: Vec2; pose?: string }[];
  props?: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  beats: Beat[];
};

/** What the director needs from the game and its screens. */
export interface Stage {
  /** Run one action; resolves when it has finished playing. `hurried`: at once, silently (skipping or resuming). */
  perform(verb: string, arg: unknown, scene: Scene, hurried: boolean): Promise<void>;
  /** Show what the player should do, and resolve once they've done it. */
  await(act: Act, scene: Scene): Promise<void>;
  /** Set up a scene: place the player, props and cast. */
  setUp(scene: Scene, from?: string): Promise<void>;
  /** The scene is over: what comes next (a scene id, or null at the end). */
  finished(scene: Scene, next: string | null): void;
  /** Remember where to resume. */
  save(scene: string, beat: string): void;
  /** Stop waiting for the player: the scene is being skipped. */
  cancel?(): void;
}

export class Director {
  private stopped = false;
  private playing = 0; // which play() is current: an older one, superseded, stops at its next step
  private skipping = false;
  private skipAll = false;
  current: { scene: string; beat: string } | null = null;

  constructor(private stage: Stage, private scenes: Scene[]) {}

  /** The scenes in the order they play. */
  get order(): { id: string; title: string }[] {
    return this.scenes.map((s) => ({ id: s.scene, title: s.title }));
  }

  scene(id: string): Scene {
    const s = this.scenes.find((x) => x.scene === id);
    if (!s) throw new Error(`story: no scene ${id}`);
    return s;
  }

  /** Play a scene from its start, or from a checkpoint beat. */
  async play(id: string, fromBeat?: string): Promise<void> {
    const sc = this.scene(id);
    this.stage.cancel?.(); // anything still waiting from before
    const me = ++this.playing;
    const over = () => this.stopped || me !== this.playing;
    this.stopped = false;
    this.skipping = false;
    this.skipAll = false;
    await this.stage.setUp(sc, fromBeat);
    // Resuming: replay what came before the checkpoint at once (props, poses), without the words or the waiting.
    const resumeAt = fromBeat ? Math.max(0, sc.beats.findIndex((b) => b.id === fromBeat)) : 0;
    for (let i = 0; i < sc.beats.length; i++) {
      if (over()) return;
      const beat = sc.beats[i];
      this.skipping = this.skipAll || i < resumeAt;
      this.current = { scene: sc.scene, beat: beat.id };
      for (const a of beat.do ?? []) {
        if (over()) return;
        await this.run(a, sc);
      }
      if (beat.act && !this.skipping) await this.stage.await(beat.act, sc);
      for (const a of beat.then ?? []) {
        if (over()) return;
        await this.run(a, sc);
      }
    }
  }

  private async run(a: Action, sc: Scene): Promise<void> {
    const [verb, arg] = Object.entries(a)[0];
    if (verb === "checkpoint") {
      this.stage.save(sc.scene, this.current!.beat);
      return;
    }
    if (verb === "end") {
      const next = (arg as { next: string | null }).next;
      this.stage.finished(sc, next);
      return;
    }
    if (this.skipping && (verb === "wait" || verb === "caption" || verb === "say" || verb === "sound")) return;
    await this.stage.perform(verb, arg, sc, this.skipping);
  }

  /** Hurry through the rest of the scene: waits, words and actions are skipped. */
  skip(): void {
    this.skipAll = true;
    this.skipping = true;
    this.stage.cancel?.();
  }

  stop(): void {
    this.stopped = true;
    this.stage.cancel?.();
  }
}
