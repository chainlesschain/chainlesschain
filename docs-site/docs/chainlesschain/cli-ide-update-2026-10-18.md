# CLI / IDE 当前公开版本与下一候选升级指南

## 当前公开版本

2026-10-19 已核验公开版本：CLI **0.166.106**、Open VSX **0.37.151**、JetBrains **0.4.168**；两个插件推荐 CLI `.106`。Microsoft Marketplace 未发布。

```bash
npm i -g chainlesschain@0.166.106 --registry https://registry.npmjs.org
cc --version
cc doctor
```

三个公开版本绑定发行提交 `dca47fd91a209642b6536afd5bc9e99ec74c7d06`。该提交配置的 CLI CI、CLI Strict Sandbox、IDE 与 ARM64 门均通过，[npm OIDC 发布运行](https://github.com/chainlesschain/chainlesschain/actions/runs/39130542725)成功，公开制品已回读。Agent SDK `0.2.15`、Session Core `0.3.19`、Context/Memory Kernel `0.1.10`、PDH `0.4.65` 保持独立版本。

升级后重启 IDE，通过 Doctor 核对实际 CLI 路径。如果系统 `cc` 是 C 编译器，使用 `chainlesschain --version` 核对身份，并在 IDE 中配置正确路径。需要 Node.js 22.12.0+、npm 10.0.0+。

## 已完成补测

`.106/.151/.168` 本轮剩余 14 项的生成与独立验收记录各 **14/14**，新增候选合格与全流程通过各 **1** 项：`first-run-win32-jetbrains`。该样本基线 **31/31**、候选 **4/4**；变异实现 **1 通过 / 3 失败**，独立验收正确拒绝变异。

跨版本累计合格交付 **32/45**：普通任务 **26/36**、首次使用 **6/9**，剩余 **13** 项。累计覆盖包含不同版本和尝试，不是同一版本的单轮成功率，也不证明全部历史原生流程均通过。已合格的 32 项文件与收据保留，不再重复生成。

本轮完整证据、摘要与轮次链见[补测记录](https://github.com/chainlesschain/chainlesschain/tree/feature/task-quality-107-fixes-20261018/docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18)。原失败记录继续保留；下一轮只测 13 项未合格样本。

失败涉及源码上下文恢复、持久会话压缩一致性、候选断言与行为覆盖，以及安装、网络或启动失败。Linux broker 的出站连接失败发生在 HTTP 提交前；修改 CLI 传输代码不能证明该网络路径已修复。Windows 已定位到首次模块发现耗时并准备针对性优化，原间歇性 ACL 超时仍需公开包补测确认。输出截断和 provider 超时也须保留原始状态。

## 下一版本修复与发布顺序

源码候选 CLI **0.166.107**、VS Code **0.37.152**、JetBrains **0.4.169** 尚未发布。候选修复包括：

- 在完整工具轮次完成后持久化 assistant/tool 交换，再按已验证的历史进行压缩；保留来源、摘要和并发更新检查。
- 根据成功模型请求中实际可见的正文判断上下文是否丢失，允许有限补读；不扩大工具表面、请求数量或输出预算。
- 摘要提取成功工具配对中的真实路径、写入摘要与执行结果，保留否定约束，不将工具 JSON、源码示例或计划误写为已通过测试。
- 文件写入反馈分别标明持久化、静态导入检查及测试执行情况。写入成功不代表测试或任务验收通过。
- PDH 将 `mailparser` 固定为已核验可下载的 `3.9.45`。
- 单路径和批量 Windows ACL helper 将模块搜索限制到该 PowerShell 进程自带的模块目录。同机诊断中，限制模式的三段操作约为 3.9/0.6/0.8 秒，原配置约为 29/23/23 秒，权限、目录身份和文件内容检查均通过；原间歇性 60 秒超时仍待公开包补测，安全检查、期限和重试策略保持原样。

发布前必须完成最终提交的全部配置矩阵，CLI 同时要求 Linux、Windows、macOS 的 **CLI CI** 与 **CLI Strict Sandbox**，并完成相关 IDE、ARM64 门。旧提交、本地或部分矩阵结果不能代替最终提交的正式门。

严格按以下顺序执行：

1. GitHub Actions OIDC 发布 **Session Core 0.3.20**，核验公开 metadata、包下载和源码字节。
2. OIDC 发布 **PDH 0.4.66**，核验公开包及依赖。
3. 确认 CLI 精确依赖上述公开子包，再 OIDC 发布 **CLI 0.166.107**，完成公开制品回读。
4. CLI 已公开可用后，发布 **Open VSX 0.37.152 / JetBrains 0.4.169**；核验公开下载和 CLI 推荐版本。
5. 完整配对确认后，仅对剩余 **13** 项启动新版补测。

候选新增 `tool_round` 会话事件。早于 `.107` 的 CLI 读取器会忽略该事件，恢复新会话时可能遗漏工具上下文；需要保留会话文件，并使用兼容版本恢复。此限制不改变 IDE 的协议兼容下限。

## 验证边界

本地回归和离线失败回放用于验证具体修复；它们不计为冻结任务通过。原评测预算、thinking 配置、六个文件工具、20 turns、24 requests、每请求 180 秒和 8192 输出 token 上限保持原样，独立验收条件不降低。当前候选没有新版公开包任务成绩，延迟和费用改善未评估。

`CC_EDIT_DIAGNOSTICS=0` 可关闭编辑后诊断。静态反馈只检查明确的 JavaScript 相对引用，不执行候选代码、不启动受限会话中的语言服务器，也不代替测试或验收。网络错误应保留终态和安全原因代码，再根据请求是否已结算决定后续操作。

## 相关文档

参见 [CLI 使用指南](./cli.md)、[IDE 桥接](./ide-bridge.md)、[上一版升级记录](./cli-ide-update-2026-10-17.md)及[本次修复 PR #466](https://github.com/chainlesschain/chainlesschain/pull/466)。
