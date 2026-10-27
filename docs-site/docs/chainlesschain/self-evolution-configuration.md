# CLI 与 IDE 自进化开关配置

## 概述

CLI **0.166.127** 已公开发布并完成归档与签名来源回读；CLI 和 cc ui 的开关可以立即使用。配套 VS Code 扩展 **0.37.165** 已在 Open VSX 公开上架，JetBrains **0.4.182** 也已公开上架，两者完成制品回读（Microsoft Marketplace 仍未发布），可升级使用 IDE 功能。移动端与 PC 安装包 [v5.0.3.142](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.142) 已公开发布，五平台构建、22 个资产完整性和三套桌面更新元数据回读均已通过。

## 核心特性

新安装和旧版本自动生成的本地 Evolution 部署默认关闭。关闭后仍可使用普通 Agent、单次提问、交互聊天和 cc ui 的 Quick Ask、意图理解与确认。

已有手动配置并启用的 managed/test 部署，以及显式提供部署环境变量的外部部署，在配置项缺省时仍视为主动开启。需要明确关闭这些部署时，设置 `evolution.enabled` 为布尔值 `false`。

关闭会保留已有部署、信任信息和历史记录，之后可以重新开启。工具权限与沙箱策略继续生效。

## 配置参考

先查看当前进程实际使用的配置文件路径：

```bash
cc config list
```

通常是 `~/.chainlesschain/config.json`；Windows 通常位于 `%USERPROFILE%\.chainlesschain\config.json`。使用自定义配置目录时，以命令显示的路径为准。例如 `CHAINLESSCHAIN_HOME` 指向所选配置目录，其下使用 `config.json`。CLI 与 IDE 只有在使用相同配置目录时才会共享开关。

在现有 JSON 中合并以下字段，不要覆盖其他设置：

```json
{
  "evolution": {
    "enabled": false
  }
}
```

- `false`：明确关闭，优先于部署环境变量。
- `true`：明确开启；首次实际使用时可初始化本地签名运行时，已有本地部署可按需升级。
- 未设置：按上面的默认行为判断。修改其他配置不会把缺省值误存成明确关闭。

必须使用 JSON 布尔值 `true` 或 `false`，不能写成字符串 `"true"`、`"false"`。

## 使用示例

通过配置命令修改共享开关：

```bash
cc config set evolution.enabled true
cc config set evolution.enabled false
cc config get evolution.enabled
```

也可以使用部署命令。首次开启时，若没有已有部署或外部部署选择，开启命令会初始化本地签名运行时：

```bash
cc evolution deployment enable
cc evolution deployment disable
cc evolution deployment status --json
```

`config get` 查看配置值；配置项缺省且存在主动选择的外部或手动部署时，应以 `deployment status` 判断部署状态。状态中的 `evolutionEnabled` 表示开关策略，`effectiveEnabled` 表示是否选择了部署，`verified` 表示部署验证结果。只通过配置文件开启、尚未初始化本地运行时的情况下，开关可以已开启而部署尚未就绪。

开启后，损坏的部署文件、签名或不满足准入条件的部署仍会报错；不会自动切换成普通模型请求。外部部署使用 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 和 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`，两者需要配套配置。

## 系统架构

| 入口      | 操作                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| cc ui     | 运行 `cc ui`，打开 **Skill 自进化配置** 页面，切换顶部 **自进化开关**。                                                    |
| VS Code   | 从命令面板打开 **Skill 自进化配置**，切换自进化开关。命令 ID 为 `chainlesschain.evolution.configure`。                     |
| JetBrains | 在 ChainlessChain 的设置或动作中打开 **Skill 自进化配置**，切换顶部开关。动作 ID 为 `chainlesschain.evolution.Configure`。 |

没有已有部署时也可以使用开关开启。三个入口最终修改同一份 CLI 用户配置中的 `evolution.enabled`。若另一个界面已经打开，刷新状态后查看最新结果。

## 生效时机

Android 本地终端提供“关闭自进化”和“开启自进化”按钮，通过独立 CLI 进程修改同一份配置，并在成功后显示结果。桌面 Web 界面使用 **Skill 自进化配置** 页面；新的聊天请求会重新读取开关。移动客户端内置 CLI 必须与本次已验证公开的 CLI 版本一致，Android 发布流程会检查归档内部版本，旧归档会阻止构建。

- cc ui 的 Quick Ask 和模型意图请求会在每次新请求时重新读取配置。
- 已运行的 Agent 会话需要停止后重新启动，才能使用新设置。
- CLI 的新命令进程读取当前配置。

切换开关不表示已经取消正在执行的模型请求或后台任务；需要停止任务时，使用对应会话的停止操作。

## 故障排查

CLI 包含 RRSI 评估相关模块。这个开关控制普通模型入口是否使用 Evolution 运行时，开启本身不会启动完整 RRSI 评估活动，也不会自动发布候选 Skill。自动晋升保持 `HOLD`。

遇到 `CC_AGENT_EVOLUTION_INGRESS_FAILED` 时，可以先检查：

1. 运行 `cc evolution deployment status --json`，确认开关、部署选择和验证状态。
2. 不需要自进化时，运行 `cc config set evolution.enabled false`，然后重新启动 Agent 会话。
3. 需要自进化时，检查报告中的部署或证据错误，修复后重新开启并检查状态。

该错误码涵盖多种原因。已发布的 `.126` 恢复摘要修复针对宿主截断保留上下文造成的不完整 JSON；不能据此认定所有原始证据错误都已解决。

## 性能指标

本轮没有新增性能基准或模型任务验收；开关不承诺吞吐或延迟提升。输入与图片预算见[输入与恢复](./agent-input-and-recovery)。

## 测试覆盖

CLI .127 的精确发行源码通过 Linux、Windows、macOS CLI CI 与 Strict Sandbox，经 OIDC 发布并验证公共归档。两个 IDE 与五平台客户端已分别通过发布门与公开制品回读。累计 **32/45**、**13** 项未完成；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。[发布回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release127-public/publication.json)。

## 安全考虑

开关不改变普通工具权限或沙箱。开启部署仍须通过签名与证据验证；关闭保留已有数据，不取消正在执行的任务。不要修改账本或摘要来强行恢复。

## 关键文件

- `packages/cli/src/lib/evolution/evolution-enabled.js`：布尔值读取。
- `packages/cli/src/lib/evolution/evolution-deployment-loader.js`：选择与验证。
- `packages/cli/src/lib/evolution/evolution-deployment-config.js`：启停和状态。

## 相关文档

- [CLI 使用说明](https://github.com/chainlesschain/chainlesschain/blob/main/packages/cli/README.md)
- [VS Code 插件使用说明](https://github.com/chainlesschain/chainlesschain/blob/main/packages/vscode-extension/README.md)
- [JetBrains 插件使用说明](https://github.com/chainlesschain/chainlesschain/blob/main/packages/jetbrains-plugin/README.md)
- [CLI / IDE 当前升级指南](./cli-ide-update-2026-10-27)
