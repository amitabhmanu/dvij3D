/** @jsxImportSource preact */
// The Memory Hall (design §12). What the Professor explains on B2 p8 and Dvij
// uses on B2 p25: the recitation patterns that carried the Veda orally, the
// reason they work (redundancy, not repetition), and the avadhana ring the art
// draws on the same page.
//
// The patterns are generated from the word list (lib/pathas.ts), so a verse is
// pure data. Nothing here decodes katapayadi: that reads the same verse by
// consonant and lives in Caves.tsx. This reads it by word.
import { useEffect, useMemo, useState } from "preact/hooks";
import { PATHA_LABEL, PATHAS, timesSpoken, utterances, utterancesTouching, type Patha } from "../lib/pathas";
import type { Verse } from "../lib/memory";

type Phase = "intro" | "ladder" | "why" | "ring" | "done";
type Mode = "hard" | "guided";
type Saved = { phase?: Phase; mode?: Mode; verse?: string; learnedAt?: number; checks?: number[] };

const KEY = "twice-born:memory:v1";
const DAY = 24 * 60 * 60 * 1000;
const CHECK_AFTER = [DAY, 7 * DAY]; // one check after a day, one after a week
/** Groups the reader builds by hand before the rest of the pattern is shown.
 *  ghana runs 13 words to a group, so one is plenty; the shorter rungs get two. */
const BUILD_GROUPS: Record<Patha, number> = { pada: 99, krama: 2, jata: 2, ghana: 1 };

const read = (): Saved => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
};

export default function Memory({ verses, ring }: { verses: Verse[]; ring: { items: string[]; distractions: string[] } }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [mode, setMode] = useState<Mode>("hard");
  const [verseId, setVerseId] = useState(verses[0].id);
  const [saved, setSaved] = useState<Saved>({});
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(false);

  const verse = verses.find((v) => v.id === verseId) ?? verses[0];

  useEffect(() => {
    const s = read();
    setSaved(s);
    if (s.phase) setPhase(s.phase);
    if (s.mode) setMode(s.mode);
    if (s.verse && verses.some((v) => v.id === s.verse)) setVerseId(s.verse);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify({ ...saved, phase, mode, verse: verseId })); } catch { /* ignore */ }
  }, [phase, mode, verseId, saved, hydrated]);

  // §12.4: one check a day after learning it, one a week after. No streaks.
  const dueCheck = useMemo(() => {
    if (!saved.learnedAt) return -1;
    const done = saved.checks ?? [];
    const age = Date.now() - saved.learnedAt;
    return CHECK_AFTER.findIndex((t, i) => age >= t && !done.includes(i));
  }, [saved]);

  const finishLadder = () => {
    setSaved((s) => ({ ...s, learnedAt: s.learnedAt ?? Date.now() }));
    setPhase("why");
  };
  const restart = () => { setSaved((s) => ({ ...s, checks: [] })); setPhase("intro"); };

  return (
    <div class="memory-hall" data-hydrated={hydrated ? "true" : undefined}>
      <div class="toolbar">
        <div class="modes" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "hard"} onClick={() => setMode("hard")}>Work it out</button>
          <button type="button" aria-pressed={mode === "guided"} onClick={() => setMode("guided")}>Show me the next word</button>
        </div>
        {phase !== "intro" && <button type="button" class="linklike" onClick={restart}>Start over</button>}
      </div>

      {dueCheck >= 0 && !checking && phase !== "ladder" && (
        <p class="recall-offer" role="note">
          You learnt <em>{verse.subtitle}</em> {Math.round((Date.now() - (saved.learnedAt ?? 0)) / DAY)} days ago.
          Has it stuck? <button type="button" class="linklike" onClick={() => setChecking(true)}>Check, honestly</button>
        </p>
      )}

      {checking && (
        <Recall
          verse={verse}
          onDone={(kept) => {
            setChecking(false);
            setSaved((s) => ({ ...s, checks: [...(s.checks ?? []), dueCheck] }));
            return kept;
          }}
        />
      )}

      {phase === "intro" && (
        <section class="intro-step">
          <h2>What the Professor was pointing at</h2>
          <p>The chart he holds up reads <em>1. Forward sequence · 2. Backward sequence · 3. Skipping syllables.</em> Those
            three lines are a compressed drawing of the <strong>pāṭhas</strong> — the recitation schemes that carried the
            Veda for millennia with nothing written down.</p>
          <p>You will climb them on one verse, four patterns deep. It takes a few minutes, and at the end you will
            see why the method works, which is not the reason most people assume.</p>
          <fieldset class="verse-pick">
            <legend>Verse</legend>
            {verses.map((v) => (
              <label key={v.id} class={v.id === verseId ? "on" : ""}>
                <input type="radio" name="verse" checked={v.id === verseId} onChange={() => setVerseId(v.id)} />
                <span class="t">{v.title}</span>
                <span class="s">{v.subtitle}</span>
              </label>
            ))}
          </fieldset>
          <p class="note muted">{verse.note}</p>
          <p><button type="button" class="btn" onClick={() => setPhase("ladder")}>Begin with the words</button></p>
        </section>
      )}

      {phase === "ladder" && <Ladder verse={verse} mode={mode} onDone={finishLadder} />}
      {phase === "why" && <Why verse={verse} onDone={() => setPhase("ring")} />}
      {phase === "ring" && <Ring ring={ring} mode={mode} onDone={() => setPhase("done")} />}

      {phase === "done" && (
        <section class="done-step">
          <h2>That is the whole technique</h2>
          <p>A verse recited in enough different neighbourhoods that it cannot quietly rot, and an attention trained to
            hold several threads at once and give them back in order. Dvij watched it once at a ceremony, tried it on a
            shloka, and three books later counted his way out of a cave nobody comes back from.</p>
          <blockquote>"This shloka gave you some magical powers?" — "<strong>No</strong>, but it did help me remember the value of pi."</blockquote>
          <p class="actions">
            <a class="btn" href="/caves/">Now use it: the Bhoodara caves</a>
            <a class="btn secondary" href="/codex/vedic-pathas/">How the patterns work</a>
          </p>
          <p class="muted small">Come back in a day or so and this page will offer you one honest check of whether it stuck.</p>
        </section>
      )}
    </div>
  );
}

/* ---- the ladder: pada -> krama -> jata -> ghana ---- */

function Ladder({ verse, mode, onDone }: { verse: Verse; mode: Mode; onDone: () => void }) {
  const n = verse.words.length;
  const [level, setLevel] = useState(0);
  const [group, setGroup] = useState(0);
  const [built, setBuilt] = useState<number[]>([]);
  const [wrong, setWrong] = useState<number | null>(null);
  const [levelDone, setLevelDone] = useState(false);

  const patha = PATHAS[level];
  const groups = useMemo(() => utterances(patha, n), [patha, n]);
  const toBuild = Math.min(BUILD_GROUPS[patha], groups.length);
  const target = groups[group] ?? [];
  const nextWord = target[built.length];

  const tap = (i: number) => {
    if (i !== nextWord) { setWrong(i); return; }
    setWrong(null);
    const next = [...built, i];
    if (next.length < target.length) { setBuilt(next); return; }
    if (group + 1 < toBuild) { setGroup(group + 1); setBuilt([]); }
    else { setBuilt(next); setLevelDone(true); }
  };

  const advance = () => {
    if (level + 1 < PATHAS.length) { setLevel(level + 1); setGroup(0); setBuilt([]); setLevelDone(false); setWrong(null); }
    else onDone();
  };

  const label = PATHA_LABEL[patha];
  return (
    <section class="ladder">
      <ol class="rungs" aria-label="The patterns">
        {PATHAS.map((p, i) => (
          <li key={p} class={i < level ? "done" : i === level ? "now" : ""}>
            <span class="iast">{PATHA_LABEL[p].iast}</span>
            <span class="en">{PATHA_LABEL[p].name}</span>
          </li>
        ))}
      </ol>

      <h2>{label.iast} — {label.name.toLowerCase()}</h2>
      <p class="rule">{label.rule}</p>

      {!levelDone && (
        <>
          <p class="building" aria-live="polite">
            <span class="eyebrow">Group {group + 1} of {toBuild}</span>
            <span class="slots">
              {target.map((w, i) => (
                <span key={i} class={`slot${i < built.length ? " filled" : i === built.length ? " next" : ""}`}>
                  {i < built.length ? verse.words[w].iast : "·"}
                </span>
              ))}
            </span>
          </p>
          <div class="chips" role="group" aria-label="The words of the verse">
            {verse.words.map((w, i) => (
              <button
                key={i}
                type="button"
                class={`chip${wrong === i ? " wrong" : ""}${mode === "guided" && i === nextWord ? " hint" : ""}`}
                onClick={() => tap(i)}
                aria-label={`${w.iast}, word ${i + 1}: ${w.gloss}`}
              >
                <span class="deva">{w.deva}</span>
                <span class="iast">{w.iast}</span>
                <span class="num">{i + 1}</span>
              </button>
            ))}
          </div>
          {wrong != null && (
            <p class="miss" role="alert">
              Not there. {label.rule} {mode === "hard" && <>The next word is number <strong>{nextWord + 1}</strong> of the verse.</>}
            </p>
          )}
        </>
      )}

      {levelDone && (
        <div class="level-done">
          <p class="right"><strong>That is {label.iast}.</strong> Said out to the end of the line it runs:</p>
          <Pattern verse={verse} groups={groups} />
          <p class="actions">
            <button type="button" class="btn" onClick={advance}>
              {level + 1 < PATHAS.length ? `Next: ${PATHA_LABEL[PATHAS[level + 1]].iast}` : "Why this works"}
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

function Pattern({ verse, groups, lit }: { verse: Verse; groups: number[][]; lit?: number[] }) {
  return (
    <p class="pattern">
      {groups.map((g, i) => (
        <span key={i} class={`utt${lit?.includes(i) ? " lit" : ""}`}>
          {g.map((w, j) => <span key={j} class="w">{verse.words[w].iast}</span>)}
        </span>
      ))}
    </p>
  );
}

/* ---- why it works: the corruption demo (design §12.2) ---- */

function Why({ verse, onDone }: { verse: Verse; onDone: () => void }) {
  const n = verse.words.length;
  const [word, setWord] = useState(Math.min(2, n - 1));
  const [patha, setPatha] = useState<Patha>("ghana");
  const groups = useMemo(() => utterances(patha, n), [patha, n]);
  const lit = utterancesTouching(patha, n, word);
  const spoken = timesSpoken(patha, n, word);

  return (
    <section class="why">
      <h2>Why it works — and it is not repetition</h2>
      <p>Say one word slips. Not forgotten, just drifted: a vowel gone long, a consonant softened. Pick a word and a
        pattern, and watch how much of the recitation it disturbs.</p>

      <div class="controls">
        <div role="group" aria-label="Word">
          <span class="eyebrow">A word drifts</span>
          <div class="chips small">
            {verse.words.map((w, i) => (
              <button key={i} type="button" class={`chip${i === word ? " on" : ""}`} onClick={() => setWord(i)}>
                <span class="iast">{w.iast}</span>
              </button>
            ))}
          </div>
        </div>
        <div role="group" aria-label="Pattern">
          <span class="eyebrow">Recited as</span>
          <div class="chips small">
            {PATHAS.map((p) => (
              <button key={p} type="button" class={`chip${p === patha ? " on" : ""}`} onClick={() => setPatha(p)}>
                <span class="iast">{PATHA_LABEL[p].iast}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p class="count" aria-live="polite">
        In <strong>{PATHA_LABEL[patha].iast}</strong>, <em>{verse.words[word].iast}</em> is spoken <strong>{spoken}</strong>
        {spoken === 1 ? " time" : " times"}, in <strong>{lit.length}</strong> different {lit.length === 1 ? "group" : "groups"},
        beside different neighbours each time.
      </p>
      <Pattern verse={verse} groups={groups} lit={lit} />

      <p class="reading">
        {patha === "pada"
          ? "Said once, alone. If it drifts here, nothing contradicts it and the error is silent — it just becomes the text."
          : lit.length >= 3
            ? "Now it cannot drift quietly. The same word sits next to different partners in several groups at once, forwards and backwards, so a slip in one place disagrees with the others and the reciter hears it."
            : "Better: the word is now said beside a neighbour, so a slip has something to disagree with."}
      </p>
      <p class="reading">
        That is the trick, and it is not that repetition wears a groove. It is <strong>redundancy</strong>, deliberately
        arranged so an error cannot propagate silently — an error-correcting code for a text nobody was permitted to
        write down, arrived at a very long time before anyone wrote a checksum.
      </p>
      <p class="actions"><button type="button" class="btn" onClick={onDone}>Now the ring of ten</button></p>
    </section>
  );
}

/* ---- the avadhana ring (design §12.3b) ---- */

type RingPhase = "asking" | "interrupted" | "answering" | "result";

function Ring({ ring, mode, onDone }: { ring: { items: string[]; distractions: string[] }; mode: Mode; onDone: () => void }) {
  const [size, setSize] = useState(4);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<RingPhase>("asking");
  const [at, setAt] = useState(0);
  const [given, setGiven] = useState<string[]>([]);
  const [answer, setAnswer] = useState<string[]>([]);
  const [best, setBest] = useState(0);

  // A fresh ring each round: `round` reshuffles without a random render.
  const items = useMemo(() => {
    const pool = [...ring.items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (i * 7 + round * 13 + size) % (i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, size);
  }, [ring.items, size, round]);
  const shuffled = useMemo(() => [...items].sort((a, b) => a.localeCompare(b)), [items]);
  const distraction = ring.distractions[round % ring.distractions.length];

  const take = () => {
    const next = [...given, items[at]];
    setGiven(next);
    if (at + 1 < size) setAt(at + 1);
    else setPhase("interrupted");
  };

  const pick = (item: string) => {
    const next = [...answer, item];
    setAnswer(next);
    if (next.length === size) {
      const right = next.filter((x, i) => x === items[i]).length;
      setBest(Math.max(best, right === size ? size : 0));
      setPhase("result");
    }
  };

  const correct = answer.filter((x, i) => x === items[i]).length;
  const perfect = phase === "result" && correct === size;

  const nextRound = () => {
    setRound(round + 1);
    setSize(perfect ? Math.min(10, size + 2) : size);
    setPhase("asking"); setAt(0); setGiven([]); setAnswer([]);
  };

  return (
    <section class="ring">
      <h2>The ring of ten</h2>
      <p class="rule">The questioners go round the circle, each handing you one thing to hold. They will not wait, and
        something will interrupt. When it is over, give them back <strong>in the order they were asked</strong>.
        {size < 10 && <> Starting with {size}; the panel in the book draws ten.</>}</p>

      <svg class="ring-fig" viewBox="0 0 320 320" role="img"
           aria-label={`An avadhana ring: ${size} questioners around one seated figure`}>
        <circle cx="160" cy="160" r="26" class="avadhani" />
        <text x="160" y="165" text-anchor="middle" class="mid">you</text>
        {items.map((_, i) => {
          const a = ((i * 360) / size - 90) * (Math.PI / 180);
          const x = 160 + 120 * Math.cos(a), y = 160 + 120 * Math.sin(a);
          const state = phase === "asking" ? (i < given.length ? "given" : i === at ? "asking" : "") : "given";
          return (
            <g key={i} class={`questioner ${state}`}>
              <circle cx={x} cy={y} r="20" />
              <text x={x} y={y + 5} text-anchor="middle">{i + 1}</text>
            </g>
          );
        })}
      </svg>

      {phase === "asking" && (
        <div class="asking" aria-live="polite">
          <p class="who"><span class="eyebrow">Questioner {at + 1} of {size}</span></p>
          <p class="item">“Hold this: <strong>{items[at]}</strong>.”</p>
          <p class="held">
            {given.map((g, i) => <span key={i} class="chip small">{mode === "guided" ? g : `${i + 1}`}</span>)}
          </p>
          <p><button type="button" class="btn" onClick={take}>{at + 1 < size ? "Next questioner" : "That is all of them"}</button></p>
        </div>
      )}

      {phase === "interrupted" && (
        <div class="interrupted">
          <p class="eyebrow">Apraṣṭuta-prasaṅga — the one with no question</p>
          <p class="item">{distraction}</p>
          <p class="muted small">There is no right answer. That is the point: he is here to break your hold on the list.
            The Professor gets the same treatment on this very page, mid-sentence.</p>
          <p><button type="button" class="btn" onClick={() => setPhase("answering")}>Ignore him and answer</button></p>
        </div>
      )}

      {phase === "answering" && (
        <div class="answering">
          <p class="eyebrow">Give them back in order — {answer.length} of {size}</p>
          <p class="held">
            {answer.map((a, i) => <span key={i} class="chip small on">{a}</span>)}
            {Array.from({ length: size - answer.length }, (_, i) => <span key={`e${i}`} class="chip small empty">·</span>)}
          </p>
          <div class="chips">
            {shuffled.filter((s) => !answer.includes(s)).map((s) => (
              <button key={s} type="button" class="chip" onClick={() => pick(s)}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {phase === "result" && (
        <div class={`result ${perfect ? "right" : "partial"}`} role="status">
          <p>
            <strong>{correct} of {size}</strong> in the right place.
            {perfect ? " The whole ring, in order." : " An avadhani would have had all of them."}
          </p>
          <p class="held">
            {items.map((it, i) => (
              <span key={i} class={`chip small ${answer[i] === it ? "on" : "off"}`}>{i + 1}. {it}</span>
            ))}
          </p>
          <p class="actions">
            <button type="button" class="btn" onClick={nextRound}>
              {perfect && size < 10 ? `Try ${Math.min(10, size + 2)} questioners` : "Go again"}
            </button>
            <button type="button" class="btn secondary" onClick={onDone}>Finish</button>
          </p>
        </div>
      )}
    </section>
  );
}

/* ---- the honest recall check (design §12.4) ---- */

function Recall({ verse, onDone }: { verse: Verse; onDone: (kept: boolean) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const pool = useMemo(
    () => verse.words.map((_, i) => i).sort((a, b) => verse.words[a].iast.localeCompare(verse.words[b].iast)),
    [verse],
  );
  const right = order.filter((w, i) => w === i).length;
  const kept = done && right === verse.words.length;

  return (
    <section class="recall">
      <h2>Is it still there?</h2>
      <p>No hints and no second go. Put the words back in the order of the verse.</p>
      <p class="held">
        {order.map((w, i) => <span key={i} class="chip small on">{verse.words[w].iast}</span>)}
        {Array.from({ length: verse.words.length - order.length }, (_, i) => <span key={`e${i}`} class="chip small empty">·</span>)}
      </p>
      {!done && (
        <div class="chips">
          {pool.filter((i) => !order.includes(i)).map((i) => (
            <button key={i} type="button" class="chip" onClick={() => {
              const next = [...order, i];
              setOrder(next);
              if (next.length === verse.words.length) setDone(true);
            }}>{verse.words[i].iast}</button>
          ))}
        </div>
      )}
      {done && (
        <div class={`result ${kept ? "right" : "partial"}`} role="status">
          <p>{kept
            ? <><strong>All of it.</strong> The book claims the verse "got stuck in my mind permanently". For you, so far, that is holding.</>
            : <><strong>{right} of {verse.words.length}.</strong> It has faded — which is the ordinary result, and worth saying plainly rather than pretending otherwise. The reciters who kept these texts did the patterns daily for years.</>}</p>
          <p class="held">{verse.words.map((w, i) => (
            <span key={i} class={`chip small ${order[i] === i ? "on" : "off"}`}>{w.iast}</span>
          ))}</p>
          <p><button type="button" class="btn secondary" onClick={() => onDone(kept)}>Close</button></p>
        </div>
      )}
    </section>
  );
}
