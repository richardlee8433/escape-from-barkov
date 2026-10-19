import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BAL } from "../config/balance.js";

// Instanced 草地：幾萬株草葉一個 draw call，顏色取樣地面貼圖所以完全融合。
// shader 注入風吹搖擺（uTime）。
//
// 草葉是尖細的葉片,法線一律朝上:整片草像草坪一樣均勻受光,
// 不會因為葉片隨機朝向而出現一片片黑色的背光面。
// 根部壓暗、葉尖提亮,等於替每一株草做了接觸陰影(AO)。
const BLADE_H = 0.75;

// 一個實例是一小叢(4 片葉子,各自朝向、高低不同),草地才夠密
function tuftGeometry() {
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.PlaneGeometry(0.12, BLADE_H, 1, 2);
    g.translate(0, BLADE_H / 2, 0);
    const pos = g.attributes.position;
    const h = 0.65 + Math.random() * 0.5;
    const bend = 0.06 + Math.random() * 0.1;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / BLADE_H;
      pos.setX(i, pos.getX(i) * (1 - t * 0.92)); // 往上收尖
      pos.setY(i, pos.getY(i) * h);
      pos.setZ(i, t * t * bend);                 // 微微向外彎
    }
    g.rotateY(k * 1.9 + Math.random() * 0.6);
    g.translate((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.12);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return geo;
}

const MAX_CUTS = 8;

export class GrassField {
  // heightAt(x, z):這裡的草要多高(1 = 原本;院子的草坪修短一點)
  constructor(scene, isGrassAt, colorAt, count = 80000, size = BAL.world.size, heightAt = null) {
    const geo = tuftGeometry();

    this.uTime = { value: 0 };
    // 挖開的洞:圈內的草壓扁不見(最多 MAX_CUTS 個,x、z、半徑)
    this.uCuts = { value: Array.from({ length: MAX_CUTS }, () => new THREE.Vector3(0, 0, 0)) };
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.uniforms.uCuts = this.uCuts;
      sh.vertexShader = `uniform float uTime;\nuniform vec3 uCuts[${MAX_CUTS}];\nvarying float vBladeH;\n` + sh.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\n objectNormal = vec3(0.0, 1.0, 0.0);"
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           vBladeH = position.y / ${BLADE_H.toFixed(2)};
           float swayW = pow(max(vBladeH, 0.0), 1.8);
           float ph = instanceMatrix[3][0] * 0.55 + instanceMatrix[3][2] * 0.85;
           transformed.x += sin(uTime * 1.7 + ph) * swayW * 0.06;
           transformed.z += cos(uTime * 1.3 + ph * 1.3) * swayW * 0.04;
           for (int i = 0; i < ${MAX_CUTS}; i++) {
             vec3 cut = uCuts[i];
             if (cut.z > 0.0 && distance(instanceMatrix[3].xz, cut.xy) < cut.z) transformed *= 0.0;
           }`
        );
      sh.fragmentShader = "varying float vBladeH;\n" + sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           diffuseColor.rgb *= mix(0.38, 1.18, smoothstep(0.0, 1.0, vBladeH));`
        )
        // 雙面材質的背面法線會被翻成朝下 → 一片片黑色草葉。直接用世界的「上」當法線。
        .replace(
          "#include <normal_fragment_begin>",
          `#include <normal_fragment_begin>
           normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
           nonPerturbedNormal = normal;`
        );
    };

    // 先算好每一株的矩陣與顏色,再依位置分到 CHUNKS x CHUNKS 個區塊。
    // 一整片 InstancedMesh 的包圍球蓋住整張地圖,永遠不會被視錐剔除;
    // 分塊之後畫面外的區塊整塊跳過,實際送進 GPU 的草少了八成以上。
    const CHUNKS = 8;
    const cell = size / CHUNKS;
    const buckets = Array.from({ length: CHUNKS * CHUNKS }, () => []);
    const dummy = new THREE.Object3D();
    const tip = new THREE.Color(0x9cbf55);
    let n = 0;
    for (let i = 0; i < count * 2 && n < count; i++) {
      const x = (Math.random() - 0.5) * (size - 8);
      const z = (Math.random() - 0.5) * (size - 8);
      if (!isGrassAt(x, z)) continue;
      dummy.position.set(x, 0, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.35, Math.random() * Math.PI, (Math.random() - 0.5) * 0.35);
      const s = 0.7 + Math.random() * 0.7;
      dummy.scale.set(s, s * (0.7 + Math.random() * 0.7) * (heightAt ? heightAt(x, z) : 1), s);
      dummy.updateMatrix();
      const [r, g, b] = colorAt(x, z);
      const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255).convertSRGBToLinear();
      // 少數草葉偏黃綠,打散一致的色塊
      if (Math.random() < 0.18) c.lerp(tip, 0.35);
      c.multiplyScalar(0.95 + Math.random() * 0.35);
      const cx = Math.min(CHUNKS - 1, Math.floor((x + size / 2) / cell));
      const cz = Math.min(CHUNKS - 1, Math.floor((z + size / 2) / cell));
      buckets[cz * CHUNKS + cx].push([dummy.matrix.clone(), c]);
      n++;
    }

    this.meshes = [];
    for (const list of buckets) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([m, c], i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c);
      });
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.count = n;
  }

  setTime(t) {
    this.uTime.value = t;
  }

  // cuts: [{ x, z, r }](超過 MAX_CUTS 個只取前面的)
  setCuts(cuts) {
    this.uCuts.value.forEach((v, i) => {
      const c = cuts[i];
      v.set(c ? c.x : 0, c ? c.z : 0, c ? c.r : 0);
    });
  }
}
