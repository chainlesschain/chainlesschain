# CLI 0.166.134 / IDE 升级说明

## 概述

此候选版本未发布到 npm。后续发行改用 [CLI 0.166.135](./cli-ide-update-2026-10-31-135)，本页保留候选时的修复范围。

CLI **0.166.134**、Open VSX **0.37.172**、JetBrains **0.4.189** 为本轮配对版本，Kernel 保持 **0.1.11**。当前为发布准备：先完成精确源码的三系统 CLI CI 与 Strict Sandbox，再经 Actions OIDC 发布 CLI、公开回读，最后发布 IDE 插件。

## 核心特性

本版修复非流式 OpenAI Responses 读取 JSON 时断连直接显示 `terminated` 的路径；无已接受输出时使用既有有限重试，每个物理请求单独记录，HTTP/provider 拒绝、取消、用量持久化失败与工作流禁止重放策略仍有效。请求头与 JSON 正文读取都有期限，用户取消优先。

流式请求收到完成事件即可结算，连接持续开放不再阻塞下一步；超时不再等待一个可能永不结束的 reader.cancel。未完成工具调用仍不执行、不自动重放，已经执行的工具不会因这次恢复而再次执行。

保存与恢复后台启动配置时，显式空工具白名单继续表示不允许工具；非法权限、沙箱及预算值被拒绝。修复前，空列表可能在 argv 重建时丢失，非法值可能静默变为默认值。

## 系统架构

CLI 运行时处理 Responses 传输、工具调用与用量结算；Web 与 IDE 宿主通过 CLI 执行请求。后台启动配置在保存和恢复时保持权限约束，Kernel 保持 **0.1.11**。

## 配置参考

显式空工具白名单表示不允许工具，不能解释为缺省白名单。权限、沙箱和预算值必须通过校验；升级时继续使用已有的有效配置。

## 使用示例

此候选未发布，请按[后续升级说明](./cli-ide-update-2026-10-31-135)安装已公开的 CLI **0.166.135**：

```bash
npm i -g chainlesschain@0.166.135 --registry https://registry.npmjs.org
cc --version
cc doctor
```

安装后重启已经运行的 `cc ui`、终端或 IDE 聊天宿主。Microsoft Marketplace、PC 与移动端不在本轮范围。

## 性能指标

本次修复为请求读取和停滞流设置终止边界，未公布新的延迟或吞吐量基准。连接完成事件的处理回归不能替代生产性能测量。

## 测试覆盖

历史 OpenAI 实测为 **39/45**，不是本版新的 45 项通过率。此次补充错误场景回归并修复根因；旧任务、候选文件、原始失败和用量没有改写。详情见[根因分析](https://github.com/chainlesschain/chainlesschain/blob/feature/fix-openai-turn-termination/docs/research/cli/openai-turn-recovery-134.md)。

## 安全考虑

未完成工具调用仍不执行、不自动重放。HTTP/provider 拒绝、取消、用量持久化失败和禁止重放策略继续约束恢复流程；显式空工具白名单继续禁止工具。

## 故障排查

遇到 `terminated` 或流式请求不结束时，先运行 `cc --version` 核对宿主使用的版本，并在升级后重启宿主。若配置恢复失败，检查权限、沙箱及预算字段是否有效。

## 关键文件

`packages/cli/src/runtime/agent-core.js` 处理 Responses 请求；`packages/cli/src/lib/background-launch-profile.js` 保存和恢复启动配置；`docs/research/cli/openai-turn-recovery-134.md` 记录根因与回归范围。

## 相关文档

参见[CLI 0.166.135 升级说明](./cli-ide-update-2026-10-31-135)和[CLI 0.166.133 升级说明](./cli-ide-update-2026-10-30-133)。
