import { STATIONS, SLOTS, stationById } from "../config/home.js";
import { byId } from "../config/treasures.js";
import { bus, log } from "../core/EventBus.js";

// 家的進度:修好了哪些地方、哪個展示位擺了什麼。存在瀏覽器裡,下次回家還在。
// 修理會用掉背包裡的材料;擺出來的寶物離開背包,收回來再放回背包。
const KEY = "barkov.home.v1";

function browserStorage() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

export class HomeState {
  constructor(backpack, storage = browserStorage()) {
    this.backpack = backpack;
    this.storage = storage;
    const { repaired, displays } = this._load();
    this.repaired = repaired; // Set<stationId>
    this.displays = displays; // slotId → treasureId
  }

  isRepaired(id) {
    return this.repaired.has(id);
  }

  // 修好的比例(0..1):房間跟著變亮、變暖
  get coziness() {
    return this.repaired.size / STATIONS.length;
  }

  // 每樣材料需要幾個、背包裡有幾個
  needs(id) {
    const st = stationById[id];
    return Object.entries(st?.needs || {}).map(([tid, need]) => ({
      treasure: byId[tid], need, have: this.backpack.count(tid),
    }));
  }

  canRepair(id) {
    if (!stationById[id] || this.isRepaired(id)) return false;
    return this.needs(id).every((n) => n.have >= n.need);
  }

  repair(id) {
    if (!this.canRepair(id)) return false;
    for (const n of this.needs(id)) this.backpack.remove(n.treasure.id, n.need);
    this.repaired.add(id);
    this._save();
    bus.emit("home:repaired", { id, station: stationById[id], coziness: this.coziness });
    log(`${stationById[id].name} repaired! 🔨`, "ok");
    return true;
  }

  // 展示位要等它所在的家具修好才能用
  slotOpen(slotId) {
    const slot = SLOTS.find((s) => s.id === slotId);
    return !!slot && this.isRepaired(slot.station);
  }

  // 從背包拿一件擺上去;那個位子原本有東西就收回背包
  place(slotId, treasureId) {
    if (!this.slotOpen(slotId) || !byId[treasureId] || this.backpack.count(treasureId) < 1) return false;
    if (this.displays[slotId] === treasureId) return false;
    const old = this.displays[slotId];
    this.backpack.remove(treasureId);
    if (old) this.backpack.add(old);
    this.displays[slotId] = treasureId;
    this._save();
    bus.emit("home:display", { slotId, treasureId, old });
    return true;
  }

  // 收回背包
  take(slotId) {
    const old = this.displays[slotId];
    if (!old) return false;
    delete this.displays[slotId];
    this.backpack.add(old);
    this._save();
    bus.emit("home:display", { slotId, treasureId: null, old });
    return true;
  }

  _load() {
    const empty = { repaired: new Set(), displays: {} };
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return empty;
      const data = JSON.parse(raw) || {};
      const repaired = new Set((data.repaired || []).filter((id) => stationById[id]));
      const displays = {};
      for (const [slotId, tid] of Object.entries(data.displays || {})) {
        const slot = SLOTS.find((s) => s.id === slotId);
        // 不認得的、擺在還沒修好的家具上的都略過
        if (slot && byId[tid] && repaired.has(slot.station)) displays[slotId] = tid;
      }
      return { repaired, displays };
    } catch (e) {
      return empty;
    }
  }

  _save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ repaired: [...this.repaired], displays: this.displays }));
    } catch (e) { /* 存不了就算了 */ }
  }
}
