import { suite, check, eq } from "./harness.js";
import { Backpack } from "../src/systems/Backpack.js";
import { HomeState } from "../src/systems/HomeState.js";
import { Home } from "../src/systems/Home.js";
import { STATIONS, SLOTS, HOME_SCALE, slotsOf, stationById } from "../src/config/home.js";
import { byId } from "../src/config/treasures.js";
import { bus } from "../src/core/EventBus.js";

function memoryStorage(init = {}) {
  const data = { ...init };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

function setup(items = {}, store = memoryStorage()) {
  const bag = new Backpack(store);
  for (const [id, n] of Object.entries(items)) bag.add(id, n);
  return { bag, home: new HomeState(bag, store), store };
}

export function run() {
  suite("家:設定");

  check("每個站點的材料都是挖得到的寶物,模型至少有一個", () => {
    for (const st of STATIONS) {
      for (const id of Object.keys(st.needs)) if (!byId[id]) return `${st.id} 要的 ${id} 不存在`;
      if (!st.broken && !st.fixed) return `${st.id} 沒有模型`;
      if (!st.at.length) return `${st.id} 沒有位置`;
    }
  });

  check("展示位都掛在有「擺設」文字的站點上,id 不重複", () => {
    const ids = new Set();
    for (const s of SLOTS) {
      if (ids.has(s.id)) return `重複的 ${s.id}`;
      ids.add(s.id);
      if (!stationById[s.station]?.decorate) return `${s.id} 的站點沒有 decorate`;
    }
    for (const st of STATIONS) if (st.decorate && !slotsOf(st.id).length) return `${st.id} 有 decorate 卻沒有展示位`;
  });

  suite("家:修理");

  check("材料不夠不能修,背包不變", () => {
    const { bag, home } = setup({ plank: 1 });
    if (home.canRepair("table")) return "不該能修";
    if (home.repair("table")) return "不該修好";
    return eq(bag.count("plank"), 1);
  });

  check("材料夠就修好:用掉材料、發出 home:repaired、舒適度上升", () => {
    const { bag, home } = setup({ plank: 3, nail: 1 });
    let got = null;
    const off = bus.on("home:repaired", (e) => { got = e; });
    const ok = home.repair("table");
    off();
    if (!ok || !home.isRepaired("table")) return "沒修好";
    if (bag.count("plank") !== 2 || bag.count("nail") !== 0) return `材料沒扣對 ${JSON.stringify(bag.items)}`;
    if (got?.id !== "table") return "沒有事件";
    return eq(home.coziness, 1 / STATIONS.length, 1e-9);
  });

  check("修好的不能再修一次", () => {
    const { home } = setup({ plank: 4, nail: 4 });
    home.repair("shelf");
    return home.repair("shelf") ? "又修了一次" : true;
  });

  check("needs() 回報缺多少", () => {
    const { home } = setup({ straw: 1 });
    const n = home.needs("roof");
    return eq(`${n[0].treasure.id} ${n[0].have}/${n[0].need}`, "straw 1/3");
  });

  suite("家:擺設");

  check("家具沒修好不能擺", () => {
    const { home } = setup({ bell: 1 });
    return home.place("shelf1", "bell") ? "壞的架子不該能擺" : true;
  });

  check("擺上去離開背包;換一件時舊的回背包;收回來回背包", () => {
    const { bag, home } = setup({ plank: 1, nail: 1, bell: 1, key: 1 });
    home.repair("shelf");
    if (!home.place("shelf1", "bell")) return "擺不上去";
    if (bag.count("bell") !== 0 || home.displays.shelf1 !== "bell") return "沒離開背包";
    if (!home.place("shelf1", "key")) return "換不了";
    if (bag.count("bell") !== 1 || bag.count("key") !== 0) return `舊的沒回背包 ${JSON.stringify(bag.items)}`;
    if (!home.take("shelf1")) return "收不回來";
    if (bag.count("key") !== 1 || home.displays.shelf1) return "收回後狀態不對";
    return home.take("shelf1") ? "空位不該收得回東西" : true;
  });

  check("背包沒有的東西擺不上去", () => {
    const { home } = setup({ plank: 1, nail: 1 });
    home.repair("shelf");
    return home.place("shelf2", "goldbone") ? "憑空擺出來了" : true;
  });

  suite("家:存檔");

  check("修理與擺設存下來,重開還在", () => {
    const store = memoryStorage();
    const { home } = setup({ plank: 2, nail: 2, gear: 1 }, store);
    home.repair("table");
    home.place("table1", "gear");
    const again = new HomeState(new Backpack(store), store);
    if (!again.isRepaired("table")) return "修理沒存到";
    return eq(again.displays.table1, "gear");
  });

  check("壞掉或不認得的存檔不會讓遊戲壞掉", () => {
    const broken = new HomeState(new Backpack(memoryStorage()), memoryStorage({ "barkov.home.v1": "{oops" }));
    if (broken.repaired.size) return "壞存檔沒清掉";
    const weird = new HomeState(new Backpack(memoryStorage()), memoryStorage({
      "barkov.home.v1": JSON.stringify({ repaired: ["table", "spaceship"], displays: { table1: "bell", shelf1: "bell", nowhere: "key", table2: "nope" } }),
    }));
    if (weird.repaired.has("spaceship")) return "不認得的站點留著";
    if (weird.displays.shelf1 || weird.displays.nowhere || weird.displays.table2) return `不合法的擺設留著 ${JSON.stringify(weird.displays)}`;
    return eq(weird.displays.table1, "bell");
  });

  suite("家:互動");

  // 只要 Home 用得到的幾個欄位
  const fakePlayer = (x, z, yaw) => ({
    pos: { x: x * HOME_SCALE, z: z * HOME_SCALE },
    root: { rotation: { y: yaw } },
    busy: false,
    dig: null,
    startDig(y, onCancel) { this.dig = { y, onCancel }; return true; },
    endDig(proud) { this.dig = null; this.proud = proud; },
  });
  const fakeView = () => ({ apply() {}, setFocus(pt) { this.focus = pt; }, puff(id) { this.puffed = id; } });

  check("鼻子對著桌子:找到桌子;轉身背對就找不到", () => {
    const { home: state } = setup();
    const p = fakePlayer(1.2, 0.9, Math.PI); // 站在桌子前面(+z),面向 -z
    const h = new Home({ state, view: fakeView(), player: p, picker: { open() {} } });
    h.active = true;
    if (h.findNear()?.station.id !== "table") return `找到 ${h.findNear()?.station.id}`;
    p.root.rotation.y = 0;
    const far = h.findNear();
    h.active = false;
    return far?.station.id === "table" ? "背對還找得到" : true;
  });

  check("按 E 修理:先做動作,時間到才修好並揚起灰塵", () => {
    const { home: state } = setup({ plank: 1, nail: 1 });
    const p = fakePlayer(1.2, 0.9, Math.PI);
    const view = fakeView();
    const h = new Home({ state, view, player: p, picker: { open() {} } });
    h.active = true;
    h.update(1 / 60);
    h.interact();
    if (!p.dig) return "沒有開始動作";
    if (state.isRepaired("table")) return "太早修好";
    for (let i = 0; i < 90; i++) h.update(1 / 60);
    h.active = false;
    if (!state.isRepaired("table")) return "沒修好";
    if (p.proud !== true) return "沒有得意";
    return eq(view.puffed, "table");
  });

  check("修好之後按 E 打開擺設面板;門口按 E 發出 home:leave", () => {
    const { home: state } = setup({ plank: 1, nail: 1 });
    state.repair("table");
    let opened = null, left = false;
    const p = fakePlayer(1.2, 0.9, Math.PI);
    const h = new Home({ state, view: fakeView(), player: p, picker: { open(st) { opened = st.id; } } });
    h.active = true;
    h.update(1 / 60);
    h.interact();
    const off = bus.on("home:leave", () => { left = true; });
    p.pos.x = 4.1 * HOME_SCALE; p.pos.z = 1.1 * HOME_SCALE; p.root.rotation.y = Math.PI / 2;
    h.update(1 / 60);
    h.interact();
    off();
    h.active = false;
    if (opened !== "table") return `面板 ${opened}`;
    return left ? true : "沒有出門";
  });
}
