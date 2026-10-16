// 打包一個可以直接上傳到 itch.io 的 HTML5 zip。
//
//   node tools/build-itch.mjs     → dist-itch/dig-corgi-dig-<版本>-itch.zip
//
// 先跑 build-web(產生自給自足的 dist/),再把 dist/ 壓成 zip:index.html 在 zip 的最上層,
// 不含 dist/artifact/(那是 claude.ai 專用的 .glb.json 版本)。
// zip 用 Node 內建的 zlib 自己寫,不依賴系統的 zip 指令(Windows 也能跑)。
//
// itch.io 上傳設定:Kind of project = HTML,勾 "This file will be played in the browser",
// Viewport 1280 × 720,勾 Fullscreen button。

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { execFileSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST = path.join(ROOT, "dist");
const OUT_DIR = path.join(ROOT, "dist-itch");

execFileSync(process.execPath, [path.join(ROOT, "tools/build-web.mjs")], { stdio: "inherit" });

const version = /VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "game/src/config/balance.js"), "utf8"))[1];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

const files = walk(DIST)
  .filter((f) => !f.startsWith(path.join(DIST, "artifact") + path.sep))
  .map((f) => ({ abs: f, name: path.relative(DIST, f).split(path.sep).join("/") }))
  .sort((a, b) => (a.name === "index.html" ? -1 : b.name === "index.html" ? 1 : a.name.localeCompare(b.name)));

if (!files.some((f) => f.name === "index.html")) throw new Error("dist/index.html 不見了");
// itch.io 的限制:最多 1000 個檔案,單檔不超過 200 MB
if (files.length > 1000) throw new Error(`檔案太多(${files.length}),itch.io 上限 1000`);

// ---------------------------------------------------------------- 最小的 zip 寫入器
// 每個檔案:local header + 資料;最後是 central directory 與 end record。
// 已經壓縮過的格式(mp3、webp)直接存(stored),其餘用 deflate。
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const STORE = /\.(mp3|webp|png|jpe?g|zip)$/i;

const chunks = [];
const central = [];
let offset = 0;
for (const f of files) {
  const data = fs.readFileSync(f.abs);
  const crc = zlib.crc32(data);
  let method = 0, body = data;
  if (!STORE.test(f.name)) {
    const z = zlib.deflateRawSync(data, { level: 9 });
    if (z.length < data.length) { method = 8; body = z; }
  }
  const name = Buffer.from(f.name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);           // version needed
  local.writeUInt16LE(0x0800, 6);       // UTF-8 檔名
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, name, body);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);              // version made by
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(dosTime, 12);
  cd.writeUInt16LE(dosDate, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(body.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(offset, 42);         // 其餘欄位(註解、屬性)都是 0
  central.push(cd, name);
  offset += local.length + name.length + body.length;
}
const cdSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(OUT_DIR, { recursive: true });
const zipPath = path.join(OUT_DIR, `dig-corgi-dig-${version}-itch.zip`);
fs.writeFileSync(zipPath, Buffer.concat([...chunks, ...central, end]));
const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`itch.io zip: ${path.relative(ROOT, zipPath)}(${files.length} 個檔案,${mb} MB)`);
