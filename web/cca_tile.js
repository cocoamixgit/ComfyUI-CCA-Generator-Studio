// 第29版: 複数画像タイル生成
// 生成回数ぶん(または「文字を置き換えて作る」の数 × 生成回数)をキューに入れ、全部できたら横 × 縦に並べて
// 1 枚(またはページごと)にまとめる。まとめるのはサーバー(/cca_generator/tile。tile.py)。
// 第30版: 文字の置き換えは「まとめる」のチェックが無くても使える(キューに入れるだけで、1 枚ずつ保存。動画の種別でも使える)
// - 文字を置き換えて並べる(Prompt S/R と同じ書き方): 1 つ目の言葉をプロンプト・ネガティブから探し、2 つ目からの言葉に
//   置き換えた物もキューに入れる(1 つ目のままの 1 枚も作る)。同じ行は同じシードにする(言葉の違いだけを比べられるように)
// - キューに入れる中身は、送る直前に書き換える(api.queuePrompt を包む)。パネルの値は変えない
// - できたかどうかは ComfyUI の履歴(/history)で確かめる。ページを開き直しても続きからまとめる(localStorage に覚える)
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { T } from "./cca_i18n.js";

const LS = "cca_generator.tile";
const LS_JOBS = "cca_generator.tilejobs";
export const MAX_TILE = 400;
const DEF = {
  on: false, mode: "count", sr: "", labels: true, cols: 3, rows: 3, scale: 100, paging: "one",
  gap: 8, gapColor: "white", gapCustom: "#808080", bt: 0, bb: 0, bl: 0, br: 0, borderColor: "white", borderCustom: "#808080",
  format: "jpg", quality: 90, png: 6, name: "CCA_tile", batch: 1,
};
const COLORS = [["white", "白"], ["black", "黒"], ["transparent", "透明(PNG のときだけ)"], ["custom", "色を選ぶ"]];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 覚えなくても使える */ } };
const clamp = (v, lo, hi, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };

let ctx = null;
// 設定は画像用と動画用に分ける。保存の形: { 画像の設定…, video: { 動画の設定… } }(前の版の形は画像の設定として読む)
function split(v) {
  const o = v && typeof v === "object" ? v : {};
  const { video, ...image } = o;
  return { image: { ...DEF, ...image }, video: { ...DEF, ...(video && typeof video === "object" ? video : {}) } };
}
let sets = split(lsGet(LS, {}));
let kind = "image";
let cfg = sets.image;
let jobs = lsGet(LS_JOBS, []);
let timer = null;

// ---------------------------------------------------------------- 文字の置き換え(「,」で区切る。「,」を含む言葉は " で囲む)
// 空の言葉も 1 つの言葉(元の言葉を消す): 「a,,b」の真ん中・「a,」の最後・「a, ,b」・「""」。改行だけの空の行は数えない
export function parseSR(text) {
  const out = [];
  let cur = "", inQ = false, quoted = false, lastSep = false;
  const s = String(text || "");
  const push = (sep) => {
    const v = quoted ? cur : cur.trim();
    if (v !== "" || quoted || sep === ",") out.push(v);
    cur = ""; quoted = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    lastSep = false;
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c;
    } else if (c === '"' && !cur.trim() && !quoted) { inQ = true; quoted = true; cur = ""; }
    else if (c === "," || c === "\n") { push(c); lastSep = c === ","; }
    else if (!(quoted && /\s/.test(c))) cur += c;
  }
  if (cur !== "" || quoted || lastSep) push(lastSep ? "," : "");
  return out;
}
// 見出し・表示では、空の言葉は「(なし)」
export const srLabel = (x) => (x === "" ? T("(なし)") : x);
const replaceAll = (s, a, b) => String(s ?? "").split(a).join(b);

// ---------------------------------------------------------------- 画面
const colorSel = (key) => `<select data-tk="${key}Color">${COLORS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
  <input type="color" data-tk="${key}Custom" class="hide" title="色">`;
export function tileHtml(ib, ibox) {
  return `
      <section class="card" id="cca-sec-tile" data-sec="tile">
        <h3><span id="cca-tile-title">複数画像タイル生成</span> ${ib("tile")}</h3>${ibox("tile", "「生成」1 回で続けて作る数(生成回数)と作り方、できた画像を横 × 縦に並べて 1 枚(またはページごと)にまとめる設定です。文字の置き換えは、まとめなくても使えます。まとめた画像は 1 枚目の画像と同じフォルダに保存し、結果の一覧にも入ります。まとめる前の 1 枚ずつの画像もそのまま残ります。")}
        <div class="row" style="align-items:flex-end;gap:14px">
          <div class="f"><label class="l">生成回数</label><input type="number" id="cca-batch" min="1" max="100" step="1" value="1" style="width:90px"></div>
          <div class="f"><label class="l">作り方</label>
            <div class="seg" id="cca-tile-mode"><button data-tmode="count">そのまま作る</button><button data-tmode="sr">文字を置き換えて作る(Prompt S/R)</button></div></div>
        </div>
        <div class="tilebox hide" id="cca-tile-sr">
          <div class="f"><label class="l">置き換える言葉(「,」で区切ります。「,」を含む言葉は " で囲みます。空にすると元の言葉を消します)</label>
            <textarea data-tk="sr" rows="2" placeholder='on the beach, in a forest, "on a rooftop, at night"'></textarea></div>
          <div class="hint" id="cca-tile-srinfo" style="margin-top:4px"></div>
        </div>
        <label class="row" id="cca-tile-onrow" style="margin-top:10px"><input type="checkbox" data-tk="on"> <b>できた画像を 1 枚(タイル)にまとめる</b></label>
        <div class="tilebox hide" id="cca-tile-box"><div class="tprevwrap"><div class="tset">
          <div class="hint hide" id="cca-tile-srhint">文字の置き換えでは、言葉ごとに 1 組(生成回数ぶん)を下の横 × 縦で並べ、組を横に並べます(作る順は行ごと)。</div>
          <label class="row hide" id="cca-tile-labels"><input type="checkbox" data-tk="labels"> 置き換えた言葉を組の上に書く</label>
          <div class="tgrid" style="margin-top:10px">
            <div class="f"><label class="l">横に並べる数</label><input type="number" data-tk="cols" min="1" max="50"></div>
            <div class="f"><label class="l">縦に並べる数</label><input type="number" data-tk="rows" min="1" max="100"></div>
            <div class="f"><label class="l">並べる大きさ(%)</label><input type="number" data-tk="scale" min="10" max="100" step="5"></div>
            <div class="f" style="justify-content:flex-end"><button id="cca-tile-fill" title="生成回数を、横 × 縦(1 ページに入る数)にする">生成回数を 横 × 縦 にする</button></div>
          </div>
          <div class="f" style="margin-top:8px"><label class="l">横 × 縦に入りきらないとき</label>
            <div class="seg" id="cca-tile-paging"><button data-paging="one">1 枚に全部入れる(縦に伸ばす)</button><button data-paging="split">縦の数ごとに次のページにする</button></div></div>
          <div class="tline"><span class="tl">画像の間の余白</span><input type="number" data-tk="gap" min="0" max="1000"> px ${colorSel("gap")}</div>
          <div class="tline"><span class="tl">外側の枠</span>上 <input type="number" data-tk="bt" min="0" max="5000"> 下 <input type="number" data-tk="bb" min="0" max="5000">
            左 <input type="number" data-tk="bl" min="0" max="5000"> 右 <input type="number" data-tk="br" min="0" max="5000"> px ${colorSel("border")}</div>
          <div class="tline"><span class="tl">保存の形式</span><select data-tk="format"><option value="jpg">JPG</option><option value="png">PNG</option><option value="pdf">PDF(ページごとに 1 ページ)</option></select>
            <span data-show="jpg pdf">画質 <input type="number" data-tk="quality" min="1" max="100"> <span class="hint">(1〜100。高いほどきれい・ファイルは大きい)</span></span>
            <span data-show="png">圧縮 <input type="number" data-tk="png" min="0" max="9"> <span class="hint">(0〜9。大きいほどファイルは小さく、保存は遅い。画質はどれも同じ)</span></span>
          </div>
          <div class="tline"><span class="tl">ファイル名</span><input type="text" data-tk="name" style="width:200px"></div>
          </div>
          <div class="tprev" title="並び方のプレビュー(1 ページ目)。番号は作る順。余白・枠は実際の色(細い余白も見えるように太めに描きます)">
            <canvas id="cca-tile-prev" width="240" height="240"></canvas>
            <div class="hint" id="cca-tile-prevcap"></div>
          </div>
        </div></div>
        <div class="hint" id="cca-tile-sum" style="margin-top:8px"></div>
      </section>`;
}
export const TILE_CSS = `
#cca-ui .tilebox{margin-top:10px;padding:10px 12px;border:1px solid #3a4658;border-radius:8px;background:#151a21}
#cca-ui .tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 12px;align-items:end}
#cca-ui .tline{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
#cca-ui .tline .tl{min-width:110px;color:var(--muted)}
#cca-ui .tline input[type=number]{width:72px}
#cca-ui .tline input[type=color]{width:38px;height:28px;padding:0 2px}
#cca-ui .tline select{width:auto}
#cca-ui #cca-tile-sum,#cca-ui #cca-tile-srinfo{color:#fff;font-weight:700;font-size:13.5px}
#cca-ui #cca-tile-sum.bad,#cca-ui #cca-tile-srinfo.bad{color:var(--warn)}
#cca-ui .tprevwrap{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px;align-items:start}
#cca-ui .tprev{position:sticky;top:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border:1px solid #3a4658;border-radius:8px;background:#0e1115}
#cca-ui .tprev canvas{display:block;max-width:100%}
#cca-ui #cca-tile-prevcap{text-align:center;font-size:12.5px}
@container (max-width:640px){#cca-ui .tprevwrap{grid-template-columns:1fr}}
@media (max-width:1300px){#cca-ui .tprevwrap{grid-template-columns:1fr}#cca-ui .tprev{position:static}}
#cca-ui .tilejob{margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#cca-ui .tilejob button{padding:2px 8px}
`;

const $ = (s) => ctx.root.querySelector(s);
const $$ = (s) => [...ctx.root.querySelectorAll(s)];
// 第31版: 設定はサーバーに覚える(ブラウザが変わっても・書き出しにも入る)。ブラウザにも写しを置く
let saveTimer = null;
const packed = () => ({ ...sets.image, video: sets.video });
function save() {
  lsSet(LS, packed());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.fetchApi("/cca_generator/tile_settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: packed() }) })
      .catch(() => { /* 覚えられなくても使える */ });
  }, 400);
}
// サーバーの前回の設定を読む(無ければ、前の版のブラウザの設定をサーバーに移す)
async function loadSaved() {
  try {
    const j = await (await api.fetchApi("/cca_generator/tile_settings", { cache: "no-store" })).json();
    const v = j?.values && typeof j.values === "object" ? j.values : {};
    if (Object.keys(v).length) { sets = split(v); cfg = sets[kind]; } else if (Object.keys(lsGet(LS, {})).length) save();
  } catch { /* 読めなければブラウザの設定のまま */ }
  if (!ctx?.root) return;
  showSet();
  refreshTile();
}
// 今の設定(画像用 / 動画用)を欄に出す
function showSet() {
  fillFields();
  const b = ctx?.root?.querySelector("#cca-batch");
  if (b && document.activeElement !== b) b.value = clamp(cfg.batch, 1, 100, 1);
}
function readField(el) {
  const k = el.dataset.tk;
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") {
    const lim = { cols: [1, 50, 3], rows: [1, 100, 3], scale: [10, 100, 100], gap: [0, 1000, 0], bt: [0, 5000, 0], bb: [0, 5000, 0],
      bl: [0, 5000, 0], br: [0, 5000, 0], quality: [1, 100, 90], png: [0, 9, 6] }[k] || [0, 1e9, 0];
    return clamp(el.value, ...lim);
  }
  return el.value;
}
function fillFields() {
  for (const el of $$("[data-tk]")) {
    const v = cfg[el.dataset.tk];
    if (el.type === "checkbox") el.checked = !!v;
    else if (document.activeElement !== el) el.value = v ?? "";
  }
}

export function setupTile(c) {
  ctx = c;
  fillFields();
  for (const el of $$("[data-tk]")) {
    const ev = el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color" ? "change" : "input";
    el.addEventListener(ev, () => { cfg[el.dataset.tk] = readField(el); save(); refreshTile(); });
    if (el.type === "number") el.addEventListener("change", () => { el.value = cfg[el.dataset.tk]; });
  }
  for (const b of $$("[data-tmode]")) b.onclick = () => { cfg.mode = b.dataset.tmode; save(); refreshTile(); };
  for (const b of $$("[data-paging]")) b.onclick = () => { cfg.paging = b.dataset.paging; save(); refreshTile(); };
  // 生成回数も前回の設定として覚える
  const batch = $("#cca-batch");
  batch.value = clamp(cfg.batch, 1, 100, 1);
  batch.addEventListener("input", () => { cfg.batch = clamp(batch.value, 1, 100, 1); save(); refreshTile(); });
  batch.addEventListener("change", () => { batch.value = cfg.batch; });
  $("#cca-tile-fill").onclick = () => { batch.value = cfg.batch = Math.min(100, cfg.cols * cfg.rows); save(); refreshTile(); };
  // 設定の読み込み(⚙ 設定の書き出し / 読み込み)のあとは読み直す
  window.addEventListener("cca-settings-imported", () => loadSaved());
  refreshTile();
  renderJobs();
  loadSaved();
}

const batchCount = () => clamp(ctx?.root?.querySelector("#cca-batch")?.value, 1, 100, 1);
function isVideo() {
  const n = ctx?.node();
  if (!n) return false;
  return ctx.CCA.SPEC?.types_info?.[ctx.W(n, "model_type")?.value]?.kind === "video";
}
// まとめる(画像の種別でチェックが入っている)
export function tileCombine() { return !!cfg.on && !isVideo(); }
// 生成ボタンをこちらで受け持つか(まとめる、または文字を置き換えて作る)
export function tileActive() { return tileCombine() || cfg.mode === "sr"; }

// 並べ方の見込み(何枚・横 × 縦・何ページ・おおよその大きさ)
function plan() {
  const N = batchCount();
  const n = ctx.node();
  const sr = cfg.mode === "sr";
  const values = sr ? parseSR(cfg.sr) : [];
  const G = sr ? Math.max(1, values.length) : 1; // 組の数(文字の置き換えの言葉ごと)
  const total = G * N;
  const cols = Math.min(cfg.cols, N); // 1 組の横
  const rowsAll = Math.ceil(N / cols);
  const per = cfg.paging === "split" ? Math.min(cfg.rows, rowsAll) : rowsAll;
  const pages = Math.ceil(rowsAll / per);
  const sc = cfg.scale / 100;
  const cw = Math.round((Number(ctx.W(n, "width")?.value) || 1024) * sc), ch = Math.round((Number(ctx.W(n, "height")?.value) || 1024) * sc);
  const gw = cols * cw + (cols - 1) * cfg.gap; // 1 組の幅
  const ggap = G > 1 ? Math.max(cfg.gap * 3, 24) : 0; // 組の間(tile.py と同じ)
  const W = cfg.bl + cfg.br + G * gw + (G - 1) * ggap;
  const H = cfg.bt + cfg.bb + per * ch + (per - 1) * cfg.gap;
  return { N, values, G, total, cols, rowsAll, per, pages, W, H, cw, ch, gw, ggap };
}

export function refreshTile() {
  if (!ctx?.root) return;
  const video = isVideo();
  // 画像の種別と動画の種別を切り替えたら、それぞれの設定に入れ替える
  if ((video ? "video" : "image") !== kind) { kind = video ? "video" : "image"; cfg = sets[kind]; showSet(); }
  const combine = tileCombine();
  // 動画の種別では、まとめる(タイル)の部分は出さない(生成回数と作り方だけ)。項目の名前も「複数動画生成」
  $("#cca-tile-onrow").classList.toggle("hide", video);
  const title = $("#cca-tile-title");
  const name = video ? "複数動画生成" : "複数画像タイル生成";
  if (title && title.dataset.ccaLabel !== name) { title.dataset.ccaLabel = name; title.textContent = name; }
  $("#cca-tile-box").classList.toggle("hide", !combine);
  $("#cca-tile-labels").classList.toggle("hide", cfg.mode !== "sr");
  for (const b of $$("[data-tmode]")) b.classList.toggle("on", b.dataset.tmode === cfg.mode);
  for (const b of $$("[data-paging]")) b.classList.toggle("on", b.dataset.paging === cfg.paging);
  $("#cca-tile-sr").classList.toggle("hide", cfg.mode !== "sr");
  for (const k of ["gap", "border"]) {
    const sel = $(`[data-tk="${k}Color"]`);
    for (const o of sel.options) o.disabled = o.value === "transparent" && cfg.format !== "png";
    $(`[data-tk="${k}Custom"]`).classList.toggle("hide", cfg[`${k}Color`] !== "custom");
  }
  for (const el of $$("[data-show]")) el.classList.toggle("hide", !el.dataset.show.split(" ").includes(cfg.format));
  const p = plan();
  for (const el of [$('[data-tk="cols"]'), $('[data-tk="rows"]')]) {
    el.disabled = false;
    if (document.activeElement !== el) el.value = cfg[el.dataset.tk];
  }
  $("#cca-tile-srhint").classList.toggle("hide", cfg.mode !== "sr");
  // 文字の置き換えの知らせ
  const info = $("#cca-tile-srinfo");
  if (cfg.mode === "sr") {
    const n = ctx.node();
    const pos = String(ctx.W(n, "positive")?.value || ""), neg = String(ctx.W(n, "negative")?.value || "");
    const v = p.values;
    info.classList.remove("bad");
    if (v.length < 2) info.textContent = T("1 つ目の言葉をプロンプトから探して、2 つ目からの言葉に置き換えます(1 つ目のままの 1 枚も作ります)。言葉を 2 つ以上書いてください。");
    else if (v[0] === "") { info.textContent = T("⚠ 1 つ目は置き換える元の言葉です。空にできません"); info.classList.add("bad"); }
    else if (!pos.includes(v[0]) && !neg.includes(v[0])) { info.textContent = T("⚠ プロンプトに「{0}」がありません(置き換える所がありません)", v[0]); info.classList.add("bad"); }
    else info.textContent = T(isVideo() ? "「{0}」を {1} 通りに置き換えます: {2} × 生成回数 {3} = {4} 本生成予定" : "「{0}」を {1} 通りに置き換えます: {2} × 生成回数 {3} = {4} 枚生成予定",
      v[0], v.length, v.map((x) => T("「{0}」", srLabel(x))).join(" "), p.N, p.total);
  }
  // 生成ボタンの文字: 2 枚以上なら「〇枚生成」(動画は「〇本生成」)、1 枚なら「生成」
  // 日本語の文を入れ、訳は画面の自動の訳に任せる(言語を切り替えても元に戻せるように)。同じなら書き換えない
  const go = $("#cca-go");
  const label = p.total > 1 ? `${p.total} ${video ? "本" : "枚"}生成` : "生成";
  if (go && go.dataset.ccaLabel !== label) { go.dataset.ccaLabel = label; go.textContent = label; }
  // 見込みの行: 生成予定の枚数(文字の置き換えのときは上の行に出す)と、まとめるときの並び・溢れる枚数・大きさ
  const sum = $("#cca-tile-sum");
  const sr = cfg.mode === "sr";
  const many = p.total > MAX_TILE;
  const parts = [];
  if (!sr) parts.push(T(video ? "{0} 本生成予定" : "{0} 枚生成予定", p.total));
  let big = false;
  if (!combine) {
    if (sr && !video) parts.push(T("まとめ画像は作成されません。"));
  } else {
    // 決めた横 × 縦(文字の置き換えは 1 組 = 1 つの言葉の生成回数ぶん)
    const cap = cfg.cols * cfg.rows;
    const fmt = { jpg: "JPG", png: "PNG", pdf: "PDF" }[cfg.format];
    let t;
    if (p.N > cap) {
      t = sr ? T("言葉ごとに横 {0} × 縦 {1} = {2} 枚。1 組 {3} 枚溢れます", cfg.cols, cfg.rows, cap, p.N - cap)
        : T("横 {0} × 縦 {1} = {2} 枚。{3} 枚溢れます", cfg.cols, cfg.rows, cap, p.N - cap);
      t += cfg.paging === "split"
        ? T("(次のページへ。全部で {0} ページ{1})", p.pages, cfg.format === "pdf" ? T("・1 つのファイル") : T("・ページごとに 1 枚"))
        : sr ? T("(縦に伸ばして、言葉ごとに横 {0} × 縦 {1} にします)", p.cols, p.rowsAll)
          : T("(縦に伸ばして、横 {0} × 縦 {1} の 1 枚にします)", p.cols, p.rowsAll);
    } else {
      t = sr ? T("言葉ごとに横 {0} × 縦 {1} にして、{2} 組を横に並べた 1 枚にまとめます", p.cols, p.rowsAll, p.G)
        : T("横 {0} × 縦 {1} の 1 枚にまとめます", p.cols, p.rowsAll);
      const empty = p.cols * p.rowsAll - p.N;
      if (empty > 0) t += sr ? T("(1 組の空きが {0} マス)", empty) : T("(空きが {0} マス)", empty);
    }
    t += T("。{0}・1 ページ 約 {1} × {2} px", fmt, p.W, p.H);
    big = p.W > 65000 || p.H > 65000 || p.W * p.H > 150e6;
    if (big && !many) t += T("。⚠ 大きすぎてまとめられません。「縦の数ごとに次のページにする」か、並べる大きさ(%)を小さくしてください");
    parts.push(t);
  }
  if (many) parts.push(T(combine ? "⚠ まとめられるのは {0} 枚までです" : "⚠ 一度に作れるのは {0} 枚までです", MAX_TILE));
  sum.textContent = parts.join(T("。")).replace(/。。/g, "。");
  if (combine) drawPreview(p);
  sum.classList.toggle("hide", !parts.length);
  sum.classList.toggle("bad", big || many);
}

// ---------------------------------------------------------------- 並び方のプレビュー(1 ページ目を縮めて描く)
const COLOR_HEX = { white: "#ffffff", black: "#000000" };
function fillOf(g, key, x, y, w, h) {
  const v = cfg[`${key}Color`];
  if (v === "transparent" && cfg.format === "png") {
    // 透明は市松模様
    const s = 6;
    for (let yy = 0; yy < h; yy += s) for (let xx = 0; xx < w; xx += s) {
      g.fillStyle = ((xx + yy) / s) % 2 ? "#c9ced6" : "#eef0f3";
      g.fillRect(x + xx, y + yy, Math.min(s, w - xx), Math.min(s, h - yy));
    }
    return;
  }
  g.fillStyle = v === "custom" ? cfg[`${key}Custom`] : COLOR_HEX[v] || "#ffffff";
  g.fillRect(x, y, w, h);
}
function drawPreview(p) {
  const cv = ctx.root.querySelector("#cca-tile-prev");
  if (!cv) return;
  const sr = cfg.mode === "sr";
  const { cw, ch, G, cols, gw, ggap } = p;
  const rows = p.per;
  const labels = sr && cfg.labels ? p.values.slice(0, G).map(srLabel) : [];
  const px = Math.max(14, Math.min(120, Math.round(gw * 0.045)));
  const band = labels.length ? Math.round(px * 1.3) + Math.max(6, Math.floor(px / 2)) * 2 : 0;
  const W = p.W, H = p.H + band;
  const BOX = 230;
  // 余白・枠は縮めても見えるように 2px 以上(色が分かるように)、組の間は 5px 以上。マスは縦横比を保って残りに収める
  const k0 = Math.min(BOX / W, BOX / H);
  const th = (v, m = 2) => (v > 0 ? Math.max(m, v * k0) : 0);
  const bl = th(cfg.bl), br = th(cfg.br), bt = th(cfg.bt), bb = th(cfg.bb), gp = th(cfg.gap), gg = G > 1 ? th(ggap, 5) : 0;
  const bd = band ? Math.max(12, band * k0) : 0;
  const s = Math.max(0.0001, Math.min((BOX - bl - br - G * (cols - 1) * gp - (G - 1) * gg) / (G * cols * cw), (BOX - bt - bb - bd - (rows - 1) * gp) / (rows * ch)));
  const cwd = cw * s, chd = ch * s, gwd = cols * cwd + (cols - 1) * gp;
  const dw = Math.max(20, Math.round(bl + br + G * gwd + (G - 1) * gg)), dh = Math.max(20, Math.round(bt + bb + bd + rows * chd + (rows - 1) * gp));
  const dpr = window.devicePixelRatio || 1;
  cv.width = dw * dpr; cv.height = dh * dpr;
  cv.style.width = `${dw}px`; cv.style.height = `${dh}px`;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, dw, dh);
  fillOf(g, "border", 0, 0, dw, dh);
  fillOf(g, "gap", bl, bt + bd, dw - bl - br, dh - bt - bb - bd);
  const fs = Math.max(7, Math.min(14, Math.floor(Math.min(cwd, chd) * 0.35)));
  g.textAlign = "center"; g.textBaseline = "middle";
  for (let gi = 0; gi < G; gi++) {
    const gx = bl + gi * (gwd + gg);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c; // 組の中の何枚目
        if (k >= p.N) continue; // 空きのマスは余白の色のまま(出来上がりと同じ)
        const x = gx + c * (cwd + gp), y = bt + bd + r * (chd + gp);
        g.fillStyle = "#5b6b84";
        g.fillRect(x, y, cwd, chd);
        // 番号は作る順(文字の置き換えは行ごと: 各組の 1 枚目 → 各組の 2 枚目 …)
        const num = sr ? k * G + gi + 1 : k + 1;
        if (fs >= 8 && cwd > fs * 1.2 && chd > fs) { g.fillStyle = "#ffffff"; g.font = `700 ${fs}px system-ui,sans-serif`; g.fillText(String(num), x + cwd / 2, y + chd / 2); }
      }
    }
  }
  // 置き換えた言葉の帯(組の上)
  if (bd) {
    const dark = cfg.borderColor === "black" || (cfg.borderColor === "custom" && /^#[0-3]/.test(cfg.borderCustom));
    g.fillStyle = dark ? "#ffffff" : "#222222";
    g.font = `${Math.max(7, Math.min(11, bd * 0.5))}px system-ui,sans-serif`;
    labels.forEach((t, gi) => {
      const x = bl + gi * (gwd + gg) + gwd / 2;
      let s2 = t;
      while (s2.length > 1 && g.measureText(s2).width > gwd - 2) s2 = s2.slice(0, -1);
      g.fillText(s2 === t ? t : `${s2.slice(0, -1)}…`, x, bt + bd / 2);
    });
  }
  const cap2 = ctx.root.querySelector("#cca-tile-prevcap");
  const shape = G > 1 ? T("{0} 組 × 横 {1} × 縦 {2}", G, cols, rows) : T("横 {0} × 縦 {1}", cols, rows);
  cap2.textContent = p.pages > 1 ? T("1 ページ目(全部で {0} ページ)・{1}", p.pages, shape) : T("{0}・{1} × {2} px", shape, W, H);
}

// ---------------------------------------------------------------- キューに入れる
// transforms[i](output): i 件目に送る中身(API 形式)を書き換える。戻り値: キューに入った prompt_id の一覧
async function queueMany(transforms) {
  const ids = [];
  const orig = api.queuePrompt;
  let k = 0;
  api.queuePrompt = async function (number, data, ...rest) {
    const tf = transforms[k++];
    if (tf) tf(data?.output ?? data);
    const r = await orig.call(this, number, data, ...rest);
    if (r?.prompt_id) ids.push(r.prompt_id);
    return r;
  };
  try { await app.queuePrompt(0, transforms.length); } finally { api.queuePrompt = orig; }
  return ids;
}
function panelsIn(output) { return Object.values(output || {}).filter((x) => x?.class_type === "CCAGeneratorPanel"); }

// 画像・PDF に入れる、タイルの設定(PNGinfo から戻せる)
function tileInfo() { const { on, ...rest } = cfg; return { v: 1, ...rest }; }
// PNGinfo から: 画像に入っていたタイルの設定を戻す
export function applyTileSettings(o) {
  if (!o || typeof o !== "object") return false;
  const { v, video, on, ...rest } = o;
  const next = { ...cfg };
  for (const k of Object.keys(DEF)) if (k !== "on" && rest[k] !== undefined && typeof rest[k] === typeof DEF[k]) next[k] = rest[k];
  Object.assign(cfg, next, { on: true });
  save();
  if (ctx?.root) { fillFields(); refreshTile(); }
  return true;
}

// 生成ボタン(まとめるとき)。戻り値: true = 受け付けた
export async function tileGenerate() {
  const n = ctx.node();
  const p = plan();
  const combine = tileCombine();
  if (p.total > MAX_TILE) { ctx.notify(T(combine ? "まとめられるのは {0} 枚までです" : "一度に作れるのは {0} 枚までです", MAX_TILE), "error", $("#cca-go")); return false; }
  if (combine && (p.W > 65000 || p.H > 65000 || p.W * p.H > 150e6)) {
    ctx.notify(T("まとめた画像が大きすぎます。「縦の数ごとに次のページにする」か、並べる大きさ(%)を小さくしてください"), "error", $("#cca-go")); return false;
  }
  let transforms, labels = [];
  if (cfg.mode === "sr") {
    const v = p.values;
    const pos = String(ctx.W(n, "positive")?.value || ""), neg = String(ctx.W(n, "negative")?.value || "");
    if (v.length < 2) { ctx.notify(T("置き換える言葉を 2 つ以上書いてください(「,」で区切ります)"), "error", $("#cca-go")); return false; }
    if (v[0] === "") { ctx.notify(T("1 つ目は置き換える元の言葉です。空にできません"), "error", $("#cca-go")); return false; }
    if (!pos.includes(v[0]) && !neg.includes(v[0])) { ctx.notify(T("プロンプトに「{0}」がありません(置き換える所がありません)", v[0]), "error", $("#cca-go")); return false; }
    // 同じ行は同じシード(行ごとに、生成後のシードの決め方で進める)
    const mode = ctx.W(n, "control_after_generate")?.value || "randomize";
    let s = Number(ctx.W(n, "seed")?.value) || 0;
    const seeds = [];
    for (let i = 0; i < p.N; i++) {
      seeds.push(s);
      if (mode === "increment") s += 1;
      else if (mode === "decrement") s = Math.max(0, s - 1);
      else if (mode === "randomize") s = Math.floor(Math.random() * 2 ** 48);
    }
    transforms = [];
    for (let i = 0; i < p.N; i++) {
      for (const val of v) {
        transforms.push((out) => {
          for (const x of panelsIn(out)) {
            if (typeof x.inputs?.positive === "string") x.inputs.positive = replaceAll(x.inputs.positive, v[0], val);
            if (typeof x.inputs?.negative === "string") x.inputs.negative = replaceAll(x.inputs.negative, v[0], val);
            if (typeof x.inputs?.seed === "number" || typeof x.inputs?.seed === "string") x.inputs.seed = seeds[i];
          }
        });
      }
    }
    labels = cfg.labels ? v.map(srLabel) : [];
  } else transforms = Array.from({ length: p.N }, () => null);
  const ids = await queueMany(transforms);
  if (!ids.length) return false;
  if (!combine) return ids.length; // まとめない: キューに入れるだけ(1 枚ずつ保存)
  const saveIds = ctx.saveIds();
  const job = {
    id: Date.now(), ids, done: {}, mode: cfg.mode, saveIds, created: Date.now(),
    opts: {
      cols: p.cols, rows: cfg.rows, paging: cfg.paging, scale: cfg.scale, gap: cfg.gap, groups: p.G,
      gap_color: cfg.gapColor === "custom" ? cfg.gapCustom : cfg.gapColor,
      border: { top: cfg.bt, right: cfg.br, bottom: cfg.bb, left: cfg.bl },
      border_color: cfg.borderColor === "custom" ? cfg.borderCustom : cfg.borderColor,
      labels, format: cfg.format, quality: cfg.quality, png_compress: cfg.png, name: cfg.name,
      info: tileInfo(),
    },
  };
  jobs.push(job);
  saveJobs();
  renderJobs();
  startPolling();
  return ids.length;
}

// ---------------------------------------------------------------- できるのを待って、まとめる
function imagesOf(h, saveIds) {
  const outs = h?.outputs || {};
  let keys = Object.keys(outs).filter((k) => saveIds.includes(String(k)));
  if (!keys.length) keys = Object.keys(outs);
  const list = [];
  for (const k of keys) {
    for (const im of outs[k]?.images || []) {
      if ((im.type || "output") === "output" && /\.(png|jpe?g|webp)$/i.test(im.filename || "")) {
        list.push({ filename: im.filename, subfolder: im.subfolder || "", type: "output" });
      }
    }
  }
  return list;
}
const finished = (h) => {
  const st = h?.status;
  return !!h && (st?.completed || st?.status_str === "success" || st?.status_str === "error"
    || (st?.messages || []).some((m) => m[0] === "execution_interrupted" || m[0] === "execution_error"));
};
async function history1(pid) {
  try { return (await (await api.fetchApi(`/history/${encodeURIComponent(pid)}`, { cache: "no-store" })).json())?.[pid] || null; } catch { return null; }
}
async function queuedIds() {
  try {
    const q = await (await api.fetchApi("/queue", { cache: "no-store" })).json();
    return new Set([...(q.queue_running || []), ...(q.queue_pending || [])].map((x) => x[1]));
  } catch { return null; }
}
let polling = false;
async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    // ほかのタブでまとめ終わった・やめた物は外す(同じブラウザで 2 つ開いていても 2 回まとめない)
    const live = new Set(lsGet(LS_JOBS, []).map((j) => j.id));
    jobs = jobs.filter((j) => live.has(j.id));
    for (const job of [...jobs]) {
      // キューは前から順に動くので、まだの物の先頭から確かめる
      let q = null;
      for (const pid of job.ids) {
        if (pid in job.done) continue;
        let h = await history1(pid);
        if (!finished(h)) {
          q = q || (await queuedIds());
          if (!q || q.has(pid)) break;          // まだ順番待ち・作っている途中
          h = await history1(pid);               // ちょうど終わったところかもしれない
          if (!finished(h) && h === null) { job.done[pid] = null; continue; } // キューから取り消された
          if (!finished(h)) break;
        }
        job.done[pid] = imagesOf(h, job.saveIds);
      }
      saveJobs();
      if (job.ids.every((pid) => pid in job.done)) await finishJob(job);
    }
  } finally {
    polling = false;
    renderJobs();
    if (!jobs.length) stopPolling();
  }
}
// 覚えている一覧に、このタブの進み具合を書く(ほかのタブが足したジョブは残す)
function saveJobs() {
  const mine = new Map(jobs.map((j) => [j.id, j]));
  const all = lsGet(LS_JOBS, []).map((j) => mine.get(j.id) || j);
  for (const j of jobs) if (!all.some((x) => x.id === j.id)) all.push(j);
  lsSet(LS_JOBS, all);
}
function removeJob(job) {
  jobs = jobs.filter((j) => j !== job && j.id !== job.id);
  lsSet(LS_JOBS, lsGet(LS_JOBS, []).filter((j) => j.id !== job.id));
}
async function finishJob(job) {
  // ほかのタブが先にまとめた(一覧から消えた)ときは何もしない
  if (!lsGet(LS_JOBS, []).some((j) => j.id === job.id)) { jobs = jobs.filter((j) => j.id !== job.id); return; }
  removeJob(job);
  let images;
  if (job.mode === "sr") {
    // キューは行ごと(i 回目の言葉 1・言葉 2 …)。まとめるときは組(言葉)ごとに続けて並べる。できなかった所は空のマス
    const G = Math.max(1, job.opts.groups || 1), N = Math.ceil(job.ids.length / G);
    images = [];
    for (let gi = 0; gi < G; gi++) for (let i = 0; i < N; i++) { const pid = job.ids[i * G + gi]; images.push(pid ? (job.done[pid] || [])[0] || null : null); }
  }
  else images = job.ids.flatMap((pid) => job.done[pid] || []);
  if (!images.some(Boolean)) { ctx.notify(T("タイル: まとめる画像ができませんでした(中断・エラー・取り消し)"), "error"); return; }
  try {
    const r = await api.fetchApi("/cca_generator/tile", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images, opts: job.opts }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || r.status);
    const made = images.filter(Boolean).length;
    const tinfo = { count: made, pages: j.pages, width: j.width, height: j.height };
    if (j.format !== "pdf") for (const f of [...j.files].reverse()) ctx.addResult(f, { tile: tinfo });
    else for (const f of [...j.files].reverse()) { // PDF: 一覧には 1 ページ目の絵(thumb)を出し、押すと PDF を開く
      const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || "", type: f.type || "output" });
      ctx.addResult(f, { tile: tinfo, pdf: true, pdfUrl: api.apiURL(`/view?${q}`), ...(j.thumb ? { url: j.thumb } : {}) });
    }
    const where = j.files.map((f) => `${f.subfolder ? `${f.subfolder}/` : ""}${f.filename}`).join("\n");
    ctx.notify(T("タイルにまとめました({0} 枚 → {1} ページ・{2} × {3} px)", made, j.pages, j.width, j.height)
      + (made < images.length ? `\n${T("できなかった {0} 枚は空けています", images.length - made)}` : "") + `\n${where}`, "info", null,
    { sticky: true, file: j.files[0] });
  } catch (e) {
    ctx.notify(`${T("タイルにまとめられませんでした")}: ${e.message || e}`, "error");
  }
}
function startPolling() { if (!timer && jobs.length) timer = setInterval(pollOnce, 2000); }
function stopPolling() { if (timer) clearInterval(timer); timer = null; }
export function resumeTileJobs(c) {
  if (c) ctx = ctx || c;
  // 1 日より前の物(終わらないまま残った物)は捨てる
  jobs = lsGet(LS_JOBS, []).filter((j) => Date.now() - (j.created || 0) < 864e5 && Array.isArray(j.ids));
  lsSet(LS_JOBS, jobs);
  startPolling();
}
export function renderJobs() {
  const box = ctx?.root?.querySelector("#cca-tile-job");
  if (!box) return;
  box.classList.toggle("hide", !jobs.length);
  box.innerHTML = jobs.map((j, i) => {
    const done = j.ids.filter((pid) => pid in j.done).length;
    return `<div class="tilejob"><span>🧩 ${T("タイル: {0} / {1} 件できました。全部できたらまとめます", done, j.ids.length)}</span>`
      + `<button data-tjstop="${i}" title="${T("キューの生成はそのまま続きます(まとめるのだけやめます)")}">${T("まとめるのをやめる")}</button></div>`;
  }).join("");
  for (const b of box.querySelectorAll("[data-tjstop]")) b.onclick = () => { const j = jobs[Number(b.dataset.tjstop)]; if (j) removeJob(j); renderJobs(); };
}
