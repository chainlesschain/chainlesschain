# 第三十九次工程实施：旧浏览器 Agent 变更路径失败关闭

日期：2026-09-19

## 本批结论

本批继续收敛 G03 的绕行面：旧 `BrowserAutomationAgent` 即使开启实验开关，也不能再直接执行模型生成的 navigate/click/type/select；`ComputerUseAgent` 的 open-tab、浏览器/桌面鼠标键盘、滚动和历史导航变更同样在任何引擎、页面或动作模块调用前失败关闭。

受治理的单次视觉点击、视觉输入和 Agent 导航继续通过各自专用 IPC 与签名 authority 执行。人工 UI、显式 workflow 和 recording replay 是不同兼容面，本批没有把它们误标为 Agent 自动决策，也没有改变其现有行为。

## 主要实现

### 1. 统一旧 Agent 变更守卫

`browser-workflow-authority.js` 新增 `assertGovernedAgentMutation(entrypoint, action)`。它固定抛出：

- `code: CC_AGENT_EVOLUTION_INGRESS_FAILED`；
- 实际 entrypoint 与 action；
- `authorityMode: dedicated-action-required`；
- browser origin surface。

该守卫不受 `CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL` 影响。实验开关只能开放 legacy workflow 解析/只读能力，不能恢复没有独立 action authority 的 Agent 副作用。

### 2. BrowserAutomationAgent

以下模型生成步骤在调用 `browserEngine` 前拒绝：

- navigate；
- click；
- type；
- select。

snapshot、wait 和 screenshot 等非变更步骤保持原有分发；受治理变更应由调用方拆分到专用 action IPC，而不是把 opaque grant 暴露给旧 Agent。

### 3. ComputerUseAgent

以下路径统一在 dispatch 前拒绝：

- open-tab；
- click、double-click、right-click、mouse-move、drag；
- type、key、shortcut、scroll；
- vision-click；
- navigate、back、forward、refresh；
- desktop-click、desktop-type。

普通 screenshot 分发继续可用；视觉 analyze/locate 仍由既有视觉 ingress 合同约束。

## 验证结果

旧 Agent 变更守卫、Browser IPC 与 Desktop runtime authority 相关回归：

```text
Test Files  3 passed (3)
Tests       33 passed (33)
```

其中新增守卫直接覆盖 22 项操作。相关 JavaScript 文件通过 ESLint（0 errors，保留 2 个既有 unused-variable warnings），全部本批文件通过 Prettier。

## 仍未完成

- 人工 `browser:navigate`、`browser:act`、coordinate/keyboard IPC、显式 workflow 与 recording replay 仍是兼容通道；需要产品身份模型证明 Agent 不能借 renderer 或工具间接调用这些通道；
- 初始 URL 获批后的跨 origin 重定向仍没有请求级预阻断；
- back/forward/refresh、通用键盘动作和多步视觉任务尚无各自可执行的受治理合同，旧 Agent 仅被失败关闭；
- operator 生产 authority/audit writer、DID/RBAC/隐私策略、不可逆副作用恢复及真实 Electron/browser E2E 仍待目标环境验收。
