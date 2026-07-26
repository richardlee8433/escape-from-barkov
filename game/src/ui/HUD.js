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
    this.dirsEl = document.getElementById("dmg-dirs");
    this.hurtEl = document.getElementById("hurt-flash");
    this.extractEl = document.getElementById("extract-flash");
    this.camYaw = 0;

    bus.on("player:hurt", ({ fromX, fromZ }) => {
      this.flash(this.hurtEl);
      this.showDamageDir(fromX, fromZ);
    });
    bus.on("victory", () => this.flash(this.extractEl));

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

    bus.on("enemy:died", () => bus.emit("log", { msg: "Enemy down, Loot +1", level: "ok" }));

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

  // 重新觸發 CSS 動畫：先移除 class 並強制回流，否則連續受擊不會重播
  flash(el) {
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
  }

  // 把世界座標的來向轉成螢幕角度。相機是固定俯視角，
  // 螢幕「上」對應世界的 (-sin yaw, -cos yaw)，右邊是它逆時針轉 90°。
  showDamageDir(fromX, fromZ) {
    if (!fromX && !fromZ) return;
    const s = Math.sin(this.camYaw), c = Math.cos(this.camYaw);
    const right = fromX * c - fromZ * s;
    const up = -fromX * s - fromZ * c;
    const deg = (Math.atan2(right, up) * 180) / Math.PI;

    if (this.dirsEl.childElementCount >= 4) this.dirsEl.firstElementChild.remove();
    const arc = document.createElement("div");
    arc.className = "arc";
    arc.style.transform = `rotate(${deg}deg)`;
    arc.addEventListener("animationend", () => arc.remove(), { once: true });
    this.dirsEl.appendChild(arc);
  }

  show() {
    document.getElementById("hud").classList.remove("hidden");
    document.getElementById("hotbar").classList.remove("hidden");
    this.logEl.classList.remove("hidden");
  }
}
