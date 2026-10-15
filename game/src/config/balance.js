// 所有遊戲平衡數值集中在這裡。
// 世界尺度：170x170，角色高約 2（舊版是 1000x1000 / 角色高 30，數值已按比例重調）。
export const VERSION = "v0.8.0";

export const BAL = {
  // gameplayY：唯一的遊戲平面。所有移動、生成、掉落、出口都貼在這個高度，
  // 橋、岩石等視覺高度一律不得改變它。
  world: { size: 170, gameplayY: 0, edgeMargin: 7 },

  player: {
    maxHp: 100,
    startAmmo: 30,
    speed: 9,          // 跑步速度（單位/秒）
    walkSpeed: 3.6,    // 按住 Shift 走路
    digTime: 1.4,      // 挖一個土堆要多久
    proudTime: 1.6,    // 挖到寶之後看鏡頭撒嬌多久(一移動就中斷)
    fireCd: 0.18,      // 射速上限（秒/發）——沒有它連點滑鼠就能無限傾瀉
    radius: 0.5,       // 碰撞圓半徑(子彈命中、敵人推擠用)
    // 移動碰撞的身體:柯基長約 1.8、寬約 0.76,用沿面向排開的三個圓貼合輪廓,
    // 鼻子和尾巴不會插進石頭或探出溝壑邊緣
    body: { r: 0.4, half: 0.48 },
    height: 1.6,       // 柯基模型目標高度
  },

  enemy: {
    count: 12,
    hp: 30,
    baseSpeed: 6.2,        // 追擊速度基準(會乘上難度);起初比柯基慢,越拖越追得上
    height: 2.0,           // 鴨子模型目標高度
    detectDist: 20,        // 可以「看到」玩家的最大距離
    fovDeg: 70,            // 視野角（左右各 35°）
    loseSightTime: 2.0,    // 追擊中失去視線多久轉為搜尋
    // 鴨子不拿槍:追到身邊才啄。近戰一定發生在畫面上,不會有「螢幕外挨打」。
    attackRange: 1.9,      // 進入啄擊前搖的距離(中心到中心)
    peckReach: 2.3,        // 前搖結束時,柯基還在這個距離內才算啄中
    peckDamage: 14,
    peckKnockback: 0.9,    // 被啄退的距離
    windupTime: 0.35,      // 啄擊前搖(給玩家反應時間的預告)
    aimTolerance: 0.35,    // 面向誤差在此之內才肯出手（弧度,約 20°）
    attackCd: 1.0,         // 基礎攻擊冷卻（會被難度縮短）
    knockback: 1.2,        // 中彈退後距離
    patrolSpeedMul: 0.35,
    searchSpeedMul: 0.7,
    minFromPlayer: 30,     // 生成時離玩家最小距離
    minBetween: 16,        // 敵人彼此生成最小距離
    playerPushDist: 1.3,   // 與玩家的最小間距（推開;要小於 attackRange 才啄得到）
  },

  bullet: {
    playerSpeed: 40,
    enemySpeed: 22,
    maxDist: 45,
    damage: 20,
    radius: 0.22,
  },

  items: {
    pickupRange: 3.5,
    digRange: 2.2,        // 離土堆多近可以挖
    digSpots: 12,         // 地圖上的挖寶土堆數量
    medkitHeal: 40,
    ammoRefill: 15,
    scatter: { medkit: 4, ammo: 6 }, // 開場散佈在地圖上的數量
  },

  // 敵人死亡掉落機率（累進）：彈藥 50% / 醫療包 35% / 不掉 15%
  loot: { ammo: 0.5, medkit: 0.85 },

  // 難度 = min((1 + 時間/timeToDouble) * (1 + 擊殺 * perKill), cap)
  difficulty: { timeToDouble: 240, perKill: 0.05, cap: 2.5 },

  exit: { proximity: 8 },

  hotbarSize: 3,
};

export const ITEM_TYPES = { MEDKIT: "medkit", AMMO: "ammo" };
