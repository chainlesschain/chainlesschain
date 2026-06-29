/**
 * GroupChatManager.createGroup — member_count initialization
 *
 * Regression: createGroup pre-seeded member_count = memberDids.length + 1, then
 * called addGroupMember for the creator AND every initial member — each of which
 * does `member_count = member_count + 1`. So a group with 2 initial members got
 * member_count = 6 (should be 3). Fix: initialize member_count to 0 and let the
 * addGroupMember calls populate it.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const GroupChatManager = require("../group-chat-manager.js");

describe("GroupChatManager.createGroup — member_count", () => {
  it("initializes member_count to 0 so addGroupMember populates it (no double-count)", async () => {
    const runCalls = [];
    const db = {
      prepare: vi.fn((sql) => ({
        run: vi.fn((...args) => {
          runCalls.push({ sql, args });
          return { changes: 1 };
        }),
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      })),
    };
    const mgr = new GroupChatManager(db, null, null);
    mgr.currentUserDid = "did:creator";

    await mgr
      .createGroup({
        name: "G",
        memberDids: ["did:a", "did:b"],
        encrypted: false,
      })
      .catch(() => {});

    const groupInsert = runCalls.find((c) =>
      /INSERT INTO group_chats/i.test(c.sql),
    );
    expect(groupInsert).toBeTruthy();
    // member_count is the 8th positional value (index 7) in the INSERT.
    expect(groupInsert.args[7]).toBe(0);

    // creator + 2 initial members → 3 group_members inserts, each +1 → count 3.
    const memberInserts = runCalls.filter((c) =>
      /INSERT INTO group_members/i.test(c.sql),
    );
    expect(memberInserts.length).toBe(3);
  });
});
