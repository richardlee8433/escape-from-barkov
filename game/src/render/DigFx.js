import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { RARITIES } from "../config/treasures.js";
import { bus } from "../core/EventBus.js";

// 嗅聞與挖寶的畫面(全部由 DigSpots / Player 的事件驅動,不改遊戲狀態):
//   - 嗅聞結果:一縷縷氣味從寶物的方向飄向柯基的鼻子,顏色與數量表示遠近;
//     「就在這裡」時,寶物上方的地面冒出一圈金光
//   - 挖掘:地上出現土洞(洞裡的草被壓掉),旁邊的土堆隨每一鏟長大,土塊往後噴
//   - 挖到:寶物從洞裡升起、發光、上下浮動,然後淡出;洞和土堆過一陣子才消失

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_WISPS = 48;
const MAX_CLODS = 60;
const GRAVITY = 14;

export class DigFx {
  constructor(scene, assets, grass) {
    this.scene = scene;
    this.assets = assets;
    this.grass = grass;
    this.holes = new Map(); // spot → { mesh, pile, r, rTarget, s, sTarget, expire }
    this.wisps = [];
    this.clods = [];
    this.rings = [];
    this.reveals = [];
    this.cutsDirty = false;

    this.holeGeo = new THREE.CircleGeometry(1, 40);
    this.holeGeo.rotateX(-Math.PI / 2);
    this.holeMat = new THREE.MeshStandardMaterial({
      map: holeTexture(), transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.wispTex = softDot();
    this.clodGeo = new THREE.IcosahedronGeometry(0.07, 0);
    this.clodMat = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1, flatShading: true });
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    this.ringGeo.rotateX(-Math.PI / 2);

    bus.on("sniff:result", (e) => this.onSniff(e));
    bus.on("dig:game", (e) => this.onDigStart(e));
    bus.on("dig:hit", (e) => this.onHit(e));
    bus.on("dig:found", (e) => this.onFound(e));
  }

  // ---------------------------------------------------------------- 嗅聞
  onSniff({ x, z, dirX, dirZ, dist, scent, spotX, spotZ }) {
    if (scent.id === "here") {
      this.ring(spotX, spotZ, scent.color, 0.3, 1.4, 1.1);
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.6;
        this.wisp({
          from: new THREE.Vector3(spotX + Math.cos(a) * r, 0.05, spotZ + Math.sin(a) * r),
          to: new THREE.Vector3(spotX + Math.cos(a) * r * 0.5, 1.4 + Math.random() * 0.6, spotZ + Math.sin(a) * r * 0.5),
          color: scent.color, life: 1.2 + Math.random() * 0.5, delay: i * 0.05, size: 0.28, wave: 0.15,
        });
      }
      return;
    }
    const count = { hot: 18, warm: 14, faint: 8, cold: 4 }[scent.id];
    const nose = new THREE.Vector3(x + dirX * 0.9, 0.55, z + dirZ * 0.9);
    const side = new THREE.Vector3(-dirZ, 0, dirX);
    for (let i = 0; i < count; i++) {
      let dx = dirX, dz = dirZ;
      if (scent.id === "cold") {
        // 太遠了聞不出方向:幾縷淡淡的氣味隨便飄
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
      }
      const d = Math.min(dist, 10) * (0.45 + Math.random() * 0.55);
      const j = (Math.random() - 0.5) * 2.2;
      const from = new THREE.Vector3(x + dx * d + side.x * j, 0.25 + Math.random() * 0.8, z + dz * d + side.z * j);
      this.wisp({
        from, to: nose, color: scent.color, life: 1.4 + Math.random() * 0.6, delay: i * 0.06,
        size: scent.id === "cold" ? 0.22 : 0.34, wave: 0.45, side,
      });
    }
  }

  wisp({ from, to, color, life, delay = 0, size = 0.3, wave = 0.3, side = new THREE.Vector3(1, 0, 0) }) {
    if (this.wisps.length >= MAX_WISPS) return;
    const mat = new THREE.SpriteMaterial({
      map: this.wispTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(from);
    sp.renderOrder = 950;
    this.scene.add(sp);
    this.wisps.push({ sp, from: from.clone(), to: to.clone(), life, t: -delay, size, wave, side, ph: Math.random() * 6.28 });
  }

  ring(x, z, color, from, to, life) {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.position.set(x, 0.06, z);
    mesh.renderOrder = 940;
    this.scene.add(mesh);
    this.rings.push({ mesh, from, to, life, t: 0 });
  }

  // ---------------------------------------------------------------- 挖洞
  onDigStart({ x, z, spot, fromX, fromZ }) {
    if (this.holes.has(spot)) return;
    const mesh = new THREE.Mesh(this.holeGeo, this.holeMat);
    mesh.position.set(x, 0.025, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    // 土堆堆在洞的側邊(柯基挖的方向的垂直方向)
    let dx = x - fromX, dz = z - fromZ;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const pile = new THREE.Group();
    pile.add(this.assets.instantiate("dirt_pile", 1, { dim: "scale" }));
    pile.position.set(x - dz * 0.95, 0, z + dx * 0.95);
    pile.rotation.y = Math.random() * Math.PI * 2;
    pile.scale.setScalar(0.01);
    this.scene.add(pile);
    this.holes.set(spot, { mesh, pile, r: 0.01, rTarget: 0.28, s: 0.01, sTarget: 0.25, expire: Infinity, x, z });
    this.cutsDirty = true;
  }

  onHit({ result, hits, need, spot, x, z, fromX, fromZ }) {
    const h = this.holes.get(spot);
    if (h && result !== "miss") {
      const p = hits / need;
      h.rTarget = 0.28 + 0.45 * p;
      h.sTarget = 0.25 + 0.75 * p;
      this.cutsDirty = true;
    }
    // 土塊往柯基後面噴(狗挖土是往兩條後腿之間撥)
    let bx = fromX - x, bz = fromZ - z;
    const L = Math.hypot(bx, bz) || 1;
    bx /= L;
    bz /= L;
    const n = result === "miss" ? 3 : result === "perfect" ? 10 : 7;
    for (let i = 0; i < n && this.clods.length < MAX_CLODS; i++) {
      const m = new THREE.Mesh(this.clodGeo, this.clodMat);
      m.position.set(x + (Math.random() - 0.5) * 0.3, 0.1, z + (Math.random() - 0.5) * 0.3);
      m.scale.setScalar(0.6 + Math.random() * 0.8);
      m.castShadow = true;
      this.scene.add(m);
      const sp = 2.5 + Math.random() * 2.5;
      this.clods.push({
        m, t: 0, life: 1.4,
        v: new THREE.Vector3(bx * sp + (Math.random() - 0.5) * 2, 3 + Math.random() * 2.5, bz * sp + (Math.random() - 0.5) * 2),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      });
    }
  }

  // ---------------------------------------------------------------- 挖到寶
  onFound({ x, z, spot, treasure, tier }) {
    const h = this.holes.get(spot);
    if (h) {
      h.rTarget = 0.75;
      h.sTarget = 1.0;
      h.expire = BAL.items.holeLife;
      this.cutsDirty = true;
    }
    const color = RARITIES[tier].color;
    const tex = treasureTexture(treasure.icon, color);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.position.set(x, 0.1, z);
    sp.scale.setScalar(0.01);
    sp.renderOrder = 960;
    this.scene.add(sp);
    this.reveals.push({ sp, tex, t: 0, life: 3.2 });
    this.ring(x, z, color, 0.3, 1.8 + tier * 0.3, 0.9);
    for (let i = 0; i < 8 + tier * 4; i++) {
      const a = Math.random() * Math.PI * 2;
      this.wisp({
        from: new THREE.Vector3(x, 0.4, z),
        to: new THREE.Vector3(x + Math.cos(a) * 1.4, 1.2 + Math.random() * 1.6, z + Math.sin(a) * 1.4),
        color, life: 0.9 + Math.random() * 0.5, delay: 0.25 + i * 0.02, size: 0.22, wave: 0.1,
      });
    }
  }

  // ---------------------------------------------------------------- 每幀
  frame(dt) {
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const w = this.wisps[i];
      w.t += dt;
      if (w.t < 0) continue;
      const k = w.t / w.life;
      if (k >= 1) {
        this.scene.remove(w.sp);
        w.sp.material.dispose();
        this.wisps.splice(i, 1);
        continue;
      }
      const e = k * k * (3 - 2 * k);
      w.sp.position.lerpVectors(w.from, w.to, e);
      const sway = Math.sin(k * Math.PI * 3 + w.ph) * w.wave * (1 - k);
      w.sp.position.addScaledVector(w.side, sway);
      w.sp.position.y += Math.sin(k * Math.PI * 2 + w.ph) * 0.08;
      w.sp.material.opacity = Math.sin(Math.PI * k) * 0.9;
      w.sp.scale.setScalar(w.size * (1.2 - 0.6 * k));
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(REDUCED ? r.to : r.from + (r.to - r.from) * Math.sqrt(k));
      r.mesh.material.opacity = 1 - k;
    }

    for (let i = this.clods.length - 1; i >= 0; i--) {
      const c = this.clods[i];
      c.t += dt;
      if (c.m.position.y > 0.04) {
        c.v.y -= GRAVITY * dt;
        c.m.position.addScaledVector(c.v, dt);
        c.m.rotation.x += c.spin.x * dt;
        c.m.rotation.y += c.spin.y * dt;
        c.m.rotation.z += c.spin.z * dt;
        if (c.m.position.y < 0.04) c.m.position.y = 0.04;
      }
      if (c.t > c.life) {
        const s = c.m.scale.x - dt * 2;
        if (s <= 0.05) {
          this.scene.remove(c.m);
          this.clods.splice(i, 1);
          continue;
        }
        c.m.scale.setScalar(s);
      }
    }

    for (let i = this.reveals.length - 1; i >= 0; i--) {
      const r = this.reveals[i];
      r.t += dt;
      if (r.t >= r.life) {
        this.scene.remove(r.sp);
        r.sp.material.dispose();
        r.tex.dispose();
        this.reveals.splice(i, 1);
        continue;
      }
      // 從洞裡彈出來 → 浮在半空輕輕上下 → 最後半秒淡出
      const up = Math.min(1, r.t / 0.7);
      const ease = 1 + 2.2 * Math.pow(up - 1, 3) + 1.2 * Math.pow(up - 1, 2);
      r.sp.position.y = 0.1 + 1.9 * ease + (up >= 1 ? Math.sin((r.t - 0.7) * 3) * 0.08 : 0);
      r.sp.scale.setScalar(1.5 * Math.min(1, ease));
      r.sp.material.opacity = Math.min(1, (r.life - r.t) / 0.5);
    }

    for (const [spot, h] of this.holes) {
      h.r += (h.rTarget - h.r) * Math.min(1, dt * 6);
      h.s += (h.sTarget - h.s) * Math.min(1, dt * 6);
      h.expire -= dt;
      if (h.expire < 2) {
        // 洞慢慢被填平
        const k = Math.max(0, h.expire / 2);
        h.mesh.scale.setScalar(h.r * k);
        h.pile.scale.setScalar(h.s * k);
        if (h.expire <= 0) {
          this.scene.remove(h.mesh);
          this.scene.remove(h.pile);
          this.holes.delete(spot);
          this.cutsDirty = true;
        }
        continue;
      }
      h.mesh.scale.setScalar(h.r);
      h.pile.scale.setScalar(h.s);
    }
    if (this.cutsDirty && this.grass) {
      this.cutsDirty = false;
      // 最新的洞優先(洞太多時,最舊的那幾個洞裡的草會長回來)
      const cuts = [...this.holes.values()].reverse().map((h) => ({ x: h.x, z: h.z, r: h.rTarget * 1.15 + 0.15 }));
      this.grass.setCuts(cuts);
    }
  }
}

// 土洞:中間深褐、往外變淺,邊緣是一圈翻出來的鬆土,最外面不規則地淡出
function holeTexture() {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(28,18,10,1)");
  g.addColorStop(0.45, "rgba(52,34,20,1)");
  g.addColorStop(0.7, "rgba(98,70,44,1)");
  g.addColorStop(0.86, "rgba(120,90,58,0.85)");
  g.addColorStop(1, "rgba(120,90,58,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  // 鬆土的顆粒
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * S * 0.47;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const v = Math.random();
    c.fillStyle = v < 0.5 ? `rgba(40,26,15,${0.5 * Math.random()})` : `rgba(140,108,72,${0.5 * Math.random()})`;
    c.beginPath();
    c.arc(x, y, 1 + Math.random() * 3.5, 0, Math.PI * 2);
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 柔和的圓點(氣味、亮點)
function softDot() {
  const S = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

// 挖到的寶物:稀有度顏色的光暈 + 寶物圖示
function treasureTexture(icon, color) {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color + "aa");
  g.addColorStop(1, color + "00");
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  c.font = "120px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(icon, S / 2, S / 2 + 8);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
