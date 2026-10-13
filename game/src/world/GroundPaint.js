import * as THREE from "three";
import { BAL } from "../config/balance.js";

// 手繪風地面：草地底色 + 泥土路 + 溝壑，全部畫在一張 canvas 上。
// 同一張圖同時當貼圖與資料來源（isGrassAt 取樣決定草葉/樹能不能長）。

const SIZE = BAL.world.size;
const TEX = 2048;

// 主路：出生點（左）→ 出口（右)，蜿蜒 S 型
// 過溝那段(28,6)→(40,6)刻意拉直成水平,和垂直的溝壑成 90°,橋才不會歪
export const PATH = [
  [-70, -16], [-58, -26], [-46, -14], [-32, -24], [-18, -10],
  [-8, 2], [2, -4], [12, 8], [22, 6], [28, 6],
  [40, 6], [48, 12], [58, 4], [66, 10], [72, 10],
];
// 支線：通往木箱營地
export const SIDE_PATH = [[-8, 2], [-16, 12], [-26, 16]];
// 溝壑（過橋區段拉直成垂直）。兩端延伸到地圖外,溝與河流一路流進霧裡
export const RAVINE = [[33, -140], [33, -80], [34, -34], [34, -8], [34, 22], [35, 52], [34, 80], [34, 140]];
export const BRIDGE_SPOT = { x: 34, z: 6, dirTo: [40, 6] };

// 溝壑深色部分的半寬。畫面與碰撞共用這一個數字:
// 深色溝底一律畫在這條線以內,碰撞也以它為準,看到的邊緣就是走不過去的邊緣。
export const RAVINE_HALF = 3.0;

// 溝壑的立體形狀:崖邊在 RAVINE_HALF(= 碰撞邊界,角色永遠站在平地上),
// 往內陡降到深 RAVINE_DEPTH 的溝底,溝底半寬 FLOOR_HALF。河面在 WATER_Y。
export const RAVINE_DEPTH = 3.0;
export const FLOOR_HALF = 1.4;
export const WATER_Y = -2.35;
export const WATER_HALF = 2.6; // 河面略寬於水線,邊緣藏進岩壁裡

// 到溝壑中心線的水平距離
export function ravineDistance(x, z) {
  let best = Infinity;
  for (let i = 0; i < RAVINE.length - 1; i++) {
    const [ax, az] = RAVINE[i], [bx, bz] = RAVINE[i + 1];
    const vx = bx - ax, vz = bz - az;
    let t = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}

// 決定性的 2D value noise(地形要每次一樣,不能用 Math.random)
function hash2(i, j) {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

// 地形高度:溝壑以外一律 0(遊戲平面),溝壑裡是凹凸不平的岩壁與溝底
export function terrainHeight(x, z) {
  const d = ravineDistance(x, z);
  if (d >= RAVINE_HALF) return 0;
  // 崖邊(inner=0)保持乾淨的邊界,越往裡岩壁越嶙峋
  const inner = Math.min(1, (RAVINE_HALF - d) / 0.35);
  const dd = d + (vnoise(x * 0.7, z * 0.7) * 0.3 + vnoise(x * 1.9, z * 1.9) * 0.12) * inner;
  let t = (RAVINE_HALF - dd) / (RAVINE_HALF - FLOOR_HALF);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  // pow < 1:崖邊幾乎垂直,往下漸緩成碎石坡
  let y = -RAVINE_DEPTH * Math.pow(t, 0.55);
  y += vnoise(x * 2.3 + 5.1, z * 2.3) * 0.14 * inner;
  return y;
}
// 橋(Blender 模型 bridge.glb,原尺寸):橋身沿 BRIDGE_SPOT → dirTo,
// 半長 5(兩端各搭在岸上約 1.6),欄杆中心在 ±2.1、內側約 ±2.03。
export const BRIDGE = { halfLen: 5.0, railOffset: 2.1, innerHalfWidth: 2.03 };

// 給 Collision.addRavine 用的橋面開口
export function bridgeOpening() {
  const { x, z, dirTo } = BRIDGE_SPOT;
  const L = Math.hypot(dirTo[0] - x, dirTo[1] - z);
  return {
    x, z,
    ux: (dirTo[0] - x) / L, uz: (dirTo[1] - z) / L,
    halfLen: BRIDGE.halfLen,
    halfWidth: BRIDGE.innerHalfWidth,
  };
}

const GRASS_BASE = "#557f30";

// 地面貼圖一張 2048 蓋 170 公尺,一公尺才 12 像素,近看會糊。
// 在 shader 裡疊兩層程序化雜訊(世界座標,不會重複拼貼):
// 草地上是深淺斑駁,泥土路上再加碎石顆粒與車轍般的明暗。
const DETAIL_GLSL = /* glsl */ `
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
  }
  float gFbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { s += gNoise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
`;

function detailMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = "varying vec3 vGWorld;\nvarying vec3 vGNormal;\n" + sh.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
       vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vGNormal = normalize(mat3(modelMatrix) * objectNormal);`
    );
    sh.fragmentShader = "varying vec3 vGWorld;\nvarying vec3 vGNormal;\n" + DETAIL_GLSL + sh.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
       {
         vec2 w = vGWorld.xz;
         float big = gFbm(w * 0.35);
         float mid = gFbm(w * 1.6);
         float fine = gNoise(w * 9.0);
         // 泥土判斷:紅大於綠
         float dirt = smoothstep(-0.02, 0.06, diffuseColor.r - diffuseColor.g);
         float grassMul = 0.78 + 0.32 * big + 0.18 * (mid - 0.5);
         float pebble = smoothstep(0.78, 0.9, gNoise(w * 5.5 + 3.3));
         float dirtMul = 0.8 + 0.3 * mid + 0.12 * (fine - 0.5) + 0.22 * pebble;
         diffuseColor.rgb *= mix(grassMul, dirtMul, dirt);

         // 溝壑岩壁:陡的地方換成有層理的岩土色
         float steep = 1.0 - clamp(vGNormal.y, 0.0, 1.0);
         float below = clamp(-vGWorld.y / ${RAVINE_DEPTH.toFixed(1)}, 0.0, 1.0);
         float strata = gNoise(vec2(vGWorld.y * 4.5 + gNoise(w * 0.6) * 2.0, (w.x + w.y) * 0.2));
         vec3 rock = mix(vec3(0.15, 0.115, 0.08), vec3(0.34, 0.28, 0.2), strata);
         rock *= 0.75 + 0.45 * gFbm(w * 2.2 + vGWorld.y * 1.3);
         float rockAmt = clamp(smoothstep(0.2, 0.5, steep) + below * 0.7, 0.0, 1.0);
         diffuseColor.rgb = mix(diffuseColor.rgb, rock, rockAmt);
         // 越深越暗(溝底照不太到天光),水線附近是濕的深色
         diffuseColor.rgb *= mix(1.0, 0.5, smoothstep(0.0, 1.0, below));
         diffuseColor.rgb *= mix(1.0, 0.6, smoothstep(${(WATER_Y + 0.45).toFixed(2)}, ${WATER_Y.toFixed(2)}, vGWorld.y));
         // 界外(邊界石牆以外)壓暗一點
         diffuseColor.rgb *= mix(1.0, 0.78, step(${(SIZE / 2).toFixed(1)}, max(abs(w.x), abs(w.y))));
       }`
    );
  };
  return mat;
}

function range(a, b, step) {
  const out = [];
  for (let v = a; v < b - 1e-6; v += step) out.push(v);
  out.push(b);
  return out;
}

// 溝壑橫向:中心附近 0.2 公尺一格(岩壁只有 1.5 公尺寬),外側 1 公尺
function stripXs(x0, x1) {
  const xs = new Set();
  for (const v of range(x0, x1, 1)) xs.add(+v.toFixed(3));
  for (const v of range(29.4, 38.6, 0.2)) xs.add(+v.toFixed(3));
  return [...xs].sort((a, b) => a - b);
}

// xs × zs 的格網,高度 = h(x, z);UV 與 2048 地面貼圖對齊(與舊版 PlaneGeometry 相同)
function terrainGrid(xs, zs, h = terrainHeight) {
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = xs[i], z = zs[j];
      pos[k * 3] = x;
      pos[k * 3 + 1] = h(x, z);
      pos[k * 3 + 2] = z;
      uv[k * 2] = (x + SIZE / 2) / SIZE;
      uv[k * 2 + 1] = 1 - (z + SIZE / 2) / SIZE;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + nx, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildGround() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEX;
  const g = canvas.getContext("2d");
  const W2T = TEX / SIZE;
  const tx = (x) => (x + SIZE / 2) * W2T;
  const tz = (z) => (z + SIZE / 2) * W2T;

  // 草地底色 + 斑駁
  g.fillStyle = GRASS_BASE;
  g.fillRect(0, 0, TEX, TEX);
  const shades = ["#4c7529", "#5f8c36", "#52792c", "#68933c", "#466d26"];
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = shades[(Math.random() * shades.length) | 0];
    g.globalAlpha = 0.10 + Math.random() * 0.14;
    g.beginPath();
    g.arc(Math.random() * TEX, Math.random() * TEX, 6 + Math.random() * 28, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;

  // 沿曲線灑不規則圓形，畫出手繪感的路
  function paintPath(points, widthWorld, layers) {
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 3);
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    }
    for (const [layerW, color, alpha] of layers) {
      g.fillStyle = color;
      for (const [x, z] of pts) {
        for (let k = 0; k < 3; k++) {
          const jr = (Math.random() - 0.5) * widthWorld * 0.55 * W2T;
          const ja = Math.random() * Math.PI * 2;
          const r = widthWorld * layerW * (0.35 + Math.random() * 0.45) * W2T;
          g.globalAlpha = alpha * (0.5 + Math.random() * 0.5);
          g.beginPath();
          g.arc(tx(x) + Math.cos(ja) * jr, tz(z) + Math.sin(ja) * jr, r, 0, 7);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
  }

  const dirt = [
    [1.15, "#6e5236", 0.55],
    [0.85, "#7d5f40", 0.8],
    [0.5, "#8a6a49", 0.75],
  ];
  paintPath(PATH, 4.5, dirt);
  paintPath(SIDE_PATH, 3.5, dirt);
  paintRavine();

  // 溝壑:岸邊(可走的褐色土坡)→ 溝底(深色,不可走)→ 最深處。
  // 每一層都是「圓滑粗線 + 線內的不規則圓斑」,圓斑保證不超出該層的半寬,
  // 所以深色溝底的外緣恰好落在 RAVINE_HALF,和碰撞一致。
  function paintRavine() {
    const pts = [];
    for (let i = 0; i < RAVINE.length - 1; i++) {
      const [ax, az] = RAVINE[i], [bx, bz] = RAVINE[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    }
    const layers = [
      [RAVINE_HALF + 1.3, "#6a5236", 0.75], // 岸
      [RAVINE_HALF, "#3f3020", 1.0],        // 溝底邊緣
      [RAVINE_HALF - 1.0, "#2e2316", 1.0],
      [RAVINE_HALF - 2.0, "#211910", 1.0],  // 最深處
    ];
    g.lineCap = g.lineJoin = "round";
    for (const [half, color, alpha] of layers) {
      g.globalAlpha = alpha;
      g.strokeStyle = g.fillStyle = color;
      // 內縮 0.7 的粗線當骨架,邊緣再用圓斑長回到 half,形成不規則但有上限的輪廓
      g.lineWidth = (half - 0.7) * 2 * W2T;
      g.beginPath();
      g.moveTo(tx(RAVINE[0][0]), tz(RAVINE[0][1]));
      for (const [x, z] of RAVINE) g.lineTo(tx(x), tz(z));
      g.stroke();
      for (const [x, z] of pts) {
        const r = 0.25 + Math.random() * 0.45;          // 圓斑半徑
        const off = (half - r) * (Math.random() < 0.5 ? -1 : 1) * (0.75 + Math.random() * 0.25);
        // 沿法線(溝壑大致是南北向,法線 ≈ x 軸)偏移;off + r ≤ half
        g.beginPath();
        g.arc(tx(x + off), tz(z), r * W2T, 0, 7);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // 地形:溝壑兩側一條密網格(真的往下挖),其餘是平面。
  // 平面延伸到地圖外 300 公尺,貼圖超出範圍時取邊緣顏色,遠處淡入霧裡。
  const mat = detailMaterial(texture);
  const mesh = new THREE.Group();
  const X0 = 26, X1 = 42, ZR = 140, FAR = 300;
  const strip = new THREE.Mesh(terrainGrid(stripXs(X0, X1), range(-ZR, ZR, 0.5)), mat);
  strip.receiveShadow = true;
  strip.castShadow = true; // 岩壁的影子投進溝底,才看得出深度
  mesh.add(strip);
  for (const [xs, zs] of [
    [[-FAR, X0], [-FAR, FAR]],
    [[X1, FAR], [-FAR, FAR]],
    [[X0, X1], [-FAR, -ZR]],
    [[X0, X1], [ZR, FAR]],
  ]) {
    const flat = new THREE.Mesh(terrainGrid(xs, zs, () => 0), mat);
    flat.receiveShadow = true;
    mesh.add(flat);
  }

  const pix = g.getImageData(0, 0, TEX, TEX).data;
  function colorAt(x, z) {
    const px = Math.min(TEX - 1, Math.max(0, tx(x) | 0));
    const pz = Math.min(TEX - 1, Math.max(0, tz(z) | 0));
    const i = (pz * TEX + px) * 4;
    return [pix[i], pix[i + 1], pix[i + 2]];
  }
  const isGrassAt = (x, z) => {
    const [r, gg] = colorAt(x, z);
    return gg > r * 1.04;
  };

  return { mesh, isGrassAt, colorAt };
}
