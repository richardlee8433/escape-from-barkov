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

    // 「汪!」:鋸齒波 + 方波往下滑,過低通濾波,起音很快
    const woof = (delay = 0) => {
      try {
        const t0 = this.ctx.currentTime + delay;
        const g = this.ctx.createGain();
        const f = this.ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 1400;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        f.connect(g).connect(this.ctx.destination);
        for (const [type, mul] of [["sawtooth", 1], ["square", 0.5]]) {
          const o = this.ctx.createOscillator();
          o.type = type;
          o.frequency.setValueAtTime(520 * mul, t0);
          o.frequency.exponentialRampToValueAtTime(190 * mul, t0 + 0.16);
          o.connect(f);
          o.start(t0);
          o.stop(t0 + 0.22);
        }
      } catch (e) { /* 音效失敗不影響遊戲 */ }
    };

    bus.on("game:started", () => {
      this.ctx.resume().catch(() => {});
      beep(440, 0.12);
    });
    bus.on("backpack:picked", () => { beep(1200, 0.08); beep(1600, 0.1); });
    bus.on("backpack:dropped", () => [700, 520, 380].forEach((f, i) => setTimeout(() => beep(f, 0.07, "triangle", 0.05), i * 70)));
    bus.on("player:pecked", () => beep(320, 0.18)); // 汪一聲
    bus.on("enemy:alerted", () => beep(760, 0.12)); // 「嘎!」
    bus.on("enemy:hurt", () => beep(260, 0.08, "triangle")); // 「嘎…」
    bus.on("enemy:died", () => { beep(420, 0.08); beep(260, 0.16); }); // 「哇→啊」
    bus.on("enemy:peck", () => beep(1500, 0.04, "square", 0.05)); // 「啄!」
    bus.on("bark", ({ scared }) => {
      woof();
      // 被嚇到的鴨子:一串慌張的嘎嘎
      if (scared.length) [0, 90, 180].forEach((d, i) => setTimeout(() => beep(1250 - i * 120, 0.05, "square", 0.04), 250 + d));
    });
    bus.on("bark:cooldown", () => beep(220, 0.06, "sine", 0.04));
    bus.on("dig:start", () => beep(180, 0.08, "sawtooth", 0.04));
    // 嗅聞:三下短促的「嗅嗅嗅」;結果越近音越高
    bus.on("sniff:start", () => [0, 140, 280].forEach((d) => setTimeout(() => beep(1900, 0.025, "sawtooth", 0.02), d)));
    bus.on("sniff:result", ({ scent }) => {
      if (scent.id === "here") [784, 988, 1319].forEach((f, i) => setTimeout(() => beep(f, 0.1, "triangle", 0.07), i * 80));
      else beep({ hot: 880, warm: 660, faint: 520, cold: 300 }[scent.id], 0.14, "sine", 0.06);
    });
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
    // 家:進出門、敲敲打打、修好、擺東西
    bus.on("exit:home", () => [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.12, "triangle", 0.06), i * 110)));
    bus.on("home:leave", () => [784, 659].forEach((f, i) => setTimeout(() => beep(f, 0.1, "triangle", 0.05), i * 110)));
    bus.on("home:working", () => [0, 260, 520, 780, 1040].forEach((d) => setTimeout(() => beep(210, 0.05, "square", 0.045), d)));
    bus.on("home:repaired", () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.13, "triangle", 0.07), i * 90)));
    bus.on("home:need", () => beep(300, 0.14, "sine", 0.05));
    bus.on("home:display", ({ treasureId }) => (treasureId ? beep(988, 0.08, "triangle", 0.06) : beep(523, 0.08, "triangle", 0.05)));
  }
}
