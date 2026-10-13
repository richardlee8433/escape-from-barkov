import * as THREE from "three";
import { RAVINE, WATER_Y, WATER_HALF } from "./GroundPaint.js";

// 溝底的河。一條沿溝壑中心線的水面帶,shader 裡做三件事:
//   1. 漣漪:順著流向捲動的雜訊當高度場,算出擾動後的法線 → 陽光在水面上閃爍
//   2. 顏色:中央深、靠岸淺,岸邊有隨水流移動的白沫
//   3. 天空反光:掠射角(fresnel)越大越亮,水面才有「水」的質感
// 水面兩側比水線寬一點,邊緣藏進岩壁裡,岸線的形狀由地形決定。

const NOISE = /* glsl */ `
  float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float rNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(rHash(i), rHash(i + vec2(1, 0)), u.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), u.x), u.y);
  }
  float rFbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { s += rNoise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
`;

const FLOW_SPEED = 1.4; // 公尺/秒,往 +z(南)流

export class River {
  constructor(scene) {
    this.uTime = { value: 0 };

    // 中心線每 1 公尺取一點,左右各展開 WATER_HALF
    const pts = [];
    for (let i = 0; i < RAVINE.length - 1; i++) {
      const [ax, az] = RAVINE[i], [bx, bz] = RAVINE[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az));
      for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    pts.push(RAVINE[RAVINE.length - 1]);

    const ACROSS = 8;
    const pos = [], ruv = [], flow = [], idx = [];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const [px, pz] = pts[Math.max(0, i - 1)], [qx, qz] = pts[Math.min(pts.length - 1, i + 1)];
      const L = Math.hypot(qx - px, qz - pz) || 1;
      const fx = (qx - px) / L, fz = (qz - pz) / L; // 流向
      if (i > 0) s += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      for (let k = 0; k <= ACROSS; k++) {
        const v = (k / ACROSS) * 2 - 1; // -1 … 1
        // 側向 = 流向轉 90°
        pos.push(x - fz * v * WATER_HALF, WATER_Y, z + fx * v * WATER_HALF);
        ruv.push(s, v);
        flow.push(fx, fz);
      }
    }
    const row = ACROSS + 1;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < ACROSS; k++) {
        const a = i * row + k, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("rUv", new THREE.Float32BufferAttribute(ruv, 2));
    geo.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // 法線朝上(三角形繞向依流向而定,統一翻正)
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);

    const mat = new THREE.MeshStandardMaterial({ color: 0x1d4a4f, roughness: 0.08, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = "attribute vec2 rUv;\nattribute vec2 flow;\nvarying vec2 vRUv;\nvarying vec2 vFlow;\n" +
        sh.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n vRUv = rUv; vFlow = flow;"
        );
      sh.fragmentShader = "uniform float uTime;\nvarying vec2 vRUv;\nvarying vec2 vFlow;\n" + NOISE + `
        // 漣漪高度場:沿流向捲動,橫向壓縮成細長的水紋
        float rHeight(vec2 p) {
          vec2 q = vec2(p.x - uTime * ${FLOW_SPEED.toFixed(2)}, p.y);
          return rFbm(q * vec2(0.8, 2.0)) * 0.6 + rNoise(q * vec2(2.6, 5.0) + uTime * 0.35) * 0.4;
        }
      ` + sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           float across = abs(vRUv.y);
           vec3 deep = vec3(0.008, 0.04, 0.045);
           vec3 shallow = vec3(0.03, 0.09, 0.08);
           diffuseColor.rgb = mix(deep, shallow, smoothstep(0.35, 0.85, across));
           // 岸邊白沫(隨水流移動的斷續條紋)+ 水面偶爾的白色碎浪
           float streak = rNoise(vec2(vRUv.x * 0.7 - uTime * ${FLOW_SPEED.toFixed(2)}, vRUv.y * 7.0));
           float foam = smoothstep(0.6, 0.8, across)
             * smoothstep(0.35, 0.75, streak + 0.3 * rNoise(vRUv * vec2(3.0, 9.0) - vec2(uTime * 2.0, 0.0)));
           // 水面細紋:fbm(而不是單層 value noise)才不會出現方塊狀的白斑
           foam += smoothstep(0.66, 0.8, rFbm(vec2(vRUv.x * 1.2 - uTime * ${(FLOW_SPEED * 1.2).toFixed(2)}, vRUv.y * 9.0))) * 0.25;
           foam = clamp(foam, 0.0, 1.0);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.66, 0.64), foam * 0.8);`
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.85, foam);"
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
           {
             vec2 p = vRUv * vec2(1.0, ${WATER_HALF.toFixed(2)});
             float e = 0.06;
             float h0 = rHeight(p);
             vec2 grad = vec2(rHeight(p + vec2(e, 0.0)) - h0, rHeight(p + vec2(0.0, e)) - h0) / e;
             vec3 fl = normalize(vec3(vFlow.x, 0.0, vFlow.y));
             vec3 side = vec3(-fl.z, 0.0, fl.x);
             vec3 nW = normalize(vec3(0.0, 1.0, 0.0) - (fl * grad.x + side * grad.y) * 0.28);
             normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
           }`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
           totalEmissiveRadiance += vec3(0.42, 0.52, 0.58) * (0.015 + fres * 0.3) * (1.0 - foam);`
        );
    };

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true; // 橋與岩壁的影子落在水面上
    scene.add(this.mesh);
  }

  setTime(t) {
    this.uTime.value = t;
  }
}
