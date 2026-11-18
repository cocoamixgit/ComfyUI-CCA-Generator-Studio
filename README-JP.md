# CCA Generator

[English version here](README.md)

SD1.5、Krea 2、MOSS、LTX-2.5などを使った画像生成・動画作成を行うComfyUIインターフェースです。テキスト→動画、最初と最後のフレーム指定つきの画像→動画、オプションの音声生成を、ひとつのパネルから行えます。

![CCA Generator panel](assets/screenshot.png)

## 機能

- **マルチモデル対応** — SD1.5、Krea 2、MOSS、LTX-2.5など、複数のモデルでの画像生成・動画作成をひとつのインターフェースで。
- **テキスト→動画／画像→動画** — プロンプトから始めるか、静止画をアニメーション化するか選べます。
- **最初／最後のフレーム指定** — 開始フレームを設定し、任意で終了フレームも指定して動画を誘導できます。
- **音声生成** — 動画と一緒に音声も生成できます（オプション）。
- **モデルセットアップ補助** — モデルをまだ用意していなくても、パネルがダウンロードと配置場所を案内します。
- **プロンプトツール** — プロンプトプリセットの保存・再利用、入力画像からのプロンプト生成、ワンクリックでの単語追加。
- **画像合成** — 生成前に画像を切り抜いて重ねられます。
- **ギャラリープレビュー** — 生成結果を一覧表示し、拡大したり出力フォルダを開いたりできます。

## インストール

### 必要なもの

- ComfyUIがインストール済みであること。まだの場合は[こちらの手順書](https://note.com/cocoat/n/n8780c1ca3b1f#e9a103d0-79ce-43a5-b53d-f6ff8fb16a35)（StabilityMatrixでComfyUIを入れる方法）を参考にしてください。
- Gitがインストール済みであること。まだの場合は先にインストールしてください（下記参照）。

### Gitのインストール方法

- **Windows：** [Git for Windows](https://git-scm.com/downloads) をダウンロードしてインストーラーを実行します。設定はデフォルトのままで大丈夫です。
- **macOS：** `xcode-select --install` を実行するか、Homebrewを使っている場合は `brew install git` を実行します。
- **Linux：** `sudo apt install git`（Debian / Ubuntu系）を実行します。ほかのディストリビューションではそれぞれのパッケージマネージャーでインストールしてください。

インストールできたら、以下で確認します。

```bash
git --version
```

バージョン番号が表示されればOKです。

### 手順1：ComfyUI Manager V3.42をインストールする

ComfyUI Managerをまだ入れていない場合は、先にインストールしてください。

**ご自分のComfyUIのインストールフォルダ**にある `custom_nodes` フォルダでターミナルを開いてください。場所はComfyUIの導入方法によって違います。

- Windows Portable版：`ComfyUI_windows_portable/ComfyUI/custom_nodes`
- StabilityMatrix：`C:\StabilityMatrix\Data\Packages\ComfyUI\custom_nodes`
- 手動インストール：ComfyUIをcloneした場所の `custom_nodes`

その後、以下を実行します。

```bash
git clone https://github.com/Comfy-Org/ComfyUI-Manager.git comfyui-manager
```

次に、ComfyUIを動かしているのと同じPythonで依存ライブラリをインストールします。

**Windows Portable版**（`ComfyUI_windows_portable` フォルダで実行）：

```bash
.\python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\comfyui-manager\requirements.txt
```

**手動インストール／venv環境**（ご自分のComfyUIフォルダで実行）：

```bash
pip install -r custom_nodes/comfyui-manager/requirements.txt
```

ComfyUIを再起動すると、**Manager**ボタンが表示されます。

> フォルダは必ず `<ComfyUIのフォルダ>/custom_nodes/comfyui-manager` にしてください。`ComfyUI-Manager/ComfyUI-Manager` のような二重フォルダにならないよう注意してください。

### 手順2：CCA Generatorをインストールする

1. **Manager**をクリックして**Custom Nodes Manager**を開きます。
2. **CCA Generator**を検索して**Install**をクリックします。
3. ComfyUIを再起動します。

### 手動インストール（代替方法）

```bash
cd <ComfyUIのフォルダ>/custom_nodes
git clone https://github.com/cocoamixgit/ComfyUI-cca-generator-ui.git
```

`<ComfyUIのフォルダ>` はご自分のComfyUIのインストール先に読み替えてください。その後、ComfyUIを再起動してください。

## モデルについて

このノードにモデルは同梱されていません。モデルをまだ用意していない場合は、パネルのモデルセットアップ補助がダウンロードと配置場所を案内します。モデルの選び方やライセンス条件は、パネル内のモデルガイドをご覧ください。

## 使い方

1. **モデルを選ぶ** — モデルのドロップダウンから使うモデル（例：LTX-2.5）を選びます。モデルの保存場所はモデルフォルダ設定で指定できます。
2. **タスクを選ぶ** — テキスト→動画か、画像→動画かを選びます。
3. **プロンプトを入れる** — プリセットから選ぶか、直接入力します。音声も付けたい場合は音声生成をオンにします。
4. **入力画像を指定する**（画像→動画の場合） — 入力画像1が最初のフレーム、入力画像2が最後のフレーム（任意）です。クリックで選ぶか、ドラッグ＆ドロップで追加できます。
5. **「生成」を押す** — 中断したいときは「中断」を押してください。生成中の進捗が表示されます。
6. **結果を確認する** — ギャラリーで画像や動画をプレビューし、拡大したり出力フォルダを開いたりできます。

## ライセンス

GPL-3.0 — [LICENSE](LICENSE)をご覧ください。
