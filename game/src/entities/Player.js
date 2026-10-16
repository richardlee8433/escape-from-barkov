import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";
import { addFur } from "../render/Fur.js";
import { Animator } from "../render/Animator.js";
import { CAMERA_OFFSET } from "../render/CameraRig.js";

// 面向鏡頭的角度(驕傲動作用)
const FACE_CAMERA = Math.atan2(CAMERA_OFFSET.x, CAMERA_OFFSET.z);

export class Player {
  constructor(scene, assets, start, yaw) {
    this.alive = true; // 柯基沒有血量,不會倒下(鴨子只會讓它掉東西)
    this.radius = BAL.player.radius;

    this.root = new THREE.Group();
    this.root.position.copy(start);
    this.root.rotation.y = yaw;
    const model = assets.instantiate("corgi", BAL.player.height, { center: true });
    addFur(model);
    this.root.add(model);
    scene.add(this.root);
    this.anim = new Animator(model, assets.clips("corgi"));
    this.anim.play("Idle");
    this.dig = null;  // 挖地中:{ yaw, onCancel };何時挖完由 DigSpots 的小遊戲決定
    this.proud = 0;   // 挖到寶之後看鏡頭撒嬌的剩餘秒數
    this.sniff = null; // 嗅聞中:{ t, onDone }
  }

  get pos() {
    return this.root.position;
  }

  // 目前面向的碰撞身體(見 BAL.player.body)
  body() {
    const yaw = this.root.rotation.y;
    return { ...BAL.player.body, fx: Math.sin(yaw), fz: Math.cos(yaw) };
  }

  // 挖地或撒嬌中:不能開槍
  get busy() {
    return !!this.dig || !!this.sniff || this.proud > 0;
  }

  update(dt, input, rig, collision) {
    if (!this.alive) return;
    const { x, z } = input.axes();
    const moving = !!(x || z);

    // 挖地:原地面向土堆一直挖,直到小遊戲結束(endDig);一移動就中斷
    if (this.dig) {
      if (moving) {
        const cancel = this.dig.onCancel;
        this.dig = null;
        cancel?.();
      } else {
        this._turnToward(this.dig.yaw, 0.2, collision);
        this.anim.play("Dig");
        this.anim.update(dt);
        return;
      }
    }
    // 嗅聞:原地低頭左右聞;聞完才回報結果。一移動就中斷
    if (this.sniff) {
      if (moving) {
        this.sniff = null;
      } else {
        this.sniff.t -= dt;
        this.anim.play("Sniff", 1, 0.15);
        this.anim.update(dt);
        if (this.sniff.t <= 0) {
          const done = this.sniff.onDone;
          this.sniff = null;
          done?.();
        }
        return;
      }
    }
    if (this.proud > 0) {
      if (moving) {
        this.proud = 0; // 一動就中斷,不會在戰鬥中卡住玩家
      } else {
        this.proud -= dt;
        this._turnToward(FACE_CAMERA, 0.15, collision);
        this.anim.play("Proud");
        this.anim.update(dt);
        return;
      }
    }

    // 移動：WASD 相對螢幕方向;按住 Shift 走路;身體朝著前進的方向
    let speed = 0;
    if (moving) {
      const dir = rig.moveDir(x, z);
      this._turnToward(Math.atan2(dir.x, dir.z), 0.22, collision);
      const v = input.isDown("shift") ? BAL.player.walkSpeed : BAL.player.speed;
      const bx = this.pos.x, bz = this.pos.z;
      collision.move(this.pos, dir.x * v * dt, dir.z * v * dt, this.body());
      speed = Math.hypot(this.pos.x - bx, this.pos.z - bz) / dt;
    }

    // 單一遊戲平面：橋是視覺物件,踩上去也不會改變高度
    this.pos.y = BAL.world.gameplayY;

    // 動作跟著實際速度走(撞牆時就算按著方向鍵也會停下來),腳步頻率與速度同步
    if (speed < 0.5) this.anim.play("Idle");
    else if (speed < 6) this.anim.play("Walk", Math.min(1.8, Math.max(0.7, speed / 2.4)));
    else this.anim.play("Run", speed / 5.5);
    this.anim.update(dt);
  }

  // 轉向目標角度。轉身也要過碰撞:頭尾轉進牆裡就把身體推出來,推不出來就先不轉
  _turnToward(target, rate, collision) {
    let diff = target - this.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const prev = this.root.rotation.y;
    this.root.rotation.y += diff * rate;
    if (!collision.turn(this.pos, this.body())) this.root.rotation.y = prev;
  }

  // 開始挖地(朝向 yaw);中途移動會呼叫 onCancel。已經在挖就回傳 false
  startDig(yaw, onCancel) {
    if (!this.alive || this.dig) return false;
    this.proud = 0;
    this.dig = { yaw, onCancel };
    bus.emit("dig:start", { x: this.pos.x, z: this.pos.z });
    return true;
  }

  // 開始嗅聞;聞完呼叫 onDone
  startSniff(onDone) {
    if (!this.alive || this.dig || this.sniff) return false;
    this.proud = 0;
    this.sniff = { t: BAL.player.sniffTime, onDone };
    bus.emit("sniff:start", { x: this.pos.x, z: this.pos.z });
    return true;
  }

  // 挖完(或被打斷);挖到寶就轉向鏡頭撒嬌
  endDig(proud) {
    this.dig = null;
    if (proud && this.alive) this.proud = BAL.player.proudTime;
  }
}
