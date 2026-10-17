# CLI 0.166.104 与 IDE 升级指南

## 概述

以下版本截至 2026-10-17 已公开核验：

| 组件 | 公开版本 | 获取方式 |
| --- | --- | --- |
| CLI | 0.166.104 | 官方 npm registry |
| VS Code 兼容编辑器 | Open VSX 0.37.149 | Open VSX 扩展页 |
| JetBrains IDE | Marketplace 0.4.166 | JetBrains 插件市场 |
| Agent SDK | 0.2.15 | npm 子包；仅开发者需要单独安装 |
| 桌面 / Android / iOS | v5.0.3.140 | [独立产品发行](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.140) |

两个 IDE 均推荐 CLI 0.166.104。Session Core 0.3.19、Context/Memory Kernel 0.1.10、Personal Data Hub 0.4.65 保持独立版本。Microsoft Marketplace 尚无本轮发行。

## 配置参考

需要 Node.js 22.12.0+ 和 npm 10.0.0+。在命令行运行：

```bash
npm i -g chainlesschain@0.166.104 --registry https://registry.npmjs.org
cc --version
cc doctor
```

从 Open VSX 或 JetBrains Marketplace 更新插件，重启 IDE，再用 Doctor 查看实际 CLI 路径与版本。若 IDE 仍指向旧 CLI，检查该路径上的可执行文件及 IDE 配置；不要只根据全局 npm 的版本判断 IDE 已升级。

## 核心特性

- 恢复旧会话时，CLI 从已核验的会话记录恢复原预算根；headless、`stream-json` 和 REPL 不会因为恢复而重新获得一份预算。
- Jev 模型调用若取消、用量或记录状态未结清，CLI 会停止后续模型请求，避免将未知费用当成零。
- 项目预算锁写入失败会在模型发送前报错。后台会话协议校验状态 ID 和帧格式，并保留 UTF-8 输出。
- IDE 桥接重连会更新工具目录；结果未知的工具调用不会自动重放。

## 系统架构

CLI 持有会话记录、预算根、模型调用结算与 MCP 工具清单；IDE 通过桥接调用 CLI。Agent SDK 校验后台会话协议。重连只刷新工具目录，不能替代结果确认。

## 性能指标

本轮没有新的端到端延迟、吞吐或费用节省承诺。恢复会话沿用原预算，不能视为增加可用额度；来源 token 估算不等于 provider 账单。

## 测试覆盖

发行提交的 CLI CI、CLI Strict Sandbox、OIDC 发布与公开 npm 回读已完成；VS Code 的 Open VSX 工作流及 JetBrains 六组真实宿主与市场回读也成功。准确提交和工作流链接见[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/implementation-plan-2026-10-15/formal-paid-release-gate/README.md)。正式 36+9 评测没有运行。

## 故障排查

如果恢复失败，先保留会话记录和诊断输出，运行 `cc doctor`，检查预算存储是否可写，再重试恢复。出现未决用量或预算持久化错误时，不要通过新建会话重复发送可能已计费的请求。MCP 断线后确认工具的实际执行结果，再决定是否手动重试。

## 关键文件

`packages/cli/src/runtime/headless-runner.js`、`headless-stream.js` 和 `repl/agent-repl.js` 管理会话恢复与预算根；`packages/cli/src/harness/mcp-client.js` 负责桥接重连；`packages/agent-sdk/` 管理后台协议。

## 使用示例

安装后先运行上方的 `cc --version` 和 `cc doctor`，确认输出为 0.166.104 且 IDE 指向相同路径。然后从 IDE 恢复原会话；若提示未决用量，保存诊断并停止重复发送。

## 安全考虑

正式付费评测仍为 **NOT_PAID_READY / NOT_RUN**（任务 0/36、首次安装 0/9）；完整 native review **NOT_ADMITTED**，自动晋升 **HOLD**。公开安装包和市场上架不代表评测已完成。桌面与移动端继续从独立产品发行升级。

## 相关文档

参见[本轮设计](https://design.chainlesschain.com/release-runtime-update-2026-10-17.html)、[上一轮功能与草稿指南](./cli-ide-update-2026-10-16.md)和[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/implementation-plan-2026-10-15/formal-paid-release-gate/README.md)。
