import * as THREE from "three";

// 大量重複的小植物(蘆葦、水草、睡蓮)用 InstancedMesh:一種植物一個 draw call。
// sway > 0 時在 vertex shader 裡讓植物隨風 / 隨水流擺動,越高的部位擺得越多。
export class InstancedProp {
  constructor(scene, assets, name, matrices, { sway = 0, swayFreq = 1.3, castShadow = false } = {}) {
    this.uTime = { value: 0 };
    const src = assets.lib.get(name).scene;
    src.updateMatrixWorld(true);
    let mesh = null;
    src.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    const base = mesh.matrixWorld.clone();

    const mat = mesh.material.clone();
    mat.side = THREE.DoubleSide; // 葉片是單層面片
    if (sway > 0) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.uTime;
        sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float h = max(position.y, 0.0);
           float ph = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.9;
           transformed.x += sin(uTime * ${swayFreq.toFixed(2)} + ph + position.y * 1.5) * ${sway.toFixed(3)} * h * h;
           transformed.z += cos(uTime * ${(swayFreq * 0.8).toFixed(2)} + ph * 1.3) * ${(sway * 0.6).toFixed(3)} * h * h;`
        );
      };
    }

    this.mesh = new THREE.InstancedMesh(mesh.geometry, mat, Math.max(1, matrices.length));
    matrices.forEach((m, i) => this.mesh.setMatrixAt(i, m.clone().multiply(base)));
    this.mesh.count = matrices.length;
    this.mesh.name = name;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.computeBoundingSphere();
    scene.add(this.mesh);
  }

  setTime(t) {
    this.uTime.value = t;
  }
}

// 位置 + 繞 Y 旋轉 + 等比縮放 → 矩陣
export function placeMatrix(x, y, z, yaw, scale) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale)
  );
}
