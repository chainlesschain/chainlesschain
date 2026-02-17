---
name: prompt-enhancer
display-name: Prompt Enhancer
description: 提示词增强 - 分析用户意图，注入项目上下文，重写提示词以提高AI回复质量
version: 1.0.0
category: ai
user-invocable: true
tags: [prompt, enhancement, context, intent, rewrite]
capabilities: [intent-analysis, context-injection, prompt-rewriting]
tools:
  - file_reader
  - code_analyzer
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the user wants to enhance their prompts for better AI responses.
  For --enhance mode, analyze the prompt intent (code-gen/debug/explain/refactor/test/deploy),
  inject relevant project context (tech stack from package.json, directory structure), and
  rewrite with specificity. For --analyze mode, classify intent and suggest improvements
  without rewriting. For --template mode, provide ready-made templates for common scenarios.
  Always output the enhanced prompt ready for use.
examples:
  - input: "/prompt-enhancer --enhance fix the login bug"
    output: "Enhanced: In the Electron+Vue3 app (desktop-app-vue), debug the login flow in src/renderer/pages/LoginPage.vue. Check auth store (src/renderer/stores/auth.ts) for token validation, SSO integration (src/main/auth/), and IPC handlers. Identify the root cause and suggest a fix."
  - input: "/prompt-enhancer --analyze write tests for the search feature"
    output: "Intent: test-generation. Detected context: hybrid-search-engine.js, bm25-search.js. Suggestions: specify test framework (vitest), target coverage %, edge cases to test."
  - input: "/prompt-enhancer --template code-review"
    output: "Template: Review [FILE] for: 1) Security (OWASP Top 10), 2) Performance (N+1 queries, memory leaks), 3) Error handling, 4) Code style consistency. Output: severity-ranked findings with fix suggestions."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [enhance, analyze, template]
      description: Enhancement mode
    prompt:
      type: string
      description: The prompt to enhance
output-schema:
  type: object
  properties:
    original: { type: string }
    enhanced: { type: string }
    intent: { type: string }
    injectedContext: { type: array }
    suggestions: { type: array }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Prompt Enhancer 技能

## 描述

分析用户提示词的意图，自动注入项目上下文（技术栈、目录结构、相关文件），重写提示词以提高 AI 回复质量。灵感来自 Cursor 的 Prompt Enhancement 功能。

## 使用方法

```
/prompt-enhancer [选项]
```

## 模式

### 增强模式 (--enhance)

分析意图 → 注入上下文 → 重写提示词

### 分析模式 (--analyze)

仅分析意图和上下文，不重写

### 模板模式 (--template)

提供常用场景的提示词模板

## 意图分类

| 意图     | 关键词                       | 增强策略                  |
| -------- | ---------------------------- | ------------------------- |
| code-gen | 创建, 添加, 实现, write, add | 注入技术栈 + 相关文件     |
| debug    | 修复, bug, error, fix        | 注入错误上下文 + 相关日志 |
| explain  | 解释, 什么是, how, why       | 注入代码结构 + 文档链接   |
| refactor | 重构, 优化, clean            | 注入架构模式 + 代码规范   |
| test     | 测试, test, coverage         | 注入测试框架 + 现有测试   |
| deploy   | 部署, deploy, release        | 注入CI/CD + 环境配置      |
