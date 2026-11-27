// CCA Generator: モデルの選び方・ライセンスの画面
// - この種別のファイル: 種類(dev / distilled・bf16 / int8 / nvfp4 など)・向いている使い方・大きさ・ライセンス(商用の可否)・
//   この PC に入っているか。入っていれば「これを使う」、無ければ入手先へ
// - 全種別のライセンス: 種別を選ぶ前に、商用で使えるかを見比べる
// - 用語: bf16 / int8 / nvfp4 / dev / distilled など
// データはサーバーの spec.model_guide(model_guide.py)。生成パネル(cca_ui.js)から openModelGuide() で開く。

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BADGE = { ok: "商用可", cond: "条件付き", out: "生成物のみ商用可", no: "非商用のみ", unknown: "不明" };
const FIELD_LABEL = {
  unet_name: "拡散モデル", ckpt_name: "チェックポイント", clip_name: "テキストエンコーダー", vae_name: "VAE",
  wan_high_unet: "拡散モデル(High-Noise)", wan_low_unet: "拡散モデル(Low-Noise)", turbo_lora_name: "Turbo LoRA",
  // 第42版: 声・音楽(追加ノードが初めて使うときに自動でダウンロードするもの)と ACE-Step の言語モデル
  clip_name_2: "テキストエンコーダー 2・言語モデル(LM)", tts_model: "声のモデル(自動でダウンロード)",
  lipsync_model: "リップシンクのモデル(自動でダウンロード)", rvc_model: "RVC の部品(自動でダウンロード)", music_model: "曲のモデル(自動でダウンロード)",
};
const LIST_OF = { unet_name: "unets", wan_high_unet: "unets", wan_low_unet: "unets", ckpt_name: "ckpts", clip_name: "clips",
  vae_name: "vaes", turbo_lora_name: "loras", clip_name_2: "clips" };

let ui = null;
let ctx = null;

function css() {
  if (document.getElementById("cca-mg-style")) return;
  const s = document.createElement("style");
  s.id = "cca-mg-style";
  s.textContent = `
.cca-lic{display:inline-block;border-radius:4px;padding:0 7px;font-size:12px;font-weight:700;line-height:20px;white-space:nowrap}
.cca-lic.ok{background:#1f6f43;color:#e6fff0}.cca-lic.cond{background:#8a6d1a;color:#fff7dc}.cca-lic.out{background:#7a5a1f;color:#fff2dc}
.cca-lic.no{background:#8c2f2f;color:#ffe9e9}.cca-lic.unknown{background:#4a5160;color:#e4e7eb}
#cca-mg{position:fixed;inset:0;z-index:1004;background:#000b;display:none;align-items:center;justify-content:center;
  font:14px/1.55 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-mg.open{display:flex}
#cca-mg .win{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(1240px,calc(100vw - 32px));height:calc(100vh - 32px);display:flex;flex-direction:column}
#cca-mg .hd{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid #303744;flex-wrap:wrap}
#cca-mg .hd .sp{flex:1}
#cca-mg button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit;font-size:14px}
#cca-mg button.on{background:#2b8f84;border-color:#2b8f84;color:#fff}
#cca-mg button.pri{background:#2b8f84;border-color:#2b8f84;color:#fff}
#cca-mg .bd{flex:1;overflow:auto;padding:12px 18px 18px}
#cca-mg .licbox{border:1px solid #303744;border-radius:8px;padding:10px 12px;margin:8px 0 12px;background:#151920}
#cca-mg .licbox .dt{white-space:pre-line;margin-top:2px}
#cca-mg h4{margin:16px 0 6px;font-size:16px;color:#9fe0d8}
#cca-mg table{border-collapse:collapse;width:100%}
#cca-mg th,#cca-mg td{border-bottom:1px solid #2a303b;padding:7px 8px;text-align:left;vertical-align:top}
#cca-mg th{color:#aab3bf;font-weight:600;font-size:13px;background:#151920;position:sticky;top:0}
#cca-mg td.fn{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;word-break:break-all;max-width:330px}
#cca-mg tr.cur td{background:#1d3a37}
#cca-mg tr.ng td{opacity:.6}
#cca-mg .tag{font-weight:700}
#cca-mg .star{color:#ffd54f}
#cca-mg .have{color:#7fe0a8;font-weight:700}
#cca-mg .miss{color:#aab3bf}
#cca-mg .how{margin-top:4px;padding:5px 7px;border-left:3px solid #4a5568;color:#c3cad5;font-size:11.5px;white-space:pre-line;word-break:break-all}
#cca-mg .other{display:block;color:#aab3bf;font-size:12px}
#cca-mg .ft{padding:8px 16px;border-top:1px solid #303744;color:#aab3bf;font-size:12.5px}
#cca-mg a{color:#7cc4ff}
#cca-mg dl{display:grid;grid-template-columns:200px 1fr;gap:6px 14px;margin:6px 0}
#cca-mg dt{font-weight:700}
`;
  document.head.appendChild(s);
}

export function licBadge(spec, key) {
  const l = spec?.model_guide?.licenses?.[key];
  if (!l) return "";
  return `<span class="cca-lic ${esc(l.commercial)}" title="${esc(l.name)}: ${esc(l.short)}">${esc(BADGE[l.commercial] || l.short)}</span>`;
}
export function ensureCss() { css(); }

function base(name) { return String(name || "").replace(/\\/g, "/").split("/").pop().toLowerCase(); }
function findInstalled(list, file) {
  const f = String(file).replace(/\\/g, "/").toLowerCase();
  return (list || []).find((x) => {
    const p = String(x).replace(/\\/g, "/").toLowerCase();
    return f.includes("/") ? p === f || p.endsWith("/" + f) : base(x) === f;
  });
}

function build() {
  css();
  ui = document.createElement("div");
  ui.id = "cca-mg";
  ui.tabIndex = -1;
  ui.innerHTML = `<div class="win"><div class="hd"><b class="ttl"></b>
      <button data-tab="files">この種別のファイル</button><button data-tab="all">全種別のライセンス</button><button data-tab="words">用語</button>
      <span class="sp"></span><button class="cl">閉じる</button></div>
    <div class="bd"></div><div class="ft"></div></div>`;
  document.body.appendChild(ui);
  ui.addEventListener("click", (e) => { if (e.target === ui) close(); });
  ui.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  ui.querySelector(".cl").onclick = () => close();
  for (const b of ui.querySelectorAll("[data-tab]")) b.onclick = () => { ctx.tab = b.dataset.tab; render(); };
}
function close() { ui?.classList.remove("open"); }

function licBox(spec, key, extra = "") {
  const l = spec.model_guide.licenses[key];
  if (!l) return "";
  return `<div class="licbox">${licBadge(spec, key)} <b>${esc(l.name)}</b> — ${esc(l.short)}<div class="dt">${esc(l.detail)}</div>`
    + `${l.url ? ` <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">ライセンスの本文</a>` : ""}${extra ? `<br>${esc(extra)}` : ""}</div>`;
}

function renderFiles() {
  const { spec, type, task, values } = ctx;
  const ti = spec.types_info[type] || {};
  const g = spec.model_guide.guides[ti.guide];
  if (!g) return '<p>この種別の案内はまだありません。</p>';
  const famTypes = Object.keys(spec.types_info).filter((t) => spec.types_info[t].guide === ti.guide && !spec.types_info[t].hidden);
  let html = `<p>今の種別: <b>${esc(type)}</b>(${esc(spec.task_labels?.[task] || task)})。公式に配布されているファイルです。★ はおすすめ、緑の行は今使っているファイルです。</p>`;
  html += licBox(spec, ti.license, g.note || "");
  if (famTypes.some((t) => spec.types_info[t].license !== ti.license)) {
    const others = famTypes.filter((t) => spec.types_info[t].license !== ti.license);
    html += `<p>同じ仲間でライセンスが違う種別: ${others.map((t) => `<b>${esc(t)}</b> ${licBadge(spec, spec.types_info[t].license)}`).join("、")}</p>`;
  }
  const rows = g.rows.filter((r) => !r.task || r.task === task);
  const groups = [];
  for (const r of rows) {
    let grp = groups.find((x) => x.field === r.field);
    if (!grp) groups.push(grp = { field: r.field, rows: [] });
    grp.rows.push(r);
  }
  for (const grp of groups) {
    html += `<h4>${esc(FIELD_LABEL[grp.field] || grp.field)}</h4><table><tr><th>種類</th><th>ファイル名</th><th>向いている使い方</th><th>大きさ</th><th>ライセンス</th><th>この PC</th><th></th></tr>`;
    for (const r of grp.rows) {
      const i = g.rows.indexOf(r);
      const lic = r.license || (r.types && r.types.every((t) => spec.types_info[t]) ? spec.types_info[r.types[0]].license : ti.license) || g.license;
      const placeholder = r.file.startsWith("(");
      const have = placeholder ? null : findInstalled(ti.lists?.[r.field] || spec.choices?.[LIST_OF[r.field]], r.file); // 種別だけの選択肢(SenseNova のモデル)
      const dl = ti.downloaded?.[r.file]; // 自動でダウンロードする選択肢(HF | …): true 済み / false まだ
      const cur = dl !== undefined ? values[r.field] === r.file && (!r.types || r.types.includes(type))
        : have && values[r.field] && base(values[r.field]) === base(have) && (!r.types || r.types.includes(type));
      const otherType = r.types && !r.types.includes(type) ? r.types[0] : null;
      const star = r.star && (!r.types || r.types.includes(type));
      let act = "";
      if (r.ok === false) act = '<span class="miss">このパネルでは向きません</span>';
      else if (placeholder) act = `<a href="${esc(r.src || g.source)}" target="_blank" rel="noopener noreferrer">探す</a>`;
      else if (have && !cur) act = `<button class="pri" data-use="${i}">${otherType ? `「${esc(otherType)}」にして使う` : "これを使う"}</button>`;
      else if (!have) act = `<a href="${esc(r.src || g.source)}" target="_blank" rel="noopener noreferrer">入手先</a>`;
      html += `<tr class="${cur ? "cur" : ""}${r.ok === false ? " ng" : ""}"><td><span class="tag">${star ? '<span class="star">★</span> ' : ""}${esc(r.tag)}</span>`
        + `${otherType ? `<span class="other">種別「${esc(r.types.join(" / "))}」用</span>` : ""}</td>`
        + `<td class="fn">${esc(r.file)}</td><td>${esc(r.use)}${r.how ? `<div class="how">${esc(r.how)}</div>` : ""}</td><td>${r.size ? `${r.size.toFixed(1)} GB` : ""}</td>`
        + `<td>${licBadge(spec, lic)}</td><td>${dl !== undefined ? (dl ? '<span class="have">✓ ダウンロード済み</span>' : '<span class="miss">未ダウンロード(生成すると自動で入る)</span>') + (cur ? '<br><span class="have">使用中</span>' : "")
          : placeholder ? "" : cur ? '<span class="have">使用中</span>' : have ? '<span class="have">✓ 入っている</span>' : '<span class="miss">入っていない</span>'}</td><td>${act}</td></tr>`;
    }
    html += "</table>";
  }
  html += `<p style="margin-top:12px">入手先から入れたら、パネルの一番上の 🔄 を押すと「この PC」に反映されます。入れる場所は各欄の ⓘ に出ます。</p>`;
  return html;
}

function renderAll() {
  const { spec } = ctx;
  let html = "<p>種別を選ぶ前に、商用で使えるかを見比べられます(公式のモデルのライセンス)。</p>";
  html += "<table><tr><th>種別</th><th>商用</th><th>ライセンス</th><th>要点</th></tr>";
  for (const t of spec.types) {
    const ti = spec.types_info[t];
    const l = spec.model_guide.licenses[ti.license] || {};
    const g = spec.model_guide.guides[ti.guide] || {};
    html += `<tr class="${t === ctx.type ? "cur" : ""}"><td><b>${esc(t)}</b></td><td>${licBadge(spec, ti.license)}</td><td>${esc(l.name || "")}</td>`
      + `<td>${esc(l.short || "")}${g.note ? `<br><span class="miss">${esc(g.note)}</span>` : ""}</td></tr>`;
  }
  html += "</table>";
  html += "<h4>ライセンスの要点</h4>";
  const used = [...new Set(spec.types.map((t) => spec.types_info[t].license).concat(["hunyuan"]))];
  for (const k of used) html += licBox(spec, k);
  return html;
}

function renderWords() {
  const { spec } = ctx;
  return `<p>ファイル名に付いている言葉の意味です。</p><dl>${spec.model_guide.glossary.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <h4>迷ったら</h4><p>★ の付いたファイル(おすすめ)を使ってください。VRAM が足りないときは int8 / fp8 か nvfp4(RTX 50 番台)、
    VRAM に余裕があって少しでもきれいにしたいときは bf16 / fp16 を選びます。</p>`;
}

function render() {
  for (const b of ui.querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === ctx.tab);
  const ti = ctx.spec.types_info[ctx.type] || {};
  ui.querySelector(".ttl").textContent = `モデルの選び方・ライセンス: ${ti.guide || ctx.type}`;
  const bd = ui.querySelector(".bd");
  bd.innerHTML = ctx.tab === "all" ? renderAll() : ctx.tab === "words" ? renderWords() : renderFiles();
  ui.querySelector(".ft").innerHTML = `ライセンスの要約は ${esc(ctx.spec.model_guide.checked)} 時点の配布ページとライセンス本文をもとにした目安です。`
    + "ライセンスは変わることがあります。仕事で使う前に、必ず配布元のライセンス本文で確認してください(法的な助言ではありません)。";
  const g = ctx.spec.model_guide.guides[ti.guide];
  for (const b of bd.querySelectorAll("[data-use]")) {
    b.onclick = async () => {
      const r = g.rows[Number(b.dataset.use)];
      const have = findInstalled(ctx.spec.choices?.[LIST_OF[r.field]], r.file);
      b.disabled = true;
      try {
        await ctx.onUse(r.field, have, r.types && !r.types.includes(ctx.type) ? r.types[0] : null);
        Object.assign(ctx, ctx.refresh());
        render();
      } finally { b.disabled = false; }
    };
  }
}

// opts: { spec, type, task, values: {欄: 値}, onUse(field, value, switchType), refresh() → {type, task, values}, tab }
export function openModelGuide(opts) {
  if (!ui) build();
  ctx = { tab: "files", ...opts };
  ui.classList.add("open");
  render();
  ui.querySelector(".bd").scrollTop = 0;
  ui.focus();
}
