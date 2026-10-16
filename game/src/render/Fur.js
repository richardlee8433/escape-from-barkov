import * as THREE from "three";

// 殼狀毛(shell fur):把同一張皮膚往法線方向一層層往外推,每層只留下「毛的截面」,
// 疊起來就是一根根往外長、越往外越細的毛。即時遊戲做毛皮的經典做法。
//
// - 每層和本體共用幾何與骨架,動畫時毛跟著身體走
// - 毛長由模型的 shade 頂點色決定(Blender 端 fur=…):胸前與尾巴長、臉與腳短,眼睛鼻子沒有毛
// - 毛根暗、毛尖亮;外層的毛往下垂、往後梳(順著身體)
// - 毛不投影子(影子由本體投),也不寫進 alpha 混合,用 alpha test 切出毛的形狀,不用排序
export function addFur(root, { shells = 12, length = 0.028, density = 230, comb = [0, -0.35, -0.5] } = {}) {
  const added = [];
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry.attributes.color) return;
    for (let i = 1; i <= shells; i++) {
      const level = i / shells;
      const mat = shellMaterial(o.material, level, length, density, comb);
      const shell = new THREE.SkinnedMesh(o.geometry, mat);
      shell.bind(o.skeleton, o.bindMatrix);
      shell.position.copy(o.position);
      shell.quaternion.copy(o.quaternion);
      shell.scale.copy(o.scale);
      shell.castShadow = false;
      shell.receiveShadow = true;
      shell.renderOrder = i;
      shell.frustumCulled = false;
      added.push([o.parent, shell]);
    }
  });
  for (const [parent, shell] of added) parent.add(shell);
  return added.length;
}

function shellMaterial(base, level, length, density, comb) {
  const m = new THREE.MeshStandardMaterial({
    map: base.map,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.5,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLevel = { value: level };
    sh.uniforms.uLen = { value: length };
    sh.uniforms.uDensity = { value: density };
    sh.uniforms.uComb = { value: new THREE.Vector3(...comb) };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uLevel, uLen;
         uniform vec3 uComb;
         #ifndef USE_COLOR
         attribute vec3 color;
         #endif
         varying vec3 vFurP;
         varying float vFurLen;`
      )
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
         vFurP = position;
         vFurLen = color.r;
         // 沿法線往外推;越外層越往下垂、往後梳
         transformed += (normalize(objectNormal) + uComb * uLevel) * uLen * uLevel * color.r;`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uLevel, uDensity;
         varying vec3 vFurP;
         varying float vFurLen;
         float furHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`
      )
      .replace(
        "#include <alphatest_fragment>",
        `{
           // 把空間切成小格,每格一根毛:隨機的長度,越往外越細
           vec3 p = vFurP * uDensity;
           vec3 cell = floor(p);
           float h = furHash(cell);
           float r = 0.55 * (1.0 - uLevel * 0.85);
           float d = length(fract(p) - 0.5);
           float keep = step(d, r) * step(uLevel, h * 1.15) * step(0.02, vFurLen);
           diffuseColor.a = keep;
           diffuseColor.rgb *= mix(0.78, 1.1, uLevel);  // 毛根在陰影裡,毛尖受光
         }
         #include <alphatest_fragment>`
      );
  };
  m.customProgramCacheKey = () => `fur-${level}`;
  return m;
}
