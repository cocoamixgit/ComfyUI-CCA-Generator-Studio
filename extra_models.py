"""第9版で追加したモデルの処理ノード。

ComfyUI 公式テンプレート(と配布元のワークフロー)と同じ手順を、コアノード(と追加ノード)を順に呼んで実行する。
処理サブグラフの中では 1 モデル = 1 ノードで、パネルの値(モデル・プロンプト・サイズ・参照画像)を受け取る。

- CCAFlux2Klein  : FLUX.2 Klein(image_flux2_klein_*)。参照画像は最大 4 枚(ReferenceLatent)
- CCAFlux3Klein  : FLUX.3 Klein(image_flux3_klein_*)。参照画像は最大 10 枚(Set Reference Multi Latent)
- CCALTX25       : LTX-2.5(video_ltx2_5_t2v / i2v / flf2v)。音声付き
- CCAKandinsky6  : Kandinsky 6(kandinskylab/kandinsky-6 の ComfyUI 版。追加ノード kandinsky6 が必要)。音声付き
"""
import re

import nodes as comfy_nodes

from .panel import CATEGORY, SAMPLERS, SCHEDULERS, NODE_INSTALL_HELP, _call, node_installed


def _exec(node_name, **kwargs):
    """V3 ノードを入力の形そのままで実行する(ResizeImageMaskNode など選択肢で入力が変わるもの)"""
    r = comfy_nodes.NODE_CLASS_MAPPINGS[node_name].execute(**kwargs)
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


EXTRA_NODES = {
    "CCAFlux2Klein": (CCAFlux2Klein, "CCA FLUX.2 Klein"),
    "CCAFlux3Klein": (CCAFlux3Klein, "CCA FLUX.3 Klein"),
    "CCALTX25": (CCALTX25, "CCA LTX-2.5"),
    "CCAKandinsky6": (CCAKandinsky6, "CCA Kandinsky 6"),
}
