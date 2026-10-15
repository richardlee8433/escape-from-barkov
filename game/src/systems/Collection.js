import { TREASURES, byId } from "../config/treasures.js";

// 寶物圖鑑:挖到過哪些、各幾個、有沒有完美挖出。存在瀏覽器裡,下次開遊戲還在。
// 存檔讀不到、壞掉或被封鎖時就從空的圖鑑開始,遊戲照常進行。
const KEY = "barkov.collection.v1";

function browserStorage() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

export class Collection {
  constructor(storage = browserStorage()) {
    this.storage = storage;
    this.entries = this._load();
  }

  get found() {
    return Object.keys(this.entries).length;
  }

  get total() {
    return TREASURES.length;
  }

  get(id) {
    return this.entries[id] || null;
  }

  // 記一筆;回傳是不是第一次挖到
  add(id, perfect = false) {
    if (!byId[id]) return { isNew: false, entry: null };
    const isNew = !this.entries[id];
    const e = this.entries[id] || (this.entries[id] = { count: 0, perfect: false, first: Date.now() });
    e.count++;
    e.perfect = e.perfect || !!perfect;
    this._save();
    return { isNew, entry: e };
  }

  _load() {
    try {
      const raw = this.storage?.getItem(KEY);
      const data = raw ? JSON.parse(raw) : {};
      const out = {};
      for (const [id, e] of Object.entries(data || {})) {
        // 只收認得的寶物與合理的數字(舊版存檔、手改過的存檔都不會讓遊戲壞掉)
        if (!byId[id] || !e || !(e.count >= 1)) continue;
        out[id] = { count: Math.floor(e.count), perfect: !!e.perfect, first: Number(e.first) || 0 };
      }
      return out;
    } catch (e) {
      return {};
    }
  }

  _save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.entries));
    } catch (e) { /* 存不了就算了,這一局照玩 */ }
  }
}
