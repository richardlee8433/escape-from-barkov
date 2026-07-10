import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

// 敵人三階段狀態機：patrol（巡邏）→ chase（追擊）→ search（搜尋）。
// 視野判定是「真的」FOV：巡邏時面向移動方向，只有玩家走進視錐才會被發現
// （舊版敵人永遠面向玩家，FOV 形同虛設——這裡把它修正了）。
const E = BAL.enemy;

export class EnemyBrain {
  constructor(enemy) {
    this.enemy = enemy;
    this.state = "patrol";
    this.patrolDir = Math.random() * Math.PI * 2;
    this.loseSightTimer = 0;
    this.lastKnown = new THREE.Vector3();
  }

  // 視野：距離 + 面向夾角
  canSee(playerPos) {
    const p = this.enemy.pos;
    const dx = playerPos.x - p.x;
    const dz = playerPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > E.detectDist) return false;
    const yaw = this.enemy.root.rotation.y;
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / (dist || 1);
    return dot >= Math.cos((E.fovDeg * Math.PI) / 180 / 2);
  }

  // 回傳這一刻的行動意圖：{ move: Vector3|null, faceYaw: number|null, fire: bool }
  update(dt, playerPos, difficulty) {
    const p = this.enemy.pos;
    const dx = playerPos.x - p.x;
    const dz = playerPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    const seen = this.canSee(playerPos);
    const speed = E.baseSpeed * (0.8 + 0.4 * difficulty);

    if (seen) {
      this.lastKnown.copy(playerPos);
      this.loseSightTimer = 0;
    } else if (this.state === "chase") {
      this.loseSightTimer += dt;
      if (this.loseSightTimer > E.loseSightTime) this.state = "search";
    }

    switch (this.state) {
      case "patrol": {
        if (seen) {
          this.state = "chase";
          bus.emit("enemy:alerted");
          break;
        }
        this.patrolDir += (Math.random() - 0.5) * dt * 1.2;
        const move = new THREE.Vector3(Math.cos(this.patrolDir), 0, Math.sin(this.patrolDir))
          .multiplyScalar(speed * E.patrolSpeedMul);
        return { move, faceYaw: Math.atan2(move.x, move.z), fire: false };
      }
      case "search": {
        if (seen) {
          this.state = "chase";
          bus.emit("enemy:alerted");
          break;
        }
        const to = this.lastKnown.clone().sub(p).setY(0);
        if (to.lengthSq() < 1) {
          this.state = "patrol";
          return { move: null, faceYaw: null, fire: false };
        }
        to.normalize();
        return {
          move: to.clone().multiplyScalar(speed * E.searchSpeedMul),
          faceYaw: Math.atan2(to.x, to.z),
          fire: false,
        };
      }
    }

    // chase（含剛切換進來的那一幀）
    const faceYaw = Math.atan2(dx, dz);
    let move = null;
    if (dist > E.desiredDist) {
      move = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(speed);
    }
    return { move, faceYaw, fire: seen && dist < E.fireRange };
  }
}
