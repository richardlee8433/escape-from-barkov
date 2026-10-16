import { suite, check, eq } from "./harness.js";
import { STRINGS, ZH_DATA } from "../src/i18n/strings.js";
import { t, trName, trDesc, rarityName, stName, stVerb, stDecorate, scentLabel } from "../src/i18n/i18n.js";
import { settings } from "../src/core/Settings.js";
import { TREASURES, RARITIES } from "../src/config/treasures.js";
import { STATIONS } from "../src/config/home.js";
import { SCENTS } from "../src/systems/DigSpots.js";

// 每一句都要有英文和中文;全部文字(含遊戲資料)都不准出現破折號 —
const DASH = /[—–]/;

function withLang(lang, fn) {
  const prev = settings.lang;
  settings.lang = lang; // 直接改,不寫進玩家的存檔
  try {
    return fn();
  } finally {
    settings.lang = prev;
  }
}

// 把一句(或函式)用假參數展開成文字
function render(v) {
  const p = { desc: "d", n: 2, perfect: true, total: 2, kinds: 1, name: "x", qty: 2, rarity: "r", isNew: true, verb: "Fix it", miss: "m" };
  return typeof v === "function" ? v(p) : v;
}

export function run() {
  suite("多語系");

  check("每一句介面文字都有英文和中文", () => {
    for (const [k, row] of Object.entries(STRINGS)) {
      if (!Array.isArray(row) || row.length !== 2 || !row[0] || !row[1]) return `${k} 缺翻譯`;
    }
  });

  check("寶物、稀有度、家的站點、氣味都有中文", () => {
    for (const tr of TREASURES) if (!ZH_DATA.treasure[tr.id]?.[0] || !ZH_DATA.treasure[tr.id]?.[1]) return `寶物 ${tr.id}`;
    for (const r of RARITIES) if (!ZH_DATA.rarity[r.id]) return `稀有度 ${r.id}`;
    for (const st of STATIONS) {
      const z = ZH_DATA.station[st.id];
      if (!z?.name || !z?.verb || (st.decorate && !z.decorate)) return `站點 ${st.id}`;
    }
    for (const s of SCENTS) if (!ZH_DATA.scent[s.id]) return `氣味 ${s.id}`;
  });

  check("任何文字都沒有破折號", () => {
    for (const [k, row] of Object.entries(STRINGS)) {
      for (const v of row) if (DASH.test(render(v))) return `${k}: ${render(v)}`;
    }
    const data = [
      ...TREASURES.flatMap((tr) => [tr.name, tr.desc]), ...RARITIES.map((r) => r.name),
      ...STATIONS.flatMap((st) => [st.name, st.verb, st.decorate || ""]), ...SCENTS.map((s) => s.label),
      ...Object.values(ZH_DATA.treasure).flat(), ...Object.values(ZH_DATA.rarity), ...Object.values(ZH_DATA.scent),
      ...Object.values(ZH_DATA.station).flatMap((o) => Object.values(o)),
    ];
    for (const s of data) if (DASH.test(s)) return s;
  });

  check("t() 會代入參數,也會依語言切換", () => {
    const en = withLang("en", () => t("book.count", { found: 3, total: 18 }));
    const zh = withLang("zh", () => t("book.count", { found: 3, total: 18 }));
    if (en !== "3 / 18 found") return en;
    return eq(zh, "已找到 3 / 18");
  });

  check("英文的單複數:1 item、2 items", () => withLang("en", () =>
    eq(`${t("bag.count", { total: 1, kinds: 1 })} | ${t("bag.count", { total: 2, kinds: 3 })}`, "1 item · 1 kind | 2 items · 3 kinds")));

  check("遊戲資料的名字跟著語言換", () => {
    const bell = TREASURES.find((x) => x.id === "bell");
    const table = STATIONS.find((x) => x.id === "table");
    const got = withLang("zh", () => [trName(bell), rarityName(RARITIES[2]), stName(table), stVerb(table), stDecorate(table), scentLabel(SCENTS[0])]);
    if (got.join("|") !== "黃銅鈴鐺|稀有|桌子|修好桌子|布置桌子|就在這裡！按 E 開挖 🐾") return got.join("|");
    return eq(withLang("en", () => trDesc(bell)), bell.desc);
  });

  check("不認得的 key 原樣傳回(不會讓畫面壞掉)", () => eq(t("no.such.key"), "no.such.key"));
}
