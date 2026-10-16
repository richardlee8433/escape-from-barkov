"""產生 Escape from Barkov 的 3D 資產(GLB)。

兩種執行方式擇一:
  # 1) pip 版 Blender(bpy 模組,Python 3.13)
  pip install bpy==5.2.2
  python tools/blender/build_assets.py --out game/assets/models

  # 2) Blender 本體
  blender -b -P tools/blender/build_assets.py -- --out game/assets/models

選項:
  --only cottage,rock_a   只建指定資產
  --samples 8             烘焙取樣數
  --res-scale 0.5         貼圖解析度倍率(快速預覽用)
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import materials  # noqa: E402,F401  (註冊材質)
from assets import ASSETS  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="game/assets/models")
    ap.add_argument("--only", default="")
    ap.add_argument("--samples", type=int, default=8)
    ap.add_argument("--res-scale", type=float, default=1.0)
    args = ap.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    names = [n for n in args.only.split(",") if n] or list(ASSETS)
    for name in names:
        builder, kw, res, ao, *extra = ASSETS[name]
        groups = extra[0] if extra else None
        bake_opts = extra[1] if len(extra) > 1 else {}
        t0 = time.time()
        lib.reset_scene()
        ob = builder(name, **kw)
        tris = lib.tri_count(ob)
        r = max(128, int(res * args.res_scale))
        path = os.path.abspath(os.path.join(args.out, name + ".glb"))
        lib.bake_and_export(ob, path, res=r, samples=args.samples, ao_dist=ao, groups=groups, **bake_opts)
        kb = os.path.getsize(path) / 1024
        print(f"[barkov] {name:16s} {tris:7d} tris  {r}px  {kb:7.0f} KB  {time.time() - t0:5.1f}s", flush=True)


if __name__ == "__main__":
    main()
