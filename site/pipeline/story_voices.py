#!/usr/bin/env python3
"""Story mode's voices (design §10.4): every spoken line, in its character's fixed voice.

Made on this computer with Indic Parler-TTS, the way the Institute of
Idiosyncrasies comic's voices were made (IofIa2/animation/voicegen/make_voices.py):
each character is one of the model's named speakers, a description of how they
speak and a seed (src/content/story/voices.yaml), so a voice is the same in every
line and every chapter.

Inputs:  src/content/generated/story.json (from story_scenes.py), src/content/story/voices.yaml
Outputs: ../site-assets/story/voices/<who>-<hash>.mp3 (one per line, named by its
         text and voice, so a changed line or voice is remade and nothing else is),
         src/content/generated/story-voices.json ({"who|line": {file, seconds}})

usage:
  python pipeline/story_voices.py                  every line that has no clip yet
  python pipeline/story_voices.py --who maharaj --redo
  python pipeline/story_voices.py --audition       each candidate voice in voices.yaml saying its line,
                                                   to pipeline/.cache/auditions/ (not shipped)
Model and tokenizer folders default to the ones the IofI voices used.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import yaml

SITE = Path(__file__).resolve().parent.parent
STORY = SITE / "src" / "content" / "generated" / "story.json"
VOICES = SITE / "src" / "content" / "story" / "voices.yaml"
OUT = SITE.parent / "site-assets" / "story" / "voices"
INDEX = SITE / "src" / "content" / "generated" / "story-voices.json"
CACHE = SITE / "pipeline" / ".cache"
MODEL = Path.home() / "indic-parler-tts"
TOKENIZER = Path.home() / "flan-t5-large"


def spoken_lines(story: dict) -> list[tuple[str, str]]:
    """Every (who, line) the scenes say, in order, once each."""
    seen, out = set(), []

    def walk(o):
        if isinstance(o, dict):
            if "say" in o and isinstance(o["say"], dict):
                k = (o["say"]["who"], o["say"]["line"])
                if k not in seen:
                    seen.add(k)
                    out.append(k)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(story["scenes"])
    # and the scenes Dvij isn't in that another person's film plays (pov.yaml's films: Ch 2, the Professor's)
    filmed = {s for f in story.get("pov", {}).get("films", {}).values() for s in f.get("scenes", [])}
    walk([sc for sc in story.get("offstage", []) if sc["scene"] in filmed])
    return out


def voice_of(cast: dict, who: str) -> dict:
    v = cast["characters"][who]["voice"]
    return {"seed": int(v["seed"]), "description": f"{v['description']} {cast['tail']}"}


def clip_name(who: str, line: str, voice: dict) -> str:
    h = hashlib.sha1(json.dumps([line, voice], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]
    return f"{who}-{h}.mp3"


def tidy(audio: np.ndarray, sr: int) -> np.ndarray:
    """Trim the silence at either end (keeping a breath), and bring every line to one loudness."""
    a = audio.astype(np.float32)
    win = max(1, sr // 50)
    env = np.sqrt(np.convolve(a * a, np.ones(win) / win, mode="same"))
    loud = np.nonzero(env > max(env.max() * 0.04, 1e-4))[0]
    if len(loud):
        a = a[max(0, loud[0] - sr // 20): loud[-1] + sr // 8]
    rms = np.sqrt(np.mean(a * a)) or 1.0
    a = a * min(0.1 / rms, 0.95 / (np.abs(a).max() or 1.0))
    return a


def write_mp3(audio: np.ndarray, sr: int, path: Path) -> float:
    import soundfile as sf
    path.parent.mkdir(parents=True, exist_ok=True)
    a = tidy(audio, sr)
    sf.write(str(path), a, sr, format="MP3", subtype="MPEG_LAYER_III", compression_level=0.6)
    return round(len(a) / sr, 2)


def loader(model: Path, tokenizer: Path):
    """Load the model once; return say(text, voice) -> (audio, sample rate). As make_voices.py does."""
    print("Loading Indic Parler-TTS (the first load takes a minute)...")
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    dev = "cuda:0" if torch.cuda.is_available() else "cpu"
    m = ParlerTTSForConditionalGeneration.from_pretrained(str(model)).to(dev)
    tok = AutoTokenizer.from_pretrained(str(model))
    dtok = AutoTokenizer.from_pretrained(str(tokenizer))
    sr = m.config.sampling_rate
    print(f"Running on {dev}.")

    def say(text: str, voice: dict):
        torch.manual_seed(int(voice["seed"]))
        d = dtok(voice["description"], return_tensors="pt").to(dev)
        p = tok(text, return_tensors="pt").to(dev)
        with torch.no_grad():
            gen = m.generate(input_ids=d.input_ids, attention_mask=d.attention_mask,
                             prompt_input_ids=p.input_ids, prompt_attention_mask=p.attention_mask)
        return gen.cpu().float().numpy().squeeze(), sr
    return say


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=str(MODEL))
    ap.add_argument("--tokenizer", default=str(TOKENIZER))
    ap.add_argument("--who", default="", help="comma-separated characters (default: all)")
    ap.add_argument("--redo", action="store_true", help="remake clips that already exist")
    ap.add_argument("--audition", action="store_true", help="render the candidate voices in voices.yaml instead")
    ap.add_argument("--limit", type=int, default=0, help="make at most this many clips (0: all)")
    a = ap.parse_args()
    cast = yaml.safe_load(VOICES.read_text(encoding="utf-8"))
    who = {w.strip() for w in a.who.split(",") if w.strip()}

    if a.audition:
        out = CACHE / "auditions"
        jobs = []
        for ch, c in cast["characters"].items():
            if who and ch not in who:
                continue
            for cand in c["candidates"]:
                name = out / f"{ch}-{cand['speaker'].lower()}.mp3"
                if not name.exists() or a.redo:
                    jobs.append((name, c["line"], {"seed": int(cand["seed"]), "description": f"{cand['description']} {cast['tail']}"}))
        if not jobs:
            print("Nothing to do: every audition exists (use --redo to remake).")
            return
        say = loader(Path(a.model), Path(a.tokenizer))
        for i, (name, line, voice) in enumerate(jobs, 1):
            t0 = time.time()
            audio, sr = say(line, voice)
            secs = write_mp3(audio, sr, name)
            print(f"[{i}/{len(jobs)}] {name.name}  {secs:.1f} s of speech in {time.time() - t0:.0f} s")
        print(f"Auditions are in {out}.")
        return

    story = json.loads(STORY.read_text(encoding="utf-8"))
    lines = spoken_lines(story)
    index = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {"lines": {}}
    wanted, jobs = {}, []
    unvoiced = sorted({w for w, _ in lines if w not in cast["characters"]})
    if unvoiced:
        print(f"No voice in voices.yaml yet for {', '.join(unvoiced)}: their lines stay captions only.")
    for w, line in lines:
        if w in unvoiced:
            continue
        voice = voice_of(cast, w)
        name = clip_name(w, line, voice)
        key = f"{w}|{line}"
        wanted[key] = name
        have = index["lines"].get(key)
        if (who and w not in who) or (have and have["file"] == name and (OUT / name).exists() and not a.redo):
            continue
        jobs.append((key, w, line, voice, name))
    if a.limit:
        jobs = jobs[: a.limit]
    if jobs:
        say = loader(Path(a.model), Path(a.tokenizer))
        print(f"{len(jobs)} lines to speak.")
        for i, (key, w, line, voice, name) in enumerate(jobs, 1):
            t0 = time.time()
            audio, sr = say(line, voice)
            secs = write_mp3(audio, sr, OUT / name)
            index["lines"][key] = {"file": name, "seconds": secs}
            INDEX.write_text(json.dumps(index, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
            print(f"[{i}/{len(jobs)}] {name}  {secs:.1f} s of speech in {time.time() - t0:.0f} s")
    # Forget lines the scripts no longer say, and their clips.
    index["lines"] = {k: v for k, v in index["lines"].items() if wanted.get(k) == v["file"]}
    INDEX.write_text(json.dumps(index, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    keep = {v["file"] for v in index["lines"].values()}
    for f in OUT.glob("*.mp3") if OUT.exists() else []:
        if f.name not in keep:
            f.unlink()
    print(f"{len(index['lines'])} of {len(lines)} lines have a voice -> {INDEX.relative_to(SITE)}")


if __name__ == "__main__":
    main()
