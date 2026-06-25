/**
 * GroupChatSyncManager — cleanup() must stop the periodic cleanup timer.
 *
 * Bug: startCleanup did setInterval(() => this.cleanupMessageCache(), 1h) and
 * discarded the handle. cleanup() cleared the Maps but couldn't stop the timer,
 * so it kept firing hourly on a torn-down manager and its closure pinned `this`
 * (timer + manager leak). Fix stores the handle and clears it in cleanup().
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const GroupChatSyncManager = require("../../../src/main/sync/group-chat-sync-manager.js");

describe("GroupChatSyncManager cleanup timer", () => {
  it("stores the cleanup-timer handle and clears it on cleanup()", () => {
    // enableRealTimeSync:false isolates the cleanup timer (skips realtime setup)
    const m = new GroupChatSyncManager(
      {},
      {},
      {},
      {
        enableRealTimeSync: false,
      },
    );
    expect(m.cleanupTimer).toBeTruthy();

    m.cleanup();
    expect(m.cleanupTimer).toBeNull(); // stopped + nulled (the fix)
  });
});
