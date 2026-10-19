import { bus } from "../core/EventBus.js";
import { settings } from "../core/Settings.js";
import { NOSE_SVG } from "../ui/icons.js";
import { STRINGS, ZH_DATA } from "./strings.js";

// 多語系:英文 / 繁體中文。
//   t("key", { 參數 })        介面文字
//   trName / trDesc / rarityName / stName / stVerb / stDecorate / scentLabel   遊戲資料的名字
//   applyStatic()              把 index.html 裡標了 data-i18n* 的地方換成目前語言
// 換語言(設定面板)時發出 lang:changed,畫面上的東西各自重畫。
export const LANGS = [
  { id: "en", label: "English", html: "en" },
  { id: "zh", label: "繁體中文", html: "zh-Hant" },
];

export const getLang = () => settings.lang;
const idx = () => (settings.lang === "zh" ? 1 : 0);

// 觸控模式(手機):有「key@touch」版本的句子改用它(「按 E」變成「點 🐾」之類)
let touch = false;
export const isTouch = () => touch;
export function setTouch(on) {
  if (touch === on) return;
  touch = on;
  applyStatic();
  bus.emit("lang:changed", { lang: settings.lang });
}

export function t(key, params = {}) {
  const row = (touch && STRINGS[`${key}@touch`]) || STRINGS[key];
  if (!row) return key;
  const v = row[idx()] ?? row[0];
  if (typeof v === "function") return v(params);
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

const zh = () => settings.lang === "zh";
export const trName = (tr) => (zh() && ZH_DATA.treasure[tr.id]?.[0]) || tr.name;
export const trDesc = (tr) => (zh() && ZH_DATA.treasure[tr.id]?.[1]) || tr.desc;
export const rarityName = (r) => (zh() && ZH_DATA.rarity[r.id]) || r.name;
export const stName = (st) => (zh() && ZH_DATA.station[st.id]?.name) || st.name;
export const stVerb = (st) => (zh() && ZH_DATA.station[st.id]?.verb) || st.verb;
export const stDecorate = (st) => (zh() && ZH_DATA.station[st.id]?.decorate) || st.decorate;
export const scentLabel = (s) =>
  (touch && s.id === "here" && t("scent.here@touch")) || (zh() && ZH_DATA.scent[s.id]) || s.label;

// data-i18n:純文字;data-i18n-html:含 <kbd>/<br> 的固定文字(:nose: 換成狗鼻子);data-i18n-title:滑鼠提示
export function applyStatic(root = document) {
  const lang = LANGS.find((l) => l.id === settings.lang) || LANGS[0];
  document.documentElement.lang = lang.html;
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml).split(":nose:").join(NOSE_SVG);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.title = t("title.name");
}

export function setLang(id) {
  if (!LANGS.some((l) => l.id === id) || id === settings.lang) return;
  settings.set("lang", id);
  applyStatic();
  bus.emit("lang:changed", { lang: id });
}
