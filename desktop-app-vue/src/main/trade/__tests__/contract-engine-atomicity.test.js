/**
 * SmartContractEngine state writes must be atomic.
 *
 * createContract inserts the contract row AND its condition set; a partial
 * failure leaves a contract whose conditions are incomplete, so checkConditions
 * / executeContract run against a wrong condition set.
 *
 * initiateArbitration inserts the arbitration record AND flips the contract to
 * DISPUTED; resolveArbitration marks the arbitration 'resolved' AND flips the
 * contract to ARBITRATED. A partial failure desynchronizes the arbitration
 * record from the contract status — e.g. arbitration resolved (and the guard
 * forbids re-resolving) while the contract stays stuck DISPUTED forever.
 *
 * Runs on a real in-memory better-sqlite3 (a mock db can't model rollback).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const {
  SmartContractEngine,
  ContractType,
  EscrowType,
} = require("../contract-engine");

function makeEngine() {
  const sqlite = new Database(":memory:");
  const didManager = { getCurrentIdentity: () => ({ did: "alice" }) };
  const engine = new SmartContractEngine(
    { db: sqlite },
    didManager,
    null,
    null,
  );
  return { sqlite, engine };
}

const baseContract = {
  contractType: ContractType.SIMPLE_TRADE,
  escrowType: EscrowType.SIMPLE,
  title: "T",
  parties: ["alice", "bob"],
  terms: {},
  conditions: [
    { type: "payment_received", data: {} },
    { type: "delivery_confirmed", data: {} },
  ],
};

describe("SmartContractEngine — state-write atomicity (real better-sqlite3)", () => {
  let sqlite;
  let engine;

  beforeEach(async () => {
    ({ sqlite, engine } = makeEngine());
    await engine.initialize();
  });

  it("createContract rolls back the contract row if a condition insert fails", async () => {
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO\s+contract_conditions/.test(sql)) {
        throw new Error("simulated condition write failure");
      }
      return realPrepare(sql);
    };

    await expect(engine.createContract({ ...baseContract })).rejects.toThrow(
      /condition/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: no orphan contract without its conditions.
    expect(sqlite.prepare("SELECT COUNT(*) c FROM contracts").get().c).toBe(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM contract_conditions").get().c,
    ).toBe(0);
  });

  it("a successful createContract persists the contract with all conditions", async () => {
    const contract = await engine.createContract({ ...baseContract });
    expect(sqlite.prepare("SELECT COUNT(*) c FROM contracts").get().c).toBe(1);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) c FROM contract_conditions WHERE contract_id = ?",
        )
        .get(contract.id).c,
    ).toBe(2);
  });

  it("initiateArbitration rolls back the arbitration record if the contract update fails", async () => {
    const contract = await engine.createContract({ ...baseContract });

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE contracts SET status/.test(sql)) {
        throw new Error("simulated contract-status write failure");
      }
      return realPrepare(sql);
    };

    await expect(
      engine.initiateArbitration(contract.id, "dispute"),
    ).rejects.toThrow(/contract-status/);
    sqlite.prepare = realPrepare;

    // Atomic: no arbitration record, contract still in its original status.
    expect(sqlite.prepare("SELECT COUNT(*) c FROM arbitrations").get().c).toBe(
      0,
    );
    expect(
      sqlite
        .prepare("SELECT status FROM contracts WHERE id = ?")
        .get(contract.id).status,
    ).toBe("draft");
  });

  it("resolveArbitration rolls back the arbitration close if the contract update fails", async () => {
    const contract = await engine.createContract({ ...baseContract });
    const { arbitrationId } = await engine.initiateArbitration(
      contract.id,
      "dispute",
    );

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE contracts SET status = \? WHERE id = \?/.test(sql)) {
        throw new Error("simulated contract-status write failure");
      }
      return realPrepare(sql);
    };

    await expect(
      engine.resolveArbitration(
        arbitrationId,
        JSON.stringify({ action: "none" }),
      ),
    ).rejects.toThrow(/contract-status/);
    sqlite.prepare = realPrepare;

    // Atomic: arbitration still 'pending' (so it can be resolved later),
    // contract still DISPUTED.
    expect(
      sqlite
        .prepare("SELECT status FROM arbitrations WHERE id = ?")
        .get(arbitrationId).status,
    ).toBe("pending");
    expect(
      sqlite
        .prepare("SELECT status FROM contracts WHERE id = ?")
        .get(contract.id).status,
    ).toBe("disputed");
  });
});
