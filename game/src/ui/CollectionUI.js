import { RARITIES, TREASURES } from "../config/treasures.js";
import { bus } from "../core/EventBus.js";

// 寶物圖鑑面板(Tab 或點 HUD 的 📖 開關)。
// 沒挖到的顯示「?」,但框的顏色透露稀有度:讓玩家知道還有什麼等著被挖出來。
export class CollectionUI {
  constructor(collection) {
    this.collection = collection;
    this.el = document.getElementById("book");
    this.grid = this.el.querySelector(".book-grid");
    this.detailEl = this.el.querySelector(".book-detail");
    this.countEl = this.el.querySelector(".book-count");
    this.hudCount = document.getElementById("dex-count");
    this.isOpen = false;
    this.selected = null;

    this.cells = TREASURES.map((t) => {
      const c = document.createElement("div");
      c.style.setProperty("--rc", RARITIES[t.tier].color);
      c.addEventListener("click", () => this.select(t));
      this.grid.appendChild(c);
      return c;
    });

    bus.on("input:collection", () => this.toggle());
    bus.on("input:close", () => this.close());
    bus.on("dig:found", () => {
      this.refreshCount();
      if (this.isOpen) this.render();
    });
    document.getElementById("dex-btn").addEventListener("click", () => this.toggle());
    this.el.querySelector(".book-close").addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
    this.refreshCount();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.render();
    this.el.classList.remove("hidden");
    bus.emit("book:open");
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add("hidden");
    bus.emit("book:close");
  }

  refreshCount() {
    this.hudCount.textContent = `${this.collection.found}/${this.collection.total}`;
  }

  render() {
    const col = this.collection;
    this.countEl.textContent = `${col.found} / ${col.total} found`;
    TREASURES.forEach((t, i) => {
      const e = col.get(t.id);
      const c = this.cells[i];
      c.className = `cell${e ? "" : " unfound"}${this.selected === t ? " sel" : ""}`;
      c.title = e ? t.name : `??? (${RARITIES[t.tier].name})`;
      c.innerHTML = "";
      c.append(e ? t.icon : "?");
      if (e) {
        const n = document.createElement("span");
        n.className = "n";
        n.textContent = `×${e.count}`;
        c.appendChild(n);
        if (e.perfect) {
          const s = document.createElement("span");
          s.className = "star";
          s.textContent = "★";
          c.appendChild(s);
        }
      }
    });
    this._detail(this.selected || TREASURES.find((t) => col.get(t.id)) || TREASURES[0]);
  }

  select(t) {
    this.selected = t;
    this.render();
  }

  _detail(t) {
    const e = this.collection.get(t.id);
    const r = RARITIES[t.tier];
    const d = this.detailEl;
    d.style.setProperty("--rc", r.color);
    d.innerHTML = "";
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = e ? t.icon : "?";
    const info = document.createElement("div");
    const line = (cls, text) => {
      const x = document.createElement("div");
      x.className = cls;
      x.textContent = text;
      info.appendChild(x);
    };
    line("nm", e ? t.name : "???");
    line("rr", r.name);
    line("ds", e
      ? `${t.desc}  —  found ×${e.count}${e.perfect ? " · ★ perfect dig" : ""}`
      : "Still buried somewhere. Rarer treasures sit deeper and are harder to dig.");
    d.append(big, info);
  }
}
