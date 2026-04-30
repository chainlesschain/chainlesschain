/**
 * useShellMode — single source of truth for "what runtime is hosting the
 * SPA". The web-panel ships in two modes:
 *
 *   embedded — loaded inside the desktop Electron web-shell. The host
 *              injects `window.__CC_CONFIG__.embeddedShell = true` and
 *              registers in-process WS topics (mcp.*, llm.chat,
 *              ukey.sign, fs.*, etc.) the standalone CLI mode doesn't have.
 *   browser  — loaded by `cc serve` (or any plain HTTP host). Topics fall
 *              through; pages must use `ws.execute('cc ...')` or accept
 *              degraded UX.
 *
 * Centralising the detection here means a future flag rename (or a more
 * sophisticated capability check) only changes one place. Three callers
 * before this commit (skills store, useFs, UkeySign.vue) had it inlined
 * and would have drifted if the shape ever changed.
 *
 * Reads `window.__CC_CONFIG__` on every call. The host injects this once
 * at boot and never mutates it, so per-call reads are cheap and the
 * absence of caching keeps tests trivially driveable (mutate globals,
 * call useShellMode again).
 */

function readConfig() {
  if (typeof window === 'undefined') return {}
  return window.__CC_CONFIG__ || {}
}

export function useShellMode() {
  const cfg = readConfig()
  return {
    /** True only when the SPA is hosted inside the desktop web-shell. */
    isEmbedded: cfg.embeddedShell === true,
    /** Raw __CC_CONFIG__ snapshot (whatever the host injected). */
    config: cfg,
    /** WS host the host injected (e.g. '127.0.0.1'). */
    wsHost: typeof cfg.wsHost === 'string' ? cfg.wsHost : '127.0.0.1',
    /** WS port the host injected. */
    wsPort: typeof cfg.wsPort === 'number' ? cfg.wsPort : 18800,
    /** 'project' | 'global' */
    mode: cfg.mode === 'project' ? 'project' : 'global',
    /** Active project root, or null in global mode. */
    projectRoot: typeof cfg.projectRoot === 'string' ? cfg.projectRoot : null,
    /** Human-readable project name. */
    projectName: typeof cfg.projectName === 'string' ? cfg.projectName : null,
  }
}
