---
name: template-renderer
display-name: Template Renderer
description: 模板渲染引擎（Handlebars变量替换、条件/循环、批量生成、自定义Helper）
version: 1.0.0
category: development
user-invocable: true
tags: [template, handlebars, render, variable, generation, batch]
capabilities:
  [template_render, template_validate, template_batch, template_helpers]
tools:
  - template_render
  - template_validate
  - template_list_helpers
instructions: |
  Use this skill to render Handlebars templates with variable substitution.
  Supports conditionals (if/else), loops (each), built-in helpers (formatDate,
  uppercase, lowercase, capitalize, eq), and batch file generation from templates.
  Can render inline templates or template files.
examples:
  - input: '/template-renderer --render template.hbs --data ''{"name":"World"}'''
    output: "Rendered template: Hello World!"
  - input: '/template-renderer --render-inline "Hello {{name}}!" --data ''{"name":"AI"}'''
    output: "Rendered: Hello AI!"
  - input: "/template-renderer --validate template.hbs"
    output: "Template is valid. Variables: name, items, date"
  - input: "/template-renderer --helpers"
    output: "Available helpers: formatDate, uppercase, lowercase, capitalize, eq"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.hbs, .handlebars, .html, .md, .txt]
---

# Template Renderer

Handlebars 模板渲染技能。

## 功能

| 操作     | 命令                                           | 说明             |
| -------- | ---------------------------------------------- | ---------------- |
| 渲染文件 | `--render <file> --data '<json>'`              | 渲染模板文件     |
| 渲染内联 | `--render-inline "<template>" --data '<json>'` | 渲染内联模板     |
| 验证     | `--validate <file>`                            | 验证模板语法     |
| 变量提取 | `--extract <file>`                             | 提取模板中的变量 |
| 批量     | `--batch <template> --data-file <json-array>`  | 批量生成         |
| Helpers  | `--helpers`                                    | 列出可用 helpers |
