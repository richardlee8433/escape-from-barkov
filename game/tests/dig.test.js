import { BAL } from "../src/config/balance.js";
import { RARITIES, TREASURES, byId, rollTier, pickTreasure } from "../src/config/treasures.js";
import { DigGame } from "../src/systems/DigGame.js";
import { Collection } from "../src/systems/Collection.js";
import { DigSpots, SCENTS, scentAt, DIG_AHEAD } from "../src/systems/DigSpots.js";
import { bus } from "../src/core/EventBus.js";
import { setIconText } from "../src/ui/icons.js";
import { suite, check, eq } from "./harness.js";

// 把指針直接放到某個位置再按(測判定,不靠時間)
function pressAt(g, pos) {
  g.pos = pos;
  return g.press();
}

// 假的 localStorage
function memoryStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

export function run() {
  suite("寶物與稀有度");

  check("每個稀有度都至少有一件寶物", () => {
    for (let i = 0; i < RARITIES.length; i++) {
      if (!TREASURES.some((t) => t.tier === i)) return `稀有度 ${RARITIES[i].id} 沒有寶物`;
    }
  });

  check("寶物 id 不重複(存檔靠它)", () => eq(Object.keys(byId).length, TREASURES.length));

  check("骰到最低是普通、骰到最高是傳說", () => {
    if (rollTier(() => 0) !== 0) return "rng 0 不是普通";
    return eq(rollTier(() => 0.9999), RARITIES.length - 1);
  });

  check("稀有度的機率照權重:普通最常見、傳說最少", () => {
    const counts = RARITIES.map(() => 0);
    const N = 10000;
    for (let i = 0; i < N; i++) counts[rollTier(() => (i + 0.5) / N)]++;
    const total = RARITIES.reduce((s, r) => s + r.weight, 0);
    for (let i = 0; i < RARITIES.length; i++) {
      const want = (RARITIES[i].weight / total) * N;
      if (Math.abs(counts[i] - want) > 2) return `${RARITIES[i].id}: ${counts[i]} ≠ ${want}`;
    }
    for (let i = 1; i < counts.length; i++) if (counts[i] >= counts[i - 1]) return "越稀有應該越少見";
  });

  check("pickTreasure 只挑該稀有度的寶物", () => {
    for (let tier = 0; tier < RARITIES.length; tier++) {
      for (const r of [0, 0.5, 0.9999]) {
        if (pickTreasure(tier, () => r).tier !== tier) return `tier ${tier} 挑錯`;
      }
    }
  });

  suite("挖掘小遊戲");

  check("指針在長條兩端反彈,永遠不會跑出去(大 dt 也一樣)", () => {
    const g = new DigGame(4, () => 0.5);
    for (let i = 0; i < 300; i++) {
      g.update(i % 7 === 0 ? 0.9 : 1 / 60);
      if (g.pos < 0 || g.pos > 1) return `pos=${g.pos}`;
    }
  });

  check("按在綠區正中央 = 完美,綠區邊緣 = 普通,綠區外 = 失手", () => {
    const g = new DigGame(0, () => 0.5);
    const c = g.center;
    if (pressAt(g, c) !== "perfect") return "正中央不是 perfect";
    const c2 = g.center;
    if (pressAt(g, c2 + g.half * 0.9) !== "good") return "邊緣不是 good";
    const c3 = g.center;
    return eq(pressAt(g, c3 > 0.5 ? 0 : 1), "miss");
  });

  check("挖滿層數就挖到,每層都完美才算完美挖掘", () => {
    const g = new DigGame(1, () => 0.3);
    for (let i = 0; i < g.need; i++) pressAt(g, g.center);
    if (!g.done || !g.success) return "沒有挖到";
    if (!g.perfect) return "全部完美卻不算完美";
    const h = new DigGame(1, () => 0.3);
    pressAt(h, h.center + h.half * 0.9);
    while (!h.done) pressAt(h, h.center);
    if (!h.success || h.perfect) return "有一層普通卻算完美";
    const m = new DigGame(1, () => 0.3);
    pressAt(m, m.center > 0.5 ? 0 : 1);
    while (!m.done) pressAt(m, m.center);
    return m.success && !m.perfect ? true : "失手過卻算完美";
  });

  check("失手 maxMiss 次就結束、沒挖到", () => {
    const g = new DigGame(2, () => 0.5);
    for (let i = 0; i < BAL.dig.maxMiss; i++) pressAt(g, g.center > 0.5 ? 0 : 1);
    if (!g.done) return "沒有結束";
    if (g.success) return "失手卻挖到";
    return eq(g.press(), null);
  });

  check("每挖一層,綠區換到離指針夠遠的地方(不能原地連按)", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const g = new DigGame(0, () => r);
      pressAt(g, g.center);
      if (Math.abs(g.center - g.pos) < 0.2) return `rng=${r}: 新綠區離指針 ${Math.abs(g.center - g.pos).toFixed(2)}`;
    }
  });

  check("綠區(含飄動)永遠整段在長條內", () => {
    const g = new DigGame(4, () => 0.99);
    for (let i = 0; i < 600; i++) {
      g.update(1 / 60);
      if (g.center - g.half < -1e-9 || g.center + g.half > 1 + 1e-9) return `center=${g.center}`;
    }
  });

  check("越稀有越難:層數不減、指針更快、綠區更窄", () => {
    for (let t = 1; t < RARITIES.length; t++) {
      const a = new DigGame(t - 1), b = new DigGame(t);
      if (b.need < a.need || b.speed <= a.speed || b.half >= a.half) return `tier ${t} 沒有比 ${t - 1} 難`;
    }
  });

  suite("寶物圖鑑存檔");

  check("第一次挖到是 NEW,第二次不是,次數會累加", () => {
    const col = new Collection(memoryStorage());
    if (!col.add("bell").isNew) return "第一次不是 new";
    if (col.add("bell").isNew) return "第二次還是 new";
    return eq(col.get("bell").count, 2);
  });

  check("完美挖掘的星星記一次就一直在", () => {
    const col = new Collection(memoryStorage());
    col.add("shell", true);
    col.add("shell", false);
    return col.get("shell").perfect === true;
  });

  check("存檔讀回來還在(下次開遊戲)", () => {
    const st = memoryStorage();
    const a = new Collection(st);
    a.add("photo", true);
    a.add("pebble");
    const b = new Collection(st);
    if (b.found !== 2) return `found=${b.found}`;
    return b.get("photo").perfect === true;
  });

  check("壞掉的存檔、沒有 storage、存不進去,都不會讓遊戲壞掉", () => {
    const broken = new Collection(memoryStorage({ "barkov.collection.v1": "{not json" }));
    if (broken.found !== 0) return "壞存檔沒有當成空的";
    const weird = new Collection(memoryStorage({ "barkov.collection.v1": JSON.stringify({ nope: { count: 3 }, bell: { count: "x" }, key: { count: 2 } }) }));
    if (weird.found !== 1 || !weird.get("key")) return "沒有過濾掉不認得的項目";
    const none = new Collection(null);
    none.add("bell");
    const full = new Collection({ getItem: () => null, setItem: () => { throw new Error("quota"); } });
    full.add("bell");
    return eq(full.found, 1);
  });

  check("不認得的寶物 id 不會被記進圖鑑", () => {
    const col = new Collection(memoryStorage());
    col.add("not-a-thing");
    return eq(col.found, 0);
  });

  suite("嗅聞找寶");

  // 一片空地、一個寶物,柯基站在 (0, 0) 面向 +z
  function field(spotX, spotZ) {
    const ds = Object.create(DigSpots.prototype);
    ds.collection = new Collection(memoryStorage());
    ds.spots = [{ x: spotX, z: spotZ, tier: 0, found: false, holed: false }];
    ds.respawns = [];
    ds.active = null;
    ds.nearby = false;
    return ds;
  }
  function corgi(x = 0, z = 0) {
    return {
      pos: { x, z }, alive: true, busy: false, root: { rotation: { y: 0 } },
      startSniff(cb) { cb(); return true; }, startDig() { return true; }, endDig() {},
    };
  }
  function sniffOnce(ds, p) {
    let got = null;
    const off = bus.on("sniff:result", (e) => (got = e));
    ds.sniff(p);
    off();
    return got;
  }

  check("氣味由近到遠:就在這裡 → 熱 → 溫 → 微弱 → 冷", () => {
    const ids = [0.5, BAL.items.digRange + 0.1, 10, 20, 60].map((d) => scentAt(d).id);
    return eq(ids.join(","), "here,hot,warm,faint,cold");
  });

  check("氣味的距離門檻由近到遠排好,最後一級涵蓋無限遠", () => {
    for (let i = 1; i < SCENTS.length; i++) if (SCENTS[i].max <= SCENTS[i - 1].max) return `第 ${i} 級門檻沒有變大`;
    return SCENTS.at(-1).max === Infinity;
  });

  check("嗅聞回報最近寶物的方向與距離", () => {
    const r = sniffOnce(field(0, 10), corgi());
    if (!r) return "沒有結果";
    if (Math.abs(r.dist - 10) > 1e-6) return `dist=${r.dist}`;
    return r.dirZ > 0.99 && r.scent.id === "warm" ? true : `dir=(${r.dirX},${r.dirZ}) ${r.scent.id}`;
  });

  check("寶物看不到:沒聞到之前按 E 也挖不到", () => {
    const ds = field(0, 1);
    return ds.nearest({ x: 0, z: 0 }, 3) === null;
  });

  check("聞到「就在這裡」之後才挖得到", () => {
    const ds = field(0, 1.5);
    sniffOnce(ds, corgi());
    return ds.nearest({ x: 0, z: 0 }, 3) === ds.spots[0];
  });

  check("離得遠時聞了也不會標記成找到", () => {
    const ds = field(0, 8);
    sniffOnce(ds, corgi());
    return ds.spots[0].found === false;
  });

  check("洞開在柯基鼻子前面(不是埋寶的精確位置)", () => {
    const ds = field(0.8, 1.6);
    const p = corgi();
    sniffOnce(ds, p);
    ds.dig(ds.spots[0], p);
    const s = ds.spots[0];
    ds.cancel("test");
    return Math.abs(s.x) < 1e-6 && Math.abs(s.z - DIG_AHEAD) < 1e-6 ? true : `(${s.x}, ${s.z})`;
  });

  check("中斷之後再挖,還是同一個洞", () => {
    const ds = field(0, 1.5);
    const p = corgi();
    sniffOnce(ds, p);
    ds.dig(ds.spots[0], p);
    ds.cancel("moved");
    const s = ds.spots[0];
    const before = [s.x, s.z];
    p.pos.x = 0.5;
    ds.dig(s, p);
    ds.cancel("moved");
    return s.x === before[0] && s.z === before[1];
  });

  suite("介面圖示");

  check("挖到普通材料一次給兩個(修房子要用很多),稀有的給一個;失手只給一個", () => {
    const got = [];
    const off = bus.on("dig:found", (e) => got.push(e.qty));
    for (const [tier, success] of [[0, true], [2, true], [3, false]]) {
      const ds = field(0, 0);
      ds.spots[0].tier = tier;
      ds.active = { spot: ds.spots[0], game: { success, perfect: false }, player: corgi() };
      ds._finish();
    }
    off();
    return eq(got.join(","), "2,1,1");
  });

  check(":nose: 換成黑色狗鼻子的 SVG,其餘文字照原樣", () => {
    const el = document.createElement("div");
    setIconText(el, ":nose: Warm — getting closer");
    if (!el.querySelector("svg.icon-nose")) return "沒有狗鼻子圖示";
    return eq(el.textContent.trim(), "Warm — getting closer");
  });

  check("文字裡的 HTML 不會被解析(不會被插入元素)", () => {
    const el = document.createElement("div");
    setIconText(el, "<img src=x onerror=alert(1)> :nose:");
    if (el.querySelector("img")) return "插入了 img";
    return el.querySelectorAll("svg").length === 1;
  });
}
