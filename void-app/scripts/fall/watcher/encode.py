"""Encodes the Blender loops (out/loops/<id>/####.png) for the site and for review.
   py -3.12 encode.py <dest folder>
Per loop: <id>.webm (VP9 with alpha, for the site), <id>.gif (transparent), <id>-preview.mp4 (on white, plays in Drive).
Plus all-12-preview.mp4: a 4 x 3 grid on white, each loop repeating at its own length."""
import glob, os, subprocess, sys
from PIL import Image, ImageDraw
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'out', 'loops')
DEST = sys.argv[1]
os.makedirs(DEST, exist_ok=True)
run = lambda *a: subprocess.run([FF, '-y', '-loglevel', 'error', *a], check=True)

loops = sorted(d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d)))
tiles = []
for lid in loops:
    seq = os.path.join(SRC, lid, '%04d.png')
    run('-framerate', '30', '-i', seq, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-auto-alt-ref', '0', os.path.join(DEST, lid + '.webm'))
    run('-framerate', '30', '-i', seq, '-vf', 'scale=256:-1:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=1:max_colors=8[p];[b][p]paletteuse=alpha_threshold=128', '-loop', '0', os.path.join(DEST, lid + '.gif'))
    run('-framerate', '30', '-i', seq, '-filter_complex', 'color=white:s=512x512[bg];[bg][0]overlay=shortest=1,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', os.path.join(DEST, lid + '-preview.mp4'))
    tiles.append([Image.open(f).convert('RGBA').resize((256, 256), Image.LANCZOS) for f in sorted(glob.glob(os.path.join(SRC, lid, '*.png')))])
    print('encoded', lid)

cols, rows, S = 4, 3, 256
n = 4 * max(len(t) for t in tiles)
p = subprocess.Popen([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{cols * S}x{rows * S}', '-r', '30', '-i', '-',
                      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', os.path.join(DEST, 'all-12-preview.mp4')], stdin=subprocess.PIPE)
for k in range(n):
    g = Image.new('RGBA', (cols * S, rows * S), (255, 255, 255, 255))
    d = ImageDraw.Draw(g)
    for j, t in enumerate(tiles):
        x, y = (j % cols) * S, (j // cols) * S
        g.alpha_composite(t[k % len(t)], (x, y))
        d.text((x + 8, y + S - 16), loops[j], fill=(120, 120, 120, 255))
    p.stdin.write(g.convert('RGB').tobytes())
p.stdin.close(); p.wait()
print('grid', n, 'frames')
