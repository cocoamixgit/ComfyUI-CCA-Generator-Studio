# 同梱しているもの・使っているもののライセンス

このパネル(cca_generator)全体は **GNU General Public License v3.0**(`LICENSE`)で配布します。
下の表の、他の人が書いたもの(MIT・Apache-2.0)は、元の著作権表示とライセンスの文を残したまま同梱しています
(MIT・Apache-2.0 はどちらも GPL-3.0 のプログラムに組み込んで配れます)。そのファイルは、元のライセンスの条件でも使えます。

## このフォルダに同梱しているもの(他の人が書いたもの)

| 同梱しているもの | 元 | ライセンス | ライセンスの文 |
|---|---|---|---|
| `rvc/`(RVC の変換の部分) | [RVC-Project/Retrieval-based-Voice-Conversion-WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) | MIT | `rvc/LICENSE` |
| `rvc/models.py`・`attentions.py`・`commons.py`・`modules.py`・`transforms.py` のもと | [jaywalnut310/vits](https://github.com/jaywalnut310/vits) | MIT | `rvc/LICENSE-VITS` |
| `rvc/models.py`・`modules.py` の音にする部分のもと | [jik876/hifi-gan](https://github.com/jik876/hifi-gan) | MIT | `rvc/LICENSE-HiFi-GAN` |
| `rvc/rmvpe.py` のネットワークの部分のもと | [Dream-High/RMVPE](https://github.com/Dream-High/RMVPE) | Apache-2.0 | `rvc/LICENSE-RMVPE` |

- `rvc/rmvpe.py` と `rvc/infer.py` は、元のファイルから推論に使う部分だけを取り出して変更しています(各ファイルの先頭に書いています)。
- ほかのファイル(パネル・画像編集・動画編集・書き出し・おすすめのプロンプト・使い方の文など)は、このパネルのために書いたものです。

## 同梱していないもの(使う人が入れる・自動でダウンロードする)

モデルのファイルは同梱していません。各モデルのライセンスは、パネルの「📋 モデルの選び方・ライセンス」に出ます。

| もの | 入れ方 | ライセンス |
|---|---|---|
| HuBERT(`hubert_base`)・RMVPE(`rmvpe.pt`) | RVC を初めて使うときに [lj1995/VoiceConversionWebUI](https://huggingface.co/lj1995/VoiceConversionWebUI) から自動でダウンロード | MIT |
| RVC の声のモデル(`.pth`・`.index`) | 使う人が用意 | モデルごと |
| 追加ノード(ComfyUI-QwenTTS・ComfyUI-LatentSyncWrapper・ComfyUI_FL-HeartMuLa・kandinsky6 など) | 使う人がインストール | 追加ノードごと(ComfyUI-QwenTTS は GPL-3.0 など) |
| ComfyUI 本体と、そこに入っているライブラリ(PyTorch・torchaudio・transformers・scipy・Pillow・PyAV など) | ComfyUI に入っているものを使う | 各ライブラリのライセンス(ComfyUI は GPL-3.0) |
| Google Fonts のフォント | 動画編集で使う人がダウンロード | フォントごと(多くは SIL Open Font License) |
| `.index` を使うときの faiss | 使う人が入れる(任意) | MIT |
