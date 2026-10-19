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
import { SettingsUI } from "./ui/SettingsUI.js";
import { TouchControls, initTouchMode } from "./ui/TouchControls.js";
import { t, applyStatic } from "./i18n/i18n.js";
import { HOME_SCALE, SPAWN, STATIONS } from "./config/home.js";
import { YARD_SPAWN } from "./config/yard.js";
import { YardScene } from "./world/YardScene.js";
import { Yard } from "./systems/Yard.js";

// 組裝一切:載資源 → 建世界 → 接系統 → 開跑。
// 介面文字先換成玩家的語言;右上角的設定在標題畫面就能用
initTouchMode();
applyStatic();
new SettingsUI();
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
  // 手機螢幕小,一開始鏡頭拉近一點
  if (document.body.classList.contains("touch")) rig.zoom = rig.zoomTarget = 0.8;
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
  const touch = new TouchControls(game.input, game.renderer.domElement);
  hud.camYaw = rig.yaw;

  // 柯基的家:另一個場景,從地圖的大門回來
  const homeState = new HomeState(backpack);
  const homeView = new HomeScene(assets, homeState);
  const picker = new DisplayPicker(homeState, backpack, () => homeView.refreshDisplays());
  const home = new Home({ state: homeState, view: homeView, player, picker, isPaused: () => game.paused });
  // 小屋外的院子(回家先到這裡,站在門口)
  const yardView = new YardScene(assets, homeState);
  const yard = new Yard({ view: yardView, player, isPaused: () => game.paused });
  // 院子與屋裡的材質先編譯好(載入時做),第一次回家才不會卡一下
  game.renderer.compile(yardView.scene, game.camera);
  game.renderer.compile(homeView.scene, game.camera);
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
    if (mode === "home") rig.zoomTarget = Math.min(rig.zoomTarget, Math.max(HOME_ZOOM_MAX, homeZoom()));
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

  // ---- 村子 ↔ 院子 ↔ 屋裡:畫面淡出、換場景、淡入
  //   村子的 HOME 大門(F)→ 院子,站在小屋門口;門口 E → 屋裡;屋裡的門 E → 回到院子門口;院子大門 E → 村子
  let mode = "world";
  let worldZoom = 1;
  let yardGreeted = false;
  const HOME_ZOOM = 0.56, HOME_ZOOM_MAX = 0.85, YARD_ZOOM = 0.72;
  // 直向的手機畫面窄:鏡頭退後,讓整間屋子(院子)的寬度都在畫面裡(以 16:9 橫向為準)
  const narrowFactor = (cap) => {
    const hNow = Math.atan(Math.tan((game.camera.fov * Math.PI) / 360) * game.camera.aspect);
    const hRef = Math.atan(Math.tan((19 * Math.PI) / 180) * (16 / 9));
    return Math.min(cap, Math.max(1, Math.tan(hRef) / Math.tan(hNow)));
  };
  const homeZoom = () => HOME_ZOOM * narrowFactor(1.95);
  const yardZoom = () => YARD_ZOOM * narrowFactor(1.6);
  addEventListener("resize", () => {
    if (mode === "home") rig.zoomTarget = homeZoom();
    else if (mode === "yard") rig.zoomTarget = yardZoom();
  });
  const fadeEl = document.getElementById("fade");
  const homeCount = document.getElementById("home-count");
  const refreshHomeStat = () => { homeCount.textContent = `${homeState.repaired.size}/${STATIONS.length}`; };
  refreshHomeStat();
  bus.on("home:repaired", refreshHomeStat);
  // 屋裡的鏡頭看著柯基與房間中央之間,整間屋子都在畫面裡
  const homeFocus = () => player.pos.clone().multiplyScalar(0.5);
  const collisionFor = () => (mode === "home" ? homeView.collision : mode === "yard" ? yardView.collision : collision);

  let switching = false;
  const switchTo = (next) => {
    if (switching || next === mode) return;
    switching = true;
    game.paused = true;
    fadeEl.classList.add("on");
    setTimeout(() => {
      goTo(next);
      fadeEl.classList.remove("on");
      game.paused = false;
      switching = false;
    }, 380);
  };

  function placePlayer(scene, x, z, yaw, coll) {
    player.dig = null;
    player.sniff = null;
    player.proud = 0;
    scene.add(player.root);
    player.pos.set(x, 0, z);
    player.root.rotation.y = yaw;
    coll.turn(player.pos, player.body());
  }

  function setView(scene, zoom, focus) {
    game.postfx.setScene(scene);
    rig.zoom = rig.zoomTarget = zoom;
    rig.offset.copy(CAMERA_OFFSET).multiplyScalar(zoom);
    rig.snapTo(focus);
  }

  function goTo(next) {
    const prev = mode;
    if (prev === "world") {
      digSpots.cancel("home");
      worldZoom = rig.zoomTarget;
    } else if (prev === "yard") yard.leave();
    else home.leave();
    mode = next;
    inventory.enabled = next === "world";
    bus.emit("tip:hide");
    bus.emit("exit:near", { near: false }); // 手機的「回家」按鈕收起來
    if (next === "world") {
      placePlayer(game.scene, world.returnPos.x, world.returnPos.z, world.returnYaw, collision);
      setView(game.scene, worldZoom, player.pos);
      exitSystem.reset();
    } else if (next === "yard") {
      // 從村子回來、或從屋裡出來,都站在小屋門口
      placePlayer(yardView.scene, YARD_SPAWN.x, YARD_SPAWN.z, YARD_SPAWN.yaw, yardView.collision);
      setView(yardView.scene, yardZoom(), player.pos);
      yard.enter();
      if (prev === "world" && !yardGreeted) {
        yardGreeted = true;
        log(t("log.yard"), "info");
      }
    } else {
      placePlayer(homeView.scene, SPAWN.x * HOME_SCALE, SPAWN.z * HOME_SCALE, SPAWN.yaw, homeView.collision);
      setView(homeView.scene, homeZoom(), homeFocus());
      home.enter();
      log(t(homeState.repaired.size ? "log.homeSweet" : "log.homeBroken"), "info");
    }
  }
  bus.on("exit:home", () => switchTo("yard"));
  bus.on("yard:enterHouse", () => switchTo("home"));
  bus.on("home:leave", () => switchTo("yard"));
  bus.on("yard:leave", () => switchTo("world"));

  // 邏輯系統(固定 60Hz)
  game.addSystem({ update: (dt) => player.update(dt, game.input, rig, collisionFor()) });
  game.addSystem({ update: (dt) => barker.update(dt) });
  game.addSystem({
    update: (dt) => {
      if (mode === "home") {
        home.update(dt);
        return;
      }
      if (mode === "yard") {
        yard.update();
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
      if (mode === "yard") {
        rig.follow(player.pos, dt);
        yardView.frame(dt, t);
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
    homeState, homeView, home, picker, yardView, yard, switchTo, get mode() { return mode; } }; // Console 檢查用

  // 先開始畫(信後面就是遊戲畫面),讀完媽媽的信、按下「Let's go」才開始動
  game.paused = true;
  game.start();
  bus.on("story:closed", () => {
    game.paused = false;
    hud.show();
    touch.show();
    bus.emit("game:started");
    log(t("log.started", { v: VERSION }), "ok");
    log(t("log.hint.home"), "info");
    log(t("log.hint.sniff"), "info");
    log(t("log.hint.bag"), "info");
    log(t("log.hint.bark"), "info");
  });
});
