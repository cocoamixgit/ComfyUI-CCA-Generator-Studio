// ============================================================================
// CCA Generator テーマのテンプレート(AI に渡す用)
// ============================================================================
//
// ■ 使う人へ
//   1. このファイルを AI(ChatGPT・Claude・Gemini など)に渡して、次のように頼みます。
//        「このテンプレートと同じ形で、〇〇な感じの CCA Generator のテーマを作って」
//        例: 「夜の海のような、紺と水色の落ち着いた暗いテーマ」「桜色の明るくやさしいテーマ」
//   2. できたファイルを、生成パネルの「設定」→「テーマ」→「テーマのファイルを取り込む」で取り込みます。
//      取り込むと「テーマカラー」で選べるようになります(保存先: web/themes/<id>.js)。
//   3. 取り込む前に色を確かめたいときは、「設定」→「テーマ」から theme_view.html をダウンロードしてブラウザで開き、
//      「テーマのファイルを開く」でそのファイルを開きます(生成パネル・画像編集・動画編集・各ダイアログを、その色で見られます)。
//   ※ AI がファイルを作れないときは、AI が表示したコードブロックの中身をすべてコピーし、メモ帳などに貼り付けて
//      <id>.js(または <id>.txt)という名前で保存してから取り込んでください。.js でも .txt でも取り込めます。
//
// ■ AI へのお願い(必ず守ってください)
//   [出力の形]
//   - 出力するのは、テーマ 1 つ分の「ファイル 1 つ」だけです。中身は、このファイルの一番下の例と同じ形にします:
//         export default {
//           id: "...",
//           ...
//         };
//     1 行目は export default { で始め、最後は }; で終えます。その前後に説明文・Markdown・別のコードを入れないでください。
//   - ファイルを作って渡せる場合: ファイル名を <id>.js にして、ダウンロードできる形で渡してください。
//   - ファイルを作れない場合: 中身の全文を 1 つのコードブロック(```javascript … ```)で表示してください。
//     省略(「…以下同じ」など)はせず、最初から最後まで全部を書いてください。そのあとで、使う人に
//     「中身をコピーしてメモ帳などに貼り付け、<id>.js か <id>.txt で保存し、CCA Generator の『設定』→『テーマ』→
//      『テーマのファイルを取り込む』で取り込んでください」と伝えてください。
//   [中身]
//   - id: 英小文字・数字・_・- だけ。ほかのテーマと重ならない名前にする(cca10・cca03・aqua・dream・spring・power・colorful・
//     purple・bluedia・ocean・flame・dandy・classic・my_theme は使わない)。_ で始めない
//   - name: 「テーマカラー」の一覧に出す名前(日本語でよい)。order: 一覧の並び順(500 以上の数)
//   - 色は #rrggbb・#rrggbbaa・rgba(r, g, b, a) で書く。地(bg・vars の --bg・--card)と文字(fg・vars の --text)は、
//     はっきり読める明るさの差をつける(明るい地なら light: true、暗い地なら light: false)
//   - 必ず書くのは id・name・light・bg・fg・accent・accent2 だけ。そのほか(vars・deco・select・sections・tune・look・extraCss など)は、
//     書かなければ bg・fg・accent・accent2 から自動で作る。全部書くと長くなるので、出力が途中で切れそうなときは、
//     省略できる項目を減らして、最後の }; まで必ず書き切る(途中で切れたファイルは取り込めない)
//   - 文字の色と、その文字が乗る地の色は、コントラスト比 4.5 以上にする。特に次の組み合わせ:
//       fg と bg・--card / onFg・tune.selFg・vars の --accent-fg と accent / select の fg と bg・menuFg と menuBg・
//       hoverFg と hoverBg・selectedFg と selectedBg / tune.infoFg と infoBg / tune.spin の fg と bg / snapOn の fg と bg /
//       tune.layerSel の fg と bg / look の notice・license・clip の color と back / look.selection の fg と bg
//     暗い地のテーマで、文字の色を濃い色にしない(逆も同じ)。読めない組み合わせは、取り込んだあと自動で読める色に直す
//   - 値だけを書く。関数・計算・import・外部の URL は書かない(extraCss は文字列の配列に .join("\n") を付けた形か、1 つの文字列)
//   - look のグラデーションは 9 か所(0%〜100% の等間隔)の色で書くのが基本。少なく書くと、間の色は自動で混ぜる
//   - sections には、例にある項目の名前(model・images・prompt …)をすべて書く
//
// ■ 短い例(必ず書く項目だけ。ほかは自動で作る。長い出力が苦手なときはこの形で)
//   export default {
//     id: "night_sea", order: 510, name: "夜の海",
//     light: false, bg: "#0b131e", fg: "#f2f8ff", accent: "#00b8e6", accent2: "#ffd166"
//   };
//
// 以下、全項目の説明と、全項目を書いた例です。
// ============================================================================

// ---- 配色の項目(テーマのファイル 1 つ分。web/themes/<id>.js に export default { … } で書く)。色は #rgb・#rgba・#rrggbb・#rrggbbaa(最後の 2 桁が不透明度 00〜ff)で書ける
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
//   link    リンク(「ライセンスの本文」など)の文字色。書かなければ accent から、地に対して読める色を作る
// 色の不透明度: bg・fg に付けると地・欄・線・文字が、accent・accent2・hueMap の色に付けると、その色から作る所が透ける。
// エラーの赤・成功の緑などは色合いを残し、明るさだけ配色に合わせる。半透明の黒・白(影など)はそのまま。
//   look    形と背景(書いた項目だけ置き換わる。書かない項目は今の見た目と同じ)
//             グラデーションは 9 か所(0%・12.5%・25%・…・100% の等間隔)の色で書く。色は #rrggbb・rgba(...)・color-mix(...)・var(--…) が使える
//             9 個より少なく書いたときは、0%〜100% に等間隔に並べて、間の色を混ぜて 9 か所にする
//             block   ブロック(項目の欄。sections に書いた項目):
//                       back: { gradation: [9 色], angle: 角度(度) }。既定は var(--sec-tint)(0%)→ 欄の地(52%)→ var(--sec-accent) 8%(100%)
//                       radius 角丸(px) / border 枠の太さ(px) / opacity 欄の地の不透明度(0〜1。alpha.card と同じ)
//             button  ボタン: back: { gradation: [9 色], angle }(ボタンのつや。既定は deco.btnGrad)/ radius 角丸(px)
//             go      生成ボタン: back: { gradation: [9 色], angle }(既定はボタンと同じ)/ radius 角丸(px)
//             panel   パネル・編集画面の地: back: { gradation: [9 色], angle }(既定は grad の 2 色・170 度)
//             modal   ダイアログの枠(画像の合成・ギャラリー・履歴・設定・使い方・PNGinfo・確認など): back / radius / border / borderColor
//             backdrop ダイアログの後ろの暗い部分の色(1 色)
//             editor  画像編集・動画編集の画面の地: back / radius / border / borderColor
//             inner   入れ子の枠(出力サイズの枠・入力画像の枠・LoRA の枠・結果の表示・説明の枠など): back / radius / border / borderColor
//             item    一覧の項目(ギャラリー・履歴・レイヤーの行・履歴の画像・サンプルワードなど): back / radius / border / borderColor
//             input   入力欄・プルダウン(生成パネル・編集画面・ダイアログ): back / radius / border / borderColor
//             borderColor(枠の色)は block・button・go にも書ける。color(文字の色)は notice・license・clip に書ける
//             notice  お知らせ: { error, info, warn } それぞれ back / radius / border / borderColor / color(エラー・お知らせ・注意の欄・帯)
//             license ライセンスの札: { ok 商用可, cond 条件付き, out 生成物のみ商用可, no 非商用のみ, unknown 不明 } それぞれ back / borderColor / color
//             clip    動画編集のタイムラインのクリップ: { clip 動画(つなげる), video 重ねる動画, image 画像, text 文字, shape 図形, mosaic モザイク, audio 音声, selected 選んでいる }
//                       それぞれ back / radius / border / borderColor / color
//             overlay 画像の上に重ねて出すもの(色。書いた色だけ置き換わる):
//                       frame 選んだ物の枠 / handleBg・handleBorder 取っ手 / crop 切り取りの枠 / dim 切り取りの外の暗い部分 / guide 吸い付きの目印
//                       artboard アートボードの枠 / remove オブジェクト除去の範囲 / brush・brush2 ブラシの円(外・内) / textedit 文字の編集枠 / caret 文字の入力位置
//                       path パスの線 / pathhandle パスの曲線の取っ手 / volume 音量の線
//             selection 文字を選んだときの色: { bg, fg }
//           例: look: { block: { back: { gradation: ["#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888", "#999"], angle: 135 }, radius: 12, opacity: 0.86 },
//                       button: { radius: 8 } }

// ---------------------------------------------------------------- 例(全項目を書いたもの)
export default {
  id: "my_theme", order: 500,            // ← 新しいテーマの id(英小文字・数字・_・-)と並び順                 // 保存に使う名前(変えない)
  name: "マイテーマ",            // プルダウンに出す名前
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
    layerSel: { bg: "linear-gradient(135deg, #eadcc8, #d3bc9d)", border: "#5c361b", fg: "#1c120b" }, // 選んでいるレイヤー行(.ly.sel): 地 / 枠 / 文字(書かなければ地に合わせて読める色)
    boxGrad: { light: "rgba(255,252,246,0.85)", dark: "rgba(214,196,170,0.55)", border: "rgba(74,51,31,0.28)" }, // 項目内の枠(.lcrop): 左上 / 右下 / 枠
    groupFix: { 67: { hue: 28, fg: "#5c361b" } } // レイヤーのグループ色(--g の色合い)を茶に: 67(黄)→ 色合い 28 + 数字の色
  },
  // その他の CSS(1 行 1 規則)
  extraCss: [
    '#cca-vedit button[data-c="stretch"].on.on.on{color:#5c361b !important;background-color:#e3d2bc !important;border-color:#5c361b !important}', // 動画編集: 伸縮(タイムストレッチ)ボタン(茶の文字・薄い茶の地)
    '#cca-vedit .tl .blk, #cca-vedit .tl .blk *:not(canvas){color:#ffffff !important}', // 動画編集: タイムラインのバーの中の文字を白
    '.cca-lic.ok{background-color:#4f6b3a !important;color:#ffffff !important}', // ライセンスのタグ「商用可」: 地の色と白い文字
    '.cca-lic.cond{background-color:#8a6a1c !important;color:#ffffff !important}', // ライセンスのタグ「条件付き」: 地の色と白い文字
    '.cca-lic.out{background-color:#7a5535 !important;color:#ffffff !important}', // ライセンスのタグ「生成物のみ商用可」: 地の色と白い文字
    '.cca-lic.no{background-color:#5c361b !important;color:#ffffff !important}', // ライセンスのタグ「非商用のみ」: 地の色と白い文字
    '.cca-lic.unknown{background-color:#5b5148 !important;color:#ffffff !important}' // ライセンスのタグ「不明」: 地の色と白い文字
  ].join("\n"),
  snapOn: { bg: "#aebd94", fg: "#2e3a1e", border: "#3b4a29" }, // スナップがオンの時: 地 / 文字 / 枠
  link: "#5c361b",             // リンクの文字色
  // 形と背景(look)。書いた項目だけ置き換わる。書かない項目は今の見た目と同じ
  look: {
    panel:  { back: { gradation: ["#f7f2e7", "#f2ebdd", "#ece2d0", "#e4d7c2", "#d9c9b1", "#c9b69c", "#b39d82", "#9a8167", "#7d6148"], angle: 170 } }, // パネルの地(9 か所)
    editor: { back: { gradation: ["#f5f1e6", "#f5f1e6"] } },                                     // 画像編集・動画編集の画面の地
    block:  { back: { gradation: ["rgba(92,54,27,0.22)", "#faf6ee", "rgba(92,54,27,0.08)"], angle: 135 }, radius: 12, border: 1.5, borderColor: "rgba(92,54,27,0.46)", opacity: 0.86 }, // ブロック
    inner:  { back: { gradation: ["#faf6ee", "#efe6d6"] }, radius: 8, border: 1, borderColor: "rgba(43,32,24,0.22)" }, // 入れ子の枠
    item:   { back: { gradation: ["#faf6ee"] }, radius: 6, borderColor: "rgba(43,32,24,0.22)" },  // 一覧の項目
    input:  { back: { gradation: ["#fffdf8", "#faf6ee"] }, radius: 6, borderColor: "rgba(43,32,24,0.30)" }, // 入力欄・プルダウン
    button: { back: { gradation: ["rgba(250,246,238,0.56)", "rgba(242,230,209,0.12)", "rgba(42,29,20,0.14)"], angle: 180 }, radius: 8, borderColor: "rgba(43,32,24,0.30)" }, // ボタンのつや
    go:     { back: { gradation: ["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "rgba(0,0,0,0.12)"] }, radius: 10 }, // 生成ボタン
    modal:  { back: { gradation: ["#faf6ee", "#f2e6d1"] }, radius: 14, border: 1, borderColor: "rgba(43,32,24,0.30)" }, // ダイアログの枠
    backdrop: "rgba(20,12,6,0.55)",                                                                // ダイアログの後ろの暗い部分
    notice: { error: { back: { gradation: ["#8c3b2a"] }, color: "#ffffff" }, info: { back: { gradation: ["#5c361b"] }, color: "#ffffff" }, warn: { back: { gradation: ["#bfa987"] }, color: "#1c120b" } },
    license: { ok: { back: { gradation: ["#4f6b3a"] }, color: "#ffffff" }, cond: { back: { gradation: ["#8a6a1c"] }, color: "#ffffff" }, out: { back: { gradation: ["#7a5535"] }, color: "#ffffff" },
      no: { back: { gradation: ["#5c361b"] }, color: "#ffffff" }, unknown: { back: { gradation: ["#5b5148"] }, color: "#ffffff" } },
    clip: { clip: { back: { gradation: ["#6b4a30"] }, color: "#ffffff" }, video: { back: { gradation: ["#4a6a8a"] }, color: "#ffffff" }, image: { back: { gradation: ["#6c7c54"] }, color: "#ffffff" },
      text: { back: { gradation: ["#8a6a1c"] }, color: "#ffffff" }, shape: { back: { gradation: ["#7a5535"] }, color: "#ffffff" }, mosaic: { back: { gradation: ["#5b5148"] }, color: "#ffffff" },
      audio: { back: { gradation: ["#3b4a29"] }, color: "#ffffff" }, selected: { borderColor: "#ffd24d" } },
    overlay: { frame: "#4f8bff", handleBg: "#ffffff", handleBorder: "#4f8bff", crop: "#ffd24d", dim: "rgba(0,0,0,0.45)", guide: "#ffb020",
      artboard: "#56606e", remove: "#ff5d5d", brush: "#ffffff", brush2: "#000000", textedit: "#ffb020", caret: "#ffb020", path: "#ffd24d", pathhandle: "#7bd3ff", volume: "#ffd24d" },
    selection: { bg: "#5c361b", fg: "#ffffff" }                                                    // 文字を選んだときの色
  },
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
};
