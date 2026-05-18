---
paths:
  - "packages/cli/**"
  - "packages/core-*/**"
---

# CLI Package Development Rules

## Build & Test

```bash
cd packages/cli
npm install
npm test                   # Run all tests (5200+ tests)
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:e2e           # End-to-end tests
```

## Architecture

- **Entry**: `bin/chainlesschain.js` → `src/index.js` (Commander)
- **Commands**: `src/commands/` (64 command files)
- **REPL**: `src/repl/` (chat-repl.js, agent-repl.js — 10 tools + 138 skills + Plan Mode)
- **Runtime**: `src/runtime/` (bootstrap.js — 7-stage headless init)
- **Libraries**: `src/lib/` (70+ modules)
- **Core packages**: core-env, shared-logger, core-infra, core-config, core-db
- **Dependencies**: commander, @inquirer/prompts, chalk, ora, semver

## Critical: _deps Injection Pattern

`vi.mock("module")` does NOT intercept `require("module")` from CJS src files (inlined via vitest config). Use `_deps` injection instead:

```js
// source file:
const _deps = { uuidv4, spawn, fs };
module.exports = { MyClass, _deps };

// test file beforeEach:
const mod = require("../my-module.js");
mod._deps.uuidv4 = vi.fn(() => "test-uuid");
```

`vi.mock("uuid")`, `vi.mock("child_process")`, `vi.mock("fs")` all fail for inlined CJS — always use `_deps`.

## CLI Aliases

After `npm install -g chainlesschain`, also available as `cc`, `clc`, or `clchain`.

## Skill Pack System

- 9 packs in `.chainlesschain/skills/cli-*-pack/` (workspace layer, CJS module.exports handlers)
- `skill sync-cli [--force] [--dry-run] [--remove] [--json]`
- `parseSkillMd` converts YAML **keys** to camelCase but NOT values
