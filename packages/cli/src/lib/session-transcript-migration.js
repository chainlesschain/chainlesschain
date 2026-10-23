import { createHash } from "node:crypto";

import {
  appendEvent,
  appendAuthorityEventWithVerifiedProjection,
  findLatestEvent,
  listSessionAuthoritySummaries,
  readVerifiedMessages,
  sessionHasPersistedEvidence,
  startSession,
} from "../harness/jsonl-session-store.js";
import {
  getSession as getDatabaseSession,
  listSessions as listDatabaseSessions,
} from "./session-manager.js";
import {
  sanitizeConversationMessage,
  sanitizePersistedMessages,
} from "./session-message-provenance.js";

export const SESSION_STORE_MIGRATION_EVENT = "session_store_migrated";
export const SESSION_STORE_MIGRATION_SCHEMA =
  "chainlesschain.session-store-migration/v1";

function migrationError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SessionTranscriptMigrationError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function timestampEpoch(value) {
  if (typeof value !== "string" || !value) return 0;
  const normalized =
    value.includes(" ") && !value.includes("T")
      ? `${value.replace(" ", "T")}Z`
      : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalMessages(messages, { stripLeadingSystem = true } = {}) {
  const sanitized = sanitizePersistedMessages(messages || [], { strict: true });
  let start = 0;
  // Legacy WS sessions own exactly the first system message as their host
  // prompt. Later leading system messages can be recovery notices or compacted
  // summaries and therefore remain logical transcript content.
  if (stripLeadingSystem && sanitized[0]?.role === "system") start = 1;
  return sanitized.slice(start);
}

function messagesDigest(messages) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(messages))
    .digest("hex")}`;
}

/**
 * Import a legacy physical session snapshot into the verified canonical
 * transcript. The two-event sequence is restartable: a crash after
 * session_start leaves an empty verified prefix which a retry can complete.
 */
export function ensureCanonicalSessionTranscript(
  {
    sessionId,
    title = "Untitled",
    provider = "",
    model = "",
    messages = [],
    source = "legacy",
    stripLeadingSystem = true,
  },
  dependencies = {},
) {
  const deps = {
    appendEvent,
    appendAuthorityEventWithVerifiedProjection,
    findLatestEvent,
    readVerifiedMessages,
    sessionHasPersistedEvidence,
    startSession,
    ...dependencies,
  };
  const id = String(sessionId || "").trim();
  if (!id) {
    throw migrationError(
      "CC_SESSION_MIGRATION_INVALID",
      "sessionId is required for transcript migration",
    );
  }
  const importedMessages = canonicalMessages(messages, { stripLeadingSystem });
  const digest = messagesDigest(importedMessages);

  const existed = deps.sessionHasPersistedEvidence(id);
  if (!existed) {
    deps.startSession(id, { title, provider, model });
  }

  const completed = deps.findLatestEvent(id, SESSION_STORE_MIGRATION_EVENT);
  if (completed) {
    if (
      completed.data?.source !== source ||
      completed.data?.messagesDigest !== digest
    ) {
      throw migrationError(
        "CC_SESSION_MIGRATION_CONFLICT",
        `session ${id} was already imported from different content`,
        { sessionId: id },
      );
    }
    return Object.freeze({
      sessionId: id,
      migrated: false,
      messages: deps.readVerifiedMessages(id),
      source,
      messagesDigest: digest,
    });
  }

  const migration = {
    schema: SESSION_STORE_MIGRATION_SCHEMA,
    source,
    messagesDigest: digest,
    messageCount: importedMessages.length,
  };
  const conflict = () =>
    migrationError(
      "CC_SESSION_MIGRATION_CONFLICT",
      `canonical transcript already contains different messages: ${id}`,
      { sessionId: id },
    );
  const currentMessages = deps.readVerifiedMessages(id);
  let recoveredImport = false;
  if (currentMessages.length > 0) {
    const snapshot = deps.findLatestEvent(id, "compact");
    if (snapshot?.data?.reason === "physical-store-import") {
      // Conversation replay omits input receipt metadata. Recover an interrupted
      // import only from the exact raw snapshot, never normalized equality alone.
      // Recheck both evidence and live replay under the marker's writer lock.
      deps.appendAuthorityEventWithVerifiedProjection(
        id,
        SESSION_STORE_MIGRATION_EVENT,
        migration,
        {
          createProjection: () => {
            let latest = null;
            let completed = false;
            return {
              accept(event) {
                if (event.type === "compact") latest = event.data;
                if (event.type === SESSION_STORE_MIGRATION_EVENT)
                  completed = true;
              },
              finish: () => ({ latest, completed }),
            };
          },
          validateProjection({ latest, completed }, authority) {
            if (
              completed ||
              latest?.reason !== "physical-store-import" ||
              !Array.isArray(latest.messages) ||
              messagesDigest(latest.messages) !== digest ||
              // Old snapshots did not record a source label. Their exact raw
              // source bytes remain the only available import identity proof.
              (Object.hasOwn(latest, "migration") &&
                (latest.migration?.schema !== migration.schema ||
                  latest.migration.source !== source ||
                  latest.migration.messagesDigest !== digest)) ||
              messagesDigest(authority.readMessages()) !==
                messagesDigest(
                  importedMessages.map(sanitizeConversationMessage),
                )
            )
              throw conflict();
          },
        },
      );
      recoveredImport = true;
    } else if (messagesDigest(currentMessages) !== digest) {
      throw conflict();
    }
  } else if (importedMessages.length > 0) {
    deps.appendEvent(id, "compact", {
      messages: importedMessages,
      originalMessages: importedMessages.length,
      compressedMessages: importedMessages.length,
      reason: "physical-store-import",
      migration,
    });
  }

  if (!recoveredImport)
    deps.appendEvent(id, SESSION_STORE_MIGRATION_EVENT, migration);
  return Object.freeze({
    sessionId: id,
    migrated: true,
    messages: deps.readVerifiedMessages(id),
    source,
    messagesDigest: digest,
  });
}

export function ensureCanonicalSessionFromDatabase(
  database,
  sessionId,
  dependencies = {},
) {
  if (!database) return null;
  const readDatabaseSession =
    dependencies.getDatabaseSession || getDatabaseSession;
  const session = readDatabaseSession(database, sessionId);
  if (!session) return null;
  return ensureCanonicalSessionTranscript(
    {
      sessionId: session.id,
      title: session.title || "Untitled",
      provider: session.provider || "",
      model: session.model || "",
      messages: session.messages || [],
      source: "sqlite:llm_sessions",
      stripLeadingSystem: true,
    },
    dependencies,
  );
}

/** Resolve the newest readable logical session across JSONL and legacy DB. */
export function getLastLogicalSessionId(database = null, dependencies = {}) {
  const listCanonical =
    dependencies.listSessionAuthoritySummaries || listSessionAuthoritySummaries;
  const listLegacy = dependencies.listDatabaseSessions || listDatabaseSessions;
  const canonical = listCanonical({ limit: 1 }).find(
    (session) => session?._blocked !== true,
  );
  const legacy = database ? listLegacy(database, { limit: 1 })[0] : null;
  if (!canonical) return legacy?.id || null;
  if (!legacy || canonical.id === legacy.id) return canonical.id;
  return timestampEpoch(legacy.updated_at) >
    timestampEpoch(canonical.updated_at)
    ? legacy.id
    : canonical.id;
}
