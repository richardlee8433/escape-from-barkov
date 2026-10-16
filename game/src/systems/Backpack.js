import { TREASURES, byId } from "../config/treasures.js";
import { bus, log } from "../core/EventBus.js";
import { t, trName } from "../i18n/i18n.js";

// 背包:挖到的寶物都放這裡(同一種疊在一起),存在瀏覽器裡,下次開遊戲還在。
// 圖鑑記的是「挖到過哪些」,背包記的是「現在身上有什麼」。
//
// 鴨子搗亂:被啄到時會掉出一件東西(多半是普通的),落在附近地上,按 E 撿回來。
const KEY = "barkov.backpack.v1";
export const BAG_SLOTS = 24;

function browserStorage() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

export class Backpack {
  constructor(storage = browserStorage(), rng = Math.random) {
    this.storage = storage;
    this.rng = rng;
    this.items = this._load(); // id → 數量
    this.ground = [];          // 掉在地上的:{ id, x, z }
  }

  count(id) {
    return this.items[id] || 0;
  }

  get total() {
    return Object.values(this.items).reduce((s, n) => s + n, 0);
  }

  get kinds() {
    return Object.keys(this.items).length;
  }

  // 依稀有度(高到低)排好,背包畫面就照這個順序
  list() {
    return TREASURES.filter((t) => this.items[t.id])
      .sort((a, b) => b.tier - a.tier)
      .map((t) => ({ treasure: t, count: this.items[t.id] }));
  }

  add(id, n = 1) {
    if (!byId[id] || n <= 0) return false;
    this.items[id] = (this.items[id] || 0) + n;
    this._changed();
    return true;
  }

  remove(id, n = 1) {
    if (!this.items[id] || n <= 0) return false;
    this.items[id] -= n;
    if (this.items[id] <= 0) delete this.items[id];
    this._changed();
    return true;
  }

  // 被啄到:隨機掉一件(越普通越容易掉),從 (fromX, fromZ) 彈到 (x, z)。背包空的就什麼都不掉
  dropRandom(x, z, fromX = x, fromZ = z) {
    const pool = [];
    for (const [id, n] of Object.entries(this.items)) {
      const w = (5 - byId[id].tier) ** 2 * n;
      pool.push([id, w]);
    }
    const total = pool.reduce((s, [, w]) => s + w, 0);
    if (!total) return null;
    let r = this.rng() * total;
    let pick = pool[pool.length - 1][0];
    for (const [id, w] of pool) {
      r -= w;
      if (r < 0) { pick = id; break; }
    }
    this.remove(pick);
    const item = { id: pick, x, z };
    this.ground.push(item);
    bus.emit("backpack:dropped", { item, treasure: byId[pick], fromX, fromZ });
    return item;
  }

  nearestGround(pos, range) {
    let best = null, bestD = range;
    for (const it of this.ground) {
      const d = Math.hypot(pos.x - it.x, pos.z - it.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  // 撿回地上的東西
  pickup(item) {
    const i = this.ground.indexOf(item);
    if (i < 0) return false;
    this.ground.splice(i, 1);
    this.add(item.id);
    bus.emit("backpack:picked", { item, treasure: byId[item.id] });
    log(t("log.picked", { name: trName(byId[item.id]) }), "ok");
    return true;
  }

  _changed() {
    this._save();
    bus.emit("backpack:changed", { total: this.total, kinds: this.kinds });
  }

  _load() {
    try {
      const raw = this.storage?.getItem(KEY);
      const data = raw ? JSON.parse(raw) : {};
      const out = {};
      for (const [id, n] of Object.entries(data || {})) {
        if (byId[id] && n >= 1) out[id] = Math.floor(n); // 不認得的、壞掉的都略過
      }
      return out;
    } catch (e) {
      return {};
    }
  }

  _save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.items));
    } catch (e) { /* 存不了就算了,這一局照玩 */ }
  }
}
