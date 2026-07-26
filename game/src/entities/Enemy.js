import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { EnemyBrain } from "../ai/EnemyBrain.js";

const E = BAL.enemy;

export class Enemy {
  constructor(scene, assets, collision, x, z) {
    this.hp = E.hp;
    this.brain = new EnemyBrain(this, collision);

    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    const model = assets.instantiate("duck", E.height, { center: true });
    this.root.add(model);
    scene.add(this.root);

    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    this.hitR = Math.max(size.x, size.z) * 0.6;
  }

  get pos() {
    return this.root.position;
  }

  update(dt, playerPos, difficulty, collision, combat) {
    const intent = this.brain.update(dt, playerPos, difficulty);

    if (intent.move) {
      const next = this.pos.clone().addScaledVector(intent.move, dt);
      collision.resolveCircle(next, this.hitR * 0.8);
      this.pos.copy(next);
    }
    if (intent.faceYaw !== null) {
      let diff = intent.faceYaw - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, dt * 8);
    }

    // 開火時機完全由 brain 決定（含冷卻與前搖),這裡只負責執行
    if (intent.fire) {
      const from = this.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
      const dir = playerPos.clone().sub(this.pos).setY(0);
      combat.fireEnemy(from, dir);
    }
  }

  // 中彈退後（退完要解碰撞,避免被打進石頭裡）
  knockback(fromPos, collision) {
    const away = this.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(E.knockback);
    this.pos.add(away);
    collision.resolveCircle(this.pos, this.hitR * 0.8);
  }

  dispose(scene) {
    scene.remove(this.root);
  }
}
