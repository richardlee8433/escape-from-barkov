// 介面文字:每一句都是 [英文, 繁體中文]。
// {名稱} 是參數;值也可以是函式(英文的單複數、要把參數加工時用)。
// 標記 html 的那幾句(說明、信)含 <kbd> 等標籤,只會由 applyStatic 放進固定的 HTML 位置。
export const STRINGS = {
  // ---- 首頁
  "title.name": ["Dig, Corgi, Dig!", "柯基挖挖挖！"],
  "title.sub": ["a treasure hunt in the village of Barkov", "巴可夫村的尋寶之旅"],
  "title.tagline": ["a letter from Mom, and a good loud bark", "媽媽的來信，還有響亮的一聲汪"],
  "btn.start": ["Start Game", "開始遊戲"],
  "btn.howto": ["How to Play", "遊戲說明"],
  "btn.close": ["Close", "關閉"],
  "loading": ["Loading…", "載入中…"],
  "loading.n": ["Loading… {done}/{total}", "載入中… {done}/{total}"],
  "letsgo": ["Let's go! 🐾", "出發吧！🐾"],
  "load.failed": ["Load failed. Click to retry", "載入失敗，點一下重試"],

  // ---- 媽媽的信(html)
  "letter.greet": ["My dear pup,", "親愛的寶貝："],
  "letter.p1": [
    "If you are reading this, the old cottage in Barkov is yours now. It has stood empty for a long time. The roof lets the rain in, the floorboards have given up, and I'm afraid the ducks have made themselves quite at home in the village.",
    "當你讀到這封信時，巴可夫村的老房子就是你的了。它已經空了好長一段時間，屋頂會漏雨，地板也撐不住了，而且那些鴨子恐怕早就把村子當成自己家了。",
  ],
  "letter.p2": [
    "When your father and I were young, we buried all sorts of things around Barkov: planks and nails for a rainy day, straw for the roof, and a few small treasures that meant the world to us. Most of them are still out there, waiting.",
    "你爸爸和我年輕的時候，在巴可夫村各處埋了好多東西：以備不時之需的木板和釘子、修屋頂用的稻草，還有幾樣對我們來說無比珍貴的小寶物。它們大多都還在那裡等著。",
  ],
  "letter.p3": [
    "Use that wonderful nose of yours. Sniff them out, dig them up, and make the cottage a home again. And if the ducks give you any trouble, a good loud bark works wonders.",
    "用你那個了不起的鼻子，把它們聞出來、挖出來，讓這棟房子再變回一個家。要是鴨子找你麻煩，大聲吠一下就有用了。",
  ],
  "letter.sign": ["All my love,<br>Mom", "永遠愛你的<br>媽媽"],
  "letter.ps": ["P.S. Look out for half a photo. You'll know it when you find it.", "附註：留意半張照片。找到的時候，你就會明白。"],

  // ---- 遊戲說明(html)
  "howto.title": ["How to Play", "遊戲說明"],
  "howto.move": [
    "<kbd>W A S D</kbd> Run · hold <kbd>Shift</kbd> to walk · <kbd>Mouse wheel</kbd> Zoom",
    "<kbd>W A S D</kbd> 奔跑 · 按住 <kbd>Shift</kbd> 慢慢走 · <kbd>滑鼠滾輪</kbd> 拉近拉遠",
  ],
  "howto.sniff": [
    "<kbd>Q</kbd> :nose:Sniff. Treasure is buried out of sight, so follow the scent (cold → faint → warm → hot)",
    "<kbd>Q</kbd> :nose:嗅聞：寶物埋在地下看不到，跟著氣味找（冷 → 微弱 → 溫 → 熱）",
  ],
  "howto.dig": [
    "<kbd>E</kbd> Dig where your nose says \"Right here!\" · pick up things you dropped",
    "<kbd>E</kbd> 在鼻子說「就在這裡！」的地方開挖 · 撿回掉落的東西",
  ],
  "howto.mini": [
    "Digging: press <kbd>E</kbd> or <kbd>Space</kbd> when the needle is in the green (gold = perfect)",
    "挖掘時：指針在綠色區域時按 <kbd>E</kbd> 或 <kbd>空白鍵</kbd>（金色是完美）",
  ],
  "howto.panels": [
    "<kbd>B</kbd> Backpack · <kbd>Tab</kbd> Treasure Book (rarer treasures are buried deeper)",
    "<kbd>B</kbd> 背包 · <kbd>Tab</kbd> 寶物圖鑑（越稀有的寶物埋得越深）",
  ],
  "howto.ducks": [
    "Ducks are mischievous: a peck knocks you back and makes you drop something. Walk over it (or press <kbd>E</kbd>) to pick it back up",
    "鴨子很調皮：被啄到會被推開，還會掉出一樣東西。走過去（或按 <kbd>E</kbd>）就能撿回來",
  ],
  "howto.bark": [
    "<kbd>R</kbd> Bark: nearby ducks flap away in a panic (then it needs a few seconds to recharge)",
    "<kbd>R</kbd> 吠叫：附近的鴨子會嚇得拍著翅膀逃走（之後要等幾秒才能再吠）",
  ],
  "howto.home": [
    "<kbd>F</kbd> Go home at the HOME gate · <kbd>M</kbd> Toggle music",
    "<kbd>F</kbd> 在「家」的大門回家 · <kbd>M</kbd> 開關音樂",
  ],
  "howto.house": [
    "At home: <kbd>E</kbd> repair what your nose points at with things you dug up, or decorate shelves and tables with your treasures",
    "在家裡：<kbd>E</kbd> 用挖到的東西修理鼻子對著的地方，或用寶物布置架子和桌子",
  ],
  "howto.touch": [
    "On phones: drag on the left half of the screen to move · 🐾 dig and use · :nose: sniff · 🗯️ bark · 🏡 go home at the gate · pinch to zoom",
    "手機：在畫面左半邊拖曳移動 · 🐾 挖掘與互動 · :nose: 嗅聞 · 🗯️ 吠叫 · 🏡 在大門旁回家 · 兩指縮放",
  ],
  "howto.settings": [
    "<kbd>⚙️</kbd> (top right) Language and music volume",
    "<kbd>⚙️</kbd>（右上角）語言與音樂音量",
  ],

  // ---- HUD
  "hud.bag": ["Backpack (B)", "背包 (B)"],
  "hud.book": ["Treasure Book (Tab)", "寶物圖鑑 (Tab)"],
  "hud.bark": ["Bark (R): scares nearby ducks away", "吠叫 (R)：把附近的鴨子嚇跑"],
  "hud.home": ["Cottage repairs", "小屋修理進度"],

  // ---- 挖掘
  "dig.title": ["Digging…", "挖掘中…"],
  "dig.depth": ["Depth", "深度"],
  "dig.help": ["<kbd>E</kbd> / <kbd>Space</kbd> in the green · gold = perfect", "綠區按 <kbd>E</kbd> / <kbd>空白鍵</kbd> · 金色是完美"],
  "dig.slips": ["Slips", "失手"],
  "judge.perfect": ["Perfect!", "完美！"],
  "judge.good": ["Good", "不錯"],
  "judge.miss": ["Miss", "失手"],
  "reveal.new": ["NEW!", "新發現！"],
  "reveal.slipped": ["It slipped deeper… you grabbed this instead.", "寶物滑到更深處了…只抓到這個。"],
  "reveal.perfect": ["★ Perfect dig!", "★ 完美挖掘！"],
  "reveal.added": ["Added to your Treasure Book", "已記進寶物圖鑑"],
  "reveal.have": ["You have {n} of these", "你已經有 {n} 個了"],
  "sniff.start": [":nose: Sniffing…", ":nose: 聞聞中…"],

  // ---- 圖鑑、背包、擺設面板
  "book.title": ["📖 Treasure Book", "📖 寶物圖鑑"],
  "book.hint": [
    "Tab / Esc to close · B for the backpack · your collection is saved in this browser",
    "Tab / Esc 關閉 · B 打開背包 · 圖鑑會存在這個瀏覽器裡",
  ],
  "book.count": ["{found} / {total} found", "已找到 {found} / {total}"],
  "book.unknown": ["??? ({rarity})", "???（{rarity}）"],
  "book.found": [
    (p) => `${p.desc} (found ×${p.n}${p.perfect ? " · ★ perfect dig" : ""})`,
    (p) => `${p.desc}（找到 ×${p.n}${p.perfect ? " · ★ 完美挖掘" : ""}）`,
  ],
  "book.buried": [
    "Still buried somewhere. Rarer treasures sit deeper and are harder to dig.",
    "還埋在某個地方。越稀有的寶物埋得越深，也越難挖。",
  ],
  "bag.title": ["🎒 Backpack", "🎒 背包"],
  "bag.hint": [
    "B / Esc to close · Tab for the Treasure Book · your backpack is saved in this browser",
    "B / Esc 關閉 · Tab 打開圖鑑 · 背包會存在這個瀏覽器裡",
  ],
  "bag.count": [
    (p) => `${p.total} item${p.total === 1 ? "" : "s"} · ${p.kinds} kind${p.kinds === 1 ? "" : "s"}`,
    "{total} 件 · {kinds} 種",
  ],
  "bag.empty": [
    "Your backpack is empty. Press Q to sniff out buried treasure, then E to dig it up.",
    "背包是空的。按 Q 聞出埋著的寶物，再按 E 把它挖出來。",
  ],
  "picker.title": ["✨ {what}", "✨ {what}"],
  "picker.count": ["{filled} / {n} spots", "{filled} / {n} 個位置"],
  "picker.label": [
    "Pick a spot, then click a treasure from your backpack to put it there:",
    "先選一個位置，再點背包裡的寶物擺上去：",
  ],
  "picker.hint": ["↩ puts a treasure back in the backpack · Esc to close", "↩ 把寶物收回背包 · Esc 關閉"],
  "picker.emptySpot": ["Empty spot", "空位"],
  "picker.takeBack": ["Put it back in the backpack", "收回背包"],
  "picker.emptyBag": ["Your backpack is empty. Go dig up some treasure!", "背包是空的，先去挖點寶物吧！"],

  // ---- 提示列
  "tip.dig": ["Press E to dig here 🐾", "按 E 在這裡開挖 🐾"],
  "tip.home": ["Press F to go home 🏡", "按 F 回家 🏡"],
  "tip.door": ["Press E to go out digging 🐾", "按 E 出門挖寶 🐾"],
  "tip.decorate": ["Press E · {what}", "按 E · {what}"],
  "tip.repairReady": ["Press E · {verb} ({parts})", "按 E · {verb}（{parts}）"],
  "tip.repairNeed": ["{verb}: needs {parts}", "{verb}：需要 {parts}"],

  // ---- 紀錄
  "log.started": ["Game started {v}", "遊戲開始 {v}"],
  "log.hint.home": [
    "Your cottage is through the HOME gate on the east side. Press F there to go home 🏡",
    "小屋在東邊「家」的大門後面，走到那裡按 F 就能回家 🏡",
  ],
  "log.hint.sniff": ["Treasure is buried out of sight. Press Q to sniff it out :nose:", "寶物埋在地下看不見，按 Q 把它聞出來 :nose:"],
  "log.hint.bag": ["Everything you dig up goes into your backpack 🎒 (press B)", "挖到的東西都會放進背包 🎒（按 B）"],
  "log.hint.bark": ["Ducks bothering you? Press R to bark 🗯️", "鴨子來搗亂？按 R 對牠們吠 🗯️"],
  "log.quack": [
    "Quack! A duck made you drop {name}. Walk over it or press E to pick it up",
    "嘎！鴨子害你掉了{name}。走過去或按 E 撿回來",
  ],
  "log.picked": ["Picked up {name} 🎒", "撿回了{name} 🎒"],
  "log.nothing": ["Nothing here… press Q to sniff for buried treasure :nose:", "這裡什麼都沒有…按 Q 聞聞看哪裡有寶物 :nose:"],
  "log.peckedDig": ["A duck pecked you mid-dig! 🦆", "挖到一半被鴨子啄了！🦆"],
  "log.slipped": ["It slipped deeper… grabbed a {name} instead", "寶物滑到更深處了…只抓到{name}"],
  "log.dug": [
    (p) => `Dug up ${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""} (${p.rarity})${p.perfect ? ". Perfect dig!" : ""}${p.isNew ? " NEW!" : ""}`,
    (p) => `挖到了${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""}（${p.rarity}）${p.perfect ? "，完美挖掘！" : ""}${p.isNew ? " 新發現！" : ""}`,
  ],
  "log.notEnough": [
    (p) => `Not enough to ${p.verb.charAt(0).toLowerCase()}${p.verb.slice(1)}. Still need ${p.miss}. Go dig some up!`,
    "材料不夠，還不能{verb}。還需要 {miss}，去挖一些吧！",
  ],
  "log.repaired": ["{name} repaired! 🔨", "{name}修好了！🔨"],
  "log.allFixed": ["The whole cottage is fixed up. Home sweet home 🏡", "整間小屋都修好了。甜蜜的家 🏡"],
  "log.homeSweet": ["Home sweet home 🏡", "回到家了 🏡"],
  "log.homeBroken": [
    "Home… or what's left of it. Let's fix it up with what you dig! 🔨",
    "這就是家…或者說，家剩下的部分。用挖到的東西把它修好吧！🔨",
  ],
  "log.bgmOn": ["Music on (M)", "音樂開啟 (M)"],
  "log.bgmOff": ["Music off (M)", "音樂關閉 (M)"],
  "log.spawned": ["{n} ducks are wandering the village", "村子裡有 {n} 隻鴨子在閒晃"],

  // ---- 手機版(觸控):按鈕名稱,以及把「按某個鍵」換成「點某個按鈕」的句子
  "touch.act": ["Dig", "挖"],
  "touch.sniff": ["Sniff", "聞"],
  "touch.bark": ["Bark", "吠"],
  "touch.home": ["Home", "回家"],
  "touch.rotate": ["Turn your phone sideways for a better view", "把手機橫過來玩，視野會更好"],
  "scent.here@touch": ["Right here! Tap 🐾 to dig", "就在這裡！點 🐾 開挖"],
  "tip.dig@touch": ["Tap 🐾 to dig here", "點 🐾 在這裡開挖"],
  "tip.home@touch": ["Tap 🏡 to go home", "點 🏡 回家"],
  "tip.door@touch": ["Tap 🐾 to go out digging", "點 🐾 出門挖寶"],
  "tip.decorate@touch": ["Tap 🐾 · {what}", "點 🐾 · {what}"],
  "tip.repairReady@touch": ["Tap 🐾 · {verb} ({parts})", "點 🐾 · {verb}（{parts}）"],
  "dig.help@touch": ["Tap 🐾 (or anywhere) in the green · gold = perfect", "綠區時點 🐾（或畫面任何地方）· 金色是完美"],
  "log.hint.home@touch": [
    "Your cottage is through the HOME gate on the east side. Tap 🏡 there to go home",
    "小屋在東邊「家」的大門後面，走到那裡點 🏡 就能回家",
  ],
  "log.hint.sniff@touch": ["Treasure is buried out of sight. Tap :nose: to sniff it out", "寶物埋在地下看不見，點 :nose: 把它聞出來"],
  "log.hint.bag@touch": ["Everything you dig up goes into your backpack 🎒 (top left)", "挖到的東西都會放進背包 🎒（左上角）"],
  "log.hint.bark@touch": ["Ducks bothering you? Tap 🗯️ to bark", "鴨子來搗亂？點 🗯️ 對牠們吠"],
  "log.quack@touch": ["Quack! A duck made you drop {name}. Walk over it to pick it up", "嘎！鴨子害你掉了{name}。走過去就能撿回來"],
  "log.nothing@touch": ["Nothing here… tap :nose: to sniff for buried treasure", "這裡什麼都沒有…點 :nose: 聞聞看哪裡有寶物"],
  "bag.empty@touch": [
    "Your backpack is empty. Tap the nose button to sniff out buried treasure, then 🐾 to dig it up.",
    "背包是空的。點鼻子按鈕聞出埋著的寶物，再點 🐾 把它挖出來。",
  ],
  "book.hint@touch": ["Tap ✕ to close · your collection is saved in this browser", "點 ✕ 關閉 · 圖鑑會存在這個瀏覽器裡"],
  "bag.hint@touch": ["Tap ✕ to close · your backpack is saved in this browser", "點 ✕ 關閉 · 背包會存在這個瀏覽器裡"],
  "picker.hint@touch": ["↩ puts a treasure back in the backpack · tap ✕ to close", "↩ 把寶物收回背包 · 點 ✕ 關閉"],
  "settings.hint@touch": ["Settings are saved in this browser", "設定會存在這個瀏覽器裡"],

  // ---- 3D 場景裡的字
  "sign.home": ["HOME", "家"],
  "bark.woof": ["WOOF!", "汪！"],

  // ---- 設定
  "settings.btn": ["Settings", "設定"],
  "settings.title": ["⚙️ Settings", "⚙️ 設定"],
  "settings.lang": ["Language", "語言"],
  "settings.music": ["Music volume", "音樂音量"],
  "settings.hint": ["M turns the music on and off · settings are saved in this browser", "M 鍵可以開關音樂 · 設定會存在這個瀏覽器裡"],

  // ---- 結束畫面(目前沒用到,留著)
  "end.title": ["🎉 Home at last!", "🎉 終於到家了！"],
  "end.text": ["You made it home with a backpack full of treasure.", "你帶著滿滿一背包的寶物回到家。"],
  "end.credits": ["Corgi, ducks and environment modeled procedurally in Blender", "柯基、鴨子與場景都以 Blender 程序化建模"],
  "end.retry": ["Play Again", "再玩一次"],
};

// 遊戲資料(寶物、稀有度、家的站點、氣味)的中文。英文寫在各自的 config 裡。
export const ZH_DATA = {
  rarity: { common: "普通", uncommon: "少見", rare: "稀有", epic: "珍貴", legendary: "傳說" },
  treasure: {
    pebble: ["圓石子", "像蛋一樣光滑。每個好洞都是從一顆石子開始的。"],
    plank: ["舊木板", "聞起來還有一點麵包店後門的味道。"],
    straw: ["一捆稻草", "很久以前從屋頂掉下來的。屋頂想把它要回去。"],
    nail: ["彎釘子", "彎了，但沒斷。跟這裡的大家有點像。"],
    bone: ["普通骨頭", "不是最好的骨頭。但還是骨頭，還是很棒。"],
    bottlecap: ["瓶蓋", "來自橋邊的檸檬水小攤。"],
    marble: ["藍色彈珠", "有人玩到一半弄丟了，再也沒找到。"],
    button: ["大衣鈕扣", "從磨坊主人的冬季大衣上掉下來的。他到處都找過了。"],
    shell: ["湖邊貝殼", "放在耳邊聽聽看：聽起來像湖水的聲音。"],
    bell: ["黃銅鈴鐺", "以前每天早上麵包出爐時都會響。"],
    toyduck: ["木頭鴨子", "一隻玩具鴨子。比真的鴨子友善多了。"],
    spoon: ["雕花湯匙", "握柄上刻著一個小小的名字：「米拉」。"],
    watch: ["懷錶", "停在四點十分。大概是下午茶時間。"],
    photo: ["半張照片", "一家人站在麵包店前，腳邊坐著一隻小柯基。"],
    key: ["麵包店鑰匙", "握在掌心裡沉甸甸、暖暖的。某扇門正在等著它。"],
    gear: ["水車齒輪", "它壞掉的那天，磨坊就安靜了下來。"],
    goldbone: ["黃金骨頭", "柯基界的傳說。不准分給別人。"],
    seal: ["村長印章", "拿著它的人，可以為村子的廣場取名字。"],
  },
  station: {
    floor: { name: "地板", verb: "補好地板" },
    roof: { name: "屋頂", verb: "修好屋頂" },
    fireplace: { name: "壁爐", verb: "重新砌好壁爐", decorate: "布置壁爐台" },
    window: { name: "窗戶", verb: "修好窗戶", decorate: "布置窗台" },
    shelf: { name: "架子", verb: "把架子裝回去", decorate: "布置架子" },
    table: { name: "桌子", verb: "修好桌子", decorate: "布置桌子" },
    bed: { name: "狗窩", verb: "做一個舒服的狗窩" },
    rug: { name: "地毯", verb: "編一張地毯" },
  },
  scent: {
    here: "就在這裡！按 E 開挖 🐾",
    hot: "好燙！就在附近了",
    warm: "溫溫的，越來越近了",
    faint: "有一點點味道…",
    cold: "冷冰冰的，這附近什麼都沒有",
  },
};
