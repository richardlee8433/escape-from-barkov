import * as THREE from "three";
import { bus } from "../core/EventBus.js";
import { t } from "../i18n/i18n.js";

// 吠叫的回饋:柯基腳下兩圈往外擴的聲波、頭上跳出「WOOF!」,被嚇到的鴨子頭上冒「!!」。
// 效果加在柯基目前所在的場景(地圖或家裡)。HUD 的吠叫按鈕(冷卻進度)也在這裡更新。
function textTexture(text, color, size = 64) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 128;
  const c = cv.getContext("2d");
  c.font = `900 ${size}px system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = 12;
  c.strokeStyle = "rgba(40, 24, 10, 0.85)";
  c.strokeText(text, 128, 66);
  c.fillStyle = color;
  c.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BarkFx {
  constructor(getScene, barker) {
    this.getScene = getScene;
    this.barker = barker;
    this.fx = [];
    this.woofTex = textTexture(t("bark.woof"), "#fff1c9");
    bus.on("lang:changed", () => { this.woofTex = textTexture(t("bark.woof"), "#fff1c9"); });
    this.bangTex = textTexture("!!", "#ff8a5c", 84);
    this.ringGeo = new THREE.RingGeometry(0.85, 1.0, 48);
    this.ringGeo.rotateX(-Math.PI / 2);

    this.btn = document.getElementById("bark-btn");
    this.btnState = document.getElementById("bark-state");
    this.btn?.addEventListener("click", () => bus.emit("input:bark"));
    this._shown = null;

    bus.on("bark", ({ x, z, scared }) => this.bark(x, z, scared));
    bus.on("bark:cooldown", () => {
      this.btn?.classList.remove("nope");
      void this.btn?.offsetWidth;
      this.btn?.classList.add("nope");
    });
  }

  bark(x, z, scared) {
    const scene = this.getScene();
    if (!scene) return;
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
        color: 0xfff1c9, transparent: true, opacity: 0, depthWrite: false,
      }));
      ring.position.set(x, 0.08, z);
      ring.renderOrder = 950;
      scene.add(ring);
      this.fx.push({ kind: "ring", obj: ring, scene, t: -i * 0.14, life: 0.7 });
    }
    const woof = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.woofTex, transparent: true, depthWrite: false, depthTest: false }));
    woof.position.set(x, 2.4, z);
    woof.renderOrder = 990;
    scene.add(woof);
    this.fx.push({ kind: "woof", obj: woof, scene, t: 0, life: 0.95, y: 2.4 });
    for (const e of scared) {
      const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bangTex, transparent: true, depthWrite: false, depthTest: false }));
      bang.renderOrder = 990;
      scene.add(bang);
      this.fx.push({ kind: "bang", obj: bang, scene, t: 0, life: 1.3, enemy: e });
    }
  }

  frame(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const u = f.t / f.life;
      if (u >= 1) {
        f.scene.remove(f.obj);
        f.obj.material.dispose();
        this.fx.splice(i, 1);
        continue;
      }
      if (f.t < 0) continue;
      if (f.kind === "ring") {
        f.obj.scale.setScalar(1 + u * 9);
        f.obj.material.opacity = 0.75 * (1 - u);
      } else if (f.kind === "woof") {
        const pop = Math.min(1, f.t / 0.12);
        f.obj.scale.set(2.6 * pop, 1.3 * pop, 1);
        f.obj.position.y = f.y + u * 0.9;
        f.obj.material.opacity = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      } else {
        const p = f.enemy.pos;
        f.obj.position.set(p.x, 2.7 + Math.sin(f.t * 18) * 0.06, p.z);
        f.obj.scale.set(1.2, 0.6, 1);
        f.obj.material.opacity = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      }
    }

    // HUD:冷卻中顯示秒數、變暗
    if (this.btn) {
      const ready = this.barker.ready;
      const label = ready ? "R" : `${Math.ceil(this.barker.cooldown)}s`;
      if (label !== this._shown) {
        this._shown = label;
        this.btnState.textContent = label;
        this.btn.classList.toggle("cooling", !ready);
      }
    }
  }
}
