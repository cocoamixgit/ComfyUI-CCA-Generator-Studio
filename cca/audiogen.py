"""第42版: 声・音楽を作る(生成パネルの「音声・音楽」の種別)。

画像・動画のような大きなワークフローは使わず、パネルの値から ComfyUI に送る小さな処理(prompt)を作る。
手順と既定値は、それぞれの配布元の手順(ノードの既定値・公式のテンプレート)に合わせる。

- Qwen3-TTS(追加ノード ComfyUI-QwenTTS / 1038lab)
    決まった声(CustomVoice)・声を文で作る(VoiceDesign)・ボイスクローン(VoiceClone)。
    参照音声は、参照音声(+その文)か、保存した声(Load Voice)。参照音声を保存(Voices Library)・文を書き起こす(Whisper)もできる
- LatentSync 1.6(追加ノード ComfyUI-LatentSyncWrapper / ShmuelRonen)
    リップシンク(動画 + 音声)を合わせた動画。動画の長さは Video Length Adjuster で声に合わせる
- HeartMuLa(追加ノード ComfyUI_FL-HeartMuLa / filliptm)
    スタイル(タグ)+ 歌詞 → 曲。Model Loader → Conditioning → Sampler → Decode
- ACE-Step 1.5(ComfyUI 本体のノード。テンプレート「Text to Audio (ACE-Step 1.5)」と同じ手順)
    UNETLoader → ModelSamplingAuraFlow → KSampler(TextEncodeAceStepAudio1.5 / ConditioningZeroOut / EmptyAceStep1.5LatentAudio)
    → VAEDecodeAudio。テキストエンコーダーは DualCLIPLoader(種類 ace)
"""
import json
import os
import random

import folder_paths

from .specs import NONE, TYPE_INFO

# 種別ごとの、音音楽・音声の設定(パネルの audio_opts。JSON)の既定値と選べる値
QWEN_LANGS = ["Auto", "Chinese", "English", "Japanese", "Korean", "French", "German", "Spanish", "Portuguese", "Russian", "Italian"]
QWEN_SPEAKERS = ["Aiden", "Dylan", "Eric", "Ono_Anna", "Ryan", "Serena", "Sohee", "Uncle_Fu", "Vivian"]
QWEN_ATTN = ["auto", "sage_attn", "flash_attn", "sdpa", "eager"]
WHISPER_MODELS = ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3", "large-v3-turbo"]
WHISPER_LANGS = ["auto", "en", "zh", "ja", "ko", "de", "fr", "es", "it", "pt", "ru"]
ACE_LANGS = ['ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'ht', 'hu', 'id',
             'is', 'it', 'ja', 'ko', 'la', 'lt', 'ms', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sa', 'sk', 'sr', 'sv', 'sw',
             'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'yue', 'zh', 'unknown']
ACE_KEYS = [f"{root} {q}" for q in ["major", "minor"] for root in
            ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"]]
FORMATS = ["mp3", "flac", "opus"]
MP3_QUALITY = ["V0", "128k", "320k"]

COMMON = {"format": "mp3", "mp3q": "V0"}
# 第43版: RVC の設定(RVC の種別と、Qwen3-TTS の「RVC で声を変える」で共通)。index: 空 = 同じ名前の .index、(none) = 使わない
RVC_DEF = dict(rvc_model="", rvc_index="", rvc_pitch=0, rvc_index_rate=0.75, rvc_protect=0.33, rvc_rms=0.25, rvc_speaker=0,
               rvc_unload=False)
DEFAULTS = {
    # ComfyUI-QwenTTS の Advanced ノードの既定値
    "Qwen3-TTS": dict(COMMON, language="Auto", speaker="Ryan", model_size="1.7B", device="auto", precision="bf16", attention="auto",
                      max_new_tokens=2048, do_sample=False, top_p=0.9, top_k=50, temperature=0.9, repetition_penalty=1.0,
                      unload_models=True, ref_audio="", ref_text="", x_vector_only=False, voice="", save_voice="",
                      stt_model="small", stt_lang="auto", inst_char="", inst_style="", rvc_on=False, **RVC_DEF),
    "RVC": dict(COMMON, audio="", **RVC_DEF),
    # ComfyUI-LatentSyncWrapper の既定値(Video Length Adjuster: normal・無音 0.5 秒)
    "LatentSync 1.6": dict(video="", audio="", length_mode="normal", silent_padding=0.5),
    # ComfyUI_FL-HeartMuLa の既定値(長さ 60 秒・温度 1.0・top_k 50・3B・メモリ auto)
    "HeartMuLa": dict(COMMON, duration=60, temperature=1.0, top_k=50, model_version="3B", memory_mode="auto", precision="auto",
                      use_4bit=False),
    # テンプレート「Text to Audio (ACE-Step 1.5)」の値(長さ 120 秒・シフト 3・LM の CFG 2 / 温度 0.85 / top_p 0.9)。
    # BPM・キー・拍子・言語はノードの既定値(120・C major・4・en)
    "ACE-Step 1.5": dict(COMMON, duration=120, bpm=120, keyscale="C major", timesig="4", language="en", instrumental=False,
                         think=True, lm_cfg=2.0, lm_temp=0.85, lm_top_p=0.9, lm_top_k=0, lm_min_p=0.0, shift=3.0),
    # TRELLIS.2: ComfyUI 同梱テンプレート「画像 → 3D」の値(骨組み 12 ステップ・形 20 ステップ・色 12 ステップ・CFG 7.5 / 色は 1.0・面 70 万・テクスチャ 4096)
    "TRELLIS.2": dict(faces=700000, texture=4096, ss_steps=12, ss_cfg=7.5, shape_steps=20, shape_cfg=7.5, tex_steps=12, tex_cfg=1.0,
                      metal_mode="fixed", metallic=0.0, rough_mode="model", roughness=0.5, up_steps=12, ss_shift=5.0, ss_rescale=0.7, shape_rescale=0.5,
                      crop_pad=1.1, crop_bg="black", remesh_res=768, remesh_smooth=20, remesh_small=0.01, crease=180.0, uv_pad=1, uv_weld=0.0002,
                      normal_res=2048, cage=0.05, ao_res=1024, ao_samples=64, ao_dist=0.71, ao_strength=1.0, ao_bias=0.01),
}
# 種別 → どの手順で作るか
GEN = {"Qwen3-TTS": "qwen_tts", "RVC": "rvc", "LatentSync 1.6": "latentsync", "HeartMuLa": "heartmula", "ACE-Step 1.5": "ace", "TRELLIS.2": "trellis2"}
LIP_FPS = 25.0  # LatentSync のコマの速さ
# 歌なし(インストゥルメンタル)のときの歌詞(ACE-Step の書き方)
INSTRUMENTAL = "[Instrumental]"


def spec():
    """パネルに渡す: 種別ごとの既定値と、選べる値"""
    return {"defaults": DEFAULTS, "gen": GEN, "choices": {
        "language": QWEN_LANGS, "speaker": QWEN_SPEAKERS, "attention": QWEN_ATTN, "stt_model": WHISPER_MODELS,
        "stt_lang": WHISPER_LANGS, "ace_language": ACE_LANGS, "keyscale": ACE_KEYS, "format": FORMATS, "mp3q": MP3_QUALITY,
        "timesig": ["2", "3", "4", "6"], "length_mode": ["normal", "pingpong", "loop_to_audio"],
        "memory_mode": ["auto", "normal", "low", "ultra"], "hm_precision": ["auto", "fp32", "fp16", "bf16"],
        "precision": ["bf16", "fp16", "fp32"], "model_size": ["0.6B", "1.7B"], "texture": [1024, 2048, 4096],
        "normal_res": [512, 1024, 2048, 4096], "crop_bg": ["black", "white", "gray"], "metal_mode": ["fixed", "model"], "rough_mode": ["model", "fixed"]}}


def _opts(model_type, raw):
    o = dict(DEFAULTS.get(model_type, {}))
    try:
        v = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw if isinstance(raw, dict) else {})
    except ValueError:
        v = {}
    if isinstance(v, dict):
        o.update({k: v[k] for k in v if k in o})
    return o


def _num(v, d, lo=None, hi=None, cast=float):
    try:
        x = cast(v)
    except (TypeError, ValueError):
        x = d
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def _pick(v, options, d):
    return v if v in options else d


def _file(value, label):
    """input / output の音声・動画("名前 [input]" など)。無ければ分かるように止める"""
    v = str(value or "").strip()
    if not v or v == NONE:
        raise ValueError(f"{label}を選んでください")
    if not folder_paths.exists_annotated_filepath(v):
        raise ValueError(f"{label}が見つかりません: {v}")
    return v


def _save_audio(p, audio_ref, prefix, o):
    fmt = _pick(o.get("format"), FORMATS, "mp3")
    if fmt == "mp3":
        p["out"] = {"class_type": "SaveAudioMP3", "inputs": {"audio": audio_ref, "filename_prefix": prefix,
                                                              "quality": _pick(o.get("mp3q"), MP3_QUALITY, "V0")}}
    elif fmt == "opus":
        p["out"] = {"class_type": "SaveAudioOpus", "inputs": {"audio": audio_ref, "filename_prefix": prefix, "quality": "128k"}}
    else:
        p["out"] = {"class_type": "SaveAudio", "inputs": {"audio": audio_ref, "filename_prefix": prefix}}


def _seed(v, hi):
    s = _num(v, 0, 0, None, int)
    return s % (hi + 1)


def _qwen(p, o, task, text, instruct, seed):
    common = {"model_size": _pick(o["model_size"], ["0.6B", "1.7B"], "1.7B"), "device": str(o["device"] or "auto"),
              "precision": _pick(o["precision"], ["bf16", "fp16", "fp32"], "bf16"), "language": _pick(o["language"], QWEN_LANGS, "Auto"),
              "max_new_tokens": _num(o["max_new_tokens"], 2048, 256, 4096, int), "do_sample": bool(o["do_sample"]),
              "top_p": _num(o["top_p"], 0.9, 0.0, 1.0), "top_k": _num(o["top_k"], 50, 0, 200, int),
              "temperature": _num(o["temperature"], 0.9, 0.1, 2.0), "repetition_penalty": _num(o["repetition_penalty"], 1.0, 0.5, 2.0),
              "attention": _pick(o["attention"], QWEN_ATTN, "auto"), "unload_models": bool(o["unload_models"]),
              "seed": _seed(seed, 0xFFFFFFFFFFFFFFFF)}
    if not str(text or "").strip():
        raise ValueError("読み上げるテキストを書いてください")
    # 話し方のひな形(Voice Instruct)。指示を書いていなければ、選んだひな形を使う
    inst = str(instruct or "")
    if task in ("TTS", "TTD") and not inst.strip() and (o.get("inst_char") or o.get("inst_style")):
        p["inst"] = {"class_type": "AILab_Qwen3TTSVoiceInstruct",
                     "inputs": {"character": o.get("inst_char") or "Auto", "style": o.get("inst_style") or "Auto", "custom_instruct": ""}}
        inst = ["inst", 0]
    if task == "TTS":
        p["gen"] = {"class_type": "AILab_Qwen3TTSCustomVoice_Advanced",
                    "inputs": dict(common, text=text, speaker=_pick(o["speaker"], QWEN_SPEAKERS, "Ryan"), instruct=inst)}
    elif task == "TTD":
        if isinstance(inst, str) and not inst.strip():
            raise ValueError("声の説明を書いてください(どんな声か)")
        p["gen"] = {"class_type": "AILab_Qwen3TTSVoiceDesign_Advanced", "inputs": dict(common, model_size="1.7B", text=text, instruct=inst)}
    else:  # TTC: ボイスクローン
        inputs = dict(common, target_text=text, reference_text=str(o.get("ref_text") or ""), x_vector_only=bool(o.get("x_vector_only")))
        if o.get("voice"):
            p["voice"] = {"class_type": "AILab_Qwen3TTSLoadVoice", "inputs": {"voice_name": str(o["voice"]), "custom_path": ""}}
            inputs["voice"] = ["voice", 0]
        else:
            p["ref"] = {"class_type": "LoadAudio", "inputs": {"audio": _file(o.get("ref_audio"), "参照音声")}}
            inputs["reference_audio"] = ["ref", 0]
            if not inputs["reference_text"].strip() and not inputs["x_vector_only"]:
                raise ValueError("参照音声の文字起こしを書くか、「声の特徴だけ使う」にしてください(「📝 書き起こす」で文にできます)")
        p["gen"] = {"class_type": "AILab_Qwen3TTSVoiceClone_Advanced", "inputs": inputs}
    return ["gen", 0]


def _rvc(p, src, o):
    """src(AUDIO)を RVC で変える → 変えた AUDIO の参照"""
    from .rvcnode import NONE as RVC_NONE, guess_index
    model = str(o.get("rvc_model") or "").strip()
    if not model or model == RVC_NONE:
        raise ValueError("RVC の声のモデルを選んでください(models/rvc に .pth を入れ、🔄 で一覧を読み直します)")
    index = str(o.get("rvc_index") or "").strip() or guess_index(model) or RVC_NONE
    p["rvc"] = {"class_type": "CCARVCConvert", "inputs": {
        "audio": src, "model": model, "index": index, "pitch": _num(o.get("rvc_pitch"), 0, -24, 24, int),
        "index_rate": _num(o.get("rvc_index_rate"), 0.75, 0.0, 1.0), "protect": _num(o.get("rvc_protect"), 0.33, 0.0, 0.5),
        "rms_mix": _num(o.get("rvc_rms"), 0.25, 0.0, 1.0), "speaker": _num(o.get("rvc_speaker"), 0, 0, 255, int),
        "unload_after": bool(o.get("rvc_unload"))}}
    o["rvc_index_used"] = index
    return ["rvc", 0]


def _latentsync(p, o, v):
    p["vid"] = {"class_type": "LoadVideo", "inputs": {"file": _file(o.get("video"), "リップシンクする動画")}}
    p["parts"] = {"class_type": "GetVideoComponents", "inputs": {"video": ["vid", 0]}}
    p["aud"] = {"class_type": "LoadAudio", "inputs": {"audio": _file(o.get("audio"), "合わせる音声")}}
    # LatentSync は 25fps のコマで動く(追加ノードの例のワークフローも 25fps で読み込む)。コマを 25fps に並べ直す
    p["rate"] = {"class_type": "CCAFramesAtFps", "inputs": {"images": ["parts", 0], "fps": ["parts", 2], "target": LIP_FPS}}
    p["fit"] = {"class_type": "VideoLengthAdjuster", "inputs": {
        "images": ["rate", 0], "audio": ["aud", 0], "mode": _pick(o.get("length_mode"), ["normal", "pingpong", "loop_to_audio"], "normal"),
        "fps": LIP_FPS, "silent_padding_sec": _num(o.get("silent_padding"), 0.5, 0.1, 3.0)}}
    p["sync"] = {"class_type": "LatentSyncNode", "inputs": {
        "images": ["fit", 0], "audio": ["fit", 1], "seed": _seed(v.get("seed"), 0xFFFFFFFFFFFFFFFF),
        "lips_expression": _num(v.get("cfg"), 1.5, 1.0, 3.0), "inference_steps": _num(v.get("steps"), 20, 1, 999, int)}}
    p["mux"] = {"class_type": "CreateVideo", "inputs": {"images": ["sync", 0], "fps": LIP_FPS, "audio": ["sync", 1]}}
    p["out"] = {"class_type": "CCASaveVideoFile", "inputs": {"video": ["mux", 0], "filename_prefix": v["_vprefix"]}}


def _heartmula(p, o, v, tags, lyrics):
    if not str(lyrics or "").strip():
        raise ValueError("歌詞を書いてください([Verse] [Chorus] などで区切ります)")
    p["load"] = {"class_type": "FL_HeartMuLa_ModelLoader", "inputs": {
        "model_version": str(o.get("model_version") or "3B"), "memory_mode": _pick(o.get("memory_mode"), ["auto", "normal", "low", "ultra"], "auto"),
        "precision": _pick(o.get("precision"), ["auto", "fp32", "fp16", "bf16"], "auto"), "use_4bit": bool(o.get("use_4bit")), "force_reload": False}}
    p["cond"] = {"class_type": "FL_HeartMuLa_Conditioning", "inputs": {
        "model": ["load", 0], "lyrics": lyrics, "tags": tags, "cfg_scale": _num(v.get("cfg"), 1.5, 1.0, 10.0)}}
    p["samp"] = {"class_type": "FL_HeartMuLa_Sampler", "inputs": {
        "model": ["load", 0], "conditioning": ["cond", 0], "max_duration_sec": _num(o.get("duration"), 60, 10, 240, int),
        "temperature": _num(o.get("temperature"), 1.0, 0.1, 2.0), "top_k": _num(o.get("top_k"), 50, 1, 500, int),
        "seed": _seed(v.get("seed"), 2147483647)}}
    p["gen"] = {"class_type": "FL_HeartMuLa_Decode", "inputs": {"model": ["load", 0], "audio_tokens": ["samp", 0]}}
    return ["gen", 0]


def _ace(p, o, v, tags, lyrics):
    def need(k, label):
        f = v.get(k)
        if not f or f == NONE:
            raise ValueError(f"{label}を選んでください")
        return f
    seed = _seed(v.get("seed"), 0xFFFFFFFFFFFFFFFF)
    dur = _num(o.get("duration"), 120, 1, 600)
    p["unet"] = {"class_type": "UNETLoader", "inputs": {"unet_name": need("unet_name", "拡散モデル"), "weight_dtype": v.get("unet_dtype") or "default"}}
    p["shift"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["unet", 0], "shift": _num(o.get("shift"), 3.0, 0.0, 100.0)}}
    p["clip"] = {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": need("clip_name", "テキストエンコーダー"),
                                                             "clip_name2": need("clip_name_2", "言語モデル(LM)"), "type": "ace", "device": "default"}}
    p["vae"] = {"class_type": "VAELoader", "inputs": {"vae_name": need("vae_name", "VAE")}}
    p["pos"] = {"class_type": "TextEncodeAceStepAudio1.5", "inputs": {
        "clip": ["clip", 0], "tags": tags, "lyrics": INSTRUMENTAL if o.get("instrumental") else lyrics, "seed": seed,
        "bpm": _num(o.get("bpm"), 120, 10, 300, int), "duration": dur, "timesignature": _pick(str(o.get("timesig")), ["2", "3", "4", "6"], "4"),
        "language": _pick(o.get("language"), ACE_LANGS, "en"), "keyscale": _pick(o.get("keyscale"), ACE_KEYS, "C major"),
        "generate_audio_codes": bool(o.get("think")), "cfg_scale": _num(o.get("lm_cfg"), 2.0, 0.0, 100.0),
        "temperature": _num(o.get("lm_temp"), 0.85, 0.0, 2.0), "top_p": _num(o.get("lm_top_p"), 0.9, 0.0, 2000.0),
        "top_k": _num(o.get("lm_top_k"), 0, 0, 100, int), "min_p": _num(o.get("lm_min_p"), 0.0, 0.0, 1.0)}}
    p["neg"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}}
    p["lat"] = {"class_type": "EmptyAceStep1.5LatentAudio", "inputs": {"seconds": dur, "batch_size": 1}}
    p["ks"] = {"class_type": "KSampler", "inputs": {
        "model": ["shift", 0], "seed": seed, "steps": _num(v.get("steps"), 8, 1, 10000, int), "cfg": _num(v.get("cfg"), 1.0, 0.0, 100.0),
        "sampler_name": v.get("sampler_name") or "euler", "scheduler": v.get("scheduler") or "simple",
        "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["lat", 0], "denoise": 1.0}}
    p["gen"] = {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["ks", 0], "vae": ["vae", 0]}}
    return ["gen", 0]


def build_prompt(v):
    """パネルの値 v(ウィジェット名 → 値。プレフィックスは %date% などを置き換えたもの)→ (prompt, 結果の種類 "audio" / "video", 記録する設定)"""
    from .wildcards import resolve as resolve_wildcards
    mt, task = v.get("model_type"), v.get("task")
    info = TYPE_INFO.get(mt)
    if info and info["kind"] == "3d":  # 3D(TRELLIS.2)も同じ流れで作る
        from .gen3d import build_prompt as build_3d
        return build_3d(v)
    if not info or info["kind"] != "audio":
        raise ValueError(f"音声・音楽の種別ではありません: {mt}")
    if task not in info["tasks"]:
        task = info["tasks"][0]
    o = _opts(mt, v.get("audio_opts"))
    pos, neg = str(v.get("positive") or ""), str(v.get("negative") or "")
    template = ""
    try:  # ワイルドカード(__名前__)は画像・動画と同じく、生成のたびに置き換える
        rp, rn = resolve_wildcards(pos, neg, v.get("seed"))
        if (rp, rn) != (pos, neg):
            template = pos
        pos, neg = rp, rn
    except Exception:  # noqa: BLE001  置き換えられないときは書いたまま
        pass
    gen = GEN[mt]
    p = {}
    kind = "audio"
    if gen == "latentsync":
        _latentsync(p, o, v)
        kind = "video"
    else:
        if gen == "qwen_tts":
            ref = _qwen(p, o, task, pos, neg, v.get("seed"))
            if o.get("rvc_on"):  # 第43版: 読み上げた声を RVC で変える
                ref = _rvc(p, ref, o)
        elif gen == "rvc":
            p["src"] = {"class_type": "LoadAudio", "inputs": {"audio": _file(o.get("audio"), "変換する音声")}}
            ref = _rvc(p, ["src", 0], o)
        elif gen == "heartmula":
            from .compat import fix_heartmula_repos
            fix_heartmula_repos()  # コーデックの配布元が変わったので、追加ノードの設定を新しい名前に
            ref = _heartmula(p, o, v, pos, neg)
        else:
            ref = _ace(p, o, v, pos, neg)
        _save_audio(p, ref, v["_aprefix"], o)
        # ボイスクローンとき: 参照音声を名前を付けて保存する(Voices Library)
        if gen == "qwen_tts" and task == "TTC" and o.get("save_voice") and not o.get("voice"):
            p["lib"] = {"class_type": "AILab_Qwen3TTSVoicesLibrary", "inputs": {
                "reference_audio": ["ref", 0], "reference_text": str(o.get("ref_text") or ""), "model_size": p["gen"]["inputs"]["model_size"],
                "device": p["gen"]["inputs"]["device"], "precision": p["gen"]["inputs"]["precision"], "x_vector_only": bool(o.get("x_vector_only")),
                "voice_name": str(o["save_voice"]), "save_path": "", "unload_models": True}}
            p["libout"] = {"class_type": "PreviewAny", "inputs": {"source": ["lib", 0]}}
    if gen in ("latentsync", "rvc"):  # 文の欄は使わない(情報にも出さない)
        pos = neg = template = ""
    used = {"model_type": mt, "task": task, "positive": pos, "negative": neg, "template": template, "seed": v.get("seed"),
            "steps": v.get("steps"), "cfg": v.get("cfg"), "opts": o}
    if gen == "ace":
        used.update(model=v.get("unet_name"), sampler=v.get("sampler_name"), scheduler=v.get("scheduler"))
    return p, kind, used


def transcribe_prompt(value, model, lang):
    """参照音声を文にする(Whisper)。結果は PreviewAny の text で返る"""
    return {"ref": {"class_type": "LoadAudio", "inputs": {"audio": _file(value, "書き起こす声")}},
            "stt": {"class_type": "AILab_Qwen3TTSWhisperSTT", "inputs": {"audio": ["ref", 0], "model_size": _pick(model, WHISPER_MODELS, "small"),
                                                                        "language": _pick(lang, WHISPER_LANGS, "auto"), "unload_models": True}},
            "out": {"class_type": "PreviewAny", "inputs": {"source": ["stt", 0]}}}


def random_seed():
    return random.randint(0, 2 ** 31 - 1)


class CCAFramesAtFps:
    """コマ(IMAGE)を、fps から target の速さに並べ直す(近いコマを選ぶ。長さ(秒)は変わらない)"""
    CATEGORY = "CCA Generator"
    FUNCTION = "run"
    RETURN_TYPES = ("IMAGE",)
    DESCRIPTION = "動画のコマを、決まった fps(LatentSync は 25)に並べ直す。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "fps": ("FLOAT", {"default": 25.0, "min": 0.01, "max": 1000.0, "forceInput": True}),
                             "target": ("FLOAT", {"default": 25.0, "min": 1.0, "max": 240.0})}}

    def run(self, images, fps, target):
        n = int(images.shape[0])
        fps, target = float(fps or target), float(target)
        if n < 1 or abs(fps - target) < 1e-3:
            return (images,)
        m = max(1, int(round(n * target / fps)))
        idx = [min(n - 1, int((i + 0.5) * fps / target)) for i in range(m)]
        return (images[idx],)


class CCASaveVideoFile:
    """LatentSync の結果(VIDEO)を output に MP4 で保存する(保存先は生成パネルの「動画の保存先」)"""
    CATEGORY = "CCA Generator"
    FUNCTION = "save"
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    DESCRIPTION = "動画(VIDEO)を output に MP4(H.264・音声付き)で保存する。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"video": ("VIDEO",), "filename_prefix": ("STRING", {"default": "video/CCA"})}}

    def save(self, video, filename_prefix="video/CCA"):
        from comfy_api.latest import Types
        w, h = video.get_dimensions()
        folder, name, counter, sub, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory(), w, h)
        file = f"{name}_{counter:05}_.mp4"
        video.save_to(os.path.join(folder, file), format=Types.VideoContainer("mp4"), codec=Types.VideoCodec("h264"))
        return {"ui": {"cca_video": [{"filename": file, "subfolder": sub, "type": "output"}]}}


NODES = {"CCASaveVideoFile": (CCASaveVideoFile, "CCA 動画を保存(MP4)"), "CCAFramesAtFps": (CCAFramesAtFps, "CCA コマの速さを変える")}
