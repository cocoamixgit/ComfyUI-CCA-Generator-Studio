# CCA Generator

[日本語版はこちら](README-JP.md)

A ComfyUI interface for image and video generation with SD1.5, Krea 2, MOSS, LTX-2.5, and more. Text-to-video, image-to-video with first/last frame control, and optional audio generation, all from a single panel.

![CCA Generator panel](assets/screenshot.png)

## Features

- **Multi-model support** — Generate images and videos with SD1.5, Krea 2, MOSS, LTX-2.5, and more, from one interface.
- **Text-to-video / image-to-video** — Start from a prompt, or animate a still image.
- **First / last frame control** — Set the opening frame, and optionally the ending frame, to guide the video.
- **Audio generation** — Optionally generate sound together with the video.
- **Model setup assistance** — Haven't prepared any models yet? The panel helps you download models and shows you where to put them.
- **Prompt tools** — Save and reuse prompt presets, build a prompt from an input image, and append words with one click.
- **Image compositing** — Cut out and layer images before generation.
- **Gallery preview** — Browse generated results, enlarge them, or open the output folder.

## Installation

### Prerequisites

- ComfyUI installed. If you don't have ComfyUI yet, see [this setup guide (Japanese)](https://note.com/cocoat/n/n8780c1ca3b1f#e9a103d0-79ce-43a5-b53d-f6ff8fb16a35) — it walks through installing ComfyUI with StabilityMatrix.
- Git installed. If you don't have Git yet, install it first (see below).

### Installing Git

- **Windows:** Download [Git for Windows](https://git-scm.com/downloads) and run the installer. The default options are fine.
- **macOS:** Run `xcode-select --install`, or `brew install git` if you use Homebrew.
- **Linux:** Run `sudo apt install git` (Debian / Ubuntu) or the equivalent for your distribution.

Then verify:

```bash
git --version
```

If it prints a version number, you're good to go.

### Step 1: Install ComfyUI Manager V3.42

If you don't have ComfyUI Manager yet, install it first.

Open a terminal in the `custom_nodes` folder inside **your** ComfyUI installation. The location depends on how you installed ComfyUI:

- Windows Portable: `ComfyUI_windows_portable/ComfyUI/custom_nodes`
- StabilityMatrix: `C:\StabilityMatrix\Data\Packages\ComfyUI\custom_nodes`
- Manual install: `custom_nodes` inside the folder where you cloned ComfyUI

Then run:

```bash
git clone https://github.com/Comfy-Org/ComfyUI-Manager.git comfyui-manager
```

Then install its dependencies with the same Python that runs ComfyUI:

**Windows Portable** (run from the `ComfyUI_windows_portable` folder):

```bash
.\python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\comfyui-manager\requirements.txt
```

**Manual install / venv** (run from your ComfyUI folder):

```bash
pip install -r custom_nodes/comfyui-manager/requirements.txt
```

Restart ComfyUI. The **Manager** button should appear.

> The folder must be exactly `<your ComfyUI folder>/custom_nodes/comfyui-manager`. Do not leave a nested folder like `ComfyUI-Manager/ComfyUI-Manager`.

### Step 2: Install CCA Generator

1. Click **Manager** and open **Custom Nodes Manager**.
2. Search for **CCA Generator** and click **Install**.
3. Restart ComfyUI.

### Manual install (alternative)

```bash
cd <your ComfyUI folder>/custom_nodes
git clone https://github.com/cocoamixgit/ComfyUI-cca-generator-ui.git
```

Replace `<your ComfyUI folder>` with the path to your own ComfyUI installation. Then restart ComfyUI.

## Models

This node does not bundle any models. If you don't have models yet, the panel's model setup assistance helps you download them and place them in the right folders. See the model guide in the panel for how to choose a model and its license terms.

## Usage

1. **Choose a model** — Pick a model type (e.g. LTX-2.5) from the model dropdown. Use the model folder settings to point to where your models are stored.
2. **Choose a task** — Text-to-video or image-to-video.
3. **Enter a prompt** — Pick a preset or type your own. Turn on audio generation if you want sound.
4. **Set input images** (image-to-video) — The first image is the opening frame; the second image is the optional ending frame. Click to select, or drag and drop.
5. **Press Generate** — Press Interrupt to stop. Progress is shown during generation.
6. **Check the results** — Preview images and videos in the gallery, enlarge them, or open the output folder.

## License

GPL-3.0 — see [LICENSE](LICENSE).
