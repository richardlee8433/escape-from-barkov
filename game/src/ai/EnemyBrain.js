import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

// 敵人狀態機：patrol（巡邏）→ chase（追擊）→ windup（啄擊前搖）→ chase，
// 失去視線後 chase → search（搜尋最後已知位置）→ patrol。
//
// 鴨子不拿槍:看見柯基就衝過去追,追到身邊才啄。
// 感知 / 意圖 / 動作三層分離：canSee() 是唯一的感知入口，
// 三關都要過——距離、視錐、實體遮擋——敵人才算「看見」玩家。
// 啄擊不是一貼身就打：要先面向對準，再經過 windup 前搖(地上有預告圈),
// 前搖結束當下重新驗證視線與距離——柯基在前搖中跑開或躲到掩體後,這一啄就落空。
// 啄到之後鴨子心滿意足地走開一陣子(calm),不會一直追著同一隻柯基啄。
// 被柯基吠了(scare):前搖立刻中斷,拍著翅膀往反方向逃(flee),逃完還驚魂未定一陣子(calm)。
const E = BAL.enemy;
// 移動避障:往前探幾個點,撞到石頭、水、地圖邊界就換一個方向。
// 角度慣例:angle → 方向 (cos, sin) 對應 (x, z)
const BOUND = BAL.world.size / 2 - BAL.world.edgeMargin;
const PROBE = 2.4;            // 往前探多遠
const PROBE_R = 0.9;          // 探測點的半徑(鴨子身體再寬一點)
const EDGE_ZONE = 12;         // 離邊界這麼近時,巡邏方向慢慢轉回地圖內側
const OFFSETS = [0, 0.45, 0.9, 1.4, 2.0, 2.6];
const lerpAngle = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export class EnemyBrain {
  constructor(enemy, collision) {
    this.enemy = enemy;
    this.collision = collision;
    this.state = "patrol";
    this.patrolDir = Math.random() * Math.PI * 2;
    this.loseSightTimer = 0;
    this.attackCd = Math.random() * E.attackCd; // 錯開初始冷卻,避免一群鴨子同時啄
    this.windup = 0;
    this.calm = 0; // 啄到之後的「心滿意足」秒數:這段時間不理柯基
    this.flee = 0; // 被吠之後逃跑的剩餘秒數
    this.fleeDir = 0;
    this.side = Math.random() < 0.5 ? 1 : -1; // 繞障礙物時優先往哪邊(固定一邊才不會左右抖)
    this.blockedT = 0;  // 想走卻走不動累積的秒數
    this.detour = null; // 追擊時被擋住:{ angle, t } 先繞一下
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

  // 面向是否已經對準目標（沒對準就不准出手,杜絕「瞬間轉身就啄」）
  aimAligned(targetYaw) {
    let diff = targetYaw - this.enemy.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) < E.aimTolerance;
  }

  // 這個方向往前走得通嗎(不撞石頭、不下水、不出界)
  clear(angle, dist = PROBE) {
    const p = this.enemy.pos;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const k of [0.5, 1]) {
      const x = p.x + c * dist * k, z = p.z + s * dist * k;
      if (Math.abs(x) > BOUND - PROBE_R || Math.abs(z) > BOUND - PROBE_R) return false;
      if (!this.collision.isFree(x, z, PROBE_R)) return false;
    }
    return true;
  }

  // 想往 angle 走:前面擋住就找最接近的通路(先試慣用的那一邊)。全擋住就回頭
  steer(angle) {
    for (const o of OFFSETS) {
      if (o === 0) {
        if (this.clear(angle)) return angle;
        continue;
      }
      for (const sg of [this.side, -this.side]) {
        if (this.clear(angle + o * sg)) {
          this.side = sg;
          return angle + o * sg;
        }
      }
    }
    return angle + Math.PI;
  }

  // 由 Enemy 回報這一步實際走了多少。想走卻一直走不動(卡在角落、被擠住)就換方向
  reportProgress(wanted, moved, dt) {
    if (wanted < 1e-3) {
      this.blockedT = 0;
      return;
    }
    if (moved < wanted * 0.35) this.blockedT += dt;
    else this.blockedT = Math.max(0, this.blockedT - dt * 2);
    if (this.blockedT > 0.5) {
      this.blockedT = 0;
      this.unstick();
    }
  }

  unstick() {
    const turn = this.side * (Math.PI / 2 + Math.random() * Math.PI / 2);
    this.side = -this.side;
    if (this.flee > 0) this.fleeDir += turn;
    else if (this.state === "search") this.state = "patrol";
    else if (this.state === "chase") {
      const p = this.enemy.pos;
      const to = Math.atan2(this.lastKnown.z - p.z, this.lastKnown.x - p.x);
      this.detour = { angle: to + turn, t: 0.9 };
    }
    this.patrolDir += turn;
  }

  // 巡邏 / 走開:隨意晃,靠近地圖邊界就慢慢轉回內側,前面擋住就繞開
  _wander(dt, speed) {
    this.patrolDir += (Math.random() - 0.5) * dt * 1.2;
    const p = this.enemy.pos;
    if (Math.abs(p.x) > BOUND - EDGE_ZONE || Math.abs(p.z) > BOUND - EDGE_ZONE) {
      this.patrolDir = lerpAngle(this.patrolDir, Math.atan2(-p.z, -p.x), Math.min(1, dt * 1.5));
    }
    this.patrolDir = this.steer(this.patrolDir);
    const move = new THREE.Vector3(Math.cos(this.patrolDir), 0, Math.sin(this.patrolDir)).multiplyScalar(speed);
    return { move, faceYaw: Math.atan2(move.x, move.z), attack: false };
  }

  // 被柯基吠了:從 (fromX, fromZ) 往反方向逃。前搖中也一樣中斷
  scare(fromX, fromZ) {
    if (this.state === "windup") bus.emit("enemy:windupCancel", { enemy: this.enemy });
    this.state = "patrol";
    this.windup = 0;
    const p = this.enemy.pos;
    this.fleeDir = Math.atan2(p.z - fromZ, p.x - fromX);
    this.flee = E.fleeTime;
    this.calm = 0;
    bus.emit("enemy:scared", { enemy: this.enemy });
  }

  // 回傳這一刻的行動意圖：{ move: Vector3|null, faceYaw: number|null, attack: bool }
  update(dt, playerPos, difficulty) {
    this.attackCd -= dt;
    const p = this.enemy.pos;
    const dx = playerPos.x - p.x;
    const dz = playerPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    const seen = this.canSee(playerPos);
    const faceYaw = Math.atan2(dx, dz);
    const speed = E.baseSpeed * (0.8 + 0.4 * difficulty);

    // 被吠了:頭也不回地逃,逃完接著驚魂未定(calm)
    if (this.flee > 0) {
      this.flee -= dt;
      this.state = "patrol";
      this.fleeDir += (Math.random() - 0.5) * dt * 2;
      this.fleeDir = this.steer(this.fleeDir);
      if (this.flee <= 0) {
        this.calm = E.scaredCalm;
        this.patrolDir = this.fleeDir;
      }
      const move = new THREE.Vector3(Math.cos(this.fleeDir), 0, Math.sin(this.fleeDir))
        .multiplyScalar(E.baseSpeed * E.fleeSpeedMul);
      return { move, faceYaw: Math.atan2(move.x, move.z), attack: false };
    }

    // 剛啄過:慢慢晃開,不追也不啄
    if (this.calm > 0) {
      this.calm -= dt;
      this.state = "patrol";
      return this._wander(dt, speed * E.patrolSpeedMul);
    }

    if (seen) {
      this.lastKnown.copy(playerPos);
      this.loseSightTimer = 0;
    }

    // 前搖中：站定不動，決策已經鎖定，只有視線斷掉才中止
    if (this.state === "windup") {
      if (!seen) {
        this.state = "chase";
        bus.emit("enemy:windupCancel", { enemy: this.enemy });
        return { move: null, faceYaw, attack: false };
      }
      this.windup -= dt;
      if (this.windup > 0) return { move: null, faceYaw, attack: false };
      this.state = "chase";
      this.attackCd = E.attackCd / (0.7 + 0.5 * difficulty) + Math.random() * 0.3;
      // 前搖結束時柯基已經跑出啄得到的距離 → 落空
      const hit = dist <= E.peckReach;
      if (!hit) bus.emit("enemy:attackMiss", { enemy: this.enemy });
      else {
        this.calm = E.calmTime;
        // 轉身背對柯基走開
        this.patrolDir = Math.atan2(-dz, -dx);
      }
      return { move: null, faceYaw, attack: hit };
    }

    if (seen && this.state !== "chase") {
      this.state = "chase";
      bus.emit("enemy:alerted", { enemy: this.enemy });
    } else if (!seen && this.state === "chase") {
      this.loseSightTimer += dt;
      if (this.loseSightTimer > E.loseSightTime) this.state = "search";
    }

    if (this.state === "patrol") return this._wander(dt, speed * E.patrolSpeedMul);

    if (this.state === "search") {
      const to = this.lastKnown.clone().sub(p).setY(0);
      if (to.lengthSq() < 1) {
        this.state = "patrol";
        return { move: null, faceYaw: null, attack: false };
      }
      const a = this.steer(Math.atan2(to.z, to.x));
      const move = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(speed * E.searchSpeedMul);
      return { move, faceYaw: Math.atan2(move.x, move.z), attack: false };
    }

    // chase：貼到身邊且已經對準 → 進入前搖；否則一路追過去
    if (seen && dist < E.attackRange && this.attackCd <= 0 && this.aimAligned(faceYaw)) {
      this.state = "windup";
      this.windup = E.windupTime;
      bus.emit("enemy:windup", { enemy: this.enemy, duration: E.windupTime });
      return { move: null, faceYaw, attack: false };
    }
    if (dist <= E.attackRange * 0.7) return { move: null, faceYaw, attack: false };
    // 追過去;被擋住時先照 detour 的方向繞一下
    let a = Math.atan2(dz, dx);
    if (this.detour) {
      this.detour.t -= dt;
      a = this.detour.angle;
      if (this.detour.t <= 0) this.detour = null;
    }
    // 柯基就在眼前時直直衝過去,遠一點才需要避障
    if (dist > 3) a = this.steer(a);
    const move = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(speed);
    return { move, faceYaw: this.detour ? Math.atan2(move.x, move.z) : faceYaw, attack: false };
  }
}
