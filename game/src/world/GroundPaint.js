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

// 溪流的半寬(岸緣到中線)。畫面與碰撞共用這一個數字:
// 地形從這條線往下凹,碰撞也以它為準,看到的岸緣就是走不過去的邊緣。
export const RAVINE_HALF = 3.6;

// 溪流(溝壑)的立體形狀:岸緣在 RAVINE_HALF(= 碰撞邊界,角色永遠站在平地上),
// 往內是短短一段沙岸,再緩降到深 RAVINE_DEPTH 的河床。水面在 WATER_Y,
// 所以水幾乎填滿整條溝,只在岸緣露出一窄條濕沙。湖也用同一個水位。
export const RAVINE_DEPTH = 1.1;
export const WATER_Y = -0.3;

// 地圖南緣的淺水湖:三個圓的聯集,岸線再用雜訊打散。一半在界內,一半延伸到界外的霧裡。
export const LAKE_CIRCLES = [[-14, -82, 18], [3, -77, 12], [-29, -75, 10]];
export const LAKE_DEPTH = 1.7;
// 湖區(含沙灘)的範圍:地形密網格與水面高度圖都只涵蓋這裡
export const LAKE_BOUNDS = { x0: -46, z0: -104, x1: 20, z1: -56 };
// 溪流的範圍(與地形密網格一致)
export const STREAM_BOUNDS = { x0: 26, z0: -140, x1: 42, z1: 140 };

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

// 到湖岸的有號距離(公尺,湖裡為負)。碰撞、地形、上色共用。
export function lakeSDF(x, z) {
  let d = Infinity;
  for (const [cx, cz, r] of LAKE_CIRCLES) d = Math.min(d, Math.hypot(x - cx, z - cz) - r);
  return d + vnoise(x * 0.12, z * 0.12) * 1.0 + vnoise(x * 0.4, z * 0.4) * 0.25;
}

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// 水岸剖面:s = 從岸緣往水裡的水平距離。前 bankW 公尺是沙岸(降到 bankD),之後緩降到 maxDepth。
// 溪流的沙岸短而陡;湖的沙灘長而平緩,淺水帶才夠寬,看得到一波波往岸上推的浪。
function shore(s, maxDepth, flat, bankW = 0.7, bankD = 0.55) {
  const bank = bankD * Math.pow(Math.min(s / bankW, 1), 0.8);
  const deep = (maxDepth - bankD) * smooth01((s - bankW) / flat);
  return -(bank + deep);
}

// 地形高度:水岸以外一律 0(遊戲平面),溪流與湖裡是沙岸與河床
export function terrainHeight(x, z) {
  let y = 0;
  const d = ravineDistance(x, z);
  if (d < RAVINE_HALF) {
    // 岸緣(inner=0)保持乾淨的邊界,往裡岸線微微彎曲、河床有卵石起伏
    const inner = Math.min(1, (RAVINE_HALF - d) / 0.35);
    const dd = d + (vnoise(x * 0.5, z * 0.5) * 0.22 + vnoise(x * 1.7, z * 1.7) * 0.08) * inner;
    y = shore(Math.max(0, RAVINE_HALF - dd), RAVINE_DEPTH, 2.2) + vnoise(x * 2.3 + 5.1, z * 2.3) * 0.06 * inner;
  }
  if (z < LAKE_BOUNDS.z1 && x > LAKE_BOUNDS.x0 && x < LAKE_BOUNDS.x1) {
    const sd = lakeSDF(x, z);
    if (sd < 0) {
      const inner = Math.min(1, -sd / 0.35);
      y = Math.min(y, shore(-sd, LAKE_DEPTH, 7, 3.0, 0.6) + vnoise(x * 1.9, z * 1.9 + 3) * 0.05 * inner);
    }
  }
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
  uniform float uGTime;
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
  // 水底光紋:兩層會動的 Voronoi,取格子邊緣(F2 - F1 很小的地方)當亮線
  vec2 cHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float cEdge(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = 0.5 + 0.45 * sin(t + 6.2831 * cHash(i + g));
        float d = length(g + o - f);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
    return d2 - d1;
  }
  float caustics(vec2 w, float t) {
    float a = 1.0 - smoothstep(0.0, 0.06, cEdge(w * 0.9, t * 0.9));
    float b = 1.0 - smoothstep(0.0, 0.05, cEdge(w * 1.45 + 17.0, t * 1.25));
    // 大範圍的明暗起伏:光紋有的地方亮、有的地方淡,不會像一整片磁磚
    float m = smoothstep(0.25, 0.75, gFbm(w * 0.18 + t * 0.03));
    return clamp(a * 0.7 + b * 0.45, 0.0, 1.0) * (0.35 + 0.65 * m);
  }
`;

const groundTime = { value: 0 };

function detailMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGTime = groundTime;
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

         // 陡坡露出岩土
         float steep = 1.0 - clamp(vGNormal.y, 0.0, 1.0);
         float strata = gNoise(vec2(vGWorld.y * 4.5 + gNoise(w * 0.6) * 2.0, (w.x + w.y) * 0.2));
         vec3 rock = mix(vec3(0.15, 0.115, 0.08), vec3(0.34, 0.28, 0.2), strata);
         diffuseColor.rgb = mix(diffuseColor.rgb, rock, smoothstep(0.45, 0.7, steep));

         // 水線以下:濕沙變深,再疊上隨時間流動的水底光紋(caustics)
         float under = ${WATER_Y.toFixed(2)} - vGWorld.y;
         diffuseColor.rgb *= mix(1.0, 0.8, smoothstep(-0.08, 0.02, under));
         if (under > 0.0) {
           float fade = smoothstep(0.0, 0.12, under) * (1.0 - 0.5 * smoothstep(1.0, 2.0, under));
           diffuseColor.rgb += vec3(0.8, 1.0, 0.95) * caustics(w, uGTime) * 0.4 * fade;
         }
         // 界外:離邊界石牆越遠越暗一點(慢慢淡出,不是一刀切),再交給霧
         float outD = max(abs(w.x), abs(w.y));
         diffuseColor.rgb *= mix(1.0, 0.8, smoothstep(${(SIZE / 2 + 2).toFixed(1)}, ${(SIZE / 2 + 40).toFixed(1)}, outD));
       }`
    );
  };
  return mat;
}

function mergeAxis(...lists) {
  const set = new Set();
  for (const l of lists) for (const v of l) set.add(+v.toFixed(3));
  return [...set].sort((a, b) => a - b);
}

function range(a, b, step) {
  const out = [];
  for (let v = a; v < b - 1e-6; v += step) out.push(v);
  out.push(b);
  return out;
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
  paintLake();

  // 溪流:兩岸是可走的沙與卵石,河床是淺色的沙(透過水看得到)。
  // 每一層都是「圓滑粗線 + 線內的不規則圓斑」,圓斑保證不超出該層的半寬。
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
      [RAVINE_HALF + 1.5, "#a8946a", 0.7], // 岸邊沙地(可走)
      [RAVINE_HALF + 0.6, "#bba67c", 0.9],
      [RAVINE_HALF, "#c2ae84", 1.0],       // 河床
      [RAVINE_HALF - 1.6, "#b39f77", 1.0],
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
        // 沿法線(溪流大致是南北向,法線 ≈ x 軸)偏移;off + r ≤ half
        g.beginPath();
        g.arc(tx(x + off), tz(z), r * W2T, 0, 7);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // 湖:逐像素依「到湖岸的距離」上色,湖底淺沙、岸上一圈乾沙灘,再淡入草地
  function paintLake() {
    const B = LAKE_BOUNDS;
    const px0 = Math.max(0, Math.floor(tx(B.x0))), px1 = Math.min(TEX, Math.ceil(tx(B.x1)));
    const pz0 = Math.max(0, Math.floor(tz(B.z0))), pz1 = Math.min(TEX, Math.ceil(tz(B.z1)));
    const w = px1 - px0, h = pz1 - pz0;
    if (w <= 0 || h <= 0) return;
    const img = g.getImageData(px0, pz0, w, h);
    const bed = [196, 178, 136], beach = [214, 196, 152], wet = [176, 158, 118];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = (px0 + i + 0.5) / W2T - SIZE / 2;
        const z = (pz0 + j + 0.5) / W2T - SIZE / 2;
        const sd = lakeSDF(x, z);
        if (sd > 6) continue;
        const k = (j * w + i) * 4;
        const n = vnoise(x * 0.8, z * 0.8) * 0.5;
        let c, a;
        if (sd < -1.6) { c = bed; a = 1; }
        else if (sd < 0.3) { c = wet; a = 1; }
        else { c = beach; a = 1 - smooth01((sd + n - 3.2) / 2.2); }
        for (let ch = 0; ch < 3; ch++) img.data[k + ch] += (c[ch] * (0.94 + n * 0.12) - img.data[k + ch]) * a;
      }
    }
    g.putImageData(img, px0, pz0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // 地形:溪流與湖各一塊密網格(真的往下挖),其餘用大格子的平面補滿。
  // 平面延伸到地圖外 300 公尺,貼圖超出範圍時取邊緣顏色,遠處淡入霧裡。
  // 密網格的邊界一定落在平面格線上,而且邊界上的高度都是 0,接縫不會有裂縫。
  const mat = detailMaterial(texture);
  const mesh = new THREE.Group();
  const FAR = 300;
  const S = STREAM_BOUNDS, L = LAKE_BOUNDS;
  const dense = [
    // 溪流:橫向在水岸附近 0.2 公尺一格,縱向 0.5
    { b: S, xs: mergeAxis(range(S.x0, S.x1, 1), range(29.4, 38.6, 0.2)), zs: range(S.z0, S.z1, 0.5) },
    { b: L, xs: range(L.x0, L.x1, 0.4), zs: range(L.z0, L.z1, 0.4) },
  ];
  for (const { xs, zs } of dense) {
    const m = new THREE.Mesh(terrainGrid(xs, zs), mat);
    m.receiveShadow = true;
    m.castShadow = true; // 岸坡的影子落在水底,才看得出深度
    mesh.add(m);
  }
  // 平面:以 20 公尺格線加上所有密網格邊界切格,跳過落在密網格裡的格子
  const cutX = mergeAxis(range(-FAR, FAR, 20), [S.x0, S.x1, L.x0, L.x1]);
  const cutZ = mergeAxis(range(-FAR, FAR, 20), [S.z0, S.z1, L.z0, L.z1]);
  const inDense = (x, z) => dense.some(({ b }) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  const pos = [], uv = [], idx = [];
  for (let j = 0; j < cutZ.length - 1; j++) {
    for (let i = 0; i < cutX.length - 1; i++) {
      const xa = cutX[i], xb = cutX[i + 1], za = cutZ[j], zb = cutZ[j + 1];
      if (inDense((xa + xb) / 2, (za + zb) / 2)) continue;
      const base = pos.length / 3;
      for (const [x, z] of [[xa, za], [xa, zb], [xb, za], [xb, zb]]) {
        pos.push(x, 0, z);
        uv.push((x + SIZE / 2) / SIZE, 1 - (z + SIZE / 2) / SIZE);
      }
      idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const flatGeo = new THREE.BufferGeometry();
  flatGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  flatGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  flatGeo.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  flatGeo.setIndex(idx);
  const flat = new THREE.Mesh(flatGeo, mat);
  flat.receiveShadow = true;
  mesh.add(flat);

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

  // 水底光紋的時間
  const setTime = (t) => (groundTime.value = t);

  return { mesh, isGrassAt, colorAt, setTime };
}
