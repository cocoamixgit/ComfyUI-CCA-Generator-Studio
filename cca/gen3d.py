"""3D モデルを作る(生成パネルの「3D」の種別)。

画像・動画のような大きなワークフローは使わず、パネルの値から ComfyUI に送る小さな処理(prompt)を作る(声・音楽と同じ流れ)。

- TRELLIS.2(ComfyUI 本体のノード。同梱のテンプレート「画像 → 3D」と同じ手順と値)
    背景を外して切り抜く → 画像を読む(DINOv3)→ 大まかな形 → 形 → 細かい形 → 色
    → 面を整えて減らす → 展開して色・凹凸・陰を焼き付ける → GLB に保存
"""
from .audiogen import _file, _num, _opts, _pick
from .specs import TYPE_INFO

# テンプレートの値(ステップ・CFG・面の数・テクスチャの大きさ)
STEPS = {"structure": 12, "shape": 20, "upsample": 12, "texture": 12}
CFG = 7.5
FACES = 700000
TEXTURE = 4096


# 欄 → (入れる場所, 欄の名前)
FILES = [("unet_name", "diffusion_models", "モデル"), ("vae_name", "vae", "形の VAE"), ("audio_vae_name", "vae", "色の VAE"),
         ("clip_name", "clip_vision", "画像エンコーダー"), ("clip_name_2", "background_removal", "背景除去モデル")]


def _files(v, mt):
    """モデルのファイルを確かめる。足りないものは全部まとめて、入れる場所と入手先を案内する(画像・動画と同じ案内)"""
    from .panel import _require_file
    out, errs = {}, []
    for key, folder, label in FILES:
        name = str(v.get(key) or "").strip()
        try:
            _require_file(name, folder, label, mt, field=key)
        except ValueError as e:
            errs.append(str(e))
        out[key] = name
    if errs:
        raise ValueError("\n\n".join(errs))
    return out


def _seed(v):
    try:
        return max(0, int(v.get("seed") or 0)) % (2 ** 64)
    except (TypeError, ValueError):
        return 0


def _sampler(model, seed, steps, cfg, stage, scheduler):
    return {"class_type": "KSampler", "inputs": {
        "model": model, "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": scheduler,
        "positive": [stage, 0], "negative": [stage, 1], "latent_image": [stage, 2], "denoise": 1.0}}


def build_prompt(v):
    """パネルの値 v → (prompt, 結果の種類 "3d", 記録する設定)"""
    from .prefix import expand_prefix
    mt = v.get("model_type")
    info = TYPE_INFO.get(mt)
    if not info or info["kind"] != "3d":
        raise ValueError(f"3D の種別ではありません: {mt}")
    image = _file(v.get("image"), "3D にする画像")
    f = _files(v, mt)
    unet, shape_vae, tex_vae, dino, bg = (f[k] for k, _, _ in FILES)
    seed = _seed(v)
    # パネルの設定(「3D の設定」。既定はテンプレートの値)
    o = _opts(mt, v.get("audio_opts"))
    faces = _num(o["faces"], FACES, 10000, 2000000, int)
    tex_size = int(_pick(_num(o["texture"], TEXTURE, cast=int), (1024, 2048, 4096), TEXTURE))
    steps = {"structure": _num(o["ss_steps"], STEPS["structure"], 1, 50, int), "shape": _num(o["shape_steps"], STEPS["shape"], 1, 50, int),
             "upsample": _num(o["up_steps"], STEPS["upsample"], 1, 50, int), "texture": _num(o["tex_steps"], STEPS["texture"], 1, 50, int)}
    cfg = _num(o["shape_cfg"], CFG, 1.0, 10.0)
    cfg_ss = _num(o["ss_cfg"], CFG, 1.0, 10.0)
    cfg_tex = _num(o["tex_cfg"], 1.0, 1.0, 10.0)
    shift = _num(o["ss_shift"], 5.0, 0.0, 20.0)
    resc_ss = _num(o["ss_rescale"], 0.7, 0.0, 1.0)
    resc_sh = _num(o["shape_rescale"], 0.5, 0.0, 1.0)
    crop_pad = _num(o["crop_pad"], 1.1, 1.0, 3.0)
    crop_bg = {"black": "#000000", "white": "#ffffff", "gray": "#808080"}[_pick(o["crop_bg"], ("black", "white", "gray"), "black")]
    remesh_res = _num(o["remesh_res"], 768, 128, 2048, int)
    smooth = _num(o["remesh_smooth"], 20, 0, 100, int)
    small = _num(o["remesh_small"], 0.01, 0.0, 1.0)
    crease = _num(o["crease"], 180.0, 0.0, 180.0)
    uv_pad = _num(o["uv_pad"], 1, 0, 16, int)
    uv_weld = _num(o["uv_weld"], 0.0002, 0.0, 0.01)
    normal_res = int(_pick(_num(o["normal_res"], 2048, cast=int), (512, 1024, 2048, 4096), 2048))
    cage = _num(o["cage"], 0.05, 0.0, 1.0)
    ao_res = _num(o["ao_res"], 1024, 256, 4096, int)
    ao_samples = _num(o["ao_samples"], 64, 1, 512, int)
    ao_dist = _num(o["ao_dist"], 0.71, 0.0, 5.0)
    ao_strength = _num(o["ao_strength"], 1.0, 0.0, 4.0)
    ao_bias = _num(o["ao_bias"], 0.01, 0.0, 1.0)
    # 金属の度合い・粗さ: 「数値で決める」は、全体が同じ明るさの画像にして渡す(0〜1 → 0〜255)
    metal_fixed = _pick(o["metal_mode"], ("fixed", "model"), "fixed") == "fixed"
    rough_fixed = _pick(o["rough_mode"], ("model", "fixed"), "model") == "fixed"
    metallic = _num(o["metallic"], 0.0, 0.0, 1.0)
    roughness = _num(o["roughness"], 0.5, 0.0, 1.0)
    gray = lambda x: (lambda g: g * 65536 + g * 256 + g)(int(round(x * 255)))  # noqa: E731
    p = {
        # 入力画像: 背景を外し、物の所で 1024 x 1024 に切り抜く(周りに 1.1 倍の余白)
        "img": {"class_type": "LoadImage", "inputs": {"image": image}},
        "bgm": {"class_type": "LoadBackgroundRemovalModel", "inputs": {"bg_removal_name": bg}},
        "mask": {"class_type": "RemoveBackground", "inputs": {"bg_removal_model": ["bgm", 0], "image": ["img", 0]}},
        "crop": {"class_type": "ImageCropToMask", "inputs": {"images": ["img", 0], "masks": ["mask", 0], "width": 1024,
                                                             "height": 1024, "pad_factor": crop_pad, "grow_mask": 0, "background": crop_bg}},
        "cv": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": dino}},
        "cond": {"class_type": "Trellis2Conditioning", "inputs": {"clip_vision_model": ["cv", 0], "image": ["crop", 0]}},
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "svae": {"class_type": "VAELoader", "inputs": {"vae_name": shape_vae}},
        "tvae": {"class_type": "VAELoader", "inputs": {"vae_name": tex_vae}},
        # 1. 大まかな形(ボクセル)
        "m1a": {"class_type": "CFGOverride", "inputs": {"model": ["unet", 0], "cfg": 1.0, "start_percent": 0.667, "end_percent": 1.0}},
        "m1b": {"class_type": "RescaleCFG", "inputs": {"model": ["m1a", 0], "multiplier": resc_ss}},
        "m1": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["m1b", 0], "shift": shift}},
        "lat1": {"class_type": "EmptyTrellis2LatentStructure", "inputs": {"batch_size": 1}},
        "s1": {"class_type": "KSampler", "inputs": {
            "model": ["m1", 0], "seed": seed, "steps": steps["structure"], "cfg": cfg_ss, "sampler_name": "euler", "scheduler": "normal",
            "positive": ["cond", 0], "negative": ["cond", 1], "latent_image": ["lat1", 0], "denoise": 1.0}},
        "vox": {"class_type": "VaeDecodeStructureTrellis2", "inputs": {"samples": ["s1", 0], "vae": ["svae", 0], "resolution": "32"}},
        # 2. 形 → 細かい形(1536)
        "m2a": {"class_type": "CFGOverride", "inputs": {"model": ["unet", 0], "cfg": 1.0, "start_percent": 0.769, "end_percent": 1.0}},
        "m2": {"class_type": "RescaleCFG", "inputs": {"model": ["m2a", 0], "multiplier": resc_sh}},
        "st2": {"class_type": "Trellis2ShapeStage", "inputs": {"positive": ["cond", 0], "negative": ["cond", 1], "voxel": ["vox", 0]}},
        "s2": _sampler(["m2", 0], seed, steps["shape"], cfg, "st2", "normal"),
        "st3": {"class_type": "Trellis2UpsampleStage", "inputs": {"positive": ["st2", 0], "negative": ["st2", 1], "shape_latent": ["s2", 0],
                                                                  "vae": ["svae", 0], "target_resolution": 1536}},
        "s3": _sampler(["m2", 0], seed, steps["upsample"], cfg, "st3", "simple"),
        "shape": {"class_type": "VaeDecodeShapeTrellis", "inputs": {"samples": ["s3", 0], "vae": ["svae", 0]}},
        # 3. 色
        "st4": {"class_type": "Trellis2TextureStage", "inputs": {"positive": ["st3", 0], "negative": ["st3", 1], "shape_latent": ["s3", 0]}},
        "s4": _sampler(["unet", 0], seed, steps["texture"], cfg_tex, "st4", "normal"),
        "col": {"class_type": "VaeDecodeTextureTrellis", "inputs": {"samples": ["s4", 0], "vae": ["tvae", 0], "shape_subdivides": ["shape", 1]}},
        # 4. 面を整えて減らす → 展開して、色・凹凸・陰を焼き付ける
        "rm": {"class_type": "RemeshMesh", "inputs": {
            "mesh": ["shape", 0], "resolution": remesh_res, "sign_mode": "solid", "sign_mode.fill": 20.0, "sign_mode.qef": False,
            "band": 1.0, "project_back": 0.0, "fix_poles": False, "smooth_iters": smooth, "drop_small_components": small,
            "precluster_max_verts": 20000000}},
        "dm": {"class_type": "DecimateMesh", "inputs": {"mesh": ["rm", 0], "target_face_count": faces, "placement_mode": "midpoint"}},
        "sm": {"class_type": "MeshSmoothNormals", "inputs": {"mesh": ["dm", 0], "crease_angle": crease}},
        "uv": {"class_type": "UnwrapMesh", "inputs": {"mesh": ["sm", 0], "segmenter": "pec", "resolution": tex_size, "padding": uv_pad,
                                                      "weld_distance": uv_weld}},
        "tex": {"class_type": "BakeTextureFromVoxel", "inputs": {"mesh": ["uv", 0], "voxel_colors": ["col", 0], "texture_size": tex_size,
                                                                 "reference_mesh": ["shape", 0]}},
        "nrm": {"class_type": "BakeNormalMapFromMesh", "inputs": {"low_poly": ["uv", 0], "high_poly": ["rm", 0], "resolution": normal_res,
                                                                  "cage_distance": cage, "ignore_backfaces": True}},
        "ao": {"class_type": "BakeAmbientOcclusion", "inputs": {"low_poly": ["uv", 0], "high_poly": ["rm", 0], "resolution": ao_res,
                                                                "samples": ao_samples, "max_distance": ao_dist, "strength": ao_strength, "bias": ao_bias}},
        # 金属の度合い・粗さ: 「数値で決める」は全体が同じ値の画像、「モデルが決める」は焼き付けた値を使う
        "nometal": {"class_type": "EmptyImage", "inputs": {"width": tex_size, "height": tex_size, "batch_size": 1, "color": gray(metallic)}},
        "norough": {"class_type": "EmptyImage", "inputs": {"width": tex_size, "height": tex_size, "batch_size": 1, "color": gray(roughness)}},
        "tm": {"class_type": "ApplyTextureToMesh", "inputs": {"mesh": ["uv", 0], "base_color": ["tex", 0], "metallic": ["nometal", 0] if metal_fixed else ["tex", 1],
                                                              "roughness": ["norough", 0] if rough_fixed else ["tex", 2], "occlusion": ["ao", 0], "normal_map": ["nrm", 0]}},
        "fin": {"class_type": "MeshSmoothNormals", "inputs": {"mesh": ["tm", 0], "crease_angle": crease}},
        "file": {"class_type": "MeshToFile3D", "inputs": {"mesh": ["fin", 0]}},
        "out": {"class_type": "Save3DAdvanced", "inputs": {"model_3d": ["file", 0], "filename_prefix": expand_prefix("3d/CCA"),
                                                           "viewport_state": "", "width": 1024, "height": 1024}},
    }
    used = {"model_type": mt, "task": "I23D", "positive": "", "negative": "", "template": "", "seed": seed,
            "steps": None, "cfg": None, "model": unet, "opts": {"image": image, "faces": faces, "texture": tex_size, "metallic": metallic if metal_fixed else "model"}}
    return p, "3d", used
