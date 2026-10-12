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
// 溝壑（過橋區段拉直成垂直）
export const RAVINE = [[33, -80], [34, -34], [34, -8], [34, 22], [35, 52], [34, 80]];
export const BRIDGE_SPOT = { x: 34, z: 6, dirTo: [40, 6] };

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
    sh.vertexShader = "varying vec3 vGWorld;\n" + sh.vertexShader.replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\n vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
    );
    sh.fragmentShader = "varying vec3 vGWorld;\n" + DETAIL_GLSL + sh.fragmentShader.replace(
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
       }`
    );
  };
  return mat;
}

// 地圖外圍的大片地面:顏色與草地底色相同,遠處淡入霧裡,畫面邊緣不會露出虛空
export function buildOuterGround() {
  const mat = detailMaterial(null);
  mat.color = new THREE.Color(GRASS_BASE).multiplyScalar(0.72);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return mesh;
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
  paintPath(RAVINE, 7, [
    [1.2, "#5d4a30", 0.7],
    [0.8, "#463724", 0.9],
    [0.45, "#332818", 0.9],
  ]);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), detailMaterial(texture));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;

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
