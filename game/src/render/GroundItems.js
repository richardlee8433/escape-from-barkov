import * as THREE from "three";
import { RARITIES } from "../config/treasures.js";
import { bus } from "../core/EventBus.js";
import { treasureTexture } from "./DigFx.js";

// 被鴨子啄掉、落在地上的寶物:從柯基身上彈出來,落地後在原地輕輕上下浮動、
// 腳下一圈稀有度顏色的光環,按 E 撿回背包就消失。
export class GroundItems {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map(); // item → { sp, ring, tex, t, x, z, fromX, fromZ }
    this.ringGeo = new THREE.RingGeometry(0.45, 0.6, 32);
    this.ringGeo.rotateX(-Math.PI / 2);

    bus.on("backpack:dropped", ({ item, treasure, fromX, fromZ }) => this.add(item, treasure, fromX, fromZ));
    bus.on("backpack:picked", ({ item }) => this.remove(item));
  }

  add(item, treasure, fromX = item.x, fromZ = item.z) {
    const color = RARITIES[treasure.tier].color;
    const tex = treasureTexture(treasure.icon, color);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.setScalar(1.0);
    sp.renderOrder = 955;
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
    }));
    ring.position.set(item.x, 0.05, item.z);
    this.scene.add(sp, ring);
    this.items.set(item, { sp, ring, tex, t: 0, x: item.x, z: item.z, fromX, fromZ });
  }

  remove(item) {
    const g = this.items.get(item);
    if (!g) return;
    this.scene.remove(g.sp, g.ring);
    g.sp.material.dispose();
    g.ring.material.dispose();
    g.tex.dispose();
    this.items.delete(item);
  }

  frame(dt, t) {
    for (const g of this.items.values()) {
      g.t += dt;
      // 前 0.5 秒:從柯基身上拋物線彈到落點;之後浮在落點上方輕輕上下
      const k = Math.min(1, g.t / 0.5);
      const x = g.fromX + (g.x - g.fromX) * k;
      const z = g.fromZ + (g.z - g.fromZ) * k;
      const arc = Math.sin(Math.PI * k) * 1.4;
      const bob = k >= 1 ? Math.sin(t * 2.6 + g.x) * 0.08 : 0;
      g.sp.position.set(x, 0.65 + arc + bob, z);
      g.ring.material.opacity = 0.45 + 0.25 * Math.sin(t * 3 + g.z);
    }
  }
}
