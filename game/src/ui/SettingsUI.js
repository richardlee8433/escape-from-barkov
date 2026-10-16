import { bus } from "../core/EventBus.js";
import { settings } from "../core/Settings.js";
import { LANGS, setLang } from "../i18n/i18n.js";

// 右上角的齒輪:語言、音樂音量。標題畫面就能開;遊戲中打開時和其他面板一樣會暫停。
export class SettingsUI {
  constructor() {
    this.el = document.getElementById("settings");
    this.btn = document.getElementById("settings-btn");
    this.langEl = document.getElementById("set-lang");
    this.music = document.getElementById("set-music");
    this.musicVal = document.getElementById("set-music-val");
    this.isOpen = false;

    this.langBtns = LANGS.map((l) => {
      const b = document.createElement("button");
      b.textContent = l.label;
      b.addEventListener("click", () => {
        setLang(l.id);
        this.render();
      });
      this.langEl.appendChild(b);
      return [l.id, b];
    });
    this.music.addEventListener("input", () => {
      settings.set("music", Number(this.music.value) / 100);
      this.render();
    });

    this.btn.addEventListener("click", () => this.toggle());
    this.el.querySelector(".panel-close").addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
    bus.on("input:close", () => this.close());
    // 標題畫面還沒有 Input(遊戲開始後才建立),Esc 自己聽
    addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    bus.on("panel:open", ({ id }) => { if (id !== "settings") this.close(); });
    this.render();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    bus.emit("panel:open", { id: "settings" });
    this.isOpen = true;
    this.render();
    this.el.classList.remove("hidden");
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add("hidden");
    bus.emit("panel:close", { id: "settings" });
  }

  render() {
    for (const [id, b] of this.langBtns) b.classList.toggle("on", id === settings.lang);
    const pct = Math.round(settings.music * 100);
    this.music.value = pct;
    this.musicVal.textContent = `${pct}%`;
  }
}
