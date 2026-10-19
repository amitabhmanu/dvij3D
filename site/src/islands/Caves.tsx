/** @jsxImportSource preact */
// The Bhoodara caves (design §7.4). Dvij's method, from the book: decode pi
// from the shloka with the katapayadi code, then in each chamber "count the
// number of exits following the sequence of the value of pi, starting with the
// one on my left and going clockwise, and skipping the entrance". Coming back,
// reverse the digits and count anticlockwise from the right.
import { useEffect, useMemo, useState } from "preact/hooks";

type Phase = "decode" | "in" | "painting" | "out" | "done";
type Mode = "hard" | "guided";

// gopī bhāgya madhuvrāta: each syllable's (last) consonant gives one digit.
const SYLLABLES = [
  { s: "go", c: "ga", d: 3 }, { s: "pī", c: "pa", d: 1 }, { s: "bhā", c: "bha", d: 4 }, { s: "gya", c: "ya", d: 1 },
  { s: "ma", c: "ma", d: 5 }, { s: "dhu", c: "dha", d: 9 }, { s: "vrā", c: "ra", d: 2 }, { s: "ta", c: "ta", d: 6 },
];
const DIGITS = SYLLABLES.map((x) => x.d);
const KATAPAYADI = [
  ["ka", "kha", "ga", "gha", "ṅa", "ca", "cha", "ja", "jha", "ña"],
  ["ṭa", "ṭha", "ḍa", "ḍha", "ṇa", "ta", "tha", "da", "dha", "na"],
  ["pa", "pha", "ba", "bha", "ma"],
  ["ya", "ra", "la", "va", "śa", "ṣa", "sa", "ha"],
];
const KEY = "twice-born:caves:v1";

/** Exits per chamber: at least digit+1 so the answer exists, plus some decoys. */
function chamberExits(i: number, digit: number): number {
  const extra = [2, 3, 1, 3, 2, 1, 3, 2][i % 8];
  return Math.min(9, Math.max(digit + extra, 4));
}

export default function Caves() {
  const [phase, setPhase] = useState<Phase>("decode");
  const [mode, setMode] = useState<Mode>("hard");
  const [decoded, setDecoded] = useState<(number | null)[]>(SYLLABLES.map(() => null));
  const [chamber, setChamber] = useState(0);
  const [wrong, setWrong] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (s.phase) { setPhase(s.phase); setChamber(s.chamber ?? 0); setMode(s.mode ?? "hard"); if (s.decoded) setDecoded(s.decoded); }
    } catch { /* storage unavailable */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify({ phase, chamber, mode, decoded })); } catch { /* ignore */ }
  }, [phase, chamber, mode, decoded, hydrated]);

  const route = phase === "out" ? [...DIGITS].reverse() : DIGITS;
  const digit = route[chamber];
  const exits = chamberExits(phase === "out" ? DIGITS.length - 1 - chamber : chamber, digit);
  const clockwise = phase !== "out";

  const pickExit = (k: number) => {
    if (k === digit) {
      setWrong(null);
      if (chamber + 1 < route.length) setChamber(chamber + 1);
      else { setChamber(0); setPhase(phase === "in" ? "painting" : "done"); }
    } else {
      setWrong(k);
      setMistakes(mistakes + 1);
    }
  };
  const restart = () => { setPhase("decode"); setChamber(0); setDecoded(SYLLABLES.map(() => null)); setMistakes(0); setWrong(null); };

  return (
    <div class="caves-game" data-hydrated={hydrated ? "true" : undefined}>
      <div class="toolbar">
        <div class="modes" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "hard"} onClick={() => setMode("hard")}>Count for myself</button>
          <button type="button" aria-pressed={mode === "guided"} onClick={() => setMode("guided")}>Show the numbers</button>
        </div>
        <button type="button" class="linklike" onClick={restart}>Start over</button>
      </div>

      {phase === "decode" && (
        <Decode mode={mode} decoded={decoded} setDecoded={setDecoded} onDone={() => { setPhase("in"); setChamber(0); }} />
      )}

      {(phase === "in" || phase === "out") && (
        <section class="chamber-step">
          <p class="eyebrow">{phase === "in" ? "Going in" : "Finding the way back"} · chamber {chamber + 1} of {route.length}</p>
          <p class="rule">
            {phase === "in"
              ? <>Count the exits <strong>clockwise, starting on your left</strong>, skipping the passage you came in by. Take exit number <strong>{mode === "guided" ? digit : "…the next digit of pi"}</strong>.</>
              : <>Now reverse the process: the digits in reverse order, counting <strong>anticlockwise, starting on your right</strong>. Take exit number <strong>{mode === "guided" ? digit : "…the next digit, backwards"}</strong>.</>}
          </p>
          <p class="digits" aria-label="Digits used so far">
            {route.map((d, i) => <span class={i < chamber ? "done" : i === chamber ? "now" : ""}>{i < chamber || mode === "guided" ? d : "·"}</span>)}
          </p>
          <Chamber exits={exits} clockwise={clockwise} showNumbers={mode === "guided"} wrong={wrong} onPick={pickExit} />
          {wrong != null && (
            <p class="lost" role="alert">
              That passage winds back on itself: a dead end. {mode === "hard" && mistakes >= 2
                ? <>Remember: exit {digit} here, counted {clockwise ? "clockwise from your left" : "anticlockwise from your right"}.</>
                : "Back to the chamber. Count again."}
            </p>
          )}
        </section>
      )}

      {phase === "painting" && (
        <section class="painting">
          <h2>The painted chamber</h2>
          <p>
            Deep in the belly of the earth, the walls come alive in red and green: hunters with bows, running deer, dancers.
            These are the mesolithic paintings the Professor spoke of, made by the valley's first people, who "hunted in groups."
          </p>
          <p>Now the hard part. Nobody is known to have made it back out of the Bhoodara caves.</p>
          <p><button type="button" class="btn" onClick={() => { setPhase("out"); setChamber(0); }}>Find the way back</button></p>
        </section>
      )}

      {phase === "done" && (
        <section class="painting">
          <h2>Out into the daylight</h2>
          <p>"Why, it's almost a miracle." Not a miracle, just a verse learnt from the avadhana performers and eight digits of pi.
            {mistakes === 0 ? " Not a single wrong turn." : ` ${mistakes} wrong turn${mistakes === 1 ? "" : "s"} on the way.`}</p>
          <p class="actions">
            <a class="btn" href="/codex/katapayadi/">How the katapayadi code works</a>
            <button type="button" class="btn secondary" onClick={restart}>Play again</button>
          </p>
        </section>
      )}
    </div>
  );
}

function Decode({ mode, decoded, setDecoded, onDone }: {
  mode: Mode; decoded: (number | null)[]; setDecoded: (d: (number | null)[]) => void; onDone: () => void;
}) {
  const [active, setActive] = useState(0);
  const allRight = decoded.every((d, i) => d === SYLLABLES[i].d);
  const set = (i: number, d: number) => {
    const next = [...decoded];
    next[i] = d;
    setDecoded(next);
    if (d === SYLLABLES[i].d && i + 1 < SYLLABLES.length) setActive(i + 1);
  };
  return (
    <section class="decode">
      <h2>First, the key</h2>
      <p>Dvij memorised a shloka: <em>gopī bhāgya madhuvrāta…</em>. Read with the katapayadi code, each syllable's consonant is a digit.
        Consonants run in rows (ka, kha, ga… / ṭa, ṭha… / pa, pha… / ya, ra…), and their position in the row is the number.
        For joined consonants, like <em>gya</em> and <em>vrā</em>, use the last one.</p>
      <table class="katapayadi" aria-label="The katapayadi code">
        <thead><tr><th scope="col">Digit</th>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => <th scope="col">{d}</th>)}</tr></thead>
        <tbody>{KATAPAYADI.map((row) => (
          <tr><th scope="row">{row[0]}-row</th>{Array.from({ length: 10 }, (_, i) => <td>{row[i] ?? ""}</td>)}</tr>
        ))}</tbody>
      </table>
      <div class="syllables">
        {SYLLABLES.map((x, i) => {
          const d = decoded[i];
          const state = d == null ? "" : d === x.d ? "right" : "wrong";
          return (
            <button type="button" class={`syl ${state}${active === i ? " active" : ""}`} onClick={() => setActive(i)} aria-label={`Syllable ${x.s}${d != null ? `, your digit ${d}` : ""}`}>
              <span class="s">{x.s}</span>
              <span class="d">{d ?? (mode === "guided" ? x.d : "?")}</span>
            </button>
          );
        })}
      </div>
      {!allRight && (
        <div class="keypad" role="group" aria-label={`Digit for ${SYLLABLES[active].s}`}>
          <span>Digit for <strong>{SYLLABLES[active].s}</strong>:</span>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => <button type="button" onClick={() => set(active, d)}>{d}</button>)}
          {decoded[active] != null && decoded[active] !== SYLLABLES[active].d && (
            <p class="hint">Not quite. The consonant is <strong>{SYLLABLES[active].c}</strong>: find its row, then count along.</p>
          )}
        </div>
      )}
      {mode === "guided" && !allRight && (
        <p><button type="button" class="linklike" onClick={() => setDecoded(SYLLABLES.map((x) => x.d))}>Fill in all the digits</button></p>
      )}
      {allRight && (
        <div class="feedback right">
          <p><strong>3 · 1 4 1 5 9 2 6.</strong> "31415…the value of pi." Now, into the caves.</p>
          <p><button type="button" class="btn" onClick={onDone}>Enter the Bhoodara caves</button></p>
        </div>
      )}
    </section>
  );
}

function Chamber({ exits, clockwise, showNumbers, wrong, onPick }: {
  exits: number; clockwise: boolean; showNumbers: boolean; wrong: number | null; onPick: (k: number) => void;
}) {
  // SVG with y pointing down: increasing angle runs clockwise on screen.
  // The entrance is at the bottom (90°). Exit k sits k steps clockwise from it
  // (or anticlockwise on the way back), so exit 1 is on the explorer's left
  // going in and on their right coming out.
  const R = 120, C = 160;
  const spots = useMemo(() => Array.from({ length: exits }, (_, i) => {
    const k = i + 1;
    const deg = 90 + (clockwise ? 1 : -1) * k * (360 / (exits + 1));
    const a = (deg * Math.PI) / 180;
    return { k, x: C + R * Math.cos(a), y: C + R * Math.sin(a), tx: C + (R + 30) * Math.cos(a), ty: C + (R + 30) * Math.sin(a) };
  }), [exits, clockwise]);
  return (
    <svg class="chamber" viewBox="0 0 320 330" role="group" aria-label={`A cave chamber with ${exits} exits`}>
      <circle cx={C} cy={C} r={R} class="wall" />
      <path d={`M ${C} ${C + R} L ${C} ${C + R + 30}`} class="entrance" />
      <text x={C} y={C + R + 44} class="label" text-anchor="middle">you came in here</text>
      <text x={C} y={C + 4} class="label" text-anchor="middle">{clockwise ? "↻ clockwise from your left" : "↺ anticlockwise from your right"}</text>
      {spots.map((s) => (
        <g class={`exit${wrong === s.k ? " wrong" : ""}`} role="button" tabIndex={0} aria-label={`Exit${showNumbers ? ` ${s.k}` : ""}`}
          onClick={() => onPick(s.k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(s.k); } }}>
          <line x1={s.x} y1={s.y} x2={s.tx} y2={s.ty} class="tunnel" />
          <circle cx={s.tx} cy={s.ty} r={15} class="mouth" />
          {showNumbers && <text x={s.tx} y={s.ty + 5} text-anchor="middle" class="num">{s.k}</text>}
        </g>
      ))}
    </svg>
  );
}
