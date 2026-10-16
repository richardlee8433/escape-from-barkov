import * as THREE from "three";
import { BAL } from "../src/config/balance.js";
import { Collision } from "../src/systems/Collision.js";
import { Combat } from "../src/systems/Combat.js";
import { Backpack, BAG_SLOTS } from "../src/systems/Backpack.js";
import { TREASURES, byId } from "../src/config/treasures.js";
import { Bark } from "../src/systems/Bark.js";
import { Inventory } from "../src/systems/Inventory.js";
import { suite, check, eq } from "./harness.js";

// 柯基沒有血量也沒有武器:鴨子啄到只會推開一步、讓背包掉出一件東西。
export async function load() {}

function fakeEnemy(x, z) {
  return { pos: new THREE.Vector3(x, 0, z) };
}
function fakePlayer(x = 0, z = 0) {
  return { alive: true, radius: BAL.player.radius, pos: new THREE.Vector3(x, 0, z) };
}
// 收集事件，回傳 [事件陣列, 取消訂閱]
function capture(names) {
  const got = [];
  const offs = names.map((n) => window.__bus.on(n, (p) => got.push({ name: n, p })));
  return [got, () => offs.forEach((f) => f())];
}
function memoryStorage(init = {}) {
  const data = { ...init };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

export function run() {
  suite("鴨子啄擊(沒有血量)");

  check("啄中:發出 combat:hit 與 player:pecked,來向指回鴨子", () => {
    const c = new Combat(new Collision());
    const p = fakePlayer(0, 0);
    const [got, off] = capture(["combat:hit", "player:pecked"]);
    c.peck(fakeEnemy(0, 1.5), p);
    off();
    const pecked = got.find((g) => g.name === "player:pecked");
    if (!got.some((g) => g.name === "combat:hit")) return "沒有 combat:hit";
    if (!pecked) return "沒有 player:pecked";
    return pecked.p.fromZ > 0.99 ? true : `來向應指向鴨子(+z),實際 ${pecked.p.fromZ.toFixed(2)}`;
  });

  check("被啄會退一步,但不會被推進石頭裡", () => {
    const col = new Collision();
    col.addStatic(0, -1.2, 0.6); // 柯基身後就是石頭
    const c = new Combat(col);
    const p = fakePlayer(0, 0);
    c.peck(fakeEnemy(0, 1.5), p);
    const pen = col.penetration(p.pos.x, p.pos.z, p.radius);
    if (pen > 0.02) return `被推進石頭 ${pen.toFixed(3)}`;
    return p.pos.z < 0 ? true : "沒有被往後推";
  });

  check("被啄不會讓柯基倒下(沒有血量)", () => {
    const c = new Combat(new Collision());
    const p = fakePlayer(0, 0);
    for (let i = 0; i < 50; i++) c.peck(fakeEnemy(0, 1.5), p);
    return p.alive === true && p.hp === undefined;
  });

  suite("難度");

  check("鴨子隨時間變快,但有上限", () => {
    const c = new Combat(new Collision());
    const d0 = c.difficulty();
    c.update(BAL.difficulty.timeToDouble);
    const d1 = c.difficulty();
    c.update(1e6);
    if (!(d1 > d0)) return `沒有變難 ${d0} → ${d1}`;
    return eq(c.difficulty(), BAL.difficulty.cap, 1e-9);
  });

  suite("背包");

  check("挖到的東西放進背包,同一種疊在一起", () => {
    const b = new Backpack(memoryStorage());
    b.add("bell");
    b.add("bell");
    b.add("pebble");
    if (b.count("bell") !== 2) return `bell=${b.count("bell")}`;
    return b.total === 3 && b.kinds === 2;
  });

  check("背包依稀有度排序(稀有的在前面)", () => {
    const b = new Backpack(memoryStorage());
    ["pebble", "goldbone", "shell", "photo"].forEach((id) => b.add(id));
    const tiers = b.list().map((e) => e.treasure.tier);
    for (let i = 1; i < tiers.length; i++) if (tiers[i] > tiers[i - 1]) return `順序 ${tiers}`;
    return true;
  });

  check("格子夠放所有種類的寶物", () => BAG_SLOTS >= TREASURES.length);

  check("不認得的東西放不進背包", () => {
    const b = new Backpack(memoryStorage());
    return b.add("laser-gun") === false && b.total === 0;
  });

  check("背包存在瀏覽器裡,下次開還在;壞掉的存檔當成空背包", () => {
    const st = memoryStorage();
    const a = new Backpack(st);
    a.add("key");
    a.add("key");
    if (new Backpack(st).count("key") !== 2) return "沒存到";
    const broken = new Backpack(memoryStorage({ "barkov.backpack.v1": "{oops" }));
    const weird = new Backpack(memoryStorage({ "barkov.backpack.v1": JSON.stringify({ nope: 3, bell: "x", gear: 2 }) }));
    return broken.total === 0 && weird.total === 2 && weird.count("gear") === 2;
  });

  check("被啄時背包空的:什麼都不掉", () => {
    const b = new Backpack(memoryStorage());
    return b.dropRandom(1, 1) === null && b.ground.length === 0;
  });

  check("被啄時掉一件到地上,背包少一件", () => {
    const b = new Backpack(memoryStorage(), () => 0.5);
    b.add("bell");
    b.add("pebble");
    const [got, off] = capture(["backpack:dropped"]);
    const item = b.dropRandom(3, 4);
    off();
    if (!item) return "沒有掉";
    if (b.total !== 1) return `背包剩 ${b.total}`;
    if (b.ground.length !== 1 || b.ground[0].x !== 3) return "地上沒有東西";
    return eq(got.length, 1);
  });

  check("越普通的東西越容易被啄掉", () => {
    let i = 0;
    const N = 2000;
    const rng = () => ((i++ % N) + 0.5) / N;
    let common = 0;
    for (let k = 0; k < N; k++) {
      const b = new Backpack(memoryStorage(), rng);
      b.add("pebble");
      b.add("goldbone");
      if (b.dropRandom(0, 0).id === "pebble") common++;
    }
    return common > N * 0.9 ? true : `普通的只掉了 ${common}/${N}`;
  });

  check("按 E 撿回來:回到背包、地上消失", () => {
    const b = new Backpack(memoryStorage(), () => 0);
    b.add("shell");
    const item = b.dropRandom(2, 0);
    if (b.nearestGround({ x: 0, z: 0 }, 1.5)) return "太遠也撿得到";
    const near = b.nearestGround({ x: 1.5, z: 0 }, BAL.items.pickupRange);
    if (near !== item) return "撿不到旁邊的東西";
    b.pickup(near);
    return b.count("shell") === 1 && b.ground.length === 0 && byId.shell.tier === 1;
  });

  suite("吠叫與撿東西");

  // Bark / Inventory 用得到的柯基欄位
  const corgi = (x = 0, z = 0, yaw = 0) => ({
    alive: true, dig: null, sniff: null, barking: 0, pos: new THREE.Vector3(x, 0, z), root: { rotation: { y: yaw } },
    startBark() { if (this.barking > 0) return false; this.barking = 1; return true; },
  });
  const duck = (x, z) => {
    const e = { pos: new THREE.Vector3(x, 0, z), scaredFrom: null };
    e.brain = { scare: (fx, fz) => { e.scaredFrom = [fx, fz]; } };
    return e;
  };

  check("吠一聲:範圍內的鴨子被嚇到,範圍外的不受影響", () => {
    const p = corgi();
    const near = duck(BAL.bark.radius - 1, 0), far = duck(BAL.bark.radius + 2, 0);
    const [got, off] = capture(["bark"]);
    const ok = new Bark(p, () => [near, far]).bark();
    off();
    if (!ok) return "沒吠出來";
    if (!near.scaredFrom || far.scaredFrom) return "嚇到的鴨子不對";
    return eq(got[0]?.p.scared.length, 1);
  });

  check("冷卻中不能再吠;冷卻結束就可以", () => {
    const p = corgi();
    const b = new Bark(p, () => []);
    b.bark();
    p.barking = 0;
    const [got, off] = capture(["bark:cooldown"]);
    if (b.bark()) return "冷卻中還能吠";
    off();
    if (got.length !== 1) return "沒有提示冷卻中";
    for (let i = 0; i < Math.ceil(BAL.bark.cooldown * 60) + 1; i++) b.update(1 / 60);
    return b.bark() ? true : "冷卻結束了還不能吠";
  });

  check("鼻尖碰得到也算:身體離太遠、鼻子夠近就能按 E 撿", () => {
    const bag = new Backpack(memoryStorage());
    const item = { id: "bell", x: 0, z: BAL.items.pickupRange + 0.6 };
    bag.ground.push(item);
    const inv = new Inventory(corgi(0, 0, 0), bag, null); // 面向 +z
    if (inv.nearestGround(BAL.items.pickupRange) !== item) return "鼻子前面的東西撿不到";
    const back = new Inventory(corgi(0, 0, Math.PI), bag, null); // 背對
    return back.nearestGround(BAL.items.pickupRange) ? "背對太遠還撿得到" : true;
  });

  check("走過去碰到就自動撿起來(剛掉出來的要等落地)", () => {
    const bag = new Backpack(memoryStorage());
    const item = { id: "shell", x: 0.3, z: 0.2 };
    bag.ground.push(item);
    const inv = new Inventory(corgi(), bag, null);
    inv.update(BAL.items.touchDelay * 0.5);
    if (bag.ground.length !== 1) return "還沒落地就被撿走";
    inv.update(BAL.items.touchDelay);
    if (bag.ground.length !== 0 || bag.count("shell") !== 1) return "碰到了沒撿起來";
    inv.enabled = false;
    bag.ground.push({ id: "bell", x: 0, z: 0, age: 5 });
    inv.update(1 / 60);
    return bag.ground.length === 1 ? true : "在家裡(停用)時不該撿";
  });
}
