import { HOME_SCALE as S, ROOM, DOOR } from "./home.js";

// 柯基家的院子(屋外場景)。座標是公尺(遊戲世界單位)。
//
// 院子用柵欄圍起來,面積是小屋佔地的 4 倍:小屋放在左後方,門朝右邊的大片草地,
// 右邊和前面空出來的草地留給之後的裝飾與花園。前面的柵欄有一道門,出去就回到村子挖寶。
const T = 0.25; // 牆厚(房間單位)

// 小屋外緣(房間單位 → 公尺)
export const HOUSE_HALF = { x: (ROOM.x1 - ROOM.x0 + 2 * T) / 2 * S, z: (ROOM.z1 - ROOM.z0 + 2 * T) / 2 * S };
// 院子:柵欄內 26.6 × 21 公尺 = 小屋佔地的 4 倍
export const YARD = { x0: -HOUSE_HALF.x * 2, x1: HOUSE_HALF.x * 2, z0: -HOUSE_HALF.z * 2, z1: HOUSE_HALF.z * 2 };
// 小屋中心:左後方,離柵欄留 1.2 公尺
export const HOUSE = { x: YARD.x0 + 1.2 + HOUSE_HALF.x, z: YARD.z0 + 1.2 + HOUSE_HALF.z };
// 門口(屋外):門開在小屋右牆;柯基回家時站在門口、面向院子
const doorZ = HOUSE.z + ((DOOR.z0 + DOOR.z1) / 2) * S;
export const FRONT_DOOR = { x: HOUSE.x + HOUSE_HALF.x, z: doorZ };
export const YARD_SPAWN = { x: FRONT_DOOR.x + 1.6, z: doorZ, yaw: Math.PI / 2 };
// 院子大門:前面(靠鏡頭)的柵欄,寬 3.8
export const YARD_GATE = { x: 6, z: YARD.z1, half: 1.9 };
// 留給花園的空地(之後的裝飾、種花都在這裡):小屋右邊與前面
export const GARDEN = [
  { x0: FRONT_DOOR.x + 2.5, x1: YARD.x1 - 1, z0: YARD.z0 + 1, z1: YARD.z1 - 1 },
  { x0: YARD.x0 + 1, x1: FRONT_DOOR.x - 0.5, z0: HOUSE.z + HOUSE_HALF.z + 1.5, z1: YARD.z1 - 1 },
];
