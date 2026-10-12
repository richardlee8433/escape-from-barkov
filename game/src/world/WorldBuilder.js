import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { buildGround, buildOuterGround, PATH, SIDE_PATH, RAVINE, BRIDGE_SPOT } from "./GroundPaint.js";
import { GrassField } from "./Grass.js";
import { FlowerField } from "./Flowers.js";
import { CAMERA_OFFSET } from "../render/CameraRig.js";

// 把整張地圖搭出來：光、地面、草、石牆、樹、營地、橋、出口。
// 需要擋路的東西都跟 collision 註冊圓形碰撞體。

const HALF = BAL.world.size / 2;

export function buildWorld(scene, assets, collision) {
  // ---------- 光 ----------
  const sun = new THREE.DirectionalLight(0xffe2b8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
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
  scene.add(buildOuterGround());

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

  // 量出物件的實際底面積,取內接半徑並留 5% 寬容,讓碰撞貼合視覺
  const _box = new THREE.Box3();
  const _size = new THREE.Vector3();
  function footprintRadius(holder) {
    holder.updateMatrixWorld(true);
    _box.setFromObject(holder).getSize(_size);
    return Math.min(_size.x, _size.z) * 0.5 * 0.95;
  }

  // 夠高、可能擋住玩家或敵人的物件登記成遮蔽體,交給相機做淡出。
  // 半徑量「視覺外接圓」而不是碰撞半徑——碰撞圓通常比模型窄(樹幹 vs 樹冠),
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
    // 牆體約 8.8 x 5.5,用 2 x 5 個圓鋪滿(擋人也擋子彈);半徑要夠大,兩排圓之間才不會留縫讓子彈穿過
    for (const lx of [-3.3, -1.65, 0, 1.65, 3.3])
      for (const lz of [-1.4, 1.4]) {
        const [x, z] = W(lx * S, lz * S);
        collision.addStatic(x, z, 1.6);
      }

    const prop = (name, lx, lz, h, opts, r, rot) => {
      const [x, z] = W(lx, lz);
      const holder = put(name, x, z, h, rot ?? Math.random() * Math.PI * 2, opts);
      if (r) collision.addStatic(x, z, r);
      return [holder, x, z];
    };
    const [well, wx, wz] = prop("well", -8, 2.5, 1.0, { dim: "scale" }, 1.25, ry + 0.4);
    addOccluder(well, wx, wz);
    prop("barrel", 5.6, 3.6, 1.15, undefined, 0.5);
    prop("barrel", 6.5, 4.3, 1.1, undefined, 0.5);
    prop("crate", 6.2, 2.4, 0.9, undefined, 0.6, ry + 0.2);
    prop("bush_flower", -4.6, 3.8, 1.0);
    prop("bush_flower", 3.6, 4.6, 0.85);
    prop("bush", -5.7, -2.6, 1.3);
    prop("log", 5.8, -1.8, 2.0, { dim: "max" }, 0, ry + 1.5);
    prop("log", 5.9, -1.2, 1.9, { dim: "max" }, 0, ry + 1.6);

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
        addOccluder(put(BIG_STONES[(Math.random() * BIG_STONES.length) | 0], x, z, fp, undefined, { dim: "max" }), x, z);
        collision.addStatic(x, z, fp * 0.42);
        if (Math.random() < 0.6) {
          const sx2 = x + (Math.random() - 0.5) * 3;
          const sz2 = z + (Math.random() - 0.5) * 3;
          if (ground.isGrassAt(sx2, sz2) && !inReserved(sx2, sz2))
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

    // 橋兩側欄杆碰撞:走在橋上不會從側面掉進溝壑(擋人不擋子彈)。
    // 欄杆拉到 ±2.4、半徑收到 0.45,中間留出約 2.9 寬的通道——
    // 這是通往 EXIT 的唯一路線,窄到得瞄準才過得去就太難受了。
    for (let a = -4.2; a <= 4.2; a += 1.2) {
      for (const side of [-2.4, 2.4]) {
        collision.addStatic(x + ux * a - uz * side, z + uz * a + ux * side, 0.45, { blocksBullets: false });
      }
    }

    // 溝壑不可通行,只留橋這個開口(擋移動、不擋子彈)。
    // 開口半徑要大於溝壑圓半徑,否則溝壑會反過來卡住橋口。
    for (let i = 0; i < RAVINE.length - 1; i++) {
      const [ax, az] = RAVINE[i], [bx, bz] = RAVINE[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(len / 2);
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const cx = ax + (bx - ax) * t;
        const cz = az + (bz - az) * t;
        if (Math.hypot(cx - x, cz - z) < 4.5) continue; // 橋面開口
        collision.addStatic(cx, cz, 2.2, { blocksBullets: false });
      }
    }
  }

  // ---------- 木箱營地 ----------
  function camp(cx, cz) {
    const props = [
      ["crate", 0, 0, 1.5], ["crate", 1.9, 0.9, 1.0], ["crate", 0.5, 2.1, 0.85],
      ["barrel", 0.6, -1.4, 1.15], ["barrel", 3.1, -0.9, 1.25], ["chest", 4.0, 2.3, 0.8],
    ];
    for (const [name, dx, dz, h] of props) {
      const holder = put(name, cx + dx, cz + dz, h);
      // 碰撞半徑取「實際底面積」而不是高度——舊版用 h*0.65,
      // 高的木箱會撐出一圈看不見的牆,矮的又會被穿模。
      const r = footprintRadius(holder);
      collision.addStatic(cx + dx, cz + dz, r);
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
    else if (p < 0.8) put("rock_c", x, z, 0.6 + Math.random() * 0.7, undefined, { dim: "max" });
    else if (p < 0.9) put("stump", x, z, 0.45 + Math.random() * 0.2);
    else put("log", x, z, 1.6 + Math.random() * 0.6, undefined, { dim: "max" });
  }

  // ---------- 花海(成片的藍、紫、白小花) ----------
  new FlowerField(scene, (x, z) => ground.isGrassAt(x, z) && !inReserved(x, z, -4));

  // ---------- 界外森林(純視覺,沒有碰撞;邊界石牆外一圈樹,地圖不再像懸在半空) ----------
  for (let i = 0; i < 110; i++) {
    const a = Math.random() * Math.PI * 2;
    const ring = HALF + 1 + Math.random() * 14;
    // 方形地圖:沿方形外圈取點
    const x = Math.max(-ring, Math.min(ring, Math.cos(a) * ring * 1.5));
    const z = Math.max(-ring, Math.min(ring, Math.sin(a) * ring * 1.5));
    const t = TREES[(Math.random() * TREES.length) | 0];
    put(t.name, x, z, t.h[0] + Math.random() * (t.h[1] - t.h[0]) * 1.2);
  }

  // ---------- 出口 ----------
  const [ex, ez] = PATH[PATH.length - 1];
  const [px2, pz2] = PATH[PATH.length - 2];
  const exitAng = Math.atan2(ex - px2, ez - pz2);
  // 大門柱在 ±1.9,兩側各接一片柵欄(中心 ±3.55)
  put("gate", ex, ez, 1.0, exitAng + Math.PI / 2, { dim: "scale" });
  const side = (d) => [ex + Math.cos(exitAng) * d, ez - Math.sin(exitAng) * d];
  for (const sgn of [-1, 1]) {
    const [fx, fz] = side(sgn * 3.55);
    put("fence", fx, fz, 1.0, exitAng + Math.PI / 2, { dim: "scale" });
    for (const d of [1.9, 2.8, 4.4]) {
      const [cx, cz] = side(sgn * d);
      collision.addStatic(cx, cz, d === 1.9 ? 0.35 : 0.8, { blocksBullets: false });
    }
  }

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
  // 面向相機所在的方向。舊版是 lookAt(場景中心)，相機在反側，
  // 單面材質從背面看等於完全不存在——EXIT 招牌在遊戲中根本看不到。
  label.lookAt(label.position.clone().add(CAMERA_OFFSET));
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
    occluders,
    isGrassAt: ground.isGrassAt,
    playerStart,
    startYaw,
    exitPos: new THREE.Vector3(ex, 0, ez),
    pathPoints: [...PATH, ...SIDE_PATH],
    homes,
  };
}
