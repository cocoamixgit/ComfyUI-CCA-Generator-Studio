// 項目(セクション)の折りたたみ(いつでも)と並べ替え(「⇅ 並べ替え」の編集モードのときだけ)。
// 項目は表示名ではなく変わらない id(data-sec)で覚える。版が上がって項目が増えても、決められた並びで前にある項目の
// 後ろに入る(末尾に寄らない)。無くなった項目の id は無視する。保存先: localStorage cca_generator.layout.<name>
import { T } from "./cca_i18n.js";

export const LAYOUT_VERSION = 1;
export const LAYOUT_PREFIX = "cca_generator.layout.";
const reg = new Map(); // name → 部品(書き出し / 読み込みのあとに並べ直す)

function load(name) {
  try {
    const d = JSON.parse(localStorage.getItem(LAYOUT_PREFIX + name) || "null");
    if (d && typeof d === "object") return { order: Array.isArray(d.order) ? d.order.map(String) : [], fold: d.fold && typeof d.fold === "object" ? d.fold : {} };
  } catch { /* 壊れていれば既定の並び */ }
  return { order: [], fold: {} };
}
function save(name, s) {
  try { localStorage.setItem(LAYOUT_PREFIX + name, JSON.stringify({ v: LAYOUT_VERSION, order: s.order, fold: s.fold })); } catch { /* 覚えなくても使える */ }
}
// 覚えた並びと既定の並びを合わせる: 知らない id は捨て、覚えていない(新しい)id は既定の並びで前にある項目の後ろへ
export function mergeOrder(defaults, saved) {
  const known = new Set(defaults);
  const out = [];
  for (const id of saved || []) if (known.has(id) && !out.includes(id)) out.push(id);
  defaults.forEach((id, i) => {
    if (out.includes(id)) return;
    let j = i - 1;
    while (j >= 0 && !out.includes(defaults[j])) j--;
    if (j >= 0) { out.splice(out.indexOf(defaults[j]) + 1, 0, id); return; }
    let k = i + 1;
    while (k < defaults.length && !out.includes(defaults[k])) k++;
    if (k < defaults.length) out.splice(out.indexOf(defaults[k]), 0, id); else out.push(id);
  });
  return out;
}
// 項目の色(縁と背景のグラデーションの 2 色)
export const PALETTE = {
  teal: ["#3dd6a0", "#8a6cff"], blue: ["#4f9bff", "#b06cff"], orange: ["#f0a040", "#ff5c8a"], purple: ["#a07bff", "#4fc3ff"],
  pink: ["#ff6fae", "#ffb347"], yellow: ["#ffd24d", "#6fe0a0"], cyan: ["#3fd0e0", "#7b8cff"], lime: ["#9fd84d", "#3fb8ff"],
  red: ["#ff7070", "#b07bff"], gray: ["#9aa6b8", "#6c7a90"],
};
// sel: 項目の要素(例 "> section")。colors: { data-sec の値: PALETTE の名前 }
export function cardCss(scope, sel, colors = {}, def = "gray") {
  const [d1, d2] = PALETTE[def] || PALETTE.gray;
  return `
${scope} ${sel}{--c1:${d1};--c2:${d2};border:1.5px solid transparent;border-radius:12px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--c1) 13%,#141920),color-mix(in srgb,var(--c2) 10%,#141920)) padding-box,
  linear-gradient(135deg,color-mix(in srgb,var(--c1) 80%,transparent),color-mix(in srgb,var(--c2) 65%,transparent)) border-box}
${scope} ${sel} > .sec-head,${scope} ${sel} > h3,${scope} ${sel} > h4,${scope} ${sel} > summary{color:color-mix(in srgb,var(--c1) 55%,#fff)}
${scope} ${sel} > .sec-head::before{color:var(--c1)}
${Object.entries(colors).map(([id, name]) => { const [a, b] = PALETTE[name] || PALETTE.gray; return `${scope} ${sel}[data-sec="${id}"]{--c1:${a};--c2:${b}}`; }).join("\n")}
`;
}
export const SECTIONS_CSS = (scope) => `
${scope} [data-sec] > .sec-head{cursor:pointer;user-select:none}
${scope} [data-sec] > .sec-head::before{content:"▾";display:inline-block;width:1em;color:#8a94a3;transition:transform .12s}
${scope} [data-sec].sec-folded > .sec-head::before{transform:rotate(-90deg)}
${scope} [data-sec].sec-folded > :not(.sec-head){display:none !important}
${scope} details[data-sec] > summary.sec-head::before{content:none}
${scope} .sec-grip{display:none;cursor:grab;color:#ffd24d;font-style:normal;padding:0 6px 0 0;touch-action:none}
${scope} .sec-editing [data-sec] > .sec-head .sec-grip{display:inline-block}
${scope} .sec-editing [data-sec] > .sec-head{cursor:grab}
${scope} .sec-editing [data-sec]{outline:1px dashed #6b5a1e;outline-offset:2px}
${scope} [data-sec].sec-moving{opacity:.92;box-shadow:0 10px 28px rgba(0,0,0,.55),0 0 0 2px #ffd24d;cursor:grabbing}
${scope} .sec-ph{border:2px dashed #6b5a1e;border-radius:12px;background:rgba(255,210,77,.06);box-sizing:border-box}
${scope} button.sec-edit.on{background:#3a3417;border-color:#ffd24d;color:#ffe9a3}
${scope} button[data-sec-undo],${scope} button[data-sec-reset]{position:relative}
${/cca-imged|cca-vedit/.test(scope) ? "" : `${scope} button[data-sec-undo]::before,${scope} button[data-sec-reset]::before{content:"";position:absolute;left:12px;right:12px;top:4px;height:2px;border-radius:1px;background:var(--text);opacity:.85;pointer-events:none}`}
`;

// 今見えている項目の並び now を、覚えた並び(ほかの種類のときだけ出る項目も含む)に入れる
function keepOthers(saved, now) {
  const others = saved.filter((id) => !now.includes(id));
  if (!others.length) return now;
  // ほかの項目は、覚えていた並びで前にあった項目の後ろに残す
  const out = [...now];
  saved.forEach((id, i) => {
    if (now.includes(id) || out.includes(id)) return;
    let j = i - 1;
    while (j >= 0 && !out.includes(saved[j])) j--;
    if (j >= 0) out.splice(out.indexOf(saved[j]) + 1, 0, id); else out.unshift(id);
  });
  return out;
}
// box: 項目が並んでいる要素(項目は直下の [data-sec])。name: 覚えるときの名前。head: 見出しの要素を返す関数
export function setupSections(box, { name, head = (el) => el.querySelector(":scope > h3, :scope > h4, :scope > summary"), onChange } = {}) {
  const items = () => [...box.querySelectorAll(":scope > [data-sec]")];
  let defaults = items().map((el) => el.dataset.sec);
  let state = load(name);
  let editing = false;
  let justMoved = false;
  const api = { name };
  const prepare = () => {
    for (const el of items()) {
      const h = head(el);
      if (!h || h.classList.contains("sec-head")) continue;
      h.classList.add("sec-head");
      const grip = document.createElement("i");
      grip.className = "sec-grip";
      grip.textContent = "⠿";
      grip.title = T("ドラッグで項目の位置を動かす(見出しをドラッグしても動かせます)");
      h.prepend(grip);
      grip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }); // つまみを押しても開け閉めしない
      // 並べ替えのときは、⠿ でも見出しでもつかめる(見出しは少し動かしたらドラッグ、動かさなければ開け閉め)
      h.addEventListener("pointerdown", (e) => {
        if (!editing || e.button !== 0 || e.target.closest("button, input, select, textarea, a")) return;
        startMove(e, el, e.target.closest(".sec-grip") ? 0 : 5);
      });
      // ドラッグで動かした直後の click では開け閉めしない
      h.addEventListener("click", (e) => { if (justMoved) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
      if (el.tagName === "DETAILS") {
        el.addEventListener("toggle", () => { state.fold[el.dataset.sec] = !el.open; save(name, state); });
      } else {
        h.addEventListener("click", (e) => {
          if (e.target.closest("button, input, select, textarea, label, a, .sec-grip")) return;
          el.classList.toggle("sec-folded");
          state.fold[el.dataset.sec] = el.classList.contains("sec-folded");
          save(name, state);
          onChange?.();
        });
      }
    }
  };
  const apply = () => {
    prepare();
    const els = items();
    if (!els.length) return;
    const byId = new Map(els.map((el) => [el.dataset.sec, el]));
    const defs = defaults.filter((id) => byId.has(id)).concat([...byId.keys()].filter((id) => !defaults.includes(id)));
    const order = mergeOrder(defs, state.order);
    const marker = document.createComment("sec");
    box.insertBefore(marker, els[0]);
    let ref = marker;
    for (const id of order) {
      const el = byId.get(id);
      box.insertBefore(el, ref.nextSibling);
      ref = el;
    }
    marker.remove();
    for (const el of items()) {
      const f = state.fold[el.dataset.sec];
      if (f === undefined) continue;
      if (el.tagName === "DETAILS") el.open = !f; else el.classList.toggle("sec-folded", !!f);
    }
  };
  // 項目をつかんで動かす: 中身ごと持ち上げてカーソルに付いてくる。入る所には同じ高さの空きができ、ほかの項目は上下にすべる
  function startMove(e, el, threshold = 0) {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let moving = false, ph = null, r0 = null;
    // 項目が並んでいる欄のスクロール(端に近づくと自動で動かす)
    let scroller = box;
    while (scroller && scroller !== document.body && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
    if (scroller === document.body) scroller = null;
    let lastY = e.clientY;
    const others = () => items().filter((q) => q !== el && q.offsetParent);
    // 並びを変える前後の位置の差を、すべらせて見せる(FLIP)
    const slide = (fn) => {
      const list = others();
      const before = new Map(list.map((x) => [x, x.getBoundingClientRect().top]));
      fn();
      for (const x of list) {
        const d = before.get(x) - x.getBoundingClientRect().top;
        if (Math.abs(d) < 0.5) continue;
        x.style.transition = "none";
        x.style.transform = `translateY(${d}px)`;
        requestAnimationFrame(() => { x.style.transition = "transform .16s ease"; x.style.transform = ""; });
      }
    };
    const place = (y) => {
      let target = null;
      for (const x of others()) { const r = x.getBoundingClientRect(); if (y < r.top + r.height / 2) { target = x; break; } }
      // 今の空きの次の項目(つかんでいる項目は飛ばす)と同じなら、動かさない
      let nx = ph.nextElementSibling;
      while (nx && (nx === el || !nx.matches("[data-sec]"))) nx = nx.nextElementSibling;
      if ((nx || null) === target) return;
      slide(() => { if (target) box.insertBefore(ph, target); else box.appendChild(ph); });
    };
    const follow = (y) => { el.style.top = `${r0.top + (y - y0)}px`; };
    const begin = () => {
      moving = true;
      r0 = el.getBoundingClientRect();
      ph = document.createElement("div");
      ph.className = "sec-ph";
      ph.style.height = `${r0.height}px`;
      box.insertBefore(ph, el);
      el.classList.add("sec-moving");
      Object.assign(el.style, { position: "fixed", left: `${r0.left}px`, top: `${r0.top}px`, width: `${r0.width}px`, zIndex: 10050, pointerEvents: "none", margin: "0" });
      follow(lastY);
    };
    if (threshold <= 0) begin();
    const timer = setInterval(() => {
      if (!scroller || !moving) return;
      const r = scroller.getBoundingClientRect();
      const d = lastY < r.top + 40 ? -14 : lastY > r.bottom - 40 ? 14 : 0;
      if (d) { scroller.scrollTop += d; place(lastY); }
    }, 30);
    const move = (ev) => {
      lastY = ev.clientY;
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < threshold) return;
      if (!moving) begin();
      follow(lastY);
      place(lastY);
    };
    const up = () => {
      clearInterval(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moving) return; // 動かさなかった: ただのクリック(開け閉め)
      justMoved = true; // この pointerup に続く click だけ止める
      setTimeout(() => { justMoved = false; }, 0);
      // 空きの所に落とす(落ちる所まですべらせる)
      const to = ph.getBoundingClientRect().top, from = el.getBoundingClientRect().top;
      box.insertBefore(el, ph);
      ph.remove();
      el.classList.remove("sec-moving");
      for (const k of ["position", "left", "top", "width", "zIndex", "pointerEvents", "margin"]) el.style[k] = "";
      const d = from - to;
      if (Math.abs(d) > 0.5) {
        el.style.transition = "none";
        el.style.transform = `translateY(${d}px)`;
        requestAnimationFrame(() => { el.style.transition = "transform .16s ease"; el.style.transform = ""; });
      }
      for (const x of others()) { x.style.transition = ""; x.style.transform = ""; }
      const now = items().map((x) => x.dataset.sec);
      state.order = keepOthers(state.order, now);
      save(name, state);
      onChange?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    if (moving) place(lastY);
  }
  api.apply = apply;
  // 中身を作り直したとき(動画編集の右の欄など): 作り直した並びを既定として、覚えた並び・開け閉めを当て直す
  api.rerendered = () => { defaults = items().map((el) => el.dataset.sec); if (editing) box.classList.add("sec-editing"); apply(); };
  api.reload = () => { state = load(name); apply(); };
  api.editing = () => editing;
  let snap = null; // 並べ替えを始めたときの並び(「移動を戻す」で戻す)
  api.setEdit = (on) => { editing = !!on; if (editing) snap = items().map((el) => el.dataset.sec); box.classList.toggle("sec-editing", editing); };
  api.undo = () => { if (!snap) return; state.order = keepOthers(state.order, snap); save(name, state); apply(); onChange?.(); };
  api.reset = () => { state.order = []; save(name, state); apply(); onChange?.(); };
  api.foldAll = (fold) => {
    for (const el of items()) {
      state.fold[el.dataset.sec] = !!fold;
      if (el.tagName === "DETAILS") el.open = !fold; else el.classList.toggle("sec-folded", !!fold);
    }
    save(name, state);
  };
  apply();
  reg.set(name, api);
  return api;
}
// ---------------------------------------------------------------- 生成パネルの配置(上・左・右・下の 4 つの枠)
// 項目(生成ボタン・結果と履歴も含む)を、上・左・右・下の枠(data-area)に入れる。並べ替えのときは空の枠も出て、
// 枠の間でも項目を動かせる。並べ替えを終えると、何も入っていない枠は消える。上と下の枠は項目を横に並べる。
// 覚える形: { v: 2, areas: { top: [id…], left: […], right: […], bottom: […] }, fold }。第1版(order だけ)は左の枠の並びとして読む
export const AREAS = ["top", "topR", "left", "right", "bottom", "bottomR"];
const HZ_AREAS = new Set(); // 項目を横に流して並べる枠(今は無し。上・中央・下とも、縦に並べて、左右の 3 分の 1 に置くと横に並べる)
const GROUP = ":scope > .sec-stack, :scope > .sec-row"; // まとまり: 上と下の枠では縦に積んだ列、左右の枠では横に並べた行
const isGroup = (c) => c.classList.contains("sec-stack") || c.classList.contains("sec-row");
function loadAreas(name) {
  try {
    const d = JSON.parse(localStorage.getItem(LAYOUT_PREFIX + name) || "null");
    if (d && typeof d === "object") {
      const fold = d.fold && typeof d.fold === "object" ? d.fold : {};
      if (d.areas && typeof d.areas === "object") {
        const areas = {};
        const san = (x) => (Array.isArray(x) ? x.map(san) : String(x)); // 行の中の縦の積み(配列の中の配列)もそのまま
        for (const a of AREAS) areas[a] = Array.isArray(d.areas[a]) ? d.areas[a].map(san) : []; // 配列 = 横に並べた行(中の配列 = そのマスに縦に積む)
        // 第 2 版までの下の枠は、横に並べて配列は縦に積んだ列だった: 列は縦の並びのまま、ばらす
        if (!(d.v >= 3)) for (const a of ["bottom", "bottomR"]) areas[a] = areas[a].flat();
        if (!(d.v >= 4)) for (const a of ["top", "topR"]) areas[a] = areas[a].flat(); // 第 3 版までの上の枠も同じ(縦に積んだ列は、縦の並びのまま)
        return { areas, fold, order: [] };
      }
      return { areas: null, fold, order: Array.isArray(d.order) ? d.order.map(String) : [] };
    }
  } catch { /* 壊れていれば既定の配置 */ }
  return { areas: null, fold: {}, order: [] };
}
function saveAreas(name, s) {
  try { localStorage.setItem(LAYOUT_PREFIX + name, JSON.stringify({ v: 4, areas: s.areas, fold: s.fold })); } catch { /* 覚えなくても使える */ }
}
export const AREAS_CSS = (B) => `
${B} .area{min-width:0;min-height:0}
${B} .area.hz{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;align-content:flex-start;overflow-y:auto;overscroll-behavior:contain;min-height:0;box-sizing:border-box;border:0;background:none;margin:0;border-radius:0}
${B}:not(.sec-editing) > .hzrow.one{grid-template-columns:minmax(0,1fr)}
${B}:not(.sec-editing) > .hzrow.one > .cca-split,${B}.no-top:not(.sec-editing) > .hzrow[data-row="top"],${B}.no-bottom:not(.sec-editing) > .hzrow[data-row="bottom"]{display:none}
${B} .area .sec-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
@media (max-width:1000px){${B} .area.hz{flex-direction:column;flex-wrap:nowrap;align-items:stretch}${B} .area.hz > [data-sec],${B} .area.hz > .sec-row{flex:none}${B} > .hzrow > .area.r{display:none !important}
  ${B} .area .sec-row{flex-wrap:nowrap}${B} .area .sec-row > [data-sec],${B} .area .sec-row > .sec-ph,${B} .area .sec-row > .sec-col{flex:1 1 0;min-width:0}}
${B} .area .sec-row > [data-sec],${B} .area .sec-row > .sec-ph,${B} .area .sec-row > .sec-col{flex:1 1 260px;min-width:0}
${B} .area .sec-col{display:flex;flex-direction:column;gap:12px}
${B} .area .sec-col > *{flex:none;min-width:0}
${B} > .mid{min-height:160px}
${B} .area.hz > [data-sec]{flex:1 1 320px;min-width:0}
${B} .area.hz > .sec-stack{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:12px}
${B} .area.hz > .sec-stack > [data-sec]{min-width:0}
${B} .area.hz.top{padding:14px 6px 2px 0}
${B} .area.vt{display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:12px;overflow-y:auto;overscroll-behavior:contain;min-height:0;box-sizing:border-box;padding:2px 6px 14px 0;border:0;background:none;margin:0;border-radius:0}
${B} .area.vt.top{padding:14px 6px 2px 0}
${B} .area.vt > *{flex-shrink:0}
${B}:not(.sec-editing) .area.empty{display:none}
${B}.sec-editing .area{outline:1px dashed var(--line);outline-offset:-1px;border-radius:12px}
${B}.sec-editing .area.empty{display:flex;min-height:90px;align-items:center;justify-content:center}
${B}.sec-editing .area.empty:not(:has(> .sec-ph))::before{content:attr(data-drop-label);color:var(--muted);font-size:13px;pointer-events:none}
${B} .area .sec-bar{display:none;align-items:center;gap:4px;font-size:12px;color:var(--muted);margin:-4px 0 6px;user-select:none}
${B}.sec-editing .area .sec-bar{display:flex;flex-wrap:wrap;row-gap:4px;cursor:grab}
${B} .area .sec-bar-t{white-space:nowrap}
${B} .area .sec-bar::before{content:none !important}
${B} .sec-ph.hz{flex:1 1 320px;min-height:80px}
${B} > .cca-hsplit{flex:none;height:8px;margin:1px 0;cursor:row-resize;border-radius:4px}
${B} > .cca-hsplit:hover,${B} > .cca-hsplit.on{background:color-mix(in srgb,var(--accent) 35%,transparent)}
${B}.no-top:not(.sec-editing) > .cca-hsplit[data-for="top"],${B}.no-bottom:not(.sec-editing) > .cca-hsplit[data-for="bottom"]{display:none}
${B}.one-col:not(.sec-editing) > .mid{grid-template-columns:minmax(0,1fr) !important}
${B}.one-col:not(.sec-editing) > .mid > .cca-split{display:none}
`;
// body: 枠を入れている要素。中に [data-area="top|left|right|bottom"] と、上下の境目 .cca-hsplit[data-for="top|bottom"] を置く
export function setupAreas(body, { name, head = (el) => el.querySelector(":scope > h3, :scope > h4, :scope > summary"), onChange, narrow = null, narrowDefaults = null } = {}) {
  // 幅が狭いとき(narrow: matchMedia)は、別の並びを使う(別に覚える。何も覚えていなければ narrowDefaults)
  const isNarrow = () => !!narrow?.matches;
  const nm = () => (isNarrow() ? `${name}.narrow` : name);
  const hzA = (a) => HZ_AREAS.has(a) && !isNarrow(); // 項目を横に並べる枠か(幅が狭いときは、どの枠も縦に並べる)
  const boxes = Object.fromEntries(AREAS.map((a) => [a, body.querySelector(`[data-area="${a}"]`)]));
  const rowOf = (a) => body.querySelector(`:scope > .hzrow > [data-area="${a}"]`)?.parentElement || null; // 上と下: 左右の枠を入れている行
  const itemsOf = (a) => [...boxes[a].querySelectorAll(":scope > [data-sec], :scope > .sec-stack > [data-sec], :scope > .sec-row > [data-sec], :scope > .sec-row > .sec-col > [data-sec]")];
  // 枠の並び(まとまり .sec-stack・.sec-row は配列で)
  const cellOf = (c) => (c.matches("[data-sec]") ? c.dataset.sec : c.classList.contains("sec-col") ? [...c.querySelectorAll(":scope > [data-sec]")].map((x) => x.dataset.sec) : null);
  const structOf = (a) => [...boxes[a].children].flatMap((c) => (c.matches("[data-sec]") ? [c.dataset.sec]
    : isGroup(c) ? [[...c.children].map(cellOf).filter((x) => x && (!Array.isArray(x) || x.length)).map((x) => (Array.isArray(x) && x.length === 1 ? x[0] : x))].filter((l) => l.length).map((l) => (l.length === 1 && !Array.isArray(l[0]) ? l[0] : l)) : []));
  // まとまり: 空なら消し、1 つだけならまとまりをやめる(ph: 動かしている間の空き)
  const cleanStacks = (ph = null) => {
    // 行の中の縦の積み: 空なら消し、1 つだけなら積みをやめる
    for (const a of AREAS) for (const c of [...boxes[a].querySelectorAll(":scope > .sec-row > .sec-col")]) {
      const kids = [...c.children].filter((x) => x.matches("[data-sec]") || x === ph);
      if (!kids.length) c.remove();
      else if (kids.length === 1 && kids[0] !== ph) { c.parentElement.insertBefore(kids[0], c); c.remove(); }
    }
    // 1 マスだけの行で、そのマスが縦の積みなら、積みを枠に並べ直す(縦の並びのまま)
    for (const a of AREAS) for (const r of [...boxes[a].querySelectorAll(":scope > .sec-row")]) {
      const cells = [...r.children].filter((x) => x.matches("[data-sec]") || x === ph || x.classList.contains("sec-col"));
      if (cells.length === 1 && cells[0].classList.contains("sec-col")) { for (const k of [...cells[0].children]) r.parentElement.insertBefore(k, r); r.remove(); }
    }
    for (const a of AREAS) for (const s of [...boxes[a].querySelectorAll(GROUP)]) {
      const kids = [...s.children].filter((c) => c.matches("[data-sec]") || c === ph || c.classList.contains("sec-col"));
      if (!kids.length) s.remove();
      else if (kids.length === 1 && kids[0] !== ph) { s.parentElement.insertBefore(kids[0], s); s.remove(); }
    }
  };
  const all = () => AREAS.flatMap(itemsOf);
  const defaults = Object.fromEntries(AREAS.map((a) => [a, itemsOf(a).map((el) => el.dataset.sec)]));
  const defArea = new Map(AREAS.flatMap((a) => defaults[a].map((id) => [id, a])));
  let state = loadAreas(nm());
  let editing = false;
  let justMoved = false;
  const api = { name };
  for (const a of AREAS) boxes[a].dataset.dropLabel = T("ここに項目を入れられます");
  const prepare = () => {
    for (const el of all()) {
      let h = head(el) || el.querySelector(":scope > .sec-bar");
      if (!h) { // 見出しの無い項目(生成ボタン・結果と履歴): 並べ替えのときだけ出る、つかむための帯
        h = document.createElement("div");
        h.className = "sec-bar";
        const t = document.createElement("span");
        t.className = "sec-bar-t";
        t.textContent = T(el.dataset.title || "");
        h.append(t);
        el.prepend(h);
      }
      if (h.classList.contains("sec-head")) continue;
      h.classList.add("sec-head");
      const grip = document.createElement("i");
      grip.className = "sec-grip";
      grip.textContent = "⠿";
      grip.title = T("ドラッグで項目の位置を動かす(見出しをドラッグしても動かせます)");
      h.prepend(grip);
      grip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
      h.addEventListener("pointerdown", (e) => {
        if (!editing || e.button !== 0 || e.target.closest("button, input, select, textarea, a, label, [data-nodrag]")) return;
        startMove(e, el, e.target.closest(".sec-grip") ? 0 : 5);
      });
      h.addEventListener("click", (e) => { if (justMoved) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
      if (h.classList.contains("sec-bar")) continue; // 帯では開け閉めしない
      if (el.tagName === "DETAILS") {
        el.addEventListener("toggle", () => { state.fold[el.dataset.sec] = !el.open; saveAreas(nm(), state); });
      } else {
        h.addEventListener("click", (e) => {
          if (e.target.closest("button, input, select, textarea, label, a, .sec-grip")) return;
          el.classList.toggle("sec-folded");
          state.fold[el.dataset.sec] = el.classList.contains("sec-folded");
          saveAreas(nm(), state);
          onChange?.();
        });
      }
    }
  };
  // 覚えた配置と既定の配置を合わせる: 知らない id は捨て、どの枠にも無い(新しい)id は既定の枠の、既定の並びで前にある項目の後ろへ
  const resolve = () => {
    const known = new Set(all().map((el) => el.dataset.sec));
    const saved = state.areas || (isNarrow() && narrowDefaults ? narrowDefaults : { ...defaults, left: state.order.filter((id) => defArea.get(id) === "left") });
    const out = {}, used = new Set();
    const pos = (L, id) => L.findIndex((e) => e === id || (Array.isArray(e) && e.flat().includes(id)));
    for (const a of AREAS) {
      out[a] = [];
      const take = (id) => (known.has(id) && !used.has(id) ? (used.add(id), id) : null);
      for (const e of saved[a] || []) {
        if (!Array.isArray(e)) { if (take(e)) out[a].push(e); continue; }
        // 行: マスは項目か、縦の積み(配列)
        const cells = e.map((c) => (Array.isArray(c) ? c.map(take).filter(Boolean) : take(c))).filter((c) => c && (!Array.isArray(c) || c.length)).map((c) => (Array.isArray(c) && c.length === 1 ? c[0] : c));
        if (cells.length > 1) out[a].push(cells);
        else if (cells.length === 1) out[a].push(...(Array.isArray(cells[0]) ? cells[0] : [cells[0]]));
      }
    }
    for (const a of AREAS) {
      const D = defaults[a];
      D.forEach((id, i) => {
        if (used.has(id) || !known.has(id)) return;
        const L = out[a];
        let j = i - 1;
        while (j >= 0 && pos(L, D[j]) < 0) j--;
        if (j >= 0) L.splice(pos(L, D[j]) + 1, 0, id);
        else {
          let k = i + 1;
          while (k < D.length && pos(L, D[k]) < 0) k++;
          if (k < D.length) L.splice(pos(L, D[k]), 0, id); else L.push(id);
        }
        used.add(id);
      });
    }
    // 幅が狭いとき: 上と下の枠は 1 列(右側の枠の項目は、左側の枠の後ろへ)
    if (isNarrow()) for (const [l, r] of [["top", "topR"], ["bottom", "bottomR"]]) { out[l].push(...out[r]); out[r] = []; }
    return out;
  };
  // 何も見えていない枠は、並べ替えのとき以外は消す(左右のどちらかが空なら 1 列)
  const visible = (el) => !el.classList.contains("hide") && el.style.display !== "none";
  const updateEmpty = () => {
    for (const a of AREAS) boxes[a].classList.toggle("empty", !itemsOf(a).some(visible) && !boxes[a].querySelector(":scope > .sec-ph"));
    const E = (a) => boxes[a].classList.contains("empty");
    body.classList.toggle("no-top", E("top") && E("topR"));
    body.classList.toggle("no-bottom", E("bottom") && E("bottomR"));
    rowOf("top")?.classList.toggle("one", E("top") || E("topR")); // 片方が空なら、もう片方を横いっぱいに
    rowOf("bottom")?.classList.toggle("one", E("bottom") || E("bottomR"));
    body.classList.toggle("one-col", boxes.left.classList.contains("empty") || boxes.right.classList.contains("empty"));
  };
  let pend = 0;
  new MutationObserver((ms) => {
    if (pend || !ms.some((m) => m.target.matches?.("[data-sec]"))) return;
    pend = requestAnimationFrame(() => { pend = 0; updateEmpty(); });
  }).observe(body, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  const apply = () => {
    prepare();
    const byId = new Map(all().map((el) => [el.dataset.sec, el]));
    const out = resolve();
    for (const a of AREAS) for (const e of out[a]) {
      if (!Array.isArray(e)) { boxes[a].appendChild(byId.get(e)); continue; }
      const s = document.createElement("div");
      s.className = hzA(a) ? "sec-stack" : "sec-row";
      boxes[a].appendChild(s);
      for (const c of e) {
        if (!Array.isArray(c)) { s.appendChild(byId.get(c)); continue; }
        const col = document.createElement("div");
        col.className = "sec-col";
        s.appendChild(col);
        for (const id of c) col.appendChild(byId.get(id));
      }
    }
    cleanStacks();
    for (const el of all()) {
      const f = state.fold[el.dataset.sec];
      if (f === undefined) continue;
      if (el.tagName === "DETAILS") el.open = !f; else el.classList.toggle("sec-folded", !!f);
    }
    updateEmpty();
    window.dispatchEvent(new Event("resize")); // プレビューの大きさを合わせ直す
  };
  // カーソルの下の枠(スクロールで隠れている所は数えない。幅が狭いときの中央の列など)
  const areaAt = (x, y) => {
    const hit = document.elementsFromPoint(x, y).find((e) => e.matches?.("[data-area]") && body.contains(e));
    if (hit) return hit.dataset.area;
    return AREAS.find((a) => {
      const b = boxes[a];
      if (!b.offsetParent) return false;
      const r = b.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null;
  };
  // 項目をつかんで動かす: カーソルに付いてくる。入る所(どの枠でも)には空きができ、ほかの項目はすべって動く
  function startMove(e, el, threshold = 0) {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let moving = false, ph = null, r0 = null, lastX = x0, lastY = y0;
    const others = () => all().filter((q) => q !== el && q.offsetParent);
    const slide = (fn) => {
      const list = others();
      const before = new Map(list.map((x) => { const r = x.getBoundingClientRect(); return [x, [r.left, r.top]]; }));
      fn();
      for (const x of list) {
        const r = x.getBoundingClientRect(), [bl, bt] = before.get(x), dx = bl - r.left, dy = bt - r.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        x.style.transition = "none";
        x.style.transform = `translate(${dx}px,${dy}px)`;
        requestAnimationFrame(() => { x.style.transition = "transform .16s ease"; x.style.transform = ""; });
      }
    };
    const place = (x, y) => {
      const a = areaAt(x, y);
      if (!a) return;
      const box = boxes[a], hz = hzA(a);
      if (ph.parentElement && document.elementsFromPoint(x, y).includes(ph)) return; // 空きの上では動かさない(行き来してちらつかないように。スクロールで隠れた所は数えない)
      if (hz) { placeHz(box, x, y); return; }
      // 左右の枠: 項目の左 / 右の 3 分の 1 → その項目と横に並べる。それ以外 → 行(横に並べたまとまり、または 1 つの項目)の上 / 下
      let hit = null;
      for (const q of itemsOf(a).filter((q) => q !== el && q.offsetParent)) {
        const r = q.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { hit = q; break; }
      }
      if (hit) {
        const r = hit.getBoundingClientRect(), edge = r.width / 3; // 左右それぞれ 3 分の 1: 横に並べる / 真ん中: 上下に入れる
        const cell = hit.parentElement.classList.contains("sec-col") ? hit.parentElement : hit; // 行の 1 マス(縦の積みならその積み)
        if (x < r.left + edge || x > r.right - edge) {
          const right = x > r.right - edge;
          if (cell.parentElement.classList.contains("sec-row") && ph.parentElement === cell.parentElement && (right ? ph.previousElementSibling === cell : ph.nextElementSibling === cell)) return;
          slide(() => {
            let rw = cell.parentElement.classList.contains("sec-row") ? cell.parentElement : null;
            if (!rw) { rw = document.createElement("div"); rw.className = "sec-row"; box.insertBefore(rw, cell); rw.appendChild(cell); }
            ph.classList.remove("hz");
            ph.style.height = `${Math.min(r0.height, 240)}px`;
            if (right) cell.after(ph); else cell.before(ph);
            cleanStacks(ph);
            updateEmpty();
          });
          return;
        }
        if (cell.parentElement.classList.contains("sec-row")) { // 行の中の項目の上 / 下: そのマスに縦に積む
          const below = y > r.top + r.height / 2;
          if (ph.parentElement === hit.parentElement && hit.parentElement.classList.contains("sec-col") && (below ? ph.previousElementSibling === hit : ph.nextElementSibling === hit)) return;
          slide(() => {
            let col = hit.parentElement.classList.contains("sec-col") ? hit.parentElement : null;
            if (!col) { col = document.createElement("div"); col.className = "sec-col"; hit.before(col); col.appendChild(hit); }
            ph.classList.remove("hz");
            ph.style.height = `${Math.min(r0.height, 240)}px`;
            if (below) hit.after(ph); else hit.before(ph);
            cleanStacks(ph);
            updateEmpty();
          });
          return;
        }
      }
      const units = [...box.children].filter((c) => c !== ph && c !== el && (c.matches("[data-sec]") || isGroup(c)) && c.getBoundingClientRect().height > 0);
      let target = null;
      if (hit) { // 項目の真ん中: その項目の上 / 下
        const u = hit, r = hit.getBoundingClientRect();
        target = y < r.top + r.height / 2 ? u : units[units.indexOf(u) + 1] || null;
      } else {
        // 横に並べた行の中の、項目と項目の間(すき間)では動かさない
        if (units.some((c) => { if (!c.classList.contains("sec-row")) return false; const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; })) return;
        for (const c of units) { const r = c.getBoundingClientRect(); if (y < r.top + r.height / 2) { target = c; break; } }
      }
      if (ph.parentElement === box) {
        let nx = ph.nextElementSibling;
        while (nx && (nx === el || !(nx.matches("[data-sec]") || isGroup(nx)))) nx = nx.nextElementSibling;
        if ((nx || null) === target) return;
      }
      slide(() => {
        ph.classList.remove("hz");
        ph.style.height = `${r0.height}px`;
        if (target) box.insertBefore(ph, target); else box.appendChild(ph);
        cleanStacks(ph);
        updateEmpty();
      });
    };
    // 上と下の枠: 項目の上 / 下の端の近く → その列に縦に積む。それ以外 → 列(縦に積んだまとまり、または 1 つの項目)の前 / 後ろ
    const placeHz = (box, x, y) => {
      let hit = null;
      for (const q of [...box.querySelectorAll(":scope > [data-sec], :scope > .sec-stack > [data-sec], :scope > .sec-row > [data-sec]")].filter((q) => q !== el && q.offsetParent)) {
        const r = q.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { hit = q; break; }
      }
      if (hit) {
        const r = hit.getBoundingClientRect(), edge = Math.min(70, r.height * 0.3);
        if (y < r.top + edge || y > r.bottom - edge) {
          const below = y > r.bottom - edge;
          if (hit.parentElement.classList.contains("sec-stack") && ph.parentElement === hit.parentElement && (below ? ph.previousElementSibling === hit : ph.nextElementSibling === hit)) return;
          slide(() => {
            let st = hit.parentElement.classList.contains("sec-stack") ? hit.parentElement : null;
            if (!st) { st = document.createElement("div"); st.className = "sec-stack"; box.insertBefore(st, hit); st.appendChild(hit); }
            ph.classList.remove("hz");
            ph.style.height = `${Math.min(r0.height, 240)}px`;
            if (below) hit.after(ph); else hit.before(ph);
            cleanStacks(ph);
            updateEmpty();
          });
          return;
        }
      }
      const cols = [...box.children].filter((c) => c !== ph && c !== el && (c.matches("[data-sec]") || isGroup(c)) && c.getBoundingClientRect().width > 0);
      let target = null;
      for (const c of cols) { const r = c.getBoundingClientRect(); if (y < r.bottom && x < r.left + r.width / 2) { target = c; break; } }
      if (ph.parentElement === box) {
        let nx = ph.nextElementSibling;
        while (nx && (nx === el || !(nx.matches("[data-sec]") || isGroup(nx)))) nx = nx.nextElementSibling;
        if ((nx || null) === target) return;
      }
      slide(() => {
        ph.classList.add("hz");
        ph.style.height = `${Math.min(r0.height, 240)}px`;
        if (target) box.insertBefore(ph, target); else box.appendChild(ph);
        cleanStacks(ph);
        updateEmpty();
      });
    };
    const follow = () => { el.style.left = `${r0.left + (lastX - x0)}px`; el.style.top = `${r0.top + (lastY - y0)}px`; };
    const begin = () => {
      moving = true;
      r0 = el.getBoundingClientRect();
      ph = document.createElement("div");
      ph.className = "sec-ph";
      ph.style.height = `${r0.height}px`;
      el.parentElement.insertBefore(ph, el);
      if (el.parentElement.classList.contains("hz")) ph.classList.add("hz");
      el.classList.add("sec-moving");
      Object.assign(el.style, { position: "fixed", left: `${r0.left}px`, top: `${r0.top}px`, width: `${Math.min(r0.width, 560)}px`, zIndex: 10050, pointerEvents: "none", margin: "0" });
      follow();
    };
    if (threshold <= 0) begin();
    const timer = setInterval(() => { // 枠の上下の端に近づくと、その枠をスクロールする
      if (!moving) return;
      const a = areaAt(lastX, lastY), sc = a && boxes[a];
      if (!sc || sc.scrollHeight <= sc.clientHeight) return;
      const r = sc.getBoundingClientRect();
      const d = lastY < r.top + 40 ? -14 : lastY > r.bottom - 40 ? 14 : 0;
      if (d) { sc.scrollTop += d; place(lastX, lastY); }
    }, 30);
    const move = (ev) => {
      lastX = ev.clientX; lastY = ev.clientY;
      if (!moving && Math.hypot(lastX - x0, lastY - y0) < threshold) return;
      if (!moving) begin();
      follow();
      place(lastX, lastY);
    };
    const up = () => {
      clearInterval(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moving) return;
      justMoved = true;
      setTimeout(() => { justMoved = false; }, 0);
      ph.parentElement.insertBefore(el, ph);
      ph.remove();
      cleanStacks();
      el.classList.remove("sec-moving");
      for (const k of ["position", "left", "top", "width", "zIndex", "pointerEvents", "margin"]) el.style[k] = "";
      for (const x of others()) { x.style.transition = ""; x.style.transform = ""; }
      state.areas = current();
      saveAreas(nm(), state);
      updateEmpty();
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new CustomEvent("cca-layout-change", { detail: { key: isNarrow() ? `${name}.narrow` : name } }));
      onChange?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    if (moving) place(lastX, lastY);
  }
  // 上と下の枠の高さ: 境目をドラッグで変える(ダブルクリックで元に戻す = 中身に合わせる)
  for (const sp of body.querySelectorAll(":scope > .cca-hsplit")) {
    const a = sp.dataset.for, box = rowOf(a) || boxes[a], lsk = () => `cca_generator.areah.${nm()}.${a}`; // 幅が狭いときは別に覚える
    sp.title = T("ドラッグで枠の高さを変えます(ダブルクリックで元の高さ)");
    const set = (h) => { if (h) { box.style.height = `${Math.round(h)}px`; box.style.maxHeight = "none"; } else { box.style.height = ""; box.style.maxHeight = ""; } };
    const load = () => { try { set(Number(localStorage.getItem(lsk())) || 0); } catch { /* 既定の高さ */ } };
    load();
    narrow?.addEventListener?.("change", load);
    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.classList.add("on");
      const move = (ev) => {
        const r = box.getBoundingClientRect(), max = body.clientHeight - 160;
        set(Math.max(60, Math.min(max, a === "top" ? ev.clientY - r.top : r.bottom - ev.clientY)));
      };
      const up = () => {
        sp.classList.remove("on");
        sp.removeEventListener("pointermove", move); sp.removeEventListener("pointerup", up);
        try { localStorage.setItem(lsk(), String(parseFloat(box.style.height) || 0)); } catch { /* 残せなくても今は使える */ }
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("cca-layout-change", { detail: { key: name } }));
      };
      sp.addEventListener("pointermove", move);
      sp.addEventListener("pointerup", up);
    });
    sp.addEventListener("dblclick", () => { set(0); try { localStorage.removeItem(lsk()); } catch { /* 無視 */ } window.dispatchEvent(new Event("resize")); window.dispatchEvent(new CustomEvent("cca-layout-change", { detail: { key: name } })); });
  }
  api.apply = apply;
  api.reload = () => { state = loadAreas(nm()); apply(); };
  api.narrow = isNarrow;
  narrow?.addEventListener?.("change", () => { state = loadAreas(nm()); apply(); });
  api.editing = () => editing;
  let snap = null; // 並べ替えを始めたときの配置(「移動を戻す」で戻す)
  const current = () => Object.fromEntries(AREAS.map((a) => [a, structOf(a)]));
  api.setEdit = (on) => { editing = !!on; if (editing) snap = current(); body.classList.toggle("sec-editing", editing); updateEmpty(); window.dispatchEvent(new Event("resize")); };
  api.undo = () => { if (!snap) return; state.areas = JSON.parse(JSON.stringify(snap)); saveAreas(nm(), state); apply(); onChange?.(); };
  api.reset = () => {
    state.areas = null; state.order = []; saveAreas(nm(), state);
    for (const sp of body.querySelectorAll(".cca-hsplit, .mid > .cca-split, .hzrow > .cca-split")) sp.dispatchEvent(new MouseEvent("dblclick")); // 枠の高さ・左右の幅も元に戻す
    apply(); onChange?.();
  };
  apply();
  reg.set(name, api);
  return api;
}
// 「⇅ 並べ替え」ボタン(押すと編集モード。もう一度で固定)と「移動を戻す」「デフォルトの状態に戻す」を、bar に置く
export function sectionEditBar(bar, parts, { onSet, noReset = false } = {}) {
  bar.innerHTML = `<button class="sec-edit" data-sec-edit title="${T("押すと、項目の見出し(⠿)をドラッグして位置を変えられます。もう一度押すと固定します")}">⇅ ${T("並べ替え")}</button>`
    + `<button data-sec-cancel hidden title="${T("並べ替えをやめて、始める前の並びに戻します")}">${T("キャンセル")}</button>`
    + `<button data-sec-undo hidden title="${T("並べ替えを始める前の並びに戻します")}">${T("移動を戻す")}</button>`
    + `<button data-sec-reset hidden title="${T("項目の並び(生成パネルでは枠の大きさも)を最初の状態に戻します")}">${T("デフォルトの状態に戻す")}</button>`;
  const btn = bar.querySelector("[data-sec-edit]"), rst = bar.querySelector("[data-sec-reset]"), und = bar.querySelector("[data-sec-undo]"), cnl = bar.querySelector("[data-sec-cancel]");
  const set = (on) => {
    for (const p of parts) p.setEdit(on);
    btn.classList.toggle("on", on);
    btn.textContent = on ? `✔ ${T("完了")}` : `⇅ ${T("並べ替え")}`;
    rst.hidden = !on || noReset;
    und.hidden = !on;
    cnl.hidden = !on;
    onSet?.(on);
  };
  cnl.onclick = () => { for (const p of parts) p.undo?.(); set(false); }; // 始める前の並びに戻して終える
  btn.onclick = () => set(!parts[0]?.editing());
  rst.onclick = () => { for (const p of parts) p.reset(); };
  und.onclick = () => { for (const p of parts) p.undo?.(); };
  return { set };
}
// 書き出し / 読み込みのあと: 覚えた並びを読み直して並べ直す
export function reloadAllSections() { for (const p of reg.values()) p.reload(); }
