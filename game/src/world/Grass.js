import * as THREE from "three";
import { BAL } from "../config/balance.js";

// Instanced 草地：幾萬株草葉一個 draw call，顏色取樣地面貼圖所以完全融合。
// shader 注入風吹搖擺（uTime）。
export class GrassField {
  constructor(scene, isGrassAt, colorAt, count = 55000) {
    const size = BAL.world.size;
    const geo = new THREE.PlaneGeometry(0.14, 0.6, 1, 2);
    geo.translate(0, 0.3, 0);

    this.uTime = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float swayW = pow(max(position.y, 0.0) / 0.6, 1.8);
         float ph = instanceMatrix[3][0] * 0.55 + instanceMatrix[3][2] * 0.85;
         transformed.x += sin(uTime * 1.7 + ph) * swayW * 0.06;
         transformed.z += cos(uTime * 1.3 + ph * 1.3) * swayW * 0.04;`
      );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    let n = 0;
    for (let i = 0; i < count * 2 && n < count; i++) {
      const x = (Math.random() - 0.5) * (size - 8);
      const z = (Math.random() - 0.5) * (size - 8);
      if (!isGrassAt(x, z)) continue;
      dummy.position.set(x, 0, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.35, Math.random() * Math.PI, (Math.random() - 0.5) * 0.35);
      const s = 0.7 + Math.random() * 0.8;
      dummy.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(n, dummy.matrix);
      const [r, g, b] = colorAt(x, z);
      c.setRGB(r / 255, g / 255, b / 255).convertSRGBToLinear();
      c.multiplyScalar(1.0 + Math.random() * 0.4);
      this.mesh.setColorAt(n, c);
      n++;
    }
    this.mesh.count = n;
    scene.add(this.mesh);
  }

  setTime(t) {
    this.uTime.value = t;
  }
}
