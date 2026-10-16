import { RARITIES } from "../config/treasures.js";
import { bus } from "../core/EventBus.js";
import { BAG_SLOTS } from "../systems/Backpack.js";

// 背包面板(B 或點 HUD 的 🎒 開關):挖到的寶物一格一種,疊數量,依稀有度排序。
// 打開時遊戲暫停;和圖鑑面板互斥(開一個就關另一個)。
export class BackpackUI {
  constructor(backpack) {
    this.backpack = backpack;
    this.el = document.getElementById("bag");
    this.grid = this.el.querySelector(".panel-grid");
    this.detailEl = this.el.querySelector(".panel-detail");
    this.countEl = this.el.querySelector(".panel-count");
    this.hudCount = document.getElementById("bag-count");
    this.isOpen = false;
    this.selected = null;
    this.cells = Array.from({ length: BAG_SLOTS }, () => {
      const c = document.createElement("div");
      this.grid.appendChild(c);
      return c;
    });

    bus.on("input:bag", () => this.toggle());
    bus.on("input:close", () => this.close());
    bus.on("panel:open", ({ id }) => { if (id !== "bag") this.close(); });
    bus.on("backpack:changed", () => {
      this.refreshCount();
      if (this.isOpen) this.render();
    });
    document.getElementById("bag-btn").addEventListener("click", () => this.toggle());
    this.el.querySelector(".panel-close").addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
    this.refreshCount();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    bus.emit("panel:open", { id: "bag" });
    this.isOpen = true;
    this.render();
    this.el.classList.remove("hidden");
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add("hidden");
    bus.emit("panel:close", { id: "bag" });
  }

  refreshCount() {
    this.hudCount.textContent = this.backpack.total;
  }

  render() {
    const list = this.backpack.list();
    const bp = this.backpack;
    this.countEl.textContent = `${bp.total} item${bp.total === 1 ? "" : "s"} · ${bp.kinds} kind${bp.kinds === 1 ? "" : "s"}`;
    if (this.selected && !bp.count(this.selected.id)) this.selected = null;
    this.cells.forEach((c, i) => {
      const entry = list[i];
      c.innerHTML = "";
      c.onclick = null;
      if (!entry) {
        c.className = "cell empty";
        c.style.removeProperty("--rc");
        c.title = "";
        return;
      }
      const t = entry.treasure;
      c.className = `cell${this.selected === t ? " sel" : ""}`;
      c.style.setProperty("--rc", RARITIES[t.tier].color);
      c.title = t.name;
      c.append(t.icon);
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = `×${entry.count}`;
      c.appendChild(n);
      c.onclick = () => { this.selected = t; this.render(); };
    });
    this._detail(this.selected ? { treasure: this.selected, count: bp.count(this.selected.id) } : list[0]);
  }

  _detail(entry) {
    const d = this.detailEl;
    d.innerHTML = "";
    if (!entry) {
      const empty = document.createElement("div");
      empty.className = "ds";
      empty.textContent = "Your backpack is empty. Press Q to sniff out buried treasure, then E to dig it up.";
      d.appendChild(empty);
      d.style.removeProperty("--rc");
      return;
    }
    const t = entry.treasure;
    d.style.setProperty("--rc", RARITIES[t.tier].color);
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = t.icon;
    const info = document.createElement("div");
    const line = (cls, text) => {
      const x = document.createElement("div");
      x.className = cls;
      x.textContent = text;
      info.appendChild(x);
    };
    line("nm", `${t.name}  ×${entry.count}`);
    line("rr", RARITIES[t.tier].name);
    line("ds", t.desc);
    d.append(big, info);
  }
}
