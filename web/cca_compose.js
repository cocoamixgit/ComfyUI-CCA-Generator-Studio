// CCA Generator: 画像の合成(重ねる画像を切り抜いて、元の画像に配置する)
// - 切り抜き: 四角で切り抜く / 消しゴム / 色で消す / 背景を自動で消す(ComfyUI 本体の BiRefNet。モデルが必要)
// - 配置: ドラッグで移動・ホイールで拡大縮小・回転・左右反転・不透明度
// - 仕上げ: 画像1として使う(input フォルダに保存して入力画像1にする)/ ダウンロード(ブラウザ)
// 生成パネル(cca_ui.js)から openComposer() で開く。このファイル単体では何も登録しない。

import { T } from "./cca_i18n.js";
import { api } from "../../scripts/api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MAX_UNDO = 20;

let ui = null;     // 画面
let ctx = null;    // 開いたときに渡された関数・値
const fillColor = () => (st.fill.mode === "black" ? "#000000" : st.fill.mode === "color" ? st.fill.color : "#ffffff");
const st = {
  base: null,      // 元の画像(HTMLImageElement)
  layer: null,     // 重ねる画像(切り抜き後。canvas)
  undo: [],
  t: { x: 0, y: 0, s: 1, r: 0, flip: false, a: 1 }, // 重ねる画像の中心(元の画像の画素)・倍率・回転(度)・反転・不透明度
  fill: { mode: "white", color: "#ffffff" }, // 背景を塗りつぶす色(白・黒・色を選ぶ)
  tool: "move",
  brush: 30,
  tol: 32,
  view: { k: 1, ox: 0, oy: 0 },
  drag: null,
};

function css() {
  if (document.getElementById("cca-comp-style")) return;
  const s = document.createElement("style");
  s.id = "cca-comp-style";
  s.textContent = `
#cca-comp{position:fixed;inset:0;z-index:1001;background:#000c;display:none;align-items:center;justify-content:center;
  font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:var(--text,#e4e7eb)}
#cca-comp.open{display:flex}
#cca-comp .box{background:var(--bg,#1a1e25);border:1px solid var(--border,#303744);border-radius:10px;width:calc(100vw - 32px);height:calc(100vh - 32px);display:flex;flex-direction:column}
#cca-comp .hd{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #303744}
#cca-comp .hd b{font-size:16px}
#cca-comp .main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 340px}
#cca-comp .stage{position:relative;min-width:0;min-height:0;background:repeating-conic-gradient(#20242b 0% 25%,#181b21 0% 50%) 50%/24px 24px}
#cca-comp canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
#cca-comp .side{border-left:1px solid var(--border,#303744);overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
#cca-comp section{border:1px solid var(--border,#303744);border-radius:8px;padding:8px 10px;background:var(--card,#161a20)}
#cca-comp h4{margin:0 0 6px;font-size:14px;color:var(--text,#cfd5dc)}
#cca-comp .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
#cca-comp button{background:var(--card2,#20252e);color:var(--text,#e4e7eb);border:1px solid var(--border,#3a4250);border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;font-size:13px}
#cca-comp button:hover{border-color:var(--accent,#3db4a6)}
#cca-comp button.on{background:var(--accent,#2b8f84);border-color:var(--accent,#3db4a6);color:var(--accent-fg,#fff)}
#cca-comp button.pri{background:var(--accent,#2b8f84);border-color:var(--accent,#3db4a6);color:var(--accent-fg,#fff);font-weight:700}
#cca-comp button:disabled{opacity:.5;cursor:default}
#cca-comp select{background:var(--sel-bg,var(--card,#0e1115));color:var(--sel-fg,var(--text,#e4e7eb));border:1px solid var(--sel-border,var(--border,#3a4250));border-radius:6px;padding:5px 8px;font:inherit;font-size:13px;max-width:100%;flex:1;min-width:0}
#cca-comp label.rg{display:grid;grid-template-columns:7.5em minmax(0,1fr) 3.5em;gap:6px;align-items:center;font-size:13px;color:var(--muted,#c9d1da);margin-top:4px}
#cca-comp input[type=range]{width:100%;accent-color:var(--accent,#3db4a6)}
#cca-comp .note{font-size:13px;color:var(--muted,#9fb0c2);margin-top:4px}
#cca-comp .guide{font-size:13px;background:#231d12;border:1px solid #6b5422;border-radius:6px;padding:6px 8px;margin-top:6px;color:#e8d9b5}
#cca-comp .guide a{color:#7fd6cb}
#cca-comp .busy{position:absolute;left:12px;top:12px;background:#000c;padding:6px 10px;border-radius:6px;display:none}
#cca-comp .busy.on{display:block}
`;
  document.head.appendChild(s);
}

function build() {
  css();
  ui = document.createElement("div");
  ui.id = "cca-comp";
  ui.innerHTML = `<div class="box">
    <div class="hd"><b>画像の合成</b><span style="color:#9fb0c2;font-size:13px">重ねる画像を切り抜いて、元の画像の上に置き、背景を塗りつぶします</span>
      <span style="flex:1"></span><button data-c="close">閉じる</button></div>
    <div class="main">
      <div class="stage"><canvas></canvas><div class="busy"></div></div>
      <div class="side">
        <section class="card"><h4>0. 背景を塗りつぶす</h4>
          <div class="row"><select data-c="fill"><option value="white">白</option><option value="black">黒</option><option value="color">色を選ぶ</option></select>
            <input type="color" data-c="fillcolor" value="#ffffff" style="display:none;width:44px;height:30px;padding:0"></div>
          <div class="note">透明な所を、この色で塗りつぶします。</div></section>
        <section class="card"><h4>1. 元の画像(土台)</h4>
          <div class="row"><select data-c="base"></select><button data-c="up-base">挿入</button></div></section>
        <section class="card"><h4>2. 重ねる画像</h4>
          <div class="row"><select data-c="layer"></select><button data-c="up-layer">挿入</button></div></section>
        <section class="card"><h4>3. 切り抜く(重ねる画像)</h4>
          <div class="row">
            <button data-tool="move" class="on">移動</button><button data-tool="crop">四角で切り抜く</button>
            <button data-tool="erase">消しゴム</button><button data-tool="wand">色で消す</button>
          </div>
          <label class="rg">消しゴムの太さ<input type="range" data-c="brush" min="4" max="200" value="30"><span data-v="brush">30</span></label>
          <label class="rg">似た色の幅<input type="range" data-c="tol" min="4" max="120" value="32"><span data-v="tol">32</span></label>
          <div class="row" style="margin-top:6px"><button data-c="bg">背景を自動で消す</button><button data-c="undo">元に戻す</button><button data-c="reset">切り抜きをやり直す</button></div>
          <div class="note" data-c="toolnote">ドラッグで移動、ホイールで拡大・縮小します。</div>
          <div class="guide" data-c="bgguide" style="display:none"></div></section>
        <section class="card"><h4>4. 配置</h4>
          <label class="rg">大きさ<input type="range" data-c="scale" min="1" max="400" value="100"><span data-v="scale">100%</span></label>
          <label class="rg">回転<input type="range" data-c="rot" min="-180" max="180" value="0"><span data-v="rot">0°</span></label>
          <label class="rg">不透明度<input type="range" data-c="alpha" min="5" max="100" value="100"><span data-v="alpha">100%</span></label>
          <div class="row" style="margin-top:6px"><button data-c="flip">左右反転</button><button data-c="center">真ん中に置く</button></div></section>
        <section class="card"><h4>5. 仕上げ</h4>
          <div class="row"><button class="pri" data-c="use">画像1として使う</button><button data-c="download">ダウンロード</button></div>
          <div class="row" style="margin-top:6px"><button data-c="caption">📝 この画像からプロンプトを作る</button></div>
          <div class="note">「画像1として使う」は合成した画像を ComfyUI の input フォルダに保存して、入力画像1にします。
            そのあと「合成を馴染ませる」のプリセットなどで画像→画像を行うと、光や影がなじみます。</div></section>
      </div>
    </div></div>`;
  document.body.appendChild(ui);
  ui.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  bind();
}

const $ = (sel) => ui.querySelector(sel);
function busy(text) {
  const b = $(".busy");
  b.textContent = text || "";
  b.classList.toggle("on", !!text);
}

// ---------------------------------------------------------------- 画像の読み込み
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("画像を読み込めませんでした"));
    im.src = src;
  });
}
function toCanvas(im) {
  const c = document.createElement("canvas");
  c.width = im.naturalWidth || im.width;
  c.height = im.naturalHeight || im.height;
  c.getContext("2d").drawImage(im, 0, 0);
  return c;
}
async function setBase(value) {
  if (!value) { st.base = null; draw(); return; }
  st.base = await loadImg(ctx.imageUrl(value));
  if (st.layer) fitLayer();
  draw();
}
async function setLayer(value) {
  if (!value) { st.layer = null; st.undo = []; draw(); return; }
  st.layer = toCanvas(await loadImg(ctx.imageUrl(value)));
  st.layerSource = value;
  st.undo = [];
  fitLayer();
  draw();
}
function fitLayer() {
  if (!st.layer) return;
  const bw = st.base?.naturalWidth || st.layer.width, bh = st.base?.naturalHeight || st.layer.height;
  // 元の画像の半分くらいの大きさで真ん中に置く
  const s = Math.min(1, (0.5 * Math.min(bw, bh)) / Math.max(st.layer.width, st.layer.height));
  st.t = { x: bw / 2, y: bh / 2, s, r: 0, flip: false, a: st.t.a ?? 1 };
  syncSliders();
}
function syncSliders() {
  const set = (k, v, text) => { $(`[data-c="${k}"]`).value = v; $(`[data-v="${k}"]`).textContent = text; };
  set("scale", Math.round(st.t.s * 100), `${Math.round(st.t.s * 100)}%`);
  set("rot", Math.round(st.t.r), `${Math.round(st.t.r)}°`);
  set("alpha", Math.round(st.t.a * 100), `${Math.round(st.t.a * 100)}%`);
}

// ---------------------------------------------------------------- 描画
function draw() {
  if (!ui) return;
  const cv = $("canvas");
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  const bw = st.base?.naturalWidth || st.layer?.width || 1, bh = st.base?.naturalHeight || st.layer?.height || 1;
  const k = Math.min((r.width - 24) / bw, (r.height - 24) / bh);
  st.view = { k, ox: (r.width - bw * k) / 2, oy: (r.height - bh * k) / 2 };
  g.fillStyle = fillColor();
  g.fillRect(st.view.ox, st.view.oy, bw * k, bh * k);
  if (st.base) g.drawImage(st.base, st.view.ox, st.view.oy, bw * k, bh * k);
  if (st.layer) {
    g.save();
    applyLayerTransform(g, k, st.view.ox, st.view.oy);
    g.globalAlpha = st.t.a;
    g.drawImage(st.layer, -st.layer.width / 2, -st.layer.height / 2);
    g.globalAlpha = 1;
    g.lineWidth = 1.5 / (st.t.s * k);
    g.setLineDash([6 / (st.t.s * k), 4 / (st.t.s * k)]);
    g.strokeStyle = "#3db4a6";
    g.strokeRect(-st.layer.width / 2, -st.layer.height / 2, st.layer.width, st.layer.height);
    g.restore();
  }
  if (st.drag?.mode === "crop" && st.drag.cur) {
    const a = st.drag.start, b = st.drag.cur;
    g.save();
    g.strokeStyle = "#ffcc33";
    g.setLineDash([5, 4]);
    g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    g.restore();
  }
  if (!st.base && !st.layer) {
    g.fillStyle = "#9fb0c2";
    g.font = "15px sans-serif";
    g.textAlign = "center";
    g.fillText(T("右の 1・2 で画像を選んでください"), r.width / 2, r.height / 2);
  }
}
function applyLayerTransform(g, k, ox, oy) {
  g.translate(ox + st.t.x * k, oy + st.t.y * k);
  g.rotate((st.t.r * Math.PI) / 180);
  g.scale(st.t.s * k * (st.t.flip ? -1 : 1), st.t.s * k);
}
// 画面の点 → 元の画像の画素 → 重ねる画像の画素
function toBase(sx, sy) { return { x: (sx - st.view.ox) / st.view.k, y: (sy - st.view.oy) / st.view.k }; }
function toLayer(sx, sy) {
  const b = toBase(sx, sy);
  const dx = b.x - st.t.x, dy = b.y - st.t.y;
  const a = (-st.t.r * Math.PI) / 180;
  let ux = (dx * Math.cos(a) - dy * Math.sin(a)) / st.t.s;
  const uy = (dx * Math.sin(a) + dy * Math.cos(a)) / st.t.s;
  if (st.t.flip) ux = -ux;
  return { x: ux + st.layer.width / 2, y: uy + st.layer.height / 2 };
}

// ---------------------------------------------------------------- 切り抜き
function pushUndo() {
  if (!st.layer) return;
  const c = document.createElement("canvas");
  c.width = st.layer.width; c.height = st.layer.height;
  c.getContext("2d").drawImage(st.layer, 0, 0);
  st.undo.push({ c, t: { ...st.t } });
  if (st.undo.length > MAX_UNDO) st.undo.shift();
}
function cropTo(x0, y0, x1, y1) {
  const L = st.layer;
  const ax = Math.max(0, Math.floor(Math.min(x0, x1))), ay = Math.max(0, Math.floor(Math.min(y0, y1)));
  const bx = Math.min(L.width, Math.ceil(Math.max(x0, x1))), by = Math.min(L.height, Math.ceil(Math.max(y0, y1)));
  if (bx - ax < 4 || by - ay < 4) return;
  pushUndo();
  const c = document.createElement("canvas");
  c.width = bx - ax; c.height = by - ay;
  c.getContext("2d").drawImage(L, ax, ay, c.width, c.height, 0, 0, c.width, c.height);
  // 切り抜いた所が同じ場所に残るよう、中心をずらす
  let lx = (ax + bx) / 2 - L.width / 2;
  const ly = (ay + by) / 2 - L.height / 2;
  if (st.t.flip) lx = -lx;
  const a = (st.t.r * Math.PI) / 180;
  st.t.x += (lx * Math.cos(a) - ly * Math.sin(a)) * st.t.s;
  st.t.y += (lx * Math.sin(a) + ly * Math.cos(a)) * st.t.s;
  st.layer = c;
}
function eraseAt(sx, sy) {
  const p = toLayer(sx, sy);
  const g = st.layer.getContext("2d");
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.arc(p.x, p.y, st.brush / 2 / (st.view.k * st.t.s), 0, Math.PI * 2);
  g.fill();
  g.restore();
}
// クリックした所と似た色で、つながっている所を透明にする
function wandAt(sx, sy) {
  const p = toLayer(sx, sy);
  const L = st.layer, w = L.width, h = L.height;
  const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
  pushUndo();
  const g = L.getContext("2d");
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const i0 = (y0 * w + x0) * 4;
  const [r0, g0, b0] = [d[i0], d[i0 + 1], d[i0 + 2]];
  const tol2 = st.tol * st.tol * 3;
  const seen = new Uint8Array(w * h);
  const stack = [y0 * w + x0];
  while (stack.length) {
    const q = stack.pop();
    if (seen[q]) continue;
    seen[q] = 1;
    const i = q * 4;
    if (d[i + 3] === 0) continue;
    const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
    if (dr * dr + dg * dg + db * db > tol2) continue;
    d[i + 3] = 0;
    const x = q % w, y = (q - x) / w;
    if (x > 0) stack.push(q - 1);
    if (x < w - 1) stack.push(q + 1);
    if (y > 0) stack.push(q - w);
    if (y < h - 1) stack.push(q + w);
  }
  g.putImageData(img, 0, 0);
  return true;
}

// ---------------------------------------------------------------- 書き出し
function flatten() {
  const bw = st.base?.naturalWidth || st.layer?.width, bh = st.base?.naturalHeight || st.layer?.height;
  if (!bw || !bh) throw new Error("元の画像を選んでください");
  const c = document.createElement("canvas");
  c.width = bw; c.height = bh;
  const g = c.getContext("2d");
  g.fillStyle = fillColor();
  g.fillRect(0, 0, bw, bh);
  if (st.base) g.drawImage(st.base, 0, 0);
  if (st.layer) {
    g.save();
    applyLayerTransform(g, 1, 0, 0);
    g.globalAlpha = st.t.a;
    g.drawImage(st.layer, -st.layer.width / 2, -st.layer.height / 2);
    g.restore();
  }
  return c;
}
const toBlob = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("画像を作れませんでした"))), "image/png"));
const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
async function uploadCanvas(c, prefix) {
  const blob = await toBlob(c);
  return ctx.upload(new File([blob], `${prefix}_${stamp()}.png`, { type: "image/png" }), "cca_comp");
}

// 背景を消すときに渡す画像は temp/cca_edit に置き、終わったら結果の画像(temp)と一緒に消す
async function uploadWork(c) {
  const body = new FormData();
  body.append("image", await toBlob(c), `cutout_src_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`);
  body.append("type", "temp");
  body.append("subfolder", "cca_edit");
  body.append("overwrite", "true");
  const r = await api.fetchApi("/upload/image", { method: "POST", body });
  if (!r.ok) throw new Error(`upload ${r.status}`);
  const j = await r.json();
  return { value: `${j.subfolder ? `${j.subfolder}/` : ""}${j.name} [temp]`, file: { filename: j.name, subfolder: j.subfolder || "", type: "temp" } };
}
function tempCleanup(files) {
  if (files.length) api.fetchApi("/cca_generator/temp_cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) }).catch(() => {});
}

// ---------------------------------------------------------------- 背景を自動で消す(ComfyUI 本体の RemoveBackground)
function bgGuide(show) {
  const el = $('[data-c="bgguide"]');
  el.style.display = show ? "" : "none";
  if (show) {
    el.innerHTML = `背景を自動で消すには、BiRefNet のモデル <b>birefnet.safetensors</b>(約 440MB)が必要です。
      <a href="https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal" target="_blank" rel="noopener noreferrer">Comfy-Org/BiRefNet</a>
      からダウンロードして、モデルフォルダの「背景を消すモデル」(models/background_removal)に入れ、パネルの 🔄 を押してください。
      <div class="row" style="margin-top:6px"><button data-c="bgfolder">📂 入れるフォルダを開く</button></div>`;
    el.querySelector('[data-c="bgfolder"]').onclick = (e) => ctx.openFolder("background_removal", e.target);
  }
}
async function removeBg(btn) {
  if (!st.layer) { ctx.notify("重ねる画像を選んでください", "error", btn); return; }
  const models = ctx.bgModels();
  if (!models.length) { bgGuide(true); return; }
  bgGuide(false);
  btn.disabled = true;
  busy("背景を消しています…(初回はモデルの読み込みに時間がかかります)");
  const work = [];
  try {
    const up = await uploadWork(st.layer);
    work.push(up.file);
    const value = up.value;
    const model = models.find((m) => /birefnet/i.test(m)) || models[0];
    const out = await ctx.runMini({
      1: { class_type: "LoadImage", inputs: { image: value } },
      2: { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: model } },
      3: { class_type: "RemoveBackground", inputs: { bg_removal_model: ["2", 0], image: ["1", 0] } },
      4: { class_type: "InvertMask", inputs: { mask: ["3", 0] } },
      5: { class_type: "JoinImageWithAlpha", inputs: { image: ["1", 0], alpha: ["4", 0] } },
      6: { class_type: "PreviewImage", inputs: { images: ["5", 0] } },
    });
    const it = out?.outputs?.["6"]?.images?.[0];
    if (!it) throw new Error("結果の画像が返ってきませんでした");
    if ((it.type || "temp") === "temp") work.push(it);
    const q = new URLSearchParams({ filename: it.filename, subfolder: it.subfolder || "", type: it.type || "temp" });
    const im = await loadImg(ctx.viewUrl(q));
    pushUndo();
    const c = toCanvas(im);
    st.layer = c;
    draw();
    ctx.notify("背景を消しました", "info", btn, { toast: false });
  } catch (e) {
    ctx.notify(`背景を消せませんでした: ${e.message}`, "error", btn);
  } finally {
    tempCleanup(work);
    btn.disabled = false;
    busy("");
  }
}

// ---------------------------------------------------------------- 操作
function bind() {
  const cv = $("canvas");
  $('[data-c="close"]').onclick = () => close();
  ui.addEventListener("mousedown", (e) => { if (e.target === ui) close(); });
  for (const b of ui.querySelectorAll("[data-tool]")) {
    b.onclick = () => {
      st.tool = b.dataset.tool;
      for (const x of ui.querySelectorAll("[data-tool]")) x.classList.toggle("on", x === b);
      $('[data-c="toolnote"]').textContent = {
        move: "ドラッグで移動、ホイールで拡大・縮小します。",
        crop: "重ねる画像の上で、残したい所を四角く囲んでください。",
        erase: "重ねる画像の上をなぞると、その部分が消えます。",
        wand: "消したい色の所をクリックすると、似た色でつながっている所が消えます(白い背景などに)。",
      }[st.tool];
      cv.style.cursor = st.tool === "move" ? "move" : "crosshair";
    };
  }
  const slider = (k, fn, fmt) => {
    const el = $(`[data-c="${k}"]`);
    el.oninput = () => { fn(Number(el.value)); $(`[data-v="${k}"]`).textContent = fmt(Number(el.value)); draw(); };
  };
  const fsel = $('[data-c="fill"]'), fcol = $('[data-c="fillcolor"]');
  fsel.onchange = () => { st.fill.mode = fsel.value; fcol.style.display = fsel.value === "color" ? "" : "none"; draw(); };
  fcol.oninput = () => { st.fill.color = fcol.value; draw(); };
  slider("brush", (v) => { st.brush = v; }, (v) => `${v}`);
  slider("tol", (v) => { st.tol = v; }, (v) => `${v}`);
  slider("scale", (v) => { st.t.s = v / 100; }, (v) => `${v}%`);
  slider("rot", (v) => { st.t.r = v; }, (v) => `${v}°`);
  slider("alpha", (v) => { st.t.a = v / 100; }, (v) => `${v}%`);
  $('[data-c="flip"]').onclick = () => { st.t.flip = !st.t.flip; draw(); };
  $('[data-c="center"]').onclick = () => {
    const bw = st.base?.naturalWidth || st.layer?.width || 0, bh = st.base?.naturalHeight || st.layer?.height || 0;
    st.t.x = bw / 2; st.t.y = bh / 2; draw();
  };
  $('[data-c="undo"]').onclick = () => {
    const u = st.undo.pop();
    if (!u) return;
    st.layer = u.c; st.t = u.t; syncSliders(); draw();
  };
  $('[data-c="reset"]').onclick = async () => { if (st.layerSource) await setLayer(st.layerSource); };
  $('[data-c="bg"]').onclick = (e) => removeBg(e.target);
  $('[data-c="base"]').onchange = (e) => setBase(e.target.value).catch((err) => ctx.notify(err.message, "error", e.target));
  $('[data-c="layer"]').onchange = (e) => setLayer(e.target.value).catch((err) => ctx.notify(err.message, "error", e.target));
  for (const [k, fn] of [["up-base", setBase], ["up-layer", setLayer]]) {
    $(`[data-c="${k}"]`).onclick = (e) => pickFile(async (f) => {
      try {
        const v = await ctx.upload(f, "");
        fillSelects(k === "up-base" ? v : undefined, k === "up-layer" ? v : undefined);
        await fn(v);
      } catch (err) { ctx.notify(err.message, "error", e.target); }
    });
  }
  $('[data-c="use"]').onclick = async (e) => {
    try {
      const v = await uploadCanvas(flatten(), "composite");
      await ctx.onUse(v);
      ctx.notify("合成した画像を入力画像1にしました", "info");
      close();
    } catch (err) { ctx.notify(`保存できませんでした: ${err.message}`, "error", e.target); }
  };
  $('[data-c="download"]').onclick = async (e) => {
    try {
      const blob = await toBlob(flatten());
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `composite_${stamp()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { ctx.notify(`ダウンロードできませんでした: ${err.message}`, "error", e.target); }
  };
  $('[data-c="caption"]').onclick = async (e) => {
    try {
      busy("画像を保存しています…");
      const v = await uploadCanvas(flatten(), "composite");
      busy("");
      await ctx.caption(v, e.target);
    } catch (err) { busy(""); ctx.notify(err.message, "error", e.target); }
  };

  // キャンバスの操作
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener("pointerdown", (e) => {
    if (!st.layer) return;
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (st.tool === "move") st.drag = { mode: "move", last: toBase(p.x, p.y) };
    else if (st.tool === "crop") st.drag = { mode: "crop", start: p, cur: p };
    else if (st.tool === "erase") { pushUndo(); st.drag = { mode: "erase" }; eraseAt(p.x, p.y); draw(); }
    else if (st.tool === "wand") { if (wandAt(p.x, p.y)) draw(); }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!st.drag) return;
    const p = pos(e);
    if (st.drag.mode === "move") {
      const b = toBase(p.x, p.y);
      st.t.x += b.x - st.drag.last.x; st.t.y += b.y - st.drag.last.y;
      st.drag.last = b;
    } else if (st.drag.mode === "crop") st.drag.cur = p;
    else if (st.drag.mode === "erase") eraseAt(p.x, p.y);
    draw();
  });
  const end = () => {
    if (st.drag?.mode === "crop" && st.drag.cur) {
      const a = st.drag.start, b = st.drag.cur;
      const pts = [toLayer(a.x, a.y), toLayer(b.x, a.y), toLayer(a.x, b.y), toLayer(b.x, b.y)];
      cropTo(Math.min(...pts.map((q) => q.x)), Math.min(...pts.map((q) => q.y)), Math.max(...pts.map((q) => q.x)), Math.max(...pts.map((q) => q.y)));
    }
    st.drag = null;
    draw();
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("wheel", (e) => {
    if (!st.layer) return;
    e.preventDefault();
    st.t.s = Math.max(0.02, Math.min(8, st.t.s * Math.pow(1.1, -e.deltaY / 100)));
    syncSliders();
    draw();
  }, { passive: false });
  window.addEventListener("resize", () => { if (ui?.classList.contains("open")) draw(); });
}
function pickFile(cb) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => { const f = input.files?.[0]; if (f) cb(f); };
  input.click();
}
function fillSelects(baseValue, layerValue) {
  const list = ctx.images();
  const opts = (cur) => `<option value="">選ぶ…</option>` + list.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  const b = $('[data-c="base"]'), l = $('[data-c="layer"]');
  const bv = baseValue ?? b.value, lv = layerValue ?? l.value;
  if (bv && !list.includes(bv)) list.unshift(bv);
  if (lv && !list.includes(lv)) list.unshift(lv);
  b.innerHTML = opts(bv);
  l.innerHTML = opts(lv);
}
function close() { ui?.classList.remove("open"); }

// opts: { base, layer, images(), imageUrl(v), viewUrl(params), upload(file, subfolder), onUse(value), notify(msg, kind, anchor, opt),
//         runMini(prompt), bgModels(), openFolder(kind, anchor), caption(value, anchor) }
export async function openComposer(opts) {
  ctx = opts;
  if (!ui) build();
  ui.classList.add("open");
  st.undo = [];
  bgGuide(false);
  fillSelects(opts.base || "", opts.layer || "");
  try {
    await setBase(opts.base || null);
    await setLayer(opts.layer || null);
  } catch (e) { ctx.notify(e.message, "error"); }
  draw();
}
