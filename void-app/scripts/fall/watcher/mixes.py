"""The WACTHER mark (watcher.svg) in every app theme's colours + the plain app-icon looks.
   py -3.12 mixes.py  ->  mixes/<name>.svg + .png (1024 square, full bleed) + mixes/overview.png
Colours: src/theme/palettes.ts (bg, white = text, gold, purple = accent)."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'mixes')
BROWS = [[(11.2, 71.9), (14.9, 78.3), (74.6, 101.4), (89.9, 92.3), (86.3, 85.9), (27, 62.1)],
         [(186.5, 59.3), (125.1, 83.6), (121.9, 89.1), (121.2, 105.2), (182.3, 81.5), (185.4, 76.1)]]
EYES = [(58.4, 115.2, 29.2, 30.8), (146.2, 115.9, 29.2, 30)]
VB = (7, 55, 184, 95)  # viewBox x, y, w, h
THEMES = {  # name: bg, text, gold, accent
    'void': ('#04020c', '#f4f0ff', '#c9a84c', '#7c3aed'),
    'dark': ('#0a0a0c', '#f2f2f0', '#c9a84c', '#3a3a40'),
    'light': ('#e7e0cf', '#1a1424', '#9a7b2d', '#8a7f6b'),
    'cream': ('#efe6d3', '#1a1410', '#764d33', '#764d33'),
    'creamDark': ('#12100d', '#efe6d3', '#c9a84c', '#8a6448'),
}
rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def lum(h):
    c = [v / 255 for v in rgb(h)]; c = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True); return (x + 0.05) / (y + 0.05)


def svg(bg, ink):
    s = 1.6; w, h = VB[2] * s, VB[3] * s * 0 + VB[2] * s  # square, mark centred at 1/1.6 width
    x0, y0 = VB[0] - (w - VB[2]) / 2, VB[1] - (h - VB[3]) / 2
    poly = lambda p: ' '.join(f'{x},{y}' for x, y in p)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.1f} {y0:.1f} {w:.1f} {h:.1f}">
  <rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{bg}"/>
  <mask id="gap" maskUnits="userSpaceOnUse" x="-50" y="-50" width="300" height="260">
    <rect x="-50" y="-50" width="300" height="260" fill="#fff"/>
    <g fill="#000" stroke="#000" stroke-width="3.4" stroke-linejoin="round">{''.join(f'<polygon points="{poly(b)}"/>' for b in BROWS)}</g>
  </mask>
  <g fill="{ink}">
    <g mask="url(#gap)">{''.join(f'<ellipse cx="{a}" cy="{b}" rx="{c}" ry="{d}"/>' for a, b, c, d in EYES)}</g>
    {''.join(f'<polygon points="{poly(b)}"/>' for b in BROWS)}
  </g>
</svg>
'''


def png(bg, ink, N=1024, K=4, room=1.6):
    """bg None = transparent; room = canvas width / mark width."""
    M = N * K; s = M / (VB[2] * room); ox = M / 2 - (VB[0] + VB[2] / 2) * s; oy = M / 2 - (VB[1] + VB[3] / 2) * s
    T = lambda p: [(ox + x * s, oy + y * s) for x, y in p]
    m = Image.new('L', (M, M), 0); d = ImageDraw.Draw(m)
    for cx, cy, rx, ry in EYES: d.ellipse([ox + (cx - rx) * s, oy + (cy - ry) * s, ox + (cx + rx) * s, oy + (cy + ry) * s], fill=255)
    for b in BROWS:  # the gap: brows grown by half the 3.4 stroke
        p = T(b); d.polygon(p, fill=0); d.line(p + [p[0]], fill=0, width=round(3.4 * s), joint='curve')
    for b in BROWS: d.polygon(T(b), fill=255)
    im = Image.new('RGBA', (M, M), rgb(bg) + (255,) if bg else (0, 0, 0, 0)); im.paste(Image.new('RGBA', (M, M), rgb(ink) + (255,)), (0, 0), m)
    return im.resize((N, N), Image.LANCZOS)


looks = [('app-icon-white-on-black', '#000000', '#ffffff'), ('app-icon-black-on-white', '#ffffff', '#000000')]
for t, (bg, text, gold, acc) in THEMES.items():
    for role, ink in (('text', text), ('gold', gold), ('accent', acc)):
        if role == 'accent' and acc in (gold, text): continue
        if contrast(bg, ink) >= 3: looks.append((f'{t}-{role}', bg, ink))
        else: print('skipped (contrast %.1f):' % contrast(bg, ink), t, role)
tiles = []
for name, bg, ink in looks:
    open(os.path.join(OUT, name + '.svg'), 'w').write(svg(bg, ink))
    im = png(bg, ink); im.save(os.path.join(OUT, name + '.png')); tiles.append((name, im))
cols, T = 4, 256; rows = -(-len(tiles) // cols)
sheet = Image.new('RGB', (cols * T, rows * (T + 28)), (128, 128, 128)); d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(tiles):
    x, y = (i % cols) * T, (i // cols) * (T + 28); sheet.paste(im.resize((T, T), Image.LANCZOS), (x, y)); d.text((x + 6, y + T + 8), n, fill=(255, 255, 255))
sheet.save(os.path.join(OUT, 'overview.png')); print(len(tiles), 'looks')

# The app icon (owner, 2026-10-20): creamDark text. Android adaptive layers keep the mark inside the 66% safe zone.
BRAND = os.path.join(HERE, '..', '..', '..', 'assets', 'brand')
bg, ink = THEMES['creamDark'][0], THEMES['creamDark'][1]
png(bg, ink).convert('RGB').save(os.path.join(BRAND, 'icon.png'))
png(None, ink, room=2.3).save(os.path.join(BRAND, 'adaptive-icon-foreground.png'))
png(None, '#ffffff', room=2.3).save(os.path.join(BRAND, 'adaptive-icon-monochrome.png'))
Image.new('RGB', (1024, 1024), rgb(bg)).save(os.path.join(BRAND, 'adaptive-icon-background.png'))
print('app icon installed')
