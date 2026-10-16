import { BAL } from "../config/balance.js";
import { RARITIES } from "../config/treasures.js";
import { bus } from "../core/EventBus.js";
import { setIconText } from "./icons.js";

// 挖掘小遊戲的長條 + 挖到寶的卡片。
// 長條的指針與綠區每幀從 DigSpots.active 讀;其餘(層數、判定、卡片)只聽事件。
export class DigUI {
  constructor(digSpots) {
    this.digSpots = digSpots;
    const bar = (this.bar = document.getElementById("digbar"));
    this.zone = bar.querySelector(".dig-zone");
    this.perfectEl = bar.querySelector(".dig-perfect");
    this.needle = bar.querySelector(".dig-needle");
    this.depth = bar.querySelector(".dig-depth");
    this.tries = bar.querySelector(".dig-tries");
    this.judge = bar.querySelector(".dig-judge");
    this.card = document.getElementById("reveal");
    this.hideTimer = 0;
    this.scent = document.getElementById("scent");
    this.scentTimer = 0;

    // 嗅聞:先顯示「聞聞中」,聞完換成遠近的結果(顏色跟畫面上的氣味一樣)
    bus.on("sniff:start", () => this.say(":nose: Sniffing…", "#f0e3c8", 1.6));
    bus.on("sniff:result", ({ scent }) => this.say(`:nose: ${scent.label}`, scent.color, 2.8));

    bus.on("dig:game", ({ need }) => {
      this.card.classList.add("hidden");
      this._dots(this.depth, need, 0, "on");
      this._dots(this.tries, BAL.dig.maxMiss, 0, "lost");
      this.judge.className = "dig-judge";
      this.bar.classList.remove("hidden");
      this.frame();
    });
    bus.on("dig:hit", ({ result, hits, need, misses, maxMiss }) => {
      this._dots(this.depth, need, hits, "on");
      this._dots(this.tries, maxMiss, misses, "lost");
      this.judge.textContent = result === "perfect" ? "Perfect!" : result === "good" ? "Good" : "Miss";
      this._restart(this.judge, `dig-judge pop ${result}`);
      if (result === "miss") this._restart(this.bar, "shake");
    });
    bus.on("dig:cancel", () => this.bar.classList.add("hidden"));
    bus.on("dig:found", (e) => {
      this.bar.classList.add("hidden");
      this.show(e);
    });
  }

  // 每幀:指針與綠區位置
  frame() {
    const a = this.digSpots.active;
    if (!a) return;
    const g = a.game;
    this.needle.style.left = `${g.pos * 100}%`;
    this.zone.style.left = `${(g.center - g.half) * 100}%`;
    this.zone.style.width = `${g.half * 200}%`;
    this.perfectEl.style.width = `${(g.perfectHalf / g.half) * 100}%`;
  }

  show({ treasure, tier, isNew, perfect, success, count }) {
    const r = RARITIES[tier];
    const c = this.card;
    c.style.setProperty("--rc", r.color);
    c.querySelector(".rv-icon").textContent = treasure.icon;
    c.querySelector(".rv-name").textContent = treasure.name;
    c.querySelector(".rv-rarity").textContent = r.name;
    c.querySelector(".rv-desc").textContent = treasure.desc;
    c.querySelector(".rv-new").classList.toggle("hidden", !isNew);
    c.querySelector(".rv-note").textContent = !success
      ? "It slipped deeper… you grabbed this instead."
      : perfect ? "★ Perfect dig!" : isNew ? "Added to your Treasure Book" : `You have ${count} of these`;
    this._restart(c, "");
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => c.classList.add("hidden"), 3400);
  }

  say(text, color, secs) {
    setIconText(this.scent, text);
    this.scent.style.color = color;
    this._restart(this.scent, "");
    clearTimeout(this.scentTimer);
    this.scentTimer = setTimeout(() => this.scent.classList.add("hidden"), secs * 1000);
  }

  _dots(el, n, filled, cls) {
    el.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const d = document.createElement("span");
      d.className = i < filled ? `dot ${cls}` : "dot";
      el.appendChild(d);
    }
  }

  // 重新套用 class 讓 CSS 動畫重播
  _restart(el, cls) {
    el.className = "";
    void el.offsetWidth;
    el.className = cls;
  }
}
