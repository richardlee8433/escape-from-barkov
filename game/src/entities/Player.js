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

    // 貼地(平地 0,橋上沿拱形墊高)
    this.pos.y = collision.heightAt(this.pos.x, this.pos.z);

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

  takeDamage(v) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - v);
    this.emitStats();
    if (this.hp <= 0) {
      this.alive = false;
      bus.emit("player:died");
    } else {
      bus.emit("player:hurt");
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
  }

  emitStats() {
    bus.emit("player:stats", { hp: this.hp, ammo: this.ammo, loot: this.loot });
  }
}
