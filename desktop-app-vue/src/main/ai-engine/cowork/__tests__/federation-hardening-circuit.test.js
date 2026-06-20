import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FederationHardening, CIRCUIT_STATE } from "../federation-hardening.js";

function makeDb() {
  const runs = [];
  const db = {
    _runs: runs,
    exec: vi.fn(),
    prepare: vi.fn((sql) => ({
      run: (...args) => {
        runs.push({ sql, args });
        return { changes: 1 };
      },
      all: () => [],
      get: () => undefined,
    })),
  };
  return { db };
}

const cbWrites = (database) =>
  database.db._runs.filter((r) => r.sql.includes("federation_circuit_breakers"));

describe("FederationHardening circuit breaker", () => {
  it("persists every recorded failure (regression: was in-memory only, lost on restart)", async () => {
    const database = makeDb();
    const fh = new FederationHardening(database);
    await fh.recordFailure("node-1");
    const writes = cbWrites(database);
    expect(writes).toHaveLength(1);
    // args: id, node_id, state, failure_count, last_failure_at, opened_at, created_at
    expect(writes[0].args[1]).toBe("node-1");
    expect(writes[0].args[2]).toBe(CIRCUIT_STATE.CLOSED);
    expect(writes[0].args[3]).toBe(1);
  });

  it("opens the circuit at the failure threshold and persists the OPEN state", async () => {
    const database = makeDb();
    const fh = new FederationHardening(database); // default threshold = 5
    const opened = vi.fn();
    fh.on("circuit-opened", opened);

    let cb;
    for (let i = 0; i < 5; i++) cb = await fh.recordFailure("n");

    expect(cb.state).toBe(CIRCUIT_STATE.OPEN);
    expect(cb.failure_count).toBe(5);
    expect(cb.opened_at).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(1);

    const writes = cbWrites(database);
    expect(writes).toHaveLength(5); // persisted on every failure, not just on reset
    expect(writes[4].args[2]).toBe(CIRCUIT_STATE.OPEN); // last write reflects OPEN
    expect(writes[4].args[3]).toBe(5);
  });

  it("stays closed below the threshold", async () => {
    const database = makeDb();
    const fh = new FederationHardening(database);
    const cb = await fh.recordFailure("x");
    expect(cb.state).toBe(CIRCUIT_STATE.CLOSED);
  });

  it("works without a database (in-memory only, no throw)", async () => {
    const fh = new FederationHardening(null);
    const cb = await fh.recordFailure("y");
    expect(cb.failure_count).toBe(1);
  });

  it("requires a nodeId", async () => {
    const fh = new FederationHardening(null);
    await expect(fh.recordFailure()).rejects.toThrow(/Node ID is required/);
  });
});
