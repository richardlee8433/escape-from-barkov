import { bus } from "./EventBus.js";

// 鍵盤 / 滑鼠 / 觸控統一入口。
// 持續狀態（移動、F 長按）用 isDown()；單次動作（撿取 / 挖、嗅聞、吠叫、背包、圖鑑）發事件。
// 手機:虛擬搖桿寫進 setStick(),畫面上的按鈕呼叫 press() / release(),跟按鍵盤走同一條路。
const STICK_DEAD = 0.15; // 搖桿推不到這麼多就當沒推
const STICK_WALK = 0.55; // 推不到這麼多是「走路」(等於按住 Shift)

export class Input {
  constructor(dom) {
    this.keys = Object.create(null);
    this.mouse = { x: 0, y: 0, has: false }; // NDC 座標
    this.stick = { x: 0, z: 0, mag: 0 };      // 虛擬搖桿(螢幕方向:x 右、z 下)

    addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      // 空白鍵(挖)與 Tab(圖鑑)不要捲動頁面或移動焦點
      if (k === " " || k === "tab") e.preventDefault();
      if (!e.repeat) this.press(k);
      else this.keys[k] = true;
    });
    addEventListener("keyup", (e) => this.release(e.key.toLowerCase()));

    addEventListener("pointermove", (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      this.mouse.has = true;
    });

    // 滾輪縮放鏡頭(不讓頁面跟著捲動)
    dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.deltaY) bus.emit("input:zoom", Math.sign(e.deltaY));
    }, { passive: false });

    dom.addEventListener("mousedown", (e) => {
      if (e.button === 0) bus.emit("input:click"); // 挖掘小遊戲裡也能用滑鼠點
    });
  }

  // 按下一個鍵(鍵盤或畫面上的按鈕):單次動作發事件,同時記成「按住」
  press(k) {
    if (k === "e") bus.emit("input:pickup");
    else if (k === " ") bus.emit("input:dig");
    else if (k === "q") bus.emit("input:sniff");
    else if (k === "r") bus.emit("input:bark");
    else if (k === "tab") bus.emit("input:collection");
    else if (k === "escape") bus.emit("input:close");
    else if (k === "m") bus.emit("input:bgm");
    else if (k === "b" || k === "i") bus.emit("input:bag");
    this.keys[k] = true;
  }

  release(k) {
    this.keys[k] = false;
  }

  // 虛擬搖桿:(x, z) 是螢幕方向的推動量,長度 0..1
  setStick(x, z) {
    const mag = Math.min(1, Math.hypot(x, z));
    this.stick = mag < STICK_DEAD ? { x: 0, z: 0, mag: 0 } : { x, z, mag };
  }

  isDown(key) {
    // 搖桿只推一點點 = 走路
    if (key === "shift" && this.stick.mag > 0 && this.stick.mag < STICK_WALK) return true;
    return !!this.keys[key];
  }

  // WASD / 搖桿 → {x, z}，尚未轉換到世界座標（由 Player 依相機朝向換算）
  axes() {
    if (this.stick.mag > 0) return { x: this.stick.x, z: this.stick.z };
    let x = 0, z = 0;
    if (this.keys["w"] || this.keys["arrowup"]) z -= 1;
    if (this.keys["s"] || this.keys["arrowdown"]) z += 1;
    if (this.keys["a"] || this.keys["arrowleft"]) x -= 1;
    if (this.keys["d"] || this.keys["arrowright"]) x += 1;
    return { x, z };
  }
}
