import { describe, expect, it, vi } from "vitest";

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
