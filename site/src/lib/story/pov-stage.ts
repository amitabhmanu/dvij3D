// Someone else's film (design §10.4.1): the same stage, watched from outside
// Dvij. The game still moves Dvij's body as his own film does (his walks, his
// chair, the people who look at him all go by it); here he is also one of the
// cast, seen in full, and the camera is the film's (film-camera.ts), not his
// eyes. What only his eyes and hands have (his blurred sight, the glass at his
// lips, his face in the window) isn't played; an effect `for:` the film's
// person is.
//
// In Dvij's own film it passes everything through, but an effect `for:`
// someone else.
import type { Game } from "../walk/game";
import type { Act, Scene, Stage } from "./director";
import type { Actor } from "./cast";
import type { StoryScreen, StoryStage } from "./stage";
import { FilmCamera } from "./film-camera";
import { Vector3 } from "three";

/** What his body is doing, as the stage has him placed. */
type Stance = "stand" | "sit" | "lie";

export class PovStage implements Stage {
  private speaker: string | null = null;
  private names: string[] = [];
  private unstep: (() => void) | null = null;
  private stance: Stance | null = null;
  private was: { x: number; z: number } | null = null;
  private fainted = false;
  private lying = 0;
  private camera: FilmCamera;

  constructor(private game: Game, private inner: StoryStage, private screen: StoryScreen, readonly who: string) {
    this.camera = new FilmCamera({
      who: () => this.inner.people?.get(this.who) ?? null,
      speaker: () => (this.speaker ? this.inner.people?.get(this.speaker) ?? null : null),
      others: () => this.names.map((n) => this.inner.people?.get(n)).filter((a): a is Actor => !!a),
      walls: () => this.game.body.lodgeRoot(),
    });
  }

  private get own() { return this.who === "dvij"; }

  setAuto(on: boolean): void {
    this.inner.setAuto(this.own ? on : true); // (no one plays Dvij in someone else's film)
  }

  press(): void { this.inner.press(); }
  cancel(): void { this.inner.cancel(); }

  async setUp(sc: Scene): Promise<void> {
    this.unstep?.();
    this.unstep = null;
    this.speaker = null;
    this.stance = null;
    this.fainted = false;
    const there = !this.own && sc.start.pose !== "interlude" && sc.start.pose !== "away" && !sc.cast?.some((c) => c.who === "dvij");
    // Dvij joins the cast where his scene starts him, to be moved with his body from then on
    const cast = there && sc.start.at ? [...(sc.cast ?? []), { who: "dvij", at: sc.start.at }] : sc.cast;
    this.names = (cast ?? []).map((c) => c.who);
    // a scene without him (`pose: away`, Chapter 2): his body is left where it was, unposed
    const start = sc.start.pose === "away" ? { pose: "interlude" } : sc.start;
    await this.inner.setUp({ ...sc, start, cast });
    this.camera.cut();
    this.camera.shoot(null);
    this.game.body.film(this.own ? null : this.camera.rig);
    if (!this.own) this.game.body.sight.set({ blur: 0, double: 0, dark: 0, flash: 0, glare: 0 });
    const me = there ? this.inner.people?.get("dvij") : undefined;
    if (me) this.unstep = this.game.body.every((dt) => this.follow(me, dt));
  }

  /** Dvij's figure goes where his body is, as his body is: standing or walking, sat, lying down. */
  private follow(me: Actor, dt: number) {
    const body = this.game.body;
    const root = me.obj.parent?.parent; // (the cast's group, in the scene's frame)
    if (!root) return;
    const p = this.game.player();
    const at = root.worldToLocal(new Vector3(p.x, p.y, p.z));
    const floor = root.worldToLocal(new Vector3(p.x, body.surface(p.x, p.y, p.z), p.z)).y;
    const pose = this.inner.stance;
    const want: Stance = this.fainted || pose === "lie" || pose === "floor" ? "lie" : pose === "sit" || pose === "sit-low" ? "sit" : "stand";
    const face = Math.PI - p.heading; // (the game's heading -> a body that faces +z)
    if (want !== this.stance) {
      this.stance = want;
      me.obj.rotation.order = "YXZ";
      me.obj.rotation.x = 0;
      me.stop();
      me.place([at.x, at.z], want === "sit" ? "sit" : "stand", want === "sit" ? (pose === "sit-low" ? "ground" : "chair") : undefined);
      this.lying = face + Math.PI / 2; // (laid out once: he doesn't swing round as his eyes turn)
    }
    if (want === "lie") {
      // on his back, his head where his eyes are and the rest of him off to one side
      const side = this.lying;
      me.obj.rotation.x = -Math.PI / 2;
      me.obj.rotation.y = side;
      me.obj.position.set(at.x + Math.sin(side) * 1.55, floor + 0.03, at.z + Math.cos(side) * 1.55);
    } else {
      me.obj.rotation.y = face;
      if (want === "stand") {
        // walking when his body walks
        const speed = this.was ? Math.hypot(p.x - this.was.x, p.z - this.was.z) / Math.max(dt, 1e-3) : 0;
        if (speed > 0.25) void me.walk([at.x + Math.sin(p.heading) * 0.6, at.z - Math.cos(p.heading) * 0.6]);
        else if (me.busy) me.stop();
        me.obj.position.set(at.x, floor, at.z);
      }
    }
    this.was = { x: p.x, z: p.z };
    // he looks at whoever speaks to him, else at the person whose film it is
    const other = this.inner.people?.get(this.speaker && this.speaker !== "dvij" ? this.speaker : this.who);
    if (other && other !== me) me.lookAt(() => other.headAt());
  }

  async perform(verb: string, arg: any, sc: Scene, hurried: boolean): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    if ((verb === "effect" || verb === "camera") && arg?.for) {
      if (arg.for !== this.who) return;
      const { for: _f, ...rest } = arg;
      // a shot of the film's camera: a close-up of someone's eyes, or back to following
      if (verb === "camera" && rest.shot) { this.camera.shoot(rest.shot === "eyes" ? this.inner.people?.get(rest.of) ?? null : null); return; }
      return this.inner.perform(verb, rest, sc, hurried);
    }
    if (this.own) return this.inner.perform(verb, arg, sc, hurried);
    const me = this.inner.people?.get("dvij");
    switch (verb) {
      case "effect":
        // his sight is his own; but a faint, others see
        if (arg?.faint) { this.fainted = true; if (!hurried) await sleep(1.2); }
        return;
      case "look":
      case "reflection":
      case "body":
        return;
      case "animate":
        if (!hurried && me && String(arg.player).startsWith("drink")) await me.act("hand-to-mouth");
        return;
      case "say": {
        this.speaker = arg.who;
        try { return await this.inner.perform(verb, arg, sc, hurried); }
        finally { this.speaker = null; }
      }
      default:
        return this.inner.perform(verb, arg, sc, hurried);
    }
  }

  await(act: Act, sc: Scene): Promise<void> { return this.inner.await(act); void sc; }

  finished(sc: Scene, next: string | null): void {
    if (this.own) return this.inner.finished(sc, next);
    this.screen.ended(sc, next); // (a film other than Dvij's keeps no place in his: P6 gives each its own)
  }

  save(scene: string, beat: string): void {
    if (this.own) this.inner.save(scene, beat);
  }

  dispose(): void {
    this.unstep?.();
    this.game.body.film(null);
    this.inner.dispose();
  }
}

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
