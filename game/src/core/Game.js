import * as THREE from "three";
import { Input } from "./Input.js";
import { PostFX } from "../render/PostFX.js";

// 遊戲外殼：renderer / scene / camera / 固定時步主迴圈。
// 邏輯以固定 60Hz tick（update），畫面相關每幀跑（frame），
// 幀率不穩時遊戲速度不會跟著飄。
const STEP = 1 / 60;

// 手機(觸控為主的裝置):畫面解析度降一點,GPU 才跑得動草地、陰影與後處理
export const IS_TOUCH = (() => {
  try {
    return matchMedia("(pointer: coarse)").matches;
  } catch (e) {
    return false;
  }
})();

// 直向的手機畫面很窄:垂直視角 38° 時左右只看得到 18° 左右。
// 畫面比 4:3 窄時把垂直視角放大,讓左右至少看得到 4:3 時的寬度,最多放到 62°(再大會變形)
const BASE_FOV = 38;
export function fovFor(aspect) {
  const minAspect = 4 / 3;
  if (aspect >= minAspect) return BASE_FOV;
  const half = Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * minAspect / aspect);
  return Math.min(62, (half * 360) / Math.PI);
}

export class Game {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // AgX:與 Blender 預設的色彩轉換一致,烘焙貼圖在遊戲裡的色調才會跟算圖相同
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // 遠景淡入午後的霧氣,地圖外緣不再是一片黑
    this.scene.background = new THREE.Color(0xaebfa8);
    this.scene.fog = new THREE.Fog(0xaebfa8, 62, 150);

    this.camera = new THREE.PerspectiveCamera(fovFor(innerWidth / innerHeight), innerWidth / innerHeight, 0.1, 400);

    this.input = new Input(this.renderer.domElement);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    this.systems = [];
    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.paused = false; // 死亡 / 勝利後停邏輯、續渲染

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.fov = fovFor(this.camera.aspect);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.postfx.setSize(innerWidth, innerHeight);
    });
  }

  addSystem(sys) {
    this.systems.push(sys);
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.getElapsedTime();

    if (!this.paused) {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        for (const s of this.systems) s.update?.(STEP);
        this.accumulator -= STEP;
      }
    }
    for (const s of this.systems) s.frame?.(dt, t);

    this.postfx.render(t);
  }
}
