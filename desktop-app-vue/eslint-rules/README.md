# Local ESLint rules

Project-specific ESLint rules, wired into `eslint.config.js` as local plugins.

## `no-unguarded-stale-write`

Catches the **stale-response / race** shape that recurred across the Pinia
stores (7 instances fixed: livestream, project, conversation, memory, session,
social-chat, workflow-session — plus the original coding-agent store): inside an
`async` action, an `await` (an IPC/network call) followed by a write to
context-scoped state (`this.current*`, plus `projectFiles`/`danmakuQueue` via
the configured `propertyPattern`) with **no guard** that the request is still the
latest. When the user switches context (project / conversation / chat / date /
session) during the await, the slower response overwrites the newer one.

Accepted guards (no warning):

```js
// (a) early return/throw between the await and the write
const r = await api(id);
if (this.currentXId !== id) return;     // or: if (seq !== _loadSeq) return;
this.currentX = r;

// (b) conditional assignment whose `if` test compares ids/tokens
const seq = ++_loadSeq;
const r = await api(id);
if (r && seq === _loadSeq) this.currentX = r;
```

Scope: `src/renderer/stores/**/*.{ts,js}`. Severity: `warn` (a heuristic — if a
particular write genuinely can't race, dismiss with an
`// eslint-disable-next-line store-race/no-unguarded-stale-write` plus a reason).

Tests: `tests/unit/eslint-rules/no-unguarded-stale-write.test.js` (ESLint
`RuleTester`).
