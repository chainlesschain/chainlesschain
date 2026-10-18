# CLI 0.166.105 与 IDE 下一版候选

## 概述

2026-10-18：当前公开仍为 CLI **0.166.104**、Open VSX **0.37.149**、JetBrains **0.4.166**。下一版候选为 CLI **0.166.105**、VS Code **0.37.150**、JetBrains **0.4.167**，两个候选插件推荐 CLI `.105`；尚待最终提交完整 CI 矩阵、npm OIDC 发布与公开包回读，插件在 CLI 可获取后发行。36+9 活动已执行，累计候选合格 **25/45**；最新补测已收齐 **22/25**，其中 **4 项全流程通过**，另有 **3 项 Windows JetBrains 进行中**。候选合格不等于全流程通过，新版尚未发布或补测，不能声称全部合格。

## 版本与发布顺序

| 组件                  | 当前公开  | 下一版候选 |
| --------------------- | --------- | ---------- |
| CLI                   | 0.166.104 | 0.166.105  |
| Open VSX              | 0.37.149  | 0.37.150   |
| JetBrains Marketplace | 0.4.166   | 0.4.167    |

两个候选插件推荐 CLI 0.166.105。Agent SDK 0.2.15、Session Core 0.3.19、Context/Memory Kernel 0.1.10、PDH 0.4.65 保持独立版本。

最终发行提交需要 CLI CI、CLI Strict Sandbox 全系统矩阵及 IDE/ARM64 门禁通过；npm 使用 GitHub Actions OIDC。CLI 公开可获取后才发布插件。JetBrains 必须已批准、已列出、未隐藏且可公开下载，上传成功不等于审核通过。Microsoft Marketplace 仍为独立发行渠道。

## 核心特性

- 通用编码任务指导与纯静态相对导入反馈，不执行候选代码、不注入特定任务答案。
- 延迟写入未完成时不误报完成，区分 provider 网络中止与用户取消。
- JSON 终态增加有界安全错误类型和原因代码，不额外重试或重放请求；新增详情不复制 URL、headers、body 或 stack。
- JetBrains 历史与实时回答共用 Markdown 渲染，保留原文、会话和行标识。

## 系统架构

IDE 通过同一 CLI 完成模型与文件工具调用；CLI 在文件写入结果中反馈明确的相对导入错误。JetBrains 将保存的原始回答交给实时回答使用的渲染器。文件验收与 IDE 重启验证分别保留结果。

## 配置参考

需要 Node.js 22.12.0+ 和 npm 10.0.0+。插件推荐 CLI 0.166.105；升级后通过 Doctor 核对实际 CLI 路径。`CC_EDIT_DIAGNOSTICS=0` 可关闭编辑后诊断；诊断不执行测试，也不替代验收。

## 使用示例

目前公开安装命令：

```bash
npm i -g chainlesschain@0.166.104 --registry https://registry.npmjs.org
```

仅在 0.166.105 公开包回读成功后使用：

```bash
npm i -g chainlesschain@0.166.105 --registry https://registry.npmjs.org
cc --version
cc doctor
```

插件公开后升级并重启 IDE，确认 Doctor 指向同一 CLI。对未合格项使用新公开包补测；保留已合格候选的原始证据，不因诊断重复生成。原失败记录不改写。候选验收、宿主恢复和全流程结果分别报告，本候选准备不代表补测通过。

## 性能指标

新版尚无任务成功率、端到端延迟或费用改善结论。上方 25/45 是不同版本与多次尝试的累计交付覆盖，不是新版单轮成功率。费用未评估、未推算。

## 测试覆盖

本地相关回归 226 项通过；Astra 复核后针对等价工具完成同一写入的误判修复，另有 14 项聚焦检查通过，部分与前述用例重叠。最终发布提交仍需完整远端门禁；这些本地检查不代表公开新版的原生任务补测通过。

## 安全考虑

导入反馈只解析已写入内容和工作区内文件元数据，不执行候选代码；受管与文件工具受限会话不启动语言服务器。新增传输详情仅投影允许的类型及原因代码，不额外复制请求内容或重放模型调用。保存的 Markdown 原文和行标识仍予保留。

## 故障排查

导入错误请按目标文件的位置核对相对路径；写入成功不表示测试通过。IDE 仍显示旧版本时，检查 Doctor 指向的 CLI 路径并重启。若命中了系统 C 编译器 `cc`，使用 `chainlesschain --version` 核对身份并在 IDE 中设置正确路径。网络错误保留终态和原因代码，确认请求结果后再决定是否重试。

## 关键文件

CLI 的 `coding-task-guidance.js`、`file-import-diagnostics.js` 和 `transport-error-details.js` 分别提供任务指导、导入反馈和安全诊断；`agent-core.js` 管理工具及完成状态。JetBrains 的 `ChatTranscriptRendering.java` 统一实时与历史渲染。版本配对记录在两个插件的发布元数据中。

## 相关文档

参见 [CLI 使用指南](./cli.md)、[IDE 桥接](./ide-bridge.md)、[上一版升级记录](./cli-ide-update-2026-10-17.md)和[发布 PR #461](https://github.com/chainlesschain/chainlesschain/pull/461)。
