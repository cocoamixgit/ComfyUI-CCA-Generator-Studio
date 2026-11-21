// CCA Generator: 一時保存(動画編集・画像編集で共通)
// - 「📌 一時保存」で、今の編集の中身をサーバー(user/default/cca_generator/edit_history)に残す
// - 自動保存: 編集画面を開いている間、1 つの項目を数分ごと・閉じたときに上書きする(新しい 10 件まで残る)
// - 「🕘 履歴」の一覧から開き直す・名前を付ける(付けると自動保存でも消えずに残る)・消す
import { api } from "../../scripts/api.js";
import { T, confirm, prompt } from "./cca_i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
export const HIST_EVERY = 120000; // 自動保存の間隔(変わったときだけ)

export function newSid() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(16).slice(2, 8)}`;
}
export function fmtTime(sec) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
async function ok(r) {
  let j = null;
  try { j = await r.json(); } catch { /* 下で */ }
  if (!r.ok || j?.ok === false) throw new Error(j?.error || `${r.status}`);
  return j;
}
const toBlob = (c, type, q) => new Promise((res) => { try { c.toBlob((b) => res(b), type, q); } catch { res(null); } });

// 一覧に出す小さな絵(JPEG)。draw(g, w, h) で描く。透明な所は市松模様
export async function makeThumb(srcW, srcH, draw, checker = false) {
  const k = Math.min(1, 240 / Math.max(1, srcW, srcH));
  const w = Math.max(1, Math.round(srcW * k)), h = Math.max(1, Math.round(srcH * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#2a2e35";
  g.fillRect(0, 0, w, h);
  if (checker) {
    g.fillStyle = "#3a3f48";
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 8 : 0; x < w; x += 16) g.fillRect(x, y, 8, 8);
  }
  try { draw(g, w, h); } catch { /* 描けなくても保存はする */ }
  try { return await toBlob(c, "image/jpeg", 0.8); } catch { return null; }
}

// 保存する。opts: { data, name, auto, id, title, info, thumb(Blob), img(Blob), orig(Blob), files({名前: Blob}) } → 保存した項目
export async function saveEntry(kind, opts) {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("data", typeof opts.data === "string" ? opts.data : JSON.stringify(opts.data));
  fd.append("name", opts.name || "");
  fd.append("auto", opts.auto ? "1" : "0");
  fd.append("id", opts.id || "");
  fd.append("title", opts.title || "");
  fd.append("info", JSON.stringify(opts.info || {}));
  for (const k of ["thumb", "img", "orig"]) if (opts[k]) fd.append(k, opts[k], `${k}.${k === "thumb" ? "jpg" : "png"}`);
  // レイヤーの画像(画像編集): { "L12.png": Blob, … }
  for (const [n, b] of Object.entries(opts.files || {})) if (b) fd.append(`file:${n}`, b, n);
  return (await ok(await api.fetchApi("/cca_generator/history/save", { method: "POST", body: fd }))).item;
}
export async function listEntries(kind) {
  const j = await ok(await api.fetchApi(`/cca_generator/history?kind=${kind}`, { cache: "no-store" }));
  if (cur) cur.dir = j.dir || "";
  return j.items || [];
}
export async function getEntry(kind, id) {
  return ok(await api.fetchApi(`/cca_generator/history/get?${new URLSearchParams({ kind, id })}`, { cache: "no-store" }));
}
export function fileUrl(kind, id, f, ver = "") {
  return api.apiURL(`/cca_generator/history/file?${new URLSearchParams({ kind, id, f, v: String(ver) })}`);
}
async function post(path, body) {
  return ok(await api.fetchApi(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

function css() {
  if (document.getElementById("cca-hbox-css")) return;
  const s = document.createElement("style");
  s.id = "cca-hbox-css";
  s.textContent = `
#cca-hbox{position:fixed;inset:0;z-index:1004;background:#0009;display:none;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#e4e7eb}
#cca-hbox.open{display:flex}
#cca-hbox .hb{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column}
#cca-hbox .hh{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid #303744;flex-wrap:wrap}
#cca-hbox .hh .sp{flex:1}
#cca-hbox button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:4px 9px;cursor:pointer;font:inherit;font-size:13px}
#cca-hbox button:hover{border-color:#3db4a6}
#cca-hbox button.on{background:#2b8f84;border-color:#3db4a6;color:#fff}
#cca-hbox button.pri{background:#2b8f84;border-color:#3db4a6;color:#fff;font-weight:700}
#cca-hbox button:disabled{opacity:.45;cursor:default}
#cca-hbox .note{font-size:12.5px;color:#9fb0c2;padding:8px 12px 0}
#cca-hbox .note.dir{display:flex;gap:8px;align-items:center;flex-wrap:wrap;word-break:break-all}
#cca-hbox .ls{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;padding:10px 12px 12px;overflow:auto;min-height:120px}
#cca-hbox .it{border:2px solid #303744;border-radius:8px;padding:6px;background:#13161b;display:flex;flex-direction:column;gap:4px;min-width:0}
#cca-hbox .it.cur{border-color:#6b5422}
#cca-hbox .it:hover{border-color:#3db4a6}
#cca-hbox .th{height:118px;border-radius:5px;background:#0b0d10;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;color:#56606e;font-size:30px}
#cca-hbox .th img{max-width:100%;max-height:118px;object-fit:contain}
#cca-hbox .nm{font-size:13px;font-weight:700;color:#e4e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cca-hbox .sub{font-size:11.5px;color:#9fb0c2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cca-hbox .bd{display:inline-block;font-size:11px;border-radius:4px;padding:0 5px;margin-right:4px;font-weight:400;vertical-align:1px}
#cca-hbox .bd.a{background:#3a4250;color:#cfd5dc}
#cca-hbox .bd.m{background:#2b8f84;color:#fff}
#cca-hbox .bd.c{background:#6b5422;color:#ffe9b0}
#cca-hbox .row{display:flex;gap:4px;align-items:center}
#cca-hbox .row .pri{flex:1}
#cca-hbox .empty{grid-column:1/-1;padding:28px;text-align:center;color:#9fb0c2;border:1px dashed #3a4250;border-radius:8px}
`;
  document.head.appendChild(s);
}

let box = null;
let cur = null; // { opts, items, filter, resolve }

function build() {
  css();
  box = document.createElement("div");
  box.id = "cca-hbox";
  box.tabIndex = -1;
  box.innerHTML = `<div class="hb">
    <div class="hh"><b data-t></b><span class="sp"></span>
      <button data-f="all" class="on">すべて</button><button data-f="m">一時保存</button><button data-f="a">自動保存</button>
      <button data-x>閉じる</button></div>
    <div class="note" data-note></div>
    <div class="note dir"><span data-dir></span> <button data-open title="一時保存のフォルダを開きます(要らなくなったら、ここで消すこともできます)">📂 フォルダを開く</button></div>
    <div class="ls" data-ls></div></div>`;
  document.body.appendChild(box);
  box.querySelector("[data-x]").onclick = () => done(null);
  box.addEventListener("pointerdown", (e) => { if (e.target === box) done(null); });
  box.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); done(null); } });
  box.addEventListener("keyup", (e) => e.stopPropagation());
  for (const b of box.querySelectorAll("[data-f]")) b.onclick = () => { cur.filter = b.dataset.f; render(); };
  box.querySelector("[data-open]").onclick = async (e) => {
    const b = e.currentTarget;
    try { await post("/cca_generator/history/open", { kind: cur.opts.kind }); notify(T("フォルダを開くよう指示しました: {0}", cur.dir || ""), "info", b); }
    catch (err) { notify(`${T("フォルダを開けませんでした")}: ${err.message}`, "error", b); }
  };
  box.querySelector("[data-ls]").addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    const btn = e.target.closest("[data-a]");
    if (!card || !cur) return;
    const it = cur.items.find((x) => x.id === card.dataset.id);
    if (!it) return;
    const a = btn?.dataset.a || (e.target.closest(".th") ? "open" : "");
    if (a === "open") openItem(it, btn);
    else if (a === "ren") renameItem(it, btn);
    else if (a === "del") deleteItem(it, btn);
  });
  box.querySelector("[data-ls]").addEventListener("dblclick", (e) => {
    const card = e.target.closest("[data-id]");
    const it = card && cur?.items.find((x) => x.id === card.dataset.id);
    if (it && !e.target.closest("button")) openItem(it);
  });
}
function notify(msg, kind, el) { cur?.opts.notify?.(msg, kind, el); }
function infoText(it) {
  const i = it.info || {};
  if (it.kind === "video") {
    const parts = [];
    if (Array.isArray(i.size)) parts.push(`${i.size[0]}×${i.size[1]}`);
    if (i.dur) parts.push(T("{0}秒", Number(i.dur).toFixed(1)));
    if (i.clips) parts.push(T("動画 {0}本", i.clips));
    if (i.overlays) parts.push(T("レイヤー {0}", i.overlays));
    return parts.join(T("・"));
  }
  const parts = [];
  if (i.w && i.h) parts.push(`${i.w}×${i.h}`);
  if (i.images > 1) parts.push(T("画像 {0}", i.images));
  if (i.texts) parts.push(T("文字 {0}", i.texts));
  return parts.join(T("・"));
}
function render() {
  if (!cur) return;
  for (const b of box.querySelectorAll("[data-f]")) b.classList.toggle("on", b.dataset.f === cur.filter);
  box.querySelector("[data-dir]").textContent = cur.dir ? T("保存先: {0}", cur.dir) : "";
  const ls = box.querySelector("[data-ls]");
  const items = cur.items.filter((it) => cur.filter === "all" || (cur.filter === "a" ? it.auto : !it.auto));
  if (!items.length) {
    ls.innerHTML = `<div class="empty">${esc(T(cur.loading ? "読み込み中…" : "まだありません。「📌 一時保存」(Ctrl+S)で今の編集を残せます。"))}</div>`;
    return;
  }
  const now = cur.opts.current?.() || "";
  ls.innerHTML = items.map((it) => {
    const name = it.name || it.title || T("(名前なし)");
    const badge = it.id === now ? `<span class="bd c">${esc(T("今の作業"))}</span>` : it.auto ? `<span class="bd a">${esc(T("自動保存"))}</span>` : `<span class="bd m">${esc(T("一時保存"))}</span>`;
    const th = it.thumb ? `<img src="${esc(fileUrl(it.kind, it.id, "thumb.jpg", it.updated))}" alt="">` : it.kind === "video" ? "🎬" : "🖼";
    const sub2 = [it.name && it.title ? it.title : "", mb(it.bytes || 0)].filter(Boolean).join(T("・"));
    return `<div class="it${it.id === now ? " cur" : ""}" data-id="${esc(it.id)}">
      <div class="th" title="${esc(T("クリックで開きます"))}">${th}</div>
      <div class="nm" title="${esc(name)}">${badge}${esc(name)}</div>
      <div class="sub">${esc([fmtTime(it.updated), infoText(it)].filter(Boolean).join(T("・")))}</div>
      <div class="sub" title="${esc(sub2)}">${esc(sub2)}</div>
      <div class="row"><button class="pri" data-a="open">開く</button><button data-a="ren" title="名前を付けると、自動保存でも消えずに残ります">✎ 名前</button><button data-a="del" title="消す">🗑</button></div>
    </div>`;
  }).join("");
}
async function refreshList() {
  if (!cur) return;
  try { cur.items = await listEntries(cur.opts.kind); }
  catch (e) { notify(`${T("一時保存の一覧を読めませんでした")}: ${e.message}`, "error"); }
  cur.loading = false;
  render();
}
async function openItem(it, btn) {
  const opts = cur?.opts;
  if (!opts) return;
  if (btn) btn.disabled = true;
  try {
    const full = await getEntry(it.kind, it.id);
    const okDone = await opts.onOpen(full);
    if (okDone !== false) done(full);
  } catch (e) {
    notify(`${T("一時保存を開けませんでした")}: ${e.message}`, "error", btn);
  } finally { if (btn) btn.disabled = false; }
}
async function renameItem(it, btn) {
  const v = prompt("名前(名前を付けると、自動保存でも消えずに残ります)", it.name || it.title || "");
  if (v === null) return;
  try {
    const item = await post("/cca_generator/history/rename", { kind: it.kind, id: it.id, name: v });
    Object.assign(it, item);
    render();
  } catch (e) { notify(`${T("名前を変えられませんでした")}: ${e.message}`, "error", btn); }
}
async function deleteItem(it, btn) {
  if (!confirm(T("「{0}」を消しますか?", it.name || it.title || fmtTime(it.updated)))) return;
  try {
    await post("/cca_generator/history/delete", { kind: it.kind, id: it.id });
    cur.items = cur.items.filter((x) => x !== it);
    cur.opts.onDelete?.(it);
    render();
  } catch (e) { notify(`${T("消せませんでした")}: ${e.message}`, "error", btn); }
}
function done(v) {
  if (!cur) return;
  box.classList.remove("open");
  const r = cur.resolve;
  cur = null;
  r(v);
}
// opts: { kind: "video" | "image", notify(msg, kind, el), current() → 今の作業の自動保存の id, onOpen(項目) → false で開いたままにする, onDelete(項目) }
export function openHistory(opts) {
  if (!box) build();
  if (cur) done(null);
  return new Promise((resolve) => {
    cur = { opts, items: [], filter: "all", loading: true, resolve };
    box.querySelector("[data-t]").textContent = T(opts.kind === "video" ? "🕘 一時保存の履歴(動画編集)" : "🕘 一時保存の履歴(画像編集)");
    box.querySelector("[data-note]").textContent = T("「📌 一時保存」(Ctrl+S)のほかに、編集中の内容を数分ごとと閉じたときに自動で保存します(自動保存は新しい 10 件まで)。名前を付けると消えずに残ります。");
    box.classList.add("open");
    box.focus();
    render();
    refreshList();
  });
}
export const isHistoryOpen = () => !!box?.classList.contains("open");
// 編集の画面のキー操作より先に呼ぶ(開いているときはここで受ける)
export function historyKey(e) {
  if (!isHistoryOpen()) return false;
  e.stopPropagation();
  if (e.key === "Escape") { e.preventDefault(); done(null); }
  return true;
}
// テスト用
window.CCA_HIST = { isOpen: isHistoryOpen, close: () => done(null), items: () => cur?.items || [] };
