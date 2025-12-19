# Repository Guidelines

## Project Structure & Module Organization
- Root is a JavaScript/TypeScript monorepo. Primary app lives in `desktop-app-vue` (Electron + Vue3 + TS) with `src/main` for the Electron process, `src/renderer` for UI, `src/shared` for cross-process types, and `src/preload` for the bridge.  
- `backend/docker` holds Docker Compose for LLM/RAG services; `backend/scripts` handles setup helpers.  
- `mobile-app/android` is the Android client scaffold; iOS is reserved.  
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
