import * as THREE from "three";
import { bus } from "../core/EventBus.js";

// 世界空間的戰鬥回饋。全部由 Combat / EnemyBrain 發出的事件驅動——
// 這一層只負責「把已經發生的事情畫出來」，不判定命中也不改遊戲狀態。
//
// 所有短命特效走物件池：幾何與材質共用，執行中不配置新物件，
// 數量有上限，reset/死亡/暫停時一次清乾淨（clear 可重複呼叫）。

const RING_GEO = new THREE.RingGeometry(0.35, 0.5, 24);
const MAX_BURSTS = 24;

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// 每種特效的視覺語意分開：命中=黃、玩家受擊=紅、死亡=橘、預告=紅圈
const STYLE = {
  hitEnemy: { color: 0xffd66b, life: 0.28, from: 0.5, to: 2.2 },
  hitPlayer: { color: 0xff5544, life: 0.34, from: 0.7, to: 2.8 },
  death: { color: 0xff9a3c, life: 0.55, from: 0.6, to: 4.5 },
  extract: { color: 0x2dd4bf, life: 0.9, from: 1.0, to: 7.0 },
};

export class Vfx {
  constructor(scene) {
    this.scene = scene;
    this.bursts = [];   // { mesh, t, life, from, to }
    this.pool = [];
    this.marks = new Map();   // enemy → 警戒驚嘆號
    this.windups = new Map(); // enemy → 開火預告圈

    this.markGeo = new THREE.PlaneGeometry(1.0, 1.0);
    this.markMat = new THREE.MeshBasicMaterial({
      map: makeAlertTexture(), transparent: true, depthWrite: false,
    });
    this.windupMat = new THREE.MeshBasicMaterial({
      color: 0xff4433, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
    });

    this._offs = [
      bus.on("combat:hit", ({ targetType, x, z }) =>
        this.burst(x, z, targetType === "player" ? STYLE.hitPlayer : STYLE.hitEnemy)),
      bus.on("enemy:died", ({ enemy, x, z }) => { this.burst(x, z, STYLE.death); this.clearEnemy(enemy); }),
      bus.on("player:died", ({ x, z }) => this.burst(x, z, STYLE.death)),
      bus.on("enemy:alerted", ({ enemy }) => this.addMark(enemy)),
      bus.on("enemy:windup", ({ enemy, duration }) => this.addWindup(enemy, duration)),
      bus.on("enemy:windupCancel", ({ enemy }) => this.removeWindup(enemy)),
      bus.on("victory", ({ x, z } = {}) => this.burst(x ?? 0, z ?? 0, STYLE.extract)),
    ];
  }

  dispose() {
    this._offs.forEach((off) => off());
    this._offs.length = 0;
    this.clear();
  }

  burst(x, z, style) {
    if (this.bursts.length >= MAX_BURSTS) return; // 上限，密集交火時不會爆量
    // 池子裡的 mesh 連材質一起重複使用，只改顏色與透明度，執行中不再配置物件
    let mesh = this.pool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 900;
    }
    mesh.material.color.setHex(style.color);
    mesh.material.opacity = 1;
    mesh.position.set(x, 0.08, z);
    mesh.scale.setScalar(style.from);
    this.scene.add(mesh);
    this.bursts.push({ mesh, t: 0, ...style });
  }

  addMark(enemy) {
    if (this.marks.has(enemy)) return;
    const m = new THREE.Mesh(this.markGeo, this.markMat);
    m.renderOrder = 950;
    this.scene.add(m);
    this.marks.set(enemy, m);
  }

  addWindup(enemy, duration) {
    this.removeWindup(enemy);
    const m = new THREE.Mesh(RING_GEO, this.windupMat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 940;
    this.scene.add(m);
    this.windups.set(enemy, { mesh: m, t: 0, duration });
  }

  removeWindup(enemy) {
    const w = this.windups.get(enemy);
    if (!w) return;
    this.scene.remove(w.mesh);
    this.windups.delete(enemy);
  }

  // 敵人死亡/消失時，把掛在牠身上的標記一起收掉（可重複呼叫）
  clearEnemy(enemy) {
    const mark = this.marks.get(enemy);
    if (mark) {
      this.scene.remove(mark);
      this.marks.delete(enemy);
    }
    this.removeWindup(enemy);
  }

  clear() {
    for (const b of this.bursts) {
      this.scene.remove(b.mesh);
      this.pool.push(b.mesh);
    }
    this.bursts.length = 0;
    for (const m of this.marks.values()) this.scene.remove(m);
    this.marks.clear();
    for (const w of this.windups.values()) this.scene.remove(w.mesh);
    this.windups.clear();
  }

  frame(dt, camera, aliveEnemies) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        this.scene.remove(b.mesh);
        this.pool.push(b.mesh);
        this.bursts.splice(i, 1);
        continue;
      }
      // 減少動態偏好：不放大，只留一個短暫的靜態提示
      b.mesh.scale.setScalar(REDUCED ? b.to * 0.6 : b.from + (b.to - b.from) * k);
      b.mesh.material.opacity = 1 - k;
    }

    // 標記跟著敵人跑；敵人已經不在場上就自動收掉
    for (const [enemy, mesh] of this.marks) {
      if (!aliveEnemies.has(enemy) || enemy.brain.state === "patrol") {
        this.scene.remove(mesh);
        this.marks.delete(enemy);
        continue;
      }
      mesh.position.set(enemy.pos.x, 3.2, enemy.pos.z);
      mesh.quaternion.copy(camera.quaternion);
    }

    for (const [enemy, w] of this.windups) {
      if (!aliveEnemies.has(enemy)) {
        this.scene.remove(w.mesh);
        this.windups.delete(enemy);
        continue;
      }
      w.t += dt;
      // 圈往內收＝倒數，收到底就是開火的瞬間
      const k = Math.min(1, w.t / w.duration);
      w.mesh.position.set(enemy.pos.x, 0.1, enemy.pos.z);
      w.mesh.scale.setScalar(4.2 - 3.0 * k);
    }
  }
}

// 用 canvas 畫一個帶描邊的驚嘆號當警戒標記
function makeAlertTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d");
  c.font = "bold 54px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineWidth = 6;
  c.strokeStyle = "#3a1200";
  c.strokeText("!", 32, 34);
  c.fillStyle = "#ffd23f";
  c.fillText("!", 32, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
