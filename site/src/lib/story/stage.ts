// Story mode's stage (design §10.4): what the director's actions do in the
// game and on the screen. The game moves Dvij's body and eyes; the screen
// (Walk.tsx) shows captions, subtitles, objectives, comic panels and the
// reflection; the props are the scene's own things.
import type { Game } from "../walk/game";
import { reachPage } from "../progress";
import type { Act, Scene, Stage, Vec2, Vec3 } from "./director";
import { Props } from "./props";

/** What the screen offers the story. */
export type StoryScreen = {
  caption: (text: string) => Promise<void>;
  say: (who: string, line: string) => Promise<void>;
  objective: (text: string | null, ready?: boolean) => void;
  hint: (text: string | null) => void;
  card: (title: string, subtitle?: string) => Promise<void>;
  panels: (pages: string[]) => Promise<void>;
  reflection: (panel: string) => Promise<void>;
  ended: (scene: Scene, next: string | null) => void;
  /** Is the game paused (the story's clock stops with it)? */
  paused: () => boolean;
};

import { writeSaved } from "./saved";

/** Waits `seconds` of play: paused time doesn't count. Resolves early if `early()` turns true. */
export function sleep(seconds: number, paused: () => boolean, early: () => boolean = () => false): Promise<void> {
  return new Promise((done) => {
    let left = seconds * 1000;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (!paused()) left -= now - last;
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
  private pressed = false;
  private advance = false;
  private cancelled = false;

  constructor(private game: Game, private screen: StoryScreen) {}

  /** E, Space or a click: does the thing asked, or moves the words on. */
  press(): void {
    this.pressed = true;
    this.advance = true;
  }

  private world(p: Vec2 | Vec3): [number, number, number] {
    return p.length === 2 ? this.game.body.fromLodge(p[0], 1.2, p[1]) : this.game.body.fromLodge(p[0], p[1], p[2]);
  }

  private holdFor(pose: string) {
    this.game.body.hold(pose === "stand" ? "free" : pose === "floor" ? "none" : "look");
  }

  async setUp(sc: Scene): Promise<void> {
    this.props?.dispose();
    this.props = new Props((sc.props ?? []) as never);
    this.game.body.lodgeRoot()?.add(this.props.group);
    this.game.body.sight.set({ blur: 0, double: 0, dark: 0, flash: 0, glare: 0 });
    this.game.body.injured(false);
    const st = sc.start;
    if (st.pose === "interlude") {
      this.game.body.hold("none");
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
        return sleep(arg, this.screen.paused, () => this.advance);
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
        if (!hurried && arg.at === "arm") await body.glance(-1.0, 2.2);
        return;
      case "animate":
        if (!hurried && String(arg.player).startsWith("drink")) {
          body.fx("gulp");
          await body.glance(-0.5, 1.4);
        }
        return;
      case "body":
        body.injured(!!arg.injured);
        return;
      case "prop":
        this.props?.set(arg.id, arg.state);
        return;
      case "sound":
        body.fx(arg);
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
    this.screen.objective(act.objective);
    await new Promise<void>((done) => {
      const tick = () => {
        const me = this.game.player();
        const t = target();
        let ok = false;
        let ready = false;
        if (act.kind === "press") {
          ok = this.pressed;
        } else if (act.kind === "reach" && t) {
          ok = Math.hypot(me.x - t[0], me.z - t[2]) < (act.radius ?? 1.5);
        } else if ((act.kind === "look-press" || act.kind === "use") && t) {
          ready = Math.hypot(me.x - t[0], me.z - t[2]) < 3.0 && body.lookingAt(t, 22);
          ok = ready && this.pressed;
        }
        this.screen.objective(act.objective, act.kind === "press" || ready);
        if (!ok && this.pressed) this.pressed = false; // a press that did nothing doesn't count later
        if (!hinted && !this.screen.paused() && performance.now() - started > 25000) {
          hinted = true;
          this.screen.hint(act.kind === "reach" ? "Look for the way: the objective is up at the top." : "Look straight at it and press E.");
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
    this.props?.dispose();
  }
}
