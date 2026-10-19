/** @jsxImportSource preact */
// The Parchment of Puzzles (design §7). Five puzzles, each a chain of
// multiple-choice stages that follows the characters' own reasoning.
//
// - A puzzle opens once the reader reaches the page where the characters
//   start it, so readers can try to beat them to the answer.
// - Hard mode: answer each stage; hints escalate after wrong answers.
// - Guided mode: step through how Dvij and Bhavi solved it. This walkthrough
//   is spoiler-gated to the page where they solve it.
import { useEffect, useMemo, useState } from "preact/hooks";
import { getProgress, hasReached } from "../lib/progress";
import { BOOK_SLUGS } from "../lib/spoilers";

type PageRef = { book: number; page: number; pageId: string };
type Stage = { prompt: string; choices: string[]; answer: string; hint: string; explain: string; codex?: string; guideHint?: string };
export type Puzzle = {
  id: string; title: string; row: number; rect: [number, number, number, number]; crop: string;
  outcome: string; guide?: string; stages: Stage[]; available: PageRef; solved: PageRef;
};
type Props = { puzzles: Puzzle[]; parchmentSrc: string; cropBase: string };
type Mode = "hard" | "guided";
type PState = { stage: number; solved: boolean; wrong: number };
type Saved = { mode: Mode; puzzles: Record<string, PState> };

const KEY = "twice-born:parchment:v1";
const load = (): Saved => {
  try { return { mode: "hard", puzzles: {}, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { mode: "hard", puzzles: {} }; }
};
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };
const reached = (ref: PageRef) => hasReached(getProgress(), ref.book, ref.page, BOOK_SLUGS);
const readUrl = (ref: PageRef) => `/read/b${ref.book}/${ref.page}`;
const fresh = (): PState => ({ stage: 0, solved: false, wrong: 0 });

export default function Parchment({ puzzles, parchmentSrc, cropBase }: Props) {
  const [state, setState] = useState<Saved>({ mode: "hard", puzzles: {} });
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({}); // spoiler overrides this visit
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(load());
    const fromHash = location.hash.slice(1);
    if (puzzles.some((p) => p.id === fromHash)) setOpen(fromHash);
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) save(state); }, [state, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    history.replaceState(null, "", open ? `#${open}` : location.pathname);
    setPicked(null);
  }, [open, hydrated]);

  const ps = (id: string) => state.puzzles[id] ?? fresh();
  const update = (id: string, patch: Partial<PState>) =>
    setState((s) => ({ ...s, puzzles: { ...s.puzzles, [id]: { ...(s.puzzles[id] ?? fresh()), ...patch } } }));
  const available = (p: Puzzle) => !hydrated || reached(p.available) || revealed[p.id];
  const walkthroughOk = (p: Puzzle) => reached(p.solved) || revealed[`${p.id}:guided`];
  const solvedCount = puzzles.filter((p) => ps(p.id).solved).length;
  const puzzle = puzzles.find((p) => p.id === open);

  return (
    <div class="parchment-game" data-hydrated={hydrated ? "true" : undefined}>
      <div class="toolbar">
        <div class="modes" role="group" aria-label="Mode">
          <button type="button" aria-pressed={state.mode === "hard"} onClick={() => setState({ ...state, mode: "hard" })}>Solve it myself</button>
          <button type="button" aria-pressed={state.mode === "guided"} onClick={() => setState({ ...state, mode: "guided" })}>Show me how they did it</button>
        </div>
        <p class="score" aria-live="polite">{solvedCount} of {puzzles.length} solved</p>
      </div>

      <div class="board">
        <div class="sheet">
          <img src={parchmentSrc} alt="The Professor's parchment: five rows of drawings" width={1448} height={1086} />
          {puzzles.map((p) => {
            const st = ps(p.id);
            const [x0, y0, x1, y1] = p.rect;
            const locked = !available(p);
            return (
              <button
                type="button"
                class={`region${st.solved ? " solved" : ""}${locked ? " locked" : ""}${open === p.id ? " active" : ""}`}
                style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
                aria-label={`Puzzle ${p.row}: ${p.title}${st.solved ? " (solved)" : locked ? " (not yet reached)" : ""}`}
                onClick={() => setOpen(p.id)}
              >
                <span class="tag">{p.row}{st.solved ? " ✓" : ""}</span>
              </button>
            );
          })}
        </div>

        <section class="solve" aria-live="polite">
          {!puzzle ? (
            <div class="empty">
              <h2>Choose a puzzle</h2>
              <p>Five rows, five puzzles. "The solutions will eventually add up." Tap a row on the parchment to begin.</p>
              <ol class="list">
                {puzzles.map((p) => (
                  <li><button type="button" class="linklike" onClick={() => setOpen(p.id)}>{p.row}. {p.title}</button>
                    {ps(p.id).solved ? " ✓" : !available(p) ? <span class="muted"> (from Book {p.available.book}, page {p.available.page})</span> : null}</li>
                ))}
              </ol>
            </div>
          ) : !available(puzzle) ? (
            <div class="veiled">
              <h2>Puzzle {puzzle.row}: {puzzle.title}</h2>
              <p>The characters reach this puzzle in <strong>Book {puzzle.available.book}, page {puzzle.available.page}</strong>, further than you've read.</p>
              <p><a class="btn" href={readUrl(puzzle.available)}>Read up to it</a>{" "}
                <button type="button" class="btn secondary" onClick={() => setRevealed({ ...revealed, [puzzle.id]: true })}>Try it anyway</button></p>
            </div>
          ) : (
            <PuzzlePanel
              key={puzzle.id}
              p={puzzle}
              st={ps(puzzle.id)}
              mode={state.mode}
              cropSrc={`${cropBase}/${puzzle.crop}.webp`}
              walkthroughOk={walkthroughOk(puzzle)}
              onRevealWalkthrough={() => setRevealed({ ...revealed, [`${puzzle.id}:guided`]: true })}
              picked={picked}
              setPicked={setPicked}
              update={(patch) => update(puzzle.id, patch)}
              onNext={() => {
                const next = puzzles.find((q) => q.row === puzzle.row + 1);
                setOpen(next ? next.id : null);
              }}
            />
          )}
        </section>
      </div>

      {solvedCount === puzzles.length && (
        <section class="adds-up">
          <h2>The solutions add up</h2>
          <ol>{puzzles.map((p) => <li><strong>{p.title}:</strong> {p.outcome}</li>)}</ol>
          <p>Mount Dronagiri. Ponga. Kritya Rishi's altar. North. The trishul's afternoon shadow. Five answers, one path up the mountain.</p>
        </section>
      )}
    </div>
  );
}

type PanelProps = {
  p: Puzzle; st: PState; mode: Mode; cropSrc: string; walkthroughOk: boolean; onRevealWalkthrough: () => void;
  picked: string | null; setPicked: (c: string | null) => void; update: (patch: Partial<PState>) => void; onNext: () => void;
};

function PuzzlePanel({ p, st, mode, cropSrc, walkthroughOk, onRevealWalkthrough, picked, setPicked, update, onNext }: PanelProps) {
  const stage = p.stages[Math.min(st.stage, p.stages.length - 1)];
  const correct = picked === stage.answer;
  const shuffled = useMemo(() => shuffle(stage.choices, `${p.id}-${st.stage}`), [p.id, st.stage]);

  const advance = () => {
    setPicked(null);
    if (st.stage + 1 >= p.stages.length) update({ solved: true, stage: p.stages.length, wrong: 0 });
    else update({ stage: st.stage + 1, wrong: 0 });
  };
  const choose = (c: string) => {
    if (picked === stage.answer) return;
    setPicked(c);
    if (c !== stage.answer) update({ wrong: st.wrong + 1 });
  };

  const header = (
    <header>
      <p class="eyebrow">Puzzle {p.row} of 5</p>
      <h2>{p.title}</h2>
      <img class="crop" src={cropSrc} alt={`The drawings in row ${p.row} of the parchment`} />
    </header>
  );

  if (st.solved) {
    return (
      <div class="panel">
        {header}
        <div class="result">
          <p class="eyebrow">Solved</p>
          <p class="outcome">{p.outcome}</p>
          <p><a href={`/read/b${p.solved.book}/${p.solved.page}`}>See the moment in the comic →</a></p>
          <p class="actions">
            {p.row < 5 && <button type="button" class="btn" onClick={onNext}>Next puzzle</button>}
            <button type="button" class="btn secondary" onClick={() => update({ solved: false, stage: 0, wrong: 0 })}>Solve it again</button>
          </p>
        </div>
      </div>
    );
  }

  if (mode === "guided" && !walkthroughOk) {
    return (
      <div class="panel">
        {header}
        <div class="veiled">
          <p>The walkthrough shows how Dvij and Bhavi crack this, which happens in <strong>Book {p.solved.book}, page {p.solved.page}</strong>.
            Try solving it yourself, or reveal it anyway.</p>
          <p><button type="button" class="btn secondary" onClick={onRevealWalkthrough}>Show the walkthrough</button></p>
        </div>
      </div>
    );
  }

  const progress = <p class="progress">Step {st.stage + 1} of {p.stages.length}</p>;

  if (mode === "guided") {
    return (
      <div class="panel">
        {header}
        {progress}
        <p class="prompt">{stage.prompt}</p>
        <p class="answer">→ <strong>{stage.answer}</strong></p>
        <p class="explain">{stage.explain}</p>
        {stage.codex && <p class="codex-link"><a href={`/codex/${stage.codex}/`}>More in the Codex</a></p>}
        <p class="actions"><button type="button" class="btn" onClick={advance}>{st.stage + 1 === p.stages.length ? "Finish" : "Next step"}</button></p>
      </div>
    );
  }

  return (
    <div class="panel">
      {header}
      {progress}
      <p class="prompt">{stage.prompt}</p>
      <div class="choices" role="group" aria-label="Choose an answer">
        {shuffled.map((c) => (
          <button
            type="button"
            class={picked === c ? (c === stage.answer ? "right" : "wrong") : ""}
            aria-pressed={picked === c}
            disabled={correct}
            onClick={() => choose(c)}
          >{c}</button>
        ))}
      </div>
      {correct ? (
        <div class="feedback right">
          <p><strong>Yes.</strong> {stage.explain}</p>
          <p class="actions"><button type="button" class="btn" onClick={advance}>{st.stage + 1 === p.stages.length ? "Finish" : "Next step"}</button></p>
        </div>
      ) : st.wrong > 0 ? (
        <div class="feedback hint">
          {st.wrong >= 1 && stage.guideHint && p.guide && <p><em>{capitalise(p.guide)} says:</em> "{stage.guideHint}"</p>}
          {st.wrong >= 1 && <p><strong>Hint:</strong> {stage.hint}</p>}
          {st.wrong >= 2 && stage.codex && <p>Stuck? The <a href={`/codex/${stage.codex}/`} target="_blank" rel="noopener">Codex entry</a> has what you need.</p>}
          {st.wrong >= 3 && <p><button type="button" class="linklike" onClick={() => { setPicked(stage.answer); }}>Show me the answer</button></p>}
        </div>
      ) : null}
    </div>
  );
}

function capitalise(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Deterministic shuffle so choices don't jump around between renders. */
function shuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
