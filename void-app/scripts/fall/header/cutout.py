"""Cuts THE character out of the Void Loading Lab thumbnails (solid band colour behind him), keeping the sparkles
that sit on him. py -3.12 cutout.py -> out/char-<n>.png (RGBA, cropped to him)."""
import cv2, numpy as np, os, glob
SRC = r'E:\void icons'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True)
BG = np.array([32, 6, 11], np.float32)  # BGR of #0b0620
for n, f in enumerate(sorted(glob.glob(os.path.join(SRC, 'void-archive-thumb-*.png'))), 1):
    im = cv2.imread(f, cv2.IMREAD_COLOR).astype(np.float32)
    d = np.linalg.norm(im - BG, axis=2)
    fg = (d > 9).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    k, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    body = (lab == big).astype(np.uint8)
    # fill holes inside him
    ff = body.copy(); h, w = ff.shape; m = np.zeros((h + 2, w + 2), np.uint8); cv2.floodFill(ff, m, (0, 0), 1)
    body = body | (1 - ff)
    # soft edge: alpha from the colour distance near the border, solid inside
    inner = cv2.erode(body, np.ones((5, 5), np.uint8))
    edge = np.clip((d - 4) / 14, 0, 1)
    a = np.where(inner > 0, 1.0, edge * body)
    a = cv2.GaussianBlur(a.astype(np.float32), (3, 3), 0)
    # un-blend the band colour from the edge pixels so no dark-violet halo is left
    rgb = im.copy(); aa = np.maximum(a, 1e-3)[..., None]
    rgb = np.clip((rgb - BG * (1 - aa)) / aa, 0, 255)
    out = np.dstack([rgb, a * 255]).astype(np.uint8)
    x, y, ww, hh = cv2.boundingRect(body)
    cv2.imwrite(os.path.join(OUT, f'char-{n}.png'), out[y:y + hh, x:x + ww])
    print(n, os.path.basename(f), (ww, hh))
