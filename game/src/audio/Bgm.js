import { bus, log } from "../core/EventBus.js";
import { settings } from "../core/Settings.js";
import { t } from "../i18n/i18n.js";

// 背景音樂:M 鍵切換,每次播放重建實例避免 Chrome 掛起後無法重播。
// 曲目:Griffith Hall 166(原始錄音很小聲,已用 ffmpeg loudnorm 拉到 -20 LUFS、峰值 -1.5 dBTP)
export class Bgm {
  constructor(url = "../ass/audio/griffith_hall.mp3") {
    this.url = url;
    this.enabled = true;
    this.audio = null;

    bus.on("input:bgm", () => {
      this.enabled = !this.enabled;
      if (this.enabled) {
        this.start();
        log(t("log.bgmOn"), "info");
      } else {
        this.stop();
        log(t("log.bgmOff"), "info");
      }
    });
    bus.on("game:started", () => this.start());
    // 設定面板拉音量:播放中的直接跟著變
    bus.on("settings:changed", ({ key }) => { if (key === "music" && this.audio) this.audio.volume = this.volume; });
    bus.on("victory", () => this.stop());
  }

  // 設定裡的 100% = 0.9(已和舊曲的響度對齊)
  get volume() {
    return 0.9 * settings.music;
  }

  start() {
    this.stop();
    if (!this.enabled) return;
    this.audio = new Audio(this.url);
    this.audio.loop = true;
    this.audio.volume = this.volume;
    this.audio.play().catch(() => {});
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
  }
}
