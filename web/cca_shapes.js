// CCA Generator: 切り取る・抜く形(画像編集の「切り取る(範囲・形)」と、動画編集の「図形マスク」で共通)
// 書き出し(videoedit.py の shape_pts / shape_mask)と同じ形・同じぼかし方にする
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// [値, 画面に出す名前]
export const SHAPES = [["rect", "四角"], ["rrect", "角丸の四角"], ["ellipse", "丸"], ["tri", "三角"], ["diamond", "ひし形"], ["pent", "五角形"],
  ["hex", "六角形"], ["oct", "八角形"], ["rtri", "正三角形"], ["rpent", "正五角形"], ["rhex", "正六角形"], ["roct", "正八角形"], ["star", "星"], ["spark", "きらめき"], ["heart", "ハート"], ["flower", "花"], ["drop", "しずく"], ["bubble", "吹き出し"],
  ["tile", "タイル"], ["dots", "水玉"]];
export const SHAPE_KEYS = new Set(SHAPES.map(([v]) => v));
// 正多角形(辺の長さと角がそろう。縦横を同じ割合で広げる)→ もとの形
const REGULAR = { rtri: "tri", rpent: "pent", rhex: "hex", roct: "oct" };
// 真ん中(0, 0)のまわりに作る形。c.center のときは、この真ん中を箱の真ん中に置く(回すと図形の真ん中で回る)
const CENTERED = new Set(["tri", "pent", "hex", "oct", "star", "flower", "spark", "diamond"]);

// 並べる形(タイル・水玉)。箱いっぱいに同じ形を並べる。
// pitch = 並べる間かく(箱の短い辺に対して)、gap = すき間(間かくに対して)、odd / even = 奇数列・偶数列の大きさ(倍)、
// rodd / reven = 奇数行・偶数行の大きさ(倍。列の倍率に掛ける)、stagger = 一行おきに半分ずらす、round = タイルの角の丸み。
// alt = "check" は市松(列 + 行が奇数か偶数かで odd / even。行の倍率は使わない)。第40版の alt = "row"(行で交互)は、行の倍率として読む
export const PATTERNS = new Set(["tile", "dots"]);
export function rulesHtml(rules, input, del, add, tr = (x) => x) {
  const R = Array.isArray(rules) ? rules : [];
  const row = (r, i) => `<div class="prule" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:12px;margin:4px 0">
    ${tr("段")} ${input(i, 0, r[0] ?? 1, 46)} ${tr("番目から")} ${input(i, 1, r[1] ?? 1, 46)} ${tr("段おき")}・${tr("横")} ${input(i, 2, r[2] ?? 1, 46)} ${tr("番目から")}
    ${input(i, 3, r[3] ?? 1, 46)} ${tr("つおき")}・${tr("大きさ")} ${input(i, 4, Math.round((r[4] ?? 1) * 100), 56)}% ${del(i)}</div>`;
  return `<div class="prules" style="margin-top:6px"><div style="font-size:12px;opacity:.85">${tr("大きさを変える条件")}</div>${R.map(row).join("")}<div class="row" style="margin-top:4px">${add}</div></div>`;
}
// 条件の 1 つの値を変える(f: 0 = 段の何番目・1 = 段おき・2 = 横の何番目・3 = 横おき・4 = 大きさ %)
export function setRule(rules, i, f, value) {
  const R = (Array.isArray(rules) ? rules : []).map((r) => [...r]);
  if (!R[i]) return R;
  const n = Number(value);
  if (!Number.isFinite(n)) return R;
  R[i][f] = f === 4 ? clamp(n, 0, 300) / 100 : f === 0 || f === 2 ? Math.max(1, Math.round(n)) : Math.max(0, Math.round(n));
  return R;
}
// 条件を足す(前の条件の段と横を 1 つずらす。1 つ目は「1 番目から 1 段おき・1 番目から 1 つおき・50%」= 2 つ足すと市松)/ 消す
export function addRule(rules) {
  const R = (Array.isArray(rules) ? rules : []).map((r) => [...r]), last = R.at(-1);
  R.push(last ? [last[0] + 1, last[1], last[2] + 1, last[3], last[4]] : [1, 1, 1, 1, 0.5]);
  return R;
}
// rules = [[w, x, y, z, 大きさ], …]: 上から w 番目の段から x 段おき、その段の左から y 番目から z つおきの物の大きさ(倍)。後の条件が優先
export const PAT_DEF = { pitch: 0.25, gap: 0.15, odd: 1, even: 1, rodd: 1, reven: 1, stagger: false, round: 0, alt: "col", rules: [] };
export const PAT_KEYS = Object.keys(PAT_DEF);
const numv = (v, d) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const patPitch = (c) => Math.max(2, clamp(numv(c.pitch, PAT_DEF.pitch), 0.02, 1) * Math.min(c.w, c.h));
const patBase = (c) => patPitch(c) * (1 - clamp(numv(c.gap, PAT_DEF.gap), -1, 0.95)); // すき間がマイナスなら、間隔より大きく(重なる)
// 並べる 1 つずつの [真ん中 x, 真ん中 y, 大きさ]。並びは箱の真ん中にそろえ、はしで欠ける分も入れる(箱の外は描く先で切れる)。
// 列 q・行 r は、箱の左上のあたりを 0 番(1 番目 = 奇数番目)として数える
export function patternItems(c) {
  const p = patPitch(c), base = patBase(c);
  let so = clamp(numv(c.odd, 1), 0, 2), se = clamp(numv(c.even, 1), 0, 2), ro = clamp(numv(c.rodd, 1), 0, 2), re = clamp(numv(c.reven, 1), 0, 2);
  const rules = (Array.isArray(c.rules) ? c.rules : []).filter(Array.isArray).map((R) => [Math.round(numv(R[0], 1)) - 1, Math.max(0, Math.round(numv(R[1], 0))) + 1,
    Math.round(numv(R[2], 1)) - 1, Math.max(0, Math.round(numv(R[3], 0))) + 1, clamp(numv(R[4], 1), 0, 3)]);
  const md = (a, n) => ((a % n) + n) % n;
  if (c.alt === "row" && c.rodd == null && c.reven == null) { ro = so; re = se; so = se = 1; }
  const nq = Math.max(1, Math.round(c.w / p)), nr = Math.max(1, Math.round(c.h / p));
  const mx = c.x + c.w / 2, my = c.y + c.h / 2, out = [];
  for (let r = -2; r <= nr + 1; r++) { // 大きいとはしの外の物も入るので、1 つ外まで
    const y = my + (r - (nr - 1) / 2) * p, sx = c.stagger && r & 1 ? p / 2 : 0;
    for (let q = -3; q <= nq + 1; q++) {
      const x = mx + (q - (nq - 1) / 2) * p + sx;
      let s = c.alt === "check" ? base * ((q + r) & 1 ? se : so) : base * (q & 1 ? se : so) * (r & 1 ? re : ro);
      for (const [r0, rs, q0, qs, k] of rules) if (md(r - r0, rs) === 0 && md(q - q0, qs) === 0) s = base * k;
      if (s < 0.5 || x + s / 2 <= c.x || x - s / 2 >= c.x + c.w || y + s / 2 <= c.y || y - s / 2 >= c.y + c.h) continue;
      out.push([x, y, s]);
    }
  }
  return out;
}
// ぼかす幅の元にする長さ(並べる形は 1 つの大きさ、ほかは箱の短い辺)
export const featherBase = (c) => (PATTERNS.has(c.shape) ? patBase(c) : Math.min(c.w, c.h));

// 正多角形(星は inner > 0 で、へこんだ角を交互に)
function polyRing(n, a0, inner = 0) {
  const m = inner ? n * 2 : n;
  return Array.from({ length: m }, (_, i) => { const a = a0 + (i * Math.PI * 2) / m, r = inner && i % 2 ? inner : 1; return [Math.cos(a) * r, Math.sin(a) * r]; });
}
// 角を丸めた四角の点(右回り。右上の角から)。tail は下の辺の途中に入れる点(吹き出しの口)
function rrectPts(x0, y0, x1, y1, r, tail = null) {
  const pts = [], arc = (cx, cy, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + (i / 8) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arc(x1 - r, y0 + r, -Math.PI / 2);
  arc(x1 - r, y1 - r, 0);
  if (tail) pts.push(...tail);
  arc(x0 + r, y1 - r, Math.PI / 2);
  arc(x0 + r, y0 + r, Math.PI);
  return pts;
}
// 形の点を、真ん中 (0, 0)・幅と高さ 1 の箱いっぱいに広げる(四角・角丸・丸は線で描くので点は使わない)
const ptsCache = new Map(), rawCache = new Map();
export function shapePts(shape, points) {
  const key = `${shape}|${points ?? 5}`;
  if (ptsCache.has(key)) return ptsCache.get(key);
  let pts = rawPts(shape, points);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  pts = pts.map(([x, y]) => [(x - x0) / (x1 - x0) - 0.5, (y - y0) / (y1 - y0) - 0.5]);
  ptsCache.set(key, pts);
  return pts;
}
// 生の点(多角形・星・花・きらめき・ひし形は真ん中 0, 0 のまわり)
function rawPts(shape, points) {
  shape = REGULAR[shape] || shape;
  const key = `${shape}|${points ?? 5}`;
  if (rawCache.has(key)) return rawCache.get(key);
  const N = 240, samp = (fn) => Array.from({ length: N }, (_, i) => fn((i / N) * Math.PI * 2));
  const pw = (v, p) => Math.sign(v) * Math.abs(v) ** p;
  let pts;
  if (shape === "tri") pts = polyRing(3, -Math.PI / 2);
  else if (shape === "diamond") pts = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  else if (shape === "pent") pts = polyRing(5, -Math.PI / 2);
  else if (shape === "hex") pts = polyRing(6, 0);
  else if (shape === "oct") pts = polyRing(8, Math.PI / 8);
  else if (shape === "star") { const n = clamp(Math.round(points ?? 5), 3, 12); pts = polyRing(n, -Math.PI / 2, clamp(0.27 + n * 0.03, 0.3, 0.65)); }
  else if (shape === "spark") pts = samp((t) => [pw(Math.cos(t), 3), pw(Math.sin(t), 3)]);
  else if (shape === "heart") pts = samp((t) => [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  else if (shape === "flower") pts = samp((t) => { const r = 0.6 + 0.4 * Math.abs(Math.cos(3 * t)); return [Math.cos(t - Math.PI / 2) * r, Math.sin(t - Math.PI / 2) * r]; });
  else if (shape === "drop") pts = samp((t) => [Math.sin(t) * Math.sin(t / 2), -Math.cos(t)]);
  else if (shape === "bubble") pts = rrectPts(-1, -1, 1, 0.5, 0.3, [[-0.1, 0.5], [-0.62, 1.05], [-0.42, 0.5]]);
  else pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  rawCache.set(key, pts);
  return pts;
}
// 箱(x, y, w, h)に置いた形の点。正多角形と c.uniform は縦横を同じ割合で広げる(箱に収める)。
// c.center のときは、形の真ん中(多角形・星などの中心)を箱の真ん中に置く(回すと図形の真ん中で回る)
export function placePts(c) {
  const { x, y, w, h } = c, cx = x + w / 2, cy = y + h / 2, base = REGULAR[c.shape] || c.shape;
  const uni = !!REGULAR[c.shape] || !!c.uniform, center = !!c.center && CENTERED.has(base);
  if (!uni && !center) return shapePts(base, c.points).map(([px, py]) => [cx + px * w, cy + py * h]);
  const raw = rawPts(base, c.points);
  if (center) {
    let ax = 1e-9, ay = 1e-9;
    for (const [px, py] of raw) { ax = Math.max(ax, Math.abs(px)); ay = Math.max(ay, Math.abs(py)); }
    let kx = w / 2 / ax, ky = h / 2 / ay;
    if (uni) kx = ky = Math.min(kx, ky);
    return raw.map(([px, py]) => [cx + px * kx, cy + py * ky]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of raw) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  const k = Math.min(w / (x1 - x0), h / (y1 - y0)), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return raw.map(([px, py]) => [cx + (px - mx) * k, cy + (py - my) * k]);
}
// 形の線。c = { x, y, w, h(箱), shape, radius(角丸: 短い辺の半分に対して 0〜1), points(星の角の数), 並べる形の pitch など(PAT_DEF) }
export function shapePath(g, c) {
  const { x, y, w, h } = c, cx = x + w / 2, cy = y + h / 2, s = c.shape || "rect";
  g.beginPath();
  if (s === "rect") g.rect(x, y, w, h);
  else if (s === "rrect") { const r = (clamp(Number(c.radius ?? 0.25), 0, 1) * Math.min(w, h)) / 2; if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  else if (s === "ellipse") g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (s === "path") tracePath(g, decodePath(c.pts, x, y, w, h), c.closed !== false);
  else if (PATTERNS.has(s)) {
    // itemK / itemRot: 1 つずつの伸び縮み(倍)・回転(度。タイルだけ)。動画編集の図形マスクの動き
    const rr = clamp(numv(c.round, 0), 0, 1), ik = clamp(numv(c.itemK, 1), 0, 10), ia = (numv(c.itemRot, 0) * Math.PI) / 180;
    for (const [px, py, sz0] of patternItems(c)) {
      const sz = sz0 * ik, h2 = sz / 2;
      if (sz < 0.5) continue;
      if (s === "dots") { g.moveTo(px + h2, py); g.arc(px, py, h2, 0, Math.PI * 2); continue; }
      g.save(); // 点の座標はその時の変換で入るので、回した四角を足してから元に戻す
      g.translate(px, py);
      if (ia) g.rotate(ia);
      if (rr > 0 && g.roundRect) g.roundRect(-h2, -h2, sz, sz, rr * h2); else g.rect(-h2, -h2, sz, sz);
      g.restore();
    }
  }
  else { placePts(c).forEach(([px, py], i) => { if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); }
}
// 箱ぼかし(はしはそのまま延ばす)
function boxBlur(a, w, h, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  const pass = (src, dst, n, m, stride, step) => {
    for (let l = 0; l < m; l++) {
      const base = l * step;
      let s = 0;
      for (let i = -r; i <= r; i++) s += src[base + Math.min(n - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < n; i++) {
        dst[base + i * stride] = s / (2 * r + 1);
        s += src[base + Math.min(n - 1, i + r + 1) * stride] - src[base + Math.max(0, i - r) * stride];
      }
    }
  };
  pass(a, t, w, h, 1, w);
  pass(t, o, h, w, w, 1);
  return o;
}
// 形の板(w × h の canvas。白・透明度が形)。feather = ぼかす幅(短い辺に対しての割合。並べる形は 1 つの大きさに対しての割合)。
// ぼかし: 標準偏差 f/2 でぼかしてから、0.5 → 0・0.977 → 1 に広げる(ふちで 0、内側へ幅 f でほぼ 1。外へははみ出さない)
const BLUR_EDGE = 0.4772;
export function shapeMaskCanvas(sh, w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const f = clamp(Number(sh.feather) || 0, 0, 0.5) * featherBase({ ...sh, w, h });
  const sd = f / 2, pad = f >= 1 ? Math.ceil(sd * 3) + 2 : 0;
  const cw = w + pad * 2, ch = h + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = cw; cv.height = ch;
  const g = cv.getContext("2d", { willReadFrequently: true });
  shapePath(g, { ...sh, x: pad, y: pad, w, h });
  g.fillStyle = "#fff";
  g.fill();
  if (pad) {
    const img = g.getImageData(0, 0, cw, ch), d = img.data;
    let a = new Float32Array(cw * ch);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    const r = Math.max(1, Math.round(sd - 0.5));
    for (let i = 0; i < 3; i++) a = boxBlur(a, cw, ch, r);
    for (let i = 0; i < a.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(clamp((a[i] - 0.5) / BLUR_EDGE, 0, 1) * 255); }
    g.putImageData(img, 0, 0);
  }
  if (!pad) return cv;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").drawImage(cv, -pad, -pad);
  return out;
}

// ---------------------------------------------------------------- 動画編集の「図形マスク」
// mask = { shape, fit("square" | "fill"), size, x, y, rot, radius, points, feather, spin("" | "spin" | "swing"), spinSpeed, swing, pulse("" | "pulse"), pulseSpeed, pulseAmt }
export const MASK_DEF = { fit: "square", size: 1, x: 0, y: 0, rot: 0, radius: 0.25, points: 5, feather: 0, spinSpeed: 0.25, swing: 20, pulseSpeed: 0.5, pulseAmt: 0.2, ...PAT_DEF };
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
// 物の中の時刻 t(秒)での、形の箱(物の w × h の中。真ん中・幅・高さ・回転(度))
export function maskBox(mk, w, h, t) {
  const size = clamp(num(mk.size, 1), 0.05, 3);
  let bw = mk.fit === "fill" ? w * size : Math.min(w, h) * size, bh = mk.fit === "fill" ? h * size : bw;
  let ang = num(mk.rot, 0);
  const sp = num(mk.spinSpeed, MASK_DEF.spinSpeed);
  if (mk.spin === "spin") ang += 360 * sp * t;
  else if (mk.spin === "swing") ang += clamp(num(mk.swing, MASK_DEF.swing), 0, 180) * Math.sin(2 * Math.PI * sp * t);
  let k = 1;
  if (mk.pulse === "pulse") k = Math.max(0.01, 1 + clamp(num(mk.pulseAmt, MASK_DEF.pulseAmt), 0, 0.9) * Math.sin(2 * Math.PI * num(mk.pulseSpeed, MASK_DEF.pulseSpeed) * t));
  const cx = w / 2 + clamp(num(mk.x, 0), -1, 1) * w, cy = h / 2 + clamp(num(mk.y, 0), -1, 1) * h;
  if (PATTERNS.has(mk.shape)) return { cx, cy, bw, bh, ang: 0, itemRot: ang, itemK: k };
  return { cx, cy, bw: bw * k, bh: bh * k, ang, itemRot: 0, itemK: 1 };
}
// 形の板は、形・ぼかす幅・縦横比・大きさ(128 px ごと)が同じ間は作り直さない
const maskCache = new Map();
function baseMask(mk, bw, bh, b = {}) {
  const asp = Math.round((bw / Math.max(1e-6, bh)) * 100) / 100, L = Math.min(1024, Math.max(64, Math.ceil(Math.max(bw, bh) / 128) * 128));
  const w = asp >= 1 ? L : Math.max(1, Math.round(L * asp)), h = asp >= 1 ? Math.max(1, Math.round(L / asp)) : L;
  const ir = Math.round(num(b.itemRot, 0) * 10) / 10, ik = Math.round(num(b.itemK, 1) * 1000) / 1000;
  const key = JSON.stringify([mk.shape, mk.radius, mk.points, mk.feather, mk.fit, mk.pts, mk.closed, ...PAT_KEYS.map((k) => mk[k]), w, h, ir, ik]);
  let cv = maskCache.get(key);
  if (!cv) {
    cv = shapeMaskCanvas({ ...mk, itemRot: ir, itemK: ik, center: true, uniform: mk.fit !== "fill" }, w, h);
    maskCache.set(key, cv);
    if (maskCache.size > 24) maskCache.delete(maskCache.keys().next().value);
  }
  return cv;
}
// cv(物の絵が入った canvas)を、時刻 t の図形マスク。外は透明
const maskFull = document.createElement("canvas");
export function applyShapeMask(cv, mk, t) {
  if (!mk || !(SHAPE_KEYS.has(mk.shape) || (mk.shape === "path" && mk.pts?.length > 2))) return;
  const w = cv.width, h = cv.height, b = maskBox(mk, w, h, t);
  if (b.bw < 0.5 || b.bh < 0.5) { cv.getContext("2d").clearRect(0, 0, w, h); return; }
  if (maskFull.width !== w || maskFull.height !== h) { maskFull.width = w; maskFull.height = h; }
  const mg = maskFull.getContext("2d");
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.clearRect(0, 0, w, h);
  mg.translate(b.cx, b.cy);
  mg.rotate((b.ang * Math.PI) / 180);
  mg.drawImage(baseMask(mk, b.bw, b.bh, b), -b.bw / 2, -b.bh / 2, b.bw, b.bh);
  const g = cv.getContext("2d");
  g.save();
  g.globalCompositeOperation = mk.invert ? "destination-out" : "destination-in"; // invert: 形の中を消す
  g.drawImage(maskFull, 0, 0);
  g.restore();
}

// ---------------------------------------------------------------- パス(図形のレイヤー)
// 点は枠の中の割合 [x, y, 入るハンドル x, y, 出るハンドル x, y](ハンドルも割合。無ければ null)。書き出しの path_points と同じ
export function decodePath(pts, x0, y0, w, h) {
  return (pts || []).map((q) => {
    const o = { x: x0 + q[0] * w, y: y0 + q[1] * h };
    if (q[2] != null) o.hi = [q[2] * w, q[3] * h];
    if (q[4] != null) o.ho = [q[4] * w, q[5] * h];
    return o;
  });
}
// 点の並び P({ x, y, hi?, ho? })をつなぐ線。ハンドルがある所は曲線、無い所は直線
export function tracePath(g, P, closed) {
  g.beginPath();
  const n = P.length;
  if (!n) return;
  g.moveTo(P[0].x, P[0].y);
  const seg = (a, b) => {
    if (a.ho || b.hi) g.bezierCurveTo(a.x + (a.ho?.[0] || 0), a.y + (a.ho?.[1] || 0), b.x + (b.hi?.[0] || 0), b.y + (b.hi?.[1] || 0), b.x, b.y);
    else g.lineTo(b.x, b.y);
  };
  for (let i = 1; i < n; i++) seg(P[i - 1], P[i]);
  if (closed && n > 1) { seg(P[n - 1], P[0]); g.closePath(); }
}
// 点を曲線にする(前後の点を結ぶ向きのハンドル。長さは近い方の点までの 1/3)/ 角に戻す
export function toggleCurvePoint(P, i, closed) {
  const q = P[i], n = P.length;
  if (q.hi || q.ho) { delete q.hi; delete q.ho; return; }
  const prev = P[i - 1] || (closed ? P[n - 1] : null), next = P[i + 1] || (closed ? P[0] : null);
  const [dx, dy] = prev && next ? [next.x - prev.x, next.y - prev.y] : next ? [next.x - q.x, next.y - q.y] : prev ? [q.x - prev.x, q.y - prev.y] : [1, 0];
  const len = Math.hypot(dx, dy) || 1;
  const dist = Math.min(prev ? Math.hypot(q.x - prev.x, q.y - prev.y) : Infinity, next ? Math.hypot(next.x - q.x, next.y - q.y) : Infinity);
  const L = (Number.isFinite(dist) ? dist : 120) / 3;
  q.ho = [Math.round((dx / len) * L * 10) / 10, Math.round((dy / len) * L * 10) / 10];
  q.hi = [-q.ho[0], -q.ho[1]];
}

// ---------------------------------------------------------------- ふち取り(不透明な所のまわりに付ける縁)
// 書き出し(videoedit.py の outline_alpha)と同じ作り方: 透明度 0.5 以上の所(物)からの距離が太さ t までを縁にし(外のふちは 1px でなめらかに)、
// 物の内側(まわり 8 つも物の所)には付けない。物のふちの画素の下には敷くので、縁との間にすき間ができず、半透明の物の中に色も透けない。
// ぼかすときは縁だけをぼかす
const FAR = 1e20;
// 2 乗した距離の 1 列分(f: 0 = 物の所、FAR = 外。距離は wg 倍)。放物線の下側をたどる方法
function edtPass(f, n, off, stride, d, v, z, wg = 1) {
  let k = 0;
  v[0] = 0; z[0] = -FAR; z[1] = FAR;
  for (let q = 1; q < n; q++) {
    const fq = f[off + q * stride] + wg * q * q;
    let s;
    for (;;) {
      const p = v[k];
      s = (fq - (f[off + p * stride] + wg * p * p)) / (2 * wg * (q - p));
      if (s > z[k] || k === 0) break;
      k--;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = wg * dq * dq + f[off + v[k] * stride];
  }
  for (let q = 0; q < n; q++) f[off + q * stride] = d[q];
}
// wx・wy: 横・縦の距離の重み(楕円の距離にする)
function edt2(f, W, H, wx = 1, wy = 1) {
  const n = Math.max(W, H), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) edtPass(f, H, x, W, d, v, z, wy);
  for (let y = 0; y < H; y++) edtPass(f, W, y * W, 1, d, v, z, wx);
}
// ふち取りの太さ(上・下・左・右)。第40版の w(上下左右まとめて)も読む。scale を掛け、max までに収める
export function outlineSides(ol, scale = 1, max = Infinity) {
  const w = Number(ol?.w ?? 0) || 0;
  const g = (k) => clamp((Number(ol?.[k] ?? w) || 0) * scale, 0, max);
  return { t: g("t"), b: g("b"), l: g("l"), r: g("r") };
}
const hexRgb = (hex) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "") || [0, "ff", "ff", "ff"]; return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]; };
// src(canvas)の不透明な所のまわりの縁。t(太さ。数 = 上下左右同じ / { t, b, l, r } = 上・下・左・右)・blur(ぼかし)は src の px。
// 上下左右が違うときは、横の半径 (左 + 右) / 2・縦の半径 (上 + 下) / 2 の楕円を、((右 - 左) / 2, (下 - 上) / 2) ずらして広げる(1 点なら、ちょうど上下左右の太さになる)。
// edgeF > 0 なら、先に src のふち edgeF px を透明にぼかしたものとして作る(動画編集の「ふちを透明にぼかす」)。
// 戻り値: { cv(縁だけの canvas。src より上下左右 pad ずつ大きい), pad }。縁が無ければ null
export function outlineCanvas(src, t, blur, color, alpha = 1, edgeF = 0) {
  const w = src.width, h = src.height;
  const sd0 = typeof t === "object" && t ? t : { t, b: t, l: t, r: t };
  const st = Math.max(0, Number(sd0.t) || 0), sb = Math.max(0, Number(sd0.b) || 0), sl = Math.max(0, Number(sd0.l) || 0), sr = Math.max(0, Number(sd0.r) || 0);
  const tm = Math.max(st, sb, sl, sr);
  blur = Math.max(0, Number(blur) || 0);
  if (w < 1 || h < 1 || tm < 0.05 || !(alpha > 0)) return null;
  const ax = Math.max(0.5, (sl + sr) / 2), ay = Math.max(0.5, (st + sb) / 2), ox = Math.round((sr - sl) / 2), oy = Math.round((sb - st) / 2), sm = Math.min(ax, ay);
  const pad = Math.ceil(tm + blur * 3) + 2, W = w + pad * 2, H = h + pad * 2;
  let sd;
  try { sd = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data; } catch { return null; }
  const fg = new Uint8Array(W * H), f = new Float64Array(W * H).fill(FAR);
  const em = (i, n) => (edgeF >= 1 ? clamp(Math.min(i + 0.5, n - i - 0.5) / edgeF, 0, 1) : 1);
  let any = false;
  for (let y = 0; y < h; y++) {
    const my = em(y, h);
    for (let x = 0; x < w; x++) {
      const a = (sd[(y * w + x) * 4 + 3] / 255) * my * em(x, w), i = (y + pad) * W + x + pad;
      if (a >= 0.5) { f[i] = 0; fg[i] = 1; any = true; }
    }
  }
  if (!any) return null;
  edt2(f, W, H, 1 / (ax * ax), 1 / (ay * ay)); // 楕円の距離(1 = ふち)
  let B = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // 物の内側(まわり 8 つも物の所。pad があるので、はしの画素は物にならない)
      const inner = fg[i] && fg[i - 1] && fg[i + 1] && fg[i - W] && fg[i + W] && fg[i - W - 1] && fg[i - W + 1] && fg[i + W - 1] && fg[i + W + 1];
      const xs = x - ox, ys = y - oy;
      const dn = xs >= 0 && xs < W && ys >= 0 && ys < H ? Math.sqrt(f[ys * W + xs]) : 1e10;
      B[i] = inner ? 0 : clamp((1 - dn) * sm + 0.5, 0, 1);
    }
  }
  // ぼかし: 箱ぼかし 3 回(標準偏差 blur に合わせた幅)
  if (blur > 0.3) { const r = Math.max(1, Math.round((Math.sqrt(1 + 4 * blur * blur) - 1) / 2)); for (let i = 0; i < 3; i++) B = boxBlur(B, W, H, r); }
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), img = g.createImageData(W, H), d = img.data, [cr, cg, cb] = hexRgb(color), al = clamp(Number(alpha), 0, 1);
  for (let i = 0; i < B.length; i++) { d[i * 4] = cr; d[i * 4 + 1] = cg; d[i * 4 + 2] = cb; d[i * 4 + 3] = Math.round(B[i] * al * 255); }
  g.putImageData(img, 0, 0);
  return { cv, pad };
}

// パスの線(点と点の間。曲線はハンドルに沿う)に近いか。x, y, tol は点と同じ単位
export function nearPathLine(pts, closed, x, y, tol) {
  const n = pts?.length || 0;
  if (n < 2) return false;
  const seg = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0; return Math.hypot(ax + dx * t - x, ay + dy * t - y); };
  for (let s = 0; s < (closed ? n : n - 1); s++) {
    const a = pts[s], b = pts[(s + 1) % n];
    const c1 = a.ho ? [a.x + a.ho[0], a.y + a.ho[1]] : [a.x, a.y], c2 = b.hi ? [b.x + b.hi[0], b.y + b.hi[1]] : [b.x, b.y];
    let px = a.x, py = a.y;
    for (let k = 1; k <= 24; k++) {
      const t = k / 24, u = 1 - t;
      const qx = u * u * u * a.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b.x, qy = u * u * u * a.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b.y;
      if (seg(px, py, qx, qy) <= tol) return true;
      px = qx; py = qy;
    }
  }
  return false;
}
// 編集画面を閉じる前に聞く: 一時保存(🕘 履歴に残して閉じる)/ 保存しない / 編集に戻る。押したものを "keep" / "discard" / "back" で返す
export function askClose(message, T = (x) => x) {
  return new Promise((res) => {
    const bg = document.createElement("div");
    bg.className = "cca-askclose";
    bg.innerHTML = `<style>.cca-askclose{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
.cca-askclose>div{background:#1b1f26;color:#e6e9ee;border:1px solid #39424f;border-radius:10px;padding:18px 20px;max-width:min(480px,92vw);font-size:14px}
.cca-askclose p{margin:0 0 14px;line-height:1.6}.cca-askclose .r{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.cca-askclose button{padding:6px 14px;border-radius:6px;border:1px solid #4a5463;background:#262c35;color:#e6e9ee;cursor:pointer}
.cca-askclose button.pri{background:#2b8f84;border-color:#3db4a6;color:#fff}</style>
<div role="dialog"><p></p><div class="r"><button data-k="keep" class="pri"></button><button data-k="discard"></button><button data-k="back"></button></div></div>`;
    bg.querySelector("p").textContent = message;
    const lab = { keep: ["一時保存", "今の内容を 🕘 履歴に残して閉じます(あとで開き直せます)"], discard: ["保存しない", "今の内容を残さずに閉じます"], back: ["編集に戻る", "閉じずに編集を続けます(Esc)"] };
    for (const b of bg.querySelectorAll("button")) { b.textContent = T(lab[b.dataset.k][0]); b.title = T(lab[b.dataset.k][1]); }
    const done = (k) => { bg.remove(); document.removeEventListener("keydown", key, true); res(k); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); done("back"); } };
    bg.addEventListener("click", (e) => { const k = e.target.closest("button")?.dataset.k; if (k) done(k); else if (e.target === bg) done("back"); });
    document.addEventListener("keydown", key, true);
    document.body.appendChild(bg);
    bg.querySelector("button.pri").focus();
  });
}

// 右の欄の幅を、境目のドラッグで変える(ダブルクリックで元の幅)。幅はブラウザに残す。
// main: 欄を並べている grid(列は ... var(--sidew, 既定の幅))、side: 右の欄、gap: 列の間(境目はその真ん中)
export function sideSplitter(main, key, side, { gap = 0, minSide = 240, minMain = 320 } = {}) {
  if (!main || !side || main.querySelector(":scope > .cca-split")) return;
  if (!document.getElementById("cca-split-css")) {
    const st = document.createElement("style");
    st.id = "cca-split-css";
    st.textContent = `.cca-split{position:absolute;top:0;bottom:0;width:8px;margin-left:-4px;cursor:col-resize;z-index:5;background:transparent}
.cca-split:hover,.cca-split.on{background:#3db4a655}`;
    document.head.appendChild(st);
  }
  const LS = `cca_generator.sidew.${key}`;
  const bar = document.createElement("div");
  bar.className = "cca-split";
  bar.title = "ドラッグで右の欄の幅を変えます(ダブルクリックで元の幅)";
  if (getComputedStyle(main).position === "static") main.style.position = "relative";
  main.appendChild(bar);
  const place = () => { bar.style.left = `${side.offsetLeft - gap / 2}px`; };
  const fit = (w) => Math.max(minSide, Math.min(w, (main.clientWidth || 4000) - minMain));
  const set = (w) => { main.style.setProperty("--sidew", `${Math.round(w)}px`); requestAnimationFrame(place); };
  let w0 = 0;
  try { w0 = Number(localStorage.getItem(LS)) || 0; } catch { /* 読めなければ既定の幅 */ }
  if (w0) set(fit(w0));
  new ResizeObserver(place).observe(main);
  new ResizeObserver(place).observe(side);
  bar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("on");
    const move = (ev) => {
      const r = main.getBoundingClientRect(), pr = parseFloat(getComputedStyle(main).paddingRight) || 0;
      set(fit(r.right - pr - ev.clientX - gap / 2));
    };
    const up = () => {
      bar.classList.remove("on");
      bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up);
      try { localStorage.setItem(LS, String(parseFloat(main.style.getPropertyValue("--sidew")))); } catch { /* 残せなくても今は使える */ }
      window.dispatchEvent(new Event("resize")); // プレビューの大きさを合わせ直す
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  });
  bar.addEventListener("dblclick", () => {
    main.style.removeProperty("--sidew");
    try { localStorage.removeItem(LS); } catch { /* 無視 */ }
    requestAnimationFrame(place);
    window.dispatchEvent(new Event("resize"));
  });
}
