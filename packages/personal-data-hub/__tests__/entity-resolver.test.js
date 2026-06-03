"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const { newId } = require("../lib/ids");
const {
  EntityResolver,
  entityResolverRuleStage: ruleStage,
  entityResolverSharedIdentifier: findSharedIdentifier,
  entityResolverNormalizeIdValue: normalizeIdValue,
} = require("../lib/entity-resolver");

// ─── ruleStage (pure) ────────────────────────────────────────────────────

function person(overrides = {}) {
  return {
    id: overrides.id || `person-${Math.random().toString(36).slice(2, 8)}`,
    type: "person",
    subtype: "contact",
    names: overrides.names || [],
    identifiers: overrides.identifiers || {},
    source: overrides.source || { adapter: "test", originalId: "tx-" + Math.random() },
    ...overrides,
  };
}

describe("ruleStage — R1 strong identifier match", () => {
  it("same email → same", () => {
    const a = person({ identifiers: { email: ["mom@163.com"] } });
    const b = person({ identifiers: { email: ["MOM@163.COM"] } }); // case + array
    expect(ruleStage(a, b).verdict).toBe("same");
  });

  it("same phone (different formatting) → same", () => {
    const a = person({ identifiers: { phone: ["+86 138 0000 1111"] } });
    const b = person({ identifiers: { phone: ["13800001111"] } });
    expect(ruleStage(a, b).verdict).toBe("same");
  });

  it("same wechatId → same", () => {
    const a = person({ identifiers: { wechatId: "wxid_xyz" } });
    const b = person({ identifiers: { wechatId: ["wxid_xyz"] } });
    expect(ruleStage(a, b).verdict).toBe("same");
  });

  it("same did → same", () => {
    const a = person({ identifiers: { did: "did:cc:abc" } });
    const b = person({ identifiers: { did: "did:cc:abc" } });
    expect(ruleStage(a, b).verdict).toBe("same");
  });

  it("same idHash → same", () => {
    const a = person({ identifiers: { idHash: "sha-id-hash-123" } });
    const b = person({ identifiers: { idHash: "sha-id-hash-123" } });
    expect(ruleStage(a, b).verdict).toBe("same");
  });
});

describe("ruleStage — R2 zero overlap → different", () => {
  it("no shared field → different", () => {
    const a = person({
      names: ["张三"],
      identifiers: { email: ["a@x.com"] },
      source: { adapter: "email", originalId: "1" },
    });
    const b = person({
      names: ["李四"],
      identifiers: { phone: ["13900001234"] },
      source: { adapter: "alipay", originalId: "2" },
    });
    expect(ruleStage(a, b).verdict).toBe("different");
  });

  it("identical content but no identifier overlap + different adapters → uncertain", () => {
    // Note: same name → overlap=1 → uncertain
    const a = person({ names: ["张三"], source: { adapter: "email", originalId: "1" } });
    const b = person({ names: ["张三"], source: { adapter: "alipay", originalId: "2" } });
    expect(ruleStage(a, b).verdict).toBe("uncertain");
  });
});

describe("ruleStage — R3 same-adapter internal dup", () => {
  it("same adapter + different originalId + shared name → same", () => {
    const a = person({
      names: ["张三"],
      source: { adapter: "email", originalId: "1" },
    });
    const b = person({
      names: ["张三"],
      source: { adapter: "email", originalId: "2" },
    });
    expect(ruleStage(a, b).verdict).toBe("same");
    expect(ruleStage(a, b).reason).toMatch(/same-adapter/);
  });

  it("same adapter + same originalId is NOT a R3 case (different id implies different row)", () => {
    const a = person({
      id: "p1",
      names: ["张三"],
      source: { adapter: "email", originalId: "1" },
    });
    const b = person({
      id: "p2",
      names: ["张三"],
      source: { adapter: "email", originalId: "1" },
    });
    // R3 requires DIFFERENT originalId — same originalId falls through
    // but uniqueIndex on source.originalId means we don't see this case
    // in practice.
    const r = ruleStage(a, b);
    expect(r.verdict).toBe("uncertain"); // because there's overlap (name + adapter)
  });

  it("same adapter + DIFFERENT name → uncertain (not R3)", () => {
    const a = person({
      names: ["张三"],
      source: { adapter: "email", originalId: "1" },
    });
    const b = person({
      names: ["李四"],
      source: { adapter: "email", originalId: "2" },
    });
    expect(ruleStage(a, b).verdict).toBe("uncertain");
  });
});

describe("ruleStage — R4 uncertain fall-through", () => {
  it("name overlap only → uncertain", () => {
    const a = person({ names: ["张三"], source: { adapter: "email", originalId: "1" } });
    const b = person({ names: ["张三"], source: { adapter: "alipay", originalId: "2" } });
    expect(ruleStage(a, b).verdict).toBe("uncertain");
  });

  it("same person id → same vacuously", () => {
    const a = person({ id: "p1" });
    const b = person({ id: "p1" });
    expect(ruleStage(a, b).verdict).toBe("same");
  });

  it("invalid input → different", () => {
    expect(ruleStage(null, person()).verdict).toBe("different");
    expect(ruleStage(person(), undefined).verdict).toBe("different");
  });
});

// ─── normalizeIdValue ────────────────────────────────────────────────────

describe("normalizeIdValue", () => {
  it("email → lowercase + trim", () => {
    expect(normalizeIdValue("email", "  MOM@163.COM ")).toBe("mom@163.com");
  });
  it("phone → digits only, strips +86 country code", () => {
    expect(normalizeIdValue("phone", "+86 138-0000 1111")).toBe("13800001111");
    expect(normalizeIdValue("phone", "13800001111")).toBe("13800001111");
  });
  it("other keys → trim only", () => {
    expect(normalizeIdValue("did", "  did:cc:abc ")).toBe("did:cc:abc");
  });
});

// ─── findSharedIdentifier ────────────────────────────────────────────────

describe("findSharedIdentifier", () => {
  it("finds shared email across array vs string", () => {
    const r = findSharedIdentifier(
      { email: ["a@x.com", "b@x.com"] },
      { email: "B@X.COM" },
    );
    expect(r).toBeTruthy();
    expect(r.key).toBe("email");
    expect(r.value).toBe("b@x.com");
  });

  it("returns null when no overlap", () => {
    const r = findSharedIdentifier({ email: ["a@x.com"] }, { email: ["b@x.com"] });
    expect(r).toBeNull();
  });

  it("ignores empty / missing identifier groups", () => {
    const r = findSharedIdentifier({}, { email: ["a@x.com"] });
    expect(r).toBeNull();
  });
});

// ─── EntityResolver wired against a real vault ───────────────────────────

function makeVaultWithPersons(persons) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-er-test-"));
  const dbPath = path.join(dir, "vault.db");
  const key = generateKeyHex();
  const vault = new LocalVault({ path: dbPath, key });
  vault.open();
  for (const p of persons) {
    // Build a complete source (the rule-stage tests use a 2-field
    // shorthand for brevity; vault.putPerson needs the full 5-field).
    const inputSrc = p.source || {};
    const source = {
      adapter: inputSrc.adapter || "test",
      adapterVersion: inputSrc.adapterVersion || "0.1.0",
      originalId: inputSrc.originalId || p.id,
      capturedAt: inputSrc.capturedAt || Date.now(),
      capturedBy: inputSrc.capturedBy || "api",
    };
    vault.putPerson({
      id: p.id,
      type: "person",
      subtype: p.subtype || "contact",
      names: p.names || [],
      identifiers: p.identifiers || {},
      ingestedAt: Date.now(),
      source,
      extra: p.extra || {},
    });
  }
  return { vault, dir };
}

function cleanup(vault, dir) {
  try { vault.close(); } catch (_e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
}

describe("EntityResolver.resolveOnIngest", () => {
  let vault, dir;
  afterEach(() => cleanup(vault, dir));

  it("R1 same-email pair → immediate merge", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-email-mom", names: ["妈"], identifiers: { email: ["mom@163.com"] } },
    ]));
    const er = new EntityResolver({ vault });
    const newPerson = {
      id: "p-alipay-陈x",
      type: "person",
      names: ["陈X"],
      identifiers: { email: ["mom@163.com"] }, // same email
      source: { adapter: "alipay", originalId: "TX1" },
    };
    vault.putPerson({
      ...newPerson,
      subtype: "contact",
      ingestedAt: Date.now(),
      source: { adapter: "alipay", adapterVersion: "0.1.0", originalId: "TX1", capturedAt: Date.now(), capturedBy: "export" },
    });
    const summary = er.resolveOnIngest([newPerson]);
    expect(summary.newPersons).toBe(1);
    expect(summary.sameImmediate).toBe(1);
    expect(vault.getMergeGroupMembers("p-email-mom").sort()).toEqual(["p-alipay-陈x", "p-email-mom"]);
  });

  it("R2 zero-overlap pair → candidate filter excludes; no merge, person enqueued for async", () => {
    // The candidate-finder filters out zero-overlap rows for perf — they
    // never reach rule-stage. Behavior is equivalent ("different" verdict
    // never recorded but no merge happens either). Async pipeline gets
    // a chance later in case embedding catches a name variant.
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-x", names: ["张三"], identifiers: { email: ["a@x.com"] }, source: { adapter: "email", originalId: "1" } },
    ]));
    const er = new EntityResolver({ vault });
    const newPerson = {
      id: "p-y",
      type: "person",
      names: ["李四"],
      identifiers: { phone: ["13900001234"] },
      source: { adapter: "alipay", originalId: "2" },
    };
    vault.putPerson({
      ...newPerson, subtype: "contact", ingestedAt: Date.now(),
      source: { adapter: "alipay", adapterVersion: "0.1.0", originalId: "2", capturedAt: Date.now(), capturedBy: "export" },
    });
    const summary = er.resolveOnIngest([newPerson]);
    expect(summary.differentImmediate).toBe(0);
    expect(summary.sameImmediate).toBe(0);
    expect(summary.enqueued).toBe(1);
    expect(vault.stats().mergeGroups).toBe(0);
  });

  it("uncertain pair → enqueues for async", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-1", names: ["张三"], source: { adapter: "email", originalId: "1" } },
    ]));
    const er = new EntityResolver({ vault });
    const newPerson = {
      id: "p-2",
      type: "person",
      names: ["张三"], // name overlap → uncertain
      source: { adapter: "alipay", originalId: "2" },
    };
    vault.putPerson({
      ...newPerson, subtype: "contact", ingestedAt: Date.now(),
      source: { adapter: "alipay", adapterVersion: "0.1.0", originalId: "2", capturedAt: Date.now(), capturedBy: "export" },
    });
    const summary = er.resolveOnIngest([newPerson]);
    expect(summary.enqueued).toBe(1);
    expect(vault.resolveQueueStats().pending).toBe(1);
  });

  it("respects existing same-decision (idempotent on retry)", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"], identifiers: { email: ["a@x.com"] } },
      { id: "p-b", names: ["x"], identifiers: { email: ["a@x.com"] } },
    ]));
    const er = new EntityResolver({ vault });
    const summary1 = er.resolveOnIngest([{ id: "p-b", names: ["x"], identifiers: { email: ["a@x.com"] } }]);
    const summary2 = er.resolveOnIngest([{ id: "p-b", names: ["x"], identifiers: { email: ["a@x.com"] } }]);
    expect(summary1.sameImmediate).toBeGreaterThanOrEqual(1);
    expect(summary2.sameImmediate).toBeGreaterThanOrEqual(1); // still records same path
    // Members stable
    expect(vault.getMergeGroupMembers("p-a").sort()).toEqual(["p-a", "p-b"]);
  });

  it("handles error in single person without breaking batch", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"], identifiers: { email: ["a@x.com"] } },
    ]));
    const er = new EntityResolver({ vault });
    const batch = [
      null, // will trigger error path
      { id: "p-b", names: ["x"], identifiers: { email: ["a@x.com"] } },
    ];
    const summary = er.resolveOnIngest(batch);
    expect(summary.newPersons).toBe(2);
    expect(summary.errored).toBeGreaterThanOrEqual(1);
    expect(summary.sameImmediate).toBeGreaterThanOrEqual(0);
  });
});

describe("EntityResolver.drain (rule-only, no embedding/llm)", () => {
  let vault, dir;
  afterEach(() => cleanup(vault, dir));

  it("returns processed:0 when queue empty", async () => {
    ({ vault, dir } = makeVaultWithPersons([]));
    const er = new EntityResolver({ vault });
    const r = await er.drain();
    expect(r.processed).toBe(0);
  });

  it("processes queued person — rule stage finds same identifier", async () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"], identifiers: { email: ["a@x.com"] } },
      { id: "p-b", names: ["x"], identifiers: { email: ["a@x.com"] } },
    ]));
    const er = new EntityResolver({ vault });
    vault.enqueueResolve("p-b");
    const r = await er.drain();
    expect(r.processed).toBe(1);
    expect(r.same).toBe(1);
    expect(vault.getMergeGroupMembers("p-a").sort()).toEqual(["p-a", "p-b"]);
  });

  it("processes uncertain pair without embedding stage → no decision", async () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"], source: { adapter: "email", originalId: "1" } },
      { id: "p-b", names: ["x"], source: { adapter: "alipay", originalId: "2" } },
    ]));
    const er = new EntityResolver({ vault });
    vault.enqueueResolve("p-b");
    const r = await er.drain();
    expect(r.processed).toBe(1);
    expect(r.same).toBe(0);
    expect(r.different).toBe(0);
    expect(r.skipped).toBeGreaterThanOrEqual(0); // no embedding wired
  });
});

describe("EntityResolver.drain with embedding + LLM stages", () => {
  let vault, dir;
  afterEach(() => cleanup(vault, dir));

  it("embedding sim ≥ high threshold → auto same", async () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["张三"], source: { adapter: "email", originalId: "1" } },
      { id: "p-b", names: ["张三"], source: { adapter: "alipay", originalId: "2" } },
    ]));
    const er = new EntityResolver({
      vault,
      embeddingStage: async () => ({ sim: 0.91 }),
    });
    vault.enqueueResolve("p-b");
    const r = await er.drain();
    expect(r.same).toBe(1);
  });

  it("embedding sim < low threshold → auto different", async () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["张三"], source: { adapter: "email", originalId: "1" } },
      { id: "p-b", names: ["张三"], source: { adapter: "alipay", originalId: "2" } },
    ]));
    const er = new EntityResolver({
      vault,
      embeddingStage: async () => ({ sim: 0.4 }),
    });
    vault.enqueueResolve("p-b");
    const r = await er.drain();
    expect(r.different).toBe(1);
  });

  it("embedding mid-range + LLM yes → same", async () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["张三"], source: { adapter: "email", originalId: "1" } },
      { id: "p-b", names: ["张三"], source: { adapter: "alipay", originalId: "2" } },
    ]));
    const er = new EntityResolver({
      vault,
      embeddingStage: async () => ({ sim: 0.7 }),
      llmStage: async () => ({ verdict: "yes", confidence: 0.85, reason: "looks same" }),
    });
    vault.enqueueResolve("p-b");
    const r = await er.drain();
    expect(r.same).toBe(1);
  });

  it("embedding mid-range + LLM maybe → review queue", async () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["张三"], source: { adapter: "email", originalId: "1" } },
      { id: "p-b", names: ["张三"], source: { adapter: "alipay", originalId: "2" } },
    ]));
    const er = new EntityResolver({
      vault,
      embeddingStage: async () => ({ sim: 0.7 }),
      llmStage: async () => ({ verdict: "maybe", confidence: 0.5, reason: "unclear" }),
    });
    vault.enqueueResolve("p-b");
    const r = await er.drain();
    expect(r.review).toBe(1);
    expect(vault.listReviewQueue()).toHaveLength(1);
  });

  it("embedding stage throws → error counted, no infinite retry", async () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["张三"], source: { adapter: "email", originalId: "1" } },
      { id: "p-b", names: ["张三"], source: { adapter: "alipay", originalId: "2" } },
    ]));
    const er = new EntityResolver({
      vault,
      embeddingStage: async () => { throw new Error("ollama down"); },
    });
    vault.enqueueResolve("p-b");
    const r = await er.drain();
    expect(r.error).toBe(1);
    expect(vault.resolveQueueStats().pending).toBe(1); // retry-eligible
  });
});

describe("EntityResolver.applyUserDecision", () => {
  let vault, dir;
  afterEach(() => cleanup(vault, dir));

  it("user says same → merge + record decision", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"] },
      { id: "p-b", names: ["x"] },
    ]));
    const er = new EntityResolver({ vault });
    const reviewId = vault.enqueueReview({ aId: "p-a", bId: "p-b", embedSim: 0.7 });
    er.applyUserDecision({ reviewId, decision: "same" });
    expect(vault.getMergeGroupMembers("p-a").sort()).toEqual(["p-a", "p-b"]);
    expect(vault.getResolveDecision("p-a", "p-b")).toBeDefined();
    expect(vault.getResolveDecision("p-a", "p-b").decided_by).toBe("user");
  });

  it("user says different → record decision, no merge", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"] },
      { id: "p-b", names: ["x"] },
    ]));
    const er = new EntityResolver({ vault });
    const reviewId = vault.enqueueReview({ aId: "p-a", bId: "p-b", embedSim: 0.7 });
    er.applyUserDecision({ reviewId, decision: "different" });
    expect(vault.stats().mergeGroups).toBe(0);
    expect(vault.getResolveDecision("p-a", "p-b").verdict).toBe("different");
  });

  it("user says skip → just marks reviewed", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"] },
      { id: "p-b", names: ["x"] },
    ]));
    const er = new EntityResolver({ vault });
    const reviewId = vault.enqueueReview({ aId: "p-a", bId: "p-b", embedSim: 0.7 });
    er.applyUserDecision({ reviewId, decision: "skip" });
    expect(vault.stats().mergeGroups).toBe(0);
    expect(vault.getResolveDecision("p-a", "p-b")).toBeUndefined();
    expect(vault.listReviewQueue()).toHaveLength(0); // marked reviewed
  });
});

describe("EntityResolver manual merge / unmerge", () => {
  let vault, dir;
  afterEach(() => cleanup(vault, dir));

  it("manualMerge creates the group + records same decision", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"] },
      { id: "p-b", names: ["x"] },
    ]));
    const er = new EntityResolver({ vault });
    er.manualMerge({ aId: "p-a", bId: "p-b" });
    expect(vault.getMergeGroupMembers("p-a").sort()).toEqual(["p-a", "p-b"]);
  });

  it("manualUnmerge dissolves group + records different decision", () => {
    ({ vault, dir } = makeVaultWithPersons([
      { id: "p-a", names: ["x"] },
      { id: "p-b", names: ["x"] },
    ]));
    const er = new EntityResolver({ vault });
    er.manualMerge({ aId: "p-a", bId: "p-b" });
    er.manualUnmerge("p-a");
    expect(vault.stats().mergeGroups).toBe(0);
    expect(vault.getResolveDecision("p-a", "p-b").verdict).toBe("different");
  });
});

describe("EntityResolver constructor", () => {
  it("requires vault", () => {
    expect(() => new EntityResolver()).toThrow();
    expect(() => new EntityResolver({})).toThrow(/vault/);
  });
});
