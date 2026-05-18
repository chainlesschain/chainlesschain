---
name: ocr-scanner
display-name: OCR Scanner
description: OCR文字识别（图片/PDF文字提取、多语言、批量识别、表格识别）
version: 1.0.0
category: media
user-invocable: true
tags: [ocr, text-recognition, tesseract, image-to-text, multilingual]
capabilities: [ocr_recognize, ocr_batch, ocr_languages]
tools:
  - ocr_recognize
  - ocr_batch
  - ocr_list_languages
instructions: |
  Use this skill to extract text from images using Tesseract.js OCR engine.
  Supports multiple languages (Chinese + English by default), batch processing,
  and confidence scoring. Can process JPG, PNG, BMP, TIFF images.
examples:
  - input: "/ocr-scanner --recognize screenshot.png"
    output: "Extracted text with 95% confidence"
  - input: "/ocr-scanner --recognize doc.jpg --lang chi_sim+eng"
    output: "Extracted Chinese and English text"
  - input: "/ocr-scanner --batch ./images/"
    output: "Processed 5 images, extracted text from all"
  - input: "/ocr-scanner --languages"
    output: "Available: eng, chi_sim, chi_tra, jpn, kor, fra, deu..."
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.jpg, .jpeg, .png, .bmp, .tiff, .gif]
---

# OCR Scanner

基于 Tesseract.js 的 OCR 文字识别技能。

## 功能

| 操作     | 命令                                    | 说明                 |
| -------- | --------------------------------------- | -------------------- |
| 识别     | `--recognize <file>`                    | 识别图片中的文字     |
| 语言     | `--recognize <file> --lang chi_sim+eng` | 指定识别语言         |
| 批量     | `--batch <dir>`                         | 批量识别目录中的图片 |
| 语言列表 | `--languages`                           | 列出支持的语言       |
