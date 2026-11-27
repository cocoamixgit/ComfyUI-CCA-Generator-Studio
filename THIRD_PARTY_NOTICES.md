# 同梱しているもの・使っているもののライセンス

このパネル(cca_generator)全体は **GNU General Public License v3.0**(`LICENSE`)で配布します。
下の表の、他の人が書いたもの(MIT・Apache-2.0・BSD-3-Clause・SIL Open Font License)は、元の著作権表示とライセンスの文を残したまま同梱しています
(どれも GPL-3.0 のプログラムと一緒に配れます)。そのファイルは、元のライセンスの条件でも使えます。

## このフォルダに同梱しているもの(他の人が書いたもの)

| 同梱しているもの | 元 | ライセンス | ライセンスの文 |
|---|---|---|---|
| `rvc/`(RVC の変換の部分) | [RVC-Project/Retrieval-based-Voice-Conversion-WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) | MIT | `rvc/LICENSE` |
| `rvc/models.py`・`attentions.py`・`commons.py`・`modules.py`・`transforms.py` のもと | [jaywalnut310/vits](https://github.com/jaywalnut310/vits) | MIT | `rvc/LICENSE-VITS` |
| `rvc/models.py`・`modules.py` の音にする部分のもと | [jik876/hifi-gan](https://github.com/jik876/hifi-gan) | MIT | `rvc/LICENSE-HiFi-GAN` |
| `rvc/rmvpe.py` のネットワークの部分のもと | [Dream-High/RMVPE](https://github.com/Dream-High/RMVPE) | Apache-2.0 | `rvc/LICENSE-RMVPE` |
| `cca/extra_models.py` の SenseNova-U1.6 の自己修正(`_sn_self_correct`)と、`cca/panel.py` の VRAM モード(`_sn_vram_kw`)のもと。配布元の `examples/interleave/self_correction.py` の手順と、`local_pipeline.py` の `vram_mode`(full / fast / balanced / low)の仕様に合わせて、このパネル用に書き直しています | [OpenSenseNova/ComfyUI-SenseNova-U1](https://github.com/OpenSenseNova/ComfyUI-SenseNova-U1)・[OpenSenseNova/SenseNova-U1](https://github.com/OpenSenseNova/SenseNova-U1) | Apache-2.0 | `LICENSE-SenseNova-U1` |
| `web/lib/pdfjs/pdf.min.mjs`・`pdf.worker.min.mjs`(PDF を画像にして取り込む。pdfjs-dist 4.10.38) | [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | `web/lib/pdfjs/LICENSE` |
| `web/lib/pdfjs/cmaps/`(PDF の文字の対応表) | [mozilla/pdf.js](https://github.com/mozilla/pdf.js)(Adobe の CMap) | BSD-3-Clause | `web/lib/pdfjs/cmaps/LICENSE` |
| `web/lib/pdfjs/standard_fonts/`(PDF に入っていない標準フォントの代わり) | [mozilla/pdf.js](https://github.com/mozilla/pdf.js)(Foxit・Liberation) | BSD-3-Clause・SIL Open Font License 1.1 | `web/lib/pdfjs/standard_fonts/LICENSE_FOXIT`・`LICENSE_LIBERATION` |
| `web/lib/three/`(生成した 3D モデルを表示する。three.js 0.170.0 の three.module.min.js・GLTFLoader・OrbitControls・BufferGeometryUtils / Shows generated 3D models) | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT | `web/lib/three/LICENSE` |

- `rvc/rmvpe.py` と `rvc/infer.py` は、元のファイルから推論に使う部分だけを取り出して変更しています(各ファイルの先頭に書いています)。
- SenseNova-U1.6 の追加ノード本体(ComfyUI-SenseNova-U1)と sensenova-u1 パッケージは同梱していません。上の行は、その仕様に合わせて書いた部分(Apache-2.0 §4 に従い、ライセンスの文を `LICENSE-SenseNova-U1` に同梱し、変更したことを該当ファイルの先頭に書いています)です。
- ほかのファイル(パネル・画像編集・動画編集・書き出し・おすすめのプロンプト・使い方の文など)は、このパネルのために書いたものです。

## 同梱していないもの(使う人が入れる・自動でダウンロードする)

モデルのファイルは同梱していません。各モデルのライセンスは、パネルの「📋 モデルの選び方・ライセンス」に出ます。

| もの | 入れ方 | ライセンス |
|---|---|---|
| HuBERT(`hubert_base`)・RMVPE(`rmvpe.pt`) | RVC を初めて使うときに [lj1995/VoiceConversionWebUI](https://huggingface.co/lj1995/VoiceConversionWebUI) から自動でダウンロード | MIT |
| RVC の声のモデル(`.pth`・`.index`) | 使う人が用意 | モデルごと |
| 追加ノード(ComfyUI-QwenTTS・ComfyUI-LatentSyncWrapper・ComfyUI_FL-HeartMuLa・kandinsky6・ComfyUI-SenseNova-U1 など) | 使う人がインストール | 追加ノードごと(ComfyUI-QwenTTS は GPL-3.0、ComfyUI-SenseNova-U1 は Apache-2.0 など) |
| ComfyUI 本体と、そこに入っているライブラリ(PyTorch・torchaudio・transformers・scipy・Pillow・PyAV など) | ComfyUI に入っているものを使う | 各ライブラリのライセンス(ComfyUI は GPL-3.0) |
| Google Fonts のフォント | 動画編集で使う人がダウンロード | フォントごと(多くは SIL Open Font License) |
| `.index` を使うときの faiss | 使う人が入れる(任意) | MIT |
