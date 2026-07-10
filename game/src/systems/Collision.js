import { BAL } from "../config/balance.js";

// 2D 圓形碰撞:所有擋路物（石頭、樹、木箱）是靜態圓，
// 角色也是圓。世界邊界直接 clamp。
const HALF = BAL.world.size / 2;

export class Collision {
  constructor() {
    this.statics = []; // { x, z, r, blocksBullets }
    // 地面高度查詢(平地 0;橋面由 WorldBuilder 覆寫成拱形高度)
    this.heightAt = () => 0;
  }

  // blocksBullets=false 的物件(柵欄、溝壑)只擋移動,子彈飛得過去
  addStatic(x, z, r, { blocksBullets = true } = {}) {
    this.statics.push({ x, z, r, blocksBullets });
  }

  // 把 pos（Vector3，就地修改）推出所有靜態圓與世界邊界
  // 跑兩輪:重疊的石頭群(如石牆)單輪解算會互相推回去
  resolveCircle(pos, r) {
    for (let pass = 0; pass < 2; pass++) this._resolveOnce(pos, r);
    return pos;
  }

  _resolveOnce(pos, r) {
    pos.x = Math.max(-HALF + 2, Math.min(HALF - 2, pos.x));
    pos.z = Math.max(-HALF + 2, Math.min(HALF - 2, pos.z));
    for (const s of this.statics) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      const min = s.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        pos.x += min; // 正好在圓心的退化情況:往 +x 推出
      }
    }
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
