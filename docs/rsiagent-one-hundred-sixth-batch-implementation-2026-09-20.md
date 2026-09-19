# 第一百零六次工程实施：Skill Marketplace Client 初始化异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `skill-marketplace-client.js` 初始化时原样抛出数据库 Error 的路径。表初始化失败仍会阻断客户端就绪，但调用方只收到固定 `SKILL_SERVICE_OPERATION_FAILED`，动态数据库 message/stack 不再传播。

缺少签名 Desktop governed host 是本地固定治理拒绝，不属于第三方异常；本批将其改为直接创建受控 Error，继续保留 `CC_GOVERNED_MARKETPLACE_UNAVAILABLE` code 和既有受控文案。

## 主要实现

- Skill Marketplace Client 接入共享稳定 operation Error。
- `initialize()` catch 不再 `throw error`。
- governed-host unavailable Error 改为专用固定构造器，不再使用局部 Error rethrow 形态。
- 回归向数据库初始化注入 secret，验证 rejection 固定且不含原文。
- 源码门禁断言该模块原样 caught-error rethrow 为 0。

## 验证结果

```text
Skill Marketplace Client and shared boundaries:
  Test Files  3 passed (3)
  Tests      49 passed (49)

Source gate:
  raw caught-error rethrows in skill-marketplace-client.js: 0

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- Plugin Loader、Permission Dialog、Plugin IPC fallback 与 Update Manager 仍有原样内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
