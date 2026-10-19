import { bus } from "../core/EventBus.js";
import { t, setTouch } from "../i18n/i18n.js";
import { NOSE_SVG } from "./icons.js";

// 手機的操作:
//   左半邊畫面任何地方按下去拖曳 = 虛擬搖桿(推一點走路、推到底跑步)
//   右下角按鈕:🐾 挖 / 互動(E)、鼻子 嗅聞(Q)、🗯️ 吠(R);走到大門旁才出現 🏡 回家(F,要按住)
//   兩指捏合 = 拉近拉遠;挖掘小遊戲時點畫面任何地方也算一鏟
// 觸控為主的裝置一開始就打開;用滑鼠的電腦第一次被摸到螢幕時才打開。
const STICK_R = 56; // 搖桿推到底的距離(px)

// 觸控模式要在標題畫面就決定(說明文字跟著換成「點」);遊戲開始後才建 TouchControls
export function initTouchMode() {
  const on = () => {
    document.body.classList.add("touch");
    setTouch(true);
  };
  let coarse = false;
  try { coarse = matchMedia("(pointer: coarse)").matches; } catch (e) { /* 舊瀏覽器 */ }
  if (coarse) on();
  else addEventListener("touchstart", on, { once: true, passive: true });
}

export class TouchControls {
  constructor(input, canvas) {
    this.input = input;
    this.canvas = canvas;
    this.on = false;
    this.stickId = null;
    this.pinch = null;

    const layer = (this.layer = document.createElement("div"));
    layer.id = "touch";
    layer.className = "hidden";
    layer.innerHTML = `
      <div class="stick-zone"></div>
      <div class="stick-base"><div class="stick-knob"></div></div>
      <div class="tbtns">
        <button class="tbtn act" data-key="e"><span class="ic">🐾</span><span class="lb" data-i18n="touch.act"></span></button>
        <button class="tbtn sniff" data-key="q"><span class="ic">${NOSE_SVG}</span><span class="lb" data-i18n="touch.sniff"></span></button>
        <button class="tbtn bark" data-key="r"><span class="ic">🗯️</span><span class="lb" data-i18n="touch.bark"></span></button>
        <button class="tbtn home hidden" data-key="f"><span class="ic">🏡</span><span class="lb" data-i18n="touch.home"></span></button>
      </div>`;
    document.body.appendChild(layer);
    this.zone = layer.querySelector(".stick-zone");
    this.base = layer.querySelector(".stick-base");
    this.knob = layer.querySelector(".stick-knob");
    this.homeBtn = layer.querySelector(".home");

    // ---- 搖桿:在左半邊哪裡按下,搖桿就出現在哪裡
    this.zone.addEventListener("pointerdown", (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      try { this.zone.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件抓不到也沒關係 */ }
      this.origin = { x: e.clientX, y: e.clientY };
      this.tapT = performance.now();
      this.dragged = false;
      this._placeBase(e.clientX, e.clientY);
      this.base.classList.add("active");
      this._moveKnob(0, 0);
    });
    this.zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
      const d = Math.hypot(dx, dy);
      if (d > 8) this.dragged = true;
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      this._moveKnob(dx, dy);
      this.input.setStick(dx / STICK_R, dy / STICK_R);
    });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.setStick(0, 0);
      // 沒拖動的輕點 = 點了畫面(挖掘小遊戲裡也算一鏟)
      if (!this.dragged && performance.now() - this.tapT < 300) bus.emit("input:click");
      this.base.classList.remove("active");
      this._restBase();
      this._moveKnob(0, 0);
    };
    this.zone.addEventListener("pointerup", end);
    this.zone.addEventListener("pointercancel", end);

    // ---- 按鈕:按下就是按下鍵盤上那個鍵;F(回家)要按住
    for (const b of layer.querySelectorAll(".tbtn")) {
      const k = b.dataset.key;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        b.classList.add("down");
        this.input.press(k);
      });
      const up = () => {
        b.classList.remove("down");
        this.input.release(k);
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("pointerleave", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    bus.on("exit:near", ({ near }) => this.homeBtn.classList.toggle("hidden", !near));
    bus.on("lang:changed", () => this.applyLabels());

    // ---- 兩指捏合縮放(在 3D 畫面上)
    canvas.addEventListener("touchstart", (e) => this._pinch(e), { passive: false });
    canvas.addEventListener("touchmove", (e) => this._pinch(e), { passive: false });
    canvas.addEventListener("touchend", () => { this.pinch = null; });

    // 吠叫冷卻時按鈕變暗(和 HUD 一樣)
    bus.on("bark", () => {
      const b = layer.querySelector(".bark");
      b.classList.add("cooling");
      clearTimeout(this._barkT);
      this._barkT = setTimeout(() => b.classList.remove("cooling"), 6000);
    });

    addEventListener("resize", () => { if (this.stickId === null) this._restBase(); });
    // 遊戲中才第一次摸螢幕(觸控筆電):那時才顯示按鈕
    addEventListener("touchstart", () => { if (this.started) this.show(); }, { passive: true });
  }

  // 遊戲開始後才顯示按鈕(標題畫面不需要);不是觸控模式就什麼都不做
  show() {
    this.started = true;
    if (!document.body.classList.contains("touch") || this.on) return;
    this.on = true;
    this.layer.classList.remove("hidden");
    this.applyLabels();
    this._restBase();
    // 直向的手機建議橫過來玩
    if (innerHeight > innerWidth * 1.1) {
      const toast = document.createElement("div");
      toast.id = "rotate-hint";
      toast.textContent = `📱↻ ${t("touch.rotate")}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4500);
    }
  }

  applyLabels() {
    for (const el of this.layer.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  }

  // 沒在按的時候,搖桿淡淡地停在左下角,告訴玩家這裡可以拖
  _restBase() {
    const r = this.zone.getBoundingClientRect();
    this._placeBase(r.left + 96, r.bottom - 96);
  }

  _placeBase(x, y) {
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
  }

  _moveKnob(dx, dy) {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _pinch(e) {
    if (e.touches.length !== 2) {
      this.pinch = null;
      return;
    }
    e.preventDefault();
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!this.pinch) {
      this.pinch = d;
      return;
    }
    // 每捏 12% 縮放一格(和滾輪一樣);手指張開 = 拉近
    while (d > this.pinch * 1.12) { bus.emit("input:zoom", -1); this.pinch *= 1.12; }
    while (d < this.pinch / 1.12) { bus.emit("input:zoom", 1); this.pinch /= 1.12; }
  }
}
