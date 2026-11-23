// PNGinfo: 画像(PNG・JPEG・WebP)のメタデータ(A1111 の parameters / ComfyUI の prompt / NovelAI の Comment など)を読み、
// 項目ごとにコピー・生成ページへの反映ができる。使えない項目は「その他」に入れる。
import { T } from "./cca_i18n.js";

let ui = null, ctx = null, cur = null, curFile = null, objUrl = null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- PNG の文字チャンクを読む
const utf8 = new TextDecoder("utf-8", { fatal: true }), latin = new TextDecoder("latin1");
const text = (u) => { try { return utf8.decode(u); } catch { return latin.decode(u); } };
async function inflate(u8) {
  const ds = new DecompressionStream("deflate"), w = ds.writable.getWriter();
  w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
// JPEG・WebP: EXIF(UserComment など)と JPEG のコメントから読む
function exifTexts(ex, out) {
  if (ex.length < 8) return;
  const dv = new DataView(ex.buffer, ex.byteOffset, ex.byteLength), le = ex[0] === 0x49;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const NAMES = { 0x010e: "ImageDescription", 0x010f: "Make", 0x0110: "Model" };
  const ifd = (o, depth) => {
    if (o + 2 > ex.length) return;
    for (let i = 0, n = u16(o); i < n; i++) {
      const e = o + 2 + i * 12; if (e + 12 > ex.length) break;
      const tag = u16(e), size = u32(e + 4), vo = size > 4 ? u32(e + 8) : e + 8;
      if (tag === 0x8769 && depth < 2) ifd(u32(e + 8), depth + 1);
      else if ((NAMES[tag] || tag === 0x9286) && vo + size <= ex.length) {
        const b = ex.subarray(vo, vo + size);
        let t;
        if (tag === 0x9286) {
          const body = b.subarray(8);
          t = latin.decode(b.subarray(0, 5)) === "UNICO" ? new TextDecoder(body[0] !== 0 && body[1] === 0 ? "utf-16le" : "utf-16be").decode(body) : text(body);
        } else t = text(b);
        t = t.replace(/\0+$/, "");
        if (!t.trim()) continue;
        const m = /^([A-Za-z_]+):(\{[\s\S]*)$/.exec(t); // ComfyUI の WebP: "prompt:{...}"
        if (tag === 0x9286) out[/Steps: \d+/.test(t) ? "parameters" : "UserComment"] = t;
        else if (m) out[m[1]] = m[2]; else out[`Exif ${NAMES[tag]}`] = t;
      }
    }
  };
  ifd(u32(4), 0);
}
function readJpegText(u) {
  const out = {};
  let p = 2;
  while (p + 4 <= u.length && u[p] === 0xff) {
    const m = u[p + 1];
    if (m === 0xda) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { p += 2; continue; }
    const len = (u[p + 2] << 8) | u[p + 3], seg = u.subarray(p + 4, p + 2 + len);
    if (m === 0xe1 && latin.decode(seg.subarray(0, 4)) === "Exif") exifTexts(seg.subarray(6), out);
    else if (m === 0xfe) { const t = text(seg); out[/Steps: \d+/.test(t) ? "parameters" : "JPEG コメント"] = t; }
    p += 2 + len;
  }
  return out;
}
function readWebpText(u) {
  const out = {}, dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let p = 12;
  while (p + 8 <= u.length) {
    const size = dv.getUint32(p + 4, true), d = u.subarray(p + 8, p + 8 + size);
    if (latin.decode(u.subarray(p, p + 4)) === "EXIF") exifTexts(latin.decode(d.subarray(0, 4)) === "Exif" ? d.subarray(6) : d, out);
    p += 8 + size + (size & 1);
  }
  return out;
}
// 動画(MP4・MOV・WebM・MKV): 中に入っている JSON(ComfyUI の prompt / workflow)と A1111 形式の文を探す
const looseUtf8 = new TextDecoder("utf-8");
function scanJson(u, out) {
  const t = looseUtf8.decode(u);
  let i = 0;
  while ((i = t.indexOf('{"', i)) >= 0) {
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = i; k < t.length; k++) {
      const c = t[k];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) { end = k + 1; break; }
    }
    if (end < 0) { i += 2; continue; }
    const raw = t.slice(i, end);
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") {
        if (Array.isArray(j.nodes) && Array.isArray(j.links)) out.workflow ??= raw;
        else if (Object.values(j).some((n) => n && n.class_type && n.inputs)) out.prompt ??= raw;
        else if (j.uc != null && j.steps != null) out.Comment ??= raw;
      }
    } catch { /* JSON ではない */ }
    i = end;
  }
  const m = /[^\x00-\x08\x0b\x0c\x0e-\x1f]*Steps: \d+[^\x00-\x08\x0b\x0c\x0e-\x1f]*/.exec(t);
  if (m && !out.parameters) out.parameters = m[0].replace(/^[^A-Za-z0-9({\[<]+/, "");
}
async function readVideoText(file) {
  const out = {}, u8 = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
  let found = false;
  if (/\.(mp4|m4v|mov)$/i.test(file.name) || file.type === "video/mp4" || file.type === "video/quicktime") {
    let p = 0;
    while (p + 8 <= file.size) {
      const h = new DataView((await u8(p, p + 16)).buffer);
      let size = h.getUint32(0), hd = 8;
      const type = String.fromCharCode(...new Uint8Array(h.buffer, 4, 4));
      if (size === 1 && h.byteLength >= 16) { size = Number(h.getBigUint64(8)); hd = 16; } else if (size === 0) size = file.size - p;
      if (size < hd) break;
      if (["moov", "meta", "udta", "uuid"].includes(type) && size - hd < 96 * 1024 * 1024) { scanJson(await u8(p + hd, p + size), out); found = true; }
      p += size;
    }
  }
  if (!found || !Object.keys(out).length) { // WebM・MKV など: 先頭と末尾を探す
    const N = 4 * 1024 * 1024;
    scanJson(await u8(0, Math.min(N, file.size)), out);
    if (file.size > N) scanJson(await u8(Math.max(N, file.size - N), file.size), out);
  }
  return out;
}
const isVideo = (f) => /^video\//.test(f.type) || /\.(mp4|m4v|mov|webm|mkv)$/i.test(f.name);
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
// PDF: Info の Keywords に入れた「CCA1:」+ base64(zlib(JSON {parameters}))を探す(文字は ASCII でも UTF-16 でも読める)
async function readPdfText(file) {
  const out = {}, N = 1024 * 1024, M = 4 * N;
  const parts = [file.slice(0, Math.min(N, file.size))];
  if (file.size > N) parts.push(file.slice(Math.max(N, file.size - M), file.size));
  for (const part of parts) {
    const str = latin.decode(new Uint8Array(await part.arrayBuffer()));
    const i = str.indexOf("/Keywords");
    if (i < 0) continue;
    const m = /CCA1:([A-Za-z0-9+/=]+)/.exec(str.slice(i, i + 4_000_000).replace(/\0/g, ""));
    if (!m) continue;
    try {
      const bin = atob(m[1]), u = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const j = JSON.parse(utf8.decode(await inflate(u)));
      if (j?.parameters) out.parameters = j.parameters;
      break;
    } catch { /* 読めなければ無視 */ }
  }
  return out;
}
async function readMeta(file) { return isPdf(file) ? readPdfText(file) : isVideo(file) ? readVideoText(file) : readPngText(await file.arrayBuffer()); }

// ---------------------------------------------------------------- メタデータを消して保存(再エンコードしない=劣化なし)
const cat = (parts) => new Blob(parts);
function stripPng(u, add) { // add: 入れ直す文字チャンク(主要項目のみ残して保存)
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), parts = [u.subarray(0, 8)];
  let p = 8;
  while (p + 12 <= u.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...u.subarray(p + 4, p + 8));
    if (!["tEXt", "zTXt", "iTXt", "eXIf"].includes(type)) parts.push(u.subarray(p, p + 12 + len));
    p += 12 + len;
    if (type === "IEND") break;
  }
  if (add) parts.splice(2, 0, add); // IHDR の直後
  return cat(parts);
}
function stripJpeg(u, add) {
  const parts = [u.subarray(0, 2)];
  let p = 2, ins = false;
  while (p + 4 <= u.length && u[p] === 0xff) {
    const m = u[p + 1];
    if (m === 0xda) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { parts.push(u.subarray(p, p + 2)); p += 2; continue; }
    if (add && !ins && m !== 0xe0) { parts.push(add); ins = true; } // JFIF の次に EXIF を入れる
    const len = (u[p + 2] << 8) | u[p + 3], head = latin.decode(u.subarray(p + 4, p + 4 + 28));
    if (!(m === 0xfe || (m === 0xe1 && (head.startsWith("Exif") || head.startsWith("http://ns.adobe.com/xap"))))) parts.push(u.subarray(p, p + 2 + len));
    p += 2 + len;
  }
  if (add && !ins) parts.push(add);
  parts.push(u.subarray(p));
  return cat(parts);
}
function stripWebp(u, ex) { // ex: 入れ直す EXIF(主要項目のみ残して保存)
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), chunks = [];
  let p = 12, total = 4, hasX = false, img = null, alpha = false;
  while (p + 8 <= u.length) {
    const tag = latin.decode(u.subarray(p, p + 4)), size = dv.getUint32(p + 4, true), pad = size & 1;
    if (tag === "VP8 " || tag === "VP8L") img = { tag, d: u.subarray(p + 8, p + 8 + size) };
    if (tag === "ALPH") alpha = true;
    if (tag !== "EXIF" && tag !== "XMP ") {
      let c = u.slice(p, p + 8 + size + pad);
      if (tag === "VP8X") { hasX = true; c[8] = (c[8] & ~(0x08 | 0x04)) | (ex ? 0x08 : 0); } // EXIF・XMP の印を付け直す
      chunks.push(c); total += c.length;
    }
    p += 8 + size + pad;
  }
  if (ex) {
    if (!hasX) { // 簡易形式には、拡張の見出し(VP8X)を付ける
      if (!img) throw new Error(T("この形式は主要項目のみ残して保存できません(PNG・JPEG・WebP)"));
      const d = img.d; let w, h;
      if (img.tag === "VP8L") { const b = (d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24)) >>> 0; w = (b & 0x3fff) + 1; h = ((b >>> 14) & 0x3fff) + 1; alpha = alpha || ((b >>> 28) & 1) === 1; }
      else { w = ((d[6] | (d[7] << 8)) & 0x3fff); h = ((d[8] | (d[9] << 8)) & 0x3fff); }
      const x = new Uint8Array(18);
      x.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0x08 | (alpha ? 0x10 : 0), 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255]);
      chunks.unshift(x); total += 18;
    }
    const e = new Uint8Array(8 + ex.length + (ex.length & 1));
    e.set([0x45, 0x58, 0x49, 0x46]); new DataView(e.buffer).setUint32(4, ex.length, true); e.set(ex, 8);
    chunks.push(e); total += e.length;
  }
  const head = u.slice(0, 12); new DataView(head.buffer).setUint32(4, total, true);
  return cat([head, ...chunks]);
}
async function stripMp4(file) { // udta・meta・uuid を同じ大きさの free に置き換える(動画の中身・位置は変えない)
  const bytes = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
  const kill = ["udta", "meta", "uuid"];
  const edits = []; // [箱の位置, 大きさ, 見出しの長さ]
  const walk = async (a, b, inMoov) => {
    let p = a;
    while (p + 8 <= b) {
      const h = new DataView((await bytes(p, p + 16)).buffer);
      let size = h.getUint32(0), hd = 8;
      const type = String.fromCharCode(...new Uint8Array(h.buffer, 4, 4));
      if (size === 1 && h.byteLength >= 16) { size = Number(h.getBigUint64(8)); hd = 16; } else if (size === 0) size = b - p;
      if (size < hd || p + size > b) break;
      if (kill.includes(type)) { if (size < 64 * 1024 * 1024) edits.push([p, size, hd]); }
      else if (type === "moov" && !inMoov) await walk(p + hd, p + size, true);
      p += size;
    }
  };
  await walk(0, file.size, false);
  if (!edits.length) return file;
  const parts = []; let last = 0;
  for (const [at, size, hd] of edits) { // 種類を free にして、中身を 0 で埋める(箱の大きさは変えない)
    parts.push(file.slice(last, at + 4), new Uint8Array([0x66, 0x72, 0x65, 0x65]), file.slice(at + 8, at + hd), new Uint8Array(size - hd));
    last = at + size;
  }
  parts.push(file.slice(last));
  return cat(parts);
}
async function stripMeta(file) {
  if (isVideo(file)) {
    if (/\.(mp4|m4v|mov)$/i.test(file.name) || file.type === "video/mp4" || file.type === "video/quicktime") return stripMp4(file);
    throw new Error(T("この形式はメタデータを消せません(PNG・JPEG・WebP・MP4・MOV)"));
  }
  const u = new Uint8Array(await file.arrayBuffer());
  if (u[0] === 0x89 && u[1] === 0x50) return stripPng(u);
  if (u[0] === 0xff && u[1] === 0xd8) return stripJpeg(u);
  if (latin.decode(u.subarray(0, 4)) === "RIFF" && latin.decode(u.subarray(8, 12)) === "WEBP") return stripWebp(u);
  throw new Error(T("この形式はメタデータを消せません(PNG・JPEG・WebP・MP4・MOV)"));
}
async function saveStripped() {
  if (!curFile) return;
  try { await saveBlob(await stripMeta(curFile), curFile, "_clean", T("メタデータを消して保存しました")); } catch (e) { msg(e.message, true); }
}
// ---------------------------------------------------------------- 主要項目のみ残して保存(PNG・JPEG・WebP。再エンコードしない)
// 残す: プロンプト(範囲別・マイナスプロンプトを含む)・ネガティブプロンプト・モデル(VAE・テキストエンコーダ・LoRA を含む)・ Hires. fix の設定・CFG・ステップ数・サンプラー・シード・CCA の版
const KEEP_SET = ["Steps", "Sampler", "Schedule type", "CFG scale", "Seed", "Model", "Model hash", "VAE", "VAE hash", "Text encoder", "Text encoder 2", "Lora hashes", "Denoising strength", "Hires upscale", "Hires steps", "Hires upscaler", "Hires CFG Scale", "CCA Minus Prompt", "CCA Range"];
const quoteVal = (s) => (/[,\n:"]/.test(String(s)) ? JSON.stringify(String(s)) : String(s));
async function mainText(file) {
  const ch = await readMeta(file), set = {};
  let pos = "", neg = "";
  if (ch.parameters) {
    const a = parseParams(ch.parameters);
    pos = a.positive; neg = a.negative;
    for (const k of KEEP_SET) if (a.set[k] != null && a.set[k] !== "") set[k] = a.set[k];
    if (/^CCA Generator\b/.test(a.set.Version || "")) set.Version = a.set.Version; // CCA の版(他のツールの版は残さない)
  } else { // ComfyUI の prompt などから読める分だけ
    const { info } = interpret(ch);
    pos = info.positive || ""; neg = info.negative || "";
    const map = { Steps: info.steps, Sampler: info.sampler, "Schedule type": info.scheduler, "CFG scale": info.cfg, Seed: info.seed, Model: info.model, "Model hash": info.hash, "CCA Minus Prompt": info.negw, "CCA Range": info.range };
    for (const [k, v] of Object.entries(map)) if (v != null && v !== "") set[k] = v;
  }
  const keys = Object.keys(set);
  if (!String(pos).trim() && !String(neg).trim() && !keys.length) throw new Error(T("残せる主要項目が見つかりませんでした"));
  const lines = [pos];
  if (String(neg).trim()) lines.push(`Negative prompt: ${neg}`);
  if (keys.length) lines.push(keys.map((k) => `${k}: ${quoteVal(set[k])}`).join(", "));
  return lines.join("\n");
}
const be16 = (n) => [(n >> 8) & 255, n & 255], be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function exifOf(txt) { // UserComment だけの EXIF(TIFF 部分)。UTF-16 で入らないほど長ければ UTF-8 で入れる
  const utf16 = (s) => { const o = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o[i * 2] = c >> 8; o[i * 2 + 1] = c & 255; } return o; };
  const asc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const bodies = [[asc("UNICODE\0"), utf16(txt)], [asc("ASCII\0\0\0"), new TextEncoder().encode(txt)]];
  for (const [h, b] of bodies) {
    const n = h.length + b.length;
    if (n + 44 + 8 > 65000) continue;
    const t = new Uint8Array(44 + n);
    t.set([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, ...be16(1), ...be16(0x8769), ...be16(4), ...be32(1), ...be32(26), 0, 0, 0, 0,
      ...be16(1), ...be16(0x9286), ...be16(7), ...be32(n), ...be32(44), 0, 0, 0, 0]);
    t.set(h, 44); t.set(b, 44 + h.length);
    return t;
  }
  throw new Error(T("主要項目が大きすぎて入りません"));
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(Array.from(type, (c) => c.charCodeAt(0)), 4); out.set(data, 8);
  let c = 0xffffffff; for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
  dv.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}
function iTXtParameters(txt) {
  const key = Array.from("parameters", (c) => c.charCodeAt(0)), body = new TextEncoder().encode(txt);
  return pngChunk("iTXt", Uint8Array.from([...key, 0, 0, 0, 0, 0, ...body]));
}
function exifSegment(tiff) {
  const n = 2 + 6 + tiff.length, o = new Uint8Array(2 + n);
  o.set([0xff, 0xe1, ...be16(n), 0x45, 0x78, 0x69, 0x66, 0, 0]); o.set(tiff, 10);
  return o;
}
async function saveBlob(blob, file, suffix, okText) {
  const m = /^(.*?)(\.[^.]+)?$/.exec(file.name), name = `${m[1]}${suffix}${m[2] || ""}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  msg(`${okText}: ${name}`);
}
async function saveMain() {
  if (!curFile) return;
  try {
    const txt = await mainText(curFile), u = new Uint8Array(await curFile.arrayBuffer());
    let blob;
    if (u[0] === 0x89 && u[1] === 0x50) blob = stripPng(u, iTXtParameters(txt));
    else if (u[0] === 0xff && u[1] === 0xd8) blob = stripJpeg(u, exifSegment(exifOf(txt)));
    else if (latin.decode(u.subarray(0, 4)) === "RIFF" && latin.decode(u.subarray(8, 12)) === "WEBP") blob = stripWebp(u, exifOf(txt));
    else throw new Error(T("この形式は主要項目のみ残して保存できません(PNG・JPEG・WebP)"));
    await saveBlob(blob, curFile, "_main", T("主要項目のみ残して保存しました"));
  } catch (e) { msg(e.message, true); }
}

async function readPngText(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf);
  if (u[0] === 0xff && u[1] === 0xd8) return readJpegText(u);
  if (latin.decode(u.subarray(0, 4)) === "RIFF" && latin.decode(u.subarray(8, 12)) === "WEBP") return readWebpText(u);
  if ([137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => u[i] !== b)) throw new Error(T("対応していない画像です(PNG・JPEG・WebP)"));
  const out = {};
  let p = 8;
  while (p + 8 <= u.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...u.subarray(p + 4, p + 8)), d = u.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === "IEND") break;
    try {
      if (type === "tEXt") { const z = d.indexOf(0); out[latin.decode(d.subarray(0, z))] = text(d.subarray(z + 1)); }
      else if (type === "zTXt") { const z = d.indexOf(0); out[latin.decode(d.subarray(0, z))] = text(await inflate(d.subarray(z + 2))); }
      else if (type === "iTXt") {
        const z = d.indexOf(0), comp = d[z + 1];
        let q = z + 3; q = d.indexOf(0, q) + 1; q = d.indexOf(0, q) + 1; // 言語タグ・翻訳したキーワードを飛ばす
        const body = d.subarray(q);
        out[latin.decode(d.subarray(0, z))] = text(comp ? await inflate(body) : body);
      }
    } catch { /* 読めないチャンクは無視 */ }
  }
  return out;
}

// ---------------------------------------------------------------- 中身の解釈
function parseParams(t) {
  const lines = t.split("\n");
  let si = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^Steps: \d+/.test(lines[i])) { si = i; break; }
  const pos = [], neg = [];
  let inNeg = false;
  for (const l of si >= 0 ? lines.slice(0, si) : lines) {
    if (!inNeg && l.startsWith("Negative prompt:")) { inNeg = true; neg.push(l.slice(16).trimStart()); } else (inNeg ? neg : pos).push(l);
  }
  const set = {};
  if (si >= 0) for (const m of lines[si].matchAll(/\s*([\w][\w \-/.]*?):\s*("(?:\\.|[^\\"])*"|[^,]*)(?:,|$)/g)) set[m[1].trim()] = (() => { const r = m[2].trim(); if (r.startsWith('"')) { try { return JSON.parse(r); } catch { /* そのまま */ } } return r.replace(/^"(.*)"$/s, "$1"); })();
  return { positive: pos.join("\n").trim(), negative: neg.join("\n").trim(), set };
}
function parseComfy(txt) {
  let j; try { j = JSON.parse(txt); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const nodes = Object.values(j).filter((n) => n && n.class_type && n.inputs);
  if (!nodes.length) return null;
  const strOf = (l, d = 0) => {
    if (!Array.isArray(l) || d > 6) return typeof l === "string" ? l : null;
    const n = j[l[0]]; if (!n) return null;
    const t = n.inputs.text ?? n.inputs.prompt ?? n.inputs.positive;
    if (typeof t === "string") return t;
    for (const v of Object.values(n.inputs)) if (Array.isArray(v)) { const r = strOf(v, d + 1); if (r) return r; }
    return null;
  };
  const o = {}, extra = [];
  const ks = nodes.find((n) => /KSampler|SamplerCustom/.test(n.class_type) && Array.isArray(n.inputs.positive));
  if (ks) {
    o.positive = strOf(ks.inputs.positive); o.negative = strOf(ks.inputs.negative);
    for (const [k, a] of [["seed", "seed"], ["seed", "noise_seed"], ["steps", "steps"], ["cfg", "cfg"], ["sampler", "sampler_name"], ["scheduler", "scheduler"]]) if (o[k] == null && ks.inputs[a] != null && !Array.isArray(ks.inputs[a])) o[k] = ks.inputs[a];
  }
  for (const n of nodes) { // CCA のノードなど、値を直接持っているもの
    const i = n.inputs, lit = (v) => (v != null && !Array.isArray(v) ? v : undefined);
    for (const [k, a] of [["positive", "positive"], ["negative", "negative"], ["steps", "steps"], ["cfg", "cfg"], ["seed", "seed"], ["sampler", "sampler_name"], ["scheduler", "scheduler"], ["width", "width"], ["height", "height"], ["model", "ckpt_name"], ["model", "unet_name"]]) {
      const v = lit(i[a]);
      if (o[k] == null && v !== undefined && (typeof v !== "string" || v !== "")) o[k] = v;
    }
    if (typeof i.negw_settings === "string" && i.negw_settings) o.negw = o.negw ?? i.negw_settings;
    if (typeof i.layout_boxes === "string" && i.layout_boxes && o.range == null) {
      try { const l = JSON.parse(i.layout_boxes), st = i.regional_settings ? JSON.parse(i.regional_settings) : null; if (l?.boxes?.length) o.range = JSON.stringify(st ? { ...l, settings: st } : l); } catch { /* 読めない枠は使わない */ }
    }
    if (/lora/i.test(n.class_type) && typeof i.lora_name === "string") extra.push(["LoRA", `${i.lora_name} (${i.strength_model ?? i.strength ?? ""})`]);
  }
  return { o, extra };
}
function parseNai(chunks) {
  let c; try { c = JSON.parse(chunks.Comment); } catch { return null; }
  if (!c || typeof c !== "object" || c.uc == null) return null;
  const o = { positive: chunks.Description || c.prompt, negative: c.uc, steps: c.steps, cfg: c.scale, seed: c.seed, sampler: c.sampler, width: c.width, height: c.height };
  const extra = Object.entries(c).filter(([k, v]) => !["prompt", "uc", "steps", "scale", "seed", "sampler", "width", "height"].includes(k) && typeof v !== "object").map(([k, v]) => [k, String(v)]);
  return { o, extra };
}
function interpret(ch) {
  const info = {}, extra = [], used = new Set();
  const take = (o) => { for (const [k, v] of Object.entries(o)) if (info[k] == null && v != null && v !== "") info[k] = v; };
  if (ch.parameters) {
    used.add("parameters");
    const a = parseParams(ch.parameters), s = a.set, o = { positive: a.positive, negative: a.negative };
    const num = (k) => (s[k] != null && s[k] !== "" && !isNaN(Number(s[k])) ? Number(s[k]) : undefined);
    Object.assign(o, { steps: num("Steps"), cfg: num("CFG scale"), seed: num("Seed"), sampler: s.Sampler, scheduler: s["Schedule type"], model: s.Model, hash: s["Model hash"] });
    const sz = /^(\d+)x(\d+)$/.exec(s.Size || ""); if (sz) { o.width = +sz[1]; o.height = +sz[2]; }
    take(o);
    if (s["CCA Minus Prompt"]) take({ negw: s["CCA Minus Prompt"] });
    if (s["CCA Range"]) take({ range: s["CCA Range"] });
    if (s["CCA Tile"]) take({ tile: s["CCA Tile"] });
    if (s["CCA Adv"]) { // 前の版の書き方(まとめて1つ): マイナスプロンプトと範囲別指定に分ける
      try {
        const a = JSON.parse(s["CCA Adv"]), pick = (re) => Object.fromEntries(Object.entries(a).filter(([k]) => re.test(k)));
        const ng = pick(/^negw_/), rg = pick(/^(regional_|layout_native)/);
        if (Object.keys(ng).length) take({ negw: JSON.stringify({ settings: ng }) });
        if (Object.keys(rg).length) { const r = (() => { try { return JSON.parse(s["CCA Range"]); } catch { return {}; } })(); take({ range: JSON.stringify({ ...r, settings: rg }) }); }
      } catch { /* 読めない設定は使わない */ }
    }
    const done = new Set(["CCA Minus Prompt", "CCA Range", "CCA Tile", "CCA Adv", "Steps", "CFG scale", "Seed", "Sampler", "Schedule type", "Model", "Model hash", "Size"]);
    for (const [k, v] of Object.entries(s)) if (!done.has(k) || (k === "CFG scale" && num(k) === undefined) || (k === "Steps" && num(k) === undefined) || (k === "Seed" && num(k) === undefined)) extra.push([k, v]);
    if (!a.set.Steps && !a.positive && !a.negative) extra.push(["parameters", ch.parameters]);
  }
  if (ch["CCA Tile"]) { used.add("CCA Tile"); take({ tile: ch["CCA Tile"] }); } // 生成情報の無い元画像のタイル
  if (ch.prompt) { const c = parseComfy(ch.prompt); if (c) { used.add("prompt"); take(c.o); extra.push(...c.extra); } }
  if (ch.Comment) { const n = parseNai(ch); if (n) { used.add("Comment"); used.add("Description"); take(n.o); extra.push(...n.extra); } }
  for (const [k, v] of Object.entries(ch)) if (!used.has(k) && String(v).trim()) extra.push([k, v]);
  return { info, extra };
}

// ---------------------------------------------------------------- 項目の作成と反映
function buildItems(info) {
  const L = [["positive", "プロンプト", true], ["negative", "ネガティブプロンプト", true], ["negw", "マイナスプロンプト", true], ["range", "範囲別指定", true], ["tile", "タイル設定", true], ["model", "利用モデル"], ["cfg", "CFG"], ["steps", "ステップ数"], ["sampler", "サンプラー"], ["scheduler", "スケジューラー"], ["seed", "シード"], ["width", "幅"], ["height", "高さ"]];
  return L.filter(([k]) => info[k] != null && info[k] !== "").map(([k, label, long]) => ({ k, label: T(label), value: String(info[k]), long: !!long, note: k === "model" && info.hash ? `${T("モデルハッシュ")}: ${info.hash}` : "" }));
}
const NEGW_METHODS = { auto: "自動(モデルに合わせる)", value: "Value に負の重みを掛ける(UNet 系だけ)", diff: "予測の差を引く" };
const negwFix = (o) => (o && typeof o === "object" && NEGW_METHODS[o.negw_method] ? { ...o, negw_method: NEGW_METHODS[o.negw_method] } : o);
const baseName = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.(safetensors|ckpt|pt|pth|gguf|sft)$/i, "").toLowerCase();
const MODE_KEY = "cca_pnginfo_mode";
function mode() { return ui?.querySelector('input[name="cca-pi-mode"]:checked')?.value === "replace" ? "replace" : "add"; }
function samplerOf(raw) {
  let s = String(raw).toLowerCase().trim(), sch = null;
  const m = s.match(/\s+(karras|exponential|polyexponential|sgm uniform|uniform|simple|normal|beta|ddim uniform)$/);
  if (m) { sch = m[1].replace(" ", "_"); s = s.slice(0, m.index); }
  s = s.replace(/\+\+/g, "pp").replace(/ a$/, " ancestral").replace(/^dpm(\d)/, "dpm_$1").replace(/\s+/g, "_");
  return { s, sch };
}
const pick = (opts, want) => opts.find((o) => String(o).toLowerCase() === String(want).toLowerCase());
// 反映する。成功なら null、失敗なら理由
async function apply(it) {
  const v = it.value;
  if (it.k === "positive" || it.k === "negative") { // 追加: 画像合成の「プロンプトを作る」と同じく欄の最後に足す / 入れ替え: 欄の中身を置き換える
    const c = String(ctx.get(it.k) || "").trim();
    await ctx.set(it.k, mode() === "replace" || !c ? v : `${c}\n${v}`);
    return null;
  }
  const setAll = async (o) => { for (const [k, x] of Object.entries(o || {})) { if (/_preset$/.test(k)) continue; try { await ctx.set(k, x); } catch { /* 無い項目は飛ばす */ } } };
  if (it.k === "negw") { // マイナスプロンプトの設定(語はプロンプトに入っている)
    let a; try { a = JSON.parse(v); } catch { return T("読み取れません"); }
    await setAll(negwFix(a.settings || (a.terms ? {} : a))); await ctx.advCommit?.(); return null;
  }
  if (it.k === "range") { // 範囲別指定: 枠とそのプロンプト + 設定
    let a; try { a = JSON.parse(v); } catch { return T("読み取れません"); }
    const { settings, ...layout } = a || {};
    if (layout.boxes?.length) await ctx.set("layout_boxes", JSON.stringify(layout));
    await setAll(negwFix(settings)); await ctx.advCommit?.(); return null;
  }
  if (it.k === "tile") { // 複数画像タイル生成の設定(文字の置き換え・並べ方・保存形式など)
    let a; try { a = JSON.parse(v); } catch { return T("読み取れません"); }
    return ctx.applyTile?.(a) ? null : T("読み取れません");
  }
  if (it.k === "model") {
    const w = ctx.modelWidget(), opts = ctx.options(w), n = baseName(v);
    const hit = opts.find((o) => baseName(o) === n) || (n.length >= 4 ? opts.find((o) => baseName(o).includes(n) || n.includes(baseName(o))) : null);
    if (!hit) return T("一致するモデルが見つかりません");
    await ctx.set(w, hit); return null;
  }
  if (it.k === "sampler") {
    const { s, sch } = samplerOf(v), opts = ctx.options("sampler_name"), hit = pick(opts, s) || pick(opts, v);
    if (!hit) return T("一致するサンプラーが見つかりません");
    await ctx.set("sampler_name", hit);
    const sh = sch && pick(ctx.options("scheduler"), sch);
    if (sh && !ctx.pngHasScheduler()) await ctx.set("scheduler", sh);
    return null;
  }
  if (it.k === "scheduler") {
    const hit = pick(ctx.options("scheduler"), String(v).trim().replace(/\s+/g, "_"));
    if (!hit) return T("一致するスケジューラーが見つかりません");
    await ctx.set("scheduler", hit); return null;
  }
  const n = Number(v);
  if (isNaN(n)) return T("数字として読めません");
  await ctx.set(it.k, n); return null;
}

// ---------------------------------------------------------------- 画面
function css() {
  if (document.getElementById("cca-pnginfo-style")) return;
  const s = document.createElement("style");
  s.id = "cca-pnginfo-style";
  s.textContent = `
#cca-pnginfo{position:fixed;inset:0;z-index:1001;background:#000c;display:none;align-items:center;justify-content:center;font:14px/1.5 system-ui,"Segoe UI","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;color:var(--text,#e4e7eb)}
#cca-pnginfo.open{display:flex}
#cca-pnginfo .box{background:var(--bg,#1a1e25);border:1px solid var(--border,#303744);border-radius:10px;width:min(900px,calc(100vw - 32px));height:calc(100vh - 32px);display:flex;flex-direction:column}
#cca-pnginfo .hd{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border,#303744)}
#cca-pnginfo .hd b{font-size:16px}
#cca-pnginfo .body{flex:1;min-height:0;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}
#cca-pnginfo .ft{padding:10px 14px;border-top:1px solid var(--border,#303744);display:flex;gap:8px;align-items:center}
#cca-pnginfo button{background:var(--card2,#20252e);color:var(--text,#e4e7eb);border:1px solid var(--border,#3a4250);border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;font-size:13px}
#cca-pnginfo button:hover{border-color:var(--accent,#3db4a6)}
#cca-pnginfo button.pri{background:var(--accent,#2b8f84);border-color:var(--accent,#3db4a6);color:var(--accent-fg,#fff);font-weight:700}
#cca-pnginfo button:disabled{opacity:.5;cursor:default}
#cca-pnginfo section{border:1px solid var(--border,#303744);border-radius:8px;padding:8px 10px;background:var(--card,#161a20);display:grid;grid-template-columns:9em minmax(0,1fr) auto;gap:8px;align-items:start}
#cca-pnginfo .l{font-weight:700;color:var(--text,#cfd5dc)}
#cca-pnginfo .v{min-width:0;white-space:pre-wrap;word-break:break-all;user-select:text}
#cca-pnginfo textarea{width:100%;box-sizing:border-box;min-height:4.5em;max-height:12em;resize:vertical;background:var(--card2,#0e1115);color:var(--text,#e4e7eb);border:1px solid var(--border,#3a4250);border-radius:6px;padding:5px 8px;font:inherit;font-size:13px}
#cca-pnginfo .nt{font-size:12px;color:var(--muted,#9fb0c2);margin-top:2px}
#cca-pnginfo .b{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
#cca-pnginfo h4{margin:6px 0 0;font-size:14px;color:var(--text,#cfd5dc)}
#cca-pnginfo .md{font-size:13px;display:flex;gap:8px;align-items:center;white-space:nowrap}
#cca-pnginfo .md label{display:inline-flex;gap:3px;align-items:center;cursor:pointer}
#cca-pnginfo .md input{accent-color:var(--accent,#3db4a6)}
#cca-pnginfo .body.emp{cursor:pointer}
#cca-pnginfo .empty{color:var(--muted,#9fb0c2);padding:30px;text-align:center}
#cca-pnginfo .body.emp .empty{flex:1;display:flex;align-items:center;justify-content:center;border:2px dashed var(--border,#3a4250);border-radius:10px}
#cca-pnginfo video.th,#cca-pnginfo img.th{max-height:90px;max-width:160px;border-radius:6px;border:1px solid var(--border,#3a4250)}
#cca-pnginfo .dz{flex:1;align-self:stretch;min-height:64px;margin-left:8px;display:flex;align-items:center;justify-content:center;text-align:center;border:2px dashed var(--border,#3a4250);border-radius:10px;color:var(--muted,#9fb0c2);font-size:13px;padding:4px 8px}
#cca-pnginfo .th.pdf{display:flex;align-items:center;justify-content:center;width:90px;height:90px;font-weight:700;color:var(--muted,#9fb0c2)}
#cca-pnginfo.drag .dz{border-color:var(--accent,#3db4a6);color:var(--accent,#3db4a6)}
#cca-pnginfo.drag .box{outline:2px dashed var(--accent,#3db4a6)}
`;
  document.head.append(s);
}
const $ = (sel) => ui.querySelector(sel);
function build() {
  css();
  ui = document.createElement("div");
  ui.id = "cca-pnginfo";
  ui.innerHTML = `<div class="box">
    <div class="hd"><b>PNGinfo</b><span style="color:var(--muted,#9fb0c2);font-size:13px">${esc(T("画像のメタデータを読み取ります"))}</span><span style="flex:1"></span>
      <span class="md">${esc(T("情報の反映方法"))}: <label><input type="radio" name="cca-pi-mode" value="replace"> ${esc(T("入れ替え"))}</label> <label><input type="radio" name="cca-pi-mode" value="add" checked> ${esc(T("追加"))}</label></span>
      <button data-p="pick">${esc(T("画像を選ぶ"))}</button><button data-p="close">${esc(T("閉じる"))}</button></div>
    <div class="body" data-p="body"></div>
    <div class="ft"><button class="pri" data-p="all" disabled>${esc(T("すべてを生成ページに反映"))}</button><span class="nt" data-p="msg" style="flex:1"></span><button data-p="keep" disabled title="${esc(T("プロンプト・ネガティブプロンプト・モデル・ Hires. fix の設定・CFG・ステップ数・サンプラー・シード・CCA の版だけを残して保存します(ワークフローやタイル設定などは消します)"))}">${esc(T("主要項目のみ残して保存"))}</button><button data-p="strip" disabled>${esc(T("メタデータを消して保存"))}</button></div></div>`;
  document.body.appendChild(ui);
  ui.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  $('[data-p="close"]').onclick = close;
  const pick = () => {
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*,video/*,application/pdf,.pdf";
    i.onchange = () => i.files?.[0] && load(i.files[0]);
    i.click();
  };
  $('[data-p="pick"]').onclick = pick;
  $('[data-p="body"]').addEventListener("click", () => { if (!cur) pick(); }); // 何も読んでいないときは、中をクリックして選ぶ
  try { const m = localStorage.getItem(MODE_KEY); if (m) ui.querySelector(`input[name="cca-pi-mode"][value="${m}"]`).checked = true; } catch { /* 無視 */ }
  for (const r of ui.querySelectorAll('input[name="cca-pi-mode"]')) r.onchange = () => { try { localStorage.setItem(MODE_KEY, mode()); } catch { /* 無視 */ } };
  $('[data-p="all"]').onclick = applyAll;
  $('[data-p="strip"]').onclick = saveStripped;
  $('[data-p="keep"]').onclick = saveMain;
  let downOutside = false; // モーダルの外(暗い所)をクリックしたら閉じる。中から外へドラッグして離したときは閉じない
  ui.addEventListener("mousedown", (e) => { downOutside = e.target === ui; });
  ui.addEventListener("click", (e) => { if (e.target === ui && downOutside) close(); });
  ui.addEventListener("dragover", (e) => { e.preventDefault(); ui.classList.add("drag"); });
  ui.addEventListener("dragleave", () => ui.classList.remove("drag"));
  ui.addEventListener("drop", (e) => { e.preventDefault(); ui.classList.remove("drag"); const f = e.dataTransfer?.files?.[0]; if (f) load(f); });
}
function msg(t, err) { const m = $('[data-p="msg"]'); m.textContent = t || ""; m.style.color = err ? "var(--danger,#e5534b)" : ""; }
const setBody = (empty) => $('[data-p="body"]').classList.toggle("emp", !!empty);
function close() { ui?.classList.remove("open"); if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; } }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); } catch {
    const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove();
  }
}
// 個別の反映メッセージ: 押した項目の下だけに出す(画像合成の「プロンプトを作る」と同じ × 付き。成功は 5 秒で消える)
function itemMsg(sec, text, err) {
  sec._msg?.remove();
  const d = document.createElement("div");
  d.className = `inl-msg ${err ? "error" : "info"}`;
  d.innerHTML = '<span></span><button type="button" class="inl-x" title="×" aria-label="×"></button>';
  d.querySelector("span").textContent = text;
  d.querySelector(".inl-x").onclick = () => d.remove();
  sec.after(d); sec._msg = d;
  if (!err) setTimeout(() => d.remove(), 5000);
}
function row(it, canApply) {
  const s = document.createElement("section");
  s.className = "card";
  const val = it.long || it.value.length > 120 || it.value.includes("\n")
    ? `<textarea readonly rows="${it.long ? 5 : 3}"></textarea>` : `<div class="v"></div>`;
  s.innerHTML = `<div class="l"></div><div>${val}${it.note ? `<div class="nt"></div>` : ""}</div>
    <div class="b"><button data-r="copy">${esc(T("コピー"))}</button>${canApply ? `<button data-r="apply">${esc(T("生成ページに反映"))}</button>` : ""}</div>`;
  s.querySelector(".l").textContent = it.label;
  const v = s.querySelector("textarea, .v"); if (v.tagName === "TEXTAREA") v.value = it.value; else v.textContent = it.value;
  if (it.note) s.querySelector(".nt").textContent = it.note;
  s.querySelector('[data-r="copy"]').onclick = async (e) => {
    const b = e.currentTarget, o = b.textContent; await copyText(it.value); b.textContent = T("コピーしました"); setTimeout(() => { b.textContent = o; }, 1200);
  };
  s.querySelector('[data-r="apply"]')?.addEventListener("click", async (e) => {
    try {
      const r = await apply(it);
      itemMsg(s, `${it.label}: ${r || T("生成ページに反映しました")}`, !!r);
    } catch (err) { itemMsg(s, `${it.label}: ${err.message}`, true); }
  });
  return s;
}
async function applyAll() {
  const done = [], fail = [];
  for (const it of cur.items) {
    try { const r = await apply(it); (r ? fail : done).push(r ? `${it.label}(${r})` : it.label); } catch (e) { fail.push(`${it.label}(${e.message})`); }
  }
  msg(`${T("反映しました")}: ${done.length}${fail.length ? ` / ${T("反映できなかった項目")}: ${fail.join(", ")}` : ""}`);
  ctx.notify(`${T("生成ページに反映しました")}: ${done.length}${fail.length ? ` / ${fail.length} ${T("件は反映できませんでした")}` : ""}`, fail.length ? "error" : "info", $('[data-p="all"]'), { toast: false });
}
async function load(file) {
  const body = $('[data-p="body"]');
  try {
    const ch = await readMeta(file);
    const { info, extra } = interpret(ch);
    cur = { items: buildItems(info), extra }; curFile = file;
    setBody(false);
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(file);
    body.innerHTML = `<div class="b" style="justify-content:flex-start;align-items:center;flex-wrap:nowrap">${isPdf(file) ? `<div class="th pdf">📄 PDF</div>` : isVideo(file) ? `<video class="th" src="${objUrl}" controls muted></video>` : `<img class="th" src="${objUrl}">`}<span class="nt">${esc(file.name)}</span><div class="dz">${esc(T("別の画像をこの上にドロップ"))}</div></div>`;
    for (const it of cur.items) body.appendChild(row(it, true));
    if (extra.length) {
      const h = document.createElement("h4"); h.textContent = T("その他"); body.appendChild(h);
      for (const [k, v] of extra) body.appendChild(row({ label: k, value: String(v), long: false, note: "" }, false));
    }
    if (!cur.items.length && !extra.length) body.insertAdjacentHTML("beforeend", `<div class="empty">${esc(T("メタデータが見つかりませんでした"))}</div>`);
    $('[data-p="all"]').disabled = !cur.items.length;
    $('[data-p="strip"]').disabled = isPdf(file);
    $('[data-p="keep"]').disabled = isPdf(file) || isVideo(file);
    msg("");
  } catch (e) {
    cur = null; curFile = null; setBody(true); $('[data-p="all"]').disabled = true; $('[data-p="strip"]').disabled = true; $('[data-p="keep"]').disabled = true;
    body.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// opts: { get(name), set(name, value), options(name), modelWidget(), notify(msg, kind, anchor, opt) }
export function openPngInfo(opts) {
  ctx = { ...opts, pngHasScheduler: () => !!cur?.items.some((i) => i.k === "scheduler") };
  if (!ui) build();
  ui.classList.add("open");
  if (!cur) { setBody(true); $('[data-p="body"]').innerHTML = `<div class="empty">${esc(T("この場所をクリックして画像を入れるか、ここへ画像をドロップしてください"))}</div>`; }
}
