import { BAL } from "../config/balance.js";
import { RARITIES, rollTier, pickTreasure } from "../config/treasures.js";
import { bus, log } from "../core/EventBus.js";
import { DigGame } from "./DigGame.js";

// 埋在地下的寶物。地面上看不出來,柯基要用鼻子找:
//   Q 嗅聞 → 一秒後知道最近的寶物在哪個方向、有多遠(冷 / 微弱 / 溫 / 熱 / 就在這裡)
//   聞到「就在這裡」→ 按 E 在鼻子前面開挖 → 挖掘小遊戲,土一層層翻開(DigFx 畫)→ 挖到寶物、記進圖鑑
// 寶物的稀有度在埋下去時就決定好了。挖完的寶物過一陣子會在別處再埋一個。
// 挖到一半移動或被鴨子啄到就中斷,洞留著,寶物還在。

// 氣味強度:由近到遠
export const SCENTS = [
  { id: "here", max: BAL.items.digRange, label: "Right here! Press E to dig 🐾", color: "#ffc23d" },
  { id: "hot", max: 6, label: "Hot!! It's very close", color: "#ff7a3d" },
  { id: "warm", max: 14, label: "Warm — getting closer", color: "#ffd36b" },
  { id: "faint", max: 28, label: "A faint scent…", color: "#bfe3a0" },
  { id: "cold", max: Infinity, label: "Cold — nothing around here", color: "#9fb7c9" },
];
export const DIG_AHEAD = 1.55;
export const scentAt = (dist) => SCENTS.find((s) => dist <= s.max);

export class DigSpots {
  constructor(canPlace, collision, avoid, collection) {
    this.canPlace = canPlace;
    this.collision = collision;
    this.collection = collection;
    this.spots = [];     // { x, z, tier, found, holed }
    this.respawns = [];  // 倒數中的新寶物(秒)
    this.active = null;  // 正在挖:{ spot, game, player, t }
    this.nearby = false;
    for (let k = 0; k < BAL.items.digSpots; k++) this._spawn(avoid, 14);

    const press = () => this.press();
    bus.on("input:pickup", press);
    bus.on("input:dig", press);
    bus.on("input:click", press);
    bus.on("enemy:peck", () => this.cancel("peck"));
  }

  // 找一塊空草地埋下寶物;找不到就算了(下次再試)
  _spawn(avoid, minDist) {
    const HALF = BAL.world.size / 2 - BAL.world.edgeMargin - 4;
    for (let tries = 0; tries < 300; tries++) {
      const x = (Math.random() * 2 - 1) * HALF;
      const z = (Math.random() * 2 - 1) * HALF;
      if (!this.canPlace(x, z) || !this.collision.isFree(x, z, 1.4)) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < minDist) continue;
      if (this.spots.some((s) => Math.hypot(x - s.x, z - s.z) < 18)) continue;
      const spot = { x, z, tier: rollTier(), found: false, holed: false };
      this.spots.push(spot);
      return spot;
    }
    return null;
  }

  // 最近的寶物(foundOnly:只算已經聞到的)
  nearest(pos, range = Infinity, foundOnly = true) {
    let best = null, bestD = range;
    for (const s of this.spots) {
      if (foundOnly && !s.found) continue;
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // Q:開始嗅聞;聞完(player 的嗅聞動作結束)才公布結果
  sniff(player) {
    if (this.active || !player.alive || player.busy) return false;
    return player.startSniff(() => this._sniffResult(player));
  }

  _sniffResult(player) {
    const spot = this.nearest(player.pos, Infinity, false);
    if (!spot) return;
    const dx = spot.x - player.pos.x, dz = spot.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    const scent = scentAt(dist);
    if (scent.id === "here") spot.found = true;
    bus.emit("sniff:result", {
      x: player.pos.x, z: player.pos.z, dirX: dx / (dist || 1), dirZ: dz / (dist || 1), dist, scent,
      spotX: spot.x, spotZ: spot.z,
    });
  }

  update(player, dt = 1 / 60) {
    if (this.active) {
      this.active.t += dt;
      this.active.game.update(dt);
    }
    for (const r of this.respawns) r.t -= dt;
    while (this.respawns.length && this.respawns[0].t <= 0) {
      this.respawns.shift();
      if (!this._spawn(player.pos, 12)) this.respawns.push({ t: 5 });
    }
    // 聞到了、又站在旁邊:提示按 E 挖
    const near = player.alive && !player.dig && !!this.nearest(player.pos, BAL.items.digRange + 0.8);
    if (near !== this.nearby) {
      this.nearby = near;
      bus.emit(near ? "tip:show" : "tip:hide", { msg: "Press E to dig here 🐾" });
    }
  }

  // 開挖(由 Inventory 的 E 呼叫)。第一次挖時,洞開在柯基鼻子前面
  dig(spot, player) {
    if (this.active) return false;
    if (!spot.holed) {
      const yaw = player.root.rotation.y;
      // 柯基中心到鼻尖約 1.1,洞開在前腳正前方,身體不會把洞擋住
      spot.x = player.pos.x + Math.sin(yaw) * DIG_AHEAD;
      spot.z = player.pos.z + Math.cos(yaw) * DIG_AHEAD;
    }
    const yaw = Math.atan2(spot.x - player.pos.x, spot.z - player.pos.z);
    if (!player.startDig(yaw, () => this.cancel("moved"))) return false;
    const game = new DigGame(spot.tier);
    this.active = { spot, game, player, t: 0 };
    bus.emit("dig:game", { need: game.need, x: spot.x, z: spot.z, spot, fromX: player.pos.x, fromZ: player.pos.z });
    spot.holed = true;
    return true;
  }

  // 挖一下(E / 空白 / 滑鼠)
  press() {
    const a = this.active;
    if (!a || a.t < BAL.dig.grace) return;
    const result = a.game.press();
    if (!result) return;
    bus.emit("dig:hit", {
      result, hits: a.game.hits, need: a.game.need, misses: a.game.misses, maxMiss: a.game.maxMiss,
      x: a.spot.x, z: a.spot.z, spot: a.spot, fromX: a.player.pos.x, fromZ: a.player.pos.z,
    });
    if (a.game.done) this._finish();
  }

  // 中斷:洞留著,寶物還在底下
  cancel(reason) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.player.endDig(false);
    bus.emit("dig:cancel", { reason, spot: a.spot });
    if (reason === "peck") log("A duck pecked you mid-dig! 🦆", "warn");
  }

  _finish() {
    const { spot, game, player } = this.active;
    this.active = null;
    this.spots = this.spots.filter((s) => s !== spot);
    this.respawns.push({ t: BAL.items.digRespawn });

    // 失手太多次:寶物滑到更深處,只抓到一件普通的
    const tier = game.success ? spot.tier : 0;
    const treasure = pickTreasure(tier);
    const perfect = game.perfect;
    // 普通的材料(木板、釘子、稻草…)修房子要用很多,一次挖出兩個
    const qty = game.success && tier === 0 ? 2 : 1;
    const { isNew, entry } = this.collection.add(treasure.id, perfect);
    player.endDig(game.success);
    bus.emit("dig:found", {
      x: spot.x, z: spot.z, spot, treasure, tier, qty, isNew, perfect, success: game.success,
      count: entry ? entry.count : 1, found: this.collection.found, total: this.collection.total,
    });
    const r = RARITIES[tier].name;
    if (!game.success) log(`It slipped deeper… grabbed a ${treasure.name} instead`, "info");
    else log(`Dug up ${treasure.name}${qty > 1 ? ` ×${qty}` : ""} (${r})${perfect ? " — perfect dig!" : ""}${isNew ? " NEW!" : ""}`, "ok");
  }
}
