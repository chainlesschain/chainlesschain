# 自然语言编程

> v1.1.0 新功能

## 核心特性

- 🗣️ **自然语言转 Spec**: 自然语言描述自动翻译为结构化 Spec（意图、实体、验收条件）
- 🔄 **迭代优化**: 用户反馈驱动的 Spec 迭代精化，渐进式提升完整度
- 📐 **项目约定感知**: 自动分析项目代码���格、���架、命名规范，生成代码符合团队标准
- 💻 **高质量代码生成**: 基于 Spec + 约定生成可直接使用的代码，支持多语言多框架
- 📜 **完整历史追溯**: 翻译和生成历史记录完整保存，支持回溯对比

## 系统架构

```
┌──────────────────────────────────────────────┐
│            用户输入 (自然语言描述)             │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│           Spec Translator (意图翻译器)        │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ 意图提取  │  │ 实体识别  │  │ 验收条件   │ │
│  └──────────┘  └──────────┘  └────────────┘ │
└──────────────────────┬───────────────────────┘
                       │ 结构化 Spec
                       ▼
┌──────────────────────────────────────────────┐
│           Project Style Analyzer              │
│  ┌────────────────┐  ┌────────────────────┐  │
│  │ 框架/风格检测   │  │ 命名规范提取       │  │
│  └────────────────┘  └────────────────────┘  │
└──────────────────────┬───────────────────────┘
                       │ Spec + 约定
                       ▼
┌──────────────────────────────────────────────┐
│            Code Generator (代码生成器)        │
│       Spec + Conventions → Source Code        │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/cowork/spec-translator.js` | 自然语言到结构化 Spec 的翻译引擎 |
| `src/main/ai-engine/cowork/project-style-analyzer.js` | 项目代码风格与约定分析 |
| `src/main/ai-engine/cowork/code-generator.js` | 基于 Spec 的代码生成器 |
| `src/renderer/stores/nlProgramming.ts` | Pinia 状态管理 |
| `src/renderer/pages/NLProgramming.vue` | 自然语言编程前端页面 |

## 系统概述

自然语言编程系统（NL Programming）允许用户使用自然语言描述需求，系统自动将其翻译为结构化 Spec，并基于项目约定生成符合规范的代码。

### 核心能力

- **意图翻译**：自然语言 → 结构化 Spec（意图、实体、验收条件）
- **迭代优化**：用户反馈驱动的 Spec 迭代精化
- **项目约定**：自动分析项目代码风格、框架、命名规范
- **代码生成**：基于 Spec + 约定生成高质量代码
- **历史追溯**：完整的翻译和生成历史记录

## IPC 通道

| 通道                      | 说明                |
| ------------------------- | ------------------- |
| `nl-prog:translate`       | 翻译自然语言为 Spec |
| `nl-prog:validate`        | 验证 Spec 完整性    |
| `nl-prog:refine`          | 根据反馈优化 Spec   |
| `nl-prog:get-history`     | 获取翻译历史        |
| `nl-prog:generate`        | 基于 Spec 生成代码  |
| `nl-prog:get-conventions` | 获取项目约定        |
| `nl-prog:analyze-project` | 分析项目结构和约定  |
| `nl-prog:get-stats`       | 获取统计数据        |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "nlProgramming": {
    "enabled": true,
    "model": "default",
    "maxSpecEntities": 20,
    "autoValidate": true,
    "conventionSources": ["package.json", ".eslintrc", "tsconfig.json"]
  }
}
```

## 使用示例

### 基本流程

1. 在「自然语言编程」页面输入需求描述
2. 点击「翻译为 Spec」，系统提取意图、实体、验收条件
3. 查看完整度进度条，如不足可补充反馈优化
4. 确认 Spec 后点击「生成代码」
5. 在代码预览区查看生成结果，点击「应用到工作区」

### 示例输入

```
创建一个用户登录表单组件，使用 Vue3 + Ant Design，
包含用户名和密码字段，支持记住密码，
表单验证要求用户名不为空、密码至少8位
```

### Spec 输出示例

```json
{
  "intent": "create-component",
  "entities": [
    { "name": "LoginForm", "type": "component", "description": "用户登录表单" },
    { "name": "username", "type": "field", "description": "用户名输入" },
    { "name": "password", "type": "field", "description": "密码输入" }
  ],
  "acceptanceCriteria": [
    "表单包含用户名和密码字段",
    "支持记住密码复选框",
    "用户名不为空验证",
    "密码至少8位验证"
  ],
  "completeness": 85
}
```

## 故障排除

| 问题                   | 解决方案                           |
| ---------------------- | ---------------------------------- |
| Spec 完整度低          | 补充更多细节描述，使用反馈优化功能 |
| 生成代码不符合项目风格 | 先运行「分析当前项目」更新约定     |
| 翻译超时               | 检查 LLM 服务连接状态              |

## 相关文档

- [Context Engineering](/chainlesschain/context-engineering)
- [Cowork 多智能体协作](/chainlesschain/cowork)
