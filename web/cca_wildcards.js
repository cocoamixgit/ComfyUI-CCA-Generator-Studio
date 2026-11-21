// 第29版: ワイルドカード(プロンプトに __名前__ と書くと、生成のたびに登録した行のどれか 1 つに置き換わる)。
// 置き換えるのはサーバー(キューに入れるとき。wildcards.py)。ここは一覧(押すとプロンプトのカーソルの位置に入る)と編集。
// 保存・削除はプロンプトのプリセットと同じ考え方: 選んで「編集」、「新規」は空の欄から。おすすめ(★)は消すと一覧から外れ、
// 「消したおすすめを戻す」で戻る。編集したおすすめは「★ おすすめの内容に戻す」で元の中身に戻せる。
import { api } from "../../scripts/api.js";
import { T, confirm } from "./cca_i18n.js";

let ctx = null;
let items = [];
let hiddenN = 0;
let editing = null; // 編集中の名前(新規は "")
const tok = (name) => `__${name}__`;
const $ = (s) => ctx.root.querySelector(s);

export function wildcardHtml() {
  return `
        <div class="wcbox words foldbox hide" id="cca-wc">
          <div class="hint">プロンプトに <code>__color__</code> のように書くと、生成のたびに、登録した行のどれか 1 つに置き換わります(シードが同じなら同じ言葉)。下を押すと、プロンプトのカーソルの位置に入ります。</div>
          <div class="chips" id="cca-wc-list"></div>
          <div class="row" style="margin-top:6px">
            <select id="cca-wc-sel" class="grow" title="編集するワイルドカード"></select>
            <button id="cca-wc-edit" title="選んだワイルドカードの中身を表示して編集する">編集</button>
            <button id="cca-wc-new" title="空の欄から新しく作る">新規</button>
            <button id="cca-wc-unhide" class="hide">消したおすすめを戻す</button>
          </div>
          <div class="wced hide" id="cca-wc-ed">
            <div class="f"><label class="l">置き換え元の文(プロンプトに書く文字。上の一覧を押すと入る文字と同じ)</label>
              <input type="text" id="cca-wc-name" placeholder="__color__"></div>
            <div class="f" style="margin-top:6px"><label class="l">内容(1 行に 1 つ。生成のたびに、どれか 1 行に置き換わります。# で始まる行は使いません)</label>
              <textarea id="cca-wc-lines" rows="9" placeholder="red&#10;blue&#10;green"></textarea></div>
            <div class="row" style="margin-top:6px">
              <button class="pri" id="cca-wc-save">保存</button>
              <button id="cca-wc-del" title="このワイルドカードを消す">削除</button>
              <button id="cca-wc-revert" class="hide" title="編集した中身を消して、おすすめの中身に戻す">★ おすすめの内容に戻す</button>
              <button id="cca-wc-close">閉じる</button>
              <span class="hint" id="cca-wc-count"></span>
            </div>
          </div>
        </div>`;
}
export const WILDCARD_CSS = `
#cca-ui .wordbar button.fold{border-radius:999px}
#cca-ui .wordbar button.fold.on{background:var(--accent-d);border-color:var(--accent);color:#fff}
#cca-ui .foldbox{margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#151a21}
#cca-ui .wcbox .chip{font-family:ui-monospace,Consolas,monospace}
#cca-ui .wced{margin-top:8px;padding:8px 10px;border:1px solid #3a4658;border-radius:8px;background:#11161c}
#cca-ui .wced textarea{min-height:150px;font-family:ui-monospace,Consolas,monospace}
`;

async function load() {
  try {
    const r = await api.fetchApi("/cca_generator/wildcards", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
    items = j.items || [];
    hiddenN = j.hidden || 0;
  } catch (e) {
    console.warn("[CCA Generator] ワイルドカードを読めませんでした", e);
  }
  render();
}
export const wildcardNames = () => new Set(items.map((x) => x.name));
// プロンプトの中の、登録の無い __名前__
export function unknownWildcards(text) {
  if (!items.length) return [];
  const known = wildcardNames();
  const out = [];
  for (const m of String(text || "").matchAll(/__([^\s_,()[\]{}|<>:]+(?:_[^\s_,()[\]{}|<>:]+)*)__/g)) {
    if (!known.has(m[1]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

function render() {
  if (!ctx?.root) return;
  const list = $("#cca-wc-list");
  list.innerHTML = items.map((x) => `<button class="chip" data-wc="${ctx.esc(x.name)}" title="${ctx.esc(`${x.lines.length} ${T("行")}: ${x.lines.slice(0, 8).join(", ")}${x.lines.length > 8 ? " …" : ""}`)}">${ctx.esc(tok(x.name))}</button>`).join("")
    || `<span class="hint">${T("ワイルドカードがありません。「新規」で作れます。")}</span>`;
  for (const b of list.querySelectorAll("[data-wc]")) {
    b.onmousedown = (e) => e.preventDefault(); // プロンプト欄のカーソルを動かさない
    b.onclick = () => ctx.insertWord("positive", tok(b.dataset.wc));
  }
  const sel = $("#cca-wc-sel");
  const cur = sel.value;
  sel.innerHTML = items.map((x) => `<option value="${ctx.esc(x.name)}">${x.builtin ? "★ " : ""}${ctx.esc(tok(x.name))}(${x.lines.length})</option>`).join("");
  if (items.some((x) => x.name === cur)) sel.value = cur;
  $("#cca-wc-edit").disabled = !items.length;
  const un = $("#cca-wc-unhide");
  un.classList.toggle("hide", !hiddenN);
  un.textContent = T("消したおすすめを戻す({0})", hiddenN);
}
function openEditor(name) {
  editing = name;
  const it = items.find((x) => x.name === name);
  $("#cca-wc-ed").classList.remove("hide");
  $("#cca-wc-name").value = it ? tok(it.name) : "";
  $("#cca-wc-lines").value = it ? it.lines.join("\n") : "";
  $("#cca-wc-del").classList.toggle("hide", !it);
  $("#cca-wc-revert").classList.toggle("hide", !(it?.builtin && it.edited));
  countLines();
  const ta = $("#cca-wc-lines");
  ta.scrollTop = 0;
  if (it) { ta.focus({ preventScroll: true }); ta.setSelectionRange(0, 0); ta.scrollTop = 0; } else $("#cca-wc-name").focus();
}
function closeEditor() { editing = null; $("#cca-wc-ed").classList.add("hide"); }
function countLines() {
  const n = $("#cca-wc-lines").value.split("\n").map((x) => x.trim()).filter((x) => x && !x.startsWith("#")).length;
  $("#cca-wc-count").textContent = T("{0} 行", n);
}
const normName = (s) => { let v = String(s || "").trim(); if (v.startsWith("__") && v.endsWith("__") && v.length > 4) v = v.slice(2, -2); return v; };

async function post(path, body) {
  const r = await api.fetchApi(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
  return j;
}
async function saveEditor(btn) {
  const name = normName($("#cca-wc-name").value);
  if (!name) { ctx.notify("置き換え元の文(__名前__)を入れてください", "error", btn); return; }
  const other = items.find((x) => x.name === name);
  if (other && name !== editing && !confirm(T("{0} はもうあります。上書きしますか?", tok(name)))) return;
  try {
    const j = await post("/cca_generator/wildcards/save", { name, lines: $("#cca-wc-lines").value, old: editing || null });
    await load();
    $("#cca-wc-sel").value = j.name;
    openEditor(j.name);
    ctx.notify(T("保存しました: {0}", tok(j.name)), "info", btn, { toast: false });
  } catch (e) { ctx.notify(`${T("保存できませんでした")}: ${e.message}`, "error", btn); }
}
async function deleteEditor(btn) {
  const it = items.find((x) => x.name === editing);
  if (!it) return;
  const msg = it.builtin ? T("おすすめの {0} を一覧から外しますか?(「消したおすすめを戻す」で戻せます)", tok(it.name)) : T("{0} を削除しますか?", tok(it.name));
  if (!confirm(msg)) return;
  try {
    await post("/cca_generator/wildcards/delete", { name: it.name });
    closeEditor();
    await load();
    ctx.notify(T("削除しました: {0}", tok(it.name)), "info", $("#cca-wc-edit"), { toast: false });
  } catch (e) { ctx.notify(`${T("削除できませんでした")}: ${e.message}`, "error", btn); }
}

export function setupWildcards(c) {
  ctx = c;
  const words = $("#cca-words"), wc = $("#cca-wc");
  const wb = $("#cca-words-btn"), cb = $("#cca-wc-btn");
  // 「サンプルワード」と「ワイルドカード」は、どちらか 1 つを開く(もう一度押すと閉じる)
  const show = (which) => {
    const w = which === "words" && words.classList.contains("hide");
    const k = which === "wc" && wc.classList.contains("hide");
    words.classList.toggle("hide", !w);
    wc.classList.toggle("hide", !k);
    wb.classList.toggle("on", w);
    cb.classList.toggle("on", k);
    wb.setAttribute("aria-expanded", String(w));
    cb.setAttribute("aria-expanded", String(k));
    if (k) load();
  };
  wb.onclick = () => show("words");
  cb.onclick = () => show("wc");
  $("#cca-wc-edit").onclick = () => { if ($("#cca-wc-sel").value) openEditor($("#cca-wc-sel").value); };
  $("#cca-wc-sel").onchange = () => { if (!$("#cca-wc-ed").classList.contains("hide") && editing) openEditor($("#cca-wc-sel").value); };
  $("#cca-wc-new").onclick = () => openEditor("");
  $("#cca-wc-close").onclick = () => closeEditor();
  $("#cca-wc-lines").addEventListener("input", countLines);
  $("#cca-wc-save").onclick = (e) => saveEditor(e.currentTarget);
  $("#cca-wc-del").onclick = (e) => deleteEditor(e.currentTarget);
  $("#cca-wc-revert").onclick = async (e) => {
    const btn = e.currentTarget;
    if (!editing || !confirm(T("{0} の中身を、おすすめの内容に戻しますか?", tok(editing)))) return;
    try { await post("/cca_generator/wildcards/delete", { name: editing, revert: true }); const nm = editing; await load(); openEditor(nm); } catch (err) { ctx.notify(`${T("戻せませんでした")}: ${err.message}`, "error", btn); }
  };
  $("#cca-wc-unhide").onclick = async (e) => {
    try { const j = await post("/cca_generator/wildcards/unhide", {}); await load(); ctx.notify(T("おすすめを {0} 件戻しました", j.restored), "info", e.currentTarget, { toast: false }); } catch (err) { ctx.notify(err.message, "error", e.currentTarget); }
  };
  load();
}
export function reloadWildcards() { return load(); }
