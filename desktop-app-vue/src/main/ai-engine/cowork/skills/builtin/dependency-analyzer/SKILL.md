---
name: dependency-analyzer
display-name: Dependency Analyzer
description: 依赖分析技能 - 导入图构建、变更影响分析、CVE可达性、循环依赖检测
version: 1.0.0
category: analysis
user-invocable: true
tags: [dependency, import, graph, impact, circular, vulnerability, license]
capabilities:
  [
    import-graph,
    impact-analysis,
    circular-detection,
    vulnerability-reachability,
    license-check,
  ]
tools:
  - file_reader
  - code_analyzer
handler: ./handler.js
instructions: |
  Use this skill when the user needs to understand module dependencies, analyze the
  impact of code changes, detect circular dependencies, or check dependency vulnerabilities.
  Build import/require graphs from source code and npm/pip/maven dependency trees.
  Provide change impact analysis: given a file modification, enumerate all affected
  downstream consumers. For security, perform reachability analysis to determine if
  CVEs in dependencies actually affect the application.
examples:
  - input: "/dependency-analyzer src/main/llm/session-manager.js --impact"
    output: "Impact analysis: 14 files depend on session-manager. Changes affect: conversation-ipc, manus-optimizations, context-engineering..."
  - input: "/dependency-analyzer --circular src/main/"
    output: "Found 2 circular dependencies: llm/→hooks/→llm/ and browser/→actions/→browser/"
  - input: "/dependency-analyzer package-lock.json --vulnerabilities"
    output: "12 CVEs found, 3 reachable from application code, 9 in unused code paths"
os: [win32, darwin, linux]
author: ChainlessChain
---

# 依赖分析技能

## 描述

构建代码库的模块导入图和包依赖树。提供变更影响分析、循环依赖检测、CVE 可达性分析和许可证兼容性检查。

## 使用方法

```
/dependency-analyzer [目标] [选项]
```

## 分析类型

### 导入图构建

```
/dependency-analyzer src/main/ --graph
```

解析所有 `import`/`require` 语句，构建模块依赖图:

- 直接依赖和传递依赖
- 导出/导入的具体符号
- Mermaid 图表输出

### 变更影响分析

```
/dependency-analyzer src/main/llm/session-manager.js --impact
```

给定一个文件修改，追踪所有受影响的下游消费者:

- 直接导入者
- 传递依赖者
- 受影响的 IPC 处理器
- 受影响的测试文件

### 循环依赖检测

```
/dependency-analyzer --circular src/main/
```

使用拓扑排序检测循环依赖:

- 列出所有循环路径
- 建议解耦方案
- 影响严重度评估

### CVE 可达性分析

```
/dependency-analyzer package-lock.json --vulnerabilities
```

不仅列出 CVE，还追踪漏洞是否可达:

- 运行 `npm audit` 获取 CVE 列表
- 追踪漏洞函数是否被应用代码调用
- 标记"可达"（需修复）vs "不可达"（低优先级）
- 修复建议（版本升级、替代包）

### 许可证检查

```
/dependency-analyzer --licenses
```

扫描所有依赖的许可证:

- 许可证类型汇总 (MIT, Apache, GPL, BSD 等)
- 兼容性矩阵
- GPL 传染风险警告

## 输出格式

### 影响分析报告

```
Impact Analysis: session-manager.js
====================================
Direct dependents: 6 files
  → conversation-ipc.js (imports: SessionManager)
  → manus-optimizations.js (imports: SessionManager)
  → context-engineering.js (imports: SessionManager)
  ...

Transitive dependents: 8 additional files
Affected IPC handlers: 12
Affected tests: 5 test files
Risk level: HIGH (core module)
```

## 示例

分析影响范围:

```
/dependency-analyzer src/main/database.js --impact
```

检测循环依赖:

```
/dependency-analyzer --circular src/main/
```

漏洞可达性分析:

```
/dependency-analyzer package-lock.json --vulnerabilities --reachability
```
