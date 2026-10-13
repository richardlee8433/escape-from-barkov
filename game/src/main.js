import { BAL, VERSION } from "./config/balance.js";
import { bus, log } from "./core/EventBus.js";
import { Game } from "./core/Game.js";
import { Assets } from "./core/Assets.js";
import { CameraRig } from "./render/CameraRig.js";
import { Vfx } from "./render/Vfx.js";
import { buildWorld } from "./world/WorldBuilder.js";
import { Player } from "./entities/Player.js";
import { Collision } from "./systems/Collision.js";
import { Combat } from "./systems/Combat.js";
import { Spawner } from "./systems/Spawner.js";
import { Inventory } from "./systems/Inventory.js";
import { ExitSystem } from "./systems/ExitSystem.js";
import { Sfx } from "./audio/Sfx.js";
import { Bgm } from "./audio/Bgm.js";
import { HUD } from "./ui/HUD.js";
import { Screens } from "./ui/Screens.js";

// 組裝一切:載資源 → 建世界 → 接系統 → 開跑。
const screens = new Screens();

screens.onStart(async (onProgress) => {
  const game = new Game(document.getElementById("app"));
  const assets = new Assets();
  await assets.loadAll(onProgress);

  // 世界與碰撞
  const collision = new Collision();
  const world = buildWorld(game.scene, assets, collision);

  // 實體與系統
  const player = new Player(game.scene, assets, world.playerStart, world.startYaw);
  const rig = new CameraRig(game.camera, game.scene);
  rig.setOccluders(world.occluders);
  rig.snapTo(player.pos);
  const combat = new Combat(game.scene, collision, assets);
  const spawner = new Spawner(game.scene, assets, collision);
  spawner.spawnEnemies(BAL.enemy.count, player.pos);
  spawner.scatterItems(player.pos);
  const inventory = new Inventory(player, spawner);
  const exitSystem = new ExitSystem(world.exitPos, player, game.input);

  // 回饋層(純事件訂閱,不改遊戲狀態)
  const vfx = new Vfx(game.scene);
  const hud = new HUD();
  hud.camYaw = rig.yaw;
  new Sfx();
  new Bgm();

  // 事件接線
  bus.on("input:fire", () => {
    if (!game.paused) combat.firePlayer(player, rig.aimPoint);
  });
  bus.on("player:died", () => (game.paused = true));
  bus.on("victory", () => {
    game.paused = true;
    log("撤離成功!", "ok");
  });

  // 邏輯系統(固定 60Hz)
  game.addSystem({ update: (dt) => player.update(dt, game.input, rig, collision) });
  game.addSystem({ update: (dt) => spawner.updateEnemies(dt, player, combat) });
  game.addSystem({ update: (dt) => combat.update(dt, spawner.enemies, player) });
  game.addSystem({ update: () => exitSystem.update() });

  // 畫面系統(每幀)
  game.addSystem({
    frame: (dt, t) => {
      rig.follow(player.pos, dt);
      rig.updateAim(game.input.mouse);
      // 玩家永遠不能被擋住,敵人只在追擊時才需要看得見
      rig.updateOcclusion([
        player.pos,
        ...spawner.enemies.filter((e) => e.brain.state !== "patrol").map((e) => e.pos),
      ]);
      world.followSun(player.pos);
      world.grass.setTime(t);
      spawner.updateItems(t);
      vfx.frame(dt, game.camera, new Set(spawner.enemies));
    },
  });

  window.__debug = { game, player, spawner, world, assets, combat, rig, exitSystem, vfx, hud, collision }; // Console 檢查用

  game.start();
  hud.show();
  player.emitStats();
  inventory.changed();
  bus.emit("game:started");
  log(`Game started ${VERSION}`, "ok");
  log("Head to the EXIT gate on the east side and press F to extract", "info");
});
