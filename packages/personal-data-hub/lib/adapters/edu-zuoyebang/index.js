/**
 * FAMILY-23 — 作业帮 (Zuoyebang) adapter.
 *
 * 家庭守护 telemetry：家长看孩子的学习/搜题情况。两路互补：
 *   - snapshot 模式（inputPath）：手机端 collector 快照 (profile + study-session)。
 *   - **live 模式（cookie，v0.2 接通）**：[ZuoyebangApiClient.fetchSnapshot] 经
 *     作业帮 web 接口（ZYBUSS 会话 cookie）拉 用户信息 + 学习/搜题记录。端点/
 *     字段无公开稳定文档，按 web 端常见形态实现 + 多字段名兼容，**未实地验证**，
 *     漂移时按 api-client 常量/pick 列表调整。
 * 无 inputPath 且无 cookie 时 sync 抛错。
 *
 * Snapshot schema (v1):
 *   { schemaVersion:1, snapshottedAt, account:{uid,displayName}, events:[
 *     { kind:"profile", id, capturedAt, uid, nickname, grade },
 *     { kind:"study", id, capturedAt, subject, durationMs, startAt } ] }
 *
 * Sensitivity: "medium"（学习习惯）。
 */
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { newId } = require("../../ids");
const {
  createAccountScope,
  createAccountScopeFromAccount,
} = require("../../account-scope");
const {
  SnapshotFileError,
  inspectSnapshotFile,
  probeJsonSnapshotFile,
  readBoundedSnapshotBuffer,
  validateJsonSnapshot,
} = require("../../snapshot-file");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const {
  DEFAULT_MAX_STUDY_PAGES,
  DEFAULT_STUDY_PAGE_SIZE,
  ZuoyebangApiClient,
} = require("./api-client");
const {
  advanceCursor,
  assertScanIdentity,
  beginScan,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");
const {
  assertRuntimeAccountId,
  createSourceRequestAudit,
  hasRuntimeCookie,
  hasRuntimeAccountId,
  healthCheckFromAuthenticate,
  runtimeAccountIdFailure,
} = require("../_runtime-cookie-source");

const NAME = "edu-zuoyebang";
const VERSION = "0.3.0";
const SNAPSHOT_SCHEMA_VERSION = 1;
const KIND_PROFILE = "profile";
const KIND_STUDY = "study";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PROFILE, KIND_STUDY]);

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id));
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${String(kind)} record requires a stable id`,
    );
  }
  return `zuoyebang:${kind}:${safe}`;
}

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

class ZuoyebangAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["uid", "userId", "accountId"],
    );
    this.runtimeScopeIdentityKey = "uid";
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie",
      "parse:zuoyebang-profile",
      "parse:zuoyebang-study-session",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "zuoyebang:profile (uid / nickname / grade)",
        "zuoyebang:study_session (subject / start / duration)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { profile: true, study: true },
    };
    this.apiClient = new ZuoyebangApiClient(opts);
    this._fetch = typeof opts.fetch === "function" ? opts.fetch : null;
    // Test seam: override how the live client is built per-sync (inject fetch).
    this._apiClientFactory =
      typeof opts.apiClientFactory === "function"
        ? opts.apiClientFactory
        : null;
    this._deps = { fs };
  }

  fileCheckpointMode() {
    return "shared";
  }

  resolveDefaultScope(options = {}) {
    const inputPath =
      typeof options.inputPath === "string" && options.inputPath.length > 0
        ? options.inputPath
        : null;
    return inputPath
      ? scopeForSnapshot(
          this._deps.fs,
          inputPath,
          options.maxSnapshotBytes,
          this.defaultScope,
        )
      : this.defaultScope;
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
    }
    if (hasRuntimeCookie(ctx) && !hasRuntimeAccountId(ctx)) {
      return runtimeAccountIdFailure(NAME);
    }
    if (hasRuntimeCookie(ctx)) {
      if (!this.apiClient.hasSession(ctx.cookie)) {
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          message: `edu-zuoyebang.authenticate: ${this.apiClient.lastError.message}`,
        };
      }
      return {
        ok: true,
        account: String(ctx.accountId).trim(),
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "edu-zuoyebang.authenticate: needs opts.inputPath (snapshot mode) or opts.cookie (ZYBUSS 会话, live fetch)",
    };
  }

  async healthCheck(opts = {}) {
    return healthCheckFromAuthenticate(this, opts);
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (hasRuntimeCookie(opts)) {
      assertRuntimeAccountId(NAME, opts);
      yield* this._syncViaLive(opts);
      return;
    }
    throw new Error(
      "edu-zuoyebang.sync: needs opts.inputPath (snapshot mode) or opts.cookie (ZYBUSS 会话, 学习/搜题记录 live fetch)",
    );
  }

  async *_syncViaLive(opts) {
    assertRuntimeAccountId(NAME, opts);
    const sourceRequestAudit = createSourceRequestAudit(
      opts,
      `${NAME}:live`,
      this._fetch,
    );
    const liveOpts = { ...opts, fetch: sourceRequestAudit.fetch };
    const client = this._apiClientFactory
      ? this._apiClientFactory(liveOpts)
      : new ZuoyebangApiClient({
          fetch: sourceRequestAudit.fetch,
          baseUrl: opts.baseUrl,
          userInfoPath: opts.userInfoPath,
          studyRecordsPath: opts.studyRecordsPath,
        });
    const emit = (phase, extra) => {
      if (typeof opts.onProgress === "function") {
        try {
          opts.onProgress({ phase, adapter: NAME, ...extra });
        } catch {
          /* progress callback errors are best-effort */
        }
      }
    };
    const result = await client.fetchSnapshot(opts.cookie, {
      include: opts.include || {},
      pageSize: resolveStudyPageSize(opts.studyPageSize),
      maxPages: resolveMaxStudyPages(opts.maxStudyPages),
    });
    sourceRequestAudit.throwIfPermitFailed();
    if (result === null) {
      const e = client.lastError;
      throw new Error(
        `edu-zuoyebang.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
      );
    }
    const account = result.account || null;
    emit("fetched", { count: result.events.length });
    const capturedAt = Date.now();
    const records = result.events.map((ev) => {
      if (!ev || !VALID_SNAPSHOT_KINDS.includes(ev.kind)) {
        throw new Error(`${NAME}.sync: live source returned an unknown kind`);
      }
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.uid ||
        null;
      return {
        adapter: NAME,
        kind: ev.kind,
        originalId: stableOriginalId(ev.kind, id),
        capturedAt,
        payload: { ...ev, capturedAt, account },
      };
    });
    const source = digest(
      Buffer.from(
        JSON.stringify(records.map((record) => record.originalId)),
        "utf8",
      ),
    );
    const config = collectionConfig("live", opts);
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode: "live",
      source,
      config,
      upper: records.length,
    });
    const publish = () => publishCursor(opts, cursor);
    let emitted = 0;
    let ordinal = cursor.after ?? 0;
    while (cursor.upper !== null && emitted < limit) {
      ordinal += 1;
      const raw = records[ordinal - 1];
      cursor = advanceCursor(cursor, ordinal);
      publish();
      yield raw;
      emitted += 1;
    }
    publish();
    emit("done", { yielded: emitted, count: records.length });
  }

  async *_syncViaSnapshot(opts) {
    const { snapshot, source } = readSnapshotSource(
      this._deps.fs,
      opts.inputPath,
      opts.maxSnapshotBytes,
    );
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};
    const records = snapshot.events.map((ev) => {
      const kind = ev.kind;
      const capturedAt = parseTime(ev.capturedAt) || fallbackCapturedAt;
      const explicitId =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        (typeof ev.id === "number" && Number.isFinite(ev.id) ? ev.id : null);
      const id = explicitId ?? (kind === KIND_PROFILE ? ev.uid : null);
      return {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
    });
    const config = collectionConfig("snapshot", opts);
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode: "snapshot",
      source,
      config,
      upper: records.length,
    });
    const publish = () => publishCursor(opts, cursor);
    let emitted = 0;
    let ordinal = cursor.after ?? 0;
    while (cursor.upper !== null && emitted < limit) {
      ordinal += 1;
      const raw = records[ordinal - 1];
      cursor = advanceCursor(cursor, ordinal);
      publish();
      if (include[raw.kind] === false) continue;
      yield raw;
      emitted += 1;
    }
    publish();
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("ZuoyebangAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    if (kind === KIND_PROFILE) return normalizeProfile(p, raw, ingestedAt);
    if (kind === KIND_STUDY) return normalizeStudy(p, raw, ingestedAt);
    throw new Error(`ZuoyebangAdapter.normalize: unknown kind ${kind}`);
  }
}

function readSnapshotSource(fsMod, inputPath, maxBytes) {
  const buffer = readBoundedSnapshotBuffer(fsMod, inputPath, { maxBytes });
  let snapshot;
  try {
    snapshot = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new SnapshotFileError(
      "SNAPSHOT_JSON_INVALID",
      "snapshot file must contain valid JSON",
      { cause: error },
    );
  }
  validateJsonSnapshot(snapshot, {
    expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    requiredArrayFields: ["events"],
    allowedEventKinds: VALID_SNAPSHOT_KINDS,
  });
  return { snapshot, source: digest(buffer) };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectionConfig(mode, opts) {
  const include = opts.include || {};
  const config = {
    include: {
      profile: include[KIND_PROFILE] !== false,
      study: include[KIND_STUDY] !== false,
    },
    mode,
  };
  if (mode === "live") {
    config.studyPageSize = resolveStudyPageSize(opts.studyPageSize);
    config.maxStudyPages = resolveMaxStudyPages(opts.maxStudyPages);
    config.endpoint = {
      baseUrl: opts.baseUrl || null,
      studyRecordsPath: opts.studyRecordsPath || null,
      userInfoPath: opts.userInfoPath || null,
    };
  }
  return digest(Buffer.from(JSON.stringify(config), "utf8"));
}

function resolveStudyPageSize(value) {
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_STUDY_PAGE_SIZE;
}

function resolveMaxStudyPages(value) {
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_STUDY_PAGES;
}

function prepareCursor(sinceWatermark, identity) {
  let cursor = parseCursor(sinceWatermark).cursor;
  cursor =
    cursor.upper === null
      ? beginScan(cursor, identity)
      : assertScanIdentity(cursor, identity);
  return cursor;
}

function publishCursor(opts, cursor) {
  if (typeof opts.updateWatermark === "function") {
    opts.updateWatermark(serializeCursor(cursor));
  }
}

function scopeForSnapshot(fsMod, inputPath, maxBytes, accountScope) {
  const inspected = inspectSnapshotFile(fsMod, inputPath, { maxBytes });
  const revision =
    inspected.stat.mtimeNs ??
    inspected.stat.mtimeMs ??
    inspected.stat.ctimeNs ??
    inspected.stat.ctimeMs ??
    "";
  return createAccountScope(
    NAME,
    [
      accountScope || "unscoped",
      "snapshot",
      inspected.realPath,
      String(inspected.size),
      String(revision),
    ].join("\0"),
  );
}

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.API,
  };
}

function normalizeProfile(p, raw, ingestedAt) {
  const uid = p.uid || (p.account && p.account.uid) || null;
  const nickname =
    p.nickname || (p.account && p.account.displayName) || "(unnamed)";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const identifiers = {};
  if (uid) identifiers["zuoyebang-uid"] = [String(uid)];
  return {
    events: [],
    persons: [
      {
        id: uid
          ? `person-zuoyebang-${uid}`
          : `person-zuoyebang-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source: buildSource(raw, occurredAt),
        identifiers,
        extra: {
          platform: "zuoyebang",
          grade: p.grade || null,
          snapshottedAt: occurredAt,
        },
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeStudy(p, raw, ingestedAt) {
  const occurredAt =
    parseTime(p.startAt) ||
    parseTime(p.capturedAt) ||
    raw.capturedAt ||
    ingestedAt;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt,
        actor: "person-self",
        content: { title: "作业帮 学习" },
        ingestedAt,
        source: buildSource(raw, occurredAt),
        extra: {
          platform: "zuoyebang",
          kind: "study",
          subject: p.subject || null,
          durationMs: Number.isFinite(p.durationMs) ? p.durationMs : 0,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

module.exports = {
  ZuoyebangAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_STUDY,
};
