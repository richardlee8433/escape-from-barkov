import { HOME_SCALE as S, STATIONS, DOOR, ROOM, slotsOf } from "../config/home.js";
import { bus, log } from "../core/EventBus.js";

// 在家裡走來走去、按 E 互動。
//   鼻子靠近還沒修好的地方 → 提示要什麼材料;夠了就按 E,柯基叼著材料修一會兒,修好換模型
//   鼻子靠近修好、可以擺東西的地方 → E 打開擺設面板(DisplayPicker)
//   門口 → E 出門挖寶
const NOSE = 0.75;        // 柯基中心到鼻尖(房間單位)
const REPAIR_TIME = 1.3;  // 修理動作多久(秒)
const DOOR_SPOT = { id: "door", at: [[ROOM.x1 - 0.1, (DOOR.z0 + DOOR.z1) / 2]], reach: 1.0 };

export class Home {
  constructor({ state, view, player, picker, isPaused = () => false }) {
    this.state = state;
    this.view = view;
    this.player = player;
    this.picker = picker;
    this.isPaused = isPaused;
    this.active = false;
    this.near = null;   // { station, pt }
    this.work = null;   // 修理中:{ station, t }
    this.tipMsg = null;
    bus.on("input:pickup", () => this.interact());
    bus.on("backpack:changed", () => { if (this.active) this.view.apply(); });
  }

  enter() {
    this.active = true;
    this.near = null;
    this.tipMsg = null;
    this.view.apply(true);
  }

  leave() {
    this.active = false;
    this.work = null;
    this._tip(null);
    this.view.setFocus(null);
  }

  // 可以互動的地方:還沒修好的、修好且有展示位的、門口
  _candidates() {
    const out = [];
    for (const st of STATIONS) {
      if (!this.state.isRepaired(st.id) || slotsOf(st.id).length) out.push(st);
    }
    out.push(DOOR_SPOT);
    return out;
  }

  // 鼻尖附近最近的互動點(房間單位)
  findNear() {
    const yaw = this.player.root.rotation.y;
    const nx = this.player.pos.x / S + Math.sin(yaw) * NOSE;
    const nz = this.player.pos.z / S + Math.cos(yaw) * NOSE;
    let best = null, bestK = 1;
    for (const st of this._candidates()) {
      for (const pt of st.at) {
        const k = Math.hypot(nx - pt[0], nz - pt[1]) / st.reach;
        if (k < bestK) { bestK = k; best = { station: st, pt }; }
      }
    }
    return best;
  }

  update(dt) {
    if (!this.active) return;
    if (this.work) {
      this.work.t += dt;
      if (this.work.t >= REPAIR_TIME) this._finishRepair();
      return;
    }
    this.near = this.player.busy ? null : this.findNear();
    this.view.setFocus(this.near?.pt || null);
    this._tip(this.near ? this.describe(this.near.station) : null);
  }

  // 提示文字
  describe(st) {
    if (st.id === "door") return "Press E to go out digging 🐾";
    if (this.state.isRepaired(st.id)) return `Press E · ${st.decorate}`;
    const parts = this.state.needs(st.id).map((n) => `${n.treasure.icon} ${Math.min(n.have, n.need)}/${n.need}`);
    if (this.state.canRepair(st.id)) return `Press E · ${st.verb} (${parts.join(" ")})`;
    return `${st.verb}: needs ${parts.join(" · ")}`;
  }

  interact() {
    if (!this.active || this.isPaused() || this.work || !this.near) return;
    if (this.player.busy) return;
    const st = this.near.station;
    if (st.id === "door") {
      bus.emit("home:leave");
      return;
    }
    if (this.state.isRepaired(st.id)) {
      this.picker.open(st);
      return;
    }
    if (!this.state.canRepair(st.id)) {
      const miss = this.state.needs(st.id).filter((n) => n.have < n.need)
        .map((n) => `${n.treasure.name} ×${n.need - n.have}`);
      log(`Not enough to ${st.verb.toLowerCase()} — still need ${miss.join(", ")}. Go dig some up!`, "warn");
      bus.emit("home:need", { id: st.id });
      return;
    }
    // 開工:面向那個點,做挖地的動作(一移動就中斷)
    const [px, pz] = this.near.pt;
    const yaw = Math.atan2(px * S - this.player.pos.x, pz * S - this.player.pos.z);
    if (!this.player.startDig(yaw, () => { this.work = null; })) return;
    this.work = { station: st, t: 0 };
    this.view.setFocus(null);
    this._tip(null);
    bus.emit("home:working", { id: st.id });
  }

  _finishRepair() {
    const { station } = this.work;
    this.work = null;
    const ok = this.state.repair(station.id);
    this.player.endDig(ok);
    if (!ok) return;
    this.view.apply();
    this.view.puff(station.id);
    if (this.state.coziness >= 1) log("The whole cottage is fixed up. Home sweet home 🏡", "ok");
  }

  _tip(msg) {
    if (msg === this.tipMsg) return;
    this.tipMsg = msg;
    if (msg) bus.emit("tip:show", { msg });
    else bus.emit("tip:hide");
  }
}
