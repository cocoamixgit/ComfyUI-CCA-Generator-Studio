"""モデル種別・タスク・既定値・表示項目の定義(Python 側が唯一の定義元)。

既定値の出典(優先順):
  1. Full_generator.json の PRESET MEMO(ノード301)と、元ワークフローのローダーに入っていたファイル名
  2. ComfyUI-Krea2-Forge-UI の README(Krea2 の UNet 名)
  3. 公式/コミュニティの推奨値(MEMO に無い項目のみ。SPEC.md「既定値の出典」に一覧)
"""

NONE = "(none)"
TASKS_ALL = ["T2I", "I2I", "T2V", "I2V", "R2V", "TTS", "TTD", "TTC", "T2M", "VC", "LIP", "I23D"]
TASK_LABELS = {
    "T2I": "テキスト → 画像",
    "I2I": "画像 → 画像",
    "T2V": "テキスト → 動画",
    "I2V": "画像 → 動画",
    "R2V": "参照画像 → 動画",
    # 第42版: 声・音楽
    "TTS": "テキスト読み上げ(プリセットの声)",
    "TTD": "テキスト読み上げ(声を文章で指定)",
    "TTC": "テキスト読み上げ(ボイスクローン)",
    "T2M": "テキスト → 音楽",
    "VC": "ボイスチェンジ(音声 → 音声)",
    "LIP": "リップシンク(動画 + 音声)",
    # 3D
    "I23D": "画像 → 3D",
}
ROUTE_COUNT = 28
# 入力画像の欄(1 枚目は標準のアップロード/マスク付き。FLUX.3 Klein は最大 10 枚)
MAX_IMAGE_SLOTS = 10
IMAGE_WIDGETS = ["image"] + [f"image_{i}" for i in range(2, MAX_IMAGE_SLOTS + 1)]

# MOSS Edit の Edit 形式(ComfyUI の TextEncodeMOSSImageEdit と同じ並び)
EDIT_FORMATS = ["ai-toolkit", "ai-toolkit (kv_cache off)", "Moss-Image-Edit"]
EDIT_FORMAT_AUTO = "自動"
# 参照画像の大きさ。既定は「自動」: Edit 形式が chinoll 版(Moss-Image-Edit)なら長辺 512
# (配布元 Chenkin-x のワークフローの reference_max_edge)、ai-toolkit 形式なら出力と同じ大きさ
REF_SIZE_AUTO = "自動(Edit LoRA に合わせる)"
REF_SIZE_SAME = "出力と同じ"
REF_SIZES = {REF_SIZE_AUTO: -1, REF_SIZE_SAME: 0, "長辺 512": 512, "長辺 768": 768, "長辺 1024": 1024}
# 第5版までの選択肢名 → 今の名前(保存済みの設定・ワークフローを読み替える)
REF_SIZE_OLD = {"出力と同じ(推奨)": REF_SIZE_SAME, "長辺 512(背景・場面を変えるとき)": "長辺 512",
                "長辺 768(メモリが足りないとき)": "長辺 768"}
# 出力サイズの決め方(画像→画像・画像→動画)。Forge の「Resize to / Resize by」と同じ考え方
# VRAM の補い方(足りない分のモデルの層を CPU 側のメモリに置き、必要なときだけ GPU に送る)
VRAM_AUTO = "自動"
VRAM_FULL = "full"
VRAM_FAST = "fast"
VRAM_BALANCED = "balanced"
VRAM_LOW = "low"
VRAM_MODES = [VRAM_AUTO, VRAM_FULL, VRAM_FAST, VRAM_BALANCED, VRAM_LOW]
SIZE_MODE_KEEP = "サイズ指定"       # 今まで通り(幅・高さ、または種別ごとの決まった方法)
SIZE_MODE_SCALE = "倍率指定"        # 画像1の大きさ × 倍率
SIZE_MODES = [SIZE_MODE_KEEP, SIZE_MODE_SCALE]
# 画像→画像の「サイズ指定」での変え方(Forge の Resize mode と同じ)。既定は今まで通り(変えない)
RESIZE_KEEP = "画像1のサイズ"
RESIZE_JUST = "そのまま拡大縮小"
RESIZE_CROP = "切り抜いて拡大縮小"
RESIZE_FILL = "余白を埋めて拡大縮小"
RESIZE_MODES = [RESIZE_KEEP, RESIZE_JUST, RESIZE_CROP, RESIZE_FILL]
# Hires. fix の拡大方法(これ以外は models/upscale_models のファイル)
HIRES_METHODS = {"Lanczos": "lanczos", "Bicubic": "bicubic", "Bilinear": "bilinear",
                 "Nearest": "nearest-exact", "Area": "area"}

# loader: "unet" = UNETLoader + CLIPLoader + VAELoader
#         "ckpt" = CheckpointLoaderSimple
#         "wan14" = High/Low の UNet 2本 + CLIPLoader + VAELoader
# route 番号は Full_generator.json の Flow Selector の route_00〜route_22 と同じ。
BASES = {
    "MOSS": dict(
        loader="unet", kind="image", tasks=["T2I", "I2I"],
        routes={"T2I": 0, "I2I": 1}, negative=True, turbo=True,
        # テキスト→画像は枠で配置を指定できる(MOSS-Image Layout Prompt)
        layout={"T2I": "moss"},
        # 2 枚の画像を使う編集は未対応(2 枚用に学習された Edit LoRA がまだ無い)。画像1の編集だけ
        max_images={"I2I": 1}, mask={"I2I": True}, hires=True,
        # マスクを描かなければ、元の画像から全体を編集する(処理の中の CCAEditLatent が普通の VAEEncode にする)。
        # 第15版まではここで全体を塗ったマスクにしていたため、VAEEncodeForInpaint が画像を灰色にして、灰色から作り直していた
        # 参照画像の大きさ(ref_size)を選べる
        ref_max_edge={"I2I": True},
        # ComfyUI の TextEncodeMOSSImageEdit がテキストエンコーダーに付ける呼び名(Picture 1: / Picture 2:)
        image_names={"I2I": ("Picture 1", "Picture 2")},
        image_roles={"I2I": ("編集する画像", "")},
    ),
    "SD1.5": dict(
        loader="ckpt", kind="image", tasks=["T2I", "I2I"],
        routes={"T2I": 2, "I2I": 3}, negative=True, turbo=False, hires=True, max_images={"I2I": 1},
        # 塗った所だけ作り直す(第17版)。マスクが無ければ全体 = 今まで通りの画像→画像
        mask={"I2I": True}, full_mask_if_empty={"I2I": True},
    ),
    "SDXL": dict(
        loader="ckpt", kind="image", tasks=["T2I", "I2I"],
        routes={"T2I": 4, "I2I": 5}, negative=True, turbo=False, hires=True, max_images={"I2I": 1},
        # 塗った所だけ作り直す(第17版)。マスクが無ければ全体 = 今まで通りの画像→画像
        mask={"I2I": True}, full_mask_if_empty={"I2I": True},
    ),
    "Illustrious": dict(
        loader="ckpt", kind="image", tasks=["T2I", "I2I"],
        routes={"T2I": 6, "I2I": 7}, negative=True, turbo=False, hires=True, max_images={"I2I": 1},
        # 塗った所だけ作り直す(第17版)。マスクが無ければ全体 = 今まで通りの画像→画像
        mask={"I2I": True}, full_mask_if_empty={"I2I": True},
    ),
    "Anima": dict(
        loader="unet", kind="image", tasks=["T2I", "I2I"],
        routes={"T2I": 8, "I2I": 21}, negative=True, turbo=False, hires=True, max_images={"I2I": 1},
        # 塗った所だけ作り直す(第17版)。マスクが無ければ全体 = 今まで通りの画像→画像
        mask={"I2I": True}, full_mask_if_empty={"I2I": True},
    ),
    "Krea2": dict(
        loader="unet", kind="image", tasks=["T2I", "I2I"],
        routes={"T2I": 9, "I2I": 22}, negative=False, turbo=False, hires=True, max_images={"I2I": 1},
        # 塗った所だけ作り直す(第17版)。マスクが無ければ全体 = 今まで通りの画像→画像
        mask={"I2I": True}, full_mask_if_empty={"I2I": True},
    ),
    "Qwen Image": dict(
        loader="unet", kind="image", tasks=["T2I", "I2I"],
        routes={"T2I": 10, "I2I": 11}, negative=True, turbo=True, max_images={"I2I": 2}, hires=True,
        mask={"I2I": True}, full_mask_if_empty={"I2I": True},
        image_names={"I2I": ("first image", "second image")},
        image_roles={"I2I": ("編集する画像", "取り入れたい物・服など(任意)")},
        # T2I は通常モデル、I2I は Edit モデルを使うため UNet と Turbo LoRA はタスクごとに保存
        task_scoped=["unet_name", "turbo_lora_name", "loras"],
    ),
    # FLUX.2 Klein(ComfyUI 公式テンプレート image_flux2_klein_*)。蒸留版 = 4 ステップ・CFG 1、Base = 20 ステップ・CFG 5。
    # 画像→画像は参照画像を最大 4 枚(各画像を ReferenceLatent で条件に足す)
    **{name: dict(
        loader="unet", kind="image", tasks=["T2I", "I2I"], family="FLUX.2 Klein",
        routes={"T2I": 23, "I2I": 23}, negative=True, turbo=False, max_images={"I2I": 4}, denoise=False,
        # マスクを描いたら、塗っていない所は元の画像のまま(最後に貼り戻す。CCAHiresFix)
        mask={"I2I": True},
        image_names={"I2I": ("image 1", "image 2", "image 3", "image 4")},
        image_roles={"I2I": ("編集する画像", "参照画像(任意)", "参照画像(任意)", "参照画像(任意)")},
    ) for name in ("FLUX.2 Klein 4B", "FLUX.2 Klein 4B Base", "FLUX.2 Klein 9B", "FLUX.2 Klein 9B Base")},
    # FLUX.3 Klein(テンプレート image_flux3_klein_*)。参照画像は最大 10 枚(Set Reference Multi Latent)。
    # プロンプトでは <ref_image_0>(1 枚目)、<ref_image_1>(2 枚目)…で指す
    **{name: dict(
        loader="unet", kind="image", tasks=["T2I", "I2I"], family="FLUX.3 Klein",
        routes={"T2I": 24, "I2I": 24}, negative=True, turbo=False, max_images={"I2I": 10}, denoise=False,
        # マスクを描いたら、塗っていない所は元の画像のまま(最後に貼り戻す。CCAHiresFix)
        mask={"I2I": True},
        # 枠で配置を指定できる(FLUX 3 Image Layout Prompt。プロンプトでは <obj_1> のように枠の番号で指す)
        layout={"T2I": "flux3", "I2I": "flux3"},
        image_names={"I2I": tuple(f"<ref_image_{i}>" for i in range(10))},
        image_roles={"I2I": ("編集する画像",) + ("参照画像(任意)",) * 9},
    ) for name in ("FLUX.3 Klein", "FLUX.3 Klein Distilled")},
    # SenseNova-U1.6(追加ノード ComfyUI-SenseNova-U1 / OpenSenseNova)。モデルは追加ノードの読み込み方で選ぶ
    # (Hugging Face の名前なら初めて使うときに自動で入手、手元のものは models/sensenova)。参照画像は最大 10 枚
    "SenseNova-U1.6": dict(
        loader="sn", kind="image", tasks=["T2I", "I2I"], needs_node="SenseNovaU1ModelLoader",
        routes={"T2I": 27, "I2I": 27}, negative=False, turbo=True, sampler=False, denoise=False, max_images={"I2I": 10},
        image_roles={"I2I": ("編集する画像",) + ("参照画像(任意)",) * 9},
        lists={"unet_name": "sn_models"}, labels={"*": {"unet_name": "モデル"}},
    ),
    # 使わない(ワークフローには残すが、選べる一覧からは外す)
    "MiniMax-H3-Image": dict(
        loader="unet", kind="image", tasks=["T2I", "I2I"], hidden=True,
        routes={"T2I": 12, "I2I": 13}, negative=False, turbo=True, max_images={"I2I": 2},
        mask={"I2I": True},  # マスクを描いたら、塗っていない所は元の画像のまま(最後に貼り戻す)
        auto_size_i2i=True,
        image_names={"I2I": ("<Picture 1>", "<Picture 2>")},
        image_roles={"I2I": ("編集する画像", "参照画像(任意)")},
    ),
    "Wan2.2 14B": dict(
        loader="wan14", kind="video", tasks=["T2V", "I2V"],
        routes={"T2V": 14, "I2V": 15}, negative=True, turbo=True, max_images={"I2V": 2},
        denoise=False, task_scoped=["turbo_lora_name", "turbo_lora_low_name", "loras"],
        image_roles={"I2V": ("最初のフレーム", "最後のフレーム(任意)")},
    ),
    "Wan2.2 5B": dict(
        loader="unet", kind="video", tasks=["T2V", "I2V"],
        routes={"T2V": 16, "I2V": 17}, negative=True, turbo=True, max_images={"I2V": 1},
        image_roles={"I2V": ("最初のフレーム", "")},
    ),
    # LTX-2.5(テンプレート video_ltx2_5_*)。蒸留モデルで、ステップ・CFG・サンプラーはテンプレートの固定値
    # (半分の大きさで生成 → 潜在アップスケーラーで 2 倍 → 仕上げ)。音声も一緒に作る
    "LTX-2.5": dict(
        loader="unet", kind="video", tasks=["T2V", "I2V"],
        routes={"T2V": 25, "I2V": 25}, negative=False, turbo=False, max_images={"I2V": 2},
        audio_vae=True, cfg=False, steps=False, sampler=False, latent_upscale=True, denoise=False, audio=True,
        image_roles={"I2V": ("最初のフレーム", "最後のフレーム(任意)")},
    ),
    # Kandinsky 6(追加ノード kandinsky6 が必要)。Pro distill: 10 ステップ・CFG 1。音声も一緒に作る
    "Kandinsky 6": dict(
        loader="k6", kind="video", tasks=["T2V", "I2V"], needs_node="Kandinsky6Sampler",
        routes={"T2V": 26, "I2V": 26}, negative=True, turbo=False, max_images={"I2V": 1}, denoise=False, audio=True,
        image_roles={"I2V": ("最初のフレーム",)},
    ),
    "MiniMax H3": dict(
        loader="unet", kind="video", tasks=["T2V", "I2V", "R2V"], hidden=True,
        routes={"T2V": 18, "I2V": 19, "R2V": 20}, negative=False, turbo=True, mid_frame=True, fixed_fps=True, audio=True,
        max_images={"I2V": 3, "R2V": 2}, audio_vae=True,
        cfg=False,  # BasicGuider のため CFG は使われない
        task_scoped=["turbo_lora_name"],
        image_names={"R2V": ("<Picture 1>", "<Picture 2>")},
        image_roles={"I2V": ("最初のフレーム", "途中のフレーム(任意)", "最後のフレーム(任意)"),
                     "R2V": ("参照画像", "参照画像(任意)")},
    ),
    # ---- 第42版: 声・音楽(画像・動画のワークフローは使わず、audiogen.py が小さな処理を作る)----
    # labels: その種別・タスクでの欄の名前と入力例({タスク or "*": {欄: 名前, "欄_ph": 入力例}})
    "HeartMuLa": dict(
        loader="audio", kind="audio", tasks=["T2M"], gen="heartmula", needs_node="FL_HeartMuLa_Sampler",
        negative=False, turbo=False, steps=False, cfg=True, sampler=False, denoise=False,
        labels={"*": {"positive": "スタイル(タグ)", "negative": "歌詞", "cfg": "CFG(スタイル・歌詞への近さ)",
                      "positive_ph": "ジャンル・声・雰囲気・楽器をカンマで区切って。例: j-pop, female vocal, bright, piano",
                      "negative_ph": "[Verse] [Chorus] などで区切って書きます"}},
    ),
    "ACE-Step 1.5": dict(
        loader="ace", kind="audio", tasks=["T2M"], gen="ace", needs_node="TextEncodeAceStepAudio1.5",
        negative=False, turbo=False, steps=True, cfg=True, sampler=True, denoise=False,
        labels={"*": {"positive": "曲の説明(キャプション)", "negative": "歌詞", "clip_name": "テキストエンコーダー(0.6B)",
                      "clip_name_2": "言語モデル(LM)", "positive_ph": "曲の雰囲気・ジャンル・楽器・声など。タグでも文でも",
                      "negative_ph": "[Verse] [Chorus] などで区切って書きます(歌なしは下の「歌なし」)"}},
    ),
    "Qwen3-TTS": dict(
        loader="audio", kind="audio", tasks=["TTS", "TTD", "TTC"], gen="qwen_tts", needs_node="AILab_Qwen3TTSCustomVoice",
        negative=False, turbo=False, steps=False, cfg=False, sampler=False, denoise=False,
        labels={"TTS": {"positive": "読み上げるテキスト", "negative": "話し方の指示(任意)", "positive_ph": "読み上げるテキストを書きます",
                        "negative_ph": "例: Speak gently and calmly.(空なら指示なし)"},
                "TTD": {"positive": "読み上げるテキスト", "negative": "声の説明", "positive_ph": "読み上げるテキストを書きます",
                        "negative_ph": "どんな声か。例: A calm, deep adult male voice."},
                "TTC": {"positive": "読み上げるテキスト", "positive_ph": "参照音声の声で読み上げるテキストを書きます"}},
    ),
    # 第43版: RVC(同梱。追加ノードは要らない)
    "RVC": dict(
        loader="audio", kind="audio", tasks=["VC"], gen="rvc", needs_node="CCARVCConvert",
        negative=False, turbo=False, steps=False, cfg=False, sampler=False, denoise=False,
    ),
    "LatentSync 1.6": dict(
        loader="audio", kind="audio", tasks=["LIP"], gen="latentsync", needs_node="LatentSyncNode", output="video",
        negative=False, turbo=False, steps=True, cfg=True, sampler=False, denoise=False,
        labels={"*": {"steps": "ステップ数", "cfg": "リップシンクの強さ"}},
    ),
    # ---- 3D(画像・動画のワークフローは使わず、gen3d.py が小さな処理を作る)----
    # TRELLIS.2(ComfyUI 本体のノード。同梱のテンプレート「画像 → 3D」と同じ手順)。入力画像 1 枚 → 3D モデル(GLB)
    "TRELLIS.2": dict(
        loader="3d", kind="3d", tasks=["I23D"], gen="trellis2", needs_node="Trellis2Conditioning", output="3d",
        negative=False, turbo=False, steps=False, cfg=False, sampler=False, denoise=False, max_images={"I23D": 1},
        image_roles={"I23D": ("3D にする画像",)},
        lists={"clip_name": "clip_visions", "clip_name_2": "bg_models"},
        labels={"*": {"unet_name": "モデル", "vae_name": "形の VAE", "audio_vae_name": "色の VAE",
                      "clip_name": "画像エンコーダー", "clip_name_2": "背景除去モデル"}},
    ),
}

BASE_DEFAULT_FLAGS = dict(
    auto_size_i2i=False, denoise=True, audio_vae=False, cfg=True,
    mask={}, image_roles={}, task_scoped=[], full_mask_if_empty={}, ref_max_edge={},
    image_names={}, hires=False,
    # hidden: 選べる一覧に出さない / steps・sampler: 欄を出すか / latent_upscale: 潜在アップスケーラーの欄
    # needs_node: 必要な追加ノード(無ければパネルに案内を出す) / mid_frame: 途中のフレームの位置 / fixed_fps: fps 固定
    hidden=False, steps=True, sampler=True, latent_upscale=False, needs_node=None,
    mid_frame=False, fixed_fps=False, family=None,
    # 第10版: layout = 枠(バウンディングボックス)で配置を指定できるタスク {タスク: "flux3" / "moss"}
    #          audio = 音声も一緒に作る(プロンプトの下に音の書き方を出す)
    layout={}, audio=False,
    # 第42版: gen = 声・音楽の作り方(audiogen.py)/ labels = 欄の名前と入力例 / output = 結果(audio / video)
    gen=None, labels={}, output="audio", max_images={}, routes={},
    # lists = 欄の選択肢を、その種別だけ別の一覧にする {欄: 一覧名}(SenseNova のモデル・TRELLIS.2 の画像エンコーダーなど)
    lists={},
)

# モデル種別の短い説明(プルダウンを開いたときと、選んだ種別の下に出す)。Turbo は自動で「… を少ないステップで」
TYPE_NOTES = {
    "MOSS": "自然な文章で書く・画像の編集もできる",
    "SD1.5": "軽い・タグで書く",
    "SDXL": "タグでも文章でも書ける",
    "Illustrious": "アニメ絵・タグで書く",
    "Anima": "アニメ絵・タグで書く",
    "Krea2": "写実的・8 ステップで速い",
    "Qwen Image": "文字に強い・2 枚の画像で編集できる",
    "FLUX.2 Klein 4B": "おすすめ。蒸留版でとても速い(4 ステップ)・軽い",
    "FLUX.2 Klein 4B Base": "非蒸留版。遅い(20 ステップ)が CFG・ネガティブが効く",
    "FLUX.2 Klein 9B": "蒸留版で速い(4 ステップ)。4B より細かいが重い",
    "FLUX.2 Klein 9B Base": "非蒸留版。遅い(20 ステップ)が CFG・ネガティブが効く・重い",
    "FLUX.3 Klein": "通常版。じっくり作る(50 ステップ)・CFG・ネガティブが効く",
    "FLUX.3 Klein Distilled": "蒸留版。速い(16 ステップ)・CFG は 1 固定",
    "Wan2.2 14B": "高品質・遅い(High / Low の 2 モデル)",
    "Wan2.2 5B": "軽い(1 モデル)",
    "LTX-2.5": "音声も一緒に作る・蒸留版で速い",
    "Kandinsky 6": "音声も一緒に作る・追加ノード kandinsky6 が必要",
    "HeartMuLa": "スタイルと歌詞から歌入りの曲を作る(最長 4 分)",
    "ACE-Step 1.5": "曲の説明と歌詞から曲を作る・速い(Turbo は 8 ステップ)",
    "Qwen3-TTS": "テキスト読み上げ・声を文章で指定・ボイスクローン(10 言語)",
    "RVC": "ボイスチェンジ: 音声の声を、RVC で学習した声に変える(Qwen3-TTS の結果にも使える)",
    "LatentSync 1.6": "リップシンク: 動画の人物の口の動きを音声に合わせて作り直す",
    "SenseNova-U1.6": "文章で細かく書く・参照画像 10 枚までで編集・追加ノード ComfyUI-SenseNova-U1 が必要",
    "TRELLIS.2": "画像 1 枚から、色付きの 3D モデル(GLB)を作る",
}
TURBO_NOTE = "{base} を少ないステップで速く(Turbo LoRA が必要)"


def _build_types():
    types, order = {}, []
    for base, b in BASES.items():
        info = dict(BASE_DEFAULT_FLAGS)
        info.update(b)
        info.update(base=base, name=base, is_turbo=False)
        # family: プリセット・標準ファイル・使い方をまとめる単位(FLUX.2 Klein 4B / 9B / Base など)
        info["family"] = b.get("family") or base
        types[base] = info
        order.append(base)
        if b.get("turbo"):
            t = dict(info)
            t.update(name=base + " Turbo", is_turbo=True)
            types[t["name"]] = t
            order.append(t["name"])
    return types, order


TYPE_INFO, MODEL_TYPES = _build_types()
for _t, _i in TYPE_INFO.items():
    _i["note"] = TURBO_NOTE.format(base=_i["base"]) if _i["is_turbo"] else TYPE_NOTES.get(_t, "")


def layout_kind(model_type, task):
    """枠(バウンディングボックス)で配置を指定できるなら "flux3" / "moss"、できなければ None"""
    info = TYPE_INFO.get(model_type)
    native = (info or {}).get("layout", {}).get(task) if info else None
    if native:
        return native
    from .regional import adv_supported  # 専用の枠が無い対象モデルは、枠を 領域プロンプト の領域に使う
    return "region" if adv_supported(model_type, task) else None
# パネルで選べる種別(hidden のもの = MiniMax は、ワークフローには残すが一覧に出さない)
VISIBLE_TYPES = [t for t in MODEL_TYPES if not TYPE_INFO[t]["hidden"]]

# ---------------------------------------------------------------------------
# ファイル名の既定値
#   文字列     = 元ワークフロー/MEMO にあった名前。見つからなくてもその名前のまま表示する
#                (何を置けばよいか分かるように)。拡張子は無ければ .safetensors を補う
#   Hint(...) = 公式の配布名などから探す。見つからなければ (none)
# ---------------------------------------------------------------------------


class Hint:
    """ファイル名の条件。fallback = 見つからないときに既定値として出す名前(「見つかりません」と入手先を案内するため)
    path=True: ファイル名だけでなくフォルダ名も含めて探す(Kandinsky 6 のように
    「フォルダ名/transformer/diffusion_pytorch_model.safetensors」で配られるもの)"""
    def __init__(self, *all_tokens, exclude=(), fallback=None, path=False):
        self.all = [t.lower() for t in all_tokens]
        self.exclude = [t.lower() for t in exclude]
        self.fallback = fallback
        self.path = path

    def match(self, filename):
        f = filename.replace("\\", "/").lower()
        b = f if self.path else f.rsplit("/", 1)[-1]
        return all(t in b for t in self.all) and not any(t in b for t in self.exclude)


UMT5 = "umt5_xxl_fp8_e4m3fn_scaled"
QWEN_VAE = "qwen_image_vae"
# MiniMax H3 Turbo LoRA(lightx2v/Minimax-h3-Turbo の ComfyUI 用 8 ステップ版)。持っている版があればそれを使い、
# 無ければ配布元のおすすめ(fl2v v1.2 768p / ref2v v1.1 768p)を出す。参照画像→動画は ref2v 用の LoRA
MINIMAX_H3_TURBO = Hint("minimax_h3", "fl2v", "turbo", "8step", "comfyui",
                        fallback="minimax_h3_fl2v_turbo_8step_v1.2_768p_comfyui_bf16")
MINIMAX_H3_REF_TURBO = Hint("minimax_h3", "ref2v", "turbo", "8step", "comfyui",
                            fallback="minimax_h3_ref2v_turbo_8step_v1.1_768p_comfyui_bf16")
# MiniMax-H3-Image Turbo: pDMD 2 ステップ LoRA(akhaliq/minimax-h3-image-pdmd-2step の ComfyUI 用)。
# 配布元の手順: 強度 1.0 / 2 steps / euler / simple / CFG なし / シフト 12(MiniMaxH3SigmaShift)
MINIMAX_IMAGE_TURBO = Hint("minimax_h3", "pdmd", fallback="minimax_h3_pdmd_2nfe_comfyui")

# 種別ごと(全タスク共通)の既定値
TYPE_DEFAULTS = {
    "MOSS": dict(
        unet_name="moss_image_sft_int8_convrot", clip_name="qwen3.5_9b_w4a8_gptq",
        clip_type="moss_image", vae_name="flux2-vae_small",
    ),
    "MOSS Turbo": dict(
        unet_name="moss_image_sft_int8_convrot", clip_name="qwen3.5_9b_w4a8_gptq",
        clip_type="moss_image", vae_name="flux2-vae_small",
        turbo_lora_name="8-steps-dmd-lora", turbo_lora_strength=1.0,
    ),
    "SD1.5": dict(ckpt_name=NONE),
    "SDXL": dict(ckpt_name=NONE),
    # 元ワークフローのチェックポイント欄に入っていたもの
    "Illustrious": dict(ckpt_name="CMAnimaZ2"),
    "Anima": dict(
        unet_name=Hint("anima", exclude=("lora", "vae")), clip_name="qwen_3_06b_base",
        clip_type="stable_diffusion", vae_name=QWEN_VAE,
    ),
    "Krea2": dict(
        unet_name="Krea2cocoamix3", clip_name="qwen3vl_4b_fp8_scaled",
        clip_type="krea2", vae_name=QWEN_VAE,
        # ComfyUI-Krea2-Forge-UI の指定(初期状態は無効・強度 0.72)
        loras=[dict(name="krea2cocoasketch_dataset", strength=0.72, on=False)],
    ),
    "Qwen Image": dict(
        clip_name="qwen_2.5_vl_7b_fp8_scaled", clip_type="qwen_image", vae_name=QWEN_VAE,
    ),
    "Qwen Image Turbo": dict(
        clip_name="qwen_2.5_vl_7b_fp8_scaled", clip_type="qwen_image", vae_name=QWEN_VAE,
    ),
    # FLUX.2 Klein: 公式テンプレートのファイル名(Comfy-Org/flux2-klein-4B・9B / black-forest-labs/FLUX.2-klein-*)
    "FLUX.2 Klein 4B": dict(
        unet_name="flux-2-klein-4b-fp8", clip_name="qwen_3_4b", clip_type="flux2", vae_name="flux2-vae"),
    "FLUX.2 Klein 4B Base": dict(
        unet_name="flux-2-klein-base-4b-fp8", clip_name="qwen_3_4b", clip_type="flux2", vae_name="flux2-vae"),
    "FLUX.2 Klein 9B": dict(
        unet_name="flux-2-klein-9b-fp8", clip_name="qwen_3_8b_fp8mixed", clip_type="flux2", vae_name="flux2-vae"),
    "FLUX.2 Klein 9B Base": dict(
        unet_name="flux-2-klein-base-9b-fp8", clip_name="qwen_3_8b_fp8mixed", clip_type="flux2", vae_name="flux2-vae"),
    # FLUX.3 Klein: black-forest-labs/flux-3-image-klein-comfy(テンプレートは int8 版)
    "FLUX.3 Klein": dict(
        unet_name="flux3-image-klein-base-int8-convrot", clip_name="qwen3vl_4b_int8_convrot",
        clip_type="flux3", vae_name="flux2-vae"),
    "FLUX.3 Klein Distilled": dict(
        unet_name="flux3-image-klein-int8-convrot", clip_name="qwen3vl_4b_int8_convrot",
        clip_type="flux3", vae_name="flux2-vae"),
    # LTX-2.5: Lightricks/LTX-2.5(テンプレート video_ltx2_5_* のファイル名)
    "LTX-2.5": dict(
        unet_name="ltx-2.5-22b-distilled-transformer-comfy-int8-convrot",
        clip_name="gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot", clip_type="ltxv",
        vae_name="ltx-2.5-video-vae-bf16", audio_vae_name="ltx-2.5-audio-vae-bf16",
        latent_upscale_name="ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0"),
    # Kandinsky 6: kandinskylab/kandinsky-6 の ComfyUI 版(Pro distill 5s)。音声 VAE は追加ノードの決まった場所から読む
    "Kandinsky 6": dict(
        unet_name=Hint("kandinsky-6", "distill", exclude=("lite",), path=True,
                       fallback="Kandinsky-6.0-Pro-distill-5s-Diffusers/transformer/diffusion_pytorch_model"),
        clip_name="qwen_2.5_vl_7b", clip_name_2="clip_l", vae_name="hunyuan_video_vae_bf16"),
    "MiniMax-H3-Image": dict(
        unet_name=Hint("minimax", "h3", "image", exclude=("vae", "lora", "pdmd")),
        clip_name="qwen3vl_32b_minimax_h3_int8_convrot", clip_type="minimax",
        vae_name="minimax_h3_image_vae_fp16",
    ),
    "MiniMax-H3-Image Turbo": dict(
        unet_name=Hint("minimax", "h3", "image", exclude=("vae", "lora", "pdmd")),
        clip_name="qwen3vl_32b_minimax_h3_int8_convrot", clip_type="minimax",
        vae_name="minimax_h3_image_vae_fp16",
        turbo_lora_name=MINIMAX_IMAGE_TURBO, turbo_lora_strength=1.0,
    ),
    "Wan2.2 14B": dict(clip_name=UMT5, clip_type="wan", vae_name="wan_2.1_vae"),
    "Wan2.2 14B Turbo": dict(clip_name=UMT5, clip_type="wan", vae_name="wan_2.1_vae"),
    "Wan2.2 5B": dict(
        unet_name=Hint("wan2.2", "5b", exclude=("lora", "vae")),
        clip_name=UMT5, clip_type="wan", vae_name="wan2.2_vae",
    ),
    "Wan2.2 5B Turbo": dict(
        unet_name=Hint("wan2.2", "5b", exclude=("lora", "vae")),
        clip_name=UMT5, clip_type="wan", vae_name="wan2.2_vae",
        # FastWan(FastVideo の 3 ステップ蒸留)を LoRA にしたもの(Kijai/WanVideo_comfy の FastWan フォルダ)
        turbo_lora_name=Hint("fastwan", "5b", exclude=("vae",), fallback="Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16"),
    ),
    "MiniMax H3": dict(
        unet_name=Hint("minimax", "h3", exclude=("image", "vae", "lora", "audio")),
        clip_name="qwen3vl_32b_minimax_h3_nvfp4_awq", clip_type="minimax",
        vae_name="minimax_h3_video_vae_int8_convrot", audio_vae_name="minimax_h3_audio_vae_fp32",
    ),
    "MiniMax H3 Turbo": dict(
        unet_name=Hint("minimax", "h3", exclude=("image", "vae", "lora", "audio")),
        clip_name="qwen3vl_32b_minimax_h3_nvfp4_awq", clip_type="minimax",
        vae_name="minimax_h3_video_vae_int8_convrot", audio_vae_name="minimax_h3_audio_vae_fp32",
    ),
}


def _p(steps, cfg, sampler, scheduler, denoise, width, height, **extra):
    d = dict(steps=steps, cfg=cfg, sampler_name=sampler, scheduler=scheduler,
             denoise=denoise, width=width, height=height)
    d.update(extra)
    return d


MOSS_EDIT_LORA = "moss_image_edit_lora_rank_64_bf16"
WAN14_UNETS = {
    "T2V": dict(wan_high_unet="wan2.2_t2v_high_noise_14B_fp8_scaled",
                wan_low_unet="wan2.2_t2v_low_noise_14B_fp8_scaled"),
    "I2V": dict(wan_high_unet="wan2.2_i2v_high_noise_14B_fp8_scaled",
                wan_low_unet="wan2.2_i2v_low_noise_14B_fp8_scaled"),
}
# 見つからないときは ComfyUI 公式テンプレートのファイル名(Comfy-Org/Wan_2.2_ComfyUI_Repackaged の loras)を出す
WAN14_TURBO_LORAS = {
    "T2V": dict(turbo_lora_name=Hint("wan2.2", "t2v", "4step", "high", fallback="wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise"),
                turbo_lora_low_name=Hint("wan2.2", "t2v", "4step", "low", fallback="wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise")),
    "I2V": dict(turbo_lora_name=Hint("wan2.2", "i2v", "4step", "high", fallback="wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise"),
                turbo_lora_low_name=Hint("wan2.2", "i2v", "4step", "low", fallback="wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise")),
}

# 種別+タスクごとの既定値
TASK_DEFAULTS = {
    # MOSS(SFT・Turbo LoRA なし): MEMO に通常版 T2I の値が無いため、公式推奨(euler / 50 steps / CFG 3)
    "MOSS": {
        "T2I": _p(50, 3.0, "euler", "simple", 1.0, 1024, 1024),
        "I2I": _p(30, 4.0, "euler", "normal", 1.0, 1024, 1024,
                  edit_lora_name=MOSS_EDIT_LORA, edit_lora_strength=1.0),
    },
    # MOSS Turbo: MEMO の [MOSS T2I](8-steps-dmd-lora 使用時の値)
    "MOSS Turbo": {
        "T2I": _p(8, 1.0, "er_sde", "simple", 1.0, 1024, 1024),
        "I2I": _p(8, 1.0, "er_sde", "simple", 1.0, 1024, 1024,
                  edit_lora_name=MOSS_EDIT_LORA, edit_lora_strength=1.0),
    },
    "SD1.5": {
        "T2I": _p(20, 7.0, "euler", "normal", 1.0, 512, 512),
        "I2I": _p(20, 7.0, "euler", "normal", 0.6, 512, 512),
    },
    "SDXL": {
        "T2I": _p(30, 7.0, "euler", "normal", 1.0, 1024, 1024),
        "I2I": _p(30, 7.0, "euler", "normal", 0.6, 1024, 1024),
    },
    "Illustrious": {
        "T2I": _p(28, 5.0, "euler_ancestral", "normal", 1.0, 1024, 1024),
        "I2I": _p(28, 5.0, "euler_ancestral", "normal", 0.6, 1024, 1024),
    },
    "Anima": {
        "T2I": _p(30, 4.0, "er_sde", "simple", 1.0, 1024, 1024),
        "I2I": _p(30, 4.0, "er_sde", "simple", 0.6, 1024, 1024),
    },
    "Krea2": {
        "T2I": _p(8, 1.0, "er_sde", "simple", 1.0, 1024, 1024),
        "I2I": _p(8, 1.0, "er_sde", "simple", 0.6, 1024, 1024),
    },
    "Qwen Image": {
        "T2I": _p(20, 2.5, "euler", "simple", 1.0, 1024, 1024,
                  unet_name=Hint("qwen_image", exclude=("edit", "vae", "lora", "vl"))),
        "I2I": _p(20, 2.5, "euler", "simple", 1.0, 1024, 1024,
                  unet_name=Hint("qwen_image_edit", exclude=("vae", "lora"))),
    },
    # Qwen Image Turbo: Lightning 8-step LoRA の推奨(8 steps / CFG 1)
    "Qwen Image Turbo": {
        "T2I": _p(8, 1.0, "euler", "simple", 1.0, 1024, 1024,
                  unet_name=Hint("qwen_image", exclude=("edit", "vae", "lora", "vl")),
                  turbo_lora_name=Hint("qwen", "image", "lightning", "8step", exclude=("edit",),
                                       fallback="Qwen-Image-Lightning-8steps-V1.1")),
        "I2I": _p(8, 1.0, "euler", "simple", 1.0, 1024, 1024,
                  unet_name=Hint("qwen_image_edit", exclude=("vae", "lora")),
                  turbo_lora_name=Hint("qwen", "edit", "lightning", "8step",
                                       fallback="Qwen-Image-Edit-Lightning-8steps-V1.0")),
    },
    # FLUX.2 Klein: 公式テンプレート(蒸留版 4 ステップ・CFG 1 / Base 20 ステップ・CFG 5、euler、Flux2Scheduler)
    **{name: {t: _p(steps, cfg, "euler", "simple", 1.0, 1024, 1024) for t in ("T2I", "I2I")}
       for name, steps, cfg in (("FLUX.2 Klein 4B", 4, 1.0), ("FLUX.2 Klein 4B Base", 20, 5.0),
                                ("FLUX.2 Klein 9B", 4, 1.0), ("FLUX.2 Klein 9B Base", 20, 5.0))},
    # FLUX.3 Klein: 公式テンプレート(テキスト→画像 50 ステップ・CFG 3.5 / 画像編集 50 ステップ・CFG 1、euler / simple)
    "FLUX.3 Klein": {
        "T2I": _p(50, 3.5, "euler", "simple", 1.0, 1024, 1024),
        "I2I": _p(50, 1.0, "euler", "simple", 1.0, 1024, 1024),
    },
    # FLUX.3 Klein Distilled: 16 ステップ(4〜16)・CFG 1 固定
    "FLUX.3 Klein Distilled": {t: _p(16, 1.0, "euler", "simple", 1.0, 1024, 1024) for t in ("T2I", "I2I")},
    # LTX-2.5: 24fps・5 秒(121 フレーム)。テンプレートは 1280 x 720 だが、半分の大きさ(640 x 360)で作る段階で
    # 高さが 32 の倍数に切り下げられ、出来上がりは 1280 x 704 になるため、その大きさを既定にする。
    # ステップ・CFG はテンプレートの固定値なので欄は出さない
    "LTX-2.5": {t: _p(8, 1.0, "euler_ancestral", "simple", 1.0, 1280, 704) for t in ("T2V", "I2V")},
    # Kandinsky 6(Pro distill): 864 x 480・121 フレーム・24fps・10 ステップ・CFG 1
    "Kandinsky 6": {t: _p(10, 1.0, "euler", "simple", 1.0, 864, 480) for t in ("T2V", "I2V")},
    # MiniMax-H3-Image: MEMO(6 steps / CFG 1 / Conditioning 3104 x 3104)
    "MiniMax-H3-Image": {
        "T2I": _p(6, 1.0, "euler", "simple", 1.0, 3104, 3104),
        "I2I": _p(6, 1.0, "euler", "simple", 1.0, 3104, 3104, auto_image_size=True),
    },
    # MiniMax-H3-Image Turbo: pDMD 2 ステップ LoRA の手順(2 steps / euler / simple)
    "MiniMax-H3-Image Turbo": {
        "T2I": _p(2, 1.0, "euler", "simple", 1.0, 3104, 3104),
        "I2I": _p(2, 1.0, "euler", "simple", 1.0, 3104, 3104, auto_image_size=True),
    },
    # Wan2.2 14B: MEMO(20 steps / CFG 3.5 / High→Low の切替は steps の半分)
    "Wan2.2 14B": {
        t: _p(20, 3.5, "euler", "simple", 1.0, 1024, 1024, **WAN14_UNETS[t]) for t in ("T2V", "I2V")
    },
    # Wan2.2 14B Turbo: lightx2v 4-step LoRA の推奨(4 steps = High 2 + Low 2 / CFG 1)
    "Wan2.2 14B Turbo": {
        t: _p(4, 1.0, "euler", "simple", 1.0, 1024, 1024, **WAN14_UNETS[t], **WAN14_TURBO_LORAS[t])
        for t in ("T2V", "I2V")
    },
    "Wan2.2 5B": {
        t: _p(20, 5.0, "uni_pc", "simple", 1.0, 1280, 704) for t in ("T2V", "I2V")
    },
    # Wan2.2 5B Turbo: FastWan LoRA。公開ワークフロー(CivArchive「wan 22 5b i2v workflow」)の 4〜6 steps / CFG 1 から 6 steps。
    # サンプラーは公開情報に無いため euler / simple(Wan2.2 のワークフローで一般的なもの)
    "Wan2.2 5B Turbo": {
        t: _p(6, 1.0, "euler", "simple", 1.0, 1280, 704) for t in ("T2V", "I2V")
    },
    # MiniMax H3: MEMO(res_multistep / simple / T2V 20・I2V 20・R2V 25 / 1344 x 768)。CFG は不使用
    "MiniMax H3": {
        "T2V": _p(20, 1.0, "res_multistep", "simple", 1.0, 1344, 768),
        "I2V": _p(20, 1.0, "res_multistep", "simple", 1.0, 1344, 768),
        "R2V": _p(25, 1.0, "res_multistep", "simple", 1.0, 1344, 768),
    },
    # MiniMax H3 Turbo: MEMO の Turbo LoRA 8-step(strength 1)
    "MiniMax H3 Turbo": {
        t: _p(8, 1.0, "res_multistep", "simple", 1.0, 1344, 768,
              turbo_lora_name=MINIMAX_H3_REF_TURBO if t == "R2V" else MINIMAX_H3_TURBO)
        for t in ("T2V", "I2V", "R2V")
    },
}

# 動画の長さ(フレーム数)と fps の既定値(元のワークフローの値)。MiniMax H3 は音声が 24fps 前提のため fps は固定
# 第42版: 声・音楽。ACE-Step 1.5 はテンプレート「Text to Audio (ACE-Step 1.5)」のファイルと値(8 ステップ・CFG 1・euler・simple)、
# LatentSync はノードの既定値(20 ステップ・リップシンクの強さ 1.5)、HeartMuLa はノードの既定値(CFG 1.5)。使わない値は画像と同じ形で持つだけ
# SenseNova-U1.6: 追加ノードの読み込み方の名前(HF | Hugging Face の名前 / Local | models/sensenova の中)
SN_DEFAULT = "HF | sensenova/SenseNova-U1.6-8B-MoT"
SN_CORE_INT8 = "Core | sensenova_u1.6_8b_mot_int8_convrot.safetensors"  # ComfyUI 本体のノードで使うモデル(models/checkpoints)
SN_PE_CLIP = "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot"  # プロンプト書き直し(PE)用のテキストエンコーダー(テキスト→画像用)
SN_PE_CLIP_I2I = "qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot"  # 同(画像→画像用)。生成するときに、タスクに合う方へ自動で切り替える
# 軽い版(GGUF。選んだ 1 ファイルだけ models/sensenova に自動でダウンロードする。LoRA・Turbo とは一緒に使えない)
SN_LIGHT = [f"HF | sensenova/SenseNova-U1.6-8B-MoT-GGUF/SenseNova-U1.6-8B-MoT-{q}.gguf" for q in ("Q8_0", "Q6_K", "Q4_0")]
TYPE_DEFAULTS.update({
    "SenseNova-U1.6": dict(unet_name=SN_DEFAULT, clip_name=SN_PE_CLIP),
    # SenseNova-U1.6 Turbo: ComfyUI 本体のノードで動かす組み合わせ(Comfy-Org/SenseNova-U1 の int8 モデル + 8 ステップ LoRA)。自己修正も使える
    "SenseNova-U1.6 Turbo": dict(unet_name=SN_CORE_INT8, clip_name=SN_PE_CLIP, turbo_lora_strength=1.0, sn_passes=2,
                                 turbo_lora_name=Hint("sensenova_u1.6", "8step", "lora", exclude=("comfyui",),
                                                      fallback="sensenova_u1.6_8b_mot_8step_lora_bf16")),
    # TRELLIS.2: ComfyUI 同梱のテンプレートのファイル(Comfy-Org/TRELLIS.2・Comfy-Org/Pixal3D・Comfy-Org/BiRefNet)
    "TRELLIS.2": dict(unet_name="trellis_2_int8_convrot", vae_name="trellis_2_shape_vae_bf16",
                      audio_vae_name="trellis_2_texture_vae_bf16", clip_name="dino_v3_L_naf_fp32", clip_name_2="birefnet"),
    "ACE-Step 1.5": dict(unet_name="acestep_v1.5_turbo", clip_name="qwen_0.6b_ace15", clip_name_2="qwen_4b_ace15",
                         clip_type="ace", vae_name="ace_1.5_vae"),
})
TASK_DEFAULTS.update({
    "Qwen3-TTS": {t: _p(1, 1.0, "euler", "simple", 1.0, 512, 512) for t in ("TTS", "TTD", "TTC")},
    "RVC": {"VC": _p(1, 1.0, "euler", "simple", 1.0, 512, 512)},
    "LatentSync 1.6": {"LIP": _p(20, 1.5, "euler", "simple", 1.0, 512, 512)},
    "HeartMuLa": {"T2M": _p(1, 1.5, "euler", "simple", 1.0, 512, 512)},
    "ACE-Step 1.5": {"T2M": _p(8, 1.0, "euler", "simple", 1.0, 512, 512)},
    # SenseNova-U1.6: 追加ノードの既定値(50 ステップ・CFG 4・2048 x 2048)
    "SenseNova-U1.6": {t: _p(50, 4.0, "euler", "simple", 1.0, 2048, 2048) for t in ("T2I", "I2I")},
    # SenseNova-U1.6 Turbo: 配布元の説明(ステップは LoRA に合わせる = 8、LoRA の強度と CFG は 1.0)
    "SenseNova-U1.6 Turbo": {t: _p(8, 1.0, "euler", "simple", 1.0, 2048, 2048) for t in ("T2I", "I2I")},
    # TRELLIS.2: ステップ・CFG はテンプレートの固定値(欄は出さない)
    "TRELLIS.2": {"I23D": _p(12, 7.5, "euler", "normal", 1.0, 1024, 1024)},
})

VIDEO_DEFAULTS = {"Wan2.2 14B": (81, 16), "Wan2.2 5B": (121, 24), "MiniMax H3": (124, 24),
                  # LTX-2.5: 5 秒 × 24fps + 1 / Kandinsky 6: 121 フレーム・24fps(配布元のワークフロー)
                  "LTX-2.5": (121, 24), "Kandinsky 6": (121, 24)}
# Wan のシフト(ModelSamplingSD3)。ComfyUI 公式テンプレート: 通常 8、Wan2.2 14B の 4 ステップ LoRA(Turbo)は 5
VIDEO_SHIFT = {"Wan2.2 14B": 8.0, "Wan2.2 14B Turbo": 5.0, "Wan2.2 5B": 8.0, "Wan2.2 5B Turbo": 8.0}
for _name, _tasks in TASK_DEFAULTS.items():
    _base = _name[:-len(" Turbo")] if _name.endswith(" Turbo") else _name
    if _base in VIDEO_DEFAULTS:
        for _vals in _tasks.values():
            _vals.setdefault("video_length", VIDEO_DEFAULTS[_base][0])
            _vals.setdefault("video_fps", VIDEO_DEFAULTS[_base][1])
            if _name in VIDEO_SHIFT:
                _vals.setdefault("video_shift", VIDEO_SHIFT[_name])

COMMON_TYPE_DEFAULTS = dict(
    unet_name=NONE, unet_dtype=None, ckpt_name=NONE, clip_name=NONE, clip_type=None,
    clip_device=None, vae_name=NONE, audio_vae_name=NONE, clip_name_2=NONE, latent_upscale_name=NONE,
    loras=[],
    turbo_lora_name=NONE, turbo_lora_strength=1.0, turbo_lora_low_name=NONE,
    audio_opts="{}", sn_passes=0, sn_pe=False, vram_mode=VRAM_AUTO,
)
COMMON_TASK_DEFAULTS = dict(
    wan_high_unet=NONE, wan_low_unet=NONE, edit_lora_name=NONE, edit_lora_strength=1.0,
    auto_image_size=False, edit_format=EDIT_FORMAT_AUTO, ref_size=REF_SIZE_AUTO, mid_frame_pos=50,
    size_mode=SIZE_MODE_KEEP, size_scale=1.0, video_length=81, video_fps=16, resize_mode=RESIZE_KEEP,
    video_shift=8.0,
    hires_enable=False, hires_upscaler="Lanczos", hires_scale=1.5, hires_steps=0,
    hires_denoise=0.45, hires_cfg=0.0,
)

# ---------------------------------------------------------------------------
# 前回設定として保存する項目
# 種別ごと(タスク共通)= TYPE_KEYS / 種別+タスクごと = TASK_KEYS
# 種別によっては一部の項目をタスクごとに保存する(BASES の task_scoped)
# プロンプト・Seed・入力画像・出力先は保存しない(プロンプトはプリセットで扱う)
# ---------------------------------------------------------------------------
TYPE_KEYS = [
    "unet_name", "unet_dtype", "ckpt_name", "clip_name", "clip_type", "clip_device",
    "vae_name", "audio_vae_name", "loras",
    "turbo_lora_name", "turbo_lora_strength", "turbo_lora_low_name",
    "clip_name_2", "latent_upscale_name",
    # 第42版: 音楽・音声の設定(JSON。種別ごとに覚える)
    "audio_opts",
    "sn_passes", "sn_pe",
    "vram_mode",
]
TASK_KEYS = [
    "wan_high_unet", "wan_low_unet", "edit_lora_name", "edit_lora_strength",
    "steps", "cfg", "sampler_name", "scheduler", "denoise", "width", "height",
    "auto_image_size", "edit_format", "ref_size", "mid_frame_pos", "size_mode", "size_scale",
    "video_length", "video_fps", "resize_mode", "video_shift",
    "hires_enable", "hires_upscaler", "hires_scale", "hires_steps", "hires_denoise", "hires_cfg",
]
ALL_WIDGETS = [
    "model_type", "task", "positive", "negative",
    "unet_name", "unet_dtype", "ckpt_name", "clip_name", "clip_type", "clip_device",
    "vae_name", "audio_vae_name", "wan_high_unet", "wan_low_unet",
    "loras",
    "turbo_lora_name", "turbo_lora_strength", "turbo_lora_low_name",
    "edit_lora_name", "edit_lora_strength", "edit_format", "ref_size",
    "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise",
    "width", "height", "auto_image_size", "size_mode", "size_scale", "resize_mode", "video_length", "video_fps",
    "video_shift",
    "hires_enable", "hires_upscaler", "hires_scale", "hires_steps", "hires_denoise", "hires_cfg",
    "image", "image_2", "image_3", "mid_frame_pos", "image_output_prefix", "video_output_prefix",
    # 第9版で追加(既存の並びを変えないよう末尾)
    "clip_name_2", "latent_upscale_name",
] + IMAGE_WIDGETS[3:] + [
    # 第10版で追加: 枠(バウンディングボックス)で指定した配置(JSON)
    "layout_boxes",
    # 第42版で追加: 音楽・音声の設定(JSON)と音声の保存先
    "audio_opts", "audio_output_prefix",
    # マイナス重み 相当 / 領域プロンプト 相当(対応する種別・T2I だけ表示)
    "negw_enable", "negw_strength", "regional_enable", "regional_mode", "regional_ratio",
    "regional_common", "regional_prompts", "regional_negatives", "regional_crop", "regional_switch", "layout_native",
    "negw_preset", "negw_method", "negw_turbo_gain", "regional_feather", "regional_margin", "regional_preset",
    # SenseNova-U1.6 の自己修正(最大回数。0 で使わない)
    "sn_passes", "sn_pe",
    # VRAM の補い方(自動 / full / fast / balanced / low)
    "vram_mode",
]

LABELS = {
    "model_type": "モデル種別", "task": "タスク",
    "positive": "プロンプト", "negative": "ネガティブプロンプト",
    "unet_name": "モデル (UNet)", "unet_dtype": "UNet 精度", "ckpt_name": "チェックポイント",
    "clip_name": "テキストエンコーダー", "clip_type": "エンコーダー種別",
    "clip_device": "エンコーダーの実行先", "vae_name": "VAE", "audio_vae_name": "音声 VAE",
    "wan_high_unet": "High-Noise モデル", "wan_low_unet": "Low-Noise モデル",
    "loras": "LoRA(複数可)",
    "turbo_lora_name": "Turbo LoRA ((none)でオフ)", "turbo_lora_strength": "Turbo LoRA 強度",
    "turbo_lora_low_name": "Turbo LoRA (Low-Noise)",
    "edit_lora_name": "Edit LoRA", "edit_lora_strength": "Edit LoRA 強度",
    "edit_format": "Edit 形式(Edit LoRA の学習形式)", "ref_size": "参照画像の大きさ",
    "hires_enable": "Hires. fix を使う", "hires_upscaler": "アップスケーラー", "hires_scale": "拡大率",
    "hires_steps": "Hires ステップ数(0=通常と同じ)", "hires_denoise": "Hires ノイズ除去強度",
    "hires_cfg": "Hires CFG(0=通常と同じ)",
    "seed": "シード", "steps": "ステップ数", "cfg": "CFG", "sampler_name": "サンプラー",
    "scheduler": "スケジューラー", "denoise": "ノイズ除去強度 (Denoise)",
    "width": "幅", "height": "高さ", "auto_image_size": "サイズを入力画像に合わせる",
    "size_mode": "出力サイズ", "size_scale": "倍率(画像1の大きさ × 倍率)", "resize_mode": "サイズの変え方",
    "video_length": "フレーム数(長さ)", "video_fps": "fps(1 秒のコマ数)", "video_shift": "シフト",
    "image": "入力画像1", "image_2": "入力画像2 (任意)", "image_3": "入力画像3 (任意)",
    **{f"image_{i}": f"入力画像{i} (任意)" for i in range(4, MAX_IMAGE_SLOTS + 1)},
    "clip_name_2": "テキストエンコーダー 2(CLIP-L)", "latent_upscale_name": "潜在アップスケーラー",
    "layout_boxes": "枠で配置を指定",
    "negw_enable": "マイナスプロンプトを使う", "negw_strength": "打ち消しの強さ",
    "regional_enable": "範囲別指定を使う", "regional_mode": "区切り方",
    "regional_ratio": "区切りの比率", "regional_common": "各場所のプロンプトの前に、メインのプロンプトを付ける",
    "regional_prompts": "場所ごとのプロンプト", "regional_negatives": "場所ごとのネガティブ",
    "regional_crop": "領域の描き方(使わない)", "regional_switch": "枠の中に収める強さ(%)", "layout_native": "枠を配置の指定として使う",
    "negw_preset": "おすすめ設定", "regional_preset": "おすすめ設定", "negw_method": "マイナスの処理方法", "negw_turbo_gain": "CFG が無いモデルでの倍率",
    "regional_feather": "範囲の縁のぼかし", "regional_margin": "範囲の外側の余白",
    "mid_frame_pos": "途中のフレームの位置(%)",
    "image_output_prefix": "画像の保存先", "video_output_prefix": "動画の保存先", "sn_passes": "自己修正(最大回数・0 で使わない)", "sn_pe": "テキストエンコーダーでプロンプトを書き直す(PE)", "vram_mode": "VRAM の補い方",
    "audio_opts": "音楽・音声の設定", "audio_output_prefix": "音声の保存先",
}


def keys_for(model_type):
    """(種別ごとに保存する項目, 種別+タスクごとに保存する項目)"""
    scoped = TYPE_INFO[model_type]["task_scoped"]
    type_keys = [k for k in TYPE_KEYS if k not in scoped]
    task_keys = TASK_KEYS + [k for k in TYPE_KEYS if k in scoped]
    return type_keys, task_keys


def max_images(model_type, task):
    return TYPE_INFO[model_type]["max_images"].get(task, 0)


def needs_image(task):
    return task in ("I2I", "I2V", "R2V", "I23D")


def image_roles(model_type, task):
    info = TYPE_INFO[model_type]
    if not needs_image(task):
        return ("", "", "")
    roles = tuple(info["image_roles"].get(task, ("入力画像", "")))
    return roles + ("",) * (MAX_IMAGE_SLOTS - len(roles))


def uses_mask(model_type, task):
    return bool(TYPE_INFO[model_type]["mask"].get(task))


def visible_widgets(model_type, task):
    """種別とタスクで表示する項目(それ以外は UI で隠す)。"""
    info = TYPE_INFO[model_type]
    if info["kind"] == "3d":
        # 3D: 入力画像 1 枚・モデルのファイル・シード(手順と値は ComfyUI 同梱のテンプレートと同じ)
        return ["model_type", "task", "image", "unet_name", "vae_name", "audio_vae_name", "clip_name", "clip_name_2", "seed"]
    if info["kind"] == "audio":
        # 第42版: 声・音楽。文の欄・ステップなどは作り方ごと、ほかは「音楽・音声の設定」(audio_opts)
        g = info["gen"]
        v = ["model_type", "task"]
        if g in ("qwen_tts", "heartmula", "ace"):
            v.append("positive")
        if (g == "qwen_tts" and task in ("TTS", "TTD")) or g in ("heartmula", "ace"):
            v.append("negative")
        if g == "ace":
            v += ["unet_name", "unet_dtype", "clip_name", "clip_name_2", "vae_name", "steps", "cfg", "sampler_name", "scheduler"]
        elif g == "latentsync":
            v += ["steps", "cfg"]
        elif g == "heartmula":
            v.append("cfg")
        v += ([] if g == "rvc" else ["seed"]) + ["audio_opts", "audio_output_prefix", "image_output_prefix", "video_output_prefix"]
        return v
    v = ["model_type", "task", "positive"]
    if info["negative"]:
        v.append("negative")

    loader = info["loader"]
    if loader == "ckpt":
        v += ["ckpt_name", "loras"]
    elif loader == "unet":
        v += ["unet_name", "unet_dtype", "clip_name", "clip_type", "clip_device",
              "vae_name", "loras"]
    elif loader == "k6":  # Kandinsky 6: テキストエンコーダー 2 本(種類は kandinsky5 固定)
        v += ["unet_name", "unet_dtype", "clip_name", "clip_name_2", "clip_device", "vae_name", "loras"]
    elif loader == "sn":  # SenseNova-U1.6: モデル(追加ノードの読み込み方)と LoRA 1 つ・自己修正の回数
        v += ["unet_name", "loras", "sn_passes"]
        v += ["sn_pe", "clip_name"]  # テキストエンコーダー(PE)の ON/OFF と、ファイルの選択(テキスト→画像・画像→画像のどちらも)
    else:  # wan14
        v += ["wan_high_unet", "wan_low_unet", "unet_dtype", "clip_name", "clip_type",
              "clip_device", "vae_name", "loras"]
    v.append("vram_mode")  # SenseNova も含む(画面ではベースモデルの欄のすぐ右に出る)
    if info["audio_vae"]:
        v.append("audio_vae_name")
    if info["latent_upscale"]:
        v.append("latent_upscale_name")
    if info["is_turbo"]:
        v += ["turbo_lora_name", "turbo_lora_strength"]
        if loader == "wan14":
            v.append("turbo_lora_low_name")
    if info["base"] == "MOSS" and task == "I2I":
        v += ["edit_lora_name", "edit_lora_strength", "edit_format", "ref_size"]

    v.append("seed")
    if info["steps"]:
        v.append("steps")
    if info["cfg"]:
        v.append("cfg")
    if info["sampler"]:
        v += ["sampler_name", "scheduler"]
    if info["denoise"]:
        v.append("denoise")

    uses_size = task != "I2I" or info["auto_size_i2i"]
    if uses_size:
        v += ["width", "height"]
    if task == "I2I" and info["auto_size_i2i"]:
        v.append("auto_image_size")
    if scale_supported(model_type, task):
        v += ["size_mode", "size_scale"]
    if resize_supported(model_type, task):
        v += ["resize_mode"] + [k for k in ("width", "height") if k not in v]
    if info["kind"] == "video":
        v.append("video_length")
        if not info["fixed_fps"]:
            v.append("video_fps")
        if info["base"].startswith("Wan2.2"):
            v.append("video_shift")
    if hires_supported(model_type, task):
        v += ["hires_enable", "hires_upscaler", "hires_scale", "hires_steps", "hires_denoise", "hires_cfg"]

    if needs_image(task):
        v += IMAGE_WIDGETS[:max(1, max_images(model_type, task))]
    if info["mid_frame"] and max_images(model_type, task) >= 3:
        v.append("mid_frame_pos")
    if layout_kind(model_type, task):
        v.append("layout_boxes")
    if layout_kind(model_type, task) in ("moss", "flux3"):
        v.append("layout_native")  # 専用の枠の書き方があるモデルだけ
    from .regional import adv_supported  # 対応する種別(Anima / MOSS / Krea2 / Illustrious / FLUX.3 / FLUX.2 / SDXL / SD1.5)だけ
    if adv_supported(model_type, task):
        # 範囲別指定は枠だけで指定する(regional_mode / ratio / prompts / negatives は、保存済みのワークフローとの互換のため
        # ノードには残すが、画面には出さず使わない)
        v += ["negw_preset", "negw_enable", "negw_method", "negw_strength", "negw_turbo_gain", "regional_enable", "regional_preset", "regional_common",
              "regional_switch", "regional_feather", "regional_margin"]
    # 保存先は両方出す(編集した画像・動画、パネルや編集画面に入れた画像・動画も、ここに保存する)
    v += ["image_output_prefix", "video_output_prefix"]
    return v


def full_mask_if_empty(model_type, task):
    return bool(TYPE_INFO[model_type]["full_mask_if_empty"].get(task))


def ref_max_edge_enabled(model_type, task):
    return bool(TYPE_INFO[model_type]["ref_max_edge"].get(task))


def scale_supported(model_type, task):
    """「倍率指定」(画像1 × 倍率)を使えるタスク: 画像→画像・画像→動画"""
    return task in ("I2I", "I2V") and max_images(model_type, task) >= 1


def resize_supported(model_type, task):
    """画像→画像で幅・高さと変え方(そのまま/切り抜き/余白を埋める)を選べるか。
    MiniMax-H3-Image は元から幅・高さと「サイズを入力画像に合わせる」があるので対象外"""
    return task == "I2I" and max_images(model_type, task) >= 1 and not TYPE_INFO[model_type]["auto_size_i2i"]


def size_step(model_type):
    """幅・高さを丸める単位。動画と MiniMax 系は 32(ノードの指定)、それ以外は 16。
    LTX-2.5 は半分の大きさで生成してから 2 倍にするため 64、Kandinsky 6 はノードの指定どおり 16"""
    info = TYPE_INFO[model_type]
    if info["base"] == "LTX-2.5":
        return 64
    if info["base"] == "Kandinsky 6":
        return 16
    if info["base"] == "SenseNova-U1.6":
        return 32
    return 32 if info["kind"] == "video" or info["base"].startswith("MiniMax") else 16


def hires_supported(model_type, task):
    """Hires. fix は Forge と同じくテキスト→画像のみ。"""
    return bool(TYPE_INFO[model_type]["hires"]) and task == "T2I"


def image_names(model_type, task):
    """モデルがプロンプトで認識する画像の呼び名(無ければ入力画像1/2…)。"""
    names = tuple(TYPE_INFO[model_type]["image_names"].get(task, ("入力画像1", "入力画像2")))
    return names + tuple(f"入力画像{i}" for i in range(len(names) + 1, MAX_IMAGE_SLOTS + 1))


# ---------------------------------------------------------------------------
# おすすめプリセット(読み取り専用。選んで「追加」でプロンプトの末尾に足す)
# bases: 対象の基礎モデル / tasks: 対象タスク(空 = 全タスク)
# ---------------------------------------------------------------------------
NEG_ANIME = ("worst quality, low quality, lowres, bad anatomy, bad hands, extra fingers, missing fingers, "
             "jpeg artifacts, signature, watermark, text")
NEG_WAN = ("bright colors, overexposed, static, blurred details, subtitles, worst quality, low quality, "
           "JPEG artifacts, ugly, deformed, extra fingers, poorly drawn hands, poorly drawn face, "
           "still picture, cluttered background, walking backwards")
NEG_QUALITY = "worst quality, low quality, blurry"


def _set(bases, tasks, items, negative=""):
    """(名前, ポジティブ[, ネガティブ]) の並び → プリセット"""
    out = []
    for it in items:
        out.append(dict(name=it[0], bases=bases, tasks=tasks, positive=it[1],
                        negative=it[2] if len(it) > 2 else negative))
    return out


TAG_SET = [  # SD1.5 / SDXL / Illustrious / Anima(タグ形式)
    ("高品質タグ", "masterpiece, best quality, very aesthetic, absurdres, ", NEG_ANIME),
    ("アニメ塗り", "anime coloring, clean lineart, vibrant colors, "),
    ("厚塗り", "thick painting, painterly, detailed shading, "),
    ("水彩", "watercolor (medium), soft colors, paper texture, "),
    ("写実寄り", "realistic, photorealistic, detailed skin, natural lighting, "),
    ("上半身", "upper body, looking at viewer, "),
    ("全身", "full body, standing, "),
    ("街の背景", "outdoors, city street, depth of field, "),
    ("夜・ネオン", "night, neon lights, cinematic lighting, "),
    ("逆光・夕方", "backlighting, rim light, sunset, golden hour, "),
    ("ちびキャラ", "chibi, super deformed, cute, simple background, "),
    ("和風", "japanese clothes, kimono, cherry blossoms, traditional architecture, "),
]
NATURAL_SET = [  # 自然文で書くモデル(MOSS / Krea2 / Qwen Image / MiniMax-H3-Image のテキスト→画像、Krea2 の画像→画像)
    ("写真風", "A photo, soft natural daylight, shallow depth of field, 35mm film look."),
    ("ポートレート", "A close-up portrait, soft studio lighting, detailed skin texture, neutral background."),
    ("アニメイラスト", "An anime-style illustration, clean lineart, vibrant colors, detailed background."),
    ("風景", "A wide landscape photo, dramatic sky, sharp details, golden hour light."),
    ("映画のワンシーン", "A cinematic film still, moody lighting, anamorphic lens, rich color grading."),
    ("水彩画", "A watercolor painting, soft washes of color, paper texture, delicate details."),
    ("3DCG", "A 3D render, soft global illumination, clean materials, studio lighting."),
    ("商品写真", "A product photo on a clean white background, soft shadows, high detail."),
    ("夜の街", "A night city street, neon signs, reflections on wet pavement, cinematic lighting."),
    ("文字入りポスター", 'A poster with the text "TITLE" in bold letters, clean graphic design.'),
    ("ファンタジー", "A fantasy castle on a cliff above the clouds, magical light, epic scale, detailed matte painting."),
    ("ドット絵", "A pixel art scene of a cozy village at sunset, 16-bit retro game style, limited color palette."),
]
MOSS_EDIT_SET = [  # MOSS 画像→画像(画像1だけの編集)
    ("服の色を変える", "Change the color of the clothes to red. Keep everything else unchanged."),
    ("背景を変える", "Change the background to a sunny beach at golden hour, keeping the subject exactly the same."),
    ("笑顔にする", "Make the person smile naturally. Keep everything else unchanged."),
    ("照明を変える", "Relight the scene with warm golden-hour sunlight. Keep the composition unchanged."),
    ("夜にする", "Change the scene to night with soft city lights. Keep the person unchanged."),
    ("髪の色を変える", "Change the hair color to silver. Keep everything else unchanged."),
    ("オブジェクト除去", "Remove the object in the background. Keep everything else unchanged."),
    ("アニメ風にする", "Turn the image into an anime-style illustration. Keep the composition and pose."),
    ("冬にする", "Change the season to winter with light snow. Keep the person unchanged."),
    ("合成を馴染ませる", "Blend the pasted object naturally into the scene, matching the lighting and shadows. Keep everything else unchanged."),
    ("服に文字をプリント", 'Print the text "HELLO" on the center of the T-shirt. Keep the person, pose, lighting and background unchanged.'),
    ("服を着替える", "Change the outfit to a black leather jacket and blue jeans. Keep the face, pose and background unchanged."),
]
QWEN_EDIT_SET = [  # Qwen Image 画像→画像(画像1と画像2を左右に並べて渡す。first / second image で指す)
    ("画像2の服に着替える", "Dress the person in the first image in the clothes from the second image. Keep the identity, pose and background."),
    ("画像2の物を持たせる", "The person in the first image is holding the object from the second image. Keep the person's face, clothes and the background."),
    ("画像2を服にプリント", "Print the second image on the clothes of the person in the first image. High quality."),
    ("画像2の場所に置く", "Place the person from the first image into the scene of the second image. Keep the identity and pose."),
    ("画像2の髪型にする", "Give the person in the first image the hairstyle from the second image. Keep everything else unchanged."),
    ("背景を変える", "Change the background to a sunny beach. Keep the person exactly the same."),
    ("服の色を変える", "Change the color of the clothes to red. Keep everything else unchanged."),
    ("笑顔にする", "Make the person smile naturally. Keep everything else unchanged."),
    ("照明を変える", "Relight the image with warm golden-hour sunlight. Keep the composition unchanged."),
    ("合成を馴染ませる", "Blend the pasted object naturally into the scene, matching the lighting and shadows. Keep everything else unchanged."),
    ("画像2を服の真ん中にプリント", "Print the second image on the center of the clothes of the person in the first image. Keep the person, pose, lighting and background unchanged."),
    ("画像2の柄の服にする", "Change the clothes of the person in the first image to clothes with the pattern from the second image. Keep the person, pose, lighting and background unchanged."),
]
MINIMAX_EDIT_SET = [  # MiniMax-H3-Image 画像→画像(<Picture N> で指す)
    ("画像2の服に着替える", "Edit <Picture 1>: dress the person in the clothes from <Picture 2>. Keep the identity, pose and background."),
    ("画像2の物を持たせる", "Edit <Picture 1>: the person is holding the object from <Picture 2>. Keep the person's face, clothes and the background."),
    ("画像2を服にプリント", "Edit <Picture 1>: print <Picture 2> on the person's clothes. High quality."),
    ("画像2の場所に置く", "Place the person from <Picture 1> into the scene of <Picture 2>. Keep the identity and pose."),
    ("画像2の髪型にする", "Edit <Picture 1>: give the person the hairstyle from <Picture 2>. Keep everything else unchanged."),
    ("背景を変える", "Edit <Picture 1>: change the background to a sunny beach. Keep the person exactly the same."),
    ("服の色を変える", "Edit <Picture 1>: change the color of the clothes to red. Keep everything else unchanged."),
    ("笑顔にする", "Edit <Picture 1>: make the person smile naturally. Keep everything else unchanged."),
    ("照明を変える", "Edit <Picture 1>: relight with warm golden-hour sunlight. Keep the composition unchanged."),
    ("合成を馴染ませる", "Edit <Picture 1>: blend the pasted object naturally into the scene, matching the lighting and shadows."),
]
T2V_SET = [
    ("動画の基本", "Smooth tracking shot, natural daylight, cinematic."),
    ("ゆっくり寄る", "The camera slowly pushes in, soft natural light, cinematic."),
    ("周りを回る", "The camera slowly orbits around the subject, smooth motion."),
    ("歩いてくる", "A person walks toward the camera along a city street, handheld camera, natural light."),
    ("風", "A gentle wind moves the hair and clothes, calm atmosphere."),
    ("振り向く", "A person turns around and smiles at the camera."),
    ("引いていく", "The camera slowly pulls back to reveal the wide scene."),
    ("夜景", "A night city scene with neon lights and light traffic, slow pan."),
    ("雨", "Rain falls softly, reflections on the wet ground, slow camera movement."),
    ("タイムラプス", "Time-lapse of clouds moving over the landscape, golden hour."),
    ("花火", "Fireworks burst over a river at night, reflections on the water, crowd silhouettes, slow pan."),
    ("湯気の立つ料理", "Close-up of steaming hot ramen being served on a wooden counter, steam rising, warm light."),
]
I2V_SET = [
    ("画像を動かす", "The subject moves naturally, a gentle wind, the camera slowly pushes in."),
    ("笑顔になる", "The person smiles and blinks naturally, with subtle head movement."),
    ("手を振る", "The person waves at the camera with a friendly smile."),
    ("振り向く", "The person turns their head toward the camera."),
    ("歩き出す", "The person starts walking forward, the camera follows smoothly."),
    ("髪がなびく", "A gentle breeze moves the hair and clothes, the person stays still."),
    ("カメラが回る", "The camera slowly orbits around the subject."),
    ("引いていく", "The camera slowly pulls back to reveal the surroundings."),
    ("背景だけ動く", "The background moves with light traffic and people, the subject stays still."),
    ("最後のフレームへ", "Smooth natural motion from the first frame to the last frame."),
    ("まばたきして話す", "The person blinks and talks naturally to the camera with subtle head movement."),
    ("光が変わる", "The lighting slowly changes from daylight to sunset while the subject moves slightly."),
]
H3_I2V_SET = I2V_SET[:9] + [
    ("最初→途中→最後", "Smooth natural motion from the first frame through the middle frame to the last frame, the camera slowly pushes in."),
]
R2V_SET = [
    ("画像1の人と画像2の物", "The person from <Picture 1> walks forward holding the object from <Picture 2>, natural daylight, handheld camera."),
    ("画像2の服を着る", "The person from <Picture 1> wears the clothes from <Picture 2> and turns around slowly."),
    ("画像2の場所に立つ", "The person from <Picture 1> stands in the place from <Picture 2>, the camera slowly pushes in."),
    ("手を振る", "The person from <Picture 1> smiles and waves at the camera, soft light."),
    ("2 人が話す", "The person from <Picture 1> and the person from <Picture 2> talk to each other, natural light."),
    ("物が回る", "The object from <Picture 2> rotates slowly on a table, studio lighting."),
    ("踊る", "The person from <Picture 1> dances happily, the camera orbits around."),
    ("画像2の中を歩く", "The person from <Picture 1> walks through the scene from <Picture 2>, cinematic."),
    ("アップで笑う", "Close-up of the person from <Picture 1>, blinking and smiling."),
    ("物を手に取る", "The person from <Picture 1> picks up the object from <Picture 2> and looks at it."),
]

# ---- 第9版: FLUX.2 Klein / FLUX.3 Klein / LTX-2.5 / Kandinsky 6 ----
FLUX_T2I_SET = [  # FLUX の テキスト→画像(自然な英文で、見えるものを具体的に書く)
    ("写真(自然光)", "A candid photo of a young woman reading in a sunlit cafe, soft window light, shallow depth of field, 35mm film look."),
    ("ポートレート", "A close-up portrait of an elderly fisherman with weathered skin and a knitted cap, soft overcast light, sharp focus on the eyes."),
    ("商品写真", "A product photo of a white ceramic mug on a light wooden table, soft studio lighting, gentle shadow, clean background."),
    ("文字入りポスター", 'A minimalist poster with the bold headline "SUMMER SALE" at the top, a single orange slice in the center, flat pastel background.'),
    ("アニメイラスト", "An anime-style illustration of a girl with a red scarf standing on a snowy train platform at night, clean lineart, glowing lights."),
    ("風景", "A wide landscape of misty mountains above a calm lake at sunrise, golden light on the peaks, mirror-like reflections."),
    ("映画のワンシーン", "A cinematic film still of a detective in a trench coat under a streetlight on a rainy night, teal and orange color grading."),
    ("料理", "A top-down photo of a bowl of ramen with a soft-boiled egg, green onions and chashu pork, steam rising, dark stone table."),
    ("3D キャラクター", "A cute 3D render of a small round robot with big glowing eyes waving, soft pastel colors, studio lighting."),
    ("建物・室内", "A cozy Scandinavian living room with a grey sofa, plants and large windows, warm afternoon light, interior design photo."),
    ("ロゴ・アイコン", "A flat vector logo of a fox head inside a circle, orange and white, clean lines, plain white background."),
    ("人物の全身写真", "A full-body fashion photo of a woman in a beige trench coat walking on a city street, morning light, 50mm lens."),
    ("夜の街(雨)", "A rainy night street in Tokyo with neon signs reflected on wet asphalt, a lone person with a transparent umbrella, cinematic mood."),
    ("水彩イラスト", "A soft watercolor illustration of a small cottage by a river in spring, pale washes of color, visible paper texture."),
    ("油絵", "An oil painting of a vase of sunflowers on a wooden table, thick brush strokes, warm impasto texture, rich colors."),
    ("動物の写真", "A wildlife photo of a red fox standing in tall grass at dawn, shallow depth of field, soft backlight, sharp eyes."),
    ("空撮", "An aerial photo of a winding turquoise river through a green valley, early morning light, crisp details, wide angle."),
    ("宇宙", "A realistic view of a ringed planet rising over a barren moon surface, a small rover in the foreground, deep black sky with stars."),
    ("雪の景色", "A quiet snowy village at dusk, warm light in the windows, snow falling softly, long exposure, calm blue tones."),
    ("和室", "A tidy Japanese tatami room with a low table and a window to a small garden, soft afternoon light, minimal interior photo."),
    ("ファッション", "A studio fashion photo of a model in a bright yellow coat against a gray backdrop, strong side light, sharp fabric detail."),
    ("マクロ写真", "A macro photo of a dewdrop on a green leaf, tiny reflection of a flower inside the drop, creamy background blur."),
    ("雑誌の表紙", 'A magazine cover with the title "MONDAY" in large letters, a smiling woman in a white shirt, clean layout with small headlines.'),
    ("レトロ写真", "A retro 1970s snapshot of a family at a picnic in a park, faded colors, film grain, slightly overexposed highlights."),
    ("ドット絵", "A pixel art scene of a small village with a river and a bridge, limited color palette, clean pixels, 16-bit game style."),
    ("手書きの看板", 'A hand-painted wooden sign reading "OPEN" in white paint, hanging on a brick wall of a small cafe, soft morning light.'),
    ("水中", "An underwater photo of a sea turtle swimming above a coral reef, sunbeams from the surface, clear blue water."),
    ("未来都市", "A futuristic city with tall glass towers and elevated trains at sunset, flying cars, warm orange sky, detailed concept art."),
    ("ペットの写真", "A close-up photo of a fluffy white cat sleeping on a knitted blanket by a window, soft light, shallow depth of field."),
    ("料理(俯瞰)", "A top-down photo of a bowl of ramen with a soft egg, green onions and nori on a dark table, steam rising, natural light."),
]
FLUX2_EDIT_SET = [  # FLUX.2 Klein 画像→画像(画像は image 1〜image 4 と書く。最大 4 枚)
    ("服の色を変える", "Change the color of the clothes to red. Keep everything else unchanged."),
    ("背景を変える", "Replace the background with a quiet coastal cliff at sunset. Keep the subject's pose and framing unchanged."),
    ("オブジェクト除去", "Remove the object in the background. Fill the area naturally. Keep everything else unchanged."),
    ("画風を変える", "Turn image 1 into a soft watercolor illustration. Keep the composition and pose."),
    ("画像2の物を持たせる", "Let the person in image 1 hold the object from image 2 with both hands. Keep the person's face, clothes and the background."),
    ("画像2の服を着せる", "Dress the person in image 1 in the outfit from image 2. Keep the identity, pose and background."),
    ("画像2の柄・ロゴを付ける", "Stylize the object in image 1 with the colors and logo from image 2."),
    ("画像2の場所に置く", "Place the person from image 1 into the scene from image 2, matching the lighting. Keep the identity and pose."),
    ("3 枚を組み合わせる", "The person from image 1 wears the jacket from image 2 and holds the bag from image 3, standing on a sunny street."),
    ("4 人の集合写真", "A group photo of the people from image 1, image 2, image 3 and image 4 standing side by side in a park, natural light."),
    ("画像2を服の真ん中にプリント", "Print image 2 on the center of the clothes of the person in image 1. Keep the person, pose, lighting and background unchanged."),
    ("画像2の柄の服にする", "Change the clothes of the person in image 1 to clothes with the pattern from image 2. Keep the person, pose, lighting and background unchanged."),
]
FLUX3_EDIT_SET = [  # FLUX.3 Klein 画像→画像(画像は <ref_image_0>〜<ref_image_9> と書く。最大 10 枚)
    ("服の色を変える", "In <ref_image_0>, change the color of the dress to deep red silk. Keep the person, pose, lighting and background unchanged."),
    ("背景を変える", "In <ref_image_0>, replace the background with a quiet coastal cliff at overcast sunset, with soft matching light on the subject. Keep the person and pose unchanged."),
    ("オブジェクト除去", "In <ref_image_0>, remove the object in the background and fill the area with the surrounding scenery. Keep everything else unchanged."),
    ("画風を変える", "Convert the entire image <ref_image_0> into a watercolor illustration with soft washes and paper texture. Keep the composition."),
    ("画像2の服を着せる", "Create a photograph of the person from <ref_image_0> wearing the outfit from <ref_image_1>, in the same pose and background as <ref_image_0>. The person keeps their identity, face and hairstyle."),
    ("画像2の物を持たせる", "Create a photograph of the person from <ref_image_0> holding the object from <ref_image_1> with both hands, natural light. The person keeps their identity and clothes."),
    ("画像2の場所に置く", "Create a photograph of the person from <ref_image_0> standing in the place shown in <ref_image_1>, with lighting that matches the scene. The person keeps their identity and outfit."),
    ("3 枚を組み合わせる", "Create a photograph of the person from <ref_image_0> wearing the jacket from <ref_image_1> and holding the bag from <ref_image_2> on a sunny city street."),
    ("4 人の集合写真", "Create a group photograph of the people from <ref_image_0>, <ref_image_1>, <ref_image_2> and <ref_image_3> standing side by side in a park, natural light. Everyone keeps their identity and clothes."),
    ("商品を並べる", "Create a product photograph of the items from <ref_image_0>, <ref_image_1> and <ref_image_2> arranged neatly on a white table, soft studio light."),
    ("画像2を服の真ん中にプリント", "In <ref_image_0>, change the clothes to printed center of the <ref_image_1>. Keep the person, pose, lighting and background unchanged."),
    ("画像2の柄の服にする", "In <ref_image_0>, change the clothes to a design with the pattern from <ref_image_1>. Keep the person, pose, lighting and background unchanged."),
]
LTX_T2V_SET = [  # LTX-2.5 テキスト→動画(映像と一緒に音も作る。音も文章で書く)
    ("映画風の基本", "A cinematic shot of a woman walking along a seaside promenade at golden hour, the camera tracking beside her. Waves crash softly, gulls call in the distance."),
    ("ゆっくり寄る", "The camera slowly pushes in on an old man sitting on a park bench feeding pigeons, soft morning light. Pigeons coo and wings flutter."),
    ("話す人", 'A close-up of a young chef in a busy kitchen looking at the camera and saying, "Today we make fresh pasta." Pans sizzle in the background.'),
    ("街の夜", "A night city street with neon signs and light rain, cars passing with reflections on the wet road, slow pan. Rain patters, distant traffic hums."),
    ("自然・動物", "A red fox steps through fresh snow in a quiet forest, pausing to listen, steam from its breath. Snow crunches softly, a light wind blows."),
    ("スポーツ", "A skateboarder rolls down a sunny street and does a smooth kickflip, the camera follows low to the ground. Wheels roll on asphalt, the board snaps."),
    ("料理", "Close-up of hot oil as tempura shrimp are lowered in, bubbles rising, warm kitchen light. Loud sizzling and crackling."),
    ("ドローン", "An aerial drone shot flying slowly over green rice terraces at sunrise, mist in the valleys. Gentle wind and distant birdsong."),
    ("雨の窓", "Raindrops run down a window with blurred city lights behind, a cup of coffee steaming on the sill. Rain taps the glass, soft jazz plays."),
    ("SF", "A sleek spaceship glides over a desert planet with two suns, dust trailing behind, the camera follows from below. Deep engine rumble, wind howls."),
    ("インタビュー", 'A woman sits in a bright studio and says to the camera, "I started painting when I was six." Soft room tone, light echo.'),
    ("楽器の演奏", "A street musician plays a violin under a bridge at dusk, the camera circles slowly. Warm violin melody, distant traffic."),
]
LTX_I2V_SET = [  # LTX-2.5 画像→動画(最後のフレームも入れると、その画像で終わる動画)
    ("画像を動かす", "Use the provided start image as the first frame. The subject moves naturally, a gentle wind blows, the camera slowly pushes in. Soft ambient sound."),
    ("話し出す", 'Use the provided start image as the first frame. The person looks at the camera and says, "Hello, nice to meet you," with a warm smile.'),
    ("笑顔になる", "Use the provided start image as the first frame. The person blinks, smiles naturally and tilts their head slightly. Quiet room tone."),
    ("振り向く", "Use the provided start image as the first frame. The person slowly turns their head toward the camera. Light footsteps and wind."),
    ("歩き出す", "Use the provided start image as the first frame. The person starts walking forward and the camera follows smoothly. Footsteps on pavement."),
    ("髪がなびく", "Use the provided start image as the first frame. A breeze moves the hair and clothes while the person stays still. Wind rustles softly."),
    ("カメラが回る", "Use the provided start image as the first frame. The camera slowly orbits around the subject, revealing the surroundings."),
    ("引いていく", "Use the provided start image as the first frame. The camera slowly pulls back to reveal the wide scene. Ambient sound of the place."),
    ("最初→最後", "Use the provided start image as the first frame and the provided end image as the final frame anchor. The scene changes smoothly and naturally from the first image to the last image."),
    ("変身する", "Use the provided start image as the first frame and the provided end image as the final frame anchor. The subject transforms gradually with sparkling light, a soft magical chime."),
    ("歌い出す", 'Use the provided start image as the first frame. The person starts singing softly, "la la la", swaying gently. Soft acoustic guitar.'),
    ("顔に寄る", "Use the provided start image as the first frame. The camera slowly pushes in toward the subject's face. Quiet ambient sound."),
]
K6_NEG = ("Static, 2D cartoon, cartoon, 2d animation, paintings, images, worst quality, low quality, ugly, "
          "deformed, walking backwards")
K6_T2V_SET = [  # Kandinsky 6(「Audio:」の行から下が音の説明。話す言葉は <S>…<E> で囲む)
    ("鳥の森", "Two scarlet macaws perch on a mossy branch in a lush rainforest. One spreads its wings and flaps them, then both preen each other. Bright sunlight, vivid colors.\nAudio: loud macaw squawks, rustling feathers and leaves, lively rainforest ambience"),
    ("話す人", "A young woman in a cozy cafe looks at the camera and says <S>Good morning! Let's start the day.<E> with a bright smile.\nAudio: clear female voice, soft cafe chatter, cups clinking"),
    ("海辺", "Waves roll onto a sandy beach at sunset, a child runs along the shoreline, the camera follows slowly.\nAudio: waves crashing, distant gulls, a child laughing"),
    ("街の夜", "A neon-lit city street at night in light rain, people with umbrellas walk past, reflections on the wet road.\nAudio: rain, footsteps, distant traffic and city hum"),
    ("料理", "Close-up of a chef flipping vegetables in a hot wok, flames rising, steam swirling in warm light.\nAudio: loud sizzling, metal spatula scraping, roaring gas flame"),
    ("雪の森", "A red fox walks through fresh snow in a quiet forest, stops and looks around, snowflakes falling.\nAudio: soft crunch of snow, gentle wind, silence of the forest"),
    ("ライブ演奏", "A street musician plays an acoustic guitar in a small square at dusk, people stop to listen.\nAudio: acoustic guitar melody, light applause, murmuring crowd"),
    ("ドローン", "An aerial shot flying over green mountains and a winding river at sunrise, mist in the valleys.\nAudio: gentle wind, distant birds"),
    ("雨の窓", "Raindrops run down a window with blurred city lights behind, a cup of tea steaming on the sill.\nAudio: rain tapping on glass, quiet room tone"),
    ("ロボット", "A small cute robot rolls across a workshop table and waves its arm at the camera, warm lamp light.\nAudio: tiny servo whirs, cheerful beeps"),
    ("インタビュー", "A man sits in a bright studio and calmly says <S>I started painting when I was six.<E>\nAudio: clear male voice, quiet studio room tone"),
    ("花火", "Fireworks burst over a river at night with reflections on the water, people watching from the bank.\nAudio: loud firework bangs and crackles, distant cheering"),
]
K6_I2V_SET = [
    ("画像を動かす", "The subject moves naturally, a gentle wind blows, the camera slowly pushes in.\nAudio: soft ambient sound of the place"),
    ("話し出す", "The person looks at the camera and says <S>Hello, nice to meet you.<E> with a warm smile.\nAudio: clear natural voice, quiet room tone"),
    ("笑顔になる", "The person blinks, smiles naturally and tilts their head slightly.\nAudio: quiet room tone"),
    ("振り向く", "The person slowly turns toward the camera.\nAudio: light footsteps, soft wind"),
    ("歩き出す", "The person starts walking forward and the camera follows smoothly.\nAudio: footsteps on pavement, city ambience"),
    ("髪がなびく", "A breeze moves the hair and clothes while the person stays still.\nAudio: wind rustling"),
    ("カメラが回る", "The camera slowly orbits around the subject, revealing the surroundings.\nAudio: ambient sound of the place"),
    ("引いていく", "The camera slowly pulls back to reveal the wide scene.\nAudio: ambient sound of the place"),
    ("手を振る", "The person waves at the camera with a friendly smile.\nAudio: cheerful 'hi', light background chatter"),
    ("背景だけ動く", "The background moves with people and traffic while the subject stays still.\nAudio: busy street ambience"),
    ("歌い出す", "The person starts singing softly, swaying gently.\nAudio: soft singing voice, acoustic guitar"),
    ("驚く", "The person looks surprised and says <S>Wow, really?<E>\nAudio: surprised natural voice, quiet room tone"),
]

# 第42版: 声・音楽のおすすめ(画像・動画とは別の一覧。ポジティブ = 1 つ目の欄、ネガティブ = 2 つ目の欄)
TTS_STYLE_SET = [  # Qwen3-TTS 決まった声: 話し方の指示(2 つ目の欄)
    ("やさしく落ち着いた話し方", "", "Speak gently and calmly, at a slow pace."),
    ("明るく元気な話し方", "", "Speak brightly and cheerfully, with clear articulation."),
    ("ニュースの読み上げ", "", "Read like a news anchor: calm, clear and precise."),
    ("ささやき声", "", "Whisper softly, close to the microphone."),
]
TTS_DESIGN_SET = [  # Qwen3-TTS 声を文で作る: 声の説明(2 つ目の欄)
    ("落ち着いた大人の男性", "", "A calm, deep adult male voice with a relaxed pace."),
    ("明るい若い女性", "", "A bright, energetic young female voice."),
    ("年配の語り手", "", "An elderly storyteller's voice, warm and slightly husky."),
    ("元気な子ども", "", "A cheerful child's voice, high-pitched and lively."),
]
LYRICS_FRAME = "[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Verse]\n\n[Chorus]\n\n[Outro]"
MUSIC_SET = [  # HeartMuLa / ACE-Step: 1 つ目 = スタイル、2 つ目 = 歌詞の型
    ("J-POP・女性ボーカル", "j-pop, female vocal, bright, piano, synthesizer, upbeat", LYRICS_FRAME),
    ("ロック・男性ボーカル", "rock, male vocal, electric guitar, bass, drums, energetic", LYRICS_FRAME),
    ("バラード", "ballad, emotional, female vocal, piano, strings, slow tempo", LYRICS_FRAME),
    ("ダンス", "edm, dance, male vocal, synthesizer, heavy bass, four-on-the-floor", LYRICS_FRAME),
    ("歌詞の型だけ", "", LYRICS_FRAME),
]
ACE_ONLY_SET = [  # ACE-Step だけ: 歌なし
    ("歌なし(インスト)・映画風", "instrumental, cinematic, orchestral, epic, strings, brass", "[Instrumental]"),
    ("歌なし(インスト)・ローファイ", "instrumental, lofi hip hop, mellow, jazzy piano, soft drums, relaxing", "[Instrumental]"),
]


# ---- 第43版: おすすめを増やす(テキスト→画像以外の一覧は 30 個)----
TAG_SET += [
    ("油絵", "oil painting (medium), impasto, rich colors, "),
    ("線画", "lineart, monochrome, greyscale, clean lines, "),
    ("パステル", "pastel colors, soft lighting, dreamy, "),
    ("サイバーパンク", "cyberpunk, neon lights, futuristic city, hologram, "),
    ("ファンタジー", "fantasy, magic, glowing particles, castle, "),
    ("学校", "school uniform, classroom, window, sunlight, "),
    ("カフェ", "cafe, indoors, warm lighting, coffee cup, "),
    ("雨", "rain, wet, umbrella, puddle, reflection, "),
    ("雪", "snow, winter, scarf, visible breath, "),
    ("海・夏", "summer, beach, ocean, blue sky, clouds, "),
    ("桜・春", "spring, cherry blossoms, falling petals, "),
    ("紅葉・秋", "autumn, autumn leaves, maple leaf, warm colors, "),
    ("顔アップ", "close-up, portrait, detailed eyes, "),
    ("横顔", "profile, from side, looking away, "),
    ("見上げる構図", "from below, dynamic angle, sky, "),
    ("見下ろす構図", "from above, high angle, "),
    ("ドラマチックな光", "dramatic lighting, chiaroscuro, light rays, "),
    ("シンプルな背景", "simple background, white background, "),
]
NATURAL_SET += [
    ("フィルム写真", "An analog film photo, natural grain, slightly faded colors, a candid moment."),
    ("白黒写真", "A black-and-white photo, strong contrast, deep shadows, fine grain."),
    ("油絵", "An oil painting with visible brush strokes, rich colors, classical composition."),
    ("鉛筆スケッチ", "A detailed pencil sketch on white paper, fine hatching and soft shading."),
    ("絵本風", "A children's picture book illustration, soft colors, rounded shapes, warm mood."),
    ("サイバーパンク", "A cyberpunk city at night, holographic signs, rain, purple and teal neon light."),
    ("料理写真", "A top-down food photo on a wooden table, natural window light, fresh ingredients."),
    ("建築写真", "An architectural photo of a modern building, clean lines, blue sky, wide angle."),
    ("インテリア", "A cozy living room interior, warm lamps, green plants, soft morning light."),
    ("マクロ撮影", "A macro photo of dew drops on a leaf, extreme detail, soft bokeh background."),
    ("宇宙", "A colorful nebula and a distant ringed planet, deep space, sharp stars."),
    ("水中", "An underwater scene with sunbeams from the surface, a coral reef and colorful fish."),
    ("ローポリ", "A low-poly 3D illustration, flat shading, pastel colors, simple geometric shapes."),
    ("木版画風", "A woodblock print style picture, bold outlines, flat colors, waves and mountains."),
    ("ミニチュア風", "A tilt-shift photo of a busy town that looks like a miniature model, bright colors."),
    ("ロゴ", "A minimal flat logo of a mountain and the sun, simple shapes, two colors, white background."),
    ("アイコン", "A cute app icon of a cat, rounded square, soft gradient, simple flat design."),
    ("雨の日の窓", "A rainy window with water drops, blurred city lights behind, quiet and moody."),
]

# 画像 1 枚の編集(MOSS・Qwen Image・FLUX.2 Klein はこのまま、MiniMax-H3-Image・FLUX.3 Klein は画像の書き方を合わせる)
EDIT_EXTRA = [
    ("高画質にする", "Enhance the photo: sharpen the details, reduce noise and correct the colors. Keep the content unchanged."),
    ("白黒をカラーにする", "Colorize the black-and-white photo with natural, realistic colors. Keep everything else unchanged."),
    ("古い写真を修復", "Repair the old photo: remove scratches, dust and creases. Keep the people and composition unchanged."),
    ("落ち着いた表情にする", "Change the facial expression to a calm, neutral look. Keep everything else unchanged."),
    ("目を開ける", "Open the person's eyes naturally. Keep the face, identity and everything else unchanged."),
    ("眼鏡をかける", "Add black round glasses to the person. Keep everything else unchanged."),
    ("帽子をかぶせる", "Put a beige knit beanie on the person's head. Keep everything else unchanged."),
    ("正面を向かせる", "Turn the person to face the camera directly. Keep the identity, clothes and background."),
    ("雨の日にする", "Change the weather to a rainy day with wet ground and soft gray light. Keep the subject unchanged."),
    ("桜の季節にする", "Change the scene to spring with cherry blossoms in full bloom. Keep the subject unchanged."),
    ("紅葉の季節にする", "Change the season to autumn with red and orange leaves. Keep the subject unchanged."),
    ("背景をぼかす", "Blur the background as if shot with a portrait lens. Keep the subject sharp and unchanged."),
    ("背景を白にする", "Replace the background with plain white, like a studio product photo. Keep the subject unchanged."),
    ("看板の文字を変える", 'Change the text on the sign to "OPEN". Keep the font style, colors and everything else unchanged.'),
    ("油絵風にする", "Turn the image into an oil painting with visible brush strokes. Keep the composition."),
    ("鉛筆画にする", "Turn the image into a pencil sketch on white paper. Keep the composition."),
    ("フィギュア風にする", "Turn the person into a collectible 3D figure on a display base, studio lighting. Keep the pose and outfit."),
    ("年齢を上げる", "Make the person look about ten years older with natural aging. Keep the identity and everything else unchanged."),
]
_low = lambda t: t[:1].lower() + t[1:]
MOSS_EDIT_SET += EDIT_EXTRA
QWEN_EDIT_SET += EDIT_EXTRA
FLUX2_EDIT_SET += EDIT_EXTRA
FLUX3_EDIT_SET += [(n, f"In <ref_image_0>, {_low(t)}") for n, t in EDIT_EXTRA]
MINIMAX_EDIT_SET += [(n, f"Edit <Picture 1>: {_low(t)}") for n, t in EDIT_EXTRA] + [
    ("画像2の背景にする", "Edit <Picture 1>: replace the background with the scene from <Picture 2>, matching the light. Keep the person unchanged."),
    ("画像2の画風にする", "Redraw <Picture 1> in the art style of <Picture 2>. Keep the composition and pose."),
]

T2V_SET += [
    ("ドローン空撮", "Aerial drone shot slowly flying over a rocky coastline at sunrise, waves rolling onto the rocks."),
    ("走る", "A runner jogs along a riverside path at dawn, the camera tracks beside them, warm light."),
    ("料理する手", "Close-up of hands chopping vegetables on a wooden board, soft kitchen light, shallow depth of field."),
    ("海の波", "Waves crash on a sandy beach in slow motion, spray glowing in the sunlight."),
    ("森の光", "Sunbeams shine through tall trees in a misty forest, the camera slowly moves forward."),
    ("雪", "Snow falls gently on a quiet village street at night, warm lights in the windows."),
    ("猫", "A cat stretches and yawns on a sunny windowsill, soft natural light."),
    ("犬が走る", "A dog runs happily across a grassy field toward the camera, low angle, sunny day."),
    ("ダンス", "A dancer spins on a rooftop at sunset, the camera circles slowly around her."),
    ("車の走行", "A car drives along a winding mountain road, aerial tracking shot, golden hour."),
    ("コーヒー", "Close-up of milk poured into a cup of coffee, swirling latte art, warm light."),
    ("キャンドル", "A candle flame flickers in a dark room, soft warm glow, slow push in."),
    ("桜", "Cherry blossom petals drift in the wind along a river, slow pan, soft spring light."),
    ("アニメ風", "Anime style, a girl runs through a summer field under a blue sky, wind in her hair."),
    ("ネオンの雨", "A cyberpunk street in the rain at night, neon reflections, people with umbrellas, slow dolly."),
    ("水中", "Underwater shot of a sea turtle swimming over a coral reef, sunlight rays from above."),
    ("星空", "Time-lapse of the starry night sky turning over a mountain lake."),
    ("スローモーション", "Slow motion of a water balloon bursting, droplets flying, bright backlight."),
]
I2V_EXTRA = [
    ("うなずく", "The person nods slowly and smiles, subtle natural movement."),
    ("目を閉じる", "The person slowly closes their eyes and takes a deep breath, calm mood."),
    ("笑い出す", "The person laughs naturally, shoulders moving slightly."),
    ("指さす", "The person points at something off-screen and looks toward it."),
    ("髪をかき上げる", "The person brushes their hair back with one hand, gentle movement."),
    ("座る", "The person sits down slowly on a chair, the camera stays still."),
    ("ジャンプ", "The person jumps up with joy and lands softly, the camera follows."),
    ("踊り出す", "The person starts dancing to a light rhythm, smooth natural motion."),
    ("雨が降り出す", "Rain begins to fall in the scene, drops hit the ground, the subject looks up."),
    ("雪が降る", "Snowflakes fall gently in the scene, the subject's breath is visible in the cold air."),
    ("花びらが舞う", "Petals blow through the air around the subject in a soft breeze."),
    ("水面がゆれる", "The water surface ripples and sparkles in the sunlight, gentle motion."),
    ("炎がゆらめく", "The flames flicker and sparks rise slowly, warm light changes on the subject."),
    ("雲が流れる", "Clouds move across the sky, light and shadows pass over the landscape."),
    ("横に移動するカメラ", "The camera slides slowly to the side, parallax between foreground and background."),
    ("見上げるカメラ", "The camera tilts up slowly from the ground to the subject."),
    ("ズームアウト", "The camera zooms out smoothly, showing the whole place."),
    ("動物が動く", "The animal blinks, moves its ears and looks around naturally."),
]
I2V_SET += I2V_EXTRA
H3_I2V_SET += I2V_EXTRA + [
    ("途中で振り向く", "Smooth motion through the middle frame, the person turns toward the camera and smiles in the last frame."),
    ("カメラ固定で最後へ", "The camera stays still. The subject moves naturally from the first frame to the last frame."),
]
R2V_SET += [
    ("ベンチで読書", "The person from <Picture 1> sits on a park bench and reads a book, soft afternoon light."),
    ("画像2の車に乗る", "The person from <Picture 1> gets into the car from <Picture 2> and closes the door."),
    ("画像2のペットと遊ぶ", "The person from <Picture 1> plays with the pet from <Picture 2> on the grass, sunny day."),
    ("画像2の料理を食べる", "The person from <Picture 1> tastes the dish from <Picture 2> at a table and smiles."),
    ("画像2の楽器を弾く", "The person from <Picture 1> plays the instrument from <Picture 2> on a small stage, warm spotlight."),
    ("2 人で歩く", "The person from <Picture 1> and the person from <Picture 2> walk side by side along a beach at sunset."),
    ("2 人で乾杯", "The person from <Picture 1> and the person from <Picture 2> raise their glasses in a cozy restaurant."),
    ("2 人で踊る", "The person from <Picture 1> and the person from <Picture 2> dance together in a ballroom, the camera circles."),
    ("握手する", "The person from <Picture 1> shakes hands with the person from <Picture 2> in a bright office."),
    ("画像2の服で回る", "The person from <Picture 1> wearing the outfit from <Picture 2> spins around slowly, studio light."),
    ("画像2の商品を見せる", "The person from <Picture 1> holds up the product from <Picture 2> and shows it to the camera."),
    ("画像2の場所を走る", "The person from <Picture 1> runs through the place from <Picture 2>, the camera follows from behind."),
    ("棚に置く", "The person from <Picture 1> places the object from <Picture 2> on a shelf and steps back."),
    ("箱を開ける", "The person from <Picture 1> opens the box from <Picture 2> and looks inside with a surprised face."),
    ("自撮り", "The person from <Picture 1> takes a selfie in front of the place from <Picture 2>, handheld camera."),
    ("傘をさして歩く", "The person from <Picture 1> walks in the rain with the umbrella from <Picture 2>, night city lights."),
    ("画像2の台所で料理", "The person from <Picture 1> cooks in the kitchen from <Picture 2>, steam rising, warm light."),
    ("車が走る", "The car from <Picture 2> drives along a coastal road, aerial tracking shot."),
    ("商品が回る", "The product from <Picture 1> rotates slowly on a white background, soft studio lighting."),
    ("見つめ合う", "Close-up of the person from <Picture 1> and the person from <Picture 2> looking at each other and smiling."),
]

LTX_T2V_SET += [
    ("森の朝", "A misty forest at dawn, sunbeams breaking through tall pines, the camera glides forward. Birds sing, leaves rustle softly."),
    ("海の波", "Waves crash against black rocks at sunset, spray glowing in the light, the camera holds steady. Deep roar of the waves, wind."),
    ("カフェ", "A barista pours steamed milk into a cup, drawing latte art, warm cafe light. The espresso machine hisses, quiet chatter."),
    ("子どもが笑う", "A little girl blows bubbles in a sunny garden and laughs, the camera follows the bubbles. Giggles, birds chirping."),
    ("ニュース", 'A news anchor at a desk looks into the camera and says, "Good evening, here are tonight\'s headlines." Quiet studio tone.'),
    ("雷雨", "Dark storm clouds over a wheat field, lightning flashes, the wheat bends in the wind. Thunder rumbles, heavy rain begins."),
    ("電車", "A train passes a small countryside station at dusk, its windows flickering by. Train horn, rhythmic clatter of wheels."),
    ("焚き火", "Friends sit around a campfire at night, sparks rising into the dark sky. The fire crackles, soft laughter, a guitar strums."),
    ("猫", "A kitten chases a ball of yarn across a wooden floor in window light. Tiny paws pattering, a soft meow."),
    ("祭り", "A summer festival street at night with paper lanterns and food stalls, people walking in yukata. Festival drums, crowd chatter."),
    ("ゲーム実況風", 'A young streamer at a desk with colorful lights reacts to a game and shouts, "No way, I did it!" Keyboard clicks, upbeat music.'),
    ("水中", "A sea turtle glides over a coral reef, light rays from the surface, the camera swims alongside. Muffled underwater ambience, bubbles."),
    ("工房", "A blacksmith hammers glowing metal on an anvil, sparks flying in a dark workshop. Loud metal clangs, a roaring furnace."),
    ("雪山", "A snowboarder carves down a powder slope, snow spraying, the camera follows from behind. Rushing wind, hissing snow."),
    ("図書館", "A quiet library with tall shelves, a student turns a page, dust floating in the light. Paper rustles, a clock ticks."),
    ("ステージ", "A singer on a stage under colored lights sings into a microphone, the crowd waves. Live vocals, cheering crowd."),
    ("宇宙", "An astronaut floats outside a space station above Earth, the camera slowly rotates. Breathing inside the helmet, radio beeps."),
    ("アニメ風", "Anime style, a boy rides a bicycle down a hill toward the sea in summer, the camera tracks beside him. Cicadas, wind, a bicycle bell."),
]
LTX_I2V_SET += [(n, "Use the provided start image as the first frame. " + t) for n, t in [
    ("うなずく", "The person nods slowly and smiles. Quiet room tone."),
    ("笑い出す", "The person laughs naturally, shoulders shaking slightly. Warm laughter."),
    ("あいさつする", 'The person waves and says, "Hi, welcome back!" A bright, friendly voice.'),
    ("ため息", "The person sighs and looks out the window. A soft sigh, rain outside."),
    ("目を閉じる", "The person closes their eyes and breathes deeply. Gentle wind, calm ambience."),
    ("指さす", "The person points off-screen and looks toward it. Distant city sounds."),
    ("座る", "The person sits down slowly on a chair. The chair creaks softly."),
    ("踊り出す", "The person starts dancing to the beat. Upbeat pop music."),
    ("拍手する", "The person claps their hands and smiles. Clear applause."),
    ("雨が降り出す", "Rain begins to fall and the person looks up. Rain patters softly."),
    ("雪が降る", "Snowflakes fall slowly around the subject. Quiet winter wind."),
    ("花びらが舞う", "Petals blow through the air in a soft breeze. Wind chimes ring."),
    ("炎がゆらめく", "The flames flicker and sparks rise. The fire crackles."),
    ("波が寄せる", "Waves roll onto the shore in the scene. Waves wash in and out."),
    ("動物が鳴く", "The animal looks around and makes its natural call. Nature ambience."),
    ("横に移動するカメラ", "The camera slides slowly to the side, revealing depth. Ambient sound of the place."),
    ("ささやく", 'The person leans in and whispers, "It\'s a secret." A soft, close whisper.'),
    ("乾杯する", 'The person raises a glass and says, "Cheers!" Glasses clink, restaurant ambience.'),
]]
K6_T2V_SET += [
    ("森の朝", "Morning in a misty forest, sunbeams through tall trees, a deer raises its head.\nAudio: birdsong, soft wind in the leaves"),
    ("電車", "A local train passes a seaside station on a sunny day, the camera stays on the platform.\nAudio: train horn, wheels clattering, waves"),
    ("焚き火", "Friends sit around a campfire under the stars, sparks drifting upward.\nAudio: crackling fire, quiet laughter, crickets"),
    ("猫", "A kitten chases a feather toy across a sunny living room floor.\nAudio: tiny paws on wood, a soft meow"),
    ("祭り", "A summer festival street with lanterns and food stalls at night, people in yukata walk by.\nAudio: festival drums, flute, crowd chatter"),
    ("雷雨", "Storm clouds roll over a wheat field, lightning flashes in the distance.\nAudio: rolling thunder, wind, heavy rain starting"),
    ("陶芸", "A potter shapes clay on a spinning wheel, wet hands smoothing the bowl.\nAudio: humming wheel, wet clay sounds, quiet studio"),
    ("ニュース", "A news anchor at a desk says <S>Good evening, here is today's news.<E> to the camera.\nAudio: clear voice, quiet studio tone"),
    ("子どもが笑う", "A little boy blows soap bubbles in a garden and laughs.\nAudio: child laughing, birds chirping"),
    ("ステージ", "A singer performs on a stage under colorful lights while the crowd waves their hands.\nAudio: live vocals, drums, cheering crowd"),
    ("宇宙", "An astronaut floats outside a space station with Earth below.\nAudio: steady breathing in a helmet, radio beeps"),
    ("水中", "A sea turtle swims over a coral reef with sunlight rays from above.\nAudio: muffled underwater ambience, bubbles"),
    ("雪山", "A snowboarder carves down a powder slope, snow spraying behind.\nAudio: rushing wind, hissing snow"),
    ("図書館", "A student turns pages in a quiet library, dust floating in the sunlight.\nAudio: paper rustling, a clock ticking"),
    ("カフェ", "A barista pours milk into an espresso, drawing latte art on the counter.\nAudio: espresso machine hiss, cups clinking, soft chatter"),
    ("2 人の会話", "Two friends sit on a park bench, one says <S>Let's go to the sea tomorrow.<E> and the other nods.\nAudio: clear voices, birds, distant traffic"),
    ("アニメ風", "Anime style, a girl rides a bicycle along a seaside road in summer, her hair blowing in the wind.\nAudio: cicadas, wind, bicycle bell"),
    ("滝", "A tall waterfall pours into a green pool, mist rising, the camera slowly tilts up.\nAudio: loud rushing water, birds"),
]
K6_I2V_SET += [
    ("うなずく", "The person nods slowly and smiles.\nAudio: quiet room tone"),
    ("笑い出す", "The person laughs naturally, shoulders shaking slightly.\nAudio: warm natural laughter"),
    ("あいさつする", "The person waves and says <S>Hi, welcome back!<E>\nAudio: bright friendly voice"),
    ("ため息", "The person sighs and looks out the window.\nAudio: soft sigh, rain outside"),
    ("目を閉じる", "The person closes their eyes and breathes deeply.\nAudio: gentle wind, calm ambience"),
    ("指さす", "The person points off-screen and looks toward it.\nAudio: distant city sounds"),
    ("座る", "The person sits down slowly on a chair.\nAudio: chair creaking softly"),
    ("踊り出す", "The person starts dancing to the beat.\nAudio: upbeat pop music"),
    ("拍手する", "The person claps their hands and smiles.\nAudio: clear applause"),
    ("雨が降り出す", "Rain begins to fall and the person looks up at the sky.\nAudio: rain pattering"),
    ("雪が降る", "Snowflakes fall slowly around the subject.\nAudio: quiet winter wind"),
    ("花びらが舞う", "Petals blow through the air around the subject.\nAudio: soft breeze, wind chimes"),
    ("炎がゆらめく", "The flames flicker and sparks rise slowly.\nAudio: crackling fire"),
    ("波が寄せる", "Waves roll onto the shore in the scene.\nAudio: waves washing in and out"),
    ("動物が鳴く", "The animal looks around and makes a natural sound.\nAudio: its natural call, nature ambience"),
    ("ささやく", "The person leans in and whispers <S>It's a secret.<E>\nAudio: soft whisper, close and quiet"),
    ("乾杯する", "The person raises a glass and says <S>Cheers!<E>\nAudio: glasses clinking, restaurant ambience"),
    ("横に移動するカメラ", "The camera slides slowly to the side, revealing depth.\nAudio: ambient sound of the place"),
]

TTS_STYLE_SET += [
    ("ゆっくりはっきり", "", "Speak slowly and clearly, pausing between sentences."),
    ("早口", "", "Speak quickly with excitement, as if in a hurry."),
    ("悲しそうに", "", "Speak in a sad, quiet voice, close to tears."),
    ("怒って", "", "Speak angrily, with a sharp and tense tone."),
    ("うれしそうに", "", "Speak happily, smiling while talking."),
    ("驚いて", "", "Speak with surprise, the pitch rising at the start."),
    ("眠そうに", "", "Speak sleepily, slow and a little mumbled."),
    ("自信たっぷりに", "", "Speak confidently with a firm, strong voice."),
    ("恥ずかしそうに", "", "Speak shyly, softly and hesitantly."),
    ("子どもに話しかける", "", "Speak warmly as if to a small child, gentle and kind."),
    ("ドキュメンタリーのナレーション", "", "Narrate like a nature documentary: calm, deep and steady."),
    ("CM のナレーション", "", "Speak like a TV commercial narrator: bright, energetic and persuasive."),
    ("ラジオ DJ", "", "Speak like a cheerful radio DJ, lively and smiling."),
    ("物語の朗読", "", "Read like an audiobook narrator, expressive and well-paced."),
    ("駅・空港のアナウンス", "", "Speak like a station announcement: polite, clear and even."),
    ("講義", "", "Speak like a teacher giving a lecture: clear, calm and explanatory."),
    ("ゲームのキャラクター", "", "Speak like an energetic game character, bold and dramatic."),
    ("ホラー", "", "Speak in a low, creepy whisper with slow pauses."),
    ("瞑想ガイド", "", "Speak very softly and slowly, like a meditation guide."),
    ("スポーツ実況", "", "Speak like a sports commentator: fast, loud and excited."),
    ("丁寧な接客", "", "Speak politely like a customer service agent: warm and calm."),
    ("真剣に", "", "Speak seriously with a low, steady tone."),
    ("笑いながら", "", "Speak while laughing lightly."),
    ("内緒話", "", "Speak in a hushed voice as if telling a secret."),
    ("遠くに呼びかける", "", "Call out loudly as if to someone far away."),
    ("歌うように", "", "Speak in a sing-song, playful rhythm."),
]
TTS_DESIGN_SET += [
    ("低い声の男性ナレーター", "", "A deep, resonant male narrator voice, slow and authoritative."),
    ("柔らかい女性ナレーター", "", "A soft, warm female narrator voice with a gentle pace."),
    ("元気な少年", "", "An energetic teenage boy's voice, bright and quick."),
    ("落ち着いた少女", "", "A calm teenage girl's voice, clear and slightly soft."),
    ("かすれ声の男性", "", "A husky, raspy middle-aged male voice."),
    ("上品な女性", "", "An elegant, refined adult female voice, calm and polite."),
    ("おじいさん", "", "An old man's voice, slow, slightly shaky and kind."),
    ("おばあさん", "", "An old woman's voice, gentle, warm and a little thin."),
    ("ロボット風", "", "A flat, mechanical robot-like voice with an even pitch."),
    ("アニメの元気な女の子", "", "A cute, high-pitched anime girl voice, cheerful and lively."),
    ("クールな青年", "", "A cool, low young male voice, calm and a little distant."),
    ("女性ニュースキャスター", "", "A professional female news anchor voice, clear and neutral."),
    ("男性ニュースキャスター", "", "A professional male news anchor voice, clear and steady."),
    ("ささやき声の女性", "", "A breathy, whispering female voice, very soft."),
    ("力強い男性", "", "A powerful, loud male voice, full of energy."),
    ("眠そうな青年", "", "A sleepy young man's voice, slow and relaxed."),
    ("優しい母親", "", "A warm, caring mother's voice, soft and patient."),
    ("厳しい先生", "", "A strict teacher's voice, firm and precise."),
    ("陽気なおじさん", "", "A cheerful middle-aged man's voice, friendly and loud."),
    ("ミステリアスな女性", "", "A mysterious, low female voice, slow and smooth."),
    ("男性ラジオ DJ", "", "A smooth male radio DJ voice, warm and upbeat."),
    ("悪役", "", "A dark, menacing villain voice, low and slow."),
    ("妖精", "", "A light, airy fairy-like voice, high and sparkling."),
    ("英国風の紳士", "", "A British-accented gentleman's voice, polite and calm."),
    ("早口の若い女性", "", "A fast-talking young woman's voice, bright and excited."),
    ("落ち着いた医師", "", "A calm, reassuring doctor's voice, clear and kind."),
]
TTC_TEXT_SET = [  # Qwen3-TTS ボイスクローン: 読み上げるテキスト(1 つ目の欄)
    ("自己紹介", "はじめまして。今日はよろしくお願いします。"),
    ("朝のあいさつ", "おはようございます。今日もいい一日になりますように。"),
    ("お礼", "本日はご来場いただき、誠にありがとうございました。"),
    ("開演のお知らせ", "まもなく開演です。お席にお戻りください。"),
    ("留守番電話", "ただいま電話に出ることができません。発信音のあとにメッセージをどうぞ。"),
    ("動画の始まり", "こんにちは。今日はちょっと面白いものを紹介します。"),
    ("動画の終わり", "最後まで見てくれてありがとう。また次の動画で会いましょう。"),
    ("商品紹介", "こちらは軽くて丈夫な新しい水筒です。毎日の通勤や通学にぴったりです。"),
    ("天気予報", "明日は全国的に晴れますが、夕方からは雲が増えるでしょう。"),
    ("昔話の始まり", "むかしむかし、ある山のふもとに、小さな村がありました。"),
    ("詩の朗読", "風の音を聞きながら、遠い海のことを思い出していました。"),
    ("ゲームのセリフ", "ここから先は危険だ。準備ができたら声をかけてくれ。"),
    ("励まし", "大丈夫。あなたなら、きっとできるよ。"),
    ("おわび", "ご迷惑をおかけして、誠に申し訳ございません。"),
    ("道案内", "次の角を右に曲がって、二つ目の信号を左です。"),
    ("料理の手順", "まず玉ねぎを薄切りにして、弱火でじっくり炒めます。"),
    ("講座の始まり", "それでは、今日の講座を始めます。資料の一ページ目を開いてください。"),
    ("誕生日のお祝い", "お誕生日おめでとう。素敵な一年になりますように。"),
    ("店内放送", "本日はご来店ありがとうございます。ただいまタイムセールを行っております。"),
    ("駅のアナウンス", "まもなく、一番線に電車がまいります。黄色い線の内側までお下がりください。"),
    ("旅のナレーション", "朝の市場には、とれたての魚と人々の声があふれていました。"),
    ("早口言葉", "生麦生米生卵。隣の客はよく柿食う客だ。"),
    ("英語: 自己紹介", "Hello, my name is Alex. Nice to meet you."),
    ("英語: 動画の終わり", "Thank you for watching. See you in the next video."),
    ("英語: ナレーション", "In a quiet village by the sea, a small light was always on."),
    ("英語: 商品紹介", "Meet our new headphones: light, comfortable, and made for long days."),
    ("中国語: あいさつ", "大家好，欢迎来到我的频道。"),
    ("韓国語: あいさつ", "안녕하세요. 만나서 반갑습니다."),
    ("長めの文(調整用)", "今日は少し長めの文章を読み上げます。句読点で間を取りながら、自然な速さで話せているかを確かめてください。"),
    ("数字と日付", "会議は三月十五日、午後二時三十分から、第二会議室で行います。"),
]
MUSIC_SET += [
    ("シティポップ", "city pop, female vocal, groovy bass, electric piano, 80s, nostalgic", LYRICS_FRAME),
    ("アニメソング", "anime song, female vocal, fast tempo, energetic, electric guitar, synthesizer", LYRICS_FRAME),
    ("アイドルポップ", "idol pop, female vocals, cute, bright synthesizer, upbeat", LYRICS_FRAME),
    ("ヒップホップ", "hip hop, male rap, boom bap drums, deep bass, vinyl crackle", LYRICS_FRAME),
    ("R&B", "r&b, smooth female vocal, soft keys, slow groove", LYRICS_FRAME),
    ("ジャズ・ボーカル", "jazz, male vocal, upright bass, brushed drums, piano, smoky bar", LYRICS_FRAME),
    ("ボサノバ", "bossa nova, soft female vocal, nylon guitar, light percussion, relaxing", LYRICS_FRAME),
    ("フォーク", "folk, male vocal, acoustic guitar, harmonica, warm", LYRICS_FRAME),
    ("カントリー", "country, male vocal, banjo, acoustic guitar, fiddle, upbeat", LYRICS_FRAME),
    ("演歌", "enka, male vocal, shamisen, strings, emotional, slow tempo", LYRICS_FRAME),
    ("K-POP", "k-pop, female vocals, punchy synthesizer, dance beat, catchy hook", LYRICS_FRAME),
    ("メタル", "heavy metal, male vocal, distorted guitar, double bass drums, powerful", LYRICS_FRAME),
    ("パンク", "punk rock, male vocal, fast drums, power chords, raw", LYRICS_FRAME),
    ("レゲエ", "reggae, male vocal, offbeat guitar, warm bass, laid-back", LYRICS_FRAME),
    ("ゴスペル", "gospel, choir, piano, organ, uplifting, hand claps", LYRICS_FRAME),
    ("ラテン", "latin pop, male vocal, reggaeton beat, guitar, summer", LYRICS_FRAME),
    ("ローファイ・歌入り", "lofi, soft female vocal, mellow, dusty drums, rainy night", LYRICS_FRAME),
    ("シンセウェーブ", "synthwave, male vocal, retro synthesizer, 80s drums, night drive", LYRICS_FRAME),
    ("子どもの歌", "children's song, cheerful, simple melody, ukulele, hand claps", LYRICS_FRAME),
    ("クリスマス", "christmas song, female vocal, sleigh bells, orchestra, warm", LYRICS_FRAME),
    ("夏の歌", "summer pop, male vocal, bright guitar, beach, upbeat", LYRICS_FRAME),
    ("卒業ソング", "graduation song, choir, piano, emotional, hopeful", LYRICS_FRAME),
    ("チップチューン・歌入り", "chiptune, female vocal, 8-bit synthesizer, upbeat, video game", LYRICS_FRAME),
    ("ロックバラード", "rock ballad, male vocal, electric guitar solo, strings, emotional", LYRICS_FRAME),
    ("アコースティック", "acoustic, female vocal, guitar, warm, intimate, coffee shop", LYRICS_FRAME),
]
ACE_ONLY_SET += [
    ("歌なし(インスト)・ピアノソロ", "instrumental, solo piano, calm, emotional, reverb", "[Instrumental]"),
    ("歌なし(インスト)・ジャズ", "instrumental, jazz trio, piano, upright bass, brushed drums, cafe", "[Instrumental]"),
    ("歌なし(インスト)・EDM", "instrumental, edm, festival, big drop, synth leads, 128 bpm", "[Instrumental]"),
    ("歌なし(インスト)・ゲーム", "instrumental, chiptune, 8-bit, upbeat, video game", "[Instrumental]"),
    ("歌なし(インスト)・和風", "instrumental, japanese traditional, koto, shakuhachi, taiko, calm", "[Instrumental]"),
    ("歌なし(インスト)・アコースティックギター", "instrumental, acoustic guitar, fingerstyle, warm, relaxing", "[Instrumental]"),
    ("歌なし(インスト)・ホラー", "instrumental, dark ambient, horror, drones, tension", "[Instrumental]"),
    ("歌なし(インスト)・ボサノバ", "instrumental, bossa nova, nylon guitar, light percussion, relaxing", "[Instrumental]"),
]


SENSENOVA_EDIT_SET = [  # SenseNova-U1.6 画像→画像(画像1を編集。参照画像は the reference image と書く。最大 10 枚)
    ("服の色を変える", "Change the color of the clothes to deep red. Keep the person, pose, lighting and background unchanged."),
    ("背景を変える", "Replace the background with a quiet coastal cliff at sunset. Keep the person and the pose unchanged."),
    ("オブジェクト除去", "Remove the object in the background and fill the area naturally. Keep everything else unchanged."),
    ("画風を変える", "Turn the image into a soft watercolor illustration. Keep the composition and the pose."),
    ("笑顔にする", "Make the person smile gently. Keep the face identity, hairstyle and everything else unchanged."),
    ("照明を変える", "Change the lighting to warm golden hour light from the left. Keep the subject and the composition unchanged."),
    ("昼を夜にする", "Change the scene from day to night with lit windows and a dark blue sky. Keep the buildings and the layout unchanged."),
    ("季節を冬にする", "Change the season to winter with snow on the ground and the trees. Keep the composition unchanged."),
    ("髪の色を変える", "Change the hair color to silver. Keep the hairstyle, the face and the background unchanged."),
    ("眼鏡を掛ける", "Put round black glasses on the person. Keep the face and everything else unchanged."),
    ("帽子をかぶらせる", "Put a knitted beige beanie on the person. Keep the face, the clothes and the background unchanged."),
    ("文字を書き換える", 'Change the text on the sign to "OPEN". Keep the font style, the color and the rest of the image unchanged.'),
    ("文字を入れる", 'Add the title "SUMMER" in large white letters at the top. Keep everything else unchanged.'),
    ("白黒をカラーにする", "Colorize the black and white photo with natural colors. Keep the details and the composition unchanged."),
    ("写真をイラストにする", "Turn the photo into a clean anime-style illustration with clear lineart. Keep the composition and the pose."),
    ("イラストを写真にする", "Turn the illustration into a realistic photo. Keep the composition, the pose and the colors."),
    ("背景をぼかす", "Blur the background with a soft lens blur. Keep the subject sharp and unchanged."),
    ("背景を白にする", "Replace the background with plain white. Keep the subject and its edges clean."),
    ("人物を足す", "Add a small child standing next to the person, holding a balloon. Keep the rest unchanged."),
    ("空を変える", "Replace the sky with a dramatic sunset sky with orange clouds. Keep the ground and the buildings unchanged."),
    ("雨にする", "Make it a rainy day with wet ground and reflections. Keep the people and the layout unchanged."),
    ("表情を変える", "Change the expression to surprised with wide open eyes. Keep the identity and everything else unchanged."),
    ("髪型を変える", "Change the hairstyle to a short bob cut. Keep the face, the clothes and the background unchanged."),
    ("参照画像の服を着せる", "Dress the person in the first image in the outfit from the reference image. Keep the identity, the pose and the background."),
    ("参照画像の物を持たせる", "Let the person in the first image hold the object from the reference image. Keep the face, the clothes and the background."),
    ("参照画像の画風にする", "Redraw the first image in the art style of the reference image. Keep the composition and the pose."),
    ("参照画像の場所に置く", "Place the person from the first image into the scene of the reference image, with matching light and shadows."),
    ("画質を上げる", "Improve the image quality: sharper details, cleaner edges, less noise. Keep the content unchanged."),
    ("合成を馴染ませる", "Blend the pasted object naturally into the scene by matching the light, shadow and color. Keep the composition unchanged."),
    ("色味を整える", "Adjust the color grading to a soft, warm and slightly faded film look. Keep the content unchanged."),
]

BUILTIN_PRESETS = (
    _set(["SD1.5", "SDXL", "Illustrious", "Anima"], [], TAG_SET)
    + _set(["MOSS", "Krea2", "Qwen Image", "MiniMax-H3-Image"], ["T2I"], NATURAL_SET)
    + _set(["Krea2"], ["I2I"], NATURAL_SET)
    + _set(["MOSS"], ["I2I"], MOSS_EDIT_SET, NEG_QUALITY)
    + _set(["Qwen Image"], ["I2I"], QWEN_EDIT_SET)  # 参考ワークフローと同じくネガティブは空
    + _set(["MiniMax-H3-Image"], ["I2I"], MINIMAX_EDIT_SET)
    + _set(["Wan2.2 14B", "Wan2.2 5B"], ["T2V"], T2V_SET, NEG_WAN)
    + _set(["MiniMax H3"], ["T2V"], T2V_SET)
    + _set(["Wan2.2 14B"], ["I2V"], I2V_SET, NEG_WAN)
    + _set(["Wan2.2 5B"], ["I2V"], I2V_SET[:9] + I2V_SET[10:] + [("ゆっくり寄る", "The camera slowly pushes in, the subject moves slightly.")], NEG_WAN)
    + _set(["MiniMax H3"], ["I2V"], H3_I2V_SET)
    + _set(["MiniMax H3"], ["R2V"], R2V_SET)
    + _set(["FLUX.2 Klein", "FLUX.3 Klein"], ["T2I"], FLUX_T2I_SET)
    + _set(["FLUX.2 Klein"], ["I2I"], FLUX2_EDIT_SET)
    + _set(["FLUX.3 Klein"], ["I2I"], FLUX3_EDIT_SET)
    + _set(["SenseNova-U1.6"], ["T2I"], NATURAL_SET)
    + _set(["SenseNova-U1.6"], ["I2I"], SENSENOVA_EDIT_SET)
    + _set(["LTX-2.5"], ["T2V"], LTX_T2V_SET)
    + _set(["LTX-2.5"], ["I2V"], LTX_I2V_SET)
    + _set(["Kandinsky 6"], ["T2V"], K6_T2V_SET, K6_NEG)
    + _set(["Kandinsky 6"], ["I2V"], K6_I2V_SET, K6_NEG)
    + _set(["Qwen3-TTS"], ["TTS"], TTS_STYLE_SET)
    + _set(["Qwen3-TTS"], ["TTD"], TTS_DESIGN_SET)
    + _set(["Qwen3-TTS"], ["TTC"], TTC_TEXT_SET)
    + _set(["HeartMuLa", "ACE-Step 1.5"], ["T2M"], MUSIC_SET)
    + _set(["ACE-Step 1.5"], ["T2M"], ACE_ONLY_SET)
)


# ---------------------------------------------------------------------------
# 標準的なファイル名(パネルの「モデル・LoRA」の各欄の ⓘ に出す)
# 出典: 各配布元の Hugging Face のファイル一覧(Comfy-Org の ComfyUI 用リポジトリなど)と、元のワークフローの値
# 基礎モデル → 項目 → [(タスク("" = 全部), ファイル名, 説明)]
# ---------------------------------------------------------------------------
STANDARD_FILES = {
    "MOSS": {
        "unet_name": [("", "moss_image_sft_int8_convrot.safetensors", "標準(軽い)"), ("", "moss_image_sft_bf16.safetensors", "高精度・重い")],
        "clip_name": [("", "qwen3.5_9b_w4a8_gptq.safetensors", "標準(軽い)"), ("", "qwen3.5_9b_int8_convrot.safetensors", ""),
                      ("", "qwen3.5_9b_bf16.safetensors", "高精度・重い")],
        "vae_name": [("", "flux2-vae_small.safetensors", "標準"), ("", "flux2-vae.safetensors", "")],
        "edit_lora_name": [("I2I", "moss_image_edit_lora_rank_64_bf16.safetensors", "公式 rank64(Comfy-Org 配布・まずこれ)"),
                           ("I2I", "armV5-moss-edit-lora.safetensors", "HQ 版 armV5(物の追加に強い)")],
        "turbo_lora_name": [("", "8-steps-dmd-lora.safetensors", "lodestones/MOSS-Image-SFT-8-steps-dmd")],
    },
    "SD1.5": {"ckpt_name": [("", "v1-5-pruned-emaonly.safetensors", "公式")]},
    "SDXL": {"ckpt_name": [("", "sd_xl_base_1.0.safetensors", "公式")]},
    "Illustrious": {"ckpt_name": [("", "Illustrious-XL-v1.0.safetensors", "公式"), ("", "CMAnimaZ2.safetensors", "元のワークフローの値")]},
    "Anima": {
        "unet_name": [("", "anima-base-v1.0.safetensors", "標準"), ("", "anima-aesthetic-v1.1.safetensors", "見栄え重視"),
                      ("", "anima-turbo-v1.1.safetensors", "少ないステップ用")],
        "clip_name": [("", "qwen_3_06b_base.safetensors", "")],
        "vae_name": [("", "qwen_image_vae.safetensors", "")],
    },
    "Krea2": {
        "unet_name": [("", "krea2_turbo_fp8_scaled.safetensors", "公式(Comfy-Org/Krea-2)"), ("", "Krea2cocoamix3.safetensors", "元のワークフローの値")],
        "clip_name": [("", "qwen3vl_4b_fp8_scaled.safetensors", "")],
        "vae_name": [("", "qwen_image_vae.safetensors", "")],
    },
    "Qwen Image": {
        "unet_name": [("T2I", "qwen_image_fp8_e4m3fn.safetensors", "テキスト→画像の標準"), ("T2I", "qwen_image_2512_fp8_e4m3fn.safetensors", "新しい版"),
                      ("I2I", "qwen_image_edit_fp8_e4m3fn.safetensors", "画像→画像(編集)の標準"),
                      ("I2I", "qwen_image_edit_2509_fp8_e4m3fn.safetensors", "編集の新しい版"),
                      ("I2I", "qwen_image_edit_2511_fp8mixed.safetensors", "編集のさらに新しい版")],
        "clip_name": [("", "qwen_2.5_vl_7b_fp8_scaled.safetensors", "")],
        "vae_name": [("", "qwen_image_vae.safetensors", "")],
        "turbo_lora_name": [("T2I", "Qwen-Image-Lightning-8steps-V1.1.safetensors", "lightx2v/Qwen-Image-Lightning"),
                            ("I2I", "Qwen-Image-Edit-Lightning-8steps-V1.0.safetensors", "lightx2v/Qwen-Image-Lightning")],
    },
    "FLUX.2 Klein 4B": {
        "unet_name": [("", "flux-2-klein-4b-fp8.safetensors", "蒸留版(4 ステップ)")],
        "clip_name": [("", "qwen_3_4b.safetensors", "4B 用(9B 用とは別)")],
        "vae_name": [("", "flux2-vae.safetensors", "")],
    },
    "FLUX.2 Klein 4B Base": {
        "unet_name": [("", "flux-2-klein-base-4b-fp8.safetensors", "Base(非蒸留)")],
        "clip_name": [("", "qwen_3_4b.safetensors", "4B 用(9B 用とは別)")],
        "vae_name": [("", "flux2-vae.safetensors", "")],
    },
    "FLUX.2 Klein 9B": {
        "unet_name": [("", "flux-2-klein-9b-fp8.safetensors", "蒸留版(4 ステップ)")],
        "clip_name": [("", "qwen_3_8b_fp8mixed.safetensors", "9B 用(4B 用とは別)")],
        "vae_name": [("", "flux2-vae.safetensors", "")],
    },
    "FLUX.2 Klein 9B Base": {
        "unet_name": [("", "flux-2-klein-base-9b-fp8.safetensors", "Base(非蒸留)")],
        "clip_name": [("", "qwen_3_8b_fp8mixed.safetensors", "9B 用(4B 用とは別)")],
        "vae_name": [("", "flux2-vae.safetensors", "")],
    },
    "FLUX.3 Klein": {
        "unet_name": [("", "flux3-image-klein-base-int8-convrot.safetensors", "標準(テンプレートと同じ)"),
                      ("", "flux3-image-klein-base-bf16.safetensors", "高精度・重い(VRAM 24GB 超向け)")],
        "clip_name": [("", "qwen3vl_4b_int8_convrot.safetensors", "")],
        "vae_name": [("", "flux2-vae.safetensors", "FLUX.2 と同じ VAE")],
    },
    "FLUX.3 Klein Distilled": {
        "unet_name": [("", "flux3-image-klein-int8-convrot.safetensors", "蒸留版(4〜16 ステップ)"),
                      ("", "flux3-image-klein-bf16.safetensors", "高精度・重い(VRAM 24GB 超向け)")],
        "clip_name": [("", "qwen3vl_4b_int8_convrot.safetensors", "")],
        "vae_name": [("", "flux2-vae.safetensors", "FLUX.2 と同じ VAE")],
    },
    "LTX-2.5": {
        "unet_name": [("", "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors", "蒸留版(テンプレートと同じ)")],
        "clip_name": [("", "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", "")],
        "vae_name": [("", "ltx-2.5-video-vae-bf16.safetensors", "映像用")],
        "audio_vae_name": [("", "ltx-2.5-audio-vae-bf16.safetensors", "音声用(VAE フォルダ)")],
        "latent_upscale_name": [("", "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors", "2 倍に拡大する")],
    },
    "Kandinsky 6": {
        "unet_name": [("", "Kandinsky-6.0-Pro-distill-5s-Diffusers/transformer/diffusion_pytorch_model.safetensors",
                       "Pro distill(標準・10 ステップ)。フォルダごと置く"),
                      ("", "Kandinsky-6.0-Lite-distill-5s-Diffusers/transformer/diffusion_pytorch_model.safetensors",
                       "Lite distill(小さい)")],
        "clip_name": [("", "qwen_2.5_vl_7b.safetensors", "Qwen Image と同じもの(fp8 版でも可)")],
        "clip_name_2": [("", "clip_l.safetensors", "")],
        "vae_name": [("", "hunyuan_video_vae_bf16.safetensors", "")],
    },
    "MiniMax-H3-Image": {
        "unet_name": [("", "minimax_h3_image_pruned_int8_convrot.safetensors", "標準"), ("", "minimax_h3_image_pruned_bf16.safetensors", "高精度・重い")],
        "clip_name": [("", "qwen3vl_32b_minimax_h3_int8_convrot.safetensors", "")],
        "vae_name": [("", "minimax_h3_image_vae_fp16.safetensors", "")],
        "turbo_lora_name": [("", "minimax_h3_pdmd_2nfe_comfyui.safetensors", "akhaliq/minimax-h3-image-pdmd-2step(2 ステップ・強度 1.0)")],
    },
    "Wan2.2 14B": {
        "wan_high_unet": [("T2V", "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", "テキスト→動画"),
                          ("I2V", "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "画像→動画")],
        "wan_low_unet": [("T2V", "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors", "テキスト→動画"),
                         ("I2V", "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", "画像→動画")],
        "clip_name": [("", "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "")],
        "vae_name": [("", "wan_2.1_vae.safetensors", "14B は 2.1 の VAE")],
        "turbo_lora_name": [("T2V", "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors", "High 用"),
                            ("I2V", "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", "High 用")],
        "turbo_lora_low_name": [("T2V", "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors", "Low 用"),
                                ("I2V", "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", "Low 用")],
    },
    "Wan2.2 5B": {
        "unet_name": [("", "wan2.2_ti2v_5B_fp16.safetensors", "")],
        "clip_name": [("", "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "")],
        "vae_name": [("", "wan2.2_vae.safetensors", "5B は 2.2 の VAE")],
        "turbo_lora_name": [("", "Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors", "Kijai/WanVideo_comfy の FastWan")],
    },
    "MiniMax H3": {
        "unet_name": [("T2V", "minimax_h3_fl2va_pruned_fp8_scaled.safetensors", ""), ("I2V", "minimax_h3_fl2va_pruned_fp8_scaled.safetensors", ""),
                      ("R2V", "minimax_h3_ref2va_pruned_fp8_scaled.safetensors", "参照画像→動画用")],
        "clip_name": [("", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "軽い"), ("", "qwen3vl_32b_minimax_h3_int8_convrot.safetensors", "")],
        "vae_name": [("", "minimax_h3_video_vae_int8_convrot.safetensors", "")],
        "audio_vae_name": [("", "minimax_h3_audio_vae_fp32.safetensors", "")],
        "turbo_lora_name": [("T2V", "minimax_h3_fl2v_turbo_8step_v1.2_768p_comfyui_bf16.safetensors", "配布元のおすすめ(8 ステップ)"),
                            ("T2V", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors", "元のワークフローの版"),
                            ("I2V", "minimax_h3_fl2v_turbo_8step_v1.2_768p_comfyui_bf16.safetensors", "配布元のおすすめ(8 ステップ)"),
                            ("I2V", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors", "元のワークフローの版"),
                            ("R2V", "minimax_h3_ref2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors", "参照画像→動画用(8 ステップ)")],
    },
    # 第42版: Comfy-Org/ace_step_1.5_ComfyUI_files(テンプレート Text to Audio (ACE-Step 1.5) のファイル)
    "ACE-Step 1.5": {
        "unet_name": [("", "acestep_v1.5_turbo.safetensors", "標準(Turbo・8 ステップ)"), ("", "acestep_v1.5_base.safetensors", "Base(ステップを増やして使う)"),
                      ("", "acestep_v1.5_xl_turbo_bf16.safetensors", "XL Turbo(大きい・重い)")],
        "clip_name": [("", "qwen_0.6b_ace15.safetensors", "標準")],
        "clip_name_2": [("", "qwen_4b_ace15.safetensors", "標準(テンプレート)"), ("", "qwen_1.7b_ace15.safetensors", "軽い")],
        "vae_name": [("", "ace_1.5_vae.safetensors", "標準")],
    },
    # SenseNova-U1.6 Turbo: sensenova/SenseNova-U1.6-8B-MoT-LoRAs(SenseNova-U1 Python 用のファイル)
    "SenseNova-U1.6": {
        "unet_name": [("", SN_CORE_INT8, "標準(Turbo・自己修正。約 17.6 GB。models/checkpoints に入れる)"),
                      ("", "HF | sensenova/SenseNova-U1.6-8B-MoT", "選ぶだけで自動でダウンロード(約 35 GB)"),
                      ("", SN_LIGHT[2], "軽い版(約 12 GB)。選ぶだけで自動でダウンロード。LoRA・Turbo とは一緒に使えない"),
                      ("", "Local | SenseNova-U1.6-8B-MoT", "手で入れるとき。入れ方は「📋 モデルの選び方・ライセンス」")],
        "clip_name": [("", "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors", "テキスト→画像の PE 用(約 8.8 GB)"),
                      ("", "qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors", "画像→画像の PE 用(約 8.8 GB)")],
        "turbo_lora_name": [("", "sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors", "8 ステップ(標準・Core 用)"),
                            ("", "SenseNova-U1.6-8B-MoT-LoRA-8step-v1.0.safetensors", "8 ステップ(追加ノード用)"),
                            ("", "SenseNova-U1.6-8B-MoT-LoRA-4step-v1.0.safetensors", "4 ステップ(ステップ数を 4 に)")],
    },
    # TRELLIS.2: ComfyUI 同梱のテンプレート「画像 → 3D」のファイル
    "TRELLIS.2": {
        "unet_name": [("", "trellis_2_int8_convrot.safetensors", "標準(テンプレートと同じ)")],
        "vae_name": [("", "trellis_2_shape_vae_bf16.safetensors", "形の VAE")],
        "audio_vae_name": [("", "trellis_2_texture_vae_bf16.safetensors", "色の VAE(VAE フォルダ)")],
        "clip_name": [("", "dino_v3_L_naf_fp32.safetensors", "models/clip_vision")],
        "clip_name_2": [("", "birefnet.safetensors", "models/background_removal")],
    },
}


def standard_files(model_type, task):
    """その種別・タスクの標準的なファイル名 {項目: [(ファイル名, 説明)]}"""
    base = TYPE_INFO[model_type]["base"]
    if base not in STANDARD_FILES:
        base = TYPE_INFO[model_type]["family"]
    out = {}
    for key, items in STANDARD_FILES.get(base, {}).items():
        rows = [(name, note) for t, name, note in items if not t or t == task]
        if rows:
            out[key] = rows
    return out


def builtin_presets(model_type, task):
    base = TYPE_INFO[model_type]["base"]
    family = TYPE_INFO[model_type]["family"]
    return [p for p in BUILTIN_PRESETS
            if (base in p["bases"] or family in p["bases"]) and (not p["tasks"] or task in p["tasks"])]
