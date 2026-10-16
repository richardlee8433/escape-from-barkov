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
// 跑到出手(啄擊)為止,回傳經過的秒數;沒出手回傳 null
function runUntilAttack(brain, target, maxSteps = 600, dt = 1 / 60) {
  for (let i = 0; i < maxSteps; i++) {
    if (brain.update(dt, target, 1).attack) return (i + 1) * dt;
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

  suite("EnemyBrain 啄擊閘門(鴨子不拿槍,追到身邊才啄)");

  // 柯基就在嘴邊(攻擊距離內)
  const close = () => ({ x: 0, y: 0, z: E.attackRange * 0.8 });

  check("出手前一定有 windup 前搖,不會一貼身就啄", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = close();
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    const t = runUntilAttack(brain, target);
    if (t === null) return "從未出手";
    return t >= E.windupTime ? true : `出手過早：${t.toFixed(3)}s < windup ${E.windupTime}s`;
  });

  check("進入 windup 時會發出預告事件", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = close();
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    let fired = false;
    const off = window.__bus.on("enemy:windup", () => (fired = true));
    for (let i = 0; i < 10 && !fired; i++) brain.update(1 / 60, target, 1);
    off();
    return eq(fired, true);
  });

  check("前搖中柯基跑出範圍 → 這一啄落空", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = close();
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    brain.update(1 / 60, target, 1); // 進入 windup
    if (brain.state !== "windup") return `預期 windup,實際 ${brain.state}`;
    const fled = { x: 0, y: 0, z: E.peckReach + 1.5 }; // 前搖中逃開(仍在視野內)
    let missed = false;
    const off = window.__bus.on("enemy:attackMiss", () => (missed = true));
    const t = runUntilAttack(brain, fled, Math.ceil(E.windupTime * 60) + 2);
    off();
    if (t !== null) return `已經逃開仍被啄中(${t.toFixed(2)}s)`;
    return eq(missed, true);
  });

  check("前搖中視線被切斷 → 中止啄擊", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = close();
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    brain.update(1 / 60, target, 1); // 進入 windup
    if (brain.state !== "windup") return `預期 windup,實際 ${brain.state}`;
    c.addStatic(0, target.z / 2, 0.5); // 中間冒出掩體
    const t = runUntilAttack(brain, target, 120);
    return t === null ? eq(brain.state, "chase") : `視線已斷仍然啄中於 ${t}s`;
  });

  check("隔著石頭全程不出手", () => {
    const c = new Collision();
    c.addStatic(0, 0.8, 0.5);
    const e = fakeEnemy(0, 0);
    const target = close();
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    return eq(runUntilAttack(brain, target, 300), null);
  });

  check("沒對準目標時不會出手（杜絕瞬間轉身就啄）", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0, 0); // 面向 +z
    const target = { x: E.attackRange * 0.8, y: 0, z: 0 }; // 正右方,偏 90°
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    brain.update(1 / 60, target, 1);
    return eq(brain.state === "windup", false);
  });

  check("距離外不出手,而是一路追過去(不會停在遠處)", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = { x: 0, y: 0, z: 6 };
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    // 模擬移動:每一步照意圖前進
    for (let i = 0; i < 120; i++) {
      const intent = brain.update(1 / 60, target, 1);
      if (intent.attack) return "還沒追到就啄中";
      if (intent.move) { e.pos.x += intent.move.x / 60; e.pos.z += intent.move.z / 60; }
      if (brain.state === "windup") break;
    }
    const d = Math.hypot(target.x - e.pos.x, target.z - e.pos.z);
    return d < E.attackRange ? true : `追了 2 秒還在 ${d.toFixed(2)} 外`;
  });

  check("啄擊是近戰:攻擊距離遠小於畫面可見範圍(不會有螢幕外挨打)", () => {
    const camH = 30 * Math.sin((40 * Math.PI) / 180);
    const nearEdge = camH / Math.tan(((40 + 19) * Math.PI) / 180);
    const visibleAhead = 30 * Math.cos((40 * Math.PI) / 180) - nearEdge;
    return E.peckReach < visibleAhead / 3 ? true : `peckReach ${E.peckReach} 太遠`;
  });

  check("推開距離小於攻擊距離(否則鴨子永遠碰不到柯基)", () => {
    return E.playerPushDist < E.attackRange ? true : `playerPushDist ${E.playerPushDist} ≥ attackRange ${E.attackRange}`;
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

  suite("EnemyBrain 啄到之後走開");

  check("啄中之後鴨子心滿意足地走開,calmTime 內不會再啄", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = close();
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    if (runUntilAttack(brain, target) === null) return "從未出手";
    const steps = Math.floor((E.calmTime * 0.9) / (1 / 60));
    for (let i = 0; i < steps; i++) {
      faceToward(e, target.x, target.z);
      if (brain.update(1 / 60, target, 1).attack) return `走開期間又啄了(第 ${i} 步)`;
    }
    return eq(brain.state, "patrol");
  });

  check("走開的方向是背對柯基", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = close(); // 柯基在 +z
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    runUntilAttack(brain, target);
    const intent = brain.update(1 / 60, target, 1);
    return intent.move && intent.move.z < 0 ? true : `move=${intent.move && intent.move.z}`;
  });

  check("calmTime 過了之後又會追柯基", () => {
    const c = new Collision();
    const e = fakeEnemy(0, 0);
    const target = close();
    faceToward(e, target.x, target.z);
    const brain = makeBrain(e, c);
    brain.attackCd = 0;
    runUntilAttack(brain, target);
    brain.calm = 0;
    faceToward(e, target.x, target.z);
    brain.update(1 / 60, target, 1);
    return brain.state === "chase" || brain.state === "windup" ? true : `state=${brain.state}`;
  });
}
