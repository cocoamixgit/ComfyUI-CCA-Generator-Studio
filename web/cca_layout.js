// CCA Generator: 枠(バウンディングボックス)で配置を指定する画面
// - 画像の上(テキスト→画像は出力の大きさの白紙)をドラッグして枠を作る。枠をドラッグで移動、角で大きさを変える
// - 枠ごとに「何を置くか」(英語)と種類(物 / 文字。MOSS は人物も)を書く
// - 決定すると、パネルの layout_boxes(JSON)に入る。生成時にサーバーがプロンプトへ組み込む(layout.py)
// 生成パネル(cca_ui.js)から openLayoutEditor() で開く。このファイル単体では何も登録しない。

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#ff5d5d", "#4fc3f7", "#ffd54f", "#81c784", "#ba68c8", "#ff8a65", "#4db6ac", "#f06292", "#aed581", "#9575cd"];
const HELP = {
  flux3: "画像の上をドラッグして枠を作り、枠ごとに「何を置くか」を英語で書きます。プロンプトでは枠を <obj_1>、<obj_2> … と番号で指せます"
    + "(例: In <ref_image_0>, change the dress <obj_1> to red.)。先に作った枠が奥、後の枠が手前です。",
  moss: "ドラッグで枠を作り、枠ごとに置く物・人物・文字を英語で書きます。プロンプトには画像全体の説明を書きます。"
    + "先に作った枠が奥、後の枠が手前です。",
};

let ui = null;
let ctx = null;
const st = { boxes: [], sel: -1, drag: null, aspect: 1 };

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
#cca-layout .row .no{font-weight:700;color:#000;border-radius:4px;padding:0 8px}
#cca-layout .row select,#cca-layout .row input{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 8px;font:inherit;font-size:14px}
#cca-layout .row input{width:100%;box-sizing:border-box}
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
    st.boxes.push({ x, y, w: 0, h: 0, type: "obj", desc: "", text: "", character: false });
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
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    if (d.c.includes("w")) x0 = x; else x1 = x;
    if (d.c.includes("n")) y0 = y; else y1 = y;
    b.x = Math.min(x0, x1); b.y = Math.min(y0, y1); b.w = Math.abs(x1 - x0); b.h = Math.abs(y1 - y0);
  }
  renderBoxes();
}
function onUp() {
  const d = st.drag;
  st.drag = null;
  if (!d) return;
  if (d.mode === "new") {
    const b = st.boxes[d.i];
    if (b.w < 0.01 || b.h < 0.01) { st.boxes.splice(d.i, 1); st.sel = -1; render(); return; }
    render();
    ui.querySelector(`.row[data-i="${d.i}"] input[data-k="desc"]`)?.focus();
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
function renderBoxes() {
  const stage = ui.querySelector(".stage");
  for (const el of stage.querySelectorAll(".bx")) el.remove();
  st.boxes.forEach((b, i) => {
    const c = COLORS[i % COLORS.length];
    const el = document.createElement("div");
    el.className = `bx${i === st.sel ? " on" : ""}`;
    el.dataset.i = i;
    el.style.cssText = `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%;border-color:${c};background:${c}22`;
    el.innerHTML = `<span class="lb" style="background:${c}">${i + 1}: ${esc(label(b))}</span>`
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
  const moss = ctx.kind === "moss";
  list.innerHTML = st.boxes.map((b, i) => {
    const kind = b.type === "text" ? "text" : b.character ? "character" : "obj";
    return `<div class="row${i === st.sel ? " on" : ""}" data-i="${i}">
      <div class="top"><span class="no" style="background:${COLORS[i % COLORS.length]}">${i + 1}</span>
        <select data-k="kind"><option value="obj">物</option>${moss ? '<option value="character">人物</option>' : ""}<option value="text">文字</option></select>
        <span class="sp"></span>
        ${ctx.kind === "flux3" ? `<button data-a="cite" title="プロンプトの最後に &lt;obj_${i + 1}&gt; を入れる">&lt;obj_${i + 1}&gt; を入れる</button>` : ""}
        <button data-a="up" title="奥へ(番号を小さく)">↑</button><button data-a="down" title="手前へ(番号を大きく)">↓</button><button data-a="del" title="この枠を消す">✕</button></div>
      <input data-k="desc" placeholder="何を置くか(英語) 例: a red sports car" value="${esc(b.desc)}">
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
    for (const inp of row.querySelectorAll("input")) inp.oninput = () => { b[inp.dataset.k] = inp.value; renderBoxes(); };
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

// opts: { kind: "flux3" | "moss", background: 画像の URL か null, width, height, boxes: [...], onSave(boxes), onCite(n, anchor) }
export function openLayoutEditor(opts) {
  if (!ui) build();
  ctx = opts;
  st.boxes = (opts.boxes || []).map((b) => ({ x: 0, y: 0, w: 0, h: 0, type: "obj", desc: "", text: "", character: false, ...b }));
  st.sel = -1;
  st.aspect = Math.max(0.1, (opts.width || 1024) / (opts.height || 1024));
  ui.querySelector(".help").textContent = HELP[opts.kind] || HELP.flux3;
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
