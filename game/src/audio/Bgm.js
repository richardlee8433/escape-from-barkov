import { bus, log } from "../core/EventBus.js";

// 背景音樂:M 鍵切換,每次播放重建實例避免 Chrome 掛起後無法重播。
export class Bgm {
  constructor(url = "../ass/audio/bgm.mp3") {
    this.url = url;
    this.enabled = true;
    this.audio = null;

    bus.on("input:bgm", () => {
      this.enabled = !this.enabled;
      if (this.enabled) {
        this.start();
        log("BGM ON (M)", "info");
      } else {
        this.stop();
        log("BGM OFF (M)", "info");
      }
    });
    bus.on("game:started", () => this.start());
    bus.on("victory", () => this.stop());
  }

  start() {
    this.stop();
    if (!this.enabled) return;
    this.audio = new Audio(this.url);
    this.audio.loop = true;
    this.audio.volume = 0.45;
    this.audio.play().catch(() => {});
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
  }
}
