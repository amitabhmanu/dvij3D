# The Twice Born — website

Static Astro site for Netlify that publishes the comic. Page images, art and PDFs
are generated from `../book/` into `../site-assets/` and are never committed; they
are served from a Cloudflare R2 bucket.

| Document | What it is |
|---|---|
| [docs/twice-born-website-design.md](docs/twice-born-website-design.md) | The design. What the site is, how the pipeline works, what every layer does, and what is still open. Kept in step with the code |
| [docs/real-india-pairings.md](docs/real-india-pairings.md) | Researched real-world counterparts for the valley's places, with confidence levels and sources. Awaiting your confirmation; blocks the Real India layer |
| [docs/real-india-images.md](docs/real-india-images.md) | Freely licensed photographs found for each pairing, with licence and credit. Follows the pairings, so it moves if they do |
| [docs/twice-born-website-design-discussion.md](docs/twice-born-website-design-discussion.md) | The original brainstorm the design was drawn from. Superseded where the two disagree - see design §17 |

**State:** all five books are in — 171 pages, 1,712 panels, every panel described,
all 81 chapter starts confirmed. The companion layers are built: a Codex of 24
entries, a Bestiary of 14 creatures, the Parchment's 5 puzzles, the Bhoodara caves,
the Memory Hall, a journey rail of 10 beats, 8 Council of Voices cards and 5 hidden
Charvaka fragments, linked by 115 hotspots. The valley map and its Real India layer
are built too: 17 places, 25 freely licensed photographs, each credited as its licence
requires. Still open: your confirmation of the place pairings, which that page is built
on and says so; audio for the Memory Hall, which ships silent (design §12.6); and the
v2 AI features.

## Layout

| Path | What |
|---|---|
| `pipeline/` | Content pipeline (Python + one Node script), run locally |
| `src/content/manifests/` | Per-book manifests the site reads (generated, committed) |
| `src/content/corrections/` | Your review edits: panel boxes, alt text, chapter starts (committed) |
| `src/content/codex/` | Codex (glossary) entries, one Markdown file each |
| `src/content/bestiary/` | Bestiary entries — the book's creatures, one Markdown file each |
| `src/content/memory.yaml` | The Memory Hall: anchors, verses and the avadhana ring's items |
| `src/content/places.yaml` | The valley map's places and their Real India pairings |
| `src/content/generated/places-images.json` | Each photograph's photographer, licence and Commons page, read off Commons (generated) |
| `src/content/generated/codex-links.json` | Where each Codex entry appears in the comic (generated) |
| `src/content/generated/bestiary-links.json` | Where each creature is named or drawn, and its card crop (generated) |
| `src/content/generated/memory.json` | The Memory Hall's content with its anchors resolved to pages (generated) |
| `src/content/hotspots/` | `auto.json` (generated links from the lettering), `bestiary.json`, `memory.json`, `puzzles.json`, `companions.json`, `manual.json` (your additions/removals) |
| `src/islands/` | Interactive components (reader, dev review tool) |
| `integrations/local-assets.mjs` | Serves `../site-assets` at `/_assets` in dev; bundles it on `build:local` |

## Setup

```bash
npm install
pip install -r pipeline/requirements.txt
```

The Python packages are for the content pipeline only, which runs on your
machine. `requirements.txt` is kept under `pipeline/` rather than at the repo
root so Netlify does not install them on every deploy.

## Content pipeline

```bash
npm run pipeline          # everything, in order (slow steps skip finished work)
python pipeline/run_all.py --from text   # resume from a later step
```

Steps (see each script's docstring):

0. `common.py` holds `PAGE_CROPS`, the one page published cropped: B1 p1, whose bottom half is a pure-black image in the source PDF (design §2.1). The crop is applied at the source, so every later step works in the published page's coordinates.
1. `compress.py` — compresses `book/B*.pdf` (JPEG q80, 4:2:0) into `site-assets/pdf/` and checks page counts, identical text and visual similarity (SSIM ≥ 0.97). Report: `pipeline/reports/compress.json`.
2. `render_pages.py` — 2× PNG masters of every page (local only).
3. `make_variants.mjs` — AVIF + WebP at 2115/1400/900/240 px, content-hashed (≈1.5 h on a 4-core laptop).
4. `extract_text.py` — captions, balloons and sound effects with positions.
5. `detect_panels.py` — draft panel boxes (paint-order aware).
6. `map_chapters.py` — chapter start pages from the breakdown quotes.
7. `prepare_art.py` — publishes only the allow-listed working images + parchment puzzle crops.
8. `extract_endnotes.py` — manuscript endnotes → draft glossary entries.
9. `build_manifests.py` — merges all of the above plus `src/content/corrections/`.
10. `link_codex.py` — finds every balloon/caption that mentions a Codex entry (by its `aliases`) and makes it a hotspot; the earliest mention becomes the entry's spoiler position (`firstSeen`).
11. `link_bestiary.py` — the same alias scan for the Bestiary, with per-entry exclusions, plus the creature card crops and the `beast:` hotspots. `--sheet` writes a contact sheet of the cards.
12. `link_memory.py` — pins the Memory Hall's anchors to the lettering that carries them and places the `memory:` hotspot.
13. `link_parchment.py` — resolves each puzzle's "starts" and "solved" quotes (in `src/content/parchment.yaml`) to comic pages, and adds a "Puzzle" badge hotspot where each puzzle begins.
14. `link_companions.py` — locates the Journey rail beats, crops each Voice's portrait from the panel where they speak, and places the `voice:` and hidden `fragment:` hotspots. `--sheet` also writes a portrait contact sheet.
15. `fetch_real_india.py` — downloads the Real India layer's photographs from Wikimedia Commons, refuses anything that is not freely licensed, and records each one's photographer, licence and file page.
16. `link_places.py` — joins `src/content/places.yaml` to those credits and to the comic pages that name each place.
17. `validate_content.py` — checks every Codex, Bestiary, Memory Hall and place link, image, credit, hotspot, puzzle answer, voice, rail beat, fragment and page reference resolves (`npm run validate`).

Helper: `python pipeline/find_page.py "a manuscript quote"` → book, page and chapter where it appears in the comic.

## Reviewing panels, descriptions and chapters

**This pass is complete.** All 171 pages have been checked against the art: 1,712 panels,
every one with a description, and all 81 chapter starts confirmed. Use the tool below to
change any of it.

| | Draft from the pipeline | After review |
|---|---|---|
| Panel boxes | 1,686 | 1,712 |
| Panels described | 0 | 1,712 |
| Chapter starts confirmed | 65 of 81 | 81 of 81 |

Book 1 took almost all the corrections (20 pages of 42): its pages are montages with no
gutters, so detection merged two drawings into one box again and again. Books 2-5 are on
regular grids and needed five pages between them. Two pages also had their reading order
wrong - B1 p21 and B4 p18, where interleaved columns scrambled the dialogue.

```bash
npm run dev               # then open http://localhost:4321/dev/review
```

- Drag on empty space to draw a panel; drag a box to move it; drag its corner to resize; Delete removes it.
- List order = reading order (↑/↓ to reorder).
- Descriptions say what is **drawn**, not what is said - the page transcript already carries
  the lettering, and a screen reader reads both. They also keep the book's own withholding:
  he is "the young man" until the Professor names him Dvij on B1 p12.
- "Set as start of" fixes a chapter's first page.
- Ctrl+S saves the page to `src/content/corrections/`; `[` and `]` move between pages.

Afterwards run `npm run manifests` to fold the corrections into the manifests.

Corrections live in two files, both committed:

| File | Shape |
|---|---|
| `src/content/corrections/panels.json` | `{"b1-p004": {"panels": [[x0,y0,x1,y1], …], "alt": ["…", …]}}` - omit `panels` to keep the detected boxes and only set descriptions |
| `src/content/corrections/chapters.json` | `{"23": 39}` - chapter number to corrected start page |

**Hotspots mode** (same page, "Hotspots" button): orange boxes are automatic links from the lettering;
click one to switch it off. To add a link (e.g. on a drawn symbol rather than a word), pick a Codex entry
and drag a box. Changes save to `src/content/hotspots/manual.json` immediately.

## How companion content finds its page

Puzzle starts, rail beats, Voice `firstSeen` values and fragments are all pinned to a
comic page by `pipeline/find_page.py`: it locates a quoted passage in the manuscript,
reads off its chapter, and picks the page in that chapter whose lettering matches best.
Chapter ranges include the reviewed corrections from `corrections/chapters.json`.

Where the art never lettered the passage, nothing matches and the lookup falls back to
the chapter's first page - reported as `chapter-only`. That is usually close, but for a
`firstSeen` it lifts the spoiler veil early. Four anchors were wrong and are now pinned
explicitly, each with a comment saying what the art shows:

| Where | Field |
|---|---|
| `content/parchment.yaml` | `availablePage: b4-p016` |
| `content/rail.yaml` | `page: b5-p009` on the node |
| `content/voices/*.md` | `firstSeen: {book, page}` in the front matter |

An override resolves with confidence `reviewed`. Re-run `npm run codex`,
`python pipeline/link_parchment.py` and `python pipeline/link_companions.py` after
editing any of them, and they print each anchor's confidence.

## Codex entries

Each entry is `src/content/codex/<id>.md` with frontmatter: `title`, `aliases` (words that
auto-link it in the comic), `summary` (shown in the reader's drawer), `related`, `images`
(names in `site-assets/art`), `source`, and optionally `firstSeen: {book, page}` to override the
computed spoiler position. An image of real people or a real place also takes `imageAlt` and
`imageCredit`, so its description and its source are on the page rather than assumed. After adding or editing aliases, run `npm run codex` then `npm run validate`.

Spoilers: an entry is blurred for readers who haven't reached its `firstSeen` page, unless they
choose "Show everything". Progress lives in the reader's browser only.

## Bestiary

Each creature is `src/content/bestiary/<id>.md`. It takes the Codex fields plus:

| Field | What it does |
|---|---|
| `class` | One of `nature-spirit` `wild-folk` `demon` `restless-dead` `serpent` `carving` `legendary-race`; drives the gallery filter |
| `appearance` | What it looks like, used as the card caption and the image's alt text |
| `exclude` | Page ids where this entry's aliases must **not** fire (e.g. a zodiac sign that shares a creature's name) |
| `art` | `{page, box}` or `{page, panel}` — the crop taken from the page master as the card image |
| `alsoOn` | More `{page, box}` marks for places the creature is **drawn but never named**, which no alias scan can find |
| `kin` | Other creatures; `related` links to Codex entries |

The body is three sections by convention — **In the book**, **In tradition**, **And yet** —
the last being who in the story doubts the creature. Run `npm run bestiary` after editing,
then `npm run validate`. `python pipeline/link_bestiary.py --sheet` writes
`site-assets/data/bestiary-cards.png` so the crops can be checked at a glance.

New card images mean new files in `site-assets/art/`, so they need `npm run upload -- --only art`
before they appear on the deployed site.

## Puzzles

`src/content/parchment.yaml` holds the five parchment puzzles and the caves settings. Each puzzle is a
chain of multiple-choice `stages` (prompt, choices, answer, hint, explanation, optional Codex link),
transcribed from the characters' reasoning in the manuscript. After editing it, run
`python pipeline/link_parchment.py` then `npm run validate`. A puzzle opens for readers at its
`availableQuote` page; the guided walkthrough opens at its `solvedQuote` page.

## The Memory Hall

`src/content/memory.yaml` holds the recitation trainer at `/avadhana/`: the anchors that pin it
to the comic, the verses the ladder drills, and the avadhana ring's items.

A verse is just a word list — `{deva, iast, gloss}` each — because the recitation patterns are
**generated by rule** in `src/lib/pathas.ts` (`pada`, `krama`, `jaṭā`, `ghana`). Adding a verse
needs no code. Note that `words` is the *pada* split, which is not the syllable split the
katapayadi decode uses in `Caves.tsx`: same verse, two different readings, deliberately kept apart.

The `anchors` are comic lettering rather than manuscript prose, so each gives a page id and a
fragment to match inside it; `link_memory.py` fails loudly if a fragment no longer matches.
Run `npm run memory` after editing, then `npm run validate`.

The Hall ships **silent** (design §12.6).

## The valley map and Real India

`src/content/places.yaml` holds each place on the valley map, what the book says about it, and the real Indian
site it most resembles, with the map rect measured off `images/artifacts/map.jpg`. The pairings are researched
resemblances rather than your sources, and the page says so in as many words.

Credits are **not** written by hand. `python pipeline/fetch_real_india.py` downloads each photograph from
Wikimedia Commons, refuses any file that is not freely licensed, and writes the photographer, licence, licence
URL and file page into `src/content/generated/places-images.json`. `npm run places` joins the two, and
`npm run validate` fails if a photograph is missing its alt text, artist, licence or source. Photographs are
shown whole at reduced size and never cropped, which keeps a CC BY-SA crop from having to be relicensed.

New photographs mean new files in `site-assets/art/`, so they need `npm run upload -- --only art` before they
appear on the deployed site.

## Companion layers

| Content | File | Notes |
|---|---|---|
| Journey rail | `src/content/rail.yaml` | Each beat's `quote` locates it in the comic; lenses are `chakra`, `party`, `teacher`, `epic` |
| Council of Voices | `src/content/voices/*.md` | `quote` (and optional `firstQuote`) set where they appear; `portrait: {page, match}` picks the panel, or `portrait: {page, box}` for a hand-picked crop |
| Charvaka fragments | `src/content/fragments.yaml` | Five hidden marks; finding all five opens `/charvaka/` |

`python pipeline/author_voices.py` regenerates the Voice entries from scratch (it overwrites hand edits).
After editing any of these, run `python pipeline/link_companions.py` then `npm run validate`.

## Downloads and analytics

The PDF on a book's page sits behind a **read-online-first** flow (design §18.13): until the reader has read
three pages of that book, the button invites them to read it online and says what it is waiting for. The real
link is in the served HTML, so JavaScript-off readers and crawlers keep it; the gate is applied by
`src/components/PdfDownload.astro` from the reader's own progress.

**Analytics** are off unless configured, and must never set a cookie or identify a reader. Netlify Analytics
needs no code — it counts server-side, so there is nothing to add and no consent banner to show. For a
privacy-friendly script instead, set `PUBLIC_ANALYTICS_SRC` (and `PUBLIC_ANALYTICS_DOMAIN`) and
`src/components/Analytics.astro` emits the tag.

## Build, test, deploy

```bash
npm run build             # production build (assets served from PUBLIC_ASSET_BASE)
npm run build:local       # same, with site-assets bundled into dist/_assets
npm run test:e2e          # Playwright tests against dist/ (run build:local first)
```

Environment variables:

| Variable | Purpose |
|---|---|
| `PUBLIC_ASSET_BASE` | Where page images, art and PDFs are served from. Set to the R2 bucket in `netlify.toml`; unset locally, where the dev server serves `../site-assets` at `/_assets`. |
| `SITE_URL` | Canonical site URL (once the domain is chosen). |
| `BUNDLE_ASSETS=1` | Copy `site-assets` into the build (option B). `build:local` sets it. |

### Releasing

Netlify builds and publishes every push to `main`, and the built site links its
images straight to the R2 bucket. Code and artifacts travel separately, so the
order matters:

```bash
npm run upload                            # 1. new artifacts into the bucket first
npm run build                             # 2. the build Netlify will make
npm run verify-assets                     # 3. everything that build links is in the bucket
npm run build:local && npm run test:e2e   # 4. the full suite
git push                                  # 5. one push, one production build
```

`verify-assets` names any file the build links that is not in the bucket, and
exits non-zero. That is the failure that shipped B1 p1 (the home page's hero)
and all 25 Real India photographs as broken images: committed and pushed, never
uploaded. With `PUBLIC_ASSET_BASE` set in `.env`, step 4 also loads every image
from the real bucket. Push once at the end rather than after each commit: every
push is a production build.

## Hosting the assets (Cloudflare R2)

The 742 MB of page images, art and PDFs are build output, not source, so they
are never in git. They live in a Cloudflare R2 bucket and the site reads them
from `PUBLIC_ASSET_BASE`. R2 charges nothing for egress, which is what makes it
a good fit for a comic: a reader going through all 171 pages pulls about 36 MB.

One-time setup:

1. Cloudflare dashboard -> R2 -> Create bucket, named `dvij-assets`, location
   Automatic.
2. That bucket -> Settings -> Public access. Either allow the `r2.dev` subdomain
   (fine to start; Cloudflare rate-limits it and asks you not to use it for
   production) or attach a custom domain such as `assets.yourdomain.com`, which
   is the better option once the domain exists.
3. R2 -> API -> Manage API tokens -> Create API token, permission **Object Read &
   Write**, scoped to this bucket only. Copy the access key id and secret; the
   secret is shown once.
4. `cp .env.example .env` and fill in `R2_ACCOUNT_ID`, `R2_BUCKET`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. `.env` is gitignored.
5. Put the bucket's public URL in `netlify.toml` as `PUBLIC_ASSET_BASE`, with
   no trailing slash. It is public by design and shows up in every built page,
   so it belongs in the repo rather than in the Netlify UI. Astro inlines it at
   build time, so changing it needs a redeploy.

Then upload:

```bash
npm run upload -- --dry-run     # what it would send, and how much
npm run upload                  # ~742 MB the first time
npm run upload -- --only art    # just one folder
```

The script mirrors `site-assets/pages`, `art` and `pdf` into the bucket at the
same paths, sets each object's content type, and caches the content-hashed
images forever. It skips anything already in the bucket at the same size, so a
re-run after an interrupted upload picks up where it stopped, and re-running
after a partial re-encode only sends what changed. `--force` re-uploads
everything.
