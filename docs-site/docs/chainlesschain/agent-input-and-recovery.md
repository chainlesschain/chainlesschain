# Agent 输入、图片预算与会话恢复

## 概述

当前公开 CLI 为 **0.166.121**，修复普通状态与工具显示文本的 Evolution ingress 误判。它保留此前 **0.166.117** 对代码投影、图片与文本预算、长工具输出及异常退出前工具结算的修复。历史 Open VSX **0.37.159** / JetBrains **0.4.176** 配对推荐 CLI **0.166.117**；新的 IDE 发布状态见下文。

## CLI 0.166.121 已公开发布（2026-10-26）

修复数字状态 `[0 26]`、进度 `[1/3]`、日期 `[2026-10-25]` 和时间 `[12:30:00]` 触发 `Agent model JSON text is malformed or ambiguous` 的误判。这些完整且有界的普通文本标记继续接受敏感信息清洗；真正损坏的 JSON、重复键及超预算输入仍会拒绝。历史投影规则保持可验证。

同类修复覆盖百分比、ISO 时间戳、Git 哈希及范围、版本链接、简单 wiki 链接、数字正则范围、有限的无引号 Shell 判断和非敏感的独立引号说明。ANSI 终端控制码不再触发 JSON 解析错误，现有注入隔离规则继续执行；敏感键下无法安全投影的表达式仍会拒绝。

同时修复敏感赋值的词法边界：例如 `"password": trueSecretValue` 或拼接字符串，不再只脱敏第一个 token 而留下后缀，而是拒绝无法安全投影的表达式。

CLI 0.166.121 已通过同一提交的三平台 CLI CI 和 CLI Strict Sandbox，并经 [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/40225573887) 发布，公共 npm 包完整性、provenance、修复源码及子依赖已验证。[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release121-public/publication.json)。运行 `npm i -g chainlesschain@0.166.121 --registry https://registry.npmjs.org`，重启 IDE 聊天宿主，用 `cc --version` 和 `cc doctor` 确认实际路径。

另在独立目录从公共 npm 使用 `--ignore-scripts` 安装，验证了 CLI 包和十个直接子依赖的地址、完整性与版本，以及 `cc --version` 和静态 `cc agent --capabilities` 清单。这不是模型任务或原生产品验收。

新配对 Open VSX **0.37.161** 已公开，独立下载的 VSIX 与不可变 CI 构建的原始 SHA-256 及完整 ZIP 内容摘要均一致，包内推荐 CLI **0.166.121**。JetBrains **0.4.178** 已通过审核、公开上市并完成 ZIP 下载验证，包内版本和 CLI 推荐版本正确；全部候选 JAR 内部条目与公开包一致且无新增条目，原始 ZIP 字节不同。上一版配对是 **0.37.160** / **0.4.177**。本次未新增真实模型任务验收，累计仍为 **32/45**、**13** 项未完成，**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留；Microsoft Marketplace 仍未发布。

## 核心特性

- Python/JavaScript 工具代码按相应字段处理，真正的 JSON 校验与预算限制继续执行。
- 图片原始字节、文本字节和视觉 token 预留分别计算。
- 长工具结果保留完整 JSON 或明确的省略说明。
- 异常退出前保存和结算已完成的工具轮次；真实并发冲突仍需刷新会话。
- 持久会话支持较大图片消息包的私有存储与完整性校验。

## 系统架构

输入先经过字段、大小和图片准入检查，再进入受治理的证据投影与模型请求。较大的持久图片载体可保存为消息包引用。模型返回实际 usage 后，运行时结算实际 token；图片 base64 的字符长度不再作为普通文本 token 估算。

## 配置参考

使用 Node.js **22.12.0 或更新版本**，安装已公开版本：

```bash
npm i -g chainlesschain@0.166.117 --registry https://registry.npmjs.org
cc --version
cc doctor
```

更新 IDE 插件后重启聊天宿主，运行 **Diagnose Bridge / Doctor** 核对实际 CLI 路径和版本。Windows 中若系统 `cc` 是 C 编译器，应在 IDE 设置中配置正确的 CLI 可执行文件。

这次修复不需要关闭 Evolution，也不需要手工修改账本或 JSONL。模型仍须支持当前图片类型及视觉输入。

## 性能指标

以下是资源边界；真实延迟与服务商计费取决于模型、图片内容和实际 usage。

| 项目                          | 当前限制                     |
| ----------------------------- | ---------------------------- |
| CLI 单条输入图片数            | 最多 8 张                    |
| IDE 单条输入图片数            | 最多 4 张                    |
| 单条消息图片原始字节合计      | 20 MiB                       |
| 一次模型请求图片原始字节合计  | 40 MiB                       |
| Agent 文本快照 / 模型可见投影 | 1 MiB / 896 KiB              |
| 文本自动压缩压力点            | 768 KiB                      |
| 单次工具结果预览              | 最多 50,000 字符，包含元数据 |
| 单条 JSONL 事件               | 16 MiB                       |

普通图片按每张 8192 token、`detail=low` 按 1024 token 做规划预留。实际消耗按服务商 usage 回执结算。模型上下文、服务商上传限制和 JSONL 单事件限制会独立生效，图片字节预算不是无限上传许可。

`CC_MAX_TOOL_RESULT_CHARS` 可进一步收紧工具预览，最多仍为 50,000 字符。

## 测试覆盖

发行提交通过完整的 Linux、Windows、macOS CLI CI 与 Strict Sandbox 门禁；两个 IDE 也通过配置中的真实宿主矩阵和发布前检查。CLI 的公共安装、依赖和签名来源已核验，两个 IDE 的公开压缩包已下载并核对版本及 CLI 推荐值。

本次未新增真实模型长任务验收。历史跨版本交付统计为 **31/45**，不能作为 `.117` 的单轮成功率。完整回执见[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release117-public/publication.json)。

## 安全考虑

备份持久会话时，应同时复制会话 JSONL 和会话根下的私有 `.context-message-bundles-v1` 目录，并保留访问权限。较大的图片可能只在 JSONL 中留下引用，单独复制 JSONL 不足以恢复这些图片。

保留真实 JSON 校验、来源认证及会话版本检查。停止或报错不等于外部命令的副作用已回滚；继续之前应核对文件、任务和远端操作的实际结果。

## 故障排查

| 现象                                                                                                  | 处理步骤                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Agent evolution ingress failed: Agent model JSON text is malformed, ambiguous or exceeds its budget` | 先升级并重启宿主；确认实际 CLI 为 `.117`。仍出现时缩小输入或工具输出，检查实际 JSON 与图片限制，保存脱敏诊断。 |
| `Cannot settle completed tool rounds; refresh the session before continuing`                          | 停止其他写入同一会话的窗口，刷新并重新读取会话；核对已完成工具的实际结果，再恢复。真实过期 CAS 不会自动越过。  |
| 图片过大或达到服务商限制                                                                              | 缩小图片、减少同一消息的图片数，按独立问题分批发送。                                                           |
| 工具预览显示省略                                                                                      | 按字段、关键词或行游标读取所需部分；省略说明不证明完整输出内容。                                               |
| 恢复时图片消息包缺失或摘要不匹配                                                                      | 检查备份是否包含消息包目录和正确权限；保留原始记录并运行会话校验。不要编辑摘要来强行恢复。                     |

## 关键文件

- `packages/cli/src/lib/evolution/agent-model-projection.js`：文本与图片预算。
- `packages/cli/src/lib/tool-result-preview.js`：完整 JSON 预览。
- `packages/cli/src/lib/context-memory-kernel/message-bundle-store.js`：持久图片载体。
- `packages/cli/src/runtime/headless-stream.js`：异常退出和工具轮次结算。

## 使用示例

```bash
cc agent --session project-fix
cc context project-fix
cc session validate project-fix
cc session verify project-fix
cc agent --session project-fix
```

`validate` 检查 JSONL 结构，`verify` 检查会话哈希链；通过这两项不等于图片消息包已完整恢复。图片消息包的字节数和摘要由 `context` 或会话恢复的实际读取路径校验。

先核对会话 ID 和工作目录，再恢复已有任务。涉及未知副作用时，先检查执行结果；需要独立上下文时创建新会话。

## 相关文档

- [CLI / IDE .117 升级指南](./cli-ide-update-2026-10-23)
- [会话管理](./cli-session)
- [上下文窗口](./cli-context)
- [受治理的 Skill 自进化](./governed-skill-evolution)
- [运行时设计与发行边界](https://design.chainlesschain.com/release-runtime-update-2026-10-23.html)
