"""One-time authoring helper (Phase 4): write the Council of Voices entries
(src/content/voices/*.md). Re-running overwrites them, so edit the Markdown
directly afterwards.

Each figure's `quote` is one of their lines; `firstQuote` (optional) marks their
first appearance if that is earlier. `portrait` names a comic page and a phrase
from its lettering: the panel containing it becomes the figure's portrait
(link_companions.py). Overrides: `firstSeen: {book, page}` and
`portrait: {page, box: [x0, y0, x1, y1]}` for a hand-picked crop.
Usage: python author_voices.py
"""
import yaml

from common import SITE

OUT = SITE / "src" / "content" / "voices"

VOICES = {
    "mahant": dict(
        order=1, name="The Mahant", fullName="Mahapandit Sampoornand Swami", role="antagonist",
        tradition="Institutional Vedic-Puranic orthodoxy: prophecy, ritual and temple authority",
        setting="Sri Mukteshwar temple, the centre of culture in the valley",
        quote="I predicted the exact date of his arrival",
        portrait={"page": "b1-p006", "match": "predicted the exact date"},
        excerpt="Faith needs miracles. He is my miracle… In him they will believe. And through him, they will believe in me.",
        codex=["vaastu-purusha-mandala"],
        body="""Born into the family of pujaris that has headed the Sri Mukteshwar temple for generations, the Mahant has "a mastery over the scriptures" and an army of disciples. He predicted the arrival of a Wounded One with No Past who would become the valley's saviour. Then one fell into his lap.

He is not a teacher but the book's antagonist. In him, prophecy, ritual and the building of a temple become instruments of control: "The Wounded One with No Past will have to forget everything else and don a new avatar."

**How to read him:** as a portrait of how institutional religion can be weaponised, not as one more point of view."""),
    "mahavidya-pujari": dict(
        order=2, name="The head pujari of the Mahavidya temples", role="teacher",
        tradition="Shakta tantra: worship of the Devi in her ten Mahavidya forms",
        setting="A cluster of ten temples around a sacred grove, at the foot of Mount Dronagiri",
        quote="We have sought to be in your presence, O virtuous one",
        portrait={"page": "b4-p010", "match": "virtuous"},
        excerpt="Yes?",
        codex=["mahavidyas"],
        body="""A local man who has never left the valley, deeply religious and famously reticent. He "keeps to himself… rarely steps out of his chambers." His followers are a closely knit group who hold satsangs every morning and evening.

For the Shaktas, the Goddess is the ultimate reality. Dvij recalls a hymn attributed to Adi Shankara: "If Shiva is united with Shakti, He can create. If He is not united with Her, He cannot even stir."

He says almost nothing to Dvij. What passes between them, Dvij refuses to tell Bhavi."""),
    "tantric-baba": dict(
        order=3, name="The tantric baba", fullName="Keshav Bharan, the aghori of the Kaal Bhairava temple", role="teacher",
        tradition="Aghora and tantra, Bhairava Shaivism",
        setting="His ashram in the Kaal Bhairava temple, beside the Bhootnath taal",
        quote="Knowledge that hides in the darkness",
        firstQuote="Kaal Bhairava temple is the abode of Keshav Bharan",
        portrait={"page": "b1-p040", "match": "darkness"},
        excerpt="Knowledge that hides in the darkness… they fail to reach elevated levels, for what they seek is pleasure and not knowledge.",
        codex=["kaula", "kundalini", "shaivite-renunciation"],
        body="""A disciple of Aghori Satyendranath, "the supreme exponent of aghora knowledge and arts," he keeps his dhuni burning in the temple the valley fears most.

He is the one who teaches Dvij about kundalini, the energy sleeping at the base of the spine, which must be woken and made to rise through the chakras "to reach God." That teaching becomes the thread of Dvij's whole ascent. He defends the Kaula rites against those who misunderstand them, and describes the three stages of Shaivite renunciation, ending in the cremation ground."""),
    "round-nosed-man": dict(
        order=4, name="The round-nosed man", role="guide",
        tradition="Samkhya philosophy, Vedic history, and the Charvakas' love of life",
        setting="Vidgati's shrine, half way up Mount Dronagiri",
        quote="While life is yours, live joyously",
        portrait={"page": "b4-p022", "match": "live joyously"},
        excerpt="While life is yours, live joyously.",
        codex=["tattvas", "kanchukas", "matrikas", "charvaka"],
        body="""Never named, only described. An attendant at the Charvaka shrine who hosts Dvij and Bhavi for a feast and stays to talk.

He explains the Samkhya school: how the energies latent in Prakriti unfold "in stages of evolution" into the 24 principles. He knows the Saptamatrikas and Ashtamatrikas. He recognises a Vedic altar in Bhavi's drawing, and mentions, to their surprise, that "Charvaka promoted learning of philosophies from across the globe." Twice in two days he shows them the way."""),
    "vedic-sage": dict(
        order=5, name="The sage of the Vedic ashram", role="teacher",
        tradition="Vedic ritualism and the Upanishads",
        setting="The ashram of Kritya Rishi, near the top of Mount Dronagiri",
        quote="This ashram is like an island of purity that floats in a boundless ocean of corruption",
        portrait={"page": "b5-p010", "match": "apaurusheya"},
        excerpt="In the end, you are one with Brahman, which is the ultimate reality… That day you shall exclaim 'Aham Brahmasmi'.",
        codex=["navagrahas"],
        body="""The ashram is "the only place… where Vedic vidhis are practised faithfully even to this day." Its sage calls it "an island of purity that floats in a boundless ocean of corruption."

In one afternoon he takes Dvij through the Vedas as *apaurusheya*, eternal and received by the rishis; the doctrine of re-death; and the ashvamedha read as a sacrifice of worldly comforts rather than of an animal. He ends with Uddalaka's lesson to Svetaketu, salt dissolved in water: Brahman can be experienced but not seen. "That you are!"

For the first time, Dvij says he means it when he calls himself a seeker."""),
    "the-monk": dict(
        order=6, name="The monk under the tree", role="teacher",
        tradition="Advaita-flavoured renunciation: the Truth is already within",
        setting="Beneath a spreading tree beside a small Hanuman temple, high on Mount Dronagiri",
        quote="You seek the Absolute Truth. And yet you do not know that you possess it",
        portrait={"page": "b5-p021", "match": "Absolute Truth"},
        excerpt="You seek the Absolute Truth. And yet you do not know that you possess it… You have to look within.",
        codex=["kundalini"],
        body="""He calls Dvij out before Dvij has said a word: "Do not attempt to hide from yourself."

His teaching is the shortest in the book, and the one that fits Dvij best: "The trappings of existence make a man forget the Truth, just like an accident makes the same man forget his past." Once a wandering monk who renounced everything, "even the hollow shell… called the body," he now offers only directions: "You have to look within." """),
    "yogini": dict(
        order=7, name="Yogini", role="guide",
        tradition="The forest's own, liminal and tribal. Never explained.",
        setting="The forests and edges of the valley, then the trek",
        quote="an immaculate incarnation of Tripura Sundari",
        firstQuote="Baba gestured for the yogini to enter the room which she did with reverence",
        portrait={"page": "b3-p032", "match": "Tripura Sundari"},
        excerpt="(She speaks only in her own tribal language.)",
        codex=["mahavidyas"],
        body="""She appears and disappears as she pleases, fierce one moment and a "mute follower" the next, always with a dog at her feet. The Professor would call her "an immaculate incarnation of Tripura Sundari."

She teaches nothing in words. She fights for them, twice pulls Dvij up by the aerial roots of a tree, and one morning simply goes back where she came from, leaving her dog to follow Dvij."""),
    "the-professor": dict(
        order=8, name="The Professor", fullName="Dr Vidyasagar Parthasarathi", role="survey",
        tradition="A scholar of all of them: the valley's field guide",
        setting="The lodge, its study, and every temple in the valley",
        quote="is a replica of the entire universe",
        firstQuote="The professor paused and shifted his weight over to the other leg",
        portrait={"page": "b4-p004", "match": "Charvaka"},
        excerpt="This very valley of ours, which in its microcosm… is a replica of the entire universe. As such, it could have been anywhere.",
        codex=["charvaka", "vaastu-purusha-mandala"],
        body="""The Professor maps the valley's faiths for Dvij:

- Vaishnavism in the southern plains, and Shaivites "flitting in and out as per their whimsies".
- Shaktas in the uneven north, with tantrics around the Bhootnath temple.
- Nagas worshipping Dhumavati in the forest beyond it.
- A Hanuman shrine atop the Gaumukh hill, with Ram temples at its base.
- On Dronagiri, the Somasuras, the Charvaka shrine of Vidgati and a Vedic ashram.
- Monks of the Anant Path, jatadharis, "and the occasional heretic."

"Religious thought preserved at possibly every stage of its development." That is why the valley could have been anywhere, and why, forgotten by the world, "it is nowhere."

He is also secretly hunting the Charvakas' lost texts."""),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for vid, v in VOICES.items():
        body = v.pop("body")
        front = yaml.safe_dump(v, allow_unicode=True, sort_keys=False, width=1000)
        (OUT / f"{vid}.md").write_text(f"---\n{front}---\n\n{body.strip()}\n", encoding="utf-8")
    print(f"{len(VOICES)} voices written to {OUT}")


if __name__ == "__main__":
    main()
