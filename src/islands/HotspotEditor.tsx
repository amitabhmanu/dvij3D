/** @jsxImportSource preact */
// Dev review tool, "Hotspots" mode: keep or remove the automatic hotspots
// (link_codex.py) and draw manual ones pointing at Codex entries. Every change
// saves src/content/hotspots/manual.json immediately.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Box } from "../lib/manifest";

type Hotspot = { id: string; page: string; rect: Box; targets: string[]; terms?: string[]; label?: string; auto?: boolean };
type Manual = { add: Hotspot[]; remove: string[] };
type CodexItem = { id: string; title: string };

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

let shared: Promise<[Hotspot[], Manual, CodexItem[]]> | null = null;
const loadAll = () => (shared ??= Promise.all([
  fetch("/_dev/corrections/hotspots-auto.json").then((r) => r.json()),
  fetch("/_dev/corrections/hotspots.json").then((r) => r.json()).then((m) => ({ add: [], remove: [], ...m })),
  fetch("/data/codex.json").then((r) => r.json()),
]));

export default function HotspotEditor({ pid, imgSrc }: { pid: string; imgSrc?: string }) {
  const [auto, setAuto] = useState<Hotspot[]>([]);
  const [manual, setManual] = useState<Manual>({ add: [], remove: [] });
  const [codex, setCodex] = useState<CodexItem[]>([]);
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState<Box | null>(null);
  const [msg, setMsg] = useState("");
  const canvas = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);

  useEffect(() => { loadAll().then(([a, m, c]) => { setAuto(a); setManual(m); setCodex(c); }); }, []);

  const save = async (next: Manual) => {
    setManual(next);
    shared = null; // reload fresh next time the editor mounts
    const r = await fetch("/_dev/corrections/hotspots.json", { method: "POST", body: JSON.stringify(next) });
    setMsg(r.ok ? "Saved" : `Save failed (${r.status})`);
  };

  const pos = (e: PointerEvent): [number, number] => {
    const b = canvas.current!.getBoundingClientRect();
    return [clamp((e.clientX - b.left) / b.width), clamp((e.clientY - b.top) / b.height)];
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".hs")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = pos(e);
    setDraft([...start.current, ...start.current] as Box);
  };
  const onMove = (e: PointerEvent) => {
    if (!start.current) return;
    const [x, y] = pos(e);
    const [sx, sy] = start.current;
    setDraft([Math.min(sx, x), Math.min(sy, y), Math.max(sx, x), Math.max(sy, y)]);
  };
  const onUp = () => {
    const d = draft;
    start.current = null;
    setDraft(null);
    if (!d || d[2] - d[0] < 0.015 || d[3] - d[1] < 0.015) return;
    if (!target) { setMsg("Choose a target entry first"); return; }
    const h: Hotspot = { id: `m-${pid}-${Date.now().toString(36)}`, page: pid, rect: d.map(r4) as Box,
      targets: [`codex:${target}`], label: label || codex.find((c) => c.id === target)?.title };
    save({ ...manual, add: [...manual.add, h] });
  };

  const removed = new Set(manual.remove);
  const autoHere = auto.filter((h) => h.page === pid);
  const manualHere = manual.add.filter((h) => h.page === pid);
  const title = (t: string) => codex.find((c) => `codex:${c.id}` === t)?.title ?? t;
  const toggleAuto = (id: string) =>
    save({ ...manual, remove: removed.has(id) ? manual.remove.filter((r) => r !== id) : [...manual.remove, id] });
  const box = (r: Box) => ({ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${(r[2] - r[0]) * 100}%`, height: `${(r[3] - r[1]) * 100}%` });

  return (
    <div class="body">
      <div class="canvas" ref={canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {imgSrc && <img src={imgSrc} alt="" draggable={false} />}
        {autoHere.map((h) => <div class={`hs auto${removed.has(h.id) ? " off" : ""}`} style={box(h.rect)} title={h.terms?.join(", ")} onClick={() => toggleAuto(h.id)} />)}
        {manualHere.map((h) => <div class="hs manual" style={box(h.rect)} title={h.label} />)}
        {draft && <div class="hs draft" style={box(draft)} />}
      </div>
      <aside>
        <p class="hint">Automatic hotspots (orange) come from words in the lettering: click one to switch it off or back on.
          To add one, choose a target, then drag a box on the page (green).</p>
        <label>Target for new hotspot{" "}
          <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
            <option value="">choose Codex entry…</option>
            {codex.map((c) => <option value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label style={{ display: "block", marginTop: "6px" }}>Label (optional){" "}
          <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="e.g. the chakra drawings" />
        </label>
        <span class="msg">{msg}</span>

        <h3>Automatic ({autoHere.length})</h3>
        <ul>{autoHere.map((h) => (
          <li><label><input type="checkbox" checked={!removed.has(h.id)} onChange={() => toggleAuto(h.id)} />{" "}
            “{h.terms?.join(", ")}” → {h.targets.map(title).join(", ")}</label></li>
        ))}</ul>
        <h3>Manual ({manualHere.length})</h3>
        <ul>{manualHere.map((h) => (
          <li>{h.label} → {h.targets.map(title).join(", ")}{" "}
            <button onClick={() => save({ ...manual, add: manual.add.filter((x) => x.id !== h.id) })}>✕</button></li>
        ))}</ul>
      </aside>
    </div>
  );
}
