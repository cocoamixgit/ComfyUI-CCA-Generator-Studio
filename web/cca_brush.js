// お絵描きのブラシ: ブラシの先(形・硬さ・丸み・角度)を点として、線に沿って間隔ごとに置き、なぞる間の濃さを
// 「流量」で少しずつ「不透明度」まで近づける(重ねても上限を超えない)。ばらつき・散らばり・質感・筆圧・手振れ補正。
// ブラシの一覧(パレット)と、選んだブラシの設定の欄もここで作る。設定はブラシごとにこのブラウザに覚える
import { T } from "./cca_i18n.js";

const LS = "cca_generator.imgedit.brushes";
const BASE = { shape: "round", size: 12, opacity: 100, flow: 100, hardness: 90, spacing: 8, roundness: 100, angle: 0, follow: false,
  sizeJit: 0, angleJit: 0, scatter: 0, texture: "none", texAmt: 0, bleed: 0, pSize: true, pOpacity: false, minSize: 15, smooth: 15 };
// [id, 名前, 既定からの違い]
export const BRUSH_PRESETS = [
  ["pen", "丸ペン", { size: 12, hardness: 95, spacing: 5 }],
  ["ink", "インクペン", { size: 8, hardness: 100, spacing: 3, minSize: 5, smooth: 45 }],
  ["pencil", "鉛筆", { size: 5, opacity: 90, flow: 60, hardness: 75, spacing: 6, texture: "fine", texAmt: 75, pOpacity: true, minSize: 50, smooth: 10 }],
  ["soft", "ソフト円", { size: 60, flow: 20, hardness: 0, spacing: 6, pSize: false, pOpacity: true }],
  ["air", "エアブラシ", { size: 120, flow: 5, hardness: 0, spacing: 4, pSize: false, pOpacity: true, smooth: 0 }],
  ["brush", "筆", { shape: "bristle", size: 32, flow: 80, spacing: 2, follow: true, minSize: 30 }],
  ["marker", "マーカー", { size: 26, opacity: 60, hardness: 85, spacing: 4, roundness: 30, angle: 45, pSize: false }],
  ["water", "水彩", { size: 54, opacity: 45, flow: 25, hardness: 35, spacing: 6, sizeJit: 10, texture: "coarse", texAmt: 25, bleed: 60, pOpacity: true }],
  ["crayon", "クレヨン", { size: 18, flow: 100, hardness: 92, spacing: 4, roundness: 70, follow: true, texture: "streak", texAmt: 80, minSize: 60 }],
  ["chalk", "チョーク", { size: 30, opacity: 85, flow: 30, hardness: 15, spacing: 10, scatter: 18, sizeJit: 25, texture: "coarse", texAmt: 90, pSize: false }],
  ["spray", "スプレー", { shape: "spray", size: 70, flow: 50, hardness: 100, spacing: 12, pSize: false, pOpacity: true }],
  ["stars", "星", { shape: "star", size: 26, hardness: 100, spacing: 170, sizeJit: 40, angleJit: 100, scatter: 45, pSize: false }],
  ["hearts", "ハート", { shape: "heart", size: 26, hardness: 100, spacing: 170, sizeJit: 35, angleJit: 25, scatter: 35, pSize: false }],
  ["leaves", "葉", { shape: "leaf", size: 24, hardness: 100, spacing: 110, sizeJit: 30, angleJit: 50, scatter: 55, follow: true, pSize: false }],
  ["dots", "点々", { shape: "round", size: 14, hardness: 100, spacing: 220, sizeJit: 35, scatter: 40, pSize: false }],
];
// 設定の欄: [キー, 名前, 種類(数: [最小, 最大] / sel: 選択肢 / ck: チェック)]
const FIELDS = [
  ["shape", "先の形", "sel", [["round", "丸"], ["bristle", "筆の毛"], ["spray", "スプレー"], ["star", "星"], ["heart", "ハート"], ["leaf", "葉"]]],
  ["size", "太さ(px)", [1, 400]],
  ["opacity", "不透明度(%)", [1, 100]],
  ["flow", "流量(%)", [1, 100]],
  ["hardness", "硬さ(%)", [0, 100]],
  ["spacing", "間隔(%)", [1, 300]],
  ["roundness", "丸み(%)", [5, 100]],
  ["angle", "角度(°)", [-180, 180]],
  ["follow", "向きを線の向きに合わせる", "ck"],
  ["sizeJit", "太さのばらつき(%)", [0, 100]],
  ["angleJit", "角度のばらつき(%)", [0, 100]],
  ["scatter", "散らばり(%)", [0, 300]],
  ["texture", "質感", "sel", [["none", "なし"], ["fine", "紙(細かい)"], ["coarse", "画用紙(粗い)"], ["streak", "ろうの筋"]]],
  ["texAmt", "質感の強さ(%)", [0, 100]],
  ["bleed", "にじみ(%)", [0, 100]],
  ["pSize", "筆圧で太さを変える", "ck"],
  ["pOpacity", "筆圧で濃さを変える", "ck"],
  ["minSize", "筆圧が弱いときの太さ(%)", [0, 100]],
  ["smooth", "手振れ補正", [0, 100]],
];
const TIPS = {
  flow: "なぞる間に、1 回置くごとに足す濃さ(小さいほど、重ねるほど濃くなる)。不透明度より濃くはならない",
  spacing: "ブラシの先を置く間隔(太さに対する %)。大きくすると点が離れて並ぶ",
  roundness: "ブラシの先のつぶれ具合(100% で真円)",
  texture: "紙の目のようなざらつきを付ける",
  bleed: "なぞって離したあと、塗った所がまわりへにじみ、ふちが少し濃くなる(水彩のように)",
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let saved = (() => { try { const o = JSON.parse(localStorage.getItem(LS) || "null"); if (o && typeof o === "object") return { cur: String(o.cur || "pen"), set: o.set && typeof o.set === "object" ? o.set : {} }; } catch { /* 既定 */ } return { cur: "pen", set: {} }; })();
const save = () => { try { localStorage.setItem(LS, JSON.stringify(saved)); } catch { /* 覚えなくても使える */ } };
const preset = (id) => BRUSH_PRESETS.find((p) => p[0] === id) || BRUSH_PRESETS[0];
export const brushOf = (id) => { const p = preset(id); return { ...BASE, ...p[2], ...(saved.set[p[0]] || {}), id: p[0], name: p[1] }; };
export const curBrush = () => brushOf(saved.cur);

// ---------------------------------------------------------------- 乱数(なぞる 1 回ごとに決まった並び)
const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// ---------------------------------------------------------------- ブラシの先(濃さ 0〜1 の四角)。形・大きさ・角度ごとに作って覚える
function shapePath(g, kind, r) {
  if (kind === "star") {
    for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath();
  } else if (kind === "heart") {
    g.moveTo(0, r * 0.9); g.bezierCurveTo(-r * 1.2, 0, -r * 0.6, -r, 0, -r * 0.35); g.bezierCurveTo(r * 0.6, -r, r * 1.2, 0, 0, r * 0.9); g.closePath();
  } else if (kind === "leaf") {
    g.moveTo(-r, 0); g.quadraticCurveTo(0, -r * 0.75, r, 0); g.quadraticCurveTo(0, r * 0.75, -r, 0); g.closePath();
  } else g.arc(0, 0, r, 0, Math.PI * 2);
}
const tips = new Map();
function tipOf(B, d, ang, fx, fy, variant) {
  const sym = (B.shape === "round" || B.shape === "spray") && B.roundness >= 100;
  const qa = sym ? 0 : Math.round((ang * 180) / Math.PI / 4) * 4;
  const key = `${B.shape}|${Math.round(d * 4) / 4}|${B.hardness}|${B.roundness}|${qa}|${fx}|${fy}|${variant}`;
  let t = tips.get(key);
  if (t) return t;
  if (tips.size > 800) tips.clear();
  const N = Math.ceil(d) + 3, h = Math.floor(N / 2), c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d", { willReadFrequently: true }), r = d / 2;
  g.translate(h + fx, h + fy);
  g.rotate((qa * Math.PI) / 180);
  g.scale(1, Math.max(0.05, B.roundness / 100));
  g.fillStyle = "#fff";
  if (B.shape === "round") {
    const hd = Math.min(0.999, B.hardness / 100);
    if (hd < 0.98) { // 硬さ: 外側をなめらかに薄くする
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
      for (let i = 0; i <= 16; i++) { const s = i / 16, u = s <= hd ? 0 : (s - hd) / (1 - hd); gr.addColorStop(s, `rgba(255,255,255,${(1 - u * u * (3 - 2 * u)).toFixed(4)})`); }
      g.fillStyle = gr;
    }
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  } else if (B.shape === "bristle" || B.shape === "spray") {
    const R = rng(variant * 7919 + (B.shape === "spray" ? 104729 : 13)), bristle = B.shape === "bristle";
    const n = bristle ? Math.max(8, Math.min(48, Math.round(d / 1.6))) : Math.max(6, Math.round(d * 0.7));
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * r * (bristle ? 0.92 : 1);
      g.globalAlpha = bristle ? 0.45 + 0.55 * R() : 0.6 + 0.4 * R();
      g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, bristle ? Math.max(0.6, r * (0.05 + 0.07 * R())) : 0.5 + R() * Math.max(0.6, d / 60), 0, Math.PI * 2); g.fill();
    }
  } else { g.beginPath(); shapePath(g, B.shape, r); g.fill(); }
  const im = g.getImageData(0, 0, N, N).data, a = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) a[i] = im[i * 4 + 3] / 255;
  t = { a, N, h };
  tips.set(key, t);
  return t;
}
// ---------------------------------------------------------------- 質感(つながる 256×256 の模様。0〜1)
const texs = {};
function texture(kind) {
  if (texs[kind]) return texs[kind];
  const N = 256, out = new Float32Array(N * N), R = rng(kind === "fine" ? 11 : 23);
  const oct = kind === "fine" ? [[2, 2, 0.5], [1, 1, 0.5]] : kind === "streak" ? [[64, 4, 0.45], [32, 2, 0.35], [16, 1, 0.2]] : [[32, 32, 0.35], [16, 16, 0.3], [8, 8, 0.2], [4, 4, 0.15]];
  for (const [cx, cy, amp] of oct) {
    const MX = N / cx, MY = N / cy, gv = Array.from({ length: MX * MY }, () => R());
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / cx, fy = y / cy, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), at = (i, j) => gv[((j + MY) % MY) * MX + ((i + MX) % MX)];
      const v = at(x0, y0) * (1 - sx) * (1 - sy) + at(x0 + 1, y0) * sx * (1 - sy) + at(x0, y0 + 1) * (1 - sx) * sy + at(x0 + 1, y0 + 1) * sx * sy;
      out[y * N + x] += v * amp;
    }
  }
  for (let i = 0; i < out.length; i++) { const v = out[i]; out[i] = kind === "fine" ? 0.35 + 0.65 * v : kind === "streak" ? Math.min(1, Math.max(0, (v - 0.36) / 0.2)) : Math.min(1, Math.max(0, (v - 0.32) / 0.36)); } // 画用紙: くぼみ(塗れない所)をはっきり / ろう: 筋の切れ目をはっきり
  return (texs[kind] = out);
}
// 質感の掛け具合(1 = そのまま)
export function texMul(B, x, y) {
  if (!B || B.texture === "none" || !B.texAmt) return 1;
  return 1 - (B.texAmt / 100) * (1 - texture(B.texture)[(y & 255) * 256 + (x & 255)]);
}
// ---------------------------------------------------------------- なぞる 1 回分
export function newStroke(w, h, B, seed = (Math.random() * 1e9) | 0) {
  return { buf: new Float32Array(w * h), w, h, B, box: null, rem: 0, R: rng(seed), seed, dir: 0 };
}
const diam = (B, pr) => B.size * (B.pSize ? B.minSize / 100 + (1 - B.minSize / 100) * pr : 1);
// 点を 1 つ置く(濃さは「不透明度 × 筆圧」に向けて「流量」ずつ近づける)
export function strokeDab(S, x, y, pr = 1) {
  const B = S.B, dir = S.dir;
  let d = diam(B, pr);
  if (B.sizeJit) d *= 1 - (B.sizeJit / 100) * S.R();
  if (d < 0.3) return;
  let ang = (B.angle * Math.PI) / 180 + (B.follow ? dir : 0);
  if (B.angleJit) ang += (S.R() - 0.5) * 2 * Math.PI * (B.angleJit / 100);
  if (B.scatter) { const s = (S.R() - 0.5) * 2 * (B.scatter / 100) * d; x += Math.cos(dir + Math.PI / 2) * s; y += Math.sin(dir + Math.PI / 2) * s; }
  const small = d < 24, fx = small ? Math.round((x - Math.floor(x)) * 4) / 4 : 0, fy = small ? Math.round((y - Math.floor(y)) * 4) / 4 : 0; // 細い線は 1/4 画素ずつずらした先を使う(がたつかない)
  const variant = B.shape === "spray" ? (S.R() * 12) | 0 : B.shape === "bristle" ? S.seed % 16 : 0;
  const tip = tipOf(B, d, ang, fx, fy, variant), N = tip.N;
  const ox = (small ? Math.floor(x) : Math.round(x)) - tip.h, oy = (small ? Math.floor(y) : Math.round(y)) - tip.h;
  const target = (B.opacity / 100) * (B.pOpacity ? pr : 1), fl = B.flow / 100, buf = S.buf, W = S.w;
  const x0 = Math.max(0, -ox), y0 = Math.max(0, -oy), x1 = Math.min(N, W - ox), y1 = Math.min(N, S.h - oy);
  if (x1 <= x0 || y1 <= y0) return;
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0, k = ty * N + x0, j = (oy + ty) * W + ox + x0; tx < x1; tx++, k++, j++) {
      const ta = tip.a[k];
      if (ta <= 0) continue;
      const cur = buf[j];
      if (cur < target) buf[j] = cur + (target - cur) * fl * ta;
    }
  }
  const b = S.box, a = S.all;
  S.box = { x0: Math.min(b ? b.x0 : Infinity, ox + x0), y0: Math.min(b ? b.y0 : Infinity, oy + y0), x1: Math.max(b ? b.x1 : -Infinity, ox + x1), y1: Math.max(b ? b.y1 : -Infinity, oy + y1) };
  S.all = { x0: Math.min(a ? a.x0 : Infinity, ox + x0), y0: Math.min(a ? a.y0 : Infinity, oy + y0), x1: Math.max(a ? a.x1 : -Infinity, ox + x1), y1: Math.max(a ? a.y1 : -Infinity, oy + y1) };
}
// ぼかし(箱型を 2 回。w×h の濃さの並び)
function boxBlur(src, w, h, r) {
  let a = src, b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) { let s = 0; const o = y * w; for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { b[o + x] = s / (2 * r + 1); s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; } }
    const c = new Float32Array(w * h);
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { c[y * w + x] = s / (2 * r + 1); s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
    a = c;
  }
  return a;
}
// なぞり終わり: にじみ(水彩)。塗った所がむらを持ってまわりへ広がり、内側のふちが少し濃くなる
export function finishStroke(S) {
  const B = S.B, A = S.all;
  if (!B.bleed || !A) return;
  const r = Math.max(1, Math.round(B.size * (B.bleed / 100) * 0.35));
  const x0 = Math.max(0, A.x0 - r * 3), y0 = Math.max(0, A.y0 - r * 3), x1 = Math.min(S.w, A.x1 + r * 3), y1 = Math.min(S.h, A.y1 + r * 3), w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) a.set(S.buf.subarray((y0 + y) * S.w + x0, (y0 + y) * S.w + x1), y * w);
  const wide = boxBlur(a, w, h, r), near = boxBlur(a, w, h, Math.max(1, Math.round(r / 3))), tex = texture("coarse");
  const cap = Math.min(1, (B.opacity / 100) * 1.35);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, n = tex[((y0 + y) & 255) * 256 + ((x0 + x) & 255)];
    const v = Math.max(a[i], wide[i] * (0.5 + 0.8 * n)) + Math.max(0, a[i] - wide[i]) * 1.1 + Math.max(0, a[i] - near[i]) * 0.5; // ふち(内側)を濃く
    S.buf[(y0 + y) * S.w + x0 + x] = Math.min(cap, v);
  }
  S.box = { x0, y0, x1, y1 };
}
// a から b まで(c を通る向きの 2 次曲線)、線に沿って間隔ごとに点を置く。筆圧は pa → pb
export function strokeTo(S, a, c, b, pa = 1, pb = 1) {
  const B = S.B, len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y), n = Math.max(1, Math.ceil(len * 2));
  let px = a.x, py = a.y;
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t, x = u * u * a.x + 2 * u * t * c.x + t * t * b.x, y = u * u * a.y + 2 * u * t * c.y + t * t * b.y, pr = pa + (pb - pa) * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist > 0) S.dir = Math.atan2(y - py, x - px);
    S.rem += dist; px = x; py = y;
    const sp = Math.max(0.3, (B.spacing / 100) * Math.max(1, diam(B, pr)));
    while (S.rem >= sp) { S.rem -= sp; strokeDab(S, x, y, pr); }
  }
}
// ---------------------------------------------------------------- ブラシの見本(S 字の線)
function preview(cv, B, color) {
  const w = cv.width, h = cv.height, PB = { ...B, size: Math.max(2, Math.min(B.size, h * (B.shape === "round" && B.hardness < 40 ? 0.6 : 0.42))) };
  const S = newStroke(w, h, PB, 4242);
  const P = (t) => ({ x: 8 + (w - 16) * t, y: h / 2 - Math.sin(t * Math.PI * 2) * h * 0.2 }), pr = (t) => 0.25 + 0.75 * Math.sin(Math.PI * t);
  let last = P(0);
  strokeDab(S, last.x, last.y, pr(0));
  for (let i = 1; i <= 40; i++) { const q = P(i / 40); strokeTo(S, last, { x: (last.x + q.x) / 2, y: (last.y + q.y) / 2 }, q, pr((i - 1) / 40), pr(i / 40)); last = q; }
  finishStroke(S);
  const g = cv.getContext("2d"), im = g.createImageData(w, h), d = im.data;
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(color) || [0, 34, 34, 34];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = S.buf[i] * texMul(PB, x, y);
    if (a <= 0) continue;
    d[i * 4] = +m[1]; d[i * 4 + 1] = +m[2]; d[i * 4 + 2] = +m[3]; d[i * 4 + 3] = Math.round(a * 255);
  }
  g.clearRect(0, 0, w, h);
  g.putImageData(im, 0, 0);
}
// ---------------------------------------------------------------- ブラシの一覧(パレット)と設定の欄
export const BRUSH_CSS = `
#cca-imged .bpal{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:4px;margin:6px 0 8px;max-height:236px;overflow-y:auto;padding:2px}
#cca-imged .bpal button{display:flex !important;flex-direction:column;align-items:stretch;gap:1px;padding:3px 4px 2px !important;font-size:11px;line-height:1.25;min-width:0;width:auto !important;height:auto !important;max-height:none !important;min-height:48px;overflow:hidden}
#cca-imged .bpal button canvas{position:static !important;inset:auto !important;width:100% !important;max-width:100%;height:28px !important;display:block;flex:none}
#cca-imged .bpal button span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cca-imged .bset{display:flex;flex-direction:column;gap:2px}
#cca-imged .bset .ck{display:flex;align-items:center;gap:6px;font-size:13px}`;
let panelApi = null;
export function bumpBrushSize(f) {
  const id = saved.cur, B = curBrush(), v = Math.max(1, Math.min(400, Math.round(f > 1 ? Math.max(B.size + 1, B.size * f) : Math.min(B.size - 1, B.size * f))));
  saved.set[id] = { ...(saved.set[id] || {}), size: v };
  save();
  panelApi?.refresh();
  return v;
}
export function setupBrushPanel(box, { onChange } = {}) {
  box.innerHTML = `<div class="bpal" data-bpal>${BRUSH_PRESETS.map(([id, name]) => `<button data-bid="${id}" title="${esc(T(name))}"><canvas width="120" height="34"></canvas><span>${esc(T(name))}</span></button>`).join("")}</div>
    <div class="bset" data-bset></div>
    <div class="row" style="margin-top:4px"><button data-breset title="${esc(T("選んでいるブラシの設定を、最初の値に戻します"))}">${esc(T("このブラシを元に戻す"))}</button></div>`;
  const tiles = () => {
    for (const b of box.querySelectorAll("[data-bid]")) {
      b.classList.toggle("on", b.dataset.bid === saved.cur);
      preview(b.querySelector("canvas"), brushOf(b.dataset.bid), getComputedStyle(b).color);
    }
  };
  const field = ([k, label, kind, opts]) => {
    const B = curBrush(), tip = TIPS[k] ? ` title="${esc(T(TIPS[k]))}"` : "";
    if (kind === "ck") return `<label class="ck"${tip}><input type="checkbox" data-bk="${k}" ${B[k] ? "checked" : ""}> ${esc(T(label))}</label>`;
    if (kind === "sel") return `<label class="fl"${tip}>${esc(T(label))}<select data-bk="${k}">${opts.map(([v, l]) => `<option value="${v}" ${B[k] === v ? "selected" : ""}>${esc(T(l))}</option>`).join("")}</select></label>`;
    const [mn, mx] = kind;
    return `<label class="rg"${tip}>${esc(T(label))}<input type="range" data-bk="${k}" min="${mn}" max="${mx}" step="1" value="${B[k]}"><input type="number" data-bkn="${k}" min="${mn}" max="${mx}" step="1" value="${B[k]}"></label>`;
  };
  const set = (k, v) => {
    const id = saved.cur;
    saved.set[id] = { ...(saved.set[id] || {}), [k]: v };
    save();
    const t = box.querySelector(`[data-bid="${id}"]`);
    if (t) preview(t.querySelector("canvas"), curBrush(), getComputedStyle(t).color);
    onChange?.(curBrush());
  };
  const settings = () => {
    const el = box.querySelector("[data-bset]");
    el.innerHTML = FIELDS.map(field).join("");
    for (const inp of el.querySelectorAll("[data-bk]")) {
      const k = inp.dataset.bk, num = el.querySelector(`[data-bkn="${k}"]`);
      inp.addEventListener(inp.type === "range" ? "input" : "change", () => {
        const v = inp.type === "checkbox" ? inp.checked : inp.type === "range" ? Number(inp.value) : inp.value;
        if (num) num.value = inp.value;
        set(k, v);
      });
      if (num) num.addEventListener("input", () => { if (num.value === "" || Number.isNaN(Number(num.value))) return; const v = Math.min(Number(num.max), Math.max(Number(num.min), Number(num.value))); inp.value = v; set(k, v); });
    }
  };
  box.querySelector("[data-bpal]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-bid]");
    if (!b) return;
    saved.cur = b.dataset.bid;
    save();
    tiles();
    settings();
    onChange?.(curBrush());
  });
  box.querySelector("[data-breset]").onclick = () => { delete saved.set[saved.cur]; save(); tiles(); settings(); onChange?.(curBrush()); };
  tiles();
  settings();
  return (panelApi = { refresh: () => { tiles(); settings(); } });
}
