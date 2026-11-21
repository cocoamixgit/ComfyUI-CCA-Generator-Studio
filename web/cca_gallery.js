// CCA Generator: 生成結果の拡大表示とギャラリー一覧
// - 拡大表示: 画面いっぱいに表示。ホイールでカーソルの場所を中心に拡大・縮小、ドラッグで移動。
//   画像はクリック(または ✕・Esc・外側のクリック)で閉じる。動画はクリックで再生 / 停止(閉じるのは ✕・Esc・外側)。
//   ← → で前後の結果に移る
// - ギャラリー一覧: これまでの結果を大きめの一覧で表示。押すとその結果をパネルに表示する
// 生成パネル(cca_ui.js)から使う。このファイル単体では何も登録しない。

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function css() {
  if (document.getElementById("cca-gallery-style")) return;
  const s = document.createElement("style");
  s.id = "cca-gallery-style";
  s.textContent = `
#cca-zoom{position:fixed;inset:0;z-index:1003;background:#000e;display:none;overflow:hidden;user-select:none;touch-action:none;
  font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-zoom.open{display:block}
#cca-zoom .media{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;max-height:none;cursor:grab;box-shadow:0 0 40px #000}
#cca-zoom.dragging .media{cursor:grabbing}
#cca-zoom .x{position:absolute;right:16px;top:14px;width:44px;height:44px;border-radius:50%;border:1px solid #fff6;background:#000a;color:#fff;font-size:22px;cursor:pointer;z-index:2}
#cca-zoom .x:hover{background:#c0392b}
#cca-zoom .nav{position:absolute;top:50%;margin-top:-28px;width:44px;height:56px;border-radius:8px;border:1px solid #fff4;background:#0008;color:#fff;font-size:26px;cursor:pointer;z-index:2}
#cca-zoom .nav.p{left:12px}#cca-zoom .nav.n{right:12px}
#cca-zoom .nav[disabled]{opacity:.25;cursor:default}
#cca-zoom .tip{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:#000a;color:#d9dee5;border-radius:6px;padding:4px 12px;font-size:13px;z-index:2;white-space:nowrap}
#cca-zoom .pct{position:absolute;left:16px;top:18px;background:#000a;border-radius:6px;padding:3px 10px;font-size:13px;z-index:2}
#cca-zoom .play{position:absolute;left:50%;top:50%;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;background:#000a;display:none;z-index:1;pointer-events:none}
#cca-zoom .play::after{content:"";position:absolute;left:33px;top:24px;border-left:28px solid #fff;border-top:18px solid transparent;border-bottom:18px solid transparent}
#cca-zoom.paused .play{display:block}
#cca-zoom .vc{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);width:min(960px,calc(100vw - 150px));display:none;gap:10px;align-items:center;
  background:#000c;border:1px solid #fff3;border-radius:8px;padding:8px 12px;z-index:3}
#cca-zoom.video .vc{display:flex}
#cca-zoom .vc button{background:#20252e;color:#fff;border:1px solid #3a4250;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:15px;min-width:40px}
#cca-zoom .vc .seek{flex:1;accent-color:#3db4a6}
#cca-zoom .vc .vol{width:90px;accent-color:#3db4a6}
#cca-zoom .vc .tm{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:13px}
#cca-gal{position:fixed;inset:0;z-index:1002;background:#000c;display:none;align-items:center;justify-content:center;
  font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-gal.open{display:flex}
#cca-gal .win{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(1400px,calc(100vw - 32px));height:calc(100vh - 32px);display:flex;flex-direction:column}
#cca-gal .hd{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #303744}
#cca-gal .hd .sp{flex:1}
#cca-gal button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit;font-size:14px}
#cca-gal .hd select{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 8px;font:inherit;font-size:14px}
#cca-gal .grid{flex:1;overflow:auto;padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;align-content:start}
#cca-gal .it{position:relative;border:1px solid #303744;border-radius:8px;overflow:hidden;background:#0b0d10;cursor:pointer;display:flex;flex-direction:column}
#cca-gal .it:hover{border-color:#3db4a6}
#cca-gal .it.on{border-color:#3db4a6;box-shadow:0 0 0 2px #3db4a6}
#cca-gal .th{position:relative;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:#0b0d10}
#cca-gal .th img,#cca-gal .th video{width:100%;height:100%;object-fit:contain;pointer-events:none}
#cca-gal .cap{font-size:12px;color:#b8c0cc;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cca-gal .zoom{position:absolute;right:6px;top:6px;padding:2px 8px;display:none;z-index:1}
#cca-gal .it:hover .zoom{display:block}
#cca-gal .none{color:#959eab;padding:20px}
.cca-vthumb{position:relative;width:100%;height:100%}
.cca-vthumb video{width:100%;height:100%;object-fit:cover;pointer-events:none;display:block}
.cca-vthumb::after{content:"";position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-35%,-50%);
  border-left:18px solid #fffd;border-top:11px solid transparent;border-bottom:11px solid transparent;filter:drop-shadow(0 0 3px #000)}
.cca-vthumb.big::after{border-left-width:30px;border-top-width:18px;border-bottom-width:18px}
`;
  document.head.appendChild(s);
}

// 動画のサムネイル: 最初の方のコマ + 三角のマーク(ブラウザが動画の頭だけ読む)
export function videoThumb(url, big = false) {
  css();
  return `<div class="cca-vthumb${big ? " big" : ""}"><video src="${esc(url)}#t=0.1" muted playsinline preload="metadata"></video></div>`;
}

// ---------------------------------------------------------------- 拡大表示
let zoom = null;
const zs = { items: [], i: 0, s: 1, x: 0, y: 0, fitS: 1, drag: null, el: null };

function buildZoom() {
  css();
  zoom = document.createElement("div");
  zoom.id = "cca-zoom";
  zoom.tabIndex = -1;
  zoom.innerHTML = `<div class="pct"></div><button class="x" title="閉じる(Esc)">✕</button>
    <button class="nav p" title="前の結果(←)">‹</button><button class="nav n" title="次の結果(→)">›</button>
    <div class="play"></div>
    <div class="vc"><button class="pp" title="再生 / 停止(スペース)">⏸</button>
      <input type="range" class="seek" min="0" max="1000" step="1" value="0" title="再生位置">
      <span class="tm">0:00 / 0:00</span>
      <button class="mute" title="音を消す / 出す">🔊</button><input type="range" class="vol" min="0" max="1" step="0.05" value="1" title="音量"></div>
    <div class="tip"></div>`;
  document.body.appendChild(zoom);
  zoom.querySelector(".x").onclick = (e) => { e.stopPropagation(); closeZoom(); };
  zoom.querySelector(".nav.p").onclick = (e) => { e.stopPropagation(); go(-1); };
  zoom.querySelector(".nav.n").onclick = (e) => { e.stopPropagation(); go(1); };
  for (const b of zoom.querySelectorAll("button")) b.addEventListener("pointerdown", (e) => e.stopPropagation());
  // 動画の操作バー(拡大・移動・閉じるの操作と混ざらないように、押した操作をここで止める)
  const vc = zoom.querySelector(".vc");
  for (const ev of ["pointerdown", "pointerup", "click", "wheel"]) vc.addEventListener(ev, (e) => e.stopPropagation());
  vc.querySelector(".pp").onclick = () => togglePlay();
  vc.querySelector(".seek").oninput = (e) => {
    const v = zs.el;
    if (v?.tagName === "VIDEO" && v.duration) v.currentTime = (Number(e.target.value) / 1000) * v.duration;
  };
  vc.querySelector(".mute").onclick = () => { if (zs.el?.tagName === "VIDEO") zs.el.muted = !zs.el.muted; };
  vc.querySelector(".vol").oninput = (e) => {
    if (zs.el?.tagName !== "VIDEO") return;
    zs.el.volume = Number(e.target.value);
    zs.el.muted = zs.el.volume === 0;
  };
  zoom.addEventListener("wheel", (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX, e.clientY, zs.s * f);
  }, { passive: false });
  zoom.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    zoom.setPointerCapture(e.pointerId);
    zs.drag = { x: e.clientX, y: e.clientY, ox: zs.x, oy: zs.y, moved: false, onMedia: e.target === zs.el };
  });
  zoom.addEventListener("pointermove", (e) => {
    const d = zs.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) { d.moved = true; zoom.classList.add("dragging"); }
    if (d.moved) { zs.x = d.ox + dx; zs.y = d.oy + dy; apply(); }
  });
  zoom.addEventListener("pointerup", () => {
    const d = zs.drag;
    zs.drag = null;
    zoom.classList.remove("dragging");
    if (!d || d.moved) return;
    // ドラッグせずに押した: 動画の上なら再生 / 停止、それ以外は閉じる
    const it = zs.items[zs.i];
    if (it?.isVideo && d.onMedia) togglePlay();
    else closeZoom();
  });
  zoom.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closeZoom();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === " " && zs.items[zs.i]?.isVideo) { e.preventDefault(); togglePlay(); }
  });
  window.addEventListener("resize", () => { if (zoom.classList.contains("open")) fitMedia(); });
}
function apply() {
  if (!zs.el) return;
  zs.el.style.transform = `translate(${zs.x}px,${zs.y}px) scale(${zs.s})`;
  zoom.querySelector(".pct").textContent = `${Math.round(zs.s * 100)}%`;
}
function zoomAt(cx, cy, s) {
  const ns = Math.min(Math.max(s, zs.fitS * 0.2, 0.02), 40);
  const k = ns / zs.s;
  zs.x = cx - (cx - zs.x) * k;
  zs.y = cy - (cy - zs.y) * k;
  zs.s = ns;
  apply();
}
function natural() {
  const el = zs.el;
  return el.tagName === "VIDEO" ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];
}
function fitMedia() {
  const [w, h] = natural();
  if (!w || !h) return;
  const W = window.innerWidth, H = window.innerHeight;
  zs.fitS = Math.min((W - 24) / w, (H - 24) / h);
  zs.s = zs.fitS;
  zs.x = (W - w * zs.s) / 2;
  zs.y = (H - h * zs.s) / 2;
  apply();
}
function togglePlay() {
  const v = zs.el;
  if (!v || v.tagName !== "VIDEO") return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
}
function load() {
  const it = zs.items[zs.i];
  zs.el?.remove();
  zoom.classList.remove("paused");
  if (!it) return;
  const el = document.createElement(it.isVideo ? "video" : "img");
  el.className = "media";
  el.draggable = false;
  zoom.classList.toggle("video", !!it.isVideo);
  if (it.isVideo) {
    el.loop = true; el.autoplay = true; el.playsInline = true;
    const vc = zoom.querySelector(".vc");
    const fmt = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}` : "0:00.0");
    const sync = () => {
      vc.querySelector(".tm").textContent = `${fmt(el.currentTime)} / ${fmt(el.duration)}`;
      if (el.duration) vc.querySelector(".seek").value = String(Math.round((el.currentTime / el.duration) * 1000));
    };
    el.onloadedmetadata = () => { fitMedia(); sync(); };
    el.ontimeupdate = sync;
    el.onplay = () => { zoom.classList.remove("paused"); vc.querySelector(".pp").textContent = "⏸"; };
    el.onpause = () => { zoom.classList.add("paused"); vc.querySelector(".pp").textContent = "▶"; };
    el.onvolumechange = () => {
      vc.querySelector(".mute").textContent = el.muted || el.volume === 0 ? "🔇" : "🔊";
      vc.querySelector(".vol").value = String(el.muted ? 0 : el.volume);
    };
  } else el.onload = () => fitMedia();
  el.src = it.url;
  zoom.prepend(el);
  zs.el = el;
  zoom.querySelector(".tip").textContent = it.isVideo
    ? "ホイール: 拡大・縮小 / ドラッグ: 移動 / 動画をクリック: 再生・停止 / ✕・Esc・外側をクリック: 閉じる / ← →: 前後"
    : "ホイール: 拡大・縮小 / ドラッグ: 移動 / クリック・✕・Esc: 閉じる / ← →: 前後";
  zoom.querySelector(".nav.p").disabled = zs.i <= 0;
  zoom.querySelector(".nav.n").disabled = zs.i >= zs.items.length - 1;
  for (const b of zoom.querySelectorAll(".nav")) b.style.display = zs.items.length > 1 ? "" : "none";
  zs.onChange?.(it);
}
function go(d) {
  const j = zs.i + d;
  if (j < 0 || j >= zs.items.length) return;
  zs.i = j;
  load();
}
// items: [{url, isVideo}] / index: 最初に出すもの / opts.onChange(item): 前後に移ったとき
export function openZoom(items, index = 0, opts = {}) {
  if (!zoom) buildZoom();
  zs.items = items || [];
  zs.i = Math.max(0, Math.min(index, zs.items.length - 1));
  zs.onChange = opts.onChange;
  zoom.classList.add("open");
  load();
  zoom.focus();
}
export function closeZoom() {
  if (!zoom) return;
  zoom.classList.remove("open");
  if (zs.el?.tagName === "VIDEO") zs.el.pause();
  zs.el?.remove();
  zs.el = null;
}
export function zoomState() {
  return zoom?.classList.contains("open") ? { open: true, i: zs.i, s: zs.s, x: zs.x, y: zs.y, fitS: zs.fitS } : { open: false };
}

// ---------------------------------------------------------------- ギャラリー一覧
let gal = null;
// items: [{url, isVideo, ts, info?}] / opts: { current, onPick(item), caption(item) }
export function openGallery(items, opts = {}) {
  css();
  if (!gal) {
    gal = document.createElement("div");
    gal.id = "cca-gal";
    gal.tabIndex = -1;
    gal.innerHTML = `<div class="win"><div class="hd"><b>ギャラリー</b><span class="cnt" style="color:#959eab"></span>
      <select class="flt"><option value="all">すべて</option><option value="image">画像だけ</option><option value="video">動画だけ</option></select>
      <span class="sp"></span><span style="color:#959eab;font-size:13px">押すとパネルに表示 / 🔍 で拡大表示</span><button class="cl">閉じる</button></div><div class="grid"></div></div>`;
    document.body.appendChild(gal);
    gal.addEventListener("click", (e) => { if (e.target === gal) closeGallery(); });
    gal.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") closeGallery(); });
    gal.querySelector(".cl").onclick = () => closeGallery();
  }
  const render = () => {
    const f = gal.querySelector(".flt").value;
    const list = items.map((it, i) => ({ it, i })).filter(({ it }) => f === "all" || (f === "video") === !!it.isVideo);
    gal.querySelector(".cnt").textContent = `${list.length} 件`;
    const grid = gal.querySelector(".grid");
    grid.innerHTML = list.length ? list.map(({ it, i }) => `<div class="it${it === opts.current ? " on" : ""}" data-i="${i}">
        <button class="zoom" title="拡大表示">🔍</button>
        <div class="th">${it.isVideo ? videoThumb(it.url, true) : `<img src="${esc(it.url)}" loading="lazy" alt="">`}</div>
        <div class="cap">${esc(opts.caption ? opts.caption(it) : "")}</div></div>`).join("")
      : '<div class="none">まだ結果がありません。</div>';
    for (const el of grid.querySelectorAll(".it")) {
      const i = Number(el.dataset.i);
      el.onclick = () => { opts.onPick?.(items[i]); closeGallery(); };
      el.querySelector(".zoom").onclick = (e) => { e.stopPropagation(); openZoom(items, i, { onChange: opts.onPick }); };
    }
  };
  gal.querySelector(".flt").onchange = render;
  gal.querySelector(".flt").value = "all";
  render();
  gal.classList.add("open");
  gal.focus();
}
export function closeGallery() {
  if (!gal) return;
  gal.classList.remove("open");
  for (const v of gal.querySelectorAll("video")) v.removeAttribute("src");
  gal.querySelector(".grid").innerHTML = "";
}
