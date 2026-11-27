"""見つからないファイルのダウンロード先の案内。

配布ページはネット検索で調べた候補(Hugging Face のリポジトリ/フォルダのページ)。直接ダウンロードの URL は
確かめられないため、ファイルを選べるページへのリンクにしている。どれにも当てはまらないファイルは検索リンクだけを出す。
"""
from urllib.parse import quote

HF = "https://huggingface.co/"
WAN22 = HF + "Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/"
QWEN = HF + "Comfy-Org/Qwen-Image_ComfyUI/tree/main/split_files/"

# (ファイル名に含まれる語(すべて), 含まれてはいけない語, [(ラベル, URL)])
LTX = HF + "Lightricks/LTX-2.5/tree/main/"
FLUX3 = HF + "black-forest-labs/flux-3-image-klein-comfy/tree/main"
HUNYUAN = HF + "Comfy-Org/HunyuanVideo_repackaged/tree/main/split_files/"
GATED = "(ライセンスへの同意とアクセス申請が必要)"

RULES = [
    # ---- 第14版: 画像編集の「オブジェクト除去」(FLUX.2 Klein 4B 用の LoRA。fal・Apache-2.0) ----
    (["kdekt5q7"], [], [("fal/flux-2-klein-4B-object-remove-lora", HF + "fal/flux-2-klein-4B-object-remove-lora/tree/main")]),
    (["object-remove"], [], [("fal/flux-2-klein-4B-object-remove-lora", HF + "fal/flux-2-klein-4B-object-remove-lora/tree/main")]),
    # ---- 第42版: ACE-Step 1.5(Comfy-Org/ace_step_1.5_ComfyUI_files)----
    (["acestep_v1.5"], [], [("Comfy-Org/ace_step_1.5_ComfyUI_files (diffusion_models)", HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/diffusion_models")]),
    (["ace15"], [], [("Comfy-Org/ace_step_1.5_ComfyUI_files (text_encoders)", HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/text_encoders")]),
    (["ace_1.5_vae"], [], [("Comfy-Org/ace_step_1.5_ComfyUI_files (vae)", HF + "Comfy-Org/ace_step_1.5_ComfyUI_files/tree/main/split_files/vae")]),
    # ---- 第9版: FLUX.2 Klein / FLUX.3 Klein / LTX-2.5 / Kandinsky 6 ----
    (["flux-2-klein-base-4b"], [], [("black-forest-labs/FLUX.2-klein-base-4b-fp8", HF + "black-forest-labs/FLUX.2-klein-base-4b-fp8/tree/main")]),
    (["flux-2-klein-4b"], [], [("black-forest-labs/FLUX.2-klein-4b-fp8", HF + "black-forest-labs/FLUX.2-klein-4b-fp8/tree/main")]),
    (["flux-2-klein-base-9b"], [], [("black-forest-labs/FLUX.2-klein-base-9b-fp8" + GATED, HF + "black-forest-labs/FLUX.2-klein-base-9b-fp8")]),
    (["flux-2-klein-9b"], [], [("black-forest-labs/FLUX.2-klein-9b-fp8" + GATED, HF + "black-forest-labs/FLUX.2-klein-9b-fp8")]),
    (["qwen_3_4b"], [], [("Comfy-Org/flux2-klein-4B (text_encoders)", HF + "Comfy-Org/flux2-klein-4B/tree/main/split_files/text_encoders")]),
    (["qwen_3_8b"], [], [("Comfy-Org/flux2-klein-9B (text_encoders)", HF + "Comfy-Org/flux2-klein-9B/tree/main/split_files/text_encoders")]),
    (["flux3-image-klein"], [], [("black-forest-labs/flux-3-image-klein-comfy" + GATED, FLUX3)]),
    (["qwen3vl_4b_int8"], [], [("black-forest-labs/flux-3-image-klein-comfy" + GATED, FLUX3)]),
    (["flux2-vae_small"], [], [("Comfy-Org/MOSS-Image", HF + "Comfy-Org/MOSS-Image/tree/main")]),
    (["flux2-vae"], [], [
        ("Comfy-Org/flux2-dev (vae)", HF + "Comfy-Org/flux2-dev/tree/main/split_files/vae"),
        ("black-forest-labs/flux-3-image-klein-comfy" + GATED, FLUX3),
    ]),
    (["ltx-2.5", "latent", "upscaler"], [], [("Lightricks/LTX-2.5 (latent_upscale_models)" + GATED, LTX + "latent_upscale_models")]),
    (["ltx-2.5", "vae"], [], [("Lightricks/LTX-2.5 (vae)" + GATED, LTX + "vae")]),
    (["gemma4", "ltx"], [], [("Lightricks/LTX-2.5 (text_encoders)" + GATED, LTX + "text_encoders")]),
    (["ltx-2.5"], [], [("Lightricks/LTX-2.5 (diffusion_models)" + GATED, LTX + "diffusion_models")]),
    (["kandinsky-6.0-lite"], [], [("kandinskylab/Kandinsky-6.0-Lite-distill-5s-Diffusers(transformer フォルダごと)",
                                   HF + "kandinskylab/Kandinsky-6.0-Lite-distill-5s-Diffusers/tree/main/transformer")]),
    (["kandinsky-6.0-pro-5s"], [], [("kandinskylab/Kandinsky-6.0-Pro-5s-Diffusers(transformer フォルダごと)",
                                     HF + "kandinskylab/Kandinsky-6.0-Pro-5s-Diffusers/tree/main/transformer")]),
    (["kandinsky-6.0"], [], [("kandinskylab/Kandinsky-6.0-Pro-distill-5s-Diffusers(transformer フォルダごと)",
                              HF + "kandinskylab/Kandinsky-6.0-Pro-distill-5s-Diffusers/tree/main/transformer"),
                             ("kandinsky6 の説明(置き場所の一覧)", "https://github.com/kandinskylab/kandinsky-6/tree/main/comfyui")]),
    (["clip_l"], [], [("Comfy-Org/HunyuanVideo_repackaged (text_encoders)", HUNYUAN + "text_encoders")]),
    (["hunyuan_video_vae"], [], [("Comfy-Org/HunyuanVideo_repackaged (vae)", HUNYUAN + "vae")]),
    (["moss_image_edit"], [], [
        ("Comfy-Org/MOSS-Image(Edit LoRA・公式 rank64)", HF + "Comfy-Org/MOSS-Image/tree/main"),
        ("chinoll/Moss-Image-Edit(Edit LoRA)", HF + "chinoll/Moss-Image-Edit"),
        ("MOSS-Image Edit HQ v5 の紹介(物の追加に強い版)", "https://comfyui-wiki.com/en/news/2026-10-25-moss-image-edit-hq"),
    ]),
    (["8-steps-dmd"], [], [("lodestones/MOSS-Image-SFT-8-steps-dmd", HF + "lodestones/MOSS-Image-SFT-8-steps-dmd")]),
    (["moss_image"], [], [("Comfy-Org/MOSS-Image", HF + "Comfy-Org/MOSS-Image/tree/main")]),
    (["qwen3.5_9b"], [], [
        ("Comfy-Org/MOSS-Image", HF + "Comfy-Org/MOSS-Image/tree/main"),
        ("Comfy-Org/MiniMax-H3-Image", HF + "Comfy-Org/MiniMax-H3-Image/tree/main"),
    ]),
    (["pdmd"], [], [("akhaliq/minimax-h3-image-pdmd-2step", HF + "akhaliq/minimax-h3-image-pdmd-2step/tree/main")]),
    (["minimax_h3", "turbo"], [], [
        ("lightx2v/Minimax-h3-Turbo", HF + "lightx2v/Minimax-h3-Turbo/tree/main"),
        ("Comfy-Org/MiniMax-H3(loras)", HF + "Comfy-Org/MiniMax-H3/tree/main/loras"),
    ]),
    (["minimax_h3_image"], [], [("Comfy-Org/MiniMax-H3-Image", HF + "Comfy-Org/MiniMax-H3-Image/tree/main")]),
    (["minimax_h3"], [], [("Comfy-Org/MiniMax-H3", HF + "Comfy-Org/MiniMax-H3/tree/main")]),
    (["krea2"], [], [("Comfy-Org/Krea-2", HF + "Comfy-Org/Krea-2/tree/main")]),
    (["qwen3vl_4b"], [], [("Comfy-Org/Krea-2", HF + "Comfy-Org/Krea-2/tree/main")]),
    (["qwen_3_06b"], [], [("circlestone-labs/Anima", HF + "circlestone-labs/Anima/tree/main/split_files")]),
    (["anima"], [], [("circlestone-labs/Anima", HF + "circlestone-labs/Anima/tree/main/split_files")]),
    (["qwen_image_vae"], [], [
        ("Comfy-Org/Qwen-Image_ComfyUI (vae)", QWEN + "vae"),
        ("Comfy-Org/Krea-2", HF + "Comfy-Org/Krea-2/tree/main"),
    ]),
    (["qwen_2.5_vl_7b"], [], [("Comfy-Org/Qwen-Image_ComfyUI (text_encoders)", QWEN + "text_encoders")]),
    (["qwen", "lightning"], [], [("lightx2v/Qwen-Image-Lightning", HF + "lightx2v/Qwen-Image-Lightning/tree/main")]),
    (["fastwan"], [], [("Kijai/WanVideo_comfy(FastWan フォルダ)", HF + "Kijai/WanVideo_comfy/tree/main/FastWan")]),
    (["illustrious-xl"], [], [("OnomaAIResearch/Illustrious-XL-v1.0", HF + "OnomaAIResearch/Illustrious-XL-v1.0/tree/main")]),
    (["sd_xl_base"], [], [("stabilityai/stable-diffusion-xl-base-1.0", HF + "stabilityai/stable-diffusion-xl-base-1.0/tree/main")]),
    (["v1-5-pruned"], [], [("stable-diffusion-v1-5/stable-diffusion-v1-5", HF + "stable-diffusion-v1-5/stable-diffusion-v1-5/tree/main")]),
    (["moss-edit-lora"], [], [("akhaliq/MOSS-Image-Edit-HQ", HF + "akhaliq/MOSS-Image-Edit-HQ/tree/main")]),
    (["birefnet"], [], [("Comfy-Org/BiRefNet(background_removal)", HF + "Comfy-Org/BiRefNet/tree/main/background_removal")]),
    (["big-lama"], [], [("Sanster/models(big-lama.pt・LaMa)", "https://github.com/Sanster/models/releases/tag/add_big_lama")]),
    (["qwen_image_edit"], [], [("Comfy-Org/Qwen-Image-Edit_ComfyUI", HF + "Comfy-Org/Qwen-Image-Edit_ComfyUI/tree/main/split_files/diffusion_models")]),
    (["qwen_image"], ["vae"], [("Comfy-Org/Qwen-Image_ComfyUI (diffusion_models)", QWEN + "diffusion_models")]),
    (["wan2.2", "lightx2v"], [], [
        ("Comfy-Org/Wan_2.2_ComfyUI_Repackaged (loras)", WAN22 + "loras"),
        ("lightx2v/Wan2.2-Distill-Loras", HF + "lightx2v/Wan2.2-Distill-Loras"),
    ]),
    (["wan2.2_vae"], [], [("Comfy-Org/Wan_2.2_ComfyUI_Repackaged (vae)", WAN22 + "vae")]),
    (["wan_2.1_vae"], [], [("Comfy-Org/Wan_2.2_ComfyUI_Repackaged (vae)", WAN22 + "vae")]),
    (["wan2.2"], [], [("Comfy-Org/Wan_2.2_ComfyUI_Repackaged (diffusion_models)", WAN22 + "diffusion_models")]),
    (["umt5_xxl"], [], [("Comfy-Org/Wan_2.1_ComfyUI_repackaged (text_encoders)",
                          HF + "Comfy-Org/Wan_2.1_ComfyUI_repackaged/tree/main/split_files/text_encoders")]),
]


def _base(name):
    return str(name or "").replace("\\", "/").rsplit("/", 1)[-1]


def links_for(name, kind):
    """[{label, url, kind}] kind = "source"(配布ページ候補) / "search"(検索)"""
    base = _base(name)
    low = base.lower()
    full = str(name or "").replace("\\", "/").lower()  # フォルダ付きの名前(Kandinsky 6 など)も見る
    stem = low.rsplit(".", 1)[0] if low.endswith((".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".sft")) else low
    out = []
    for need, avoid, links in RULES:
        if all(t in full for t in need) and not any(t in low for t in avoid):
            out += [{"label": l, "url": u, "kind": "source"} for l, u in links]
            break
    out.append({"label": "Hugging Face でファイル名を検索",
                "url": HF + "search/full-text?q=" + quote(base), "kind": "search"})
    if kind in ("checkpoints", "loras"):
        out.append({"label": "Civitai で検索", "url": "https://civitai.com/search/models?query=" + quote(stem),
                    "kind": "search"})
    out.append({"label": "Google で検索", "url": "https://www.google.com/search?q=" + quote(f'"{base}"'),
                "kind": "search"})
    return out
