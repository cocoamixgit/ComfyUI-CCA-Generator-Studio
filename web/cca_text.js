// CCA Generator: 文字とバウンディングボックス(画像編集・動画編集で共通)
// - 文字の折り返し(書き出し videoedit.wrap_lines と同じ決まり)・canvas に文字を描く(縁のずれ・濃さ、背景の広さ・ずれ・角の丸み)
// - 右の欄の「メイン」「縁」「背景」のまとまり(同じ項目・同じ色分け)と、値の入れ方
// - バウンディングボックス(角で大きさ・辺で幅 / 高さ・下の丸で回転。Shift で 15 度ずつ)
import { T } from "./cca_i18n.js";

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r3 = (v) => Math.round(v * 1000) / 1000;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- Forge 風のウェイト(Ctrl + ↑↓)
// 選択範囲、無ければカーソルのある「,」区切りの 1 語を (語:1.1) にする。すでに (語:数) なら 0.1 ずつ増減し、1.0 に戻ったらかっこを外す
export function weightEdit(text, start, end, dir, step = 0.1) {
  const isSep = (c) => c === "," || c === "\n";
  if (start === end) {
    let depth = 0, a = 0;
    for (let i = 0; i < start; i++) { const c = text[i]; if (c === "(") depth++; else if (c === ")") depth = Math.max(0, depth - 1); else if (isSep(c) && depth === 0) a = i + 1; }
    let b = text.length; depth = 0;
    for (let i = a; i < text.length; i++) { const c = text[i]; if (c === "(") depth++; else if (c === ")") depth = Math.max(0, depth - 1); else if (isSep(c) && depth === 0) { b = i; break; } }
    start = a; end = b;
  }
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start >= end) return null;
  let sel = text.slice(start, end);
  // 選択が (語:数) の中身だけ・かっこごとのどちらでも扱う
  let s0 = start, e0 = end;
  if (text[s0 - 1] === "(" && text[e0] === ")" && !/^\(.*\)$/s.test(sel)) { s0--; e0++; sel = text.slice(s0, e0); }
  const m = /^\((.*):\s*(-?\d+(?:\.\d+)?)\)$/s.exec(sel);
  let out;
  if (m) {
    const w = Math.round((Number(m[2]) + dir * step) * 100) / 100;
    out = Math.abs(w - 1) < 0.001 ? m[1] : `(${m[1]}:${w.toFixed(2).replace(/0$/, "")})`;
  } else out = `(${sel}:${(1 + dir * step).toFixed(1)})`;
  return { text: text.slice(0, s0) + out + text.slice(e0), start: s0, end: s0 + out.length };
}
export function weightKey(ta, dir) {
  const r = weightEdit(ta.value, ta.selectionStart, ta.selectionEnd, dir);
  if (!r) return false;
  ta.value = r.text;
  ta.setSelectionRange(r.start, r.end);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// ---------------------------------------------------------------- コピー・貼り付け(画像編集と動画編集で共通。文字は行き来できる)
export const clipboard = {
  item: null,
  set(x) { this.item = JSON.parse(JSON.stringify(x)); },
  get() { return this.item ? JSON.parse(JSON.stringify(this.item)) : null; },
};
// 文字として行き来する項目
export const TEXT_KEYS = ["text", "font", "size", "color", "colorA", "stroke", "strokeWidth", "strokeGap", "strokeFront", "strokeDx", "strokeDy", "strokeAlpha", "strokeBlur", "bg", "bgAlpha", "bgPadX", "bgPadY",
  "bgOffX", "bgOffY", "bgRadius", "wrap", "align", "x", "y", "rot", "opacity"];
export const pickText = (o) => Object.fromEntries(TEXT_KEYS.filter((k) => o[k] != null).map((k) => [k, o[k]]));
// 入力の欄で Ctrl+Z などを、画面の「元に戻す」に使ってよいか(文字を打つ欄では、その欄の元に戻すを使う)
export const isTextField = (t) => !!t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && /^(text|search|url|email|password|)$/i.test(t.type || "")) || t.isContentEditable);
// プルダウン(作り直したもの)のボタン・一覧で押したキーのうち、プルダウンが使うもの(編集画面のキー操作には回さない)
export const selectKey = (e) => !!e.target?.closest?.(".cca-select-button, .cca-select-menu") && ["ArrowUp", "ArrowDown", "Enter", " ", "Escape", "Home", "End"].includes(e.key);
export const isField = (t) => !!t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || !!t.closest?.(".cca-select-button, .cca-select-menu"));

// ---------------------------------------------------------------- レイヤーの合成(描画モード。Photoshop・GIMP などと同じ名前の計算)
// 値は canvas の globalCompositeOperation の名前(加算は "lighter"。CSS の mix-blend-mode では "plus-lighter")。"" = 通常
export const BLENDS = [["", "通常"], ["multiply", "乗算"], ["screen", "スクリーン"], ["overlay", "オーバーレイ"], ["soft-light", "ソフトライト"], ["hard-light", "ハードライト"],
  ["darken", "比較(暗)"], ["lighten", "比較(明)"], ["color-dodge", "覆い焼きカラー"], ["color-burn", "焼き込みカラー"], ["lighter", "加算"],
  ["difference", "差の絶対値"], ["exclusion", "除外"], ["hue", "色相"], ["saturation", "彩度"], ["color", "カラー"], ["luminosity", "輝度"]];
export const blendOf = (o) => (BLENDS.some(([v]) => v && v === o?.blend) ? o.blend : "");
export const blendOptions = (cur) => BLENDS.map(([v, l]) => `<option value="${v}" ${(cur || "") === v ? "selected" : ""}>${esc(T(l))}</option>`).join("");

// ---------------------------------------------------------------- 背景の表示(画像編集・動画編集で共通)
// 透明な所をどう見せるか(透明柄 / 白 / 黒 / 色)。書き出しには関係しない。このブラウザに覚える
const VBG_KEY = "cca_generator.view_bg";
export function viewBg() {
  try { const v = JSON.parse(localStorage.getItem(VBG_KEY) || "{}"); return { mode: ["checker", "white", "black", "color"].includes(v.mode) ? v.mode : "checker", color: /^#[0-9a-f]{6}$/i.test(v.color || "") ? v.color : "#808080" }; }
  catch { return { mode: "checker", color: "#808080" }; }
}
export function setViewBg(v) { try { localStorage.setItem(VBG_KEY, JSON.stringify(v)); } catch { /* 覚えられなくても使える */ } }

// ---------------------------------------------------------------- スポイト(色の欄の横。画像編集・動画編集で共通)
// root の中の色の欄(input[type=color]。data-no-dropper は除く)の横に「スポイト」を付ける。
// 押すと start(put) を呼ぶ(編集画面が pickColor で、絵を押して色を取る)。put(hex) で欄に入れる
export function attachDroppers(root, start) {
  const add = (inp) => {
    if (inp._dropper || inp.hasAttribute("data-no-dropper") || inp.closest("[data-no-dropper]")) return;
    inp._dropper = true;
    const wrap = document.createElement("span");
    wrap.className = "cca-cpk";
    if (inp.hidden) wrap.hidden = true;
    inp.replaceWith(wrap);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cca-dropper";
    b.textContent = T("スポイト");
    // Chrome・Edge(EyeDropper が使える): ふつうは画面のどこからでも。Shift で、編集画面の絵を拡大して色の番号を見ながら
    b.title = window.EyeDropper ? T("画面のどこからでも(ほかのウィンドウからも)色を取ります。Shift を押しながら押すと、絵を拡大して色の番号を見ながら取れます")
      : T("絵を押して、その所の色を入れます(Esc でやめる)");
    wrap.append(inp, b);
    // 欄を隠す・出すとき(hidden)は、スポイトも一緒に
    new MutationObserver(() => { wrap.hidden = inp.hidden; }).observe(inp, { attributes: true, attributeFilter: ["hidden"] });
    b.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const put = (hex) => {
        if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return;
        inp.value = hex.toLowerCase();
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      };
      // 画面のどこからでも(ブラウザの EyeDropper。拡大鏡はブラウザが出す)。使えないブラウザ・Shift のときは編集画面の絵から
      if (window.EyeDropper && !e.shiftKey) { try { const r = await new window.EyeDropper().open(); put(r.sRGBHex); } catch { /* やめたとき */ } return; }
      start?.(put);
    });
  };
  let raf = 0;
  const scan = () => { raf = 0; for (const inp of root.querySelectorAll('input[type="color"]')) add(inp); };
  scan();
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(scan); }).observe(root, { childList: true, subtree: true });
}
const toHex = (d, i = 0) => `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
// 色を取るとき: カーソルの所を拡大した見本・色・番号を出し、area を押した所の色を put に渡す。
// sample(clientX, clientY, n) → カーソルのまわり n × n の画素(Uint8ClampedArray、RGBA)。取れなければ null。Esc・area の外を押すとやめる
let pickEnd = null;
export function pickColor(area, sample, put) {
  pickEnd?.();
  const N = 11, Z = 9;
  const box = document.createElement("div");
  box.className = "cca-pickpv";
  box.innerHTML = `<canvas width="${N * Z}" height="${N * Z}"></canvas><div class="pv"><i></i><span></span></div>`;
  Object.assign(box.style, { position: "fixed", zIndex: 2147483600, pointerEvents: "none", display: "none", background: "#1a1e25", border: "1px solid #556", borderRadius: "8px",
    padding: "5px", boxShadow: "0 4px 14px rgba(0,0,0,.5)", font: "12px/1.4 ui-monospace,Consolas,monospace", color: "#e4e7eb" });
  const cv = box.querySelector("canvas"), g = cv.getContext("2d");
  Object.assign(cv.style, { display: "block", width: `${N * Z}px`, height: `${N * Z}px`, imageRendering: "pixelated", borderRadius: "4px" });
  const pv = box.querySelector(".pv"), sw = pv.querySelector("i"), tx = pv.querySelector("span");
  Object.assign(pv.style, { display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" });
  Object.assign(sw.style, { width: "22px", height: "16px", border: "1px solid #fff", borderRadius: "3px", display: "inline-block" });
  document.body.appendChild(box);
  area.classList.add("cca-picking");
  let cur = null;
  const show = (e) => {
    const r = area.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    const d = inside ? sample(e.clientX, e.clientY, N) : null;
    if (!d) { box.style.display = "none"; cur = null; return; }
    const im = g.createImageData(N, N);
    im.data.set(d.length === im.data.length ? d : im.data);
    const t = document.createElement("canvas");
    t.width = N; t.height = N;
    t.getContext("2d").putImageData(im, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(t, 0, 0, N * Z, N * Z);
    const c = Math.floor(N / 2);
    g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(c * Z, c * Z, Z, Z);
    g.strokeStyle = "#000"; g.lineWidth = 1; g.strokeRect(c * Z - 1.5, c * Z - 1.5, Z + 3, Z + 3);
    cur = toHex(d, (c * N + c) * 4);
    sw.style.background = cur; tx.textContent = cur;
    box.style.display = "block";
    const bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = `${e.clientX + 18 + bw > innerWidth ? e.clientX - 18 - bw : e.clientX + 18}px`;
    box.style.top = `${e.clientY + 18 + bh > innerHeight ? e.clientY - 18 - bh : e.clientY + 18}px`;
  };
  const down = (e) => {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const r = area.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    if (inside) { show(e); if (cur) put(cur); }
    end();
  };
  const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); } };
  const end = () => {
    window.removeEventListener("pointermove", show, true);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("keydown", key, true);
    area.classList.remove("cca-picking");
    box.remove();
    if (pickEnd === end) pickEnd = null;
  };
  pickEnd = end;
  // ボタンを押した、その押しで終わらないように、次の操作から受け付ける
  setTimeout(() => {
    if (pickEnd !== end) return;
    window.addEventListener("pointermove", show, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
  }, 0);
}

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
  // 縁を離す(文字と縁の間をあける。マイナスは縁を文字の内側へ寄せる)。縁の太さが 0 なら縁は無いので使わない。ow: 文字の外へ縁が届く幅
  const gap = sw > 0 ? Math.round(clamp(Number(o.strokeGap) || 0, -1, 1) * px) : 0, ow = Math.max(0, sw + gap);
  const front = sw > 0 && !!o.strokeFront; // 縁を文字(塗り)の前に描く(文字の内側にも縁が入る)
  const fa = clamp(Number(o.colorA ?? 1), 0, 1); // 文字の色の不透明度(縁・影はそのまま)
  const tw = Math.max(1, ...widths) + 2 * ow, th = lines.length * lineH - spacing + 2 * ow;
  const sdx = (o.strokeDx || 0) * px, sdy = (o.strokeDy || 0) * px;
  const sb = Math.max(0, Number(o.strokeBlur || 0)) * px; // 縁(影)のぼかし
  const ba = Number(o.bgAlpha || 0);
  const padx = (o.bgPadX ?? 0.3) * px, pady = (o.bgPadY ?? 0.3) * px, bgx = (o.bgOffX || 0) * px, bgy = (o.bgOffY || 0) * px;
  let ex = tw / 2 + Math.abs(sdx) + 2 + sb * 3, ey = th / 2 + Math.abs(sdy) + 2 + sb * 3;
  if (ba > 0) { ex = Math.max(ex, tw / 2 + padx + Math.abs(bgx) + 2); ey = Math.max(ey, th / 2 + pady + Math.abs(bgy) + 2); }
  return { lines, asc, desc, lineH, widths, sw, gap, ow, front, fa, tw, th, sdx, sdy, sb, ba, padx, pady, bgx, bgy, w: ex * 2, h: ey * 2 };
}
// 文字の寄せ(左寄せ・中央寄せ・右寄せ)。枠は一番長い行の幅で、短い行をその中で寄せる。無ければ中央寄せ
export const ALIGNS = [["left", "左寄せ"], ["center", "中央寄せ"], ["right", "右寄せ"]];
export const alignOf = (o) => (o?.align === "left" || o?.align === "right" ? o.align : "center");
export function lineX(L, o, i) {
  const a = alignOf(o);
  if (a === "left") return -L.tw / 2 + (L.ow ?? L.sw);
  if (a === "right") return L.tw / 2 - (L.ow ?? L.sw) - L.widths[i];
  return -L.widths[i] / 2;
}
// 描く文字の並び。一文字ずつ動かす(opt.fx)ときは 1 文字ずつ、それ以外は 1 行ずつ。
// opt.lineH: 行の高さ(動画編集のプレビューは画面の文字と同じ 1.2 倍)・opt.reveal: 一文字ずつ出すときの進み(0〜1)
export function textItems(g, o, L, opt = {}) {
  const lineH = opt.lineH || L.lineH, n = L.lines.length;
  // 1 行目の文字の下の線(行の高さの真ん中に、文字の上下の高さが来る)
  const base0 = -(n * lineH) / 2 + (lineH - L.asc - (L.desc ?? 0)) / 2 + L.asc;
  const total = L.lines.reduce((a, l) => a + [...l].length, 0);
  let k = opt.reveal == null ? Infinity : Math.floor(clamp(opt.reveal, 0, 1) * total + 1e-9);
  const out = [];
  L.lines.forEach((line, li) => {
    const cs = [...line], shown = cs.slice(0, clamp(k, 0, cs.length));
    k -= cs.length;
    const x0 = lineX(L, o, li), y = base0 + li * lineH;
    if (!shown.length) return;
    if (!opt.fx) { out.push({ s: shown.join(""), x: x0, y }); return; }
    let pre = "";
    const ow = L.ow ?? L.sw, hh = L.asc + (L.desc ?? 0);
    for (const ch of shown) {
      if (!/\s/.test(ch)) {
        const x = x0 + g.measureText(pre).width, w = g.measureText(ch).width;
        out.push({ s: ch, x, y, w, h: hh, cx: x + w / 2, cy: y + ((L.desc ?? 0) - L.asc) / 2, box: [x - ow, y - L.asc - ow, w + 2 * ow, hh + 2 * ow] });
      }
      pre += ch;
    }
  });
  if (opt.fx) out.forEach((it, i) => { it.tf = opt.fx(i, out.length, it); });
  return out;
}
// 形で出す・消す効果の形を、x, y, w, h の枠に作る(書き出し trans_mask と同じ形)。返り値: 塗りの決まり(clip に渡す)
export function clipShape(c, tr, p, x, y, w, h) {
  const pp = clamp(p, 0, 1), q = pp * pp * (3 - 2 * pp), t = tr.type, rev = !!tr.rev;
  const rect = (a, b, cw, ch) => c.rect(x + a * w, y + b * h, cw * w, ch * h);
  const outer = () => c.rect(x - w, y - h, w * 3, h * 3); // 抜く形のときの外側(枠より広く)
  const poly = (pts) => { pts.forEach(([u, v], k) => (k ? c.lineTo(x + u * w, y + v * h) : c.moveTo(x + u * w, y + v * h))); c.closePath(); };
  c.beginPath();
  if (t === "wipe_h") { if (tr.flipH) rect(1 - q, 0, q, 1); else rect(0, 0, q, 1); }
  else if (t === "wipe_v") { if (tr.flipV) rect(0, 1 - q, 1, q); else rect(0, 0, 1, q); }
  else if (t === "split_h" || t === "split_v") {
    const a = rev ? 1 - q : q, hz = t === "split_h";
    if (rev) { outer(); if (hz) rect((1 - a) / 2, -1, a, 3); else rect(-1, (1 - a) / 2, 3, a); return "evenodd"; }
    if (hz) rect((1 - a) / 2, 0, a, 1); else rect(0, (1 - a) / 2, 1, a);
  } else if (t === "iris_box") {
    const a = rev ? 1 - q : q;
    if (rev) { outer(); rect((1 - a) / 2, (1 - a) / 2, a, a); return "evenodd"; }
    rect((1 - a) / 2, (1 - a) / 2, a, a);
  } else if (t === "iris_diamond") {
    const r = rev ? 1 - q : q, d = [[0.5, 0.5 - r], [0.5 + r, 0.5], [0.5, 0.5 + r], [0.5 - r, 0.5]];
    if (rev) { outer(); poly(d); return "evenodd"; }
    poly(d);
  } else if (t === "iris_circle") {
    const R = (rev ? 1 - q : q) * 0.5 * Math.hypot(w, h);
    if (rev) { outer(); c.moveTo(x + w / 2 + R, y + h / 2); }
    c.arc(x + w / 2, y + h / 2, Math.max(0, R), 0, Math.PI * 2);
    if (rev) return "evenodd";
  } else if (t === "clock") {
    const cx = x + w / 2, cy = y + h / 2, R = Math.hypot(w, h), a0 = -Math.PI / 2;
    c.moveTo(cx, cy);
    c.arc(cx, cy, R, a0, a0 + (tr.flipH ? -1 : 1) * q * Math.PI * 2, !!tr.flipH);
    c.closePath();
  }
  return "nonzero";
}
// 文字ごとの動き(位置のずれ・大きさ・回転・不透明度)を掛ける
function tfApply(c, it) {
  const t = it.tf;
  if (!t) return;
  c.translate(it.cx + (t.dx || 0), it.cy + (t.dy || 0));
  if (t.rot) c.rotate((t.rot * Math.PI) / 180);
  if (t.sc != null && t.sc !== 1) c.scale(t.sc, t.sc);
  c.translate(-it.cx, -it.cy);
}
const opOf = (it) => clamp(it.tf?.op ?? 1, 0, 1);
// 文字ごとの動き・形(形で出す効果)・ぼかしを掛ける(dx, dy: 縁をずらすときの量。形の枠も一緒にずらす)
function prep(c, it, dx = 0, dy = 0) {
  tfApply(c, it);
  for (const [tr, p] of it.tf?.clips || []) {
    const [x, y, w, h] = it.box;
    const rule = clipShape(c, tr, p, x + dx, y + dy, w, h);
    c.clip(rule);
  }
  const b = it.tf?.blur || 0;
  if (b > 0.3) { const m = c.getTransform(); c.filter = `blur(${b * Math.hypot(m.a, m.b)}px)`; }
}
// 中心 (0, 0) に描く(呼ぶ側で translate・rotate する)。L は textLayout の結果。
// opt: fx(i, n) → 文字ごとの動き { dx, dy, sc, rot, op }(一文字ずつ動かす)・noBg(背景を描かない)・lineH・reveal(textItems と同じ)
export function drawTextAt(g, o, L, font, opt = {}) {
  g.save();
  g.font = font;
  g.textBaseline = "alphabetic";
  g.lineJoin = "round";
  if (L.ba > 0 && !opt.noBg) {
    const bw = L.tw + 2 * L.padx, bh = L.th + 2 * L.pady;
    const rad = clamp(Number(o.bgRadius || 0), 0, 1) * Math.min(bw, bh) / 2;
    g.fillStyle = `rgba(${hexRgb(o.bg, [0, 0, 0]).join(",")},${clamp(L.ba, 0, 1)})`;
    g.beginPath();
    if (g.roundRect) g.roundRect(-L.tw / 2 - L.padx + L.bgx, -L.th / 2 - L.pady + L.bgy, bw, bh, rad); else g.rect(-L.tw / 2 - L.padx + L.bgx, -L.th / 2 - L.pady + L.bgy, bw, bh);
    g.fill();
  }
  const items = textItems(g, o, L, opt);
  const stroke = o.stroke || "#000000", sa = clamp(o.strokeAlpha ?? 1, 0, 1);
  const gap = L.gap || 0, front = !!L.front, outer = L.sw + gap, fa = L.fa ?? 1;
  // 縁の輪: 文字のふちから外へ inner 〜 outer の所(マイナスは文字の内側)。マイナスの所がある(内側に入る)ときは、縁を文字の前に描く
  const inner = front ? gap - L.sw : gap, inFront = front || gap < 0;
  // 文字を r だけ太らせた形(r = 0 は文字の形)。dx, dy: ずらす
  const fat = (c, it, r, dx, dy) => { if (r > 0) { c.lineWidth = r * 2; c.strokeText(it.s, it.x + dx, it.y + dy); } c.fillText(it.s, it.x + dx, it.y + dy); };
  const each = (c, fn, alpha = true, dx = 0, dy = 0) => {
    for (const it of items) {
      const op = opOf(it);
      if (op <= 0.001) continue;
      c.save();
      if (alpha) c.globalAlpha *= op;
      prep(c, it, dx, dy);
      fn(c, it);
      c.restore();
    }
  };
  const shadow = Math.abs(L.sdx) > 0.5 || Math.abs(L.sdy) > 0.5 || L.sb > 0.3;
  const layered = (L.sw > 0 || shadow) && (shadow || sa < 0.999 || gap !== 0 || front || fa < 0.999 || !!opt.fx);
  let drawLayer = null;
  if (layered) {
    // 縁を別の層に描く(ずらす・透かす・ぼかす = 影。離す・前に描くときは輪の形にする)。重なった所が濃くならないように、まとめて透かす。
    // 今の倍率で描く(拡大して見てもぼやけないように)
    const m = g.getTransform(), k0 = Math.hypot(m.a, m.b) || 1;
    const bw = Math.ceil(L.w) + 4 + (opt.margin || 0) * 2, bh = Math.ceil(L.h) + 4 + (opt.margin || 0) * 2;
    const k = clamp(Math.min(k0, 8192 / bw, 8192 / bh), 0.05, 8);
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.ceil(bw * k)); cv.height = Math.max(1, Math.ceil(bh * k));
    const s = cv.getContext("2d");
    const setup = (c) => { c.setTransform(k, 0, 0, k, cv.width / 2, cv.height / 2); c.font = font; c.textBaseline = "alphabetic"; c.lineJoin = "round"; c.fillStyle = c.strokeStyle = stroke; };
    setup(s);
    // 文字を r だけ太らせた形(r < 0 は |r| だけ細らせた形)を、s の今の重ね方で描く
    let t = null;
    const shape = (r) => {
      if (r >= 0) { each(s, (c, it) => fat(c, it, r, L.sdx, L.sdy), true, L.sdx, L.sdy); return; }
      // 細らせた形: 文字の形から、まわりの |r| の線を除いたもの(文字ごとに別の紙で作って重ねる)
      if (!t) { t = document.createElement("canvas"); t.width = cv.width; t.height = cv.height; }
      const tg = t.getContext("2d");
      for (const it of items) {
        const op = opOf(it);
        if (op <= 0.001) continue;
        tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, t.width, t.height);
        setup(tg); prep(tg, it, L.sdx, L.sdy);
        tg.fillText(it.s, it.x + L.sdx, it.y + L.sdy);
        tg.globalCompositeOperation = "destination-out"; tg.lineWidth = -r * 2; tg.strokeText(it.s, it.x + L.sdx, it.y + L.sdy);
        s.save(); s.setTransform(1, 0, 0, 1, 0, 0); s.globalAlpha = op; s.drawImage(t, 0, 0); s.restore();
      }
    };
    shape(outer);
    s.globalCompositeOperation = "destination-out";
    // 離す・前に描く・内側へ寄せる・文字が透けるときは、内側(inner より内)を抜いて輪にする
    if (inFront || gap > 0 || fa < 0.999) shape(inner);
    else if (opt.fx) each(s, (c, it) => { if (opOf(it) < 0.999) { c.globalAlpha = 1; c.fillText(it.s, it.x, it.y); } }, false); // 消えかけの文字の中に縁の色が透けないように
    drawLayer = () => {
      g.save();
      // canvas のぼかしは拡大・縮小の影響を受けないので、今の倍率を掛ける(見る倍率が違っても描き込みと同じ見た目)
      if (L.sb > 0.3) g.filter = `blur(${L.sb * k0}px)`;
      g.globalAlpha *= sa;
      g.drawImage(cv, -cv.width / 2 / k, -cv.height / 2 / k, cv.width / k, cv.height / k);
      g.restore();
    };
  }
  if (drawLayer && !inFront) drawLayer();
  else if (!layered && L.sw > 0) { g.lineWidth = L.sw * 2; g.strokeStyle = stroke; g.fillStyle = stroke; each(g, (c, it) => fat(c, it, L.sw, 0, 0)); }
  g.fillStyle = `rgba(${hexRgb(o.color || "#ffffff").join(",")},${fa})`;
  if (fa > 0.001) each(g, (c, it) => c.fillText(it.s, it.x, it.y));
  if (drawLayer && inFront) drawLayer();
  g.restore();
}

// ---------------------------------------------------------------- 右の欄(文字のメイン・縁・背景)
// ---------------------------------------------------------------- 説明文を ⓘ で折りたたむ(生成ページと同じ)
const NOTE_SKIP = new Set(["info", "cvinfo", "msel", "outnote", "fmtnote", "adjtarget"]);
export function enhanceNotes(root) {
  const opened = new Set();
  const keyOf = (n) => n.textContent.trim();
  const eligible = (n) => !NOTE_SKIP.has(n.dataset.c) && !n.classList.contains("kfnote") && !n.hasAttribute("style") && keyOf(n).length >= 24 && !/読み込んで/.test(n.textContent);
  const mk = () => { const b = document.createElement("button"); b.type = "button"; b.className = "ib"; b.textContent = "ⓘ"; b.title = T("説明を表示"); return b; };
  // 説明の入っている欄(見出しのあるもの): 見出しの右に ⓘ を置く(欄の下に ⓘ だけの行ができないように)
  const boxOf = (n) => { const c = n.parentElement?.closest("details, section, .lcrop"); return c && root.contains(c) && [...c.children].some((x) => x.matches("summary, h4, .lch")) ? c : null; };
  const sync = () => {
    const groups = new Map();
    for (const n of root.querySelectorAll(".note")) {
      const prev = n.previousElementSibling;
      let btn = prev && prev.classList.contains("ib") && prev._note === n ? prev : null;
      if (!eligible(n)) { btn?.remove(); n.classList.remove("nh"); n._ibKey = null; continue; }
      const key = keyOf(n);
      if (n._ibKey !== key) { n._ibKey = key; n.classList.toggle("nh", !opened.has(key)); }
      const c = boxOf(n);
      if (c) { btn?.remove(); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(n); continue; }
      if (!btn) { btn = mk(); btn._note = n; n.before(btn); }
      btn.classList.toggle("on", !n.classList.contains("nh"));
    }
    for (const b of root.querySelectorAll("button.ib.hd")) if (!groups.has(b.parentElement)) { b.parentElement?.classList.remove("ibc"); b.remove(); }
    for (const [c, notes] of groups) {
      let b = [...c.children].find((x) => x.matches("button.ib.hd"));
      if (!b) { b = mk(); b.classList.add("hd"); c.classList.add("ibc"); c.appendChild(b); }
      b._notes = notes;
      b.classList.toggle("on", notes.some((n) => !n.classList.contains("nh")));
    }
  };
  let raf = 0;
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync(); }); }).observe(root, { childList: true, subtree: true, characterData: true });
  root.addEventListener("click", (e) => {
    const b = e.target?.closest?.("button.ib");
    if (!b || !root.contains(b) || (!b._note && !b._notes)) return;
    e.preventDefault(); e.stopPropagation();
    const ns = b._notes || [b._note], open = ns.some((n) => n.classList.contains("nh"));
    for (const n of ns) { n.classList.toggle("nh", !open); if (open) opened.add(keyOf(n)); else opened.delete(keyOf(n)); }
    b.classList.toggle("on", open);
  }, true);
  sync();
}
export const num = (k, label, v, min, max, step, extra = "") => `<label class="fl">${T(label)}<input type="number" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}" ${extra}></label>`;
export const chk = (k, label, v, extra = "") => `<label class="ck"><input type="checkbox" data-k="${k}" ${v ? "checked" : ""} ${extra}><span>${T(label)}</span></label>`;
// isOpen(cls) → 開いておくか
export function sec(cls, title, body, open = true) {
  return `<details class="sec s-${cls}" data-sec="${cls}" ${open ? "open" : ""}><summary>${title}</summary><div class="sb">${body}</div></details>`;
}
// 100 倍して % で見せる文字の値と、範囲(0〜1 の値で)
export const TEXT_PCT = new Set(["size", "colorA", "strokeWidth", "strokeGap", "strokeDx", "strokeDy", "strokeAlpha", "strokeBlur", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", "bgRadius", "wrap", "x", "y", "opacity"]);
export const TEXT_RANGE = { size: [0.005, 1], colorA: [0, 1], strokeWidth: [0, 0.5], strokeGap: [-1, 1], strokeDx: [-1, 1], strokeDy: [-1, 1], strokeAlpha: [0, 1], strokeBlur: [0, 0.5], bgAlpha: [0, 1], bgPadX: [0, 3], bgPadY: [0, 3],
  bgOffX: [-3, 3], bgOffY: [-3, 3], bgRadius: [0, 1], wrap: [0, 2], x: [-1, 2], y: [-1, 2], rot: [-3600, 3600], opacity: [0, 1] };
export const TEXT_DEFAULTS = { colorA: 1, strokeWidth: 0.08, strokeGap: 0, strokeDx: 0, strokeDy: 0, strokeAlpha: 1, strokeBlur: 0, bgAlpha: 0, bgPadX: 0.3, bgPadY: 0.3, bgOffX: 0, bgOffY: 0, bgRadius: 0, wrap: 0 };
// テンプレートに無いものはふつうの値に戻す(前のテンプレートの影や帯が残らないように)
export const STYLE_RESET = { colorA: 1, strokeGap: 0, strokeFront: false, strokeDx: 0, strokeDy: 0, strokeAlpha: 1, strokeBlur: 0, bgAlpha: 0, bgPadX: 0.3, bgPadY: 0.3, bgOffX: 0, bgOffY: 0, bgRadius: 0 };
export const STYLE_KEYS = ["font", "size", "color", "colorA", "stroke", "strokeWidth", "strokeGap", "strokeFront", "strokeDx", "strokeDy", "strokeAlpha", "strokeBlur", "bg", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", "bgRadius"];
const pv = (o, k) => r3((o[k] ?? TEXT_DEFAULTS[k] ?? 0) * 100);
// h: { fontOptions(cur), tplHtml, size(今の大きさ 0〜1), open(cls) → bool, fontButtons(省略可), sizeLabel }
export function textSectionsHtml(o, h) {
  const open = h.open || (() => true);
  return sec("main", T("メイン(文字・フォント・色)"), `<label class="fl">${T("文字")}<textarea data-k="text">${esc(o.text)}</textarea></label>
      ${h.tplHtml || ""}
      <label class="fl fl-font"><span>${T("フォント")}</span><select data-k="font" data-font-preview>${h.fontOptions(o.font)}</select></label>
      ${h.fontButtons || ""}
      ${num("size", h.sizeLabel || "文字の大きさ(%)", r3((h.size ?? o.size ?? 0.08) * 100), 0.5, 100, 0.5)}
      <label class="fl">${T("文字の色")}<input type="color" data-k="color" value="${o.color || "#ffffff"}"></label>
      ${num("colorA", "文字の色の不透明度(%)", r3((o.colorA ?? 1) * 100), 0, 100, 5, `title="${esc(T("文字の色だけを透かします(縁・影・背景はそのまま)。0 で縁だけの文字"))}"`)}
      ${num("wrap", "折り返す幅(%)", pv(o, "wrap"), 0, 200, 1, `title="${esc(T("0 = 折り返さない。画面(画像)の幅に対しての %。枠の左右の □ をドラッグしても変えられます"))}"`)}
      <label class="fl">${T("文字の寄せ")}<select data-k="align">${ALIGNS.map(([v, l]) => `<option value="${v}" ${alignOf(o) === v ? "selected" : ""}>${T(l)}</option>`).join("")}</select></label>`, open("main"))
    + sec("stk", T("縁(ずらすと影)"), `<label class="fl">${T("縁の色")}<input type="color" data-k="stroke" value="${o.stroke || "#000000"}"></label>
      ${num("strokeWidth", "縁の太さ(%)", pv(o, "strokeWidth"), 0, 50, 1)}
      ${num("strokeGap", "縁を離す(%)", pv(o, "strokeGap"), -100, 100, 1, `title="${esc(T("文字と縁の間をあけます(枠のようになります)。マイナスにすると、縁を文字の内側へ寄せます。文字の大きさに対しての %"))}"`)}
      ${chk("strokeFront", "縁を文字の前に描く(文字の内側にも縁が入る)", !!o.strokeFront)}
      ${num("strokeDx", "ずらす 横(%)", pv(o, "strokeDx"), -100, 100, 1)}${num("strokeDy", "ずらす 縦(%)", pv(o, "strokeDy"), -100, 100, 1)}
      ${num("strokeAlpha", "縁の濃さ(%)", pv(o, "strokeAlpha"), 0, 100, 5)}
      ${num("strokeBlur", "縁のぼかし(%)", pv(o, "strokeBlur"), 0, 50, 1, `title="${esc(T("縁(影)だけをぼかします。文字はくっきりのまま"))}"`)}
      <div class="note">${T("縁を右下へずらして濃さを下げ、ぼかすと影になります(縁の太さが 0 でも、ずらすかぼかせば文字の形の影)。% は文字の大きさに対して。")}</div>
      <div class="note">${T("「縁を離す」で文字と縁の間があき、枠のようになります。マイナスにすると、縁がその分だけ文字の内側へ入ります(文字の前に描きます)。「縁を文字の前に描く」では縁の太さのぶん文字の内側にも縁が入ります(細い文字は塗りが隠れるので、縁を細くしてください)。")}</div>`, open("stk"))
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
  else if (k === "align") el.value = alignOf(o);
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
${scope} button.ib{display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0!important;margin:4px 0 2px auto;border-radius:999px!important;font-size:13px!important;line-height:1;background:transparent!important;color:#9fb0c2!important;border:1px solid #4a5566!important;cursor:pointer}
${scope} button.ib:hover,${scope} button.ib.on{color:#fff!important;border-color:#3db4a6!important}
${scope} .note.nh{display:none!important}
${scope} .ibc{position:relative}
${scope} button.ib.hd{position:absolute;top:5px;right:8px;margin:0!important;z-index:2}
${scope} details:not([open])>button.ib.hd,${scope} .sec-folded>button.ib.hd{display:none}
${scope} details.ibc>summary,${scope} section.ibc>h4,${scope} .lcrop.ibc>.lch{padding-right:34px}
${scope} label.fl.fl-font{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}
${scope} label.fl.fl-font select{flex:1 1 12em;min-width:0}
${scope} label.fl{display:grid;grid-template-columns:8.5em minmax(0,1fr);gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:4px}
${scope} label.ck{display:flex;gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:5px;cursor:pointer}
${scope} label.ck input:disabled+span{opacity:.45}
${scope} .cca-cpk{display:inline-flex;gap:4px;align-items:center;min-width:0}
${scope} .cca-cpk[hidden]{display:none!important}
${scope} label.fl .cca-cpk{display:flex}
${scope} .cca-cpk input[type="color"]{flex:1 1 auto;min-width:2.5em}
${scope} .cca-cpk .cca-dropper{flex:none;white-space:nowrap;font-size:12px;padding:2px 7px}
${scope} .cca-picking,${scope} .cca-picking *{cursor:crosshair!important}
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
    } else {
      // 大きさ: 反対側の辺(角なら対角の角)を止めて広げる。Alt を押している間は真ん中を止める(res.c = true)。
      // 止める所が動かないよう、枠の真ん中が動く分(画面の px)を res.dcx・res.dcy で返す(呼ぶ側は位置にこれを足す)。res.handle = 持ち手
      const px = ev.clientX - o.cx, py = ev.clientY - o.cy;
      const lx = px * Math.cos(-th) - py * Math.sin(-th), ly = px * Math.sin(-th) + py * Math.cos(-th);
      const hw = o.w / 2, hh = o.h / 2;
      const scr = (a, b) => [a * Math.cos(th) - b * Math.sin(th), a * Math.sin(th) + b * Math.cos(th)];
      if (ev.altKey) {
        if (h.length === 2) res = { k: Math.max(0.02, Math.hypot(px, py) / d0), c: true };
        else res = h === "e" || h === "w" ? { w: Math.max(8, Math.abs(lx) * 2), c: true } : { h: Math.max(8, Math.abs(ly) * 2), c: true };
      } else if (h.length === 2) {
        const sx = h.includes("w") ? -1 : 1, sy = h.includes("n") ? -1 : 1;
        const k = Math.max(0.02, Math.hypot(lx + sx * hw, ly + sy * hh) / Math.max(4, Math.hypot(o.w, o.h)));
        const [dcx, dcy] = scr(sx * hw * (k - 1), sy * hh * (k - 1));
        res = { k, dcx, dcy };
      } else if (h === "e" || h === "w") {
        const w = Math.max(8, h === "e" ? lx + hw : hw - lx);
        const [dcx, dcy] = scr((h === "e" ? 1 : -1) * (w - o.w) / 2, 0);
        res = { w, dcx, dcy };
      } else {
        const hg = Math.max(8, h === "s" ? ly + hh : hh - ly);
        const [dcx, dcy] = scr(0, (h === "s" ? 1 : -1) * (hg - o.h) / 2);
        res = { h: hg, dcx, dcy };
      }
      res.handle = h;
    }
    o.onMove(res, ev);
  };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); o.onEnd?.(); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
