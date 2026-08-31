# Desktop Graph 调试与 Skill 安全执行

> 适用范围：2026-08-31 Desktop 源码与 exact-SHA qualification 快照。公开 CLI 的生产推荐版仍按独立发布链判断；当前 npm `latest` 为 `chainlesschain@0.166.14`，精确发布 SHA 为 `ee88125256`。

本页介绍两项最新 Desktop 能力：Graph Run Debugger，以及 Cowork Skill 的签名、隔离和能力代理。两者都会自动工作，普通用户不需要手工配置安全 Broker。

## 概述

Graph Run Debugger 把 canonical Graph 历史转换为只读的拓扑、时间、预算、Trace 与因果视图；Skill 执行安全则在 Handler 运行前核对代码身份，并把高风险宿主访问收进有界 Broker。公开 CLI 的生产推荐版与 Desktop 发布后源码始终按不同制品身份说明。

## 核心特性

当一次 AI 会话、工作流或 Agent 历史记录携带 canonical Graph 数据时，桌面端会显示 **Graph Run Debugger**。

可从三处进入：

1. **AI 对话**：当前 Coding Agent 会话生成 Task Graph 后，调试器出现在会话任务区；
2. **工作流监控**：打开“工作流监控”，选择带 Graph 历史的运行；
3. **Agent Dashboard**：进入任务历史，在有 Graph authority 的记录上点击“调试 Graph”。

调试器提供五个视图：

| 视图           | 用途                                                    |
| -------------- | ------------------------------------------------------- |
| Topology       | 查看任务依赖、节点状态、关键路径、slack 和 blocked root |
| Timeline       | 按时间查看耐久事件，并跳转到关联节点                    |
| Budget heatmap | 对比各节点已用预算与上限，定位预算热点                  |
| Trace overlay  | 查看 Attempt、Artifact、Effect 等证据覆盖               |
| Causality      | 沿任务、消息、审批、租约与 Artifact 元数据追查原因      |

事件存在多个 revision 时，可拖动 **Time travel** 滑块回到任意历史帧；**Live** 返回当前 revision。界面会显示节点新增、移除和状态变化，不会修改原始运行。

### 隐私说明

调试器只消费只读投影。因果视图默认只显示元数据，不把消息正文或 Artifact 内容暴露给 Renderer overlay。若某个历史来源只有摘要而没有耐久事件，界面会明确显示证据缺失，不会补造事件。

## 系统架构

```text
Graph event store ──只读投影──> Graph Run Debugger
                                      ├─ topology / timeline / budget
                                      └─ trace / causality / time travel

Skill discovery ──身份与摘要复验──> bundled handler 或一次性 Worker
                                      └─ authority-bound capability Broker
```

Debugger 不持有 writer authority；外部 Worker 也不持有 Electron、数据库、MCP client、网络模块或 `child_process`。真正的宿主操作由当前任务 authority 与 Broker 策略共同决定。

## 配置参考

- Graph Run Debugger 无独立开关：选中的会话或运行包含 canonical Graph/history 时自动显示。
- 外部可执行 Skill 的 `SKILL.md` 必须声明 `execution-capabilities`，并随可信 Ed25519 签名和 `.skill-lock.json` 一起安装。
- 动态公网目标需要本次调用的明确 declassification/authority；固定域名、本地模型、诊断、进程与环境值使用各自独立 Broker 策略。
- 强制隔离或所需 Broker 不可用时系统失败闭合，不降级为主进程直接执行。

## 性能指标

- Graph 历史按 revision 生成只读帧，时间旅行不修改事件账本；长历史由有界投影与 UI 分页控制。
- 外部 Handler 使用一次性 Worker，并限制启动时长、总执行时间、能力请求数、stdin/stdout/stderr frame 与最终结果大小。
- 网络请求限制重定向次数、超时、请求/响应字节；环境 Broker 限制单值与快照总量。

## 测试覆盖

当前源码测试覆盖 Graph reducer/Debugger 视图与多入口集成，以及外部 Skill 缺签名、未知 key、摘要漂移、超时、中止、超限 frame 和强制隔离不可用等失败路径。内置 Skill 门禁还会重新生成能力目录，并检查固定/动态网络、本地服务、诊断、进程与环境 Broker 的目标、SSRF、秘密泄漏和资源上限。

同一 exact SHA 的 signed Desktop Skill qualification 还会绑定候选安装包、安装记录、签名记录与启动探针：macOS 使用明确的 app/inherit entitlements 和 after-sign notarization 钩子，打包后真实 Skill journey 复验能力目录、Broker、一次性 Worker 与宿主边界。该门已成功，但只代表 CI 资格证据；公共下载渠道的 fresh install、upgrade、rollback、notarization/updater 回读仍是独立发行条件。

## 安全考虑

Desktop Skills 分成三类：

- **内置 Skill**：随应用发布，Handler 必须与应用生成的能力目录一致；
- **外部可执行 Skill**：来自 workspace、managed 或 marketplace，必须有可信 Ed25519 签名和显式能力清单；
- **仅提示词 Skill**：没有 Handler，只给 Agent 提供说明，不获得 Node.js 或宿主能力。

外部可执行 Skill 会在一次性隔离 Worker 中运行，不能直接访问 Electron 主进程、数据库、MCP client、网络模块或 `child_process`。它只能申请宿主已经连接且当前任务允许的能力端口。签名只能证明发布者身份与字节未变，不能证明代码没有漏洞；OS 沙箱、最小权限账户和可信发布链仍然必要。

## 故障排查

| 错误类别               | 含义                                 | 建议                                             |
| ---------------------- | ------------------------------------ | ------------------------------------------------ |
| 签名缺失或不可信       | 外部 Handler 没有可信 Ed25519 身份   | 从可信来源重新安装；不要关闭校验                 |
| 内容摘要漂移           | Skill 在发现后被修改或替换           | 重新检查内容并由可信发布者重新签名               |
| 能力清单缺失           | Handler 没有声明需要的宿主表面       | 更新 `execution-capabilities` 并重新签名         |
| capability denied      | 当前会话或宿主策略未允许该操作/目标  | 缩小目标后重新发起明确授权                       |
| isolation unavailable  | 当前平台无法提供强制 Worker 隔离     | 修复运行环境；系统会失败闭合，不降级到主进程执行 |
| timeout / output limit | Skill 超过执行时间、请求数或输出上限 | 拆小任务，检查远端服务和循环逻辑                 |

### 网络与环境 Skill 的新边界

常用网络、媒体、模型、诊断和环境访问 Skill 已迁移到宿主 Broker：

- GitHub、Google Workspace、Notion、Tavily、天气、新闻与 YouTube 使用固定域名策略；
- API Gateway、HTTP Client 与 Summarizer 的动态域名需要本次调用明确批准；
- 图像生成、音频转写和模型管理分别经过公网或 loopback 本地服务边界；
- 网络诊断只允许批准的 DNS 类型、目标、端口和操作。
- API Key、服务地址和工具路径等环境值不再由 Handler 直接读取 `process.env`；宿主只向当前 Skill 返回审查过的逻辑键，并且不会把秘密值写入审计日志。

Broker 会拒绝通配符域名、IP 字面量、私网/loopback/link-local/multicast 解析结果和混合公网/私网 DNS，应对 SSRF 与 DNS rebinding。ping/traceroute 使用固定命令和字面参数、`shell:false`，不会把用户输入拼进 shell。

这意味着升级后某些过去“碰巧可访问”的任意地址会被拒绝。这是安全边界生效，不是网络故障。请改用明确目标并完成对应授权，不要通过放宽系统 shell 权限绕过。

## 关键文件

- `desktop-app-vue/src/renderer/components/graph/GraphRunDebugger.vue`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-execution-security.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/external-skill-executor.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-capability-catalog.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-environment-broker.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js`
- `desktop-app-vue/scripts/create-signed-desktop-skill-evidence.mjs`
- `desktop-app-vue/scripts/record-signed-desktop-install.mjs`
- `desktop-app-vue/scripts/record-signed-desktop-signature.mjs`
- `desktop-app-vue/scripts/signed-desktop-skill-journey.mjs`
- `desktop-app-vue/src/main/signed-desktop-launch-probe.js`

## 使用示例

1. 在 AI 对话、工作流监控或 Agent Dashboard 中选择带 Graph 历史的运行。
2. 打开 Graph Run Debugger，在 Topology 中选择 blocked 节点。
3. 切换 Timeline 与 Causality，沿 Attempt、审批、消息和 Artifact 元数据确认根因。
4. 用 Time travel 回到异常前 revision，对比预算与状态变化；点击 Live 返回当前视图。
5. 若关联 Skill 被拒绝，按错误码检查签名、内容摘要、能力声明、目标 authority 或资源上限，不要绕过 Broker。

## 相关文档

公开 CLI `0.166.14@ee88125256` 承接 Graph Kernel authoritative entry cutover、耐久 history/retirement、Context/Memory、Hooks v2、P0 执行安全、真实 UI replay 与 Codex compatibility。Desktop Graph 调试器、Skill 隔离/Broker 和签名 qualification 仍按 Desktop 制品边界说明，不能据此推断 npm 包含这些 Electron 组件，也不能把资格门扩写为公共 native 发行已经完成。

相关文档：

- [GraphRun 观测、回放与 CI 评估](/chainlesschain/cli-team-graph)
- [Skills 技能系统](/chainlesschain/skills)
- [CLI Runtime 当前实现](/chainlesschain/cli-runtime-current)
- [设计文档：Desktop Cowork Skill 执行安全](/design/modules/109_Desktop_Cowork_Skill_Execution_Security)
