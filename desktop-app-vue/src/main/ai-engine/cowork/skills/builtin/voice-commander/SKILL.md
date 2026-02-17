---
name: voice-commander
display-name: Voice Commander
description: 语音命令管理（命令注册、宏定义、命令链、上下文感知、语音快捷方式）
version: 1.0.0
category: automation
user-invocable: true
tags: [voice, command, macro, automation, speech, shortcut]
capabilities:
  [voice_list_commands, voice_create_macro, voice_execute, voice_history]
tools:
  - voice_list_commands
  - voice_create_macro
  - voice_history
instructions: |
  Use this skill to manage voice commands and macros. Can list registered
  voice commands, create command macros (sequences of actions), view command
  history, and test command parsing. Integrates with the advanced voice
  command system for context-aware command execution.
examples:
  - input: "/voice-commander --list"
    output: "32 registered commands in 5 categories"
  - input: "/voice-commander --list --category editing"
    output: "8 editing commands: format_text, insert_element, ..."
  - input: '/voice-commander --create-macro "daily-report" --steps "open notes,summarize today,create report"'
    output: "Created macro 'daily-report' with 3 steps"
  - input: "/voice-commander --history --limit 10"
    output: "Last 10 voice commands executed"
  - input: '/voice-commander --test "打开设置"'
    output: "Parsed: command=open_page, params={page: settings}, confidence: 0.95"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Voice Commander

语音命令管理技能。

## 功能

| 操作   | 命令                                                | 说明                     |
| ------ | --------------------------------------------------- | ------------------------ |
| 列出   | `--list`                                            | 列出所有已注册的语音命令 |
| 分类   | `--list --category <name>`                          | 按类别列出命令           |
| 创建宏 | `--create-macro "<name>" --steps "step1,step2,..."` | 创建命令宏               |
| 删除宏 | `--delete-macro "<name>"`                           | 删除命令宏               |
| 列出宏 | `--macros`                                          | 列出所有宏               |
| 测试   | `--test "<text>"`                                   | 测试命令解析             |
| 历史   | `--history --limit N`                               | 查看命令历史             |
| 类别   | `--categories`                                      | 列出命令类别             |
