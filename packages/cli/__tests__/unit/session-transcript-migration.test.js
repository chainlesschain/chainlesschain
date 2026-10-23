import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent,
  appendAuthorityEventWithVerifiedProjection,
  appendUserMessage,
  findLatestEvent,
  readVerifiedMessages,
  startSession,
} from "../../src/harness/jsonl-session-store.js";

import {
  SESSION_STORE_MIGRATION_EVENT,
  ensureCanonicalSessionFromDatabase,
  ensureCanonicalSessionTranscript,
  getLastLogicalSessionId,
} from "../../src/lib/session-transcript-migration.js";

function memoryTranscriptStore() {
  const events = [];
  const messages = [];
  return {
    events,
    messages,
    dependencies: {
      sessionHasPersistedEvidence: vi.fn(() => events.length > 0),
      startSession: vi.fn((sessionId, metadata) => {
        events.push({ type: "session_start", data: metadata });
        return sessionId;
      }),
      appendEvent: vi.fn((_sessionId, type, data) => {
        events.push({ type, data });
        if (type === "compact")
          messages.splice(0, messages.length, ...data.messages);
        return events.at(-1);
      }),
      findLatestEvent: vi.fn((_sessionId, type) =>
        events.filter((event) => event.type === type).at(-1),
      ),
      readVerifiedMessages: vi.fn(() => structuredClone(messages)),
    },
  };
}

describe("logical session transcript migration", () => {
  it("retains a completed legacy migration digest that includes receipt metadata", () => {
    const store = memoryTranscriptStore();
    const input = {
      sessionId: "old-receipt-migration",
      source: "legacy",
      messages: [
        {
          role: "user",
          content: "old input",
          clientMessageId: "old-id",
          inputDigest: "a".repeat(64),
        },
      ],
    };
    const messagesDigest = `sha256:${createHash("sha256").update(JSON.stringify(input.messages)).digest("hex")}`;
    store.events.push({
      type: SESSION_STORE_MIGRATION_EVENT,
      data: { source: input.source, messagesDigest },
    });
    store.messages.push({ role: "user", content: "old input" });
    expect(
      ensureCanonicalSessionTranscript(input, store.dependencies),
    ).toMatchObject({ migrated: false, messagesDigest });
    expect(store.dependencies.appendEvent).not.toHaveBeenCalled();
    expect(() =>
      ensureCanonicalSessionTranscript(
        {
          ...input,
          messages: [{ ...input.messages[0], content: "changed input" }],
        },
        store.dependencies,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
    );
  });

  it("imports DB-shaped messages once and drops the legacy host prompt", () => {
    const store = memoryTranscriptStore();
    const input = {
      sessionId: "db-only-1",
      title: "Legacy",
      provider: "openai",
      model: "gpt-test",
      source: "sqlite:llm_sessions",
      messages: [
        { role: "system", content: "old host prompt" },
        { role: "system", content: "recovery notice" },
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ],
    };

    expect(
      ensureCanonicalSessionTranscript(input, store.dependencies),
    ).toMatchObject({ migrated: true, sessionId: "db-only-1" });
    expect(store.messages).toEqual([
      { role: "system", content: "recovery notice" },
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
    ]);
    expect(
      store.events.filter(
        (event) => event.type === SESSION_STORE_MIGRATION_EVENT,
      ),
    ).toHaveLength(1);

    expect(
      ensureCanonicalSessionTranscript(input, store.dependencies),
    ).toMatchObject({ migrated: false });
    expect(
      store.events.filter(
        (event) => event.type === SESSION_STORE_MIGRATION_EVENT,
      ),
    ).toHaveLength(1);
  });

  it("fails closed if the same logical session contains different content", () => {
    const store = memoryTranscriptStore();
    const base = {
      sessionId: "db-only-conflict",
      source: "sqlite:llm_sessions",
      messages: [{ role: "user", content: "first" }],
    };
    ensureCanonicalSessionTranscript(base, store.dependencies);
    expect(() =>
      ensureCanonicalSessionTranscript(
        { ...base, messages: [{ role: "user", content: "changed" }] },
        store.dependencies,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
    );
  });

  it("imports a DB-only adapter row through the canonical bridge", () => {
    const store = memoryTranscriptStore();
    const getDatabaseSession = vi.fn(() => ({
      id: "db-adapter-1",
      title: "DB adapter",
      provider: "openai",
      model: "gpt-test",
      messages: [
        { role: "system", content: "host prompt" },
        { role: "user", content: "recover this" },
      ],
    }));
    expect(
      ensureCanonicalSessionFromDatabase({}, "db-adapter-1", {
        ...store.dependencies,
        getDatabaseSession,
      }),
    ).toMatchObject({ migrated: true, sessionId: "db-adapter-1" });
    expect(getDatabaseSession).toHaveBeenCalledWith({}, "db-adapter-1");
    expect(store.messages).toEqual([{ role: "user", content: "recover this" }]);
  });

  it("selects the newest logical session across canonical and DB adapters", () => {
    const canonical = vi.fn(() => [
      { id: "jsonl-1", updated_at: "2026-08-30T01:00:00.000Z" },
    ]);
    const database = vi.fn(() => [
      { id: "db-1", updated_at: "2026-08-30 02:00:00" },
    ]);
    expect(
      getLastLogicalSessionId(
        {},
        {
          listSessionAuthoritySummaries: canonical,
          listDatabaseSessions: database,
        },
      ),
    ).toBe("db-1");
  });
});

describe("interrupted physical import with the verified JSONL store", () => {
  let testHome;
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "migration-receipt-recovery-"));
    vi.stubEnv("CHAINLESSCHAIN_HOME", join(testHome, "home"));
    vi.stubEnv(
      "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME",
      join(testHome, "anchors"),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });
  const input = () => ({
    sessionId: "interrupted-legacy",
    source: "sqlite:llm_sessions",
    messages: [
      {
        role: "user",
        content: "same conversation",
        clientMessageId: "original-id",
        inputDigest: "a".repeat(64),
        otherMetadata: "retain me",
      },
    ],
  });
  function writeInterruptedSnapshot(value, extra = {}) {
    startSession(value.sessionId, {});
    appendEvent(value.sessionId, "compact", {
      messages: value.messages,
      originalMessages: value.messages.length,
      compressedMessages: value.messages.length,
      reason: "physical-store-import",
      ...extra,
    });
  }

  it("completes an old raw snapshot after a crash before its migration marker", () => {
    const value = input();
    writeInterruptedSnapshot(value);
    expect(readVerifiedMessages(value.sessionId)).toEqual([
      {
        role: "user",
        content: "same conversation",
        otherMetadata: "retain me",
      },
    ]);
    const digest = `sha256:${createHash("sha256").update(JSON.stringify(value.messages)).digest("hex")}`;
    expect(ensureCanonicalSessionTranscript(value)).toMatchObject({
      migrated: true,
      messagesDigest: digest,
    });
    expect(
      findLatestEvent(value.sessionId, SESSION_STORE_MIGRATION_EVENT).data,
    ).toMatchObject({ source: value.source, messagesDigest: digest });
    expect(findLatestEvent(value.sessionId, "compact").data.messages).toEqual(
      value.messages,
    );
    expect(ensureCanonicalSessionTranscript(value)).toMatchObject({
      migrated: false,
      messagesDigest: digest,
    });
    for (const changed of [
      { ...value, source: "another-store" },
      {
        ...value,
        messages: [{ ...value.messages[0], clientMessageId: "another-id" }],
      },
      {
        ...value,
        messages: [{ ...value.messages[0], inputDigest: "b".repeat(64) }],
      },
    ]) {
      expect(() => ensureCanonicalSessionTranscript(changed)).toThrowError(
        expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
      );
    }
  });

  it.each(["clientMessageId", "inputDigest", "otherMetadata"])(
    "rejects a different raw source %s even if its conversation otherwise matches",
    (field) => {
      const value = input();
      writeInterruptedSnapshot(value);
      const changed = {
        ...value,
        messages: [
          {
            ...value.messages[0],
            [field]: field === "inputDigest" ? "b".repeat(64) : "changed",
          },
        ],
      };
      expect(() => ensureCanonicalSessionTranscript(changed)).toThrowError(
        expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
      );
      expect(
        findLatestEvent(value.sessionId, SESSION_STORE_MIGRATION_EVENT),
      ).toBeNull();
    },
  );

  it("rejects new conversation input after the interrupted snapshot", () => {
    const value = input();
    writeInterruptedSnapshot(value);
    appendUserMessage(value.sessionId, "concurrent input");
    expect(() => ensureCanonicalSessionTranscript(value)).toThrowError(
      expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
    );
    expect(readVerifiedMessages(value.sessionId).at(-1).content).toBe(
      "concurrent input",
    );
    expect(
      findLatestEvent(value.sessionId, SESSION_STORE_MIGRATION_EVENT),
    ).toBeNull();
  });

  it("rechecks current conversation under the marker writer lock", () => {
    const value = input();
    writeInterruptedSnapshot(value);
    expect(() =>
      ensureCanonicalSessionTranscript(value, {
        appendAuthorityEventWithVerifiedProjection: (...args) => {
          appendUserMessage(
            value.sessionId,
            "input arriving before marker lock",
          );
          return appendAuthorityEventWithVerifiedProjection(...args);
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
    );
    expect(readVerifiedMessages(value.sessionId).at(-1).content).toBe(
      "input arriving before marker lock",
    );
    expect(
      findLatestEvent(value.sessionId, SESSION_STORE_MIGRATION_EVENT),
    ).toBeNull();
  });

  it("does not treat an ordinary compact checkpoint as migration evidence", () => {
    const value = input();
    writeInterruptedSnapshot(value, { reason: "automatic-compaction" });
    expect(() => ensureCanonicalSessionTranscript(value)).toThrowError(
      expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
    );
    expect(
      findLatestEvent(value.sessionId, SESSION_STORE_MIGRATION_EVENT),
    ).toBeNull();
  });

  it("binds new interrupted snapshots to their source and raw digest", () => {
    const value = input();
    expect(() =>
      ensureCanonicalSessionTranscript(value, {
        appendEvent: (id, type, data) => {
          if (type === SESSION_STORE_MIGRATION_EVENT)
            throw new Error("simulated marker interruption");
          return appendEvent(id, type, data);
        },
      }),
    ).toThrow("simulated marker interruption");
    const snapshot = findLatestEvent(value.sessionId, "compact");
    expect(snapshot.data.migration).toMatchObject({
      source: value.source,
      messagesDigest: expect.stringMatching(/^sha256:/),
    });
    expect(() =>
      ensureCanonicalSessionTranscript({ ...value, source: "another-store" }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SESSION_MIGRATION_CONFLICT" }),
    );
    expect(ensureCanonicalSessionTranscript(value)).toMatchObject({
      migrated: true,
    });
  });
});
