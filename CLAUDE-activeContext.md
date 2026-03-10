# ChainlessChain 当前会话上下文

> 记录当前开发会话的状态和上下文，帮助 AI 助手快速了解工作进度
>
> **最后更新**: 2026-03-10 (v5.0.1 测试覆盖扩展 + 文档同步)

---

## 当前工作焦点

### 活跃任务

- [x] v5.0.1 测试覆盖扩展 — 全部完成 ✅
  - Community Registry 全覆盖单元测试 (~28 tests)
  - Community Registry 生命周期集成测试 (~8 tests, HTTP server)
  - Skill Loader 补充单元测试 (~20 tests)
  - Browser Action 边缘用例测试 (~12 tests)
  - MCP Registry E2E 测试 (~8 tests, Playwright + Electron)
- [x] Bug 修复 ✅
  - CommunityRegistry `_fetchRemoteCatalog` 验证不一致 (description 不再必须)
  - CommunityRegistry `_compareVersions` NaN 处理 (非数字版本部分返回 0)
- [x] 文档更新 (7 个文件) ✅
  - CHANGELOG.md: v5.0.1 条目
  - CLAUDE.md: 版本号更新
  - CLAUDE-activeContext.md: 完整重写
  - CLAUDE-patterns.md: 4 个新模式 (v1.3.0)
  - CLAUDE-decisions.md: 3 个新 ADR (ADR-015/016/017)
  - CLAUDE-troubleshooting.md: 4 个新问题 (v1.3.0)
  - FEATURES.md: 3 个新特性行

### 近期完成

- [x] MCP 远程注册中心 — `_fetchRemoteCatalog()` + `remoteRegistryUrl` 配置 ✅
- [x] Android `RemoteSkillProvider` 接口 — `core-p2p` 模块跨模块技能委托 ✅
- [x] iOS `VectorStore.list(limit:offset:)` 协议方法 + 实现 ✅
- [x] iOS `DatabaseEngine` 只读 SQL 查询执行 ✅
- [x] iOS `MCPHttpSseTransport.sendRequest()` fatalError 修复 ✅
- [x] iOS `CollaborativeEditorView` 硬编码 userId 修复 ✅
- [x] 安全审计测试正则修复 ✅
- [x] Vitest cowork-e2e.test.js 排除 (CJS 格式不兼容) ✅
- [x] 社区注册中心远程获取测试 (10 tests) ✅
- [x] Skill 懒加载测试 (48 tests) ✅

## 架构状态

- **桌面端技能**: 137 个内置技能
- **Android 技能**: 28 个 (12 Kotlin handlers + 8 doc-only + 8 REMOTE)
- **MCP 服务器**: 8 个内置 + 远程注册中心获取支持
- **测试状态**: 全部通过 (单独运行)，分批运行避免 OOM
- **版本**: v5.0.1

## 关键文件位置

- MCP 社区注册中心: `desktop-app-vue/src/main/mcp/community-registry.js`
- 远程获取测试: `desktop-app-vue/tests/unit/mcp/community-registry-remote.test.js`
- 技能加载器: `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-loader.js`
- 浏览器动作: `desktop-app-vue/src/main/browser/actions/`
- Android RemoteSkillProvider: `android-app/core-p2p/src/main/java/.../RemoteSkillProvider.kt`
- iOS VectorStore: `ios-app/ChainlessChain/Features/AI/VectorStore/VectorStore.swift`

## 测试运行备忘

```bash
# 社区注册中心测试
cd desktop-app-vue && npx vitest run tests/unit/mcp/

# 技能加载器测试
npx vitest run src/main/ai-engine/cowork/skills/__tests__/skill-loader-unit.test.js

# 浏览器动作边缘测试
npx vitest run src/main/browser/actions/__tests__/browser-actions-edge-cases.test.js

# E2E (需要构建)
npx playwright test tests/e2e/features/mcp-registry.e2e.test.ts

# 分批运行避免 OOM (最多 3 个文件)
npx vitest run file1 file2 file3
```
