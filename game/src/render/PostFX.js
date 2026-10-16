import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// 後處理管線：bloom → tone mapping → tilt-shift 景深 + 暖色調色 + 暗角 + 顆粒。
// 這一層就是「像遊戲截圖」和「像作業」的分水嶺。
const GradeTiltShift = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(innerWidth, innerHeight) },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float uTime;
    varying vec2 vUv;

    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // tilt-shift：畫面中帶清晰，往上下漸模糊（微縮模型感）
      float focus = 0.46;
      float blurAmt = smoothstep(0.16, 0.50, abs(vUv.y - focus));
      float maxR = 3.2 * blurAmt;
      vec2 px = maxR / resolution;

      vec3 c = texture2D(tDiffuse, vUv).rgb * 0.24;
      c += texture2D(tDiffuse, vUv + vec2( 0.5,  0.8) * px).rgb * 0.095;
      c += texture2D(tDiffuse, vUv + vec2(-0.7,  0.5) * px).rgb * 0.095;
      c += texture2D(tDiffuse, vUv + vec2( 0.9, -0.3) * px).rgb * 0.095;
      c += texture2D(tDiffuse, vUv + vec2(-0.4, -0.9) * px).rgb * 0.095;
      c += texture2D(tDiffuse, vUv + vec2( 0.2, -0.6) * px).rgb * 0.095;
      c += texture2D(tDiffuse, vUv + vec2(-0.9, -0.1) * px).rgb * 0.095;
      c += texture2D(tDiffuse, vUv + vec2( 0.6,  0.4) * px).rgb * 0.095;
      c += texture2D(tDiffuse, vUv + vec2(-0.2,  0.95) * px).rgb * 0.095;

      // 暖色調色 + 輕微飽和提升
      c *= vec3(1.03, 1.0, 0.95);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.08);
      c = pow(c, vec3(1.04));

      // 暗角
      float d = distance(vUv, vec2(0.5, 0.48));
      c *= 0.70 + 0.30 * smoothstep(0.85, 0.30, d);

      // 極輕的顆粒
      c += (rand(vUv * (1.0 + fract(uTime))) - 0.5) * 0.022;

      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.18, 0.5, 0.82));
    this.composer.addPass(new OutputPass());
    this.gradePass = new ShaderPass(GradeTiltShift);
    this.composer.addPass(this.gradePass);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.gradePass.uniforms.resolution.value.set(w, h);
  }

  render(t) {
    this.gradePass.uniforms.uTime.value = t;
    this.composer.render();
  }
}
