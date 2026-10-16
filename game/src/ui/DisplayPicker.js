import { RARITIES, byId } from "../config/treasures.js";
import { slotsOf } from "../config/home.js";
import { bus } from "../core/EventBus.js";

// 擺設面板:上面一排是這件家具的展示位,下面是背包。
// 先點一個位子(預設第一個空位),再點背包裡的寶物就擺上去;位子上原本有東西會收回背包。
// 位子上的「↩」把東西收回背包。打開時遊戲暫停,和背包、圖鑑面板互斥。
export class DisplayPicker {
  constructor(state, backpack, onChange = () => {}) {
    this.state = state;
    this.backpack = backpack;
    this.onChange = onChange;
    this.el = document.getElementById("picker");
    this.title = this.el.querySelector("h3");
    this.countEl = this.el.querySelector(".panel-count");
    this.slotsEl = this.el.querySelector(".pk-slots");
    this.grid = this.el.querySelector(".panel-grid");
    this.isOpen = false;
    this.station = null;
    this.sel = null;

    bus.on("input:close", () => this.close());
    bus.on("panel:open", ({ id }) => { if (id !== "picker") this.close(); });
    this.el.querySelector(".panel-close").addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
  }

  open(station) {
    if (this.isOpen) return;
    bus.emit("panel:open", { id: "picker" });
    this.isOpen = true;
    this.station = station;
    const slots = slotsOf(station.id);
    this.sel = (slots.find((s) => !this.state.displays[s.id]) || slots[0]).id;
    this.render();
    this.el.classList.remove("hidden");
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add("hidden");
    bus.emit("panel:close", { id: "picker" });
  }

  render() {
    const st = this.station;
    const slots = slotsOf(st.id);
    this.title.textContent = `✨ ${st.decorate}`;
    const filled = slots.filter((s) => this.state.displays[s.id]).length;
    this.countEl.textContent = `${filled} / ${slots.length} spots`;

    this.slotsEl.innerHTML = "";
    for (const s of slots) {
      const tid = this.state.displays[s.id];
      const t = tid && byId[tid];
      const c = document.createElement("div");
      c.className = `cell slot${t ? "" : " empty-slot"}${this.sel === s.id ? " sel" : ""}`;
      c.style.setProperty("--rc", t ? RARITIES[t.tier].color : "#8a6f4a");
      c.title = t ? t.name : "Empty spot";
      c.append(t ? t.icon : "＋");
      c.addEventListener("click", () => { this.sel = s.id; this.render(); });
      if (t) {
        const back = document.createElement("button");
        back.className = "take";
        back.title = "Put it back in the backpack";
        back.textContent = "↩";
        back.addEventListener("click", (e) => {
          e.stopPropagation();
          this.state.take(s.id);
          this.sel = s.id;
          this._changed();
        });
        c.appendChild(back);
      }
      this.slotsEl.appendChild(c);
    }

    this.grid.innerHTML = "";
    const list = this.backpack.list();
    if (!list.length) {
      const e = document.createElement("div");
      e.className = "pk-empty";
      e.textContent = "Your backpack is empty — go dig up some treasure!";
      this.grid.appendChild(e);
    }
    for (const { treasure: t, count } of list) {
      const c = document.createElement("div");
      c.className = "cell";
      c.style.setProperty("--rc", RARITIES[t.tier].color);
      c.title = `${t.name} (${RARITIES[t.tier].name})`;
      c.append(t.icon);
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = `×${count}`;
      c.appendChild(n);
      c.addEventListener("click", () => {
        if (!this.state.place(this.sel, t.id)) return;
        // 擺好之後自動跳到下一個空位
        const next = slots.find((s) => !this.state.displays[s.id]);
        if (next) this.sel = next.id;
        this._changed();
      });
      this.grid.appendChild(c);
    }
  }

  _changed() {
    this.onChange();
    this.render();
  }
}
