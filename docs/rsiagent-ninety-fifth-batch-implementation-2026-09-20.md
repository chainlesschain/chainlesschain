# 第九十五次工程实施：Plugin Loader 成功命令输出最小披露

日期：2026-09-20

## 本批结论

本批关闭 Plugin Loader 辅助命令成功时把原始 stdout 返回给内部调用者的路径。`execCommand` 成功后仅返回字节数、保留字节数、截断标记和流式 SHA-256；原始文本不再属于返回契约。

当前三个生产调用方只等待命令完成，不消费 stdout，因此该收窄不改变 NPM 包安装、依赖安装或 ZIP 解压流程。失败路径继续返回稳定 code/message/exitCode，原始 stdout、stderr 和 spawn Error 均不向调用方披露。

## 主要实现

- 新增只读命令输出回执投影，显式排除 `text`。
- `execCommand` JSDoc 从字符串输出改为不含原始输出的完成回执。
- 成功命令的短输出只返回确定性摘要和长度元数据。
- 超过 64 KiB 的成功输出只报告截断状态与全流摘要，不返回截断文本。
- 回归注入成功路径 secret，验证序列化回执不包含该内容。

## 验证结果

```text
Plugin Loader process boundary:
  Test Files  2 passed (2)
  Tests       9 passed (9)

ESLint:
  0 errors
```

## 仍未完成

- Plugin/Marketplace 成功业务 payload、health baseURL 和 manifest 等数据仍需字段级用途授权与容量限制。
- Marketplace/Plugin 内部 rethrow、旧错误数据库行和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
