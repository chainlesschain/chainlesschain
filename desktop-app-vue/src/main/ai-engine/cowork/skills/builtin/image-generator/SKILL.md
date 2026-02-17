---
name: image-generator
display-name: Image Generator
description: AI图像生成（文生图、图生图、风格迁移、背景移除、图片增强）
version: 1.0.0
category: ai
user-invocable: true
tags: [image, ai, generation, stable-diffusion, dalle, text-to-image]
capabilities:
  [image_generate, image_enhance, image_background_remove, image_style]
tools:
  - image_generate
  - image_enhance
  - image_list_presets
instructions: |
  Use this skill to generate or enhance images using AI services.
  Supports text-to-image generation (Stable Diffusion, DALL-E),
  image enhancement (sharpen, denoise, upscale), and preset sizes.
  Requires configured AI image service endpoint.
examples:
  - input: '/image-generator --generate "a beautiful sunset over mountains"'
    output: "Generated image saved to generated_sunset.png (1024x1024)"
  - input: "/image-generator --enhance photo.jpg --sharpen"
    output: "Enhanced image saved with sharpening applied"
  - input: "/image-generator --presets"
    output: "Available presets: thumbnail, small, medium, large, portrait, landscape"
  - input: '/image-generator --generate "cyberpunk city" --size 1024x768 --provider stable-diffusion'
    output: "Generated image using Stable Diffusion"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.jpg, .jpeg, .png, .webp]
---

# Image Generator

AI 图像生成与增强技能。

## 功能

| 操作   | 命令                           | 说明               |
| ------ | ------------------------------ | ------------------ |
| 生成   | `--generate "<prompt>"`        | 文生图             |
| 增强   | `--enhance <file> --sharpen`   | 图片锐化           |
| 增强   | `--enhance <file> --denoise`   | 图片降噪           |
| 增强   | `--enhance <file> --upscale 2` | 图片放大           |
| 预设   | `--presets`                    | 列出可用尺寸预设   |
| 提供者 | `--providers`                  | 列出可用AI图像服务 |
