import { FRONT_DOOR, YARD_GATE } from "../config/yard.js";
import { bus } from "../core/EventBus.js";
import { t } from "../i18n/i18n.js";

// 院子裡按 E 的地方:小屋門口(進屋)和前面柵欄的大門(出門挖寶)。
// 跟室內一樣看「鼻子」靠近哪一個。
const NOSE = 1.0;
const SPOTS = [
  { id: "door", at: [FRONT_DOOR.x + 0.6, FRONT_DOOR.z], reach: 1.9, tip: "tip.enterHouse", event: "yard:enterHouse" },
  { id: "gate", at: [YARD_GATE.x, YARD_GATE.z - 0.6], reach: 2.0, tip: "tip.yardGate", event: "yard:leave" },
];

export class Yard {
  constructor({ view, player, isPaused = () => false }) {
    this.view = view;
    this.player = player;
    this.isPaused = isPaused;
    this.active = false;
    this.near = null;
    this.tipMsg = null;
    bus.on("input:pickup", () => this.interact());
    bus.on("lang:changed", () => { this.tipMsg = null; });
  }

  enter() {
    this.active = true;
    this.near = null;
    this.tipMsg = null;
    this.view.apply();
  }

  leave() {
    this.active = false;
    this._tip(null);
    this.view.setFocus(null);
  }

  findNear() {
    const yaw = this.player.root.rotation.y;
    const nx = this.player.pos.x + Math.sin(yaw) * NOSE;
    const nz = this.player.pos.z + Math.cos(yaw) * NOSE;
    let best = null, bestK = 1;
    for (const s of SPOTS) {
      const k = Math.hypot(nx - s.at[0], nz - s.at[1]) / s.reach;
      if (k < bestK) { bestK = k; best = s; }
    }
    return best;
  }

  update() {
    if (!this.active) return;
    this.near = this.player.busy ? null : this.findNear();
    this.view.setFocus(this.near?.at || null);
    this._tip(this.near ? t(this.near.tip) : null);
  }

  interact() {
    if (!this.active || this.isPaused() || !this.near || this.player.busy) return;
    bus.emit(this.near.event);
  }

  _tip(msg) {
    if (msg === this.tipMsg) return;
    this.tipMsg = msg;
    if (msg) bus.emit("tip:show", { msg });
    else bus.emit("tip:hide");
  }
}
