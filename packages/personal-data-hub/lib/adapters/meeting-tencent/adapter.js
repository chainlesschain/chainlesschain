"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  createAccountScope,
  normalizeIdentity,
} = require("../../account-scope");
const {
  CAPTURED_BY,
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  PERSON_SUBTYPES,
} = require("../../constants");
const {
  cleanupTencentMeetingSnapshot,
  copyTencentMeetingSnapshot,
  defaultTencentMeetingRoot,
  findTencentMeetingHistoryDb,
  MAX_MAX_PARTICIPANTS,
  normalizeSourcePath,
  readTencentMeetingHistory,
} = require("./reader");

const NAME = "meeting-tencent";
const VERSION = "0.1.0";
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;

function canonicalSourcePath(value, fsMod = fs) {
  const normalized = normalizeSourcePath(value);
  if (!normalized) return null;
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(normalized)
        : fsMod.realpathSync(normalized);
    return path.resolve(realpath);
  } catch {
    return path.resolve(normalized);
  }
}

function sourceFingerprint(value, fsMod = fs) {
  const canonical = canonicalSourcePath(value, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return crypto
    .createHash("sha256")
    .update(`${NAME}\0${normalized}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function scopeForSource(value, fsMod = fs) {
  const canonical = canonicalSourcePath(value, fsMod);
  if (!canonical) return undefined;
  return createAccountScope(NAME, `sourcePath:${normalizeIdentity(canonical)}`);
}

function stableHash(value, length = 24) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

function parseSince(opts) {
  const candidate = opts.since !== undefined ? opts.since : opts.sinceWatermark;
  if (candidate == null || candidate === "") return 0;
  const number = Number(candidate);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${NAME}.sync: since watermark must be unix milliseconds`);
  }
  return Math.floor(number);
}

function parsePositiveInteger(value, optionName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${NAME}.sync: ${optionName} must be a positive integer`);
  }
  return number;
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
      : maxPages * pageSize;
  const limits = [pageBudget];
  if (opts.limit != null) {
    limits.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    limits.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...limits);
}

function resolveCollectionIncludes(opts = {}) {
  const include =
    opts.include && typeof opts.include === "object" ? opts.include : {};
  return {
    history: include.history !== false,
    participants:
      include.participants !== false && opts.includeParticipants !== false,
    artifacts: include.artifacts !== false,
  };
}

function sanitizedMeetingError(error, fallbackCode) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : null;
  const sanitized = new Error(
    `${NAME}.sync: unable to read the selected Tencent Meeting history`,
  );
  sanitized.code =
    sourceCode === "EACCES" || sourceCode === "EPERM"
      ? "MEETING_PERMISSION_DENIED"
      : sourceCode === "MEETING_SCHEMA_MISMATCH"
        ? sourceCode
        : fallbackCode;
  if (sourceCode && sanitized.code !== sourceCode) {
    sanitized.sourceCode = sourceCode;
  }
  return sanitized;
}

function safeString(value, maxLength = 200_000) {
  if (typeof value !== "string") return null;
  const normalized = value.split("\0").join("").trim();
  if (!normalized) return null;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function participantPayload(participant, profileId) {
  if (!participant || typeof participant !== "object") return null;
  const displayName = safeString(participant.displayName, 500);
  const identity =
    safeString(participant.appUid, 2000) ||
    (displayName ? `name:${displayName}` : null);
  if (!identity) return null;
  return {
    participantId: stableHash(`${profileId}\0${identity}`),
    displayName,
  };
}

function creatorPayload(meeting, profileId) {
  const displayName = safeString(meeting.creatorNickname, 1000);
  const identity =
    safeString(meeting.creatorAppUid, 2000) ||
    (displayName ? `name:${displayName}` : null);
  if (!identity) return null;
  return {
    participantId: stableHash(`${profileId}\0${identity}`),
    displayName,
  };
}

function meetingDurationMs(payload) {
  if (
    Number.isInteger(payload.joinTimeMs) &&
    Number.isInteger(payload.leaveTimeMs) &&
    payload.leaveTimeMs >= payload.joinTimeMs
  ) {
    return payload.leaveTimeMs - payload.joinTimeMs;
  }
  if (Number.isInteger(payload.elapsedSeconds)) {
    return payload.elapsedSeconds * 1000;
  }
  if (
    Number.isInteger(payload.beginTimeMs) &&
    Number.isInteger(payload.endTimeMs) &&
    payload.endTimeMs >= payload.beginTimeMs
  ) {
    return payload.endTimeMs - payload.beginTimeMs;
  }
  return 0;
}

class TencentMeetingAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:tencent-meeting-sqlite",
      "sync:meeting-history",
      "sync:profile-directory",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = 1000;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.runtimeCredentialOption = "profilePath";
    this.runtimeScopeIdentityKey = "profilePath";
    this.dataDisclosure = {
      fields: [
        "meetings:subject,description,beginTimeMs,joinTimeMs,leaveTimeMs,durationMs,creatorNickname",
        "participants:displayName,hashedLocalId",
        "artifacts:documentName,documentCount,recordCount,recordDurationSeconds,aiSummary,chatCount",
      ],
      sensitivity: "high",
      legalGate: true,
      defaultInclude: {
        history: true,
        participants: true,
        artifacts: true,
      },
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultRoot:
        typeof opts.defaultRoot === "function"
          ? opts.defaultRoot
          : defaultTencentMeetingRoot,
      findHistoryDb:
        typeof opts.findHistoryDb === "function"
          ? opts.findHistoryDb
          : findTencentMeetingHistoryDb,
    };
    this._rootOverride =
      typeof opts.rootPath === "string" && opts.rootPath.trim()
        ? opts.rootPath
        : typeof opts.profilePath === "string" && opts.profilePath.trim()
          ? opts.profilePath
          : null;
    this._dbOverride =
      typeof opts.dbPath === "string" && opts.dbPath.trim()
        ? opts.dbPath
        : null;
    const scopeCandidate = this._dbOverride || this._rootOverride;
    if (scopeCandidate) {
      this.defaultScope = scopeForSource(scopeCandidate, this._deps.fs);
    }
  }

  fileCheckpointMode(opts = {}) {
    // inputPath points at the continuing Tencent Meeting profile/database,
    // not a point-in-time export.
    return typeof opts.inputPath === "string" && opts.inputPath.trim()
      ? "shared"
      : "preserve";
  }

  _sourceCandidate(opts = {}) {
    return (
      (typeof opts.dbPath === "string" && opts.dbPath.trim()) ||
      (typeof opts.inputPath === "string" && opts.inputPath.trim()) ||
      (typeof opts.profilePath === "string" && opts.profilePath.trim()) ||
      (typeof opts.rootPath === "string" && opts.rootPath.trim()) ||
      this._dbOverride ||
      this._rootOverride ||
      this._deps.defaultRoot()
    );
  }

  _resolveSource(opts = {}) {
    const candidate = this._sourceCandidate(opts);
    if (!candidate) return null;
    return this._deps.findHistoryDb(candidate, { fs: this._deps.fs });
  }

  resolveDefaultScope(opts = {}) {
    const candidate = this._sourceCandidate(opts);
    return candidate ? scopeForSource(candidate, this._deps.fs) : undefined;
  }

  async authenticate(ctx = {}) {
    let source;
    try {
      source = this._resolveSource(ctx);
    } catch (error) {
      return {
        ok: false,
        reason:
          error?.code === "EACCES" || error?.code === "EPERM"
            ? "MEETING_PERMISSION_DENIED"
            : "MEETING_DATA_NOT_FOUND",
        message:
          "Tencent Meeting history could not be inspected; select the WeMeet data directory",
      };
    }
    if (!source) {
      return {
        ok: false,
        reason: "MEETING_DATA_NOT_FOUND",
        message:
          "Tencent Meeting history was not found; select the WeMeet data directory",
      };
    }
    if (source.schemaMismatch) {
      return {
        ok: false,
        reason: "MEETING_SCHEMA_MISMATCH",
        message:
          "The selected SQLite database does not contain a supported Tencent Meeting history table",
      };
    }
    return {
      ok: true,
      mode: "file-import",
      tableCount: source.tables.length,
    };
  }

  async healthCheck(ctx = {}) {
    if (!resolveCollectionIncludes(ctx).history) {
      return { ok: true, skipped: true, lastChecked: Date.now() };
    }
    const result = await this.authenticate({ ...ctx, readinessOnly: true });
    return {
      ok: result.ok,
      lastChecked: Date.now(),
      reason: result.reason,
    };
  }

  async *sync(opts = {}) {
    const collectionIncludes = resolveCollectionIncludes(opts);
    if (!collectionIncludes.history) return;

    let source;
    try {
      source = this._resolveSource(opts);
    } catch (error) {
      throw sanitizedMeetingError(error, "MEETING_DATA_NOT_FOUND");
    }
    if (!source || source.schemaMismatch) {
      const error = new Error(
        `${NAME}.sync: Tencent Meeting history database is unavailable`,
      );
      error.code = source?.schemaMismatch
        ? "MEETING_SCHEMA_MISMATCH"
        : "MEETING_DATA_NOT_FOUND";
      throw error;
    }

    const since = parseSince(opts);
    const limit = parseScanLimit(opts);
    const maxParticipants =
      !collectionIncludes.participants || opts.maxParticipants == null
        ? undefined
        : parsePositiveInteger(opts.maxParticipants, "maxParticipants");
    if (
      maxParticipants !== undefined &&
      maxParticipants > MAX_MAX_PARTICIPANTS
    ) {
      throw new Error(
        `${NAME}.sync: maxParticipants must not exceed ${MAX_MAX_PARTICIPANTS}`,
      );
    }
    const profileId = sourceFingerprint(source.scopePath, this._deps.fs);
    const scope = scopeForSource(source.scopePath, this._deps.fs);
    let snapshot = null;
    try {
      snapshot = copyTencentMeetingSnapshot(source.dbPath, {
        fs: this._deps.fs,
      });
      const result = readTencentMeetingHistory(snapshot.dbPath, {
        since,
        limit,
        maxParticipants,
        includeParticipants: collectionIncludes.participants,
        includeArtifacts: collectionIncludes.artifacts,
        sourceMtimeMs: snapshot.sourceMtimeMs,
      });
      for (const meeting of result.meetings) {
        const meetingKey = stableHash(
          `${profileId}\0${meeting.meetingIdentity}`,
        );
        const participants = !collectionIncludes.participants
          ? []
          : meeting.participants
              .map((participant) => participantPayload(participant, profileId))
              .filter(Boolean);
        const creator = collectionIncludes.participants
          ? creatorPayload(meeting, profileId)
          : null;
        yield {
          kind: "meeting",
          originalId: `tencent-meeting:${profileId}:${meetingKey}`,
          capturedAt: meeting.capturedAt,
          payload: {
            profileId,
            scope,
            meetingKey,
            subject: meeting.subject,
            beginTimeMs: meeting.beginTimeMs,
            endTimeMs: meeting.endTimeMs,
            joinTimeMs: meeting.joinTimeMs,
            leaveTimeMs: meeting.leaveTimeMs,
            elapsedSeconds: meeting.elapsedSeconds,
            meetingType: meeting.meetingType,
            mediaSetType: meeting.mediaSetType,
            description: meeting.description,
            activityName: meeting.activityName,
            activitySponsorName: meeting.activitySponsorName,
            remark: meeting.remark,
            ...(collectionIncludes.participants
              ? {
                  creator,
                  participants,
                  participantsTruncated: meeting.participantsTruncated,
                  participantCount: meeting.participantCount,
                }
              : {}),
            ...(collectionIncludes.artifacts
              ? {
                  documentName: meeting.documentName,
                  documentCount: meeting.documentCount,
                  recordCount: meeting.recordCount,
                  recordDurationSeconds: meeting.recordDurationSeconds,
                  recordAiSummary: meeting.recordAiSummary,
                  chatCount: meeting.chatCount,
                  hasAiSummary: meeting.hasAiSummary,
                  aiSummaryCount: meeting.aiSummaryCount,
                  recordStatus: meeting.recordStatus,
                  recordPermission: meeting.recordPermission,
                }
              : {}),
          },
        };
      }
      if (result.complete && typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
    } catch (error) {
      throw sanitizedMeetingError(error, "MEETING_HISTORY_READ_FAILED");
    } finally {
      cleanupTencentMeetingSnapshot(snapshot, { fs: this._deps.fs });
    }
  }

  normalize(raw) {
    if (raw.kind !== "meeting") {
      throw new Error(`${NAME}.normalize: unknown raw.kind=${raw.kind}`);
    }
    const payload = raw.payload || {};
    const ingestedAt = Date.now();
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
      ...(payload.scope ? { scope: payload.scope } : {}),
    };
    const personById = new Map();
    const addPerson = (participant, role) => {
      if (!participant?.participantId || !participant.displayName) return null;
      const personId = `person-tencent-meeting-${participant.participantId}`;
      if (!personById.has(personId)) {
        personById.set(personId, {
          id: personId,
          type: ENTITY_TYPES.PERSON,
          subtype: PERSON_SUBTYPES.CONTACT,
          names: [participant.displayName],
          relation: role,
          ingestedAt,
          source: {
            ...source,
            originalId: `${raw.originalId}:${role}:${participant.participantId}`,
          },
          identifiers: {
            "tencent-meeting-id-hash": participant.participantId,
          },
          extra: {
            platform: "tencent-meeting",
            identityRedacted: true,
          },
        });
      }
      return personId;
    };

    const creatorId = addPerson(payload.creator, "meeting-creator");
    const participantsIncluded =
      Object.prototype.hasOwnProperty.call(payload, "creator") ||
      Object.prototype.hasOwnProperty.call(payload, "participants") ||
      Object.prototype.hasOwnProperty.call(payload, "participantCount") ||
      Object.prototype.hasOwnProperty.call(payload, "participantsTruncated");
    const artifactsIncluded =
      Object.prototype.hasOwnProperty.call(payload, "documentName") ||
      Object.prototype.hasOwnProperty.call(payload, "documentCount") ||
      Object.prototype.hasOwnProperty.call(payload, "recordCount") ||
      Object.prototype.hasOwnProperty.call(payload, "recordDurationSeconds") ||
      Object.prototype.hasOwnProperty.call(payload, "recordAiSummary") ||
      Object.prototype.hasOwnProperty.call(payload, "chatCount") ||
      Object.prototype.hasOwnProperty.call(payload, "hasAiSummary") ||
      Object.prototype.hasOwnProperty.call(payload, "aiSummaryCount") ||
      Object.prototype.hasOwnProperty.call(payload, "recordStatus") ||
      Object.prototype.hasOwnProperty.call(payload, "recordPermission");
    const participantIds = [];
    for (const participant of Array.isArray(payload.participants)
      ? payload.participants
      : []) {
      const personId = addPerson(participant, "meeting-participant");
      if (personId && !participantIds.includes(personId)) {
        participantIds.push(personId);
      }
    }
    if (creatorId && !participantIds.includes(creatorId)) {
      participantIds.unshift(creatorId);
    }

    const title =
      safeString(payload.subject, 10_000) ||
      safeString(payload.activityName, 10_000) ||
      "腾讯会议";
    const textSections = [
      safeString(payload.description)
        ? `会议说明：${safeString(payload.description)}`
        : null,
      safeString(payload.remark)
        ? `会议备注：${safeString(payload.remark)}`
        : null,
      safeString(payload.recordAiSummary)
        ? `AI 纪要：${safeString(payload.recordAiSummary)}`
        : null,
    ].filter(Boolean);
    const occurredAt = Number.isInteger(payload.beginTimeMs)
      ? payload.beginTimeMs
      : raw.capturedAt;
    const durationMs = meetingDurationMs(payload);
    const event = {
      id: `event-tencent-meeting-${payload.profileId}-${payload.meetingKey}`,
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.MEETING,
      occurredAt,
      durationMs,
      actor: creatorId || "unknown",
      ...(participantIds.length > 0 ? { participants: participantIds } : {}),
      content: {
        title: title.length > 200 ? `${title.slice(0, 200)}…` : title,
        text: textSections.join("\n"),
      },
      ingestedAt,
      source,
      extra: {
        kind: "meeting",
        platform: "tencent-meeting",
        joinedAt: safeInteger(payload.joinTimeMs),
        leftAt: safeInteger(payload.leaveTimeMs),
        scheduledEndAt: safeInteger(payload.endTimeMs),
        meetingType: safeInteger(payload.meetingType),
        mediaSetType: safeInteger(payload.mediaSetType),
        activityName: safeString(payload.activityName, 10_000),
        activitySponsorName: safeString(payload.activitySponsorName, 10_000),
        ...(participantsIncluded
          ? {
              creatorNickname: payload.creator?.displayName || null,
              participantCount:
                safeInteger(payload.participantCount) ?? participantIds.length,
              participantsTruncated: payload.participantsTruncated === true,
            }
          : {}),
        ...(artifactsIncluded
          ? {
              documents: {
                name: safeString(payload.documentName, 10_000),
                count: safeInteger(payload.documentCount) || 0,
              },
              recording: {
                count: safeInteger(payload.recordCount) || 0,
                durationMs:
                  (safeInteger(payload.recordDurationSeconds) || 0) * 1000,
                hasAiSummary: payload.hasAiSummary === true,
                aiSummaryCount: safeInteger(payload.aiSummaryCount) || 0,
                status: safeInteger(payload.recordStatus),
                permission: safeInteger(payload.recordPermission),
              },
              chatCount: safeInteger(payload.chatCount) || 0,
            }
          : {}),
        identityRedacted: true,
      },
    };
    return {
      events: [event],
      persons: [...personById.values()],
      places: [],
      items: [],
      topics: [],
    };
  }
}

module.exports = {
  TencentMeetingAdapter,
  TENCENT_MEETING_NAME: NAME,
  TENCENT_MEETING_VERSION: VERSION,
  canonicalSourcePath,
  scopeForSource,
  sourceFingerprint,
};
