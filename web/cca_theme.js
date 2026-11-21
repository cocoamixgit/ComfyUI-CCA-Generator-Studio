// 配色(テーマ)の切り替え。生成パネル・画像編集・動画編集の色を、選んだ配色に置き換える。
// 画面の色はもとの配色(クラシック。暗い色)で書いてあり、ここで 1 色ずつ置き換える:
//   - 色の少ない色(背景・線・文字): もとの明るさの順に、配色の背景 bg → 文字 fg の間の色にする(明るい配色では明るさが逆になる)
//   - 青緑の色(ボタンなどの強調): 配色の accent の色合い、黄色(目印): accent2 の色合い。ほかの色(赤のエラー・緑など)は色合いを残す
//   - 半透明の黒・白(影など)はそのまま
// 置き換えるのは、パネル・編集画面の <style> と、その中の要素の style 属性。プレビュー(画像・動画の中身)は置き換えない。
const KEY = "cca_generator.theme";
// ---- 配色の項目(THEMES の 1 つ分)。色は #rgb・#rgba・#rrggbb・#rrggbbaa(最後の 2 桁が不透明度 00〜ff)で書ける
//   id      保存に使う名前(変えない)
//   name    プルダウンに出す名前(英語などの表示は言語パックで訳す)
//   light   true = 明るい配色(地が明るく文字が暗い)。もとの暗い配色の明るさを逆にして使う
//   bg      地の色: パネル・編集画面の地。欄(カード)・入力欄・タイムラインの地・ダイアログの地も、この色から fg 寄りに作る
//   fg      文字の色: ふつうの文字。線・枠・薄い文字(説明・ヒント)は bg と fg の間の色になる
//   accent  強調の色(もとは青緑): 生成ボタン・選んでいるボタン(タスク・ツール・選択中)・「＋ 追加」など主なボタン・選んだレイヤーの枠・スライダー
//   accent2 目印の色(もとは黄): スナップのオン・強調表示の枠・目印の文字など
//   grad    [上の色, 下の色]: 地のグラデーション(省略すると bg から作る)
//   alpha   不透明度(0〜1): { panel: 地のグラデーション(既定 1), card: 欄(既定 0.86), go: 生成ボタン(既定 0.78) }
//   hueMap  [[色合い(0〜360), 色], …]: その色合い(±28)の色を、指定した色の色合いにする(差し色)
//   rainbow true = 色の付いた所を色鉛筆の 7 色に寄せる
//   classic true = 置き換えない(もとの配色)
// 色の不透明度: bg・fg に付けると地・欄・線・文字が、accent・accent2・hueMap の色に付けると、その色から作る所が透ける。
// エラーの赤・成功の緑などは色合いを残し、明るさだけ配色に合わせる。半透明の黒・白(影)はそのまま。
// 色は、添付の画像から取り出した色を元に決めた
export const THEMES = [
  { id: "cca", name: "CCA-標準", light: true, bg: "#fbf3ea", fg: "#3b2c23", accent: "#a86a35", accent2: "#856553", grad: ["#f6e6d2", "#5a3b27"] }, // 背景: 薄いライトブラウン → 濃いブラウン
  { id: "aqua", name: "みずいろパステル", light: true, bg: "#fbfdff", fg: "#2b3d62", accent: "#3f8fd0", accent2: "#7cc0ea", hueMap: [[285, "#8cc4ee"], [315, "#a6d2f2"]] }, // 白と青。紫・ピンクの色合いは水色に
  { id: "dream", name: "ドリーム", light: true, bg: "#faf4f3", fg: "#3d3150", accent: "#9677ad", accent2: "#f0d46a", hueMap: [[200, "#6cc0ec"], [230, "#6cc0ec"]] }, // 差し色: 水色・薄い黄色
  { id: "spring", name: "春", light: true, bg: "#f7f9fc", fg: "#4b2a36", accent: "#c4627e", accent2: "#5f95d0" },
  { id: "power", name: "パワフル", light: true, bg: "#fff3df", fg: "#3a1f10", accent: "#d8321e", accent2: "#3c9a24" }, // 赤と緑で派手め
  { id: "colorful", name: "カラフル", light: false, bg: "#070a2c", fg: "#f3f6ee", accent: "#3fae3a", accent2: "#f6c919", rainbow: true }, // 色鉛筆の 7 色
  { id: "purple", name: "パープルエリア", light: false, bg: "#130a3c", fg: "#fbecee", accent: "#7848b2", accent2: "#d36acd" },
  { id: "bluedia", name: "ブルーダイヤモンド", light: false, bg: "#0b121d", fg: "#e3effb", accent: "#206fd1", accent2: "#63b5f3" },
  { id: "ocean", name: "海", light: false, bg: "#04112a", fg: "#e4e6e3", accent: "#016db9", accent2: "#00c5fa" },
  { id: "flame", name: "炎", light: false, bg: "#160604", fg: "#ffe8c8", accent: "#d8361a", accent2: "#ffa72a" }, // 赤とオレンジで火のように
  { id: "dandy", name: "ダンディ", light: false, bg: "#0e0c0b", fg: "#ece3d2", accent: "#a9842f", accent2: "#d8b75c" }, // 金
  { id: "classic", name: "クラシック", light: false, classic: true },
];
const DEFAULT = "cca";
let cur = null; // 今の配色(クラシックなら null = 置き換えない)
const cache = new Map();

// #rgb・#rgba・#rrggbb・#rrggbbaa → [r, g, b, 不透明度(0〜255)]
const hex = (h) => {
  let s = String(h).replace("#", "");
  if (s.length <= 4) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4, 6].map((i) => (i === 6 && s.length < 8 ? 255 : parseInt(s.slice(i, i + 2), 16)));
};
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PENCIL = [0, 28, 52, 120, 188, 222, 282]; // 色鉛筆の 7 色の色合い(赤・橙・黄・緑・水色・青・紫)
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
// もとの明るさ l(0〜1)→ 背景から文字までの間の色
function ramp(th, l) {
  const t = clamp((l - 0.05) / 0.88, 0, 1), e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  const a = hex(th.bg), b = hex(th.fg);
  return a.map((v, i) => Math.round(v + (b[i] - v) * e));
}
function mapRGB(th, r, g, b, a) {
  if (a < 1 && ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) return null; // 影など
  const [h, s, l] = rgb2hsl(r, g, b);
  const base = ramp(th, l);
  if (s < 0.2 || (s < 0.35 && (l < 0.2 || l > 0.85))) return base; // 色の少ない色
  const teal = Math.abs(h - 172) < 24, yellow = h >= 38 && h <= 58;
  let H = h, S = s;
  let A = base[3]; // 不透明度(色の元にした配色の色のもの)
  if (teal || yellow) { const src = hex(teal ? th.accent : th.accent2), [ah, as] = rgb2hsl(...src); H = ah; S = Math.max(0.25, Math.min(as, s)); A = src[3]; }
  else if (th.hueMap?.some(([c]) => hueDist(c, h) < 28)) { const src = hex(th.hueMap.find(([c]) => hueDist(c, h) < 28)[1]), [ah, as] = rgb2hsl(...src); H = ah; S = Math.max(0.3, Math.min(as, s)); A = src[3]; } // 色合いを差し色に
  else if (th.rainbow) { H = PENCIL.reduce((p, q) => (hueDist(q, h) < hueDist(p, h) ? q : p)); S = Math.max(S, 0.75); } // いちばん近い色鉛筆の色に
  const bl = rgb2hsl(...base)[2];
  // 背景に近い暗い色・文字に近い明るい色は、置き換えた明るさにして色合いだけ残す
  if (l < 0.26 || l > 0.84) return [...hsl2rgb(H, Math.min(S, 0.5), bl), A];
  if (teal) { const [, , al] = rgb2hsl(...hex(th.accent)); return [...hsl2rgb(H, S, clamp(al + (l - 0.4) * 0.8, 0.2, 0.8)), A]; }
  // 中くらいの明るさの色(文字や印): 明るい配色では暗めにして読めるようにする
  return [...hsl2rgb(H, S, th.light ? clamp(1.05 - l, 0.3, 0.55) : l), A];
}
const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
// 置き換えた色 v([r, g, b, 不透明度 0〜255])と、もとの色の不透明度 a(0〜1)→ CSS の色
const fmt = (v, a) => { const A = ((v[3] ?? 255) / 255) * a; return A >= 0.999 ? toHex(v) : `rgba(${v[0]},${v[1]},${v[2]},${Math.round(A * 1000) / 1000})`; };
function mapToken(tok, th) {
  const k = `${th.id}|${tok}`;
  if (cache.has(k)) return cache.get(k);
  let r, g, b, a = 1, out = tok;
  const m = /^#([0-9a-f]{3,8})$/i.exec(tok);
  if (m) {
    let s = m[1];
    if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join("");
    [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
    if (s.length === 8) a = parseInt(s.slice(6, 8), 16) / 255;
    const v = mapRGB(th, r, g, b, a);
    if (v) out = fmt(v, a);
  } else {
    const p = tok.slice(tok.indexOf("(") + 1, -1).split(/[\s,/]+/).filter(Boolean).map(Number);
    [r, g, b] = p; a = p.length > 3 ? p[3] : 1;
    if ([r, g, b].every(Number.isFinite)) {
      const v = mapRGB(th, r, g, b, a);
      if (v) out = fmt(v, a);
    }
  }
  cache.set(k, out);
  return out;
}
// 宣言の中の色だけ(#cca-ui のような id は、後ろが - なので色にしない)
const COLOR = /(^|[:,\s(])(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))(?![0-9a-zA-Z_-])/g;
export function mapCss(text, th = cur) {
  if (!th || !text) return text;
  return text.replace(COLOR, (all, pre, tok) => pre + mapToken(tok, th));
}

// ---- 置き換える所
const ROOT = '#cca-ui, #cca-vedit, #cca-imged, [id^="cca-"], [class^="cca-"], [class*=" cca-"]';
const SKIP = '.stage, [data-c="stage"], [data-no-theme]'; // 画像・動画の中身は置き換えない
const styleOrig = new WeakMap(), attrRec = new WeakMap();
function doStyle(st) {
  if (st.id === "cca-theme-deco") return; // 飾り(配色ごとに作る)は置き換えない
  if (!styleOrig.has(st)) { if (!/#cca-|\.cca-/.test(st.textContent)) return; styleOrig.set(st, st.textContent); }
  const want = mapCss(styleOrig.get(st));
  if (st.textContent !== want) { st.__ccaSet = want; st.textContent = want; }
}
function doAttr(el) {
  const v = el.getAttribute("style");
  if (v == null) return;
  let rec = attrRec.get(el);
  if (rec && v === rec.mapped) { if (rec.th === cur) return; } else rec = { orig: v };
  if (!rec.orig || !/#|rgb/.test(rec.orig) || !el.closest(ROOT) || el.closest(SKIP)) { attrRec.delete(el); return; }
  rec.mapped = mapCss(rec.orig); rec.th = cur;
  attrRec.set(el, rec);
  if (v !== rec.mapped) el.setAttribute("style", rec.mapped);
}
function doTree(n) {
  if (n.nodeType !== 1) return;
  if (n.tagName === "STYLE") { doStyle(n); return; }
  if (n.hasAttribute("style")) doAttr(n);
  for (const e of n.querySelectorAll("[style]")) doAttr(e);
  for (const s of n.querySelectorAll("style")) doStyle(s);
}
function all() {
  for (const s of document.querySelectorAll("style")) doStyle(s);
  for (const r of document.querySelectorAll(ROOT)) for (const e of [r, ...r.querySelectorAll("[style]")]) doAttr(e);
}
let obs = null;
export function startTheme() {
  cur = themeOf(themeChoice());
  if (obs) return;
  obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") doAttr(m.target);
      else if (m.type === "characterData" || (m.type === "childList" && m.target.tagName === "STYLE")) {
        const st = m.type === "characterData" ? m.target.parentNode : m.target;
        if (st?.tagName === "STYLE" && st.textContent !== st.__ccaSet) { styleOrig.delete(st); doStyle(st); }
      } else for (const n of m.addedNodes) doTree(n);
    }
  });
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"], characterData: true });
  if (cur) all();
  applyDeco();
}
function themeOf(id) { const t = THEMES.find((x) => x.id === id) || THEMES.find((x) => x.id === DEFAULT); return t.classic ? null : t; }
export function themeChoice() { try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; } }
// 飾り: 背景のグラデーション・ボタンのハイライトと内側の影(半透明に見えるように)・生成ボタン(少し透かした強調の色・白い縁・黒のぼかしの影)・欄を少し透かす
const mixHex = (a, b, t) => toHex(hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)));
function decoCss(th) {
  if (!th) return "";
  const al = { panel: 1, card: 0.86, go: 0.78, ...(th.alpha || {}) };
  const ga = (c) => fmt(hex(c), al.panel); // グラデーションの色(色の不透明度 × panel)
  const [g0, g1] = (th.grad || (th.light ? [th.bg, mixHex(th.bg, th.fg, 0.45) + hex(th.bg)[3].toString(16).padStart(2, "0")] : [mixHex(th.bg, th.accent, 0.22) + hex(th.bg)[3].toString(16).padStart(2, "0"), th.bg])).map(ga);
  const [ar, ag, ab, aa] = hex(th.accent), B = ":is(#cca-ui, #cca-vedit, #cca-imged, .cca-askclose) button:not(:disabled):not(.errx)";
  return `#cca-ui, #cca-vedit > .win, #cca-imged > .win{background-image:linear-gradient(170deg, ${g0}, ${g1}) !important}
#cca-ui .card{background-color:color-mix(in srgb, var(--card) ${Math.round(clamp(al.card, 0, 1) * 100)}%, transparent);box-shadow:0 2px 10px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.3)}
${B}{background-image:linear-gradient(180deg, rgba(255,255,255,.32), rgba(255,255,255,.06) 48%, rgba(0,0,0,.08)) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 3px rgba(0,0,0,.16), 0 1px 3px rgba(0,0,0,.22)}
${B}:hover{filter:brightness(1.06)}
${B}:active{box-shadow:inset 0 2px 4px rgba(0,0,0,.3)}
#cca-ui #cca-go:not(:disabled){background-color:rgba(${ar},${ag},${ab},${Math.round(clamp(al.go, 0, 1) * (aa / 255) * 1000) / 1000}) !important;border:2px solid #fff !important;color:#fff !important;text-shadow:0 1px 2px rgba(0,0,0,.5);
  box-shadow:inset 0 2px 0 rgba(255,255,255,.45), inset 0 -6px 12px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.45) !important}`;
}
function applyDeco() {
  let st = document.getElementById("cca-theme-deco");
  if (!st) { st = document.createElement("style"); st.id = "cca-theme-deco"; document.head.appendChild(st); }
  st.textContent = decoCss(cur);
}
export function setTheme(id) {
  try { localStorage.setItem(KEY, id); } catch { /* 保存できなくても今の画面には使う */ }
  cur = themeOf(id);
  all();
  applyDeco();
}
