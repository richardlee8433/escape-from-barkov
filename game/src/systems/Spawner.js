import { BAL, ITEM_TYPES } from "../config/balance.js";
import { bus, log } from "../core/EventBus.js";
import { Enemy } from "../entities/Enemy.js";
import { ItemDrop } from "../entities/ItemDrop.js";

// 敵人與道具的生成規則。敵人陣列、道具陣列都由這裡擁有。
const E = BAL.enemy;
const HALF = BAL.world.size / 2;

export class Spawner {
  constructor(scene, assets, collision) {
    this.scene = scene;
    this.assets = assets;
    this.collision = collision;
    this.enemies = [];
    this.items = [];

    // 敵人死亡 → 機率掉落
    bus.on("enemy:died", ({ x, z }) => {
      const type = this.pickDropType();
      if (!type) return;
      this.items.push(new ItemDrop(this.scene, this.assets, type, x, z));
      log(`Drop: ${type}`, "info");
    });
  }

  pickDropType() {
    const r = Math.random();
    if (r < BAL.loot.ammo) return ITEM_TYPES.AMMO;
    if (r < BAL.loot.medkit) return ITEM_TYPES.MEDKIT;
    return null;
  }

  spawnEnemies(n, playerPos) {
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 60 && !ok; tries++) {
        x = (Math.random() - 0.5) * (BAL.world.size - 24);
        z = (Math.random() - 0.5) * (BAL.world.size - 24);
        if (Math.hypot(x - playerPos.x, z - playerPos.z) < E.minFromPlayer) continue;
        if (this.enemies.some((e) => Math.hypot(x - e.pos.x, z - e.pos.z) < E.minBetween)) continue;
        if (!this.collision.isFree(x, z, 1.2)) continue;
        ok = true;
      }
      this.enemies.push(new Enemy(this.scene, this.assets, this.collision, x, z));
    }
    log(`Enemies spawned x${n} (spread across the map)`, "warn");
  }

  scatterItems(playerPos) {
    const s = BAL.items.scatter;
    const plan = [
      [ITEM_TYPES.MEDKIT, s.medkit],
      [ITEM_TYPES.AMMO, s.ammo],
    ];
    for (const [type, count] of plan) {
      for (let i = 0; i < count; i++) {
        let x = 0, z = 0;
        for (let tries = 0; tries < 40; tries++) {
          x = (Math.random() - 0.5) * (BAL.world.size - 30);
          z = (Math.random() - 0.5) * (BAL.world.size - 30);
          if (Math.hypot(x - playerPos.x, z - playerPos.z) < 16) continue; // 出生點附近不放
          if (this.collision.isFree(x, z, 0.6)) break;
        }
        this.items.push(new ItemDrop(this.scene, this.assets, type, x, z));
      }
    }
  }

  // 敵人整體更新（AI + 彼此/玩家推開)
  updateEnemies(dt, player, combat) {
    if (!player.alive) return;
    const diff = combat.difficulty();
    for (const en of this.enemies) {
      en.update(dt, player.pos, diff, this.collision, combat);
    }
    // 推擠前記下合法位置:推擠完解不開(被擠進石縫)就退回原位
    const safe = this.enemies.map((e) => [e.pos.x, e.pos.z]);
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        this.collision.separatePair(this.enemies[i], this.enemies[j]);
      }
      this.collision.pushAway(player.pos, this.enemies[i], E.playerPushDist);
    }
    this.enemies.forEach((en, i) => {
      if (!this.collision.resolveCircle(en.pos, en.hitR * 0.8)) {
        en.pos.x = safe[i][0];
        en.pos.z = safe[i][1];
      }
      en.pos.y = BAL.world.gameplayY;
    });
  }

  nearestItem(pos, range) {
    let best = null, bestD2 = range * range;
    for (const it of this.items) {
      const dx = pos.x - it.pos.x;
      const dz = pos.z - it.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = it; }
    }
    return best;
  }

  removeItem(item) {
    item.dispose(this.scene);
    this.items = this.items.filter((it) => it !== item);
  }

  updateItems(t) {
    for (const it of this.items) it.bob(t);
  }
}
