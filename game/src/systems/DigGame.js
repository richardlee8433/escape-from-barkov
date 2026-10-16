import { BAL } from "../config/balance.js";

// 挖掘小遊戲的規則(純邏輯,不碰畫面,方便測試)。
//
// 一根指針在 0~1 的長條上來回掃,長條上有一段綠區(正中央一小段是「完美」)。
// 在綠區裡按下 = 挖深一層,綠區換到別的位置;按在綠區外 = 失手。
// 挖滿 need 層就挖到;失手 maxMiss 次,寶物滑到更深處,這一堆就結束。
// 稀有度越高:層數越多、指針越快、綠區越窄,珍貴以上的綠區還會左右飄。
export class DigGame {
  constructor(tier, rng = Math.random) {
    const D = BAL.dig;
    this.tier = tier;
    this.need = D.hits[tier];
    this.speed = D.speed[tier];
    this.half = D.zone[tier];
    this.drift = D.drift[tier];
    this.perfectHalf = D.perfect;
    this.maxMiss = D.maxMiss;
    this.rng = rng;

    this.t = 0;
    this.pos = 0;   // 指針位置
    this.dir = 1;
    this.hits = 0;
    this.perfects = 0;
    this.misses = 0;
    this.done = false;
    this.success = false;
    this.base = this._newCenter();
  }

  // 綠區中心(含飄動),永遠整段留在長條內
  get center() {
    const c = this.base + Math.sin(this.t * 1.7) * this.drift;
    return Math.min(1 - this.half, Math.max(this.half, c));
  }

  // 每一層都挖完美、一次都沒失手
  get perfect() {
    return this.success && this.misses === 0 && this.perfects === this.hits;
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    this.pos += this.dir * this.speed * dt;
    // 碰到兩端就反彈(大 dt 時也不會跑出長條)
    while (this.pos > 1 || this.pos < 0) {
      if (this.pos > 1) { this.pos = 2 - this.pos; this.dir = -1; }
      if (this.pos < 0) { this.pos = -this.pos; this.dir = 1; }
    }
  }

  // 按下:回傳 "perfect" | "good" | "miss";已結束回傳 null
  press() {
    if (this.done) return null;
    const d = Math.abs(this.pos - this.center);
    if (d > this.half) {
      this.misses++;
      if (this.misses >= this.maxMiss) this.done = true;
      return "miss";
    }
    const result = d <= this.perfectHalf ? "perfect" : "good";
    this.hits++;
    if (result === "perfect") this.perfects++;
    if (this.hits >= this.need) {
      this.done = true;
      this.success = true;
    } else {
      this.base = this._newCenter();
    }
    return result;
  }

  // 新的綠區:盡量離指針遠一點,不讓玩家原地連按
  _newCenter() {
    const lo = this.half + 0.04, hi = 1 - this.half - 0.04;
    let c = lo + this.rng() * (hi - lo);
    for (let k = 0; k < 4 && Math.abs(c - this.pos) < 0.25; k++) c = lo + this.rng() * (hi - lo);
    if (Math.abs(c - this.pos) < 0.25) c = this.pos < 0.5 ? hi : lo;
    return c;
  }
}
