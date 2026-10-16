// 柯基的家:一間破破爛爛的鄉村小屋。用挖到的東西一樣一樣修好,再把寶物擺出來。
//
// 座標是「房間單位」(與 Blender 的 home.py 相同,x 不變、z = -Blender y),遊戲端整間放大 HOME_SCALE 倍。
// 後牆在 z = -3.5(有窗)、左牆在 x = -4.5(壁爐);鏡頭這一側的前牆與右牆只到膝蓋高,右牆開門。
//
// 每一個「站點」是房間裡可以互動的地方:沒修好之前按 E 修理(要背包裡的材料),
// 修好之後如果有展示位(slots),按 E 打開擺設面板。新增站點只要在 STATIONS 加一行;
// id 一旦發佈就不要改(存檔用它記錄)。

export const HOME_SCALE = 1.4;
export const ROOM = { x0: -4.5, x1: 4.5, z0: -3.5, z1: 3.5, h: 3.2 };
export const DOOR = { x: 4.5, z0: 0.5, z1: 1.7 };
// 進門的位置:門口內側,面向屋內(-x)
export const SPAWN = { x: 3.4, z: 1.1, yaw: -Math.PI / 2 };
// 屋頂破洞(陽光從這裡照進來,地上散著掉下來的稻草)
export const ROOF_HOLES = [[0.6, -1.4], [-1.2, 2.0], [3.0, 1.2]];
// 地板破洞(修好之前走不過去)
export const FLOOR_HOLES = [[1.9, 1.6, 0.65], [-1.9, -1.2, 0.6]];
export const FIRE = { x: -4.15, z: -1.0 };

// at:站點位置(可以有好幾個,鼻子靠近任一個都算);reach:鼻子離站點多近才能互動
// broken / fixed:修好前後要顯示的模型(null = 沒有)
export const STATIONS = [
  {
    id: "floor", name: "Floorboards", verb: "Patch the floor",
    broken: "home_floor_broken", fixed: "home_floor",
    at: [[1.9, 1.6], [-1.9, -1.2]], reach: 1.35, needs: { plank: 2, nail: 1 },
  },
  {
    id: "roof", name: "Roof", verb: "Mend the roof",
    broken: "home_debris", fixed: null,
    at: ROOF_HOLES, reach: 1.05, needs: { straw: 3 },
  },
  {
    id: "fireplace", name: "Fireplace", verb: "Rebuild the fireplace",
    broken: "home_fireplace_broken", fixed: "home_fireplace",
    at: [[-3.55, -1.0]], reach: 1.3, needs: { pebble: 3 }, decorate: "Decorate the mantel",
  },
  {
    id: "window", name: "Window", verb: "Fix the window",
    broken: "home_window_broken", fixed: "home_window",
    at: [[-1.5, -3.2]], reach: 1.3, needs: { plank: 1, marble: 1 }, decorate: "Decorate the window sill",
  },
  {
    id: "shelf", name: "Shelf", verb: "Put the shelf back up",
    broken: "home_shelf_broken", fixed: "home_shelf",
    at: [[2.0, -3.0]], reach: 1.3, needs: { plank: 1, nail: 1 }, decorate: "Decorate the shelf",
  },
  {
    id: "table", name: "Table", verb: "Fix the table",
    broken: "home_table_broken", fixed: "home_table",
    at: [[1.2, -0.25]], reach: 1.35, needs: { plank: 1, nail: 1 }, decorate: "Decorate the table",
  },
  {
    id: "bed", name: "Dog Bed", verb: "Make a cosy bed",
    broken: null, fixed: "home_bed",
    at: [[-2.6, 1.9]], reach: 1.1, needs: { straw: 1, bone: 2 },
  },
  {
    id: "rug", name: "Rug", verb: "Weave a rug",
    broken: null, fixed: "home_rug",
    at: [[-0.4, 0.6]], reach: 1.1, needs: { straw: 2, button: 1 },
  },
];

export const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

// 展示位:寶物擺在哪裡(房間單位,y 是放東西的那個面的高度)
export const SLOTS = [
  { id: "shelf1", station: "shelf", pos: [1.4, 1.625, -3.33] },
  { id: "shelf2", station: "shelf", pos: [2.0, 1.625, -3.33] },
  { id: "shelf3", station: "shelf", pos: [2.6, 1.625, -3.33] },
  { id: "mantel1", station: "fireplace", pos: [-3.83, 1.54, -0.4] },
  { id: "mantel2", station: "fireplace", pos: [-3.83, 1.54, -1.6] },
  { id: "sill1", station: "window", pos: [-1.85, 0.99, -3.36] },
  { id: "sill2", station: "window", pos: [-1.15, 0.99, -3.36] },
  { id: "table1", station: "table", pos: [0.85, 0.815, -0.3] },
  { id: "table2", station: "table", pos: [1.55, 0.815, -0.3] },
];

export const slotsOf = (stationId) => SLOTS.filter((s) => s.station === stationId);
