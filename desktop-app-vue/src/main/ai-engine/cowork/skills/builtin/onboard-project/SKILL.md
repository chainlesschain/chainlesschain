---
name: onboard-project
display-name: Project Onboarding
description: 项目入门技能 - 代码库分析、架构理解、快速上手指南生成
version: 1.0.0
category: development
user-invocable: true
tags: [onboard, project, analysis, architecture, getting-started]
capabilities:
  [
    project-analysis,
    architecture-mapping,
    dependency-analysis,
    onboarding-guide,
  ]
tools:
  - file_reader
  - code_analyzer
handler: ./handler.js
instructions: |
  Use this skill when a user opens a new or unfamiliar project and needs to quickly
  understand its structure, purpose, and how to work with it. Analyze the project's
  README, package.json/pom.xml/requirements.txt, directory structure, configuration
  files, and key source files to generate a comprehensive onboarding document.
  Inspired by Continue.dev's /onboard command.
examples:
  - input: "/onboard-project"
    output: "Project analysis: ChainlessChain v0.36.0, Electron+Vue3 desktop app, 15 modules, 200+ IPC handlers..."
  - input: "/onboard-project src/main/llm/"
    output: "LLM Module Guide: 6 files, session management, context engineering, permanent memory, RAG integration..."
  - input: "/onboard-project --for-contributor"
    output: "Contributor guide with dev setup steps, coding conventions, test commands, PR workflow..."
os: [win32, darwin, linux]
author: ChainlessChain
---

# 项目入门技能

## 描述

分析项目结构、README、依赖配置、关键源文件，生成全面的项目理解文档和快速上手指南。帮助新开发者或 AI 助手快速了解不熟悉的代码库。

## 使用方法

```
/onboard-project [目录路径] [选项]
```

## 选项

- `--for-contributor` - 生成贡献者指南（开发环境搭建、代码规范、PR 流程）
- `--for-reviewer` - 生成代码审查指南（架构概述、关键文件、风险区域）
- `--depth <n>` - 分析深度: 1=概览, 2=详细, 3=深入 (默认: 2)
- `--focus <area>` - 聚焦特定领域: api, frontend, backend, security, testing

## 分析内容

### 项目概览

- 项目名称、版本、描述（从 package.json/README 提取）
- 技术栈识别（框架、语言、工具链）
- 许可证和仓库信息

### 目录结构

- 顶层目录用途说明
- 关键文件标注（入口文件、配置文件、数据库 Schema）
- 代码量统计（按语言/目录）

### 架构分析

- 应用架构模式（MVC、事件驱动、微服务等）
- 模块间依赖关系图
- 数据流方向（前端 → IPC → 主进程 → 数据库）
- 关键设计决策

### 开发工作流

- 构建命令和启动方式
- 测试命令和覆盖率
- 环境变量需求
- Docker 服务依赖

### 关键约定

- 命名规范（文件、变量、函数）
- 提交消息格式
- 代码组织模式
- 错误处理模式

## 输出格式

```markdown
# Project Onboarding: [项目名]

## Quick Summary

- **Purpose**: ...
- **Tech Stack**: Electron 39.2.6, Vue 3.4, TypeScript 5.9
- **Version**: v0.36.0
- **Size**: 280,000+ lines, 358 components

## Architecture

[架构图/描述]

## Getting Started

1. Clone and install...
2. Start services...
3. Run dev...

## Key Files

- Entry: src/main/index.js
- Database: src/main/database.js
- Router: src/renderer/router/index.ts

## Module Guide

[各模块说明]
```

## 示例

分析当前项目:

```
/onboard-project
```

分析特定模块:

```
/onboard-project src/main/browser/ --depth 3
```

生成贡献者指南:

```
/onboard-project --for-contributor
```
