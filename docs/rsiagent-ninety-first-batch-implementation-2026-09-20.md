# 第九十一次工程实施：Plugin Loader 子进程输出边界

日期：2026-09-20

## 本批结论

本批关闭 Plugin Loader 在 npm 依赖安装或辅助命令失败时把 stdout/stderr 拼入日志或 Error 的旁路。子进程输出现在边接收边做 SHA-256，最多保留 64 KiB；失败日志只把退出码与输出摘要交给上一批严格 Plugin logger，调用方只收到稳定 code/message 和可选数值 exitCode。

成功的通用辅助命令仍按原合同返回 stdout 字符串，但被硬限制为 64 KiB；当前安装/解压调用方忽略该返回值。本批不改变 process broker、命令白名单、provenance 或 shell=false 合同。

## 主要实现

- 新增有界进程输出收集器，逐 chunk 更新 SHA-256，只保存前 64 KiB，并记录 total/retained bytes 与 truncated 状态。
- npm dependency install 失败使用 `PLUGIN_DEPENDENCY_INSTALL_FAILED`；spawn 失败使用 `PLUGIN_DEPENDENCY_SPAWN_FAILED`。
- 通用 plugin command 非零退出使用 `PLUGIN_COMMAND_FAILED`；spawn 失败使用 `PLUGIN_COMMAND_SPAWN_FAILED`。
- 所有失败 message 固定，不含 command、路径、stdout/stderr 或原始 Error；数值 exitCode 保留。
- 回归覆盖 shell=false/provenance、成功输出硬上限、dependency/command 失败 secret 以及 spawn Error secret 不披露。

## 验证结果

```text
Plugin Loader process boundary and plugin logger:
  Test Files  2 passed (2)
  Tests      9 passed (9)

ESLint:
  0 errors, 0 warnings
```

## 仍未完成

- 成功 stdout 虽已限为 64 KiB，仍需按具体命令用途决定是否完全改为摘要或受控结构化结果。
- process broker 的真实 OS sandbox、网络阻断、依赖安装来源锁定与供应链签名仍需目标环境验证。
- 插件业务 payload、数据库/audit/history、插件自有日志和 sandbox/第三方 SDK 原生日志仍需治理。
- tenant-scoped HMAC、生产保留/删除、读取审计、访问告警与真实多平台故障演练未完成。
