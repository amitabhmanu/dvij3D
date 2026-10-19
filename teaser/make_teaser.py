"""Build the LinkedIn teaser (square MP4 + GIF) from finished comic panels."""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), "..", "site-assets")
OUT = os.path.dirname(__file__)
S = 1080
F_CAP = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", 58)
F_TITLE = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", 112)
F_SUB = ImageFont.truetype("C:/Windows/Fonts/georgiai.ttf", 46)
PANELS = json.load(open(os.path.join(ROOT, "data/panels.json")))

# (page, panel index, (top, bottom) trim to drop the book's own text boxes, vertical focus, caption)
SHOTS = [
    ("b1-p002", 0, (0, 0.22), 0.3, "A dark mountain road..."),
    ("b1-p002", 4, (0, 0), 0.5, "One rock. One crash."),
    ("b1-p004", 8, (0, 0.2), 0.3, "He wakes with no memory."),
    ("b1-p014", 3, (0.12, 0.14), 0.3, "A priest who saw him coming."),
    ("b1-p013", 0, (0, 0.1), 0.3, "A healer who doesn't trust him."),
    ("art", "parchment.webp", (0, 0), 0.5, "And a riddle to crack."),
    ("b1-p015", 8, (0, 0.22), 0.5, "Five books. One valley."),
]

def panel(page, idx):
    if page == "art":
        return Image.open(os.path.join(ROOT, "art", idx)).convert("RGB")
    im = Image.open(os.path.join(ROOT, "master", page + ".png")).convert("RGB")
    w, h = im.size
    b = PANELS[page][idx]
    return im.crop((int(b[0]*w), int(b[1]*h), int(b[2]*w), int(b[3]*h)))

def trim(im, t):
    w, h = im.size
    return im.crop((0, int(h * t[0]), w, int(h * (1 - t[1]))))

def square(im, focus):
    w, h = im.size
    s = min(w, h)
    x = (w - s) // 2
    y = int((h - s) * focus)
    return im.crop((x, y, x + s, y + s)).resize((S, S), Image.LANCZOS)

def caption(im, text):
    im = im.copy()
    # dark gradient at the bottom so the text reads on any panel
    grad = Image.new("L", (1, 320))
    for i in range(320):
        grad.putpixel((0, i), int(220 * (i / 319) ** 1.4))
    shade = Image.new("RGB", (S, 320), (12, 8, 4))
    im.paste(shade, (0, S - 320), grad.resize((S, 320)))
    d = ImageDraw.Draw(im)
    tw = d.textlength(text, font=F_CAP)
    d.text(((S - tw) / 2, S - 140), text, font=F_CAP, fill=(246, 226, 180),
           stroke_width=3, stroke_fill=(20, 12, 4))
    return im

def title_card():
    bg = square(panel("art", "parchment.webp"), 0.5).filter(ImageFilter.GaussianBlur(6))
    bg = Image.blend(bg, Image.new("RGB", (S, S), (20, 12, 4)), 0.62)
    d = ImageDraw.Draw(bg)
    def center(t, f, y, fill):
        d.text(((S - d.textlength(t, font=f)) / 2, y), t, font=f, fill=fill,
               stroke_width=3, stroke_fill=(10, 6, 2))
    center("Who is Dvij?", F_SUB, 300, (230, 205, 160))
    center("THE", F_SUB, 410, (246, 226, 180))
    center("TWICE BORN", F_TITLE, 470, (250, 214, 130))
    center("a graphic novel by Amitabh Manu", F_SUB, 640, (230, 205, 160))
    return bg

slides = [caption(square(trim(panel(p, i), tr), f), t) for p, i, tr, f, t in SHOTS] + [title_card()]

def frames(fps, hold, fade, zoom=0.04):
    """Slow push-in on each slide, crossfade between them."""
    out = []
    n_hold, n_fade = int(hold * fps), int(fade * fps)
    seq = []
    for k, sl in enumerate(slides):
        is_last = k == len(slides) - 1
        n = n_hold + (n_hold if is_last else 0)
        seq.append([kenburns(sl, j / max(n - 1, 1), zoom if not is_last else 0) for j in range(n)])
    for k, fs in enumerate(seq):
        out.extend(fs[:-n_fade] if k < len(seq) - 1 else fs)
        if k < len(seq) - 1:
            a, b = fs[-n_fade:], seq[k + 1][:n_fade]
            for j in range(n_fade):
                out.append(Image.blend(a[j], b[j], (j + 1) / (n_fade + 1)))
            seq[k + 1] = seq[k + 1][n_fade:]
    return out

def kenburns(im, t, zoom):
    if zoom == 0:
        return im
    z = 1 + zoom * t
    c = int(S / z)
    o = (S - c) // 2
    return im.crop((o, o, o + c, o + c)).resize((S, S), Image.BILINEAR)

# MP4, 1080x1080 @ 30fps
vid = frames(30, 2.2, 0.5)
path = os.path.join(OUT, "twice-born-teaser.mp4")
import imageio_ffmpeg
wr = imageio_ffmpeg.write_frames(path, (S, S), fps=30, codec="libx264", pix_fmt_out="yuv420p",
                                 quality=None, bitrate=None, macro_block_size=1, output_params=["-crf", "20", "-preset", "slow", "-movflags", "+faststart"])
wr.send(None)
for f in vid:
    wr.send(np.ascontiguousarray(np.asarray(f)))
wr.close()
print("mp4", len(vid), "frames")

# GIF, 540x540 @ 8fps, no push-in, one shared palette (keeps file small)
g = [f.resize((540, 540), Image.LANCZOS) for f in frames(8, 2.2, 0.5, zoom=0)]
strip = Image.new("RGB", (540 * len(slides), 540))
for k, sl in enumerate(slides):
    strip.paste(sl.resize((540, 540)), (540 * k, 0))
pal = strip.quantize(colors=128, method=Image.MEDIANCUT)
gq = [f.quantize(palette=pal, dither=Image.NONE) for f in g]
gp = os.path.join(OUT, "twice-born-teaser.gif")
gq[0].save(gp, save_all=True, append_images=gq[1:], duration=100, loop=0, optimize=True)
for k, s in enumerate(slides):
    s.resize((360, 360)).save(os.path.join(OUT, f"_slide{k}.jpg"))
print("gif", len(g), "frames")
