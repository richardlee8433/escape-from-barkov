import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { bus, log } from "../core/EventBus.js";

// 子彈與傷害。敵人陣列由 Spawner 擁有,這裡處理命中後的移除與事件。
const B = BAL.bullet;
const FORWARD = new THREE.Vector3(0, 0, 1);

// 泡棉飛鏢子彈模板:置中、鏢頭轉向 +z,發射時整支對準飛行方向
function buildBulletTemplate(assets, tint) {
  const size = assets.lib.get("bullet").size;
  const dart = assets.instantiate("bullet", 0.8, { dim: "max", center: true });
  const box = new THREE.Box3().setFromObject(dart);
  dart.position.y -= (box.min.y + box.max.y) / 2; // 垂直也置中
  // 把模型長軸轉到 +z
  if (size.x >= size.y && size.x >= size.z) dart.rotation.y = -Math.PI / 2;
  else if (size.y >= size.x && size.y >= size.z) dart.rotation.x = Math.PI / 2;
  if (tint) {
    dart.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color.lerp(new THREE.Color(tint), 0.55);
      }
    });
  }
  const holder = new THREE.Group();
  holder.add(dart);
  return holder;
}

class Bullet {
  constructor(scene, tmpl, from, dir, speed, owner) {
    this.dir = dir.clone().setY(0).normalize();
    this.speed = speed;
    this.owner = owner;
    this.traveled = 0;
    this.spent = false; // 一顆子彈只能結算一次命中
    this.mesh = tmpl.clone(true);
    this.mesh.position.copy(from);
    this.mesh.quaternion.setFromUnitVectors(FORWARD, this.dir);
    scene.add(this.mesh);
  }
}

export class Combat {
  constructor(scene, collision, assets) {
    this.scene = scene;
    this.collision = collision;
    this.bullets = [];
    this.kills = 0;
    this.time = 0;
    this.playerCd = 0;
    this.tmplPlayer = buildBulletTemplate(assets);
    this.tmplEnemy = buildBulletTemplate(assets, 0xff4433);
  }

  // 難度隨時間與擊殺數上升（封頂）
  difficulty() {
    const d = BAL.difficulty;
    return Math.min((1 + this.time / d.timeToDouble) * (1 + this.kills * d.perKill), d.cap);
  }

  firePlayer(player, aimPoint) {
    if (!player.alive || !aimPoint || player.busy) return; // 挖地、撒嬌時不開槍
    if (this.playerCd > 0) return; // 射速上限,連點滑鼠不能無限傾瀉
    if (player.ammo <= 0) {
      log("Out of ammo!", "danger");
      return;
    }
    const dir = aimPoint.clone().sub(player.pos).setY(0);
    if (dir.lengthSq() < 1e-4) return;
    player.ammo--;
    player.emitStats();
    this.playerCd = BAL.player.fireCd;
    const from = player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    this._spawnBullet(this.tmplPlayer, from, dir, B.playerSpeed, "player");
    bus.emit("shot");
  }

  fireEnemy(from, dir) {
    if (dir.lengthSq() < 1e-4) return;
    this._spawnBullet(this.tmplEnemy, from, dir, B.enemySpeed, "enemy");
  }

  // 鴨子的啄擊:前搖結束、確定還在範圍內才會呼叫(見 EnemyBrain)。
  // 與子彈命中走同一套事件(combat:hit / player:hurt),受擊回饋與方向指示照常運作。
  peck(enemy, player) {
    if (!player.alive) return;
    const dx = player.pos.x - enemy.pos.x;
    const dz = player.pos.z - enemy.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    const amount = BAL.enemy.peckDamage;
    // 傷害來向:指回出手的鴨子
    const fromX = -dx / L, fromZ = -dz / L;
    bus.emit("combat:hit", { targetType: "player", x: player.pos.x, z: player.pos.z, fromX, fromZ, amount,
      lethal: player.hp <= amount });
    bus.emit("enemy:peck", { enemy, x: player.pos.x, z: player.pos.z });
    player.takeDamage(amount, fromX, fromZ);
    // 被啄退一步(走一般移動流程,不會被推進石頭或溪裡)
    const k = BAL.enemy.peckKnockback;
    this.collision.move(player.pos, (dx / L) * k, (dz / L) * k, player.body ? player.body() : player.radius);
  }

  // 所有子彈都從這裡誕生,發射事件只有這一個來源
  _spawnBullet(tmpl, from, dir, speed, owner) {
    const b = new Bullet(this.scene, tmpl, from, dir, speed, owner);
    this.bullets.push(b);
    bus.emit("bullet:fired", { owner, x: from.x, z: from.z, dirX: b.dir.x, dirZ: b.dir.z });
    return b;
  }

  // 命中的唯一結算點。傷害、死亡、掉落、事件全部由這裡發出,
  // 視覺與音效只訂閱事件,不自己判定命中,也不自己扣血。
  _resolveHit(bullet, target, player, enemies) {
    if (bullet.spent) return;
    bullet.spent = true;

    const x = bullet.mesh.position.x;
    const z = bullet.mesh.position.z;
    // 傷害來向：子彈飛行方向的反向,指回射擊者
    const fromX = -bullet.dir.x;
    const fromZ = -bullet.dir.z;
    const amount = B.damage;

    if (bullet.owner === "player") {
      target.hp -= amount;
      const lethal = target.hp <= 0;
      bus.emit("combat:hit", { targetType: "enemy", x, z, fromX, fromZ, amount, lethal });
      if (lethal) {
        const ex = target.pos.x, ez = target.pos.z;
        target.dispose(this.scene);
        const i = enemies.indexOf(target);
        if (i >= 0) enemies.splice(i, 1);
        this.kills++;
        bus.emit("enemy:died", { enemy: target, x: ex, z: ez });
      } else {
        target.knockback(bullet.mesh.position, this.collision);
        bus.emit("enemy:hurt", { enemy: target, x, z, fromX, fromZ, amount });
      }
    } else {
      bus.emit("combat:hit", { targetType: "player", x, z, fromX, fromZ, amount, lethal: player.hp <= amount });
      player.takeDamage(amount, fromX, fromZ);
    }
  }

  update(dt, enemies, player) {
    this.time += dt;
    this.playerCd -= dt;

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const step = b.speed * dt;
      b.mesh.position.addScaledVector(b.dir, step);
      b.traveled += step;
      const bx = b.mesh.position.x;
      const bz = b.mesh.position.z;

      if (b.traveled > B.maxDist || this.collision.hitStatic(bx, bz, B.radius)) {
        b.spent = true;
      } else if (b.owner === "player") {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const en = enemies[j];
          const dx = bx - en.pos.x;
          const dz = bz - en.pos.z;
          if (dx * dx + dz * dz < (en.hitR + B.radius) ** 2) {
            this._resolveHit(b, en, player, enemies);
            break;
          }
        }
      } else if (player.alive) {
        const dx = bx - player.pos.x;
        const dz = bz - player.pos.z;
        const reach = player.radius + B.radius * 0.5 + 0.3;
        if (dx * dx + dz * dz < reach * reach) this._resolveHit(b, null, player, enemies);
      }

      if (b.spent) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }
}
