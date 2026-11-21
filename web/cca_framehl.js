// CCA Generator: 書き出す範囲の枠を強調表示する(画像編集・動画編集で共通の欄)
// 画面で見やすくするだけで、保存・書き出しには入らない。設定はブラウザに、編集ごとに別の名前で覚える
export const FH_DEF = { on: false, color: "#2ee66b", w: 3 };
export const FH_MAX = 20;

export function loadFrameHl(key) {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { o = {}; }
  const w = Math.round(Number(o.w));
  return {
    on: o.on === true,
    color: /^#[0-9a-f]{6}$/i.test(o.color || "") ? o.color : FH_DEF.color,
    w: w >= 1 && w <= FH_MAX ? w : FH_DEF.w,
  };
}

// 強調表示のときに、範囲のまわりに空ける幅(画面の px)
export const frameHlPad = (v) => (v?.on ? v.w : 0);

export function frameHlHtml() {
  return `<div class="fhl" data-c="fhl">
    <label class="row" style="font-size:13px"><input type="checkbox" data-fh="on"> <span>書き出される範囲を強調表示する</span></label>
    <div class="row fhl-opt"><label class="row"><span>枠の色</span><input type="color" data-fh="color"></label>
      <label class="row"><span>枠の太さ(px)</span><input type="number" data-fh="w" min="1" max="${FH_MAX}" step="1"></label></div>
    <div class="note">書き出される範囲のまわりに線を引きます(画面で見やすくするだけで、保存・書き出しには入りません)。</div></div>`;
}

export function frameHlCss(scope) {
  return `${scope} .fhl{margin-top:6px}
${scope} .fhl-opt{font-size:13px;color:#c9d1da;margin:2px 0 0 22px;gap:10px}
${scope} .fhl-opt label{gap:6px}
${scope} .fhl-opt input[type=color]{width:3.2em;height:26px;padding:0}
${scope} .fhl-opt input[type=number]{width:4.5em}
${scope} .fhl.off .fhl-opt{opacity:.45}`;
}

// root: 欄の入れ物、key: 覚える名前、cb(設定): 変わったとき(つないだときにも 1 回呼ぶ)
export function bindFrameHl(root, key, cb) {
  const q = (k) => root.querySelector(`[data-fh="${k}"]`);
  let cur = loadFrameHl(key);
  const show = () => {
    q("on").checked = cur.on;
    q("color").value = cur.color;
    if (document.activeElement !== q("w")) q("w").value = cur.w;
    q("color").disabled = q("w").disabled = !cur.on;
    root.querySelector(".fhl")?.classList.toggle("off", !cur.on);
  };
  const set = (p) => {
    cur = { ...cur, ...p };
    try { localStorage.setItem(key, JSON.stringify(cur)); } catch { /* 覚えられなくても今は使える */ }
    show();
    cb(cur);
  };
  q("on").onchange = (e) => set({ on: e.target.checked });
  q("color").oninput = (e) => set({ color: e.target.value });
  q("w").oninput = (e) => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= FH_MAX && n !== cur.w) set({ w: n }); };
  q("w").onchange = (e) => {
    const n = Math.round(Number(e.target.value));
    set({ w: n >= 1 ? Math.min(FH_MAX, n) : cur.w });
    q("w").value = cur.w;
  };
  // 設定の読み込みのあとは、読み込んだ値にする
  window.addEventListener("cca-settings-imported", () => { cur = loadFrameHl(key); show(); cb(cur); });
  show();
  cb(cur);
}
