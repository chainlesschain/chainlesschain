/**
 * IDE bridge lockfile writer — the editor side of the discovery protocol that
 * the CLI's `src/lib/ide-bridge.js` reads.
 *
 * Writes ~/.chainlesschain/ide/<port>.json (file 0600, dir 0700) advertising a
 * localhost MCP server + a per-instance bearer token. See
 * docs/design/modules/98_IDE桥接对标方案.md.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const _deps = {
  homedir: () => os.homedir(),
  now: () => Date.now(),
};

function ideLockDir() {
  return path.join(_deps.homedir(), ".chainlesschain", "ide");
}

/** A fresh 256-bit hex bearer token. */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Write (or overwrite) the lockfile for a running server.
 * @param {object} o
 * @param {number} o.port
 * @param {string} o.token
 * @param {string[]} [o.workspaceFolders]
 * @param {string} [o.ide]        default "vscode"
 * @param {string} [o.transport]  default "http"
 * @param {string} [o.urlPath]    default "/mcp"
 * @param {string} [o.url]        full url (overrides host/port/urlPath)
 * @param {number} [o.pid]
 * @returns {string} the lockfile path
 */
function writeLock({
  port,
  token,
  workspaceFolders = [],
  ide = "vscode",
  transport = "http",
  urlPath = "/mcp",
  url,
  pid = process.pid,
}) {
  const dir = ideLockDir();
  fs.mkdirSync(dir, { recursive: true });
  // 0700 dir / 0600 file: keep the bearer token unreadable by other local
  // users (no-op on most Windows filesystems, but correct on POSIX).
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
  const file = path.join(dir, `${port}.json`);
  const lock = {
    ide,
    version: 1,
    transport,
    url: url || `http://127.0.0.1:${port}${urlPath}`,
    port,
    workspaceFolders,
    token,
    pid,
    started_at: _deps.now(),
  };
  fs.writeFileSync(file, JSON.stringify(lock, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort */
  }
  return file;
}

/** Remove the lockfile for a port. Returns true if a file was deleted. */
function removeLock(port) {
  try {
    fs.unlinkSync(path.join(ideLockDir(), `${port}.json`));
    return true;
  } catch {
    return false;
  }
}

module.exports = { ideLockDir, generateToken, writeLock, removeLock, _deps };
