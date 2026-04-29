/**
 * Minimal preload for `--web-shell` mode.
 *
 * Phase 0/1.1 just needs the web-panel SPA to render in Electron and reach
 * the embedded ws-server via window.__CC_CONFIG__ (injected server-side).
 * Web-panel itself runs unmodified in browsers, so it doesn't expect any
 * preload-injected globals. The full desktop preload (src/preload/index.js,
 * 3238 LOC) targets the V5/V6 Vue renderer and crashes the sandbox bundle
 * when loaded against web-panel HTML — see strategy decision in
 * memory/desktop_web_shell_strategy.md ("preload 仅暴露真·原生 API").
 *
 * Phase 2 will add `window.__CC_DESKTOP__` here for high-risk UKey ops
 * (decision #3 — ukey.sign-key/reset/export-mnemonic via native bridge,
 * everything else still over WS). Empty for now — keep it that way until
 * the first real consumer.
 */
