# CLI .107 / IDE .152 与 .169 升级指南

## 概述

2026-10-20 核对：npm CLI **0.166.107**、Session Core **0.3.20**、Open VSX **0.37.152** 与 JetBrains Marketplace **0.4.169** 已公开，两个 IDE 均推荐 CLI `.107`。Microsoft Marketplace 未发行；使用 Microsoft VS Code 时可从 Open VSX 获取对应版本的 VSIX 安装。

CLI 发行源码为 `6775d7a2de`，两个 IDE 为 `94429fada4`。原生产品 **v5.0.3.140** 独立下载；升级 CLI 或 IDE 不会升级桌面、Android 或 iOS。

## 核心特性

- CLI、共享契约与 IDE 包含目标目录、授权插件面板、离线说明请求、在线待审草稿和回执查询。
- 演化存储核对 journal、witness、manifest 和索引一致性，任务修改保留标签来源。
- Windows 私有存储提供有界 ACL 阶段诊断；历史原生任务超时仍需单独复测。
- Live diagnostics 在正式预算 scope 中立即拒绝启动，防止诊断绕过预算托管流程。

## 系统架构

IDE 使用配对 CLI 执行模型和文件工具。CLI 文件目标与桌面项目目标分别保存。桌面为选定目标生成连接，只读摘要、历史证据和在线待审草稿分别授权。保存草稿只产生待审建议，任务写入仍由桌面预览和逐次原生确认完成。

## 配置参考

需要 Node.js **22.12.0+**、npm **10.0.0+**。安装 CLI `.107` 后，分别升级 Open VSX `.152` 或 JetBrains `.169`，重启 IDE 聊天宿主，再用 Doctor 核对实际 CLI 路径。

目标草稿互通还需要匹配桌面源码构建及授权连接，不能假设产品 .140 已包含全部新增面板。连接文件包含凭据，请保存在本机私有目录。

## 使用示例

```bash
npm i -g chainlesschain@0.166.107 --registry https://registry.npmjs.org
cc --version
cc doctor
cc goal --help
```

若系统的 `cc` 是 C 编译器，用 `chainlesschain --version` 确认身份，并在 IDE 中设置正确 CLI 路径。配置好桌面连接后，可按[目标草稿指南](./goal-drafts-current)选择目标、导出请求或提交待审草稿。

在线提交中断时，保留原 `submission.json`，使用同一目标、连接和插件身份执行 `cc goal draft-receipt` 查询。不要更换 request ID 重发；`not-found` 不能证明迟到请求不会保存。

## 性能指标

目标目录和在线来源分页最多扫描 **20** 个候选，正文最多 **8192 UTF-8 字节**，离线信封最多 **16 KiB**。这些是输入和扫描边界；本轮未评估新的真实任务成功率、费用或延迟改善。

## 测试覆盖

CLI 发行提交通过三平台 CLI CI、Strict Sandbox、OIDC、公开依赖安装与签名来源验证；IDE 完整发行门通过，Open VSX VSIX 和 JetBrains 已批准上架的 ZIP 均完成公开回读。

本轮没有新的模型任务补测。历史 `.105/.150/.167` 轮生成和独立验收各 **20/20**，新增通过 **6** 项；跨版本累计候选合格交付 **31/45**，剩余 **14** 项。不能把累计覆盖当成 .107 单轮成功率。正式付费准入 **NOT_PAID_READY**、完整 native review **NOT_ADMITTED**、自动晋升 **HOLD** 保留。

## 安全考虑

只读连接不能提交草稿，待审连接不能批准或执行任务。插件标签和请求文件属于不可信输入；任务执行前重新校验来源和授权。诊断入口报预算 scope 冲突时应退出，正式评测走原有可信预算入口；不要为运行诊断而绕开预算验证。

## 故障排查

- **IDE 显示旧版**：重启聊天宿主，运行 Doctor，检查插件版本、CLI 路径和 `.107` 配对。
- **找不到目标面板**：核对桌面构建、项目所有者、目标、插件安装范围、信任和对应能力同意。
- **草稿已保存但未修改任务**：到桌面打开待审草稿，重新核对来源、预览差异并逐次确认。
- **提交结果未知**：保留原引用并查询回执，不自动重发。
- **Windows 启动超时**：保留固定 ACL 阶段和耗时诊断；新诊断能力本身不代表超时问题已解决。
- **诊断拒绝正式预算 scope**：这是预期边界；独立诊断与正式评测采用各自入口，不能混用。

## 关键文件

CLI 命令位于 `packages/cli/src/commands/goal.js`，共享契约由 Session Core 的 `project-goal-external-drafts.js` 和 `project-goal-draft-imports.js` 提供。`formal-budget-provider-scope.js` 以及两个 `verify01` live diagnostics 脚本实施预算隔离。桌面 `project-goal-ipc.js` 和项目目标面板处理原生审核。

## 相关文档

参见[目标草稿操作](./goal-drafts-current)、[发布与升级](./agent-platform-release)、[本轮设计](/design/release-runtime-update-2026-10-20)、[10 月 18 日历史记录](./cli-ide-update-2026-10-18)及[公开发行状态](https://github.com/chainlesschain/chainlesschain/blob/feature/docs-sites-20261020/docs/research/cli/evidence/documentation-release-status-2026-10-20.json)。
