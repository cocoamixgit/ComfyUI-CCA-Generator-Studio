import { T } from "./cca_i18n.js";
import { api } from "../../scripts/api.js";
import { hoverPreview, hidePreview, mediaKind } from "./cca_hoverpv.js";
// 配色(テーマ)の切り替え。生成パネル・画像編集・動画編集の色を、選んだ配色に置き換える。
// 画面の色はもとの配色(クラシック。暗い色)で書いてあり、ここで 1 色ずつ置き換える:
//   - 色の少ない色(背景・線・文字): もとの明るさの順に、配色の背景 bg → 文字 fg の間の色にする(明るい配色では明るさが逆になる)
//   - 青緑の色(ボタンなどの強調): 配色の accent の色合い、黄色(目印): accent2 の色合い。ほかの色(赤のエラー・緑など)は色合いを残す
//   - 半透明の黒・白(影など)はそのまま
// 置き換えるのは、パネル・編集画面の <style> と、その中の要素の style 属性。プレビュー(画像・動画の中身)は置き換えない。
const KEY = "cca_generator.theme";
// ---- 配色の項目(テーマのファイル 1 つ分。web/themes/<id>.js に export default { … } で書く)。色は #rgb・#rgba・#rrggbb・#rrggbbaa(最後の 2 桁が不透明度 00〜ff)で書ける
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
//   select  セレクト(プルダウン)の色。書いた項目だけ置き換わり、書かない項目はこれまで通り(vars の --card・--text など)の色になる
//           色は #rrggbb・rgba(...) などそのまま使われる(明るさの置き換えはしない)
//             bg 閉じている時の箱の地 / fg その文字 / border その枠 / arrow ▾ の色
//             menuBg 開いた一覧の地 / menuFg 一覧の文字 / menuBorder 一覧の枠
//             hoverBg・hoverFg カーソルを乗せた・キーで選んでいる項目 / selectedBg・selectedFg 今選ばれている項目 / groupFg グループ見出し
//           例: select: { bg: "#fffcf8", fg: "#2b1e16", border: "#c9b49b", menuBg: "#fffcf8", hoverBg: "#ead7c0", selectedBg: "#9c5c26", selectedFg: "#ffffff" }
//   onFg    地が濃い色のボタン(選んでいるボタン(.on)・「開く」など)の文字色。スナップ以外。書いた配色だけ置き換わり、書かない配色はこれまで通り
//   snapOn  スナップがオンの時の色: { bg 地 / fg 文字 / border 枠 }。書いた項目だけ置き換わる
// 色の不透明度: bg・fg に付けると地・欄・線・文字が、accent・accent2・hueMap の色に付けると、その色から作る所が透ける。
// エラーの赤・成功の緑などは色合いを残し、明るさだけ配色に合わせる。半透明の黒・白(影など)はそのまま。
//   look    形と背景(書いた項目だけ置き換わる。書かない項目は今の見た目と同じ)
//             グラデーションは 9 か所(0%・12.5%・25%・…・100% の等間隔)の色で書く。色は #rrggbb・rgba(...)・color-mix(...)・var(--…) が使える
//             9 個より少なく書いたときは、0%〜100% に等間隔に並べて、間の色を混ぜて 9 か所にする
//             block   ブロック(項目の欄。sections に書いた項目):
//                       back: { gradation: [9 色], angle: 角度(度) }。既定は var(--sec-tint)(0%)→ 欄の地(52%)→ var(--sec-accent) 8%(100%)
//                       radius 角丸(px) / border 枠の太さ(px) / opacity 欄の地の不透明度(0〜1。alpha.card と同じ)
//             button  ボタン: back: { gradation: [9 色], angle }(ボタンのつや。既定は deco.btnGrad)/ radius 角丸(px)
//             go      生成ボタン: back: { gradation: [9 色], angle }(既定はボタンと同じ)/ radius 角丸(px)
//             panel   パネル・編集画面の地: back: { gradation: [9 色], angle }(既定は grad の 2 色・170 度)
//             modal   ダイアログの枠(画像の合成・ギャラリー・履歴・設定・使い方・PNGinfo・確認など): back / radius / border / borderColor
//             backdrop ダイアログの後ろの暗い部分の色(1 色)
//             editor  画像編集・動画編集の画面の地: back / radius / border / borderColor
//             inner   入れ子の枠(出力サイズの枠・入力画像の枠・LoRA の枠・結果の表示・説明の枠など): back / radius / border / borderColor
//             item    一覧の項目(ギャラリー・履歴・レイヤーの行・履歴の画像・サンプルワードなど): back / radius / border / borderColor
//             input   入力欄・プルダウン(生成パネル・編集画面・ダイアログ): back / radius / border / borderColor
//             borderColor(枠の色)は block・button・go にも書ける。color(文字の色)は notice・license・clip に書ける
//             notice  お知らせ: { error, info, warn } それぞれ back / radius / border / borderColor / color(エラー・お知らせ・注意の欄・帯)
//             license ライセンスの札: { ok 商用可, cond 条件付き, out 生成物のみ商用可, no 非商用のみ, unknown 不明 } それぞれ back / borderColor / color
//             clip    動画編集のタイムラインのクリップ: { clip 動画(つなげる), video 重ねる動画, image 画像, text 文字, shape 図形, mosaic モザイク, audio 音声, selected 選んでいる }
//                       それぞれ back / radius / border / borderColor / color
//             overlay 画像の上に重ねて出すもの(色。書いた色だけ置き換わる):
//                       frame 選んだ物の枠 / handleBg・handleBorder 取っ手 / crop 切り取りの枠 / dim 切り取りの外の暗い部分 / guide 吸い付きの目印
//                       artboard アートボードの枠 / remove オブジェクト除去の範囲 / brush・brush2 ブラシの円(外・内) / textedit 文字の編集枠 / caret 文字の入力位置
//                       path パスの線 / pathhandle パスの曲線の取っ手 / volume 音量の線
//             selection 文字を選んだときの色: { bg, fg }
//           例: look: { block: { back: { gradation: ["#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888", "#999"], angle: 135 }, radius: 12, opacity: 0.86 },
//                       button: { radius: 8 } }
// テーマの一覧。web/themes/ のファイル(1 ファイル 1 テーマ)を読み込んで入れる(loadThemes)。並びは order の小さい順
export const THEMES = [];
let themesLoading = null;
export function loadThemes(reload = false) {
  if (themesLoading && !reload) return themesLoading;
  const bust = reload ? `?t=${Date.now()}` : ""; // 取り込んだあとは、ブラウザに残っている古いファイルを使わない
  themesLoading = (async () => {
    let files = [];
    try {
      const r = await api.fetchApi("/cca_generator/themes", { cache: "no-store" });
      files = (await r.json()).files || [];
    } catch (e) { console.warn("[CCA Generator] テーマの一覧を読めませんでした:", e); }
    const base = new URL("./themes/", import.meta.url);
    const list = await Promise.all(files.map((f) => import(new URL(f, base).href + bust).then((m) => m.default)
      .catch((e) => { console.warn(`[CCA Generator] テーマ ${f} を読めませんでした:`, e); return null; })));
    const ok = list.filter((t) => t && typeof t === "object" && t.id);
    ok.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.id).localeCompare(String(b.id)));
    if (!ok.some((t) => t.id === "classic")) ok.push({ id: "classic", name: "クラシック", light: false, classic: true, order: 9999 });
    THEMES.splice(0, THEMES.length, ...ok);
    return THEMES;
  })();
  return themesLoading;
}
const DEFAULT = "cca10";
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
  const teal = Math.abs(h - 172) < 24, blue = h >= 196 && h <= 255, yellow = h >= 38 && h <= 58;
  let H = h, S = s;
  let A = base[3]; // 不透明度(色の元にした配色の色のもの)
  const hit = th.hueMap?.find(([c]) => hueDist(c, h) < 28);
  const hitMode = hit?.[2]; // "dark" = 中くらいの明るさの色を濃くする / "pale" = 白っぽくする
  if (teal || blue || yellow) { const src = hex((teal || blue) ? th.accent : th.accent2), [ah, as] = rgb2hsl(...src); H = ah; S = Math.max(0.25, Math.min(as, s)); A = src[3]; }
  else if (hit) { const src = hex(hit[1]), [ah, as] = rgb2hsl(...src); H = ah; S = Math.max(0.35, Math.min(as, s)); A = src[3]; } // 色合いを差し色に
  else if (th.rainbow) { H = PENCIL.reduce((p, q) => (hueDist(q, h) < hueDist(p, h) ? q : p)); S = Math.max(S, 0.75); } // いちばん近い色鉛筆の色に
  const bl = rgb2hsl(...base)[2];
  // 背景に近い暗い色・文字に近い明るい色は、置き換えた明るさにして色合いだけ残す
  if (l < 0.26 || l > 0.84) return [...hsl2rgb(H, Math.min(S, hitMode ? 0.22 : 0.5), bl), A];
  if (teal || blue) { const [, , al] = rgb2hsl(...hex(th.accent)); return [...hsl2rgb(H, S, clamp(al + (l - 0.4) * 0.8, 0.2, 0.8)), A]; }
  // 中くらいの明るさの色(文字や印): 明るい配色では暗めにして読めるようにする
  if (hit && hitMode === "dark") return [...hsl2rgb(H, S, 0.24), A];
  if (hit && hitMode === "pale") return [...hsl2rgb(H, S, 0.68), A];
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
  return fixTextColors(text.replace(COLOR, (all, pre, tok) => pre + mapToken(tok, th)), th);
}
// ---- 文字の色の読みやすさ: 置き換えた文字の色(color: の値)が、欄の地の色に対して薄すぎる(コントラスト 4.5 未満)ときは、
// テーマの文字の色(fg)に近づけて 4.5 以上にする。ほとんど地と同じ明るさの色(濃い色のボタンの上の文字など、別の地の上に乗る文字)は動かさない
const lumOf3 = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratioOf = (a, b) => { const x = lumOf3(a), y = lumOf3(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const TEXT_DECL = /(^|[{;\s])(color\s*:\s*)([^;}]+)/g;
function fixTextColors(text, th) {
  if (th.textContrast === false) return text; // テーマで止められる
  const ground = hex(th.vars?.["--card"] || th.bg), fg = hex(th.fg);
  if (!ground || !fg) return text;
  return text.replace(TEXT_DECL, (all, pre, prop, val) => pre + prop + val.replace(COLOR, (m, p2, tok) => {
    const c = hex(tok);
    if (!c) return m;
    const a = (c[3] ?? 255) / 255;
    const eff = (x) => [0, 1, 2].map((i) => x[i] * a + ground[i] * (1 - a));
    const r0 = ratioOf(eff(c), ground);
    if (r0 >= 4.5 || r0 < 1.6) return m;
    for (let t = 0.1; t <= 1.001; t += 0.1) {
      const n = [0, 1, 2].map((i) => Math.round(c[i] + (fg[i] - c[i]) * t));
      if (ratioOf(eff(n), ground) >= 4.5 || t > 0.95) return p2 + fmt([...n, c[3] ?? 255], 1);
    }
    return m;
  }));
}

// ---- 置き換える所
const ROOT = '#cca-ui, #cca-vedit, #cca-imged, [id^="cca-"], [class^="cca-"], [class*=" cca-"]';
const SKIP = '.stage, [data-c="stage"], [data-no-theme]'; // 画像・動画の中身は置き換えない
const styleOrig = new WeakMap(), attrRec = new WeakMap();
function doStyle(st) {
  if (st.id === "cca-theme-deco" || st.id === "cca-disabled-check") return; // 飾り(配色ごとに作る)・使えないチェックボックス(どの配色でも同じグレー)は置き換えない
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
// th.onFg: 地が濃い色なのに文字も暗いボタン(「開く」など)に印を付け、onFg の文字色にする。クラス名ではなく実際の色で見分ける。
// 「選んでいるボタン(.on)」は、オンとオフで地が変わるので印は付けず、CSS(decoCss)で指定する
const ONFG_ATTR = "data-cca-onfg";
function rgbaOf(css) {
  const m = /^(rgba?|color)\(([^)]*)\)/.exec(css || "");
  if (!m) return null;
  const n = m[2].replace("srgb", "").split(/[\s,/]+/).filter(Boolean).map(Number);
  if (n.length < 3 || n.slice(0, 3).some(Number.isNaN)) return null;
  const k = m[1] === "color" ? 255 : 1;
  return [n[0] * k, n[1] * k, n[2] * k, n.length > 3 && !Number.isNaN(n[3]) ? n[3] : 1];
}
function lumOf([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function markOnFg(root) {
  if (!cur?.onFg || !root || root.nodeType !== 1) return;
  for (const b of root.tagName === "BUTTON" ? [root] : root.querySelectorAll("button")) {
    if (b.classList.contains("on") || b.hasAttribute(ONFG_ATTR) || !b.closest(ROOT) || b.closest(SKIP)) continue;
    const cs = getComputedStyle(b), bg = rgbaOf(cs.backgroundColor), fg = rgbaOf(cs.color);
    if (bg && fg && bg[3] >= 0.5 && lumOf(bg) < 0.18 && lumOf(fg) < 0.35) b.setAttribute(ONFG_ATTR, "");
  }
}
function refreshOnFg() {
  for (const b of document.querySelectorAll(`[${ONFG_ATTR}]`)) b.removeAttribute(ONFG_ATTR);
  markOnFg(document.documentElement);
}
// テーマの select 項目 → CSS 変数。一覧(メニュー)は body 直下に作るので、開くたびに MENU_VARS の変数を一覧へ写す
const SELECT_VARS = {
  bg: "--sel-bg", fg: "--sel-fg", border: "--sel-border", arrow: "--sel-arrow",
  menuBg: "--sel-menu-bg", menuFg: "--sel-menu-fg", menuBorder: "--sel-menu-border",
  hoverBg: "--sel-hover-bg", hoverFg: "--sel-hover-fg",
  selectedBg: "--sel-selected-bg", selectedFg: "--sel-selected-fg",
  groupFg: "--sel-group-fg"
};
const MENU_VARS = ["--text", "--muted", "--border", "--card", "--card2", "--accent", "--accent-fg", ...Object.values(SELECT_VARS)];
const customSelects = new WeakMap();
// フォントを選ぶ欄(select[data-font-preview]): 一覧の項目を、そのフォントの見本で見せる。fn(値, 要素) で要素にフォントを付ける(動画編集が登録する)
let fontPreviewFn = null;
export function setFontPreview(fn) { fontPreviewFn = fn; }
const FONT_SAMPLE = "あいうえお 永 Abc 123";

// モデル・LoRA などのファイル名は、拡張子を出さない(選ぶ値はそのまま)
const noExt = (t) => String(t ?? "").replace(/\.(safetensors|ckpt|pt|pth|gguf|bin|sft|onnx)(?=$|[\s(（\[])/gi, "");
function initCustomSelects() {
  const roots = LOOK_ROOTS; // 生成パネル・編集画面・すべてのダイアログのプルダウンを作り直す

  let style = document.getElementById("cca-custom-select-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "cca-custom-select-style";
    style.textContent = `
      .cca-select-wrap {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
        min-width: 0;
      }
      .cca-select-native {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        overflow: hidden !important;
      }
      .cca-select-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        min-width: 0;
        cursor: pointer;
        text-align: left;
        color: var(--text, inherit);
      }
      .cca-select-button:disabled {
        cursor: not-allowed;
        opacity: .55;
      }
      .cca-select-label {
        display: inline-grid;
        min-width: 0;
        white-space: nowrap;
      }
      .cca-select-label span {
        grid-area: 1 / 1;
        min-width: 0;
      }
      .cca-select-label-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cca-select-label-sizer {
        visibility: hidden;
        height: 0;
        overflow: hidden;
      }
      .cca-select-arrow {
        flex: none;
      }
      .cca-select-menu.fontpv { max-height: min(460px, 70vh); }
      .cca-select-menu.fontpv .cca-select-option { display: block; }
      .cca-select-fname { display: block; font-size: 11px; opacity: .75; line-height: 1.3; }
      .cca-select-fsample { display: block; font-size: 21px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cca-select-menu {
        position: fixed;
        z-index: 2147483000;
        overflow-y: auto;
        max-height: 320px;
        padding: 4px;
        border: 1px solid var(--sel-menu-border, var(--border, #888));
        border-radius: 6px;
        background: var(--sel-menu-bg, var(--card, Canvas));
        color: var(--sel-menu-fg, var(--text, CanvasText));
        box-shadow: 0 5px 18px rgba(0,0,0,.28);
      }
      .cca-select-filter {
        position: sticky;
        top: 0;
        z-index: 1;
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 4px;
        padding: 6px 8px;
        border: 1px solid var(--sel-menu-border, var(--border, #888));
        border-radius: 6px;
        background: var(--sel-menu-bg, var(--card, Canvas));
        color: var(--sel-menu-fg, var(--text, CanvasText));
        font: inherit;
      }
      .cca-select-none {
        padding: 8px 9px;
        opacity: .7;
      }
      .cca-select-option {
        display: block;
        width: 100%;
        padding: 6px 9px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        text-align: left;
        white-space: normal;
        cursor: pointer;
      }
      .cca-select-option:hover,
      .cca-select-option:focus {
        background: var(--sel-hover-bg, var(--card2, color-mix(in srgb, currentColor 18%, transparent))) !important;
        color: var(--sel-hover-fg, var(--text, inherit)) !important;
      }

      .cca-select-option[aria-selected="true"] {
        background: var(--sel-selected-bg, var(--accent, Highlight)) !important;
        color: var(--sel-selected-fg, var(--accent-fg, HighlightText)) !important;
      }
      .cca-select-option:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      .cca-select-group {
        padding: 7px 9px 3px;
        color: var(--sel-group-fg, var(--muted, inherit));
        font-size: .85em;
        font-weight: bold;
      }
      .cca-select-lic {
        margin-left: 6px;
      }
      .cca-select-note {
        display: block;
        margin-top: 1px;
        font-size: 12px;
        font-weight: 400;
        line-height: 1.35;
        opacity: .75;
      }
      .cca-select-arrow {
        color: var(--sel-arrow, inherit);
      }
    `;
    document.head.appendChild(style);
  }

  document.querySelectorAll(`:is(${roots}) select:not([multiple]):not([size]):not([data-lorapick])`).forEach(select => {
    if (customSelects.has(select)) return;

    const rect = select.getBoundingClientRect();
    const cs = getComputedStyle(select);

    const wrap = document.createElement("span");
    wrap.className = "cca-select-wrap";
    const fixedWidth = rect.width > 0
      ? `${rect.width}px`
      : (cs.width && cs.width !== "auto" ? cs.width : "");
    wrap.style.width = fixedWidth;
    wrap.style.flex = cs.flex;
    // 幅が決まっているときはこれまで通り。決まっていない(非表示のうちに作られた)ときだけ中身の幅に合わせ、親からははみ出さない
    wrap.style.minWidth = fixedWidth ? cs.minWidth : "max-content";
    wrap.style.maxWidth = cs.maxWidth !== "none" ? cs.maxWidth : "100%"; // 作ったときの幅(px)のままだと、欄が狭くなったときに隣の部品に重なるので、親の幅までに収める

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cca-select-button";
    button.setAttribute("data-no-theme", "");
    button.disabled = select.disabled;

    for (const prop of [
      "font", "fontFamily", "fontSize", "fontWeight",
      "lineHeight", "color", "backgroundColor", "border",
      "borderRadius", "padding", "boxSizing", "minHeight",
      "letterSpacing"
    ]) {
      button.style[prop] = cs[prop];
    }

    button.style.width = "100%";
    button.style.height = rect.height > 0 ? `${rect.height}px` : "";

    const label = document.createElement("span");
    label.className = "cca-select-label";
    const labelText = document.createElement("span");
    labelText.className = "cca-select-label-text";
    const labelSizers = document.createElement("span");
    labelSizers.className = "cca-select-label-sizers";
    labelSizers.style.display = "contents";
    labelSizers.setAttribute("aria-hidden", "true");
    label.append(labelText, labelSizers);
    let sizerKey = null;
    const arrow = document.createElement("span");
    arrow.className = "cca-select-arrow";
    arrow.textContent = "▾";
    arrow.setAttribute("aria-hidden", "true");
    button.append(label, arrow);

    const menu = document.createElement("div");
    menu.className = "cca-select-menu";
    menu.setAttribute("data-no-theme", "");
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    // 画像・動画のファイルの項目は、カーソルを乗せるとその絵をカーソルの横に出す
    hoverPreview(menu, ".cca-select-option", (it) => it.dataset.pv || "");

    function sync() {
      const text = noExt(select.selectedOptions[0]?.textContent ?? "");
      if (labelText.textContent !== text) labelText.textContent = text;
      // フォントを選ぶ欄: 選んでいるフォントで名前を見せる
      if (select.hasAttribute("data-font-preview") && fontPreviewFn && labelText._fk !== select.value) { labelText._fk = select.value; try { fontPreviewFn(select.value, labelText); } catch { /* 見本が出せなくても選べる */ } }
      button.disabled = select.disabled;

      const texts = Array.from(select.options, o => noExt(o.textContent));
      const key = texts.join("\n");
      if (key !== sizerKey) {
        sizerKey = key;
        labelSizers.replaceChildren(...texts.map(t => {
          const s = document.createElement("span");
          s.className = "cca-select-label-sizer";
          s.textContent = t;
          return s;
        }));
      }
    }

    function refresh() {
      const c = getComputedStyle(select);
      for (const prop of ["color", "backgroundColor", "border"]) button.style[prop] = c[prop];
    }

    function close() {
      hidePreview();
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }

    function open() {
      sync();
      menu.replaceChildren();
      let hasNote = false;
      // 絞り込み(生成パネル・フォルダ設定・モデルの案内の選択欄)
      let filter = null;
      const fontPv = select.hasAttribute("data-font-preview") && !!fontPreviewFn;
      menu.classList.toggle("fontpv", fontPv);
      // フォントの見本: 見えている項目だけ、そのフォントを読み込んで付ける
      menu._io?.disconnect();
      menu._io = fontPv ? new IntersectionObserver((ents) => {
        for (const en of ents) {
          if (!en.isIntersecting) continue;
          menu._io.unobserve(en.target);
          try { fontPreviewFn(en.target.dataset.fv, en.target); } catch { /* 見本が出せなくても選べる */ }
        }
      }, { root: menu, rootMargin: "120px 0px" }) : null;
      if (select.closest("#cca-ui, #cca-dirs, #cca-guide") || fontPv) {
        filter = document.createElement("input");
        filter.type = "text";
        filter.className = "cca-select-filter";
        filter.placeholder = T("絞り込み(文字を入力)");
        filter.setAttribute("autocomplete", "off");
        menu.appendChild(filter);
      }

      const addOption = (option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "cca-select-option";
        item.setAttribute("role", "option");
        item.setAttribute(
          "aria-selected",
          String(index === select.selectedIndex)
        );
        // 説明書き(data-note)・ライセンス表示(data-lic-html)がある選択肢は、名前の下に説明を出す(生成パネルの「利用モデルの種類」)
        const note = option.dataset?.note || "";
        const lic = option.dataset?.licHtml || "";
        if (note || lic) {
          const name = document.createElement("span");
          name.className = "cca-select-name";
          name.textContent = option.textContent;
          item.appendChild(name);
          if (lic) {
            const badge = document.createElement("span");
            badge.className = "cca-select-lic";
            badge.innerHTML = lic;
            item.appendChild(badge);
          }
          if (note) {
            const nt = document.createElement("span");
            nt.className = "cca-select-note";
            nt.textContent = note;
            item.appendChild(nt);
            item.title = `${option.textContent} — ${note}`;
            hasNote = true;
          }
        } else if (fontPv) {
          const name = document.createElement("span");
          name.className = "cca-select-fname";
          name.textContent = option.textContent;
          const sample = document.createElement("span");
          sample.className = "cca-select-fsample";
          sample.textContent = select.dataset.fontSample || FONT_SAMPLE;
          sample.dataset.fv = option.value;
          item.append(name, sample);
          item.title = option.textContent;
          menu._io.observe(sample);
        } else {
          item.textContent = noExt(option.textContent);
        }
        item.disabled = option.disabled;
        if (mediaKind(option.value)) item.dataset.pv = option.value;

        item.addEventListener("click", () => {
          select.selectedIndex = index;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          sync();
          close();
          button.focus();
        });

        menu.appendChild(item);
      };

      Array.from(select.children).forEach(child => {
        if (child.tagName === "OPTGROUP") {
          const heading = document.createElement("div");
          heading.className = "cca-select-group";
          heading.textContent = child.label;
          menu.appendChild(heading);

          Array.from(child.children).forEach(option => {
            addOption(option, Array.from(select.options).indexOf(option));
          });
        } else if (child.tagName === "OPTION") {
          addOption(child, Array.from(select.options).indexOf(child));
        }
      });

      const vs = getComputedStyle(wrap);
      for (const n of MENU_VARS) {
        const v = vs.getPropertyValue(n).trim();
        if (v) menu.style.setProperty(n, v);
        else menu.style.removeProperty(n);
      }

      const r = button.getBoundingClientRect();
      menu.style.minWidth = `${r.width}px`;
      if (fontPv) {
        const nw = Math.min(window.innerWidth - 16, Math.max(r.width, 360));
        menu.style.width = `${nw}px`;
        menu.style.maxWidth = `${nw}px`;
        menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - nw - 8))}px`;
      } else if (hasNote) {
        // 説明書きは折り返して表示する(幅は、選択欄の幅か 300px の大きいほう)
        const nw = Math.min(window.innerWidth - 16, Math.max(r.width, 300));
        menu.style.width = `${nw}px`;
        menu.style.maxWidth = `${nw}px`;
        menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - nw - 8))}px`;
      } else {
        menu.style.width = "max-content";
        menu.style.maxWidth = `${Math.max(r.width, window.innerWidth - r.left - 8)}px`;
        menu.style.left = `${r.left}px`;
      }

      // 非表示のままでは高さが 0 になり 320 で計算してしまうので、見えない状態で表示して実際の高さを測る
      const place = () => {
        const menuHeight = menu.offsetHeight;
        const below = window.innerHeight - r.bottom;
        menu.style.top = below >= menuHeight + 8
          ? `${r.bottom + 3}px`
          : `${Math.max(4, r.top - menuHeight - 3)}px`;
      };
      menu.style.visibility = "hidden";
      menu.hidden = false;
      place();
      menu.style.visibility = "";
      button.setAttribute("aria-expanded", "true");

      if (filter) {
        const none = document.createElement("div");
        none.className = "cca-select-none";
        none.textContent = T("一致するものがありません");
        none.style.display = "none";
        menu.appendChild(none);
        filter.addEventListener("input", () => {
          const q = filter.value.trim().toLowerCase();
          let head = null, headShown = false, any = false;
          for (const el of menu.children) {
            if (el.classList.contains("cca-select-group")) { head = el; headShown = false; el.style.display = q ? "none" : ""; continue; }
            if (!el.classList.contains("cca-select-option")) continue;
            const hit = !q || el.textContent.toLowerCase().includes(q) || (el.title || "").toLowerCase().includes(q);
            el.style.display = hit ? "" : "none";
            if (hit) { any = true; if (head && !headShown) { head.style.display = ""; headShown = true; } }
          }
          none.style.display = any ? "none" : "";
          place();
        });
        filter.addEventListener("keydown", event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = [...menu.querySelectorAll(".cca-select-option:not(:disabled)")].find(x => x.style.display !== "none");
          first?.click();
        });
        filter.focus({ preventScroll: true });
      }

      const selected = menu.querySelector('[aria-selected="true"]');
      selected?.scrollIntoView({ block: "nearest" });
    }

    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");

    button.addEventListener("click", () => {
      if (menu.hidden) open();
      else close();
    });

    button.addEventListener("keydown", event => {
      // 上下キー: 開かずに、前・次の選択肢へ(ふつうのプルダウンと同じ)。Alt + 下・Enter・スペースで一覧を開く
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey && menu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        const opts = [...select.options];
        let i = select.selectedIndex;
        for (;;) {
          i += event.key === "ArrowDown" ? 1 : -1;
          if (i < 0 || i >= opts.length) return;
          if (!opts[i].disabled) break;
        }
        select.selectedIndex = i;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        return;
      }
      if (event.key === "Enter" || event.key === " " || (event.key === "ArrowDown" && event.altKey)) {
        event.preventDefault();
        open();
        menu.querySelector('[aria-selected="true"]')?.focus();
      }
    });

    menu.addEventListener("keydown", event => {
      const items = [...menu.querySelectorAll(".cca-select-option:not(:disabled)")].filter(x => x.style.display !== "none");
      const current = items.indexOf(document.activeElement);

      if (event.key === "Escape") {
        close();
        button.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown"
          ? Math.min(current + 1, items.length - 1)
          : Math.max(current - 1, 0);
        items[next]?.focus();
      }
    });

    document.addEventListener("pointerdown", event => {
      if (!wrap.contains(event.target) && !menu.contains(event.target)) {
        close();
      }
    });

    select.addEventListener("change", sync);
    select.addEventListener("input", sync);
    // プログラムから値・選択肢・無効状態が変わったときも表示を合わせる(change が出ないため、表示が古いままになっていた)
    new MutationObserver(() => sync()).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected", "label"], characterData: true });
    for (const prop of ["value", "selectedIndex"]) {
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      if (d?.set) Object.defineProperty(select, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } });
    }

    select.before(wrap);
    wrap.append(button, select);
    document.body.appendChild(menu);
    select.classList.add("cca-select-native");

    customSelects.set(select, { wrap, button, menu, sync, refresh });
    sync();
  });
}
function refreshCustomSelects() {
  for (const s of document.querySelectorAll("select.cca-select-native")) customSelects.get(s)?.refresh();
}
let obs = null;
// 使えない(押せない)チェックボックス・ラジオボタン: 中をグレーにして、枠も見えるように(どのテーマでも)
function disabledCheckCss() {
  if (document.getElementById("cca-disabled-check")) return;
  const s = document.createElement("style");
  s.id = "cca-disabled-check";
  const R = LOOK_ROOTS.split(",").map((x) => x.trim()).filter(Boolean).map((x) => `${x} input[type=checkbox]:disabled`).join(",");
  const check = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-5' fill='none' stroke='%23444' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
  // 編集画面の入力欄の決まり(地の色・半透明)より強く当てる(!important)
  s.textContent = `${R}{-webkit-appearance:none !important;appearance:none !important;width:13px !important;height:13px !important;margin:3px 3px 3px 4px;flex:none;box-sizing:border-box !important;border:1.5px solid #8c8c8c !important;border-radius:3px !important;background:#a9a9a9 center/11px 11px no-repeat !important;opacity:1 !important;filter:none !important;box-shadow:none !important;outline:none !important;cursor:default !important;vertical-align:middle}
${R.split(",").map((x) => `${x}:checked`).join(",")}{background-image:url("${check}") !important}`;
  document.head.appendChild(s);
}
// 横に並べた行(ボタンなど)が折り返したときは、各行の物を行の幅いっぱいに広げる(1 個だけ取り残されて見えないように)。
// 折り返していない行はそのまま。プルダウンは先に縮めて、となりのボタンと同じ行に入りやすくする
const WRAP_ROWS = ".row, .tools, .transport, .ph2, .adjp, .ckrow, .hd, .ft";
let wrapTimer = 0, wrapRo = null;
function markWrapped() {
  wrapTimer = 0;
  for (const root of document.querySelectorAll(LOOK_ROOTS)) {
    if (!root.offsetParent && getComputedStyle(root).position !== "fixed") continue;
    for (const r of root.querySelectorAll(WRAP_ROWS)) {
      if (!r.offsetParent || r.closest(".tl, .stage, .frame")) continue;
      if (wrapRo && !r._ccaWrapObs) { r._ccaWrapObs = true; wrapRo.observe(r); } // 行の幅が変わったら見直す
      let wrapped = false;
      if (getComputedStyle(r).flexWrap === "wrap") {
        const kids = [...r.children].filter((c) => c.offsetParent && getComputedStyle(c).position !== "absolute");
        if (kids.length > 1) { const b0 = kids[0].getBoundingClientRect().bottom; wrapped = kids.some((c) => c.getBoundingClientRect().top >= b0 - 2); }
      }
      if (r.classList.contains("cca-wrapped") !== wrapped) r.classList.toggle("cca-wrapped", wrapped);
    }
  }
}
const scheduleWrap = () => { if (!wrapTimer) wrapTimer = setTimeout(markWrapped, 150); };
function wrapRows() {
  if (document.getElementById("cca-wrap-rows")) return;
  const st = document.createElement("style");
  st.id = "cca-wrap-rows";
  const R = `:is(${LOOK_ROOTS})`;
  st.textContent = `${R} .cca-wrapped > :not(.sp):not(.sep):not(.grow){flex-grow:1}
${R} :is(.row, .tools) > :is(select.grow, .cca-select-button){min-width:0;flex:1 1 8em}`;
  document.head.appendChild(st);
  window.addEventListener("resize", scheduleWrap);
  new MutationObserver(scheduleWrap).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "open"] });
  if (window.ResizeObserver) wrapRo = new ResizeObserver(scheduleWrap);
  scheduleWrap();
}
export async function startTheme() {
  disabledCheckCss();
  wrapRows();
  await loadThemes();
  cur = themeOf(themeChoice());
  if (obs) return;
  obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") doAttr(m.target);
      else if (m.type === "characterData" || (m.type === "childList" && m.target.tagName === "STYLE")) {
        const st = m.type === "characterData" ? m.target.parentNode : m.target;
        if (st?.tagName === "STYLE" && st.textContent !== st.__ccaSet) { styleOrig.delete(st); doStyle(st); }
      } else for (const n of m.addedNodes) { doTree(n); markOnFg(n); }
    }
  initCustomSelects();
  });
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"], characterData: true });
  if (cur) all();
  initCustomSelects();
  applyDeco();
  refreshOnFg();
}
function themeOf(id) { const t = THEMES.find((x) => x.id === id) || THEMES.find((x) => x.id === DEFAULT); return !t || t.classic ? null : prepTheme(t); }
// ---------------------------------------------------------------- テーマの値の確かめと直し
// AI などが作ったテーマでも崩れないようにする: 色の書き方をそろえる・地の明るさと light を合わせる・
// 文字と地のコントラストが足りない組み合わせ(書いた色どうし)を、読める色に直す。直したものは写しに入れ、元のテーマは変えない
let ctx2d = null;
// どんな CSS の色(#rgb・#rrggbbaa・rgb()・rgba()・hsl()・色の名前)でも [r, g, b, 不透明度 0〜255] に。読めなければ null
function colorOf(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return hex(s);
  try {
    ctx2d ||= document.createElement("canvas").getContext("2d");
    ctx2d.fillStyle = "#010203";
    ctx2d.fillStyle = s;
    const o = String(ctx2d.fillStyle);
    if (o === "#010203") return null; // 読めない色(そのままになる)
    if (o.startsWith("#")) return hex(o);
    const m = o.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2], Math.round((m[3] != null ? +m[3] : 1) * 255)] : null;
  } catch { return null; }
}
const hex8 = (c) => `#${c.slice(0, 3).map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}${(c[3] ?? 255) >= 255 ? "" : clamp(Math.round(c[3]), 0, 255).toString(16).padStart(2, "0")}`;
const over = (c, g) => { const a = (c[3] ?? 255) / 255; return [0, 1, 2].map((i) => c[i] * a + g[i] * (1 - a)); }; // 地 g の上に重ねた色
// グラデーション・色の並び(配列か CSS)の平均の色
function avgColor(v, ground) {
  const list = (Array.isArray(v) ? v : String(v || "").match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || []).map(colorOf).filter(Boolean);
  if (!list.length) return null;
  const s = list.map((c) => over(c, ground)).reduce((a, c) => a.map((x, i) => x + c[i]), [0, 0, 0]);
  return s.map((x) => x / list.length);
}
// 地 bg の上で、文字 fg のコントラストが min 未満なら、読める色を返す(テーマの文字の色・地の色・白・黒の順に、足りるもの。
// どれも足りなければいちばん読めるもの)。足りていれば null
let candFg = [[255, 255, 255], [0, 0, 0]];
function readable(fg, bg, min = 3) {
  if (!fg || !bg) return null;
  if (ratioOf(over(fg, bg), bg) >= min) return null;
  const c = candFg.concat([[255, 255, 255], [0, 0, 0]]);
  return hex8(c.find((x) => ratioOf(x, bg) >= min) || c.reduce((a, x) => (ratioOf(x, bg) > ratioOf(a, bg) ? x : a)));
}
const prepCache = new WeakMap();
export function prepTheme(t) {
  if (!t || t.classic) return t;
  if (prepCache.has(t)) return prepCache.get(t);
  const th = JSON.parse(JSON.stringify(t));
  const fixed = [];
  // 色の書き方を #rrggbb(aa) にそろえる(処理が 16 進の色を前提にしている所)
  const norm = (o, k) => { if (typeof o?.[k] !== "string") return; const c = colorOf(o[k]); if (c && !/^#[0-9a-f]{3,8}$/i.test(o[k].trim())) o[k] = hex8(c); else if (!c) { fixed.push(k); delete o[k]; } };
  for (const k of ["bg", "fg", "accent", "accent2"]) norm(th, k);
  if (Array.isArray(th.grad)) th.grad.forEach((_, i) => norm(th.grad, i));
  if (Array.isArray(th.hueMap)) th.hueMap = th.hueMap.filter((h) => Array.isArray(h) && colorOf(h[1])).map((h) => { const x = [...h]; norm(x, 1); return x; });
  if (!th.bg) th.bg = th.light ? "#f5f5f5" : "#16191e";
  if (!th.fg) th.fg = lumOf3(hex(th.bg)) > 0.35 ? "#1a1a1a" : "#eeeeee";
  if (!th.accent) th.accent = th.light ? "#2b6cb0" : "#38b2ac";
  if (!th.accent2) th.accent2 = th.accent;
  if (!th.sections || typeof th.sections !== "object") th.sections = {}; // 書いていなければ、ブロックは強調色から色を付ける
  // 色の変数(vars): 書いていない項目は、地・文字・強調色から作る(文字の色などはこの変数を使うので、無いと読めなくなる)
  {
    const B = hex(th.bg), F = hex(th.fg), mx = (t) => hex8(B.map((v, i) => v + (F[i] - v) * t)), lt = lumOf3(B) > 0.35;
    const ac = hex(th.accent), onAc = ratioOf(F, ac) >= ratioOf(B, ac) ? th.fg : th.bg;
    th.vars = {
      "--bg": th.bg, "--panel": mx(0.03), "--card": mx(0.06), "--card2": mx(0.12), "--text": th.fg, "--muted": mx(0.7),
      "--border": `rgba(${F[0]}, ${F[1]}, ${F[2]}, 0.22)`, "--accent": th.accent, "--accent2": th.accent2, "--accent-fg": onAc,
      "--danger": lt ? "#b3261e" : "#ff6b6b", "--warn": lt ? "#8a6a1c" : "#ffd166", "--ok": lt ? "#2e7d32" : "#5fd38d",
      ...(th.vars && typeof th.vars === "object" ? th.vars : {}),
    };
  }
  // light は地の明るさに合わせる(書き忘れ・逆に書いたとき)
  const bgL = lumOf3(hex(th.bg)), light = bgL > 0.35;
  if (typeof th.light !== "boolean" || th.light !== light) { if (typeof th.light === "boolean") fixed.push("light"); th.light = light; }
  const bg = over(hex(th.bg), [128, 128, 128]);
  candFg = [over(hex(th.fg), bg), bg];
  const ground = over(colorOf(th.vars?.["--card"]) || hex(th.bg), bg);
  if (ratioOf(over(hex(th.fg), ground), ground) < 3) { th.fg = ratioOf([255, 255, 255], ground) > ratioOf([0, 0, 0], ground) ? "#f2f2f2" : "#1a1a1a"; fixed.push("fg"); candFg = [hex(th.fg), bg]; }
  const accent = over(colorOf(th.vars?.["--accent"]) || hex(th.accent), ground);
  const fix = (o, k, bgc, min = 3) => { if (!o || o[k] == null) return; const c = colorOf(o[k]); if (!c) { fixed.push(k); delete o[k]; return; } const n = readable(c, bgc, min); if (n) { o[k] = n; fixed.push(k); } };
  if (th.vars) fix(th.vars, "--accent-fg", accent, 2);
  fix(th, "onFg", accent, 2);
  if (th.deco) fix(th.deco, "goColor", accent, 2);
  const sl = th.select;
  if (sl) {
    const g = (k) => colorOf(sl[k]) ? over(colorOf(sl[k]), ground) : null;
    if (g("bg")) fix(sl, "fg", g("bg"));
    if (g("menuBg")) fix(sl, "menuFg", g("menuBg"));
    if (g("hoverBg")) fix(sl, "hoverFg", g("hoverBg"));
    if (g("selectedBg")) fix(sl, "selectedFg", g("selectedBg"));
  }
  const tn = th.tune;
  if (tn) {
    fix(tn, "selFg", accent);
    fix(tn, "labelColor", ground, 4.5);
    fix(tn, "descColor", ground, 4.5);
    if (colorOf(tn.infoBg)) fix(tn, "infoFg", over(colorOf(tn.infoBg), ground), 3);
    if (tn.spin && colorOf(tn.spin.bg)) fix(tn.spin, "fg", over(colorOf(tn.spin.bg), ground), 3);
    if (tn.layerSel) { // 選んでいるレイヤーの行の文字: 書いていなければ、地に合わせて読める色にする
      const lb = avgColor(tn.layerSel.bg, ground) || ground;
      tn.layerSel.fg = tn.layerSel.fg && colorOf(tn.layerSel.fg) ? tn.layerSel.fg : th.fg;
      fix(tn.layerSel, "fg", lb);
    }
  }
  if (th.snapOn && colorOf(th.snapOn.bg)) fix(th.snapOn, "fg", over(colorOf(th.snapOn.bg), ground), 3);
  if (th.secDoneFg) { const m = mapRGB(th, 0x3a, 0x34, 0x17, 1) || hex(th.bg); fix(th, "secDoneFg", over(m, ground)); }
  const lk = th.look;
  if (lk?.selection && colorOf(lk.selection.bg)) fix(lk.selection, "fg", over(colorOf(lk.selection.bg), ground));
  for (const grp of ["notice", "license", "clip"]) for (const v of Object.values(lk?.[grp] || {})) {
    const b = v?.back?.gradation ? avgColor(v.back.gradation, ground) : null;
    if (b && v.color) fix(v, "color", b);
  }
  // リンクの色: 書いていなければ強調色から、地に対して読める色を作る
  th.link = th.link && colorOf(th.link) ? th.link : th.accent;
  fix(th, "link", ground, 4.5);
  // 強調色の地に乗る白い文字(回転の取っ手など)
  th._accentFg = readable([255, 255, 255], accent) ? (readable([0, 0, 0], accent) ? "#ffffff" : "#000000") : "#ffffff";
  if (fixed.length) console.info(`[CCA Generator] テーマ「${th.id}」の読みにくい色・読めない値を直しました:`, [...new Set(fixed)].join(", "));
  prepCache.set(t, th);
  return th;
}
// テーマのファイルの中身(.js・.txt)→ テーマ。AI の説明文・Markdown のコードブロック・JSON の形でも、値の部分を取り出して読む
export async function themeFromText(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const ok = (t) => t && typeof t === "object" && !Array.isArray(t);
  const load = async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try { return (await import(url)).default; } finally { URL.revokeObjectURL(url); }
  };
  try { const t = await load(src); if (ok(t)) return t; } catch { /* 次の読み方で */ }
  // コードブロック(大きい順)と全体から、最初の { から最後の } までを値として読む
  const blocks = [...src.matchAll(/```[^\n]*\n([\s\S]*?)(```|$)/g)].map((m) => m[1]).sort((a, b) => b.length - a.length);
  for (const s of [...blocks, src]) {
    const i = s.indexOf("{"), j = s.lastIndexOf("}");
    if (i < 0 || j <= i) continue;
    const body = s.slice(i, j + 1);
    try { const t = await load(`export default (${body});`); if (ok(t)) return t; } catch { /* 次へ */ }
    try { const t = JSON.parse(body); if (ok(t)) return t; } catch { /* 次へ */ }
  }
  const open = (src.match(/\{/g) || []).length, close = (src.match(/\}/g) || []).length;
  throw new Error(open > close ? T("ファイルが途中で切れているようです(最後が }; で終わっていません)。AI に「続きを最後まで」と頼むか、省略できる項目を減らして作り直してもらってください")
    : T("export default { … } の形のテーマではありません"));
}
export function themeChoice() { try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; } }
// 飾り: 背景のグラデーション・ボタンのハイライトと内側の影(半透明に見えるように)・生成ボタン(少し透かした強調の色・白い縁・黒のぼかしの影)・欄を少し透かす
const mixHex = (a, b, t) => toHex(hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)));
// ---------------------------------------------------------------- 形と背景(look): 9 か所のグラデーション
const STOPS9 = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
// 一番上の , で分ける(かっこの中の , は分けない)
function splitTop(s) {
  const out = [];
  let d = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") d++;
    if (ch === ")") d--;
    if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// "linear-gradient(180deg, A, B 48%, C)" → { angle, stops: [[位置, 色], …] }。位置の無い色は前後の間に等間隔に置く
function parseGrad(css) {
  const m = /^\s*linear-gradient\((.*)\)\s*$/s.exec(css || "");
  if (!m) return null;
  const parts = splitTop(m[1]);
  let angle = "180deg";
  if (/^-?[\d.]+deg$|^to /.test(parts[0] || "")) angle = parts.shift();
  if (!parts.length) return null;
  const st = parts.map((x) => { const mm = /^(.*?)\s+(-?[\d.]+)%$/.exec(x); return mm ? [mm[1].trim(), Number(mm[2])] : [x, null]; });
  if (st[0][1] == null) st[0][1] = 0;
  if (st[st.length - 1][1] == null) st[st.length - 1][1] = 100;
  for (let i = 1; i < st.length; i++) {
    if (st[i][1] != null) continue;
    let j = i;
    while (st[j][1] == null) j++;
    const a = st[i - 1][1], b = st[j][1];
    for (let k = i; k < j; k++) st[k][1] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return { angle, stops: st.map(([c, q]) => [q, c]) };
}
// [[位置, 色], …] → 9 か所の色(間は前後の色を混ぜる)
function to9(stops) {
  return STOPS9.map((q) => {
    if (q <= stops[0][0]) return stops[0][1];
    if (q >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    const i = stops.findIndex(([x]) => x >= q), [a, ca] = stops[i - 1], [b, cb] = stops[i];
    if (b === q) return cb;
    const w = Math.round((1 - (q - a) / (b - a)) * 1000) / 10;
    return `color-mix(in srgb, ${ca} ${w}%, ${cb})`;
  });
}
// テーマの back({ gradation, angle })→ CSS の変数(--<名前>-angle・--<名前>-g1〜g9)。書かなければ既定の色から作る
function nineVars(name, back, defAngle, defStops) {
  const g = back?.gradation;
  const list = Array.isArray(g) && g.length ? (g.length === 9 ? g : to9(g.map((c, i) => [g.length === 1 ? 0 : (i * 100) / (g.length - 1), c]))) : to9(defStops);
  const ang = back?.angle == null ? defAngle : (typeof back.angle === "number" ? `${back.angle}deg` : back.angle);
  return [`--${name}-angle:${ang}`, ...list.map((c, i) => `--${name}-g${i + 1}:${c}`)].join(";");
}
const gradOf = (name) => `linear-gradient(var(--${name}-angle), ${STOPS9.map((q, i) => `var(--${name}-g${i + 1}) ${q}%`).join(", ")})`;
const pxOf = (v) => (typeof v === "number" ? `${v}px` : String(v));
// look の種類ごとの場所(:where で弱くして使う。!important で元の色に勝つ)
const LOOK_ROOTS = "#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask,#cca-comp,#cca-pnginfo,#cca-layout,#cca-gal,#cca-hbox,#cca-wm,#cca-dirs,#cca-mediadirs,#cca-guide,#cca-addon,#cca-mg,#cca-gfont,#cca-vpick,#cca-pdfpick,#cca-pop,.cca-askclose";
const LOOK_SEL = {
  modal: "#cca-comp .box, #cca-gal .win, #cca-hbox .hb, #cca-layout .win, #cca-mg .win, #cca-pnginfo .box, #cca-setio .bx, .cca-askclose > div, #cca-guide .box, #cca-addon .box, #cca-dirs .box, #cca-mediadirs .box, #cca-pop, #cca-gfont .pb, #cca-vpick .pb, #cca-pdfpick .pb, #cca-wm .wb, #cca-mask .mb",
  inner: "#cca-ui .card .card, #cca-ui .sizebox, #cca-ui .slot, #cca-ui .drop, #cca-ui .viewer, #cca-ui .audiohelp, #cca-ui .layoutrow, #cca-ui .help, .cca-help, #cca-ui .info .txt, #cca-ui .tilebox, #cca-ui .tprev, #cca-ui .foldbox, #cca-ui .wced, #cca-ui .editinfo, #cca-layout .row, #cca-layout .bx .h, #cca-mg .licbox, #cca-vedit .kfrow, #cca-imged .guide .lead, #cca-setio .msg, #cca-comp .guide",
  editor: "#cca-imged > .box, #cca-vedit > .box",
  item: "#cca-gal .it, #cca-hbox .it, #cca-hbox .th, #cca-wm .it, #cca-wm .it .th, #cca-imged .ly, #cca-ui .hist .t, #cca-ui .words .chip",
  input: `:is(${LOOK_ROOTS}) :is(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea, select), .cca-select-button`,
};
// お知らせ・ライセンスの札・タイムラインのクリップ(種類ごと)
const LOOK_SUB = {
  notice: { error: "#cca-toast .t.error, #cca-ui .inl-msg.error, #cca-ui .err", info: "#cca-toast .t.info, #cca-ui .inl-msg.info", warn: "#cca-ui .warn, #cca-vedit .warn" },
  license: { ok: ".cca-lic.ok.ok", cond: ".cca-lic.cond.cond", out: ".cca-lic.out.out", no: ".cca-lic.no.no", unknown: ".cca-lic.unknown.unknown" },
  clip: { clip: "#cca-vedit .blk.clip.clip", video: "#cca-vedit .blk.video.video", image: "#cca-vedit .blk.image.image", text: "#cca-vedit .blk.text.text", shape: "#cca-vedit .blk.shape.shape", mosaic: "#cca-vedit .blk.mosaic.mosaic", audio: "#cca-vedit .blk.audio.audio", selected: "#cca-vedit .blk.sel.sel.sel" },
};
// 1 つの場所に、back・radius・border・borderColor・color を当てる。weak = :where で弱くする(sel の強さで当てるときは false)
function lookPartsCss(sel, cfg, name, weak) {
  if (!cfg) return "";
  const parts = [];
  if (cfg.back) parts.push(`${nineVars(name, cfg.back, "180deg", [[0, "transparent"], [100, "transparent"]])};background:${gradOf(name)} !important`);
  if (cfg.radius != null) parts.push(`border-radius:${pxOf(cfg.radius)} !important`);
  if (cfg.border != null) parts.push(`border-width:${pxOf(cfg.border)} !important;border-style:solid !important`);
  if (cfg.borderColor) parts.push(`border-color:${cfg.borderColor} !important`);
  if (cfg.color) parts.push(`color:${cfg.color} !important`);
  if (!parts.length) return "";
  const kids = cfg.color ? `\n${sel.split(",").map((x) => `${x.trim()} *:not(canvas)`).join(",")}{color:${cfg.color} !important}` : "";
  return `${weak ? `:where(${sel})` : sel}{${parts.join(";")}}${kids}`;
}
// 画像の上に重ねて出すもの: CSS で描いている部品は規則で、キャンバスに描いている色は変数(--ov-<名前>)で
function lookOverlayCss(o) {
  if (!o) return "";
  const E = ":is(#cca-imged,#cca-vedit)", out = [];
  const vars = Object.entries(o).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => `--ov-${k}:${v}`);
  if (vars.length) out.push(`${E}{${vars.join(";")}}`);
  if (o.frame) out.push(`${E} .bb{border-color:${o.frame} !important}`);
  if (o.handleBg) out.push(`${E} .bb-h,#cca-vedit .ov .rz,#cca-vedit .win .rz,#cca-vedit .crop .h{background:${o.handleBg} !important}`);
  if (o.handleBorder) out.push(`${E} .bb-h,#cca-vedit .ov .rz,#cca-vedit .win .rz,#cca-vedit .crop .h{border-color:${o.handleBorder} !important}`);
  if (o.crop) out.push(`#cca-imged .cbox .bb,#cca-imged .cbox .bb-h,#cca-imged .lcbox .bb,#cca-imged .lcbox .bb-h,#cca-vedit .crop{border-color:${o.crop} !important}`);
  if (o.dim) out.push(`${E} .cdim{background:${o.dim} !important}`);
  if (o.guide) out.push(`#cca-vedit .dmark .v,#cca-vedit .dmark .h{background:${o.guide} !important}\n#cca-vedit .dmark .lb{border-color:${o.guide} !important}`);
  return out.join("\n");
}
const LOOK_BACKDROP = "#cca-comp, #cca-gal, #cca-hbox, #cca-pnginfo, #cca-setio, #cca-guide, #cca-addon, #cca-dirs, #cca-mg, #cca-layout, #cca-mask, #cca-zoom, #cca-gfont, #cca-vpick, #cca-pdfpick, #cca-wm, .cca-askclose";
// 枠と中: back(9 か所のグラデーション)・radius(角丸)・border(枠の太さ)・borderColor(枠の色)のうち、書いたものだけ
function lookRoleCss(name, cfg) {
  if (!cfg) return "";
  const parts = [];
  if (cfg.back) parts.push(`${nineVars(name, cfg.back, "180deg", [[0, "transparent"], [100, "transparent"]])};background:${gradOf(name)} !important`);
  if (cfg.radius != null) parts.push(`border-radius:${pxOf(cfg.radius)} !important`);
  if (cfg.border != null) parts.push(`border-width:${pxOf(cfg.border)} !important;border-style:solid !important`);
  if (cfg.borderColor) parts.push(`border-color:${cfg.borderColor} !important`);
  if (!parts.length) return "";
  // プルダウン(見た目を作り直したボタン)は、ボタンのつやより強くする
  const strong = name === "input" ? `\n:is(${LOOK_ROOTS}) .cca-select-button.cca-select-button.cca-select-button{${parts.join(";")}}` : "";
  const weak = !["modal", "editor"].includes(name); // ダイアログ・編集画面の地は、パネルの地の規則に勝つように弱くしない
  return `${weak ? `:where(${LOOK_SEL[name]})` : LOOK_SEL[name]}{${parts.join(";")}}${strong}`;
}
function decoCss(th) {
  if (!th) return "";
  const lk = th.look || {};
  const al = { panel: 1, card: 0.86, go: 0.78, ...(th.alpha || {}) };
  const deco = {
    cardShadow: "0 2px 10px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.32)",
    secCardShadow: "0 2px 10px rgba(0,0,0,.11), inset 0 1px 0 rgba(255,255,255,.35)",
    btnGrad: "linear-gradient(180deg, rgba(255,255,255,.32), rgba(255,255,255,.06) 48%, rgba(0,0,0,.08))",
    btnShadow: "inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 3px rgba(0,0,0,.16), 0 1px 3px rgba(0,0,0,.22)",
    btnActiveShadow: "inset 0 2px 4px rgba(0,0,0,.3)",
    goBorder: "#ffffff",
    goColor: "#ffffff",
    goTextShadow: "0 1px 2px rgba(0,0,0,.5)",
    goShadow: "inset 0 2px 0 rgba(255,255,255,.45), inset 0 -6px 12px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.45)",
    ...(th.deco || {})
  };
  const ga = (c) => fmt(hex(c), al.panel); // グラデーションの色(色の不透明度 × panel)
  const [g0, g1] = (th.grad || (th.light ? [th.bg, mixHex(th.bg, th.fg, 0.45) + hex(th.bg)[3].toString(16).padStart(2, "0")] : [mixHex(th.bg, th.accent, 0.22) + hex(th.bg)[3].toString(16).padStart(2, "0"), th.bg])).map(ga);
  const [ar, ag, ab, aa] = hex(th.accent), B = `:is(${LOOK_ROOTS}) button:not(:disabled):not(.errx)`; // 生成パネル・編集画面・すべてのダイアログのボタン
  const varLines = [
    ...Object.entries(th.vars || {}).map(([k, v]) => `${k}:${v}`),
    ...Object.entries(SELECT_VARS).filter(([k]) => th.select?.[k] != null).map(([k, name]) => `${name}:${th.select[k]}`)
  ].join(";");
  const selBtn = [["bg", "background-color"], ["fg", "color"], ["border", "border-color"]]
    .filter(([k]) => th.select?.[k] != null)
    .map(([k, prop]) => `${prop}:var(${SELECT_VARS[k]}) !important`).join(";");
  const cardPct = Math.round(clamp(lk.block?.opacity ?? al.card, 0, 1) * 100);
  // 形と背景(look)。ブロック: 今の 3 か所(0%・52%・100%)の色を 9 か所に割り当て直したものが既定
  const blkVars = nineVars("blk", lk.block?.back, "135deg", [[0, "var(--sec-tint)"], [52, `color-mix(in srgb,var(--card) ${cardPct}%,transparent)`], [100, "color-mix(in srgb,var(--sec-accent) 8%,transparent)"]]);
  const blkShape = [lk.block?.radius != null ? `border-radius:${pxOf(lk.block.radius)} !important` : "", lk.block?.border != null ? `border-width:${pxOf(lk.block.border)} !important` : "",
    lk.block?.borderColor ? `border-color:${lk.block.borderColor} !important` : ""].filter(Boolean).map((x) => `;${x}`).join("");
  const btnDef = parseGrad(deco.btnGrad);
  const btnBack = lk.button?.back || btnDef ? `${nineVars("btn", lk.button?.back, btnDef?.angle || "180deg", btnDef?.stops || [[0, "transparent"], [100, "transparent"]])};background-image:${gradOf("btn")} !important` : `background-image:${deco.btnGrad} !important`;
  const btnShape = (lk.button?.radius != null ? `;border-radius:${pxOf(lk.button.radius)}` : "") + (lk.button?.borderColor ? `;border-color:${lk.button.borderColor} !important` : "");
  const goBack = lk.go?.back || btnDef ? `${nineVars("go", lk.go?.back, btnDef?.angle || "180deg", btnDef?.stops || [[0, "transparent"], [100, "transparent"]])};background-image:${gradOf("go")} !important;` : "";
  const goShape = (lk.go?.radius != null ? `border-radius:${pxOf(lk.go.radius)} !important;` : "") + (lk.go?.borderColor ? `border-color:${lk.go.borderColor} !important;` : "");
  // sections に書いていない項目(生成ボタン・生成結果など)にも、look に書いたブロックの背景・形を使う(:where で弱くして、sections の色が勝つようにする)
  const blkAllCss = lk.block?.back || blkShape ? `:where(#cca-ui .area > [data-sec], #cca-imged [data-sec], #cca-vedit [data-sec], #cca-setio [data-sec], #cca-mask [data-sec], #cca-comp section, #cca-imged section, #cca-vedit section, #cca-pnginfo section, #cca-setio .sec){--sec-tint:transparent;--sec-accent:var(--accent);--sec-border:var(--border)${lk.block?.back ? `;${blkVars};background:${gradOf("blk")} !important` : ""}${blkShape}}` : "";
  const ROOTS = `:is(${LOOK_ROOTS})`;
  // 選んでいるボタン(.on)の文字色(スナップ以外)。.on.on は、項目ごとの色指定(.seg button.on)より優先させるため
  const snapOn = [["bg", "background-color"], ["fg", "color"], ["border", "border-color"]]
    .filter(([k]) => th.snapOn?.[k] != null)
    .map(([k, prop]) => `${prop}:${th.snapOn[k]} !important`).join(";");
  const onCss = [
    th.onFg != null ? `${ROOTS} button.on.on:not([data-c="snap"]){color:${th.onFg} !important}\nbutton[${ONFG_ATTR}]{color:${th.onFg} !important}` : "",
    snapOn ? `${ROOTS} button[data-c="snap"].on{${snapOn}}` : "",
    th.secDoneFg ? `${ROOTS} button.sec-edit.on.on.on.on{color:${th.secDoneFg} !important}` : ""
  ].filter(Boolean).join("\n");
  const secRule = (sel, cfg) => {
    const headRule = th.secTitleUseAccent ? `${sel} > .sec-head,${sel} > summary.sec-head{color:var(--sec-accent) !important;border-bottom:1px solid color-mix(in srgb,var(--sec-accent) 28%,transparent) !important;padding-bottom:6px}` : `${sel} > .sec-head,${sel} > summary.sec-head{border-bottom:1px solid color-mix(in srgb,var(--sec-accent) 24%,transparent) !important;padding-bottom:6px}`;
    return `${sel}{${cfg ? `--sec-accent:${cfg.accent};--sec-tint:${cfg.tint};--sec-border:${cfg.border};` : ""}${blkVars};background:${gradOf("blk")} !important;border-color:var(--sec-border) !important;box-shadow:${deco.secCardShadow} !important${blkShape}}`
      + headRule
      + `${sel} .sec-grip{color:color-mix(in srgb,var(--sec-accent) 78%,var(--muted)) !important}`
      + `${sel} button.pri,${sel} .seg button.on{background-color:var(--sec-accent) !important;color:var(--accent-fg) !important;border-color:var(--sec-accent) !important}`;
  };
  const secCss = [
    // sections に書いていない生成パネルの欄(マイナスプロンプト・範囲別指定・生成ボタン・生成結果など)も、強調色から同じ形で色を付ける(:where で弱く。書いた項目の色が勝つ)
    th.sections ? `:where(#cca-ui .area > [data-sec]){--sec-accent:var(--accent);--sec-tint:color-mix(in srgb,var(--accent) 22%,transparent);--sec-border:color-mix(in srgb,var(--accent) 46%,transparent)}\n`
      + secRule(":where(#cca-ui .area > [data-sec])", null) : "",
    ...Object.entries(th.sections || {}).map(([sec, cfg]) => secRule(`:is(#cca-ui [data-sec="${sec}"], #cca-imged [data-sec="${sec}"], #cca-vedit [data-sec="${sec}"], #cca-setio [data-sec="${sec}"], #cca-mask [data-sec="${sec}"])`, cfg)),
  ].filter(Boolean).join("\n");
  const textCss = [
    `:is(${LOOK_ROOTS}){color:var(--text)}`,
    th.link ? `:is(${LOOK_ROOTS}) a[href],:is(${LOOK_ROOTS}) a[href]:visited{color:${th.link} !important}` : "",
    th._accentFg ? `:is(#cca-imged,#cca-vedit) .bb-rot{color:${th._accentFg} !important}` : "",
    `:is(${LOOK_ROOTS}) :is(summary,.sec-head,h1,h2,h3,h4,b,strong){color:var(--text)}`,
    `:is(${LOOK_ROOTS}) :is(.note,.hint,.help,.sub,.muted,.desc,.tip,small,label){color:var(--muted) !important}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged) .note{background:transparent !important;border:none !important;box-shadow:none !important}`,
    `:is(${LOOK_ROOTS}) :is(input,textarea,select){color:var(--text) !important}`,
    `:is(${LOOK_ROOTS}) select option:hover{background:var(--hover, revert) !important;color:var(--text) !important}`,
    `:is(${LOOK_ROOTS}) select option:checked{background:var(--checked, revert) !important;color:var(--text) !important}`,
    `:is(${LOOK_ROOTS}) button.pri,:is(${LOOK_ROOTS}) .seg button.on{background-color:var(--accent) !important;color:var(--accent-fg) !important;border-color:var(--accent) !important}`
  ].join("\n");
  return `${varLines ? `${LOOK_ROOTS},#cca-zoom{${varLines}}\n` : ""}#cca-ui{${nineVars("pnl", lk.panel?.back, "170deg", [[0, g0], [100, g1]])};background-image:${gradOf("pnl")}
#cca-imged > .box, #cca-vedit > .box, ${LOOK_SEL.modal}{${nineVars("mdl", null, "170deg", [[0, "var(--bg)"], [100, "var(--panel, var(--bg))"]])};background-image:${gradOf("mdl")} !important} !important}
#cca-ui .card, #cca-vedit .card, #cca-imged .card, #cca-comp .card, #cca-pnginfo .card{background-color:color-mix(in srgb, var(--card) ${cardPct}%, transparent);box-shadow:${deco.cardShadow}}
${B}{${btnBack};box-shadow:${deco.btnShadow}${btnShape}}
${B}:hover{filter:brightness(1.06)}
${B}:active{box-shadow:${deco.btnActiveShadow}}
#cca-ui #cca-go:not(:disabled){${goBack}${goShape}background-color:rgba(${ar},${ag},${ab},${Math.round(clamp(al.go, 0, 1) * (aa / 255) * 1000) / 1000}) !important;border:2px solid ${deco.goBorder} !important;color:${deco.goColor} !important;text-shadow:${deco.goTextShadow};
  box-shadow:${deco.goShadow} !important}
${varLines ? `\n:is(${LOOK_ROOTS}) :is(input[type=checkbox],input[type=radio],input[type=range]){accent-color:var(--accent)}` : ""}
${textCss}${blkAllCss ? `\n${blkAllCss}` : ""}${["editor", "modal", "inner", "item", "input"].map((k) => lookRoleCss(k, lk[k])).filter(Boolean).map((x) => `\n${x}`).join("")}${lk.backdrop ? `\n:where(${LOOK_BACKDROP}){background-color:${lk.backdrop} !important}` : ""}${Object.entries(LOOK_SUB).flatMap(([g, m]) => Object.entries(m).map(([k, sel]) => lookPartsCss(sel, lk[g]?.[k], `${g}-${k}`, g === "notice"))).filter(Boolean).map((x) => `\n${x}`).join("")}${lk.overlay ? `\n${lookOverlayCss(lk.overlay)}` : ""}${lk.selection ? `\n:is(${LOOK_ROOTS}) ::selection,:is(${LOOK_ROOTS})::selection{${lk.selection.bg ? `background:${lk.selection.bg} !important;` : ""}${lk.selection.fg ? `color:${lk.selection.fg} !important` : ""}}` : ""}${secCss ? `\n${secCss}` : ""}${onCss ? `\n${onCss}` : ""}${tuneCss(th) ? `\n${tuneCss(th)}` : ""}${th.extraCss ? `\n${th.extraCss}` : ""}${selBtn ? `\n.cca-select-button{${selBtn}}` : ""}`;
}
// th.tune → CSS。書いた項目だけ出す(書かない項目・tune 自体が無い配色は何も出さない)
// 数字欄の上下ボタン: 地の色 + 白い ▲▼ の矢印(SVG)
function spinDecl({ bg, fg }) {
  const c = encodeURIComponent(fg);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='22' viewBox='0 0 12 22'><path d='M2.5 8 6 4.5 9.5 8M2.5 14 6 17.5 9.5 14' fill='none' stroke='${fg}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return `-webkit-appearance:none !important;appearance:none !important;opacity:1 !important;width:20px !important;height:26px !important;margin-left:4px;border-radius:4px;background:${bg} url("data:image/svg+xml,${encodeURIComponent(svg)}") center/12px 22px no-repeat !important;cursor:pointer`;
}
function tuneCss(th) {
  const t = th.tune;
  if (!t) return "";
  const R = `:is(${LOOK_ROOTS})`; // 生成パネル・編集画面・すべてのダイアログ
  const sel = (arr) => arr.map((x) => `${R} ${x}`).join(", ");
  const decl = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}:${v} !important`).join(";");
  const op = t.solid ? 1 : null;
  const rules = [
    [sel([":is(.note,.hint,.help,.sub,.muted,.desc,.tip,small,label)"]), { opacity: op }],
    [sel([":is(.sec-head,summary,h4)"]), { opacity: op, "font-weight": t.headWeight }],
    [sel(["label.l", "label.l span", "label.fl", "summary span"]), { color: t.labelColor, opacity: op, "font-weight": t.labelWeight }],
    [sel(["div.note", "div.ibox", "div.hint", "div.help", "div.sub", "div.desc", "div.tip", "p"]), { color: t.descColor, opacity: op, "font-weight": t.descWeight }],
    // ⓘボタン: 編集画面の部品の決まりより強く当てる(.ib を重ねて優先度を上げる)。ボタン共通の明るいグラデーションは重ねない
    [sel(["button.ib.ib.ib", "button.ib.ib.ib:hover", "button.ib.ib.ib.on"]), { color: t.infoFg, "background-color": t.infoBg, "background-image": t.infoBg ? "none" : null, "border-color": t.infoBorder, "text-shadow": t.infoBg ? "none" : null, "font-weight": t.infoBg ? 700 : null }],
    ...Object.entries(t.groupFix || {}).flatMap(([g, v]) => [
      [sel([`.ly.grp[style*="--g:${g}"]`]), { "--g": v.hue }],
      [sel([`.ly.grp[style*="--g:${g}"] .gtag`]), { color: v.fg }]
    ]),
    ...(t.scroll ? ((S) => [
      [`${S}, ${S} *`, { "scrollbar-color": `${t.scroll.thumb} ${t.scroll.track}` }], // 新しい Chrome・Firefox
      [`${S} ::-webkit-scrollbar, ${S}::-webkit-scrollbar`, { width: "12px", height: "12px", background: t.scroll.track }], // 古い Chrome
      [`${S} ::-webkit-scrollbar-track, ${S}::-webkit-scrollbar-track`, { background: t.scroll.track }],
      [`${S} ::-webkit-scrollbar-thumb, ${S}::-webkit-scrollbar-thumb`, { background: t.scroll.thumb, "border-radius": "8px", border: `2px solid ${t.scroll.track}` }],
      [`${S} ::-webkit-scrollbar-thumb:hover, ${S}::-webkit-scrollbar-thumb:hover`, { background: t.scroll.hover || t.scroll.thumb }],
      [`${S} ::-webkit-scrollbar-button, ${S}::-webkit-scrollbar-button`, { display: "none" }]
    ])(`:is(${R.slice(4, -1)},[id^="cca-"],.cca-select-menu)`) : []), // 生成パネルの外にあるダイアログ・プルダウンの一覧も含める
    ...(t.layerSel ? [[sel([".ly.sel"]), { background: t.layerSel.bg, "border-color": t.layerSel.border, color: t.layerSel.fg }]] : []),
    ...(t.check ? [[sel(["input[type=checkbox]", "input[type=radio]"]), { "accent-color": t.check, "color-scheme": "light" }]] : []),
    ...(t.spin ? [[sel(["input[type=number]::-webkit-inner-spin-button"]), spinDecl(t.spin)]] : []),
    ...(t.boxGrad ? [[sel([".lcrop", "[class*=\"lcrop\"]"]), { "background-image": `linear-gradient(135deg, ${t.boxGrad.light} 0%, ${t.boxGrad.dark} 100%)`, "border": `1px solid ${t.boxGrad.border}`, "border-radius": "10px", "padding": "8px 10px", "margin": "6px 0", "box-shadow": "0 2px 6px rgba(42,29,20,0.14), inset 0 1px 0 rgba(255,255,255,0.8)" }]] : []),
    ['[id^="cca-"] button.on.on.on:not([data-c="snap"]), [class*="cca-"] button.on.on.on:not([data-c="snap"]), #cca-hbox button.on.on.on', { color: t.selFg }]
  ];
  return rules.map(([sl, o]) => [sl, typeof o === "string" ? o : decl(o)]).filter(([, d]) => d).map(([sl, d]) => `${sl}{${d}}`).join("\n");
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
  refreshOnFg();
  refreshCustomSelects();
}