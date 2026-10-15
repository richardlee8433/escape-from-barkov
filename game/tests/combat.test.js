import * as THREE from "three";
import { BAL } from "../src/config/balance.js";
import { Collision } from "../src/systems/Collision.js";
import { suite, check, eq } from "./harness.js";

const B = BAL.bullet;

// Combat 的建構子要載入子彈模型，測試裡改用真正的 Combat 原型 + 假模板，
// 避開資源載入，但保留完整的命中／傷害／事件邏輯。
let Combat;
export async function load() {
  ({ Combat } = await import("../src/systems/Combat.js"));
}

function makeCombat(collision) {
  const scene = new THREE.Scene();
  const c = Object.create(Combat.prototype);
  c.scene = scene;
  c.collision = collision || new Collision();
  c.bullets = [];
  c.kills = 0;
  c.time = 0;
  c.playerCd = 0;
  const tmpl = new THREE.Group();
  c.tmplPlayer = tmpl;
  c.tmplEnemy = tmpl;
  return c;
}
function fakeEnemy(x, z, hp = BAL.enemy.hp) {
  return {
    hp, hitR: 1, pos: new THREE.Vector3(x, 0, z),
    knockback() {}, dispose() {},
  };
}
function fakePlayer(x = 0, z = 0) {
  return {
    alive: true, hp: 100, ammo: 30, loot: 0, radius: BAL.player.radius,
    pos: new THREE.Vector3(x, 0, z),
    damageEvents: [],
    takeDamage(v, fx, fz) { this.hp -= v; this.damageEvents.push({ v, fx, fz }); if (this.hp <= 0) this.alive = false; },
    emitStats() {},
  };
}
// 收集事件，回傳 [事件陣列, 取消訂閱]
function capture(names) {
  const got = [];
  const offs = names.map((n) => window.__bus.on(n, (p) => got.push({ name: n, p })));
  return [got, () => offs.forEach((f) => f())];
}

export function run() {
  suite("子彈事件");

  check("敵人開火會發出 bullet:fired", () => {
    const c = makeCombat();
    const [got, off] = capture(["bullet:fired"]);
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    off();
    return got.length === 1 && got[0].p.owner === "enemy" ? true : JSON.stringify(got);
  });

  check("玩家開火會扣彈藥並發出 bullet:fired", () => {
    const c = makeCombat();
    const p = fakePlayer();
    const [got, off] = capture(["bullet:fired"]);
    c.firePlayer(p, new THREE.Vector3(0, 0, 10));
    off();
    return got.length === 1 && p.ammo === 29 ? true : `events=${got.length} ammo=${p.ammo}`;
  });

  check("射速冷卻：連續點擊只會打出一發", () => {
    const c = makeCombat();
    const p = fakePlayer();
    for (let i = 0; i < 10; i++) c.firePlayer(p, new THREE.Vector3(0, 0, 10));
    return eq(c.bullets.length, 1);
  });

  check("冷卻結束後可以再開火", () => {
    const c = makeCombat();
    const p = fakePlayer();
    c.firePlayer(p, new THREE.Vector3(0, 0, 10));
    c.update(BAL.player.fireCd + 0.01, [], p);
    c.firePlayer(p, new THREE.Vector3(0, 0, 10));
    return eq(c.bullets.length, 2);
  });

  check("沒彈藥就不會產生子彈", () => {
    const c = makeCombat();
    const p = fakePlayer();
    p.ammo = 0;
    c.firePlayer(p, new THREE.Vector3(0, 0, 10));
    return eq(c.bullets.length, 0);
  });

  suite("命中結算");

  check("擊中敵人會扣血並發出 combat:hit", () => {
    const c = makeCombat();
    const en = fakeEnemy(0, 5);
    const p = fakePlayer();
    const [got, off] = capture(["combat:hit", "enemy:hurt"]);
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    c.bullets[0].owner = "player";
    c.bullets[0].mesh.position.set(0, 1, 4.5);
    c.update(0.001, [en], p);
    off();
    const hit = got.find((g) => g.name === "combat:hit");
    if (!hit) return "沒有 combat:hit";
    return hit.p.targetType === "enemy" && en.hp === BAL.enemy.hp - B.damage
      ? true
      : `targetType=${hit.p.targetType} hp=${en.hp}`;
  });

  check("一顆子彈只結算一次（不會同時打中兩個敵人）", () => {
    const c = makeCombat();
    const p = fakePlayer();
    const a = fakeEnemy(0, 5), b = fakeEnemy(0.2, 5);
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    c.bullets[0].owner = "player";
    c.bullets[0].mesh.position.set(0.1, 1, 4.9);
    c.update(0.001, [a, b], p);
    const damaged = [a, b].filter((e) => e.hp < BAL.enemy.hp).length;
    return eq(damaged, 1);
  });

  check("致命一擊會發出 enemy:died 而不是 enemy:hurt", () => {
    const c = makeCombat();
    const p = fakePlayer();
    const en = fakeEnemy(0, 5, B.damage); // 剛好一發致死
    const list = [en];
    const [got, off] = capture(["enemy:died", "enemy:hurt"]);
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    c.bullets[0].owner = "player";
    c.bullets[0].mesh.position.set(0, 1, 4.5);
    c.update(0.001, list, p);
    off();
    const names = got.map((g) => g.name);
    return names.length === 1 && names[0] === "enemy:died" && list.length === 0
      ? true
      : `events=${names} remaining=${list.length}`;
  });

  check("死亡事件帶著敵人當時的位置", () => {
    const c = makeCombat();
    const p = fakePlayer();
    const en = fakeEnemy(3, 5, B.damage);
    const [got, off] = capture(["enemy:died"]);
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    c.bullets[0].owner = "player";
    c.bullets[0].mesh.position.set(3, 1, 4.5);
    c.update(0.001, [en], p);
    off();
    const d = got[0] && got[0].p;
    return d && d.x === 3 && d.z === 5 ? true : JSON.stringify(d);
  });

  suite("玩家受擊與傷害方向");

  check("敵人子彈命中玩家會造成傷害", () => {
    const c = makeCombat();
    const p = fakePlayer(0, 0);
    c.fireEnemy(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1));
    c.bullets[0].mesh.position.set(0, 1, 0.4);
    c.update(0.001, [], p);
    return eq(p.hp, 100 - B.damage);
  });

  check("傷害方向指回射擊者", () => {
    const c = makeCombat();
    const p = fakePlayer(0, 0);
    // 子彈從 +z 往 -z 飛，來向應該是 +z
    c.fireEnemy(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1));
    c.bullets[0].mesh.position.set(0, 1, 0.4);
    c.update(0.001, [], p);
    const e = p.damageEvents[0];
    return e && Math.abs(e.fz - 1) < 1e-6 && Math.abs(e.fx) < 1e-6
      ? true
      : `fromX=${e && e.fx} fromZ=${e && e.fz}`;
  });

  check("玩家的子彈不會打到玩家自己", () => {
    const c = makeCombat();
    const p = fakePlayer(0, 0);
    c.firePlayer(p, new THREE.Vector3(0, 0, 10));
    c.bullets[0].mesh.position.set(0, 1, 0);
    c.update(0.001, [], p);
    return eq(p.hp, 100);
  });

  suite("子彈生命週期");

  check("打到擋子彈的靜態物會消失,且不造成傷害", () => {
    const col = new Collision();
    col.addStatic(0, 3, 1);
    const c = makeCombat(col);
    const p = fakePlayer();
    const en = fakeEnemy(0, 5);
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    c.bullets[0].owner = "player";
    c.bullets[0].mesh.position.set(0, 1, 3);
    c.update(0.001, [en], p);
    return c.bullets.length === 0 && en.hp === BAL.enemy.hp
      ? true
      : `bullets=${c.bullets.length} hp=${en.hp}`;
  });

  check("超過最大射程會自行消失", () => {
    const c = makeCombat();
    const p = fakePlayer();
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    c.bullets[0].traveled = B.maxDist + 1;
    c.update(0.001, [], p);
    return eq(c.bullets.length, 0);
  });

  check("命中後子彈會從場景移除,不會殘留", () => {
    const c = makeCombat();
    const p = fakePlayer();
    const en = fakeEnemy(0, 5);
    c.fireEnemy(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    c.bullets[0].owner = "player";
    const mesh = c.bullets[0].mesh;
    mesh.position.set(0, 1, 4.5);
    c.update(0.001, [en], p);
    return c.bullets.length === 0 && mesh.parent === null
      ? true
      : `bullets=${c.bullets.length} stillInScene=${mesh.parent !== null}`;
  });

  suite("鴨子啄擊");

  check("啄中:扣血、發出 combat:hit,傷害來向指回鴨子", () => {
    const c = makeCombat();
    const p = fakePlayer(0, 0);
    const duck = fakeEnemy(0, 1.5);
    const [got, off] = capture(["combat:hit"]);
    c.peck(duck, p);
    off();
    if (p.hp !== 100 - BAL.enemy.peckDamage) return `hp=${p.hp}`;
    const ev = p.damageEvents[0];
    if (!(ev.fz > 0.99)) return `來向應指向鴨子(+z),實際 (${ev.fx.toFixed(2)}, ${ev.fz.toFixed(2)})`;
    return eq(got.length, 1);
  });

  check("被啄會退一步,但不會被推進石頭裡", () => {
    const col = new Collision();
    col.addStatic(0, -1.2, 0.6); // 柯基身後就是石頭
    const c = makeCombat(col);
    const p = fakePlayer(0, 0);
    c.peck(fakeEnemy(0, 1.5), p);
    const pen = col.penetration(p.pos.x, p.pos.z, p.radius);
    if (pen > 0.02) return `被推進石頭 ${pen.toFixed(3)}`;
    return p.pos.z < 0 ? true : "沒有被往後推";
  });

  check("柯基已經倒下就不會再被啄", () => {
    const c = makeCombat();
    const p = fakePlayer(0, 0);
    p.alive = false;
    c.peck(fakeEnemy(0, 1.5), p);
    return eq(p.hp, 100);
  });
}
