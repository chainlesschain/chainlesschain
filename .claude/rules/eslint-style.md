---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.vue"
  - "**/*.js"
---

# Code Quality & ESLint Rules

## Commit Conventions

Semantic commits: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`
Example: `feat(rag): add reranker support`

## Import Rules by File Type

**Main Process (.js in `src/main/`)**: Use CommonJS (`module.exports`, `require()`)
**Renderer (.ts, .tsx, .vue in `src/renderer/`)**: Always ES6 imports, TypeScript strict mode
**Test files**: Follow the import style of the file being tested

## Common ESLint Errors to Avoid

### 1. ES6 Imports in TypeScript/Renderer

```javascript
// ❌ causes @typescript-eslint/no-require-imports
const axios = require("axios");
// ✅
import axios from "axios";
```

### 2. Unused Variables in Catch Blocks

```javascript
// ❌ causes no-unused-vars + no-empty
try { await op(); } catch (err) { }

// ✅ Option A: log it
try { await op(); } catch (err) { console.error("Failed:", err); }

// ✅ Option B: underscore + comment
try { await op(); } catch (_err) { /* Intentionally empty */ }
```

### 3. Remove Unused Imports

Only import what you use. No dead imports.

## Pre-commit Checklist

1. `npm run lint` — all errors fixed
2. `npm run format` — properly formatted
3. No unused imports or variables
4. All catch blocks handled or commented
5. ES6 imports in all TypeScript/renderer code

## ESLint Config

- Parser: `@typescript-eslint/parser` + `eslint-plugin-vue`
- Rules: `desktop-app-vue/.eslintrc.js`
- Auto-fix: `npm run lint -- --fix`
