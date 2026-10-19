import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";
import { t } from "../i18n/i18n.js";

// 回家的大門:走進範圍出現提示,按 F 回到柯基的小屋(見 Home)。
export class ExitSystem {
  constructor(exitPos, player, input) {
    this.exitPos = exitPos;
    this.player = player;
    this.input = input;
    this.done = false;
    this.nearby = false;
    bus.on("lang:changed", () => { this.nearby = false; });
  }

  // 從家裡回來:可以再按 F 回家
  reset() {
    this.done = false;
    this.nearby = false;
    bus.emit("exit:near", { near: false });
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
      bus.emit("exit:near", { near }); // 手機版的「回家」按鈕跟著出現 / 消失
      bus.emit(near ? "tip:show" : "tip:hide", { msg: t("tip.home") });
    }

    if (near && this.input.isDown("f")) {
      this.done = true;
      bus.emit("tip:hide");
      bus.emit("exit:home", { x: this.exitPos.x, z: this.exitPos.z });
    }
  }
}
