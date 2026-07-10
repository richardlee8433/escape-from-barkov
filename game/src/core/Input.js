import { bus } from "./EventBus.js";

// 鍵盤 / 滑鼠統一入口。
// 持續狀態（移動、F 長按）用 isDown()；單次動作（撿取、切格、開火）發事件。
export class Input {
  constructor(dom) {
    this.keys = Object.create(null);
    this.mouse = { x: 0, y: 0, has: false }; // NDC 座標

    addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) {
        if (k === "e") bus.emit("input:pickup");
        else if (k === "m") bus.emit("input:bgm");
        else if (e.code === "Digit1") bus.emit("input:slot", 0);
        else if (e.code === "Digit2") bus.emit("input:slot", 1);
        else if (e.code === "Digit3") bus.emit("input:slot", 2);
      }
      this.keys[k] = true;
    });
    addEventListener("keyup", (e) => (this.keys[e.key.toLowerCase()] = false));

    addEventListener("pointermove", (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      this.mouse.has = true;
    });

    dom.addEventListener("mousedown", (e) => {
      if (e.button === 0) bus.emit("input:fire");
    });
  }

  isDown(key) {
    return !!this.keys[key];
  }

  // WASD → {x, z}，尚未轉換到世界座標（由 Player 依相機朝向換算）
  axes() {
    let x = 0, z = 0;
    if (this.keys["w"] || this.keys["arrowup"]) z -= 1;
    if (this.keys["s"] || this.keys["arrowdown"]) z += 1;
    if (this.keys["a"] || this.keys["arrowleft"]) x -= 1;
    if (this.keys["d"] || this.keys["arrowright"]) x += 1;
    return { x, z };
  }
}
