---
name: api-tester
display-name: API Tester
description: API测试技能 - IPC处理器发现、测试生成、健康检查、回归测试
version: 1.0.0
category: testing
user-invocable: true
tags: [api, test, ipc, rest, health-check, regression, mock]
capabilities:
  [
    ipc-discovery,
    test-generation,
    health-check,
    regression-testing,
    mock-injection,
  ]
tools:
  - file_reader
  - file_writer
  - code_analyzer
handler: ./handler.js
instructions: |
  Use this skill to discover, test, and validate IPC handlers and REST API endpoints.
  Scan source code for ipcMain.handle() registrations, generate test stubs with
  appropriate mocks, run health checks against all registered channels, and perform
  regression testing. This is complementary to test-generator which focuses on
  unit tests for source functions, while api-tester focuses on interface-level testing.
examples:
  - input: "/api-tester --discover src/main/"
    output: "Discovered 200+ IPC handlers across 20 modules: audit (18), marketplace (22), skills (17)..."
  - input: "/api-tester --generate src/main/audit/audit-ipc.js"
    output: "Generated 18 test cases for audit IPC handlers with mock EventEmitter and DB stubs"
  - input: "/api-tester --health-check all"
    output: "Health check: 195/200 handlers responding, 5 handlers require initialization"
os: [win32, darwin, linux]
author: ChainlessChain
---

# API 测试技能

## 描述

自动发现和测试 IPC 处理器及 REST API 端点。扫描源代码中的 `ipcMain.handle()` 注册，生成测试用例，执行健康检查和回归测试。

## 使用方法

```
/api-tester [操作] [目标路径] [选项]
```

## 操作

### 发现 IPC 处理器

```
/api-tester --discover src/main/
```

扫描所有源文件，提取:

- `ipcMain.handle('channel', handler)` 注册
- `ipcMain.on('channel', handler)` 监听器
- 处理器的参数签名和返回类型推断
- 模块归属和依赖关系

### 生成测试

```
/api-tester --generate src/main/audit/audit-ipc.js
```

为每个发现的处理器生成:

- 正常路径测试（有效输入 → 期望输出）
- 参数验证测试（缺失/无效参数 → 错误响应）
- Mock 注入（数据库、文件系统、外部服务）
- 边界条件测试
- 超时和并发测试

### 健康检查

```
/api-tester --health-check all
```

对所有已注册的 IPC 通道执行:

- 可达性检查（通道是否注册）
- 参数验证检查（空参数调用）
- 响应格式验证
- 响应时间测量

### 回归测试

```
/api-tester --regression src/main/marketplace/marketplace-ipc.js
```

基于已有测试用例:

- 运行所有相关测试
- 对比响应与基线快照
- 报告变化和异常

## 输出格式

### 发现报告

```
IPC Handler Discovery Report
=============================
Total handlers: 200+
By module:
  audit-ipc.js: 18 handlers
  marketplace-ipc.js: 22 handlers
  skills-ipc.js: 17 handlers
  ...
```

### 测试生成

生成可直接运行的 Vitest 测试文件:

```javascript
describe("audit-ipc handlers", () => {
  it("audit:get-logs should return paginated logs", async () => {
    // ...
  });
});
```

## 示例

发现所有 IPC 处理器:

```
/api-tester --discover src/main/
```

为特定模块生成测试:

```
/api-tester --generate src/main/hooks/hooks-ipc.js
```

运行全局健康检查:

```
/api-tester --health-check all
```
