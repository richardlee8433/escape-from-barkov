import { BAL, ITEM_TYPES } from "../config/balance.js";
import { bus, log } from "../core/EventBus.js";

// 快捷欄 3 格。E 撿最近的、1-3 直接使用該格。
export class Inventory {
  constructor(player, spawner) {
    this.player = player;
    this.spawner = spawner;
    this.slots = Array(BAL.hotbarSize).fill(null);
    this.index = 0;

    bus.on("input:pickup", () => this.pickup());
    bus.on("input:slot", (i) => this.use(i));
  }

  pickup() {
    if (!this.player.alive) return;
    const item = this.spawner.nearestItem(this.player.pos, BAL.items.pickupRange);
    if (!item) {
      log("Nothing nearby to pick up", "info");
      return;
    }
    this.put(item.type);
    this.spawner.removeItem(item);
    bus.emit("item:picked", { type: item.type });
    log(`Picked up ${item.type}`, "ok");
  }

  put(type) {
    let idx = this.slots.findIndex((v) => !v);
    if (idx < 0) idx = this.index;
    this.slots[idx] = { type };
    this.changed();
  }

  use(idx) {
    if (!this.player.alive) return;
    this.index = idx;
    const cur = this.slots[idx];
    if (!cur) {
      this.changed();
      return;
    }
    if (cur.type === ITEM_TYPES.MEDKIT) {
      const before = this.player.hp;
      this.player.heal(BAL.items.medkitHeal);
      log(`Used Medkit: HP ${Math.round(before)} → ${Math.round(this.player.hp)}`, "ok");
      this.slots[idx] = null;
    } else if (cur.type === ITEM_TYPES.AMMO) {
      this.player.addAmmo(BAL.items.ammoRefill);
      log(`Used Ammo: +${BAL.items.ammoRefill} rounds`, "ok");
      this.slots[idx] = null;
    }
    this.changed();
  }

  changed() {
    bus.emit("inventory:changed", { slots: this.slots, index: this.index });
  }
}
