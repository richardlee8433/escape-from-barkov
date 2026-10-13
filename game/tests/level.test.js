import { BAL } from "../src/config/balance.js";
import { Collision } from "../src/systems/Collision.js";
import { RAVINE, RAVINE_HALF, BRIDGE, bridgeOpening } from "../src/world/GroundPaint.js";
import { suite, check, eq } from "./harness.js";

const HALF = BAL.world.size / 2;
const BOUND = HALF - BAL.world.edgeMargin;
const R = BAL.player.radius;

const v = (x, z) => ({ x, y: BAL.world.gameplayY, z });

// 模仿 stoneRidge：沿一條線密集鋪重疊的大圓
function ridge(c, x0, z0, x1, z1, step = 2.4, r = 2.0) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    c.addStatic(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r);
  }
}

export function run() {
  suite("單一遊戲平面");

  check("Collision 不再有任何高度概念", () => {
    const c = new Collision();
    return eq(c.heightAt, undefined);
  });

  check("gameplayY 已定義且為 0", () => eq(BAL.world.gameplayY, 0));

  check("resolveCircle 不會改動 y", () => {
    const c = new Collision();
    c.addStatic(1, 0, 2);
    const p = { x: 0, y: BAL.world.gameplayY, z: 0 };
    c.resolveCircle(p, R);
    return eq(p.y, BAL.world.gameplayY);
  });

  suite("邊界收容");

  check("遠超出界的座標會被拉回邊界內", () => {
    const c = new Collision();
    const p = v(9999, -9999);
    c.resolveCircle(p, R);
    return Math.abs(p.x) <= BOUND && Math.abs(p.z) <= BOUND
      ? true
      : `越界：${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
  });

  check("邊界夾在視覺石牆內側（石牆缺口也走不出去）", () => {
    const ridgeLine = HALF - 4;      // WorldBuilder 的邊界石牆位置
    const smallestStone = 2.6 * 0.42; // fpBase 最小值下的碰撞半徑
    const innerEdge = ridgeLine - smallestStone;
    return BOUND + R <= innerEdge
      ? true
      : `玩家可達 ${(BOUND + R).toFixed(2)}，已經吃進石牆 ${innerEdge.toFixed(2)}`;
  });

  check("推擠之後仍然留在界內（夾在最後才做）", () => {
    const c = new Collision();
    c.addStatic(BOUND, BOUND, 3); // 角落的大石頭會把角色往外推
    const p = v(BOUND - 0.5, BOUND - 0.5);
    c.resolveCircle(p, R);
    return Math.abs(p.x) <= BOUND && Math.abs(p.z) <= BOUND
      ? true
      : `被推出界：${p.x.toFixed(2)}, ${p.z.toFixed(2)}`;
  });

  suite("岩石卡住 / 穿模");

  check("單一石頭：解算後不再重疊", () => {
    const c = new Collision();
    c.addStatic(0, 0, 2);
    const p = v(0.3, 0.2);
    c.resolveCircle(p, R);
    return Math.hypot(p.x, p.z) >= 2 + R - 1e-3
      ? true
      : `仍然重疊，距離 ${Math.hypot(p.x, p.z).toFixed(3)}`;
  });

  check("密集重疊的石牆：解算後不與任何石頭重疊", () => {
    const c = new Collision();
    ridge(c, -12, 0, 12, 0);
    const p = v(0.4, 0.3); // 卡在石牆正中央
    c.resolveCircle(p, R);
    for (const s of c.statics) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < s.r + R - 1e-3) return `仍卡在石頭裡，穿透 ${(s.r + R - d).toFixed(3)}`;
    }
    return true;
  });

  check("石牆夾角：兩道石牆交會處也能解出來", () => {
    const c = new Collision();
    ridge(c, -12, 0, 12, 0);
    ridge(c, 0, -12, 0, 12);
    const p = v(0.2, 0.2);
    c.resolveCircle(p, R);
    for (const s of c.statics) {
      if (Math.hypot(p.x - s.x, p.z - s.z) < s.r + R - 1e-3) return "卡在夾角";
    }
    return true;
  });

  check("沿石牆持續推進不會卡死（會貼著滑走）", () => {
    const c = new Collision();
    ridge(c, -20, 0, 20, 0);
    const p = v(-15, -2.4);
    let moved = 0;
    for (let i = 0; i < 240; i++) {
      const before = p.x;
      p.x += 0.15;   // 沿牆走
      p.z -= 0.05;   // 同時往牆裡擠
      c.resolveCircle(p, R);
      moved += p.x - before;
    }
    return moved > 20 ? true : `貼牆移動被卡住，只前進了 ${moved.toFixed(1)}`;
  });

  check("正面撞牆會被擋下，不會穿過去", () => {
    const c = new Collision();
    ridge(c, -20, 0, 20, 0);
    const p = v(0, -3);
    for (let i = 0; i < 200; i++) {
      p.z += 0.15; // 一路往牆裡衝
      c.resolveCircle(p, R);
    }
    return p.z < 0 ? true : `穿模了，跑到牆的另一側 z=${p.z.toFixed(2)}`;
  });

  check("隨機亂走 2000 步都不會被卡進石頭裡", () => {
    const c = new Collision();
    ridge(c, -20, -6, 20, -6);
    ridge(c, -20, 6, 20, 6);
    ridge(c, -6, -20, -6, 20);
    const p = v(0, 0);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 2000; i++) {
      const a = rnd() * Math.PI * 2;
      p.x += Math.cos(a) * 0.3;
      p.z += Math.sin(a) * 0.3;
      c.resolveCircle(p, R);
      for (const s of c.statics) {
        if (Math.hypot(p.x - s.x, p.z - s.z) < s.r + R - 1e-2) {
          return `第 ${i} 步卡進石頭`;
        }
      }
    }
    return true;
  });

  suite("橋與溝壑");

  // 與 WorldBuilder 完全相同的設定:溝壑帶 + 橋面開口 + 兩條欄杆膠囊
  function bridgeWorld() {
    const c = new Collision();
    const o = bridgeOpening();
    c.addRavine(RAVINE, RAVINE_HALF, [o]);
    for (const side of [-BRIDGE.railOffset, BRIDGE.railOffset]) {
      const a = BRIDGE.halfLen - 0.15;
      c.addCapsule(o.x - o.ux * a - o.uz * side, o.z - o.uz * a + o.ux * side,
        o.x + o.ux * a - o.uz * side, o.z + o.uz * a + o.ux * side, 0.08, { blocksBullets: false });
    }
    return { c, o };
  }
  // 到溝壑中心線的距離
  const ravineDist = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < RAVINE.length - 1; i++) {
      const [ax, az] = RAVINE[i], [bx, bz] = RAVINE[i + 1];
      const vx = bx - ax, vz = bz - az;
      let t = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
    return best;
  };
  // 在橋面範圍內嗎(沿橋方向、橫向都算)
  const onDeck = (o, p, r) => {
    const dx = p.x - o.x, dz = p.z - o.z;
    const along = dx * o.ux + dz * o.uz, lat = -dx * o.uz + dz * o.ux;
    return Math.abs(along) <= o.halfLen && Math.abs(lat) + r <= o.halfWidth + 1e-3;
  };
  // 合法 = 整個身體都在岸上,或者整個身體都在橋面上
  const legal = (o, p) => ravineDist(p.x, p.z) >= RAVINE_HALF + R - 1e-3 || onDeck(o, p, R);

  check("從橋頭走到橋尾可以通過", () => {
    const { c, o } = bridgeWorld();
    const p = v(o.x - o.ux * 7, o.z - o.uz * 7);
    for (let i = 0; i < 120; i++) c.move(p, o.ux * 0.15, o.uz * 0.15, R);
    const along = (p.x - o.x) * o.ux + (p.z - o.z) * o.uz;
    return along > 6 ? true : `卡在橋上,只走到 along=${along.toFixed(2)}`;
  });

  check("橋以外的地方走不進溝壑", () => {
    const { c } = bridgeWorld();
    const p = v(26, -30);
    for (let i = 0; i < 200; i++) c.move(p, 0.15, 0, R); // 一路往東衝向溝壑
    return ravineDist(p.x, p.z) >= RAVINE_HALF + R - 1e-3
      ? true
      : `掉進溝裡,離中心線 ${ravineDist(p.x, p.z).toFixed(2)}`;
  });

  check("在橋上往側面擠,身體不會越過欄杆內側", () => {
    const { c, o } = bridgeWorld();
    const p = v(o.x, o.z);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      c.move(p, -o.uz * 0.15, o.ux * 0.15, R); // 往左擠
      const lat = Math.abs(-(p.x - o.x) * o.uz + (p.z - o.z) * o.ux);
      worst = Math.max(worst, lat + R);
    }
    return worst <= o.halfWidth + 1e-3 ? true : `身體探出欄杆 ${(worst - o.halfWidth).toFixed(3)}`;
  });

  check("沿著岸邊繞過橋頭,不會從欄杆外側滑進溝裡", () => {
    const { c, o } = bridgeWorld();
    // 從橋頭外側(欄杆外)沿溝壑方向走過去
    const start = v(o.x - o.ux * 4.2 - o.uz * 4, o.z - o.uz * 4.2 + o.ux * 4);
    const p = { ...start };
    for (let i = 0; i < 160; i++) {
      c.move(p, o.uz * 0.15 + o.ux * 0.05, -o.ux * 0.15 + o.uz * 0.05, R);
      if (!legal(o, p)) return `第 ${i} 步一半在橋上一半在溝裡 (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;
    }
    return true;
  });

  check("橋頭附近隨機亂走 3000 步,永遠不會出現一半在橋、一半在溝", () => {
    const { c, o } = bridgeWorld();
    const p = v(o.x - o.ux * 6, o.z);
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 3000; i++) {
      const a = rnd() * Math.PI * 2;
      c.move(p, Math.cos(a) * 0.3, Math.sin(a) * 0.3, R);
      // 太遠就拉回橋附近,讓亂走集中在橋頭
      if (Math.hypot(p.x - o.x, p.z - o.z) > 9) { p.x = o.x - o.ux * 6; p.z = o.z; }
      if (!legal(o, p)) return `第 ${i} 步非法位置 (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;
    }
    return true;
  });

  check("溝壑裡不能生成東西,橋面上可以", () => {
    const { c, o } = bridgeWorld();
    if (c.isFree(34, -40, 1)) return "溝底被判定為可放置";
    return eq(c.isFree(o.x, o.z, 0.5), true);
  });

  check("溝壑不擋子彈", () => {
    const { c } = bridgeWorld();
    return eq(c.hitStatic(34, -40, 0.2), false);
  });

  suite("石縫與形狀");

  check("擠進兩顆石頭之間的窄縫不會卡死,退得出來", () => {
    const c = new Collision();
    // 兩顆長形巨石呈 V 字,縫口比角色窄
    c.addCapsule(-3, 3, 0, 0.3, 1.0);
    c.addCapsule(3, 3, 0, 0.3, 1.0);
    const p = v(0, 6);
    for (let i = 0; i < 120; i++) c.move(p, 0, -0.15, R); // 一直往縫裡擠
    if (c.penetration(p.x, p.z, R) > 0.02) return "停在石頭裡";
    const before = p.z;
    for (let i = 0; i < 20; i++) c.move(p, 0, 0.15, R); // 往回走
    return p.z > before + 2.5 ? true : `退不出來 Δz=${(p.z - before).toFixed(2)}`;
  });

  check("任何移動結束後都不會停在障礙物裡", () => {
    const c = new Collision();
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // 一堆亂擺的膠囊、方盒、圓,彼此重疊、留下各種窄縫
    for (let i = 0; i < 40; i++) {
      const x = (rnd() - 0.5) * 30, z = (rnd() - 0.5) * 30, a = rnd() * 6.28;
      const k = i % 3;
      if (k === 0) c.addCapsule(x, z, x + Math.cos(a) * 3, z + Math.sin(a) * 3, 0.4 + rnd());
      else if (k === 1) c.addBox(x, z, a, 0.5 + rnd() * 2, 0.5 + rnd() * 2);
      else c.addStatic(x, z, 0.5 + rnd() * 1.5);
    }
    const p = v(0, 0);
    c.resolveCircle(p, R);
    for (let i = 0; i < 3000; i++) {
      const a = rnd() * Math.PI * 2;
      c.move(p, Math.cos(a) * 0.3, Math.sin(a) * 0.3, R);
      const pen = c.penetration(p.x, p.z, R);
      if (pen > 0.02) return `第 ${i} 步卡進障礙,穿透 ${pen.toFixed(3)}`;
    }
    return true;
  });

  check("長形巨石的兩端也擋得住(不是只有中間)", () => {
    const c = new Collision();
    c.addCapsule(-2, 0, 2, 0, 0.8); // 長 5.6、寬 1.6 的石頭
    // 正面撞向靠近末端的地方:舊版一顆置中的圓(半徑取短邊)在 x=1.8 處根本碰不到
    const p = v(1.8, -4);
    for (let i = 0; i < 60; i++) c.move(p, 0, 0.15, R);
    return c.penetration(p.x, p.z, R) <= 0.02 && p.z < 0
      ? true
      : `穿過石頭末端 z=${p.z.toFixed(2)}`;
  });

  check("轉了角度的方盒:牆面貼得住、牆角不會多出隱形牆", () => {
    const c = new Collision();
    c.addBox(0, 0, Math.PI / 6, 4, 2.5);
    // 沿長邊外側 0.6 處(玩家半徑 0.5)應該可以站
    const ca = Math.cos(Math.PI / 6), sa = Math.sin(Math.PI / 6);
    const lx = 0, lz = 2.5 + 0.6; // 本地座標
    const wx = lx * ca + lz * sa, wz = -lx * sa + lz * ca;
    if (!c.isFree(wx, wz, R)) return "牆外 0.1 的位置被誤判為擋住";
    // 正中央當然不行
    return eq(c.isFree(0, 0, R), false);
  });

  check("方盒擋子彈、擋視線", () => {
    const c = new Collision();
    c.addBox(5, 0, 0.3, 1, 3);
    if (!c.hitStatic(5, 0, 0.2)) return "子彈穿過方盒";
    return eq(c.sightBlocked(0, 0, 10, 0), true);
  });

  check("細柵欄(膠囊)擋人不擋子彈,也不會一步跨過去", () => {
    const c = new Collision();
    c.addCapsule(-5, 0, 5, 0, 0.15, { blocksBullets: false });
    const p = v(0, -1);
    c.move(p, 0, 2.0, R); // 一次跨 2 公尺(像被擊退)
    if (p.z > 0) return `被一步跨過柵欄 z=${p.z.toFixed(2)}`;
    return eq(c.hitStatic(0, 0, 0.2), false);
  });

  suite("長條身體(柯基)");

  const BODY = BAL.player.body;
  const bodyFacing = (yaw) => ({ ...BODY, fx: Math.sin(yaw), fz: Math.cos(yaw) });

  check("正面撞牆時鼻子不會插進牆裡", () => {
    const c = new Collision();
    c.addBox(0, 5, 0, 6, 1);           // 牆面在 z = 4
    const p = v(0, 0);
    const b = bodyFacing(0);           // 面向 +z(朝牆)
    for (let i = 0; i < 80; i++) c.move(p, 0, 0.15, b);
    const nose = p.z + BODY.half + BODY.r;
    return nose <= 4 + 0.02 ? true : `鼻尖 ${nose.toFixed(2)} 插進牆面 4`;
  });

  check("貼著牆轉身:身體被推開,不會轉進牆裡", () => {
    const c = new Collision();
    c.addBox(0, 5, 0, 6, 1);           // 牆面在 z = 4
    const p = v(0, 4 - BODY.r - 0.01); // 側身貼牆(面向 +x)
    let yaw = Math.PI / 2;
    for (let i = 0; i < 30; i++) {     // 慢慢轉向牆
      const next = yaw - 0.06;
      if (c.turn(p, bodyFacing(next))) yaw = next;
      const pen = c.penetration(p.x, p.z, bodyFacing(yaw));
      if (pen > 0.02) return `轉身時插進牆裡 ${pen.toFixed(3)}`;
    }
    return yaw < 0.5 ? true : `應該要能轉過來(被推離牆面),卻停在 yaw=${yaw.toFixed(2)}`;
  });

  check("面向溝壑走到岸邊,鼻子不會探出溝緣", () => {
    const c = new Collision();
    c.addRavine(RAVINE, RAVINE_HALF, [bridgeOpening()]);
    const p = v(26, -30);
    const b = bodyFacing(Math.PI / 2); // 面向 +x(溝壑)
    for (let i = 0; i < 200; i++) c.move(p, 0.15, 0, b);
    const nose = ravineDist(p.x + BODY.half + BODY.r, p.z);
    return nose >= RAVINE_HALF - 0.02 ? true : `鼻尖探進溝裡,離中心線 ${nose.toFixed(2)}`;
  });

  check("面向前方走過整座橋,在橋上轉一圈也不會卡住或探出欄杆", () => {
    const { c, o } = bridgeWorld();
    const p = v(o.x - o.ux * 7, o.z - o.uz * 7);
    const yaw0 = Math.atan2(o.ux, o.uz);
    for (let i = 0; i < 50; i++) c.move(p, o.ux * 0.15, o.uz * 0.15, bodyFacing(yaw0));
    // 在橋中央轉一整圈
    let yaw = yaw0;
    for (let i = 0; i < 64; i++) {
      const next = yaw + Math.PI / 32;
      if (c.turn(p, bodyFacing(next))) yaw = next;
      if (c.penetration(p.x, p.z, bodyFacing(yaw)) > 0.02) return "轉身時插進欄杆";
    }
    for (let i = 0; i < 60; i++) c.move(p, o.ux * 0.15, o.uz * 0.15, bodyFacing(yaw0));
    const along = (p.x - o.x) * o.ux + (p.z - o.z) * o.uz;
    return along > 6 ? true : `過不了橋 along=${along.toFixed(2)}`;
  });
}
