"""Run the whole content pipeline in order (design §4, plan Phase 0).

Each step is idempotent; slow steps skip work that is already done.
Usage: python run_all.py [--from compress|render|variants|text|panels|chapters|art|endnotes|manifests|codex|bestiary|memory|places|places-link|parchment|companions|validate]
"""
import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
STEPS = [
    ("compress", [sys.executable, "compress.py"]),
    ("render", [sys.executable, "render_pages.py"]),
    ("variants", ["node", "make_variants.mjs"]),
    ("text", [sys.executable, "extract_text.py"]),
    ("panels", [sys.executable, "detect_panels.py"]),
    ("chapters", [sys.executable, "map_chapters.py"]),
    ("art", [sys.executable, "prepare_art.py"]),
    ("endnotes", [sys.executable, "extract_endnotes.py"]),
    ("manifests", [sys.executable, "build_manifests.py"]),
    ("codex", [sys.executable, "link_codex.py"]),
    ("bestiary", [sys.executable, "link_bestiary.py"]),
    ("memory", [sys.executable, "link_memory.py"]),
    ("places", [sys.executable, "fetch_real_india.py"]),
    ("places-link", [sys.executable, "link_places.py"]),
    ("parchment", [sys.executable, "link_parchment.py"]),
    ("companions", [sys.executable, "link_companions.py"]),
    ("validate", [sys.executable, "validate_content.py"]),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", choices=[s for s, _ in STEPS], default="compress")
    args = ap.parse_args()
    names = [s for s, _ in STEPS]
    for name, cmd in STEPS[names.index(args.start):]:
        print(f"\n=== {name} ===", flush=True)
        if subprocess.run(cmd, cwd=HERE).returncode != 0:
            sys.exit(f"step '{name}' failed")


if __name__ == "__main__":
    main()
