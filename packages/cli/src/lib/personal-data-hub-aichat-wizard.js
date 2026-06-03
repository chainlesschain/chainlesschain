/**
 * AIChat WebView 鉴权向导 — cli / web-shell wiring (Phase 10.3.4).
 *
 * Mirrors `desktop-app-vue/src/main/personal-data-hub/aichat-wizard-factory.js`
 * for the cli + web-shell side. Two structural differences from desktop:
 *
 *   1) `fallbackMode: "paste"` is hard-wired — cc ui does NOT have a
 *      BrowserView, so the wizard always returns the paste fallback shape.
 *
 *   2) Accounts store path lives under `getHub().hubDir`, same JSON file
 *      shape as desktop (`aichat-accounts.json`). Same hub directory on
 *      the same machine means desktop / cc ui share registered vendors
 *      (per the memo about WAL sharing — same caveat applies).
 *
 * Reference: docs/design/Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.md §2 §11
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

// Lazy-load `@chainlesschain/personal-data-hub/adapters/ai-chat-history` —
// older nested copies of the hub package (e.g. PDH 0.2.0 left in
// `packages/cli/node_modules/@chainlesschain/personal-data-hub/` by a stale
// install) lack this subpath export. A static ESM import would crash the
// whole wiring chain at module load time; lazy `_require` lets the error
// surface only when actually called, and tolerates an older nested copy as
// long as Node's resolution eventually walks up to a version that exports
// the subpath. See sibling lazy-load at line 217 / 228 for cookie-capture-
// spec + wizard-controller (same defence).
let _aichatModule = null;
function _loadAichatModule() {
  if (_aichatModule) return _aichatModule;
  _aichatModule = _require(
    "@chainlesschain/personal-data-hub/adapters/ai-chat-history",
  );
  return _aichatModule;
}

export const ACCOUNTS_FILE = "aichat-accounts.json";

/**
 * JSON file accountsStore (same on-disk shape as desktop). Async API but
 * implemented sync underneath — concurrent put() ops are chained.
 */
export function createAccountsStore({ hubDir }) {
  if (!hubDir || typeof hubDir !== "string") {
    throw new Error("aichat-wizard-cli: hubDir required");
  }
  const filePath = join(hubDir, ACCOUNTS_FILE);
  let writeChain = Promise.resolve();

  function _readAll() {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      if (err && err.code === "ENOENT") return {};
      return {};
    }
  }

  async function get(vendor) {
    return _readAll()[vendor] || null;
  }

  async function put(vendor, entry) {
    writeChain = writeChain.then(async () => {
      const all = _readAll();
      all[vendor] = entry;
      try {
        mkdirSync(hubDir, { recursive: true, mode: 0o700 });
      } catch (err) {
        if (!err || err.code !== "EEXIST") throw err;
      }
      writeFileSync(filePath, JSON.stringify(all, null, 2), { mode: 0o600 });
    });
    return writeChain;
  }

  async function del(vendor) {
    writeChain = writeChain.then(async () => {
      const all = _readAll();
      if (!(vendor in all)) return;
      delete all[vendor];
      if (Object.keys(all).length === 0) {
        try {
          unlinkSync(filePath);
        } catch (_e) {
          /* missing is fine */
        }
      } else {
        writeFileSync(filePath, JSON.stringify(all, null, 2), { mode: 0o600 });
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
 * Same bridge as desktop — translates wizard.registerVendor() into
 * spec.validateCookie(). Kept duplicated so the cli build stays ESM-pure
 * without reaching into desktop-app-vue.
 */
export function createVendorAdapterBridge({ specs, _httpClientFactory } = {}) {
  // DEFAULT_VENDOR_SPECS is shipped as a vendor-keyed object; tests pass an
  // array. Normalize to an array first so byVendor lookup works either way.
  const effectiveSpecs = specs ?? _loadAichatModule().DEFAULT_VENDOR_SPECS;
  const arr = Array.isArray(effectiveSpecs)
    ? effectiveSpecs
    : effectiveSpecs && typeof effectiveSpecs === "object"
      ? Object.values(effectiveSpecs)
      : null;
  if (!arr || arr.length === 0) {
    throw new Error("aichat-wizard-cli: specs required");
  }
  const byVendor = new Map();
  for (const s of arr) {
    if (s && typeof s.name === "string") byVendor.set(s.name, s);
  }
  const buildClient =
    _httpClientFactory ||
    ((vendor, spec) => {
      const { HttpClient } = _loadAichatModule();
      return new HttpClient({ vendor, rateLimits: spec.rateLimits });
    });

  async function registerVendor(vendor, cookies, _opts = {}) {
    const spec = byVendor.get(vendor);
    if (!spec) return { ok: false, reason: "UNKNOWN_VENDOR" };
    if (typeof spec.validateCookie !== "function") {
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
    const { CookieAuthSession } = _loadAichatModule();
    const session = new CookieAuthSession({
      vendor,
      cookies: _jarToArray(cookies),
    });
    try {
      const r = await spec.validateCookie({ httpClient: client, session });
      return r || { ok: false, reason: "VALIDATE_RETURNED_NULL" };
    } catch (err) {
      return { ok: false, reason: "VALIDATE_THREW", error: err.message };
    }
  }

  return { registerVendor };
}

export function _jarToArray(input) {
  if (Array.isArray(input)) {
    return input.filter(
      (c) => c && typeof c.name === "string" && typeof c.value === "string",
    );
  }
  if (typeof input === "string") {
    const out = [];
    for (const pair of input.split(/;\s*/)) {
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name && value) out.push({ name, value });
    }
    return out;
  }
  if (input && typeof input === "object") {
    const out = [];
    for (const [name, value] of Object.entries(input)) {
      if (typeof value === "string" && value.length > 0)
        out.push({ name, value });
    }
    return out;
  }
  return [];
}

const _wizardsByHubDir = new Map();

/**
 * cli-side wizard singleton. Always builds in `fallbackMode: "paste"` —
 * cc ui never opens a BrowserView. Tests substitute `_accountsStore` and
 * `_vendorAdapter` for hermetic runs.
 */
export function getAIChatWizard({
  hubDir,
  _accountsStore,
  _vendorAdapter,
  _deps,
} = {}) {
  if (!hubDir) throw new Error("aichat-wizard-cli: hubDir required");
  const isTest = !!(_accountsStore || _vendorAdapter || _deps);
  if (!isTest && _wizardsByHubDir.has(hubDir))
    return _wizardsByHubDir.get(hubDir);

  const accountsStore = _accountsStore || createAccountsStore({ hubDir });
  const vendorAdapter = _vendorAdapter || createVendorAdapterBridge();
  // Paste-mode is the default for cli. Tests can override via _deps.
  const deps = _deps || {
    sessionFactory: () => ({}),
    clock: () => Date.now(),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    fallbackMode: "paste",
  };
  if (deps && !deps.fallbackMode) deps.fallbackMode = "paste";
  // The controller resolves classifier / specLookup / knownVendors itself
  // when _deps doesn't supply them — but since we ARE supplying _deps, we
  // must fill those slots too. Re-import the spec module to avoid coupling
  // tests to those exact defaults.
  if (!deps.classifier || !deps.specLookup) {
    // Lazy require to keep top-of-file clean.
    const spec = _require(
      "@chainlesschain/personal-data-hub/adapters/ai-chat-history/cookie-capture-spec",
    );
    deps.classifier = deps.classifier || spec.classifyProbedCookies;
    deps.specLookup = deps.specLookup || spec.getSpec;
    deps.knownVendors = deps.knownVendors || spec.listVendors();
    deps.cookieSpecVersion = deps.cookieSpecVersion || spec.COOKIE_SPEC_VERSION;
  }
  // Lazy require (same pattern as cookie-capture-spec above) — keeps
  // module-load tolerant of older @chainlesschain/personal-data-hub
  // versions that don't yet export this subpath.
  const { createAIChatWizardController } = _require(
    "@chainlesschain/personal-data-hub/adapters/ai-chat-history/wizard-controller",
  );
  const wiz = createAIChatWizardController({
    accountsStore,
    vendorAdapter,
    _deps: deps,
  });
  if (!isTest) _wizardsByHubDir.set(hubDir, wiz);
  return wiz;
}

export function _resetForTests() {
  _wizardsByHubDir.clear();
}
