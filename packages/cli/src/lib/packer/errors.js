/**
 * PackError — typed error for the pack pipeline. Carries an exit code that
 * `cc pack` propagates back to the OS so CI can branch on failure category.
 *
 * Exit code map (mirror docs/design/CC_PACK_打包指令设计文档.md §5.3):
 *   10 — precheck failed
 *   11 — web-panel build failed
 *   12 — native module prebuild missing
 *   13 — pkg build failed
 *   14 — smoke test failed
 *   15 — code-signing failed
 *   16 — preset config contained sensitive credentials
 */
export class PackError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "PackError";
    this.exitCode = exitCode;
  }
}

export const EXIT = Object.freeze({
  PRECHECK: 10,
  WEB_PANEL: 11,
  NATIVE: 12,
  PKG: 13,
  SMOKE: 14,
  SIGN: 15,
  SECRETS: 16,
});
