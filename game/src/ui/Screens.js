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

  // 按下開始:先攤開媽媽的信(順便當載入畫面),載完之後按「Let's go」才進遊戲。
  // fn 負責載入與建好遊戲;信收起來時發出 story:closed,遊戲才開始動。
  onStart(fn) {
    const letter = document.getElementById("letter");
    const go = letter.querySelector(".go");
    this.startBtn.onclick = async () => {
      this.startBtn.disabled = true;
      this.startBtn.textContent = "Loading…";
      letter.classList.remove("hidden");
      go.disabled = true;
      go.textContent = "Loading…";
      try {
        await fn((done, total) => {
          go.textContent = `Loading… ${done}/${total}`;
        });
        this.title.classList.add("hidden");
        go.disabled = false;
        go.textContent = "Let's go! 🐾";
        go.focus();
        go.onclick = () => {
          letter.classList.add("hidden");
          bus.emit("story:closed");
        };
      } catch (err) {
        // 載入失敗要說出來,不能讓按鈕看起來「沒反應」
        console.error(err);
        letter.classList.add("hidden");
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
