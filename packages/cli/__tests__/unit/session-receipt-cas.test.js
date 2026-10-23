import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  startSession,
  readVerifiedMessages,
  readVerifiedEvents,
  appendToolRoundsIfMessagesMatch,
} from "../../src/harness/jsonl-session-store.js";
import {
  appendSessionInputWithReceipt,
  readSessionInputReceipt,
} from "../../src/lib/session-input-receipt.js";

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-receipt-cas-"));
  vi.stubEnv("CHAINLESSCHAIN_HOME", join(root, "home"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "anchors"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it.each([false, true])(
  "rejects concurrent equal-content input with a distinct receipt using fresh expected=%s",
  (fresh) => {
    const id = "same-content-concurrent";
    startSession(id, {});
    const first = appendSessionInputWithReceipt(id, "same user text", "first");
    const expected = readVerifiedMessages(id);
    const live = [
      ...expected,
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "read",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "read", content: "completed evidence" },
    ];
    const second = appendSessionInputWithReceipt(
      id,
      "same user text",
      "second",
    );
    const actual = readVerifiedMessages(id);
    expect(() =>
      appendToolRoundsIfMessagesMatch(id, live, fresh ? actual : expected),
    ).toThrowError(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
    expect(readVerifiedMessages(id)).toEqual(actual);
    expect(actual).toHaveLength(2);
    expect(
      readVerifiedEvents(id).some((event) => event.type === "tool_round"),
    ).toBe(false);
    for (const [clientMessageId, receipt] of [
      ["first", first],
      ["second", second],
    ]) {
      expect(
        readSessionInputReceipt(id, clientMessageId).receipt,
      ).toMatchObject({
        eventHash: receipt.eventHash,
        inputDigest: receipt.inputDigest,
      });
      expect(
        appendSessionInputWithReceipt(id, "same user text", clientMessageId)
          .duplicate,
      ).toBe(true);
      expect(() =>
        appendSessionInputWithReceipt(id, "changed input", clientMessageId),
      ).toThrow("different input");
    }
  },
);
