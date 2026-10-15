import { BAL, ITEM_TYPES } from "../config/balance.js";
import { bus, log } from "../core/EventBus.js";

// 挖寶土堆:地圖上散佈幾個露出骨頭的土堆。柯基走近按 E 會挖地,
// 挖完土堆消失、掉出一個道具,柯基轉向鏡頭得意地撒嬌。
export class DigSpots {
  constructor(scene, assets, collision, canPlace, avoid) {
    this.scene = scene;
    this.spots = [];
    const HALF = BAL.world.size / 2 - BAL.world.edgeMargin - 4;
    for (let tries = 0; tries < 2000 && this.spots.length < BAL.items.digSpots; tries++) {
      const x = (Math.random() * 2 - 1) * HALF;
      const z = (Math.random() * 2 - 1) * HALF;
      if (!canPlace(x, z) || !collision.isFree(x, z, 1.4)) continue;
      if (Math.hypot(x - avoid.x, z - avoid.z) < 14) continue;
      if (this.spots.some((s) => Math.hypot(x - s.x, z - s.z) < 18)) continue;
      const holder = assets.instantiate("dig_mound", 1.25, { dim: "scale" });
      holder.position.set(x, 0, z);
      holder.rotation.y = Math.random() * Math.PI * 2;
      scene.add(holder);
      this.spots.push({ x, z, holder });
    }
    this.nearby = false;
  }

  nearest(pos, range) {
    let best = null, bestD = range;
    for (const s of this.spots) {
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // 走近時提示「按 E 挖」
  update(player) {
    const near = player.alive && !player.dig && !!this.nearest(player.pos, BAL.items.digRange);
    if (near !== this.nearby) {
      this.nearby = near;
      bus.emit(near ? "tip:show" : "tip:hide", { msg: "Press E to dig 🦴" });
    }
  }

  // 開始挖;挖完把土堆移除並回傳挖到的道具種類給 onFound
  dig(spot, player, onFound) {
    const yaw = Math.atan2(spot.x - player.pos.x, spot.z - player.pos.z);
    return player.startDig(yaw, () => {
      this.scene.remove(spot.holder);
      this.spots = this.spots.filter((s) => s !== spot);
      const type = Math.random() < 0.5 ? ITEM_TYPES.AMMO : ITEM_TYPES.MEDKIT;
      bus.emit("dig:found", { x: spot.x, z: spot.z, type });
      log(`Dug up ${type === ITEM_TYPES.AMMO ? "an ammo clip" : "a medkit"}! 🐕✨`, "ok");
      onFound(type, spot);
    });
  }
}
