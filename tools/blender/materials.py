# 程序化材質。每個材質回傳 color(底色)、height(凹凸)、rough 等參數,
# 由 lib.make_material 組成 Principled + 烘焙用 Emission。
# 顏色一律寫 sRGB 十六進位,經 srgb() 轉成線性。

from lib import material, srgb


@material("thatch")
def thatch(nb):
    # 茅草:沿 X 高頻、沿坡向低頻的雜訊 → 順著屋頂往下的草稈紋路
    o = nb.coord("Object")
    uv = nb.uv("SrcUV")
    straw = nb.noise(nb.mapping(o, scale=(16, 1.1, 1.1)), 1.0, 10, 0.7, 0.3)
    fine = nb.noise(nb.mapping(o, scale=(48, 3.5, 3.5)), 1.0, 6, 0.6)
    patch = nb.noise(o, 0.5, 3, 0.5)
    t = nb.math("ADD", straw, nb.math("MULTIPLY", nb.math("SUBTRACT", fine, 0.5), 0.6))
    base = nb.ramp(t, [(0.25, srgb("#4f3818")), (0.48, srgb("#8f6d3c")), (0.62, srgb("#b8955a")),
                       (0.8, srgb("#dcc088"))])
    base = nb.mix(nb.remap(patch, 0.4, 0.7, 0.0, 0.3), base, srgb("#6e5a38"), "MULTIPLY")
    # 每一排草片的上緣被上一排壓住 → 一道陰影(v=0 為草片上緣,約 0.33 處開始外露)
    v = nb.sep(uv)["Y"]
    shade = nb.remap(v, 0.3, 0.55, 0.45, 1.0, "SMOOTHSTEP")
    base = nb.mix(1.0, base, nb.ramp(shade, [(0.0, (0, 0, 0)), (1.0, (1, 1, 1))]), "MULTIPLY")
    height = nb.math("ADD", t, nb.math("MULTIPLY", shade, 0.8))
    return dict(color=base, height=height, bump=0.6, bump_dist=0.03, rough=0.95, ao=0.9)


@material("plaster")
def plaster(nb):
    o = nb.coord("Object")
    z = nb.sep(o)["Z"]
    n1 = nb.noise(o, 2.5, 6, 0.6)
    n2 = nb.noise(o, 18, 5, 0.55)
    base = nb.ramp(n1, [(0.35, srgb("#b9b19c")), (0.65, srgb("#d3ccb8"))])
    stain = nb.remap(z, 0.4, 1.3, 0.55, 0.0)
    stain = nb.math("MULTIPLY", stain, nb.remap(n1, 0.3, 0.7, 0.5, 1.2))
    base = nb.mix(stain, base, srgb("#8c7a5c"))
    return dict(color=base, height=n2, bump=0.25, bump_dist=0.02, rough=0.9, ao=0.85)


def _wood(nb, dark, light, grain_scale=(2.5, 45, 45), tint=True, knots=True):
    uv = nb.uv("SrcUV")
    g = nb.noise(nb.mapping(uv, scale=grain_scale), 1.0, 6, 0.6, 1.5)
    rings = nb.wave(nb.mapping(uv, scale=(0.6, 9, 9)), 3.0, 6.0, 3.0, "Y")
    base = nb.ramp(g, [(0.3, srgb(dark)), (0.7, srgb(light))])
    base = nb.mix(nb.math("MULTIPLY", rings, 0.25), base, srgb(dark), "MIX")
    if tint:
        base = nb.mul(base, nb.attr("col"))
    height = nb.math("ADD", g, nb.math("MULTIPLY", rings, 0.3))
    return base, height


@material("timber")
def timber(nb):
    c, h = _wood(nb, "#3b2a1c", "#5e4430")
    return dict(color=c, height=h, bump=0.45, bump_dist=0.02, rough=0.85, ao=0.85)


@material("wood_door")
def wood_door(nb):
    c, h = _wood(nb, "#4b3420", "#7a5636")
    return dict(color=c, height=h, bump=0.5, bump_dist=0.02, rough=0.85, ao=0.9)


@material("wood_weathered")
def wood_weathered(nb):
    c, h = _wood(nb, "#5b4a3a", "#8f7c66")
    return dict(color=c, height=h, bump=0.55, bump_dist=0.02, rough=0.9, ao=0.85)


@material("wood_light")
def wood_light(nb):
    c, h = _wood(nb, "#7a5a38", "#ad8a5e")
    return dict(color=c, height=h, bump=0.45, bump_dist=0.02, rough=0.85, ao=0.85)


@material("barrel_wood")
def barrel_wood(nb):
    # 桶板:徑向漸層 × 片數 → 每片木板之間有一道深縫
    o = nb.coord("Object")
    ang = nb.gradient(o, "RADIAL")
    staves = nb.math("FRACT", nb.math("MULTIPLY", ang, 18.0))
    seam = nb.remap(nb.math("ABSOLUTE", nb.math("SUBTRACT", staves, 0.5)), 0.44, 0.5, 0.0, 1.0)
    shade = nb.math("FLOOR", nb.math("MULTIPLY", ang, 18.0))
    shade = nb.math("FRACT", nb.math("MULTIPLY", shade, 0.618))
    g = nb.noise(nb.mapping(o, scale=(30, 30, 2.5)), 1.0, 5, 0.6, 1.0)
    base = nb.ramp(g, [(0.3, srgb("#5a3d24")), (0.7, srgb("#8a6440"))])
    base = nb.mix(nb.math("MULTIPLY", shade, 0.35), base, srgb("#3e2a18"))
    base = nb.mix(seam, base, srgb("#24170c"))
    height = nb.math("SUBTRACT", g, nb.math("MULTIPLY", seam, 1.5))
    return dict(color=base, height=height, bump=0.5, bump_dist=0.02, rough=0.85, ao=0.85)


@material("iron")
def iron(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 25, 5, 0.6)
    base = nb.ramp(n, [(0.35, srgb("#2a2826")), (0.7, srgb("#4a4440"))])
    return dict(color=base, height=n, bump=0.2, rough=0.55, metal=0.6, ao=0.8)


@material("glass")
def glass(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 3, 2, 0.5)
    base = nb.ramp(n, [(0.3, srgb("#16191d")), (0.7, srgb("#262c33"))])
    return dict(color=base, height=None, rough=0.3, ao=0.6)


def _stone(nb, light, dark, scale=1.0, moss=0.5):
    o = nb.coord("Object")
    nz = nb.sep(nb.geo("Normal"))["Z"]
    n1 = nb.noise(o, 1.8 * scale, 6, 0.6)
    n2 = nb.noise(o, 9 * scale, 5, 0.6)
    warp = nb.node("ShaderNodeVectorMath", operation="ADD")
    nb.put(warp.inputs[0], o)
    nb.put(warp.inputs[1], nb.mapping(nb.noise(o, 2.0, 3, 0.5, out="Color"), scale=(0.35, 0.35, 0.35)))
    cracks = nb.voronoi(warp.outputs[0], 2.2 * scale, "DISTANCE_TO_EDGE")
    crack = nb.math("MULTIPLY", nb.remap(cracks, 0.0, 0.022, 1.0, 0.0),
                    nb.remap(nb.noise(o, 1.3 * scale, 2, 0.5), 0.45, 0.6, 0.0, 1.0))
    base = nb.ramp(n1, [(0.3, srgb(dark)), (0.7, srgb(light))])
    base = nb.mix(nb.math("MULTIPLY", n2, 0.4), base, srgb(dark))
    base = nb.mix(nb.math("MULTIPLY", crack, 0.45), base, srgb("#4a4741"))
    if moss:
        mn = nb.noise(o, 2.2 * scale, 5, 0.65)
        mask = nb.math("ADD", nb.remap(nz, 0.25, 0.85, 0.0, 1.0), nb.remap(mn, 0.35, 0.75, -0.8, 0.5))
        mask = nb.remap(mask, 0.35, 0.85, 0.0, moss)
        mcol = nb.ramp(nb.noise(o, 14 * scale, 4, 0.6), [(0.3, srgb("#4e6230")), (0.7, srgb("#7e8a45"))])
        base = nb.mix(mask, base, mcol)
    height = nb.math("SUBTRACT", nb.math("ADD", n2, nb.math("MULTIPLY", n1, 0.5)), nb.math("MULTIPLY", crack, 0.6))
    return base, height


@material("rock")
def rock(nb):
    c, h = _stone(nb, "#a7a59b", "#6d6b64", 1.0, 0.8)
    return dict(color=c, height=h, bump=0.5, bump_dist=0.04, rough=0.9, ao=0.85)


@material("stone_found")
def stone_found(nb):
    c, h = _stone(nb, "#a9a79f", "#6e6c66", 2.5, 0.55)
    return dict(color=c, height=h, bump=0.45, bump_dist=0.02, rough=0.9, ao=0.9)


@material("stone_dark")
def stone_dark(nb):
    c, h = _stone(nb, "#6c6f72", "#3f4246", 2.5, 0.35)
    return dict(color=c, height=h, bump=0.45, bump_dist=0.02, rough=0.85, ao=0.9)


@material("chimney")
def chimney(nb):
    # 砌石:voronoi 方格 → 每顆石頭不同色 + 灰縫
    o = nb.coord("Object")
    vo = nb.mapping(o, scale=(5.5, 5.5, 8.0))
    cell = nb.voronoi(vo, 1.0, "F1", "Color")
    edge = nb.voronoi(vo, 1.0, "DISTANCE_TO_EDGE")
    mortar = nb.remap(edge, 0.02, 0.07, 1.0, 0.0)
    cv = nb.sep(cell)["X"]
    base = nb.ramp(cv, [(0.0, srgb("#7d7a72")), (0.5, srgb("#a19d92")), (1.0, srgb("#bfb8a8"))])
    base = nb.mix(nb.math("MULTIPLY", nb.noise(o, 12, 4, 0.6), 0.3), base, srgb("#5b5850"))
    base = nb.mix(mortar, base, srgb("#57524a"))
    height = nb.math("SUBTRACT", nb.noise(o, 14, 4, 0.6), nb.math("MULTIPLY", mortar, 1.2))
    return dict(color=base, height=height, bump=0.6, bump_dist=0.03, rough=0.9, ao=0.9)


@material("bark")
def bark(nb):
    o = nb.coord("Object")
    n = nb.noise(nb.mapping(o, scale=(9, 9, 1.2)), 1.0, 7, 0.65, 0.8)
    furrow = nb.wave(nb.mapping(o, scale=(1, 1, 0.15)), 4.0, 8.0, 4.0, "X")
    base = nb.ramp(n, [(0.3, srgb("#2f241c")), (0.7, srgb("#5e4a3a"))])
    base = nb.mix(nb.math("MULTIPLY", furrow, 0.4), base, srgb("#1f1812"))
    height = nb.math("ADD", n, nb.math("MULTIPLY", furrow, 0.5))
    return dict(color=base, height=height, bump=0.7, bump_dist=0.03, rough=0.95, ao=0.9)


def _foliage(nb, dark, mid, light, clump=7.0):
    o = nb.coord("Object")
    nz = nb.sep(nb.geo("Normal"))["Z"]
    # 葉團:voronoi 小圓丘(中心亮、邊緣暗)+ 細葉雜訊
    co = nb.node("ShaderNodeVectorMath", operation="ADD")
    nb.put(co.inputs[0], o)
    nb.put(co.inputs[1], nb.mapping(nb.noise(o, 1.2, 2, 0.5, out="Color"), scale=(0.25, 0.25, 0.25)))
    cl = nb.voronoi(co.outputs[0], clump, "F1", "Distance")
    leaf = nb.noise(o, 28, 5, 0.65)
    big = nb.noise(o, 0.7, 3, 0.5)
    t = nb.math("ADD", nb.remap(nz, -0.6, 0.9, 0.0, 0.62), nb.remap(cl, 0.15, 0.75, 0.16, -0.14))
    t = nb.math("ADD", t, nb.remap(leaf, 0.3, 0.7, -0.07, 0.07))
    t = nb.math("ADD", t, nb.remap(big, 0.35, 0.65, -0.12, 0.12))
    base = nb.ramp(t, [(0.05, srgb(dark)), (0.45, srgb(mid)), (0.85, srgb(light))])
    base = nb.mul(base, nb.attr("col"))
    height = nb.math("ADD", nb.math("MULTIPLY", cl, -1.0), nb.math("MULTIPLY", leaf, 0.35))
    return base, height


@material("foliage_bush")
def foliage_bush(nb):
    c, h = _foliage(nb, "#1f3a16", "#3f672c", "#7ea24b", 4.0)
    return dict(color=c, height=h, bump=0.6, bump_dist=0.03, rough=0.95, ao=0.9)


@material("petal")
def petal(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 40, 3, 0.5)
    base = nb.mul(nb.ramp(n, [(0.3, (0.82, 0.82, 0.82)), (0.7, (1.0, 1.0, 1.0))]), nb.attr("col"))
    return dict(color=base, height=n, bump=0.2, rough=0.8, ao=0.6)


@material("stem")
def stem(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 20, 3, 0.5)
    base = nb.ramp(n, [(0.3, srgb("#2f4f1f")), (0.7, srgb("#4f7a33"))])
    return dict(color=base, height=None, rough=0.9, ao=0.8)


@material("lid")
def lid(nb):
    # 木桶蓋:同心年輪
    o = nb.coord("Object")
    r = nb.math("SQRT", nb.math("ADD", nb.math("POWER", nb.sep(o)["X"], 2), nb.math("POWER", nb.sep(o)["Y"], 2)))
    rings = nb.math("SINE", nb.math("ADD", nb.math("MULTIPLY", r, 90.0), nb.math("MULTIPLY", nb.noise(o, 6, 3, 0.5), 6.0)))
    g = nb.noise(nb.mapping(o, scale=(3, 40, 3)), 1.0, 4, 0.6)
    base = nb.ramp(nb.math("ADD", nb.math("MULTIPLY", rings, 0.25), g), [(0.3, srgb("#8a6844")), (0.8, srgb("#b89670"))])
    return dict(color=base, height=g, bump=0.3, rough=0.85, ao=0.85)


@material("ground_preview")
def ground_preview(nb):
    # 只給預覽算圖用的地面(遊戲裡地面由 Three.js 畫)
    o = nb.coord("Object")
    n2 = nb.noise(o, 6, 5, 0.6)
    path = nb.attr("col")
    grass = nb.ramp(n2, [(0.3, srgb("#3d5e22")), (0.7, srgb("#5e8233"))])
    dirt = nb.ramp(n2, [(0.3, srgb("#5f4430")), (0.7, srgb("#7e5d40"))])
    base = nb.mix(nb.sep(path)["X"], grass, dirt)
    return dict(color=base, height=n2, bump=0.3, rough=0.95, ao=0.8)


# ---------------------------------------------------------------- 角色

@material("fur")
def fur(nb):
    # 毛色由頂點色決定(柯基的橘/白分界、鴨子的白羽);材質只加毛流的細節與凹凸
    o = nb.coord("Object")
    strands = nb.noise(nb.mapping(o, scale=(60, 60, 14)), 1.0, 5, 0.6, 0.6)
    clumps = nb.noise(o, 9, 4, 0.55)
    shade = nb.ramp(nb.math("ADD", nb.math("MULTIPLY", strands, 0.6), nb.math("MULTIPLY", clumps, 0.4)),
                    [(0.25, (0.82, 0.82, 0.82)), (0.75, (1.0, 1.0, 1.0))])
    base = nb.mul(nb.attr("col"), shade)
    height = nb.math("ADD", strands, nb.math("MULTIPLY", clumps, 0.5))
    return dict(color=base, height=height, bump=0.35, bump_dist=0.006, rough=0.9, ao=0.7)


@material("glossy_black")
def glossy_black(nb):
    o = nb.coord("Object")
    return dict(color=nb.ramp(nb.noise(o, 30, 2, 0.5), [(0.3, srgb("#0d0d0f")), (0.7, srgb("#1c1b1f"))]),
                height=None, rough=0.25, ao=0.3)


@material("beak")
def beak(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 25, 3, 0.5)
    base = nb.mul(nb.ramp(n, [(0.3, (0.9, 0.9, 0.9)), (0.7, (1.0, 1.0, 1.0))]), nb.attr("col"))
    return dict(color=base, height=n, bump=0.1, rough=0.55, ao=0.6)


@material("helmet")
def helmet(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 18, 5, 0.6)
    scratches = nb.remap(nb.noise(nb.mapping(o, scale=(40, 3, 40)), 1.0, 3, 0.5), 0.62, 0.7, 0.0, 1.0)
    base = nb.ramp(n, [(0.3, srgb("#4b5631")), (0.7, srgb("#66734a"))])
    base = nb.mix(nb.math("MULTIPLY", scratches, 0.4), base, srgb("#8d9468"))
    return dict(color=base, height=n, bump=0.25, rough=0.7, ao=0.75)


@material("plastic")
def plastic(nb):
    # 玩具槍的塑膠:顏色來自頂點色(槍身藍綠、槍口橘)
    o = nb.coord("Object")
    n = nb.noise(o, 40, 2, 0.5)
    base = nb.mul(nb.ramp(n, [(0.3, (0.92, 0.92, 0.92)), (0.7, (1.0, 1.0, 1.0))]), nb.attr("col"))
    return dict(color=base, height=None, rough=0.4, ao=0.7)


# ---------------------------------------------------------------- 水邊植物與挖掘點

@material("reed")
def reed(nb):
    # 蘆葦莖葉:越往上越黃,沿長邊有細纖維
    o = nb.coord("Object")
    z = nb.sep(o)["Z"]
    fib = nb.noise(nb.mapping(o, scale=(80, 80, 3)), 1.0, 4, 0.6)
    base = nb.ramp(nb.math("ADD", nb.remap(z, 0.0, 1.8, 0.0, 0.8), nb.math("MULTIPLY", fib, 0.25)),
                   [(0.1, srgb("#3f5a24")), (0.55, srgb("#7d8f3e")), (0.95, srgb("#c2b26a"))])
    base = nb.mul(base, nb.attr("col"))
    return dict(color=base, height=fib, bump=0.3, rough=0.85, ao=0.6)


@material("cattail")
def cattail(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 60, 5, 0.6)
    base = nb.ramp(n, [(0.3, srgb("#4a2e1a")), (0.7, srgb("#6e4528"))])
    return dict(color=base, height=n, bump=0.5, bump_dist=0.01, rough=0.95, ao=0.7)


@material("waterweed")
def waterweed(nb):
    o = nb.coord("Object")
    z = nb.sep(o)["Z"]
    n = nb.noise(o, 20, 4, 0.6)
    base = nb.ramp(nb.math("ADD", nb.remap(z, 0.0, 0.9, 0.0, 0.7), nb.math("MULTIPLY", n, 0.3)),
                   [(0.1, srgb("#1f4a2a")), (0.6, srgb("#3f7d3a")), (0.95, srgb("#7fae4a"))])
    base = nb.mul(base, nb.attr("col"))
    return dict(color=base, height=n, bump=0.2, rough=0.7, ao=0.6)


@material("lilypad")
def lilypad(nb):
    o = nb.coord("Object")
    x, y = nb.sep(o)["X"], nb.sep(o)["Y"]
    ang = nb.gradient(o, "RADIAL")
    veins = nb.remap(nb.math("ABSOLUTE", nb.math("SINE", nb.math("MULTIPLY", ang, 75.0))), 0.0, 0.12, 1.0, 0.0)
    n = nb.noise(o, 8, 4, 0.6)
    base = nb.ramp(n, [(0.3, srgb("#2f6a2a")), (0.7, srgb("#4f8f38"))])
    base = nb.mix(nb.math("MULTIPLY", veins, 0.35), base, srgb("#86b356"))
    return dict(color=base, height=nb.math("SUBTRACT", n, veins), bump=0.25, rough=0.35, ao=0.5)


@material("dirt")
def dirt(nb):
    o = nb.coord("Object")
    n1 = nb.noise(o, 6, 5, 0.6)
    n2 = nb.noise(o, 30, 4, 0.6)
    pebbles = nb.remap(nb.voronoi(o, 18, "F1", "Distance"), 0.0, 0.18, 1.0, 0.0)
    base = nb.ramp(n1, [(0.3, srgb("#4f3522")), (0.7, srgb("#76533a"))])
    base = nb.mix(nb.math("MULTIPLY", pebbles, 0.4), base, srgb("#9a8a72"))
    return dict(color=base, height=nb.math("ADD", n2, pebbles), bump=0.5, bump_dist=0.01, rough=0.95, ao=0.85)


@material("bone")
def bone_mat(nb):
    o = nb.coord("Object")
    n = nb.noise(o, 20, 4, 0.6)
    base = nb.ramp(n, [(0.3, srgb("#d9cfb8")), (0.7, srgb("#f2ead8"))])
    return dict(color=base, height=n, bump=0.15, rough=0.6, ao=0.7)
