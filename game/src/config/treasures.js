// 挖得到的寶物與稀有度。圖鑑、掉落機率、挖掘小遊戲的難度都從這裡來。
//
// 稀有度越高:越少見、埋得越深(要挖越多下)、小遊戲越難。
// 新增寶物只要在 TREASURES 加一行;id 一旦發佈就不要改(玩家的圖鑑存檔用它記錄)。

export const RARITIES = [
  { id: "common", name: "Common", color: "#c9bfae", weight: 50 },
  { id: "uncommon", name: "Uncommon", color: "#7fcf6a", weight: 27 },
  { id: "rare", name: "Rare", color: "#5fa8ff", weight: 14 },
  { id: "epic", name: "Epic", color: "#c07cff", weight: 7 },
  { id: "legendary", name: "Legendary", color: "#ffc23d", weight: 2 },
];

// tier = RARITIES 的索引
export const TREASURES = [
  // 普通:村子裡到處都有的東西
  { id: "pebble", tier: 0, icon: "🪨", name: "Round Pebble", desc: "Smooth as an egg. Every good hole starts with one." },
  { id: "plank", tier: 0, icon: "🪵", name: "Old Plank", desc: "Still smells a little like the bakery's back door." },
  { id: "straw", tier: 0, icon: "🌾", name: "Bundle of Straw", desc: "Fell off a roof long ago. Roofs want it back." },
  { id: "nail", tier: 0, icon: "📌", name: "Bent Nail", desc: "Bent, but not broken. A bit like everyone here." },
  { id: "bone", tier: 0, icon: "🦴", name: "Ordinary Bone", desc: "Not the best bone. Still a bone. Still good." },
  // 少見:小玩意兒
  { id: "bottlecap", tier: 1, icon: "🔘", name: "Bottle Cap", desc: "From the lemonade stand by the bridge." },
  { id: "marble", tier: 1, icon: "🔵", name: "Blue Marble", desc: "Someone lost this mid-game and never found it." },
  { id: "button", tier: 1, icon: "🧷", name: "Coat Button", desc: "Off the miller's winter coat. He looked everywhere." },
  { id: "shell", tier: 1, icon: "🐚", name: "Lake Shell", desc: "Hold it to your ear: it sounds like the lake." },
  // 稀有:有主人的東西
  { id: "bell", tier: 2, icon: "🔔", name: "Brass Bell", desc: "It used to ring every morning when the bread was ready." },
  { id: "toyduck", tier: 2, icon: "🐤", name: "Wooden Duck", desc: "A toy duck. Much friendlier than the real ones." },
  { id: "spoon", tier: 2, icon: "🥄", name: "Carved Spoon", desc: "A little name is carved on the handle: \"Mira\"." },
  { id: "watch", tier: 2, icon: "⌚", name: "Pocket Watch", desc: "Stopped at 4:10. Teatime, probably." },
  // 珍貴:村子的回憶
  { id: "photo", tier: 3, icon: "🖼️", name: "Half a Photo", desc: "A family by a bakery. A corgi pup sits at their feet." },
  { id: "key", tier: 3, icon: "🗝️", name: "Bakery Key", desc: "Heavy and warm in the paw. Some door is waiting for it." },
  { id: "gear", tier: 3, icon: "⚙️", name: "Waterwheel Gear", desc: "The day this broke, the mill went quiet." },
  // 傳說
  { id: "goldbone", tier: 4, icon: "🏆", name: "Golden Bone", desc: "The stuff of corgi legend. Do not share." },
  { id: "seal", tier: 4, icon: "📜", name: "Mayor's Seal", desc: "Whoever holds this may name the village square." },
];

export const byId = Object.fromEntries(TREASURES.map((t) => [t.id, t]));

// rng() ∈ [0,1) → 稀有度索引(依 weight 加權)
export function rollTier(rng = Math.random) {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  let x = rng() * total;
  for (let i = 0; i < RARITIES.length; i++) {
    x -= RARITIES[i].weight;
    if (x < 0) return i;
  }
  return RARITIES.length - 1;
}

// 在某個稀有度裡隨機挑一件
export function pickTreasure(tier, rng = Math.random) {
  const pool = TREASURES.filter((t) => t.tier === tier);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
