# CLI / IDE 升级与主线能力核对（2026-11-09）

## 概述

本页按 `main@c34a664f42`、Git 记录和公开下载回读更新。公开 CLI 源为 `4e4b421bfb42e524f071c9ad70c2a2a2ce607374`，与最新主线分别记录。

| 渠道         | 公开版本   | 本轮核对                                                   |
| ------------ | ---------- | ---------------------------------------------------------- |
| CLI          | 0.166.145  | npm latest、归档 SHA-512 与来源元数据                      |
| Session Core | 0.3.27     | npm latest 与归档 SHA-512                                  |
| Open VSX     | 0.37.181   | 公开 VSIX；内置推荐 CLI .145；下载突破 7 万+（项目方确认） |
| JetBrains    | 0.4.198    | update 1215424 已批准、列出且可下载；推荐 CLI .145         |
| PC / mobile  | v5.0.3.145 | 独立发行，22 个公开资产；v5.0.3.146 仅为源码版本           |

VS Code 源码版本 **0.37.182** 尚不作为公开版推荐。历史 .144 标签未改写；按 .145 的准确发行提交核对，不沿用旧标签门禁。

## 核心特性

- **公开 .145**：承接本地算力配置、受控创建请求、目标移交与签名恢复，以及 Memory 在实际发送前的授权复核。原生功能需要匹配桌面实现。
- **最新主线**：模型输入来源、发送前复核及用量归因；REPL 运行中追加输入、压缩及重启恢复；持久 MCP Tasks 及原会话结果交付。
- **最新主线**：Memory 查询取消/清理、来源撤权、检索与响应诊断；IDE 桥接不可达时的失败定位与独立 Electron loopback 检查。
- **最新主线**：可信宿主计费窗口持久化、过期合同重启后的原请求结算恢复。真实账号计价与账单对账仍待核验。

## 系统架构

CLI 与共享 Runtime 持有会话、工具、授权及费用状态；IDE 展示经过校验的投影。诊断汇总与 Markdown 不是执行授权。桌面端负责原生确认及项目写入，CLI / IDE 升级不会自动升级已有桌面程序。

## 配置参考

升级后重启旧宿主，用 Doctor 核对实际 CLI 路径。公开组合固定 CLI .145 / Open VSX .181 / JetBrains .198，不按仓库包版本猜测商店版本。

`cc agent --no-recall-memory` 为当前 CLI 的显式自动回忆关闭选项；恢复会话时再次指定。它不删除已有记忆，不撤回此前发出的内容。诊断导出不默认包含完整模型请求正文。

## 使用示例

```bash
npm i -g chainlesschain@0.166.145 --registry https://registry.npmjs.org
cc --version
cc doctor
cc agent --no-recall-memory
```

在匹配主线构建中，用 `cc session show <session-id> --json --model-inputs` 查看已验证的模型输入诊断摘要。每项来源的选择、发送与实际用量分开解释；显示历史不代表重复执行。

`goal transfer-to-project` / `goal restore-transfer` 已进入公开 CLI .145，但不要仅凭 CLI 安装就执行真实迁移。先准备匹配桌面构建、原生项目凭据和当前预览，再显式确认；目标导入后保持暂停，不继承原有权限。

## 性能指标

本次未新增模型任务或性能基准。历史 Sol 原冻结项目 **41/45**、含修复项目源码的跨版本累计 **45/45**、独立修正四项 **2/4** 分开保留；火山历史累计 **36/45**、.140 修正轮生成 **39/45** / 严格 **24/45** 也不合并。Memory 本机响应证据不能代替三系统冷/热/混合 SLO。

## 测试覆盖

准确发行源的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/42494781968) 共 76 项：**75 成功、1 跳过**；[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/42494781805) **6 成功**，配置覆盖 Linux / Windows / macOS。[OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/42495050656)成功。其他同 SHA 工作流仍有失败或取消，完整回读保留，不能称全部 CI 通过。

本轮独立下载 CLI、Session Core、Open VSX 与 JetBrains，核对归档摘要及包内版本；不声称再次验证了来源签名的密码学链或 IDE 与官方构建的全量字节一致性。最新原生计价 Windows 合成回归 **234/234** 内已含 authority **81/81**，另有 **37/37** 检查，不重复累计为实际业务验收。

## 安全考虑

新端点不借用旧端点凭据；HTTP 需显式许可。移交沿原身份重查，不确定结果不盲目重放；回退必须验证原生持久作废及签名回执。计费缺失、冲突或未知时保留全额责任。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留，Microsoft Marketplace 仍未发行。

## 故障排查

- 升级后仍显示旧版本：关闭旧聊天宿主，核对 Doctor 中的实际路径后重启。
- IDE bridge 不可达：查看 bridge / Electron loopback 诊断；扩展激活与宿主 TCP 故障分开定位。
- 恢复或外部操作结果未知：先查持久会话/回执，避免自动重复副作用。
- 原生创建/移交入口缺失：检查桌面构建匹配；公开产品 .145 不等于最新原生实现。

## 关键文件

- `packages/cli/src/commands/session-show.js` 与 `src/lib/session-model-input-diagnostics.js`：只读输入诊断。
- `packages/cli/src/lib/mcp-tasks.js`：任务持久状态和交付。
- `packages/vscode-extension/test/extension-host/loopback-diagnostic.cjs`：宿主网络隔离诊断。
- [回读、摘要与准确源码记录](https://github.com/chainlesschain/chainlesschain/blob/feature/site-refresh-20261109/docs/research/cli/evidence/documentation-refresh-20261109/README.md)。

## 相关文档

- [CLI 指南](./cli) · [IDE 指南](./ide-plugin) · [会话恢复](./agent-input-and-recovery)
- [本轮设计](/design/release-runtime-update-2026-11-09) · [目标移交设计](/design/cli-goal-transfer-source-2026-11-07)
- [上一公开组合 .143](./cli-ide-update-2026-11-06-143)
