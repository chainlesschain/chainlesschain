/**
 * CollaborationSessionManager — cleanup() must stop the heartbeat timer.
 *
 * Bug: _startHeartbeatMonitor did setInterval(() => {... this.endSession ...})
 * and discarded the handle. cleanup() ended sessions but had no way to stop the
 * heartbeat, so it kept firing on a torn-down manager and its closure pinned
 * `this` (timer + manager leak). Fix stores the handle and clears it in cleanup().
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CollaborationSessionManager = require("../../../src/main/knowledge/collaboration-session-manager.js");

describe("CollaborationSessionManager heartbeat timer cleanup", () => {
  it("stores the heartbeat-timer handle and clears it on cleanup()", async () => {
    const m = new CollaborationSessionManager({}, {});
    // constructor calls _startHeartbeatMonitor -> handle must be stored
    expect(m._heartbeatTimer).toBeTruthy();

    await m.cleanup();
    expect(m._heartbeatTimer).toBeNull(); // stopped + nulled (the fix)
  });
});
