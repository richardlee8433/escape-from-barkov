import { BAL } from "../config/balance.js";
import { bus, log } from "../core/EventBus.js";

// E 鍵:附近地上有被鴨子啄掉的東西就撿回背包;沒有的話,聞到寶物的地方就開挖。
export class Inventory {
  constructor(player, backpack, digSpots) {
    this.player = player;
    this.backpack = backpack;
    this.digSpots = digSpots;
    bus.on("input:pickup", () => this.pickup());
  }

  pickup() {
    if (!this.player.alive || this.player.dig || this.player.sniff) return;
    const item = this.backpack.nearestGround(this.player.pos, BAL.items.pickupRange);
    if (item) {
      this.backpack.pickup(item);
      return;
    }
    const spot = this.digSpots?.nearest(this.player.pos, BAL.items.digRange + 0.8);
    if (spot) {
      this.digSpots.dig(spot, this.player);
      return;
    }
    log("Nothing here… press Q to sniff for buried treasure :nose:", "info");
  }
}
