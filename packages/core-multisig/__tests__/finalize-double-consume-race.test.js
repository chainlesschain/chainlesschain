"use strict";

import { describe, it, expect, beforeAll } from "vitest";

/**
 * finalize() (reached→consumed) is the gate that prevents a multi-sig approval
 * from being acted on twice. Its docstring claims "防 double-consume", but the
 * old store.updateProposalState ran an UNCONDITIONAL UPDATE, so the outer
 * state check (read outside any tx) was a TOCTOU: two concurrent finalize()
 * on different DB connections could both observe 'reached' and both flip to
 * 'consumed' → the approved privileged operation executes twice.
 *
 * Fix = compare-and-swap (UPDATE ... WHERE id=? AND state='reached'). These
 * tests cover the CAS semantics (sql.js, always runs) and a faithful
 * two-connection reproduction (better-sqlite3, self-skips if unavailable).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { applySchema } = require("../lib/schema.js");
const { createStore } = require("../lib/store.js");
const { createProposalsManager } = require("../lib/proposals.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");
const ed25519Signer = require("@chainlesschain/core-mtc/signers/ed25519");

let SQL;
beforeAll(async () => {
  SQL = await (await import("sql.js")).default();
});

/** A 1-of-1 Ed25519 policy → propose() reaches threshold immediately. */
function oneOfOne() {
  const kp = ed25519Signer.generateKeyPair();
  const did = "did:cc:solo";
  return {
    policy: {
      domain: "test.purchase",
      m: 1,
      n: 1,
      members: [{ did, alg: ed25519Signer.ALG, pubkeyJwk: ed25519Signer.makeJwk(kp.publicKey) }],
    },
    initiator: { did, alg: ed25519Signer.ALG, secretKey: kp.secretKey },
  };
}

function proposeReached(mgr) {
  const { policy, initiator } = oneOfOne();
  const r = mgr.propose({ domain: policy.domain, payload: { orderId: "o-1" }, policy, initiator });
  expect(r.reachedThreshold).toBe(true);
  return r.proposal.id;
}

describe("updateProposalState — CAS semantics (sql.js)", () => {
  function setup() {
    const db = adaptSqlJsDb(new SQL.Database());
    applySchema(db);
    return createStore(db);
  }

  it("expectedState mismatch does NOT flip; matching expectedState flips once", () => {
    const store = setup();
    const id = proposeReached(createProposalsManager(store));
    expect(store.getProposal(id).state).toBe("reached");
    // Wrong expected state → no-op.
    expect(store.updateProposalState(id, "consumed", 1, "pending")).toBe(false);
    expect(store.getProposal(id).state).toBe("reached");
    // Correct expected state → flips.
    expect(store.updateProposalState(id, "consumed", 2, "reached")).toBe(true);
    expect(store.getProposal(id).state).toBe("consumed");
    // Re-flip from the now-stale 'reached' expectation → no-op (idempotent CAS).
    expect(store.updateProposalState(id, "consumed", 3, "reached")).toBe(false);
  });

  it("finalize twice (sequential) consumes exactly once", () => {
    const store = setup();
    let consumed = 0;
    const mgr = createProposalsManager(store, { logEvent: (e) => e.type === "consumed" && consumed++ });
    const id = proposeReached(mgr);
    expect(mgr.finalize(id)).toEqual({ ok: true });
    expect(mgr.finalize(id)).toEqual({ ok: false, reason: "proposal_state_consumed" });
    expect(consumed).toBe(1);
  });

  it("cancel cannot stamp 'cancelled' over a consumed proposal", () => {
    const store = setup();
    const mgr = createProposalsManager(store);
    const id = proposeReached(mgr);
    expect(mgr.finalize(id).ok).toBe(true);
    expect(mgr.cancel(id, "too late").ok).toBe(false);
    expect(store.getProposal(id).state).toBe("consumed");
  });
});

// ── Faithful two-connection double-consume race (file-backed SQLite). ─────────
let Database = null;
try {
  Database = require("better-sqlite3");
  const probe = new Database(":memory:");
  probe.close();
} catch {
  Database = null;
}
const d = Database ? describe : describe.skip;

d("finalize — cross-connection double-consume (TOCTOU must be a CAS)", () => {
  it("two concurrent finalize() consume exactly once", () => {
    const file = path.join(os.tmpdir(), `cc-msig-race-${crypto.randomUUID()}.db`);
    const connA = new Database(file);
    const connB = new Database(file);
    connA.pragma("busy_timeout = 2000");
    connB.pragma("busy_timeout = 2000");
    try {
      applySchema(connA);
      let consumed = 0;
      const onConsumed = (e) => {
        if (e.type === "consumed") consumed++;
      };
      const storeA = createStore(connA);
      const managerA = createProposalsManager(storeA, { logEvent: onConsumed });
      const id = proposeReached(managerA);

      // managerB on its own connection. Patch its outer read so that the moment
      // it observes 'reached', connA's finalize commits reached→consumed first —
      // recreating the stale-read window deterministically. managerB then still
      // tries to consume; only the CAS can stop the second consume.
      const storeB = createStore(connB);
      const realGet = storeB.getProposal.bind(storeB);
      let raced = false;
      storeB.getProposal = (pid) => {
        const p = realGet(pid);
        if (!raced && p && p.state === "reached") {
          raced = true;
          expect(managerA.finalize(pid)).toEqual({ ok: true }); // A wins
        }
        return p;
      };
      const managerB = createProposalsManager(storeB, { logEvent: onConsumed });

      const rb = managerB.finalize(id);
      // B lost the race: its CAS matched 0 rows (already consumed) → ok:false.
      expect(rb.ok).toBe(false);
      expect(rb.reason).toBe("proposal_state_consumed");
      // The approved operation is consumed EXACTLY once.
      expect(consumed).toBe(1);
      expect(storeA.getProposal(id).state).toBe("consumed");
    } finally {
      connA.close();
      connB.close();
      for (const suf of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(file + suf);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  });
});
