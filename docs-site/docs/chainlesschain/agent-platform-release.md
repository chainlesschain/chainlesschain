# Agent Platform 0.166.9 发布与升级指南

## 概述

Agent Platform `0.166.9` 是 2026-08-29 的完整门禁生产推荐版与 npm `latest`。不可变 tag `v-npm-0-166-9` 指向精确提交 [`222396f6a8`](https://github.com/chainlesschain/chainlesschain/commit/222396f6a8429d4b862292a2572067a5cacb1003)。

当前公开组合：

| 组件                 | 公开版本  | 获取渠道              |
| -------------------- | --------- | --------------------- |
| CLI                  | `0.166.9` | npm                   |
| Agent Protocol       | `0.1.6`   | npm                   |
| TypeScript Agent SDK | `0.2.5`   | npm                   |
| Python Agent SDK     | `0.2.6`   | PyPI                  |
| VS Code IDE Bridge   | `0.37.73` | Open VSX              |
| JetBrains IDE Bridge | `0.4.103` | JetBrains Marketplace |
| Personal Data Hub    | `0.4.59`  | npm                   |

JetBrains 源码与 tag 已是 `0.4.104`，但 Marketplace 公网仍为 `0.4.103`，因此安装和支持口径继续以 `0.4.103` 为准。Python SDK `0.2.5` 没有发布，直接使用修正发布元数据的 `0.2.6`。

## 核心特性

- **耐久 Graph 审阅与恢复**：有界 event/snapshot history 支持 blocked-root、revision diff 与 time travel；definition migration 与 retirement 绑定备份、digest、replay 和 legacy writer 观察证据。
- **可恢复人工节点**：HumanTask 等待不占 Agent capacity，决定绑定 revision、attempt 与 operation，支持 quorum、职责分离和 single-winner CAS。
- **Team 公平性**：dependency/scope aging、priority donation 与 fairness SLO 防止可运行任务长期饥饿。
- **时序消息可靠性**：至少一次投递、ACK/custody、迟到/重复/重排和恢复有显式门禁。
- **真实 UI 回放**：Playwright 执行已审阅的 `observe/click/type/select/assert`，默认拒绝 filesystem、HTTP(S) 与 WebSocket。
- **Codex 兼容门**：可选 App Server adapter 只接纳明确验证的上游 patch；未知或预发布版本在 turn admission 前回退稳定 `codex exec --json`。
- **多端审批一致性**：Desktop、Web、Android、iOS、VS Code 与 JetBrains 的决定都使用同一 binding 与 single-winner settlement。
- **签名 Desktop Skill 资格**：exact-SHA 构建、签名、安装、启动和真实 Skill journey 形成独立证据链。

## 系统架构

```text
用户 / IDE / 移动端
        │ 绑定决定、只读投影
        ▼
Agent Protocol 0.1.6
        │
        ├─ Agent SDK 0.2.5 (TS) / 0.2.6 (Python)
        ▼
CLI 0.166.9
  ├─ Graph Kernel：history / HumanTask / migration / retirement
  ├─ Agent Team：fairness / lease / fence / message custody
  ├─ Record & Replay：隔离 Playwright UI driver
  ├─ Codex adapter：exact-version admission + JSONL fallback
  └─ Process Broker / sandbox / policy / receipts
```

IDE、Desktop、Web 与移动端都不是权威 writer。它们展示带 revision/evidence 的投影并提交决定，实际结算由 CLI/Graph runtime 完成。

## 配置参考

安装或升级 CLI：

```bash
npm install --global chainlesschain@0.166.9 --registry https://registry.npmjs.org
cc --version
```

安装 SDK：

```bash
npm install @chainlesschain/agent-sdk@0.2.5
npm install @chainlesschain/agent-protocol@0.1.6
python -m pip install chainlesschain-agent-sdk==0.2.6
```

VS Code 兼容编辑器可从 [Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 安装 `0.37.73`。官方 Microsoft VS Code Marketplace 尚未发布；stock VS Code 用户请从 Open VSX 下载 VSIX 后选择 “Install from VSIX”。JetBrains 2024.2+ 从 Marketplace 安装当前公开的 `0.4.103`。

真实 UI 回放和 Codex App Server adapter 都不是通用网络/浏览器逃生口。不要通过环境变量或修改审阅稿绕过 capability、selector、版本或网络策略。

## 性能指标

- HumanTask 进入等待态后释放 Agent capacity，不用一个空闲 Worker 长期占槽。
- Graph history、snapshot、消息队列、回放步骤、浏览器输出和 receipt 都有条目数与字节上限。
- UI replay 使用临时 browser context，完成、失败、超时或取消后统一回收 page/context/browser。
- 本版没有宣称新的 72 小时长期 soak；文档中 1,800.21 秒、2,427,887 请求的 App Server 数据属于前序 `0.166.5` 证据。

## 测试覆盖

精确 SHA `222396f6a8` 的权威公开门：

| 门禁                               | GitHub Actions run | 状态 |
| ---------------------------------- | ------------------ | ---- |
| CLI CI（Linux/Windows/macOS）      | `33228796205`      | 成功 |
| CLI Strict Sandbox                 | `33232869268`      | 成功 |
| npm 发布、provenance 与回读        | `33232869286`      | 成功 |
| IDE Extensions                     | `33230594120`      | 成功 |
| Record Replay UI Journey           | `33228796228`      | 成功 |
| Codex App Server Compatibility     | `33228796157`      | 成功 |
| Desktop Signed Skill Qualification | `33232869336`      | 成功 |

任何后续提交都必须在自己的 exact SHA 上重新跑对应门禁，不能继承上表结论。

## 安全考虑

- UI replay receipt 不保存 selector、输入值、页面正文、URL 或截图内容，只保留 domain-separated digest 和有界结构元数据。
- 回放过程拒绝 HTTP(S)、WebSocket、文件读取和未声明导航；network-escape probe 是三平台 aggregate 的必需项。
- Codex adapter 对未知、预发布或未验证 patch 失败闭合，并在回合开始前回退稳定 JSONL 路径。
- 审批 grant 只复用请求携带的 exact capability、scope、binding 与有效期；UI 不能扩权。
- Desktop 签名资格不是公共 native 分发完成证明；fresh install、upgrade、rollback、notarization/updater 仍须按渠道独立回读。
- npm CLI 包不包含 Electron Desktop 字节，不能把 Desktop 源码能力表述为 CLI 包内容。

## 故障排查

**npm 镜像返回 E404**：中国大陆镜像可能尚未同步新 tarball，显式使用官方 registry：

```bash
npm install --global chainlesschain@0.166.9 --registry https://registry.npmjs.org
```

**JetBrains 看不到 0.4.104**：这是预期状态。Marketplace 当前公开 `0.4.103`，等待 `0.4.104` 公网回读后再升级。

**Python 安装不到 0.2.5**：该候选未发布。安装 `chainlesschain-agent-sdk==0.2.6`。

**Codex App Server 自动回退**：先运行 `cc --version`，再检查上游 Codex patch 是否在当前 CLI 的兼容清单。回退是安全行为，不应通过强制开启未知版本绕过。

**UI 回放报告缺少页面内容**：这是隐私设计。报告只提供 digest 和结构状态；需要人工诊断时应在受控环境重新执行并直接观察页面。

## 关键文件

- `packages/cli/src/lib/graph-kernel/retirement-evidence.js`
- `packages/cli/src/lib/record-replay/playwright-ui-driver.js`
- `packages/cli/src/lib/codex-app-server-adapter.js`
- `packages/cli/src/lib/approval-grant-ledger.js`
- `packages/cli/src/lib/agent-team/task-lease.js`
- `packages/agent-protocol/schema/cc-agent-protocol.schema.json`
- `desktop-app-vue/scripts/create-signed-desktop-skill-evidence.mjs`
- `desktop-app-vue/scripts/signed-desktop-skill-journey.mjs`

## 使用示例

确认公共版本：

```bash
cc --version
npm view chainlesschain version
npm view @chainlesschain/agent-sdk version
npm view @chainlesschain/agent-protocol version
python -c "import chainlesschain_agent_sdk as sdk; print(sdk.__version__)"
```

预期版本依次为 `0.166.9`、`0.166.9`、`0.2.5`、`0.1.6` 与 `0.2.6`。

在 CI 中验证 CLI 基础入口：

```bash
cc --version
cc doctor
cc agent --help
cc team graph --help
```

## 相关文档

- [CLI Runtime 当前实现](/chainlesschain/cli-runtime-current)
- [Graph Kernel 使用与运维](/chainlesschain/cli-graph-kernel)
- [GraphRun 观测与评估](/chainlesschain/cli-team-graph)
- [Agent SDK](/chainlesschain/agent-sdk)
- [Agent Protocol](/chainlesschain/agent-protocol)
- [IDE 插件完整指南](/chainlesschain/ide-plugin)
- [Desktop Graph 调试与 Skill 安全](/chainlesschain/desktop-graph-skill-security)
- [设计文档：Agent Platform 发布与运行时边界](/design/modules/110-agent-platform-release-boundaries)
