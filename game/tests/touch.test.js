import { suite, check, eq } from "./harness.js";
import { Input } from "../src/core/Input.js";
import { fovFor } from "../src/core/Game.js";
import { STRINGS } from "../src/i18n/strings.js";
import { bus } from "../src/core/EventBus.js";

// 手機操作:虛擬搖桿、畫面按鈕、直向畫面的視角
export function run() {
  suite("手機操作");

  const input = () => new Input(document.createElement("div"));

  check("搖桿推到底:跑步方向就是搖桿方向,不算走路", () => {
    const i = input();
    i.setStick(1, 0);
    const a = i.axes();
    if (a.x !== 1 || a.z !== 0) return JSON.stringify(a);
    return i.isDown("shift") ? "推到底卻是走路" : true;
  });

  check("搖桿只推一點點 = 走路(等於按住 Shift)", () => {
    const i = input();
    i.setStick(0, -0.35);
    return i.isDown("shift") && i.axes().z < 0 ? true : "沒有變成走路";
  });

  check("搖桿在死區內 = 沒推;放開就停", () => {
    const i = input();
    i.setStick(0.05, 0.05);
    if (i.axes().x || i.axes().z) return "死區內還在動";
    i.setStick(1, 1);
    i.setStick(0, 0);
    return eq(i.axes().x + i.axes().z, 0);
  });

  check("畫面按鈕和鍵盤走同一條路:press('e') 發出 input:pickup,press('f') 是按住", () => {
    const i = input();
    let got = 0;
    const off = bus.on("input:pickup", () => got++);
    i.press("e");
    off();
    i.press("f");
    if (!i.isDown("f")) return "F 沒有按住";
    i.release("f");
    return got === 1 && !i.isDown("f") ? true : `pickup=${got}`;
  });

  check("橫向畫面維持原本的視角;直向畫面放寬視角(但不超過 62°)", () => {
    if (fovFor(16 / 9) !== 38 || fovFor(4 / 3) !== 38) return "橫向的視角變了";
    const portrait = fovFor(390 / 844);
    if (!(portrait > 50 && portrait <= 62)) return `直向 ${portrait.toFixed(1)}°`;
    return fovFor(0.3) === 62 ? true : "沒有封頂";
  });

  check("每一句手機版文字(key@touch)都有對應的原句", () => {
    for (const k of Object.keys(STRINGS)) {
      if (!k.endsWith("@touch")) continue;
      const base = k.slice(0, -6);
      if (base !== "scent.here" && !STRINGS[base]) return `${k} 沒有原句`;
    }
  });
}
