# Escape from Barkov — Blender 程序化資產工具庫
#
# 幾何(bmesh)、程序化材質(shader node)、烘焙(Cycles)與 GLB 匯出。
# 每個資產都在 Blender 裡以程序化材質建模,再把「顏色 × 環境光遮蔽」
# 與法線烘焙成貼圖,遊戲端(Three.js)就能拿到接近離線算圖的質感。

import math
import random

import bpy  # 必須先於 bmesh 載入(pip 版 bpy)
import bmesh
from mathutils import Matrix, Vector, noise


# ---------------------------------------------------------------- 顏色

def srgb(h):
    """'#rrggbb' → Blender 節點用的線性 RGB。"""
    h = h.lstrip("#")
    out = []
    for i in range(3):
        c = int(h[i * 2:i * 2 + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# ---------------------------------------------------------------- 場景

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    return scene


def fbm(v, octaves=3, lac=2.0, gain=0.5, seed=0.0):
    """以 mathutils.noise 疊出 [-1,1] 左右的分形雜訊。"""
    amp, f, s = 1.0, 1.0, 0.0
    off = Vector((seed * 17.31, seed * 5.77, seed * 11.13))
    for _ in range(octaves):
        s += noise.noise(v * f + off) * amp
        amp *= gain
        f *= lac
    return s


# ---------------------------------------------------------------- 節點建構

def _sock(coll, ident):
    for s in coll:
        if s.identifier == ident:
            return s
    return coll[ident]


class NB:
    """精簡的 shader node 建構器:參數可以是 socket,也可以是常數。"""

    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.nodes = self.nt.nodes
        self.links = self.nt.links
        self._coord = None

    def node(self, kind, **props):
        n = self.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def put(self, socket, v):
        if v is None:
            return
        if isinstance(v, bpy.types.NodeSocket):
            self.links.new(v, socket)
        elif isinstance(v, (tuple, list)) and socket.type == "RGBA" and len(v) == 3:
            socket.default_value = (*v, 1.0)
        else:
            socket.default_value = v

    # ---- 座標
    def coord(self, kind="Object"):
        if self._coord is None:
            self._coord = self.node("ShaderNodeTexCoord")
        return self._coord.outputs[kind]

    def uv(self, name="SrcUV"):
        return self.node("ShaderNodeUVMap", uv_map=name).outputs["UV"]

    def mapping(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        m = self.node("ShaderNodeMapping")
        self.put(m.inputs["Vector"], vec)
        m.inputs["Scale"].default_value = scale
        m.inputs["Location"].default_value = loc
        m.inputs["Rotation"].default_value = rot
        return m.outputs["Vector"]

    def geo(self, out="Normal"):
        return self.node("ShaderNodeNewGeometry").outputs[out]

    def sep(self, vec):
        s = self.node("ShaderNodeSeparateXYZ")
        self.put(s.inputs[0], vec)
        return s.outputs

    def attr(self, name="col"):
        return self.node("ShaderNodeAttribute", attribute_name=name).outputs["Color"]

    # ---- 紋理
    def noise(self, vec, scale=5.0, detail=4.0, rough=0.5, distort=0.0, out="Fac"):
        n = self.node("ShaderNodeTexNoise")
        self.put(n.inputs["Vector"], vec)
        self.put(n.inputs["Scale"], scale)
        self.put(n.inputs["Detail"], detail)
        self.put(n.inputs["Roughness"], rough)
        self.put(n.inputs["Distortion"], distort)
        return n.outputs[out]

    def voronoi(self, vec, scale=5.0, feature="F1", out="Distance", rand=1.0):
        n = self.node("ShaderNodeTexVoronoi", feature=feature)
        self.put(n.inputs["Vector"], vec)
        self.put(n.inputs["Scale"], scale)
        self.put(n.inputs["Randomness"], rand)
        return n.outputs[out]

    def wave(self, vec, scale=5.0, distort=2.0, detail=2.0, direction="X", out="Fac"):
        n = self.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction=direction)
        self.put(n.inputs["Vector"], vec)
        self.put(n.inputs["Scale"], scale)
        self.put(n.inputs["Distortion"], distort)
        self.put(n.inputs["Detail"], detail)
        return n.outputs[out]

    def gradient(self, vec, kind="RADIAL"):
        n = self.node("ShaderNodeTexGradient", gradient_type=kind)
        self.put(n.inputs["Vector"], vec)
        return n.outputs["Fac"]

    # ---- 數學 / 顏色
    def math(self, op, a, b=0.0, clamp=False):
        m = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.put(m.inputs[0], a)
        self.put(m.inputs[1], b)
        return m.outputs[0]

    def remap(self, v, a, b, c=0.0, d=1.0, interp="LINEAR"):
        m = self.node("ShaderNodeMapRange", interpolation_type=interp, clamp=True)
        self.put(m.inputs["Value"], v)
        m.inputs["From Min"].default_value = a
        m.inputs["From Max"].default_value = b
        m.inputs["To Min"].default_value = c
        m.inputs["To Max"].default_value = d
        return m.outputs["Result"]

    def ramp(self, fac, stops, interp="LINEAR"):
        r = self.node("ShaderNodeValToRGB")
        r.color_ramp.interpolation = interp
        els = r.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for el, (pos, col) in zip(els, stops):
            el.position = pos
            el.color = (*col, 1.0)
        self.put(r.inputs["Fac"], fac)
        return r.outputs["Color"]

    def mix(self, fac, a, b, blend="MIX"):
        m = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        m.clamp_result = True
        self.put(_sock(m.inputs, "Factor_Float"), fac)
        self.put(_sock(m.inputs, "A_Color"), a)
        self.put(_sock(m.inputs, "B_Color"), b)
        return _sock(m.outputs, "Result_Color")

    def mul(self, a, b):
        return self.mix(1.0, a, b, "MULTIPLY")


# ---------------------------------------------------------------- 材質

MATERIALS = {}  # name → builder(nb) -> dict(color, height, bump, rough)


def material(name):
    def deco(fn):
        MATERIALS[name] = fn
        return fn
    return deco


def make_material(name):
    """建立材質:Principled(預覽/法線烘焙)+ Emission(顏色×AO 烘焙),由 Output 切換。"""
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nb = NB(mat)
    for n in list(nb.nodes):
        nb.nodes.remove(n)
    spec = MATERIALS[name](nb)

    out = nb.node("ShaderNodeOutputMaterial")
    bsdf = nb.node("ShaderNodeBsdfPrincipled")
    nb.put(bsdf.inputs["Base Color"], spec["color"])
    bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.9)
    bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)
    if spec.get("height") is not None:
        bump = nb.node("ShaderNodeBump")
        bump.inputs["Strength"].default_value = spec.get("bump", 0.4)
        bump.inputs["Distance"].default_value = spec.get("bump_dist", 0.02)
        nb.put(bump.inputs["Height"], spec["height"])
        nb.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    # 烘焙用:顏色 × mix(1, AO, 強度)
    ao = nb.node("ShaderNodeAmbientOcclusion", samples=24, only_local=False)
    ao.inputs["Distance"].default_value = 1.0
    strength = spec.get("ao", 0.85)
    ao_f = nb.remap(ao.outputs["AO"], 0.0, 1.0, 1.0 - strength, 1.0)
    lit = nb.mix(1.0, spec["color"], ao_f, "MULTIPLY")
    emit = nb.node("ShaderNodeEmission")
    nb.put(emit.inputs["Color"], lit)

    mat["_bsdf"] = bsdf.name
    mat["_emit"] = emit.name
    mat["_out"] = out.name
    mat["_ao"] = ao.name
    mat["_rough"] = spec.get("rough", 0.9)
    mat["_metal"] = spec.get("metal", 0.0)
    nb.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _route(mat, which):
    nt = mat.node_tree
    out = nt.nodes[mat["_out"]]
    src = nt.nodes[mat["_bsdf"]].outputs["BSDF"] if which == "bsdf" else nt.nodes[mat["_emit"]].outputs["Emission"]
    nt.links.new(src, out.inputs["Surface"])


# ---------------------------------------------------------------- 幾何

class Asset:
    """把許多零件(bmesh)累積成一個網格,每個零件指定材質與色調。"""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.bm.loops.layers.uv.new("SrcUV")
        self.bm.loops.layers.float_color.new("col")
        self.mats = []

    def _mat_index(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, piece, mat, tint=(1, 1, 1), smooth=True):
        idx = self._mat_index(mat)
        if not piece.loops.layers.uv.get("SrcUV"):  # 所有零件都要有同名 UV,合併時才不會掉資料
            piece.loops.layers.uv.new("SrcUV")
        col = piece.loops.layers.float_color.get("col") or piece.loops.layers.float_color.new("col")
        for f in piece.faces:
            f.material_index = idx
            f.smooth = smooth
            if tint is not None:  # None = 保留零件自帶的頂點色
                for lp in f.loops:
                    lp[col] = (*tint, 1.0)
        me = bpy.data.meshes.new("_tmp")
        piece.to_mesh(me)
        piece.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def to_object(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(make_material(m))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        return ob


def box_uv(bm, size):
    """單位方塊的 SrcUV:u 沿 X(長邊,公尺),v 沿截面(公尺)。木紋因此永遠順著木料。"""
    uv = bm.loops.layers.uv.get("SrcUV") or bm.loops.layers.uv.new("SrcUV")
    L, W, H = size
    for f in bm.faces:
        n = f.normal
        for lp in f.loops:
            co = lp.vert.co
            if abs(n.x) > 0.5:
                lp[uv].uv = (co.y * W, co.z * H)
            elif abs(n.y) > 0.5:
                lp[uv].uv = ((co.x + 0.5) * L, co.z * H)
            else:
                lp[uv].uv = ((co.x + 0.5) * L, co.y * W + 0.37)


def beam(a, b, w, h, bevel=0.02, up=(0, 0, 1), roll=0.0):
    """從 a 到 b 的方木(寬 w、高 h),帶倒角與順紋 UV。"""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    x = d.normalized()
    upv = Vector(up)
    if abs(x.dot(upv)) > 0.99:
        upv = Vector((1, 0, 0)) if abs(x.x) < 0.9 else Vector((0, 1, 0))
    y = upv.cross(x).normalized()
    z = x.cross(y).normalized()
    if roll:
        y, z = (y * math.cos(roll) + z * math.sin(roll)), (z * math.cos(roll) - y * math.sin(roll))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.normal_update()
    box_uv(bm, (L, w, h))
    rot = Matrix((x, y, z)).transposed().to_4x4()
    m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((L, w, h, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, w * 0.3, h * 0.3), segments=2,
                        affect="EDGES", profile=0.5)
    return bm


def blob(radius=1.0, sub=3, scale=(1, 1, 1), loc=(0, 0, 0), amp=0.15, freq=1.6, seed=0.0,
         amp2=0.0, freq2=5.0, flat_bottom=None):
    """雜訊位移的球(石頭、樹冠團塊)。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=radius)
    for v in bm.verts:
        n = v.co.normalized()
        d = fbm(n * freq, 3, seed=seed) * amp
        if amp2:
            d += fbm(n * freq2, 2, seed=seed + 3.1) * amp2
        v.co = v.co + n * d * radius
        v.co.x *= scale[0]
        v.co.y *= scale[1]
        v.co.z *= scale[2]
        if flat_bottom is not None and v.co.z < flat_bottom:
            v.co.z = flat_bottom + (v.co.z - flat_bottom) * 0.15
        v.co += Vector(loc)
    bm.normal_update()
    return bm


def cylinder(r1, r2, depth, segs=16, loc=(0, 0, 0), caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    bmesh.ops.translate(bm, vec=Vector(loc) + Vector((0, 0, depth / 2)), verts=bm.verts)
    return bm


def grid(nx, ny, fn):
    """參數曲面:fn(u, v) → Vector,u,v ∈ [0,1]。SrcUV = (u, v)。"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("SrcUV")
    verts = [[bm.verts.new(fn(i / nx, j / ny)) for i in range(nx + 1)] for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            for lp, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uv].uv = (ii / nx, jj / ny)
    bm.normal_update()
    return bm


def apply_modifiers(bm, mods):
    """以暫時物件套用修改器(Remesh / Decimate / Solidify…),回傳新的 bmesh。"""
    me = bpy.data.meshes.new("_mod")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("_mod", me)
    bpy.context.collection.objects.link(ob)
    for kind, props in mods:
        m = ob.modifiers.new(kind.lower(), kind)
        for k, v in props.items():
            setattr(m, k, v)
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bmesh.new()
    out.from_mesh(new_me)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(new_me)
    return out


def merge(*bms):
    out = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new("_m")
        b.to_mesh(me)
        b.free()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
    return out


def displace(bm, amp, freq, seed=0.0, octaves=3):
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * fbm(v.co * freq, octaves, seed=seed) * amp
    bm.normal_update()


# ---------------------------------------------------------------- 烘焙與匯出

def _select_only(ob):
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def unwrap(ob, groups, margin=0.004):
    """每個烘焙群組各自展開到完整的 0..1 UV 空間(各有一張貼圖)。"""
    me = ob.data
    bake_uv = me.uv_layers.new(name="BakeUV")
    me.uv_layers.active = bake_uv
    bake_uv.active_render = True
    _select_only(ob)
    for idxs in groups:
        bpy.ops.object.mode_set(mode="OBJECT")
        for p in me.polygons:
            p.select = p.material_index in idxs
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def _final_material(name, col, nrm, rough, metal):
    final = bpy.data.materials.new(name)
    try:
        final.use_nodes = True
    except Exception:
        pass
    nt = final.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = col
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = nrm
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tn.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal * 0.3
    return final


def bake_and_export(ob, path, res=1024, samples=8, ao_dist=1.0, normal_scale=0.5, ground=True,
                    groups=None, jpeg_quality=86):
    """groups: {群組名: [材質名…]};未列出的材質歸到主群組。每個群組一張顏色圖 + 一張法線圖。"""
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.bake.margin = 12
    scene.render.bake.use_clear = True

    # 地面:讓 AO 在物件底部產生接觸陰影(不參與烘焙)
    gnd = None
    if ground:
        gme = bpy.data.meshes.new("_ground")
        gbm = bmesh.new()
        bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=60)
        gbm.to_mesh(gme)
        gbm.free()
        gnd = bpy.data.objects.new("_ground", gme)
        scene.collection.objects.link(gnd)

    me = ob.data
    mats = list(me.materials)
    mat_names = [m.name for m in mats]
    groups = dict(groups or {})
    listed = {n for g in groups.values() for n in g}
    rest = [n for n in mat_names if n not in listed]
    if rest:
        groups = {"": rest, **groups}
    gnames = [g for g in groups if any(n in mat_names for n in groups[g])]
    g_of = {}
    for gi, g in enumerate(gnames):
        for n in groups[g]:
            if n in mat_names:
                g_of[mat_names.index(n)] = gi
    unwrap(ob, [{i for i, gi in g_of.items() if gi == k} for k in range(len(gnames))])

    name = ob.name
    imgs = []
    for g in gnames:
        suffix = ("_" + g) if g else ""
        col = bpy.data.images.new(f"{name}{suffix}_color", res, res, alpha=False)
        col.colorspace_settings.name = "sRGB"
        nres = max(64, int(res * normal_scale))
        nrm = bpy.data.images.new(f"{name}{suffix}_normal", nres, nres, alpha=False)
        nrm.colorspace_settings.name = "Non-Color"
        imgs.append((col, nrm))

    tex_nodes = []
    for m in mats:
        m.node_tree.nodes[m["_ao"]].inputs["Distance"].default_value = ao_dist
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex_nodes.append(t)
        m.node_tree.nodes.active = t

    _select_only(ob)

    for i, (m, t) in enumerate(zip(mats, tex_nodes)):
        t.image = imgs[g_of[i]][0]
        _route(m, "emit")
    bpy.ops.object.bake(type="EMIT", margin=12, use_clear=True)

    for i, (m, t) in enumerate(zip(mats, tex_nodes)):
        t.image = imgs[g_of[i]][1]
        _route(m, "bsdf")
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=12, use_clear=True)

    finals = []
    for gi, g in enumerate(gnames):
        col, nrm = imgs[gi]
        col.pack()
        nrm.pack()
        gm = [m for i, m in enumerate(mats) if g_of[i] == gi]
        rough = sum(m["_rough"] for m in gm) / len(gm)
        metal = max(m["_metal"] for m in gm)
        finals.append(_final_material(name + (("_" + g) if g else ""), col, nrm, rough, metal))

    # 換成烘焙材質(遊戲端每個群組一個 draw call)
    old_idx = [p.material_index for p in me.polygons]
    me.materials.clear()
    for f in finals:
        me.materials.append(f)
    for p, oi in zip(me.polygons, old_idx):
        p.material_index = g_of[oi]
    if "SrcUV" in me.uv_layers:
        me.uv_layers.remove(me.uv_layers["SrcUV"])
    if "col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["col"])

    if gnd:
        gnd.select_set(False)
    _select_only(ob)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_image_format="JPEG",
        export_jpeg_quality=jpeg_quality,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_vertex_color="NONE",
        export_animations=False,
    )


def finish_object(ob, sharp_angle=None):
    """著色:有角度的硬邊(木料、牆)保持銳利,有機物整體平滑。"""
    me = ob.data
    if sharp_angle is not None:
        me.set_sharp_from_angle(angle=math.radians(sharp_angle))
    me.validate()
    me.update()
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


rng = random.Random()
