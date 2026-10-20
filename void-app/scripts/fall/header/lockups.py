"""THE header mark, seven ways: the Void Loading Lab design (the band, him falling, the sparkles, "Void Archive")
as a still lockup for the header. His pose is one of the Lab thumbnails, cut out as-is (cutout.py).
   py -3.12 lockups.py  ->  out/header-<n>.png at 3x (height 132 px = 44 pt) + out/all.png
Colours: LOADING_THEMES.dark in src/features/loading/arrivals.ts."""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
FONT = os.path.join(HERE, '..', '..', '..', 'assets', 'fonts', 'DMSerifDisplay-Italic.ttf')
PAGE, BAND, WORD = (4, 2, 12), (11, 6, 32), (201, 168, 76)
SPARK = [(201, 168, 76), (140, 115, 255)]
K = 4                      # supersample, then down to 3x
H = 44 * 3 * K             # canvas height: the header row, 44 pt
CHAR = [Image.open(os.path.join(OUT, f'char-{i}.png')).convert('RGBA') for i in (1, 2, 3, 4)]


def him(pose, height):
    c = CHAR[pose - 1]
    return c.resize((round(c.width * height / c.height), round(height)), Image.LANCZOS)


def band(w, h, r):
    """The band: flat band colour, a slight inset depth (the Lab's inset shadows)."""
    b = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    b.paste(BAND + (255,), (0, 0), m)
    sh = Image.new('L', (w, h), 0); ImageDraw.Draw(sh).rounded_rectangle([-20, 2 * K * 3, w + 20, h + 40], r, fill=255)
    sh = Image.eval(ImageChopsInvert(sh).filter(ImageFilter.GaussianBlur(7 * K)), lambda v: int(v * 0.45))
    dark = Image.new('RGBA', (w, h), (0, 0, 0, 255)); dark.putalpha(Image.composite(sh, Image.new('L', (w, h), 0), m))
    b.alpha_composite(dark)
    return b, m


def ImageChopsInvert(im):
    return Image.eval(im, lambda v: 255 - v)


def sparkles(img, cx, cy, sx, sy, n, seed, clip=None, size=1.0):
    """Gold and violet dots around (cx, cy), gaussian, glowing (additive on the dark)."""
    rnd = random.Random(seed)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for i in range(n):
        x, y = cx + rnd.gauss(0, sx), cy + rnd.gauss(0, sy)
        r = (rnd.uniform(1.2, 2.6) if i % 2 else rnd.uniform(0.9, 1.8)) * K * size
        col = SPARK[i % 2] + (int(255 * rnd.uniform(0.6, 1)),)
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    glow = layer.filter(ImageFilter.GaussianBlur(2.2 * K))
    for L in (glow, layer):
        if clip is not None:
            a = L.getchannel('A'); L.putalpha(Image.composite(a, Image.new('L', a.size, 0), clip))
        img.alpha_composite(L)


def word(img, text, x, y_base, px, anchor='ls'):
    f = ImageFont.truetype(FONT, int(px))
    ImageDraw.Draw(img).text((x, y_base), text, font=f, fill=WORD + (255,), anchor=anchor)
    return f.getlength(text)


def finish(img, n):
    out = img.resize((img.width // K, img.height // K), Image.LANCZOS)
    out.save(os.path.join(OUT, f'header-{n}.png'))
    return out


def v1():  # the loading screen in miniature: the band, the word on the left, him falling on the right
    W = 170 * 3 * K; img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bh = int(H * 0.82); b, m = band(W, bh, int(bh * 0.14)); y0 = (H - bh) // 2
    img.alpha_composite(b, (0, y0)); clip = Image.new('L', img.size, 0); clip.paste(m, (0, y0))
    c = him(1, bh * 0.96); cx = int(W * 0.8)
    sparkles(img, cx, H / 2, c.width * 0.5, bh * 0.3, 90, 1, clip)
    img.alpha_composite(c, (cx - c.width // 2, (H - c.height) // 2))
    word(img, 'Void Archive', int(W * 0.07), y0 + bh * 0.66, bh * 0.36)
    return finish(img, 1)


def v2():  # he falls out of the band: the band low, the word in it, his head and arms above it
    W = 170 * 3 * K; img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bh = int(H * 0.5); b, m = band(W, bh, int(bh * 0.2)); y0 = H - bh - int(H * 0.06)
    img.alpha_composite(b, (0, y0))
    c = him(1, H * 0.98); cx = int(W * 0.84)
    sparkles(img, cx, H * 0.45, c.width * 0.6, H * 0.28, 70, 2)
    img.alpha_composite(c, (cx - c.width // 2, 0))
    word(img, 'Void Archive', int(W * 0.06), y0 + bh * 0.72, bh * 0.56)
    return finish(img, 2)


def v3():  # no band: the word, and him drifting off its end through a trail of sparkles
    f = ImageFont.truetype(FONT, int(H * 0.42)); tw = f.getlength('Void Archive')
    W = int(tw + H * 0.95); img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    c = him(3, H * 0.95); cx = int(W - c.width * 0.55)
    sparkles(img, cx - c.width * 0.6, H * 0.55, c.width * 0.9, H * 0.22, 60, 3, size=0.9)
    img.alpha_composite(c, (cx - c.width // 2, (H - c.height) // 2))
    word(img, 'Void Archive', 0, H * 0.68, H * 0.42)
    return finish(img, 3)


def v4():  # a square band badge with him in it, the word beside
    f = ImageFont.truetype(FONT, int(H * 0.4)); tw = f.getlength('Void Archive')
    s = int(H * 0.9); W = int(s + H * 0.22 + tw); img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    b, m = band(s, s, int(s * 0.24)); y0 = (H - s) // 2
    img.alpha_composite(b, (0, y0)); clip = Image.new('L', img.size, 0); clip.paste(m, (0, y0))
    c = him(1, s * 0.92)
    sparkles(img, s / 2, H / 2, s * 0.28, s * 0.3, 60, 4, clip, 0.8)
    img.alpha_composite(c, (s // 2 - c.width // 2, (H - c.height) // 2))
    word(img, 'Void Archive', s + H * 0.22, H * 0.66, H * 0.4)
    return finish(img, 4)


def v5():  # he dives toward the V; the word sits low, he hangs over its start
    f = ImageFont.truetype(FONT, int(H * 0.44)); tw = f.getlength('Void Archive')
    c = him(2, H * 0.92); W = int(tw + c.width * 0.92); img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sparkles(img, c.width * 0.5, H * 0.4, c.width * 0.55, H * 0.25, 50, 5, size=0.9)
    img.alpha_composite(c, (0, (H - c.height) // 2))
    word(img, 'Void Archive', c.width * 0.92, H * 0.7, H * 0.44)
    return finish(img, 5)


def v6():  # the band as a full pill, the word only (owner, 2026-10-20: no character until pull to refresh)
    W = 166 * 3 * K; img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bh = int(H * 0.78); b, m = band(W, bh, bh // 2); y0 = (H - bh) // 2
    img.alpha_composite(b, (0, y0))
    cw = him(4, H * 0.98).width; cx = int(W - bh * 0.7)  # where he stood: the word keeps its place
    tw = ImageFont.truetype(FONT, int(bh * 0.4)).getlength('Void Archive')
    word(img, 'Void Archive', cx - cw * 0.95 - tw, y0 + bh * 0.66, bh * 0.4)
    return finish(img, 6)


def v7():  # two lines, "Void" over "Archive", him beside them in a slim band window
    fv = ImageFont.truetype(FONT, int(H * 0.4)); tw = fv.getlength('Archive')
    bw = int(H * 0.72); W = int(bw + H * 0.2 + tw); img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    b, m = band(bw, H, int(bw * 0.22)); img.alpha_composite(b, (0, 0)); clip = Image.new('L', img.size, 0); clip.paste(m, (0, 0))
    c = him(1, H * 0.94)
    sparkles(img, bw / 2, H / 2, bw * 0.3, H * 0.32, 55, 7, clip, 0.8)
    cl = Image.new('RGBA', img.size, (0, 0, 0, 0)); cl.alpha_composite(c, (bw // 2 - c.width // 2, (H - c.height) // 2))
    a = cl.getchannel('A'); cl.putalpha(Image.composite(a, Image.new('L', a.size, 0), clip)); img.alpha_composite(cl)
    x = bw + H * 0.2
    word(img, 'Void', x, H * 0.46, H * 0.4); word(img, 'Archive', x, H * 0.9, H * 0.4)
    return finish(img, 7)


outs = [v() for v in (v1, v2, v3, v4, v5, v6, v7)]
# review sheet: each one in a header row on the page colour, at 2x of the 3x files' point size
rowh = 44 * 3 + 40; sheet = Image.new('RGBA', (620, rowh * len(outs) + 20), PAGE + (255,))
d = ImageDraw.Draw(sheet)
for i, o in enumerate(outs):
    sheet.alpha_composite(o, ((620 - o.width) // 2, 20 + i * rowh))
    d.text((10, 20 + i * rowh), str(i + 1), fill=(120, 110, 150, 255))
sheet.save(os.path.join(OUT, 'all.png'))
print([o.size for o in outs])
