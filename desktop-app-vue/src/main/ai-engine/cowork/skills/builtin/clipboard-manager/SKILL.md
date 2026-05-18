---
name: clipboard-manager
display-name: Clipboard Manager
description: 剪贴板管理（历史记录、搜索、收藏、格式转换、敏感内容过滤）
version: 1.0.0
category: utility
user-invocable: true
tags: [clipboard, history, copy, paste, pin, search, privacy]
capabilities:
  [
    clipboard_read,
    clipboard_write,
    clipboard_history,
    clipboard_search,
    clipboard_pin,
  ]
tools:
  - clipboard_read
  - clipboard_write
  - clipboard_history
  - clipboard_search
instructions: |
  Use this skill to manage clipboard operations with history tracking. Read/write
  clipboard content, browse clipboard history, search past entries, pin frequently
  used items, and filter sensitive content (passwords, API keys, credit card numbers).
examples:
  - input: "/clipboard-manager --read"
    output: "Current clipboard: 'Hello World' (text, 11 chars)"
  - input: "/clipboard-manager --history --limit 10"
    output: "Last 10 entries: [1] Hello World, [2] https://..., ..."
  - input: '/clipboard-manager --search "api"'
    output: "2 entries found containing 'api'"
  - input: '/clipboard-manager --write "Hello from AI"'
    output: "Written to clipboard: 'Hello from AI'"
  - input: "/clipboard-manager --pin 3"
    output: "Pinned entry #3: 'frequently used text'"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Clipboard Manager

剪贴板管理技能。

## 功能

| 操作     | 命令                  | 说明           |
| -------- | --------------------- | -------------- |
| 读取     | `--read`              | 读取当前剪贴板 |
| 写入     | `--write "<text>"`    | 写入到剪贴板   |
| 历史     | `--history --limit N` | 查看历史记录   |
| 搜索     | `--search "<query>"`  | 搜索历史       |
| 收藏     | `--pin <index>`       | 收藏条目       |
| 取消收藏 | `--unpin <index>`     | 取消收藏       |
| 收藏列表 | `--pins`              | 查看收藏列表   |
| 清除     | `--clear`             | 清除历史       |
