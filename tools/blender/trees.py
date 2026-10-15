"""樹:真的枝幹結構 + 葉片面片(帶透明度的葉叢貼圖)。

舊版的樹冠是一整團平滑的圓丘,看起來像花椰菜。真的樹靠兩件事讀起來像樹:
  1. 看得到的枝幹:主幹分岔成主枝,主枝再分小枝,越往外越細
  2. 破碎的輪廓:樹冠是由一叢一叢的葉子組成,邊緣有缺口、看得到天空與枝條

做法(遊戲業界常用的 leaf card):
  - 枝幹:沿路徑長出的管狀網格,照常烘焙樹皮顏色 × AO 與法線貼圖
  - 葉子:每張面片(兩個三角形)貼一張「一小叢葉子」的透明貼圖(這裡用 numpy 程序化畫出),
    遊戲端用 alpha test 切出葉形,陰影也會是一片片的葉影
  - 面片的法線改成「從樹冠中心往外」,整棵樹的明暗像一個有體積的樹冠,
    不會每片葉子各亮各的;越靠樹冠內側、越下方,頂點色越暗(假的 AO)
  - 烘焙樹皮時暫時放一份縮小的葉片當遮擋物,樹冠裡的枝條才會比較暗

葉片在烘焙之後才加上(post_bake),因為它們用自己的貼圖,不進烘焙圖集。
"""

import math
import random

import bpy
import bmesh
import numpy as np
from mathutils import Vector

from lib import Asset, finish_object

PENDING = {}  # 資產名 → 葉片資料(建模時算好,烘焙後 add_leaves 取用)
_TEX = {}     # 葉叢貼圖快取


def lerp(a, b, t):
    return a + (b - a) * t


def _perp(v):
    ref = Vector((1, 0, 0)) if abs(v.x) < 0.9 else Vector((0, 1, 0))
    return v.cross(ref).normalized()


def _rand_unit(rng):
    while True:
        p = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if 0.01 < p.length <= 1:
            return p.normalized()


# ================================================================ 枝幹網格

def tube(pts, radii, sides, flare=None):
    """沿折線長出的管子(平行移動座標框,轉彎處不會扭)。尖端收成一點。
    flare(i, ang) → 半徑倍率(樹根的板根)。"""
    bm = bmesh.new()
    n = len(pts)
    tans = [(pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized() for i in range(n)]
    nrm = _perp(tans[0])
    prev = tans[0]
    rings = []
    for i in range(n):
        t = tans[i]
        nrm = prev.rotation_difference(t) @ nrm
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bi = t.cross(nrm)
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            r = radii[i] * (flare(i, ang) if flare else 1.0)
            ring.append(bm.verts.new(pts[i] + (nrm * math.cos(ang) + bi * math.sin(ang)) * r))
        rings.append(ring)
        prev = t
    for i in range(n - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    tip = bm.verts.new(pts[-1] + tans[-1] * radii[-1] * 1.5)
    for k in range(sides):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sides], tip))
    bm.normal_update()
    return bm


# ================================================================ 葉叢貼圖(numpy 程序化繪製)

def _over(img, x0, y0, rgb, a):
    """把一塊顏色以 alpha 疊到畫布上(預先乘好的 over 合成)。"""
    h, w = a.shape
    reg = img[y0:y0 + h, x0:x0 + w]
    a3 = a[..., None]
    reg[..., :3] = reg[..., :3] * (1 - a3) + rgb * a3
    reg[..., 3] = reg[..., 3] * (1 - a) + a


def _bbox(img, pts, pad):
    H, W = img.shape[:2]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0 = max(0, int(min(xs) - pad)); x1 = min(W, int(max(xs) + pad) + 1)
    y0 = max(0, int(min(ys) - pad)); y1 = min(H, int(max(ys) + pad) + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    return x0, y0, xx + 0.5, yy + 0.5


def _stroke(img, a, b, w0, w1, rgb):
    """一段由粗變細的線(樹枝、針葉)。"""
    box = _bbox(img, [a, b], max(w0, w1) + 2)
    if not box:
        return
    x0, y0, xx, yy = box
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    L2 = dx * dx + dy * dy + 1e-6
    t = np.clip(((xx - ax) * dx + (yy - ay) * dy) / L2, 0, 1)
    d = np.hypot(xx - (ax + t * dx), yy - (ay + t * dy))
    half = (w0 + (w1 - w0) * t) / 2
    alpha = np.clip(half - d + 0.5, 0, 1)
    shade = 1.0 - 0.25 * np.clip(d / np.maximum(half, 0.5), 0, 1)  # 圓柱感:中間亮、兩側暗
    _over(img, x0, y0, np.asarray(rgb)[None, None, :] * shade[..., None], alpha)


def _leaf(img, base, ang, L, W, rgb, rng):
    """一片葉子:葉柄在 base,朝 ang 方向長 L、最寬 W;中肋、葉脈、左右受光不同。"""
    ca, sa = math.cos(ang), math.sin(ang)
    tip = (base[0] + ca * L, base[1] + sa * L)
    box = _bbox(img, [base, tip], W)
    if not box:
        return
    x0, y0, xx, yy = box
    dx, dy = xx - base[0], yy - base[1]
    u = (dx * ca + dy * sa) / L          # 0 = 葉柄, 1 = 葉尖
    v = -dx * sa + dy * ca               # 橫向(像素)
    uc = np.clip(u, 0, 1)
    half = (W / 2) * np.sin(np.pi * uc) ** 0.7 * (1.08 - 0.3 * uc)
    inside = (u > 0.02) & (u < 1)
    dist = half - np.abs(v)
    alpha = np.clip(dist + 0.5, 0, 1) * inside
    rib = 1 - 0.28 * np.exp(-(v / 1.3) ** 2)
    veins = 1 - 0.07 * (np.sin((u * L - np.abs(v) * 0.9) * 0.55) > 0.8)
    side = np.where(v > 0, 1.1, 0.88)
    edge = 1 - 0.2 * np.clip(1 - dist / 3.0, 0, 1)
    tipl = 0.9 + 0.2 * uc
    shade = rib * veins * side * edge * tipl
    _over(img, x0, y0, np.asarray(rgb)[None, None, :] * shade[..., None], alpha)


def _image(name, arr):
    """numpy RGBA(列 0 在下方)→ Blender 影像(打包,匯出成 PNG)。"""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def broadleaf_texture(seed, res=512):
    """一小枝闊葉:葉柄從下緣中央往上,左右互生、頂端一簇。"""
    key = ("broad", seed, res)
    if key in _TEX:
        return _TEX[key]
    rng = random.Random(seed)
    S = res
    img = np.zeros((S, S, 4), np.float32)
    img[..., :3] = (0.24, 0.36, 0.14)  # 透明處也填葉色,遠處 mipmap 不會出現黑邊
    dark, mid, light = np.array((0.15, 0.27, 0.09)), np.array((0.25, 0.4, 0.14)), np.array((0.42, 0.55, 0.2))

    def leaf_color():
        t = rng.random()
        c = dark + (mid - dark) * min(1, t * 2) if t < 0.5 else mid + (light - mid) * (t - 0.5) * 2
        if rng.random() < 0.12:
            c = c * 0.6 + np.array((0.5, 0.52, 0.18)) * 0.4  # 偶爾一片偏黃
        return c * rng.uniform(0.92, 1.08)

    # 三根小枝從下緣中央往上散開,每根左右互生小葉、頂端一簇(葉子約 15~20 公分,不會大得像芭蕉)
    leaves = []
    for k, (spread, reach) in enumerate(((-0.5, 0.82), (0.05, 0.95), (0.55, 0.8))):
        tw = [(S * 0.5, 0.0)]
        for i in range(1, 7):
            t = i / 6
            tw.append((S * (0.5 + spread * 0.42 * t + 0.03 * math.sin(t * 3 + seed + k)), S * reach * t))
        for i in range(len(tw) - 1):
            w = lerp(S * 0.018, S * 0.006, i / (len(tw) - 1))
            _stroke(img, tw[i], tw[i + 1], w, w * 0.8, (0.3, 0.22, 0.15))
        n = 13
        for i in range(n):
            t = 0.12 + 0.86 * i / (n - 1)
            j = min(len(tw) - 2, int(t * (len(tw) - 1)))
            f = t * (len(tw) - 1) - j
            p = (lerp(tw[j][0], tw[j + 1][0], f), lerp(tw[j][1], tw[j + 1][1], f))
            dirn = math.atan2(tw[j + 1][1] - tw[j][1], tw[j + 1][0] - tw[j][0])
            side = 1 if (i + k) % 2 else -1
            ang = dirn + side * math.radians(rng.uniform(40, 75) * (1 - 0.35 * t))
            leaves.append((p, ang, S * rng.uniform(0.13, 0.17) * (1 - 0.2 * t)))
        for _ in range(3):
            leaves.append((tw[-1], dirn + math.radians(rng.uniform(-50, 50)), S * rng.uniform(0.11, 0.15)))
    rng.shuffle(leaves)
    leaves.sort(key=lambda q: q[0][1])  # 下面的先畫,上面的蓋在上面
    for p, ang, L in leaves:
        _leaf(img, p, ang, L, L * rng.uniform(0.44, 0.54), leaf_color(), rng)
    _TEX[key] = _image(f"leaf_broad_{seed}", img)
    return _TEX[key]


def needle_texture(seed, res=512):
    """一片針葉小枝(雲杉):主軸由下往上,兩側斜出的側枝,每根枝上密生短針;枝端是淺綠的新芽。"""
    key = ("needle", seed, res)
    if key in _TEX:
        return _TEX[key]
    rng = random.Random(seed)
    S = res
    img = np.zeros((S, S, 4), np.float32)
    img[..., :3] = (0.14, 0.25, 0.11)
    dark, mid, tipc = np.array((0.09, 0.18, 0.08)), np.array((0.15, 0.28, 0.11)), np.array((0.32, 0.45, 0.17))
    twig = (0.27, 0.2, 0.13)

    def twig_with_needles(a, b, w, density, nlen):
        _stroke(img, a, b, w, w * 0.5, twig)
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        ang = math.atan2(dy, dx)
        count = int(L / density)
        for i in range(count):
            t = (i + rng.random() * 0.6) / count
            p = (a[0] + dx * t, a[1] + dy * t)
            c = mid + (dark - mid) * rng.random() * 0.8
            if t > 0.78:
                c = c + (tipc - c) * min(1, (t - 0.78) / 0.22) * 0.9
            c = c * rng.uniform(0.9, 1.1)
            for side in (-1, 1):
                na = ang + side * math.radians(rng.uniform(42, 62))
                ln = nlen * rng.uniform(0.8, 1.15) * (1 - 0.35 * t)
                _stroke(img, p, (p[0] + math.cos(na) * ln, p[1] + math.sin(na) * ln), 3.6, 1.6, c)

    base, tip = (S * 0.5, S * 0.0), (S * 0.5 + rng.uniform(-6, 6), S * 0.97)
    sides = []
    n = 14
    for i in range(n):
        t = 0.06 + 0.84 * i / (n - 1)
        side = 1 if i % 2 else -1
        p = (lerp(base[0], tip[0], t), lerp(base[1], tip[1], t))
        a = math.pi / 2 + side * math.radians(rng.uniform(48, 62))
        L = S * 0.44 * (1 - 0.6 * t) * rng.uniform(0.85, 1.05)
        sides.append((p, (p[0] + math.cos(a) * L, p[1] + math.sin(a) * L)))
    for a, b in sides:
        twig_with_needles(a, b, 3.0, 4.0, S * 0.065)
    twig_with_needles(base, tip, 5.0, 4.0, S * 0.07)
    _TEX[key] = _image(f"leaf_needle_{seed}", img)
    return _TEX[key]


# ================================================================ 葉片面片

class Cards:
    """累積葉片:每張是一個四邊形(兩個三角形)。法線改成樹冠方向後,平的卡片看起來就夠有體積。"""

    def __init__(self):
        self.cards = []  # (4 個頂點, 4 個 UV, 卡片法線)
        self.tints = []  # 每張卡片的色調(葉色深淺不一)

    def add(self, p, length_dir, normal, size, droop=0.08, tint=(1, 1, 1)):
        l = length_dir.normalized()
        n = (normal - l * normal.dot(l)).normalized()
        w = l.cross(n)
        s = size
        down = Vector((0, 0, -s * droop))
        b0, b1 = p - w * s / 2, p + w * s / 2
        t0, t1 = b0 + l * s + down, b1 + l * s + down
        self.cards.append(((b0, b1, t1, t0), ((0, 0), (1, 0), (1, 1), (0, 1)), n))
        self.tints.append(tint)


def _store(name, cards, tex, normal_fn, shade_fn, occ_scale=0.55):
    """記下葉片資料給烘焙後用,並放一份縮小的葉片當烘焙 AO 的遮擋物。"""
    verts, uvs, nrms, cols, faces = [], [], [], [], []
    for (vs, uv, n), tint in zip(cards.cards, cards.tints):
        i0 = len(verts)
        for v, t in zip(vs, uv):
            verts.append(v)
            uvs.append(t)
            nrms.append(normal_fn(v, n))
            s = shade_fn(v)
            cols.append((s * tint[0], s * tint[1], s * tint[2], 1.0))
        faces.append((i0, i0 + 1, i0 + 2, i0 + 3))
    PENDING[name] = dict(verts=verts, uvs=uvs, nrms=nrms, cols=cols, faces=faces, tex=tex)

    # 烘焙遮擋物:每張卡片縮到 occ_scale(大約是葉子實際的覆蓋率),不匯出
    occ = []
    for vs, _, _ in cards.cards:
        c = sum(vs, Vector()) / len(vs)
        occ.append([c + (v - c) * occ_scale for v in vs])
    me = bpy.data.meshes.new("_occ_leaves")
    flat = [v for vs in occ for v in vs]
    f = [(4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 3) for k in range(len(occ))]
    me.from_pydata(flat, [], f)
    ob = bpy.data.objects.new("_occ_leaves", me)
    bpy.context.collection.objects.link(ob)


def add_leaves(ob):
    """post_bake:把葉片做成第二個網格(自己的透明貼圖材質),跟樹幹一起匯出。"""
    d = PENDING.pop(ob.name)
    me = bpy.data.meshes.new(ob.name + "_leaves")
    me.from_pydata(d["verts"], [], d["faces"])
    uv = me.uv_layers.new(name="UVMap")
    col = me.color_attributes.new("shade", "BYTE_COLOR", "CORNER")
    for poly in me.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = d["uvs"][vi]
            col.data[li].color = d["cols"][vi]
    me.normals_split_custom_set_from_vertices([tuple(n) for n in d["nrms"]])

    mat = bpy.data.materials.new(ob.name + "_leaves")
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = d["tex"]
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])  # 有接 Alpha 的貼圖會匯出成 PNG
    bsdf.inputs["Roughness"].default_value = 0.85
    me.materials.append(mat)

    leaves = bpy.data.objects.new(ob.name + "_leaves", me)
    bpy.context.collection.objects.link(leaves)
    return leaves


# ================================================================ 闊葉樹

def _grow(rng, out, p0, d, L, r0, level, maxl):
    """一根枝:分幾段微微彎曲往前長,沿途分出子枝(第一個子枝是主軸的延續)。"""
    nseg = max(2, int(L / 0.55) + 1)
    pts = [p0]
    dd = d.normalized()
    up = 0.12 if level < maxl else -0.04  # 粗枝向光,末梢略垂
    for _ in range(nseg):
        dd = (dd + _rand_unit(rng) * 0.16 + Vector((0, 0, up))).normalized()
        pts.append(pts[-1] + dd * (L / nseg))
    r1 = max(0.012, r0 * 0.45)
    radii = [lerp(r0, r1, i / nseg) for i in range(nseg + 1)]
    out.append((pts, radii, level))
    if level >= maxl:
        return
    nkids = 3 if level == 1 else rng.choice((2, 3))
    for c in range(nkids):
        f = 1.0 if c == 0 else rng.uniform(0.35, 0.85)
        x = f * nseg
        i0 = min(nseg - 1, int(x))
        p = pts[i0].lerp(pts[i0 + 1], x - i0)
        tang = (pts[i0 + 1] - pts[i0]).normalized()
        if c == 0:
            cd = (tang + _rand_unit(rng) * 0.25).normalized()
        else:
            q = _perp(tang)
            az = c * 2.4 + rng.uniform(-0.6, 0.6)
            side = (q * math.cos(az) + tang.cross(q) * math.sin(az)).normalized()
            ang = math.radians(rng.uniform(32, 58))
            cd = (tang * math.cos(ang) + side * math.sin(ang)).normalized()
        _grow(rng, out, p, cd, L * rng.uniform(0.58, 0.74), lerp(r0, r1, f) * 0.78, level + 1, maxl)


def build_broadleaf(name, seed, height=7.5):
    rng = random.Random(seed)
    a = Asset(name)
    trunk_r = height * 0.042
    clear = height * 0.36  # 第一個分岔的高度

    # 主幹:微微傾斜、帶板根
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.05
    tp = [Vector((0, 0, -0.15)) + Vector((0, 0, (clear + 0.15) * i / 6)) + lean * i
          + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.02 for i in range(7)]
    tr = [trunk_r * (1 - 0.22 * i / 6) for i in range(7)]
    phase = rng.uniform(0, 6.28)

    def flare(i, ang):
        z = tp[i].z
        k = max(0.0, 1 - (z + 0.15) / 0.8) ** 2
        return 1 + 0.6 * k * (0.5 + 0.5 * math.cos(5 * ang + phase))

    a.add(tube(tp, tr, 12, flare), "bark")

    branches = []
    top = tp[-1]
    nmain = 4 + (rng.random() < 0.4)
    for k in range(nmain):
        az = k * 2 * math.pi / nmain + rng.uniform(-0.35, 0.35)
        tilt = math.radians(rng.uniform(32, 52))
        d = Vector((math.sin(tilt) * math.cos(az), math.sin(tilt) * math.sin(az), math.cos(tilt)))
        p0 = top - Vector((0, 0, rng.uniform(0, 0.5)))
        _grow(rng, branches, p0, d, height * rng.uniform(0.34, 0.42), trunk_r * 0.6, 1, 4)
    _grow(rng, branches, top, Vector((0, 0, 1)) + lean, height * 0.36, trunk_r * 0.62, 1, 4)

    sides = {1: 8, 2: 6, 3: 4, 4: 3}  # 細枝藏在樹冠裡,少用一點面
    for pts, radii, level in branches:
        a.add(tube(pts, radii, sides[level]), "bark")

    # 樹冠的中心與半徑(給法線與假 AO 用)
    tips = [p for pts, _, lv in branches if lv >= 3 for p in pts[1:]]
    cen = sum(tips, Vector()) / len(tips)
    rad = Vector((max(abs(p.x - cen.x) for p in tips) + 0.6, max(abs(p.y - cen.y) for p in tips) + 0.6,
                  max(abs(p.z - cen.z) for p in tips) + 0.6))

    def outward(p):
        q = Vector(((p.x - cen.x) / rad.x, (p.y - cen.y) / rad.y, (p.z - cen.z) / rad.z))
        return q

    # 葉片:細枝上每隔一小段一叢,再補一層貼著樹冠外殼的葉叢,讓樹冠飽滿、只留少量縫隙
    cards = Cards()

    def tint():
        return (rng.uniform(0.9, 1.08), rng.uniform(0.93, 1.07), rng.uniform(0.85, 1.0))

    def leaf_at(p, tang, size):
        out = outward(p)
        o = out.normalized() if out.length > 1e-3 else Vector((0, 0, 1))
        ldir = (tang * 0.4 + o * 0.6 + _rand_unit(rng) * 0.45).normalized()
        nrm = (o + _rand_unit(rng) * 0.9).normalized()
        if abs(nrm.dot(ldir)) > 0.95:
            nrm = _perp(ldir)
        cards.add(p + _rand_unit(rng) * 0.12, ldir, nrm, size, tint=tint())

    for pts, _, level in branches:
        if level < 3:
            continue
        L = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))
        count = max(1, int(L / 0.45))
        for c in range(count):
            f = 0.2 + 0.8 * (c + rng.random()) / count
            x = f * (len(pts) - 1)
            i0 = min(len(pts) - 2, int(x))
            p = pts[i0].lerp(pts[i0 + 1], x - i0)
            tang = (pts[i0 + 1] - pts[i0]).normalized()
            leaf_at(p, tang, rng.uniform(1.15, 1.6))
    for _ in range(int(rad.x * rad.y * 18)):
        u = _rand_unit(rng)
        e = rng.uniform(0.62, 0.98) ** 0.5
        p = cen + Vector((u.x * rad.x, u.y * rad.y, u.z * rad.z)) * e
        if p.z < clear + 0.4:
            continue
        leaf_at(p, u, rng.uniform(1.2, 1.7))

    def normal_fn(v, n):
        o = outward(v)
        o = o.normalized() if o.length > 1e-3 else Vector((0, 0, 1))
        if n.dot(o) < 0:
            n = -n
        return (n * 0.25 + o * 0.75).normalized()

    def shade_fn(v):
        e = min(1.0, outward(v).length)
        s = 0.45 + 0.55 * e ** 1.4
        s *= 0.82 + 0.18 * max(0.0, min(1.0, (v.z - cen.z) / rad.z + 0.6))
        return s

    print(f"[trees] {name}: {len(branches)} branches, {len(cards.cards)} leaf cards")
    _store(name, cards, broadleaf_texture(seed), normal_fn, shade_fn)
    return finish_object(a.to_object())


# ================================================================ 針葉樹(雲杉)

def build_conifer(name, seed, height=7.0):
    rng = random.Random(seed)
    a = Asset(name)
    trunk_r = height * 0.03
    n = 9
    tp = [Vector((rng.uniform(-1, 1) * 0.03 * (i > 0), rng.uniform(-1, 1) * 0.03 * (i > 0), -0.15 + (height + 0.15) * i / n))
          for i in range(n + 1)]
    tr = [trunk_r * (1 - i / n) ** 0.9 + 0.012 for i in range(n + 1)]
    phase = rng.uniform(0, 6.28)

    def flare(i, ang):
        k = max(0.0, 1 - (tp[i].z + 0.15) / 0.6) ** 2
        return 1 + 0.45 * k * (0.5 + 0.5 * math.cos(4 * ang + phase))

    a.add(tube(tp, tr, 10, flare), "bark")

    z0 = 0.75
    maxL = height * 0.34
    cards = Cards()
    whorls = []
    z = z0
    while z < height - 0.5:
        whorls.append(z)
        z += lerp(0.36, 0.26, z / height) * height / 7 * rng.uniform(0.85, 1.15)

    def Lz(zz):
        t = min(1.0, max(0.0, (zz - z0) / (height - z0)))
        return maxL * (1 - t) ** 0.95 + 0.25

    for wi, z in enumerate(whorls):
        t = (z - z0) / (height - z0)
        nb = rng.choice((6, 7, 7, 8))
        az0 = wi * 0.9 + rng.uniform(0, 1)
        for k in range(nb):
            az = az0 + k * 2 * math.pi / nb + rng.uniform(-0.25, 0.25)
            L = Lz(z) * rng.uniform(0.85, 1.1)
            d = Vector((math.cos(az), math.sin(az), 0))
            p0 = Vector((0, 0, z))
            rise = 0.12 * L * (1 - t)
            droop = 0.22 * L * (1 - t * 0.6)
            pts = [p0, p0 + d * L * 0.45 + Vector((0, 0, rise)), p0 + d * L + Vector((0, 0, rise * 0.5 - droop))]
            r = 0.012 + 0.028 * L / maxL
            a.add(tube(pts, [r, r * 0.6, 0.008], 4), "bark")
            # 針葉面片沿著枝條平鋪,略為往兩側翻
            nc = max(1, round(L / 0.7))
            for c in range(nc):
                f0 = c / nc
                seg = (pts[2] - pts[0])
                p = pts[0].lerp(pts[1], min(1, f0 * 2)) if f0 < 0.5 else pts[1].lerp(pts[2], (f0 - 0.5) * 2)
                ldir = (seg.normalized() + Vector((0, 0, -0.15 * f0))).normalized()
                size = L / nc * 1.9
                rolls = (rng.uniform(-40, -15), rng.uniform(-8, 8), rng.uniform(15, 40)) if L > 1.3 else \
                    (rng.uniform(-35, -10), rng.uniform(10, 35))  # 短枝兩張就夠
                for roll in rolls:
                    up = Vector((0, 0, 1))
                    side = ldir.cross(up).normalized()
                    rr = math.radians(roll)
                    nrm = (up * math.cos(rr) + side * math.sin(rr)).normalized()
                    cards.add(p, ldir, nrm, size * rng.uniform(0.9, 1.1), droop=0.12,
                              tint=(rng.uniform(0.9, 1.08), rng.uniform(0.92, 1.06), rng.uniform(0.88, 1.02)))
    # 樹梢:兩張交叉直立的面片
    for k in range(3):
        az = k * math.pi / 3
        cards.add(Vector((0, 0, height - 1.05)), Vector((0, 0, 1)), Vector((math.cos(az), math.sin(az), 0)), 1.25,
                  droop=0, tint=(1.05, 1.05, 1.0))

    def normal_fn(v, n):
        radial = Vector((v.x, v.y, 0))
        o = (radial.normalized() * 0.8 if radial.length > 1e-3 else Vector()) + Vector((0, 0, 0.6))
        o.normalize()
        if n.dot(o) < 0:
            n = -n
        return (n * 0.35 + o * 0.65).normalized()

    def shade_fn(v):
        t = max(0.0, min(1.0, (v.z - z0) / (height - z0)))
        rr = math.hypot(v.x, v.y) / max(0.3, Lz(v.z))
        s = 0.38 + 0.62 * min(1.0, rr) ** 0.8
        return s * (0.78 + 0.22 * t)

    print(f"[trees] {name}: {len(cards.cards)} leaf cards")
    _store(name, cards, needle_texture(seed), normal_fn, shade_fn)
    return finish_object(a.to_object())
