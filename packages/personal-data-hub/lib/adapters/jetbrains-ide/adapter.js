"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CAPTURED_BY,
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
} = require("../../constants");
const {
  createAccountScope,
  normalizeIdentity,
} = require("../../account-scope");
const {
  defaultJetBrainsConfigRoot,
  discoverProductConfigs,
  readRecentProjects,
} = require("./jetbrains-reader");

const NAME = "jetbrains-ide";
const VERSION = "0.1.0";
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;

function sha256Hex(value, length = 64) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

function canonicalRoot(value, fsMod = fs) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const resolved = path.resolve(value.trim());
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(resolved)
        : fsMod.realpathSync(resolved);
    return path.resolve(realpath);
  } catch {
    return resolved;
  }
}

function scopeForRoot(root, fsMod = fs) {
  const canonical = canonicalRoot(root, fsMod);
  if (!canonical) return undefined;
  return createAccountScope(
    NAME,
    `jetbrainsRoot:${normalizeIdentity(canonical)}`,
  );
}

function rootFingerprint(root, fsMod = fs) {
  const canonical = canonicalRoot(root, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return sha256Hex(`${NAME}\0${normalized}`, 24);
}

function parsePositiveInteger(value, optionName) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${NAME}.sync: ${optionName} must be a positive integer`);
  }
  return numeric;
}

function parseSince(opts) {
  const candidate = opts.since !== undefined ? opts.since : opts.sinceWatermark;
  if (candidate == null || candidate === "") return 0;
  const numeric = Number(candidate);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${NAME}.sync: since watermark must be unix milliseconds`);
  }
  return Math.floor(numeric);
}

function parseScanLimit(opts) {
  const pageSize =
    opts.pageSize == null
      ? DEFAULT_PAGE_SIZE
      : parsePositiveInteger(opts.pageSize, "pageSize");
  if (pageSize > MAX_PAGE_SIZE) {
    throw new Error(`${NAME}.sync: pageSize must not exceed ${MAX_PAGE_SIZE}`);
  }
  const maxPages =
    opts.maxPages == null
      ? DEFAULT_MAX_PAGES
      : parsePositiveInteger(opts.maxPages, "maxPages");
  const pageBudget =
    maxPages > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? Number.MAX_SAFE_INTEGER
      : pageSize * maxPages;
  const configured = [pageBudget];
  if (opts.limit != null) {
    configured.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    configured.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...configured);
}

function sanitizedReadError(error) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `${NAME}.sync: unable to read the selected JetBrains configuration (${sourceCode})`,
  );
  wrapped.code = "JETBRAINS_CONFIG_READ_FAILED";
  wrapped.sourceCode = sourceCode;
  return wrapped;
}

class JetBrainsIdeAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:jetbrains-recent-projects-xml",
      "sync:profile-directory",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = 1000;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.runtimeCredentialOption = "jetbrainsRoot";
    this.runtimeScopeIdentityKey = "jetbrainsRoot";
    this.dataDisclosure = {
      fields: [
        "recent-projects:projectName,pathHash,productName,productVersion,productCode,lastOpenedMs,lastActivatedMs,currentlyOpen,timestampSource",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { recentProjects: true, activityEvents: true },
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultRoot:
        typeof opts.defaultRoot === "function"
          ? opts.defaultRoot
          : defaultJetBrainsConfigRoot,
    };
    this._rootOverride = canonicalRoot(opts.jetbrainsRoot, this._deps.fs);
    if (this._rootOverride) {
      this.defaultScope = scopeForRoot(this._rootOverride, this._deps.fs);
    }
  }

  _resolveRoot(opts = {}) {
    const candidate =
      (typeof opts.jetbrainsRoot === "string" && opts.jetbrainsRoot.trim()) ||
      (typeof opts.profilePath === "string" && opts.profilePath.trim()) ||
      this._rootOverride ||
      this._deps.defaultRoot();
    return canonicalRoot(candidate, this._deps.fs);
  }

  resolveDefaultScope(opts = {}) {
    const root = this._resolveRoot(opts);
    return root ? scopeForRoot(root, this._deps.fs) : undefined;
  }

  async authenticate(ctx = {}) {
    const root = this._resolveRoot(ctx);
    if (!root) {
      return {
        ok: false,
        reason: "JETBRAINS_ROOT_UNRESOLVED",
        message:
          "No default JetBrains configuration directory could be resolved; select one locally",
      };
    }
    const discovered = discoverProductConfigs(root, { fs: this._deps.fs });
    if (discovered.configs.length === 0) {
      return {
        ok: false,
        reason: "JETBRAINS_RECENT_PROJECTS_NOT_FOUND",
        message:
          "No JetBrains recentProjects.xml was found in the selected configuration directory",
      };
    }
    return {
      ok: true,
      mode: "file-import",
      productConfigCount: discovered.configs.length,
      hasRecentProjects: true,
    };
  }

  async healthCheck(ctx = {}) {
    const result = await this.authenticate({ ...ctx, readinessOnly: true });
    return { ok: result.ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const root = this._resolveRoot(opts);
    const auth = await this.authenticate({ ...opts, jetbrainsRoot: root });
    if (!auth.ok) {
      const error = new Error(`${NAME}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }
    const since = parseSince(opts);
    const limit = parseScanLimit(opts);
    const includeRecentProjects = opts.include?.recentProjects !== false;
    const includeActivityEvents = opts.include?.activityEvents !== false;
    const rootId = rootFingerprint(root, this._deps.fs);
    let result = { projects: [], complete: true };

    if (includeRecentProjects) {
      try {
        result = readRecentProjects(root, {
          fs: this._deps.fs,
          since,
          limit,
        });
      } catch (error) {
        throw sanitizedReadError(error);
      }
    }

    for (const project of result.projects) {
      yield {
        kind: "recent-project",
        originalId: `${NAME}-project:${rootId}:${project.productConfigId.slice(0, 24)}:${project.projectId.slice(0, 24)}`,
        capturedAt: project.capturedAt,
        payload: {
          ...project,
          includeActivityEvent: includeActivityEvents,
        },
      };
    }
    if (result.complete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (raw.kind !== "recent-project") {
      throw new Error(`${NAME}.normalize: unknown raw.kind=${raw.kind}`);
    }
    const payload = raw.payload || {};
    const ingestedAt = Date.now();
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.EXPORT,
      originalId: raw.originalId,
    };
    const projectName =
      typeof payload.projectName === "string" && payload.projectName
        ? payload.projectName
        : "(unnamed project)";
    const productName =
      typeof payload.productName === "string" && payload.productName
        ? payload.productName
        : "JetBrains IDE";
    const entityHash = sha256Hex(raw.originalId, 32);
    const commonExtra = {
      editor: "jetbrains",
      productName,
      productVersion: payload.productVersion || null,
      productCode: payload.productCode || null,
      pathHash: payload.pathHash || null,
      lastOpenedMs: Number.isInteger(payload.lastOpenedMs)
        ? payload.lastOpenedMs
        : null,
      lastActivatedMs: Number.isInteger(payload.lastActivatedMs)
        ? payload.lastActivatedMs
        : null,
      timestampSource: payload.timestampSource || null,
      currentlyOpen: payload.currentlyOpen === true,
    };
    const item = {
      id: `item-jetbrains-project-${entityHash}`,
      type: ENTITY_TYPES.ITEM,
      subtype: ITEM_SUBTYPES.LINK,
      name: projectName,
      category: "code-project",
      ingestedAt,
      source,
      extra: commonExtra,
    };

    const events = [];
    if (payload.includeActivityEvent !== false) {
      const activated =
        payload.timestampSource === "activation" &&
        Number.isInteger(payload.lastActivatedMs);
      events.push({
        id: `event-jetbrains-project-${entityHash}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: raw.capturedAt,
        ingestedAt,
        source,
        actor: "self",
        content: {
          title: `${activated ? "Activated" : "Opened"} ${projectName} in ${productName}`,
          text: projectName,
        },
        extra: {
          ...commonExtra,
          kind: activated ? "ide-project-activated" : "ide-project-opened",
        },
      });
    }

    return {
      events,
      persons: [],
      places: [],
      items: [item],
      topics: [],
    };
  }
}

module.exports = {
  JetBrainsIdeAdapter,
  JETBRAINS_IDE_NAME: NAME,
  JETBRAINS_IDE_VERSION: VERSION,
};
