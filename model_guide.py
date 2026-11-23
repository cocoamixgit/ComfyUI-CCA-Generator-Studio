"""モデルの選び方(どのファイルを使うか)とライセンスの案内。パネルの「📋 モデルの選び方・ライセンス」で表示する。

出典(2026-11-18 に確認):
  - ファイルの一覧・大きさ・ライセンスの種類: Hugging Face の各リポジトリ(API の cardData.license と siblings)
  - ライセンスの要点: 各ライセンスの本文
      LTX-2.x Community License(github.com/Lightricks/LTX-2 の LICENSE-2_x)
      FLUX Non-Commercial License v2.1 / FLUX Kommunity License v1.0(Hugging Face 上の写し。BFL の公式ページはこの環境から読めなかった)
      Krea 2 Community License(krea/Krea-2-Turbo の LICENSE.pdf)
      CircleStone Labs Non-Commercial License v1.2(circlestone-labs/Anima の LICENSE.md)
      Tencent Hunyuan Community License(tencent/HunyuanVideo の LICENSE)
ライセンスは変わることがある。要約は目安で、正確な条件は配布元の本文で確認する(画面にもそう書く)。
"""

HF = "https://huggingface.co/"
CHECKED = "2026-11-18"

# commercial: ok = 商用可 / cond = 条件付きで商用可 / out = 生成物だけ商用可 / no = 非商用のみ / unknown = 不明
# OpenRAIL-M / OpenRAIL++-M の「使用制限」(ライセンスの最後にある一覧。SD1.5 と SDXL で同じ 11 項目)
RAIL_LIMITS = (
    "モデルも生成物も商用で使えます。ただし、次の使い方は禁止です(ライセンスの最後にある「使用制限」の一覧):\n"
    "・国や地域の法律・規則に反する使い方\n"
    "・未成年を搾取したり傷つけたりする使い方\n"
    "・人を傷つける目的で、うその情報やコンテンツを作って広める\n"
    "・人を傷つけるのに使える個人情報を作って広める\n"
    "・人の名誉を傷つける、けなす、嫌がらせをする\n"
    "・人の法的な権利に不利になることや、守らなければならない約束事を、人を通さず完全に自動で決める\n"
    "・ふるまいや性格(実際のもの・予測したもの)をもとに、人やグループを差別したり不利に扱ったりする\n"
    "・年齢や体・心の状態などの弱みにつけ込んで人の行動を大きくゆがめ、本人や他の人に体や心の害を与える\n"
    "・法律で守られている属性(人種・性別・宗教など)をもとに差別する\n"
    "・医療の助言をしたり、検査の結果を読み解いたりする\n"
    "・裁判・警察・入国審査・難民認定のために使う(ある人が罪を犯しそうかを予測するなど)\n"
    "モデルを配布するときは、この使用制限をそのまま引き継いで渡す必要があります。")

LICENSES = {
    "apache": dict(
        name="Apache-2.0", commercial="ok", short="商用可",
        detail="モデルも生成物も、商用を含めて自由に使えます(配布するときは著作権表示などを残す)。",
        url="https://www.apache.org/licenses/LICENSE-2.0"),
    "mit": dict(
        name="MIT", commercial="ok", short="商用可",
        detail="モデルも生成物も、商用を含めて自由に使えます(配布するときは著作権表示を残す)。",
        url="https://opensource.org/license/mit"),
    "openrail_m": dict(
        name="CreativeML OpenRAIL-M", commercial="ok", short="商用可(使い方の制限あり)",
        detail=RAIL_LIMITS,
        url=HF + "spaces/CompVis/stable-diffusion-license"),
    "openrail_pp": dict(
        name="CreativeML OpenRAIL++-M", commercial="ok", short="商用可(使い方の制限あり)",
        detail=RAIL_LIMITS,
        url=HF + "stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md"),
    "ltx": dict(
        name="LTX-2.x Community License", commercial="cond", short="年商 1,000 万ドル未満なら商用可",
        detail="個人と、年商 1,000 万米ドル未満の会社は、商用を含めて無料で使えます。年商 1,000 万米ドル以上の会社は、"
               "趣味・研究・評価以外で使うときに Lightricks の有料ライセンスが必要です。dev・distilled どちらも同じです。",
        url="https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x"),
    "krea": dict(
        name="Krea 2 Community License", commercial="cond", short="年商 100 万ドル未満なら商用可",
        detail="グループ全体の年商(直近 12 か月)が 100 万米ドル未満なら、モデルも生成物も商用に使えます。それ以上は Krea の Enterprise License が必要です。"
               "モデルを配布・サービスにするときは、名前の先頭に「Krea」を付ける・不適切な内容のフィルターを入れるなどの条件があります。",
        url="https://github.com/krea-ai/krea-2"),
    "flux_nc": dict(
        name="FLUX Non-Commercial License v2.1", commercial="no", short="非商用のみ",
        detail="モデルは非商用(個人の研究・趣味、会社の評価・テスト)でだけ使えます。仕事や収益に使うには Black Forest Labs の商用ライセンスが必要です。"
               "生成物については条文に「商用も可」とある一方、別の条項(モデルが作ったデータを商用に使わない)と食い違いがあり、はっきりしません。"
               "仕事で使うなら FLUX.2 Klein 4B(Apache-2.0)を選ぶか、Black Forest Labs に確認してください。",
        url="https://bfl.ai/legal/non-commercial-license-terms"),
    "flux_kommunity": dict(
        name="FLUX Kommunity License v1.0", commercial="cond", short="年商 500 万ドル未満なら生成物を商用可",
        detail="非商用なら誰でも使えます。関連会社を含めた年商が 500 万米ドル未満なら、生成した画像を商用に使えます(そのためにモデルを本番で動かすのも可)。"
               "それ以上は Black Forest Labs の商用ライセンスが必要です。不適切な内容のフィルター(または公開前の確認)と、法律で必要な場合の「AI で作った」表示が条件です。"
               "生成物を別の AI の学習に使うことは禁止です。",
        url=HF + "black-forest-labs/flux-3-image-klein-comfy"),
    "anima_nc": dict(
        name="CircleStone Labs Non-Commercial License v1.2", commercial="out", short="モデルは非商用・生成物は商用可",
        detail="モデル自体は非商用でだけ使えます(仕事のサービスに組み込む・有料で配るなどは不可)。"
               "生成した画像は、商用を含めてどんな目的にも使えます(ライセンスに「生成物は商用を含めどんな目的にも使える」と書かれています)。",
        url=HF + "circlestone-labs/Anima/blob/main/LICENSE.md"),
    "hunyuan": dict(
        name="Tencent Hunyuan Community License", commercial="cond", short="EU・英国・韓国では使用不可",
        detail="EU・英国・韓国の外でだけ使えます(生成物も同じ)。月間利用者が 1 億人を超えるサービスは Tencent の許可が必要です。",
        url=HF + "tencent/HunyuanVideo/blob/main/LICENSE"),
    "unknown": dict(
        name="記載なし", commercial="unknown", short="不明",
        detail="配布ページにライセンスの記載がありません。仕事で使う前に配布元に確認してください。", url=""),
}

# 用語(画面の上に出す)
GLOSSARY = [
    ("bf16 / fp16", "元の精度。いちばんきれいだが、ファイルも VRAM もいちばん大きい。学習(LoRA 作り)にも使う"),
    ("fp8 / int8(convrot など)", "半分くらいに軽くした形。見た目の差はわずかで、普段使いのおすすめ"),
    ("nvfp4 / fp4", "いちばん軽い形。RTX 50 番台(NVFP4 対応の GPU)向け。それ以外の GPU では速くならないことがある"),
    ("dev / Base(非蒸留)", "元のモデル。ステップが多く遅いが、CFG・ネガティブが効き、学習の元にも使う"),
    ("distilled(蒸留版)", "少ないステップで作れるように作り直した速い版。CFG は 1 で使う"),
    ("Turbo LoRA", "元のモデルに足して、少ないステップで作れるようにする LoRA"),
]

# 種別ごと(基礎モデル / family)の案内。rows の各行:
# 公式に配布されているファイルだけを載せる(派生モデル・マージモデルは載せない)
#   field: パネルの欄 / file: ファイル名 / tag: 種類 / use: 向いている使い方 / size: GB / types: 使う種別(省略 = この案内の全種別)
#   task: 使うタスク(省略 = 全部) / star: おすすめ / ok: このパネルで使えるか(False は理由を use に書く)
#   license: 行ごとのライセンス(省略 = 案内の license) / src: 入手先(省略 = 案内の source)
GUIDES = {
    "MOSS": dict(license="apache", source=HF + "Comfy-Org/MOSS-Image/tree/main", rows=[
        dict(field="unet_name", file="moss_image_sft_int8_convrot.safetensors", tag="SFT・int8", size=5.41, star=True,
             use="普段使いのおすすめ。仕上げ学習(SFT)済みで、軽い"),
        dict(field="unet_name", file="moss_image_sft_bf16.safetensors", tag="SFT・bf16", size=10.16,
             use="VRAM に余裕があり、少しでもきれいにしたいとき"),
        dict(field="unet_name", file="moss_image_base_int8_convrot.safetensors", tag="Base・int8", size=5.41,
             use="仕上げ学習の前のモデル。癖の少ない絵が欲しいとき・LoRA を試すとき"),
        dict(field="unet_name", file="moss_image_base_bf16.safetensors", tag="Base・bf16", size=10.16,
             use="LoRA の学習の元にするとき"),
        dict(field="clip_name", file="qwen3.5_9b_w4a8_gptq.safetensors", tag="w4a8", size=7.34, star=True, use="いちばん軽い(おすすめ)"),
        dict(field="clip_name", file="qwen3.5_9b_int8_convrot.safetensors", tag="int8", size=9.75, use="少しだけ正確"),
        dict(field="clip_name", file="qwen3.5_9b_bf16.safetensors", tag="bf16", size=19.31, use="元の精度。VRAM がとても多いとき"),
        dict(field="turbo_lora_name", file="8-steps-dmd-lora.safetensors", tag="Turbo LoRA", size=None, types=["MOSS Turbo"], star=True,
             use="MOSS Turbo で使う(8 ステップ)", src=HF + "lodestones/MOSS-Image-SFT-8-steps-dmd"),
    ]),
    "SD1.5": dict(license="openrail_m", source=HF + "stable-diffusion-v1-5/stable-diffusion-v1-5/tree/main", rows=[
        dict(field="ckpt_name", file="v1-5-pruned-emaonly.safetensors", tag="生成用", size=4.27, star=True, use="絵を作るならこれ(軽い)"),
        dict(field="ckpt_name", file="v1-5-pruned.safetensors", tag="学習用", size=7.7, use="追加学習(ファインチューン)の元にするとき"),
    ]),
    "SDXL": dict(license="openrail_pp", source=HF + "stabilityai/stable-diffusion-xl-base-1.0/tree/main", rows=[
        dict(field="ckpt_name", file="sd_xl_base_1.0.safetensors", tag="公式", size=6.94, star=True, use="SDXL の元のモデル"),
        dict(field="ckpt_name", file="sd_xl_base_1.0_0.9vae.safetensors", tag="公式・VAE 0.9", size=6.94, use="中の VAE を 0.9 版にしたもの(色の出方が少し違う)"),
    ]),
    "Illustrious": dict(license="openrail_pp", source=HF + "OnomaAIResearch/Illustrious-XL-v1.0/tree/main", rows=[
        dict(field="ckpt_name", file="Illustrious-XL-v1.0.safetensors", tag="公式 v1.0", size=6.94, use="アニメ絵の元のモデル(配布ページの表示は SDXL のライセンス)"),
        dict(field="ckpt_name", file="Illustrious-XL-v2.0.safetensors", tag="公式 v2.0", size=6.94, license="openrail_m",
             use="新しい版", src=HF + "OnomaAIResearch/Illustrious-XL-v2.0/tree/main"),
    ]),
    "Anima": dict(license="anima_nc", source=HF + "circlestone-labs/Anima/tree/main/split_files/diffusion_models", rows=[
        dict(field="unet_name", file="anima-base-v1.0.safetensors", tag="Base", size=4.18, star=True, use="標準"),
        dict(field="unet_name", file="anima-aesthetic-v1.1.safetensors", tag="Aesthetic", size=4.18, use="見栄え重視に調整した版"),
        dict(field="unet_name", file="anima-turbo-v1.1.safetensors", tag="Turbo", size=4.18, use="少ないステップで作る版(ステップ数を減らして使う)"),
    ]),
    "Krea2": dict(license="krea", source=HF + "Comfy-Org/Krea-2/tree/main/diffusion_models", rows=[
        dict(field="unet_name", file="krea2_turbo_fp8_scaled.safetensors", tag="Turbo・fp8", size=13.14, star=True, use="速くて軽い、バランス型(8 ステップ)"),
        dict(field="unet_name", file="krea2_turbo_int8_convrot.safetensors", tag="Turbo・int8", size=13.49, use="fp8 と同じくらいの重さ"),
        dict(field="unet_name", file="krea2_turbo_bf16.safetensors", tag="Turbo・bf16", size=26.28, use="速く、品質も落としたくないとき(VRAM がとても多い PC)"),
        dict(field="unet_name", file="krea2_turbo_nvfp4.safetensors", tag="Turbo・nvfp4", size=7.67, use="いちばん軽い。RTX 50 番台向け"),
        dict(field="unet_name", file="krea2_raw_bf16.safetensors", tag="Raw・bf16", size=26.28, ok=False,
             use="蒸留していない元のモデル。学習・調整用(このパネルの 8 ステップ設定には Turbo を使う)"),
    ]),
    "Qwen Image": dict(license="apache", source=HF + "Comfy-Org/Qwen-Image/tree/main/split_files/diffusion_models", rows=[
        dict(field="unet_name", task="T2I", file="qwen_image_fp8_e4m3fn.safetensors", tag="fp8", size=20.43, star=True, use="テキスト→画像の標準"),
        dict(field="unet_name", task="T2I", file="qwen_image_2512_fp8_e4m3fn.safetensors", tag="2512・fp8", size=20.43, use="新しい版"),
        dict(field="unet_name", task="T2I", file="qwen_image_bf16.safetensors", tag="bf16", size=40.86, use="元の精度(とても重い)"),
        dict(field="unet_name", task="T2I", file="qwen_image_nvfp4.safetensors", tag="nvfp4", size=19.77, use="RTX 50 番台向け"),
        dict(field="unet_name", task="I2I", file="qwen_image_edit_fp8_e4m3fn.safetensors", tag="Edit・fp8", size=20.43, star=True,
             use="画像→画像(編集)の標準", src=HF + "Comfy-Org/Qwen-Image-Edit/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", task="I2I", file="qwen_image_edit_2509_fp8_e4m3fn.safetensors", tag="Edit 2509・fp8", size=20.43,
             use="編集の新しい版(複数の画像に強い)", src=HF + "Comfy-Org/Qwen-Image-Edit/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", task="I2I", file="qwen_image_edit_2511_fp8mixed.safetensors", tag="Edit 2511・fp8", size=20.53,
             use="編集のさらに新しい版", src=HF + "Comfy-Org/Qwen-Image-Edit/tree/main/split_files/diffusion_models"),
        dict(field="clip_name", file="qwen_2.5_vl_7b_fp8_scaled.safetensors", tag="fp8", size=9.38, star=True, use="標準",
             src=HF + "Comfy-Org/Qwen-Image/tree/main/split_files/text_encoders"),
        dict(field="clip_name", file="qwen_2.5_vl_7b.safetensors", tag="bf16", size=16.58, use="元の精度",
             src=HF + "Comfy-Org/Qwen-Image/tree/main/split_files/text_encoders"),
        dict(field="turbo_lora_name", file="Qwen-Image-Lightning-8steps-V1.1.safetensors", tag="Turbo LoRA", size=None, task="T2I",
             types=["Qwen Image Turbo"], star=True, use="Qwen Image Turbo で使う(8 ステップ)", src=HF + "lightx2v/Qwen-Image-Lightning/tree/main"),
    ]),
    "FLUX.2 Klein": dict(license="apache", source=HF + "black-forest-labs/FLUX.2-klein-4b-fp8", rows=[
        dict(field="unet_name", types=["FLUX.2 Klein 4B"], file="flux-2-klein-4b-fp8.safetensors", tag="4B 蒸留・fp8", size=4.07, star=True,
             use="速くて軽い、いちばんのおすすめ(4 ステップ)"),
        dict(field="unet_name", types=["FLUX.2 Klein 4B"], file="flux-2-klein-4b.safetensors", tag="4B 蒸留・bf16", size=7.75,
             use="速く、品質も落としたくないとき", src=HF + "Comfy-Org/Flux-2-Klein-4B/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", types=["FLUX.2 Klein 4B Base"], file="flux-2-klein-base-4b-fp8.safetensors", tag="4B Base・fp8", size=4.09, star=True,
             use="じっくり作る(20 ステップ)。CFG・ネガティブが効く", src=HF + "black-forest-labs/FLUX.2-klein-base-4b-fp8"),
        dict(field="unet_name", types=["FLUX.2 Klein 4B Base"], file="flux-2-klein-base-4b.safetensors", tag="4B Base・bf16", size=7.75,
             use="LoRA の学習の元にするとき", src=HF + "Comfy-Org/Flux-2-Klein-4B/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", types=["FLUX.2 Klein 9B"], file="flux-2-klein-9b-fp8.safetensors", tag="9B 蒸留・fp8", size=9.43, star=True,
             license="flux_nc", use="4B より細かい。非商用のみ", src=HF + "black-forest-labs/FLUX.2-klein-9b-fp8"),
        dict(field="unet_name", types=["FLUX.2 Klein 9B"], file="flux-2-klein-9b.safetensors", tag="9B 蒸留・bf16", size=18.16,
             license="flux_nc", use="9B を元の精度で(VRAM がとても多い PC)。非商用のみ", src=HF + "black-forest-labs/FLUX.2-klein-9B"),
        dict(field="unet_name", types=["FLUX.2 Klein 9B Base"], file="flux-2-klein-base-9b-fp8.safetensors", tag="9B Base・fp8", size=9.57, star=True,
             license="flux_nc", use="9B をじっくり(20 ステップ)。非商用のみ", src=HF + "black-forest-labs/FLUX.2-klein-base-9b-fp8"),
        dict(field="clip_name", types=["FLUX.2 Klein 4B", "FLUX.2 Klein 4B Base"], file="qwen_3_4b.safetensors", tag="4B 用", size=8.04, star=True,
             use="4B と 4B Base で使う", src=HF + "Comfy-Org/Flux-2-Klein-4B/tree/main/split_files/text_encoders"),
        dict(field="clip_name", types=["FLUX.2 Klein 4B", "FLUX.2 Klein 4B Base"], file="qwen_3_4b_fp4_flux2.safetensors", tag="4B 用・fp4", size=3.85,
             use="いちばん軽い(RTX 50 番台向け)", src=HF + "Comfy-Org/Flux-2-Klein-4B/tree/main/split_files/text_encoders"),
        dict(field="clip_name", types=["FLUX.2 Klein 9B", "FLUX.2 Klein 9B Base"], file="qwen_3_8b_fp8mixed.safetensors", tag="9B 用・fp8", size=8.66, star=True,
             license="flux_nc", use="9B と 9B Base で使う", src=HF + "Comfy-Org/Flux-2-Klein-9B/tree/main/split_files/text_encoders"),
        dict(field="clip_name", types=["FLUX.2 Klein 9B", "FLUX.2 Klein 9B Base"], file="qwen_3_8b.safetensors", tag="9B 用・bf16", size=16.38,
             license="flux_nc", use="元の精度", src=HF + "Comfy-Org/Flux-2-Klein-9B/tree/main/split_files/text_encoders"),
    ]),
    "FLUX.3 Klein": dict(license="flux_kommunity", source=HF + "black-forest-labs/flux-3-image-klein-comfy/tree/main/diffusion_models", rows=[
        dict(field="unet_name", types=["FLUX.3 Klein"], file="flux3-image-klein-base-int8-convrot.safetensors", tag="通常版・int8", size=5.81, star=True,
             use="じっくり作る(50 ステップ)。軽い(テンプレートと同じ)"),
        dict(field="unet_name", types=["FLUX.3 Klein"], file="flux3-image-klein-base-bf16.safetensors", tag="通常版・bf16", size=11.08,
             use="学習や、じっくり高品質に作りたいとき(VRAM 24GB 超。長いプロンプトに忠実)"),
        dict(field="unet_name", types=["FLUX.3 Klein"], file="flux3-image-klein-base-nvfp4.safetensors", tag="通常版・nvfp4", size=5.26,
             use="通常版をいちばん軽く。RTX 50 番台向け"),
        dict(field="unet_name", types=["FLUX.3 Klein Distilled"], file="flux3-image-klein-int8-convrot.safetensors", tag="蒸留版・int8", size=5.83, star=True,
             use="速くて軽い、バランス型(16 ステップ)"),
        dict(field="unet_name", types=["FLUX.3 Klein Distilled"], file="flux3-image-klein-bf16.safetensors", tag="蒸留版・bf16", size=11.1,
             use="速く、品質も落としたくないとき"),
        dict(field="unet_name", types=["FLUX.3 Klein Distilled"], file="flux3-image-klein-nvfp4.safetensors", tag="蒸留版・nvfp4", size=5.28,
             use="いちばん軽い。RTX 50 番台向け"),
        dict(field="clip_name", file="qwen3vl_4b_int8_convrot.safetensors", tag="int8", size=4.86, star=True, use="標準"),
        dict(field="clip_name", file="qwen3vl_4b_bf16.safetensors", tag="bf16", size=8.88, use="元の精度"),
    ]),
    "Wan2.2 14B": dict(license="apache", source=HF + "Comfy-Org/Wan-2.2/tree/main/split_files/diffusion_models", rows=[
        dict(field="wan_high_unet", task="T2V", file="wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", tag="High・fp8", size=14.29, star=True, use="テキスト→動画の前半(おすすめ)"),
        dict(field="wan_low_unet", task="T2V", file="wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors", tag="Low・fp8", size=14.29, star=True, use="テキスト→動画の後半(おすすめ)"),
        dict(field="wan_high_unet", task="T2V", file="wan2.2_t2v_high_noise_14B_fp16.safetensors", tag="High・fp16", size=28.58, use="元の精度(とても重い)"),
        dict(field="wan_low_unet", task="T2V", file="wan2.2_t2v_low_noise_14B_fp16.safetensors", tag="Low・fp16", size=28.58, use="元の精度(とても重い)"),
        dict(field="wan_high_unet", task="I2V", file="wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", tag="High・fp8", size=14.29, star=True, use="画像→動画の前半(おすすめ)"),
        dict(field="wan_low_unet", task="I2V", file="wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", tag="Low・fp8", size=14.29, star=True, use="画像→動画の後半(おすすめ)"),
        dict(field="wan_high_unet", task="I2V", file="wan2.2_i2v_high_noise_14B_fp16.safetensors", tag="High・fp16", size=28.58, use="元の精度(とても重い)"),
        dict(field="wan_low_unet", task="I2V", file="wan2.2_i2v_low_noise_14B_fp16.safetensors", tag="Low・fp16", size=28.58, use="元の精度(とても重い)"),
        dict(field="turbo_lora_name", task="T2V", types=["Wan2.2 14B Turbo"], file="wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors",
             tag="Turbo LoRA(High)", size=1.23, star=True, use="Turbo で使う(4 ステップ)", src=HF + "Comfy-Org/Wan-2.2/tree/main/split_files/loras"),
        dict(field="turbo_lora_name", task="I2V", types=["Wan2.2 14B Turbo"], file="wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
             tag="Turbo LoRA(High)", size=1.23, star=True, use="Turbo で使う(4 ステップ)", src=HF + "Comfy-Org/Wan-2.2/tree/main/split_files/loras"),
    ]),
    "Wan2.2 5B": dict(license="apache", source=HF + "Comfy-Org/Wan-2.2/tree/main/split_files/diffusion_models", rows=[
        dict(field="unet_name", file="wan2.2_ti2v_5B_fp16.safetensors", tag="fp16", size=10.0, star=True, use="これだけ(テキスト→動画・画像→動画どちらも)"),
        dict(field="turbo_lora_name", types=["Wan2.2 5B Turbo"], file="Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors", tag="Turbo LoRA",
             size=None, star=True, license="unknown", use="Turbo で使う(FastWan・6 ステップ)", src=HF + "Kijai/WanVideo_comfy/tree/main/FastWan"),
    ]),
    "LTX-2.5": dict(license="ltx", source=HF + "Lightricks/LTX-2.5/tree/main/diffusion_models", rows=[
        dict(field="unet_name", file="ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors", tag="distilled・int8", size=21.5, star=True,
             use="速くて軽い、バランス型(テンプレートと同じ・おすすめ)"),
        dict(field="unet_name", file="ltx-2.5-22b-distilled-transformer-bf16.safetensors", tag="distilled・bf16", size=42.02,
             use="速く、品質も落としたくないとき(VRAM がとても多い PC)"),
        dict(field="unet_name", file="ltx-2.5-22b-distilled-transformer-nvfp4.safetensors", tag="distilled・nvfp4", size=18.72,
             use="いちばん軽い。RTX 50 番台向け"),
        dict(field="unet_name", file="ltx-2.5-22b-dev-transformer-bf16.safetensors", tag="dev・bf16", size=42.02, ok=False,
             use="学習(LoRA 作り)や、ステップを増やしてじっくり作る別の手順向け。このパネルの LTX-2.5 は蒸留版の手順なので、そのままでは向きません"),
        dict(field="unet_name", file="ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors", tag="dev・int8", size=21.5, ok=False,
             use="dev を軽くしたもの。このパネルの手順(蒸留版用)には向きません"),
        dict(field="clip_name", file="gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", tag="int8", size=15.37, star=True, use="標準",
             src=HF + "Lightricks/LTX-2.5/tree/main/text_encoders"),
        dict(field="clip_name", file="gemma4-12b-with-proj-ltx-2.5-bf16.safetensors", tag="bf16", size=26.26, use="元の精度",
             src=HF + "Lightricks/LTX-2.5/tree/main/text_encoders"),
    ]),
    "Kandinsky 6": dict(license="mit", source=HF + "kandinskylab", short_note="VAE は別のライセンス", note=(
        "Kandinsky 6 の VAE(hunyuan_video_vae_bf16)は HunyuanVideo のもので、Tencent Hunyuan Community License です"
        "(EU・英国・韓国では使えません)。"), rows=[
        dict(field="unet_name", file="Kandinsky-6.0-Pro-distill-5s-Diffusers/transformer/diffusion_pytorch_model.safetensors", tag="Pro distill",
             size=60.34, star=True, use="標準(10 ステップ・CFG 1)", src=HF + "kandinskylab/Kandinsky-6.0-Pro-distill-5s-Diffusers/tree/main/transformer"),
        dict(field="unet_name", file="Kandinsky-6.0-Lite-distill-5s-Diffusers/transformer/diffusion_pytorch_model.safetensors", tag="Lite distill",
             size=6.38, use="小さく速い。VRAM が少ない PC 向け", src=HF + "kandinskylab/Kandinsky-6.0-Lite-distill-5s-Diffusers/tree/main/transformer"),
        dict(field="unet_name", file="Kandinsky-6.0-Pro-5s-Diffusers/transformer/diffusion_pytorch_model.safetensors", tag="Pro(非蒸留)",
             size=69.73, use="じっくり作る(50 ステップ・CFG 5)。とても遅い。アクセス申請が必要",
             src=HF + "kandinskylab/Kandinsky-6.0-Pro-5s-Diffusers/tree/main/transformer"),
        dict(field="unet_name", file="Kandinsky-6.0-Lite-5s-Diffusers/transformer/diffusion_pytorch_model.safetensors", tag="Lite(非蒸留)",
             size=7.48, use="Lite をじっくり(50 ステップ・CFG 5)", src=HF + "kandinskylab/Kandinsky-6.0-Lite-5s-Diffusers/tree/main/transformer"),
        dict(field="vae_name", file="hunyuan_video_vae_bf16.safetensors", tag="VAE", size=None, star=True, license="hunyuan",
             use="Kandinsky 6 で使う VAE", src=HF + "Comfy-Org/Hunyuan-Video/tree/main/split_files/vae"),
    ]),
}

# ---- 第42版: 声・音楽(2026-11-20 に Hugging Face / GitHub で確認)----
# Qwen3-TTS・LatentSync・HeartMuLa のモデルは、追加ノードが初めて使うときに自動でダウンロードする(行はリポジトリ名)
GUIDES.update({
    "Qwen3-TTS": dict(license="apache", source=HF + "collections/Qwen/qwen3-tts", note=(
        "モデルは追加ノード ComfyUI-QwenTTS が初めて使うときに自動でダウンロードします(models/TTS/Qwen3-TTS)。"
        "追加ノード自体のライセンスは GPL-3.0 です。"), rows=[
        dict(field="tts_model", file="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", tag="プリセットの声・1.7B", size=None, star=True, task="TTS",
             use="プリセットの声(9 種類)で読み上げる。話し方の指示も効く", src=HF + "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"),
        dict(field="tts_model", file="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", tag="プリセットの声・0.6B", size=None, task="TTS",
             use="軽い・速い", src=HF + "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"),
        dict(field="tts_model", file="Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", tag="声を文章で指定・1.7B", size=None, star=True, task="TTD",
             use="声の説明から声を作る(1.7B だけ)", src=HF + "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"),
        dict(field="tts_model", file="Qwen/Qwen3-TTS-12Hz-1.7B-Base", tag="ボイスクローン・1.7B", size=None, star=True, task="TTC",
             use="数秒の音声からボイスクローン", src=HF + "Qwen/Qwen3-TTS-12Hz-1.7B-Base"),
        dict(field="tts_model", file="Qwen/Qwen3-TTS-12Hz-0.6B-Base", tag="ボイスクローン・0.6B", size=None, task="TTC",
             use="軽い・速い", src=HF + "Qwen/Qwen3-TTS-12Hz-0.6B-Base"),
        dict(field="tts_model", file="Qwen/Qwen3-TTS-Tokenizer-12Hz", tag="共通", size=None,
             use="音にする部分(どのモデルでも使う)", src=HF + "Qwen/Qwen3-TTS-Tokenizer-12Hz"),
    ]),
    "RVC": dict(license="mit", source=HF + "lj1995/VoiceConversionWebUI", short_note="変換の部分を同梱", note=(
        "RVC(RVC-Project/Retrieval-based-Voice-Conversion-WebUI)の変換の部分を MIT License のまま同梱しています(rvc/LICENSE)。"
        "HuBERT と RMVPE は初めて使うときに Hugging Face の lj1995/VoiceConversionWebUI(MIT License)から models/rvc へ自動でダウンロードします。"
        "声のモデル(.pth)と .index は各自で用意します。声のモデルのライセンス・声の持ち主の許可は、モデルごとに確かめてください。"), rows=[
        dict(field="rvc_model", file="hubert_base", tag="HuBERT", size=0.19, star=True,
             use="声の特徴を読む部分(自動でダウンロード)", src=HF + "lj1995/VoiceConversionWebUI/tree/main/hubert_base"),
        dict(field="rvc_model", file="rmvpe.pt", tag="RMVPE", size=0.18, star=True,
             use="声の高さを読む部分(自動でダウンロード)", src=HF + "lj1995/VoiceConversionWebUI/blob/main/rmvpe.pt"),
    ]),
    "LatentSync 1.6": dict(license="openrail_pp", source=HF + "ByteDance/LatentSync-1.6", short_note="コードは Apache-2.0", note=(
        "LatentSync のプログラム(bytedance/LatentSync)は Apache-2.0、重み(ByteDance/LatentSync-1.6)は CreativeML OpenRAIL++-M です。"
        "モデルは追加ノード ComfyUI-LatentSyncWrapper が初めて使うときに自動でダウンロードします(追加ノードの checkpoints フォルダ)。"), rows=[
        dict(field="lipsync_model", file="ByteDance/LatentSync-1.6", tag="1.6", size=None, star=True,
             use="リップシンクの本体(latentsync_unet.pt)と、声を読む whisper", src=HF + "ByteDance/LatentSync-1.6"),
    ]),
    "HeartMuLa": dict(license="apache", source=HF + "HeartMuLa", note=(
        "モデルは追加ノード ComfyUI_FL-HeartMuLa が初めて使うときに自動でダウンロードします(models/heartmula)。"
        "HeartMuLa の仲間の MuLaCover は CC BY-NC 4.0(非商用)で、このパネルでは使いません。"), rows=[
        dict(field="music_model", file="HeartMuLa/HeartMuLa-oss-3B", tag="3B", size=None, star=True,
             use="曲を作る本体(VRAM 目安 12GB。4bit なら 6GB)", src=HF + "HeartMuLa/HeartMuLa-oss-3B"),
        dict(field="music_model", file="HeartMuLa/HeartCodec-oss-20260123", tag="コーデック", size=None,
             use="音にする部分(一緒に使う)", src=HF + "HeartMuLa"),
        dict(field="music_model", file="HeartMuLa/HeartMuLaGen", tag="設定", size=None,
             use="文字の読み方などの設定(一緒に使う)", src=HF + "HeartMuLa/HeartMuLaGen"),
    ]),
    "ACE-Step 1.5": dict(license="mit", source=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main", rows=[
        dict(field="unet_name", file="acestep_v1.5_turbo.safetensors", tag="Turbo", size=4.79, star=True,
             use="標準。8 ステップ・CFG 1 で速い(テンプレートと同じ)", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", file="acestep_v1.5_base.safetensors", tag="Base", size=4.79,
             use="蒸留前の元のモデル。ステップを増やし、CFG を効かせて使う", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", file="acestep_v1.5_xl_turbo_bf16.safetensors", tag="XL Turbo", size=9.97,
             use="大きい版の Turbo。VRAM に余裕があるとき", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", file="acestep_v1.5_xl_base_bf16.safetensors", tag="XL Base", size=9.97,
             use="大きい版の Base", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", file="acestep_v1.5_xl_sft_bf16.safetensors", tag="XL SFT", size=9.97,
             use="大きい版の仕上げ学習(SFT)済み", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/diffusion_models"),
        dict(field="unet_name", file="ace_step_1.5_turbo_aio.safetensors", tag="1 つにまとめた版", size=10.03, ok=False,
             use="モデル・エンコーダー・VAE を 1 つにまとめたもの。このパネルは分けたファイルで読むので向きません",
             src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/checkpoints"),
        dict(field="clip_name", file="qwen_0.6b_ace15.safetensors", tag="0.6B", size=1.19, star=True,
             use="テキストエンコーダー(テンプレートと同じ)", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/text_encoders"),
        dict(field="clip_name_2", file="qwen_4b_ace15.safetensors", tag="LM 4B", size=8.38, star=True,
             use="曲の設計を考える言語モデル(テンプレートと同じ)", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/text_encoders"),
        dict(field="clip_name_2", file="qwen_1.7b_ace15.safetensors", tag="LM 1.7B", size=3.71,
             use="軽い言語モデル。VRAM が少ないとき", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/text_encoders"),
        dict(field="vae_name", file="ace_1.5_vae.safetensors", tag="VAE", size=0.34, star=True,
             use="音にする部分", src=HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/vae"),
    ]),
})

# 種別 → (案内のキー, ライセンス)。Turbo は元の種別と同じモデルに LoRA を足すだけ
TYPE_LICENSE = {
    "FLUX.2 Klein 9B": "flux_nc", "FLUX.2 Klein 9B Base": "flux_nc",
}


def guide_key(info):
    if info["family"] in GUIDES:
        return info["family"]
    return info["base"] if info["base"] in GUIDES else None


def type_license(name, info):
    if name in TYPE_LICENSE:
        return TYPE_LICENSE[name]
    key = guide_key(info)
    return GUIDES[key]["license"] if key else "unknown"


def missing_help(model_type, info, field, tr=lambda x: x):
    """ファイルが見つからないときのエラー文に足す、そのモデルの案内(どのファイルを使うか・配布元)。無ければ空文字"""
    key = guide_key(info) if info else None
    if not key or not field:
        return ""
    g = GUIDES[key]
    rows = [r for r in g["rows"] if r.get("field") == field and (not r.get("types") or model_type in r["types"])]
    if not rows:
        return ""
    out = [tr("このモデルの案内(★ はおすすめ):")]
    for r in rows[:8]:
        size = f" / {r['size']} GB" if r.get("size") else ""
        out.append(f"  {'★ ' if r.get('star') else ''}{r['file']} ({tr(r['tag'])}{size}) {tr(r['use'])}")
        out.append(f"    {r.get('src') or g.get('source', '')}")
    return "\n".join(out)
