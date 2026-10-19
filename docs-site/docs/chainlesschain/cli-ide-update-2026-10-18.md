# CLI / IDE 当前公开版本与下一候选升级指南

## 概述

2026-10-20 实时核对：npm CLI **0.166.107** 与 Session Core **0.3.20** 已公开，发行提交为 `6775d7a2deb093ec1979430fa63d61d7b1fc8705`。Open VSX **0.37.152** 与 JetBrains **0.4.169** 均已公开上架，下载制品的内容与标签构建一致。两个新插件均推荐 CLI `.107`。公开 `.105/.150/.167` 任务补测已收齐生成与独立验收各 **20/20**，新增 **6** 项候选及全流程通过；跨版本累计候选合格交付 **31/45**（普通 **26/36**、首次 **5/9**），剩余 **14** 项。本次 npm 发行未运行新的模型任务补测，累计覆盖不等于新版单轮成功率。Microsoft Marketplace 未发布。

## .107 npm 发行与 IDE 发布进度

Session Core 0.3.20 先于 CLI .107 发布并完成公共包字节核对。该提交完整 CLI CI 与 Strict Sandbox 跨平台矩阵通过，[npm OIDC 发布运行 39315709208](https://github.com/chainlesschain/chainlesschain/actions/runs/39315709208) 成功；公共依赖安装、CLI 签名来源及 Windows 公开安装回读通过。IDE 发行源码 `94429fada419e8f3e01a794516096ea554120556` 的[完整预检 39322021242](https://github.com/chainlesschain/chainlesschain/actions/runs/39322021242) 有 18 项成功；两个不可变标签均绑定该源码。[Open VSX 发布 39326212411](https://github.com/chainlesschain/chainlesschain/actions/runs/39326212411) 和 [JetBrains 发布 39326213042](https://github.com/chainlesschain/chainlesschain/actions/runs/39326213042) 均成功结束。Open VSX .152 的公开 VSIX 与标签构建摘要一致。JetBrains .169 已批准、已列出、未隐藏（更新 ID `1198232`）；公开 ZIP 的原始摘要与构建 ZIP 不同，但逐项核对的制品内容与标签构建一致，插件版本和 CLI .107 配对也已核验。

```bash
npm i -g chainlesschain@0.166.107 --registry https://registry.npmjs.org
cc --version
cc doctor
```

CLI .107 与 Session Core 0.3.20 已包含目标目录、插件面板、离线草稿移交和在线待审连接的 CLI / 共享契约代码。桌面互通仍需匹配源码构建、明确授权、预览和原生确认；产品 .140 保持独立发行。公开安装和发行证据见[发行回读目录](https://github.com/chainlesschain/chainlesschain/tree/release/cli-0.166.107-20261019/docs/research/cli/evidence/release-0.166.107-2026-10-20)。

## .106 公开发行与 IDE 配对（历史记录）

CLI .106 和 Open VSX .151 来自 `dca47fd91a209642b6536afd5bc9e99ec74c7d06`；该提交完整配置的 CLI CI、CLI Strict Sandbox、IDE 与 ARM64 门均成功，[npm OIDC 发布 39130542725](https://github.com/chainlesschain/chainlesschain/actions/runs/39130542725) 成功。Open VSX .151 推荐 CLI .106。JetBrains .168 标签绑定相同提交，但公开市场尚未核验，因此当前公开 .167 保留其 .105 推荐。

```bash
npm i -g chainlesschain@0.166.106 --registry https://registry.npmjs.org
cc --version
cc doctor
```

本轮增加通用拒绝边界与源码契约指导，修正传输中止分类和 IDE 回复生命周期；JetBrains .168 源码约束 Windows ACL 子进程与清理，不能以源码或发行门证明原生任务超时已解决。新的 .106/.151/.168 模型补测尚未运行。下面的 .105 记录保留该版本与已收齐补测的准确范围。

## .105 配对与补测结果（已完成轮次）

三个公开发行标签均绑定 `d4065008bb4eff84cfc09f9361f4ae4e9de2140f`。候选准备记录绑定 `4317bf01a4`，不是开发快照全部新增功能的发行证明。

| 组件                  | 本轮版本  | 当前状态                                           |
| --------------------- | --------- | -------------------------------------------------- |
| CLI                   | 0.166.105 | npm OIDC 发布成功，公开 metadata 与 tarball 已回读 |
| Open VSX              | 0.37.150  | 公开 API、VSIX 下载及制品摘要已核验                |
| JetBrains Marketplace | 0.4.167   | 已批准、已列出、未隐藏，公开 ZIP 已核验            |
| Microsoft Marketplace | —         | 未发布                                             |

两个插件推荐 CLI 0.166.105。Agent SDK 0.2.15、Session Core 0.3.19、Context/Memory Kernel 0.1.10、PDH 0.4.65 保持独立版本。

发行标签保持绑定 `d4065008bb4eff84cfc09f9361f4ae4e9de2140f`。该提交的 CLI CI、CLI Strict Sandbox、IDE 与 ARM64 完整矩阵均通过；[npm OIDC 发布运行 39102818482](https://github.com/chainlesschain/chainlesschain/actions/runs/39102818482) 成功。独立公开回读核对 npm metadata、tarball SHA-512 SRI、依赖声明以及六个 runtime/helper 文件与该提交的字节一致性，离线复核通过；CLI-only 收据 SHA-256 为 `611de63ae5eb821f8e395b2b7ec15c7b4329ad003d52816c0f4f337d10c5939f`。

三个公开制品已进入固定配对清单。`.105` 轮对原先未合格的 20 项补测，生成及独立验收记录各 20/20，新增合格 6 项；仍有 14 项未合格。累计 31/45 是多版本、多次尝试的候选交付覆盖，不是累计全流程通过率或新版单轮成功率。`COMPLETED` 表示该轮证据收齐。Windows JetBrains 的 ACL 遍历/校验超时仍需定位。

开发源码快照 `f21eac547e`（未纳入本次远端文档基线）的目标目录、插件面板、离线请求采纳、独立在线待审连接及演化存储边界尚未公开发布，新增 Session Core 出口须先独立发行。操作与限制见[目标草稿指南](./goal-drafts-current)及[本轮设计](/design/release-runtime-update-2026-10-18)。

## 核心特性

- 通用编码任务指导与纯静态相对导入反馈，不执行候选代码、不注入特定任务答案。
- 延迟写入未完成时不误报完成，区分 provider 网络中止与用户取消。
- JSON 终态增加有界安全错误类型和原因代码，不额外重试或重放请求；新增详情不复制 URL、headers、body 或 stack。
- JetBrains 历史与实时回答共用 Markdown 渲染，保留原文、会话和行标识。

## 系统架构

IDE 通过同一 CLI 完成模型与文件工具调用；CLI 在文件写入结果中反馈明确的相对导入错误。JetBrains 将保存的原始回答交给实时回答使用的渲染器。文件验收与 IDE 重启验证分别保留结果。

## 配置参考

需要 Node.js 22.12.0+ 和 npm 10.0.0+。公共 npm CLI 为 .107；已公开 Open VSX .152 和 JetBrains .169 均推荐 .107。升级后通过 Doctor 核对实际 CLI 路径。`CC_EDIT_DIAGNOSTICS=0` 可关闭编辑后诊断；诊断不执行测试，也不替代验收。

## 使用示例

复现 .105 已完成补测的固定版本命令（当前升级使用上方 .107）：

```bash
npm i -g chainlesschain@0.166.105 --registry https://registry.npmjs.org
cc --version
cc doctor
```

安装公开配对后重启 IDE，确认 Doctor 指向同一 CLI。对剩余 14 项使用核验后的新公开包补测；保留已合格候选的原始证据，不因诊断重复生成。原失败记录不改写。候选验收、宿主恢复和全流程结果分别报告；CLI .107、Session Core 0.3.20、Open VSX .152 和 JetBrains .169 均已公开并完成制品回读，新一轮模型补测尚未运行。

## 性能指标

`.105` 轮新增候选及全流程通过均为 6/20；累计 31/45 包含原 25 项按字节复用的文件和收据。不能把累计覆盖写成新版单轮成功率。端到端延迟和费用改善未评估、未推算。

## 测试覆盖

发行前本地相关回归 226 项通过；Astra 复核后的另 14 项聚焦检查与前述部分重叠。发行提交 `d4065008bb` 已通过 CLI CI 71/71、Strict 5/5、IDE 18 成功/1 条件跳过及 ARM64 10/10。公开 `.105` 任务补测现已收齐记录，但仍有失败；发行门、候选交付、全流程和完整 native review 分别验收。新公开 .106 及其新配对轮次尚未进行模型补测。

## 安全考虑

导入反馈只解析已写入内容和工作区内文件元数据，不执行候选代码；受管与文件工具受限会话不启动语言服务器。新增传输详情仅投影允许的类型及原因代码，不额外复制请求内容或重放模型调用。保存的 Markdown 原文和行标识仍予保留。

## 故障排查

导入错误请按目标文件的位置核对相对路径；写入成功不表示测试通过。IDE 仍显示旧版本时，检查 Doctor 指向的 CLI 路径并重启。若命中了系统 C 编译器 `cc`，使用 `chainlesschain --version` 核对身份并在 IDE 中设置正确路径。网络错误保留终态和原因代码，确认请求结果后再决定是否重试。

## 关键文件

CLI 的 `coding-task-guidance.js`、`file-import-diagnostics.js` 和 `transport-error-details.js` 分别提供任务指导、导入反馈和安全诊断；`agent-core.js` 管理工具及完成状态。JetBrains 的 `ChatTranscriptRendering.java` 统一实时与历史渲染。版本配对记录在两个插件的发布元数据中。

## 相关文档

参见 [CLI 使用指南](./cli.md)、[IDE 桥接](./ide-bridge.md)、[目标草稿指南](./goal-drafts-current)、[上一版升级记录](./cli-ide-update-2026-10-17.md)、[发布 PR #461](https://github.com/chainlesschain/chainlesschain/pull/461)和[公开版本与补测核对](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/documentation-release-status-2026-10-18.json)。
