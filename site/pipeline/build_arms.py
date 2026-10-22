"""Dvij's first-person arms (design §10.4), cut from his own MakeHuman body (PEOPLE["dvij"] in build_people.py),
so they match the Dvij seen in the study's window: his skin and hands, "an oversize gown" whose sleeves fall below
the elbow (novel ¶98), and his right arm "covered in a plaster from beyond the elbow" (¶96; right, the author,
21 Oct). Built by blender/build_human.py in its arms-only mode: only what the arm bones move is kept, on the same
skeleton (upperarm_l, lowerarm_l, hand_l and the fingers), which walk/arms.ts bends by IK.

Inputs:  as build_people.py (MPFB, MakeHuman's system assets; see its docstring)
Output:  site-assets/walk/arms.<hash>.glb, src/content/generated/arms.json, and the credits
Usage:   python build_arms.py
"""
import json

from build_people import MH_ZIP, MPFB_ZIP, OUT, SITE, blender_with_mpfb, build, credit


def main() -> None:
    for need in (MPFB_ZIP, MH_ZIP):
        if not need.exists():
            raise SystemExit(f"{need} is missing (see build_people.py's docstring for where it comes from)")
    name = build("dvij", blender_with_mpfb(), extra={"arms_only": True}, stem="arms")
    data = (OUT / name).read_bytes()
    (SITE / "src" / "content" / "generated" / "arms.json").write_text(json.dumps({"file": name, "bytes": len(data)}, indent=1) + "\n", encoding="utf-8")
    credit()
    print(f"Arms {name} ({len(data) // 1024} KB)")


if __name__ == "__main__":
    main()
