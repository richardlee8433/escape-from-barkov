import { BAL } from "../src/config/balance.js";
import { RARITIES, TREASURES, byId, rollTier, pickTreasure } from "../src/config/treasures.js";
import { DigGame } from "../src/systems/DigGame.js";
import { Collection } from "../src/systems/Collection.js";
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
}
