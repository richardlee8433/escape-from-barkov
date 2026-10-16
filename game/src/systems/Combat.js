import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

// 鴨子的啄擊與難度。柯基不拿武器、也沒有血量:
// 被啄到只會被推開一步、手上的挖掘被打斷,背包裡掉出一件東西(見 Backpack)。
export class Combat {
  constructor(collision) {
    this.collision = collision;
    this.time = 0;
  }

  // 鴨子隨時間變快、出手變勤(封頂)
  difficulty() {
    const d = BAL.difficulty;
    return Math.min(1 + this.time / d.timeToDouble, d.cap);
  }

  update(dt) {
    this.time += dt;
  }

  // 前搖結束、確定還在範圍內才會呼叫(見 EnemyBrain)
  peck(enemy, player) {
    const dx = player.pos.x - enemy.pos.x;
    const dz = player.pos.z - enemy.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    // 來向:指回出手的鴨子(畫面邊緣的方向提示用)
    const fromX = -dx / L, fromZ = -dz / L;
    bus.emit("combat:hit", { targetType: "player", x: player.pos.x, z: player.pos.z, fromX, fromZ });
    bus.emit("enemy:peck", { enemy, x: player.pos.x, z: player.pos.z });
    // 被啄退一步(走一般移動流程,不會被推進石頭或溪裡)
    const k = BAL.enemy.peckKnockback;
    this.collision.move(player.pos, (dx / L) * k, (dz / L) * k, player.body ? player.body() : player.radius);
    bus.emit("player:pecked", { x: player.pos.x, z: player.pos.z, fromX, fromZ });
  }
}
