import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

// 敵人狀態機：patrol（巡邏）→ chase（追擊）→ windup（舉槍）→ chase，
// 失去視線後 chase → search（搜尋最後已知位置）→ patrol。
//
// 感知 / 意圖 / 動作三層分離：canSee() 是唯一的感知入口，
// 三關都要過——距離、視錐、實體遮擋——敵人才算「看見」玩家。
// 開火不是冷卻到就打：要先面向對準，再經過 windup 前搖，
// 前搖結束當下重新驗證視線，中途被遮住就中止。
const E = BAL.enemy;

export class EnemyBrain {
  constructor(enemy, collision) {
    this.enemy = enemy;
    this.collision = collision;
    this.state = "patrol";
    this.patrolDir = Math.random() * Math.PI * 2;
    this.loseSightTimer = 0;
    this.fireCd = Math.random() * E.fireCd; // 錯開初始冷卻,避免整群同時開火
    this.windup = 0;
    this.lastKnown = new THREE.Vector3();
  }

  // 距離 → 視錐 → 遮擋
  canSee(playerPos) {
    const p = this.enemy.pos;
    const dx = playerPos.x - p.x;
    const dz = playerPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > E.detectDist) return false;
    const yaw = this.enemy.root.rotation.y;
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / (dist || 1);
    if (dot < Math.cos((E.fovDeg * Math.PI) / 360)) return false;
    return !this.collision.sightBlocked(p.x, p.z, playerPos.x, playerPos.z);
  }

  // 面向是否已經對準目標（沒對準就不准舉槍,杜絕「瞬間轉身開槍」）
  aimAligned(targetYaw) {
    let diff = targetYaw - this.enemy.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) < E.aimTolerance;
  }

  // 回傳這一刻的行動意圖：{ move: Vector3|null, faceYaw: number|null, fire: bool }
  update(dt, playerPos, difficulty) {
    this.fireCd -= dt;
    const p = this.enemy.pos;
    const dx = playerPos.x - p.x;
    const dz = playerPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    const seen = this.canSee(playerPos);
    const faceYaw = Math.atan2(dx, dz);
    const speed = E.baseSpeed * (0.8 + 0.4 * difficulty);

    if (seen) {
      this.lastKnown.copy(playerPos);
      this.loseSightTimer = 0;
    }

    // 舉槍中：站定不動，決策已經鎖定，只有視線斷掉才中止
    if (this.state === "windup") {
      if (!seen) {
        this.state = "chase";
        bus.emit("enemy:windupCancel", { enemy: this.enemy });
        return { move: null, faceYaw, fire: false };
      }
      this.windup -= dt;
      if (this.windup > 0) return { move: null, faceYaw, fire: false };
      this.state = "chase";
      this.fireCd = E.fireCd / (0.7 + 0.5 * difficulty) + Math.random() * 0.3;
      return { move: null, faceYaw, fire: true };
    }

    if (seen && this.state !== "chase") {
      this.state = "chase";
      bus.emit("enemy:alerted", { enemy: this.enemy });
    } else if (!seen && this.state === "chase") {
      this.loseSightTimer += dt;
      if (this.loseSightTimer > E.loseSightTime) this.state = "search";
    }

    if (this.state === "patrol") {
      this.patrolDir += (Math.random() - 0.5) * dt * 1.2;
      const move = new THREE.Vector3(Math.cos(this.patrolDir), 0, Math.sin(this.patrolDir))
        .multiplyScalar(speed * E.patrolSpeedMul);
      return { move, faceYaw: Math.atan2(move.x, move.z), fire: false };
    }

    if (this.state === "search") {
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

    // chase：射程內且已經對準 → 進入前搖；否則拉近距離
    if (seen && dist < E.fireRange && this.fireCd <= 0 && this.aimAligned(faceYaw)) {
      this.state = "windup";
      this.windup = E.windupTime;
      bus.emit("enemy:windup", { enemy: this.enemy, duration: E.windupTime });
      return { move: null, faceYaw, fire: false };
    }
    const move = dist > E.desiredDist
      ? new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(speed)
      : null;
    return { move, faceYaw, fire: false };
  }
}
