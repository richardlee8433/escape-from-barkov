// 把遊戲打包成可以直接放上任何靜態網站的 dist/ 資料夾。
//
//   node tools/build-web.mjs        → dist/
//   npx serve dist                  → 本機試玩
//   dist/artifact/                  → claude.ai Artifact 版(無 GLB,見下方)
//   需要先 npm install(Three.js 會被收進 dist/vendor/,網站不依賴 CDN 與 import map)
//
// 開發時遊戲從 game/ 以 ../ 往上引用 proto/ 的模型、根目錄的柯基與 ass/ 的音樂;
// 放上網站時頁面就是根目錄,../ 會指到網站外面。這裡把用到的檔案全部收進 dist/
// 同一層,並把那幾個路徑改寫成 ./。原始碼一行都不用改。

import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "dist");

const REWRITES = [
  ["../proto/assets/models/", "./proto/assets/models/"],
  ["../luug_corgi_tales_of_arcadia.glb", "./luug_corgi_tales_of_arcadia.glb"],
  ["../ass/audio/bgm.mp3", "./ass/audio/bgm.mp3"],
];

// 遊戲執行時會載入的資產(不含 proto 自己用的整套 Kenney 模型)
const ASSETS = [
  "luug_corgi_tales_of_arcadia.glb",
  "ass/audio/bgm.mp3",
  "proto/assets/models/voxel_duck.glb",
  "proto/assets/models/pickups-platformer/heart.glb",
  "proto/assets/models/pickups-platformer/Textures/colormap.png",
  "proto/assets/models/pickups-blaster/clip-large.glb",
  "proto/assets/models/pickups-blaster/bullet-foam.glb",
  "proto/assets/models/pickups-blaster/Textures/colormap.png",
];

function copy(src, dst, transform) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (transform) fs.writeFileSync(dst, transform(fs.readFileSync(src, "utf8")));
  else fs.copyFileSync(src, dst);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

const rewrite = (text) => REWRITES.reduce((t, [a, b]) => t.split(a).join(b), text);

fs.rmSync(OUT, { recursive: true, force: true });

// 頁面與程式碼
copy(path.join(ROOT, "game/index.html"), path.join(OUT, "index.html"), rewrite);
for (const f of walk(path.join(ROOT, "game/src"))) {
  copy(f, path.join(OUT, path.relative(path.join(ROOT, "game"), f)), f.endsWith(".js") ? rewrite : null);
}
// Blender 環境模型
for (const f of walk(path.join(ROOT, "game/assets"))) {
  copy(f, path.join(OUT, path.relative(path.join(ROOT, "game"), f)));
}
for (const a of ASSETS) copy(path.join(ROOT, a), path.join(OUT, a));

// ---------------------------------------------------------------- 把 Three.js 收進網站
// 開發版靠 index.html 的 <script type="importmap"> 把 "three" 對應到 unpkg。
// 放上別人的主機時這不一定可靠:主機若在頁面之前先注入自己的 module script,
// 瀏覽器會忽略之後才出現的 import map,所有 import "three" 都會失敗 → 遊戲完全不啟動
// (claude.ai Artifact 上 Start 按鈕沒反應就是這個原因)。
// 這裡把用到的 three 檔案(順著 import 一路追)複製到 vendor/three/,
// 並把所有 "three" / "three/addons/…" 改寫成相對路徑,網站不再需要 import map 與 CDN。
const THREE_SRC = path.join(ROOT, "node_modules/three");
const THREE_OUT = path.join(OUT, "vendor/three");
if (!fs.existsSync(path.join(THREE_SRC, "build/three.module.js"))) {
  console.error("找不到 node_modules/three,請先執行 npm install");
  process.exit(1);
}
{
  const IMPORT_RE = /(\bfrom\s*|\bimport\s*)(["'])([^"']+)\2/g;
  const rel = (fromFile, toFile) => {
    let r = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
    return r.startsWith(".") ? r : "./" + r;
  };
  const queue = walk(path.join(OUT, "src")).filter((f) => f.endsWith(".js"));
  const seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8").replace(IMPORT_RE, (m, kw, q, spec) => {
      let target = null;
      if (spec === "three") target = path.join(THREE_OUT, "build/three.module.js");
      else if (spec.startsWith("three/addons/")) target = path.join(THREE_OUT, "examples/jsm", spec.slice(13));
      else if (spec.startsWith(".") && file.startsWith(THREE_OUT)) target = path.resolve(path.dirname(file), spec);
      if (!target) return m; // 遊戲自己的相對路徑,不動
      if (target.startsWith(THREE_OUT) && !fs.existsSync(target)) {
        copy(path.join(THREE_SRC, path.relative(THREE_OUT, target)), target);
        queue.push(target);
      }
      return kw + q + rel(file, target) + q;
    });
    fs.writeFileSync(file, text);
  }
  // 頁面不再需要 import map
  const indexPath = path.join(OUT, "index.html");
  const html = fs.readFileSync(indexPath, "utf8").replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "");
  fs.writeFileSync(indexPath, html);
  const left = walk(OUT).filter((f) => f.endsWith(".js"))
    .filter((f) => /from\s*["']three(["']|\/)/.test(fs.readFileSync(f, "utf8")));
  if (left.length || html.includes("importmap")) {
    console.error("仍有未改寫的 three 引用:", left);
    process.exit(1);
  }
  console.log(`vendor/three: ${walk(THREE_OUT).length} 個檔案`);
}

// 確認改寫後沒有任何 ../ 引用殘留
const leftovers = walk(OUT)
  .filter((f) => /\.(js|html)$/.test(f))
  .filter((f) => /["'`]\.\.\/(proto|luug|ass)\//.test(fs.readFileSync(f, "utf8")));
if (leftovers.length) {
  console.error("仍有指向 dist 外的路徑:", leftovers);
  process.exit(1);
}

// ---------------------------------------------------------------- claude.ai Artifact 版
// dist/artifact/:平台會自己包上 <html>/<head>/<body>,頁面只放內容。
// 平台不提供 .glb 類型,也不准 fetch data: 網址(早先把二進位做成 data: 內嵌的 glTF JSON,
// 在 Artifact 上就是這樣整個載不進來,Start 按鈕看起來沒反應)。
// 現在把整個 GLB 以 base64 包進 { glb } JSON,檔名 .glb.json,由 Assets.js 自己解碼再解析。
const ART = path.join(OUT, "artifact");

const wrapGlb = (buf) => JSON.stringify({ glb: buf.toString("base64") });

for (const f of walk(OUT)) {
  if (f.startsWith(ART)) continue;
  const rel = path.relative(OUT, f);
  if (rel === "index.html") continue;
  if (f.endsWith(".glb")) {
    const dst = path.join(ART, rel + ".json");
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, wrapGlb(fs.readFileSync(f)));
  } else if (f.endsWith(".js")) {
    copy(f, path.join(ART, rel), (t) => t.replace(/\.glb"/g, '.glb.json"'));
  } else {
    copy(f, path.join(ART, rel));
  }
}
{
  const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"))
    .replace(/<meta[^>]*>\s*/g, "")
    .replace(/<title>.*?<\/title>/, "<title>Escape from Barkov</title>")
    .replace("<style>", "<style>\n    :root { color-scheme: dark; }");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  fs.writeFileSync(path.join(ART, "index.html"), head.trim() + "\n" + body.trim() + "\n");
}
if (walk(ART).some((f) => f.endsWith(".js") && /\.glb["'`]/.test(fs.readFileSync(f, "utf8")))
  || walk(ART).some((f) => /data:application/.test(f.endsWith(".js") ? fs.readFileSync(f, "utf8") : ""))) {
  console.error("artifact 版仍有 .glb 引用");
  process.exit(1);
}

const files = walk(OUT);
const bytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`dist/: ${files.length} 個檔案, ${(bytes / 1048576).toFixed(1)} MB`);
