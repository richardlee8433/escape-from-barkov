import * as THREE from "three";
import { CameraRig, segmentHitsObb } from "../src/render/CameraRig.js";
import { suite, check, eq } from "./harness.js";

// 造一個帶兩個 mesh 的假遮蔽體，兩個 mesh 共用同一份材質——
// 跟 Assets.instantiate 的 clone(true) 行為一致
function fakeOccluder(x, z, r, top, sharedMat) {
  const holder = new THREE.Group();
  const mat = sharedMat || new THREE.MeshStandardMaterial();
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    m.castShadow = true;
    holder.add(m);
  }
  return { holder, x, z, r, top };
}
// 用遊戲實際的相機幾何：pitch 40° / 距離 30 → 高 19.3、水平 23。
// 視線從 19.3 高降到玩家頭頂 1.2，所以只有靠近目標那一段才擋得住。
const CAM = new THREE.Vector3(0, 19.3, 23);
function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  const rig = new CameraRig(cam, scene);
  cam.position.copy(CAM);
  return rig;
}
const isFaded = (o) => {
  let faded = null;
  o.holder.traverse((m) => {
    if (m.isMesh) faded = m.material === m.userData.ghostMat;
  });
  return faded;
};

export function run() {
  suite("相機遮蔽淡出");

  check("擋在相機與玩家之間的高物件會被淡出", () => {
    const rig = makeRig();
    const o = fakeOccluder(0, 4, 2, 6); // 靠近玩家、夠高
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    return eq(isFaded(o), true);
  });

  check("離視線很遠的物件不受影響", () => {
    const rig = makeRig();
    const o = fakeOccluder(40, 4, 2, 6);
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    return eq(isFaded(o), false);
  });

  check("矮到擋不住視線的物件不會被淡出", () => {
    const rig = makeRig();
    // 視線在該處約 4.35 高,0.4 高的小石頭擋不到
    const o = fakeOccluder(0, 4, 2, 0.4);
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    return eq(isFaded(o), false);
  });

  check("玩家身後（線段之外）的物件不會被淡出", () => {
    const rig = makeRig();
    const o = fakeOccluder(0, -20, 2, 6); // 在玩家更後方
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    return eq(isFaded(o), false);
  });

  check("不再擋路時會恢復實心", () => {
    const rig = makeRig();
    const o = fakeOccluder(0, 4, 2, 6);
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    if (!isFaded(o)) return "第一步就沒淡出";
    rig.updateOcclusion([new THREE.Vector3(60, 0, 60)]); // 玩家走開
    return eq(isFaded(o), false);
  });

  check("只淡出擋路的那一個實例,不會波及同型物件", () => {
    const rig = makeRig();
    const shared = new THREE.MeshStandardMaterial();
    const blocking = fakeOccluder(0, 4, 2, 6, shared);
    const elsewhere = fakeOccluder(40, 4, 2, 6, shared); // 共用同一份材質
    rig.setOccluders([blocking, elsewhere]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    if (!isFaded(blocking)) return "擋路的沒淡出";
    if (isFaded(elsewhere)) return "同型物件被一起淡出了";
    return eq(elsewhere.holder.children[0].material.opacity, 1);
  });

  check("淡出時關掉投影,不會留下實心影子", () => {
    const rig = makeRig();
    const o = fakeOccluder(0, 4, 2, 6);
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    const off = o.holder.children.every((m) => m.castShadow === false);
    rig.updateOcclusion([new THREE.Vector3(60, 0, 60)]);
    const back = o.holder.children.every((m) => m.castShadow === true);
    return off && back ? true : `castShadow 切換錯誤 off=${off} back=${back}`;
  });

  check("敵人也會讓擋住牠的景物淡出", () => {
    const rig = makeRig();
    const o = fakeOccluder(-18, -8, 2, 6);
    rig.setOccluders([o]);
    // 玩家在別處,只有敵人被擋
    rig.updateOcclusion([new THREE.Vector3(30, 0, 0), new THREE.Vector3(-20, 0, -10)]);
    return eq(isFaded(o), true);
  });

  check("玩家站在樹冠正下方時,樹一樣要淡出", () => {
    const rig = makeRig();
    // 樹心在玩家「更後方」一點,線段最近點就是玩家本人
    const o = fakeOccluder(-0.7, -0.8, 2.2, 6.9);
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    return eq(isFaded(o), true);
  });

  check("只擋住視線末段的矮石頭也要淡出", () => {
    const rig = makeRig();
    // 石頭頂端 2.5：在圓心處視線還有 2.8 高，但靠玩家那側已經降到 2.5 以下
    const o = fakeOccluder(1.2, 2.2, 3.2, 2.5);
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    return eq(isFaded(o), true);
  });

  suite("建築遮蔽(定向包圍盒)");

  // 一棟 10 x 6.6、高 8 的房子,長邊轉了 0.35 弧度——跟遊戲裡的農舍一樣
  const house = (x, z, ry = 0.35) => ({ x, z, ry, hx: 5, hz: 3.3, top: 8, obb: true });

  check("房子擋在相機與玩家之間時淡出", () => {
    // 相機在 +z 側;房子在玩家與相機中間
    return eq(segmentHitsObb(CAM, new THREE.Vector3(0, 0, 0), house(0, 5)), true);
  });

  check("玩家站在門口(房子在玩家身後)不淡出", () => {
    // 圓形測試會誤判:外接圓半徑約 6.5,玩家離房子中心只有 5
    return eq(segmentHitsObb(CAM, new THREE.Vector3(0, 0, 0), house(0, -5)), false);
  });

  check("玩家站在房子側邊不淡出", () => {
    return eq(segmentHitsObb(CAM, new THREE.Vector3(0, 0, 0), house(-7.5, -1)), false);
  });

  check("視線從屋頂上方越過時不淡出", () => {
    // 房子很遠、很矮:視線在那裡還很高
    const low = { x: 0, z: 17, ry: 0, hx: 3, hz: 2, top: 3, obb: true };
    return eq(segmentHitsObb(CAM, new THREE.Vector3(0, 0, 0), low), false);
  });

  check("updateOcclusion 對 OBB 遮蔽體一樣切換材質", () => {
    const rig = makeRig();
    const o = { ...fakeOccluder(0, 5, 0, 8), ...house(0, 5) };
    rig.setOccluders([o]);
    rig.updateOcclusion([new THREE.Vector3(0, 0, 0)]);
    if (!isFaded(o)) return "沒有淡出";
    rig.updateOcclusion([new THREE.Vector3(20, 0, 0)]); // 玩家走到旁邊
    return eq(isFaded(o), false);
  });

  suite("相機遮蔽淡出(續)");

  check("重複呼叫不會累積材質（不會每幀 clone）", () => {
    const rig = makeRig();
    const o = fakeOccluder(0, 4, 2, 6);
    rig.setOccluders([o]);
    const target = new THREE.Vector3(0, 0, 0);
    rig.updateOcclusion([target]);
    const firstGhost = o.holder.children[0].userData.ghostMat;
    for (let i = 0; i < 50; i++) rig.updateOcclusion([target]);
    return eq(o.holder.children[0].userData.ghostMat, firstGhost);
  });

  suite("相機瞄準平面");

  check("瞄準平面貼齊遊戲平面 y=0", () => {
    const rig = makeRig();
    return eq(rig._plane.constant, 0);
  });
}
