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
import { DigSpots } from "./systems/DigSpots.js";
import { Collection } from "./systems/Collection.js";
import { Backpack } from "./systems/Backpack.js";
import { ExitSystem } from "./systems/ExitSystem.js";
import { Sfx } from "./audio/Sfx.js";
import { Bgm } from "./audio/Bgm.js";
import { HUD } from "./ui/HUD.js";
import { Screens } from "./ui/Screens.js";
import { DigUI } from "./ui/DigUI.js";
import { DigFx } from "./render/DigFx.js";
import { CollectionUI } from "./ui/CollectionUI.js";
import { BackpackUI } from "./ui/BackpackUI.js";
import { GroundItems } from "./render/GroundItems.js";

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
  const combat = new Combat(collision);
  const spawner = new Spawner(game.scene, assets, collision);
  spawner.spawnEnemies(BAL.enemy.count, player.pos);
  const collection = new Collection();
  const backpack = new Backpack();
  const digSpots = new DigSpots(world.canDig, collision, player.pos, collection);
  new Inventory(player, backpack, digSpots);
  const exitSystem = new ExitSystem(world.exitPos, player, game.input);

  // 回饋層(純事件訂閱,不改遊戲狀態)
  const vfx = new Vfx(game.scene);
  const hud = new HUD();
  const digUI = new DigUI(digSpots);
  const digFx = new DigFx(game.scene, assets, world.grass);
  const book = new CollectionUI(collection);
  const bag = new BackpackUI(backpack);
  const groundItems = new GroundItems(game.scene);
  hud.camYaw = rig.yaw;
  new Sfx();
  new Bgm();

  // 事件接線
  // 挖到的寶物放進背包;被鴨子啄到就掉一件在旁邊的地上(背包空的就只是被推開)
  bus.on("dig:found", ({ treasure }) => backpack.add(treasure.id));
  bus.on("player:pecked", ({ x, z, fromX, fromZ }) => {
    const a = Math.random() * Math.PI * 2;
    const d = 1.4 + Math.random() * 0.8;
    let dx = Math.cos(a) * d, dz = Math.sin(a) * d;
    // 掉在柯基身邊、不卡進石頭(找不到空地就掉在腳邊)
    if (!collision.isFree(x + dx, z + dz, 0.4)) { dx = -fromX * 1.2; dz = -fromZ * 1.2; }
    backpack.dropRandom(x + dx, z + dz, x, z);
  });
  bus.on("input:sniff", () => {
    if (!game.paused) digSpots.sniff(player);
  });
  bus.on("input:zoom", (steps) => rig.zoomBy(steps));
  // 翻圖鑑或背包時遊戲暫停(挖到一半就先中斷,洞留著)。兩個面板互斥,用計數避免切換時誤解除暫停
  let openPanels = 0, pausedBefore = false;
  bus.on("panel:open", () => {
    if (openPanels++ > 0) return;
    digSpots.cancel("panel");
    pausedBefore = game.paused;
    game.paused = true;
  });
  bus.on("panel:close", () => {
    if (--openPanels === 0) game.paused = pausedBefore;
  });
  bus.on("victory", () => {
    game.paused = true;
    log("撤離成功!", "ok");
  });

  // 邏輯系統(固定 60Hz)
  game.addSystem({ update: (dt) => player.update(dt, game.input, rig, collision) });
  game.addSystem({ update: (dt) => spawner.updateEnemies(dt, player, combat) });
  game.addSystem({ update: (dt) => combat.update(dt) });
  game.addSystem({ update: () => exitSystem.update() });
  game.addSystem({ update: (dt) => digSpots.update(player, dt) });

  // 畫面系統(每幀)
  game.addSystem({
    frame: (dt, t) => {
      rig.follow(player.pos, dt);
      // 玩家永遠不能被擋住,敵人只在追擊時才需要看得見
      rig.updateOcclusion([
        player.pos,
        ...spawner.enemies.filter((e) => e.brain.state !== "patrol").map((e) => e.pos),
      ]);
      world.followSun(player.pos);
      world.grass.setTime(t);
      world.updateWater(t);
      groundItems.frame(dt, t);
      digUI.frame();
      digFx.frame(dt);
      vfx.frame(dt, game.camera, new Set(spawner.enemies));
    },
  });

  window.__debug = { game, player, spawner, world, assets, combat, rig, exitSystem, vfx, hud, collision, digSpots, collection, book, digFx, digUI, backpack, bag, groundItems }; // Console 檢查用

  game.start();
  hud.show();
  bus.emit("game:started");
  log(`Game started ${VERSION}`, "ok");
  log("Head to the EXIT gate on the east side and press F to extract", "info");
  log("Treasure is buried out of sight — press Q to sniff it out :nose:", "info");
  log("Everything you dig up goes into your backpack 🎒 (press B)", "info");
});
