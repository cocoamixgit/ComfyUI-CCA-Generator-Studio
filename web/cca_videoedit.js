// CCA Generator: 動画編集
// - つなげる: 動画を何本でも順につなげる(タイムラインでドラッグして並べ替え、両端をドラッグして使う所を切り取る、✂ で分ける)
// - 画面を切り取る(動画ごと): プレビューの上で範囲を指定、または数値
// - 重ねる: 文字(字幕)・画像・動画。表示する時間はタイムラインで、位置と大きさはプレビューの上でドラッグ
// - 動き(キーフレーム)・トランジション(入る・出る)・速さ・背景を透明にする(色で抜く・AI・元の透明度)・音声の段・透かし
// - 書き出し: サーバーの CCAVideoEdit(PyAV)で MP4 / WebM / WebP / GIF。生成パネルの「動画の保存先」のフォルダに「元の名前_edit.<形式>」
// - 一時保存(💾・Ctrl+S)と自動保存(数分ごと・閉じるとき)。🕘 履歴から開き直す(cca_history.js)
// 生成パネル(cca_ui.js)から openVideoEditor() で開く。
import { api } from "../../scripts/api.js";
import { T, confirm, prompt } from "./cca_i18n.js";
import { openWatermark, watermarkKey } from "./cca_watermark.js";
import { frameHlHtml, frameHlCss, bindFrameHl, frameHlPad } from "./cca_framehl.js";
import { rulesHtml, setRule, addRule, SHAPES, SHAPE_KEYS, MASK_DEF, applyShapeMask, PATTERNS, PAT_KEYS, outlineCanvas, outlineSides, shapeMaskCanvas, decodePath, tracePath, toggleCurvePoint, nearPathLine, askClose, sideSplitter } from "./cca_shapes.js";
import { saveEntry, openHistory, historyKey, makeThumb, newSid, fmtTime, HIST_EVERY } from "./cca_history.js";
import { setupSections, sectionEditBar, SECTIONS_CSS, cardCss } from "./cca_sections.js";
import { sectionCss, wrapLines, bboxHtml, bboxCss, bboxDrag, textSectionsHtml, STYLE_RESET, clipboard, pickText, isField, isTextField, textLayout, drawTextAt,
  snapLines, snapMove, snapResize, showSnapGuides } from "./cca_text.js";

const MAX_UNDO = 50;
const MIN_LEN = 0.1;
const GUT = 64; // タイムラインの左の見出し(動画・文字・重ね動画など)の幅
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`; };
const nameOf = (v) => { const m = /^(.*?)\s*\[(input|output|temp|cca_wm)\]$/.exec(String(v || "")); return (m ? m[1] : String(v || "")).split("/").pop(); };
function viewUrl(value) {
  // 透かし(user/default/cca_generator/watermarks)。前の版の「cca_watermarks/名前 [input]」も同じ所を見る
  const wm = /^(.*?)\s*\[cca_wm\]$/.exec(String(value || "")) || /^cca_watermarks\/([^/]+?)\s*\[input\]$/.exec(String(value || ""));
  if (wm) return api.apiURL(`/cca_generator/watermarks/file?${new URLSearchParams({ name: wm[1] })}`);
  const m = /^(.*?)\s*\[(input|output|temp)\]$/.exec(String(value || ""));
  const path = (m ? m[1] : String(value || "")).replace(/\\/g, "/");
  const i = path.lastIndexOf("/");
  const q = new URLSearchParams({ filename: path.slice(i + 1), subfolder: i >= 0 ? path.slice(0, i) : "", type: m ? m[2] : "input" });
  return api.apiURL(`/view?${q}`);
}

let ui = null;
let ctx = null;
let uid = 1;
const st = {
  proj: { size: [1280, 720], fps: 24, clips: [], overlays: [] },
  sel: null, msel: [], vz: { z: 1, px: 0, py: 0 }, t: 0, playing: false, pxs: 60, snap: true, fonts: null, fontDefault: null, fontFaces: new Map(),
  undo: [], redo: [], dirty: false,
  media: { videos: [], images: [], font: null, font_dir: "" },
  cropMode: false, busy: false, cur: -1, token: 0, ovEls: new Map(), auEls: new Map(), drag: null, clock: null,
  secOpen: {}, styles: null, tplSel: "", eyedrop: false,
  hist: { sid: "", sig: "", timer: null, q: Promise.resolve() }, // 一時保存(自動保存の項目・最後に保存した中身)
};

function css() {
  if (document.getElementById("cca-vedit-style")) return;
  const s = document.createElement("style");
  s.id = "cca-vedit-style";
  s.textContent = `
#cca-vedit{position:fixed;inset:0;z-index:1001;background:#000c;display:none;align-items:center;justify-content:center;
  font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-vedit.open{display:flex}
#cca-vedit .box{background:#1a1e25;border:0;border-radius:0;width:100%;height:100%;display:flex;flex-direction:column}
#cca-vedit .hd{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #303744;flex-wrap:wrap}
#cca-vedit .hd b{font-size:16px}
#cca-vedit .nm{color:#9fb0c2;font-size:13px}
#cca-vedit .sp{flex:1}
#cca-vedit .main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) var(--sidew,360px)}
#cca-vedit .left{display:flex;flex-direction:column;min-width:0;min-height:0}
#cca-vedit .stage{position:relative;flex:1;min-height:160px;background:#0b0d10;overflow:hidden}
#cca-vedit .frame{position:absolute;background:#000;overflow:hidden;box-shadow:0 0 0 1px #303744}
#cca-vedit .win{position:absolute;overflow:hidden;isolation:isolate}
#cca-vedit .win video{position:absolute;left:0;top:0;max-width:none;z-index:1}
#cca-vedit .ovl{position:absolute;inset:0}
#cca-vedit .ov{position:absolute;box-sizing:border-box;cursor:move;user-select:none}
#cca-vedit .ov:not([data-kind="mosaic"]){isolation:isolate}
#cca-vedit .ov.txt{transform:translate(-50%,-50%);white-space:pre;text-align:center;line-height:1.2;font-weight:700;padding:0;
  font-family:"Hiragino Sans","Yu Gothic UI",Meiryo,"Noto Sans CJK JP",sans-serif;paint-order:stroke fill}
#cca-vedit .ov img,#cca-vedit .ov video{width:100%;height:100%;display:block;pointer-events:none;position:relative;z-index:1}
#cca-vedit .ov.chide > :not(.bb){visibility:hidden}
#cca-vedit .ov .vcr{position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:1}
#cca-vedit .ov .vcr video{position:absolute;left:0;top:0;max-width:none}
#cca-vedit .ov .eb,#cca-vedit .win .eb{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:0;display:none}
#cca-vedit .ov .kc,#cca-vedit .win .kc{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2}
#cca-vedit .ov .olc{position:absolute;pointer-events:none;z-index:0;display:none}
#cca-vedit .ov canvas.shp{width:100%;height:100%;display:block;position:relative;z-index:1;pointer-events:none}
#cca-vedit .pathcv{position:absolute;left:0;top:0;width:100%;height:100%;z-index:8;display:none;cursor:crosshair;touch-action:none}
#cca-vedit .blk.shape{background:#4f8a7a}
#cca-vedit .frame[data-bg="white"]{background:#fff}
#cca-vedit .frame[data-bg="transparent"]{background:repeating-conic-gradient(#3a3f47 0 25%,#2a2e35 0 50%) 0 0/16px 16px}
#cca-vedit .win.sel{cursor:move}
#cca-vedit .win .rz{position:absolute;right:0;bottom:0;width:12px;height:12px;background:#ffcc33;border:1px solid #000;cursor:nwse-resize;z-index:2}
#cca-vedit .win .rz.hide{display:none}
#cca-vedit .ov.txt .tfil{position:relative;display:block;z-index:1}
#cca-vedit .ov.txt .tstk{position:absolute;left:0;top:0;right:0;z-index:0;white-space:pre;pointer-events:none;
  color:var(--sc);-webkit-text-stroke:var(--sw) var(--sc);transform:translate(var(--sdx),var(--sdy));opacity:var(--sa)}
#cca-vedit .ov.txt .tw{visibility:hidden}
#cca-vedit .wbox{position:absolute;pointer-events:none;display:none}
${bboxCss("#cca-vedit")}
${SECTIONS_CSS("#cca-vedit")}
${cardCss("#cca-vedit .side", "> section[data-sec]", { export: "yellow", insp: "blue", guide: "gray" })}
#cca-vedit .secbar{gap:6px}
#cca-vedit .secbar button{font-size:12px;padding:3px 8px}
#cca-vedit .ov.txt .tbg{position:absolute;pointer-events:none}
#cca-vedit .aibadge{position:absolute;right:12px;top:12px;background:#000c;border:1px solid #ffcc33;color:#ffe9a3;font-size:12px;padding:3px 8px;border-radius:6px;z-index:4;pointer-events:none}
#cca-vedit .ov.sel{outline:none}
#cca-vedit .ov .rz{position:absolute;right:-7px;bottom:-7px;width:12px;height:12px;background:#3db4a6;border:1px solid #fff;cursor:nwse-resize}
#cca-vedit .crop{position:absolute;border:2px solid #ffcc33;box-shadow:0 0 0 9999px #000a;cursor:move}
#cca-vedit .crop .cdim{position:absolute;left:4px;top:4px;background:#000b;color:#ffd24d;font-size:12px;padding:1px 6px;border-radius:4px;pointer-events:none;white-space:nowrap}
#cca-vedit .crop .h{position:absolute;width:14px;height:14px;background:#ffcc33;border:1px solid #000;box-sizing:border-box}
#cca-vedit .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#9fb0c2;padding:20px}
#cca-vedit .empty b{display:block;font-size:17px;color:#cfd5dc;margin-bottom:6px}
#cca-vedit .busy{position:absolute;left:12px;top:12px;right:12px;background:#000d;padding:8px 12px;border-radius:6px;display:none;z-index:5}
#cca-vedit .busy.on{display:block}
#cca-vedit .busy .bar{height:6px;background:#303744;border-radius:3px;margin-top:6px;overflow:hidden}
#cca-vedit .busy .bar i{display:block;height:100%;width:0;background:#3db4a6}
#cca-vedit .busy.up .row{display:none}
#cca-vedit .transport{display:flex;gap:6px;align-items:center;padding:6px 10px;border-top:1px solid #303744;flex-wrap:wrap}
#cca-vedit .transport .tm{font-variant-numeric:tabular-nums;color:#cfd5dc;min-width:9em}
#cca-vedit .tl{height:190px;overflow:auto;border-top:1px solid #303744;background:#13161b;position:relative}
#cca-vedit .tl-in{position:relative;min-height:100%}
#cca-vedit .tl,#cca-vedit .transport,#cca-vedit .stage{user-select:none;-webkit-user-select:none}
#cca-vedit .ruler{position:sticky;top:0;height:22px;background:#1a1e25;border-bottom:1px solid #303744;cursor:pointer;z-index:2}
#cca-vedit .ruler span{position:absolute;top:2px;font-size:11px;color:#9fb0c2;transform:translateX(3px)}
#cca-vedit .ruler i{position:absolute;bottom:0;width:1px;height:6px;background:#555}
#cca-vedit [data-c="rows"]{display:flex;flex-direction:column-reverse}
#cca-vedit .trow{position:relative;height:34px;border-bottom:1px solid #20252e}
#cca-vedit .trow.zero{height:16px;background:#0f1216}
#cca-vedit [data-sec="tools"] button.on{background:#2b8f84;border-color:#3db4a6;color:#fff}
#cca-vedit .trow.zero .lab{line-height:16px}
#cca-vedit .trow[data-row="clip"]{background:#171d26;border-top:1px solid #2a3341}
#cca-vedit .trow[data-row="clip"] .lab{background:#171d26;color:#cfd5dc;font-weight:700}
#cca-gfont{position:fixed;inset:0;z-index:1003;background:#0009;display:none;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#e4e7eb}
#cca-gfont.open{display:flex}
#cca-gfont .pb{background:#1a1e25;border:1px solid #303744;border-radius:10px;padding:12px;width:min(760px,calc(100vw - 32px));max-height:86vh;display:flex;flex-direction:column;gap:8px}
#cca-gfont .ph2{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#cca-gfont input[data-f],#cca-gfont input[data-name]{flex:1;min-width:160px;background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 8px;font:inherit}
#cca-gfont button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px}
#cca-gfont button:disabled{opacity:.5;cursor:default}
#cca-gfont .ls{overflow-y:auto;flex:1;min-height:200px;border:1px solid #303744;border-radius:6px}
#cca-gfont .gf{display:grid;grid-template-columns:minmax(0,13em) minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:6px 8px;border-bottom:1px solid #222831}
#cca-gfont .gf .sm{font-size:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#f2f4f7}
#cca-gfont .gf .tag{font-size:11px;color:#9fe0d6}
#cca-gfont .gf .ok{font-size:11px;color:#ffe9a3}
#cca-gfont .note{font-size:12.5px;color:#9fb0c2}
#cca-vedit .snapl{position:absolute;top:0;bottom:0;width:0;border-left:2px dashed #ffd24d;margin-left:-1px;pointer-events:none;z-index:4;display:none}
#cca-vedit .snapl.on{display:block}
#cca-vedit button[data-c="stretch"].on{background:#173a33;border-color:#3db4a6;color:#c9f1df}
#cca-vedit button[data-c="snap"].on{background:#3a3417;border-color:#ffd24d;color:#ffe9a3}
#cca-vedit .dmark{position:absolute;left:0;top:0;width:0;height:0;z-index:4;pointer-events:none;display:none}
#cca-vedit .dmark.on{display:block}
#cca-vedit .dmark .v{position:absolute;width:3px;margin-left:-1px;background:#3db4a6;border-radius:2px}
#cca-vedit .dmark .h{position:absolute;height:3px;margin-top:-1px;background:#3db4a6;border-radius:2px}
#cca-vedit .dmark .lb{position:absolute;background:#2b8f84;color:#fff;font-size:11.5px;line-height:18px;padding:0 6px;border-radius:4px;white-space:nowrap}
#cca-vedit .dmark.bad .v,#cca-vedit .dmark.bad .h{background:#c06055}
#cca-vedit .dmark.bad .lb{background:#a54a40}
#cca-vedit .stage.drop{outline:3px dashed #3db4a6;outline-offset:-6px}
#cca-vedit .tl.drop{outline:2px dashed #3db4a6;outline-offset:-3px}
#cca-vedit .dhint{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);background:#000d;border:1px solid #3db4a6;color:#e4e7eb;
  padding:4px 10px;border-radius:6px;font-size:13px;display:none;z-index:6;pointer-events:none;white-space:nowrap}
#cca-vedit .stage.drop .dhint{display:block}
#cca-vedit .dhint.stretch{display:block}
#cca-vedit .trow .lab{position:sticky;left:0;z-index:1;display:inline-block;width:${GUT - 6}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:34px;color:#9fb0c2;background:#13161b;padding:0 3px;pointer-events:none}
#cca-vedit .blk{position:absolute;top:4px;height:26px;border-radius:5px;box-sizing:border-box;border:1px solid #0006;overflow:hidden;
  font-size:12px;line-height:24px;padding:0 10px;white-space:nowrap;text-overflow:ellipsis;cursor:grab;color:#fff}
#cca-vedit .blk.clip{background:#2f6fb0}
#cca-vedit .blk.text{background:#8a5cc2}
#cca-vedit .blk.image{background:#b0812f}
#cca-vedit .blk.video{background:#2f9a6b}
#cca-vedit .blk.mosaic{background:#7a6a9a}
#cca-vedit .ov .mzb,#cca-vedit .ov .mz{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
#cca-vedit .ov[data-kind="mosaic"]{outline:1px dashed #ffffff55}
#cca-vedit .blk.audio{background:#4d6b3a}
#cca-vedit .blk.audio.linked{background:#2f5a6f}
#cca-vedit .zm{display:inline-flex;align-items:center;gap:3px;margin-left:8px}
#cca-vedit .zm button{padding:2px 8px}
#cca-vedit .zm [data-c="zoomp"]{min-width:3.4em;text-align:center;font-size:12px;color:#c9d1da}
#cca-vedit .stage.zoomed{cursor:grab}
#cca-vedit .stage.zoomed .frame{cursor:default}
#cca-vedit .stage.panning,#cca-vedit .stage.panning *{cursor:grabbing !important}
#cca-vedit .blk .wv{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
#cca-vedit .vmeter{position:relative;height:14px;border-radius:4px;margin:6px 0 2px;background:linear-gradient(90deg,#1f3a24 0%,#1f3a24 72%,#3a3417 72%,#3a3417 90%,#3a1d1d 90%);overflow:hidden}
#cca-vedit .vmeter i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#3dd68a 0%,#3dd68a 70%,#ffd24d 82%,#ff6b6b 95%);transition:width .06s linear}
#cca-vedit .vmeter b{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#fff}
#cca-vedit .vmeter span{position:absolute;right:6px;top:-1px;font-size:11px;color:#fff;text-shadow:0 0 3px #000}
#cca-vedit .vmeter.over span{color:#ff9b9b}
#cca-vedit .vkl{display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center;font-size:12px;margin-top:4px}
#cca-vedit .trow[data-row="au"]{background:#141a16}
#cca-vedit .blk .kfm{position:absolute;top:9px;width:8px;height:8px;margin-left:-4px;background:#ffd24d;border:1px solid #000;transform:rotate(45deg);pointer-events:none;z-index:1}
#cca-vedit .blk .trm{position:absolute;top:0;bottom:0;pointer-events:none}
#cca-vedit .blk .lpm{position:absolute;right:10px;top:0;font-style:normal;color:#ffb38f;font-weight:700;pointer-events:none}
#cca-vedit .blk .trm.l{left:0;background:linear-gradient(90deg,#ffffff70,#ffffff00)}
#cca-vedit .blk .trm.r{right:0;background:linear-gradient(270deg,#ffffff70,#ffffff00)}
#cca-vedit .blk.sel{box-shadow:0 0 0 2px #fff inset}
#cca-vedit .blk .eh{position:absolute;top:0;bottom:0;width:7px;background:#fff4;cursor:ew-resize}
#cca-vedit .blk .eh.l{left:0}
#cca-vedit .blk .eh.r{right:0}
#cca-vedit .ph{position:absolute;top:0;bottom:0;width:2px;background:#ff5d5d;pointer-events:none;z-index:3}
#cca-vedit .side{border-left:1px solid #303744;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
#cca-vedit section{border:1px solid #303744;border-radius:12px;padding:9px 12px;background:#161a20}
#cca-vedit h4{margin:0 0 6px;font-size:14px;color:#cfd5dc}
#cca-vedit .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
#cca-vedit button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;font-size:13px}
#cca-vedit button:hover{border-color:#3db4a6}
#cca-vedit button.on{background:#2b8f84;border-color:#3db4a6;color:#fff}
#cca-vedit button.pri{background:#2b8f84;border-color:#3db4a6;color:#fff;font-weight:700}
#cca-vedit button:disabled{opacity:.45;cursor:default}
#cca-vedit label.fl{display:grid;grid-template-columns:8.5em minmax(0,1fr);gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:4px}
#cca-vedit input,#cca-vedit select,#cca-vedit textarea{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:4px 6px;font:inherit;font-size:13px;box-sizing:border-box;width:100%}
#cca-vedit input[type=checkbox]{width:auto}
#cca-vedit input:disabled,#cca-vedit select:disabled{opacity:.5;cursor:not-allowed}
#cca-vedit input[type=color]{padding:0;height:28px}
#cca-vedit input[type=range]{accent-color:#3db4a6;padding:0}
#cca-vedit textarea{min-height:60px;resize:vertical}
#cca-vedit .note{font-size:13px;color:#9fb0c2;margin-top:4px}
${sectionCss("#cca-vedit")}
${frameHlCss("#cca-vedit")}
#cca-vedit label.ck{display:flex;gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:5px;cursor:pointer}
#cca-vedit label.ck input:disabled+span{opacity:.45}
#cca-vedit .ckrow{gap:2px 12px}
#cca-vedit .trbox{border-top:1px dashed #4a3442;padding-top:4px;margin-top:6px}
#cca-vedit .trbox:first-child{border-top:0;margin-top:0}
#cca-vedit .trbox>b{font-size:12.5px;color:#f6d2e5}
#cca-vedit .kfl{margin-top:6px;display:flex;flex-direction:column;gap:3px}
#cca-vedit .kfrow{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:4px;align-items:center;font-size:12px;color:#e9e1bd;background:#2a2615;border-radius:5px;padding:2px 4px}
#cca-vedit .kfrow .kv{color:#b8ae86;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cca-vedit .kfrow button{padding:1px 6px;font-size:12px}
#cca-vedit .kfnote{color:#ffd24d}
#cca-vedit .stage.eyedrop,#cca-vedit .stage.eyedrop *{cursor:crosshair !important}
#cca-vedit .warn{font-size:13px;background:#231d12;border:1px solid #6b5422;border-radius:6px;padding:6px 8px;color:#e8d9b5;margin-top:6px}
#cca-vedit .xy{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}
#cca-vpick{position:fixed;inset:0;z-index:1002;background:#0009;display:none;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#e4e7eb}
#cca-vpick.open{display:flex}
#cca-vpick .pb{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(720px,94vw);max-height:80vh;display:flex;flex-direction:column}
#cca-vpick .ph2{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid #303744}
#cca-vpick input{flex:1;background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 8px}
#cca-vpick button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 10px;cursor:pointer}
#cca-vpick .ls{overflow-y:auto;padding:6px}
#cca-vpick .it{padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;word-break:break-all}
#cca-vpick .it:hover{background:#2b8f8433}
`;
  document.head.appendChild(s);
}

function build() {
  css();
  ui = document.createElement("div");
  ui.id = "cca-vedit";
  ui.tabIndex = -1;
  ui.innerHTML = `<div class="box">
    <div class="hd"><b>動画編集</b><span class="nm" data-c="name"></span><span class="sp"></span>
      <button data-c="undo" title="元に戻す(Ctrl+Z)" disabled>↶ 元に戻す</button>
      <button data-c="redo" title="やり直す(Ctrl+Y)" disabled>↷ やり直す</button>
      <button data-c="hsave" title="今の編集を一時保存します(Ctrl+S)。🕘 履歴から開き直せます">📌 一時保存</button>
      <button data-c="hist" title="一時保存・自動保存した編集を開き直します">🕘 履歴</button>
      <button class="pri" data-c="export" title="生成パネルの「動画の保存先」と同じフォルダ(output の中)に「最初の動画の名前_edit.mp4」(形式に合わせて .webm / .webp / .gif)で書き出します(同じ名前があれば _edit_1、_edit_2 …)" disabled>🎬 書き出す</button>
      <button data-c="close">閉じる</button></div>
    <div class="main">
      <div class="left">
        <div class="stage" data-c="stage">
          <div class="frame" data-c="frame"><div class="win" data-c="win"><canvas class="eb" data-c="ebc"></canvas><video data-c="vmain" playsinline preload="auto"></video><canvas class="kc" data-c="keycv"></canvas></div><div class="wbox" data-c="wbox"></div><div class="ovl" data-c="ovl"></div><canvas class="pathcv" data-c="pathcv"></canvas></div>
          <div class="aibadge" data-c="aibadge" hidden>AI で背景を消すのは書き出しのときです(プレビューでは消えません)</div>
          <div class="empty" data-c="empty"><div><b>動画を入れてください</b>下の「＋ 動画の挿入」で選ぶか、ここへ動画のファイルをドラッグ&ドロップします。何本でも順につなげられます。
            動画なしで、文字や画像だけ(右のツールの「＋ 文字」、下の「＋ 画像の挿入」)でも作れます(透明な WebP・GIF のスタンプなど)。
            前の作業は、上の「🕘 履歴」から開き直せます。</div></div>
          <div class="dhint" data-c="dhint"></div>
          <div class="busy" data-c="busy"><span data-c="busytext"></span><div class="bar"><i data-c="busybar"></i></div>
            <div class="row" style="margin-top:6px"><button data-c="cancel">中止</button></div></div>
        </div>
        <div class="transport">
          <button data-c="play" title="再生 / 停止(スペース)">▶ 再生</button><span class="tm" data-c="time">0:00.0 / 0:00.0</span>
          <span class="zm" title="プレビューの拡大: ホイールで拡大・縮小、中ボタンのドラッグ(拡大中は、画面の外側の灰色の所をドラッグしても)で動かす"><button data-c="zout" title="縮小">－</button><span data-c="zoomp">100%</span><button data-c="zin" title="拡大">＋</button><button data-c="zfit" title="全体を表示">全体</button></span>
          <span class="sp"></span>
          <button data-c="add-video" title="動画を再生位置に入れます(何も無ければ、いちばん下の段の 1 本目)">＋ 動画の挿入</button>
          <button data-c="add-image">＋ 画像の挿入</button>
          
          <button data-c="add-audio" title="音声ファイル(mp3・wav など)や、動画の音だけを音声の段に置きます">＋ 音声の挿入</button>
          <button data-c="split" title="選んだもの(動画・文字・画像)を、再生位置で 2 つに分ける(S)。再生位置が外なら真ん中で分けます">✂ 分割</button>
          <button data-c="dup" title="選んだものを複製する(Ctrl+D)。すぐ後ろに置きます。Ctrl+C でコピー・Ctrl+X で切り取り・Ctrl+V で再生位置に貼り付け">⧉ 複製</button>
          <button data-c="del" title="選んだものを消す(Delete)">🗑 消す</button>
          <button data-c="stretch" title="オンのとき、タイムラインで動画・音声の端をドラッグすると、切り取らずに速さを変えて伸び縮みさせます(タイムストレッチ。速さ % も変わります)。Shift を押しながらドラッグしても同じ">⇔ 伸縮(タイムストレッチ)</button>
          <button data-c="snap" class="on" title="ドラッグしたときに、ほかのレイヤーの始まり・終わり・再生位置にそろえる。プレビューの枠も、画面やほかのレイヤーの端・真ん中にそろえる(Alt を押しながらドラッグすると、そろえない)">🧲 スナップ</button>
          <label class="row" style="font-size:12px;color:#9fb0c2">表示の幅<input type="range" data-c="zoom" min="10" max="400" value="60" style="width:110px"></label>
        </div>
        <div class="tl" data-c="tl"><div class="tl-in" data-c="tlin"><div class="ruler" data-c="ruler"></div><div data-c="rows"></div><div class="ph" data-c="ph"></div><div class="snapl" data-c="snapl"></div><div class="dmark" data-c="dmark"><div class="v"></div><div class="h"></div><div class="lb"></div></div></div></div>
      </div>
      <div class="side">
        <div class="row secbar" data-c="secbar"></div>
        <section data-sec="tools"><h4>ツール</h4>
          <div class="row">
            <button data-c="tool-sel" class="on" title="プレビューやタイムラインで押したレイヤーを選び、枠で動かす・大きさ・回転を変える">↖ 選択</button>
            <button data-c="add-text">＋ 文字</button>
            <button data-c="add-mosaic" title="モザイク(またはぼかし・塗りつぶし)を画像のように置きます。動かす・大きさ・回すは枠で、動く被写体に合わせるときはキーフレームで">＋ モザイク</button>
            <button data-c="add-shape" title="図形(四角・丸・星・ハート・タイル・水玉など)のレイヤーを追加します。動画・画像のマスクに使えます(上の段の動画・画像で「下のレイヤーで切り抜く」)">＋ 図形</button>
            <button data-c="add-path" title="プレビューに点を置いてパスを描き、図形のレイヤーにします(Alt + クリックで曲線)。マスクに使えます">✒ パス</button>
            <button data-c="wm" title="登録した透かし画像を、右下・左下・右上・左上・真ん中に置きます(最初から最後まで)">💧 透かし</button>
          </div></section>
        <section data-sec="export"><h4>書き出す動画</h4>
          <label class="fl">大きさ(幅×高さ)<span class="row" style="flex-wrap:nowrap"><input type="number" data-p="w" min="16" max="4096" step="2"> × <input type="number" data-p="h" min="16" max="4096" step="2"></span></label>
          <label class="fl">fps<input type="number" data-p="fps" min="1" max="120" step="0.001"></label>
          <div class="row" style="margin-top:6px"><button data-c="fitfirst" title="書き出す大きさと fps を、選んだ動画(選んでいなければ最初の動画)の切り取った範囲に合わせます">選んだ動画に合わせる</button></div>
          ${frameHlHtml()}
          <label class="fl">形式<select data-p="format">
            <option value="mp4">MP4(H.264・音あり)</option><option value="webm">WebM(VP9・透明と音あり)</option>
            <option value="webp">WebP アニメ(透明あり・音なし)</option><option value="gif">GIF アニメ(透明あり・音なし)</option></select></label>
          <label class="fl">背景<select data-p="bg"><option value="black">黒</option><option value="white">白</option><option value="transparent">透明</option></select></label>
          <div data-c="expopts"></div>
          <div class="note" data-c="fmtnote"></div>
          <div class="note" data-c="info"></div>
          <div data-c="fontwarn" hidden></div></section>
        <section data-sec="insp" data-c="insp"></section>
        <section data-sec="guide"><h4>使い方</h4>
          <div class="note">タイムライン: 動画や文字をドラッグして動かし、両端をドラッグして長さを変えます。上の目盛りを押すと、その位置へ移ります。
            文字・画像・動画はプレビューの上でドラッグして動かし、右下の■で大きさを変えます。</div>
          <div class="note">重なる順番: 上の段ほど手前に重なり、いちばん下の「動画」の段が土台です。段を上下にドラッグすると順番が変わります。
            「動画」の段の動画を上へドラッグすると重ねる動画に、重ねる動画を「動画」の段へドラッグするとつなげる動画になります。</div>
          <div class="note">ドラッグ&ドロップ: 動画・画像のファイルを、タイムラインに置くとその場所に(「動画」の段ならつなげる、上の段なら重ねる)、
            プレビューに置くと置いた所に重ねます(ピクチャーインピクチャー)。何も入っていないときは 1 本目の動画になります。</div></section>
      </div>
    </div></div>`;
  document.body.appendChild(ui);
  bind();
}

const $ = (sel) => ui.querySelector(sel);
const P = () => st.proj;
const vmain = () => $('[data-c="vmain"]');

// ---------------------------------------------------------------- プロジェクト
// タイムライン上の長さ = 使う所 ÷ 速さ
const spd = (x) => clamp(Number(x?.speed) || 1, 0.05, 16);
const pctOf = (x) => `${Math.round(spd(x) * 100)}%`;
const lenOf = (c) => (c.out - c.in) / spd(c);
function starts() { let t = 0; return P().clips.map((c) => { const s = t; t += lenOf(c); return s; }); }
// 全体の長さ: つなげる動画があればその合計、無ければレイヤー・音声の終わり
function total() {
  if (P().clips.length) return P().clips.reduce((a, c) => a + lenOf(c), 0);
  return Math.max(0, ...P().overlays.map((o) => o.end), ...(P().audios || []).map((a) => audioView(a).start + audioLen(a)));
}
function clipAt(t) {
  const ss = starts(), cs = P().clips;
  for (let i = 0; i < cs.length; i++) if (t < ss[i] + lenOf(cs[i]) - 1e-6 || i === cs.length - 1) return { i, c: cs[i], s: ss[i], local: cs[i].in + clamp(t - ss[i], 0, lenOf(cs[i])) * spd(cs[i]) };
  return null;
}
// ---- 音声の段: link のある音声は、つながっている動画と一緒に動く(切り離すと別に動かせる)
function audioView(a) {
  if (a.link != null) {
    const o = P().overlays.find((x) => x.id === a.link && x.kind === "video");
    if (o) return { start: o.start, in: o.in || 0, out: (o.in || 0) + (o.end - o.start) * spd(o), speed: spd(o) };
    const i = P().clips.findIndex((c) => c.id === a.link);
    if (i >= 0) { const c = P().clips[i]; return { start: starts()[i], in: c.in, out: c.out, speed: spd(c) }; }
  }
  return { start: a.start || 0, in: a.in || 0, out: a.out, speed: spd(a) };
}
const audioLen = (a) => { const v = audioView(a); return (v.out - v.in) / v.speed; };
// ---- 第26版: 「つなげる動画 / レイヤー」の区別をなくし、全部「レイヤー」(P().overlays)にする。row = 段(0 がいちばん下。上の段ほど手前)
const rowOf = (o) => (Number.isInteger(o?.row) && o.row >= 0 ? o.row : 0);
// 描く順(下の段から。同じ段は並び順)
function orderedOverlays() { return P().overlays.map((o, i) => [o, i]).sort((a, b) => rowOf(a[0]) - rowOf(b[0]) || a[1] - b[1]).map((x) => x[0]); }
// 段の番号を 0 から詰める(空いた段を無くす)
function normRows() {
  const rs = [...new Set(P().overlays.map(rowOf))].sort((a, b) => a - b);
  const m = new Map(rs.map((r, i) => [r, i]));
  for (const o of P().overlays) o.row = m.get(rowOf(o));
}
const rowCount = () => (P().overlays.length ? Math.max(...P().overlays.map(rowOf)) + 1 : 1);
const rowEnd = (r) => Math.max(0, ...P().overlays.filter((o) => rowOf(o) === r).map((o) => o.end));
// 動画・画像を画面に収める大きさ(画面に対しての割合)
function fitWH(vw, vh, crop) {
  const [W, H] = P().size;
  const cw = crop ? crop[2] : vw || 16, ch = crop ? crop[3] : vh || 9;
  const k = Math.min(W / cw, H / ch);
  return [r3((cw * k) / W), r3((ch * k) / H)];
}
// 前の版の形(つなげる動画 clips と、1 つずつ別の段のレイヤー)→ 今の形(いちばん下の段に、つないだ時刻のまま並べる)
function migrateProject(p) {
  p.clips = Array.isArray(p.clips) ? p.clips : [];
  p.overlays = Array.isArray(p.overlays) ? p.overlays : [];
  p.audios = Array.isArray(p.audios) ? p.audios : [];
  if (p.v >= 26 && !p.clips.length) return p;
  const base = p.clips.length ? 1 : 0;
  if (!p.overlays.every((o) => Number.isInteger(o.row))) p.overlays.forEach((o, i) => { o.row = i + base; });
  else if (base) for (const o of p.overlays) o.row = (o.row || 0) + 1;
  const [W, H] = Array.isArray(p.size) ? p.size : [1280, 720];
  let t = 0;
  const conv = p.clips.map((c) => {
    const cw = c.crop ? c.crop[2] : c.w || 16, ch = c.crop ? c.crop[3] : c.h || 9;
    const k = Math.min(W / cw, H / ch), bw = (cw * k) / W, bh = (ch * k) / H, sc = Number(c.s ?? 1) || 1;
    const sp = clamp(Number(c.speed) || 1, 0.05, 16), len = (c.out - c.in) / sp;
    const kf = (c.kf || []).map((q) => { const n = { ...q }; if (q.s != null) { n.w = r3(bw * q.s); n.h = r3(bh * q.s); delete n.s; } return n; });
    const o = { id: c.id, kind: "video", src: c.src, name: c.name, start: r3(t), end: r3(t + len), row: 0, in: c.in, dur: c.dur, speed: sp,
      audio: false, volume: c.volume ?? 1, fps: c.fps, vw: c.w, vh: c.h, hasAudio: c.audio, alpha: !!c.alpha, aspect: cw / ch, keepAspect: true,
      x: c.x ?? 0.5, y: c.y ?? 0.5, w: r3(bw * sc), h: r3(bh * sc), rot: c.rot || 0, opacity: c.opacity ?? 1,
      crop: c.crop || null, key: c.key, edge: c.edge, loop: c.loop, tin: c.tin, tout: c.tout, kf, kfEase: c.kfEase };
    t += len;
    return o;
  });
  p.overlays = [...conv, ...p.overlays];
  p.clips = [];
  p.v = 26;
  return p;
}
// 音量: キーフレーム(vkf: [{t: 置いた所からの秒, v: 音量 0〜2}])があれば、その間を直線でつなぐ。無ければ volume
function volAt(a, tl) {
  const ks = a.vkf;
  if (!ks?.length) return Number(a.volume ?? 1);
  if (tl <= ks[0].t) return ks[0].v;
  for (let i = 1; i < ks.length; i++) if (tl <= ks[i].t) {
    let q = (tl - ks[i - 1].t) / Math.max(1e-6, ks[i].t - ks[i - 1].t);
    if (a.vkEase !== "linear") q = q * q * (3 - 2 * q); // なめらか(書き出しと同じ)
    return ks[i - 1].v + (ks[i].v - ks[i - 1].v) * q;
  }
  return ks.at(-1).v;
}
// 再生位置の音量のキーフレームを作る / 直す
function setVolKey(a, v, tl = st.t - audioView(a).start) {
  tl = r3(clamp(tl, 0, audioLen(a)));
  a.vkf = [...(a.vkf || [])];
  const k = a.vkf.find((x) => Math.abs(x.t - tl) < 0.03);
  if (k) k.v = r3(clamp(v, 0, 2)); else a.vkf.push({ t: tl, v: r3(clamp(v, 0, 2)) });
  a.vkf.sort((x, y) => x.t - y.t);
}
// 音の大きさの一覧(サーバーで 1 回だけ読む)。読み終わったらタイムラインを描き直す
const peaks = new Map();
function getPeaks(src) {
  if (!src) return null;
  const c = peaks.get(src);
  if (c) return c.data || null;
  const e = { data: null };
  peaks.set(src, e);
  api.fetchApi(`/cca_generator/videoedit/peaks?value=${encodeURIComponent(src)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.peak) { e.data = j; if (ui?.classList.contains("open")) { clearTimeout(st.wvTimer); st.wvTimer = setTimeout(() => { drawWaves(); updateMeter(); }, 60); } } })
    .catch(() => {});
  return null;
}
// 音声の今の大きさ(0〜1)。音量・フェード・ミュートも掛ける
function levelAt(a, t) {
  const v = audioView(a), len = audioLen(a), tl = t - v.start;
  if (tl < 0 || tl >= len || a.mute) return { rms: 0, peak: 0 };
  const pk = getPeaks(a.src);
  if (!pk) return null;
  let g = volAt(a, tl);
  if (a.fadeIn > 0) g *= clamp(tl / a.fadeIn, 0, 1);
  if (a.fadeOut > 0) g *= clamp((len - tl) / a.fadeOut, 0, 1);
  const i = Math.floor((v.in + tl * v.speed) * pk.rate);
  return { rms: (pk.rms[i] || 0) * g, peak: (pk.peak[i] || 0) * g };
}
const dbOf = (x) => (x > 1e-5 ? 20 * Math.log10(x) : -Infinity);
// 選んでいる音声の音量メーター(再生位置の大きさ。-60〜+6 dB)
function updateMeter() {
  const m = ui && $('[data-c="vmeter"]');
  if (!m) return;
  const a = st.sel?.type === "au" ? findSel() : null;
  const lv = a ? levelAt(a, st.t) : null;
  const w = (x) => `${clamp((dbOf(x) + 60) / 66, 0, 1) * 100}%`;
  m.querySelector("i").style.width = lv ? w(lv.rms) : "0%";
  m.querySelector("b").style.left = lv ? w(lv.peak) : "0%";
  m.querySelector("span").textContent = lv ? (lv.peak > 1e-5 ? `${dbOf(lv.peak).toFixed(1)} dB` : "-∞ dB") : a ? T("読み込み中…") : "";
  m.classList.toggle("over", !!lv && lv.peak >= 1);
}
// タイムラインの音声の段: 波形(音量を掛けた大きさ)と、音量の線(キーフレームは点)
function drawWaves() {
  if (!ui) return;
  for (const cv of $('[data-c="rows"]').querySelectorAll("canvas.wv")) {
    const a = (P().audios || []).find((x) => x.id === Number(cv.dataset.id));
    if (!a) continue;
    const blk = cv.parentElement, w = Math.min(4000, Math.max(1, blk.clientWidth)), h = Math.max(1, blk.clientHeight);
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, w, h);
    const v = audioView(a), pk = getPeaks(a.src);
    const k = st.pxs; // 1 秒の幅
    if (pk) {
      g.fillStyle = a.mute ? "rgba(255,255,255,.18)" : "rgba(210,255,190,.55)";
      for (let x = 0; x < w; x++) {
        const tl = x / k, i = Math.floor((v.in + tl * v.speed) * pk.rate);
        const y = clamp((pk.peak[i] || 0) * volAt(a, tl), 0, 1) * (h / 2 - 2);
        if (y > 0.3) g.fillRect(x, h / 2 - y, 1, y * 2);
      }
    }
    // 音量の線(0〜200%)
    g.strokeStyle = "#ffd24d";
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x <= w; x += 2) { const y = h - 2 - clamp(volAt(a, x / k) / 2, 0, 1) * (h - 4); if (x) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = "#ffd24d";
    for (const q of a.vkf || []) { const x = q.t * k, y = h - 2 - clamp(q.v / 2, 0, 1) * (h - 4); g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  }
}
function newAudio(src, name, dur, extra = {}) {
  return { id: uid++, src, name, dur, link: null, start: 0, in: 0, out: dur, speed: 1, volume: 1, mute: false, keepPitch: true, fadeIn: 0, fadeOut: 0, ...extra };
}
// ---- 動き(キーフレーム)・トランジション(書き出し videoedit.py と同じ計算)
const DEF = { x: 0.5, y: 0.5, s: 1, w: 0.3, h: 0.3, size: 0.08, rot: 0, opacity: 1 };
const AKEYS = { clip: ["x", "y", "s", "rot", "opacity"], text: ["x", "y", "size", "rot", "opacity"], media: ["x", "y", "w", "h", "rot", "opacity"] };
const kindKey = (type, it) => (type === "clip" ? "clip" : it.kind === "text" ? "text" : "media");
const easeF = (p, mode = "smooth") => { p = clamp(p, 0, 1); return mode === "smooth" ? p * p * (3 - 2 * p) : p; };
function animState(it, keys, tl) {
  const out = {};
  for (const k of keys) out[k] = Number.isFinite(Number(it[k])) ? Number(it[k]) : DEF[k];
  const kf = [...(it.kf || [])].sort((a, b) => a.t - b.t);
  if (!kf.length) return out;
  let a, b, p = 0;
  if (tl <= kf[0].t) { a = b = kf[0]; } else if (tl >= kf[kf.length - 1].t) { a = b = kf[kf.length - 1]; } else {
    let i = 0;
    while (i < kf.length - 1 && kf[i + 1].t <= tl) i++;
    a = kf[i]; b = kf[i + 1];
    p = easeF((tl - a.t) / Math.max(1e-6, b.t - a.t), it.kfEase || "smooth");
  }
  for (const k of keys) {
    const va = Number.isFinite(Number(a[k])) ? Number(a[k]) : out[k], vb = Number.isFinite(Number(b[k])) ? Number(b[k]) : out[k];
    out[k] = va + (vb - va) * p;
  }
  return out;
}
// 第20版: 登場・退場の動き(書き出し videoedit.MOTION_IN と同じ)と、ずっと続ける動き(LOOPS)
const MOTION_IN = ["pop", "boing", "drop", "bungee", "rise", "tumble", "drift", "stagger", "flicker", "typing"];
const TRANS = ["fade", "dip_black", "dip_white", "wipe_h", "wipe_v", "slide_h", "slide_v", "split_h", "split_v", "iris_circle", "iris_box", "iris_diamond", "clock", "zoom", "spin", ...MOTION_IN, "blur"];
const MOTION_DIR = { drop: "top", bungee: "top", rise: "bottom", tumble: "left", drift: "left", stagger: "left" };
const DIR_VEC = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const LOOPS = ["sway", "pendulum", "hop", "float", "shake", "jiggle", "spin", "wave", "beat", "breathe", "blink", "flicker", "breeze", "focus"];
// 第21版: ぼかし(画面の高さに対しての割合。書き出し videoedit.BLUR_TRANS / BLUR_LOOP と同じ)
const BLUR_TRANS = 0.04, BLUR_LOOP = 0.03;
const LOOP_PIN = { sway: "b", pendulum: "t", breeze: "b" };
const PIN_VEC = { c: [0, 0], t: [0, -0.5], b: [0, 0.5], l: [-0.5, 0], r: [0.5, 0] };
const outBack = (q) => 1 + 2.70158 * (q - 1) ** 3 + 1.70158 * (q - 1) ** 2;
const outElastic = (q) => (q <= 0 ? 0 : q >= 1 ? 1 : 2 ** (-10 * q) * Math.sin((10 * q - 0.75) * (2 * Math.PI / 3)) + 1);
function outBounce(q) {
  const n1 = 7.5625, d1 = 2.75;
  if (q < 1 / d1) return n1 * q * q;
  if (q < 2 / d1) { q -= 1.5 / d1; return n1 * q * q + 0.75; }
  if (q < 2.5 / d1) { q -= 2.25 / d1; return n1 * q * q + 0.9375; }
  q -= 2.625 / d1;
  return n1 * q * q + 0.984375;
}
const hash01 = (n) => ((Math.floor(n) * 1103515245 + 12345) & 0x7fffffff) / 2147483647;
// 登場・退場の動き(大きさが決まってから)。返り値 [cx, cy, w, h]。回転・不透明度は stt に入れる
function applyMotion(stt, cx, cy, w, h, W, H) {
  for (const [t, q, d] of stt._mo || []) {
    const [vx, vy] = DIR_VEC[d] || [-1, 0];
    const [ox, oy] = vx < 0 ? [-(cx + w / 2), 0] : vx > 0 ? [W + w / 2 - cx, 0] : vy < 0 ? [0, -(cy + h / 2)] : [0, H + h / 2 - cy];
    if (t === "pop" || t === "boing") {
      const f = Math.max(0.001, t === "pop" ? outBack(q) : outElastic(q));
      w *= f; h *= f;
      stt.opacity *= Math.min(1, q * (t === "pop" ? 3 : 4));
    } else if (t === "drop" || t === "bungee" || t === "tumble") {
      const e = t === "drop" ? outBounce(q) : t === "bungee" ? outElastic(q) : easeF(q);
      cx += ox * (1 - e); cy += oy * (1 - e);
      if (t === "tumble") stt.rot += (vx < 0 || vy < 0 ? -360 : 360) * (1 - e);
    } else if (t === "rise" || t === "drift" || t === "stagger") {
      const e = easeF(q);
      const dist = t === "rise" ? (vy ? h : w) * 0.8 : (t === "drift" ? 0.12 : 0.25) * (vx ? W : H);
      cx += vx * dist * (1 - e); cy += vy * dist * (1 - e);
      if (t === "stagger") { stt.rot += Math.sin(q * 4 * Math.PI) * (1 - q) * 18; stt.opacity *= Math.min(1, q * 3); } else stt.opacity *= e;
    } else if (t === "flicker") {
      if (!(q >= 1 || hash01(Math.floor(q * 14) + 1) < 0.2 + 0.8 * q)) stt.opacity *= 0.05;
    }
  }
  return [cx, cy, w, h];
}
// ずっと続ける動き。支点(pin)のまわりに回す・大きさを変える。返り値 [cx, cy, w, h]
function applyLoop(stt, lp, t, cx, cy, w, h) {
  if (!lp || !LOOPS.includes(lp.type)) return [cx, cy, w, h];
  const f = clamp(Number(lp.speed) || 1, 0.05, 10), a = clamp(Number(lp.amt ?? 1), 0, 3), TAU = 2 * Math.PI;
  let rot = 0, sc = 1, dx = 0, dy = 0, op = 1;
  switch (lp.type) {
    case "sway": rot = Math.sin(TAU * 0.8 * f * t) * 10 * a; break;
    case "pendulum": rot = Math.sin(TAU * 0.6 * f * t) * 28 * a; break;
    case "hop": dy = -Math.abs(Math.sin(Math.PI * 1.6 * f * t)) * 0.18 * h * a; break;
    case "float": dy = Math.sin(TAU * 0.5 * f * t) * 0.08 * h * a; dx = Math.sin(TAU * 0.25 * f * t) * 0.03 * w * a; break;
    case "shake": { const n = Math.floor(t * 24 * f); dx = (hash01(n * 2 + 1) - 0.5) * 0.06 * w * a; dy = (hash01(n * 2 + 2) - 0.5) * 0.06 * h * a; break; }
    case "jiggle": rot = Math.sin(TAU * 3 * f * t) * 4 * a; sc = 1 + Math.sin(TAU * 6 * f * t) * 0.02 * a; break;
    case "spin": rot = 360 * 0.5 * f * t * (lp.dir === "ccw" ? -1 : 1); break;
    case "wave": dy = Math.sin(TAU * 0.7 * f * t) * 0.15 * h * a; rot = Math.cos(TAU * 0.7 * f * t) * 7 * a; break;
    case "beat": { const ph = (0.9 * f * t) % 1; sc = 1 + 0.12 * a * (Math.exp(-(((ph - 0.1) / 0.06) ** 2)) + 0.6 * Math.exp(-(((ph - 0.3) / 0.06) ** 2))); break; }
    case "breathe": sc = 1 + 0.06 * a * (0.5 - 0.5 * Math.cos(TAU * 0.3 * f * t)); break;
    case "blink": op = 1 - Math.min(1, 0.65 * a) * (0.5 - 0.5 * Math.cos(TAU * 1.2 * f * t)); break;
    case "flicker": op = hash01(Math.floor(t * 12 * f) + 3) < 0.22 * a ? 0.1 : 1; break;
    case "breeze": rot = Math.sin(TAU * 0.9 * f * t) * 5 * a; dx = Math.sin(TAU * 0.9 * f * t + 1) * 0.02 * w * a; break;
    case "focus": stt.blur = (stt.blur || 0) + BLUR_LOOP * a * (0.5 - 0.5 * Math.cos(TAU * 0.5 * f * t)); break;
  }
  const [px, py] = PIN_VEC[lp.pin || LOOP_PIN[lp.type] || "c"] || [0, 0];
  const rx = px * w, ry = py * h, b = (stt.rot * Math.PI) / 180;
  const rwx = rx * Math.cos(b) - ry * Math.sin(b), rwy = rx * Math.sin(b) + ry * Math.cos(b);
  const th = (rot * Math.PI) / 180;
  const qx = (rwx * Math.cos(th) - rwy * Math.sin(th)) * sc, qy = (rwx * Math.sin(th) + rwy * Math.cos(th)) * sc;
  stt.rot += rot;
  stt.opacity *= op;
  return [cx + rwx - qx + dx, cy + rwy - qy + dy, w * sc, h * sc];
}
function transP(tr, v) { return tr && TRANS.includes(tr.type) ? clamp(v / Math.max(0.01, Number(tr.dur) || 0.5), 0, 1) : null; }
// 位置・大きさ・回転・不透明度で表すもの。返り値: ディップ { amt, color } または null
function transState(stt, tr, p, key) {
  if (p == null || p >= 1) return null;
  const q = easeF(p);
  const t = tr.type;
  const sk = key === "clip" ? ["s"] : key === "text" ? ["size"] : ["w", "h"];
  // ぼかし → 鮮明(出るときは 鮮明 → ぼかし)。ほかの効果にも「ぼかしも重ねる」で足せる
  if (t === "blur" || tr.blur) stt.blur = (stt.blur || 0) + (1 - q) * BLUR_TRANS;
  if (t === "fade") stt.opacity *= q;
  else if (t === "slide_h" || t === "slide_v") (stt._slide ||= []).push([t, q, t === "slide_h" ? !!tr.flipH : !!tr.flipV]);
  else if (t === "zoom" || t === "spin") {
    const f = tr.rev ? 1 + 2 * (1 - q) : Math.max(0.001, q);
    for (const k of sk) stt[k] *= f;
    if (t === "spin") stt.rot += (1 - q) * 360 * (tr.flipH ? -1 : 1);
    if (tr.rev) stt.opacity *= q;
  } else if (t === "dip_black" || t === "dip_white") return { amt: 1 - q, color: t === "dip_black" ? "#000" : "#fff" };
  else if (t === "typing") { if (key === "text") stt._reveal = Math.min(stt._reveal ?? 1, p); else stt.opacity *= p; }
  else if (MOTION_IN.includes(t)) (stt._mo ||= []).push([t, p, DIR_VEC[tr.dir] ? tr.dir : MOTION_DIR[t] || "left"]);
  return null;
}
function slidePos(stt, cx, cy, w, h, W, H) {
  for (const [t, q, flip] of stt._slide || []) {
    if (t === "slide_h") { const s0 = flip ? W + w / 2 : -w / 2; cx = s0 + (cx - s0) * q; }
    else { const s0 = flip ? H + h / 2 : -h / 2; cy = s0 + (cy - s0) * q; }
  }
  return [cx, cy];
}
// 形で出す・消すもの → CSS の clip-path(w・h は要素の px)
function clipPathOf(tr, p, w, h) {
  if (p == null || p >= 1 || !tr) return "";
  const q = easeF(p), t = tr.type, f = (v) => `${(v * 100).toFixed(3)}%`;
  const hole = (pts) => `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(", ")}, ${f(pts[0][0])} ${f(pts[0][1])})`;
  if (t === "wipe_h") return tr.flipH ? `inset(0 0 0 ${f(1 - q)})` : `inset(0 ${f(1 - q)} 0 0)`;
  if (t === "wipe_v") return tr.flipV ? `inset(${f(1 - q)} 0 0 0)` : `inset(0 0 ${f(1 - q)} 0)`;
  if (t === "split_h") return tr.rev ? hole([[(q) / 2, 0], [1 - q / 2, 0], [1 - q / 2, 1], [q / 2, 1]]) : `inset(0 ${f((1 - q) / 2)} 0 ${f((1 - q) / 2)})`;
  if (t === "split_v") return tr.rev ? hole([[0, q / 2], [1, q / 2], [1, 1 - q / 2], [0, 1 - q / 2]]) : `inset(${f((1 - q) / 2)} 0 ${f((1 - q) / 2)} 0)`;
  if (t === "iris_box") { const m = (1 - q) / 2; if (!tr.rev) return `inset(${f(m)})`; const k = q / 2; return hole([[k, k], [1 - k, k], [1 - k, 1 - k], [k, 1 - k]]); }
  if (t === "iris_diamond") {
    const r = tr.rev ? 1 - q : q, d = [[0.5, 0.5 - r], [0.5 + r, 0.5], [0.5, 0.5 + r], [0.5 - r, 0.5]];
    return tr.rev ? hole(d) : `polygon(${d.map(([x, y]) => `${f(x)} ${f(y)}`).join(", ")})`;
  }
  if (t === "iris_circle") {
    if (!tr.rev) return `circle(${(q * 70.7107).toFixed(3)}% at 50% 50%)`;
    const R = (1 - q) * 0.5 * Math.hypot(w, h), cx = w / 2, cy = h / 2;
    return `path(evenodd, "M0 0 H${w} V${h} H0 Z M${cx - R} ${cy} A${R} ${R} 0 1 0 ${cx + R} ${cy} A${R} ${R} 0 1 0 ${cx - R} ${cy} Z")`;
  }
  if (t === "clock") {
    const pts = [[0.5, 0.5], [0.5, -1]], n = Math.max(2, Math.ceil(q * 72));
    for (let i = 1; i <= n; i++) { const a = (q * i / n) * 2 * Math.PI * (tr.flipH ? -1 : 1); pts.push([0.5 + 2 * Math.sin(a), 0.5 - 2 * Math.cos(a)]); }
    return `polygon(${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(", ")})`;
  }
  return "";
}
// そのレイヤーの、時刻 tl(始まりからの秒)での見た目 { 値, ディップ, clip-path(入る・出る) }
function lookAt(it, type, tl, len) {
  const key = kindKey(type, it);
  const stt = animState(it, AKEYS[key], tl);
  const pin = transP(it.tin, tl), pout = transP(it.tout, len - tl);
  const dip = transState(stt, it.tin, pin, key) || transState(stt, it.tout, pout, key);
  return { stt, dip, pin, pout };
}
function snapshot() { return JSON.stringify(P()); }
function commit(before) {
  if (st.batch) return; // ドラッグ&ドロップでいくつも入れるときは、最後にまとめて 1 回で戻せるようにする
  if (before === snapshot()) return;
  st.undo.push(before);
  st.pathPrev = null;
  if (st.undo.length > MAX_UNDO) st.undo.shift();
  st.redo = [];
  st.dirty = true;
}
function change(fn) { const b = snapshot(); fn(); commit(b); refresh(); }
function undo() {
  if (!st.pathDraw && st.pathPrev) { st.pathDraw = st.pathPrev; st.pathPrev = null; st.sel = null; st.msel = []; refresh(); renderPathCv(); renderInspector(); return; } if (!st.undo.length) return; st.redo.push(snapshot()); st.proj = JSON.parse(st.undo.pop()); st.dirty = true; afterLoad(); }
function redo() { if (!st.redo.length) return; st.undo.push(snapshot()); st.proj = JSON.parse(st.redo.pop()); st.dirty = true; afterLoad(); }
function afterLoad() {
  if (st.sel && !findSel()) st.sel = null;
  st.t = clamp(st.t, 0, total());
  st.cur = -1;
  refresh();
  seek(st.t);
}
// ---- 第26版: 複数選択(Shift / Ctrl を押しながら押す)。レイヤー(文字・画像・動画・モザイク)だけ
function selOvIds() {
  if (st.msel.length) return st.msel.filter((id) => P().overlays.some((o) => o.id === id));
  return st.sel?.type === "ov" && P().overlays.some((o) => o.id === st.sel.id) ? [st.sel.id] : [];
}
const selOvs = () => { const ids = new Set(selOvIds()); return P().overlays.filter((o) => ids.has(o.id)); };
const isSelOv = (id) => selOvIds().includes(id);
function toggleOv(id) {
  const cur = selOvIds();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  st.msel = next.length > 1 ? next : [];
  st.sel = next.length ? { type: "ov", id: next.at(-1) } : null;
}
function findSel() {
  if (!st.sel) return null;
  if (st.sel.type === "au") return (P().audios || []).find((a) => a.id === st.sel.id);
  return st.sel.type === "clip" ? P().clips.find((c) => c.id === st.sel.id) : P().overlays.find((o) => o.id === st.sel.id);
}

async function probe(value) {
  const r = await api.fetchApi(`/cca_generator/videoedit/probe?value=${encodeURIComponent(value)}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status}`);
  return j;
}
// 動画を足す(第26版: 段 opt.row(省くといちばん下)の最後か opt.start に、画面に収まる大きさで。音は音声の段につないで置く)
async function addClip(value, opt = {}) {
  if (typeof opt !== "object" || opt === null) opt = {};
  const info = await probe(value);
  if (info.video === false) throw new Error(T("音声だけのファイルは、音声の段に入れてください"));
  const first = !P().overlays.some((o) => o.kind === "video");
  const row = opt.row ?? 0;
  const o = { id: uid++, kind: "video", src: value, name: nameOf(value), row, in: 0, dur: info.duration, speed: 1, audio: false, volume: 1,
    fps: info.fps, vw: info.width, vh: info.height, hasAudio: !!info.audio, alpha: !!info.alpha, aspect: (info.width || 16) / (info.height || 9), keepAspect: true,
    x: 0.5, y: 0.5, rot: 0, opacity: 1, crop: null };
  change(() => {
    // 何も入っていなければ、書き出す大きさ・fps をこの動画に合わせる
    if (first && !P().overlays.length) { P().size = [Math.max(16, Math.round((info.width || 1280) / 2) * 2), Math.max(16, Math.round((info.height || 720) / 2) * 2)]; P().fps = r3(info.fps || 24); }
    [o.w, o.h] = fitWH(o.vw, o.vh, null);
    o.start = r3(Math.max(0, opt.start ?? rowEnd(row)));
    o.end = r3(o.start + info.duration);
    P().overlays.push(o);
    normRows();
    if (info.audio) P().audios.push(newAudio(value, nameOf(value), info.duration, { link: o.id }));
    st.sel = { type: "ov", id: o.id };
  });
  if (first) seek(o.start);
  return o;
}
// 書き出す大きさ・fps を動画に合わせる(選んだ動画。選んでいなければ最初の動画。切り取った範囲の大きさで、その動画は画面いっぱいに)
function fitFirst(o = null) {
  const sel = findSel();
  o = o || (st.sel?.type === "ov" && sel?.kind === "video" ? sel : null)
    || P().overlays.filter((x) => x.kind === "video").sort((a, b) => a.start - b.start || rowOf(a) - rowOf(b))[0];
  if (!o) return;
  const cw = o.crop ? o.crop[2] : o.vw || 16, ch = o.crop ? o.crop[3] : o.vh || 9;
  setFrameSize(Math.max(16, Math.round(cw / 2) * 2), Math.max(16, Math.round(ch / 2) * 2));
  P().fps = r3(o.fps || 24);
  [o.w, o.h] = fitWH(o.vw, o.vh, o.crop);
  o.x = 0.5; o.y = 0.5;
}
// 書き出す大きさを変える。画像・動画は縦横比を保つ(幅はそのままで高さを合わせる)
function setFrameSize(W2, H2) {
  const [W, H] = P().size;
  P().size = [W2, H2];
  if (W === W2 && H === H2) return;
  for (const o of P().overlays) {
    if (!["image", "video"].includes(o.kind) || o.keepAspect === false) continue;
    const a = o.aspect || (o.kind === "video" ? (o.crop ? o.crop[2] / o.crop[3] : (o.vw || 16) / (o.vh || 9)) : 1);
    const k = (o.w * W) / W2; // 画面に対しての幅は、元の幅の画素が同じ割合になるように
    o.w = r3(k);
    o.h = r3(clamp((o.w * W2) / a / H2, 0.005, 8));
    for (const q of o.kf || []) if (q.w != null) { q.w = r3((q.w * W) / W2); q.h = r3(clamp((q.w * W2) / a / H2, 0.005, 8)); }
  }
}
function natSize(kind, value) {
  return new Promise((res) => {
    const el = document.createElement(kind === "image" ? "img" : "video");
    const done = () => res(kind === "image" ? [el.naturalWidth || 1, el.naturalHeight || 1] : [el.videoWidth || 16, el.videoHeight || 9]);
    if (kind === "image") { el.onload = done; el.onerror = () => res([1, 1]); }
    else { el.preload = "metadata"; el.onloadedmetadata = done; el.onerror = () => res([16, 9]); }
    el.src = viewUrl(value);
  });
}
// opt: { start(秒), x, y(置く所の中心 0〜1), index(重なる順番。大きいほど手前) }。省くと再生位置・真ん中・いちばん手前
async function addOverlay(kind, value, opt = {}) {
  const D = total() || 3;
  const start = r3(Math.max(0, opt.start ?? clamp(st.t, 0, Math.max(0, D - MIN_LEN))));
  const o = { id: uid++, kind, start, end: r3(Math.min(D, start + 3) > start + MIN_LEN ? Math.min(D, start + 3) : start + 3), opacity: 1 };
  if (kind === "text") Object.assign(o, { text: T("テキスト"), size: 0.08, color: "#ffffff", stroke: "#000000", strokeWidth: 0.08, bg: "#000000", bgAlpha: 0, x: 0.5, y: 0.85, w: 0.5, h: 0.1 });
  else if (kind === "shape") {
    // 図形: 画面の真ん中に正方形(画面の高さの 30%)。パスを描いたときは、その枠(opt)
    const [W, H] = P().size;
    const h = opt.h ?? 0.3, w = opt.w ?? r3((h * H) / W);
    Object.assign(o, { name: T(opt.shape === "path" ? "パス" : "図形"), x: r3(opt.x ?? 0.5), y: r3(opt.y ?? 0.5), w, h, rot: 0,
      shape: opt.shape || "rect", fill: "#ffffff", fillA: 1, radius: 0.25, points: 5 });
    if (opt.pts) Object.assign(o, { pts: opt.pts, closed: opt.closed !== false, strokeW: opt.strokeW ?? 0.01, noFill: !!opt.noFill,
      fill: opt.fill || "#ffffff", fillA: opt.fillA ?? 1 });
  } else if (kind === "mosaic") {
    // モザイク: 画面の真ん中に正方形(画面の高さの 25%)。置いた所の下の段を加工する
    const [W, H] = P().size;
    const h = 0.25, w = r3((h * H) / W);
    Object.assign(o, { name: T("モザイク"), x: r3(opt.x ?? 0.5), y: r3(opt.y ?? 0.5), w, h, rot: 0, mosaic: "pixel", block: 0.03, shape: "rect", color: "#000000" });
  } else {
    const [nw, nh] = await natSize(kind, value);
    const [W, H] = P().size;
    const w = kind === "image" ? 0.3 : 0.35;
    const h = clamp((w * W * nh) / nw / H, 0.02, 1);
    Object.assign(o, { src: value, name: nameOf(value), w, h, aspect: nw / nh,
      x: r3(clamp(opt.x ?? 0.5, w / 2, 1 - w / 2)), y: r3(clamp(opt.y ?? 0.5, h / 2, 1 - h / 2)) });
    if (kind === "video") {
      const info = await probe(value);
      // fps・大きさ・音の有無は「動画」の段へ移すときに使う
      Object.assign(o, { in: 0, dur: info.duration, audio: false, volume: 1, fps: info.fps, vw: info.width, vh: info.height, hasAudio: info.audio, alpha: !!info.alpha });
      o.end = r3(o.start + info.duration);
    }
  }
  o.row = opt.row ?? rowCount();
  change(() => {
    P().overlays.push(o);
    normRows();
    if (kind === "video" && o.hasAudio) P().audios.push(newAudio(value, o.name, o.dur, { link: o.id }));
    st.sel = { type: "ov", id: o.id };
  });
  renderOverlays();
  return o;
}
// 「動画」の段の動画 ⇄ 重ねる動画(段をまたいでドラッグしたとき)
function clipToOverlay(c, start) {
  const [W, H] = P().size;
  const nw = c.w || 16, nh = c.h || 9, w = 0.35;
  const la = (P().audios || []).find((a) => a.link === c.id);
  return { id: uid++, kind: "video", src: c.src, name: c.name, start: r3(Math.max(0, start)), end: r3(Math.max(0, start) + lenOf(c)), opacity: 1,
    in: c.in, dur: c.dur, audio: !!la && !la.mute && la.volume > 0, volume: la ? la.volume : 1, fps: c.fps, vw: c.w, vh: c.h, hasAudio: c.audio,
    speed: spd(c), alpha: !!c.alpha, key: c.key, rot: 0,
    x: 0.5, y: 0.5, w, h: clamp((w * W * nh) / nw / H, 0.02, 1), aspect: nw / nh };
}
function overlayToClip(o) {
  const dur = o.dur || (o.end - o.start);
  const a = clamp(o.in || 0, 0, Math.max(0, dur - MIN_LEN));
  return { id: uid++, src: o.src, name: o.name, dur, fps: o.fps || P().fps, w: o.vw || 16, h: o.vh || 9, audio: o.hasAudio ?? true,
    in: r3(a), out: r3(clamp(a + (o.end - o.start) * spd(o), a + MIN_LEN, dur)), crop: null, volume: o.volume ?? 1, speed: spd(o), alpha: !!o.alpha, key: o.key };
}
// 選んだもの(つなげる動画・文字・画像・重ねる動画)を、再生位置で 2 つに分ける。再生位置がその外なら真ん中で分ける。
// 何も選んでいないときは、再生位置の動画を分ける
function splitSel() {
  let s = findSel(), type = st.sel?.type;
  if (!s) {
    const at = clipAt(st.t);
    if (!at) return;
    s = at.c; type = "clip";
  }
  if (type === "au" && s.link != null) { s = P().clips.find((c) => c.id === s.link); type = "clip"; if (!s) return; }
  const s0 = type === "clip" ? starts()[P().clips.indexOf(s)] : type === "au" ? s.start : s.start;
  const len = type === "clip" ? lenOf(s) : type === "au" ? audioLen(s) : s.end - s.start;
  if (len < MIN_LEN * 2) { ctx.notify("短すぎて分けられません", "error"); return; }
  let t = st.t, mid = false;
  if (!(t >= s0 + MIN_LEN && t <= s0 + len - MIN_LEN)) { t = s0 + len / 2; mid = true; }
  t = r3(t);
  change(() => {
    if (type === "clip") {
      const local = r3(s.in + (t - s0) * spd(s));
      const b2 = { ...s, id: uid++, in: local, kf: shiftKf(s.kf, t - s0), tin: null };
      s.out = local;
      s.tout = null;
      P().clips.splice(P().clips.indexOf(s) + 1, 0, b2);
      for (const a of P().audios.filter((x) => x.link === s.id)) P().audios.push({ ...a, id: uid++, link: b2.id });
      st.sel = { type: "clip", id: b2.id };
    } else if (type === "au") {
      const local = r3(s.in + (t - s.start) * spd(s));
      const b2 = { ...s, id: uid++, start: t, in: local, fadeIn: 0 };
      s.out = local;
      s.fadeOut = 0;
      P().audios.splice(P().audios.indexOf(s) + 1, 0, b2);
      st.sel = { type: "au", id: b2.id };
    } else {
      const b2 = { ...s, id: uid++, start: t, kf: shiftKf(s.kf, t - s.start), tin: null };
      s.tout = null;
      if (s.kind === "video") b2.in = r3((s.in || 0) + (t - s.start) * spd(s));
      s.end = t;
      P().overlays.splice(P().overlays.indexOf(s) + 1, 0, b2);
      for (const a of P().audios.filter((x) => x.link === s.id)) P().audios.push({ ...a, id: uid++, link: b2.id });
      st.sel = { type: "ov", id: b2.id };
    }
  });
  st.cur = -1;
  seek(t);
  if (mid) ctx.notify("再生位置が選んだものの外だったので、真ん中で分けました", "info");
}
// キーフレームを後ろの部分に合わせてずらす(分けた後ろの部分の始まりが 0 秒)
function shiftKf(kf, dt) { return kf?.length ? kf.map((k) => ({ ...k, t: r3(k.t - dt) })) : kf; }
function deleteSel() {
  if (st.msel.length > 1) {
    const ids = new Set(selOvIds());
    change(() => {
      P().overlays = P().overlays.filter((o) => !ids.has(o.id));
      P().audios = P().audios.filter((a) => !ids.has(a.link));
      normRows();
      st.sel = null; st.msel = [];
    });
    st.cur = -1;
    seek(clamp(st.t, 0, total()));
    return;
  }
  if (!st.sel) return;
  change(() => {
    if (st.sel.type === "clip") {
      P().clips = P().clips.filter((c) => c.id !== st.sel.id);
      P().audios = P().audios.filter((a) => a.link !== st.sel.id); // つながっている音声も
    } else if (st.sel.type === "au") P().audios = P().audios.filter((a) => a.id !== st.sel.id);
    else {
      P().overlays = P().overlays.filter((o) => o.id !== st.sel.id);
      P().audios = P().audios.filter((a) => a.link !== st.sel.id); // つながっている音声も
      normRows();
    }
    st.sel = null;
  });
  st.cur = -1;
  seek(clamp(st.t, 0, total()));
}

// 選んだもの(動画・文字・画像・音声)を複製する。つなげる動画はすぐ後ろへ、レイヤー・音声は終わりのすぐ後へ
function duplicateSel() {
  const s = findSel(), type = st.sel?.type;
  if (!s) { ctx.notify("複製するものを選んでください", "error"); return; }
  let seekTo = null;
  change(() => {
    if (type === "clip") {
      const c2 = JSON.parse(JSON.stringify({ ...s, id: uid++ }));
      const i = P().clips.indexOf(s);
      P().clips.splice(i + 1, 0, c2);
      for (const a of P().audios.filter((x) => x.link === s.id)) P().audios.push({ ...a, id: uid++, link: c2.id });
      st.sel = { type: "clip", id: c2.id };
      seekTo = starts()[i + 1];
    } else if (type === "au") {
      const v = audioView(s), len = audioLen(s);
      const a2 = { ...s, id: uid++, link: null, start: r3(v.start + len), in: v.in, out: v.out, speed: v.speed };
      P().audios.splice(P().audios.indexOf(s) + 1, 0, a2);
      st.sel = { type: "au", id: a2.id };
      seekTo = a2.start;
    } else {
      const len = s.end - s.start;
      const o2 = JSON.parse(JSON.stringify({ ...s, id: uid++, start: r3(s.end), end: r3(s.end + len) }));
      P().overlays.splice(P().overlays.indexOf(s) + 1, 0, o2);
      for (const a of P().audios.filter((x) => x.link === s.id)) P().audios.push({ ...a, id: uid++, link: o2.id });
      st.sel = { type: "ov", id: o2.id };
      seekTo = o2.start;
    }
  });
  st.cur = -1;
  if (seekTo != null) seek(seekTo);
  ctx.notify("複製しました", "info");
}
// ---- コピー・切り取り・貼り付け(Ctrl+C / X / V)。画像編集の文字も貼り付けられる
const deep = (x) => JSON.parse(JSON.stringify(x));
function copySel(cut = false) {
  if (st.msel.length > 1) {
    const list = selOvs();
    const t0 = Math.min(...list.map((o) => o.start));
    clipboard.set({ type: "ovs", t0, items: list.map((o) => ({ ov: o, audios: P().audios.filter((a) => a.link === o.id) })) });
    if (cut) deleteSel();
    ctx.notify(cut ? "切り取りました(Ctrl+V で貼り付け)" : "コピーしました(Ctrl+V で一段上に貼り付け)", "info");
    return true;
  }
  const s = findSel(), type = st.sel?.type;
  if (!s) return false;
  if (type === "clip") clipboard.set({ type, clip: s, audios: P().audios.filter((a) => a.link === s.id) });
  else if (type === "au") { const v = audioView(s); clipboard.set({ type, audio: { ...s, link: null, start: v.start, in: v.in, out: v.out, speed: v.speed } }); }
  else clipboard.set(s.kind === "text" ? { type: "ov", ov: s, text: pickText(s) } : { type: "ov", ov: s, audios: P().audios.filter((a) => a.link === s.id) });
  if (cut) deleteSel();
  ctx.notify(cut ? "切り取りました(Ctrl+V で貼り付け)" : type === "ov" ? "コピーしました(Ctrl+V で一段上に貼り付け)" : "コピーしました(Ctrl+V で再生位置に貼り付け)", "info");
  return true;
}
function pasteClip() {
  const c = clipboard.get();
  if (!c) return false;
  if (c.type === "ovs") {
    // いくつものレイヤー: 元のレイヤーのすぐ上に、同じ始まり・同じ重なり方で(上の段は、その分だけ上へ)
    const made = [];
    change(() => {
      const rs = (c.items || []).map((it) => rowOf(it.ov));
      const lo = Math.min(...rs), hi = Math.max(...rs), gap = hi - lo + 1;
      for (const x of P().overlays) if (rowOf(x) > hi) x.row = rowOf(x) + gap;
      for (const it of c.items || []) {
        const o = { ...deep(it.ov), id: uid++ };
        o.row = rowOf(it.ov) + gap;
        P().overlays.push(o);
        for (const a of it.audios || []) P().audios.push({ ...deep(a), id: uid++, link: o.id });
        made.push(o.id);
      }
      normRows();
      st.sel = made.length ? { type: "ov", id: made.at(-1) } : null;
      st.msel = made.length > 1 ? made : [];
    });
    st.cur = -1;
    seek(st.t);
    ctx.notify("一段上に貼り付けました", "info");
    return true;
  }
  let seekTo = null;
  change(() => {
    if (c.type === "clip") {
      const cl = { ...deep(c.clip), id: uid++ };
      const at = P().clips.length ? clipAt(st.t) : null;
      const i = at ? at.i + 1 : P().clips.length;
      P().clips.splice(i, 0, cl);
      for (const a of c.audios || []) P().audios.push({ ...a, id: uid++, link: cl.id });
      if (P().clips.length === 1) fitFirst();
      st.sel = { type: "clip", id: cl.id };
      seekTo = starts()[i];
    } else if (c.type === "au") {
      const a = { ...c.audio, id: uid++, link: null, start: r3(st.t) };
      P().audios.push(a);
      st.sel = { type: "au", id: a.id };
    } else {
      // レイヤー: この画面でコピーしたレイヤーは、元のレイヤーの一段上に、同じ始まりで(上の段は 1 つずつ上へ)。画像編集の文字は、再生位置からいちばん上の段に 3 秒
      const o = c.ov ? { ...deep(c.ov), id: uid++ } : { id: uid++, kind: "text", ...c.text, start: 0, end: 3 };
      const len = Math.max(MIN_LEN, (o.end ?? 3) - (o.start ?? 0));
      if (c.ov && Number.isInteger(c.ov.row)) {
        const r0 = c.ov.row;
        for (const x of P().overlays) if (rowOf(x) > r0) x.row = rowOf(x) + 1;
        o.row = r0 + 1;
        o.start = r3(c.ov.start ?? 0);
      } else {
        o.start = r3(st.t);
        o.row = rowCount();
      }
      o.end = r3(o.start + len);
      if (o.kind === "text") Object.assign(o, { x: o.x ?? 0.5, y: o.y ?? 0.5, w: o.w ?? 0.5, h: o.h ?? 0.1 });
      P().overlays.push(o);
      for (const a of c.audios || []) P().audios.push({ ...deep(a), id: uid++, link: o.id });
      normRows();
      st.sel = { type: "ov", id: o.id };
    }
  });
  st.cur = -1;
  seek(seekTo ?? st.t);
  ctx.notify("貼り付けました", "info");
  return true;
}
// 音声(音声ファイル・動画の音)を音声の段に置く。start: 置く時刻(省くと再生位置)
async function addAudioItem(value, start = null) {
  const info = await probe(value);
  if (!info.audio) throw new Error(T("このファイルには音がありません"));
  const a = newAudio(value, nameOf(value), info.duration, { start: r3(Math.max(0, start ?? st.t)) });
  change(() => { P().audios.push(a); st.sel = { type: "au", id: a.id }; });
  return a;
}

// ---------------------------------------------------------------- プレビュー
function frameRect() {
  const sr = $('[data-c="stage"]').getBoundingClientRect();
  const [W, H] = P().size;
  const z = st.vz.z;
  // 枠を強調表示するときは、線が見えるように太さの分だけ余白を広げる
  const pad = 16 + frameHlPad(st.fhl) * 2;
  const k = Math.min((sr.width - pad) / W, (sr.height - pad) / H) * z;
  const fw = Math.max(1, W * k), fh = Math.max(1, H * k);
  return { fw, fh, k, left: (sr.width - fw) / 2 + st.vz.px, top: (sr.height - fh) / 2 + st.vz.py };
}
// 拡大率を変える(cx, cy: 画面のこの点を動かさない。省くと真ん中)
function setZoom(z, cx = null, cy = null) {
  const sr = $('[data-c="stage"]').getBoundingClientRect();
  const r0 = frameRect();
  z = clamp(z, 0.25, 8);
  const ax = cx == null ? sr.width / 2 : cx - sr.left, ay = cy == null ? sr.height / 2 : cy - sr.top;
  // その点の、画面に対しての位置(0〜1)
  const u = (ax - r0.left) / r0.fw, v = (ay - r0.top) / r0.fh;
  st.vz.z = z;
  $('[data-c="stage"]').classList.toggle("zoomed", z > 1.001); // 拡大中は外側をつかんで動かせる
  const r1 = frameRect();
  st.vz.px += ax - (r1.left + u * r1.fw);
  st.vz.py += ay - (r1.top + v * r1.fh);
  if (Math.abs(z - 1) < 1e-3) { st.vz.px = 0; st.vz.py = 0; st.vz.z = 1; }
  $('[data-c="zoomp"]').textContent = `${Math.round(st.vz.z * 100)}%`;
  placeMain();
  renderOverlays();
}
function layoutFrame() {
  const f = $('[data-c="frame"]');
  const r = frameRect();
  Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.fw}px`, height: `${r.fh}px` });
  return r;
}
// 今の動画を置く: 枠に収めた大きさ × 大きさ(s)・位置・回転・不透明度・動き・トランジション(切り取りの指定中は動画全体をそのまま見せる)
function placeMain(at = P().clips.length ? clipAt(st.t) : null) {
  const r = layoutFrame();
  const frame = $('[data-c="frame"]');
  frame.dataset.bg = P().bg || "black";
  const win = $('[data-c="win"]'), v = vmain();
  const co = st.cropMode && st.sel?.type === "ov" ? findSel() : null;
  if (co?.kind === "video") { cropModeObj(co, r, win, v); return; }
  if (!at || st.t > total() + 1e-6) { win.style.display = "none"; $('[data-c="wbox"]').style.display = "none"; $('[data-c="cropbox"]')?.remove(); return; }
  win.style.display = "";
  const c = at.c;
  const kc = $('[data-c="keycv"]');
  if (st.cropMode) {
    const s0 = Math.min(r.fw / c.w, r.fh / c.h);
    Object.assign(win.style, { left: `${(r.fw - c.w * s0) / 2}px`, top: `${(r.fh - c.h * s0) / 2}px`, width: `${c.w * s0}px`, height: `${c.h * s0}px`, transform: "", opacity: 1, clipPath: "", filter: "" });
    Object.assign(v.style, { width: `${c.w * s0}px`, height: `${c.h * s0}px`, left: "0px", top: "0px", opacity: 1 });
    kc.style.display = "none";
    $('[data-c="wbox"]').style.display = "none";
    featherMask(v, 0); $('[data-c="ebc"]').style.display = "none"; win.style.filter = "";
    renderCrop(c, s0, win);
    return;
  }
  $('[data-c="cropbox"]')?.remove(); // 切り取りの指定を終えたら枠を消す
  const cr = c.crop || [0, 0, c.w, c.h];
  const tl = st.t - at.s, L = lenOf(c);
  const { stt, dip, pin, pout } = lookAt(c, "clip", tl, L);
  let s = Math.min(r.fw / cr[2], r.fh / cr[3]) * stt.s;
  const w0 = cr[2] * s, h0 = cr[3] * s;
  let [cx, cy] = slidePos(stt, stt.x * r.fw, stt.y * r.fh, w0, h0, r.fw, r.fh);
  let w, h;
  [cx, cy, w, h] = applyMotion(stt, cx, cy, w0, h0, r.fw, r.fh);
  [cx, cy, w, h] = applyLoop(stt, c.loop, tl, cx, cy, w, h);
  s *= w / Math.max(1e-6, w0);
  const tf = Math.abs(stt.rot) > 0.01 ? `rotate(${stt.rot}deg)` : "";
  Object.assign(win.style, {
    left: `${cx - w / 2}px`, top: `${cy - h / 2}px`, width: `${w}px`, height: `${h}px`,
    transform: tf, opacity: clamp(stt.opacity, 0, 1),
    clipPath: clipPathOf(c.tin, pin, w, h) || clipPathOf(c.tout, pout, w, h) || "", filter: fxFilter(stt, dip, r.fh),
  });
  Object.assign(v.style, { width: `${c.w * s}px`, height: `${c.h * s}px`, left: `${-cr[0] * s}px`, top: `${-cr[1] * s}px` });
  // ふちのぼかし: 動画と色で抜いた canvas に、見えている範囲(切り取り)に合わせた mask。外側だけぼかすは、下にぼかした写し
  const eg = edgeOf(c), ebc = $('[data-c="ebc"]');
  const ef = eg ? clamp(Number(eg.size ?? 0.15), 0, 0.5) * Math.min(w, h) : 0;
  featherMask(v, ef, w, h, cr[0] * s, cr[1] * s);
  featherMask($('[data-c="keycv"]'), ef, w, h);
  if (eg?.mode === "blur") { drawEdgeBlur(ebc, c.key?.mode === "chroma" ? $('[data-c="keycv"]') : v, c.key?.mode === "chroma" ? [0, 0, $('[data-c="keycv"]').width, $('[data-c="keycv"]').height] : cr, w, h, edgeBlurPx(eg, w, h)); ebc.style.display = ""; }
  else ebc.style.display = "none";
  const csel = st.sel?.type === "clip" && st.sel.id === c.id;
  win.classList.toggle("sel", csel);
  // 選んでいるときはバウンディングボックス(角で大きさ・下の丸で回転)。win は切り取りのためはみ出しを隠すので、外に重ねる
  const wb = $('[data-c="wbox"]');
  if (csel) {
    if (!wb.firstChild) wb.innerHTML = bboxHtml("");
    Object.assign(wb.style, { display: "block", left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height, transform: tf });
  } else wb.style.display = "none";
  // 背景を透明にする(色で抜く)は、プレビューでもコマごとに抜く。AI は書き出しのときだけ
  const chroma = c.key?.mode === "chroma";
  v.style.opacity = chroma ? 0 : 1;
  kc.style.display = chroma ? "" : "none";
  if (chroma) drawKeyed(kc, v, cr, c.key, w, h);
  $('[data-c="aibadge"]').hidden = !(c.key?.mode === "ai" || P().overlays.some((o) => o.key?.mode === "ai" && st.t >= o.start && st.t < o.end));
}
// レイヤーの動画の切り取りの指定: 元の画面全体を出して、切り取る範囲の枠を重ねる
function cropModeObj(o, r, win, v) {
  const url = viewUrl(o.src);
  if (v.dataset.src !== url) { v.dataset.src = url; v.src = url; }
  const want = (o.in || 0) + clamp(st.t - o.start, 0, o.end - o.start) * spd(o);
  if (v.readyState >= 1 && Math.abs(v.currentTime - want) > 0.05) v.currentTime = want;
  if (!v.paused) v.pause();
  const W0 = o.vw || 16, H0 = o.vh || 9, s0 = Math.min(r.fw / W0, r.fh / H0);
  win.style.display = "";
  Object.assign(win.style, { left: `${(r.fw - W0 * s0) / 2}px`, top: `${(r.fh - H0 * s0) / 2}px`, width: `${W0 * s0}px`, height: `${H0 * s0}px`, transform: "", opacity: 1, clipPath: "", filter: "" });
  Object.assign(v.style, { width: `${W0 * s0}px`, height: `${H0 * s0}px`, left: "0px", top: "0px", opacity: 1 });
  $('[data-c="keycv"]').style.display = "none";
  $('[data-c="wbox"]').style.display = "none";
  featherMask(v, 0); $('[data-c="ebc"]').style.display = "none";
  renderCrop({ ...o, w: W0, h: H0 }, s0, win);
}
// ぼかし(トランジション・ループ)とディップを CSS の filter に。バウンディングボックスはぼかさないように、中身にだけ付ける
function fxFilter(stt, dip, fh) {
  const b = (stt.blur || 0) * fh;
  return [b > 0.05 ? `blur(${b.toFixed(2)}px)` : "", dipFilter(dip)].filter(Boolean).join(" ");
}
// ふちのぼかし(書き出し videoedit.apply_edge と同じ: ふちから幅 f px で 0 → 1。横と縦を掛ける)
function edgeOf(it) { const e = it?.edge; return e && (e.mode === "feather" || e.mode === "blur") && Number(e.size ?? 0.15) > 0 ? e : null; }
const edgeBlurPx = (e, w, h) => Math.max(0.5, clamp(Number(e.amt ?? 1), 0, 3) * 0.025 * Math.min(w, h));
function featherMask(el, f, mw, mh, px = 0, py = 0) {
  if (!f) {
    for (const k of ["maskImage", "webkitMaskImage", "maskComposite", "webkitMaskComposite", "maskSize", "webkitMaskSize", "maskPosition", "webkitMaskPosition", "maskRepeat", "webkitMaskRepeat"]) el.style[k] = "";
    return;
  }
  const g = (d) => `linear-gradient(${d}, transparent 0, #000 ${f}px, #000 calc(100% - ${f}px), transparent 100%)`;
  const img = `${g("to right")}, ${g("to bottom")}`;
  Object.assign(el.style, { maskImage: img, webkitMaskImage: img, maskComposite: "intersect", webkitMaskComposite: "source-in",
    maskSize: `${mw}px ${mh}px`, webkitMaskSize: `${mw}px ${mh}px`, maskPosition: `${px}px ${py}px`, webkitMaskPosition: `${px}px ${py}px`,
    maskRepeat: "no-repeat", webkitMaskRepeat: "no-repeat" });
}
// モザイクのプレビュー: 土台の動画と、下の段の画像・動画を小さな canvas に描いて(1 マス = 1 画素)、拡大する。
// 下の段の文字はプレビューには入らない(書き出しには入る)
const rotOf = (tf) => Number((/rotate\((-?[\d.]+)deg\)/.exec(tf || "") || [])[1] || 0) * Math.PI / 180;
function drawScene(g, upto) {
  const win = $('[data-c="win"]');
  if (P().clips.length && win.style.display !== "none") {
    const at = clipAt(st.t), v = vmain(), kc = $('[data-c="keycv"]');
    if (at) {
      const c = at.c, cr = c.crop || [0, 0, c.w, c.h];
      const L = parseFloat(win.style.left) || 0, T0 = parseFloat(win.style.top) || 0, w = parseFloat(win.style.width) || 0, h = parseFloat(win.style.height) || 0;
      g.save();
      g.globalAlpha = Number(win.style.opacity || 1);
      g.translate(L + w / 2, T0 + h / 2);
      g.rotate(rotOf(win.style.transform));
      try { if (kc.style.display !== "none") g.drawImage(kc, -w / 2, -h / 2, w, h); else g.drawImage(v, cr[0], cr[1], cr[2], cr[3], -w / 2, -h / 2, w, h); } catch { /* まだ読めていない */ }
      g.restore();
    }
  }
  const ovl = $('[data-c="ovl"]');
  for (let i = 0; i < upto && i < ovl.children.length; i++) {
    const el = ovl.children[i];
    if (el.style.display === "none" || el.classList.contains("chide") || !["image", "video"].includes(el.dataset.kind)) continue;
    const kc = el.querySelector(".kc"), m = el.querySelector("img, video");
    const src = kc && kc.style.display !== "none" ? kc : m;
    const L = parseFloat(el.style.left) || 0, T0 = parseFloat(el.style.top) || 0, w = parseFloat(el.style.width) || 0, h = parseFloat(el.style.height) || 0;
    g.save();
    g.globalAlpha = Number(el.style.opacity || 1);
    g.translate(L + w / 2, T0 + h / 2);
    g.rotate(rotOf(el.style.transform));
    const cr = src === m && el.dataset.kind === "video" ? P().overlays.find((o) => String(o.id) === el.dataset.id)?.crop : null;
    try { if (cr) g.drawImage(src, cr[0], cr[1], cr[2], cr[3], -w / 2, -h / 2, w, h); else g.drawImage(src, -w / 2, -h / 2, w, h); } catch { /* まだ読めていない */ }
    g.restore();
  }
}
const mosaicFull = document.createElement("canvas");
const mosaicSmall = document.createElement("canvas");
function drawMosaicPreview(cv, cx, cy, w, h, rotDeg, blk, upto) {
  const W = Math.max(2, Math.round(w)), H = Math.max(2, Math.round(h));
  const sw = Math.max(1, Math.ceil(W / blk)), sh = Math.max(1, Math.ceil(H / blk));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const o = cv.getContext("2d");
  o.clearRect(0, 0, W, H);
  // 枠の中を等倍で描き(画面の点 → 枠の回転を戻す)、マスごとに平均の色で塗る(書き出しと同じ。透明度で重みを付ける)
  const FW = Math.ceil(sw * blk), FH = Math.ceil(sh * blk);
  if (mosaicFull.width !== FW || mosaicFull.height !== FH) { mosaicFull.width = FW; mosaicFull.height = FH; }
  const g = mosaicFull.getContext("2d", { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, FW, FH);
  g.translate(W / 2, H / 2);
  g.rotate((-rotDeg * Math.PI) / 180);
  g.translate(-cx, -cy);
  drawScene(g, upto);
  let d = null;
  try { d = g.getImageData(0, 0, FW, FH).data; } catch { /* 読めない画像があるとき(下で縮めて広げる) */ }
  if (d) {
    for (let j = 0; j < sh; j++) {
      const y0 = Math.round(j * blk), y1 = Math.min(FH, Math.round((j + 1) * blk));
      for (let i = 0; i < sw; i++) {
        const x0 = Math.round(i * blk), x1 = Math.min(FW, Math.round((i + 1) * blk));
        let r = 0, gg = 0, bb = 0, a = 0, n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0, k = (y * FW + x0) * 4; x < x1; x++, k += 4) { const al = d[k + 3]; r += d[k] * al; gg += d[k + 1] * al; bb += d[k + 2] * al; a += al; n++; }
        }
        if (!a) continue;
        o.fillStyle = `rgba(${Math.round(r / a)},${Math.round(gg / a)},${Math.round(bb / a)},${(a / n / 255).toFixed(3)})`;
        o.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    return;
  }
  if (mosaicSmall.width !== sw || mosaicSmall.height !== sh) { mosaicSmall.width = sw; mosaicSmall.height = sh; }
  const sg = mosaicSmall.getContext("2d");
  sg.clearRect(0, 0, sw, sh);
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(mosaicFull, 0, 0, FW, FH, 0, 0, sw, sh);
  o.imageSmoothingEnabled = false;
  o.drawImage(mosaicSmall, 0, 0, sw, sh, 0, 0, sw * blk, sh * blk);
}
// 外側だけぼかす: 下にぼかした写しを描く(src の範囲 sr を w×h に。ふちが透けないように少し大きく描く)
function drawEdgeBlur(cv, src, sr, w, h, r) {
  const W = Math.max(2, Math.round(w)), H = Math.max(2, Math.round(h));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.filter = `blur(${r}px)`;
  try { g.drawImage(src, sr[0], sr[1], sr[2], sr[3], -2 * r, -2 * r, W + 4 * r, H + 4 * r); } catch { /* まだ読めていない */ }
  g.filter = "none";
}
// ディップ(黒・白へ)のプレビュー
function dipFilter(dip) {
  if (!dip || dip.amt <= 0.001) return "";
  return dip.color === "#000" ? `brightness(${(1 - dip.amt).toFixed(3)})` : `brightness(${(1 + dip.amt * 3).toFixed(3)}) saturate(${(1 - dip.amt).toFixed(3)})`;
}
// 色で抜く(書き出し videoedit.key_alpha と同じ計算)。src は video / img、cr は元の画素での範囲
// そのまま描く(図形マスクとき。色で抜くと同じ大きさ)
function drawPlain(cv, src, cr, w, h) {
  const kw = Math.max(2, Math.min(640, Math.round(w))), kh = Math.max(2, Math.round(kw * h / Math.max(1, w)));
  if (cv.width !== kw || cv.height !== kh) { cv.width = kw; cv.height = kh; }
  const g = cv.getContext("2d");
  g.clearRect(0, 0, kw, kh);
  try { g.drawImage(src, cr[0], cr[1], cr[2], cr[3], 0, 0, kw, kh); } catch { /* まだ読めていない */ }
}
function drawKeyed(cv, src, cr, key, w, h) {
  const kw = Math.max(2, Math.min(640, Math.round(w))), kh = Math.max(2, Math.round(kw * h / Math.max(1, w)));
  if (cv.width !== kw || cv.height !== kh) { cv.width = kw; cv.height = kh; }
  const g = cv.getContext("2d", { willReadFrequently: true });
  try { g.drawImage(src, cr[0], cr[1], cr[2], cr[3], 0, 0, kw, kh); } catch { return; }
  let im;
  try { im = g.getImageData(0, 0, kw, kh); } catch { return; }
  keyPixels(im.data, key);
  g.putImageData(im, 0, 0);
}
function keyPixels(d, key) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(key.color || "#00ff00") || [0, "00", "ff", "00"];
  const kr = parseInt(m[1], 16), kg = parseInt(m[2], 16), kb = parseInt(m[3], 16);
  const tol = Number(key.tol ?? 0.3), soft = Math.max(0.001, Number(key.soft ?? 0.1));
  const kc = [kr, kg, kb], ch = kc.indexOf(Math.max(kr, kg, kb)), others = [0, 1, 2].filter((i) => i !== ch), desp = key.despill !== false && kc[ch] >= 128;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.sqrt((d[i] - kr) ** 2 + (d[i + 1] - kg) ** 2 + (d[i + 2] - kb) ** 2) / 441.7;
    const a = clamp((dist - tol) / soft, 0, 1);
    if (desp && a < 0.999) { const lim = Math.max(d[i + others[0]], d[i + others[1]]); if (d[i + ch] > lim) d[i + ch] = lim; }
    d[i + 3] = Math.round(d[i + 3] * a);
  }
}
function renderCrop(c, s, win) {
  let box = $('[data-c="cropbox"]');
  if (!st.cropMode || !st.sel || st.sel.id !== c.id) { box?.remove(); return; }
  if (!box) {
    box = document.createElement("div");
    box.className = "crop";
    box.dataset.c = "cropbox";
    box.innerHTML = ["nw", "ne", "sw", "se"].map((h) => `<div class="h" data-h="${h}" style="${h[0] === "n" ? "top" : "bottom"}:-2px;${h[1] === "w" ? "left" : "right"}:-2px;cursor:${h === "nw" || h === "se" ? "nwse" : "nesw"}-resize"></div>`).join("");
    $('[data-c="frame"]').appendChild(box);
    box.addEventListener("pointerdown", (e) => startCropDrag(e, e.target.dataset.h || "move"));
  }
  const cr = c.crop || [0, 0, c.w, c.h];
  const wl = parseFloat(win.style.left), wt = parseFloat(win.style.top);
  Object.assign(box.style, { left: `${wl + cr[0] * s}px`, top: `${wt + cr[1] * s}px`, width: `${cr[2] * s}px`, height: `${cr[3] * s}px` });
  box._s = s;
  // 大きさは枠の中に出す(切り取る・やめるのボタンは右の欄)
  if (!box.querySelector(".cdim")) box.insertAdjacentHTML("beforeend", '<b class="cdim"></b>');
  box.querySelector(".cdim").textContent = `${Math.round(cr[2])} × ${Math.round(cr[3])}`;
}
function startCropDrag(e, mode) {
  e.stopPropagation();
  e.preventDefault();
  const c = findSel();
  if (!c) return;
  const box = $('[data-c="cropbox"]');
  const s = box._s;
  // レイヤーの動画は元の画素の大きさ(vw・vh)。w・h は画面に対しての大きさなので使わない
  const isOv = st.sel?.type === "ov";
  const IW = isOv ? c.vw || 16 : c.w, IH = isOv ? c.vh || 9 : c.h;
  const wasFull = isOv && Math.abs((c.w || 0) - 1) < 0.02 && Math.abs((c.h || 0) - 1) < 0.02 && Math.abs((c.x ?? 0.5) - 0.5) < 0.02 && Math.abs((c.y ?? 0.5) - 0.5) < 0.02;
  const start = { x: e.clientX, y: e.clientY, cr: [...(c.crop || [0, 0, IW, IH])], before: snapshot() };
  const move = (ev) => {
    const dx = (ev.clientX - start.x) / s, dy = (ev.clientY - start.y) / s;
    let [x, y, w, h] = start.cr;
    if (mode === "move") { x = clamp(x + dx, 0, IW - w); y = clamp(y + dy, 0, IH - h); }
    else {
      if (mode.includes("w")) { const nx = clamp(x + dx, 0, x + w - 16); w += x - nx; x = nx; }
      if (mode.includes("e")) w = clamp(w + dx, 16, IW - x);
      if (mode.includes("n")) { const ny = clamp(y + dy, 0, y + h - 16); h += y - ny; y = ny; }
      if (mode.includes("s")) h = clamp(h + dy, 16, IH - y);
    }
    c.crop = [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
    placeMain();
    renderInspector();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!isOv) commit(start.before); // レイヤーの動画は「✂ この範囲で切り取る」で確定する
    void wasFull;
    refresh();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
// 切り取りの指定を始める: 今の状態を覚えておく(やめたら戻す・切り取ったら 1 回で元に戻せるように)
function startCropMode(s) {
  if (st.playing) pause();
  st.cropMode = true;
  st.cropStart = { before: snapshot(), id: s?.id, full: !!s && st.sel?.type === "ov" && Math.abs((s.w || 0) - 1) < 0.02 && Math.abs((s.h || 0) - 1) < 0.02 };
  seekToSel();
  redrawInsp();
}
// この範囲で切り取る: 縦横比を合わせ、画面いっぱいの動画(土台)なら書き出す大きさも合わせる
function applyCrop() {
  const cs = st.cropStart;
  st.cropMode = false;
  st.cropStart = null;
  const o = cs ? P().overlays.find((x) => x.id === cs.id) : null;
  if (o && o.kind === "video") {
    cropAspect(o);
    if (cs.full && o.crop) fitFirst(o);
  }
  if (cs) commit(cs.before);
  redrawInsp();
  seek(st.t);
  ctx.notify(o?.crop ? "切り取りました(元に戻せます)" : "切り取りを外しました", "info");
}
// 右の欄のボタンを押した直後でも、欄を描き直す(入力中は描き直さない決まりなので、その印を外す)
function redrawInsp() {
  const box = $('[data-c="insp"]');
  if (box) delete box.dataset.for;
  refresh();
}
// やめる: 指定する前に戻す
function cancelCrop() {
  const cs = st.cropStart;
  st.cropMode = false;
  st.cropStart = null;
  if (cs && snapshot() !== cs.before) { st.proj = JSON.parse(cs.before); }
  const box = $('[data-c="insp"]');
  if (box) delete box.dataset.for;
  afterLoad();
}
// レイヤーの動画を切り取ったら、縦横比を合わせる(幅はそのまま)
function cropAspect(o) {
  const [W, H] = P().size;
  const cw = o.crop ? o.crop[2] : o.vw || 16, ch = o.crop ? o.crop[3] : o.vh || 9;
  o.aspect = cw / ch;
  o.h = r3(clamp((o.w * W) / o.aspect / H, 0.01, 4));
}
// レイヤーを描く(動き・回転・不透明度・トランジション・文字の縁と背景・背景を透明にする)
// 下のレイヤーで切り抜く: その時刻に見えているレイヤーで、切り抜くレイヤー(画像・動画)→ 下のレイヤー(すぐ下の、抜かない画像・動画・文字)。形にだけ使う下のレイヤーの id
function clipBases() {
  const bases = new Map(), hide = new Set();
  let last = null;
  if (st.cropMode) return { bases, hide };
  for (const o of orderedOverlays()) {
    if (!(st.t >= o.start && st.t < o.end)) continue;
    if ((o.clip === "in" || o.clip === "out") && (o.kind === "image" || o.kind === "video" || o.kind === "shape")) {
      if (last) { bases.set(o.id, last); if (o.clipHide || o.clip === "out") hide.add(last.id); } // 除外するときは、抜く形に使うレイヤーは見せない
      continue;
    }
    if (o.kind !== "mosaic") last = o;
  }
  return { bases, hide };
}
// 下のレイヤーを、今の画面のとおりに canvas へ描く(g はプレビューの枠の座標)
function drawFrameItem(g, b, bel) {
  g.save();
  g.globalAlpha *= clamp(Number(bel.style.opacity || 1), 0, 1);
  const tf = bel.style.transform || "";
  if (b.kind === "text") {
    const fil = bel.querySelector(".tfil");
    if (fil) {
      const cs = getComputedStyle(fil), px = parseFloat(fil.style.fontSize) || parseFloat(cs.fontSize) || 16;
      const font = `${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;
      const ks = Number((/scale\(([-\d.]+)\)/.exec(tf) || [])[1] || 1);
      const t = { ...b, text: fil.textContent };
      const L = textLayout(g, t, px, font, 0);
      g.translate(parseFloat(bel.style.left) || 0, parseFloat(bel.style.top) || 0);
      g.rotate(rotOf(tf));
      g.scale(ks, ks);
      drawTextAt(g, t, L, font);
    }
  } else {
    const kc = bel.querySelector(".kc"), m = bel.querySelector("img, video, canvas.shp");
    const src = kc && kc.style.display !== "none" ? kc : m;
    const L = parseFloat(bel.style.left) || 0, T0 = parseFloat(bel.style.top) || 0, w = parseFloat(bel.style.width) || 0, h = parseFloat(bel.style.height) || 0;
    g.translate(L + w / 2, T0 + h / 2);
    g.rotate(rotOf(tf));
    const olc = bel.querySelector(".olc"); // ふち取り
    if (olc && olc.style.display !== "none" && olc.width) { try { g.drawImage(olc, -w / 2 - olc._px, -h / 2 - olc._py, w + 2 * olc._px, h + 2 * olc._py); } catch { /* 描けないときは飛ばす */ } }
    try { if (src === m && b.kind === "video" && b.crop) g.drawImage(m, b.crop[0], b.crop[1], b.crop[2], b.crop[3], -w / 2, -h / 2, w, h); else if (src) g.drawImage(src, -w / 2, -h / 2, w, h); } catch { /* まだ読めていない */ }
  }
  g.restore();
}
// ふち取り: kc(レイヤーの絵)の不透明な所のまわりの縁を olc に描く(レイヤーより上下左右に _px・_py(画面の px)大きく、レイヤーの後ろに置く)
function drawOutline(olc, kc, ol, w, h, fh, ef) {
  const kx = kc.width / Math.max(1e-6, w), ky = kc.height / Math.max(1e-6, h), k = (kx + ky) / 2;
  const res = outlineCanvas(kc, outlineSides({ w: 0.01, ...ol }, fh * k, 0.2 * fh * k), clamp(Number(ol.blur ?? 0), 0, 0.1) * fh * k,
    ol.color || "#ffffff", clamp(Number(ol.alpha ?? 1), 0, 1), ef * k);
  if (!res) { olc._on = false; return; }
  if (olc.width !== res.cv.width || olc.height !== res.cv.height) { olc.width = res.cv.width; olc.height = res.cv.height; }
  const g = olc.getContext("2d");
  g.clearRect(0, 0, olc.width, olc.height);
  g.drawImage(res.cv, 0, 0);
  olc._on = true;
  olc._px = res.pad / kx; olc._py = res.pad / ky;
  olc._dw = w + 2 * olc._px; olc._dh = h + 2 * olc._py;
}
// ---------------------------------------------------------------- 図形のレイヤー(マスクに使う)とパス
// o.kind = "shape": shape(形。"path" はパス)・fill(塗りの色)・fillA(塗りの不透明度)・radius・points・タイル / 水玉の並べ方・
// pts(パスの点。枠の中の割合)・closed(パスを閉じる)・strokeW(パスの線の太さ: 画面の高さに対しての割合)。
// 絵は canvas.shp に描き、画像と同じく .kc を通す(ふちのぼかし・下のレイヤーで切り抜く・ふち取り・トランジションがそのまま使える)
function drawShapeSrc(cv, o, w, h, fh) {
  const kw = Math.max(2, Math.min(1024, Math.round(w))), kh = Math.max(2, Math.round((kw * h) / Math.max(1, w)));
  const sig = JSON.stringify([o.shape, o.fill, o.fillA, o.radius, o.points, ...PAT_KEYS.map((k) => o[k]), o.pts, o.closed, o.noFill, o.strokeW, kw, kh, Math.round(fh)]);
  if (cv._sig === sig) return sig;
  cv._sig = sig;
  if (cv.width !== kw || cv.height !== kh) { cv.width = kw; cv.height = kh; }
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, kw, kh);
  const col = hexA(o.fill || "#ffffff", clamp(Number(o.fillA ?? 1), 0, 1));
  if (o.shape === "path") {
    tracePath(g, decodePath(o.pts, 0, 0, kw, kh), o.closed !== false);
    if (o.closed !== false && !o.noFill) { g.fillStyle = col; g.fill(); }
    const sw = clamp(Number(o.strokeW ?? 0), 0, 0.2) * fh * (kw / Math.max(1, w));
    if (sw >= 0.5) { g.strokeStyle = col; g.lineWidth = sw; g.lineJoin = "round"; g.lineCap = "round"; g.stroke(); }
  } else {
    g.drawImage(shapeMaskCanvas({ ...o, feather: 0, center: true }, kw, kh), 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = col;
    g.fillRect(0, 0, kw, kh);
    g.globalCompositeOperation = "source-over";
  }
  return sig;
}
// パスツール(画像編集と同じ作り): st.pathDraw = { pts: [{ x, y, hi?, ho? }](書き出す動画の px), closed, target(レイヤーの id), undo, redo }
// クリックで点を追加・ドラッグで移動・Alt + クリックで曲線 ⇔ 角・ハンドルをドラッグ(Alt で片側だけ)・最初の点 / ダブルクリック / Enter で閉じる・
// Backspace で最後の点を削除・Esc でクリア(点が無ければやめる)・Ctrl+Z / Ctrl+Y で 1 手ずつ。できたパスは上のバーのボタンで:
// 内側を削除 / 外側を削除(選んでいた画像・動画のレイヤーに、パスの形の図形マスク)・塗りつぶし / 線を描画(図形のレイヤー)
const PATH_HIT = 8;
st.popt = { color: "#ffffff", alpha: 100, width: 1, feather: 0 };
function startPathDraw(target = null) {
  if (st.pathDraw && target == null) { endPathDraw(); return; } // もう一度押すと終える
  if (st.playing) togglePlay();
  const cur = st.sel?.type === "ov" ? findSel() : null; // 選んでいた画像・動画(内側 / 外側を削除する相手)
  const tg = target ?? (cur && (cur.kind === "image" || cur.kind === "video") ? cur.id : null);
  st.sel = null; st.msel = []; st.pathPrev = null;
  st.pathDraw = { pts: [], closed: false, target: tg, undo: [], redo: [] };
  const so = tg == null ? null : P().overlays.find((o) => o.id === tg);
  if (so && so.kind === "shape" && so.shape === "path" && so.pts?.length) {
    const [W, H] = P().size, a = curAnim(so, "ov"), bw = Math.max(1, a.w * W), bh = Math.max(1, a.h * H), r = ((a.rot || 0) * Math.PI) / 180;
    const fw = (dx, dy) => [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
    st.pathDraw.pts = so.pts.map((q) => {
      const [dx, dy] = fw((q[0] - 0.5) * bw, (q[1] - 0.5) * bh);
      return { x: a.x * W + dx, y: a.y * H + dy, hi: q[2] != null ? fw(q[2] * bw, q[3] * bh) : null, ho: q[4] != null ? fw(q[4] * bw, q[5] * bh) : null };
    });
    st.pathDraw.closed = so.closed !== false;
  }
  refresh();
  renderInspector();
}
function pathTarget() {
  const id = st.pathDraw?.target;
  return id == null ? null : P().overlays.find((o) => o.id === id) || null;
}
// パスの 1 手ずつの記録。{ t: "p", s: 点の写し } = パスの編集、{ t: "a" } = パスで行った処理(塗りつぶしなど。戻すとふつうの「元に戻す」)。
// 新しい順に戻すので、処理の後に Ctrl+Z を押すと処理の前のパスの編集に戻り、続けて押すとパスの点を 1 手ずつ戻す
function pathSnapV() {
  const pd = st.pathDraw;
  if (!pd) return;
  const s = JSON.stringify([pd.pts, pd.closed]), last = pd.undo.at(-1);
  if (!(last && last.t === "p" && last.s === s)) pd.undo.push({ t: "p", s });
  if (pd.undo.length > 300) pd.undo.shift();
  pd.redo = [];
}
function pathActV() { const pd = st.pathDraw; if (pd) { pd.undo.push({ t: "a" }); pd.redo = []; } }
function pathUndoRedoV(again) {
  const pd = st.pathDraw;
  if (!pd) return false;
  const from = again ? pd.redo : pd.undo, to = again ? pd.undo : pd.redo, cur = JSON.stringify([pd.pts, pd.closed]);
  while (from.length && from.at(-1).t === "p" && from.at(-1).s === cur) from.pop(); // 変わらなかった手は飛ばす
  if (!from.length) return false;
  const e = from.pop();
  if (e.t === "a") { to.push(e); if (again) redo(); else undo(); renderPathCv(); renderInspector(); return true; }
  to.push({ t: "p", s: cur });
  [pd.pts, pd.closed] = JSON.parse(e.s);
  pd.sel = [];
  renderPathCv();
  return true;
}
function pathCvXY(e) {
  const cv = $('[data-c="pathcv"]'), r = cv.getBoundingClientRect(), [W] = P().size;
  const k = r.width / W;
  return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k, k };
}
// パスの欄(画像編集のパスツールと同じ項目。パスを描いている間は、右の欄に出す)
function pathPanelHtml() {
  const tg = pathTarget(), media = tg && (tg.kind === "image" || tg.kind === "video"), o = st.popt;
  return `<h4>✒ ${esc(T("パスツール"))}</h4>
    <div class="note">${esc(T("プレビューをクリックして点を置きます(点はドラッグで移動)。最初の点のクリック・ダブルクリック・Enter でパスを閉じます。Alt + クリックで点を曲線にし(もう一度で角に戻す)、出てきたハンドルをドラッグで曲がり方を変えます(Alt を押しながらで片側だけ)。Backspace で最後の点を削除、Esc でクリア、Ctrl+Z / Ctrl+Y で 1 手ずつ戻す / やり直す。点をクリックで選び(Shift + クリックで複数)、ドラッグか矢印キー(Shift で 10 ずつ)で動かします。線をつかむとパス全体を動かします。処理の後もパスは残り、元に戻すと処理の前に戻ります。"))}</div>
    <label class="fl">${esc(T("色"))}<input type="color" data-pb="color" value="${esc(o.color)}"></label>
    <label class="fl">${esc(T("不透明度(%)"))}<input type="number" data-pb="alpha" min="0" max="100" step="1" value="${o.alpha}"></label>
    <label class="fl">${esc(T("線の太さ(%)"))}<input type="number" data-pb="width" min="0.1" max="20" step="0.1" value="${o.width}"></label>
    <label class="fl">${esc(T("境目のぼかし(%)"))}<input type="number" data-pb="feather" min="0" max="50" step="1" value="${o.feather}"></label>
    <div class="row" style="margin-top:6px"><button data-pa="in" ${media ? "" : "disabled"} title="${esc(T("パスの内側を、選んでいた画像・動画のレイヤーから消します(パスの形の図形マスク)"))}">✂ ${esc(T("内側を削除"))}</button>
      <button data-pa="out" ${media ? "" : "disabled"} title="${esc(T("パスの外側を、選んでいた画像・動画のレイヤーから消します(パスの形の図形マスク)"))}">✂ ${esc(T("外側を削除"))}</button></div>
    <div class="row" style="margin-top:4px"><button data-pa="fill" title="${esc(T("パスの内側を塗りつぶした図形のレイヤーにします"))}">■ ${esc(T("塗りつぶし"))}</button>
      <button data-pa="line" title="${esc(T("パスに沿った線の図形のレイヤーにします"))}">〰 ${esc(T("線を描画"))}</button></div>
    <div class="row" style="margin-top:4px"><button data-pa="back" title="Backspace">${esc(T("最後の点を削除"))}</button><button data-pa="clear" title="Esc">${esc(T("パスをクリア"))}</button>
      <button data-pa="quit">${esc(T("パスツールを終える"))}</button></div>
    ${media ? "" : `<div class="note">${esc(T("「内側を削除」「外側を削除」は、画像・動画のレイヤーを選んでから「✒ パス」を押したときに使えます"))}</div>`}`;
}
function markTools() {
  $('[data-c="tool-sel"]')?.classList.toggle("on", !st.pathDraw);
  $('[data-c="add-path"]')?.classList.toggle("on", !!st.pathDraw);
}
// 選択に変える(パスを描いていたら、そのパスを覚えておき、すぐに「元に戻す」を押すとパスの続きに戻る)
function toSelectTool() {
  if (!st.pathDraw) return;
  st.pathPrev = st.pathDraw;
  endPathDraw();
}
function endPathDraw() {
  st.pathDraw = null;
  renderPathCv();
  refresh();
  renderInspector();
}
function renderPathCv() {
  const cv = $('[data-c="pathcv"]');
  const pd = st.pathDraw;
  cv.style.display = pd ? "block" : "none";
  if (!pd) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, [W] = P().size, k = (r.width / W) * dpr;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  const g = cv.getContext("2d");
  const S = pd.pts.map((q) => ({ x: q.x * k, y: q.y * k, hi: q.hi && [q.hi[0] * k, q.hi[1] * k], ho: q.ho && [q.ho[0] * k, q.ho[1] * k] }));
  if (S.length > 1) {
    tracePath(g, S, pd.closed);
    g.strokeStyle = "rgba(0,0,0,0.8)"; g.lineWidth = 3 * dpr; g.stroke();
    g.strokeStyle = "#ffd24d"; g.lineWidth = 1.5 * dpr; g.setLineDash([6 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]);
  }
  for (const q of S) {
    for (const sd of ["hi", "ho"]) {
      if (!q[sd]) continue;
      const hx = q.x + q[sd][0], hy = q.y + q[sd][1];
      g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(hx, hy); g.strokeStyle = "#7bd3ff"; g.lineWidth = dpr; g.stroke();
      g.beginPath(); g.arc(hx, hy, 4 * dpr, 0, Math.PI * 2); g.fillStyle = "#7bd3ff"; g.fill();
    }
  }
  S.forEach((q, i) => {
    const on = st.pathDraw?.sel?.includes(i), s2 = (on ? 6 : i === 0 ? 5 : 4) * dpr;
    g.fillStyle = on ? "#ff5d8f" : i === 0 ? "#ffd24d" : q.hi || q.ho ? "#7bd3ff" : "#ffffff";
    g.strokeStyle = "#000"; g.lineWidth = dpr;
    g.fillRect(q.x - s2, q.y - s2, s2 * 2, s2 * 2); g.strokeRect(q.x - s2, q.y - s2, s2 * 2, s2 * 2);
  });
}
function bindPathCv() {
  const cv = $('[data-c="pathcv"]');
  cv.addEventListener("pointerdown", (e) => {
    const pd = st.pathDraw;
    if (!pd || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    pathSnapV();
    const p = pathCvXY(e), near = (x, y) => Math.hypot((x - p.x) * p.k, (y - p.y) * p.k) <= PATH_HIT;
    let drag = null;
    for (let i = 0; i < pd.pts.length && !drag; i++) {
      for (const sd of ["hi", "ho"]) { const q = pd.pts[i], h = q[sd]; if (h && near(q.x + h[0], q.y + h[1])) { drag = { i, sd }; break; } }
    }
    if (!drag) {
      const i = pd.pts.findIndex((q) => near(q.x, q.y));
      if (i >= 0 && e.altKey) { toggleCurvePoint(pd.pts, i, pd.closed); renderPathCv(); return; }
      pd.sel = (pd.sel || []).filter((j) => pd.pts[j]);
      if (i >= 0) {
        if (i === 0 && pd.pts.length >= 3 && !pd.closed && !e.shiftKey) pd.closed = true;
        if (e.shiftKey) pd.sel = pd.sel.includes(i) ? pd.sel.filter((j) => j !== i) : [...pd.sel, i]; // Shift: 選ぶ点を足す / 外す
        else if (!pd.sel.includes(i)) pd.sel = [i];
      } else if (nearPathLine(pd.pts, pd.closed, p.x, p.y, PATH_HIT / p.k)) pd.sel = pd.pts.map((_, j) => j); // 線をつかむと、パス全体
      else {
        if (pd.closed) { pd.pts = []; pd.closed = false; } // 閉じた後に外を押すと、新しいパス
        pd.pts.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }); pd.sel = [pd.pts.length - 1];
      }
      drag = { many: true, x0: p.x, y0: p.y, org: pd.sel.map((j) => [j, pd.pts[j].x, pd.pts[j].y]) };
    }
    cv.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const q2 = pathCvXY(ev);
      if (drag.many) { // 選んだ点をまとめて動かす(ハンドルは点からの向きなので、一緒に動く)
        for (const [j, x, y] of drag.org) { const t = pd.pts[j]; if (t) { t.x = Math.round((x + q2.x - drag.x0) * 10) / 10; t.y = Math.round((y + q2.y - drag.y0) * 10) / 10; } }
        renderPathCv(); return;
      }
      const pt = pd.pts[drag.i];
      if (!pt) return;
      if (drag.sd) {
        const hv = [Math.round((q2.x - pt.x) * 10) / 10, Math.round((q2.y - pt.y) * 10) / 10];
        pt[drag.sd] = hv;
        if (!ev.altKey) pt[drag.sd === "hi" ? "ho" : "hi"] = [-hv[0], -hv[1]];
      } else { pt.x = Math.round(q2.x * 10) / 10; pt.y = Math.round(q2.y * 10) / 10; }
      renderPathCv();
    };
    const up = () => { cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); };
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    renderPathCv();
  });
  cv.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const pd = st.pathDraw;
    if (pd?.pts.length >= 3 && !pd.closed) { pathSnapV(); pd.closed = true; renderPathCv(); }
  });
  const bar = $('[data-c="insp"]');
  bar.addEventListener("input", (e) => {
    const k = e.target.dataset.pb;
    if (!k) return;
    st.popt[k] = k === "color" ? e.target.value : clamp(Number(e.target.value) || 0, 0, k === "alpha" ? 100 : 50);
  });
  bar.addEventListener("click", (e) => {
    const a = e.target.closest("[data-pa]")?.dataset.pa;
    if (!a || !st.pathDraw) return;
    if (a === "back") { pathSnapV(); st.pathDraw.pts.pop(); if (!st.pathDraw.pts.length) st.pathDraw.closed = false; renderPathCv(); }
    else if (a === "clear") { pathSnapV(); st.pathDraw.pts = []; st.pathDraw.closed = false; renderPathCv(); }
    else if (a === "quit") endPathDraw();
    else finishPathDraw(a);
  });
}
// パスの点(書き出す動画の px)→ 枠の中の割合。枠: 真ん中 (cx, cy)・幅 bw・高さ bh・回転 rot(度)
function pathToBox(pts, cx, cy, bw, bh, rot = 0) {
  const a = (-rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const rv = (dx, dy) => [dx * ca - dy * sa, dx * sa + dy * ca];
  return pts.map((q) => {
    const [ux, uy] = rv(q.x - cx, q.y - cy), hi = q.hi && rv(...q.hi), ho = q.ho && rv(...q.ho);
    return [r3(ux / bw + 0.5), r3(uy / bh + 0.5), hi ? r3(hi[0] / bw) : null, hi ? r3(hi[1] / bh) : null, ho ? r3(ho[0] / bw) : null, ho ? r3(ho[1] / bh) : null];
  });
}
// できたパスを使う: in / out = 選んでいた画像・動画の内側 / 外側を消す(図形マスク)、fill / line = 図形のレイヤー(描き直しなら、そのレイヤーを変える)
async function finishPathDraw(how = "fill") {
  const pd = st.pathDraw;
  if (!pd) return;
  const need = how === "line" ? 2 : 3;
  if (pd.pts.length < need) { ctx.notify(T(need === 3 ? "点を 3 つ以上置いてください" : "点を 2 つ以上置いてください"), "error"); return; }
  const [W, H] = P().size, o = st.popt, tg = pathTarget();
  if (how === "in" || how === "out") {
    if (!tg || (tg.kind !== "image" && tg.kind !== "video")) return;
    const a = curAnim(tg, "ov");
    const pts = pathToBox(pd.pts, a.x * W, a.y * H, Math.max(1, a.w * W), Math.max(1, a.h * H), a.rot || 0);
    change(() => { tg.mask = { ...MASK_DEF, shape: "path", pts, closed: true, fit: "fill", size: 1, x: 0, y: 0, rot: 0, feather: r3(clamp(o.feather, 0, 50) / 100), invert: how === "in" }; });
    pathActV();
    refresh();
    renderInspector();
    ctx.notify(T(how === "in" ? "パスの内側を削除しました(図形マスク。元に戻せます)" : "パスの外側を削除しました(図形マスク。元に戻せます)"), "info");
    return;
  }
  const closed = how === "fill" ? true : pd.closed;
  const all = pd.pts.flatMap((q) => [[q.x, q.y], ...["hi", "ho"].filter((sd) => q[sd]).map((sd) => [q.x + q[sd][0], q.y + q[sd][1]])]);
  const x0 = Math.min(...all.map((q) => q[0])), y0 = Math.min(...all.map((q) => q[1]));
  const bw = Math.max(2, Math.max(...all.map((q) => q[0])) - x0), bh = Math.max(2, Math.max(...all.map((q) => q[1])) - y0);
  const pts = pathToBox(pd.pts, x0 + bw / 2, y0 + bh / 2, bw, bh, 0);
  const geo = { x: r3((x0 + bw / 2) / W), y: r3((y0 + bh / 2) / H), w: r3(bw / W), h: r3(bh / H), rot: 0, shape: "path", pts, closed,
    noFill: how === "line", fill: o.color, fillA: r3(clamp(o.alpha, 0, 100) / 100), strokeW: how === "line" ? r3(clamp(o.width, 0.1, 20) / 100) : 0 };
  pathActV();
  const sel = st.sel;
  if (tg && tg.kind === "shape") change(() => { Object.assign(tg, geo); tg.kf = []; });
  else await addOverlay("shape", null, geo);
  st.sel = sel; // パスを描いている間は、右の欄はパスの欄のまま
  refresh();
  renderInspector();
}
// 切り抜くレイヤーの canvas(kc。レイヤーの大きさ)に、下のレイヤーの見えている所を掛ける
const clipCv = document.createElement("canvas");
function applyClipKc(kc, mode, cx, cy, w, h, rot, b) {
  const bel = st.ovEls.get(b.id);
  if (!bel || !w || !h) return;
  const kw = kc.width, kh = kc.height;
  if (clipCv.width !== kw || clipCv.height !== kh) { clipCv.width = kw; clipCv.height = kh; }
  const g = clipCv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, kw, kh);
  // レイヤーの中の点 → 枠の座標(レイヤーの回転を戻す)
  g.scale(kw / w, kh / h);
  g.translate(w / 2, h / 2);
  g.rotate((-rot * Math.PI) / 180);
  g.translate(-cx, -cy);
  drawFrameItem(g, b, bel);
  const kg = kc.getContext("2d");
  kg.save();
  kg.setTransform(1, 0, 0, 1, 0, 0);
  kg.globalCompositeOperation = mode === "out" ? "destination-out" : "destination-in";
  kg.drawImage(clipCv, 0, 0);
  kg.restore();
}
function renderOverlays() {
  renderPathCv();
  const ovl = $('[data-c="ovl"]');
  const r = frameRect();
  const alive = new Set();
  let idx = 0;
  const clips = clipBases();
  for (const o of orderedOverlays()) {
    alive.add(o.id);
    let el = st.ovEls.get(o.id);
    if (!el || el.dataset.kind !== o.kind) {
      el?.remove();
      el = document.createElement("div");
      el.dataset.kind = o.kind;
      el.dataset.id = o.id;
      if (o.kind === "image") el.innerHTML = `<canvas class="olc"></canvas><canvas class="eb"></canvas><img alt=""><canvas class="kc"></canvas>`;
      if (o.kind === "video") el.innerHTML = `<canvas class="olc"></canvas><canvas class="eb"></canvas><div class="vcr"><video muted playsinline preload="auto"></video></div><canvas class="kc"></canvas>`;
      if (o.kind === "shape") el.innerHTML = `<canvas class="olc"></canvas><canvas class="eb"></canvas><canvas class="shp"></canvas><canvas class="kc"></canvas>`;
      if (o.kind === "mosaic") el.innerHTML = `<div class="mzb"></div><canvas class="mz"></canvas>`;
      if (o.kind === "text") el.innerHTML = `<div class="tbg"></div><span class="tstk" aria-hidden="true"></span><span class="tfil"></span>`;
      el.addEventListener("pointerdown", (e) => startOvDrag(e, o.id, e.target.dataset?.h || "move"));
      st.ovEls.set(o.id, el);
    }
    const on = st.t >= o.start && st.t < o.end && !st.cropMode;
    el.style.display = on ? "" : "none";
    const sel = (st.sel?.type === "ov" && st.sel.id === o.id) || st.msel.includes(o.id);
    el.className = `ov ${o.kind === "text" ? "txt" : ""} ${sel ? "sel" : ""} ${clips.hide.has(o.id) ? "chide" : ""}`;
    const tl = clamp(st.t - o.start, 0, o.end - o.start);
    const { stt, dip, pin, pout } = lookAt(o, "ov", tl, o.end - o.start);
    if (o.kind === "text") {
      const px = stt.size * r.fh;
      // 縁は文字の後ろの .tstk に描く(ずらす・透かすと影になる)。一文字ずつ出すときは、まだの文字を見えなくする(並びは変えない)
      const fil = el.querySelector(".tfil"), stk = el.querySelector(".tstk"), bg = el.querySelector(".tbg");
      Object.assign(el.style, fontCss(o.font)); // 文字の要素全体に(縁の層も同じフォント)
      const lines = textLinesOf(o, fil, r);
      fil.style.fontSize = `${px}px`;
      let k = stt._reveal == null ? Infinity : Math.floor(stt._reveal * lines.reduce((n, l) => n + [...l].length, 0) + 1e-9);
      const html = lines.map((l) => {
        const cs = [...l], n = clamp(k, 0, cs.length);
        k -= cs.length;
        return esc(cs.slice(0, n).join("")) + (n < cs.length ? `<span class="tw">${esc(cs.slice(n).join(""))}</span>` : "");
      }).join("\n");
      if (fil._h !== html) { fil.innerHTML = html; stk.innerHTML = html; fil._h = html; }
      const sw = Math.max(0, (o.strokeWidth ?? 0.08) * px);
      // 縁(影)のぼかし。縁の太さが 0 でも、ずらすかぼかせば文字の形の影(書き出しと同じ)
      const sb = Math.max(0, Number(o.strokeBlur || 0)) * px;
      const shadow = Math.abs((o.strokeDx || 0) * px) > 0.5 || Math.abs((o.strokeDy || 0) * px) > 0.5 || sb > 0.3;
      stk.style.display = sw > 0 || shadow ? "" : "none";
      fil.style.color = o.color;
      el.style.setProperty("--sc", o.stroke || "#000");
      el.style.setProperty("--sw", `${sw * 2}px`);
      el.style.setProperty("--sdx", `${(o.strokeDx || 0) * px}px`);
      el.style.setProperty("--sdy", `${(o.strokeDy || 0) * px}px`);
      el.style.setProperty("--sa", String(clamp(o.strokeAlpha ?? 1, 0, 1)));
      el.style.fontSize = `${px}px`;
      const ba = Number(o.bgAlpha || 0);
      const padx = (o.bgPadX ?? 0.3) * px, pady = (o.bgPadY ?? 0.3) * px, ox = (o.bgOffX || 0) * px, oy = (o.bgOffY || 0) * px;
      const bw = el.offsetWidth || px, bh = el.offsetHeight || px;
      const rad = clamp(Number(o.bgRadius || 0), 0, 1) * Math.min(bw + 2 * padx, bh + 2 * pady) / 2;
      Object.assign(bg.style, { display: ba > 0 ? "" : "none", background: hexA(o.bg, ba), left: `${-padx + ox}px`, right: `${-padx - ox}px`, top: `${-pady + oy}px`, bottom: `${-pady - oy}px`, borderRadius: `${rad}px` });
      let [cx, cy] = slidePos(stt, stt.x * r.fw, stt.y * r.fh, bw, bh, r.fw, r.fh);
      let w, h;
      [cx, cy, w, h] = applyMotion(stt, cx, cy, bw, bh, r.fw, r.fh);
      [cx, cy, w, h] = applyLoop(stt, o.loop, tl, cx, cy, w, h);
      const ks = w / Math.max(1e-6, bw);
      // ぼかし(トランジション・ループ)とディップは中身にだけ(バウンディングボックスはぼかさない)。縁の層は縁のぼかしも
      const fx = fxFilter(stt, dip, r.fh);
      stk.style.filter = [sb > 0.3 ? `blur(${sb.toFixed(2)}px)` : "", fx].filter(Boolean).join(" ");
      fil.style.filter = fx;
      bg.style.filter = fx;
      Object.assign(el.style, {
        left: `${cx}px`, top: `${cy}px`, width: "", height: "", opacity: clamp(stt.opacity, 0, 1),
        transform: `translate(-50%,-50%)${Math.abs(stt.rot) > 0.01 ? ` rotate(${stt.rot}deg)` : ""}${Math.abs(ks - 1) > 1e-4 ? ` scale(${ks})` : ""}`,
        clipPath: clipPathOf(o.tin, pin, bw, bh) || clipPathOf(o.tout, pout, bw, bh) || "", filter: "",
      });
    } else if (o.kind === "mosaic") {
      const w0 = stt.w * r.fw, h0 = stt.h * r.fh;
      let [cx, cy] = slidePos(stt, stt.x * r.fw, stt.y * r.fh, w0, h0, r.fw, r.fh);
      let w, h;
      [cx, cy, w, h] = applyMotion(stt, cx, cy, w0, h0, r.fw, r.fh);
      [cx, cy, w, h] = applyLoop(stt, o.loop, tl, cx, cy, w, h);
      // 枠(el)は不透明のまま(中身のぼかし backdrop-filter が下の段を見られるように)。不透明度・形のトランジション・ふちは中身に
      Object.assign(el.style, { left: `${cx - w / 2}px`, top: `${cy - h / 2}px`, width: `${w}px`, height: `${h}px`, opacity: 1,
        transform: Math.abs(stt.rot) > 0.01 ? `rotate(${stt.rot}deg)` : "", clipPath: "", filter: "" });
      const mode = ["pixel", "blur", "fill"].includes(o.mosaic) ? o.mosaic : "pixel";
      const blk = Math.max(2, clamp(Number(o.block ?? 0.03), 0.005, 0.2) * Math.min(r.fw, r.fh));
      const mzb = el.querySelector(".mzb"), mz = el.querySelector(".mz");
      const cp = clipPathOf(o.tin, pin, w, h) || clipPathOf(o.tout, pout, w, h) || "";
      const eg = edgeOf(o);
      const ef = eg?.mode === "feather" ? clamp(Number(eg.size ?? 0.15), 0, 0.5) * Math.min(w, h) : 0;
      const fx = fxFilter(stt, dip, r.fh);
      for (const x of [mzb, mz]) {
        Object.assign(x.style, { opacity: clamp(stt.opacity, 0, 1), clipPath: cp, borderRadius: o.shape === "ellipse" ? "50%" : "", filter: fx });
        featherMask(x, ef, w, h);
      }
      mzb.style.background = mode === "fill" ? (o.color || "#000000") : "";
      mzb.style.backdropFilter = mzb.style.webkitBackdropFilter = mode === "blur" ? `blur(${blk.toFixed(1)}px)` : "";
      mz.style.display = mode === "pixel" ? "" : "none";
      if (mode === "pixel" && on) drawMosaicPreview(mz, cx, cy, w, h, stt.rot, blk, idx);
    } else {
      const w0 = stt.w * r.fw, h0 = stt.h * r.fh;
      let [cx, cy] = slidePos(stt, stt.x * r.fw, stt.y * r.fh, w0, h0, r.fw, r.fh);
      let w, h;
      [cx, cy, w, h] = applyMotion(stt, cx, cy, w0, h0, r.fw, r.fh);
      [cx, cy, w, h] = applyLoop(stt, o.loop, tl, cx, cy, w, h);
      Object.assign(el.style, {
        left: `${cx - w / 2}px`, top: `${cy - h / 2}px`, width: `${w}px`, height: `${h}px`, opacity: clamp(stt.opacity, 0, 1),
        transform: Math.abs(stt.rot) > 0.01 ? `rotate(${stt.rot}deg)` : "",
        clipPath: clipPathOf(o.tin, pin, w, h) || clipPathOf(o.tout, pout, w, h) || "", filter: "",
      });
      const m = el.querySelector(o.kind === "image" ? "img" : o.kind === "shape" ? "canvas.shp" : "video");
      const kc = el.querySelector(".kc"), eb = el.querySelector(".eb"), olc = el.querySelector(".olc");
      const fx = fxFilter(stt, dip, r.fh);
      for (const x of [m, kc, eb, olc]) x.style.filter = fx;
      const url = o.kind === "shape" ? drawShapeSrc(m, o, w, h, r.fh) : viewUrl(o.src); // 図形はその場で描く(印 = 形・色・大きさ)
      if (o.kind !== "shape" && m.dataset.src !== url) { m.src = url; m.dataset.src = url; if (o.kind === "image") m.crossOrigin = "anonymous"; }
      let mx = 0, my = 0; // 切り取ったときの、動画の左上のずれ(画面の px)
      if (o.kind === "video") {
        syncOvVideo(o, m, on, tl);
        // 画面を切り取る(元の動画の一部だけを、枠いっぱいに)。動画を大きくして左上へずらし、はみ出しは .vcr で隠す
        // (CSS の object-view-box は Chrome 系でしか効かないので使わない)
        const cr = o.crop;
        if (cr) {
          const sx = w / cr[2], sy = h / cr[3];
          mx = cr[0] * sx; my = cr[1] * sy;
          Object.assign(m.style, { left: `${-mx}px`, top: `${-my}px`, width: `${(o.vw || cr[0] + cr[2]) * sx}px`, height: `${(o.vh || cr[1] + cr[3]) * sy}px` });
        } else Object.assign(m.style, { left: "0px", top: "0px", width: "100%", height: "100%" });
      }
      const chroma = o.key?.mode === "chroma";
      const shp = SHAPE_KEYS.has(o.mask?.shape) || (o.mask?.shape === "path" && o.mask.pts?.length > 2) ? o.mask : null; // 図形マスク(時刻で動くので、毎回描き直す)
      const clipB = clips.bases.get(o.id) || null; // 下のレイヤーで切り抜く
      const ol = o.ol?.on && Math.max(...Object.values(outlineSides({ w: 0.01, ...o.ol }))) > 0 ? o.ol : null; // ふち取り
      const viaKc = chroma || !!shp || !!clipB || !!ol || o.kind === "shape";
      m.style.opacity = viaKc ? 0 : 1;
      kc.style.display = viaKc ? "" : "none";
      if (viaKc && on) {
        const nw = o.kind === "image" ? m.naturalWidth : o.kind === "shape" ? m.width : m.videoWidth, nh = o.kind === "image" ? m.naturalHeight : o.kind === "shape" ? m.height : m.videoHeight;
        const eg0 = edgeOf(o), ef0 = eg0?.mode === "feather" ? clamp(Number(eg0.size ?? 0.15), 0, 0.5) * Math.min(w, h) : 0;
        const sig = `${JSON.stringify(o.key)}|${url}|${Math.round(w)}x${Math.round(h)}${ol ? `|${JSON.stringify(ol)}|${Math.round(r.fh)}|${Math.round(ef0)}` : ""}`;
        if (nw && (o.kind === "video" || shp || clipB || kc._sig !== sig)) {
          const src = o.kind === "video" && o.crop ? o.crop : [0, 0, nw, nh];
          if (chroma) drawKeyed(kc, m, src, o.key, w, h); else drawPlain(kc, m, src, w, h);
          if (shp) applyShapeMask(kc, shp, tl);
          // ふち取り(書き出しと同じく、下のレイヤーで切り抜く前の形のまわりに作り、縁も一緒に抜く)
          if (ol) drawOutline(olc, kc, ol, w, h, r.fh, ef0); else olc._on = false;
          if (clipB) {
            applyClipKc(kc, o.clip, cx, cy, w, h, stt.rot, clipB);
            if (olc._on) applyClipKc(olc, o.clip, cx, cy, olc._dw, olc._dh, stt.rot, clipB);
          }
          kc._sig = shp || clipB ? "" : sig;
        }
      }
      if (ol && olc._on && on) Object.assign(olc.style, { display: "block", left: `${-olc._px}px`, top: `${-olc._py}px`, width: `${w + 2 * olc._px}px`, height: `${h + 2 * olc._py}px` });
      else olc.style.display = "none";
      // ふちのぼかし
      const eg = edgeOf(o);
      const ef = eg ? clamp(Number(eg.size ?? 0.15), 0, 0.5) * Math.min(w, h) : 0;
      featherMask(m, ef, w, h, mx, my);
      featherMask(kc, ef, w, h);
      if (eg?.mode === "blur" && on) {
        const nw = o.kind === "image" ? m.naturalWidth : o.kind === "shape" ? m.width : m.videoWidth, nh = o.kind === "image" ? m.naturalHeight : o.kind === "shape" ? m.height : m.videoHeight;
        const esig = `${JSON.stringify(eg)}|${url}|${Math.round(w)}x${Math.round(h)}|${chroma ? JSON.stringify(o.key) : ""}`;
        if (nw && (o.kind === "video" || shp || clipB || eb._sig !== esig)) { drawEdgeBlur(eb, viaKc ? kc : m, viaKc ? [0, 0, kc.width, kc.height] : o.kind === "video" && o.crop ? o.crop : [0, 0, nw, nh], w, h, edgeBlurPx(eg, w, h)); eb._sig = esig; }
        eb.style.display = "";
      } else eb.style.display = "none";
    }
    // 選んでいるときはバウンディングボックス(角: 大きさ・辺: 文字は折り返す幅 / 画像・動画は幅と高さ・下の丸: 回転)
    if (sel) { if (!el.querySelector(".bb")) el.insertAdjacentHTML("beforeend", bboxHtml(o.kind === "text" ? "ew" : "all")); }
    else el.querySelector(".bb")?.remove();
    // 後のものが手前。並びが違うときだけ動かす(動かすと再生中の動画が止まるため)
    if (ovl.children[idx] !== el) ovl.insertBefore(el, ovl.children[idx] || null);
    idx++;
  }
  for (const [id, el] of st.ovEls) if (!alive.has(id)) { el.remove(); st.ovEls.delete(id); }
}
// 表示する行(折り返す幅があれば、もとの大きさの文字で測って折り返す。書き出しにも同じ行を渡す)
const measureCv = document.createElement("canvas").getContext("2d");
function textLinesOf(o, fil, r) {
  const text = String(o.text ?? "");
  if (!(Number(o.wrap) > 0)) return text.split("\n");
  const base = (Number(o.size) || 0.08) * r.fh, maxW = o.wrap * r.fw;
  const cs = getComputedStyle(fil);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${base}px ${cs.fontFamily}`;
  const sig = `${text}|${font}|${maxW}`;
  if (fil._wsig !== sig) {
    measureCv.font = font;
    fil._lines = wrapLines(text, (x) => measureCv.measureText(x).width, maxW);
    fil._wsig = sig;
  }
  return fil._lines;
}
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "#000000");
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(0,0,0,${a})`;
}
function syncOvVideo(o, v, on, tl) {
  if (!on) { if (!v.paused) v.pause(); return; }
  const want = (o.in || 0) + tl * spd(o);
  if (Math.abs((v.currentTime || 0) - want) > 0.25 && v.readyState >= 1) v.currentTime = want;
  v.playbackRate = spd(o);
  v.muted = !o.audio;
  v.volume = clamp(o.volume ?? 1, 0, 1);
  if (st.playing && v.paused) v.play().catch(() => {});
  if (!st.playing && !v.paused) v.pause();
}
// 値を変える。キーフレームがあれば、再生位置のキーフレーム(無ければ作る)に入れる
function setAnim(type, it, vals) {
  if (it.kf?.length) {
    const s0 = type === "clip" ? starts()[P().clips.indexOf(it)] : it.start;
    const len = type === "clip" ? lenOf(it) : it.end - it.start;
    const tl = r3(clamp(st.t - s0, 0, len));
    let k = it.kf.find((x) => Math.abs(x.t - tl) < 0.03);
    if (!k) { k = { t: tl, ...animState(it, AKEYS[kindKey(type, it)], tl) }; it.kf.push(k); it.kf.sort((a, b) => a.t - b.t); }
    Object.assign(k, vals);
  } else Object.assign(it, vals);
}
// ---------------------------------------------------------------- プレビューの枠の吸い付き(画面の端・真ん中、見えているほかのレイヤーの端・真ん中)
function previewSnapLines(skipEl) {
  const skip = skipEl instanceof Set ? skipEl : new Set([skipEl]); // 動かしているレイヤー(いくつもなら Set)は除く
  const rects = [$('[data-c="frame"]').getBoundingClientRect()];
  const win = $('[data-c="win"]');
  if (!skip.has(win) && P().clips.length && win.offsetParent) rects.push(win.getBoundingClientRect());
  for (const el of st.ovEls.values()) if (!skip.has(el) && el.style.display !== "none" && el.offsetParent) rects.push(el.getBoundingClientRect());
  return snapLines(rects.map((r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom })));
}
function previewSnap(res, ev, box0, lines, rot, resize = true) {
  let g = null;
  if (st.snap && !ev?.altKey && res.rot == null) {
    if (res.dx != null) { const m = snapMove(box0, res.dx, res.dy, lines); res = { dx: m.dx, dy: m.dy }; g = m; }
    else if (resize && Math.abs(rot || 0) < 0.01) { const m = snapResize(res, box0, lines); res = m.res; g = m; }
  }
  showSnapGuides($('[data-c="stage"]'), g && (g.gx.length || g.gy.length) ? g : null);
  return res;
}
const elBox = (el) => { const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
function startOvDrag(e, id, mode) {
  e.stopPropagation();
  e.preventDefault();
  const o = P().overlays.find((x) => x.id === id);
  if (!o) return;
  // Shift / Ctrl で足すのはレイヤーの本体を押したときだけ(角・回す丸では Shift は 15 度ずつ・縦横比などに使う)
  if ((e.shiftKey || e.ctrlKey || e.metaKey) && mode === "move") { toggleOv(id); refresh(); return; }
  if (st.msel.length > 1 && st.msel.includes(id)) { startMultiOvDrag(e, id, mode); return; }
  st.msel = [];
  st.sel = { type: "ov", id };
  const r = frameRect();
  const tl = clamp(st.t - o.start, 0, o.end - o.start);
  const s0 = animState(o, AKEYS[kindKey("ov", o)], tl);
  const el = st.ovEls.get(id);
  const br = el.getBoundingClientRect();
  const before = snapshot();
  const box0 = elBox(el), lines = previewSnapLines(el);
  bboxDrag(e, {
    cx: br.left + br.width / 2, cy: br.top + br.height / 2, w: el.offsetWidth, h: el.offsetHeight, rot: s0.rot, handle: mode,
    onMove: (res, ev) => {
      if (!(o.kind === "text" && res.w != null)) res = previewSnap(res, ev, box0, lines, s0.rot); // 文字の折り返す幅は寄せない
      if (res.dx != null) setAnim("ov", o, { x: r3(clamp(s0.x + res.dx / r.fw, -0.5, 1.5)), y: r3(clamp(s0.y + res.dy / r.fh, -0.5, 1.5)) });
      else if (res.rot != null) setAnim("ov", o, { rot: res.rot });
      else if (o.kind === "text") {
        if (res.k != null) setAnim("ov", o, { size: r3(clamp(s0.size * res.k, 0.005, 1)) });
        else if (res.w != null) o.wrap = r3(clamp(res.w / r.fw, 0.05, 2));
      } else if (res.k != null) setAnim("ov", o, { w: r3(clamp(s0.w * res.k, 0.01, 4)), h: r3(clamp(s0.h * res.k, 0.01, 4)) });
      else if (res.w != null) { o.keepAspect = false; setAnim("ov", o, { w: r3(clamp(res.w / r.fw, 0.01, 4)) }); }
      else if (res.h != null) { o.keepAspect = false; setAnim("ov", o, { h: r3(clamp(res.h / r.fh, 0.01, 4)) }); }
      renderOverlays();
      renderInspector();
    },
    onEnd: () => { showSnapGuides($('[data-c="stage"]'), null); if (snapshot() !== before) commit(before); refresh(); },
  });
  refresh();
}
// 選んでいるレイヤーをまとめて動かす(角: まとめて大きさ。真ん中を中心に)
function startMultiOvDrag(e, id, mode) {
  const list = selOvs();
  const r = frameRect(), [W, H] = P().size;
  const s0 = new Map(list.map((o) => [o.id, animState(o, AKEYS[kindKey("ov", o)], clamp(st.t - o.start, 0, o.end - o.start))]));
  const els = list.map((o) => st.ovEls.get(o.id)).filter((x) => x && x.style.display !== "none");
  if (!els.length) return;
  const bs = els.map(elBox);
  const box0 = { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
  const fr = $('[data-c="frame"]').getBoundingClientRect();
  const ucx = ((box0.x0 + box0.x1) / 2 - fr.left) / r.fw, ucy = ((box0.y0 + box0.y1) / 2 - fr.top) / r.fh;
  const lines = previewSnapLines(new Set(els));
  const before = snapshot();
  void W; void H;
  bboxDrag(e, {
    cx: (box0.x0 + box0.x1) / 2, cy: (box0.y0 + box0.y1) / 2, w: box0.x1 - box0.x0, h: box0.y1 - box0.y0, rot: 0, handle: mode === "rot" ? "move" : mode,
    onMove: (res, ev) => {
      if (res.rot != null) return;
      res = previewSnap(res, ev, box0, lines, 0, true);
      let k = 1, dx = 0, dy = 0;
      if (res.dx != null) { dx = res.dx / r.fw; dy = res.dy / r.fh; }
      else if (res.k != null) k = res.k;
      else return;
      for (const o of list) {
        const a = s0.get(o.id);
        const vals = { x: r3(ucx + (a.x - ucx) * k + dx), y: r3(ucy + (a.y - ucy) * k + dy) };
        if (k !== 1) { if (o.kind === "text") vals.size = r3(clamp(a.size * k, 0.005, 1)); else { vals.w = r3(clamp(a.w * k, 0.01, 4)); vals.h = r3(clamp(a.h * k, 0.01, 4)); } }
        setAnim("ov", o, vals);
      }
      renderOverlays();
      renderInspector();
    },
    onEnd: () => { showSnapGuides($('[data-c="stage"]'), null); if (snapshot() !== before) commit(before); refresh(); },
  });
}
// 方向キーで動かす(1 画素ずつ。Shift で 5 倍)。続けて押した分は、元に戻すを 1 回にまとめる
function nudgeOvs(dx, dy) {
  const list = selOvs();
  if (!list.length) return false;
  const [W, H] = P().size;
  const now = Date.now();
  if (!st.nudge || now - st.nudge.at > 800) st.nudge = { before: snapshot() };
  st.nudge.at = now;
  for (const o of list) {
    const a = animState(o, AKEYS[kindKey("ov", o)], clamp(st.t - o.start, 0, o.end - o.start));
    setAnim("ov", o, { x: r3(a.x + dx / W), y: r3(a.y + dy / H) });
  }
  const b = st.nudge.before;
  clearTimeout(st.nudgeTimer);
  st.nudgeTimer = setTimeout(() => { if (st.nudge?.before === b) { commit(b); st.nudge = null; refresh(true); } }, 800);
  renderOverlays();
  renderInspector();
  st.dirty = true;
  return true;
}
// つなげる動画もプレビューの上で動かす・大きさを変える(選んでいるとき)
function startClipDrag(e) {
  const at = clipAt(st.t);
  if (!at || st.cropMode || !(st.sel?.type === "clip" && st.sel.id === at.c.id)) return;
  const c = at.c, r = frameRect(), mode = e.target.dataset?.h || "move";
  const s0 = animState(c, AKEYS.clip, st.t - at.s);
  const win = $('[data-c="win"]');
  const br = win.getBoundingClientRect();
  const before = snapshot();
  const box0 = elBox(win), lines = previewSnapLines(win);
  bboxDrag(e, {
    cx: br.left + br.width / 2, cy: br.top + br.height / 2, w: win.offsetWidth, h: win.offsetHeight, rot: s0.rot, handle: mode,
    onMove: (res, ev) => {
      res = previewSnap(res, ev, box0, lines, s0.rot);
      if (res.dx != null) setAnim("clip", c, { x: r3(clamp(s0.x + res.dx / r.fw, -0.5, 1.5)), y: r3(clamp(s0.y + res.dy / r.fh, -0.5, 1.5)) });
      else if (res.rot != null) setAnim("clip", c, { rot: res.rot });
      else if (res.k != null) setAnim("clip", c, { s: r3(clamp(s0.s * res.k, 0.05, 8)) });
      placeMain();
      renderInspector();
    },
    onEnd: () => { showSnapGuides($('[data-c="stage"]'), null); if (snapshot() !== before) commit(before); refresh(); },
  });
}

// ---------------------------------------------------------------- 再生(時計で進め、映像・音声を合わせる)
function syncMain(hard) {
  const at = P().clips.length && st.t <= total() + 1e-6 ? clipAt(st.t) : null;
  const v = vmain();
  if (!at) { if (!v.paused) v.pause(); placeMain(null); return; }
  if (st.cur !== at.i) {
    st.cur = at.i;
    const url = viewUrl(at.c.src);
    if (v.dataset.src !== url) { v.dataset.src = url; v.src = url; }
    hard = true;
  }
  v.muted = true; // 音は音声の段で鳴らす
  v.playbackRate = spd(at.c);
  if (v.readyState >= 1 && (hard || Math.abs(v.currentTime - at.local) > 0.25)) v.currentTime = at.local;
  if (st.playing && v.paused && v.readyState >= 1) v.play().catch(() => {});
  if (!st.playing && !v.paused) v.pause();
  placeMain(at);
}
function syncAudio(hard) {
  const alive = new Set();
  for (const a of P().audios || []) {
    alive.add(a.id);
    let el = st.auEls.get(a.id);
    if (!el) { el = new Audio(); el.preload = "auto"; st.auEls.set(a.id, el); }
    const url = viewUrl(a.src);
    if (el.dataset.src !== url) { el.dataset.src = url; el.src = url; }
    const v = audioView(a), len = audioLen(a);
    const on = st.playing && st.t >= v.start && st.t < v.start + len;
    if (!on) { if (!el.paused) el.pause(); continue; }
    let g = a.mute ? 0 : clamp(volAt(a, st.t - v.start), 0, 1);
    if (a.fadeIn > 0) g *= clamp((st.t - v.start) / a.fadeIn, 0, 1);
    if (a.fadeOut > 0) g *= clamp((v.start + len - st.t) / a.fadeOut, 0, 1);
    el.volume = g;
    el.playbackRate = v.speed;
    el.preservesPitch = a.keepPitch !== false;
    const want = v.in + (st.t - v.start) * v.speed;
    if (el.readyState >= 1 && (hard || Math.abs(el.currentTime - want) > 0.25)) el.currentTime = want;
    if (el.paused) el.play().catch(() => {});
  }
  for (const [id, el] of st.auEls) if (!alive.has(id)) { el.pause(); st.auEls.delete(id); }
}
function syncAll(hard) {
  syncMain(hard);
  renderOverlays();
  syncAudio(hard);
}
function seek(t) {
  st.t = clamp(t, 0, total());
  if (st.playing) st.clock = { t0: performance.now(), s0: st.t };
  syncAll(true);
  drawPlayhead();
  syncInspectorAnim();
  updateMeter();
  // 音量のキーフレームがあれば、欄の音量を再生位置の値に
  const a = st.sel?.type === "au" ? findSel() : null;
  const ve = a?.vkf?.length ? $('[data-c="insp"]').querySelector('[data-k="volume"]') : null;
  if (ve && ve !== document.activeElement) ve.value = r3(volAt(a, st.t - audioView(a).start) * 100);
}
// キーフレームのあるレイヤーを選んでいるときは、再生位置の値を欄に出す
function syncInspectorAnim() {
  const s = findSel();
  if (!s?.kf?.length || !ui) return;
  for (const el of $('[data-c="insp"]').querySelectorAll("[data-k]")) if (el !== document.activeElement && ANIM_ALL.has(el.dataset.k)) setField(el, s);
  const n = $('[data-c="insp"]').querySelector(".kfnote");
  if (n) n.textContent = T("◆ キーフレームがあります。ここで変えると再生位置({0})のキーフレームに入ります。", fmt(st.t));
  syncKfList(s);
}
function play() {
  if (!P().clips.length && !P().overlays.length && !(P().audios || []).length) return;
  if (st.t >= total() - 0.02) st.t = 0;
  st.playing = true;
  st.cropMode = false;
  st.clock = { t0: performance.now(), s0: st.t };
  $('[data-c="play"]').textContent = "⏸ 停止";
  syncAll(true);
  requestAnimationFrame(tick);
}
function pause() {
  st.playing = false;
  vmain().pause();
  for (const el of st.ovEls.values()) el.querySelector("video")?.pause();
  for (const el of st.auEls.values()) el.pause();
  $('[data-c="play"]').textContent = "▶ 再生";
}
function tick() {
  if (!st.playing) return;
  st.t = st.clock.s0 + (performance.now() - st.clock.t0) / 1000;
  if (st.t >= total()) {
    st.t = total();
    pause();
    syncAll(true);
    drawPlayhead();
    return;
  }
  syncAll(false);
  drawPlayhead();
  updateMeter();
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- タイムライン
function renderTimeline() {
  const aus = P().audios || [];
  const D = Math.max(total(), ...P().overlays.map((o) => o.end), ...aus.map((a) => audioView(a).start + audioLen(a)), 1);
  const width = Math.max($('[data-c="tl"]').clientWidth - 4, Math.ceil(D * st.pxs) + 80 + GUT);
  const tlin = $('[data-c="tlin"]');
  tlin.style.width = `${width}px`;
  const step = st.pxs >= 120 ? 0.5 : st.pxs >= 40 ? 1 : st.pxs >= 15 ? 5 : 10;
  let ru = "";
  for (let s = 0; s <= D + step; s += step) ru += `<i style="left:${GUT + s * st.pxs}px"></i>${Math.abs(s - Math.round(s)) < 1e-6 ? `<span style="left:${GUT + s * st.pxs}px">${fmt(s).replace(/\.0$/, "")}</span>` : ""}`;
  $('[data-c="ruler"]').innerHTML = ru;
  const ss = starts();
  // キーフレーム(◆)・トランジション(端のぼかし)の印
  const deco = (it, len) => {
    let h = "";
    for (const k of it.kf || []) if (k.t >= -1e-6 && k.t <= len + 1e-6) h += `<i class="kfm" style="left:${k.t * st.pxs}px"></i>`;
    if (it.tin?.type) h += `<i class="trm l" style="width:${Math.min(len, it.tin.dur || 0.5) * st.pxs}px"></i>`;
    if (it.tout?.type) h += `<i class="trm r" style="width:${Math.min(len, it.tout.dur || 0.5) * st.pxs}px"></i>`;
    if (it.loop?.type) h += `<i class="lpm" title="${esc(T("ずっと動かす: {0}", T(LOOP_NAMES[it.loop.type])))}">∿</i>`;
    return h;
  };
  const blk = (cls, id, type, left, w, label, title, extra = "") => `<div class="blk ${cls} ${(st.sel?.type === type && st.sel.id === id) || (type === "ov" && st.msel.includes(id)) ? "sel" : ""}" data-type="${type}" data-id="${id}"
    style="left:${GUT + left}px;width:${Math.max(6, w)}px" title="${esc(title)}">${extra}<div class="eh l" data-edge="l"></div>${esc(label)}<div class="eh r" data-edge="r"></div></div>`;
  // 並び(DOM)は 音声の段(後ろから)→「動画」の段 → レイヤー。画面では逆向き(column-reverse)なので、
  // 上から レイヤー(上ほど手前)→「動画」の段 → 音声の段
  let rows = "";
  for (let i = aus.length - 1; i >= 0; i--) {
    const a = aus[i], v = audioView(a), len = audioLen(a);
    const label = `${a.mute || !(a.volume > 0) ? "🔇" : "🔊"} ${a.link != null ? "🔗 " : ""}${a.name}${v.speed !== 1 ? ` ${Math.round(v.speed * 100)}%` : ""}`;
    const fades = (a.fadeIn > 0 ? `<i class="trm l" style="width:${Math.min(len, a.fadeIn) * st.pxs}px"></i>` : "") + (a.fadeOut > 0 ? `<i class="trm r" style="width:${Math.min(len, a.fadeOut) * st.pxs}px"></i>` : "");
    rows += `<div class="trow" data-row="au" data-i="${i}"><span class="lab" title="音声">音声</span>${blk(`audio${a.link != null ? " linked" : ""}`, a.id, "au", v.start * st.pxs, len * st.pxs, label,
      a.link != null ? `${a.name}(${T("動画とつながっています。切り離すと別に動かせます")})` : a.name, `<canvas class="wv" data-id="${a.id}"></canvas>${fades}${(a.vkf || []).filter((q) => q.t <= len + 1e-6).map((q) => `<i class="kfm" style="left:${q.t * st.pxs}px"></i>`).join("")}`)}</div>`;
  }
  void ss;
  const labelOf = (o) => `${o.kind === "text" ? `T ${o.text}` : o.kind === "mosaic" ? `▦ ${T("モザイク")}` : o.kind === "shape" ? `◆ ${o.name || T("図形")}` : `${o.kind === "image" ? "🖼" : "🎞"} ${o.name}`}${o.kind === "video" ? ` (${(o.end - o.start).toFixed(1)}s${spd(o) !== 1 ? ` ${pctOf(o)}` : ""})` : ""}`;
  rows += `<div class="trow zero" data-row="ov0"><span class="lab" title="${esc(T("ここへ動かすと、いちばん下の新しい段になります"))}">0</span></div>`;
  for (let r = 0, n = rowCount(); r < n; r++) {
    const items = P().overlays.filter((o) => rowOf(o) === r);
    rows += `<div class="trow" data-row="ov" data-r="${r}"><span class="lab" title="${esc(T("{0} 段目(上の段ほど手前に重なります)", r + 1))}">${r + 1}</span>${items.map((o) => blk(o.kind, o.id, "ov", o.start * st.pxs, (o.end - o.start) * st.pxs, labelOf(o), labelOf(o), deco(o, o.end - o.start))).join("")}</div>`;
  }
  $('[data-c="rows"]').innerHTML = rows;
  drawWaves();
  drawPlayhead();
}
function drawPlayhead() {
  $('[data-c="ph"]').style.left = `${GUT + st.t * st.pxs}px`;
  $('[data-c="time"]').textContent = `${fmt(st.t)} / ${fmt(total())}`;
}
// ---- 段をまたぐ(重なる順番・つなげる ⇄ 重ねる)
// 画面の位置 → 行き先。{ mode: "clip", index(何本目の前), t(つなぐ所の時刻) } / { mode: "ov", index(重なる順番), t }
// 上の段ほど手前。いちばん下の「動画」の段(とその下)は mode "clip"、目盛りより上はいちばん手前
function timelineTarget(cx, cy) {
  const base = $('[data-c="tlin"]').getBoundingClientRect();
  const t = Math.max(0, (cx - base.left - GUT) / st.pxs);
  const rowEls = [...$('[data-c="rows"]').querySelectorAll('[data-row="ov"]')];
  const z = $('[data-c="rows"]').querySelector('[data-row="ov0"]')?.getBoundingClientRect();
  if (z && cy >= z.top && cy < z.bottom - 1) return { mode: "row", r: 0, newRow: true, bottom: true, t, y: (z.top + z.bottom) / 2 - base.top };
  const r0 = z || rowEls.find((e) => e.dataset.r === "0")?.getBoundingClientRect();
  if (r0 && cy >= r0.bottom - 1) {
    const tlb = $('[data-c="tl"]').getBoundingClientRect();
    return { mode: "audio", t, y0: r0.bottom - base.top, y1: Math.max(r0.bottom + 20, tlb.bottom) - base.top };
  }
  for (const e of rowEls) {
    const b = e.getBoundingClientRect();
    if (cy >= b.top && cy < b.bottom) return { mode: "row", r: Number(e.dataset.r), t, y0: b.top - base.top, y1: b.bottom - base.top };
  }
  // いちばん上の段より上: 新しい段(いちばん手前)
  const top = Math.min(...rowEls.map((e) => e.getBoundingClientRect().top));
  return { mode: "row", r: rowCount(), newRow: true, t, y: (Number.isFinite(top) ? top : base.top) - base.top };
}
function showMark(tg, label, bad = false) {
  const m = $('[data-c="dmark"]');
  const v = m.querySelector(".v"), h = m.querySelector(".h"), lb = m.querySelector(".lb");
  m.classList.add("on");
  m.classList.toggle("bad", bad);
  const x = GUT + tg.t * st.pxs;
  if (tg.mode === "clip" || tg.mode === "audio" || (tg.mode === "row" && !tg.newRow)) {
    Object.assign(v.style, { display: "", left: `${x}px`, top: `${tg.y0}px`, height: `${tg.y1 - tg.y0}px` });
    h.style.display = "none";
    Object.assign(lb.style, { left: `${x + 6}px`, top: `${tg.y0 - 20}px` });
  } else {
    const w = $('[data-c="tlin"]').clientWidth;
    Object.assign(h.style, { display: "", left: `${GUT}px`, top: `${tg.y}px`, width: `${Math.max(0, w - GUT)}px` });
    Object.assign(v.style, { display: "", left: `${x}px`, top: `${tg.y - 12}px`, height: "24px" });
    Object.assign(lb.style, { left: `${x + 6}px`, top: `${tg.y - 21}px` });
  }
  lb.textContent = T(label);
}
function hideMark() { $('[data-c="dmark"]').classList.remove("on"); }
// ---- スナップ(ほかのレイヤーの始まり・終わり・つなぎ目・再生位置・0 にそろえる)
const SNAP_PX = 8;
function snapPoints(skip) {
  const pts = [0, st.t];
  let t = 0, moving = false;
  // つなげる動画の端を動かしているときは、その動画の終わりから後ろのつなぎ目は一緒に動くので使わない
  for (const c of P().clips) {
    pts.push(t);
    if (c === skip) { moving = true; break; }
    t += lenOf(c);
  }
  if (!moving) pts.push(t);
  for (const o of P().overlays) if (o !== skip) pts.push(o.start, o.end);
  // 音声の段(動画とつながっている音声は、その動画の端と同じなので入れない。動かしているレイヤーの音声も入れない)
  for (const a of P().audios || []) if (a !== skip && a.link == null) { const v = audioView(a); pts.push(v.start, v.start + audioLen(a)); }
  return pts;
}
// times の中で、そろえる所にいちばん近いもの → ずらす量(秒)。近くに無ければ 0
function snapShift(times, skip, ev) {
  if (!st.snap || ev?.altKey) { showSnap(null); return 0; }
  const lim = SNAP_PX / st.pxs;
  let best = null;
  for (const p of snapPoints(skip)) for (const t of times) {
    const d = p - t;
    if (Math.abs(d) <= lim && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, p };
  }
  showSnap(best ? best.p : null);
  return best ? best.d : 0;
}
function showSnap(t) {
  const el = $('[data-c="snapl"]');
  el.classList.toggle("on", t !== null);
  if (t !== null) el.style.left = `${GUT + t * st.pxs}px`;
}
// レイヤーを別の段へドラッグしたときの行き先(段が変わらないときは null)
function layerTarget(ev, type, item) {
  if (type !== "ov") return null;
  const tg = timelineTarget(ev.clientX, ev.clientY);
  if (tg.mode !== "row" || (!tg.newRow && tg.r === rowOf(item))) return null;
  if (tg.bottom && P().overlays.every((o) => o === item || rowOf(o) > rowOf(item))) return null; // もういちばん下に 1 つだけ
  return { ...tg, t: item.start, label: tg.bottom ? T("いちばん下の新しい段へ") : tg.newRow ? T("新しい段(いちばん手前)へ") : T("{0} 段目へ", tg.r + 1) };
}
function applyLayer(type, item, tg) {
  if (tg.bad) { ctx.notify(tg.bad, "error"); return; }
  if (type !== "ov" || tg.mode !== "row") return;
  if (tg.bottom) { for (const o of P().overlays) o.row = rowOf(o) + 1; item.row = 0; } // ほかを 1 段ずつ上げて、いちばん下に
  else item.row = tg.newRow ? rowCount() : tg.r;
  normRows();
}
function startBlockDrag(e) {
  const b = e.target.closest(".blk");
  if (!b) return;
  e.preventDefault();
  const type = b.dataset.type, id = Number(b.dataset.id), edge = e.target.dataset.edge || "";
  if (type === "ov" && (e.shiftKey || e.ctrlKey || e.metaKey) && !edge) { toggleOv(id); refresh(); return; }
  // 選んでいるレイヤーのどれかの本体をドラッグしたら、まとめて時間を動かす
  const group = type === "ov" && !edge && st.msel.length > 1 && st.msel.includes(id) ? selOvs() : null;
  if (!group) st.msel = [];
  st.sel = { type, id };
  st.cropMode = false;
  const before = snapshot();
  const x0 = e.clientX, y0 = e.clientY;
  const item = type === "clip" ? P().clips.find((c) => c.id === id) : type === "au" ? P().audios.find((a) => a.id === id) : P().overlays.find((o) => o.id === id);
  if (type === "au" && item.link != null) { refresh(); return; } // つながっている音声は動画と一緒に動く(切り離すと動かせる)
  const orig = { ...item };
  const order = type === "clip" ? [...P().clips] : null;
  const start0 = type === "clip" ? starts()[P().clips.indexOf(item)] : item.start;
  const sp = spd(item);
  // 伸縮(タイムストレッチ): 端をドラッグすると、元の同じ所を使ったまま速さを変えて長さを変える(「⇔ 伸縮」か Shift)
  const stretch = !!edge && (st.stretch || e.shiftKey) && (type === "clip" || type === "au" || item.kind === "video");
  let moved = false, tg = null;
  const move = (ev) => {
    const dt = (ev.clientX - x0) / st.pxs;
    if (Math.abs(ev.clientX - x0) > 2 || Math.abs(ev.clientY - y0) > 6) moved = true;
    if (!moved) return;
    if (stretch) {
      // 元の動画・音声で使う長さ(秒)と、今の長さ
      const src = type === "ov" ? (orig.end - orig.start) * sp : orig.out - orig.in;
      const L0 = src / sp, Lmin = src / 16, Lmax = src / 0.05;
      const s0 = type === "clip" ? start0 : orig.start;
      let L, st0 = s0;
      if (edge === "r" || type === "clip") {
        // つなげる動画は詰めて並ぶので、どちらの端でも終わりが動く
        L = clamp(L0 + (edge === "r" ? dt : -dt), Lmin, Lmax);
        L = clamp(L + snapShift([s0 + L], item, ev), Lmin, Lmax);
      } else {
        let a = clamp(s0 + dt, s0 + L0 - Lmax, s0 + L0 - Lmin);
        a = Math.max(0, a + snapShift([a], item, ev));
        st0 = Math.min(a, s0 + L0 - Lmin);
        L = s0 + L0 - st0;
      }
      item.speed = r3(clamp(src / L, 0.05, 16));
      if (type === "ov") { item.start = r3(st0); item.end = r3(st0 + src / spd(item)); }
      else if (type === "au") item.start = r3(Math.max(0, st0));
      showStretch(ev, item);
      renderTimeline();
      renderOverlays();
      renderInspector();
      return;
    }
    // 本体のドラッグだけ、段をまたげる(端のドラッグは長さを変えるだけ)
    tg = edge || type === "au" || group ? null : layerTarget(ev, type, item);
    if (tg && type === "clip" && tg.mode === "ov" && !tg.bad) tg.t = Math.max(0, tg.t + snapShift([tg.t], null, ev));
    if (type === "clip") {
      if (tg) P().clips = [...order]; // 段の外にいる間は、並べ替えをしない
      else if (edge === "l") {
        // つなげる動画は詰めて並ぶので、左端を動かすと終わり(つなぎ目)が動く → 終わりをそろえる(速さの分も掛ける)
        let inn = clamp(orig.in + dt * sp, 0, orig.out - MIN_LEN * sp);
        inn = clamp(inn - snapShift([start0 + (orig.out - inn) / sp], item, ev) * sp, 0, orig.out - MIN_LEN * sp);
        item.in = r3(inn);
      } else if (edge === "r") {
        let out = clamp(orig.out + dt * sp, orig.in + MIN_LEN * sp, item.dur);
        out = clamp(out + snapShift([start0 + (out - orig.in) / sp], item, ev) * sp, orig.in + MIN_LEN * sp, item.dur);
        item.out = r3(out);
      } else {
        showSnap(null);
        // 並べ替え: ドラッグした所の時刻に入る位置へ
        P().clips = [...order];
        const cs = P().clips;
        const from = cs.indexOf(item);
        const ss = starts();
        const center = ss[from] + lenOf(item) / 2 + dt;
        let to = 0;
        for (let k = 0; k < cs.length; k++) if (k !== from && center > ss[k] + lenOf(cs[k]) / 2) to++;
        if (to !== from) { cs.splice(from, 1); cs.splice(to, 0, item); }
      }
    } else if (type === "au") {
      // 音声: 本体で動かす・左端で始めを切る(置く時刻も一緒に)・右端で終わりを切る
      const len = (orig.out - orig.in) / sp;
      if (edge === "l") {
        let d = clamp(dt, -orig.in / sp, len - MIN_LEN);
        d += snapShift([orig.start + d], item, ev);
        d = clamp(d, -orig.in / sp, len - MIN_LEN);
        item.start = r3(Math.max(0, orig.start + d)); item.in = r3(orig.in + d * sp);
      } else if (edge === "r") {
        let out = clamp(orig.out + dt * sp, orig.in + MIN_LEN * sp, item.dur || orig.out);
        out = clamp(out + snapShift([orig.start + (out - orig.in) / sp], item, ev) * sp, orig.in + MIN_LEN * sp, item.dur || orig.out);
        item.out = r3(out);
      } else {
        let a = Math.max(0, orig.start + dt);
        a = Math.max(0, a + snapShift([a, a + len], item, ev));
        item.start = r3(a);
      }
    } else {
      if (edge === "l") {
        const v = orig.start + dt;
        let ns = clamp(v + snapShift([v], item, ev), 0, orig.end - MIN_LEN);
        if (item.kind === "video") {
          // 動画の左端: 元の動画の使い始め(in)も一緒に動かす(中身はその場のまま、始めが削れる)。元の動画の頭より前には広げない
          const sp = spd(item);
          ns = Math.max(ns, orig.start - (orig.in || 0) / sp);
          item.in = r3(Math.max(0, (orig.in || 0) + (ns - orig.start) * sp));
        }
        item.start = r3(ns);
      } else if (edge === "r") {
        const v = orig.end + dt;
        item.end = r3(Math.max(orig.start + MIN_LEN, v + snapShift([v], item, ev)));
      } else if (group) {
        // まとめて動かす(いちばん前のレイヤーが 0 秒より前に出ないように)
        if (!st.gorig) st.gorig = new Map(group.map((o) => [o.id, [o.start, o.end]]));
        const minS = Math.min(...group.map((o) => st.gorig.get(o.id)[0]));
        let d = Math.max(-minS, dt);
        d += snapShift([orig.start + d, orig.end + d], item, ev);
        d = Math.max(-minS, d);
        for (const o of group) { const [a0, a1] = st.gorig.get(o.id); o.start = r3(a0 + d); o.end = r3(a1 + d); }
      } else {
        const d = orig.end - orig.start;
        let a = Math.max(0, orig.start + dt);
        a = Math.max(0, a + snapShift([a, a + d], item, ev));
        item.start = r3(a); item.end = r3(a + d);
      }
    }
    renderTimeline();
    renderOverlays();
    renderInspector();
    if (tg) showMark(tg, tg.bad || tg.label, !!tg.bad); else hideMark();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    hideMark();
    showSnap(null);
    $('[data-c="dhint"]').classList.remove("stretch");
    st.gorig = null;
    if (tg && !group) applyLayer(type, item, tg);
    commit(before);
    st.cur = -1;
    refresh();
    seek(st.t);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  refresh();
}

// 伸縮中は、今の速さ(%)と長さをプレビューの上に出す
function showStretch(ev, item) {
  const h = $('[data-c="dhint"]');
  const len = st.sel?.type === "clip" ? lenOf(item) : st.sel?.type === "au" ? audioLen(item) : item.end - item.start;
  h.textContent = T("伸縮: 速さ {0}・長さ {1} 秒", pctOf(item), len.toFixed(2));
  h.classList.add("stretch");
}
// ---- ファイルのドラッグ&ドロップ(タイムライン: その場所に・「動画」の段ならつなげる、上の段なら重ねる / プレビュー: 置いた所に重ねる /
// 何も入っていなければ 1 本目の動画)
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|mpe?g|wmv|flv|ts)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|wma|aiff?)$/i;
const fileKind = (f) => (/^audio\//.test(f.type) || AUDIO_EXT.test(f.name || "") ? "audio" : /^video\//.test(f.type) || VIDEO_EXT.test(f.name || "") ? "video" : /^image\//.test(f.type) ? "image" : null);
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
// ドラッグ中のファイルの種類(名前は取れないので MIME で。わからないものは動画とみなす)
function dragKinds(e) {
  const ks = [...(e.dataTransfer?.items || [])].filter((it) => it.kind === "file").map((it) => (/^image\//.test(it.type) ? "image" : /^audio\//.test(it.type) ? "audio" : "video"));
  return ks.length ? ks : ["video"];
}
function dropPlan(zone, e) {
  const kinds = dragKinds(e);
  // 何も入っていないときは、動画はいちばん下の段の 1 本目に(画像だけなら、動画なしで重ねる: 透明な WebP・GIF を作るときなど)
  // (第17版からの決まり: プレビューに置いたときも、何も無ければ 1 本目)
  if (!P().overlays.length && kinds.includes("video")) return { zone: "first", label: "1 本目の動画にする" };
  const tlT = () => Math.max(0, (e.clientX - $('[data-c="tlin"]').getBoundingClientRect().left - GUT) / st.pxs);
  const row0 = () => ($('[data-c="rows"]').querySelector('[data-row="ov0"]') || $('[data-c="rows"]').querySelector('[data-row="ov"][data-r="0"]')).getBoundingClientRect();
  if (kinds.every((k) => k === "audio")) {
    if (zone !== "tl") return { zone: "audio", t: st.t, label: "音声の段に置く(再生位置から)" };
    let t = tlT();
    t = Math.max(0, t + snapShift([t], null, e));
    const tg = timelineTarget(e.clientX, row0().bottom + 2);
    return { zone: "audio", t, tg: { ...tg, t }, label: "ここから音声を置く" };
  }
  if (zone === "stage") return { zone: "stage", label: "置いた所に重ねる(ピクチャーインピクチャー)" };
  if (zone === "tl") {
    const tg = timelineTarget(e.clientX, e.clientY);
    if (tg.mode === "audio") {
      let t = tlT();
      t = Math.max(0, t + snapShift([t], null, e));
      return { zone: "audio", t, tg: { ...tg, t }, label: kinds.includes("video") ? "ここから動画の音を音声の段に置く" : "ここから音声を置く" };
    }
    tg.t = Math.max(0, tg.t + snapShift([tg.t], null, e));
    return { zone: "tl", tg, label: tg.bottom ? "いちばん下の新しい段に置く" : tg.newRow ? "新しい段に置く" : "この段のここに置く" };
  }
  return { zone: "none", label: "タイムラインかプレビューに置いてください", bad: true };
}
function clearDrop() {
  showSnap(null);
  $('[data-c="stage"]').classList.remove("drop");
  $('[data-c="tl"]').classList.remove("drop");
  hideMark();
}
function onDragOver(zone, e) {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const plan = dropPlan(zone, e);
  e.dataTransfer.dropEffect = plan.bad ? "none" : "copy";
  const stage = $('[data-c="stage"]'), tl = $('[data-c="tl"]');
  stage.classList.toggle("drop", plan.zone === "stage" || (plan.zone === "first" && zone === "stage"));
  tl.classList.toggle("drop", plan.zone === "first" && zone === "tl");
  $('[data-c="dhint"]').textContent = T(plan.label);
  if (plan.tg && (plan.zone === "tl" || plan.zone === "audio")) showMark(plan.tg, plan.label); else hideMark();
}
async function onDrop(zone, e) {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const plan = dropPlan(zone, e);
  clearDrop();
  if (st.busy) return;
  const files = [...(e.dataTransfer?.files || [])].map((f) => ({ f, kind: fileKind(f) })).filter((x) => x.kind);
  if (!files.length) { ctx.notify("動画・画像・音声のファイルを入れてください", "error"); return; }
  if (plan.zone === "none") { ctx.notify(plan.label, "error"); return; }
  let pos = null;
  if (plan.zone === "stage") {
    const fr = $('[data-c="frame"]').getBoundingClientRect();
    pos = { x: clamp((e.clientX - fr.left) / Math.max(1, fr.width), 0, 1), y: clamp((e.clientY - fr.top) / Math.max(1, fr.height), 0, 1) };
  }
  // 何も入っていないときは動画を先に(画像はその上に重ねる)
  if (plan.zone === "first") files.sort((a, b) => (a.kind === "video" ? 0 : 1) - (b.kind === "video" ? 0 : 1));
  const busyEl = $('[data-c="busy"]');
  st.busy = true;
  busyEl.classList.add("on", "up");
  const before = snapshot();
  st.batch = true;
  if (plan.zone === "tl" && plan.tg?.bottom) for (const o of P().overlays) o.row = rowOf(o) + 1; // いちばん下の新しい段に置く
  const row = plan.zone === "tl" && plan.tg?.mode === "row" ? (plan.tg.bottom ? 0 : plan.tg.newRow ? rowCount() : plan.tg.r) : plan.zone === "first" ? 0 : null;
  const t0 = plan.zone === "tl" ? plan.tg.t : plan.zone === "audio" ? plan.t : plan.zone === "first" ? 0 : st.t;
  let vt = t0; // 動画は続けて並べる
  let auT = t0;
  let seekTo = null;
  try {
    for (let i = 0; i < files.length; i++) {
      const { f, kind } = files[i];
      $('[data-c="busytext"]').textContent = T("読み込んでいます… {0} / {1}: {2}", i + 1, files.length, f.name);
      $('[data-c="busybar"]').style.width = `${Math.round((i / files.length) * 100)}%`;
      const v = await ctx.upload(f);
      if (plan.zone === "audio" || kind === "audio") {
        // 音声の段へ順に並べる(動画なら音だけ)
        const a = await addAudioItem(v, auT);
        if (seekTo === null) seekTo = a.start;
        auT = r3(a.start + audioLen(a));
        continue;
      }
      if (kind === "video" && row !== null) {
        const o = await addClip(v, { row, start: vt });
        vt = o.end;
        if (seekTo === null) seekTo = o.start;
        continue;
      }
      const o = await addOverlay(kind, v, { start: t0, ...(pos || {}), ...(row !== null ? { row } : {}) });
      if (seekTo === null) seekTo = o.start;
    }
  } catch (err) {
    ctx.notify(`入れられませんでした: ${err.message}`, "error");
  } finally {
    st.batch = false;
    commit(before);
    st.busy = false;
    busyEl.classList.remove("on", "up");
    $('[data-c="busybar"]').style.width = "0";
    await loadMedia();
    st.cur = -1;
    refresh();
    seek(seekTo ?? st.t);
  }
}

// ---------------------------------------------------------------- 設定(右側)
const num = (k, label, v, min, max, step, extra = "") => `<label class="fl">${label}<input type="number" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}" ${extra}></label>`;
const chk = (k, label, v, extra = "") => `<label class="ck"><input type="checkbox" data-k="${k}" ${v ? "checked" : ""} ${extra}><span>${label}</span></label>`;
// 色分けしたまとまり(開け閉めは覚える)。cls: main 緑 / stk 橙 / bgs 青 / pos 紫 / key 水色 / kf 黄 / tr 桃 / au 黄緑
const SEC_DEFAULT = { main: true, stk: true, bgs: true, pos: true, crop: true, au: true, key: false, kf: false, tr: false, lp: false, eg: false, mk: false, cl: false, ol: false };
function sec(cls, title, body, forceOpen = false) {
  const open = forceOpen || (st.secOpen[cls] ?? SEC_DEFAULT[cls] ?? true);
  return `<details class="sec s-${cls}" data-sec="${cls}" ${open ? "open" : ""}><summary>${title}</summary><div class="sb">${body}</div></details>`;
}
// 100 倍して % で見せる値
const PCT = new Set(["x", "y", "s", "w", "h", "size", "opacity", "strokeWidth", "strokeDx", "strokeDy", "strokeAlpha", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", "bgRadius", "wrap", "volume", "key.tol", "key.soft", "loop.amt", "strokeBlur", "edge.size", "edge.amt", "speed", "block",
  "mask.size", "mask.x", "mask.y", "mask.radius", "mask.feather", "mask.pulseAmt", "mask.pitch", "mask.gap", "mask.odd", "mask.even", "mask.round",
  "mask.rodd", "mask.reven", "ol.w", "ol.t", "ol.b", "ol.l", "ol.r", "ol.blur", "ol.alpha",
  "fillA", "radius", "pitch", "gap", "odd", "even", "rodd", "reven", "round", "strokeW"]);
const FDEF = { strokeWidth: 0.08, strokeDx: 0, strokeDy: 0, strokeAlpha: 1, bgAlpha: 0, bgPadX: 0.3, bgPadY: 0.3, bgOffX: 0, bgOffY: 0, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0,
  "key.color": "#00ff00", "key.tol": 0.3, "key.soft": 0.1, "key.despill": true, "tin.dur": 0.5, "tout.dur": 0.5, kfEase: "smooth", keepAspect: true,
  bgRadius: 0, wrap: 0, "loop.speed": 1, "loop.amt": 1, strokeBlur: 0, "edge.size": 0.15, "edge.amt": 1, block: 0.03, mosaic: "pixel", shape: "rect",
  ...Object.fromEntries(Object.entries(MASK_DEF).map(([k, v]) => [`mask.${k}`, v])), "ol.w": 0.01, "ol.blur": 0, "ol.color": "#ffffff", "ol.alpha": 1,
  fill: "#ffffff", fillA: 1, radius: 0.25, points: 5, pitch: 0.25, gap: 0.15, odd: 1, even: 1, rodd: 1, reven: 1, round: 0, stagger: false, strokeW: 0.01 };
// 範囲(書いた値をこの中に収める。% の欄は 0〜1 の値で)
const FRANGE = { x: [-1, 2], y: [-1, 2], s: [0.01, 8], w: [0.01, 4], h: [0.01, 4], size: [0.005, 1], rot: [-3600, 3600], opacity: [0, 1],
  strokeWidth: [0, 0.5], strokeDx: [-1, 1], strokeDy: [-1, 1], strokeAlpha: [0, 1], bgAlpha: [0, 1], bgPadX: [0, 3], bgPadY: [0, 3], bgOffX: [-3, 3], bgOffY: [-3, 3],
  volume: [0, 2], speed: [0.05, 16], fadeIn: [0, 600], fadeOut: [0, 600], "key.tol": [0, 1], "key.soft": [0.001, 1], "tin.dur": [0.05, 30], "tout.dur": [0.05, 30],
  bgRadius: [0, 1], wrap: [0, 2], "loop.speed": [0.1, 5], "loop.amt": [0, 3], strokeBlur: [0, 0.5], "edge.size": [0.01, 0.5], "edge.amt": [0.1, 3], block: [0.005, 0.2],
  "mask.size": [0.05, 3], "mask.x": [-1, 1], "mask.y": [-1, 1], "mask.rot": [-360, 360], "mask.radius": [0, 1], "mask.points": [3, 12], "mask.feather": [0, 0.5],
  "mask.spinSpeed": [-5, 5], "mask.swing": [0, 180], "mask.pulseSpeed": [0.05, 5], "mask.pulseAmt": [0, 0.9],
  "mask.pitch": [0.02, 1], "mask.gap": [-1, 0.95], "mask.odd": [0, 2], "mask.even": [0, 2], "mask.round": [0, 1], "mask.rodd": [0, 2], "mask.reven": [0, 2],
  "ol.w": [0, 0.2], "ol.t": [0, 0.2], "ol.b": [0, 0.2], "ol.l": [0, 0.2], "ol.r": [0, 0.2], "ol.blur": [0, 0.1], "ol.alpha": [0, 1],
  fillA: [0, 1], radius: [0, 1], points: [3, 12], pitch: [0.02, 1], gap: [-1, 0.95], odd: [0, 2], even: [0, 2], rodd: [0, 2], reven: [0, 2], round: [0, 1], strokeW: [0, 0.2] };
const TRANS_NAMES = { fade: "じんわり", dip_black: "暗転をはさむ", dip_white: "白をはさむ", wipe_h: "ワイプ(横)", wipe_v: "ワイプ(縦)", slide_h: "すべり込み(横)", slide_v: "すべり込み(縦)",
  split_h: "スプリット(横)", split_v: "スプリット(縦)", iris_circle: "アイリス(円)", iris_box: "アイリス(四角)", iris_diamond: "アイリス(ひし形)", clock: "時計回りに現れる", zoom: "ズーム(寄る・引く)", spin: "くるりん",
  pop: "ぱちん", boing: "ぽよよん", drop: "すとん(落ちて弾む)", bungee: "びよーん(ゴムのように)", rise: "にょきっ", tumble: "ころりん(転がる)", drift: "すーっ(流れ込む)", stagger: "よちよち",
  flicker: "チカッ(点滅しながら)", typing: "カタカタ(一文字ずつ)", blur: "ぼかし ⇄ 鮮明" };
const TRANS_GROUPS = [["じわっと", ["fade", "dip_black", "dip_white", "blur"]], ["形で見せる", ["wipe_h", "wipe_v", "split_h", "split_v", "iris_circle", "iris_box", "iris_diamond", "clock"]],
  ["動いて入る・出る", ["slide_h", "slide_v", "drop", "bungee", "rise", "tumble", "drift", "stagger"]], ["大きさ・回転", ["zoom", "spin", "pop", "boing"]], ["光・文字", ["flicker", "typing"]]];
// その効果で使えるチェック(左右反転・上下反転・効果反転)。第20版の動きは向き(dir)を選ぶ
const TRANS_FLAGS = { wipe_h: ["flipH"], wipe_v: ["flipV"], slide_h: ["flipH"], slide_v: ["flipV"], clock: ["flipH"], spin: ["flipH", "rev"], zoom: ["rev"],
  split_h: ["rev"], split_v: ["rev"], iris_circle: ["rev"], iris_box: ["rev"], iris_diamond: ["rev"] };
const DIR_TYPES = ["drop", "bungee", "rise", "tumble", "drift", "stagger"];
const DIR_NAMES = { top: "上", bottom: "下", left: "左", right: "右" };
// ずっと続ける動き(ループ)
const LOOP_NAMES = { sway: "ゆらゆら", pendulum: "ふりこ", jiggle: "ぷるぷる", spin: "ぐるぐる", breeze: "なびく", hop: "ぴょこぴょこ", float: "ふわふわ", wave: "うねうね", shake: "ガタガタ",
  beat: "ドキドキ", breathe: "すーはー", blink: "ぴかぴか", flicker: "チカチカ", focus: "ぼんやり ⇄ くっきり" };
const LOOP_GROUPS = [["回る・ゆれる", ["sway", "pendulum", "jiggle", "spin", "breeze"]], ["上下・左右に動く", ["hop", "float", "wave", "shake"]], ["大きさが変わる", ["beat", "breathe"]], ["光り方・ぼかし", ["blink", "flicker", "focus"]]];
const PIN_NAMES = { "": "おまかせ", c: "真ん中", t: "上", b: "下", l: "左", r: "右" };
const ANIM_ALL = new Set(["x", "y", "s", "w", "h", "size", "rot", "opacity"]);
function selStart(s, type = st.sel?.type) { return type === "clip" ? starts()[P().clips.indexOf(s)] : type === "au" ? audioView(s).start : s.start; }
function selLen(s, type = st.sel?.type) { return type === "clip" ? lenOf(s) : type === "au" ? audioLen(s) : s.end - s.start; }
function curAnim(s, type = st.sel?.type) {
  return animState(s, AKEYS[kindKey(type, s)], clamp(st.t - selStart(s, type), 0, selLen(s, type)));
}
function fieldVal(s, k, type = st.sel?.type) {
  const [a, b] = k.split(".");
  if (!b && type !== "au" && AKEYS[kindKey(type, s)].includes(a)) return curAnim(s, type)[a];
  if (k === "speed") return spd(s);
  const v = b ? s[a]?.[b] : s[a];
  return v ?? FDEF[k];
}
function showVal(k, v) {
  if (typeof v === "boolean" || typeof v === "string" || v == null) return v ?? "";
  return PCT.has(k) ? r3(v * 100) : k === "rot" ? r3(v) : r3(v);
}
// 種類ごとの欄
function transBox(s, which, title) {
  const tr = s[which];
  const flags = TRANS_FLAGS[tr?.type] || [];
  const isText = s.kind === "text";
  const groups = TRANS_GROUPS.map(([g, ts]) => {
    const list = ts.filter((t) => isText || t !== "typing");
    return `<optgroup label="${esc(T(g))}">${list.map((t) => `<option value="${t}" ${tr?.type === t ? "selected" : ""}>${esc(T(TRANS_NAMES[t]))}</option>`).join("")}</optgroup>`;
  }).join("");
  let h = `<div class="trbox"><b>${title}</b><label class="fl">効果<select data-k="${which}.type"><option value="">使わない</option>${groups}</select></label>`;
  if (tr?.type) {
    h += num(`${which}.dur`, "長さ(秒)", r3(tr.dur ?? 0.5), 0.05, 30, 0.05);
    if (DIR_TYPES.includes(tr.type)) {
      const d = DIR_VEC[tr.dir] ? tr.dir : MOTION_DIR[tr.type];
      h += `<label class="fl">向き<select data-k="${which}.dir" title="入るときはその向きから入り、出るときはその向きへ出ていきます">${Object.entries(DIR_NAMES).map(([k, v]) => `<option value="${k}" ${d === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>`;
    } else if (!MOTION_IN.includes(tr.type) && tr.type !== "blur") {
      h += `<div class="row ckrow">${chk(`${which}.flipH`, "左右反転", tr.flipH, flags.includes("flipH") ? "" : "disabled")}${chk(`${which}.flipV`, "上下反転", tr.flipV, flags.includes("flipV") ? "" : "disabled")}${chk(`${which}.rev`, "効果反転(中から外 ⇄ 外から中)", tr.rev, flags.includes("rev") ? "" : "disabled")}</div>`;
    }
    // ぼかしを重ねる(ワイプ + ぼかし など)
    if (tr.type !== "blur") h += chk(`${which}.blur`, "ぼかしも重ねる(入るときは ぼかし → 鮮明、出るときは 鮮明 → ぼかし)", tr.blur);
  }
  return `${h}</div>`;
}
// ふちのぼかし(止まっている間もずっと。画像・動画・つなげる動画)
function edgeSec(s) {
  const e = s.edge || {};
  let h = `<label class="fl">方法<select data-k="edge.mode"><option value="">使わない</option>
    <option value="feather" ${e.mode === "feather" ? "selected" : ""}>ふちを透明にぼかす</option>
    ${s.kind === "mosaic" ? "" : `<option value="blur" ${e.mode === "blur" ? "selected" : ""}>外側だけぼかす(真ん中はくっきり)</option>`}</select></label>`;
  if (e.mode) {
    h += num("edge.size", "ぼかす幅(%)", r3((e.size ?? 0.15) * 100), 1, 50, 1);
    if (e.mode === "blur") h += num("edge.amt", "ぼかしの強さ(%)", r3((e.amt ?? 1) * 100), 10, 300, 10);
  }
  h += `<div class="note">幅は短い辺に対しての %。「ふちを透明に」はまわりの段や背景になじみ、「外側だけぼかす」は外側をぼかして真ん中はくっきりのままです。</div>`;
  return sec("eg", `ふちのぼかし${e.mode ? " ●" : ""}`, h, !!e.mode && st.secOpen.eg !== false);
}
// 図形マスク: レイヤーの中を、選んだ形だけ見せる。形は回る / 揺れる・伸び縮みできる
function maskSec(s) {
  const mk = s.mask || {};
  const on = SHAPE_KEYS.has(mk.shape) || mk.shape === "path";
  const v = (k) => showVal(`mask.${k}`, fieldVal(s, `mask.${k}`));
  let h = `<label class="fl">形<select data-k="mask.shape"><option value="">使わない</option>${mk.shape === "path" ? `<option value="path" selected>${esc(T("パス"))}</option>` : ""}${SHAPES.map(([x, n]) => `<option value="${x}" ${mk.shape === x ? "selected" : ""}>${esc(T(n))}</option>`).join("")}</select></label>`;
  if (on) h += chk("mask.invert", "反転(形の中を消す)", !!mk.invert);
  if (on && mk.shape !== "path") {
    h += `<label class="fl">形の縦横<select data-k="mask.fit"><option value="square" ${mk.fit !== "fill" ? "selected" : ""}>正方形・正円(短い辺に合わせる)</option><option value="fill" ${mk.fit === "fill" ? "selected" : ""}>レイヤーの縦横に合わせる</option></select></label>
      ${num("mask.size", "大きさ(%)", v("size"), 5, 300, 5)}${num("mask.x", "位置 横(%)", v("x"), -100, 100, 1)}${num("mask.y", "位置 縦(%)", v("y"), -100, 100, 1)}
      ${num("mask.rot", "向き(度)", v("rot"), -360, 360, 1)}
      ${mk.shape === "rrect" ? num("mask.radius", "角の丸み(%)", v("radius"), 0, 100, 1) : ""}${mk.shape === "star" ? num("mask.points", "星の角の数", v("points"), 3, 12, 1) : ""}
      ${PATTERNS.has(mk.shape) ? patFields(v, mk) : ""}
      ${num("mask.feather", "ぼかす幅(%)", v("feather"), 0, 50, 1)}
      <label class="fl">回す<select data-k="mask.spin"><option value="">回さない</option><option value="spin" ${mk.spin === "spin" ? "selected" : ""}>回り続ける</option><option value="swing" ${mk.spin === "swing" ? "selected" : ""}>左右に揺れる</option></select></label>
      ${mk.spin === "spin" ? num("mask.spinSpeed", "回る速さ(回/秒)", v("spinSpeed"), -5, 5, 0.05) : ""}
      ${mk.spin === "swing" ? num("mask.spinSpeed", "揺れる速さ(往復/秒)", v("spinSpeed"), -5, 5, 0.05) + num("mask.swing", "揺れる幅(度)", v("swing"), 0, 180, 1) : ""}
      <label class="fl">大きさの動き<select data-k="mask.pulse"><option value="">動かさない</option><option value="pulse" ${mk.pulse === "pulse" ? "selected" : ""}>伸び縮み</option></select></label>
      ${mk.pulse === "pulse" ? num("mask.pulseSpeed", "伸び縮みの速さ(回/秒)", v("pulseSpeed"), 0.05, 5, 0.05) + num("mask.pulseAmt", "伸び縮みの幅(%)", v("pulseAmt"), 0, 90, 1) : ""}`;
  }
  h += `<div class="note">レイヤーの中を、選んだ形だけ見せます(外は透明)。大きさ・位置はレイヤーの枠に対しての %、ぼかす幅は形の短い辺(タイル・水玉は 1 つの大きさ)に対しての %。
    回す・大きさの動きは、表示している間ずっとくり返します(速さは 1 秒に何回か。回る速さをマイナスにすると左回り)。</div>`;
  return sec("mk", `図形マスク${on ? " ●" : ""}`, h, on && st.secOpen.mk !== false);
}
// タイル・水玉の並べ方
// タイル・水玉の並べ方(pre: 欄のキーの前に付ける。図形マスクは "mask."、図形のレイヤーは "")
function patFields(v, mk, pre = "mask.") {
  return `${num(`${pre}pitch`, "並べる間隔(%)", v("pitch"), 2, 100, 1)}${num(`${pre}gap`, "すき間(%)", v("gap"), -100, 95, 1)}
    ${rulesHtml(mk.rules, (i, f, val, w) => `<input type="number" data-k="${pre}rules" data-i="${i}" data-f="${f}" value="${val}" style="width:${w}px">`,
    (i) => `<button data-a="ruledel" data-pre="${pre}" data-i="${i}" title="この条件を消す">✕</button>`, `<button data-a="ruleadd" data-pre="${pre}">＋ 大きさを変える条件を追加</button>`, (x) => esc(T(x)))}
    ${mk.shape === "tile" ? num(`${pre}round`, "角の丸み(%)", v("round"), 0, 100, 1) : ""}
    ${chk(`${pre}stagger`, "一行おきに半分ずらす", !!mk.stagger)}
    <div class="note">並べる間隔は形の短い辺に対しての %、すき間は間隔に対しての %。「大きさを変える条件」は、上から w 番目の段から x 段おき、その段の左から y 番目から z つおきの物の大きさを変えます(0 おきは毎回。0% で無し)。条件はいくつでも足せて、後の条件が優先です。図形マスクの「回す」「大きさの動き」は、並べた 1 つずつが動きます。</div>`;
}
// 図形のレイヤーの形・色
function shapeMainHtml(s) {
  const v = (k) => showVal(k, fieldVal(s, k));
  const opts = [...SHAPES, ["path", "パス"]];
  let h = `<label class="fl">形<select data-k="shape">${opts.map(([x, n]) => `<option value="${x}" ${s.shape === x ? "selected" : ""}>${esc(T(n))}</option>`).join("")}</select></label>
    <label class="fl">塗りの色<input type="color" data-k="fill" value="${esc(s.fill || "#ffffff")}"></label>${num("fillA", "塗りの不透明度(%)", v("fillA"), 0, 100, 1)}`;
  if (s.shape === "rrect") h += num("radius", "角の丸み(%)", v("radius"), 0, 100, 1);
  if (s.shape === "star") h += num("points", "星の角の数", v("points"), 3, 12, 1);
  if (PATTERNS.has(s.shape)) h += patFields(v, s, "");
  if (s.shape === "path") {
    h += `${chk("closed", "パスを閉じる", s.closed !== false)}${chk("noFill", "線だけ(内側を塗らない)", !!s.noFill)}${num("strokeW", "線の太さ(%)", v("strokeW"), 0, 20, 0.1)}
      <div class="row" style="margin-top:4px"><button data-a="redrawpath">✒ パスを描き直す</button></div>`;
  }
  h += `<div class="note">マスクに使うときは、見せたい動画・画像をこの図形のすぐ上の段に置き、その動画・画像の「下のレイヤーで切り抜く」を使います(「下のレイヤーはマスクにだけ使う」で図形は表示しない)。線の太さは画面の高さに対しての %。</div>`;
  return h;
}
// ふち取り(画像・動画): 不透明な所のまわりに縁を付ける
function olSec(s) {
  const ol = s.ol || {}, on = !!ol.on;
  const v = (k) => showVal(`ol.${k}`, fieldVal(s, `ol.${k}`));
  let h = chk("ol.on", "ふち取りを付ける", on);
  const sd = outlineSides({ w: 0.01, ...ol }), pc = (x) => r3(x * 100);
  if (on) h += `${num("ol.w", "太さ・上下左右まとめて(%)", pc(Math.max(sd.t, sd.b, sd.l, sd.r)), 0, 20, 0.1)}
    ${num("ol.t", "上(%)", pc(sd.t), 0, 20, 0.1)}${num("ol.b", "下(%)", pc(sd.b), 0, 20, 0.1)}${num("ol.l", "左(%)", pc(sd.l), 0, 20, 0.1)}${num("ol.r", "右(%)", pc(sd.r), 0, 20, 0.1)}
    ${num("ol.blur", "ぼかし(%)", v("blur"), 0, 10, 0.1)}
    <label class="fl">色<input type="color" data-k="ol.color" value="${esc(fieldVal(s, "ol.color"))}"></label>${num("ol.alpha", "不透明度(%)", v("alpha"), 0, 100, 1)}`;
  h += `<div class="note">レイヤーの不透明な部分(色で抜いた・図形マスクの後の形)のまわりに縁を付けます。上下左右で太さを変えられます。太さ・ぼかしは画面の高さに対しての %。</div>`;
  return sec("ol", `ふち取り${on ? " ●" : ""}`, h, on && st.secOpen.ol !== false);
}
// 下のレイヤーで切り抜く(画像・動画)。その時刻に見えている、すぐ下のレイヤーの透明でない所を使う
function clipSec(s) {
  const on = s.clip === "in" || s.clip === "out";
  const opt = (v, n) => `<option value="${v}" ${(s.clip || "") === v ? "selected" : ""}>${n}</option>`;
  const h = `<label class="fl">抜き方<select data-k="clip">${opt("", "使わない")}${opt("in", "下のレイヤーの見えている部分だけ表示")}${opt("out", "下のレイヤーの見えている部分を除外")}</select></label>
    ${chk("clipHide", "下のレイヤーはマスクにだけ使う(見せない)", !!s.clipHide || s.clip === "out", s.clip === "in" ? "" : "disabled")}
    ${s.clip === "out" ? `<div class="note">${esc(T("「除外」のときは、抜く形に使う下のレイヤーは見せません"))}</div>` : ""}
    <div class="note">その時刻に見えている、すぐ下のレイヤー(画像・動画・文字。下のレイヤーも「下のレイヤーで切り抜く」なら、さらに下)の透明でない所を使います。下のレイヤーを動かすと、抜く形も動きます。</div>`;
  return sec("cl", `下のレイヤーで切り抜く${on ? " ●" : ""}`, h, on && st.secOpen.cl !== false);
}
// ずっと続ける動き(表示している間くり返す)
function loopSec(s) {
  const lp = s.loop || {};
  const groups = LOOP_GROUPS.map(([g, ts]) => `<optgroup label="${esc(T(g))}">${ts.map((t) => `<option value="${t}" ${lp.type === t ? "selected" : ""}>${esc(T(LOOP_NAMES[t]))}</option>`).join("")}</optgroup>`).join("");
  let h = `<label class="fl">動き<select data-k="loop.type"><option value="">使わない</option>${groups}</select></label>`;
  if (lp.type) {
    h += `${num("loop.speed", "速さ(倍)", r3(lp.speed ?? 1), 0.1, 5, 0.1)}${num("loop.amt", "強さ(%)", r3((lp.amt ?? 1) * 100), 0, 300, 10)}
      <label class="fl">支点<select data-k="loop.pin" title="回る・大きさが変わるときの中心">${Object.entries(PIN_NAMES).map(([k, v]) => `<option value="${k}" ${(lp.pin || "") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>`;
    if (lp.type === "spin") h += `<label class="fl">回る向き<select data-k="loop.dir"><option value="cw" ${lp.dir !== "ccw" ? "selected" : ""}>右回り</option><option value="ccw" ${lp.dir === "ccw" ? "selected" : ""}>左回り</option></select></label>`;
  }
  h += `<div class="note">表示している間、ずっとくり返します。入る・出るのトランジションや、キーフレームの動きと一緒に使えます。</div>`;
  return sec("lp", `ずっと動かす(ループ)${lp.type ? " ●" : ""}`, h, !!lp.type && st.secOpen.lp !== false);
}
function transSec(s) {
  const used = !!(s.tin?.type || s.tout?.type);
  return sec("tr", `トランジション(入る・出る)${used ? " ●" : ""}`, `${transBox(s, "tin", "入るとき")}${transBox(s, "tout", "出るとき")}
    <div class="note">左右反転・上下反転は、ワイプ・すべり込みなどの向きを逆にします。効果反転は、アイリス・スプリット・ズームの「中から外」と「外から中」を入れ替えます(その効果で使えないチェックは押せません)。</div>`, false);
}
// キーフレームの一覧(入力中でも、ここだけ書き換える)
function kfListHtml(s, type) {
  const kf = s.kf || [];
  const keys = AKEYS[kindKey(type, s)];
  const lab = { x: "横", y: "縦", s: "大きさ", w: "幅", h: "高さ", size: "大きさ", rot: "回転", opacity: "不透明度" };
  const rows = kf.map((k, i) => `<div class="kfrow"><span>◆ ${r3(k.t).toFixed(2)} ${T("秒")}</span><span class="kv">${keys.map((x) => `${T(lab[x])} ${x === "rot" ? r3(k[x] ?? 0) : r3((k[x] ?? DEF[x]) * 100)}${x === "rot" ? "°" : "%"}`).join(" · ")}</span>
    <button data-a="kfgo" data-i="${i}" title="${T("このキーフレームの時刻へ移る")}">${T("移る")}</button><button data-a="kfdel" data-i="${i}">${T("消す")}</button></div>`).join("");
  return rows || `<div class="note">${T("まだありません")}</div>`;
}
function syncKfList(s, type = st.sel?.type) {
  const box = $('[data-c="insp"]');
  const l = box.querySelector("[data-kfl]");
  if (!l || !s) return;
  const h = kfListHtml(s, type);
  if (l.dataset.h !== h) { l.innerHTML = h; l.dataset.h = h; }
  const n = box.querySelector("[data-kfn]");
  if (n) n.textContent = s.kf?.length ? ` ◆${s.kf.length}` : "";
  const c = box.querySelector('[data-a="kfclear"]');
  if (c) c.disabled = !s.kf?.length;
}
function kfSec(s, type) {
  const kf = s.kf || [];
  return sec("kf", `動き(キーフレーム)<span data-kfn>${kf.length ? ` ◆${kf.length}` : ""}</span>`, `<div class="note">再生位置に、今の位置・大きさ・回転・不透明度を「◆ 記録」します。時刻を変えてもう一つ記録すると、その間をなめらかに動きます。
    キーフレームがあるときは、プレビューや上の欄で変えると、再生位置のキーフレームに入ります(無ければ作ります)。</div>
    <div class="row" style="margin-top:4px"><button data-a="kfadd">◆ 再生位置に記録</button><button data-a="kfclear" ${kf.length ? "" : "disabled"}>すべて消す</button></div>
    <label class="fl">動き方<select data-k="kfEase" title="なめらか: ゆっくり動き始めて、ゆっくり止まる。一定の速さ: 同じ速さで動く"><option value="smooth" ${s.kfEase !== "linear" ? "selected" : ""}>なめらか</option><option value="linear" ${s.kfEase === "linear" ? "selected" : ""}>一定の速さ</option></select></label>
    <div class="kfl" data-kfl>${kfListHtml(s, type)}</div>`, kf.length > 0 && st.secOpen.kf !== false);
}
function keySec(s, type) {
  const k = s.key || {};
  const isImg = s.kind === "image";
  let h = `<label class="fl">方法<select data-k="key.mode"><option value="">しない${!isImg && s.alpha ? "(元の透明度はそのまま使います)" : ""}</option>
    <option value="chroma" ${k.mode === "chroma" ? "selected" : ""}>色で抜く(緑の背景など)</option>
    <option value="ai" ${k.mode === "ai" ? "selected" : ""}>AI で人や物だけ残す</option>
    ${isImg ? "" : `<option value="alpha" ${k.mode === "alpha" ? "selected" : ""}>元の透明度を使う</option>`}</select></label>`;
  if (k.mode === "chroma") {
    h += `<label class="fl">抜く色<span class="row" style="flex-wrap:nowrap"><input type="color" data-k="key.color" value="${k.color || "#00ff00"}" style="flex:1;min-width:0"><button data-a="eyedrop" class="${st.eyedrop ? "on" : ""}" style="white-space:nowrap" title="プレビューを押して、その所の色を抜く色にします">💧 スポイト</button></span></label>
      ${num("key.tol", "抜く範囲(%)", r3((k.tol ?? 0.3) * 100), 0, 100, 1)}${num("key.soft", "境目のぼかし(%)", r3((k.soft ?? 0.1) * 100), 0.1, 100, 1)}
      ${chk("key.despill", "色かぶりを消す(縁に残った緑などを抑える)", k.despill !== false)}
      <div class="note">プレビューでもその場で抜けます。抜けすぎるときは「抜く範囲」を小さく、残るときは大きくします。</div>`;
  } else if (k.mode === "ai") h += `<div class="note">背景を消すモデル(BiRefNet、画像編集の「背景を自動で消す」と同じファイル)で、書き出すときにコマごとに消します。プレビューでは消えません。時間がかかります。</div>`;
  else if (k.mode === "alpha") h += `<div class="note">透明な部分のある動画(VP9 の WebM など)の透明度をそのまま使います。</div>`;
  h += `<div class="note">背景を透明にしたものは、下の段や背景(書き出しの「背景」)が透けて見えます。透明のまま書き出すには、書き出す形式を WebM・WebP・GIF にして、背景を「透明」にします。</div>`;
  return sec("key", `背景を透明にする${k.mode ? " ●" : ""}`, h, false);
}
function posSec(s, type, extra = "") {
  const a = curAnim(s, type);
  const kfn = s.kf?.length ? `<div class="note kfnote">${T("◆ キーフレームがあります。ここで変えると再生位置({0})のキーフレームに入ります。", fmt(st.t))}</div>` : "";
  let h = kfn + `${num("x", "位置 横(%)", r3(a.x * 100), -100, 200, 0.5)}${num("y", "位置 縦(%)", r3(a.y * 100), -100, 200, 0.5)}`;
  if (type === "clip") h += num("s", "大きさ(%)", r3(a.s * 100), 1, 800, 1);
  else if (s.kind === "text") h += num("size", "文字の大きさ(%)", r3(a.size * 100), 0.5, 100, 0.5);
  else h += `${num("w", "幅(%)", r3(a.w * 100), 1, 400, 0.5)}${num("h", "高さ(%)", r3(a.h * 100), 1, 400, 0.5)}${s.kind === "mosaic" || s.kind === "shape" ? "" : chk("keepAspect", "縦横比を保つ", s.keepAspect !== false)}`;
  h += `${num("rot", "回転(度)", r3(a.rot), -3600, 3600, 1)}${num("opacity", "不透明度(%)", r3(a.opacity * 100), 0, 100, 1)}`;
  // 動画・画像のレイヤーも、真ん中・画面に収まる大きさに戻せる(第19版の「つなげる動画」と同じ。第27版でレイヤーにも)
  if (type === "ov" && ["video", "image"].includes(s.kind)) h += `<div class="row" style="margin-top:6px"><button data-a="resetpos" title="真ん中・画面に収まる大きさ・回転なし・不透明に戻します(キーフレームも消えます)">↺ 元に戻す</button></div>`;
  if (type === "clip") h += `<div class="row" style="margin-top:6px"><button data-a="resetpos" title="真ん中・元の大きさ・回転なし・不透明に戻します(キーフレームも消えます)">↺ 元に戻す</button></div>
    <div class="note">プレビューの上でドラッグして動かし、右下の■で大きさを変えられます。小さくすると、書き出しの背景(黒・白・透明)が見えます。</div>`;
  return sec("pos", "位置・大きさ・回転・不透明度", h + extra);
}
function timeRows(s) {
  return `${num("start", "出し始め(秒)", s.start, 0, 99999, 0.01)}${num("end", "出し終わり(秒)", s.end, 0, 99999, 0.01)}
    <div class="row" style="margin-top:6px"><button data-a="here">再生位置から出す</button><button data-a="toend">最後まで出す</button></div>`;
}
function tplSelect(s) {
  const S = st.styles;
  if (!S) { loadStyles(); return `<div class="note">テンプレートを読み込んでいます…</div>`; }
  const opt = (pfx, it, star) => `<option value="${pfx}:${esc(it.name)}" ${st.tplSel === `${pfx}:${it.name}` ? "selected" : ""}>${star}${esc(T(it.name))}</option>`;
  return `<label class="fl">テンプレート<select data-c="tpl" title="選ぶと、この文字に当てはめます"><option value="">(選んで当てはめる)</option>
    <optgroup label="${T("★ おすすめ")}">${S.builtin.map((it) => opt("b", it, "★ ")).join("")}</optgroup>
    ${S.user.length ? `<optgroup label="${T("保存したもの")}">${S.user.map((it) => opt("u", it, "")).join("")}</optgroup>` : ""}</select></label>
    <div class="row" style="margin-top:4px"><button data-a="tplsave" title="今の文字の色・縁・背景・フォント・大きさを、名前をつけて保存します">💾 今の書式を保存</button>
    <button data-a="tpldel" ${st.tplSel ? "" : "disabled"} title="選んでいるテンプレートを消します(おすすめは隠します)">🗑 消す</button>
    ${S.hidden?.length ? `<button data-a="tplunhide" title="隠したおすすめを戻します">↺ おすすめを戻す(${S.hidden.length})</button>` : ""}</div>`;
}
function renderInspector() {
  const box = $('[data-c="insp"]');
  markTools();
  if (st.pathDraw) { box.innerHTML = pathPanelHtml(); return; }
  const s = findSel();
  if (!s) {
    box.innerHTML = `<h4>選んだもの</h4><div class="note">タイムラインの動画・文字・画像・音声を押すと、ここで細かく変えられます。</div>`;
    delete box.dataset.for;
    st.secs?.side.apply();
    return;
  }
  const type = st.sel.type;
  if (box.contains(document.activeElement) && box.dataset.for === `${type}${s.id}`) {
    // 入力中は書き換えない(値だけ合わせる)
    for (const el of box.querySelectorAll("[data-k]")) if (el !== document.activeElement) setField(el, s);
    return;
  }
  box.dataset.for = `${type}${s.id}`;
  let h = "";
  if (type === "clip") {
    const cr = s.crop || [0, 0, s.w, s.h];
    const la = P().audios.find((a) => a.link === s.id);
    h = `<h4>動画: ${esc(s.name)}</h4><div class="note">元の長さ ${s.dur.toFixed(2)} 秒・${s.w}×${s.h}・${(+s.fps).toFixed(2)} fps${s.audio ? "" : "・音なし"}${s.alpha ? "・透明あり" : ""}</div>`;
    h += sec("main", "使う所・速さ", `${num("in", "使う所の始め(秒)", s.in, 0, s.dur, 0.01)}${num("out", "使う所の終わり(秒)", s.out, 0, s.dur, 0.01)}
      ${num("speed", "速さ(%)", r3(spd(s) * 100), 5, 1600, 5)}
      <div class="note">100% がそのまま。200% で 2 倍速(長さは半分)、50% でゆっくり(長さは 2 倍)。タイムラインの「⇔ 伸縮」をオンにして(または Shift を押しながら)端をドラッグしても変えられます。
        つながっている音声も同じ速さになります(音の高さは音声の設定で)。</div>
      ${la ? `<div class="row" style="margin-top:6px"><button data-a="selau" title="この動画の音(音声の段)を選んで、音量などを変えます">🔊 この動画の音を調節</button></div>` : ""}`);
    h += sec("crop", "画面を切り取る", `<div class="row"><button data-a="crop" class="${st.cropMode ? "on" : ""}">▭ 画面で範囲を指定</button><button data-a="uncrop">切り取りを外す</button></div>
      <div class="xy" style="margin-top:4px">${["x", "y", "w", "h"].map((k, i) => `<input type="number" data-k="crop${i}" value="${cr[i]}" title="${["左", "上", "幅", "高さ"][i]}(px)">`).join("")}</div>
      <div class="note">左・上・幅・高さ(元の動画の画素)。切り取った範囲は、書き出す大きさに合わせて拡大・縮小します。</div>`);
    h += posSec(s, type) + edgeSec(s) + keySec(s, type) + kfSec(s, type) + transSec(s) + loopSec(s);
  } else if (type === "au") {
    const v = audioView(s), linked = s.link != null;
    const dis = linked ? "disabled" : "";
    h = `<h4>音声: ${esc(s.name)}</h4>`;
    if (linked) h += `<div class="note">🔗 動画とつながっています(置く所・使う所・速さは動画と同じ)。切り離すと、音だけを別に動かせます。</div>
      <div class="row" style="margin-top:4px"><button data-a="unlink">切り離す</button><button data-a="selclip">つながっている動画を選ぶ</button></div>`;
    const vk = s.vkf || [];
    h += sec("au", "音量", `${num("volume", vk.length ? "音量(%・再生位置)" : "音量(%)", r3(volAt(s, st.t - v.start) * 100), 0, 200, 5)}
      <div class="vmeter" data-c="vmeter" title="${esc(T("再生位置の音の大きさ(音量・フェードを掛けたあと)。白い線は一番大きい所"))}"><i></i><b></b><span></span></div>
      ${chk("mute", "無音にする(ミュート)", s.mute)}
      <div class="note">音声が全部無音(またはミュート)なら、音の無いファイルで書き出します。</div>
      ${num("fadeIn", "フェードイン(秒)", r3(s.fadeIn || 0), 0, 600, 0.1)}${num("fadeOut", "フェードアウト(秒)", r3(s.fadeOut || 0), 0, 600, 0.1)}`);
    // 音量の動き(キーフレーム): 画像・文字の「動き(キーフレーム)」と同じ形
    h += sec("kf", `音量の動き(キーフレーム)<span data-kfn>${vk.length ? ` ◆${vk.length}` : ""}</span>`, `<div class="note">再生位置に、今の音量を「◆ 記録」します。時刻を変えてもう一つ記録すると、その間で音量が変わります。
      キーフレームがあるときは、上の「音量」を変えると、再生位置のキーフレームに入ります(無ければ作ります)。タイムラインの音声の段に、黄色い線で出ます。</div>
      <div class="row" style="margin-top:4px"><button data-a="vkadd">◆ 再生位置に記録</button><button data-a="vkclear" ${vk.length ? "" : "disabled"}>すべて消す</button></div>
      <label class="fl">動き方<select data-k="vkEase" title="なめらか: ゆっくり変わり始めて、ゆっくり止まる。一定の速さ: 同じ速さで変わる"><option value="smooth" ${s.vkEase !== "linear" ? "selected" : ""}>なめらか</option><option value="linear" ${s.vkEase === "linear" ? "selected" : ""}>一定の速さ</option></select></label>
      <div class="kfl">${vk.map((q, i) => `<div class="kfrow"><span>◆ ${r3(v.start + q.t).toFixed(2)} ${T("秒")}</span><span class="kv">${T("音量")} ${Math.round(q.v * 100)}%</span>
        <button data-a="vkgo" data-i="${i}" title="${T("このキーフレームの時刻へ移る")}">${T("移る")}</button><button data-a="vkdel" data-i="${i}">${T("消す")}</button></div>`).join("") || `<div class="note">${T("まだありません")}</div>`}</div>`, vk.length > 0 && st.secOpen.kf !== false);
    h += sec("main", "置く所・使う所・速さ", `${num("start", "置く時刻(秒)", r3(v.start), 0, 99999, 0.01, dis)}
      ${num("in", "元の音声のどこから(秒)", r3(v.in), 0, s.dur || 99999, 0.01, dis)}${num("out", "元の音声のどこまで(秒)", r3(v.out), 0, s.dur || 99999, 0.01, dis)}
      ${num("speed", "速さ(%)", r3(v.speed * 100), 5, 1600, 5, dis)}${chk("keepPitch", "速さを変えても音の高さを保つ(タイムストレッチ)", s.keepPitch !== false)}
      <div class="note">高さを保たないと、速くすると高い声、遅くすると低い声になります。</div>`);
  } else if (s.kind === "text") {
    h = `<h4>文字</h4>`;
    h += textSectionsHtml(s, {
      fontOptions: (cur) => fontOptions(cur), tplHtml: tplSelect(s), size: fieldVal(s, "size"),
      open: (c) => st.secOpen[c] ?? SEC_DEFAULT[c] ?? true,
      fontButtons: `<div class="row" style="margin-top:4px"><button data-a="gfont">＋ Google Fonts から追加</button><button data-a="fontdir" title="フォント(.ttf / .otf / .ttc)を入れるフォルダを開く">📂 フォントのフォルダ</button><button data-a="fontre" title="フォントの一覧を読み直す">🔄</button></div>
      <div class="note">この PC のフォントと、フォントのフォルダに入れたフォントから選べます。</div>`,
    });
    h += posSec(s, type, timeRows(s)) + kfSec(s, type) + transSec(s) + loopSec(s);
  } else if (s.kind === "mosaic") {
    const mode = ["pixel", "blur", "fill"].includes(s.mosaic) ? s.mosaic : "pixel";
    h = `<h4>モザイク</h4>`;
    h += sec("main", "モザイク(種類・大きさ・形)", `<label class="fl">種類<select data-k="mosaic">
        <option value="pixel" ${mode === "pixel" ? "selected" : ""}>モザイク(ブロック)</option>
        <option value="blur" ${mode === "blur" ? "selected" : ""}>ぼかし</option>
        <option value="fill" ${mode === "fill" ? "selected" : ""}>塗りつぶし(黒帯など)</option></select></label>
      ${mode !== "fill" ? num("block", mode === "pixel" ? "モザイクの大きさ(%)" : "ぼかしの強さ(%)", r3((s.block ?? 0.03) * 100), 0.5, 20, 0.5, `title="${esc(T("画面の短い辺に対しての %。大きいほど粗く(強く)なります"))}"`) : `<label class="fl">色<input type="color" data-k="color" value="${s.color || "#000000"}"></label>`}
      <label class="fl">形<select data-k="shape"><option value="rect" ${s.shape !== "ellipse" ? "selected" : ""}>四角</option><option value="ellipse" ${s.shape === "ellipse" ? "selected" : ""}>まる</option></select></label>
      <div class="note">置いた所の下にある動画・画像・文字を加工します。枠の中をドラッグで動かし、角で大きさ、下の丸で回します。
        動く人などに合わせるときは、「動き(キーフレーム)」で時刻ごとの位置を記録します。プレビューのモザイクには下の文字は入りません(書き出しには入ります)。</div>`);
    h += posSec(s, type, timeRows(s)) + edgeSec(s) + kfSec(s, type) + transSec(s) + loopSec(s);
  } else if (s.kind === "shape") {
    h = `<h4>${esc(T("図形"))}: ${esc(s.name || "")}</h4>`;
    h += sec("main", "図形(形・色)", shapeMainHtml(s));
    h += posSec(s, type, timeRows(s)) + edgeSec(s) + clipSec(s) + olSec(s) + kfSec(s, type) + transSec(s) + loopSec(s);
  } else {
    h = `<h4>${s.kind === "image" ? "画像" : "動画"}: ${esc(s.name)}</h4>`;
    if (s.kind === "video") h += sec("main", "使う所・速さ・音", `${num("in", "元の動画のどこから(秒)", s.in, 0, s.dur, 0.01)}${num("speed", "速さ(%)", r3(spd(s) * 100), 5, 1600, 5)}
      ${P().audios.some((a) => a.link === s.id) ? `<div class="row" style="margin-top:6px"><button data-a="selau" title="この動画の音(音声の段)を選んで、音量などを変えます">🔊 この動画の音を調節</button></div>`
    : `${chk("audio", "音を入れる", s.audio)}${num("volume", "音量(%)", r3((s.volume ?? 1) * 100), 0, 200, 5)}`}`);
    if (s.kind === "video") {
      const cr = s.crop || [0, 0, s.vw || 16, s.vh || 9];
      h += sec("crop", "画面を切り取る", `<div class="row">${st.cropMode
        ? `<button class="pri" data-a="cropok" title="Enter">✂ この範囲で切り取る</button><button data-a="cropno" title="Esc">やめる</button>`
        : `<button data-a="crop">▭ 画面で範囲を指定</button><button data-a="uncrop">切り取りを外す</button>`}</div>
      <div class="xy" style="margin-top:4px">${["x", "y", "w", "h"].map((k, i) => `<input type="number" data-k="crop${i}" value="${cr[i]}" title="${["左", "上", "幅", "高さ"][i]}(px)">`).join("")}</div>
      <div class="row" style="margin-top:6px"><button data-a="fitcrop" title="書き出す動画の大きさを、この動画(切り取った範囲)と同じにして、画面いっぱいに置きます">⤢ 書き出す大きさをこの範囲に合わせる</button></div>
      <div class="note">${st.cropMode ? "枠の角・中をドラッグして範囲を決め、「✂ この範囲で切り取る」(Enter)で切り取ります。「やめる」(Esc)で指定する前に戻ります。" : "左・上・幅・高さ(元の動画の画素)。「▭ 画面で範囲を指定」で、画面の枠を動かして決められます。"}</div>
      <div class="note">切り取ると、幅はそのままで縦横比が合います。画面いっぱいの動画を切り取ったときは、書き出す大きさも切り取った範囲になります。</div>`);
    }
    h += posSec(s, type, timeRows(s)) + edgeSec(s) + maskSec(s) + clipSec(s) + olSec(s) + keySec(s, type) + kfSec(s, type) + transSec(s) + loopSec(s);
  }
  box.innerHTML = h;
  for (const d of box.querySelectorAll("details.sec")) d.addEventListener("toggle", () => { st.secOpen[d.dataset.sec] = d.open; });
  st.secs?.side.apply(); // 見出しを作り直したので、折りたたみのつまみを付け直す
  st.secs?.insp.rerendered();
  updateMeter();
}
function setField(el, s) {
  const k = el.dataset.k;
  if (el.dataset.f !== undefined) return; // 大きさを変える条件の欄は、作り直すときだけ
  if (/^crop\d$/.test(k)) el.value = (s.crop || (st.sel?.type === "ov" ? [0, 0, s.vw || 16, s.vh || 9] : [0, 0, s.w, s.h]))[Number(k[4])];
  else if (k === "font") el.value = s.font || "";
  else if (st.sel?.type === "au" && ["start", "in", "out", "speed"].includes(k)) el.value = r3(audioView(s)[k] * (k === "speed" ? 100 : 1));
  else {
    const v = fieldVal(s, k);
    if (el.type === "checkbox") el.checked = k === "keepAspect" || k === "keepPitch" || k === "key.despill" ? v !== false : !!v;
    else el.value = showVal(k, v);
  }
}
// 値を入れる(a.b は入れ子)。入れたら true
function applyField(s, type, k, el) {
  if (k === "vkEase") { s.vkEase = el.value === "linear" ? "linear" : "smooth"; return true; }
  const [a, b] = k.split(".");
  if (/^crop\d$/.test(k)) {
    const n = Number(el.value);
    const IW = type === "ov" ? s.vw || 16 : s.w, IH = type === "ov" ? s.vh || 9 : s.h;
    const cr = [...(s.crop || [0, 0, IW, IH])];
    cr[Number(k[4])] = Math.round(n || 0);
    cr[0] = clamp(cr[0], 0, IW - 16); cr[1] = clamp(cr[1], 0, IH - 16);
    cr[2] = clamp(cr[2], 16, IW - cr[0]); cr[3] = clamp(cr[3], 16, IH - cr[1]);
    s.crop = cr;
    if (type === "ov" && !st.cropMode) { // 指定中は「✂ この範囲で切り取る」で合わせる
      const full = Math.abs((s.w || 0) - 1) < 0.02 && Math.abs((s.h || 0) - 1) < 0.02;
      cropAspect(s);
      if (full) fitFirst(s); // 画面いっぱいの動画なら、書き出す大きさも合わせる
    }
    return true;
  }
  if (k === "font") { if (el.value) s.font = el.value; else delete s.font; return true; }
  if (k === "key.mode") {
    s.key = el.value ? { color: "#00ff00", tol: 0.3, soft: 0.1, despill: true, ...(s.key || {}), mode: el.value } : null;
    if (el.value) st.secOpen.key = true;
    return true;
  }
  if (k === "edge.mode") {
    s.edge = el.value ? { size: 0.15, amt: 1, ...(s.edge || {}), mode: el.value } : null;
    if (el.value) st.secOpen.eg = true;
    return true;
  }
  if (k === "loop.type") {
    s.loop = el.value ? { speed: 1, amt: 1, ...(s.loop || {}), type: el.value } : null;
    if (el.value) st.secOpen.lp = true;
    return true;
  }
  if (k === "mask.shape") {
    const was = s.mask?.shape;
    s.mask = SHAPE_KEYS.has(el.value) || (el.value === "path" && s.mask?.pts?.length) ? { ...MASK_DEF, ...(s.mask || {}), shape: el.value } : null;
    if (s.mask && PATTERNS.has(el.value) && !PATTERNS.has(was)) s.mask.fit = "fill"; // 並べる形はレイヤーいっぱいに
    if (s.mask) st.secOpen.mk = true;
    return true;
  }
  if (k === "rules" || k === "mask.rules") { // 大きさを変える条件の 1 つの値
    if (el.value === "") return false;
    const tgt = k === "rules" ? s : s.mask || {};
    const rules = setRule(tgt.rules, Number(el.dataset.i), Number(el.dataset.f), el.value);
    if (k === "rules") s.rules = rules; else s.mask = { ...(s.mask || {}), rules };
    return true;
  }
  if (/^ol\.[wtblr]$/.test(k)) { // ふち取りの太さ: まとめて / 上下左右
    let n = Number(el.value);
    if (el.value === "" || Number.isNaN(n)) return false;
    n = r3(clamp(n / 100, 0, 0.2));
    const sd = outlineSides({ w: 0.01, ...(s.ol || {}) });
    if (b === "w") Object.assign(sd, { t: n, b: n, l: n, r: n }); else sd[b] = n;
    s.ol = { ...(s.ol || {}), ...sd };
    delete s.ol.w;
    return true;
  }
  if (k === "shape" && s.kind === "shape") { // 図形の形(パスにしたとき、まだ点が無ければ描き始める)
    s.shape = el.value;
    if (el.value === "path" && !s.pts?.length) setTimeout(() => startPathDraw(s.id), 0);
    return true;
  }
  if (k === "ol.on") {
    s.ol = el.checked ? { w: 0.01, blur: 0, color: "#ffffff", alpha: 1, ...(s.ol || {}), on: true } : s.ol ? { ...s.ol, on: false } : null;
    if (el.checked) st.secOpen.ol = true;
    return true;
  }
  if (k === "loop.pin" || k === "loop.dir") { s.loop = { ...(s.loop || {}), [b]: el.value || undefined }; return true; }
  if (b === "type" && (a === "tin" || a === "tout")) {
    s[a] = el.value ? { dur: 0.5, flipH: false, flipV: false, rev: false, ...(s[a] || {}), type: el.value } : null;
    if (el.value) st.secOpen.tr = true;
    return true;
  }
  const put = (v) => { if (b) s[a] = { ...(s[a] || {}), [b]: v }; else s[a] = v; };
  if (el.type === "checkbox") { put(el.checked); return true; }
  if (el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.type === "color") { put(el.value); return true; }
  let n = Number(el.value);
  if (el.value === "" || Number.isNaN(n)) return false;
  if (PCT.has(k)) n /= 100;
  if (FRANGE[k]) n = clamp(n, ...FRANGE[k]);
  n = r3(n);
  if (type !== "au" && ANIM_ALL.has(k) && AKEYS[kindKey(type, s)].includes(k)) {
    const vals = { [k]: n };
    if ((k === "w" || k === "h") && s.aspect && s.keepAspect !== false) {
      const [W, H] = P().size;
      if (k === "w") vals.h = r3(clamp((n * W) / s.aspect / H, 0.01, 4)); else vals.w = r3(clamp((n * H * s.aspect) / W, 0.01, 4));
    }
    setAnim(type, s, vals);
    return true;
  }
  if (type === "clip") {
    if (k === "in") s.in = r3(clamp(n, 0, s.out - MIN_LEN));
    else if (k === "out") s.out = r3(clamp(n, s.in + MIN_LEN, s.dur));
    else put(n);
    return true;
  }
  if (type === "au") {
    if (k === "volume" && s.vkf?.length) { setVolKey(s, n); return true; } // キーフレームがあれば、再生位置のキーフレームに入れる
    if (k === "start") s.start = r3(Math.max(0, n));
    else if (k === "in") s.in = r3(clamp(n, 0, s.out - MIN_LEN * spd(s)));
    else if (k === "out") s.out = r3(clamp(n, s.in + MIN_LEN * spd(s), s.dur || n));
    else put(n);
    return true;
  }
  if (k === "start") s.start = r3(clamp(n, 0, s.end - MIN_LEN));
  else if (k === "end") s.end = r3(Math.max(s.start + MIN_LEN, n));
  else if (k === "in") s.in = r3(clamp(n, 0, Math.max(0, (s.dur || 0) - MIN_LEN)));
  else if (k === "speed" && s.kind === "video") {
    // 速さを変えても、元の動画の同じ所を使う(遅くすると長く・速くすると短く。つなげる動画・音声と同じ)
    const src = (s.end - s.start) * spd(s);
    s.speed = n;
    s.end = r3(s.start + Math.max(MIN_LEN, src / spd(s)));
  } else put(n);
  // 重ねる動画: 速さ・始めを変えたら、元の動画の終わりを超えないように
  if (s.kind === "video" && (k === "speed" || k === "in") && s.dur) {
    const maxLen = (s.dur - (s.in || 0)) / spd(s);
    if (s.end - s.start > maxLen) s.end = r3(s.start + Math.max(MIN_LEN, maxLen));
  }
  return true;
}
function onInspectorInput(e) {
  const el = e.target;
  if (el.dataset.c === "tpl") { applyTemplate(el.value); return; }
  const k = el.dataset.k;
  const s = findSel();
  if (!k || !s) return;
  const type = st.sel.type;
  const before = snapshot();
  if (!applyField(s, type, k, el)) return;
  commit(before);
  if (type === "clip") st.cur = -1;
  // 選ぶもの(効果・方法)を変えたら欄が増減するので作り直す
  const rebuild = (el.tagName === "SELECT" && (k === "key.mode" || k === "edge.mode" || k === "mosaic" || k === "shape" || k === "alt" || k === "mask.alt" || /\.type$/.test(k) || k === "mask.shape" || k === "mask.spin" || k === "mask.pulse")) || k === "ol.on";
  if (rebuild) delete $('[data-c="insp"]').dataset.for;
  refresh(!rebuild);
  if (!rebuild) syncKfList(s, type);
  if (type === "clip") seek(st.t);
}
// キーフレーム: 再生位置で記録・消す・移る
function kfAction(a, s, i) {
  const type = st.sel.type;
  const s0 = selStart(s, type), len = selLen(s, type);
  if (a === "kfgo") { const k = s.kf?.[i]; if (k) seek(s0 + k.t); return; }
  if (a === "kfadd") {
    if (st.t < s0 - 1e-6 || st.t > s0 + len + 1e-6) { ctx.notify("再生位置が選んだものの外です。タイムラインで中に移ってから記録してください", "error"); return; }
    const tl = r3(clamp(st.t - s0, 0, len));
    change(() => {
      const cur = curAnim(s, type);
      s.kf = (s.kf || []).filter((k) => Math.abs(k.t - tl) >= 0.03);
      s.kf.push({ t: tl, ...cur });
      s.kf.sort((x, y) => x.t - y.t);
    });
    st.secOpen.kf = true;
    return;
  }
  if (a === "kfdel") {
    change(() => {
      const k = s.kf.splice(i, 1)[0];
      // 最後の 1 つを消したら、その値をそのまま残す(レイヤーが飛ばないように)
      if (!s.kf.length && k) for (const x of AKEYS[kindKey(type, s)]) if (k[x] != null) s[x] = k[x];
    });
    return;
  }
  if (a === "kfclear") {
    if (!confirm(T("キーフレームをすべて消しますか? (今の再生位置の位置・大きさなどが残ります)"))) return;
    change(() => { Object.assign(s, curAnim(s, type)); s.kf = []; });
  }
}
// ---- 文字のテンプレート(おすすめ ★ 12 と保存したもの)
const STYLE_KEYS = ["font", "size", "color", "stroke", "strokeWidth", "strokeDx", "strokeDy", "strokeAlpha", "strokeBlur", "bg", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", "bgRadius"];
let stylesLoading = null;
function loadStyles(force = false) {
  if (stylesLoading && !force) return stylesLoading;
  stylesLoading = (async () => {
    try {
      const r = await api.fetchApi("/cca_generator/videoedit/styles", { cache: "no-store" });
      if (r.ok) st.styles = await r.json();
    } catch { /* 読めなくても文字は書ける */ }
    if (!st.styles) st.styles = { builtin: [], user: [], hidden: [] };
    if (ui?.classList.contains("open")) { delete $('[data-c="insp"]').dataset.for; renderInspector(); }
  })();
  return stylesLoading;
}
async function postStyles(body) {
  const r = await api.fetchApi("/cca_generator/videoedit/styles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${r.status}`);
  st.styles = { builtin: j.builtin, user: j.user, hidden: j.hidden };
}
function findTemplate(v) {
  const m = /^([bu]):(.*)$/.exec(v || "");
  if (!m || !st.styles) return null;
  const it = (m[1] === "b" ? st.styles.builtin : st.styles.user).find((x) => x.name === m[2]);
  return it ? { ...it, user: m[1] === "u" } : null;
}
function applyTemplate(v) {
  const s = findSel();
  st.tplSel = v || "";
  const it = findTemplate(v);
  if (!s || s.kind !== "text" || !it) { renderInspector(); return; }
  change(() => {
    const style = { ...it.style };
    // テンプレートに無いものはふつうの値に戻す(前のテンプレートの影や帯が残らないように)
    Object.assign(s, STYLE_RESET, style);
    if (style.size != null && s.kf?.length) for (const k of s.kf) k.size = style.size;
  });
  delete $('[data-c="insp"]').dataset.for;
  renderInspector();
  ctx.notify(T("テンプレート「{0}」を当てはめました", T(it.name)), "info");
}
async function templateAction(a, btn) {
  const s = findSel();
  try {
    if (a === "tplsave") {
      if (!s || s.kind !== "text") return;
      const name = (prompt("テンプレートの名前", "") || "").trim();
      if (!name) return;
      if (st.styles?.user.some((x) => x.name === name) && !confirm(T("「{0}」はもうあります。上書きしますか?", name))) return;
      const style = {};
      for (const k of STYLE_KEYS) if (s[k] != null && s[k] !== "") style[k] = s[k];
      await postStyles({ action: "save", name, style });
      st.tplSel = `u:${name}`;
      ctx.notify(T("テンプレート「{0}」を保存しました", name), "info", btn);
    } else if (a === "tpldel") {
      const it = findTemplate(st.tplSel);
      if (!it) return;
      if (it.user) {
        if (!confirm(T("テンプレート「{0}」を消しますか?", it.name))) return;
        await postStyles({ action: "delete", name: it.name });
      } else {
        if (!confirm(T("おすすめ「{0}」を一覧から隠しますか? (「おすすめを戻す」で戻せます)", T(it.name)))) return;
        await postStyles({ action: "hide", name: it.name });
      }
      st.tplSel = "";
    } else if (a === "tplunhide") {
      for (const n of [...(st.styles?.hidden || [])]) await postStyles({ action: "unhide", name: n });
    }
  } catch (e) {
    ctx.notify(`${T("テンプレートを変えられませんでした")}: ${e.message}`, "error", btn);
  }
  delete $('[data-c="insp"]').dataset.for;
  renderInspector();
}
// スポイト: プレビューを押した所の色を、抜く色にする
function eyedropAt(e) {
  const s = findSel();
  st.eyedrop = false;
  $('[data-c="stage"]').classList.remove("eyedrop");
  if (!s) return;
  let src = null, rect = null, nw = 0, nh = 0;
  if (st.sel.type === "clip") { src = vmain(); rect = src.getBoundingClientRect(); nw = src.videoWidth; nh = src.videoHeight; }
  else {
    const el = st.ovEls.get(s.id);
    src = el?.querySelector(s.kind === "image" ? "img" : "video");
    if (src) { rect = src.getBoundingClientRect(); nw = s.kind === "image" ? src.naturalWidth : src.videoWidth; nh = s.kind === "image" ? src.naturalHeight : src.videoHeight; }
  }
  if (!src || !nw || !rect?.width) { ctx.notify("色を取れませんでした", "error"); return; }
  const px = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * nw), 0, nw - 1), py = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * nh), 0, nh - 1);
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d");
  let d;
  try { g.drawImage(src, px, py, 1, 1, 0, 0, 1, 1); d = g.getImageData(0, 0, 1, 1).data; } catch { ctx.notify("色を取れませんでした", "error"); return; }
  const hex = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  change(() => { s.key = { ...(s.key || { mode: "chroma", tol: 0.3, soft: 0.1, despill: true }), color: hex }; });
  delete $('[data-c="insp"]').dataset.for;
  renderInspector();
}
function onInspectorAction(e) {
  const btn = e.target.closest("[data-a]");
  const a = btn?.dataset.a;
  const s = findSel();
  if (!a || !s) return;
  const type = st.sel.type;
  if (a === "crop") { if (st.cropMode) cancelCrop(); else startCropMode(s); return; }
  else if (a === "cropok") { applyCrop(); return; }
  else if (a === "cropno") { cancelCrop(); return; }
  else if (a === "uncrop") { change(() => { s.crop = null; if (type === "ov") cropAspect(s); }); st.cropMode = false; }
  else if (a === "here") change(() => { const d = s.end - s.start; s.start = r3(st.t); s.end = r3(st.t + d); });
  else if (a === "toend") change(() => { s.end = r3(Math.max(s.start + MIN_LEN, total())); });
  else if (a === "gfont") { openGoogleFonts(); return; }
  else if (a === "fontdir") { ctx.openPath?.(st.media.font_dir, btn); return; }
  else if (a === "fontre") { btn.disabled = true; loadFonts(true).finally(() => { btn.disabled = false; renderInspector(); }); return; }
  else if (a.startsWith("kf")) { kfAction(a, s, Number(btn.dataset.i)); delete $('[data-c="insp"]').dataset.for; }
  else if (a.startsWith("tpl")) { templateAction(a, btn); return; }
  else if (a === "resetpos") change(() => {
    if (st.sel?.type === "ov") {
      const [w, h] = s.kind === "video" ? fitWH(s.vw, s.vh, s.crop) : fitWH(s.aspect || 1, 1, null);
      Object.assign(s, { x: 0.5, y: 0.5, w, h, rot: 0, opacity: 1, kf: [] });
    } else Object.assign(s, { x: 0.5, y: 0.5, s: 1, rot: 0, opacity: 1, kf: [] });
  });
  else if (a === "fitcrop") change(() => { fitFirst(s); });
  else if (a === "redrawpath") startPathDraw(s.id);
  else if (a === "ruleadd" || a === "ruledel") { // 大きさを変える条件を足す / 消す
    const pre = btn.dataset.pre || "", i = Number(btn.dataset.i ?? -1);
    change(() => {
      const tgt = pre ? s.mask || {} : s;
      const rules = a === "ruleadd" ? addRule(tgt.rules) : (tgt.rules || []).filter((_, j) => j !== i);
      if (pre) s.mask = { ...(s.mask || {}), rules }; else s.rules = rules;
    });
    renderInspector();
  }
  else if (a === "vkadd") change(() => { setVolKey(s, volAt(s, st.t - audioView(s).start)); });
  else if (a === "vkdel") change(() => { s.vkf = (s.vkf || []).filter((_, i) => i !== Number(btn.dataset.i)); });
  else if (a === "vkclear") change(() => { s.volume = r3(volAt(s, st.t - audioView(s).start)); s.vkf = []; });
  else if (a === "vkgo") { const q = (s.vkf || [])[Number(btn.dataset.i)]; if (q) { if (st.playing) pause(); seek(audioView(s).start + q.t); } return; }
  else if (a === "selau") { const la = P().audios.find((x) => x.link === s.id); if (la) st.sel = { type: "au", id: la.id }; }
  else if (a === "selclip") { if (s.link != null) st.sel = P().overlays.some((o) => o.id === s.link) ? { type: "ov", id: s.link } : { type: "clip", id: s.link }; }
  else if (a === "unlink") change(() => { const v = audioView(s); Object.assign(s, { link: null, start: v.start, in: v.in, out: v.out, speed: v.speed }); });
  else if (a === "eyedrop") {
    st.eyedrop = !st.eyedrop;
    if (st.playing) pause();
    $('[data-c="stage"]').classList.toggle("eyedrop", st.eyedrop);
    btn.classList.toggle("on", st.eyedrop);
    if (st.eyedrop) ctx.notify("プレビューの抜きたい色の所を押してください", "info", btn);
    return;
  }
  if (type === "clip") st.cur = -1;
  delete $('[data-c="insp"]').dataset.for;
  refresh();
  if (type === "clip") seek(st.t);
}
// 切り取りの指定: その動画の所へ移る
function seekToSel() {
  if (st.sel?.type === "ov") {
    const o = findSel();
    if (o && !(st.t >= o.start && st.t < o.end)) seek(o.start); else placeMain();
    return;
  }
  if (st.sel?.type !== "clip") return;
  const i = P().clips.findIndex((c) => c.id === st.sel.id);
  const ss = starts();
  if (i >= 0 && !(st.t >= ss[i] && st.t < ss[i] + lenOf(P().clips[i]))) seek(ss[i]);
  else placeMain();
}

// ---------------------------------------------------------------- 表示を合わせる
function refresh(keepInspector = false) {
  const vids = P().overlays.filter((o) => o.kind === "video").sort((a, b) => a.start - b.start);
  const has = P().overlays.length > 0; // 動画が無くても、文字・画像だけ(透明な WebP・GIF など)を書き出せる
  $('[data-c="empty"]').style.display = has ? "none" : "";
  $('[data-c="name"]').textContent = has ? `${vids.length ? `${vids[0].name}${vids.length > 1 ? ` + ${vids.length - 1}` : ""}` : T("文字・画像だけ")}${st.dirty ? " *" : ""}` : "";
  $('[data-c="undo"]').disabled = !st.undo.length;
  $('[data-c="redo"]').disabled = !st.redo.length;
  const ex = $('[data-c="export"]');
  ex.disabled = !has || st.busy;
  ex.textContent = T("🎬 書き出す({0})", FMT_LABEL[P().format] || "MP4");
  $('[data-c="play"]').disabled = !(total() > 0);
  $('[data-c="split"]').disabled = !has && !(P().audios || []).length;
  $('[data-c="del"]').disabled = !st.sel;
  $('[data-c="dup"]').disabled = !st.sel;
  for (const k of ["format", "bg"]) { const el = $(`[data-p="${k}"]`); if (el !== document.activeElement) el.value = P()[k] || (k === "bg" ? "black" : "mp4"); }
  renderExportOpts();
  const [W, H] = P().size;
  for (const [k, v] of [["w", W], ["h", H], ["fps", P().fps]]) { const el = $(`[data-p="${k}"]`); if (el !== document.activeElement) el.value = v; }
  $('[data-c="info"]').textContent = has || (P().audios || []).length ? T("長さ {0} 秒・レイヤー {1} 個(動画 {2} 本)・段 {3}・音声 {4} 個", total().toFixed(2), P().overlays.length, vids.length, rowCount(), (P().audios || []).length) : "";
  renderFontGuide();
  renderTimeline();
  if (!keepInspector || !$('[data-c="insp"]').contains(document.activeElement)) renderInspector();
  placeMain();
  renderOverlays();
}

// ---------------------------------------------------------------- フォント(文字ごとに選ぶ・Google Fonts から入れる)
let fontsLoading = null;
// 画像編集からも同じフォントを使う(fontApi)。読み込めた・入れたときに知らせる
const fontListeners = new Set();
let fontCtx = null;
const fontNote = (...a) => (ctx || fontCtx)?.notify?.(...a);
const vopen = () => !!ui?.classList.contains("open");
function fontChanged(info) {
  if (vopen()) renderOverlays();
  for (const fn of fontListeners) { try { fn(info || {}); } catch { /* 知らせる先の失敗は無視 */ } }
}
// 読み込み中・読み込み済みならそれを使う(st.fonts は空にしない。空にすると読み込みを待つ描き直しが止まらなくなる)
function loadFonts(refresh = false) {
  if (fontsLoading && !refresh) return fontsLoading;
  fontsLoading = (async () => {
    try {
      const r = await api.fetchApi(`/cca_generator/videoedit/fonts${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      st.fonts = j.fonts || [];
      st.fontDefault = j.default || null;
    } catch (e) {
      st.fonts = st.fonts || [];
      fontNote(`フォントの一覧を読めませんでした: ${e.message}`, "error");
    }
    return st.fonts;
  })();
  return fontsLoading;
}
const fontLabel = (f) => `${f.family}${f.style && !/^(regular|normal|book|standard)$/i.test(f.style) ? ` ${f.style}` : ""}`;
function fontOptions(cur) {
  if (!st.fonts) {
    if (!st.fontWait) {
      st.fontWait = true;
      loadFonts().then(() => { st.fontWait = false; if (vopen() && findSel()?.kind === "text") { $('[data-c="insp"]').dataset.for = ""; renderInspector(); } fontChanged({ list: true }); });
    }
    return `<option value="${esc(cur || "")}">${esc(T("読み込み中…"))}</option>`;
  }
  const d = st.fontDefault;
  const opt = (f) => `<option value="${esc(f.key)}" ${f.key === cur ? "selected" : ""}>${esc(fontLabel(f))}</option>`;
  const grp = (label, list) => (list.length ? `<optgroup label="${esc(T(label))}">${list.map(opt).join("")}</optgroup>` : "");
  const fs = st.fonts;
  let h = `<option value="" ${cur ? "" : "selected"}>${esc(T("(標準)"))}${d ? ` ${esc(fontLabel(d))}` : ""}</option>`;
  if (cur && !fs.some((f) => f.key === cur)) h += `<option value="${esc(cur)}" selected>${esc(T("(見つかりません)"))} ${esc(cur.split(/[\\/]/).pop())}</option>`;
  h += grp("追加したフォント", fs.filter((f) => f.source !== "system"));
  h += grp("この PC のフォント(日本語が書ける)", fs.filter((f) => f.source === "system" && f.ja));
  h += grp("この PC のフォント(英数字など)", fs.filter((f) => f.source === "system" && !f.ja));
  return h;
}
// プレビューの文字に、書き出しと同じフォントを使う(.ttf・.otf はファイルを読み込む。.ttc は名前で指定)
function fontCss(key) {
  const f = key && st.fonts?.find((x) => x.key === key);
  if (!f) return { fontFamily: "", fontWeight: "", fontStyle: "" };
  if (!/\.ttc(#\d+)?$/i.test(f.key)) {
    let face = st.fontFaces.get(f.key);
    if (!face) {
      face = { name: `cca-vf-${st.fontFaces.size + 1}`, ok: false };
      st.fontFaces.set(f.key, face);
      const ff = new FontFace(face.name, `url(${api.apiURL(`/cca_generator/videoedit/font_file?key=${encodeURIComponent(f.key)}`)})`);
      ff.load().then((x) => { document.fonts.add(x); face.ok = true; fontChanged(); }).catch(() => { face.bad = true; fontChanged(); });
    }
    if (face.ok) return { fontFamily: `"${face.name}", sans-serif`, fontWeight: "normal", fontStyle: "normal" };
  }
  return { fontFamily: `"${f.family}", sans-serif`, fontWeight: String(f.weight || 400), fontStyle: f.italic ? "italic" : "normal" };
}
// Google Fonts から入れる(一覧はサーバーが fonts.google.com から読む。見本はブラウザが必要な文字だけ読む)
async function openGoogleFonts() {
  let m = document.getElementById("cca-gfont");
  if (!m) { m = document.createElement("div"); m.id = "cca-gfont"; document.body.appendChild(m); }
  m.innerHTML = `<div class="pb"><div class="ph2"><b>Google Fonts から追加</b><input data-f placeholder="絞り込み(名前)">
      <label class="row" style="font-size:13px"><input type="checkbox" data-ja checked> 日本語が書けるものだけ</label><button data-x>閉じる</button></div>
    <div class="note">Google Fonts(fonts.google.com)のフォントは、オープンなライセンス(OFL など)で、動画にも使えます。「入れる」を押すと、ふつうの太さと太字(あれば)をフォントのフォルダの google に入れて、選んでいる文字に使います。</div>
    <div class="ls" data-ls><div class="note" style="padding:8px">読み込み中…</div></div>
    <div class="ph2"><input data-name placeholder="一覧に無いときは名前を入力(例: Noto Sans JP)"><button data-byname>入れる</button></div></div>`;
  m.classList.add("open");
  const close = () => m.classList.remove("open");
  m.querySelector("[data-x]").onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  m.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  let fams = [];
  try {
    const r = await api.fetchApi("/cca_generator/videoedit/gfonts", { cache: "no-store" });
    const j = await r.json();
    fams = j.families || [];
    if (!j.ok) m.querySelector(".note").insertAdjacentHTML("afterend", `<div class="note" style="color:#ffd27a">${esc(T("Google Fonts の一覧を読めなかったので、主なフォントだけを出しています。"))}</div>`);
  } catch { fams = []; }
  const ls = m.querySelector("[data-ls]");
  const have = new Set((st.fonts || []).filter((f) => f.source === "google").map((f) => f.family));
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      const row = en.target;
      io.unobserve(row);
      const fam = row.dataset.fam, sample = row.querySelector(".sm").textContent;
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}&text=${encodeURIComponent(sample)}&display=swap`;
      document.head.appendChild(l);
    }
  }, { root: ls });
  const fill = () => {
    const q = m.querySelector("[data-f]").value.trim().toLowerCase();
    const ja = m.querySelector("[data-ja]").checked;
    const items = fams.filter((f) => (!ja || f.ja) && (!q || f.family.toLowerCase().includes(q))).slice(0, 300);
    ls.innerHTML = items.length ? items.map((f) => `<div class="gf" data-fam="${esc(f.family)}"><span>${esc(f.family)}${f.ja ? ` <span class="tag">${esc(T("日本語"))}</span>` : ""}</span>
        <span class="sm" style="font-family:'${esc(f.family)}',sans-serif">${f.ja ? "あいうえお 永 Abc 123" : "Hello Abc 123"}</span>
        <span class="ok">${have.has(f.family) ? esc(T("入っています")) : ""}</span><button data-dl>入れる</button></div>`).join("")
      : `<div class="note" style="padding:8px">${esc(T("一致するものがありません"))}</div>`;
    for (const row of ls.querySelectorAll(".gf")) io.observe(row);
  };
  m.querySelector("[data-f]").oninput = fill;
  m.querySelector("[data-ja]").onchange = fill;
  fill();
  const install = async (fam, btn) => {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = T("入れています…");
    try {
      const r = await api.fetchApi("/cca_generator/videoedit/gfont", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family: fam }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `${r.status}`);
      await loadFonts(true);
      await loadMedia(); // 日本語のフォントが無かったときは、これが標準になる
      // 選んでいる文字に使う(太字があれば太字)
      const got = j.fonts || [];
      const pickF = got.find((f) => f.weight === 700) || got[0];
      if (vopen()) {
        const s = findSel();
        if (pickF && s?.kind === "text") change(() => { s.font = pickF.key; });
        $('[data-c="insp"]').dataset.for = "";
        renderInspector();
        renderOverlays();
      }
      fontChanged({ installed: pickF });
      close();
      fontNote(T("「{0}」を入れました", fam), "info");
    } catch (e) {
      fontNote(`フォントを入れられませんでした: ${e.message}`, "error", btn);
    } finally { btn.disabled = false; btn.textContent = old; }
  };
  ls.onclick = (e) => { const b = e.target.closest("[data-dl]"); if (b) install(b.closest(".gf").dataset.fam, b); };
  m.querySelector("[data-byname]").onclick = (e) => { const v = m.querySelector("[data-name]").value.trim(); if (v) install(v, e.currentTarget); };
  m.querySelector("[data-f]").focus();
}

// 文字を重ねるのに日本語のフォントが無いときの案内(生成パネルの「見つかりません」と同じ箱)
const FONT_LINKS = [
  { kind: "source", label: "Noto Sans JP(Google Fonts)", url: "https://fonts.google.com/noto/specimen/Noto+Sans+JP" },
  { kind: "search", label: "Google", url: `https://www.google.com/search?q=${encodeURIComponent("日本語 フォント ttf 無料")}` },
];
function renderFontGuide() {
  const fw = $('[data-c="fontwarn"]');
  const needFont = P().overlays.some((o) => o.kind === "text" && !o.font);
  fw.hidden = !needFont || !!st.media.font;
  if (fw.hidden) { fw._key = null; return; }
  if (fw._key === st.media.font_dir) return; // 開いた・閉じたをそのままにする
  fw._key = st.media.font_dir;
  const why = "字幕などの文字を書き出すのに使います。Windows(メイリオ・游ゴシック)や Mac(ヒラギノ)には最初から入っているので、見つからないときだけ入れてください。";
  if (!ctx.guideBox) {
    fw.className = "warn";
    fw.textContent = `日本語の文字を書けるフォントが見つかりませんでした。フォント(.ttf / .ttc / .otf)を ${st.media.font_dir} に入れてください。`;
    return;
  }
  fw.className = "";
  fw.innerHTML = `<div data-box></div><div class="row" style="margin-top:6px"><button data-c="fontgf">＋ Google Fonts から追加</button><button data-c="fontre">🔄 フォントを探し直す</button></div>`;
  fw.querySelector('[data-c="fontgf"]').onclick = () => openGoogleFonts();
  ctx.guideBox(fw.querySelector("[data-box]"), {
    label: "日本語の文字を書けるフォント", why, links: FONT_LINKS, open: true,
    folderLabel: "フォント(.ttf / .ttc / .otf)", folders: st.media.font_dir ? [{ path: st.media.font_dir }] : [],
    hint: "入れたら、下の「🔄 フォントを探し直す」を押してください。",
  });
  fw.querySelector('[data-c="fontre"]').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    await loadMedia();
    b.disabled = false;
    if (st.media.font) { fw._key = null; loadFonts(true).then(() => refresh()); ctx.notify(`フォントが見つかりました: ${st.media.font}`, "info"); refresh(); }
    else ctx.notify("まだ見つかりません。フォントのファイルを入れた場所を確かめてください。", "error", b);
  };
}

// ---------------------------------------------------------------- 選ぶ(動画・画像)
async function loadMedia() {
  try {
    const r = await api.fetchApi("/cca_generator/videoedit/media", { cache: "no-store" });
    if (r.ok) st.media = await r.json();
  } catch { /* 一覧が取れなくてもアップロードはできる */ }
}
function pick(kind) {
  return new Promise((resolve) => {
    let m = document.getElementById("cca-vpick");
    if (!m) {
      m = document.createElement("div");
      m.id = "cca-vpick";
      document.body.appendChild(m);
    }
    const listOf = () => (kind === "image" ? st.media.images : kind === "audio" ? [...(st.media.audios || []), ...st.media.videos] : st.media.videos);
    let list = listOf();
    m.innerHTML = `<div class="pb"><div class="ph2"><b>${kind === "image" ? "画像を選ぶ" : kind === "audio" ? "音声を選ぶ(音声ファイル・音のある動画)" : "動画を選ぶ"}</b>
      <input data-f placeholder="絞り込み(文字を入力)"><button data-rf title="保存先(output)と input のファイルの一覧を読み直して、最新にします">更新</button><button data-up>挿入</button><button data-x>閉じる</button></div>
      <div class="ls" data-ls></div></div>`;
    const ls = m.querySelector("[data-ls]");
    const fill = (q) => {
      const items = list.filter((v) => !q || v.toLowerCase().includes(q.toLowerCase()));
      ls.innerHTML = items.length ? items.map((v) => `<div class="it" data-v="${esc(v)}">${esc(v)}</div>`).join("")
        : `<div class="note" style="padding:8px">一致するものがありません</div>`;
    };
    fill("");
    const done = (v) => { m.classList.remove("open"); resolve(v); };
    m.querySelector("[data-f]").oninput = (e) => fill(e.target.value);
    m.querySelector("[data-x]").onclick = () => done(null);
    m.querySelector("[data-rf]").onclick = async (e) => { // 最新の一覧に
      const b = e.currentTarget;
      b.disabled = true;
      try { await loadMedia(); list = listOf(); fill(m.querySelector("[data-f]").value); } finally { b.disabled = false; }
    };
    m.onclick = (e) => { if (e.target === m) done(null); const it = e.target.closest(".it"); if (it) done(it.dataset.v); };
    m.querySelector("[data-up]").onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = kind === "image" ? "image/*" : kind === "audio" ? "audio/*,video/*" : "video/*";
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try { const v = await ctx.upload(f); await loadMedia(); done(v); }
        catch (err) { ctx.notify(`挿入できませんでした: ${err.message}`, "error"); }
      };
      input.click();
    };
    m.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") done(null); });
    m.classList.add("open");
    m.querySelector("[data-f]").focus();
  });
}

// ---------------------------------------------------------------- 書き出し
function projectJson() {
  const p = P();
  const ex = p.export || {};
  const pre = ctx?.outPrefix?.();
  return JSON.stringify({
    size: p.size, fps: p.fps, bg: p.bg || "black", format: p.format || "mp4",
    out_prefix: pre ?? undefined, // 生成パネルの「動画の保存先」のフォルダに書き出す
    export: { fps: Number(ex.fps) || 0, loop: Number(ex.loop) || 0, quality: Number(ex.quality) || 85, lossless: !!ex.lossless },
    clips: p.clips.map((c) => ({ src: c.src, in: c.in, out: c.out, crop: c.crop, speed: spd(c), x: c.x, y: c.y, s: c.s, rot: c.rot, opacity: c.opacity,
      kf: c.kf?.length ? c.kf : undefined, kfEase: c.kfEase, tin: c.tin || undefined, tout: c.tout || undefined, key: c.key || undefined, loop: c.loop?.type ? c.loop : undefined,
      edge: c.edge?.mode ? c.edge : undefined })),
    overlays: orderedOverlays().map(({ id, name, aspect, dur, fps, vw, vh, hasAudio, keepAspect, wm, ...o }) => {
      const out = { ...o, kf: o.kf?.length ? o.kf : undefined, loop: o.loop?.type ? o.loop : undefined };
      // 折り返しは、画面で折り返したとおりの行を渡す(見たとおりに書き出す)
      const fil = o.kind === "text" && Number(o.wrap) > 0 ? st.ovEls.get(id)?.querySelector(".tfil") : null;
      if (fil) out.wrapped = textLinesOf(o, fil, frameRect()).join("\n");
      return out;
    }),
    // 音声の段(つながっている音声は、動画の今の置く所・使う所・速さで)
    audios: (p.audios || []).map((a) => {
      const v = audioView(a);
      return { src: a.src, start: r3(v.start), in: r3(v.in), out: r3(v.out), speed: v.speed, volume: a.volume ?? 1, mute: !!a.mute,
        keepPitch: a.keepPitch !== false, fadeIn: a.fadeIn || 0, fadeOut: a.fadeOut || 0, vkf: a.vkf?.length ? a.vkf : undefined, vkEase: a.vkEase || undefined };
    }),
  });
}
const FMT_LABEL = { mp4: "MP4", webm: "WebM", webp: "WebP", gif: "GIF" };
// 形式ごとの設定(画質・ロスレス・ループ・書き出す fps)と注意書き
function renderExportOpts() {
  const p = P(), f = p.format || "mp4", ex = p.export || {};
  const box = $('[data-c="expopts"]');
  const sig = f;
  if (box.dataset.sig !== sig || !box.contains(document.activeElement)) {
    let h = "";
    if (f === "webp") h += `<label class="fl">画質(1〜100)<input type="number" data-e="quality" min="1" max="100" step="1" value="${ex.quality ?? 85}"></label>
      <label class="ck"><input type="checkbox" data-e="lossless" ${ex.lossless ? "checked" : ""}><span>ロスレス(劣化なし・ファイルが大きい)</span></label>`;
    if (f === "webp" || f === "gif") h += `<label class="fl">ループ回数<input type="number" data-e="loop" min="0" max="1000" step="1" value="${ex.loop ?? 0}" title="0 = ずっと繰り返す"></label>`;
    h += `<label class="fl">書き出す fps<input type="number" data-e="fps" min="0" max="120" step="1" value="${ex.fps || 0}" title="0 = 上の fps と同じ"></label>`;
    box.innerHTML = h;
    box.dataset.sig = sig;
  }
  const notes = [];
  if (f === "mp4" && p.bg === "transparent") notes.push("MP4 は透明にできないので、背景は黒になります。透明にするなら WebM・WebP・GIF を選んでください。");
  if (f === "webp" || f === "gif") notes.push("WebP・GIF には音が入りません。");
  if (f === "gif") notes.push("GIF は 256 色で、半透明は透明か不透明のどちらかになります。書き出す fps を 10〜15 にすると軽くなります(50 まで)。");
  if (f === "webm" && p.bg === "transparent") notes.push("透明な WebM は、対応したソフト(ブラウザ・動画編集ソフトなど)で透けて見えます。");
  if (f !== "mp4" && p.bg !== "transparent") notes.push("背景を「透明」にすると、動画を小さくした所や、背景を透明にした所が透けます。");
  $('[data-c="fmtnote"]').innerHTML = notes.map((n) => esc(T(n))).join("<br>");
}
// 透かし: 登録した画像を、最初から最後まで、いちばん手前に重ねる
async function openWatermarkVideo(btn) {
  if (st.busy) return;
  pause();
  const base = orderedOverlays().filter((o) => o.kind === "video" && st.t >= o.start && st.t < o.end).map((o) => st.ovEls.get(o.id)?.querySelector("video")).find((v) => v?.readyState >= 2) || null;
  await openWatermark({
    size: P().size, base, notify: (m, k, el) => ctx.notify(m, k, el || btn),
    onApply: async ({ item, rect, natural }) => {
      const [W, H] = P().size;
      const D = total() || 3;
      const o = { id: uid++, kind: "image", src: item.value, name: `💧 ${item.name}`, start: 0, end: r3(D), opacity: r3(rect.opacity), rot: 0,
        x: r3((rect.x + rect.w / 2) / W), y: r3((rect.y + rect.h / 2) / H), w: r3(rect.w / W), h: r3(rect.h / H), aspect: natural[0] / natural[1], wm: true };
      change(() => { P().overlays.push(o); st.sel = { type: "ov", id: o.id }; });
      ctx.notify("透かしを入れました(最初から最後まで・いちばん手前)。位置や大きさはプレビューや右の欄で直せます", "info", btn);
    },
  });
}
let exportId = null;
async function exportVideo(btn) {
  if ((!P().clips.length && !P().overlays.length) || st.busy) return;
  pause();
  st.busy = true;
  const busy = $('[data-c="busy"]');
  busy.classList.add("on");
  $('[data-c="busytext"]').textContent = "書き出しています…";
  $('[data-c="busybar"]').style.width = "0";
  refresh();
  try {
    const r = await api.fetchApi("/prompt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: { 1: { class_type: "CCAVideoEdit", inputs: { project: projectJson() } } }, client_id: api.clientId ?? api.initialClientId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message || `${r.status}`);
    exportId = j.prompt_id;
    ctx.ignore?.(j.prompt_id);
    let h = null;
    for (;;) {
      await new Promise((res) => setTimeout(res, 700));
      const hr = await (await api.fetchApi(`/history/${encodeURIComponent(j.prompt_id)}`)).json();
      h = hr?.[j.prompt_id];
      if (!h) continue;
      const err = (h.status?.messages || []).find((m) => m[0] === "execution_error" || m[0] === "execution_interrupted");
      if (err) throw new Error(err[0] === "execution_interrupted" ? T("中止しました") : (err[1]?.exception_message || "処理に失敗しました"));
      if (h.status?.completed || h.status?.status_str === "success") break;
    }
    const info = h.outputs?.["1"]?.cca_video?.[0];
    if (!info) throw new Error("結果の動画が返ってきませんでした");
    if (!info.format) info.format = P().format || "mp4";
    st.dirty = false;
    histSave(true); // 書き出した編集も、あとで直せるように残す
    ctx.onSaved?.(info);
    ctx.notify(`書き出しました: ${info.path}`, "info", btn, { sticky: true, file: { filename: info.filename, subfolder: info.subfolder || "", type: info.type || "output" } });
  } catch (e) {
    ctx.notify(`書き出せませんでした: ${e.message}`, "error", btn);
  } finally {
    exportId = null;
    st.busy = false;
    busy.classList.remove("on");
    refresh();
  }
}
function onProgress(e) {
  const d = e.detail || {};
  if (!exportId || d.prompt_id !== exportId || !ui) return;
  const p = d.max ? d.value / d.max : 0;
  $('[data-c="busybar"]').style.width = `${Math.round(p * 100)}%`;
  $('[data-c="busytext"]').textContent = `書き出しています… ${d.value} / ${d.max} コマ(${Math.round(p * 100)}%)`;
}

// ---------------------------------------------------------------- 操作
// 右の欄などに入ったままタイムラインを触ったら、欄から離れる(Ctrl+C / V などがタイムラインのレイヤーに効くように)
function leaveField() {
  const a = document.activeElement;
  if (a && a !== ui && ui.contains(a)) a.blur();
  ui.focus({ preventScroll: true });
}
function bind() {
  api.addEventListener("progress", onProgress);
  $('[data-c="close"]').onclick = () => close();
  $('[data-c="undo"]').onclick = () => undo();
  $('[data-c="redo"]').onclick = () => redo();
  $('[data-c="export"]').onclick = (e) => exportVideo(e.currentTarget);
  $('[data-c="hsave"]').onclick = (e) => histSave(false, e.currentTarget);
  $('[data-c="hist"]').onclick = () => histList();
  $('[data-c="cancel"]').onclick = () => api.fetchApi("/interrupt", { method: "POST" });
  $('[data-c="play"]').onclick = () => (st.playing ? pause() : play());
  const guard = (fn) => async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { ctx.notify(err.message, "error", b); } finally { b.disabled = false; refresh(); } };
  $('[data-c="add-text"]').onclick = guard(async () => { await addOverlay("text"); });
  $('[data-c="add-image"]').onclick = guard(async () => { const v = await pick("image"); if (v) await addOverlay("image", v); });
  $('[data-c="add-video"]').onclick = guard(async () => { const v = await pick("video"); if (!v) return; if (P().overlays.length) await addOverlay("video", v); else await addClip(v); });
  $('[data-c="tool-sel"]').onclick = () => toSelectTool();
  $('[data-c="tl"]').addEventListener("pointerdown", () => toSelectTool(), true); // パスの間にタイムラインを押すと選択に変わる
  $('[data-c="add-mosaic"]').onclick = guard(async () => { await addOverlay("mosaic"); });
  $('[data-c="add-shape"]').onclick = guard(async () => { await addOverlay("shape"); });
  $('[data-c="add-path"]').onclick = guard(async () => { startPathDraw(null); });
  bindPathCv();
  $('[data-c="add-audio"]').onclick = guard(async () => { const v = await pick("audio"); if (v) { const a = await addAudioItem(v); seek(a.start); } });
  $('[data-c="dup"]').onclick = () => duplicateSel();
  $('[data-c="wm"]').onclick = (e) => openWatermarkVideo(e.currentTarget);
  $('[data-c="split"]').onclick = () => splitSel();
  $('[data-c="del"]').onclick = () => deleteSel();
  $('[data-c="zoom"]').oninput = (e) => { st.pxs = Number(e.target.value); renderTimeline(); };
  $('[data-c="snap"]').onclick = (e) => {
    st.snap = !st.snap;
    e.currentTarget.classList.toggle("on", st.snap);
    try { localStorage.setItem("cca_generator.vedit.snap", st.snap ? "1" : "0"); } catch { /* 覚えられなくても使える */ }
  };
  try { st.snap = localStorage.getItem("cca_generator.vedit.snap") !== "0"; } catch { st.snap = true; }
  $('[data-c="stretch"]').onclick = (e) => {
    st.stretch = !st.stretch;
    e.currentTarget.classList.toggle("on", st.stretch);
    try { localStorage.setItem("cca_generator.vedit.stretch", st.stretch ? "1" : "0"); } catch { /* 覚えられなくても使える */ }
  };
  try { st.stretch = localStorage.getItem("cca_generator.vedit.stretch") === "1"; } catch { st.stretch = false; }
  $('[data-c="stretch"]').classList.toggle("on", st.stretch);
  $('[data-c="snap"]').classList.toggle("on", st.snap);
  $('[data-c="fitfirst"]').onclick = () => change(() => fitFirst());
  bindFrameHl($('[data-sec="export"]'), "cca_generator.vedit.frame", (v) => {
    st.fhl = v;
    // 強調表示: 書き出す範囲(.frame)の外側に線(中の絵には掛けない)
    $('[data-c="frame"]').style.boxShadow = v.on ? `0 0 0 ${v.w}px ${v.color}` : "";
    if (ui?.classList.contains("open") && P()) { placeMain(); renderOverlays(); }
  });
  // 右の項目と、選んだレイヤーの欄の中の項目: 折りたたみ(いつでも)・並べ替え(「⇅ 並べ替え」のときだけ)
  sideSplitter($(".main"), "vedit", $(".side")); // 右の欄の幅をドラッグで変える
  st.secs = { side: setupSections($(".side"), { name: "vedit" }), insp: setupSections($('[data-c="insp"]'), { name: "vedit.insp" }) };
  sectionEditBar($('[data-c="secbar"]'), [st.secs.side, st.secs.insp]);
  for (const k of ["w", "h", "fps"]) {
    $(`[data-p="${k}"]`).onchange = (e) => {
      const n = Number(e.target.value);
      if (!n) return;
      change(() => {
        if (k === "fps") P().fps = r3(clamp(n, 1, 120));
        else { const sz = [...P().size]; sz[k === "w" ? 0 : 1] = clamp(Math.round(n / 2) * 2, 16, 4096); setFrameSize(sz[0], sz[1]); }
      });
    };
  }
  for (const k of ["format", "bg"]) $(`[data-p="${k}"]`).onchange = (e) => change(() => { P()[k] = e.target.value; });
  const expo = $('[data-c="expopts"]');
  const onExp = (e) => {
    const el = e.target, k = el.dataset.e;
    if (!k) return;
    const v = el.type === "checkbox" ? el.checked : Number(el.value);
    if (el.type !== "checkbox" && (el.value === "" || Number.isNaN(v))) return;
    const b = snapshot();
    P().export = { ...(P().export || {}), [k]: el.type === "checkbox" ? v : clamp(v, Number(el.min), Number(el.max)) };
    commit(b);
    refresh(true);
  };
  expo.addEventListener("input", onExp);
  expo.addEventListener("change", (e) => { if (e.target.type === "checkbox") onExp(e); });
  const insp = $('[data-c="insp"]');
  insp.addEventListener("input", onInspectorInput);
  insp.addEventListener("change", (e) => { if (e.target.type === "checkbox") onInspectorInput(e); });
  insp.addEventListener("click", onInspectorAction);
  const ruler = $('[data-c="ruler"]');
  const seekAt = (e) => { const r = $('[data-c="tlin"]').getBoundingClientRect(); seek((e.clientX - r.left - GUT) / st.pxs); };
  ruler.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // ドラッグ中に文字が範囲選択されないように
    window.getSelection?.()?.removeAllRanges();
    leaveField();
    if (st.playing) pause();
    seekAt(e);
    const mv = (ev) => seekAt(ev);
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  });
  // ファイルのドラッグ&ドロップ。編集の画面のほかの所に落としても、ブラウザがファイルを開かないようにする
  for (const [zone, el] of [["stage", $('[data-c="stage"]')], ["tl", $('[data-c="tl"]')], ["other", ui]]) {
    el.addEventListener("dragover", (e) => onDragOver(zone, e));
    el.addEventListener("drop", (e) => onDrop(zone, e));
  }
  ui.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !ui.contains(e.relatedTarget)) clearDrop(); });
  $('[data-c="rows"]').addEventListener("pointerdown", (e) => {
    e.preventDefault(); // 段の上のドラッグでも文字を範囲選択しない
    window.getSelection?.()?.removeAllRanges();
    leaveField();
    if (e.target.closest(".blk")) startBlockDrag(e);
    else { st.sel = null; st.cropMode = false; refresh(); }
  });
  // スポイト中は、プレビューを押した所の色を取る(動かす・選ぶより先に)
  $('[data-c="stage"]').addEventListener("pointerdown", (e) => {
    if (!st.eyedrop) return;
    e.stopPropagation();
    e.preventDefault();
    eyedropAt(e);
  }, true);
  // プレビューの拡大・移動
  const stage = $('[data-c="stage"]');
  stage.addEventListener("wheel", (e) => {
    if (!P().overlays.length) return;
    e.preventDefault();
    setZoom(st.vz.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });
  stage.addEventListener("pointerdown", (e) => {
    // 中ボタンのドラッグ、または拡大しているときに画面の外側(灰色の所)をドラッグで動かす。Alt は「吸い付かない」に使うので使わない
    const onBg = e.button === 0 && st.vz.z > 1.001 && !e.target.closest('[data-c="frame"], .ov, .crop, .wbox, button, input, select');
    if (!(e.button === 1 || onBg)) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, p0 = { ...st.vz };
    stage.classList.add("panning");
    const move = (ev) => { st.vz.px = p0.px + ev.clientX - x0; st.vz.py = p0.py + ev.clientY - y0; placeMain(); renderOverlays(); };
    const up = () => { stage.classList.remove("panning"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, true);
  $('[data-c="zin"]').onclick = () => setZoom(st.vz.z * 1.25);
  $('[data-c="zout"]').onclick = () => setZoom(st.vz.z / 1.25);
  $('[data-c="zfit"]').onclick = () => setZoom(1);
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ov, .crop, .wbox")) return;
    if (st.sel?.type === "ov" || st.msel.length) { st.sel = null; st.msel = []; refresh(); }
  });
  window.addEventListener("keydown", (e) => {
    if (!ui?.classList.contains("open") || document.getElementById("cca-vpick")?.classList.contains("open") || watermarkKey(e) || historyKey(e)) return;
    e.stopPropagation();
    const t = e.target;
    const inField = t && ui.contains(t) && isField(t);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // パスを描いている間: Enter で閉じて完了・Backspace で最後の点を削除・Esc でやめる
    if (st.pathDraw && !inField && mod && (k === "z" || k === "y") && pathUndoRedoV(!(k === "z" && !e.shiftKey))) { e.preventDefault(); return; }
    if (st.pathDraw && !inField && ["Enter", "Escape", "Backspace", "Delete"].includes(e.key)) {
      e.preventDefault();
      const pd = st.pathDraw;
      if (e.key === "Enter") { if (pd.pts.length >= 3 && !pd.closed) { pathSnapV(); pd.closed = true; } }
      else if (e.key === "Escape") {
        if (pd.pts.length) { pathSnapV(); pd.pts = []; pd.closed = false; } // 点があればクリア、無ければやめる
        else endPathDraw();
      } else { pathSnapV(); pd.pts.pop(); if (!pd.pts.length) pd.closed = false; }
      renderPathCv();
      return;
    }
    if (e.key === "Escape") {
      if (st.cropMode) cancelCrop();
      else if (!inField && (st.sel || st.msel.length)) { st.sel = null; st.msel = []; refresh(); }
      else close();
      return;
    }
    // 一時保存(Ctrl+S。欄の中でも。ブラウザの「ページを保存」は出さない)
    if (mod && k === "s" && !e.shiftKey && !e.altKey) { e.preventDefault(); histSave(false, $('[data-c="hsave"]')); return; }
    // 元に戻す・やり直す(Ctrl+Z / Ctrl+Y / Shift+Ctrl+Z。⌘ も)。文字を打つ欄で打った分があれば、まずその欄の中を戻す。
    // 打っていない(または打った分を全部戻した)ときは、画面の「元に戻す」(数や選ぶ欄からも)
    const typed = inField && isTextField(t) && t.value !== (t._ccaStart ?? t.value);
    if (mod && (k === "z" || k === "y") && !typed) {
      e.preventDefault();
      if (inField) t.blur();
      if (k === "z" && !e.shiftKey) undo(); else redo();
      return;
    }
    if (inField) return;
    if (st.cropMode && e.key === "Enter") { e.preventDefault(); applyCrop(); return; }
    if (mod && k === "c") { if (copySel()) e.preventDefault(); }
    else if (mod && k === "x") { if (copySel(true)) e.preventDefault(); }
    else if (mod && k === "v") { if (pasteClip()) e.preventDefault(); }
    else if (e.key === " ") { e.preventDefault(); st.playing ? pause() : play(); }
    else if (st.pathDraw?.sel?.some((j) => st.pathDraw.pts[j]) && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && !mod) {
      e.preventDefault(); // パスの選んだ点を動かす
      pathSnapV();
      const n = e.shiftKey ? 10 : 1, dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
      for (const j of st.pathDraw.sel) { const q = st.pathDraw.pts[j]; if (q) { q.x += dx; q.y += dy; } }
      renderPathCv();
    }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && !mod) {
      e.preventDefault();
      const n = e.shiftKey ? 5 : 1;
      const dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
      if (selOvIds().length) nudgeOvs(dx, dy);
      else if (dx) { if (st.playing) pause(); seek(st.t + dx / (P().fps || 24)); }
    }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
    else if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); duplicateSel(); }
    else if (k === "s" && !e.ctrlKey && !e.metaKey) splitSel();
  }, true);
  window.addEventListener("keyup", (e) => { if (ui?.classList.contains("open")) e.stopPropagation(); }, true);
  // 文字を打つ欄に入ったときの中身(打っていなければ Ctrl+Z を画面の「元に戻す」に回す)
  ui.addEventListener("focusin", (e) => { if (isTextField(e.target)) e.target._ccaStart = e.target.value; });
  window.addEventListener("resize", () => { if (ui?.classList.contains("open")) { placeMain(); renderOverlays(); renderTimeline(); } });
  vmain().addEventListener("loadeddata", () => placeMain());
  vmain().addEventListener("loadedmetadata", () => { if (st.cur >= 0) syncMain(true); });
  vmain().addEventListener("seeked", () => { if (!st.playing) placeMain(); });
  $('[data-c="win"]').addEventListener("pointerdown", (e) => startClipDrag(e));
  $('[data-c="wbox"]').addEventListener("pointerdown", (e) => { if (e.target.dataset?.h) startClipDrag(e); });
}

// ---------------------------------------------------------------- 一時保存(💾・自動保存・🕘 履歴)
const histHas = () => P().clips.length > 0 || P().overlays.length > 0 || (P().audios || []).length > 0;
function histTitle() {
  const p = P();
  const vids = p.overlays.filter((o) => o.kind === "video").sort((a, b) => a.start - b.start);
  if (vids.length) return `${vids[0].name}${vids.length > 1 ? ` + ${vids.length - 1}` : ""}`;
  const o = p.overlays.find((x) => x.name) || p.overlays.find((x) => x.kind === "text");
  return o ? (o.name || String(o.text || "").split("\n")[0].slice(0, 40)) : "";
}
// 一覧に出す小さな絵: 今の時刻の画面(動画・画像・動画をレイヤーと、文字)
function histThumb() {
  const r = frameRect();
  const fr = $('[data-c="frame"]').getBoundingClientRect();
  const bg = P().bg || "black";
  return makeThumb(r.fw, r.fh, (g, w, h) => {
    if (bg !== "transparent") { g.fillStyle = bg === "white" ? "#fff" : "#000"; g.fillRect(0, 0, w, h); }
    g.scale(w / r.fw, h / r.fh);
    drawScene(g, $('[data-c="ovl"]').children.length);
    for (const el of $('[data-c="ovl"]').children) {
      if (el.dataset.kind !== "text" || el.style.display === "none") continue;
      const fil = el.querySelector(".tfil");
      const b = fil?.getBoundingClientRect();
      if (!b?.width) continue;
      const cs = getComputedStyle(fil);
      const fs = parseFloat(cs.fontSize) || 16;
      const lines = (fil.textContent || "").split("\n");
      g.save();
      g.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
      g.fillStyle = cs.color;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.globalAlpha = Number(el.style.opacity || 1);
      const cx = b.left + b.width / 2 - fr.left, top = b.top - fr.top, lh = b.height / Math.max(1, lines.length);
      lines.forEach((ln, i) => g.fillText(ln, cx, top + lh * (i + 0.5)));
      g.restore();
    }
  }, bg === "transparent");
}
// 保存する。auto: 自動保存(この作業の項目を上書き。変わっていなければ何もしない)
// 戻り値: 保存した項目 / null(保存するものが無い) / false(失敗)。保存は 1 つずつ順に行う
function histSave(auto = false, btn = null) {
  const run = async () => {
    if (!histHas()) { if (!auto) ctx.notify(T("まだ何も入っていません"), "info", btn); return null; }
    const snap = snapshot();
    if (auto && snap === st.hist.sig) return null;
    if (btn) btn.disabled = true;
    try {
      const p = P();
      const item = await saveEntry("video", {
        data: snap, auto, id: auto ? st.hist.sid : "", title: histTitle(),
        info: { size: p.size, dur: r3(total()), clips: p.overlays.filter((o) => o.kind === "video").length, overlays: p.overlays.length, audios: (p.audios || []).length },
        thumb: await histThumb(),
      });
      if (auto) st.hist.sid = item.id; // 名前を付けて残した項目は上書きしないので、新しい id になることがある
      st.hist.sig = snap;
      if (!auto) ctx.notify(T("一時保存しました({0})。🕘 履歴から開き直せます", fmtTime(item.updated)), "info", btn);
      return item;
    } catch (e) {
      if (!auto) ctx.notify(`${T("一時保存できませんでした")}: ${e.message}`, "error", btn);
      else console.warn("[CCA Generator] 自動保存できませんでした:", e);
      return false;
    } finally { if (btn) btn.disabled = false; }
  };
  const p = st.hist.q.then(run, run);
  st.hist.q = p.catch(() => null);
  return p;
}
function histTimer(on) {
  clearInterval(st.hist.timer);
  st.hist.timer = on ? setInterval(() => { if (ui?.classList.contains("open") && !st.busy && !st.drag) histSave(true); }, HIST_EVERY) : null;
}
async function histList() {
  pause();
  await openHistory({
    kind: "video", notify: (m, k, el) => ctx.notify(m, k, el), current: () => st.hist.sid,
    onOpen: (entry) => histOpen(entry),
  });
  ui.focus({ preventScroll: true });
}
// 一時保存した編集を開く(今の作業は、変わっていれば先に自動保存する)
async function histOpen(entry) {
  const p = entry?.data;
  if (!p || !Array.isArray(p.overlays)) throw new Error(T("一時保存の中身を読めませんでした"));
  if (entry.id !== st.hist.sid && (await histSave(true)) === false && !confirm("今の編集を自動保存できませんでした。それでも開きますか?")) return false;
  pause();
  p.audios = Array.isArray(p.audios) ? p.audios : [];
  p.bg = p.bg || "black";
  p.format = p.format || "mp4";
  p.export = { fps: 0, loop: 0, quality: 85, lossless: false, ...(p.export || {}) };
  p.size = Array.isArray(p.size) ? p.size : [1280, 720];
  p.fps = Number(p.fps) || 24;
  migrateProject(p); // 前の版の形(つなげる動画)は、いちばん下の段のレイヤーに直す
  // 前の作業の id と重ならないように、これから付ける番号を進める
  for (const x of [...p.clips, ...p.overlays, ...p.audios]) if (Number(x.id) >= uid) uid = Number(x.id) + 1;
  for (const el of st.ovEls.values()) el.remove();
  st.ovEls.clear();
  for (const el of st.auEls.values()) el.pause();
  st.auEls.clear();
  const v = vmain();
  v.removeAttribute("src"); v.dataset.src = ""; v.load();
  st.proj = p;
  st.sel = null; st.t = 0; st.undo = []; st.redo = []; st.dirty = false; st.cropMode = false; st.cur = -1;
  afterLoad();
  // 開いた編集は、変えたら新しい自動保存になる(開いた項目は残る)
  st.hist.sid = newSid();
  st.hist.sig = snapshot();
  const miss = entry.missing || [];
  if (miss.length) ctx.notify(T("見つからないファイルがあります(消したか、名前や場所を変えた可能性があります): {0}", miss.map(nameOf).join(", ")), "error");
  else ctx.notify(T("「{0}」を開きました", entry.name || entry.title || fmtTime(entry.updated)), "info");
  return true;
}

async function close(force = false) {
  if (!ui?.classList.contains("open")) return;
  if (st.busy) return;
  let keep = true;
  if (!force && st.dirty) {
    const a = await askClose(T("書き出していない変更があります。どうしますか?"), T);
    if (a === "back") return;
    keep = a === "keep";
  }
  // 一時保存: 🕘 履歴に残す(変わっていたときだけ。保存できなかったら確かめる)
  const saved = keep ? await histSave(true) : null;
  if (!force && keep && saved === false && !confirm("一時保存できませんでした。それでも閉じますか?")) return;
  if (saved) ctx.notify(T("編集の内容を一時保存しました(🕘 履歴から開き直せます)"), "info");
  pause();
  histTimer(false);
  ui.classList.remove("open");
}

// opts: { value(開く動画。空なら何もない状態), upload(file) → value, notify, onSaved(info), ignore(promptId) }
export async function openVideoEditor(opts) {
  ctx = opts;
  if (!ui) build();
  if (ui.classList.contains("open")) {
    if (st.dirty && !confirm("書き出していない変更があります。別の動画を開きますか? (今の内容は 🕘 履歴に自動保存されます)")) return;
    if ((await histSave(true)) === false && !confirm("自動保存できませんでした。それでも続けますか?")) return;
  }
  pause();
  ui.classList.add("open");
  ui.focus();
  st.proj = { v: 26, size: [1280, 720], fps: 24, bg: "black", format: "mp4", export: { fps: 0, loop: 0, quality: 85, lossless: false }, clips: [], overlays: [], audios: [] };
  st.sel = null; st.t = 0; st.undo = []; st.redo = []; st.dirty = false; st.cropMode = false; st.cur = -1;
  for (const el of st.ovEls.values()) el.remove();
  st.ovEls.clear();
  const v = vmain();
  v.removeAttribute("src"); v.dataset.src = ""; v.load();
  await loadMedia();
  refresh();
  if (opts.value) {
    try { await addClip(opts.value); st.undo = []; st.dirty = false; refresh(); }
    catch (e) { ctx.notify(`動画を開けませんでした: ${e.message}`, "error"); }
  }
  // 新しい作業として自動保存する(開いただけでは保存しない)
  st.hist.sid = newSid();
  st.hist.sig = snapshot();
  histTimer(true);
}
// 画像編集から使うフォント(一覧・選ぶ欄・プレビュー用の CSS・Google Fonts)
export const fontApi = {
  use: (c) => { fontCtx = c; },
  load: (refresh = false) => loadFonts(refresh),
  options: (cur) => fontOptions(cur),
  css: (key) => fontCss(key),
  google: () => openGoogleFonts(),
  onChange: (fn) => { fontListeners.add(fn); return () => fontListeners.delete(fn); },
  fontDir: async () => { if (!st.media.font_dir) await loadMedia(); return st.media.font_dir; },
  defaultKey: () => st.fontDefault?.key || "",
};
// テスト用
window.CCA_VEDIT = { state: st, seek: (t) => seek(t), total: () => total(), refresh: () => refresh(), GUT, histSave: (auto) => histSave(auto), snapshot: () => snapshot(), migrate: (p) => migrateProject(p) };
