import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { bus } from "../core/EventBus.js";

export class Player {
  constructor(scene, assets, start, yaw) {
    this.hp = BAL.player.maxHp;
    this.ammo = BAL.player.startAmmo;
    this.loot = 0;
    this.alive = true;
    this.radius = BAL.player.radius;

    this.root = new THREE.Group();
    this.root.position.copy(start);
    this.root.rotation.y = yaw;
    this.root.add(assets.instantiate("corgi", BAL.player.height, { center: true }));
    scene.add(this.root);

    // Loot 跟著「敵人死亡」這個事件走,而不是由 Combat 直接呼叫進來
    bus.on("enemy:died", () => this.addLoot());
  }

  get pos() {
    return this.root.position;
  }

  update(dt, input, rig, collision) {
    if (!this.alive) return;

    // 移動：WASD 相對螢幕方向（俯視角雙搖桿式）
    const { x, z } = input.axes();
    if (x || z) {
      const dir = rig.moveDir(x, z);
      const next = this.pos.clone().addScaledVector(dir, BAL.player.speed * dt);
      collision.resolveCircle(next, this.radius);
      this.pos.copy(next);
    }

    // 單一遊戲平面：橋是視覺物件,踩上去也不會改變高度
    this.pos.y = BAL.world.gameplayY;

    // 面向準心
    if (rig.aimPoint) {
      const dx = rig.aimPoint.x - this.pos.x;
      const dz = rig.aimPoint.z - this.pos.z;
      const target = Math.atan2(dx, dz);
      let diff = target - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * 0.25;
    }
  }

  // fromX/fromZ：傷害來向（指回射擊者），給方向指示器用
  takeDamage(v, fromX = 0, fromZ = 0) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - v);
    this.emitStats();
    if (this.hp <= 0) {
      this.alive = false;
      bus.emit("player:died", { x: this.pos.x, z: this.pos.z });
    } else {
      bus.emit("player:hurt", { amount: v, fromX, fromZ, hp: this.hp });
    }
  }

  heal(v) {
    this.hp = Math.min(BAL.player.maxHp, this.hp + v);
    this.emitStats();
    bus.emit("player:healed");
  }

  addAmmo(n) {
    this.ammo += n;
    this.emitStats();
  }

  addLoot() {
    this.loot += 1;
    this.emitStats();
    bus.emit("loot:gained", { total: this.loot });
  }

  emitStats() {
    bus.emit("player:stats", { hp: this.hp, ammo: this.ammo, loot: this.loot });
  }
}
