# Repository Guidelines

## Project Structure & Module Organization
- Root is a JavaScript/TypeScript monorepo. Primary app lives in `desktop-app-vue` (Electron + Vue3 + TS) with `src/main` for the Electron process, `src/renderer` for UI, `src/shared` for cross-process types, and `src/preload` for the bridge.
- `backend/docker` holds Docker Compose for LLM/RAG services; `backend/scripts` handles setup helpers.
- `android-app` is the Android native client (Kotlin + Jetpack Compose).
- `docs` contains design and process docs; `scripts` at root hosts automation (setup, database init).

## Build, Test, and Development Commands
- Install deps: `npm install` (root) plus `npm install` in `desktop-app-vue` if not using workspaces.  
- Run desktop in dev: `npm run dev:desktop` (root) or `npm run dev` inside `desktop-app-vue` to start main + renderer watchers.  
- Android install/debug: `npm run dev:android` (root; requires Android SDK).  
- Backend services: `npm run docker:up` / `npm run docker:down` / `npm run docker:logs` from root.  
- Build desktop: `npm run build:desktop`; package artifacts: `npm run package --workspace=desktop-app-vue`.  
- Init local DB: `npm run init:db`; clean artifacts: `npm run clean`.

## Coding Style & Naming Conventions
- TypeScript-first; keep 2-space indent and Prettier defaults (`npm run format`).  
- Lint with ESLint + TS/Vue rules (`npm run lint` or `npm run lint --workspace=desktop-app-vue`). Fix warnings before PR.  
- Components and pages use `PascalCase` filenames; hooks start with `use*`; shared utilities in `src/shared`. Avoid default exports for shared types.

## Testing Guidelines
- Root `npm test` runs workspace tests; add `*.test.ts`/`*.test.tsx` near the code they cover.  
- Focus on deterministic units: database adapters (`src/main/database.ts`), git sync, and crypto boundaries (`ukey.ts`).  
- Include fixtures/mocks for hardware keys and network I/O; avoid hitting live Docker services in unit tests.

## Commit & Pull Request Guidelines
- Use concise, imperative messages; follow Conventional Commit flavor seen in history (`feat:`, `fix:`, `chore:`, `docs:`).  
- PRs should describe scope, risks, and test evidence. Attach screenshots for UI changes and logs for setup/CLI changes.  
- Link issues when applicable; keep diffs minimal and scoped to one concern. Ensure `npm run lint` and `npm test` pass before requesting review.

## Security & Configuration Tips
- Never commit secrets or hardware key PINs. Load runtime settings via `.env`/Docker env vars; keep device-specific creds local.  
- Treat `backend/docker` models and volumes as sensitive; scrub data before sharing.  
- When touching crypto or identity flows, document threat assumptions in the PR and add regression tests where feasible.

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：Repository Guidelines。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
