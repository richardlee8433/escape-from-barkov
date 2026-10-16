# 各資產的程序化建模。座標:Blender Z 朝上、公尺;匯出時轉成 glTF 的 Y 朝上。
# 長條形物件(柵欄、大門、橋)的長軸一律沿 +X,遊戲端依此擺放。

import math
import random

import bpy  # noqa: F401  (pip 版 bpy 需先載入)
import bmesh
from mathutils import Matrix, Vector

from lib import (Asset, apply_modifiers, beam, blob, cylinder, displace, fbm, finish_object, grid,
                 merge)


def lerp(a, b, t):
    return a + (b - a) * t


def _drop_to_ground(bm, sink=0.0):
    zmin = min(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, -zmin - sink)), verts=bm.verts)


def decimate(bm, tris):
    """塌陷到目標三角面數(細節交給烘焙的法線貼圖)。"""
    cur = sum(len(f.verts) - 2 for f in bm.faces)
    if cur > tris:
        bm = apply_modifiers(bm, [("DECIMATE", dict(ratio=tris / cur))])
    bm.normal_update()
    return bm


def _remesh_decimate(bm, voxel, tris, smooth_iters=2):
    bm = apply_modifiers(bm, [("REMESH", dict(mode="VOXEL", voxel_size=voxel, adaptivity=0.0))])
    for _ in range(smooth_iters):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    cur = sum(len(f.verts) - 2 for f in bm.faces)
    if cur > tris:
        bm = apply_modifiers(bm, [("DECIMATE", dict(ratio=tris / cur))])
    bm.normal_update()
    return bm


def limb(a, b, r1, r2, segs=10, caps=False):
    """從 a 到 b 的錐形圓柱(樹幹、枝條)。"""
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = cylinder(r1, r2, d.length, segs, caps=caps)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=a, verts=bm.verts)
    return bm


# ================================================================ 石頭

def build_rock(name, seed, scale):
    rng = random.Random(seed)
    bm = blob(1.0, 5, scale, amp=0.24, freq=1.2, seed=seed, amp2=0.05, freq2=4.5,
              flat_bottom=-scale[2] * 0.35)
    # 不規則切面:隨機把幾個方向壓平,像風化的大石塊
    for _ in range(3):
        n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.1, 0.8))).normalized()
        cut = rng.uniform(0.62, 0.8)
        for v in bm.verts:
            d = v.co.dot(n) / max(scale)
            if d > cut:
                v.co -= n * (d - cut) * max(scale) * 0.7
    bm.normal_update()
    bm = decimate(bm, 1400)
    _drop_to_ground(bm, sink=0.04 * scale[2])
    a = Asset(name)
    a.add(bm, "rock")
    return finish_object(a.to_object())


# ================================================================ 樹樁、木頭(樹與灌木在 trees.py)

def build_stump(name, seed):
    a = Asset(name)
    bm = cylinder(0.42, 0.34, 0.55, 18, caps=False)
    for v in bm.verts:
        if v.co.z < 0.1:
            v.co.x *= 1.25
            v.co.y *= 1.25
    displace(bm, 0.03, 4.0, seed)
    a.add(bm, "bark")
    top = cylinder(0.345, 0.345, 0.02, 18, loc=(0, 0, 0.53))
    a.add(top, "lid")
    return finish_object(a.to_object(), 50)


def build_log(name, seed):
    a = Asset(name)
    L = 2.2
    body = limb((-L / 2, 0, 0.26), (L / 2, 0, 0.26), 0.26, 0.24, 16)
    displace(body, 0.02, 4.0, seed)
    a.add(body, "bark")
    for x, r in ((-L / 2, 0.255), (L / 2, 0.235)):
        a.add(limb((x - 0.012, 0, 0.26), (x + 0.012, 0, 0.26), r, r, 16, caps=True), "lid")
    return finish_object(a.to_object(), 50)


# ================================================================ 木作

def build_fence(name, seed):
    rng = random.Random(seed)
    a = Asset(name)
    for x in (-1.55, 1.55):
        tilt = Vector((rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), 0))
        a.add(beam((x, 0, -0.1), Vector((x, 0, 1.15)) + tilt, 0.15, 0.15, 0.03),
              "wood_weathered", tint=(rng.uniform(0.85, 1.05),) * 3, smooth=False)
    for z in (0.45, 0.86):
        dz = rng.uniform(-0.04, 0.04)
        a.add(beam((-1.65, 0.09, z + dz), (1.65, 0.09, z - dz), 0.08, 0.13, 0.025, roll=rng.uniform(-0.1, 0.1)),
              "wood_weathered", tint=(rng.uniform(0.85, 1.05),) * 3, smooth=False)
    return finish_object(a.to_object(), 40)


def build_gate(name, seed):
    rng = random.Random(seed)
    a = Asset(name)
    for x in (-1.9, 1.9):
        a.add(beam((x, 0, -0.1), (x, 0, 2.7), 0.26, 0.26, 0.04), "timber", smooth=False)
        a.add(blob(0.2, 2, (1, 1, 0.7), loc=(x, 0, 2.75), amp=0.1, freq=2, seed=x), "stone_found")
    a.add(beam((-2.25, 0, 2.38), (2.25, 0, 2.38), 0.22, 0.24, 0.04), "timber", smooth=False)
    for s in (-1, 1):
        a.add(beam((s * 1.9, 0, 1.75), (s * 1.25, 0, 2.3), 0.12, 0.12, 0.02), "timber", smooth=False)
    # 吊牌
    for x in (-0.55, 0.55):
        a.add(beam((x, 0, 2.27), (x, 0, 1.95), 0.03, 0.03, 0.005), "iron", smooth=False)
    a.add(beam((-0.8, 0, 1.78), (0.8, 0, 1.78), 0.07, 0.38, 0.02), "wood_light", smooth=False)
    # 腳邊石塊
    for x in (-1.9, 1.9):
        for k in range(3):
            ang = k * 2.1 + rng.random()
            a.add(blob(rng.uniform(0.16, 0.24), 2, (1, 1, 0.7),
                       loc=(x + math.cos(ang) * 0.3, math.sin(ang) * 0.3, 0.06), amp=0.15, freq=2, seed=rng.random() * 9),
                  "stone_found")
    return finish_object(a.to_object(), 40)


def build_bridge(name, seed):
    """木橋。遊戲裡會把整座橋沉到「橋面 = 地面」,也就是本地 z ≈ 0.61 對應世界地面;
    溝壑深約 3 公尺(本地 z ≈ -2.4 是河床),所以橋墩木樁要一路插到 -2.7。"""
    rng = random.Random(seed)
    a = Asset(name)
    deck = 0.62
    bank = 0.61                      # 本地座標裡的岸邊地面高度
    # 橋板(沿 Y 橫鋪)
    x = -5.0
    while x < 5.0:
        w = rng.uniform(0.28, 0.36)
        tz = rng.uniform(-0.015, 0.015)
        a.add(beam((x + w / 2, -1.95, deck + tz), (x + w / 2, 1.95, deck - tz), w - 0.04, 0.08, 0.015),
              "wood_door", tint=(rng.uniform(0.8, 1.08),) * 3, smooth=False)
        x += w
    for y in (-1.4, 1.4):
        a.add(beam((-5.1, y, deck - 0.16), (5.1, y, deck - 0.16), 0.22, 0.24, 0.03), "timber", smooth=False)
    # 欄杆:柱子從橋面下方開始,不再懸在半空;兩端的柱子插進岸邊
    for y in (-2.1, 2.1):
        for px in (-4.7, -2.35, 0.0, 2.35, 4.7):
            bottom = bank - 0.35 if abs(px) > 4 else deck - 0.22
            a.add(beam((px, y, bottom), (px, y, deck + 1.05), 0.16, 0.16, 0.03), "wood_weathered",
                  tint=(rng.uniform(0.85, 1.05),) * 3, smooth=False)
        a.add(beam((-4.85, y, deck + 0.98), (4.85, y, deck + 0.98), 0.13, 0.12, 0.03), "wood_weathered", smooth=False)
        a.add(beam((-4.85, y, deck + 0.5), (4.85, y, deck + 0.5), 0.08, 0.1, 0.02), "wood_weathered", smooth=False)
        # 欄杆柱外側的托架,把柱子接到橋面下的橫梁
        for px in (-2.35, 0.0, 2.35):
            a.add(beam((px, y * 0.98, deck - 0.2), (px, 0, deck - 0.2), 0.1, 0.1, 0.015), "timber", smooth=False)

    # 橋墩:兩排圓木樁插進河床,上面一根帽梁托住縱梁,中間 X 形斜撐
    for bx in (-1.6, 1.6):
        for py in (-1.55, 1.55):
            pile = limb((bx + rng.uniform(-0.03, 0.03), py, -2.75), (bx, py, deck - 0.28), 0.14, 0.12, 10)
            displace(pile, 0.01, 4.0, rng.random() * 9)
            a.add(pile, "bark")
        a.add(beam((bx, -1.85, deck - 0.34), (bx, 1.85, deck - 0.34), 0.24, 0.2, 0.03), "timber", smooth=False)
        a.add(beam((bx, -1.5, -1.9), (bx, 1.5, deck - 0.5), 0.1, 0.12, 0.015), "timber", smooth=False)
        a.add(beam((bx, 1.5, -1.9), (bx, -1.5, deck - 0.5), 0.1, 0.12, 0.015), "timber", smooth=False)
        # 斜撐從樁頂延伸到縱梁,分散跨距
        for sgn in (-1, 1):
            for py in (-1.4, 1.4):
                a.add(beam((bx, py, -0.5), (bx + sgn * 1.3, py, deck - 0.3), 0.1, 0.1, 0.015), "timber", smooth=False)

    # 崖邊橋基:縱梁在溝壑崖邊(距中線 3 公尺)壓在一排石塊上;石頂低於縱梁底面,不會穿出橋面
    for bx in (-3.15, 3.15):
        for py in (-1.6, -0.55, 0.55, 1.6):
            r = rng.uniform(0.3, 0.36)
            a.add(decimate(blob(r, 3, (1.1, 1.0, 0.75), loc=(bx + rng.uniform(-0.08, 0.08), py, 0.0),
                                amp=0.15, freq=1.8, seed=rng.random() * 99), 140), "stone_found")
    return finish_object(a.to_object(), 40)


def build_barrel(name, seed):
    a = Asset(name)
    H, R = 1.1, 0.4

    def rad(z):
        return R + 0.06 * math.sin(math.pi * z / H)

    body = grid(36, 10, lambda u, v: Vector((math.cos(u * 2 * math.pi) * rad(v * H),
                                             math.sin(u * 2 * math.pi) * rad(v * H), v * H)))
    bmesh.ops.remove_doubles(body, verts=body.verts, dist=1e-5)
    a.add(body, "barrel_wood")
    for z in (0.12, 0.34, H - 0.34, H - 0.12):
        r = rad(z) + 0.012
        band = grid(36, 1, lambda u, v, r=r, z=z: Vector((math.cos(u * 2 * math.pi) * r,
                                                         math.sin(u * 2 * math.pi) * r, z - 0.04 + v * 0.08)))
        bmesh.ops.remove_doubles(band, verts=band.verts, dist=1e-5)
        band = apply_modifiers(band, [("SOLIDIFY", dict(thickness=0.012, offset=1.0))])
        a.add(band, "iron")
    lid = cylinder(R - 0.01, R - 0.01, 0.03, 36, loc=(0, 0, H - 0.07))
    a.add(lid, "lid")
    return finish_object(a.to_object(), 50)


def build_crate(name, seed):
    a = Asset(name)
    s = 1.0
    h = s / 2
    core = beam((-h + 0.03, 0, h), (h - 0.03, 0, h), s - 0.06, s - 0.06, 0.01)
    a.add(core, "wood_light", smooth=False)
    # 面板上的木條紋路靠 _wood 的 UV;外框 12 條邊
    e = h - 0.05
    for y in (-e, e):
        for z in (0.05, s - 0.05):
            a.add(beam((-h, y, z), (h, y, z), 0.1, 0.1, 0.015), "wood_door", smooth=False)
    for x in (-e, e):
        for z in (0.05, s - 0.05):
            a.add(beam((x, -h, z), (x, h, z), 0.1, 0.1, 0.015), "wood_door", smooth=False)
    for x in (-e, e):
        for y in (-e, e):
            a.add(beam((x, y, 0), (x, y, s), 0.1, 0.1, 0.015), "wood_door", smooth=False)
    # 兩側斜撐
    for y in (-h - 0.01, h + 0.01):
        a.add(beam((-e, y, 0.08), (e, y, s - 0.08), 0.05, 0.1, 0.01), "wood_door", smooth=False)
    for x in (-h - 0.01, h + 0.01):
        a.add(beam((x, -e, s - 0.08), (x, e, 0.08), 0.05, 0.1, 0.01), "wood_door", smooth=False)
    return finish_object(a.to_object(), 40)


def build_chest(name, seed):
    a = Asset(name)
    W, D, H = 1.0, 0.62, 0.5
    a.add(beam((-W / 2, 0, H / 2), (W / 2, 0, H / 2), D, H, 0.02), "wood_door", smooth=False)
    lid = grid(16, 10, lambda u, v: Vector((lerp(-W / 2, W / 2, u),
                                            math.cos(v * math.pi) * D / 2,
                                            H + math.sin(v * math.pi) * D * 0.38)))
    lid = apply_modifiers(lid, [("SOLIDIFY", dict(thickness=0.03, offset=-1.0))])
    a.add(lid, "wood_door")
    for x in (-0.36, 0.0, 0.36):
        band = grid(1, 12, lambda u, v, x=x: Vector((x + (u - 0.5) * 0.07,
                                                     math.cos(v * math.pi) * (D / 2 + 0.012),
                                                     H + math.sin(v * math.pi) * (D * 0.38 + 0.012))))
        band = apply_modifiers(band, [("SOLIDIFY", dict(thickness=0.01, offset=1.0))])
        a.add(band, "iron")
        a.add(beam((x, -D / 2 - 0.006, 0.0), (x, -D / 2 - 0.006, H), 0.012, 0.07, 0.003), "iron", smooth=False)
    a.add(beam((0, -D / 2 - 0.03, H - 0.02), (0, -D / 2 - 0.03, H - 0.16), 0.04, 0.12, 0.01), "iron", smooth=False)
    return finish_object(a.to_object(), 40)


def build_well(name, seed):
    rng = random.Random(seed)
    a = Asset(name)
    R = 0.95
    for layer, z in enumerate((0.22, 0.6)):
        n = 11
        for i in range(n):
            ang = (i + 0.5 * layer) / n * 2 * math.pi
            a.add(decimate(blob(0.3, 3, (1.0, 0.85, 0.75), loc=(math.cos(ang) * R, math.sin(ang) * R, z),
                                amp=0.15, freq=2.0, seed=rng.random() * 99), 110), "stone_dark")
    a.add(cylinder(R - 0.12, R - 0.12, 0.02, 24, loc=(0, 0, 0.55)), "glass")
    for y in (-1.05, 1.05):
        a.add(beam((0, y, 0.0), (0, y, 2.15), 0.16, 0.16, 0.03), "timber", smooth=False)
    a.add(beam((0, -1.15, 1.6), (0, 1.15, 1.6), 0.1, 0.1, 0.02), "timber", smooth=False)
    # 小屋頂
    for s in (-1, 1):
        for k in range(5):
            t = k / 4
            a.add(beam((lerp(0, s * 0.95, t), -1.35, lerp(2.55, 1.95, t)), (lerp(0, s * 0.95, t), 1.35, lerp(2.55, 1.95, t)),
                       0.26, 0.05, 0.01, roll=s * 0.56), "wood_weathered", tint=(rng.uniform(0.8, 1.05),) * 3, smooth=False)
    a.add(beam((0, -1.4, 2.6), (0, 1.4, 2.6), 0.12, 0.12, 0.02), "timber", smooth=False)
    # 吊桶
    a.add(beam((0, 0, 1.6), (0, 0, 1.15), 0.015, 0.015, 0.0), "iron", smooth=False)
    a.add(cylinder(0.17, 0.2, 0.28, 14, loc=(0, 0, 0.87)), "barrel_wood")
    return finish_object(a.to_object(), 40)


# ================================================================ 茅草屋

def build_cottage(name, seed):
    rng = random.Random(seed)
    a = Asset(name)
    L, D = 8.0, 5.0
    zb, zt = 0.5, 3.0                # 牆的底與頂
    pitch = math.radians(50)
    apex = zt + (D / 2 + 0.05) * math.tan(pitch)

    # ---- 石砌基座
    a.add(beam((-L / 2, 0, zb / 2), (L / 2, 0, zb / 2), D - 0.1, zb, 0.03), "stone_found", smooth=False)
    def perimeter(step):
        pts = []
        for (x0, y0, x1, y1) in ((-L / 2, -D / 2, L / 2, -D / 2), (L / 2, -D / 2, L / 2, D / 2),
                                 (L / 2, D / 2, -L / 2, D / 2), (-L / 2, D / 2, -L / 2, -D / 2)):
            n = int(math.hypot(x1 - x0, y1 - y0) / step)
            for i in range(n):
                t = (i + 0.5) / n
                pts.append((lerp(x0, x1, t), lerp(y0, y1, t)))
        return pts
    for (x, y) in perimeter(0.55):
        if abs(x) < 0.7 and y < 0:
            continue  # 門前留給台階
        nx = (x / (L / 2)) if abs(abs(x) - L / 2) < 1e-3 else 0
        ny = (y / (D / 2)) if abs(abs(y) - D / 2) < 1e-3 else 0
        r = rng.uniform(0.26, 0.36)
        a.add(decimate(blob(r, 3, (1.0, 1.0, 0.8), loc=(x + nx * 0.06, y + ny * 0.06, r * 0.65),
                            amp=0.18, freq=1.8, seed=rng.random() * 99), 120), "stone_found")
    a.add(blob(0.75, 3, (1.0, 0.55, 0.16), loc=(0, -D / 2 - 0.45, 0.05), amp=0.12, freq=2, seed=3), "stone_found")

    # ---- 灰泥牆體
    a.add(beam((-L / 2 + 0.02, 0, (zb + zt) / 2), (L / 2 - 0.02, 0, (zb + zt) / 2), D - 0.04, zt - zb, 0.02),
          "plaster", smooth=False)
    # 山牆三角
    gable = bmesh.new()
    vs = []
    for x in (-L / 2 + 0.02, L / 2 - 0.02):
        vs.append([gable.verts.new((x, -D / 2, zt)), gable.verts.new((x, D / 2, zt)), gable.verts.new((x, 0, apex))])
    gable.faces.new(vs[0][::-1])
    gable.faces.new(vs[1])
    for i in range(3):
        j = (i + 1) % 3
        gable.faces.new((vs[0][i], vs[0][j], vs[1][j], vs[1][i]))
    bmesh.ops.recalc_face_normals(gable, faces=gable.faces)
    a.add(gable, "plaster", smooth=False)

    T = 0.2
    def tb(p, q, w=T, mat="timber"):
        a.add(beam(p, q, w, w, 0.025), mat, tint=(rng.uniform(0.85, 1.08),) * 3, smooth=False)

    def glass(x0, x1, z0, z1, y, out):
        a.add(beam(((x0 + x1) / 2, y, z0), ((x0 + x1) / 2, y, z1), x1 - x0, 0.04, 0.0), "glass", smooth=False)
        tb(((x0 + x1) / 2, y + out * 0.04, z0), ((x0 + x1) / 2, y + out * 0.04, z1), 0.07)
        tb((x0, y + out * 0.04, (z0 + z1) / 2), (x1, y + out * 0.04, (z0 + z1) / 2), 0.07)
        a.add(beam((x0 - 0.1, y + out * 0.1, z0 - 0.06), (x1 + 0.1, y + out * 0.1, z0 - 0.06), 0.18, 0.07, 0.015),
              "wood_light", smooth=False)

    # ---- 長牆(前 y<0 / 後 y>0)
    posts = [-L / 2, -2.3, -0.65, 0.65, 2.3, L / 2]
    for side in (-1, 1):
        y = side * (D / 2 + 0.03)
        tb((-L / 2 - 0.1, y, zb + 0.1), (L / 2 + 0.1, y, zb + 0.1))
        tb((-L / 2 - 0.12, y, zt - 0.08), (L / 2 + 0.12, y, zt - 0.08))
        for x in posts:
            tb((x, y, zb + 0.1), (x, y, zt - 0.08))
        # 兩端斜撐
        tb((-L / 2, y, zb + 0.2), (-2.3, y, zt - 0.18))
        tb((L / 2, y, zb + 0.2), (2.3, y, zt - 0.18))
        # 窗
        for (x0, x1) in ((-2.3, -0.65), (0.65, 2.3)):
            tb((x0, y, 1.38), (x1, y, 1.38))
            tb((x0, y, 2.3), (x1, y, 2.3))
            glass(x0 + 0.14, x1 - 0.14, 1.5, 2.2, side * (D / 2 + 0.01), side)
            tb((x0 + 0.1, y, zb + 0.2), (x1 - 0.1, y, 1.3), 0.14)
            tb((x1 - 0.1, y, zb + 0.2), (x0 + 0.1, y, 1.3), 0.14)
        if side < 0:
            # 門
            dy = -D / 2 - 0.06
            for k in range(5):
                x = lerp(-0.42, 0.42, k / 4)
                a.add(beam((x, dy, zb + 0.12), (x, dy, 2.35), 0.05, 0.2, 0.012), "wood_door",
                      tint=(rng.uniform(0.85, 1.1),) * 3, smooth=False)
            for z in (0.95, 2.0):
                a.add(beam((-0.5, dy - 0.04, z), (0.5, dy - 0.04, z), 0.04, 0.14, 0.01), "wood_door", smooth=False)
            tb((-0.65, y, 2.45), (0.65, y, 2.45))
            a.add(blob(0.04, 1, (1, 1, 1), loc=(0.3, dy - 0.08, 1.5), amp=0.0), "iron")
            a.add(beam((0.3, dy - 0.07, 1.42), (0.3, dy - 0.07, 1.58), 0.02, 0.02, 0.0), "iron", smooth=False)
        else:
            tb((-0.65, y, 1.38), (0.65, y, 1.38))
            tb((-0.6, y, zb + 0.2), (0.6, y, 1.3), 0.14)
            tb((0.6, y, zb + 0.2), (-0.6, y, 1.3), 0.14)
            glass(-0.5, 0.5, 1.5, 2.2, D / 2 + 0.01, 1)
            tb((-0.65, y, 2.3), (0.65, y, 2.3))

    # ---- 短牆與山牆木架
    for side in (-1, 1):
        x = side * (L / 2 + 0.03)
        tb((x, -D / 2, zb + 0.1), (x, D / 2, zb + 0.1))
        tb((x, -D / 2 - 0.1, zt - 0.08), (x, D / 2 + 0.1, zt - 0.08))
        tb((x, 0, zb + 0.1), (x, 0, apex - 0.25))
        tb((x, -D / 2, zb + 0.2), (x, -0.1, zt - 0.2))
        tb((x, D / 2, zb + 0.2), (x, 0.1, zt - 0.2))
        tb((x, -D / 2 - 0.05, zt), (x, 0, apex + 0.05))
        tb((x, D / 2 + 0.05, zt), (x, 0, apex + 0.05))
        tb((x, -1.25, zt), (x, -0.1, apex - 0.7), 0.14)
        tb((x, 1.25, zt), (x, 0.1, apex - 0.7), 0.14)

    # ---- 茅草屋頂:一列列波浪邊的草片,上排疊在下排之上
    rows = 7
    ovx = 0.55                       # 山牆方向出簷
    S = (D / 2 + 0.05) / math.cos(pitch) + 0.8   # 屋脊到簷口的坡長(含出簷)
    rh = S / rows
    Lx = L / 2 + ovx
    for side in (-1, 1):
        dvec = Vector((0, side * math.cos(pitch), -math.sin(pitch)))
        nvec = Vector((0, side * math.sin(pitch), math.cos(pitch)))
        ridge = Vector((0, 0, apex))
        for k in range(rows):
            s_lo = S - k * rh
            s_hi = max(-0.25, s_lo - rh * 1.5) if k < rows - 1 else -0.25
            lift0 = 0.12 + k * 0.045
            ph = rng.uniform(0, 6.28)

            def fn(u, v, s_lo=s_lo, s_hi=s_hi, lift0=lift0, ph=ph, k=k):
                x = lerp(-Lx, Lx, u)
                wave = 0.11 * math.sin(x * 2.3 + ph) + 0.06 * fbm(Vector((x * 1.3, ph, 0)), 2)
                s = lerp(s_hi, s_lo + wave, v)
                lift = lift0 + 0.035 * fbm(Vector((x * 0.9, s * 0.9, ph)), 2)
                if k == 0 and v > 0.55:
                    lift -= ((v - 0.55) / 0.45) ** 2 * 0.3
                elif v > 0.7:
                    lift -= ((v - 0.7) / 0.3) ** 2 * 0.12
                edge = abs(x) - (Lx - 0.45)
                if edge > 0:
                    lift -= (edge / 0.45) ** 2 * 0.32
                return ridge + dvec * s + nvec * lift + Vector((x, 0, 0))

            row = grid(56, 7, fn)
            thick = 0.3 if k == 0 else 0.16
            row = apply_modifiers(row, [("SOLIDIFY", dict(thickness=thick, offset=-1.0))])
            a.add(row, "thatch")

    # 屋脊:壓扁的半圓筒
    rlift = 0.12 + (rows - 1) * 0.045
    def ridge_fn(u, v):
        x = lerp(-Lx + 0.25, Lx - 0.25, u)
        ang = lerp(-1.9, 1.9, v)
        r = 0.36 + 0.03 * fbm(Vector((x * 1.5, ang, 0)), 2)
        return Vector((x, math.sin(ang) * r * 1.15, apex + rlift + math.cos(ang) * r * 0.75 - 0.12))
    a.add(grid(48, 12, ridge_fn), "thatch")
    for sx in (-1, 1):
        a.add(blob(0.4, 3, (0.6, 1.0, 0.8), loc=(sx * (Lx - 0.25), 0, apex + rlift - 0.12), amp=0.08, freq=2, seed=sx),
              "thatch")

    # ---- 煙囪
    cx, cy = 2.4, 0.8
    a.add(beam((cx, cy, apex - 1.4), (cx, cy, apex + 1.15), 0.75, 0.75, 0.04), "chimney", smooth=False)
    a.add(beam((cx, cy, apex + 1.15), (cx, cy, apex + 1.3), 0.95, 0.95, 0.03), "stone_found", smooth=False)
    for dx in (-0.2, 0.2):
        a.add(blob(0.16, 2, (1, 1, 0.8), loc=(cx + dx, cy, apex + 1.42), amp=0.15, freq=2, seed=dx * 10), "stone_found")

    return finish_object(a.to_object(), 40)


# ================================================================ 水邊植物與挖寶土堆

def ribbon(base, height, width, bend, twist, curl=0.0, segs=8, sway_phase=0.0, wave=0.0):
    """細長的葉片(蘆葦葉、水草):底寬頂尖,沿高度彎曲;wave > 0 時像水草一樣左右波動。"""
    bx, by = base
    ang = twist

    def fn(u, v):
        h = v * height
        w = width * (1 - v * 0.92) * (u - 0.5)
        lean = bend * v * v
        side = wave * math.sin(v * 7 + sway_phase) * v
        x = bx + math.cos(ang) * (w + side) + math.sin(ang) * lean
        y = by + math.sin(ang) * (w + side) - math.cos(ang) * lean
        return Vector((x, y, h - curl * v * v * v))
    return grid(1, segs, fn)


def build_reeds(name, seed):
    rng = random.Random(seed)
    a = Asset(name)
    for i in range(14):
        ang = rng.uniform(0, 6.28)
        r = rng.uniform(0, 0.18)
        a.add(ribbon((math.cos(ang) * r, math.sin(ang) * r), rng.uniform(1.0, 1.7), rng.uniform(0.035, 0.05),
                     rng.uniform(0.15, 0.45), rng.uniform(0, 6.28), curl=rng.uniform(0.0, 0.25)),
              "reed", tint=(rng.uniform(0.85, 1.1),) * 3)
    # 香蒲穗:細莖頂上一根褐色圓柱
    for i in range(4):
        ang = rng.uniform(0, 6.28)
        r = rng.uniform(0.02, 0.15)
        x, y = math.cos(ang) * r, math.sin(ang) * r
        h = rng.uniform(1.45, 1.9)
        lean = Vector((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0))
        a.add(limb((x, y, 0), Vector((x, y, h)) + lean, 0.012, 0.009, 6), "reed")
        a.add(limb(Vector((x, y, h - 0.32)) + lean * 0.85, Vector((x, y, h - 0.08)) + lean * 0.97, 0.034, 0.03, 8, caps=True),
              "cattail")
    return finish_object(a.to_object())


def build_waterweed(name, seed):
    rng = random.Random(seed)
    a = Asset(name)
    for i in range(9):
        ang = rng.uniform(0, 6.28)
        r = rng.uniform(0, 0.12)
        a.add(ribbon((math.cos(ang) * r, math.sin(ang) * r), rng.uniform(0.45, 0.9), rng.uniform(0.05, 0.08),
                     rng.uniform(0.05, 0.2), rng.uniform(0, 6.28), segs=10, sway_phase=rng.uniform(0, 6.28),
                     wave=0.05),
              "waterweed", tint=(rng.uniform(0.8, 1.15),) * 3)
    return finish_object(a.to_object())


def _pad(rng, r):
    # 睡蓮葉:有一道缺口的圓盤,邊緣微微翹起
    notch = rng.uniform(0, 6.28)
    bm = bmesh.new()
    center = bm.verts.new((0, 0, 0.012))
    ring = []
    for k in range(29):
        a = notch + 0.32 + (2 * math.pi - 0.64) * k / 28
        rr = r * (1 + 0.04 * math.sin(a * 5))
        ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, 0.02)))
    for k in range(28):
        bm.faces.new((center, ring[k], ring[k + 1]))
    bm.normal_update()
    bm = apply_modifiers(bm, [("SOLIDIFY", dict(thickness=0.012, offset=-1.0))])
    return bm


def build_lilypad(name, seed, flower=False):
    rng = random.Random(seed)
    a = Asset(name)
    for i, (x, y, r) in enumerate(((0, 0, 0.36), (0.42, 0.18, 0.24), (-0.2, 0.4, 0.2))):
        pad = _pad(rng, r)
        bmesh.ops.translate(pad, vec=Vector((x, y, 0)), verts=pad.verts)
        a.add(pad, "lilypad")
    if flower:
        # 粉白的睡蓮花:兩圈尖花瓣 + 黃色花心
        for ring, (n, length, lift, tint) in enumerate(((8, 0.13, 0.35, (1.0, 0.78, 0.86)), (6, 0.1, 0.8, (1.0, 0.9, 0.94)))):
            for k in range(n):
                ang = k / n * 2 * math.pi + ring * 0.4
                pet = blob(1.0, 2, (length, 0.035, 0.02), loc=(0, 0, 0), amp=0.0)
                for v in pet.verts:
                    v.co.x += length
                bmesh.ops.rotate(pet, cent=Vector((0, 0, 0)), verts=pet.verts,
                                 matrix=(Matrix.Rotation(ang, 3, "Z") @ Matrix.Rotation(-lift, 3, "Y")))
                bmesh.ops.translate(pet, vec=Vector((0.05, -0.02, 0.05)), verts=pet.verts)
                a.add(pet, "petal", tint=tint)
        a.add(blob(0.035, 2, (1, 1, 0.6), loc=(0.05, -0.02, 0.07), amp=0.1), "petal", tint=(1.0, 0.78, 0.2))
    return finish_object(a.to_object())


def build_dirt_pile(name, seed):
    # 挖出來的土堆:一小丘翻鬆的土加上幾塊土塊(挖掘時在洞旁邊長大)
    rng = random.Random(seed)
    a = Asset(name)
    mound = blob(1.0, 4, (0.5, 0.42, 0.22), loc=(0, 0, 0.0), amp=0.22, freq=2.4, seed=seed, amp2=0.07, freq2=7)
    for v in mound.verts:
        if v.co.z < 0:
            v.co.z *= 0.1
    a.add(decimate(mound, 900), "dirt")
    for _ in range(9):
        ang = rng.uniform(0, 6.28)
        d = rng.uniform(0.3, 0.62)
        a.add(blob(rng.uniform(0.05, 0.1), 2, (1, 1, 0.65), loc=(math.cos(ang) * d, math.sin(ang) * d, rng.uniform(0.02, 0.12)),
                   amp=0.25, freq=2, seed=rng.random() * 9), "dirt")
    return finish_object(a.to_object())


# ================================================================ 清單

from trees import add_leaves, build_broadleaf, build_conifer, build_shrub  # noqa: E402
from characters import build_corgi, build_duck, rig_corgi, rig_duck  # noqa: E402

ASSETS = {
    # 角色:烘焙完才綁骨架、做動畫(post_bake)
    "corgi": (build_corgi, dict(seed=81), 1024, 0.3, None, {"post_bake": rig_corgi}),
    "duck": (build_duck, dict(seed=82), 1024, 0.3, None, {"post_bake": rig_duck}),
    # name: (builder, kwargs, 貼圖解析度, AO 距離[, 烘焙群組])
    "cottage": (build_cottage, dict(seed=1), 2048, 1.2, {"roof": ["thatch"]}),
    # 樹:枝幹烘焙樹皮;葉片在烘焙後加上(自帶透明葉叢貼圖),見 trees.py
    "tree_conifer_a": (build_conifer, dict(seed=11, height=7.0), 1024, 1.0, None, {"post_bake": add_leaves}),
    "tree_conifer_b": (build_conifer, dict(seed=12, height=8.0), 1024, 1.0, None, {"post_bake": add_leaves}),
    "tree_round_a": (build_broadleaf, dict(seed=21, height=7.5), 1024, 1.2, None, {"post_bake": add_leaves}),
    "tree_round_b": (build_broadleaf, dict(seed=22, height=6.5), 1024, 1.2, None, {"post_bake": add_leaves}),
    "rock_a": (build_rock, dict(seed=31, scale=(1.0, 0.8, 0.55)), 1024, 0.6),
    "rock_b": (build_rock, dict(seed=32, scale=(1.0, 0.9, 0.75)), 1024, 0.6),
    "rock_c": (build_rock, dict(seed=33, scale=(1.0, 0.55, 0.45)), 1024, 0.6),
    "bush_flower": (build_shrub, dict(seed=41, flowers=True), 512, 0.4, None, {"post_bake": add_leaves}),
    "bush": (build_shrub, dict(seed=42, flowers=False), 512, 0.4, None, {"post_bake": add_leaves}),
    "stump": (build_stump, dict(seed=51), 512, 0.4),
    "log": (build_log, dict(seed=52), 512, 0.4),
    "fence": (build_fence, dict(seed=61), 512, 0.4),
    "gate": (build_gate, dict(seed=62), 512, 0.5),
    # 橋墩伸到溝底:烘焙時不放地面(否則水面以下的木樁會被地面的 AO 壓黑)
    "bridge": (build_bridge, dict(seed=63), 1024, 0.6, None, {"ground": False}),
    "barrel": (build_barrel, dict(seed=71), 512, 0.3),
    "crate": (build_crate, dict(seed=72), 512, 0.3),
    "chest": (build_chest, dict(seed=73), 512, 0.3),
    "well": (build_well, dict(seed=74), 1024, 0.5),
    "reeds": (build_reeds, dict(seed=91), 512, 0.3),
    "waterweed": (build_waterweed, dict(seed=92), 256, 0.2, None, {"ground": False}),
    "lilypad": (build_lilypad, dict(seed=93), 256, 0.1, None, {"ground": False}),
    "lily": (build_lilypad, dict(seed=94, flower=True), 512, 0.1, None, {"ground": False}),
    "dirt_pile": (build_dirt_pile, dict(seed=95), 512, 0.3),
}
