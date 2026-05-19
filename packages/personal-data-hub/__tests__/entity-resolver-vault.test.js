"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");

// Helper to spin up a fresh vault each test
function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-er-test-"));
  const dbPath = path.join(dir, "vault.db");
  const key = generateKeyHex();
  const vault = new LocalVault({ path: dbPath, key });
  vault.open();
  return { vault, dir };
}

function cleanup(vault, dir) {
  try { vault.close(); } catch (_e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
}

// ─── Migration v2 — Phase 8 tables exist ─────────────────────────────────

describe("Phase 8 migration v2 — EntityResolver tables", () => {
  let vault, dir;
  beforeEach(() => { ({ vault, dir } = makeVault()); });
  afterEach(() => cleanup(vault, dir));

  it("schemaVersion is 2 after open()", () => {
    expect(vault.schemaVersion()).toBe(2);
  });

  it("all 5 new tables exist + are queryable", () => {
    const s = vault.stats();
    expect(s.mergeGroups).toBe(0);
    expect(s.mergeMembers).toBe(0);
    expect(s.resolveQueue).toBe(0);
    expect(s.reviewQueue).toBe(0);
    expect(s.resolveDecisions).toBe(0);
  });

});

// ─── resolve_queue ───────────────────────────────────────────────────────

describe("Phase 8 — resolve_queue helpers", () => {
  let vault, dir;
  beforeEach(() => { ({ vault, dir } = makeVault()); });
  afterEach(() => cleanup(vault, dir));

  it("enqueueResolve creates a pending row", () => {
    const id = vault.enqueueResolve("person-a");
    expect(typeof id === "number" || typeof id === "bigint").toBe(true);
    expect(vault.resolveQueueStats().pending).toBe(1);
  });

  it("enqueueResolve is idempotent for pending rows", () => {
    const a = vault.enqueueResolve("person-a");
    const b = vault.enqueueResolve("person-a");
    expect(a).toBe(b);
    expect(vault.resolveQueueStats().pending).toBe(1);
  });

  it("claimResolveBatch marks pending → in-progress + increments attempts", () => {
    vault.enqueueResolve("person-a");
    vault.enqueueResolve("person-b");
    const batch = vault.claimResolveBatch(50);
    expect(batch).toHaveLength(2);
    expect(batch[0].person_id).toBe("person-a");
    expect(batch[0].attempts).toBe(0); // before increment
    const stats = vault.resolveQueueStats();
    expect(stats.pending).toBe(0);
    expect(stats["in-progress"]).toBe(2);
  });

  it("completeResolve flips status to done", () => {
    vault.enqueueResolve("person-a");
    const [row] = vault.claimResolveBatch(10);
    vault.completeResolve(row.id);
    expect(vault.resolveQueueStats().done).toBe(1);
  });

  it("errorResolve re-pends until 3 attempts then marks error", () => {
    vault.enqueueResolve("person-a");
    let row = vault.claimResolveBatch(10)[0];
    vault.errorResolve(row.id, "fail 1");
    expect(vault.resolveQueueStats().pending).toBe(1);
    row = vault.claimResolveBatch(10)[0];
    vault.errorResolve(row.id, "fail 2");
    expect(vault.resolveQueueStats().pending).toBe(1);
    row = vault.claimResolveBatch(10)[0];
    vault.errorResolve(row.id, "fail 3");
    expect(vault.resolveQueueStats().error).toBe(1);
    expect(vault.resolveQueueStats().pending).toBe(0);
  });
});

// ─── resolve_decisions ───────────────────────────────────────────────────

describe("Phase 8 — resolve_decisions", () => {
  let vault, dir;
  beforeEach(() => { ({ vault, dir } = makeVault()); });
  afterEach(() => cleanup(vault, dir));

  it("recordResolveDecision lex-orders ids", () => {
    vault.recordResolveDecision({
      aId: "z-person", bId: "a-person",
      verdict: "same", confidence: 0.9, decidedBy: "rule", reason: "test",
    });
    // Looking up either order returns the same row
    const r1 = vault.getResolveDecision("a-person", "z-person");
    const r2 = vault.getResolveDecision("z-person", "a-person");
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r1.a_person_id).toBe("a-person");
    expect(r1.b_person_id).toBe("z-person");
    expect(r1.verdict).toBe("same");
  });

  it("recordResolveDecision upserts on conflict", () => {
    vault.recordResolveDecision({ aId: "p-a", bId: "p-b", verdict: "same", confidence: 0.7, decidedBy: "embedding" });
    vault.recordResolveDecision({ aId: "p-a", bId: "p-b", verdict: "different", confidence: 0.95, decidedBy: "user" });
    const r = vault.getResolveDecision("p-a", "p-b");
    expect(r.verdict).toBe("different");
    expect(r.decided_by).toBe("user");
    expect(r.confidence).toBe(0.95);
  });
});

// ─── mergePair / unmergePerson / merge group closure ─────────────────────

describe("Phase 8 — merge_groups + merge_members", () => {
  let vault, dir;
  beforeEach(() => { ({ vault, dir } = makeVault()); });
  afterEach(() => cleanup(vault, dir));

  it("mergePair creates a new group with 2 members", () => {
    const groupId = vault.mergePair({ aId: "p-a", bId: "p-b" });
    expect(typeof groupId).toBe("string");
    const members = vault.getMergeGroupMembers("p-a");
    expect(members.sort()).toEqual(["p-a", "p-b"]);
  });

  it("mergePair adds to existing group when one side already in it", () => {
    vault.mergePair({ aId: "p-a", bId: "p-b" });
    vault.mergePair({ aId: "p-b", bId: "p-c" });
    const members = vault.getMergeGroupMembers("p-a");
    expect(members.sort()).toEqual(["p-a", "p-b", "p-c"]);
  });

  it("mergePair fuses two existing groups", () => {
    vault.mergePair({ aId: "p-a", bId: "p-b" });
    vault.mergePair({ aId: "p-c", bId: "p-d" });
    // a-b group and c-d group exist independently
    expect(vault.getMergeGroupMembers("p-a").sort()).toEqual(["p-a", "p-b"]);
    expect(vault.getMergeGroupMembers("p-c").sort()).toEqual(["p-c", "p-d"]);
    // Fuse them
    vault.mergePair({ aId: "p-b", bId: "p-c" });
    const all = vault.getMergeGroupMembers("p-a").sort();
    expect(all).toEqual(["p-a", "p-b", "p-c", "p-d"]);
    // Verify there's only ONE group remaining
    const s = vault.stats();
    expect(s.mergeGroups).toBe(1);
    expect(s.mergeMembers).toBe(4);
  });

  it("mergePair on already-same-group is a no-op", () => {
    vault.mergePair({ aId: "p-a", bId: "p-b" });
    const groupBefore = vault.getMergeGroupMembers("p-a").length;
    vault.mergePair({ aId: "p-a", bId: "p-b" });
    const groupAfter = vault.getMergeGroupMembers("p-a").length;
    expect(groupAfter).toBe(groupBefore);
  });

  it("getMergeGroupMembers returns [personId] for unmerged person", () => {
    const members = vault.getMergeGroupMembers("loner-1");
    expect(members).toEqual(["loner-1"]);
  });

  it("unmergePerson removes from group; group of 2 → group dissolves", () => {
    vault.mergePair({ aId: "p-a", bId: "p-b" });
    const r = vault.unmergePerson("p-a");
    expect(r.ok).toBe(true);
    expect(vault.getMergeGroupMembers("p-a")).toEqual(["p-a"]);
    expect(vault.getMergeGroupMembers("p-b")).toEqual(["p-b"]);
    expect(vault.stats().mergeGroups).toBe(0);
  });

  it("unmergePerson shrinks group when 3+ members", () => {
    vault.mergePair({ aId: "p-a", bId: "p-b" });
    vault.mergePair({ aId: "p-b", bId: "p-c" });
    vault.unmergePerson("p-c");
    expect(vault.getMergeGroupMembers("p-a").sort()).toEqual(["p-a", "p-b"]);
    expect(vault.getMergeGroupMembers("p-c")).toEqual(["p-c"]);
    expect(vault.stats().mergeGroups).toBe(1);
  });

  it("unmergePerson on non-member returns ok:false", () => {
    const r = vault.unmergePerson("never-merged");
    expect(r.ok).toBe(false);
  });
});

// ─── review_queue ────────────────────────────────────────────────────────

describe("Phase 8 — review_queue", () => {
  let vault, dir;
  beforeEach(() => { ({ vault, dir } = makeVault()); });
  afterEach(() => cleanup(vault, dir));

  it("enqueueReview lex-orders + returns id", () => {
    const id = vault.enqueueReview({
      aId: "z-p", bId: "a-p",
      embedSim: 0.72, llmVerdict: "maybe", llmReason: "names similar",
      llmConfidence: 0.5,
    });
    expect(id).toBeDefined();
    const queue = vault.listReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].a_person_id).toBe("a-p");
    expect(queue[0].b_person_id).toBe("z-p");
    expect(queue[0].embed_sim).toBe(0.72);
  });

  it("listReviewQueue only returns pending rows (reviewed_at IS NULL)", () => {
    const id1 = vault.enqueueReview({ aId: "p1", bId: "p2", embedSim: 0.7 });
    const id2 = vault.enqueueReview({ aId: "p3", bId: "p4", embedSim: 0.75 });
    vault.recordReviewDecision({ reviewId: id1, decision: "same" });
    const pending = vault.listReviewQueue();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id2);
  });

  it("recordReviewDecision rejects invalid decision", () => {
    const id = vault.enqueueReview({ aId: "p1", bId: "p2" });
    expect(() => vault.recordReviewDecision({ reviewId: id, decision: "garbage" })).toThrow();
  });

  it("recordReviewDecision rejects non-existent review id", () => {
    expect(() => vault.recordReviewDecision({ reviewId: 9999, decision: "same" })).toThrow();
  });
});
