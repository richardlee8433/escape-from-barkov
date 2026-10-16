import { BAL } from "../config/balance.js";
import { log } from "../core/EventBus.js";
import { Enemy } from "../entities/Enemy.js";
import { t } from "../i18n/i18n.js";

// 鴨子的生成與整體更新。鴨子陣列由這裡擁有。
const E = BAL.enemy;

export class Spawner {
  constructor(scene, assets, collision) {
    this.scene = scene;
    this.assets = assets;
    this.collision = collision;
    this.enemies = [];
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
    log(t("log.spawned", { n }), "info");
  }

  // 敵人整體更新（AI + 彼此/玩家推開)
  updateEnemies(dt, player, combat) {
    const diff = combat.difficulty();
    for (const en of this.enemies) {
      en.update(dt, player, diff, this.collision, combat);
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
}
