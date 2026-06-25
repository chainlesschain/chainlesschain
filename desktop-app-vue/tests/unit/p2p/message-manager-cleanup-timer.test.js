/**
 * MessageManager — cleanup() must stop the periodic cleanup timer.
 *
 * Bug: startCleanupTimer did `setInterval(() => this.cleanupExpiredData(), 60000)`
 * and discarded the handle. cleanup() cleared batch/ack timers but had no way to
 * stop this one, so after cleanup() it kept firing every minute forever, and its
 * closure pinned `this` (timer + manager leak). Fix stores the handle and clears
 * it in cleanup().
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const MessageManager = require("../../../src/main/p2p/message-manager.js");

describe("MessageManager cleanup timer", () => {
  it("stores the cleanup-timer handle and clears it on cleanup()", () => {
    const m = new MessageManager({});
    // constructor calls startCleanupTimer -> handle must now be stored
    expect(m.cleanupTimer).toBeTruthy();

    m.cleanup();
    expect(m.cleanupTimer).toBeNull(); // stopped + nulled (the fix)
  });
});
