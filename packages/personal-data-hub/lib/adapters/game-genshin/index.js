/**
 * FAMILY-23 — Genshin Impact (原神 / 米哈游) adapter.
 *
 * 家庭守护 telemetry：家长想看孩子玩什么游戏 / 玩多久。两路互补：
 *   - snapshot 模式（inputPath）：消费手机端 collector 产的快照 JSON
 *     （profile + play-session 事件，含精确游戏时长）。
 *   - **live 模式（cookie，v0.2 接通）**：[GenshinApiClient.fetchProfiles] 经
 *     米游社 takumi 接口 + DS v1 签名拉取角色档案（nickname / level / region /
 *     活跃天数）。web game-record API 不暴露单次时长，故 live 仅出 profile；
 *     "玩多久" 仍依赖 snapshot。
 * 无 inputPath 且无 cookie 时 sync 抛错。
 *
 * Snapshot schema (v1):
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "旅行者" },
 *     "events": [
 *       { "kind": "profile", "id": "profile-<uid>", "capturedAt": <ms>,
 *         "uid": "...", "nickname": "...", "level": N, "avatarUrl": "..." },
 *       { "kind": "play", "id": "play-<sessionId>", "capturedAt": <ms>,
 *         "durationMs": N, "mode": "...", "startAt": <ms> }
 *     ]
 *   }
 *
 * Sensitivity: "medium" — 游戏时长 / 等级揭示娱乐偏好与在线时段。
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
const { GenshinApiClient } = require("./api-client");
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

const NAME = "game-genshin";
const VERSION = "0.3.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PROFILE = "profile";
const KIND_PLAY = "play";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_PROFILE, KIND_PLAY]);

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id));
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${String(kind)} record requires a stable id`,
    );
  }
  return `genshin:${kind}:${safe}`;
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

class GenshinAdapter {
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
      "parse:genshin-profile",
      "parse:genshin-play-session",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "genshin:profile (uid / nickname / level / avatar)",
        "genshin:play_session (start / duration / mode)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: { profile: true, play: true },
    };
    this.apiClient = new GenshinApiClient(opts);
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
      const uid = this.apiClient.extractUid(ctx.cookie);
      if (!uid) {
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          message: `game-genshin.authenticate: ${this.apiClient.lastError.message}`,
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
        "game-genshin.authenticate: needs opts.inputPath (snapshot mode) or opts.cookie (live HoYoLAB fetch)",
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
      "game-genshin.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) or opts.cookie (live HoYoLAB fetch via takumi + DS 签名)",
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
      : new GenshinApiClient({
          fetch: sourceRequestAudit.fetch,
          now: opts.now,
          rand: opts.rand,
          appVersion: opts.appVersion,
          salt: opts.salt,
          takumiApi: opts.takumiApi,
          recordApi: opts.recordApi,
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
    const fetchStats = opts.fetchStats !== false;
    const profiles = await client.fetchProfiles(opts.cookie, { fetchStats });
    sourceRequestAudit.throwIfPermitFailed();
    if (profiles === null) {
      const e = client.lastError;
      throw new Error(
        `game-genshin.sync (live): ${e.message || "fetch failed"} (code ${e.code})`,
      );
    }
    emit("roles", { count: profiles.length });
    const capturedAt = Date.now();
    const records = profiles.map((prof) => ({
      adapter: NAME,
      kind: KIND_PROFILE,
      originalId: stableOriginalId(KIND_PROFILE, prof.uid),
      capturedAt,
      payload: {
        kind: KIND_PROFILE,
        ...prof,
        account: { uid: prof.uid, displayName: prof.nickname },
      },
    }));
    const include = opts.include || {};
    const filter = `${include[KIND_PROFILE] === false ? "none" : "profile"}:${
      fetchStats ? "stats" : "no-stats"
    }`;
    const source = sourceDigest(
      Buffer.from(
        JSON.stringify(records.map((record) => record.originalId)),
        "utf8",
      ),
    );
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode: "live",
      source,
      filter,
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
      if (include[KIND_PROFILE] === false) continue;
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
    const filter = snapshotFilter(include);
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode: "snapshot",
      source,
      filter,
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
      throw new Error("GenshinAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    if (kind === KIND_PROFILE) {
      return normalizeProfile(p, raw, ingestedAt);
    }
    if (kind === KIND_PLAY) {
      return normalizePlay(p, raw, ingestedAt);
    }
    throw new Error(`GenshinAdapter.normalize: unknown kind ${kind}`);
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
  return {
    snapshot,
    source: sourceDigest(buffer),
  };
}

function sourceDigest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
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

function snapshotFilter(include = {}) {
  const profile = include[KIND_PROFILE] !== false;
  const play = include[KIND_PLAY] !== false;
  if (profile && play) return "profile+play";
  if (profile) return "profile";
  if (play) return "play";
  return "none";
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
  if (uid) identifiers["genshin-uid"] = [String(uid)];
  return {
    events: [],
    persons: [
      {
        id: uid ? `person-genshin-${uid}` : `person-genshin-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source: buildSource(raw, occurredAt),
        identifiers,
        extra: {
          platform: "genshin",
          level: p.level != null ? p.level : null,
          avatarUrl: p.avatarUrl || null,
          region: p.region || null,
          regionName: p.regionName || null,
          activeDayNumber: Number.isFinite(p.activeDayNumber)
            ? p.activeDayNumber
            : null,
          snapshottedAt: occurredAt,
        },
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizePlay(p, raw, ingestedAt) {
  const occurredAt =
    parseTime(p.startAt) ||
    parseTime(p.capturedAt) ||
    raw.capturedAt ||
    ingestedAt;
  const durationMs = Number.isFinite(p.durationMs) ? p.durationMs : 0;
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MEDIA,
        occurredAt,
        actor: "person-self",
        content: { title: "原神 游戏时长" },
        ingestedAt,
        source: buildSource(raw, occurredAt),
        extra: {
          platform: "genshin",
          kind: "play",
          durationMs,
          mode: p.mode || null,
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
  GenshinAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_PLAY,
};
