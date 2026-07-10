import * as THREE from "three";
import { Input } from "./Input.js";
import { PostFX } from "../render/PostFX.js";

// 遊戲外殼：renderer / scene / camera / 固定時步主迴圈。
// 邏輯以固定 60Hz tick（update），畫面相關每幀跑（frame），
// 幀率不穩時遊戲速度不會跟著飄。
const STEP = 1 / 60;

export class Game {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x241c12);

    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);

    this.input = new Input(this.renderer.domElement);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    this.systems = [];
    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.paused = false; // 死亡 / 勝利後停邏輯、續渲染

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
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
