/**
 * ConnectionPool — re-acquire of a healthy *active* connection (leak guard).
 *
 * Bug: acquireConnection only reused a connection when `isHealthy() && isIdle()`.
 * A healthy but ACTIVE connection matched neither branch and fell through to
 * createConnection, which does `this.connections.set(peerId, conn)` — overwriting
 * the existing entry. The old active connection was orphaned (its underlying
 * socket never closed; violates one-connection-per-peer). P2P connections are
 * long-lived/shared, so a re-acquire of the same peer should return the same
 * connection. Fix reuses any healthy connection (active or idle).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ConnectionPool } = require("../../../src/main/p2p/connection-pool.js");

describe("ConnectionPool re-acquire of an active connection", () => {
  it("reuses a healthy active connection instead of creating a duplicate", async () => {
    const pool = new ConnectionPool({ maxConnections: 10 });
    const fakeConn = { id: "sock1" };
    const createFn = vi.fn(async () => fakeConn);

    const c1 = await pool.acquireConnection("peer1", createFn);
    // The connection is now ACTIVE (not idle). Re-acquire while still active:
    const c2 = await pool.acquireConnection("peer1", createFn);

    expect(createFn).toHaveBeenCalledTimes(1); // reused, not recreated (the fix)
    expect(c2).toBe(c1); // same underlying connection
    expect(pool.connections.size).toBe(1); // one connection per peer (no orphan)
  });
});
