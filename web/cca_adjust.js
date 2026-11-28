// CCA Generator: 色・明るさの補正(画像編集・動画編集で共通。書き出しは cca/adjust.py が同じ計算をする)
// - 値(adj)は ADJ_GROUPS のキー(色相は度、それ以外は -1〜1 / 0〜1)と、色 bcolor(黒の色)・scolor / hcolor(シャドウ / ハイライトの色)
// - HDR は、プロの写真の道具と同じ「トーンマッピング」: 明るさ(対数)を、ふちを残すぼかし(ガイデッドフィルター)で
//   大まかな明るさ(ベース)と細かい所(ディテール)に分け、ベースだけを縮める(明るい所はそのまま、暗い所を持ち上げる)。
//   ディテールはそのまま(または強めて)戻すので、明暗の差を縮めても、のっぺり・白っぽくならず、ふちに光の輪(ハロー)も出にくい
// - ぼかしなどの大きさは絵の短い辺に対しての割合なので、プレビュー(小さい絵)と書き出しで同じ見た目
// - ワンボタンの自動補正(クリア・HDR・派手・かわいい・ムード): 絵の明るさの分布を見て、値を決める。「強さ」で効き方を変えられる
import { T } from "./cca_i18n.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 欄の分類(詳細設定の中で、分類ごとに折りたたむ)。[キー, 名前, 最小, 最大]。表示は 100 倍(色相は度のまま)。colors: その分類の色の欄
export const ADJ_GROUPS = [
  ["light", "光(明るさ・コントラスト)", [["exposure", "露光量", -100, 100], ["bright", "明るさ", -100, 100], ["contrast", "コントラスト", -100, 100],
    ["high", "ハイライト", -100, 100], ["shadow", "シャドウ", -100, 100], ["white", "白レベル", -100, 100], ["black", "黒レベル", -100, 100],
    ["light", "ライティング", -100, 100]], [["bcolor", "黒の色", "#ffffff"]]],
  ["hdr", "HDR・質感", [["hdr", "HDR(トーンマッピング)", 0, 100], ["detail", "ディテール", -100, 100], ["clarity", "鮮明度", -100, 100],
    ["dehaze", "かすみ除去", -100, 100], ["sharp", "シャープ", -100, 100], ["denoise", "ノイズ低減", 0, 100]]],
  ["color", "色", [["temp", "色温度", -100, 100], ["tint", "色かぶり補正", -100, 100], ["sat", "彩度", -100, 100], ["vib", "自然な彩度", -100, 100], ["hue", "色相", -180, 180]]],
  ["grade", "カラーグレーディング", [["sgrade", "シャドウの色の強さ", 0, 100], ["hgrade", "ハイライトの色の強さ", 0, 100]],
    [["scolor", "シャドウの色", "#1f6fd8"], ["hcolor", "ハイライトの色", "#ff9a3c"]]],
  ["fx", "効果", [["glow", "ふんわり", 0, 100], ["vignette", "周辺の明るさ", -100, 100], ["grain", "粒子(フィルム)", 0, 100]]],
];
export const ADJ_FIELDS = ADJ_GROUPS.flatMap((g) => g[2]);
const KEYS = ADJ_FIELDS.map((f) => f[0]);
const POS = new Set(ADJ_FIELDS.filter((f) => f[2] === 0).map((f) => f[0])); // 0〜1 のもの
const COLORS = Object.fromEntries(ADJ_GROUPS.flatMap((g) => g[3] || []).map(([k, , d]) => [k, d]));
const NOTES = {
  exposure: "カメラの露出と同じ(光の量を ±2 段)。明るい所まで一緒に変わります",
  light: "明るさとは別に、光の当たり方を整えます(+ で暗い所を持ち上げ、明るい所を抑える。- で光と影を強く)",
  white: "+ で白をより白く、- で白を抑えます", black: "- で黒をしめて、もやっとした所を無くします。+ で黒を「黒の色」に近づけて、ふんわりさせます",
  hdr: "明るい所はそのままに、暗い所を持ち上げて明暗の差を縮めます(細かい所の明暗は残すので、のっぺりしません)",
  detail: "細かい所の明暗。ふちに光の輪が出にくい強め方です。- でなめらかに",
  clarity: "中くらいの大きさの明暗(質感)。- でやわらかく", dehaze: "+ でかすみ・もやを取り、- でかすみを足します",
  denoise: "ざらつき(ノイズ)をならします(ふちは残します)", glow: "白くぼかした光を重ねます", vignette: "- で周りを暗く、+ で明るく",
  temp: "- で青っぽく(涼しい)、+ で黄色っぽく(暖かい)", tint: "- で緑っぽく、+ でマゼンタ(赤紫)っぽく",
  sgrade: "暗い所に色を付けます(映画のような色づくり)", hgrade: "明るい所に色を付けます", grain: "フィルムのような細かい粒を足します",
};
const isNum = (a, k) => Math.abs(Number(a?.[k]) || 0) > 1e-4;
// 補正があるか
export function adjOn(a) { return !!a && KEYS.some((k) => isNum(a, k)); }
export const adjSig = (a) => (adjOn(a) ? JSON.stringify(KEYS.map((k) => Math.round((Number(a[k]) || 0) * 1000)).concat(Object.keys(COLORS).map((k) => a[k] || ""))) : "");
const hexRgb = (hex, d = "#ffffff") => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "") || /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(d); return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]; };
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const toL = (v) => (v > 0 ? v ** 2.2 : 0), toS = (v) => (v > 0 ? v ** (1 / 2.2) : 0);
// ぼかしの大きさ(短い辺 m に対して)。書き出しと同じ
export const BLUR_K = { sharp: 0.0012, clarity: 0.015, light: 0.05, glow: 0.02 };
const sigOf = (key, m) => (key === "sharp" ? Math.max(0.6, BLUR_K.sharp * m) : BLUR_K[key] * m);
// src をぼかした画素(RGBA)。大きなぼかしは縮めてからぼかして戻す(書き出しと同じやり方)
function blurData(src, W, H, sigma) {
  const f = sigma >= 8 ? sigma / 4 : 1;
  const sw = Math.max(1, Math.round(W / f)), sh = Math.max(1, Math.round(H / f));
  const a = document.createElement("canvas");
  a.width = sw; a.height = sh;
  a.getContext("2d").drawImage(src, 0, 0, sw, sh);
  const b = document.createElement("canvas");
  b.width = sw; b.height = sh;
  const gb = b.getContext("2d");
  gb.filter = `blur(${sigma / f}px)`;
  gb.drawImage(a, 0, 0);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const gc = c.getContext("2d", { willReadFrequently: true });
  gc.imageSmoothingQuality = "high";
  gc.drawImage(b, 0, 0, W, H);
  return gc.getImageData(0, 0, W, H).data;
}
// ---- 平均・縮小・拡大・ガイデッドフィルター(書き出し adjust.py と同じ計算)
// 半径 r の箱の平均(はしは、絵の中にある分だけで平均)
function box(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) s += src[o + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      tmp[o + x] = s / (hi - lo + 1);
      if (x + r + 1 < w) s += src[o + x + r + 1];
      if (x - r >= 0) s -= src[o + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) s += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      out[y * w + x] = s / (hi - lo + 1);
      if (y + r + 1 < h) s += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) s -= tmp[(y - r) * w + x];
    }
  }
  return out;
}
// f × f の区画の平均で縮める
function down(src, W, H, f) {
  const w = Math.ceil(W / f), h = Math.ceil(H / f), out = new Float32Array(w * h), n = new Float32Array(w * h);
  for (let y = 0; y < H; y++) { const j = Math.floor(y / f) * w; for (let x = 0; x < W; x++) { const i = j + Math.floor(x / f); out[i] += src[y * W + x]; n[i]++; } }
  for (let i = 0; i < out.length; i++) out[i] /= n[i];
  return { a: out, w, h };
}
// 縮めたものを元の大きさへ(画素の真ん中で合わせて、なめらかに)
function up(src, w, h, W, H, f) {
  const out = new Float32Array(W * H), xi0 = new Int32Array(W), xi1 = new Int32Array(W), xf = new Float32Array(W);
  for (let x = 0; x < W; x++) { const u = clamp((x + 0.5) / f - 0.5, 0, w - 1), i0 = Math.floor(u); xi0[x] = i0; xi1[x] = Math.min(i0 + 1, w - 1); xf[x] = u - i0; }
  for (let y = 0; y < H; y++) {
    const v = clamp((y + 0.5) / f - 0.5, 0, h - 1), j0 = Math.floor(v), j1 = Math.min(j0 + 1, h - 1), fy = v - j0;
    for (let x = 0; x < W; x++) {
      const a = src[j0 * w + xi0[x]] + (src[j0 * w + xi1[x]] - src[j0 * w + xi0[x]]) * xf[x];
      const b = src[j1 * w + xi0[x]] + (src[j1 * w + xi1[x]] - src[j1 * w + xi0[x]]) * xf[x];
      out[y * W + x] = a + (b - a) * fy;
    }
  }
  return out;
}
// ふちを残してならす(ガイデッドフィルター。I 自身を手がかりに)。大きな半径は縮めて計算し、係数だけ戻す(速いガイデッドフィルター)。
// rk: 半径(短い辺に対して)、eps: どのくらいの差をふちとして残すか。返り値: ならした値と、縮めたときの値(明るさの分布を見るのに使う)
function guided(I, W, H, rk, eps, maxSide = 512) {
  const f = Math.max(1, Math.ceil(Math.max(W, H) / maxSide));
  const { a: s, w, h } = down(I, W, H, f);
  const { mA, mB, small } = guidedSmall(s, w, h, rk, eps);
  const UA = up(mA, w, h, W, H, f), UB = up(mB, w, h, W, H, f), out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = UA[i] * I[i] + UB[i];
  return { q: out, small };
}
// 縮めた絵 s(w × h)でのガイデッドフィルターの係数(mA, mB)と、ならした値(small)
function guidedSmall(s, w, h, rk, eps) {
  const r = Math.max(1, Math.round(rk * Math.min(w, h)));
  const ss2 = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) ss2[i] = s[i] * s[i];
  const mI = box(s, w, h, r), mII = box(ss2, w, h, r);
  const A = new Float32Array(s.length), B = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) { const v = Math.max(0, mII[i] - mI[i] * mI[i]); A[i] = v / (v + eps); B[i] = mI[i] - A[i] * mI[i]; }
  const mA = box(A, w, h, r), mB = box(B, w, h, r);
  const small = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) small[i] = mA[i] * s[i] + mB[i];
  return { mA, mB, small };
}
const pct = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
// 決まった乱数(画素の位置から。書き出しと同じ値)
function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- GPU(WebGL2)で計算する(画面の表示を速くする。順・式は下の CPU の計算と同じ)
// 大きな範囲の平均(ガイデッドフィルター)は、縮めた絵(512 px 以下)だけを CPU で計算し、係数を GPU に渡す。使えないときは CPU で計算する
let GL = null, gpuOn = true;
export function setAdjGpu(on) { gpuOn = !!on; } // 確かめる用(false で CPU だけ)
const GHEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
out vec4 o;
uniform float uf; uniform ivec2 ius;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float toL(float v){ return v > 0. ? pow(v, 2.2) : 0.; }
float toS(float v){ return v > 0. ? pow(v, 1. / 2.2) : 0.; }
vec3 toL3(vec3 c){ return vec3(toL(c.r), toL(c.g), toL(c.b)); }
vec3 toS3(vec3 c){ return vec3(toS(c.r), toS(c.g), toS(c.b)); }
float ss(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
vec3 setL(vec3 c, float L, float L2){ return L > 1e-3 ? c * (L2 / L) : c + (L2 - L); }
float mn3(vec3 c){ return min(min(c.r, c.g), c.b); }
float mx3(vec3 c){ return max(max(c.r, c.g), c.b); }
ivec2 P0(){ return ivec2(gl_FragCoord.xy); }
vec4 upS(sampler2D t, ivec2 q){
  vec2 u = clamp((vec2(q) + 0.5) / uf - 0.5, vec2(0.), vec2(ius - 1)); ivec2 i0 = ivec2(floor(u)), i1 = min(i0 + 1, ius - 1); vec2 fr = u - vec2(i0);
  vec4 a = mix(texelFetch(t, i0, 0), texelFetch(t, ivec2(i1.x, i0.y), 0), fr.x), b = mix(texelFetch(t, ivec2(i0.x, i1.y), 0), texelFetch(t, i1, 0), fr.x);
  return mix(a, b, fr.y);
}
`;
const GSRC = {
  copy: `uniform sampler2D T; void main(){ o = texelFetch(T, P0(), 0); }`,
  resample: `uniform sampler2D T; uniform ivec2 isz; void main(){ o = texture(T, (vec2(P0()) + 0.5) / vec2(isz)); }`,
  gauss: `uniform sampler2D T; uniform ivec2 idir, isz; uniform int ir; uniform float sig;
    void main(){ ivec2 q = P0(); vec4 s = vec4(0.); float ws = 0.;
      for (int k = -ir; k <= ir; k++) { float w = exp(-float(k * k) / (2. * sig * sig)); s += texelFetch(T, clamp(q + idir * k, ivec2(0), isz - 1), 0) * w; ws += w; }
      o = s / ws; }`,
  box: `uniform sampler2D T; uniform ivec2 idir, isz; uniform int ir, imode;
    void main(){ ivec2 q = P0(); vec4 s = vec4(0.); float n = 0.;
      for (int k = -ir; k <= ir; k++) { ivec2 p = q + idir * k; if (p.x < 0 || p.y < 0 || p.x >= isz.x || p.y >= isz.y) continue; vec4 v = texelFetch(T, p, 0); s += imode == 1 ? v * v : v; n += 1.; }
      o = s / n; }`,
  gcoef: `uniform sampler2D TI, TII; uniform int imode; uniform float eps;
    void main(){ ivec2 q = P0(); vec3 m = texelFetch(TI, q, 0).rgb, v = max(vec3(0.), texelFetch(TII, q, 0).rgb - m * m), A = v / (v + eps);
      o = vec4(imode == 0 ? A : m - A * m, 1.); }`,
  dnapply: `uniform sampler2D C, MA, MB; uniform float d;
    void main(){ ivec2 q = P0(); vec4 c = texelFetch(C, q, 0); vec3 qq = texelFetch(MA, q, 0).rgb * c.rgb + texelFetch(MB, q, 0).rgb; o = vec4(c.rgb + d * (qq - c.rgb), c.a); }`,
  sharp: `uniform sampler2D C, B; uniform ivec2 isz; uniform float k;
    void main(){ ivec2 q = P0(); vec4 c = texelFetch(C, q, 0); vec3 b = texture(B, (vec2(q) + 0.5) / vec2(isz)).rgb; o = vec4(c.rgb + k * (c.rgb - b), c.a); }`,
  small: `uniform sampler2D T; uniform ivec2 isz; uniform int if_, imode;
    void main(){ ivec2 b = P0() * if_; vec2 s = vec2(0.); float n = 0.;
      for (int dy = 0; dy < if_; dy++) for (int dx = 0; dx < if_; dx++) { ivec2 p = b + ivec2(dx, dy); if (p.x >= isz.x || p.y >= isz.y) continue; vec3 c = texelFetch(T, p, 0).rgb;
        s += imode == 0 ? vec2(mn3(c), mx3(c)) : vec2(log2(lum(toL3(c)) + 1e-4), 0.); n += 1.; }
      o = vec4(s / n, 0., 1.); }`,
  dehaze: `uniform sampler2D C, K; uniform float dh, Ah;
    void main(){ ivec2 q = P0(); vec4 c = texelFetch(C, q, 0); vec3 r = c.rgb;
      if (dh > 0.) { vec2 ab = upS(K, q).xy; float t = max(0.25, 1. - 0.95 * dh * clamp(ab.x * mn3(r) + ab.y, 0., 1.) / Ah); r = (r - Ah) / t + Ah; }
      else r += -dh * 0.45 * (Ah - r);
      o = vec4(r, c.a); }`,
  expo: `uniform sampler2D C; uniform float ek; void main(){ vec4 c = texelFetch(C, P0(), 0); o = vec4(toS3(toL3(c.rgb) * ek), c.a); }`,
  hdr: `uniform sampler2D C, K; uniform float an, k, dk, sc;
    void main(){ ivec2 q = P0(); vec4 c = texelFetch(C, q, 0); vec3 lc = toL3(c.rgb); float Ll = lum(lc), l = log2(Ll + 1e-4); vec2 ab = upS(K, q).xy; float base = ab.x * l + ab.y;
      float b2 = an + (base - an) * (1. - k), L2 = max(0., exp2(b2 + (l - base) * dk) - 1e-4), L0 = max(Ll, 1e-6);
      o = vec4(toS3(min(vec3(1.), pow(lc / L0, vec3(sc)) * L2)), c.a); }`,
  final: `uniform sampler2D C, S, Bc, Bl, Bg; uniform ivec2 isz; uniform int iflip, ic, il, ig, ihue;
    uniform float clar, lig, gm, high, shad, white, con, black, sat, vib, hc, hs, temp, tint, sg, hg, glow, vig, grain; uniform vec3 bcol, scol, hcol;
    float hash2(ivec2 p){ uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u; h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u; return float(h) / 4294967296.; }
    float con1(float v){ if (con > 0.) { float u = clamp(v, 0., 1.); return v + con * (u * u * (3. - 2. * u) - v) * 1.5; } return v + con * (v - 0.5) * 0.7; }
    void main(){ ivec2 q = P0(); ivec2 p = ivec2(q.x, iflip == 1 ? isz.y - 1 - q.y : q.y);
      vec4 s0 = texelFetch(S, p, 0); if (s0.a <= 0.) { o = s0; return; }
      vec3 c = texelFetch(C, p, 0).rgb; vec2 uv = (vec2(p) + 0.5) / vec2(isz);
      if (ic == 1) { float L = clamp(lum(c), 0., 1.), Lc = lum(texture(Bc, uv).rgb); c = setL(c, L, L + clar * 0.8 * (L - Lc) * (1. - (2. * L - 1.) * (2. * L - 1.))); }
      if (il == 1) { float L = clamp(lum(c), 0., 1.), Lb = lum(texture(Bl, uv).rgb); c = setL(c, L, min(1., L * exp2(lig * (Lb < 0.5 ? 1.6 : 0.6) * (0.5 - Lb)))); }
      if (gm != 1.) c = pow(max(c, vec3(0.)), vec3(gm));
      if (high != 0. || shad != 0.) { float L = clamp(lum(c), 0., 1.), dL = 0.;
        if (high != 0.) { float wh = ss(0.45, 1., L); dL += high > 0. ? high * 0.35 * wh * (1. - L) : high * 0.45 * wh * L; }
        if (shad != 0.) { float ws = 1. - ss(0., 0.55, L); dL += shad > 0. ? shad * 0.5 * ws * (1. - L) : shad * 0.5 * ws * L; }
        c = setL(c, L, L + dL); }
      if (white > 0.) c /= 1. - white * 0.15; else if (white < 0.) c *= 1. + white * 0.15;
      if (con != 0.) c = vec3(con1(c.r), con1(c.g), con1(c.b));
      if (black < 0.) { float t = -black * 0.12; c = (c - t) / (1. - t); } else if (black > 0.) { float t = black * 0.25; c = c * (1. - t) + t * bcol; }
      if (sat != 0. || vib != 0.) { float L = lum(c), f = 1. + sat; if (vib != 0.) f *= 1. + vib * (1. - clamp(mx3(c) - mn3(c), 0., 1.)) * 1.2; c = L + (c - L) * f; }
      if (ihue == 1) { float Y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b, I0 = 0.596 * c.r - 0.274 * c.g - 0.322 * c.b, Q0 = 0.211 * c.r - 0.523 * c.g + 0.312 * c.b;
        float I = I0 * hc - Q0 * hs, Q = I0 * hs + Q0 * hc; c = vec3(Y + 0.956 * I + 0.621 * Q, Y - 0.272 * I - 0.647 * Q, Y - 1.106 * I + 1.703 * Q); }
      if (temp != 0.) c *= vec3(1. + temp * 0.18, 1. + temp * 0.03, 1. - temp * 0.18);
      if (tint != 0.) c *= vec3(1. + tint * 0.04, 1. - tint * 0.15, 1. + tint * 0.04);
      if (sg > 1e-4 || hg > 1e-4) { float L = clamp(lum(c), 0., 1.), ws = sg * 0.5 * (1. - ss(0., 0.6, L)), wh = hg * 0.5 * ss(0.4, 1., L); c += ws * (scol - 0.5) + wh * (hcol - 0.5); }
      if (ig == 1) c = 1. - (1. - clamp(c, 0., 1.)) * (1. - glow * (0.6 * texture(Bg, uv).rgb + 0.15));
      if (vig != 0.) { vec2 v = uv - 0.5; float mv = ss(0.3, 1., length(v) / 0.7071); if (vig < 0.) c *= 1. + vig * 0.85 * mv; else c += vig * 0.6 * mv * (1. - c); }
      if (grain > 1e-4) c += (hash2(p) - 0.5) * grain * 0.22;
      o = vec4(clamp(c, 0., 1.), s0.a); }`,
};
function glInit() {
  if (GL) return GL.ok ? GL : null;
  GL = { ok: false };
  try {
    const cv = document.createElement("canvas");
    const gl = cv.getContext("webgl2", { premultipliedAlpha: false, antialias: false, depth: false, stencil: false, alpha: true });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const vs = sh(gl.VERTEX_SHADER, "#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }");
    const P = {};
    for (const [k, src] of Object.entries(GSRC)) {
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, GHEAD + src)); gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const locs = new Map();
      P[k] = { p, loc: (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(p, n)); return locs.get(n); } };
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const mk = (filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
    const dummy = { t: mk(gl.NEAREST), w: 1, h: 1 };
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    cv.addEventListener("webglcontextlost", () => { GL.ok = false; });
    Object.assign(GL, { ok: true, cv, gl, P, fb: gl.createFramebuffer(), T: {}, S: { t: mk(gl.LINEAR) }, mk, dummy, max: gl.getParameter(gl.MAX_TEXTURE_SIZE) });
    return GL;
  } catch (e) { console.warn("[CCA Generator] GPU で補正できないので、CPU で計算します", e); GL.ok = false; return null; }
}
// 名前ごとの作業用の絵(大きさ・種類が変わったら作り直す)。f32: 計算用(NEAREST)、f16: ぼかし(LINEAR で拡大して使う)
function gtex(key, w, h, fmt) {
  const { gl } = GL;
  const t = GL.T[key];
  if (t && t.w === w && t.h === h && t.fmt === fmt) return t;
  if (t) gl.deleteTexture(t.t);
  const tt = GL.mk(fmt === "f16" ? gl.LINEAR : gl.NEAREST);
  gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === "f16" ? gl.RGBA16F : gl.RGBA32F, w, h);
  return (GL.T[key] = { t: tt, w, h, fmt });
}
function grun(name, out, U = {}, Tx = {}) {
  const { gl } = GL, p = GL.P[name];
  gl.useProgram(p.p);
  if (out) { gl.bindFramebuffer(gl.FRAMEBUFFER, GL.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.t, 0); gl.viewport(0, 0, out.w, out.h); }
  else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, GL.cv.width, GL.cv.height); }
  let u = 0;
  for (const [k, t] of Object.entries(Tx)) { const loc = p.loc(k); if (!loc) continue; gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, (t || GL.dummy).t); gl.uniform1i(loc, u++); }
  for (const [k, v] of Object.entries(U)) {
    const loc = p.loc(k);
    if (!loc) continue;
    const arr = Array.isArray(v) ? v : [v];
    if (k[0] === "i") [null, gl.uniform1iv, gl.uniform2iv, gl.uniform3iv][arr.length].call(gl, loc, arr.map((x) => Math.round(x)));
    else [null, gl.uniform1fv, gl.uniform2fv, gl.uniform3fv][arr.length].call(gl, loc, arr);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
// GPU で補正する。できたら true
function glAdjust(cv, a, P) {
  if (!gpuOn || !glInit()) return false;
  const W = cv.width, H = cv.height, m = Math.min(W, H);
  if (W > GL.max || H > GL.max) return false;
  try {
    const { gl } = GL;
    gl.bindTexture(gl.TEXTURE_2D, GL.S.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    const S = { t: GL.S.t, w: W, h: H }, sz = [W, H];
    let cur = gtex("c0", W, H, "f32"), alt = gtex("c1", W, H, "f32");
    const swap = () => { const t = cur; cur = alt; alt = t; };
    grun("copy", cur, {}, { T: S });
    // 元の絵のぼかし(大きなぼかしは縮めてから。CPU と同じやり方)
    const blur = (key, on) => {
      if (!on) return null;
      const sigma = sigOf(key, m), f = sigma >= 8 ? sigma / 4 : 1, w = Math.max(1, Math.round(W / f)), h = Math.max(1, Math.round(H / f)), s2 = sigma / f;
      const a1 = gtex(`b${key}0`, w, h, "f16"), a2 = gtex(`b${key}1`, w, h, "f16"), a3 = gtex(`b${key}`, w, h, "f16");
      grun("resample", a1, { isz: [w, h] }, { T: S });
      const r = Math.max(1, Math.ceil(3 * s2));
      grun("gauss", a2, { idir: [1, 0], isz: [w, h], ir: r, sig: s2 }, { T: a1 });
      grun("gauss", a3, { idir: [0, 1], isz: [w, h], ir: r, sig: s2 }, { T: a2 });
      return a3;
    };
    const Bs = blur("sharp", Math.abs(P.sharp) > 1e-4), Bc = blur("clarity", Math.abs(P.clarity) > 1e-4), Bl = blur("light", Math.abs(P.light) > 1e-4), Bg = blur("glow", P.glow > 1e-4);
    const boxF = (src, dst, r, mode, tmp) => { grun("box", tmp, { idir: [1, 0], isz: sz, ir: r, imode: mode }, { T: src }); grun("box", dst, { idir: [0, 1], isz: sz, ir: r, imode: 0 }, { T: tmp }); };
    // 1. ノイズ低減
    if (P.denoise > 1e-4) {
      const r = Math.max(1, Math.round(0.003 * m)), eps = (0.02 + 0.08 * P.denoise) ** 2;
      const t1 = gtex("t1", W, H, "f32"), t2 = gtex("t2", W, H, "f32"), t3 = gtex("t3", W, H, "f32"), t4 = gtex("t4", W, H, "f32"), t5 = gtex("t5", W, H, "f32");
      boxF(cur, t2, r, 0, t1); boxF(cur, t3, r, 1, t1);
      grun("gcoef", t4, { imode: 0, eps }, { TI: t2, TII: t3 }); grun("gcoef", t5, { imode: 1, eps }, { TI: t2, TII: t3 });
      boxF(t4, t2, r, 0, t1); boxF(t5, t3, r, 0, t1);
      grun("dnapply", alt, { d: P.denoise }, { C: cur, MA: t2, MB: t3 }); swap();
    }
    // 2. シャープ
    if (Bs) { grun("sharp", alt, { k: P.sharp > 0 ? P.sharp * 1.5 : P.sharp, isz: sz }, { C: cur, B: Bs }); swap(); }
    // 縮めた値(区画の平均)を読み出す。mode 0: 暗い色の成分・明るい色の成分、1: 明るさの対数
    const smallOf = (mode) => {
      const f = Math.max(1, Math.ceil(Math.max(W, H) / 512)), w = Math.ceil(W / f), h = Math.ceil(H / f), t = gtex("sm", w, h, "f32");
      grun("small", t, { isz: sz, if_: f, imode: mode }, { T: cur });
      const d = new Float32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, d);
      return { d, w, h, f };
    };
    const coef = (s, g) => {
      const t = gtex("k", s.w, s.h, "f32"), d = new Float32Array(s.w * s.h * 4);
      for (let i = 0; i < s.w * s.h; i++) { d[i * 4] = g.mA[i]; d[i * 4 + 1] = g.mB[i]; }
      gl.bindTexture(gl.TEXTURE_2D, t.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s.w, s.h, gl.RGBA, gl.FLOAT, d);
      return t;
    };
    const pick = (s, c) => { const n = s.w * s.h, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = s.d[i * 4 + c]; return out; };
    // 3. かすみ除去
    if (P.dehaze) {
      const s = smallOf(0), g = guidedSmall(pick(s, 0), s.w, s.h, 0.03, 0.01), A = clamp(pct(pick(s, 1), 0.999), 0.6, 1);
      grun("dehaze", alt, { dh: P.dehaze, Ah: A, uf: s.f, ius: [s.w, s.h] }, { C: cur, K: coef(s, g) }); swap();
    }
    // 4. 露光量
    if (P.exposure) { grun("expo", alt, { ek: 2 ** (2 * P.exposure) }, { C: cur }); swap(); }
    // 5. HDR・ディテール
    if (P.hdr > 1e-4 || P.detail) {
      const s = smallOf(1), g = guidedSmall(pick(s, 0), s.w, s.h, 0.025, 0.12), k = 0.65 * P.hdr;
      grun("hdr", alt, { an: pct(g.small, 0.97), k, dk: 1 + 1.2 * P.detail, sc: 1 - 0.45 * k, uf: s.f, ius: [s.w, s.h] }, { C: cur, K: coef(s, g) }); swap();
    }
    // 6〜19. 画素ごとの補正 → 表示用の canvas
    const th = (P.hue * Math.PI) / 180;
    GL.cv.width = W; GL.cv.height = H;
    grun("final", null, {
      isz: sz, iflip: 1, ic: Bc ? 1 : 0, il: Bl ? 1 : 0, ig: Bg ? 1 : 0, ihue: P.hue ? 1 : 0,
      clar: P.clarity, lig: P.light, gm: P.bright ? 2 ** -P.bright : 1, high: P.high, shad: P.shadow, white: P.white, con: P.contrast, black: P.black, sat: P.sat, vib: P.vib,
      hc: Math.cos(th), hs: Math.sin(th), temp: P.temp, tint: P.tint, sg: P.sgrade, hg: P.hgrade, glow: P.glow, vig: P.vignette, grain: P.grain,
      bcol: hexRgb(a.bcolor, COLORS.bcolor), scol: hexRgb(a.scolor, COLORS.scolor), hcol: hexRgb(a.hcolor, COLORS.hcolor),
    }, { C: cur, S, Bc, Bl, Bg });
    if (gl.isContextLost()) return false;
    const g2 = cv.getContext("2d");
    g2.save(); g2.setTransform(1, 0, 0, 1, 0, 0); g2.globalCompositeOperation = "copy"; g2.globalAlpha = 1; g2.filter = "none"; g2.drawImage(GL.cv, 0, 0); g2.restore();
    return true;
  } catch (e) { console.warn("[CCA Generator] GPU で補正できないので、CPU で計算します", e); GL.ok = false; return false; }
}

// ---------------------------------------------------------------- 範囲を選ぶ(色・パス)
// sel = { on(選んだ範囲だけに掛ける), col(色で選ぶ), color, thr(しきい値 0〜1), soft(ぼかし: 短い辺に対して 0〜0.2),
//   path: [[u, v], …](パスの形。0〜1、曲線は折れ線にしたもの), more: [path, …](足した範囲。無くてもよい), pmode: "in" | "out", act: "adj"(補正する)| "cut"(消す)}
// 色とパスの両方を使うときは、両方に入る所(パスの中の、その色の所)。書き出し adjust.py の sel_mask と同じ
export const selOn = (s) => !!s?.on && (!!s.col || (s.path?.length >= 3 && (s.pmode === "in" || s.pmode === "out")));
export const adjActive = (a, s) => adjOn(a) || (selOn(s) && s.act === "cut");
export const selSig = (s) => (selOn(s) ? JSON.stringify([s.col ? [s.color, s.thr] : 0, s.soft, s.pmode, s.path, s.more || 0, s.act]) : "");
// パスの点 [{ x, y, hi?, ho? }](hi / ho: 入る / 出る側の曲線のハンドル [dx, dy])を、閉じた折れ線 [[x, y], …] にする
export function flattenPath(P) {
  const out = [], n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    out.push([a.x, a.y]);
    if (!a.ho && !b.hi) continue;
    const c0 = [a.x + (a.ho?.[0] || 0), a.y + (a.ho?.[1] || 0)], c1 = [b.x + (b.hi?.[0] || 0), b.y + (b.hi?.[1] || 0)];
    for (let k = 1; k < 16; k++) {
      const t = k / 16, u = 1 - t;
      out.push([u * u * u * a.x + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * b.x, u * u * u * a.y + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * b.y]);
    }
  }
  return out.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
}
// 選んだ所の canvas(白。不透明度 = 選んだ度合い)
function selMaskCanvas(src, W, H, s) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (s.col) {
    const d = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data, im = g.createImageData(W, H), o = im.data;
    const [cr, cg, cb] = hexRgb(s.color, "#ff0000").map((v) => v * 255), t2 = (clamp(Number(s.thr ?? 0.2), 0, 1) * 441.673) ** 2; // 441.673 = 255 × √3(色の差のいちばん大きい値)
    for (let i = 0; i < d.length; i += 4) { const dr = d[i] - cr, dg = d[i + 1] - cg, db = d[i + 2] - cb; o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = d[i + 3] && dr * dr + dg * dg + db * db <= t2 ? 255 : 0; }
    g.putImageData(im, 0, 0);
  } else { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); }
  if ((s.pmode === "in" || s.pmode === "out") && s.path?.length >= 3) {
    // パス(と、足した範囲 more)をまとめて 1 枚の板に白く塗ってから、内側 / 外側を使う
    const pm = document.createElement("canvas");
    pm.width = W; pm.height = H;
    const pg = pm.getContext("2d");
    pg.fillStyle = "#fff";
    for (const poly of [s.path, ...(s.more || [])]) {
      if (!(poly?.length >= 3)) continue;
      pg.beginPath();
      poly.forEach(([u, v], i) => (i ? pg.lineTo(u * W, v * H) : pg.moveTo(u * W, v * H)));
      pg.closePath(); pg.fill();
    }
    g.globalCompositeOperation = s.pmode === "out" ? "destination-out" : "destination-in";
    g.drawImage(pm, 0, 0);
  }
  const sg = clamp(Number(s.soft ?? 0), 0, 0.2) * Math.min(W, H);
  if (sg <= 0.3) return c;
  const b = document.createElement("canvas");
  b.width = W; b.height = H;
  const gb = b.getContext("2d");
  gb.filter = `blur(${sg}px)`;
  gb.drawImage(c, 0, 0);
  return b;
}
// 背景を消した絵 cv の、選んだ所の外を元の絵 orig に戻す(選んだ範囲の内側だけ消す。書き出し videoedit.py の to_rgba と同じ)
export function keepOutsideSel(cv, orig, s) {
  if (!selOn(s) || !cv.width || !cv.height) return;
  const W = cv.width, H = cv.height, m = selMaskCanvas(orig, W, H, s), g = cv.getContext("2d");
  const t = document.createElement("canvas");
  t.width = W; t.height = H;
  const tg = t.getContext("2d");
  tg.drawImage(cv, 0, 0); tg.globalCompositeOperation = "destination-in"; tg.drawImage(m, 0, 0);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = "none";
  g.globalCompositeOperation = "copy"; g.drawImage(orig, 0, 0);
  g.globalCompositeOperation = "destination-out"; g.drawImage(m, 0, 0);
  g.globalCompositeOperation = "lighter"; g.drawImage(t, 0, 0);
  g.restore();
}
// canvas の絵に補正を掛ける(その場で書き換える)。s: 範囲を選ぶ(選んだ所だけ補正する・消す)
export function adjustCanvas(cv, a, s = null) {
  if (!cv.width || !cv.height || !adjActive(a, s)) return;
  if (!selOn(s)) { adjustWhole(cv, a); return; }
  const W = cv.width, H = cv.height, mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const orig = mk();
  orig.getContext("2d").drawImage(cv, 0, 0);
  const m = selMaskCanvas(orig, W, H, s), g = cv.getContext("2d");
  if (adjOn(a)) adjustWhole(cv, a);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = "none";
  if (s.act === "cut") { g.globalCompositeOperation = "destination-out"; g.drawImage(m, 0, 0); g.restore(); return; } // 選んだ所を消す(ほかは補正だけ)
  // 補正した絵 × 選んだ度合い + 元の絵 × (1 - 選んだ度合い)
  const t = mk(), tg = t.getContext("2d");
  tg.drawImage(cv, 0, 0); tg.globalCompositeOperation = "destination-in"; tg.drawImage(m, 0, 0);
  g.globalCompositeOperation = "copy"; g.drawImage(orig, 0, 0);
  g.globalCompositeOperation = "destination-out"; g.drawImage(m, 0, 0);
  g.globalCompositeOperation = "lighter"; g.drawImage(t, 0, 0);
  g.restore();
}
// 絵全体に補正を掛ける。GPU が使えれば GPU で(速い)、使えなければ CPU で
function adjustWhole(cv, a) {
  if (!adjOn(a) || !cv.width || !cv.height) return;
  const W = cv.width, H = cv.height, m = Math.min(W, H);
  const P = Object.fromEntries(KEYS.map((k) => [k, Number(a[k]) || 0]));
  if (glAdjust(cv, a, P)) return;
  const g = cv.getContext("2d", { willReadFrequently: true });
  let im;
  try { im = g.getImageData(0, 0, W, H); } catch { return; }
  const blur = (k) => (Math.abs(P[k]) > 1e-4 ? blurData(cv, W, H, sigOf(k, m)) : null);
  adjustData(im.data, W, H, P, a, { s: blur("sharp"), c: blur("clarity"), l: blur("light"), g: P.glow > 1e-4 ? blur("glow") : null });
  g.putImageData(im, 0, 0);
}
// 明るさ L を L2 にする(色の濃さを保つように、比で掛ける。真っ黒に近い所は足す)
const setL = (c, L, L2) => (L > 1e-3 ? c * (L2 / L) : c + (L2 - L));
// 画素の計算(書き出し adjust.py の adjust_array と同じ順・同じ式)
export function adjustData(d, W, H, P, a, B) {
  const N = W * H, m = Math.min(W, H);
  const R = new Float32Array(N), G = new Float32Array(N), Bl = new Float32Array(N);
  for (let i = 0, j = 0; j < N; i += 4, j++) { R[j] = d[i] / 255; G[j] = d[i + 1] / 255; Bl[j] = d[i + 2] / 255; }
  const each = (fn) => { for (let j = 0; j < N; j++) fn(j); };
  // 1. ノイズ低減(ふちを残してならす。小さな半径なので縮めない)
  if (P.denoise > 1e-4) {
    const eps = (0.02 + 0.08 * P.denoise) ** 2, rk = Math.max(1, Math.round(0.003 * m)) / Math.min(W, H);
    for (const X of [R, G, Bl]) { const { q } = guided(X, W, H, rk, eps, 1e9); for (let j = 0; j < N; j++) X[j] += P.denoise * (q[j] - X[j]); }
  }
  // 2. シャープ(元の絵のぼかしとの差を強める)
  if (B.s) { const k = P.sharp > 0 ? P.sharp * 1.5 : P.sharp; each((j) => { const i = j * 4; R[j] += k * (R[j] - B.s[i] / 255); G[j] += k * (G[j] - B.s[i + 1] / 255); Bl[j] += k * (Bl[j] - B.s[i + 2] / 255); }); }
  // 3. かすみ除去(暗い色の成分 = かすみの濃さ。空気の色 A を引いて、かすみの分を戻す)
  if (P.dehaze) {
    const dark = new Float32Array(N), mx = new Float32Array(N);
    each((j) => { dark[j] = Math.min(R[j], G[j], Bl[j]); mx[j] = Math.max(R[j], G[j], Bl[j]); });
    const { q } = guided(dark, W, H, 0.03, 0.01);
    const A = clamp(pct(down(mx, W, H, Math.max(1, Math.ceil(Math.max(W, H) / 512))).a, 0.999), 0.6, 1);
    if (P.dehaze > 0) each((j) => { const t = Math.max(0.25, 1 - 0.95 * P.dehaze * clamp(q[j], 0, 1) / A); R[j] = (R[j] - A) / t + A; G[j] = (G[j] - A) / t + A; Bl[j] = (Bl[j] - A) / t + A; });
    else { const hz = -P.dehaze * 0.45; each((j) => { R[j] += hz * (A - R[j]); G[j] += hz * (A - G[j]); Bl[j] += hz * (A - Bl[j]); }); }
  }
  // 4. 露光量(光の量を 2 の何乗倍)
  if (P.exposure) { const k = 2 ** (2 * P.exposure); each((j) => { R[j] = toS(toL(R[j]) * k); G[j] = toS(toL(G[j]) * k); Bl[j] = toS(toL(Bl[j]) * k); }); }
  // 5. HDR(トーンマッピング)・ディテール: 明るさの対数を、ベース(ふちを残してならしたもの)とディテールに分ける
  if (P.hdr > 1e-4 || P.detail) {
    const l = new Float32Array(N), Ll = new Float32Array(N);
    each((j) => { Ll[j] = lum(toL(R[j]), toL(G[j]), toL(Bl[j])); l[j] = Math.log2(Ll[j] + 1e-4); });
    const { q: base, small } = guided(l, W, H, 0.025, 0.12);
    // 色: 明るさの比を保ったまま、持ち上げた所の色が濃くなりすぎないように、色の比を sc 乗(トーンマッピングの色の補正)
    const anchor = pct(small, 0.97), k = 0.65 * P.hdr, dk = 1 + 1.2 * P.detail, sc = 1 - 0.45 * k;
    each((j) => {
      const b2 = anchor + (base[j] - anchor) * (1 - k), L2 = Math.max(0, 2 ** (b2 + (l[j] - base[j]) * dk) - 1e-4), L0 = Math.max(Ll[j], 1e-6);
      R[j] = toS(Math.min(1, (toL(R[j]) / L0) ** sc * L2)); G[j] = toS(Math.min(1, (toL(G[j]) / L0) ** sc * L2)); Bl[j] = toS(Math.min(1, (toL(Bl[j]) / L0) ** sc * L2));
    });
  }
  const [br, bg, bb] = hexRgb(a.bcolor, COLORS.bcolor), [sr, sg, sb] = hexRgb(a.scolor, COLORS.scolor), [hr, hg, hb] = hexRgb(a.hcolor, COLORS.hcolor);
  const gm = 2 ** -P.bright, th = (P.hue * Math.PI) / 180, ch = Math.cos(th), sh = Math.sin(th);
  for (let y = 0, j = 0; y < H; y++) {
    const vy = (y + 0.5) / H - 0.5;
    for (let x = 0; x < W; x++, j++) {
      const i = j * 4;
      if (d[i + 3] === 0) continue;
      let r = R[j], g = G[j], b = Bl[j];
      // 6. 鮮明度(中くらいの大きさの明暗)
      if (B.c) {
        const L = clamp(lum(r, g, b), 0, 1), Lc = lum(B.c[i], B.c[i + 1], B.c[i + 2]) / 255;
        const L2 = L + P.clarity * 0.8 * (L - Lc) * (1 - (2 * L - 1) ** 2); r = setL(r, L, L2); g = setL(g, L, L2); b = setL(b, L, L2);
      }
      // 7. ライティング
      if (B.l) {
        const L = clamp(lum(r, g, b), 0, 1), Ll = lum(B.l[i], B.l[i + 1], B.l[i + 2]) / 255;
        const L2 = Math.min(1, L * 2 ** (P.light * (Ll < 0.5 ? 1.6 : 0.6) * (0.5 - Ll))); r = setL(r, L, L2); g = setL(g, L, L2); b = setL(b, L, L2);
      }
      // 8. 明るさ(中間の明るさ)
      if (P.bright) { r = Math.max(r, 0) ** gm; g = Math.max(g, 0) ** gm; b = Math.max(b, 0) ** gm; }
      // 9. ハイライト・シャドウ
      if (P.high || P.shadow) {
        const L = clamp(lum(r, g, b), 0, 1);
        let dL = 0;
        if (P.high) { const wh = ss(0.45, 1, L); dL += P.high > 0 ? P.high * 0.35 * wh * (1 - L) : P.high * 0.45 * wh * L; }
        if (P.shadow) { const ws = 1 - ss(0, 0.55, L); dL += P.shadow > 0 ? P.shadow * 0.5 * ws * (1 - L) : P.shadow * 0.5 * ws * L; }
        r = setL(r, L, L + dL); g = setL(g, L, L + dL); b = setL(b, L, L + dL);
      }
      // 10. 白レベル
      if (P.white > 0) { const t = 1 - P.white * 0.15; r /= t; g /= t; b /= t; } else if (P.white < 0) { const t = 1 + P.white * 0.15; r *= t; g *= t; b *= t; }
      // 11. コントラスト
      if (P.contrast) {
        const c = P.contrast;
        const f = (v) => { if (c > 0) { const u = clamp(v, 0, 1); return v + c * (u * u * (3 - 2 * u) - v) * 1.5; } return v + c * (v - 0.5) * 0.7; };
        r = f(r); g = f(g); b = f(b);
      }
      // 12. 黒レベル
      if (P.black < 0) { const t = -P.black * 0.12; r = (r - t) / (1 - t); g = (g - t) / (1 - t); b = (b - t) / (1 - t); }
      else if (P.black > 0) { const t = P.black * 0.25; r = r * (1 - t) + t * br; g = g * (1 - t) + t * bg; b = b * (1 - t) + t * bb; }
      // 13. 彩度・自然な彩度
      if (P.sat || P.vib) {
        const L = lum(r, g, b);
        let f = 1 + P.sat;
        if (P.vib) { const cr = clamp(Math.max(r, g, b) - Math.min(r, g, b), 0, 1); f *= 1 + P.vib * (1 - cr) * 1.2; }
        r = L + (r - L) * f; g = L + (g - L) * f; b = L + (b - L) * f;
      }
      // 14. 色相
      if (P.hue) {
        const Y = 0.299 * r + 0.587 * g + 0.114 * b, I0 = 0.596 * r - 0.274 * g - 0.322 * b, Q0 = 0.211 * r - 0.523 * g + 0.312 * b;
        const I = I0 * ch - Q0 * sh, Q = I0 * sh + Q0 * ch;
        r = Y + 0.956 * I + 0.621 * Q; g = Y - 0.272 * I - 0.647 * Q; b = Y - 1.106 * I + 1.703 * Q;
      }
      // 15. 色温度・色かぶり
      if (P.temp) { r *= 1 + P.temp * 0.18; g *= 1 + P.temp * 0.03; b *= 1 - P.temp * 0.18; }
      if (P.tint) { g *= 1 - P.tint * 0.15; r *= 1 + P.tint * 0.04; b *= 1 + P.tint * 0.04; }
      // 16. カラーグレーディング(暗い所・明るい所に色)
      if (P.sgrade > 1e-4 || P.hgrade > 1e-4) {
        const L = clamp(lum(r, g, b), 0, 1), ws = P.sgrade * 0.5 * (1 - ss(0, 0.6, L)), wh = P.hgrade * 0.5 * ss(0.4, 1, L);
        r += ws * (sr - 0.5) + wh * (hr - 0.5); g += ws * (sg - 0.5) + wh * (hg - 0.5); b += ws * (sb - 0.5) + wh * (hb - 0.5);
      }
      // 17. ふんわり
      if (B.g) {
        const k = P.glow;
        r = 1 - (1 - clamp(r, 0, 1)) * (1 - k * (0.6 * B.g[i] / 255 + 0.15));
        g = 1 - (1 - clamp(g, 0, 1)) * (1 - k * (0.6 * B.g[i + 1] / 255 + 0.15));
        b = 1 - (1 - clamp(b, 0, 1)) * (1 - k * (0.6 * B.g[i + 2] / 255 + 0.15));
      }
      // 18. 周辺の明るさ
      if (P.vignette) {
        const vx = (x + 0.5) / W - 0.5, mv = ss(0.3, 1.0, Math.sqrt(vx * vx + vy * vy) / 0.7071);
        if (P.vignette < 0) { const k = 1 + P.vignette * 0.85 * mv; r *= k; g *= k; b *= k; }
        else { const k = P.vignette * 0.6 * mv; r += k * (1 - r); g += k * (1 - g); b += k * (1 - b); }
      }
      // 19. 粒子
      if (P.grain > 1e-4) { const n = (hash2(x, y) - 0.5) * P.grain * 0.22; r += n; g += n; b += n; }
      d[i] = clamp(r, 0, 1) * 255; d[i + 1] = clamp(g, 0, 1) * 255; d[i + 2] = clamp(b, 0, 1) * 255; // Uint8ClampedArray は四捨五入して入る
    }
  }
}
// 絵の明るさの分布(自動補正の決め手)。p2・p50・p98(明るさの 2%・50%・98%)・ch(色の強さの平均)
export function adjStats(src) {
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  const def = { p2: 0.05, p50: 0.5, p98: 0.95, ch: 0.2 };
  if (!sw || !sh) return def;
  const k = Math.min(1, 256 / Math.max(sw, sh)), W = Math.max(1, Math.round(sw * k)), H = Math.max(1, Math.round(sh * k));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  let d;
  try { g.drawImage(src, 0, 0, W, H); d = g.getImageData(0, 0, W, H).data; } catch { return def; }
  const hist = new Uint32Array(256);
  let n = 0, chs = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
    chs += (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255;
    n++;
  }
  if (!n) return def;
  const p = (q) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= q * n) return v / 255; } return 1; };
  return { p2: p(0.02), p50: p(0.5), p98: p(0.98), ch: chs / n };
}
// ワンボタンの自動補正(100% のときの値)
export const PRESETS = [["clear", "クリア"], ["hdr", "HDR"], ["vivid", "派手"], ["cute", "かわいい"], ["mood", "ムード"]];
const PRESET_NOTES = {
  clear: "もやを取って黒をしめ、くっきり・すっきりさせます", hdr: "明るい所はそのままに、暗い所を明るくします(トーンマッピング)", vivid: "クリアより色と黒をはっきり。自然な彩度を主に、色を強めます",
  cute: "やわらかく白くぼかし、黒を淡い色にして、ふんわり明るくします", mood: "明るい所を抑えて周りを暗くし、映画のような落ち着いた色に(真ん中はあまり暗くしません)",
};
export function presetAdj(name, s) {
  const r = (v) => Math.round(v * 1000) / 1000;
  const p = {};
  // 黒が浮いている(もや)ほど 1。もともと明るい絵(白い背景のイラストなど)は、もやとみなさない
  const haze = clamp((s.p2 - 0.03) / 0.12, 0, 1) * clamp((0.85 - s.p50) / 0.3, 0, 1);
  const dark = clamp((0.42 - s.p50) / 0.25, 0, 1); // 暗い絵ほど 1
  if (name === "clear") {
    // くっきり・すっきり: もやはかすみ除去で取り、黒をしめ、細かい所と質感を少し強める(色はほんの少しだけ)
    p.dehaze = 0.12 + 0.28 * haze; p.black = -(0.15 + 0.25 * haze); p.detail = 0.25; p.clarity = 0.2; p.sharp = 0.15; p.vib = 0.12;
    if (s.p98 < 0.9) p.white = 0.15;
  } else if (name === "hdr") {
    // 暗い絵ほど強く。ディテールを残し、色が薄くならないよう少し足す
    p.hdr = clamp(0.5 + (0.4 - s.p50) * 0.9, 0.35, 0.8); p.detail = 0.35; p.clarity = 0.1; p.vib = 0.1; if (s.p2 > 0.06) p.black = -0.15;
  } else if (name === "vivid") {
    // クリアより色と黒をはっきり: 自然な彩度を主に(肌は濃くなりにくい)、彩度は元の色が薄いほど足す。黒は深く、暗い所はつぶれないよう少し持ち上げる
    const ck = 1 - 0.5 * dark; // 暗い絵は、持ち上げた所の色が強く出るので控えめに
    p.vib = 0.22 * ck; p.sat = clamp(0.2 - s.ch * 0.6, 0.04, 0.16) * ck; p.contrast = 0.18 * (1 - 0.4 * dark); p.black = -(0.3 + 0.15 * haze) * (1 - 0.4 * dark); p.white = 0.1;
    p.dehaze = 0.1 + 0.15 * haze; p.clarity = 0.2; p.detail = 0.2; p.shadow = 0.12 + 0.1 * dark;
  } else if (name === "cute") {
    // ふんわり・明るく: コントラストと鮮明度を下げ、白くぼかし、黒を淡いピンクに。明るい所は桃色、暗い所は藤色に少し色付け
    p.exposure = 0.05 + 0.12 * dark; p.contrast = -0.1; p.high = -0.1; p.shadow = 0.15; p.black = 0.05; p.bcolor = "#f6d6e6";
    p.clarity = -0.2; p.detail = -0.2; p.dehaze = -0.05; p.glow = 0.12; p.sat = -0.08; p.vib = 0.4; p.temp = 0.03; p.tint = 0.04;
    p.sgrade = 0.15; p.scolor = "#b48cff"; p.hgrade = 0.15; p.hcolor = "#ffc4a8";
  } else if (name === "mood") {
    // 暗く落ち着いた映画のような色: 明るい所を抑え、黒を深く、色を少し抜き、暗い所は青緑、明るい所は少し暖色。周りを暗く(真ん中は暗くしない)
    p.exposure = -(0.08 + 0.12 * (1 - dark)); p.high = -0.3; p.shadow = -0.08; p.black = -0.15; p.contrast = 0.1; p.clarity = 0.15; p.dehaze = 0.06;
    p.sat = -0.07; p.vib = -0.05; p.light = -0.8; p.sgrade = 0.28; p.scolor = "#1f7a8c"; p.hgrade = 0.15; p.hcolor = "#ffb36b"; p.vignette = -0.5; p.hdr = 0.12 * (1 + dark);
  }
  for (const k of KEYS) if (p[k] != null) p[k] = r(p[k]);
  return p;
}
// キーフレームの間の補正(p: 0〜1。数は直線で、色は RGB を混ぜる)。書き出し adjust.py の lerp_adj と同じ
export function lerpAdj(a, b, p) {
  a = a || {}; b = b || {};
  const out = {};
  for (const k of KEYS) { const v = (Number(a[k]) || 0) + ((Number(b[k]) || 0) - (Number(a[k]) || 0)) * p; if (Math.abs(v) > 1e-4) out[k] = Math.round(v * 1000) / 1000; }
  for (const [k, d] of Object.entries(COLORS)) {
    if (!a[k] && !b[k]) continue;
    const x = hexRgb(a[k], d), y = hexRgb(b[k], d);
    out[k] = `#${x.map((v, i) => Math.round((v + (y[i] - v) * p) * 255).toString(16).padStart(2, "0")).join("")}`;
  }
  return out;
}
// 欄の値だけを入れ直す(再生位置を動かしたとき。作り直さない)
export function syncAdjPanel(box, a) {
  a = a || {};
  for (const [k] of ADJ_FIELDS) {
    const v = k === "hue" ? Math.round(Number(a[k]) || 0) : Math.round((Number(a[k]) || 0) * 100);
    for (const o of box.querySelectorAll(`[data-adj="${k}"],[data-adjn="${k}"]`)) if (o !== document.activeElement) o.value = v;
  }
  for (const [k, d] of Object.entries(COLORS)) for (const o of box.querySelectorAll(`[data-adjc="${k}"]`)) if (o !== document.activeElement) o.value = a[k] || d;
}
// 欄を作り直さずに、今の状態に合わせる(入力中で作り直せないとき・元に戻したとき)。
// 値・色・押したボタン・強さ・分類の ● をすべて合わせる。force: 入力中の欄も合わせる
export function syncAdjAll(box, item, force = false) {
  if (!box || !item) return;
  const a = item.adj || {};
  for (const [k] of ADJ_FIELDS) {
    const v = k === "hue" ? Math.round(Number(a[k]) || 0) : Math.round((Number(a[k]) || 0) * 100);
    for (const o of box.querySelectorAll(`[data-adj="${k}"],[data-adjn="${k}"]`)) if (force || o !== document.activeElement) o.value = v;
  }
  for (const [k, d] of Object.entries(COLORS)) for (const o of box.querySelectorAll(`[data-adjc="${k}"]`)) if (force || o !== document.activeElement) o.value = a[k] || d;
  for (const b of box.querySelectorAll("[data-adjp]")) b.classList.toggle("on", b.dataset.adjp !== "reset" && item.adjName === b.dataset.adjp);
  for (const o of box.querySelectorAll("[data-adjon]")) o.checked = !item.adjOff;
  const kv = Math.round((item.adjK ?? 1) * 100);
  for (const o of box.querySelectorAll("[data-adjk],[data-adjkn]")) { if (force || o !== document.activeElement) o.value = kv; o.disabled = !item.adjBase; }
  const s = item.asel || {};
  for (const o of box.querySelectorAll("[data-asel]")) {
    if (!force && o === document.activeElement) continue;
    const k = o.dataset.asel;
    if (o.type === "checkbox") o.checked = !!s[k];
    else if (k === "thr") o.value = Math.round(clamp(Number(s.thr ?? 0.2), 0, 1) * 100);
    else if (k === "soft") o.value = Math.round(clamp(Number(s.soft ?? 0), 0, 0.2) * 1000) / 10;
    else if (k === "color") o.value = s.color || "#ff0000";
    else if (k === "pmode") { o.value = s.pmode || ""; o.disabled = (s.path?.length || 0) < 3; }
    else if (k === "act") o.value = s.act === "cut" ? "cut" : "adj";
  }
  const ss = box.querySelector('details[data-adjg="sel"]>summary');
  if (ss) ss.textContent = T("範囲を選ぶ") + (selOn(s) ? " ●" : "");
  for (const [g, title, fields] of ADJ_GROUPS) {
    const sm = box.querySelector(`details.adjg[data-adjg="${g}"]>summary`);
    if (sm) sm.textContent = T(title) + (fields.some(([k]) => isNum(a, k)) ? " ●" : "");
  }
}
// 強さ(0〜1.5)を掛けた値
export function scaleAdj(base, k) {
  const out = {};
  for (const c of Object.keys(COLORS)) if (base[c]) out[c] = base[c];
  for (const key of KEYS) if (base[key] != null) out[key] = Math.round(clamp(base[key] * k, key === "hue" ? -180 : POS.has(key) ? 0 : -1, key === "hue" ? 180 : 1) * 1000) / 1000;
  return out;
}

// ---------------------------------------------------------------- 右の欄(ワンボタン・強さ・詳細設定)
// 開いている欄(詳細設定と、その中の分類。画面を作り直しても開いたまま)
const opened = new Set();
// h: { target(対象の名前。無ければ null)・empty(対象が無いときの文)}。item: 補正を持つもの({ adj, adjBase, adjName, adjK })
export function adjPanelHtml(item, h = {}) {
  if (!item) return `<div class="note">${esc(T(h.empty || "補正する画像を選んでください"))}</div>`;
  const a = item.adj || {};
  const val = (k) => (k === "hue" ? Math.round(Number(a[k]) || 0) : Math.round((Number(a[k]) || 0) * 100));
  const row = ([k, l, mn, mx]) => `<label class="adjrow" ${NOTES[k] ? `title="${esc(T(NOTES[k]))}"` : ""}><span>${esc(T(l))}</span>
      <input type="range" data-adj="${k}" min="${mn}" max="${mx}" step="1" value="${val(k)}"><input type="number" data-adjn="${k}" min="${mn}" max="${mx}" step="1" value="${val(k)}"></label>`;
  const crow = ([k, l, dflt]) => `<label class="adjrow"><span>${esc(T(l))}</span><input type="color" data-adjc="${k}" value="${esc(a[k] || dflt)}"></label>`;
  const groups = ADJ_GROUPS.map(([g, title, fields, colors]) => {
    const used = fields.some(([k]) => isNum(a, k));
    // 色の欄は、その分類の欄のあと(黒の色は黒レベルの下)
    const body = g === "light" ? fields.map((f) => row(f) + (f[0] === "black" ? crow(colors[0]) : "")).join("") : fields.map(row).join("") + (colors || []).map(crow).join("");
    return `<details class="adjg" data-adjg="${g}" ${opened.has(g) ? "open" : ""}><summary>${esc(T(title))}${used ? " ●" : ""}</summary>${body}</details>`;
  }).join("");
  return `${h.target ? `<div class="note" data-c="adjtarget">${esc(T("対象: {0}", h.target))}</div>` : ""}
    <label class="ck adjon" title="${esc(T("外すと、補正の値はそのままで、補正を掛けずに表示・書き出しします"))}"><input type="checkbox" data-adjon ${item.adjOff ? "" : "checked"}>${esc(T("補正を使う"))}</label>
    <div class="row adjp">${PRESETS.map(([k, l]) => `<button data-adjp="${k}" class="${item.adjName === k ? "on" : ""}" title="${esc(T(PRESET_NOTES[k]))}">${esc(T(l))}</button>`).join("")}
      <button data-adjp="reset" title="${esc(T("補正をすべて元に戻します"))}">${esc(T("補正を外す"))}</button></div>
    <label class="adjrow" title="${esc(T("押したボタンの補正の効き方(100% がふつう)"))}"><span>${esc(T("強さ(%)"))}</span>
      <input type="range" data-adjk min="0" max="150" step="5" value="${Math.round((item.adjK ?? 1) * 100)}" ${item.adjBase ? "" : "disabled"}><input type="number" data-adjkn min="0" max="150" step="5" value="${Math.round((item.adjK ?? 1) * 100)}" ${item.adjBase ? "" : "disabled"}></label>
    <details class="adjd" data-adjg="main" ${opened.has("main") ? "open" : ""}><summary>${esc(T("詳細設定"))}</summary>${groups}</details>
    ${selPanelHtml(item.asel || {})}
    <div class="note">${esc(T("ボタンを押すと、絵に合わせて自動で補正します(もう一度押すと外します。強さは切り替えてもそのまま)。細かく変えるときは「詳細設定」を開きます。"))}</div>`;
}
// 範囲を選ぶ(色・しきい値・ぼかし・パスの内側 / 外側・選んだ所を補正する / 消す)
function selPanelHtml(s) {
  const pct = (k, d) => Math.round(clamp(Number(s[k] ?? d), 0, 1) * 100);
  const row = (k, l, v, mx, note) => `<label class="adjrow" title="${esc(T(note))}"><span>${esc(T(l))}</span><input type="range" data-asel="${k}" min="0" max="${mx}" step="1" value="${v}"><input type="number" data-asel="${k}" min="0" max="${mx}" step="1" value="${v}"></label>`;
  const hasPath = (s.path?.length || 0) >= 3;
  return `<details class="adjd" data-adjg="sel" ${opened.has("sel") ? "open" : ""}><summary>${esc(T("範囲を選ぶ"))}${selOn(s) ? " ●" : ""}</summary>
    <label class="ck"><input type="checkbox" data-asel="on" ${s.on ? "checked" : ""}>${esc(T("選んだ範囲だけに掛ける"))}</label>
    <label class="ck"><input type="checkbox" data-asel="col" ${s.col ? "checked" : ""}>${esc(T("色で選ぶ"))}</label>
    <label class="adjrow"><span>${esc(T("選ぶ色"))}</span><input type="color" data-asel="color" value="${esc(s.color || "#ff0000")}"></label>
    ${row("thr", "しきい値(%)", pct("thr", 0.2), 100, "選ぶ色との近さ。大きいほど、離れた色まで選びます")}
    ${row("soft", "ぼかし(%)", Math.round(clamp(Number(s.soft ?? 0), 0, 0.2) * 1000) / 10, 20, "選んだ範囲のふちをぼかす幅(絵の短い辺に対しての %)")}
    <label class="fl">${esc(T("パス"))}<select data-asel="pmode" ${hasPath ? "" : "disabled"}><option value="">${esc(T("使わない"))}</option>
      <option value="in" ${s.pmode === "in" ? "selected" : ""}>${esc(T("パスの内側"))}</option><option value="out" ${s.pmode === "out" ? "selected" : ""}>${esc(T("パスの外側"))}</option></select></label>
    <label class="fl">${esc(T("選んだ所を"))}<select data-asel="act"><option value="adj">${esc(T("色・明るさを補正する"))}</option><option value="cut" ${s.act === "cut" ? "selected" : ""}>${esc(T("消す(透明にする)"))}</option></select></label>
    <div class="note">${esc(T("色とパスの両方を使うと、パスの中のその色の所を選びます。パスは、「パスを編集」で作って「内側を選ぶ」「外側を選ぶ」で入れます。"))}</div></details>`;
}
export function adjPanelCss(scope) {
  return `
${scope} .adjp{flex-wrap:wrap;gap:4px}
${scope} label.ck.adjon{margin:2px 0 4px}
${scope} .adjp button.on{outline:2px solid currentColor}
${scope} .adjrow{display:grid;grid-template-columns:6.5em minmax(0,1fr) 5.4em;gap:6px;align-items:center;font-size:12.5px;margin-top:4px}
${scope} .adjrow input[type=number]{width:100%;box-sizing:border-box}
${scope} .adjrow input[type=range]{width:100%;min-width:0}
${scope} .adjrow .cca-cpk,${scope} .adjrow input[type=color]{grid-column:2 / span 2}
${scope} details.adjd{margin-top:6px}
${scope} details.adjd>summary,${scope} details.adjg>summary{cursor:pointer;font-size:13px;font-weight:700;padding:3px 0}
${scope} details.adjg{margin:4px 0 0 10px}
${scope} details.adjg>summary{font-size:12.5px}
`;
}
// 欄の操作をつなぐ。get() → item、apply(item → 変える, { start, end, item }) で変える(start: 元に戻す区切りの始め、end: 終わり、item: キーフレームではなく全体の設定)、
// stats() → 絵の明るさの分布、after() → 欄を作り直す
export function bindAdjPanel(box, { get, apply, stats, after }) {
  const setVal = (k, v, phase) => apply((it) => {
    const a = { ...(it.adj || {}) };
    a[k] = k === "hue" ? clamp(v, -180, 180) : clamp(v / 100, POS.has(k) ? 0 : -1, 1);
    if (Math.abs(a[k]) < 1e-4) delete a[k];
    it.adj = a; delete it.adjBase; delete it.adjName; delete it.adjK; delete it.adjOff; // 手で変えたら、強さの元は無くす(補正を使わない設定なら、使うに戻す)
  }, phase);
  // 開いた・閉じた欄を覚える
  box.addEventListener("toggle", (e) => { const g = e.target?.dataset?.adjg; if (g) { if (e.target.open) opened.add(g); else opened.delete(g); } }, true);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-adjp]");
    if (!b || !box.contains(b) || !get()) return;
    const name = b.dataset.adjp, cur = get();
    if (name === "reset") apply((it) => { delete it.adj; delete it.adjBase; delete it.adjName; delete it.adjK; delete it.adjOff; }, { start: true, end: true });
    else if (cur.adjName === name) apply((it) => { delete it.adj; delete it.adjBase; delete it.adjName; }, { start: true, end: true }); // もう一度押すと外す(強さは覚えておく)
    else {
      const base = presetAdj(name, stats() || { p2: 0.05, p50: 0.5, p98: 0.95, ch: 0.2 }), k = cur.adjK ?? 1; // 切り替えても強さはそのまま
      apply((it) => { it.adjBase = base; it.adjName = name; it.adjK = k; it.adj = scaleAdj(base, k); delete it.adjOff; }, { start: true, end: true }); // 押したら補正を使う
    }
    after?.();
  });
  // 範囲を選ぶ(キーフレームではなく、そのもの全体の設定)
  const selVal = (t) => {
    const k = t.dataset.asel;
    if (t.type === "checkbox") return t.checked;
    if (k === "thr") return clamp(Number(t.value), 0, 100) / 100;
    if (k === "soft") return clamp(Number(t.value), 0, 20) / 100;
    return t.value;
  };
  const setSel = (t, phase) => {
    if (t.type === "number" && (t.value === "" || Number.isNaN(Number(t.value)))) return;
    const k = t.dataset.asel, v = selVal(t);
    apply((it) => { it.asel = { ...(it.asel || {}), [k]: v }; if (k !== "on") it.asel.on = true; }, { ...phase, item: true }); // 範囲を変えたら、選んだ範囲に掛ける
    for (const o of box.querySelectorAll(`[data-asel="${k}"]`)) if (o !== t && o.type !== "checkbox") o.value = t.value;
    if (k !== "on") for (const o of box.querySelectorAll('[data-asel="on"]')) o.checked = true;
  };
  let editing = null;
  box.addEventListener("input", (e) => {
    const t = e.target, it = get();
    if (!it) return;
    if (t.matches("[data-asel]")) { if (t.type === "checkbox" || t.tagName === "SELECT") return; const start = editing !== t; editing = t; setSel(t, { start }); return; }
    const start = editing !== t;
    editing = t;
    if (t.matches("[data-adj]")) { setVal(t.dataset.adj, Number(t.value), { start }); const n = box.querySelector(`[data-adjn="${t.dataset.adj}"]`); if (n) n.value = t.value; }
    else if (t.matches("[data-adjn]")) { if (t.value === "" || Number.isNaN(Number(t.value))) return; setVal(t.dataset.adjn, Number(t.value), { start }); const r = box.querySelector(`[data-adj="${t.dataset.adjn}"]`); if (r) r.value = t.value; }
    else if (t.matches("[data-adjk],[data-adjkn]")) {
      if (!it.adjBase || t.value === "" || Number.isNaN(Number(t.value))) return;
      const k = clamp(Number(t.value), 0, 150) / 100;
      apply((x) => { x.adjK = k; x.adj = scaleAdj(x.adjBase, k); delete x.adjOff; }, { start });
      for (const o of box.querySelectorAll("[data-adjk],[data-adjkn]")) if (o !== t) o.value = t.value;
      const a = get()?.adj || {};
      for (const [key] of ADJ_FIELDS) { const v = key === "hue" ? Math.round(Number(a[key]) || 0) : Math.round((Number(a[key]) || 0) * 100); for (const o of box.querySelectorAll(`[data-adj="${key}"],[data-adjn="${key}"]`)) o.value = v; }
    } else if (t.matches("[data-adjc]")) { const k = t.dataset.adjc || "bcolor"; apply((x) => { x.adj = { ...(x.adj || {}), [k]: t.value }; delete x.adjOff; }, { start }); }
  });
  box.addEventListener("change", (e) => {
    if (e.target.matches("[data-asel]")) {
      if (!get()) return;
      if (e.target.type === "checkbox" || e.target.tagName === "SELECT") setSel(e.target, { start: true, end: true });
      else { editing = null; apply(() => {}, { end: true, item: true }); }
      return;
    }
    // 補正を使う / 使わない(値はそのまま)。元に戻せる
    if (e.target.matches("[data-adjon]")) { const on = e.target.checked; if (get()) apply((it) => { if (on) delete it.adjOff; else it.adjOff = true; }, { start: true, end: true, item: true }); return; } // item: キーフレームではなく、そのもの全体の設定
    if (!e.target.matches("[data-adj],[data-adjn],[data-adjk],[data-adjkn],[data-adjc]")) return;
    editing = null;
    apply(() => {}, { end: true });
    if (e.target.matches("[data-adj],[data-adjn]")) for (const b of box.querySelectorAll("[data-adjp].on")) b.classList.remove("on");
    if (e.target.matches("[data-adj],[data-adjn]")) for (const o of box.querySelectorAll("[data-adjk],[data-adjkn]")) o.disabled = true;
  });
}
