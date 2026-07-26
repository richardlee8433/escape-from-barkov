import { BAL } from "../src/config/balance.js";
import { Collision } from "../src/systems/Collision.js";
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

  suite("橋口通道寬度");

  check("橋的欄杆之間留有足夠玩家通過的寬度", () => {
    // WorldBuilder：欄杆在 ±2.4、半徑 0.45
    const gap = (2.4 - 0.45) * 2;
    const needed = R * 2;
    return gap >= needed * 2
      ? true
      : `通道 ${gap.toFixed(2)} 對玩家直徑 ${needed.toFixed(2)} 來說太窄`;
  });

  check("溝壑開口不會反過來吃掉橋口", () => {
    // 開口半徑 4.5 > 溝壑圓半徑 2.2，最近的溝壑圓不會侵入通道
    const skip = 4.5, ravineR = 2.2;
    return skip > ravineR + R ? true : "溝壑圓侵入橋口";
  });
}
