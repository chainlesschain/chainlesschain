---
name: screenshot-to-code
display-name: Screenshot to Code
description: 截图转代码 - 将UI截图/设计稿转换为Vue/React/HTML组件代码
version: 1.0.0
category: development
user-invocable: true
tags: [design, screenshot, ui, vue, react, html, css, vision]
capabilities: [image-analysis, component-generation, style-extraction]
tools:
  - file_reader
  - code_generator
requires:
  bins: []
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the user provides a UI screenshot, mockup, or design image and
  wants to generate frontend component code from it. The handler validates the image,
  extracts metadata, and produces a structured prompt for a vision-capable AI model to
  analyze the image and generate code. Supports Vue SFC (default, matching this project),
  React JSX, and plain HTML output. The handler provides framework-specific templates
  and CSS utility patterns to guide code generation. Since the handler cannot call
  vision APIs directly, it prepares all context for the AI to do the visual analysis.
examples:
  - input: "/screenshot-to-code --generate login-mockup.png"
    output: "Image validated (1920x1080 PNG). Generated Vue SFC template with Ant Design Vue components, flex layout, and form validation."
  - input: "/screenshot-to-code --analyze dashboard.jpg --framework react"
    output: "Detected elements: sidebar navigation, data cards (4), line chart, table. Framework: React with JSX."
  - input: "/screenshot-to-code --generate hero-section.webp --framework html"
    output: "Generated responsive HTML5 with CSS Grid layout, hero image, CTA button, and mobile breakpoints."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [analyze, generate]
      description: Analysis or generation mode
    image:
      type: string
      description: Path to the screenshot image
    framework:
      type: string
      enum: [vue, react, html]
      default: vue
      description: Target framework for code generation
output-schema:
  type: object
  properties:
    imageInfo:
      type: object
      properties:
        path: { type: string }
        format: { type: string }
        size: { type: number }
    framework: { type: string }
    prompt: { type: string }
    templateCode: { type: string }
model-hints:
  vision: [claude-opus-4-6, gpt-4-vision]
  preferred: [claude-opus-4-6]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Screenshot to Code 技能

## 描述

将 UI 截图、设计稿或线框图转换为前端组件代码。支持 Vue SFC（默认）、React JSX 和纯 HTML 三种框架输出。利用 Vision AI 模型分析图片中的 UI 元素，生成结构化的组件代码。

## 使用方法

```
/screenshot-to-code [选项] <图片路径>
```

## 选项

- `--analyze <image>` - 分析截图中的 UI 元素，不生成代码
- `--generate <image>` - 分析截图并生成组件代码
- `--framework vue|react|html` - 设置目标框架（默认: vue）

## 支持的图片格式

- PNG (`.png`)
- JPEG (`.jpg`, `.jpeg`)
- WebP (`.webp`)
- GIF (`.gif`)

## 框架模板

### Vue SFC (默认)

```vue
<template>
  <div class="component-name">
    <!-- Generated layout -->
  </div>
</template>

<script setup>
import { ref } from "vue";
// Generated logic
</script>

<style scoped>
/* Generated styles */
</style>
```

### React JSX

```jsx
import React, { useState } from "react";
import "./ComponentName.css";

export default function ComponentName() {
  return <div className="component-name">{/* Generated layout */}</div>;
}
```

### Plain HTML

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      /* Generated styles */
    </style>
  </head>
  <body>
    <!-- Generated layout -->
  </body>
</html>
```

## 输出示例

```
Screenshot Analysis: login-mockup.png
======================================
Image: 1920x1080 PNG (245 KB)
Framework: Vue SFC

Detected Elements:
  - Header with logo (top-left)
  - Login form (centered)
    - Email input
    - Password input
    - "Remember me" checkbox
    - Submit button
  - Footer with links

Generated: LoginPage.vue (85 lines)
```
