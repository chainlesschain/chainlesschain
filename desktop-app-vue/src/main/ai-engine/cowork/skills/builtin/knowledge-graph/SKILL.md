---
name: knowledge-graph
display-name: Knowledge Graph
description: 知识图谱（实体提取、关系发现、图分析、社区检测、知识导出）
version: 1.0.0
category: knowledge
user-invocable: true
tags: [knowledge, graph, entity, relationship, network, analysis, NLP]
capabilities: [kg_extract, kg_analyze, kg_query, kg_export, kg_stats]
tools:
  - kg_extract
  - kg_analyze
  - kg_query
  - kg_export
instructions: |
  Use this skill to build and analyze knowledge graphs from text. Extracts entities
  (person, organization, location, concept, technology), discovers relationships,
  performs graph analytics (centrality, community detection), and exports to various formats.
  Integrates with the existing knowledge-graph engine modules.
examples:
  - input: "/knowledge-graph --extract document.md"
    output: "Extracted 15 entities, 8 relationships from document"
  - input: "/knowledge-graph --analyze --centrality"
    output: "Top entities by centrality: AI (0.85), Python (0.72), ..."
  - input: '/knowledge-graph --query "AI"'
    output: "Entity 'AI': 5 relationships (uses: Python, related: ML, ...)"
  - input: "/knowledge-graph --stats"
    output: "Graph: 45 entities, 32 relationships, 3 communities"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.md, .txt, .json]
---

# Knowledge Graph

知识图谱构建与分析技能。

## 功能

| 操作 | 命令                               | 说明                 |
| ---- | ---------------------------------- | -------------------- |
| 提取 | `--extract <file>`                 | 从文本提取实体和关系 |
| 分析 | `--analyze --centrality`           | 图中心性分析         |
| 查询 | `--query "<entity>"`               | 查询实体及其关系     |
| 统计 | `--stats`                          | 图统计信息           |
| 导出 | `--export --format json\|csv\|dot` | 导出知识图谱         |
| 加载 | `--load <file>`                    | 从JSON加载图谱       |
