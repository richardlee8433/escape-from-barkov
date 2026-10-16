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
# 參考真的潘布魯克柯基:身體長而低、深胸垂得很低、圓圓的屁股、粗脖子,
# 狐狸臉(楔形頭殼、收尖的吻部)、又高又尖的立耳、超短腿、蓬鬆尾巴。
# 毛色:紅貂色(背上較深)、白色胸前圍兜/肚子/吻部/鼻樑白線/四隻白襪。
# 表情:張嘴微笑吐舌頭、杏眼帶高光點。
#
# 身體(軀幹、脖子、頭、下巴、四肢、尾巴)是一整張 metaball 皮膚,各部位平滑融合;
# 每個頂點依「各部位 metaball 場強」分配骨頭權重,脖子、肩膀、大腿轉動時是平滑變形。
# 眼睛、鼻子、耳朵、舌頭這些小零件才剛性綁在單一骨頭上。

RED = srgb("#d1874d")        # 紅貂色(身體側面)
RED_DARK = srgb("#ab6331")   # 背上的鞍部
CREAM = srgb("#f1eadc")      # 白毛
CREAM_WARM = srgb("#ead7bb")  # 白與紅之間的過渡
PINK = srgb("#e0a596")       # 內耳
TONGUE = srgb("#e27886")
MOUTH = srgb("#4a2224")

CORGI_BONES = [
    ("root", (0, 0, 0), None),
    ("body", (0, 0, 0.34), "root"),
    ("head", (0, -0.5, 0.55), "body"),
    ("jaw", (0, -0.63, 0.585), "head"),
    ("ear_L", (0.07, -0.53, 0.72), "head"),
    ("ear_R", (-0.07, -0.53, 0.72), "head"),
    ("tail", (0, 0.39, 0.45), "body"),
    ("leg_FL", (0.105, -0.36, 0.26), "body"),
    ("leg_FR", (-0.105, -0.36, 0.26), "body"),
    ("leg_BL", (0.115, 0.27, 0.28), "body"),
    ("leg_BR", (-0.115, 0.27, 0.28), "body"),
]

MB_K = 0.575  # metaball:表面半徑 = 0.575 × 元素半徑(stiffness 2、threshold 0.6 量出來的)


class Meta:
    """一團 metaball(各元素平滑融合)。元素以「表面半軸長」描述,並標記屬於哪根骨頭。"""

    def __init__(self, name, res=0.0085):
        self.mb = bpy.data.metaballs.new(name)
        self.mb.resolution = res
        self.mb.render_resolution = res
        self.mb.threshold = 0.6
        self.ob = bpy.data.objects.new("mb" + name, self.mb)  # 名字不同才不會跟別團 metaball 融在一起
        bpy.context.scene.collection.objects.link(self.ob)
        self.parts = []  # (骨頭, 場強函式)

    def ell(self, bone, c, semi, rot=(0, 0, 0), neg=False):
        R = max(semi)
        e = self.mb.elements.new(type="ELLIPSOID")
        e.co = c
        e.radius = R / MB_K
        e.size_x, e.size_y, e.size_z = (s / R for s in semi)
        q = Euler([math.radians(a) for a in rot], "XYZ").to_quaternion()
        e.rotation = q
        e.use_negative = neg
        if not neg:
            inv = q.inverted()
            inf = Vector(semi) / MB_K
            c = Vector(c)

            def field(p, c=c, inv=inv, inf=inf):
                d = inv @ (p - c)
                d2 = (d.x / inf.x) ** 2 + (d.y / inf.y) ** 2 + (d.z / inf.z) ** 2
                return max(0.0, 1 - d2) ** 2
            self.parts.append((bone, field))

    def cap(self, bone, a, b, r):
        a, b = Vector(a), Vector(b)
        e = self.mb.elements.new(type="CAPSULE")
        e.co = (a + b) / 2
        e.radius = r / MB_K
        e.size_x = (b - a).length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized())
        inf = r / MB_K

        def field(p, a=a, b=b, inf=inf):
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            d2 = ((p - (a + ab * t)).length / inf) ** 2
            return max(0.0, 1 - d2) ** 2
        self.parts.append((bone, field))

    def weights(self, co, sharp=2.0):
        acc = {}
        for bone, f in self.parts:
            v = f(co)
            if v > 0:
                acc[bone] = acc.get(bone, 0.0) + v
        if not acc:
            return {"body": 1.0}
        acc = {b: w ** sharp for b, w in acc.items()}
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _, w in top)
        return {b: w / tot for b, w in top if w / tot > 0.01}

    def mesh(self, tris):
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(self.ob.evaluated_get(dg))
        bm = bmesh.new()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        bpy.data.objects.remove(self.ob)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        # marching cubes 會留下一圈圈的階梯紋(烘焙後像針織紋),先抹平再減面
        for _ in range(6):
            bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        cur = sum(len(f.verts) - 2 for f in bm.faces)
        if cur > tris:
            bm = apply_modifiers(bm, [("DECIMATE", dict(ratio=tris / cur))])
        bm.normal_update()
        return bm


def _corgi_coat(co, n):
    """整張皮膚的毛色:紅貂色底、背上較深;白色區域彼此平滑過渡。"""
    x, y, z = co.x, co.y, co.z
    ax = abs(x)
    head = sstep(-0.47, -0.55, y)                                  # 頭部區域
    white = max(
        sstep(-0.69, -0.74, y) * head,                             # 吻部
        sstep(0.035, 0.012, ax) * sstep(-0.6, -0.66, y) * sstep(0.79, 0.74, z),  # 鼻樑白線(blaze)
        sstep(0.625, 0.585, z) * head,                             # 下巴、頰下
        sstep(-0.36, -0.47, y) * sstep(0.6, 0.47, z),              # 喉嚨
        sstep(-0.3, -0.46, y) * sstep(0.56, 0.4, z),               # 胸前圍兜
        sstep(0.23, 0.17, z) * sstep(0.1, -0.4, n.z),              # 肚子(朝下的面)
        sstep(0.19, 0.11, z),                                      # 四隻白襪
        sstep(0.26, 0.2, z) * sstep(-0.25, -0.4, y),               # 前腳前側白到手肘
        sstep(0.4, 0.47, y) * sstep(0.4, 0.3, z) * sstep(0.2, 0.6, -n.z + 0.4),  # 尾巴下緣
    )
    # 眉毛上方兩點淺色
    for sx in (1, -1):
        d = math.sqrt((x - sx * 0.055) ** 2 + (y + 0.645) ** 2 + (z - 0.735) ** 2)
        white = max(white, 0.7 * sstep(0.022, 0.01, d))
    back = sstep(0.42, 0.52, z) * (1 - head) * 0.55                 # 背上的深色鞍部
    base = mixc(RED, RED_DARK, back)
    edge = 1 - abs(white - 0.5) * 2                                  # 白紅交界帶一點暖奶油色
    base = mixc(base, CREAM_WARM, edge * 0.4)
    return mixc(base, CREAM, white)


def _fur_length(co, n):
    """毛長:胸前圍兜、脖子的鬃毛、屁股、尾巴最長;臉、吻部、腳最短。"""
    x, y, z = co.x, co.y, co.z
    k = 0.75
    k += 0.45 * sstep(-0.3, -0.45, y) * sstep(0.62, 0.4, z)          # 胸前圍兜
    k += 0.35 * sstep(-0.42, -0.5, y) * sstep(0.45, 0.55, z) * sstep(-0.62, -0.55, y)  # 脖子鬃毛
    k += 0.3 * sstep(0.15, 0.3, y)                                    # 屁股
    k += 0.5 * sstep(0.36, 0.44, y) * sstep(0.48, 0.3, z)             # 尾巴
    k *= 1 - 0.65 * sstep(-0.58, -0.66, y) * sstep(0.56, 0.6, z)      # 臉、吻部
    k *= 1 - 0.45 * sstep(0.17, 0.08, z)                               # 腳
    return k


def _ear(sx):
    """立耳:底寬頂尖、前面微凹的耳殼,再加厚度;正面是淺粉的內耳、邊緣一圈白毛。"""
    H, W = 0.21, 0.075
    bm = bmesh.new()
    nu, nv = 10, 8
    grid = []
    for i in range(nu + 1):
        u = i / nu
        w = W * (1 - u) ** 0.75 * (1 + 0.15 * (1 - u))
        row = []
        for j in range(nv + 1):
            v = -1 + 2 * j / nv
            cup = 0.026 * (1 - v * v) * (1 - u * u)
            row.append(bm.verts.new((v * w, cup, u * H)))
        grid.append(row)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    bm.normal_update()
    bm = apply_modifiers(bm, [("SOLIDIFY", dict(thickness=0.016, offset=1.0))])
    transform(bm, rot=(-6, sx * 16, sx * -12), loc=(sx * 0.072, -0.535, 0.71))
    return bm


def build_corgi(name, seed):
    a = Asset(name)
    m = Meta("corgi")

    # ---- 軀幹:深胸、身體、肚子、圓屁股
    m.ell("body", (0, -0.35, 0.335), (0.17, 0.17, 0.17))
    m.ell("body", (0, -0.45, 0.38), (0.11, 0.09, 0.12))          # 前胸往前凸
    m.ell("body", (0, -0.08, 0.34), (0.17, 0.31, 0.16))
    m.ell("body", (0, -0.12, 0.26), (0.13, 0.22, 0.07))         # 肚子
    m.ell("body", (0, 0.25, 0.36), (0.165, 0.165, 0.155))       # 屁股
    # ---- 脖子(下半屬於身體、上半屬於頭,轉頭時平滑變形)
    m.cap("body", (0, -0.39, 0.44), (0, -0.46, 0.52), 0.14)
    m.cap("head", (0, -0.47, 0.55), (0, -0.52, 0.61), 0.12)
    # ---- 頭:頭殼、雙頰、吻部(上半)、鼻樑
    m.ell("head", (0, -0.56, 0.68), (0.11, 0.11, 0.095))
    for sx in (1, -1):
        m.ell("head", (sx * 0.055, -0.615, 0.635), (0.066, 0.07, 0.058))
    m.cap("head", (0, -0.65, 0.64), (0, -0.79, 0.628), 0.042)
    m.ell("head", (0, -0.7, 0.66), (0.038, 0.08, 0.026))
    # ---- 下巴(張嘴):單獨一根骨頭,吐舌頭時可以開合
    m.cap("jaw", (0, -0.62, 0.585), (0, -0.755, 0.555), 0.027)
    m.ell("jaw", (0, -0.6, 0.585), (0.05, 0.05, 0.04))
    m.ell("head", (0, -0.72, 0.597), (0.03, 0.085, 0.012), rot=(-8, 0, 0), neg=True)  # 嘴巴的縫
    # ---- 腿:前腳從胸下直直落地,腳掌微微朝外;後腿是大腿肉 + 短小腿
    for sx, fl, bl in ((1, "leg_FL", "leg_BL"), (-1, "leg_FR", "leg_BR")):
        # 前腳又短又粗(柯基的腿看起來短,是因為它們很粗)
        m.cap(fl, (sx * 0.1, -0.35, 0.25), (sx * 0.106, -0.365, 0.075), 0.058)
        m.ell(fl, (sx * 0.11, -0.385, 0.035), (0.056, 0.07, 0.036), rot=(0, 0, sx * -10))
        m.ell(bl, (sx * 0.105, 0.25, 0.28), (0.09, 0.125, 0.125))
        m.cap(bl, (sx * 0.113, 0.29, 0.2), (sx * 0.116, 0.3, 0.075), 0.052)
        m.ell(bl, (sx * 0.116, 0.283, 0.035), (0.053, 0.066, 0.035), rot=(0, 0, sx * -8))
    # ---- 蓬鬆尾巴:從屁股上緣往後再往下垂
    m.cap("tail", (0, 0.36, 0.45), (0, 0.44, 0.42), 0.05)
    m.cap("tail", (0, 0.44, 0.42), (0, 0.48, 0.32), 0.055)

    skin = m.mesh(9000)
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromBMesh(skin)

    def surface(origin, direction):
        """從頭裡面往外打一條射線,回傳皮膚表面上的點(眼睛、鼻子都貼著真正的表面放)。"""
        hit = bvh.ray_cast(Vector(origin), Vector(direction).normalized())
        return hit[0] if hit[0] is not None else Vector(origin)
    a.add(skin, "fur", color_fn=_corgi_coat, weights_fn=m.weights, fur=_fur_length)

    # ---- 眼睛:深咖啡虹膜 + 黑瞳孔,外圈黑眼線,上面一顆小高光點
    for sx in (1, -1):
        gaze = Vector((sx * 0.5, -0.86, 0.05)).normalized()
        c = surface((sx * 0.02, -0.6, 0.685), gaze) - gaze * 0.009   # 一半嵌在臉裡
        rim = soft(0.02, c - gaze * 0.003, (1.3, 1.3, 0.85), 2, amp=0.0)
        a.add(rim, "glossy_black", bone="head")

        def eye_col(co, n, gaze=gaze):
            d = n.dot(gaze)
            if d > 0.9:
                return (0.02, 0.015, 0.012)
            if d > 0.62:
                return mixc(srgb("#3b2414"), srgb("#6e4526"), sstep(0.9, 0.66, d))
            return (0.03, 0.022, 0.018)
        eyeball = soft(0.017, c, (1.2, 1.2, 0.85), 3, amp=0.0)
        a.add(eyeball, "eye", bone="head", color_fn=eye_col)
        up = Vector((0, 0, 1))
        hl = soft(0.004, c + gaze * 0.017 + up * 0.006 - Vector((sx * 0.004, 0, 0)), (1, 1, 1), 2, amp=0.0)
        a.add(hl, "eye", bone="head", tint=(1.0, 1.0, 1.0))

    # ---- 鼻子:圓鼓鼓的黑鼻頭 + 人中
    nose = merge(soft(1.0, (0, -0.826, 0.632), (0.031, 0.022, 0.022), 3, amp=0.0),
                 soft(1.0, (0, -0.83, 0.622), (0.024, 0.018, 0.014), 2, amp=0.0))
    a.add(nose, "glossy_black", bone="head")
    a.add(limb((0, -0.826, 0.612), (0, -0.818, 0.598), 0.004, 0.004, 6), "glossy_black", bone="head")
    # ---- 嘴:暗色口腔、兩側上揚的黑唇線(微笑)、垂出來的粉紅舌頭
    a.add(soft(1.0, (0, -0.7, 0.592), (0.036, 0.08, 0.02), 3, amp=0.0), "mouth", bone="head", tint=MOUTH)
    for sx in (1, -1):
        a.add(merge(limb((sx * 0.022, -0.8, 0.598), (sx * 0.045, -0.72, 0.596), 0.0055, 0.0055, 6),
                    limb((sx * 0.045, -0.72, 0.596), (sx * 0.058, -0.655, 0.606), 0.0055, 0.0045, 6)),
              "glossy_black", bone="head")
    tongue = soft(1.0, (0, 0, 0), (0.027, 0.045, 0.0075), 3, amp=0.0)
    transform(tongue, rot=(32, 0, 0), loc=(0, -0.775, 0.56))
    a.add(tongue, "mouth", bone="jaw", tint=TONGUE)

    # ---- 立耳
    for sx, bname in ((1, "ear_L"), (-1, "ear_R")):
        ear = _ear(sx)

        def ear_col(co, n, sx=sx):
            inner = sstep(-0.1, -0.5, n.y)                              # 朝前的那面
            rim = sstep(0.035, 0.05, abs(co.x - sx * 0.075) + (co.z - 0.7) * 0.05)
            col = mixc(RED, mixc(PINK, CREAM, 0.35), inner)
            return mixc(col, CREAM, rim * inner * 0.8)
        a.add(ear, "fur", bone=bname, color_fn=ear_col, fur=lambda co, n: 0.3 if n.y > 0 else 0.0)
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
        pose(arm, "jaw", rot=(5 + 5 * math.sin(6 * two_pi * t), 0, 0))  # 喘氣吐舌頭

    def walk(t):
        s = math.sin(two_pi * t)
        for b, k in (("leg_FL", 1), ("leg_BR", 1), ("leg_FR", -1), ("leg_BL", -1)):
            pose(arm, b, rot=(28 * s * k, 0, 0))
        pose(arm, "root", loc=(0, 0, 0.012 * (1 - math.cos(2 * two_pi * t)) / 2))
        pose(arm, "body", rot=(0, 3 * s, 0))
        pose(arm, "head", rot=(3 * math.sin(2 * two_pi * t), 0, 0))
        pose(arm, "tail", rot=(0, 0, 16 * s))
        pose(arm, "jaw", rot=(6 + 3 * math.sin(2 * two_pi * t), 0, 0))

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
        pose(arm, "jaw", rot=(12 + 4 * math.sin(2 * ph), 0, 0))

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
        pose(arm, "jaw", rot=(10 + 6 * math.sin(8 * ph), 0, 0))  # 開心地喘氣

    def sniff(t):
        # 嗅聞:身體前傾、鼻子貼近地面左右掃、耳朵往前豎、尾巴慢慢搖
        ph = two_pi * t
        pose(arm, "root", loc=(0, -0.01, -0.012))
        pose(arm, "body", rot=(9, 0, 0))
        pose(arm, "head", rot=(34 + 4 * math.sin(4 * ph), 0, 16 * math.sin(ph)))
        pose(arm, "jaw", rot=(-2, 0, 0))
        for e in ("ear_L", "ear_R"):
            pose(arm, e, rot=(10, 0, 0))
        for b in ("leg_FL", "leg_FR"):
            pose(arm, b, rot=(-8, 0, 0))
        pose(arm, "tail", rot=(0, 0, 18 * math.sin(2 * ph)))

    def bark(t):
        # 汪!:前腳撐地、身體往後一縮蓄力,接著抬頭往前一衝、嘴巴張到最大,耳朵往後貼、尾巴翹高
        k = math.sin(math.pi * min(1.0, t / 0.75)) if t < 0.75 else 0.0     # 0 → 1 → 0
        snap = max(0.0, math.sin(math.pi * (t - 0.18) / 0.5)) if 0.18 < t < 0.68 else 0.0
        pose(arm, "root", loc=(0, -0.015 * k + 0.02 * snap, 0.01 * snap))
        pose(arm, "body", rot=(-8 * k, 0, 0))
        for b in ("leg_FL", "leg_FR"):
            pose(arm, b, rot=(-18 * k, 0, 0))
        for b in ("leg_BL", "leg_BR"):
            pose(arm, b, rot=(10 * k, 0, 0))
        pose(arm, "head", rot=(-22 * k + 10 * snap, 0, 0))
        pose(arm, "jaw", rot=(4 + 34 * snap, 0, 0))
        for e in ("ear_L", "ear_R"):
            pose(arm, e, rot=(-30 * k, 0, 0))
        pose(arm, "tail", rot=(0, 0, 14 * math.sin(4 * two_pi * t) * k))

    add_action(arm, "Idle", 60, idle)
    add_action(arm, "Walk", 24, walk)
    add_action(arm, "Run", 14, run)
    add_action(arm, "Dig", 12, dig)
    add_action(arm, "Proud", 48, proud)
    add_action(arm, "Sniff", 30, sniff)
    add_action(arm, "Bark", 16, bark)
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

    def sniff(t):
        # 嗅聞:身體前傾、鼻子貼近地面左右掃、耳朵往前豎、尾巴慢慢搖
        ph = two_pi * t
        pose(arm, "root", loc=(0, -0.01, -0.012))
        pose(arm, "body", rot=(9, 0, 0))
        pose(arm, "head", rot=(34 + 4 * math.sin(4 * ph), 0, 16 * math.sin(ph)))
        pose(arm, "jaw", rot=(-2, 0, 0))
        for e in ("ear_L", "ear_R"):
            pose(arm, e, rot=(10, 0, 0))
        for b in ("leg_FL", "leg_FR"):
            pose(arm, b, rot=(-8, 0, 0))
        pose(arm, "tail", rot=(0, 0, 18 * math.sin(2 * ph)))

    add_action(arm, "Idle", 60, idle)
    add_action(arm, "Walk", 24, walk)
    add_action(arm, "Run", 14, run)
    add_action(arm, "Peck", 15, peck)
    return arm
