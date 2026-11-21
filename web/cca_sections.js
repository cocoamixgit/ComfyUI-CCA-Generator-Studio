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
  api.setEdit = (on) => { editing = !!on; box.classList.toggle("sec-editing", editing); };
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
// 「⇅ 並べ替え」ボタン(押すと編集モード。もう一度で固定)と「元の並びに戻す」を、bar に置く
export function sectionEditBar(bar, parts) {
  bar.innerHTML = `<button class="sec-edit" data-sec-edit title="${T("押すと、項目の見出し(⠿)をドラッグして位置を変えられます。もう一度押すと固定します")}">⇅ ${T("並べ替え")}</button>`
    + `<button data-sec-reset hidden title="${T("項目を最初の並びに戻します")}">${T("元の並びに戻す")}</button>`;
  const btn = bar.querySelector("[data-sec-edit]"), rst = bar.querySelector("[data-sec-reset]");
  const set = (on) => {
    for (const p of parts) p.setEdit(on);
    btn.classList.toggle("on", on);
    btn.textContent = on ? `✔ ${T("完了")}` : `⇅ ${T("並べ替え")}`;
    rst.hidden = !on;
  };
  btn.onclick = () => set(!parts[0]?.editing());
  rst.onclick = () => { for (const p of parts) p.reset(); };
  return { set };
}
// 書き出し / 読み込みのあと: 覚えた並びを読み直して並べ直す
export function reloadAllSections() { for (const p of reg.values()) p.reload(); }
