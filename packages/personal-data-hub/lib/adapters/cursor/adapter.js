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
  CodeEditorActivityAdapter,
  codeEditorParseSince,
  codeEditorScanLimit,
} = require("../vscode/adapter");
const {
  defaultCursorHome,
  defaultCursorRoot,
  inspectCursorLocalData,
  readAgentTranscripts,
  readAiTracking,
} = require("./cursor-reader");

const NAME = "cursor";
const VERSION = "0.1.0";
const CURSOR_AI_PERSON_ID = "person-ai-cursor";
const SELF_PERSON_ID = "person-self";

const CURSOR_DESCRIPTOR = Object.freeze({
  name: NAME,
  version: VERSION,
  displayName: "Cursor",
  editor: "cursor",
  rootOption: "cursorRoot",
  scopeIdentityKey: "cursorRoot",
  errorPrefix: "CURSOR",
  defaultRoot: defaultCursorRoot,
  capabilities: Object.freeze([
    "sync:cursor-workspace-storage",
    "sync:cursor-globalstorage-sqlite",
    "sync:cursor-local-history-metadata",
    "sync:cursor-agent-transcripts",
    "sync:cursor-ai-tracking-sqlite",
    "sync:profile-directory",
  ]),
});

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

function emptyBatch() {
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function sanitizedCursorReadError(error) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `${NAME}.sync: unable to read the selected Cursor local state (${sourceCode})`,
  );
  wrapped.code = "CURSOR_STATE_READ_FAILED";
  wrapped.sourceCode = sourceCode;
  return wrapped;
}

class CursorAdapter extends CodeEditorActivityAdapter {
  constructor(opts = {}) {
    super(opts, CURSOR_DESCRIPTOR);
    this.dataDisclosure = {
      fields: [
        ...this.dataDisclosure.fields,
        "agent-messages:role,text,projectHash,transcriptHash,sourceIndex,contentPartCount,snapshotTs",
        "conversation-summaries:title,tldr,overview,summaryBullets,model,mode,updatedAt",
        "ai-code-activity:source,fileExtension,model,occurredAt,recordHash",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: {
        ...this.dataDisclosure.defaultInclude,
        agentTranscripts: true,
        aiTracking: true,
      },
      excludedFields: [
        "cursorAuth/accessToken",
        "cursorAuth/refreshToken",
        "cursorAuth/cachedEmail",
        "tracked_file_content.content",
        "gitPath",
        "branchName",
        "commitMessage",
        "absolute project/configuration paths",
        "raw conversation/request identifiers",
      ],
    };
    this._cursorDeps = {
      defaultHome:
        typeof opts.defaultCursorHome === "function"
          ? opts.defaultCursorHome
          : defaultCursorHome,
    };
    this._cursorHomeOverride = canonicalPath(
      opts.cursorHome || opts.cursorHomePath,
      this._deps.fs,
    );
    this.defaultScope = this.resolveDefaultScope();
  }

  _resolveCursorHome(opts = {}) {
    const candidate =
      (typeof opts.cursorHome === "string" && opts.cursorHome.trim()) ||
      (typeof opts.cursorHomePath === "string" && opts.cursorHomePath.trim()) ||
      this._cursorHomeOverride ||
      this._cursorDeps.defaultHome();
    return canonicalPath(candidate, this._deps.fs);
  }

  resolveDefaultScope(opts = {}) {
    const editorRoot = this._resolveRoot(opts);
    const cursorHome = this._resolveCursorHome(opts);
    const identities = [editorRoot, cursorHome]
      .filter(Boolean)
      .map((value) => normalizeIdentity(value));
    if (identities.length === 0) return undefined;
    return createAccountScope(NAME, `cursorRoots:${identities.join("\0")}`);
  }

  async authenticate(ctx = {}) {
    const editor = await super.authenticate(ctx);
    const cursorHome = this._resolveCursorHome(ctx);
    let local = {
      hasAgentTranscripts: false,
      hasAiTracking: false,
    };
    try {
      local = inspectCursorLocalData(cursorHome, { fs: this._deps.fs });
    } catch {
      // Keep authentication path-free; sync will surface a sanitized error.
    }

    if (editor.ok || local.hasAgentTranscripts || local.hasAiTracking) {
      return {
        ok: true,
        mode: "file-import",
        hasWorkspaces: editor.ok && editor.hasWorkspaces === true,
        hasTerminalHistory: editor.ok && editor.hasTerminalHistory === true,
        hasLocalHistory: editor.ok && editor.hasLocalHistory === true,
        hasAgentTranscripts: local.hasAgentTranscripts,
        hasAiTracking: local.hasAiTracking,
      };
    }
    return {
      ok: false,
      reason:
        editor.reason === "CURSOR_ROOT_UNRESOLVED"
          ? "CURSOR_ROOT_UNRESOLVED"
          : "CURSOR_NOT_FOUND",
      message:
        "No Cursor editor state, Agent transcripts, or AI tracking database was found locally",
    };
  }

  async *sync(opts = {}) {
    const auth = await this.authenticate(opts);
    if (!auth.ok) {
      const error = new Error(`${NAME}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const since = codeEditorParseSince(opts, this.name);
    const limit = codeEditorScanLimit(opts, this.name);
    const cursorHome = this._resolveCursorHome(opts);
    const homeId = pathFingerprint(cursorHome, this._deps.fs);
    const records = [];
    let complete = true;

    try {
      const hasEditorState =
        auth.hasWorkspaces || auth.hasTerminalHistory || auth.hasLocalHistory;
      if (opts.include?.editor !== false && hasEditorState) {
        let editorComplete = false;
        for await (const raw of super.sync({
          ...opts,
          limit,
          markWatermarkComplete: () => {
            editorComplete = true;
          },
        })) {
          records.push(raw);
        }
        complete = complete && editorComplete;
      }

      if (
        opts.include?.agentTranscripts !== false &&
        auth.hasAgentTranscripts
      ) {
        const result = readAgentTranscripts(cursorHome, {
          ...opts,
          fs: this._deps.fs,
          since,
          limit,
        });
        complete = complete && result.complete;
        for (const message of result.messages) {
          records.push({
            kind: "cursor-agent-message",
            originalId: `${NAME}-agent-message:${homeId}:${message.recordId}`,
            capturedAt: message.capturedAt,
            payload: message.payload,
          });
        }
      }

      if (opts.include?.aiTracking !== false && auth.hasAiTracking) {
        const result = readAiTracking(cursorHome, {
          ...opts,
          fs: this._deps.fs,
          since,
          limit,
        });
        complete = complete && result.complete;
        for (const summary of result.summaries) {
          records.push({
            kind: "cursor-conversation-summary",
            originalId: `${NAME}-conversation-summary:${homeId}:${summary.recordId}`,
            capturedAt: summary.capturedAt,
            payload: summary.payload,
          });
        }
        for (const event of result.aiCodeEvents) {
          records.push({
            kind: "cursor-ai-code-activity",
            originalId: `${NAME}-ai-code-activity:${homeId}:${event.recordId}`,
            capturedAt: event.capturedAt,
            payload: event.payload,
          });
        }
      }
    } catch (error) {
      if (error?.code === "VSCODE_STATE_READ_FAILED") throw error;
      throw sanitizedCursorReadError(error);
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
      id: CURSOR_AI_PERSON_ID,
      type: ENTITY_TYPES.PERSON,
      subtype: PERSON_SUBTYPES.AI_AGENT,
      names: ["Cursor AI"],
      identifiers: { vendor: "cursor" },
      notes: "Cursor local coding agent",
      ingestedAt,
      source: {
        ...source,
        originalId: "cursor-ai-agent",
      },
    };
  }

  _conversationTopic(payload, source, ingestedAt) {
    const conversationHash =
      payload.transcriptHash ||
      payload.conversationHash ||
      sha256Hex("unknown-cursor-conversation");
    const topicId = `topic-cursor-conversation-${conversationHash.slice(0, 32)}`;
    return {
      id: topicId,
      type: ENTITY_TYPES.TOPIC,
      name: payload.title || "Cursor Agent conversation",
      ingestedAt,
      source: {
        ...source,
        originalId: `cursor-conversation:${conversationHash}`,
      },
      extra: {
        kind: "cursor-agent-conversation",
        conversationHash,
        projectHash: payload.projectHash || null,
        model: payload.model || null,
        mode: payload.mode || null,
      },
    };
  }

  normalize(raw) {
    if (
      raw.kind !== "cursor-agent-message" &&
      raw.kind !== "cursor-conversation-summary" &&
      raw.kind !== "cursor-ai-code-activity"
    ) {
      return super.normalize(raw);
    }

    const payload = raw.payload || {};
    const ingestedAt = Date.now();
    const source = this._source(raw);

    if (raw.kind === "cursor-agent-message") {
      const topic = this._conversationTopic(payload, source, ingestedAt);
      const role = payload.role === "assistant" ? "assistant" : "user";
      const event = {
        id: `event-cursor-agent-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.AI_MESSAGE,
        occurredAt: Number.isInteger(payload.snapshotTs)
          ? payload.snapshotTs
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: role === "user" ? SELF_PERSON_ID : CURSOR_AI_PERSON_ID,
        participants: [SELF_PERSON_ID, CURSOR_AI_PERSON_ID],
        topics: [topic.id],
        content: {
          title: role === "user" ? "Cursor prompt" : "Cursor response",
          text: typeof payload.text === "string" ? payload.text : "",
        },
        extra: {
          kind: "cursor-agent-message",
          role,
          projectHash: payload.projectHash || null,
          transcriptHash: payload.transcriptHash || null,
          sourceIndex: payload.sourceIndex,
          contentPartCount: payload.contentPartCount,
          timestampSource: "transcript-file-mtime",
          editor: "cursor",
        },
      };
      return {
        ...emptyBatch(),
        events: [event],
        persons: [this._aiPerson(source, ingestedAt)],
        topics: [topic],
      };
    }

    if (raw.kind === "cursor-conversation-summary") {
      const topic = this._conversationTopic(payload, source, ingestedAt);
      const text = [payload.tldr, payload.overview, payload.summaryBullets]
        .filter((value) => typeof value === "string" && value)
        .join("\n\n");
      const event = {
        id: `event-cursor-summary-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.AI_MESSAGE,
        occurredAt: Number.isInteger(payload.updatedAt)
          ? payload.updatedAt
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: CURSOR_AI_PERSON_ID,
        participants: [SELF_PERSON_ID, CURSOR_AI_PERSON_ID],
        topics: [topic.id],
        content: {
          title: payload.title || "Cursor conversation summary",
          text,
        },
        extra: {
          kind: "cursor-conversation-summary",
          conversationHash: payload.conversationHash || null,
          model: payload.model || null,
          mode: payload.mode || null,
          editor: "cursor",
        },
      };
      return {
        ...emptyBatch(),
        events: [event],
        persons: [this._aiPerson(source, ingestedAt)],
        topics: [topic],
      };
    }

    const details = [
      payload.source ? `source=${payload.source}` : null,
      payload.model ? `model=${payload.model}` : null,
      payload.fileExtension ? `extension=${payload.fileExtension}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const event = {
      id: `event-cursor-ai-code-${sha256Hex(raw.originalId, 32)}`,
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.OTHER,
      occurredAt: Number.isInteger(payload.occurredAt)
        ? payload.occurredAt
        : raw.capturedAt,
      ingestedAt,
      source,
      actor: CURSOR_AI_PERSON_ID,
      participants: [SELF_PERSON_ID, CURSOR_AI_PERSON_ID],
      content: {
        title: "Cursor AI code activity",
        text: details,
      },
      extra: {
        kind: "cursor-ai-code-activity",
        recordHash: payload.recordHash || null,
        source: payload.source || null,
        fileExtension: payload.fileExtension || null,
        model: payload.model || null,
        editor: "cursor",
      },
    };
    return {
      ...emptyBatch(),
      events: [event],
      persons: [this._aiPerson(source, ingestedAt)],
    };
  }
}

module.exports = {
  CursorAdapter,
  CURSOR_NAME: NAME,
  CURSOR_VERSION: VERSION,
};
