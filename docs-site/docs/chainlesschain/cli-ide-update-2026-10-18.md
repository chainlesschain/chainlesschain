# CLI / IDE 当前公开版本与下一候选升级指南

## 概述

截至 2026-10-19，已核验的公开版本为 CLI **0.166.106**、Open VSX **0.37.151** 和 JetBrains **0.4.168**，两个插件推荐 CLI `.106`。Microsoft Marketplace 尚未发布。三个公开版本对应源码提交 `dca47fd91a209642b6536afd5bc9e99ec74c7d06`；该提交的 CLI CI、CLI Strict Sandbox、IDE 和 ARM64 门禁通过，npm OIDC 发布及公开制品回读完成。

当前源码候选为 CLI **0.166.107**、Open VSX **0.37.152** 和 JetBrains **0.4.169**。该候选依赖 Session Core **0.3.20** 和 Personal Data Hub **0.4.66**。所有新版本仍须通过最终提交的完整门禁和公开回读后才能配对使用。

## 核心特性

- 将完整的 assistant/tool 轮次追加到已验证会话历史，并在压缩和完成轮次时保留历史依据。
- 当成功的模型请求已不包含早先读取的内容时，按原有限额读取需要的源码范围。
- 从成功配对的工具观察中提取路径、写入摘要和执行结果，保留否定约束；不把示例代码误报成测试结果。
- 将文件持久化、静态导入检查和测试执行分别反馈，避免把写入成功说成任务验收通过。
- 将单次及批量 Windows ACL helper 的 PowerShell 模块搜索限制在进程自带模块目录，保留原有权限核验、超时和重试边界。

## 系统架构

CLI 在工具调用结束后验证持久会话的前缀和并发版本，再将完整 assistant/tool 轮次写入追加式历史。规范化压缩从已验证历史构造消息，并在发送模型请求时重新加入仅供当前运行使用的临时消息。IDE 提供的临时上下文不改变持久化用户输入。

新版本增加 `tool_round` 会话事件。早于 `.107` 的读取器会忽略该事件，使用旧版 CLI 恢复由 `.107` 写入的会话时可能缺少工具上下文；恢复此类会话应使用兼容版本。

## 配置参考

CLI 要求 Node.js **22.12.0 或更高版本**及 npm **10.0.0 或更高版本**。安装后运行 `cc doctor` 核实 CLI 路径；若系统中的 `cc` 指向 C 编译器，可用 `chainlesschain --version` 核对 CLI 身份。`CC_EDIT_DIAGNOSTICS=0` 可关闭编辑后的静态诊断。

候选 CLI 固定依赖 Session Core `0.3.20` 和 PDH `0.4.66`；PDH 使用已核验的 `mailparser 3.9.45`。VS Code `.152` 和 JetBrains `.169` 的推荐 CLI 是 `.107`，只有在 CLI 已公开并完成回读后才安装这组新配对。

## 性能指标

同一 Windows 2025 runner 的 ACL 配对诊断中，继承完整模块搜索路径的首次 helper 用时约 **21–32 秒**；限制到 PowerShell 自带模块目录后约 **0.4–3.9 秒**。权限检查、目录见证和文件内容检查均通过。该诊断未复现原有的间歇性 60 秒超时，最终仍需公开包补测确认。

## 测试覆盖

`.106/.151/.168` 最近一轮的 14 项补测均返回生成记录和独立验收记录。新增 1 项候选及全流程通过：`first-run-win32-jetbrains`。该轮基线为 31/31，候选为 4/4，变异样本为 1 项通过、3 项失败。

跨版本累计接受交付为 **32/45**：普通任务 **26/36**，首次使用任务 **6/9**，还剩 **13** 项。累计结果来自不同版本和多次尝试，不代表单一版本或单轮的成功率。已接受的 32 份原始产物和收据继续保留；后续仅补测未完成项。

本页所述 `.107/.152/.169` 仍是源码候选，候选的最终提交门禁和公开发行回读完成前，没有新版本任务补测结果。既有 Linux broker 出站连接失败发生在 HTTP 请求之前；CLI 传输改动不能证明该网络路径已修复。

## 安全考虑

会话历史通过已验证前缀、来源证明、租约和并发写入检查后追加。临时重试或后台提示不会伪装成用户输入；显式反馈仍作为用户输入保存。源码恢复不增加工具类型、请求额度或输出预算。

静态导入诊断只检查明确的相对 JavaScript 引用，不执行候选代码，也不替代测试。ACL 优化保留原权限检查和失败关闭行为；诊断用时不能替代公开包验收。

## 故障排查

写入成功只说明文件已保存，不说明静态检查、测试或任务验收通过。若提示相对导入错误，先检查目标文件相对于工作区的位置。IDE 仍使用旧 CLI 时运行 `cc doctor` 核对实际路径，再重启 IDE。

遇到网络失败时，保留原始终态和原因代码，并根据请求是否已结算判断后续操作。不要仅因 CLI 传输代码已变更，就认定 Linux broker 或 provider 网络问题已解决。Windows ACL 的间歇性超时仍以公开包补测为准。

## 关键文件

- `packages/cli/src/runtime/headless-stream.js` 和 `headless-runner.js`：流式与单次提示的轮次结算。
- `packages/cli/src/lib/session-tool-round.js`：规范化工具轮次投影。
- `packages/session-core/lib/private-storage.js`：Windows 安全目录 helper。
- `packages/cli/src/data/changelog.json`：CLI 离线 changelog 数据，由 `packages/cli/scripts/build-changelog.mjs` 从根 `CHANGELOG.md` 生成。

## 使用示例

当前公开 CLI 的安装和基本检查：

```bash
npm i -g chainlesschain@0.166.106 --registry https://registry.npmjs.org
cc --version
cc doctor
```

安装当前公开配对时，使用 CLI `.106`、Open VSX `.151` 和 JetBrains `.168`。升级到 `.107/.152/.169` 前，先核验新 CLI 的公开版本、依赖和制品，再安装对应 IDE 插件。

## 发布顺序

新版依赖包必须先发布并核验：先发布 Session Core `0.3.20`，再发布 PDH `0.4.66`；确认两个 npm 包可公开下载且 CLI 锁定依赖版本一致后，发布 CLI `0.166.107` 并完成公开回读；CLI 公开可用后再发布 Open VSX `0.37.152` 和 JetBrains `0.4.169`。三个组件全部完成公开回读后，再对剩余 13 项启动补测。

npm 发布通过 GitHub Actions OIDC 完成。CLI 发布前必须验证最终提交的 Linux、Windows 和 macOS CLI CI 与 Strict Sandbox 完整矩阵；IDE 和 ARM64 门禁也必须关联同一最终提交。

## 相关文档

参见 [CLI 使用指南](./cli.md)、[IDE 桥接](./ide-bridge.md)、[上一版升级记录](./cli-ide-update-2026-10-17.md)和[当前发布 PR](https://github.com/chainlesschain/chainlesschain/pull/466)。
