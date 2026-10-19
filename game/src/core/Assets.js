import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const BLENDER_BASE = "./assets/models/";

// Blender 程序化資產(tools/blender/ 產生,烘焙了顏色 × AO + 法線貼圖)
const BLENDER = [
  "cottage", "well",
  "tree_conifer_a", "tree_conifer_b", "tree_round_a", "tree_round_b",
  "rock_a", "rock_b", "rock_c",
  "bush", "bush_flower", "stump", "log",
  "fence", "gate", "bridge",
  "barrel", "crate", "chest",
  "reeds", "waterweed", "lilypad", "lily", "dirt_pile",
  // 柯基的家(室內):可以修的東西都有壞的 / 修好的兩個版本
  "home_shell", "home_floor", "home_floor_broken", "home_fireplace", "home_fireplace_broken",
  "home_window", "home_window_broken", "home_shelf", "home_shelf_broken", "home_table", "home_table_broken",
  "home_bed", "home_rug", "home_debris",
  // 角色:帶骨架與動畫(柯基 Idle/Walk/Run/Dig/Proud/Sniff,鴨子 Idle/Walk/Run/Peck)
  "corgi", "duck",
  "home_ext_shell", "home_ext_roof", "home_ext_roof_broken", "home_ext_windows", "home_ext_windows_broken",
  "home_ext_chimney", "home_ext_chimney_broken",
];

// 樹葉面片(trees.py):透明葉叢貼圖用 alpha test 切出葉形(陰影也跟著是一片片的葉影),
// 雙面顯示。法線在 Blender 裡已改成「從樹冠中心往外」,背面不要再翻轉法線,
// 否則轉到背面的葉片會突然變暗,整個樹冠斑斑駁駁。
const NORMAL_NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", "");
export function setupLeaves(m) {
  m.transparent = false;
  m.depthWrite = true;
  m.alphaTest = 0.45;
  m.side = THREE.DoubleSide;
  m.metalness = 0;
  m.roughness = 0.85;
  if (m.map) m.map.anisotropy = 4;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <normal_fragment_begin>", NORMAL_NO_FLIP)
      // 遠處的 mipmap 會把葉緣的透明度平均掉,alpha test 後葉子越縮越小、最後整棵樹變光禿。
      // 依 mip 層級把 alpha 拉高,遠近看起來一樣茂密。
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 texel = vMapUv * 512.0;
         float lod = max(0.0, log2(max(length(dFdx(texel)), length(dFdy(texel)))));
         diffuseColor.a *= 1.0 + lod * 0.35;`
      );
  };
  m.customProgramCacheKey = () => "leaves";
}

export class Assets {
  constructor() {
    this.lib = new Map(); // name → { scene, size, skinned, clips }
    this.loader = new GLTFLoader();
    // GLB 內嵌的貼圖改用 <img> 載入(TextureLoader),不用 ImageBitmapLoader:
    // 後者是 fetch(blob:),在限制 fetch 來源的主機上會被擋,模型就沒有貼圖。
    this.loader.register((parser) => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      parser.textureLoader.setCrossOrigin(parser.options.crossOrigin);
      parser.textureLoader.setRequestHeader(parser.options.requestHeader);
      return { name: "barkov_img_textures" };
    });
  }

  async loadAll(onProgress) {
    const entries = BLENDER.map((n) => [n, BLENDER_BASE + n + ".glb"]);
    let done = 0;
    await Promise.all(
      entries.map(([name, url]) =>
        this._load(name, url).then(() => onProgress?.(++done, entries.length))
      )
    );
  }

  // 取得 glTF。一般網站直接載 .glb;
  // 「.glb.json」是給限制較嚴的主機(claude.ai Artifact)的包裝:整個 GLB 以 base64 放在 JSON 裡。
  // 那種主機不提供 .glb 類型,也不准 fetch data: 網址,所以在這裡自己解碼成 ArrayBuffer 再解析。
  _fetchGltf(url, onLoad, onError) {
    if (!url.endsWith(".glb.json")) return this.loader.load(url, onLoad, undefined, onError);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.json();
      })
      .then(({ glb }) => {
        const bin = atob(glb);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        this.loader.parse(bytes.buffer, url.slice(0, url.lastIndexOf("/") + 1), onLoad, onError);
      })
      .catch(onError);
  }

  _load(name, url) {
    const baked = BLENDER.includes(name);
    return new Promise((resolve, reject) => {
      this._fetchGltf(url, (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material && baked && o.material.name.endsWith("_leaves")) {
              setupLeaves(o.material);
            } else if (o.material && baked) {
              // 烘焙貼圖已含 AO;只補上斜角取樣讓俯視角下的貼圖不糊
              for (const t of [o.material.map, o.material.normalMap]) if (t) t.anisotropy = 8;
              o.material.metalness = 0;
              // 柯基的頂點色是「毛長」資料(給 Fur.js),不是顏色,不能乘到貼圖上
              o.material.vertexColors = false;
            } else if (o.material) {
              o.material.roughness = 1;
              o.material.metalness = 0;
            }
          }
        });
        const scene = root;
        let skinned = false;
        scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
        const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
        this.lib.set(name, { scene, size, skinned, clips: gltf.animations });
        resolve();
      }, (err) => reject(new Error(`${name}: ${err?.message || err}`)));
    });
  }

  // 模型附帶的動畫片段(角色用)
  clips(name) {
    return this.lib.get(name)?.clips ?? [];
  }

  // 原封不動的複本(不縮放、不移動):家裡的零件都在同一個房間座標裡建模,直接疊在原點
  cloneRaw(name) {
    const rec = this.lib.get(name);
    if (!rec) throw new Error(`Model not loaded: ${name}`);
    return rec.scene.clone(true);
  }

  // 產生一個實例：縮放到目標尺寸、腳底貼齊 y=0。
  // dim: "y" 按高度縮放；"max" 按最大邊縮放（給橋、木頭這種扁長模型）；
  //      "scale" 直接把 target 當倍率(Blender 資產以公尺建模,原尺寸就對)
  // center: 水平置中（角色用；Kenney 地景件本身已對齊原點，不需要）
  instantiate(name, target, { dim = "y", center = false } = {}) {
    const rec = this.lib.get(name);
    if (!rec) throw new Error(`Model not loaded: ${name}`);
    // SkinnedMesh 用一般 clone 會讓骨架指向原始骨骼(隱形),要用 SkeletonUtils
    const obj = rec.skinned ? SkeletonUtils.clone(rec.scene) : rec.scene.clone(true);
    const ref = dim === "max" ? Math.max(rec.size.x, rec.size.y, rec.size.z) : dim === "scale" ? 1 : rec.size.y;
    obj.scale.setScalar(target / ref);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.y = -box.min.y;
    if (center) {
      obj.position.x = -c.x;
      obj.position.z = -c.z;
    }
    return obj;
  }
}
