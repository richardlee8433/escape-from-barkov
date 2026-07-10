import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const MODEL_BASE = "../proto/assets/models/";

// Kenney 環境模型（CC0），與 proto 共用同一份檔案
const KENNEY = [
  "tree_pineRoundA", "tree_pineRoundB", "tree_pineRoundC", "tree_pineRoundD",
  "tree_pineSmallA", "tree_pineSmallB",
  "stone_largeA", "stone_largeB", "stone_largeC", "stone_largeD",
  "stone_smallA", "stone_smallC", "stone_smallE", "stone_tallB", "stone_tallD",
  "fence_simple", "fence_gate", "bridge_wood",
  "grass_leafs", "plant_bushSmall", "plant_bushLarge",
  "mushroom_red", "log", "stump_round",
  "box", "box-large", "box-open", "barrel", "chest",
];

// 角色模型（CC-BY 4.0）與拾取物（Kenney CC0,各包貼圖同名故分資料夾）
const SPECIAL = {
  corgi: "../luug_corgi_tales_of_arcadia.glb",
  duck: MODEL_BASE + "voxel_duck.glb",
  pickup_heart: MODEL_BASE + "pickups-platformer/heart.glb",
  pickup_ammo: MODEL_BASE + "pickups-blaster/clip-large.glb",
  bullet: MODEL_BASE + "pickups-blaster/bullet-foam.glb",
};

// Kenney 樹葉是偏藍綠色，改成參考圖的暖黃綠
const FOLIAGE_GREENS = [new THREE.Color(0x649c3d), new THREE.Color(0x77b04a), new THREE.Color(0x86bd58)];
function warmifyFoliage(mat) {
  const c = mat.color;
  if (c && c.g > c.r && c.b > c.r * 1.15) {
    const lum = c.r * 0.3 + c.g * 0.6 + c.b * 0.1;
    mat.color = FOLIAGE_GREENS[lum > 0.45 ? 2 : lum > 0.28 ? 1 : 0].clone();
  }
}

export class Assets {
  constructor() {
    this.lib = new Map(); // name → { scene, size }
    this.loader = new GLTFLoader();
  }

  async loadAll(onProgress) {
    const entries = [
      ...KENNEY.map((n) => [n, MODEL_BASE + n + ".glb"]),
      ...Object.entries(SPECIAL),
    ];
    let done = 0;
    await Promise.all(
      entries.map(([name, url]) =>
        this._load(name, url).then(() => onProgress?.(++done, entries.length))
      )
    );
  }

  _load(name, url) {
    const recolor = /^(tree_|plant_|grass)/.test(name);
    return new Promise((resolve, reject) => {
      this.loader.load(url, (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              o.material.roughness = 1;
              o.material.metalness = 0;
              if (recolor) warmifyFoliage(o.material);
            }
          }
        });
        // 鴨子模型原始朝向是 -Z，包一層讓「正面 = +Z」，與 AI 的 FOV 方向一致
        let scene = root;
        if (name === "duck") {
          scene = new THREE.Group();
          root.rotation.y = Math.PI;
          scene.add(root);
        }
        let skinned = false;
        scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
        const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
        this.lib.set(name, { scene, size, skinned });
        resolve();
      }, undefined, reject);
    });
  }

  // 產生一個實例：縮放到目標尺寸、腳底貼齊 y=0。
  // dim: "y" 按高度縮放；"max" 按最大邊縮放（給橋、木頭這種扁長模型）
  // center: 水平置中（角色用；Kenney 地景件本身已對齊原點，不需要）
  instantiate(name, target, { dim = "y", center = false } = {}) {
    const rec = this.lib.get(name);
    if (!rec) throw new Error(`Model not loaded: ${name}`);
    // SkinnedMesh 用一般 clone 會讓骨架指向原始骨骼(隱形),要用 SkeletonUtils
    const obj = rec.skinned ? SkeletonUtils.clone(rec.scene) : rec.scene.clone(true);
    const ref = dim === "max" ? Math.max(rec.size.x, rec.size.y, rec.size.z) : rec.size.y;
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
