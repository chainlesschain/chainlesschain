import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ContextMemoryKernel,
  NativeSqliteMemoryPort,
  applyMemoryCommand,
} = require("@chainlesschain/context-memory-kernel");
const {
  ProjectGoalMemoryService,
} = require("../../../session-core/lib/project-goal-memory.js");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract.js");
const {
  ProjectGoalCompletionService,
} = require("../../../session-core/lib/project-goal-completion.js");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate.js");
const owner = "did:chainless:owner";

describe("goal-owned versioned Kernel memory and output authorization", () => {
  let db,
    actor,
    now,
    service,
    goal,
    hosts,
    afterProposal,
    afterDecision,
    purgePorts;
  function factory({ scope, authorize }) {
    const port = new NativeSqliteMemoryPort({ db, scope, authorize });
    const kernel = new ContextMemoryKernel({
      memoryPort: port,
      reconciliationPort: port,
      clock: () => now,
      purgePorts,
    });
    const propose = kernel.proposeMemory.bind(kernel);
    kernel.proposeMemory = async (input) => {
      const result = await propose(input);
      afterProposal?.(result);
      return result;
    };
    const decide = kernel.decideMemory.bind(kernel);
    kernel.decideMemory = async (input) => {
      const result = await decide(input);
      afterDecision?.(result);
      return result;
    };
    const host = { kernel, port };
    hosts.push(host);
    return host;
  }
  function open(file = ":memory:", initialize = true) {
    db = new Database(file);
    if (initialize)
      db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
      INSERT INTO projects VALUES ('p2','${owner}','active',10,0);`);
    service = new ProjectGoalMemoryService({
      db,
      getActor: () => actor,
      memoryHostFactory: factory,
      clock: () => now,
    });
    if (initialize)
      goal = service.goals.create({
        projectId: "p1",
        objective: "Follow delivery",
      });
  }
  const input = (requestId = "memory-1", overrides = {}) => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId,
    content: "The user prefers a Friday delivery review.",
    category: "user-fact",
    ...overrides,
  });
  async function add(requestId = "memory-1", overrides = {}) {
    const result = await service.create(input(requestId, overrides));
    goal = result.goal;
    return result;
  }
  const listing = () => service.list({ goalId: goal.id });
  function target(item, requestId) {
    return {
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId,
      memoryId: item.memoryId,
      memoryVersion: item.currentVersion,
    };
  }
  beforeEach(() => {
    actor = owner;
    now = 1791321600000;
    hosts = [];
    purgePorts = [];
    afterProposal = null;
    afterDecision = null;
    open();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (db?.open) db.close();
  });

  it("writes only an explicit version reference to the goal and body-free operation journal", async () => {
    const result = await add();
    const view = listing();
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      unavailable: false,
      grantState: "active",
      record: {
        category: "user-fact",
        state: "active",
        content: input().content,
      },
    });
    expect(goal.memoryRefs).toEqual([result.operation.result.reference]);
    expect(goal.revision).toBe(2);
    expect(goal.controlGeneration).toBe(1);
    expect(JSON.stringify(goal)).not.toContain(input().content);
    const operationRow = db
      .prepare("SELECT record_json FROM cc_project_goal_memory_operations")
      .get();
    expect(operationRow.record_json).not.toContain(input().content);
    expect(view.items[0].record.scopeId).not.toContain(owner);
    expect(view.items[0].record.allowedSinks).toHaveLength(1);
    expect(service.revalidateOutput(view.outputToken).records[0].content).toBe(
      input().content,
    );
  });

  it.each(["agent-inference", "execution-note"])(
    "preserves explicit %s classification without asserting business completion",
    async (category) => {
      await add("category", { category });
      expect(listing().items[0].record.category).toBe(category);
      expect(goal.status).toBe("active");
      expect(goal.completion).toBeNull();
    },
  );

  it("does not automatically turn goal text or progress into memory", () => {
    expect(listing().items).toEqual([]);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(0);
  });

  it("replays the original request without creating another Kernel record or grant", async () => {
    const request = input();
    await add();
    const replay = await service.create(request);
    expect(replay.replayed).toBe(true);
    expect(replay.goal.revision).toBe(goal.revision);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(1);
    await expect(
      service.create({ ...request, content: "Changed fact" }),
    ).rejects.toMatchObject({ code: "GOAL_MEMORY_REQUEST_CONFLICT" });
  });

  it("corrects through a Kernel successor and denies the old output token", async () => {
    await add();
    const before = listing(),
      original = before.items[0];
    const result = await service.correct({
      ...target(original, "correct-1"),
      content: "Review delivery on Monday.",
      category: "user-fact",
    });
    goal = result.goal;
    const after = listing();
    expect(after.items).toHaveLength(2);
    expect(
      after.items.find((item) => item.memoryId === original.memoryId),
    ).toMatchObject({
      grantState: "corrected",
      state: "superseded",
      record: null,
    });
    const current = after.items.find((item) => !item.unavailable);
    expect(current.record).toMatchObject({
      content: "Review delivery on Monday.",
      supersedes: [original.memoryId],
    });
    expect(goal.memoryRefs).toEqual([current.reference]);
    expect(() => service.revalidateOutput(before.outputToken)).toThrow(
      "GOAL_MEMORY_OUTPUT_STALE",
    );
    expect(service.revalidateOutput(after.outputToken).records).toHaveLength(1);
  });

  it("revokes a grant before any future output and does not delete the Kernel authority record", async () => {
    await add();
    const before = listing(),
      request = target(before.items[0], "revoke-1");
    const result = service.revoke(request);
    goal = result.goal;
    expect(result.operation.status).toBe("complete");
    expect(listing().items[0]).toMatchObject({
      grantState: "revoked",
      state: "active",
      record: null,
    });
    expect(goal.memoryRefs).toEqual([]);
    expect(() => service.revalidateOutput(before.outputToken)).toThrow(
      "GOAL_MEMORY_OUTPUT_STALE",
    );
    expect(service.revoke(request).replayed).toBe(true);
  });

  it("does not grant output from forged goal references or re-added revoked references", async () => {
    await add();
    const before = listing();
    goal = service.revoke(target(before.items[0], "revoke")).goal;
    goal = service.goals.revise({
      id: goal.id,
      expectedRevision: goal.revision,
      patch: { memoryRefs: [before.items[0].reference] },
    });
    const current = listing();
    expect(current.items[0].record).toBeNull();
    expect(() =>
      service.revalidateOutput({
        ...current.outputToken,
        refs: [before.items[0].reference],
      }),
    ).toThrow("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
  });

  it("purges using the Kernel tombstone, persists the real receipt, and cannot resurrect by a new request", async () => {
    await add();
    const before = listing(),
      request = target(before.items[0], "delete-1");
    const result = await service.delete(request);
    goal = result.goal;
    expect(result.operation.result.receipt).toMatchObject({
      status: "purged",
      recordState: "purged",
      memoryId: request.memoryId,
    });
    expect(listing().items[0]).toMatchObject({
      grantState: "deleted",
      state: "purged",
      record: null,
    });
    expect(service.revalidateOutput(listing().outputToken).records).toEqual([]);
    expect(
      JSON.stringify(
        db.prepare("SELECT * FROM context_memory_sqlite_records").all(),
      ),
    ).not.toContain(input().content);
    expect((await service.delete(request)).replayed).toBe(true);
    await expect(
      service.delete({
        ...request,
        expectedRevision: goal.revision,
        requestId: "new-delete",
      }),
    ).rejects.toMatchObject({ code: "GOAL_MEMORY_DELETE_PENDING_OR_FINISHED" });
  });

  it("makes partial purge unreadable immediately and recovers the same deletion journal", async () => {
    await add();
    const before = listing();
    let failed = true;
    purgePorts = [
      {
        name: "projection",
        purge: () => {
          if (failed) throw new Error("offline");
          return { status: "purged" };
        },
      },
    ];
    const request = target(before.items[0], "delete-partial");
    const result = await service.delete(request);
    goal = result.goal;
    expect(result.operation.status).toBe("denied");
    expect(result.receipt.status).toBe("partial");
    expect(listing().items[0]).toMatchObject({
      state: "deleted",
      record: null,
    });
    expect(() => service.revalidateOutput(before.outputToken)).toThrow(
      "GOAL_MEMORY_OUTPUT_STALE",
    );
    failed = false;
    const recovered = await service.recover({
      goalId: goal.id,
      requestId: request.requestId,
    });
    expect(recovered.operation.status).toBe("complete");
    expect(recovered.operation.result.receipt.status).toBe("purged");
  });

  it("allows immediate revocation of another memory while one purge target is offline", async () => {
    await add("a");
    await add("b", { content: "Another explicit fact" });
    const initial = listing();
    const first = initial.items.find(
      (item) => item.record.content !== "Another explicit fact",
    );
    const other = initial.items.find(
      (item) => item.record.content === "Another explicit fact",
    );
    purgePorts = [
      {
        name: "offline",
        purge: () => {
          throw new Error("offline");
        },
      },
    ];
    const pending = await service.delete(target(first, "delete-offline"));
    goal = pending.goal;
    expect(pending.receipt.status).toBe("partial");
    expect(
      listing().items.find((item) => item.memoryId === other.memoryId).record
        .content,
    ).toBe("Another explicit fact");
    const revoked = service.revoke(target(other, "revoke-other"));
    goal = revoked.goal;
    expect(revoked.operation.status).toBe("complete");
    expect(listing().items.every((item) => item.record === null)).toBe(true);
  });

  it("allows privacy deletion even when the create/correct history capacity is exhausted", async () => {
    await add();
    const original = service.operations({ goalId: goal.id }).items[0];
    db.transaction(() => {
      for (let index = 1; index < 1000; index++) {
        const record = { ...original, requestId: `history-${index}` };
        db.prepare(
          "INSERT INTO cc_project_goal_memory_operations VALUES (?,?,?,?,?)",
        ).run(
          goal.id,
          owner,
          record.requestId,
          JSON.stringify(record),
          digest(record),
        );
      }
    }).immediate();
    await expect(service.create(input("over-capacity"))).rejects.toMatchObject({
      code: "GOAL_MEMORY_CAPACITY",
    });
    const result = await service.delete(
      target(listing().items[0], "privacy-at-capacity"),
    );
    goal = result.goal;
    expect(result.operation.result.receipt.status).toBe("purged");
    expect(listing().items[0].record).toBeNull();
  });

  it("rechecks identity and ownership after asynchronous Kernel work", async () => {
    afterProposal = () => {
      actor = "did:chainless:other";
    };
    await expect(service.create(input())).rejects.toMatchObject({
      code: "GOAL_IDENTITY_CHANGED",
    });
    expect(
      db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(1);
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_project_goal_memory_links").get()
        .n,
    ).toBe(0);
    actor = owner;
    afterProposal = null;
    const recovered = await service.recover({
      goalId: goal.id,
      requestId: "memory-1",
    });
    goal = recovered.goal;
    expect(recovered.operation.status).toBe("complete");
    expect(listing().items[0].record.content).toBe(input().content);
  });

  it("restores a half-finished correction without repeating the supersede transition", async () => {
    await add();
    const original = listing().items[0];
    afterDecision = () => {
      actor = "did:chainless:other";
    };
    await expect(
      service.correct({
        ...target(original, "correct-crash"),
        content: "Corrected fact",
        category: "user-fact",
      }),
    ).rejects.toMatchObject({ code: "GOAL_IDENTITY_CHANGED" });
    actor = owner;
    afterDecision = null;
    expect(
      listing().items.find((item) => item.memoryId === original.memoryId)
        .record,
    ).toBeNull();
    const recovered = await service.recover({
      goalId: goal.id,
      requestId: "correct-crash",
    });
    goal = recovered.goal;
    expect(recovered.operation.status).toBe("complete");
    const source = listing().items.find(
      (item) => item.memoryId === original.memoryId,
    );
    expect(source.currentVersion).toMatch(/^v1:r2:/);
    expect(
      listing().items.find((item) => !item.unavailable).record.content,
    ).toBe("Corrected fact");
  });

  it("shows an interrupted proposal requiring its original input and permits explicit discard", async () => {
    const failPropose = vi.fn(async () => {
      throw new Error("before commit");
    });
    const originalFactory = service.memoryHostFactory;
    service.memoryHostFactory = (args) => {
      const host = originalFactory(args);
      host.kernel.proposeMemory = failPropose;
      return host;
    };
    await expect(service.create(input())).rejects.toThrow("before commit");
    service.memoryHostFactory = originalFactory;
    const pending = await service.recover({
      goalId: goal.id,
      requestId: "memory-1",
    });
    expect(pending.blockedReason).toBe("GOAL_MEMORY_ORIGINAL_INPUT_REQUIRED");
    const request = {
      goalId: goal.id,
      expectedRevision: goal.revision,
      operationRequestId: "memory-1",
      requestId: "discard-1",
    };
    const discarded = await service.discard(request);
    goal = discarded.goal;
    expect(discarded.operation.status).toBe("discarded");
    expect((await service.discard(request)).replayed).toBe(true);
    expect((await add("after-discard")).operation.status).toBe("complete");
  });

  it("fences stale proposals, shows a recoverable conflict and purges their candidate on explicit discard", async () => {
    afterProposal = () => {
      goal = service.goals.revise({
        id: goal.id,
        expectedRevision: goal.revision,
        patch: { objective: "Revised objective" },
      });
    };
    await expect(service.create(input())).rejects.toMatchObject({
      code: "GOAL_REVISION_CONFLICT",
    });
    afterProposal = null;
    const pending = await service.recover({
      goalId: goal.id,
      requestId: "memory-1",
    });
    expect(pending.blockedReason).toBe("GOAL_REVISION_CONFLICT");
    expect(listing().items).toEqual([]);
    const discarded = await service.discard({
      goalId: goal.id,
      expectedRevision: goal.revision,
      operationRequestId: "memory-1",
      requestId: "discard-stale",
    });
    goal = discarded.goal;
    expect(discarded.operation.result.receipt.status).toBe("purged");
    expect((await add("new-memory")).operation.status).toBe("complete");
  });

  it("binds repeated discard client keys to each precise candidate rather than another operation receipt", async () => {
    for (const requestId of ["orphan-a", "orphan-b"]) {
      afterProposal = () => {
        goal = service.goals.revise({
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { objective: `Revision for ${requestId}` },
        });
      };
      await expect(service.create(input(requestId))).rejects.toMatchObject({
        code: "GOAL_REVISION_CONFLICT",
      });
      afterProposal = null;
      const discarded = await service.discard({
        goalId: goal.id,
        expectedRevision: goal.revision,
        operationRequestId: requestId,
        requestId: "reused-client-key",
      });
      goal = discarded.goal;
      expect(discarded.operation.result.receipt.memoryId).toBe(
        discarded.operation.memoryId,
      );
      expect(hosts.at(-1).port.read(discarded.operation.memoryId).state).toBe(
        "purged",
      );
    }
    const receipts = service
      .operations({ goalId: goal.id })
      .items.map((operation) => operation.result.receipt.requestId);
    expect(new Set(receipts).size).toBe(2);
  });

  it("rejects a completed deletion whose receipt was removed even if its journal digest was recalculated", async () => {
    await add();
    const request = target(listing().items[0], "delete-receipt");
    const deleted = await service.delete(request);
    goal = deleted.goal;
    const operation = clone(deleted.operation);
    operation.result.receipt = null;
    db.prepare(
      "UPDATE cc_project_goal_memory_operations SET record_json=?,content_digest=? WHERE request_id=?",
    ).run(JSON.stringify(operation), digest(operation), request.requestId);
    await expect(
      service.recover({ goalId: goal.id, requestId: request.requestId }),
    ).rejects.toMatchObject({ code: "GOAL_MEMORY_RECORD_CORRUPT" });
  });

  it("never returns a prior body after Kernel deletion, expiry or a new canonical revision", async () => {
    await add("expiring", { expiresAt: new Date(now + 1000).toISOString() });
    const prior = listing();
    now += 1000;
    expect(listing().items[0].record).toBeNull();
    expect(() => service.revalidateOutput(prior.outputToken)).toThrow(
      "GOAL_MEMORY_NOT_FOUND_OR_DENIED",
    );
  });

  it("rechecks exact record revision and digest rather than a global recall revision", async () => {
    await add();
    const prior = listing();
    const host = hosts.at(-1),
      record = host.port.read(prior.items[0].memoryId);
    const mutation = applyMemoryCommand(
      record,
      { type: "reinforce", expectedRevision: record.revision },
      { clock: () => now },
    );
    host.port.commit(mutation, record.revision);
    expect(listing().items[0].record).toBeNull();
    expect(() => service.revalidateOutput(prior.outputToken)).toThrow(
      "GOAL_MEMORY_NOT_FOUND_OR_DENIED",
    );
  });

  it("rejects cross-goal and cross-project references even for the same owner", async () => {
    await add();
    const prior = listing();
    const other = service.goals.create({
      projectId: "p2",
      objective: "Other project",
    });
    const revised = service.goals.revise({
      id: other.id,
      expectedRevision: other.revision,
      patch: { memoryRefs: [prior.items[0].reference] },
    });
    const otherView = service.list({ goalId: revised.id });
    expect(otherView.items).toEqual([]);
    expect(() =>
      service.revalidateOutput({
        ...otherView.outputToken,
        refs: [prior.items[0].reference],
      }),
    ).toThrow("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
  });

  it("denies prior output and mutation replay after current personal ownership is revoked", async () => {
    const request = input();
    await add();
    const prior = listing();
    db.prepare(
      "UPDATE projects SET user_id='did:chainless:other' WHERE id='p1'",
    ).run();
    expect(() => listing()).toThrow("GOAL_NOT_FOUND_OR_DENIED");
    expect(() => service.revalidateOutput(prior.outputToken)).toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
    await expect(service.create(request)).rejects.toMatchObject({
      code: "GOAL_NOT_FOUND_OR_DENIED",
    });
  });

  it("allows privacy cleanup after verified completion without fabricating a replacement business proof", async () => {
    await add();
    const completion = new ProjectGoalCompletionService({
      db,
      getActor: () => actor,
      clock: () => now,
      approvalGate: new ApprovalGate({ confirm: async () => true }),
    });
    const configured = completion.configure({
      goalId: goal.id,
      expectedRevision: goal.revision,
      acceptanceCriteria: [
        { id: "owner", kind: "manual", description: "Owner accepted" },
      ],
      assertions: [],
    });
    goal = configured.goal;
    await completion.acknowledge({
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "owner-ack",
    });
    const completed = completion.complete({
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "complete",
    });
    goal = completed.goal;
    const proof = clone(goal.completion),
      ref = listing().items[0];
    const result = await service.delete(target(ref, "delete-done"));
    goal = result.goal;
    expect(goal.status).toBe("done");
    expect(goal.completion).toEqual(proof);
    expect(result.operation.result.goalReferenceRetained).toBe(true);
    expect(listing().items[0].record).toBeNull();
    expect(completion.status({ goalId: goal.id }).goal.status).toBe("done");
  });

  it.each([
    { actorDid: "did:chainless:other" },
    { memoryEpoch: 9000 },
    { content: "cached injected body" },
    { goalRevision: 9000 },
  ])("rejects forged output envelope %j", async (patch) => {
    await add();
    const prior = listing();
    expect(() =>
      service.revalidateOutput({ ...prior.outputToken, ...patch }),
    ).toThrow();
  });

  it("rejects corrupt operations and retains native rollback if goal association fails", async () => {
    const fail = vi
      .spyOn(service.adapter, "compareAndSwapInTransaction")
      .mockImplementation(() => {
        throw Object.assign(new Error("CAS failed"), {
          code: "GOAL_REVISION_CONFLICT",
        });
      });
    await expect(service.create(input())).rejects.toMatchObject({
      code: "GOAL_REVISION_CONFLICT",
    });
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_project_goal_memory_links").get()
        .n,
    ).toBe(0);
    expect(service.operations({ goalId: goal.id }).items[0].status).toBe(
      "prepared",
    );
    fail.mockRestore();
    const row = db
      .prepare("SELECT record_json FROM cc_project_goal_memory_operations")
      .get();
    const record = JSON.parse(row.record_json);
    record.actorDid = "did:chainless:other";
    db.prepare(
      "UPDATE cc_project_goal_memory_operations SET record_json=?,content_digest=?",
    ).run(JSON.stringify(record), digest(record));
    await expect(
      service.recover({ goalId: goal.id, requestId: "memory-1" }),
    ).rejects.toMatchObject({ code: "GOAL_MEMORY_RECORD_CORRUPT" });
  });

  it("persists operation, canonical source, reference and revoked authorization through a real file reopen", async () => {
    db.close();
    const root = resolve(tmpdir()),
      dir = mkdtempSync(join(root, "goal-memory-"));
    try {
      const file = join(dir, "project.sqlite");
      open(file);
      await add();
      const before = listing();
      db.close();
      open(file, false);
      expect(
        service.revalidateOutput(before.outputToken).records[0].content,
      ).toBe(input().content);
      goal = service.revoke(target(listing().items[0], "revoke-reopen")).goal;
      db.close();
      open(file, false);
      expect(listing().items[0].record).toBeNull();
      expect(() => service.revalidateOutput(before.outputToken)).toThrow(
        "GOAL_MEMORY_OUTPUT_STALE",
      );
      expect(service.operations({ goalId: goal.id }).items).toHaveLength(2);
    } finally {
      if (db?.open) db.close();
      const target = resolve(dir);
      if (!target.startsWith(root + sep) || target === root)
        throw new Error("Invalid cleanup target");
      rmSync(target, { recursive: true, force: true });
    }
  });
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
