---
name: translate
display-name: Translate
description: Translate text between languages
version: 1.0.0
category: translation
user-invocable: true
tags: [translate, language, i18n]
os: [android, win32, darwin, linux]
handler: TranslateHandler
input-schema:
  - name: text
    type: string
    description: The text to translate
    required: true
  - name: from
    type: string
    description: Source language (auto-detect if omitted)
    required: false
  - name: to
    type: string
    description: Target language
    required: true
execution-mode: local
---

# Translate Skill

Translates text between languages with context awareness.

## Usage

```
/translate --to=zh Hello, how are you?
/translate --from=zh --to=en 你好世界
```

## Supported Languages

Chinese (zh), English (en), Japanese (ja), Korean (ko), French (fr), German (de), Spanish (es), Russian (ru), and more.

## Examples

```
/translate --to=en 这是一个去中心化的个人AI管理系统
```
