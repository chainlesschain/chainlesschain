---
name: research-agent
display-name: Research Agent
description: 技术研究代理 - 搜索文档、Stack Overflow、GitHub获取技术方案，综合输出可执行建议
version: 1.0.0
category: knowledge
user-invocable: true
tags: [research, search, documentation, stackoverflow, comparison]
capabilities: [keyword-extraction, source-compilation, recommendation-synthesis]
tools:
  - file_reader
  - code_analyzer
  - web_search
requires:
  bins: [npm]
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the user needs technical research: comparing libraries, finding
  solutions to errors, evaluating dependencies, or searching documentation. For library
  comparison (--compare), read both package.json files if installed and compare metadata
  (version, license, dependencies count, last update). For error solving (--solve), parse
  the error message, extract key terms, and provide known solution patterns for common
  Node.js errors (ECONNREFUSED, ENOENT, MODULE_NOT_FOUND, ERR_MODULE_NOT_FOUND, etc.).
  For evaluation (--evaluate), check if the library is in the project and assess its
  maintenance status. For docs (--docs), search local project files for usage patterns.
  Always provide actionable recommendations with specific commands or code snippets.
examples:
  - input: "/research-agent --compare express koa"
    output: "express: v4.18.2, MIT, 30 deps, mature ecosystem. koa: v2.14.2, MIT, 24 deps, modern async/await. Recommendation: express for stability, koa for modern patterns."
  - input: "/research-agent --solve ECONNREFUSED 127.0.0.1:5432"
    output: "Error: Connection refused to PostgreSQL. Solutions: 1) Check if PostgreSQL is running (pg_isready), 2) Verify port 5432 is not blocked, 3) Check pg_hba.conf for auth settings."
  - input: "/research-agent --evaluate sharp"
    output: "sharp v0.33.2: MIT license, native addon (libvips), 2.1M weekly downloads, active maintenance. Used in this project for image processing. No known CVEs."
  - input: "/research-agent --docs WebRTC"
    output: "Found 5 local references: webrtc-data-channel.js, P2PClient.kt, WebRTCClient.kt. Key patterns: ICE candidate handling, DataChannel 'chainlesschain-data' label."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [compare, solve, evaluate, docs]
      description: Research mode
    args:
      type: array
      items: { type: string }
      description: Arguments for the selected mode
output-schema:
  type: object
  properties:
    query: { type: string }
    mode: { type: string }
    results: { type: object }
    recommendations: { type: array }
    searchQueries: { type: array }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Research Agent 技能

## 描述

技术研究代理，帮助用户搜索文档、比较技术方案、解决错误和评估依赖。综合本地项目信息和已知解决方案模式，输出可执行的技术建议。

## 使用方法

```
/research-agent [选项]
```

## 模式

### 库比较 (--compare)

```
/research-agent --compare express koa
```

比较两个库的:

- 版本和许可证
- 依赖数量
- 维护状态
- 生态系统成熟度
- 适用场景建议

### 错误求解 (--solve)

```
/research-agent --solve "ECONNREFUSED 127.0.0.1:5432"
```

解析错误信息:

- 提取关键错误码
- 匹配已知错误模式
- 提供分步解决方案
- 生成搜索查询建议

### 库评估 (--evaluate)

```
/research-agent --evaluate lodash
```

评估单个库:

- 是否已在项目中使用
- 包元数据分析
- 维护状态评估
- 安全漏洞检查
- 替代方案建议

### 文档搜索 (--docs)

```
/research-agent --docs WebRTC
```

搜索本地项目:

- 源代码中的使用模式
- 相关文件列表
- 代码示例摘取
- 关键实现模式

## 已知错误模式

| 错误码           | 原因            | 快速解决           |
| ---------------- | --------------- | ------------------ |
| ECONNREFUSED     | 目标服务未运行  | 启动服务或检查端口 |
| ENOENT           | 文件/目录不存在 | 检查路径拼写       |
| MODULE_NOT_FOUND | 模块未安装      | npm install        |
| EADDRINUSE       | 端口被占用      | 关闭占用进程       |
| EPERM            | 权限不足        | 检查文件权限       |
| ETIMEOUT         | 连接超时        | 检查网络或增加超时 |

## 输出示例

```
Research: express vs koa
========================
                express         koa
Version:        4.18.2          2.14.2
License:        MIT             MIT
Dependencies:   30              24
Stars:          62k             34k
Last Update:    2 months ago    3 months ago
Bundle Size:    ~208 KB         ~60 KB

Recommendations:
  1. Choose express for REST APIs with rich middleware ecosystem
  2. Choose koa for modern async/await patterns and smaller footprint
  3. Both are production-ready and well-maintained
```
