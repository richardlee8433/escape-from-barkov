import { BAL } from "../src/config/balance.js";
import { Collision } from "../src/systems/Collision.js";
import { EnemyBrain } from "../src/ai/EnemyBrain.js";
import { suite, check, eq, deterministic } from "./harness.js";

const E = BAL.enemy;

// EnemyBrain 只碰 enemy.pos / enemy.root.rotation.y,用純物件替身就夠
function fakeEnemy(x, z, yaw = 0) {
  return { pos: { x, y: 0, z }, root: { rotation: { y: yaw } } };
}
function makeBrain(enemy, collision) {
  return deterministic(() => new EnemyBrain(enemy, collision));
}
// 讓敵人瞬間面向目標,把「轉身」這個變因排除
function faceToward(enemy, tx, tz) {
  enemy.root.rotation.y = Math.atan2(tx - enemy.pos.x, tz - enemy.pos.z);
}
// 跑到開火為止,回傳經過的秒數;沒開火回傳 null
function runUntilFire(brain, target, maxSteps = 600, dt = 1 / 60) {
  for (let i = 0; i < maxSteps; i++) {
    if (brain.update(dt, target, 1).fire) return (i + 1) * dt;
  }
  return null;
}

export function run() {
  suite("Collision.sightBlocked");

  check("清空的直線不算遮蔽", () => {
    const c = new Collision();
    return eq(c.sightBlocked(0, 0, 10, 0), false);
  });

  check("中間的實心石頭擋住視線", () => {
    const c = new Collision();
    c.addStatic(5, 0, 2);
    return eq(c.sightBlocked(0, 0, 10, 0), true);
  });

  check("線段之外的石頭不擋（不是無限長直線）", () => {
    const c = new Collision();
    c.addStatic(20, 0, 2); // 在 b 點更後面
    return eq(c.sightBlocked(0, 0, 10, 0), false);
  });

  check("柵欄/溝壑不擋視線也不擋子彈", () => {
    const c = new Collision();
    c.addStatic(5, 0, 2.2, { blocksBullets: false });
    return eq(c.sightBlocked(0, 0, 10, 0), false) === true
      ? eq(c.hitStatic(5, 0, 0.2), false)
      : "sightBlocked 應為 false";
  });

  check("擋子彈的物體預設同時擋視線", () => {
    const c = new Collision();
    c.addStatic(5, 0, 2);
    return eq(c.hitStatic(5, 0, 0.2), true);
  });

  suite("EnemyBrain 感知");

  check("正前方無遮蔽 → 看得見", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    faceToward(e, 0, 8);
    return eq(makeBrain(e, c).canSee({ x: 0, y: 0, z: 8 }), true);
  });

  check("正前方有石頭 → 看不見（隔牆偵測已修正）", () => {
    const c = new Collision();
    c.addStatic(0, 4, 2);
    const e = fakeEnemy(0, 0);
    faceToward(e, 0, 8);
    return eq(makeBrain(e, c).canSee({ x: 0, y: 0, z: 8 }), false);
  });

  check("超出 detectDist → 看不見", () => {
    const c = new Collision();
    const far = E.detectDist + 5;
    const e = fakeEnemy(0, 0);
    faceToward(e, 0, far);
    return eq(makeBrain(e, c).canSee({ x: 0, y: 0, z: far }), false);
  });

  check("背對玩家 → 視錐外,看不見", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0, Math.PI); // 面向 -z
    return eq(makeBrain(e, c).canSee({ x: 0, y: 0, z: 8 }), false);
  });

  suite("EnemyBrain 開火閘門");

  check("開火前一定有 windup 前搖,不會冷卻一到就打", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: 6 };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.fireCd = 0;
    const t = runUntilFire(brain, target);
    if (t === null) return "從未開火";
    return t >= E.windupTime ? true : `開火過早：${t.toFixed(3)}s < windup ${E.windupTime}s`;
  });

  check("進入 windup 時會發出預告事件", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: 6 };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.fireCd = 0;
    let fired = false;
    const off = window.__bus.on("enemy:windup", () => (fired = true));
    for (let i = 0; i < 10 && !fired; i++) brain.update(1 / 60, target, 1);
    off();
    return eq(fired, true);
  });

  check("前搖中視線被切斷 → 中止開火", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: 6 };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.fireCd = 0;
    brain.update(1 / 60, target, 1); // 進入 windup
    if (brain.state !== "windup") return `預期 windup,實際 ${brain.state}`;
    c.addStatic(0, 3, 2); // 玩家躲到掩體後
    const t = runUntilFire(brain, target, 120);
    return t === null ? eq(brain.state, "chase") : `視線已斷仍然開火於 ${t}s`;
  });

  check("隔著石頭全程不開火", () => {
    const c = new Collision();
    c.addStatic(0, 3, 2);
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: 6 };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.fireCd = 0;
    return eq(runUntilFire(brain, target, 300), null);
  });

  check("沒對準目標時不會舉槍（杜絕瞬間轉身開槍）", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0, 0); // 面向 +z
    const target = { x: 6, y: 0, z: 0 }; // 正右方,偏 90°
    const brain = makeBrain(e, c);
    brain.fireCd = 0;
    brain.update(1 / 60, target, 1);
    return eq(brain.state === "windup", false);
  });

  check("射程內才開火,超出射程只會接近", () => {
    const c = new Collision();
    const far = E.fireRange + 4;
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: far };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.fireCd = 0;
    const intent = brain.update(1 / 60, target, 1);
    if (intent.fire) return "超出射程卻開火";
    return intent.move ? true : "超出射程應該要接近玩家";
  });

  check("開火距離不超過畫面下緣（離屏攻擊防護）", () => {
    // 相機 pitch 40° / 距離 30 / 垂直 FOV 38° → 玩家前方可見約 11.4 單位
    const camH = 30 * Math.sin((40 * Math.PI) / 180);
    const nearEdge = camH / Math.tan(((40 + 19) * Math.PI) / 180);
    const visibleAhead = 30 * Math.cos((40 * Math.PI) / 180) - nearEdge;
    return E.fireRange <= visibleAhead
      ? true
      : `fireRange ${E.fireRange} 超過可見範圍 ${visibleAhead.toFixed(1)}`;
  });

  suite("EnemyBrain 狀態轉移");

  check("看見玩家 → 從 patrol 轉為 chase", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: 8 };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.update(1 / 60, target, 1);
    return eq(brain.state, "chase");
  });

  check("失去視線超過 loseSightTime → 轉為 search", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: 8 };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.update(1 / 60, target, 1);
    c.addStatic(0, 4, 2);
    const steps = Math.ceil((E.loseSightTime + 0.3) * 60);
    for (let i = 0; i < steps; i++) brain.update(1 / 60, target, 1);
    return eq(brain.state, "search");
  });

  check("search 走到最後已知位置後回到 patrol", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const brain = makeBrain(e, c);
    brain.state = "search";
    brain.lastKnown.set(0, 0, 0); // 已經站在最後已知位置上
    brain.update(1 / 60, { x: 0, y: 0, z: 60 }, 1);
    return eq(brain.state, "patrol");
  });
}
