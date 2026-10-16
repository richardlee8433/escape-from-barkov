import { bus } from "./EventBus.js";

// 玩家設定(語言、音樂音量),存在瀏覽器裡。
// 第一次玩時語言跟著瀏覽器:中文環境預設繁體中文,其餘英文。
const KEY = "barkov.settings.v1";
const LANGS = ["en", "zh"];

function storage() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

function detectLang() {
  try {
    return /^zh/i.test(navigator.language || "") ? "zh" : "en";
  } catch (e) {
    return "en";
  }
}

function load() {
  const out = { lang: detectLang(), music: 1 };
  try {
    const raw = storage()?.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    if (LANGS.includes(data?.lang)) out.lang = data.lang;
    if (typeof data?.music === "number" && data.music >= 0 && data.music <= 1) out.music = data.music;
  } catch (e) { /* 壞掉的設定就用預設值 */ }
  return out;
}

export const settings = {
  ...load(),

  set(key, value) {
    if (this[key] === value) return;
    this[key] = value;
    try {
      storage()?.setItem(KEY, JSON.stringify({ lang: this.lang, music: this.music }));
    } catch (e) { /* 存不了就算了 */ }
    bus.emit("settings:changed", { key, value });
  },
};
