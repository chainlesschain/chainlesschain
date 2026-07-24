"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CAPTURED_BY,
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  PERSON_SUBTYPES,
} = require("../../constants");
const {
  createAccountScope,
  normalizeIdentity,
} = require("../../account-scope");
const {
  defaultClaudeCodeHome,
  inspectClaudeCodeLocalData,
  readClaudeCodeTranscripts,
  readClaudeCodeStats,
} = require("./claude-code-reader");

const NAME = "claude-code";
const VERSION = "0.1.0";
const CLAUDE_AI_PERSON_ID = "person-ai-claude-code";
const SELF_PERSON_ID = "person-self";
const WATERMARK_LOOKBACK_MS = 5 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 10_000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;

function sha256Hex(value, length = 64) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

function canonicalPath(value, fsMod = fs) {
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

function pathFingerprint(value, fsMod = fs) {
  const canonical = canonicalPath(value, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return sha256Hex(`${NAME}\0${normalized}`, 24);
}

function parseSince(opts = {}) {
  for (const value of [opts.sinceWatermark, opts.since]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function scanLimit(opts = {}) {
  const parsePositive = (value, optionName) => {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw new Error(`${NAME}.sync: ${optionName} must be a positive integer`);
    }
    return numeric;
  };
  const pageSize =
    opts.pageSize == null
      ? DEFAULT_PAGE_SIZE
      : parsePositive(opts.pageSize, "pageSize");
  if (pageSize > MAX_PAGE_SIZE) {
    throw new Error(`${NAME}.sync: pageSize must not exceed ${MAX_PAGE_SIZE}`);
  }
  const maxPages =
    opts.maxPages == null
      ? DEFAULT_MAX_PAGES
      : parsePositive(opts.maxPages, "maxPages");
  const pageBudget =
    maxPages > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? Number.MAX_SAFE_INTEGER
      : pageSize * maxPages;
  const candidates = [pageBudget];
  if (opts.limit != null) {
    candidates.push(parsePositive(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    candidates.push(parsePositive(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...candidates);
}

function emptyBatch() {
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function sanitizedReadError(error) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `${NAME}.sync: unable to read the selected Claude Code local data (${sourceCode})`,
  );
  wrapped.code = "CLAUDE_CODE_READ_FAILED";
  wrapped.sourceCode = sourceCode;
  return wrapped;
}

class ClaudeCodeAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = WATERMARK_LOOKBACK_MS;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.capabilities = [
      "sync:claude-code-session-jsonl",
      "sync:claude-code-subagent-jsonl",
      "sync:claude-code-stats-json",
      "sync:profile-directory",
    ];
    this.dataDisclosure = {
      fields: [
        "conversation-messages:role,text,sessionTitle,model,stopReason,tokenUsage,occurredAt",
        "session-metadata:projectHash,sessionHash,parentSessionHash,agentHash,isSubagent",
        "daily-activity:date,messageCount,sessionCount,toolCallCount",
        "daily-model-usage:date,model,tokenCount",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: {
        transcripts: true,
        subagentTranscripts: true,
        stats: true,
      },
      excludedFields: [
        "~/.claude/.credentials.json",
        "~/.claude.json OAuth and MCP configuration",
        "raw project paths and directory keys",
        "raw session/request/message/agent identifiers",
        "tool_use blocks and tool inputs",
        "tool_result blocks and command output",
        "thinking blocks",
        "internal isMeta messages",
        "history.jsonl prompt-history duplicates",
        "file-history source snapshots",
        "settings and environment values",
      ],
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultHome:
        typeof opts.defaultClaudeCodeHome === "function"
          ? opts.defaultClaudeCodeHome
          : defaultClaudeCodeHome,
    };
    this._homeOverride = canonicalPath(
      opts.claudeHome || opts.claudeCodeHome || opts.profilePath,
      this._deps.fs,
    );
    this.defaultScope = this.resolveDefaultScope();
  }

  _resolveHome(opts = {}) {
    const candidate =
      (typeof opts.claudeHome === "string" && opts.claudeHome.trim()) ||
      (typeof opts.claudeCodeHome === "string" && opts.claudeCodeHome.trim()) ||
      (typeof opts.profilePath === "string" && opts.profilePath.trim()) ||
      this._homeOverride ||
      this._deps.defaultHome();
    return canonicalPath(candidate, this._deps.fs);
  }

  resolveDefaultScope(opts = {}) {
    const home = this._resolveHome(opts);
    if (!home) return undefined;
    return createAccountScope(NAME, normalizeIdentity(home));
  }

  async authenticate(ctx = {}) {
    const home = this._resolveHome(ctx);
    if (!home) {
      return {
        ok: false,
        reason: "CLAUDE_CODE_HOME_UNRESOLVED",
        message: "Claude Code local data directory could not be resolved",
      };
    }
    let local;
    try {
      local = inspectClaudeCodeLocalData(home, { fs: this._deps.fs });
    } catch {
      return {
        ok: false,
        reason: "CLAUDE_CODE_NOT_READABLE",
        message: "Claude Code local data directory is not readable",
      };
    }
    if (local.hasTranscripts || local.hasStats) {
      return {
        ok: true,
        mode: "file-import",
        hasTranscripts: local.hasTranscripts,
        hasStats: local.hasStats,
      };
    }
    return {
      ok: false,
      reason: "CLAUDE_CODE_NOT_FOUND",
      message: "No Claude Code transcripts or statistics were found locally",
    };
  }

  async healthCheck(opts = {}) {
    const result = await this.authenticate(opts);
    return result.ok
      ? { ok: true, lastChecked: Date.now() }
      : {
          ok: false,
          reason: result.reason,
          error: result.message,
          lastChecked: Date.now(),
        };
  }

  async *sync(opts = {}) {
    const auth = await this.authenticate(opts);
    if (!auth.ok) {
      const error = new Error(`${NAME}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const since = parseSince(opts);
    const limit = scanLimit(opts);
    const home = this._resolveHome(opts);
    const homeId = pathFingerprint(home, this._deps.fs);
    const records = [];
    let complete = true;

    try {
      if (opts.include?.transcripts !== false && auth.hasTranscripts) {
        const result = readClaudeCodeTranscripts(home, {
          ...opts,
          fs: this._deps.fs,
          since,
          includeSubagents: opts.include?.subagentTranscripts !== false,
          limit: Number.MAX_SAFE_INTEGER,
        });
        complete = complete && result.complete;
        for (const message of result.messages) {
          records.push({
            kind: "claude-code-message",
            originalId: `${NAME}-message:${homeId}:${message.recordId}`,
            capturedAt: message.capturedAt,
            payload: message.payload,
          });
        }
      }

      if (opts.include?.stats !== false && auth.hasStats) {
        const result = readClaudeCodeStats(home, {
          ...opts,
          fs: this._deps.fs,
          since,
        });
        complete = complete && result.complete;
        for (const activity of result.activity) {
          records.push({
            kind: "claude-code-daily-activity",
            originalId: `${NAME}-daily-activity:${homeId}:${activity.recordId}`,
            capturedAt: activity.capturedAt,
            payload: activity.payload,
          });
        }
        for (const usage of result.modelUsage) {
          records.push({
            kind: "claude-code-daily-model-usage",
            originalId: `${NAME}-daily-model-usage:${homeId}:${usage.recordId}`,
            capturedAt: usage.capturedAt,
            payload: usage.payload,
          });
        }
      }
    } catch (error) {
      throw sanitizedReadError(error);
    }

    records.sort(
      (a, b) =>
        a.capturedAt - b.capturedAt ||
        a.kind.localeCompare(b.kind) ||
        a.originalId.localeCompare(b.originalId),
    );
    if (records.length > limit) {
      records.length = limit;
      complete = false;
    }
    for (const record of records) yield record;

    if (complete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  _source(raw) {
    return {
      adapter: this.name,
      adapterVersion: this.version,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
      originalId: raw.originalId,
    };
  }

  _aiPerson(source, ingestedAt) {
    return {
      id: CLAUDE_AI_PERSON_ID,
      type: ENTITY_TYPES.PERSON,
      subtype: PERSON_SUBTYPES.AI_AGENT,
      names: ["Claude Code"],
      identifiers: { vendor: "anthropic", product: "claude-code" },
      notes: "Claude Code local coding agent",
      ingestedAt,
      source: {
        ...source,
        originalId: "claude-code-ai-agent",
      },
    };
  }

  _sessionTopic(payload, source, ingestedAt) {
    const sessionHash =
      payload.sessionHash || sha256Hex("unknown-claude-code-session");
    const topicId = `topic-claude-code-session-${sessionHash.slice(0, 32)}`;
    return {
      id: topicId,
      type: ENTITY_TYPES.TOPIC,
      name:
        payload.sessionTitle ||
        (payload.isSubagent
          ? "Claude Code subagent session"
          : "Claude Code session"),
      ingestedAt,
      source: {
        ...source,
        originalId: `claude-code-session:${sessionHash}`,
      },
      extra: {
        kind: "claude-code-session",
        sessionHash,
        projectHash: payload.projectHash || null,
        parentSessionHash: payload.parentSessionHash || null,
        agentHash: payload.agentHash || null,
        isSubagent: payload.isSubagent === true,
      },
    };
  }

  normalize(raw) {
    const ingestedAt = Date.now();
    const source = this._source(raw);
    const payload = raw.payload || {};

    if (raw.kind === "claude-code-message") {
      const role = payload.role === "assistant" ? "assistant" : "user";
      const topic = this._sessionTopic(payload, source, ingestedAt);
      const event = {
        id: `event-claude-code-message-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.AI_MESSAGE,
        occurredAt: Number.isSafeInteger(payload.occurredAt)
          ? payload.occurredAt
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: role === "user" ? SELF_PERSON_ID : CLAUDE_AI_PERSON_ID,
        participants: [SELF_PERSON_ID, CLAUDE_AI_PERSON_ID],
        topics: [topic.id],
        content: {
          title:
            role === "user" ? "Claude Code prompt" : "Claude Code response",
          text: typeof payload.text === "string" ? payload.text : "",
        },
        extra: {
          kind: "claude-code-message",
          role,
          projectHash: payload.projectHash || null,
          sessionHash: payload.sessionHash || null,
          parentSessionHash: payload.parentSessionHash || null,
          agentHash: payload.agentHash || null,
          isSubagent: payload.isSubagent === true,
          sourceIndex: payload.sourceIndex,
          textPartCount: payload.textPartCount,
          timestampSource: payload.timestampSource || null,
          model: payload.model || null,
          stopReason: payload.stopReason || null,
          usage: payload.usage || null,
        },
      };
      return {
        ...emptyBatch(),
        events: [event],
        persons: [this._aiPerson(source, ingestedAt)],
        topics: [topic],
      };
    }

    if (raw.kind === "claude-code-daily-activity") {
      const details = [
        payload.messageCount !== null
          ? `messages=${payload.messageCount}`
          : null,
        payload.sessionCount !== null
          ? `sessions=${payload.sessionCount}`
          : null,
        payload.toolCallCount !== null
          ? `toolCalls=${payload.toolCallCount}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
      const event = {
        id: `event-claude-code-daily-activity-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isSafeInteger(payload.occurredAt)
          ? payload.occurredAt
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: SELF_PERSON_ID,
        participants: [SELF_PERSON_ID, CLAUDE_AI_PERSON_ID],
        content: {
          title: "Claude Code daily activity",
          text: details,
        },
        extra: {
          kind: "claude-code-daily-activity",
          date: payload.date || null,
          messageCount: payload.messageCount,
          sessionCount: payload.sessionCount,
          toolCallCount: payload.toolCallCount,
        },
      };
      return {
        ...emptyBatch(),
        events: [event],
        persons: [this._aiPerson(source, ingestedAt)],
      };
    }

    if (raw.kind === "claude-code-daily-model-usage") {
      const event = {
        id: `event-claude-code-daily-model-usage-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isSafeInteger(payload.occurredAt)
          ? payload.occurredAt
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: CLAUDE_AI_PERSON_ID,
        participants: [SELF_PERSON_ID, CLAUDE_AI_PERSON_ID],
        content: {
          title: "Claude Code daily model usage",
          text: `model=${payload.model || "unknown"}, tokens=${payload.tokenCount ?? 0}`,
        },
        extra: {
          kind: "claude-code-daily-model-usage",
          date: payload.date || null,
          model: payload.model || null,
          tokenCount: payload.tokenCount,
        },
      };
      return {
        ...emptyBatch(),
        events: [event],
        persons: [this._aiPerson(source, ingestedAt)],
      };
    }

    throw new Error(`${NAME}.normalize: unsupported raw kind`);
  }
}

module.exports = {
  ClaudeCodeAdapter,
  CLAUDE_CODE_NAME: NAME,
  CLAUDE_CODE_VERSION: VERSION,
};
