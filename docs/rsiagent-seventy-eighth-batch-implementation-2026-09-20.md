# 第七十八次工程实施：Remote 异常详情最小披露

日期：2026-09-20

## 本批结论

本批收紧 Remote Gateway、Command Router 与 P2P Command Adapter 的兜底异常响应。P2P 和 Mobile 信任边界不再把 handler `error.message` 或 `error.data` 通过 JSON-RPC 返回；Gateway/P2P adapter 自身的 internal error 也只返回稳定 code/message。

为保持进程内诊断兼容，Command Router 对不带 remote/mobile context 的本地调用仍保留旧 handler 错误详情。边界由调用 context 明确决定，而不是由异常内容或调用方自报字段决定。

## 主要实现

### 1. Command Router 远端错误投影

- 新增 `shouldExposeErrorDetails(context)`，`source === mobile` 或 `channel === p2p` 时固定返回 `Handler execution failed`，不附带 `error.data`。
- router 自身异常对 remote/mobile context 仅返回 `Internal router error`，不附带原始 `error.message`。
- 本地进程内调用继续返回既有 handler message/data，减少对内部调试和现有调用方的非必要破坏。

### 2. Gateway 与 Adapter 兜底响应

- `remote-gateway` 的 `-32603 / Internal Error` 不再附带捕获异常的 message。
- `p2p-command-adapter` 的 internal error 响应同样移除动态 message data。
- 日志仍使用前序批次的 redactor；远端响应与日志形成两道独立边界。

### 3. 防回退合同

新增运行时回归，向 P2P 与 Mobile context 的 handler 注入 message/data sentinel，验证响应只包含稳定错误且序列化结果无 sentinel；另验证本地调用兼容行为，并以源码合同禁止 Gateway/Adapter 恢复 `data: error.message`。

## 验证结果

```text
Router / mobile approval / gateway / P2P / disclosure boundary:
  Test Files  7 passed (7)
  Tests      108 passed, 7 skipped (115)

Focused disclosure boundary:
  Test Files  1 passed (1)
  Tests      3 passed (3)

ESLint:
  0 errors (6 pre-existing P2P adapter warnings)
```

## 仍未完成

- whitelist/approval/permission 拒绝仍包含部分 method 或受控拒绝原因，需要按产品可解释性与最小披露要求定义稳定枚举。
- permission audit、命令历史、registration/event payload 和 handler 业务响应仍需 tenant 隔离、字段级投影与访问审计。
- remote handlers、plugin/provider、Electron/Chromium 原生日志和崩溃转储尚未完成日志治理。
- 生产 DID/RBAC、tenant-scoped HMAC、保留/删除、告警及真实 Mobile/P2P/Electron 端到端验收仍待完成。
