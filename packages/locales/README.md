# @chainlesschain/locales

Single source of truth for ChainlessChain i18n strings shared across
**web-panel** (Vue 3 + vue-i18n), **desktop-app-vue** (Electron, future
consumer), and any new front-end that joins the catalog.

## Why a shared package

Three forks of the same `zh-CN.json` would drift. Centralising lets us:

- Add an English / German / etc. locale once and have every UI pick it up.
- Run `vue-i18n-extract` against the catalog from one root.
- Catch divergence (`web-panel` translated `common.refresh` but
  `desktop-app-vue` did not) at build time, not in QA.

This is M1 of the i18n migration. M2 wires the extraction tool, M3
incrementally translates view strings.

## Layout

```
seed/
  zh-CN.json        — canonical Chinese strings (the source we author)
  en.json           — English translations (mirrored shape)
  index.js          — barrel export: messages, SUPPORTED, FALLBACK
```

`zh-CN` is the **authoring locale**; new strings go there first, then
`en` mirrors. The two files MUST keep identical key shape — a missing
key in `en` means vue-i18n falls back to Chinese for English users,
which is jarring.

## Consuming

```js
// Import the whole catalog
import { messages, SUPPORTED, FALLBACK } from '@chainlesschain/locales'

createI18n({ locale: 'zh-CN', fallbackLocale: FALLBACK, messages })

// Or pull a single locale
import zhCN from '@chainlesschain/locales/zh-CN'
```

The package is wired via vite + vitest aliases inside each consumer
(see `packages/web-panel/vite.config.js`). It is NOT registered as a
workspace dependency today because `web-panel` ships as an embedded
SPA bundle, not a node-resolved package — the alias is what threads
the seed into the Vite graph at build time.

## Namespace ownership

Top-level keys are scoped by feature so multiple authors can extend
the catalog without colliding:

| Key prefix | Owner | Use for |
|------------|-------|---------|
| `common.*` | shared | Generic UI verbs/nouns reused across many pages (refresh, save, cancel, …). Touch with care — every UI inherits the change. |
| `error.*` | shared | Global error UX (ErrorBoundary fallback, runtime toast). |
| `language.*` | shared | Locale switcher labels. |
| `<feature>.*` | feature owner | One namespace per feature page (`pipeline.*`, `compliance.*`, `did.*`, …). Owner = the team or PR author who introduced the page. |

When adding a new namespace:

1. Create the entry in **both** `zh-CN.json` and `en.json` simultaneously.
2. Use nested objects (not dot-flattened keys) so JSON tools can
   navigate the file.
3. Prefer descriptive keys over the source string itself (e.g.
   `pipeline.create.title` rather than `创建流水线`). Source-text keys
   age badly — the moment you reword the UI in one locale, the key
   stops matching its content.

## Tooling (M2)

```bash
# 1. Drift report — compares $t() call sites in consumer code to the
#    seed JSONs. Exits 1 on missing keys (CI-friendly).
npm --prefix packages/locales run extract

# 2. Untranslated-string scanner — surfaces raw CJK text inside .vue
#    templates that isn't already wrapped in $t(). Informational only.
npm --prefix packages/locales run scan-untranslated

# 3. Both, sequentially.
npm --prefix packages/locales run audit
```

`extract.js` is built on `vue-i18n-extract`; `scan-untranslated.js` is a
small custom heuristic scanner — it only looks at `<template>` blocks,
strips `$t(...)` wrapped calls, and reports the rest. It deliberately
does not gate the build because false positives (e.g. a-tag values
that read like Chinese) are common — use it as a planning artifact
for M3, not a CI failure source.

To wire a new front-end into the catalog, add an entry to the
`CONSUMERS` array in `scripts/extract.js` and `scripts/scan-untranslated.js`.

## Guard rails

- `packages/web-panel/__tests__/unit/no-stray-locales.test.js` fails the
  build if any `src/**/locales/*.json` exists in web-panel — preventing
  the catalog from forking.
- `packages/web-panel/__tests__/unit/i18n.test.js` asserts end-to-end
  translation lookup for both locales — fails loudly if a key gets
  renamed in one file but not the other.
- `npm --prefix packages/locales run extract` exit-code 1 on missing
  keys; suitable for CI integration once GitHub Actions covers it.
