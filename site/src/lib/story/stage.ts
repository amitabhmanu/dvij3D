// Story mode's stage (design §10.4): what the director's actions do in the
// game and on the screen. The game moves Dvij's body and eyes; the screen
// (Walk.tsx) shows captions, subtitles, objectives, comic panels and the
// reflection; the props are the scene's own things.
import type { Game } from "../walk/game";
import type { Pane } from "../walk/pane";
import { reachPage } from "../progress";
import type { Act, Scene, Stage, Vec2, Vec3 } from "./director";
import { Props } from "./props";
import { Hands } from "./hands";
import { Cast, type CastSpec, type PeopleInfo } from "./cast";
import { walkAsset } from "../walk/walk-data";
import people from "../../content/generated/people.json";
import { Vector3 } from "three";

/** What the screen offers the story. */
export type StoryScreen = {
  caption: (text: string) => Promise<void>;
  /** A line spoken: `voice` hears of its recording (null: none) and how far through it is, for the speaker's mouth. */
  say: (who: string, line: string, voice?: (file: string | null, time: () => number) => void) => Promise<void>;
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

/** Which built Dvij a chapter shows: the heavy bandage until Chapter 7, then the smaller band (b1-ch07 "healed"). */
export function dvijFor(scene: string): string {
  const ch = Number(/ch(\d+)/.exec(scene)?.[1] ?? 0);
  return ch >= 7 ? "dvij-healed" : "dvij";
}

/** Where one steps back to from `centre`, along the line from it through where one stands, `dist` away (world x, z). */
export function recoilTo(me: [number, number], centre: [number, number], dist: number): [number, number] {
  let dx = me[0] - centre[0], dz = me[1] - centre[1];
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) { dx = 0; dz = -1; } else { dx /= d; dz /= d; }
  return [centre[0] + dx * dist, centre[1] + dz * dist];
}

const POSES = new Set(["lie", "sit", "sit-low", "stand", "floor"]);

export class StoryStage implements Stage {
  private props: Props | null = null;
  private cast: Cast | null = null;
  /** The cast's people loading: the scene starts without waiting for them (Dvij is placed at once); a beat that
   * needs them waits for this. */
  private castReady: Promise<void> = Promise.resolve();
  private unstep: (() => void) | null = null;
  /** A dirty pane with his face coming up in it as he nears it (Ch1's study window), and what eases it. */
  private pane: { pane: Pane; unstep: () => void } | null = null;
  private frame = "lodge";
  private pressed = false;
  private advance = false;
  private cancelled = false;
  private pose = "stand";
  /** Watch mode: the story does what each beat asks by itself, and Dvij can't be steered. */
  private auto = false;
  /** Who spoke to him last (in this scene): whom he answers. */
  private heard = "";
  /** A line is being spoken (his eyes may follow the speaker till it ends). */
  private saying = false;

  private hands: Hands;

  constructor(private game: Game, private screen: StoryScreen) {
    this.hands = new Hands(() => game.body.arms(), (s) => this.sleep(s));
  }

  /** The scene's people, and how Dvij is placed: for someone else's film (pov-stage.ts). */
  get people(): Cast | null { return this.cast; }
  get stance(): string { return this.pose; }

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
    // a thing with a place to stand in front of it (the shutters): there, then square to it, not at it from the side
    const front = typeof act.target === "string" ? this.props?.front(act.target) : null;
    if (front && this.pose === "stand") {
      const f = this.world([front[0], front[1]]);
      await body.walkTo([f[0], f[2]]);
      if (this.cancelled) return;
      await body.turnTo(t, 0.9);
      await this.sleep(0.4, () => this.cancelled);
      return;
    }
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
    this.clearPane();
    this.hands.reset(); // (a seek back from the drink: the glass is made again, not left in his hand)
    this.props?.dispose();
    this.frame = sc.frame ?? "lodge";
    const body = this.game.body;
    body.setting({ sun: sc.setting?.sun, court: sc.setting?.court });
    body.doors(sc.setting?.doors !== "shut"); // (Ch1: shut, and he opens each he goes through)
    body.chapter(sc.scene);
    for (const [room, speed] of Object.entries(sc.setting?.fans ?? {})) body.fan(room, speed);
    const origin = this.world([0, 0, 0]); // (the props stand in the scene's frame: translated only)
    this.unstep?.();
    this.props = new Props((sc.props ?? []) as never, body.lodgeRoot(), {
      surface: (x, y, z) => body.surface(x + origin[0], y + origin[1], z + origin[2]) - origin[1],
      sound: (name) => body.fx(name),
    });
    const props = this.props;
    const root = this.frame === "lodge" ? this.game.body.lodgeRoot() : this.game.body.siteRoot(this.frame);
    root?.add(this.props.group);
    // the people: in the frame's root as the props are, standing on whatever is under them
    this.cast?.dispose();
    this.cast = null;
    this.heard = "";
    if (root) { // (every scene has one: even with no cast, Dvij's own body may show in a window)
      const cast = new Cast(people as PeopleInfo, {
        root,
        ground: (x, z, y = 3) => body.surface(x + origin[0], y + origin[1], z + origin[2]) - origin[1],
        eyes: () => { const p = this.game.player(); return new Vector3(p.x, p.y, p.z); },
        prop: (id) => props.handle(id),
        url: walkAsset,
        seen: (p) => body.lookingAt([p.x, p.y, p.z], 50),
        heading: () => this.game.player().heading,
        stir: () => body.stir(),
        lifelike: !new URLSearchParams(location.search).has("plain"), // (?plain: the cast as before the lifelike pilot, to compare)
      });
      this.cast = cast;
      this.castReady = cast.setUp((sc.cast ?? []) as CastSpec[], sc.start.at).catch((e) => console.warn("the cast:", e));
    }
    const cast = this.cast;
    this.unstep = body.every((dt) => { props.update(dt); cast?.update(dt); });
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
      case "say": {
        this.advance = false;
        await this.castReady;
        const cast = this.cast;
        cast?.speaking(arg.who, null);
        // watching: Dvij turns to whoever speaks, and to whom he answers, if he can see them from where he is
        if (arg.who !== "dvij") this.heard = arg.who;
        const speaker = cast?.get(arg.who === "dvij" ? this.heard : arg.who);
        if (this.auto && !hurried && speaker?.visible && this.pose !== "lie" && this.pose !== "floor") {
          const h = speaker.headAt();
          const me = this.game.player();
          if (Math.hypot(h.x - me.x, h.z - me.z) < 12) {
            // and keeps them in sight as they move (Bhavi round the well, Maharaj walking off), while they're near and to be seen
            void body.turnTo([h.x, h.y - 0.1, h.z], 0.7).then(() => {
              if (!this.saying) return;
              body.follow(() => {
                if (!speaker.visible) return null;
                const at = speaker.headAt(), now = this.game.player();
                return Math.hypot(at.x - now.x, at.z - now.z) < 12 ? [at.x, at.y - 0.1, at.z] : null;
              });
            });
          }
        }
        this.saying = true;
        await this.screen.say(arg.who, arg.line, (file, time) => {
          if (!cast || !cast.get(arg.who)) return;
          if (!file) { cast.get(arg.who)!.speak(() => 0.35 + Math.sin(time() * 17) * 0.3); return; }
          void cast.level(file, time).then((v) => cast.get(arg.who)?.speak(v.open, v.bright, v.shape));
        });
        cast?.get(arg.who)?.speak(null);
        this.saying = false;
        body.follow(null);
        return;
      }
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
          // and he steps back from it, out of the way of whoever walks its edge (the well's parapet: Bhavi walks it)
          if (arg.away) {
            const me = this.game.player(), c = this.world(arg.away);
            const [x, z] = recoilTo([me.x, me.z], [c[0], c[2]], arg.to ?? 2.8);
            if (Math.hypot(me.x - c[0], me.z - c[2]) < (arg.to ?? 2.8)) await body.pose({ pose: "stand", at: [x, z], look: [c[0], c[1] - 0.3, c[2]], seconds: hurried ? 0 : 0.8 });
          }
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
          // as the leaves part, the creak and the sun full in his eyes at once (¶99: "the brilliance of sunlight blinded
          // him momentarily"), then his eyes adjusting till the wall outside comes clear
          if (p) return this.hands.pull(new Vector3(...this.world(p as Vec3)), () => {
            this.props?.set(arg.id, arg.state);
            body.fx("creak");
            body.sight.set({ flash: 1, blur: 0.35 }, 0.2);
            void this.sleep(0.6).then(() => body.sight.set({ flash: 0, blur: 0 }, 2.8));
          });
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
      case "pane": {
        // the window he is going to: dirty, and his face coming up in it as he comes to it (the author, 25 Oct)
        // (made even when hurried: it is the room's state, there when the slider seeks past this beat)
        this.clearPane();
        const at = this.world(arg.at), look = this.world(arg.look);
        const pane = body.pane([at[0], look[1], at[2]], look);
        if (!pane) return;
        await this.castReady;
        await this.cast?.self(dvijFor(sc.scene)); // (his body, that only a reflection sees)
        const unstep = body.every(() => {
          const me = this.game.player();
          const k = Math.max(0, Math.min(1, (4.5 - Math.hypot(me.x - pane.centre.x, me.z - pane.centre.z)) / 3.2));
          pane.strength(k * k * (3 - 2 * k));
        });
        this.pane = { pane, unstep };
        return;
      }
      case "reflection": {
        if (hurried) return;
        // his own face in the glass first (the bearded stranger, ¶101), then the comic's drawing of it
        await this.castReady;
        const me = await this.cast?.self(dvijFor(sc.scene));
        const p = this.pane?.pane;
        if (me && p) {
          // closer and closer to the glass, till it is his own face filling it (the author, 25 Oct): before one half of
          // the window (not its mullion), eye to eye with himself (his body's eyes brought to the camera's)
          this.cast?.selfAtEyes(true);
          const eye = this.game.player().y;
          const side = p.width > 0.9 ? p.width / 4 : 0;
          const on = p.centre.clone().addScaledVector(p.across, side);
          const stand: [number, number] = [on.x + p.normal.x * 0.25, on.z + p.normal.z * 0.25];
          await body.pose({ pose: "stand", at: stand, look: [on.x, eye, on.z], seconds: 3.2 });
          await this.sleep(3.5);
        } else if (me && body.mirror(true)) {
          await this.sleep(4);
          body.mirror(false);
        }
        await this.screen.reflection(arg.panel);
        return;
      }
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
        await this.castReady;
        return this.cast?.beat(arg, hurried);
      default:
        return;
    }
  }

  /** An act passed over at once: he is where it would have left him (walked there; in front of the shutters). */
  skipped(act: Act): void {
    if (this.pose !== "stand" || (act.kind !== "reach" && act.kind !== "use")) return;
    const front = typeof act.target === "string" ? this.props?.front(act.target) : null;
    const at = front ? this.world([front[0], front[1]]) : act.kind === "reach" && act.target ? this.world(act.target as Vec2 | Vec3) : null;
    if (at) void this.game.body.pose({ pose: "stand", at: [at[0], at[2]], seconds: 0 });
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

  private clearPane() {
    this.pane?.unstep();
    this.pane?.pane.dispose();
    this.pane = null;
  }

  dispose(): void {
    this.clearPane();
    this.unstep?.();
    this.cast?.dispose();
    this.props?.dispose();
  }
}
