// 配色(テーマ)の切り替え。生成パネル・画像編集・動画編集の色を、選んだ配色に置き換える。
// 画面の色はもとの配色(クラシック。暗い色)で書いてあり、ここで 1 色ずつ置き換える:
//   - 色の少ない色(背景・線・文字): もとの明るさの順に、配色の背景 bg → 文字 fg の間の色にする(明るい配色では明るさが逆になる)
//   - 青緑の色(ボタンなどの強調): 配色の accent の色合い、黄色(目印): accent2 の色合い。ほかの色(赤のエラー・緑など)は色合いを残す
//   - 半透明の黒・白(影など)はそのまま
// 置き換えるのは、パネル・編集画面の <style> と、その中の要素の style 属性。プレビュー(画像・動画の中身)は置き換えない。
const KEY = "cca_generator.theme";
// ---- 配色の項目(THEMES の 1 つ分)。色は #rgb・#rgba・#rrggbb・#rrggbbaa(最後の 2 桁が不透明度 00〜ff)で書ける
//   id      保存に使う名前(変えない)
//   name    プルダウンに出す名前(英語などの表示は言語パックで訳す)
//   light   true = 明るい配色(地が明るく文字が暗い)。もとの暗い配色の明るさを逆にして使う
//   bg      地の色: パネル・編集画面の地。欄(カード)・入力欄・タイムラインの地・ダイアログの地も、この色から fg 寄りに作る
//   fg      文字の色: ふつうの文字。線・枠・薄い文字(説明・ヒント)は bg と fg の間の色になる
//   accent  強調の色(もとは青緑): 生成ボタン・選んでいるボタン(タスク・ツール・選択中)・「＋ 追加」など主なボタン・選んだレイヤーの枠・スライダー
//   accent2 目印の色(もとは黄): スナップのオン・強調表示の枠・目印の文字など
//   grad    [上の色, 下の色]: 地のグラデーション(省略すると bg から作る)
//   alpha   不透明度(0〜1): { panel: 地のグラデーション(既定 1), card: 欄(既定 0.86), go: 生成ボタン(既定 0.78) }
//   hueMap  [[色合い(0〜360), 色], …]: その色合い(±28)の色を、指定した色の色合いにする(差し色)
//   rainbow true = 色の付いた所を色鉛筆の 7 色に寄せる
//   classic true = 置き換えない(もとの配色)
//   select  セレクト(プルダウン)の色。書いた項目だけ置き換わり、書かない項目はこれまで通り(vars の --card・--text など)の色になる
//           色は #rrggbb・rgba(...) などそのまま使われる(明るさの置き換えはしない)
//             bg 閉じている時の箱の地 / fg その文字 / border その枠 / arrow ▾ の色
//             menuBg 開いた一覧の地 / menuFg 一覧の文字 / menuBorder 一覧の枠
//             hoverBg・hoverFg カーソルを乗せた・キーで選んでいる項目 / selectedBg・selectedFg 今選ばれている項目 / groupFg グループ見出し
//           例: select: { bg: "#fffcf8", fg: "#2b1e16", border: "#c9b49b", menuBg: "#fffcf8", hoverBg: "#ead7c0", selectedBg: "#9c5c26", selectedFg: "#ffffff" }
//   onFg    地が濃い色のボタン(選んでいるボタン(.on)・「開く」など)の文字色。スナップ以外。書いた配色だけ置き換わり、書かない配色はこれまで通り
//   snapOn  スナップがオンの時の色: { bg 地 / fg 文字 / border 枠 }。書いた項目だけ置き換わる
// 色の不透明度: bg・fg に付けると地・欄・線・文字が、accent・accent2・hueMap の色に付けると、その色から作る所が透ける。
// エラーの赤・成功の緑などは色合いを残し、明るさだけ配色に合わせる。半透明の黒・白(影など)はそのまま。
export const THEMES = [
  {
    id: "cca10",                 // 保存に使う名前(変えない)
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
      "--ok": "#6c7c54"  // 成功の色
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
    extraCss: [
      '#cca-vedit button[data-c="stretch"].on.on.on{color:#5c361b !important;background-color:#e3d2bc !important;border-color:#5c361b !important}', // 動画編集: 伸縮(タイムストレッチ)ボタン(茶の文字・薄い茶の地)
      '#cca-vedit .tl .blk, #cca-vedit .tl .blk *:not(canvas){color:#ffffff !important}' // 動画編集: タイムラインのバーの中の文字を白
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
      tools:    { accent: "#4a2a14", tint: "rgba(74, 42, 20, 0.22)",    border: "rgba(74, 42, 20, 0.48)" }  // ツール
    }
  },
  {
    id: "cca03",
    name: "CCA-v0.3",
    light: true,
    bg: "#fcf6ef",
    fg: "#2b1e16",
    accent: "#9c5c26",
    accent2: "#735341",
    grad: ["#fcf6ef", "#5a3b27"],
    hueMap: [[0, "#856553"]],
    vars: {
      "--bg": "#fcf6ef",
      "--panel": "#f6e6d2",
      "--card": "#fffcf8",
      "--card2": "#ead7c0",
      "--text": "#2b1e16",
      "--muted": "#5c4233",
      "--border": "rgba(43, 30, 22, 0.18)",
      "--accent": "#9c5c26",
      "--accent2": "#735341",
      "--accent-fg": "#ffffff",
      "--danger": "#9c5c26",
      "--warn": "#b87a2e",
      "--ok": "#735341"
    },
    deco: {
      cardShadow: "0 2px 10px rgba(43, 30, 22, 0.12), inset 0 1px 0 rgba(255, 252, 248, 0.75)",
      secCardShadow: "0 2px 10px rgba(43, 30, 22, 0.11), inset 0 1px 0 rgba(255, 252, 248, 0.75)",
      btnGrad: "linear-gradient(180deg, rgba(255, 252, 248, 0.45), rgba(246, 230, 210, 0.08) 48%, rgba(43, 30, 22, 0.10))",
      btnShadow: "inset 0 1px 0 rgba(255, 252, 248, 0.65), inset 0 -2px 3px rgba(43, 30, 22, 0.16), 0 1px 3px rgba(43, 30, 22, 0.22)",
      btnActiveShadow: "inset 0 2px 4px rgba(43, 30, 22, 0.3)",
      goBorder: "#fffcf8",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(43, 30, 22, 0.65)",
      goShadow: "inset 0 2px 0 rgba(255, 252, 248, 0.45), inset 0 -6px 12px rgba(43, 30, 22, 0.25), 0 6px 16px rgba(43, 30, 22, 0.42)"
    },
    sections: {
      model:    { accent: "#9c5c26", tint: "rgba(156, 92, 38, 0.12)",   border: "rgba(156, 92, 38, 0.32)" },
      images:   { accent: "#735341", tint: "rgba(115, 83, 65, 0.12)",   border: "rgba(115, 83, 65, 0.32)" },
      prompt:   { accent: "#694530", tint: "rgba(105, 69, 48, 0.12)",   border: "rgba(105, 69, 48, 0.32)" },
      models:   { accent: "#a8642b", tint: "rgba(168, 100, 43, 0.12)",  border: "rgba(168, 100, 43, 0.32)" },
      hires:    { accent: "#735341", tint: "rgba(115, 83, 65, 0.11)",   border: "rgba(115, 83, 65, 0.30)" },
      tile:     { accent: "#9c5c26", tint: "rgba(156, 92, 38, 0.11)",   border: "rgba(156, 92, 38, 0.30)" },
      size:     { accent: "#614736", tint: "rgba(97, 71, 54, 0.11)",    border: "rgba(97, 71, 54, 0.30)" },
      audiogen: { accent: "#a8642b", tint: "rgba(168, 100, 43, 0.12)",  border: "rgba(168, 100, 43, 0.32)" },
      sampling: { accent: "#b87a2e", tint: "rgba(184, 122, 46, 0.12)",  border: "rgba(184, 122, 46, 0.32)" },
      models2:  { accent: "#694530", tint: "rgba(105, 69, 48, 0.11)",   border: "rgba(105, 69, 48, 0.30)" },
      out:      { accent: "#735341", tint: "rgba(115, 83, 65, 0.11)",   border: "rgba(115, 83, 65, 0.30)" },
      shapes:   { accent: "#9c5c26", tint: "rgba(156, 92, 38, 0.12)",   border: "rgba(156, 92, 38, 0.34)" },
      text:     { accent: "#694530", tint: "rgba(105, 69, 48, 0.12)",   border: "rgba(105, 69, 48, 0.32)" },
      watermark:{ accent: "#b87a2e", tint: "rgba(184, 122, 46, 0.12)",  border: "rgba(184, 122, 46, 0.32)" },
      bgremove: { accent: "#735341", tint: "rgba(115, 83, 65, 0.12)",   border: "rgba(115, 83, 65, 0.32)" },
      inpaint:  { accent: "#9c5c26", tint: "rgba(156, 92, 38, 0.12)",   border: "rgba(156, 92, 38, 0.32)" },
      bg:       { accent: "#9c5c26", tint: "rgba(156, 92, 38, 0.12)",   border: "rgba(156, 92, 38, 0.34)" },
      effects:  { accent: "#735341", tint: "rgba(115, 83, 65, 0.12)",   border: "rgba(115, 83, 65, 0.32)" },
      filter:   { accent: "#b87a2e", tint: "rgba(184, 122, 46, 0.12)",  border: "rgba(184, 122, 46, 0.32)" },
      layers:   { accent: "#614736", tint: "rgba(97, 71, 54, 0.11)",    border: "rgba(97, 71, 54, 0.30)" },
      audio:    { accent: "#a8642b", tint: "rgba(168, 100, 43, 0.12)",  border: "rgba(168, 100, 43, 0.32)" },
      timeline: { accent: "#9c5c26", tint: "rgba(156, 92, 38, 0.12)",   border: "rgba(156, 92, 38, 0.34)" }
    }
  },
  {
    id: "aqua",
    name: "みずいろパステル",
    light: true,
    bg: "#f7fcfd",
    fg: "#162636",
    accent: "#28a9cf",
    accent2: "#e88da5",
    grad: ["#ffffff", "#d8f0f8"],
    hueMap: [[0, "#e88da5"], [285, "#5abbe0"], [315, "#e88da5"]],
    vars: {
      "--bg": "#f7fcfd",
      "--panel": "#ffffff",
      "--card": "#ffffff",
      "--card2": "#e2f4fa",
      "--text": "#162636",
      "--muted": "#435970",
      "--border": "rgba(22, 38, 54, 0.16)",
      "--accent": "#28a9cf",
      "--accent2": "#e88da5",
      "--accent-fg": "#ffffff",
      "--danger": "#e88da5",
      "--warn": "#5abbe0",
      "--ok": "#28a9cf"
    },
    deco: {
      cardShadow: "0 2px 10px rgba(22, 38, 54, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
      secCardShadow: "0 2px 10px rgba(22, 38, 54, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
      btnGrad: "linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(224, 245, 252, 0.18) 48%, rgba(40, 169, 207, 0.08))",
      btnShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.85), inset 0 -2px 3px rgba(22, 38, 54, 0.10), 0 1px 3px rgba(22, 38, 54, 0.14)",
      btnActiveShadow: "inset 0 2px 4px rgba(22, 38, 54, 0.22)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(22, 38, 54, 0.50)",
      goShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.65), inset 0 -6px 12px rgba(25, 130, 170, 0.24), 0 6px 16px rgba(40, 169, 207, 0.36)"
    },
    sections: {
      model:    { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.13)",  border: "rgba(40, 169, 207, 0.34)" },
      images:   { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.15)", border: "rgba(232, 141, 165, 0.36)" },
      prompt:   { accent: "#5abbe0", tint: "rgba(90, 187, 224, 0.14)",  border: "rgba(90, 187, 224, 0.34)" },
      models:   { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.12)",  border: "rgba(40, 169, 207, 0.32)" },
      hires:    { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.13)", border: "rgba(232, 141, 165, 0.32)" },
      tile:     { accent: "#5abbe0", tint: "rgba(90, 187, 224, 0.13)",  border: "rgba(90, 187, 224, 0.32)" },
      size:     { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.12)",  border: "rgba(40, 169, 207, 0.32)" },
      audiogen: { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.14)", border: "rgba(232, 141, 165, 0.34)" },
      sampling: { accent: "#5abbe0", tint: "rgba(90, 187, 224, 0.13)",  border: "rgba(90, 187, 224, 0.32)" },
      models2:  { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.12)",  border: "rgba(40, 169, 207, 0.32)" },
      out:      { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.13)", border: "rgba(232, 141, 165, 0.32)" },
      shapes:   { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.14)",  border: "rgba(40, 169, 207, 0.36)" },
      text:     { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.15)", border: "rgba(232, 141, 165, 0.36)" },
      watermark:{ accent: "#5abbe0", tint: "rgba(90, 187, 224, 0.14)",  border: "rgba(90, 187, 224, 0.34)" },
      bgremove: { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.13)",  border: "rgba(40, 169, 207, 0.34)" },
      inpaint:  { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.14)", border: "rgba(232, 141, 165, 0.34)" },
      bg:       { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.14)",  border: "rgba(40, 169, 207, 0.36)" },
      effects:  { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.14)", border: "rgba(232, 141, 165, 0.34)" },
      filter:   { accent: "#5abbe0", tint: "rgba(90, 187, 224, 0.14)",  border: "rgba(90, 187, 224, 0.34)" },
      layers:   { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.13)",  border: "rgba(40, 169, 207, 0.34)" },
      audio:    { accent: "#e88da5", tint: "rgba(232, 141, 165, 0.14)", border: "rgba(232, 141, 165, 0.34)" },
      timeline: { accent: "#28a9cf", tint: "rgba(40, 169, 207, 0.14)",  border: "rgba(40, 169, 207, 0.36)" }
    }
  },
  {
    id: "dream",
    name: "ドリーム",
    light: true,
    bg: "#faf7fe",
    fg: "#291e3d",
    accent: "#9a72cf",
    accent2: "#e8bf5a",
    grad: ["#fffdfb", "#dfd4f5"],
    hueMap: [[0, "#e696b8"], [200, "#8eb8e8"], [320, "#e696b8"]],
    vars: {
      "--bg": "#faf7fe",
      "--panel": "#fffdfb",
      "--card": "#ffffff",
      "--card2": "#ece3fa",
      "--text": "#291e3d",
      "--muted": "#584973",
      "--border": "rgba(41, 30, 61, 0.16)",
      "--accent": "#9a72cf",
      "--accent2": "#e8bf5a",
      "--accent-fg": "#ffffff",
      "--danger": "#e696b8",
      "--warn": "#e8bf5a",
      "--ok": "#8eb8e8"
    },
    deco: {
      cardShadow: "0 2px 10px rgba(41, 30, 61, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
      secCardShadow: "0 2px 10px rgba(41, 30, 61, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
      btnGrad: "linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(242, 232, 255, 0.16) 48%, rgba(154, 114, 207, 0.08))",
      btnShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.85), inset 0 -2px 3px rgba(41, 30, 61, 0.10), 0 1px 3px rgba(41, 30, 61, 0.14)",
      btnActiveShadow: "inset 0 2px 4px rgba(41, 30, 61, 0.22)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(41, 30, 61, 0.50)",
      goShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.65), inset 0 -6px 12px rgba(115, 75, 170, 0.24), 0 6px 16px rgba(154, 114, 207, 0.36)"
    },
    sections: {
      model:    { accent: "#9a72cf", tint: "rgba(154, 114, 207, 0.14)", border: "rgba(154, 114, 207, 0.34)" },
      images:   { accent: "#e696b8", tint: "rgba(230, 150, 184, 0.15)", border: "rgba(230, 150, 184, 0.36)" },
      prompt:   { accent: "#8eb8e8", tint: "rgba(142, 184, 232, 0.15)", border: "rgba(142, 184, 232, 0.35)" },
      models:   { accent: "#9a72cf", tint: "rgba(154, 114, 207, 0.12)", border: "rgba(154, 114, 207, 0.32)" },
      hires:    { accent: "#8eb8e8", tint: "rgba(142, 184, 232, 0.13)", border: "rgba(142, 184, 232, 0.32)" },
      tile:     { accent: "#e696b8", tint: "rgba(230, 150, 184, 0.13)", border: "rgba(230, 150, 184, 0.32)" },
      size:     { accent: "#8eb8e8", tint: "rgba(142, 184, 232, 0.13)", border: "rgba(142, 184, 232, 0.32)" },
      audiogen: { accent: "#e696b8", tint: "rgba(230, 150, 184, 0.14)", border: "rgba(230, 150, 184, 0.34)" },
      sampling: { accent: "#d9ab3f", tint: "rgba(217, 171, 63, 0.15)",  border: "rgba(217, 171, 63, 0.36)" },
      models2:  { accent: "#9a72cf", tint: "rgba(154, 114, 207, 0.12)", border: "rgba(154, 114, 207, 0.32)" },
      out:      { accent: "#8eb8e8", tint: "rgba(142, 184, 232, 0.13)", border: "rgba(142, 184, 232, 0.32)" },
      shapes:   { accent: "#9a72cf", tint: "rgba(154, 114, 207, 0.14)", border: "rgba(154, 114, 207, 0.36)" },
      text:     { accent: "#e696b8", tint: "rgba(230, 150, 184, 0.15)", border: "rgba(230, 150, 184, 0.36)" },
      watermark:{ accent: "#d9ab3f", tint: "rgba(217, 171, 63, 0.15)",  border: "rgba(217, 171, 63, 0.36)" },
      bgremove: { accent: "#8eb8e8", tint: "rgba(142, 184, 232, 0.14)", border: "rgba(142, 184, 232, 0.34)" },
      inpaint:  { accent: "#e696b8", tint: "rgba(230, 150, 184, 0.14)", border: "rgba(230, 150, 184, 0.34)" },
      bg:       { accent: "#9a72cf", tint: "rgba(154, 114, 207, 0.14)", border: "rgba(154, 114, 207, 0.36)" },
      effects:  { accent: "#e696b8", tint: "rgba(230, 150, 184, 0.14)", border: "rgba(230, 150, 184, 0.34)" },
      filter:   { accent: "#d9ab3f", tint: "rgba(217, 171, 63, 0.14)",  border: "rgba(217, 171, 63, 0.34)" },
      layers:   { accent: "#8eb8e8", tint: "rgba(142, 184, 232, 0.13)", border: "rgba(142, 184, 232, 0.34)" },
      audio:    { accent: "#e696b8", tint: "rgba(230, 150, 184, 0.14)", border: "rgba(230, 150, 184, 0.34)" },
      timeline: { accent: "#9a72cf", tint: "rgba(154, 114, 207, 0.14)", border: "rgba(154, 114, 207, 0.36)" }
    }
  },
  {
    id: "spring",
    name: "春",
    light: true,
    bg: "#fff8fb",
    fg: "#2e1621",
    accent: "#e87296",
    accent2: "#47a3db",
    grad: ["#ffffff", "#fce4ee"],
    hueMap: [[0, "#c83258"], [340, "#e87296"], [205, "#47a3db"]],
    vars: {
      "--bg": "#fff8fb",
      "--panel": "#ffffff",
      "--card": "#ffffff",
      "--card2": "#fde6ef",
      "--text": "#2e1621",
      "--muted": "#613d4d",
      "--border": "rgba(46, 22, 33, 0.16)",
      "--accent": "#e87296",
      "--accent2": "#47a3db",
      "--accent-fg": "#ffffff",
      "--danger": "#c83258",
      "--warn": "#e87296",
      "--ok": "#47a3db"
    },
    deco: {
      cardShadow: "0 2px 10px rgba(46, 22, 33, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
      secCardShadow: "0 2px 10px rgba(46, 22, 33, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
      btnGrad: "linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 240, 246, 0.16) 48%, rgba(232, 114, 150, 0.08))",
      btnShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.85), inset 0 -2px 3px rgba(46, 22, 33, 0.10), 0 1px 3px rgba(46, 22, 33, 0.14)",
      btnActiveShadow: "inset 0 2px 4px rgba(46, 22, 33, 0.22)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(46, 22, 33, 0.50)",
      goShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.65), inset 0 -6px 12px rgba(190, 75, 110, 0.24), 0 6px 16px rgba(232, 114, 150, 0.36)"
    },
    sections: {
      model:    { accent: "#e87296", tint: "rgba(232, 114, 150, 0.13)", border: "rgba(232, 114, 150, 0.34)" },
      images:   { accent: "#47a3db", tint: "rgba(71, 163, 219, 0.13)",  border: "rgba(71, 163, 219, 0.34)" },
      prompt:   { accent: "#c83258", tint: "rgba(200, 50, 88, 0.11)",   border: "rgba(200, 50, 88, 0.32)" },
      models:   { accent: "#e87296", tint: "rgba(232, 114, 150, 0.12)", border: "rgba(232, 114, 150, 0.32)" },
      hires:    { accent: "#47a3db", tint: "rgba(71, 163, 219, 0.12)",  border: "rgba(71, 163, 219, 0.32)" },
      tile:     { accent: "#e87296", tint: "rgba(232, 114, 150, 0.12)", border: "rgba(232, 114, 150, 0.32)" },
      size:     { accent: "#47a3db", tint: "rgba(71, 163, 219, 0.12)",  border: "rgba(71, 163, 219, 0.32)" },
      audiogen: { accent: "#c83258", tint: "rgba(200, 50, 88, 0.11)",   border: "rgba(200, 50, 88, 0.32)" },
      sampling: { accent: "#e87296", tint: "rgba(232, 114, 150, 0.12)", border: "rgba(232, 114, 150, 0.32)" },
      models2:  { accent: "#e87296", tint: "rgba(232, 114, 150, 0.12)", border: "rgba(232, 114, 150, 0.32)" },
      out:      { accent: "#47a3db", tint: "rgba(71, 163, 219, 0.12)",  border: "rgba(71, 163, 219, 0.32)" },
      shapes:   { accent: "#e87296", tint: "rgba(232, 114, 150, 0.14)", border: "rgba(232, 114, 150, 0.36)" },
      text:     { accent: "#c83258", tint: "rgba(200, 50, 88, 0.12)",   border: "rgba(200, 50, 88, 0.34)" },
      watermark:{ accent: "#47a3db", tint: "rgba(71, 163, 219, 0.13)",  border: "rgba(71, 163, 219, 0.34)" },
      bgremove: { accent: "#47a3db", tint: "rgba(71, 163, 219, 0.13)",  border: "rgba(71, 163, 219, 0.34)" },
      inpaint:  { accent: "#e87296", tint: "rgba(232, 114, 150, 0.13)", border: "rgba(232, 114, 150, 0.34)" },
      bg:       { accent: "#e87296", tint: "rgba(232, 114, 150, 0.14)", border: "rgba(232, 114, 150, 0.36)" },
      effects:  { accent: "#47a3db", tint: "rgba(71, 163, 219, 0.13)",  border: "rgba(71, 163, 219, 0.34)" },
      filter:   { accent: "#c83258", tint: "rgba(200, 50, 88, 0.12)",   border: "rgba(200, 50, 88, 0.34)" },
      layers:   { accent: "#e87296", tint: "rgba(232, 114, 150, 0.13)", border: "rgba(232, 114, 150, 0.34)" },
      audio:    { accent: "#47a3db", tint: "rgba(71, 163, 219, 0.13)",  border: "rgba(71, 163, 219, 0.34)" },
      timeline: { accent: "#e87296", tint: "rgba(232, 114, 150, 0.14)", border: "rgba(232, 114, 150, 0.36)" }
    }
  },
  {
    id: "power",
    name: "パワフル",
    light: true,
    bg: "#fff6ea",
    fg: "#261207",
    accent: "#d93429",
    accent2: "#d97d1c",
    grad: ["#fffbf4", "#f3d4aa"],
    hueMap: [[35, "#d97d1c"], [120, "#4da83b"]],
    vars: {
      "--bg": "#fff6ea",
      "--panel": "#fffbf4",
      "--card": "#ffffff",
      "--card2": "#f3d4aa",
      "--text": "#261207",
      "--muted": "#5c351c",
      "--border": "rgba(38, 18, 7, 0.18)",
      "--accent": "#d93429",
      "--accent2": "#d97d1c",
      "--accent-fg": "#ffffff",
      "--danger": "#d93429",
      "--warn": "#d97d1c",
      "--ok": "#4da83b"
    },
    deco: {
      cardShadow: "0 2px 10px rgba(38, 18, 7, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.75)",
      secCardShadow: "0 2px 10px rgba(38, 18, 7, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.75)",
      btnGrad: "linear-gradient(180deg, rgba(255, 255, 255, 0.45), rgba(255, 246, 234, 0.08) 48%, rgba(38, 18, 7, 0.08))",
      btnShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.65), inset 0 -2px 3px rgba(38, 18, 7, 0.15), 0 1px 3px rgba(38, 18, 7, 0.20)",
      btnActiveShadow: "inset 0 2px 4px rgba(38, 18, 7, 0.28)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(38, 18, 7, 0.55)",
      goShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.45), inset 0 -6px 12px rgba(120, 20, 15, 0.25), 0 6px 16px rgba(217, 52, 41, 0.40)"
    },
    sections: {
      model:    { accent: "#d93429", tint: "rgba(217, 52, 41, 0.12)",   border: "rgba(217, 52, 41, 0.34)" },
      images:   { accent: "#d97d1c", tint: "rgba(217, 125, 28, 0.12)",  border: "rgba(217, 125, 28, 0.32)" },
      prompt:   { accent: "#c76e18", tint: "rgba(199, 110, 24, 0.12)",  border: "rgba(199, 110, 24, 0.32)" },
      models:   { accent: "#d93429", tint: "rgba(217, 52, 41, 0.11)",   border: "rgba(217, 52, 41, 0.32)" },
      hires:    { accent: "#d97d1c", tint: "rgba(217, 125, 28, 0.11)",  border: "rgba(217, 125, 28, 0.30)" },
      tile:     { accent: "#b85f1c", tint: "rgba(184, 95, 28, 0.11)",   border: "rgba(184, 95, 28, 0.30)" },
      size:     { accent: "#d93429", tint: "rgba(217, 52, 41, 0.11)",   border: "rgba(217, 52, 41, 0.30)" },
      audiogen: { accent: "#c93026", tint: "rgba(201, 48, 38, 0.12)",   border: "rgba(201, 48, 38, 0.32)" },
      sampling: { accent: "#d97d1c", tint: "rgba(217, 125, 28, 0.12)",  border: "rgba(217, 125, 28, 0.32)" },
      models2:  { accent: "#8c4e22", tint: "rgba(140, 78, 34, 0.11)",   border: "rgba(140, 78, 34, 0.30)" },
      out:      { accent: "#d97d1c", tint: "rgba(217, 125, 28, 0.11)",  border: "rgba(217, 125, 28, 0.30)" },
      shapes:   { accent: "#d93429", tint: "rgba(217, 52, 41, 0.13)",   border: "rgba(217, 52, 41, 0.36)" },
      text:     { accent: "#d97d1c", tint: "rgba(217, 125, 28, 0.12)",  border: "rgba(217, 125, 28, 0.34)" },
      watermark:{ accent: "#c76e18", tint: "rgba(199, 110, 24, 0.12)",  border: "rgba(199, 110, 24, 0.32)" },
      bgremove: { accent: "#d97d1c", tint: "rgba(217, 125, 28, 0.12)",  border: "rgba(217, 125, 28, 0.32)" },
      inpaint:  { accent: "#d93429", tint: "rgba(217, 52, 41, 0.12)",   border: "rgba(217, 52, 41, 0.34)" },
      bg:       { accent: "#d93429", tint: "rgba(217, 52, 41, 0.13)",   border: "rgba(217, 52, 41, 0.36)" },
      effects:  { accent: "#d97d1c", tint: "rgba(217, 125, 28, 0.12)",  border: "rgba(217, 125, 28, 0.34)" },
      filter:   { accent: "#c76e18", tint: "rgba(199, 110, 24, 0.12)",  border: "rgba(199, 110, 24, 0.32)" },
      layers:   { accent: "#8c4e22", tint: "rgba(140, 78, 34, 0.11)",   border: "rgba(140, 78, 34, 0.30)" },
      audio:    { accent: "#c93026", tint: "rgba(201, 48, 38, 0.12)",   border: "rgba(201, 48, 38, 0.32)" },
      timeline: { accent: "#d93429", tint: "rgba(217, 52, 41, 0.13)",   border: "rgba(217, 52, 41, 0.36)" }
    }
  },
  {
    id: "colorful",
    name: "カラフル",
    light: false,
    bg: "#070a2c",
    fg: "#ffffff",
    accent: "#3fae3a",
    accent2: "#f6c919",
    rainbow: true,
    vars: {
      "--bg": "#070a2c",
      "--panel": "#0f143d",
      "--card": "#171d52",
      "--card2": "#202768",
      "--text": "#ffffff",
      "--muted": "#cad3fa",
      "--border": "rgba(255, 255, 255, 0.18)",
      "--accent": "#3fae3a",
      "--accent2": "#f6c919",
      "--accent-fg": "#ffffff",
      "--danger": "#ff4d6d",
      "--warn": "#f6c919",
      "--ok": "#3fae3a"
    },
    deco: {
      cardShadow: "0 2px 10px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.32)",
      secCardShadow: "0 2px 10px rgba(0,0,0,.11), inset 0 1px 0 rgba(255,255,255,.35)",
      btnGrad: "linear-gradient(180deg, rgba(255,255,255,.32), rgba(255,255,255,.06) 48%, rgba(0,0,0,.08))",
      btnShadow: "inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 3px rgba(0,0,0,.16), 0 1px 3px rgba(0,0,0,.22)",
      btnActiveShadow: "inset 0 2px 4px rgba(0,0,0,.3)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(0,0,0,.5)",
      goShadow: "inset 0 2px 0 rgba(255,255,255,.45), inset 0 -6px 12px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.45)"
    },
    sections: {
      model:    { accent: "#ff4d8d", tint: "rgba(255, 77, 141, 0.12)",  border: "rgba(255, 77, 141, 0.34)" },
      images:   { accent: "#00d4ff", tint: "rgba(0, 212, 255, 0.12)",   border: "rgba(0, 212, 255, 0.32)" },
      prompt:   { accent: "#f6c919", tint: "rgba(246, 201, 25, 0.12)",  border: "rgba(246, 201, 25, 0.32)" },
      models:   { accent: "#a855f7", tint: "rgba(168, 85, 247, 0.12)",  border: "rgba(168, 85, 247, 0.32)" },
      hires:    { accent: "#3fae3a", tint: "rgba(63, 174, 58, 0.12)",   border: "rgba(63, 174, 58, 0.32)" },
      tile:     { accent: "#ff9f1c", tint: "rgba(255, 159, 28, 0.12)",  border: "rgba(255, 159, 28, 0.32)" },
      size:     { accent: "#3a86ff", tint: "rgba(58, 134, 255, 0.12)",  border: "rgba(58, 134, 255, 0.32)" },
      audiogen: { accent: "#f72585", tint: "rgba(247, 37, 133, 0.12)",  border: "rgba(247, 37, 133, 0.32)" },
      sampling: { accent: "#ffd166", tint: "rgba(255, 209, 102, 0.12)", border: "rgba(255, 209, 102, 0.32)" },
      models2:  { accent: "#4cc9f0", tint: "rgba(76, 201, 240, 0.12)",  border: "rgba(76, 201, 240, 0.32)" },
      out:      { accent: "#52b788", tint: "rgba(82, 183, 136, 0.12)",  border: "rgba(82, 183, 136, 0.32)" },
      shapes:   { accent: "#00d4ff", tint: "rgba(0, 212, 255, 0.13)",   border: "rgba(0, 212, 255, 0.36)" },
      text:     { accent: "#ff4d8d", tint: "rgba(255, 77, 141, 0.13)",  border: "rgba(255, 77, 141, 0.36)" },
      watermark:{ accent: "#f6c919", tint: "rgba(246, 201, 25, 0.13)",  border: "rgba(246, 201, 25, 0.36)" },
      bgremove: { accent: "#3fae3a", tint: "rgba(63, 174, 58, 0.13)",   border: "rgba(63, 174, 58, 0.36)" },
      inpaint:  { accent: "#a855f7", tint: "rgba(168, 85, 247, 0.13)",  border: "rgba(168, 85, 247, 0.36)" },
      bg:       { accent: "#3a86ff", tint: "rgba(58, 134, 255, 0.13)",  border: "rgba(58, 134, 255, 0.36)" },
      effects:  { accent: "#f72585", tint: "rgba(247, 37, 133, 0.13)",  border: "rgba(247, 37, 133, 0.36)" },
      filter:   { accent: "#ffd166", tint: "rgba(255, 209, 102, 0.13)", border: "rgba(255, 209, 102, 0.36)" },
      layers:   { accent: "#4cc9f0", tint: "rgba(76, 201, 240, 0.13)",  border: "rgba(76, 201, 240, 0.36)" },
      audio:    { accent: "#ff9f1c", tint: "rgba(255, 159, 28, 0.13)",  border: "rgba(255, 159, 28, 0.36)" },
      timeline: { accent: "#3fae3a", tint: "rgba(63, 174, 58, 0.13)",   border: "rgba(63, 174, 58, 0.36)" }
    }
  },
  {
    id: "purple",
    name: "パープルエリア",
    light: false,
    bg: "#120629",
    fg: "#ffffff",
    accent: "#9d3be8",
    accent2: "#ff4da6",
    grad: ["#3b1278", "#120629"],
    hueMap: [[0, "#ff4da6"], [315, "#ff4da6"], [52, "#ffd54f"]],
    vars: {
      "--bg": "#120629",
      "--panel": "#210b47",
      "--card": "#2d115e",
      "--card2": "#3b177a",
      "--text": "#ffffff",
      "--muted": "#ebd9ff",
      "--border": "rgba(255, 255, 255, 0.20)",
      "--accent": "#9d3be8",
      "--accent2": "#ff4da6",
      "--accent-fg": "#ffffff",
      "--danger": "#ff4da6",
      "--warn": "#ffd54f",
      "--ok": "#c084fc"
    },
    deco: {
      cardShadow: "0 2px 12px rgba(10, 3, 25, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.24)",
      secCardShadow: "0 2px 12px rgba(10, 3, 25, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.26)",
      btnGrad: "linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(157, 59, 232, 0.10) 48%, rgba(18, 6, 41, 0.22))",
      btnShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.45), inset 0 -2px 3px rgba(18, 6, 41, 0.28), 0 1px 3px rgba(0, 0, 0, 0.30)",
      btnActiveShadow: "inset 0 2px 4px rgba(18, 6, 41, 0.42)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(23, 9, 51, 0.70)",
      goShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.45), inset 0 -6px 12px rgba(70, 15, 120, 0.35), 0 6px 16px rgba(157, 59, 232, 0.45)"
    },
    sections: {
      model:    { accent: "#9d3be8", tint: "rgba(157, 59, 232, 0.18)",  border: "rgba(157, 59, 232, 0.40)" },
      images:   { accent: "#ff4da6", tint: "rgba(255, 77, 166, 0.16)",  border: "rgba(255, 77, 166, 0.38)" },
      prompt:   { accent: "#f3e8ff", tint: "rgba(243, 232, 255, 0.14)", border: "rgba(243, 232, 255, 0.34)" },
      models:   { accent: "#7e22ce", tint: "rgba(126, 34, 206, 0.18)",  border: "rgba(126, 34, 206, 0.38)" },
      hires:    { accent: "#f472b6", tint: "rgba(244, 114, 182, 0.15)", border: "rgba(244, 114, 182, 0.35)" },
      tile:     { accent: "#ffd54f", tint: "rgba(255, 213, 79, 0.14)",  border: "rgba(255, 213, 79, 0.35)" },
      size:     { accent: "#a855f7", tint: "rgba(168, 85, 247, 0.16)",  border: "rgba(168, 85, 247, 0.36)" },
      audiogen: { accent: "#ff4da6", tint: "rgba(255, 77, 166, 0.16)",  border: "rgba(255, 77, 166, 0.36)" },
      sampling: { accent: "#ffd54f", tint: "rgba(255, 213, 79, 0.14)",  border: "rgba(255, 213, 79, 0.35)" },
      models2:  { accent: "#9d3be8", tint: "rgba(157, 59, 232, 0.16)",  border: "rgba(157, 59, 232, 0.36)" },
      out:      { accent: "#f3e8ff", tint: "rgba(243, 232, 255, 0.13)", border: "rgba(243, 232, 255, 0.32)" },
      shapes:   { accent: "#9d3be8", tint: "rgba(157, 59, 232, 0.18)",  border: "rgba(157, 59, 232, 0.40)" },
      text:     { accent: "#ff4da6", tint: "rgba(255, 77, 166, 0.16)",  border: "rgba(255, 77, 166, 0.38)" },
      watermark:{ accent: "#ffd54f", tint: "rgba(255, 213, 79, 0.15)",  border: "rgba(255, 213, 79, 0.36)" },
      bgremove: { accent: "#f3e8ff", tint: "rgba(243, 232, 255, 0.14)", border: "rgba(243, 232, 255, 0.34)" },
      inpaint:  { accent: "#f472b6", tint: "rgba(244, 114, 182, 0.16)", border: "rgba(244, 114, 182, 0.36)" },
      bg:       { accent: "#9d3be8", tint: "rgba(157, 59, 232, 0.18)",  border: "rgba(157, 59, 232, 0.40)" },
      effects:  { accent: "#ff4da6", tint: "rgba(255, 77, 166, 0.16)",  border: "rgba(255, 77, 166, 0.38)" },
      filter:   { accent: "#ffd54f", tint: "rgba(255, 213, 79, 0.15)",  border: "rgba(255, 213, 79, 0.36)" },
      layers:   { accent: "#f3e8ff", tint: "rgba(243, 232, 255, 0.14)", border: "rgba(243, 232, 255, 0.34)" },
      audio:    { accent: "#f472b6", tint: "rgba(244, 114, 182, 0.16)", border: "rgba(244, 114, 182, 0.36)" },
      timeline: { accent: "#9d3be8", tint: "rgba(157, 59, 232, 0.18)",  border: "rgba(157, 59, 232, 0.40)" }
    }
  },
  {
    id: "bluedia",
    name: "ブルーダイヤモンド",
    light: false,
    bg: "#071326",
    fg: "#ffffff",
    accent: "#29b6f6",
    accent2: "#e0f7ff",
    grad: ["#163c73", "#071326"],
    hueMap: [[0, "#e0f7ff"], [25, "#bae6fd"], [145, "#38bdf8"], [195, "#38bdf8"], [215, "#29b6f6"], [280, "#7dd3fc"], [335, "#f0f9ff"]],
    vars: {
      "--bg": "#071326",
      "--panel": "#10284f",
      "--card": "#153566",
      "--card2": "#1c4582",
      "--text": "#ffffff",
      "--muted": "#d4efff",
      "--border": "rgba(255, 255, 255, 0.22)",
      "--accent": "#29b6f6",
      "--accent2": "#e0f7ff",
      "--accent-fg": "#051226",
      "--danger": "#7dd3fc",
      "--warn": "#e0f7ff",
      "--ok": "#38bdf8"
    },
    deco: {
      cardShadow: "0 2px 12px rgba(4, 12, 26, 0.28), inset 0 1px 0 rgba(240, 249, 255, 0.32)",
      secCardShadow: "0 2px 14px rgba(4, 12, 26, 0.30), inset 0 1px 0 rgba(240, 249, 255, 0.36)",
      btnGrad: "linear-gradient(180deg, rgba(240, 249, 255, 0.34), rgba(125, 211, 252, 0.08) 48%, rgba(7, 19, 38, 0.22))",
      btnShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.52), inset 0 -2px 3px rgba(7, 19, 38, 0.26), 0 1px 3px rgba(0, 0, 0, 0.28)",
      btnActiveShadow: "inset 0 2px 5px rgba(7, 19, 38, 0.40)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(6, 20, 41, 0.65)",
      goShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.55), inset 0 -6px 12px rgba(10, 60, 115, 0.30), 0 6px 16px rgba(41, 182, 246, 0.42)"
    },
    sections: {
      model:    { accent: "#29b6f6", tint: "rgba(41, 182, 246, 0.16)",  border: "rgba(41, 182, 246, 0.38)" },
      images:   { accent: "#e8f6ff", tint: "rgba(232, 246, 255, 0.18)", border: "rgba(232, 246, 255, 0.42)" },
      prompt:   { accent: "#bae6fd", tint: "rgba(186, 230, 253, 0.16)", border: "rgba(186, 230, 253, 0.38)" },
      models:   { accent: "#38bdf8", tint: "rgba(56, 189, 248, 0.15)",  border: "rgba(56, 189, 248, 0.36)" },
      hires:    { accent: "#f0f9ff", tint: "rgba(240, 249, 255, 0.18)", border: "rgba(240, 249, 255, 0.40)" },
      tile:     { accent: "#7dd3fc", tint: "rgba(125, 211, 252, 0.15)", border: "rgba(125, 211, 252, 0.36)" },
      size:     { accent: "#0288d1", tint: "rgba(2, 136, 209, 0.16)",   border: "rgba(2, 136, 209, 0.38)" },
      audiogen: { accent: "#e0f7ff", tint: "rgba(224, 247, 255, 0.17)", border: "rgba(224, 247, 255, 0.40)" },
      sampling: { accent: "#7dd3fc", tint: "rgba(125, 211, 252, 0.15)", border: "rgba(125, 211, 252, 0.36)" },
      models2:  { accent: "#1d4ed8", tint: "rgba(29, 78, 216, 0.16)",   border: "rgba(29, 78, 216, 0.38)" },
      out:      { accent: "#e8f6ff", tint: "rgba(232, 246, 255, 0.18)", border: "rgba(232, 246, 255, 0.40)" },
      shapes:   { accent: "#29b6f6", tint: "rgba(41, 182, 246, 0.17)",  border: "rgba(41, 182, 246, 0.40)" },
      text:     { accent: "#f0f9ff", tint: "rgba(240, 249, 255, 0.18)", border: "rgba(240, 249, 255, 0.42)" },
      watermark:{ accent: "#bae6fd", tint: "rgba(186, 230, 253, 0.16)", border: "rgba(186, 230, 253, 0.38)" },
      bgremove: { accent: "#e0f7ff", tint: "rgba(224, 247, 255, 0.17)", border: "rgba(224, 247, 255, 0.40)" },
      inpaint:  { accent: "#38bdf8", tint: "rgba(56, 189, 248, 0.16)",  border: "rgba(56, 189, 248, 0.38)" },
      bg:       { accent: "#29b6f6", tint: "rgba(41, 182, 246, 0.17)",  border: "rgba(41, 182, 246, 0.40)" },
      effects:  { accent: "#e8f6ff", tint: "rgba(232, 246, 255, 0.18)", border: "rgba(232, 246, 255, 0.42)" },
      filter:   { accent: "#bae6fd", tint: "rgba(186, 230, 253, 0.16)", border: "rgba(186, 230, 253, 0.38)" },
      layers:   { accent: "#7dd3fc", tint: "rgba(125, 211, 252, 0.15)", border: "rgba(125, 211, 252, 0.36)" },
      audio:    { accent: "#e0f7ff", tint: "rgba(224, 247, 255, 0.17)", border: "rgba(224, 247, 255, 0.40)" },
      timeline: { accent: "#29b6f6", tint: "rgba(41, 182, 246, 0.17)",  border: "rgba(41, 182, 246, 0.40)" }
    }
  },
  {
    id: "ocean",
    name: "海",
    light: false,
    bg: "#051426",
    fg: "#ffffff",
    accent: "#14a8e8",
    accent2: "#ffd6c2",
    grad: ["#1888c8", "#061324"],
    hueMap: [[0, "#ffd6c2"], [210, "#1d5fa8"], [185, "#38bdf8"]],
    vars: {
      "--bg": "#051426",
      "--panel": "#0b2645",
      "--card": "#10355e",
      "--card2": "#16487d",
      "--text": "#ffffff",
      "--muted": "#c9ebff",
      "--border": "rgba(255, 255, 255, 0.20)",
      "--accent": "#14a8e8",
      "--accent2": "#ffd6c2",
      "--accent-fg": "#ffffff",
      "--danger": "#ffd6c2",
      "--warn": "#ffd6c2",
      "--ok": "#38bdf8"
    },
    deco: {
      cardShadow: "0 2px 10px rgba(4, 14, 28, 0.25), inset 0 1px 0 rgba(224, 247, 255, 0.24)",
      secCardShadow: "0 2px 10px rgba(4, 14, 28, 0.25), inset 0 1px 0 rgba(224, 247, 255, 0.26)",
      btnGrad: "linear-gradient(180deg, rgba(224, 247, 255, 0.28), rgba(20, 168, 232, 0.08) 48%, rgba(6, 19, 36, 0.20))",
      btnShadow: "inset 0 1px 0 rgba(224, 247, 255, 0.45), inset 0 -2px 3px rgba(6, 19, 36, 0.25), 0 1px 3px rgba(0, 0, 0, 0.25)",
      btnActiveShadow: "inset 0 2px 4px rgba(6, 19, 36, 0.36)",
      goBorder: "#ffffff",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(6, 19, 36, 0.60)",
      goShadow: "inset 0 2px 0 rgba(255, 255, 255, 0.45), inset 0 -6px 12px rgba(8, 70, 120, 0.30), 0 6px 16px rgba(20, 168, 232, 0.40)"
    },
    sections: {
      model:    { accent: "#14a8e8", tint: "rgba(20, 168, 232, 0.15)",  border: "rgba(20, 168, 232, 0.36)" },
      images:   { accent: "#38bdf8", tint: "rgba(56, 189, 248, 0.14)",  border: "rgba(56, 189, 248, 0.34)" },
      prompt:   { accent: "#ffd6c2", tint: "rgba(255, 214, 194, 0.14)", border: "rgba(255, 214, 194, 0.34)" },
      models:   { accent: "#1d5fa8", tint: "rgba(29, 95, 168, 0.16)",   border: "rgba(29, 95, 168, 0.36)" },
      hires:    { accent: "#7dd3fc", tint: "rgba(125, 211, 252, 0.14)", border: "rgba(125, 211, 252, 0.34)" },
      tile:     { accent: "#0284c7", tint: "rgba(2, 132, 199, 0.15)",   border: "rgba(2, 132, 199, 0.34)" },
      size:     { accent: "#38bdf8", tint: "rgba(56, 189, 248, 0.14)",  border: "rgba(56, 189, 248, 0.34)" },
      audiogen: { accent: "#ffd6c2", tint: "rgba(255, 214, 194, 0.13)", border: "rgba(255, 214, 194, 0.32)" },
      sampling: { accent: "#7dd3fc", tint: "rgba(125, 211, 252, 0.14)", border: "rgba(125, 211, 252, 0.34)" },
      models2:  { accent: "#1d5fa8", tint: "rgba(29, 95, 168, 0.16)",   border: "rgba(29, 95, 168, 0.36)" },
      out:      { accent: "#14a8e8", tint: "rgba(20, 168, 232, 0.15)",  border: "rgba(20, 168, 232, 0.36)" },
      shapes:   { accent: "#14a8e8", tint: "rgba(20, 168, 232, 0.16)",  border: "rgba(20, 168, 232, 0.38)" },
      text:     { accent: "#ffd6c2", tint: "rgba(255, 214, 194, 0.15)", border: "rgba(255, 214, 194, 0.36)" },
      watermark:{ accent: "#38bdf8", tint: "rgba(56, 189, 248, 0.15)",  border: "rgba(56, 189, 248, 0.36)" },
      bgremove: { accent: "#7dd3fc", tint: "rgba(125, 211, 252, 0.14)", border: "rgba(125, 211, 252, 0.34)" },
      inpaint:  { accent: "#1d5fa8", tint: "rgba(29, 95, 168, 0.16)",   border: "rgba(29, 95, 168, 0.36)" },
      bg:       { accent: "#14a8e8", tint: "rgba(20, 168, 232, 0.16)",  border: "rgba(20, 168, 232, 0.38)" },
      effects:  { accent: "#38bdf8", tint: "rgba(56, 189, 248, 0.15)",  border: "rgba(56, 189, 248, 0.36)" },
      filter:   { accent: "#ffd6c2", tint: "rgba(255, 214, 194, 0.15)", border: "rgba(255, 214, 194, 0.36)" },
      layers:   { accent: "#7dd3fc", tint: "rgba(125, 211, 252, 0.14)", border: "rgba(125, 211, 252, 0.34)" },
      audio:    { accent: "#1d5fa8", tint: "rgba(29, 95, 168, 0.16)",   border: "rgba(29, 95, 168, 0.36)" },
      timeline: { accent: "#14a8e8", tint: "rgba(20, 168, 232, 0.16)",  border: "rgba(20, 168, 232, 0.38)" }
    }
  },
  {
    id: "flame",
    name: "炎",
    light: false,
    bg: "#17100c",
    fg: "#ffffff",
    accent: "#f97316",
    accent2: "#facc15",
    grad: ["#361d12", "#140e0b"],
    hueMap: [[10, "#ef4444"], [45, "#facc15"]],
    vars: {
      "--bg": "#17100c",
      "--panel": "#261811",
      "--card": "#332017",
      "--card2": "#42291d",
      "--text": "#ffffff",
      "--muted": "#ebd0b7",
      "--border": "rgba(255, 255, 255, 0.20)",
      "--accent": "#f97316",
      "--accent2": "#facc15",
      "--accent-fg": "#1c0d05",
      "--danger": "#ef4444",
      "--warn": "#facc15",
      "--ok": "#fb923c"
    },
    deco: {
      cardShadow: "0 2px 12px rgba(10, 5, 2, 0.35), inset 0 1px 0 rgba(255, 235, 195, 0.20)",
      secCardShadow: "0 2px 12px rgba(10, 5, 2, 0.35), inset 0 1px 0 rgba(255, 235, 195, 0.22)",
      btnGrad: "linear-gradient(180deg, rgba(255, 235, 195, 0.24), rgba(249, 115, 22, 0.08) 48%, rgba(20, 14, 11, 0.24))",
      btnShadow: "inset 0 1px 0 rgba(255, 246, 229, 0.42), inset 0 -2px 3px rgba(20, 14, 11, 0.28), 0 1px 3px rgba(0, 0, 0, 0.28)",
      btnActiveShadow: "inset 0 2px 4px rgba(20, 14, 11, 0.40)",
      goBorder: "#fff6e5",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(28, 13, 5, 0.70)",
      goShadow: "inset 0 2px 0 rgba(255, 246, 229, 0.48), inset 0 -6px 12px rgba(150, 35, 10, 0.32), 0 6px 16px rgba(249, 115, 22, 0.42)"
    },
    sections: {
      model:    { accent: "#f97316", tint: "rgba(249, 115, 22, 0.15)",  border: "rgba(249, 115, 22, 0.36)" },
      images:   { accent: "#facc15", tint: "rgba(250, 204, 21, 0.14)",  border: "rgba(250, 204, 21, 0.35)" },
      prompt:   { accent: "#ef4444", tint: "rgba(239, 68, 68, 0.15)",   border: "rgba(239, 68, 68, 0.36)" },
      models:   { accent: "#fb923c", tint: "rgba(251, 146, 60, 0.14)",  border: "rgba(251, 146, 60, 0.34)" },
      hires:    { accent: "#fde047", tint: "rgba(253, 224, 71, 0.13)",  border: "rgba(253, 224, 71, 0.33)" },
      tile:     { accent: "#dc2626", tint: "rgba(220, 38, 38, 0.15)",   border: "rgba(220, 38, 38, 0.35)" },
      size:     { accent: "#f59e0b", tint: "rgba(245, 158, 11, 0.14)",  border: "rgba(245, 158, 11, 0.34)" },
      audiogen: { accent: "#ef4444", tint: "rgba(239, 68, 68, 0.15)",   border: "rgba(239, 68, 68, 0.35)" },
      sampling: { accent: "#fef08a", tint: "rgba(254, 240, 138, 0.13)", border: "rgba(254, 240, 138, 0.32)" },
      models2:  { accent: "#c2410c", tint: "rgba(194, 65, 12, 0.15)",   border: "rgba(194, 65, 12, 0.35)" },
      out:      { accent: "#fbbf24", tint: "rgba(251, 191, 36, 0.14)",  border: "rgba(251, 191, 36, 0.34)" },
      shapes:   { accent: "#f97316", tint: "rgba(249, 115, 22, 0.16)",  border: "rgba(249, 115, 22, 0.38)" },
      text:     { accent: "#facc15", tint: "rgba(250, 204, 21, 0.15)",  border: "rgba(250, 204, 21, 0.36)" },
      watermark:{ accent: "#ef4444", tint: "rgba(239, 68, 68, 0.15)",   border: "rgba(239, 68, 68, 0.36)" },
      bgremove: { accent: "#fb923c", tint: "rgba(251, 146, 60, 0.15)",  border: "rgba(251, 146, 60, 0.36)" },
      inpaint:  { accent: "#f59e0b", tint: "rgba(245, 158, 11, 0.15)",  border: "rgba(245, 158, 11, 0.36)" },
      bg:       { accent: "#f97316", tint: "rgba(249, 115, 22, 0.16)",  border: "rgba(249, 115, 22, 0.38)" },
      effects:  { accent: "#facc15", tint: "rgba(250, 204, 21, 0.15)",  border: "rgba(250, 204, 21, 0.36)" },
      filter:   { accent: "#ef4444", tint: "rgba(239, 68, 68, 0.15)",   border: "rgba(239, 68, 68, 0.36)" },
      layers:   { accent: "#fb923c", tint: "rgba(251, 146, 60, 0.14)",  border: "rgba(251, 146, 60, 0.34)" },
      audio:    { accent: "#f59e0b", tint: "rgba(245, 158, 11, 0.15)",  border: "rgba(245, 158, 11, 0.36)" },
      timeline: { accent: "#f97316", tint: "rgba(249, 115, 22, 0.16)",  border: "rgba(249, 115, 22, 0.38)" }
    }
  },
  {
    id: "dandy",
    name: "ダンディ",
    light: false,
    bg: "#0e171c",
    fg: "#ffffff",
    accent: "#c89d4c",
    accent2: "#34b38a",
    grad: ["#1f3640", "#0c1317"],
    hueMap: [[0, "#c89d4c"], [42, "#c89d4c"], [160, "#34b38a"]],
    vars: {
      "--bg": "#0e171c",
      "--panel": "#17262e",
      "--card": "#1f323b",
      "--card2": "#283f4a",
      "--text": "#ffffff",
      "--muted": "#cddae0",
      "--border": "rgba(255, 255, 255, 0.20)",
      "--accent": "#c89d4c",
      "--accent2": "#34b38a",
      "--accent-fg": "#111c21",
      "--danger": "#c89d4c",
      "--warn": "#dfb96a",
      "--ok": "#34b38a"
    },
    deco: {
      cardShadow: "0 2px 12px rgba(5, 10, 13, 0.32), inset 0 1px 0 rgba(244, 246, 247, 0.22)",
      secCardShadow: "0 2px 12px rgba(5, 10, 13, 0.32), inset 0 1px 0 rgba(244, 246, 247, 0.24)",
      btnGrad: "linear-gradient(180deg, rgba(244, 246, 247, 0.24), rgba(200, 157, 76, 0.07) 48%, rgba(12, 19, 23, 0.22))",
      btnShadow: "inset 0 1px 0 rgba(244, 246, 247, 0.42), inset 0 -2px 3px rgba(12, 19, 23, 0.26), 0 1px 3px rgba(0, 0, 0, 0.26)",
      btnActiveShadow: "inset 0 2px 4px rgba(12, 19, 23, 0.38)",
      goBorder: "#f4f6f7",
      goColor: "#ffffff",
      goTextShadow: "0 1px 2px rgba(12, 19, 23, 0.70)",
      goShadow: "inset 0 2px 0 rgba(244, 246, 247, 0.45), inset 0 -6px 12px rgba(85, 62, 20, 0.32), 0 6px 16px rgba(200, 157, 76, 0.38)"
    },
    sections: {
      model:    { accent: "#c89d4c", tint: "rgba(200, 157, 76, 0.15)",  border: "rgba(200, 157, 76, 0.36)" },
      images:   { accent: "#e2e8ec", tint: "rgba(226, 232, 236, 0.15)", border: "rgba(226, 232, 236, 0.35)" },
      prompt:   { accent: "#dfb96a", tint: "rgba(223, 185, 106, 0.14)", border: "rgba(223, 185, 106, 0.34)" },
      models:   { accent: "#4b8b9c", tint: "rgba(75, 139, 156, 0.15)",  border: "rgba(75, 139, 156, 0.35)" },
      hires:    { accent: "#34b38a", tint: "rgba(52, 179, 138, 0.14)",  border: "rgba(52, 179, 138, 0.34)" },
      tile:     { accent: "#b08940", tint: "rgba(176, 137, 64, 0.14)",  border: "rgba(176, 137, 64, 0.34)" },
      size:     { accent: "#649eab", tint: "rgba(100, 158, 171, 0.14)", border: "rgba(100, 158, 171, 0.34)" },
      audiogen: { accent: "#dfb96a", tint: "rgba(223, 185, 106, 0.14)", border: "rgba(223, 185, 106, 0.34)" },
      sampling: { accent: "#c89d4c", tint: "rgba(200, 157, 76, 0.14)",  border: "rgba(200, 157, 76, 0.34)" },
      models2:  { accent: "#94a3b8", tint: "rgba(148, 163, 184, 0.14)", border: "rgba(148, 163, 184, 0.34)" },
      out:      { accent: "#e2e8ec", tint: "rgba(226, 232, 236, 0.14)", border: "rgba(226, 232, 236, 0.34)" },
      shapes:   { accent: "#c89d4c", tint: "rgba(200, 157, 76, 0.16)",  border: "rgba(200, 157, 76, 0.38)" },
      text:     { accent: "#e2e8ec", tint: "rgba(226, 232, 236, 0.15)", border: "rgba(226, 232, 236, 0.36)" },
      watermark:{ accent: "#dfb96a", tint: "rgba(223, 185, 106, 0.15)", border: "rgba(223, 185, 106, 0.36)" },
      bgremove: { accent: "#34b38a", tint: "rgba(52, 179, 138, 0.15)",  border: "rgba(52, 179, 138, 0.36)" },
      inpaint:  { accent: "#4b8b9c", tint: "rgba(75, 139, 156, 0.15)",  border: "rgba(75, 139, 156, 0.36)" },
      bg:       { accent: "#c89d4c", tint: "rgba(200, 157, 76, 0.16)",  border: "rgba(200, 157, 76, 0.38)" },
      effects:  { accent: "#34b38a", tint: "rgba(52, 179, 138, 0.15)",  border: "rgba(52, 179, 138, 0.36)" },
      filter:   { accent: "#dfb96a", tint: "rgba(223, 185, 106, 0.15)", border: "rgba(223, 185, 106, 0.36)" },
      layers:   { accent: "#e2e8ec", tint: "rgba(226, 232, 236, 0.15)", border: "rgba(226, 232, 236, 0.35)" },
      audio:    { accent: "#4b8b9c", tint: "rgba(75, 139, 156, 0.15)",  border: "rgba(75, 139, 156, 0.35)" },
      timeline: { accent: "#c89d4c", tint: "rgba(200, 157, 76, 0.16)",  border: "rgba(200, 157, 76, 0.38)" }
    }
  },
  { id: "classic", name: "クラシック", light: false, classic: true },
];
const DEFAULT = "cca10";
let cur = null; // 今の配色(クラシックなら null = 置き換えない)
const cache = new Map();

// #rgb・#rgba・#rrggbb・#rrggbbaa → [r, g, b, 不透明度(0〜255)]
const hex = (h) => {
  let s = String(h).replace("#", "");
  if (s.length <= 4) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4, 6].map((i) => (i === 6 && s.length < 8 ? 255 : parseInt(s.slice(i, i + 2), 16)));
};
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PENCIL = [0, 28, 52, 120, 188, 222, 282]; // 色鉛筆の 7 色の色合い(赤・橙・黄・緑・水色・青・紫)
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
// もとの明るさ l(0〜1)→ 背景から文字までの間の色
function ramp(th, l) {
  const t = clamp((l - 0.05) / 0.88, 0, 1), e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  const a = hex(th.bg), b = hex(th.fg);
  return a.map((v, i) => Math.round(v + (b[i] - v) * e));
}
function mapRGB(th, r, g, b, a) {
  if (a < 1 && ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) return null; // 影など
  const [h, s, l] = rgb2hsl(r, g, b);
  const base = ramp(th, l);
  if (s < 0.2 || (s < 0.35 && (l < 0.2 || l > 0.85))) return base; // 色の少ない色
  const teal = Math.abs(h - 172) < 24, blue = h >= 196 && h <= 255, yellow = h >= 38 && h <= 58;
  let H = h, S = s;
  let A = base[3]; // 不透明度(色の元にした配色の色のもの)
  const hit = th.hueMap?.find(([c]) => hueDist(c, h) < 28);
  const hitMode = hit?.[2]; // "dark" = 中くらいの明るさの色を濃くする / "pale" = 白っぽくする
  if (teal || blue || yellow) { const src = hex((teal || blue) ? th.accent : th.accent2), [ah, as] = rgb2hsl(...src); H = ah; S = Math.max(0.25, Math.min(as, s)); A = src[3]; }
  else if (hit) { const src = hex(hit[1]), [ah, as] = rgb2hsl(...src); H = ah; S = Math.max(0.35, Math.min(as, s)); A = src[3]; } // 色合いを差し色に
  else if (th.rainbow) { H = PENCIL.reduce((p, q) => (hueDist(q, h) < hueDist(p, h) ? q : p)); S = Math.max(S, 0.75); } // いちばん近い色鉛筆の色に
  const bl = rgb2hsl(...base)[2];
  // 背景に近い暗い色・文字に近い明るい色は、置き換えた明るさにして色合いだけ残す
  if (l < 0.26 || l > 0.84) return [...hsl2rgb(H, Math.min(S, hitMode ? 0.22 : 0.5), bl), A];
  if (teal || blue) { const [, , al] = rgb2hsl(...hex(th.accent)); return [...hsl2rgb(H, S, clamp(al + (l - 0.4) * 0.8, 0.2, 0.8)), A]; }
  // 中くらいの明るさの色(文字や印): 明るい配色では暗めにして読めるようにする
  if (hit && hitMode === "dark") return [...hsl2rgb(H, S, 0.24), A];
  if (hit && hitMode === "pale") return [...hsl2rgb(H, S, 0.68), A];
  return [...hsl2rgb(H, S, th.light ? clamp(1.05 - l, 0.3, 0.55) : l), A];
}
const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
// 置き換えた色 v([r, g, b, 不透明度 0〜255])と、もとの色の不透明度 a(0〜1)→ CSS の色
const fmt = (v, a) => { const A = ((v[3] ?? 255) / 255) * a; return A >= 0.999 ? toHex(v) : `rgba(${v[0]},${v[1]},${v[2]},${Math.round(A * 1000) / 1000})`; };
function mapToken(tok, th) {
  const k = `${th.id}|${tok}`;
  if (cache.has(k)) return cache.get(k);
  let r, g, b, a = 1, out = tok;
  const m = /^#([0-9a-f]{3,8})$/i.exec(tok);
  if (m) {
    let s = m[1];
    if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join("");
    [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
    if (s.length === 8) a = parseInt(s.slice(6, 8), 16) / 255;
    const v = mapRGB(th, r, g, b, a);
    if (v) out = fmt(v, a);
  } else {
    const p = tok.slice(tok.indexOf("(") + 1, -1).split(/[\s,/]+/).filter(Boolean).map(Number);
    [r, g, b] = p; a = p.length > 3 ? p[3] : 1;
    if ([r, g, b].every(Number.isFinite)) {
      const v = mapRGB(th, r, g, b, a);
      if (v) out = fmt(v, a);
    }
  }
  cache.set(k, out);
  return out;
}
// 宣言の中の色だけ(#cca-ui のような id は、後ろが - なので色にしない)
const COLOR = /(^|[:,\s(])(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))(?![0-9a-zA-Z_-])/g;
export function mapCss(text, th = cur) {
  if (!th || !text) return text;
  return text.replace(COLOR, (all, pre, tok) => pre + mapToken(tok, th));
}

// ---- 置き換える所
const ROOT = '#cca-ui, #cca-vedit, #cca-imged, [id^="cca-"], [class^="cca-"], [class*=" cca-"]';
const SKIP = '.stage, [data-c="stage"], [data-no-theme]'; // 画像・動画の中身は置き換えない
const styleOrig = new WeakMap(), attrRec = new WeakMap();
function doStyle(st) {
  if (st.id === "cca-theme-deco") return; // 飾り(配色ごとに作る)は置き換えない
  if (!styleOrig.has(st)) { if (!/#cca-|\.cca-/.test(st.textContent)) return; styleOrig.set(st, st.textContent); }
  const want = mapCss(styleOrig.get(st));
  if (st.textContent !== want) { st.__ccaSet = want; st.textContent = want; }
}
function doAttr(el) {
  const v = el.getAttribute("style");
  if (v == null) return;
  let rec = attrRec.get(el);
  if (rec && v === rec.mapped) { if (rec.th === cur) return; } else rec = { orig: v };
  if (!rec.orig || !/#|rgb/.test(rec.orig) || !el.closest(ROOT) || el.closest(SKIP)) { attrRec.delete(el); return; }
  rec.mapped = mapCss(rec.orig); rec.th = cur;
  attrRec.set(el, rec);
  if (v !== rec.mapped) el.setAttribute("style", rec.mapped);
}
function doTree(n) {
  if (n.nodeType !== 1) return;
  if (n.tagName === "STYLE") { doStyle(n); return; }
  if (n.hasAttribute("style")) doAttr(n);
  for (const e of n.querySelectorAll("[style]")) doAttr(e);
  for (const s of n.querySelectorAll("style")) doStyle(s);
}
function all() {
  for (const s of document.querySelectorAll("style")) doStyle(s);
  for (const r of document.querySelectorAll(ROOT)) for (const e of [r, ...r.querySelectorAll("[style]")]) doAttr(e);
}
// th.onFg: 地が濃い色なのに文字も暗いボタン(「開く」など)に印を付け、onFg の文字色にする。クラス名ではなく実際の色で見分ける。
// 「選んでいるボタン(.on)」は、オンとオフで地が変わるので印は付けず、CSS(decoCss)で指定する
const ONFG_ATTR = "data-cca-onfg";
function rgbaOf(css) {
  const m = /^(rgba?|color)\(([^)]*)\)/.exec(css || "");
  if (!m) return null;
  const n = m[2].replace("srgb", "").split(/[\s,/]+/).filter(Boolean).map(Number);
  if (n.length < 3 || n.slice(0, 3).some(Number.isNaN)) return null;
  const k = m[1] === "color" ? 255 : 1;
  return [n[0] * k, n[1] * k, n[2] * k, n.length > 3 && !Number.isNaN(n[3]) ? n[3] : 1];
}
function lumOf([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function markOnFg(root) {
  if (!cur?.onFg || !root || root.nodeType !== 1) return;
  for (const b of root.tagName === "BUTTON" ? [root] : root.querySelectorAll("button")) {
    if (b.classList.contains("on") || b.hasAttribute(ONFG_ATTR) || !b.closest(ROOT) || b.closest(SKIP)) continue;
    const cs = getComputedStyle(b), bg = rgbaOf(cs.backgroundColor), fg = rgbaOf(cs.color);
    if (bg && fg && bg[3] >= 0.5 && lumOf(bg) < 0.18 && lumOf(fg) < 0.35) b.setAttribute(ONFG_ATTR, "");
  }
}
function refreshOnFg() {
  for (const b of document.querySelectorAll(`[${ONFG_ATTR}]`)) b.removeAttribute(ONFG_ATTR);
  markOnFg(document.documentElement);
}
// テーマの select 項目 → CSS 変数。一覧(メニュー)は body 直下に作るので、開くたびに MENU_VARS の変数を一覧へ写す
const SELECT_VARS = {
  bg: "--sel-bg", fg: "--sel-fg", border: "--sel-border", arrow: "--sel-arrow",
  menuBg: "--sel-menu-bg", menuFg: "--sel-menu-fg", menuBorder: "--sel-menu-border",
  hoverBg: "--sel-hover-bg", hoverFg: "--sel-hover-fg",
  selectedBg: "--sel-selected-bg", selectedFg: "--sel-selected-fg",
  groupFg: "--sel-group-fg"
};
const MENU_VARS = ["--text", "--muted", "--border", "--card", "--card2", "--accent", "--accent-fg", ...Object.values(SELECT_VARS)];
const customSelects = new WeakMap();

function initCustomSelects() {
  const roots = "#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask";

  let style = document.getElementById("cca-custom-select-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "cca-custom-select-style";
    style.textContent = `
      .cca-select-wrap {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
        min-width: 0;
      }
      .cca-select-native {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        overflow: hidden !important;
      }
      .cca-select-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        min-width: 0;
        cursor: pointer;
        text-align: left;
        color: var(--text, inherit);
      }
      .cca-select-button:disabled {
        cursor: not-allowed;
        opacity: .55;
      }
      .cca-select-label {
        display: inline-grid;
        min-width: 0;
        white-space: nowrap;
      }
      .cca-select-label span {
        grid-area: 1 / 1;
        min-width: 0;
      }
      .cca-select-label-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cca-select-label-sizer {
        visibility: hidden;
        height: 0;
        overflow: hidden;
      }
      .cca-select-arrow {
        flex: none;
      }
      .cca-select-menu {
        position: fixed;
        z-index: 2147483000;
        overflow-y: auto;
        max-height: 320px;
        padding: 4px;
        border: 1px solid var(--sel-menu-border, var(--border, #888));
        border-radius: 6px;
        background: var(--sel-menu-bg, var(--card, Canvas));
        color: var(--sel-menu-fg, var(--text, CanvasText));
        box-shadow: 0 5px 18px rgba(0,0,0,.28);
      }
      .cca-select-option {
        display: block;
        width: 100%;
        padding: 6px 9px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        text-align: left;
        white-space: normal;
        cursor: pointer;
      }
      .cca-select-option:hover,
      .cca-select-option:focus {
        background: var(--sel-hover-bg, var(--card2, color-mix(in srgb, currentColor 18%, transparent))) !important;
        color: var(--sel-hover-fg, var(--text, inherit)) !important;
      }

      .cca-select-option[aria-selected="true"] {
        background: var(--sel-selected-bg, var(--accent, Highlight)) !important;
        color: var(--sel-selected-fg, var(--accent-fg, HighlightText)) !important;
      }
      .cca-select-option:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      .cca-select-group {
        padding: 7px 9px 3px;
        color: var(--sel-group-fg, var(--muted, inherit));
        font-size: .85em;
        font-weight: bold;
      }
      .cca-select-arrow {
        color: var(--sel-arrow, inherit);
      }
    `;
    document.head.appendChild(style);
  }

  document.querySelectorAll(`:is(${roots}) select:not([multiple]):not([size])`).forEach(select => {
    if (customSelects.has(select)) return;

    const rect = select.getBoundingClientRect();
    const cs = getComputedStyle(select);

    const wrap = document.createElement("span");
    wrap.className = "cca-select-wrap";
    const fixedWidth = rect.width > 0
      ? `${rect.width}px`
      : (cs.width && cs.width !== "auto" ? cs.width : "");
    wrap.style.width = fixedWidth;
    wrap.style.flex = cs.flex;
    // 幅が決まっているときはこれまで通り。決まっていない(非表示のうちに作られた)ときだけ中身の幅に合わせ、親からははみ出さない
    wrap.style.minWidth = fixedWidth ? cs.minWidth : "max-content";
    wrap.style.maxWidth = cs.maxWidth !== "none" ? cs.maxWidth : "100%"; // 作ったときの幅(px)のままだと、欄が狭くなったときに隣の部品に重なるので、親の幅までに収める

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cca-select-button";
    button.setAttribute("data-no-theme", "");
    button.disabled = select.disabled;

    for (const prop of [
      "font", "fontFamily", "fontSize", "fontWeight",
      "lineHeight", "color", "backgroundColor", "border",
      "borderRadius", "padding", "boxSizing", "minHeight",
      "letterSpacing"
    ]) {
      button.style[prop] = cs[prop];
    }

    button.style.width = "100%";
    button.style.height = rect.height > 0 ? `${rect.height}px` : "";

    const label = document.createElement("span");
    label.className = "cca-select-label";
    const labelText = document.createElement("span");
    labelText.className = "cca-select-label-text";
    const labelSizers = document.createElement("span");
    labelSizers.className = "cca-select-label-sizers";
    labelSizers.style.display = "contents";
    labelSizers.setAttribute("aria-hidden", "true");
    label.append(labelText, labelSizers);
    let sizerKey = null;
    const arrow = document.createElement("span");
    arrow.className = "cca-select-arrow";
    arrow.textContent = "▾";
    arrow.setAttribute("aria-hidden", "true");
    button.append(label, arrow);

    const menu = document.createElement("div");
    menu.className = "cca-select-menu";
    menu.setAttribute("data-no-theme", "");
    menu.setAttribute("role", "listbox");
    menu.hidden = true;

    function sync() {
      const text = select.selectedOptions[0]?.textContent ?? "";
      if (labelText.textContent !== text) labelText.textContent = text;
      button.disabled = select.disabled;

      const texts = Array.from(select.options, o => o.textContent);
      const key = texts.join("\n");
      if (key !== sizerKey) {
        sizerKey = key;
        labelSizers.replaceChildren(...texts.map(t => {
          const s = document.createElement("span");
          s.className = "cca-select-label-sizer";
          s.textContent = t;
          return s;
        }));
      }
    }

    function refresh() {
      const c = getComputedStyle(select);
      for (const prop of ["color", "backgroundColor", "border"]) button.style[prop] = c[prop];
    }

    function close() {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }

    function open() {
      sync();
      menu.replaceChildren();

      const addOption = (option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "cca-select-option";
        item.setAttribute("role", "option");
        item.setAttribute(
          "aria-selected",
          String(index === select.selectedIndex)
        );
        item.textContent = option.textContent;
        item.disabled = option.disabled;

        item.addEventListener("click", () => {
          select.selectedIndex = index;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          sync();
          close();
          button.focus();
        });

        menu.appendChild(item);
      };

      Array.from(select.children).forEach(child => {
        if (child.tagName === "OPTGROUP") {
          const heading = document.createElement("div");
          heading.className = "cca-select-group";
          heading.textContent = child.label;
          menu.appendChild(heading);

          Array.from(child.children).forEach(option => {
            addOption(option, Array.from(select.options).indexOf(option));
          });
        } else if (child.tagName === "OPTION") {
          addOption(child, Array.from(select.options).indexOf(child));
        }
      });

      const vs = getComputedStyle(wrap);
      for (const n of MENU_VARS) {
        const v = vs.getPropertyValue(n).trim();
        if (v) menu.style.setProperty(n, v);
        else menu.style.removeProperty(n);
      }

      const r = button.getBoundingClientRect();
      menu.style.minWidth = `${r.width}px`;
      menu.style.width = "max-content";
      menu.style.maxWidth = `${Math.max(r.width, window.innerWidth - r.left - 8)}px`;
      menu.style.left = `${r.left}px`;

      // 非表示のままでは高さが 0 になり 320 で計算してしまうので、見えない状態で表示して実際の高さを測る
      menu.style.visibility = "hidden";
      menu.hidden = false;
      const menuHeight = menu.offsetHeight;
      const below = window.innerHeight - r.bottom;
      menu.style.top = below >= menuHeight + 8
        ? `${r.bottom + 3}px`
        : `${Math.max(4, r.top - menuHeight - 3)}px`;
      menu.style.visibility = "";
      button.setAttribute("aria-expanded", "true");

      const selected = menu.querySelector('[aria-selected="true"]');
      selected?.scrollIntoView({ block: "nearest" });
    }

    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");

    button.addEventListener("click", () => {
      if (menu.hidden) open();
      else close();
    });

    button.addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "Enter") {
        event.preventDefault();
        open();
        menu.querySelector('[aria-selected="true"]')?.focus();
      }
    });

    menu.addEventListener("keydown", event => {
      const items = [...menu.querySelectorAll(".cca-select-option:not(:disabled)")];
      const current = items.indexOf(document.activeElement);

      if (event.key === "Escape") {
        close();
        button.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown"
          ? Math.min(current + 1, items.length - 1)
          : Math.max(current - 1, 0);
        items[next]?.focus();
      }
    });

    document.addEventListener("pointerdown", event => {
      if (!wrap.contains(event.target) && !menu.contains(event.target)) {
        close();
      }
    });

    select.addEventListener("change", sync);
    select.addEventListener("input", sync);
    // プログラムから値・選択肢・無効状態が変わったときも表示を合わせる(change が出ないため、表示が古いままになっていた)
    new MutationObserver(() => sync()).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected", "label"], characterData: true });
    for (const prop of ["value", "selectedIndex"]) {
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      if (d?.set) Object.defineProperty(select, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } });
    }

    select.before(wrap);
    wrap.append(button, select);
    document.body.appendChild(menu);
    select.classList.add("cca-select-native");

    customSelects.set(select, { wrap, button, menu, sync, refresh });
    sync();
  });
}
function refreshCustomSelects() {
  for (const s of document.querySelectorAll("select.cca-select-native")) customSelects.get(s)?.refresh();
}
let obs = null;
export function startTheme() {
  cur = themeOf(themeChoice());
  if (obs) return;
  obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") doAttr(m.target);
      else if (m.type === "characterData" || (m.type === "childList" && m.target.tagName === "STYLE")) {
        const st = m.type === "characterData" ? m.target.parentNode : m.target;
        if (st?.tagName === "STYLE" && st.textContent !== st.__ccaSet) { styleOrig.delete(st); doStyle(st); }
      } else for (const n of m.addedNodes) { doTree(n); markOnFg(n); }
    }
  initCustomSelects();
  });
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"], characterData: true });
  if (cur) all();
  initCustomSelects();
  applyDeco();
  refreshOnFg();
}
function themeOf(id) { const t = THEMES.find((x) => x.id === id) || THEMES.find((x) => x.id === DEFAULT); return t.classic ? null : t; }
export function themeChoice() { try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; } }
// 飾り: 背景のグラデーション・ボタンのハイライトと内側の影(半透明に見えるように)・生成ボタン(少し透かした強調の色・白い縁・黒のぼかしの影)・欄を少し透かす
const mixHex = (a, b, t) => toHex(hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)));
function decoCss(th) {
  if (!th) return "";
  const al = { panel: 1, card: 0.86, go: 0.78, ...(th.alpha || {}) };
  const deco = {
    cardShadow: "0 2px 10px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.32)",
    secCardShadow: "0 2px 10px rgba(0,0,0,.11), inset 0 1px 0 rgba(255,255,255,.35)",
    btnGrad: "linear-gradient(180deg, rgba(255,255,255,.32), rgba(255,255,255,.06) 48%, rgba(0,0,0,.08))",
    btnShadow: "inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 3px rgba(0,0,0,.16), 0 1px 3px rgba(0,0,0,.22)",
    btnActiveShadow: "inset 0 2px 4px rgba(0,0,0,.3)",
    goBorder: "#ffffff",
    goColor: "#ffffff",
    goTextShadow: "0 1px 2px rgba(0,0,0,.5)",
    goShadow: "inset 0 2px 0 rgba(255,255,255,.45), inset 0 -6px 12px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.45)",
    ...(th.deco || {})
  };
  const ga = (c) => fmt(hex(c), al.panel); // グラデーションの色(色の不透明度 × panel)
  const [g0, g1] = (th.grad || (th.light ? [th.bg, mixHex(th.bg, th.fg, 0.45) + hex(th.bg)[3].toString(16).padStart(2, "0")] : [mixHex(th.bg, th.accent, 0.22) + hex(th.bg)[3].toString(16).padStart(2, "0"), th.bg])).map(ga);
  const [ar, ag, ab, aa] = hex(th.accent), B = ":is(#cca-ui, #cca-vedit, #cca-imged, .cca-askclose) button:not(:disabled):not(.errx)";
  const varLines = [
    ...Object.entries(th.vars || {}).map(([k, v]) => `${k}:${v}`),
    ...Object.entries(SELECT_VARS).filter(([k]) => th.select?.[k] != null).map(([k, name]) => `${name}:${th.select[k]}`)
  ].join(";");
  const selBtn = [["bg", "background-color"], ["fg", "color"], ["border", "border-color"]]
    .filter(([k]) => th.select?.[k] != null)
    .map(([k, prop]) => `${prop}:var(${SELECT_VARS[k]}) !important`).join(";");
  const cardPct = Math.round(clamp(al.card, 0, 1) * 100);
  const ROOTS = ":is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask)";
  // 選んでいるボタン(.on)の文字色(スナップ以外)。.on.on は、項目ごとの色指定(.seg button.on)より優先させるため
  const snapOn = [["bg", "background-color"], ["fg", "color"], ["border", "border-color"]]
    .filter(([k]) => th.snapOn?.[k] != null)
    .map(([k, prop]) => `${prop}:${th.snapOn[k]} !important`).join(";");
  const onCss = [
    th.onFg != null ? `${ROOTS} button.on.on:not([data-c="snap"]){color:${th.onFg} !important}\nbutton[${ONFG_ATTR}]{color:${th.onFg} !important}` : "",
    snapOn ? `${ROOTS} button[data-c="snap"].on{${snapOn}}` : "",
    th.secDoneFg ? `${ROOTS} button.sec-edit.on.on.on.on{color:${th.secDoneFg} !important}` : ""
  ].filter(Boolean).join("\n");
  const secCss = Object.entries(th.sections || {}).map(([sec, cfg]) => {
    const sel = `:is(#cca-ui [data-sec="${sec}"], #cca-imged [data-sec="${sec}"], #cca-vedit [data-sec="${sec}"], #cca-setio [data-sec="${sec}"], #cca-mask [data-sec="${sec}"])`;
    const headRule = th.secTitleUseAccent ? `${sel} > .sec-head,${sel} > summary.sec-head{color:var(--sec-accent) !important;border-bottom:1px solid color-mix(in srgb,var(--sec-accent) 28%,transparent) !important;padding-bottom:6px}` : `${sel} > .sec-head,${sel} > summary.sec-head{border-bottom:1px solid color-mix(in srgb,var(--sec-accent) 24%,transparent) !important;padding-bottom:6px}`;
    return `${sel}{--sec-accent:${cfg.accent};--sec-tint:${cfg.tint};--sec-border:${cfg.border};background:linear-gradient(135deg,var(--sec-tint) 0%,color-mix(in srgb,var(--card) ${cardPct}%,transparent) 52%,color-mix(in srgb,var(--sec-accent) 8%,transparent) 100%) !important;border-color:var(--sec-border) !important;box-shadow:${deco.secCardShadow} !important}`
      + headRule
      + `${sel} .sec-grip{color:color-mix(in srgb,var(--sec-accent) 78%,var(--muted)) !important}`
      + `${sel} button.pri,${sel} .seg button.on{background-color:var(--sec-accent) !important;color:var(--accent-fg) !important;border-color:var(--sec-accent) !important}`;
  }).join("\n");
  const textCss = [
    `:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask){color:var(--text)}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask) :is(summary,.sec-head,h1,h2,h3,h4,b,strong){color:var(--text)}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask) :is(.note,.hint,.help,.sub,.muted,.desc,.tip,small,label){color:var(--muted) !important}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged) .note{background:transparent !important;border:none !important;box-shadow:none !important}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask) :is(input,textarea,select){color:var(--text) !important}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask) select option:hover{background:var(--hover, revert) !important;color:var(--text) !important}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask) select option:checked{background:var(--checked, revert) !important;color:var(--text) !important}`,
    `:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask) button.pri,:is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask) .seg button.on{background-color:var(--accent) !important;color:var(--accent-fg) !important;border-color:var(--accent) !important}`
  ].join("\n");
  return `${varLines ? `#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask{${varLines}}\n` : ""}#cca-ui, #cca-vedit > .win, #cca-imged > .win{background-image:linear-gradient(170deg, ${g0}, ${g1}) !important}
#cca-ui .card, #cca-vedit .card, #cca-imged .card{background-color:color-mix(in srgb, var(--card) ${cardPct}%, transparent);box-shadow:${deco.cardShadow}}
${B}{background-image:${deco.btnGrad} !important;box-shadow:${deco.btnShadow}}
${B}:hover{filter:brightness(1.06)}
${B}:active{box-shadow:${deco.btnActiveShadow}}
#cca-ui #cca-go:not(:disabled){background-color:rgba(${ar},${ag},${ab},${Math.round(clamp(al.go, 0, 1) * (aa / 255) * 1000) / 1000}) !important;border:2px solid ${deco.goBorder} !important;color:${deco.goColor} !important;text-shadow:${deco.goTextShadow};
  box-shadow:${deco.goShadow} !important}
${textCss}${secCss ? `\n${secCss}` : ""}${onCss ? `\n${onCss}` : ""}${tuneCss(th) ? `\n${tuneCss(th)}` : ""}${th.extraCss ? `\n${th.extraCss}` : ""}${selBtn ? `\n.cca-select-button{${selBtn}}` : ""}`;
}
// th.tune → CSS。書いた項目だけ出す(書かない項目・tune 自体が無い配色は何も出さない)
// 数字欄の上下ボタン: 地の色 + 白い ▲▼ の矢印(SVG)
function spinDecl({ bg, fg }) {
  const c = encodeURIComponent(fg);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='22' viewBox='0 0 12 22'><path d='M2.5 8 6 4.5 9.5 8M2.5 14 6 17.5 9.5 14' fill='none' stroke='${fg}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return `-webkit-appearance:none !important;appearance:none !important;opacity:1 !important;width:20px !important;height:26px !important;margin-left:4px;border-radius:4px;background:${bg} url("data:image/svg+xml,${encodeURIComponent(svg)}") center/12px 22px no-repeat !important;cursor:pointer`;
}
function tuneCss(th) {
  const t = th.tune;
  if (!t) return "";
  const R = ":is(#cca-ui,#cca-vedit,#cca-imged,#cca-setio,#cca-mask,#cca-hbox)";
  const sel = (arr) => arr.map((x) => `${R} ${x}`).join(", ");
  const decl = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}:${v} !important`).join(";");
  const op = t.solid ? 1 : null;
  const rules = [
    [sel([":is(.note,.hint,.help,.sub,.muted,.desc,.tip,small,label)"]), { opacity: op }],
    [sel([":is(.sec-head,summary,h4)"]), { opacity: op, "font-weight": t.headWeight }],
    [sel(["label.l", "label.l span", "label.fl", "summary span"]), { color: t.labelColor, opacity: op, "font-weight": t.labelWeight }],
    [sel(["div.note", "div.ibox", "div.hint", "div.help", "div.sub", "div.desc", "div.tip", "p"]), { color: t.descColor, opacity: op, "font-weight": t.descWeight }],
    [sel(["button.ib"]), { color: t.infoFg, "background-color": t.infoBg, "border-color": t.infoBorder }],
    ...Object.entries(t.groupFix || {}).flatMap(([g, v]) => [
      [sel([`.ly.grp[style*="--g:${g}"]`]), { "--g": v.hue }],
      [sel([`.ly.grp[style*="--g:${g}"] .gtag`]), { color: v.fg }]
    ]),
    ...(t.scroll ? [
      [`${R}, ${R} *`, { "scrollbar-color": `${t.scroll.thumb} ${t.scroll.track}` }], // 新しい Chrome・Firefox
      [`${R} ::-webkit-scrollbar, ${R}::-webkit-scrollbar`, { width: "12px", height: "12px", background: t.scroll.track }], // 古い Chrome
      [`${R} ::-webkit-scrollbar-track, ${R}::-webkit-scrollbar-track`, { background: t.scroll.track }],
      [`${R} ::-webkit-scrollbar-thumb, ${R}::-webkit-scrollbar-thumb`, { background: t.scroll.thumb, "border-radius": "8px", border: `2px solid ${t.scroll.track}` }],
      [`${R} ::-webkit-scrollbar-thumb:hover, ${R}::-webkit-scrollbar-thumb:hover`, { background: t.scroll.hover || t.scroll.thumb }],
      [`${R} ::-webkit-scrollbar-button, ${R}::-webkit-scrollbar-button`, { display: "none" }]
    ] : []),
    ...(t.layerSel ? [[sel([".ly.sel"]), { background: t.layerSel.bg, "border-color": t.layerSel.border, color: "#1a100a" }]] : []),
    ...(t.check ? [[sel(["input[type=checkbox]", "input[type=radio]"]), { "accent-color": t.check, "color-scheme": "light" }]] : []),
    ...(t.spin ? [[sel(["input[type=number]::-webkit-inner-spin-button"]), spinDecl(t.spin)]] : []),
    ...(t.boxGrad ? [[sel([".lcrop", "[class*=\"lcrop\"]"]), { "background-image": `linear-gradient(135deg, ${t.boxGrad.light} 0%, ${t.boxGrad.dark} 100%)`, "border": `1px solid ${t.boxGrad.border}`, "border-radius": "10px", "padding": "8px 10px", "margin": "6px 0", "box-shadow": "0 2px 6px rgba(42,29,20,0.14), inset 0 1px 0 rgba(255,255,255,0.8)" }]] : []),
    ['[id^="cca-"] button.on.on.on:not([data-c="snap"]), [class*="cca-"] button.on.on.on:not([data-c="snap"]), #cca-hbox button.on.on.on', { color: t.selFg }]
  ];
  return rules.map(([sl, o]) => [sl, typeof o === "string" ? o : decl(o)]).filter(([, d]) => d).map(([sl, d]) => `${sl}{${d}}`).join("\n");
}
function applyDeco() {
  let st = document.getElementById("cca-theme-deco");
  if (!st) { st = document.createElement("style"); st.id = "cca-theme-deco"; document.head.appendChild(st); }
  st.textContent = decoCss(cur);
}
export function setTheme(id) {
  try { localStorage.setItem(KEY, id); } catch { /* 保存できなくても今の画面には使う */ }
  cur = themeOf(id);
  all();
  applyDeco();
  refreshOnFg();
  refreshCustomSelects();
}