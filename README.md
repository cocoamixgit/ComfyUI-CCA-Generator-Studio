# CCA Generator

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

### Via ComfyUI Manager (recommended)

1. Open ComfyUI Manager → Custom Nodes Manager.
2. Search for **CCA Generator** and install it.
3. Restart ComfyUI.

### Manual install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/cocoamixgit/ComfyUI-cca-generator-ui.git
```

Then restart ComfyUI.

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
