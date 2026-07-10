import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { buildGround, PATH, SIDE_PATH, RAVINE, BRIDGE_SPOT } from "./GroundPaint.js";
import { GrassField } from "./Grass.js";

// 把整張地圖搭出來：光、地面、草、石牆、樹、營地、橋、出口。
// 需要擋路的東西都跟 collision 註冊圓形碰撞體。

const HALF = BAL.world.size / 2;

export function buildWorld(scene, assets, collision) {
  // ---------- 光 ----------
  const sun = new THREE.DirectionalLight(0xffdda0, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const sunOffset = new THREE.Vector3(-30, 20, 10);
  const followSun = (pos) => {
    sun.position.copy(pos).add(sunOffset);
    sun.target.position.copy(pos);
  };

  scene.add(new THREE.HemisphereLight(0xa8bfd6, 0x5a4a30, 0.65));

  // ---------- 地面 / 草 ----------
  const ground = buildGround();
  scene.add(ground.mesh);
  const grass = new GrassField(scene, ground.isGrassAt, ground.colorAt);

  // ---------- 擺放工具 ----------
  function put(name, x, z, target, ry = Math.random() * Math.PI * 2, opts = {}) {
    const obj = assets.instantiate(name, target, opts);
    const holder = new THREE.Group();
    holder.add(obj);
    holder.position.set(x, 0, z);
    holder.rotation.y = ry;
    scene.add(holder);
    return holder;
  }

  // ---------- 石牆 ----------
  const BIG_STONES = ["stone_largeA", "stone_largeB", "stone_largeC", "stone_largeD", "stone_tallB", "stone_tallD"];
  const SMALL_STONES = ["stone_smallA", "stone_smallC", "stone_smallE"];
  // 石頭模型是「寬扁形」(如 stone_largeA 高 0.26 寬 1.02),
  // 一律按底面積(最大邊)縮放,碰撞半徑直接取底面積的一半,視覺 = 碰撞。
  function stoneRidge(points, density = 2.4, fpBase = 3.0, fpVar = 2.6) {
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / density));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const x = ax + (bx - ax) * t + (Math.random() - 0.5) * 1.6;
        const z = az + (bz - az) * t + (Math.random() - 0.5) * 1.6;
        const fp = fpBase + Math.random() * fpVar;
        // 中心與四周都要是草地,石頭邊緣才不會壓到路面/橋/溝壑
        const clear = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]
          .every(([ox, oz]) => ground.isGrassAt(x + ox * fp, z + oz * fp));
        if (!clear) continue;
        put(BIG_STONES[(Math.random() * BIG_STONES.length) | 0], x, z, fp, undefined, { dim: "max" });
        collision.addStatic(x, z, fp * 0.42);
        if (Math.random() < 0.6) {
          const sx2 = x + (Math.random() - 0.5) * 3;
          const sz2 = z + (Math.random() - 0.5) * 3;
          if (ground.isGrassAt(sx2, sz2))
            put(SMALL_STONES[(Math.random() * SMALL_STONES.length) | 0], sx2, sz2, 0.8 + Math.random() * 0.8, undefined, { dim: "max" });
        }
      }
    }
  }

  // 邊界石牆（取代舊版的隱形牆，世界邊緣看起來是自然的）
  const B = HALF - 4;
  stoneRidge([[-B, -B], [B, -B]], 2.8, 2.6, 1.8);
  stoneRidge([[-B, B], [B, B]], 2.8, 2.6, 1.8);
  stoneRidge([[-B, -B + 3], [-B, B - 3]], 2.8, 2.6, 1.8);
  stoneRidge([[B, -B + 3], [B, B - 3]], 2.8, 2.6, 1.8);

  // 內部石丘（構圖用，避開路的走廊）
  stoneRidge([[-50, -45], [-38, -32], [-44, -16]]);
  stoneRidge([[-12, -42], [2, -32], [-4, -18]]);
  stoneRidge([[50, -30], [60, -16], [68, -26]]);
  stoneRidge([[-32, 35], [-18, 44], [-2, 38]]);
  stoneRidge([[14, 28], [26, 38]]);
  stoneRidge([[52, 30], [64, 24]]);

  // ---------- 樹 ----------
  const PINES = ["tree_pineRoundA", "tree_pineRoundB", "tree_pineRoundC", "tree_pineRoundD"];
  const treePts = [];
  const [sx, sz] = PATH[0];
  for (let i = 0; i < 260 && treePts.length < 70; i++) {
    const x = (Math.random() - 0.5) * (BAL.world.size - 24);
    const z = (Math.random() - 0.5) * (BAL.world.size - 24);
    if (!ground.isGrassAt(x, z)) continue;
    if (Math.hypot(x - sx, z - sz) < 14) continue; // 出生點附近留空
    if (!collision.isFree(x, z, 1.0)) continue; // 不長進石頭裡
    if (treePts.some(([tx2, tz2]) => Math.hypot(x - tx2, z - tz2) < 7)) continue;
    treePts.push([x, z]);
  }
  for (const [x, z] of treePts) {
    const h = 4.6 + Math.random() * 3.0;
    put(PINES[(Math.random() * PINES.length) | 0], x, z, h);
    collision.addStatic(x, z, 0.55);
    if (Math.random() < 0.4) {
      const tx2 = x + 2 + Math.random() * 2;
      const tz2 = z + (Math.random() - 0.5) * 4;
      if (ground.isGrassAt(tx2, tz2)) {
        put(Math.random() < 0.5 ? "tree_pineSmallA" : "tree_pineSmallB", tx2, tz2, 2.2 + Math.random() * 1.2);
        collision.addStatic(tx2, tz2, 0.35);
      }
    }
  }

  // ---------- 路邊柵欄 ----------
  // fence_simple 縮放後一片約 3.3 長,間距對齊片長;
  // 每片放置前檢查「中心與兩端」都在草地上,壓到路面就跳過(路口自然留缺口)。
  function fenceAlong(points, side = 1, offset = 3.0) {
    const SEG = 3.2, HALF_LEN = 1.6;
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz * side, nz = dx * side;
      const n = Math.floor(len / SEG);
      const ang = Math.atan2(bx - ax, bz - az);
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        const fx = ax + (bx - ax) * t + nx * offset;
        const fz = az + (bz - az) * t + nz * offset;
        const onGrass =
          ground.isGrassAt(fx, fz) &&
          ground.isGrassAt(fx + dx * HALF_LEN, fz + dz * HALF_LEN) &&
          ground.isGrassAt(fx - dx * HALF_LEN, fz - dz * HALF_LEN);
        if (!onGrass) continue;
        put("fence_simple", fx, fz, 1.15, ang + Math.PI / 2);
        // 一片柵欄 3.3 長,用兩個碰撞圓覆蓋整片(擋人不擋子彈)
        collision.addStatic(fx + dx * 0.85, fz + dz * 0.85, 0.95, { blocksBullets: false });
        collision.addStatic(fx - dx * 0.85, fz - dz * 0.85, 0.95, { blocksBullets: false });
      }
    }
  }
  fenceAlong([[12, 8], [22, 6], [28, 6]], 1);
  fenceAlong([[-18, -10], [-8, 2]], -1);
  fenceAlong([[48, 12], [58, 4]], -1);

  // ---------- 橋與溝壑 ----------
  {
    const { x, z, dirTo } = BRIDGE_SPOT;
    // bridge_wood 的欄杆沿「模型 x 軸」(由幾何分析確認),要把模型 x 轉到路的方向
    const ang = Math.atan2(dirTo[0] - x, dirTo[1] - z) - Math.PI / 2;
    const bridge = put("bridge_wood", x, z, 10, ang, { dim: "max" });
    bridge.children[0].scale.y *= 0.3; // 壓扁拱形
    bridge.children[0].scale.z *= 0.5; // 模型是正方形,收窄成 10x5 的橋

    // 橋的方向向量(目前是 +x,寫成通式)
    const L = Math.hypot(dirTo[0] - x, dirTo[1] - z);
    const ux = (dirTo[0] - x) / L, uz = (dirTo[1] - z) / L;

    // 用 raycast 沿橋的中心線實測橋板頂面高度,建查詢表——
    // 不對拱形做任何假設,角色的腳永遠貼著真實橋面
    const SAMPLES = 32;
    bridge.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const deck = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const along = -5 + (10 * i) / SAMPLES;
      ray.set(new THREE.Vector3(x + ux * along, 20, z + uz * along), down);
      const hit = ray.intersectObject(bridge, true)[0];
      deck.push(hit ? Math.max(0, hit.point.y) : 0);
    }

    collision.heightAt = (px, pz) => {
      const dx = px - x, dz = pz - z;
      const along = dx * ux + dz * uz;
      const across = -dx * uz + dz * ux;
      if (Math.abs(along) > 5 || Math.abs(across) > 2.6) return 0;
      const f = ((along + 5) / 10) * SAMPLES;
      const i0 = Math.floor(f), i1 = Math.min(SAMPLES, i0 + 1);
      return deck[i0] + (deck[i1] - deck[i0]) * (f - i0);
    };

    // 橋兩側欄杆碰撞:走在橋上不會從側面掉進溝壑(擋人不擋子彈)
    for (let a = -4.2; a <= 4.2; a += 1.2) {
      for (const side of [-2.15, 2.15]) {
        collision.addStatic(x + ux * a - uz * side, z + uz * a + ux * side, 0.6, { blocksBullets: false });
      }
    }

    // 溝壑不可通行,只留橋這個開口(擋移動、不擋子彈)
    for (let i = 0; i < RAVINE.length - 1; i++) {
      const [ax, az] = RAVINE[i], [bx, bz] = RAVINE[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(len / 2);
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const cx = ax + (bx - ax) * t;
        const cz = az + (bz - az) * t;
        if (Math.hypot(cx - x, cz - z) < 2.6) continue; // 橋面開口(對齊橋寬)
        collision.addStatic(cx, cz, 2.2, { blocksBullets: false });
      }
    }
  }

  // ---------- 木箱營地 ----------
  function camp(cx, cz) {
    const props = [
      ["box-large", 0, 0, 1.5], ["box", 1.9, 0.9, 1.0], ["box-open", 0.5, 2.1, 0.95],
      ["box", 0.6, -1.4, 1.0], ["barrel", 3.1, -0.9, 1.25], ["chest", 4.0, 2.3, 0.9],
    ];
    for (const [name, dx, dz, h] of props) {
      put(name, cx + dx, cz + dz, h);
      collision.addStatic(cx + dx, cz + dz, h * 0.65);
    }
  }
  camp(-28, 18);  // 支線盡頭
  camp(44, -8);   // 主路後段旁

  // ---------- 散景 ----------
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() - 0.5) * (BAL.world.size - 18);
    const z = (Math.random() - 0.5) * (BAL.world.size - 18);
    if (!ground.isGrassAt(x, z)) continue;
    if (!collision.isFree(x, z, 0.5)) continue; // 不長進石頭/木箱裡
    const p = Math.random();
    if (p < 0.5) put("grass_leafs", x, z, 0.5 + Math.random() * 0.4);
    else if (p < 0.75) put("plant_bushSmall", x, z, 0.7 + Math.random() * 0.6);
    else if (p < 0.85) put("plant_bushLarge", x, z, 1.1 + Math.random() * 0.7);
    else if (p < 0.92) put("mushroom_red", x, z, 0.35 + Math.random() * 0.2);
    else if (p < 0.97) put("log", x, z, 1.6, undefined, { dim: "max" });
    else put("stump_round", x, z, 0.55);
  }

  // ---------- 出口 ----------
  const [ex, ez] = PATH[PATH.length - 1];
  const [px2, pz2] = PATH[PATH.length - 2];
  const exitAng = Math.atan2(ex - px2, ez - pz2);
  put("fence_gate", ex, ez, 2.6, exitAng + Math.PI / 2);
  const gx1 = ex + Math.cos(exitAng) * 2.4, gz1 = ez - Math.sin(exitAng) * 2.4;
  const gx2 = ex - Math.cos(exitAng) * 2.4, gz2 = ez + Math.sin(exitAng) * 2.4;
  put("fence_simple", gx1, gz1, 1.6, exitAng + Math.PI / 2);
  put("fence_simple", gx2, gz2, 1.6, exitAng + Math.PI / 2);
  collision.addStatic(gx1, gz1, 0.7, { blocksBullets: false });
  collision.addStatic(gx2, gz2, 0.7, { blocksBullets: false });

  // EXIT 招牌
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const c2 = cv.getContext("2d");
  c2.font = "bold 42px sans-serif";
  c2.fillStyle = "#7dffd8";
  c2.textAlign = "center";
  c2.fillText("EXIT", 128, 48);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.5),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true })
  );
  label.position.set(ex, 4, ez);
  label.lookAt(new THREE.Vector3(0, 4, 0));
  scene.add(label);

  // 出口地面光圈
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.0, 2.5, 40),
    new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.5 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ex, 0.04, ez);
  scene.add(ring);

  // ---------- 出生點 ----------
  const playerStart = new THREE.Vector3(PATH[0][0], 0, PATH[0][1]);
  const startYaw = Math.atan2(PATH[1][0] - PATH[0][0], PATH[1][1] - PATH[0][1]);

  return {
    followSun,
    grass,
    isGrassAt: ground.isGrassAt,
    playerStart,
    startYaw,
    exitPos: new THREE.Vector3(ex, 0, ez),
    pathPoints: [...PATH, ...SIDE_PATH],
  };
}
