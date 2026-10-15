import { bus } from "../core/EventBus.js";

// 8-bit 合成音效(AudioContext + Oscillator),完整沿用舊版的音色設計。
// 全部透過事件觸發,遊戲邏輯不需要知道音效的存在。
export class Sfx {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    const beep = (freq, dur, type = "square", gain = 0.06) => {
      try {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = gain;
        o.connect(g).connect(this.ctx.destination);
        o.start();
        o.stop(this.ctx.currentTime + dur);
      } catch (e) { /* 音效失敗不影響遊戲 */ }
    };

    bus.on("game:started", () => {
      this.ctx.resume().catch(() => {});
      beep(440, 0.12);
    });
    bus.on("shot", () => beep(880, 0.08, "triangle"));
    bus.on("item:picked", () => beep(1200, 0.1));
    bus.on("player:hurt", () => beep(320, 0.18)); // 汪一聲
    bus.on("player:healed", () => { beep(880, 0.06); beep(1320, 0.12); });
    bus.on("player:died", () => beep(140, 0.4, "sine"));
    bus.on("enemy:alerted", () => beep(760, 0.12)); // 「嘎!」
    bus.on("enemy:hurt", () => beep(260, 0.08, "triangle")); // 「嘎…」
    bus.on("enemy:died", () => { beep(420, 0.08); beep(260, 0.16); }); // 「哇→啊」
    bus.on("enemy:peck", () => beep(1500, 0.04, "square", 0.05)); // 「啄!」
    bus.on("dig:start", () => beep(180, 0.08, "sawtooth", 0.04));
    bus.on("dig:hit", ({ result }) => {
      if (result === "perfect") { beep(1320, 0.05); beep(1760, 0.09, "triangle"); }
      else if (result === "good") beep(700, 0.07, "triangle");
      else beep(150, 0.14, "sawtooth", 0.05);
    });
    bus.on("dig:cancel", () => beep(240, 0.1, "sine"));
    // 挖到寶:稀有度越高,琶音越長
    bus.on("dig:found", ({ tier }) => {
      const notes = [523, 659, 784, 1047, 1319, 1568].slice(0, tier + 2);
      notes.forEach((f, i) => setTimeout(() => beep(f, 0.12, "triangle", 0.07), i * 90));
    });
    bus.on("victory", () => { beep(660, 0.12); beep(880, 0.12); beep(1320, 0.25); });
  }
}
