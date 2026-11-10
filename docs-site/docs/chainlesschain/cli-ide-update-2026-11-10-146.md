# 2026-11-10 CLI .146 与双 IDE 安装升级指南

## 概述

当前公开组合是 **CLI 0.166.146 / Open VSX 0.37.185 / JetBrains 0.4.199**，两款 IDE 都推荐 CLI .146。客户端公开版仍是 **v5.0.3.145**；产品 .146 尚未完成完整发行，不能由 CLI 或插件公开推断客户端已经更新。

## 配置参考

### 公开版本与渠道

| 组件                  | 当前公开版本 | 状态与来源                                                                                                             |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| CLI                   | 0.166.146    | [Actions OIDC 发布与公共包核验](https://github.com/chainlesschain/chainlesschain/actions/runs/42758119265)             |
| Agent Protocol        | 0.1.13       | 子包先于 CLI 发布，公开依赖安装已核验                                                                                  |
| Context/Memory Kernel | 0.1.12       | 公开 npm 子包，CLI 固定依赖                                                                                            |
| Agent SDK             | 0.2.18       | 公开 npm 子包                                                                                                          |
| Session Core          | 0.3.27       | 版本保持不变                                                                                                           |
| VS Code / Open VSX    | 0.37.185     | [标签发布成功](https://github.com/chainlesschain/chainlesschain/actions/runs/42819326161)，公开 VSIX 推荐 CLI .146     |
| JetBrains             | 0.4.199      | [官方发布](https://github.com/chainlesschain/chainlesschain/actions/runs/42761723143)成功，已审核并公开，推荐 CLI .146 |
| PC / Android / iOS    | v5.0.3.145   | 当前完整公开客户端；v5.0.3.146 仍待发行修复及整体核验                                                                  |

CLI、子包和 JetBrains 的发行源为 `daafda2cf7790580467dae8ce006ceaa1285d3b4`；VS Code .185 的发行源为 `2ae832f9054ac834b06d00a38ce1a95038ff43bb`。两个源码范围分别核验，不以最新主线或其他提交的测试替代准确发行提交结果。旧 .184 标签及其失败的基础设施运行保留历史身份，不重记为已发布成功版本。

## 使用示例

### 安装与升级

需要 Node.js **22.12.0 或更新版本**。先升级 CLI，再升级插件并重启已有 CLI / IDE 聊天宿主：

```bash
npm i -g chainlesschain@0.166.146 --registry https://registry.npmjs.org
cc --version
cc doctor
```

`cc --version` 应显示 `0.166.146`。若仍显示旧版，先检查 Doctor 给出的 CLI 路径，关闭旧宿主后重启；安装完成不表示已有进程已经换用新运行时。

### VS Code 及兼容编辑器

在支持 Open VSX 的编辑器中，从 [Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 安装 **ChainlessChain IDE 0.37.185**。扩展 ID 为 `chainlesschain.chainlesschain-ide`。

Microsoft Marketplace 仍未发布。官方 VS Code 可下载 [0.37.185 公开 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.185/file/chainlesschain.chainlesschain-ide-0.37.185.vsix)，再通过 **Extensions: Install from VSIX...** 安装。源码打包得到的文件需要单独验证，不能直接当作这个公开归档。

### JetBrains

打开 **Settings → Plugins → Marketplace**，从 [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge) 安装 **ChainlessChain IDE Bridge 0.4.199**。本版已审核公开；用户曾允许在上传成功后等待审核期间继续客户端阶段，那项授权不等同于当时已公开，现在的公开状态单独记录。

模型配置、已有会话的模型选择和原生授权仍需用户核对。插件升级不会自动更改模型配置，也不会代替桌面原生确认。

## 核心特性

- CLI 提供 `memory inspect` 与按修订校验的 `memory correct`，保留不含正文的修正通知及流式模型输入诊断。
- 记忆修正遇到旧修订会冲突；引用外部正文的修正仍受拒绝边界约束。耐久发布之后报错退出时，应先检查实际状态，再决定后续操作，避免自动重复副作用。
- 配套 JetBrains 恢复工具轨迹；VS Code .185 在保留真实 Remote-SSH 宿主门禁的前提下，修复了容器依赖安装的超时与失败处理。

操作前可查看 `cc memory --help`；命令可用性、持久化结果与业务验收是不同层次。包含修正事件的 SQLite 数据需要新版 reader；升级前保留数据库及其 WAL/SHM，混用旧 reader 或降级的兼容性尚未完成验收。

## 系统架构

CLI 与 IDE 通过桥接运行时配对；PC、Android、iOS 是另外核验和发行的客户端。发行顺序为子包、CLI、IDE，最后才是完整客户端。插件公开不会自动替换客户端内固定的 CLI 归档。

## 故障排查

### 客户端 .146 为什么还不是公开下载

[产品 Release 运行](https://github.com/chainlesschain/chainlesschain/actions/runs/42831809359)的 Windows、Linux、iOS 构建成功，但 Android 在正式组装 APK 前发现固定 `cc-cli.tgz` 内仍为 CLI **0.166.145**，而发行要求 **0.166.146**，因此被版本门禁拦截。macOS 构建仍在运行，尚无完整结果；单个平台成功不能代表五平台交付完整。

[Android bundle 刷新](https://github.com/chainlesschain/chainlesschain/actions/runs/42845777084)已启动，用于重新准备与公开 CLI .146 一致的归档。刷新启动或产物生成都不表示客户端已发行；还需要新的固定二进制摘要、Android 版本一致性、签名构建、完整五平台产物与公开资产核验。

目前安装客户端仍使用 [v5.0.3.145 正式发行](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.145)。不要仅凭 .146 的源码版本、Git 标签或部分构建下载推荐 .146 为完整公开产品。

## 测试覆盖

公开 CLI 和插件对应上表的准确源码与官方发布运行；VS Code .185 经过真实 Remote-SSH 宿主门禁。产品 .146 的部分构建成功只覆盖那些平台，Android 失败与 macOS 未完成结果仍需独立处理。

## 性能指标

本次安装升级记录不提供新增的速度、质量或成本基准。不同模型、宿主、数据量及网络条件会影响结果；历史测量不能直接作为当前 .146 组合的性能承诺。

## 安全考虑

工程 CI、安装探测、公开制品和模型真实任务各有独立范围。本轮更新不增加模型任务通过数，不把历史不同版本的成绩合并为 .146 的验收结果。多语检索质量、完整生命周期与跨平台恢复、真实账单对账及正式付费准入仍有未完成项；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

## 关键文件

`packages/cli/package.json`、`packages/vscode-extension/package.json` 与 `packages/jetbrains-plugin/gradle.properties` 记录源码版本；公开状态以本页链接的发行运行和公开渠道为准。Android 的 `cc-cli.tgz` 必须满足发行要求的 CLI 版本，不能仅修改展示版本绕过校验。

## 相关文档

历史记录见 [11-09 .145 升级指南](./cli-ide-update-2026-11-09-145)；当前入口见 [CLI](./cli)、[IDE 插件](./ide-plugin)、[发布与渠道](./agent-platform-release) 和 [输入与恢复](./agent-input-and-recovery)。
