// 把遊戲打包成可以直接放上任何靜態網站的 dist/ 資料夾。
//
//   node tools/build-web.mjs        → dist/
//   npx serve dist                  → 本機試玩
//   dist/artifact/                  → claude.ai Artifact 版(無 GLB,見下方)
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

// 確認改寫後沒有任何 ../ 引用殘留
const leftovers = walk(OUT)
  .filter((f) => /\.(js|html)$/.test(f))
  .filter((f) => /["'`]\.\.\/(proto|luug|ass)\//.test(fs.readFileSync(f, "utf8")));
if (leftovers.length) {
  console.error("仍有指向 dist 外的路徑:", leftovers);
  process.exit(1);
}

// ---------------------------------------------------------------- claude.ai Artifact 版
// dist/artifact/:平台會自己包上 <html>/<head>/<body>,頁面只放內容;
// 平台不提供 .glb 類型,所以每個 GLB 轉成等價的 glTF JSON(二進位以 base64 內嵌,
// 貼圖仍是 bufferView 或相對路徑的 png),檔名 .gltf.json。GLTFLoader 兩種都吃。
const ART = path.join(OUT, "artifact");

function glbToGltf(buf) {
  const json = JSON.parse(buf.toString("utf8", 20, 20 + buf.readUInt32LE(12)));
  const binStart = 20 + buf.readUInt32LE(12);
  const binLen = buf.readUInt32LE(binStart);
  const bin = buf.subarray(binStart + 8, binStart + 8 + binLen);
  if (json.buffers?.length) {
    json.buffers[0].uri = "data:application/octet-stream;base64," + bin.toString("base64");
  }
  return JSON.stringify(json);
}

for (const f of walk(OUT)) {
  if (f.startsWith(ART)) continue;
  const rel = path.relative(OUT, f);
  if (rel === "index.html") continue;
  if (f.endsWith(".glb")) {
    const dst = path.join(ART, rel.replace(/\.glb$/, ".gltf.json"));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, glbToGltf(fs.readFileSync(f)));
  } else if (f.endsWith(".js")) {
    copy(f, path.join(ART, rel), (t) => t.replace(/\.glb"/g, '.gltf.json"'));
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
if (walk(ART).some((f) => f.endsWith(".js") && /\.glb["'`]/.test(fs.readFileSync(f, "utf8")))) {
  console.error("artifact 版仍有 .glb 引用");
  process.exit(1);
}

const files = walk(OUT);
const bytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`dist/: ${files.length} 個檔案, ${(bytes / 1048576).toFixed(1)} MB`);
