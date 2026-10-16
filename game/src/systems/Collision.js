import { BAL } from "../config/balance.js";

// 2D 碰撞:遊戲永遠在 BAL.world.gameplayY 這一個平面上,這一層完全不存在高度概念。
//
// 靜態障礙有三種形狀,讓碰撞貼合模型的實際輪廓:
//   circle  —— 樹幹、木桶、水井(addStatic)
//   capsule —— 長條物:柵欄、橋欄杆、圓木、長形巨石(addCapsule)
//   box     —— 方正物:農舍、木箱、寶箱(addBox,可轉角度)
// 另外有「溝壑區」(addRavine):一條帶狀禁區,只有開口(橋面)能通過,
// 而且在開口裡左右被欄杆夾住,不會一半在橋上、一半掉進溝裡。
//
// 每個形狀都提供同一個操作:點到表面的「有號距離 + 向外法線」。
// 解算、子彈、視線、可放置判斷全部建立在這一個操作上。
//
// 角色用「身體」解算:半徑 r 的圓,或沿面向排開的三個圓(長條形的柯基),
// body = { r, half, fx, fz } —— half 是頭尾圓心到中心的距離,(fx,fz) 是面向。
// 只傳一個數字就是單一圓。
const HALF = BAL.world.size / 2;
const BOUND = HALF - BAL.world.edgeMargin;
const CELL = 8; // 空間雜湊格子大小(公尺)

const _c = { d: 0, nx: 0, nz: 0 }; // 共用輸出,避免每次配置物件

function closestOnSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-9 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + vx * t, az + vz * t];
}

// 點到形狀表面的有號距離(負 = 在裡面),寫入 _c
function contact(s, x, z) {
  if (s.kind === "circle") {
    const dx = x - s.x, dz = z - s.z;
    const d = Math.hypot(dx, dz);
    _c.d = d - s.r;
    if (d > 1e-6) { _c.nx = dx / d; _c.nz = dz / d; } else { _c.nx = 1; _c.nz = 0; }
  } else if (s.kind === "capsule") {
    const [qx, qz] = closestOnSegment(x, z, s.ax, s.az, s.bx, s.bz);
    const dx = x - qx, dz = z - qz;
    const d = Math.hypot(dx, dz);
    _c.d = d - s.r;
    if (d > 1e-6) { _c.nx = dx / d; _c.nz = dz / d; } else { _c.nx = -s.uz; _c.nz = s.ux; }
  } else {
    // box:轉進本地座標(與 three.js rotation.y 相同的慣例)
    const dx = x - s.x, dz = z - s.z;
    const lx = dx * s.c - dz * s.s;
    const lz = dx * s.s + dz * s.c;
    const qx = Math.abs(lx) - s.hx;
    const qz = Math.abs(lz) - s.hz;
    let nlx, nlz;
    if (qx > 0 || qz > 0) {
      const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
      const d = Math.hypot(ox, oz);
      _c.d = d;
      nlx = (ox / d) * Math.sign(lx);
      nlz = (oz / d) * Math.sign(lz);
    } else if (qx > qz) {
      _c.d = qx; nlx = Math.sign(lx) || 1; nlz = 0;
    } else {
      _c.d = qz; nlx = 0; nlz = Math.sign(lz) || 1;
    }
    // 本地 → 世界
    _c.nx = nlx * s.c + nlz * s.s;
    _c.nz = -nlx * s.s + nlz * s.c;
  }
  return _c;
}

// 線段 a→b 與形狀(縮放 k 倍)是否相交 —— 視線判斷用
function segmentHits(s, ax, az, bx, bz, k) {
  if (s.kind === "circle") {
    const [qx, qz] = closestOnSegment(s.x, s.z, ax, az, bx, bz);
    const r = s.r * k;
    return (qx - s.x) ** 2 + (qz - s.z) ** 2 < r * r;
  }
  if (s.kind === "capsule") {
    // 線段對線段的最近距離:取兩端點對另一條線段的最近點,加上是否相交
    const r = s.r * k;
    if (segmentsIntersect(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) return true;
    const pts = [
      [ax, az, s.ax, s.az, s.bx, s.bz], [bx, bz, s.ax, s.az, s.bx, s.bz],
      [s.ax, s.az, ax, az, bx, bz], [s.bx, s.bz, ax, az, bx, bz],
    ];
    for (const [px, pz, x0, z0, x1, z1] of pts) {
      const [qx, qz] = closestOnSegment(px, pz, x0, z0, x1, z1);
      if ((px - qx) ** 2 + (pz - qz) ** 2 < r * r) return true;
    }
    return false;
  }
  // box:轉進本地座標做 slab 測試
  const toL = (px, pz) => {
    const dx = px - s.x, dz = pz - s.z;
    return [dx * s.c - dz * s.s, dx * s.s + dz * s.c];
  };
  const [lax, laz] = toL(ax, az);
  const [lbx, lbz] = toL(bx, bz);
  const hx = s.hx * k, hz = s.hz * k;
  let t0 = 0, t1 = 1;
  for (const [a, d, h] of [[lax, lbx - lax, hx], [laz, lbz - laz, hz]]) {
    if (Math.abs(d) < 1e-9) {
      if (a < -h || a > h) return false;
      continue;
    }
    let ta = (-h - a) / d, tb = (h - a) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const cross = (ox, oz, px, pz, qx, qz) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export class Collision {
  constructor() {
    this.statics = []; // 所有形狀共有 { kind, x, z, r(外接半徑), blocksBullets, blocksSight }
    this.zones = []; // 帶狀/區域禁區(溪流、湖):{ contact(x, z, r) → { pen, nx, nz } | null }
    this._grid = new Map();
    this._stamp = 0;
  }

  // ---------------------------------------------------------------- 登記

  // blocksBullets=false 的物件(柵欄、矮石)只擋移動,子彈飛得過去。
  // 視線預設跟著子彈走:擋子彈的實心物(石頭、樹、房子)同時擋視線。
  addStatic(x, z, r, opts) {
    return this._add({ kind: "circle", x, z, r }, opts);
  }

  // 從 (ax,az) 到 (bx,bz)、半徑 r 的膠囊
  addCapsule(ax, az, bx, bz, r, opts) {
    const len = Math.hypot(bx - ax, bz - az) || 1e-6;
    return this._add({
      kind: "capsule", ax, az, bx, bz,
      ux: (bx - ax) / len, uz: (bz - az) / len,
      r,
      x: (ax + bx) / 2, z: (az + bz) / 2, bound: len / 2 + r,
    }, opts);
  }

  // 中心 (x,z)、轉角 ry、半長 hx / 半寬 hz 的方盒(本地 x 軸 = 模型 x 軸)
  addBox(x, z, ry, hx, hz, opts) {
    return this._add({
      kind: "box", x, z, hx, hz, c: Math.cos(ry), s: Math.sin(ry),
      bound: Math.hypot(hx, hz),
    }, opts);
  }

  // 溝壑:沿 points 的帶狀禁區,半寬 halfWidth(畫面上深色的部分)。
  // openings:[{ x, z, ux, uz, halfLen, halfWidth }] —— 橋面,沿 (ux,uz) 方向通行,
  // halfWidth 是欄杆內側到橋中線的距離。擋移動,不擋子彈與視線。
  addRavine(points, halfWidth, openings = []) {
    const rv = { points, halfWidth, openings };
    this.zones.push({ contact: (x, z, r) => this._ravineContact(rv, x, z, r) });
  }

  // 任意形狀的禁區(湖):sdf(x, z) = 到岸線的有號距離,水裡為負。
  // 整個身體都要留在岸上(sdf ≥ r)。bounds 之外直接略過,省下雜訊計算。
  // 擋移動,不擋子彈與視線。
  addArea(sdf, bounds) {
    this.zones.push({
      contact: (x, z, r) => {
        if (bounds && (x < bounds.x0 - r || x > bounds.x1 + r || z < bounds.z0 - r || z > bounds.z1 + r)) return null;
        const d = sdf(x, z);
        if (d >= r) return null;
        const e = 0.05;
        const gx = sdf(x + e, z) - sdf(x - e, z);
        const gz = sdf(x, z + e) - sdf(x, z - e);
        const L = Math.hypot(gx, gz) || 1;
        return { pen: r - d, nx: gx / L, nz: gz / L };
      },
    });
  }

  _add(s, { blocksBullets = true, blocksSight = blocksBullets } = {}) {
    s.blocksBullets = blocksBullets;
    s.blocksSight = blocksSight;
    if (s.bound === undefined) s.bound = s.r;
    this.statics.push(s);
    const b = s.bound;
    for (let gx = Math.floor((s.x - b) / CELL); gx <= Math.floor((s.x + b) / CELL); gx++) {
      for (let gz = Math.floor((s.z - b) / CELL); gz <= Math.floor((s.z + b) / CELL); gz++) {
        const key = gx * 4096 + gz;
        let list = this._grid.get(key);
        if (!list) this._grid.set(key, (list = []));
        list.push(s);
      }
    }
    return s;
  }

  // 半徑 rad 內可能碰到的靜態物(空間雜湊,不重複)
  _near(x, z, rad) {
    const out = [];
    const stamp = ++this._stamp;
    for (let gx = Math.floor((x - rad) / CELL); gx <= Math.floor((x + rad) / CELL); gx++) {
      for (let gz = Math.floor((z - rad) / CELL); gz <= Math.floor((z + rad) / CELL); gz++) {
        const list = this._grid.get(gx * 4096 + gz);
        if (!list) continue;
        for (const s of list) {
          if (s._stamp === stamp) continue;
          s._stamp = stamp;
          out.push(s);
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 溝壑

  // 溝壑對半徑 r 的圓的接觸:回傳穿透量(>0 表示不合法)與推出方向
  _ravineContact(rv, x, z, r) {
    const forbid = rv.halfWidth + r; // 整個身體都要留在岸上
    let best = Infinity, bx = 0, bz = 0;
    const pts = rv.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [qx, qz] = closestOnSegment(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      const d = Math.hypot(x - qx, z - qz);
      if (d < best) { best = d; bx = qx; bz = qz; }
    }
    if (best >= forbid) return null;

    // 候選一:往溝外推到邊緣
    let pen = forbid - best;
    let nx, nz;
    if (best > 1e-6) { nx = (x - bx) / best; nz = (z - bz) / best; } else { nx = 1; nz = 0; }

    for (const o of rv.openings) {
      const dx = x - o.x, dz = z - o.z;
      const along = dx * o.ux + dz * o.uz;
      if (Math.abs(along) > o.halfLen) continue;
      const lat = -dx * o.uz + dz * o.ux;      // 橫向(左正)
      const room = o.halfWidth - r;            // 圓心可到的最大橫向距離
      const over = Math.abs(lat) - room;
      if (over <= 0) return null;              // 在橋面上,合法
      // 候選二:往橋中線推回橋面(欄杆)
      if (over < pen) {
        pen = over;
        const sgn = lat > 0 ? -1 : 1;
        nx = -o.uz * sgn;
        nz = o.ux * sgn;
      }
    }
    return { pen, nx, nz };
  }

  // ---------------------------------------------------------------- 解算

  // 身體在 pos 時各個取樣圓的圓心
  static _samples(body) {
    return body.half > 0 ? [-body.half, 0, body.half] : [0];
  }

  static _body(b) {
    return typeof b === "number" ? { r: b, half: 0, fx: 0, fz: 1 } : b;
  }

  // 身體在 (x,z) 的最大穿透量(0 = 合法位置)
  penetration(x, z, b) {
    const body = Collision._body(b);
    const r = body.r;
    let worst = 0;
    for (const o of Collision._samples(body)) {
      const px = x + body.fx * o, pz = z + body.fz * o;
      for (const s of this._near(px, pz, r)) {
        const pen = r - contact(s, px, pz).d;
        if (pen > worst) worst = pen;
      }
      for (const zn of this.zones) {
        const c = zn.contact(px, pz, r);
        if (c && c.pen > worst) worst = c.pen;
      }
    }
    return worst;
  }

  // 把 pos(就地修改)推出所有障礙與世界邊界,回傳是否已經完全合法。
  //
  // 舊版每輪只解「最深」的一個,夾在兩顆石頭之間時 A 推進 B、B 推回 A,
  // 8 輪後常常還卡在裡面。現在每輪把所有接觸都投影出去(Gauss-Seidel),
  // 夾縫會收斂到兩者都不重疊的那一點;真的解不開時回傳 false,
  // 由呼叫端退回上一個合法位置(見 move)。
  resolveCircle(pos, b) {
    const body = Collision._body(b);
    const r = body.r;
    const samples = Collision._samples(body);
    const EPS = 1e-3;
    for (let iter = 0; iter < 16; iter++) {
      let maxPen = 0;
      for (const o of samples) {
        for (const s of this._near(pos.x + body.fx * o, pos.z + body.fz * o, r + 0.5)) {
          const c = contact(s, pos.x + body.fx * o, pos.z + body.fz * o);
          const pen = r - c.d;
          if (pen > EPS) {
            pos.x += c.nx * pen;
            pos.z += c.nz * pen;
            if (pen > maxPen) maxPen = pen;
          }
        }
        for (const zn of this.zones) {
          const c = zn.contact(pos.x + body.fx * o, pos.z + body.fz * o, r);
          if (c && c.pen > EPS) {
            pos.x += c.nx * c.pen;
            pos.z += c.nz * c.pen;
            if (c.pen > maxPen) maxPen = c.pen;
          }
        }
      }
      // 邊界也是約束之一,放在迴圈裡才不會「夾回界內又被推進石頭」
      pos.x = Math.max(-BOUND, Math.min(BOUND, pos.x));
      pos.z = Math.max(-BOUND, Math.min(BOUND, pos.z));
      if (maxPen <= EPS) return true;
    }
    return this.penetration(pos.x, pos.z, body) <= 0.02;
  }

  // 角色移動的唯一入口:從合法位置 pos 移動 (dx,dz)。
  //  1. 位移大時切成小步,薄的柵欄/欄杆不會被一步跨過去(擊退 1.2 公尺也安全)
  //  2. 每一小步先試整段位移;解不開就只試 x 或只試 z(貼牆滑動);
  //     都不行就原地不動 —— 角色永遠不會停在障礙物裡。
  move(pos, dx, dz, b) {
    const body = Collision._body(b);
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (body.r * 0.5)));
    const sx = dx / steps, sz = dz / steps;
    const cand = { x: 0, z: 0 };
    for (let i = 0; i < steps; i++) {
      let moved = false;
      for (const [mx, mz] of [[sx, sz], [sx, 0], [0, sz]]) {
        if (!mx && !mz) continue;
        cand.x = pos.x + mx;
        cand.z = pos.z + mz;
        if (this.resolveCircle(cand, body)) {
          pos.x = cand.x;
          pos.z = cand.z;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return pos;
  }

  // 原地轉身:長條的身體轉向牆壁時,頭尾可能插進牆裡。
  // 先把身體推出來;推不出來(夾在窄縫裡)就不准轉,回傳 false。
  turn(pos, body) {
    const cand = { x: pos.x, z: pos.z };
    if (!this.resolveCircle(cand, body)) return false;
    pos.x = cand.x;
    pos.z = cand.z;
    return true;
  }

  // ---------------------------------------------------------------- 查詢

  // 線段 a→b 是否被任何擋視線的靜態物切過(敵人感知用)。
  // 形狀縮 0.85 倍:擦過邊緣不算遮蔽,免得敵人在掩體邊緣忽明忽暗。
  sightBlocked(ax, az, bx, bz) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const rad = Math.hypot(bx - ax, bz - az) / 2 + 1;
    for (const s of this._near(mx, mz, rad)) {
      if (!s.blocksSight) continue;
      if (segmentHits(s, ax, az, bx, bz, 0.85)) return true;
    }
    return false;
  }

  // 子彈打到靜態物?(只算 blocksBullets 的;溝壑不擋子彈)
  hitStatic(x, z, r = 0) {
    for (const s of this._near(x, z, r)) {
      if (s.blocksBullets && contact(s, x, z).d < r) return true;
    }
    return false;
  }

  // 點是否可放置(生成用,檢查所有靜態物與溝壑)
  isFree(x, z, r) {
    return this.penetration(x, z, r) <= 0;
  }

  // 兩兩推開(敵人之間)
  separatePair(a, b, factor = 0.8) {
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6) return;
    const wanted = (a.hitR + b.hitR) * factor;
    if (d2 >= wanted * wanted) return;
    const d = Math.sqrt(d2);
    const push = (wanted - d) * 0.5 / d;
    a.pos.x -= dx * push; a.pos.z -= dz * push;
    b.pos.x += dx * push; b.pos.z += dz * push;
  }

  // 把 b 從 a 推開到最小距離(敵人 vs 玩家)
  pushAway(aPos, b, minDist, strength = 0.55) {
    const dx = b.pos.x - aPos.x;
    const dz = b.pos.z - aPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6 || d2 >= minDist * minDist) return;
    const d = Math.sqrt(d2);
    const push = ((minDist - d) * strength) / d;
    b.pos.x += dx * push;
    b.pos.z += dz * push;
  }
}
