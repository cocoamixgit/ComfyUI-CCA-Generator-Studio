// CCA Generator: 文字とバウンディングボックス(画像編集・動画編集で共通)
// - 文字の折り返し(書き出し videoedit.wrap_lines と同じ決まり)・canvas に文字を描く(縁のずれ・濃さ、背景の広さ・ずれ・角の丸み)
// - 右の欄の「メイン」「縁」「背景」のまとまり(同じ項目・同じ色分け)と、値の入れ方
// - バウンディングボックス(角で大きさ・辺で幅 / 高さ・下の丸で回転。Shift で 15 度ずつ)
import { T } from "./cca_i18n.js";

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r3 = (v) => Math.round(v * 1000) / 1000;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- コピー・貼り付け(画像編集と動画編集で共通。文字は行き来できる)
export const clipboard = {
  item: null,
  set(x) { this.item = JSON.parse(JSON.stringify(x)); },
  get() { return this.item ? JSON.parse(JSON.stringify(this.item)) : null; },
};
// 文字として行き来する項目
export const TEXT_KEYS = ["text", "font", "size", "color", "stroke", "strokeWidth", "strokeDx", "strokeDy", "strokeAlpha", "strokeBlur", "bg", "bgAlpha", "bgPadX", "bgPadY",
  "bgOffX", "bgOffY", "bgRadius", "wrap", "x", "y", "rot", "opacity"];
export const pickText = (o) => Object.fromEntries(TEXT_KEYS.filter((k) => o[k] != null).map((k) => [k, o[k]]));
// 入力の欄で Ctrl+Z などを、画面の「元に戻す」に使ってよいか(文字を打つ欄では、その欄の元に戻すを使う)
export const isTextField = (t) => !!t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && /^(text|search|url|email|password|)$/i.test(t.type || "")) || t.isContentEditable);
export const isField = (t) => !!t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable);

// ---------------------------------------------------------------- 折り返し
const WRAP_TOKEN = /[ \t]+|[A-Za-z0-9'’\-.,:;!?%&@#/_()[\]]+|./gsu;
// measure(文字列) → 幅(px)。英数字の単語は途中で切らない(長すぎる単語だけ文字で切る)
export function wrapLines(text, measure, maxW) {
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    if (!(maxW > 0)) { out.push(para); continue; }
    let line = "";
    const chars = (tk) => {
      for (const ch of tk) {
        if (line.trim() && measure(line + ch) > maxW) { out.push(line.trimEnd()); line = ""; }
        line += ch;
      }
    };
    for (const tk of para.match(WRAP_TOKEN) || []) {
      if (/^[ \t]+$/.test(tk)) { if (line) line += tk; continue; }
      if (measure(line + tk) <= maxW || !line.trim()) {
        if (measure(tk) > maxW) chars(tk); else line += tk;
      } else {
        out.push(line.trimEnd());
        line = "";
        if (measure(tk) > maxW) chars(tk); else line = tk;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

// ---------------------------------------------------------------- canvas に文字を描く(画像編集の見た目と書き込み)
const hexRgb = (hex, d = [255, 255, 255]) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : d;
};
// 行・大きさの計算。font: canvas の font(大きさ px 込み)、px: 文字の大きさ、wrapW: 折り返し幅(px、0 = しない)
export function textLayout(g, o, px, font, wrapW = 0) {
  g.font = font;
  const lines = wrapW > 0 ? wrapLines(o.text, (s) => g.measureText(s).width, wrapW) : String(o.text ?? "").split("\n");
  const m = g.measureText("Agあ");
  const asc = m.fontBoundingBoxAscent || px * 0.88, desc = m.fontBoundingBoxDescent || px * 0.24;
  const spacing = Math.round(px * 0.2), lineH = asc + desc + spacing;
  const widths = lines.map((l) => g.measureText(l).width);
  const sw = Math.max(0, Math.round((o.strokeWidth ?? 0.08) * px));
  const tw = Math.max(1, ...widths) + 2 * sw, th = lines.length * lineH - spacing + 2 * sw;
  const sdx = (o.strokeDx || 0) * px, sdy = (o.strokeDy || 0) * px;
  const sb = Math.max(0, Number(o.strokeBlur || 0)) * px; // 縁(影)のぼかし
  const ba = Number(o.bgAlpha || 0);
  const padx = (o.bgPadX ?? 0.3) * px, pady = (o.bgPadY ?? 0.3) * px, bgx = (o.bgOffX || 0) * px, bgy = (o.bgOffY || 0) * px;
  let ex = tw / 2 + Math.abs(sdx) + 2 + sb * 3, ey = th / 2 + Math.abs(sdy) + 2 + sb * 3;
  if (ba > 0) { ex = Math.max(ex, tw / 2 + padx + Math.abs(bgx) + 2); ey = Math.max(ey, th / 2 + pady + Math.abs(bgy) + 2); }
  return { lines, asc, lineH, widths, sw, tw, th, sdx, sdy, sb, ba, padx, pady, bgx, bgy, w: ex * 2, h: ey * 2 };
}
// 中心 (0, 0) に描く(呼ぶ側で translate・rotate する)。L は textLayout の結果
export function drawTextAt(g, o, L, font) {
  g.save();
  g.font = font;
  g.textBaseline = "alphabetic";
  g.lineJoin = "round";
  if (L.ba > 0) {
    const bw = L.tw + 2 * L.padx, bh = L.th + 2 * L.pady;
    const rad = clamp(Number(o.bgRadius || 0), 0, 1) * Math.min(bw, bh) / 2;
    g.fillStyle = `rgba(${hexRgb(o.bg, [0, 0, 0]).join(",")},${clamp(L.ba, 0, 1)})`;
    g.beginPath();
    if (g.roundRect) g.roundRect(-L.tw / 2 - L.padx + L.bgx, -L.th / 2 - L.pady + L.bgy, bw, bh, rad); else g.rect(-L.tw / 2 - L.padx + L.bgx, -L.th / 2 - L.pady + L.bgy, bw, bh);
    g.fill();
  }
  const top = -L.th / 2 + L.sw;
  const pos = L.lines.map((l, i) => [l, -L.widths[i] / 2, top + i * L.lineH + L.asc]);
  const stroke = o.stroke || "#000000", sa = clamp(o.strokeAlpha ?? 1, 0, 1);
  const strokeAll = (gg, dx, dy) => {
    gg.lineWidth = L.sw * 2;
    gg.strokeStyle = stroke;
    gg.fillStyle = stroke;
    for (const [l, x, y] of pos) { if (L.sw > 0) gg.strokeText(l, x + dx, y + dy); gg.fillText(l, x + dx, y + dy); }
  };
  const shadow = Math.abs(L.sdx) > 0.5 || Math.abs(L.sdy) > 0.5 || L.sb > 0.3;
  if ((L.sw > 0 || shadow) && (shadow || sa < 0.999)) {
    // 縁を別の層に描いてずらす・透かす・ぼかす(影になる。縁の太さが 0 でも、ずらすかぼかせば文字の形の影)。
    // 重なった所が濃くならないように、まとめて透かす
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(L.w) + 4; cv.height = Math.ceil(L.h) + 4;
    const s = cv.getContext("2d");
    s.font = font; s.textBaseline = "alphabetic"; s.lineJoin = "round";
    s.translate(cv.width / 2, cv.height / 2);
    strokeAll(s, L.sdx, L.sdy);
    // 縁の濃さ・ぼかしは縁の層だけに(文字は元の不透明度のまま。0 でも文字が消えないように save / restore で戻す)
    g.save();
    // canvas のぼかしは拡大・縮小の影響を受けないので、今の倍率を掛ける(見る倍率が違っても描き込みと同じ見た目)
    if (L.sb > 0.3) { const m = g.getTransform(); g.filter = `blur(${L.sb * Math.hypot(m.a, m.b)}px)`; }
    g.globalAlpha *= sa;
    g.drawImage(cv, -cv.width / 2, -cv.height / 2);
    g.restore();
  } else if (L.sw > 0) strokeAll(g, 0, 0);
  g.fillStyle = o.color || "#ffffff";
  for (const [l, x, y] of pos) g.fillText(l, x, y);
  g.restore();
}

// ---------------------------------------------------------------- 右の欄(文字のメイン・縁・背景)
export const num = (k, label, v, min, max, step, extra = "") => `<label class="fl">${T(label)}<input type="number" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}" ${extra}></label>`;
export const chk = (k, label, v, extra = "") => `<label class="ck"><input type="checkbox" data-k="${k}" ${v ? "checked" : ""} ${extra}><span>${T(label)}</span></label>`;
// isOpen(cls) → 開いておくか
export function sec(cls, title, body, open = true) {
  return `<details class="sec s-${cls}" data-sec="${cls}" ${open ? "open" : ""}><summary>${title}</summary><div class="sb">${body}</div></details>`;
}
// 100 倍して % で見せる文字の値と、範囲(0〜1 の値で)
export const TEXT_PCT = new Set(["size", "strokeWidth", "strokeDx", "strokeDy", "strokeAlpha", "strokeBlur", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", "bgRadius", "wrap", "x", "y", "opacity"]);
export const TEXT_RANGE = { size: [0.005, 1], strokeWidth: [0, 0.5], strokeDx: [-1, 1], strokeDy: [-1, 1], strokeAlpha: [0, 1], strokeBlur: [0, 0.5], bgAlpha: [0, 1], bgPadX: [0, 3], bgPadY: [0, 3],
  bgOffX: [-3, 3], bgOffY: [-3, 3], bgRadius: [0, 1], wrap: [0, 2], x: [-1, 2], y: [-1, 2], rot: [-3600, 3600], opacity: [0, 1] };
export const TEXT_DEFAULTS = { strokeWidth: 0.08, strokeDx: 0, strokeDy: 0, strokeAlpha: 1, strokeBlur: 0, bgAlpha: 0, bgPadX: 0.3, bgPadY: 0.3, bgOffX: 0, bgOffY: 0, bgRadius: 0, wrap: 0 };
// テンプレートに無いものはふつうの値に戻す(前のテンプレートの影や帯が残らないように)
export const STYLE_RESET = { strokeDx: 0, strokeDy: 0, strokeAlpha: 1, strokeBlur: 0, bgAlpha: 0, bgPadX: 0.3, bgPadY: 0.3, bgOffX: 0, bgOffY: 0, bgRadius: 0 };
export const STYLE_KEYS = ["font", "size", "color", "stroke", "strokeWidth", "strokeDx", "strokeDy", "strokeAlpha", "strokeBlur", "bg", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", "bgRadius"];
const pv = (o, k) => r3((o[k] ?? TEXT_DEFAULTS[k] ?? 0) * 100);
// h: { fontOptions(cur), tplHtml, size(今の大きさ 0〜1), open(cls) → bool, fontButtons(省略可), sizeLabel }
export function textSectionsHtml(o, h) {
  const open = h.open || (() => true);
  return sec("main", T("メイン(文字・フォント・色)"), `<label class="fl">${T("文字")}<textarea data-k="text">${esc(o.text)}</textarea></label>
      ${h.tplHtml || ""}
      <label class="fl">${T("フォント")}<select data-k="font">${h.fontOptions(o.font)}</select></label>
      ${h.fontButtons || ""}
      ${num("size", h.sizeLabel || "文字の大きさ(%)", r3((h.size ?? o.size ?? 0.08) * 100), 0.5, 100, 0.5)}
      <label class="fl">${T("文字の色")}<input type="color" data-k="color" value="${o.color || "#ffffff"}"></label>
      ${num("wrap", "折り返す幅(%)", pv(o, "wrap"), 0, 200, 1, `title="${esc(T("0 = 折り返さない。画面(画像)の幅に対しての %。枠の左右の □ をドラッグしても変えられます"))}"`)}`, open("main"))
    + sec("stk", T("縁(ずらすと影)"), `<label class="fl">${T("縁の色")}<input type="color" data-k="stroke" value="${o.stroke || "#000000"}"></label>
      ${num("strokeWidth", "縁の太さ(%)", pv(o, "strokeWidth"), 0, 50, 1)}
      ${num("strokeDx", "ずらす 横(%)", pv(o, "strokeDx"), -100, 100, 1)}${num("strokeDy", "ずらす 縦(%)", pv(o, "strokeDy"), -100, 100, 1)}
      ${num("strokeAlpha", "縁の濃さ(%)", pv(o, "strokeAlpha"), 0, 100, 5)}
      ${num("strokeBlur", "縁のぼかし(%)", pv(o, "strokeBlur"), 0, 50, 1, `title="${esc(T("縁(影)だけをぼかします。文字はくっきりのまま"))}"`)}
      <div class="note">${T("縁を右下へずらして濃さを下げ、ぼかすと影になります(縁の太さが 0 でも、ずらすかぼかせば文字の形の影)。% は文字の大きさに対して。")}</div>`, open("stk"))
    + sec("bgs", T("背景(文字の後ろの帯)"), `<label class="fl">${T("背景の色")}<input type="color" data-k="bg" value="${o.bg || "#000000"}"></label>
      ${num("bgAlpha", "背景の濃さ(%)", Math.round((o.bgAlpha || 0) * 100), 0, 100, 5)}
      ${num("bgRadius", "角の丸み(%)", pv(o, "bgRadius"), 0, 100, 5, `title="${esc(T("0 = 四角、100 = 両端がまるい(カプセルの形)"))}"`)}
      ${num("bgPadX", "広さ 横(%)", pv(o, "bgPadX"), 0, 300, 5)}${num("bgPadY", "広さ 縦(%)", pv(o, "bgPadY"), 0, 300, 5)}
      ${num("bgOffX", "ずらす 横(%)", pv(o, "bgOffX"), -300, 300, 5)}${num("bgOffY", "ずらす 縦(%)", pv(o, "bgOffY"), -300, 300, 5)}
      <div class="note">${T("濃さが 0 なら背景は出ません。広さ・ずらすは文字の大きさに対しての %。")}</div>`, open("bgs"));
}
// 文字の欄の値を入れる(数・色・文字・フォント)。入れたら true
export function applyTextField(o, k, el) {
  if (k === "font") { if (el.value) o.font = el.value; else delete o.font; return true; }
  if (k === "text" || el.type === "color" || el.tagName === "SELECT") { o[k] = el.value; return true; }
  if (el.type === "checkbox") { o[k] = el.checked; return true; }
  let n = Number(el.value);
  if (el.value === "" || Number.isNaN(n)) return false;
  if (TEXT_PCT.has(k)) n /= 100;
  if (TEXT_RANGE[k]) n = clamp(n, ...TEXT_RANGE[k]);
  o[k] = r3(n);
  return true;
}
export function setTextField(el, o) {
  const k = el.dataset.k;
  if (k === "font") el.value = o.font || "";
  else if (el.type === "checkbox") el.checked = !!o[k];
  else if (el.type === "color" || k === "text") el.value = o[k] ?? "";
  else el.value = TEXT_PCT.has(k) ? r3((o[k] ?? TEXT_DEFAULTS[k] ?? 0) * 100) : r3(o[k] ?? 0);
}
// 色分けしたまとまりの見た目(scope: "#cca-vedit" など)
export function sectionCss(scope) {
  return `
${scope} details.sec{--sc2:#8a6cff;border:1.5px solid transparent;border-radius:12px;margin-top:8px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--sc,#3db4a6) 13%,#141920),color-mix(in srgb,var(--sc2) 10%,#141920)) padding-box,
  linear-gradient(135deg,color-mix(in srgb,var(--sc,#3db4a6) 80%,transparent),color-mix(in srgb,var(--sc2) 65%,transparent)) border-box}
${scope} details.sec>summary{cursor:pointer;padding:6px 10px;font-size:13.5px;font-weight:700;color:var(--st,#d9f3ef);list-style:none;user-select:none}
${scope} details.sec>summary::-webkit-details-marker{display:none}
${scope} details.sec>summary::before{content:"▸ ";color:var(--sc)}
${scope} details.sec[open]>summary::before{content:"▾ "}
${scope} details.sec>.sb{padding:0 10px 10px}
${scope} .sec.s-main{--sc:#3dd6a0;--sc2:#8a6cff;--st:#c9f5e4}
${scope} .sec.s-stk{--sc:#f0a040;--sc2:#ff5c8a;--st:#f8dfc2}
${scope} .sec.s-bgs{--sc:#4f9bff;--sc2:#b06cff;--st:#d2e4fb}
${scope} .sec.s-pos{--sc:#a07bff;--sc2:#4fc3ff;--st:#e5daff}
${scope} .sec.s-crop{--sc:#9aa6b8;--sc2:#6c7a90;--st:#e1e6ee}
${scope} .sec.s-key{--sc:#3fd0e0;--sc2:#7b8cff;--st:#caf0f6}
${scope} .sec.s-kf{--sc:#ffd24d;--sc2:#6fe0a0;--st:#fcf0c4}
${scope} .sec.s-tr{--sc:#ff6fae;--sc2:#ffb347;--st:#f9d4e6}
${scope} .sec.s-lp{--sc:#ff8a5c;--sc2:#ffd24d;--st:#ffdccb}
${scope} .sec.s-au{--sc:#9fd84d;--sc2:#3fb8ff;--st:#e2f2c9}
${scope} .sec.s-eg{--sc:#7b8cff;--sc2:#3fd0e0;--st:#dde1ff}
${scope} .sec.s-mk{--sc:#c77dff;--sc2:#ff6fae;--st:#efdcff}
${scope} .sec.s-cl{--sc:#ff9ad5;--sc2:#7b8cff;--st:#ffe0f2}
${scope} .sec.s-ol{--sc:#ffb84d;--sc2:#ff6f61;--st:#ffe6c7}
${scope} label.fl{display:grid;grid-template-columns:8.5em minmax(0,1fr);gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:4px}
${scope} label.ck{display:flex;gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:5px;cursor:pointer}
${scope} label.ck input:disabled+span{opacity:.45}
`;
}

// ---------------------------------------------------------------- バウンディングボックス
// sides: "ew"(文字: 左右の辺で折り返し幅)・"all"(画像・動画: 4 辺)・""(角と回転だけ)
export function bboxHtml(sides = "all") {
  const hs = ["nw", "ne", "sw", "se"];
  if (sides === "ew" || sides === "all") hs.push("e", "w");
  if (sides === "all") hs.push("n", "s");
  return `<div class="bb" aria-hidden="true">${hs.map((h) => `<i class="bb-h bb-${h}" data-h="${h}"></i>`).join("")}<i class="bb-stem"></i><i class="bb-rot" data-h="rot" title="${esc(T("ドラッグで回す(Shift で 15 度ずつ)"))}">⟳</i></div>`;
}
export function bboxCss(scope) {
  return `
${scope} .bb{position:absolute;inset:-1px;border:1.5px solid #4f8bff;pointer-events:none;z-index:5}
${scope} .bb-h{position:absolute;width:11px;height:11px;margin:-6px 0 0 -6px;background:#fff;border:2px solid #4f8bff;border-radius:50%;pointer-events:auto;box-sizing:border-box}
${scope} .bb-nw{left:0;top:0;cursor:nwse-resize}${scope} .bb-ne{left:100%;top:0;cursor:nesw-resize}
${scope} .bb-sw{left:0;top:100%;cursor:nesw-resize}${scope} .bb-se{left:100%;top:100%;cursor:nwse-resize}
${scope} .bb-e,${scope} .bb-w{top:50%;width:8px;height:18px;margin:-9px 0 0 -4px;border-radius:4px;cursor:ew-resize}
${scope} .bb-e{left:100%}${scope} .bb-w{left:0}
${scope} .bb-n,${scope} .bb-s{left:50%;width:18px;height:8px;margin:-4px 0 0 -9px;border-radius:4px;cursor:ns-resize}
${scope} .bb-n{top:0}${scope} .bb-s{top:100%}
${scope} .bb-stem{position:absolute;left:50%;top:100%;width:0;height:16px;border-left:1.5px solid #4f8bff}
${scope} .snapg{position:absolute;pointer-events:none;z-index:8;border:0 dashed #ff4fd8}
${scope} .snapg.v{top:0;bottom:0;width:0;border-left-width:1px}
${scope} .snapg.h{left:0;right:0;height:0;border-top-width:1px}
${scope} .bb-rot{position:absolute;left:50%;top:100%;width:22px;height:22px;margin:16px 0 0 -11px;border-radius:50%;background:#4f8bff;color:#fff;font:bold 14px/22px sans-serif;text-align:center;font-style:normal;pointer-events:auto;cursor:grab}
`;
}
// ---------------------------------------------------------------- 枠の吸い付き(スナップ)
// 画面の px で計算する。rects: 吸い付く先の枠 {x0, y0, x1, y1}(キャンバス・ほかの物)。それぞれの端と真ん中にそろえる
export const SNAP_PX = 6;
export function snapLines(rects) {
  const xs = [], ys = [];
  for (const r of rects) { xs.push(r.x0, (r.x0 + r.x1) / 2, r.x1); ys.push(r.y0, (r.y0 + r.y1) / 2, r.y1); }
  return { xs, ys };
}
function nearest(vals, lines, thr) {
  let best = null;
  for (const v of vals) for (const at of lines) {
    const d = at - v;
    if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at };
  }
  return best;
}
// 動かす: 動かす前の枠 box を dx・dy だけ動かしたとき、端・真ん中が近い線にそろうよう寄せる
export function snapMove(box, dx, dy, L, thr = SNAP_PX) {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const bx = nearest([box.x0 + dx, cx + dx, box.x1 + dx], L.xs, thr);
  const by = nearest([box.y0 + dy, cy + dy, box.y1 + dy], L.ys, thr);
  return { dx: dx + (bx ? bx.d : 0), dy: dy + (by ? by.d : 0), gx: bx ? [bx.at] : [], gy: by ? [by.at] : [] };
}
// 真ん中を中心に広げるとき: 半分の長さ half を、端が近い線に来る長さに寄せる(無ければ null)
export function snapHalf(center, half, lines, thr = SNAP_PX) {
  let best = null;
  for (const at of lines) {
    const h2 = Math.abs(at - center);
    if (h2 < 2) continue;
    const d = h2 - half;
    if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, half: h2, at };
  }
  return best;
}
// 大きさ(角・辺)の吸い付き。res は bboxDrag の結果、box は動かす前の枠(回していないとき)。寄せた res と線を返す
export function snapResize(res, box, L, thr = SNAP_PX) {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, hw = (box.x1 - box.x0) / 2, hh = (box.y1 - box.y0) / 2;
  if (res.k != null) {
    const sx = snapHalf(cx, hw * res.k, L.xs, thr), sy = snapHalf(cy, hh * res.k, L.ys, thr);
    const b = sx && (!sy || Math.abs(sx.d) <= Math.abs(sy.d)) ? { k: sx.half / hw, gx: [sx.at], gy: [] } : sy ? { k: sy.half / hh, gx: [], gy: [sy.at] } : null;
    return b ? { res: { k: Math.max(0.02, b.k) }, gx: b.gx, gy: b.gy } : { res, gx: [], gy: [] };
  }
  if (res.w != null) { const sx = snapHalf(cx, res.w / 2, L.xs, thr); return sx ? { res: { w: sx.half * 2 }, gx: [sx.at], gy: [] } : { res, gx: [], gy: [] }; }
  if (res.h != null) { const sy = snapHalf(cy, res.h / 2, L.ys, thr); return sy ? { res: { h: sy.half * 2 }, gx: [], gy: [sy.at] } : { res, gx: [], gy: [] }; }
  return { res, gx: [], gy: [] };
}
// そろった所の線を出す(host: 線を置く要素。gx・gy は画面の px)。null で消す
export function showSnapGuides(host, g) {
  if (!host) return;
  for (const el of host.querySelectorAll(":scope > .snapg")) el.remove();
  if (!g) return;
  const r = host.getBoundingClientRect();
  for (const x of [...new Set((g.gx || []).map((v) => Math.round(v)))]) {
    const el = document.createElement("i");
    el.className = "snapg v";
    el.style.left = `${x - r.left}px`;
    host.appendChild(el);
  }
  for (const y of [...new Set((g.gy || []).map((v) => Math.round(v)))]) {
    const el = document.createElement("i");
    el.className = "snapg h";
    el.style.top = `${y - r.top}px`;
    host.appendChild(el);
  }
}
// 回した枠の、画面に沿った外側の枠
export function rotatedBounds(cx, cy, w, h, rot) {
  const a = ((rot || 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}
// ドラッグ: o = { cx, cy(画面の px)・w, h(回す前の枠の px)・rot(度)・handle("move" | 角 | 辺 | "rot")・onMove(res, ev)・onEnd() }
// res: move → {dx, dy} / 角 → {k}(真ん中を中心に何倍) / e・w → {w} / n・s → {h} / rot → {rot}
export function bboxDrag(e, o) {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX, y0 = e.clientY;
  const th = (o.rot || 0) * Math.PI / 180;
  const d0 = Math.max(4, Math.hypot(x0 - o.cx, y0 - o.cy));
  const a0 = Math.atan2(y0 - o.cy, x0 - o.cx);
  const move = (ev) => {
    const h = o.handle;
    let res;
    if (h === "move") res = { dx: ev.clientX - x0, dy: ev.clientY - y0 };
    else if (h === "rot") {
      let r = (o.rot || 0) + (Math.atan2(ev.clientY - o.cy, ev.clientX - o.cx) - a0) * 180 / Math.PI;
      r = ((r + 540) % 360) - 180;
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      res = { rot: r3(r) };
    } else if (h.length === 2) res = { k: Math.max(0.02, Math.hypot(ev.clientX - o.cx, ev.clientY - o.cy) / d0) };
    else {
      // 回した枠の向きで、真ん中からの距離をはかる(左右・上下とも同じだけ広がる)
      const px = ev.clientX - o.cx, py = ev.clientY - o.cy;
      const lx = px * Math.cos(-th) - py * Math.sin(-th), ly = px * Math.sin(-th) + py * Math.cos(-th);
      res = h === "e" || h === "w" ? { w: Math.max(8, Math.abs(lx) * 2) } : { h: Math.max(8, Math.abs(ly) * 2) };
    }
    o.onMove(res, ev);
  };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); o.onEnd?.(); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
