import { ITEM_TYPES } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

// HUD 只聽事件,完全不碰遊戲物件。
const ICONS = { [ITEM_TYPES.MEDKIT]: "🧰", [ITEM_TYPES.AMMO]: "🔫" };

export class HUD {
  constructor() {
    this.hpEl = document.getElementById("hp");
    this.ammoEl = document.getElementById("ammo");
    this.lootEl = document.getElementById("loot");
    this.tipEl = document.getElementById("tip");
    this.logEl = document.getElementById("log");
    this.slots = Array.from(document.querySelectorAll("#hotbar .slot"));

    bus.on("player:stats", ({ hp, ammo, loot }) => {
      this.hpEl.textContent = Math.round(hp);
      this.ammoEl.textContent = ammo;
      this.lootEl.textContent = loot;
    });

    bus.on("inventory:changed", ({ slots, index }) => {
      this.slots.forEach((el, i) => {
        const it = slots[i];
        el.style.outline = i === index ? "2px solid #ffc963" : "none";
        el.textContent = it ? ICONS[it.type] : String(i + 1);
      });
    });

    bus.on("tip:show", ({ msg }) => {
      this.tipEl.textContent = msg;
      this.tipEl.classList.remove("hidden");
    });
    bus.on("tip:hide", () => this.tipEl.classList.add("hidden"));

    bus.on("log", ({ msg, level }) => {
      const d = document.createElement("div");
      d.className = level || "info";
      d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      this.logEl.appendChild(d);
      this.logEl.scrollTop = this.logEl.scrollHeight;
    });
  }

  show() {
    document.getElementById("hud").classList.remove("hidden");
    document.getElementById("hotbar").classList.remove("hidden");
    this.logEl.classList.remove("hidden");
  }
}
