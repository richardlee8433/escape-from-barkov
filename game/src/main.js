import { BAL, VERSION } from "./config/balance.js";
import { bus, log } from "./core/EventBus.js";
import { Game } from "./core/Game.js";
import { Assets } from "./core/Assets.js";
import { CameraRig, CAMERA_OFFSET } from "./render/CameraRig.js";
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
import { HomeState } from "./systems/HomeState.js";
import { Home } from "./systems/Home.js";
import { HomeScene } from "./world/HomeScene.js";
import { DisplayPicker } from "./ui/DisplayPicker.js";
import { Bark } from "./systems/Bark.js";
import { BarkFx } from "./render/BarkFx.js";
import { HOME_SCALE, SPAWN, STATIONS } from "./config/home.js";

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
  const inventory = new Inventory(player, backpack, digSpots);
  const barker = new Bark(player, () => (mode === "world" ? spawner.enemies : []));
  const exitSystem = new ExitSystem(world.exitPos, player, game.input);

  // 回饋層(純事件訂閱,不改遊戲狀態)
  const vfx = new Vfx(game.scene);
  const hud = new HUD();
  const digUI = new DigUI(digSpots);
  const digFx = new DigFx(game.scene, assets, world.grass);
  const book = new CollectionUI(collection);
  const bag = new BackpackUI(backpack);
  const groundItems = new GroundItems(game.scene);
  const barkFx = new BarkFx(() => player.root.parent, barker);
  hud.camYaw = rig.yaw;

  // 柯基的家:另一個場景,從地圖的大門回來
  const homeState = new HomeState(backpack);
  const homeView = new HomeScene(assets, homeState);
  const picker = new DisplayPicker(homeState, backpack, () => homeView.refreshDisplays());
  const home = new Home({ state: homeState, view: homeView, player, picker, isPaused: () => game.paused });
  new Sfx();
  new Bgm();

  // 事件接線
  // 挖到的寶物放進背包;被鴨子啄到就掉一件在旁邊的地上(背包空的就只是被推開)
  bus.on("dig:found", ({ treasure, qty = 1 }) => backpack.add(treasure.id, qty));
  // 掉落點一定要走得到:不卡進石頭、柵欄、水裡,也不出地圖邊界(找不到就掉在腳邊)
  const DROP_LIMIT = BAL.world.size / 2 - BAL.world.edgeMargin - 1;
  bus.on("player:pecked", ({ x, z }) => {
    let at = [x, z];
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 1.4 + Math.random() * 0.8;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (Math.abs(px) > DROP_LIMIT || Math.abs(pz) > DROP_LIMIT) continue;
      if (!collision.isFree(px, pz, 0.7)) continue;
      at = [px, pz];
      break;
    }
    backpack.dropRandom(at[0], at[1], x, z);
  });
  bus.on("input:sniff", () => {
    if (!game.paused && mode === "world") digSpots.sniff(player);
  });
  bus.on("input:bark", () => {
    if (!game.paused) barker.bark();
  });
  bus.on("input:zoom", (steps) => {
    rig.zoomBy(steps);
    if (mode === "home") rig.zoomTarget = Math.min(rig.zoomTarget, HOME_ZOOM_MAX);
  });
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

  // ---- 地圖 ↔ 家:畫面淡出、換場景、淡入
  let mode = "world";
  let worldZoom = 1;
  const HOME_ZOOM = 0.56, HOME_ZOOM_MAX = 0.85;
  const fadeEl = document.getElementById("fade");
  const homeCount = document.getElementById("home-count");
  const refreshHomeStat = () => { homeCount.textContent = `${homeState.repaired.size}/${STATIONS.length}`; };
  refreshHomeStat();
  bus.on("home:repaired", refreshHomeStat);
  // 家裡的鏡頭看著柯基與房間中央之間,整間屋子都在畫面裡
  const homeFocus = () => player.pos.clone().multiplyScalar(0.5);

  let switching = false;
  const switchTo = (next) => {
    if (switching || next === mode) return;
    switching = true;
    game.paused = true;
    fadeEl.classList.add("on");
    setTimeout(() => {
      if (next === "home") enterHome();
      else leaveHome();
      fadeEl.classList.remove("on");
      game.paused = false;
      switching = false;
    }, 380);
  };

  function enterHome() {
    mode = "home";
    digSpots.cancel("home");
    player.dig = null;
    player.sniff = null;
    player.proud = 0;
    homeView.scene.add(player.root);
    player.pos.set(SPAWN.x * HOME_SCALE, 0, SPAWN.z * HOME_SCALE);
    player.root.rotation.y = SPAWN.yaw;
    game.postfx.setScene(homeView.scene);
    worldZoom = rig.zoomTarget;
    rig.zoom = rig.zoomTarget = HOME_ZOOM;
    rig.offset.copy(CAMERA_OFFSET).multiplyScalar(HOME_ZOOM);
    rig.snapTo(homeFocus());
    inventory.enabled = false;
    bus.emit("tip:hide");
    home.enter();
    log(homeState.repaired.size ? "Home sweet home 🏡" : "Home… or what's left of it. Let's fix it up with what you dig! 🔨", "info");
  }

  function leaveHome() {
    home.leave();
    mode = "world";
    game.scene.add(player.root);
    player.pos.copy(world.returnPos);
    player.root.rotation.y = world.returnYaw;
    collision.turn(player.pos, player.body());
    game.postfx.setScene(game.scene);
    rig.zoom = rig.zoomTarget = worldZoom;
    rig.offset.copy(CAMERA_OFFSET).multiplyScalar(worldZoom);
    rig.snapTo(player.pos);
    inventory.enabled = true;
    exitSystem.reset();
  }
  bus.on("exit:home", () => switchTo("home"));
  bus.on("home:leave", () => switchTo("world"));

  // 邏輯系統(固定 60Hz)
  game.addSystem({ update: (dt) => player.update(dt, game.input, rig, mode === "home" ? homeView.collision : collision) });
  game.addSystem({ update: (dt) => barker.update(dt) });
  game.addSystem({
    update: (dt) => {
      if (mode === "home") {
        home.update(dt);
        return;
      }
      spawner.updateEnemies(dt, player, combat);
      combat.update(dt);
      exitSystem.update();
      digSpots.update(player, dt);
      inventory.update(dt);
    },
  });

  // 畫面系統(每幀)
  game.addSystem({
    frame: (dt, t) => {
      digUI.frame();
      barkFx.frame(dt);
      if (mode === "home") {
        rig.follow(homeFocus(), dt);
        homeView.frame(dt, t);
        return;
      }
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
      digFx.frame(dt);
      vfx.frame(dt, game.camera, new Set(spawner.enemies));
    },
  });

  window.__debug = { game, player, spawner, world, assets, combat, rig, exitSystem, vfx, hud, collision, digSpots, collection, book, digFx, digUI, backpack, bag, groundItems, barker,
    homeState, homeView, home, picker, switchTo, get mode() { return mode; } }; // Console 檢查用

  // 先開始畫(信後面就是遊戲畫面),讀完媽媽的信、按下「Let's go」才開始動
  game.paused = true;
  game.start();
  bus.on("story:closed", () => {
    game.paused = false;
    hud.show();
    bus.emit("game:started");
    log(`Game started ${VERSION}`, "ok");
    log("Your cottage is through the HOME gate on the east side — press F there to go home 🏡", "info");
    log("Treasure is buried out of sight — press Q to sniff it out :nose:", "info");
    log("Everything you dig up goes into your backpack 🎒 (press B)", "info");
    log("Ducks bothering you? Press R to bark 🗯️", "info");
  });
});
