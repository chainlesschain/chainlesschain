import { describe, expect, it, vi } from "vitest";

import { computeEventHash } from "../../src/harness/transcript-integrity.js";
import { readSessionHostResumeState } from "../../src/lib/session-host-snapshot.js";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  encodePersistedMessage,
  markDurableSystemMessage,
} from "../../src/lib/session-message-provenance.js";

function chainedEvents(cores) {
  let previousHash = null;
  return cores.map((core) => {
    const hash = computeEventHash(previousHash, core);
    const event = { ...core, prevHash: previousHash, hash };
    previousHash = hash;
    return event;
  });
}

describe("session host streaming resume", () => {
  it("projects a large prefix and compact suffix without requesting an event array", () => {
    const legacyReader = vi.fn(() => {
      throw new Error("legacy all-event reader must not run");
    });
    const summary = markDurableSystemMessage(
      { role: "system", content: "bounded summary" },
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );
    const readMessages = vi.fn(() => [
      { role: "system", content: "stale host prompt" },
      summary,
      { role: "user", content: "small suffix" },
    ]);
    const readVerifiedProjection = vi.fn((_sessionId, createProjection) => {
      const projection = createProjection();
      let previousHash = null;
      let eventCount = 0;
      const emit = (core) => {
        const hash = computeEventHash(previousHash, core);
        projection.accept({ ...core, prevHash: previousHash, hash });
        previousHash = hash;
        eventCount += 1;
      };

      emit({
        type: "session_start",
        timestamp: 1,
        data: { title: "private streaming title" },
      });
      for (let index = 0; index < 20_000; index += 1) {
        emit({
          type: index % 2 ? "assistant_message" : "user_message",
          timestamp: index + 2,
          data: {
            role: index % 2 ? "assistant" : "user",
            content: `${index}:${"x".repeat(128)}`,
          },
        });
      }
      emit({
        type: "compact",
        timestamp: 21_000,
        data: {
          messages: [{ role: "system", content: "bounded summary" }],
        },
      });
      emit({
        type: "user_message",
        timestamp: 21_001,
        data: { role: "user", content: "small suffix" },
      });

      return projection.finish({
        headHash: previousHash,
        eventCount,
        readMessages,
      });
    });

    const state = readSessionHostResumeState("streaming-session", {
      sessionExists: () => true,
      readVerifiedEvents: legacyReader,
      readVerifiedProjection,
    });

    expect(state.messages).toEqual([
      summary,
      { role: "user", content: "small suffix" },
    ]);
    expect(JSON.stringify(state.messages)).not.toContain("_cc_replay");
    expect(JSON.stringify(state.messages)).not.toContain("stale host prompt");
    expect(state.snapshot).toMatchObject({
      verified: true,
      head: { eventCount: 20_003 },
      terminalState: { lastEventType: "user_message" },
    });
    expect(readVerifiedProjection).toHaveBeenCalledTimes(1);
    expect(readMessages).toHaveBeenCalledTimes(1);
    expect(legacyReader).not.toHaveBeenCalled();
    expect(JSON.stringify(state.snapshot)).not.toContain(
      "private streaming title",
    );
  });

  it("retains the legacy verified-event injection fallback", () => {
    const summary = encodePersistedMessage(
      markDurableSystemMessage(
        { role: "system", content: "checkpoint facts" },
        DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
      ),
    );
    const events = chainedEvents([
      {
        type: "session_start",
        timestamp: 1,
        data: { title: "legacy injected" },
      },
      {
        type: "compact",
        timestamp: 2,
        data: {
          messages: [
            { role: "system", content: "legacy stale prompt" },
            summary,
            { role: "user", content: "legacy message" },
          ],
        },
      },
    ]);
    const readVerifiedEvents = vi.fn(() => events);

    const state = readSessionHostResumeState("legacy-session", {
      sessionExists: () => true,
      readVerifiedEvents,
    });

    expect(readVerifiedEvents).toHaveBeenCalledWith("legacy-session");
    expect(state.messages).toEqual([
      { role: "system", content: "checkpoint facts" },
      { role: "user", content: "legacy message" },
    ]);
    expect(JSON.stringify(state.messages)).not.toContain("_cc_replay");
    expect(JSON.stringify(state.messages)).not.toContain("legacy stale prompt");
    expect(state.snapshot.head).toEqual({
      hash: events.at(-1).hash,
      eventCount: events.length,
    });
  });
});
