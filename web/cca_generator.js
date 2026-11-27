// CCA Generator Panel(ノード側)
// - 種別/タスクに応じた項目の表示切替と日本語ラベル
// - 種別・タスクを切り替えたときの前回設定の保存・復元(サーバー側 JSON)
// - プロンプトプリセット
// - 入力画像2のアップロードボタンとプレビュー
// - 使わない側の保存ノードのミュート
// 別パネル(cca_ui.js)からも、ここの関数を通してノードを操作する。
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { T, alert, confirm, onLangChange, prompt, ready as i18nReady, watch } from "./cca_i18n.js";
import { startTheme } from "./cca_theme.js";

startTheme(); // 配色(パネル・編集画面の色を選んだ配色に置き換える)

export const NODE = "CCAGeneratorPanel";
export const NONE = "(none)";
const PRESET_NEW = "(プリセットを選択)";

export const CCA = {
  SPEC: null,
  STORE: null,
  listeners: new Set(),
  openUI: null, // cca_ui.js が設定する
};

// ---------------------------------------------------------------- server
async function getJSON(path) {
  const r = await api.fetchApi(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
export async function postJSON(path, body) {
  const r = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || `${path}: ${r.status}`);
  return data;
}
let loading = null;
export function ensureLoaded(force = false) {
  if (force || !loading) {
    loading = (async () => {
      await i18nReady;
      CCA.SPEC = await getJSON("/cca_generator/spec");
      CCA.STORE = await getJSON("/cca_generator/state");
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}
export function emit(node, what = "change") {
  for (const fn of CCA.listeners) {
    try { fn(node, what); } catch (e) { console.warn("[CCA Generator]", e); }
  }
}

// ---------------------------------------------------------------- widgets
export function W(node, name) {
  return node?.widgets?.find((w) => w.name === name);
}
// 新しいフロントエンドは widget.hidden を getter/setter で持ち、表示を自前で管理する。
// type に "hidden" を含めると「旧式の非表示」と判定されて二度と表示できなくなるため、type は触らない。
function hasVisibilityApi(w) {
  for (let o = w; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, "hidden");
    if (d) return typeof d.set === "function";
  }
  return false;
}
export function setHidden(w, hidden) {
  if (!w) return;
  if (hasVisibilityApi(w)) {
    w.hidden = hidden;
    if (w.options) w.options.hidden = hidden;
  } else {
    if (w._ccaOrig === undefined) w._ccaOrig = { type: w.type, computeSize: w.computeSize };
    w.hidden = hidden;
    if (hidden) {
      w.type = "cca_off";
      w.computeSize = () => [0, -4];
    } else {
      w.type = w._ccaOrig.type;
      w.computeSize = w._ccaOrig.computeSize;
    }
  }
  if (w.element) w.element.style.display = hidden ? "none" : "";
}
// 入力画像の欄(1〜10。FLUX.3 Klein は 10 枚まで)
export const IMG_KEYS = ["image", ...Array.from({ length: 9 }, (_, i) => `image_${i + 2}`)];
function isFileKey(name) {
  return !!(CCA.SPEC?.list_keys || CCA.SPEC?.file_keys)?.[name] || IMG_KEYS.includes(name);
}
// 値を入れる(コールバックは呼ばない)。ファイル項目は一覧に無くてもそのまま入れる(何が足りないか分かるように)
export function setValue(node, name, value) {
  const w = W(node, name);
  if (!w || value === undefined || value === null) return;
  const values = w.options?.values;
  if (Array.isArray(values) && !values.includes(value) && !isFileKey(name)) {
    value = values.includes(NONE) ? NONE : values[0];
  }
  w.value = value;
}
// 値を入れてコールバックも呼ぶ(UI から操作したのと同じ扱い)
export async function setWidget(node, name, value) {
  const w = W(node, name);
  if (!w) return;
  w.value = value;
  if (w.callback) await w.callback(value, app.canvas, node);
  node.setDirtyCanvas?.(true, true);
}
// その種別だけ別の選択肢にする欄(SenseNova のモデル・TRELLIS.2 の画像エンコーダーなど)の選択肢。無ければ null
export const typeList = (node, name) => CCA.SPEC?.types_info?.[W(node, "model_type")?.value]?.lists?.[name] || null;
// 欄のファイルの種類(入れる場所の案内に使う)。種別で一覧が変わる欄は、その一覧の種類
export function listKindOf(node, name) {
  const ln = CCA.SPEC?.types_info?.[W(node, "model_type")?.value]?.list_names?.[name] || (CCA.SPEC?.list_keys || CCA.SPEC?.file_keys)?.[name];
  return CCA.SPEC?.list_kind?.[ln];
}
export function isMissingFile(node, name) {
  const w = W(node, name);
  const v = w?.value;
  const vals = typeList(node, name) || w?.options?.values;
  return !!(w && isFileKey(name) && v && v !== NONE && Array.isArray(vals)
    && !vals.includes(v) && !/\[(input|output|temp)\]$/.test(v));
}
function resize(node) {
  const sz = node.computeSize();
  node.setSize([Math.max(node.size[0], sz[0]), sz[1]]);
  node.setDirtyCanvas(true, true);
}

// ---------------------------------------------------------------- images
export function parseImageValue(value) {
  let v = String(value || "");
  let type = "input";
  const m = v.match(/^(.*?)\s*\[(input|output|temp)\]$/);
  if (m) { v = m[1]; type = m[2]; }
  const i = v.lastIndexOf("/");
  return { filename: i >= 0 ? v.slice(i + 1) : v, subfolder: i >= 0 ? v.slice(0, i) : "", type };
}
export function imageUrl(value) {
  if (!value || value === NONE) return "";
  const p = parseImageValue(value);
  const q = new URLSearchParams({ filename: p.filename, subfolder: p.subfolder, type: p.type });
  return api.apiURL(`/view?${q}`);
}
// 入れた画像・動画を、生成パネルの保存先(画像は「画像の保存先」、動画・音声は「動画の保存先」のフォルダ)に保存し、
// コンボに入れる値(「フォルダ/名前 [output]」)を返す。input フォルダは使わない
// こちらの編集画面(画像編集・動画編集・画像の合成・マスクを描く・一覧の小窓)を開いている間は、ComfyUI 本体の
// ワークフローの「元に戻す / やり直す」(Ctrl+Z / Ctrl+Y)を動かさない。本体はキー入力を先に受け、マスクエディターを
// 開いているときだけ止めるので、同じ扱いにしてもらう(本体の作りが違う版では何もしない)
const CCA_OVERLAYS = "#cca-imged.open, #cca-vedit.open, #cca-comp.open, #cca-mask.open, #cca-hbox.open, #cca-wm.open, #cca-vpick.open, #cca-pdfpick.open, #cca-gfont.open";
export function guardComfyKeys() {
  try {
    const C = app?.constructor;
    if (!C || !("maskeditor_is_opended" in C)) return false;
    const cur = C.maskeditor_is_opended;
    if (cur && cur.__cca) return true;
    const prev = typeof cur === "function" ? cur : null;
    const f = () => !!document.querySelector(CCA_OVERLAYS) || !!(prev && prev());
    f.__cca = true;
    C.maskeditor_is_opended = f;
    return true;
  } catch { return false; }
}
export function savePrefix(kind = "image") {
  const n = panels()[0];
  const w = n && W(n, kind === "video" ? "video_output_prefix" : "image_output_prefix");
  return w?.value ?? "";
}
export async function uploadImage(file, subfolder = "") {
  const body = new FormData();
  body.append("file", file, file.name || "image.png");
  const isVideo = /^(video|audio)\//.test(file.type || "") || /\.(mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(file.name || "");
  body.append("prefix", savePrefix(isVideo ? "video" : "image"));
  if (subfolder) body.append("sub", subfolder);
  const r = await api.fetchApi("/cca_generator/upload", { method: "POST", body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || T("挿入できませんでした ({0})", r.status));
  const value = d.value;
  if (!isVideo) for (const node of panels()) {
    for (const name of IMG_KEYS) {
      const w = W(node, name);
      if (w?.options?.values && !w.options.values.includes(value)) w.options.values.push(value);
    }
  }
  return value;
}
function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

// ---------------------------------------------------------------- LoRA list
export function parseLoras(value) {
  let items = [];
  try { items = JSON.parse(value || "[]"); } catch { items = []; }
  if (!Array.isArray(items)) items = [];
  return items.filter((x) => x && typeof x === "object").map((x) => ({
    name: x.name || NONE,
    strength: Number.isFinite(Number(x.strength)) ? Number(x.strength) : 1,
    clip: Number.isFinite(Number(x.clip)) ? Number(x.clip) : (Number.isFinite(Number(x.strength)) ? Number(x.strength) : 1),
    target: ["both", "high", "low"].includes(x.target) ? x.target : "both",
    on: x.on !== false,
  }));
}
export function loraFiles(node) {
  return (W(node, "turbo_lora_name")?.options?.values || [NONE]).filter((v) => v !== NONE);
}
export async function setLoras(node, list) {
  await setWidget(node, "loras", JSON.stringify(list));
  renderLoraWidget(node);
}
function loraMode(node) {
  const loader = CCA.SPEC.types_info[W(node, "model_type").value]?.loader;
  return { clip: loader === "ckpt", target: loader === "wan14" };
}
function addLoraWidget(node) {
  const anchor = W(node, "loras");
  if (!anchor || !node.addDOMWidget) return;
  const box = document.createElement("div");
  box.className = "cca-lora-box";
  watch(box); // 言語パックで訳す
  box.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:4px 6px;box-sizing:border-box;width:100%;font:12px sans-serif;color:#ddd";
  const w = node.addDOMWidget("cca_loras", "cca_loras", box, {
    serialize: false, hideOnZoom: false,
    getMinHeight: () => 34 + 28 * Math.max(1, parseLoras(W(node, "loras")?.value).length),
  });
  w.serialize = false;
  node.widgets.splice(node.widgets.indexOf(w), 1);
  node.widgets.splice(node.widgets.indexOf(anchor) + 1, 0, w);
  node._ccaLoraBox = box;
  renderLoraWidget(node);
}
function renderLoraWidget(node, force = false) {
  const box = node._ccaLoraBox;
  if (!box || !CCA.SPEC) return;
  const list = parseLoras(W(node, "loras")?.value);
  const files = loraFiles(node);
  const mode = loraMode(node);
  const key = JSON.stringify([list, files, mode]);
  if (!force && box._ccaKey === key) return; // 値が同じなら作り直さない(押したボタンが消えないように)
  box._ccaKey = key;
  const css = "background:#111;color:#ddd;border:1px solid #555;border-radius:4px;padding:1px 3px;font:12px sans-serif;min-width:0";
  box.innerHTML = "";
  const head = document.createElement("div");
  head.textContent = list.length ? "LoRA(チェックを外すと無効)" : "LoRA: なし";
  head.style.color = "#aaa";
  box.append(head);
  list.forEach((l, i) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:4px;align-items:center";
    const on = document.createElement("input");
    on.type = "checkbox"; on.checked = l.on; on.title = "有効/無効";
    const sel = document.createElement("select");
    sel.style.cssText = css + ";flex:1";
    const opts = files.includes(l.name) || l.name === NONE ? files : [l.name, ...files];
    sel.innerHTML = [NONE, ...opts].map((f) => `<option>${f.replace(/[<&>]/g, "")}</option>`).join("");
    sel.value = l.name;
    if (l.name !== NONE && !files.includes(l.name)) { sel.style.borderColor = "#e0a23c"; sel.title = "ファイルが見つかりません"; }
    const st = document.createElement("input");
    st.type = "number"; st.step = "0.05"; st.value = l.strength; st.title = "強度"; st.style.cssText = css + ";width:58px";
    row.append(on, sel, st);
    let ck = null, tg = null;
    if (mode.clip) {
      ck = document.createElement("input");
      ck.type = "number"; ck.step = "0.05"; ck.value = l.clip; ck.title = "CLIP 強度"; ck.style.cssText = css + ";width:58px";
      row.append(ck);
    }
    if (mode.target) {
      tg = document.createElement("select");
      tg.style.cssText = css + ";width:72px";
      tg.innerHTML = '<option value="both">High+Low</option><option value="high">High</option><option value="low">Low</option>';
      tg.value = l.target;
      row.append(tg);
    }
    const del = document.createElement("button");
    del.textContent = "×"; del.title = "この LoRA を外す"; del.style.cssText = "padding:0 6px;cursor:pointer";
    row.append(del);
    const commit = () => {
      const next = parseLoras(W(node, "loras").value);
      if (!next[i]) return;
      next[i] = { ...next[i], on: on.checked, name: sel.value, strength: Number(st.value) || 0,
        clip: ck ? Number(ck.value) || 0 : next[i].clip, target: tg ? tg.value : next[i].target };
      // 強度・チェックだけの変更では作り直さない(ファイルを選び直したときは作り直す)
      if (sel.value === l.name) box._ccaKey = JSON.stringify([parseLoras(JSON.stringify(next)), files, mode]);
      setLoras(node, next);
    };
    for (const el of [on, sel, st, ck, tg]) el?.addEventListener("change", commit);
    del.onclick = () => { const next = parseLoras(W(node, "loras").value); next.splice(i, 1); setLoras(node, next); };
    box.append(row);
  });
  const add = document.createElement("button");
  add.textContent = "+ LoRA を追加";
  add.style.cssText = "align-self:flex-start;padding:2px 10px;cursor:pointer";
  add.onclick = () => setLoras(node, [...parseLoras(W(node, "loras").value), { name: NONE, strength: 1, clip: 1, target: "both", on: true }]);
  box.append(add);
  if (node._ccaWired) resize(node);
}

// ---------------------------------------------------------------- model lists / folders
// モデル一覧だけを読み直す(ページ全体は再読み込みしない)
export async function refreshChoices() {
  const c = await getJSON("/cca_generator/choices");
  CCA.SPEC = await getJSON("/cca_generator/spec");
  const lists = { ...(CCA.SPEC.list_keys || CCA.SPEC.file_keys), ...Object.fromEntries(IMG_KEYS.map((k) => [k, "images"])) };
  for (const node of panels()) {
    for (const [name, list] of Object.entries(lists)) {
      const w = W(node, name);
      if (w?.options && Array.isArray(c[list])) w.options.values = [...c[list]];
    }
    for (const [name, list] of [["clip_type", "clip_types"], ["clip_device", "clip_devices"], ["unet_dtype", "dtypes"]]) {
      const w = W(node, name);
      if (w?.options && Array.isArray(c[list])) w.options.values = [...c[list]];
    }
    refreshVisibility(node);
    emit(node, "choices");
  }
  return c;
}
export async function fileHelp(kind, name) {
  return getJSON(`/cca_generator/file_help?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name || "")}`);
}
// 選んだファイルが壊れていないか {found, broken, size, need, better, path}
export async function fileCheck(kind, name) {
  return getJSON(`/cca_generator/file_check?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name || "")}`);
}
export async function openFolder(path, keep = false) { // keep: リンクの先ではなく、そのパスのまま開く
  return postJSON("/cca_generator/open_folder", { path, keep });
}
export async function modelDirs(action, kind, path) {
  if (!action) return getJSON("/cca_generator/model_dirs");
  return postJSON("/cca_generator/model_dirs", { action, kind, path });
}
// 画像・動画を読み込む場所(設定の中)
export async function mediaDirs(action, kind, path) {
  if (!action) return getJSON("/cca_generator/media_dirs");
  return postJSON("/cca_generator/media_dirs", { action, kind, path });
}
// フォルダを選ぶ画面を開く(選んだパス。取り消しは空)
export async function pickFolder(initial, title) {
  return postJSON("/cca_generator/pick_folder", { initial: initial || "", title: title || "" });
}

// ---------------------------------------------------------------- state
export function keysOf(mt) {
  return CCA.SPEC.keys[mt] || { type: [], task: [] };
}
function pick(node, keys) {
  const o = {};
  for (const k of keys) {
    const w = W(node, k);
    if (w) o[k] = w.value;
  }
  return o;
}
function storedType(mt) {
  const keys = keysOf(mt).type;
  const v = { ...(CCA.SPEC.defaults[mt]?.type || {}), ...(CCA.STORE.state.types?.[mt] || {}) };
  return Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));
}
function storedTask(mt, task) {
  const keys = keysOf(mt).task;
  const v = {
    ...(CCA.SPEC.defaults[mt]?.tasks?.[task] || {}),
    ...(CCA.STORE.state.tasks?.[`${mt}::${task}`] || {}),
  };
  return Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));
}
export async function saveCurrent(node, mt, task) {
  if (!mt || !task || !CCA.SPEC.keys[mt]) return;
  const payload = {
    model_type: mt, task,
    type_values: pick(node, keysOf(mt).type),
    task_values: pick(node, keysOf(mt).task),
  };
  const st = CCA.STORE.state;
  st.types[mt] = payload.type_values;
  st.tasks[`${mt}::${task}`] = payload.task_values;
  st.last_task[mt] = task;
  st.last = { model_type: mt, task };
  try {
    await postJSON("/cca_generator/state", payload);
  } catch (e) {
    console.warn("[CCA Generator] 設定の保存に失敗:", e);
  }
}
function applyType(node, mt) {
  for (const [k, v] of Object.entries(storedType(mt))) setValue(node, k, v);
}
function applyTask(node, mt, task) {
  for (const [k, v] of Object.entries(storedTask(mt, task))) setValue(node, k, v);
}
// 現在の種別を既定値に戻す(保存済みの前回設定も消す)
export async function resetToDefaults(node) {
  const mt = W(node, "model_type").value;
  const task = W(node, "task").value;
  try { await postJSON("/cca_generator/state/reset", { model_type: mt }); } catch (e) { console.warn(e); }
  delete CCA.STORE.state.types[mt];
  for (const k of Object.keys(CCA.STORE.state.tasks)) if (k.startsWith(mt + "::")) delete CCA.STORE.state.tasks[k];
  applyType(node, mt);
  applyTask(node, mt, task);
  await saveCurrent(node, mt, task);
  refreshVisibility(node);
  emit(node);
}

// ---------------------------------------------------------------- UI refresh
function refreshTaskOptions(node) {
  const mt = W(node, "model_type").value;
  const tw = W(node, "task");
  const tasks = CCA.SPEC.types_info[mt]?.tasks || [];
  tw.options.values = tasks;
  if (!tasks.includes(tw.value)) {
    const last = CCA.STORE.state.last_task?.[mt];
    tw.value = last && tasks.includes(last) ? last : tasks[0];
  }
}
export function currentKey(node) {
  return `${W(node, "model_type")?.value}::${W(node, "task")?.value}`;
}
export function visibleSet(node) {
  return new Set(CCA.SPEC.visible[currentKey(node)] || []);
}
function applyLabels(node) {
  const roles = CCA.SPEC.image_roles[currentKey(node)] || ["", ""];
  for (const w of node.widgets || []) {
    const label = CCA.SPEC.labels[w.name];
    if (label) w.label = T(label);
  }
  const names = CCA.SPEC.image_names?.[currentKey(node)] || ["入力画像1", "入力画像2"];
  IMG_KEYS.forEach((k, i) => {
    const w = W(node, k);
    if (!w) return;
    const nm = T(names[i] || T("入力画像{0}", i + 1));
    w.label = i === 0 ? `${nm}${roles[0] ? `: ${T(roles[0])}` : ""}` : `${nm}${roles[i] ? `: ${T(roles[i])}` : T(" (任意)")}`;
  });
  relabelFixed(node);
}
function relabelFixed(node) {
  for (const w of node.widgets || []) if (w._ccaLabel) w.label = T(...w._ccaLabel);
}
// 言語を切り替えたとき: ノードの上の表示を付け直す
onLangChange(() => {
  for (const n of panels()) {
    if (!n._ccaWired) continue;
    applyLabels(n);
    renderLoraWidget(n, true);
    for (let k = 2; k <= IMG_KEYS.length; k++) updatePreviewN(n, k);
    n.setDirtyCanvas?.(true, true);
  }
});
export function refreshVisibility(node) {
  const visible = visibleSet(node);
  for (const name of CCA.SPEC.widgets) setHidden(W(node, name), !visible.has(name));
  setHidden(W(node, "control_after_generate"), !visible.has("seed"));
  for (const w of node.widgets || []) {
    if (w.name === "upload" || w.name === "$$canvas-image-preview") setHidden(w, !visible.has("image"));
  }
  for (let k = 2; k <= IMG_KEYS.length; k++) {
    setHidden(W(node, `cca_upload_${k}`), !visible.has(`image_${k}`));
    setHidden(W(node, `cca_preview_${k}`), !visible.has(`image_${k}`));
  }
  setHidden(W(node, "loras"), true); // 生の JSON は隠して、表形式の欄を出す
  setHidden(W(node, "layout_boxes"), true); // 枠の JSON は生成パネルの「枠で配置を指定する」で編集する
  setHidden(W(node, "audio_opts"), true); // 第42版: 音楽・音声の設定(JSON)は生成パネルの「音楽・音声の設定」で編集する
  setHidden(W(node, "cca_loras"), !visible.has("loras"));
  renderLoraWidget(node);
  applyLabels(node);
  refreshPresetCombo(node);
  for (let k = 2; k <= IMG_KEYS.length; k++) updatePreviewN(node, k);
  updateSaveNodes(node, CCA.SPEC.types_info[W(node, "model_type").value]?.kind);
  resize(node);
}

// 使わない側の保存ノードをミュートする(画像生成時に空の動画、動画生成時に空の画像を保存しないため)
function linkedTargets(node, outName) {
  const g = node.graph;
  const out = node.outputs?.find((o) => o.name === outName);
  if (!g || !out) return [];
  const res = [];
  for (const id of out.links || []) {
    const l = g.links?.get ? g.links.get(id) : g.links?.[id];
    const t = l && g.getNodeById(l.target_id);
    if (t) res.push(t);
  }
  return res;
}
export function saveNodeIds(node) {
  return {
    image: linkedTargets(node, "image_prefix").map((n) => String(n.id)),
    video: linkedTargets(node, "video_prefix").map((n) => String(n.id)),
  };
}
function updateSaveNodes(node, kind) {
  if (!kind) return;
  const MUTE = 2;
  let changed = false;
  for (const [outName, active] of [["image_prefix", kind === "image"], ["video_prefix", kind === "video"]]) {
    for (const t of linkedTargets(node, outName)) {
      if (active && t.mode === MUTE) { t.mode = 0; changed = true; }
      if (!active && t.mode === 0) { t.mode = MUTE; changed = true; }
    }
  }
  if (changed) node.graph?.setDirtyCanvas?.(true, true);
}

// ---------------------------------------------------------------- image 2 / image 3
function addImageNWidgets(node, k) {
  const name = `image_${k}`;
  const after = W(node, name);
  if (!after) return;
  const up = node.addWidget("button", `cca_upload_${k}`, null, async () => {
    const file = await pickFile();
    if (!file) return;
    try {
      const value = await uploadImage(file);
      await setWidget(node, name, value);
    } catch (e) {
      alert(e.message);
    }
  });
  up.label = T("入力画像{0}に挿入", k);
  up._ccaLabel = ["入力画像{0}に挿入", k];
  up.serialize = false;

  const box = document.createElement("div");
  watch(box); // 言語パックで訳す
  box.style.cssText = "display:flex;gap:8px;align-items:center;padding:4px 6px;box-sizing:border-box;"
    + "width:100%;height:100%;overflow:hidden;font:12px sans-serif;color:#ccc";
  const img = document.createElement("img");
  img.style.cssText = "max-width:45%;max-height:100%;object-fit:contain;border:1px solid #555;border-radius:4px;background:#111";
  const side = document.createElement("div");
  side.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0";
  const cap = document.createElement("div");
  cap.style.cssText = "white-space:normal;word-break:break-all";
  const clear = document.createElement("button");
  clear.textContent = `画像${k}を外す`;
  clear.style.cssText = "align-self:flex-start;padding:2px 8px;cursor:pointer";
  clear.onclick = () => setWidget(node, name, NONE);
  side.append(cap, clear);
  box.append(img, side);
  let preview = null;
  if (node.addDOMWidget) {
    preview = node.addDOMWidget(`cca_preview_${k}`, "cca_preview", box, {
      serialize: false, hideOnZoom: false, getMinHeight: () => 110, getMaxHeight: () => 110,
    });
  }
  if (preview) preview.serialize = false; // ワークフローに保存しない(保存値の並びを崩さない)
  node._ccaPreviews = { ...(node._ccaPreviews || {}), [k]: { img, cap, clear, widget: preview } };

  // image_N の直後に並べる
  for (const w of [preview, up]) {
    if (!w) continue;
    node.widgets.splice(node.widgets.indexOf(w), 1);
    node.widgets.splice(node.widgets.indexOf(after) + 1, 0, w);
  }
}
function updatePreviewN(node, k) {
  const p = node._ccaPreviews?.[k];
  if (!p) return;
  const v = W(node, `image_${k}`)?.value;
  const on = v && v !== NONE;
  p.img.style.display = on ? "" : "none";
  if (on) p.img.src = imageUrl(v);
  p.cap.textContent = on ? `入力画像${k}: ${v}` : `入力画像${k}: 未選択(使う場合だけ挿入/選択)`;
  p.clear.style.display = on ? "" : "none";
}

// ---------------------------------------------------------------- presets
// おすすめ(★・この種別とタスク向け・読み取り専用)と、保存したプリセット。
// 選んだだけでは変わらない。「追加」でプロンプトの末尾に足す(何か書いてあれば改行してから)
export const BUILTIN_MARK = "★ ";
// 第42版: 声・音楽の種別では、画像・動画とは別のプリセット(audio_presets.json)を使う
export const presetGroup = (node) => (node && CCA.SPEC?.types_info?.[W(node, "model_type")?.value]?.kind === "audio" ? "audio" : "");
const presetStore = (group) => (group === "audio" ? (CCA.STORE.audio_presets ||= {}) : (CCA.STORE.presets ||= {}));
export function presetNames(group = "") {
  return Object.keys(presetStore(group)).sort((a, b) => a.localeCompare(b, "ja"));
}
// おすすめ(★)は「削除」で一覧から消せる(サーバーの prompt_presets_hidden.json に記録。元に戻せる)
function builtinScope(node) {
  const mt = W(node, "model_type")?.value;
  return { base: CCA.SPEC.types_info?.[mt]?.base || mt, task: W(node, "task")?.value };
}
function builtinId(node, name) {
  const { base, task } = builtinScope(node);
  return `${base}|${task}|${name}`;
}
export function hiddenCount(node) {
  if (!node) return 0;
  const { base, task } = builtinScope(node);
  return (CCA.STORE.hidden || []).filter((x) => x.startsWith(`${base}|${task}|`)).length;
}
export async function hidePreset(node, p) {
  const id = builtinId(node, p.name);
  await postJSON("/cca_generator/preset/hide", { id });
  CCA.STORE.hidden = [...(CCA.STORE.hidden || []).filter((x) => x !== id), id];
  for (const n of panels()) refreshPresetCombo(n, PRESET_NEW);
}
export async function restoreHidden(node) {
  const { base, task } = builtinScope(node);
  const r = await postJSON("/cca_generator/preset/unhide", { base, task });
  CCA.STORE.hidden = (CCA.STORE.hidden || []).filter((x) => !x.startsWith(`${base}|${task}|`));
  for (const n of panels()) refreshPresetCombo(n, PRESET_NEW);
  return r.restored || 0;
}
export function presetEntries(node) {
  const hidden = new Set(CCA.STORE.hidden || []);
  const builtin = node ? (CCA.SPEC.builtin_presets?.[currentKey(node)] || [])
    .filter((p) => !hidden.has(builtinId(node, p.name)))
    .map((p) => ({ ...p, id: BUILTIN_MARK + p.name, builtin: true })) : [];
  const group = presetGroup(node), ps = presetStore(group);
  const user = presetNames(group).map((n) => ({ ...ps[n], name: n, id: n, builtin: false }));
  return [...user, ...builtin]; // 自分で保存したものが上、おすすめ(★)が下
}
export function findPreset(node, id) {
  return presetEntries(node).find((p) => p.id === id) || null;
}
function joinText(cur, add) {
  cur = String(cur || "");
  add = String(add || "").trim();
  if (!add) return cur;
  if (!cur.trim()) return add;
  if (cur.includes(add)) return cur; // 同じ文が既にあれば足さない
  return `${cur.replace(/\n+$/, "")}\n${add}`;
}
export async function appendPreset(node, id) {
  const p = findPreset(node, id);
  if (!p) return false;
  await setWidget(node, "positive", joinText(W(node, "positive").value, p.positive));
  if (p.negative) await setWidget(node, "negative", joinText(W(node, "negative").value, p.negative));
  return true;
}
function refreshPresetCombo(node, select) {
  const w = node._ccaPreset;
  if (!w) return;
  const ids = presetEntries(node).map((p) => p.id);
  w.options.values = [PRESET_NEW, ...ids];
  const want = select ?? w.value;
  w.value = want && ids.includes(want) ? want : PRESET_NEW;
}
export async function savePreset(name, positive, negative, group = "") {
  const res = await postJSON("/cca_generator/preset", { name, positive, negative, group });
  presetStore(group)[res.name] = { positive, negative };
  for (const n of panels()) refreshPresetCombo(n, res.name);
  return res.name;
}
export async function deletePreset(name, group = "") {
  await postJSON("/cca_generator/preset/delete", { name, group });
  delete presetStore(group)[name];
  for (const n of panels()) refreshPresetCombo(n, PRESET_NEW);
}
function addPresetWidgets(node) {
  const after = W(node, "negative") || W(node, "positive");
  const combo = node.addWidget("combo", "prompt_preset", PRESET_NEW, () => {}, { values: [PRESET_NEW], serialize: false });
  combo.label = T("プロンプトのプリセット(★=おすすめ)");
  combo._ccaLabel = ["プロンプトのプリセット(★=おすすめ)"];
  combo.serialize = false;

  const addBtn = node.addWidget("button", "cca_preset_add", null, async () => {
    if (!combo.value || combo.value === PRESET_NEW) return;
    await appendPreset(node, combo.value);
    emit(node, "positive");
  });
  addBtn.label = T("↓ 選んだプリセットをプロンプトの末尾に追加");
  addBtn._ccaLabel = ["↓ 選んだプリセットをプロンプトの末尾に追加"];
  addBtn.serialize = false;

  const saveBtn = node.addWidget("button", "cca_preset_save", null, async () => {
    const cur = combo.value !== PRESET_NEW && !combo.value.startsWith(BUILTIN_MARK) ? combo.value : "";
    const name = prompt("プリセット名(同じ名前は上書き)", cur);
    if (!name) return;
    try {
      await savePreset(name, W(node, "positive").value, W(node, "negative").value, presetGroup(node));
    } catch (e) {
      alert(`保存に失敗しました: ${e.message}`);
    }
  });
  saveBtn.label = T("今のプロンプトをプリセットに保存");
  saveBtn._ccaLabel = ["今のプロンプトをプリセットに保存"];
  saveBtn.serialize = false;

  const delBtn = node.addWidget("button", "cca_preset_delete", null, async () => {
    const p = findPreset(node, combo.value);
    if (!p) return;
    if (p.builtin) {
      if (!confirm(`おすすめプリセット「${p.name}」を一覧から消しますか?(生成パネルで元に戻せます)`)) return;
    } else if (!confirm(`プリセット「${p.name}」を削除しますか?`)) return;
    try {
      if (p.builtin) await hidePreset(node, p);
      else await deletePreset(p.name, presetGroup(node));
    } catch (e) {
      alert(`削除に失敗しました: ${e.message}`);
    }
  });
  delBtn.label = T("選択中のプリセットを削除");
  delBtn._ccaLabel = ["選択中のプリセットを削除"];
  delBtn.serialize = false;

  for (const w of [delBtn, saveBtn, addBtn, combo]) {
    node.widgets.splice(node.widgets.indexOf(w), 1);
    node.widgets.splice(node.widgets.indexOf(after) + 1, 0, w);
  }
  node._ccaPreset = combo;
  refreshPresetCombo(node);
}
function addOpenButton(node) {
  const btn = node.addWidget("button", "cca_open_ui", null, () => CCA.openUI?.(node));
  btn.label = T("▶ 生成パネルを開く");
  btn._ccaLabel = ["▶ 生成パネルを開く"];
  btn.serialize = false;
  const rb = node.addWidget("button", "cca_refresh", null, async () => {
    try { await refreshChoices(); } catch (e) { alert(`モデル一覧を読み込めませんでした: ${e.message}`); }
  });
  rb.label = T("🔄 モデル一覧を読み直す");
  rb._ccaLabel = ["🔄 モデル一覧を読み直す"];
  rb.serialize = false;
  for (const w of [rb, btn]) {
    node.widgets.splice(node.widgets.indexOf(w), 1);
    node.widgets.splice(0, 0, w);
  }
}

// ---------------------------------------------------------------- setup
export function panels(graph = app.graph) {
  return (graph?._nodes || graph?.nodes || []).filter((n) => n.type === NODE || n.comfyClass === NODE);
}
export function findPanel() {
  return panels().find((n) => n._ccaWired) || panels()[0] || null;
}

// 最後に使った種別・タスクとその保存値(無ければ既定値)を反映する
function restoreLastState(node) {
  const mtW = W(node, "model_type");
  const taskW = W(node, "task");
  const last = CCA.STORE.state.last || {};
  if (last.model_type && CCA.SPEC.types.includes(last.model_type)) mtW.value = last.model_type;
  refreshTaskOptions(node);
  if (last.model_type === mtW.value && (CCA.SPEC.types_info[mtW.value]?.tasks || []).includes(last.task)) {
    taskW.value = last.task;
  }
  applyType(node, mtW.value);
  applyTask(node, mtW.value, taskW.value);
  node._ccaPrev = { mt: mtW.value, task: taskW.value };
}

// 選べる一覧から外した種別(MiniMax)のワークフローを開いたときは、同じ画像/動画の最初の種別に切り替える
function fallbackHiddenType(node) {
  const mtW = W(node, "model_type");
  if (!mtW || !CCA.SPEC?.types) return false;
  mtW.options.values = [...CCA.SPEC.types];
  if (CCA.SPEC.types.includes(mtW.value)) return false;
  const kind = CCA.SPEC.types_info?.[mtW.value]?.kind || "image";
  const last = CCA.STORE.state?.last?.model_type;
  const next = (last && CCA.SPEC.types.includes(last) && CCA.SPEC.types_info[last]?.kind === kind) ? last
    : (CCA.SPEC.types.find((t) => CCA.SPEC.types_info[t]?.kind === kind) || CCA.SPEC.types[0]);
  mtW.value = next;
  refreshTaskOptions(node);
  applyType(node, next);
  applyTask(node, next, W(node, "task").value);
  return true;
}

function wire(node, { restoreLast }) {
  const mtW = W(node, "model_type");
  const taskW = W(node, "task");
  if (!mtW || !taskW) return;
  node._ccaWired = true;

  if (restoreLast) restoreLastState(node);
  else refreshTaskOptions(node);
  fallbackHiddenType(node);
  node._ccaPrev = { mt: mtW.value, task: taskW.value };

  const mtCb = mtW.callback;
  mtW.callback = async function () {
    const prev = node._ccaPrev;
    await saveCurrent(node, prev.mt, prev.task); // 切替前の種別を保存
    refreshTaskOptions(node);
    applyType(node, mtW.value); // 切替先の前回設定(無ければ既定値)を復元
    applyTask(node, mtW.value, taskW.value);
    node._ccaPrev = { mt: mtW.value, task: taskW.value };
    refreshVisibility(node);
    await saveCurrent(node, mtW.value, taskW.value);
    emit(node, "model_type");
    return mtCb?.apply(this, arguments);
  };

  const taskCb = taskW.callback;
  taskW.callback = async function () {
    const prev = node._ccaPrev;
    await saveCurrent(node, prev.mt, prev.task);
    applyTask(node, mtW.value, taskW.value);
    node._ccaPrev = { mt: mtW.value, task: taskW.value };
    refreshVisibility(node);
    await saveCurrent(node, mtW.value, taskW.value);
    emit(node, "task");
    return taskCb?.apply(this, arguments);
  };

  // その他の項目は変更から少し待ってまとめて保存
  let timer = null;
  for (const w of node.widgets) {
    if (w === mtW || w === taskW) continue;
    const cb = w.callback;
    w.callback = function () {
      clearTimeout(timer);
      timer = setTimeout(() => saveCurrent(node, node._ccaPrev.mt, node._ccaPrev.task), 600);
      if (/^image_\d+$/.test(w.name)) updatePreviewN(node, Number(w.name.slice(6)));
      if (w.name === "loras") renderLoraWidget(node);
      const r = cb?.apply(this, arguments);
      emit(node, w.name);
      return r;
    };
  }

  addOpenButton(node);
  addPresetWidgets(node);
  for (let k = 2; k <= IMG_KEYS.length; k++) addImageNWidgets(node, k);
  addLoraWidget(node);
  // 入力画像1の標準アップロードボタン(保存値の並びが崩れるため位置は動かさない)
  const up1 = W(node, "upload");
  if (up1) up1._ccaLabel = ["入力画像1に挿入"];
  // 入力画像1のアップロード・ノードへのドラッグ&ドロップ・貼り付けも、input ではなく「画像の保存先」に入れる
  const put1 = async (file) => {
    if (!file || !/^image\//.test(file.type || "image/")) return false;
    try { await setWidget(node, "image", await uploadImage(file)); } catch (e) { alert(e.message); }
    return true;
  };
  if (up1) up1.callback = async () => { const f = await pickFile(); if (f) await put1(f); };
  node.onDragOver = (e) => !!e?.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  node.onDragDrop = async (e) => {
    const f = [...(e?.dataTransfer?.files || [])].find((x) => /^image\//.test(x.type));
    return f ? put1(f) : false;
  };
  node.pasteFile = (file) => { put1(file); };
  node.pasteFiles = (files) => { const f = [...(files || [])].find((x) => /^image\//.test(x.type)); if (f) put1(f); };
  const ctl = W(node, "control_after_generate");
  if (ctl) ctl._ccaLabel = ["生成後のシード"];
  // 選択肢の表示名(値は日本語のまま・表示だけ訳す)
  for (const w of node.widgets || []) {
    if (w.type === "combo" && w.options && !w.options.getOptionLabel) w.options.getOptionLabel = (v) => (v == null ? v : T(String(v)));
  }
  refreshVisibility(node);
  emit(node, "wired");
}

// 保存値を「名前」で入れ直す(項目の増減があっても値がずれないように)。旧版の LoRA 1 枠も一覧に変換する
function restoreByName(node, info) {
  const named = info?.widgets_values_named;
  if (!named || typeof named !== "object") return;
  for (const w of node.widgets || []) {
    if (Object.prototype.hasOwnProperty.call(named, w.name)) w.value = named[w.name];
  }
  if (!("loras" in named) && named.lora_name && named.lora_name !== NONE) {
    const wl = W(node, "loras");
    if (wl) {
      const s = Number(named.lora_strength ?? 1);
      wl.value = JSON.stringify([{ name: named.lora_name, strength: s, clip: Number(named.lora_clip_strength ?? s), target: "both", on: true }]);
    }
  } else if (!("loras" in named)) {
    const wl = W(node, "loras");
    if (wl && !String(wl.value || "").trim().startsWith("[")) wl.value = "[]";
  }
}

app.registerExtension({
  name: "cca.generator",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      // 新規配置時は保存済みの前回設定から開始
      ensureLoaded()
        .then(() => { if (!node._ccaWired) wire(node, { restoreLast: !node._ccaConfigured }); })
        .catch((e) => console.error("[CCA Generator] 初期化に失敗:", e));
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      // ワークフロー読込時はファイル内の値を優先(前回設定で上書きしない)
      // ただし properties.cca_init が true のもの(同梱ワークフローの初回)は前回設定/既定値で埋める
      this._ccaConfigured = true;
      const r = onConfigure?.apply(this, arguments);
      const node = this;
      restoreByName(node, info);
      { const rw = W(node, "resize_mode"); if (rw && rw.value === "今まで通り") rw.value = "画像1のサイズ"; } // 以前のワークフローの値を新しい名前にする
      const init = !!node.properties?.cca_init;
      if (init) delete node.properties.cca_init;
      ensureLoaded()
        .then(() => {
          if (node._ccaWired) {
            if (init) restoreLastState(node);
            else refreshTaskOptions(node);
            fallbackHiddenType(node);
            node._ccaPrev = { mt: W(node, "model_type").value, task: W(node, "task").value };
            refreshVisibility(node);
            emit(node, "configured");
            return;
          }
          wire(node, { restoreLast: init });
        })
        .catch((e) => console.error("[CCA Generator] 初期化に失敗:", e));
      return r;
    };
  },
});
