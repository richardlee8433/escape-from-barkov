import * as THREE from "three";
import { Collision } from "../systems/Collision.js";
import {
  HOME_SCALE as S, ROOM, DOOR, ROOF_HOLES, FLOOR_HOLES, FIRE, STATIONS, SLOTS, stationById,
} from "../config/home.js";
import { byId, RARITIES } from "../config/treasures.js";

// 柯基的家(室內場景)。自己一個 THREE.Scene,離開地圖時整個換過來渲染。
//
// 所有零件模型都在同一個房間座標裡建模(見 tools/blender/home.py),直接疊在 root 底下;
// 修好一個站點 = 把「壞的」模型藏起來、「好的」顯示出來。
//
// 光線就是進度:
//   - 屋頂破洞時,陽光從洞裡一道道照下來(看不見的屋頂只負責投影,洞的地方沒有瓦片),空氣裡飄著灰塵
//   - 窗戶的光從後牆照進來:釘著木板時是一條條的,修好之後是完整的窗格
//   - 每修好一樣,屋裡的暖光就亮一點;壁爐修好後點起火,火光會閃
const H = ROOM.h;
const ROOF_Y = H - 0.05;           // 看不見的屋頂,稍微壓在牆頂下面,牆與屋頂之間不漏光
const SUN_DIR = new THREE.Vector3(0.16, -1, -0.22).normalize(); // 陽光行進方向(房間單位)
const WIN_DIR = new THREE.Vector3(0.12, -0.62, 0.78).normalize();

const _v = new THREE.Vector3();

// 寶物擺出來的樣子:emoji 立在底部、腳下一點陰影;稀有的有一圈淡淡的光
const texCache = new Map();
export function displayTexture(icon, glow = null) {
  const key = icon + (glow || "");
  if (texCache.has(key)) return texCache.get(key);
  const W = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = W;
  const c = cv.getContext("2d");
  if (glow) {
    const g = c.createRadialGradient(W / 2, W * 0.55, 0, W / 2, W * 0.55, W * 0.5);
    g.addColorStop(0, glow + "66");
    g.addColorStop(1, glow + "00");
    c.fillStyle = g;
    c.fillRect(0, 0, W, W);
  }
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath();
  c.ellipse(W / 2, W - 7, W * 0.3, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.font = "92px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  c.textAlign = "center";
  c.textBaseline = "alphabetic";
  c.fillText(icon, W / 2, W - 16);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

function softDot(inner, outer) {
  const W = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = W;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  c.fillStyle = g;
  c.fillRect(0, 0, W, W);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class HomeScene {
  constructor(assets, state) {
    this.state = state;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d1812);

    // 房間(房間單位,整個放大 S 倍;地板木頭的上緣對齊遊戲平面 y=0)
    this.root = new THREE.Group();
    this.root.scale.setScalar(S);
    this.root.position.y = -0.05 * S;
    this.scene.add(this.root);
    this.root.add(assets.cloneRaw("home_shell"));
    this.models = {};
    for (const st of STATIONS) {
      const m = {
        broken: st.broken ? assets.cloneRaw(st.broken) : null,
        fixed: st.fixed ? assets.cloneRaw(st.fixed) : null,
      };
      for (const o of [m.broken, m.fixed]) if (o) this.root.add(o);
      this.models[st.id] = m;
    }

    this.t = 0;
    this.puffs = [];
    this._outside();
    this._lights();
    this._roof();
    this._shafts();
    this._fire();
    this._markers();
    this.displays = new Map(); // slotId → sprite
    this.apply(true);
  }

  // 房間單位 → 世界座標
  static world(x, y, z) {
    return new THREE.Vector3(x * S, y * S, z * S);
  }

  // ---------------------------------------------------------------- 建置

  _outside() {
    // 屋外:一圈慢慢暗下去的草地,牆矮的那兩側看得到
    const W = 256;
    const cv = document.createElement("canvas");
    cv.width = cv.height = W;
    const c = cv.getContext("2d");
    const g = c.createRadialGradient(W / 2, W / 2, W * 0.12, W / 2, W / 2, W / 2);
    g.addColorStop(0, "#47552f");
    g.addColorStop(0.5, "#303a22");
    g.addColorStop(1, "#1d1812");
    c.fillStyle = g;
    c.fillRect(0, 0, W, W);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(34, 48),
      new THREE.MeshLambertMaterial({ map: tex })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    this.scene.add(ground);
    // 門口一小段泥土路
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(5, DOOR.z1 - DOOR.z0 + 0.6),
      new THREE.MeshLambertMaterial({ color: 0x6b5236 })
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set((ROOM.x1 + 2.6) * S, -0.1, ((DOOR.z0 + DOOR.z1) / 2) * S);
    path.scale.setScalar(S);
    path.receiveShadow = true;
    this.scene.add(path);
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xdfe6ee, 0x5a4630, 0.3);
    this.scene.add(this.hemi);

    const shadowed = (light, half) => {
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      const cam = light.shadow.camera;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = 1; cam.far = 60;
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.03;
      this.scene.add(light, light.target);
    };
    // 陽光:只從屋頂的破洞照進來(其他地方被看不見的屋頂擋住)
    this.sun = new THREE.DirectionalLight(0xfff0d2, 3.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(-30);
    shadowed(this.sun, 11);
    // 窗光:從後牆的窗戶斜斜照進來
    this.winLight = new THREE.DirectionalLight(0xffe2b0, 2.0);
    const wt = HomeScene.world(-1.5, 0, -1.6);
    this.winLight.target.position.copy(wt);
    this.winLight.position.copy(wt).addScaledVector(WIN_DIR, -26);
    shadowed(this.winLight, 9);
    // 屋裡的暖光:修得越多越亮
    this.warm = new THREE.PointLight(0xffb878, 0, 0, 2);
    this.warm.position.copy(HomeScene.world(0.2, 2.7, 0.2));
    this.scene.add(this.warm);
  }

  _roof() {
    // 看不見、只投影子的屋頂。破洞版本挖掉 ROOF_HOLES 的地方,修好時換成完整的。
    // 屋頂洞的位置要讓陽光正好落在地上那堆稻草(ROOF_HOLES 是地上的位置)
    const k = (ROOF_Y) / -SUN_DIR.y;
    this.roofHoles = ROOF_HOLES.map(([x, z]) => [x - SUN_DIR.x * k, z - SUN_DIR.z * k]);
    const x0 = ROOM.x0 - 0.1, x1 = ROOM.x1 + 1.5, z0 = ROOM.z0 - 0.1, z1 = ROOM.z1 + 1.8;
    const make = (holes) => {
      const pos = [];
      const step = 0.2;
      for (let x = x0; x < x1 - 1e-6; x += step) {
        for (let z = z0; z < z1 - 1e-6; z += step) {
          const cx = x + step / 2, cz = z + step / 2;
          if (holes.some(([hx, hz]) => Math.hypot(cx - hx, (cz - hz) * 1.15) < 0.5)) continue;
          const xb = Math.min(x + step, x1), zb = Math.min(z + step, z1);
          pos.push(x, ROOF_Y, z, x, ROOF_Y, zb, xb, ROOF_Y, z, xb, ROOF_Y, z, x, ROOF_Y, zb, xb, ROOF_Y, zb);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.castShadow = true;
      m.receiveShadow = false;
      this.root.add(m);
      return m;
    };
    this.roofBroken = make(this.roofHoles);
    this.roofFixed = make([]);
  }

  _shafts() {
    // 一道道光柱(從屋頂破洞到地上)+ 飄在光裡的灰塵
    const cv = document.createElement("canvas");
    cv.width = 4; cv.height = 128;
    const c = cv.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255,240,205,0.9)");
    g.addColorStop(0.6, "rgba(255,236,200,0.45)");
    g.addColorStop(1, "rgba(255,236,200,0.0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(cv);
    // 光柱的邊緣要淡掉(正對視線的地方最亮),不然看起來像一根實心的柱子
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, opacity: { value: 0.16 }, color: { value: new THREE.Color(0xffe6b8) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float opacity; uniform vec3 color;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float face = abs(dot(normalize(vN), normalize(vV)));
          float a = texture2D(map, vUv).a * pow(face, 2.2) * opacity;
          gl_FragColor = vec4(color * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.shaftMat = mat;
    this.shafts = new THREE.Group();
    this.dust = [];
    const len = ROOF_Y / -SUN_DIR.y;
    const dir = SUN_DIR.clone().negate(); // 往上
    const dustTex = softDot("rgba(255,244,214,1)", "rgba(255,244,214,0)");
    for (const [hx, hz] of ROOF_HOLES) {
      const geo = new THREE.CylinderGeometry(0.42, 0.5, len, 24, 1, true);
      geo.translate(0, len / 2, 0); // 底部在原點
      const m = new THREE.Mesh(geo, mat);
      m.position.set(hx, 0.02, hz);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      m.renderOrder = 5;
      this.shafts.add(m);
      // 灰塵
      const n = 40;
      const pos = new Float32Array(n * 3);
      const seeds = [];
      for (let i = 0; i < n; i++) seeds.push([Math.random(), Math.random() * Math.PI * 2, Math.random() * 0.4, Math.random()]);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({
        map: dustTex, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      pts.frustumCulled = false;
      this.shafts.add(pts);
      this.dust.push({ pts, seeds, base: [hx, hz], len, dir });
    }
    this.root.add(this.shafts);
  }

  _fire() {
    this.fire = new THREE.PointLight(0xff8a3c, 0, 16, 1.6);
    this.fire.position.copy(HomeScene.world(FIRE.x + 0.15, 0.45, FIRE.z));
    this.scene.add(this.fire);
    const tex = softDot("rgba(255,214,120,1)", "rgba(255,90,20,0)");
    this.flames = [];
    this.flameGroup = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: i < 3 ? 0xffd27a : 0xff7a2c, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      sp.center.set(0.5, 0.15);
      const p = HomeScene.world(FIRE.x - 0.05 + Math.random() * 0.15, 0.16, FIRE.z - 0.45 + (i / 6) * 0.9);
      sp.position.copy(p);
      sp.userData.base = p.clone();
      sp.userData.ph = Math.random() * 10;
      sp.userData.size = i < 3 ? 0.55 : 0.8;
      this.flameGroup.add(sp);
      this.flames.push(sp);
    }
    this.scene.add(this.flameGroup);
  }

  _markers() {
    // 還沒修好的地方飄著一個小槌子(材料夠了就亮起來);門口有個腳印
    this.markers = [];
    const add = (id, x, z, icon) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: displayTexture(icon), transparent: true, depthWrite: false }));
      sp.center.set(0.5, 0);
      sp.scale.setScalar(0.6);
      sp.position.set(x * S, 1.25, z * S);
      sp.userData = { id, y: 1.25, ph: Math.random() * 6 };
      sp.renderOrder = 20;
      this.scene.add(sp);
      this.markers.push(sp);
    };
    for (const st of STATIONS) add(st.id, st.at[0][0], st.at[0][1], "🔨");
    add("door", ROOM.x1 - 0.1, (DOOR.z0 + DOOR.z1) / 2, "🐾");

    // 目前按 E 會作用的那個點:地上一圈光
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.75, depthWrite: false })
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.visible = false;
    this.focusRing.renderOrder = 6;
    this.scene.add(this.focusRing);
  }

  // ---------------------------------------------------------------- 狀態

  // 依 HomeState 切換模型、光線、碰撞、擺設。instant:光線直接到位(剛進門時)
  apply(instant = false) {
    const st = this.state;
    for (const s of STATIONS) {
      const m = this.models[s.id];
      const ok = st.isRepaired(s.id);
      if (m.broken) m.broken.visible = !ok;
      if (m.fixed) m.fixed.visible = ok;
    }
    const roof = st.isRepaired("roof");
    this.roofBroken.visible = !roof;
    this.roofFixed.visible = roof;
    this.shafts.visible = !roof;
    this.fireOn = st.isRepaired("fireplace");
    this.flameGroup.visible = this.fireOn;

    const c = st.coziness;
    this.target = {
      hemi: 0.28 + 0.42 * c,
      warm: 4 + 46 * c,
      win: st.isRepaired("window") ? 2.6 : 1.6,
      fire: this.fireOn ? 30 : 0,
    };
    if (instant) {
      this.hemi.intensity = this.target.hemi;
      this.warm.intensity = this.target.warm;
      this.winLight.intensity = this.target.win;
      this.fireBase = this.target.fire;
    }
    for (const mk of this.markers) {
      if (mk.userData.id === "door") continue;
      const done = st.isRepaired(mk.userData.id);
      mk.visible = !done;
      mk.material.opacity = st.canRepair(mk.userData.id) ? 1 : 0.4;
    }
    this.refreshDisplays();
    this.collision = this._buildCollision();
  }

  refreshDisplays() {
    for (const slot of SLOTS) {
      const tid = this.state.displays[slot.id];
      let sp = this.displays.get(slot.id);
      if (!tid) {
        if (sp) sp.visible = false;
        continue;
      }
      const t = byId[tid];
      const tex = displayTexture(t.icon, t.tier >= 2 ? RARITIES[t.tier].color : null);
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.02 }));
        sp.center.set(0.5, 0.02);
        const [x, y, z] = slot.pos;
        sp.position.copy(HomeScene.world(x, y, z));
        sp.position.y += this.root.position.y;
        sp.scale.setScalar(0.95);
        this.scene.add(sp);
        this.displays.set(slot.id, sp);
      }
      sp.material.map = tex;
      sp.visible = true;
    }
  }

  // 房間裡的碰撞(世界座標):四面牆、門口、壁爐、桌子,地板沒修好時的兩個破洞
  _buildCollision() {
    const c = new Collision();
    const box = (x0, z0, x1, z1) => c.addBox(((x0 + x1) / 2) * S, ((z0 + z1) / 2) * S, 0, ((x1 - x0) / 2) * S, ((z1 - z0) / 2) * S);
    const T = 0.8;
    box(ROOM.x0 - T, ROOM.z0 - T, ROOM.x1 + T, ROOM.z0);          // 後牆
    box(ROOM.x0 - T, ROOM.z0 - T, ROOM.x0, ROOM.z1 + T);          // 左牆
    box(ROOM.x0 - T, ROOM.z1, ROOM.x1 + T, ROOM.z1 + T);          // 前牆(矮)
    box(ROOM.x1, ROOM.z0 - T, ROOM.x1 + T, DOOR.z0);              // 右牆(矮,門口兩側)
    box(ROOM.x1, DOOR.z1, ROOM.x1 + T, ROOM.z1 + T);
    box(ROOM.x1 + 0.35, DOOR.z0 - 0.1, ROOM.x1 + T + 0.4, DOOR.z1 + 0.1); // 門外(出門用 E,不是走出去)
    box(ROOM.x0, -2.05, -3.85, 0.05);                              // 壁爐
    box(0.48, -0.75, 1.92, 0.15);                                  // 桌子(翻倒的也差不多佔這塊)
    if (!this.state.isRepaired("floor")) {
      for (const [x, z, r] of FLOOR_HOLES) c.addStatic(x * S, z * S, (r - 0.15) * S, { blocksBullets: false });
    }
    return c;
  }

  // ---------------------------------------------------------------- 回饋

  // 按 E 會作用的地方:地上亮一圈(null = 沒有)
  setFocus(pt) {
    this.focusRing.visible = !!pt;
    if (pt) this.focusRing.position.set(pt[0] * S, 0.03, pt[1] * S);
  }

  // 修好時揚起一陣灰塵和幾顆亮晶晶
  puff(stationId) {
    const st = stationById[stationId];
    if (!st) return;
    const dust = this._dustTex || (this._dustTex = softDot("rgba(214,190,150,0.95)", "rgba(214,190,150,0)"));
    const spark = this._sparkTex || (this._sparkTex = softDot("rgba(255,240,180,1)", "rgba(255,200,90,0)"));
    for (const [x, z] of st.at) {
      for (let i = 0; i < 18; i++) {
        const sparkle = i % 3 === 0;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: sparkle ? spark : dust, transparent: true, depthWrite: false,
          blending: sparkle ? THREE.AdditiveBlending : THREE.NormalBlending,
        }));
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.6;
        sp.position.set((x + Math.cos(a) * r) * S, 0.2 + Math.random() * 0.5, (z + Math.sin(a) * r) * S);
        const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 1.6), 1 + Math.random() * 2.2, Math.sin(a) * (1 + Math.random() * 1.6));
        if (sparkle) v.y += 1.5;
        this.scene.add(sp);
        this.puffs.push({ sp, v, t: 0, life: sparkle ? 1.1 : 0.9 + Math.random() * 0.5, size: sparkle ? 0.3 : 0.7 + Math.random() * 0.6, sparkle });
      }
    }
  }

  // 每幀
  frame(dt, t) {
    this.t = t;
    const k = Math.min(1, dt * 1.5);
    const tg = this.target;
    this.hemi.intensity += (tg.hemi - this.hemi.intensity) * k;
    this.warm.intensity += (tg.warm - this.warm.intensity) * k;
    this.winLight.intensity += (tg.win - this.winLight.intensity) * k;
    this.fireBase = (this.fireBase || 0) + (tg.fire - (this.fireBase || 0)) * k;
    // 火光:幾個不同頻率的正弦疊起來,忽明忽暗
    const flick = 0.82 + 0.1 * Math.sin(t * 13.1) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * Math.sin(t * 7.3);
    this.fire.intensity = this.fireBase * flick;
    if (this.fireOn) {
      for (const f of this.flames) {
        const ph = f.userData.ph;
        const s = f.userData.size * (0.8 + 0.25 * Math.sin(t * 9 + ph) + 0.1 * Math.sin(t * 21 + ph * 2));
        f.scale.set(s * 0.75, s * 1.25, 1);
        f.position.x = f.userData.base.x + Math.sin(t * 5 + ph) * 0.03;
        f.material.opacity = 0.75 + 0.25 * Math.sin(t * 15 + ph);
      }
    }
    // 光裡的灰塵:慢慢往下飄、左右晃
    if (this.shafts.visible) {
      for (const d of this.dust) {
        const p = d.pts.geometry.attributes.position;
        for (let i = 0; i < d.seeds.length; i++) {
          const [h0, a, r, sp] = d.seeds[i];
          const h = ((h0 - t * (0.015 + sp * 0.02)) % 1 + 1) % 1;
          const along = h * d.len * 0.95;
          _v.set(d.base[0], 0.05, d.base[1]).addScaledVector(d.dir, along);
          const aa = a + t * 0.3 * (sp - 0.5);
          p.setXYZ(i, _v.x + Math.cos(aa) * r, _v.y, _v.z + Math.sin(aa) * r);
        }
        p.needsUpdate = true;
      }
      this.shaftMat.uniforms.opacity.value = 0.42 + 0.08 * Math.sin(t * 0.7);
    }
    for (const mk of this.markers) {
      if (!mk.visible) continue;
      mk.position.y = mk.userData.y + Math.sin(t * 2.4 + mk.userData.ph) * 0.12;
    }
    if (this.focusRing.visible) this.focusRing.material.opacity = 0.55 + 0.25 * Math.sin(t * 5);
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      const u = p.t / p.life;
      if (u >= 1) {
        this.scene.remove(p.sp);
        p.sp.material.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      p.v.multiplyScalar(1 - dt * (p.sparkle ? 1.5 : 3));
      if (!p.sparkle) p.v.y -= dt * 0.8;
      p.sp.position.addScaledVector(p.v, dt);
      p.sp.scale.setScalar(p.size * (p.sparkle ? 1 - u * 0.5 : 0.6 + u));
      p.sp.material.opacity = p.sparkle ? 1 - u : (1 - u) * 0.85;
    }
  }
}
