// Keys, mouse and touch, turned into one Move per step (design §10.2).
// WASD or the arrow keys walk, Shift runs, the mouse looks (with the pointer
// locked, or by dragging when it isn't), and a touch joystick plus drag-to-look
// do the same on phones.
import type { Move } from "./player";

export type Settings = { sensitivity: number; invertY: boolean };

const KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyA: [0, -1], ArrowLeft: [0, -1], KeyD: [0, 1], ArrowRight: [0, 1],
};

export class Input {
  private down = new Set<string>();
  private dx = 0;
  private dy = 0;
  private stick: [number, number] = [0, 0];
  private dragging: { x: number; y: number; id: number } | null = null;
  settings: Settings = { sensitivity: 1, invertY: false };
  private off: (() => void)[] = [];

  constructor(target: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(el: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void) => {
      el.addEventListener(type, fn as EventListener);
      this.off.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on(window, "keydown", (e) => {
      if (e.code in KEYS || e.code.startsWith("Shift")) e.preventDefault();
      this.down.add(e.code);
    });
    on(window, "keyup", (e) => this.down.delete(e.code));
    on(window, "blur", () => this.down.clear());
    on(window, "mousemove", (e) => {
      if (document.pointerLockElement === target) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    // Drag to look: touch, or a mouse when the pointer isn't locked.
    on(target, "pointerdown", (e) => {
      if (document.pointerLockElement === target) return;
      this.dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    on(window, "pointermove", (e) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      this.dx += (e.clientX - this.dragging.x) * 1.6;
      this.dy += (e.clientY - this.dragging.y) * 1.6;
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
    });
    on(window, "pointerup", (e) => { if (this.dragging?.id === e.pointerId) this.dragging = null; });
  }

  /** The joystick: x right, y forward, each -1..1. */
  setStick(x: number, y: number) {
    this.stick = [x, y];
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  sample(): Move {
    let forward = this.stick[1], strafe = this.stick[0];
    for (const code of this.down) {
      const k = KEYS[code];
      if (k) { forward += k[0]; strafe += k[1]; }
    }
    const s = 0.0022 * this.settings.sensitivity;
    const m: Move = {
      forward: Math.max(-1, Math.min(1, forward)),
      strafe: Math.max(-1, Math.min(1, strafe)),
      run: this.down.has("ShiftLeft") || this.down.has("ShiftRight") || Math.hypot(...this.stick) > 0.95,
      turn: this.dx * s,
      look: -this.dy * s * (this.settings.invertY ? -1 : 1),
    };
    this.dx = this.dy = 0;
    return m;
  }

  clear() {
    this.down.clear();
    this.dx = this.dy = 0;
    this.stick = [0, 0];
    this.dragging = null;
  }

  dispose() {
    for (const f of this.off) f();
  }
}
