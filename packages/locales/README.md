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

## Guard rails

- Linting enforces "no JSON locale files outside `packages/locales/seed/`"
  in `web-panel` and `desktop-app-vue` source trees (see the relevant
  ESLint config). If you spot a stray `src/locales/*.json`, move it
  here before merging.
- Tests in `packages/web-panel/__tests__/unit/i18n.test.js` assert
  end-to-end translation lookup for both locales — they fail loudly if
  a key gets renamed in one file but not the other.
