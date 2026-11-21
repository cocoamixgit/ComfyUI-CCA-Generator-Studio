// 全設定の書き出し / 読み込み(第25版)。
// サーバーに置いている物(プリセット・前回の設定・テンプレート・フォルダ)は /cca_generator/settings/*、
// ブラウザに覚えている物は下の BROWSER_ITEMS の一覧で決める(設定を足したら、ここに書くだけで書き出しの対象になる)。
// 一時保存の履歴・結果の一覧・処理時間の覚え書きは入れない。
// 第28版: Stable Diffusion WebUI Forge / A1111 のスタイル(styles.csv)も選べる。サーバーがプロンプトのプリセットだけの
// 設定の形にして返すので、そのあとは設定ファイルと同じ(足す / 置き換える)。
import { api } from "../../scripts/api.js";
import { T, confirm } from "./cca_i18n.js";
import { reloadAllSections } from "./cca_sections.js";

const FORMAT = "cca_generator.settings";
// 種類 → キー(末尾が "." のものは、その名前で始まるキーすべて)
export const BROWSER_ITEMS = {
  panel: ["cca_generator.autoopen"], // 複数画像タイル生成の設定は第31版からサーバー側(tile_settings.json)
  editor: ["cca_generator.imgedit.out", "cca_generator.imgedit.rmopts", "cca_generator.imgedit.rmmethod", "cca_generator.imgedit.snap",
    "cca_generator.vedit.snap", "cca_generator.vedit.stretch", "cca_generator.maskcolor", "cca_generator.watermark",
    "cca_generator.imgedit.frame", "cca_generator.vedit.frame"],
  layout: ["cca_generator.layout.", "cca_generator.details"],
};
// 画面に出す種類(並び順)。server: サーバー側にもあるか
const CATS = [
  ["panel", "生成パネルの設定(種別・タスクごとの前回の設定・複数画像タイル生成と生成回数)"],
  ["presets", "プロンプトのプリセット(消したおすすめも)"],
  ["wildcards", "ワイルドカード(消したおすすめも)"],
  ["styles", "文字の書式のテンプレート"],
  ["editor", "画像編集・動画編集の設定(書き出し・オブジェクト除去・スナップ・枠の強調表示など)"],
  ["layout", "項目の並び・開け閉め"],
  ["folders", "モデルフォルダ設定"],
];

function keysOf(cat) {
  const out = [];
  const want = BROWSER_ITEMS[cat] || [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (want.some((w) => (w.endsWith(".") ? k.startsWith(w) : k === w))) out.push(k);
    }
  } catch { /* 使えなければ空 */ }
  return out;
}
function browserPart() {
  const b = {};
  for (const cat of Object.keys(BROWSER_ITEMS)) {
    const o = {};
    for (const k of keysOf(cat)) { try { o[k] = localStorage.getItem(k); } catch { /* 読めなければ飛ばす */ } }
    b[cat] = o;
  }
  return b;
}
async function exportSettings() {
  const r = await api.fetchApi("/cca_generator/settings/export");
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `${r.status}`);
  const data = { ...j.data, browser: browserPart() };
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `cca_generator_settings_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return name;
}
// ブラウザ側の読み込み(知らないキーは入れない)
function importBrowser(data, mode, cats) {
  const b = data.browser && typeof data.browser === "object" ? data.browser : {};
  const done = [];
  for (const cat of Object.keys(BROWSER_ITEMS)) {
    if (!cats.includes(cat) || !b[cat] || typeof b[cat] !== "object") continue;
    const want = BROWSER_ITEMS[cat];
    const ok = (k) => want.some((w) => (w.endsWith(".") ? k.startsWith(w) : k === w));
    try {
      if (mode === "replace") for (const k of keysOf(cat)) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(b[cat])) {
        if (!ok(k) || typeof v !== "string") continue;
        if (mode === "merge" && localStorage.getItem(k) !== null) continue; // 足す: 今ある物はそのまま
        localStorage.setItem(k, v);
      }
    } catch { /* 入れられなければ飛ばす */ }
    done.push(cat);
  }
  return done;
}
const catsIn = (data) => CATS.map(([c]) => c).filter((c) => (data.server && data.server[c]) || (data.browser && data.browser[c]));

const CSS = `
#cca-setio{position:fixed;inset:0;z-index:1100;background:#000a;display:none;align-items:center;justify-content:center;font:14px/1.6 system-ui,sans-serif;color:#e4e7eb}
#cca-setio.open{display:flex}
#cca-setio .prefs{display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;margin:4px 0 6px;padding:10px 12px;border:1px solid #303744;border-radius:8px}
#cca-setio .prefs .ck{grid-column:1 / -1;display:flex;align-items:center;gap:6px}
#cca-setio .prefs select{background:#12151a;color:#e4e7eb;border:1px solid #303744;border-radius:6px;padding:4px 8px;min-width:0}
#cca-setio .bx{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:16px 18px}
#cca-setio h3{margin:0 0 10px;font-size:17px}
#cca-setio h4{margin:14px 0 6px;font-size:14px;color:#cfd5dc}
#cca-setio button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
#cca-setio button.pri{background:#2b8f84;border-color:#3db4a6;color:#fff;font-weight:700}
#cca-setio button:disabled{opacity:.5;cursor:default}
#cca-setio .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#cca-setio .note{color:#959eab;font-size:12px;margin-top:6px}
#cca-setio .msg{margin-top:10px;padding:6px 10px;border-radius:6px;background:#13161b;white-space:pre-wrap}
#cca-setio .msg.err{background:#3a1d1d;color:#ffb4b4}
#cca-setio label.ck{display:flex;gap:8px;align-items:center;margin:2px 0}
#cca-setio .imp{border:1px solid #303744;border-radius:8px;padding:8px 12px;margin-top:8px}
#cca-setio [data-info]{white-space:pre-wrap}
`;
let ui = null;
let loaded = null; // 読み込もうとしている設定ファイル
function build() {
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);
  ui = document.createElement("div");
  ui.id = "cca-setio";
  ui.innerHTML = `<div class="bx">
    <div class="row"><h3>⚙ ${T("設定")}</h3><span style="flex:1"></span><button data-x>${T("閉じる")}</button></div>
    <div data-prefs></div>
    <h4>${T("設定の書き出し / 読み込み")}</h4>
    <div class="note">${T("生成パネルの設定・プロンプトのプリセット・文字のテンプレート・編集画面の設定・項目の並び・モデルフォルダ設定を 1 つのファイルにまとめます。一時保存の履歴・結果の一覧・透かしの画像は入りません。")}</div>
    <h4>${T("書き出す")}</h4>
    <div class="row"><button class="pri" data-exp>⬇ ${T("今の設定をファイルに書き出す")}</button></div>
    <h4>${T("読み込む")}</h4>
    <div class="row"><button data-pick>📂 ${T("設定ファイルを選ぶ…")}</button><input type="file" accept=".json,.csv,application/json,text/csv" hidden data-file></div>
    <div class="note">${T("Stable Diffusion WebUI Forge / A1111 のスタイル(styles.csv)も選べます。プロンプトのプリセットとして読み込みます。")}</div>
    <div class="imp" data-imp hidden>
      <div data-info class="note" style="margin-top:0"></div>
      <div data-cats style="margin-top:6px"></div>
      <div class="row" style="margin-top:8px">${T("読み込み方")}
        <label class="ck"><input type="radio" name="cca-setio-mode" value="merge" checked> ${T("足す(今ある物はそのまま。無い物だけ足す)")}</label>
        <label class="ck"><input type="radio" name="cca-setio-mode" value="replace"> ${T("置き換える(選んだ種類を、読み込んだ物にする)")}</label></div>
      <div class="row" style="margin-top:8px"><button class="pri" data-imp-go>${T("読み込む")}</button></div>
    </div>
    <div class="msg" data-msg hidden></div></div>`;
  document.body.appendChild(ui);
  const $ = (s) => ui.querySelector(s);
  const msg = (t, err = false) => { const m = $("[data-msg]"); m.hidden = !t; m.textContent = t || ""; m.classList.toggle("err", err); };
  $("[data-x]").onclick = () => ui.classList.remove("open");
  ui.addEventListener("pointerdown", (e) => { if (e.target === ui) ui.classList.remove("open"); });
  $("[data-exp]").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { msg(T("書き出しました: {0}", await exportSettings())); } catch (err) { msg(`${T("書き出せませんでした")}: ${err.message}`, true); } finally { btn.disabled = false; }
  };
  $("[data-pick]").onclick = () => $("[data-file]").click();
  $("[data-file]").onchange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      let data, forge = null;
      if (/\.csv$/i.test(f.name) || f.type === "text/csv") {
        // Forge / A1111 のスタイル: 中身はサーバーで読む(改行・, の入った欄、BOM、Shift_JIS も)
        const r = await api.fetchApi("/cca_generator/settings/forge_styles", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: await f.arrayBuffer() });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || `${r.status}`);
        data = j.data;
        forge = j.info;
      } else {
        data = JSON.parse(await f.text());
        if (!data || data.format !== FORMAT) throw new Error(T("CCA Generator の設定ファイルではありません"));
      }
      loaded = data;
      const cats = catsIn(data);
      if (forge) {
        const notes = [];
        if (forge.prompt_tag) notes.push(T("{0} の入ったスタイル {1} 件は、{0} を外して読み込みます(この画面のプリセットは、今のプロンプトの後ろに足して使います)。", "{prompt}", forge.prompt_tag));
        if (forge.dup) notes.push(T("同じ名前が {0} 件あったので、最初の物を使います。", forge.dup));
        if (forge.empty) notes.push(T("名前か中身が空の {0} 行は読み込みません。", forge.empty));
        if (forge.over) notes.push(T("プリセットは {0} 件までなので、残りの {1} 件は読み込みません。", forge.count, forge.over));
        if (forge.cut_name) notes.push(T("長い名前 {0} 件は 80 文字までにします。", forge.cut_name));
        $("[data-info]").textContent = [T("{0}(Stable Diffusion WebUI Forge / A1111 のスタイル・{1} 件)", f.name, forge.count), ...notes,
          T("「置き換える」は、今のプリセットを消して、このファイルのスタイルだけにします(おすすめ ★ はそのまま)。")].join("\n");
        $("[data-cats]").innerHTML = `<label class="ck"><input type="checkbox" data-cat="presets" checked> ${T("プロンプトのプリセット(スタイル {0} 件)", forge.count)}</label>`;
      } else {
        $("[data-info]").textContent = T("{0}(第{1}版で書き出し・{2})", f.name, data.app_version ?? "?", data.exported || "")
          + (Number(data.format_version) > 1 ? ` ${T("新しい版で書き出したファイルです。分かる所だけ読み込みます。")}` : "");
        $("[data-cats]").innerHTML = CATS.filter(([c]) => cats.includes(c)).map(([c, l]) => `<label class="ck"><input type="checkbox" data-cat="${c}" checked> ${T(l)}</label>`).join("")
          || `<div class="note">${T("読み込める物がありません")}</div>`;
      }
      $("[data-imp]").hidden = false;
      msg("");
    } catch (err) { loaded = null; $("[data-imp]").hidden = true; msg(`${T("読み込めませんでした")}: ${err.message}`, true); }
  };
  $("[data-imp-go]").onclick = async (e) => {
    const btn = e.currentTarget;
    if (!loaded) return;
    const cats = [...ui.querySelectorAll("[data-cat]:checked")].map((x) => x.dataset.cat);
    const mode = ui.querySelector('input[name="cca-setio-mode"]:checked')?.value || "merge";
    if (!cats.length) { msg(T("読み込む種類を選んでください"), true); return; }
    if (mode === "replace" && !(await confirm(T("選んだ種類の今の設定を、読み込む設定で置き換えます。よろしいですか?")))) return;
    btn.disabled = true;
    try {
      const r = await api.fetchApi("/cca_generator/settings/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: loaded, mode, cats }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `${r.status}`);
      importBrowser(loaded, mode, cats);
      reloadAllSections();
      window.dispatchEvent(new CustomEvent("cca-settings-imported", { detail: { cats, mode } }));
      let t = T("読み込みました。");
      if (j.skipped?.length) t += `\n${T("この版では使わない物は読み込みませんでした: {0}", j.skipped.join(", "))}`;
      if (j.kept) t += `\n${T("同じ名前の {0} 件は、今の物のままにしました(読み込んだ物にするときは「置き換える」)。", j.kept)}`;
      if (cats.includes("folders") && mode === "replace") t += `\n${T("外したモデルフォルダは、ComfyUI を再起動すると一覧から消えます。")}`;
      msg(t);
      if (await confirm(T("生成パネルに反映するため、ページを読み込み直しますか?(編集中の物は一時保存してから)"))) location.reload();
    } catch (err) { msg(`${T("読み込めませんでした")}: ${err.message}`, true); } finally { btn.disabled = false; }
  };
}
// prefs: 生成パネルの 自動で表示・言語・テーマカラー の欄(題名のすぐ下に入れる)
export function openSettingsIO(prefs = null) {
  if (!ui) build();
  if (prefs && prefs.parentElement !== ui.querySelector("[data-prefs]")) ui.querySelector("[data-prefs]").appendChild(prefs);
  ui.classList.add("open");
}
// テスト用
window.CCA_SETTINGS = { BROWSER_ITEMS, browserPart, importBrowser };
