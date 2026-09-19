# 第一百零四次工程实施：Plugin Installer 下载异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-installer.js` 下载链的三条原样 Error 传播，并移除 HTTP 非 200 与超时 Error 中的动态 URL。Marketplace 下载、HTTP request、文件流、非 200 和超时失败现在统一向上游返回 `PLUGIN_MARKETPLACE_OPERATION_FAILED`。

request/file stream 的原始 Error 先进入严格日志；文件关闭、临时文件删除和失败传播顺序保持不变。该变更不放宽来源、完整性或安装校验。

## 主要实现

- `_downloadPlugin` 不再 `throw error`，改为稳定 Marketplace operation Error。
- HTTP 非 200 不再把 status/URL 拼入 Error 文本。
- request 和 file stream `error` 回调先记录严格日志，再拒绝稳定 Error。
- 下载超时不再把 URL 拼入 Error。
- 回归注入 Marketplace client secret，验证直接调用 `_downloadPlugin` 也拿不到原文。
- 源码门禁覆盖原样 throw/reject 与 URL Error 文本。

## 验证结果

```text
Plugin installer and shared boundaries:
  Test Files  3 passed (3)
  Tests      59 passed (59)

Source gates:
  raw caught-error throw/reject in plugin-installer.js: 0
  dynamic download URL Error text: 0

ESLint:
  0 errors (11 pre-existing warnings)
```

## 仍未完成

- Plugin API facade 与部分 Marketplace 模块仍有内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
