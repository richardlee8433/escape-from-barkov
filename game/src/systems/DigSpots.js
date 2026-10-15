import { BAL } from "../config/balance.js";
import { RARITIES, rollTier, pickTreasure } from "../config/treasures.js";
import { bus, log } from "../core/EventBus.js";
import { DigGame } from "./DigGame.js";

// 挖寶土堆:地圖上散佈幾個露出骨頭的土堆,每一堆底下埋著一件寶物(稀有度在長出來時就決定)。
// 柯基走近按 E 開挖 → 挖掘小遊戲(E / 空白鍵 / 滑鼠在綠區按下)→ 挖到寶物、記進圖鑑、
// 轉向鏡頭撒嬌。挖完的土堆過一陣子會在別處長出新的。
// 挖到一半移動或被鴨子啄到就中斷,土堆留著,寶物還在。
export class DigSpots {
  constructor(scene, assets, collision, canPlace, avoid, collection) {
    this.scene = scene;
    this.assets = assets;
    this.collision = collision;
    this.canPlace = canPlace;
    this.collection = collection;
    this.spots = [];
    this.respawns = [];  // 倒數中的新土堆(秒)
    this.active = null;  // 正在挖:{ spot, game, player, t }
    this.nearby = false;
    for (let k = 0; k < BAL.items.digSpots; k++) this._spawn(avoid, 14);

    const press = () => this.press();
    bus.on("input:pickup", press);
    bus.on("input:dig", press);
    bus.on("input:fire", press);
    bus.on("enemy:peck", () => this.cancel("peck"));
  }

  // 找一個空地長出土堆;找不到就算了(下次再試)
  _spawn(avoid, minDist) {
    const HALF = BAL.world.size / 2 - BAL.world.edgeMargin - 4;
    for (let tries = 0; tries < 300; tries++) {
      const x = (Math.random() * 2 - 1) * HALF;
      const z = (Math.random() * 2 - 1) * HALF;
      if (!this.canPlace(x, z) || !this.collision.isFree(x, z, 1.4)) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < minDist) continue;
      if (this.spots.some((s) => Math.hypot(x - s.x, z - s.z) < 18)) continue;
      const holder = this.assets.instantiate("dig_mound", 1.25, { dim: "scale" });
      holder.position.set(x, 0, z);
      holder.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(holder);
      const spot = { x, z, holder, tier: rollTier() };
      this.spots.push(spot);
      return spot;
    }
    return null;
  }

  nearest(pos, range) {
    let best = null, bestD = range;
    for (const s of this.spots) {
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  update(player, dt = 1 / 60) {
    if (this.active) {
      this.active.t += dt;
      this.active.game.update(dt);
    }
    // 補新的土堆(離柯基遠一點,才不會憑空在腳邊冒出來)
    for (const r of this.respawns) r.t -= dt;
    while (this.respawns.length && this.respawns[0].t <= 0) {
      this.respawns.shift();
      if (!this._spawn(player.pos, 12)) this.respawns.push({ t: 5 });
    }
    // 走近時提示「按 E 挖」
    const near = player.alive && !player.dig && !!this.nearest(player.pos, BAL.items.digRange);
    if (near !== this.nearby) {
      this.nearby = near;
      bus.emit(near ? "tip:show" : "tip:hide", { msg: "Press E to dig 🦴" });
    }
  }

  // 開挖(由 Inventory 的 E 呼叫)
  dig(spot, player) {
    if (this.active) return false;
    const yaw = Math.atan2(spot.x - player.pos.x, spot.z - player.pos.z);
    if (!player.startDig(yaw, () => this.cancel("moved"))) return false;
    const game = new DigGame(spot.tier);
    this.active = { spot, game, player, t: 0 };
    bus.emit("dig:game", { need: game.need });
    return true;
  }

  // 挖一下(E / 空白 / 滑鼠)
  press() {
    const a = this.active;
    if (!a || a.t < BAL.dig.grace) return;
    const result = a.game.press();
    if (!result) return;
    bus.emit("dig:hit", { result, hits: a.game.hits, need: a.game.need, misses: a.game.misses, maxMiss: a.game.maxMiss });
    if (a.game.done) this._finish();
  }

  // 中斷:土堆和寶物都留著
  cancel(reason) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.player.endDig(false);
    bus.emit("dig:cancel", { reason });
    if (reason === "peck") log("A duck pecked you mid-dig! 🦆", "warn");
  }

  _finish() {
    const { spot, game, player } = this.active;
    this.active = null;
    this.scene.remove(spot.holder);
    this.spots = this.spots.filter((s) => s !== spot);
    this.respawns.push({ t: BAL.items.digRespawn });

    // 失手太多次:寶物滑到更深處,只抓到一件普通的
    const tier = game.success ? spot.tier : 0;
    const treasure = pickTreasure(tier);
    const perfect = game.perfect;
    const { isNew, entry } = this.collection.add(treasure.id, perfect);
    player.endDig(game.success);
    bus.emit("dig:found", {
      x: spot.x, z: spot.z, treasure, tier, isNew, perfect, success: game.success,
      count: entry ? entry.count : 1, found: this.collection.found, total: this.collection.total,
    });
    const r = RARITIES[tier].name;
    if (!game.success) log(`It slipped deeper… grabbed a ${treasure.name} instead`, "info");
    else log(`Dug up ${treasure.name} (${r})${perfect ? " — perfect dig!" : ""}${isNew ? " NEW!" : ""}`, "ok");
  }
}
