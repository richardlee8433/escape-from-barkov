import * as THREE from "three";

// 固定俯視角跟隨相機 + 滑鼠地面瞄準。
// 地面是平的（y=0），瞄準點用「射線 × 平面」解析解，不需要 raycast 場景。
const PITCH = THREE.MathUtils.degToRad(40);
const YAW = THREE.MathUtils.degToRad(40);
const DIST = 30;

export class CameraRig {
  constructor(camera, scene) {
    this.camera = camera;
    this.yaw = YAW;

    const flat = DIST * Math.cos(PITCH);
    this.offset = new THREE.Vector3(
      flat * Math.sin(YAW),
      DIST * Math.sin(PITCH),
      flat * Math.cos(YAW)
    );

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
