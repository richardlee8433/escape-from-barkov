"""用 Cycles 把匯出的 GLB 擺成場景算圖(檢查資產品質、做宣傳圖)。

  python tools/blender/render_preview.py --models game/assets/models --out docs/blender_preview.jpg
  python tools/blender/render_preview.py --sheet rock_a,rock_b --out sheet.png
"""

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402
import materials  # noqa: E402,F401


def load(models, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(models, name + ".glb"))
    objs = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    return root


def place(models, name, loc, rot=0.0, scale=1.0, cache={}):
    """第一次載入,之後用 linked duplicate(共享網格)。"""
    if name not in cache:
        cache[name] = load(models, name)
        src = cache[name]
        src.location = loc
        src.rotation_euler.z = rot
        src.scale = (scale,) * 3
        return src
    src = cache[name]
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    for c in src.children:
        d = c.copy()
        bpy.context.collection.objects.link(d)
        d.parent = root
    root.location = loc
    root.rotation_euler.z = rot
    root.scale = (scale,) * 3
    return root


def world_sky(scene, strength=1.0, sun_elev=28, sun_rot=210):
    w = bpy.data.worlds.new("sky")
    scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bg = nt.nodes.get("Background")
    sky = nt.nodes.new("ShaderNodeTexSky")
    for t in ("MULTIPLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
        try:
            sky.sky_type = t
            break
        except TypeError:
            continue
    try:
        sky.sun_elevation = math.radians(sun_elev)
        sky.sun_rotation = math.radians(sun_rot)
        sky.sun_disc = False
    except AttributeError:
        pass
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength * 0.35

    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.2
    sun.angle = math.radians(2.5)
    sun.color = (1.0, 0.88, 0.72)
    so = bpy.data.objects.new("sun", sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(90 - sun_elev), 0, math.radians(sun_rot - 90))


def ground(scene, size=60, path_fn=None):
    """細分地面 + 頂點色畫路(r=1 為泥土路)。"""
    a = lib.Asset("ground")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=160, y_segments=160, size=size / 2)
    a.add(bm, "ground_preview")
    ob = a.to_object()
    me = ob.data
    col = me.color_attributes["col"]
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            d = path_fn(v.x, v.y) if path_fn else 0.0
            col.data[li].color = (d, d, d, 1.0)
    for v in me.vertices:
        v.co.z = lib.fbm(Vector((v.co.x * 0.15, v.co.y * 0.15, 0)), 2) * 0.12
    return ob


def grass_and_flowers(scene, ground_ob, path_fn, density=180000, seed=3):
    """幾何節點太複雜,這裡直接散佈:草葉三角 + 花朵小球,全部合成一個網格。"""
    rng = random.Random(seed)
    bm = bmesh.new()
    col = bm.loops.layers.float_color.new("col")
    bm.loops.layers.uv.new("SrcUV")
    half = 26
    for _ in range(density):
        x, y = rng.uniform(-half, half), rng.uniform(-half, half)
        if path_fn(x, y) > 0.35:
            continue
        h = rng.uniform(0.18, 0.42)
        a = rng.uniform(0, math.pi)
        w = 0.025
        lean = Vector((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0))
        p0 = Vector((x + math.cos(a) * w, y + math.sin(a) * w, 0))
        p1 = Vector((x - math.cos(a) * w, y - math.sin(a) * w, 0))
        p2 = Vector((x, y, h)) + lean
        f = bm.faces.new((bm.verts.new(p0), bm.verts.new(p1), bm.verts.new(p2)))
        g = rng.uniform(0.75, 1.15)
        for lp, t in zip(f.loops, (0, 0, 1)):
            lp[col] = (0.05 * g + t * 0.06, 0.12 * g + t * 0.12, 0.03 * g, 1.0)
    grass = lib.Asset("grass")
    grass.add(bm, "petal", tint=None)
    gob = grass.to_object()
    for p in gob.data.polygons:
        p.use_smooth = True

    # 花叢:成群的小圓花(藍、淡紫、白)
    fb = bmesh.new()
    palette = [(0.25, 0.35, 0.95), (0.45, 0.5, 1.0), (0.85, 0.88, 1.0), (0.55, 0.45, 0.95)]
    for _ in range(70):
        cx, cy = rng.uniform(-half, half), rng.uniform(-half, half)
        if path_fn(cx, cy) > 0.2:
            continue
        pal = rng.choice(palette)
        for _ in range(rng.randint(40, 120)):
            x = cx + rng.gauss(0, 0.9)
            y = cy + rng.gauss(0, 0.9)
            if path_fn(x, y) > 0.2:
                continue
            piece = lib.blob(0.045, 1, (1, 1, 0.8), loc=(x, y, rng.uniform(0.2, 0.42)), amp=0.25, freq=3,
                             seed=rng.random() * 99)
            c = tuple(min(1, v * rng.uniform(0.85, 1.1)) for v in pal)
            pc = piece.loops.layers.float_color.get("col") or piece.loops.layers.float_color.new("col")
            for f in piece.faces:
                for lp in f.loops:
                    lp[pc] = (*c, 1.0)
            me = bpy.data.meshes.new("_f")
            piece.to_mesh(me)
            piece.free()
            fb.from_mesh(me)
            bpy.data.meshes.remove(me)
    fl = lib.Asset("flowers")
    fl.add(fb, "petal", tint=None)
    fl.to_object()


def render(scene, out, cam_loc, cam_target, lens=40, samples=64, res=(1280, 720)):
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    co = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(co)
    co.location = cam_loc
    d = Vector(cam_target) - Vector(cam_loc)
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.camera = co
    scene.cycles.samples = samples
    try:
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = os.path.abspath(out)
    if out.lower().endswith((".jpg", ".jpeg")):
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = 90
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Base Contrast"
    except TypeError:
        pass
    bpy.ops.render.render(write_still=True)


def showcase(models, out, samples):
    scene = lib.reset_scene()
    world_sky(scene)

    def path_fn(x, y):
        # 一條彎曲泥土路從右下穿到左邊
        cy = -2.2 + math.sin(x * 0.18) * 1.6
        d = abs(y - cy)
        return max(0.0, min(1.0, (2.0 - d) / 0.6))

    ground(scene, 140, path_fn)
    grass_and_flowers(scene, None, path_fn)

    place(models, "cottage", (0, 2.6, 0), math.radians(0))
    place(models, "well", (-6.8, 0.2, 0), 0.3, 1.0)
    place(models, "barrel", (-3.6, -1.2, 0), 0.2)
    place(models, "barrel", (-2.7, -1.5, 0), 1.2)
    place(models, "crate", (4.9, 0.1, 0), 0.4, 0.9)
    place(models, "bush_flower", (5.2, -1.6, 0), 0, 1.1)
    place(models, "bush", (-4.6, 0.6, 0), 0, 1.4)
    place(models, "bush_flower", (-5.6, -2.6, 0), 1, 0.9)
    for i, x in enumerate((7.5, 10.8)):
        place(models, "fence", (x, -5.0, 0), math.radians(-12 + i * 8))
    rng = random.Random(5)
    for (x, y) in ((-2.6, 7.9), (3.2, 8.6), (8.2, 6.1), (-8.5, 6.0), (12, 2), (-12.5, 1.5), (0.2, 12), (7, 12.5),
                   (-6, 12), (15, 8), (-15, 8)):
        name = rng.choice(["tree_conifer_a", "tree_conifer_b", "tree_round_a", "tree_round_b"])
        place(models, name, (x, y, 0), rng.uniform(0, 6.28), rng.uniform(0.9, 1.2))
    place(models, "rock_a", (2.2, -3.8, 0), 0.4, 0.8)
    place(models, "rock_b", (-1.0, -5.2, 0), 1.4, 0.55)
    place(models, "rock_c", (6.5, 1.2, 0), 2.4, 0.9)
    place(models, "stump", (-8.8, -2.5, 0), 0, 1.0)
    place(models, "log", (9.0, 3.0, 0), 0.7, 1.0)

    render(scene, out, (-7.5, -15.0, 10.5), (0.6, 2.0, 2.2), lens=34, samples=samples)


def sheet(models, names, out, samples):
    scene = lib.reset_scene()
    world_sky(scene)
    x = 0.0
    xs = []
    for n in names:
        r = load(models, n)
        bpy.context.view_layer.update()
        mins = Vector((1e9, 1e9, 1e9))
        maxs = Vector((-1e9, -1e9, -1e9))
        for c in r.children:
            for corner in c.bound_box:
                w = c.matrix_world @ Vector(corner)
                mins = Vector(map(min, mins, w))
                maxs = Vector(map(max, maxs, w))
        wdt = maxs.x - mins.x
        r.location.x = x - mins.x
        xs.append((x, maxs))
        x += wdt + 0.8
    gp = bpy.data.meshes.new("g")
    gbm = bmesh.new()
    bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=200)
    gbm.to_mesh(gp)
    g = bpy.data.objects.new("g", gp)
    scene.collection.objects.link(g)
    mat = bpy.data.materials.new("gm")
    try:
        mat.use_nodes = True
    except Exception:
        pass
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.32, 0.15, 1)
    gp.materials.append(mat)
    hmax = max(m.z for _, m in xs)
    cx = x / 2
    dist = max(x * 0.75, hmax * 2.2)
    render(scene, out, (cx, -dist, hmax * 0.9 + dist * 0.35), (cx, 0, hmax * 0.4), lens=40, samples=samples)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="game/assets/models")
    ap.add_argument("--out", default="docs/blender_preview.jpg")
    ap.add_argument("--sheet", default="")
    ap.add_argument("--samples", type=int, default=64)
    a = ap.parse_args(argv)
    if a.sheet:
        sheet(a.models, a.sheet.split(","), a.out, a.samples)
    else:
        showcase(a.models, a.out, a.samples)
