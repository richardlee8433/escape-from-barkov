import { bus } from "../core/EventBus.js";

// 開始 / 說明 / 死亡 / 勝利畫面。
export class Screens {
  constructor() {
    this.title = document.getElementById("title-screen");
    this.howto = document.getElementById("howto");
    this.end = document.getElementById("end");
    this.startBtn = document.getElementById("btn-start");

    document.getElementById("btn-howto").onclick = () => this.howto.classList.remove("hidden");
    document.getElementById("btn-close-howto").onclick = () => this.howto.classList.add("hidden");
    document.getElementById("btn-retry").onclick = () => location.reload();

    bus.on("victory", () => this.showEnd());
  }

  onStart(fn) {
    this.startBtn.onclick = async () => {
      // 按下就立刻有回饋:第一個模型載完之前,按鈕文字也要變
      this.startBtn.disabled = true;
      this.startBtn.textContent = "Loading…";
      try {
        await fn((done, total) => {
          this.startBtn.textContent = `Loading… ${done}/${total}`;
        });
        this.title.classList.add("hidden");
      } catch (err) {
        // 載入失敗要說出來,不能讓按鈕看起來「沒反應」
        console.error(err);
        this.startBtn.textContent = "Load failed — click to retry";
        this.startBtn.title = String(err?.message || err);
        this.startBtn.disabled = false;
        this.startBtn.onclick = () => location.reload();
      }
    };
  }

  showEnd() {
    this.end.querySelector("h2").textContent = "🎉 You Escaped!";
    this.end.querySelector("p").textContent = "You made it out of Barkov with a backpack full of treasure.";
    this.end.classList.remove("hidden");
  }
}
