import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

// 出口:走進大門範圍出現提示,按 F 直接撤離。
export class ExitSystem {
  constructor(exitPos, player, input) {
    this.exitPos = exitPos;
    this.player = player;
    this.input = input;
    this.done = false;
    this.nearby = false;
  }

  update() {
    if (this.done || !this.player.alive) return;
    const d = Math.hypot(
      this.exitPos.x - this.player.pos.x,
      this.exitPos.z - this.player.pos.z
    );
    const near = d < BAL.exit.proximity;

    if (near !== this.nearby) {
      this.nearby = near;
      bus.emit(near ? "tip:show" : "tip:hide", { msg: "Press F to extract 🏁" });
    }

    if (near && this.input.isDown("f")) {
      this.done = true;
      bus.emit("tip:hide");
      bus.emit("victory");
    }
  }
}
