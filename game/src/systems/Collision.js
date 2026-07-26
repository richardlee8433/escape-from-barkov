import { BAL } from "../config/balance.js";

// 2D 圓形碰撞:所有擋路物（石頭、樹、木箱）是靜態圓，
// 角色也是圓。世界邊界直接 clamp。
// 這一層完全不存在高度概念——遊戲永遠在 BAL.world.gameplayY 這一個平面上。
// 邊界 clamp 在視覺石牆內側，所以石牆就算有缺口也走不出去。
const HALF = BAL.world.size / 2;
const BOUND = HALF - BAL.world.edgeMargin;

export class Collision {
  constructor() {
    this.statics = []; // { x, z, r, blocksBullets, blocksSight }
  }

  // blocksBullets=false 的物件(柵欄、溝壑)只擋移動,子彈飛得過去
  // 視線預設跟著子彈走:擋子彈的實心物(石頭、樹、木箱)同時擋視線,
  // 低矮或中空的(柵欄、橋欄杆、溝壑)兩者都不擋——看得過去也打得過去。
  addStatic(x, z, r, { blocksBullets = true, blocksSight = blocksBullets } = {}) {
    this.statics.push({ x, z, r, blocksBullets, blocksSight });
  }

  // 線段 a→b 是否被任何擋視線的靜態物切過(敵人感知用)。
  // 半徑收 0.85 倍:擦過邊緣不算遮蔽,免得敵人在掩體邊緣忽明忽暗。
  sightBlocked(ax, az, bx, bz) {
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz;
    for (const s of this.statics) {
      if (!s.blocksSight) continue;
      const wx = s.x - ax;
      const wz = s.z - az;
      let t = len2 > 1e-6 ? (wx * vx + wz * vz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - vx * t;
      const dz = wz - vz * t;
      const r = s.r * 0.85;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  // 把 pos（Vector3，就地修改）推出所有靜態圓與世界邊界。
  //
  // 石牆是大量互相重疊的圓,舊版「一輪掃過所有圓各推一次」會出事:
  // 從 A 推出去正好推進 B,再從 B 推回 A,角色就卡在夾縫裡抖動。
  // 改成每輪只解「穿透最深」的那一個——最大穿透量單調下降,幾輪就收斂,
  // 而且推出方向永遠垂直於接觸面,切線方向的移動保留下來(貼著石頭滑走)。
  resolveCircle(pos, r) {
    for (let iter = 0; iter < 8; iter++) {
      let deepest = null;
      let maxPen = 1e-4;
      for (const s of this.statics) {
        const dx = pos.x - s.x;
        const dz = pos.z - s.z;
        const min = s.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const pen = min - Math.sqrt(d2);
        if (pen > maxPen) { maxPen = pen; deepest = s; }
      }
      if (!deepest) break;
      const dx = pos.x - deepest.x;
      const dz = pos.z - deepest.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        const push = maxPen / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        pos.x += deepest.r + r; // 正好在圓心的退化情況:往 +x 推出
      }
    }
    // 邊界最後才夾,才不會被上面的推擠帶出界
    pos.x = Math.max(-BOUND, Math.min(BOUND, pos.x));
    pos.z = Math.max(-BOUND, Math.min(BOUND, pos.z));
    return pos;
  }

  // 子彈打到靜態物?(只算 blocksBullets 的)
  hitStatic(x, z, r = 0) {
    for (const s of this.statics) {
      if (!s.blocksBullets) continue;
      const dx = x - s.x;
      const dz = z - s.z;
      const min = s.r + r;
      if (dx * dx + dz * dz < min * min) return true;
    }
    return false;
  }

  // 點是否可放置（生成用,檢查所有靜態物）
  isFree(x, z, r) {
    for (const s of this.statics) {
      const dx = x - s.x;
      const dz = z - s.z;
      const min = s.r + r;
      if (dx * dx + dz * dz < min * min) return false;
    }
    return true;
  }

  // 兩兩推開（敵人之間）
  separatePair(a, b, factor = 0.8) {
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6) return;
    const wanted = (a.hitR + b.hitR) * factor;
    if (d2 >= wanted * wanted) return;
    const d = Math.sqrt(d2);
    const push = (wanted - d) * 0.5 / d;
    a.pos.x -= dx * push; a.pos.z -= dz * push;
    b.pos.x += dx * push; b.pos.z += dz * push;
  }

  // 把 b 從 a 推開到最小距離（敵人 vs 玩家）
  pushAway(aPos, b, minDist, strength = 0.55) {
    const dx = b.pos.x - aPos.x;
    const dz = b.pos.z - aPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6 || d2 >= minDist * minDist) return;
    const d = Math.sqrt(d2);
    const push = ((minDist - d) * strength) / d;
    b.pos.x += dx * push;
    b.pos.z += dz * push;
  }
}
