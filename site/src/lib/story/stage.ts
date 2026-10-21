// Story mode's stage (design §10.4): what the director's actions do in the
// game and on the screen. The game moves Dvij's body and eyes; the screen
// (Walk.tsx) shows captions, subtitles, objectives, comic panels and the
// reflection; the props are the scene's own things.
import type { Game } from "../walk/game";
import { reachPage } from "../progress";
import type { Act, Scene, Stage, Vec2, Vec3 } from "./director";
import { Props } from "./props";
import { Hands } from "./hands";
import { Vector3 } from "three";

/** What the screen offers the story. */
export type StoryScreen = {
  caption: (text: string) => Promise<void>;
  say: (who: string, line: string) => Promise<void>;
  objective: (text: string | null, ready?: boolean) => void;
  hint: (text: string | null) => void;
  card: (title: string, subtitle?: string) => Promise<void>;
  panels: (pages: string[]) => Promise<void>;
  reflection: (panel: string) => Promise<void>;
  /** A comic panel held full screen while the next words play (null: back to the world). */
  panel: (id: string | null) => void;
  ended: (scene: Scene, next: string | null) => void;
  /** Is the game paused (the story's clock stops with it)? */
  paused: () => boolean;
  /** How fast the story's clock runs: 0.5 slow motion, 1, 2, 4 fast forward. */
  rate: () => number;
};

import { writeSaved } from "./saved";

/** Waits `seconds` of the story's time: paused time doesn't count, and `rate` speeds or slows it.
 * Resolves early if `early()` turns true. */
export function sleep(seconds: number, paused: () => boolean, early: () => boolean = () => false, rate: () => number = () => 1): Promise<void> {
  return new Promise((done) => {
    let left = seconds * 1000;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (!paused()) left -= (now - last) * rate();
      last = now;
      if (left <= 0 || early()) done();
      else setTimeout(tick, 50);
    };
    tick();
  });
}

const POSES = new Set(["lie", "sit", "sit-low", "stand", "floor"]);

export class StoryStage implements Stage {
  private props: Props | null = null;
  private unstep: (() => void) | null = null;
  private frame = "lodge";
  private pressed = false;
  private advance = false;
  private cancelled = false;
  private pose = "stand";
  /** Watch mode: the story does what each beat asks by itself, and Dvij can't be steered. */
  private auto = false;

  private hands: Hands;

  constructor(private game: Game, private screen: StoryScreen) {
    this.hands = new Hands(() => game.body.arms(), (s) => this.sleep(s));
  }

  /** E, Space or a click: does the thing asked, or moves the words on. */
  press(): void {
    this.pressed = true;
    this.advance = true;
  }

  /** A place in the scene's frame (the lodge's, or the temple site's) -> the world. */
  private world(p: Vec2 | Vec3): [number, number, number] {
    const [x, y, z] = p.length === 2 ? [p[0], 1.2, p[1]] : p;
    const b = this.game.body;
    return this.frame === "lodge" ? b.fromLodge(x, y, z) : b.fromSite(this.frame, x, y, z);
  }

  private holdFor(pose: string) {
    this.pose = pose;
    this.game.body.hold(this.auto ? "none" : pose === "stand" ? "free" : pose === "floor" || pose === "interlude" ? "none" : "look");
  }

  /** Watch the story (it plays itself) or play it (Dvij does what each beat asks). */
  setAuto(on: boolean): void {
    this.auto = on;
    this.holdFor(this.pose);
  }

  private sleep(seconds: number, early?: () => boolean) {
    return sleep(seconds, this.screen.paused, early, this.screen.rate);
  }

  /** Watch mode: do what the beat asks, as Dvij would. */
  private async acted(act: Act, t: [number, number, number] | null): Promise<void> {
    const body = this.game.body;
    if (act.kind === "press" || !t) return this.sleep(1.2, () => this.cancelled);
    if (act.kind === "reach") return body.walkTo([t[0], t[2]]);
    const me = this.game.player();
    const d = Math.hypot(t[0] - me.x, t[2] - me.z);
    if (d > 2.2 && this.pose === "stand") await body.walkTo([t[0] + ((me.x - t[0]) / d) * 1.1, t[2] + ((me.z - t[2]) / d) * 1.1]);
    if (this.cancelled) return;
    await body.turnTo(t, 0.9);
    await this.sleep(0.5, () => this.cancelled);
  }

  async setUp(sc: Scene): Promise<void> {
    this.game.body.halt();
    this.screen.panel(null);
    this.props?.dispose();
    this.frame = sc.frame ?? "lodge";
    const body = this.game.body;
    body.setting({ sun: sc.setting?.sun, court: sc.setting?.court });
    for (const [room, speed] of Object.entries(sc.setting?.fans ?? {})) body.fan(room, speed);
    const origin = this.world([0, 0, 0]); // (the props stand in the scene's frame: translated only)
    this.unstep?.();
    this.props = new Props((sc.props ?? []) as never, body.lodgeRoot(), {
      surface: (x, y, z) => body.surface(x + origin[0], y + origin[1], z + origin[2]) - origin[1],
      sound: (name) => body.fx(name),
    });
    const props = this.props;
    this.unstep = body.every((dt) => props.update(dt));
    (this.frame === "lodge" ? this.game.body.lodgeRoot() : this.game.body.siteRoot(this.frame))?.add(this.props.group);
    this.game.body.sight.set({ blur: 0, double: 0, dark: 0, flash: 0, glare: 0 });
    this.game.body.injured(false);
    const st = sc.start;
    if (st.pose === "interlude") {
      this.holdFor("interlude");
      return;
    }
    const at = st.at ? this.world(st.at) : undefined;
    const look = st.look === "up" ? "up" : st.look ? this.world(st.look) : undefined;
    await this.game.body.pose({ pose: st.pose as never, at: at ? [at[0], at[2]] : undefined, look });
    this.holdFor(st.pose);
  }

  async perform(verb: string, arg: any, sc: Scene, hurried: boolean): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const body = this.game.body;
    const over = hurried ? 0 : arg?.over ?? 0;
    switch (verb) {
      case "caption":
        this.advance = false;
        return this.screen.caption(arg);
      case "say":
        this.advance = false;
        return this.screen.say(arg.who, arg.line);
      case "wait":
        this.advance = false;
        return this.sleep(arg, () => this.advance);
      case "effect": {
        if (arg.faint) {
          body.hold("none");
          if (hurried) { body.sight.set({ dark: 1 }); return; }
          await body.faint(arg.over ?? 2);
          return;
        }
        if (arg.flash != null) {
          body.sight.set({ flash: arg.flash });
          body.sight.set({ flash: 0 }, over || 1);
          return;
        }
        const { over: _o, drops: _d, ...amounts } = arg;
        body.sight.set(amounts, over);
        return;
      }
      case "camera": {
        if (arg.recoil) {
          if (!hurried) await body.glance(0.35, 0.6);
          return;
        }
        if (!POSES.has(arg.pose)) return;
        const at = arg.at ? this.world(arg.at) : undefined;
        const look = arg.look ? this.world(arg.look) : undefined;
        await body.pose({ pose: arg.pose, at: at ? [at[0], at[2]] : undefined, look, seconds: over });
        this.holdFor(arg.pose);
        return;
      }
      case "look":
        if (!hurried && arg.at === "arm") await Promise.all([body.glance(-0.75, 2.4), this.hands.lookAtArm(2.4)]);
        if (!hurried && arg.at === "down") await body.glance(-0.7, 1.4); // a bow of the head
        return;
      case "animate":
        if (!hurried && String(arg.player).startsWith("drink")) {
          // whatever there is to drink from in the scene: the glass, the tumbler
          const id = ["glass", "tumbler"].find((k) => this.props?.handle(k));
          const cup = id ? this.props!.handle(id) : null;
          const spill = String(arg.player) === "drink-spill" && id ? () => { this.props!.set(id, "spilled"); body.fx("splash"); } : null;
          await this.hands.drink(cup, cup?.parent ?? null, new Vector3(0, 0.05, 0), spill, () => body.fx("gulp"));
          if (!spill) this.hands.putDown();
        }
        return;
      case "body":
        body.injured(!!arg.injured);
        return;
      case "prop": {
        const handle = this.props?.handle(arg.id);
        if (handle && this.hands.holding() === handle) {
          // he lets go of it: "he let the glass roll down the blanket" (¶95)
          if (!hurried) await this.sleep(0.3);
          this.hands.release();
        }
        if (arg.id === "shutters" && arg.state === "open" && !hurried) {
          const p = this.props?.point("shutters");
          if (p) return this.hands.pull(new Vector3(...this.world(p as Vec3)), () => this.props?.set(arg.id, arg.state));
        }
        this.props?.set(arg.id, arg.state);
        return;
      }
      case "sound":
        body.fx(arg);
        return;
      case "panel":
        this.screen.panel(arg.id ?? null);
        return;
      case "reflection":
        if (!hurried) await this.screen.reflection(arg.panel);
        return;
      case "progress":
        reachPage(`b${arg.book}`, arg.page);
        return;
      case "chapter":
        if (!hurried) await this.screen.card(arg.title, arg.subtitle);
        return;
      case "panels":
        if (!hurried) await this.screen.panels(arg.pages);
        return;
      case "actor":
        return; // the cast arrives in S4; until then their lines play as subtitles
      default:
        return;
    }
  }

  /** Show what to do, and wait until Dvij has done it. */
  async await(act: Act): Promise<void> {
    const body = this.game.body;
    this.pressed = false;
    this.cancelled = false;
    const started = performance.now();
    let hinted = false;
    const target = (): [number, number, number] | null => {
      if (typeof act.target === "string") {
        const p = this.props?.point(act.target);
        return p ? this.world(p as Vec3) : null;
      }
      return act.target ? this.world(act.target as Vec2 | Vec3) : null;
    };
    let acting = false, acted = false;
    this.screen.objective(this.auto ? null : act.objective);
    await new Promise<void>((done) => {
      const tick = () => {
        const me = this.game.player();
        const t = target();
        let ok = false;
        let ready = false;
        if (this.auto || acting) {
          // watching: the story does it (and once begun, finishes it, even if you take over)
          if (!acting) { acting = true; this.acted(act, t).then(() => { acted = true; }); }
          ok = acted;
        } else if (act.kind === "press") {
          ok = this.pressed;
        } else if (act.kind === "reach" && t) {
          ok = Math.hypot(me.x - t[0], me.z - t[2]) < (act.radius ?? 1.5);
        } else if ((act.kind === "look-press" || act.kind === "use") && t) {
          ready = Math.hypot(me.x - t[0], me.z - t[2]) < 3.0 && body.lookingAt(t, 22);
          ok = ready && this.pressed;
        }
        if (!acting) this.screen.objective(act.objective, act.kind === "press" || ready);
        if (!ok && this.pressed) this.pressed = false; // a press that did nothing doesn't count later
        if (!hinted && !acting && !this.screen.paused() && performance.now() - started > 25000) {
          hinted = true;
          this.screen.hint(act.kind === "reach" ? "Look for the way: the objective is up at the top." : "Look straight at it and press E.");
        }
        if (ok && !this.cancelled && t && (act.kind === "use" || act.kind === "look-press")
            && !(typeof act.target === "string" && ["glass", "tumbler", "shutters"].includes(act.target))) {
          void this.hands.touch(new Vector3(...t)); // a hand goes out to what he takes or touches (the drink and the shutters have their own)
        }
        if (ok || this.cancelled) {
          this.pressed = false;
          this.screen.objective(null);
          this.screen.hint(null);
          done();
        } else setTimeout(tick, 80);
      };
      tick();
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.advance = true; // and stop any wait
  }

  finished(sc: Scene, next: string | null): void {
    if (next) writeSaved({ scene: next });
    this.screen.ended(sc, next);
  }

  save(scene: string, beat: string): void {
    writeSaved({ scene, beat });
  }

  dispose(): void {
    this.unstep?.();
    this.props?.dispose();
  }
}
