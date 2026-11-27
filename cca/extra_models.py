"""第9版で追加したモデルの処理ノード。

ComfyUI 公式テンプレート(と配布元のワークフロー)と同じ手順を、コアノード(と追加ノード)を順に呼んで実行する。
処理サブグラフの中では 1 モデル = 1 ノードで、パネルの値(モデル・プロンプト・サイズ・参照画像)を受け取る。

- CCAFlux2Klein  : FLUX.2 Klein(image_flux2_klein_*)。参照画像は最大 4 枚(ReferenceLatent)
- CCAFlux3Klein  : FLUX.3 Klein(image_flux3_klein_*)。参照画像は最大 10 枚(Set Reference Multi Latent)
- CCALTX25       : LTX-2.5(video_ltx2_5_t2v / i2v / flf2v)。音声付き
- CCAKandinsky6  : Kandinsky 6(kandinskylab/kandinsky-6 の ComfyUI 版。追加ノード kandinsky6 が必要)。音声付き
- CCASenseNova   : SenseNova-U1.6(追加ノード ComfyUI-SenseNova-U1 が必要)。参照画像は最大 10 枚
"""
# NOTICE (Apache-2.0 §4): このファイルの SenseNova-U1.6 の部分(_sn_self_correct など)は、OpenSenseNova/ComfyUI-SenseNova-U1 と
# OpenSenseNova/SenseNova-U1(どちらも Apache-2.0。ライセンスの文は LICENSE-SenseNova-U1)の手順に合わせて、このパネル用に書き直したものです(変更あり)。
import re

import nodes as comfy_nodes

from .i18n import tr
from .panel import CATEGORY, SAMPLERS, SCHEDULERS, NODE_INSTALL_HELP, _call, node_installed


def _exec(node_name, **kwargs):
    """V3 ノードを入力の形そのままで実行する(ResizeImageMaskNode など選択肢で入力が変わるもの)"""
    from .panel import find_node  # 登録に無くても、読み込まれた追加ノードにあれば使う
    r = (comfy_nodes.NODE_CLASS_MAPPINGS.get(node_name) or find_node(node_name)).execute(**kwargs)
    return r.result if hasattr(r, "result") else r


def _encode(clip, text):
    return _call("CLIPTextEncode", clip=clip, text=str(text or ""))[0]


def _negative(clip, pos, negative, cfg):
    """CFG 1(蒸留版)はテンプレートと同じく ConditioningZeroOut、それ以外はネガティブを文字にする"""
    if abs(float(cfg) - 1.0) < 1e-6:
        return _call("ConditioningZeroOut", conditioning=pos)[0]
    return _encode(clip, negative)


def _refs(ref_images):
    return [r for r in (ref_images or []) if r is not None]


def _req(kind):
    return (kind, {"forceInput": True})


IMAGE_INPUTS = {
    "model": ("MODEL",), "clip": ("CLIP",), "vae": ("VAE",),
    "positive": _req("STRING"), "negative": _req("STRING"),
    "seed": _req("INT"), "steps": _req("INT"), "cfg": _req("FLOAT"),
    "sampler_name": (SAMPLERS, {"forceInput": True}), "scheduler": (SCHEDULERS, {"forceInput": True}),
    "width": _req("INT"), "height": _req("INT"), "size_by_scale": _req("BOOLEAN"),
}


# ---------------------------------------------------------------------------
# FLUX.2 Klein
# ---------------------------------------------------------------------------
class CCAFlux2Klein:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("FLUX.2 Klein(テキスト→画像 / 参照画像 4 枚までの編集)。ComfyUI 公式テンプレートと同じ手順: "
                   "CFGGuider + Flux2Scheduler + SamplerCustomAdvanced、参照画像は 1MP にして ReferenceLatent。")
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": dict(IMAGE_INPUTS), "optional": {"ref_images": ("CCA_IMAGES",)}}

    def run(self, model, clip, vae, positive, negative, seed, steps, cfg, sampler_name, scheduler,
            width, height, size_by_scale, ref_images=None):
        pos = _encode(clip, positive)
        neg = _negative(clip, pos, negative, cfg)
        refs = _refs(ref_images)[:4]
        if refs:
            # テンプレート: ImageScaleToTotalPixels(nearest-exact, 1MP, 1) → VAEEncode → ReferenceLatent(両方の条件)
            # 出力の大きさは 1 枚目(1MP にしたもの)。倍率指定・サイズ指定のときはパネルで変えた画像1の大きさ
            for i, img in enumerate(refs):
                if not (i == 0 and size_by_scale):
                    img = _call("ImageScaleToTotalPixels", image=img, upscale_method="nearest-exact",
                                megapixels=1.0, resolution_steps=1)[0]
                if i == 0:
                    width, height = img.shape[2], img.shape[1]
                lat = _call("VAEEncode", pixels=img[:, :, :, :3], vae=vae)[0]
                pos = _call("ReferenceLatent", conditioning=pos, latent=lat)[0]
                neg = _call("ReferenceLatent", conditioning=neg, latent=lat)[0]
        latent = _call("EmptyFlux2LatentImage", width=int(width), height=int(height), batch_size=1)[0]
        sigmas = _call("Flux2Scheduler", steps=int(steps), width=int(width), height=int(height))[0]
        guider = _call("CFGGuider", model=model, positive=pos, negative=neg, cfg=float(cfg))[0]
        sampler = _call("KSamplerSelect", sampler_name=sampler_name)[0]
        noise = _call("RandomNoise", noise_seed=int(seed))[0]
        out = _call("SamplerCustomAdvanced", noise=noise, guider=guider, sampler=sampler, sigmas=sigmas,
                    latent_image=latent)[0]
        return (_call("VAEDecode", samples=out, vae=vae)[0],)


# ---------------------------------------------------------------------------
# FLUX.3 Klein
# ---------------------------------------------------------------------------
class CCAFlux3Klein:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("FLUX.3 Klein(テキスト→画像 / 参照画像 10 枚までの編集)。ComfyUI 公式テンプレートと同じ手順: "
                   "KSampler、参照画像は Set Reference Multi Latent(各 1MP)。プロンプトでは <ref_image_0> から順に指す。")
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": dict(IMAGE_INPUTS), "optional": {"ref_images": ("CCA_IMAGES",)}}

    def run(self, model, clip, vae, positive, negative, seed, steps, cfg, sampler_name, scheduler,
            width, height, size_by_scale, ref_images=None):
        pos = _encode(clip, positive)
        neg = _negative(clip, pos, negative, cfg)
        refs = _refs(ref_images)[:10]
        if refs:
            images = {f"image{i}": img[:, :, :, :3] for i, img in enumerate(refs)}
            pos, neg, latent = _exec("ReferenceMultiLatent", positive=pos, negative=neg, vae=vae,
                                     resolution={"resolution": "resize", "megapixels": 1.0}, images=images)
            if size_by_scale:  # 倍率指定・サイズ指定: パネルで変えた画像1の大きさで出す
                latent = _call("EmptyFlux2LatentImage", width=int(refs[0].shape[2]),
                               height=int(refs[0].shape[1]), batch_size=1)[0]
        else:
            latent = _call("EmptyFlux2LatentImage", width=int(width), height=int(height), batch_size=1)[0]
        out = comfy_nodes.common_ksampler(model, int(seed), int(steps), float(cfg), sampler_name, scheduler,
                                          pos, neg, latent, denoise=1.0)[0]
        return (_call("VAEDecode", samples=out, vae=vae)[0],)


# ---------------------------------------------------------------------------
# LTX-2.5
# ---------------------------------------------------------------------------
LTX_NEGATIVE = "pc game, console game, video game, cartoon, childish, ugly"
LTX_SIGMAS_1 = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
LTX_SIGMAS_2 = "0.85, 0.7250, 0.4219, 0.0"


def ltx_frames(length):
    """LTX は 8n+1 フレーム"""
    return max(1, (int(length) - 1) // 8 * 8 + 1)


class CCALTX25:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("LTX-2.5(テキスト→動画 / 画像→動画 / 最初と最後の画像→動画、音声付き)。ComfyUI 公式テンプレートと同じ手順: "
                   "半分の大きさで生成 → 潜在アップスケーラーで 2 倍 → 仕上げ(最初と最後の画像のときは 1 段)。")
    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("video",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",), "clip": ("CLIP",), "vae": ("VAE",), "audio_vae": ("VAE",),
            "latent_upscale": ("LATENT_UPSCALE_MODEL",),
            "positive": _req("STRING"), "seed": _req("INT"), "width": _req("INT"), "height": _req("INT"),
            "video_length": _req("INT"), "video_fps": _req("FLOAT"),
        }, "optional": {"ref_images": ("CCA_IMAGES",)}}

    def run(self, model, clip, vae, audio_vae, latent_upscale, positive, seed, width, height, video_length,
            video_fps, ref_images=None):
        refs = _refs(ref_images)[:2]
        fps = float(video_fps)
        frames = ltx_frames(video_length)
        pos, neg = _call("LTXVConditioning", positive=_encode(clip, positive), negative=_encode(clip, LTX_NEGATIVE),
                         frame_rate=fps)
        guider = _call("LTXVDualCFGGuider", model=model, positive=pos, negative=neg, video_cfg=1.0, audio_cfg=1.0)[0]
        audio = _call("LTXVEmptyLatentAudio", frames_number=frames, frame_rate=int(round(fps)), batch_size=1,
                      audio_vae=audio_vae)[0]
        sigmas1 = _call("ManualSigmas", sigmas=LTX_SIGMAS_1)[0]
        noise = _call("RandomNoise", noise_seed=int(seed))[0]

        if len(refs) >= 2:
            # 最初と最後の画像(video_ltx2_5_flf2v): 指定の大きさに切り抜いて合わせ、1 段で生成
            first, last = (_exec("ResizeImageMaskNode", input=img[:, :, :, :3], scale_method="nearest-exact",
                                 resize_type={"resize_type": "scale dimensions", "width": int(width),
                                              "height": int(height), "crop": "center"})[0] for img in refs)
            latent = _call("EmptyLTXVLatentVideo", width=int(first.shape[2]), height=int(first.shape[1]),
                           length=frames, batch_size=1)[0]
            for img, idx in ((first, 0), (last, -1)):
                pre = _call("LTXVPreprocess", image=img, img_compression=18)[0]
                pos, neg, latent = _call("LTXVAddGuide", positive=pos, negative=neg, vae=vae, latent=latent,
                                         image=pre, frame_idx=idx, strength=0.7)
            guider = _call("LTXVDualCFGGuider", model=model, positive=pos, negative=neg, video_cfg=1.0, audio_cfg=1.0)[0]
            sampler = _call("SamplerEulerAncestral", eta=0.0, s_noise=1.0)[0]
            av = _call("LTXVConcatAVLatent", video_latent=latent, audio_latent=audio)[0]
            out = _call("SamplerCustomAdvanced", noise=noise, guider=guider, sampler=sampler, sigmas=sigmas1,
                        latent_image=av)[1]
            v, a = _call("LTXVSeparateAVLatent", av_latent=out)
            pos, neg, v = _call("LTXVCropGuides", positive=pos, negative=neg, latent=v)
        else:
            # テキスト→動画 / 画像→動画(video_ltx2_5_t2v・i2v): 半分の大きさ → 2 倍 → 仕上げ
            latent = _call("EmptyLTXVLatentVideo", width=int(width) // 2, height=int(height) // 2, length=frames,
                           batch_size=1)[0]
            pre = None
            if refs:
                img = _exec("ResizeImageMaskNode", input=refs[0][:, :, :, :3], scale_method="lanczos",
                            resize_type={"resize_type": "scale longer dimension", "longer_size": 1536})[0]
                pre = _call("LTXVPreprocess", image=img, img_compression=18)[0]
                latent = _call("LTXVImgToVideoInplace", vae=vae, image=pre, latent=latent, strength=0.7, bypass=False)[0]
            sampler = _call("KSamplerSelect", sampler_name="euler_ancestral")[0]
            av = _call("LTXVConcatAVLatent", video_latent=latent, audio_latent=audio)[0]
            out = _call("SamplerCustomAdvanced", noise=noise, guider=guider, sampler=sampler, sigmas=sigmas1,
                        latent_image=av)[0]
            v, a = _call("LTXVSeparateAVLatent", av_latent=out)
            v = _call("LTXVLatentUpsampler", samples=v, upscale_model=latent_upscale, vae=vae)[0]
            if pre is not None:
                v = _call("LTXVImgToVideoInplace", vae=vae, image=pre, latent=v, strength=1.0, bypass=False)[0]
            av = _call("LTXVConcatAVLatent", video_latent=v, audio_latent=a)[0]
            out = _call("SamplerCustomAdvanced", noise=_call("RandomNoise", noise_seed=42)[0], guider=guider,
                        sampler=sampler, sigmas=_call("ManualSigmas", sigmas=LTX_SIGMAS_2)[0], latent_image=av)[0]
            v, a = _call("LTXVSeparateAVLatent", av_latent=out)

        images = _call("VAEDecodeTiled", samples=v, vae=vae, tile_size=512, overlap=64, temporal_size=64,
                       temporal_overlap=16)[0]
        sound = _call("LTXVAudioVAEDecode", samples=a, audio_vae=audio_vae)[0]
        return (_call("CreateVideo", images=images, fps=fps, audio=sound)[0],)


# ---------------------------------------------------------------------------
# Kandinsky 6
# ---------------------------------------------------------------------------
# プロンプトの「Audio:」(または「音:」「音声:」)の行から下を音の説明にする(Kandinsky 6 は映像と音の説明を分けて渡す)
AUDIO_MARK = re.compile(r"^\s*(?:audio|音声|音)\s*[:：]\s*", re.IGNORECASE | re.MULTILINE)


def split_audio(text):
    text = str(text or "")
    m = AUDIO_MARK.search(text)
    if not m:
        return text.strip(), ""
    return text[:m.start()].strip(), text[m.end():].strip()


def k6_frames(length):
    """Kandinsky 6 は 4n+1 フレーム"""
    return max(1, (int(length) - 1) // 4 * 4 + 1)


class CCAKandinsky6:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("Kandinsky 6(テキスト→動画 / 画像→動画、音声付き)。配布元のワークフローと同じ手順(追加ノード kandinsky6 が必要)。"
                   "プロンプトの「Audio:」の行から下が音の説明。")
    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("video",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",), "clip": ("CLIP",), "vae": ("VAE",), "audio_vae": ("VAE",),
            "positive": _req("STRING"), "negative": _req("STRING"),
            "seed": _req("INT"), "steps": _req("INT"), "cfg": _req("FLOAT"),
            "sampler_name": (SAMPLERS, {"forceInput": True}), "scheduler": (SCHEDULERS, {"forceInput": True}),
            "width": _req("INT"), "height": _req("INT"), "video_length": _req("INT"), "video_fps": _req("FLOAT"),
        }, "optional": {"ref_images": ("CCA_IMAGES",)}}

    def run(self, model, clip, vae, audio_vae, positive, negative, seed, steps, cfg, sampler_name, scheduler,
            width, height, video_length, video_fps, ref_images=None):
        if not node_installed("Kandinsky6Sampler"):
            raise ValueError("[Kandinsky 6] " + NODE_INSTALL_HELP["Kandinsky6Sampler"])
        M = comfy_nodes.NODE_CLASS_MAPPINGS
        video_cap, audio_cap = split_audio(positive)
        pos = _call("Kandinsky6TextEncode", clip=clip, video_caption=video_cap, audio_caption=audio_cap)[0]
        neg = _call("Kandinsky6TextEncode", clip=clip, video_caption=str(negative or ""), audio_caption="")[0]
        w, h = int(width) // 16 * 16, int(height) // 16 * 16
        latent, fps = _call("Kandinsky6EmptyLatent", width=w, height=h, length=k6_frames(video_length),
                            fps=float(video_fps), batch_size=1)
        refs = _refs(ref_images)[:1]
        if refs:
            img = _call("ImageScale", image=refs[0][:, :, :, :3], upscale_method="bilinear", width=w, height=h,
                        crop="center")[0]
            ref_lat = _call("VAEEncode", pixels=img, vae=vae)[0]
            pos, neg, latent = _call("Kandinsky6ImageToVideoAudio", positive=pos, negative=neg, empty_latent=latent,
                                     reference_latent=ref_lat)
        sampler = M["Kandinsky6Sampler"]()
        out = sampler.sample(model, int(seed), int(steps), float(cfg), sampler_name, scheduler, pos, neg, latent,
                             denoise=1.0)[0]
        if refs:
            out = _call("Kandinsky6RemoveReferenceLatent", joint_latent=out)[0]
        images = _call("VAEDecode", samples=out, vae=vae)[0]
        sound = _call("Kandinsky6AudioVAEDecode", audio_vae=audio_vae, joint_latent=out)[0]
        return (_call("CreateVideo", images=images, fps=float(fps), audio=sound)[0],)


# ---------------------------------------------------------------------------
# SenseNova-U1.6(追加ノード ComfyUI-SenseNova-U1 の Local Text to Image / Local Image Edit を呼ぶ)
# ---------------------------------------------------------------------------
SN_EDIT_PIXELS = 2048 * 2048  # 編集の出力の大きさ(追加ノードのおすすめ: 4MP。縦横比は画像1に合わせる)


def _sn_find_ensure(node):
    """追加ノードの _ensure_local_model_loaded を探す(モジュール名での検索に頼らず、ノードの関数の持ち主から取る)"""
    import sys
    for f in (getattr(node, "execute", None), getattr(node, "run", None)):
        fn = getattr(f, "__func__", f)
        g = getattr(fn, "__globals__", None)
        if g and callable(g.get("_ensure_local_model_loaded")):
            return g["_ensure_local_model_loaded"]
    m = sys.modules.get(getattr(node, "__module__", ""))
    if m is not None and callable(getattr(m, "_ensure_local_model_loaded", None)):
        return m._ensure_local_model_loaded
    for m in list(sys.modules.values()):
        fn = getattr(m, "_ensure_local_model_loaded", None) if m is not None and "SenseNova" in getattr(m, "__name__", "") + str(getattr(m, "__file__", "")) else None
        if callable(fn):
            return fn
    return None


def _sn_self_correct(model, prompt, refs, width, height, steps, cfg, seed, passes):
    """SenseNova-U1.6 の自己修正(配布元の examples/interleave/self_correction.py と同じ: 画像生成用のシステムメッセージ・
    think なし)。作った画像をプロンプトと見比べて作り直すのを、最大 passes 回まで行い、最後の画像を返す"""
    import inspect
    import sys
    import traceback
    import torch
    from sensenova_u1.models.neo_unify.utils import SYSTEM_MESSAGE_FOR_GEN, smart_resize
    from .panel import find_node
    if not prompt.strip():
        raise ValueError(tr("[SenseNova-U1.6] 自己修正にはプロンプトが必要です。"))
    node = find_node("SenseNovaU1LocalTextToImage")
    ensure = _sn_find_ensure(node) if node else None
    if ensure:
        loaded = ensure(model)
        if loaded is not None:  # 戻り値が無い版では、渡したモデルをそのまま使う(その場で読み込まれる)
            model = loaded
    pipe = sys.modules[type(model).__module__]  # 追加ノードの local_pipeline(画像の変換に使う)
    if getattr(model, "model", None) is None or getattr(model, "tokenizer", None) is None:
        raise ValueError("[SenseNova-U1.6] 自己修正: モデルがまだ読み込まれていません(追加ノードの読み込み関数が見つかりませんでした)。"
                         "追加ノード ComfyUI-SenseNova-U1 を最新にして、もう一度試してください。")
    images = [pipe.comfy_image_to_pil(r) for r in refs]
    if images:
        h, w = smart_resize(images[0].height, images[0].width)
    else:
        w, h = max(32, int(width) // 32 * 32), max(32, int(height) // 32 * 32)
    base = dict(images=images or None, image_size=(int(w), int(h)), cfg_scale=float(cfg), img_cfg_scale=1.0,
                timestep_shift=3.0, cfg_interval=(0.0, 1.0), num_steps=int(steps), system_message=SYSTEM_MESSAGE_FOR_GEN,
                think_mode=False, seed=int(seed))

    def run_gen(extra):
        with torch.inference_mode(), model._offload_ctx() as m:
            fn = m.interleave_gen
            ps = inspect.signature(fn).parameters
            kw = {**base, **extra}
            if "system_message" in extra and extra["system_message"] is None:
                kw.pop("system_message", None)
            if not any(v.kind is v.VAR_KEYWORD for v in ps.values()):  # 版で無い引数は渡さない
                kw = {k: v for k, v in kw.items() if k in ps}
            return fn(model.tokenizer, prompt, **kw)

    def describe(e):  # どの行の何が None だったかまで出す
        import linecache
        out = []
        for fr, ln in traceback.walk_tb(e.__traceback__):
            name = fr.f_code.co_name
            if name in ("_t2i_predict_v", "interleave_gen"):
                src = linecache.getline(fr.f_code.co_filename, ln).strip()
                nones = [k for k, v in fr.f_locals.items() if v is None and k != "self"]
                out.append(f"{name}:{ln} `{src}` None={nones}")
        return " / ".join(out)

    # 1) 公式の自己修正と同じ: 画像の最大枚数を渡して、作り直しながら進める。2) それが使えない版・状態では、追加ノードの
    #    Interleave と同じ呼び出し(枚数を渡さない)に切り替える(その場合は作り直しなしで 1 回分)
    # 3) 4) システムメッセージを渡さない(interleave_gen の既定。追加ノードの Interleave と同じ)呼び出しも試す
    text_last = ""
    attempts = [{"max_images": int(passes) + 1}, {}, {"max_images": int(passes) + 1, "system_message": None}, {"system_message": None}]
    err, outs, text = None, [], ""
    for i, extra in enumerate(attempts):
        try:
            text, outs = run_gen(extra)
            outs = [o for o in (outs or []) if o is not None]
            if not outs:  # 例外にはならなかったが、画像が出なかった(文字だけ): 次の呼び出し方を試す
                print(f"[CCA Generator] SenseNova-U1.6 自己修正(試行 {i + 1}/{len(attempts)}: {sorted(extra)})は画像なし。モデルの文字: {str(text)[:300]!r}")
                err, text_last = None, text
                continue
            err = None
            if i > 0:
                print(f"[CCA Generator] SenseNova-U1.6 自己修正: 試行 {i + 1} の呼び出し({sorted(extra)})で作りました(最初の呼び出しは失敗)。")
            break
        except Exception as e:  # noqa: BLE001
            err = e
            print(f"[CCA Generator] SenseNova-U1.6 自己修正(試行 {i + 1}/{len(attempts)}: {sorted(extra)})で失敗: {type(e).__name__}: {e}")
            traceback.print_exc()
    if err is not None:
        tb = traceback.extract_tb(err.__traceback__)[-3:]
        where = " <- ".join(f"{fr.filename.replace(chr(92), '/').split('/')[-1]}:{fr.lineno} {fr.name}" for fr in reversed(tb))
        try:
            import importlib.metadata as md
            import sensenova_u1.models.neo_unify.utils as U
            ver = md.version("sensenova-u1")
            consts = [n for n in dir(U) if n.startswith("SYSTEM_MESSAGE")]
            ps = list(inspect.signature(model.model.interleave_gen).parameters)
        except Exception:  # noqa: BLE001
            ver, consts, ps = "?", [], []
        print(f"[CCA Generator] sensenova-u1 {ver} / {consts} / interleave_gen{ps}")
        raise ValueError(f"[SenseNova-U1.6] 自己修正で失敗しました: {type(err).__name__}: {err}({where}) {describe(err)} [sensenova-u1 {ver}; {consts}; interleave_gen{ps}]") from err
    if not outs:  # どの呼び出し方でも画像が出ない: None を返し、呼び出し側が普通の生成に切り替える
        print("[CCA Generator] SenseNova-U1.6 自己修正では画像が出なかったため、普通の生成に切り替えます。")
        return None
    print(f"[CCA Generator] SenseNova-U1.6 自己修正: {len(outs)} 枚作り、最後の画像を使います。\n{text}")
    return pipe._pil_images_to_comfy_batch([pipe._single_tensor_to_pil(outs[-1])])


def _exec_filled(node_name, **kwargs):
    """_exec に、ノードの必須入力のうち渡していないもの(max_tokens など、ComfyUI の版で増えた入力)を、
    ノード自身の既定値で補って渡す"""
    import inspect
    from .panel import find_node
    cls = comfy_nodes.NODE_CLASS_MAPPINGS.get(node_name) or find_node(node_name)
    try:
        params = inspect.signature(cls.execute).parameters
        defaults = {}
        try:
            for inp in cls.GET_SCHEMA().inputs:
                d = getattr(inp, "default", None)
                if d is not None:
                    defaults[getattr(inp, "id", None)] = d
        except Exception:  # noqa: BLE001
            pass
        for name, p in params.items():
            if p.kind is inspect.Parameter.KEYWORD_ONLY and p.default is inspect.Parameter.empty and name not in kwargs:
                if name in defaults:
                    kwargs[name] = defaults[name]
                elif name == "max_tokens":
                    kwargs[name] = 1024
    except (TypeError, ValueError):
        pass
    return _exec(node_name, **kwargs)


def _sn_task_kwargs(node_name, combo_id, key, **given):
    """V3 の DynamicCombo(SenseNovaConditioning の task)に渡す辞書を、ノード自身の定義から組み立てる。
    定義の取得に失敗したときは given だけで渡す"""
    from .panel import find_node
    out = {combo_id: key}
    ids = None
    try:
        for inp in find_node(node_name).GET_SCHEMA().inputs:
            if getattr(inp, "id", None) == combo_id:
                for opt in getattr(inp, "options", []):
                    if getattr(opt, "key", None) == key:
                        ids = [(i.id, getattr(i, "default", None)) for i in opt.inputs]
    except Exception:  # noqa: BLE001
        pass
    for i, d in (ids or []):
        if i in given:
            if given[i] is not None:
                out[i] = given[i]
        elif d is not None:
            out[i] = 1024 if isinstance(d, int) and not isinstance(d, bool) and d < 1024 and ("token" in i or "length" in i) else d
    for k, v in given.items():
        if v is not None and k not in out and not ids:
            out[k] = v
    return out, ids


def _sn_last_image(images):
    """SenseNovaInterleaveDecode の画像は、1 枚ごとに [1, H, W, 3] の「画像のリスト」(1 枚も無いときは ExecutionBlocker 入りのリスト)。
    そのまま保存ノードに渡すと 4 次元の画像として扱われて保存に失敗するので、自己修正の結果である最後の 1 枚を [1, H, W, 3] にして返す。
    画像が無ければ None"""
    if isinstance(images, (list, tuple)):
        images = next((x for x in reversed(images) if hasattr(x, "shape")), None)
    if images is None:
        return None
    if images.ndim == 3:
        images = images.unsqueeze(0)
    return images


def _sn_core_generate(core, positive, refs, width, height, size_by_scale, seed, steps, cfg, passes):
    """ComfyUI 本体のノードで動かす SenseNova-U1.6。公式ワークフロー(image_sensenova_u16_t2i)と同じ:
    自己修正なし = CLIPTextEncode → KSampler → VAEDecode。
    自己修正あり = HiDreamO1ReferenceImages → [SenseNovaConditioning(self-correction) → KSampler] を回し(回数 = 最大回数 + 1、
    Seed は 1 回ごとに +1、画像を作り直さないと決めたら止める)→ SenseNovaInterleaveDecode"""
    import math
    clip, vae, model = core.clip, core.vae, core.model
    pos = _encode(clip, positive)
    neg = _encode(clip, "")
    if refs:
        ph, pw = int(refs[0].shape[1]), int(refs[0].shape[2])
        if size_by_scale:
            w, h = max(32, pw // 32 * 32), max(32, ph // 32 * 32)
        else:
            k = math.sqrt(SN_EDIT_PIXELS / float(pw * ph))
            w, h = max(32, round(pw * k / 32) * 32), max(32, round(ph * k / 32) * 32)
    else:
        w, h = max(32, int(width) // 32 * 32), max(32, int(height) // 32 * 32)
    from .panel import call_node
    latent0 = call_node("EmptyHiDreamO1LatentImage", width=w, height=h, batch_size=1)[0]

    def ref_cond(pos_, neg_):
        if refs:
            return _exec("HiDreamO1ReferenceImages", positive=pos_, negative=neg_,
                         images={f"image_{i}": r for i, r in enumerate(refs, 1)})
        try:
            return _exec("HiDreamO1ReferenceImages", positive=pos_, negative=neg_)
        except TypeError:
            return _exec("HiDreamO1ReferenceImages", positive=pos_, negative=neg_, images={})

    def sample(s, p_, n_):
        return _call("KSampler", model=model, seed=int(s), steps=int(steps), cfg=float(cfg), sampler_name="euler",
                     scheduler="simple", positive=p_, negative=n_, latent_image=latent0, denoise=1.0)[0]

    from .panel import find_node
    M = comfy_nodes.NODE_CLASS_MAPPINGS
    found = [k for k in M if "sensenova" in k.lower() or "interleave" in k.lower()]
    for want, key in (("SenseNovaConditioning", "conditioning"), ("SenseNovaInterleaveDecode", "interleave")):
        if want not in M:  # 名前の大文字小文字・接頭辞が違って登録されているとき
            alt = next((k for k in found if key in k.lower() and ("decode" in k.lower() or key == "conditioning")), None)
            if alt:
                M[want] = M[alt]
    if passes > 0 and not (comfy_nodes.NODE_CLASS_MAPPINGS.get("SenseNovaConditioning") or find_node("SenseNovaConditioning")):
        # ComfyUI 本体が古くてノードが無い: 自己修正は飛ばして、普通に生成する(ComfyUI を更新すると自己修正も使える)
        import os
        import folder_paths
        _base = os.path.abspath(folder_paths.base_path)
        _bat = os.path.join(os.path.dirname(_base), "update", "update_comfyui.bat")
        _msg = tr("[SenseNova-U1.6] 自己修正に使う ComfyUI 本体のノード(SenseNovaConditioning)が見つかりません。自己修正なしで生成します。\nComfyUI を nightly(最新の開発版)にすると使えます。\n・ポータブル版: update フォルダの update_comfyui.bat を実行します(stable ではなく最新の開発版になります)。\n・git で入れた場合: ComfyUI フォルダで「git checkout master」「git pull」を実行し、「pip install -r requirements.txt」を実行して再起動します。\n・ComfyUI Manager: 「Switch ComfyUI」で nightly を選んで更新し、再起動します。\n・デスクトップ版は stable にしか更新されないため、ポータブル版か git 版を使ってください。\n\n起動中の ComfyUI の場所: {path}\nポータブル版の更新ファイル: {bat}", path=_base, bat=("[ComfyUI に入っている SenseNova 系ノード: " + (", ".join(found) or "なし") + "] ") + _bat + ("" if os.path.isfile(_bat) else tr("(この場所には見つかりません。ポータブル版ではありません)")))
        print("[CCA Generator] " + _msg)
        try:  # 画面にも出す
            from server import PromptServer
            PromptServer.instance.send_sync("cca_generator.notice", {"text": _msg})
        except Exception:  # noqa: BLE001
            pass
        passes = 0
    if passes <= 0:
        if refs:
            pos, neg = ref_cond(pos, neg)[:2]
        return _call("VAEDecode", samples=sample(seed, pos, neg), vae=vae)[0]

    cond, negc = ref_cond(pos, neg)[:2]
    lat = None
    log = []
    for it in range(int(passes) + 1):
        task, ids = _sn_task_kwargs("SenseNovaConditioning", "task", "self-correction", samples=lat)
        try:
            r = _exec_filled("SenseNovaConditioning", conditioning=cond, clip=clip, negative=negc, task=task)
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"[SenseNova-U1.6] SenseNovaConditioning の呼び出しに失敗しました: {type(e).__name__}: {e}"
                             f"(task の入力: {ids}、渡した値: {sorted(task)})") from e
        cond, text, negc, requested = r[0], r[1], r[2], r[3]
        log.append(str(text)[:200])
        print(f"[CCA Generator] SenseNova-U1.6 自己修正 {it + 1}/{int(passes) + 1}: 画像を作る={bool(requested)} 文字={str(text)[:200]!r}")
        if requested or lat is None:
            lat = sample(int(seed) + it, cond, negc)
        else:  # 作り直さない = これで仕上がり
            break
    if lat is None:
        raise ValueError("[SenseNova-U1.6] 自己修正で画像が作られませんでした。プロンプトを変えるか、自己修正を 0 にしてください。")
    out = _exec_filled("SenseNovaInterleaveDecode", clip=clip, conditioning=cond, samples=lat)
    images = _sn_last_image(out[1])
    if images is None:
        images = _call("VAEDecode", samples=lat, vae=vae)[0]
    return images


_SN_PE_CLIPS = {}


def _sn_pe_rewrite(clip_name, prompt, refs, seed):
    """PE: テキストエンコーダー(Qwen3.5 9B PE)にシステムプロンプトと指示を渡して、画像モデル向けのプロンプトに書き直す(TextGenerateV2)。
    参照画像があれば画像編集用(画像も一緒に渡す)、無ければテキスト→画像用(短い指示を細かい描写にする)"""
    import os
    clip = _SN_PE_CLIPS.get(clip_name)
    if clip is None:
        _SN_PE_CLIPS.clear()
        clip = _SN_PE_CLIPS[clip_name] = _call("CLIPLoader", clip_name=clip_name, type="stable_diffusion", device="default")[0]
    with open(os.path.join(os.path.dirname(__file__), "sn_pe_system.txt" if refs else "sn_pe_t2i_system.txt"), encoding="utf-8") as f:
        system = f.read()
    sampling, _ = _sn_task_kwargs("TextGenerateV2", "sampling_mode", "on", temperature=1.0, top_k=20, top_p=0.95, min_p=0.0,
                                  repetition_penalty=1.0, presence_penalty=1.5, seed=int(seed))
    extra = {"images": {f"image{i}": im for i, im in enumerate(refs, 1)}} if refs else {}
    r = _exec("TextGenerateV2", clip=clip, prompt=str(prompt or ""), system_prompt=system, max_length=8192, sampling_mode=sampling,
              thinking=True, use_default_template=True, mtp="auto", **extra)
    text = " ".join(str(r[0] or "").split())
    if not text:
        raise ValueError(tr("[SenseNova-U1.6] テキストエンコーダー(PE)がプロンプトを返しませんでした。PE を OFF にするか、テキストエンコーダーを確かめてください。"))
    print(f"[CCA Generator] SenseNova-U1.6 PE: {text[:300]!r}")
    return text


class CCASenseNova:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("SenseNova-U1.6(テキスト→画像 / 参照画像 10 枚までの編集)。追加ノード ComfyUI-SenseNova-U1 の "
                   "Local Text to Image / Local Image Edit と同じ処理(モデルはパネルで読み込んだもの)。")
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",), "positive": _req("STRING"), "seed": _req("INT"), "steps": _req("INT"), "cfg": _req("FLOAT"),
            "width": _req("INT"), "height": _req("INT"), "size_by_scale": _req("BOOLEAN"),
        }, "optional": {"ref_images": ("CCA_IMAGES",)}}

    def run(self, model, positive, seed, steps, cfg, width, height, size_by_scale, ref_images=None):
        from .panel import SNCore
        pe = getattr(model, "_cca_sn_pe", None)
        if pe:  # PE が ON のとき、プロンプトを書き直す(参照画像があれば画像編集用)
            positive = _sn_pe_rewrite(pe, positive, [r[:, :, :, :3] for r in _refs(ref_images)[:10]], seed)
        if isinstance(model, SNCore):  # 「Core | …」: ComfyUI 本体のノード(公式ワークフローと同じ)
            refs = [r[:, :, :, :3] for r in _refs(ref_images)[:10]]
            return (_sn_core_generate(model, str(positive or ""), refs, width, height, size_by_scale, int(seed) % (2 ** 31),
                                      steps, cfg, int(getattr(model, "_cca_sn_passes", 0) or 0)),)
        if not node_installed("SenseNovaU1ModelLoader"):
            raise ValueError("[SenseNova-U1.6] " + NODE_INSTALL_HELP["SenseNovaU1ModelLoader"])
        from .panel import call_node, find_node
        refs = [r[:, :, :, :3] for r in _refs(ref_images)[:10]]
        passes = int(getattr(model, "_cca_sn_passes", 0) or 0)
        if passes > 0:
            # 追加ノード方式の自己修正(interleave_gen)はライブラリの不具合で画像を作れない。公式ワークフローと同じ方式(ComfyUI 本体のノード)で行う
            from .panel import sn_core_from_handle
            core = sn_core_from_handle(model)
            if core is None:
                raise ValueError(tr("[SenseNova-U1.6] 自己修正には、公式ワークフローと同じ方式で動かす Comfy-Org 版のモデルが必要です。"
                                    "models/checkpoints に sensenova_u1.6_8b_mot_int8_convrot.safetensors を入れるか、自己修正を 0 にしてください。\n入手先: https://huggingface.co/Comfy-Org/SenseNova-U1/tree/main/checkpoints"))
            print(f"[CCA Generator] SenseNova-U1.6 自己修正: 公式の方式で行います(モデル: models/checkpoints/{core._cca_ckpt})")
            return (_sn_core_generate(core, str(positive or ""), refs, width, height, size_by_scale, int(seed) % (2 ** 31), steps, cfg, passes),)
        common = dict(u1_model=model, prompt=str(positive or ""), cfg_scale=float(cfg), cfg_norm="none", timestep_shift=3.0,
                      cfg_interval_start=0.0, cfg_interval_end=1.0, num_steps=int(steps), batch_size=1,
                      seed=int(seed) % (2 ** 31), think_mode=False)
        if refs:
            if find_node("SenseNovaU1ModelLoader") is not None:
                # 倍率指定・サイズ指定: パネルで変えた画像1の大きさのまま。それ以外は 4MP(縦横比は画像1)
                size = {"mode": "match_input"} if size_by_scale else {"mode": "auto", "target_pixels": SN_EDIT_PIXELS}
                out = call_node("SenseNovaU1LocalImageEdit", image=refs[0], reference_images={f"image{i + 2}": r for i, r in enumerate(refs[1:])},
                                output_size=size, img_cfg_scale=1.0, **common)
            else:  # 追加ノード 0.2.0 まで: 画像は 1 枚だけ
                if len(refs) > 1:
                    raise ValueError(tr('[{model_type}] {what}は、追加ノード ComfyUI-SenseNova-U1 の 0.3.0 以降で使えます(今入っているのは古い版です)。ComfyUI Manager などで追加ノードを更新して、ComfyUI を起動し直してください。', model_type="SenseNova-U1.6", what=tr("入力画像 2 枚目以降")))
                w, h = max(32, int(refs[0].shape[2]) // 32 * 32), max(32, int(refs[0].shape[1]) // 32 * 32)
                out = call_node("SenseNovaU1LocalImageEdit", image=refs[0], auto_size=not size_by_scale, width=w, height=h,
                                target_megapixels=SN_EDIT_PIXELS / 1e6, img_cfg_scale=1.0, **common)
        else:
            w, h = max(32, int(width) // 32 * 32), max(32, int(height) // 32 * 32)
            out = call_node("SenseNovaU1LocalTextToImage", resolution=f"{w}x{h}", **common)
        return (out[0],)


EXTRA_NODES = {
    "CCAFlux2Klein": (CCAFlux2Klein, "CCA FLUX.2 Klein"),
    "CCAFlux3Klein": (CCAFlux3Klein, "CCA FLUX.3 Klein"),
    "CCALTX25": (CCALTX25, "CCA LTX-2.5"),
    "CCAKandinsky6": (CCAKandinsky6, "CCA Kandinsky 6"),
    "CCASenseNova": (CCASenseNova, "CCA SenseNova-U1.6"),
}
