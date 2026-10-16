import { BAL } from "../config/balance.js";
import { bus, log } from "../core/EventBus.js";
import { t } from "../i18n/i18n.js";

// 撿回被鴨子啄掉的東西:
//   - 按 E:身體中心或鼻尖離東西 pickupRange 以內就撿起來
//   - 直接走過去碰到(touchRange)也會自動撿起來,不用對準
// E 附近沒有掉落物的話,聞到寶物的地方就開挖。
const NOSE = 0.9; // 柯基中心到鼻尖

export class Inventory {
  constructor(player, backpack, digSpots) {
    this.player = player;
    this.backpack = backpack;
    this.digSpots = digSpots;
    this.enabled = true; // 在家裡時關掉(E 交給 Home)
    bus.on("input:pickup", () => this.pickup());
  }

  // 身體中心與鼻尖到 (x, z) 比較近的那個距離
  reach(x, z) {
    const p = this.player.pos;
    const yaw = this.player.root.rotation.y;
    const nx = p.x + Math.sin(yaw) * NOSE, nz = p.z + Math.cos(yaw) * NOSE;
    return Math.min(Math.hypot(x - p.x, z - p.z), Math.hypot(x - nx, z - nz));
  }

  nearestGround(range) {
    let best = null, bestD = range;
    for (const it of this.backpack.ground) {
      const d = this.reach(it.x, it.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  pickup() {
    if (!this.enabled || !this.player.alive || this.player.dig || this.player.sniff) return;
    const item = this.nearestGround(BAL.items.pickupRange);
    if (item) {
      this.backpack.pickup(item);
      return;
    }
    const spot = this.digSpots?.nearest(this.player.pos, BAL.items.digRange + 0.8);
    if (spot) {
      this.digSpots.dig(spot, this.player);
      return;
    }
    log(t("log.nothing"), "info");
  }

  // 走過去碰到就撿(東西剛掉出來時先等它落地)
  update(dt) {
    if (!this.enabled || this.player.dig) return;
    for (const it of [...this.backpack.ground]) {
      it.age = (it.age || 0) + dt;
      if (it.age < BAL.items.touchDelay) continue;
      if (this.reach(it.x, it.z) < BAL.items.touchRange) this.backpack.pickup(it);
    }
  }
}
