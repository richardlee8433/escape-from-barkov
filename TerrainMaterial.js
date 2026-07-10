// TerrainMaterial.js  (THREE r164+)
import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

/** A) 安全保底：先畫得出來就好 */
export function createTerrainFallbackMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x256d3a,
    roughness: 1,
    metalness: 0,
  });
}

/** B) 進階：三平面 + 可選 splatmap 的地形材質 */
export async function createTerrainTriplanarMaterial({
  texUrls, // { grass, dirt, rock, sand }
  splatUrl = null, // 可選：splat RGBA
  scale = 12.0,
  sharpness = 2.0,
  slopeMin = 0.35,
  slopeMax = 0.75,
  worldSize = 1000,
  anisotropy = 8, // ✅ 不再碰 renderer，改由參數控制
} = {}) {
  const loader = new THREE.TextureLoader();

  const [texA, texB, texC, texD, splat] = await Promise.all([
    loader.loadAsync(texUrls.grass),
    loader.loadAsync(texUrls.dirt),
    loader.loadAsync(texUrls.rock),
    loader.loadAsync(texUrls.sand),
    splatUrl ? loader.loadAsync(splatUrl) : Promise.resolve(null),
  ]);

  [texA, texB, texC, texD].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace; // r164+
    t.anisotropy = Math.max(1, Math.min(16, anisotropy));
  });
  if (splat) {
    splat.wrapS = splat.wrapT = THREE.ClampToEdgeWrapping;
    // splat 常為非色彩資料，保留 Linear（預設）
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
  });

  // ✅ 啟用 derivatives 擴充以使用 dFdx/dFdy
  mat.extensions = { derivatives: true };

  mat.onBeforeCompile = (shader) => {
    // uniforms
    Object.assign(shader.uniforms, {
      texA: { value: texA },
      texB: { value: texB },
      texC: { value: texC },
      texD: { value: texD },
      splat: { value: splat },
      uScale: { value: scale },
      uSharp: { value: sharpness },
      uSlopeMin: { value: slopeMin },
      uSlopeMax: { value: slopeMax },
      uWorldSize: { value: worldSize },
      uHasSplat: { value: splat ? 1.0 : 0.0 }, // ✅ float
    });

    // vertex：輸出世界座標
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `
        #include <common>
        varying vec3 vWorldPos;
        `
      )
      .replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWorldPos = wp.xyz;
        `
      );

    // fragment：triplanar + 混合
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <map_pars_fragment>",
        `
        #include <map_pars_fragment>
        uniform sampler2D texA, texB, texC, texD;
        uniform sampler2D splat;
        uniform float uScale, uSharp, uSlopeMin, uSlopeMax, uWorldSize;
        uniform float uHasSplat;      // ✅ 改成 float
        varying vec3 vWorldPos;

        vec3 sampleTriplanar(sampler2D tex, vec3 n, vec3 wp, float scale){
          vec3 an = abs(normalize(n));
          an = pow(an, vec3(uSharp));
          an /= (an.x + an.y + an.z + 1e-5);

          vec2 uvX = wp.zy / scale;  // 投影到 YZ
          vec2 uvY = wp.xz / scale;  // 投影到 XZ
          vec2 uvZ = wp.xy / scale;  // 投影到 XY

          vec3 cx = texture2D(tex, uvX).rgb;
          vec3 cy = texture2D(tex, uvY).rgb;
          vec3 cz = texture2D(tex, uvZ).rgb;

          return cx*an.x + cy*an.y + cz*an.z;
        }
        `
      )
      .replace(
        "#include <map_fragment>",
        `
        #include <map_fragment>

        // ✅ 用世界座標微分求世界法線（避免依賴 three 內部 normal 插入順序）
        vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        N = faceforward(N, cameraPosition - vWorldPos, N);

        vec3 colA = sampleTriplanar(texA, N, vWorldPos, uScale);      // grass
        vec3 colB = sampleTriplanar(texB, N, vWorldPos, uScale*0.8);  // dirt
        vec3 colC = sampleTriplanar(texC, N, vWorldPos, uScale*0.7);  // rock
        vec3 colD = sampleTriplanar(texD, N, vWorldPos, uScale*0.9);  // sand

        float slope = clamp(1.0 - dot(N, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
        float wRockSlope = smoothstep(uSlopeMin, uSlopeMax, slope);

        vec4 w = vec4(0.4, 0.3, wRockSlope, 0.3);
        if (uHasSplat > 0.5) {                      // ✅ 用浮點比較
          vec2 uvS = vWorldPos.xz / uWorldSize + 0.5;
          vec4 sw = texture2D(splat, uvS);
          float ssum = sw.r + sw.g + sw.b + sw.a + 1e-5;
          w = sw / ssum;
          w.b = clamp(w.b + wRockSlope*0.5, 0.0, 1.0);
        }

        float sumw = w.r + w.g + w.b + w.a + 1e-5;
        w /= sumw;

       vec3 triColor = colA*w.r + colB*w.g + colC*w.b + colD*w.a;

// ✅ 加亮並稍微偏黃綠
triColor *= vec3(1.45, 1.65, 1.05);  // ← 增加亮度＆偏暖
triColor = pow(triColor, vec3(0.85)); // γ < 1 讓整體更亮

diffuseColor.rgb = triColor;


        `
      );
  };

  return mat;
}
