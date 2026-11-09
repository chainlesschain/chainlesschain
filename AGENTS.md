# Repository Guidelines

## Project Structure & Module Organization

- `desktop-app-vue/`: Electron + Vue desktop client (main/renderer code).
- `backend/`: Spring Boot project service and FastAPI AI service.
- `community-forum/`: Forum backend/frontend.
- `mobile-app-uniapp/`, `android-app/`, `ios-app/`: Mobile clients.
- `signaling-server/`: P2P signaling service.
- `tests/`: Unit, integration, performance, and security tests.
- `docs/`: Architecture, feature, and workflow documentation.

## Build, Test, and Development Commands

- `npm run dev:desktop-vue`: Run the primary desktop app (Electron + Vue).
- `npm run dev:desktop`: Run the legacy desktop app workspace.
- `npm run build:desktop-vue` / `npm run build:desktop`: Production builds.
- `npm run docker:up` / `npm run docker:down`: Start/stop backend services via Docker.
- `npm run setup`: Project setup helper (see `scripts/`).
- `npm run init:db`: Initialize local database.
- `npm run signaling:dev`: Run signaling server in dev mode.

## Coding Style & Naming Conventions

- Formatting: Prettier (`npm run format`) is the source of truth.
- Linting: ESLint (`npm run lint`) with TypeScript + React rules.
- Naming: files `kebab-case`, classes `PascalCase`, variables/functions `camelCase`, constants `UPPER_SNAKE_CASE`.
- JavaScript uses async/await; CommonJS is allowed in some areas.

## Testing Guidelines

- Unit/integration: Jest (`npm run test:jest`) and Vitest coverage (`npm run test:vitest:coverage`).
- E2E: Playwright (`npm run test:e2e`).
- Full suite: `npm run test:all`.
- Coverage targets (from docs): unit 80%+, integration 60%+, E2E on critical flows.
- Naming: `*.test.ts` / `*.spec.ts` and tests under `tests/`.

## npm Release Validation

- Use GitHub Actions OIDC Trusted Publishing for npm releases. This is the established release method; do not switch to npm tokens or local publishing when troubleshooting or retrying a failed release.
- Publish required child npm packages in dependency order before publishing the CLI; publish IDE extensions only after the CLI release is available, then publish mobile and PC clients last. Verify each published package can be fetched and downstream dependency versions are aligned before proceeding to the next stage. Required release order: child npm packages → CLI → VS Code / JetBrains IDE extensions → mobile / PC clients. Do not release a downstream stage before its required upstream releases are verified.
- Update `packages/cli/README.md` when publishing a new CLI npm version: current public version, IDE pairing, installation command, and release limits must match the published package. Update the root READMEs and public documentation in the same release follow-up.
- Treat GitHub Actions as the authoritative npm release gate; local tests are supplementary.
- Before publishing an npm package, verify the exact release commit with the relevant Linux, Windows, and macOS workflow matrix.
- For CLI releases, require both `CLI CI` and `CLI Strict Sandbox` to pass on all configured operating systems.
- Do not publish from a local-only result, a partial matrix, a timed-out suite, or checks attached to an older commit.

## Commit & Pull Request Guidelines

- Commit style: Conventional Commits with optional scope, e.g.:
  - `feat(rag): add reranker support`
  - `fix(p2p): resolve connection timeout`
  - `docs(readme): update installation guide`
- Typical types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.
- PRs: create a feature branch (`feature/*`), open a PR on GitHub, fill the PR template, and include test results relevant to changes.

## Security & Configuration Tips

- Use Docker for backend services when possible (`docker-compose up -d`).
- Keep Node.js `>=22.12.0` and npm `>=10.0.0` as specified in `package.json`.

## Project Management E2E Reference

Historical journey coverage, IPC channels, benchmarks, and runner details are in [the 2026-02-04 test inventory](docs/testing/pm-e2e-history-2026-02-04.md). For the project-management journey, run `npx playwright test tests/e2e/project-management-journey.e2e.test.ts`. Historical readiness labels do not replace current-commit test results.
