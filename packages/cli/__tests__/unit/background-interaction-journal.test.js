import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_INTERACTION_JOURNAL_EVENT,
  BackgroundInteractionJournal,
  _deps,
  loadBackgroundInteractionJournal,
  persistBackgroundInteractionJournal,
  rejectPendingBackgroundInteractions,
  updateBackgroundInteractionJournal,
} from "../../src/lib/background-interaction-journal.js";

const binding = {
  backgroundAgentId: "bg-journal-1",
  sessionId: "session-1",
  turnId: "turn-1",
  toolUseId: "tool-1",
  sequence: 1,
};

describe("background interaction durable journal", () => {
  let originalAppend;
  let originalRead;
  let events;

  beforeEach(() => {
    originalAppend = _deps.appendEvent;
    originalRead = _deps.readEvents;
    events = [];
    _deps.appendEvent = vi.fn((sessionId, type, data) => {
      events.push({ sessionId, type, data: structuredClone(data) });
    });
    _deps.readEvents = vi.fn(() =>
      events.map(({ type, data }) => ({ type, data: structuredClone(data) })),
    );
  });

  afterEach(() => {
    _deps.appendEvent = originalAppend;
    _deps.readEvents = originalRead;
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

  it("does not mutate the live journal when persistence fails", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    _deps.appendEvent = vi.fn(() => {
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

  it("persists snapshots through the explicit API", () => {
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: "bg-journal-1",
    });
    expect(persistBackgroundInteractionJournal("session-1", journal)).toBe(
      true,
    );
    expect(_deps.appendEvent).toHaveBeenCalledOnce();
  });
});
