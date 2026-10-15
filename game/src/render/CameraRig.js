import * as THREE from "three";

// 固定俯視角跟隨相機 + 滑鼠地面瞄準。
// 地面是平的（y=0），瞄準點用「射線 × 平面」解析解，不需要 raycast 場景。
const PITCH = THREE.MathUtils.degToRad(40);
const YAW = THREE.MathUtils.degToRad(40);
const DIST = 30;

// 相機角度是固定的，所以「相機在目標的哪個方向」是常數。
// 世界裡的看板要面向玩家，就朝這個方向擺，不必每幀 billboard。
const FLAT = DIST * Math.cos(PITCH);
export const CAMERA_OFFSET = new THREE.Vector3(
  FLAT * Math.sin(YAW),
  DIST * Math.sin(PITCH),
  FLAT * Math.cos(YAW)
);

// 方正的建築(農舍)不適合當成圓:長邊轉了角度之後,外接圓大到
// 玩家站在門口也會被判定「被擋住」。改用定向包圍盒(OBB)做精確的線段測試:
// 把相機→目標頭頂的線段轉進建築的本地座標,再做 slab 測試。
// o: { x, z, ry, hx, hz, top },本地座標 x∈[-hx,hx]、y∈[0,top]、z∈[-hz,hz]
export function segmentHitsObb(cam, target, o) {
  const c = Math.cos(o.ry), s = Math.sin(o.ry);
  const toLocal = (px, pz) => {
    const dx = px - o.x, dz = pz - o.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const [ax, az] = toLocal(cam.x, cam.z);
  const [bx, bz] = toLocal(target.x, target.z);
  const a = [ax, cam.y, az];
  const d = [bx - ax, target.y + 1.2 - cam.y, bz - az];
  const lo = [-o.hx, 0, -o.hz];
  const hi = [o.hx, o.top, o.hz];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (a[i] < lo[i] || a[i] > hi[i]) return false;
      continue;
    }
    let ta = (lo[i] - a[i]) / d[i];
    let tb = (hi[i] - a[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export class CameraRig {
  constructor(camera, scene) {
    this.camera = camera;
    this.yaw = YAW;

    this.offset = CAMERA_OFFSET.clone();

    this.aimPoint = null;
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();

    // 地面準心
    this.crosshair = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.38, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    );
    this.crosshair.rotation.x = -Math.PI / 2;
    this.crosshair.renderOrder = 999;
    this.crosshair.visible = false;
    scene.add(this.crosshair);

    this.occluders = [];
    this._faded = new Set();
  }

  setOccluders(list) {
    this.occluders = list;
  }

  // 淡出擋在相機與「重要目標」（玩家、活著的敵人）之間的景物。
  //
  // 相機角度固定，所以不需要 raycast：把遮蔽體當成 2D 圓，
  // 測它有沒有切到相機→目標的線段，再比對高度確認它真的擋得住。
  // 只淡出當下真的擋路的那幾個實例，不是整批同型物件。
  updateOcclusion(targets) {
    const cam = this.camera.position;
    const hit = new Set();

    for (const t of targets) {
      const vx = t.x - cam.x;
      const vz = t.z - cam.z;
      const len2 = vx * vx + vz * vz;
      if (len2 < 1e-6) continue;
      for (const o of this.occluders) {
        if (hit.has(o)) continue;
        if (o.obb) {
          if (segmentHitsObb(cam, t, o)) hit.add(o);
          continue;
        }
        // k 夾在線段內而不是直接排除：玩家正站在樹冠底下時最近點就是玩家自己，
        // 這種「頭頂被蓋住」的情況一樣要淡出。
        let k = ((o.x - cam.x) * vx + (o.z - cam.z) * vz) / len2;
        k = k < 0 ? 0 : k > 1 ? 1 : k;
        const dx = o.x - cam.x - vx * k;
        const dz = o.z - cam.z - vz * k;
        const d2 = dx * dx + dz * dz;
        if (d2 > o.r * o.r) continue;
        // 視線一路往下降，所以要在物件「靠玩家那一側的邊緣」比高度，
        // 而不是在圓心——在圓心比會漏掉那些只擋住視線末段的矮石頭。
        const far = Math.min(1, k + Math.sqrt(o.r * o.r - d2) / Math.sqrt(len2));
        if (o.top > cam.y + (t.y + 1.2 - cam.y) * far) hit.add(o);
      }
    }

    for (const o of this._faded) if (!hit.has(o)) this._setFaded(o, false);
    for (const o of hit) if (!this._faded.has(o)) this._setFaded(o, true);
    this._faded = hit;
  }

  // 同型模型的實例共用同一份 material，直接改會讓整張地圖的樹一起變透明。
  // 第一次淡出時替該實例複製一份專屬材質，之後在兩份之間切換。
  _setFaded(o, faded) {
    o.holder.traverse((m) => {
      if (!m.isMesh) return;
      if (!m.userData.solidMat) {
        m.userData.solidMat = m.material;
        const ghost = m.material.clone();
        ghost.transparent = true;
        ghost.opacity = 0.22;
        ghost.depthWrite = false;
        // 樹葉的 shader 修改不會跟著 clone 過來,要自己帶上
        ghost.onBeforeCompile = m.material.onBeforeCompile;
        ghost.customProgramCacheKey = m.material.customProgramCacheKey;
        m.userData.ghostMat = ghost;
      }
      m.material = faded ? m.userData.ghostMat : m.userData.solidMat;
      m.castShadow = !faded; // 淡出了還投實心影子會露餡
    });
  }

  snapTo(pos) {
    this.camera.position.copy(pos).add(this.offset);
    this.camera.lookAt(pos.x, pos.y + 1, pos.z);
  }

  follow(pos, dt) {
    const target = pos.clone().add(this.offset);
    this.camera.position.lerp(target, Math.min(dt * 5, 1));
    this.camera.lookAt(pos.x, pos.y + 1, pos.z);
  }

  updateAim(mouse) {
    if (!mouse.has) return;
    this._ray.setFromCamera(mouse, this.camera);
    if (this._ray.ray.intersectPlane(this._plane, this._hit)) {
      this.aimPoint = this._hit;
      this.crosshair.position.set(this._hit.x, 0.03, this._hit.z);
      this.crosshair.visible = true;
    }
  }

  // 螢幕方向 → 世界方向（WASD 移動用）
  // 螢幕「上」= 相機看向的水平方向
  moveDir(ax, az) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // forward（螢幕上）
    const rx = -fz, rz = fx;                                   // right（螢幕右）
    const v = new THREE.Vector3(rx * ax + fx * -az, 0, rz * ax + fz * -az);
    if (v.lengthSq() > 0) v.normalize();
    return v;
  }
}
