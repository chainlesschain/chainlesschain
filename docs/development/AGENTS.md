# Repository Guidelines

## Project Structure & Module Organization
ChainlessChain is a Node/Electron monorepo. The root `package.json` orchestrates workspaces such as `desktop-app-vue` (Electron + Vue 3 + TypeScript), `backend` (services, FastAPI helpers, Docker stack), and `mobile-app-*`. Desktop source lives under `desktop-app-vue/src`, split into `main` (Electron processes), `renderer` (Vue UI), and `preload`. Tests and plans sit in `tests/` and `docs/plan`. Assets, installers, and scripts are in `desktop-app-vue/assets`, `build/`, and `scripts/`. Respect this layout when adding modules or data files.

## Build, Test, and Development Commands
- `npm run dev:desktop` (root): starts Electron + Vite dev servers.
- `npm run build:desktop` (root): builds production bundles for the desktop app.
- `npm run dev` inside `desktop-app-vue`: runs `build:main`, Vite renderer, and Electron concurrently.
- `npm run test` (root): runs workspace test suites (Vitest, Playwright, etc.).
- `npm run docker:up` / `npm run docker:down`: control backend support services (Ollama, Qdrant, DB).
Document new commands in `README.md` or module-specific docs.

## Coding Style & Naming Conventions
- TypeScript/JavaScript use 2-space indentation. Vue SFCs follow `<script setup>` where possible.
- Prefer named exports for shared modules; avoid default exports in shared type definitions (`src/shared`).
- Run `npm run lint` (ESLint + TS/Vue rules) and `npm run format` (Prettier defaults) before committing.
- Components and pages use `PascalCase` filenames, hooks use `use*`, and stores live under `src/renderer/stores`.

## Testing Guidelines
- Vitest is the primary unit test runner (`npm run test:unit`). Integration/e2e suites use Playwright (`npm run test:e2e`).
- Place tests near their targets with `.test.ts|tsx` suffixes. Mock external services (LLM, file IO) rather than hitting live Docker stacks.
- When modifying critical flows (database adapters, sync, crypto), add regression tests and update fixtures under `tests/`.

## Commit & Pull Request Guidelines
- Follow Conventional Commit flavor seen in history (`feat:`, `fix:`, `chore:`, `docs:`). Keep messages concise and imperative.
- Pull requests should describe scope, risks, and include evidence: screenshots for UI, logs for CLI/setup changes, and the commands/tests run.
- Link issues when applicable, keep diffs scoped to one concern, and ensure `npm run lint` plus `npm test` pass before requesting review.

## Security & Configuration Tips
- Never commit secrets or hardware-key credentials. Load runtime settings from `.env` or Docker env vars.
- Treat `backend/docker` volumes and model data as sensitive; scrub before sharing.
- For crypto or identity flows, document threat assumptions in the PR and add regression tests whenever possible.

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
