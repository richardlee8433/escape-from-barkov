"""柯基的家:鄉村小屋的室內。一開始破破爛爛,用挖到的東西一樣一樣修好。

每一件可以修的東西都有「壞的」與「修好的」兩個模型(例如 home_floor_broken / home_floor),
遊戲端修好時換模型。所有零件都在同一個房間座標裡建模,遊戲端原點直接疊在一起,不用再擺位置。

座標(Blender,公尺,遊戲端整體放大 1.4 倍):
  房間內部 x ∈ [-4.5, 4.5]、y ∈ [-3.5, 3.5]、牆高 3.2
  y = +3.5 是後牆(離鏡頭最遠,有窗)、x = -4.5 是左牆(壁爐);
  y = -3.5 前牆與 x = +4.5 右牆在鏡頭這一側,只做到膝蓋高(剖面式的室內),右牆開門。
"""

import math
import random

import bpy  # noqa: F401
import bmesh
from mathutils import Matrix, Vector

from lib import Asset, beam, blob, finish_object, merge, srgb
from characters import limb, transform

X0, X1, Y0, Y1 = -4.5, 4.5, -3.5, 3.5
H, T, KNEE = 3.2, 0.25, 0.55
WIN = (-2.2, -0.8, 1.0, 2.1)          # 後牆窗洞 x0, x1, z0, z1
DOOR = (-1.7, -0.5)                   # 右牆門口 y 範圍
FIRE_Y = (0.0, 2.0)                   # 壁爐沿左牆的範圍
FLOOR_HOLES = [(1.9, -1.6, 0.65), (-1.9, 1.2, 0.6)]
ROOF_HOLES = [(0.6, 1.4), (-1.2, -2.0), (3.0, -1.2)]


def _rng(seed):
    return random.Random(seed)


def _tint(rng, lo=0.85, hi=1.08):
    return (rng.uniform(lo, hi),) * 3


# ================================================================ 牆與骨架

def build_home_shell(name, seed):
    rng = _rng(seed)
    a = Asset(name)

    def plaster(x0, x1, y0, y1, z0, z1):
        # 直立的方塊:up=(1,0,0) 時 beam 的寬度沿 Y、高度沿 X
        a.add(beam(((x0 + x1) / 2, (y0 + y1) / 2, z0), ((x0 + x1) / 2, (y0 + y1) / 2, z1),
                   y1 - y0, x1 - x0, 0.01, up=(1, 0, 0)), "plaster", smooth=False)

    def tb(p, q, w=0.18, mat="timber"):
        a.add(beam(p, q, w, w, 0.02), mat, tint=_tint(rng), smooth=False)

    yb = Y1 + T / 2  # 後牆中線
    # 後牆:窗洞左右兩段 + 窗下 + 窗上
    wx0, wx1, wz0, wz1 = WIN
    plaster(X0 - T, wx0, Y1, Y1 + T, 0, H)
    plaster(wx1, X1 + T, Y1, Y1 + T, 0, H)
    plaster(wx0, wx1, Y1, Y1 + T, 0, wz0)
    plaster(wx0, wx1, Y1, Y1 + T, wz1, H)
    # 左牆(整面)
    plaster(X0 - T, X0, Y0 - T, Y1 + T, 0, H)
    # 鏡頭這側只到膝蓋:前牆、右牆(右牆留門口)
    plaster(X0 - T, X1 + T, Y0 - T, Y0, 0, KNEE)
    plaster(X1, X1 + T, Y0 - T, DOOR[0], 0, KNEE)
    plaster(X1, X1 + T, DOOR[1], Y1 + T, 0, KNEE)

    # ---- 木骨架(貼在牆的內側)
    yi = Y1 - 0.06
    tb((X0, yi, 0.12), (X1, yi, 0.12))                 # 地檻
    tb((X0, yi, H - 0.1), (X1, yi, H - 0.1))           # 頂樑
    for x in (-4.3, -2.45, -0.55, 1.0, 3.0, 4.3):
        tb((x, yi, 0.1), (x, yi, H - 0.1))
    tb((-0.55, yi, 0.3), (1.0, yi, 2.6))               # 斜撐
    tb((3.0, yi, 0.3), (4.3, yi, 2.4))
    tb((-4.3, yi, 2.6), (-2.45, yi, 1.2))
    tb((wx0 - 0.1, yi, wz1 + 0.12), (wx1 + 0.1, yi, wz1 + 0.12))
    xi = X0 + 0.06
    tb((xi, Y0, 0.12), (xi, Y1, 0.12))
    tb((xi, Y0, H - 0.1), (xi, Y1, H - 0.1))
    for y in (-3.3, -1.6, 2.4, 3.3):
        tb((xi, y, 0.1), (xi, y, H - 0.1))
    tb((xi, -3.3, 0.4), (xi, -1.6, 2.4))
    # 矮牆的壓頂木
    tb((X0 - T, Y0 - T / 2, KNEE + 0.06), (X1 + T, Y0 - T / 2, KNEE + 0.06), 0.3)
    tb((X1 + T / 2, Y0 - T, KNEE + 0.06), (X1 + T / 2, DOOR[0], KNEE + 0.06), 0.3)
    tb((X1 + T / 2, DOOR[1], KNEE + 0.06), (X1 + T / 2, Y1 + T, KNEE + 0.06), 0.3)
    # 轉角柱:後面兩根到頂,前面只到矮牆
    for (x, y, top) in ((X0 - T / 2, Y1 + T / 2, H), (X1 + T / 2, Y1 + T / 2, H),
                        (X0 - T / 2, Y0 - T / 2, H), (X1 + T / 2, Y0 - T / 2, KNEE + 0.12)):
        tb((x, y, 0), (x, y, top), 0.28)
    # 門框(短,鏡頭這一側)
    for y in DOOR:
        tb((X1 + T / 2, y, 0), (X1 + T / 2, y, 1.05), 0.22, "wood_door")
    # 門口內側的地墊
    mat = beam((X1 - 0.55, -1.1, 0.06), (X1 - 0.05, -1.1, 0.06), 1.1, 0.02, 0.01)
    a.add(mat, "cloth", tint=srgb("#8a6a3e"), smooth=False)
    return finish_object(a.to_object(), 50)


# ================================================================ 地板

def _floor(name, seed, broken):
    rng = _rng(seed)
    a = Asset(name)
    # 地板底下的泥土(破洞看得到)
    a.add(beam((X0, 0, -0.18), (X1, 0, -0.18), Y1 - Y0, 0.2, 0.0), "dirt", smooth=False)
    w = 0.26
    y = Y0
    while y < Y1 - 1e-6:
        y1 = min(Y1, y + w)
        yc = (y + y1) / 2
        cuts = [X0]
        x = X0 + rng.uniform(0.4, 2.0)
        while x < X1 - 0.6:
            cuts.append(x)
            x += rng.uniform(1.8, 3.4)
        cuts.append(X1)
        pieces = [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)]
        if broken:
            # 從每塊木板挖掉落在破洞裡的那一段
            for hx, hy, hr in FLOOR_HOLES:
                dy = abs(yc - hy)
                if dy >= hr:
                    continue
                c = math.sqrt(hr * hr - dy * dy) * rng.uniform(0.75, 1.15)
                nxt = []
                for (xa, xb) in pieces:
                    if xb <= hx - c or xa >= hx + c:
                        nxt.append((xa, xb))
                        continue
                    if xa < hx - c:
                        nxt.append((xa, hx - c))
                    if xb > hx + c:
                        nxt.append((hx + c, xb))
                pieces = nxt
                # 斷掉的木板一端垂進洞裡
                if rng.random() < 0.6:
                    sx = hx - c if rng.random() < 0.5 else hx + c
                    d = 1 if sx < hx else -1
                    a.add(beam((sx, yc, 0.03), (sx + d * rng.uniform(0.35, 0.6), yc, -0.16), w - 0.02, 0.05, 0.006),
                          "wood_weathered", tint=_tint(rng, 0.7, 0.9), smooth=False)
        for (xa, xb) in pieces:
            if xb - xa < 0.08:
                continue
            tone = _tint(rng, 0.72, 0.92) if broken else _tint(rng, 0.88, 1.08)
            a.add(beam((xa + 0.004, yc, 0.025), (xb - 0.004, yc, 0.025), w - 0.01, 0.05, 0.008),
                  "wood_weathered" if broken else "wood_light", tint=tone, smooth=False)
        y = y1
    return finish_object(a.to_object(), 50)


def build_home_floor(name, seed):
    return _floor(name, seed, False)


def build_home_floor_broken(name, seed):
    return _floor(name, seed, True)


# ================================================================ 壁爐

def _stones(a, rng, n, x0, x1, y0, y1, z, size=(0.12, 0.2)):
    for _ in range(n):
        r = rng.uniform(*size)
        a.add(blob(r, 2, (1.0, 0.85, 0.6), loc=(rng.uniform(x0, x1), rng.uniform(y0, y1), z + r * 0.45),
                   amp=0.22, freq=2.0, seed=rng.random() * 50), "stone_found", smooth=True)


def _fireplace(name, seed, broken):
    rng = _rng(seed)
    a = Asset(name)
    fy0, fy1 = FIRE_Y
    xb, xf = X0, X0 + 0.6        # 壁爐從左牆往室內凸出 0.6
    # 爐床石板
    a.add(beam((xb, (fy0 + fy1) / 2, 0.04), (xf + 0.5, (fy0 + fy1) / 2, 0.04), fy1 - fy0 + 0.4, 0.08, 0.02),
          "stone_dark", smooth=False)
    # 爐膛背板
    a.add(beam((xb, (fy0 + fy1) / 2, 0.0), (xb, (fy0 + fy1) / 2, 1.2), fy1 - fy0 - 0.5, 0.15, 0.0, up=(1, 0, 0)),
          "stone_dark", smooth=False)
    jamb_h = 0.55 if broken else 1.2
    # 左右爐柱(壞的那一邊塌了一半)
    a.add(beam(((xb + xf) / 2, fy0 + 0.22, 0), ((xb + xf) / 2, fy0 + 0.22, jamb_h), 0.44, xf - xb, 0.02, up=(1, 0, 0)),
          "chimney", smooth=False)
    a.add(beam(((xb + xf) / 2, fy1 - 0.22, 0), ((xb + xf) / 2, fy1 - 0.22, 1.2), 0.44, xf - xb, 0.02, up=(1, 0, 0)),
          "chimney", smooth=False)
    if broken:
        # 楣樑斷了斜躺,煙囪胸牆只剩下半段,石頭散在爐床與地上,爐膛裡只有一堆冷灰
        a.add(beam((xf - 0.1, fy0 + 0.2, 0.55), (xf - 0.05, fy1 - 0.1, 1.3), 0.25, 0.22, 0.02),
              "timber", tint=(0.7, 0.7, 0.7), smooth=False)
        a.add(beam(((xb + xf - 0.1) / 2, (fy0 + fy1) / 2, 1.2), ((xb + xf - 0.1) / 2, (fy0 + fy1) / 2, 2.1),
                   fy1 - fy0, xf - xb - 0.1, 0.02, up=(1, 0, 0)), "chimney", smooth=False)
        _stones(a, rng, 9, xf - 0.1, xf + 0.9, fy0 - 0.2, fy0 + 0.9, 0.0)
        a.add(blob(0.35, 3, (1.0, 1.3, 0.25), loc=(xb + 0.3, (fy0 + fy1) / 2, 0.08), amp=0.2, freq=2, seed=3),
              "dirt", tint=(0.45, 0.43, 0.42))
    else:
        # 楣樑、壁爐架(可以擺東西)、煙囪胸牆到頂
        a.add(beam(((xb + xf) / 2, fy0, 1.32), ((xb + xf) / 2, fy1, 1.32), xf - xb, 0.24, 0.02), "timber",
              tint=(0.95, 0.95, 0.95), smooth=False)
        a.add(beam((xb + 0.42, fy0 - 0.12, 1.49), (xb + 0.42, fy1 + 0.12, 1.49), 0.84, 0.1, 0.02),
              "wood_door", smooth=False)
        a.add(beam(((xb + xf - 0.1) / 2, (fy0 + fy1) / 2, 1.54), ((xb + xf - 0.1) / 2, (fy0 + fy1) / 2, H),
                   fy1 - fy0 - 0.2, xf - xb - 0.1, 0.02, up=(1, 0, 0)), "chimney", smooth=False)
        # 柴架與木柴(火焰在遊戲端畫)
        for y in (fy0 + 0.6, fy1 - 0.6):
            a.add(beam((xb + 0.15, y, 0.12), (xb + 0.5, y, 0.12), 0.04, 0.04, 0.0), "iron", smooth=False)
        for k, (y0, y1) in enumerate(((fy0 + 0.5, fy1 - 0.45), (fy0 + 0.6, fy1 - 0.55))):
            log = limb((xb + 0.28 + k * 0.08, y0, 0.2 + k * 0.1), (xb + 0.22 + k * 0.1, y1, 0.22 + k * 0.08),
                       0.07, 0.065, 10)
            a.add(log, "bark")
    return finish_object(a.to_object(), 50)


def build_home_fireplace(name, seed):
    return _fireplace(name, seed, False)


def build_home_fireplace_broken(name, seed):
    return _fireplace(name, seed, True)


# ================================================================ 窗

def _window(name, seed, broken):
    rng = _rng(seed)
    a = Asset(name)
    wx0, wx1, wz0, wz1 = WIN
    yi = Y1 + 0.02
    fw = 0.09

    def frame(p, q, w=fw, mat="wood_light", tint=(1, 1, 1)):
        a.add(beam(p, q, w, w, 0.01), mat, tint=tint, smooth=False)

    if broken:
        # 沒有玻璃、窗框歪一邊,三片舊木板斜釘在窗洞上
        frame((wx0, yi, wz0), (wx0, yi, wz1), mat="wood_weathered", tint=(0.8, 0.8, 0.8))
        frame((wx1, yi, wz0), (wx1 - 0.05, yi, wz1 - 0.2), mat="wood_weathered", tint=(0.8, 0.8, 0.8))
        for k in range(3):
            z0 = wz0 + 0.1 + k * 0.33
            a.add(beam((wx0 - 0.15, Y1 - 0.04, z0 + rng.uniform(-0.05, 0.1)),
                       (wx1 + 0.15, Y1 - 0.04, z0 + rng.uniform(0.15, 0.35)), 0.22, 0.04, 0.01, up=(0, -1, 0)),
                  "wood_weathered", tint=_tint(rng, 0.75, 0.95), smooth=False)
        a.add(beam((wx0 - 0.1, Y1 - 0.12, wz0 - 0.08), (wx1 + 0.05, Y1 - 0.18, wz0 - 0.15), 0.22, 0.05, 0.01),
              "wood_weathered", tint=(0.75, 0.75, 0.75), smooth=False)
    else:
        a.add(beam(((wx0 + wx1) / 2, Y1 + 0.12, wz0), ((wx0 + wx1) / 2, Y1 + 0.12, wz1), 0.03, wx1 - wx0, 0.0),
              "window_glass", smooth=False)
        for x in (wx0, (wx0 + wx1) / 2, wx1):
            frame((x, yi, wz0), (x, yi, wz1))
        for z in (wz0, (wz0 + wz1) / 2, wz1):
            frame((wx0, yi, z), (wx1, yi, z))
        # 窗台(可以擺東西)
        a.add(beam((wx0 - 0.15, Y1 - 0.13, wz0 - 0.04), (wx1 + 0.15, Y1 - 0.13, wz0 - 0.04), 0.32, 0.06, 0.012),
              "wood_light", smooth=False)
        # 窗簾桿與兩片窗簾(格紋暖紅,往兩側收)
        a.add(limb((wx0 - 0.45, Y1 - 0.12, wz1 + 0.2), (wx1 + 0.45, Y1 - 0.12, wz1 + 0.2), 0.02, 0.02, 8), "iron")

        def curtain(xa, xb):
            def fn(u, v):
                x = xa + (xb - xa) * u
                return Vector((x, Y1 - 0.12 - 0.05 * math.sin(u * math.pi * 5) * (0.6 + 0.4 * v),
                               wz0 - 0.15 + (wz1 + 0.18 - (wz0 - 0.15)) * v))
            from lib import grid
            g = grid(14, 6, fn)
            g = _solid(g, 0.015)

            def plaid(co, n):
                c1, c2 = srgb("#a8403a"), srgb("#e6d6b8")
                k = (math.sin(co.x * 40) > 0.6) or (math.sin(co.z * 40) > 0.6)
                return c2 if k else c1
            a.add(g, "cloth", color_fn=plaid)
        curtain(wx0 - 0.42, wx0 + 0.05)
        curtain(wx1 - 0.05, wx1 + 0.42)
    return finish_object(a.to_object(), 50)


def _solid(bm, t):
    from lib import apply_modifiers
    return apply_modifiers(bm, [("SOLIDIFY", dict(thickness=t, offset=0.0))])


def build_home_window(name, seed):
    return _window(name, seed, False)


def build_home_window_broken(name, seed):
    return _window(name, seed, True)


# ================================================================ 牆架

def _bracket(a, x, z):
    a.add(beam((x, Y1 - 0.02, z - 0.04), (x, Y1 - 0.3, z - 0.04), 0.06, 0.06, 0.01), "timber", smooth=False)
    a.add(beam((x, Y1 - 0.02, z - 0.35), (x, Y1 - 0.28, z - 0.06), 0.06, 0.06, 0.01), "timber", smooth=False)


def build_home_shelf(name, seed):
    a = Asset(name)
    a.add(beam((1.0, Y1 - 0.16, 1.6), (3.0, Y1 - 0.16, 1.6), 0.32, 0.05, 0.012), "wood_light", smooth=False)
    for x in (1.3, 2.7):
        _bracket(a, x, 1.58)
    return finish_object(a.to_object(), 50)


def build_home_shelf_broken(name, seed):
    a = Asset(name)
    _bracket(a, 1.3, 1.58)
    # 木板一端掉到地上斜靠著牆,另一個支架躺在地上
    a.add(beam((1.1, Y1 - 0.6, 0.05), (2.9, Y1 - 0.1, 0.95), 0.32, 0.05, 0.012), "wood_weathered",
          tint=(0.85, 0.85, 0.85), smooth=False)
    a.add(beam((2.4, Y1 - 0.9, 0.04), (2.65, Y1 - 0.6, 0.04), 0.06, 0.06, 0.01), "timber", smooth=False)
    a.add(beam((2.3, Y1 - 0.75, 0.04), (2.75, Y1 - 0.85, 0.04), 0.06, 0.06, 0.01), "timber", smooth=False)
    return finish_object(a.to_object(), 50)


# ================================================================ 桌子

TABLE = (1.2, 0.3)


def _table_parts(rng):
    tx, ty = TABLE
    parts = [(beam((tx - 0.68, ty, 0.78), (tx + 0.68, ty, 0.78), 0.86, 0.07, 0.015), "wood_door")]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append((beam((tx + sx * 0.55, ty + sy * 0.32, 0.0), (tx + sx * 0.58, ty + sy * 0.35, 0.75),
                               0.08, 0.08, 0.01), "timber"))
    return parts


def build_home_table(name, seed):
    rng = _rng(seed)
    a = Asset(name)
    for bm, mat in _table_parts(rng):
        a.add(bm, mat, smooth=False)
    # 小板凳
    sx, sy = TABLE[0] + 0.95, TABLE[1] - 0.55
    a.add(limb((sx, sy, 0.42), (sx, sy, 0.48), 0.24, 0.24, 18), "wood_light")
    for k in range(3):
        ang = k * 2 * math.pi / 3
        a.add(limb((sx + math.cos(ang) * 0.15, sy + math.sin(ang) * 0.15, 0.42),
                   (sx + math.cos(ang) * 0.22, sy + math.sin(ang) * 0.22, 0.0), 0.03, 0.03, 8), "timber")
    return finish_object(a.to_object(), 50)


def build_home_table_broken(name, seed):
    rng = _rng(seed)
    a = Asset(name)
    tx, ty = TABLE
    # 整張桌子側翻(桌面立起來),一隻桌腳斷在旁邊
    m = (Matrix.Translation((tx, ty + 0.1, 0.43)) @ Matrix.Rotation(math.radians(88), 4, "X")
         @ Matrix.Translation((-tx, -ty, -0.43)))
    for i, (bm, mat) in enumerate(_table_parts(rng)):
        if i == 4:
            continue  # 這隻腳斷了,躺在旁邊(下面另外加)
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        a.add(bm, mat, tint=(0.82, 0.82, 0.82), smooth=False)
    a.add(beam((tx + 0.4, ty - 0.75, 0.04), (tx + 1.1, ty - 0.5, 0.04), 0.08, 0.08, 0.01), "timber",
          tint=(0.82, 0.82, 0.82), smooth=False)
    sx, sy = TABLE[0] + 1.1, TABLE[1] - 0.8
    a.add(limb((sx, sy, 0.24), (sx + 0.06, sy + 0.06, 0.24), 0.24, 0.24, 18), "wood_light",
          tint=(0.8, 0.8, 0.8))
    return finish_object(a.to_object(), 50)


# ================================================================ 狗窩、地毯、屋頂掉下來的雜物

BED = (-2.6, -1.9)


def _torus(R, r, segs=28, rsegs=10):
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        u = 2 * math.pi * i / segs
        ring = []
        for j in range(rsegs):
            v = 2 * math.pi * j / rsegs
            ring.append(bm.verts.new(((R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u),
                                      r * math.sin(v))))
        rings.append(ring)
    for i in range(segs):
        for j in range(rsegs):
            a, b = rings[i][j], rings[(i + 1) % segs][j]
            c, d = rings[(i + 1) % segs][(j + 1) % rsegs], rings[i][(j + 1) % rsegs]
            bm.faces.new((a, b, c, d))
    bm.normal_update()
    return bm


def build_home_bed(name, seed):
    a = Asset(name)
    bx, by = BED
    rim = _torus(0.82, 0.17)
    transform(rim, scale=(1.0, 0.82, 0.85), loc=(bx, by, 0.17))
    a.add(rim, "cloth", tint=srgb("#7a5a3c"))
    cushion = merge(_disc(0.78, 0.07, 64, 24))
    transform(cushion, scale=(1.0, 0.82, 1.0), loc=(bx, by, 0.08))

    def plaid(co, n):
        c1, c2, c3 = srgb("#3f6b8a"), srgb("#e9dfc6"), srgb("#a8403a")
        sx, sy = math.sin(co.x * 18) > 0.55, math.sin(co.y * 18) > 0.55
        return c3 if (sx and sy) else c2 if (sx or sy) else c1
    a.add(cushion, "cloth", color_fn=plaid)
    # 骨頭造型的小抱枕
    bone = merge(limb((bx - 0.18, by + 0.25, 0.2), (bx + 0.18, by + 0.25, 0.2), 0.05, 0.05, 10),
                 blob(0.07, 2, loc=(bx - 0.22, by + 0.28, 0.2), amp=0.0), blob(0.07, 2, loc=(bx - 0.22, by + 0.2, 0.2), amp=0.0),
                 blob(0.07, 2, loc=(bx + 0.22, by + 0.28, 0.2), amp=0.0), blob(0.07, 2, loc=(bx + 0.22, by + 0.2, 0.2), amp=0.0))
    a.add(bone, "cloth", tint=srgb("#f1eadc"))
    return finish_object(a.to_object())


def _disc(r, h, segs, rings=16):
    """扁圓盤:上面切成一圈圈的環(頂點夠密,color_fn 畫的花紋才不會被三角形平均掉),邊緣圓一點。"""
    bm = bmesh.new()
    top = [bm.verts.new((0, 0, h))]
    loops = []
    for k in range(1, rings + 1):
        rr = r * 0.96 * k / rings
        loops.append([bm.verts.new((rr * math.cos(2 * math.pi * i / segs), rr * math.sin(2 * math.pi * i / segs), h))
                      for i in range(segs)])
    # 圓角:外緣往下兩圈,再到底
    for rr, z in ((r * 0.995, h * 0.6), (r, h * 0.2), (r * 0.97, 0.0)):
        loops.append([bm.verts.new((rr * math.cos(2 * math.pi * i / segs), rr * math.sin(2 * math.pi * i / segs), z))
                      for i in range(segs)])
    c = top[0]
    for i in range(segs):
        bm.faces.new((c, loops[0][i], loops[0][(i + 1) % segs]))
    for a, b in zip(loops, loops[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], b[i], b[j], a[j]))
    bm.faces.new(list(reversed(loops[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    return bm


def build_home_rug(name, seed):
    a = Asset(name)
    cx, cy = -0.4, -0.6
    rug = _disc(1.0, 0.02, 72, 36)
    transform(rug, scale=(1.55, 1.15, 1.0), loc=(cx, cy, 0.05))

    def rings(co, n):
        d = math.hypot((co.x - cx) / 1.55, (co.y - cy) / 1.15)
        k = int(d * 9) % 4
        return (srgb("#b8743c"), srgb("#e8d8b0"), srgb("#5f7a4a"), srgb("#e8d8b0"))[k]
    a.add(rug, "cloth", color_fn=rings)
    return finish_object(a.to_object())


def build_home_debris(name, seed):
    rng = _rng(seed)
    a = Asset(name)
    from lib import blob as _blob
    for hx, hy in ROOF_HOLES:
        for _ in range(5):
            r = rng.uniform(0.18, 0.32)
            a.add(_blob(r, 2, (1.4, 1.0, 0.25), loc=(hx + rng.uniform(-0.5, 0.5), hy + rng.uniform(-0.5, 0.5), 0.07),
                        amp=0.3, freq=2.5, seed=rng.random() * 40), "thatch")
        for _ in range(2):
            x, y = hx + rng.uniform(-0.6, 0.6), hy + rng.uniform(-0.6, 0.6)
            ang = rng.uniform(0, math.pi)
            a.add(beam((x, y, 0.07), (x + math.cos(ang) * 0.7, y + math.sin(ang) * 0.7, 0.12), 0.14, 0.04, 0.01),
                  "wood_weathered", tint=_tint(rng, 0.7, 0.9), smooth=False)
    return finish_object(a.to_object())
