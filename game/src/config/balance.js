// 所有遊戲平衡數值集中在這裡。
// 世界尺度：170x170，角色高約 2（舊版是 1000x1000 / 角色高 30，數值已按比例重調）。
export const VERSION = "v0.4.0";

export const BAL = {
  world: { size: 170 },

  player: {
    maxHp: 100,
    startAmmo: 30,
    speed: 9,          // 移動速度（單位/秒）
    radius: 0.5,       // 碰撞圓半徑
    height: 1.6,       // 柯基模型目標高度
  },

  enemy: {
    count: 12,
    hp: 30,
    baseSpeed: 5,
    height: 2.0,           // 鴨子模型目標高度
    detectDist: 22,        // 可以「看到」玩家的最大距離
    fovDeg: 70,            // 視野角（左右各 35°）
    loseSightTime: 2.0,    // 追擊中失去視線多久轉為搜尋
    fireRange: 14,         // 開火距離
    desiredDist: 3.5,      // 追擊時與玩家保持的距離
    fireCd: 1.4,           // 基礎射擊冷卻（會被難度縮短）
    knockback: 1.2,        // 中彈退後距離
    patrolSpeedMul: 0.4,
    searchSpeedMul: 0.7,
    minFromPlayer: 30,     // 生成時離玩家最小距離
    minBetween: 16,        // 敵人彼此生成最小距離
    playerPushDist: 2.4,   // 與玩家的最小間距（推開）
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
