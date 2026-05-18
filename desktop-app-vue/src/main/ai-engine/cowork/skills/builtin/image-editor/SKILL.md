---
name: image-editor
display-name: Image Editor
description: 图片编辑处理（缩放、压缩、格式转换、缩略图、旋转、裁剪、水印）
version: 1.0.0
category: media
user-invocable: true
tags: [image, edit, resize, compress, convert, thumbnail, sharp]
capabilities:
  [
    image_resize,
    image_compress,
    image_convert,
    image_thumbnail,
    image_rotate,
    image_crop,
    image_watermark,
  ]
tools:
  - image_resize
  - image_compress
  - image_convert
  - image_thumbnail
  - image_info
instructions: |
  Use this skill to process and edit images. Supports resize, compress, format conversion,
  thumbnail generation, rotation, cropping, and text watermark overlay. Built on sharp library.
  Accepts common image formats: jpg, jpeg, png, webp, gif, bmp, tiff.
examples:
  - input: "/image-editor --resize photo.jpg --width 800 --height 600"
    output: "Resized image saved to photo_800x600.jpg"
  - input: "/image-editor --compress photo.png --quality 80"
    output: "Compressed image saved (85% reduction)"
  - input: "/image-editor --convert photo.jpg --to webp"
    output: "Converted photo.jpg → photo.webp"
  - input: "/image-editor --thumbnail photo.jpg"
    output: "Thumbnail generated: photo_thumb.jpg (200x200)"
  - input: "/image-editor --info photo.jpg"
    output: "Image info: 1920x1080, JPEG, 2.3 MB, sRGB"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.jpg, .jpeg, .png, .webp, .gif, .bmp, .tiff]
---

# Image Editor

图片编辑处理技能，基于 Sharp 库。

## 支持操作

| 操作   | 命令                                                  | 说明                           |
| ------ | ----------------------------------------------------- | ------------------------------ |
| 信息   | `--info <file>`                                       | 获取图片尺寸、格式、大小等信息 |
| 缩放   | `--resize <file> --width W --height H`                | 缩放图片                       |
| 压缩   | `--compress <file> --quality Q`                       | 压缩图片质量 (0-100)           |
| 转换   | `--convert <file> --to <format>`                      | 格式转换 (jpg/png/webp/tiff)   |
| 缩略图 | `--thumbnail <file>`                                  | 生成 200x200 缩略图            |
| 旋转   | `--rotate <file> --angle 90`                          | 旋转图片                       |
| 裁剪   | `--crop <file> --left L --top T --width W --height H` | 裁剪图片区域                   |
