import { suite, check } from "./harness.js";
import { YARD, HOUSE, HOUSE_HALF, FRONT_DOOR, YARD_SPAWN, YARD_GATE, GARDEN } from "../src/config/yard.js";
import { ROOM, HOME_SCALE } from "../src/config/home.js";
import { Yard } from "../src/systems/Yard.js";
import { bus } from "../src/core/EventBus.js";

// 院子:大小、小屋位置、留給花園的空地、門口與大門
export function run() {
  suite("院子");

  const area = (r) => (r.x1 - r.x0) * (r.z1 - r.z0);

  check("院子面積是小屋佔地的 4 倍", () => {
    const yard = area(YARD), house = 4 * HOUSE_HALF.x * HOUSE_HALF.z;
    return Math.abs(yard / house - 4) < 1e-6 ? true : `比例 ${(yard / house).toFixed(2)}`;
  });

  check("小屋外觀和室內一樣大(房間 + 牆)", () => {
    const want = (ROOM.x1 - ROOM.x0 + 0.5) / 2 * HOME_SCALE;
    return Math.abs(HOUSE_HALF.x - want) < 1e-6 ? true : `${HOUSE_HALF.x} vs ${want}`;
  });

  check("小屋整個在柵欄裡,和柵欄之間留得出路", () => {
    const gap = Math.min(HOUSE.x - HOUSE_HALF.x - YARD.x0, HOUSE.z - HOUSE_HALF.z - YARD.z0,
      YARD.x1 - (HOUSE.x + HOUSE_HALF.x), YARD.z1 - (HOUSE.z + HOUSE_HALF.z));
    return gap >= 1 ? true : `只剩 ${gap.toFixed(2)} 公尺`;
  });

  check("花園空地都在柵欄裡、不壓到小屋,加起來至少是小屋佔地的 1.7 倍(門口與柵欄邊留走道)", () => {
    const houseBox = { x0: HOUSE.x - HOUSE_HALF.x, x1: HOUSE.x + HOUSE_HALF.x, z0: HOUSE.z - HOUSE_HALF.z, z1: HOUSE.z + HOUSE_HALF.z };
    let total = 0;
    for (const g of GARDEN) {
      if (g.x0 < YARD.x0 || g.x1 > YARD.x1 || g.z0 < YARD.z0 || g.z1 > YARD.z1) return "花園跑到柵欄外";
      const overlap = Math.max(0, Math.min(g.x1, houseBox.x1) - Math.max(g.x0, houseBox.x0)) *
        Math.max(0, Math.min(g.z1, houseBox.z1) - Math.max(g.z0, houseBox.z0));
      if (overlap > 0) return "花園壓到小屋";
      total += area(g);
    }
    return total >= 1.7 * area(houseBox) ? true : `花園只有 ${total.toFixed(0)} 平方公尺`;
  });

  check("回家出現在小屋門口,面向院子", () => {
    const d = Math.hypot(YARD_SPAWN.x - FRONT_DOOR.x, YARD_SPAWN.z - FRONT_DOOR.z);
    if (d > 2) return `離門 ${d.toFixed(1)} 公尺`;
    return Math.abs(Math.sin(YARD_SPAWN.yaw) - 1) < 1e-6 ? true : "沒有面向院子(+x)";
  });

  // Yard 用得到的柯基欄位
  const corgi = (x, z, yaw) => ({ pos: { x, z }, root: { rotation: { y: yaw } }, busy: false });
  const fakeView = () => ({ apply() {}, setFocus() {} });

  check("門口按 E 進屋,大門按 E 出門;背對就沒反應", () => {
    const got = [];
    const offs = ["yard:enterHouse", "yard:leave"].map((n) => bus.on(n, () => got.push(n)));
    const p = corgi(FRONT_DOOR.x + 2, FRONT_DOOR.z, -Math.PI / 2); // 面向門(-x)
    const y = new Yard({ view: fakeView(), player: p });
    y.enter();
    y.update();
    y.interact();
    p.pos.x = YARD_GATE.x; p.pos.z = YARD_GATE.z - 2; p.root.rotation.y = 0; // 面向大門(+z)
    y.update();
    y.interact();
    p.root.rotation.y = Math.PI; // 背對
    y.update();
    y.interact();
    y.leave();
    offs.forEach((f) => f());
    return got.join(",") === "yard:enterHouse,yard:leave" ? true : got.join(",");
  });
}
