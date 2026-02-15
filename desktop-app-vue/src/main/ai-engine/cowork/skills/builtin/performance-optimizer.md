---
name: performance-optimizer
version: 1.0.0
description: 性能优化技能 - 性能分析、瓶颈识别、优化建议
author: ChainlessChain
category: development
gate:
  platform: [win32, darwin, linux]
tools:
  - file_reader
  - code_analyzer
  - performance_profiler
supported-file-types: [js, ts, py, java, go, vue, jsx, tsx, sql]
---

# 性能优化技能

## 描述
对代码进行性能分析，识别CPU、内存和I/O瓶颈，提供具体的优化建议和基准对比。支持前端渲染、后端服务和数据库查询优化。

## 使用方法
```
/performance-optimizer [目标路径或文件] [选项]
```

## 选项

- `--focus <area>` - 分析重点: cpu, memory, io, render, all (默认: all)
- `--depth <level>` - 分析深度: shallow, normal, deep (默认: normal)
- `--benchmark` - 生成优化前后的基准对比
- `--fix` - 自动应用低风险优化

## 执行步骤

1. **性能基线**: 分析当前代码结构，建立性能基线和复杂度评估
2. **瓶颈分析**: 识别算法复杂度问题、内存泄漏风险、不必要的渲染和慢查询
3. **优化建议**: 提供具体的代码修改方案，按影响大小和实施难度排序
4. **基准对比**: 估算优化后的性能提升幅度，提供对比数据

## 检查项目

| 类别 | 检查内容 |
|------|----------|
| 算法 | 时间复杂度、空间复杂度、不必要的循环 |
| 内存 | 闭包泄漏、大对象持有、未释放引用 |
| I/O | 同步阻塞、N+1查询、缺少缓存 |
| 渲染 | 不必要的重渲染、大列表未虚拟化、图片未懒加载 |
| 网络 | 请求合并、压缩、CDN、预加载 |
| 数据库 | 慢查询、缺少索引、全表扫描 |

## 优化级别

| 级别 | 说明 | 风险 |
|------|------|------|
| P0 | 严重性能问题，必须修复 | 低 |
| P1 | 明显性能瓶颈，建议优先修复 | 低-中 |
| P2 | 一般性能改进，建议优化 | 中 |
| P3 | 微优化，可选 | 中-高 |

## 输出格式
- 性能评分: 1-100分（基于综合分析）
- 瓶颈列表: 按严重程度排序的性能问题
- 优化方案: 具体代码修改建议和预期收益
- 基准对比: 优化前后的性能指标对比

## 示例

分析文件性能:
```
/performance-optimizer src/main/rag/hybrid-search-engine.js
```

聚焦内存分析:
```
/performance-optimizer src/renderer/stores/ --focus memory --depth deep
```

生成基准对比:
```
/performance-optimizer src/main/llm/context-engineering.js --benchmark
```
