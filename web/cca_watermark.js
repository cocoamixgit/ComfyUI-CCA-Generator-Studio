// CCA Generator: 透かし(画像編集・動画編集で共通)
// - 透かしの画像を登録する(user/default/cca_generator/watermarks に PNG で保存)・消す
// - 位置(左上・右上・真ん中・左下・右下)・大きさ(%)・大きさの基準(短い辺 / 幅 / 高さ)・余白(%)・不透明度(%)
// - 「透かし追加」で、呼び出し元に置く所(画素)を返す(onApply)。設定はこのブラウザに覚える
import { api } from "../../scripts/api.js";
import { T, confirm } from "./cca_i18n.js";

const LS = "cca_generator.watermark";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const POS = [["tl", "左上", "↖"], ["tr", "右上", "↗"], ["c", "真ん中", "●"], ["bl", "左下", "↙"], ["br", "右下", "↘"]];
export const WM_DEFAULT = { pos: "br", size: 20, basis: "short", margin: 3, opacity: 70, name: "" };

const numOr = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
// 置く所(画素)。W・H は画像(動画)の大きさ、nw・nh は透かしの画像の大きさ
export function watermarkRect(o, W, H, nw, nh) {
  const sz = clamp(numOr(o.size, 20), 1, 100) / 100;
  nw = Math.max(1, nw); nh = Math.max(1, nh);
  let w, h;
  if (o.basis === "w") { w = W * sz; h = (w * nh) / nw; }
  else if (o.basis === "h") { h = H * sz; w = (h * nw) / nh; }
  else {
    // 短い辺: 透かしの長い方の辺 = 短い辺 × 大きさ(縦長・横長どちらの画像でも同じくらいの大きさになる)
    const L = Math.min(W, H) * sz;
    if (nw >= nh) { w = L; h = (L * nh) / nw; } else { h = L; w = (L * nw) / nh; }
  }
  const m = (Math.min(W, H) * clamp(numOr(o.margin, 3), 0, 45)) / 100;
  const p = o.pos || "br";
  const x = p === "c" ? (W - w) / 2 : p.endsWith("l") ? m : W - m - w;
  const y = p === "c" ? (H - h) / 2 : p.startsWith("t") ? m : H - m - h;
  return { x, y, w, h, opacity: clamp(numOr(o.opacity, 70), 0, 100) / 100 };
}
export function loadSettings() {
  try { return { ...WM_DEFAULT, ...(JSON.parse(localStorage.getItem(LS) || "{}") || {}) }; } catch { return { ...WM_DEFAULT }; }
}
function saveSettings(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* 覚えられなくても使える */ } }
function viewUrl(it) {
  return api.apiURL(`/cca_generator/watermarks/file?${new URLSearchParams({ name: it.name })}`);
}
function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(T("画像を読み込めませんでした")));
    im.src = src;
  });
}

function css() {
  if (document.getElementById("cca-wm-css")) return;
  const s = document.createElement("style");
  s.id = "cca-wm-css";
  s.textContent = `
#cca-wm{position:fixed;inset:0;z-index:1004;background:#0009;display:none;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#e4e7eb}
#cca-wm.open{display:flex}
#cca-wm .wb{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(860px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column}
#cca-wm .wh{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid #303744}
#cca-wm .wh .sp{flex:1}
#cca-wm .wc{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:12px;padding:12px;overflow:auto;min-height:0}
@media (max-width:760px){#cca-wm .wc{grid-template-columns:minmax(0,1fr)}}
#cca-wm button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;font-size:13px}
#cca-wm button:hover{border-color:#3db4a6}
#cca-wm button.on{background:#2b8f84;border-color:#3db4a6;color:#fff}
#cca-wm button.pri{background:#2b8f84;border-color:#3db4a6;color:#fff;font-weight:700}
#cca-wm button:disabled{opacity:.45;cursor:default}
#cca-wm .wl{display:flex;flex-direction:column;gap:8px;min-width:0}
#cca-wm .wl.drop{outline:2px dashed #3db4a6;outline-offset:4px}
#cca-wm .wlh{display:flex;gap:8px;align-items:center}
#cca-wm .wlh b{flex:1}
#cca-wm .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:46vh;overflow:auto;padding:2px}
#cca-wm .it{position:relative;border:2px solid #303744;border-radius:8px;padding:4px;cursor:pointer;background:#13161b}
#cca-wm .it.sel{border-color:#3db4a6;background:#15302c}
#cca-wm .it .th{height:80px;border-radius:5px;background:repeating-conic-gradient(#3a3f48 0% 25%,#2a2e35 0% 50%) 0 0/14px 14px;display:flex;align-items:center;justify-content:center;overflow:hidden}
#cca-wm .it img{max-width:100%;max-height:80px;object-fit:contain}
#cca-wm .it .nm{font-size:11.5px;color:#c9d1da;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cca-wm .it .del{position:absolute;right:4px;top:4px;padding:0 6px;font-size:12px;background:#000a}
#cca-wm .note{font-size:12.5px;color:#9fb0c2}
#cca-wm .wr{display:flex;flex-direction:column;gap:8px}
#cca-wm canvas{width:100%;border-radius:6px;border:1px solid #303744;background:#000}
#cca-wm .pos{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,auto);gap:4px}
#cca-wm .pos button{padding:4px 2px}
#cca-wm label.fl{display:grid;grid-template-columns:7.5em minmax(0,1fr) 4.5em;gap:6px;align-items:center;font-size:13px;color:#c9d1da}
#cca-wm label.fl input[type=number]{width:100%;box-sizing:border-box;background:#0f1216;color:#e4e7eb;border:1px solid #3a4250;border-radius:5px;padding:3px 4px}
#cca-wm select{background:#0f1216;color:#e4e7eb;border:1px solid #3a4250;border-radius:5px;padding:3px 4px;font:inherit;font-size:13px}
#cca-wm .empty{padding:18px;text-align:center;color:#9fb0c2;border:1px dashed #3a4250;border-radius:8px}
`;
  document.head.appendChild(s);
}

let box = null;
let cur = null; // { opts, items, set, img, resolve }

const rng = (k, label, min, max, step) => `<label class="fl">${label}<input type="range" data-r="${k}" min="${min}" max="${max}" step="${step}"><input type="number" data-n="${k}" min="${min}" max="${max}" step="${step}"></label>`;
function build() {
  css();
  box = document.createElement("div");
  box.id = "cca-wm";
  box.innerHTML = `<div class="wb">
    <div class="wh"><b>💧 透かし</b><span class="sp"></span><button data-x>閉じる</button></div>
    <div class="wc">
      <div class="wl" data-wl>
        <div class="wlh"><b>登録した透かし</b><button data-up title="ロゴなどの画像を透かしとして登録します">＋ 画像を登録</button></div>
        <div class="grid" data-grid></div>
        <div class="note">透明な所のある PNG(ロゴ・サインなど)が向いています。ここへ画像をドラッグ&ドロップしても登録できます(ComfyUI の user/default/cca_generator/watermarks に入ります)。</div>
      </div>
      <div class="wr">
        <canvas data-pv width="360" height="200"></canvas>
        <div><div class="note" style="margin-bottom:4px">置く所</div><div class="pos">${POS.map(([k, l, a]) => `<button data-pos="${k}" style="grid-area:${{ tl: "1/1", tr: "1/3", c: "2/2", bl: "3/1", br: "3/3" }[k]}">${a} <span>${l}</span></button>`).join("")}</div></div>
        ${rng("size", "大きさ(%)", 1, 100, 1)}
        <label class="fl">大きさの基準<select data-k="basis" style="grid-column:2/4"><option value="short">短い辺に対して(おすすめ)</option><option value="w">幅に対して</option><option value="h">高さに対して</option></select></label>
        ${rng("margin", "端からの余白(%)", 0, 30, 0.5)}
        ${rng("opacity", "不透明度(%)", 0, 100, 1)}
        <div class="note" data-info></div>
        <button class="pri" data-apply>💧 透かし追加</button>
      </div>
    </div></div>`;
  document.body.appendChild(box);
  box.querySelector("[data-x]").onclick = () => done(null);
  box.addEventListener("pointerdown", (e) => { if (e.target === box) done(null); });
  box.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") done(null); });
  box.addEventListener("keyup", (e) => e.stopPropagation());
  box.querySelector("[data-up]").onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => addFiles([...(input.files || [])]);
    input.click();
  };
  const wl = box.querySelector("[data-wl]");
  wl.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); e.stopPropagation(); wl.classList.add("drop"); } });
  wl.addEventListener("dragleave", () => wl.classList.remove("drop"));
  wl.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation(); wl.classList.remove("drop");
    addFiles([...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type)));
  });
  box.addEventListener("dragover", (e) => e.preventDefault());
  box.addEventListener("drop", (e) => e.preventDefault());
  box.querySelector("[data-grid]").addEventListener("click", async (e) => {
    const it = e.target.closest(".it");
    if (!it) return;
    if (e.target.closest(".del")) { await removeItem(it.dataset.name); return; }
    await select(it.dataset.name);
  });
  for (const b of box.querySelectorAll("[data-pos]")) b.onclick = () => { cur.set.pos = b.dataset.pos; sync(); };
  for (const k of ["size", "margin", "opacity"]) {
    const r = box.querySelector(`[data-r="${k}"]`), n = box.querySelector(`[data-n="${k}"]`);
    r.oninput = () => { cur.set[k] = Number(r.value); n.value = r.value; draw(); };
    n.oninput = () => { if (n.value === "") return; cur.set[k] = clamp(Number(n.value), Number(n.min), Number(n.max)); r.value = cur.set[k]; draw(); };
  }
  box.querySelector('[data-k="basis"]').onchange = (e) => { cur.set.basis = e.target.value; draw(); };
  box.querySelector("[data-apply]").onclick = (e) => apply(e.currentTarget);
}
function notify(msg, kind = "info", el) { cur?.opts.notify?.(msg, kind, el); }
async function fetchList() {
  const r = await api.fetchApi("/cca_generator/watermarks", { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status}`);
  return j.items || [];
}
function renderList() {
  const g = box.querySelector("[data-grid]");
  if (!cur.items.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(T("まだ登録がありません。「＋ 画像を登録」で透かしにする画像(ロゴなど)を選んでください。"))}</div>`;
    return;
  }
  g.innerHTML = cur.items.map((it) => `<div class="it ${it.name === cur.set.name ? "sel" : ""}" data-name="${esc(it.name)}" title="${esc(it.name)}">
    <div class="th"><img alt="" src="${esc(viewUrl(it))}"></div><div class="nm">${esc(it.name)}</div><button class="del" title="${esc(T("この透かしを消す"))}">🗑</button></div>`).join("");
}
async function select(name) {
  cur.set.name = name;
  cur.img = null;
  renderList();
  sync();
  const it = cur.items.find((x) => x.name === name);
  if (!it) return;
  try { cur.img = await loadImg(viewUrl(it)); } catch (e) { notify(e.message, "error"); }
  if (cur.set.name === name) sync();
}
async function addFiles(files) {
  if (!files.length) return;
  let last = null;
  for (const f of files) {
    try {
      const fd = new FormData();
      fd.append("image", f, f.name);
      const r = await api.fetchApi("/cca_generator/watermarks", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `${r.status}`);
      cur.items = j.items || cur.items;
      last = j.item?.name || last;
    } catch (e) { notify(`${T("登録できませんでした")}: ${e.message}`, "error"); }
  }
  if (last) { await select(last); notify(T("透かしを登録しました: {0}", last)); }
}
async function removeItem(name) {
  if (!(await confirm(T("透かし「{0}」を消しますか?", name)))) return;
  try {
    const r = await api.fetchApi("/cca_generator/watermarks/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `${r.status}`);
    cur.items = j.items || [];
    if (cur.set.name === name) { cur.set.name = ""; cur.img = null; }
    if (!cur.set.name && cur.items[0]) await select(cur.items[0].name);
    renderList();
    sync();
  } catch (e) { notify(`${T("消せませんでした")}: ${e.message}`, "error"); }
}
function sync() {
  const s = cur.set;
  for (const b of box.querySelectorAll("[data-pos]")) b.classList.toggle("on", b.dataset.pos === s.pos);
  for (const k of ["size", "margin", "opacity"]) { box.querySelector(`[data-r="${k}"]`).value = s[k]; box.querySelector(`[data-n="${k}"]`).value = s[k]; }
  box.querySelector('[data-k="basis"]').value = s.basis;
  box.querySelector("[data-apply]").disabled = !cur.img;
  draw();
}
// 見本: 編集中の画像(または灰色)の上に透かしを置いて見せる
function draw() {
  const cv = box.querySelector("[data-pv]");
  const [W, H] = cur.opts.size;
  const k = Math.min(360 / W, 220 / H);
  cv.width = Math.max(2, Math.round(W * k));
  cv.height = Math.max(2, Math.round(H * k));
  const g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  let based = false;
  if (cur.opts.base) { try { g.drawImage(cur.opts.base, 0, 0, cv.width, cv.height); based = true; } catch { /* 見本なしで続ける */ } }
  if (!based) {
    for (let y = 0; y < cv.height; y += 10) for (let x = 0; x < cv.width; x += 10) { g.fillStyle = (x + y) / 10 % 2 ? "#3a3f48" : "#2a2e35"; g.fillRect(x, y, 10, 10); }
  }
  const info = box.querySelector("[data-info]");
  if (!cur.img) { info.textContent = T(cur.items.length ? "透かしの画像を選んでください" : "透かしの画像を登録してください"); return; }
  const r = watermarkRect(cur.set, W, H, cur.img.naturalWidth, cur.img.naturalHeight);
  g.globalAlpha = r.opacity;
  g.drawImage(cur.img, r.x * k, r.y * k, r.w * k, r.h * k);
  g.globalAlpha = 1;
  info.textContent = T("{0}×{1} の画像に {2}×{3} px で置きます", W, H, Math.round(r.w), Math.round(r.h));
}
async function apply(btn) {
  if (!cur.img) return;
  const it = cur.items.find((x) => x.name === cur.set.name);
  const [W, H] = cur.opts.size;
  const rect = watermarkRect(cur.set, W, H, cur.img.naturalWidth, cur.img.naturalHeight);
  saveSettings(cur.set);
  btn.disabled = true;
  try {
    await cur.opts.onApply({ item: it, img: cur.img, rect, settings: { ...cur.set }, natural: [cur.img.naturalWidth, cur.img.naturalHeight] });
    done(true);
  } catch (e) {
    notify(`${T("透かしを入れられませんでした")}: ${e.message}`, "error", btn);
  } finally { btn.disabled = !cur?.img; }
}
function done(v) {
  if (!cur) return;
  box.classList.remove("open");
  const r = cur.resolve;
  cur = null;
  r(v);
}
// opts: { size: [幅, 高さ], base(見本に描く画像・canvas・video。省略可), notify(msg, kind, el), onApply({ item, img, rect, settings }) }
export function openWatermark(opts) {
  if (!box) build();
  if (cur) done(null);
  return new Promise(async (resolve) => {
    cur = { opts, items: [], set: loadSettings(), img: null, resolve };
    box.classList.add("open");
    box.tabIndex = -1;
    box.focus();
    renderList();
    sync();
    try { cur.items = await fetchList(); } catch (e) { notify(`${T("透かしの一覧を読めませんでした")}: ${e.message}`, "error"); }
    if (!cur) return;
    const name = cur.items.some((x) => x.name === cur.set.name) ? cur.set.name : cur.items[0]?.name;
    renderList();
    if (name) await select(name); else sync();
  });
}
export const isWatermarkOpen = () => !!box?.classList.contains("open");
// 編集の画面のキー操作より先に呼ぶ(開いているときはここで受ける。Esc で透かしの画面だけ閉じる)
export function watermarkKey(e) {
  if (!isWatermarkOpen()) return false;
  e.stopPropagation();
  if (e.key === "Escape") { e.preventDefault(); done(null); }
  return true;
}
// テスト用
window.CCA_WM = { rect: watermarkRect, isOpen: isWatermarkOpen };
