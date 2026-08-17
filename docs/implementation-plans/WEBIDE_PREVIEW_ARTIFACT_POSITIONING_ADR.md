# WebIDE 向 Preview/Artifact 收敛的产品定位 ADR

## 文档信息

- 日期：`2026-08-16`
- 状态：**Accepted**
- 范围：Desktop 旧 `/webide` 页面、Session App Preview 与 Artifact 产品面
- 决策类型：产品定位与投资边界；不表示 App Preview 自动验证闭环已经实现

## 背景

仓库中的“Web IDE”名称超出了其实际能力边界。原始实施计划明确把它定义为类似 CodePen 的
HTML/CSS/JavaScript 实时编辑与预览页面；当前实现也只管理固定的 `index.html`、`style.css`、
`script.js`，并提供 iframe/本地服务器预览、Console 捕获和导出能力。它没有绑定 canonical coding
session，也没有通用仓库树、搜索、诊断、Git/Diff、Terminal 或 Worktree 模型。

与此同时，后续且已落地的产品方向已经明确：

1. Desktop 以 Chat-first 的 V6 壳为默认产品面，采用“左侧会话/空间、中间对话、右侧 Artifact”的
   统一结构，不再为每项能力新增孤立核心页面。
2. Web Panel 定位为 CLI Runtime 的轻量远程驾驶舱，而不是独立浏览器 IDE。
3. Coding 工作台以 session 为中心；WebIDE、Browser 和 Preview 的既有原语应进入同一 App Preview
   流程，形成启动、观察、断言、修复、复验和 evidence artifact 发布闭环。
4. 完整编辑器体验继续由 VS Code、JetBrains 插件和统一 Desktop Coding Workbench 承担。

因此，不需要凭空选择新的商业方向；现有产品设计已经为 P2-5 的定位问题提供了答案。

## 决策

1. **ChainlessChain 不建设独立的浏览器 IDE 产品。** 不以旧 `/webide` 页面为基础补齐通用仓库树、
   全局搜索、诊断、Git/Diff、Terminal、Worktree 和独立 session runtime。
2. **旧 `/webide` 保留为兼容性开发 playground。** 它只承诺已有的固定 HTML/CSS/JavaScript 编辑、
   预览、Console 和导出边界，不再作为主导航或发布材料中的完整 IDE 能力进行宣传。
3. **规范产品面是 session-bound Preview/Artifact。** 可复用的 `PreviewFrame`、preview server、截图、
   Console 等原语应逐步接入同一 coding session，产生带 session/turn/trace/worktree 归属的预览与
   脱敏 evidence artifact。
4. **兼容入口的删除不属于本 ADR。** 在没有独立弃用周期、使用证据、迁移说明和回滚方案前，不删除
   路由、IPC 或已有项目数据，也不把访问旧页面静默重定向成语义不同的页面。

## 实施边界

旧 playground 可以继续接受以下改动：

- 安全、数据完整性、崩溃、依赖兼容和无障碍缺陷修复；
- 保持既有项目读取、预览和导出能力可用所需的维护；
- 抽取或复用 Preview、Console、截图、Dev Server 等原语到 canonical session 流程。

以下改动不再进入旧页面：

- 为了匹配“完整浏览器 IDE”而新增仓库树、搜索、诊断、Git/Diff、Terminal 或 Worktree；
- 建立独立于 canonical session/runtime 的新状态、权限、审计或交付模型；
- 在文档、菜单或发布说明中把固定三文件 playground 宣称为完整 Web IDE。

## 后果

- P2-5 的“WebIDE 定位决策”有了明确、可审计的 Accepted 结论。
- 旧入口暂时保持兼容，避免把产品定位决策扩大为未经验证的破坏性迁移。
- App Preview 的真实 Dev Server、DOM/截图、Console/Network 回灌、交互断言、修复复验和 Artifact
  lineage 仍需按各自路线图验收；本 ADR 不把这些实现任务标记为完成。
- P2-4 的键盘、屏幕阅读器、焦点恢复、长会话虚拟化与性能矩阵也不因本决策而关闭。

## 现有证据

- [原始 Web IDE 实施计划](../../plan/archived/melodic-singing-dragon.md)：明确为 CodePen 式固定
  HTML/CSS/JavaScript playground。
- [Desktop V6 UI 设计](../design/桌面版UI重构_设计文档.md)：明确 Chat-first、Artifact 与插件化主线。
- [IDE 增量差距分析](../CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-17.md)：明确把 WebIDE/
  Browser/Preview 原语统一为 session-centric App Preview，并以 evidence artifact 结束验证流程。
- [旧页面实现](../../desktop-app-vue/src/renderer/pages/webide/WebIDEPage.vue)与
  [固定三文件编辑器](../../desktop-app-vue/src/renderer/components/webide/EditorPanel.vue)：证明当前实现边界。
- [V6 默认路由策略](../../desktop-app-vue/src/renderer/router/v6-shell-default.ts)：证明 Chat-first V6 壳
  已是默认产品入口。

## 验收

本定位决策满足以下条件时视为生效：

1. 本 ADR 保持 `Accepted`，且活跃产品文档不再把旧 playground 列为待补齐的独立浏览器 IDE。
2. 兼容页面文档明确其能力、非目标和迁移方向。
3. 路线图把 P2-5 记录为“定位完成”，同时继续诚实保留 App Preview 实现与 P2-4 验收缺口。
4. 本次文档变更通过 Markdown 格式化与 `git diff --check`；由于不改变运行时行为，不以组件或 E2E
   测试替代产品决策证据。
