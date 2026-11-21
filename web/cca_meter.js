// CCA Generator: 生成結果の動画・音声の右に出すレベルメーター(左右 2 本・dB の目盛り・ピークの線)
// 色は動画編集の音量のメーターと同じ(緑 → 黄 → 赤)。-60 dB 〜 0 dB
const DB_MIN = -60;
const TICKS = [0, -6, -12, -24, -48];
const HOLD_MS = 1500;

export const METER_CSS = `
.cca-meter{position:relative;width:56px;flex:0 0 56px;align-self:stretch;min-height:120px;background:#0b0d10;border-left:1px solid #2a2f36;box-sizing:border-box}
.cca-meter canvas{position:absolute;inset:0;width:100%;height:100%}
.cca-meter .lr{position:absolute;bottom:2px;left:0;right:0;display:flex;justify-content:space-around;font:10px sans-serif;color:#8b95a1;pointer-events:none}
`;

let actx = null;
const meters = new WeakMap(); // 動画・音声の要素ごとに 1 回だけ WebAudio につなぐ

function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
// パネルを押したとき(ユーザーの操作の中)に呼ぶ。止まっている WebAudio を動かす
export function primeAudio() {
  try { const c = audioCtx(); if (c.state === "suspended") c.resume(); } catch { /* 使えない環境ではメーターなし */ }
}
const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const frac = (db) => Math.max(0, Math.min(1, (db - DB_MIN) / -DB_MIN));

// media(video / audio)の音を、box の中のメーターに出す。戻り値の destroy() で止める
export function attachMeter(media, box) {
  box.innerHTML = `<canvas></canvas><div class="lr"><span>L</span><span>dB</span><span>R</span></div>`;
  const cv = box.querySelector("canvas");
  let an = meters.get(media);
  try {
    if (!an) {
      const ctx = audioCtx();
      const src = ctx.createMediaElementSource(media);
      const split = ctx.createChannelSplitter(2);
      const l = ctx.createAnalyser(), r = ctx.createAnalyser();
      l.fftSize = r.fftSize = 2048;
      src.connect(split);
      split.connect(l, 0);
      split.connect(r, 1);
      src.connect(ctx.destination); // 音はそのまま聞こえる
      an = { l, r, buf: new Float32Array(2048), mono: src.channelCount === 1 };
      meters.set(media, an);
    }
  } catch { an = null; }
  const resume = () => { try { if (actx?.state === "suspended") actx.resume(); } catch { /* 押したときに再開する */ } };
  media.addEventListener("play", resume);
  const peak = [DB_MIN, DB_MIN], held = [DB_MIN, DB_MIN], heldAt = [0, 0];
  let raf = 0, alive = true;
  const level = (a) => {
    a.getFloatTimeDomainData(an.buf);
    let m = 0;
    for (let i = 0; i < an.buf.length; i++) m = Math.max(m, Math.abs(an.buf[i]));
    return toDb(m);
  };
  const draw = () => {
    if (!alive) return;
    raf = requestAnimationFrame(draw);
    const W = Math.max(1, Math.round(cv.clientWidth * devicePixelRatio)), H = Math.max(1, Math.round(cv.clientHeight * devicePixelRatio));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext("2d"), k = devicePixelRatio, top = 6 * k, bot = H - 16 * k, h = Math.max(1, bot - top);
    g.clearRect(0, 0, W, H);
    const now = performance.now();
    const playing = an && !media.paused && !media.ended;
    for (let c = 0; c < 2; c++) {
      const db = playing ? level(c ? an.r : an.l) : -Infinity;
      // 下がるときはゆっくり(目で追えるように)
      peak[c] = Math.max(isFinite(db) ? db : DB_MIN, peak[c] - 1.2);
      if (peak[c] >= held[c] || now - heldAt[c] > HOLD_MS) { held[c] = peak[c]; heldAt[c] = now; }
      const x = (c ? 42 : 4) * k, w = 10 * k;
      g.fillStyle = "#1a1f26";
      g.fillRect(x, top, w, h);
      const f = frac(peak[c]);
      if (f > 0) {
        const gr = g.createLinearGradient(0, bot, 0, top);
        gr.addColorStop(0, "#3dd68a");
        gr.addColorStop(frac(-12), "#3dd68a");
        gr.addColorStop(frac(-6), "#ffd24d");
        gr.addColorStop(frac(-1), "#ff6b6b");
        gr.addColorStop(1, "#ff6b6b");
        g.fillStyle = gr;
        g.fillRect(x, bot - h * f, w, h * f);
      }
      const hf = frac(held[c]);
      if (hf > 0) { g.fillStyle = held[c] > -1 ? "#ff6b6b" : "#ffffff"; g.fillRect(x, bot - h * hf - k, w, 2 * k); }
    }
    // 目盛り(dB)
    g.fillStyle = "#6b7480";
    g.font = `${9 * k}px sans-serif`;
    g.textAlign = "center";
    for (const t of TICKS) {
      const y = bot - h * frac(t);
      g.fillRect(16 * k, y, 24 * k, 1 * k);
      g.fillText(String(t), 28 * k, y - 2 * k);
    }
  };
  draw();
  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      media.removeEventListener("play", resume);
    },
  };
}
