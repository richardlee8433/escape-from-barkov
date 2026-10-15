# 角色:柯基(玩家)與鴨子(敵人,不拿槍,追到身邊用嘴啄)。程序化建模 + 骨架 + 關鍵影格動畫,匯出成帶動畫的 GLB。
#
# 角色面向 -Y(匯出後是 Three.js 的 +Z),左手邊是 +X。
# 每個零件剛性綁在一根骨頭上(零件之間互相重疊,轉動時不會露縫),一個角色一個 draw call。
# 動畫一律以「世界軸角度」描述(lib.pose):繞 X 為正 = 低頭 / 腿往後擺;
# 繞 Y = 側傾;繞 Z = 轉頭 / 搖尾。所有動畫都是無縫循環,遊戲端用 AnimationMixer 播放。

import math
import random

import bpy  # noqa: F401  (pip 版 bpy 需先載入)
import bmesh
from mathutils import Euler, Matrix, Vector

from lib import Asset, add_action, apply_modifiers, beam, blob, finish_object, make_rig, merge, pose, srgb


def sstep(e0, e1, x):
    t = (x - e0) / (e1 - e0)
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return t * t * (3 - 2 * t)


def mixc(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _remesh(bm, voxel, tris):
    bm = apply_modifiers(bm, [("REMESH", dict(mode="VOXEL", voxel_size=voxel, adaptivity=0.0))])
    for _ in range(2):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    cur = sum(len(f.verts) - 2 for f in bm.faces)
    if cur > tris:
        bm = apply_modifiers(bm, [("DECIMATE", dict(ratio=tris / cur))])
    bm.normal_update()
    return bm


def soft(r, loc, scale=(1, 1, 1), sub=3, amp=0.03, seed=0.0):
    """角色用的圓潤團塊(雜訊很小,只是讓輪廓不死板)。"""
    return blob(r, sub, scale, loc=loc, amp=amp, freq=1.5, seed=seed)


def limb(a, b, r1, r2, segs=10):
    from lib import cylinder
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = cylinder(r1, r2, d.length, segs, caps=True)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=a, verts=bm.verts)
    bm.normal_update()
    return bm


def transform(bm, rot=(0, 0, 0), loc=(0, 0, 0), scale=(1, 1, 1)):
    m = (Matrix.Translation(Vector(loc)) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
         @ Matrix.Diagonal((*scale, 1.0)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bm.normal_update()
    return bm


# ================================================================ 柯基

ORANGE = srgb("#cf7a2e")
ORANGE_DARK = srgb("#a65a1f")
WHITE = srgb("#f3ede1")
PINK = srgb("#d9958a")

CORGI_BONES = [
    ("root", (0, 0, 0), None),
    ("body", (0, 0, 0.42), "root"),
    ("head", (0, -0.44, 0.6), "body"),
    ("ear_L", (0.095, -0.5, 0.78), "head"),
    ("ear_R", (-0.095, -0.5, 0.78), "head"),
    ("tail", (0, 0.44, 0.5), "body"),
    ("leg_FL", (0.14, -0.3, 0.36), "body"),
    ("leg_FR", (-0.14, -0.3, 0.36), "body"),
    ("leg_BL", (0.15, 0.28, 0.36), "body"),
    ("leg_BR", (-0.15, 0.28, 0.36), "body"),
]


def build_corgi(name, seed):
    a = Asset(name)

    # ---- 身體:胸、臀、頸三團融合;肚子、胸前圍兜、屁股是白的
    torso = _remesh(merge(
        soft(1.0, (0, -0.16, 0.45), (0.25, 0.3, 0.24), 4),
        soft(1.0, (0, 0.2, 0.43), (0.24, 0.28, 0.23), 4, seed=2),
        soft(1.0, (0, -0.37, 0.56), (0.15, 0.14, 0.16), 3, seed=3),
    ), 0.022, 2400)

    def torso_col(co, n):
        white = max(
            sstep(0.40, 0.31, co.z),                                   # 肚子
            sstep(-0.30, -0.42, co.y) * sstep(0.64, 0.5, co.z),         # 胸前圍兜
            sstep(0.36, 0.47, co.y) * sstep(0.56, 0.42, co.z),          # 白屁股
        )
        back = sstep(0.55, 0.68, co.z) * 0.35                           # 背上深一點
        return mixc(mixc(ORANGE, ORANGE_DARK, back), WHITE, white)
    a.add(torso, "fur", bone="body", color_fn=torso_col)

    # ---- 頭:頭殼 + 雙頰 + 吻部,白色鼻樑(blaze)與吻部
    head = _remesh(merge(
        soft(1.0, (0, -0.52, 0.69), (0.16, 0.17, 0.15), 4),
        soft(1.0, (0.08, -0.58, 0.635), (0.09, 0.09, 0.08), 3, seed=4),
        soft(1.0, (-0.08, -0.58, 0.635), (0.09, 0.09, 0.08), 3, seed=5),
        soft(1.0, (0, -0.7, 0.625), (0.075, 0.12, 0.07), 3, seed=6),
    ), 0.014, 1800)

    def head_col(co, n):
        white = max(
            sstep(-0.62, -0.69, co.y),                                       # 吻部
            sstep(0.62, 0.575, co.z) * sstep(-0.5, -0.57, co.y),              # 下巴與頰下
            sstep(0.05, 0.022, abs(co.x)) * sstep(-0.55, -0.63, co.y),        # 鼻樑白線
        )
        return mixc(ORANGE, WHITE, white)
    a.add(head, "fur", bone="head", color_fn=head_col)
    a.add(soft(0.036, (0, -0.818, 0.648), (1.1, 0.9, 0.85), 2, amp=0.0), "glossy_black", bone="head")
    for sx in (1, -1):
        a.add(soft(0.026, (sx * 0.074, -0.655, 0.718), (1, 0.7, 1), 2, amp=0.0), "glossy_black", bone="head")

    # ---- 大尖耳:扁圓錐,朝前那面是粉紅色的內耳
    for sx, bname in ((1, "ear_L"), (-1, "ear_R")):
        from lib import cylinder
        ear = cylinder(0.078, 0.006, 0.23, 12, caps=True)
        transform(ear, scale=(1.0, 0.42, 1.0))
        transform(ear, rot=(-8, sx * 16, 0), loc=(sx * 0.095, -0.5, 0.76))

        def ear_col(co, n, sx=sx):
            return mixc(ORANGE, PINK, sstep(-0.2, -0.6, n.y) * sstep(0.08, 0.06, abs(co.x - sx * 0.1)))
        a.add(ear, "fur", bone=bname, color_fn=ear_col)

    # ---- 短腿:前腿直、後腿有大腿肉;腳掌白襪
    def leg_col(co, n):
        return mixc(ORANGE, WHITE, sstep(0.24, 0.16, co.z))
    for sx, f_name, b_name in ((1, "leg_FL", "leg_BL"), (-1, "leg_FR", "leg_BR")):
        a.add(limb((sx * 0.14, -0.3, 0.38), (sx * 0.14, -0.31, 0.07), 0.066, 0.056), "fur", bone=f_name, color_fn=leg_col)
        a.add(soft(1.0, (sx * 0.14, -0.335, 0.045), (0.07, 0.09, 0.045), 3), "fur", bone=f_name, color_fn=leg_col)
        a.add(soft(1.0, (sx * 0.15, 0.27, 0.36), (0.1, 0.13, 0.13), 3, seed=sx), "fur", bone=b_name, color_fn=leg_col)
        a.add(limb((sx * 0.15, 0.29, 0.32), (sx * 0.15, 0.29, 0.07), 0.066, 0.056), "fur", bone=b_name, color_fn=leg_col)
        a.add(soft(1.0, (sx * 0.15, 0.265, 0.045), (0.07, 0.09, 0.045), 3), "fur", bone=b_name, color_fn=leg_col)

    # ---- 短尾巴(潘布魯克的小毛球)
    a.add(soft(1.0, (0, 0.47, 0.5), (0.075, 0.075, 0.065), 3), "fur", bone="tail",
          color_fn=lambda co, n: mixc(ORANGE, WHITE, sstep(0.48, 0.42, co.z)))
    return finish_object(a.to_object())


def rig_corgi(ob):
    arm = make_rig(ob, CORGI_BONES, "corgi_rig")
    two_pi = 2 * math.pi

    def idle(t):
        pose(arm, "root", loc=(0, 0, 0.006 * math.sin(two_pi * t)))
        pose(arm, "head", rot=(0, 4 * math.sin(two_pi * t), 6 * math.sin(two_pi * t + 1)))
        pose(arm, "tail", rot=(0, 0, 24 * math.sin(2 * two_pi * t)))
        twitch = max(0.0, math.sin(3 * two_pi * t)) ** 6
        pose(arm, "ear_L", rot=(-10 * twitch, 0, 0))

    def walk(t):
        s = math.sin(two_pi * t)
        for b, k in (("leg_FL", 1), ("leg_BR", 1), ("leg_FR", -1), ("leg_BL", -1)):
            pose(arm, b, rot=(28 * s * k, 0, 0))
        pose(arm, "root", loc=(0, 0, 0.012 * (1 - math.cos(2 * two_pi * t)) / 2))
        pose(arm, "body", rot=(0, 3 * s, 0))
        pose(arm, "head", rot=(3 * math.sin(2 * two_pi * t), 0, 0))
        pose(arm, "tail", rot=(0, 0, 16 * s))

    def run(t):
        # 跳躍步態:前腿一組、後腿一組交替
        ph = two_pi * t
        pose(arm, "leg_FL", rot=(45 * math.sin(ph), 0, 0))
        pose(arm, "leg_FR", rot=(45 * math.sin(ph - 0.4), 0, 0))
        pose(arm, "leg_BL", rot=(-45 * math.sin(ph - 0.3), 0, 0))
        pose(arm, "leg_BR", rot=(-45 * math.sin(ph - 0.7), 0, 0))
        pose(arm, "body", rot=(7 * math.cos(ph), 0, 0))
        pose(arm, "root", loc=(0, 0, 0.05 * max(0.0, math.sin(ph))))
        pose(arm, "head", rot=(-6 - 4 * math.cos(ph), 0, 0))
        for e in ("ear_L", "ear_R"):
            pose(arm, e, rot=(-25, 0, 0))
        pose(arm, "tail", rot=(0, 0, 10 * math.sin(2 * ph)))

    def dig(t):
        # 低頭翹屁股,前腳輪流往後扒土,尾巴猛搖
        ph = two_pi * t
        pose(arm, "root", loc=(0, 0.02, -0.03))
        pose(arm, "body", rot=(16, 0, 0))
        pose(arm, "leg_FL", rot=(-55 + 85 * (0.5 + 0.5 * math.sin(ph)), 0, 0))
        pose(arm, "leg_FR", rot=(-55 + 85 * (0.5 + 0.5 * math.sin(ph + math.pi)), 0, 0))
        for b in ("leg_BL", "leg_BR"):
            pose(arm, b, rot=(-14, 0, 0))
        pose(arm, "head", rot=(12 + 4 * math.sin(2 * ph), 0, 0))
        pose(arm, "tail", rot=(0, 0, 30 * math.sin(2 * ph)))
        for e in ("ear_L", "ear_R"):
            pose(arm, e, rot=(-10, 0, 0))

    def proud(t):
        # 挖到寶之後:挺胸抬頭看鏡頭、歪頭撒嬌、前腳輪流抬起討摸、尾巴猛搖、小跳兩下
        ph = 2 * math.pi * t
        pose(arm, "root", loc=(0, 0, 0.045 * abs(math.sin(2 * ph))))
        pose(arm, "body", rot=(-14, 4 * math.sin(ph), 0))
        pose(arm, "head", rot=(-16, 14 * math.sin(ph), 4 * math.sin(ph + 0.6)))
        pose(arm, "tail", rot=(0, 0, 38 * math.sin(6 * ph)))
        pose(arm, "leg_FL", rot=(-25 - 30 * max(0.0, math.sin(2 * ph)), 0, 0))
        pose(arm, "leg_FR", rot=(-25 - 30 * max(0.0, -math.sin(2 * ph)), 0, 0))
        for b in ("leg_BL", "leg_BR"):
            pose(arm, b, rot=(10, 0, 0))
        for e in ("ear_L", "ear_R"):
            pose(arm, e, rot=(-14 + 6 * math.sin(4 * ph), 0, 0))

    add_action(arm, "Idle", 60, idle)
    add_action(arm, "Walk", 24, walk)
    add_action(arm, "Run", 14, run)
    add_action(arm, "Dig", 12, dig)
    add_action(arm, "Proud", 48, proud)
    return arm


# ================================================================ 鴨子

DUCK_WHITE = srgb("#f4f0e6")
DUCK_GREY = srgb("#cfc8b8")
DUCK_ORANGE = srgb("#f0912a")

DUCK_BONES = [
    ("root", (0, 0, 0), None),
    ("body", (0, 0.02, 0.3), "root"),
    ("head", (0, -0.08, 0.62), "body"),
    ("wing_L", (0.24, 0.0, 0.56), "body"),
    ("wing_R", (-0.24, 0.0, 0.56), "body"),
    ("tail", (0, 0.28, 0.5), "body"),
    ("leg_L", (0.1, 0.0, 0.24), "root"),
    ("leg_R", (-0.1, 0.0, 0.24), "root"),
]


def build_duck(name, seed):
    a = Asset(name)

    body = _remesh(merge(
        soft(1.0, (0, 0.02, 0.44), (0.25, 0.3, 0.27), 4),
        soft(1.0, (0, -0.08, 0.66), (0.12, 0.12, 0.15), 3, seed=2),       # 頸
        soft(1.0, (0, 0.3, 0.56), (0.1, 0.09, 0.08), 3, seed=3),          # 尾羽
    ), 0.02, 2200)
    a.add(body, "fur", bone="body",
          color_fn=lambda co, n: mixc(DUCK_WHITE, DUCK_GREY, sstep(0.25, 0.4, co.y) * 0.5))

    head = _remesh(soft(1.0, (0, -0.1, 0.84), (0.16, 0.16, 0.155), 4), 0.016, 1200)
    a.add(head, "fur", bone="head", color_fn=lambda co, n: DUCK_WHITE)
    a.add(soft(1.0, (0, -0.28, 0.8), (0.085, 0.105, 0.032), 3, amp=0.0), "beak", tint=DUCK_ORANGE, bone="head")
    a.add(soft(1.0, (0, -0.255, 0.772), (0.07, 0.085, 0.02), 3, amp=0.0), "beak", tint=srgb("#d97a1c"), bone="head")
    for sx in (1, -1):
        a.add(soft(0.026, (sx * 0.088, -0.215, 0.875), (0.8, 0.8, 1), 2, amp=0.0), "glossy_black", bone="head")

    # 軍用小頭盔:半球殼 + 帽簷
    shell = bmesh.new()
    bmesh.ops.create_uvsphere(shell, u_segments=20, v_segments=10, radius=0.178)
    bmesh.ops.delete(shell, geom=[v for v in shell.verts if v.co.z < -0.01], context="VERTS")
    transform(shell, scale=(1, 1.05, 0.78), loc=(0, -0.08, 0.9))
    shell = apply_modifiers(shell, [("SOLIDIFY", dict(thickness=0.015, offset=1.0))])
    a.add(shell, "helmet", bone="head")
    from lib import cylinder
    brim = cylinder(0.205, 0.205, 0.016, 24, loc=(0, -0.1, 0.892))
    a.add(brim, "helmet", bone="head")

    # 翅膀(尖端灰)
    for sx, bname in ((1, "wing_L"), (-1, "wing_R")):
        w = soft(1.0, (0, 0, 0), (0.06, 0.2, 0.14), 3, seed=sx)
        transform(w, rot=(-12, sx * -8, 0), loc=(sx * 0.25, 0.05, 0.46))
        a.add(w, "fur", bone=bname,
              color_fn=lambda co, n: mixc(DUCK_WHITE, DUCK_GREY, sstep(0.08, 0.22, co.y)))

    # 橘色細腿與蹼
    for sx, bname in ((1, "leg_L"), (-1, "leg_R")):
        a.add(limb((sx * 0.1, 0.0, 0.25), (sx * 0.1, 0.0, 0.04), 0.03, 0.026, 8), "beak", tint=DUCK_ORANGE, bone=bname)
        a.add(soft(1.0, (sx * 0.1, -0.07, 0.022), (0.075, 0.1, 0.02), 3, amp=0.0), "beak", tint=DUCK_ORANGE, bone=bname)

    return finish_object(a.to_object())


def rig_duck(ob):
    arm = make_rig(ob, DUCK_BONES, "duck_rig")
    two_pi = 2 * math.pi

    def idle(t):
        pose(arm, "root", loc=(0, 0, 0.008 * math.sin(two_pi * t)))
        pose(arm, "head", rot=(0, 0, 18 * math.sin(two_pi * t)))
        pose(arm, "tail", rot=(0, 0, 10 * math.sin(2 * two_pi * t)))

    def walk(t):
        # 搖搖擺擺:身體左右側傾、腳一前一後
        s = math.sin(two_pi * t)
        pose(arm, "leg_L", rot=(25 * s, 0, 0))
        pose(arm, "leg_R", rot=(-25 * s, 0, 0))
        pose(arm, "body", rot=(0, 9 * s, 4 * s))
        pose(arm, "root", loc=(0, 0, 0.02 * (1 - math.cos(2 * two_pi * t)) / 2))
        pose(arm, "head", rot=(5 * math.sin(2 * two_pi * t), 0, 0))
        pose(arm, "wing_L", rot=(0, 5 * s, 0))
        pose(arm, "wing_R", rot=(0, 5 * s, 0))
        pose(arm, "tail", rot=(0, 0, 12 * s))

    def run(t):
        # 前傾衝刺、拍翅
        ph = two_pi * t
        s = math.sin(ph)
        pose(arm, "body", rot=(14, 6 * s, 0))
        pose(arm, "leg_L", rot=(45 * s, 0, 0))
        pose(arm, "leg_R", rot=(-45 * s, 0, 0))
        pose(arm, "root", loc=(0, 0, 0.04 * abs(s)))
        flap = 38 * (0.5 + 0.5 * math.sin(2 * ph))
        pose(arm, "wing_L", rot=(0, flap, 0))
        pose(arm, "wing_R", rot=(0, -flap, 0))
        pose(arm, "head", rot=(-8, 0, 0))
        pose(arm, "tail", rot=(0, 0, 8 * math.sin(2 * ph)))

    def peck(t):
        # 啄擊(單次播放,0.5 秒):前 0.35 秒往後仰、張翅蓄力(= 遊戲的前搖),接著猛力往前啄
        if t < 0.7:
            k = math.sin(t / 0.7 * math.pi / 2)
            pose(arm, "body", rot=(-12 * k, 0, 0))
            pose(arm, "head", rot=(-22 * k, 0, 0))
            pose(arm, "wing_L", rot=(0, 30 * k, 0))
            pose(arm, "wing_R", rot=(0, -30 * k, 0))
        else:
            k = math.sin((t - 0.7) / 0.3 * math.pi)
            pose(arm, "body", rot=(28 * k, 0, 0))
            pose(arm, "head", rot=(40 * k, 0, 0))
            pose(arm, "root", loc=(0, -0.08 * k, 0))
            pose(arm, "wing_L", rot=(0, 45 * k, 0))
            pose(arm, "wing_R", rot=(0, -45 * k, 0))

    add_action(arm, "Idle", 60, idle)
    add_action(arm, "Walk", 24, walk)
    add_action(arm, "Run", 14, run)
    add_action(arm, "Peck", 15, peck)
    return arm
