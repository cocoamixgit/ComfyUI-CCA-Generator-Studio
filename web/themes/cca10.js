// CCA Generator の配色(テーマ)。項目の説明は web/cca_theme.js の先頭にあります。
// このフォルダに 1 ファイル 1 テーマで置くと、設定の「テーマカラー」に出ます(名前が _ で始まるファイルは読み込みません)。
export default {
  id: "cca10", order: 10,                 // 保存に使う名前(変えない)
  name: "CCA-標準",            // プルダウンに出す名前
  light: true,                 // 明るい配色(地が明るく文字が暗い)
  rainbow: false,              // true で色の付いた所を色鉛筆の 7 色に寄せる(使わない)
  classic: false,              // true で置き換えない(使わない)
  bg: "#f5f1e6",               // 地の色(パネル・編集画面の地)
  fg: "#1c120b",               // 文字の色(ふつうの文字)
  accent: "#5c361be6",         // 強調色: 生成ボタン・選んでいるボタン・スライダーなど(もとの青緑)
  accent2: "#6c7c54e6",        // 目印色: スナップのオン・強調表示の枠など(もとの黄)
  grad: ["#f7f2e7", "#7d6148"], // 地のグラデーション [上, 下]
  alpha: { panel: 0.96, card: 0.86, go: 0.94 }, // 不透明度: 地 / 欄(カード) / 生成ボタン
  // 色合い(±28°)の置き換え。[色合い, 置き換える色, 指定]  指定: "dark"=濃く / "pale"=白っぽく(省略で明るさそのまま)
  hueMap: [
    [0, "#5c361b", "dark"],      // 赤 → 濃茶
    [270, "#d9c8b4", "pale"],    // 紫 → 白っぽい茶
    [320, "#5c361b", "dark"],    // ピンク・マゼンタ → 濃茶
    [35, "#7a5535e6", "dark"],   // 橙 → 茶
    [120, "#6c7c54e6"]           // 緑 → 落ち着いた緑
  ],
  secTitleUseAccent: true,     // 項目の見出しを、その項目の色(sections の accent)にする
  vars: {
    "--bg": "#f5f1e6",  // 地
    "--panel": "#f2e6d1",  // パネルの地
    "--card": "#faf6ee",  // 欄(カード)の地
    "--card2": "#dcd9cc",  // 欄の濃い方・ホバーなど
    "--text": "#1c120b",  // ふつうの文字
    "--muted": "#1f150d",  // 説明・薄い文字
    "--border": "rgba(43, 32, 24, 0.22)",  // 線・枠
    "--accent": "#5c361b",  // 強調色
    "--accent2": "#6c7c54",  // 目印色
    "--accent-fg": "#faf6ee",  // 強調色の上の文字
    "--danger": "#8c6f55",  // エラー・警告の色
    "--warn": "#bfa987",  // 注意の色
    "--ok": "#6c7c54",  // 成功の色
    "--sec-a": "#faf6ee",  // 設定の欄の色(奇数番目)
    "--sec-b": "#e9dfcb"   // 設定の欄の色(偶数番目)。欄ごとに交互に色分けする
  },
  deco: {
    cardShadow: "0 2px 10px rgba(42, 29, 20, 0.14), inset 0 1px 0 rgba(250, 246, 238, 0.78)",  // 欄(カード)の影
    secCardShadow: "0 2px 10px rgba(42, 29, 20, 0.14), inset 0 1px 0 rgba(250, 246, 238, 0.80)",  // 項目(セクション)の影
    btnGrad: "linear-gradient(180deg, rgba(250, 246, 238, 0.56), rgba(242, 230, 209, 0.12) 48%, rgba(42, 29, 20, 0.14))",  // ボタンのつや(グラデーション)
    btnShadow: "inset 0 1px 0 rgba(250, 246, 238, 0.78), inset 0 -2px 3px rgba(42, 29, 20, 0.20), 0 1px 3px rgba(42, 29, 20, 0.24)",  // ボタンの影
    btnActiveShadow: "inset 0 2px 4px rgba(42, 29, 20, 0.34)",  // ボタンを押した時の影
    goBorder: "#f2e6d1",  // 生成ボタンの枠
    goColor: "#faf6ee",  // 生成ボタンの文字
    goTextShadow: "0 1px 2px rgba(24, 14, 7, 0.80)",  // 生成ボタンの文字の影
    goShadow: "inset 0 2px 0 rgba(242, 230, 209, 0.42), inset 0 -6px 12px rgba(32, 18, 8, 0.42), 0 6px 16px rgba(42, 29, 20, 0.48)"  // 生成ボタンの影
  },
  select: {                    // セレクト(プルダウン)
    bg: "#faf6ee", fg: "#1c120b", border: "rgba(43, 32, 24, 0.22)", // 閉じている時: 地 / 文字 / 枠
    menuBg: "#faf6ee", menuFg: "#1c120b", menuBorder: "rgba(43, 32, 24, 0.22)", // 開いた一覧: 地 / 文字 / 枠
    hoverBg: "#dcd9cc", hoverFg: "#1c120b", // カーソルを乗せた項目: 地 / 文字
    selectedBg: "#5c361b", selectedFg: "#faf6ee" // 選ばれている項目: 地 / 文字
  },
  onFg: "#ffffff",             // 地が濃いボタン(.on・「開く」など)の文字色
  secDoneFg: "#2a1a0e",        // 並び替えの「完了」ボタンの文字色(黒茶)
  // 文字・部品の調整(tune)。書いた項目だけ有効。書かない項目は何も出ず、これまで通りの見た目になる
  tune: {
    solid: true,               // 見出し・項目名・説明文を透かさない
    headWeight: 700,           // 見出しの太さ
    labelColor: "#1a100a",     // 項目名の文字色
    labelWeight: 600,          // 項目名の太さ
    descColor: "#2f2218",      // 説明文の文字色
    descWeight: 500,           // 説明文の太さ
    infoFg: "#ffffff",         // ⓘボタンの文字
    infoBg: "#6b4a30",         // ⓘボタンの地
    infoBorder: "#4a331f",     // ⓘボタンの枠
    selFg: "#ffffff",          // 選んでいるボタン(.on)の文字色(履歴などのダイアログ内も。スナップ以外)
    spin: { bg: "#5c361b", fg: "#ffffff" }, // 数字欄の上下ボタン: 地 / 矢印(Chrome 系のみ)
    check: "#5c361b",          // チェックボックス・ラジオの色
    scroll: { thumb: "#8a6a4c", track: "#e6dccb", hover: "#5c361b" }, // スクロールバー: つまみ / 溝 / つまみにカーソルを乗せた時(生成パネル・画像編集・動画編集・ダイアログ)
    layerSel: { bg: "linear-gradient(135deg, #eadcc8, #d3bc9d)", border: "#5c361b" }, // 選んでいるレイヤー行(.ly.sel): 地 / 枠
    boxGrad: { light: "rgba(255,252,246,0.85)", dark: "rgba(214,196,170,0.55)", border: "rgba(74,51,31,0.28)" }, // 項目内の枠(.lcrop): 左上 / 右下 / 枠
    groupFix: { 67: { hue: 28, fg: "#5c361b" } } // レイヤーのグループ色(--g の色合い)を茶に: 67(黄)→ 色合い 28 + 数字の色
  },
  // その他の CSS(1 行 1 規則)
  // 形と背景(look)
  look: {
    // 入れ子の枠(サイズの中の枠・入力画像の枠・LoRA の枠・結果の表示など): 少し明るくして、ブロックの色が少し透けるようにする
    inner: { back: { gradation: ["rgba(252, 248, 240, 0.5)"] }, borderColor: "rgba(74, 51, 31, 0.2)" },  // 1 色(薄い色に透明度。ブロックの色が透ける)・枠の線は入力欄などと同じ薄さ
    // タイムラインの文字のクリップは、白い文字が読めるように地を濃くする
    clip: { text: { back: { gradation: ["#8a6a1c", "#6e5416"] } } },
  },
  extraCss: [
    '#cca-vedit button[data-c="stretch"].on.on.on{color:#5c361b !important;background-color:#e3d2bc !important;border-color:#5c361b !important}', // 動画編集: 伸縮(タイムストレッチ)ボタン(茶の文字・薄い茶の地)
    '#cca-vedit .tl .blk, #cca-vedit .tl .blk *:not(canvas){color:#ffffff !important}', // 動画編集: タイムラインのバーの中の文字を白
    '#cca-vedit .tl .blk.sel{box-shadow:0 0 0 2px #fff8e6 inset,0 0 0 3px #e08a1e !important;filter:brightness(1.25) saturate(1.15)}', // 動画編集: 選んでいるバーをはっきり(明るい内枠 + 橙の外枠)
    '.cca-lic.ok{background-color:#4f6b3a !important;color:#ffffff !important}', // ライセンスのタグ「商用可」: 地の色と白い文字
    '.cca-lic.cond{background-color:#8a6a1c !important;color:#ffffff !important}', // ライセンスのタグ「条件付き」: 地の色と白い文字
    '.cca-lic.out{background-color:#7a5535 !important;color:#ffffff !important}', // ライセンスのタグ「生成物のみ商用可」: 地の色と白い文字
    '.cca-lic.no{background-color:#5c361b !important;color:#ffffff !important}', // ライセンスのタグ「非商用のみ」: 地の色と白い文字
    '.cca-lic.unknown{background-color:#5b5148 !important;color:#ffffff !important}' // ライセンスのタグ「不明」: 地の色と白い文字
  ].join("\n"),
  snapOn: { bg: "#aebd94", fg: "#2e3a1e", border: "#3b4a29" }, // スナップがオンの時: 地 / 文字 / 枠
  // 項目ごとの色(グラデーションもここから作る): accent=見出し・強調 / tint=グラデーションの地 / border=枠
  sections: {
    model:    { accent: "#5c361b", tint: "rgba(92, 54, 27, 0.22)",    border: "rgba(92, 54, 27, 0.46)" },  // モデル
    images:   { accent: "#3b4a29", tint: "rgba(59, 74, 41, 0.22)",   border: "rgba(59, 74, 41, 0.46)" },  // 入力画像
    prompt:   { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",   border: "rgba(74, 51, 31, 0.46)" },  // プロンプト
    models:   { accent: "#3d2b1d", tint: "rgba(61, 43, 29, 0.22)",    border: "rgba(61, 43, 29, 0.46)" },  // モデル(詳細)
    hires:    { accent: "#3b4a29", tint: "rgba(59, 74, 41, 0.22)",   border: "rgba(59, 74, 41, 0.46)" },  // 高解像度化
    tile:     { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",   border: "rgba(74, 51, 31, 0.46)" },  // タイル生成
    size:     { accent: "#2b2018", tint: "rgba(43, 32, 24, 0.22)",    border: "rgba(43, 32, 24, 0.46)" },  // サイズ
    audiogen: { accent: "#3d2b1d", tint: "rgba(61, 43, 29, 0.22)",    border: "rgba(61, 43, 29, 0.46)" },  // 音声生成
    sampling: { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",   border: "rgba(74, 51, 31, 0.46)" },  // 生成設定
    models2:  { accent: "#2b2018", tint: "rgba(43, 32, 24, 0.22)",    border: "rgba(43, 32, 24, 0.46)" },  // その他モデル
    out:      { accent: "#3b4a29", tint: "rgba(59, 74, 41, 0.22)",   border: "rgba(59, 74, 41, 0.46)" },  // 保存先
    shapes:   { accent: "#5c361b", tint: "rgba(92, 54, 27, 0.22)",    border: "rgba(92, 54, 27, 0.46)" },  // 図形
    text:     { accent: "#3d2b1d", tint: "rgba(61, 43, 29, 0.22)",    border: "rgba(61, 43, 29, 0.46)" },  // 文字
    watermark:{ accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",   border: "rgba(74, 51, 31, 0.46)" },
    bgremove: { accent: "#3b4a29", tint: "rgba(59, 74, 41, 0.22)",   border: "rgba(59, 74, 41, 0.46)" },  // 背景を消す
    inpaint:  { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",   border: "rgba(74, 51, 31, 0.46)" },  // 部分修正
    bg:       { accent: "#5c361b", tint: "rgba(92, 54, 27, 0.22)",    border: "rgba(92, 54, 27, 0.46)" },  // 背景
    effects:  { accent: "#44552f", tint: "rgba(68, 85, 47, 0.22)",  border: "rgba(68, 85, 47, 0.46)" },  // 効果
    filter:   { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",   border: "rgba(74, 51, 31, 0.46)" },  // フィルター
    layers:   { accent: "#2b2018", tint: "rgba(43, 32, 24, 0.22)",    border: "rgba(43, 32, 24, 0.46)" },  // レイヤー
    audio:    { accent: "#3d2b1d", tint: "rgba(61, 43, 29, 0.22)",    border: "rgba(61, 43, 29, 0.46)" },  // 音声
    timeline: { accent: "#5c361b", tint: "rgba(92, 54, 27, 0.22)",    border: "rgba(92, 54, 27, 0.46)" },  // タイムライン
    canvas:   { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",    border: "rgba(74, 51, 31, 0.46)" },  // キャンバス
    export:   { accent: "#3b4a29", tint: "rgba(59, 74, 41, 0.22)",    border: "rgba(59, 74, 41, 0.46)" },  // 書き出す動画
    output:   { accent: "#3b4a29", tint: "rgba(59, 74, 41, 0.22)",    border: "rgba(59, 74, 41, 0.46)" },  // 書き出し
    insp:     { accent: "#3d2b1d", tint: "rgba(61, 43, 29, 0.22)",    border: "rgba(61, 43, 29, 0.46)" },  // 選んだレイヤーの設定(動画編集)
    remove:   { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",    border: "rgba(74, 51, 31, 0.46)" },  // オブジェクト除去
    guide:    { accent: "#2b2018", tint: "rgba(43, 32, 24, 0.20)",    border: "rgba(43, 32, 24, 0.44)" },  // 使い方
    tools:    { accent: "#4a2a14", tint: "rgba(74, 42, 20, 0.22)",    border: "rgba(74, 42, 20, 0.48)" },  // ツール
    neg:      { accent: "#5c361b", tint: "rgba(92, 54, 27, 0.22)",    border: "rgba(92, 54, 27, 0.46)" },  // マイナスプロンプト
    reg:      { accent: "#3b4a29", tint: "rgba(59, 74, 41, 0.22)",    border: "rgba(59, 74, 41, 0.46)" },  // 範囲別指定
    gen:      { accent: "#5c361b", tint: "rgba(92, 54, 27, 0.22)",    border: "rgba(92, 54, 27, 0.46)" },  // 生成ボタン
    result:   { accent: "#4a331f", tint: "rgba(74, 51, 31, 0.22)",    border: "rgba(74, 51, 31, 0.46)" },  // 生成結果
    hist:     { accent: "#3d2b1d", tint: "rgba(61, 43, 29, 0.22)",    border: "rgba(61, 43, 29, 0.46)" },  // 履歴
    info:     { accent: "#2b2018", tint: "rgba(43, 32, 24, 0.22)",    border: "rgba(43, 32, 24, 0.46)" }   // 生成情報
  }
};
