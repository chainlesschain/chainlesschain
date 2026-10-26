# CLI 与 IDE 自进化开关配置

CLI **0.166.127** 已公开发布并完成归档与签名来源回读；CLI 和 cc ui 的开关可以立即使用。配套 VS Code **0.37.165**、JetBrains **0.4.182** 已公开上架并完成制品回读，可升级使用 IDE 功能。移动端与 PC 安装包仍需本轮构建和发布。

## 默认行为

新安装和旧版本自动生成的本地 Evolution 部署默认关闭。关闭后仍可使用普通 Agent、单次提问、交互聊天和 cc ui 的 Quick Ask、意图理解与确认。

已有手动配置并启用的 managed/test 部署，以及显式提供部署环境变量的外部部署，在配置项缺省时仍视为主动开启。需要明确关闭这些部署时，设置 `evolution.enabled` 为布尔值 `false`。

关闭会保留已有部署、信任信息和历史记录，之后可以重新开启。工具权限与沙箱策略继续生效。

## 配置文件

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

## CLI 开启、关闭和状态检查

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

## cc ui、VS Code 和 JetBrains

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

## RRSI 与错误排查

CLI 包含 RRSI 评估相关模块。这个开关控制普通模型入口是否使用 Evolution 运行时，开启本身不会启动完整 RRSI 评估活动，也不会自动发布候选 Skill。自动晋升保持 `HOLD`。

遇到 `CC_AGENT_EVOLUTION_INGRESS_FAILED` 时，可以先检查：

1. 运行 `cc evolution deployment status --json`，确认开关、部署选择和验证状态。
2. 不需要自进化时，运行 `cc config set evolution.enabled false`，然后重新启动 Agent 会话。
3. 需要自进化时，检查报告中的部署或证据错误，修复后重新开启并检查状态。

该错误码涵盖多种原因。已发布的 `.126` 恢复摘要修复针对宿主截断保留上下文造成的不完整 JSON；不能据此认定所有原始证据错误都已解决。

## 相关文档

- [CLI 使用说明](../../packages/cli/README.md)
- [VS Code 插件使用说明](../../packages/vscode-extension/README.md)
- [JetBrains 插件使用说明](../../packages/jetbrains-plugin/README.md)
- [CLI 文档索引](./README.md)
