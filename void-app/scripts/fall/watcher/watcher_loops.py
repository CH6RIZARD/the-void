# THE WATCHER, 12 seamless loops, rendered in Blender. The mark stays exactly as WACTHER.png: pure black on
# transparent, the brows cutting a thin gap into the eyes. Only the motion is new.
#   E:/Blender/blender.exe -b -P watcher_loops.py -- [ids...]     -> out/loops/<id>/####.png (512 x 512, 30 fps)
# Geometry = watcher.js / watcher.svg (svg units, y down), placed in Blender's XY plane with y flipped.
import bpy, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'loops')
BROW = {'l': [(11.2, 71.9), (14.9, 78.3), (74.6, 101.4), (89.9, 92.3), (86.3, 85.9), (27, 62.1)],
        'r': [(186.5, 59.3), (125.1, 83.6), (121.9, 89.1), (121.2, 105.2), (182.3, 81.5), (185.4, 76.1)]}
EYE = {'l': (58.4, 115.2, 29.2, 30.8), 'r': (146.2, 115.9, 29.2, 30.0)}
GAP = 1.7
CX, CY = 99.0, 103.0  # the mark's middle
P = lambda x, y: ((x - CX) / 10, -(y - CY) / 10)  # svg -> blender units

TAU = math.pi * 2
sm = lambda x: (lambda v: v * v * (3 - 2 * v))(min(1, max(0, x)))
def pulse(u, a, b):
    """0 -> 1 -> 0 between u = a and b (smooth)."""
    if u <= a or u >= b: return 0.0
    m = (a + b) / 2
    return sm((u - a) / (m - a)) if u < m else sm((b - u) / (b - m))
def blink(u, at, dur=0.1):
    """Eye openness through a blink starting at u = at: fast down, slower up."""
    t = (u - at) / dur
    if t <= 0 or t >= 1: return 1.0
    return 1 - 0.92 * (t / 0.38 if t < 0.38 else 1 - (t - 0.38) / 0.62)

def eye_roll(u):
    """Looking left, the eyes roll up and over to the right (brows lift with them), then drift back low."""
    if u < 0.15: return dict(lx=-3.0)
    if u < 0.62:
        k = sm((u - 0.15) / 0.47)
        return dict(lx=-3.0 * math.cos(math.pi * k), ly=-2.6 * math.sin(math.pi * k), by=1.4 * math.sin(math.pi * k))
    return dict(lx=3.0 - 6.0 * sm((u - 0.62) / 0.33))

# Each loop: frames, and pose(u) for u in [0, 1). Keys: lx ly (eye look, svg units), open, wide, by (brows up),
# bt (brows tilt in, deg), rx ry rz (whole mark, deg), dy (whole mark up, units), sx (squash/stretch).
LOOPS = {
    '01-blink':       (60, lambda u: dict(open=blink(u, 0.55))),
    '02-double-blink': (66, lambda u: dict(open=min(blink(u, 0.5, 0.08), blink(u, 0.62, 0.08)))),
    '03-look-around': (96, lambda u: dict(lx=3.2 * math.cos(TAU * u), ly=-2.0 * math.sin(TAU * u), open=blink(u, 0.88, 0.09))),
    '04-side-glance': (90, lambda u: dict(lx=3.6 * (sm((u - 0.08) / 0.06) - 2 * sm((u - 0.42) / 0.07) + sm((u - 0.78) / 0.07)), open=blink(u, 0.6, 0.08))),
    '05-suspicious':  (96, lambda u: (lambda k: dict(open=1 - 0.42 * k, by=-1.6 * k, bt=7 * k, lx=2.4 * math.sin(TAU * u) * k))(pulse(u, 0.1, 0.9))),
    '06-surprised':   (66, lambda u: (lambda k: dict(by=4.2 * k, wide=0.08 * k, open=1 + 0.05 * k, dy=0.25 * k))(pulse(u, 0.15, 0.75) ** 0.7)),
    '07-head-turn':   (96, lambda u: dict(ry=24 * math.sin(TAU * u), lx=2.2 * math.sin(TAU * u + 0.5), open=blink(u, 0.47, 0.08))),
    '08-tilt':        (72, lambda u: dict(rz=7 * math.sin(TAU * u), dy=0.12 * math.sin(TAU * 2 * u), ly=0.6 * math.sin(TAU * u))),
    '09-sleepy':      (110, lambda u: (lambda c, j: dict(open=max(0.12, 1 - 0.88 * c) if u < 0.82 else 0.12 + 0.88 * j, by=-1.2 * c + 1.5 * pulse(u, 0.82, 0.95), dy=-0.15 * c))(sm(u / 0.8), sm((u - 0.82) / 0.05))),
    '10-eye-roll':    (72, lambda u: eye_roll(u)),
    '11-scanner':     (120, lambda u: dict(lx=3.4 * math.sin(TAU * u), ry=8 * math.sin(TAU * u), open=0.82 + 0.18 * (1 - abs(math.sin(TAU * u))), by=-0.6)),
    '12-furrow':      (72, lambda u: (lambda k: dict(bt=10 * k, by=-1.4 * k, open=1 - 0.25 * k, sx=1 + 0.03 * k))(pulse(u, 0.1, 0.9))),
}

def black_mat(name, holdout=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if holdout:
        sh = nt.nodes.new('ShaderNodeHoldout'); nt.links.new(sh.outputs[0], out.inputs[0])
    else:
        sh = nt.nodes.new('ShaderNodeEmission'); sh.inputs['Color'].default_value = (0, 0, 0, 1); nt.links.new(sh.outputs[0], out.inputs[0])
    return m

def poly_curve(name, pts, z, mat, offset=0.0, parent=None, origin=(0, 0)):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'; cu.offset = offset; cu.resolution_u = 1
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1); sp.use_cyclic_u = True
    for p, (x, y) in zip(sp.points, pts): p.co = (x - origin[0], y - origin[1], 0, 1)
    ob = bpy.data.objects.new(name, cu); ob.location = (origin[0], origin[1], z); ob.data.materials.append(mat)
    bpy.context.collection.objects.link(ob)
    if parent: ob.parent = parent
    return ob

def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None); e.location = loc; bpy.context.collection.objects.link(e)
    if parent: e.parent = parent
    return e

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.render.fps = 30
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    try: sc.eevee.taa_render_samples = 16
    except Exception: pass
    ink, hold = black_mat('ink'), black_mat('gap', holdout=True)
    root = empty('root', (0, 0, 0))
    parts = {}
    for s in ('l', 'r'):
        x, y, rx, ry = EYE[s]; ex, ey = P(x, y)
        piv = empty('eye_' + s, (ex, ey, 0), root)
        bpy.ops.mesh.primitive_circle_add(vertices=96, radius=1, fill_type='NGON', location=(0, 0, 0))
        disc = bpy.context.object; disc.name = 'eyeDisc_' + s; disc.scale = (rx / 10, ry / 10, 1); disc.parent = piv; disc.data.materials.append(ink)
        pts = [P(*q) for q in BROW[s]]
        bx = sum(p[0] for p in pts) / len(pts); by = sum(p[1] for p in pts) / len(pts)
        bpiv = empty('brow_' + s, (bx, by, 0), root)
        local = [(px - bx, py - by) for px, py in pts]
        poly_curve('browGap_' + s, local, 0.05, hold, offset=GAP / 10, parent=bpiv)
        poly_curve('brow_' + s, local, 0.1, ink, parent=bpiv)
        parts[s] = (piv, bpiv)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.collection.objects.link(cam)
    cam.location = (0, 0, 60); cam.data.lens = 98; cam.data.sensor_width = 36  # long lens: depth reads, barely any distortion
    sc.camera = cam
    return sc, root, parts

def animate(sc, root, parts, n, pose):
    sc.frame_start, sc.frame_end = 1, n
    base = {s: (parts[s][0].location.copy(), parts[s][1].location.copy()) for s in parts}
    for f in range(n):
        u = f / n; q = dict(lx=0, ly=0, open=1, wide=0, by=0, bt=0, rx=0, ry=0, rz=0, dy=0, sx=1); q.update(pose(u))
        fr = f + 1
        root.rotation_euler = (math.radians(q['rx']), math.radians(q['ry']), math.radians(q['rz']))
        root.location = (0, q['dy'], 0); root.scale = (q['sx'], 2 - q['sx'], 1)
        for k in ('rotation_euler', 'location', 'scale'): root.keyframe_insert(k, frame=fr)
        for s in ('l', 'r'):
            eye, brow = parts[s]; e0, b0 = base[s]; side = -1 if s == 'l' else 1
            eye.location = (e0.x + q['lx'] / 10, e0.y - q['ly'] / 10, 0)
            g = 1 + q['wide']; eye.scale = (g, g * q['open'], 1)
            brow.location = (b0.x + q['lx'] * 0.045, b0.y - q['ly'] * 0.045 + q['by'] / 10, 0)
            brow.rotation_euler = (0, 0, math.radians(side * q['bt']))  # inner ends dip toward the nose
            for ob in (eye, brow):
                for k in ('location', 'scale', 'rotation_euler'): ob.keyframe_insert(k, frame=fr)
    if root.animation_data and root.animation_data.action:
        pass  # linear keys every frame; nothing to ease

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ids = [k for k in LOOPS if not argv or any(k.startswith(a) for a in argv)]
for lid in ids:
    n, pose = LOOPS[lid]
    sc, root, parts = build()
    animate(sc, root, parts, n, pose)
    sc.render.filepath = os.path.join(OUT, lid, '')
    bpy.ops.render.render(animation=True)
    print('LOOP DONE', lid, n)
