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
