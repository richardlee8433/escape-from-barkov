import * as THREE from "three";
import { BAL } from "../config/balance.js";
import {
  buildGround, PATH, SIDE_PATH, RAVINE, RAVINE_HALF, BRIDGE_SPOT, BRIDGE, bridgeOpening,
  ravineDistance, WATER_Y, terrainHeight, lakeSDF, LAKE_BOUNDS, LAKE_CIRCLES, STREAM_BOUNDS,
} from "./GroundPaint.js";
import { GrassField } from "./Grass.js";
import { FlowerField } from "./Flowers.js";
import { Water, FishSchool } from "./Water.js";
import { InstancedProp, placeMatrix } from "./Props.js";
import { CAMERA_OFFSET } from "../render/CameraRig.js";
import { IS_TOUCH } from "../core/Game.js";
import { bus } from "../core/EventBus.js";
import { t } from "../i18n/i18n.js";

// 把整張地圖搭出來：光、地面、草、石牆、樹、營地、橋、出口。
// 需要擋路的東西都跟 collision 註冊圓形碰撞體。

const HALF = BAL.world.size / 2;

export function buildWorld(scene, assets, collision) {
  // ---------- 光 ----------
  const sun = new THREE.DirectionalLight(0xffe2b8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // 陰影範圍要蓋住拉到最遠的鏡頭(CameraRig.ZOOM_MAX)
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  // 太陽在相機左後上方:看得到的那幾面(朝 +x/+z)是受光面,
  // 舊版太陽在相機對面,整片景物都是逆光的剪影。
  const sunOffset = new THREE.Vector3(-10, 27, 28);
  const followSun = (pos) => {
    sun.position.copy(pos).add(sunOffset);
    sun.target.position.copy(pos);
  };

  scene.add(new THREE.HemisphereLight(0xc4d8ea, 0x4d5a2e, 0.85));

  // ---------- 地面 / 草 ----------
  const ground = buildGround();
  scene.add(ground.mesh);
  const grass = new GrassField(scene, ground.isGrassAt, ground.colorAt);
  // 界外的草:接著界內的草從邊界石牆往外長,越遠越稀,看不出界內界外的分界線
  const OUT0 = HALF - 5, OUT1 = HALF + 28;
  const outerGrass = new GrassField(scene, (x, z) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < OUT0 || d > OUT1) return false;
    if (terrainHeight(x, z) !== 0 || lakeSDF(x, z) < 2 || ravineDistance(x, z) < RAVINE_HALF + 1) return false;
    return Math.random() < 1 - 0.75 * (d - OUT0) / (OUT1 - OUT0);
  }, ground.colorAt, IS_TOUCH ? 16000 : 34000, OUT1 * 2 + 8);

  // ---------- 水:溪流與地圖南緣的淺水湖 ----------
  // 兩者共用水位,水面透明、白沫依實際深度長在岸邊與障礙物周圍(見 Water.js)
  const stream = new Water(scene, {
    bounds: STREAM_BOUNDS, level: WATER_Y, ground: terrainHeight, flow: [0, 1.2],
    shallow: 0x3fd9c6, deep: 0x16889a,
  });
  const lake = new Water(scene, {
    bounds: LAKE_BOUNDS, level: WATER_Y, ground: terrainHeight,
    shallow: 0x45dcc9, deep: 0x1576a6,
  });
  // 湖岸是禁區:整個身體都要留在沙灘上
  collision.addArea(lakeSDF, LAKE_BOUNDS);

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

  const _box = new THREE.Box3();
  const _size = new THREE.Vector3();
  const _ctr = new THREE.Vector3();

  // 碰撞 = 模型的實際底面輪廓。在「未旋轉」狀態量出本地包圍盒,
  // 再依形狀登記:box(木箱、寶箱)、capsule(長形巨石、圓木)、circle(木桶、樹樁)。
  // 舊版一律用一個圓,長形石頭的兩端可以直接穿過去。
  function addSolid(holder, kind, opts, shrink = 1) {
    const ry = holder.rotation.y;
    holder.rotation.y = 0;
    holder.updateMatrixWorld(true);
    _box.setFromObject(holder);
    _box.getSize(_size);
    _box.getCenter(_ctr);
    holder.rotation.y = ry;
    holder.updateMatrixWorld(true);
    const c = Math.cos(ry), s = Math.sin(ry);
    // 本地包圍盒中心(模型不一定置中)轉到世界
    const ox = _ctr.x - holder.position.x, oz = _ctr.z - holder.position.z;
    const wx = holder.position.x + ox * c + oz * s;
    const wz = holder.position.z - ox * s + oz * c;
    const hx = (_size.x / 2) * shrink, hz = (_size.z / 2) * shrink;
    if (kind === "box") return collision.addBox(wx, wz, ry, hx, hz, opts);
    if (kind === "circle") return collision.addStatic(wx, wz, (hx + hz) / 2, opts);
    // capsule:沿長軸,半徑 = 短邊的一半。本地 x 軸在世界是 (c, -s)
    const alongX = hx >= hz;
    const r = Math.min(hx, hz);
    const half = Math.abs(hx - hz);
    const ux = alongX ? c : s, uz = alongX ? -s : c;
    return collision.addCapsule(wx - ux * half, wz - uz * half, wx + ux * half, wz + uz * half, r, opts);
  }
  // 矮的地面雜物:擋人,不擋子彈與視線
  const LOW = { blocksBullets: false };

  // 夠高、可能擋住玩家或敵人的物件登記成遮蔽體,交給相機做淡出。
  // 半徑量「視覺外接圓」而不是碰撞半徑,碰撞圓通常比模型窄(樹幹 vs 樹冠),
  // 拿它當遮蔽範圍會漏掉一堆實際上真的擋住畫面的樹冠與石頭邊緣。
  // top 記世界座標的頂端高度,相機才能判斷它是否真的切到視線。
  const occluders = [];
  function addOccluder(holder, x, z) {
    holder.updateMatrixWorld(true);
    _box.setFromObject(holder).getSize(_size);
    occluders.push({ holder, x, z, r: Math.max(_size.x, _size.z) * 0.55, top: _box.max.y });
  }

  // 建築用定向包圍盒:在未旋轉狀態量出半長、半寬,相機用精確的線段 × OBB 測試
  function addBoxOccluder(holder, x, z) {
    const ry = holder.rotation.y;
    holder.rotation.y = 0;
    holder.updateMatrixWorld(true);
    _box.setFromObject(holder).getSize(_size);
    const top = _box.max.y;
    holder.rotation.y = ry;
    holder.updateMatrixWorld(true);
    occluders.push({ holder, x, z, obb: true, ry, hx: _size.x / 2, hz: _size.z / 2, top });
  }

  // ---------- 農舍(地標,最先放,其餘景物都要避開) ----------
  // reserved:農舍周圍的保留區,石頭/樹/散景都不得長進來
  const reserved = [];
  const inReserved = (x, z, pad = 0) => reserved.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + pad);
  const homes = [];

  // 以本地座標(門朝 +z)擺放,再旋轉到世界。
  // 相機角度固定,正面(門、窗、茅草屋頂的受光坡)一律大致朝向相機,
  // turn 只做小幅偏轉,避免四棟房子看起來一模一樣。
  const CAM_YAW = Math.atan2(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
  function homestead(cx, cz, turn = 0) {
    const ry = CAM_YAW + turn;
    const c = Math.cos(ry), sn = Math.sin(ry);
    const W = (lx, lz) => [cx + lx * c + lz * sn, cz - lx * sn + lz * c];
    // 整塊地都要是草地,不能壓到路
    for (let lx = -9; lx <= 9; lx += 1.5)
      for (let lz = -5; lz <= 6; lz += 1.5) {
        const [x, z] = W(lx, lz);
        if (!ground.isGrassAt(x, z)) return false;
      }

    const S = 1.1; // 農舍按公尺建模,門高 1.85 → 放大到與角色相襯
    const house = put("cottage", cx, cz, S, ry, { dim: "scale" });
    addBoxOccluder(house, cx, cz);
    // 牆體(含地基石)是 8 x 5 公尺 × 1.1 的方盒:一個定向方盒貼齊牆面,
    // 不再用一串圓(圓與圓之間會有縫,牆角也會凸出一圈看不見的牆)
    collision.addBox(cx, cz, ry, 4.42 * S, 2.92 * S);

    const prop = (name, lx, lz, h, opts, shape, collOpts, rot) => {
      const [x, z] = W(lx, lz);
      const holder = put(name, x, z, h, rot ?? Math.random() * Math.PI * 2, opts);
      if (shape) addSolid(holder, shape, collOpts, 0.95);
      return [holder, x, z];
    };
    const [well, wx, wz] = prop("well", -8, 2.5, 1.0, { dim: "scale" }, null, null, ry + 0.4);
    collision.addStatic(wx, wz, 1.25); // 井口是一圈圓石
    addOccluder(well, wx, wz);
    prop("barrel", 5.6, 3.6, 1.15, undefined, "circle");
    prop("barrel", 6.5, 4.3, 1.1, undefined, "circle");
    prop("crate", 6.2, 2.4, 0.9, undefined, "box", undefined, ry + 0.2);
    prop("bush_flower", -4.6, 3.8, 1.0);
    prop("bush_flower", 3.6, 4.6, 0.85);
    prop("bush", -5.7, -2.6, 1.3);
    prop("log", 5.8, -1.8, 2.0, { dim: "max" }, "capsule", LOW, ry + 1.5);
    prop("log", 5.9, -1.2, 1.9, { dim: "max" }, "capsule", LOW, ry + 1.6);

    reserved.push({ x: cx, z: cz, r: 10.5 });
    homes.push({ x: cx, z: cz, ry });
    return true;
  }
  homestead(-31, 30, -0.35);  // 支線盡頭的營地旁
  homestead(52, -24, 0.3);    // 過橋後
  homestead(-54, 6, -0.15);   // 出生點東北
  homestead(6, 24, 0.45);     // 中段路北側

  // ---------- 石牆 ----------
  const BIG_STONES = ["rock_a", "rock_b", "rock_c"];
  const SMALL_STONES = ["rock_c", "rock_b"];
  // Blender 石頭是圓潤的寬扁巨石,按底面積(最大邊)縮放,
  // 碰撞半徑直接取底面積的一半,視覺 = 碰撞。
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
        if (!clear || inReserved(x, z, fp * 0.5)) continue;
        const stone = put(BIG_STONES[(Math.random() * BIG_STONES.length) | 0], x, z, fp, undefined, { dim: "max" });
        addOccluder(stone, x, z);
        // 巨石是長橢圓:膠囊沿長軸,貼著輪廓(石頭頂部內收,收 8%)
        addSolid(stone, "capsule", undefined, 0.92);
        if (Math.random() < 0.6) {
          const sx2 = x + (Math.random() - 0.5) * 3;
          const sz2 = z + (Math.random() - 0.5) * 3;
          if (ground.isGrassAt(sx2, sz2) && !inReserved(sx2, sz2)) {
            const pebble = put(SMALL_STONES[(Math.random() * SMALL_STONES.length) | 0], sx2, sz2, 0.8 + Math.random() * 0.8, undefined, { dim: "max" });
            addSolid(pebble, "capsule", LOW, 0.9);
          }
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
  // 針葉(層疊圓團)與闊葉(團塊樹冠)混種。針葉的最下層枝葉幾乎貼地,
  // 碰撞半徑要涵蓋那一圈,否則角色會走進樹裡;闊葉樹冠很高,只擋樹幹。
  const TREES = [
    { name: "tree_conifer_a", h: [5.6, 7.6], r: 0.17 },
    { name: "tree_conifer_b", h: [6.4, 8.6], r: 0.15 },
    { name: "tree_round_a", h: [6.0, 8.0], r: 0.085 },
    { name: "tree_round_b", h: [5.2, 7.0], r: 0.095 },
  ];
  const treePts = [];
  const [sx, sz] = PATH[0];
  for (let i = 0; i < 260 && treePts.length < 70; i++) {
    const x = (Math.random() - 0.5) * (BAL.world.size - 24);
    const z = (Math.random() - 0.5) * (BAL.world.size - 24);
    if (!ground.isGrassAt(x, z)) continue;
    if (Math.hypot(x - sx, z - sz) < 14) continue; // 出生點附近留空
    if (inReserved(x, z, 1.5)) continue;
    if (!collision.isFree(x, z, 1.4)) continue; // 不長進石頭裡
    if (treePts.some(([tx2, tz2]) => Math.hypot(x - tx2, z - tz2) < 7)) continue;
    treePts.push([x, z]);
  }
  for (const [x, z] of treePts) {
    const t = TREES[(Math.random() * TREES.length) | 0];
    const h = t.h[0] + Math.random() * (t.h[1] - t.h[0]);
    addOccluder(put(t.name, x, z, h), x, z);
    collision.addStatic(x, z, Math.max(0.55, h * t.r));
    if (Math.random() < 0.4) {
      const tx2 = x + 2.5 + Math.random() * 2;
      const tz2 = z + (Math.random() - 0.5) * 4;
      if (ground.isGrassAt(tx2, tz2) && !inReserved(tx2, tz2, 1)) {
        const th = 2.6 + Math.random() * 1.2;
        addOccluder(put(Math.random() < 0.5 ? "tree_conifer_a" : "tree_conifer_b", tx2, tz2, th), tx2, tz2);
        collision.addStatic(tx2, tz2, th * 0.16);
      }
    }
  }

  // ---------- 路邊柵欄 ----------
  // fence 一片 3.3 長(Blender 以公尺建模,原尺寸使用),間距對齊片長;
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
        put("fence", fx, fz, 1.0, ang + Math.PI / 2, { dim: "scale" });
        // 一片柵欄 3.3 長、木料約 0.15 厚:一條細膠囊。
        // 舊版是兩個半徑 0.95 的圓,等於在柵欄兩側各多出一公尺看不見的牆。
        collision.addCapsule(fx - dx * 1.6, fz - dz * 1.6, fx + dx * 1.6, fz + dz * 1.6, 0.15, LOW);
      }
    }
  }
  fenceAlong([[12, 8], [22, 6], [28, 6]], 1);
  fenceAlong([[-18, -10], [-8, 2]], -1);
  fenceAlong([[48, 12], [58, 4]], -1);

  // ---------- 橋與溝壑 ----------
  {
    const { x, z, dirTo } = BRIDGE_SPOT;
    // 橋長 10、寬 4.2,橋身沿「模型 x 軸」,要把模型 x 轉到路的方向
    const ang = Math.atan2(dirTo[0] - x, dirTo[1] - z) - Math.PI / 2;
    const bridge = put("bridge", x, z, 1.0, ang, { dim: "scale" });

    // 橋的方向向量(目前是 +x,寫成通式)
    const L = Math.hypot(dirTo[0] - x, dirTo[1] - z);
    const ux = (dirTo[0] - x) / L, uz = (dirTo[1] - z) / L;

    // 橋是純視覺物件：raycast 量出橋板頂面,再把整座橋沉下去,
    // 讓板面貼齊遊戲平面。玩家走過去時 y 完全不變,
    // 但欄杆仍高出地面,視覺上還是一座橋。
    bridge.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    let deckTop = 0;
    for (let i = 0; i <= 16; i++) {
      const along = -4.5 + (9 * i) / 16;
      ray.set(new THREE.Vector3(x + ux * along, 20, z + uz * along), down);
      const hit = ray.intersectObject(bridge, true)[0];
      if (hit) deckTop = Math.max(deckTop, hit.point.y);
    }
    bridge.position.y = BAL.world.gameplayY + 0.05 - deckTop;

    // 溝壑是一條帶狀禁區(寬度 = 畫面上深色溝底),唯一開口是橋面。
    // 在橋上時左右被欄杆內側夾住,不會一半在橋上、一半懸在溝上。
    collision.addRavine(RAVINE, RAVINE_HALF, [bridgeOpening()]);

    // 橋墩木樁:在水面高度圖上蓋小圓丘,白沫會繞著木樁長出來
    for (const a of [-1.6, 1.6]) {
      for (const side of [-1.55, 1.55]) {
        stream.addObstacle(x + ux * a - uz * side, z + uz * a + ux * side, 0.22, 0.3);
      }
    }

    // 欄杆本身:兩條細膠囊。溝壑以外(橋頭搭在岸上的那一段)靠它擋住側面。
    for (const side of [-BRIDGE.railOffset, BRIDGE.railOffset]) {
      const a = BRIDGE.halfLen - 0.15;
      collision.addCapsule(
        x - ux * a - uz * side, z - uz * a + ux * side,
        x + ux * a - uz * side, z + uz * a + ux * side,
        0.08, LOW
      );
    }
  }

  // ---------- 水裡與岸邊的石頭 ----------
  // 水裡的石頭坐在河床/湖底上,露出水面的部分會被蓋進高度圖 → 自動繞一圈白沫
  {
    const centerX = (z) => {
      for (let i = 0; i < RAVINE.length - 1; i++) {
        const [ax, az] = RAVINE[i], [bx, bz] = RAVINE[i + 1];
        if (z >= az && z <= bz) return ax + ((bx - ax) * (z - az)) / (bz - az);
      }
      return RAVINE[0][0];
    };
    const wetMats = new Map();
    const placeInWater = (water, x, z, size) => {
      const rock = put(Math.random() < 0.6 ? "rock_c" : "rock_b", x, z, size, undefined, { dim: "max" });
      rock.position.y = terrainHeight(x, z) - size * 0.18;
      rock.updateMatrixWorld(true);
      _box.setFromObject(rock).getSize(_size);
      water.addObstacle(x, z, Math.min(_size.x, _size.z) * 0.5, _box.max.y);
      // 濕石頭:顏色略深、比較亮滑(每種原始材質只複製一次)
      rock.traverse((m) => {
        if (!m.isMesh) return;
        if (!wetMats.has(m.material)) {
          const wet = m.material.clone();
          wet.color = new THREE.Color(0.78, 0.8, 0.78);
          wet.roughness = 0.5;
          wetMats.set(m.material, wet);
        }
        m.material = wetMats.get(m.material);
      });
    };
    for (let i = 0; i < 46; i++) {
      const z = (Math.random() - 0.5) * 200;
      if (Math.abs(z - BRIDGE_SPOT.z) < 4) continue;
      const x = centerX(z) + (Math.random() - 0.5) * 2 * (RAVINE_HALF - 0.8);
      placeInWater(stream, x, z, 0.5 + Math.random() * 1.0);
    }
    for (let i = 0, n = 0; i < 200 && n < 16; i++) {
      const x = LAKE_BOUNDS.x0 + Math.random() * (LAKE_BOUNDS.x1 - LAKE_BOUNDS.x0);
      const z = LAKE_BOUNDS.z0 + Math.random() * (LAKE_BOUNDS.z1 - LAKE_BOUNDS.z0);
      const sd = lakeSDF(x, z);
      if (sd > -1.0 || z < -96) continue;
      // 靠岸的石頭大一點、露出水面;湖中央的小,大多沉在水下
      placeInWater(lake, x, z, sd > -4 ? 1.0 + Math.random() * 1.2 : 0.6 + Math.random() * 0.8);
      n++;
    }
    // 沙灘上的石頭(擋人不擋子彈)
    for (let i = 0, n = 0; i < 200 && n < 8; i++) {
      const x = LAKE_BOUNDS.x0 + Math.random() * (LAKE_BOUNDS.x1 - LAKE_BOUNDS.x0);
      const z = -80 + Math.random() * 24;
      const sd = lakeSDF(x, z);
      if (sd < 1.2 || sd > 3.5 || !collision.isFree(x, z, 1.2)) continue;
      addSolid(put(Math.random() < 0.5 ? "rock_b" : "rock_a", x, z, 1.0 + Math.random() * 1.0, undefined, { dim: "max" }),
        "capsule", LOW, 0.9);
      n++;
    }
  }
  stream.finalize();
  lake.finalize();

  // 湖裡的魚影:路線要整圈都在夠深的地方(離岸 4 公尺以上),才不會游進沙灘
  const fishPaths = [];
  for (let i = 0; i < 400 && fishPaths.length < 14; i++) {
    const [cx, cz, cr] = LAKE_CIRCLES[(Math.random() * LAKE_CIRCLES.length) | 0];
    const x = cx + (Math.random() - 0.5) * cr, z = cz + (Math.random() - 0.5) * cr;
    const r = 1.5 + Math.random() * 4;
    let ok = true;
    for (let k = 0; k < 16 && ok; k++) {
      const a = (k / 16) * Math.PI * 2;
      ok = lakeSDF(x + Math.cos(a) * r, z + Math.sin(a) * r) < -4;
    }
    if (ok) fishPaths.push({ x, z, r, speed: 0.6 + Math.random() * 0.8, phase: Math.random() * 6.28, dir: Math.random() < 0.5 ? 1 : -1 });
  }
  const fish = new FishSchool(scene, fishPaths, WATER_Y - 0.4);

  // ---------- 水邊植物:蘆葦、水草、睡蓮 ----------
  // 都依「地形高度」決定長在哪:蘆葦在岸邊的淺水(水深 0~0.4),水草沉在較深的水底,
  // 睡蓮浮在湖面較深處。橋附近留空,免得擋住橋墩。
  const waterAreas = [STREAM_BOUNDS, LAKE_BOUNDS];
  const randomIn = (b) => [b.x0 + Math.random() * (b.x1 - b.x0), b.z0 + Math.random() * (b.z1 - b.z0)];
  const nearBridge = (x, z) => Math.hypot(x - BRIDGE_SPOT.x, z - BRIDGE_SPOT.z) < 7;
  const reedM = [], weedM = [], padM = [], lilyM = [];
  // 蘆葦:成叢長在岸邊
  for (let c = 0, tries = 0; c < 70 && tries < 4000; tries++) {
    const area = waterAreas[Math.random() < 0.55 ? 0 : 1];
    const [cx, cz] = randomIn(area);
    const h = terrainHeight(cx, cz);
    if (h > -0.03 || h < WATER_Y - 0.35 || nearBridge(cx, cz) || Math.abs(cz) > 100) continue;
    c++;
    const n = 2 + ((Math.random() * 5) | 0);
    for (let k = 0; k < n; k++) {
      const x = cx + (Math.random() - 0.5) * 2.4, z = cz + (Math.random() - 0.5) * 2.4;
      const y = terrainHeight(x, z);
      if (y > -0.02 || y < WATER_Y - 0.4 || nearBridge(x, z)) continue;
      reedM.push(placeMatrix(x, y, z, Math.random() * 6.28, 0.75 + Math.random() * 0.55));
    }
  }
  // 水草:水底(水深 0.3~0.95,太深會被水色蓋掉),透過透明的水看得到它們隨水流擺動
  for (let i = 0, tries = 0; i < 320 && tries < 8000; tries++) {
    const [x, z] = randomIn(waterAreas[Math.random() < 0.5 ? 0 : 1]);
    const y = terrainHeight(x, z);
    const depth = WATER_Y - y;
    if (depth < 0.3 || depth > 0.95 || nearBridge(x, z) || Math.abs(z) > 100) continue;
    weedM.push(placeMatrix(x, y, z, Math.random() * 6.28, 1.1 + Math.random() * 0.8));
    i++;
  }
  // 睡蓮:湖面成片,少數開花
  for (let c = 0, tries = 0; c < 22 && tries < 3000; tries++) {
    const [cx, cz] = randomIn(LAKE_BOUNDS);
    if (WATER_Y - terrainHeight(cx, cz) < 0.5 || cz < -94) continue;
    c++;
    const n = 1 + ((Math.random() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const x = cx + (Math.random() - 0.5) * 2.2, z = cz + (Math.random() - 0.5) * 2.2;
      if (WATER_Y - terrainHeight(x, z) < 0.4) continue;
      const m = placeMatrix(x, WATER_Y - 0.012, z, Math.random() * 6.28, 0.9 + Math.random() * 0.5);
      (Math.random() < 0.25 ? lilyM : padM).push(m);
    }
  }
  const plants = [
    new InstancedProp(scene, assets, "reeds", reedM, { sway: 0.035, swayFreq: 1.4, castShadow: true }),
    new InstancedProp(scene, assets, "waterweed", weedM, { sway: 0.22, swayFreq: 2.0 }),
    new InstancedProp(scene, assets, "lilypad", padM),
    new InstancedProp(scene, assets, "lily", lilyM),
  ];

  // ---------- 木箱營地 ----------
  function camp(cx, cz) {
    const props = [
      ["crate", 0, 0, 1.5], ["crate", 1.9, 0.9, 1.0], ["crate", 0.5, 2.1, 0.85],
      ["barrel", 0.6, -1.4, 1.15], ["barrel", 3.1, -0.9, 1.25], ["chest", 4.0, 2.3, 0.8],
    ];
    for (const [name, dx, dz, h] of props) {
      const holder = put(name, cx + dx, cz + dz, h);
      // 木箱、寶箱是方的,木桶是圓的:形狀照模型,不是一律用圓
      addSolid(holder, name === "barrel" ? "circle" : "box", undefined, 0.97);
      addOccluder(holder, cx + dx, cz + dz);
    }
  }
  camp(-28, 18);  // 支線盡頭
  camp(44, -8);   // 主路後段旁

  // ---------- 散景 ----------
  for (let i = 0; i < 110; i++) {
    const x = (Math.random() - 0.5) * (BAL.world.size - 18);
    const z = (Math.random() - 0.5) * (BAL.world.size - 18);
    if (!ground.isGrassAt(x, z)) continue;
    if (inReserved(x, z)) continue;
    if (!collision.isFree(x, z, 0.8)) continue; // 不長進石頭/木箱裡
    const p = Math.random();
    if (p < 0.38) put("bush", x, z, 0.8 + Math.random() * 0.6);
    else if (p < 0.66) put("bush_flower", x, z, 0.7 + Math.random() * 0.5);
    else if (p < 0.8) addSolid(put("rock_c", x, z, 0.6 + Math.random() * 0.7, undefined, { dim: "max" }), "capsule", LOW, 0.9);
    else if (p < 0.9) addSolid(put("stump", x, z, 0.45 + Math.random() * 0.2), "circle", LOW, 0.9);
    else addSolid(put("log", x, z, 1.6 + Math.random() * 0.6, undefined, { dim: "max" }), "capsule", LOW, 0.95);
  }

  // ---------- 花海(成片的藍、紫、白小花) ----------
  new FlowerField(scene, (x, z) => ground.isGrassAt(x, z) && !inReserved(x, z, -4));

  // ---------- 界外森林(純視覺,沒有碰撞) ----------
  // 俯視角遊戲的邊界通常是一道「自然的牆」:這裡是石牆外緊貼一圈灌木,
  // 再往外兩三排越來越密的樹林,地圖就像是林間的一塊空地,而不是懸在半空的一塊地。
  // 方形外圈上取點:d = 離邊界的距離
  const onRing = (d) => {
    const side = (Math.random() * 4) | 0, u = (Math.random() * 2 - 1) * (HALF + d);
    const r = HALF + d;
    return side === 0 ? [u, -r] : side === 1 ? [u, r] : side === 2 ? [-r, u] : [r, u];
  };
  const outsideOk = (x, z, water) => ravineDistance(x, z) >= RAVINE_HALF + water && lakeSDF(x, z) >= water + 2;
  const scale = IS_TOUCH ? 0.6 : 1; // 手機少放一點
  // 石牆外緊貼的灌木(擋住牆腳和外面地面的交界)
  for (let i = 0; i < 150 * scale; i++) {
    const [x, z] = onRing(-1 + Math.random() * 6);
    if (!outsideOk(x, z, 2)) continue;
    put(Math.random() < 0.7 ? "bush" : "bush_flower", x, z, 1.3 + Math.random() * 1.1, undefined, { dim: "y", center: true });
  }
  // 樹林:越往外越密、越高
  for (let i = 0; i < 190 * scale; i++) {
    const d = 3 + Math.pow(Math.random(), 0.7) * 20;
    const [x, z] = onRing(d);
    if (!outsideOk(x, z, 3)) continue;
    const t = TREES[(Math.random() * TREES.length) | 0];
    put(t.name, x, z, (t.h[0] + Math.random() * (t.h[1] - t.h[0])) * (1 + d / 40));
  }

  // ---------- 出口 ----------
  const [ex, ez] = PATH[PATH.length - 1];
  const [px2, pz2] = PATH[PATH.length - 2];
  const exitAng = Math.atan2(ex - px2, ez - pz2);
  // 大門橫跨路面:模型 x 軸(橫梁)轉到與路垂直的方向 side(),
  // 門柱在 ±1.9,兩側各接一片柵欄(中心 ±3.55,長 3.3)。
  // 旋轉 exitAng 時模型 x 軸在世界是 (cos, -sin),正好是 side() 的方向。
  put("gate", ex, ez, 1.0, exitAng, { dim: "scale" });
  const side = (d) => [ex + Math.cos(exitAng) * d, ez - Math.sin(exitAng) * d];
  for (const sgn of [-1, 1]) {
    const [fx, fz] = side(sgn * 3.55);
    put("fence", fx, fz, 1.0, exitAng, { dim: "scale" });
    const [px, pz] = side(sgn * 1.9);
    collision.addStatic(px, pz, 0.22, LOW);
    const [ax, az] = side(sgn * 1.9);
    const [bx, bz] = side(sgn * 5.2);
    collision.addCapsule(ax, az, bx, bz, 0.15, LOW);
  }

  // 回家的招牌(跟著語言換字)
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const c2 = cv.getContext("2d");
  const signTex = new THREE.CanvasTexture(cv);
  const drawSign = () => {
    c2.clearRect(0, 0, 256, 64);
    c2.font = "bold 42px system-ui, 'Noto Sans TC', sans-serif";
    c2.fillStyle = "#ffd98a";
    c2.textAlign = "center";
    c2.fillText(t("sign.home"), 128, 48);
    signTex.needsUpdate = true;
  };
  drawSign();
  bus.on("lang:changed", drawSign);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.5),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true })
  );
  label.position.set(ex, 4, ez);
  // 面向相機所在的方向。舊版是 lookAt(場景中心)，相機在反側，
  // 單面材質從背面看等於完全不存在,EXIT 招牌在遊戲中根本看不到。
  label.lookAt(label.position.clone().add(CAMERA_OFFSET));
  scene.add(label);

  // 出口地面光圈
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.0, 2.5, 40),
    new THREE.MeshBasicMaterial({ color: 0xffc96b, transparent: true, opacity: 0.5 })
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
    outerGrass,
    // 水面、水底光紋、魚影都跟著時間動
    updateWater(t) {
      stream.setTime(t);
      lake.setTime(t);
      ground.setTime(t);
      fish.update(t);
      for (const p of plants) p.setTime(t);
    },
    stream,
    lake,
    occluders,
    isGrassAt: ground.isGrassAt,
    // 挖寶土堆可以放的地方:草地或泥土路(平地),不在農舍保留區裡
    canDig: (x, z) => terrainHeight(x, z) === 0 && lakeSDF(x, z) > 4 && ravineDistance(x, z) > RAVINE_HALF + 3
      && !inReserved(x, z, 2),
    playerStart,
    startYaw,
    exitPos: new THREE.Vector3(ex, 0, ez),
    // 從家裡出來:站在大門內側幾步、背對大門
    returnPos: new THREE.Vector3(ex - Math.sin(exitAng) * 4, 0, ez - Math.cos(exitAng) * 4),
    returnYaw: exitAng + Math.PI,
    pathPoints: [...PATH, ...SIDE_PATH],
    homes,
  };
}
