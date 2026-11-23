// CCA Generator: 枠(バウンディングボックス)で配置を指定する画面
// - 画像の上(テキスト→画像は出力の大きさの白紙)をドラッグして枠を作る。枠をドラッグで移動、角で大きさを変える
// - 枠ごとに「何を置くか」(英語)と種類(物 / 文字。MOSS は人物も)を書く
// - 決定すると、パネルの layout_boxes(JSON)に入る。生成時にサーバーがプロンプトへ組み込む(layout.py)
// 範囲別指定では、範囲の形(四角・円・三角)も選べる。三角は角をドラッグして相手の角を越えると反転する
// 生成パネル(cca_ui.js)から openLayoutEditor() で開く。このファイル単体では何も登録しない。

import { weightKey } from "./cca_text.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#ff5d5d", "#4fc3f7", "#ffd54f", "#81c784", "#ba68c8", "#ff8a65", "#4db6ac", "#f06292", "#aed581", "#9575cd"];
const HELP = {
  region: "ドラッグで範囲を描き、範囲ごとに「そこに描きたいもの」を書きます(範囲別指定)。範囲の形は四角・円・三角から選べます。"
    + "通常のプロンプトは、どの範囲にも入っていない部分を埋めます。範囲が重なった所は、後から描いた範囲が優先です。",
  flux3: "画像の上をドラッグして枠を作り、枠ごとに「何を置くか」を英語で書きます。プロンプトでは枠を <obj_1>、<obj_2> … と番号で指せます"
    + "(例: In <ref_image_0>, change the dress <obj_1> to red.)。先に作った枠が奥、後の枠が手前です。",
  moss: "ドラッグで枠を作り、枠ごとに置く物・人物・文字を英語で書きます。プロンプトには画像全体の説明を書きます。"
    + "先に作った枠が奥、後の枠が手前です。",
};

const SQ3 = Math.sqrt(3);
// 画素での縦横比(幅:高さ)。角度が正確になるよう、これらの形は比率を固定する
const RATIO = {}; // 縦横比は固定しない(どの形も四角と同じように自由に変えられる)
// 三角の頂点(0〜1)。三角1 = 直角二等辺三角形 / 三角2 = 直角三角形(60°・30°) / 三角3 = 正三角形。描画の初期の向きで、角のドラッグで反転するので直角の位置は固定ではない
const POLY = { tri1: [[0, 0], [1, 0], [0, 1]], tri2: [[0, 1], [1, 1], [0.5, 0]], tri3: [[0, 1], [0.75, 0], [1, 0.45]] };
const SHAPES = [["rect", "四角(デフォルト)"], ["circle", "円"], ["tri1", "三角1(角に3つ:直角三角形)"], ["tri2", "三角2(角に2つ:2辺が同じ三角形)"], ["tri3", "三角3(角に1つ:どの辺も違う三角形)"]];
const colorOf = (b, i) => COLORS[((b.ci ?? i) | 0) % COLORS.length];
const nextColor = () => { const used = new Set(st.boxes.map((b) => b.ci)); let k = 0; while (used.has(k)) k++; return k; };
const isRegion = () => !!ctx && (ctx.kind === "region" || !!ctx.regional);

let ui = null;
let ctx = null;
const st = { boxes: [], sel: -1, drag: null, aspect: 1 };
const NEWBOX = { x: 0, y: 0, w: 0, h: 0, type: "obj", desc: "", text: "", character: false, shape: "rect", fx: false, fy: false, rot: 0 };

function css() {
  if (document.getElementById("cca-layout-style")) return;
  const s = document.createElement("style");
  s.id = "cca-layout-style";
  s.textContent = `
#cca-layout{position:fixed;inset:0;z-index:1001;background:#000c;display:none;align-items:center;justify-content:center;
  font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-layout.open{display:flex}
#cca-layout .win{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(1280px,calc(100vw - 32px));height:min(860px,calc(100vh - 32px));display:flex;flex-direction:column}
#cca-layout .hd{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #303744}
#cca-layout .hd .help{color:#b8c0cc;font-size:13px;flex:1}
#cca-layout button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit;font-size:14px}
#cca-layout button:hover{border-color:#3db4a6}
#cca-layout button.pri{background:#2b8f84;border-color:#2b8f84;color:#fff}
#cca-layout .bd{flex:1;display:flex;min-height:0}
#cca-layout .stagewrap{flex:1;display:flex;align-items:center;justify-content:center;padding:14px;min-width:0;background:#0b0d10}
#cca-layout .stage{position:relative;background:#f4f4f4;cursor:crosshair;user-select:none;touch-action:none;box-shadow:0 0 0 1px #3a4250}
#cca-layout .stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
#cca-layout .stage .grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(#0001 1px,transparent 1px),linear-gradient(90deg,#0001 1px,transparent 1px);background-size:10% 10%}
#cca-layout .bx{position:absolute;border:2px solid;box-sizing:border-box;cursor:move}
#cca-layout .bx .lb{position:absolute;left:-2px;top:-24px;padding:1px 6px;font-size:13px;color:#000;border-radius:4px 4px 0 0;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis}
#cca-layout .bx.on{box-shadow:0 0 0 2px #fff8;z-index:3}
#cca-layout .bx .lb{pointer-events:none}
#cca-layout .bx .h{position:absolute;width:12px;height:12px;background:#fff;border:2px solid #000;box-sizing:border-box;display:none}
#cca-layout .bx.on .h{display:block}
#cca-layout .bx .h[data-c=nw]{left:-7px;top:-7px;cursor:nwse-resize}#cca-layout .bx .h[data-c=se]{right:-7px;bottom:-7px;cursor:nwse-resize}
#cca-layout .bx .h[data-c=ne]{right:-7px;top:-7px;cursor:nesw-resize}#cca-layout .bx .h[data-c=sw]{left:-7px;bottom:-7px;cursor:nesw-resize}
#cca-layout .side{width:400px;border-left:1px solid #303744;display:flex;flex-direction:column;min-height:0}
#cca-layout .list{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
#cca-layout .row{border:1px solid #303744;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;background:#151920}
#cca-layout .row.on{border-color:#3db4a6}
#cca-layout .row .top{display:flex;gap:6px;align-items:center}
#cca-layout .row .no{font-weight:700;color:black !important;border-radius:4px;padding:0 8px;background:var(--c) !important}
#cca-layout .bx.shaped{border:1px dashed var(--c) !important;background:none !important}
#cca-layout .row select,#cca-layout .row input,#cca-layout .row textarea{background:var(--card2,#0e1115) !important;color:var(--text,#e4e7eb) !important;border:1px solid var(--line,#3a4250);border-radius:6px;padding:5px 8px;font:inherit;font-size:14px}
#cca-layout .row select option{background:var(--card,#0e1115) !important;color:var(--text,#e4e7eb) !important}
#cca-layout .row .rotrow{flex-wrap:nowrap;align-items:center;gap:8px}
#cca-layout .row .rotrow input[type=range]{flex:1;width:auto;min-width:0;padding:0;border:0;background:none !important}
#cca-layout .row input:not([type=radio]),#cca-layout .row textarea{width:100%;box-sizing:border-box}
#cca-layout .row textarea{resize:vertical;min-height:4.6em;line-height:1.45}
#cca-layout .row .shp{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:13px;color:#cfd5dc}
#cca-layout .row .shp label{display:flex;align-items:center;gap:4px;cursor:pointer}
#cca-layout .row .shp input{width:auto;margin:0}
#cca-layout .row .sp{flex:1}
#cca-layout .row button{padding:3px 8px}
#cca-layout .empty{color:#959eab;padding:10px}
#cca-layout .ft{display:flex;gap:8px;padding:10px 16px;border-top:1px solid #303744;align-items:center}
#cca-layout .ft .sp{flex:1}
`;
  document.head.appendChild(s);
}

function build() {
  css();
  ui = document.createElement("div");
  ui.id = "cca-layout";
  ui.innerHTML = `<div class="win">
    <div class="hd"><b>枠で配置を指定</b><span class="help"></span></div>
    <div class="bd">
      <div class="stagewrap"><div class="stage"><div class="grid"></div></div></div>
      <div class="side"><div class="list"></div></div>
    </div>
    <div class="ft"><button data-a="clear">すべて消す</button><span class="hint" style="color:#959eab;font-size:13px">選んだ枠は Delete キーでも消せます</span>
      <span class="sp"></span><button data-a="cancel">キャンセル</button><button class="pri" data-a="ok">この枠を使う</button></div>
  </div>`;
  document.body.appendChild(ui);
  ui.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "");
    if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown") && e.target?.matches?.('textarea[data-k="desc"]')) {
      if (weightKey(e.target, e.key === "ArrowUp" ? 1 : -1)) e.preventDefault(); // 通常のプロンプトと同じ: Ctrl+↑↓ で (語:1.1)
      return;
    }
    if (e.key === "Escape") close();
    else if ((e.key === "Delete" || e.key === "Backspace") && !typing && st.sel >= 0) { remove(st.sel); }
  });
  ui.querySelector('[data-a="clear"]').onclick = () => { st.boxes = []; st.sel = -1; render(); };
  ui.querySelector('[data-a="cancel"]').onclick = () => close();
  ui.querySelector('[data-a="ok"]').onclick = () => { ctx?.onSave?.(st.boxes.map((b) => ({ ...b }))); close(); };
  const stage = ui.querySelector(".stage");
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", () => { if (ui.classList.contains("open")) fit(); });
}

function fit() {
  const wrap = ui.querySelector(".stagewrap");
  const stage = ui.querySelector(".stage");
  const W = wrap.clientWidth - 28, H = wrap.clientHeight - 28;
  let w = W, h = W / st.aspect;
  if (h > H) { h = H; w = H * st.aspect; }
  stage.style.width = `${Math.max(50, Math.floor(w))}px`;
  stage.style.height = `${Math.max(50, Math.floor(h))}px`;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function frac(e) {
  const r = ui.querySelector(".stage").getBoundingClientRect();
  return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
}

function onDown(e) {
  if (e.button !== 0) return;
  const stage = e.currentTarget;
  stage.setPointerCapture(e.pointerId);
  const [x, y] = frac(e);
  const h = e.target.closest(".h");
  const bx = e.target.closest(".bx");
  if (h && bx) {
    st.sel = Number(bx.dataset.i);
    st.drag = { mode: "resize", c: h.dataset.c, i: st.sel, orig: { ...st.boxes[st.sel] } };
  } else if (bx) {
    st.sel = Number(bx.dataset.i);
    st.drag = { mode: "move", i: st.sel, x0: x, y0: y, orig: { ...st.boxes[st.sel] } };
  } else {
    st.boxes.push({ ...NEWBOX, x, y, ci: nextColor() });
    st.sel = st.boxes.length - 1;
    st.drag = { mode: "new", i: st.sel, x0: x, y0: y };
  }
  render();
}
function onMove(e) {
  const d = st.drag;
  if (!d) return;
  const [x, y] = frac(e);
  const b = st.boxes[d.i];
  if (d.mode === "new") {
    b.x = Math.min(d.x0, x); b.y = Math.min(d.y0, y); b.w = Math.abs(x - d.x0); b.h = Math.abs(y - d.y0);
  } else if (d.mode === "move") {
    b.x = clamp(d.orig.x + x - d.x0, 0, 1 - d.orig.w);
    b.y = clamp(d.orig.y + y - d.y0, 0, 1 - d.orig.h);
  } else {
    const o = d.orig;
    const west = d.c.includes("w"), north = d.c.includes("n");
    const ax = west ? o.x + o.w : o.x, ay = north ? o.y + o.h : o.y; // 動かさない角(反対側の角)
    const lock = isRegion() && /^tri/.test(o.shape || "");
    const rad = (isRegion() ? Number(o.rot) || 0 : 0) * Math.PI / 180;
    let dx, dy; // 枠の向きにそろえた座標での、動かさない角からポインターまでの差(割合ではなく画素)
    if (rad) {
      // 回転した枠: 動かさない角は画面上で動かさず、ポインターまでを枠の向きに戻して幅・高さにする
      const [W, H] = pxSize(), c = Math.cos(rad), sn = Math.sin(rad);
      const fx0 = (west ? 1 : -1) * o.w * W / 2, fy0 = (north ? 1 : -1) * o.h * H / 2;
      const Fx = (o.x + o.w / 2) * W + fx0 * c - fy0 * sn, Fy = (o.y + o.h / 2) * H + fx0 * sn + fy0 * c;
      const px = x * W - Fx, py = y * H - Fy;
      dx = px * c + py * sn; dy = -px * sn + py * c;
      const ncx = (Fx + x * W) / 2, ncy = (Fy + y * H) / 2;
      b.w = Math.abs(dx) / W; b.h = Math.abs(dy) / H;
      b.x = ncx / W - b.w / 2; b.y = ncy / H - b.h / 2;
    } else {
      dx = x - ax; dy = y - ay;
      b.w = Math.abs(dx); b.h = Math.abs(dy);
      b.x = dx >= 0 ? ax : ax - b.w; b.y = dy >= 0 ? ay : ay - b.h;
    }
    // 角を反対側の角の向こうへドラッグしたら、三角は反転する
    if (lock) {
      b.fx = !!o.fx !== (west ? dx > 0 : dx < 0);
      b.fy = !!o.fy !== (north ? dy > 0 : dy < 0);
    }
  }
  renderBoxes();
}
function pxSize() { const r = ui.querySelector(".stage").getBoundingClientRect(); return [r.width || 1, r.height || 1]; }
// 比率を固定する形の幅・高さ(割合)を、比率に合わせて決める(maxW・maxH = はみ出さない上限)
function lockWH(shape, w, h, maxW, maxH) {
  const r = RATIO[shape], [W, H] = pxSize();
  const s = Math.min(Math.max(w * W / r[0], h * H / r[1]), maxW * W / r[0], maxH * H / r[1]);
  return [s * r[0] / W, s * r[1] / H];
}
// 形を変えたとき、今の範囲の中に収まる最大の大きさにして中央に置く
function fitShape(b) {
  const r = RATIO[b.shape];
  if (!r) return;
  const [W, H] = pxSize();
  const s = Math.min(b.w * W / r[0], b.h * H / r[1]);
  const w = s * r[0] / W, h = s * r[1] / H;
  b.x += (b.w - w) / 2; b.y += (b.h - h) / 2; b.w = w; b.h = h;
}
function onUp() {
  const d = st.drag;
  st.drag = null;
  if (!d) return;
  if (d.mode === "new") {
    const b = st.boxes[d.i];
    if (b.w < 0.01 || b.h < 0.01) { st.boxes.splice(d.i, 1); st.sel = -1; render(); return; }
    render();
    ui.querySelector(`.row[data-i="${d.i}"] textarea[data-k="desc"]`)?.focus();
    return;
  }
  render();
}
function remove(i) {
  st.boxes.splice(i, 1);
  st.sel = Math.min(st.sel, st.boxes.length - 1);
  render();
}
function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= st.boxes.length) return;
  [st.boxes[i], st.boxes[j]] = [st.boxes[j], st.boxes[i]];
  st.sel = j;
  render();
}

function label(b) {
  if (b.type === "text") return b.text ? `"${b.text}"` : "文字";
  return b.desc || "(説明なし)";
}
function shapeSvg(b, c) {
  const tag = b.shape === "circle" ? '<ellipse cx="50" cy="50" rx="50" ry="50"'
    : `<polygon points="${(POLY[b.shape] || []).map(([px, py]) => `${(b.fx ? 1 - px : px) * 100},${(b.fy ? 1 - py : py) * 100}`).join(" ")}"`;
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none">${tag} fill="${c}33" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderBoxes() {
  const stage = ui.querySelector(".stage");
  for (const el of stage.querySelectorAll(".bx")) el.remove();
  st.boxes.forEach((b, i) => {
    const c = colorOf(b, i);
    const shaped = isRegion() && b.shape && b.shape !== "rect";
    const rot = isRegion() ? Number(b.rot) || 0 : 0;
    const el = document.createElement("div");
    el.className = `bx${i === st.sel ? " on" : ""}${shaped ? " shaped" : ""}`;
    el.dataset.i = i;
    el.style.cssText = `--c:${c};left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%;border-color:${c};background:${c}22${rot ? `;transform:rotate(${rot}deg)` : ""}`;
    el.innerHTML = (shaped ? shapeSvg(b, c) : "") + `<span class="lb" style="background:${c}">${i + 1}: ${esc(label(b))}</span>`
      + ["nw", "ne", "sw", "se"].map((k) => `<span class="h" data-c="${k}"></span>`).join("");
    stage.appendChild(el);
  });
}
function renderList() {
  const list = ui.querySelector(".list");
  if (!st.boxes.length) {
    list.innerHTML = '<div class="empty">左の画像の上をドラッグして枠を作ってください。</div>';
    return;
  }
  const region = isRegion();
  list.innerHTML = st.boxes.map((b, i) => {
    const kind = b.type === "text" ? "text" : b.character ? "character" : "obj";
    return `<div class="row${i === st.sel ? " on" : ""}" data-i="${i}">
      <div class="top"><span class="no" data-no-theme style="--c:${colorOf(b, i)};background:${colorOf(b, i)}">${i + 1}</span>
        <select data-k="kind"><option value="obj">物</option><option value="character">人物</option><option value="text">文字</option></select>
        <span class="sp"></span>
        ${ctx.kind === "flux3" ? `<button data-a="cite" title="プロンプトの最後に &lt;obj_${i + 1}&gt; を入れる">&lt;obj_${i + 1}&gt; を入れる</button>` : ""}
        <button data-a="up" title="奥へ(番号を小さく)">↑</button><button data-a="down" title="手前へ(番号を大きく)">↓</button><button data-a="del" title="この枠を消す">✕</button></div>
      ${region ? `<div class="shp">${SHAPES.map(([k, t]) => `<label><input type="radio" name="shp-${i}" value="${k}"${(b.shape || "rect") === k ? " checked" : ""}> ${t}</label>`).join("")}</div>` : ""}
      ${region ? `<div class="shp rotrow"><span>回転(度)</span><input type="range" data-k="rot" min="-180" max="180" step="1" value="${Number(b.rot) || 0}"><input type="number" data-k="rot" min="-180" max="180" step="1" value="${Number(b.rot) || 0}" style="width:5em;flex:none"></div>` : ""}
      <textarea data-k="desc" rows="3" placeholder="何を置くか(英語) 例: a red sports car">${esc(b.desc)}</textarea>
      ${kind === "text" ? `<input data-k="text" placeholder="書く文字 例: SUMMER SALE" value="${esc(b.text)}">` : ""}
    </div>`;
  }).join("");
  for (const row of list.querySelectorAll(".row")) {
    const i = Number(row.dataset.i);
    const b = st.boxes[i];
    row.querySelector('[data-k="kind"]').value = b.type === "text" ? "text" : b.character ? "character" : "obj";
    row.onpointerdown = () => { if (st.sel !== i) { st.sel = i; renderBoxes(); for (const r of list.querySelectorAll(".row")) r.classList.toggle("on", r === row); } };
    row.querySelector('[data-k="kind"]').onchange = (e) => {
      const v = e.target.value;
      b.type = v === "text" ? "text" : "obj";
      b.character = v === "character";
      render();
    };
    for (const inp of row.querySelectorAll("textarea,input[data-k]")) inp.oninput = () => {
      b[inp.dataset.k] = inp.value;
      if (inp.dataset.k === "rot") { for (const o of row.querySelectorAll('input[data-k="rot"]')) if (o !== inp) o.value = inp.value; } // バーと数値をそろえる
      renderBoxes();
    };
    for (const rd of row.querySelectorAll('.shp input[type="radio"]')) rd.onchange = () => { b.shape = rd.value; fitShape(b); render(); };
    row.querySelector('[data-a="up"]').onclick = () => move(i, -1);
    row.querySelector('[data-a="down"]').onclick = () => move(i, 1);
    row.querySelector('[data-a="del"]').onclick = () => remove(i);
    const cite = row.querySelector('[data-a="cite"]');
    if (cite) cite.onclick = () => ctx?.onCite?.(i + 1, cite);
  }
}
function render() { renderBoxes(); renderList(); }

function close() {
  ui?.classList.remove("open");
  ctx = null;
}

// opts: { kind: "flux3" | "moss" | "region", regional: 範囲別指定を使う にチェックがあるか, background: 画像の URL か null, width, height, boxes: [...], onSave(boxes), onCite(n, anchor) }
export function openLayoutEditor(opts) {
  if (!ui) build();
  ctx = opts;
  st.boxes = (opts.boxes || []).map((b, i) => ({ ...NEWBOX, ci: i, ...b }));
  st.sel = -1;
  st.aspect = Math.max(0.1, (opts.width || 1024) / (opts.height || 1024));
  ui.querySelector(".help").textContent = (isRegion() ? HELP.region : HELP[opts.kind]) || HELP.flux3;
  const stage = ui.querySelector(".stage");
  stage.querySelector("img")?.remove();
  if (opts.background) {
    const img = document.createElement("img");
    img.onload = () => { st.aspect = img.naturalWidth / img.naturalHeight; fit(); };
    img.src = opts.background;
    stage.prepend(img);
  }
  ui.classList.add("open");
  ui.tabIndex = -1;
  ui.focus();
  fit();
  render();
}

// パネルの表示用: 枠の一覧の短い説明
export function layoutSummary(boxes) {
  const list = (boxes || []).filter((b) => b.w > 0 && b.h > 0);
  if (!list.length) return "";
  return `枠 ${list.length} 個: ` + list.slice(0, 4).map((b, i) => `${i + 1} ${label(b)}`).join(" / ") + (list.length > 4 ? " …" : "");
}
export function parseLayout(value) {
  try {
    const d = JSON.parse(value || "{}");
    return Array.isArray(d) ? d : Array.isArray(d.boxes) ? d.boxes : [];
  } catch { return []; }
}
