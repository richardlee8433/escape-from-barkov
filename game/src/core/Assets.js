import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const MODEL_BASE = "../proto/assets/models/";
const BLENDER_BASE = "./assets/models/";

// Blender 程序化資產(tools/blender/ 產生,烘焙了顏色 × AO + 法線貼圖)
const BLENDER = [
  "cottage", "well",
  "tree_conifer_a", "tree_conifer_b", "tree_round_a", "tree_round_b",
  "rock_a", "rock_b", "rock_c",
  "bush", "bush_flower", "stump", "log",
  "fence", "gate", "bridge",
  "barrel", "crate", "chest",
  "reeds", "waterweed", "lilypad", "lily", "dig_mound",
  // 角色:帶骨架與動畫(柯基 Idle/Walk/Run/Dig/Proud,鴨子 Idle/Walk/Run/Peck)
  "corgi", "duck",
];

// 拾取物與子彈（Kenney CC0,各包貼圖同名故分資料夾）
const SPECIAL = {
  pickup_heart: MODEL_BASE + "pickups-platformer/heart.glb",
  pickup_ammo: MODEL_BASE + "pickups-blaster/clip-large.glb",
  bullet: MODEL_BASE + "pickups-blaster/bullet-foam.glb",
};

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
    const entries = [
      ...BLENDER.map((n) => [n, BLENDER_BASE + n + ".glb"]),
      ...Object.entries(SPECIAL),
    ];
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
            if (o.material && baked) {
              // 烘焙貼圖已含 AO;只補上斜角取樣讓俯視角下的貼圖不糊
              for (const t of [o.material.map, o.material.normalMap]) if (t) t.anisotropy = 8;
              o.material.metalness = 0;
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
