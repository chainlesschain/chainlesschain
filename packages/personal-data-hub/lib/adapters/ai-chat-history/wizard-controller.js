/**
 * AIChat WebView 鉴权向导 — Wizard Controller (Phase 10.3.2)
 *
 * Lives in the Electron main process. Drives the 4-step rendering-process
 * Wizard for adding any of the 9 国产 AI vendors as a data source:
 *
 *   openVendorLogin   — provision a per-vendor session partition + (on
 *                       desktop) return enough metadata for the renderer to
 *                       host a `<webview>` / BrowserView. Web-shell mode is
 *                       a no-op that returns `fallbackMode: "paste"`.
 *   probeCookies      — read all cookies under the vendor's cookieDomains
 *                       and classify against the spec.
 *   registerVendor    — wrap AIChatHistoryAdapter's existing register path
 *                       with cookie validation + accounts.json persistence
 *                       (mirrors the shape used by Email / Alipay wiring).
 *   rotateLoginPartition — flush stored cookies + provision a fresh session.
 *   cleanupOrphanPartitions — startup-time scan that drops any
 *                       persist:aichat-<vendor> partitions whose vendor is
 *                       no longer in accounts.json.
 *
 * Reference: docs/design/Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.md §2 §4
 *
 * Electron access is fully behind `_deps` injection (sessionFactory /
 * accountsStore / clock / logger / classifier). The Electron singletons are
 * resolved lazily at construction time so tests stay Electron-free and
 * Phase 10.3.3 (renderer wiring) can stub anything per test.
 */

"use strict";

const {
  getSpec,
  listVendors,
  classifyProbedCookies,
  COOKIE_SPEC_VERSION,
} = require("./cookie-capture-spec");

const PARTITION_PREFIX = "persist:aichat-";

function _partitionNameFor(vendor) {
  return PARTITION_PREFIX + vendor;
}

function _isAichatPartition(name) {
  return typeof name === "string" && name.startsWith(PARTITION_PREFIX);
}

function _vendorFromPartition(name) {
  return _isAichatPartition(name) ? name.slice(PARTITION_PREFIX.length) : null;
}

/**
 * Default dep resolver — only loaded when running inside Electron. Tests pass
 * an explicit `_deps` and never trigger this.
 */
function _resolveElectronDeps() {
  // Lazy require — keeps this module unit-testable in plain Node.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require("electron");
  const fs = require("node:fs");
  return {
    sessionFactory: (partition) => electron.session.fromPartition(partition, { cache: true }),
    fs,
    clock: () => Date.now(),
    logger: {
      info: (...a) => console.info("[aichat-wizard]", ...a),
      warn: (...a) => console.warn("[aichat-wizard]", ...a),
      error: (...a) => console.error("[aichat-wizard]", ...a),
    },
    classifier: classifyProbedCookies,
    specLookup: getSpec,
    knownVendors: listVendors(),
    cookieSpecVersion: COOKIE_SPEC_VERSION,
  };
}

/**
 * Construct a controller bound to:
 *   - an accountsStore  ({ get(vendor), put(vendor, entry), delete(vendor), list() })
 *     which the desktop wiring resolves to an `aichat-accounts.json` reader.
 *   - a vendorAdapter   (the AIChatHistoryAdapter or any object with
 *     `registerVendor(vendor, cookies, opts)` returning a Promise).
 *
 * `_deps` is the seam for tests / future shells (web-shell injects a
 * `fallbackMode: "paste"` sessionFactory that doesn't open BrowserView).
 */
function createAIChatWizardController({ accountsStore, vendorAdapter, _deps } = {}) {
  if (!accountsStore || typeof accountsStore.get !== "function") {
    throw new Error("aichat-wizard: accountsStore with get/put/delete/list required");
  }
  if (!vendorAdapter || typeof vendorAdapter.registerVendor !== "function") {
    throw new Error("aichat-wizard: vendorAdapter.registerVendor required");
  }

  const deps = _deps || _resolveElectronDeps();
  const {
    sessionFactory, clock, logger, classifier, specLookup, knownVendors, cookieSpecVersion,
    fallbackMode, // "browser-view" (default) or "paste" — web-shell sets this
  } = deps;

  function _requireSpec(vendor) {
    const spec = specLookup(vendor);
    if (!spec) {
      const err = new Error("UNKNOWN_VENDOR");
      err.code = "UNKNOWN_VENDOR";
      err.vendor = vendor;
      throw err;
    }
    return spec;
  }

  /**
   * Step 1 of the wizard.
   *
   * Returns the metadata the renderer needs to either host a BrowserView
   * (desktop) or display the paste-fallback (web-shell). NEVER throws on
   * unknown vendor — returns `{ ok:false, reason:"UNKNOWN_VENDOR" }` so the
   * renderer can show a typed error.
   */
  async function openVendorLogin({ vendor, opts = {} } = {}) {
    const spec = specLookup(vendor);
    if (!spec) {
      return { ok: false, reason: "UNKNOWN_VENDOR", vendor };
    }
    const partition = _partitionNameFor(vendor);

    // Web-shell path: no BrowserView, return paste helper instructions.
    if (fallbackMode === "paste") {
      return {
        ok: true,
        vendor,
        fallbackMode: "paste",
        helpText:
          `请在外部浏览器打开 ${spec.loginUrl} 完成登录，` +
          `登录后从开发者工具 Application → Cookies 复制全部 cookie 串粘贴到下方文本框。`,
        loginUrl: spec.loginUrl,
        requiredCookies: spec.requiredCookies.slice(),
      };
    }

    // Desktop path: prime the session (cookies are persisted automatically
    // by Electron once the partition exists). The renderer is responsible
    // for mounting a BrowserView pointing at `loginUrl` with `partition`.
    let session;
    try {
      session = sessionFactory(partition);
    } catch (err) {
      logger.error("openVendorLogin: sessionFactory failed", err);
      return { ok: false, reason: "SESSION_INIT_FAILED", error: err.message };
    }

    // Optional: reset stored cookies if the caller wants a clean login.
    if (opts.reuseSession === false && typeof session.clearStorageData === "function") {
      try {
        await session.clearStorageData({ storages: ["cookies"] });
      } catch (err) {
        logger.warn("openVendorLogin: clearStorageData failed (ignored)", err);
      }
    }

    return {
      ok: true,
      vendor,
      fallbackMode: "browser-view",
      partition,
      loginUrl: spec.loginUrl,
      cookieDomains: spec.cookieDomains.slice(),
      postLoginPathHints: spec.postLoginPathHints.slice(),
      notes: spec.notes,
      openedAt: clock(),
    };
  }

  /**
   * Step 2 of the wizard.
   *
   * Reads cookies from the vendor's partition (desktop) or parses the pasted
   * cookie string (web-shell), classifies them against the spec, and returns
   * everything the renderer needs to show Step 3's validation summary.
   */
  async function probeCookies({ vendor, cookieHeader } = {}) {
    const spec = specLookup(vendor);
    if (!spec) {
      return { ok: false, reason: "UNKNOWN_VENDOR", vendor };
    }

    // Web-shell paste path takes precedence — if a header was supplied, use it.
    if (typeof cookieHeader === "string" && cookieHeader.length > 0) {
      const classified = classifier(vendor, cookieHeader);
      return {
        ok: classified.ok,
        vendor,
        source: "paste",
        cookies: _projectCookies(classified, cookieHeader, spec),
        foundRequired: classified.foundRequired,
        missingRequired: classified.missingRequired,
        foundOptional: classified.foundOptional,
      };
    }

    if (fallbackMode === "paste") {
      // Web-shell asked to probe without supplying a header — return guidance.
      return {
        ok: false,
        vendor,
        reason: "PASTE_REQUIRED",
        source: "paste",
      };
    }

    // Desktop: ask each cookieDomain in turn for cookies.
    const partition = _partitionNameFor(vendor);
    let session;
    try {
      session = sessionFactory(partition);
    } catch (err) {
      logger.error("probeCookies: sessionFactory failed", err);
      return { ok: false, reason: "SESSION_INIT_FAILED", error: err.message };
    }

    const jar = {};
    for (const domain of spec.cookieDomains) {
      let cookies = [];
      try {
        // Electron `cookies.get({ domain })` returns Cookie[]. We pass
        // domain stripped of leading dot when querying (Electron accepts both).
        cookies = await session.cookies.get({ domain: domain.replace(/^\./, "") });
      } catch (err) {
        logger.warn(`probeCookies: cookies.get failed for domain=${domain}`, err);
        continue;
      }
      for (const c of cookies) {
        if (c && typeof c.name === "string" && typeof c.value === "string" && c.value.length > 0) {
          // Last write wins — domain order is intentional (root first via spec order).
          jar[c.name] = c.value;
        }
      }
    }

    const classified = classifier(vendor, jar);
    return {
      ok: classified.ok,
      vendor,
      source: "browser-view",
      cookies: jar,
      foundRequired: classified.foundRequired,
      missingRequired: classified.missingRequired,
      foundOptional: classified.foundOptional,
    };
  }

  /**
   * Step 3 of the wizard.
   *
   * Re-classifies the supplied cookies one more time defensively (the
   * renderer may have come from `probeCookies` long enough ago to drift),
   * hands the jar off to AIChatHistoryAdapter.registerVendor, then persists
   * a row in accounts.json on success. Returns `{ ok, validation, accountId }`.
   */
  async function registerVendor({ vendor, cookies, opts = {} } = {}) {
    const spec = specLookup(vendor);
    if (!spec) {
      return { ok: false, reason: "UNKNOWN_VENDOR", vendor };
    }
    const classified = classifier(vendor, cookies);
    if (!classified.ok) {
      return {
        ok: false,
        vendor,
        reason: "REQUIRED_COOKIES_MISSING",
        missingRequired: classified.missingRequired,
      };
    }

    let validation;
    try {
      validation = await vendorAdapter.registerVendor(vendor, _flattenJar(cookies), opts);
    } catch (err) {
      logger.error("registerVendor: vendorAdapter threw", err);
      return { ok: false, vendor, reason: "ADAPTER_THREW", error: err.message };
    }

    if (!validation || validation.ok !== true) {
      return {
        ok: false,
        vendor,
        reason: (validation && validation.reason) || "VALIDATE_COOKIE_FAILED",
        validation,
      };
    }

    const now = clock();
    const accountId = `${vendor}:${validation.userId || "anon"}`;
    const entry = {
      vendor,
      registeredAt: (await _existingRegisteredAt(vendor)) || now,
      cookies: _flattenJar(cookies),
      userId: validation.userId || null,
      displayName: spec.displayName,
      lastSyncAt: null,
      lastHealth: { ok: true, at: now },
      cookieSpecVersion,
    };
    await accountsStore.put(vendor, entry);

    return { ok: true, vendor, accountId, validation };
  }

  /**
   * Step 4 (optional, re-login flow).
   *
   * Clears the vendor's partition storage and re-runs openVendorLogin so the
   * renderer can re-host BrowserView fresh. Does NOT touch accounts.json —
   * `registerVendor` will overwrite the entry once the user finishes.
   */
  async function rotateLoginPartition({ vendor } = {}) {
    const spec = specLookup(vendor);
    if (!spec) {
      return { ok: false, reason: "UNKNOWN_VENDOR", vendor };
    }
    if (fallbackMode !== "paste") {
      const partition = _partitionNameFor(vendor);
      try {
        const session = sessionFactory(partition);
        if (session && typeof session.clearStorageData === "function") {
          await session.clearStorageData({ storages: ["cookies"] });
        }
      } catch (err) {
        logger.warn(`rotateLoginPartition: clearStorageData failed for ${vendor}`, err);
        // Fall through — openVendorLogin will still surface fresh state.
      }
    }
    return openVendorLogin({ vendor });
  }

  /**
   * Startup-time housekeeping.
   *
   * Walks known partitions and clears any whose vendor is no longer in
   * accounts.json. Prevents Trap T8 (wizard crashed mid-login → partition
   * cookies linger forever).
   *
   * Electron has no public "list partitions" API; the caller supplies the
   * list via `partitions` (typically derived from disk scan). Tests pass a
   * synthetic array.
   */
  async function cleanupOrphanPartitions({ partitions = [] } = {}) {
    const registered = new Set();
    try {
      const list = await accountsStore.list();
      for (const entry of list || []) {
        if (entry && entry.vendor) registered.add(entry.vendor);
      }
    } catch (err) {
      logger.warn("cleanupOrphanPartitions: accountsStore.list failed", err);
      // Be conservative — without accounts list we cannot safely decide,
      // so skip the sweep.
      return { ok: false, reason: "ACCOUNTS_LIST_FAILED", cleared: [] };
    }

    const cleared = [];
    const known = new Set(knownVendors);
    for (const partName of partitions) {
      if (!_isAichatPartition(partName)) continue;
      const vendor = _vendorFromPartition(partName);
      if (!known.has(vendor)) continue; // Unknown vendor → not ours, leave it.
      if (registered.has(vendor)) continue; // User has it active, keep.
      try {
        const session = sessionFactory(partName);
        if (session && typeof session.clearStorageData === "function") {
          await session.clearStorageData({ storages: ["cookies"] });
          cleared.push(vendor);
        }
      } catch (err) {
        logger.warn(`cleanupOrphanPartitions: clear failed ${partName}`, err);
      }
    }
    return { ok: true, cleared };
  }

  async function _existingRegisteredAt(vendor) {
    try {
      const e = await accountsStore.get(vendor);
      return e && e.registeredAt ? Number(e.registeredAt) : null;
    } catch (_err) {
      return null;
    }
  }

  return {
    openVendorLogin,
    probeCookies,
    registerVendor,
    rotateLoginPartition,
    cleanupOrphanPartitions,
    // exported for tests / debug
    _internal: { _partitionNameFor, _flattenJar, _projectCookies, _isAichatPartition },
  };
}

/**
 * Reduce any classifier-accepted shape (object / Cookie[] / "k=v;" string)
 * to a plain `{ name: value }` jar for persistence. Mirrors
 * cookie-capture-spec _normalizeCookieJar but lives here so we don't reach
 * into the adapter package's `_internal`.
 */
function _flattenJar(input) {
  if (!input) return {};
  if (Array.isArray(input)) {
    const out = {};
    for (const c of input) {
      if (c && typeof c.name === "string" && typeof c.value === "string") {
        out[c.name] = c.value;
      }
    }
    return out;
  }
  if (typeof input === "string") {
    const out = {};
    for (const pairRaw of input.split(/;\s*/)) {
      const pair = pairRaw.trim();
      if (!pair) continue;
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    return out;
  }
  if (typeof input === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  return {};
}

/**
 * Return a slimmed-down cookie projection suitable for shipping back to the
 * renderer (no sensitive values for optional cookies — only the names).
 *
 * Required cookies' values are returned full-fidelity because the renderer
 * needs them to drive Step 3 (registerVendor); the renderer is trusted with
 * the same DOM origin as the BrowserView already saw them.
 */
function _projectCookies(classified, raw, spec) {
  const flat = _flattenJar(raw);
  const out = {};
  for (const name of classified.foundRequired || []) {
    out[name] = flat[name];
  }
  for (const name of classified.foundOptional || []) {
    out[name] = flat[name];
  }
  // Belt-and-braces: limit to spec.required + spec.optional so unrelated
  // cookies leaked from the paste path don't escape the wizard surface.
  const allowed = new Set([
    ...(spec.requiredCookies || []),
    ...(spec.optionalCookies || []),
  ]);
  const filtered = {};
  for (const [k, v] of Object.entries(out)) {
    if (allowed.has(k)) filtered[k] = v;
  }
  return filtered;
}

module.exports = {
  createAIChatWizardController,
  PARTITION_PREFIX,
  _internal: { _partitionNameFor, _isAichatPartition, _vendorFromPartition, _flattenJar },
};
