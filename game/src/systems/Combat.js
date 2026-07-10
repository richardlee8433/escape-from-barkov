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
    this.tmplPlayer = buildBulletTemplate(assets);
    this.tmplEnemy = buildBulletTemplate(assets, 0xff4433);
  }

  // 難度隨時間與擊殺數上升（封頂）
  difficulty() {
    const d = BAL.difficulty;
    return Math.min((1 + this.time / d.timeToDouble) * (1 + this.kills * d.perKill), d.cap);
  }

  firePlayer(player, aimPoint) {
    if (!player.alive || !aimPoint) return;
    if (player.ammo <= 0) {
      log("Out of ammo!", "danger");
      return;
    }
    player.ammo--;
    player.emitStats();
    const from = player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    const dir = aimPoint.clone().sub(player.pos).setY(0);
    if (dir.lengthSq() < 1e-4) return;
    this.bullets.push(new Bullet(this.scene, this.tmplPlayer, from, dir, B.playerSpeed, "player"));
    bus.emit("shot");
  }

  fireEnemy(from, dir) {
    if (dir.lengthSq() < 1e-4) return;
    this.bullets.push(new Bullet(this.scene, this.tmplEnemy, from, dir, B.enemySpeed, "enemy"));
  }

  update(dt, enemies, player) {
    this.time += dt;

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const step = b.speed * dt;
      b.mesh.position.addScaledVector(b.dir, step);
      b.traveled += step;
      const bx = b.mesh.position.x;
      const bz = b.mesh.position.z;

      let dead = b.traveled > B.maxDist || this.collision.hitStatic(bx, bz, B.radius);

      if (!dead && b.owner === "player") {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const en = enemies[j];
          const dx = bx - en.pos.x;
          const dz = bz - en.pos.z;
          if (Math.hypot(dx, dz) < en.hitR + B.radius) {
            en.hp -= B.damage;
            if (en.hp > 0) {
              en.knockback(b.mesh.position, this.collision);
              bus.emit("enemy:hurt");
            } else {
              en.dispose(this.scene);
              enemies.splice(j, 1);
              this.kills++;
              player.addLoot();
              bus.emit("enemy:died", { x: en.pos.x, z: en.pos.z });
              log("Enemy down, Loot +1", "ok");
            }
            dead = true;
            break;
          }
        }
      } else if (!dead && b.owner === "enemy" && player.alive) {
        const dx = bx - player.pos.x;
        const dz = bz - player.pos.z;
        if (Math.hypot(dx, dz) < player.radius + B.radius * 0.5 + 0.3) {
          player.takeDamage(B.damage);
          dead = true;
        }
      }

      if (dead) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }
}
