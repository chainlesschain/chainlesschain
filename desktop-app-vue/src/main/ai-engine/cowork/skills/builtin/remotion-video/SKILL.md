---
name: remotion-video
display-name: Remotion Video
description: Create programmatic videos with React using Remotion - generate animations, compositions, text effects, transitions, captions, and render MP4 videos from code
version: 1.0.0
category: media
user-invocable: true
tags: [video, remotion, react, animation, composition, render, mp4, motion]
capabilities:
  [
    video-creation,
    animation-design,
    composition-setup,
    video-rendering,
    text-animation,
    caption-generation,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [remotion-create, remotion-preview, remotion-render, remotion-template]
requires:
  bins: [npx, node]
instructions: |
  Use this skill when the user wants to create videos programmatically using
  React/Remotion. Supports project setup, composition creation, animation
  design, text effects, transitions, and MP4 rendering. Each frame is a React
  component. Provides templates for common video types (intro, explainer,
  slideshow, social media).
examples:
  - input: "create a video intro animation"
    action: create
  - input: "render the composition to MP4"
    action: render
  - input: "preview the video at localhost"
    action: preview
  - input: "add a text animation with spring easing"
    action: template
input-schema:
  type: object
  properties:
    action:
      type: string
      enum: [create, preview, render, template, add-scene]
    name:
      type: string
    options:
      type: object
output-schema:
  type: object
  properties:
    projectPath: { type: string }
    output: { type: string }
    url: { type: string }
author: ChainlessChain
license: MIT
---

# Remotion Video Skill

Create programmatic videos with React using Remotion.

## Usage

```
/remotion-video create <project-name>
/remotion-video preview [project-path]
/remotion-video render [composition-id] [--output output.mp4]
/remotion-video template <template-name>
```

## Actions

| Action | Description |
| --- | --- |
| `create` | Scaffold a new Remotion project |
| `preview` | Start the Remotion Studio dev server |
| `render` | Render a composition to MP4 |
| `template` | Generate a composition from template |
| `add-scene` | Add a new scene/composition to project |

## Animation Best Practices

### Interpolation

```tsx
import { interpolate, useCurrentFrame } from "remotion";
const frame = useCurrentFrame();
const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
```

### Spring Animation

```tsx
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
const frame = useCurrentFrame();
const { fps } = useVideoConfig();
const scale = spring({ frame, fps, config: { damping: 200 } });
```

### Timing & Easing

- Use `interpolate()` for linear and eased transitions
- Use `spring()` for physics-based motion
- Use `<Sequence>` for sequencing scenes
- Use `<Series>` for stacking scenes with offsets

## Templates

| Template | Description |
| --- | --- |
| `intro` | Animated title intro with logo |
| `explainer` | Multi-scene explanation video |
| `slideshow` | Image/text slideshow with transitions |
| `social` | Short social media clip (16:9 or 9:16) |
| `caption` | Video with animated captions/subtitles |
| `chart` | Animated data visualization |

## Rendering

```
/remotion-video render MyComp --output video.mp4
```

Options: `--codec h264`, `--quality 80`, `--fps 30`, `--width 1920`, `--height 1080`
