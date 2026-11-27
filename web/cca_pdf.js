// CCA Generator: PDF を画像にして取り込む(画像編集・動画編集で共通)
// - PDF の読み込みは pdf.js(Mozilla、Apache License 2.0。web/lib/pdfjs)。ブラウザの中で 1 ページずつ PNG にする
// - ページが 2 つ以上なら、入れるページと解像度を選ぶ画面を出す(single: 1 ページだけ選ぶ)
import { T } from "./cca_i18n.js";

const LIB = new URL("./lib/pdfjs/", import.meta.url).href;
let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(`${LIB}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${LIB}pdf.worker.min.mjs`;
  return pdfjs;
}
export const isPdf = (f) => !!f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
export const PDF_ACCEPT = ".pdf,application/pdf";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MAX_SIDE = 8192; // 1 ページの絵の長い辺の上限(px)
const DPI_KEY = "cca_generator.pdf_dpi";

// ページを canvas に描く(紙の白で塗ってから)
async function renderPage(doc, n, scale) {
  const page = await doc.getPage(n);
  let vp = page.getViewport({ scale });
  const k = Math.min(1, MAX_SIDE / Math.max(vp.width, vp.height));
  if (k < 1) vp = page.getViewport({ scale: scale * k });
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
  await page.render({ canvasContext: cv.getContext("2d"), viewport: vp, background: "#ffffff" }).promise;
  page.cleanup();
  return cv;
}
const toPng = (cv, name) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(new File([b], name, { type: "image/png" })) : rej(new Error(T("画像を作れませんでした")))), "image/png"));

const CSS = `
#cca-pdfpick{position:fixed;inset:0;z-index:1003;background:#0009;display:none;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#e4e7eb}
#cca-pdfpick.open{display:flex}
#cca-pdfpick .pb{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(860px,94vw);max-height:86vh;display:flex;flex-direction:column}
#cca-pdfpick .ph2{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid #303744}
#cca-pdfpick .ph2 b{margin-right:auto;word-break:break-all}
#cca-pdfpick .ft{border-top:1px solid #303744;border-bottom:0}
#cca-pdfpick button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 10px;cursor:pointer}
#cca-pdfpick button.pri{background:#2b8f84;border-color:#3db4a6;color:#fff}
#cca-pdfpick button:disabled{opacity:.5;cursor:default}
#cca-pdfpick select{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:4px 6px}
#cca-pdfpick .note{font-size:12.5px;color:#9fb0c2;padding:6px 12px 0}
#cca-pdfpick .grid{overflow-y:auto;padding:10px 12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
#cca-pdfpick .pg{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border:2px solid transparent;border-radius:8px;cursor:pointer;background:#0e1115}
#cca-pdfpick .pg.on{border-color:#3db4a6;background:#2b8f8422}
#cca-pdfpick .pg canvas{max-width:100%;height:auto;background:#fff;box-shadow:0 1px 4px #0008}
#cca-pdfpick .pg .th{width:100%;aspect-ratio:1/1.414;display:flex;align-items:center;justify-content:center}
#cca-pdfpick .pg .th canvas{max-height:100%}
#cca-pdfpick .pg span{font-size:12.5px}
`;
function ensureCss() {
  if (document.getElementById("cca-pdfpick-css")) return;
  const s = document.createElement("style");
  s.id = "cca-pdfpick-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}
const dialog = () => document.getElementById("cca-pdfpick");
export const isPdfPickOpen = () => !!dialog()?.classList.contains("open");
// 編集画面のキー操作より先に: PDF のページを選ぶ画面が開いていれば、編集画面には渡さない
export function pdfKey(e) {
  if (!isPdfPickOpen()) return false;
  e.stopPropagation();
  if (e.key === "Escape") { e.preventDefault(); dialog()?._close?.(null); }
  return true;
}

// ページを選ぶ画面。返り値 { pages: [番号…], dpi } / やめたら null
function pickPages(doc, name, single) {
  ensureCss();
  let m = dialog();
  if (!m) { m = document.createElement("div"); m.id = "cca-pdfpick"; document.body.appendChild(m); }
  let dpi = 150;
  try { const v = Number(localStorage.getItem(DPI_KEY)); if ([72, 150, 200, 300].includes(v)) dpi = v; } catch { /* 覚えていなくても使える */ }
  const n = doc.numPages;
  m.innerHTML = `<div class="pb"><div class="ph2"><b>${esc(T("PDF のページを選ぶ"))}: ${esc(name)}</b>
      <label>${esc(T("解像度"))} <select data-dpi>${[72, 150, 200, 300].map((d) => `<option value="${d}" ${d === dpi ? "selected" : ""}>${d} dpi</option>`).join("")}</select></label>
      ${single ? "" : `<button data-all>${esc(T("全部選ぶ"))}</button><button data-none>${esc(T("選ばない"))}</button>`}</div>
    <div class="note">${esc(T(single ? "入れるページを押してください。" : "入れるページを押して選んでください(選んだページを、1 ページずつ画像として入れます)。"))} ${esc(T("全 {0} ページ", n))}</div>
    <div class="grid" data-grid>${Array.from({ length: n }, (_, i) => `<div class="pg ${single ? "" : "on"}" data-p="${i + 1}"><div class="th"></div><span>${esc(T("{0} ページ", i + 1))}</span></div>`).join("")}</div>
    <div class="ph2 ft"><span data-cnt></span><span style="flex:1"></span><button data-x>${esc(T("やめる"))}</button>${single ? "" : `<button class="pri" data-ok>${esc(T("選んだページを入れる"))}</button>`}</div></div>`;
  const grid = m.querySelector("[data-grid]");
  const cnt = m.querySelector("[data-cnt]"), ok = m.querySelector("[data-ok]");
  const count = () => { const k = grid.querySelectorAll(".pg.on").length; if (cnt) cnt.textContent = single ? "" : T("{0} ページを選んでいます", k); if (ok) ok.disabled = !k; };
  count();
  // 小さな絵は見えているページから順に描く
  let stop = false;
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const p = Number(en.target.dataset.p);
      (async () => {
        try {
          const page = await doc.getPage(p);
          const vp0 = page.getViewport({ scale: 1 });
          const cv = await renderPage(doc, p, Math.min(2, 240 / Math.max(vp0.width, vp0.height)));
          if (!stop) en.target.querySelector(".th").replaceChildren(cv);
        } catch { /* 描けないページは番号だけ */ }
      })();
    }
  }, { root: grid, rootMargin: "200px 0px" });
  for (const el of grid.children) io.observe(el);
  return new Promise((resolve) => {
    const close = (v) => {
      stop = true; io.disconnect();
      m.classList.remove("open");
      m._close = null;
      resolve(v);
    };
    m._close = close;
    const result = (pages) => {
      const d = Number(m.querySelector("[data-dpi]").value) || 150;
      try { localStorage.setItem(DPI_KEY, String(d)); } catch { /* 覚えられなくても使える */ }
      close({ pages, dpi: d });
    };
    grid.onclick = (e) => {
      const pg = e.target.closest(".pg");
      if (!pg) return;
      if (single) { result([Number(pg.dataset.p)]); return; }
      pg.classList.toggle("on");
      count();
    };
    m.querySelector("[data-all]")?.addEventListener("click", () => { for (const x of grid.children) x.classList.add("on"); count(); });
    m.querySelector("[data-none]")?.addEventListener("click", () => { for (const x of grid.children) x.classList.remove("on"); count(); });
    ok?.addEventListener("click", () => result([...grid.querySelectorAll(".pg.on")].map((x) => Number(x.dataset.p))));
    m.querySelector("[data-x]").onclick = () => close(null);
    m.onclick = (e) => { if (e.target === m) close(null); };
    m.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(null); });
    m.classList.add("open");
    m.tabIndex = -1;
    m.focus();
  });
}

// PDF → ページごとの PNG(File)。やめたら []。single: 1 ページだけ選ぶ。busy(文字) で進み具合を知らせる(省略可)
export async function pdfToImages(file, { single = false, busy } = {}) {
  const P = await lib();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await P.getDocument({ data, cMapUrl: `${LIB}cmaps/`, cMapPacked: true, standardFontDataUrl: `${LIB}standard_fonts/`, isEvalSupported: false }).promise;
  try {
    const base = String(file.name || "pdf").replace(/\.pdf$/i, "") || "pdf";
    // 1 ページだけなら選ばずに(解像度は前に選んだもの)
    let pick = { pages: [1], dpi: 150 };
    if (doc.numPages > 1) pick = await pickPages(doc, file.name || "PDF", single);
    else { try { const v = Number(localStorage.getItem(DPI_KEY)); if ([72, 150, 200, 300].includes(v)) pick.dpi = v; } catch { /* なくてもよい */ } }
    if (!pick || !pick.pages.length) return [];
    const out = [];
    for (let i = 0; i < pick.pages.length; i++) {
      const p = pick.pages[i];
      busy?.(T("PDF を画像にしています… {0} / {1}", i + 1, pick.pages.length));
      const cv = await renderPage(doc, p, pick.dpi / 72);
      out.push(await toPng(cv, doc.numPages > 1 ? `${base}_p${p}.png` : `${base}.png`));
    }
    return out;
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------- 画像を PDF にする(画像編集の書き出し)
// canvas の絵を 1 ページに入れた PDF(Blob)。ページの大きさは 96 dpi(1px = 0.75pt)。
// quality 100 は劣化なし(Flate)、それより下は JPEG。透明な所があれば、透明度も入れる(SMask)
async function deflate(u8) {
  const cs = new CompressionStream("deflate");
  const out = new Response(new Blob([u8]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}
export async function canvasToPdf(cv, quality = 92) {
  const W = cv.width, H = cv.height;
  const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  let alpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; }
  let img, filter;
  if (quality >= 100) {
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2]; }
    img = await deflate(rgb); filter = "/FlateDecode";
  } else {
    // 透明な所の色はそのまま(透明度は SMask で付ける)、不透明にした写しを JPEG に
    const t = document.createElement("canvas");
    t.width = W; t.height = H;
    const tg = t.getContext("2d");
    const im = tg.createImageData(W, H);
    im.data.set(d);
    for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
    tg.putImageData(im, 0, 0);
    const b = await new Promise((res, rej) => t.toBlob((x) => (x ? res(x) : rej(new Error(T("画像を作れませんでした")))), "image/jpeg", Math.max(0.01, Math.min(1, quality / 100))));
    img = new Uint8Array(await b.arrayBuffer()); filter = "/DCTDecode";
  }
  let mask = null;
  if (alpha) {
    const a = new Uint8Array(W * H);
    for (let i = 3, j = 0; i < d.length; i += 4, j++) a[j] = d[i];
    mask = await deflate(a);
  }
  const pw = +(W * 0.75).toFixed(2), ph = +(H * 0.75).toFixed(2);
  const enc = new TextEncoder();
  const parts = [], offs = [];
  let len = 0;
  const push = (x) => { const u = typeof x === "string" ? enc.encode(x) : x; parts.push(u); len += u.length; };
  const obj = (n, head, stream) => {
    offs[n] = len;
    push(`${n} 0 obj\n${head}\n`);
    if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); }
    push("endobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const content = enc.encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter}${mask ? " /SMask 6 0 R" : ""} /Length ${img.length} >>`, img);
  obj(5, `<< /Length ${content.length} >>`, content);
  if (mask) obj(6, `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.length} >>`, mask);
  const n = mask ? 7 : 6, xref = len;
  push(`xref\n0 ${n}\n0000000000 65535 f \n`);
  for (let i = 1; i < n; i++) push(`${String(offs[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
