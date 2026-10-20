"""Preview MP4s of pull to refresh as CameraFall.tsx plays it, on an iPhone with a Dynamic Island: him dripping out of
the camera with his sparkles, falling in place, then drawn back up into the camera.
   py -3.12 preview.py  ->  out/previews/<id>.mp4 per saved set, plus out/previews/all.mp4 (2 x 2)
Same numbers as CameraFall.tsx (keep them in step). Needs Pillow and imageio-ffmpeg."""
import json, math, os, subprocess
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
P = json.load(open(os.path.join(OUT, 'paths.json')))
S = 3                       # px per dp (an iPhone)
W, H = 390, 140             # dp: the top of the phone
TOP = 59                    # safe-area top (Dynamic Island)
CAMX, CAMY, Y0 = W / 2, TOP / 2, TOP - 11
PAGE, BAND, GOLD = (4, 2, 12), (11, 6, 32), (201, 168, 76)
# CameraFall.tsx
SCALE = 0.75 * 1.08
FORM, DROP, OUT_N = 10, 14, 12
IN = FORM + DROP
HOLD = 30 * 4               # seconds of refreshing shown
IDLE = 24
FONT = ImageFont.truetype(os.path.join(HERE, '..', '..', 'assets', 'fonts', 'DMSerifDisplay-Italic.ttf'), 22 * S)
sm = lambda x: (lambda v: v * v * (3 - 2 * v))(min(1, max(0, x)))
back = lambda x: (lambda v: 1 + v * v * (2.4 * v + 1.4))(min(1, max(0, x)) - 1)


def base(show_mark=True):
    im = Image.new('RGBA', (W * S, H * S), PAGE + (255,))
    d = ImageDraw.Draw(im)
    for i, w in enumerate([16, 10, 13]):  # the stagger icon, left of the header row
        y = TOP + 15 + i * 7
        d.rounded_rectangle([18 * S, y * S, (18 + w) * S, (y + 1.5) * S], radius=S, fill=GOLD)
    if show_mark:
        d.text((CAMX * S, (TOP + 22) * S), 'Void Archive', font=FONT, fill=GOLD, anchor='mm')  # Masthead: the text only
    return im


def island(d):
    d.rounded_rectangle([(CAMX - 63) * S, 11 * S, (CAMX + 63) * S, Y0 * S], radius=18.5 * S, fill=(0, 0, 0))


def render(f):
    sheet = Image.open(os.path.join(OUT, 'sheets', f['id'] + '.webp')).convert('RGBA')
    px, cols, nl, C = f['px'], f['cols'], f['nl'], f['cell']
    spot, spx = max(Y0 + 4 + C * SCALE / 2, CAMY + 46), CAMX
    cells = {}
    frames, clock = [], 0
    timeline = [('idle', i) for i in range(IDLE)] + [('in', i) for i in range(IN)] + [('loop', i) for i in range(HOLD)] + [('out', i) for i in range(OUT_N)] + [('idle', i) for i in range(IDLE)]
    for ph, v in timeline:
        im = base(ph == 'idle')  # while he is out the header text hides
        x, y, g, sy, a = spx, spot, 1, 1, 1
        if ph == 'in' and v < FORM:
            u = sm(v / FORM); g = 0.12 + 0.43 * u; sy = 1 + 0.3 * u; a = sm(v / 3)
            x, y = CAMX, Y0 + C * SCALE * g * sy * 0.32
        elif ph == 'in':
            w = (v - FORM) / DROP; fr = Y0 + C * SCALE * 0.55 * 1.3 * 0.32
            x = CAMX + (spx - CAMX) * sm(w / 0.8); y = fr + (spot - fr) * back(w); g = 0.55 + 0.45 * sm(w / 0.6)
            land = sm((w - 0.45) / 0.2) * (1 - sm((w - 0.65) / 0.35))
            sy = 1 + 0.3 * (1 - sm(w / 0.5)) - 0.14 * land
        elif ph == 'out':
            w = v / OUT_N; x = spx + (CAMX - spx) * sm(w); y = spot + (Y0 - spot) * w ** 3
            g = 1 - 0.88 * sm(w); sy = 1 + 0.35 * sm(w / 0.6); a = 1 - sm((w - 0.75) / 0.25)
        if ph != 'idle':
            if a > 0:
                c = clock % nl
                if c not in cells:
                    cells[c] = sheet.crop(((c % cols) * px, (c // cols) * px, (c % cols + 1) * px, (c // cols + 1) * px))
                cw, ch = max(1, int(C * SCALE * g / sy ** 0.5 * S)), max(1, int(C * SCALE * g * sy * S))
                cell = cells[c].resize((cw, ch), Image.LANCZOS)
                if a < 1:
                    cell.putalpha(cell.getchannel('A').point(lambda x: int(x * a)))
                im.alpha_composite(cell, (int(x * S - cw / 2), int(y * S - ch / 2)))
            clock += 1
        island(ImageDraw.Draw(im))
        frames.append(im.convert('RGB'))
    return frames


def write(path, frames, w, h):
    p = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', '30', '-i', '-',
                          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-movflags', '+faststart', path], stdin=subprocess.PIPE)
    for im in frames:
        p.stdin.write(im.tobytes())
    p.stdin.close(); p.wait()


os.makedirs(os.path.join(OUT, 'previews'), exist_ok=True)
allf = []
for f in P['falls']:
    fr = render(f)
    write(os.path.join(OUT, 'previews', f"{f['id']}-{f['name'].replace(' ', '-')}.mp4"), fr, W * S, H * S)
    allf.append(fr)
    print('preview', f['id'], len(fr))
n = max(len(x) for x in allf)
grid = []
for k in range(n):
    g = Image.new('RGB', (W * S, H * S))
    for j, fr in enumerate(allf):
        g.paste(fr[k % len(fr)].resize((W * S // 2, H * S // 2), Image.LANCZOS), ((j % 2) * W * S // 2, (j // 2) * H * S // 2))
    grid.append(g)
write(os.path.join(OUT, 'previews', 'all.mp4'), grid, W * S, H * S)
print('grid', n)
