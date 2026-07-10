import * as THREE from "three";
import { ITEM_TYPES } from "../config/balance.js";

// 地上的掉落物：實體模型 + 地面光圈 + 浮動旋轉。
const STYLES = {
  [ITEM_TYPES.MEDKIT]: { model: "pickup_heart", h: 0.7, ring: 0xff6b5c },
  [ITEM_TYPES.AMMO]: { model: "pickup_ammo", h: 0.6, ring: 0xffd35c },
};

export class ItemDrop {
  constructor(scene, assets, type, x, z) {
    this.type = type;
    const s = STYLES[type];

    this.mesh = new THREE.Group();
    this.model = assets.instantiate(s.model, s.h, { center: true });
    this.mesh.add(this.model);

    // 地面光圈讓拾取物在草叢裡也看得到
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.68, 28),
      new THREE.MeshBasicMaterial({ color: s.ring, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.mesh.add(ring);

    this.mesh.position.set(x, 0, z);
    this.phase = Math.random() * Math.PI * 2;
    scene.add(this.mesh);
  }

  get pos() {
    return this.mesh.position;
  }

  bob(t) {
    this.model.position.y = 0.25 + Math.sin(t * 2.2 + this.phase) * 0.12;
    this.model.rotation.y = t * 1.2 + this.phase;
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}
