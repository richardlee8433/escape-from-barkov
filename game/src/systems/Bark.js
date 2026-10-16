import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

// R:柯基吠一聲,附近的鴨子嚇得拍翅膀逃走(前搖中的啄擊也會被打斷)。
// 有冷卻時間:一直吠就不稀奇了。在家裡也能吠(只是沒有鴨子可嚇)。
export class Bark {
  constructor(player, getEnemies = () => []) {
    this.player = player;
    this.getEnemies = getEnemies;
    this.cooldown = 0;
  }

  get ready() {
    return this.cooldown <= 0;
  }

  // 冷卻進度 0..1(1 = 可以吠)
  get charge() {
    return 1 - Math.max(0, this.cooldown) / BAL.bark.cooldown;
  }

  bark() {
    const p = this.player;
    if (!this.ready) {
      bus.emit("bark:cooldown", { left: this.cooldown });
      return false;
    }
    if (!p.startBark()) return false;
    this.cooldown = BAL.bark.cooldown;
    const scared = [];
    for (const e of this.getEnemies()) {
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) > BAL.bark.radius) continue;
      e.brain.scare(p.pos.x, p.pos.z);
      scared.push(e);
    }
    bus.emit("bark", { x: p.pos.x, z: p.pos.z, scared });
    return true;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
  }
}
