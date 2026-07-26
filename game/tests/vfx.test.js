import * as THREE from "three";
import { Vfx } from "../src/render/Vfx.js";
import { suite, check, eq } from "./harness.js";

const bus = () => window.__bus;
const camera = new THREE.PerspectiveCamera();

function fakeEnemy(x = 0, z = 0, state = "chase") {
  return { pos: new THREE.Vector3(x, 0, z), brain: { state } };
}
// 每個測試用獨立 scene + Vfx；Vfx 會訂閱事件，跑完要收掉避免互相污染
function withVfx(fn) {
  const scene = new THREE.Scene();
  const v = new Vfx(scene);
  try {
    return fn(v, scene);
  } finally {
    v.dispose();
  }
}

export function run() {
  suite("VFX 命中與死亡");

  check("combat:hit 會產生一個爆點", () =>
    withVfx((v) => {
      bus().emit("combat:hit", { targetType: "enemy", x: 1, z: 2 });
      return eq(v.bursts.length, 1);
    }));

  check("玩家受擊與敵人受擊用不同顏色", () =>
    withVfx((v) => {
      bus().emit("combat:hit", { targetType: "enemy", x: 0, z: 0 });
      bus().emit("combat:hit", { targetType: "player", x: 0, z: 0 });
      const [a, b] = v.bursts;
      return a.mesh.material.color.getHex() !== b.mesh.material.color.getHex()
        ? true
        : "兩者顏色相同,分不出是誰被打";
    }));

  check("enemy:died 會產生死亡爆點", () =>
    withVfx((v) => {
      bus().emit("enemy:died", { enemy: fakeEnemy(), x: 3, z: 4 });
      return eq(v.bursts.length, 1);
    }));

  check("撤離會有專屬回饋", () =>
    withVfx((v) => {
      bus().emit("victory", { x: 5, z: 5 });
      return eq(v.bursts.length, 1);
    }));

  suite("VFX 效能與清理");

  check("爆點數量有上限,密集交火不會爆量", () =>
    withVfx((v) => {
      for (let i = 0; i < 500; i++) bus().emit("combat:hit", { targetType: "enemy", x: i, z: 0 });
      return v.bursts.length <= 24 ? true : `產生了 ${v.bursts.length} 個`;
    }));

  check("爆點播完會回收進物件池", () =>
    withVfx((v, scene) => {
      bus().emit("combat:hit", { targetType: "enemy", x: 0, z: 0 });
      const mesh = v.bursts[0].mesh;
      for (let i = 0; i < 60; i++) v.frame(1 / 60, camera, new Set());
      return v.bursts.length === 0 && v.pool.includes(mesh) && mesh.parent === null
        ? true
        : `bursts=${v.bursts.length} pooled=${v.pool.includes(mesh)} inScene=${mesh.parent !== null}`;
    }));

  check("重複播放會重用池中物件,不會無限成長", () =>
    withVfx((v, scene) => {
      const meshes = new Set();
      for (let round = 0; round < 30; round++) {
        bus().emit("combat:hit", { targetType: "enemy", x: 0, z: 0 });
        meshes.add(v.bursts[v.bursts.length - 1].mesh);
        for (let i = 0; i < 60; i++) v.frame(1 / 60, camera, new Set());
      }
      return meshes.size === 1 ? true : `配置了 ${meshes.size} 個不同的 mesh`;
    }));

  check("frame 不會在場景裡留下殘骸", () =>
    withVfx((v, scene) => {
      for (let i = 0; i < 10; i++) bus().emit("combat:hit", { targetType: "enemy", x: i, z: 0 });
      for (let i = 0; i < 120; i++) v.frame(1 / 60, camera, new Set());
      return eq(scene.children.length, 0);
    }));

  check("clear() 可以重複呼叫且會清空一切", () =>
    withVfx((v, scene) => {
      const e = fakeEnemy();
      bus().emit("combat:hit", { targetType: "enemy", x: 0, z: 0 });
      bus().emit("enemy:alerted", { enemy: e });
      bus().emit("enemy:windup", { enemy: e, duration: 0.5 });
      v.clear();
      v.clear();
      return scene.children.length === 0 && v.bursts.length === 0 && v.marks.size === 0 && v.windups.size === 0
        ? true
        : `children=${scene.children.length}`;
    }));

  suite("VFX 警戒與開火預告");

  check("enemy:alerted 會掛上警戒標記", () =>
    withVfx((v) => {
      bus().emit("enemy:alerted", { enemy: fakeEnemy() });
      return eq(v.marks.size, 1);
    }));

  check("同一隻敵人重複警戒不會疊加標記", () =>
    withVfx((v) => {
      const e = fakeEnemy();
      for (let i = 0; i < 5; i++) bus().emit("enemy:alerted", { enemy: e });
      return eq(v.marks.size, 1);
    }));

  check("標記會跟著敵人移動", () =>
    withVfx((v) => {
      const e = fakeEnemy(0, 0);
      bus().emit("enemy:alerted", { enemy: e });
      e.pos.set(9, 0, -4);
      v.frame(1 / 60, camera, new Set([e]));
      const m = v.marks.get(e);
      return m.position.x === 9 && m.position.z === -4 ? true : m.position.toArray().join(",");
    }));

  check("敵人回到 patrol 後標記會消失", () =>
    withVfx((v) => {
      const e = fakeEnemy(0, 0, "chase");
      bus().emit("enemy:alerted", { enemy: e });
      e.brain.state = "patrol";
      v.frame(1 / 60, camera, new Set([e]));
      return eq(v.marks.size, 0);
    }));

  check("敵人死亡會一併收掉標記與預告圈", () =>
    withVfx((v, scene) => {
      const e = fakeEnemy();
      bus().emit("enemy:alerted", { enemy: e });
      bus().emit("enemy:windup", { enemy: e, duration: 0.5 });
      bus().emit("enemy:died", { enemy: e, x: 0, z: 0 });
      return v.marks.size === 0 && v.windups.size === 0 ? true : `marks=${v.marks.size} windups=${v.windups.size}`;
    }));

  check("開火預告圈會隨倒數收緊", () =>
    withVfx((v) => {
      const e = fakeEnemy();
      bus().emit("enemy:windup", { enemy: e, duration: 0.5 });
      const alive = new Set([e]);
      v.frame(0.01, camera, alive);
      const start = v.windups.get(e).mesh.scale.x;
      for (let i = 0; i < 20; i++) v.frame(1 / 60, camera, alive);
      const end = v.windups.get(e).mesh.scale.x;
      return end < start ? true : `沒有收緊：${start} → ${end}`;
    }));

  check("取消前搖會移除預告圈", () =>
    withVfx((v) => {
      const e = fakeEnemy();
      bus().emit("enemy:windup", { enemy: e, duration: 0.5 });
      bus().emit("enemy:windupCancel", { enemy: e });
      return eq(v.windups.size, 0);
    }));

  check("敵人不在場上時,殘留的標記會自動清掉", () =>
    withVfx((v, scene) => {
      const e = fakeEnemy();
      bus().emit("enemy:alerted", { enemy: e });
      bus().emit("enemy:windup", { enemy: e, duration: 0.5 });
      v.frame(1 / 60, camera, new Set()); // 敵人已不存在
      return v.marks.size === 0 && v.windups.size === 0 && scene.children.length === 0
        ? true
        : `marks=${v.marks.size} windups=${v.windups.size} children=${scene.children.length}`;
    }));
}
