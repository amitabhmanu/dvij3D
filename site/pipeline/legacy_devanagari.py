"""Decode legacy Devanagari font bytes to Unicode.

The manuscript's endnote tables carry their Devanagari in the "Webdunia" font:
an 8-bit font where each Latin byte draws a Devanagari glyph. Word stores the
bytes, not the letters, so extracting the text without looking at the run's font
yields mojibake - the tattva table came out as "f, F, d, D, E" and the chakra
bija column as "jk, Jk, hk". The font is neither installed nor embedded in the
docx, so the mapping below was recovered rather than read off a cmap.

HOW THE MAPPING WAS ESTABLISHED

Anchors, read off the book's own printed art. images/artifacts/tattvas.jpg draws
the chakra column with its bija in each lotus; bottom to top it reads

    लं  वं  रं  यं  हं   (and ॐ at ajna)

against the manuscript's

    jk  Jk  hk  gk  nk  (Qpk)

which fixes k = anusvara and g J h j n = य व र ल ह. Those five are VERIFIED:
they are read from the printed page, not inferred.

The manuscript's own prose confirms three of these independently. Book 4 has
"Look for kaala. There, you can see...it is mapped to the letter व", and the
table's kanchuka of Time - kaala - is J; "See if व is the bija akshara of any
of the chakras" agrees with Jk reading वं at svadhishthana. A third passage,
"the consonants of our alphabets are grouped into seven vargas - the म varga,
the त varga and so on", carries b and ;, and both land on letters that do name
a varga. That last pair was derived rather than read, so the prose is what
promotes it.

Structure, from the endnote's own table. "The Periodic Table of the Tattvas"
lays the 36 tattvas over the matrika in the canonical order - the five pentads
onto the five vargas, the kanchukas onto the semivowels, the shuddha-tattvas
onto the sibilants:

    mahabhutas    क ख ग घ ङ        karmendriyas  ट ठ ड ढ ण
    tanmatras     च छ ज झ ञ        jnanendriyas  त थ द ध न
    antahkarana   प फ ब भ म        kanchukas     य र ल व
    shuddha       श ष स ह क्ष

The five verified bytes fall exactly where that scheme predicts: g h j J are
the kanchuka row in the order य र ल व, and n is the fourth shuddha cell, which
is ह. Two independent confirmations of one structure, so the remaining cells
are filled from it and marked DERIVED. They are consistent with the font's own
shift pairing - f/F, d/D, a/A, s/S, x/X, z/Z, v/V, c/C each give consecutive
letters of a varga - but they are reconstruction, not decipherment.

Anything outside this table is left alone and reported by decode(), so a byte
this mapping has never seen can never be silently passed through as Latin.
"""

# Byte sequence -> Unicode. Longest key wins, so multi-byte glyphs come out
# whole. "V" marks a reading verified against the printed art (see above).
WEBDUNIA: dict[str, str] = {
    # --- verified against images/artifacts/tattvas.jpg ---
    "k": "ं",          # V  anusvara
    "g": "य",          # V  ya
    "h": "र",          # V  ra
    "j": "ल",          # V  la
    "J": "व",          # V  va
    "n": "ह",          # V  ha
    # Ajna's cell, mapped whole. The art shows a plain ॐ in that lotus, so what
    # is verified is the cell, not a split into Qp + k; decoding it as om plus
    # an anusvara would put a mark there the printed page does not have.
    "Qpk": "ॐ",        # V  om
    # --- confirmed by the manuscript's prose ("the म varga, the त varga") ---
    ";": "त",         # V  ta
    "b": "म",         # V  ma
    # --- derived from the varga scheme ---
    "f": "क", "F": "ख", "d": "ग", "D": "घ", "E": "ङ",
    "a": "च", "A": "छ", "s": "ज", "S": "झ", "@": "ञ",
    "x": "ट", "X": "ठ", "z": "ड", "Z": "ढ", "K": "ण",
    ":": "थ", "=": "द", '"': "ध", "l": "न",
    "v": "प", "V": "फ", "c": "ब", "C": "भ",
    "N": "श", "M": "ष", "m": "स",
    "G": "क्ष",  # ksha
}

# Bytes that are punctuation in the source and mean themselves.
PASSTHROUGH = set("-–— ")

_MAXLEN = max(len(k) for k in WEBDUNIA)


def decode(text: str) -> tuple[str, list[str]]:
    """Return (decoded text, list of bytes with no mapping).

    Unmapped bytes are kept verbatim so the caller can see and report them;
    they are never quietly dropped or emitted as though they were letters.
    """
    out: list[str] = []
    unknown: list[str] = []
    i = 0
    while i < len(text):
        for size in range(min(_MAXLEN, len(text) - i), 0, -1):
            chunk = text[i:i + size]
            if chunk in WEBDUNIA:
                out.append(WEBDUNIA[chunk])
                i += size
                break
        else:
            ch = text[i]
            out.append(ch)
            if ch not in PASSTHROUGH:
                unknown.append(ch)
            i += 1
    return "".join(out), unknown


# Fonts whose bytes must go through decode(). Matched case-insensitively
# against the run's ascii/hAnsi/cs font name.
LEGACY_FONTS = {"webdunia"}

# Legacy Devanagari fonts in this manuscript that have no mapping yet. Their
# bytes are NOT sent through decode() - the tables above are Webdunia's and
# would mis-read them - but a caller can ask, so the runs get reported rather
# than passed off as text. Pooja carries the nakshatra syllables in the body
# ("Her sounds are ली लू ले लो", stored as yh yw ys iks); the same syllables are
# pictures in the Nakshatras endnote, which is where a mapping could be
# anchored if one is ever wanted.
UNMAPPED_LEGACY_FONTS = {"pooja"}


def _name(font: str | None) -> str:
    return font.strip().lower() if font else ""


def is_legacy(font: str | None) -> bool:
    return _name(font) in LEGACY_FONTS


def is_unmapped_legacy(font: str | None) -> bool:
    return _name(font) in UNMAPPED_LEGACY_FONTS
