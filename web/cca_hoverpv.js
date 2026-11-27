// 一覧の項目(画像・動画のファイル)にカーソルを乗せたとき、その絵をカーソルの横に重ねて出す。
// 動画は最初のほうのコマ。色は、その一覧の背景・枠の色に合わせる
import { api } from "../../scripts/api.js";

const IMG = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const VID = /\.(mp4|webm|mov|mkv|m4v)$/i;
const split = (value) => {
  const m = /^(.*?)\s*\[(input|output|temp)\]$/.exec(String(value || "").trim());
  return { path: (m ? m[1] : String(value || "").trim()).replace(/\\/g, "/"), type: m ? m[2] : "input" };
};
export function mediaKind(value) {
  const { path } = split(value);
  return IMG.test(path) ? "image" : VID.test(path) ? "video" : "";
}
function viewUrl(value) {
  const { path, type } = split(value);
  const i = path.lastIndexOf("/");
  return api.apiURL(`/view?${new URLSearchParams({ filename: path.slice(i + 1), subfolder: i >= 0 ? path.slice(0, i) : "", type })}`);
}

let pv = null;
function box() {
  if (pv) return pv;
  pv = document.createElement("div");
  pv.id = "cca-hoverpv";
  pv.setAttribute("data-no-theme", "");
  Object.assign(pv.style, { position: "fixed", zIndex: "2147483001", pointerEvents: "none", display: "none", padding: "4px", borderRadius: "8px",
    border: "1px solid", boxShadow: "0 8px 24px #0006" });
  document.body.appendChild(pv);
  return pv;
}
export function hidePreview() { if (pv) pv.style.display = "none"; }
// 背景が透明でない、いちばん近い要素の色
function colorsOf(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const c = getComputedStyle(e);
    if (c.backgroundColor && !/^(transparent|rgba\(.*,\s*0\))$/.test(c.backgroundColor)) return { bg: c.backgroundColor, bd: c.borderTopColor };
  }
  return { bg: "#1a1e25", bd: "#3a4250" };
}
function place(x, y) {
  const w = pv.offsetWidth, h = pv.offsetHeight, g = 18;
  pv.style.left = `${x + g + w > window.innerWidth ? Math.max(4, x - g - w) : x + g}px`;
  pv.style.top = `${y + g + h > window.innerHeight ? Math.max(4, y - g - h) : y + g}px`;
}
// list: 一覧の要素。valueOf(項目の要素) → ファイルの値(「フォルダ/名前 [output]」など)。出さない項目は空
export function hoverPreview(list, itemSel, valueOf) {
  if (list._ccaPv) return;
  list._ccaPv = true;
  list.addEventListener("mousemove", (e) => {
    const it = e.target.closest?.(itemSel);
    const v = it && list.contains(it) ? valueOf(it) : "";
    const kind = v ? mediaKind(v) : "";
    if (!kind) { hidePreview(); return; }
    box();
    if (pv.dataset.v !== v) {
      pv.dataset.v = v;
      const url = viewUrl(v);
      const m = document.createElement(kind === "image" ? "img" : "video");
      Object.assign(m.style, { display: "block", maxWidth: "260px", maxHeight: "260px", borderRadius: "4px" });
      if (kind === "video") { m.muted = true; m.preload = "metadata"; m.src = `${url}#t=0.1`; } else { m.alt = ""; m.src = url; }
      const x = e.clientX, y = e.clientY;
      m.onload = m.onloadeddata = () => { if (pv.dataset.v === v) place(x, y); }; // 大きさが分かったら置き直す
      pv.replaceChildren(m);
    }
    const c = colorsOf(list);
    pv.style.background = c.bg;
    pv.style.borderColor = c.bd;
    pv.style.display = "block";
    place(e.clientX, e.clientY);
  });
  list.addEventListener("mouseleave", hidePreview);
  list.addEventListener("scroll", hidePreview);
}
