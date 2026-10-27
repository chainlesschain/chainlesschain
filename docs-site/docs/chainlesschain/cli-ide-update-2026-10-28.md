# CLI .128：Goal 证据、检索与配套升级（2026-10-28）

## 概述

CLI **0.166.128**、Open VSX **0.37.166** 和 JetBrains **0.4.183** 已公开并完成归档回读；两个 IDE 均推荐 CLI `.128`。移动/PC 客户端 [**v5.0.3.143**](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.143) 已公开，五平台构建、22 个公开资产与桌面更新元数据均已核验。各阶段状态以[公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release128-public/publication.json)为准。

CLI 发行源为 `dfa158e36171e347a40e23356c2ed7bd04e0c061`；公开 npm 包与不可变 CI 制品逐字节一致，签名来源及十个直接子依赖版本已核验。配套 IDE 使用独立的固定发行提交，不把默认分支上的后续改动当作已发布代码。

## 核心特性

| 范围          | 本版行为                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Headless Goal | 自然语言判定使用本轮成功工具证据，并核对判定引用的证据 ID；缺少证据时不能只凭最终回复认定完成。 |
| 检查点        | Goal 状态持久化失败会明确暴露，避免把尚未可靠保存的状态当作可恢复完成。                         |
| IDE 模型配置  | 共享模型推荐与协议选择，区分未配置、已配置、配置读取失败；会话 `/model` 覆盖与其他会话隔离。    |
| MCP / Skills  | 改进多语言名称、别名及描述检索。                                                                |
| MCP 目录      | 可选紧凑目录，默认仍是 `stubs`；完整工具库存和执行权限继续保留。                                |
| Memory        | 优化索引候选归并，完整磁盘校验与查询边界继续执行。                                              |
| 可选交付复查  | 显式 `--review-changes` 在已有权限和剩余预算内提供一次复查机会，默认关闭。                      |

自然语言 Goal 仍包含模型判断。需要严格验收时，优先使用明确的确定性条件和实际测试；引用工具证据不代表已经对全部产物完成独立验收。

## 系统架构

CLI 运行时负责工具执行、Goal 判定和检查点持久化；IDE 通过桥接调用 CLI，并保留各会话自己的模型覆盖。自然语言判定读取当前轮次的成功工具证据，检查点写入失败则明确返回错误，避免界面完成状态与可恢复状态不一致。完整机制见[运行时设计](/design/release-runtime-update-2026-10-28)。

发行按子 npm 包、CLI、IDE、移动与 PC 客户端依次核验。客户端从冻结提交构建，整个 npm 包目录与正式 CLI 标签保持一致；默认分支的后续文档和复测工具不会自动进入客户端发行。

## 使用示例

需要 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.128 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启 IDE 聊天宿主，确认 Doctor 显示的可执行路径与实际安装位置一致。保留原有配置目录、API key、会话和部署数据。多个宿主使用不同 `CHAINLESSCHAIN_HOME` 时不会自动共享配置。

Microsoft VS Code Marketplace 仍未发布，VS Code 用户可使用 Open VSX 的版本化 VSIX。JetBrains 上传成功、审核待定与公开上架是不同状态，应以发行回执中的公开版本为准。

### 使用可选交付复查

```bash
cc agent -p "完善当前模块的回归测试并检查交付是否覆盖要求" --review-changes
```

该选项支持 headless 提示词和 stream-json 输入。成功写入或编辑文件后，运行时最多安排一次复查机会；复查中的读取、修复和模型请求继续消耗原有轮次、权限及费用预算。预算耗尽、用量不完整、来源拒绝或取消时，不因此增加权限或绕过终止条件。

启用后仅发布最终文本，部分文本和 thinking delta 不会作为临时最终答复流出。复查提示不是测试成功、独立验收或财务准入证明；它也不会自动开启自进化或晋升 Skill。

## 配置参考

以下仅是应合入既有配置的片段：

```json
{
  "mcp": {
    "toolSearch": {
      "catalogMode": "compact"
    }
  }
}
```

默认值仍为 `stubs`。紧凑目录改变模型可见目录的表示方式，按需发现 schema；执行前仍须经过原有工具权限、审批和沙箱检查。恢复默认时将值改回 `stubs`。

## 故障排查

| 现象                              | 处理                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| IDE 提示无法读取配置              | 先检查 CLI 路径和 Doctor 结果，再重试读取；读取失败不能直接当作未配置并覆盖已有设置。 |
| 切换模型后其他会话行为不同        | `/model` 是会话覆盖，核对当前会话与共享配置，不会自动改写其他会话。                   |
| Goal 没有完成                     | 检查本轮是否产生成功工具证据、确定性条件是否实际满足，以及检查点是否可靠保存。        |
| 开启复查后没有部分文本            | 这是该可选模式的最终文本输出约定；查看工具进度和最终结果。                            |
| 紧凑目录下没有直接显示全部 schema | 按需检索工具；需要原目录表示时恢复 `stubs`。                                          |

连接测试会发送模型推理请求，可能产生服务商费用。配置状态读取和实际推理连通性测试应分别处理，按需执行。

## 测试覆盖

准确 CLI 提交的 Linux、Windows、macOS `CLI CI` 与 `CLI Strict Sandbox` 均已通过。CLI CI 的 71 个必需任务成功，既定可选 dry-run 发布任务跳过；OIDC 发布和独立公开回读均成功。子包版本本轮不变，Session Core 保持 **0.3.24**。

Open VSX `.166` 的正式工作流和独立公开回读均通过，下载 VSIX 与不可变 CI 制品逐字节相同。JetBrains `.183` 的六格真实宿主、三系统浏览器、单元测试、构建和兼容性检查通过；公开批准、列出和 ZIP 下载已核验，全部原始 CI payload 条目一致。客户端 `.143` 的五平台构建全部成功，22 个公开资产与 CI manifest 的字节数和摘要匹配，三套桌面更新元数据已独立下载核验。Android 使用已公开的 `20261028-1` 内部运行时，CLI bundle 已验证公开 CLI 的来源和依赖版本；这些归档检查不代表已通过 Android 实机测试。

本轮工程发布未增加真实模型任务验收：累计仍为 **32/45**，另有 **13** 项未完成；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

## 性能指标

MCP token 数字和 Memory 局部性能基线属于合成估算，不代表真实账单、完整磁盘查询 SLO 或真实任务质量提升。紧凑目录默认关闭；本页不承诺升级后的端到端延迟或成功率。实际模型用量继续以服务商返回的 usage 结算，用量缺失时保持未知。

## 安全考虑

交付复查沿用原有工具权限、沙箱、取消信号和剩余费用预算，不额外授予权限；用量不完整时不能通过复查追加模型请求。紧凑 MCP 目录只改变发现方式，执行前仍校验完整工具库存和原有策略。自进化保持可选，复查不会自动开启或晋升 Skill。

升级时保留原有配置、凭据和会话。配置读取失败应先修复读取，不能当作未配置后覆盖；连接测试会实际调用模型，应按需执行。

## 关键文件

- `packages/cli/src/runtime/headless-runner.js`：Goal 判定与检查点恢复。
- `packages/cli/src/runtime/agent-core.js`：交付复查与运行预算。
- `packages/cli/src/runtime/mcp-tool-search.js`：工具检索与可选紧凑目录。
- `packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js`：Memory 索引归并。
- [公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release128-public/publication.json)：各渠道状态、准确源码和独立回读。

## 当前命令与模块参考

- [Agent 完成条件与可选复查](https://docs.chainlesschain.com/chainlesschain/cli-agent.html)
- [IDE 会话模型配置](https://docs.chainlesschain.com/chainlesschain/ide-plugin.html)
- [MCP Tool Search](https://docs.chainlesschain.com/chainlesschain/cli-tool-search.html)
- [Skills 检索](https://docs.chainlesschain.com/chainlesschain/cli-skill.html) · [Memory 查询](https://docs.chainlesschain.com/chainlesschain/cli-memory.html)

## 相关文档

- [自进化开关配置](./self-evolution-configuration)
- [输入与恢复边界](./agent-input-and-recovery)
- [运行时与发行设计](/design/release-runtime-update-2026-10-28)
- [上一轮升级说明（历史）](./cli-ide-update-2026-10-27)
- [本轮发布进度](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-release128-progress-2026-10-27.md)
