import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BACKGROUND_INTERACTION_JOURNAL_EVENT,
  BackgroundInteractionJournal,
  _deps,
  classifyLateBackgroundInteractionSettlement,
  loadBackgroundInteractionJournal,
  persistBackgroundInteractionJournal,
  rejectPendingBackgroundInteractions,
  updateBackgroundInteractionJournal,
} from "../../src/lib/background-interaction-journal.js";
import {
  deleteJsonlSession,
  sessionPath,
  startSession,
} from "../../src/harness/jsonl-session-store.js";

const binding = {
  backgroundAgentId: "bg-journal-1",
  sessionId: "session-1",
  turnId: "turn-1",
  toolUseId: "tool-1",
  sequence: 1,
};

describe("background interaction durable journal", () => {
  let originalAppend;
  let originalPresence;
  let originalReadVerified;
  let events;

  beforeEach(() => {
    originalAppend = _deps.appendEventWithVerifiedProjection;
    originalPresence = _deps.getSessionPresence;
    originalReadVerified = _deps.readVerifiedEvents;
    events = [{ type: "session_start", data: {} }];
    _deps.appendEventWithVerifiedProjection = vi.fn(
      (sessionId, type, data, { createProjection, validateProjection }) => {
        const projection = createProjection();
        for (const event of events) projection.accept(structuredClone(event));
        validateProjection(projection.finish(), {
          headHash: null,
          eventCount: events.length,
        });
        events.push({ sessionId, type, data: structuredClone(data) });
        return { hash: "mock-hash" };
      },
    );
    _deps.readVerifiedEvents = vi.fn(() =>
      events.map(({ type, data }) => ({ type, data: structuredClone(data) })),
    );
    _deps.getSessionPresence = vi.fn(() => "present");
  });

  afterEach(() => {
    _deps.appendEventWithVerifiedProjection = originalAppend;
    _deps.getSessionPresence = originalPresence;
    _deps.readVerifiedEvents = originalReadVerified;
  });

  it("persists pending before settlement and reloads the terminal answer", () => {
    let journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
      now: () => 100,
    });
    let mutation = updateBackgroundInteractionJournal(
      "session-1",
      journal,
      (draft) =>
        draft.recordPending({
          requestId: "request-1",
          binding,
          payload: { kind: "question", question: "Deploy?" },
        }),
    );
    journal = mutation.journal;
    expect(events.at(-1).type).toBe(BACKGROUND_INTERACTION_JOURNAL_EVENT);
    expect(journal.pending()).toHaveLength(1);

    mutation = updateBackgroundInteractionJournal(
      "session-1",
      journal,
      (draft) =>
        draft.settle("request-1", binding, {
          status: "resolved",
          answer: "yes",
        }),
      { now: () => 200 },
    );
    journal = mutation.journal;

    const loaded = loadBackgroundInteractionJournal(
      "session-1",
      "bg-journal-1",
    );
    expect(loaded.get("request-1")).toMatchObject({
      status: "resolved",
      settledAt: 200,
      settlement: { status: "resolved", answer: "yes", error: null },
    });
  });

  it("accepts the same settlement idempotently and rejects a conflicting answer", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    journal.recordPending({
      requestId: "request-1",
      binding,
      payload: { question: "Deploy?" },
    });
    expect(
      journal.settle("request-1", binding, {
        status: "resolved",
        answer: "yes",
      }).applied,
    ).toBe(true);
    expect(
      journal.settle("request-1", binding, {
        status: "resolved",
        answer: "yes",
      }).applied,
    ).toBe(false);
    expect(() =>
      journal.settle("request-1", binding, {
        status: "resolved",
        answer: "no",
      }),
    ).toThrow(/already settled/);
  });

  it("rejects stale and cross-turn settlements", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    journal.recordPending({
      requestId: "request-1",
      binding,
      payload: { question: "Deploy?" },
    });
    expect(() =>
      journal.settle(
        "request-1",
        { ...binding, turnId: "different-turn" },
        { status: "resolved", answer: "yes" },
      ),
    ).toThrow(/binding does not match/);
    expect(journal.get("request-1").status).toBe("pending");
  });

  it("rejects a newly added cross-session request before any append", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    expect(() =>
      updateBackgroundInteractionJournal("session-1", journal, (draft) =>
        draft.recordPending({
          requestId: "request-cross-session",
          binding: { ...binding, sessionId: "session-other" },
          payload: { question: "Deploy?" },
        }),
      ),
    ).toThrow(/complete interaction binding/);
    expect(_deps.appendEventWithVerifiedProjection).not.toHaveBeenCalled();
  });

  it("does not mutate the live journal when persistence fails", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    _deps.appendEventWithVerifiedProjection = vi.fn(() => {
      throw new Error("disk unavailable");
    });
    expect(() =>
      updateBackgroundInteractionJournal("session-1", journal, (draft) =>
        draft.recordPending({
          requestId: "request-1",
          binding,
          payload: { question: "Deploy?" },
        }),
      ),
    ).toThrow(/journal write failed/);
    expect(journal.records).toEqual([]);
  });

  it("adjudicates an unknown-but-committed pending snapshot by exact verified readback", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    let failAfterCommit = true;
    _deps.appendEventWithVerifiedProjection = vi.fn((sessionId, type, data) => {
      events.push({ sessionId, type, data: structuredClone(data) });
      if (failAfterCommit) {
        failAfterCommit = false;
        const error = new Error("anchor settlement unavailable");
        error.commitState = "unknown";
        throw error;
      }
    });

    const mutation = updateBackgroundInteractionJournal(
      "session-1",
      journal,
      (draft) =>
        draft.recordPending({
          requestId: "request-unknown-commit",
          binding,
          payload: { question: "Deploy?" },
        }),
    );
    expect(mutation.adjudicated).toBe(true);
    expect(journal.records).toEqual([]);
    expect(mutation.journal.pending()).toHaveLength(1);
    expect(events.at(-1).data.records[0].status).toBe("pending");

    const recovery = rejectPendingBackgroundInteractions(
      "session-1",
      "bg-journal-1",
      {
        code: "INTERACTION_CHILD_EXITED",
        message: "child exited",
      },
    );
    expect(recovery.changed).toBe(true);
    expect(recovery.journal.get("request-unknown-commit")).toMatchObject({
      status: "rejected",
      settlement: { error: { code: "INTERACTION_CHILD_EXITED" } },
    });
    expect(events).toHaveLength(3);
  });

  it("adjudicates an unknown terminal commit and rejects a stale cancellation", () => {
    let journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
      now: () => 100,
    });
    journal = updateBackgroundInteractionJournal(
      "session-1",
      journal,
      (draft) =>
        draft.recordPending({
          requestId: "request-terminal-unknown",
          binding,
          payload: { question: "Deploy?" },
        }),
    ).journal;
    const stale = BackgroundInteractionJournal.fromJSON(journal.toJSON(), {
      now: () => 300,
      expectedSessionId: "session-1",
    });
    const append = _deps.appendEventWithVerifiedProjection;
    let unknownOnce = true;
    _deps.appendEventWithVerifiedProjection = vi.fn((...args) => {
      const written = append(...args);
      if (unknownOnce) {
        unknownOnce = false;
        const error = new Error("terminal anchor response lost");
        error.commitState = "unknown";
        throw error;
      }
      return written;
    });

    const resolved = updateBackgroundInteractionJournal(
      "session-1",
      journal,
      (draft) =>
        draft.settle("request-terminal-unknown", binding, {
          status: "resolved",
          answer: "yes",
        }),
      { now: () => 200 },
    );
    expect(resolved.adjudicated).toBe(true);
    expect(resolved.journal.get("request-terminal-unknown")).toMatchObject({
      status: "resolved",
      settlement: { answer: "yes" },
    });
    expect(() =>
      updateBackgroundInteractionJournal(
        "session-1",
        stale,
        (draft) =>
          draft.settle("request-terminal-unknown", binding, {
            status: "cancelled",
            error: { code: "INTERACTION_CANCELLED", message: "timeout" },
          }),
        { now: () => 300 },
      ),
    ).toThrow(/journal write failed/);
    expect(
      loadBackgroundInteractionJournal("session-1", "bg-journal-1").get(
        "request-terminal-unknown",
      ),
    ).toMatchObject({ status: "resolved", settlement: { answer: "yes" } });
  });

  it("does not lose an unknown-committed first request to an empty stale writer", () => {
    const empty = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    const staleEmpty = BackgroundInteractionJournal.fromJSON(empty.toJSON(), {
      expectedSessionId: "session-1",
    });
    const append = _deps.appendEventWithVerifiedProjection;
    let unknownOnce = true;
    _deps.appendEventWithVerifiedProjection = vi.fn((...args) => {
      const written = append(...args);
      if (unknownOnce) {
        unknownOnce = false;
        const error = new Error("pending anchor response lost");
        error.commitState = "unknown";
        throw error;
      }
      return written;
    });
    const first = updateBackgroundInteractionJournal(
      "session-1",
      empty,
      (draft) =>
        draft.recordPending({
          requestId: "request-first",
          binding,
          payload: { question: "First?" },
        }),
    );
    expect(first.adjudicated).toBe(true);

    expect(() =>
      updateBackgroundInteractionJournal("session-1", staleEmpty, (draft) =>
        draft.recordPending({
          requestId: "request-second",
          binding: { ...binding, toolUseId: "tool-2", sequence: 2 },
          payload: { question: "Second?" },
        }),
      ),
    ).toThrow(/journal write failed/);
    const authoritative = loadBackgroundInteractionJournal(
      "session-1",
      "bg-journal-1",
    );
    expect(authoritative.get("request-first")?.status).toBe("pending");
    expect(authoritative.get("request-second")).toBeNull();
  });

  it("enforces first-terminal-wins across two stale journal writers", () => {
    let initial = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
      now: () => 100,
    });
    initial = updateBackgroundInteractionJournal(
      "session-1",
      initial,
      (draft) =>
        draft.recordPending({
          requestId: "request-race",
          binding,
          payload: { question: "Deploy?" },
        }),
    ).journal;
    const stale = BackgroundInteractionJournal.fromJSON(initial.toJSON(), {
      now: () => 300,
      expectedSessionId: "session-1",
    });
    const resolved = updateBackgroundInteractionJournal(
      "session-1",
      initial,
      (draft) =>
        draft.settle("request-race", binding, {
          status: "resolved",
          answer: "yes",
        }),
      { now: () => 200 },
    );
    expect(resolved.journal.get("request-race").status).toBe("resolved");
    expect(() =>
      updateBackgroundInteractionJournal(
        "session-1",
        stale,
        (draft) =>
          draft.settle("request-race", binding, {
            status: "cancelled",
            error: { code: "INTERACTION_CANCELLED", message: "timeout" },
          }),
        { now: () => 300 },
      ),
    ).toThrow(/journal write failed/);
    expect(
      loadBackgroundInteractionJournal("session-1", "bg-journal-1").get(
        "request-race",
      ),
    ).toMatchObject({ status: "resolved", settlement: { answer: "yes" } });
  });

  it("rejects incomplete or cross-session fallback evidence without appending", () => {
    const before = events.length;
    expect(() =>
      rejectPendingBackgroundInteractions("session-1", "bg-journal-1", {
        fallbackRequest: {
          requestId: "request-invalid",
          binding: { ...binding, turnId: "" },
          payload: { question: "Deploy?" },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INTERACTION_RECOVERY_FALLBACK_INVALID",
      }),
    );
    expect(() =>
      rejectPendingBackgroundInteractions("session-1", "bg-journal-1", {
        fallbackRequest: {
          requestId: "request-other-session",
          binding: { ...binding, sessionId: "session-other" },
          payload: { question: "Deploy?" },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INTERACTION_RECOVERY_FALLBACK_INVALID",
      }),
    );
    expect(events).toHaveLength(before);
  });

  it("allows only a truly absent session to remain an empty bootstrap/no-op", () => {
    _deps.getSessionPresence = vi.fn(() => "absent");
    _deps.readVerifiedEvents = vi.fn(() => []);
    const loaded = loadBackgroundInteractionJournal(
      "session-new",
      "bg-journal-1",
      { allowAbsent: true },
    );
    expect(loaded.records).toEqual([]);
    expect(
      rejectPendingBackgroundInteractions("session-new", "bg-journal-1"),
    ).toMatchObject({ changed: false, rejected: [] });
    expect(_deps.appendEventWithVerifiedProjection).not.toHaveBeenCalled();

    expect(() =>
      loadBackgroundInteractionJournal("session-new", "bg-journal-1"),
    ).toThrow(/journal read failed/);
    expect(() =>
      rejectPendingBackgroundInteractions("session-new", "bg-journal-1", {
        fallbackRequest: {
          requestId: "request-new",
          binding: { ...binding, sessionId: "session-new" },
          payload: { question: "Deploy?" },
        },
      }),
    ).toThrow();
  });

  it("fails closed on a hash-valid transcript with duplicate session genesis", () => {
    _deps.getSessionPresence = vi.fn(() => "present");
    _deps.readVerifiedEvents = vi.fn(() => [
      { type: "session_start", data: {} },
      { type: "session_start", data: {} },
    ]);
    expect(() =>
      rejectPendingBackgroundInteractions("session-1", "bg-journal-1"),
    ).toThrow(/journal read failed/);
    expect(_deps.appendEventWithVerifiedProjection).not.toHaveBeenCalled();
  });

  it("imports a pre-journal pendingQuestion and rejects it exactly once on recovery", () => {
    const first = rejectPendingBackgroundInteractions(
      "session-1",
      "bg-journal-1",
      {
        fallbackRequest: {
          requestId: "request-legacy",
          binding,
          payload: { question: "Deploy?" },
          createdAt: 50,
        },
      },
    );
    expect(first.changed).toBe(true);
    expect(first.rejected).toHaveLength(1);
    expect(first.journal.get("request-legacy")).toMatchObject({
      status: "rejected",
      settlement: {
        error: { code: "INTERACTION_WORKER_LOST" },
      },
    });

    const second = rejectPendingBackgroundInteractions(
      "session-1",
      "bg-journal-1",
    );
    expect(second.changed).toBe(false);
    expect(second.rejected).toEqual([]);
  });

  it("never creates recovery genesis for absent, missing, or tombstoned sessions", () => {
    _deps.appendEventWithVerifiedProjection = originalAppend;
    _deps.getSessionPresence = originalPresence;
    _deps.readVerifiedEvents = originalReadVerified;
    const root = mkdtempSync(join(tmpdir(), "cc-interaction-recovery-"));
    const previousHome = process.env.CHAINLESSCHAIN_HOME;
    const previousAnchor = process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
    process.env.CHAINLESSCHAIN_HOME = join(root, "home");
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = join(root, "anchors");

    const recover = (sessionId) =>
      rejectPendingBackgroundInteractions(sessionId, "bg-journal-1", {
        fallbackRequest: {
          requestId: `request-${sessionId}`,
          binding: { ...binding, sessionId },
          payload: { question: "Deploy?" },
          createdAt: 50,
        },
      });

    try {
      const absentId = "interaction-recovery-absent";
      const absentPath = sessionPath(absentId);
      const absentMeta = join(dirname(absentPath), `${absentId}.meta.json`);
      expect(() => recover(absentId)).toThrowError(
        expect.objectContaining({
          code: "INTERACTION_RECOVERY_SESSION_UNAVAILABLE",
        }),
      );
      expect(existsSync(absentPath)).toBe(false);
      expect(existsSync(absentMeta)).toBe(false);

      const missingId = "interaction-recovery-missing";
      startSession(missingId, { provider: "test", model: "fake" });
      const missingPath = sessionPath(missingId);
      rmSync(missingPath);
      expect(() => recover(missingId)).toThrow();
      expect(existsSync(missingPath)).toBe(false);

      const tombstonedId = "interaction-recovery-tombstoned";
      startSession(tombstonedId, { provider: "test", model: "fake" });
      deleteJsonlSession(tombstonedId);
      const tombstonedPath = sessionPath(tombstonedId);
      expect(() => recover(tombstonedId)).toThrow();
      expect(existsSync(tombstonedPath)).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = previousHome;
      if (previousAnchor === undefined) {
        delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
      } else {
        process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = previousAnchor;
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("persists snapshots through the explicit API", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    expect(persistBackgroundInteractionJournal("session-1", journal)).toBe(
      true,
    );
    expect(_deps.appendEventWithVerifiedProjection).toHaveBeenCalledOnce();
  });

  it("rejects late settlement of a pending request and only accepts an exact terminal replay", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    journal.recordPending({
      requestId: "request-late",
      binding,
      payload: { question: "Deploy?" },
    });

    expect(
      classifyLateBackgroundInteractionSettlement(
        journal,
        "request-late",
        binding,
        { status: "resolved", answer: "yes" },
      ),
    ).toMatchObject({
      accepted: false,
      reason: "interaction_no_live_child",
    });
    expect(journal.get("request-late").status).toBe("pending");

    journal.settle("request-late", binding, {
      status: "rejected",
      error: { code: "INTERACTION_WORKER_LOST", message: "worker lost" },
    });
    expect(
      classifyLateBackgroundInteractionSettlement(
        journal,
        "request-late",
        binding,
        {
          status: "rejected",
          error: { code: "INTERACTION_WORKER_LOST", message: "worker lost" },
        },
      ),
    ).toEqual({ accepted: true, duplicate: true, delivered: false });
    expect(() =>
      classifyLateBackgroundInteractionSettlement(
        journal,
        "request-late",
        binding,
        { status: "resolved", answer: "yes" },
      ),
    ).toThrow(/already settled/);
  });
});
