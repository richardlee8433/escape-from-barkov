import * as THREE from "three";
import { BAL } from "../config/balance.js";

// 成片的小花(藍、淡紫、白),一個 InstancedMesh 一個 draw call。
// 花是一叢一叢長的:先撒叢心,再在叢心周圍以常態分佈撒花。
const PALETTES = [
  [0x3a4fd8, 0x5266ea, 0x6d7ef2], // 藍
  [0x3a4fd8, 0x7d74e6, 0x9a90f0], // 藍紫
  [0x7a6ee0, 0x958af0, 0x6a5ed8], // 淡紫
  [0xdfe5ff, 0xf6f6f6, 0x9aa8f8], // 白(夾幾朵淡藍)
];

function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

export class FlowerField {
  constructor(scene, canGrow, clusters = 200) {
    const geo = new THREE.IcosahedronGeometry(0.085, 0);
    geo.scale(1, 0.7, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    const max = clusters * 150;
    // 每一叢一個 InstancedMesh 太碎;依位置分成 8 x 8 區塊,讓視錐剔除有效
    const CHUNKS = 8;
    const cell = BAL.world.size / CHUNKS;
    const buckets = Array.from({ length: CHUNKS * CHUNKS }, () => []);

    const size = BAL.world.size - 12;
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let k = 0; k < clusters * 3 && n < max - 120; k++) {
      const cx = (Math.random() - 0.5) * size;
      const cz = (Math.random() - 0.5) * size;
      if (!canGrow(cx, cz)) continue;
      const pal = PALETTES[(Math.random() * PALETTES.length) | 0];
      const spread = 0.9 + Math.random() * 1.8;
      const count = 60 + ((Math.random() * 120) | 0);
      for (let i = 0; i < count; i++) {
        const x = cx + gauss() * spread * 1.6;
        const z = cz + gauss() * spread * 1.6;
        if (!canGrow(x, z)) continue;
        dummy.position.set(x, 0.18 + Math.random() * 0.3, z);
        dummy.rotation.set(Math.random(), Math.random() * 6.28, Math.random());
        dummy.scale.setScalar(0.7 + Math.random() * 0.7);
        dummy.updateMatrix();
        const c = new THREE.Color(pal[(Math.random() * pal.length) | 0]).multiplyScalar(0.85 + Math.random() * 0.3);
        const bx = Math.max(0, Math.min(CHUNKS - 1, Math.floor((x + BAL.world.size / 2) / cell)));
        const bz = Math.max(0, Math.min(CHUNKS - 1, Math.floor((z + BAL.world.size / 2) / cell)));
        buckets[bz * CHUNKS + bx].push([dummy.matrix.clone(), c]);
        n++;
      }
      if (n >= clusters * 110) break;
    }
    for (const list of buckets) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([m, c], i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c);
      });
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
    this.count = n;
  }
}
