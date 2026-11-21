// 言語パック
// locales/<言語>/cca_panel.json の "strings"(日本語の文 → その言語の文)で、パネルの文字・ⓘ の説明・使い方・
// メッセージを置き換える。元の文は日本語なので、日本語のときは何もしない。
// - 文の中の {0} {name} などは「変わる部分」。同じ形の文(数やファイル名だけ違う)をまとめて訳せる
// - 画面の要素(id が cca- で始まるもの)は、文字が変わるたびに自動で訳す(元の日本語を覚えておくので、言語を戻せる)
// - 訳が無い文は日本語のまま出す(CCA_I18N.misses に溜まる)
import { api } from "../../scripts/api.js";

const JP = /[぀-ヿ㐀-䶿一-鿿！-～「-』]/;
const ATTRS = ["title", "placeholder", "label", "aria-label"];
const INLINE = new Set(["B", "STRONG", "I", "EM", "CODE", "BR", "SMALL", "KBD", "A", "U", "SUB", "SUP"]);
const SKIP = new Set(["TEXTAREA", "SCRIPT", "STYLE", "CANVAS", "VIDEO", "AUDIO", "svg", "SVG", "IMG", "INPUT"]);

const st = {
  lang: "ja", choice: "auto", packs: [{ code: "ja", name: "日本語" }],
  exact: new Map(), pats: [], cache: new Map(), active: false,
};
export const misses = new Set();
const listeners = new Set();

export const lang = () => st.lang;
export const choice = () => st.choice;
export const packs = () => st.packs;
export const onLangChange = (fn) => listeners.add(fn);

// ---------------------------------------------------------------- 訳す
function compile(strings) {
  st.exact = new Map();
  st.pats = [];
  st.cache = new Map();
  for (const [k, v] of Object.entries(strings || {})) {
    if (typeof v !== "string" || !v || k.startsWith("_")) continue;
    st.exact.set(k, v);
    if (!/\{[A-Za-z0-9_]+\}/.test(k)) continue;
    const names = [];
    const parts = k.split(/(\{[A-Za-z0-9_]+\})/);
    let lit = "";
    const re = parts.map((p) => {
      const m = /^\{([A-Za-z0-9_]+)\}$/.exec(p);
      if (m) { names.push(m[1]); return "([\\s\\S]*?)"; }
      if (p.length > lit.length) lit = p;
      return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    if (!JP.test(parts.filter((p) => !/^\{[A-Za-z0-9_]+\}$/.test(p)).join(""))) continue; // 日本語の無い形は使わない(何にでも当たるため)
    st.pats.push({ re: new RegExp(`^${re}$`), names, out: v, lit, size: k.length - names.join("").length });
  }
  st.pats.sort((a, b) => b.size - a.size); // 具体的な(長い)形から試す
}
function byPattern(s, depth) {
  for (const p of st.pats) {
    if (p.lit && !s.includes(p.lit)) continue;
    const m = p.re.exec(s);
    if (!m) continue;
    const vals = {};
    // 変わる部分も訳す(ファイル名などは、訳が無ければそのまま)。
    // 訳せない部分が日本語やタグを含むときは、この形ではない(長い文の一部に当たっただけ)とみなす(英語と日本語が混ざらないように)
    let ok = true;
    p.names.forEach((n, i) => {
      const g = m[i + 1];
      const t = lookup(g, depth + 1);
      if (t === undefined && (JP.test(g) || /<\/?[a-zA-Z]/.test(g))) ok = false;
      vals[n] = t ?? g;
    });
    if (!ok) continue;
    return p.out.replace(/\{([A-Za-z0-9_]+)\}/g, (all, n) => (n in vals ? vals[n] : all));
  }
  return undefined;
}
// 組み合わせた文(「★ 名前」「名前 — 説明」「A / B」「名前: 値」「ファイル名(見つかりません)」など)は、
// 区切りで分けて、日本語の部分がすべて訳せたときだけ使う
const PREFIX = /^(★ |✓ |⚠ |— |・|▸ |→ |← |\+ |↓ |● )([\s\S]+)$/;
const SEPS = [" — ", " / ", " ・ ", ": ", " → ", "・"];
function byParts(s, depth) {
  let m = PREFIX.exec(s);
  if (m) { const t = lookup(m[2], depth + 1); return t === undefined ? undefined : m[1] + t; }
  m = /^([\s\S]+?)\s*[:：]$/.exec(s); // 末尾の「:」(後ろにリンクなどが続く見出し)
  if (m) { const t = lookup(m[1], depth + 1); return t === undefined ? undefined : `${t}:`; }
  m = /^\(([\s\S]+)\)$/.exec(s);
  if (m) { const t = lookup(m[1], depth + 1); return t === undefined ? undefined : `(${t})`; }
  m = /^([\s\S]*?[^\s(])(\((?:[^()]|\([^()]*\))*\))$/.exec(s); // 末尾のかっこ
  if (m) {
    const a = lookup(m[1], depth + 1), b = lookup(m[2], depth + 1);
    if (a !== undefined && b !== undefined) return `${a} ${b}`;
  }
  for (const sep of SEPS) {
    if (!s.includes(sep)) continue;
    const parts = s.split(sep);
    const out = parts.map((x) => { const mm = /^(\s*)([\s\S]*?)(\s*)$/.exec(x); const t = lookup(mm[2], depth + 1); return t === undefined ? undefined : mm[1] + t + mm[3]; });
    if (out.every((x) => x !== undefined)) return out.join(sep === "・" ? " · " : sep);
  }
  return undefined;
}
// 訳を探す(見つからなければ undefined。ここでは「訳が無い」を記録しない)
function lookup(s, depth = 0) {
  if (!JP.test(s)) return s;
  let out = st.exact.get(s);
  if (out !== undefined) return out;
  if (depth > 4) return undefined;
  out = byPattern(s, depth);
  if (out !== undefined) return out;
  if (s.includes("\n")) {
    // 複数行: 行ごとに訳す(空行・日本語の無い行はそのまま)
    const lines = s.split("\n").map((l) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(l);
      const t = lookup(m[2], depth + 1);
      return t === undefined ? undefined : m[1] + t + m[3];
    });
    if (lines.every((x) => x !== undefined)) return lines.join("\n");
  }
  return byParts(s, depth);
}
function trText(s, quiet = false) {
  if (!st.active || typeof s !== "string" || !JP.test(s)) return s;
  const c = st.cache.get(s);
  if (c !== undefined) return c;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const t = lookup(m[2]);
  if (t === undefined) {
    if (quiet) return s;
    misses.add(m[2]);
    // 複数行で一部だけ訳せないときは、訳せる行だけ訳す
    if (m[2].includes("\n")) {
      const r = m[1] + m[2].split("\n").map((l) => { const mm = /^(\s*)([\s\S]*?)(\s*)$/.exec(l); const x = lookup(mm[2]); if (x === undefined && JP.test(mm[2])) misses.add(mm[2]); return x === undefined ? l : mm[1] + x + mm[3]; }).join("\n") + m[3];
      st.cache.set(s, r);
      return r;
    }
    return s;
  }
  const r = m[1] + t + m[3];
  if (st.cache.size > 8000) st.cache.clear();
  st.cache.set(s, r);
  return r;
}
// T("文"): 今の言語に訳す。T("…{0}…{1}…", a, b): 訳してから {0} {1} に値を入れる
export function T(s, ...args) {
  let r = trText(s);
  if (args.length) r = String(r).replace(/\{(\d+)\}/g, (all, i) => (Number(i) < args.length ? String(args[Number(i)]) : all));
  return r;
}
// 確認・入力・お知らせのダイアログ(ブラウザ標準)も訳す
export const confirm = (msg) => window.confirm(T(msg));
export const alert = (msg) => window.alert(T(msg));
export const prompt = (msg, def) => window.prompt(T(msg), def);

// ---------------------------------------------------------------- 画面の要素を訳す(元の文を覚えておく)
const origText = new WeakMap(); // テキスト → 元の日本語
const setText = new WeakMap(); // テキスト → 訳して入れた文
const origAttr = new WeakMap(); // 要素 → {属性: 元の日本語}
const setAttr = new WeakMap(); // 要素 → {属性: 訳して入れた文}
const origHtml = new WeakMap(); // 文中に太字などがある段落 → 元の HTML
const setHtml = new WeakMap();
const roots = new Set();

function trTextNode(n) {
  const v = n.nodeValue;
  if (setText.get(n) === v) return; // 自分で入れた文
  if (!JP.test(v)) { origText.delete(n); return; }
  origText.set(n, v);
  const t = trText(v);
  if (t !== v) { setText.set(n, t); n.nodeValue = t; } else setText.delete(n);
}
function trAttr(el, a) {
  const v = el.getAttribute(a);
  if (v == null) return;
  const sa = setAttr.get(el) || {};
  if (sa[a] === v) return;
  const oa = origAttr.get(el) || {};
  if (!JP.test(v)) { delete oa[a]; return; }
  oa[a] = v; origAttr.set(el, oa);
  const t = trText(v);
  if (t !== v) { sa[a] = t; setAttr.set(el, sa); el.setAttribute(a, t); } else delete sa[a];
}
// 太字・改行・コードなどが混ざった短い段落は、まとめて 1 つの文として訳す
function isMixed(el) {
  let txt = false, inl = false;
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { if (JP.test(c.nodeValue)) txt = true; continue; }
    if (c.nodeType !== 1) continue;
    if (!INLINE.has(c.tagName) || c.id || c.querySelector("*:not(b,strong,i,em,code,br,small,kbd,u,sub,sup)")) return false;
    inl = true;
  }
  return txt && inl;
}
function trMixed(el) {
  const html = el.innerHTML;
  if (setHtml.get(el) === html) return true;
  const t = trText(html, true);
  if (t === html) return false; // まとめての訳が無い → 文字ごとに訳す
  origHtml.set(el, html);
  el.innerHTML = t;
  setHtml.set(el, el.innerHTML);
  return true;
}
function trEl(el) {
  if (SKIP.has(el.tagName) || el.hasAttribute("data-no-i18n")) {
    // 入力欄は中身(入力した文)を訳さず、説明(placeholder・title)だけ訳す
    if (["INPUT", "IMG", "TEXTAREA"].includes(el.tagName)) for (const a of ATTRS) trAttr(el, a);
    return;
  }
  for (const a of ATTRS) if (el.hasAttribute(a)) trAttr(el, a);
  if (el.tagName === "OPTION" && !el.hasAttribute("value")) el.setAttribute("value", el.textContent); // 値は日本語のまま
  if (isMixed(el) && trMixed(el)) return;
  for (const c of [...el.childNodes]) {
    if (c.nodeType === 3) trTextNode(c);
    else if (c.nodeType === 1) trEl(c);
  }
}
function trNode(n) {
  const p = n.parentElement;
  if (p && p.hasAttribute?.("data-no-i18n")) return;
  if (p && isMixed(p) && trMixed(p)) return;
  if (n.nodeType === 3) trTextNode(n);
  else if (n.nodeType === 1) trEl(n);
}
// 言語を変えたとき: 覚えておいた元の日本語から訳し直す
function restore(el) {
  if (origHtml.has(el) && setHtml.get(el) === el.innerHTML) {
    el.innerHTML = origHtml.get(el); setHtml.delete(el); origHtml.delete(el);
  }
  const oa = origAttr.get(el);
  if (oa) {
    const sa = setAttr.get(el) || {};
    for (const [a, v] of Object.entries(oa)) if (sa[a] === el.getAttribute(a)) el.setAttribute(a, v);
    setAttr.delete(el); origAttr.delete(el);
  }
  for (const c of [...el.childNodes]) {
    if (c.nodeType === 3) {
      if (origText.has(c) && setText.get(c) === c.nodeValue) c.nodeValue = origText.get(c);
      setText.delete(c); origText.delete(c);
    } else if (c.nodeType === 1) restore(c);
  }
}
function watchRoot(el) {
  if (roots.has(el)) return;
  roots.add(el);
  trEl(el);
  const mo = new MutationObserver((ms) => {
    if (!st.active) return;
    for (const m of ms) {
      if (m.type === "childList") m.addedNodes.forEach(trNode);
      else if (m.type === "characterData") trNode(m.target);
      else if (m.type === "attributes") trAttr(m.target, m.attributeName);
    }
  });
  mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
const isOurs = (el) => el?.nodeType === 1 && typeof el.id === "string" && el.id.startsWith("cca-");
function watchBody() {
  for (const el of document.body.children) if (isOurs(el)) watchRoot(el);
  new MutationObserver((ms) => {
    for (const m of ms) m.addedNodes.forEach((el) => { if (isOurs(el)) watchRoot(el); });
    for (const r of [...roots]) if (!r.isConnected) roots.delete(r);
  }).observe(document.body, { childList: true });
}
// パネルの外(ノードの上の欄など)に出す要素も訳す
export function watch(el) { if (el) watchRoot(el); }

// ---------------------------------------------------------------- 読み込み・切り替え
async function comfyLocale() {
  try {
    const r = await api.fetchApi("/settings/Comfy.Locale", { cache: "no-store" });
    if (r.ok) { const v = await r.json(); if (typeof v === "string" && v) return v; }
  } catch { /* 取れなければブラウザの言語 */ }
  return navigator.language || "en";
}
function apply(data) {
  const prev = st.lang;
  st.lang = data.lang || "ja";
  st.choice = data.choice || "auto";
  st.packs = data.packs?.length ? data.packs : st.packs;
  compile(data.strings || {});
  st.active = st.exact.size > 0;
  misses.clear();
  document.documentElement.dataset.ccaLang = st.lang;
  return prev !== st.lang;
}
async function fetchPack(body) {
  const comfy = await comfyLocale();
  const r = body
    ? await api.fetchApi("/cca_generator/i18n", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, comfy }) })
    : await api.fetchApi(`/cca_generator/i18n?comfy=${encodeURIComponent(comfy)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`/cca_generator/i18n: ${r.status}`);
  return r.json();
}
export const ready = (async () => {
  // 読めなくても(4 秒で打ち切り)日本語のまま動く
  const timeout = new Promise((_, ng) => setTimeout(() => ng(new Error("timeout")), 4000));
  try { apply(await Promise.race([fetchPack(), timeout])); } catch (e) { console.warn("[CCA Generator] 言語パックを読めませんでした:", e); }
  if (document.body) watchBody();
  else window.addEventListener("DOMContentLoaded", watchBody, { once: true });
})();
// 言語を選ぶ("auto" = ComfyUI の言語設定に合わせる)
export async function setChoice(c) {
  const data = await fetchPack({ choice: c });
  for (const r of roots) restore(r);
  apply(data);
  for (const r of roots) trEl(r);
  for (const fn of listeners) { try { fn(st.lang); } catch (e) { console.error(e); } }
  return st.lang;
}
// ComfyUI の言語設定を変えたとき(「自動」なら合わせる)
export async function recheck() {
  if (st.choice !== "auto") return;
  const data = await fetchPack();
  if (data.lang === st.lang) return;
  for (const r of roots) restore(r);
  apply(data);
  for (const r of roots) trEl(r);
  for (const fn of listeners) { try { fn(st.lang); } catch (e) { console.error(e); } }
}

window.CCA_I18N = { T, misses, lang, choice, packs, setChoice, state: st };
