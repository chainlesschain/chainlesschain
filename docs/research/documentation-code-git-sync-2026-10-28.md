# 代码、Git 与公共文档对齐记录（2026-10-28）

## 核对基线

主线基线为 `d9f2511b953ca08a7b5013c177250474b3d6fb4e`。当前公开配对仍为 CLI **0.166.128**、Open VSX **0.37.166**、JetBrains **0.4.183** 与移动/PC **v5.0.3.143**；本轮只更新文档和网站，不重新发布 npm、IDE 或客户端制品。

公开源分别固定为 CLI `dfa158e361`、IDE `6551a06c2f`、产品 `036d2b8be2`，见[发行回执](./cli/evidence/release128-public/publication.json)。主线发行后的复测驱动保持独立，不计作已发布制品新增功能。[代码核对明细](./cli/evidence/documentation-sync-2026-10-28/code-review.json)保留具体提交和文件。

## 代码与提交对应

| 能力                    | Git 提交                                                                                                       | 已核实范围                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Goal 证据与检查点       | [67c085115b](https://github.com/chainlesschain/chainlesschain/commit/67c085115b662988242311ccfdf2d723b66a9242) | 当前轮成功工具证据、潜在变更 revision、有效证据 ID 和检查点恢复错误 |
| 可选交付复查            | [5def22e364](https://github.com/chainlesschain/chainlesschain/commit/5def22e364e6c89704ea2436b2fd198263ebf5a2) | 显式 --review-changes，默认关闭，共用原权限与剩余预算               |
| IDE 会话模型与共享推荐  | [1a16b8d257](https://github.com/chainlesschain/chainlesschain/commit/1a16b8d257875fd596f2efae6a897cd8fec01735) | /model 当前会话覆盖、恢复默认、配置读取三态和静态目录边界           |
| MCP 多语言检索          | [9f7e71f194](https://github.com/chainlesschain/chainlesschain/commit/9f7e71f1943071d42736a926773b17332628a4ec) | 名称表示、描述匹配、查询覆盖和稳定排序                              |
| MCP 可选紧凑目录        | [b9968d5060](https://github.com/chainlesschain/chainlesschain/commit/b9968d50609540e6d04612a30482aed72bc0a43a) | 默认 stubs，compact 投影、已发现 schema 与 servers: 分页目录        |
| Skills 描述符检索       | [6b76d4fd54](https://github.com/chainlesschain/chainlesschain/commit/6b76d4fd5486f44c8cc662512edbb8db45b64266) | NFKC、中文分词、停用词、标识符拆分；执行与通用 RAG 边界不变         |
| Memory posting 候选选择 | [f70278cece](https://github.com/chainlesschain/chainlesschain/commit/f70278cece1137a2456f250c848e9fea1447f516) | 选择性候选与惰性并集，保留完整过滤与磁盘验证                        |
| 已审查探针内容绑定      | [dfa158e361](https://github.com/chainlesschain/chainlesschain/commit/dfa158e36171e347a40e23356c2ed7bd04e0c061) | 维护已复核源码摘要，不将 MODEL_REQUEST 改作免费健康检查             |

## 发行后的评测准备

提交 [d9f2511b95](https://github.com/chainlesschain/chainlesschain/commit/d9f2511b953ca08a7b5013c177250474b3d6fb4e) 为 CLI / VS Code / JetBrains 的复测适配器增加显式 `--review-changes` 转发与观察标记，工作流参数默认关闭。此提交发生在正式发行之后，不进入既有 npm、VSIX、JetBrains ZIP 或客户端冻结源。

当前计划为 [next-package-128-review-20261028-plan.json](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028-plan.json)，状态 **PREPARED_NOT_DISPATCHED**，`billingAssessed: false`。观察到复查提示不等于完成复查、任务合格或账单核验；未新增独立验收。

## 文档更新范围

- 设计权威源：模块 78、98、106、108，明确当前实现、旧计划、跨端 authority 与发布身份。IDE 初版范围表移除工作量列，不增加负责人或人天。
- 用户与命令参考：CLI 总览、系统概述、Runtime、Agent、Goal、IDE、模型配置、MCP、Tool Search、Skills、Memory、自进化与恢复，以及 managed-agents 英文参考。
- 站点入口：两个 VitePress 首页的当前版本、卡片、导航阅读入口，以及官网的代码核对基线和命令参考链接。
- README：根中英文与 CLI README 增加当前参考入口，历史发行段落保留。
- 当前升级/设计页：补齐常用命令和模块入口，纠正旧版本被称为当前版本的段落与错误发布证据链接。

## 验证边界

文档按源码、Git 和既有公开发行证据核对，不运行新的真实模型任务。模型推荐目录声明运行环境和账户均未验证；配置读取与实际推理测试分开。紧凑 MCP 目录默认关闭，交付复查默认关闭，所有执行继续受原权限与预算约束。

真实任务累计仍为 **32/45**，另有 **13** 项未完成；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。Microsoft Marketplace 仍未发布。工程构建与制品核验不作为新增任务质量或账单验收。

## 构建与部署

文档结构校验、准确文档提交的云端构建门禁、三站完整构建和公网回读将在完成后记录。三站从同一干净提交构建，沿用现有部署脚本、HTML 数量门槛、归档摘要校验和旧站点回滚目录。
