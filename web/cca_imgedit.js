// CCA Generator: 画像編集(第24版から、画像・文字をすべて「レイヤー」として並べる)
// - キャンバス(書き出す大きさ)の上に、開いた画像・置いた画像・文字を重ねる。どれもバウンディングボックスで動かす・大きさ・回転、
//   重ねる順(前へ・後ろへ)・不透明度・見せる / 隠す。消しゴム・背景を消す・オブジェクト除去などは「作業する画像」(選んだ画像)に掛かる
// - 画像: input フォルダの画像から選ぶ / アップロード / ドラッグ&ドロップ / Ctrl+V。生成結果は「この画像を編集する」で開く
// - 背景を透明にする: 自動(ComfyUI 本体の BiRefNet)+ しきい値・縮める/広げる・縁のぼかし(数値)/ 色で抜く(似た色の幅)
//   / 消しゴム・戻すブラシ(手で直す)
// - オブジェクト除去: 塗った所を FLUX.2 Klein 4B + オブジェクト除去 LoRA で消す(サーバーの CCAObjectRemove。四角の外は元のまま)
// - 透かし: 登録した画像(ロゴなど)を右下・左下・右上・左上・真ん中に、大きさ・余白・不透明度を決めて入れる(cca_watermark.js)
// - 文字: 動画編集と同じ項目(フォント・縁のずれ・背景の丸み・折り返し・テンプレート)。バウンディングボックスで動かし、「画像に描き込む」で確定
//   (保存・ダウンロードのときも描き込む)
// - 元に戻す / やり直す、保存(生成パネルの「画像の保存先」のフォルダに「元の名前_edit.png」)/ ダウンロード / 入力画像1に使う
// - 一時保存(📌・Ctrl+S)と自動保存(数分ごと・閉じるとき・別の画像を開くとき)。🕘 履歴から開き直す(cca_history.js)
// 生成パネル(cca_ui.js)から openImageEditor() で開く。
import { api } from "../../scripts/api.js";
import { T, confirm, prompt } from "./cca_i18n.js";
import { openWatermark, watermarkKey } from "./cca_watermark.js";
import { frameHlHtml, frameHlCss, bindFrameHl, frameHlPad } from "./cca_framehl.js";
import { rulesHtml, setRule, addRule, SHAPES, shapePath as cutShapePath, PATTERNS, PAT_DEF, PAT_KEYS, featherBase, outlineCanvas, outlineSides, nearPathLine, askClose, sideSplitter } from "./cca_shapes.js"; // 図形ツールの shapePath と分ける
import { setupSections, sectionEditBar, SECTIONS_CSS, cardCss } from "./cca_sections.js";
import { saveEntry, openHistory, historyKey, makeThumb, newSid, fmtTime, fileUrl, HIST_EVERY } from "./cca_history.js";
import { fontApi } from "./cca_videoedit.js";
import { textLayout, drawTextAt, textSectionsHtml, applyTextField, setTextField, sectionCss, bboxHtml, bboxCss, bboxDrag, num as tnum, sec as tsec, STYLE_RESET, STYLE_KEYS,
  clipboard, pickText, isField, isTextField, snapLines, snapMove, snapResize, showSnapGuides, rotatedBounds, lineX, enhanceNotes } from "./cca_text.js";

const MAX_UNDO = 30;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// オブジェクト除去: FLUX.2 Klein 4B(LoRA は 4B Base で学習)と、fal のオブジェクト除去 LoRA
const RM = {
  unet: { re: /klein.*4b|4b.*klein/i, not: /9b/i, prefer: /base/i, rec: "flux-2-klein-base-4b-fp8.safetensors", kind: "diffusion_models" },
  // 同じ配布ページの flux-object-remove-lora.safetensors は配布元で途中までしか入っていないので、ComfyUI 用に変換した方を先にする
  lora: { re: /object[-_ ]?remov|kdekt5q7/i, prefer: /kdekt5q7|comfy[-_]?converted/i, rec: "kDEkt5q7tDLKOpQJIVMPx_pytorch_lora_weights_comfy_converted.safetensors", kind: "loras" },
  clip: { re: /qwen_?3_?4b/i, not: /vl/i, rec: "qwen_3_4b.safetensors", kind: "text_encoders" },
  vae: { re: /flux2[-_]vae/i, not: /small/i, rec: "flux2-vae.safetensors", kind: "vae" },
};
const RM_LABEL = { unet: "拡散モデル", lora: "オブジェクト除去 LoRA", clip: "テキストエンコーダー", vae: "VAE" };

let ui = null;
let ctx = null;
const st = {
  W: 0, H: 0, layers: [], aimg: null, isel: null, // キャンバスの大きさ・レイヤー(下から上へ)・作業する画像・選んだ画像(の id)
  source: "", name: "",
  undo: [], redo: [], dirty: false, saved: null,
  tool: "select", snap: true, msel: [], brush: 40, balpha: 100, tol: 32, contig: true, rmMethod: "lama", mzsize: 16, mzmode: "pixel",
  tsel: null, secOpen: {}, styles: null, tplSel: "",
  bg: null, bgp: { thr: 0, grow: 0, feather: 0 },
  view: { z: 1, px: 0, py: 0, k: 1, ox: 0, oy: 0 },
  drag: null, mouse: null, space: false, busy: false,
  out: { fmt: "png", q: 92, bg: "transparent", color: "#ffffff", name: "" }, // 書き出し(形式・画質・背景・ファイル名)
  path: null, popt: { color: "#ff3b30", alpha: 1, width: 4, feather: 0 }, // パスツール: 置いた点・色などの設定
  crop: null, // トリミング中の枠(キャンバスの px)
  lcrop: null, // 画像のレイヤーの切り取りの範囲を画面で決めている間: { id, before(元に戻す用), L0(やめたときに戻す値) }
  shapeType: "rect", shapeStyle: null, lineStyle: null,
  tedit: null, blink: true, // 画像の上で編集している文字の id・入力位置の点滅 // 図形: 次に置く形・最後に使った見た目(塗る図形 / 線)
  job: null, tmpFiles: [], // 時間のかかる処理の進み具合 / 終わったら消す temp の画像
  ver: 0, // 変えるたびに増える(自動保存は、前に保存したときから増えていたら保存する)
  hist: { sid: "", ver: -1, timer: null, q: Promise.resolve() },
};
// 「保存していない変更」の印を付けるたびに ver を進める
{
  let dirty = false;
  Object.defineProperty(st, "dirty", { get: () => dirty, set: (v) => { dirty = !!v; if (v) st.ver++; }, enumerable: true });
}
// 作業する画像(消しゴム・背景を消す・オブジェクト除去などの相手)。st.img / st.orig / st.paint は、その画像の今の画素・開いたときの画素・除去範囲の塗り
const activeImg = () => st.layers.find((l) => l.kind === "image" && l.id === st.aimg) || null;
for (const [k, f] of [["img", "cv"], ["orig", "orig"], ["paint", "paint"]]) {
  Object.defineProperty(st, k, { get: () => activeImg()?.[f] || null, set: (v) => { const L = activeImg(); if (L) L[f] = v; }, enumerable: true });
}
// 文字 = レイヤーのうちの文字(重ねる順は st.layers の並び)
Object.defineProperty(st, "texts", {
  get: () => st.layers.filter((l) => l.kind === "text"),
  set: (arr) => { st.layers = st.layers.filter((l) => l.kind !== "text").concat((arr || []).map((t) => ({ ...t, kind: "text" }))); },
  enumerable: true,
});
const selImage = () => st.layers.find((l) => l.kind === "image" && l.id === st.isel) || null;
// 選んだレイヤー(画像か図形。文字は st.tsel)
const selObj = () => st.layers.find((l) => l.kind !== "text" && l.id === st.isel) || null;
const imageLayers = () => st.layers.filter((l) => l.kind === "image");

function css() {
  if (document.getElementById("cca-imged-style")) return;
  const s = document.createElement("style");
  s.id = "cca-imged-style";
  s.textContent = `
#cca-imged{position:fixed;inset:0;z-index:1001;background:#000c;display:none;align-items:center;justify-content:center;
  font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-imged.open{display:flex}
#cca-imged .box{background:#1a1e25;border:0;border-radius:0;width:100%;height:100%;display:flex;flex-direction:column}
#cca-imged .hd{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #303744;flex-wrap:wrap}
#cca-imged .hd b{font-size:16px}
#cca-imged .hd .nm{color:#9fb0c2;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40vw}
#cca-imged .sp{flex:1}
#cca-imged .main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) var(--sidew,360px)}
#cca-imged .stage{position:relative;min-width:0;min-height:0;overflow:hidden;background:repeating-conic-gradient(#2a2f37 0% 25%,#1d2128 0% 50%) 50%/20px 20px}
#cca-imged .stage.drop{outline:3px dashed #3db4a6;outline-offset:-6px}
#cca-imged canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
#cca-imged .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#9fb0c2;cursor:pointer;padding:20px}
#cca-imged .empty b{display:block;font-size:17px;color:#cfd5dc;margin-bottom:6px}
#cca-imged .zoomv{position:absolute;right:10px;bottom:8px;background:var(--card,rgba(0,0,0,.7));color:var(--text,#fff);border:1px solid rgba(0,0,0,.35);font-size:12px;line-height:1.5;padding:2px 8px;border-radius:4px;font-variant-numeric:tabular-nums;white-space:pre;pointer-events:none;z-index:20}
#cca-imged .side{border-left:1px solid #303744;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;container-type:inline-size}
#cca-imged section{border:1px solid #303744;border-radius:12px;padding:9px 12px;background:#161a20}
#cca-imged h4{margin:0 0 6px;font-size:14px;color:#cfd5dc}
#cca-imged .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
#cca-imged button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;font-size:13px}
#cca-imged button:hover{border-color:#3db4a6}
#cca-imged button.on{background:#2b8f84;border-color:#3db4a6;color:#fff}
#cca-imged button[data-c="snap"].on{background:#3a3417;border-color:#ffd24d;color:#ffe9a3}
#cca-imged button.pri{background:#2b8f84;border-color:#3db4a6;color:#fff;font-weight:700}
#cca-imged button:disabled{opacity:.45;cursor:default}
#cca-imged select{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 8px;font:inherit;font-size:13px;max-width:100%;flex:1;min-width:0}
#cca-imged label.rg{display:grid;grid-template-columns:8em minmax(0,1fr) 4.5em;gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:4px}
#cca-imged label.rg.off{opacity:.45}
#cca-imged label.fl{display:grid;grid-template-columns:8em minmax(0,1fr);gap:6px;align-items:center;font-size:13px;color:#c9d1da;margin-top:4px}
#cca-imged input[type=range]{width:100%;accent-color:#3db4a6}
#cca-imged input[type=number]{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:3px 5px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}
#cca-imged .note{font-size:13px;color:#9fb0c2;margin-top:4px}
#cca-imged .guide{font-size:13px;margin-top:6px;color:#e8d9b5}
#cca-imged .guide .lead{color:#e8d9b5;background:#231d12;border:1px solid #6b5422;border-radius:6px;padding:6px 8px}
#cca-imged .guide .cca-help button{padding:2px 8px;font-size:12.5px}
#cca-imged .guide .cca-help summary{margin-top:0;color:inherit}
#cca-imged details summary{cursor:pointer;color:#cfd5dc;font-size:13px;margin-top:6px}
#cca-imged .busy{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:#000d;padding:6px 12px;border-radius:8px;display:none;z-index:3;
  max-width:calc(100% - 24px);box-sizing:border-box}
#cca-imged .busy.on{display:block}
#cca-imged .busy.job{border:1px solid #3db4a6;padding:10px 14px;width:min(440px,calc(100% - 24px));box-shadow:0 8px 24px #000a}
#cca-imged .busy .jt{font-weight:700;color:#fff}
#cca-imged .busy .js{font-size:13px;color:#cfe9e5;margin-top:2px}
#cca-imged .busy .jb{height:8px;background:#2a2f37;border-radius:4px;overflow:hidden;margin-top:8px;position:relative}
#cca-imged .busy .jb i{display:block;height:100%;background:#3db4a6;width:0;transition:width .4s;position:absolute;left:0;top:0}
#cca-imged .busy .jb.ind i{width:35%;transition:none;animation:cca-imged-ind 1.4s ease-in-out infinite}
@keyframes cca-imged-ind{0%{left:-35%}100%{left:100%}}
#cca-imged .busy .jm{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#9fb0c2;margin-top:4px}
#cca-imged .busy .jm .je{white-space:nowrap}
#cca-imged .busy .jm .jr{text-align:right}
#cca-imged .busy .jc{margin-top:8px}
#cca-imged textarea{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:4px 6px;font:inherit;font-size:13px;width:100%;box-sizing:border-box;min-height:56px;resize:vertical}
#cca-imged input[type=color]{width:100%;height:28px;padding:0;border:1px solid #3a4250;border-radius:6px;background:#0e1115}
#cca-imged .tbox,#cca-imged .obox{position:absolute;display:none;cursor:move;z-index:3}
#cca-imged .cbox{position:absolute;display:none;cursor:move;z-index:4;box-shadow:0 0 0 9999px rgba(0,0,0,.5)}
#cca-imged .cbox .bb{border-color:#ffd24d}
#cca-imged .cbox .bb-h{border-color:#ffd24d}
#cca-imged .cbox .bb-rot,#cca-imged .cbox .bb-stem{display:none}
#cca-imged .lcbox{position:absolute;display:none;cursor:move;z-index:4}
#cca-imged .lcbox .bb{border-color:#ffd24d}
#cca-imged .lcbox .bb-h{border-color:#ffd24d}
#cca-imged .lcbox .bb-rot,#cca-imged .lcbox .bb-stem{display:none}
#cca-imged .lcrop{margin-top:8px;padding-top:6px;border-top:1px solid #303744}
#cca-imged .lcrop .lch{font-size:13px;font-weight:700;color:#cfd5dc;margin-bottom:2px}
#cca-imged .ly .ctag{color:#c77dff;font-weight:700}
#cca-imged .cbox .cdim,#cca-imged .lcbox .cdim{position:absolute;left:4px;top:4px;background:#000b;color:#ffd24d;font-size:12px;padding:1px 6px;border-radius:4px;pointer-events:none;white-space:nowrap}
#cca-imged .lylist{display:flex;flex-direction:column;gap:3px;margin:6px 0;max-height:240px;overflow:auto}
#cca-imged .ly{display:flex;gap:6px;align-items:center;padding:3px 6px;border:1px solid #303744;border-radius:6px;background:#13161b;cursor:pointer;font-size:13px}
#cca-imged .ly.sel{border-color:#4f8bff;background:#1a2540}
#cca-imged .ly.dropb{box-shadow:inset 0 2px 0 #3db4a6}
#cca-imged .ly.dropa{box-shadow:inset 0 -2px 0 #3db4a6}
#cca-imged .ly .ln{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cca-imged .ly .th{width:34px;height:24px;flex:none;border-radius:3px;background:repeating-conic-gradient(#3a3f48 0% 25%,#2a2e35 0% 50%) 0 0/8px 8px;position:static}
#cca-imged .ly .tt{display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:#cfd5dc}
#cca-imged .ly .act{font-size:11px;color:#ffd24d;white-space:nowrap}
#cca-imged .ly button{padding:0 5px;font-size:12px}
#cca-imged .ly.hid .ln{opacity:.45;text-decoration:line-through}
#cca-imged .lyops{margin-top:4px}
#cca-imged .ly.grp{position:relative}
#cca-imged .ly.grp::before{content:"";position:absolute;left:0;top:4px;bottom:4px;width:3px;background:hsl(var(--g) 70% 60%)}
#cca-imged .ly .gtag{color:hsl(var(--g) 70% 70%);font-weight:700}
#cca-imged .obox.multi .bb-rot,#cca-imged .obox.multi .bb-stem{display:none}
#cca-imged [data-c="msel"]:empty{display:none}
#cca-imged .lyops button{padding:3px 7px;font-size:12px}
#cca-imged .shapes button{padding:4px 7px;font-size:12.5px}
#cca-imged textarea.tedit{position:absolute;left:0;top:0;width:4px;height:20px;min-height:0;padding:0;margin:0;border:0;opacity:0;resize:none;overflow:hidden;
  white-space:pre;font-size:16px;line-height:20px;z-index:6;pointer-events:none;background:transparent;color:transparent;caret-color:transparent}
#cca-imged .g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 8px}
#cca-imged .g2 label.fl{grid-template-columns:5.5em minmax(0,1fr)}
#cca-imged input[type=text]{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:3px 6px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}
#cca-imged .tlist{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
#cca-imged .tlist button{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${sectionCss("#cca-imged")}
${frameHlCss("#cca-imged")}
${bboxCss("#cca-imged")}
${SECTIONS_CSS("#cca-imged")}
${cardCss("#cca-imged .side", "> section[data-sec]", { image: "blue", layers: "teal", canvas: "cyan", output: "yellow", shapes: "pink", text: "orange", watermark: "lime", tools: "purple", bg: "red", remove: "red" })}
#cca-imged .secbar{gap:6px;order:999;margin-top:6px}
@container (max-width:300px){#cca-imged label.rg,#cca-imged label.fl{display:flex;flex-wrap:wrap;gap:2px 6px}#cca-imged label.rg::before,#cca-imged label.fl::before{content:"";order:1;flex-basis:100%;height:0}#cca-imged label.rg>*,#cca-imged label.fl>*{order:2}#cca-imged label.rg>input[type=range]{flex:1 1 0;min-width:0}#cca-imged label.rg>input:not([type=range]){width:4.5em}#cca-imged label.fl>*{flex:1 1 100%;min-width:0}}
#cca-imged .secbar button{font-size:12px;padding:3px 8px}
`;
  document.head.appendChild(s);
}

const range = (k, label, min, max, step, val, extra = "") => `<label class="rg" data-rg="${k}" ${extra}>${label}<input type="range" data-c="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><input type="number" data-n="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;

function build() {
  css();
  ui = document.createElement("div");
  ui.id = "cca-imged";
  ui.tabIndex = -1;
  ui.innerHTML = `<div class="box">
    <div class="hd"><b>画像編集</b><span class="nm" data-c="name"></span><span class="sp"></span>
      <button data-c="undo" title="元に戻す(Ctrl+Z)" disabled>↶ 元に戻す</button>
      <button data-c="redo" title="やり直す(Ctrl+Y)" disabled>↷ やり直す</button>
      <button data-c="hsave" title="今の編集(文字のレイヤーも)を一時保存します(Ctrl+S)。🕘 履歴から開き直せます" disabled>📌 一時保存</button>
      <button data-c="hist" title="一時保存・自動保存した編集を開き直します">🕘 履歴</button>
      <button class="pri" data-c="save" title="生成パネルの「画像の保存先」と同じフォルダ(output の中)に「元の名前_edit.png」で保存します(同じ名前があれば _edit_1、_edit_2 …)" disabled>💾 保存</button>
      <button data-c="download" title="パソコンに「元の名前_edit.png」でダウンロードします" disabled>⬇ ダウンロード</button>
      <button data-c="copyimg" title="今の見た目をそのまま、画像としてクリップボードにコピーします(PNG)" disabled>📝クリップボードにコピー</button>
      <button data-c="use" title="保存してから入力画像1にします" disabled>入力画像1に使う</button>
      <button data-c="close">閉じる</button></div>
    <div class="main">
      <div class="stage"><canvas></canvas><div class="obox" data-c="ibox"></div><div class="cbox" data-c="cbox"></div><div class="lcbox" data-c="lcbox"></div><textarea class="tedit" data-c="tedit" spellcheck="false" autocomplete="off" aria-label="文字"></textarea><div class="tbox" data-c="tbox"></div>
        <div class="empty" data-c="empty"><div><b>画像を選んでください</b>ここをクリックして選ぶか、画像をドラッグ&ドロップします。コピーした画像は Ctrl+V で貼り付けられます。
          前の作業は、上の「🕘 履歴」から開き直せます。</div></div>
        <div class="busy"></div><div class="zoomv" data-c="zoomv"></div></div>
      <div class="side">
        <div class="row secbar" data-c="secbar"></div>
        <section data-sec="tools"><h4>ツール</h4>
          <div class="row">
            <button data-tool="select" class="on" title="押したレイヤー(画像・文字)を選び、枠で動かす・大きさ・回転を変える">↖ 選択</button>
            <button data-tool="pan" title="ドラッグで画面を動かす、ホイールで拡大・縮小">✋ 移動</button>
            <button data-c="snap" class="on" title="動かす・大きさを変えるとき、キャンバスやほかのレイヤーの端・真ん中にそろえる(Alt を押しながらドラッグすると、そろえない)">🧲 スナップ</button>
            <button data-tool="wand" title="クリックした所と似た色を透明にする">色で抜く</button>
            <button data-tool="erase" title="なぞった所を透明にする">消しゴム</button>
            <button data-tool="restore" title="なぞった所を開いたときの画像に戻す">戻すブラシ</button>
            <button data-tool="mosaic" title="なぞった所をモザイク(またはぼかし)にする">▦ モザイク</button>
            <button data-tool="text" title="クリックした所に文字を入れる。文字を押すと選べます">T 文字</button>
            <button data-tool="path" title="クリックで点を置いてパスを作ります(Alt + クリックで曲線)。内側・外側の削除、塗りつぶし、線の描画ができます">✒ パスツール</button>
          </div>
          ${range("brush", "ブラシの太さ", 2, 400, 1, 40)}
          ${range("balpha", "アルファ値(%)", 1, 100, 1, 100)}
          <div data-c="mzopts" hidden>
            <label class="fl">モザイクの種類<select data-c="mzmode"><option value="pixel">モザイク(ブロック)</option><option value="blur">ぼかし</option></select></label>
            ${range("mzsize", "モザイクの大きさ(px)", 2, 200, 1, 16)}
          </div>
          <div data-c="pathopts" hidden>
            <div class="row"><button data-c="pathin" title="作業中の画像の、パスの内側を透明にします">✂ 内側を削除</button><button data-c="pathout" title="作業中の画像の、パスの外側を透明にします">✂ 外側を削除</button></div>
            <div class="row"><button data-c="pathfill" title="パスの内側を選んだ色で塗りつぶし、新しいレイヤーとして追加します">■ 塗りつぶし</button><button data-c="pathline" title="パスに沿った線を、新しいレイヤーとして追加します(閉じたパスは 1 周)">〰 線を描画</button></div>
            <label class="fl">色<input type="color" data-c="pcolor" value="#ff3b30"></label>
            ${range("palpha", "不透明度(%)", 1, 100, 1, 100)}
            ${range("pwidth", "線の太さ(px)", 1, 200, 1, 4)}
            ${range("pfeather", "削除するときの境目のぼかし(px)", 0, 100, 1, 0)}
            <div class="row" style="margin-top:4px"><button data-c="pathback" title="Backspace">最後の点を削除</button><button data-c="pathclear" title="Esc">パスをクリア</button></div>
          </div>
          <div class="note" data-c="toolnote"></div></section>
        <section data-sec="layers" data-c="lysec"><h4>レイヤー</h4>
          <div class="row"><select data-c="placepick" title="画像を選んで、新しいレイヤーとして挿入します(何も開いていなければ、その画像で開きます)"></select><button data-c="placerf" title="保存先(output)と input のファイルの一覧を読み直して、最新にします">更新</button><button data-c="placeup" title="パソコンの画像を選んで、新しいレイヤーとして挿入します(何も開いていなければ、その画像で開きます)">＋ 画像を挿入</button></div>
          <div class="lylist" data-c="lylist"></div>
          <div class="row lyops"><button data-lo="top" title="いちばん前へ">⏫ 一番前</button><button data-lo="up" title="1 つ前へ">前へ</button><button data-lo="down" title="1 つ後ろへ">後ろへ</button><button data-lo="bottom" title="いちばん後ろへ">⏬ 一番後ろ</button>
            <button data-lo="dup" title="複製(Ctrl+C → Ctrl+V でも)">⧉ 複製</button><button data-lo="del" title="消す(Delete)">🗑 消す</button>
            <button data-lo="group" title="選んだレイヤーをグループにする(Ctrl+G)。Shift / Ctrl を押しながら押すと、いくつも選べます">⛓ グループ</button><button data-lo="ungroup" title="グループを解く(Ctrl+Shift+G)">解く</button></div>
          <div class="note" data-c="msel"></div>
          <div data-c="lyinsp"></div>
          <div data-c="lyclip"></div>
          <div class="note">一覧の上にあるレイヤーほど前に描きます(ドラッグで並べ替え)。画像を開いているときは、画面へのドラッグ&ドロップ・Ctrl+V で画像を挿入できます。消しゴム・背景を消す・オブジェクト除去などは「✎ 作業中」の画像に掛かります(画像を押すと作業中になります)。</div></section>
        <section data-sec="text" data-c="txsec"><h4>文字</h4>
          <div class="row"><button data-c="txadd" title="画像の真ん中に文字を入れます(「T 文字」ツールで、クリックした所にも入れられます)">＋ 文字を入れる</button>
            <button data-c="txflat" title="入れた文字を画像に描き込みます(元に戻せます)。保存・ダウンロードのときも描き込みます">✔ 画像に描き込む</button></div>
          <div class="tlist" data-c="tlist"></div>
          <div data-c="txinsp"></div></section>
        <section class="sec-folded" data-sec="shapes" data-c="shsec"><h4>図形</h4>
          <div class="row shapes">
            <button data-shape="rect" title="四角">▭ 四角</button><button data-shape="rrect" title="角の丸い四角">▢ 角丸</button><button data-shape="ellipse" title="丸(楕円)">◯ 丸</button>
            <button data-shape="tri" title="三角">△ 三角</button><button data-shape="line" title="線">╱ 線</button><button data-shape="arrow" title="矢印">→ 矢印</button>
            <button data-shape="pen" title="手書きの線(なぞった線が 1 つのレイヤーになります)">✎ ペン</button>
            <button data-tool="path" title="クリックで点を置いてパスを作ります(Alt + クリックで曲線)。内側・外側の削除、塗りつぶし、線の描画ができます">✒ パスツール</button></div>
          <div class="note">形を選んで、画面の上をドラッグすると、その大きさで置きます(Shift で正方形・正円・15 度ずつ)。クリックだけなら決まった大きさで置きます。置いたあとは「↖ 選択」で動かす・大きさ・色を変えられます。</div></section>
        <section class="sec-folded" data-sec="bg"><h4>背景を透明にする</h4>
          <div class="row"><button data-c="bg">背景を自動で消す</button></div>
          ${range("thr", "しきい値", 0, 100, 1, 0, 'class="rg off"')}
          ${range("grow", "縮める・広げる", -40, 40, 1, 0, 'class="rg off"')}
          ${range("feather", "縁のぼかし", 0, 40, 1, 0, 'class="rg off"')}
          <div class="note" data-c="bgnote">「背景を自動で消す」のあと、しきい値(上げると薄い所も消える)・縮める/広げる(px)・縁のぼかし(px)で縁を調整できます。</div>
          <div class="guide" data-c="bgguide" hidden></div>
          ${range("tol", "似た色の幅", 0, 160, 1, 32)}
          <label class="row" style="margin-top:4px;font-size:13px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" data-c="contig" checked style="margin-top:3px"> <span>つながっている所だけ(「色で抜く」)</span></label></section>
        <section class="sec-folded" data-sec="remove"><h4>オブジェクト除去(AI)</h4>
          <div class="row"><button data-tool="remove" title="消したい部分を塗る(「塗った所を消す」で消える)">🖌 塗る</button>
            <button data-tool="rmerase" title="除去範囲の塗りを、なぞった所だけ消します(塗りすぎた所を戻す)">🧽 塗りを消す</button>
            <label class="row" style="font-size:13px;gap:4px" title="塗る・塗りを消すブラシの太さ(画像の px)">太さ <input type="number" data-c="rmbrush" min="2" max="400" step="1" value="40" style="width:5em"></label></div>
          <label class="fl">方法<select data-c="rmmethod">
            <option value="lama">軽い(LaMa・約 200MB)</option>
            <option value="flux">きれい(FLUX.2 Klein・重い)</option></select></label>
          <div class="note" data-c="rmnote"></div>
          <div class="row" style="margin-top:6px"><button class="pri" data-c="rm">塗った所を消す</button><button data-c="rmclear" title="除去範囲の塗りを全部消します(元に戻せます)">塗りを全部消す</button>
            <label class="row" title="塗りの見える色です(画像に似た色があって見えにくいときに変えます。消す処理には関係しません)" style="margin-left:auto;font-size:13px">塗りの色 <input type="color" data-c="maskcolor"></label></div>
          <div class="guide" data-c="rmguide" hidden></div>
          <details data-c="rmlama"><summary>使うモデル・設定</summary>
            <label class="fl">モデル<select data-c="lamamodel"></select></label>
            ${range("lamagrow", "塗りを広げる(px)", 0, 64, 1, 8)}
            ${range("lamafeather", "縁のぼかし(px)", 0, 64, 1, 3)}
            ${range("lamacolor", "色を周りに合わせる(%)", 0, 100, 5, 100)}
            ${range("lamaside", "作業の大きさ(長い辺 px)", 256, 4096, 8, 1024)}
            <div class="note">塗った所を少し広げてから埋めます(消し残しの縁を防ぐ)。「色を周りに合わせる」は、埋めた所の色あせ・色ずれを、塗っていない所の色に合わせて直します。
              作業の大きさを上げると細かくなりますが、遅くなり、メモリも使います。ライセンス: LaMa は Apache-2.0(商用可)。</div>
          </details>
          <details data-c="rmset"><summary>使うモデル・設定</summary>
            <label class="fl">拡散モデル<select data-rm="unet"></select></label>
            <label class="fl">オブジェクト除去 LoRA<select data-rm="lora"></select></label>
            <label class="fl">テキストエンコーダー<select data-rm="clip"></select></label>
            <label class="fl">VAE<select data-rm="vae"></select></label>
            ${range("rmstr", "LoRA の強さ", 0, 2, 0.05, 1.1)}
            ${range("rmsteps", "ステップ数", 1, 50, 1, 20)}
            ${range("rmcfg", "CFG", 1, 10, 0.5, 5)}
            <label class="fl" title="-1 にすると毎回変わります(同じ数にすると、同じ結果をもう一度作れます)">シード<input type="number" data-c="rmseed" min="-1" max="4294967295" step="1" value="-1"></label>
            ${range("rmmp", "作業の大きさ(MP)", 0.25, 4, 0.05, 1)}
            <label class="fl">差し替える範囲<select data-c="rmarea">
              <option value="paint">塗った所(少し広げる)</option><option value="box">塗った所を囲む四角全体</option></select></label>
            ${range("rmgrow", "塗りを広げる(px)", 0, 128, 1, 12)}
            ${range("rmfeather", "縁のぼかし(px)", 0, 128, 1, 8)}
            ${range("rmcolor", "色を周りに合わせる(%)", 0, 100, 5, 100)}
            <div class="note">作り直すのは塗った所を囲む四角のまわりです。「差し替える範囲」を「塗った所」にすると、塗った所(広げた分も)だけを入れ替え、ほかは元の画素のままです。
              「色を周りに合わせる」は、作り直した所の色あせ・色ずれを、塗っていない所の色に合わせて直します(0% で直さない)。
              作業の大きさ(MP = 百万画素)を上げると細かくなりますが、遅くなり、メモリも使います。</div>
            <div class="note">ライセンス: FLUX.2 Klein 4B・オブジェクト除去 LoRA(fal)とも Apache-2.0(商用可)。</div>
          </details></section>
        <section class="sec-folded" data-sec="canvas" data-c="cvsec"><h4>キャンバス(大きさ・トリミング)</h4>
          <div class="note" data-c="cvinfo"></div>
          <div class="g2"><label class="fl">幅(px)<input type="number" data-cv="w" min="1" max="16384" step="1"></label>
            <label class="fl">高さ(px)<input type="number" data-cv="h" min="1" max="16384" step="1"></label></div>
          <label class="row" style="font-size:13px"><input type="checkbox" data-cv="keep" checked> <span>縦横比を保つ</span></label>
          <div class="row" style="margin-top:4px"><label class="row" style="font-size:13px">倍率 <input type="number" data-cv="pct" min="1" max="1000" step="1" value="100" style="width:5.5em"> %</label>
            <button class="pri" data-ca="resize" title="キャンバスを、置いたレイヤーごと拡大・縮小します(元に戻せます)">リサイズ</button></div>
          <div class="row" style="margin-top:6px"><button data-ca="crop" title="枠で範囲を決めて切り抜きます。外まで広げると余白になります">✂ トリミング…</button>
            <button data-ca="fitall" title="置いたレイヤーがすべて入る大きさに、キャンバスを広げる / 狭める">全部が入る大きさに</button></div>
          ${frameHlHtml()}
          <div data-c="cropbar" hidden>
            <label class="fl">比率<select data-cv="ratio"><option value="free">自由</option><option value="orig">今のキャンバスと同じ</option>
              <option value="1:1">1:1(正方形)</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="3:2">3:2</option><option value="2:3">2:3</option>
              <option value="16:9">16:9</option><option value="9:16">9:16</option></select></label>
            <div class="g2"><label class="fl">左(px)<input type="number" data-cr="x" step="1"></label><label class="fl">上(px)<input type="number" data-cr="y" step="1"></label>
              <label class="fl">幅(px)<input type="number" data-cr="w" min="1" step="1"></label><label class="fl">高さ(px)<input type="number" data-cr="h" min="1" step="1"></label></div>
            <div class="row" style="margin-top:4px"><button class="pri" data-ca="cropok">✂ この範囲にする</button><button data-ca="cropno">やめる</button></div>
            <div class="note">枠の中をドラッグで動かし、角・辺で大きさを変えます(Shift で比率をそのまま)。キャンバスの外まで広げると、そこは余白(書き出しの背景)になります。Enter で決定、Esc でやめます。</div>
          </div></section>
        <section class="sec-folded" data-sec="watermark"><h4>透かし</h4>
          <div class="row"><button data-c="wm" title="登録した透かし画像(ロゴなど)を、右下・左下・右上・左上・真ん中に入れます">💧 透かしを入れる…</button></div>
          <div class="note">透かしの画像を登録しておき、置く所・大きさ(画像に対しての %)・余白・不透明度を決めて「透かし追加」で入れます。</div></section>
        <section class="sec-folded" data-sec="output" data-c="outsec"><h4>書き出し(保存・ダウンロード)</h4>
          <label class="fl">形式<select data-o="fmt"><option value="png">PNG(劣化なし・透明も)</option><option value="jpeg">JPEG(小さい・透明なし)</option><option value="webp">WebP(小さい・透明も)</option></select></label>
          <label class="fl" data-orow="q">画質(%)<input type="number" data-o="q" min="1" max="100" step="1"></label>
          <label class="fl">背景<select data-o="bg"><option value="transparent">透明</option><option value="white">白</option><option value="black">黒</option><option value="color">色を選ぶ</option></select></label>
          <label class="fl" data-orow="color">背景の色<input type="color" data-o="color"></label>
          <label class="fl">ファイル名<input type="text" data-o="name" maxlength="120"></label>
          <div class="note" data-c="outnote"></div></section>
      </div>
    </div></div>`;
  document.body.appendChild(ui);
  bind();
  enhanceNotes(ui); // 説明文は ⓘ で折りたたむ
}

const $ = (sel) => ui.querySelector(sel);
const $$ = (sel) => [...ui.querySelectorAll(sel)];
// 画像が要るボタン(読み込み中・処理中は押せない)。refresh と busy で同じものを使う
const BUSY_KEYS = ["save", "download", "copyimg", "use", "bg", "rm", "rmclear", "wm", "txadd", "hsave"];
function busy(text) {
  st.busy = !!text;
  const b = $(".busy");
  if (!st.job) { b.classList.remove("job"); b.textContent = text || ""; }
  b.classList.toggle("on", !!text);
  // 終わったら画面全体を合わせる(読み込み中に refresh すると、文字・透かし・ダウンロードなども押せないままになるため)
  if (text) { for (const k of BUSY_KEYS) { const el = $(`[data-c="${k}"]`); if (el) el.disabled = true; } }
  else refresh();
}

// ---------------------------------------------------------------- 画像
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("画像を読み込めませんでした"));
    im.src = src;
  });
}
function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function copyCanvas(src) { const c = canvasOf(src.width, src.height); c.getContext("2d").drawImage(src, 0, 0); return c; }
function toCanvas(im) { const c = canvasOf(im.naturalWidth || im.width, im.naturalHeight || im.height); c.getContext("2d").drawImage(im, 0, 0); return c; }
const toBlob = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("画像を作れませんでした"))), "image/png"));
function displayName(value) {
  const m = /^(.*?)\s*\[(input|output|temp)\]$/.exec(String(value || ""));
  return (m ? m[1] : String(value || "")).split("/").pop();
}
function stem(value) { return (displayName(value).replace(/\.[^.]+$/, "") || "image").replace(/_edit(?:_\d+)?$/, ""); }

// 画像のレイヤー(cx・cy: キャンバスでの真ん中、w・h: キャンバスでの大きさ。画素は cv のまま持つ)
function imageLayer(cv, name, cx, cy, w, h) {
  return { id: tuid++, kind: "image", name: String(name || "image"), cv, orig: copyCanvas(cv), paint: canvasOf(cv.width, cv.height),
    cx, cy, w, h, rot: 0, opacity: 1, hidden: false };
}
// 新しいキャンバス: 画像の大きさで、その画像を 1 つ目のレイヤーにする
function newDoc(cv, name) {
  st.W = cv.width; st.H = cv.height;
  st.crop = null; st.lcrop = null; st.out.name = "";
  const L = imageLayer(cv, name, cv.width / 2, cv.height / 2, cv.width, cv.height);
  st.layers = [L];
  st.aimg = L.id; st.isel = null; st.tsel = null; st.msel = [];
}
// 何も開いていないときの始まり: 空(透明)のキャンバス。図形・パス・文字はこのまま置ける。
// 画像を貼り付ける・開くと、空のレイヤーはその画像に替わり、キャンバスはその画像の大きさになる(置いた図形・文字はそのまま)
const BLANK_SIZE = 1024;
function startBlank() {
  newDoc(canvasOf(BLANK_SIZE, BLANK_SIZE), T("空のキャンバス"));
  st.layers[0].blank = true;
  st.source = ""; st.name = T("新規");
  st.undo = []; st.redo = []; st.bg = null; st.dirty = false; st.saved = null;
  st.view.z = 1; st.view.px = 0; st.view.py = 0;
  histNew();
  fillPick();
  refresh();
}
function replaceBlank(bl, cv, name, value = "") {
  const only = st.layers.every((l) => l === bl);
  endBg();
  if (!only) pushUndo(true);
  const L = imageLayer(cv, name, cv.width / 2, cv.height / 2, cv.width, cv.height);
  st.layers = [L, ...st.layers.filter((l) => l !== bl)];
  st.W = cv.width; st.H = cv.height; st.crop = null; st.lcrop = null; st.out.name = "";
  st.aimg = L.id; st.isel = null; st.tsel = null; st.msel = [];
  st.source = value; st.name = name; st.bg = null; st.saved = null;
  st.view.z = 1; st.view.px = 0; st.view.py = 0;
  if (only) { st.undo = []; st.redo = []; st.dirty = false; histNew(); } else st.dirty = true;
  fillPick();
  refresh();
}
async function openValue(value) {
  const im = await loadImg(ctx.imageUrl(value));
  newDoc(toCanvas(im), displayName(value));
  st.source = value;
  st.name = displayName(value);
  st.undo = []; st.redo = []; st.bg = null; st.dirty = false; st.saved = null;
  st.view.z = 1; st.view.px = 0; st.view.py = 0;
  histNew();
  fillPick();
  refresh();
}
// 画像を置く(キャンバスの真ん中に、キャンバスの 6 割に収まる大きさで。いちばん前に)
function placeCanvas(cv, name, value = "") {
  if (!st.layers.length) { newDoc(cv, name); st.source = ""; st.name = name; histNew(); fillPick(); refresh(); return; }
  const bl = st.layers.find((l) => l.blank);
  if (bl) { replaceBlank(bl, cv, name, value); return; }
  endBg();
  pushUndo(true);
  const k = Math.min(1, (st.W * 0.6) / cv.width, (st.H * 0.6) / cv.height);
  const L = imageLayer(cv, name, st.W / 2, st.H / 2, r3(cv.width * k), r3(cv.height * k));
  st.layers.push(L);
  st.aimg = L.id; st.isel = L.id; st.tsel = null;
  if (st.tool !== "select") st.tool = "select";
  st.dirty = true;
  refresh();
  ctx.notify(T("「{0}」を置きました(枠で動かす・大きさを変えられます)", name), "info", null, { toast: true });
}
async function placeValue(value) {
  const im = await loadImg(ctx.imageUrl(value));
  placeCanvas(toCanvas(im), displayName(value), value);
}
async function placeFile(file) {
  if (!file || !/^image\//.test(file.type || "image/")) return;
  if (!st.layers.length) { await openFile(file); return; }
  busy("画像を挿入中…");
  try { await placeValue(await ctx.upload(file)); }
  catch (e) { ctx.notify(`${T("画像を挿入できませんでした")}: ${e.message}`, "error"); }
  finally { busy(""); }
}
async function openFile(file) {
  if (!file || !/^image\//.test(file.type || "image/")) return;
  if (!(await askDiscard("open"))) return;
  busy("画像を挿入中…");
  try { await openValue(await ctx.upload(file)); }
  catch (e) { ctx.notify(`画像を開けませんでした: ${e.message}`, "error"); }
  finally { busy(""); }
}
// 閉じる・別の画像を開く前: 保存していなければ確かめてから、今の作業を自動保存する(保存できなかったら、もう一度確かめる)
async function askDiscard(why = "close") {
  let keep = true;
  if (st.dirty) {
    const a = await askClose(T(why === "close" ? "保存していない変更があります。どうしますか?" : "保存していない変更があります。別の画像を開く前に、どうしますか?"), T);
    if (a === "back") return false;
    keep = a === "keep";
  }
  // 一時保存: 🕘 履歴に残す(保存できなかったら確かめる)
  const saved = keep ? await histSave(true) : null;
  if (keep && saved === false && !confirm("一時保存できませんでした。それでも続けますか?")) return false;
  if (saved && why === "close") ctx.notify(T("編集の内容を一時保存しました(🕘 履歴から開き直せます)"), "info");
  return true;
}
function fillPick() {
  const list = [...ctx.images()];
  if (st.source && !list.includes(st.source)) list.unshift(st.source);
  $('[data-c="placepick"]').innerHTML = `<option value="">${esc(T("(挿入する画像を選ぶ)"))}</option>`
    + list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
}

// ---------------------------------------------------------------- 元に戻す・やり直す
// 元に戻す: キャンバスの大きさと、レイヤーすべて(画像の画素は入れ物ごと覚える)。
// 画素を変えるときは、今の画素はそのまま残して写しを変える(位置・文字だけの変更は写さない)。
// オブジェクト除去の塗りも、ひと塗りずつ戻せる(塗るときは塗りの写しを変える。塗りだけの変更は「保存していない変更」にしない)
const cloneLayer = (l) => (l.kind === "image" ? { ...l } : JSON.parse(JSON.stringify(l)));
const undoSnap = (paintOnly = false) => ({ W: st.W, H: st.H, aimg: st.aimg, isel: st.isel, tsel: st.tsel, msel: [...(st.msel || [])], layers: st.layers.map(cloneLayer), paintOnly });
function pushUndo(textOnly = false, paintOnly = false) {
  if (!st.layers.length) return;
  st.undo.push(undoSnap(paintOnly));
  if (paintOnly) { if (st.paint) { st.paint = copyCanvas(st.paint); st.paint._dirty = true; } }
  else if (!textOnly && st.img) st.img = copyCanvas(st.img);
  if (st.undo.length > MAX_UNDO) st.undo.shift();
  st.redo = [];
  if (!paintOnly) st.dirty = true;
}
function undoRestore(u) {
  if (st.tedit != null) { st.tedit = null; blinkOn(false); }
  st.W = u.W; st.H = u.H; st.layers = u.layers; st.aimg = u.aimg; st.isel = u.isel; st.tsel = u.tsel;
  st.msel = (u.msel || []).filter((id) => st.layers.some((l) => l.id === id));
  for (const l of st.layers) if (l.paint) l.paint._dirty = true;
  if (!st.texts.some((t) => t.id === st.tsel)) st.tsel = null;
  if (!selImage()) st.isel = null;
  if (!activeImg()) st.aimg = imageLayers().at(-1)?.id ?? null;
  st.bg = null;
  if (!u.paintOnly) st.dirty = true;
  refresh();
}
function undo() {
  if (st.lcrop) { endLayerCrop(false); return; }
  if (!st.undo.length || st.busy) return;
  const u = st.undo.pop();
  st.redo.push(undoSnap(u.paintOnly));
  undoRestore(u);
}
function redo() {
  if (st.lcrop) { endLayerCrop(false); return; }
  if (!st.redo.length || st.busy) return;
  const u = st.redo.pop();
  st.undo.push(undoSnap(u.paintOnly));
  undoRestore(u);
}
// 背景の調整中に別の操作をしたら、調整は終わり(今の見た目のまま)
function endBg() { if (st.bg) { st.bg = null; refreshBg(); } }

// ---------------------------------------------------------------- 表示
function refresh() {
  if (st.lcrop && (selObj()?.id !== st.lcrop.id || st.tool !== "select")) { endLayerCrop(true); return; }
  const has = st.layers.length > 0;
  $('[data-c="empty"]').style.display = has ? "none" : "";
  $('[data-c="name"]').textContent = has ? st.name + (st.dirty ? " *" : "") : "";
  $('[data-c="undo"]').disabled = !st.undo.length;
  $('[data-c="redo"]').disabled = !st.redo.length;
  for (const k of BUSY_KEYS) $(`[data-c="${k}"]`).disabled = !has || st.busy;
  $('[data-c="hist"]').disabled = st.busy;
  $('[data-c="txflat"]').disabled = !st.texts.length || st.busy;
  for (const k of ["bg", "rm", "rmclear"]) $(`[data-c="${k}"]`).disabled = !st.img || st.busy;
  renderLayers();
  refreshCanvasUi();
  refreshOut();
  renderTextList();
  renderTextInsp();
  refreshBg();
  refreshTool();
  draw();
}
function refreshBg() {
  for (const k of ["thr", "grow", "feather"]) {
    $(`[data-rg="${k}"]`).classList.toggle("off", !st.bg);
    $(`[data-c="${k}"]`).disabled = !st.bg;
    $(`[data-n="${k}"]`).disabled = !st.bg;
  }
}
function refreshTool() {
  for (const b of $$("[data-tool]")) b.classList.toggle("on", b.dataset.tool === st.tool);
  for (const b of $$("[data-shape]")) b.classList.toggle("on", st.tool === "shape" && b.dataset.shape === st.shapeType);
  $('[data-c="toolnote"]').textContent = {
    shape: st.shapeType === "pen" ? "なぞった線が 1 つのレイヤーになります(続けて何本でも描けます)。線の色・太さは、描いたあと「レイヤー」の設定で変えられます。"
      : "画面の上をドラッグすると、その大きさで置きます(Shift で正方形・正円・15 度ずつ)。クリックだけなら決まった大きさで置きます。",
    select: "押したレイヤー(画像・文字・図形)を選びます。枠の中をドラッグで動かし、角で大きさ(縦横比はそのまま)、辺で幅・高さ、下の丸で回転(Shift で 15 度ずつ)。透明な所は押しても後ろのレイヤーが選ばれます。",
    pan: "ドラッグで移動、ホイールで拡大・縮小します。どのツールでも、右ドラッグかスペースキーを押しながらのドラッグで移動できます。",
    wand: "透明にしたい色の所をクリックします。「似た色の幅」を広げると、近い色もまとめて透明になります。",
    erase: "なぞった所を透明にします。アルファ値 50% なら半分だけ透けます(1 回なぞる間は重ねても同じ。もう一度なぞると、さらに透けます)。",
    restore: "なぞった所を、開いたときの画像に戻します(消しすぎた所を直すとき)。アルファ値 50% なら半分だけ戻ります。",
    mosaic: "なぞった所をモザイクにします。「ブラシの太さ」で塗る幅、「モザイクの大きさ」で 1 マスの大きさ(画像の px)を変えます。種類を「ぼかし」にすると、なぞった所がぼけます。アルファ値 50% なら半分だけ掛かります。Ctrl+Z で戻せます。",
    remove: "消したい部分を塗って、「塗った所を消す」を押します(軽い方法は塗った所だけ、きれいな方法は塗った所を囲む四角の中が作り直されます)。塗りすぎたら「🧽 塗りを消す」でなぞるか、Ctrl+Z でひと塗りずつ戻せます。",
    rmerase: "除去範囲の塗りを、なぞった所だけ消します(塗りすぎた所を戻すとき)。全部消すときは「塗りを全部消す」。Ctrl+Z で戻せます。",
    text: "クリックした所に文字を入れます。入れた文字を押すと選べ、枠の角で大きさ・左右の □ で折り返す幅・下の丸で回転を変えられます。",
    path: "画像の上をクリックして点を置きます(点はドラッグで移動)。最初の点のクリック・ダブルクリック・Enter でパスを閉じます。Alt + クリックで点を曲線にし(もう一度で角に戻す)、出てきたハンドルをドラッグで曲がり方を変えます(Alt を押しながらで片側だけ)。Backspace で最後の点を削除、Esc でクリア。点をクリックで選び(Shift + クリックで複数)、ドラッグか矢印キー(Shift で 10 ずつ)で動かします。線をつかむとパス全体を動かします。「内側を削除」「外側を削除」は作業中の画像に、「塗りつぶし」「線を描画」は新しいレイヤーとして追加します。",
  }[st.tool];
  const cv = $(".stage > canvas");
  cv.style.cursor = st.tool === "pan" ? "grab" : st.tool === "select" ? "default" : st.tool === "shape" || st.tool === "path" ? "crosshair" : st.tool === "wand" ? "crosshair" : st.tool === "text" ? "text" : "none";
  // アルファ値は消しゴム・戻すブラシ・モザイクだけ
  const ba = st.tool === "erase" || st.tool === "restore" || st.tool === "mosaic";
  $('[data-rg="balpha"]').classList.toggle("off", !ba);
  $('[data-c="mzopts"]').hidden = st.tool !== "mosaic";
  $('[data-c="pathopts"]').hidden = st.tool !== "path";
  const lab = $('[data-rg="mzsize"]').firstChild;
  if (lab) lab.textContent = T(st.mzmode === "blur" ? "ぼかしの強さ(px)" : "モザイクの大きさ(px)");
}
function layout() {
  const cv = $(".stage > canvas");
  const r = cv.getBoundingClientRect();
  const iw = st.W || 1, ih = st.H || 1;
  // 枠を強調表示するときは、線が見えるように太さの分だけ余白を広げる
  const pad = 24 + frameHlPad(st.fhl) * 2;
  const base = Math.min((r.width - pad) / iw, (r.height - pad) / ih);
  const k = Math.max(0.01, base * st.view.z);
  st.view.k = k;
  st.view.ox = (r.width - iw * k) / 2 + st.view.px;
  st.view.oy = (r.height - ih * k) / 2 + st.view.py;
  return r;
}
function draw() {
  if (!ui) return;
  const cv = $(".stage > canvas");
  const r = layout();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  updZoomv();
  if (!st.layers.length) { placeTextBox(); placeImageBox(); placeCropBox(); placeLayerCropBox(); return; }
  const { k, ox, oy } = st.view;
  // キャンバス(書き出す範囲)の背景。透明なら市松模様のまま
  const bgc = outBg();
  if (bgc) { g.fillStyle = bgc; g.fillRect(ox, oy, st.W * k, st.H * k); }
  drawLayers(g, k, ox, oy, true);
  // キャンバスの外にはみ出した所は暗く(書き出しには入らない)
  g.save();
  g.fillStyle = "rgba(10,12,16,0.55)";
  g.beginPath();
  g.rect(0, 0, r.width, r.height);
  g.rect(ox, oy, st.W * k, st.H * k);
  g.fill("evenodd");
  if (st.fhl?.on) {
    // 強調表示: 書き出す範囲の外側に線を引く(中の絵には掛けない)
    const lw = st.fhl.w;
    g.strokeStyle = st.fhl.color;
    g.lineWidth = lw;
    g.strokeRect(ox - lw / 2, oy - lw / 2, st.W * k + lw, st.H * k + lw);
  } else {
    g.strokeStyle = "#56606e";
    g.lineWidth = 1;
    g.strokeRect(ox - 0.5, oy - 0.5, st.W * k + 1, st.H * k + 1);
  }
  g.restore();
  placeTextBox();
  placeImageBox();
  placeCropBox();
  placeLayerCropBox();
  // 画像の切り取りの範囲を決めている間: 形の線
  const LC = lcropLayer();
  if (LC && cropOf(LC).shape !== "rect") {
    const c = cropOf(LC), sc = (k * (LC.w / c.w + LC.h / c.h)) / 2;
    g.save();
    layerTransform(g, LC);
    cropShapePath(g, c);
    g.lineWidth = 1.5 / sc;
    g.setLineDash([5 / sc, 4 / sc]);
    g.strokeStyle = "#ffd24d";
    g.stroke();
    g.restore();
  }
  // オブジェクト除去: 作業する画像の塗り(塗りの色)と、作り直す四角
  const A = activeImg();
  if (A && A.paint && !A.hidden) {
    const sc = (k * A.w) / cropOf(A).w;
    g.save();
    g.globalAlpha = 0.45;
    layerTransform(g, A);
    g.drawImage(tintedPaint(), 0, 0);
    const b = st.drag ? null : paintBox(); // 塗っている間は計算しない(重いので)
    if (b) {
      g.globalAlpha = 1;
      g.strokeStyle = "#ff5d5d";
      g.lineWidth = 1 / sc;
      g.setLineDash([6 / sc, 4 / sc]);
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
    g.restore();
  }
  drawEditCaret(g);
  drawPathGuide(g);
  // ブラシの大きさ(作業する画像の画素で)
  if (st.mouse && BRUSH_TOOLS.includes(st.tool) && !panning()) {
    const rad = Math.max(1, (st.brush / 2) * k * (A ? A.w / cropOf(A).w : 1));
    g.save();
    g.strokeStyle = "#fff";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(st.mouse.x, st.mouse.y, rad, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#000";
    g.beginPath();
    g.arc(st.mouse.x, st.mouse.y, rad + 1, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
}
// ---------------------------------------------------------------- 画像の上で文字を編集する(右の欄と同じ文字。どちらで打っても選んでも同じになる)
// 並べた行が、元の文字列のどこからどこまでか([始め, 終わり])。折り返し・改行で消える空白は飛ばす
function lineRanges(text, lines) {
  const out = [];
  let pos = 0;
  for (const ln of lines) {
    let i = ln === "" ? pos : text.indexOf(ln, pos);
    if (i < 0) i = pos;
    out.push([i, i + ln.length]);
    pos = i + ln.length;
    if (text[pos] === "\n") pos += 1;
  }
  return out;
}
// 文字の中の位置(文字の真ん中が 0,0。回す前のキャンバスの px)
function caretGeom(t) {
  const L = layoutOf(t), text = String(t.text ?? "");
  const ranges = lineRanges(text, L.lines);
  measureG.font = L.font;
  const top = -L.th / 2 + L.sw;
  const xAt = (r, i) => lineX(L, t, r) + measureG.measureText(L.lines[r].slice(0, Math.max(0, Math.min(i, ranges[r][1]) - ranges[r][0]))).width;
  const rowOf = (i) => { let r = 0; for (let j = 0; j < ranges.length; j++) if (ranges[j][0] <= i) r = j; return r; };
  return { L, ranges, top, xAt, rowOf, lh: L.lineH, ch: L.lineH - Math.round(((t.size || 0.08) * st.H) * 0.2) };
}
// 画面の点 → 文字の中の位置(何文字目)
function textIndexAt(t, sx, sy) {
  const d = toDoc(sx, sy), a = (-(t.rot || 0) * Math.PI) / 180;
  const dx = d.x - t.x * st.W, dy = d.y - t.y * st.H;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  const G = caretGeom(t);
  const r = clamp(Math.floor((ly - G.top) / G.lh), 0, G.ranges.length - 1);
  const [s0, e0] = G.ranges[r];
  let best = s0, bd = Infinity;
  for (let i = s0; i <= e0; i++) { const x = G.xAt(r, i), dd = Math.abs(x - lx); if (dd < bd) { bd = dd; best = i; } }
  return best;
}
// いま入力位置を見せる欄(画像の上の編集か、右の欄の「文字」)と、その文字
function editSource() {
  const t = selText();
  if (!t || t.hidden) return null;
  const ov = $('[data-c="tedit"]');
  if (st.tedit === t.id) return { t, el: ov };
  const side = $('[data-c="txinsp"] [data-k="text"]');
  if (side && document.activeElement === side) return { t, el: side };
  return null;
}
function drawEditCaret(g) {
  const src = editSource();
  if (!src) return;
  const { t, el } = src, { k, ox, oy } = st.view;
  const G = caretGeom(t), L = G.L;
  g.save();
  g.translate(ox + t.x * st.W * k, oy + t.y * st.H * k);
  g.scale(k, k);
  g.rotate(((t.rot || 0) * Math.PI) / 180);
  // 編集中の枠
  g.strokeStyle = "#ffb020";
  g.lineWidth = 1.5 / k;
  g.setLineDash([5 / k, 3 / k]);
  g.strokeRect(-L.w / 2, -L.h / 2, L.w, L.h);
  g.setLineDash([]);
  const a = Math.min(el.selectionStart ?? 0, el.selectionEnd ?? 0), b = Math.max(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  if (a !== b) {
    g.fillStyle = "rgba(79,139,255,0.38)";
    G.ranges.forEach(([s0, e0], r) => {
      const x0 = G.xAt(r, Math.max(a, s0)), x1 = G.xAt(r, Math.min(b, e0));
      const y = G.top + r * G.lh;
      if (b > s0 && a <= e0 && (x1 > x0 || (a <= s0 && b > e0))) g.fillRect(x0, y, Math.max(x1 - x0, 4 / k), G.ch);
    });
  } else if (st.blink) {
    const r = G.rowOf(a), x = G.xAt(r, a), y = G.top + r * G.lh;
    g.fillStyle = "#ffb020";
    g.fillRect(x - 1 / k, y, 2 / k, G.ch);
    // 日本語入力の候補の窓が入力位置の近くに出るように、見えない入力欄をそこへ
    if (el.dataset.c === "tedit") {
      const a2 = ((t.rot || 0) * Math.PI) / 180, px = x, py = y + G.ch;
      const cx = ox + (t.x * st.W + px * Math.cos(a2) - py * Math.sin(a2)) * k, cy = oy + (t.y * st.H + px * Math.sin(a2) + py * Math.cos(a2)) * k;
      el.style.left = `${Math.round(cx)}px`;
      el.style.top = `${Math.round(cy - 20)}px`;
    }
  }
  g.restore();
}
let blinkTimer = 0;
function blinkOn(on) {
  clearInterval(blinkTimer);
  st.blink = true;
  if (on) blinkTimer = setInterval(() => { if (!editSource()) { clearInterval(blinkTimer); return; } st.blink = !st.blink; draw(); }, 530);
}
// 画像の上で編集を始める(ダブルクリック)。at: 入力位置(省略で最後)
function beginTextEdit(t, at) {
  if (!t || st.busy) return;
  endBg();
  st.tsel = t.id; st.isel = null;
  if (!["text", "select"].includes(st.tool)) st.tool = "select";
  st.tedit = t.id;
  const ta = $('[data-c="tedit"]');
  ta.value = String(t.text ?? "");
  ta._ccaStart = ta.value;
  st.teditPushed = false;
  refresh();
  ta.focus({ preventScroll: true });
  const i = at ?? ta.value.length;
  ta.setSelectionRange(i, i);
  blinkOn(true);
  draw();
}
function endTextEdit() {
  if (st.tedit == null) return;
  st.tedit = null;
  const ta = $('[data-c="tedit"]');
  if (document.activeElement === ta) ta.blur();
  blinkOn(false);
  ui.focus({ preventScroll: true });
  refresh();
}
// 画像の上の編集で打った文字(日本語の変換中の文字も、その場に出す)
function onEditInput() {
  const t = selText();
  if (!t || st.tedit !== t.id) return;
  const ta = $('[data-c="tedit"]');
  if (!st.teditPushed) { pushUndo(true); st.teditPushed = true; }
  t.text = ta.value;
  st.dirty = true;
  st.blink = true;
  draw();
  syncTextInsp();
  renderTextList();
  renderLayers();
}
// 編集中の文字の上でのクリック・ドラッグ: 入力位置・選ぶ範囲
function editPointer(e, sx, sy) {
  const t = selText();
  const ta = $('[data-c="tedit"]');
  if (!t || st.tedit !== t.id || textAt(sx, sy) !== t) return false;
  e.preventDefault();
  const i0 = textIndexAt(t, sx, sy);
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(i0, i0);
  st.blink = true;
  draw();
  const r = $(".stage > canvas").getBoundingClientRect();
  const move = (ev) => {
    const i = textIndexAt(t, ev.clientX - r.left, ev.clientY - r.top);
    ta.setSelectionRange(Math.min(i0, i), Math.max(i0, i), i < i0 ? "backward" : "forward");
    draw();
  };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  return true;
}
// 書き出すときの背景の色(透明なら null)
function outBg() {
  const o = st.out || {};
  if (o.bg === "transparent" || !o.bg) return o.fmt === "jpeg" ? "#ffffff" : null; // JPEG は透明にできない
  return o.bg === "white" ? "#ffffff" : o.bg === "black" ? "#000000" : o.color || "#ffffff";
}
// キャンバスの点 → 画像のレイヤーの中の画素(回転・大きさを戻す)
function docToLayer(L, x, y) {
  const a = (-(L.rot || 0) * Math.PI) / 180, dx = x - L.cx, dy = y - L.cy;
  let rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
  if (L.warp) { const iv = hInv(homog(warpQuad(L)), rx, ry); rx = (iv.u - 0.5) * L.w; ry = (iv.v - 0.5) * L.h; } // ゆがみを戻す
  const c = cropOf(L); // レイヤーの枠 = 切り取った範囲
  return { x: (rx * c.w) / L.w + c.x + c.w / 2, y: (ry * c.h) / L.h + c.y + c.h / 2 };
}
// ---------------------------------------------------------------- ゆがみ(自由変形。Ctrl + 辺ドラッグ。画像レイヤー)
// L.warp = 4 つの角のずれ [[dx, dy] × 4](左上・右上・右下・左下。回す前のレイヤーの座標・キャンバスの px)。無ければ四角のまま
const warpQuad = (L) => { const w = L.w / 2, h = L.h / 2, o = L.warp; return [[-w + o[0][0], -h + o[0][1]], [w + o[1][0], -h + o[1][1]], [w + o[2][0], h + o[2][1]], [-w + o[3][0], h + o[3][1]]]; };
// 単位正方形 (u, v) → 四角形 q(左上・右上・右下・左下)の射影変換
function homog(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { const den = dx1 * dy2 - dx2 * dy1 || 1e-9; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  return { a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0, d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0, g, h };
}
const hPt = (m, u, v) => { const w = m.g * u + m.h * v + 1; return [(m.a * u + m.b * v + m.c) / w, (m.d * u + m.e * v + m.f) / w]; };
// 四角形の中の点 (x, y) → 単位正方形の (u, v)
function hInv(m, x, y) {
  const { a, b, c, d, e, f, g, h } = m;
  const u = (e - f * h) * x + (c * h - b) * y + (b * f - c * e), v = (f * g - d) * x + (a - c * g) * y + (c * d - a * f), w = (d * h - e * g) * x + (b * g - a * h) * y + (a * e - b * d);
  return { u: u / (w || 1e-9), v: v / (w || 1e-9) };
}
// 画像 src を四角形 q にゆがめて描く(細かい三角形に分けて貼る)
function drawWarped(g, src, q, grow = 0.6) {
  const m = homog(q), N = 10, sw = src.width, sh = src.height;
  const tri = (s0, s1, s2, d0, d1, d2) => {
    const det = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
    if (Math.abs(det) < 1e-9) return;
    const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / det;
    const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / det;
    const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / det;
    const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / det;
    const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
    const ex = (p) => { const dx = p[0] - cx, dy = p[1] - cy, n = Math.hypot(dx, dy) || 1; return [p[0] + (dx / n) * grow, p[1] + (dy / n) * grow]; }; // すき間が出ないよう、ほんの少し広げる
    g.save();
    g.beginPath();
    for (const [i, p] of [ex(d0), ex(d1), ex(d2)].entries()) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
    g.closePath();
    g.clip();
    g.transform(a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]);
    g.drawImage(src, 0, 0);
    g.restore();
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
    const S = (u, v) => [u * sw, v * sh], D = (u, v) => hPt(m, u, v);
    tri(S(u0, v0), S(u1, v0), S(u0, v1), D(u0, v0), D(u1, v0), D(u0, v1));
    tri(S(u1, v0), S(u1, v1), S(u0, v1), D(u1, v0), D(u1, v1), D(u0, v1));
  }
}
// 画像のレイヤーを描く向き(元の画素 → 画面)。描くときは画素の (0, 0) から(切り取った範囲の真ん中がレイヤーの真ん中)
function layerTransform(g, L, k = st.view.k, ox = st.view.ox, oy = st.view.oy) {
  const c = cropOf(L);
  g.translate(ox + L.cx * k, oy + L.cy * k);
  g.rotate(((L.rot || 0) * Math.PI) / 180);
  g.scale((k * L.w) / c.w, (k * L.h) / c.h);
  g.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
}
function drawTextItem(g, t, k, ox, oy) {
  const L = layoutOf(t);
  g.save();
  g.translate(ox + t.x * st.W * k, oy + t.y * st.H * k);
  g.scale(k, k);
  g.rotate(((t.rot || 0) * Math.PI) / 180);
  g.globalAlpha = clamp(t.opacity ?? 1, 0, 1);
  drawTextAt(g, t, L, L.font);
  g.restore();
}
// レイヤーをすべて描く(下から順に)。k・ox・oy: キャンバスの 1px を何 px で、どこに描くか
// 下のレイヤーで切り抜く: clip = "in"(下のレイヤーの見えている部分だけ表示)/ "out"(見えている所を抜く)、clipHide = 下のレイヤーはマスクにだけ使う
const clipOf = (l) => (l?.clip === "in" || l?.clip === "out" ? l.clip : "");
// すぐ下の、切り抜かないレイヤー(そのレイヤーも抜くなら、さらに下)。無ければ -1
function clipBaseIndex(i) { for (let j = i - 1; j >= 0; j--) if (!clipOf(st.layers[j])) return j; return -1; }
// i のレイヤーを下のレイヤーにして切り抜くレイヤー(すぐ上に続く「下のレイヤーで切り抜く」)
function clipGroup(i) { const out = []; for (let j = i + 1; j < st.layers.length && clipOf(st.layers[j]); j++) out.push(st.layers[j]); return out; }
const clipHidesBase = (i) => !clipOf(st.layers[i]) && clipGroup(i).some((c) => !c.hidden && c.clipHide);
// 抜くときの作業用の canvas(描く先と同じ大きさ・同じ向き)
const clipTmp = [document.createElement("canvas"), document.createElement("canvas")];
function clipCtx(n, g) {
  const c = clipTmp[n];
  if (c.width !== g.canvas.width || c.height !== g.canvas.height) { c.width = g.canvas.width; c.height = g.canvas.height; }
  const x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = "source-over";
  x.clearRect(0, 0, c.width, c.height);
  x.setTransform(g.getTransform());
  return x;
}
// レイヤーをすべて描く(下から順に)。k・ox・oy: キャンバスの 1px を何 px で、どこに描くか
function drawLayers(g, k, ox, oy, view = false) {
  const Ls = st.layers;
  for (let i = 0; i < Ls.length; i++) {
    const l = Ls[i];
    if (clipOf(l) && clipBaseIndex(i) >= 0) continue; // 下のレイヤーと一緒に描く
    const grp = clipGroup(i);
    if (!grp.length) { if (!l.hidden) drawOne(g, l, k, ox, oy, view); continue; }
    if (!l.hidden && !clipHidesBase(i)) drawOne(g, l, k, ox, oy, view);
    const bg = clipCtx(0, g);
    if (!l.hidden) drawOne(bg, l, k, ox, oy, view);
    for (const c of grp) {
      if (c.hidden) continue;
      const cg = clipCtx(1, g);
      drawOne(cg, c, k, ox, oy, view);
      cg.setTransform(1, 0, 0, 1, 0, 0);
      cg.globalCompositeOperation = clipOf(c) === "out" ? "destination-out" : "destination-in";
      cg.drawImage(clipTmp[0], 0, 0);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.drawImage(clipTmp[1], 0, 0);
      g.restore();
    }
  }
}
// レイヤーを 1 つ描く
function drawOne(g, l, k, ox, oy, view) {
  {
    if (l.kind === "image") {
      g.save();
      g.globalAlpha = clamp(l.opacity ?? 1, 0, 1);
      // 画面で大きく拡大したときは画素が見えるように(書き出しはなめらかに)
      g.imageSmoothingEnabled = !view || (k * l.w) / cropOf(l).w < 2;
      g.imageSmoothingQuality = "high";
      if (l.warp) { // ゆがみ(ふち取りは付きません)
        g.translate(ox + l.cx * k, oy + l.cy * k);
        g.rotate(((l.rot || 0) * Math.PI) / 180);
        g.scale(k, k);
        drawWarped(g, layerPixels(l), warpQuad(l), 0.6 / k);
        g.restore();
        return;
      }
      layerTransform(g, l, k, ox, oy);
      // 切り取りの範囲を決めているレイヤーは、切り取る外も薄く見せる
      if (view && st.lcrop?.id === l.id) { g.save(); g.globalAlpha *= 0.3; g.drawImage(l.cv, 0, 0); g.restore(); }
      const olr = layerOutline(l); // ふち取り(レイヤーの後ろ)
      if (olr) g.drawImage(olr.cv, olr.x, olr.y, olr.w, olr.h);
      drawImageLocal(g, l);
      g.restore();
    } else if (l.kind === "shape") drawShape(g, l, k, ox, oy);
    else drawTextItem(g, l, k, ox, oy);
  }
}
// できあがりの画像(キャンバスの大きさ・書き出しの背景)
function renderComposite(scale = 1) {
  const c = canvasOf(Math.max(1, Math.round(st.W * scale)), Math.max(1, Math.round(st.H * scale)));
  const g = c.getContext("2d");
  const bgc = outBg();
  if (bgc) { g.fillStyle = bgc; g.fillRect(0, 0, c.width, c.height); }
  drawLayers(g, scale, 0, 0, false);
  return c;
}
// 画面の点 → キャンバスの点 / 作業する画像の画素
// 右下の表示: キャンバスの大きさ・拡大率と、カーソルの位置(アートボードの左上からの x / y)
function updZoomv() {
  const el = $('[data-c="zoomv"]');
  if (!el) return;
  if (!st.layers.length) { el.textContent = ""; return; }
  let s = `${st.W} × ${st.H}・${Math.round(st.view.k * 100)}%`;
  if (st.mouse) { const d = toDoc(st.mouse.x, st.mouse.y); s += `   x:${Math.floor(d.x)} y:${Math.floor(d.y)}`; }
  el.textContent = s;
}
const toDoc = (sx, sy) => ({ x: (sx - st.view.ox) / st.view.k, y: (sy - st.view.oy) / st.view.k });
const toImg = (sx, sy) => { const d = toDoc(sx, sy), A = activeImg(); return A ? docToLayer(A, d.x, d.y) : d; };
const panning = () => st.tool === "pan" || st.space || st.drag?.mode === "pan";

// ---------------------------------------------------------------- 画像のレイヤーを切り取る(範囲と形。元の画素は残すので、あとから変えられる)
// L.crop = { x, y, w, h(元の画素の範囲), shape, radius(角丸), points(星の角の数), feather(ふちをぼかす幅: 短い辺に対しての割合) }。無ければ全体・四角
const CROP_SHAPES = SHAPES;
const cropShapePath = (g, c) => cutShapePath(g, c);
function cropOf(L) {
  const W0 = L.cv.width, H0 = L.cv.height, c = L.crop;
  if (!c) return { x: 0, y: 0, w: W0, h: H0, shape: "rect" };
  const x = clamp(Math.round(c.x) || 0, 0, W0 - 1), y = clamp(Math.round(c.y) || 0, 0, H0 - 1);
  return { ...c, x, y, w: clamp(Math.round(c.w) || W0, 1, W0 - x), h: clamp(Math.round(c.h) || H0, 1, H0 - y), shape: c.shape || "rect" };
}
// 画像のレイヤーを描く(元の画素の向きで。切り取った範囲を、形で切り抜いて)
// ふちをぼかすときの形(白・透明度でぼかした形)。形をぼかす幅の半分だけ内へ削ってからぼかし、ふちで 0・内側へ幅 f で 1 になる。
// 大きい画像は縮めて作り(ぼかしなので細かさは要らない)、範囲と形が同じ間は作り直さない
const featherMasks = new WeakMap();
const featherTmp = document.createElement("canvas");
function cropMask(l, c) {
  const f = clamp(Number(c.feather) || 0, 0, 0.5) * featherBase(c);
  if (f < 0.5 && !c.invert) return null;
  const key = JSON.stringify([c.x, c.y, c.w, c.h, c.shape, c.radius, c.points, c.feather, !!c.invert, ...PAT_KEYS.map((k) => c[k])]);
  const hit = featherMasks.get(l);
  if (hit?.key === key) return hit.cv;
  const sc = Math.min(1, 1024 / Math.max(c.w, c.h)), mw = Math.max(1, Math.round(c.w * sc)), mh = Math.max(1, Math.round(c.h * sc));
  const m = canvasOf(mw, mh), g = m.getContext("2d", { willReadFrequently: true });
  g.scale(mw / c.w, mh / c.h);
  g.translate(-c.x, -c.y);
  cropShapePath(g, c);
  g.fillStyle = "#fff";
  g.fill();
  g.globalCompositeOperation = "destination-out";
  g.lineWidth = f;
  g.lineJoin = "round";
  if (f >= 0.5) g.stroke();
  const img = g.getImageData(0, 0, mw, mh), d = img.data;
  let a = new Float32Array(mw * mh);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  const r = Math.max(1, Math.round((f * sc) / 4));
  if (f >= 0.5) for (let i = 0; i < 3; i++) a = boxBlur(a, mw, mh, r);
  if (c.invert) for (let i = 0; i < a.length; i++) a[i] = 1 - a[i]; // 反転: 形の外側を残す
  for (let i = 0; i < a.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(clamp(a[i], 0, 1) * 255); }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "copy";
  g.putImageData(img, 0, 0);
  featherMasks.set(l, { key, cv: m });
  return m;
}
function drawImageLocal(g, l) {
  if (!l.crop) { g.drawImage(l.cv, 0, 0); return; }
  const c = cropOf(l), mask = cropMask(l, c);
  if (mask) {
    // 範囲を写してから、ぼかした形で透明にする
    if (featherTmp.width !== c.w || featherTmp.height !== c.h) { featherTmp.width = c.w; featherTmp.height = c.h; }
    const tg = featherTmp.getContext("2d");
    tg.globalCompositeOperation = "source-over";
    tg.clearRect(0, 0, c.w, c.h);
    tg.drawImage(l.cv, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    tg.globalCompositeOperation = "destination-in";
    tg.drawImage(mask, 0, 0, c.w, c.h);
    tg.globalCompositeOperation = "source-over";
    g.drawImage(featherTmp, c.x, c.y);
    return;
  }
  g.save();
  if (c.shape !== "rect") { cropShapePath(g, c); g.clip(); }
  g.drawImage(l.cv, c.x, c.y, c.w, c.h, c.x, c.y, c.w, c.h);
  g.restore();
}
// 切り取った見た目の画素(コピーなど)
function layerPixels(l) {
  if (!l.crop) return l.cv;
  const c = cropOf(l), out = canvasOf(c.w, c.h), g = out.getContext("2d");
  g.translate(-c.x, -c.y);
  drawImageLocal(g, l);
  return out;
}
// 画素 q が、切り取った範囲・形の中か
const hitG = canvasOf(1, 1).getContext("2d");
function inCrop(l, q) {
  const c = cropOf(l);
  if (q.x < c.x || q.y < c.y || q.x >= c.x + c.w || q.y >= c.y + c.h) return false;
  if (c.shape === "rect") return true;
  cropShapePath(hitG, c);
  return hitG.isPointInPath(q.x, q.y);
}
// 切り取る範囲・形を変える。絵は動かさない(レイヤーの大きさと真ん中を、範囲に合わせて動かす)
function setLayerCrop(L, nc) {
  const c0 = cropOf(L), sx = L.w / c0.w, sy = L.h / c0.h, W0 = L.cv.width, H0 = L.cv.height;
  const w = clamp(Math.round(nc.w ?? c0.w), Math.min(4, W0), W0), h = clamp(Math.round(nc.h ?? c0.h), Math.min(4, H0), H0);
  const x = clamp(Math.round(nc.x ?? c0.x), 0, W0 - w), y = clamp(Math.round(nc.y ?? c0.y), 0, H0 - h);
  const dx = (x + w / 2 - (c0.x + c0.w / 2)) * sx, dy = (y + h / 2 - (c0.y + c0.h / 2)) * sy, a = ((L.rot || 0) * Math.PI) / 180;
  L.cx += dx * Math.cos(a) - dy * Math.sin(a);
  L.cy += dx * Math.sin(a) + dy * Math.cos(a);
  L.w = w * sx; L.h = h * sy;
  const shape = nc.shape ?? c0.shape, c = { x, y, w, h, shape };
  const radius = nc.radius ?? L.crop?.radius, points = nc.points ?? L.crop?.points, feather = nc.feather ?? L.crop?.feather;
  if (radius != null) c.radius = radius;
  if (points != null) c.points = points;
  if (feather > 0) c.feather = feather;
  if (nc.invert ?? L.crop?.invert) c.invert = true; // 反転(形の外側を残す)
  for (const k of PAT_KEYS) { const v = nc[k] ?? L.crop?.[k]; if (v != null) c[k] = v; } // タイル・水玉の並べ方
  if (L.crop?.alt && !("alt" in nc)) c.alt = L.crop.alt; // 第40版の並び(行の大きさを入れたら使わない)
  // 全体・四角で、ぼかしもなければ、切り取りなし
  L.crop = x === 0 && y === 0 && w === W0 && h === H0 && shape === "rect" && !c.feather ? null : c;
}
// 比率(元の画素の幅 / 高さ)。選んだ比率は見た目の比率なので、レイヤーの縦横の伸びを戻す
function layerCropRatio(L) {
  const v = st.lcrop?.ratio || "free";
  if (v === "free") return 0;
  const c = cropOf(L);
  if (v === "orig") return L.cv.width / L.cv.height;
  const [a, b] = v.split(":").map(Number);
  return (a / b) * ((L.h / c.h) / (L.w / c.w));
}
function fitLayerCropRatio(L) {
  const r = layerCropRatio(L);
  if (!r) return;
  const c = cropOf(L);
  let w = c.w, h = c.h;
  if (w / h > r) w = h * r; else h = w / r;
  const f = Math.min(1, L.cv.width / w, L.cv.height / h);
  w *= f; h *= f;
  setLayerCrop(L, { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h });
}
// 範囲を画面で決める: 始める・終える(切り取る / やめる)
function startLayerCrop() {
  const L = selImage();
  if (!L || st.busy) return;
  endBg();
  if (st.crop) endCrop(false);
  st.lcrop = { id: L.id, before: undoSnap(), L0: { crop: L.crop, cx: L.cx, cy: L.cy, w: L.w, h: L.h } };
  if (st.tool !== "select") st.tool = "select";
  delete $('[data-c="lyinsp"]').dataset.for;
  refresh();
}
function endLayerCrop(apply) {
  const lc = st.lcrop;
  if (!lc) return;
  st.lcrop = null;
  const L = st.layers.find((l) => l.id === lc.id);
  if (L) {
    const changed = JSON.stringify(L.crop || null) !== JSON.stringify(lc.L0.crop || null);
    if (!apply) Object.assign(L, lc.L0);
    else if (changed) {
      st.undo.push(lc.before);
      if (st.undo.length > MAX_UNDO) st.undo.shift();
      st.redo = [];
      st.dirty = true;
      ctx.notify(T(L.crop ? "画像を切り取りました(元に戻せます)" : "切り取りを外しました"), "info");
    }
  }
  delete $('[data-c="lyinsp"]').dataset.for;
  refresh();
}
const lcropLayer = () => (st.lcrop ? st.layers.find((l) => l.id === st.lcrop.id) || null : null);
function placeLayerCropBox() {
  const box = $('[data-c="lcbox"]'), L = lcropLayer();
  if (!L || !st.layers.length) { box.style.display = "none"; return; }
  if (!box.firstChild) box.innerHTML = `${bboxHtml("all")}<span class="cdim"></span>`;
  const { k, ox, oy } = st.view;
  Object.assign(box.style, {
    display: "block", width: `${L.w * k}px`, height: `${L.h * k}px`,
    left: `${ox + L.cx * k - (L.w * k) / 2}px`, top: `${oy + L.cy * k - (L.h * k) / 2}px`,
    transform: Math.abs(L.rot || 0) > 0.01 ? `rotate(${L.rot}deg)` : "",
  });
  const c = cropOf(L);
  box.querySelector(".cdim").textContent = `${c.w} × ${c.h}`;
}
// 枠のドラッグ: 中で範囲を動かす・角と辺で大きさ(Shift か比率で縦横をそのまま)。絵は動かさない
function startLayerCropDrag(e) {
  const L = lcropLayer();
  if (!L) return;
  e.preventDefault();
  e.stopPropagation();
  const hd = e.target.dataset?.h || "move", c0 = cropOf(L), k = st.view.k;
  const sx = (L.w / c0.w) * k, sy = (L.h / c0.h) * k, a = (-(L.rot || 0) * Math.PI) / 180, W0 = L.cv.width, H0 = L.cv.height;
  const x0 = e.clientX, y0 = e.clientY;
  const move = (ev) => {
    const mx = ev.clientX - x0, my = ev.clientY - y0;
    // 回したレイヤーは、レイヤーの向きに直す
    const dx = (mx * Math.cos(a) - my * Math.sin(a)) / sx, dy = (mx * Math.sin(a) + my * Math.cos(a)) / sy;
    let { x, y, w, h } = c0;
    if (hd === "move") { x = clamp(x + dx, 0, W0 - w); y = clamp(y + dy, 0, H0 - h); }
    else {
      if (hd.includes("w")) { const nx = clamp(x + dx, 0, x + w - 4); w += x - nx; x = nx; }
      if (hd.includes("e")) w = clamp(w + dx, 4, W0 - x);
      if (hd.includes("n")) { const ny = clamp(y + dy, 0, y + h - 4); h += y - ny; y = ny; }
      if (hd.includes("s")) h = clamp(h + dy, 4, H0 - y);
      const r = layerCropRatio(L) || (ev.shiftKey ? c0.w / c0.h : 0);
      if (r) {
        if (hd === "n" || hd === "s") { const nw = h * r; x += (w - nw) / 2; w = nw; }
        else if (hd === "e" || hd === "w") { const nh = w / r; y += (h - nh) / 2; h = nh; }
        else if (w / h > r) { const nw = h * r; if (hd.includes("w")) x += w - nw; w = nw; }
        else { const nh = w / r; if (hd.includes("n")) y += h - nh; h = nh; }
        // 画像からはみ出すときは、比率のまま縮める
        const f = Math.min(1, W0 / w, H0 / h);
        w *= f; h *= f;
      }
    }
    setLayerCrop(L, { x, y, w, h });
    draw();
    syncLayerInsp();
  };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); renderLayers(); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
// 右の欄(選んだ画像の設定の下)
function cropInspHtml(L) {
  const c = cropOf(L), on = st.lcrop?.id === L.id;
  const ratio = (v, n) => `<option value="${v}" ${(st.lcrop?.ratio || "free") === v ? "selected" : ""}>${esc(T(n))}</option>`;
  return `<div class="lcrop"><div class="lch">${esc(T("切り取る(範囲・形)"))}</div>
    <label class="fl">${esc(T("形"))}<select data-lk="cshape">${CROP_SHAPES.map(([v, n]) => `<option value="${v}" ${v === c.shape ? "selected" : ""}>${esc(T(n))}</option>`).join("")}</select></label>
    ${c.shape === "rrect" ? lyNum("cradius", "角の丸み(%)", r1((c.radius ?? 0.25) * 100), 0, 100, 1) : ""}
    ${c.shape === "star" ? lyNum("cpoints", "星の角の数", clamp(Math.round(c.points ?? 5), 3, 12), 3, 12, 1) : ""}
    ${PATTERNS.has(c.shape) ? patInspHtml(c) : ""}
    ${lyNum("cfeather", "ぼかす幅(%)", r1((c.feather ?? 0) * 100), 0, 50, 1)}
    <label class="row" style="font-size:13px;margin-top:4px"><input type="checkbox" data-lk="cinvert" ${c.invert ? "checked" : ""}> <span>${esc(T("反転(形の外側を残す)"))}</span></label>
    <div class="row" style="margin-top:4px">${on
    ? `<button class="pri" data-la="lcropok" title="Enter">${esc(T("✂ この範囲で切り取る"))}</button><button data-la="lcropno" title="Esc">${esc(T("やめる"))}</button>`
    : `<button data-la="lcrop" title="${esc(T("画像の上の枠を動かして、切り取る範囲を決めます"))}">${esc(T("▭ 画面で範囲を指定"))}</button><button data-la="lcropoff" ${L.crop ? "" : "disabled"}>${esc(T("切り取りを外す"))}</button>`}</div>
    ${on ? `<label class="fl">${esc(T("比率"))}<select data-lk="cratio">${ratio("free", "自由")}${ratio("orig", "元の画像と同じ")}${ratio("1:1", "1:1(正方形)")}${ratio("4:3", "4:3")}${ratio("3:4", "3:4")}${ratio("16:9", "16:9")}${ratio("9:16", "9:16")}</select></label>` : ""}
    <div class="note">${esc(T("ぼかす幅: 形のふちから内側へ、だんだん透明にします(範囲の短い辺に対しての %。タイル・水玉は 1 つの大きさに対しての %。0 でくっきり)。"))}</div>
    <div class="g2">${lyNum("crx", "左(px)", c.x, 0, L.cv.width - 1, 1)}${lyNum("cry", "上(px)", c.y, 0, L.cv.height - 1, 1)}
    ${lyNum("crw", "幅(px)", c.w, 4, L.cv.width, 1)}${lyNum("crh", "高さ(px)", c.h, 4, L.cv.height, 1)}</div>
    <div class="note">${esc(T(on ? "枠の中をドラッグで範囲を動かし、角・辺で大きさを変えます(Shift で比率をそのまま)。「✂ この範囲で切り取る」(Enter)で決め、「やめる」(Esc)で前に戻ります。"
    : "形を選ぶと、その形で切り取ります(範囲いっぱいの大きさ。星やハートを整った形にするときは、範囲を 1:1 に)。左・上・幅・高さは元の画像の画素です。元の画像は残るので、あとから範囲・形を変えたり外したりできます。"))}</div></div>`;
}

// タイル・水玉の並べ方の欄
function patInspHtml(c) {
  const v = (k) => c[k] ?? PAT_DEF[k];
  return `<div class="g2">${lyNum("cpitch", "並べる間隔(%)", r1(v("pitch") * 100), 2, 100, 1)}${lyNum("cgap", "すき間(%)", r1(v("gap") * 100), -100, 95, 1)}
    ${c.shape === "tile" ? lyNum("cround", "角の丸み(%)", r1(v("round") * 100), 0, 100, 1) : ""}</div>
    ${rulesHtml(c.rules, (i, f, val, w) => `<input type="number" data-lk="crule" data-i="${i}" data-f="${f}" value="${val}" style="width:${w}px">`,
    (i) => `<button data-la="ruledel" data-i="${i}" title="${esc(T("この条件を消す"))}">✕</button>`, `<button data-la="ruleadd">＋ ${esc(T("大きさを変える条件を追加"))}</button>`, (x) => esc(T(x)))}
    <label class="row" style="font-size:13px;margin-top:4px"><input type="checkbox" data-lk="cstagger" ${v("stagger") ? "checked" : ""}> <span>${esc(T("一行おきに半分ずらす"))}</span></label>
    <div class="note">${esc(T("並べる間隔は形の短い辺に対しての %、すき間は間隔に対しての %。「大きさを変える条件」は、上から w 番目の段から x 段おき、その段の左から y 番目から z つおきの物の大きさを変えます(0 おきは毎回。0% で無し)。条件はいくつでも足せて、後の条件が優先です。"))}</div>`;
}

// ---------------------------------------------------------------- ふち取り(画像のレイヤーの不透明な所のまわりに縁を付ける)
// L.ol = { t / b / l / r(上・下・左・右の太さ: キャンバスの px。第40版の w は 4 つまとめて), blur(ぼかし: px), color, alpha(不透明度) }。太さが全部 0 で無し。
// 縁はレイヤーの向きの画素で作って覚えておき(動かす・回すだけなら作り直さない)、レイヤーと同じ向きでレイヤーの後ろに描く
const olOf = (l) => { if (l?.kind !== "image" || !l.ol) return null; const sd = outlineSides(l.ol); return Math.max(sd.t, sd.b, sd.l, sd.r) > 0 ? l.ol : null; };
const olCache = new WeakMap();
function layerOutline(l) {
  const ol = olOf(l);
  if (!ol) return null;
  const c = cropOf(l), s = Math.sqrt(Math.max(1e-6, (l.w / c.w) * (l.h / c.h))); // キャンバスの px / 元の画素
  const sc = Math.min(1, 1536 / Math.max(c.w, c.h)); // 大きい画像は縮めて作る
  const sd = outlineSides(ol, 1, 500), t = { t: (sd.t / s) * sc, b: (sd.b / s) * sc, l: (sd.l / s) * sc, r: (sd.r / s) * sc };
  const b = (clamp(Number(ol.blur) || 0, 0, 200) / s) * sc;
  const key = JSON.stringify([l.crop || null, ol, Math.round(s * 1000), Math.round(b * 20), sc, st.pxv || 0]);
  const hit = olCache.get(l);
  if (hit && hit.key === key && hit.cv === l.cv) return hit.res;
  let src = layerPixels(l);
  if (sc < 1) {
    const sm = canvasOf(Math.max(1, Math.round(c.w * sc)), Math.max(1, Math.round(c.h * sc)));
    sm.getContext("2d").drawImage(src, 0, 0, sm.width, sm.height);
    src = sm;
  }
  const o = outlineCanvas(src, t, b, ol.color || "#ffffff", clamp(Number(ol.alpha ?? 1), 0, 1));
  const kx = src.width / c.w, ky = src.height / c.h;
  const res = o ? { cv: o.cv, x: c.x - o.pad / kx, y: c.y - o.pad / ky, w: o.cv.width / kx, h: o.cv.height / ky } : null;
  olCache.set(l, { key, cv: l.cv, res });
  return res;
}
function olInspHtml(L) {
  const ol = L.ol || {}, sd = outlineSides(ol);
  return `<div class="lcrop lol"><div class="lch">${esc(T("ふち取り"))}</div>
    <div class="g2">${lyNum("olw", "太さ・上下左右まとめて(px)", r1(Math.max(sd.t, sd.b, sd.l, sd.r)), 0, 500, 1)}${lyNum("olblur", "ぼかし(px)", r1(ol.blur || 0), 0, 200, 1)}
    ${lyNum("olt", "上(px)", r1(sd.t), 0, 500, 1)}${lyNum("olb", "下(px)", r1(sd.b), 0, 500, 1)}${lyNum("oll", "左(px)", r1(sd.l), 0, 500, 1)}${lyNum("olr", "右(px)", r1(sd.r), 0, 500, 1)}
    <label class="fl">${esc(T("色"))}<input type="color" data-lk="olcolor" value="${esc(ol.color || "#ffffff")}"></label>${lyNum("olalpha", "不透明度(%)", r1((ol.alpha ?? 1) * 100), 0, 100, 1)}</div>
    <div class="note">${esc(T("画像の不透明な部分(切り抜いた形・透明にした所を除いた部分)のまわりに縁を付けます。上下左右で太さを変えられます(全部 0 で無し)。太さ・ぼかしはキャンバスの px です。"))}</div>
    <div class="row" style="margin-top:6px"><button data-la="bake" ${L.crop || olOf(L) ? "" : "disabled"} title="${esc(T("切り抜き(範囲・形・ぼかし)とふち取りを、画像の画素に適用します(元に戻せます)"))}">✔ ${esc(T("処理を適用"))}</button></div></div>`;
}

// ---------------------------------------------------------------- パスツール
// st.path = { pts: [{ x, y, hi?, ho? }](キャンバスの点。hi / ho = 入る / 出る側の曲線のハンドル [dx, dy]), closed(閉じたか) }
// クリックで点を追加・点をドラッグで移動。最初の点のクリック・ダブルクリック・Enter で閉じる。
// Alt + クリックで点を曲線にする(ハンドルを出す。もう一度で角に戻す)。ハンドルはドラッグで動かす(反対側も対称に。Alt を押しながらだと片側だけ)
const PATH_HIT = 8; // 点・ハンドルをつかめる近さ(画面の px)
const ptOf = (q) => (Array.isArray(q) ? { x: q[0], y: q[1] } : q);
// 点をつなぐ線。ハンドルがある所は曲線、無い所は直線(第41版の「なめらかにつなぐ」で作ったレイヤーは smooth で曲線にする)
function tracePts(g, P0, closed, smooth = false) {
  g.beginPath();
  const P = P0.map(ptOf), n = P.length;
  if (!n) return;
  g.moveTo(P[0].x, P[0].y);
  if (smooth && n >= 3 && !P.some((q) => q.hi || q.ho)) {
    const at = (i) => (closed ? P[(i + n) % n] : P[clamp(i, 0, n - 1)]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      g.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
    }
    if (closed) g.closePath();
    return;
  }
  const seg = (a, b) => {
    if (a.ho || b.hi) g.bezierCurveTo(a.x + (a.ho?.[0] || 0), a.y + (a.ho?.[1] || 0), b.x + (b.hi?.[0] || 0), b.y + (b.hi?.[1] || 0), b.x, b.y);
    else g.lineTo(b.x, b.y);
  };
  for (let i = 1; i < n; i++) seg(P[i - 1], P[i]);
  if (closed && n > 1) { seg(P[n - 1], P[0]); g.closePath(); }
}
// 点を fn((x, y) → [x', y'])で写す(ハンドルも先の点を写して、差に直す)
function mapPath(P, fn) {
  return P.map(ptOf).map((q) => {
    const [x, y] = fn(q.x, q.y), o = { x, y };
    for (const sd of ["hi", "ho"]) if (q[sd]) { const [hx, hy] = fn(q.x + q[sd][0], q.y + q[sd][1]); o[sd] = [hx - x, hy - y]; }
    return o;
  });
}
// 押した所: ハンドル → ハンドルを動かす / Alt + 点 → 曲線 ⇔ 角 / 最初の点 → 閉じる / 点 → 動かす / 何も無い所 → 点を足す(閉じていたら新しく始める)
// パスを変える前の形を覚える(Ctrl+Z で 1 手ずつ戻す。パスで削除・塗りつぶしなどをしたら消す)
// { t: "p", s: パスの写し } = パスの編集、{ t: "a" } = パスで行った処理(削除・塗りつぶしなど。戻すとふつうの「元に戻す」)。
// 新しい順に戻すので、処理の後に Ctrl+Z を押すと処理の前のパスの編集に戻り、続けて押すとパスを 1 手ずつ戻す
function pathSnap() {
  const s = JSON.stringify(st.path);
  st.pathUndo = st.pathUndo || [];
  const last = st.pathUndo.at(-1);
  if (!(last && last.t === "p" && last.s === s)) st.pathUndo.push({ t: "p", s });
  if (st.pathUndo.length > 300) st.pathUndo.shift();
  st.pathRedo = [];
}
function pathAct() { st.pathUndo = st.pathUndo || []; st.pathUndo.push({ t: "a" }); st.pathRedo = []; }
function pathUndoRedo(again) {
  st.pathUndo = st.pathUndo || []; st.pathRedo = st.pathRedo || [];
  const from = again ? st.pathRedo : st.pathUndo, to = again ? st.pathUndo : st.pathRedo;
  const cur = JSON.stringify(st.path);
  while (from.length && from.at(-1).t === "p" && from.at(-1).s === cur) from.pop(); // 変わらなかった手は飛ばす
  if (!from.length) return false;
  const e = from.pop();
  if (e.t === "a") { to.push(e); if (again) redo(); else undo(); return true; }
  to.push({ t: "p", s: cur });
  st.path = JSON.parse(e.s);
  st.pathSel = [];
  draw();
  return true;
}
function pathDown(p, e) {
  pathSnap();
  const { k, ox, oy } = st.view, d = toDoc(p.x, p.y);
  const P = st.path?.pts || [];
  const near = (x, y) => Math.hypot(ox + x * k - p.x, oy + y * k - p.y) <= PATH_HIT;
  for (let i = 0; i < P.length; i++) {
    for (const sd of ["hi", "ho"]) {
      const h = P[i][sd];
      if (h && near(P[i].x + h[0], P[i].y + h[1])) { st.drag = { mode: "pathh", i, sd }; return; }
    }
  }
  const i = P.findIndex((q) => near(q.x, q.y));
  if (i >= 0 && e?.altKey) { toggleCurve(i); return; }
  let sel = (st.pathSel || []).filter((j) => P[j]);
  if (i >= 0) {
    if (i === 0 && !st.path.closed && P.length >= 3 && !e?.shiftKey) st.path.closed = true;
    if (e?.shiftKey) sel = sel.includes(i) ? sel.filter((j) => j !== i) : [...sel, i]; // Shift: 選ぶ点を足す / 外す
    else if (!sel.includes(i)) sel = [i];
  } else if (nearPathLine(P, st.path?.closed, d.x, d.y, PATH_HIT / k)) sel = P.map((_, j) => j); // 線をつかむと、パス全体
  else if (st.path?.closed && (e?.ctrlKey || e?.metaKey)) { st.pathSel = []; return; } // 閉じたパスで Ctrl+クリック: 新しく作らず、未選択にする
  else {
    if (!st.path || st.path.closed) st.path = { pts: [], closed: false };
    st.path.pts.push({ x: r1(d.x), y: r1(d.y) }); // 置いてそのままドラッグすれば動かせる
    sel = [st.path.pts.length - 1];
  }
  st.pathSel = sel;
  st.drag = { mode: "pathsel", x0: d.x, y0: d.y, org: sel.map((j) => [j, st.path.pts[j].x, st.path.pts[j].y]) };
}
// 点を曲線にする(前後の点を結ぶ向きのハンドル。長さは近い方の点までの 1/3)/ 角に戻す
function toggleCurve(i) {
  const P = st.path.pts, q = P[i], n = P.length, closed = st.path.closed;
  if (q.hi || q.ho) { delete q.hi; delete q.ho; return; }
  const prev = P[i - 1] || (closed ? P[n - 1] : null), next = P[i + 1] || (closed ? P[0] : null);
  const [dx, dy] = prev && next ? [next.x - prev.x, next.y - prev.y] : next ? [next.x - q.x, next.y - q.y] : prev ? [q.x - prev.x, q.y - prev.y] : [1, 0];
  const len = Math.hypot(dx, dy) || 1;
  const dist = Math.min(prev ? Math.hypot(q.x - prev.x, q.y - prev.y) : Infinity, next ? Math.hypot(next.x - q.x, next.y - q.y) : Infinity);
  const L = (Number.isFinite(dist) ? dist : 120) / 3;
  q.ho = [r1((dx / len) * L), r1((dy / len) * L)];
  q.hi = [-q.ho[0], -q.ho[1]];
}
function pathBack() {
  if (!st.path) return;
  pathSnap();
  st.path.pts.pop();
  st.path.closed = false;
  if (!st.path.pts.length) st.path = null;
  draw();
}
// 画面にパス・点・ハンドルを描く(パスツールのときだけ)
function drawPathGuide(g) {
  const P = st.path?.pts;
  if (st.tool !== "path" || !P?.length) return;
  const { k, ox, oy } = st.view, S = mapPath(P, (x, y) => [ox + x * k, oy + y * k]);
  g.save();
  g.lineJoin = "round";
  if (S.length > 1) {
    tracePts(g, S, st.path.closed);
    g.strokeStyle = "rgba(0,0,0,0.75)"; g.lineWidth = 3; g.stroke();
    g.strokeStyle = "#ffd24d"; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]);
  }
  if (!st.path.closed && st.mouse && !panning()) {
    const L = S.at(-1);
    g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(st.mouse.x, st.mouse.y);
    g.strokeStyle = "rgba(255,210,77,0.6)"; g.lineWidth = 1; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]);
  }
  // ハンドル(点から線を出して、先に丸)
  for (const q of S) {
    for (const sd of ["hi", "ho"]) {
      if (!q[sd]) continue;
      const hx = q.x + q[sd][0], hy = q.y + q[sd][1];
      g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(hx, hy);
      g.strokeStyle = "#7bd3ff"; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.arc(hx, hy, 4, 0, Math.PI * 2);
      g.fillStyle = "#7bd3ff"; g.fill(); g.strokeStyle = "#000"; g.stroke();
    }
  }
  S.forEach((q, i) => {
    const near0 = i === 0 && !st.path.closed && S.length >= 3 && st.mouse && Math.hypot(st.mouse.x - q.x, st.mouse.y - q.y) <= PATH_HIT;
    const on = st.pathSel?.includes(i), r = on ? 6 : i === 0 ? 5 : 4;
    g.fillStyle = near0 ? "#6fe0a0" : on ? "#ff5d8f" : i === 0 ? "#ffd24d" : q.hi || q.ho ? "#7bd3ff" : "#ffffff";
    g.strokeStyle = "#000"; g.lineWidth = 1;
    g.fillRect(q.x - r, q.y - r, r * 2, r * 2);
    g.strokeRect(q.x - r + 0.5, q.y - r + 0.5, r * 2 - 1, r * 2 - 1);
  });
  g.restore();
}
// パスの内側(inside)/ 外側を、作業中の画像から削除する(境目のぼかし: キャンバスの px)
function pathErase(inside) {
  const A = activeImg();
  if (!A || A.hidden) { ctx.notify(T(A ? "作業中の画像が非表示です(一覧の 👁 で表示してください)" : "作業する画像を選んでください(「↖ 選択」で画像をクリックするか、「レイヤー」の一覧で選びます)"), "info"); return; }
  const P = st.path?.pts || [];
  if (P.length < 3) { ctx.notify(T("点を 3 つ以上置いてください"), "info"); return; }
  endBg();
  pushUndo(); // 作業中の画像の画素を写してから変える(元に戻せる)
  pathAct();
  const cv = st.img, w = cv.width, h = cv.height;
  const m = canvasOf(w, h), mg = m.getContext("2d", { willReadFrequently: true });
  tracePts(mg, mapPath(P, (x, y) => { const q = docToLayer(A, x, y); return [q.x, q.y]; }), true);
  mg.fillStyle = "#fff";
  mg.fill();
  const f = clamp(Number(st.popt.feather) || 0, 0, 200) * (cropOf(A).w / A.w); // 画像の px
  if (f >= 1) {
    const img = mg.getImageData(0, 0, w, h), d = img.data;
    let a = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    const r = Math.max(1, Math.round(f / 2));
    for (let i = 0; i < 3; i++) a = boxBlur(a, w, h, r);
    for (let i = 0; i < a.length; i++) d[i * 4 + 3] = Math.round(clamp(a[i], 0, 1) * 255);
    mg.putImageData(img, 0, 0);
  }
  const g = cv.getContext("2d");
  g.save();
  g.globalCompositeOperation = inside ? "destination-out" : "destination-in";
  g.drawImage(m, 0, 0);
  g.restore();
  st.pxv = (st.pxv || 0) + 1;
  st.dirty = true;
  refresh();
  ctx.notify(T(inside ? "パスの内側を削除しました(元に戻せます)" : "パスの外側を削除しました(元に戻せます)"), "info");
}
// 塗りつぶし(fill)/ 線を描画。どちらも新しいレイヤー(パスの図形)として追加する(あとから移動・色の変更ができる)
function pathShape(fill) {
  const P = (st.path?.pts || []).map(ptOf);
  if (P.length < (fill ? 3 : 2)) { ctx.notify(T(fill ? "点を 3 つ以上置いてください" : "点を 2 つ以上置いてください"), "info"); return; }
  const o = st.popt, a = clamp(Number(o.alpha ?? 1), 0, 1);
  const all = P.flatMap((q) => [[q.x, q.y], ...["hi", "ho"].filter((sd) => q[sd]).map((sd) => [q.x + q[sd][0], q.y + q[sd][1]])]);
  const xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
  endBg();
  pushUndo(true);
  pathAct();
  // 点はレイヤーの枠の中の割合 [x, y, 入るハンドル x, y, 出るハンドル x, y](ハンドルも割合。無ければ null)
  const nz = (v, s2) => (v == null ? null : r3(v / s2));
  st.layers.push({
    id: tuid++, kind: "shape", shape: "path", cx: x0 + w / 2, cy: y0 + h / 2, w, h, rot: 0, opacity: fill ? 1 : a, hidden: false,
    closed: fill || !!st.path.closed, fill: o.color || "#ff3b30", fillA: fill ? a : 0, stroke: o.color || "#ff3b30",
    strokeW: fill ? 0 : Math.max(0.5, Number(o.width) || 4),
    pts: P.map((q) => [r3((q.x - x0) / w), r3((q.y - y0) / h), nz(q.hi?.[0], w), nz(q.hi?.[1], h), nz(q.ho?.[0], w), nz(q.ho?.[1], h)]),
  });
  st.dirty = true;
  refresh();
  ctx.notify(T(fill ? "塗りつぶしを新しいレイヤーとして追加しました" : "線を新しいレイヤーとして追加しました"), "info");
}
// パスの図形レイヤーの点(割合)→ レイヤーの中心からの点
function shapePathPts(l) {
  return (l.pts || []).map((q) => {
    const o = { x: (q[0] - 0.5) * l.w, y: (q[1] - 0.5) * l.h };
    if (q[2] != null) o.hi = [q[2] * l.w, q[3] * l.h];
    if (q[4] != null) o.ho = [q[4] * l.w, q[5] * l.h];
    return o;
  });
}

// ---------------------------------------------------------------- 図形
const SHAPE_NAME = { rect: "四角", rrect: "角丸の四角", ellipse: "丸", tri: "三角", line: "線", arrow: "矢印", pen: "ペン", path: "パス" };
const SHAPE_ICON = { rect: "▭", rrect: "▢", ellipse: "◯", tri: "△", line: "╱", arrow: "→", pen: "✎", path: "✒" };
const isLineShape = (t) => t === "line" || t === "arrow" || t === "pen";
const hexA = (hex, a) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "") || [0, "ff", "ff", "ff"]; return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${clamp(a, 0, 1)})`; };
// 次に置く図形の見た目(最後に使ったもの。塗る図形と線で別)
function shapeStyleFor(type) {
  const base = Math.max(2, Math.round(Math.min(st.W, st.H) * 0.008));
  if (isLineShape(type)) return { fill: "#ffffff", fillA: 0, stroke: "#ff3b30", strokeW: base * 2, arrow: "end", ...(st.lineStyle || {}) };
  return { fill: "#4f8bff", fillA: 1, stroke: "#ffffff", strokeW: 0, radius: 0.25, ...(st.shapeStyle || {}) };
}
function rememberShapeStyle(l) {
  if (l.shape === "path") return; // パスの図形は、パスツールの色を使う
  const keys = ["fill", "fillA", "stroke", "strokeW", "radius", "arrow"];
  const o = Object.fromEntries(keys.filter((k) => l[k] != null).map((k) => [k, l[k]]));
  if (isLineShape(l.shape)) st.lineStyle = o; else st.shapeStyle = o;
}
// 中心 (0, 0)・回す前の大きさ w × h で、形の線を作る
function shapePath(g, l) {
  const w = l.w, h = l.h;
  g.beginPath();
  if (l.shape === "rect") g.rect(-w / 2, -h / 2, w, h);
  else if (l.shape === "rrect") {
    const r = clamp(Number(l.radius ?? 0.25), 0, 1) * Math.min(w, h) / 2;
    if (g.roundRect) g.roundRect(-w / 2, -h / 2, w, h, r); else g.rect(-w / 2, -h / 2, w, h);
  } else if (l.shape === "ellipse") g.ellipse(0, 0, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
  else if (l.shape === "tri") { g.moveTo(0, -h / 2); g.lineTo(w / 2, h / 2); g.lineTo(-w / 2, h / 2); g.closePath(); }
}
// 図形を描く。k・ox・oy: キャンバスの 1px を何 px で、どこに描くか
function drawShape(g, l, k, ox, oy) {
  g.save();
  g.globalAlpha = clamp(l.opacity ?? 1, 0, 1);
  g.lineJoin = "round";
  g.lineCap = "round";
  const sw = Math.max(0, Number(l.strokeW) || 0);
  if (l.shape === "pen") {
    const pts = l.pts || [];
    if (l._abs) { g.translate(ox, oy); g.scale(k, k); }
    else { g.translate(ox + l.cx * k, oy + l.cy * k); g.rotate(((l.rot || 0) * Math.PI) / 180); g.scale(k, k); }
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const px = l._abs ? x : (x - 0.5) * l.w, py = l._abs ? y : (y - 0.5) * l.h;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    });
    if (pts.length === 1) { const [x, y] = pts[0]; g.lineTo(l._abs ? x + 0.01 : (x - 0.5) * l.w + 0.01, l._abs ? y : (y - 0.5) * l.h); }
    g.strokeStyle = l.stroke || "#ff3b30";
    g.lineWidth = Math.max(0.5, sw);
    g.stroke();
    g.restore();
    return;
  }
  g.translate(ox + l.cx * k, oy + l.cy * k);
  g.rotate(((l.rot || 0) * Math.PI) / 180);
  g.scale(k, k);
  if (l.shape === "path") {
    // パスの図形(点はレイヤーの枠の中の割合)。閉じたものは塗り、線の太さがあれば線
    tracePts(g, shapePathPts(l), !!l.closed, !!l.smooth);
    if (l.closed && (l.fillA ?? 1) > 0) { g.fillStyle = hexA(l.fill || "#4f8bff", l.fillA ?? 1); g.fill(); }
    if (sw > 0) { g.strokeStyle = l.stroke || "#ffffff"; g.lineWidth = sw; g.stroke(); }
    g.restore();
    return;
  }
  if (l.shape === "line" || l.shape === "arrow") {
    const w = l.w, lw = Math.max(0.5, sw), head = Math.max(lw * 3, 8);
    const both = l.shape === "arrow" && l.arrow === "both", end = l.shape === "arrow";
    let x0 = -w / 2, x1 = w / 2;
    if (end) x1 -= head * 0.6;
    if (both) x0 += head * 0.6;
    g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, 0);
    g.strokeStyle = l.stroke || "#ff3b30";
    g.lineWidth = lw;
    g.stroke();
    g.fillStyle = l.stroke || "#ff3b30";
    const tip = (x, dir) => { g.beginPath(); g.moveTo(x, 0); g.lineTo(x - dir * head, -head * 0.55); g.lineTo(x - dir * head, head * 0.55); g.closePath(); g.fill(); };
    if (end) tip(w / 2, 1);
    if (both) tip(-w / 2, -1);
    g.restore();
    return;
  }
  shapePath(g, l);
  if ((l.fillA ?? 1) > 0) { g.fillStyle = hexA(l.fill || "#4f8bff", l.fillA ?? 1); g.fill(); }
  if (sw > 0) { g.strokeStyle = l.stroke || "#ffffff"; g.lineWidth = sw; g.stroke(); }
  g.restore();
}
// 図形を描き始める(ドラッグ・ペン)
function startShapeDraw(p) {
  const type = st.shapeType || "rect";
  const d0 = toDoc(p.x, p.y);
  endBg();
  pushUndo(true);
  const L = { id: tuid++, kind: "shape", shape: type, cx: d0.x, cy: d0.y, w: 1, h: 1, rot: 0, opacity: 1, hidden: false, ...shapeStyleFor(type) };
  if (type === "pen") { L.pts = [[d0.x, d0.y]]; L._abs = true; }
  st.layers.push(L);
  st.isel = L.id; st.tsel = null;
  st.drag = { mode: "shape", L, d0, moved: false };
}
function moveShapeDraw(p, ev) {
  const { L, d0 } = st.drag;
  const d = toDoc(p.x, p.y);
  let dx = d.x - d0.x, dy = d.y - d0.y;
  if (Math.hypot(dx, dy) * st.view.k > 3) st.drag.moved = true;
  if (L.shape === "pen") {
    const last = L.pts.at(-1);
    if (Math.hypot(d.x - last[0], d.y - last[1]) * st.view.k >= 1.5) L.pts.push([r1(d.x), r1(d.y)]);
    return;
  }
  if (L.shape === "line" || L.shape === "arrow") {
    let a = Math.atan2(dy, dx);
    if (ev?.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const len = Math.hypot(dx, dy);
    L.w = Math.max(1, len); L.h = Math.max(12, (L.strokeW || 4) * 4);
    L.rot = r1((a * 180) / Math.PI);
    L.cx = d0.x + (Math.cos(a) * len) / 2; L.cy = d0.y + (Math.sin(a) * len) / 2;
    return;
  }
  if (ev?.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
  L.w = Math.max(1, Math.abs(dx)); L.h = Math.max(1, Math.abs(dy));
  L.cx = d0.x + dx / 2; L.cy = d0.y + dy / 2;
}
function endShapeDraw() {
  const { L, moved } = st.drag;
  if (L.shape === "pen") {
    const xs = L.pts.map((q) => q[0]), ys = L.pts.map((q) => q[1]);
    const pad = Math.max(1, (L.strokeW || 2) / 2);
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, x1 = Math.max(...xs) + pad, y1 = Math.max(...ys) + pad;
    L.w = Math.max(1, x1 - x0); L.h = Math.max(1, y1 - y0); L.cx = (x0 + x1) / 2; L.cy = (y0 + y1) / 2;
    L.pts = L.pts.map(([x, y]) => [r3((x - x0) / L.w), r3((y - y0) / L.h)]);
    delete L._abs;
  } else if (!moved) {
    // クリックだけ: 決まった大きさで(押した所が真ん中)
    const s0 = Math.max(8, Math.round(Math.min(st.W, st.H) * 0.25));
    L.w = s0; L.h = L.shape === "line" || L.shape === "arrow" ? Math.max(12, (L.strokeW || 4) * 4) : s0;
    L.rot = 0;
  }
  st.dirty = true;
  if (L.shape !== "pen") st.tool = "select"; // ペンは続けて描ける
  refresh();
}

// ---------------------------------------------------------------- レイヤー(一覧・設定・並べ替え・選ぶ・動かす)
const lname = (l) => (l.kind === "text" ? `T ${String(l.text ?? "").split("\n")[0].slice(0, 24) || "…"}`
  : l.kind === "shape" ? (l.name || `${SHAPE_ICON[l.shape] || ""} ${T(SHAPE_NAME[l.shape] || "図形")}`) : l.name);
function selectLayer(l) {
  st.msel = [];
  if (!l) { st.isel = null; st.tsel = null; return; }
  if (l.kind === "text") { st.tsel = l.id; st.isel = null; }
  else { st.isel = l.id; if (l.kind === "image") st.aimg = l.id; st.tsel = null; }
  if (l.gid) st.msel = st.layers.filter((x) => x.gid === l.gid).map((x) => x.id);
}
// ---------------------------------------------------------------- 複数選択・グループ
// 選んでいるレイヤー(複数選択とグループの仲間も含めて、重なりの順)
function selList() {
  const ids = new Set(st.msel.length ? st.msel : [st.isel ?? st.tsel].filter((x) => x != null));
  const gids = new Set(st.layers.filter((l) => ids.has(l.id) && l.gid).map((l) => l.gid));
  return st.layers.filter((l) => ids.has(l.id) || (l.gid && gids.has(l.gid)));
}
const isMulti = () => selList().length > 1;
// Shift / Ctrl を押しながら押したレイヤーを、選ぶレイヤーに足す / 外す(グループは丸ごと)
function toggleSelect(l) {
  if (!l) return;
  const cur = selList().map((x) => x.id);
  const mates = l.gid ? st.layers.filter((x) => x.gid === l.gid).map((x) => x.id) : [l.id];
  const on = cur.includes(l.id);
  const next = on ? cur.filter((id) => !mates.includes(id)) : [...cur, ...mates.filter((id) => !cur.includes(id))];
  st.msel = next.length > 1 ? next : [];
  const prim = on ? st.layers.find((x) => x.id === next.at(-1)) : l;
  st.isel = null; st.tsel = null;
  if (prim) { if (prim.kind === "text") st.tsel = prim.id; else { st.isel = prim.id; if (prim.kind === "image") st.aimg = prim.id; } }
}
// 選んでいるレイヤーすべての、画面に沿った外側の枠(キャンバスの px)
function unionBox(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of list) {
    let cx, cy, w, h;
    if (l.kind === "text") { const L = layoutOf(l); cx = l.x * st.W; cy = l.y * st.H; w = L.w; h = L.h; } else ({ cx, cy, w, h } = l);
    const b = rotatedBounds(cx, cy, w, h, l.rot || 0);
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
// まとめて動かす・大きさを変える(角: 縦横そろえて、辺: その向きだけ。真ん中を中心に)
function startMultiDrag(e) {
  const list = selList();
  const u = unionBox(list);
  if (!u || st.busy) return;
  const k = st.view.k, W = st.W, H = st.H;
  const L0 = list.map((l) => ({ l, cx: l.cx, cy: l.cy, w: l.w, h: l.h, x: l.x, y: l.y, size: l.size, strokeW: l.strokeW }));
  const ucx = (u.x0 + u.x1) / 2, ucy = (u.y0 + u.y1) / 2;
  const cr = $(".stage > canvas").getBoundingClientRect(), { ox, oy } = st.view;
  const box0 = { x0: cr.left + ox + u.x0 * k, y0: cr.top + oy + u.y0 * k, x1: cr.left + ox + u.x1 * k, y1: cr.top + oy + u.y1 * k };
  const ids = new Set(list.map((l) => l.id));
  const rects = [{ x0: cr.left + ox, y0: cr.top + oy, x1: cr.left + ox + W * k, y1: cr.top + oy + H * k }];
  for (const l of st.layers) if (!ids.has(l.id) && !l.hidden) rects.push(objScreenBounds(l));
  const lines = snapLines(rects);
  let pushed = false;
  bboxDrag(e, {
    cx: (box0.x0 + box0.x1) / 2, cy: (box0.y0 + box0.y1) / 2, w: box0.x1 - box0.x0, h: box0.y1 - box0.y0, rot: 0, handle: e.target.dataset?.h || "move",
    onMove: (res, ev) => {
      if (res.rot != null) return; // まとめて回すことはしない
      if (!pushed) { pushUndo(true); pushed = true; }
      res = snapRes(res, ev, box0, lines, 0);
      let sx = 1, sy = 1, dx = 0, dy = 0;
      if (res.dx != null) { dx = res.dx / k; dy = res.dy / k; }
      else if (res.k != null) { sx = sy = res.k; }
      else if (res.w != null) sx = res.w / (box0.x1 - box0.x0);
      else if (res.h != null) sy = res.h / (box0.y1 - box0.y0);
      const mcx = ucx + (res.dcx || 0) / k, mcy = ucy + (res.dcy || 0) / k; // 止める所を動かさないための中心の移動
      for (const o of L0) {
        const l = o.l;
        if (l.kind === "text") {
          const px = mcx + (o.x * W - ucx) * sx + dx, py = mcy + (o.y * H - ucy) * sy + dy;
          l.x = r3(px / W); l.y = r3(py / H);
          if (res.k != null) l.size = r3(clamp(o.size * res.k, 0.005, 1));
        } else {
          l.cx = r1(mcx + (o.cx - ucx) * sx + dx); l.cy = r1(mcy + (o.cy - ucy) * sy + dy);
          l.w = Math.max(1, o.w * sx); l.h = Math.max(1, o.h * sy);
          if (res.k != null && l.kind === "shape" && isLineShape(l.shape)) l.strokeW = r1(Math.max(0.5, (o.strokeW || 1) * res.k));
        }
      }
      st.dirty = true;
      draw();
      syncLayerInsp();
    },
    onEnd: () => { showSnapGuides($(".stage"), null); refresh(); },
  });
}
// 方向キーで動かす(Shift で 5 倍)。続けて押した分は、元に戻すを 1 回にまとめる
function nudge(dx, dy) {
  const list = selList();
  if (!list.length || st.busy) return false;
  const now = Date.now();
  if (!st.nudgeAt || now - st.nudgeAt > 800) pushUndo(true);
  st.nudgeAt = now;
  for (const l of list) {
    if (l.kind === "text") { l.x = r3(l.x + dx / st.W); l.y = r3(l.y + dy / st.H); } else { l.cx = r1(l.cx + dx); l.cy = r1(l.cy + dy); }
  }
  st.dirty = true;
  draw();
  syncLayerInsp();
  syncTextInsp?.();
  return true;
}
// グループにする / 解く
function groupSel(on) {
  const list = selList();
  if (on && list.length < 2) { ctx.notify(T("グループにするレイヤーを 2 つ以上選んでください(Shift / Ctrl を押しながら押す)"), "info"); return; }
  if (!on && !list.some((l) => l.gid)) return;
  endBg();
  pushUndo(true);
  if (on) {
    const gid = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    // 重なりの順で、いちばん上のレイヤーの所にまとめる
    const top = Math.max(...list.map((l) => st.layers.indexOf(l)));
    const rest = st.layers.filter((l) => !list.includes(l));
    const at = rest.indexOf(st.layers.slice(0, top + 1).filter((l) => !list.includes(l)).at(-1)) + 1;
    for (const l of list) l.gid = gid;
    rest.splice(at, 0, ...list);
    st.layers = rest;
    st.msel = list.map((l) => l.id);
  } else {
    for (const l of list) delete l.gid;
  }
  st.dirty = true;
  refresh();
  ctx.notify(T(on ? "グループにしました(押すとまとめて選びます)" : "グループを解きました"), "info");
}
// コピー / 貼り付け(画像・図形・文字。画像は画素ごと写す)
let objClip = null;
function copyObjects(cut = false) {
  const list = selList();
  if (!list.length) return false;
  if (list.length === 1 && list[0].kind === "text") return copyText(cut); // 文字 1 つは、動画編集とも行き来できる形で
  objClip = list.map((l) => (l.kind === "image" ? { ...l, cv: copyCanvas(l.cv), orig: copyCanvas(l.orig), paint: null } : JSON.parse(JSON.stringify(l))));
  clipboard.set({ type: "imgobjs", from: "img", n: objClip.length });
  if (cut) {
    endBg();
    pushUndo(true);
    const ids = new Set(list.map((l) => l.id));
    st.layers = st.layers.filter((l) => !ids.has(l.id));
    if (ids.has(st.aimg)) st.aimg = imageLayers().at(-1)?.id ?? null;
    selectLayer(null);
    st.dirty = true;
    refresh();
  }
  ctx.notify(cut ? "切り取りました(Ctrl+V で貼り付け)" : "コピーしました(Ctrl+V で貼り付け)", "info");
  return true;
}
function pasteObjects() {
  const c = clipboard.get();
  if (c?.type !== "imgobjs" || !objClip?.length) return pasteText();
  if (!st.layers.length || st.busy) return false;
  endBg();
  pushUndo(true);
  const gmap = new Map();
  const made = objClip.map((o) => {
    const n = o.kind === "image"
      ? { ...o, id: tuid++, cv: copyCanvas(o.cv), orig: copyCanvas(o.orig), paint: canvasOf(o.cv.width, o.cv.height), cx: o.cx + 16, cy: o.cy + 16, name: T("{0} のコピー", o.name) }
      : o.kind === "text" ? { ...JSON.parse(JSON.stringify(o)), id: tuid++, x: r3(o.x + 0.03), y: r3(o.y + 0.03) }
        : { ...JSON.parse(JSON.stringify(o)), id: tuid++, cx: o.cx + 16, cy: o.cy + 16 };
    if (o.gid) { if (!gmap.has(o.gid)) gmap.set(o.gid, `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`); n.gid = gmap.get(o.gid); }
    return n;
  });
  // 次に貼るときは、さらにずらす
  objClip = objClip.map((o) => (o.kind === "text" ? { ...o, x: r3(o.x + 0.03), y: r3(o.y + 0.03) } : { ...o, cx: o.cx + 16, cy: o.cy + 16 }));
  st.layers.push(...made);
  selectLayer(made[0]);
  st.msel = made.length > 1 ? made.map((l) => l.id) : [];
  st.tool = "select";
  st.dirty = true;
  refresh();
  ctx.notify("貼り付けました", "info");
  return true;
}
// コピーの印(クリップボードに入れる文字)。copy イベントで入れる
function clipMark() { st.clipMark = `cca-imgedit:${Date.now().toString(36)}`; }
// 選んでいるレイヤーを消す(複数・グループも)
function deleteSel() {
  const list = selList();
  if (!list.length || st.busy) return false;
  endBg();
  pushUndo(true);
  const ids = new Set(list.map((l) => l.id));
  st.layers = st.layers.filter((l) => !ids.has(l.id));
  if (ids.has(st.aimg)) st.aimg = imageLayers().at(-1)?.id ?? null;
  selectLayer(null);
  st.dirty = true;
  refresh();
  return true;
}
function renderLayers() {
  const box = $('[data-c="lylist"]');
  const sel = st.isel ?? st.tsel;
  const sids = new Set(selList().map((l) => l.id));
  const gno = new Map();
  for (const l of st.layers) if (l.gid && !gno.has(l.gid)) gno.set(l.gid, gno.size + 1);
  const clipped = new Set(st.layers.filter((l, i) => clipOf(l) && clipBaseIndex(i) >= 0).map((l) => l.id));
  box.innerHTML = [...st.layers].reverse().map((l) => `<div class="ly${sids.has(l.id) ? " sel" : ""}${l.hidden ? " hid" : ""}${l.gid ? " grp" : ""}" data-lid="${l.id}" draggable="true"${l.gid ? ` style="--g:${(gno.get(l.gid) * 67) % 360}"` : ""}>
      <button data-lv="${l.id}" title="${esc(T(l.hidden ? "見せる" : "隠す"))}">${l.hidden ? "◌" : "👁"}</button>
      ${l.kind !== "text" ? `<canvas class="th" width="34" height="24"></canvas>` : `<span class="th tt">T</span>`}
      <span class="ln" title="${esc(lname(l))}">${clipped.has(l.id) ? `<b class="ctag" title="${esc(T("下のレイヤーで切り抜く"))}">↳</b> ` : ""}${l.gid ? `<b class="gtag">⛓${gno.get(l.gid)}</b> ` : ""}${esc(lname(l))}</span>${l.kind === "image" && l.id === st.aimg ? `<span class="act" title="${esc(T("消しゴム・背景を消す・オブジェクト除去などは、この画像に掛かります"))}">${esc(T("✎ 作業中"))}</span>` : ""}</div>`).join("")
    || `<div class="note">${esc(T("まだ何もありません"))}</div>`;
  for (const c of box.querySelectorAll("canvas.th")) {
    const l = st.layers.find((x) => x.id === Number(c.closest("[data-lid]").dataset.lid));
    if (l?.kind === "shape") {
      const kk = Math.min((c.width - 4) / Math.max(1, l.w), (c.height - 4) / Math.max(1, l.h));
      drawShape(c.getContext("2d"), { ...l, cx: 0, cy: 0, rot: 0, opacity: 1, strokeW: Math.max((l.strokeW || 0), 1.5 / kk) }, kk, c.width / 2, c.height / 2);
      continue;
    }
    if (!l?.cv) continue;
    const g = c.getContext("2d"), cc = cropOf(l), k = Math.min(c.width / cc.w, c.height / cc.h);
    g.translate((c.width - cc.w * k) / 2, (c.height - cc.h * k) / 2);
    g.scale(k, k);
    g.translate(-cc.x, -cc.y);
    drawImageLocal(g, l);
  }
  for (const b of $$("[data-lo]")) b.disabled = sel == null || st.busy;
  const gb = $('[data-lo="group"]'), ub = $('[data-lo="ungroup"]');
  if (gb) gb.disabled = sids.size < 2 || st.busy;
  if (ub) ub.disabled = ![...st.layers].some((l) => sids.has(l.id) && l.gid) || st.busy;
  $('[data-c="msel"]').textContent = sids.size > 1 ? T("{0} 個を選んでいます(まとめて動かす・大きさ・方向キー・コピー・消す)", sids.size) : "";
  renderLayerInsp();
  renderClipBox();
}
// 下のレイヤーで切り抜く(選んだレイヤー 1 つ。画像・図形・文字)
function renderClipBox() {
  const box = $('[data-c="lyclip"]');
  if (!box) return;
  const id = isMulti() ? null : (st.isel ?? st.tsel);
  const i = st.layers.findIndex((l) => l.id === id);
  if (i < 0) { box.innerHTML = ""; delete box.dataset.for; return; }
  const l = st.layers[i], c = clipOf(l);
  if (box.contains(document.activeElement) && box.dataset.for === String(l.id)) return;
  box.dataset.for = String(l.id);
  const opt = (v, n) => `<option value="${v}" ${c === v ? "selected" : ""}>${esc(T(n))}</option>`;
  box.innerHTML = `<div class="lcrop lclip"><div class="lch">${esc(T("下のレイヤーで切り抜く"))}</div>
    <label class="fl">${esc(T("抜き方"))}<select data-cl="clip" ${i === 0 ? "disabled" : ""}>${opt("", "使わない")}${opt("in", "下のレイヤーの見えている部分だけ表示")}${opt("out", "下のレイヤーの見えている部分を除外")}</select></label>
    <label class="row" style="font-size:13px;margin-top:4px"><input type="checkbox" data-cl="hide" ${l.clipHide ? "checked" : ""} ${c && i > 0 ? "" : "disabled"}> <span>${esc(T("下のレイヤーはマスクにだけ使う(見せない)"))}</span></label>
    <div class="note">${esc(T(i === 0 ? "いちばん下のレイヤーには使えません(下にレイヤーがありません)。" : "すぐ下のレイヤー(下のレイヤーも「下のレイヤーで切り抜く」なら、さらに下)の、透明でない所を使います。一覧では ↳ が付きます。"))}</div></div>`;
}
function onClipInput(e) {
  const el = e.target, id = st.isel ?? st.tsel, l = st.layers.find((x) => x.id === id);
  if (!l || !el.dataset.cl) return;
  pushUndo(true);
  if (el.dataset.cl === "clip") { if (el.value === "in" || el.value === "out") l.clip = el.value; else { delete l.clip; delete l.clipHide; } }
  else if (el.checked) l.clipHide = true; else delete l.clipHide;
  st.dirty = true;
  delete $('[data-c="lyclip"]').dataset.for;
  refresh();
}
const lyNum = (k, label, v, min, max, step) => `<label class="fl">${esc(T(label))}<input type="number" data-lk="${k}" value="${v}" min="${min}" max="${max}" step="${step}"></label>`;
function renderLayerInsp() {
  const box = $('[data-c="lyinsp"]');
  const L = selObj();
  if (!L) { box.innerHTML = ""; delete box.dataset.for; return; }
  if (box.contains(document.activeElement) && box.dataset.for === String(L.id)) { syncLayerInsp(); return; }
  box.dataset.for = String(L.id);
  box.innerHTML = `<label class="fl">${esc(T("名前"))}<input type="text" data-lk="name" value="${esc(L.name)}"></label>
    <div class="g2">${lyNum("x", "左(px)", r1(L.cx - L.w / 2), -100000, 100000, 1)}${lyNum("y", "上(px)", r1(L.cy - L.h / 2), -100000, 100000, 1)}
    ${lyNum("w", "幅(px)", r1(L.w), 1, 100000, 1)}${lyNum("h", "高さ(px)", r1(L.h), 1, 100000, 1)}
    ${lyNum("rot", "回転(度)", r1(L.rot || 0), -3600, 3600, 1)}${lyNum("opacity", "不透明度(%)", r1((L.opacity ?? 1) * 100), 0, 100, 1)}</div>
    <label class="row" style="font-size:13px;margin-top:4px"><input type="checkbox" data-lk="keep" ${st.keepRatio !== false ? "checked" : ""}> <span>${esc(T("幅・高さを変えるとき、縦横比を保つ"))}</span></label>
    ${L.kind === "shape" ? shapeInspHtml(L) : `<div class="row" style="margin-top:4px"><button data-la="fit" title="${esc(T("縦横比を保って、キャンバスに収まる大きさで真ん中に"))}">${esc(T("キャンバスに収める"))}</button>
      <button data-la="cover" title="${esc(T("縦横比を保って、キャンバスをすき間なく覆う大きさで真ん中に"))}">${esc(T("キャンバスいっぱい"))}</button>
      <button data-la="one" title="${esc(T("画像の画素 1 つをキャンバスの 1px に"))}">${esc(T("元の大きさ"))}</button>${L.warp ? `<button data-la="bakewarp" title="${esc(T("ゆがんだ形を画像の画素にして、ふつうの四角いレイヤーに戻します(元に戻せます)"))}">${esc(T("変形を適用"))}</button><button data-la="unwarp">${esc(T("ゆがみを戻す"))}</button>` : ""}</div>
    <div class="note">${esc(T("Ctrl を押しながら枠の辺をドラッグすると、その辺を自由に動かして画像をゆがめられます(Photoshop の「ゆがみ」と同じ)。"))}</div>
    <div class="note">${esc(T("元の画素の大きさ: {0} × {1}", L.cv.width, L.cv.height))}</div>${cropInspHtml(L)}${olInspHtml(L)}`}`;
}
// 図形の見た目(塗り・線・角の丸み・矢印)
function shapeInspHtml(L) {
  const line = isLineShape(L.shape) || (L.shape === "path" && !L.closed);
  return `<div class="g2">${line ? "" : `<label class="fl">${esc(T("塗りの色"))}<input type="color" data-lk="fill" value="${esc(L.fill || "#4f8bff")}"></label>
      ${lyNum("fillA", "塗りの濃さ(%)", r1((L.fillA ?? 1) * 100), 0, 100, 1)}`}
    <label class="fl">${esc(T(line ? "線の色" : "縁の色"))}<input type="color" data-lk="stroke" value="${esc(L.stroke || "#ffffff")}"></label>
    ${lyNum("strokeW", line ? "線の太さ(px)" : "縁の太さ(px)", r1(L.strokeW || 0), 0, 1000, 0.5)}
    ${L.shape === "rrect" ? lyNum("radius", "角の丸み(%)", r1((L.radius ?? 0.25) * 100), 0, 100, 1) : ""}
    ${L.shape === "arrow" ? `<label class="fl">${esc(T("矢印"))}<select data-lk="arrow"><option value="end" ${L.arrow !== "both" ? "selected" : ""}>${esc(T("片方"))}</option><option value="both" ${L.arrow === "both" ? "selected" : ""}>${esc(T("両方"))}</option></select></label>` : ""}</div>
    <div class="note">${esc(T(line ? "線の太さを 0 にはできません(細くしたいときは 1 など)。" : "塗りの濃さ 0% で枠だけ、縁の太さ 0 で縁なし。"))}</div>`;
}
function syncLayerInsp() {
  const L = selObj();
  if (!L) return;
  const v = { name: L.name ?? "", x: r1(L.cx - L.w / 2), y: r1(L.cy - L.h / 2), w: r1(L.w), h: r1(L.h), rot: r1(L.rot || 0), opacity: r1((L.opacity ?? 1) * 100) };
  if (L.kind === "image") {
    const c = cropOf(L), sd = outlineSides(L.ol || {});
    Object.assign(v, { crx: c.x, cry: c.y, crw: c.w, crh: c.h, olt: r1(sd.t), olb: r1(sd.b), oll: r1(sd.l), olr: r1(sd.r), olw: r1(Math.max(sd.t, sd.b, sd.l, sd.r)) });
  }
  for (const el of $('[data-c="lyinsp"]').querySelectorAll("[data-lk]")) {
    if (el === document.activeElement || !(el.dataset.lk in v)) continue;
    el.value = v[el.dataset.lk];
  }
}
function onLayerInput(e) {
  const el = e.target, L = selObj(), k = el.dataset.lk;
  if (!L || !k) return;
  if (k === "keep") { st.keepRatio = el.checked; return; }
  if (k === "cratio") { if (st.lcrop) st.lcrop.ratio = el.value; fitLayerCropRatio(L); draw(); syncLayerInsp(); return; }
  const cropKey = /^(cshape|cradius|cpoints|cfeather|crx|cry|crw|crh|cpitch|cgap|codd|ceven|crodd|creven|cround|calt|cstagger|crule|cinvert)$/.test(k);
  // 1 つの欄を打っている間は 1 回で元に戻せるように、最初の変更のときだけ覚える(範囲を画面で決めている間は、決めたときに 1 回)
  if (st.lyEditEl !== el && !(cropKey && st.lcrop)) { pushUndo(true); st.lyEditEl = el; }
  // 切り取る(範囲・形)
  if (cropKey) {
    if (L.kind !== "image") return;
    const c = cropOf(L);
    if (k === "cshape") {
      setLayerCrop(L, { shape: CROP_SHAPES.some(([s]) => s === el.value) ? el.value : "rect" });
      delete $('[data-c="lyinsp"]').dataset.for; // 形で増える欄(角の丸み・星の角の数)があるので作り直す
    } else if (k === "calt") { setLayerCrop(L, { alt: el.value === "check" ? "check" : "col" }); delete $('[data-c="lyinsp"]').dataset.for; renderLayerInsp(); }
    else if (k === "cstagger") setLayerCrop(L, { stagger: el.checked });
    else if (k === "cinvert") setLayerCrop(L, { invert: el.checked });
    else if (k === "crule") { if (el.value !== "") setLayerCrop(L, { rules: setRule(c.rules, Number(el.dataset.i), Number(el.dataset.f), el.value) }); }
    else {
      const n = Number(el.value);
      if (el.value === "" || Number.isNaN(n)) return;
      if (k === "cradius") setLayerCrop(L, { radius: clamp(n, 0, 100) / 100 });
      else if (k === "cpoints") setLayerCrop(L, { points: clamp(Math.round(n), 3, 12) });
      else if (k === "cfeather") setLayerCrop(L, { feather: clamp(n, 0, 50) / 100 });
      else if (k === "cpitch") setLayerCrop(L, { pitch: clamp(n, 2, 100) / 100 });
      else if (k === "cgap") setLayerCrop(L, { gap: clamp(n, -100, 95) / 100 });
      else if (k === "codd") setLayerCrop(L, { odd: clamp(n, 0, 200) / 100 });
      else if (k === "ceven") setLayerCrop(L, { even: clamp(n, 0, 200) / 100 });
      else if (k === "crodd") setLayerCrop(L, { rodd: clamp(n, 0, 200) / 100, alt: undefined });
      else if (k === "creven") setLayerCrop(L, { reven: clamp(n, 0, 200) / 100, alt: undefined });
      else if (k === "cround") setLayerCrop(L, { round: clamp(n, 0, 100) / 100 });
      else setLayerCrop(L, { x: k === "crx" ? n : c.x, y: k === "cry" ? n : c.y, w: k === "crw" ? n : c.w, h: k === "crh" ? n : c.h });
    }
    st.dirty = true;
    renderLayers();
    draw();
    syncLayerInsp();
    return;
  }
  // ふち取り
  if (/^ol(w|t|b|l|r|blur|color|alpha)$/.test(k)) {
    if (L.kind !== "image") return;
    const ol = { blur: 0, color: "#ffffff", alpha: 1, ...(L.ol || {}), ...outlineSides(L.ol || {}) };
    delete ol.w;
    if (k === "olcolor") ol.color = el.value;
    else {
      const n = Number(el.value);
      if (el.value === "" || Number.isNaN(n)) return;
      if (k === "olw") { const v = clamp(n, 0, 500); Object.assign(ol, { t: v, b: v, l: v, r: v }); }
      else if (/^ol[tblr]$/.test(k)) ol[k.slice(2)] = clamp(n, 0, 500);
      else if (k === "olblur") ol.blur = clamp(n, 0, 200);
      else ol.alpha = clamp(n, 0, 100) / 100;
    }
    L.ol = ol;
    st.dirty = true;
    draw();
    renderLayers();
    syncLayerInsp();
    return;
  }
  if (k === "name") { L.name = el.value.slice(0, 80); renderLayers(); st.dirty = true; return; }
  // 図形の見た目
  if (k === "fill" || k === "stroke" || k === "arrow") { L[k] = el.value; rememberShapeStyle(L); st.dirty = true; draw(); renderLayers(); return; }
  if (k === "fillA" || k === "strokeW" || k === "radius") {
    const n2 = Number(el.value);
    if (el.value === "" || Number.isNaN(n2)) return;
    L[k] = k === "strokeW" ? Math.max(isLineShape(L.shape) || (L.shape === "path" && !L.closed) ? 0.5 : 0, n2) : clamp(n2, 0, 100) / 100;
    rememberShapeStyle(L);
    st.dirty = true; draw(); renderLayers(); return;
  }
  const n = Number(el.value);
  if (el.value === "" || Number.isNaN(n)) return;
  const left = L.cx - L.w / 2, top = L.cy - L.h / 2, keep = st.keepRatio !== false;
  if (k === "x") L.cx = n + L.w / 2;
  else if (k === "y") L.cy = n + L.h / 2;
  else if (k === "w") { const w = Math.max(1, n); if (keep) L.h = (L.h * w) / L.w; L.w = w; L.cx = left + L.w / 2; L.cy = top + L.h / 2; }
  else if (k === "h") { const h = Math.max(1, n); if (keep) L.w = (L.w * h) / L.h; L.h = h; L.cx = left + L.w / 2; L.cy = top + L.h / 2; }
  else if (k === "rot") L.rot = clamp(n, -3600, 3600);
  else if (k === "opacity") L.opacity = clamp(n, 0, 100) / 100;
  st.dirty = true;
  draw();
  syncLayerInsp();
}
function layerAction(a) {
  const L = selImage();
  if (!L) return;
  if (a === "lcrop") { if (st.lcrop) endLayerCrop(true); else startLayerCrop(); return; }
  if (a === "lcropok" || a === "lcropno") { endLayerCrop(a === "lcropok"); return; }
  if (a === "bake") { bakeLayer(L); return; }
  if (a === "bakewarp") { bakeWarp(selObj()); return; }
  if (a === "unwarp") { pushUndo(true); delete L.warp; st.dirty = true; delete $('[data-c="lyinsp"]').dataset.for; refresh(); return; }
  if (a === "ruleadd" || a === "ruledel") { // 大きさを変える条件を足す / 消す
    const btn = document.activeElement?.closest?.("[data-la]") || null;
    pushUndo(true);
    const c = cropOf(L), i = Number(btn?.dataset.i ?? -1);
    setLayerCrop(L, { rules: a === "ruleadd" ? addRule(c.rules) : (c.rules || []).filter((_, j) => j !== i) });
    delete $('[data-c="lyinsp"]').dataset.for; // 欄の数が変わるので作り直す
    renderLayerInsp();
    draw();
    return;
  }
  if (a === "lcropoff") {
    if (!L.crop) return;
    pushUndo(true);
    setLayerCrop(L, { x: 0, y: 0, w: L.cv.width, h: L.cv.height, shape: "rect", feather: 0 });
    st.dirty = true;
    delete $('[data-c="lyinsp"]').dataset.for;
    refresh();
    return;
  }
  pushUndo(true);
  const { w: cw, h: ch } = cropOf(L); // 切り取ったときは、切り取った範囲の大きさで
  if (a === "fit" || a === "cover") {
    const k = (a === "fit" ? Math.min : Math.max)(st.W / cw, st.H / ch);
    L.w = r3(cw * k); L.h = r3(ch * k); L.cx = st.W / 2; L.cy = st.H / 2; L.rot = 0;
  } else if (a === "one") { L.w = cw; L.h = ch; }
  st.dirty = true;
  refresh();
}
// 処理を適用: 切り抜き(範囲・形・ぼかし)とふち取りを、画像の画素にする(レイヤーの見た目はそのまま。元に戻せる)
function bakeLayer(L) {
  if (!L || L.kind !== "image" || (!L.crop && !olOf(L))) { ctx.notify(T("適用する処理がありません"), "info"); return; }
  endBg();
  const c = cropOf(L), olr = layerOutline(L);
  const x0 = Math.floor(olr ? Math.min(c.x, olr.x) : c.x), y0 = Math.floor(olr ? Math.min(c.y, olr.y) : c.y);
  const x1 = Math.ceil(olr ? Math.max(c.x + c.w, olr.x + olr.w) : c.x + c.w), y1 = Math.ceil(olr ? Math.max(c.y + c.h, olr.y + olr.h) : c.y + c.h);
  const W2 = Math.max(1, x1 - x0), H2 = Math.max(1, y1 - y0);
  const out = canvasOf(W2, H2), g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.translate(-x0, -y0);
  if (olr) g.drawImage(olr.cv, olr.x, olr.y, olr.w, olr.h);
  drawImageLocal(g, L);
  pushUndo(true); // 元に戻すと、前の画素・切り抜き・ふち取りに戻る
  const sx = L.w / c.w, sy = L.h / c.h, a = ((L.rot || 0) * Math.PI) / 180;
  const dx = (x0 + W2 / 2 - (c.x + c.w / 2)) * sx, dy = (y0 + H2 / 2 - (c.y + c.h / 2)) * sy;
  L.cx += dx * Math.cos(a) - dy * Math.sin(a);
  L.cy += dx * Math.sin(a) + dy * Math.cos(a);
  L.w = W2 * sx; L.h = H2 * sy;
  L.cv = out; L.orig = copyCanvas(out); L.paint = canvasOf(W2, H2);
  delete L.crop; delete L.ol;
  st.pxv = (st.pxv || 0) + 1;
  st.dirty = true;
  delete $('[data-c="lyinsp"]').dataset.for;
  refresh();
  ctx.notify(T("切り抜き・ふち取りを画像に適用しました(元に戻せます)"), "info");
}
// 変形を適用: ゆがんだ形を画像の画素にして、ふつうの四角いレイヤーに戻す(元に戻せる)
function bakeWarp(L) {
  if (!L || L.kind !== "image" || !L.warp) { ctx.notify(T("適用する変形がありません"), "info"); return; }
  endBg();
  const src = layerPixels(L), q = warpQuad(L);
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let s = Math.max(src.width / L.w, src.height / L.h); // 元の画素の細かさを保つ
  const lim = 8192 / Math.max(1e-6, x1 - x0, y1 - y0);
  s = Math.min(s, lim);
  const W2 = Math.max(1, Math.ceil((x1 - x0) * s)), H2 = Math.max(1, Math.ceil((y1 - y0) * s));
  const out = canvasOf(W2, H2), g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.scale(W2 / (x1 - x0), H2 / (y1 - y0));
  g.translate(-x0, -y0);
  drawWarped(g, src, q, 0.6 / s);
  pushUndo(true);
  const a = ((L.rot || 0) * Math.PI) / 180, dx = (x0 + x1) / 2, dy = (y0 + y1) / 2; // 新しい中心(回す前の座標)
  L.cx += dx * Math.cos(a) - dy * Math.sin(a);
  L.cy += dx * Math.sin(a) + dy * Math.cos(a);
  L.w = x1 - x0; L.h = y1 - y0;
  L.cv = out; L.orig = copyCanvas(out); L.paint = canvasOf(W2, H2);
  delete L.crop; delete L.warp;
  st.pxv = (st.pxv || 0) + 1;
  st.dirty = true;
  delete $('[data-c="lyinsp"]').dataset.for;
  refresh();
  ctx.notify(T("変形を画像に適用しました(元に戻せます)"), "info");
}
// 並べ替え・複製・消す(選んだレイヤー)
function layerOp(op) {
  if (op === "group" || op === "ungroup") { groupSel(op === "group"); return; }
  if (isMulti()) { multiOp(op); return; }
  const id = st.isel ?? st.tsel;
  const i = st.layers.findIndex((l) => l.id === id);
  if (i < 0 || st.busy) return;
  endBg();
  pushUndo(true);
  const arr = st.layers, [l] = arr.splice(i, 1);
  if (op === "top") arr.push(l);
  else if (op === "bottom") arr.unshift(l);
  else if (op === "up") arr.splice(Math.min(arr.length, i + 1), 0, l);
  else if (op === "down") arr.splice(Math.max(0, i - 1), 0, l);
  else if (op === "dup") {
    arr.splice(i, 0, l);
    const c = l.kind === "image"
      ? { ...l, id: tuid++, cv: copyCanvas(l.cv), orig: copyCanvas(l.orig), paint: canvasOf(l.cv.width, l.cv.height), cx: l.cx + 16, cy: l.cy + 16, name: T("{0} のコピー", l.name) }
      : l.kind === "shape" ? { ...JSON.parse(JSON.stringify(l)), id: tuid++, cx: l.cx + 16, cy: l.cy + 16 }
        : { ...JSON.parse(JSON.stringify(l)), id: tuid++, x: r3(l.x + 0.03), y: r3(l.y + 0.03) };
    arr.splice(i + 1, 0, c);
    selectLayer(c);
  } else if (op === "del") {
    if (l.id === st.aimg) st.aimg = imageLayers().at(-1)?.id ?? null;
    st.isel = null; st.tsel = null;
  }
  st.dirty = true;
  refresh();
}
// 複数(グループ)の並べ替え・複製・消す: ひとかたまりで動かす
function multiOp(op) {
  const list = selList();
  if (!list.length || st.busy) return;
  if (op === "del") { deleteSel(); return; }
  if (op === "dup") { const keep = objClip; copyObjects(); pasteObjects(); objClip = keep; return; }
  endBg();
  pushUndo(true);
  const rest = st.layers.filter((l) => !list.includes(l));
  const first = st.layers.indexOf(list[0]), last = st.layers.indexOf(list.at(-1));
  let at;
  if (op === "top") at = rest.length;
  else if (op === "bottom") at = 0;
  else if (op === "up") at = Math.min(rest.length, rest.indexOf(st.layers.slice(last + 1).find((l) => !list.includes(l)) ?? rest.at(-1)) + 1);
  else at = Math.max(0, rest.indexOf(st.layers.slice(0, first).filter((l) => !list.includes(l)).at(-1) ?? rest[0]));
  rest.splice(at, 0, ...list);
  st.layers = rest;
  st.dirty = true;
  refresh();
}
// 一覧のドラッグで並べ替え(上の行ほど前)
function moveLayer(id, targetId, after) {
  const from = st.layers.findIndex((l) => l.id === id);
  if (from < 0 || id === targetId) return;
  pushUndo(true);
  const [l] = st.layers.splice(from, 1);
  let to = st.layers.findIndex((x) => x.id === targetId);
  if (to < 0) { st.layers.splice(from, 0, l); return; }
  // 一覧は上が前(配列の後ろ)。行の上半分に落とすとその行より前、下半分なら後ろ
  st.layers.splice(after ? to : to + 1, 0, l);
  st.dirty = true;
  refresh();
}
// 画面の点にあるレイヤー(上から。透明な所は通す)
function layerAt(sx, sy) {
  const d = toDoc(sx, sy);
  for (let i = st.layers.length - 1; i >= 0; i--) {
    const l = st.layers[i];
    if (l.hidden || !hitOne(l, d)) continue;
    const bi = clipOf(l) ? clipBaseIndex(i) : -1;
    if (bi >= 0) { const b = st.layers[bi]; if ((clipOf(l) === "in") !== (!b.hidden && hitOne(b, d))) continue; }
    else if (clipHidesBase(i)) continue;
    return l;
  }
  return null;
}
// d(キャンバスの点)がそのレイヤーの見えている所か
function hitOne(l, d) {
  const { k } = st.view;
  {
    if (l.kind === "text") {
      const L = layoutOf(l);
      const dx = d.x - l.x * st.W, dy = d.y - l.y * st.H, a = (-(l.rot || 0) * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(lx) <= L.w / 2 && Math.abs(ly) <= L.h / 2;
    }
    if (l.kind === "shape") {
      // 回した枠の中(線は細いので、つかみやすく少し広げる)
      const dx = d.x - l.cx, dy = d.y - l.cy, a = (-(l.rot || 0) * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a), pad = 6 / k;
      return Math.abs(lx) <= l.w / 2 + pad && Math.abs(ly) <= Math.max(l.h / 2, (l.strokeW || 0) / 2) + pad;
    }
    const q = docToLayer(l, d.x, d.y);
    if (!inCrop(l, q)) return false;
    try {
      return l.cv.getContext("2d").getImageData(Math.floor(q.x), Math.floor(q.y), 1, 1).data[3] > 8 || (l.opacity ?? 1) <= 0;
    } catch { return true; }
  }
}
// 選んだ画像のバウンディングボックス(「↖ 選択」のとき)
function placeImageBox() {
  const box = $('[data-c="ibox"]');
  if (!box.firstChild) box.innerHTML = bboxHtml("all");
  if (isMulti() && st.tool === "select" && !st.crop) {
    const u = unionBox(selList().filter((l) => !l.hidden)), { k, ox, oy } = st.view;
    box.classList.add("multi"); placeWarpHandles(box, {}, 1);
    if (!u) { box.style.display = "none"; return; }
    Object.assign(box.style, { display: "block", left: `${ox + u.x0 * k}px`, top: `${oy + u.y0 * k}px`, width: `${(u.x1 - u.x0) * k}px`, height: `${(u.y1 - u.y0) * k}px`, transform: "" });
    return;
  }
  box.classList.remove("multi");
  const L = selObj();
  if (!L || L.hidden || st.tool !== "select" || st.crop || st.lcrop) { box.style.display = "none"; return; }
  const { k, ox, oy } = st.view;
  Object.assign(box.style, {
    display: "block", width: `${L.w * k}px`, height: `${L.h * k}px`,
    left: `${ox + L.cx * k - (L.w * k) / 2}px`, top: `${oy + L.cy * k - (L.h * k) / 2}px`,
    transform: Math.abs(L.rot || 0) > 0.01 ? `rotate(${L.rot}deg)` : "",
  });
  placeWarpHandles(box, L, k);
}
// ゆがんだレイヤー: 枠の角・辺の点(と回転の丸)を、ゆがんだ四角の角・辺の真ん中に置く。ゆがみが無ければ元の位置に戻す
function placeWarpHandles(box, L, k) {
  const bb = box.querySelector(".bb");
  if (!bb) return;
  let sv = bb.querySelector(".bb-warp");
  const els = [...bb.querySelectorAll(".bb-h, .bb-stem, .bb-rot")];
  if (!(L.warp && L.kind === "image")) {
    for (const el of els) { el.style.left = ""; el.style.top = ""; }
    bb.style.borderColor = "";
    sv?.remove();
    return;
  }
  const q = warpQuad(L).map((p) => [(L.w / 2 + p[0]) * k, (L.h / 2 + p[1]) * k]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const at = { nw: q[0], ne: q[1], se: q[2], sw: q[3], n: mid(q[0], q[1]), e: mid(q[1], q[2]), s: mid(q[3], q[2]), w: mid(q[0], q[3]) };
  for (const [h, p] of Object.entries(at)) { const el = bb.querySelector(`.bb-${h}`); if (el) { el.style.left = `${p[0]}px`; el.style.top = `${p[1]}px`; } }
  for (const c of [".bb-stem", ".bb-rot"]) { const el = bb.querySelector(c); if (el) { el.style.left = `${at.s[0]}px`; el.style.top = `${at.s[1]}px`; } }
  bb.style.borderColor = "transparent";
  if (!sv) { sv = document.createElementNS("http://www.w3.org/2000/svg", "svg"); sv.setAttribute("class", "bb-warp"); sv.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none"; bb.prepend(sv); }
  const col = getComputedStyle(bb.querySelector(".bb-nw") || bb).borderTopColor || "#4f8bff";
  sv.innerHTML = `<polygon points="${q.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
}
// ---------------------------------------------------------------- 吸い付き(スナップ): キャンバスの端・真ん中と、ほかのレイヤーの端・真ん中にそろえる
const SNAP_LS = "cca_generator.imgedit.snap";
function loadSnap() { try { return localStorage.getItem(SNAP_LS) !== "0"; } catch { return true; } }
function setSnap(on) {
  st.snap = !!on;
  try { localStorage.setItem(SNAP_LS, st.snap ? "1" : "0"); } catch { /* 覚えなくてもよい */ }
  $('[data-c="snap"]')?.classList.toggle("on", st.snap);
}
// レイヤーの、画面に沿った外側の枠(画面の px。回したレイヤーは回した後の外側)
function objScreenBounds(l) {
  const cr = $(".stage > canvas").getBoundingClientRect(), { k, ox, oy } = st.view;
  let cx, cy, w, h;
  if (l.kind === "text") { const L = layoutOf(l); cx = l.x * st.W; cy = l.y * st.H; w = L.w; h = L.h; }
  else ({ cx, cy, w, h } = l);
  const b = rotatedBounds(cx, cy, w, h, l.rot || 0);
  return { x0: cr.left + ox + b.x0 * k, y0: cr.top + oy + b.y0 * k, x1: cr.left + ox + b.x1 * k, y1: cr.top + oy + b.y1 * k };
}
function snapTargets(skip) {
  const cr = $(".stage > canvas").getBoundingClientRect(), { k, ox, oy } = st.view;
  const rects = [{ x0: cr.left + ox, y0: cr.top + oy, x1: cr.left + ox + st.W * k, y1: cr.top + oy + st.H * k }];
  for (const l of st.layers) if (l !== skip && !l.hidden) rects.push(objScreenBounds(l));
  return snapLines(rects);
}
// ドラッグの結果を寄せる(動かす: いつも。大きさ: 回していないとき。回転・折り返す幅は寄せない)
function snapRes(res, ev, box0, lines, rot, resize = true) {
  let g = null;
  if (st.snap && !ev?.altKey && res.rot == null) {
    if (res.dx != null) { const m = snapMove(box0, res.dx, res.dy, lines); res = { dx: m.dx, dy: m.dy }; g = m; }
    else if (resize && res.c && Math.abs(rot || 0) < 0.01) { const m = snapResize(res, box0, lines); res = m.res; g = m; }
    else if (resize && !res.c && res.handle && Math.abs(rot || 0) < 0.01) { const m = snapAnchorResize(res, box0, lines); res = m.res; g = m; } // 反対側を止めた大きさ変更
  }
  showSnapGuides($(".stage"), g && (g.gx.length || g.gy.length) ? g : null);
  return res;
}
// 反対側(対角)の辺・角を止めて広げるとき、動かしている辺・角を線にそろえる
function snapAnchorResize(res, b, L) {
  const h = res.handle, T = WARP_SNAP, W = b.x1 - b.x0, H = b.y1 - b.y0;
  const pick = (v, ts) => { let r = null; for (const t of ts) { const d = t - v; if (Math.abs(d) <= T && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, at: t }; } return r; };
  if (res.w != null) { const e = h === "e" ? b.x0 + res.w : b.x1 - res.w, s = pick(e, L.xs); return s ? { res: (() => { const w = Math.max(8, res.w + (h === "e" ? s.d : -s.d)); return { ...res, w, dcx: (h === "e" ? 1 : -1) * (w - W) / 2, dcy: 0 }; })(), gx: [s.at], gy: [] } : { res, gx: [], gy: [] }; }
  if (res.h != null) { const e = h === "s" ? b.y0 + res.h : b.y1 - res.h, s = pick(e, L.ys); return s ? { res: (() => { const hh = Math.max(8, res.h + (h === "s" ? s.d : -s.d)); return { ...res, h: hh, dcx: 0, dcy: (h === "s" ? 1 : -1) * (hh - H) / 2 }; })(), gx: [], gy: [s.at] } : { res, gx: [], gy: [] }; }
  if (res.k != null && h.length === 2) {
    const ex = h.includes("e") ? b.x0 + W * res.k : b.x1 - W * res.k, ey = h.includes("s") ? b.y0 + H * res.k : b.y1 - H * res.k;
    const sx = pick(ex, L.xs), sy = pick(ey, L.ys);
    const kx = sx ? (res.k * W + (h.includes("e") ? sx.d : -sx.d)) / W : null, ky = sy ? (res.k * H + (h.includes("s") ? sy.d : -sy.d)) / H : null;
    const useX = sx && (!sy || Math.abs(sx.d) <= Math.abs(sy.d));
    const k2 = useX ? kx : sy ? ky : null;
    if (k2 == null) return { res, gx: [], gy: [] };
    const sxg = h.includes("w") ? -1 : 1, syg = h.includes("n") ? -1 : 1, th = 0;
    return { res: { ...res, k: Math.max(0.02, k2), dcx: sxg * (W / 2) * (Math.max(0.02, k2) - 1), dcy: syg * (H / 2) * (Math.max(0.02, k2) - 1) }, gx: useX ? [sx.at] : [], gy: useX ? [] : [sy.at] };
  }
  return { res, gx: [], gy: [] };
}
// Ctrl + 辺・角ドラッグ: その辺(両端の角)・その角を自由に動かして、四角をゆがめる(画像レイヤー。Alt でスナップなし)
function startWarpDrag(e, L, h) {
  e.preventDefault();
  e.stopPropagation();
  const k = st.view.k, a = ((L.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const w0 = L.warp ? L.warp.map((p) => [...p]) : [[0, 0], [0, 0], [0, 0], [0, 0]];
  const idx = { n: [0, 1], e: [1, 2], s: [3, 2], w: [0, 3], nw: [0], ne: [1], se: [2], sw: [3] }[h];
  const q0 = warpQuad({ ...L, warp: w0 }), lines = snapTargets(L);
  const cr = $(".stage > canvas").getBoundingClientRect(), { ox, oy } = st.view;
  const scr = (p) => [cr.left + ox + (L.cx + p[0] * ca - p[1] * sa) * k, cr.top + oy + (L.cy + p[0] * sa + p[1] * ca) * k]; // レイヤーの点 → 画面の px
  const near = (vals, targets, d0) => { let b = null; for (const v of vals) for (const t of targets) { const d = t - v; if (Math.abs(d) <= WARP_SNAP && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, at: t }; } return b ? { d: b.d, at: b.at } : { d: 0, at: null }; };
  const x0 = e.clientX, y0 = e.clientY;
  let pushed = false;
  const move = (ev) => {
    let dxs = ev.clientX - x0, dys = ev.clientY - y0, g = null;
    if (st.snap && !ev.altKey) {
      const pts = idx.map((i) => { const s = scr(q0[i]); return [s[0] + dxs, s[1] + dys]; });
      const bx = near(pts.map((p) => p[0]), lines.xs), by = near(pts.map((p) => p[1]), lines.ys);
      dxs += bx.d; dys += by.d;
      g = { gx: bx.at != null ? [bx.at] : [], gy: by.at != null ? [by.at] : [] };
    }
    showSnapGuides($(".stage"), g && (g.gx.length || g.gy.length) ? g : null);
    const dx = dxs / k, dy = dys / k;
    const lx = dx * Math.cos(-a) - dy * Math.sin(-a), ly = dx * Math.sin(-a) + dy * Math.cos(-a);
    if (!pushed) { pushUndo(true); pushed = true; }
    const nw = w0.map((p) => [...p]);
    for (const i of idx) { nw[i][0] = r1(w0[i][0] + lx); nw[i][1] = r1(w0[i][1] + ly); }
    L.warp = nw;
    st.dirty = true;
    draw();
  };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); showSnapGuides($(".stage"), null); if (pushed) { delete $('[data-c="lyinsp"]').dataset.for; refresh(); } };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
const WARP_SNAP = 8;
function startImageDrag(e) {
  if (isMulti()) { startMultiDrag(e); return; }
  const L = selObj();
  if (!L || st.busy) return;
  if ((e.ctrlKey || e.metaKey || L.warp) && L.kind === "image" && ["e", "w", "n", "s", "nw", "ne", "se", "sw"].includes(e.target.dataset?.h)) { startWarpDrag(e, L, e.target.dataset.h); return; }
  const box = $('[data-c="ibox"]'), br = box.getBoundingClientRect();
  const k = st.view.k, L0 = { ...L };
  const box0 = objScreenBounds(L), lines = snapTargets(L);
  let pushed = false;
  bboxDrag(e, {
    cx: br.left + br.width / 2, cy: br.top + br.height / 2, w: box.offsetWidth, h: box.offsetHeight, rot: L.rot || 0, handle: e.target.dataset?.h || "move",
    onMove: (res, ev) => {
      if (!pushed) { pushUndo(true); pushed = true; }
      res = snapRes(res, ev, box0, lines, L0.rot);
      if (res.dx != null) { L.cx = r1(L0.cx + res.dx / k); L.cy = r1(L0.cy + res.dy / k); }
      else if (res.rot != null) L.rot = res.rot;
      else if (res.k != null) {
        L.cx = r1(L0.cx + (res.dcx || 0) / k); L.cy = r1(L0.cy + (res.dcy || 0) / k);
        L.w = Math.max(1, L0.w * res.k); L.h = Math.max(1, L0.h * res.k);
        if (L.kind === "shape" && isLineShape(L.shape)) L.strokeW = r1(Math.max(0.5, (L0.strokeW || 1) * res.k));
      } else if (res.w != null) { L.cx = r1(L0.cx + (res.dcx || 0) / k); L.cy = r1(L0.cy + (res.dcy || 0) / k); L.w = Math.max(1, res.w / k); if (ev?.shiftKey) L.h = (L0.h * L.w) / L0.w; }
      else if (res.h != null) {
        L.cx = r1(L0.cx + (res.dcx || 0) / k); L.cy = r1(L0.cy + (res.dcy || 0) / k);
        L.h = Math.max(1, res.h / k); if (ev?.shiftKey) L.w = (L0.w * L.h) / L0.h;
        // 線・矢印は、上下の辺で太さを変える
        if (L.kind === "shape" && (L.shape === "line" || L.shape === "arrow")) L.strokeW = r1(Math.max(0.5, (L0.strokeW || 1) * (L.h / Math.max(1, L0.h))));
      }
      st.dirty = true;
      draw();
      syncLayerInsp();
    },
    onEnd: () => { showSnapGuides($(".stage"), null); refresh(); },
  });
}
const r1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- 書き出しの設定(形式・画質・背景・ファイル名)
const OUT_LS = "cca_generator.imgedit.out";
function loadOut() {
  try { const o = JSON.parse(localStorage.getItem(OUT_LS) || "{}"); if (o && typeof o === "object") Object.assign(st.out, { fmt: o.fmt, q: o.q, bg: o.bg, color: o.color }); } catch { /* 既定のまま */ }
  if (!["png", "jpeg", "webp"].includes(st.out.fmt)) st.out.fmt = "png";
  if (!["transparent", "white", "black", "color"].includes(st.out.bg)) st.out.bg = "transparent";
  st.out.q = clamp(Number(st.out.q) || 92, 1, 100);
  if (!/^#[0-9a-f]{6}$/i.test(st.out.color || "")) st.out.color = "#ffffff";
}
function saveOut() {
  try { localStorage.setItem(OUT_LS, JSON.stringify({ fmt: st.out.fmt, q: st.out.q, bg: st.out.bg, color: st.out.color })); } catch { /* 覚えなくてもよい */ }
}
const defaultOutName = () => `${stem(st.source || st.name || "image")}_edit`;
// ファイル名(拡張子なし)。空なら「元の名前_edit」
function outName() {
  const n = String(st.out.name || "").trim().replace(/\.(png|jpe?g|webp)$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return n || defaultOutName();
}
const outExt = () => (st.out.fmt === "jpeg" ? "jpg" : st.out.fmt);
function refreshOut() {
  const box = $('[data-c="outsec"]');
  if (!box) return;
  for (const el of box.querySelectorAll("[data-o]")) if (el !== document.activeElement) el.value = st.out[el.dataset.o] ?? "";
  $('[data-o="name"]').placeholder = defaultOutName();
  $('[data-orow="q"]').hidden = st.out.fmt === "png";
  $('[data-orow="color"]').hidden = st.out.bg !== "color";
  const notes = [];
  if (st.out.fmt === "jpeg" && st.out.bg === "transparent") notes.push(T("JPEG は透明にできないので、透明な所は白になります。"));
  notes.push(T("保存先: 生成パネルの「画像の保存先」のフォルダ。ファイル名: {0}.{1}(同じ名前があれば _1、_2 …)", outName(), outExt()));
  $('[data-c="outnote"]').textContent = notes.join(" ");
}
function onOutInput(e) {
  const k = e.target.dataset.o;
  if (!k) return;
  const v = e.target.value;
  if (k === "q") { const n = Number(v); if (v === "" || Number.isNaN(n)) return; st.out.q = clamp(Math.round(n), 1, 100); }
  else st.out[k] = v;
  if (k !== "name") saveOut();
  refreshOut();
  draw();
}
// 書き出す画像(Blob)と拡張子
async function exportBlob() {
  const c = renderComposite();
  const type = st.out.fmt === "jpeg" ? "image/jpeg" : st.out.fmt === "webp" ? "image/webp" : "image/png";
  const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(T("画像を作れませんでした")))), type, type === "image/png" ? undefined : clamp(st.out.q, 1, 100) / 100));
  return { blob, ext: outExt(), name: outName() };
}

// ---------------------------------------------------------------- キャンバスの大きさ(リサイズ・トリミング)
// キャンバスを (x0, y0) から W2 × H2 にする(置いたレイヤーは動かさない。文字はキャンバスに対しての値なので計算し直す)
function setCanvasRect(x0, y0, W2, H2) {
  W2 = Math.max(1, Math.round(W2)); H2 = Math.max(1, Math.round(H2));
  const W = st.W, H = st.H;
  for (const l of st.layers) {
    if (l.kind !== "text") { l.cx -= x0; l.cy -= y0; continue; }
    l.x = r3((l.x * W - x0) / W2); l.y = r3((l.y * H - y0) / H2);
    l.size = r3(clamp((l.size || 0.08) * (H / H2), 0.001, 10));
    if (Number(l.wrap) > 0) l.wrap = r3((l.wrap * W) / W2);
  }
  st.W = W2; st.H = H2;
}
function resizeCanvas(W2, H2) {
  W2 = Math.max(1, Math.round(W2)); H2 = Math.max(1, Math.round(H2));
  if (!st.layers.length || (W2 === st.W && H2 === st.H)) return;
  endBg();
  pushUndo(true);
  const sx = W2 / st.W, sy = H2 / st.H;
  for (const l of st.layers) {
    if (l.kind === "text") continue;
    l.cx *= sx; l.cy *= sy; l.w *= sx; l.h *= sy;
    if (l.kind === "shape" && l.strokeW) l.strokeW = r1(l.strokeW * Math.sqrt(sx * sy));
  }
  st.W = W2; st.H = H2;
  st.dirty = true;
  st.view.px = 0; st.view.py = 0;
  refresh();
  ctx.notify(T("キャンバスを {0} × {1} にしました(元に戻せます)", W2, H2), "info");
}
// 置いたレイヤー(見えているレイヤー)がすべて入る範囲
function contentBox() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const l of st.layers) {
    if (l.hidden) continue;
    let cx, cy, w, h, rot;
    if (l.kind !== "text") ({ cx, cy, w, h } = l), (rot = l.rot || 0);
    else { const L = layoutOf(l); cx = l.x * st.W; cy = l.y * st.H; w = L.w; h = L.h; rot = l.rot || 0; }
    const a = (rot * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
    for (const [dx, dy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) add(cx + dx * c - dy * s2, cy + dx * s2 + dy * c);
  }
  return x0 === Infinity ? null : { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
}
function refreshCanvasUi() {
  const sec = $('[data-c="cvsec"]');
  if (!sec) return;
  $('[data-c="cvinfo"]').textContent = st.layers.length ? T("今の大きさ: {0} × {1} px", st.W, st.H) : "";
  for (const k of ["w", "h"]) { const el = $(`[data-cv="${k}"]`); if (el !== document.activeElement) el.value = k === "w" ? st.W || "" : st.H || ""; }
  // 枠の強調表示の欄(data-fh)は画像が無くても使え、押せるかどうかは cca_framehl.js が決める
  for (const el of sec.querySelectorAll("button, input:not([data-fh]), select")) el.disabled = !st.layers.length || st.busy;
  $('[data-c="cropbar"]').hidden = !st.crop;
  $('[data-ca="crop"]').classList.toggle("on", !!st.crop);
  if (st.crop) for (const k of ["x", "y", "w", "h"]) { const el = $(`[data-cr="${k}"]`); if (el !== document.activeElement) el.value = Math.round(st.crop[k]); }
}
function cropRatio() {
  const v = $('[data-cv="ratio"]')?.value || "free";
  if (v === "free") return 0;
  if (v === "orig") return st.W / st.H;
  const [a, b] = v.split(":").map(Number);
  return a / b;
}
// 比率に合わせる(真ん中はそのまま)
function fitCropRatio(c) {
  const r = cropRatio();
  if (!r) return c;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  let w = c.w, h = c.h;
  if (w / h > r) w = h * r; else h = w / r;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
function startCrop() {
  if (st.lcrop) endLayerCrop(true);
  if (!st.layers.length || st.busy) return;
  endBg();
  st.crop = fitCropRatio({ x: 0, y: 0, w: st.W, h: st.H });
  refresh();
}
function endCrop(apply) {
  const c = st.crop;
  st.crop = null;
  if (apply && c) {
    const x = Math.round(c.x), y = Math.round(c.y), w = Math.max(1, Math.round(c.w)), h = Math.max(1, Math.round(c.h));
    if (x !== 0 || y !== 0 || w !== st.W || h !== st.H) {
      pushUndo(true);
      setCanvasRect(x, y, w, h);
      st.dirty = true;
      st.view.px = 0; st.view.py = 0;
      ctx.notify(T("キャンバスを {0} × {1} にしました(元に戻せます)", w, h), "info");
    }
  }
  refresh();
}
function placeCropBox() {
  const box = $('[data-c="cbox"]');
  const c = st.crop;
  if (!c || !st.layers.length) { box.style.display = "none"; return; }
  const { k, ox, oy } = st.view;
  if (!box.firstChild) box.innerHTML = `${bboxHtml("all")}<span class="cdim"></span>`;
  Object.assign(box.style, { display: "block", left: `${ox + c.x * k}px`, top: `${oy + c.y * k}px`, width: `${c.w * k}px`, height: `${c.h * k}px` });
  box.querySelector(".cdim").textContent = `${Math.round(c.w)} × ${Math.round(c.h)}`;
}
// トリミングの枠のドラッグ(角・辺は、その辺だけが動く。比率があれば合わせる)
function startCropDrag(e) {
  const c0 = { ...st.crop }, h = e.target.dataset?.h || "move", k = st.view.k;
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX, y0 = e.clientY;
  const move = (ev) => {
    const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
    let { x, y, w, h: hh } = c0;
    if (h === "move") { x += dx; y += dy; }
    else {
      if (h.includes("w")) { x += dx; w -= dx; }
      if (h.includes("e")) w += dx;
      if (h.includes("n")) { y += dy; hh -= dy; }
      if (h.includes("s")) hh += dy;
      if (w < 1) { if (h.includes("w")) x += w - 1; w = 1; }
      if (hh < 1) { if (h.includes("n")) y += hh - 1; hh = 1; }
      const r = cropRatio() || (ev.shiftKey ? c0.w / c0.h : 0);
      if (r) {
        // 比率: 動かした向きに合わせ、反対側の角(辺)は動かさない
        if (h === "n" || h === "s") { const nw = hh * r; x += (w - nw) / 2; w = nw; }
        else if (h === "e" || h === "w") { const nh = w / r; y += (hh - nh) / 2; hh = nh; }
        else {
          if (w / hh > r) { const nw = hh * r; if (h.includes("w")) x += w - nw; w = nw; }
          else { const nh = w / r; if (h.includes("n")) y += hh - nh; hh = nh; }
        }
      }
    }
    st.crop = { x, y, w, h: hh };
    placeCropBox();
    refreshCanvasUi();
  };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
function onCanvasUi(e) {
  const el = e.target;
  if (el.dataset.cv === "w" || el.dataset.cv === "h") {
    if (!$('[data-cv="keep"]').checked || !st.W) return;
    const n = Number(el.value);
    if (!(n > 0)) return;
    const other = el.dataset.cv === "w" ? $('[data-cv="h"]') : $('[data-cv="w"]');
    other.value = Math.max(1, Math.round(el.dataset.cv === "w" ? (n * st.H) / st.W : (n * st.W) / st.H));
    $('[data-cv="pct"]').value = r1(((el.dataset.cv === "w" ? n / st.W : n / st.H) * 100));
  } else if (el.dataset.cv === "pct") {
    const n = Number(el.value);
    if (!(n > 0)) return;
    $('[data-cv="w"]').value = Math.max(1, Math.round((st.W * n) / 100));
    $('[data-cv="h"]').value = Math.max(1, Math.round((st.H * n) / 100));
  } else if (el.dataset.cv === "ratio" && st.crop) { st.crop = fitCropRatio(st.crop); refresh(); }
  else if (el.dataset.cr && st.crop) {
    const n = Number(el.value);
    if (el.value === "" || Number.isNaN(n)) return;
    const c = { ...st.crop, [el.dataset.cr]: el.dataset.cr === "w" || el.dataset.cr === "h" ? Math.max(1, n) : n };
    const r = cropRatio();
    if (r && el.dataset.cr === "w") c.h = c.w / r;
    if (r && el.dataset.cr === "h") c.w = c.h * r;
    st.crop = c;
    placeCropBox();
    refreshCanvasUi();
  }
}
function canvasAction(a) {
  if (a === "resize") resizeCanvas(Number($('[data-cv="w"]').value), Number($('[data-cv="h"]').value));
  else if (a === "crop") { if (st.crop) endCrop(false); else startCrop(); }
  else if (a === "cropok") endCrop(true);
  else if (a === "cropno") endCrop(false);
  else if (a === "fitall") {
    const b = contentBox();
    if (!b) return;
    pushUndo(true);
    setCanvasRect(b.x, b.y, b.w, b.h);
    st.dirty = true;
    st.view.px = 0; st.view.py = 0;
    refresh();
    ctx.notify(T("キャンバスを {0} × {1} にしました(元に戻せます)", st.W, st.H), "info");
  }
}

// ---------------------------------------------------------------- 文字(動画編集と同じ項目・同じテンプレート)
const measureG = document.createElement("canvas").getContext("2d");
let tuid = 1;
function textFont(t, px) {
  const c = fontApi.css(t.font || fontApi.defaultKey?.() || "");
  return `${c.fontStyle || "normal"} ${c.fontWeight || 700} ${px}px ${c.fontFamily || '"Hiragino Sans","Yu Gothic UI",Meiryo,"Noto Sans CJK JP",sans-serif'}`;
}
// キャンバスの大きさでの並び(文字の大きさはキャンバスの高さに対して、折り返す幅はキャンバスの幅に対して)
function layoutOf(t) {
  const W = st.W, H = st.H, px = Math.max(4, (t.size || 0.08) * H);
  const font = textFont(t, px);
  const L = textLayout(measureG, t, px, font, (Number(t.wrap) || 0) * W);
  L.font = font;
  return L;
}
const selText = () => st.texts.find((t) => t.id === st.tsel) || null;
function newText(x = 0.5, y = 0.5) {
  const last = st.texts.at(-1);
  const style = last ? Object.fromEntries(STYLE_KEYS.filter((k) => last[k] != null).map((k) => [k, last[k]])) : {};
  return { id: tuid++, kind: "text", text: T("テキスト"), size: 0.08, color: "#ffffff", stroke: "#000000", strokeWidth: 0.08, bg: "#000000", bgAlpha: 0, rot: 0, opacity: 1, wrap: 0, ...style, x, y };
}
// 文字の量に合わせて、画面(90%)に収まるまで文字を小さくする(横は折り返す)
function fitTextToCanvas(t) {
  const lim = 0.9, minSize = 0.012;
  t.wrap = 0;
  let L = layoutOf(t);
  if (L.w > st.W * lim) { t.wrap = lim; L = layoutOf(t); }
  for (let i = 0; i < 40 && (L.h > st.H * lim || L.w > st.W * lim * 1.001) && t.size > minSize; i++) {
    t.size = r3(Math.max(minSize, t.size * 0.9));
    L = layoutOf(t);
  }
}
function pasteTextLayer(text) {
  if (!st.layers.length || st.busy) return false;
  endBg();
  pushUndo(true);
  const t = newText(0.5, 0.5);
  t.text = text.slice(0, 2000);
  fitTextToCanvas(t); // 量が多いときは、画面に収まる大きさにする
  st.layers.push(t);
  st.tsel = t.id; st.isel = null; st.msel = [];
  st.tool = "select";
  st.dirty = true;
  refresh();
  return true;
}
function addText(x, y) {
  if (!st.layers.length) return;
  endBg();
  pushUndo(true);
  const t = newText(x, y);
  st.layers.push(t);
  st.tsel = t.id; st.isel = null; st.msel = [];
  st.tool = "select"; // 置いたら「↖ 選択」に戻る(続けて文字を打てるように、右の欄を選んだ状態に)
  st.dirty = true;
  refresh();
  setTimeout(() => { const ta = $('[data-c="txinsp"] [data-k="text"]'); ta?.focus(); ta?.select(); }, 0);
}
// 文字を、作業する画像に描き込む(元に戻せる)。画像の向き・大きさに合わせて描く
function flattenTexts(quiet = false) {
  if (!st.texts.length) return false;
  endBg();
  let A = activeImg();
  if (!A) {
    // 画像が無ければ、キャンバスの大きさの透明な画像を作って描き込む
    pushUndo(true);
    A = imageLayer(canvasOf(st.W, st.H), T("文字"), st.W / 2, st.H / 2, st.W, st.H);
    st.layers.unshift(A);
    st.aimg = A.id;
  }
  pushUndo();
  const g = st.img.getContext("2d");
  for (const t of st.texts) {
    const L = layoutOf(t);
    g.save();
    // キャンバス → 画像の画素
    const cc = cropOf(A);
    g.translate(cc.x + cc.w / 2, cc.y + cc.h / 2);
    g.scale(cc.w / A.w, cc.h / A.h);
    g.rotate((-(A.rot || 0) * Math.PI) / 180);
    g.translate(-A.cx, -A.cy);
    g.translate(t.x * st.W, t.y * st.H);
    g.rotate(((t.rot || 0) * Math.PI) / 180);
    g.globalAlpha = clamp(t.opacity ?? 1, 0, 1);
    drawTextAt(g, t, L, L.font);
    g.restore();
  }
  st.texts = [];
  st.tsel = null;
  st.dirty = true;
  refresh();
  if (!quiet) ctx.notify("文字を画像に描き込みました(元に戻すで取り消せます)", "info");
  return true;
}
// コピー・切り取り(Ctrl+C / X)・貼り付け(Ctrl+V)。動画編集の文字とも行き来できる
function copyText(cut = false) {
  const t = selText();
  if (!t) return false;
  clipboard.set({ type: "text", from: "img", text: pickText(t) });
  if (cut) textAction("del");
  ctx.notify(cut ? "切り取りました(Ctrl+V で貼り付け)" : "コピーしました(Ctrl+V で貼り付け)", "info");
  return true;
}
function pasteText() {
  const c = clipboard.get();
  const src = c?.text || (c?.type === "ov" && c.ov?.kind === "text" ? pickText(c.ov) : null);
  if (!src || !st.layers.length || st.busy) return false;
  endBg();
  pushUndo(true);
  const t = { ...newText(), ...src, id: tuid++, kind: "text" };
  // 同じ画面からなら少しずらして重ならないように
  if (c.from === "img") { t.x = r3((src.x ?? 0.5) + 0.03); t.y = r3((src.y ?? 0.5) + 0.03); }
  st.layers.push(t);
  st.tsel = t.id; st.isel = null; st.msel = [];
  st.tool = "select"; // 貼り付けたあとは「選択」(文字を置く状態にしない)
  st.dirty = true;
  refresh();
  ctx.notify("貼り付けました", "info");
  return true;
}
// 画面の点(キャンバスの中の px)にある文字(上のものから)
function textAt(sx, sy) {
  if (!st.layers.length) return null;
  const { k, ox, oy } = st.view;
  const ts = st.texts;
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = ts[i], L = layoutOf(t);
    if (t.hidden) continue;
    const dx = (sx - ox) / k - t.x * st.W, dy = (sy - oy) / k - t.y * st.H;
    const a = (-(t.rot || 0) * Math.PI) / 180;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= L.w / 2 && Math.abs(ly) <= L.h / 2) return t;
  }
  return null;
}
// 選んだ文字のバウンディングボックス(「T 文字」ツールのとき)
function placeTextBox() {
  const box = $('[data-c="tbox"]');
  const t = selText();
  if (!t || t.hidden || !st.layers.length || !["text", "select"].includes(st.tool) || st.crop || st.tedit === t.id || isMulti()) { box.style.display = "none"; return; }
  const L = layoutOf(t), { k, ox, oy } = st.view;
  if (!box.firstChild) box.innerHTML = bboxHtml("ew");
  Object.assign(box.style, {
    display: "block", width: `${L.w * k}px`, height: `${L.h * k}px`,
    left: `${ox + t.x * st.W * k - (L.w * k) / 2}px`, top: `${oy + t.y * st.H * k - (L.h * k) / 2}px`,
    transform: Math.abs(t.rot || 0) > 0.01 ? `rotate(${t.rot}deg)` : "",
  });
}
function startTextDrag(e) {
  const t = selText();
  if (!t || st.busy) return;
  const box = $('[data-c="tbox"]'), br = box.getBoundingClientRect();
  const k = st.view.k, W = st.W, H = st.H;
  const t0 = { ...t };
  const box0 = objScreenBounds(t), lines = snapTargets(t);
  let pushed = false;
  bboxDrag(e, {
    cx: br.left + br.width / 2, cy: br.top + br.height / 2, w: box.offsetWidth, h: box.offsetHeight, rot: t.rot || 0, handle: e.target.dataset?.h || "move",
    onMove: (res, ev) => {
      if (!pushed) { pushUndo(true); pushed = true; st.dirty = true; }
      if (res.w == null) res = snapRes(res, ev, box0, lines, t0.rot); // 折り返す幅は寄せない
      if (res.dx != null) { t.x = r3(clamp(t0.x + res.dx / (W * k), -0.5, 1.5)); t.y = r3(clamp(t0.y + res.dy / (H * k), -0.5, 1.5)); }
      else if (res.rot != null) t.rot = res.rot;
      else if (res.k != null) { t.size = r3(clamp(t0.size * res.k, 0.005, 1)); t.x = r3(t0.x + (res.dcx || 0) / (W * k)); t.y = r3(t0.y + (res.dcy || 0) / (H * k)); }
      else if (res.w != null) { t.wrap = r3(clamp(res.w / (W * k), 0.05, 2)); t.x = r3(t0.x + (res.dcx || 0) / (W * k)); t.y = r3(t0.y + (res.dcy || 0) / (H * k)); }
      draw();
      syncTextInsp();
    },
    onEnd: () => { showSnapGuides($(".stage"), null); refresh(); },
  });
}
const r3 = (v) => Math.round(v * 1000) / 1000;
function renderTextList() {
  const el = $('[data-c="tlist"]');
  el.innerHTML = st.texts.map((t) => `<button data-tid="${t.id}" class="${t.id === st.tsel ? "on" : ""}" title="${esc(t.text)}">T ${esc(String(t.text).split("\n")[0].slice(0, 14) || "…")}</button>`).join("");
}
// 右の欄(文字): 動画編集と同じまとまり(メイン・縁・背景)+ 位置
function renderTextInsp() {
  const box = $('[data-c="txinsp"]');
  const t = selText();
  if (!t) { box.innerHTML = st.texts.length ? `<div class="note">${esc(T("文字を押すと、ここで変えられます(「T 文字」ツールで)。"))}</div>` : ""; delete box.dataset.for; return; }
  if (box.contains(document.activeElement) && box.dataset.for === String(t.id)) { syncTextInsp(); return; }
  box.dataset.for = String(t.id);
  const open = (c) => st.secOpen[c] ?? true;
  box.innerHTML = textSectionsHtml(t, {
    fontOptions: (cur) => fontApi.options(cur), tplHtml: tplHtml(), size: t.size, open, sizeLabel: "文字の大きさ(%)",
    fontButtons: `<div class="row" style="margin-top:4px"><button data-ta="gfont">${esc(T("＋ Google Fonts から追加"))}</button><button data-ta="fontre" title="${esc(T("フォントの一覧を読み直す"))}">🔄</button></div>`,
  }) + tsec("pos", T("位置・回転・不透明度"), `${tnum("x", "位置 横(%)", r3(t.x * 100), -100, 200, 0.5)}${tnum("y", "位置 縦(%)", r3(t.y * 100), -100, 200, 0.5)}
      ${tnum("rot", "回転(度)", r3(t.rot || 0), -3600, 3600, 1)}${tnum("opacity", "不透明度(%)", r3((t.opacity ?? 1) * 100), 0, 100, 1)}
      <div class="row" style="margin-top:6px"><button data-ta="dup">${esc(T("⧉ 複製"))}</button><button data-ta="del">${esc(T("🗑 消す"))}</button></div>
      <div class="note">${esc(T("文字の大きさは画像の高さに対しての %、折り返す幅は画像の幅に対しての %。"))}</div>`, open("pos"));
  for (const d of box.querySelectorAll("details.sec")) d.addEventListener("toggle", () => { st.secOpen[d.dataset.sec] = d.open; });
}
function syncTextInsp() {
  const t = selText();
  if (!t) return;
  for (const el of $('[data-c="txinsp"]').querySelectorAll("[data-k]")) if (el !== document.activeElement) setTextField(el, t);
}
// テンプレート(動画編集と同じ: おすすめ ★ と保存したもの)
async function loadStyles() {
  try { const r = await api.fetchApi("/cca_generator/videoedit/styles", { cache: "no-store" }); if (r.ok) st.styles = await r.json(); } catch { /* 無くても文字は入れられる */ }
  if (!st.styles) st.styles = { builtin: [], user: [], hidden: [] };
  delete $('[data-c="txinsp"]').dataset.for;
  renderTextInsp();
}
function tplHtml() {
  const S = st.styles;
  if (!S) { loadStyles(); return `<div class="note">${esc(T("テンプレートを読み込んでいます…"))}</div>`; }
  const opt = (pfx, it, star) => `<option value="${pfx}:${esc(it.name)}" ${st.tplSel === `${pfx}:${it.name}` ? "selected" : ""}>${star}${esc(T(it.name))}</option>`;
  return `<label class="fl">${esc(T("テンプレート"))}<select data-tc="tpl" title="${esc(T("選ぶと、この文字に当てはめます"))}"><option value="">${esc(T("(選んで当てはめる)"))}</option>
    <optgroup label="${esc(T("★ おすすめ"))}">${S.builtin.map((it) => opt("b", it, "★ ")).join("")}</optgroup>
    ${S.user.length ? `<optgroup label="${esc(T("保存したもの"))}">${S.user.map((it) => opt("u", it, "")).join("")}</optgroup>` : ""}</select></label>
    <div class="row" style="margin-top:4px"><button data-ta="tplsave" title="${esc(T("今の文字の色・縁・背景・フォント・大きさを、名前をつけて保存します"))}">${esc(T("💾 今の書式を保存"))}</button>
    <button data-ta="tpldel" ${st.tplSel ? "" : "disabled"} title="${esc(T("選んでいるテンプレートを消します(おすすめは隠します)"))}">${esc(T("🗑 消す"))}</button>
    ${S.hidden?.length ? `<button data-ta="tplunhide" title="${esc(T("隠したおすすめを戻します"))}">${esc(T("↺ おすすめを戻す({0})", S.hidden.length))}</button>` : ""}</div>`;
}
function findTpl(v) {
  const m = /^([bu]):(.*)$/.exec(v || "");
  if (!m || !st.styles) return null;
  const it = (m[1] === "b" ? st.styles.builtin : st.styles.user).find((x) => x.name === m[2]);
  return it ? { ...it, user: m[1] === "u" } : null;
}
async function postStyles(body) {
  const r = await api.fetchApi("/cca_generator/videoedit/styles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${r.status}`);
  st.styles = { builtin: j.builtin, user: j.user, hidden: j.hidden };
}
async function textAction(a, btn) {
  const t = selText();
  try {
    if (a === "gfont") { fontApi.google(); return; }
    if (a === "fontre") { btn.disabled = true; await fontApi.load(true); btn.disabled = false; delete $('[data-c="txinsp"]').dataset.for; renderTextInsp(); return; }
    if (!t) return;
    if (a === "dup") { pushUndo(true); const c = { ...JSON.parse(JSON.stringify(t)), id: tuid++, x: r3(t.x + 0.03), y: r3(t.y + 0.03) }; st.layers.splice(st.layers.indexOf(t) + 1, 0, c); st.tsel = c.id; }
    else if (a === "del") { pushUndo(true); st.layers = st.layers.filter((x) => x !== t); st.tsel = null; }
    else if (a === "tplsave") {
      const name = (prompt("テンプレートの名前", "") || "").trim();
      if (!name) return;
      if (st.styles?.user.some((x) => x.name === name) && !confirm(T("「{0}」はもうあります。上書きしますか?", name))) return;
      const style = {};
      for (const k of STYLE_KEYS) if (t[k] != null && t[k] !== "") style[k] = t[k];
      await postStyles({ action: "save", name, style });
      st.tplSel = `u:${name}`;
      ctx.notify(T("テンプレート「{0}」を保存しました", name), "info", btn);
    } else if (a === "tpldel") {
      const it = findTpl(st.tplSel);
      if (!it) return;
      if (it.user) { if (!confirm(T("テンプレート「{0}」を消しますか?", it.name))) return; await postStyles({ action: "delete", name: it.name }); }
      else { if (!confirm(T("おすすめ「{0}」を一覧から隠しますか? (「おすすめを戻す」で戻せます)", T(it.name)))) return; await postStyles({ action: "hide", name: it.name }); }
      st.tplSel = "";
    } else if (a === "tplunhide") { for (const n of [...(st.styles?.hidden || [])]) await postStyles({ action: "unhide", name: n }); }
  } catch (e) { ctx.notify(`${T("テンプレートを変えられませんでした")}: ${e.message}`, "error", btn); }
  st.dirty = true;
  delete $('[data-c="txinsp"]').dataset.for;
  refresh();
}
function onTextInput(e) {
  const el = e.target, t = selText();
  if (!t) return;
  if (el.dataset.tc === "tpl") {
    st.tplSel = el.value || "";
    const it = findTpl(el.value);
    if (it) { pushUndo(true); Object.assign(t, STYLE_RESET, it.style); ctx.notify(T("テンプレート「{0}」を当てはめました", T(it.name)), "info"); }
    delete $('[data-c="txinsp"]').dataset.for;
    refresh();
    return;
  }
  const k = el.dataset.k;
  if (!k) return;
  // 1 つの欄を打っている間は 1 回で元に戻せるように、最初の変更のときだけ覚える
  if (st.tEditEl !== el) { pushUndo(true); st.tEditEl = el; }
  if (k === "rot") { const n = Number(el.value); if (el.value === "" || Number.isNaN(n)) return; t.rot = clamp(n, -3600, 3600); }
  else if (!applyTextField(t, k, el)) return;
  st.dirty = true;
  draw();
  renderTextList();
  $('[data-c="txflat"]').disabled = !st.texts.length;
}

// ---------------------------------------------------------------- ツール
// 点と点の間も途切れないように、半径の半分ごとに丸を置く
function strokePoints(a, b, r, fn) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / Math.max(1, r / 2)));
  for (let i = 1; i <= n; i++) fn(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
}
const BRUSH_TOOLS = ["erase", "restore", "remove", "rmerase", "mosaic"];
// モザイクの元: 画像全体をモザイク(またはぼかし)にした写し。マス目は画像の左上から並べる(何回なぞってもマスがずれない)
function mosaicData(img, mode, size) {
  const w = img.width, h = img.height;
  const n = Math.max(2, Math.round(size));
  if (mode === "blur") {
    // 端が透けないように、まわりを端の色でのばしてからぼかす
    const p = Math.ceil(n * 3);
    const big = canvasOf(w + p * 2, h + p * 2), g = big.getContext("2d");
    g.drawImage(img, p, p);
    g.drawImage(img, 0, 0, 1, h, 0, p, p, h);
    g.drawImage(img, w - 1, 0, 1, h, p + w, p, p, h);
    g.drawImage(big, 0, p, w + p * 2, 1, 0, 0, w + p * 2, p);
    g.drawImage(big, 0, p + h - 1, w + p * 2, 1, 0, p + h, w + p * 2, p);
    const out = canvasOf(w, h), o = out.getContext("2d");
    o.filter = `blur(${n}px)`;
    if (o.filter && o.filter !== "none") o.drawImage(big, -p, -p);
    else {
      // filter が使えないブラウザ: 縮めて広げる(ぼかしの代わり)
      const sw = Math.max(1, Math.round((w + p * 2) / n)), sh = Math.max(1, Math.round((h + p * 2) / n));
      const sm = canvasOf(sw, sh), sg = sm.getContext("2d");
      sg.imageSmoothingQuality = "high";
      sg.drawImage(big, 0, 0, sw, sh);
      o.filter = "none";
      o.imageSmoothingQuality = "high";
      o.drawImage(sm, 0, 0, sw, sh, -p, -p, w + p * 2, h + p * 2);
    }
    return o.getImageData(0, 0, w, h);
  }
  const src = img.getContext("2d").getImageData(0, 0, w, h), S = src.data;
  const out = new ImageData(w, h), D = out.data;
  for (let by = 0; by < h; by += n) {
    const ye = Math.min(h, by + n);
    for (let bx = 0; bx < w; bx += n) {
      const xe = Math.min(w, bx + n);
      // 透明度で重みを付けて平均する(透明な所の色が混ざって黒ずまないように)
      let r = 0, gg = 0, b = 0, a = 0, cnt = 0;
      for (let y = by; y < ye; y++) {
        for (let x = bx, i = (y * w + bx) * 4; x < xe; x++, i += 4) {
          const al = S[i + 3];
          r += S[i] * al; gg += S[i + 1] * al; b += S[i + 2] * al; a += al; cnt++;
        }
      }
      const R = a ? Math.round(r / a) : 0, G = a ? Math.round(gg / a) : 0, B = a ? Math.round(b / a) : 0, A = Math.round(a / cnt);
      for (let y = by; y < ye; y++) {
        for (let x = bx, i = (y * w + bx) * 4; x < xe; x++, i += 4) { D[i] = R; D[i + 1] = G; D[i + 2] = B; D[i + 3] = A; }
      }
    }
  }
  return out;
}
// 消しゴム・戻すブラシ・モザイク: なぞった形(1 回なぞる間の分)を別の板に描き、なぞり始めの画像に「形 × アルファ値」で掛ける。
// 1 回なぞる間は重ねても濃くならない。もう一度なぞると、そこからさらに掛かる
function strokeBegin() {
  const w = st.img.width, h = st.img.height;
  st.stroke = { base: st.img.getContext("2d").getImageData(0, 0, w, h), mask: canvasOf(w, h), box: null };
  if (st.tool === "restore" && st._origOf !== st.orig) {
    st._origOf = st.orig;
    st._origData = st.orig.getContext("2d").getImageData(0, 0, w, h);
  }
  if (st.tool === "mosaic") st.stroke.src = mosaicData(st.img, st.mzmode, st.mzsize);
}
function strokeApply() {
  const S = st.stroke;
  if (!S?.box) return;
  const w = st.img.width, h = st.img.height;
  const x0 = Math.max(0, Math.floor(S.box.x0)), y0 = Math.max(0, Math.floor(S.box.y0));
  const x1 = Math.min(w, Math.ceil(S.box.x1)), y1 = Math.min(h, Math.ceil(S.box.y1));
  S.box = null;
  if (x1 <= x0 || y1 <= y0) return;
  const bw = x1 - x0, bh = y1 - y0;
  const m = S.mask.getContext("2d").getImageData(x0, y0, bw, bh).data;
  const g = st.img.getContext("2d");
  st.pxv = (st.pxv || 0) + 1; // 画素が変わった(ふち取りを作り直す)
  const out = g.getImageData(x0, y0, bw, bh);
  const d = out.data, B = S.base.data, O = (S.src || st._origData)?.data;
  const a = clamp(st.balpha, 1, 100) / 100;
  const erase = st.tool === "erase";
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const i = (yy * bw + xx) * 4;
      const mv = (m[i + 3] / 255) * a;
      if (mv <= 0) continue;
      const j = ((y0 + yy) * w + x0 + xx) * 4;
      if (erase) {
        d[i] = B[j]; d[i + 1] = B[j + 1]; d[i + 2] = B[j + 2];
        d[i + 3] = Math.round(B[j + 3] * (1 - mv));
      } else {
        // 透明度で重みを付けて混ぜる(透明な所の色が混ざって縁が黒くならないように)
        const ba = B[j + 3] * (1 - mv), oa = O[j + 3] * mv, na = ba + oa;
        if (na <= 0) { d[i + 3] = 0; continue; }
        for (let c = 0; c < 3; c++) d[i + c] = Math.round((B[j + c] * ba + O[j + c] * oa) / na);
        d[i + 3] = Math.round(na);
      }
    }
  }
  g.putImageData(out, x0, y0);
}
function dab(x, y) {
  const r = st.brush / 2;
  if (st.tool === "erase" || st.tool === "restore" || st.tool === "mosaic") {
    const g = st.stroke.mask.getContext("2d");
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    const b = st.stroke.box;
    st.stroke.box = { x0: Math.min(b ? b.x0 : Infinity, x - r - 1), y0: Math.min(b ? b.y0 : Infinity, y - r - 1),
      x1: Math.max(b ? b.x1 : -Infinity, x + r + 1), y1: Math.max(b ? b.y1 : -Infinity, y + r + 1) };
  } else if (st.tool === "remove" || st.tool === "rmerase") {
    const g = st.paint.getContext("2d");
    g.fillStyle = "#ff3b30"; // 塗りの形だけを使う(見える色は表示のときに付ける)
    if (st.tool === "rmerase") g.globalCompositeOperation = "destination-out"; // 塗りを消す
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
    st.paint._v = (st.paint._v || 0) + 1;
  }
}
// 塗りの色(パネルの「マスクを描く」と共通。このブラウザに覚える)
export const MASK_COLOR_LS = "cca_generator.maskcolor";
function maskColor() {
  try { const c = localStorage.getItem(MASK_COLOR_LS); if (/^#[0-9a-f]{6}$/i.test(c || "")) return c; } catch { /* 既定の色 */ }
  return "#ff3b30";
}
// 塗りを今の色で描いたもの(塗り・色が変わったときだけ作り直す)
const tint = { cv: document.createElement("canvas"), src: null, v: -1, color: "" };
function tintedPaint() {
  const p = st.paint, color = maskColor();
  if (tint.src !== p || tint.v !== (p._v || 0) || tint.color !== color) {
    const c = tint.cv;
    if (c.width !== p.width || c.height !== p.height) { c.width = p.width; c.height = p.height; }
    const g = c.getContext("2d");
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(p, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "source-over";
    tint.src = p; tint.v = p._v || 0; tint.color = color;
  }
  return tint.cv;
}
// クリックした所と似た色を透明にする(つながっている所だけ / 画像全体)
function wandAt(px, py) {
  const w = st.img.width, h = st.img.height;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
  const g = st.img.getContext("2d");
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const i0 = (y0 * w + x0) * 4;
  const [r0, g0, b0] = [d[i0], d[i0 + 1], d[i0 + 2]];
  const tol2 = st.tol * st.tol * 3;
  const near = (i) => { const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0; return dr * dr + dg * dg + db * db <= tol2; };
  pushUndo();
  if (!st.contig) {
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] && near(i)) d[i + 3] = 0;
  } else {
    const seen = new Uint8Array(w * h);
    const stack = [y0 * w + x0];
    while (stack.length) {
      const q = stack.pop();
      if (seen[q]) continue;
      seen[q] = 1;
      const i = q * 4;
      if (!d[i + 3] && q !== y0 * w + x0) continue;
      if (!near(i)) continue;
      d[i + 3] = 0;
      const x = q % w, y = (q - x) / w;
      if (x > 0) stack.push(q - 1);
      if (x < w - 1) stack.push(q + 1);
      if (y > 0) stack.push(q - w);
      if (y < h - 1) stack.push(q + w);
    }
  }
  st.img.getContext("2d").putImageData(img, 0, 0); // pushUndo で写した方に
  return true;
}

// ---------------------------------------------------------------- 背景を自動で消す(ComfyUI 本体の BiRefNet)と数値での調整
async function uploadTemp(c, name) {
  const body = new FormData();
  // 同じ名前で上書きし合わないように、毎回ちがう名前にする(終わったら tempCleanup で消す)
  name = name.replace(/\.png$/, `_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`);
  body.append("image", await toBlob(c), name);
  body.append("type", "temp");
  body.append("subfolder", "cca_edit");
  body.append("overwrite", "true");
  const r = await api.fetchApi("/upload/image", { method: "POST", body });
  if (!r.ok) throw new Error(`upload ${r.status}`);
  const j = await r.json();
  st.tmpFiles.push({ filename: j.name, subfolder: j.subfolder || "", type: "temp" });
  return `${j.subfolder ? `${j.subfolder}/` : ""}${j.name} [temp]`;
}
function resultUrl(out, id) {
  const it = out?.outputs?.[id]?.images?.[0];
  if (!it) throw new Error("結果の画像が返ってきませんでした");
  // 片付けで temp が空になると、次の結果が同じ名前になる → ブラウザが前の画像を出さないよう、毎回ちがう URL にする
  const q = new URLSearchParams({ filename: it.filename, subfolder: it.subfolder || "", type: it.type || "temp", t: `${Date.now()}${Math.random().toString(36).slice(2, 6)}` });
  return api.apiURL(`/view?${q}`);
}
// 足りない・壊れているファイルの案内。生成パネルの「見つかりません」と同じ箱を、ファイルごとにたたんで並べる
// items: [{label, name, kind, status?: "broken", why?}]
function showFileGuide(box, items, lead) {
  box.hidden = false;
  box.innerHTML = `<div class="lead">${esc(lead)}</div>` + items.map((x, i) => `<div data-f="${i}"></div>`).join("")
    + `<div class="row" style="margin-top:8px"><button data-c="reload">🔄 一覧を読み直す</button></div>`;
  box.querySelector('[data-c="reload"]').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await ctx.refreshChoices(); fillRm(); box.hidden = true; ctx.notify("モデル一覧を読み直しました", "info", b, { toast: false }); }
    catch (err) { ctx.notify(`モデル一覧を読み込めませんでした: ${err.message}`, "error", b); }
    finally { b.disabled = false; }
  };
  items.forEach((x, i) => ctx.renderFileHelp(box.querySelector(`[data-f="${i}"]`), x.kind, x.name, {
    status: x.status, label: x.label, why: x.why, open: items.length === 1,
    hint: "入れたら、下の「🔄 一覧を読み直す」を押してください。",
  }));
}
// 選んだファイルが壊れていないか調べる。壊れていれば案内に並べるもの、無ければ []
async function brokenItems(picks) {
  const out = [];
  for (const p of picks) {
    if (!p.name) continue;
    let r = null;
    try { r = await ctx.fileCheck(p.kind, p.name); } catch { r = null; }
    if (!r?.broken) continue;
    const size = r.need ? T("大きさ {0}(本来は {1})", mb(r.size), mb(r.need)) : T("中身が読めません");
    const why = r.better
      ? T("このファイルは配布元の時点で途中までしか入っていません({0})。同じ配布ページの次のファイルを入れて、こちらは消すか別の場所へ移してください: {1}", size, r.better)
      : T("途中で切れています({0})。ダウンロードかコピーが途中で止まった可能性があります。もう一度ダウンロードしてください。", size);
    out.push({ ...p, status: "broken", why });
  }
  return out;
}
function mb(n) { return `${(Number(n) / 1048576).toFixed(1)} MB`; }
// ---------------------------------------------------------------- 時間のかかる処理の進み具合(背景を消す・オブジェクト除去)
// 何をしているか・進み具合のバー・経過時間・あとどのくらい(ステップの進み方か、前回かかった時間から)・中止
const JOB_LS = "cca_generator.imgedit.jobtime.";
const mmss = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const JOB_NODE = {
  LoadImage: "画像を読み込んでいます…", LoadImageMask: "画像を読み込んでいます…",
  LoadBackgroundRemovalModel: "モデルを読み込んでいます…(初回は時間がかかります)",
  RemoveBackground: "背景を消しています…",
  CCAObjectRemove: "モデルを読み込んでいます…(初回は時間がかかります)",
  CCALamaRemove: "LaMa で消しています…(初回はモデルの読み込みもあります)",
  InvertMask: "仕上げています…", JoinImageWithAlpha: "仕上げています…", PreviewImage: "仕上げています…",
};
function jobStart(kind, title) {
  let prev = 0;
  try { prev = Number(localStorage.getItem(JOB_LS + kind)) || 0; } catch { /* 覚えていなくてもよい */ }
  const j = { kind, prev, t0: performance.now(), tRun: performance.now(), waiting: false, stage: T("ファイルを確かめています…"), value: 0, max: 0, p1: null, cancel: false, timer: 0 };
  st.job = j;
  const b = $(".busy");
  b.innerHTML = `<div class="jt"></div><div class="js"></div><div class="jb"><i></i></div><div class="jm"><span class="je"></span><span class="jr"></span></div>
    <button class="jc" title="この処理をやめます(順番待ちなら取り消します)">中止</button>`;
  b.querySelector(".jt").textContent = title;
  b.querySelector(".jc").onclick = () => { j.cancel = true; j.stage = T("止めています…"); jobRender(); };
  b.classList.add("job");
  busy(title);
  j.timer = setInterval(jobRender, 500);
  jobRender();
  return j;
}
function jobStage(text) { if (st.job && !st.job.cancel) { st.job.stage = text; jobRender(); } }
// runMini から来る知らせ(順番待ち・動いているノード・ステップ)
function jobStatus(x) {
  const j = st.job;
  if (!j || j.cancel) return;
  const now = performance.now();
  if (x.phase === "wait") {
    j.waiting = x.ahead > 0;
    j.stage = x.ahead > 0 ? T("順番待ち(前に {0} 件。生成などが終わるのを待っています)", x.ahead) : T("始まるのを待っています…");
  } else {
    if (j.waiting) { j.waiting = false; j.tRun = now; }
    if (x.phase === "node" && JOB_NODE[x.type] && !(x.type === "CCAObjectRemove" && j.max > 1)) j.stage = T(JOB_NODE[x.type]);
    if (x.phase === "progress" && x.max > 1) {
      if (x.max !== j.max || x.value < j.value) j.p1 = null;
      j.value = x.value; j.max = x.max;
      if (!j.p1) j.p1 = { t: now, v: x.value };
      j.stage = x.type === "CCAObjectRemove" ? T("AI で消しています({0} / {1} ステップ)", x.value, x.max) : T("処理しています({0} / {1})", x.value, x.max);
    }
  }
  jobRender();
}
function jobRender() {
  const j = st.job, b = $(".busy");
  if (!j || !b?.classList.contains("job")) return;
  const now = performance.now(), run = now - j.tRun;
  const bar = b.querySelector(".jb"), fill = bar.querySelector("i");
  let eta = "";
  const ind = (on) => { bar.classList.toggle("ind", on); if (on) fill.style.width = ""; };
  if (j.waiting) ind(true);
  else if (j.max > 1) {
    ind(false);
    fill.style.width = `${Math.round((j.value / j.max) * 100)}%`;
    if (j.p1 && j.value > j.p1.v) eta = T("あと約 {0}", mmss(((now - j.p1.t) / (j.value - j.p1.v)) * (j.max - j.value)));
    else eta = T("時間を計っています…");
  } else if (j.prev > 0 && run < j.prev * 0.97) {
    ind(false);
    fill.style.width = `${Math.round((run / j.prev) * 100)}%`;
    eta = T("あと約 {0}(前回かかった時間から)", mmss(j.prev - run));
  } else if (j.prev > 0) {
    ind(true);
    eta = T("前回は {0} でした。もう少しお待ちください", mmss(j.prev));
  } else {
    ind(true);
    eta = T("初めてのときは、モデルの読み込みに数分かかることがあります");
  }
  b.querySelector(".js").textContent = j.stage;
  b.querySelector(".je").textContent = T("経過 {0}", mmss(now - j.t0));
  b.querySelector(".jr").textContent = eta;
  b.querySelector(".jc").disabled = j.cancel;
}
function jobEnd(ok) {
  const j = st.job;
  if (!j) return;
  clearInterval(j.timer);
  if (ok) { try { localStorage.setItem(JOB_LS + j.kind, String(Math.round(performance.now() - j.tRun))); } catch { /* 覚えなくてもよい */ } }
  st.job = null;
  $(".busy").classList.remove("job");
}
const jobCancelled = () => { const e = new Error(T("中止しました")); e.cancelled = true; return e; };
// 作業用の画像(temp/cca_edit)と、結果の画像(temp の PreviewImage)を、処理が終わるたびに消す
function tempCleanup(out) {
  const files = st.tmpFiles.splice(0);
  for (const o of Object.values(out?.outputs || {})) for (const im of o.images || []) if ((im.type || "temp") === "temp") files.push(im);
  if (!files.length) return;
  api.fetchApi("/cca_generator/temp_cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) }).catch(() => {});
}
// 失敗・中止の知らせ
function jobFail(e, msg, btn) {
  if (e?.cancelled) ctx.notify(T("中止しました"), "info", btn, { toast: false });
  else ctx.notify(`${T(msg)}: ${e.message}`, "error", btn);
}
async function autoBg(btn) {
  if (!st.img || st.busy) return;
  const models = ctx.choices().bg_models || [];
  const guide = $('[data-c="bgguide"]');
  if (!models.length) {
    showFileGuide(guide, [{ key: "bg", label: "背景を消すモデル", name: "birefnet.safetensors", kind: "background_removal" }],
      "背景を自動で消すには、BiRefNet のモデル(約 440MB)が必要です。入れたら、生成パネルの 🔄 を押してください(ComfyUI 本体の機能なので、追加のインストールはいりません)。");
    return;
  }
  const model = models.find((m) => /birefnet/i.test(m)) || models[0];
  // ファイルを確かめている間も「処理中」にする(その間にほかの操作をさせない)
  const job = jobStart("bg", T("背景を消しています(AI)"));
  const bad = await brokenItems([{ label: "背景を消すモデル", name: model, kind: "background_removal" }]);
  if (bad.length) {
    jobEnd(false); busy(""); refresh();
    showFileGuide(guide, bad, "背景を消すモデルのファイルが壊れています。入れ直してから、もう一度押してください。");
    return;
  }
  guide.hidden = true;
  let out = null, ok = false;
  try {
    if (job.cancel) throw jobCancelled();
    jobStage(T("画像を送っています…"));
    const v = await uploadTemp(st.img, "bg_src.png");
    out = await ctx.runMini({
      1: { class_type: "LoadImage", inputs: { image: v } },
      2: { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: model } },
      3: { class_type: "RemoveBackground", inputs: { bg_removal_model: ["2", 0], image: ["1", 0] } },
      4: { class_type: "InvertMask", inputs: { mask: ["3", 0] } },
      5: { class_type: "JoinImageWithAlpha", inputs: { image: ["1", 0], alpha: ["4", 0] } },
      6: { class_type: "PreviewImage", inputs: { images: ["5", 0] } },
    }, { onStatus: jobStatus, job });
    jobStage(T("結果を読み込んでいます…"));
    const im = await loadImg(resultUrl(out, "6"));
    const res = toCanvas(im);
    const w = st.img.width, h = st.img.height;
    const rd = res.getContext("2d").getImageData(0, 0, w, h).data;
    const mask = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = rd[i * 4 + 3] / 255;
    pushUndo();
    st.bg = { base: copyCanvas(st.img), mask, w, h };
    applyBg();
    refresh();
    ctx.notify("背景を消しました。数値で縁を調整できます", "info", btn, { toast: false });
    ok = true;
  } catch (e) {
    jobFail(e, "背景を消せませんでした", btn);
  } finally { tempCleanup(out); jobEnd(ok); busy(""); refresh(); }
}
// 1 列の窓の最大・最小(半径 r)。O(n)
function slideExt(src, dst, n, stride, off, r, isMax) {
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  const v = (i) => src[off + i * stride];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + r);
    for (; j <= hi; j++) {
      while (tail > head && (isMax ? v(dq[tail - 1]) <= v(j) : v(dq[tail - 1]) >= v(j))) tail--;
      dq[tail++] = j;
    }
    while (dq[head] < i - r) head++;
    dst[off + i * stride] = v(dq[head]);
  }
}
function morph(a, w, h, r, isMax) {
  if (r <= 0) return a;
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) slideExt(a, t, w, 1, y * w, r, isMax);
  for (let x = 0; x < w; x++) slideExt(t, o, h, w, x, r, isMax);
  return o;
}
function boxBlur(a, w, h, r) {
  if (r <= 0) return a;
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  const pass = (src, dst, n, m, stride, step) => {
    for (let l = 0; l < m; l++) {
      const base = l * step;
      let s = 0;
      for (let i = -r; i <= r; i++) s += src[base + Math.min(n - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < n; i++) {
        dst[base + i * stride] = s / (2 * r + 1);
        s += src[base + Math.min(n - 1, i + r + 1) * stride] - src[base + Math.max(0, i - r) * stride];
      }
    }
  };
  pass(a, t, w, h, 1, w);
  pass(t, o, h, w, w, 1);
  return o;
}
function applyBg() {
  const { base, mask, w, h } = st.bg;
  const { thr, grow, feather } = st.bgp;
  let a = new Float32Array(mask);
  if (thr > 0) {
    const t = thr / 100;
    for (let i = 0; i < a.length; i++) a[i] = a[i] < t ? 0 : t >= 1 ? 1 : (a[i] - t) / (1 - t);
  }
  if (grow > 0) a = morph(a, w, h, grow, true);
  else if (grow < 0) a = morph(a, w, h, -grow, false);
  if (feather > 0) { a = boxBlur(a, w, h, Math.ceil(feather / 2)); a = boxBlur(a, w, h, Math.ceil(feather / 2)); }
  const src = base.getContext("2d").getImageData(0, 0, w, h);
  const d = src.data;
  for (let i = 0; i < w * h; i++) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * Math.max(0, Math.min(1, a[i])));
  st.img = canvasOf(w, h);
  st.img.getContext("2d").putImageData(src, 0, 0);
}
let bgTimer = 0;
function scheduleBg() {
  if (!st.bg) return;
  cancelAnimationFrame(bgTimer);
  bgTimer = requestAnimationFrame(() => { applyBg(); st.dirty = true; refresh(); });
}

// ---------------------------------------------------------------- オブジェクト除去(FLUX.2 Klein 4B + オブジェクト除去 LoRA)
function paintBox() {
  if (!st.paint) return null;
  const w = st.paint.width, h = st.paint.height;
  if (!st.paint._dirty && st.paint._box !== undefined) return st.paint._box;
  const d = st.paint.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const pad = 4;
  st.paint._box = x1 < 0 ? null : { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + 1 + pad), y1: Math.min(h, y1 + 1 + pad) };
  st.paint._dirty = false;
  return st.paint._box;
}
function rmLists() {
  const c = ctx.choices();
  const lists = { unet: c.unets || [], lora: c.loras || [], clip: c.clips || [], vae: c.vaes || [] };
  const out = {};
  for (const [k, spec] of Object.entries(RM)) {
    let l = lists[k].filter((f) => f && f !== "(none)" && spec.re.test(f) && !(spec.not && spec.not.test(f)));
    if (spec.prefer) l = [...l.filter((f) => spec.prefer.test(f)), ...l.filter((f) => !spec.prefer.test(f))];
    out[k] = l;
  }
  return out;
}
function fillRm() {
  const lists = rmLists();
  for (const k of Object.keys(RM)) {
    const sel = $(`[data-rm="${k}"]`);
    const cur = sel.value;
    sel.innerHTML = lists[k].length ? lists[k].map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")
      : `<option value="">${esc(T("(見つかりません)"))}</option>`;
    // 自分で選んだものはそのまま。そうでなければ一覧の先頭(おすすめの順)。壊れたファイルの代わりを入れたときに、代わりの方へ移る
    if (lists[k].includes(cur) && sel.dataset.user === "1") sel.value = cur;
    else sel.dataset.user = "";
  }
  rmDefaults();
  fillLama();
  autoRmMethod();
}
// 方法を自分で選んでいなければ、入っているものを使う(LaMa があれば LaMa、FLUX のファイルがそろっていれば FLUX、どちらも無ければ軽い LaMa)
function autoRmMethod() {
  let saved = null;
  try { saved = localStorage.getItem("cca_generator.imgedit.rmmethod"); } catch { saved = null; }
  if (saved === "lama" || saved === "flux") st.rmMethod = saved;
  else if (!st.rmChosen) {
    const fl = rmLists();
    st.rmMethod = lamaList().length ? "lama" : Object.keys(RM).every((k) => fl[k].length) ? "flux" : "lama";
  }
  refreshRmMethod();
}
// 蒸留版(base の付かない 4B)は 4 ステップ・CFG 1、Base は 20 ステップ・CFG 5(パネルの FLUX.2 Klein と同じ)
function rmDefaults() {
  const u = $('[data-rm="unet"]').value || "";
  const base = /base/i.test(u);
  setVal("rmsteps", base ? 20 : 4);
  setVal("rmcfg", base ? 5 : 1);
}
function setVal(k, v) { $(`[data-c="${k}"]`).value = v; const n = $(`[data-n="${k}"]`); if (n) n.value = v; }
// オブジェクト除去の設定(ステップ数・CFG はモデルで決まるので覚えない)。このブラウザに覚える
const RM_LS = "cca_generator.imgedit.rmopts";
const RM_KEEP = ["rmstr", "rmmp", "rmgrow", "rmfeather", "rmcolor", "rmseed", "rmarea", "lamagrow", "lamafeather", "lamacolor", "lamaside"];
function rmSave() {
  const o = {};
  for (const k of RM_KEEP) o[k] = $(`[data-c="${k}"]`).value;
  try { localStorage.setItem(RM_LS, JSON.stringify(o)); } catch { /* 覚えられなくても使える */ }
}
function rmLoad() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(RM_LS) || "{}") || {}; } catch { o = {}; }
  for (const k of RM_KEEP) if (o[k] !== undefined && o[k] !== "") setVal(k, o[k]);
}
function rmSeed() {
  const v = Math.floor(Number($('[data-c="rmseed"]').value));
  return Number.isFinite(v) && v >= 0 ? v % 4294967296 : Math.floor(Math.random() * 2 ** 31);
}
function num(k) { return Number($(`[data-n="${k}"]`).value); }
// オブジェクト除去: 軽い(LaMa・塗った所だけを埋める)/ きれい(FLUX.2 Klein + オブジェクト除去 LoRA・塗った所を囲む四角の中を作り直す)
const LAMA = { re: /\.(pt|pth|safetensors|ckpt)$/i, prefer: /big[-_]?lama/i, rec: "big-lama.pt", kind: "inpaint" };
function lamaList() {
  const l = (ctx.choices().inpaint_models || []).filter((f) => LAMA.re.test(f));
  return [...l.filter((f) => LAMA.prefer.test(f)), ...l.filter((f) => !LAMA.prefer.test(f))];
}
function fillLama() {
  const sel = $('[data-c="lamamodel"]');
  const list = lamaList(), cur = sel.value;
  sel.innerHTML = list.length ? list.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")
    : `<option value="">${esc(T("(見つかりません)"))}</option>`;
  if (list.includes(cur) && sel.dataset.user === "1") sel.value = cur;
  else sel.dataset.user = "";
}
function refreshRmMethod() {
  const lama = st.rmMethod === "lama";
  $('[data-c="rmmethod"]').value = st.rmMethod;
  $('[data-c="rmlama"]').hidden = !lama;
  $('[data-c="rmset"]').hidden = lama;
  $('[data-c="rmnote"]').textContent = lama
    ? "「オブジェクト除去(塗る)」で消したい部分を塗り、「塗った所を消す」を押します。LaMa で、塗った所をまわりに合わせて埋めます(軽くて速い。CPU でも数秒)。塗った所の外は元のままです。"
    : "「オブジェクト除去(塗る)」で消したい部分を塗り、「塗った所を消す」を押します。FLUX.2 Klein 4B とオブジェクト除去 LoRA で、まわりに合わせて埋めます(塗った所のまわりを作り直し、塗った所だけを入れ替えます。色は周りに合わせます。重い代わりに、複雑な所もきれいに埋まります)。";
}
// 塗った所 = 白、それ以外 = 黒 の画像(LoadImageMask の赤で読む)
function paintMaskCanvas() {
  const w = st.paint.width, h = st.paint.height;
  const src = st.paint.getContext("2d").getImageData(0, 0, w, h).data;
  const c = canvasOf(w, h), g = c.getContext("2d");
  const out = g.createImageData(w, h), d = out.data;
  for (let i = 0; i < d.length; i += 4) { const v = src[i + 3] > 8 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(out, 0, 0);
  return c;
}
// 結果の色を使い、透明度は今の画像のまま
async function applyRemoved(url, btn) {
  const res = toCanvas(await loadImg(url));
  const w = st.img.width, h = st.img.height;
  const cur = st.img.getContext("2d").getImageData(0, 0, w, h);
  const rd = res.getContext("2d").getImageData(0, 0, w, h).data;
  const d = cur.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = rd[i]; d[i + 1] = rd[i + 1]; d[i + 2] = rd[i + 2]; }
  pushUndo(); // 元に戻すと、消す前の画像と塗りに戻る(同じ所をやり直せる)
  endBg();
  st.img = canvasOf(w, h);
  st.img.getContext("2d").putImageData(cur, 0, 0);
  clearPaint();
  refresh();
  ctx.notify("塗った範囲のオブジェクトを除去しました", "info", btn, { toast: false });
}
async function runRemove(btn) {
  if (!st.img || st.busy) return;
  const box = paintBox();
  if (!box) { ctx.notify("先に、消したい部分を「オブジェクト除去(塗る)」で塗ってください。", "error", btn); return; }
  if (st.rmMethod === "lama") return runLama(btn);
  const lists = rmLists();
  const guide = $('[data-c="rmguide"]');
  const missing = Object.keys(RM).filter((k) => !lists[k].length).map((k) => ({ key: k, label: RM_LABEL[k], name: RM[k].rec, kind: RM[k].kind }));
  if (missing.length) {
    showFileGuide(guide, missing, "オブジェクトを除去するには、次のファイルが必要です。入れたら、生成パネルの 🔄 を押してください(ComfyUI 本体の機能だけで動くので、追加のインストールはいりません)。");
    return;
  }
  const pick = (k) => $(`[data-rm="${k}"]`).value || lists[k][0];
  // ファイルを確かめている間も「処理中」にする(その間にほかの操作をさせない)
  const job = jobStart("rm", T("オブジェクトを除去しています(AI)"));
  const bad = await brokenItems(Object.keys(RM).map((k) => ({ key: k, label: RM_LABEL[k], name: pick(k), kind: RM[k].kind })));
  if (bad.length) {
    jobEnd(false); busy(""); refresh();
    showFileGuide(guide, bad, "オブジェクト除去に使うファイルが壊れています。入れ直してから、もう一度押してください。");
    return;
  }
  guide.hidden = true;
  let out = null, ok = false;
  try {
    if (job.cancel) throw jobCancelled();
    jobStage(T("画像を送っています…"));
    const v = await uploadTemp(st.img, "rm_src.png");
    const mk = await uploadTemp(paintMaskCanvas(), "rm_mask.png");
    out = await ctx.runMini({
      1: { class_type: "LoadImage", inputs: { image: v } },
      2: { class_type: "CCAObjectRemove", inputs: {
        image: ["1", 0], x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1,
        unet_name: pick("unet"), clip_name: pick("clip"), vae_name: pick("vae"), lora_name: pick("lora"),
        lora_strength: num("rmstr"), steps: Math.round(num("rmsteps")), cfg: num("rmcfg"),
        seed: rmSeed(),
        mask: ["4", 0], area: $('[data-c="rmarea"]').value === "box" ? "box" : "paint",
        grow: Math.round(num("rmgrow")), feather: Math.round(num("rmfeather")), color_match: num("rmcolor") / 100, megapixels: num("rmmp"),
      } },
      4: { class_type: "LoadImageMask", inputs: { image: mk, channel: "red" } },
      3: { class_type: "PreviewImage", inputs: { images: ["2", 0] } },
    }, { onStatus: jobStatus, job });
    jobStage(T("結果を読み込んでいます…"));
    await applyRemoved(resultUrl(out, "3"), btn);
    ok = true;
  } catch (e) {
    jobFail(e, "オブジェクトを除去できませんでした", btn);
  } finally { tempCleanup(out); jobEnd(ok); busy(""); refresh(); }
}
async function runLama(btn) {
  const guide = $('[data-c="rmguide"]');
  const list = lamaList();
  if (!list.length) {
    showFileGuide(guide, [{ key: "lama", label: "オブジェクト除去モデル(LaMa)", name: LAMA.rec, kind: LAMA.kind }],
      "軽い方法でオブジェクトを除去するには、LaMa のモデル(big-lama.pt・約 200MB)が必要です。入れたら、下の「🔄 一覧を読み直す」を押してください(ComfyUI 本体の機能だけで動くので、追加のインストールはいりません)。");
    return;
  }
  const model = $('[data-c="lamamodel"]').value || list[0];
  const job = jobStart("lama", T("オブジェクトを除去しています(LaMa)"));
  const bad = await brokenItems([{ key: "lama", label: "オブジェクト除去モデル(LaMa)", name: model, kind: LAMA.kind }]);
  if (bad.length) {
    jobEnd(false); busy(""); refresh();
    showFileGuide(guide, bad, "オブジェクト除去モデルのファイルが壊れています。入れ直してから、もう一度押してください。");
    return;
  }
  guide.hidden = true;
  let out = null, ok = false;
  try {
    if (job.cancel) throw jobCancelled();
    jobStage(T("画像を送っています…"));
    const v = await uploadTemp(st.img, "rm_src.png");
    const mk = await uploadTemp(paintMaskCanvas(), "rm_mask.png");
    out = await ctx.runMini({
      1: { class_type: "LoadImage", inputs: { image: v } },
      2: { class_type: "LoadImageMask", inputs: { image: mk, channel: "red" } },
      3: { class_type: "CCALamaRemove", inputs: { image: ["1", 0], mask: ["2", 0], model_name: model, grow: Math.round(num("lamagrow")),
        max_side: Math.round(num("lamaside") / 8) * 8, feather: Math.round(num("lamafeather")), color_match: num("lamacolor") / 100 } },
      4: { class_type: "PreviewImage", inputs: { images: ["3", 0] } },
    }, { onStatus: jobStatus, job });
    jobStage(T("結果を読み込んでいます…"));
    await applyRemoved(resultUrl(out, "4"), btn);
    ok = true;
  } catch (e) {
    jobFail(e, "オブジェクトを除去できませんでした", btn);
  } finally { tempCleanup(out); jobEnd(ok); busy(""); refresh(); }
}
function clearPaint() {
  if (!st.img) return;
  st.paint = canvasOf(st.img.width, st.img.height);
  st.paint._dirty = true;
}

// ---------------------------------------------------------------- 保存・ダウンロード・入力画像1に使う
async function save(btn) {
  if (!st.layers.length) return null;
  const { blob, ext, name } = await exportBlob();
  const body = new FormData();
  body.append("image", blob, `edit.${ext}`);
  body.append("source", st.source || "image.png");
  body.append("ext", ext);
  if (String(st.out.name || "").trim()) body.append("name", name); // 名前を決めたとき(空なら「元の名前_edit」)
  const pre = ctx.outPrefix?.();
  if (pre != null) body.append("prefix", pre); // 生成パネルの「画像の保存先」のフォルダに保存する
  const r = await api.fetchApi("/cca_generator/imgedit/save", { method: "POST", body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `${r.status}`);
  st.saved = j;
  st.dirty = false;
  refresh();
  ctx.onSaved?.(j);
  ctx.notify(`保存しました: ${j.path}`, "info", btn, { sticky: true, file: { filename: j.filename, subfolder: j.subfolder || "", type: j.type || "output" } });
  return j;
}
async function copyToClipboard() {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error(T("このブラウザでは画像をクリップボードにコピーできません(https か localhost で開いてください)"));
  const c = renderComposite();
  const blob = new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(T("画像を作れませんでした")))), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
async function download() {
  const { blob, ext, name } = await exportBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------- 操作
function bind() {
  const cv = $(".stage > canvas");
  const stage = $(".stage");
  $('[data-c="close"]').onclick = () => close();
  $('[data-c="hsave"]').onclick = (e) => histSave(false, e.currentTarget);
  $('[data-c="hist"]').onclick = () => histList();
  $('[data-c="undo"]').onclick = () => undo();
  $('[data-c="redo"]').onclick = () => redo();
  $('[data-c="save"]').onclick = async (e) => {
    const b = e.currentTarget;
    try { busy("保存しています…"); await save(b); } catch (err) { ctx.notify(`保存できませんでした: ${err.message}`, "error", b); } finally { busy(""); refresh(); }
  };
  $('[data-c="download"]').onclick = async (e) => {
    try { await download(); } catch (err) { ctx.notify(`ダウンロードできませんでした: ${err.message}`, "error", e.currentTarget); }
  };
  $('[data-c="copyimg"]').onclick = async (e) => {
    const b = e.currentTarget;
    try { await copyToClipboard(); ctx.notify(T("クリップボードにコピーしました"), "info", b); }
    catch (err) { ctx.notify(`${T("クリップボードにコピーできませんでした")}: ${err.message}`, "error", b); }
  };
  $('[data-c="use"]').onclick = async (e) => {
    const b = e.currentTarget;
    try {
      busy("保存しています…");
      const j = st.saved && !st.dirty ? st.saved : await save(b);
      await ctx.useAsImage1(j.value);
      ctx.notify("編集した画像を入力画像1にしました", "info");
      busy("");
      close(true);
    } catch (err) { ctx.notify(`入力画像1にできませんでした: ${err.message}`, "error", b); } finally { busy(""); }
  };
  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => openFile(input.files?.[0]);
    input.click();
  };
  // 画像を置く(選ぶ / パソコンから)
  $('[data-c="placerf"]').onclick = async (e) => { // 最新の一覧に
    const b = e.currentTarget;
    b.disabled = true;
    try { await ctx.refreshChoices?.(); fillPick(); } finally { b.disabled = false; }
  };
  $('[data-c="placepick"]').onchange = async (e) => {
    const v = e.target.value;
    e.target.value = "";
    if (!v) return;
    // 何も開いていなければ、その画像を開く(元の画像として。保存の名前は「元の名前_edit」)。開いていればレイヤーとして挿入
    try { busy("読み込み中…"); if (st.layers.length) await placeValue(v); else await openValue(v); } catch (err) { ctx.notify(err.message, "error", e.target); } finally { busy(""); }
  };
  $('[data-c="placeup"]').onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async () => { for (const f of [...(input.files || [])]) await placeFile(f); };
    input.click();
  };
  const ly = $('[data-c="lylist"]');
  ly.addEventListener("click", (e) => {
    const v = e.target.closest("[data-lv]");
    if (v) {
      const l = st.layers.find((x) => x.id === Number(v.dataset.lv));
      if (l) { pushUndo(true); l.hidden = !l.hidden; st.dirty = true; refresh(); }
      return;
    }
    const row = e.target.closest("[data-lid]");
    if (!row) return;
    const l = st.layers.find((x) => x.id === Number(row.dataset.lid));
    if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelect(l); refresh(); return; }
    selectLayer(l);
    if (l?.kind === "text" && !["text", "select"].includes(st.tool)) st.tool = "select";
    if (l?.kind === "image" && st.tool === "text") st.tool = "select";
    refresh();
  });
  let dragId = null;
  ly.addEventListener("dragstart", (e) => { const row = e.target.closest("[data-lid]"); if (!row) return; dragId = Number(row.dataset.lid); e.dataTransfer.setData("text/plain", "cca-layer"); e.dataTransfer.effectAllowed = "move"; });
  ly.addEventListener("dragover", (e) => {
    const row = e.target.closest("[data-lid]");
    if (dragId == null || !row) return;
    e.preventDefault();
    e.stopPropagation();
    const r = row.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    for (const x of ly.querySelectorAll(".dropb,.dropa")) x.classList.remove("dropb", "dropa");
    row.classList.add(before ? "dropb" : "dropa");
  });
  ly.addEventListener("drop", (e) => {
    const row = e.target.closest("[data-lid]");
    if (dragId == null || !row) return;
    e.preventDefault();
    e.stopPropagation();
    const r = row.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    // 行の上半分 = その行より前(配列ではその後ろ)
    moveLayer(dragId, Number(row.dataset.lid), !before);
    dragId = null;
  });
  ly.addEventListener("dragend", () => { dragId = null; for (const x of ly.querySelectorAll(".dropb,.dropa")) x.classList.remove("dropb", "dropa"); });
  for (const b of $$("[data-lo]")) b.onclick = () => layerOp(b.dataset.lo);
  const cvs = $('[data-c="cvsec"]');
  cvs.addEventListener("input", onCanvasUi);
  cvs.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") onCanvasUi(e); });
  cvs.addEventListener("click", (e) => { const b = e.target.closest("[data-ca]"); if (b) canvasAction(b.dataset.ca); });
  $('[data-c="cbox"]').addEventListener("pointerdown", (e) => startCropDrag(e));
  $('[data-c="lcbox"]').addEventListener("pointerdown", (e) => startLayerCropDrag(e));
  const os = $('[data-c="outsec"]');
  os.addEventListener("input", onOutInput);
  os.addEventListener("change", onOutInput);
  loadOut();
  const li = $('[data-c="lyinsp"]');
  li.addEventListener("input", onLayerInput);
  li.addEventListener("change", (e) => { if (e.target.type === "checkbox") onLayerInput(e); });
  li.addEventListener("focusin", () => { st.lyEditEl = null; });
  $('[data-c="lyclip"]').addEventListener("change", onClipInput);
  li.addEventListener("click", (e) => { const b = e.target.closest("[data-la]"); if (b) { b.focus(); layerAction(b.dataset.la); } });
  $('[data-c="ibox"]').addEventListener("pointerdown", (e) => {
    // 前にある別のレイヤーを押したときは、そちらを選ぶ
    if (!e.target.dataset?.h) {
      const r = $(".stage > canvas").getBoundingClientRect();
      const hit = layerAt(e.clientX - r.left, e.clientY - r.top);
      if (hit && (e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleSelect(hit); refresh(); return; }
      if (hit && !selList().includes(hit)) { selectLayer(hit); refresh(); if (isMulti()) startMultiDrag(e); else if (hit.kind === "text") startTextDrag(e); else startImageDrag(e); return; }
    }
    startImageDrag(e);
  });
  $('[data-c="empty"]').onclick = pickFile;
  // ツール・図形: 使っているレイヤーをもう一度押すと「↖ 選択」に戻る
  for (const b of $$("[data-tool]")) b.onclick = () => { st.tool = st.tool === b.dataset.tool ? "select" : b.dataset.tool; refreshTool(); draw(); };
  for (const b of $$("[data-shape]")) b.onclick = () => {
    if (st.tool === "shape" && st.shapeType === b.dataset.shape) st.tool = "select";
    else { st.tool = "shape"; st.shapeType = b.dataset.shape; }
    refreshTool(); draw();
  };
  // 数値: スライダーと数値の欄を同じ値にする
  const pair = (k, fn) => {
    const r = $(`[data-c="${k}"]`), n = $(`[data-n="${k}"]`);
    r.oninput = () => { n.value = r.value; fn(Number(r.value)); };
    n.oninput = () => { if (n.value === "" || Number.isNaN(Number(n.value))) return; r.value = n.value; fn(Number(n.value)); };
  };
  pair("brush", (v) => { st.brush = Math.max(1, v); const rb = $('[data-c="rmbrush"]'); if (rb && rb !== document.activeElement) rb.value = st.brush; draw(); });
  // オブジェクト除去の欄のブラシの太さ(ツールの欄の「ブラシの太さ」と同じ値)
  $('[data-c="rmbrush"]').oninput = (e) => {
    const v = Number(e.target.value);
    if (!v) return;
    st.brush = clamp(v, 2, 400);
    $('[data-c="brush"]').value = st.brush; $('[data-n="brush"]').value = st.brush;
    draw();
  };
  pair("balpha", (v) => { st.balpha = clamp(v, 1, 100); });
  pair("mzsize", (v) => { st.mzsize = clamp(v, 2, 200); });
  // パスツール
  pair("palpha", (v) => { st.popt.alpha = clamp(v, 1, 100) / 100; });
  pair("pwidth", (v) => { st.popt.width = clamp(v, 1, 200); });
  pair("pfeather", (v) => { st.popt.feather = clamp(v, 0, 100); });
  $('[data-c="pcolor"]').oninput = (e) => { st.popt.color = e.target.value; };
  $('[data-c="pathin"]').onclick = () => pathErase(true);
  $('[data-c="pathout"]').onclick = () => pathErase(false);
  $('[data-c="pathfill"]').onclick = () => pathShape(true);
  $('[data-c="pathline"]').onclick = () => pathShape(false);
  $('[data-c="pathback"]').onclick = () => pathBack();
  $('[data-c="pathclear"]').onclick = () => { pathSnap(); st.path = null; draw(); };
  $('[data-c="mzmode"]').onchange = (e) => { st.mzmode = e.target.value === "blur" ? "blur" : "pixel"; refreshTool(); };
  pair("tol", (v) => { st.tol = v; });
  for (const k of ["thr", "grow", "feather"]) pair(k, (v) => { st.bgp[k] = v; scheduleBg(); });
  for (const k of ["rmstr", "rmsteps", "rmcfg", "rmmp", "rmgrow", "rmfeather", "rmcolor"]) pair(k, () => rmSave());
  for (const k of ["rmseed", "rmarea"]) $(`[data-c="${k}"]`).onchange = () => rmSave();
  rmLoad();
  $('[data-c="contig"]').onchange = (e) => { st.contig = e.target.checked; };
  $('[data-c="bg"]').onclick = (e) => autoBg(e.currentTarget);
  $('[data-c="wm"]').onclick = (e) => addWatermark(e.currentTarget);
  $('[data-c="snap"]').onclick = () => setSnap(!st.snap);
  // 右の項目: 折りたたみ(いつでも)・並べ替え(「⇅ 並べ替え」のときだけ)
  sideSplitter($(".main"), "imgedit", $(".side")); // 右の欄の幅をドラッグで変える
  sectionEditBar($('[data-c="secbar"]'), [setupSections($(".side"), { name: "imgedit" })]);
  setSnap(loadSnap());
  bindFrameHl($('[data-c="cvsec"]'), "cca_generator.imgedit.frame", (v) => { st.fhl = v; draw(); });
  $('[data-c="txadd"]').onclick = () => addText(0.5, 0.5);
  $('[data-c="txflat"]').onclick = () => flattenTexts();
  $('[data-c="tlist"]').addEventListener("click", (e) => { const b = e.target.closest("[data-tid]"); if (b) { st.tsel = Number(b.dataset.tid); st.isel = null; if (!["text", "select"].includes(st.tool)) st.tool = "text"; refresh(); } });
  const tx = $('[data-c="txinsp"]');
  tx.addEventListener("input", onTextInput);
  tx.addEventListener("change", (e) => { if (e.target.type === "checkbox") onTextInput(e); });
  tx.addEventListener("focusin", () => { st.tEditEl = null; });
  tx.addEventListener("click", (e) => { const b = e.target.closest("[data-ta]"); if (b) textAction(b.dataset.ta, b); });
  $('[data-c="tbox"]').addEventListener("pointerdown", (e) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const r = $(".stage > canvas").getBoundingClientRect();
      const hit = layerAt(e.clientX - r.left, e.clientY - r.top);
      if (hit) { e.preventDefault(); toggleSelect(hit); refresh(); }
      return;
    }
    startTextDrag(e);
  });
  // 文字をダブルクリックで、画像の上で編集
  $('[data-c="tbox"]').addEventListener("dblclick", (e) => {
    const t = selText();
    if (!t) return;
    const r = $(".stage > canvas").getBoundingClientRect();
    beginTextEdit(t, textIndexAt(t, e.clientX - r.left, e.clientY - r.top));
  });
  const te = $('[data-c="tedit"]');
  te.addEventListener("input", onEditInput);
  te.addEventListener("compositionupdate", () => setTimeout(onEditInput, 0));
  te.addEventListener("blur", () => { setTimeout(() => { if (st.tedit != null && document.activeElement !== te) endTextEdit(); }, 0); });
  // 欄の入力位置・選んだ範囲が変わったら描き直す(右の欄・画像の上の編集)
  document.addEventListener("selectionchange", () => { if (ui?.classList.contains("open") && editSource()) { st.blink = true; draw(); } });
  // 文字を打つ欄に入ったときの中身(打っていなければ Ctrl+Z を画面の「元に戻す」に回す)
  ui.addEventListener("focusin", (e) => {
    // 画像の上の編集の欄は、編集を始めたときの中身(beginTextEdit)のまま(途中で押し直しても、打った分を欄の中で戻せるように)
    if (isTextField(e.target) && e.target.dataset.c !== "tedit") e.target._ccaStart = e.target.value;
    if (e.target?.dataset?.k === "text") { blinkOn(true); draw(); }
  });
  ui.addEventListener("focusout", (e) => { if (e.target?.dataset?.k === "text") setTimeout(() => draw(), 0); });
  fontApi.onChange((info) => {
    if (!ui?.classList.contains("open")) return;
    const t = selText();
    if (info.installed && t) t.font = info.installed.key;
    delete $('[data-c="txinsp"]').dataset.for;
    renderTextInsp();
    draw();
  });
  $('[data-c="rm"]').onclick = (e) => runRemove(e.currentTarget);
  $('[data-c="rmmethod"]').onchange = (e) => {
    st.rmMethod = e.target.value === "flux" ? "flux" : "lama";
    st.rmChosen = true;
    try { localStorage.setItem("cca_generator.imgedit.rmmethod", st.rmMethod); } catch { /* 覚えられなくても使える */ }
    $('[data-c="rmguide"]').hidden = true;
    refreshRmMethod();
  };
  $('[data-c="lamamodel"]').addEventListener("change", (e) => { e.target.dataset.user = "1"; });
  for (const k of ["lamagrow", "lamafeather", "lamacolor", "lamaside"]) pair(k, () => rmSave());
  refreshRmMethod();
  // 塗りを消す(元に戻せる)
  $('[data-c="maskcolor"]').value = maskColor();
  $('[data-c="maskcolor"]').oninput = (e) => { try { localStorage.setItem(MASK_COLOR_LS, e.target.value); } catch { /* 覚えられなくても今は使える */ } draw(); };
  $('[data-c="rmclear"]').onclick = () => { if (!st.img || !paintBox()) return; pushUndo(false, true); clearPaint(); refresh(); };
  for (const k of Object.keys(RM)) $(`[data-rm="${k}"]`).addEventListener("change", (e) => { e.target.dataset.user = "1"; });
  $('[data-rm="unet"]').onchange = () => rmDefaults();

  // キャンバス
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => {
    // 数値の欄に入ったままだと Ctrl+Z などが効かないので、画面に戻す
    if (document.activeElement && ui.contains(document.activeElement) && document.activeElement !== ui) document.activeElement.blur();
    ui.focus({ preventScroll: true });
    if (!st.layers.length || st.busy) return;
    const p = pos(e);
    // 画像の上で文字を編集中: その文字の上なら入力位置・範囲、外なら編集を終える
    if (st.tedit != null) { if (e.button === 0 && editPointer(e, p.x, p.y)) return; endTextEdit(); }
    cv.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.button === 1 || panning()) {
      st.drag = { mode: "pan", last: p };
      cv.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    if (st.lcrop) return;
    if (st.tool === "path") { pathDown(p, e); draw(); return; }
    if (st.tool === "shape") { startShapeDraw(p); draw(); return; }
    if (st.tool === "select") {
      // 押したレイヤーを選んで、そのまま動かす(何も無い所なら選ぶのをやめる)
      const hit = layerAt(p.x, p.y);
      // アートボードの外の何も無い所: 選ぶのをやめて、ドラッグで画面を動かす(ハンドモード)
      if (!hit && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
        const d0 = toDoc(p.x, p.y);
        if (d0.x < 0 || d0.y < 0 || d0.x >= st.W || d0.y >= st.H) {
          selectLayer(null); refresh();
          st.drag = { mode: "pan", last: p };
          cv.style.cursor = "grabbing";
          return;
        }
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (hit) { toggleSelect(hit); refresh(); } return; }
      if (hit && isMulti() && selList().includes(hit)) { startMultiDrag(e); return; }
      selectLayer(hit);
      refresh();
      if (isMulti()) startMultiDrag(e);
      else if (hit?.kind === "text") startTextDrag(e); else if (hit) startImageDrag(e);
      return;
    }
    if (st.tool === "text") {
      // 文字を押すと選ぶ。何も無い所なら、そこに文字を入れる
      const hit = textAt(p.x, p.y), d = toDoc(p.x, p.y);
      if (hit) { st.tsel = hit.id; st.isel = null; refresh(); startTextDrag(e); }
      else if (d.x >= 0 && d.y >= 0 && d.x <= st.W && d.y <= st.H) addText(r3(d.x / st.W), r3(d.y / st.H));
      else { st.tsel = null; refresh(); }
      return;
    }
    // ここからは作業する画像に掛かるツール
    const A = activeImg();
    if (!A || A.hidden) { ctx.notify(T(A ? "作業中の画像が隠れています(一覧の 👁 で見せてください)" : "作業する画像を選んでください(「↖ 選択」で画像を押すか、「レイヤー」の一覧で選びます)"), "info"); return; }
    const q = toImg(p.x, p.y);
    if (st.tool === "wand") {
      endBg();
      if (wandAt(q.x, q.y)) refresh();
      return;
    }
    if (st.tool === "erase" || st.tool === "restore" || st.tool === "mosaic") { endBg(); pushUndo(); strokeBegin(); }
    if (st.tool === "remove" || st.tool === "rmerase") { pushUndo(false, true); st.paint._dirty = true; } // ひと塗りずつ元に戻せる
    st.drag = { mode: "brush", last: q };
    dab(q.x, q.y);
    strokeApply();
    draw();
  });
  cv.addEventListener("pointermove", (e) => {
    const p = pos(e);
    st.mouse = p;
    updZoomv();
    if (!st.drag) { if (BRUSH_TOOLS.includes(st.tool) || (st.tool === "path" && st.path)) draw(); return; }
    if (st.drag.mode === "pan") {
      st.view.px += p.x - st.drag.last.x; st.view.py += p.y - st.drag.last.y;
      st.drag.last = p;
    } else if (st.drag.mode === "shape") {
      moveShapeDraw(p, e);
    } else if (st.drag.mode === "pathsel") {
      const d = toDoc(p.x, p.y);
      for (const [j, x, y] of st.drag.org) { const q = st.path?.pts[j]; if (q) { q.x = r1(x + d.x - st.drag.x0); q.y = r1(y + d.y - st.drag.y0); } }
    } else if (st.drag.mode === "pathpt") {
      const d = toDoc(p.x, p.y), q = st.path?.pts[st.drag.i];
      if (q) { q.x = r1(d.x); q.y = r1(d.y); }
    } else if (st.drag.mode === "pathh") {
      // ハンドル: 反対側も対称に動かす(Alt を押しながらだと、このハンドルだけ)
      const d = toDoc(p.x, p.y), q = st.path?.pts[st.drag.i];
      if (q) {
        const hv = [r1(d.x - q.x), r1(d.y - q.y)];
        q[st.drag.sd] = hv;
        if (!e.altKey) q[st.drag.sd === "hi" ? "ho" : "hi"] = [-hv[0], -hv[1]];
      }
    } else {
      const q = toImg(p.x, p.y);
      strokePoints(st.drag.last, q, st.brush / 2, dab);
      strokeApply();
      st.drag.last = q;
      if (st.tool === "remove" || st.tool === "rmerase") st.paint._dirty = true;
    }
    draw();
  });
  const end = () => {
    if (st.drag?.mode === "brush") { strokeApply(); st.stroke = null; refresh(); }
    if (st.drag?.mode === "shape") endShapeDraw();
    st.drag = null;
    refreshTool();
    draw();
  };
  cv.addEventListener("pointerup", end);
  // パスツール: 閉じていないパスは、ダブルクリックで最初の点までつないで閉じる
  cv.addEventListener("dblclick", () => {
    if (st.tool === "path" && st.path && !st.path.closed && st.path.pts.length >= 3) { pathSnap(); st.path.closed = true; draw(); }
  });
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", () => { st.mouse = null; draw(); });
  cv.addEventListener("wheel", (e) => {
    if (!st.layers.length) return;
    e.preventDefault();
    const p = pos(e);
    const before = toDoc(p.x, p.y);
    st.view.z = Math.max(0.1, Math.min(40, st.view.z * Math.pow(1.15, -e.deltaY / 100)));
    layout();
    // カーソルの下の点が動かないように
    st.view.px += p.x - (before.x * st.view.k + st.view.ox);
    st.view.py += p.y - (before.y * st.view.k + st.view.oy);
    draw();
  }, { passive: false });
  cv.addEventListener("dblclick", (e) => {
    // 文字の上なら、画像の上で編集。ほかは表示を全体に戻す
    const p = pos(e), t = ["text", "select"].includes(st.tool) ? textAt(p.x, p.y) : null;
    if (t) { beginTextEdit(t, textIndexAt(t, p.x, p.y)); return; }
    st.view.z = 1; st.view.px = 0; st.view.py = 0; draw();
  });
  // ドラッグ&ドロップ・貼り付け
  stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("drop"); });
  stage.addEventListener("dragleave", () => stage.classList.remove("drop"));
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    stage.classList.remove("drop");
    // 何も開いていなければ開く。開いていれば重ねて置く
    const fs = [...(e.dataTransfer?.files || [])].filter((x) => /^image\//.test(x.type));
    (async () => { for (const f of fs) await placeFile(f); })();
  });
  // コピーしたとき: パソコンのクリップボードに印(と、画像 1 つならその画像)を入れる。貼り付けで印があれば、この画面のレイヤーを貼る
  window.addEventListener("copy", (e) => {
    if (!ui?.classList.contains("open") || !st.clipMark || isField(e.target)) return;
    e.clipboardData.setData("text/plain", st.clipMark);
    const one = objClip?.length === 1 && objClip[0].kind === "image" ? objClip[0] : null;
    if (one) { try { e.clipboardData.setData("text/html", `<img src="${layerPixels(one).toDataURL("image/png")}" alt="">`); } catch { /* 大きすぎるときは印だけ */ } }
    e.preventDefault();
    st.clipMark = st.clipMark.replace(/:pending$/, "");
  }, true);
  window.addEventListener("cut", (e) => { if (ui?.classList.contains("open") && st.clipMark && !isField(e.target)) { e.clipboardData.setData("text/plain", st.clipMark); e.preventDefault(); } }, true);
  window.addEventListener("paste", (e) => {
    if (!ui?.classList.contains("open")) return;
    // この画面でコピーしたレイヤーなら、それを貼る(パソコンのクリップボードの画像より優先)
    const txt = e.clipboardData?.getData("text/plain") || "";
    if (/^cca-(imgedit|vedit):/.test(txt) && !isField(e.target)) { if (pasteObjects()) { e.preventDefault(); e.stopPropagation(); } return; }
    const f = [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type));
    if (!f) {
      // 画像でなければ、コピーした文字を貼り付ける(文字を打つ欄の中ではその欄に)
      if (isField(e.target)) return;
      // クリップボードに文字があれば、その内容を入れた「文字」を置く。無ければ、この画面でコピーしたレイヤーを貼る
      if (txt.trim() && pasteTextLayer(txt.replace(/\r\n?/g, "\n"))) { e.preventDefault(); e.stopPropagation(); return; }
      if (pasteObjects()) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    placeFile(f);
  }, true);
  // キー操作: 開いている間はグラフ側のショートカットに渡さない(ボタンが押せなくなってフォーカスが外れても効くよう window で受ける)
  window.addEventListener("keydown", (e) => {
    if (!ui?.classList.contains("open") || watermarkKey(e) || historyKey(e)) return;
    e.stopPropagation();
    const t = e.target;
    const inField = t && ui.contains(t) && isField(t);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // 一時保存(Ctrl+S。欄の中でも。ブラウザの「ページを保存」は出さない)
    if (mod && k === "s" && !e.shiftKey && !e.altKey) { e.preventDefault(); histSave(false, $('[data-c="hsave"]')); return; }
    // 画像の上の文字の編集: Esc で終える
    if (st.tedit != null && e.key === "Escape") { e.preventDefault(); endTextEdit(); return; }
    // 元に戻す・やり直す(Ctrl+Z / Ctrl+Y / Shift+Ctrl+Z。⌘ も)。文字を打つ欄で打った分があれば、まずその欄の中を戻す。
    // 打っていない(または打った分を全部戻した)ときは、画面の「元に戻す」(数や選ぶ欄からも)
    const typed = inField && isTextField(t) && t.value !== (t._ccaStart ?? t.value);
    if (mod && (k === "z" || k === "y") && !typed) {
      e.preventDefault();
      if (st.tedit != null) endTextEdit();
      else if (inField) t.blur();
      if (st.tool === "path" && pathUndoRedo(!(k === "z" && !e.shiftKey))) return; // パスを描いている間は、パスを 1 手ずつ
      if (k === "z" && !e.shiftKey) undo(); else redo();
      return;
    }
    // トリミング中: Enter で決定・Esc でやめる
    if (st.crop && !inField && (e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); endCrop(e.key === "Enter"); return; }
    if (st.lcrop && !inField && (e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); endLayerCrop(e.key === "Enter"); return; }
    if (inField && e.key !== "Escape") return;
    if (mod && k === "c") { if (copyObjects()) { clipMark(); document.execCommand("copy"); e.preventDefault(); } }
    else if (mod && k === "x") { if (copyObjects(true)) { clipMark(); document.execCommand("copy"); e.preventDefault(); } }
    else if (mod && k === "g") { e.preventDefault(); groupSel(!e.shiftKey); }
    else if (mod && k === "a" && st.tool === "select" && st.layers.length) { e.preventDefault(); selectLayer(st.layers.at(-1)); st.msel = st.layers.filter((l) => !l.hidden).map((l) => l.id); refresh(); }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && st.tool === "path" && st.pathSel?.some((j) => st.path?.pts[j])) {
      e.preventDefault(); // パスの選んだ点を動かす
      pathSnap();
      const n = e.shiftKey ? 10 : 1, dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
      for (const j of st.pathSel) { const q = st.path.pts[j]; if (q) { q.x = r1(q.x + dx); q.y = r1(q.y + dy); } }
      draw();
    }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && st.tool === "select" && selList().length) {
      e.preventDefault();
      const n = e.shiftKey ? 5 : 1;
      nudge(e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0);
    }
    else if (st.tool === "path" && st.path && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); pathBack(); }
    else if (st.tool === "path" && st.path?.pts.length >= 3 && !st.path.closed && e.key === "Enter") { e.preventDefault(); pathSnap(); st.path.closed = true; draw(); }
    else if (st.tool === "path" && st.path && e.key === "Escape") { e.preventDefault(); pathSnap(); st.path = null; draw(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && isMulti() && st.tool === "select") { e.preventDefault(); deleteSel(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && ["text", "select"].includes(st.tool) && selText()) { e.preventDefault(); textAction("del"); }
    else if ((e.key === "Delete" || e.key === "Backspace") && st.tool === "select" && selObj()) { e.preventDefault(); layerOp("del"); }
    else if (e.key === "Escape" && !["select", "pan"].includes(st.tool)) { st.tool = "select"; refreshTool(); draw(); }
    else if (e.key === "Escape" && (selText() || selObj() || isMulti())) { selectLayer(null); refresh(); }
    else if (e.key === "Escape") close();
    else if (e.key === " " && !st.space) { st.space = true; e.preventDefault(); refreshTool(); $(".stage > canvas").style.cursor = "grab"; }
  }, true);
  window.addEventListener("keyup", (e) => {
    if (!ui?.classList.contains("open")) return;
    e.stopPropagation();
    if (e.key === " ") { st.space = false; refreshTool(); }
  }, true);
  ui.addEventListener("mousedown", (e) => { if (e.target === ui) close(); });
  window.addEventListener("resize", () => { if (ui?.classList.contains("open")) draw(); });
}

// 透かし: 選んだ所に、決めた大きさ・不透明度で置く(レイヤーになるので、あとで動かせる。元に戻せる)
async function addWatermark(btn) {
  if (!st.layers.length || st.busy) return;
  endBg();
  await openWatermark({
    size: [st.W, st.H], base: renderComposite(Math.min(1, 900 / Math.max(st.W, st.H))), notify: (m, k, el) => ctx.notify(m, k, el || btn),
    onApply: async ({ item, img, rect }) => {
      pushUndo(true);
      const L = imageLayer(toCanvas(img), `💧 ${item?.name || T("透かし")}`, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h);
      L.opacity = rect.opacity;
      st.layers.push(L);
      selectLayer(L);
      st.dirty = true;
      refresh();
      ctx.notify("透かしを入れました(元に戻すで取り消せます)", "info", btn);
    },
  });
}
// ---------------------------------------------------------------- 一時保存(📌・自動保存・🕘 履歴)
// 新しい作業として数え直す(開いただけでは保存しない)
function histNew() { st.hist.sid = newSid(); st.hist.ver = st.ver; }
// できあがりの見た目(一覧の小さな絵用)
function histThumb() {
  const W = st.W, H = st.H;
  return makeThumb(W, H, (g, w, h) => {
    const bgc = outBg();
    if (bgc) { g.fillStyle = bgc; g.fillRect(0, 0, w, h); }
    drawLayers(g, w / W, 0, 0, false);
  }, true);
}
// 保存する。auto: 自動保存(この作業の項目を上書き。変わっていなければ何もしない)
// 戻り値: 保存した項目 / null(保存するものが無い) / false(失敗)。保存は 1 つずつ順に行う
function histSave(auto = false, btn = null) {
  const run = async () => {
    if (!st.layers.length) { if (!auto) ctx.notify(T("まだ画像を開いていません"), "info", btn); return null; }
    if (st.layers.every((l) => l.blank)) { if (!auto) ctx.notify(T("まだ何も置いていません"), "info", btn); return null; }
    const ver = st.ver;
    if (auto && ver === st.hist.ver) return null;
    if (btn) btn.disabled = true;
    try {
      // レイヤーごとに: 画像は今の画素(L<id>.png)と開いたときの画素(L<id>_o.png)、文字はそのまま
      const files = {};
      for (const l of imageLayers()) {
        files[`L${l.id}.png`] = await toBlob(l.cv);
        if (l.orig) files[`L${l.id}_o.png`] = await toBlob(l.orig);
      }
      const layers = st.layers.map((l) => (l.kind === "image"
        ? { id: l.id, kind: "image", name: l.name, cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot || 0, opacity: l.opacity ?? 1, hidden: !!l.hidden, ...(l.gid ? { gid: l.gid } : {}), ...(l.crop ? { crop: l.crop } : {}), ...(l.warp ? { warp: l.warp } : {}), ...(l.clip ? { clip: l.clip, clipHide: !!l.clipHide } : {}), ...(l.ol ? { ol: l.ol } : {}) }
        : JSON.parse(JSON.stringify(l))));
      const item = await saveEntry("image", {
        data: { v: 2, source: st.source, name: st.name, W: st.W, H: st.H, aimg: st.aimg, out: st.out, layers },
        auto, id: auto ? st.hist.sid : "", title: st.name,
        info: { w: st.W, h: st.H, texts: st.texts.length, images: imageLayers().length, shapes: st.layers.filter((l) => l.kind === "shape").length },
        files, thumb: await histThumb(),
      });
      if (auto) st.hist.sid = item.id; // 名前を付けて残した項目は上書きしないので、新しい id になることがある
      st.hist.ver = ver;
      if (!auto) ctx.notify(T("一時保存しました({0})。🕘 履歴から開き直せます", fmtTime(item.updated)), "info", btn);
      return item;
    } catch (e) {
      if (!auto) ctx.notify(`${T("一時保存できませんでした")}: ${e.message}`, "error", btn);
      else console.warn("[CCA Generator] 自動保存できませんでした:", e);
      return false;
    } finally { if (btn) { btn.disabled = false; refresh(); } }
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
  if (st.busy) return;
  await openHistory({ kind: "image", notify: (m, k, el) => ctx.notify(m, k, el), current: () => st.hist.sid, onOpen: (entry) => histOpen(entry) });
  ui.focus({ preventScroll: true });
}
// 一時保存した編集を開く(今の作業は、変わっていれば先に自動保存する)。第23版までの形(img.png と文字)も開ける
async function histOpen(entry) {
  const d = entry?.data || {};
  const files = entry?.files || [];
  const v2 = d.v === 2 && Array.isArray(d.layers);
  if (!v2 && !files.includes("img.png")) throw new Error(T("一時保存の中身を読めませんでした"));
  if (entry.id !== st.hist.sid && (await histSave(true)) === false && !confirm("今の編集を自動保存できませんでした。それでも開きますか?")) return false;
  busy("読み込み中…");
  try {
    const url = (f) => fileUrl("image", entry.id, f, entry.updated);
    let layers = [], W, H, aimg = null;
    if (v2) {
      W = Number(d.W) || 1; H = Number(d.H) || 1;
      for (const l of d.layers) {
        if (l.kind === "image") {
          if (!files.includes(`L${l.id}.png`)) continue;
          const cv = toCanvas(await loadImg(url(`L${l.id}.png`)));
          const og = files.includes(`L${l.id}_o.png`) ? await loadImg(url(`L${l.id}_o.png`)).catch(() => null) : null;
          layers.push({ ...l, kind: "image", cv, orig: og && og.naturalWidth === cv.width && og.naturalHeight === cv.height ? toCanvas(og) : copyCanvas(cv),
            paint: canvasOf(cv.width, cv.height) });
        } else layers.push({ ...l, kind: l.kind === "shape" ? "shape" : "text" });
      }
      aimg = layers.some((l) => l.id === d.aimg && l.kind === "image") ? d.aimg : null;
      if (d.out && typeof d.out === "object") st.out = { ...st.out, ...d.out };
    } else {
      const cv = toCanvas(await loadImg(url("img.png")));
      const og = files.includes("orig.png") ? await loadImg(url("orig.png")).catch(() => null) : null;
      W = cv.width; H = cv.height;
      const L = { id: 0, kind: "image", name: String(d.name || entry.title || "image"), cv, orig: og && og.naturalWidth === W && og.naturalHeight === H ? toCanvas(og) : copyCanvas(cv),
        paint: canvasOf(W, H), cx: W / 2, cy: H / 2, w: W, h: H, rot: 0, opacity: 1, hidden: false };
      layers = [L, ...(Array.isArray(d.texts) ? d.texts : []).map((t) => ({ ...t, kind: "text" }))];
    }
    // id は今の番号と重ならないように振り直す
    for (const l of layers) { const old = l.id; l.id = tuid++; if (old === aimg) aimg = l.id; }
    endBg();
    st.W = W; st.H = H; st.layers = layers; st.msel = []; st.lcrop = null;
    st.aimg = aimg ?? imageLayers().at(0)?.id ?? null; st.isel = null; st.tsel = null;
    st.source = String(d.source || "");
    st.name = String(d.name || displayName(st.source) || entry.title || "image.png");
    st.undo = []; st.redo = []; st.bg = null; st.dirty = false; st.saved = null;
    st.view.z = 1; st.view.px = 0; st.view.py = 0;
    histNew(); // 開いた編集は、変えたら新しい自動保存になる(開いた項目は残る)
    fillPick();
    refreshOut?.();
  } finally { busy(""); refresh(); }
  ctx.notify(T("「{0}」を開きました", entry.name || entry.title || fmtTime(entry.updated)), "info");
  return true;
}

async function close(force = false) {
  if (!ui?.classList.contains("open")) return;
  if (force) await histSave(true);
  else if (!(await askDiscard("close"))) return;
  histTimer(false);
  ui.classList.remove("open");
}

// opts: { value(開く画像。空なら何もない状態), images(), imageUrl(v), upload(file) → value, notify, runMini(prompt, { onStatus, job }), choices(), outPrefix()(画像の保存先),
//         fileHelp(kind, name), openPath(path, anchor), onSaved(info), useAsImage1(value), refreshChoices() }
export async function openImageEditor(opts) {
  ctx = opts;
  fontApi.use(opts);
  if (!ui) build();
  if (ui.classList.contains("open") && !(await askDiscard("open"))) return;
  ui.classList.add("open");
  ui.focus();
  $('[data-c="bgguide"]').hidden = true;
  $('[data-c="rmguide"]').hidden = true;
  st.layers = []; st.W = 0; st.H = 0; st.aimg = null; st.isel = null; st.source = ""; st.name = ""; st.crop = null; st.out.name = "";
  st.tsel = null; st.msel = [];
  st.tool = "select"; // 開くたびに「↖ 選択」から
  st.undo = []; st.redo = []; st.bg = null; st.dirty = false; st.saved = null;
  histNew();
  st.bgp = { thr: 0, grow: 0, feather: 0 };
  for (const k of ["thr", "grow", "feather"]) setVal(k, 0);
  fillRm();
  fillPick();
  refresh();
  if (opts.value) {
    busy("読み込み中…");
    try { await openValue(opts.value); } catch (e) { ctx.notify(e.message, "error"); } finally { busy(""); refresh(); }
  }
  if (!st.layers.length) startBlank(); // 何も開いていなければ、空のキャンバスから
  histTimer(true);
}
// テスト用(画面の状態を読む)
window.CCA_IMGEDIT = { _applyRemoved: (url) => applyRemoved(url, null), _paintCount: () => { const c = st.paint; if (!c) return 0; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; }, state: st, _boxBlur: (...a) => boxBlur(...a), _morph: (...a) => morph(...a), histSave: (auto) => histSave(auto),
  composite: () => renderComposite(), docToLayer: (L, x, y) => docToLayer(L, x, y), active: () => activeImg() };
