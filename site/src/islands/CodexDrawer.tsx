/** @jsxImportSource preact */
// Short Codex definitions shown over the comic when a hotspot is tapped
// (design §6.2): a bottom sheet on phones, a side panel on desktop. The full
// entry lives at /codex/<id>/.
import { useEffect, useRef, useState } from "preact/hooks";
import type { CodexSummary } from "../lib/codex";
import type { BeastSummary } from "../lib/bestiary";
import type { Fragment, VoiceSummary } from "../lib/companions";
import { findFragment, FRAGMENT_COUNT } from "../lib/fragments";
import { isVeiled } from "../lib/spoilers";

let cache: Promise<CodexSummary[]> | null = null;
const loadCodex = () =>
  (cache ??= fetch("/data/codex.json").then((r) => r.json()).catch(() => { cache = null; return []; }));

let beastCache: Promise<BeastSummary[]> | null = null;
const loadBestiary = () =>
  (beastCache ??= fetch("/data/bestiary.json").then((r) => r.json()).catch(() => { beastCache = null; return []; }));

let companionCache: Promise<{ voices: VoiceSummary[]; fragments: Fragment[] }> | null = null;
const loadCompanions = () =>
  (companionCache ??= fetch("/data/companions.json").then((r) => r.json())
    .catch(() => { companionCache = null; return { voices: [], fragments: [] }; }));

type Props = { targets: string[]; label?: string; onClose: () => void };

export default function CodexDrawer({ targets, label, onClose }: Props) {
  const [entries, setEntries] = useState<CodexSummary[] | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ids = targets.filter((t) => t.startsWith("codex:")).map((t) => t.slice(6));
  const puzzles = targets.filter((t) => t.startsWith("puzzle:")).map((t) => t.slice(7));
  const voiceIds = targets.filter((t) => t.startsWith("voice:")).map((t) => t.slice(6));
  const fragmentIds = targets.filter((t) => t.startsWith("fragment:")).map((t) => t.slice(9));
  const beastIds = targets.filter((t) => t.startsWith("beast:")).map((t) => t.slice(6));
  const memoryIds = targets.filter((t) => t.startsWith("memory:")).map((t) => t.slice(7));
  const [beasts, setBeasts] = useState<BeastSummary[] | null>(null);
  const [companions, setCompanions] = useState<{ voices: VoiceSummary[]; fragments: Fragment[] } | null>(null);
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    if (beastIds.length) loadBestiary().then(setBeasts);
    if (voiceIds.length || fragmentIds.length) loadCompanions().then(setCompanions);
    if (fragmentIds.length) fragmentIds.forEach((id) => setFound(findFragment(id)));
  }, []);

  useEffect(() => { loadCodex().then(setEntries); }, []);
  useEffect(() => { closeRef.current?.focus(); }, []);

  const byId = new Map((entries ?? []).map((e) => [e.id, e]));
  const shown = ids.map((id) => byId.get(id)).filter((e): e is CodexSummary => !!e);

  return (
    <aside class="codex-drawer" role="dialog" aria-label="Codex" onPointerUp={(e) => e.stopPropagation()}>
      <header>
        <span class="eyebrow">{ids.length ? "Codex" : beastIds.length ? "Bestiary" : memoryIds.length ? "The Memory Hall" : puzzles.length ? "Puzzle" : voiceIds.length ? "Council of Voices" : "A fragment"}</span>
        <button type="button" ref={closeRef} class="close" onClick={onClose} aria-label="Close">×</button>
      </header>
      {voiceIds.map((id) => {
        const v = companions?.voices.find((x) => x.id === id);
        return v ? (
          <article key={id} class={`voice-card role-${v.role}`}>
            {v.portrait && <img src={v.portrait} alt="" loading="lazy" />}
            <h2>{v.name}</h2>
            <p class="muted">{v.tradition}</p>
            <blockquote>{v.excerpt}</blockquote>
            <p class="more"><a href={`/voices/${v.id}/`}>Meet {v.name.replace(/^The /, "the ")} →</a></p>
          </article>
        ) : <p class="muted" key={id}>Loading…</p>;
      })}
      {fragmentIds.map((id) => {
        const f = companions?.fragments.find((x) => x.id === id);
        return f ? (
          <article key={id} class="fragment-card">
            <h2>{f.title}</h2>
            <p>{f.text}</p>
            <p class="muted">{f.source}</p>
            <p class="count">Fragment found: {found.length} of {FRAGMENT_COUNT}</p>
            {found.length >= FRAGMENT_COUNT
              ? <p class="more"><a href="/charvaka/">You have them all. Follow the thread →</a></p>
              : <p class="muted small">Others are hidden in the comic. Look for this mark.</p>}
          </article>
        ) : <p class="muted" key={id}>Loading…</p>;
      })}
      {beastIds.map((id) => {
        const b = beasts?.find((x) => x.id === id);
        return b ? (
          <article key={id} class="beast-card">
            {b.image && <img src={b.image} alt="" loading="lazy" />}
            <h2>{b.title}</h2>
            <p class="muted small">{b.classLabel}</p>
            <p>{b.summary}</p>
            <p class="more"><a href={`/bestiary/${b.id}/`}>What it is, and who doubts it →</a></p>
          </article>
        ) : <p class="muted" key={id}>Loading…</p>;
      })}
      {memoryIds.map((id) => (
        <article key={id} class="memory-card">
          <h2>The technique he is describing</h2>
          <p>Forward, backward, interleaved — the recitation patterns that carried the Veda without writing. Dvij
            tries them on one shloka and it sticks.</p>
          <p class="more"><a href="/avadhana/">Learn it yourself →</a></p>
        </article>
      ))}
      {puzzles.map((id) => (
        <article key={id} class="puzzle-card">
          <h2>{label ?? "A puzzle"}</h2>
          <p>{id === "caves"
            ? "Can you find your way through the Bhoodara labyrinth the way Dvij did?"
            : "The characters are about to work on this one. Try solving it yourself first."}</p>
          <p class="more"><a href={id === "caves" ? "/caves/" : `/parchment/#${id}`}>Try the puzzle →</a></p>
        </article>
      ))}
      {!ids.length ? null : entries === null ? <p class="muted">Loading…</p> : shown.map((e) => {
        // Only link related entries the reader has already reached.
        const seeAlso = e.related.map((r) => byId.get(r)).filter((r): r is CodexSummary => !!r && !isVeiled(r.firstSeen));
        return (
        <article key={e.id}>
          {e.image && <img src={e.image} alt="" loading="lazy" />}
          <h2>{e.title}</h2>
          <p>{e.summary}</p>
          <p class="more"><a href={`/codex/${e.id}/`}>Read the full entry →</a></p>
          {seeAlso.length > 0 && (
            <p class="related">
              See also:{" "}
              {seeAlso.map((r, i) => <>{i > 0 && ", "}<a href={`/codex/${r.id}/`}>{r.title}</a></>)}
            </p>
          )}
        </article>
        );
      })}
    </aside>
  );
}
