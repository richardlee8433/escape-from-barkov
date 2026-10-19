import * as THREE from "three";
import { Collision } from "../systems/Collision.js";
import { GrassField } from "./Grass.js";
import { HOME_SCALE as S } from "../config/home.js";
import { YARD, HOUSE, HOUSE_HALF, FRONT_DOOR, YARD_GATE, GARDEN } from "../config/yard.js";

// 柯基家的院子(屋外場景)。自己一個 THREE.Scene,回家時先到這裡,站在小屋門口。
//
// - 小屋外觀跟著室內的修理進度換模型:屋頂破洞、窗戶釘木板、煙囪塌一半;壁爐修好後煙囪冒煙
// - 柵欄圍出一塊 26.6 × 21 公尺的院子(小屋佔地的 4 倍),右邊與前面的草地空著,留給之後的花園
// - 前面柵欄的門出去回到村子;柵欄外是一圈樹林當背景
const EXT_MODELS = {
  roof: ["home_ext_roof_broken", "home_ext_roof"],
  window: ["home_ext_windows_broken", "home_ext_windows"],
  fireplace: ["home_ext_chimney_broken", "home_ext_chimney"],
};
const FENCE_LEN = 3.3; // 柵欄模型一段的長度(scale 1)
const VIEW = 90;       // 地面與草地的範圍(公尺)

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// 點到折線的距離(小路)
function distToPath(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

export class YardScene {
  constructor(assets, state) {
    this.state = state;
    this.assets = assets;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xaebfa8);
    this.scene.fog = new THREE.Fog(0xaebfa8, 45, 95);
    this.rng = rand(20261019);
    this.collision = new Collision();
    // 門口到院子大門的小路
    this.path = [
      [FRONT_DOOR.x + 0.4, FRONT_DOOR.z], [FRONT_DOOR.x + 3.2, FRONT_DOOR.z + 0.8],
      [YARD_GATE.x - 0.6, YARD_GATE.z - 6], [YARD_GATE.x, YARD_GATE.z - 1.2], [YARD_GATE.x, YARD_GATE.z + 6],
    ];

    this._lights();
    this._ground();
    this._house();
    this._fence();
    this._backdrop();
    this._smoke();
    this._markers();
    this.t = 0;
    this.apply();
  }

  // ---------------------------------------------------------------- 建置

  _lights() {
    const sun = new THREE.DirectionalLight(0xffe2b8, 3.1);
    sun.position.set(-10, 27, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -32; c.right = 32; c.top = 32; c.bottom = -32; c.near = 1; c.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target, new THREE.HemisphereLight(0xc4d8ea, 0x4d5a2e, 0.85));
  }

  // 地面:一張畫出來的貼圖(草地、院子裡較亮的草坪、泥土小路、屋簷下的陰影),草葉的顏色也取樣它
  _ground() {
    const N = 512;
    const cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const c = cv.getContext("2d");
    const img = c.createImageData(N, N);
    const r = this.rng;
    const noise = new Float32Array(N * N).map(() => r());
    const px = (x, z) => [((x / VIEW) + 0.5) * N, ((z / VIEW) + 0.5) * N];
    const colors = new Uint8ClampedArray(N * N * 3);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * VIEW, z = (j / N - 0.5) * VIEW;
        const n = noise[j * N + i] * 0.5 + 0.5 * Math.sin(x * 0.7 + Math.sin(z * 0.5) * 2) * 0.5 + 0.25;
        // 草地:院子裡的草坪亮一點、整齊一點;外面雜一點、暗一點
        const inYard = x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1;
        let col = inYard ? [104 + n * 22, 146 + n * 22, 62 + n * 10] : [86 + n * 26, 124 + n * 28, 52 + n * 14];
        const dp = distToPath(x, z, this.path);
        if (dp < 1.35) {
          const k = Math.min(1, (1.35 - dp) / 0.35);
          const dirt = [150 + n * 18, 112 + n * 14, 74 + n * 10];
          col = col.map((v, q) => v + (dirt[q] - v) * k);
        }
        const k = (j * N + i) * 3;
        colors[k] = col[0]; colors[k + 1] = col[1]; colors[k + 2] = col[2];
        const o = (j * N + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(VIEW, VIEW), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const colorAt = (x, z) => {
      const [u, v] = px(x, z);
      const i = Math.max(0, Math.min(N - 1, Math.floor(u))), j = Math.max(0, Math.min(N - 1, Math.floor(v)));
      const k = (j * N + i) * 3;
      return [colors[k], colors[k + 1], colors[k + 2]];
    };
    const inHouse = (x, z) => Math.abs(x - HOUSE.x) < HOUSE_HALF.x + 0.5 && Math.abs(z - HOUSE.z) < HOUSE_HALF.z + 0.5;
    const isGrassAt = (x, z) => !inHouse(x, z) && distToPath(x, z, this.path) > 1.2 && Math.hypot(x, z) < VIEW / 2 - 2;
    // 柵欄裡是修剪過的草坪(矮一半),之後的花園就種在上面
    const inYard = (x, z) => x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1;
    this.grass = new GrassField(this.scene, isGrassAt, colorAt, 26000, VIEW, (x, z) => (inYard(x, z) ? 0.45 : 1));
  }

  _put(name, x, z, ry, target = 1, opts = { dim: "scale" }) {
    const o = this.assets.instantiate(name, target, opts);
    const g = new THREE.Group();
    g.add(o);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);
    return g;
  }

  // 小屋外觀:和室內一樣以房間座標建模,整個放大 S 倍
  _house() {
    this.house = new THREE.Group();
    this.house.position.set(HOUSE.x, 0, HOUSE.z);
    this.house.scale.setScalar(S);
    this.scene.add(this.house);
    this.house.add(this.assets.cloneRaw("home_ext_shell"));
    this.ext = {};
    for (const [id, [broken, fixed]] of Object.entries(EXT_MODELS)) {
      const b = this.assets.cloneRaw(broken), f = this.assets.cloneRaw(fixed);
      this.house.add(b, f);
      this.ext[id] = { b, f };
    }
    // 小屋佔的地方不能走(門口的踏石可以站)
    this.collision.addBox(HOUSE.x, HOUSE.z, 0, HOUSE_HALF.x + 0.15, HOUSE_HALF.z + 0.15);
    // 煙囪在左山牆外側
    this.collision.addBox(HOUSE.x - HOUSE_HALF.x - 0.5, HOUSE.z - 1.0 * S, 0, 0.6, 1.0);
  }

  // 柵欄一圈,前面留一道門
  _fence() {
    const LOW = { blocksBullets: false };
    const side = (x0, z0, x1, z1, gap = null) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const ry = Math.atan2(-uz, ux);
      const spans = gap ? [[0, gap[0]], [gap[1], len]] : [[0, len]];
      for (const [a, b] of spans) {
        const n = Math.max(1, Math.round((b - a) / FENCE_LEN));
        const segLen = (b - a) / n;
        for (let k = 0; k < n; k++) {
          const m = a + (k + 0.5) * segLen;
          this._put("fence", x0 + ux * m, z0 + uz * m, ry, segLen / FENCE_LEN);
        }
        this.collision.addCapsule(x0 + ux * a, z0 + uz * a, x0 + ux * b, z0 + uz * b, 0.2, LOW);
      }
    };
    const { x0, x1, z0, z1 } = YARD;
    side(x0, z0, x1, z0);
    side(x1, z0, x1, z1);
    side(x0, z1, x0, z0);
    // 前面:從左往右,大門那一段空出來
    const g0 = YARD_GATE.x - YARD_GATE.half - x0, g1 = YARD_GATE.x + YARD_GATE.half - x0;
    side(x0, z1, x1, z1, [g0, g1]);
    this._put("gate", YARD_GATE.x, YARD_GATE.z, 0, 1);
    for (const sx of [-1, 1]) this.collision.addStatic(YARD_GATE.x + sx * YARD_GATE.half, YARD_GATE.z, 0.25, LOW);
    // 大門外擋一道:出門要按 E(和室內的門一樣),不是直接走出去
    this.collision.addCapsule(YARD_GATE.x - 2.2, YARD_GATE.z + 1.0, YARD_GATE.x + 2.2, YARD_GATE.z + 1.0, 0.3, LOW);
  }

  // 柵欄外:一圈樹林、灌木和石頭(院子裡面保持空曠)
  _backdrop() {
    const r = this.rng;
    const trees = ["tree_round_a", "tree_round_b", "tree_conifer_a", "tree_conifer_b"];
    const heights = { tree_round_a: 7, tree_round_b: 6.2, tree_conifer_a: 6.8, tree_conifer_b: 7.6 };
    const clear = (x, z) => distToPath(x, z, this.path) > 3.5;
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 46; tries++) {
      const a = r() * Math.PI * 2;
      const d = 19 + r() * 18;
      const x = Math.cos(a) * d * 1.15, z = Math.sin(a) * d;
      if (x > YARD.x0 - 3 && x < YARD.x1 + 3 && z > YARD.z0 - 3 && z < YARD.z1 + 3) continue;
      if (!clear(x, z)) continue;
      // 鏡頭在 +x +z 那一側:那邊只放矮的灌木,不擋住院子
      const front = x + z > 22;
      const name = front ? (r() < 0.6 ? "bush" : "bush_flower") : trees[Math.floor(r() * trees.length)];
      const h = front ? 1.1 + r() * 0.6 : heights[name] * (0.85 + r() * 0.3);
      this._put(name, x, z, r() * Math.PI * 2, h, { dim: "y", center: true });
      placed++;
    }
    for (let k = 0; k < 10; k++) {
      const a = r() * Math.PI * 2, d = 16 + r() * 10;
      const x = Math.cos(a) * d * 1.2, z = Math.sin(a) * d;
      if (!clear(x, z) || (x > YARD.x0 - 2 && x < YARD.x1 + 2 && z > YARD.z0 - 2 && z < YARD.z1 + 2)) continue;
      this._put(["rock_a", "rock_b", "rock_c"][k % 3], x, z, r() * 6.28, 0.7 + r() * 0.8, { dim: "y", center: true });
    }
  }

  // 壁爐修好之後,煙囪冒煙
  _smoke() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const c = cv.getContext("2d");
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(235,232,226,0.9)");
    g.addColorStop(1, "rgba(235,232,226,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    // 煙囪頂(房間單位 → 世界):左山牆外側、屋脊上方
    // 煙囪頂:屋脊高 = 牆高 3.2 + (半深 3.75 + 0.05) × tan 42°,煙囪再高出 0.9,加上煙囪管
    const apex = 3.2 + 3.8 * Math.tan((42 * Math.PI) / 180);
    this.smokeFrom = new THREE.Vector3(HOUSE.x + (-4.75 - 0.36) * S, (apex + 1.35) * S, HOUSE.z - 1.0 * S);
    this.smoke = [];
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.t = i / 14;
      this.scene.add(sp);
      this.smoke.push(sp);
    }
  }

  // 門口與大門:按 E 會作用的地方,地上亮一圈
  _markers() {
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.75, depthWrite: false })
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);
  }

  // ---------------------------------------------------------------- 狀態

  // 依 HomeState 換屋頂、窗戶、煙囪
  apply() {
    for (const [id, m] of Object.entries(this.ext)) {
      const ok = this.state.isRepaired(id);
      m.b.visible = !ok;
      m.f.visible = ok;
    }
    this.smokeOn = this.state.isRepaired("fireplace");
  }

  setFocus(pt) {
    this.focusRing.visible = !!pt;
    if (pt) this.focusRing.position.set(pt[0], 0.04, pt[1]);
  }

  // 花園空地(之後的功能用;現在只是確認這些地方空著)
  get gardenAreas() {
    return GARDEN;
  }

  frame(dt, t) {
    this.t = t;
    this.grass.setTime(t);
    for (const sp of this.smoke) {
      if (!this.smokeOn) { sp.visible = false; continue; }
      sp.visible = true;
      const u = (sp.userData.t + t * 0.12) % 1;
      sp.position.set(this.smokeFrom.x + u * 1.6 + Math.sin(t + u * 6) * 0.25, this.smokeFrom.y + u * 5.5, this.smokeFrom.z - u * 0.8);
      sp.scale.setScalar(0.7 + u * 2.4);
      sp.material.opacity = Math.sin(Math.PI * u) * 0.55;
    }
    if (this.focusRing.visible) this.focusRing.material.opacity = 0.55 + 0.25 * Math.sin(t * 5);
  }
}
