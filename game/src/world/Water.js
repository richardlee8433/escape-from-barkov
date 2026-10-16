import * as THREE from "three";

// 透明的淺水。溪流與湖共用這一個類別。
//
// 關鍵是「每一點的水有多深」:地形高度是程式算的,建立時把水域範圍內的地面高度
// (加上石頭、橋墩這些障礙)烘成一張高度圖,shader 取樣後 depth = 水位 - 地面。
// 有了深度,就能做到:
//   1. 顏色與透明度隨深度變化 —— 淺處幾乎透明,看得到水底的沙與光紋
//   2. 白沫沿著真實的岸線、繞著每一顆石頭與橋墩,不必手畫
//   3. 一波一波往岸上推的浪(相位 = 深度 + 時間)
// 水面本身只是一塊平面:比地面低的地方看得到,其餘被地形擋住。

const NOISE = /* glsl */ `
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
  }
  float wFbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { s += wNoise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
`;

export class Water {
  // bounds: { x0, z0, x1, z1 };level:水位;ground(x,z):地形高度
  // flow:[vx, vz] 公尺/秒(湖為 0);res:高度圖解析度(公尺/格)
  constructor(scene, { bounds, level, ground, flow = [0, 0], res = 0.25, shallow, deep }) {
    this.bounds = bounds;
    this.level = level;
    this.res = res;
    this.uTime = { value: 0 };

    const nx = Math.ceil((bounds.x1 - bounds.x0) / res) + 1;
    const nz = Math.ceil((bounds.z1 - bounds.z0) / res) + 1;
    this.nx = nx;
    this.nz = nz;
    this.heights = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        this.heights[j * nx + i] = ground(bounds.x0 + i * res, bounds.z0 + j * res);
      }
    }

    const geo = new THREE.PlaneGeometry(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0);
    geo.rotateX(-Math.PI / 2);
    geo.translate((bounds.x0 + bounds.x1) / 2, level, (bounds.z0 + bounds.z1) / 2);

    this.tex = null;
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.18, metalness: 0, transparent: true, depthWrite: false,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        uTime: this.uTime,
        uHeight: { value: this.tex },
        uBounds: { value: new THREE.Vector4(bounds.x0, bounds.z0, bounds.x1, bounds.z1) },
        uLevel: { value: level },
        uFlow: { value: new THREE.Vector2(...flow) },
        uShallow: { value: new THREE.Color(shallow) },
        uDeep: { value: new THREE.Color(deep) },
        uFoam: { value: new THREE.Color(0xf2faf7) },
      });
      sh.vertexShader = "varying vec3 vWWorld;\n" + sh.vertexShader.replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n vWWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );
      sh.fragmentShader = `
        uniform float uTime, uLevel;
        uniform sampler2D uHeight;
        uniform vec4 uBounds;
        uniform vec2 uFlow;
        uniform vec3 uShallow, uDeep, uFoam;
        varying vec3 vWWorld;
      ` + NOISE + sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           vec2 hUv = (vWWorld.xz - uBounds.xy) / (uBounds.zw - uBounds.xy);
           float depth = max(uLevel - texture2D(uHeight, hUv).r, 0.0);
           vec2 fp = vWWorld.xz - uFlow * uTime;        // 跟著水流移動的座標
           float n1 = wFbm(fp * 0.6);

           // 深度 → 顏色與透明度
           vec3 col = mix(uShallow, uDeep, smoothstep(0.08, 1.4, depth + (n1 - 0.5) * 0.15));
           float alpha = mix(0.42, 0.9, smoothstep(0.0, 1.4, depth));

           // 白沫:貼著岸(深度≈0)的一條線 + 往岸上推的浪
           float contact = 1.0 - smoothstep(0.03, 0.11 + 0.06 * n1, depth);
           float wave = sin(depth * 18.0 + uTime * 2.2 + n1 * 5.0);
           float bands = smoothstep(0.6, 0.92, wave) * (1.0 - smoothstep(0.08, 0.4, depth));
           float breakup = smoothstep(0.3, 0.6, wNoise(fp * 2.0 + uTime * 0.25));
           float foam = clamp(contact + bands * breakup, 0.0, 1.0);
           // 流動的水面:沿流向拉長的白色細紋(湖沒有流速就沒有)
           float moving = step(0.001, length(uFlow));
           float streak = smoothstep(0.74, 0.9, wFbm(vec2(fp.x * 1.6, fp.y * 0.3))) * 0.35 * moving
             * smoothstep(0.15, 0.45, depth);
           foam = max(foam, streak);

           diffuseColor.rgb = mix(col, uFoam, foam);
           diffuseColor.a = max(alpha, foam * 0.95);`
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.85, foam);"
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
           {
             // 細小的漣漪:讓太陽在水面上閃爍
             vec2 q = fp * 1.3 + vec2(uTime * 0.15, -uTime * 0.1);
             float e = 0.08, h0 = wFbm(q);
             vec2 grad = vec2(wFbm(q + vec2(e, 0.0)) - h0, wFbm(q + vec2(0.0, e)) - h0) / e;
             vec3 nW = normalize(vec3(-grad.x * 0.12, 1.0, -grad.y * 0.12));
             normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
           }`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
           totalEmissiveRadiance += vec3(0.5, 0.65, 0.7) * fres * 0.25 * (1.0 - foam);`
        );
      this._shader = sh;
    };

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  // 水裡的障礙物(石頭、橋墩):在高度圖上蓋一個圓丘,白沫就會繞著它長出來。
  // top 是露出水面的頂端高度;要在 finalize() 之前呼叫。
  addObstacle(x, z, radius, top) {
    const { x0, z0 } = this.bounds;
    const r = this.res;
    const i0 = Math.max(0, Math.floor((x - radius - x0) / r)), i1 = Math.min(this.nx - 1, Math.ceil((x + radius - x0) / r));
    const j0 = Math.max(0, Math.floor((z - radius - z0) / r)), j1 = Math.min(this.nz - 1, Math.ceil((z + radius - z0) / r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(x0 + i * r - x, z0 + j * r - z) / radius;
        if (d >= 1) continue;
        const k = j * this.nx + i;
        const h = top - (top - this.heights[k]) * d * d;
        if (h > this.heights[k]) this.heights[k] = h;
      }
    }
  }

  // 高度圖上某一點的水深(給測試與擺放用)
  depthAt(x, z) {
    const i = Math.round((x - this.bounds.x0) / this.res), j = Math.round((z - this.bounds.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 0;
    return Math.max(0, this.level - this.heights[j * this.nx + i]);
  }

  // 把高度圖送上 GPU(半精度浮點,WebGL2 可線性內插)
  finalize() {
    const half = new Uint16Array(this.heights.length);
    for (let k = 0; k < half.length; k++) half[k] = THREE.DataUtils.toHalfFloat(this.heights[k]);
    this.tex = new THREE.DataTexture(half, this.nx, this.nz, THREE.RedFormat, THREE.HalfFloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    if (this._shader) this._shader.uniforms.uHeight.value = this.tex;
    return this;
  }

  setTime(t) {
    this.uTime.value = t;
  }
}

// 湖裡的魚影:深色的小梭形沿著各自的圓形路線慢慢游,透過水面看起來是水下的影子
export class FishSchool {
  constructor(scene, paths, y) {
    const geo = new THREE.SphereGeometry(0.5, 10, 6);
    geo.scale(0.14, 0.08, 0.42);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a40, roughness: 0.9 });
    this.fish = paths.map((p) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      scene.add(m);
      return { m, ...p };
    });
  }

  update(t) {
    for (const f of this.fish) {
      const a = f.phase + (t * f.speed) / f.r * f.dir;
      const wobble = Math.sin(t * 3 + f.phase) * 0.15;
      f.m.position.x = f.x + Math.cos(a) * f.r;
      f.m.position.z = f.z + Math.sin(a) * f.r;
      // 面向切線方向(dir 決定順/逆時針)
      f.m.rotation.y = Math.atan2(-Math.sin(a) * f.dir, Math.cos(a) * f.dir) + wobble;
    }
  }
}
