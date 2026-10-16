// 介面用的小圖示(SVG,不靠系統的 emoji 字型)。
// 文字裡寫 :nose: 就會換成黑色的狗鼻子。

// 黑色狗鼻:比高還寬、下緣分成兩瓣,兩側下方是逗號形的鼻孔,中間一道人中溝,上緣一抹濕亮的反光;
// 外圈一道淡奶油色描邊,放在深色草地上也看得清楚
export const NOSE_SVG = `<svg class="icon-nose" viewBox="0 0 32 21" aria-hidden="true">
  <defs><linearGradient id="nose-g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#55504f"/><stop offset=".45" stop-color="#262324"/><stop offset="1" stop-color="#0d0c0d"/>
  </linearGradient></defs>
  <path d="M16 1.5C7.6 1.5 1.5 4.2 1.5 9.4c0 4.6 4.1 8.8 8.8 9.3 2.6.3 4.3-.9 5.7-2.4 1.4 1.5 3.1 2.7 5.7 2.4 4.7-.5 8.8-4.7 8.8-9.3 0-5.2-6.1-7.9-14.5-7.9z"
    fill="url(#nose-g)" stroke="#f0e3c8" stroke-opacity=".7" stroke-width="1"/>
  <path d="M4.6 12.4c.4-2.8 3.3-4.1 6-3.1.9.3.9 1.6 0 2-1.7.7-2.3 2.4-3.6 3.3-1.2.8-2.6-.5-2.4-2.2z" fill="#030303"/>
  <path d="M27.4 12.4c-.4-2.8-3.3-4.1-6-3.1-.9.3-.9 1.6 0 2 1.7.7 2.3 2.4 3.6 3.3 1.2.8 2.6-.5 2.4-2.2z" fill="#030303"/>
  <path d="M16 9.8v6.2" stroke="#030303" stroke-width="1.3" stroke-linecap="round"/>
  <ellipse cx="16" cy="4.9" rx="7.5" ry="1.7" fill="#fff" opacity=".42"/>
  <ellipse cx="9" cy="6.4" rx="1.6" ry=".8" fill="#fff" opacity=".3"/>
</svg>`;

const ICONS = { nose: NOSE_SVG };
const tpl = document.createElement("template");

// 把文字放進元素:一般文字一律當純文字(不解析 HTML),只有 :名稱: 會換成圖示
export function setIconText(el, text) {
  el.textContent = "";
  for (const part of String(text).split(/(:[a-z]+:)/)) {
    const icon = /^:([a-z]+):$/.exec(part);
    if (icon && ICONS[icon[1]]) {
      tpl.innerHTML = ICONS[icon[1]];
      el.appendChild(tpl.content.firstElementChild.cloneNode(true));
    } else if (part) {
      el.appendChild(document.createTextNode(part));
    }
  }
}
