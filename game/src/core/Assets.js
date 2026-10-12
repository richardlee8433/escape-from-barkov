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
];

// 角色模型（CC-BY 4.0）與拾取物（Kenney CC0,各包貼圖同名故分資料夾）
const SPECIAL = {
  corgi: "../luug_corgi_tales_of_arcadia.glb",
  duck: MODEL_BASE + "voxel_duck.glb",
  pickup_heart: MODEL_BASE + "pickups-platformer/heart.glb",
  pickup_ammo: MODEL_BASE + "pickups-blaster/clip-large.glb",
  bullet: MODEL_BASE + "pickups-blaster/bullet-foam.glb",
};

export class Assets {
  constructor() {
    this.lib = new Map(); // name → { scene, size }
    this.loader = new GLTFLoader();
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

  _load(name, url) {
    const baked = BLENDER.includes(name);
    return new Promise((resolve, reject) => {
      this.loader.load(url, (gltf) => {
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
