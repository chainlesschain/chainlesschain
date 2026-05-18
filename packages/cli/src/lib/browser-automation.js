/**
 * Headless browser automation — fetch, scrape, and extract content from web pages.
 * Uses built-in fetch for basic operations, optional playwright for screenshots.
 */

/**
 * Fetch a URL and return the raw HTML.
 */
export async function fetchPage(url, options = {}) {
  const timeout = options.timeout || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {
      "User-Agent": "ChainlessChain-CLI/0.37.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const html = await response.text();

    return {
      url: response.url,
      status: response.status,
      contentType,
      html,
      size: html.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract text content from HTML, stripping tags.
 */
export function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/**
 * Extract page title from HTML.
 */
export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim().replace(/\s+/g, " ") : "";
}

/**
 * Extract meta description from HTML.
 */
export function extractMeta(html) {
  const descMatch =
    html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']*?)["']/i,
    ) ||
    html.match(/<meta\s+content=["']([^"']*?)["']\s+name=["']description["']/i);
  return descMatch ? descMatch[1] : "";
}

/**
 * Extract elements matching a simple CSS selector.
 * Supports: tag, .class, #id, tag.class, tag#id
 */
export function querySelectorAll(html, selector) {
  const results = [];

  // Parse selector
  const tagMatch = selector.match(/^(\w+)/);
  const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);

  const tag = tagMatch ? tagMatch[1] : null;
  const className = classMatch ? classMatch[1] : null;
  const id = idMatch ? idMatch[1] : null;

  // Build regex pattern
  let pattern;
  if (tag) {
    pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  } else if (className || id) {
    pattern = new RegExp(`<\\w+[^>]*>([\\s\\S]*?)<\\/\\w+>`, "gi");
  } else {
    return results;
  }

  let match;
  while ((match = pattern.exec(html)) !== null) {
    const fullTag = match[0];

    // Check class filter
    if (className) {
      const classAttr = fullTag.match(/class=["']([^"']*?)["']/i);
      if (!classAttr || !classAttr[1].split(/\s+/).includes(className))
        continue;
    }

    // Check id filter
    if (id) {
      const idAttr = fullTag.match(/id=["']([^"']*?)["']/i);
      if (!idAttr || idAttr[1] !== id) continue;
    }

    results.push({
      html: fullTag,
      text: extractText(fullTag),
    });
  }

  return results;
}

/**
 * Extract all links from HTML.
 */
export function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    const text = extractText(match[2]).trim();

    // Resolve relative URLs
    if (baseUrl && !href.startsWith("http")) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }

    if (text && href.startsWith("http")) {
      links.push({ href, text });
    }
  }

  return links;
}

/**
 * Take a screenshot using playwright (optional dependency).
 * Returns null if playwright is not installed.
 */
export async function takeScreenshot(url, outputPath, options = {}) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: {
        width: options.width || 1280,
        height: options.height || 720,
      },
    });

    await page.goto(url, {
      waitUntil: options.waitUntil || "networkidle",
      timeout: options.timeout || 30000,
    });

    await page.screenshot({
      path: outputPath,
      fullPage: options.fullPage || false,
    });

    await browser.close();
    return { success: true, path: outputPath };
  } catch (err) {
    if (
      err.code === "ERR_MODULE_NOT_FOUND" ||
      err.message?.includes("Cannot find")
    ) {
      return {
        success: false,
        error: "playwright not installed. Run: npm install -g playwright",
      };
    }
    throw err;
  }
}

// ===== V2 Surface: Browser Automation governance overlay (CLI v0.134.0) =====
export const BROWSE_TARGET_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  RETIRED: "retired",
});
export const BROWSE_ACTION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _brTargTrans = new Map([
  [
    BROWSE_TARGET_MATURITY_V2.PENDING,
    new Set([
      BROWSE_TARGET_MATURITY_V2.ACTIVE,
      BROWSE_TARGET_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    BROWSE_TARGET_MATURITY_V2.ACTIVE,
    new Set([
      BROWSE_TARGET_MATURITY_V2.DEGRADED,
      BROWSE_TARGET_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    BROWSE_TARGET_MATURITY_V2.DEGRADED,
    new Set([
      BROWSE_TARGET_MATURITY_V2.ACTIVE,
      BROWSE_TARGET_MATURITY_V2.RETIRED,
    ]),
  ],
  [BROWSE_TARGET_MATURITY_V2.RETIRED, new Set()],
]);
const _brTargTerminal = new Set([BROWSE_TARGET_MATURITY_V2.RETIRED]);
const _brActTrans = new Map([
  [
    BROWSE_ACTION_LIFECYCLE_V2.QUEUED,
    new Set([
      BROWSE_ACTION_LIFECYCLE_V2.RUNNING,
      BROWSE_ACTION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    BROWSE_ACTION_LIFECYCLE_V2.RUNNING,
    new Set([
      BROWSE_ACTION_LIFECYCLE_V2.COMPLETED,
      BROWSE_ACTION_LIFECYCLE_V2.FAILED,
      BROWSE_ACTION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [BROWSE_ACTION_LIFECYCLE_V2.COMPLETED, new Set()],
  [BROWSE_ACTION_LIFECYCLE_V2.FAILED, new Set()],
  [BROWSE_ACTION_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _brTargets = new Map();
const _brActions = new Map();
let _brMaxActivePerOwner = 8;
let _brMaxPendingPerTarget = 20;
let _brTargetIdleMs = 12 * 60 * 60 * 1000;
let _brActionStuckMs = 3 * 60 * 1000;

function _brPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveBrowseTargetsPerOwnerV2(n) {
  _brMaxActivePerOwner = _brPos(n, "maxActiveBrowseTargetsPerOwner");
}
export function getMaxActiveBrowseTargetsPerOwnerV2() {
  return _brMaxActivePerOwner;
}
export function setMaxPendingBrowseActionsPerTargetV2(n) {
  _brMaxPendingPerTarget = _brPos(n, "maxPendingBrowseActionsPerTarget");
}
export function getMaxPendingBrowseActionsPerTargetV2() {
  return _brMaxPendingPerTarget;
}
export function setBrowseTargetIdleMsV2(n) {
  _brTargetIdleMs = _brPos(n, "browseTargetIdleMs");
}
export function getBrowseTargetIdleMsV2() {
  return _brTargetIdleMs;
}
export function setBrowseActionStuckMsV2(n) {
  _brActionStuckMs = _brPos(n, "browseActionStuckMs");
}
export function getBrowseActionStuckMsV2() {
  return _brActionStuckMs;
}

export function _resetStateBrowserAutomationV2() {
  _brTargets.clear();
  _brActions.clear();
  _brMaxActivePerOwner = 8;
  _brMaxPendingPerTarget = 20;
  _brTargetIdleMs = 12 * 60 * 60 * 1000;
  _brActionStuckMs = 3 * 60 * 1000;
}

export function registerBrowseTargetV2({ id, owner, url, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_brTargets.has(id))
    throw new Error(`browse target ${id} already registered`);
  const now = Date.now();
  const t = {
    id,
    owner,
    url: url || "",
    status: BROWSE_TARGET_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _brTargets.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}
function _brCheckT(from, to) {
  const a = _brTargTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid browse target transition ${from} → ${to}`);
}
function _brCountActive(owner) {
  let n = 0;
  for (const t of _brTargets.values())
    if (t.owner === owner && t.status === BROWSE_TARGET_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateBrowseTargetV2(id) {
  const t = _brTargets.get(id);
  if (!t) throw new Error(`browse target ${id} not found`);
  _brCheckT(t.status, BROWSE_TARGET_MATURITY_V2.ACTIVE);
  const recovery = t.status === BROWSE_TARGET_MATURITY_V2.DEGRADED;
  if (!recovery) {
    const a = _brCountActive(t.owner);
    if (a >= _brMaxActivePerOwner)
      throw new Error(
        `max active browse targets per owner (${_brMaxActivePerOwner}) reached for ${t.owner}`,
      );
  }
  const now = Date.now();
  t.status = BROWSE_TARGET_MATURITY_V2.ACTIVE;
  t.updatedAt = now;
  t.lastTouchedAt = now;
  if (!t.activatedAt) t.activatedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function degradeBrowseTargetV2(id) {
  const t = _brTargets.get(id);
  if (!t) throw new Error(`browse target ${id} not found`);
  _brCheckT(t.status, BROWSE_TARGET_MATURITY_V2.DEGRADED);
  t.status = BROWSE_TARGET_MATURITY_V2.DEGRADED;
  t.updatedAt = Date.now();
  return { ...t, metadata: { ...t.metadata } };
}
export function retireBrowseTargetV2(id) {
  const t = _brTargets.get(id);
  if (!t) throw new Error(`browse target ${id} not found`);
  _brCheckT(t.status, BROWSE_TARGET_MATURITY_V2.RETIRED);
  const now = Date.now();
  t.status = BROWSE_TARGET_MATURITY_V2.RETIRED;
  t.updatedAt = now;
  if (!t.retiredAt) t.retiredAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function touchBrowseTargetV2(id) {
  const t = _brTargets.get(id);
  if (!t) throw new Error(`browse target ${id} not found`);
  if (_brTargTerminal.has(t.status))
    throw new Error(`cannot touch terminal browse target ${id}`);
  const now = Date.now();
  t.lastTouchedAt = now;
  t.updatedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function getBrowseTargetV2(id) {
  const t = _brTargets.get(id);
  if (!t) return null;
  return { ...t, metadata: { ...t.metadata } };
}
export function listBrowseTargetsV2() {
  return [..._brTargets.values()].map((t) => ({
    ...t,
    metadata: { ...t.metadata },
  }));
}

function _brCountPending(tid) {
  let n = 0;
  for (const a of _brActions.values())
    if (
      a.targetId === tid &&
      (a.status === BROWSE_ACTION_LIFECYCLE_V2.QUEUED ||
        a.status === BROWSE_ACTION_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createBrowseActionV2({ id, targetId, kind, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!targetId || typeof targetId !== "string")
    throw new Error("targetId is required");
  if (_brActions.has(id)) throw new Error(`browse action ${id} already exists`);
  if (!_brTargets.has(targetId))
    throw new Error(`browse target ${targetId} not found`);
  const pending = _brCountPending(targetId);
  if (pending >= _brMaxPendingPerTarget)
    throw new Error(
      `max pending browse actions per target (${_brMaxPendingPerTarget}) reached for ${targetId}`,
    );
  const now = Date.now();
  const a = {
    id,
    targetId,
    kind: kind || "fetch",
    status: BROWSE_ACTION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _brActions.set(id, a);
  return { ...a, metadata: { ...a.metadata } };
}
function _brCheckA(from, to) {
  const al = _brActTrans.get(from);
  if (!al || !al.has(to))
    throw new Error(`invalid browse action transition ${from} → ${to}`);
}
export function startBrowseActionV2(id) {
  const a = _brActions.get(id);
  if (!a) throw new Error(`browse action ${id} not found`);
  _brCheckA(a.status, BROWSE_ACTION_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  a.status = BROWSE_ACTION_LIFECYCLE_V2.RUNNING;
  a.updatedAt = now;
  if (!a.startedAt) a.startedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function completeBrowseActionV2(id) {
  const a = _brActions.get(id);
  if (!a) throw new Error(`browse action ${id} not found`);
  _brCheckA(a.status, BROWSE_ACTION_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  a.status = BROWSE_ACTION_LIFECYCLE_V2.COMPLETED;
  a.updatedAt = now;
  if (!a.settledAt) a.settledAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function failBrowseActionV2(id, reason) {
  const a = _brActions.get(id);
  if (!a) throw new Error(`browse action ${id} not found`);
  _brCheckA(a.status, BROWSE_ACTION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  a.status = BROWSE_ACTION_LIFECYCLE_V2.FAILED;
  a.updatedAt = now;
  if (!a.settledAt) a.settledAt = now;
  if (reason) a.metadata.failReason = String(reason);
  return { ...a, metadata: { ...a.metadata } };
}
export function cancelBrowseActionV2(id, reason) {
  const a = _brActions.get(id);
  if (!a) throw new Error(`browse action ${id} not found`);
  _brCheckA(a.status, BROWSE_ACTION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  a.status = BROWSE_ACTION_LIFECYCLE_V2.CANCELLED;
  a.updatedAt = now;
  if (!a.settledAt) a.settledAt = now;
  if (reason) a.metadata.cancelReason = String(reason);
  return { ...a, metadata: { ...a.metadata } };
}
export function getBrowseActionV2(id) {
  const a = _brActions.get(id);
  if (!a) return null;
  return { ...a, metadata: { ...a.metadata } };
}
export function listBrowseActionsV2() {
  return [..._brActions.values()].map((a) => ({
    ...a,
    metadata: { ...a.metadata },
  }));
}

export function autoDegradeIdleBrowseTargetsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const tg of _brTargets.values())
    if (
      tg.status === BROWSE_TARGET_MATURITY_V2.ACTIVE &&
      t - tg.lastTouchedAt >= _brTargetIdleMs
    ) {
      tg.status = BROWSE_TARGET_MATURITY_V2.DEGRADED;
      tg.updatedAt = t;
      flipped.push(tg.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckBrowseActionsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const a of _brActions.values())
    if (
      a.status === BROWSE_ACTION_LIFECYCLE_V2.RUNNING &&
      a.startedAt != null &&
      t - a.startedAt >= _brActionStuckMs
    ) {
      a.status = BROWSE_ACTION_LIFECYCLE_V2.FAILED;
      a.updatedAt = t;
      if (!a.settledAt) a.settledAt = t;
      a.metadata.failReason = "auto-fail-stuck";
      flipped.push(a.id);
    }
  return { flipped, count: flipped.length };
}

export function getBrowserAutomationStatsV2() {
  const targetsByStatus = {};
  for (const s of Object.values(BROWSE_TARGET_MATURITY_V2))
    targetsByStatus[s] = 0;
  for (const t of _brTargets.values()) targetsByStatus[t.status]++;
  const actionsByStatus = {};
  for (const s of Object.values(BROWSE_ACTION_LIFECYCLE_V2))
    actionsByStatus[s] = 0;
  for (const a of _brActions.values()) actionsByStatus[a.status]++;
  return {
    totalTargetsV2: _brTargets.size,
    totalActionsV2: _brActions.size,
    maxActiveBrowseTargetsPerOwner: _brMaxActivePerOwner,
    maxPendingBrowseActionsPerTarget: _brMaxPendingPerTarget,
    browseTargetIdleMs: _brTargetIdleMs,
    browseActionStuckMs: _brActionStuckMs,
    targetsByStatus,
    actionsByStatus,
  };
}

// =====================================================================
// browser-automation V2 governance overlay (iter20)
// =====================================================================
export const BAGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const BAGOV_NAVIGATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  NAVIGATING: "navigating",
  NAVIGATED: "navigated",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _bagovPTrans = new Map([
  [
    BAGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      BAGOV_PROFILE_MATURITY_V2.ACTIVE,
      BAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    BAGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      BAGOV_PROFILE_MATURITY_V2.STALE,
      BAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    BAGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      BAGOV_PROFILE_MATURITY_V2.ACTIVE,
      BAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [BAGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _bagovPTerminal = new Set([BAGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _bagovJTrans = new Map([
  [
    BAGOV_NAVIGATION_LIFECYCLE_V2.QUEUED,
    new Set([
      BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATING,
      BAGOV_NAVIGATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATING,
    new Set([
      BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATED,
      BAGOV_NAVIGATION_LIFECYCLE_V2.FAILED,
      BAGOV_NAVIGATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATED, new Set()],
  [BAGOV_NAVIGATION_LIFECYCLE_V2.FAILED, new Set()],
  [BAGOV_NAVIGATION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _bagovPsV2 = new Map();
const _bagovJsV2 = new Map();
let _bagovMaxActive = 6,
  _bagovMaxPending = 15,
  _bagovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _bagovStuckMs = 60 * 1000;
function _bagovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _bagovCheckP(from, to) {
  const a = _bagovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid bagov profile transition ${from} → ${to}`);
}
function _bagovCheckJ(from, to) {
  const a = _bagovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid bagov navigation transition ${from} → ${to}`);
}
function _bagovCountActive(owner) {
  let c = 0;
  for (const p of _bagovPsV2.values())
    if (p.owner === owner && p.status === BAGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _bagovCountPending(profileId) {
  let c = 0;
  for (const j of _bagovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === BAGOV_NAVIGATION_LIFECYCLE_V2.QUEUED ||
        j.status === BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATING)
    )
      c++;
  return c;
}
export function setMaxActiveBagovProfilesPerOwnerV2(n) {
  _bagovMaxActive = _bagovPos(n, "maxActiveBagovProfilesPerOwner");
}
export function getMaxActiveBagovProfilesPerOwnerV2() {
  return _bagovMaxActive;
}
export function setMaxPendingBagovNavigationsPerProfileV2(n) {
  _bagovMaxPending = _bagovPos(n, "maxPendingBagovNavigationsPerProfile");
}
export function getMaxPendingBagovNavigationsPerProfileV2() {
  return _bagovMaxPending;
}
export function setBagovProfileIdleMsV2(n) {
  _bagovIdleMs = _bagovPos(n, "bagovProfileIdleMs");
}
export function getBagovProfileIdleMsV2() {
  return _bagovIdleMs;
}
export function setBagovNavigationStuckMsV2(n) {
  _bagovStuckMs = _bagovPos(n, "bagovNavigationStuckMs");
}
export function getBagovNavigationStuckMsV2() {
  return _bagovStuckMs;
}
export function _resetStateBrowserAutomationGovV2() {
  _bagovPsV2.clear();
  _bagovJsV2.clear();
  _bagovMaxActive = 6;
  _bagovMaxPending = 15;
  _bagovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _bagovStuckMs = 60 * 1000;
}
export function registerBagovProfileV2({ id, owner, engine, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_bagovPsV2.has(id)) throw new Error(`bagov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    engine: engine || "chromium",
    status: BAGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _bagovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateBagovProfileV2(id) {
  const p = _bagovPsV2.get(id);
  if (!p) throw new Error(`bagov profile ${id} not found`);
  const isInitial = p.status === BAGOV_PROFILE_MATURITY_V2.PENDING;
  _bagovCheckP(p.status, BAGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _bagovCountActive(p.owner) >= _bagovMaxActive)
    throw new Error(`max active bagov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = BAGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleBagovProfileV2(id) {
  const p = _bagovPsV2.get(id);
  if (!p) throw new Error(`bagov profile ${id} not found`);
  _bagovCheckP(p.status, BAGOV_PROFILE_MATURITY_V2.STALE);
  p.status = BAGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveBagovProfileV2(id) {
  const p = _bagovPsV2.get(id);
  if (!p) throw new Error(`bagov profile ${id} not found`);
  _bagovCheckP(p.status, BAGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = BAGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchBagovProfileV2(id) {
  const p = _bagovPsV2.get(id);
  if (!p) throw new Error(`bagov profile ${id} not found`);
  if (_bagovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal bagov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getBagovProfileV2(id) {
  const p = _bagovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listBagovProfilesV2() {
  return [..._bagovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createBagovNavigationV2({ id, profileId, url, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_bagovJsV2.has(id))
    throw new Error(`bagov navigation ${id} already exists`);
  if (!_bagovPsV2.has(profileId))
    throw new Error(`bagov profile ${profileId} not found`);
  if (_bagovCountPending(profileId) >= _bagovMaxPending)
    throw new Error(
      `max pending bagov navigations for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    url: url || "",
    status: BAGOV_NAVIGATION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _bagovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function navigatingBagovNavigationV2(id) {
  const j = _bagovJsV2.get(id);
  if (!j) throw new Error(`bagov navigation ${id} not found`);
  _bagovCheckJ(j.status, BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATING);
  const now = Date.now();
  j.status = BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeNavigationBagovV2(id) {
  const j = _bagovJsV2.get(id);
  if (!j) throw new Error(`bagov navigation ${id} not found`);
  _bagovCheckJ(j.status, BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATED);
  const now = Date.now();
  j.status = BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failBagovNavigationV2(id, reason) {
  const j = _bagovJsV2.get(id);
  if (!j) throw new Error(`bagov navigation ${id} not found`);
  _bagovCheckJ(j.status, BAGOV_NAVIGATION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = BAGOV_NAVIGATION_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelBagovNavigationV2(id, reason) {
  const j = _bagovJsV2.get(id);
  if (!j) throw new Error(`bagov navigation ${id} not found`);
  _bagovCheckJ(j.status, BAGOV_NAVIGATION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = BAGOV_NAVIGATION_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getBagovNavigationV2(id) {
  const j = _bagovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listBagovNavigationsV2() {
  return [..._bagovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleBagovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _bagovPsV2.values())
    if (
      p.status === BAGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _bagovIdleMs
    ) {
      p.status = BAGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckBagovNavigationsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _bagovJsV2.values())
    if (
      j.status === BAGOV_NAVIGATION_LIFECYCLE_V2.NAVIGATING &&
      j.startedAt != null &&
      t - j.startedAt >= _bagovStuckMs
    ) {
      j.status = BAGOV_NAVIGATION_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getBrowserAutomationGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(BAGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _bagovPsV2.values()) profilesByStatus[p.status]++;
  const navigationsByStatus = {};
  for (const v of Object.values(BAGOV_NAVIGATION_LIFECYCLE_V2))
    navigationsByStatus[v] = 0;
  for (const j of _bagovJsV2.values()) navigationsByStatus[j.status]++;
  return {
    totalBagovProfilesV2: _bagovPsV2.size,
    totalBagovNavigationsV2: _bagovJsV2.size,
    maxActiveBagovProfilesPerOwner: _bagovMaxActive,
    maxPendingBagovNavigationsPerProfile: _bagovMaxPending,
    bagovProfileIdleMs: _bagovIdleMs,
    bagovNavigationStuckMs: _bagovStuckMs,
    profilesByStatus,
    navigationsByStatus,
  };
}
