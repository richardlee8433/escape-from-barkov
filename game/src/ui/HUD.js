import { bus } from "../core/EventBus.js";
import { setIconText } from "./icons.js";

// HUD 只聽事件,完全不碰遊戲物件。
export class HUD {
  constructor() {
    this.tipEl = document.getElementById("tip");
    this.logEl = document.getElementById("log");
    this.dirsEl = document.getElementById("dmg-dirs");
    this.extractEl = document.getElementById("extract-flash");
    this.camYaw = 0;

    // 被啄:畫面邊緣一道弧光指向出手的鴨子;掉了什麼寫進紀錄
    bus.on("player:pecked", ({ fromX, fromZ }) => this.showDamageDir(fromX, fromZ));
    bus.on("backpack:dropped", ({ treasure }) =>
      bus.emit("log", { msg: `Quack! A duck made you drop ${treasure.name} — press E to pick it up`, level: "warn" }));
    bus.on("victory", () => this.flash(this.extractEl));


    bus.on("tip:show", ({ msg }) => {
      this.tipEl.textContent = msg;
      this.tipEl.classList.remove("hidden");
    });
    bus.on("tip:hide", () => this.tipEl.classList.add("hidden"));

    bus.on("log", ({ msg, level }) => {
      const d = document.createElement("div");
      d.className = level || "info";
      setIconText(d, `[${new Date().toLocaleTimeString()}] ${msg}`);
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
    this.logEl.classList.remove("hidden");
  }
}
