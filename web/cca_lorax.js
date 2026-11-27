// LoRA 一覧(モーダル): LoRA の欄のボタンを押すと開く、大きな画像つきのカード一覧。
//   「ローカル」タブ: models/loras にある LoRA(隣に同名の画像があればカードの画像に使う)。カードの右上の「i」で詳細
//   「Civitai」タブ: Civitai を検索して、ダウンロードして使う(開いたときに、はじめてネットに接続する)
// 行の差し替えや一覧の読み直しは、呼び出し側(cca_ui.js)が引数で渡す。
import { T, confirm } from "./cca_i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtMB = (b) => `${(Number(b || 0) / 1048576).toFixed(1)} MB`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// モデルの種類ごとの、関係のある LoRA の絞り込み(ローカル: 名前に含まれる言葉 / Civitai: ベースモデルの名前。無いものは言葉で探す)
const LORA_HINT = {
  "SD1.5": { w: "sd15", b: ["SD 1.5"] }, SDXL: { w: "sdxl", b: ["SDXL 1.0"] }, Illustrious: { w: "illust", b: ["Illustrious"] },
  Anima: { w: "anima", k: "anima" }, Krea2: { w: "krea", k: "krea" }, "Qwen Image": { w: "qwen", b: ["Qwen"] },
  "SenseNova-U1.6": { w: "sensenova", k: "sensenova" }, "MiniMax-H3-Image": { w: "minimax", k: "minimax" }, "MiniMax H3": { w: "minimax", k: "minimax" },
  "Wan2.2 14B": { w: "wan", b: ["Wan Video 2.2 T2V-A14B", "Wan Video 2.2 I2V-A14B"] }, "Wan2.2 5B": { w: "wan", b: ["Wan Video 2.2 TI2V-5B"] },
  "LTX-2.5": { w: "ltx", k: "ltx" }, "Kandinsky 6": { w: "kandinsky", k: "kandinsky" }, MOSS: { w: "moss", k: "moss" },
};
const hintOf = (model) => LORA_HINT[String(model || "").replace(/ Turbo$/, "")] || {};
const MEM = {}; // 開き直したとき前の絞り込みを残す(ComfyUI を読み込み直すと、初期値に戻る)
let cardW = 240; // カードの幅(px)。開いている間は覚えておく

const CSS = `
#cca-lorax{position:fixed;inset:0;z-index:1003;background:#000c;display:flex;align-items:center;justify-content:center;
  font:14px system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-lorax .box{background:#1a1e25;border:1px solid #303744;border-radius:10px;padding:14px;width:calc(100vw - 24px);height:calc(100vh - 24px);display:flex;flex-direction:column;gap:10px;position:relative}
#cca-lorax h3{margin:0;font-size:18px}
#cca-lorax .hd{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#cca-lorax .tabs{display:flex;gap:4px}
#cca-lorax .tabs button.on{background:#2b8f84;border-color:#3db4a6}
#cca-lorax .cnt{color:#c9d1da}
#cca-lorax .sz{display:flex;align-items:center;gap:6px;color:#959eab;font-size:12px}
#cca-lorax .sz input{width:110px;padding:0}
#cca-lorax .pane{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
#cca-lorax .hide{display:none !important}
#cca-lorax .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#cca-lorax .bar input[type=search]{flex:1;min-width:200px}
#cca-lorax .dirs{display:flex;gap:6px;flex-wrap:wrap;max-height:84px;overflow:auto}
#cca-lorax .dirs button{border-radius:14px;padding:3px 12px}
#cca-lorax .dirs button.on{background:#2b8f84;border-color:#3db4a6}
#cca-lorax .hint{color:#959eab;font-size:12px}
#cca-lorax .warn{color:#f0b35a;padding:6px 0}
#cca-lorax input,#cca-lorax select{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 8px;font:inherit}
#cca-lorax button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit}
#cca-lorax button:hover{background:#2a323c}
#cca-lorax button.pri{background:#2b8f84;border-color:#3db4a6}
#cca-lorax button:disabled{opacity:.5;cursor:default}
#cca-lorax option{background:#1a1e25;color:#e4e7eb}
#cca-lorax option:checked,#cca-lorax option:hover{background:#2a323c;color:#e4e7eb}
#cca-lorax button[data-a="more"]{flex:1;width:100%;padding:10px 12px}
#cca-lorax a{color:inherit;text-decoration:underline;font-weight:600}
#cca-lorax .login{border:1px solid #303744;border-radius:8px;padding:8px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#cca-lorax .login input{width:260px}
#cca-lorax .grid{flex:1;min-height:0;overflow:auto;display:grid !important;grid-auto-rows:max-content;align-items:start;align-content:start;gap:12px;padding-right:4px}
#cca-lorax .lx{position:relative !important;display:block !important;border:2px solid #303744;border-radius:8px;background:#0e1115;cursor:pointer;overflow:hidden}
#cca-lorax .lx::before{content:"";display:block;padding-top:133.333%}
#cca-lorax .lx:hover{border-color:#7a8699}
#cca-lorax .lx.cur{border-color:#e0a23c}
#cca-lorax .lx img{position:absolute !important;inset:0;width:100%;height:100%;object-fit:cover}
#cca-lorax .lx .none{position:absolute !important;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7482;background:#14181e}
#cca-lorax .lx .cap{position:absolute !important;left:0;right:0;bottom:0;padding:26px 8px 6px;background:linear-gradient(#00000000,#000000e6 55%);pointer-events:none}
#cca-lorax .lx .nm{font-size:14px;font-weight:600;line-height:1.3;word-break:break-all;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:#ffffffee;text-shadow:0 1px 3px #000000cc}
#cca-lorax .lx .dr{font-size:12px;color:#ffffffcc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cca-lorax .lx.clr{border:2px dashed #e0a23c;background:#3a2c12}
#cca-lorax .lx.clr:hover{border-color:#ffc860;background:#4a3818}
#cca-lorax .lx.clr .none{background:none;color:#ffd58a;font-weight:600;flex-direction:column;gap:6px;text-align:center;padding:8px}
#cca-lorax .lx .badge{position:absolute !important;left:6px;top:6px;background:#000000c0;color:#ffffffee;border-radius:4px;padding:2px 8px;font-size:13px;font-weight:600}
#cca-lorax .lx.cur .badge{background:#000000d8}
#cca-lorax .lx .i{position:absolute !important;right:6px !important;top:6px !important;left:auto !important;width:30px !important;height:30px !important;min-width:0 !important;min-height:0 !important;margin:0 !important;padding:0 !important;box-sizing:border-box;border-radius:50%;background:#000a;border:1px solid #fffa;color:#fff;font:italic 700 18px/1 Georgia,serif;display:flex;align-items:center;justify-content:center}
#cca-lorax .lx .i:hover{background:#2b8f84}
#cca-lorax .info{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:2;border-radius:10px}
#cca-lorax .info .pn{background:#1a1e25;border:1px solid #3db4a6;border-radius:10px;width:min(1100px,calc(100% - 32px));max-height:calc(100% - 32px);display:flex;flex-direction:column;overflow:hidden}
#cca-lorax .info .ph{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #303744}
#cca-lorax .info .ph b{flex:1;word-break:break-all;font-size:16px}
#cca-lorax .info .pb{display:flex;gap:16px;padding:14px;overflow:auto;min-height:0}
#cca-lorax .info .im{flex:0 0 min(42%,420px)}
#cca-lorax .info .im img{width:100%;border-radius:8px;display:block}
#cca-lorax .info .im .none{min-height:280px;display:flex;align-items:center;justify-content:center;color:#6b7482;background:#14181e;border-radius:8px}
#cca-lorax .info .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px}
#cca-lorax .info .kv{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px}
#cca-lorax .info .kv span:nth-child(odd){color:#959eab}
#cca-lorax .info .kv span:nth-child(even){word-break:break-all}
#cca-lorax .info .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#cca-lorax .info .box2{background:#0e1115;border:1px solid #303744;border-radius:6px;padding:6px 8px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto}
#cca-lorax .info .tg{display:flex;flex-wrap:wrap;gap:4px;max-height:150px;overflow:auto}
#cca-lorax .info .tg span{background:#20252e;border:1px solid #3a4250;border-radius:10px;padding:1px 8px;font-size:12px;cursor:pointer}
#cca-lorax .info .tg span:hover{background:#2b8f84}
@media (max-width:760px){#cca-lorax .info .pb{flex-direction:column}#cca-lorax .info .im{flex:none;width:60%}}
`;

function ensureCss() {
  let st = document.getElementById("cca-lorax-css");
  if (!st) { st = document.createElement("style"); st.id = "cca-lorax-css"; document.head.appendChild(st); }
  st.textContent = CSS;
}

const template = () => `<div class="box">
  <div class="hd"><h3>${esc(T("LoRA を選ぶ"))}</h3>
    <div class="tabs"><button type="button" data-tab="local" class="on">${esc(T("ローカル"))}</button><button type="button" data-tab="civitai">Civitai</button></div>
    <span class="cnt"></span><span style="flex:1"></span>
    <label class="sz">${esc(T("カードの大きさ"))}<input type="range" data-k="size" min="150" max="420" step="10"></label>
    <button type="button" data-a="reload" title="${esc(T("一覧を読み直す"))}">🔄</button>
    <button type="button" data-a="close">${esc(T("閉じる"))}</button></div>
  <div class="pane" data-pane="local">
    <div class="bar"><input type="search" data-k="lq" placeholder="${esc(T("名前で検索(スペース区切りで、すべてを含むもの)"))}"></div>
    <div class="dirs" data-k="dirs"></div>
    <div class="hint">${esc(T("カードを押すと、その LoRA を使います。右上の i で詳細を見られます。カードの画像は、LoRA と同じ名前の .png / .jpg / .webp / .preview.png が同じフォルダにあれば出ます。"))}</div>
    <div class="grid" data-k="lgrid"></div>
  </div>
  <div class="pane hide" data-pane="civitai">
    <div class="login" data-k="login"></div>
    <div class="bar"><input type="search" data-k="cq" placeholder="${esc(T("Civitai で検索(例: 名前・作者・キーワード)"))}">
      <select data-k="csort"><option>Newest</option><option>Most Downloaded</option><option>Highest Rated</option><option>Most Liked</option><option>Most Collected</option></select>
      <label><input type="checkbox" data-k="cbase"> ${esc(T("このモデルに関係のあるものだけ"))}</label>
      <label><input type="checkbox" data-k="cnsfw"> ${esc(T("成人向けも表示"))}</label><button type="button" class="pri" data-a="search">${esc(T("検索"))}</button></div>
    <div class="grid" data-k="cgrid"></div>
    <div class="bar"><button type="button" data-a="more" class="hide">${esc(T("さらに読み込む"))}</button></div>
  </div>
</div>`;

/**
 * @param {object} o
 * @param {object} o.api               ComfyUI の api(fetchApi / apiURL)
 * @param {string} o.current           この行で今選んでいる LoRA のファイル名(無ければ "")
 * @param {Set<string>} o.used         ほかの行で使っている LoRA のファイル名
 * @param {(name:string)=>Promise<void>} o.onPick   選んだとき(この行を、そのファイルにする)
 * @param {()=>Promise<void>} o.onChoicesChanged    ファイルが増えたとき(ComfyUI の一覧を読み直す)
 * @param {(msg:string, kind?:string)=>void} o.notify
 * @param {string} o.model             モデルの種類(絞り込みの初期値に使う)
 * @param {string} o.noneValue         「LoRA を外す」で onPick に渡す値
 */
export async function openLoraExplorer({ api, current = "", used = new Set(), onPick, onChoicesChanged, notify, model = "", noneValue = "(none)" }) {
  ensureCss();
  document.getElementById("cca-lorax")?.remove(); // 開くたびに作り直す(前の状態を持ち越さない)
  const m = document.createElement("div");
  m.id = "cca-lorax";
  m.innerHTML = template();
  document.body.appendChild(m);
  const $ = (sel) => m.querySelector(sel);
  const K = (k) => m.querySelector(`[data-k="${k}"]`);
  const close = () => { try { saveView(); } catch { /* 準備の途中で閉じたときは保存しない */ } m.remove(); };
  const box = $(".box");
  m.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Escape") return;
    const inf = box.querySelector(".info");
    if (inf) inf.remove(); else close();
  });
  let downOutside = false; // 外(暗い所)を押したら閉じる。中から外へドラッグして離したときは閉じない
  m.addEventListener("mousedown", (e) => { downOutside = e.target === m; });
  m.addEventListener("click", (e) => { if (e.target === m && downOutside) close(); });
  $('[data-a="close"]').onclick = close;
  m.tabIndex = -1;
  m.focus();

  const size = K("size");
  size.value = cardW;
  const setCols = () => { for (const g of m.querySelectorAll(".grid")) g.style.setProperty("grid-template-columns", `repeat(auto-fill,minmax(${cardW}px,1fr))`, "important"); };
  setCols();
  size.oninput = () => { cardW = Number(size.value); setCols(); };

  const call = async (url, body) => {
    const r = await api.fetchApi(url, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch { /* 返事が空 */ }
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  const pick = async (name) => {
    close();
    try { await onPick(name); } catch (e) { notify(T("LoRA を切り替えられませんでした: {0}", e.message), "error"); }
  };
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => notify(T("コピーしました"), "info"), () => {});

  // ---------------- 詳細(右上の i) ----------------
  // 画面いっぱいの枠の上に重ねる。中身は build(本体, 閉じる) が作る
  const openInfo = (title, img, build) => {
    box.querySelector(".info")?.remove();
    const el = document.createElement("div");
    el.className = "info";
    el.innerHTML = `<div class="pn"><div class="ph"><b>${esc(title)}</b><button type="button" data-a="x">${esc(T("閉じる"))}</button></div>
      <div class="pb"><div class="im">${img ? `<img referrerpolicy="no-referrer" src="${esc(img)}">` : `<div class="none">${esc(T("画像なし"))}</div>`}</div><div class="tx"></div></div></div>`;
    box.appendChild(el);
    const x = () => el.remove();
    el.querySelector('[data-a="x"]').onclick = x;
    el.addEventListener("mousedown", (e) => { el._d = e.target === el; });
    el.addEventListener("click", (e) => { if (e.target === el && el._d) x(); });
    build(el.querySelector(".tx"), x);
  };

  // ---------------- タブ ----------------
  const cnt = $(".cnt");
  let civitaiStarted = false;
  const setTab = (t) => {
    mem.tab = t;
    for (const b of m.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === t);
    for (const p of m.querySelectorAll(".pane")) p.classList.toggle("hide", p.dataset.pane !== t);
    cnt.textContent = "";
    if (t === "local") { drawLocal(); restoreScroll(lgrid, mem.sl); }
    if (t === "civitai") { if (!civitaiStarted) { civitaiStarted = true; startCivitai(); } else { drawCivitai(); restoreScroll(cgrid, mem.sc); } } // ここで、はじめてネットに接続する
  };
  for (const b of m.querySelectorAll(".tabs button")) b.onclick = () => setTab(b.dataset.tab);

  // ---------------- ローカル ----------------
  const lgrid = K("lgrid"), lq = K("lq"), dirsEl = K("dirs");
  const hint = hintOf(model), mk = String(model || "").replace(/ Turbo$/, "");
  const mem = MEM[mk] || (MEM[mk] = { lq: hint.w || "", folder: "*", cq: "", csort: "Newest", cbase: true, cnsfw: false, tab: "local", sl: 0, sc: 0 });
  // 閉じて開き直したとき、前回のタブと一覧の位置に戻す
  const shownNow = (g) => !g.closest(".pane")?.classList.contains("hide");
  const saveView = () => { if (shownNow(lgrid)) mem.sl = lgrid.scrollTop; if (shownNow(K("cgrid"))) mem.sc = K("cgrid").scrollTop; };
  const restoreScroll = (g, y) => requestAnimationFrame(() => { g.scrollTop = y || 0; });
  lq.value = mem.lq;
  let items = [], folder = mem.folder;
  const byName = (a, b) => split(a.name)[1].localeCompare(split(b.name)[1], "ja", { numeric: true, sensitivity: "base" }); // abc・あいうえお順
  const split = (name) => { const i = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")); return i < 0 ? ["", name] : [name.slice(0, i), name.slice(i + 1)]; };
  const previewUrl = (name) => api.apiURL("/cca_generator/lora_preview?name=" + encodeURIComponent(name));
  const drawDirs = () => {
    const dirs = [...new Set(items.map((it) => split(it.name)[0]))].sort();
    dirsEl.innerHTML = dirs.length > 1 ? [["*", T("すべて")], ...dirs.map((d) => [d, d || T("(直下)")])]
      .map(([v, l]) => `<button type="button" data-d="${esc(v)}" class="${v === folder ? "on" : ""}">${esc(l)}</button>`).join("") : "";
  };
  const drawLocal = () => {
    const words = lq.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((it) => (folder === "*" || split(it.name)[0] === folder) && words.every((w) => it.name.toLowerCase().includes(w)));
    if (!$('[data-pane="local"]').classList.contains("hide")) cnt.textContent = T("{0} / {1} 件", shown.length, items.length);
    const clr = `<div class="lx clr" data-clear="1" title="${esc(T("LoRA を外します"))}"><div class="none"><span style="font-size:28px">✕</span><span>${esc(T("LoRA を外す"))}</span></div></div>`;
    lgrid.innerHTML = clr + (shown.length ? shown.map((it) => {
      const [dir, base] = split(it.name);
      const cur = it.name === current, usedElsewhere = !cur && used.has(it.name);
      const img = it.preview ? `<img loading="lazy" src="${esc(previewUrl(it.name))}">` : `<div class="none">${esc(T("画像なし"))}</div>`;
      const badge = cur ? T("選択中") : usedElsewhere ? T("他で使用中") : "";
      return `<div class="lx${cur ? " cur" : ""}" data-name="${esc(it.name)}" title="${esc(it.name)}">${img}${badge ? `<span class="badge">${esc(badge)}</span>` : ""}<button type="button" class="i" data-info="1" title="${esc(T("詳細"))}">i</button><div class="cap"><div class="nm">${esc(base.replace(/\.[^.]+$/, ""))}</div><div class="dr">${esc(dir)}</div></div></div>`;
    }).join("") : `<div class="hint">${esc(T("該当する LoRA がありません"))}</div>`);
  };
  const showLocalInfo = (name) => {
    const it = items.find((x) => x.name === name);
    openInfo(split(name)[1], it?.preview ? previewUrl(name) : "", async (tx, x) => {
      tx.innerHTML = `<div class="hint">${esc(T("読み込んでいます…"))}</div>`;
      let d;
      try { d = await call("/cca_generator/lora_info?name=" + encodeURIComponent(name)); } catch (e) { tx.innerHTML = `<div class="warn">${esc(T("詳細を読み込めませんでした: {0}", e.message))}</div>`; return; }
      const rows = [[T("ファイル"), d.path || name], [T("大きさ"), fmtMB(d.size)], [T("更新日"), new Date(d.mtime * 1000).toLocaleString()],
        ...(d.base ? [[T("ベースモデル"), d.base]] : []), ...d.meta.map(([k, v]) => [T(k), v]), ...(d.weight ? [[T("おすすめの強度"), d.weight]] : [])];
      tx.innerHTML = `<div class="kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join("")}</div>
        ${d.words ? `<div><div class="hint">${esc(T("トリガーワード"))}</div><div class="box2">${esc(d.words)}</div><div class="row" style="margin-top:6px"><button type="button" data-a="cpw">${esc(T("コピー"))}</button></div></div>` : ""}
        ${d.tags.length ? `<div><div class="hint">${esc(T("学習に使われたタグ(多い順・押すとコピー)"))}</div><div class="tg">${d.tags.map(([t, c]) => `<span data-t="${esc(t)}">${esc(t)} <small>${c}</small></span>`).join("")}</div></div>` : ""}
        ${d.description ? `<div><div class="hint">${esc(T("説明"))}</div><div class="box2">${esc(d.description)}</div></div>` : ""}
        ${d.notes ? `<div><div class="hint">${esc(T("メモ"))}</div><div class="box2">${esc(d.notes)}</div></div>` : ""}
        ${!d.meta.length && !d.words && !d.tags.length && !d.description ? `<div class="hint">${esc(T("このファイルには、ファイルの大きさのほかに表示できる情報がありません"))}</div>` : ""}
        <div class="row"><button type="button" class="pri" data-a="use">${esc(T("これを使う"))}</button><span style="flex:1"></span><button type="button" data-a="del">${esc(T("LoRA を削除する"))}</button></div>`;
      tx.querySelector('[data-a="cpw"]')?.addEventListener("click", () => copy(d.words));
      tx.querySelector(".tg")?.addEventListener("click", (e) => { const s = e.target.closest("[data-t]"); if (s) copy(s.dataset.t); });
      tx.querySelector('[data-a="use"]').onclick = () => { x(); pick(name); };
      tx.querySelector('[data-a="del"]').onclick = async () => {
        if (!confirm(T("次の LoRA のファイルを削除します。元に戻せません。よろしいですか?\n{0}", d.path || name))) return;
        try {
          await call("/cca_generator/lora_delete", { name });
          x();
          try { await onChoicesChanged(); } catch { /* 読み直せなくても一覧は更新する */ }
          await loadLocal();
          notify(T("削除しました"), "info");
        } catch (e) { notify(T("削除できませんでした: {0}", e.message), "error"); }
      };
    });
  };
  lgrid.onclick = (e) => {
    const c = e.target.closest(".lx");
    if (!c) return;
    if (c.dataset.clear) { pick(noneValue); return; }
    if (e.target.closest("[data-info]")) showLocalInfo(c.dataset.name); else pick(c.dataset.name);
  };
  dirsEl.onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) { folder = mem.folder = b.dataset.d; drawDirs(); drawLocal(); } };
  lq.oninput = () => { mem.lq = lq.value; drawLocal(); };
  const loadLocal = async () => {
    try {
      items = ((await call("/cca_generator/loras")).items || []).sort(byName);
    } catch (e) {
      lgrid.innerHTML = `<div class="warn">${esc(T("LoRA の一覧を読み込めませんでした: {0}", e.message))}</div>`;
      return;
    }
    if (folder !== "*" && !items.some((it) => split(it.name)[0] === folder)) folder = mem.folder = "*";
    if (!mem.touched && lq.value && !items.some((it) => lq.value.toLowerCase().split(/\s+/).filter(Boolean).every((w) => it.name.toLowerCase().includes(w)))) { lq.value = mem.lq = ""; } // 初期の言葉に合うものが 1 つも無いときは、絞り込まない
    mem.touched = true;
    drawDirs();
    drawLocal();
  };
  $('[data-a="reload"]').onclick = async () => { try { await onChoicesChanged(); } catch { /* 読み直せなくても一覧は出す */ } await loadLocal(); };
  await loadLocal();
  restoreScroll(lgrid, mem.sl);
  lq.focus();

  // ---------------- Civitai ----------------
  const loginBox = K("login"), cq = K("cq"), csort = K("csort"), cnsfw = K("cnsfw"), cgrid = K("cgrid"), more = $('[data-a="more"]');
  const cv = { items: [], next: "", busy: false };
  cq.value = mem.cq; csort.value = mem.csort; cnsfw.checked = mem.cnsfw; K("cbase").checked = mem.cbase;
  K("cbase").closest("label").classList.toggle("hide", !hint.b && !hint.k);

  const drawLogin = (st) => {
    loginBox.innerHTML = st.loggedIn
      ? `<span>${esc(T("ログイン中: {0}", st.username || T("(名前不明)")))}</span><button type="button" data-a="logout">${esc(T("ログアウト"))}</button>`
      : `<input type="password" data-k="key" placeholder="${esc(T("Civitai の API キー"))}" autocomplete="off" spellcheck="false"><button type="button" class="pri" data-a="login">${esc(T("ログイン"))}</button>
         <span class="hint">${esc(T("ログインしなくても、探して取得できます。ログインが必要なモデルや成人向けの表示には、API キーが要ります。キーは、このパソコンの ComfyUI の中にだけ保存されます。"))} <a href="https://civitai.com/user/account" target="_blank" rel="noopener">${esc(T("API キーの作り方(Civitai のアカウント設定)"))}</a></span>`;
    const keyEl = loginBox.querySelector('[data-k="key"]');
    loginBox.querySelector('[data-a="login"]')?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        drawLogin(await call("/cca_generator/civitai/login", { key: keyEl.value }));
        search(true);
      } catch (err) { notify(T("ログインできませんでした: {0}", err.message), "error"); b.disabled = false; }
    });
    keyEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBox.querySelector('[data-a="login"]').click(); });
    loginBox.querySelector('[data-a="logout"]')?.addEventListener("click", async () => {
      try { drawLogin(await call("/cca_generator/civitai/logout", {})); search(true); } catch (err) { notify(T("ログアウトできませんでした: {0}", err.message), "error"); }
    });
  };

  const drawCivitai = () => {
    cgrid.innerHTML = cv.items.length ? cv.items.map((it, i) => {
      const v = it.versions[0];
      const img = v.image ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(v.image)}">` : `<div class="none">${esc(T("画像なし"))}</div>`;
      return `<div class="lx" data-i="${i}" title="${esc(it.name)}">${img}${it.versions.some((x) => x.local) ? `<span class="badge">${esc(T("取得済み"))}</span>` : ""}<button type="button" class="i" data-info="1" title="${esc(T("詳細"))}">i</button><div class="cap"><div class="nm">${esc(it.name)}</div><div class="dr">${esc(it.creator)}${v.base ? " · " + esc(v.base) : ""} · ↓${Number(it.downloads).toLocaleString()}</div></div></div>`;
    }).join("") : `<div class="hint">${esc(T("該当する LoRA がありません"))}</div>`;
    more.classList.toggle("hide", !cv.next);
    if (!$('[data-pane="civitai"]').classList.contains("hide")) cnt.textContent = cv.items.length ? T("{0} 件", cv.items.length) : "";
  };

  const showCivitaiInfo = (it) => {
    openInfo(it.name, it.versions[0].image, (tx, x) => {
      tx.innerHTML = `<div class="row"><a href="https://civitai.com/models/${esc(it.id)}" target="_blank" rel="noopener">${esc(T("Civitai のページを開く"))} ↗</a><span class="hint">${esc(it.creator)} · ↓${Number(it.downloads).toLocaleString()}</span></div>
        <div class="row"><select data-k="ver">${it.versions.map((v, i) => `<option value="${i}">${esc(v.name || T("(版)"))}${v.base ? " · " + esc(v.base) : ""}${v.sizeKB ? " · " + fmtMB(v.sizeKB * 1024) : ""}${v.local ? T("(取得済み)") : ""}</option>`).join("")}</select><span class="hint" data-k="fn"></span></div>
        <div data-k="words"></div>
        <div class="row"><button type="button" class="pri" data-a="act"></button><span class="hint" data-k="prog"></span></div>`;
      const ver = tx.querySelector('[data-k="ver"]'), act = tx.querySelector('[data-a="act"]'), prog = tx.querySelector('[data-k="prog"]');
      let v = it.versions[0];
      const sync = () => {
        v = it.versions[Number(ver.value)];
        tx.querySelector('[data-k="fn"]').textContent = v.file || "";
        const w = tx.querySelector('[data-k="words"]');
        w.innerHTML = v.words.length ? `<div class="hint">${esc(T("トリガーワード"))}</div><div class="box2">${esc(v.words.join(", "))}</div><div class="row" style="margin-top:6px"><button type="button" data-a="cp">${esc(T("コピー"))}</button></div>` : `<div class="hint">${esc(T("トリガーワード"))}: ${esc(T("(登録なし)"))}</div>`;
        w.querySelector('[data-a="cp"]')?.addEventListener("click", () => copy(v.words.join(", ")));
        act.textContent = v.local ? T("これを使う(取得済み)") : T("ダウンロードして使う");
      };
      ver.onchange = sync;
      sync();
      act.onclick = async () => {
        if (v.local) { x(); pick(v.local); return; }
        act.disabled = true;
        prog.textContent = T("開始しています…");
        try {
          const { job } = await call("/cca_generator/civitai/download", { versionId: v.id, image: v.image || "", words: v.words, base: v.base || "", title: it.name });
          for (;;) {
            await sleep(700);
            if (!m.isConnected) return; // 閉じられた(ダウンロードは、そのまま続く)
            const p = await call(`/cca_generator/civitai/progress?job=${encodeURIComponent(job)}`);
            if (p.state === "error") throw new Error(p.error);
            if (p.state === "done") { await onChoicesChanged(); prog.textContent = T("完了"); await pick(p.name); return; }
            prog.textContent = `${p.name || ""} ${fmtMB(p.received)}${p.total ? " / " + fmtMB(p.total) : ""}`;
          }
        } catch (e) {
          prog.textContent = "";
          act.disabled = false;
          notify(T("ダウンロードできませんでした: {0}", e.message), "error");
        }
      };
    });
  };

  const cacheKey = () => JSON.stringify([cq.value.trim(), csort.value, cnsfw.checked, K("cbase").checked]);
  const search = async (reset) => {
    if (cv.busy) return;
    cv.busy = true;
    if (reset) { cv.items = []; cv.next = ""; cgrid.innerHTML = `<div class="hint">${esc(T("Civitai に接続しています…"))}</div>`; more.classList.add("hide"); }
    try {
      Object.assign(mem, { cq: cq.value, csort: csort.value, cnsfw: cnsfw.checked, cbase: K("cbase").checked });
      const own = K("cbase").checked;
      const ckey = cacheKey();
      const qs = new URLSearchParams({ q: [own && !hint.b ? hint.k : "", cq.value.trim()].filter(Boolean).join(" "), sort: csort.value, nsfw: cnsfw.checked ? "1" : "0" });
      if (own && hint.b) qs.set("bases", hint.b.join("|"));
      if (!reset && cv.next) qs.set("cursor", cv.next);
      const j = await call(`/cca_generator/civitai/search?${qs}`);
      cv.items = reset ? j.items : cv.items.concat(j.items);
      cv.next = j.next || "";
      mem.cache = { key: ckey, items: cv.items, next: cv.next }; // 閉じて開き直しても、同じ検索はネットに繋がずに出す
      drawCivitai();
    } catch (e) {
      if (reset) cgrid.innerHTML = `<div class="warn">${esc(T("Civitai から取得できませんでした: {0}", e.message))}</div>`;
      else notify(T("続きを取得できませんでした: {0}", e.message), "error");
    } finally { cv.busy = false; }
  };
  cgrid.onclick = (e) => { const c = e.target.closest(".lx"); if (c) showCivitaiInfo(cv.items[Number(c.dataset.i)]); };
  $('[data-a="search"]').onclick = () => search(true);
  cq.addEventListener("keydown", (e) => { if (e.key === "Enter") search(true); });
  csort.onchange = () => search(true);
  cnsfw.onchange = () => search(true);
  K("cbase").onchange = () => search(true);
  more.onclick = () => search(false);

  async function startCivitai() {
    try { drawLogin(await call("/cca_generator/civitai/status")); } catch { drawLogin({ loggedIn: false }); }
    if (mem.cache && mem.cache.key === cacheKey()) { cv.items = mem.cache.items; cv.next = mem.cache.next; drawCivitai(); restoreScroll(cgrid, mem.sc); return; }
    search(true);
  }
  if (mem.tab === "civitai") setTab("civitai");
}
