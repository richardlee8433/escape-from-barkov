// 極簡測試骨架。結果同時寫進 DOM 與 window.__results，方便瀏覽器自動化讀取。
const results = [];
let current = null;

export function suite(name) {
  current = name;
}

export function check(desc, fn) {
  let ok = false;
  let detail = "";
  try {
    const r = fn();
    ok = r === true || r === undefined;
    if (!ok) detail = String(r);
  } catch (e) {
    detail = e && e.stack ? e.stack.split("\n")[0] : String(e);
  }
  results.push({ suite: current, desc, ok, detail });
}

export function eq(actual, expected, tol = 0) {
  const pass = typeof expected === "number"
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  return pass ? true : `expected ${expected}, got ${actual}`;
}

// 固定亂數：讓用到 Math.random 的建構子行為可重現
export function deterministic(fn, value = 0.5) {
  const real = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

export function report() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  window.__results = { pass, fail, results };

  const root = document.getElementById("out");
  let last = null;
  for (const r of results) {
    if (r.suite !== last) {
      last = r.suite;
      const h = document.createElement("h3");
      h.textContent = r.suite;
      root.appendChild(h);
    }
    const d = document.createElement("div");
    d.className = r.ok ? "ok" : "fail";
    d.textContent = `${r.ok ? "PASS" : "FAIL"}  ${r.desc}${r.detail ? " — " + r.detail : ""}`;
    root.appendChild(d);
  }
  const s = document.createElement("h2");
  s.className = fail ? "fail" : "ok";
  s.textContent = `${pass} passed, ${fail} failed`;
  root.prepend(s);
  document.title = fail ? `FAIL (${fail})` : `PASS (${pass})`;
}
