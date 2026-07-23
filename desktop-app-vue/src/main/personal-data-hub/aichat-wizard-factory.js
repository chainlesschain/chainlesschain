/**
 * AIChat WebView 鉴权向导 — IPC-side factory (Phase 10.3.3).
 *
 * Glue layer that converts:
 *   - aichat-accounts.json on disk → wizard's accountsStore contract
 *   - the 9 vendor SPECs in DEFAULT_VENDOR_SPECS → wizard's vendorAdapter
 *     contract (`registerVendor(vendor, cookies, opts) → { ok, userId? }`)
 *
 * The wizard-controller itself is pure / Electron-free (see
 * `aichat-wizard-controller.js`); this factory provides the missing pieces
 * so IPC handlers can hand the controller off without each handler having
 * to wire dependencies. Tests substitute the file / http parts via
 * `_deps`.
 *
 * Reference: docs/design/Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.md
 *   §4 IPC contracts · §7 persistence schema
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_VENDOR_SPECS,
  HttpClient,
  CookieAuthSession,
} = require("@chainlesschain/personal-data-hub/adapters/ai-chat-history");

const {
  createAIChatWizardController,
} = require("./aichat-wizard-controller.js");

const ACCOUNTS_FILE = "aichat-accounts.json";

// Disk-side name of the persist-aichat-<vendor> session dir. Electron sanitizes
// the `:` in partition names to `-` when materializing them on disk under
// `<userData>/Partitions/`, so the controller's logical `persist:aichat-<v>`
// becomes `persist-aichat-<v>` on the filesystem. The startup sweep converts
// the disk form back to the controller's form before calling cleanup.
const DISK_PARTITION_PREFIX = "persist-aichat-";
const LOGICAL_PARTITION_PREFIX = "persist:aichat-";

/**
 * Build a JSON-file-backed accountsStore. The file is opt-in lazy — we
 * neither create nor touch it until put() runs, so a desktop install that
 * never opens the wizard keeps zero footprint on disk.
 *
 * Concurrent writers in the same process are serialized via a tiny chain
 * promise. Cross-process safety is not a concern — only the Electron main
 * process writes here, cc ui has its own copy under its own data dir.
 */
function createAccountsStore({ hubDir, _fs = fs }) {
  if (!hubDir || typeof hubDir !== "string") {
    throw new Error("aichat-wizard-factory: hubDir required");
  }
  const filePath = path.join(hubDir, ACCOUNTS_FILE);
  let writeChain = Promise.resolve();

  function _readAll() {
    try {
      const raw = _fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return {};
      }
      // Corrupt file — treat as empty rather than crashing the wizard.
      return {};
    }
  }

  async function get(vendor) {
    const all = _readAll();
    return all[vendor] || null;
  }

  async function put(vendor, entry) {
    writeChain = writeChain.then(async () => {
      const all = _readAll();
      all[vendor] = entry;
      await _ensureDir(_fs, hubDir);
      // 0600 owner-only — same convention as email-accounts.json
      _fs.writeFileSync(filePath, JSON.stringify(all, null, 2), {
        mode: 0o600,
      });
    });
    return writeChain;
  }

  async function del(vendor) {
    writeChain = writeChain.then(async () => {
      const all = _readAll();
      if (!(vendor in all)) {
        return;
      }
      delete all[vendor];
      if (Object.keys(all).length === 0) {
        try {
          _fs.unlinkSync(filePath);
        } catch (_e) {
          /* missing file is fine */
        }
      } else {
        _fs.writeFileSync(filePath, JSON.stringify(all, null, 2), {
          mode: 0o600,
        });
      }
    });
    return writeChain;
  }

  async function list() {
    return Object.values(_readAll());
  }

  return { get, put, delete: del, list, _filePath: filePath };
}

/**
 * Convert a `{ name: value }` jar (the wizard's persistence form) into the
 * `Array<{name, value}>` shape CookieAuthSession expects. Accepts the same
 * three tolerant inputs as classifyProbedCookies (object / array / "k=v;"
 * string) so the bridge stays unaware of which path called it.
 */
function _jarToArray(input) {
  if (Array.isArray(input)) {
    return input.filter(
      (c) => c && typeof c.name === "string" && typeof c.value === "string",
    );
  }
  if (typeof input === "string") {
    const out = [];
    for (const pair of input.split(/;\s*/)) {
      const idx = pair.indexOf("=");
      if (idx <= 0) {
        continue;
      }
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name && value) {
        out.push({ name, value });
      }
    }
    return out;
  }
  if (input && typeof input === "object") {
    const out = [];
    for (const [name, value] of Object.entries(input)) {
      if (typeof value === "string" && value.length > 0) {
        out.push({ name, value });
      }
    }
    return out;
  }
  return [];
}

function _ensureDir(_fs, dir) {
  try {
    _fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    if (!err || err.code !== "EEXIST") {
      throw err;
    }
  }
}

/**
 * Build the vendorAdapter contract the wizard expects. We don't need the
 * full AIChatHistoryAdapter ingest pipeline at register-time — only
 * `validateCookie`. Sync / ingest stays the responsibility of the existing
 * `register-aichat` IPC path once Wizard registration succeeds.
 */
function createVendorAdapterBridge({
  specs = DEFAULT_VENDOR_SPECS,
  runtimeAdapter,
  _httpClientFactory,
} = {}) {
  // DEFAULT_VENDOR_SPECS is shipped as a vendor-keyed object; tests pass an
  // array. Normalize first so byVendor lookup works either way.
  const arr = Array.isArray(specs)
    ? specs
    : specs && typeof specs === "object"
      ? Object.values(specs)
      : null;
  if (!arr || arr.length === 0) {
    throw new Error("aichat-wizard-factory: specs required");
  }
  const byVendor = new Map();
  for (const s of arr) {
    if (s && typeof s.name === "string") {
      byVendor.set(s.name, s);
    }
  }

  const buildClient =
    _httpClientFactory ||
    ((vendor, spec) =>
      new HttpClient({
        vendor,
        rateLimits: spec.rateLimits,
      }));

  async function registerVendor(vendor, cookies, _opts = {}) {
    const spec = byVendor.get(vendor);
    if (!spec) {
      return { ok: false, reason: "UNKNOWN_VENDOR" };
    }
    if (typeof spec.validateCookie !== "function") {
      // Defensive — every shipped spec implements validateCookie; this guards
      // a future contributor accidentally dropping it.
      return { ok: false, reason: "SPEC_MISSING_VALIDATE_COOKIE" };
    }

    let client;
    try {
      client = buildClient(vendor, spec);
    } catch (err) {
      return {
        ok: false,
        reason: "HTTP_CLIENT_INIT_FAILED",
        error: err.message,
      };
    }

    // Build a CookieAuthSession from the plain jar. CookieAuthSession
    // wants Array<{name,value}>, so we materialize the entries here. We
    // can't bind to a real upstream domain because cookies span multiple
    // subdomains — validateCookie internally hits its USER_INFO_PATH
    // against BASE.
    const jarArray = _jarToArray(cookies);
    const session = new CookieAuthSession({
      vendor,
      cookies: jarArray,
    });

    try {
      const r = await spec.validateCookie({ httpClient: client, session });
      // validateCookie returns { ok, userId?, reason? }. Once valid, attach
      // the exact same session to the registry-owned runtime adapter so the
      // newly registered account can sync immediately without an app restart.
      const result = r || { ok: false, reason: "VALIDATE_RETURNED_NULL" };
      if (
        result.ok &&
        runtimeAdapter &&
        typeof runtimeAdapter.setSession === "function"
      ) {
        runtimeAdapter.setSession(vendor, session);
      }
      return result;
    } catch (err) {
      return { ok: false, reason: "VALIDATE_THREW", error: err.message };
    }
  }

  return { registerVendor };
}

/**
 * Scan Electron's userData/Partitions/ directory for `persist-aichat-*`
 * subdirectories and return them in the controller's logical
 * `persist:aichat-<vendor>` form. Returns `[]` (not an error) if the
 * Partitions directory does not exist — that is the expected state on a
 * fresh install with no wizard runs yet.
 *
 * Reference: Trap T8 — wizard crashes mid-login → partition cookies linger
 * forever. Mitigation requires the disk scan because Electron does not
 * expose a "list partitions" API.
 */
function _scanAichatPartitions({ userDataDir, _fs = fs } = {}) {
  if (!userDataDir || typeof userDataDir !== "string") {
    return [];
  }
  const partitionsDir = path.join(userDataDir, "Partitions");
  let entries;
  try {
    entries = _fs.readdirSync(partitionsDir, { withFileTypes: true });
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return [];
    }
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    // Tolerate string entries (older fs polyfills) — readdirSync with
    // withFileTypes returns Dirent in production but tests may pass a plain
    // array of strings via `_fs`.
    const name = typeof entry === "string" ? entry : entry && entry.name;
    if (!name || typeof name !== "string") {
      continue;
    }
    if (!name.startsWith(DISK_PARTITION_PREFIX)) {
      continue;
    }
    if (
      typeof entry === "object" &&
      entry &&
      typeof entry.isDirectory === "function" &&
      !entry.isDirectory()
    ) {
      continue;
    }
    const vendor = name.slice(DISK_PARTITION_PREFIX.length);
    if (!vendor) {
      continue;
    }
    out.push(LOGICAL_PARTITION_PREFIX + vendor);
  }
  return out;
}

/**
 * One-shot startup sweep that drives Trap T8 mitigation:
 *   1) enumerate disk partitions matching `persist-aichat-*`
 *   2) hand the logical names to controller.cleanupOrphanPartitions, which
 *      wipes cookies for any partition whose vendor is not in accounts.json
 *
 * Never throws — failure is logged and swallowed so the wizard remains usable
 * even if Partitions/ is unreadable. Returns `{ ok, swept, cleared }` for
 * tests and telemetry.
 */
async function runStartupCleanup({
  controller,
  userDataDir,
  _fs = fs,
  _logger,
} = {}) {
  if (!controller || typeof controller.cleanupOrphanPartitions !== "function") {
    return { ok: false, reason: "NO_CONTROLLER", swept: [], cleared: [] };
  }
  const log = _logger || {
    info: (...a) => console.info("[aichat-wizard-factory]", ...a),
    warn: (...a) => console.warn("[aichat-wizard-factory]", ...a),
    error: (...a) => console.error("[aichat-wizard-factory]", ...a),
  };
  let swept = [];
  try {
    swept = _scanAichatPartitions({ userDataDir, _fs });
  } catch (err) {
    log.warn("runStartupCleanup: partition scan failed", err.message);
    return {
      ok: false,
      reason: "SCAN_FAILED",
      error: err.message,
      swept: [],
      cleared: [],
    };
  }
  if (swept.length === 0) {
    return { ok: true, swept: [], cleared: [] };
  }
  try {
    const result = await controller.cleanupOrphanPartitions({
      partitions: swept,
    });
    return { ok: true, swept, cleared: (result && result.cleared) || [] };
  } catch (err) {
    log.warn("runStartupCleanup: cleanupOrphanPartitions threw", err.message);
    return {
      ok: false,
      reason: "CLEANUP_THREW",
      error: err.message,
      swept,
      cleared: [],
    };
  }
}

/**
 * Resolve Electron userData dir lazily so plain-Node tests don't trip the
 * `require("electron")` side effect.
 */
function _resolveUserDataDir() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron");
    if (
      electron &&
      electron.app &&
      typeof electron.app.getPath === "function"
    ) {
      return electron.app.getPath("userData");
    }
  } catch (_err) {
    /* Electron not available — tests run in plain Node */
  }
  return null;
}

/**
 * Wizard singleton factory. Constructs accountsStore + bridge + controller
 * once per hubDir. Used by the IPC layer:
 *
 *   const wiz = getAIChatWizard({ hubDir: hub.hubDir });
 *   await wiz.openVendorLogin({ vendor });
 *
 * Tests pass `_deps` for per-test isolation; production callers only pass
 * `{ hubDir }` and let the factory wire Electron `session` automatically.
 *
 * On the FIRST production-mode construction per hubDir (singleton cache
 * miss, no test injection), fires a one-shot `runStartupCleanup` to mitigate
 * Trap T8 (orphan partition cookies from crashed wizards). The sweep is
 * fire-and-forget — the wizard is usable immediately and the sweep only
 * affects subsequent vendor-login flows that would otherwise hit stale state.
 * Tests pass `_skipStartupCleanup: true` (or any test injection) to suppress.
 */
const _wizardsByHubDir = new Map();
function getAIChatWizard({
  hubDir,
  accountsStore,
  vendorAdapter,
  _deps,
  _accountsStore,
  _vendorAdapter,
  _fs: _fsInject,
  _skipStartupCleanup,
  _userDataDir,
} = {}) {
  if (!hubDir) {
    throw new Error("aichat-wizard-factory: hubDir required");
  }
  const isTestInject = !!(_deps || _accountsStore || _vendorAdapter);
  if (_wizardsByHubDir.has(hubDir) && !isTestInject) {
    return _wizardsByHubDir.get(hubDir);
  }
  const effectiveAccountsStore =
    accountsStore ||
    _accountsStore ||
    createAccountsStore({ hubDir, _fs: _fsInject });
  const effectiveVendorAdapter =
    vendorAdapter || _vendorAdapter || createVendorAdapterBridge();
  const controller = createAIChatWizardController({
    accountsStore: effectiveAccountsStore,
    vendorAdapter: effectiveVendorAdapter,
    _deps,
  });
  // Don't cache test-injected instances — only production singletons.
  if (!isTestInject) {
    _wizardsByHubDir.set(hubDir, controller);
    // First production singleton for this hubDir — fire Trap T8 sweep.
    // Off the hot path: don't await; failure is non-fatal.
    if (!_skipStartupCleanup) {
      const userDataDir = _userDataDir || _resolveUserDataDir();
      if (userDataDir) {
        Promise.resolve()
          .then(() =>
            runStartupCleanup({ controller, userDataDir, _fs: _fsInject }),
          )
          .catch((err) => {
            // runStartupCleanup already swallows internally; this is belt-and-braces
            // in case a later refactor lets something escape.
            // eslint-disable-next-line no-console
            console.warn(
              "[aichat-wizard-factory] startup cleanup error (ignored):",
              err && err.message,
            );
          });
      }
    }
  }
  return controller;
}

function _resetForTests() {
  _wizardsByHubDir.clear();
}

module.exports = {
  createAccountsStore,
  createVendorAdapterBridge,
  getAIChatWizard,
  runStartupCleanup,
  ACCOUNTS_FILE,
  _resetForTests,
  _internal: { _jarToArray, _scanAichatPartitions, _resolveUserDataDir },
};
