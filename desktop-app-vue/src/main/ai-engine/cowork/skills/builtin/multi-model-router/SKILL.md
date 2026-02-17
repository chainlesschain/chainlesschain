---
name: multi-model-router
display-name: Multi-Model Router
description: 多模型智能路由 - 根据任务复杂度评分选择最优模型，平衡成本与质量
version: 1.0.0
category: ai
user-invocable: true
tags: [model, routing, cost, optimization, multi-model]
capabilities: [complexity-scoring, model-selection, cost-estimation]
tools: []
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill to intelligently route tasks to the most appropriate AI model.
  For --route mode, analyze the task complexity (code lines, file count, reasoning depth),
  score it on a 1-10 scale, and recommend the optimal model. For --analyze mode, break down
  the complexity factors without routing. For --config mode, show or modify the model
  capability matrix. Fast tasks go to lightweight models, complex reasoning to premium models.
examples:
  - input: "/multi-model-router --route fix a typo in README.md"
    output: "Complexity: 1/10 (simple edit). Recommended: haiku (fastest, cheapest). Estimated cost: $0.001. Reason: single-file, no logic change."
  - input: "/multi-model-router --route refactor the entire authentication system across 15 files"
    output: "Complexity: 9/10 (multi-file architecture). Recommended: opus (strongest reasoning). Estimated cost: $0.50. Reason: cross-file dependencies, security-critical, architectural decisions."
  - input: "/multi-model-router --analyze implement a new search feature"
    output: "Complexity factors: scope=medium (3-5 files), reasoning=medium, domain=search/RAG, risk=low. Score: 5/10."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [route, analyze, config]
      description: Router mode
    task:
      type: string
      description: Task description to route
output-schema:
  type: object
  properties:
    complexity: { type: number }
    recommendedModel: { type: string }
    reasoning: { type: string }
    costEstimate: { type: string }
    factors: { type: object }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Multi-Model Router 技能

## 描述

根据任务复杂度自动选择最优 AI 模型。通过分析任务的代码行数、文件数量、推理深度和领域特征，在成本和质量之间做出最佳平衡。灵感来自 Roo Code 的角色模式和 Aider 的 architect/editor 双模型模式。

## 使用方法

```
/multi-model-router [选项]
```

## 模式

### 路由 (--route)

分析任务并推荐模型

### 分析 (--analyze)

仅分析复杂度因素

### 配置 (--config)

查看或修改模型能力矩阵

## 模型能力矩阵

| 模型        | 推理 | 编码 | 速度 | 成本 | 适用场景           |
| ----------- | ---- | ---- | ---- | ---- | ------------------ |
| opus        | 10   | 9    | 3    | 10   | 架构设计、复杂调试 |
| sonnet      | 8    | 9    | 7    | 5    | 代码生成、重构     |
| haiku       | 5    | 6    | 10   | 1    | 简单编辑、格式化   |
| gpt-4o      | 9    | 8    | 6    | 7    | 通用任务           |
| gpt-4o-mini | 6    | 6    | 9    | 2    | 快速问答、翻译     |
| qwen2       | 7    | 7    | 8    | 0    | 本地推理(免费)     |
