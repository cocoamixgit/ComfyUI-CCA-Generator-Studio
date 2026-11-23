// CCA Generator 生成パネル(全画面の操作 UI)
// ワークフロー上の CCA Generator パネルノードの値を読み書きし、ComfyUI の通常キューで生成する。
// 値の保存・復元・プリセットはノード側(cca_generator.js)と共通。
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  CCA, IMG_KEYS, NONE, W, currentKey, deletePreset, emit, ensureLoaded, fileCheck, fileHelp, findPanel, guardComfyKeys, imageUrl,
  BUILTIN_MARK, appendPreset, findPreset, hiddenCount, hidePreset, isMissingFile, loraFiles, mediaDirs, modelDirs, openFolder, pickFolder,
  restoreHidden,
  parseImageValue, parseLoras, presetEntries, presetGroup, refreshChoices, resetToDefaults, saveNodeIds, savePreset, setLoras, setWidget,
  uploadImage, visibleSet,
} from "./cca_generator.js";
import { T, alert, choice as langChoice, confirm, lang as curLang, onLangChange, packs as langPacks, prompt, ready as i18nReady, recheck as recheckLang, setChoice as setLangChoice } from "./cca_i18n.js";
import { openComposer } from "./cca_compose.js";
import { openPngInfo } from "./cca_pnginfo.js";
import { setupSections, sectionEditBar, SECTIONS_CSS, cardCss } from "./cca_sections.js";
import { openSettingsIO } from "./cca_settings.js";
import { weightKey } from "./cca_text.js";
import { openImageEditor } from "./cca_imgedit.js";
import { openVideoEditor } from "./cca_videoedit.js";
import { layoutSummary, openLayoutEditor, parseLayout } from "./cca_layout.js";
import { openGallery, openZoom, videoThumb } from "./cca_gallery.js";
import { ensureCss as ensureGuideCss, licBadge, openModelGuide } from "./cca_modelguide.js";
import { TILE_CSS, applyTileSettings, refreshTile, resumeTileJobs, setupTile, tileActive, tileCombine, tileGenerate, tileHtml } from "./cca_tile.js";
import { WILDCARD_CSS, setupWildcards, unknownWildcards, wildcardHtml } from "./cca_wildcards.js";
import { METER_CSS, attachMeter, primeAudio } from "./cca_meter.js";
import { THEMES, setTheme, themeChoice } from "./cca_theme.js";
import { sideSplitter } from "./cca_shapes.js";

// 入力画像の透過(アルファ)を使えるモデル種別(ここに入れたモデルでは「⚠透過画像は使えません。」を出さない)
const ALPHA_OK = new Set([]); // モデル種別名(model_type)
const PRESET_NEW = "(プリセットを選択)";
const PRESET_RESTORE = "__cca_restore_builtin__";
const SIZE_SCALE = "倍率指定";
// 項目名の右の ⓘ を押すと出る説明(使い方)。項目名 → 文面
const INFO = {
  hires_upscaler: "拡大の方法を選びます。拡大モデル(4x-UltraSharp など)を使うときは、モデルフォルダの「拡大モデル(Hires. fix 用)」に入れると一覧に出ます。",
  edit_lora_strength: "1.0 のままにします。下げると、画像2がそのまま貼り付いたような結果になりやすくなります。",
  edit_format: "「自動」のままにします。選んだ Edit LoRA のファイルから読み方を決めます。",
  ref_size: "「自動」のままにします(出力と同じ約 100 万画素で参照します。ComfyUI 公式の MOSS 編集と同じ)。小さくすると、画像を読み取りにくくなります。",
  size_scale: "画像1の大きさにこの倍率を掛けた大きさで出力します(×0.5 で半分、×1.1 で 1.1 倍)。",
  resize_mode: "「画像1のサイズ」は大きさを変えません。「そのまま拡大縮小」は縦横比を変えて幅・高さに合わせます。「切り抜いて拡大縮小」ははみ出た所を切り取ります。「余白を埋めて拡大縮小」は足りない所を端の色で埋めます(埋めた所は描き直されます)。",
  video_length: "動画のコマ数です。長さ(秒)はフレーム数 ÷ fps です。増やすほど時間とメモリが掛かります。",
  video_fps: "1 秒あたりのコマ数です。変えると再生の速さが変わります。",
  video_shift: "生成の進み方を決める値(ModelSamplingSD3 の shift)です。ComfyUI 公式テンプレートでは、通常 8、Wan2.2 14B の Turbo(4 ステップ LoRA)は 5 です。",
  mid_frame_pos: "画像2(途中のフレーム)を置く位置です。0 = 最初、50 = 真ん中、100 = 最後。",
  image_output_prefix: "保存するファイル名の先頭部分です。%date:yyyy-MM-dd% と書くと、保存した日付に置き換わります。",
  video_output_prefix: "保存するファイル名の先頭部分です。%date:yyyy-MM-dd% と書くと、保存した日付に置き換わります。",
  latent_upscale_name: "LTX-2.5 は半分の大きさで作ってから、このモデルで 2 倍にして仕上げます。models/latent_upscale_models に入れます。",
};
const LS_HISTORY = "cca_generator.history";
const LS_AUTOOPEN = "cca_generator.autoopen";
const LS_DETAILS = "cca_generator.details";
const SEED_MODES = [["randomize", "毎回ランダム"], ["fixed", "固定"], ["increment", "+1 ずつ"], ["decrement", "-1 ずつ"]];

let root = null;
let busy = false;
let lastProgress = { value: 0, max: 0 };
let running = false;
let history = [];
let current = null;

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても動作には影響しない */ } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel) => root.querySelector(sel);
const $$ = (sel) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- styles
function injectStyles() {
  if (document.getElementById("cca-ui-style")) return;
  const css = document.createElement("style");
  css.id = "cca-ui-style";
  css.textContent = `
#cca-ui{--bg:#12151a;--card:#1a1e25;--card2:#20252e;--line:#303744;--text:#e4e7eb;--muted:#959eab;
  --accent:#3db4a6;--accent-d:#2b8f84;--warn:#e0a23c;--err:#e2625f;
  position:fixed;inset:0;z-index:1000;background:var(--bg);color:var(--text);display:none;flex-direction:column;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif}
#cca-ui.open{display:flex}
#cca-ui *{box-sizing:border-box}
#cca-ui .top{display:flex;flex-wrap:wrap;row-gap:6px;align-items:center;gap:12px;padding:8px 16px;margin-top:6px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#161a20}
#cca-ui .brand{font-weight:700;font-size:15px;letter-spacing:.02em}
#cca-ui .brand b{color:var(--accent)}
#cca-ui .chip{padding:2px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40vw}
#cca-ui .sp{flex:1}
#cca-ui .body{flex:1;min-height:0;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.15fr) var(--sidew, minmax(360px,1fr));gap:14px;padding:0 10px 0 16px}
#cca-ui .col{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;overflow-y:auto;overscroll-behavior:contain;padding:14px 6px 14px 0}
#cca-ui .col>*{flex-shrink:0}
#cca-ui .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
#cca-ui .card>h3,#cca-ui details>summary{margin:0 0 10px;font-size:13px;font-weight:700;color:#cfd5dc;display:flex;align-items:center;gap:8px}
#cca-ui details>summary{cursor:pointer;list-style:none;margin:0}
#cca-ui details[open]>summary{margin-bottom:10px}
#cca-ui details>summary::before{content:"▸";color:var(--muted)}
#cca-ui details[open]>summary::before{content:"▾"}
#cca-ui .hint{color:var(--muted);font-size:13px;font-weight:400}
/* 設定カード内の説明文(マイナスプロンプト・範囲別指定など)は、テーマの太さ指定に関わらず通常の太さにする */
#cca-ui details.card :is(div.hint,div.ibox){font-weight:400 !important}
.ib{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0!important;border-radius:999px!important;
  font-size:13px!important;line-height:1;background:transparent!important;color:#9fb0c2!important;border:1px solid #4a5566!important;cursor:pointer;flex:0 0 auto}
.ib:hover,.ib.on{color:#fff!important;border-color:#3db4a6!important}
.ibox{background:#20252e;border:1px solid #303744;border-radius:6px;padding:8px 10px;font-size:13px;line-height:1.6;color:#d5dbe2;margin:4px 0 6px;font-weight:400}
.ibox.hide{display:none!important}
.inl-msg{margin-top:4px;padding:6px 8px;border-radius:6px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;display:flex;gap:8px;align-items:flex-start}
.inl-msg>span{flex:1;min-width:0}
.inl-msg .inl-x,#cca-ui .inl-msg .inl-x{background:transparent!important;border:none!important;color:inherit!important;font-size:16px!important;line-height:1!important;padding:0 4px!important;cursor:pointer;opacity:.8;flex:0 0 auto}
.inl-msg .inl-x:hover{opacity:1}
.inl-msg .inl-x::before{content:"×"}
.inl-msg.error{background:#3a1d1d;border:1px solid #e06c6c;color:#ffd6d4}
.inl-msg.info{background:#1d2f2c;border:1px solid #3db4a6;color:#d2f2ee}
#cca-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:1005;display:flex;flex-direction:column;gap:8px;
  width:min(720px,calc(100vw - 32px));pointer-events:none;font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif}
#cca-toast .t{pointer-events:auto;user-select:text;cursor:auto;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;box-shadow:0 8px 24px #000a;
  white-space:pre-wrap;word-break:break-word;color:#f1f3f5}
#cca-toast .t.error{background:#3a1d1d;border:1px solid #e06c6c}
#cca-toast .t.info{background:#1d2f2c;border:1px solid #3db4a6}
#cca-toast .t span{flex:1}
#cca-toast .t button{background:transparent;border:none;color:#f1f3f5;font-size:16px;cursor:pointer;padding:0 4px}
#cca-toast .t button{pointer-events:auto}
#cca-toast .t a{color:#8fd8ff;text-decoration:underline}
#cca-toast .t .tp{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:2px 0}
#cca-toast .t .tp button.tb{border:1px solid #ffffff55;border-radius:6px;font-size:12px;padding:1px 8px;color:#f1f3f5}
/* 知らせの文字は下の画面の操作をじゃましない(押せるのは × と 📂 だけ)。編集の画面では、上のボタンの並びより下に出す */
body:has(#cca-imged.open) #cca-toast,body:has(#cca-vedit.open) #cca-toast,body:has(#cca-comp.open) #cca-toast{top:78px}
#cca-toast .t button.tf{font-size:13px;border:1px solid #3db4a6;border-radius:6px;padding:2px 8px;white-space:nowrap;align-self:center}
#cca-toast .t button.tf:hover{background:#2b8f8455}
#cca-toast .t button.tf:disabled{opacity:.7;cursor:default}
#cca-ui .sizebox{margin-top:10px;padding:10px 12px;border:1px solid #3a4658;border-radius:8px;background:#151a21}
#cca-ui .sizebox.tabs{min-height:212px}
#cca-ui .words .chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
#cca-ui .words .chip{padding:3px 10px;border-radius:999px;font-size:13px;background:#1d232c}
#cca-ui .words .chip.neg{border-color:#6b2a2a}
#cca-ui .words h5{margin:6px 0 2px;font-size:13px;color:var(--muted);font-weight:400}
#cca-guide{position:fixed;inset:0;z-index:1001;background:#000b;display:none;align-items:center;justify-content:center;
  font:15px/1.75 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-guide.open{display:flex}
#cca-guide .box{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(760px,calc(100vw - 32px));max-height:88vh;display:flex;flex-direction:column}
#cca-guide .hd{display:flex;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid #303744}
#cca-guide .hd select{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 8px;font:inherit;font-size:14px}
#cca-guide .hd button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit;font-size:14px}
#cca-guide .md{overflow:auto;padding:8px 22px 22px}
#cca-guide .md h2{font-size:20px;margin:14px 0 6px}
#cca-guide .md h3{font-size:18px;margin:18px 0 6px;color:#9fe0d8}
#cca-guide .md table{border-collapse:collapse;width:100%;margin:6px 0}
#cca-guide .md th,#cca-guide .md td{border:1px solid #3a4250;padding:6px 8px;text-align:left;vertical-align:top}
#cca-guide .md th{background:#20252e}
#cca-guide .md code{background:#0e1115;border-radius:4px;padding:1px 5px}
#cca-guide .md a{color:#7fd6cb}
#cca-guide .md ol,#cca-guide .md ul{margin:6px 0;padding-left:26px}
#cca-ui .editinfo{margin-top:10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:#0e1115;font-size:13px;line-height:1.6}
#cca-ui .editinfo .w{color:var(--warn)}
#cca-ui .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px 12px}
#cca-ui .f{display:flex;flex-direction:column;gap:4px;min-width:0}
#cca-ui .f.hide,#cca-ui .hide{display:none!important}
${SECTIONS_CSS("#cca-ui")}
${cardCss("#cca-ui .col.left", "> .card[data-sec]", { model: "blue", prompt: "teal", images: "orange", sampling: "purple", tile: "red", size: "cyan", hires: "pink", models: "lime", out: "yellow" })}
${TILE_CSS}
${WILDCARD_CSS}
${cardCss("#cca-ui .col.right", "> .card", {}, "gray")}
#cca-ui .card.sec-folded>h3{margin-bottom:0}
#cca-ui .secbar{display:flex;gap:6px}
#cca-ui label.l{color:var(--muted);font-size:13px;display:flex;align-items:center;gap:6px}
#cca-ui input,#cca-ui select,#cca-ui textarea{width:100%;background:#0e1115;color:var(--text);border:1px solid #3a4250;border-radius:6px;padding:6px 8px;font:inherit;min-width:0}
#cca-ui input:focus,#cca-ui select:focus,#cca-ui textarea:focus{outline:none;border-color:var(--accent)}
#cca-ui select.missing,#cca-ui .missing select{border-color:var(--warn);color:var(--warn)}
#cca-ui .warn{color:var(--warn);font-size:13px}
#cca-ui textarea{resize:vertical;line-height:1.5}
#cca-ui textarea.pos{min-height:130px}
#cca-ui textarea.neg{min-height:70px}
#cca-ui input[type=checkbox]{width:auto;accent-color:var(--accent)}
#cca-ui input[type=range]{padding:0;accent-color:var(--accent);border:none;background:transparent}
#cca-ui .rng{display:grid;grid-template-columns:1fr 82px;gap:8px;align-items:center}
#cca-ui .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#cca-ui .row>.grow{flex:1;min-width:140px}
#cca-ui button{background:var(--card2);color:var(--text);border:1px solid #3a4250;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit;white-space:nowrap}
#cca-ui button:hover{border-color:var(--accent)}
#cca-ui button:disabled{opacity:.5;cursor:default}
#cca-ui button.pri{background:var(--accent-d);border-color:var(--accent);color:#fff;font-weight:700}
#cca-ui button.pri:hover{background:var(--accent)}
#cca-ui button.icon{padding:6px 9px}
#cca-ui .seg{display:flex;flex-wrap:wrap;gap:6px}
#cca-ui .seg button{border-radius:999px;padding:5px 14px}
#cca-ui .seg button.on{background:var(--accent-d);border-color:var(--accent);color:#fff}
#cca-ui .tasksel{flex-wrap:wrap;gap:8px}
#cca-ui .top .lang{display:flex;align-items:center;gap:4px;color:var(--muted)}
/* 設定ボタンも、ほかの上部ボタンと同じ見た目 */
#cca-ui .top .lang select{width:auto;padding:3px 6px}
#cca-ui .typesel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end}
#cca-ui .badge{font-size:12px;padding:1px 8px;border-radius:999px;background:#3a2f17;color:var(--warn);border:1px solid #6b5422}
#cca-ui .slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
#cca-ui .slots.many{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
#cca-ui .slot{border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--card2);display:flex;flex-direction:column;gap:8px}
#cca-ui .slot .st{font-weight:700}
#cca-ui .slot .st small{font-weight:400;color:var(--muted);margin-left:6px;font-size:13px}
#cca-ui .slots.many .slot .st small{display:block;margin-left:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cca-ui small{font-size:13px}
#cca-ui .drop{position:relative;height:190px;border:2px dashed #3d4655;border-radius:8px;display:flex;align-items:center;justify-content:center;
  text-align:center;color:var(--muted);cursor:pointer;overflow:hidden;background:#0e1115;padding:8px}
#cca-ui .drop.over{border-color:var(--accent);background:#10201e}
#cca-ui .drop img{max-width:100%;max-height:100%;object-fit:contain}
#cca-ui .drop .mk{position:absolute;left:6px;top:6px;font-size:12px;background:#000a;padding:1px 6px;border-radius:4px;color:#ffb3b3}
#cca-ui .gen{display:grid;grid-template-columns:1fr auto;gap:8px}
#cca-ui .gen .go{height:52px;font-size:17px}
#cca-ui .bar{height:8px;background:#0e1115;border-radius:999px;overflow:hidden;border:1px solid var(--line)}
#cca-ui .bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent-d),var(--accent));transition:width .2s}
#cca-ui .status{display:flex;justify-content:space-between;color:var(--muted);font-size:13px;margin-top:6px}
#cca-ui .viewer{min-height:320px;max-height:62vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;border:1px solid var(--line);border-radius:8px;overflow:hidden}
#cca-ui .viewer img,#cca-ui .viewer video{max-width:100%;max-height:62vh;object-fit:contain}
#cca-ui .viewer.withmeter{align-items:stretch}
#cca-ui .avwrap{display:flex;width:100%;min-height:320px}
#cca-ui .avwrap .media{flex:1;min-width:0;display:flex;align-items:center;justify-content:center}
#cca-ui .avwrap .aud{display:flex;flex-direction:column;align-items:center;gap:10px;width:min(560px,90%)}
#cca-ui .avwrap .aud .ic{font-size:44px}
#cca-ui .avwrap .aud .nm{font-size:12px;color:var(--muted);word-break:break-all;text-align:center}
#cca-ui .avwrap audio{width:100%}
#cca-ui .hist .t .au{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:22px}
#cca-ui .hist .t .au span{font-size:9px;max-width:66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cca-ui #cca-audio-opts .f.wide{grid-column:1/-1}
#cca-ui #cca-audio-opts video{max-width:100%;max-height:180px;margin-top:6px;display:block}
#cca-ui #cca-audio-opts audio{width:100%;margin-top:6px}
#cca-ui #cca-audio-opts textarea{width:100%;box-sizing:border-box}
#cca-ui #cca-audio-opts details.adv{margin-top:10px}
#cca-ui #cca-audio-opts details.adv>summary{cursor:pointer;color:var(--muted);font-size:13px;margin-bottom:6px}
#cca-ui #cca-audio-opts label.l button{margin-left:6px;padding:1px 8px;font-size:12px}
${METER_CSS}
#cca-ui .viewer .empty{color:var(--muted)}
#cca-ui .viewer img{cursor:zoom-in}
#cca-ui .hist .t{position:relative}
#cca-ui .typenote{color:var(--muted);font-size:13px}
#cca-ui .audiohelp,#cca-ui .layoutrow{margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card2)}
#cca-ui .audiohelp .ex{margin-top:6px;font-family:ui-monospace,Consolas,monospace;font-size:13px;white-space:pre-wrap;background:#0b0d10;border-radius:6px;padding:6px 8px}
#cca-addon{position:fixed;inset:0;z-index:1004;background:#000b;display:none;align-items:center;justify-content:center;
  font:15px/1.6 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-addon.open{display:flex}
#cca-addon .box{background:#1a1e25;border:1px solid #303744;border-radius:10px;width:min(820px,calc(100vw - 32px));max-height:88vh;display:flex;flex-direction:column}
#cca-addon .hd{display:flex;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid #303744}
#cca-addon .hd .sp{flex:1}
#cca-addon button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit;font-size:14px}
#cca-addon .md{overflow:auto;padding:8px 22px 22px}
#cca-addon h3{font-size:18px;margin:18px 0 6px;color:#9fe0d8}
#cca-addon .state{background:#20252e;border-radius:8px;padding:8px 12px;margin-top:10px}
#cca-addon .code{display:flex;gap:8px;align-items:center;margin:6px 0}
#cca-addon .code code{flex:1;background:#0b0d10;border:1px solid #303744;border-radius:6px;padding:6px 8px;font-size:13px;word-break:break-all}
#cca-addon .rec{color:#9fe0d8;font-size:13px;margin-left:8px}
#cca-addon a{color:#7cc4ff}
#cca-ui .hist{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
#cca-ui .hist .t{flex:0 0 72px;height:72px;border:1px solid var(--line);border-radius:6px;overflow:hidden;cursor:pointer;background:#0b0d10;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px}
#cca-ui .hist .t.on{border-color:var(--accent)}
#cca-ui .hist img{width:100%;height:100%;object-fit:cover}
#cca-ui .err{white-space:pre-wrap;background:#2a1414;border:1px solid #6b2a2a;color:#ffc9c7;border-radius:8px;padding:10px;font-size:13px;margin-top:8px}
#cca-ui .err .errx{float:right;margin:-6px -4px 4px 10px;padding:0 6px;background:none;border:none;color:#ffc9c7;font-size:18px;line-height:1.4;cursor:pointer}
/* 利用モデルを折りたたんだとき: 見出し・タスクのボタン・右のボタンを 1 行に(見出しとタスクの行の中身を、欄の中に並べ直す) */
#cca-ui #cca-body [data-sec="model"].sec-folded{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
#cca-ui #cca-body [data-sec="model"].sec-folded > h3.sec-head, #cca-ui #cca-body [data-sec="model"].sec-folded > .row.tasksel{display:contents !important}
#cca-ui #cca-body [data-sec="model"].sec-folded > h3 > .sp{display:none}
#cca-ui #cca-body [data-sec="model"].sec-folded #cca-tasks{order:1;display:flex !important}
#cca-ui #cca-body [data-sec="model"].sec-folded > .tasksel > .sp{order:2;flex:1;display:block !important}
#cca-ui #cca-body [data-sec="model"].sec-folded > h3 > button, #cca-ui #cca-body [data-sec="model"].sec-folded #cca-mguide-open{display:none !important}
#cca-ui .nopanel{margin:auto;max-width:520px;text-align:center;color:var(--muted)}
#cca-mask{position:fixed;inset:0;z-index:1001;background:#000c;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#e4e7eb;
  font:13px system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif}
#cca-mask.open{display:flex}
#cca-mask .stage{position:relative}
#cca-mask canvas{display:block}
#cca-mask canvas.m{position:absolute;inset:0;width:100%;height:100%;opacity:.55;cursor:crosshair;touch-action:none}
#cca-mask .tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center}
#cca-mask button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 12px;cursor:pointer}
#cca-mask button.on,#cca-mask button.pri{background:#2b8f84;border-color:#3db4a6}
#cca-ui .lora{display:grid;grid-template-columns:var(--lcols);gap:6px;align-items:center;margin-bottom:6px}
#cca-ui .lora .hide{display:none}
#cca-ui .help{background:#1f1a10;border:1px solid #6b5422;border-radius:6px;padding:8px;font-size:13px;color:#e8d9b5;display:flex;flex-direction:column;gap:4px}
#cca-ui .help a{color:#7fd6cb}
#cca-ui .help .path{font-family:ui-monospace,Consolas,monospace;background:#0e1115;border-radius:4px;padding:1px 6px;word-break:break-all}
#cca-ui .help .ln{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#cca-ui .help button{padding:2px 8px}
#cca-ui .help.broken,.cca-help.broken{background:#22110f;border-color:#7a3b33;color:#f0d2ca}
.cca-help{background:#1f1a10;border:1px solid #6b5422;border-radius:6px;padding:8px;font-size:13px;color:#e8d9b5;display:flex;flex-direction:column;gap:4px;margin-top:6px}
.cca-help a{color:#7fd6cb}
.cca-help .path{font-family:ui-monospace,Consolas,monospace;background:#0e1115;border-radius:4px;padding:1px 6px;word-break:break-all}
.cca-help .ln{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.cca-help button{padding:2px 8px}
.cca-help summary{cursor:pointer;list-style:none;color:inherit;font-size:13px;margin:0}
.cca-help summary::-webkit-details-marker{display:none}
.cca-help summary::before{content:"▸ ";color:#9fb0c2}
.cca-help details[open]>summary::before{content:"▾ "}
.cca-help .fn{font-family:ui-monospace,Consolas,monospace;word-break:break-all}
.cca-help b,#cca-ui .help b{word-break:break-all}
.cca-help .hint{color:#b8ab88;font-size:12.5px}
.cca-help .why,#cca-ui .help .why{background:#0005;border-radius:4px;padding:4px 6px;white-space:pre-wrap}
#cca-dirs{position:fixed;inset:0;z-index:1001;background:#000b;display:none;align-items:center;justify-content:center;
  font:13px system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb}
#cca-dirs.open{display:flex}
#cca-dirs .box{background:#1a1e25;border:1px solid #303744;border-radius:10px;padding:16px;width:min(900px,calc(100vw - 32px));max-height:88vh;overflow:auto;display:flex;flex-direction:column;gap:10px;font-size:14px}
#cca-dirs h3{margin:0;font-size:17px}
#cca-dirs .hd{display:flex;align-items:center;gap:8px}
#cca-dirs .lead{display:flex;align-items:center;gap:8px;color:#c9d1da}
#cca-dirs .k{border:1px solid #303744;border-radius:8px;padding:10px}
#cca-dirs .kh{display:flex;align-items:center;gap:8px}
#cca-dirs .p{display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap}
#cca-dirs .p code{flex:1;min-width:260px;word-break:break-all;background:#0e1115;padding:4px 8px;border-radius:4px;font-size:13px}
#cca-dirs .cnt{color:#c9d1da;font-size:13px;min-width:4.5em;text-align:right}
#cca-dirs .tag{font-size:13px;color:#959eab}
#cca-dirs .sm{border-color:#e0a23c;background:#231d12}
#cca-dirs details.add summary{cursor:pointer;color:#c9d1da}
#cca-dirs details.add .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
#cca-dirs details.add input{flex:1;min-width:260px}
#cca-dirs input,#cca-dirs select{background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 8px}
#cca-dirs button{background:#20252e;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:5px 10px;cursor:pointer}
#cca-dirs button.pri{background:#2b8f84;border-color:#3db4a6}
#cca-ui .info{margin-top:10px;border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:6px;font-size:13px}
#cca-ui .info .k{color:var(--muted);min-width:7em;display:inline-block}
#cca-ui .info .txt{white-space:pre-wrap;word-break:break-word;background:#0e1115;border:1px solid var(--line);border-radius:6px;padding:6px 8px}
#cca-ui .info .meta{display:flex;flex-wrap:wrap;gap:4px 14px}
#cca-ui .viewer .live{position:relative}
#cca-ui .viewer .live .tag{position:absolute;left:8px;top:8px;background:var(--card,rgba(0,0,0,.7)) !important;color:var(--text,#fff) !important;border:1px solid rgba(0,0,0,.35);font-size:12px;line-height:1.5;padding:2px 8px;border-radius:4px;font-variant-numeric:tabular-nums}
#cca-pop{position:fixed;z-index:1002;background:#1a1e25;border:1px solid #3db4a6;border-radius:8px;box-shadow:0 10px 30px #000c;display:none;flex-direction:column;
  font:13px system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:#e4e7eb;overflow:hidden}
#cca-pop.open{display:flex}
#cca-pop input{margin:6px;background:#0e1115;color:#e4e7eb;border:1px solid #3a4250;border-radius:6px;padding:6px 8px;font:inherit}
#cca-pop .list{overflow:auto;position:relative}
#cca-pop .g{padding:4px 10px;color:#959eab;font-size:12px;background:#151920;position:sticky;top:0}
#cca-pop .o{padding:5px 10px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cca-pop .o.on{background:#2b8f84;color:#fff}
#cca-pop .o.cur{font-weight:700}
#cca-pop .o.hasnote{white-space:normal}
#cca-pop .o .nt{display:block;font-weight:400;font-size:12px;color:#aab3bf;line-height:1.35}
#cca-pop .o.on .nt{color:#e8fffb}
#cca-pop .none{padding:8px 10px;color:#959eab}
@media (max-width:1000px){#cca-ui .body{grid-template-columns:1fr;grid-auto-rows:max-content;overflow-y:auto;gap:0}#cca-ui .col{height:auto;min-height:max-content;overflow:visible}#cca-ui .col > *{flex-shrink:0}#cca-ui .col.right{padding-top:0}#cca-ui .body > .cca-split{display:none}
  #cca-ui.rtop .col.right{order:-1}#cca-ui .col.left.sec-editing ~ .col.right > .rpos{display:flex}}
#cca-ui .rpos{display:none;justify-content:center;padding:6px 0}
`;
  document.head.appendChild(css);
}

// ---------------------------------------------------------------- markup
function sel(name, extra = "") { return `<select data-w="${name}" ${extra}></select>`; }
function num(name, step, extra = "") { return `<input type="number" data-w="${name}" step="${step}" ${extra}>`; }
function ib(key) { return `<button type="button" class="ib" data-ib="${key}" title="説明を表示">ⓘ</button>`; }
function ibox(key, html) { return `<div class="ibox hide" data-ibox="${key}">${html}</div>`; }
// モデル・LoRA の欄: ⓘ に、その種別の標準的なファイル名を出す(中身は refresh で入れる)
const MODEL_INFO_KEYS = ["ckpt_name", "unet_name", "wan_high_unet", "wan_low_unet", "clip_name", "clip_name_2", "vae_name",
  "audio_vae_name", "latent_upscale_name", "turbo_lora_name", "turbo_lora_low_name", "edit_lora_name"];
function field(name, control, cls = "") {
  const info = INFO[name];
  const model = MODEL_INFO_KEYS.includes(name);
  return `<div class="f ${cls}" data-field="${name}"><label class="l"><span data-label="${name}"></span>${info || model ? `<span data-ibwrap="${name}">${ib(name)}</span>` : ""}</label>${info ? ibox(name, esc(info)) : model ? ibox(name, "") : ""}${control}<div class="warn hide" data-missing="${name}"></div></div>`;
}
function rangeField(name, min, max, step) {
  return field(name, `<div class="rng"><input type="range" data-range="${name}" min="${min}" max="${max}" step="${step}">${num(name, step)}</div>`);
}

// ---- おすすめ設定(マイナスプロンプトと範囲別指定は、それぞれ別に「おすすめ / 自分の設定」を持つ)
const ADV_PRESET_REC = "おすすめ", ADV_PRESET_CUSTOM = "自分の設定";
const ADV_KEYS = {
  negw: ["negw_method", "negw_strength", "negw_turbo_gain"],
  regional: ["regional_common", "regional_switch", "regional_feather", "regional_margin"],
};
const advKeysOf = (g) => CCA.SPEC?.adv_keys?.[g] || ADV_KEYS[g];
const advRead = (g, mt) => { try { return JSON.parse(localStorage.getItem(`cca_adv_${g}_${mt}`) || "null"); } catch { return null; } };
const advWrite = (g, mt, o) => { try { localStorage.setItem(`cca_adv_${g}_${mt}`, JSON.stringify(o)); } catch { /* 保存できなくても動く */ } };
// 履歴・PNGinfo から値を戻したあと: 値がそのモデルのおすすめと同じなら「おすすめ」、違えば「自分の設定」にして保存する
async function advCommit() {
  const n = node(), mt = n && W(n, "model_type")?.value, rec = CCA.SPEC?.adv_presets?.[mt];
  if (!n || !mt || !rec) return;
  n._ccaAdvBusy = true;
  try {
    for (const g of Object.keys(ADV_KEYS)) {
      const cur = advValues(n, g), same = Object.entries(rec[g] || {}).every(([k, v]) => cur[k] === v);
      if (!same) advWrite(g, mt, cur);
      const want = same ? ADV_PRESET_REC : ADV_PRESET_CUSTOM;
      if (W(n, `${g}_preset`)?.value !== want) await setW(`${g}_preset`, want);
    }
  } finally { n._ccaAdvBusy = false; }
}
const advValues = (n, g) => Object.fromEntries(advKeysOf(g).map((k) => [k, W(n, k)?.value]));
async function advApply(n, g, vals, preset) {
  n._ccaAdvBusy = true;
  try {
    for (const [k, v] of Object.entries(vals || {})) if (v !== undefined && W(n, k)) await setW(k, v);
    await setW(`${g}_preset`, preset);
  } finally { n._ccaAdvBusy = false; }
}
// モデルの種別が変わったとき: 保存した「自分の設定」があればそれ、無ければそのモデルのおすすめを選ぶ(初回は、おすすめが自動で選ばれる)
async function syncAdv(n) {
  const mt = W(n, "model_type")?.value, recAll = CCA.SPEC?.adv_presets?.[mt];
  if (!recAll || n._ccaAdvBusy || n._ccaAdvModel === mt) return;
  const first = n._ccaAdvModel === undefined;
  n._ccaAdvModel = mt;
  for (const g of Object.keys(ADV_KEYS)) {
    if (!recAll[g]) continue;
    if (first) {
      if (W(n, `${g}_preset`)?.value === ADV_PRESET_CUSTOM) advWrite(g, mt, advValues(n, g));
      else await advApply(n, g, recAll[g], ADV_PRESET_REC);
    } else {
      const saved = advRead(g, mt);
      await advApply(n, g, saved || recAll[g], saved ? ADV_PRESET_CUSTOM : ADV_PRESET_REC);
    }
  }
}

function build() {
  ensureGuideCss();
  injectStyles();
  root = document.createElement("div");
  root.id = "cca-ui";
  root.innerHTML = `
  <div class="top">
    <div class="brand"><b>CCA</b> Generator</div>
    <div class="chip" id="cca-chip"></div>
    <div class="sp"></div>
    <div id="cca-prefs" class="prefs" hidden>
      <label class="ck" title="同梱ワークフローを開いたとき、このパネルを自動で表示する"><input type="checkbox" id="cca-autoopen"> 自動で生成パネルを表示する</label>
      <span title="表示の言語(言語パック)">🌐 言語</span><select id="cca-lang"></select>
      <span title="配色(テーマ)。パネルと画像編集・動画編集の色を変えます">🎨 テーマカラー</span><select id="cca-theme"></select>
    </div>
    <!-- 第52版からの並び: 使い方・並べ替え・グラフを表示・動画編集・画像編集・⚙ 設定 -->
    <button id="cca-guide-open" title="今のモデル種別の使い方を表示">? 使い方</button>
    <span class="secbar" id="cca-secbar"></span>
    <button id="cca-setio-open" class="gear" title="設定(自動で表示・言語・テーマカラー・途中経過の表示・設定の書き出し / 読み込み)">設定</button>
    <button id="cca-pnginfo-open" title="画像(PNG・JPEG・WebP)に入っているプロンプト・設定などを読み取る(コピー・生成ページへの反映)">PNGinfo</button>
    <button id="cca-vedit-open" title="動画をつなげる・切り取る・文字や画像や動画を重ねる">🎬 動画編集</button>
    <button id="cca-imgedit-open" title="画像を開いて編集する(背景を透明にする・オブジェクト除去)">✏ 画像編集</button>
    <button id="cca-close" title="ノードのグラフに戻る">グラフを表示 ✕</button>
  </div>
  <div class="body" id="cca-body">
    <div class="col left">
      <section class="card" data-sec="model">
        <h3>利用モデルの種類 <span class="badge hide" id="cca-turbo-badge">Turbo</span><span class="sp"></span>
          <button class="icon" id="cca-refresh" title="モデル・LoRA・画像の一覧だけを読み直す(ページは再読み込みしません)">🔄</button>
          <button id="cca-dirs-open" title="ComfyUI の models 以外のフォルダからも読み込む">モデルフォルダ設定</button></h3>
        <div class="typesel">
          <div class="f" data-field="model_type">${sel("model_type")}<div class="warn hide" data-missing="model_type"></div></div>
          <button id="cca-reset" title="この種別の設定を既定値(PRESET MEMO の値)に戻す">既定値に戻す</button>
        </div>
        <div class="row tasksel" style="margin-top:10px"><div class="seg" id="cca-tasks"></div><span class="sp"></span>
          <button id="cca-mguide-open" title="この種別のファイルの種類・向いている使い方・大きさ・ライセンス(商用の可否)">📋 モデルの選び方・ライセンス</button></div>
        <div class="warn hide" id="cca-node-warn" style="margin-top:10px"><div id="cca-node-warn-text"></div>
          <button id="cca-addon-open" style="margin-top:6px">入れ方を見る(ComfyUI Manager が無い場合も)</button></div>
      </section>

      <section class="card" id="cca-sec-images" data-sec="images">
        <h3>入力画像 ${ib("images")}</h3>${ibox("images", "枠をクリックして画像を選ぶか、画像をドラッグ&ドロップします。コピーした画像は Ctrl+V で貼り付けられます。")}
        <div class="slots" id="cca-slots">
          ${IMG_KEYS.map((k, i) => slotHtml(k, i + 1)).join("")}
        </div>
        <div class="hint hide" id="cca-slots-more" style="margin-top:6px"></div>
        <div style="margin-top:10px;max-width:320px">${field("mid_frame_pos", num("mid_frame_pos", 1, 'min="0" max="100"'))}</div>
        <div class="row" style="margin-top:10px"><button id="cca-comp-open">🧩 画像を合成する(背景を塗りつぶす)</button></div>
        <div class="editinfo hide" id="cca-editinfo"></div>
      </section>

      <section class="card" data-sec="prompt">
        <h3><span id="cca-prompt-title">プロンプト</span> <span id="cca-prompt-ib" class="hide">${ib("prompt")}</span></h3>${ibox("prompt", "")}
        <div class="row" style="margin-bottom:8px">
          <select id="cca-preset" class="grow" title="★ はこの種別向けのおすすめ。選んだだけでは変わりません"></select>
          <button class="pri" id="cca-preset-add" title="選んだプリセットをプロンプトの末尾に追加(何か書いてあれば改行してから)">↓ 追加</button>
          <button id="cca-preset-save">プリセットに保存</button>
          <button id="cca-preset-del" title="選択中のプリセットを削除">削除</button>
        </div>
        <div class="f" data-field="positive"><textarea class="pos" data-w="positive" placeholder="生成したい内容"></textarea></div>
        <div class="audiohelp hide" id="cca-audio">
          <div class="row" style="gap:6px"><b>🔊 音も一緒に作ります</b>${ib("audio")}
            <span class="sp"></span><button id="cca-audio-ex" title="音の書き方の例をプロンプトの最後に入れる">例を入れる</button></div>
          ${ibox("audio", '<div id="cca-audio-text"></div>')}
        </div>
        <div class="row wordbar" style="margin-top:6px">
          <button class="fold" id="cca-words-btn" aria-expanded="false" title="よく使う言葉の一覧を開く / 閉じる(押すとプロンプトのカーソルの位置に入ります)">💬 サンプルワード</button>
          <button class="fold" id="cca-wc-btn" aria-expanded="false" title="ワイルドカードの一覧と編集を開く / 閉じる(__名前__ と書くと、生成のたびに登録した言葉のどれかに置き換わります)">🎲 ワイルドカード</button>
        </div>
        <div class="words foldbox hide" id="cca-words"><div class="hint">押すと、プロンプトのカーソルの位置に入ります(カーソルを置いていなければ最後)。</div><div id="cca-words-box"></div></div>
${wildcardHtml()}
        <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:6px" id="cca-caption-row"><button id="cca-caption" title="入力画像1の内容を、画像を読めるテキストエンコーダーで文章にします">📝 画像1からプロンプトを作る</button>
          <span id="cca-imgnames" class="row" style="gap:6px;flex-wrap:wrap"></span></div>
        <div style="height:8px"></div>
        ${field("negative", `<textarea class="neg" data-w="negative" placeholder="避けたい内容"></textarea>`)}
      </section>

      <details class="card" id="cca-sec-models" data-sec="models" data-remember open>
        <summary>ベースモデル・LoRA / Turbo</summary>
        <div class="grid">
          ${field("ckpt_name", sel("ckpt_name"))}
          ${field("unet_name", sel("unet_name"))}
          ${field("wan_high_unet", sel("wan_high_unet"))}
          ${field("wan_low_unet", sel("wan_low_unet"))}
        </div>
        <div class="card" data-field="loras" style="margin-top:10px;background:var(--card2)">
          <div class="row" style="margin-bottom:8px"><b>LoRA</b>${ib("loras")}</div>${ibox("loras", "チェックを外すと、一覧から消さずに一時的に使わないようにできます。上から順に掛かります。")}
          <div id="cca-loras"></div>
          <button id="cca-lora-add">+ LoRA を追加</button>
        </div>
        <div class="card" id="cca-turbo" style="margin-top:10px;background:var(--card2)">
          <div class="row" style="margin-bottom:8px"><label class="row"><input type="checkbox" id="cca-turbo-on"> <b>Turbo LoRA を使う</b></label>${ib("turbo")}</div>
          ${ibox("turbo", "少ないステップで生成するための LoRA です。Turbo の種別は、この LoRA を入れる前提の設定(少ないステップ・CFG 1)になっています。モデル自体が Turbo 版のときだけチェックを外します。")}
          <div class="warn hide" id="cca-turbo-warn" style="margin-bottom:8px">⚠ Turbo LoRA が入っていません。Turbo の種別は LoRA を入れる前提の設定(少ないステップ・CFG 1)なので、このままだと崩れた画像・動画になります。LoRA を選ぶか、モデル自体が Turbo 版でなければ Turbo の付かない種別を選んでください。</div>
          <div class="grid">
            ${field("turbo_lora_name", sel("turbo_lora_name"))}
            ${field("turbo_lora_low_name", sel("turbo_lora_low_name"))}
            ${field("turbo_lora_strength", num("turbo_lora_strength", 0.01))}
          </div>
        </div>
        <div class="card" data-field="edit_lora_name" style="margin-top:10px;background:var(--card2)">
          <div class="row" style="margin-bottom:8px"><b>MOSS Edit</b>${ib("mossedit")}</div>${ibox("mossedit", "画像→画像で使う編集用の LoRA です。ファイルは LoRA のフォルダに入れます。")}
          <div class="grid">
            ${field("edit_lora_name", sel("edit_lora_name"))}
            ${field("edit_lora_strength", num("edit_lora_strength", 0.05))}
            ${field("edit_format", sel("edit_format"))}
            ${field("ref_size", sel("ref_size"))}
          </div>
        </div>
      </details>

      <details class="card" id="cca-sec-hires" data-sec="hires" data-remember>
        <summary>Hires. fix <span class="hint" id="cca-hires-sum">オフ</span>${ib("hires")}</summary>${ibox("hires", "生成した画像を拡大してから、もう一度描き込んで細部を整えます。テキスト→画像のときだけ使えます。")}
        <label class="row" style="margin-bottom:8px" data-field="hires_enable"><input type="checkbox" data-w="hires_enable"> <b>Hires. fix を使う</b></label>
        <div class="grid">
          ${field("hires_upscaler", sel("hires_upscaler"))}
          ${rangeField("hires_scale", 1, 4, 0.05)}
          ${rangeField("hires_denoise", 0, 1, 0.01)}
          ${field("hires_steps", num("hires_steps", 1, 'min="0"'))}
          ${field("hires_cfg", num("hires_cfg", 0.1, 'min="0"'))}
        </div>
      </details>

<details class="card" id="cca-sec-neg" data-sec="neg" data-remember>
        <summary>マイナスプロンプト<span> (beta)</span>${ib("neg")}</summary>${ibox("neg", "プロンプトの中に (red:-1.0) のように「単語:-数字」と書くと、その要素を絵から外そうとします。ネガティブプロンプトとは別に、プロンプトの中だけで指定できます。数字と「打ち消しの強さ」が大きいほど強く外します。")}
        <label class="row" style="margin-bottom:8px" data-field="negw_enable"><input type="checkbox" data-w="negw_enable"> <b>マイナスプロンプトを使う</b></label>
        ${field("negw_preset", sel("negw_preset"))}
        <div class="hint" style="margin:4px 0 8px">「おすすめ」は、このモデルの標準の処理方法と数値です。下の項目を変えると「自分の設定」になり、モデルごとに保存されます(書き出し・生成情報にも入ります)。「おすすめ」を選ぶと、このモデルのおすすめに戻ります。</div>
        <div class="grid">${field("negw_method", sel("negw_method"))}${rangeField("negw_strength", 0, 3, 0.05)}${rangeField("negw_turbo_gain", 0, 10, 0.1)}</div>
        <div class="hint" style="margin:6px 0 0">処理方法の「UNet 系」は、SD1.5・SDXL・Illustrious(「チェックポイント」で読み込む、従来の方式のモデル)のことです。「拡散モデル (UNet)」で読み込む MOSS・Qwen Image・FLUX.2 Klein・Wan2.2 などは UNet 系ではなく、どれを選んでも「予測の差を引く」で処理します。</div>
      </details>

      <details class="card" id="cca-sec-reg" data-sec="reg" data-remember>
        <summary>範囲別指定${ib("reg")}</summary>${ibox("reg", "画像に範囲(四角・円・三角)を枠で描き、範囲ごとに別のプロンプトを使います。通常のプロンプトは、どの範囲にも入っていない部分を埋めます。")}
        <label class="row" style="margin-bottom:8px" data-field="regional_enable"><input type="checkbox" data-w="regional_enable"> <b>範囲別指定を使う</b></label>
        <div class="layoutrow hide" id="cca-layout-row">
          <div class="row" style="gap:6px"><button id="cca-layout-open">▭ 枠で配置を指定する</button>${ib("layout")}
            <span class="hint grow" id="cca-layout-sum">枠はまだありません</span><button id="cca-layout-clear" class="hide">枠を外す</button></div>
          ${ibox("layout", '<div id="cca-layout-text"></div>')}
          <label class="row" style="margin:6px 0" data-field="layout_native"><input type="checkbox" data-w="layout_native"> <span>枠を配置の指定として使う(MOSS / FLUX.3 専用の書き方。範囲別指定を使うときは、チェックが無くても使います)</span></label>
        </div>
        <div class="hint" style="margin:4px 0 8px">上の「▭ 枠で配置を指定する」で範囲を描き、範囲ごとに「そこに描きたいもの」を書いてください(範囲の形は四角・円・三角から選べます)。通常のプロンプトは、枠で指定していない部分を埋めます。何も書いていない範囲は使われません。「範囲別指定を使う」のチェックを外すと、枠があっても領域としては使われません。</div>
        ${field("regional_preset", sel("regional_preset"))}
        <div class="hint" style="margin:4px 0 8px">「おすすめ」は、このモデルの標準の処理方法と数値です。下の項目を変えると「自分の設定」になり、モデルごとに保存されます(書き出し・生成情報にも入ります)。「おすすめ」を選ぶと、このモデルのおすすめに戻ります。</div>
        <label class="row" style="margin-bottom:8px" data-field="regional_common"><input type="checkbox" data-w="regional_common"> <span>各場所のプロンプトの前に、メインのプロンプトを付ける</span></label>
        <div class="grid">${rangeField("regional_switch", 0, 100, 1)}${rangeField("regional_feather", 0.5, 32, 0.5)}${field("regional_margin", num("regional_margin", 1, 'min="0" max="64"'))}</div>
        <div class="hint" style="margin:4px 0 8px">枠の中に収める強さ: 100 にすると、領域ごとに最後まで枠の中だけを見て描くので、物が枠からはみ出しません(初期値)。小さくすると、途中から画像全体を見て仕上げるので、枠の境目が自然になりますが、物が枠からはみ出しやすくなります。0 は最初から画像全体を見て描きます。物が枠からはみ出すときは数字を上げ、境目が不自然なときは数字を下げてください。</div>
      </details>

      ${tileHtml(ib, ibox)}

      <section class="card" id="cca-sec-size" data-sec="size">
        <h3>サイズ</h3>
        <div>${field("auto_image_size", `<label class="row"><input type="checkbox" data-w="auto_image_size"> <span>出力サイズを入力画像1に合わせる(オフなら下の幅・高さ)</span></label>`)}</div>
        <div class="sizebox" id="cca-sizebox">
        <div class="f" data-field="size_mode">
          <label class="l">出力サイズ ${ib("size_mode")}</label>${ibox("size_mode", "「サイズ指定」は今まで通りの決め方です。「倍率指定」は画像1の大きさ × 倍率で出力します(Forge の Resize by と同じ)。")}
          <div class="seg" id="cca-size-tabs"><button data-size="サイズ指定">サイズ指定</button><button data-size="倍率指定">倍率指定</button></div>
        </div>
        <div class="hide" id="cca-resize-box" style="margin-top:8px;max-width:320px">${field("resize_mode", sel("resize_mode"))}</div>
        <div class="hint hide" id="cca-size-fixed" style="margin-top:6px"></div>
        <div class="hide" id="cca-scale-box" style="margin-top:8px">
          ${field("size_scale", `<div class="row"><input type="number" data-w="size_scale" step="0.05" min="0.05" style="width:100px">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((x) => `<button data-scale="${x}">×${x}</button>`).join("")}</div>`)}
          <div class="hint" id="cca-scale-result" style="margin-top:4px"></div>
        </div>
        <div class="row" style="margin-top:8px;align-items:flex-end" data-group="size">
          ${field("width", num("width", 8), "grow")}
          <button class="icon" id="cca-swap" title="幅と高さを入れ替え">⇄</button>
          ${field("height", num("height", 8), "grow")}
          <button id="cca-img1size" title="入力画像1の幅・高さを入れる(この種別の単位に丸めます)">📐 画像1のサイズ</button>
          <div class="f grow" data-field="size_preset"><label class="l">サイズのプリセット</label><select id="cca-size"></select></div>
        </div>
        </div>
      </section>

      <section class="card hide" id="cca-sec-audio" data-sec="audiogen">
        <h3>音楽・音声の設定 ${ib("audiogen")}</h3>${ibox("audiogen", '<div id="cca-audiogen-note"></div>')}
        <div id="cca-audio-opts"></div>
      </section>

      <section class="card" data-sec="sampling">
        <h3>生成設定</h3>
        <div class="grid">
          ${field("sampler_name", sel("sampler_name"))}
          ${field("scheduler", sel("scheduler"))}
        </div>
        <div class="grid" style="margin-top:8px">
          ${rangeField("steps", 1, 100, 1)}
          ${rangeField("cfg", 0, 20, 0.1)}
          ${rangeField("denoise", 0, 1, 0.01)}
        </div>
        <div class="row" style="margin-top:8px;align-items:flex-end">
          ${field("seed", `<div class="row">${num("seed", 1, 'class="grow" min="0"')}<button class="icon" id="cca-dice" title="ランダムなシードにする">🎲</button></div>`, "grow")}
          <div class="f" data-field="seed_mode"><label class="l">生成後のシード</label><select id="cca-seedmode">${SEED_MODES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        </div>
        <div class="row" style="margin-top:8px;align-items:flex-end" data-group="video">
          ${field("video_length", num("video_length", 1, 'min="1"'), "grow")}
          ${field("video_fps", num("video_fps", 1, 'min="1"'), "grow")}
          ${field("video_shift", num("video_shift", 0.1, 'min="0.1"'), "grow")}
          <div class="hint" id="cca-video-dur" style="padding-bottom:8px"></div>
        </div>
      </section>

      <details class="card" id="cca-sec-models2" data-sec="models2" data-remember open>
        <summary>その他モデル</summary>
        <div class="grid">
          ${field("clip_name", sel("clip_name"))}
          ${field("clip_name_2", sel("clip_name_2"))}
          ${field("clip_type", sel("clip_type"))}
          ${field("vae_name", sel("vae_name"))}
          ${field("audio_vae_name", sel("audio_vae_name"))}
          ${field("latent_upscale_name", sel("latent_upscale_name"))}
          ${field("unet_dtype", sel("unet_dtype"))}
          ${field("clip_device", sel("clip_device"))}
        </div>
      </details>

      <details class="card" id="cca-sec-out" data-sec="out" data-remember open>
        <summary>保存先 <span class="hint" id="cca-prefix-preview"></span></summary>
        <div class="grid">
          ${field("image_output_prefix", `<input type="text" data-w="image_output_prefix">`)}
          ${field("video_output_prefix", `<input type="text" data-w="video_output_prefix">`)}
          ${field("audio_output_prefix", `<input type="text" data-w="audio_output_prefix">`)}
        </div>
        <div class="hint" style="margin-top:6px">生成した画像・動画・音声のほか、画像編集で保存した画像・動画編集で書き出した動画・ここや編集画面に入れた画像や動画・画像の合成・マスクも、この保存先(output の中)に入ります。input フォルダには入れません。</div>
      </details>
    </div>

    <div class="col right">
      <div class="rpos" id="cca-rpos"><button id="cca-rpos-btn"></button></div>
      <section class="card">
        <div class="gen">
          <button class="pri go" id="cca-go" title="Ctrl+Enter">生成</button>
          <button id="cca-stop" title="実行中の生成を中断">中断</button>
        </div>
        <div style="margin-top:10px" class="bar"><i id="cca-bar"></i></div>
        <div class="status"><span id="cca-status">待機中</span><span id="cca-queue"></span></div>
        <div class="hint hide" id="cca-tile-job"></div>
        <div class="row" style="margin-top:6px"><span class="hint">途中経過の表示</span>
          <select id="cca-previewmethod" style="width:auto" title="ComfyUI の設定「Live preview method」と同じもの">
            <option value="default">ComfyUI の起動設定に従う</option><option value="auto">表示する(自動)</option>
            <option value="latent2rgb">表示する(軽い・粗い)</option><option value="taesd">表示する(TAESD・きれい)</option>
            <option value="none">表示しない</option></select></div>
        <div class="err hide" id="cca-err"></div>
      </section>
      <section class="card">
        <div class="viewer" id="cca-viewer"><div class="empty">生成結果がここに表示されます</div></div>
        <div class="row" style="margin-top:8px">
          <button id="cca-edit-img" disabled title="表示中の画像を画像編集で開く(背景を透明にする・オブジェクト除去)">✏ この画像を編集する</button>
          <button id="cca-zoom-btn" disabled title="画面いっぱいに表示(ホイールで拡大・縮小、ドラッグで移動)">🔍 拡大表示</button>
          <button id="cca-open" disabled>新しいタブで開く</button>
          <button id="cca-folder" disabled title="表示中のファイルがあるフォルダを開く">📂 フォルダを開く</button>
          <span class="sp"></span>
          <button id="cca-gallery" title="これまでの結果を一覧で見る">🖼 ギャラリー一覧</button>
          <button id="cca-clear-hist" title="下の一覧を空にする(ファイルは消えません)">一覧を消去</button>
          <button id="cca-send" disabled title="この画像を入力画像1にして画像→画像で使う">入力画像1に送る</button>
        </div>
        <div class="hist" id="cca-hist" style="margin-top:8px"></div>
        <div class="info hide" id="cca-info"></div>
      </section>
    </div>
  </div>
  <div class="nopanel hide" id="cca-nopanel">
    <h3>CCA Generator パネルが見つかりません</h3>
    <p>同梱の cca_generator_workflow.json を開いてください。</p>
  </div>`;
  document.body.appendChild(root);
  buildMaskEditor();
  bind();
}

function slotHtml(name, n) {
  return `<div class="slot" data-field="${name}" data-slot="${name}">
    <div class="st"><span data-iname="${name}">入力画像${n}</span><small data-role="${name}"></small></div>
    <div class="drop" data-drop="${name}"><span>クリックして選ぶ<br>またはここにドロップ</span></div>
    ${name === "image" ? `<div class="hint hide" id="cca-noalpha" style="margin:4px 0;font-size:11px;line-height:1.4;opacity:.65"></div>` : ""}
    <div class="row">
      <select data-w="${name}" class="grow" title="input フォルダの画像から選ぶ"></select><button data-relist title="保存先(output)と input のファイルの一覧を読み直して、最新にします">更新</button>
    </div>
    <div class="row">
      <button data-upload="${name}">挿入</button>
      ${name === "image" ? `<button data-mask="image" class="hide">マスクを描く</button>` : ""}
      <button data-clear="${name}">外す</button>
    </div>
    <div class="warn hide" data-missing="${name}"></div>
    ${name === "image" ? `<div class="warn hide" id="cca-mask-warn">⚠ MOSS の画像→画像は、変えたい所をマスクで塗って使います(塗った所だけを描き直します)。マスクが無いと画像全体を描き直すため、元の画像がうまく残らないことがあります。「マスクを描く」で塗ってください。</div>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- binding
function node() { return findPanel(); }
function coerce(name, el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number" || el.type === "range") {
    const v = Number(el.value);
    return Number.isFinite(v) ? v : undefined;
  }
  return el.value;
}
async function setW(name, value) {
  const n = node();
  if (!n || value === undefined) return;
  busy = true;
  try {
    await setWidget(n, name, value);
  } finally {
    busy = false;
  }
  if (["model_type", "task"].includes(name)) refresh();
  else refreshLight();
}

// ⓘ: 押すと説明を開く・もう一度押すと閉じる(パネル・フォルダ画面で共通)
function bindInfo(box) {
  box.addEventListener("click", (e) => {
    const b = e.target?.closest?.("[data-ib]");
    if (!b || !box.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    const scope = b.closest(".f, .card, details, .k, .box, #cca-ui") || box;
    const target = scope.querySelector(`[data-ibox="${b.dataset.ib}"]`) || box.querySelector(`[data-ibox="${b.dataset.ib}"]`);
    if (!target) return;
    target.classList.toggle("hide");
    b.classList.toggle("on", !target.classList.contains("hide"));
    if (!target.classList.contains("hide")) target._ccaLoad?.(); // 開いたときに中身を読む(入手先・入れる場所)
  }, true);
}

function bind() {
  root.addEventListener("pointerdown", primeAudio, true); // 第42版: 結果の音をメーターに通しても鳴るように
  bindInfo(root);
  $("#cca-guide-open").onclick = () => openGuide();
  $("#cca-close").onclick = () => close();
  fillLang();
  fillTheme();
  $("#cca-theme").onchange = (e) => setTheme(e.target.value);
  $("#cca-lang").onchange = async (e) => {
    const sel = e.currentTarget;
    sel.disabled = true;
    try { await setLangChoice(sel.value); }
    catch (err) { notify(`言語を切り替えられませんでした: ${err.message}`, "error", sel); }
    finally { sel.disabled = false; fillLang(); refresh(); }
  };
  const auto = $("#cca-autoopen");
  auto.checked = lsGet(LS_AUTOOPEN, true);
  auto.onchange = () => lsSet(LS_AUTOOPEN, auto.checked);

  // ウィジェットに対応する入力
  for (const el of $$("[data-w]")) {
    const name = el.dataset.w;
    const ev = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
    el.addEventListener(ev, () => {
      if (el.type === "number") {
        const r = root.querySelector(`[data-range="${name}"]`);
        if (r) r.value = el.value;
      }
      setW(name, coerce(name, el));
    });
  }
  for (const el of $$("[data-range]")) {
    el.addEventListener("input", () => {
      const name = el.dataset.range;
      const box = root.querySelector(`input[type=number][data-w="${name}"]`);
      if (box) box.value = el.value;
      setW(name, coerce(name, el));
    });
  }

  // おすすめ設定: 項目を変えたら「自分の設定」にして、モデルごとに保存する(値を入れる処理のあとに動かす)
  const advAll = Object.values(ADV_KEYS).flat();
  const advChanged = async (g) => {
    const n = node(); const mt = n && W(n, "model_type")?.value;
    if (!n || !mt || n._ccaAdvBusy) return;
    advWrite(g, mt, advValues(n, g));
    if (W(n, `${g}_preset`)?.value !== ADV_PRESET_CUSTOM) await setW(`${g}_preset`, ADV_PRESET_CUSTOM);
  };
  for (const el of $$("[data-w], [data-range]")) {
    const name = el.dataset.w || el.dataset.range;
    const pg = Object.keys(ADV_KEYS).find((g) => name === `${g}_preset`);
    if (pg) {
      el.addEventListener("change", async () => {
        const n = node(); const mt = n && W(n, "model_type")?.value;
        if (!n || !mt) return;
        if (el.value === ADV_PRESET_REC) await advApply(n, pg, CCA.SPEC.adv_presets?.[mt]?.[pg], ADV_PRESET_REC);
        else { const s = advRead(pg, mt); if (s) await advApply(n, pg, s, ADV_PRESET_CUSTOM); else await advChanged(pg); }
      });
    } else if (advAll.includes(name)) {
      const g = Object.keys(ADV_KEYS).find((x) => ADV_KEYS[x].includes(name));
      el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => advChanged(g));
    }
  }

  $("#cca-refresh").onclick = async () => {
    const b = $("#cca-refresh");
    b.disabled = true;
    try { await refreshChoices(); helpCache.clear(); refresh(); setStatus("モデル一覧を読み直しました"); }
    catch (e) { notify(`モデル一覧を読み込めませんでした: ${e.message}`, "error", b); }
    finally { b.disabled = false; }
  };
  $("#cca-dirs-open").onclick = () => openDirs();
  for (const b of $$("[data-relist]")) b.onclick = async () => {
    b.disabled = true;
    try { await refreshChoices(); helpCache.clear(); refresh(); }
    catch (e) { notify(`一覧を読み込めませんでした: ${e.message}`, "error", b); }
    finally { b.disabled = false; }
  };
  $("#cca-lora-add").onclick = async () => {
    const n = node();
    if (!n) return;
    await setLoras(n, [...parseLoras(W(n, "loras").value), { name: NONE, strength: 1, clip: 1, target: "both", on: true }]);
    renderLoras(n, true);
    refreshLight();
  };
  $("#cca-reset").onclick = async () => {
    const n = node();
    if (!n) return;
    const mt = W(n, "model_type").value;
    if (!confirm(`「${mt}」の設定(モデル・LoRA・ステップ数など)を既定値に戻しますか?\nプロンプトは変わりません。`)) return;
    await resetToDefaults(n);
    refresh();
  };

  // プリセット: 選んだだけでは変えず、「↓ 追加」でプロンプトの末尾に足す
  $("#cca-preset").onchange = async () => {
    if ($("#cca-preset").value === PRESET_RESTORE) {
      const n = node();
      $("#cca-preset").value = PRESET_NEW;
      if (!n || !confirm("消したおすすめプリセット(★)を一覧に戻しますか?")) return;
      try { const k = await restoreHidden(n); fillPresets(); notify(`おすすめプリセットを ${k} 件戻しました`, "info"); }
      catch (e) { notify(`戻せませんでした: ${e.message}`, "error", $("#cca-preset")); }
      return;
    }
    const p = findPreset(node(), $("#cca-preset").value);
    $("#cca-preset-del").disabled = !p;
    $("#cca-preset").title = p ? `ポジティブ: ${p.positive || "(なし)"}\nネガティブ: ${p.negative || "(なし)"}` : "";
  };
  $("#cca-preset-add").onclick = async () => {
    const n = node();
    const id = $("#cca-preset").value;
    if (!n || !id || id === PRESET_NEW || id === PRESET_RESTORE) return;
    await appendPreset(n, id);
    refreshLight();
  };
  $("#cca-preset-save").onclick = async () => {
    const n = node();
    if (!n) return;
    const cur = $("#cca-preset").value;
    const name = prompt(`プリセット名(同じ名前は上書き)\n保存先: ${(presetGroup(n) === "audio" ? CCA.SPEC.audio_preset_file : CCA.SPEC.preset_file) || ""}`,
      cur !== PRESET_NEW && !cur.startsWith(BUILTIN_MARK) ? cur : "");
    if (!name) return;
    try {
      const saved = await savePreset(name, W(n, "positive").value, W(n, "negative").value, presetGroup(n));
      fillPresets(saved);
    } catch (e) { notify(`保存に失敗しました: ${e.message}`, "error", $("#cca-preset-save")); }
  };
  $("#cca-preset-del").onclick = async () => {
    const n = node();
    const p = findPreset(n, $("#cca-preset").value);
    if (!p) return;
    const msg = p.builtin ? `おすすめプリセット「${p.name}」を一覧から消しますか?(あとで元に戻せます)` : `プリセット「${p.name}」を削除しますか?`;
    if (!confirm(msg)) return;
    try {
      if (p.builtin) await hidePreset(n, p);
      else await deletePreset(p.name, presetGroup(n));
      fillPresets();
    } catch (e) { notify(`削除に失敗しました: ${e.message}`, "error", $("#cca-preset-del")); }
  };

  // 画像の合成・画像からプロンプト
  $("#cca-comp-open").onclick = () => openComp();
  $("#cca-pnginfo-open").onclick = () => openPngInfoUi();
  // プロンプト・ネガティブのカーソルの位置を覚える(画像の呼び名・サンプルワード・ワイルドカードをそこに入れる)
  for (const ta of $$('textarea[data-w="positive"], textarea[data-w="negative"]')) {
    for (const ev of ["keyup", "mouseup", "select", "blur", "input"]) ta.addEventListener(ev, () => rememberCaret(ta));
  }
  $("#cca-caption").onclick = (e) => {
    const v = W(node(), "image")?.value;
    if (!v || v === NONE) { notify("入力画像1を入れてください", "error", e.target); return; }
    captionFrom(v, e.target);
  };

  // 出力サイズ: サイズ指定 / 倍率指定(タブ)と倍率のボタン
  for (const b of $$("[data-size]")) b.onclick = () => setW("size_mode", b.dataset.size);
  for (const b of $$("[data-scale]")) b.onclick = () => setW("size_scale", Number(b.dataset.scale));

  // 左の列の項目: 折りたたみ(いつでも)・並べ替え(上の「⇅ 並べ替え」のときだけ)
  sectionEditBar($("#cca-secbar"), [setupSections(root.querySelector(".col.left"), { name: "panel" })]);
  // 第29版: 複数画像タイル生成・サンプルワード / ワイルドカード
  setupTile(UICTX);
  setupWildcards(UICTX);
  sideSplitter($(".body"), "panel", $(".col.right"), { gap: 14, minSide: 360, minMain: 360 }); // 左右の欄の境目をドラッグで動かす
  const LS_RTOP = "cca_generator.narrowtop", rbtn = $("#cca-rpos-btn");
  const rtop = (on) => { root.classList.toggle("rtop", on); rbtn.textContent = T(on ? "▼ 生成ボタンと結果を下に置く" : "▲ 生成ボタンと結果を上に置く"); };
  rtop(lsGet(LS_RTOP, false));
  rbtn.onclick = () => { const on = !root.classList.contains("rtop"); lsSet(LS_RTOP, on); rtop(on); }; // 幅が狭くて 1 列のときの並び
  const prefs = $("#cca-prefs");
  $("#cca-setio-open").onclick = () => { prefs.hidden = false; openSettingsIO(prefs, mediaDirsPanel()); }; // 自動で表示・言語・テーマカラーは設定の中に
  // 生成の履歴(結果の小さな絵の列): ホイールで横に動かす
  $("#cca-hist").addEventListener("wheel", (e) => {
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });

  // 折りたたみの状態を覚える(初回はマークアップの open の有無)
  const saved = lsGet(LS_DETAILS, {});
  for (const d of $$("details[data-remember]")) {
    if (d.id in saved) d.open = !!saved[d.id];
    d.addEventListener("toggle", () => { const st = lsGet(LS_DETAILS, {}); st[d.id] = d.open; lsSet(LS_DETAILS, st); });
  }

  // 途中経過の表示(ComfyUI の Live preview method 設定)
  const pm = $("#cca-previewmethod");
  const setting = app.extensionManager?.setting;
  try { pm.value = setting?.get("Comfy.Execution.PreviewMethod") || "default"; } catch { pm.value = "default"; }
  pm.onchange = async () => {
    try { await setting?.set("Comfy.Execution.PreviewMethod", pm.value); } catch (e) { notify(`設定を変更できませんでした: ${e.message}`, "error", pm); }
  };
  { // 途中経過の表示も ⚙ の設定の中へ(生成ボタンの下からは外す)
    const row = pm.closest(".row"), lab = document.createElement("span");
    lab.textContent = row.querySelector(".hint")?.textContent || "途中経過の表示";
    lab.title = pm.title;
    pm.style.width = "";
    $("#cca-prefs").append(lab, pm);
    row.remove();
  }

  // サイズ・シード
  $("#cca-img1size").onclick = async (e) => {
    const n = node();
    const v = W(n, "image")?.value;
    if (!v || v === NONE) { notify("入力画像1がありません。先に画像1を入れてください。", "error", e.currentTarget); return; }
    const btn = e.currentTarget;
    const size = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res([im.naturalWidth, im.naturalHeight]);
      im.onerror = () => res(null);
      im.src = imageUrl(v);
    });
    if (!size) { notify("入力画像1の大きさを読めませんでした。", "error", btn); return; }
    const step = CCA.SPEC.types_info[W(n, "model_type").value]?.size_step || 16;
    const r = (x) => Math.max(step, Math.round(x / step) * step);
    await setW("width", r(size[0]));
    await setW("height", r(size[1]));
    notify(`画像1の大きさ(${size[0]} × ${size[1]})から ${r(size[0])} × ${r(size[1])} を入れました${step > 1 ? `(${step} の倍数に丸めています)` : ""}`, "info", btn, { toast: false });
    refresh();
  };
  $("#cca-swap").onclick = async () => {
    const n = node();
    if (!n) return;
    const w = W(n, "width").value, h = W(n, "height").value;
    await setW("width", h);
    await setW("height", w);
  };
  $("#cca-size").onchange = async (e) => {
    if (!e.target.value) return;
    const [w, h] = e.target.value.split("x").map(Number);
    await setW("width", w);
    await setW("height", h);
    e.target.value = "";
  };
  $("#cca-dice").onclick = () => setW("seed", Math.floor(Math.random() * 2 ** 48));
  $("#cca-seedmode").onchange = (e) => setW("control_after_generate", e.target.value);

  // Turbo LoRA のオン/オフ
  $("#cca-turbo-on").onchange = async (e) => {
    const n = node();
    if (!n) return;
    const on = e.target.checked;
    for (const name of ["turbo_lora_name", "turbo_lora_low_name"]) {
      const w = W(n, name);
      if (!w || !visibleSet(n).has(name)) continue;
      if (on) {
        const back = n._ccaTurboBackup?.[name];
        const fallback = CCA.SPEC.defaults[W(n, "model_type").value]?.type?.[name]
          ?? CCA.SPEC.defaults[W(n, "model_type").value]?.tasks?.[W(n, "task").value]?.[name];
        const v = back && back !== NONE ? back : fallback;
        if (v && v !== NONE) await setWidget(n, name, v);
      } else {
        n._ccaTurboBackup = { ...(n._ccaTurboBackup || {}), [name]: w.value };
        await setWidget(n, name, NONE);
      }
    }
    refresh();
  };

  // 入力画像
  for (const el of $$("[data-drop]")) {
    const name = el.dataset.drop;
    el.onclick = () => pickAndUpload(name);
    el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
    el.ondragleave = () => el.classList.remove("over");
    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove("over");
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
      if (f) uploadTo(name, f);
    };
    el.onmouseenter = () => { root.dataset.hoverSlot = name; };
  }
  for (const b of $$("[data-upload]")) b.onclick = () => pickAndUpload(b.dataset.upload);
  for (const b of $$("[data-clear]")) b.onclick = () => clearSlot(b.dataset.clear);
  const maskBtn = root.querySelector("[data-mask]");
  if (maskBtn) maskBtn.onclick = () => openMaskEditor();

  // 生成
  $("#cca-go").onclick = () => generate();
  $("#cca-stop").onclick = () => { if (audioJob) audioJob.cancel = true; else api.interrupt?.() ?? api.fetchApi("/interrupt", { method: "POST" }); };
  $("#cca-send").onclick = () => sendToInput();
  $("#cca-open").onclick = () => current && window.open(current.pdfUrl || current.url, "_blank");
  $("#cca-zoom-btn").onclick = () => zoomCurrent();
  $("#cca-folder").onclick = (e) => openOutputFolder(e.currentTarget);
  $("#cca-gallery").onclick = () => openGallery(history, {
    current, onPick: (it) => show(it),
    caption: (it) => `${new Date(it.ts).toLocaleString()}${it.info?.model_type ? ` / ${it.info.model_type}` : ""}`,
  });
  $("#cca-viewer").addEventListener("click", (e) => { if (e.target.tagName === "IMG" && current && !current.isVideo) zoomCurrent(); });
  $("#cca-addon-open").onclick = () => openAddonGuide();
  $("#cca-mguide-open").onclick = () => openGuideForCurrent();
  $("#cca-audio-ex").onclick = () => insertAudioExample();
  $("#cca-layout-open").onclick = () => openLayout();
  $("#cca-layout-clear").onclick = async () => { await setW("layout_boxes", ""); refresh(); };
  $("#cca-clear-hist").onclick = () => {
    if (!history.length) return;
    if (!confirm(`下の一覧(${history.length} 件)を消去しますか?\nファイルは消えません(フォルダに残ります)。`)) return;
    history = []; lsSet(LS_HISTORY, history); renderHistory(); show(null);
  };
  $("#cca-edit-img").onclick = () => current && (current.isVideo ? openVideoEditorFor(current.value) : openImageEditorFor(current.value));
  $("#cca-vedit-open").onclick = () => openVideoEditorFor("");
  $("#cca-imgedit-open").onclick = () => openImageEditorFor("");

  // キー操作: パネル内のキー入力をグラフ側のショートカットに渡さない
  root.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
    // Forge 風: プロンプト欄で Ctrl + ↑↓ → (語:1.1)
    if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown") && e.target?.matches?.('textarea[data-w="positive"], textarea[data-w="negative"]')) {
      if (weightKey(e.target, e.key === "ArrowUp" ? 1 : -1)) e.preventDefault();
    }
    e.stopPropagation();
  });
  root.addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (!f) return;
    const n = node();
    if (!n) return;
    const vis = visibleSet(n);
    let slot = root.dataset.hoverSlot && vis.has(root.dataset.hoverSlot) ? root.dataset.hoverSlot : "image";
    if (!vis.has(slot)) return;
    e.preventDefault();
    uploadTo(slot, f);
  });
}

// 画像を外す。画像を 4 枚以上使える種別(FLUX)は、後ろの画像を前に詰める(プロンプトの画像の番号と画面の番号を揃えるため)
async function clearSlot(name) {
  const n = node();
  if (!n) return;
  const max = maxImages(n);
  const idx = IMG_KEYS.indexOf(name);
  if (max <= 3 || idx < 0) { await setW(name, NONE); return; }
  const vals = IMG_KEYS.slice(0, max).map((k) => W(n, k)?.value);
  vals.splice(idx, 1);
  vals.push(NONE);
  busy = true;
  try {
    for (let i = idx; i < max; i++) {
      if (W(n, IMG_KEYS[i]) && W(n, IMG_KEYS[i]).value !== vals[i]) await setWidget(n, IMG_KEYS[i], vals[i] ?? NONE);
    }
  } finally { busy = false; }
  refresh();
}
function maxImages(n) {
  const mt = W(n, "model_type")?.value, task = W(n, "task")?.value;
  return Number(CCA.SPEC.types_info?.[mt]?.max_images?.[task] || 0);
}
// 画像を 4 枚以上使える種別は、入れた画像の次の枠だけを出す(空の枠がずらっと並ばないように)
function refreshSlots(n, vis) {
  const max = maxImages(n);
  const many = max > 3;
  $("#cca-slots").classList.toggle("many", many);
  let filled = 0;
  IMG_KEYS.forEach((k, i) => {
    const el = root.querySelector(`.slot[data-field="${k}"]`);
    if (!el) return;
    const v = W(n, k)?.value;
    const on = v && v !== NONE;
    let show = vis.has(k);
    if (show && many && i > 0) show = on || i <= filled;
    if (on && vis.has(k)) filled = i + 1;
    el.classList.toggle("hide", !show);
  });
  const more = $("#cca-slots-more");
  more.classList.toggle("hide", !many);
  if (many) {
    const used = IMG_KEYS.slice(0, max).filter((k) => W(n, k)?.value && W(n, k).value !== NONE).length;
    more.textContent = `画像は ${max} 枚まで使えます(今 ${used} 枚)。画像を入れると次の枠が出ます。「外す」と後ろの画像が前に詰まります。`;
  }
}

function pickAndUpload(name) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => { const f = input.files?.[0]; if (f) uploadTo(name, f); };
  input.click();
}
async function uploadTo(name, file) {
  try {
    setStatus("画像を挿入中…");
    const value = await uploadImage(file);
    await setW(name, value);
    setStatus("待機中");
  } catch (e) {
    notify(`画像を挿入できませんでした: ${e.message}`, "error", root.querySelector(`[data-upload="${name}"]`));
  }
}

// ---------------------------------------------------------------- refresh
// 設定の「画像・動画を読み込む場所」で追加したフォルダのファイル: cca_links/<フォルダ名>_<6桁>/<ファイル名>[ [input]]
const LINK_RE = /^cca_links\/(.+)_[0-9a-f]{6}\/(.+?)( \[input\])?$/;
// 追加フォルダごとのグループ(optgroup)にする。mk(v) は 1 つ分の <option>
function linkGroups(values, mk) {
  const groups = new Map();
  for (const v of values) {
    const g = LINK_RE.exec(v)?.[1] || "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  }
  return [...groups].map(([g, vs]) => `<optgroup label="${esc(`${T("追加フォルダ")}: ${g}`)}">${vs.map(mk).join("")}</optgroup>`).join("");
}
function fillSelect(el, values, value, labelFn) {
  const list = Array.isArray(values) ? [...values] : [];
  const missing = value !== undefined && value !== null && value !== "" && !list.includes(value);
  const all = missing ? [value, ...list] : list;
  const mk = (v) => `<option value="${esc(v)}">${esc(LINK_RE.test(v) ? v.replace(LINK_RE, "$2") : labelFn ? labelFn(v) : v)}${missing && v === value ? "(見つかりません)" : ""}</option>`;
  const linked = all.filter((v) => LINK_RE.test(v));
  let html;
  if (!linked.length) html = all.map(mk).join("");
  else { // 追加フォルダがあるときだけ、どこの場所か分かるようにグループに分ける
    const plain = all.filter((v) => !LINK_RE.test(v));
    const head = plain.filter((v) => v === NONE || (missing && v === value)), std = plain.filter((v) => !head.includes(v));
    html = head.map(mk).join("") + (std.length ? `<optgroup label="${esc(T("標準の場所"))}">${std.map(mk).join("")}</optgroup>` : "") + linkGroups(linked, mk);
  }
  if (el._ccaHtml !== html) { el.innerHTML = html; el._ccaHtml = html; }
  el.value = value ?? "";
}
function fillPresets(select) {
  const el = $("#cca-preset");
  const entries = presetEntries(node());
  const opt = (p) => `<option value="${esc(p.id)}">${esc(p.id)}</option>`;
  const builtin = entries.filter((p) => p.builtin);
  const user = entries.filter((p) => !p.builtin);
  const hidden = hiddenCount(node());
  el.innerHTML = `<option value="${esc(PRESET_NEW)}">${esc(PRESET_NEW)}</option>`
    + user.map(opt).join("")
    + (builtin.length ? `<optgroup label="おすすめ(この種別・タスク向け)">${builtin.map(opt).join("")}</optgroup>` : "")
    + (hidden ? `<option value="${PRESET_RESTORE}">★ 消したおすすめを元に戻す(${hidden} 件)</option>` : "");
  const ids = entries.map((p) => p.id);
  el.value = select && ids.includes(select) ? select : PRESET_NEW;
  const p = findPreset(node(), el.value);
  $("#cca-preset-del").disabled = !p;
}
function fillModelTypes(n) {
  const el = root.querySelector('[data-w="model_type"]');
  const groups = { image: [], video: [], audio: [] };
  for (const t of CCA.SPEC.types) groups[CCA.SPEC.types_info[t].kind].push(t);
  const label = (t) => (CCA.SPEC.types_info[t].is_turbo ? `${t} ⚡` : t);
  // data-note = 種別の短い説明(プルダウンを開いたときに名前の下に出す)
  const opt = (t) => `<option value="${esc(t)}" data-note="${esc(CCA.SPEC.types_info[t].note || "")}" data-lic="${esc(CCA.SPEC.types_info[t].license || "")}" data-lic-html="${esc(licBadge(CCA.SPEC, CCA.SPEC.types_info[t].license))}">${esc(label(t))}</option>`;
  const html = `<optgroup label="画像">${groups.image.map(opt).join("")}</optgroup>`
    + `<optgroup label="動画">${groups.video.map(opt).join("")}</optgroup>`
    + `<optgroup label="音楽・音声">${groups.audio.map(opt).join("")}</optgroup>`;
  if (el._ccaHtml !== html) { el.innerHTML = html; el._ccaHtml = html; }
  el.value = W(n, "model_type").value;
}
function fillTasks(n) {
  const mt = W(n, "model_type").value;
  const cur = W(n, "task").value;
  const box = $("#cca-tasks");
  box.innerHTML = (CCA.SPEC.types_info[mt]?.tasks || [])
    .map((t) => `<button data-task="${t}" class="${t === cur ? "on" : ""}">${esc(CCA.SPEC.task_labels[t] || t)}</button>`).join("");
  for (const b of box.querySelectorAll("button")) b.onclick = () => setW("task", b.dataset.task);
}

const EDIT_FORMAT_LABELS = {
  "自動": "自動(LoRA から判定)",
  "ai-toolkit": "ai-toolkit(HQ 系 armV3・V5・V7 など)",
  "ai-toolkit (kv_cache off)": "ai-toolkit・kv_cache オフで学習したもの",
  "Moss-Image-Edit": "Moss-Image-Edit(chinoll 版・公式 rank64)",
};
const editFormatCache = new Map();
async function editFormatOf(format, name) {
  const key = `${format}|${name}`;
  if (!editFormatCache.has(key)) {
    editFormatCache.set(key, api.fetchApi(`/cca_generator/edit_format?format=${encodeURIComponent(format)}&name=${encodeURIComponent(name)}`)
      .then((r) => r.json()).catch(() => null));
  }
  return editFormatCache.get(key);
}
// MOSS の画像→画像: 使う Edit LoRA・形式・よくある失敗の原因を入力画像の欄に出す
async function updateEditInfo(n) {
  const box = $("#cca-editinfo");
  if (!box) return;
  const vis = visibleSet(n);
  if (!vis.has("edit_lora_name")) { box.classList.add("hide"); box._ccaKey = ""; return; }
  const name = W(n, "edit_lora_name")?.value;
  const strength = Number(W(n, "edit_lora_strength")?.value);
  const format = W(n, "edit_format")?.value;
  const ref = W(n, "ref_size")?.value;
  const turbo = CCA.SPEC.types_info[W(n, "model_type").value]?.is_turbo && W(n, "turbo_lora_name")?.value !== NONE;
  const cfg = Number(W(n, "cfg")?.value);
  const img2 = W(n, "image_2")?.value;
  const key = JSON.stringify([name, strength, format, ref, turbo, cfg, img2]);
  if (box._ccaKey === key) return;
  box._ccaKey = key;
  box.classList.remove("hide");
  const lines = [];
  const details = [];
  const warn = (t) => lines.push(`<div class="w">⚠ ${t}</div>`);
  if (!name || name === NONE) {
    warn("Edit LoRA が選ばれていません。「モデル・LoRA」の MOSS Edit で選んでください。");
  } else {
    const info = await editFormatOf(format, name);
    if (box._ccaKey !== key) return;
    const fmt = info?.format ? (EDIT_FORMAT_LABELS[info.format] || info.format) : "?";
    details.push(`Edit LoRA: ${esc(name)}(強度 ${strength})`, `読み方(Edit 形式): ${esc(fmt)}${info?.auto ? `(自動: ${esc(info.reason || "")})` : ""}`);
    if (strength < 1) warn("Edit LoRA の強度が 1.0 未満です。1.0 にしてください。下げると画像2がそのまま貼り付いたように出やすくなります。");
  }
  details.push(`参照画像の大きさ: ${esc(ref || "")}`);
  if (turbo) warn("Turbo(8 ステップ・CFG 1)では編集が効きにくくなります。うまくいかないときはモデル種別を「MOSS」(Turbo なし)・30 ステップ・CFG 3〜5 にしてください。");
  else if (cfg < 2) warn(`CFG ${cfg} は編集には低すぎます。3〜5 にしてください。`);
  box.innerHTML = lines.join("") + `<div class="row" style="gap:6px"><span class="hint">MOSS Edit の設定</span>${ib("editinfo")}</div>`
    + ibox("editinfo", details.join("<br>"));
}

// 値だけ更新(入力中の欄は触らない)
function refreshLight() {
  const n = node();
  if (!n || !root) return;
  refreshTile();
  for (const el of $$("[data-w]")) {
    if (el === document.activeElement && el.tagName !== "SELECT") continue;
    const name = el.dataset.w;
    const w = W(n, name);
    if (!w) continue;
    if (name === "model_type") continue;
    if (el.tagName === "SELECT") {
      const values = IMG_KEYS.includes(name) ? [NONE, ...(w.options?.values || []).filter((v) => v !== NONE)] : w.options?.values;
      fillSelect(el, values, w.value, name === "edit_format" ? (v) => EDIT_FORMAT_LABELS[v] || v : undefined);
      el.classList.toggle("missing", isMissingFile(n, name));
    } else if (el.type === "checkbox") {
      el.checked = !!w.value;
    } else {
      el.value = w.value ?? "";
    }
    const r = root.querySelector(`[data-range="${name}"]`);
    if (r) r.value = w.value;
  }
  for (const el of $$("[data-missing]")) {
    const name = el.dataset.missing;
    const miss = isMissingFile(n, name) && visibleSet(n).has(name);
    el.classList.toggle("hide", !miss);
    if (miss) {
      const kind = CCA.SPEC.list_kind[(CCA.SPEC.list_keys || CCA.SPEC.file_keys)[name]];
      if (kind) renderHelp(el, kind, W(n, name).value);
      else el.textContent = "見つかりません。別の画像を選んでください。";
    } else {
      el.innerHTML = "";
      el._ccaKey = "";
    }
  }
  renderLoras(n);
  updateEditInfo(n);
  // 入力画像のプレビュー
  for (const name of IMG_KEYS) {
    const v = W(n, name)?.value;
    const drop = root.querySelector(`[data-drop="${name}"]`);
    const on = v && v !== NONE;
    const masked = name === "image" && /(^|\/)cca_masks\//.test(parseImageValue(v).subfolder + "/");
    const src = masked ? (maskPreview(n, v) || imageUrl(v)) : imageUrl(v);
    const html = on
      ? `<img src="${esc(src)}" alt="">${masked ? '<span class="mk">マスクあり(赤い所を作り直す)</span>' : ""}`
      : `<span>クリックして選ぶ<br>またはここにドロップ${name !== "image" ? "<br><small>(任意・使う場合だけ)</small>" : ""}</span>`;
    if (drop._ccaHtml !== html) { drop.innerHTML = html; drop._ccaHtml = html; }
  }
  // MOSS の画像→画像はマスクを塗って使う(マスクが無いときだけ注意を出す)
  {
    const v = W(n, "image")?.value;
    const moss = CCA.SPEC.types_info[W(n, "model_type").value]?.base === "MOSS" && W(n, "task")?.value === "I2I";
    const masked = v && v !== NONE && /(^|\/)cca_masks\//.test(parseImageValue(v).subfolder + "/");
    $("#cca-mask-warn")?.classList.toggle("hide", !(moss && v && v !== NONE && !masked));
  }
  const sm = W(n, "control_after_generate");
  if (sm) $("#cca-seedmode").value = sm.value;
  const vis = visibleSet(n);
  const turboOn = ["turbo_lora_name", "turbo_lora_low_name"].some((k) => vis.has(k) && W(n, k)?.value && W(n, k).value !== NONE);
  $("#cca-turbo-on").checked = turboOn;
  const isTurbo = !!CCA.SPEC.types_info[W(n, "model_type").value]?.is_turbo;
  $("#cca-turbo-warn").classList.toggle("hide", !(isTurbo && vis.has("turbo_lora_name") && !turboOn));
  // 今の種別の保存先を先に見せる(画像・動画の両方)
  const pv = [["image_output_prefix", "画像"], ["video_output_prefix", "動画"], ["audio_output_prefix", "音声"]];
  const kd = CCA.SPEC.types_info[W(n, "model_type").value]?.kind;
  if (kd === "video" || kd === "audio") pv.unshift(...pv.splice(kd === "video" ? 1 : 2, 1));
  // 「画像」「動画」は別の要素にする(言語を切り替えたとき、その言葉だけが訳されるように)
  const pvEl = $("#cca-prefix-preview");
  pvEl.replaceChildren(...pv.flatMap(([k, l], i) => {
    const sp = document.createElement("span");
    sp.textContent = T(l);
    return [...(i ? [document.createTextNode(" / ")] : []), sp, document.createTextNode(` ${previewPrefix(W(n, k)?.value)}`)];
  }));
  const hOn = !!W(n, "hires_enable")?.value;
  $("#cca-hires-sum").textContent = hOn
    ? `オン: ×${W(n, "hires_scale")?.value} / ${W(n, "hires_upscaler")?.value} / Denoise ${W(n, "hires_denoise")?.value}`
    : "オフ";
  refreshSize(n, vis);
  refreshSlots(n, vis);
  refreshImageNames(n, vis);
  $("#cca-chip").textContent = `${W(n, "model_type").value} / ${CCA.SPEC.task_labels[W(n, "task").value] || W(n, "task").value}`;
}

// ---------------------------------------------------------------- 小さな処理を ComfyUI のキューで実行(背景を消す・画像からプロンプト)
const miniIds = new Set();
// 小さなワークフローを実行して、終わったら履歴の項目を返す
// opts.onStatus({ phase: "wait", ahead } | { phase: "node", node, type } | { phase: "progress", node, type, value, max })
// opts.job: { cancel: false } — cancel を true にすると、順番待ちなら取り消し、実行中なら止める(Error.cancelled = true)
async function runMini(prompt, opts = {}) {
  const r = await api.fetchApi("/prompt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: api.clientId ?? api.initialClientId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const ne = Object.values(j.node_errors || {}).flatMap((x) => (x.errors || []).map((e) => `${e.message}: ${e.details}`)).join(" / ");
    throw new Error(`${j.error?.message || r.status}${ne ? ` (${ne})` : ""}`);
  }
  const id = j.prompt_id;
  miniIds.add(id);
  const say = (s) => { try { opts.onStatus?.(s); } catch { /* 表示の失敗で止めない */ } };
  const typeOf = (n) => prompt[n]?.class_type || "";
  // 進み具合(ステップ)と、いま動いているノード
  const onProg = ({ detail: d }) => { if (d?.prompt_id === id) say({ phase: "progress", node: String(d.node ?? ""), type: typeOf(d.node), value: d.value, max: d.max }); };
  const onExec = ({ detail: d }) => {
    // 文字だけ(ノードの番号)の知らせは、どの処理のものか分からないので使わない(progress_state で分かる)
    const n = d && typeof d === "object" && d.prompt_id === id ? d.node : null;
    if (n != null && prompt[n]) say({ phase: "node", node: String(n), type: typeOf(n) });
  };
  const onState = ({ detail: d }) => {
    if (d?.prompt_id !== id) return;
    for (const [n, x] of Object.entries(d.nodes || {})) if (x.state === "running") say({ phase: "node", node: n, type: typeOf(n) });
  };
  if (opts.onStatus) { api.addEventListener("progress", onProg); api.addEventListener("executing", onExec); api.addEventListener("progress_state", onState); }
  let cancelSent = false;
  try {
    for (let i = 0; i < 1800; i++) {
      await new Promise((res) => setTimeout(res, 700));
      if (opts.job?.cancel && !cancelSent) {
        cancelSent = true;
        // 順番待ちなら一覧から外し、実行中ならこの処理だけ止める
        await api.fetchApi("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [id] }) }).catch(() => {});
        await api.fetchApi("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: id }) }).catch(() => {});
      }
      const h = await (await api.fetchApi(`/history/${encodeURIComponent(id)}`)).json();
      const e = h?.[id];
      if (!e) {
        if (opts.onStatus || cancelSent) {
          // 順番待ちの数(前に何件あるか)。取り消したあと一覧にも無ければ終わり
          const q = await (await api.fetchApi("/queue", { cache: "no-store" })).json().catch(() => null);
          if (q) {
            const run = (q.queue_running || []).map((x) => x[1]), pend = (q.queue_pending || []).slice().sort((a, b) => a[0] - b[0]).map((x) => x[1]);
            const at = pend.indexOf(id);
            if (at >= 0) say({ phase: "wait", ahead: run.length + at });
            else if (cancelSent && !run.includes(id)) { const c = new Error(T("中止しました")); c.cancelled = true; throw c; }
          }
        }
        continue;
      }
      const msgs = e.status?.messages || [];
      if (msgs.some((m) => m[0] === "execution_interrupted")) { const c = new Error(T("中止しました")); c.cancelled = true; throw c; }
      const err = msgs.find((m) => m[0] === "execution_error");
      if (err) throw new Error(err[1]?.exception_message || "処理に失敗しました");
      if (e.status?.completed || e.status?.status_str === "success") return e;
      if (e.status?.status_str === "error") throw new Error("処理に失敗しました");
    }
    throw new Error("時間内に終わりませんでした");
  } finally {
    if (opts.onStatus) { api.removeEventListener("progress", onProg); api.removeEventListener("executing", onExec); api.removeEventListener("progress_state", onState); }
  }
}

// ---------------------------------------------------------------- 画像からプロンプト(ComfyUI 本体の Generate Text。追加のインストール不要)
// ---- 画像からプロンプトを作るテキストエンコーダーの選び方(下の CAPTION_ENCODERS)
// ComfyUI の文章生成(Generate Text)で画像を読めるテキストエンコーダー(ComfyUI 0.45 で確認)。良い順に探す
//   Qwen3.5-9B(MOSS 用)= 種類 moss_image(以前の版で動いていた読み方)。FLUX.3 のプロンプト拡張用は種類 flux3(公式テンプレートと同じ)
//   Qwen3-VL-4B(Krea2・FLUX.3)= 種類 krea2(画像も読める読み方)
// Qwen Image の qwen_2.5_vl は、ComfyUI のこの版では文章を作れないので使わない
const CAPTION_ENCODERS = [
  [/qwen3\.?5[_-]?9b.*flux3|flux3.*qwen3\.?5[_-]?9b/i, ["flux3"]],
  [/qwen3\.?5[_-]?9b/i, ["moss_image", "flux3"]],
  [/qwen3[_-]?vl[_-]?4b/i, ["krea2"]],
];
function captionEncoder() {
  const n = node();
  const clips = (W(n, "clip_name")?.options?.values || []).filter((v) => v && v !== NONE);
  const types = W(n, "clip_type")?.options?.values || [];
  const cur = W(n, "clip_name")?.value;
  // 今の種別のテキストエンコーダーが使えるなら、それを優先(読み込み済みのことが多い)
  const order = cur && clips.includes(cur) ? [cur, ...clips.filter((c) => c !== cur)] : clips;
  for (const pass of [0, 1, 2]) {
    for (const name of order) {
      const [re, want] = CAPTION_ENCODERS[pass];
      if (!re.test(name)) continue;
      if (pass === 1 && CAPTION_ENCODERS[0][0].test(name)) continue;
      const type = want.find((t) => types.includes(t));
      if (type) return { name, type };
    }
  }
  return null;
}
async function captionFrom(value, btn) {
  const n = node();
  const enc = captionEncoder();
  if (!enc) {
    notify("画像からプロンプトを作るには、画像を読めるテキストエンコーダーが必要です。MOSS 用の qwen3.5_9b_w4a8_gptq か、Krea2・FLUX.3 用の qwen3vl_4b をテキストエンコーダーのフォルダに入れてください(ComfyUI 本体の機能を使うので、追加のインストールはいりません)。Qwen Image の qwen_2.5_vl は、ComfyUI のこの版では文章を作れません。", "error", btn);
    return;
  }
  if (!confirm(`画像を読み取って、プロンプトを作ります。\n\n使うテキストエンコーダー: ${enc.name}\n(初めて使うときは読み込みに時間がかかります)\n\n作ったプロンプトは、プロンプト欄の最後に入ります。始めますか?`)) return;
  const tags = ["ckpt"].includes(CCA.SPEC.types_info[W(n, "model_type").value]?.loader) || CCA.SPEC.types_info[W(n, "model_type").value]?.base === "Anima";
  const instruction = tags
    ? "List the contents of this image as comma-separated Danbooru-style tags, most important first. Output only the tags."
    : "Describe this image in one detailed English paragraph that can be used as a prompt for an image generation model. Output only the description.";
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "作成中…(初回はテキストエンコーダーの読み込みに時間がかかります)";
  try {
    const out = await runMini({
      1: { class_type: "CLIPLoader", inputs: { clip_name: enc.name, type: enc.type, device: "default" } },
      2: { class_type: "LoadImage", inputs: { image: value } },
      3: { class_type: "TextGenerateV2", inputs: { clip: ["1", 0], prompt: instruction, "images.image1": ["2", 0], max_length: 320,
        sampling_mode: "off", thinking: false, use_default_template: true, mtp: "auto" } },
      4: { class_type: "PreviewAny", inputs: { source: ["3", 0] } },
    });
    const text = String(out?.outputs?.["4"]?.text?.[0] ?? "").trim();
    if (!text) throw new Error("文章が返ってきませんでした");
    const cur = String(W(n, "positive").value || "").trim();
    await setW("positive", cur ? `${cur}\n${text}` : text);
    notify(`プロンプトに入れました(${enc.name})`, "info", btn, { toast: false });
  } catch (e) {
    notify(`プロンプトを作れませんでした: ${e.message}`, "error", btn);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------- 画像の呼び名・サンプルワード・ワイルドカードをプロンプトに入れる(カーソルの位置)
const carets = {}; // 欄(positive / negative)→ カーソルの位置 { value, start, end }
function rememberCaret(ta) { carets[ta.dataset.w] = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd }; }
// 覚えたカーソルの位置(欄の中身がその後で変わっていたら最後)
function caretOf(field, cur) {
  const c = carets[field];
  return c && c.value === cur ? [c.start, c.end] : [cur.length, cur.length];
}
async function putText(field, next, pos) {
  await setW(field, next);
  carets[field] = { value: next, start: pos, end: pos };
  const ta = root.querySelector(`textarea[data-w="${field}"]`);
  if (ta) { ta.value = next; ta.focus({ preventScroll: true }); ta.setSelectionRange(pos, pos); }
}
// 画像の呼び名(文の中に入れるので、前後は空白だけ)
async function insertAtCaret(text) {
  const n = node();
  const cur = String(W(n, "positive").value || "");
  const [start, end] = caretOf("positive", cur);
  const before = cur.slice(0, start), after = cur.slice(end);
  const pre = before && !/\s$/.test(before) ? " " : "";
  const post = after && !/^[\s.,!?)]/.test(after) ? " " : "";
  await putText("positive", before + pre + text + post + after, (before + pre + text).length);
}
// 第30版: サンプルワード・ワイルドカードは、カーソルの位置に入れて前後の区切りを合わせる。
// タグの言葉は「, 」、大文字で始まる文は「. 」。前が「,」「.」なら空白だけ、行の頭・「(」の後ろは何も足さない。
// 後ろに言葉が続くときは後ろにも区切りを足す。「A photo of 」のように空白で終わる言葉は、続けて書けるよう後ろに足さない
function joinWord(before, word, after) {
  const sentence = /^[A-Z]/.test(word);
  let L = before, pre = "";
  if (!word.startsWith("\n") && before.trim() && !/\n[ \t]*$/.test(before)) {
    L = before.replace(/[ \t]+$/, "");
    const last = L.slice(-1);
    pre = /[.!?,;:]/.test(last) ? " " : last === "(" ? "" : sentence ? ". " : ", ";
  }
  let R = after, post = "";
  if (R.trim() && !/[ \n]$/.test(word)) {
    R = R.replace(/^[ \t]+/, "");
    if (!/^[\n,.;:!?)]/.test(R)) post = sentence ? ". " : ", ";
  }
  return { text: L + pre + word + post + R, caret: (L + pre + word).length };
}
async function insertWord(field, word) {
  const n = node();
  if (!n) return;
  const cur = String(W(n, field)?.value || "");
  const [start, end] = caretOf(field, cur);
  const r = joinWord(cur.slice(0, start), word, cur.slice(end));
  await putText(field, r.text, r.caret);
}
function refreshImageNames(n, vis) {
  const box = $("#cca-imgnames");
  const names = CCA.SPEC.image_names?.[currentKey(n)] || [];
  const named = vis.has("image") && names[0] && !names[0].startsWith("入力画像");
  const shown = named ? IMG_KEYS.map((k, i) => [k, i]).filter(([k]) => vis.has(k) && !root.querySelector(`.slot[data-field="${k}"]`)?.classList.contains("hide")) : [];
  const html = shown.map(([, i]) => `<button class="chip" data-imgname="${esc(names[i])}" title="プロンプトのカーソルの位置に「${esc(names[i])}」を入れる(画像${i + 1})">画像${i + 1}: ${esc(names[i])}</button>`).join("");
  if (box._ccaHtml === html) return;
  box._ccaHtml = html;
  box.innerHTML = html;
  for (const b of box.querySelectorAll("[data-imgname]")) {
    b.onmousedown = (e) => e.preventDefault(); // プロンプト欄のカーソルを動かさない
    b.onclick = () => insertAtCaret(b.dataset.imgname);
  }
}

// ---------------------------------------------------------------- 画像の合成
function openPngInfoUi() {
  const n = node();
  if (!n) return;
  guardComfyKeys();
  openPngInfo({
    get: (k) => W(n, k)?.value,
    set: (k, v) => setW(k, v),
    advCommit: () => advCommit(),
    applyTile: (o) => applyTileSettings(o),
    options: (k) => [...(W(n, k)?.options?.values || [])],
    modelWidget: () => (CCA.SPEC.types_info[W(n, "model_type").value]?.loader === "ckpt" ? "ckpt_name" : "unet_name"),
    notify,
  });
}

function openComp() {
  const n = node();
  if (!n) return;
  const imgs = () => [...new Set([...(W(n, "image")?.options?.values || [])].filter((v) => v && v !== NONE))];
  const v1 = W(n, "image")?.value, v2 = W(n, "image_2")?.value;
  guardComfyKeys();
  openComposer({
    base: v1 && v1 !== NONE ? v1 : "",
    layer: v2 && v2 !== NONE ? v2 : "",
    images: imgs,
    imageUrl: (v) => imageUrl(v),
    viewUrl: (q) => api.apiURL(`/view?${q}`),
    upload: (file, sub) => uploadImage(file, sub),
    onUse: async (value) => { await setW("image", value); },
    notify,
    runMini,
    bgModels: () => CCA.SPEC?.choices?.bg_models || [],
    openFolder: async (kind, anchor) => {
      try {
        const h = await fileHelp(kind, "");
        const f = h?.folders?.[0];
        if (!f) throw new Error("フォルダが分かりませんでした");
        await openWithMessage(anchor, f.path);
      } catch (e) { notify(e.message, "error", anchor); }
    },
    caption: (value, anchor) => captionFrom(value, anchor),
  });
}

// ---------------------------------------------------------------- 画像編集(第14版)
// value: 開く画像(結果なら "name.png [output]")。空なら何もない状態で開く
function openImageEditorFor(value) {
  guardComfyKeys(); // 開いている間は ComfyUI 本体の「元に戻す」を動かさない
  const n = node();
  openImageEditor({
    value,
    images: () => [...new Set([...galleryValues("image"), ...(n ? W(n, "image")?.options?.values || [] : [])].filter((v) => v && v !== NONE))],
    imageUrl: (v) => imageUrl(v),
    upload: (file) => uploadImage(file, ""),
    notify,
    runMini,
    // 保存先: 生成パネルの「画像の保存先」と同じフォルダ
    outPrefix: () => (node() ? W(node(), "image_output_prefix")?.value : null) ?? null,
    choices: () => CCA.SPEC?.choices || {},
    fileHelp: (kind, name) => fileHelp(kind, name),
    fileCheck: (kind, name) => fileCheck(kind, name),
    // 生成パネルの「見つかりません」と同じ箱(画像編集の中なので class は cca-help)
    renderFileHelp: (el, kind, name, opts = {}) => renderHelp(el, kind, name, { ...opts, cls: "cca-help" }),
    openPath: (path, anchor) => openWithMessage(anchor, path),
    refreshChoices: async () => { await refreshChoices(); helpCache.clear(); },
    // 保存した画像は結果の一覧にも入れる
    onSaved: (info) => {
      const q = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder || "", type: info.type || "output" });
      history.unshift({ url: api.apiURL(`/view?${q}`), isVideo: false, ts: Date.now(), promptId: "", value: info.value, edited: true });
      history = history.slice(0, HISTORY_MAX);
      lsSet(LS_HISTORY, history);
      renderHistory();
      show(history[0]);
    },
    useAsImage1: async (v) => {
      if (!n) throw new Error("CCA Generator パネルが見つかりません");
      const mt = W(n, "model_type").value;
      if (!visibleSet(n).has("image")) {
        const t = (CCA.SPEC.types_info[mt]?.tasks || []).find((x) => x === "I2I" || x === "I2V");
        if (t) await setW("task", t);
      }
      await rememberImage(v);
      await setW("image", v);
      refresh();
    },
  });
}

// ---------------------------------------------------------------- 動画編集(第15版)
// 生成履歴(ギャラリー)のファイル。設定の「生成履歴(ギャラリー)のファイルを一番上に足す」がオンのとき、画像・動画の挿入の一覧の先頭に出す
let histTopOpt = true;
const refreshHistOpt = () => mediaDirs().then((d) => { histTopOpt = !!(d.options || {}).history_top; }).catch(() => {});
setTimeout(refreshHistOpt, 1500);
const galleryValues = (kind) => (!histTopOpt ? [] : [...new Set(history.filter((h) => h.value && !h.pdf && (kind === "video" ? h.isVideo : kind === "audio" ? h.isAudio : !h.isVideo && !h.isAudio)).map((h) => h.value))]);
function openVideoEditorFor(value) {
  guardComfyKeys(); // 開いている間は ComfyUI 本体の「元に戻す」を動かさない
  openVideoEditor({
    value,
    galleryFiles: galleryValues,
    upload: (file) => uploadImage(file, ""),
    notify,
    // 生成パネルの「見つかりません」と同じ箱(フォントの案内に使う)
    guideBox: (el, o) => { el.className = "cca-help"; guideBox(el, o); },
    openPath: (path, anchor) => openWithMessage(anchor, path),
    ignore: (id) => miniIds.add(id),
    // 保存先: 生成パネルの「動画の保存先」と同じフォルダ
    outPrefix: () => (node() ? W(node(), "video_output_prefix")?.value : null) ?? null,
    // 書き出した動画は結果の一覧にも入れる
    onSaved: (info) => {
      const q = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder || "", type: info.type || "output" });
      // WebP・GIF(アニメーション)は画像として見せる
      history.unshift({ url: api.apiURL(`/view?${q}`), isVideo: !["webp", "gif"].includes(info.format), ts: Date.now(), promptId: "", value: info.value, edited: true });
      history = history.slice(0, HISTORY_MAX);
      lsSet(LS_HISTORY, history);
      renderHistory();
      show(history[0]);
    },
  });
}

// ---------------------------------------------------------------- ことば(押すとプロンプトの最後に足す)
const WORDS = {
  edit: [["指示", ["Change the clothes to ", "Change the background to ", "Change the hair color to ", "Make the person smile",
    "Remove the ", "Add a ", "Relight with warm sunlight", "Turn into an anime-style illustration",
    "Blend the pasted object naturally into the scene"]],
  ["保つ", ["Keep the identity", "Keep the face unchanged", "Keep the pose", "Keep the background", "Keep pose and background",
    "Keep the composition", "Keep everything else unchanged"]],
  ["品質", ["High quality", "Natural lighting", "Realistic", "Sharp details"]]],
  qwen2: [["2 枚の画像", ["the person in the first image", "the clothes from the second image", "the object from the second image",
    "Print the second image on the clothes", "Dress the person in the first image in the clothes from the second image"]]],
  minimax2: [["2 枚の画像", ["<Picture 1>", "<Picture 2>", "the clothes from <Picture 2>", "the object from <Picture 2>"]]],
  tags: [["品質", ["masterpiece", "best quality", "very aesthetic", "absurdres"]],
    ["構図", ["upper body", "full body", "close-up", "from above", "from below", "looking at viewer"]],
    ["表情", ["smile", "open mouth", "closed eyes", "blush"]],
    ["背景", ["outdoors", "indoors", "simple background", "white background", "city", "night"]],
    ["光", ["backlighting", "soft lighting", "sunset", "cinematic lighting"]]],
  natural: [["種類", ["A photo of ", "An anime-style illustration of ", "A watercolor painting of ", "A 3D render of "]],
    ["写り", ["close-up portrait", "wide shot", "shallow depth of field", "35mm film look"]],
    ["光", ["soft natural light", "golden hour", "cinematic lighting", "studio lighting"]],
    ["品質", ["high detail", "sharp focus"]]],
  video: [["カメラ", ["the camera slowly pushes in", "the camera pulls back", "the camera pans left", "the camera orbits around the subject",
    "handheld camera", "static camera"]],
    ["動き", ["the person walks forward", "the person turns around", "the person smiles", "a gentle wind moves the hair",
      "slow motion", "smooth motion"]],
    ["雰囲気", ["natural light", "cinematic", "night", "rain"]]],
  // 第9版: FLUX.2 Klein(image 1〜4)/ FLUX.3 Klein(<ref_image_0>〜)/ LTX-2.5・Kandinsky 6(音・セリフ)
  flux2: [["参照画像(最大 4 枚。image 1 = 画像1)", ["image 1", "image 2", "image 3", "image 4", "the person in image 1",
    "the object from image 2", "the outfit from image 2", "the background from image 3", "Keep the subject's pose and framing unchanged"]]],
  flux3: [["参照画像(最大 10 枚。<ref_image_0> = 画像1)", ["<ref_image_0>", "<ref_image_1>", "<ref_image_2>", "<ref_image_3>",
    "In <ref_image_0>, ", "Create a photograph of ", "the person from <ref_image_0>", "the outfit from <ref_image_1>",
    "The person keeps their identity, face and hairstyle"]]],
  ltx: [["音・セリフ(LTX-2.5 は音も作ります)", ["Use the provided start image as the first frame.",
    "Use the provided end image as the final frame anchor.", 'The person says, "Hello."', "soft ambient sound",
    "footsteps", "wind blows", "rain falls", "gentle music plays", "No text, no subtitles"]]],
  k6: [["音・セリフ(Kandinsky 6)", ["\nAudio: ", "<S>Hello!<E>", "clear natural voice", "ambient sound of the place",
    "footsteps", "wind", "rain", "gentle music"]]],
  negTags: ["worst quality", "low quality", "bad hands", "extra fingers", "blurry", "watermark", "text"],
  negVideo: ["blurry", "static", "low quality", "jitter", "deformed", "subtitles"],
};
function wordGroups(n) {
  const mt = W(n, "model_type").value, task = W(n, "task").value;
  const info = CCA.SPEC.types_info[mt] || {};
  const tagsModel = info.loader === "ckpt" || info.base === "Anima";
  let groups = [];
  let neg = null;
  if (info.kind === "video") {
    groups = WORDS.video; neg = WORDS.negVideo;
    if (info.family === "LTX-2.5") groups = [...WORDS.ltx, ...groups];
    if (info.family === "Kandinsky 6") groups = [...WORDS.k6, ...groups];
  }
  else if (tagsModel) { groups = WORDS.tags; neg = WORDS.negTags; }
  else if (task === "I2I" && info.base !== "Krea2") {
    groups = [...WORDS.edit];
    if (info.base === "Qwen Image") groups = [...WORDS.qwen2, ...groups];
    if (info.base === "MiniMax-H3-Image") groups = [...WORDS.minimax2, ...groups];
    if (info.family === "FLUX.2 Klein") groups = [...WORDS.flux2, ...groups];
    if (info.family === "FLUX.3 Klein") groups = [...WORDS.flux3, ...groups];
  } else groups = WORDS.natural;
  if (!visibleSet(n).has("negative")) neg = null;
  return { groups, neg };
}
function renderWords(n) {
  const box = $("#cca-words-box");
  const { groups, neg } = wordGroups(n);
  const key = JSON.stringify([groups, neg]);
  if (box._ccaKey === key) return;
  box._ccaKey = key;
  box.innerHTML = groups.map(([title, words]) => `<h5>${esc(title)}</h5><div class="chips">${words.map((w) => `<button class="chip" data-word="${esc(w)}">${esc(w.trim())}</button>`).join("")}</div>`).join("")
    + (neg ? `<h5>ネガティブ(ネガティブプロンプトに入ります)</h5><div class="chips">${neg.map((w) => `<button class="chip neg" data-negword="${esc(w)}">${esc(w)}</button>`).join("")}</div>` : "");
  for (const b of box.querySelectorAll("[data-word], [data-negword]")) {
    b.onmousedown = (e) => e.preventDefault(); // プロンプト欄のカーソルを動かさない
    b.onclick = () => (b.dataset.word !== undefined ? insertWord("positive", b.dataset.word) : insertWord("negative", b.dataset.negword));
  }
}
async function addWord(field, word) {
  const n = node();
  if (!n) return;
  const cur = String(W(n, field)?.value || "").replace(/\s+$/, "");
  let sep = "";
  if (cur) {
    if (/[.!?]$/.test(cur)) sep = " ";
    else if (/,$/.test(cur)) sep = " ";
    else sep = /^[A-Z<]/.test(word) && !/^</.test(word) ? ". " : ", ";
    if (word.startsWith("\n")) sep = "";
  }
  await setW(field, cur + sep + word);
  const ta = root.querySelector(`textarea[data-w="${field}"]`);
  if (ta && word.endsWith(" ")) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

// ---- 出力サイズ(サイズ指定 / 倍率指定)と動画の長さ
const natural = new Map(); // 画像 → [幅, 高さ]
function naturalSize(value, cb) {
  if (!value || value === NONE) return null;
  if (natural.has(value)) return natural.get(value);
  natural.set(value, null);
  const im = new Image();
  im.onload = () => { natural.set(value, [im.naturalWidth, im.naturalHeight]); cb?.(); };
  im.onerror = () => natural.delete(value);
  im.src = imageUrl(value);
  return null;
}
function refreshSize(n, vis) {
  const mt = W(n, "model_type").value;
  const info = CCA.SPEC.types_info[mt] || {};
  const hasMode = vis.has("size_mode");
  $("#cca-sizebox").classList.toggle("tabs", hasMode);
  $("#cca-sizebox").classList.toggle("hide", !hasMode && !vis.has("width"));
  const scaleOn = hasMode && W(n, "size_mode")?.value === SIZE_SCALE;
  for (const b of $$("[data-size]")) b.classList.toggle("on", (W(n, "size_mode")?.value || "サイズ指定") === b.dataset.size);
  $("#cca-scale-box").classList.toggle("hide", !scaleOn);
  const hasResize = vis.has("resize_mode");
  const resizeOn = hasResize && !scaleOn && (W(n, "resize_mode")?.value || "画像1のサイズ") !== "画像1のサイズ";
  $("#cca-resize-box").classList.toggle("hide", !hasResize || scaleOn);
  root.querySelector('[data-group="size"]').classList.toggle("hide", !vis.has("width") || scaleOn || (hasResize && !resizeOn));
  root.querySelector('[data-field="auto_image_size"]')?.classList.toggle("hide", !vis.has("auto_image_size") || scaleOn);
  $("#cca-sec-size").classList.toggle("hide", $("#cca-sizebox").classList.contains("hide") && !!root.querySelector('[data-field="auto_image_size"]')?.classList.contains("hide"));
  const fixed = $("#cca-size-fixed");
  const showFixed = hasMode && !scaleOn && (!vis.has("width") || (hasResize && !resizeOn));
  fixed.classList.toggle("hide", !showFixed);
  if (showFixed) {
    fixed.textContent = (["MOSS", "Qwen Image"].includes(info.base) || ["FLUX.2 Klein", "FLUX.3 Klein"].includes(info.family))
      ? "画像1と同じ縦横比で、約 100 万画素の大きさで出力します。" : "画像1と同じ大きさで出力します。";
  }
  if (scaleOn) {
    const img = W(n, "image")?.value;
    const sz = naturalSize(img, () => refreshLight());
    const step = info.size_step || 16;
    const sc = Number(W(n, "size_scale")?.value) || 1;
    const res = $("#cca-scale-result");
    if (!img || img === NONE) res.textContent = "画像1を入れると、出力の大きさがここに出ます。";
    else if (!sz) res.textContent = "";
    else {
      const w = Math.max(step, Math.round((sz[0] * sc) / step) * step);
      const h = Math.max(step, Math.round((sz[1] * sc) / step) * step);
      res.textContent = `出力: ${w} × ${h}(画像1: ${sz[0]} × ${sz[1]} × ${sc})`;
    }
  }
  const vgrp = root.querySelector('[data-group="video"]');
  vgrp.classList.toggle("hide", !vis.has("video_length"));
  if (vis.has("video_length")) {
    const frames = Number(W(n, "video_length")?.value) || 0;
    const fps = vis.has("video_fps") ? Number(W(n, "video_fps")?.value) || 0 : 24;
    $("#cca-video-dur").textContent = fps ? `長さ 約 ${(frames / fps).toFixed(1)} 秒${vis.has("video_fps") ? "" : "(24fps 固定)"}` : "";
  }
}

// ---- 見つからないファイルの案内(ダウンロード先・入れるフォルダ)
const helpCache = new Map();
async function getHelp(kind, name) {
  const key = `${kind}|${name}`;
  if (!helpCache.has(key)) helpCache.set(key, fileHelp(kind, name).catch(() => null));
  return helpCache.get(key);
}
// opts(画像編集・動画編集から使うとき): {status: "missing" | "broken", label: 何のファイルか, why: 壊れている理由など,
//   hint: 最後の一言, open: 最初から開く, cls: 箱の class}。opts が無ければ生成パネルの「見つかりません」の箱
function renderHelp(el, kind, name, opts = {}) {
  const key = JSON.stringify([kind, name, opts.status || "", opts.label || "", opts.why || "", opts.hint || ""]);
  if (el._ccaKey === key) return;
  el._ccaKey = key;
  const head = opts.status === "broken" ? "⚠ 壊れています" : "⚠ 見つかりません";
  el.className = (opts.cls || "help") + (opts.status === "broken" ? " broken" : "");
  el.innerHTML = `<div>${esc(head)}</div>`;
  getHelp(kind, name).then((h) => {
    if (!h || el._ccaKey !== key) return;
    guideBox(el, { ...opts, head, name, label: opts.label, links: h.links, folderLabel: h.label, folders: h.folders || [] });
  });
}
// 案内の箱(配布ページ・探す・入れる場所(数・開く・パスをコピー)・最後の一言)。ファイル以外(フォントなど)にも使う
function guideBox(el, o) {
  const src = (o.links || []).filter((l) => l.kind === "source");
  const search = (o.links || []).filter((l) => l.kind === "search");
  const a = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`;
  const head = o.head || "⚠ 見つかりません";
  // 実体のパス(リンクの先)で、モデルファイルの多い順(サーバーが並べる)
  const summary = o.label
    ? `<span>${esc(head)}</span> ― <span>${esc(o.label)}</span>${o.name ? `: <span class="fn">${esc(o.name)}</span>` : ""}`
    : `<span>${esc(head)}</span> ― <span>入手先と入れる場所</span>`;
  el.innerHTML = `<details${o.open ? " open" : ""}><summary style="cursor:pointer">${summary}</summary>`
    + `<div style="display:flex;flex-direction:column;gap:4px;margin-top:6px">`
    + (o.name && !o.label ? `<div><b>${esc(o.name)}</b></div>` : "")  // 見出しに名前があるときは繰り返さない
    + (o.why ? `<div class="why">${esc(o.why)}</div>` : "")
    + (src.length ? `<div class="ln">配布ページ: ${src.map(a).join(" / ")}</div>` : "")
    + (search.length ? `<div class="ln">探す: ${search.map(a).join(" / ")}</div>` : "")
    + `<div>入れる場所(${esc(o.folderLabel || "")}):</div>`
    + (o.folders || []).map((f) => `<div class="ln"><span class="path">${esc(f.path)}</span>${f.count !== undefined ? `<span>${f.count} 個</span>` : ""}<button data-open="${esc(f.path)}">📂 開く</button><button data-copy="${esc(f.path)}">📋 パスをコピー</button></div>`).join("")
    + `<div class="hint">${esc(o.hint || "入れたら一番上の 🔄 を押してください。")}</div></div></details>`;
  for (const b of el.querySelectorAll("[data-open]")) b.onclick = () => openWithMessage(b, b.dataset.open);
  for (const b of el.querySelectorAll("[data-copy]")) b.onclick = () => copyPath(b, b.dataset.copy);
}

// ---- LoRA 一覧
function loraKey(list, files, loader) {
  return JSON.stringify([list, files, loader]);
}
function renderLoras(n, force = false) {
  const box = $("#cca-loras");
  if (!box) return;
  const list = parseLoras(W(n, "loras")?.value);
  const files = loraFiles(n);
  const loader = CCA.SPEC.types_info[W(n, "model_type").value]?.loader;
  const key = loraKey(list, files, loader);
  if (!force) {
    if (box._ccaKey === key) return;
    if (box.contains(document.activeElement)) return; // 入力中(他から更新されたとき)は作り直さない
  }
  box._ccaKey = key;
  box.style.setProperty("--lcols", ["auto", "minmax(0,1fr)", "84px", ...(loader === "ckpt" ? ["84px"] : []), ...(loader === "wan14" ? ["110px"] : []), "auto"].join(" "));
  const head = `<div class="lora hint"><span></span><span>ファイル</span><span>強度</span><span class="${loader === "ckpt" ? "" : "hide"}">CLIP 強度</span><span class="${loader === "wan14" ? "" : "hide"}">適用先</span><span></span></div>`;
  box.innerHTML = (list.length ? head : '<div class="hint" style="margin-bottom:6px">LoRA は使っていません</div>') + list.map((l, i) => {
    const missing = l.name !== NONE && !files.includes(l.name);
    const opts = [NONE, ...(missing ? [l.name] : []), ...files]
      .map((f) => `<option value="${esc(f)}" ${f === l.name ? "selected" : ""}>${esc(f)}${missing && f === l.name ? "(見つかりません)" : ""}</option>`).join("");
    return `<div class="lora" data-i="${i}">
      <input type="checkbox" data-k="on" ${l.on ? "checked" : ""} title="有効/無効">
      <select data-k="name" class="${missing ? "missing" : ""}">${opts}</select>
      <input type="number" data-k="strength" step="0.05" value="${l.strength}" title="強度">
      <input type="number" data-k="clip" step="0.05" value="${l.clip}" title="CLIP 強度" class="${loader === "ckpt" ? "" : "hide"}">
      <select data-k="target" class="${loader === "wan14" ? "" : "hide"}" title="Wan2.2 14B: どちらのモデルに掛けるか">
        <option value="both" ${l.target === "both" ? "selected" : ""}>High+Low</option>
        <option value="high" ${l.target === "high" ? "selected" : ""}>High のみ</option>
        <option value="low" ${l.target === "low" ? "selected" : ""}>Low のみ</option></select>
      <button class="icon" data-k="del" title="外す">×</button>
    </div>${missing ? `<div class="help" data-lhelp="${i}" style="margin-bottom:6px"></div>` : ""}`;
  }).join("");
  for (const row of box.querySelectorAll(".lora[data-i]")) {
    const i = Number(row.dataset.i);
    const commit = async (e) => {
      const next = parseLoras(W(n, "loras").value);
      if (!next[i]) return;
      const g = (k) => row.querySelector(`[data-k="${k}"]`);
      next[i] = { ...next[i], on: g("on").checked, name: g("name").value, strength: Number(g("strength").value) || 0,
        clip: Number(g("clip").value) || 0, target: g("target").value };
      // ファイルを選び直したときだけ作り直す(見つからない表示の更新)。強度・チェックは作り直さない
      const rebuild = e?.target?.dataset?.k === "name";
      if (!rebuild) box._ccaKey = loraKey(parseLoras(JSON.stringify(next)), files, loader);
      await setLoras(n, next);
      if (rebuild) renderLoras(n, true);
      refreshLight();
    };
    for (const el of row.querySelectorAll("input,select")) el.addEventListener("change", commit);
    row.querySelector('[data-k="del"]').onclick = async () => {
      const next = parseLoras(W(n, "loras").value);
      next.splice(i, 1);
      await setLoras(n, next);
      renderLoras(n, true);
      refreshLight();
    };
  }
  for (const el of box.querySelectorAll("[data-lhelp]")) renderHelp(el, "loras", list[Number(el.dataset.lhelp)].name);
}

// ---- マスク済み画像のプレビュー(元画像に赤でマスクを重ねる)
const maskPreviews = new Map();
function maskPreview(n, value) {
  if (maskPreviews.has(value)) return maskPreviews.get(value);
  maskPreviews.set(value, "");
  const source = n.properties?.cca_mask_sources?.[value] || value;
  Promise.all([loadImg(imageUrl(source)), loadImg(imageUrl(value))]).then(([base, masked]) => {
    const scale = Math.min(1, 512 / Math.max(base.naturalWidth, base.naturalHeight));
    const w = Math.max(1, Math.round(base.naturalWidth * scale)), h = Math.max(1, Math.round(base.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const m = document.createElement("canvas");
    m.width = w; m.height = h;
    const mctx = m.getContext("2d");
    mctx.drawImage(masked, 0, 0, w, h);
    const d = mctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const a = 255 - d.data[i + 3];
      d.data[i] = 255; d.data[i + 1] = 40; d.data[i + 2] = 90; d.data[i + 3] = Math.round(a * 0.6);
    }
    mctx.putImageData(d, 0, 0);
    ctx.drawImage(base, 0, 0, w, h);
    ctx.drawImage(m, 0, 0);
    maskPreviews.set(value, c.toDataURL("image/png"));
    refreshLight();
  }).catch(() => maskPreviews.delete(value));
  return "";
}

// フォルダを開く(実体のパス)。結果はボタンのすぐ下と画面上部に出す
async function openWithMessage(btn, path, keep = false) {
  try {
    const r = await openFolder(path, keep);
    notify(`エクスプローラーで開くよう指示しました: ${r.path || path}\n画面に出ないときは、タスクバーのエクスプローラーを確認するか、「📋 パスをコピー」でコピーしてエクスプローラーのアドレス欄に貼り付けてください。`, "info", btn, { toast: false });
  } catch (e) {
    notify(`フォルダを開けませんでした: ${e.message}`, "error", btn);
  }
}

// パスをコピー(http の LAN 接続などでクリップボードが使えないときは、選択して Ctrl+C の方法に切り替える)
async function copyPath(btn, path) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(path);
    else {
      const ta = document.createElement("textarea");
      ta.value = path;
      ta.style.cssText = "position:fixed;left:-1000px;top:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("コピーできませんでした");
    }
    notify(`コピーしました: ${path}`, "info", btn, { toast: false });
  } catch (e) {
    notify(`コピーできませんでした。次のパスを選んでコピーしてください: ${path}`, "error", btn, { toast: false });
  }
}

// StabilityMatrix: まだ読み込まれていないモデルフォルダがあるときだけ出す
function renderSm(sm) {
  const roots = (sm?.roots || []).filter((r) => r.exists && !r.unused_default && (r.missing_detail || []).length);
  if (!roots.length) return "";
  const seen = new Set();
  const rows = [];
  for (const r of roots) {
    for (const d of r.missing_detail) {
      if (seen.has(d.path)) continue;
      seen.add(d.path);
      rows.push(`<div class="p"><code>${esc(d.path)}</code><span class="cnt">${esc(d.label)}・${d.count} 個</span></div>`);
    }
  }
  return `<div class="k sm"><b>StabilityMatrix のモデルフォルダのうち、まだ読み込まれていないものがあります。</b>
    ${rows.join("")}<div style="margin-top:8px"><button class="pri" data-addsm-all>まとめて読み込む</button></div></div>`;
}

// ---- モデルフォルダ
function openDirs() {
  let m = document.getElementById("cca-dirs");
  if (!m) {
    m = document.createElement("div");
    m.id = "cca-dirs";
    m.innerHTML = `<div class="box">
      <div class="hd"><h3>モデルフォルダ</h3><span style="flex:1"></span><button id="cca-dirs-close">閉じる</button></div>
      <div class="lead">ComfyUI がモデルを読み込んでいるフォルダです。${ib("dirs")}</div>
      ${ibox("dirs", "新しいモデルファイルは、種類に合ったフォルダに入れてから、パネルの 🔄 を押してください。📂 開く で、そのフォルダをエクスプローラーで開きます。")}
      <div id="cca-dirs-sm"></div>
      <div id="cca-dirs-list" style="display:flex;flex-direction:column;gap:8px"></div>
      <details class="add"><summary>フォルダを追加する</summary>
        <div class="row"><select id="cca-dirs-kind"></select><input id="cca-dirs-path" placeholder="フォルダのパス(例: D:\\AI\\models\\loras)">
        <button id="cca-dirs-browse" title="フォルダを選ぶ画面を開きます(ComfyUI を動かしているパソコンで開きます)">📁 参照</button><button class="pri" id="cca-dirs-add">追加</button></div></details></div>`;
    document.body.appendChild(m);
    bindInfo(m);
    m.addEventListener("keydown", (e) => e.stopPropagation());
    m.querySelector("#cca-dirs-close").onclick = () => m.classList.remove("open");
    let downOutside = false; // 外(暗い所)をクリックしたら閉じる。中から外へドラッグして離したときは閉じない
    m.addEventListener("mousedown", (e) => { downOutside = e.target === m; });
    m.addEventListener("click", (e) => { if (e.target === m && downOutside) m.classList.remove("open"); });
    m.querySelector("#cca-dirs-browse").onclick = async (e) => {
      const inp = m.querySelector("#cca-dirs-path");
      e.target.disabled = true;
      try { const r = await pickFolder(inp.value, T("追加するフォルダを選んでください")); if (r.path) inp.value = r.path; }
      catch (err) { notify(`フォルダを選べませんでした: ${err.message}`, "error", e.target); }
      finally { e.target.disabled = false; }
    };
    m.querySelector("#cca-dirs-add").onclick = async (e) => {
      const kind = m.querySelector("#cca-dirs-kind").value;
      const path = m.querySelector("#cca-dirs-path").value;
      try {
        const r = await modelDirs("add", kind, path);
        m.querySelector("#cca-dirs-path").value = "";
        await afterDirsChange(m);
        notify(`追加しました: ${r.path || path}`, "info", e.target, { toast: false });
      } catch (err) { notify(`追加できませんでした: ${err.message}`, "error", e.target); }
    };
  }
  m.classList.add("open");
  renderDirs(m);
}
async function afterDirsChange(m) {
  mediaCache = null; // 動画の選択肢も読み直す
  await renderDirs(m);
  try { await refreshChoices(); helpCache.clear(); refresh(); } catch (e) { console.warn(e); }
}
async function renderDirs(m) {
  const data = await modelDirs();
  const info = data.kinds || data;
  const kindSel = m.querySelector("#cca-dirs-kind");
  if (!kindSel.options.length) kindSel.innerHTML = Object.entries(info).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
  const sm = data.stability_matrix;
  const smBox = m.querySelector("#cca-dirs-sm");
  smBox.innerHTML = renderSm(sm);
  const addAll = smBox.querySelector("[data-addsm-all]");
  if (addAll) {
    addAll.onclick = async () => {
      try {
        for (const r of sm.roots.filter((x) => x.exists && !x.unused_default && (x.missing_detail || []).length)) {
          await modelDirs("add_sm", "", r.root);
        }
        await afterDirsChange(m);
        notify("StabilityMatrix のモデルフォルダを読み込みました", "info");
      } catch (e) { notify(`読み込めませんでした: ${e.message}`, "error", addAll); }
    };
  }
  const list = m.querySelector("#cca-dirs-list");
  list.innerHTML = Object.entries(info).filter(([k, v]) => k !== "model_patches" || v.paths.length).map(([k, v]) => `
    <div class="k"><div class="kh"><b>${esc(v.label)}</b>${v.help ? ib(`k_${k}`) : ""}</div>${v.help ? ibox(`k_${k}`, esc(v.help)) : ""}
    ${v.paths.length ? v.paths.map((p, i) => `<div class="p"><code>${esc(p.path)}</code>
      <span class="cnt">${p.count === undefined ? "" : p.more ? `${p.count} 個以上` : `${p.count} 個`}</span>
      <button data-open="${k}|${i}">📂 開く</button><button data-copy="${esc(p.path)}">📋 パスをコピー</button>${p.custom ? `<button data-del="${k}|${i}">外す</button>` : ""}</div>${dirSub(p)}`).join("")
    : '<div class="p"><span class="tag">フォルダがありません</span></div>'}</div>`).join("");
  for (const b of list.querySelectorAll("[data-open]")) {
    const [k, i] = b.dataset.open.split("|");
    b.onclick = () => openWithMessage(b, info[k].paths[Number(i)].path);
  }
  for (const b of list.querySelectorAll("[data-copy]")) b.onclick = () => copyPath(b, b.dataset.copy);
  for (const b of list.querySelectorAll("[data-del]")) {
    const [k, i] = b.dataset.del.split("|");
    b.onclick = async () => {
      const p = info[k].paths[Number(i)];
      try { await modelDirs("remove", k, p.registered || p.path); await afterDirsChange(m); }
      catch (e) { notify(`外せませんでした: ${e.message}`, "error", b); }
    };
  }
}

// ---- 画像・動画を読み込む場所(設定の中。モデルフォルダとは別)
let mediaBox = null;
function mediaDirsPanel() {
  if (mediaBox) return mediaBox;
  const m = mediaBox = document.createElement("div");
  m.id = "cca-mediadirs";
  m.innerHTML = `<style>#cca-mediadirs,#cca-mediadirs [data-list]{display:contents}#cca-mediadirs h4{margin:12px 0 4px}#cca-mediadirs .p{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0}
#cca-mediadirs label.ck{display:flex !important;flex-direction:row;justify-content:flex-start;align-items:center;gap:8px;margin:4px 0;width:auto;text-align:left}#cca-mediadirs label.ck input{width:auto !important;flex:0 0 auto;margin:0}#cca-mediadirs code{word-break:break-all}#cca-mediadirs .cnt{color:#959eab;font-size:12px}
#cca-mediadirs input:not([type=checkbox]){flex:1 1 12em;min-width:10em;background:#12151a;color:#e4e7eb;border:1px solid #303744;border-radius:6px;padding:4px 8px}
#cca-mediadirs select{flex:0 0 auto;min-width:11em;max-width:100%;background:#12151a;color:#e4e7eb;border:1px solid #303744;border-radius:6px;padding:4px 8px}</style>
    <div class="sec"><label class="ck"><input type="checkbox" data-opt="history_top"> ${esc(T("生成履歴(ギャラリー)のファイルを一番上に足す"))}</label>
      <label class="ck"><input type="checkbox" data-opt="recursive"> ${esc(T("サブフォルダを検索対象に入れる"))}</label>
      <div class="note">${esc(T("サブフォルダを含めた場合などで大量のファイルを並べると重くなる可能性があります。"))}</div></div>
    <div data-list></div>
    <details class="sec"><summary>${esc(T("フォルダを追加する"))}</summary><div class="row" style="margin-top:6px"><select data-kind></select>
      <input data-path placeholder="${esc(T("フォルダのパス(例: D:\\AI\\images)"))}"><button data-browse title="${esc(T("フォルダを選ぶ画面を開きます(ComfyUI を動かしているパソコンで開きます)"))}">📁 ${esc(T("参照"))}</button>
      <button class="pri" data-add>${esc(T("追加"))}</button></div></details>`;
  m.addEventListener("keydown", (e) => e.stopPropagation());
  const after = async () => { // 画像・動画の選択肢も読み直す
    mediaCache = null;
    await m._render();
    try { await refreshChoices(); helpCache.clear(); refresh(); } catch (e) { console.warn(e); }
  };
  m._render = async () => {
    const md = await mediaDirs();
    histTopOpt = !!(md.options || {}).history_top;
    const info = md.kinds || {};
    for (const c of m.querySelectorAll("[data-opt]")) {
      c.checked = !!(md.options || {})[c.dataset.opt];
      c.onchange = async () => { try { await mediaDirs("option", c.dataset.opt, c.checked); await after(); } catch (e) { notify(e.message, "error", c); } };
    }
    const sel = m.querySelector("[data-kind]");
    if (!sel.options.length) sel.innerHTML = Object.entries(info).map(([k, v]) => `<option value="${k}">${esc(T(v.label))}</option>`).join("");
    const list = m.querySelector("[data-list]");
    list.innerHTML = Object.entries(info).map(([k, v]) => `<div class="sec"><h4>${esc(T(v.label))} <span title="${esc(T(v.help))}">ⓘ</span></h4><div class="note" style="margin:0 0 4px">${esc(T(v.help))}</div>`
      + v.paths.map((p, i) => `<div class="p"><code>${esc(p.path)}</code><span class="cnt">${p.count} ${esc(T("個"))}</span>
        <button data-open="${k}|${i}">📂 ${esc(T("開く"))}</button><button data-copy="${esc(p.path)}">📋 ${esc(T("パスをコピー"))}</button>${p.custom ? `<button data-del="${k}|${i}">${esc(T("外す"))}</button>` : ""}</div>${dirSub(p)}`).join("") + "</div>").join("");
    for (const b of list.querySelectorAll("[data-open]")) { const [k, i] = b.dataset.open.split("|"); b.onclick = () => openWithMessage(b, info[k].paths[Number(i)].path, true); }
    for (const b of list.querySelectorAll("[data-copy]")) b.onclick = () => copyPath(b, b.dataset.copy);
    for (const b of list.querySelectorAll("[data-del]")) {
      const [k, i] = b.dataset.del.split("|");
      b.onclick = async () => {
        try { await mediaDirs("remove", k, info[k].paths[Number(i)].registered || info[k].paths[Number(i)].path); await after(); }
        catch (e) { notify(`外せませんでした: ${e.message}`, "error", b); }
      };
    }
  };
  m.querySelector("[data-browse]").onclick = async (e) => {
    const inp = m.querySelector("[data-path]");
    e.target.disabled = true;
    try { const r = await pickFolder(inp.value, T("追加するフォルダを選んでください")); if (r.path) inp.value = r.path; }
    catch (err) { notify(`フォルダを選べませんでした: ${err.message}`, "error", e.target); }
    finally { e.target.disabled = false; }
  };
  m.querySelector("[data-add]").onclick = async (e) => {
    const inp = m.querySelector("[data-path]");
    try {
      const r = await mediaDirs("add", m.querySelector("[data-kind]").value, inp.value);
      inp.value = "";
      await after();
      notify(`追加しました: ${r.path}`, "info", e.target, { toast: false });
    } catch (err) { notify(`追加できませんでした: ${err.message}`, "error", e.target); }
  };
  return m;
}

// 表示項目・選択肢も含めて全部更新
function refresh() {
  if (!root) return;
  const n = node();
  $("#cca-body").classList.toggle("hide", !n);
  $("#cca-nopanel").classList.toggle("hide", !!n);
  if (!n || !CCA.SPEC) return;
  { const rw = W(n, "resize_mode"); if (rw && rw.value === "今まで通り") rw.value = "画像1のサイズ"; } // 以前の保存・設定の値を新しい名前にする
  const vis = visibleSet(n);
  const key = currentKey(n);
  syncAdv(n);
  fillModelTypes(n);
  fillTasks(n);
  // 第42版: 声・音楽の種別は、欄の名前を種別・タスクに合わせる(LatentSync の「リップシンクの強さ」など)
  const lt = CCA.SPEC.types_info[W(n, "model_type").value]?.labels || {}, ltask = W(n, "task").value;
  for (const el of $$("[data-label]")) el.textContent = lt[ltask]?.[el.dataset.label] ?? lt["*"]?.[el.dataset.label] ?? (CCA.SPEC.labels[el.dataset.label] || el.dataset.label);
  for (const el of $$(".f[data-field], .slot[data-field], .card[data-field]")) {
    const name = el.dataset.field;
    if (name === "size_preset") { el.classList.toggle("hide", !vis.has("width")); continue; }
    if (name === "seed_mode") continue;
    el.classList.toggle("hide", !vis.has(name));
  }
  $("#cca-swap").classList.toggle("hide", !vis.has("width"));
  $("#cca-sec-models2").classList.toggle("hide", ![...$("#cca-sec-models2").querySelectorAll(".f[data-field]")].some((f) => !f.classList.contains("hide")));
  $("#cca-sec-images").classList.toggle("hide", !vis.has("image"));
  $("#cca-turbo").classList.toggle("hide", !vis.has("turbo_lora_name"));
  $("#cca-turbo-badge").classList.toggle("hide", !CCA.SPEC.types_info[W(n, "model_type").value]?.is_turbo);
  const roles = CCA.SPEC.image_roles[key] || ["", ""];
  const names = CCA.SPEC.image_names?.[key] || ["入力画像1", "入力画像2"];
  const disp = (nm, k) => (nm.startsWith("入力画像") ? nm : `画像${k}(${nm})`);
  IMG_KEYS.forEach((k, i) => {
    root.querySelector(`[data-iname="${k}"]`).textContent = disp(names[i] || `入力画像${i + 1}`, i + 1);
    root.querySelector(`[data-role="${k}"]`).textContent = roles[i] ? ` ${roles[i]}` : (i === 0 ? "" : "(任意)");
  });
  const tinfo = CCA.SPEC.types_info[W(n, "model_type").value] || {};
  const nodeWarn = tinfo.missing_node || "";
  $("#cca-node-warn").classList.toggle("hide", !nodeWarn);
  $("#cca-node-warn-text").textContent = nodeWarn ? `⚠ ${nodeWarn}` : "";
  refreshAudio(n, tinfo);
  refreshLayout(n, vis);
  const named = vis.has("image") && !names[0].startsWith("入力画像") && !names[0].includes("フレーム");
  $("#cca-prompt-ib").classList.toggle("hide", !named);
  const pbox = root.querySelector('[data-ibox="prompt"]');
  if (!named) pbox.classList.add("hide");
  else {
    const count = IMG_KEYS.filter((k) => vis.has(k)).length;
    const ex = names[0].startsWith("<ref_image") ? "例: Create a photograph of the person from <ref_image_0> holding the object from <ref_image_1>."
      : names[0].startsWith("<") ? "例: Edit <Picture 1>: the person is holding the object from <Picture 2>."
      : names[0].startsWith("image") ? "例: Let the person in image 1 hold the object from image 2."
      : "例: Make the person in Picture 1 hold the object from Picture 2.";
    pbox.textContent = count > 2
      ? `プロンプトでは画像1を「${names[0]}」、画像2を「${names[1]}」…画像${count}を「${names[count - 1]}」と書きます。${ex}`
      : vis.has("image_2")
      ? `プロンプトでは画像1を「${names[0]}」、画像2を「${names[1]}」と書きます。${ex}`
      : `プロンプトでは画像1を「${names[0]}」と書きます。`;
  }
  $("#cca-sec-hires").classList.toggle("hide", !vis.has("hires_enable"));
  $("#cca-sec-neg").classList.toggle("hide", !vis.has("negw_enable"));
  $("#cca-sec-reg").classList.toggle("hide", !vis.has("regional_enable"));
  // モデル・LoRA の ⓘ: この種別・タスクの標準的なファイル名
  const std = CCA.SPEC.standard_files?.[key] || {};
  for (const k of MODEL_INFO_KEYS) {
    const rows = std[k] || [];
    root.querySelector(`[data-ibwrap="${k}"]`)?.classList.toggle("hide", !rows.length);
    const box = root.querySelector(`[data-ibox="${k}"]`);
    if (!box) continue;
    if (!rows.length) box.classList.add("hide");
    const lkey = JSON.stringify([key, k, rows]);
    if (box._ccaStd === lkey) continue;
    box._ccaStd = lkey;
    box._ccaLoaded = false;
    box.innerHTML = `よく使われるファイル:<br>${rows.map(([name, note]) => `・<b>${esc(name)}</b>${note ? `(${esc(note)})` : ""}`).join("<br>")}<div data-where></div>`;
    // 入手先と入れる場所(「⚠ 見つかりません」の案内と同じ内容)。ⓘ を開いたときに読む
    box._ccaLoad = async () => {
      if (box._ccaLoaded) return;
      box._ccaLoaded = true;
      const kind = CCA.SPEC.list_kind[(CCA.SPEC.list_keys || CCA.SPEC.file_keys)[k]];
      if (!kind) return;
      const helps = (await Promise.all(rows.map(([name]) => getHelp(kind, name)))).filter(Boolean);
      if (box._ccaStd !== lkey || !helps.length) return;
      const a = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`;
      const seen = new Set();
      const src = helps.flatMap((h) => h.links.filter((l) => l.kind === "source")).filter((l) => !seen.has(l.url) && seen.add(l.url));
      const search = helps[0].links.filter((l) => l.kind === "search");
      const folders = helps[0].folders || [];
      const where = box.querySelector("[data-where]");
      where.innerHTML = `<div style="margin-top:6px">入手先: ${src.length ? src.map(a).join(" / ") : "(下の検索から探してください)"}</div>`
        + `<div>探す: ${search.map(a).join(" / ")}</div>`
        + `<div>入れる場所(${esc(helps[0].label)}):</div>`
        + folders.map((f) => `<div class="row" style="gap:6px"><code style="word-break:break-all">${esc(f.path)}</code>${f.count !== undefined ? `<span>${f.count} 個</span>` : ""}<button data-open="${esc(f.path)}">📂 開く</button><button data-copy="${esc(f.path)}">📋 パスをコピー</button></div>`).join("")
        + `<div>入れたら一番上の 🔄 を押してください。</div>`;
      for (const b of where.querySelectorAll("[data-open]")) b.onclick = () => openWithMessage(b, b.dataset.open);
      for (const b of where.querySelectorAll("[data-copy]")) b.onclick = () => copyPath(b, b.dataset.copy);
    };
    if (!box.classList.contains("hide")) box._ccaLoad();
  }
  renderWords(n);
  refreshTile();
  $("#cca-caption-row").classList.toggle("hide", !vis.has("image"));
  $("#cca-comp-open").closest(".row").classList.toggle("hide", !vis.has("image"));
  {
    const mt = String(W(n, "model_type").value || ""), na = $("#cca-noalpha");
    na.textContent = T(/^(Qwen|FLUX\.3)/i.test(mt) ? "⚠透過画像で上手くいかない場合、「画像を合成」から背景を塗りつぶして試してください。" : "⚠透過画像は使えないモデルがあります。下の「画像を合成」から背景を塗りつぶして試してください。");
    na.classList.toggle("hide", !vis.has("image") || ALPHA_OK.has(mt)); // 透過 PNG の注意書き(常時表示)
  }
  root.querySelector("[data-mask]")?.classList.toggle("hide", !CCA.SPEC.mask[key]);
  const sizes = CCA.SPEC.size_presets.map(([w, h]) => `<option value="${w}x${h}">${w} × ${h}</option>`).join("");
  $("#cca-size").innerHTML = `<option value="">選ぶ…</option>${sizes}`;
  fillPresets($("#cca-preset").value);
  refreshLight();
  refreshAudioGen(n, vis, tinfo);
}

function previewPrefix(p) {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const fmt = (f) => f.replace(/yyyy|yy|MM|M|dd|d|hh|h|mm|m|ss|s/g, (t) => ({
    yyyy: d.getFullYear(), yy: pad(d.getFullYear() % 100), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1,
    dd: pad(d.getDate()), d: d.getDate(), hh: pad(d.getHours()), h: d.getHours(), mm: pad(d.getMinutes()),
    m: d.getMinutes(), ss: pad(d.getSeconds()), s: d.getSeconds(),
  }[t]));
  return p ? `→ output/${String(p).replace(/%date:([^%]+)%/g, (_, f) => fmt(f))}_00001_` : "";
}

// ---------------------------------------------------------------- generate / progress
function setStatus(t) { if (root) $("#cca-status").textContent = t; }
function showError(msg) {
  const el = $("#cca-err");
  el.replaceChildren();
  if (msg) { // × で閉じる
    const x = document.createElement("button");
    x.className = "errx"; x.textContent = "×"; x.title = T("閉じる"); x.onclick = () => showError("");
    el.append(x, document.createTextNode(msg));
  }
  el.classList.toggle("hide", !msg);
  if (msg) notify(msg, "error");
}
// お知らせ: 画面上部(固定表示)と、押したボタンのすぐ下。エラーは × で閉じるまで残る、それ以外は 5 秒で消える
// opt: { toast: false(上に出さない), sticky: true(× を押すまで消さない), file: { filename, subfolder, type }(📂 フォルダを開く を付ける) }
// お知らせの本文: URL はリンクに、フォルダのパスの行には「開く・パスをコピー」を付ける(文字は選べる)
function fillToast(span, msg) {
  const urlRe = /https?:\/\/[^\s<>"'）)」。、]+/g;
  const pathRe = /^\s+((?:[A-Za-z]:[\\/]|\/)\S.*?)(?:\s+\((.+)\))?\s*$/;
  for (const line of String(msg).split("\n")) {
    const d = document.createElement("div");
    const pm = pathRe.exec(line);
    if (pm) {
      d.className = "tp";
      const path = pm[1], sp = document.createElement("span");
      sp.textContent = `  ${path}${pm[2] ? `  (${pm[2]})` : ""}`;
      const ob = document.createElement("button"), cb = document.createElement("button");
      ob.className = cb.className = "tb"; ob.type = cb.type = "button";
      ob.textContent = T("📂 開く"); cb.textContent = T("📋 パスをコピー");
      const flash = (b, t) => { const o = b.dataset.o || b.textContent; b.dataset.o = o; b.textContent = t; setTimeout(() => { b.textContent = o; }, 1500); };
      ob.onclick = async () => {
        try {
          const r = await api.fetchApi("/cca_generator/open_folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
          flash(ob, T("✓ 開くよう指示しました"));
        } catch (e) { flash(ob, `${T("フォルダを開けませんでした")}: ${e.message}`); }
      };
      cb.onclick = async () => { try { await navigator.clipboard.writeText(path); flash(cb, T("コピーしました")); } catch { flash(cb, path); } };
      d.append(sp, ob, cb);
    } else {
      if (!line.trim()) d.style.height = "0.6em";
      let last = 0, m;
      urlRe.lastIndex = 0;
      while ((m = urlRe.exec(line))) {
        if (m.index > last) d.append(line.slice(last, m.index));
        const a = document.createElement("a");
        a.href = m[0]; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = m[0];
        d.append(a); last = m.index + m[0].length;
      }
      if (last < line.length) d.append(line.slice(last));
    }
    span.append(d);
  }
}
function notify(msg, kind = "error", anchor = null, opt = {}) {
  if (opt.toast !== false) {
    let box = document.getElementById("cca-toast");
    if (!box) { box = document.createElement("div"); box.id = "cca-toast"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = `t ${kind}`;
    t.innerHTML = `<span></span>${opt.file ? `<button class="tf" data-tf title="保存したファイルを選んだ状態で、フォルダを開きます">📂 フォルダを開く</button>` : ""}<button data-tx title="閉じる">×</button>`;
    fillToast(t.querySelector("span"), msg);
    t.querySelector("[data-tx]").onclick = () => t.remove();
    if (opt.file) t.querySelector("[data-tf]").onclick = (e) => openFileFolder(opt.file, e.currentTarget, t);
    box.appendChild(t);
    // 消さない知らせは残し、ほかの古い知らせから消す
    for (const x of [...box.children]) { if (box.children.length <= 4) break; if (x !== t && !x.dataset.sticky) x.remove(); }
    while (box.children.length > 6) box.firstChild.remove();
    if (opt.sticky) t.dataset.sticky = "1";
    else if (kind !== "error") setTimeout(() => t.remove(), 5000);
  }
  if (anchor && !anchor.closest("#cca-imged .hd, #cca-vedit .hd, #cca-comp .hd")) {
    const row = anchor.closest(".ln, .p, .row, .f") || anchor.parentElement;
    if (!row) return;
    row.parentElement.querySelectorAll(`:scope > .inl-msg[data-for="${row.dataset.msgId || ""}"]`).forEach((x) => x.remove());
    row.dataset.msgId = row.dataset.msgId || String(Math.random()).slice(2);
    const d = document.createElement("div");
    d.className = `inl-msg ${kind}`;
    d.dataset.for = row.dataset.msgId;
    // × は CSS で描く(お知らせの文字だけが textContent に入るように)
    d.innerHTML = '<span></span><button type="button" class="inl-x" title="閉じる" aria-label="閉じる"></button>';
    d.querySelector("span").textContent = msg;
    d.querySelector(".inl-x").onclick = () => d.remove();
    row.after(d);
    if (kind !== "error") setTimeout(() => d.remove(), 5000);
  }
}
async function generate() {
  const n = node();
  if (!n) return;
  showError("");
  const batch = Math.max(1, Math.min(100, Number($("#cca-batch").value) || 1));
  // 登録の無いワイルドカード(__名前__)は置き換わらずにそのまま送られる
  const unk = [...new Set([...unknownWildcards(W(n, "positive")?.value), ...unknownWildcards(W(n, "negative")?.value)])];
  if (unk.length) notify(`登録の無いワイルドカードは、そのまま送ります: ${unk.join(" ")}`, "info", $("#cca-go"));
  $("#cca-go").disabled = true;
  try {
    if (audioKind(n)) await generateAudio(n, batch); // 第42版: 声・音楽
    else if (tileActive()) {
      const combine = tileCombine();
      const k = await tileGenerate();
      if (k) setStatus(combine ? `キューに ${k} 件追加しました(全部できたらタイルにまとめます)` : `キューに ${k} 件追加しました`);
    } else {
      await app.queuePrompt(0, batch);
      setStatus(batch > 1 ? `キューに ${batch} 件追加しました` : "キューに追加しました");
    }
  } catch (e) {
    showError(`キューに追加できませんでした: ${e.message || e}`);
  } finally {
    $("#cca-go").disabled = false;
    setTimeout(refreshLight, 300); // 生成後のシード更新を反映
  }
}
let executingId = "";
// ---------------------------------------------------------------- 第42版: 声・音楽(Qwen3-TTS・LatentSync 1.6・HeartMuLa・ACE-Step 1.5)
// 画像・動画のワークフローは使わず、サーバー(audiogen.py)が作る小さな処理を runMini で送る。設定は audio_opts(JSON。種別ごとに覚える)
const audioKind = (n) => CCA.SPEC.types_info?.[W(n, "model_type")?.value]?.kind === "audio";
let audioJob = null;
const objCache = new Map();
// 追加ノードの選べる値(声・言語・保存した声・話し方のひな形・モデル)は、入っているノードから読む
function objInfo(name, fresh = false) {
  const hit = objCache.get(name);
  if (hit && !fresh && Date.now() - hit.t < 15000) return hit.p;
  const p = api.fetchApi(`/object_info/${encodeURIComponent(name)}`).then((r) => r.json()).then((j) => j?.[name] || null).catch(() => null);
  objCache.set(name, { p, t: Date.now() });
  return p;
}
function objChoices(info, key) {
  const d = info?.input?.required?.[key] || info?.input?.optional?.[key];
  if (Array.isArray(d?.[0])) return d[0];
  if (d?.[0] === "COMBO" && Array.isArray(d?.[1]?.options)) return d[1].options;
  return null;
}
let mediaCache = null;
function mediaList(fresh = false) {
  if (!mediaCache || fresh) {
    mediaCache = api.fetchApi("/cca_generator/videoedit/media", { cache: "no-store" }).then((r) => r.json())
      .then((j) => ({ videos: j.videos || [], audios: j.audios || [] })).catch(() => ({ videos: [], audios: [] }));
  }
  return mediaCache;
}
function audioOpts(n) {
  let o = {};
  try { o = JSON.parse(W(n, "audio_opts")?.value || "{}") || {}; } catch { o = {}; }
  return { ...(CCA.SPEC.audio?.defaults?.[W(n, "model_type").value] || {}), ...o };
}
async function setAO(k, v) {
  const n = node();
  if (!n) return;
  const o = audioOpts(n);
  o[k] = v;
  const json = JSON.stringify(o);
  $("#cca-audio-opts")._json = json; // 自分で変えた値(打っている欄は作り直さない)
  await setW("audio_opts", json);
}
const audioName = (e) => String(e?.value || "").split(" [")[0].split("/").pop();
const LEN_MODES = { normal: "声の長さで動画を切る(動画が短いときは声を切る)", pingpong: "動画を行き来させて、声の長さまでのばす",
  loop_to_audio: "動画をくり返して、声の長さまでのばす" };
const FMT_LABEL = { mp3: "MP3", flac: "FLAC(音が劣化しない)", opus: "Opus(小さい)" };
const AUDIO_NOTES = {
  TTS: "プリセットの声でテキストを読み上げます。「話し方の指示」に英語などで書くと話し方が変わります(空なら指示なし)。ひな形を選ぶこともできます(指示を書いたときは、書いた指示を使います)。言語は「Auto」なら文から決めます。モデルは初めて使うときに自動でダウンロードされます。",
  TTD: "「声の説明」に書いたとおりの声で読み上げます(1.7B のモデルだけ)。年齢・性別・声の高さ・話す速さなどを書きます。",
  TTC: "「参照音声」に数秒〜10 秒くらいの声を入れ、その声で読み上げるテキストを書きます。参照音声で話している内容(参照音声の文字起こし)を入れると、よく似ます(「📝 書き起こす」で文にできます)。名前を付けて保存すると、次から「保存した声を使う」で選べます。",
  LIP: "リップシンク: 動画の人物の口の動きを、選んだ音声に合わせて作り直します。顔がはっきり写っている動画を使います。動画は 25fps に並べ直して作り、25fps の MP4 で「動画の保存先」に保存します。モデルは初めて使うときに自動でダウンロードされます。",
  heartmula: "「スタイル」にジャンル・声・雰囲気・楽器をカンマで区切って書き、「歌詞」を [Verse] [Chorus] などで区切って書きます。長さは上限で、歌詞が終われば短くなります。モデルは初めて使うときに自動でダウンロードされます(models/heartmula)。",
  rvc: "RVC で、音声の声を学習済みの声(models/rvc の .pth)に変えます(ボイスチェンジ)。声の高さは半音で上下できます(男性 → 女性は +12 くらい)。同じ名前の .index があれば自動で使います(faiss が入っているとき)。HuBERT と RMVPE は初めて使うときに自動でダウンロードされます(約 370MB)。",
  ace: "「曲の説明」に曲の雰囲気・ジャンル・楽器・声などを書き、「歌詞」を [Verse] [Chorus] などで区切って書きます。歌なしにするときは「歌なし」にチェックします。手順と値は ComfyUI の公式テンプレート「Text to Audio (ACE-Step 1.5)」と同じです(Turbo: 8 ステップ・CFG 1)。",
};
// RVC の欄(RVC の種別と、Qwen3-TTS の「RVC で声を変える」で共通)
const RVC_INDEX_LAB = { "(none)": "使わない" };
const rvcFields = () => [
  { k: "rvc_model", t: "select", label: "RVC の声のモデル(models/rvc)", dyn: "rvc_model", none: "(選んでください)" },
  { k: "rvc_index", t: "select", label: "検索用の .index", dyn: "rvc_index", none: "自動(同じ名前の .index)", lab: RVC_INDEX_LAB },
  { k: "rvc_pitch", t: "num", label: "声の高さ(半音)", min: -24, max: 24, step: 1 },
  { k: "rvc_index_rate", t: "num", label: ".index の効き(0〜1)", min: 0, max: 1, step: 0.05 },
  { adv: true, k: "rvc_protect", t: "num", label: "子音・息の保護(0〜0.5。0.5 で無し)", min: 0, max: 0.5, step: 0.01 },
  { adv: true, k: "rvc_rms", t: "num", label: "音量の動き(0 で元の音声に合わせる、1 で変換後のまま)", min: 0, max: 1, step: 0.05 },
  { adv: true, k: "rvc_speaker", t: "num", label: "話者 ID(複数の声を持つモデル)", min: 0, max: 255, step: 1 },
  { adv: true, k: "rvc_unload", t: "check", label: "作り終えたら RVC のモデルをメモリから外す" },
];
// 種別・タスクごとの欄。t: select / num / check / text / area / media。adv = 「細かい設定」の中
function audioFields(gen, task, o) {
  const c = CCA.SPEC.audio?.choices || {};
  if (gen === "rvc") return [{ k: "audio", t: "media", media: "audio", label: "変換する音声" }, ...rvcFields(), ...[{ k: "format", t: "select", label: "保存の形式", opts: c.format, lab: FMT_LABEL },
    ...(o.format === "mp3" ? [{ k: "mp3q", t: "select", label: "MP3 の音質", opts: c.mp3q }] : [])]];
  const fmt = [{ k: "format", t: "select", label: "保存の形式", opts: c.format, lab: FMT_LABEL },
    ...(o.format === "mp3" ? [{ k: "mp3q", t: "select", label: "MP3 の音質", opts: c.mp3q }] : [])];
  if (gen === "qwen_tts") {
    const f = [];
    if (task === "TTC") {
      f.push({ k: "voice", t: "select", label: "保存した声を使う", dyn: "voice", none: "使わない(参照音声を使う)" });
      if (!o.voice) {
        f.push({ k: "ref_audio", t: "media", media: "audio", label: "参照音声" },
          { k: "ref_text", t: "area", label: "参照音声の文字起こし", ph: "参照音声で話している内容", stt: true },
          { k: "save_voice", t: "text", label: "この声を保存する名前(任意)", ph: "例: my_voice(空なら保存しない)" });
      }
      f.push({ k: "x_vector_only", t: "check", label: "声の特徴だけ使う(参照音声の文字起こしを使わない。似かたは少し弱くなる)" });
    }
    f.push({ k: "language", t: "select", label: "言語", dyn: "language", opts: c.language });
    if (task === "TTS") f.push({ k: "speaker", t: "select", label: "声", dyn: "speaker", opts: c.speaker });
    if (task !== "TTD") f.push({ k: "model_size", t: "select", label: "モデルの大きさ", opts: c.model_size });
    if (task !== "TTC") {
      f.push({ k: "inst_char", t: "select", label: "話し方のひな形(人物)", dyn: "inst_char", none: "使わない" },
        { k: "inst_style", t: "select", label: "話し方のひな形(様子)", dyn: "inst_style", none: "使わない" });
    }
    f.push({ k: "rvc_on", t: "check", label: "読み上げた声を RVC で変える(ボイスチェンジ)" });
    if (o.rvc_on) f.push(...rvcFields().map((x) => ({ ...x, adv: false })));
    f.push(...fmt,
      { adv: true, k: "do_sample", t: "check", label: "毎回少し変える(サンプリング)" },
      { adv: true, k: "temperature", t: "num", label: "温度", min: 0.1, max: 2, step: 0.05 },
      { adv: true, k: "top_p", t: "num", label: "top_p", min: 0, max: 1, step: 0.05 },
      { adv: true, k: "top_k", t: "num", label: "top_k", min: 0, max: 200, step: 1 },
      { adv: true, k: "repetition_penalty", t: "num", label: "くり返しの抑え", min: 0.5, max: 2, step: 0.05 },
      { adv: true, k: "max_new_tokens", t: "num", label: "長さの上限(トークン)", min: 256, max: 4096, step: 256 },
      { adv: true, k: "precision", t: "select", label: "精度", opts: c.precision },
      { adv: true, k: "device", t: "select", label: "使う装置", dyn: "device", opts: ["auto"] },
      { adv: true, k: "attention", t: "select", label: "アテンション", opts: c.attention },
      { adv: true, k: "unload_models", t: "check", label: "作り終えたらモデルをメモリから外す" });
    if (task === "TTC") {
      f.push({ adv: true, k: "stt_model", t: "select", label: "書き起こしのモデル(Whisper)", opts: c.stt_model },
        { adv: true, k: "stt_lang", t: "select", label: "書き起こしの言語", opts: c.stt_lang });
    }
    return f;
  }
  if (gen === "latentsync") {
    return [
      { k: "video", t: "media", media: "video", label: "リップシンクする動画" },
      { k: "audio", t: "media", media: "audio", label: "合わせる音声" },
      { k: "length_mode", t: "select", label: "長さの合わせ方", opts: c.length_mode, lab: LEN_MODES },
      { k: "silent_padding", t: "num", label: "声の後に足す無音(秒)", min: 0.1, max: 3, step: 0.1 },
    ];
  }
  if (gen === "heartmula") {
    return [
      { k: "duration", t: "num", label: "長さの上限(秒)", min: 10, max: 240, step: 10 },
      ...fmt,
      { adv: true, k: "temperature", t: "num", label: "温度", min: 0.1, max: 2, step: 0.05 },
      { adv: true, k: "top_k", t: "num", label: "top_k", min: 1, max: 500, step: 10 },
      { adv: true, k: "model_version", t: "select", label: "モデル", dyn: "model_version", opts: ["3B"] },
      { adv: true, k: "memory_mode", t: "select", label: "メモリの使い方", opts: c.memory_mode },
      { adv: true, k: "precision", t: "select", label: "精度", opts: c.hm_precision },
      { adv: true, k: "use_4bit", t: "check", label: "4bit で読む(VRAM が少ないとき。bitsandbytes が必要)" },
    ];
  }
  return [ // ACE-Step 1.5
    { k: "duration", t: "num", label: "長さ(秒)", min: 1, max: 600, step: 1 },
    { k: "bpm", t: "num", label: "BPM(テンポ)", min: 10, max: 300, step: 1 },
    { k: "keyscale", t: "select", label: "キー", opts: c.keyscale },
    { k: "timesig", t: "select", label: "拍子", opts: c.timesig, lab: { 2: "2 拍子", 3: "3 拍子", 4: "4 拍子", 6: "6 拍子" } },
    { k: "language", t: "select", label: "歌の言語", opts: c.ace_language },
    { k: "instrumental", t: "check", label: "歌なし(インストゥルメンタル。歌詞は使わない)" },
    ...fmt,
    { adv: true, k: "think", t: "check", label: "先に曲の設計を作る(遅いが良くなる)" },
    { adv: true, k: "lm_cfg", t: "num", label: "LM の CFG", min: 0, max: 100, step: 0.1 },
    { adv: true, k: "lm_temp", t: "num", label: "LM の温度", min: 0, max: 2, step: 0.01 },
    { adv: true, k: "lm_top_p", t: "num", label: "LM の top_p", min: 0, max: 1, step: 0.01 },
    { adv: true, k: "lm_top_k", t: "num", label: "LM の top_k", min: 0, max: 100, step: 1 },
    { adv: true, k: "lm_min_p", t: "num", label: "LM の min_p", min: 0, max: 1, step: 0.001 },
    { adv: true, k: "shift", t: "num", label: "シフト", min: 0, max: 100, step: 0.1 },
  ];
}
async function audioDyn(gen) {
  const out = {};
  if (gen === "qwen_tts") {
    const [cv, lv, vi] = await Promise.all([objInfo("AILab_Qwen3TTSCustomVoice_Advanced"), objInfo("AILab_Qwen3TTSLoadVoice"), objInfo("AILab_Qwen3TTSVoiceInstruct")]);
    Object.assign(out, { speaker: objChoices(cv, "speaker"), language: objChoices(cv, "language"), device: objChoices(cv, "device"),
      voice: (objChoices(lv, "voice_name") || []).filter(Boolean), inst_char: objChoices(vi, "character"), inst_style: objChoices(vi, "style") });
  } else if (gen === "heartmula") out.model_version = objChoices(await objInfo("FL_HeartMuLa_ModelLoader"), "model_version");
  if (gen === "qwen_tts" || gen === "rvc") { // RVC の声のモデルと .index(models/rvc。🔄 で読み直す)
    const rv = await objInfo("CCARVCConvert");
    out.rvc_model = (objChoices(rv, "model") || []).filter((x) => x && x !== NONE);
    out.rvc_index = objChoices(rv, "index") || [NONE];
  }
  return out;
}
let aoBusy = 0;
async function renderAudioOpts(n, force = false) {
  const box = $("#cca-audio-opts");
  const mt = W(n, "model_type").value, task = W(n, "task").value, ti = CCA.SPEC.types_info[mt] || {};
  if (ti.kind !== "audio") { box.innerHTML = ""; box._sig = ""; return; }
  const ticket = ++aoBusy;
  const [dyn, media] = await Promise.all([audioDyn(ti.gen), mediaList()]);
  if (ticket !== aoBusy || !root) return;
  const o = audioOpts(n), json = W(n, "audio_opts")?.value || "{}";
  const sig = JSON.stringify([mt, task, !!o.voice, !!o.rvc_on, o.format, dyn, media, history.length]);
  const focused = box.contains(document.activeElement);
  if (!force && box._sig === sig && (box._json === json || focused)) return;
  if (!force && focused && box._sig === sig) return;
  box._sig = sig;
  box._json = json;
  $("#cca-audiogen-note").textContent = T(AUDIO_NOTES[ti.gen === "qwen_tts" || ti.gen === "latentsync" ? task : ti.gen] || "");
  const opt = (f, v) => `<option value="${esc(v)}" ${String(v) === String(o[f.k] ?? "") ? "selected" : ""}>${esc(f.lab?.[v] ? T(f.lab[v]) : String(v).replace(LINK_RE, "$2"))}</option>`;
  const control = (f) => {
    const v = o[f.k];
    if (f.t === "check") return `<label class="row"><input type="checkbox" data-ao="${f.k}" ${v ? "checked" : ""}> <span>${esc(T(f.label))}</span></label>`;
    if (f.t === "num") return `<input type="number" data-ao="${f.k}" value="${esc(v ?? "")}" min="${f.min}" max="${f.max}" step="${f.step}">`;
    if (f.t === "text") return `<input type="text" data-ao="${f.k}" value="${esc(v ?? "")}" placeholder="${esc(T(f.ph || ""))}">`;
    if (f.t === "area") return `<textarea data-ao="${f.k}" rows="3" placeholder="${esc(T(f.ph || ""))}">${esc(v ?? "")}</textarea>`;
    if (f.t === "media") {
      const gens = history.filter((h) => (f.media === "audio" ? h.isAudio : h.isVideo) && h.value).slice(0, 30).map((h) => h.value);
      const files = (f.media === "audio" ? media.audios : media.videos).filter((x) => !gens.includes(x));
      const known = !v || gens.includes(v) || files.includes(v);
      const url = v ? imageUrl(v) : "";
      return `<div class="row" style="gap:6px"><select class="grow" data-ao="${f.k}"><option value="">${esc(T("(選んでください)"))}</option>`
        + `${known ? "" : `<option value="${esc(v)}" selected>${esc(v)}</option>`}`
        + `${gens.length ? `<optgroup label="${esc(T("生成した結果"))}">${gens.map((x) => opt(f, x)).join("")}</optgroup>` : ""}`
        + `<optgroup label="${esc(T("ファイル(output・input)"))}">${files.filter((x) => !LINK_RE.test(x)).map((x) => opt(f, x)).join("")}</optgroup>${linkGroups(files.filter((x) => LINK_RE.test(x)), (x) => opt(f, x))}</select>`
        + `<button data-aorf title="${esc(T("保存先(output)と input のファイルの一覧を読み直して、最新にします"))}">${esc(T("更新"))}</button>`
        + `<button data-aoup="${f.k}" data-media="${f.media}" title="${esc(T("PC のファイルを入れます(「動画の保存先」のフォルダに入ります)"))}">📂 ${esc(T("ファイルを入れる"))}</button></div>`
        + (url ? (f.media === "audio" ? `<audio controls preload="none" src="${esc(url)}"></audio>` : `<video controls preload="metadata" src="${esc(url)}"></video>`) : "");
    }
    const list = (dyn[f.dyn] && dyn[f.dyn].length ? dyn[f.dyn] : f.opts) || [];
    const all = v && !list.map(String).includes(String(v)) && f.none === undefined ? [v, ...list] : list;
    return `<select data-ao="${f.k}">${f.none !== undefined ? `<option value="">${esc(T(f.none))}</option>` : ""}${all.map((x) => opt(f, x)).join("")}</select>`;
  };
  const html = (f) => (f.t === "check" ? `<div class="f wide">${control(f)}</div>`
    : `<div class="f ${f.t === "media" || f.t === "area" ? "wide" : ""}"><label class="l"><span>${esc(T(f.label))}</span>${f.stt ? ` <button data-stt title="${esc(T("参照音声を Whisper で文にします"))}">📝 ${esc(T("書き起こす"))}</button>` : ""}</label>${control(f)}</div>`);
  const fields = audioFields(ti.gen, task, o);
  const main = fields.filter((f) => !f.adv), adv = fields.filter((f) => f.adv);
  box.innerHTML = `<div class="grid aogrid">${main.map(html).join("")}</div>`
    + (adv.length ? `<details class="adv" ${box._advOpen ? "open" : ""}><summary>${esc(T("細かい設定"))}</summary><div class="grid aogrid">${adv.map(html).join("")}</div></details>` : "");
  box.querySelector("details.adv")?.addEventListener("toggle", (e) => { box._advOpen = e.target.open; });
  for (const el of box.querySelectorAll("[data-ao]")) {
    const k = el.dataset.ao, sel = el.tagName === "SELECT" || el.type === "checkbox";
    el.addEventListener(sel ? "change" : "input", async () => {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "number") { if (el.value === "" || Number.isNaN(Number(el.value))) return; v = Number(el.value); }
      await setAO(k, v);
      if (sel) renderAudioOpts(node(), true);
    });
  }
  for (const b of box.querySelectorAll("[data-aoup]")) b.onclick = () => pickMedia(b.dataset.aoup, b.dataset.media, b);
  for (const b of box.querySelectorAll("[data-aorf]")) b.onclick = async () => { b.disabled = true; await mediaList(true); await renderAudioOpts(node(), true); }; // 最新の一覧に
  const stt = box.querySelector("[data-stt]");
  if (stt) stt.onclick = () => transcribe(stt);
}
function pickMedia(key, kind, btn) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = kind === "audio" ? "audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" : "video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v";
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const value = await uploadImage(f);
      await mediaList(true);
      await setAO(key, value);
      renderAudioOpts(node(), true);
    } catch (e) { notify(`ファイルを入れられませんでした: ${e.message}`, "error", btn); }
  };
  inp.click();
}
async function transcribe(btn) {
  const n = node();
  const o = audioOpts(n);
  if (!o.ref_audio) { notify("先に「参照音声」を選んでください", "info", btn); return; }
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = T("書き起こしています…");
  try {
    const r = await api.fetchApi("/cca_generator/audio/transcribe", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: o.ref_audio, model: o.stt_model, lang: o.stt_lang }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
    const out = await runMini(j.prompt);
    const text = String(out?.outputs?.out?.text?.[0] ?? "").trim();
    if (!text) throw new Error(T("文になりませんでした"));
    await setAO("ref_text", text);
    renderAudioOpts(node(), true);
  } catch (e) { notify(`書き起こせませんでした: ${e.message}`, "error", btn); }
  finally { btn.disabled = false; btn.textContent = old; }
}
// 種別が声・音楽のときの、パネルの見え方(使わない欄・カードを隠す。文の欄の名前と入力例)
function refreshAudioGen(n, vis, tinfo) {
  const on = tinfo.kind === "audio";
  const task = W(n, "task").value, tl = tinfo.labels || {};
  $("#cca-addon-open").classList.toggle("hide", !tinfo.addon); // 入れ方の案内がある追加ノードだけ(ACE-Step は ComfyUI 本体)
  const lab = (k, d) => tl[task]?.[k] ?? tl["*"]?.[k] ?? d;
  $("#cca-sec-audio").classList.toggle("hide", !on);
  if (on) {
    $("#cca-sec-size").classList.add("hide");
    $("#cca-sec-tile")?.classList.add("hide");
    $("#cca-sec-models").classList.toggle("hide", !vis.has("unet_name"));
  } else {
    $("#cca-sec-size").classList.remove("hide");
    $("#cca-sec-models").classList.remove("hide");
  }
  root.querySelector('section[data-sec="prompt"]').classList.toggle("hide", on && !vis.has("positive"));
  $("#cca-words-btn").classList.toggle("hide", on);
  if (on) $("#cca-words").classList.add("hide");
  $("#cca-prompt-title").textContent = T(on ? lab("positive", "プロンプト") : "プロンプト");
  root.querySelector('textarea[data-w="positive"]').placeholder = T(on ? lab("positive_ph", "") : "生成したい内容");
  root.querySelector('textarea[data-w="negative"]').placeholder = T(on ? lab("negative_ph", "") : "避けたい内容");
  if (on) renderAudioOpts(n);
}
// 生成のあとのシード(ComfyUI の「生成後のシード」と同じ: 送ったあとで変える)
async function advanceSeed(n) {
  const mode = W(n, "control_after_generate")?.value || "randomize";
  const s = Number(W(n, "seed").value) || 0;
  const next = mode === "fixed" ? s : mode === "increment" ? s + 1 : mode === "decrement" ? Math.max(0, s - 1) : Math.floor(Math.random() * 2 ** 31);
  if (next !== s) await setW("seed", next);
}
const AUDIO_STAGE = {
  UNETLoader: "モデルを読み込んでいます", DualCLIPLoader: "エンコーダーを読み込んでいます", VAELoader: "VAE を読み込んでいます",
  "TextEncodeAceStepAudio1.5": "曲の設計を作っています", KSampler: "曲を作っています", VAEDecodeAudio: "音にしています",
  FL_HeartMuLa_ModelLoader: "モデルを読み込んでいます", FL_HeartMuLa_Conditioning: "歌詞とスタイルを読んでいます",
  FL_HeartMuLa_Sampler: "曲を作っています", FL_HeartMuLa_Decode: "音にしています",
  AILab_Qwen3TTSCustomVoice_Advanced: "声を作っています", AILab_Qwen3TTSVoiceDesign_Advanced: "声を作っています",
  AILab_Qwen3TTSVoiceClone_Advanced: "声を作っています", AILab_Qwen3TTSVoicesLibrary: "声を保存しています",
  LoadVideo: "動画を読み込んでいます", CCAFramesAtFps: "コマを並べ直しています", VideoLengthAdjuster: "長さを合わせています",
  LatentSyncNode: "リップシンクを作成しています", CreateVideo: "動画にまとめています", CCASaveVideoFile: "保存しています",
  SaveAudioMP3: "保存しています", SaveAudio: "保存しています", SaveAudioOpus: "保存しています",
};
function audioStatus(s, i, batch) {
  const pre = batch > 1 ? `${i + 1} / ${batch}: ` : "";
  if (s.phase === "wait") setStatus(`${pre}${T("順番を待っています(前に {0} 件)", s.ahead)}`);
  else if (s.phase === "node") setStatus(`${pre}${T(AUDIO_STAGE[s.type] || "作っています")}…`);
  else if (s.phase === "progress" && s.max > 1) {
    $("#cca-bar").style.width = `${Math.round((100 * s.value) / s.max)}%`;
    setStatus(`${pre}${T(AUDIO_STAGE[s.type] || "作っています")}… ${s.value} / ${s.max}`);
  }
}
async function generateAudio(n, batch) {
  for (let i = 0; i < batch; i++) {
    let j;
    try {
      const values = Object.fromEntries(CCA.SPEC.widgets.map((k) => [k, W(n, k)?.value]));
      const r = await api.fetchApi("/cca_generator/audio/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
      j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
      await advanceSeed(n);
      audioJob = { cancel: false };
      $("#cca-bar").style.width = "0%";
      setStatus(batch > 1 ? `${i + 1} / ${batch}: ${T("作っています")}…` : `${T("作っています")}…`);
      const out = await runMini(j.prompt, { job: audioJob, onStatus: (s) => audioStatus(s, i, batch) });
      const o = out?.outputs?.out || {};
      const f = (o.audio || o.cca_video || o.images || [])[0];
      if (!f?.filename) throw new Error(T("結果のファイルが見つかりません"));
      const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || "", type: f.type || "output" });
      const isVideo = j.kind === "video";
      history.unshift({ url: api.apiURL(`/view?${q}`), isVideo, isAudio: !isVideo, ts: Date.now(), promptId: "",
        value: `${f.subfolder ? `${f.subfolder}/` : ""}${f.filename} [${f.type || "output"}]`, audio: j.used });
      history = history.slice(0, HISTORY_MAX);
      lsSet(LS_HISTORY, history);
      renderHistory();
      show(history[0]);
      $("#cca-bar").style.width = "100%";
      setStatus(batch > 1 ? `${i + 1} / ${batch}: ${T("完了")}` : T("完了"));
      if (j.prompt.lib) {
        objCache.delete("AILab_Qwen3TTSLoadVoice");
        notify(T("声「{0}」を保存しました。次から「保存した声を使う」で選べます", j.prompt.lib.inputs.voice_name), "info");
      }
    } catch (e) {
      if (e.cancelled) { setStatus(T("中止しました")); return; }
      showError(`${T("作れませんでした")}: ${e.message || e}`);
      setStatus(T("失敗しました"));
      return;
    } finally { audioJob = null; }
  }
}
// 声・音楽の結果の情報(使った設定と、入力欄に戻す・ほかの種別で使うボタン)
function renderAudioInfo(entry) {
  const box = $("#cca-info"), i = entry.audio, o = i.opts || {};
  const ti = CCA.SPEC.types_info?.[i.model_type] || {};
  const lab = (k) => ti.labels?.[i.task]?.[k] ?? ti.labels?.["*"]?.[k] ?? CCA.SPEC.labels?.[k] ?? k;
  const kv = (k, v) => (v === undefined || v === null || v === "" || v === NONE ? "" : `<span><span class="k">${esc(T(k))}</span>${esc(v)}</span>`);
  const sum = ti.gen === "qwen_tts" ? kv("言語", o.language) + kv("声", i.task === "TTS" ? o.speaker : "") + kv("モデルの大きさ", i.task === "TTD" ? "1.7B" : o.model_size)
      + kv("参照音声", i.task === "TTC" ? (o.voice || audioName({ value: o.ref_audio })) : "")
    : ti.gen === "latentsync" ? kv("動画", audioName({ value: o.video })) + kv("声", audioName({ value: o.audio })) + kv("長さの合わせ方", T(LEN_MODES[o.length_mode] || o.length_mode))
    : ti.gen === "rvc" ? kv("変換する音声", audioName({ value: o.audio }))
    : ti.gen === "heartmula" ? kv("長さの上限(秒)", o.duration) + kv("温度", o.temperature) + kv("top_k", o.top_k)
    : kv("長さ(秒)", o.duration) + kv("BPM", o.bpm) + kv("キー", o.keyscale) + kv("拍子", o.timesig) + kv("歌の言語", o.language) + (o.instrumental ? kv("歌なし", "✔") : "");
  const rvcSum = ti.gen === "rvc" || o.rvc_on ? kv("RVC", audioName({ value: o.rvc_model })) + kv(".index", o.rvc_index_used && o.rvc_index_used !== NONE ? audioName({ value: o.rvc_index_used }) : T("使わない"))
    + kv("声の高さ(半音)", o.rvc_pitch) : "";
  box.innerHTML = `
    <div class="meta">${kv("種別", `${i.model_type} / ${CCA.SPEC.task_labels?.[i.task] || i.task}`)}${kv("モデル", i.model)}</div>
    ${rvcSum ? `<div class="meta">${rvcSum}</div>` : ""}
    <div class="meta">${kv("Seed", i.seed)}${ti.steps ? kv(lab("steps"), i.steps) : ""}${ti.cfg ? kv(lab("cfg"), i.cfg) : ""}${i.sampler ? kv("Sampler", `${i.sampler} / ${i.scheduler}`) : ""}</div>
    <div class="meta">${sum}</div>
    ${i.positive ? `<div><span class="k">${esc(T(lab("positive")))}</span></div><div class="txt">${esc(i.positive)}</div>` : ""}
    ${i.negative ? `<div><span class="k">${esc(T(lab("negative")))}</span></div><div class="txt">${esc(i.negative)}</div>` : ""}
    <div class="row"><button data-reuse="prompt">${esc(T("文を入力欄に戻す"))}</button><button data-reuse="seed">${esc(T("このシードを使う"))}</button>
      ${entry.isAudio ? `<button data-reuse="lip" title="${esc(T("この声で、動画のリップシンクを作成します(LatentSync 1.6)"))}">👄 ${esc(T("リップシンクに使う"))}</button>
      <button data-reuse="clone" title="${esc(T("この声を「参照音声」にします(Qwen3-TTS)"))}">🗣 ${esc(T("参照音声に使う"))}</button>` : ""}</div>`;
  const toType = async (mt, task) => {
    if (W(node(), "model_type").value !== mt) await setW("model_type", mt);
    if (task && W(node(), "task").value !== task) await setW("task", task);
  };
  box.querySelector('[data-reuse="prompt"]').onclick = async () => {
    await toType(i.model_type, i.task);
    await setW("positive", i.template || i.positive || "");
    if (i.negative) await setW("negative", i.negative);
  };
  box.querySelector('[data-reuse="seed"]').onclick = async () => {
    await setW("seed", Number(i.seed) || 0);
    await setW("control_after_generate", "fixed");
  };
  const lip = box.querySelector('[data-reuse="lip"]');
  if (lip) lip.onclick = async () => { await toType("LatentSync 1.6", "LIP"); await setAO("audio", entry.value); refresh(); renderAudioOpts(node(), true); };
  const cl = box.querySelector('[data-reuse="clone"]');
  if (cl) cl.onclick = async () => { await toType("Qwen3-TTS", "TTC"); await setAO("voice", ""); await setAO("ref_audio", entry.value); refresh(); renderAudioOpts(node(), true); };
}
function isHiresNode(id) {
  const h = app.graph?.extra?.ccaHiresNode;
  return !!h && String(id) === String(h);
}
// 全体の進み具合: サンプリングの段階(Wan2.2 14B は High / Low、LTX-2.5 は 2 段など)を数えて、1 本の % にする。
// ComfyUI が送る進み具合(progress)を数えるだけなので、処理の負担は増えない
const prog = { stage: -1, node: null, value: 0, max: 0, expected: 1, extra: 0, pct: 0 };
function expectedStages() {
  const n = node();
  if (!n) return [1, 0];
  const ti = CCA.SPEC.types_info[W(n, "model_type").value] || {};
  const task = W(n, "task").value;
  let stages = ti.loader === "wan14" ? 2 : 1;
  let extra = 0;
  if (ti.family === "LTX-2.5") {
    const last = W(n, "image_2")?.value;
    stages = task === "I2V" && last && last !== NONE ? 1 : 2;
    extra = 1; // 分割してのデコード
  }
  if (task === "T2I" && W(n, "hires_enable")?.value && visibleSet(n).has("hires_enable")) stages += 1;
  return [stages, extra];
}
function resetProgress() {
  const [expected, extra] = expectedStages();
  Object.assign(prog, { stage: -1, node: null, value: 0, max: 0, expected, extra, pct: 0 });
}
function onProgress(e) {
  const { value, max, node: nid } = e.detail || {};
  lastProgress = { value, max };
  if (!root || !max) return;
  if (max <= 1) return; // テキストのエンコードなど(1 回で終わるもの)は数えない
  if (prog.stage < 0 || nid !== prog.node || value < prog.value || max !== prog.max) prog.stage += 1;
  Object.assign(prog, { node: nid, value, max });
  const total = Math.max(prog.expected + prog.extra, prog.stage + 1);
  const pct = Math.min(100, Math.round((100 * (prog.stage + value / max)) / total));
  prog.pct = Math.max(prog.pct, pct); // 戻らないようにする
  $("#cca-bar").style.width = `${prog.pct}%`;
  const hires = isHiresNode(nid ?? executingId);
  const stageText = prog.stage < prog.expected
    ? (prog.expected > 1 ? `工程 ${prog.stage + 1} / ${prog.expected} ・ ` : "") + `ステップ ${value} / ${max}`
    : `仕上げ(デコード) ${Math.round((100 * value) / max)}%`;
  setStatus(`${hires ? "Hires. fix" : "生成中"}… ${stageText}(全体 ${prog.pct}%)`);
}
function onExecuting(e) {
  const id = e.detail?.node ?? e.detail;
  if (!root) return;
  if (id === null || id === undefined) {
    if (running) { running = false; setStatus("完了"); $("#cca-bar").style.width = "100%"; }
    return;
  }
  running = true;
  executingId = String(id);
  const pid = String(node()?.id ?? "");
  if (executingId === pid || executingId.startsWith(pid + ".")) setStatus("モデル・設定を準備中…");
  else if (isHiresNode(executingId)) setStatus("Hires. fix: 拡大中…");
}
let livePreviewUrl = "";
function onPreview(e) {
  const blob = e.detail?.blob ?? e.detail;
  if (!root || !running || !(blob instanceof Blob)) return;
  const url = URL.createObjectURL(blob);
  const v = $("#cca-viewer");
  v.innerHTML = `<div class="live"><img src="${url}" alt=""><span class="tag">途中経過</span></div>`;
  if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl);
  livePreviewUrl = url;
}
function onExecuted(e) {
  const d = e.detail || {};
  if (miniIds.has(d.prompt_id)) return; // 合成・プロンプト作成の小さな処理
  const n = node();
  if (!n) return;
  const ids = saveNodeIds(n);
  const nid = String(d.display_node ?? d.node);
  if (![...ids.image, ...ids.video].includes(nid)) return;
  const items = [...(d.output?.images || []), ...(d.output?.gifs || []), ...(d.output?.videos || [])];
  for (const it of items) {
    if (!it?.filename) continue;
    const q = new URLSearchParams({ filename: it.filename, subfolder: it.subfolder || "", type: it.type || "output" });
    const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(it.filename);
    const entry = {
      url: api.apiURL(`/view?${q}`), isVideo, ts: Date.now(), promptId: d.prompt_id || "",
      value: `${it.subfolder ? `${it.subfolder}/` : ""}${it.filename} [${it.type || "output"}]`,
    };
    history.unshift(entry);
  }
  history = history.slice(0, HISTORY_MAX);
  lsSet(LS_HISTORY, history);
  renderHistory();
  if (history[0]) show(history[0]);
}
// 第29版: タイルにまとめた画像などを結果の一覧に入れる(f: {filename, subfolder, type})
function addResult(f, extra = {}) {
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || "", type: f.type || "output" });
  history.unshift({
    url: api.apiURL(`/view?${q}`), isVideo: false, ts: Date.now(), promptId: "",
    value: `${f.subfolder ? `${f.subfolder}/` : ""}${f.filename} [${f.type || "output"}]`, ...extra,
  });
  history = history.slice(0, HISTORY_MAX);
  lsSet(LS_HISTORY, history);
  renderHistory();
  if (root && history[0]) show(history[0]);
}
// タイル・ワイルドカードの部品に渡す(root は開いたときに作るので、そのつど読む)
const UICTX = {
  get root() { return root; }, CCA, W, setW, esc, addWord, insertWord, addResult,
  node: () => node(), notify: (...a) => notify(...a),
  saveIds: () => { const n = node(); return n ? saveNodeIds(n).image : []; },
};
// 実行に使った設定(履歴の prompt から CCA の内部ノードの値を読む)
function extractInfo(prompt) {
  const byClass = {};
  for (const n of Object.values(prompt || {})) if (n?.class_type) byClass[n.class_type] = n.inputs || {};
  const panel = byClass.CCAGeneratorPanel || {};
  const g = (cls, k) => (byClass[cls] && k in byClass[cls] ? byClass[cls][k] : panel[k]);
  const loras = (() => {
    try { return JSON.parse(g("CCAGenModels", "loras") || "[]").filter((l) => l.on && l.name && l.name !== NONE); } catch { return []; }
  })();
  const info = {
    model_type: g("CCAGenModels", "model_type"), task: g("CCAGenModels", "task"),
    model: g("CCAGenModels", "ckpt_name") !== NONE && g("CCAGenModels", "ckpt_name") ? g("CCAGenModels", "ckpt_name") : g("CCAGenModels", "unet_name"),
    wan: [g("CCAGenModels", "wan_high_unet"), g("CCAGenModels", "wan_low_unet")],
    loras: loras.map((l) => `${l.name} (${l.strength})`),
    turbo: g("CCAGenModels", "turbo_lora_name"), edit: g("CCAGenModels", "edit_lora_name"),
    positive: g("CCAGenPrompt", "positive_text") ?? g("CCAGenPrompt", "positive"), negative: g("CCAGenPrompt", "negative"),
    template: byClass.CCAGenPrompt?.wildcard_template || "",
    layoutRaw: g("CCAGenPrompt", "layout_boxes") || "", negwRaw: g("CCAGenPrompt", "negw_settings") || "", regionalRaw: g("CCAGenPrompt", "regional_settings") || "",
    negw: (() => { try { return (JSON.parse(g("CCAGenPrompt", "negw_settings") || "{}").terms || []).map(([w, x]) => `${w}:-${x}`).join(", "); } catch { return ""; } })(),
    layout: (() => { const b = parseLayout(g("CCAGenPrompt", "layout_boxes") ?? ""); return b.length ? layoutSummary(b) : ""; })(),
    seed: g("CCAGenSeed", "seed"), steps: g("CCAGenSampling", "steps"), cfg: g("CCAGenSampling", "cfg"),
    sampler: g("CCAGenSampling", "sampler_name"), scheduler: g("CCAGenSampling", "scheduler"),
    denoise: g("CCAGenSampling", "denoise"), width: g("CCAGenSampling", "width"), height: g("CCAGenSampling", "height"),
    images: IMG_KEYS.map((k) => g("CCAGenImages", k)),
    size_mode: g("CCAGenSampling", "size_mode"), size_scale: g("CCAGenSampling", "size_scale"), resize_mode: g("CCAGenSampling", "resize_mode"),
    video_length: g("CCAGenSampling", "video_length"), video_fps: g("CCAGenSampling", "video_fps"),
    hires: g("CCAGenHires", "hires_enable") ? `×${g("CCAGenHires", "hires_scale")} ${g("CCAGenHires", "hires_upscaler")} / Denoise ${g("CCAGenHires", "hires_denoise")}` : "",
  };
  return info.model_type ? info : null;
}
async function onSuccess(e) {
  const pid = e.detail?.prompt_id;
  if (!pid || !history.some((h) => h.promptId === pid && !h.info)) return;
  try {
    const r = await api.fetchApi(`/history/${encodeURIComponent(pid)}`);
    const h = (await r.json())[pid];
    const info = extractInfo(h?.prompt?.[2]);
    if (!info) return;
    for (const entry of history) if (entry.promptId === pid) entry.info = info;
    lsSet(LS_HISTORY, history);
    if (current?.promptId === pid) renderInfo(current);
  } catch (err) { console.warn("[CCA Generator] 生成情報を取得できませんでした", err); }
}
function renderInfo(entry) {
  const box = $("#cca-info");
  if (!entry) { box.classList.add("hide"); return; }
  box.classList.remove("hide");
  if (entry.audio) { renderAudioInfo(entry); return; } // 第42版: 声・音楽
  const i = entry.info;
  if (!i && entry.tile) {
    box.innerHTML = `<div class="hint">${esc(T("複数画像タイル生成でまとめた画像です({0} 枚・{1} ページ・{2} × {3} px)。1 枚ずつの設定は、結果の一覧のそれぞれの画像で見られます。", entry.tile.count, entry.tile.pages, entry.tile.width, entry.tile.height))}</div>`;
    return;
  }
  if (!i) { box.innerHTML = '<div class="hint">この画像の設定情報はありません(生成中、または以前の版で生成した画像)。</div>'; return; }
  const task = CCA.SPEC.task_labels?.[i.task] || i.task;
  const model = i.model && i.model !== NONE ? i.model : (i.wan || []).filter((x) => x && x !== NONE).join(" / ");
  const kv = (k, v) => (v === undefined || v === null || v === "" || v === NONE ? "" : `<span><span class="k">${esc(k)}</span>${esc(v)}</span>`);
  box.innerHTML = `
    <div class="meta">${kv("種別", `${i.model_type} / ${task}`)}${kv("モデル", model)}</div>
    <div class="meta">${kv("Seed", i.seed)}${kv("Steps", i.steps)}${kv("CFG", i.cfg)}${kv("Sampler", `${i.sampler} / ${i.scheduler}`)}${kv("Denoise", i.denoise)}${kv("サイズ", i.size_mode === SIZE_SCALE ? `画像1 × ${i.size_scale}` : i.task === "I2I" && (!i.resize_mode || ["画像1のサイズ", "今まで通り"].includes(i.resize_mode)) ? "" : i.width && i.height ? `${i.width}×${i.height}${i.resize_mode && !["画像1のサイズ", "今まで通り"].includes(i.resize_mode) && i.task === "I2I" ? `(${i.resize_mode})` : ""}` : "")}</div>
    ${CCA.SPEC.types_info?.[i.model_type]?.kind === "video" ? `<div class="meta">${kv("フレーム数", i.video_length)}${kv("fps", CCA.SPEC.types_info?.[i.model_type]?.base === "MiniMax H3" ? 24 : i.video_fps)}</div>` : ""}
    ${i.loras?.length ? `<div class="meta">${kv("LoRA", i.loras.join(", "))}</div>` : ""}
    <div class="meta">${kv("Turbo LoRA", i.turbo)}${kv("Edit LoRA", i.edit)}${kv("Hires. fix", i.hires)}</div>
    ${i.negw ? `<div class="meta">${kv("マイナスプロンプト", i.negw)}</div>` : ""}
    ${i.layout ? `<div class="meta">${kv("範囲別指定", i.layout)}</div>` : ""}
    <div class="meta">${kv("入力画像", (i.images || [i.image, i.image_2, i.image_3]).filter((x) => x && x !== NONE).join(" / "))}</div>
    <div><span class="k">プロンプト</span></div><div class="txt">${esc(i.positive || "")}</div>
    ${i.negative ? `<div><span class="k">ネガティブ</span></div><div class="txt">${esc(i.negative)}</div>` : ""}
    ${i.template ? `<div><span class="k">ワイルドカードを置き換える前</span></div><div class="txt">${esc(i.template)}</div>` : ""}
    <div class="row"><button data-reuse="prompt">プロンプトを入力欄に戻す</button>${i.template ? '<button data-reuse="template" title="__名前__ の入った、置き換える前の文を入力欄に戻す">置き換える前の文を戻す</button>' : ""}<button data-reuse="seed">このシードを使う</button>
      ${i.negwRaw ? '<button data-reuse="negw" title="マイナスプロンプトの設定を入力欄に戻す">マイナスプロンプトを戻す</button>' : ""}
      ${i.layoutRaw ? '<button data-reuse="range" title="範囲(枠とそのプロンプト)と範囲別指定の設定を入力欄に戻す">範囲別指定を戻す</button>' : ""}
      <button data-reuse="copy">プロンプトをコピー</button></div>`;
  const setAll = async (o) => { for (const [k, v] of Object.entries(o || {})) { if (/_preset$/.test(k)) continue; try { await setW(k, v); } catch { /* 無い項目は飛ばす */ } } };
  const nb = box.querySelector('[data-reuse="negw"]');
  if (nb) nb.onclick = async () => {
    try { await setAll(JSON.parse(i.negwRaw).settings); await advCommit(); } catch { /* 読めない設定は戻さない */ }
  };
  const rb = box.querySelector('[data-reuse="range"]');
  if (rb) rb.onclick = async () => {
    await setW("layout_boxes", i.layoutRaw);
    try { await setAll(JSON.parse(i.regionalRaw || "{}")); await advCommit(); } catch { /* 読めない設定は戻さない */ }
  };
  box.querySelector('[data-reuse="prompt"]').onclick = async () => {
    await setW("positive", i.positive || "");
    await setW("negative", i.negative || "");
  };
  const tb = box.querySelector('[data-reuse="template"]');
  if (tb) tb.onclick = () => setW("positive", i.template);
  box.querySelector('[data-reuse="seed"]').onclick = async () => {
    await setW("seed", Number(i.seed) || 0);
    await setW("control_after_generate", "fixed");
  };
  box.querySelector('[data-reuse="copy"]').onclick = () => navigator.clipboard?.writeText(i.positive || "");
}

function onError(e) {
  const d = e.detail || {};
  running = false;
  setStatus("エラー");
  showError(`${d.node_type ? `[${d.node_type}] ` : ""}${d.exception_message || "エラーが発生しました"}`);
}
function onStatus(e) {
  const q = e.detail?.exec_info?.queue_remaining;
  if (root && q !== undefined) $("#cca-queue").textContent = q ? `キュー残り ${q}` : "";
}

let meterNow = null;
function show(entry) {
  current = entry;
  const v = $("#cca-viewer");
  meterNow?.destroy();
  meterNow = null;
  v.classList.toggle("withmeter", !!entry && (entry.isVideo || entry.isAudio));
  if (!entry) {
    v.innerHTML = '<div class="empty">生成結果がここに表示されます</div>';
  } else if (entry.isVideo || entry.isAudio) {
    // 第42版: 動画・音声は右にレベルメーター(左右・dB)
    v.innerHTML = `<div class="avwrap"><div class="media">${entry.isVideo ? `<video src="${esc(entry.url)}" controls loop preload="metadata"></video>`
      : `<div class="aud"><div class="ic">🎵</div><div class="nm">${esc(audioName(entry))}</div><audio src="${esc(entry.url)}" controls preload="metadata"></audio></div>`}</div><div class="cca-meter" title="音の大きさ(左・右。dB)"></div></div>`;
    meterNow = attachMeter(v.querySelector("video, audio"), v.querySelector(".cca-meter"));
  } else {
    v.innerHTML = `<img src="${esc(entry.url)}" alt="">`;
  }
  $("#cca-send").disabled = !entry || entry.isVideo || entry.isAudio || entry.pdf;
  const ed = $("#cca-edit-img");
  ed.disabled = !entry || entry.isAudio || entry.pdf;
  ed.textContent = entry?.isVideo ? "🎬 この動画を編集する" : "✏ この画像を編集する";
  ed.title = entry?.isVideo ? "表示中の動画を動画編集で開く(つなげる・切り取る・文字などを重ねる)" : "表示中の画像を画像編集で開く(背景を透明にする・オブジェクト除去)";
  $("#cca-open").disabled = !entry;
  $("#cca-zoom-btn").disabled = !entry || entry.isAudio;
  $("#cca-folder").disabled = !entry;
  renderInfo(entry);
  for (const t of $$("#cca-hist .t")) t.classList.toggle("on", entry && t.dataset.ts === String(entry.ts) && t.dataset.url === entry.url);
}
function renderHistory() {
  if (!root) return;
  const box = $("#cca-hist");
  box.innerHTML = history.map((h, i) => `<div class="t" data-i="${i}" data-ts="${h.ts}" data-url="${esc(h.url)}" title="${h.isAudio ? `音声: ${esc(audioName(h))}` : h.isVideo ? "動画" : h.pdf ? "PDF" : "画像"}">${h.isAudio ? `<div class="au">🎵<span>${esc(audioName(h))}</span></div>` : h.isVideo ? videoThumb(h.url) : `<img src="${esc(h.url)}" loading="lazy" alt="">`}</div>`).join("");
  for (const t of box.querySelectorAll(".t")) t.onclick = () => show(history[Number(t.dataset.i)]);
}
async function sendToInput() {
  const n = node();
  if (!n || !current || current.isVideo) return;
  const mt = W(n, "model_type").value;
  const tasks = CCA.SPEC.types_info[mt]?.tasks || [];
  if (!visibleSet(n).has("image")) {
    const t = tasks.find((x) => x === "I2I" || x === "I2V");
    if (!t) { showError(`${mt} には画像を入力するタスクがありません。`); return; }
    await setW("task", t);
  }
  await rememberImage(current.value);
  await setW("image", current.value);
}
// 選択肢に無い画像(生成結果など)を最近の画像に入れて、プルダウンに出るようにする
async function rememberImage(value) {
  try {
    await api.fetchApi("/cca_generator/remember_image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
    await refreshChoices();
    helpCache.clear();
  } catch (e) { console.warn(e); }
}

// ---------------------------------------------------------------- 拡大表示・フォルダ
const HISTORY_MAX = 200;
function zoomCurrent() {
  if (!current) return;
  const i = Math.max(0, history.indexOf(current));
  openZoom(history.length ? history : [current], history.length ? i : 0, { onChange: (it) => show(it) });
}
function fileOf(entry) {
  try {
    const q = new URL(entry.pdfUrl || entry.url, location.href).searchParams;
    return { filename: q.get("filename") || "", subfolder: q.get("subfolder") || "", type: q.get("type") || "output" };
  } catch { return null; }
}
// 知らせの「📂 フォルダを開く」: ファイルを選んだ状態でフォルダを開く。結果は知らせの中に書く
async function openFileFolder(f, btn, toast) {
  btn.disabled = true;
  try {
    const r = await api.fetchApi("/cca_generator/open_output", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
    btn.textContent = T("✓ 開くよう指示しました");
    btn.title = T("画面に出ないときは、タスクバーのエクスプローラーを確認してください。");
    setTimeout(() => { if (btn.isConnected) { btn.textContent = T("📂 フォルダを開く"); btn.disabled = false; } }, 3000);
  } catch (e) {
    btn.disabled = false;
    const sp = toast.querySelector("span");
    sp.textContent = `${sp.textContent}\n${T("フォルダを開けませんでした")}: ${e.message}`;
    toast.className = "t error";
  }
}
async function openOutputFolder(btn) {
  const f = current && fileOf(current);
  if (!f) return;
  try {
    const r = await api.fetchApi("/cca_generator/open_output", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
    notify(`エクスプローラーで開くよう指示しました(ファイルを選んだ状態で開きます): ${j.path}\n画面に出ないときは、タスクバーのエクスプローラーを確認してください。`, "info", btn, { toast: false });
  } catch (e) {
    notify(`フォルダを開けませんでした: ${e.message}`, "error", btn);
  }
}

// ---------------------------------------------------------------- 音声(LTX-2.5・Kandinsky 6)
const AUDIO_HELP = {
  "LTX-2.5": {
    html: "LTX-2.5 は、映像と一緒に音(効果音・まわりの音・声・音楽)を作ります。音もプロンプトの文章の中に英語で書きます。<br>"
      + "・<b>聞こえる音</b>: 映像の説明に続けて書きます(例: Waves crash softly, gulls call in the distance.)<br>"
      + "・<b>セリフ</b>: 誰が話すかを書き、言葉を \"…\" で囲みます(例: The chef looks at the camera and says, \"Today we make fresh pasta.\")<br>"
      + "・<b>声の感じ・音楽</b>: a calm low voice / soft piano music plays のように書きます<br>"
      + "・音を書かないときは、映像に合わせた音が付きます。",
    example: 'The chef looks at the camera and says, "Today we make fresh pasta." Pans sizzle and oil crackles in the background.',
  },
  "Kandinsky 6": {
    html: "Kandinsky 6 は、映像と一緒に音を作ります。プロンプトは「映像の説明」と「音の説明」に分けて書きます。<br>"
      + "・<b>映像の説明</b>: 1 行目から書きます。<b>話す言葉</b>は、話す場面のところで &lt;S&gt; と &lt;E&gt; で囲みます(例: A woman smiles and says &lt;S&gt;Good morning!&lt;E&gt;)<br>"
      + "・<b>音の説明</b>: 「Audio:」で始まる行から下に、声の感じ・まわりの音・音楽を書きます(例: Audio: clear female voice, soft cafe chatter)<br>"
      + "・「Audio:」の行が無いときは、音の説明なしで作ります。",
    example: "A woman in a cafe looks at the camera and says <S>Good morning!<E> with a smile.\nAudio: clear female voice, soft cafe chatter, cups clinking",
  },
  "MiniMax H3": {
    html: "MiniMax H3 は、映像と一緒に音を作ります。音の様子もプロンプトに英語で書きます。",
    example: "Ambient sound: soft wind and distant birdsong.",
  },
};
function refreshAudio(n, tinfo) {
  const h = tinfo.audio ? (AUDIO_HELP[tinfo.family] || AUDIO_HELP[tinfo.base]) : null;
  $("#cca-audio").classList.toggle("hide", !h);
  if (!h) return;
  const box = $("#cca-audio-text");
  const key = tinfo.family || tinfo.base;
  if (box._ccaKey === key) return;
  box._ccaKey = key;
  box.innerHTML = `${h.html}<div class="ex">${esc(h.example)}</div>`;
}
async function insertAudioExample() {
  const n = node();
  const tinfo = CCA.SPEC.types_info[W(n, "model_type").value] || {};
  const h = AUDIO_HELP[tinfo.family] || AUDIO_HELP[tinfo.base];
  if (!h) return;
  const cur = String(W(n, "positive").value || "").replace(/\s+$/, "");
  await setW("positive", cur ? `${cur}\n${h.example}` : h.example);
}

// ---------------------------------------------------------------- 枠(バウンディングボックス)
const LAYOUT_HELP = {
  region: "画像に範囲を描くと、範囲ごとに別のプロンプトを使えます(範囲別指定)。「▭ 枠で配置を指定する」を押し、白紙の上をドラッグして範囲を描き、範囲ごとに「そこに描きたいもの」を書いてください。範囲の形は四角・円・三角から選べます。通常のプロンプトは、どの範囲にも入っていない部分を埋めます。範囲が重なった所は、後から描いた範囲が優先です。マイナスプロンプトも使えます(範囲の中に (red:-1.0) のように書く)。",
  flux3: "画像のどこに何を置くかを、枠で指定できます(FLUX.3 Klein)。「▭ 枠で配置を指定する」を押し、画像の上をドラッグして枠を作り、枠ごとに何を置くかを英語で書きます。"
    + "プロンプトでは枠を &lt;obj_1&gt;、&lt;obj_2&gt; … と番号で指せます(例: In &lt;ref_image_0&gt;, change the dress &lt;obj_1&gt; to red.)。"
    + "画像→画像では画像1の上に、テキスト→画像では出力の大きさの白紙の上に枠を描きます。",
  moss: "画像のどこに何を置くかを、枠で指定できます(MOSS のテキスト→画像)。「▭ 枠で配置を指定する」を押し、白紙の上をドラッグして枠を作り、"
    + "枠ごとに置く物・人物・文字を英語で書きます。プロンプトには画像全体の説明を書きます。",
};
function layoutKind(n) {
  const mt = W(n, "model_type")?.value, task = W(n, "task")?.value;
  return CCA.SPEC.types_info?.[mt]?.layout?.[task] || null;
}
function refreshLayout(n, vis) {
  const kind = vis.has("layout_boxes") ? layoutKind(n) : null;
  $("#cca-layout-row").classList.toggle("hide", !kind);
  if (!kind) return;
  const boxes = parseLayout(W(n, "layout_boxes")?.value);
  const sum = layoutSummary(boxes);
  $("#cca-layout-sum").textContent = sum || "枠はまだありません(使わなくても生成できます)";
  $("#cca-layout-clear").classList.toggle("hide", !boxes.length);
  $("#cca-layout-open").textContent = boxes.length ? "▭ 枠を編集する" : "▭ 枠で配置を指定する";
  $("#cca-layout-text").innerHTML = LAYOUT_HELP[kind] || "";
}
function openLayout() {
  const n = node();
  const kind = layoutKind(n);
  if (!kind) return;
  const task = W(n, "task").value;
  const img = W(n, "image")?.value;
  const useImage = task === "I2I";
  if (useImage && (!img || img === NONE)) { notify("先に入力画像1を入れてください(画像の上に枠を描きます)。", "error", $("#cca-layout-open")); return; }
  openLayoutEditor({
    kind,
    regional: !!W(n, "regional_enable")?.value,
    background: useImage ? imageUrl(img) : null,
    width: Number(W(n, "width")?.value) || 1024,
    height: Number(W(n, "height")?.value) || 1024,
    boxes: parseLayout(W(n, "layout_boxes")?.value),
    onSave: async (boxes) => { await setW("layout_boxes", boxes.length ? JSON.stringify({ v: 1, boxes }) : ""); refresh(); },
    onCite: async (k, anchor) => { await addWord("positive", `<obj_${k}>`); notify(`プロンプトの最後に <obj_${k}> を入れました`, "info", anchor, { toast: false }); },
  });
}

// ---------------------------------------------------------------- モデルの選び方・ライセンス
const GUIDE_FIELDS = ["unet_name", "ckpt_name", "clip_name", "clip_name_2", "vae_name", "wan_high_unet", "wan_low_unet", "turbo_lora_name"];
function guideState() {
  const n = node();
  return { type: W(n, "model_type").value, task: W(n, "task").value,
    values: Object.fromEntries(GUIDE_FIELDS.map((k) => [k, W(n, k)?.value])) };
}
function openGuideForCurrent() {
  if (!node() || !CCA.SPEC?.model_guide) return;
  openModelGuide({
    spec: CCA.SPEC, ...guideState(),
    onUse: async (field, value, switchType) => {
      if (switchType) await setW("model_type", switchType);
      await setW(field, value);
      refresh();
    },
    refresh: guideState,
  });
}

// ---------------------------------------------------------------- 追加ノードの入れ方(Kandinsky 6)
async function openAddonGuide() {
  const n = node();
  const need = CCA.SPEC.types_info[W(n, "model_type").value]?.needs_node;
  if (!need) return;
  let m = document.getElementById("cca-addon");
  if (!m) {
    m = document.createElement("div");
    m.id = "cca-addon";
    m.tabIndex = -1;
    m.innerHTML = `<div class="box"><div class="hd"><b class="ttl"></b><span class="sp"></span><button class="cl">閉じる</button></div><div class="md"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); });
    m.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") m.classList.remove("open"); });
    m.querySelector(".cl").onclick = () => m.classList.remove("open");
  }
  const md = m.querySelector(".md");
  md.innerHTML = "読み込み中…";
  m.classList.add("open");
  m.focus();
  try {
    const r = await api.fetchApi(`/cca_generator/addon_help?node=${encodeURIComponent(need)}`);
    const h = await r.json();
    if (!r.ok || h.ok === false) throw new Error(h.error || r.status);
    m.querySelector(".ttl").textContent = `追加ノード「${h.name}」の入れ方(${h.title} を使うために必要)`;
    md.innerHTML = addonHtml(h);
    for (const b of md.querySelectorAll("[data-copy]")) b.onclick = () => copyPath(b, b.dataset.copy);
    for (const b of md.querySelectorAll("[data-open]")) b.onclick = () => openWithMessage(b, b.dataset.open);
  } catch (e) {
    md.innerHTML = `<p>入れ方を読み込めませんでした: ${esc(e.message)}</p>`;
  }
}
function addonHtml(h) {
  const e = h.env;
  const code = (s) => `<div class="code"><code>${esc(s)}</code><button data-copy="${esc(s)}">📋 コピー</button></div>`;
  const rec = '<span class="rec">← あなたの環境ではこれがおすすめ</span>';
  const mgrState = { on: "使えます", off: "入っていますが、まだ使える状態になっていません(起動時に --enable-manager が必要)", none: "入っていません" }[e.manager];
  const state = `<div class="state"><b>あなたの ComfyUI</b><br>ComfyUI Manager: ${mgrState}`
    + `${e.stability_matrix ? "<br>StabilityMatrix から起動しています" : ""}${e.portable ? "<br>ポータブル版(python_embeded)です" : ""}</div>`;
  const viaManager = (first) => `<h3>ComfyUI Manager で入れる${first ? rec : ""}</h3><ol>
    <li>ComfyUI の画面の「Manager」ボタン(新しい画面では、右上のパズルの形の「拡張機能」アイコン、またはメニューの「ヘルプ → Manage Extensions」)を押します。</li>
    <li>「Custom Nodes Manager」(新しい画面では検索欄)で <b>${esc(h.name)}</b> を検索します。</li>
    <li>作者が <b>${esc(h.author)}</b> のものの「Install」を押します。</li>
    <li>終わったら ComfyUI を再起動し、ブラウザを <b>Ctrl+Shift+R</b> で読み込み直します。</li></ol>`;
  const viaSM = (first) => `<h3>StabilityMatrix で入れる${first ? rec : ""}</h3><ol>
    <li>StabilityMatrix の「パッケージ」の画面を開きます。</li>
    <li>ComfyUI のカードの「︙」(メニュー)から「Extensions」を開きます(StabilityMatrix の版によって表示が少し違います)。</li>
    <li>検索欄に <b>${esc(h.name)}</b> と入れ、見つかったものをインストールします。</li>
    <li>ComfyUI を再起動し、ブラウザを <b>Ctrl+Shift+R</b> で読み込み直します。</li></ol>
    <p>一覧に出てこないときは、下の「手で入れる」の方法を使ってください。</p>`;
  const enable = (first) => {
    let n = 1;
    let out = `<h3>ComfyUI Manager を使えるようにしてから入れる${first ? rec : ""}</h3><ol>`;
    if (e.manager === "none") {
      out += `<li>ComfyUI を止めて、コマンドプロンプト(ターミナル)で次を実行します(この ComfyUI の Python に Manager を入れます)。${e.manager_pip ? code(e.manager_pip) : "(この ComfyUI には manager_requirements.txt がありません。ComfyUI を新しくしてください)"}</li>`;
      n++;
    }
    if (e.portable && e.launch_bats.length) {
      out += `<li>起動に使っている ${e.launch_bats.map((b) => `<code>${esc(b)}</code>`).join(" か ")} をメモ帳で開き、<code>main.py</code> の後ろに <code> --enable-manager</code> を足して保存し、それで起動します。</li>`;
    } else if (e.stability_matrix) {
      out += "<li>StabilityMatrix で ComfyUI のカードの「︙」から起動の設定(Launch Options)を開き、追加の起動引数に <code>--enable-manager</code> を入れて起動します(版によって表示が少し違います)。</li>";
    } else {
      out += `<li>起動するときに <code>--enable-manager</code> を付けます。例: <code>python main.py --enable-manager</code></li>`;
    }
    out += "<li>そのあと、下の「ComfyUI Manager で入れる」の手順で入れます。</li></ol>";
    return out;
  };
  const manual = `<h3>手で入れる(Manager を使わない)</h3><ol>
    <li><a href="${esc(h.zip)}" target="_blank" rel="noopener noreferrer">${esc(h.title)} の zip</a> をダウンロードして展開します(配布元: <a href="${esc(h.readme)}" target="_blank" rel="noopener noreferrer">${esc(h.repo)}</a>)。</li>
    <li>展開した中の <b>comfyui</b> フォルダを、次のフォルダに入れて、名前を <b>${esc(h.folder)}</b> に変えます。
      <div class="code"><code>${esc(e.custom_nodes)}</code><button data-open="${esc(e.custom_nodes)}">📂 開く</button><button data-copy="${esc(e.custom_nodes)}">📋 コピー</button></div>
      できあがり: <code>${esc(h.target)}</code></li>
    <li>ComfyUI を止めて、次のコマンドで必要な部品を入れます。${code(h.pip)}</li>
    <li>ComfyUI を起動し、ブラウザを <b>Ctrl+Shift+R</b> で読み込み直します。</li></ol>
    <h3>入れたのに動かないとき</h3><p>ComfyUI Manager などで入れても必要な部品が入らなかったときは、ComfyUI を止めて、ComfyUI のフォルダで(Windows は PowerShell で)次を実行すると直ることがあります。</p>${code(h.pip)}${h.pip_extra ? `<p>${esc(h.title)} は、次も実行します。</p>${code(h.pip_extra)}` : ""}`;
  let order;
  if (e.manager === "on") order = [viaManager(true), e.stability_matrix ? viaSM(false) : "", manual];
  else if (e.stability_matrix) order = [viaSM(true), enable(false), viaManager(false), manual];
  else order = [enable(true), viaManager(false), manual];
  return state + order.join("")
    + `<h3>入れたあと</h3><p>このパネルの ⚠ が消えれば使えます。モデルのファイル(拡散モデル・テキストエンコーダー・VAE・音声 VAE)は別に必要です。「? 使い方」の「${esc(h.title)}」を見てください。</p>`;
}

// ---------------------------------------------------------------- mask editor
// 塗った範囲 = マスク(作り直す範囲)。LoadImage の仕様に合わせ、塗った所の透明度を 0 にした PNG を保存する。
let maskState = null;
// マスクの見える色(画像編集の「オブジェクト除去」の塗りと共通。このブラウザに覚える)
function maskColor() {
  try { const c = localStorage.getItem("cca_generator.maskcolor"); if (/^#[0-9a-f]{6}$/i.test(c || "")) return c; } catch { /* 既定の色 */ }
  return "#ff285a";
}
function buildMaskEditor() {
  const m = document.createElement("div");
  m.id = "cca-mask";
  m.innerHTML = `
    <div class="tools">
      <b>マスクを描く</b><span style="color:#959eab">塗った範囲だけ作り直します</span>
      <button data-t="brush" class="on">ブラシ</button><button data-t="erase">消しゴム</button>
      <label>太さ <input type="range" id="cca-mask-size" min="4" max="300" value="48"></label>
      <button id="cca-mask-clear">全部消す</button>
      <label title="マスクの見える色です(画像に似た色があって見えにくいときに変えます。作り直す範囲には関係しません)">色 <input type="color" id="cca-mask-color"></label>
    </div>
    <div class="stage"><canvas class="b"></canvas><canvas class="m"></canvas></div>
    <div class="tools"><button id="cca-mask-cancel">キャンセル</button><button class="pri" id="cca-mask-save">このマスクを使う</button></div>`;
  document.body.appendChild(m);
  const mc = m.querySelector("canvas.m");
  let drawing = false, last = null;
  const pos = (e) => {
    const r = mc.getBoundingClientRect();
    return [(e.clientX - r.left) * (mc.width / r.width), (e.clientY - r.top) * (mc.height / r.height)];
  };
  const stroke = (p) => {
    const ctx = mc.getContext("2d");
    const size = Number(m.querySelector("#cca-mask-size").value) * (mc.width / mc.getBoundingClientRect().width);
    ctx.globalCompositeOperation = maskState.tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = maskColor();
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(...(last || p));
    ctx.lineTo(...p);
    ctx.stroke();
    last = p;
  };
  mc.onpointerdown = (e) => { drawing = true; last = null; mc.setPointerCapture(e.pointerId); stroke(pos(e)); };
  mc.onpointermove = (e) => { if (drawing) stroke(pos(e)); };
  mc.onpointerup = mc.onpointercancel = () => { drawing = false; last = null; };
  for (const b of m.querySelectorAll("[data-t]")) {
    b.onclick = () => {
      maskState.tool = b.dataset.t;
      for (const x of m.querySelectorAll("[data-t]")) x.classList.toggle("on", x === b);
    };
  }
  m.querySelector("#cca-mask-clear").onclick = () => mc.getContext("2d").clearRect(0, 0, mc.width, mc.height);
  // 色を変えると、描いてあるマスクもその色に(保存するのは形だけ)
  const mcol = m.querySelector("#cca-mask-color");
  mcol.value = maskColor();
  mcol.oninput = () => {
    try { localStorage.setItem("cca_generator.maskcolor", mcol.value); } catch { /* 覚えられなくても今は使える */ }
    const g = mc.getContext("2d");
    g.globalCompositeOperation = "source-in";
    g.fillStyle = mcol.value;
    g.fillRect(0, 0, mc.width, mc.height);
    g.globalCompositeOperation = "source-over";
  };
  m.querySelector("#cca-mask-cancel").onclick = () => m.classList.remove("open");
  m.querySelector("#cca-mask-save").onclick = () => saveMask();
  m.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") m.classList.remove("open"); });
}
function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = url;
  });
}
async function openMaskEditor() {
  guardComfyKeys(); // 開いている間は ComfyUI 本体の「元に戻す」を動かさない
  const n = node();
  const value = W(n, "image")?.value;
  if (!value || value === NONE) { showError("先に入力画像1を指定してください。"); return; }
  const sources = n.properties.cca_mask_sources || {};
  const source = sources[value] || value; // マスク済み画像なら元画像から描き直す
  try {
    const [base, masked] = await Promise.all([loadImg(imageUrl(source)), loadImg(imageUrl(value))]);
    const m = document.getElementById("cca-mask");
    const bc = m.querySelector("canvas.b"), mc = m.querySelector("canvas.m");
    bc.width = mc.width = base.naturalWidth;
    bc.height = mc.height = base.naturalHeight;
    bc.getContext("2d").drawImage(base, 0, 0);
    // 画面に収まる大きさで表示(小さい画像は拡大)
    const scale = Math.min((window.innerWidth * 0.92) / base.naturalWidth, (window.innerHeight * 0.76) / base.naturalHeight);
    const stage = m.querySelector(".stage");
    stage.style.width = `${Math.round(base.naturalWidth * scale)}px`;
    stage.style.height = `${Math.round(base.naturalHeight * scale)}px`;
    bc.style.width = "100%";
    bc.style.height = "100%";
    // 既存のマスク(透明部分)を読み込む
    const tmp = document.createElement("canvas");
    tmp.width = base.naturalWidth; tmp.height = base.naturalHeight;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(masked, 0, 0, tmp.width, tmp.height);
    const src = tctx.getImageData(0, 0, tmp.width, tmp.height);
    const mctx = mc.getContext("2d");
    const md = mctx.createImageData(tmp.width, tmp.height);
    const col = maskColor(), cr = parseInt(col.slice(1, 3), 16), cg = parseInt(col.slice(3, 5), 16), cb = parseInt(col.slice(5, 7), 16);
    m.querySelector("#cca-mask-color").value = col;
    for (let i = 0; i < src.data.length; i += 4) {
      const a = 255 - src.data[i + 3];
      md.data[i] = cr; md.data[i + 1] = cg; md.data[i + 2] = cb; md.data[i + 3] = a;
    }
    mctx.putImageData(md, 0, 0);
    maskState = { tool: "brush", source, base };
    m.classList.add("open");
  } catch (e) {
    showError(e.message);
  }
}
// PNG を自前で書き出す(canvas.toBlob は透明部分の色を捨てるため、元の色を残せるようにする)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function encodePng(w, h, rgba) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const zipped = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, chunk("IHDR", ihdr), chunk("IDAT", zipped), chunk("IEND", new Uint8Array())], { type: "image/png" });
}
async function saveMask() {
  const m = document.getElementById("cca-mask");
  const mc = m.querySelector("canvas.m");
  const n = node();
  try {
    const w = mc.width, h = mc.height;
    const bc = document.createElement("canvas");
    bc.width = w; bc.height = h;
    const bctx = bc.getContext("2d");
    bctx.drawImage(maskState.base, 0, 0);
    const rgba = bctx.getImageData(0, 0, w, h).data;
    const mask = mc.getContext("2d").getImageData(0, 0, w, h).data;
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255 - mask[i];
    const blob = await encodePng(w, h, rgba);
    const stem = parseImageValue(maskState.source).filename.replace(/\.[^.]+$/, "");
    const file = new File([blob], `${stem}_mask_${Date.now()}.png`, { type: "image/png" });
    const value = await uploadImage(file, "cca_masks");
    n.properties.cca_mask_sources = { ...(n.properties.cca_mask_sources || {}), [value]: maskState.source };
    m.classList.remove("open");
    await setW("image", value);
  } catch (e) {
    showError(`マスクを保存できませんでした: ${e.message}`);
  }
}

// ---------------------------------------------------------------- filterable dropdown
let pop = null;
function closePop() {
  if (!pop) return;
  pop.classList.remove("open");
  pop._select = null;
}
function openPop(select) {
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "cca-pop";
    pop.innerHTML = '<input type="text" placeholder="絞り込み(文字を入力)"><div class="list"></div>';
    document.body.appendChild(pop);
    const input = pop.querySelector("input");
    input.addEventListener("input", () => renderPop());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const items = [...pop.querySelectorAll(".o")];
      let i = items.findIndex((x) => x.classList.contains("on"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        i = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
        items.forEach((x, k) => x.classList.toggle("on", k === i));
        scrollToItem(pop.querySelector(".list"), items[i]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[i]) choosePop(items[i].dataset.v);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePop();
        pop._last?.focus();
      }
    });
    window.addEventListener("resize", closePop);
  }
  pop._select = select;
  pop._last = select;
  const r = select.getBoundingClientRect();
  pop._top = r.top;
  pop._left = r.left;
  const width = Math.min(window.innerWidth - 16, Math.max(r.width, 300));
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
  const input = pop.querySelector("input");
  const list = pop.querySelector(".list");
  input.value = "";
  list.style.maxHeight = "none";
  pop.style.top = `${r.bottom + 2}px`;
  pop.style.bottom = "";
  pop.classList.add("open");
  renderPop();
  // 画面の上下の空きを測って、収まる向きと高さにする
  const M = 8;
  const hIn = input.offsetHeight + 12;
  const want = Math.min(420, list.scrollHeight) + hIn;
  const below = window.innerHeight - r.bottom - M - 2;
  const above = r.top - M - 2;
  const down = below >= want || below >= above;
  const avail = down ? below : above;
  list.style.maxHeight = `${Math.max(40, Math.min(420, avail - hIn))}px`;
  if (down) { pop.style.top = `${r.bottom + 2}px`; pop.style.bottom = ""; }
  else { pop.style.top = ""; pop.style.bottom = `${window.innerHeight - r.top + 2}px`; }
  list.scrollTop = 0;
  scrollToItem(list, list.querySelector(".o.on"));
  input.focus({ preventScroll: true });
}
function scrollToItem(list, it) {
  if (!list || !it) return;
  const top = it.offsetTop;
  const bottom = top + it.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}
function renderPop() {
  const select = pop._select;
  if (!select) return;
  const q = pop.querySelector("input").value.trim().toLowerCase();
  const parts = [];
  let any = false;
  const addOpt = (o) => {
    const note = o.dataset.note || "";
    if (q && !o.textContent.toLowerCase().includes(q) && !o.value.toLowerCase().includes(q) && !note.toLowerCase().includes(q)) return;
    any = true;
    const lic = o.dataset.lic ? ` ${licBadge(CCA.SPEC, o.dataset.lic)}` : "";
    parts.push(`<div class="o${o.value === select.value ? " cur" : ""}${note ? " hasnote" : ""}" data-v="${esc(o.value)}" title="${esc(o.textContent)}${note ? ` — ${esc(note)}` : ""}">${esc(o.textContent)}${lic}${note ? `<span class="nt">${esc(note)}</span>` : ""}</div>`);
  };
  for (const c of select.children) {
    if (c.tagName === "OPTGROUP") {
      const before = parts.length;
      for (const o of c.children) addOpt(o);
      if (parts.length > before) parts.splice(before, 0, `<div class="g">${esc(c.label)}</div>`);
    } else addOpt(c);
  }
  const list = pop.querySelector(".list");
  list.innerHTML = any ? parts.join("") : '<div class="none">一致するものがありません</div>';
  const items = [...list.querySelectorAll(".o")];
  const cur = items.find((x) => x.classList.contains("cur")) || items[0];
  cur?.classList.add("on");
  scrollToItem(list, cur);
  for (const it of items) it.onmousedown = (e) => { e.preventDefault(); choosePop(it.dataset.v); };
}
function choosePop(value) {
  const select = pop._select;
  closePop();
  if (!select) return;
  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  select.focus();
}
// 生成パネル・フォルダ設定の <select> を開いたときに絞り込み付きの一覧を出す。
// 開く・閉じるは必ずこの 1 か所で決める(一覧の外をクリックしたら閉じる)
const popIsOpen = () => !!pop?.classList.contains("open");
document.addEventListener("mousedown", (e) => {
  if (popIsOpen() && pop.contains(e.target)) return; // 一覧の中の操作
  const sel = e.target?.closest?.("#cca-ui select, #cca-dirs select, #cca-guide select");
  if (sel && e.button === 0 && !sel.disabled) {
    e.preventDefault();
    if (popIsOpen() && pop._select === sel) closePop(); // 同じものをもう一度押したら閉じる
    else openPop(sel);
    return;
  }
  if (popIsOpen()) closePop();
}, true);
// 列をスクロールして選択欄の位置が動いたら閉じる(位置がずれるため)。
// 開いた直後に届くスクロール(クリック前のスクロールの通知など)で、動いていないのに閉じないようにする
document.addEventListener("scroll", (e) => {
  if (!popIsOpen() || (e.target instanceof Node && pop.contains(e.target))) return;
  const r = pop._select?.getBoundingClientRect();
  if (!r || Math.abs(r.top - pop._top) > 2 || Math.abs(r.left - pop._left) > 2) closePop();
}, true);
document.addEventListener("keydown", (e) => {
  const sel = e.target?.closest?.("#cca-ui select, #cca-dirs select");
  if (!sel) return;
  if (e.key === "Enter" || e.key === " " || (e.altKey && e.key === "ArrowDown")) {
    e.preventDefault();
    openPop(sel);
  }
}, true);

// ---------------------------------------------------------------- 使い方(読みやすい大きさで表示)
function inlineMd(t) {
  return esc(T(t))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function mdToHtml(md) {
  const lines = String(md || "").split("\n");
  const out = [];
  let i = 0;
  const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { const h = m[1].length + 1; out.push(`<h${h}>${inlineMd(m[2])}</h${h}>`); i++; continue; }
    if (l.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const body = rows.slice(1).filter((r) => !/^[\s|:-]+$/.test(r));
      out.push(`<table><tr>${cells(rows[0]).map((c) => `<th>${inlineMd(c)}</th>`).join("")}</tr>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items = [];
      while (i < lines.length && (/^(- |\d+\. )/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const t = lines[i];
        if (/^\s{2,}\S/.test(t)) items[items.length - 1] += `<br>${inlineMd(t.trim())}`;
        else items.push(inlineMd(t.replace(/^(- |\d+\. )/, "")));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join("")}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||- |\d+\. )/.test(lines[i].trim())) para.push(inlineMd(lines[i++].trim()));
    out.push(`<p>${para.join("<br>")}</p>`);
  }
  return out.join("");
}
function openGuide() {
  let g = document.getElementById("cca-guide");
  const types = Object.keys(CCA.SPEC?.guides?.types || {});
  if (!g) {
    g = document.createElement("div");
    g.id = "cca-guide";
    g.innerHTML = `<div class="box"><div class="hd"><b>使い方</b><select id="cca-guide-sel"></select><span style="flex:1"></span><button id="cca-guide-close">閉じる</button></div><div class="md"></div></div>`;
    document.body.appendChild(g);
    g.addEventListener("click", (e) => { if (e.target === g) g.classList.remove("open"); });
    g.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") g.classList.remove("open"); });
    g.querySelector("#cca-guide-close").onclick = () => g.classList.remove("open");
    g.querySelector("#cca-guide-sel").onchange = (e) => { g.querySelector(".md").innerHTML = mdToHtml(CCA.SPEC.guides.types[e.target.value]); };
  }
  const n = node();
  const ti = n ? CCA.SPEC.types_info[W(n, "model_type").value] : null;
  const base = ti ? (types.includes(ti.base) ? ti.base : ti.family) : types[0];
  const sel = g.querySelector("#cca-guide-sel");
  sel.innerHTML = types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  sel.value = types.includes(base) ? base : types[0];
  g.querySelector(".md").innerHTML = mdToHtml(CCA.SPEC.guides?.types?.[sel.value] || CCA.SPEC.guides?.usage || "");
  g.classList.add("open");
  g.querySelector(".md").scrollTop = 0;
}

// ---------------------------------------------------------------- 言語
// 「自動」は ComfyUI の言語設定に合わせる。名前はその言語での書き方(訳さない)
// 配色: 名前は言語に合わせて訳す
function fillTheme() {
  const sel = document.getElementById("cca-theme"); // 設定の画面に移したので、ページ全体から探す
  if (!sel) return;
  sel.setAttribute("data-no-i18n", "");
  sel.innerHTML = THEMES.map((t) => `<option value="${esc(t.id)}">${esc(T(t.name))}</option>`).join("");
  sel.value = themeChoice();
}
function fillLang() {
  const sel = document.getElementById("cca-lang");
  if (!sel) return;
  const auto = langPacks().find((p) => p.code === curLang())?.name || curLang();
  sel.setAttribute("data-no-i18n", "");
  sel.innerHTML = `<option value="auto">${esc(`${T("自動")} (${auto})`)}</option>`
    + langPacks().map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join("");
  sel.value = langChoice();
}
onLangChange(() => { if (root) { fillLang(); fillTheme(); helpCache.clear(); refresh(); } });

// ---------------------------------------------------------------- open / close
export async function open() {
  try { await ensureLoaded(); } catch (e) { console.error(e); }
  try { await recheckLang(); } catch (e) { console.warn(e); }
  if (!root) build();
  history = lsGet(LS_HISTORY, []);
  renderHistory();
  if (history[0] && !current) show(history[0]);
  root.classList.add("open");
  refresh();
}
export function close() {
  root?.classList.remove("open");
}
function toggle() {
  if (root?.classList.contains("open")) close();
  else open();
}

CCA.openUI = () => open();
CCA.listeners.add((n, what) => {
  if (!root?.classList.contains("open") || busy) return;
  if (["model_type", "task", "wired", "configured"].includes(what)) refresh();
  else refreshLight();
});

await i18nReady; // 上部のボタン・コマンドの名前も言語パックで
app.registerExtension({
  name: "cca.generator.ui",
  actionBarButtons: [{
    icon: "icon-[lucide--sliders-horizontal]",
    label: T("CCA 生成パネル"),
    tooltip: T("CCA Generator の生成パネルを開く/閉じる"),
    onClick: () => toggle(),
  }],
  commands: [{ id: "CCA.Generator.TogglePanel", label: T("CCA 生成パネルを開く/閉じる"), function: () => toggle() }],
  async setup() {
    api.addEventListener("progress", onProgress);
    api.addEventListener("executing", onExecuting);
    api.addEventListener("executed", onExecuted);
    api.addEventListener("execution_error", onError);
    api.addEventListener("status", onStatus);
    api.addEventListener("execution_success", onSuccess);
    api.addEventListener("b_preview", onPreview);
    api.addEventListener("execution_interrupted", () => { running = false; setStatus("中断しました"); });
    api.addEventListener("execution_start", () => { if (root) { showError(""); resetProgress(); $("#cca-bar").style.width = "0"; setStatus("開始…"); } });
    resumeTileJobs(UICTX); // ページを開き直しても、まとめる途中だったタイルの続きをする
  },
  async afterConfigureGraph() {
    if (!app.graph?.extra?.ccaGenerator || !lsGet(LS_AUTOOPEN, true)) {
      if (root?.classList.contains("open")) setTimeout(refresh, 300);
      return;
    }
    setTimeout(() => open(), 400);
  },
});
emit(null, "ui-ready");

// モデルフォルダの件数の内訳(直下・サブフォルダ・数えなかったファイル)
function dirSub(p) {
  if (p.count === undefined || p.direct === undefined) return "";
  const parts = [T("直下 {0} 個 + サブフォルダ {1} 個", p.direct, p.count - p.direct)];
  if (p.kinds?.length === 1) parts.push(T("使われる所: {0}だけ", T(p.kinds[0] === "checkpoints" ? "チェックポイント" : "拡散モデル")));
  if (p.skipped?.length) parts.push(T("モデルとして数えないファイル: {0}", p.skipped.map(([e, c]) => `${e || T("(拡張子なし)")} ${c}`).join("・")));
  return `<div style="color:#9fb0c2;font-size:11.5px;margin:-2px 0 4px 6px;word-break:break-all">${esc(parts.join(" / "))}</div>`;
}
