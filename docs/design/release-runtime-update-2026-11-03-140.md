# CLI .140：工具参数恢复、可信摘要与发行状态

## 代码与发行基线

本次核对 **2026-11-03** 的 `main@d62866538c`、Git 修复记录和公开发行回执。站点部署提交另行记录，不能替换 npm 包的不可变发行源码。

| 组件                          | 版本                     | 来源与核验范围                                                                                      |
| ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| CLI                           | 0.166.140                | `e2a91bf54332ff3d252c40ecc25c5887e0f0430d`；Actions OIDC、公开字节、来源签名及安装启动已核验        |
| Open VSX                      | 0.37.176                 | 与 CLI 同一发行源；公开 VSIX 与正式构建逐字节一致，推荐 CLI .140                                    |
| JetBrains 候选                | 0.4.193                  | 同一发行源；正式宿主门禁和上传成功，商店公开可用性未核验，推荐 CLI .140                             |
| JetBrains 公开版              | 0.4.192                  | 已批准公开；商店包内两个 JAR 与正式构建一致，推荐标记仍为 CLI .139                                  |
| Agent SDK / Protocol / Kernel | 0.2.17 / 0.1.12 / 0.1.11 | 复用已发布子包；上游归档与 CLI 依赖对齐已核验                                                       |
| PC / Android / iOS            | v5.0.3.144               | 独立发行源 `7be0ebbcd9c9e1b52151f32e7229f6868ce320c7`；五平台构建、六项必需检查及 22 个资产校验通过 |

CLI 准确发行源码的三平台 **CLI CI 76/76**、**CLI Strict Sandbox 6/6** 通过。历史失败和完整作业重试保留，不用新文档提交替代旧标签来源。详见[发行回读](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release140-public/publication-readback.json)、[准确源码门禁](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release140-public/gates.json)与[客户端发行](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release144-public/publication.json)。

## 损坏工具参数的拒绝与续接

`0a38352b25`、`c9b7ae0c43` 引入工具参数恢复。`parseToolArguments` 只接受可解析的普通对象；非法 JSON、null、数组及其他值在工具执行前拒绝，返回 `CC_TOOL_ARGUMENTS_INVALID` 并标记 `execution_started:false`。不会从截断参数猜测命令，也不会把解析失败当成可执行空对象。

`projectRejectedToolArguments` 仅为下一次模型请求派生历史副本：工具调用 ID 和结果 ID 必须分别唯一、结果明确证明未执行，并满足相邻工具结果配对条件。旧 `run_code` 的 `CC_RUN_CODE_EXECUTION_SNAPSHOT_INVALID` 拒绝也可续接。派生副本使用占位参数与错误说明；原持久会话不变，被拒绝工具不会重放。模型须在现有权限、审批及预算内重新提交完整参数。

已执行、无法证明未执行、配对不唯一的记录不适用恢复特例；重复键、嵌套 JSON、脱敏和解析预算仍由原有检查执行。两款 IDE 通过 CLI 获得恢复能力，通信协议版本不变。

## 投影 v10 与可信传输摘要

`e2a91bf543` 修复图片和推理传输块的 SHA-256 字符串被手机号检查误判。只有经过认证的协议元数据使用专用扫描视图；原始摘要、字节长度和恢复绑定不变。用户文本中的摘要样字符串、伪造标记、真实手机号继续接受检查，v1–v9 历史投影规则及读取校验保留。

完整相关 projector / agent-model 回归 **393/393** 通过。Windows 工具恢复聚焦检查 **129 项**通过；较早 v9 的 **5 请求 / 6,401 tokens** 与 v10 发行源码的 **5 请求 / 6,501 tokens** 是独立限定实测。新调用路径在一次真实模型响应中注入日志中的损坏参数，验证拒绝、续接、未知文件读取及未重放；不将注入场景写成所有模型任务的自然成功率。

## 发行后的主线修复

`284bb5f24c` 改善上下文压缩后的读取恢复提示，避免要求模型恢复已经无法提供的源码范围；`3480ca4ce0` 修正 Web Panel 入口对随包 bundle 的引用。这些提交晚于 CLI .140 的发行源，不能由当前源码存在推断已进入不可变 npm .140 包。

`54d0064cab` 修复火山诊断转发器覆盖内部显式输出限制的问题：内部摘要的 `2048` 保留，任务请求仍可使用模型认证最大输出 `393216`。该变更属于复测适配器，原轮与修复轮分别保留；不能据此解释全部模型差异或改变历史失败。

## 模型验收范围

- OpenAI 原冻结项目历史累计 **41/45**，.138 四项复验 **2/4**、.137 **0/5** 和图像专项 **0/1** 分别保留。Sol **45/45** 是跨版本、含修复任务源码的累计覆盖，不是同源码同版本的一次全量成绩。
- 火山 / DeepSeek .139 完整新轮 **15/45**；后续 12 项复测 **2/12**，该批内部累计 **17/45**。火山全部历史自动交付累计 **34/45**，不同口径不能合并。
- .140 全量 **36+9** 已有调度身份，完整最终成绩尚未归档核验；内部输出限制修复后的完整复测单列，未调度或离线通过不计为完成。
- 发行源三平台各 100 次回环共 **300 次**只验证结构封套；工程测试、发行和站点部署均不增加模型任务验收数。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

[.140 完整复测](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-volcengine-140-full-20261103/README.md) · [内部输出限制修复](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/README.md) · [任务清单及不同累计口径](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-36-plus-9-task-list.md)。

## 用户升级与分发边界

使用 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.140 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启 CLI、`cc ui` 与 IDE 聊天宿主，再从原会话继续；现有进程可能仍使用旧模块。Open VSX .176 可公开安装；JetBrains .193 使用正式 Actions 构件时需明确其公开状态尚未核验，商店用户可等待新版，当前公开 .192 的推荐标记仍为 CLI .139。

客户端从独立 [v5.0.3.144 Release](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.144) 下载。Windows/macOS 未签名，macOS 未公证；iOS 为仅限已登记设备的 Ad Hoc IPA，Android 提供签名 APK/AAB。没有 App Store、Google Play 或 Microsoft Marketplace 新上架声明。

## 关键文件与文档部署

- `packages/cli/src/runtime/tool-argument-recovery.js`：严格解析、唯一配对和模型历史副本。
- `packages/cli/src/runtime/agent-core.js`：工具执行前拒绝及后续回合。
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js`：可信传输摘要投影。
- `packages/cli/src/lib/read-file-loop-guard.js`：发行后主线读取恢复提示。
- `docs/design/` 是设计文档源；两个 VitePress 站点通过原有同步脚本生成副本。

三站使用 `scripts/deploy-docs-snapshot.ps1` / `.sh` 部署干净提交的构建，先核验归档摘要及页面，再在服务器锁下暂存三站、保留旧文件与备份、切换并检查 HTTPS；失败按原流程回滚。公网检查还需核对 `deployment-source.json` 与关键页面，部署回执单独记录。

[用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-03-140.html) · [CLI Runtime 当前架构](./cli-runtime-current.md) · [上一版设计](./release-runtime-update-2026-11-02-138.md)。
