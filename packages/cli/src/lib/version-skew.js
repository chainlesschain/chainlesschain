/**
 * Detect when the cc package was updated on disk AFTER this process spawned.
 *
 * A long-lived cc process — an IDE chat-panel `cc agent --input-format
 * stream-json` session, or an interactive REPL — loads its JavaScript into
 * memory at spawn time. `npm i -g chainlesschain@latest` only rewrites the
 * files on disk; it does NOT reload an already-running process. So after an
 * update the still-running session keeps executing the OLD in-memory code.
 *
 * This is exactly how a fixed bug looks "not fixed": the user updates cc, but
 * the IDE panel's persistent agent process never restarted, so it keeps the old
 * behaviour (e.g. the provider-auth-hijack → haiku). We surface a friendly,
 * one-time notice telling them to reload the IDE window / restart the session.
 *
 * `VERSION` (constants.js) is baked at module load (a cached `require()` of
 * package.json) → the SPAWN-TIME version. A FRESH read of package.json from
 * disk → the CURRENTLY-INSTALLED version. Disk strictly newer ⇒ skew.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import semver from "semver";
import { VERSION } from "../constants.js";

const PKG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);

/**
 * Currently-installed version — a FRESH read of package.json from disk that
 * bypasses the require cache (so it reflects a post-update file). Returns null
 * on any error (missing/unreadable/invalid file → "no skew, stay quiet").
 *
 * @param {(p: string) => string} [readFile]  injectable for tests
 */
export function readDiskVersion(readFile = (p) => fs.readFileSync(p, "utf-8")) {
  try {
    const v = JSON.parse(readFile(PKG_PATH))?.version;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Pure skew check. Returns `{ loaded, installed }` ONLY when `installed` is a
 * valid semver STRICTLY GREATER than `loaded` (an update landed under a running
 * process). Returns null otherwise — same version, a downgrade, or anything
 * unparseable — so we never nag spuriously.
 *
 * @param {object} [o]
 * @param {string} [o.loaded]     version this process is running (default: VERSION)
 * @param {string} [o.installed]  version on disk now (default: fresh disk read)
 */
export function detectVersionSkew({
  loaded = VERSION,
  installed = readDiskVersion(),
} = {}) {
  if (!loaded || !installed || loaded === installed) return null;
  let newer = false;
  try {
    newer =
      semver.valid(installed) != null &&
      semver.valid(loaded) != null &&
      semver.gt(installed, loaded);
  } catch {
    newer = false;
  }
  return newer ? { loaded, installed } : null;
}

/** Friendly one-line notice (Chinese) for a detected skew. */
export function versionSkewMessage({ loaded, installed } = {}) {
  return (
    `cc 已更新到 ${installed}（当前会话仍在运行 ${loaded}）。` +
    `请重新加载 IDE 窗口（VS Code: 命令面板 → Developer: Reload Window）` +
    `或重启此会话，以应用更新。`
  );
}
