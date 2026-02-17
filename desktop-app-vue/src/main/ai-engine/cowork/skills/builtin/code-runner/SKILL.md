---
name: code-runner
display-name: Code Runner
description: 安全代码执行（Python/JavaScript/Bash脚本运行、超时控制、输出捕获）
version: 1.0.0
category: development
user-invocable: true
tags: [code, execute, run, python, javascript, bash, script, sandbox]
capabilities: [code_run, code_run_file, code_detect_language]
tools:
  - code_run
  - code_run_file
  - code_detect_language
instructions: |
  Use this skill to safely execute code snippets or script files.
  Supports Python, JavaScript (Node.js), and Bash scripts.
  Includes timeout protection (30s default), output capture (stdout + stderr),
  and exit code reporting. Useful for testing code, running scripts, and automation.
examples:
  - input: '/code-runner --run "print(''Hello World'')" --lang python'
    output: "Output: Hello World (exit code: 0, 0.05s)"
  - input: '/code-runner --run "console.log(2+2)" --lang javascript'
    output: "Output: 4 (exit code: 0, 0.02s)"
  - input: "/code-runner --file script.py"
    output: "Executed script.py: Output captured (exit code: 0)"
  - input: '/code-runner --run "ls -la" --lang bash'
    output: "Output: directory listing... (exit code: 0)"
  - input: "/code-runner --languages"
    output: "Available: python, javascript, bash"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.py, .js, .sh, .bash]
---

# Code Runner

安全代码执行技能。

## 功能

| 操作     | 命令                               | 说明           |
| -------- | ---------------------------------- | -------------- |
| 执行代码 | `--run "<code>" --lang <language>` | 执行代码片段   |
| 执行文件 | `--file <script> --timeout <ms>`   | 执行脚本文件   |
| 语言列表 | `--languages`                      | 列出支持的语言 |

## 安全说明

- 默认超时 30 秒
- 使用子进程隔离执行
- 捕获 stdout 和 stderr
