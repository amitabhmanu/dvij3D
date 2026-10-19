"""One-time authoring helper (Phase 2): promote the endnote drafts to Codex
entries and write the core entries. Re-running overwrites src/content/codex/*.md,
so only re-run before any hand edits — afterwards, edit the Markdown directly.

Entries follow the book's own explanations; general facts (e.g. the names of
the ten Mahavidyas, the katapayadi code) are standard reference knowledge.
Usage: python author_codex.py
"""
import yaml

from common import SITE

CODEX = SITE / "src" / "content" / "codex"
DRAFTS = CODEX / "_drafts"


def draft_parts(name: str, drop_first: bool) -> tuple[str, str]:
    """(body without TODO lines, manuscript anchor) of a draft."""
    _, front, body = (DRAFTS / name).read_text(encoding="utf-8").split("---", 2)
    lines = [l for l in body.strip().splitlines() if not l.startswith("<!-- TODO")]
    if drop_first and lines and not lines[0].startswith("|"):
        lines = lines[1:]  # first line repeats the title in most drafts
    return "\n".join(lines).strip(), yaml.safe_load(front).get("manuscriptAnchor", "")


FROM_ENDNOTES = {
    "vaastu-purusha-mandala": dict(
        draft="01-vaastu-purusha-mandala.md", keep_first=True,
        title="Vaastu Purusha Mandala", aliases=["vaastu purusha", "vaastu mandala", "vaastu purusha mandala"],
        summary="The sacred grid behind Indian architecture: a cosmic man pinned face-down by the gods, whose body becomes the blueprint for temples, towns and homes.",
        related=["dikpalas", "gnomon", "navagrahas"], images=["codex-vaastu-mandala"], source="endnote-1",
        intro="""In the Professor's telling, a giant being, the **Vaastu Purusha**, once roamed the void and confronted the gods. Threatened by its size, they pinned it face-down, and the universe took shape above it.

Its outline became the *mandala*: a square grid in which each cell belongs to a deity, with Brahma at the centre and the guardians of the directions around the edge. The same grid lays out a temple, a town, or a single house, so each level is "a miniature version of the level above it… cosmos within a cosmos."

In the valley, the grid governs the ground-breaking ceremony for the new temple: the earth is divided according to the mandala, and each of the nine lords is appeased.

**From the book's notes:**"""),
    "ashtadhyayi": dict(
        draft="02-ashtadhyayi.md", keep_first=True,
        title="Ashtadhyayi", aliases=["ashtadhyayi", "panini"],
        summary="Panini's grammar of Sanskrit: an entire language captured in just under four thousand terse rules.",
        related=["katapayadi"], images=[], source="endnote-2",
        intro="""The *Ashtadhyayi* ("eight chapters") is the grammar of Sanskrit composed by **Panini**, probably in the 5th or 4th century BCE. Its short rules, or *sutras*, generate the forms of the language from roots (*dhatu*) and word lists (*gana*). Modern linguists still admire it as one of the most compact descriptions of a language ever written.

The Professor is an enthusiast: "An entire language etched in a handful of rules. Incredible brevity."

**From the book's notes:**"""),
    "katapayadi": dict(
        draft="03-the-vedic-mathematics-shloka.md", keep_first=True,
        title="The pi shloka (katapayadi)", aliases=["katapayadi", "gopi bhagya", "value of pi"],
        summary="A Sanskrit verse that doubles as a memory aid for pi: under the katapayadi code, each consonant stands for a digit.",
        related=["ashtadhyayi"], images=[], source="endnote-3",
        intro="""**Katapayadi** is an old Indian system for hiding numbers in words. Each consonant stands for a digit, *ka ṭa pa ya* each mark the start of a run from 1, and vowels on their own count as zero. So any number can be turned into a memorable phrase, and a phrase read back into its number.

Read this way, the verse *gopī bhāgya madhuvrāta…* spells out the digits of pi, 3.1415926535897932384626433832792…, while reading on the surface as a hymn.

Dvij learns it from the memory techniques of the *avadhana* performers. The verse sticks in his mind, and the digits it gives him turn out to be surprisingly useful.

**From the book's notes:**"""),
    "dikpalas": dict(
        draft="04-dikpalas.md",
        title="Dikpalas", aliases=["dikpala", "dikpalas", "ashtadikpala", "ashtadikpalas", "mahadikpalas", "guardians of the directions"],
        summary="The guardians of the directions: eight deities, ten counting zenith and nadir, each ruling a compass point, and drawn on a 3×3 grid.",
        related=["vaastu-purusha-mandala", "navagrahas", "matrikas"], images=["codex-directions"], source="endnote-4",
        intro="""The **Ashtadikpalas** are the eight guardians of the directions: Kubera (north), Yama (south), Indra (east), Varuna (west), and Ishana, Agni, Vayu and Nirrti at the corners. The first four are the more important *Mahadikpalas*. Add Brahma (zenith) and Vishnu (nadir) and there are ten.

Because each guards one direction, they are drawn on a 3×3 grid with the centre left empty. As Dvij, Bhavi and Kurup discover, that empty centre matters.

**From the book's notes:**"""),
    "ashtalakshmi": dict(
        draft="05-lakshmi-s-symbol.md",
        title="Ashtalakshmi and Lakshmi's symbol", aliases=["ashtalakshmi", "ashtalakshmis", "lakshmi's symbol"],
        summary="Lakshmi in eight forms, and her symbol: the eight-pointed star made from two overlapping squares.",
        related=["mahavidyas", "matrikas", "dikpalas"], images=["codex-lakshmi-symbol"], source="endnote-5",
        intro="""The **Ashtalakshmi** are eight forms of the goddess Lakshmi, each presiding over a different kind of fortune. Bhavi describes them as "ranging from most benevolent to most malevolent."

Their emblem, which Bhavi knows by heart, is the eight-pointed star formed by two overlapping squares, one turned 45°."""),
    "nakshatras": dict(
        draft="06-nakshatras.md",
        title="Nakshatras", aliases=["nakshatra", "nakshatras", "lunar house", "lunar houses", "lunar mansions", "asterism"],
        summary="The 27 lunar mansions of Indian astronomy, each 13°20′ of the sky, each with its own symbol, ruling planet and syllables.",
        related=["navagrahas", "tattvas"], images=["codex-nakshatra"], source="endnote-6",
        intro="""As the moon circles the sky, it passes through 27 **nakshatras**, or lunar houses, each spanning 13°20′. Legend makes them the moon's wives. The one the moon occupies at a child's birth is central to drawing up a natal chart.

Each nakshatra has a symbol, a ruling planet, and syllables of the Devanagari alphabet. The table below, from the book's notes, lists all three.

**From the book's notes:**"""),
    "shaivite-renunciation": dict(
        draft="07-stages-of-shaivite-renunciation.md", keep_first=True,
        title="Aghora and the stages of renunciation", aliases=["aghori", "aghora"],
        summary="The tantric baba's path: three stages of Shaivite renunciation, from ash-covered temple life to meditation in the cremation ground.",
        related=["kaula", "kundalini"], images=[], source="endnote-7",
        intro="""Keshav Bharan, the *aghori* of the Kaal Bhairava temple, follows the Aghora path of Shiva worship. To reach the levels of the Naths, Siddhas and Rishis, he says, "one must go far beyond what is normally practiced… with complete and absolute renunciation."

**From the book's notes:**"""),
    "chakras": dict(
        draft="08-chakras-and-tattvas.md",
        title="Chakras", aliases=["chakras", "muladhara", "svadhishthana", "manipura", "anahata", "vishuddha", "ajna", "sahasrara"],
        summary="The energy centres along the spine through which kundalini rises, from muladhara at the base to sahasrara at the crown.",
        related=["kundalini", "tattvas", "bija-mantras"], images=["codex-tattvas"], source="endnote-8",
        intro="""The **chakras** ("wheels") are centres of subtle energy along the spine, pictured as lotuses with a set number of petals. As *kundalini* rises through them, the practitioner moves closer to the divine:

1. **Muladhara**: base of the spine
2. **Svadhishthana**: sacral, beneath the navel
3. **Manipura**: solar plexus
4. **Anahata**: heart, where one hears "the sound of the unstruck"
5. **Vishuddha**: throat, the seat of speech and chant
6. **Ajna**: the brow, the "third eye"
7. **Sahasrara**: the crown of the head

Each is linked to one of the elements (*tattvas*) of Samkhya philosophy, as the book's table shows.

**From the book's notes:**"""),
    "kanchukas": dict(
        draft="09-kanchukas.md", keep_first=True,
        title="Kanchukas", aliases=["kanchuka", "kanchukas"],
        summary="Five \"sheaths\" of illusion (limits of time, space, desire, knowledge and power) that veil pure consciousness.",
        related=["tattvas", "chakras"], images=["codex-hierarchy"], source="endnote-9",
        intro="""In the tantric extension of Samkhya thought, **Maya** clothes pure consciousness in five *kanchukas*, or sheaths:

- **Kaala**: limitation of time
- **Niyati**: limitation of space and causation
- **Raaga**: desire, attachment
- **Vidya**: limited knowledge
- **Kalaa**: limited power

"One who can break through these sheaths," Bhavi recalls, "can attain eternity of bliss."

**From the book's notes:**"""),
    "bija-mantras": dict(
        draft="10-bija-mantras.md",
        title="Bija mantras and bija aksharas", aliases=["bija mantra", "bija mantras", "bija akshara", "bija aksharas"],
        summary="Seed syllables: each chakra's lotus carries a single letter at its centre, its bija akshara.",
        related=["chakras", "tattvas"], images=["codex-tattvas"], source="endnote-10",
        intro="""A *bija* ("seed") mantra is a one-syllable sound believed to hold special power. Each chakra's lotus has letters of the Devanagari alphabet on its petals, and one letter at its centre: its **bija akshara**. So a single letter is enough to identify a chakra, which Dvij and Bhavi turn to their advantage."""),
    "tattvas": dict(
        draft="11-periodic-table-of-the-tattvas.md",
        title="Tattvas and the Samkhya system", aliases=["tattva", "tattvas", "samkhya", "prakriti", "purusha"],
        summary="Samkhya's principles by which nature (prakriti) unfolds into mind, senses and the elements, and the 'periodic table' that maps each to a letter.",
        related=["kanchukas", "chakras", "bija-mantras"], images=["codex-hierarchy"], source="endnote-11",
        intro="""**Samkhya**, one of the oldest schools of Indian philosophy, describes two realities: *purusha* (pure consciousness) and *prakriti* (nature). In the round-nosed man's words, the energies latent in prakriti "manifest themselves in stages of evolution… Out of this process evolve the 24 principles." These principles, or **tattvas**, run from cosmic intelligence and ego to mind, the senses, the organs of action, and the subtle and gross elements.

The "Periodic Table of the Tattvas" below assigns each tattva a letter of the Devanagari alphabet.

**From the book's notes:**"""),
    "navagrahas": dict(
        draft="12-navagrahas-and-navratnas.md", keep_first=True,
        title="Navagrahas and Navratnas", aliases=["navagraha", "navagrahas", "navratna", "navratnas", "navaratnas"],
        summary="The nine 'planets' of Indian astrology, and the nine gems associated with them.",
        related=["nakshatras", "dikpalas", "vaastu-purusha-mandala"], images=[], source="endnote-12",
        intro="""The **navagrahas** are the nine celestial influences of *jyotisha*: the Sun, the Moon, Mars, Mercury (Budha), Jupiter, Venus, Saturn, and the lunar nodes Rahu and Ketu. Each is paired with one of the **navaratnas**, nine gems, and each presides over a direction.

At the valley's ground-breaking ceremony, the navaratnas are placed in the golden kalasha to appease the nine lords.

**From the book's notes:**"""),
    "gnomon": dict(
        draft="13-gnomon.md",
        title="Gnomon", aliases=["gnomon"],
        summary="A stick, a rope and two shadows: the ancient way to find true north.",
        related=["vaastu-purusha-mandala", "dikpalas"], images=["codex-gnomon"], source="endnote-13",
        intro="""A **gnomon** is simply a vertical stick whose shadow tells direction and time. Dvij's method needs only "a couple of sticks and a rope":

1. Drive a long stick upright into level ground and draw a circle around it with a rope.
2. Mark where the stick's shadow meets the circle at dusk, and again at dawn. These two points lie east and west.
3. From each mark, swing an arc with the rope. A line through the two points where the arcs cross runs exactly north–south.

Temple builders used the same method to orient sacred buildings to the cardinal directions."""),
}

CORE = {
    "kundalini": dict(
        title="Kundalini", aliases=["kundalini"], source="manuscript", related=["chakras", "kaula", "shaivite-renunciation"], images=[],
        summary="The energy said to lie coiled at the base of the spine. As it rises through the chakras, a person moves closer to God.",
        body="""\"First you must understand Kundalini,\" the tantric baba tells Dvij: \"the source of energy that lies sleeping at the base of the spine of ordinary mortals… As Kundalini moves up these levels, called chakras, you as a person move closer to God.\"

In yogic and tantric thought, **kundalini** is pictured as a serpent coiled at the *muladhara*, the lowest chakra. Practice, discipline or grace awakens it, and it climbs chakra by chakra toward the crown. Beyond the body, some traditions describe further centres above the head.

Only "the blessed few," the book says, ever experience its rising."""),
    "mahavidyas": dict(
        title="Mahavidyas", aliases=["mahavidya", "mahavidyas"], source="manuscript", related=["ashtalakshmi", "matrikas"], images=[],
        summary="Ten wisdom goddesses of the Shakta tradition, from the beautiful Shodashi to the self-decapitating Chhinnamasta.",
        body="""The ten **Mahavidyas** ("great wisdoms") are forms of the Goddess worshipped in the Shakta and tantric traditions: Kali, Tara, Tripura Sundari (Shodashi), Bhuvaneshvari, Bhairavi, Chhinnamasta, Dhumavati, Bagalamukhi, Matangi and Kamala. Some are ravishing, others terrifying. Together they represent every face of the divine feminine.

In the valley, the Mahavidya temples are a close-knit cluster of ten plain structures around a sacred grove. Their walls are bright with goddesses and yantras, centred on the Sri Chakra. Their head pujari is a reticent man who "rarely steps out of his chambers.\""""),
    "matrikas": dict(
        title="Saptamatrikas and Ashtamatrikas", source="manuscript", related=["mahavidyas", "ashtalakshmi", "dikpalas"], images=[],
        aliases=["saptamatrika", "saptamatrikas", "ashtamatrika", "ashtamatrikas", "matrikas"],
        summary="The mother goddesses: seven in the Puranas, eight when Yogeshwari is added, both benevolent mothers and fierce destroyers.",
        body="""The **Saptamatrikas**, the seven mothers, are Brahmani, Vaishnavi, Maheshwari, Kaumari, Varahi, Indrani and Chamunda. Each is the power (*shakti*) of a god. In the Puranas they emerge during a fierce battle, and they can be "benevolent mothers and equally malefic destroyers."

The *Varaha Purana* adds an eighth, Yogeshwari, making the **Ashtamatrikas**, and says they represent eight vices, among them desire (*kama*), anger (*krodha*) and greed (*lobha*).

The very first artefact the Professor shows Dvij is a damaged figure of **Varahi**, "pot bellied, for she holds in her womb the universe.\""""),
    "kaula": dict(
        title="Kaula and the left-hand path", source="manuscript", related=["kundalini", "shaivite-renunciation", "chakras"], images=[],
        aliases=["kaula", "vamachara", "vamachar", "left path", "panchamakara", "panchmakara", "panchmakaras"],
        summary="The secret \"left-hand path\" of tantra, whose rites use the five forbidden things (panchamakara).",
        body="""The **Kaula** traditions follow *vamachara*, the "left-hand path" of tantra, which seeks liberation through the body rather than by denying it. Its rites use the **panchamakara**, the five "M"s that orthodox practice forbids: *madya* (wine), *mamsa* (meat), *matsya* (fish), *mudra* (parched grain, or gesture) and *maithuna* (union).

"Knowledge that hides in the darkness," the tantric baba calls it. Such practices "are secretly followed even by those who pretend to be most orthodox," but they "fail to reach elevated levels, for what they seek is pleasure and not knowledge.\""""),
    "charvaka": dict(
        title="Charvaka", source="manuscript", aliases=["charvaka", "lokayata", "lokayukta"], related=["ashtadhyayi"], images=[],
        summary="Ancient Indian materialism: no afterlife, no gods, and no patience for ritual. Its texts were long thought lost.",
        body="""**Charvaka**, also called *Lokayata*, was a school of materialist philosophy that accepted only what can be perceived. It rejected the afterlife, the authority of the Vedas and the value of ritual. The Professor relishes its bluntness: Charvaka called the grand *ashvamedha* horse sacrifice "a work of fools."

Its followers were ostracised and its works, the world believes, destroyed. Almost everything known about Charvaka comes from its opponents' attempts to refute it. The Professor believes otherwise: "They managed to preserve his texts.\""""),
    "soma": dict(
        title="Soma", source="manuscript", aliases=["soma"], related=["kaula"], images=[],
        summary="The sacred drink of the Rig Veda, and the name of the valley's friendliest tribe, who still perform its ancient ritual.",
        body="""**Soma** is both a god and a drink in the *Rig Veda*, whose entire ninth book is devoted to it. The pressed juice of a plant, it was offered to the gods and drunk by priests for its exhilarating power. Which plant it was has never been settled.

In the valley, the **Soma** are also a forest tribe, "the friendliest flock of people in the valley." They still perform a Vedic-age Soma ritual that has died out everywhere else, in which the shaman is believed to receive the Soma god in trance, and which they see as a re-creation of the universe."""),
    "harihara": dict(
        title="Harihara", source="manuscript", aliases=["harihara"], related=[], images=[],
        summary="Vishnu (Hari) and Shiva (Hara) united in one figure, split down the middle.",
        body="""**Harihara** is a combined form of Vishnu and Shiva: "Hari for Vishnu and Hara for Shiva." Sculptures show one half with Vishnu's crown and emblems and the other with Shiva's matted hair and trident, a statement that the two great gods are one.

Some of the earliest Harihara reliefs are in the 6th-century cave temples at Badami. In the valley, Kurup has seen a rock-cut Harihara near Vidgati's shrine on Mount Dronagiri."""),
    "bacteriophages": dict(
        title="Bacteriophages and healing rivers", source="manuscript", aliases=["bacteriophage", "bacteriophages"], related=[], images=[],
        summary="Viruses that eat bacteria, and a scientific explanation for the healing reputation of rivers like the Ganga.",
        body="""**Bacteriophages** ("bacteria-eaters") are viruses that infect and destroy bacteria. In 1896 the British bacteriologist Ernest Hanbury Hankin reported that water from the Ganga and the Yamuna killed cholera bacteria. Two decades later Félix d'Herelle identified the agents responsible as viruses.

Dvij uses the idea to explain why bathing in the valley's river once healed people, and why it no longer does: something has killed the river's phages."""),
}


def frontmatter(e: dict, anchor: str = "") -> str:
    data = {k: e[k] for k in ("title", "aliases", "summary", "related", "images", "source")}
    if anchor:
        data["manuscriptAnchor"] = anchor
    return "---\n" + yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000) + "---\n\n"


def main() -> None:
    for slug, e in FROM_ENDNOTES.items():
        body, anchor = draft_parts(e["draft"], drop_first=not e.get("keep_first"))
        text = frontmatter(e, anchor) + e["intro"].strip() + ("\n\n" + body if body else "") + "\n"
        (CODEX / f"{slug}.md").write_text(text, encoding="utf-8")
    for slug, e in CORE.items():
        (CODEX / f"{slug}.md").write_text(frontmatter(e) + e["body"].strip() + "\n", encoding="utf-8")
    print(f"{len(FROM_ENDNOTES) + len(CORE)} entries written to {CODEX}")


if __name__ == "__main__":
    main()
