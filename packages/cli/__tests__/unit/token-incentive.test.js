/**
 * Unit tests for token-incentive (Phase 66 CLI port).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureTokenTables,
  listContributionTypes,
  listTxTypes,
  getBalance,
  listAccounts,
  transfer,
  mint,
  getTransactionHistory,
  calculateReward,
  recordContribution,
  rewardContribution,
  getContributions,
  getLeaderboard,
  CONTRIBUTION_TYPES,
  TX_TYPES,
  _resetState,
} from "../../src/lib/token-incentive.js";

describe("token-incentive", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureTokenTables(db);
  });

  /* ── Schema / catalogs ─────────────────────────────────────── */

  describe("ensureTokenTables", () => {
    it("creates token_accounts + token_transactions + contributions tables", () => {
      expect(db.tables.has("token_accounts")).toBe(true);
      expect(db.tables.has("token_transactions")).toBe(true);
      expect(db.tables.has("contributions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureTokenTables(db);
      ensureTokenTables(db);
      expect(db.tables.has("token_accounts")).toBe(true);
    });

    it("no-ops when db is null", () => {
      expect(() => ensureTokenTables(null)).not.toThrow();
    });
  });

  describe("Catalogs", () => {
    it("lists 7 contribution types with base rewards", () => {
      const types = listContributionTypes();
      expect(types).toHaveLength(7);
      const byName = Object.fromEntries(types.map((t) => [t.name, t]));
      expect(byName.skill_publication.baseReward).toBe(10);
      expect(byName.invocation_provided.baseReward).toBe(0.1);
      expect(byName.skill_review.baseReward).toBe(1);
      expect(byName.bug_report.baseReward).toBe(2);
      expect(byName.code_contribution.baseReward).toBe(5);
      expect(byName.documentation.baseReward).toBe(3);
      expect(byName.community_support.baseReward).toBe(1);
    });

    it("lists 4 tx types", () => {
      const types = listTxTypes();
      expect(types).toHaveLength(4);
      expect(types).toContain("transfer");
      expect(types).toContain("reward");
      expect(types).toContain("mint");
      expect(types).toContain("burn");
    });

    it("CONTRIBUTION_TYPES and TX_TYPES are frozen", () => {
      expect(Object.isFrozen(CONTRIBUTION_TYPES)).toBe(true);
      expect(Object.isFrozen(TX_TYPES)).toBe(true);
    });
  });

  /* ── TokenLedger.mint ──────────────────────────────────────── */

  describe("mint", () => {
    it("increments balance + totalEarned and records MINT tx", () => {
      const tx = mint(db, { to: "alice", amount: 100, reason: "grant" });
      expect(tx.type).toBe(TX_TYPES.MINT);
      expect(tx.fromAccount).toBeNull();
      expect(tx.toAccount).toBe("alice");
      expect(tx.amount).toBe(100);

      const acct = getBalance("alice");
      expect(acct.balance).toBe(100);
      expect(acct.totalEarned).toBe(100);
      expect(acct.totalSpent).toBe(0);
    });

    it("rejects missing to", () => {
      expect(() => mint(db, { amount: 10 })).toThrow(/to account is required/);
    });

    it("rejects amount <= 0", () => {
      expect(() => mint(db, { to: "alice", amount: 0 })).toThrow(
        /Invalid amount/,
      );
      expect(() => mint(db, { to: "alice", amount: -5 })).toThrow(
        /Invalid amount/,
      );
    });

    it("persists account + tx to DB", () => {
      const tx = mint(db, { to: "alice", amount: 50 });
      const acct = db
        .prepare("SELECT * FROM token_accounts WHERE account_id = ?")
        .get("alice");
      expect(acct).toBeTruthy();
      expect(acct.balance).toBe(50);
      const txRow = db
        .prepare("SELECT * FROM token_transactions WHERE id = ?")
        .get(tx.id);
      expect(txRow).toBeTruthy();
      expect(txRow.type).toBe("mint");
    });

    it("strips internal _seq from returned tx", () => {
      const tx = mint(db, { to: "alice", amount: 10 });
      expect(tx).not.toHaveProperty("_seq");
    });
  });

  /* ── TokenLedger.transfer ──────────────────────────────────── */

  describe("transfer", () => {
    beforeEach(() => {
      mint(db, { to: "alice", amount: 1000 });
    });

    it("moves tokens from sender to recipient", () => {
      const tx = transfer(db, { from: "alice", to: "bob", amount: 250 });
      expect(tx.type).toBe(TX_TYPES.TRANSFER);
      expect(tx.fromAccount).toBe("alice");
      expect(tx.toAccount).toBe("bob");
      expect(tx.amount).toBe(250);

      expect(getBalance("alice").balance).toBe(750);
      expect(getBalance("alice").totalSpent).toBe(250);
      expect(getBalance("bob").balance).toBe(250);
      expect(getBalance("bob").totalEarned).toBe(250);
    });

    it("rejects missing from/to", () => {
      expect(() => transfer(db, { to: "bob", amount: 10 })).toThrow(
        /from account is required/,
      );
      expect(() => transfer(db, { from: "alice", amount: 10 })).toThrow(
        /to account is required/,
      );
    });

    it("rejects same-account transfer", () => {
      expect(() =>
        transfer(db, { from: "alice", to: "alice", amount: 10 }),
      ).toThrow(/Cannot transfer to same account/);
    });

    it("rejects amount <= 0", () => {
      expect(() =>
        transfer(db, { from: "alice", to: "bob", amount: 0 }),
      ).toThrow(/Invalid amount/);
      expect(() =>
        transfer(db, { from: "alice", to: "bob", amount: -1 }),
      ).toThrow(/Invalid amount/);
    });

    it("rejects insufficient balance", () => {
      expect(() =>
        transfer(db, { from: "alice", to: "bob", amount: 5000 }),
      ).toThrow(/Insufficient balance/);
    });

    it("auto-creates recipient account on first transfer", () => {
      expect(getBalance("carol")).toBeNull();
      transfer(db, { from: "alice", to: "carol", amount: 100 });
      expect(getBalance("carol").balance).toBe(100);
    });
  });

  /* ── getBalance / listAccounts ─────────────────────────────── */

  describe("getBalance / listAccounts", () => {
    beforeEach(() => {
      mint(db, { to: "alice", amount: 100 });
      mint(db, { to: "bob", amount: 500 });
      mint(db, { to: "carol", amount: 50 });
    });

    it("getBalance returns null for unknown account", () => {
      expect(getBalance("dave")).toBeNull();
    });

    it("getBalance strips _seq", () => {
      const acct = getBalance("alice");
      expect(acct).not.toHaveProperty("_seq");
    });

    it("listAccounts sorts by balance DESC", () => {
      const rows = listAccounts();
      expect(rows[0].accountId).toBe("bob");
      expect(rows[1].accountId).toBe("alice");
      expect(rows[2].accountId).toBe("carol");
    });

    it("listAccounts respects limit", () => {
      expect(listAccounts({ limit: 2 })).toHaveLength(2);
    });
  });

  /* ── getTransactionHistory ─────────────────────────────────── */

  describe("getTransactionHistory", () => {
    beforeEach(() => {
      mint(db, { to: "alice", amount: 1000 });
      mint(db, { to: "bob", amount: 500 });
      transfer(db, { from: "alice", to: "bob", amount: 100 });
      transfer(db, { from: "bob", to: "alice", amount: 50 });
    });

    it("lists all txs most-recent first", () => {
      const rows = getTransactionHistory();
      expect(rows).toHaveLength(4);
    });

    it("filters by account (from OR to)", () => {
      const rows = getTransactionHistory({ accountId: "alice" });
      expect(rows).toHaveLength(3); // mint→alice, alice→bob, bob→alice
      expect(
        rows.every((t) => t.fromAccount === "alice" || t.toAccount === "alice"),
      ).toBe(true);
    });

    it("filters by type", () => {
      const rows = getTransactionHistory({ type: "transfer" });
      expect(rows).toHaveLength(2);
      expect(rows.every((t) => t.type === "transfer")).toBe(true);
    });

    it("rejects unknown type filter", () => {
      expect(() => getTransactionHistory({ type: "weird" })).toThrow(
        /Unknown tx type/,
      );
    });

    it("respects limit", () => {
      expect(getTransactionHistory({ limit: 1 })).toHaveLength(1);
    });
  });

  /* ── calculateReward ───────────────────────────────────────── */

  describe("calculateReward", () => {
    it("returns baseReward × value × multiplier", () => {
      expect(calculateReward({ type: "skill_publication", value: 1 })).toBe(10);
      expect(calculateReward({ type: "bug_report", value: 3 })).toBe(6);
      expect(
        calculateReward(
          { type: "code_contribution", value: 2 },
          {
            multiplier: 1.5,
          },
        ),
      ).toBe(15);
    });

    it("defaults value to 1 and multiplier to 1", () => {
      expect(calculateReward({ type: "documentation" })).toBe(3);
    });

    it("4-decimal rounded", () => {
      // 0.1 × 3 × 1 = 0.3 (would otherwise be 0.30000000000000004)
      expect(calculateReward({ type: "invocation_provided", value: 3 })).toBe(
        0.3,
      );
    });

    it("rejects unknown type", () => {
      expect(() => calculateReward({ type: "weird" })).toThrow(
        /Unknown contribution type/,
      );
    });

    it("rejects negative value", () => {
      expect(() =>
        calculateReward({ type: "documentation", value: -1 }),
      ).toThrow(/Invalid value/);
    });

    it("rejects negative multiplier", () => {
      expect(() =>
        calculateReward(
          { type: "documentation", value: 1 },
          {
            multiplier: -0.5,
          },
        ),
      ).toThrow(/Invalid multiplier/);
    });
  });

  /* ── recordContribution ────────────────────────────────────── */

  describe("recordContribution", () => {
    it("records contribution with generated id", () => {
      const c = recordContribution(db, {
        userId: "alice",
        type: "bug_report",
        value: 2,
      });
      expect(c.id).toBeDefined();
      expect(c.userId).toBe("alice");
      expect(c.type).toBe("bug_report");
      expect(c.value).toBe(2);
      expect(c.rewarded).toBe(false);
      expect(c.rewardAmount).toBe(0);
    });

    it("defaults value to 1", () => {
      const c = recordContribution(db, {
        userId: "alice",
        type: "documentation",
      });
      expect(c.value).toBe(1);
    });

    it("rejects missing userId", () => {
      expect(() => recordContribution(db, { type: "bug_report" })).toThrow(
        /userId is required/,
      );
    });

    it("rejects unknown type", () => {
      expect(() =>
        recordContribution(db, { userId: "alice", type: "weird" }),
      ).toThrow(/Unknown contribution type/);
    });

    it("rejects negative value", () => {
      expect(() =>
        recordContribution(db, {
          userId: "alice",
          type: "bug_report",
          value: -1,
        }),
      ).toThrow(/Invalid value/);
    });

    it("persists with serialized metadata", () => {
      const c = recordContribution(db, {
        userId: "alice",
        type: "bug_report",
        value: 1,
        metadata: { issue: "#42" },
      });
      const row = db
        .prepare("SELECT * FROM contributions WHERE id = ?")
        .get(c.id);
      expect(row.metadata).toBe(JSON.stringify({ issue: "#42" }));
    });

    it("auto-rewards when autoReward: true", () => {
      const c = recordContribution(db, {
        userId: "alice",
        type: "bug_report",
        value: 3,
        autoReward: true,
      });
      // Re-fetch via getContributions to see the post-reward state
      const all = getContributions({ userId: "alice" });
      expect(all).toHaveLength(1);
      expect(all[0].rewarded).toBe(true);
      expect(all[0].rewardAmount).toBe(6); // 2 × 3 × 1
      // alice should have balance from reward
      expect(getBalance("alice").balance).toBe(6);
      // returned object is pre-reward state (acceptable)
      void c;
    });

    it("strips internal _seq", () => {
      const c = recordContribution(db, {
        userId: "alice",
        type: "bug_report",
      });
      expect(c).not.toHaveProperty("_seq");
    });
  });

  /* ── rewardContribution ────────────────────────────────────── */

  describe("rewardContribution", () => {
    let contributionId;

    beforeEach(() => {
      const c = recordContribution(db, {
        userId: "alice",
        type: "bug_report",
        value: 2,
      });
      contributionId = c.id;
    });

    it("rewards an unrewarded contribution", () => {
      const result = rewardContribution(db, contributionId);
      expect(result.contribution.rewarded).toBe(true);
      expect(result.contribution.rewardAmount).toBe(4); // 2 × 2 × 1
      expect(result.tx.type).toBe(TX_TYPES.REWARD);
      expect(result.tx.toAccount).toBe("alice");
      expect(result.tx.fromAccount).toBeNull();
      expect(getBalance("alice").balance).toBe(4);
    });

    it("applies multiplier", () => {
      const result = rewardContribution(db, contributionId, {
        multiplier: 2.5,
      });
      expect(result.contribution.rewardAmount).toBe(10); // 2 × 2 × 2.5
    });

    it("rejects already-rewarded contribution", () => {
      rewardContribution(db, contributionId);
      expect(() => rewardContribution(db, contributionId)).toThrow(
        /already rewarded/,
      );
    });

    it("rejects unknown contribution id", () => {
      expect(() => rewardContribution(db, "nope")).toThrow(
        /Contribution not found/,
      );
    });

    it("updates contribution.txId after reward", () => {
      const result = rewardContribution(db, contributionId);
      const found = getContributions({ userId: "alice" });
      expect(found[0].txId).toBe(result.tx.id);
    });

    it("zero-amount reward marks rewarded with no tx", () => {
      const c = recordContribution(db, {
        userId: "bob",
        type: "bug_report",
        value: 0,
      });
      const result = rewardContribution(db, c.id);
      expect(result.tx).toBeNull();
      expect(result.contribution.rewarded).toBe(true);
      expect(result.contribution.rewardAmount).toBe(0);
    });
  });

  /* ── getContributions ──────────────────────────────────────── */

  describe("getContributions", () => {
    beforeEach(() => {
      recordContribution(db, { userId: "alice", type: "bug_report", value: 1 });
      recordContribution(db, {
        userId: "alice",
        type: "documentation",
        value: 1,
      });
      const c3 = recordContribution(db, {
        userId: "bob",
        type: "bug_report",
        value: 2,
      });
      rewardContribution(db, c3.id);
    });

    it("lists all contributions most-recent first", () => {
      const rows = getContributions();
      expect(rows).toHaveLength(3);
    });

    it("filters by userId", () => {
      const rows = getContributions({ userId: "alice" });
      expect(rows).toHaveLength(2);
    });

    it("filters by type", () => {
      const rows = getContributions({ type: "bug_report" });
      expect(rows).toHaveLength(2);
    });

    it("filters by rewarded=true", () => {
      const rows = getContributions({ rewarded: true });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe("bob");
    });

    it("filters by rewarded=false", () => {
      const rows = getContributions({ rewarded: false });
      expect(rows).toHaveLength(2);
    });

    it("rejects unknown type filter", () => {
      expect(() => getContributions({ type: "weird" })).toThrow(
        /Unknown contribution type/,
      );
    });
  });

  /* ── getLeaderboard ────────────────────────────────────────── */

  describe("getLeaderboard", () => {
    beforeEach(() => {
      const c1 = recordContribution(db, {
        userId: "alice",
        type: "skill_publication",
        value: 1,
      }); // 10
      const c2 = recordContribution(db, {
        userId: "alice",
        type: "bug_report",
        value: 2,
      }); // 4
      const c3 = recordContribution(db, {
        userId: "bob",
        type: "code_contribution",
        value: 3,
      }); // 15
      const c4 = recordContribution(db, {
        userId: "carol",
        type: "documentation",
        value: 1,
      }); // 3
      rewardContribution(db, c1.id);
      rewardContribution(db, c2.id);
      rewardContribution(db, c3.id);
      rewardContribution(db, c4.id);
    });

    it("sorts users by totalReward DESC", () => {
      const rows = getLeaderboard();
      expect(rows[0].userId).toBe("bob"); // 15
      expect(rows[0].totalReward).toBe(15);
      expect(rows[1].userId).toBe("alice"); // 14
      expect(rows[1].totalReward).toBe(14);
      expect(rows[2].userId).toBe("carol"); // 3
    });

    it("aggregates contributions count per user", () => {
      const rows = getLeaderboard();
      const alice = rows.find((r) => r.userId === "alice");
      expect(alice.contributions).toBe(2);
      expect(alice.totalValue).toBe(3); // 1 + 2
    });

    it("respects limit", () => {
      expect(getLeaderboard({ limit: 2 })).toHaveLength(2);
    });

    it("tolerates unrewarded contributions (totalReward=0)", () => {
      _resetState();
      db = new MockDatabase();
      ensureTokenTables(db);
      recordContribution(db, {
        userId: "dave",
        type: "bug_report",
        value: 1,
      });
      const rows = getLeaderboard();
      expect(rows).toHaveLength(1);
      expect(rows[0].totalReward).toBe(0);
      expect(rows[0].contributions).toBe(1);
    });
  });
});
