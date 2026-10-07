import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ContextMemoryKernel,
  NativeSqliteMemoryPort,
  applyMemoryCommand,
} = require("@chainlesschain/context-memory-kernel");
const {
  OrganizationProjectGoalMemoryService,
} = require("../../../session-core/lib/organization-project-goal-memory");
const {
  OrganizationProjectAuthority,
} = require("../../../session-core/lib/organization-project-authority");
const {
  OrganizationProjectGoalCompletionService,
} = require("../../../session-core/lib/organization-project-goal-completion");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract");
const { reviseGoalRecord } = require("../../../session-core/lib/goal-contract");

describe("organization shared Kernel memory with actual actor authority", () => {
  const owner = "did:owner",
    member = "did:member",
    second = "did:second",
    reader = "did:reader",
    deleter = "did:deleter",
    basic = "did:basic";
  let db,
    directory,
    actor,
    now,
    authority,
    service,
    goal,
    grants,
    confirmation,
    afterProposal,
    afterDecision,
    purgePorts,
    hosts;
  function factory({ scope, authorize }) {
    const port = new NativeSqliteMemoryPort({ db, scope, authorize });
    const kernel = new ContextMemoryKernel({
      memoryPort: port,
      reconciliationPort: port,
      clock: () => now,
      purgePorts,
    });
    const propose = kernel.proposeMemory.bind(kernel),
      decide = kernel.decideMemory.bind(kernel);
    kernel.proposeMemory = async (value) => {
      const result = await propose(value);
      afterProposal?.(result);
      return result;
    };
    kernel.decideMemory = async (value) => {
      const result = await decide(value);
      afterDecision?.(result);
      return result;
    };
    const host = { port, kernel };
    hosts.push(host);
    return host;
  }
  function reopen() {
    authority = new OrganizationProjectAuthority({
      db,
      getActor: () => actor,
      now: () => now,
      confirm: async () => true,
    });
    service = new OrganizationProjectGoalMemoryService({
      db,
      getActor: () => actor,
      authority,
      memoryHostFactory: factory,
      confirm: (value) => confirmation(value),
      clock: () => now,
    });
  }
  async function attest() {
    const before = actor;
    actor = owner;
    const input = { orgId: "org1", permissions: grants };
    await authority.attestPolicy({
      ...input,
      expectedDigest: authority.previewPolicy(input).digest,
    });
    actor = before;
  }
  function createGoal(requestId = "goal-1") {
    const input = { projectId: "p1", requestId, objective: "Shared delivery" };
    return service.goals.create(input, {
      expectedAuthority: service.goals.prepareCreate(input).authority,
    }).goal;
  }
  const input = (requestId = "memory-1", extra = {}) => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId,
    content: "Review delivery on Friday.",
    category: "user-fact",
    ...extra,
  });
  const list = () => service.list({ goalId: goal.id });
  const target = (item, requestId) => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId,
    memoryId: item.memoryId,
    memoryVersion: item.currentVersion,
  });
  async function add(requestId = "memory-1", extra = {}) {
    const result = await service.create(input(requestId, extra));
    goal = result.goal;
    return result;
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-memory-"));
    db = new Database(join(directory, "memory.db"));
    actor = owner;
    now = 1791321600000;
    hosts = [];
    purgePorts = [];
    afterProposal = null;
    afterDecision = null;
    confirmation = vi.fn(async () => true);
    db.exec(`CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT,description TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
      INSERT INTO organization_info VALUES('org1','did:org:1','${owner}');
      INSERT INTO organization_projects VALUES('op1','org1','${owner}');
      INSERT INTO projects VALUES('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES('t1','p1','pending',10,0,NULL,NULL,'Original',NULL,NULL);`);
    for (const [index, did] of [
      owner,
      member,
      second,
      reader,
      deleter,
      basic,
    ].entries())
      db.prepare(
        "INSERT INTO organization_members VALUES(?,'org1',?,?,'active')",
      ).run(`m${index}`, did, did === owner ? "owner" : "member");
    reopen();
    grants = [owner, member, second, reader, deleter, basic].map(
      (actorDid) => ({
        actorDid,
        projectId: "p1",
        expiresAt: now + 86400000,
        permissions: [
          "goal.read",
          ...(actorDid === basic
            ? []
            : actorDid === reader
              ? ["goal.memory.read"]
              : actorDid === deleter
                ? ["goal.memory.delete"]
                : [
                    "goal.create",
                    "goal.memory.read",
                    "goal.memory.write",
                    "goal.memory.delete",
                  ]),
        ],
      }),
    );
    await attest();
    const binding = {
      orgId: "org1",
      projectId: "p1",
      organizationProjectId: "op1",
    };
    await authority.bindProject({
      ...binding,
      expectedDigest: authority.previewBinding(binding).digest,
    });
    actor = member;
    goal = createGoal();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("shares creator-independent namespace, body-free metadata and actual actor attribution", async () => {
    const created = await add();
    const before = list();
    actor = second;
    const shared = list();
    expect(shared.items[0].record.content).toBe(input().content);
    expect(shared.outputToken.scopeId).toBe(before.outputToken.scopeId);
    expect(shared.actorDid).toBe(second);
    expect(shared.orgId).toBe("org1");
    expect(shared.authorityExpiresAt).toBe(now + 86400000);
    expect(created.operation.actorDid).toBe(member);
    expect(goal.ownerRef).toBe(member);
    expect(goal.memoryRefs).toEqual([created.operation.result.reference]);
    expect(JSON.stringify(goal)).not.toContain(input().content);
    expect(
      db
        .prepare(
          "SELECT record_json FROM cc_organization_project_goal_memory_operations",
        )
        .get().record_json,
    ).not.toContain(input().content);
    expect(service.operations({ goalId: goal.id }).items).toEqual([]);
    expect(service.revalidateOutput(shared.outputToken).records).toHaveLength(
      1,
    );
    expect(() => service.revalidateOutput(before.outputToken)).toThrow(
      "GOAL_MEMORY_OUTPUT_STALE",
    );
  });
  it("allows a different member to correct and revoke without goal.update", async () => {
    await add();
    const before = list();
    actor = second;
    const corrected = await service.correct({
      ...target(before.items[0], "correct"),
      content: "Review Monday.",
      category: "execution-note",
    });
    goal = corrected.goal;
    expect(corrected.operation.actorDid).toBe(second);
    expect(list().items.find((item) => !item.unavailable).record.content).toBe(
      "Review Monday.",
    );
    const current = list();
    const revoked = await service.revoke(
      target(
        current.items.find((item) => !item.unavailable),
        "revoke",
      ),
    );
    goal = revoked.goal;
    expect(list().items.every((item) => item.record === null)).toBe(true);
    expect(goal.memoryRefs).toEqual([]);
    expect(() => service.revalidateOutput(current.outputToken)).toThrow(
      "GOAL_MEMORY_OUTPUT_STALE",
    );
  });
  it("isolates same nonce across actors with distinct Kernel identities", async () => {
    await add("same");
    actor = second;
    await add("same", { content: "Second actor fact" });
    expect(list().items).toHaveLength(2);
    expect(new Set(list().items.map((item) => item.memoryId)).size).toBe(2);
    expect(service.operations({ goalId: goal.id }).items).toHaveLength(1);
  });
  it("confirms only new mutations and requires exact original input on replay", async () => {
    const request = input();
    await add();
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect((await service.create(request)).replayed).toBe(true);
    expect(confirmation).toHaveBeenCalledTimes(1);
    await expect(
      service.create({ ...request, content: "changed" }),
    ).rejects.toMatchObject({ code: "GOAL_MEMORY_REQUEST_CONFLICT" });
    expect(
      db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(1);
  });
  it("native cancellation has no grant, operation, revision or Kernel body effects", async () => {
    confirmation.mockResolvedValue(false);
    expect(await service.create(input())).toMatchObject({
      cancelled: true,
      operation: "create",
    });
    expect(list().items).toEqual([]);
    expect(service.operations({ goalId: goal.id }).items).toEqual([]);
    expect(service.goals.get({ id: goal.id }).revision).toBe(goal.revision);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(0);
  });
  it.each([basic, reader, deleter])(
    "denies create for %s before confirmation",
    async (did) => {
      actor = did;
      await expect(service.create(input())).rejects.toMatchObject({
        code: "ORG_AUTH_NOT_FOUND_OR_DENIED",
      });
      expect(confirmation).not.toHaveBeenCalled();
    },
  );
  it("separates read from delete authority and resumes partial deletion with delete alone", async () => {
    await add();
    const before = list();
    let offline = true;
    purgePorts = [
      {
        name: "projection",
        purge: () => {
          if (offline) throw new Error("offline");
          return { status: "purged" };
        },
      },
    ];
    actor = deleter;
    expect(() => list()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    const deleted = await service.delete(target(before.items[0], "delete"));
    goal = deleted.goal;
    expect(deleted.receipt.status).toBe("partial");
    offline = false;
    const recovered = await service.recover({
      goalId: goal.id,
      requestId: "delete",
    });
    expect(recovered.operation.result.receipt.status).toBe("purged");
    expect(confirmation).toHaveBeenCalledTimes(2);
    actor = reader;
    expect(list().items[0].record).toBeNull();
    expect(() => service.revalidateOutput(before.outputToken)).toThrow();
  });
  it("rechecks member revocation and ABA during native confirmation before journaling", async () => {
    confirmation.mockImplementation(async () => {
      db.prepare(
        "UPDATE organization_members SET status='inactive' WHERE member_did=?",
      ).run(member);
      db.prepare(
        "UPDATE organization_members SET status='active' WHERE member_did=?",
      ).run(member);
      return true;
    });
    await expect(service.create(input())).rejects.toThrow();
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_goal_memory_operations",
        )
        .get().n,
    ).toBe(0);
  });
  it("rejects post-Kernel actor change, then recovers the same actor once without reconfirming", async () => {
    afterProposal = vi.fn(() => {
      actor = second;
    });
    await expect(service.create(input())).rejects.toMatchObject({
      code: "GOAL_IDENTITY_CHANGED",
    });
    expect(afterProposal).toHaveBeenCalledTimes(1);
    await expect(
      service.recover({ goalId: goal.id, requestId: "memory-1" }),
    ).rejects.toMatchObject({ code: "GOAL_MEMORY_OPERATION_NOT_FOUND" });
    actor = member;
    afterProposal = null;
    const recovered = await service.recover({
      goalId: goal.id,
      requestId: "memory-1",
    });
    goal = recovered.goal;
    expect(recovered.operation.status).toBe("complete");
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(list().items).toHaveLength(1);
  });
  it("restores a post-supersede unknown correction without another Kernel transition", async () => {
    await add();
    const original = list().items[0];
    afterDecision = vi.fn(() => {
      actor = second;
    });
    await expect(
      service.correct({
        ...target(original, "correct-unknown"),
        content: "Corrected",
        category: "user-fact",
      }),
    ).rejects.toMatchObject({ code: "GOAL_IDENTITY_CHANGED" });
    expect(afterDecision).toHaveBeenCalledTimes(1);
    actor = member;
    afterDecision = null;
    const result = await service.recover({
      goalId: goal.id,
      requestId: "correct-unknown",
    });
    goal = result.goal;
    expect(
      list().items.find((item) => item.memoryId === original.memoryId)
        .currentVersion,
    ).toMatch(/^v1:r2:/);
    expect(list().items.find((item) => !item.unavailable).record.content).toBe(
      "Corrected",
    );
    expect(confirmation).toHaveBeenCalledTimes(2);
  });
  it("persists unknown before proposal and recovery never reconstructs or writes missing input", async () => {
    const normal = service.memoryHostFactory;
    service.memoryHostFactory = (args) => {
      const host = normal(args);
      host.kernel.proposeMemory = async () => {
        throw new Error("interrupted");
      };
      return host;
    };
    await expect(service.create(input())).rejects.toThrow("interrupted");
    service.memoryHostFactory = normal;
    const recovered = await service.recover({
      goalId: goal.id,
      requestId: "memory-1",
    });
    expect(recovered.blockedReason).toBe("GOAL_MEMORY_ORIGINAL_INPUT_REQUIRED");
    expect(confirmation).toHaveBeenCalledTimes(1);
    const discarded = await service.discard({
      goalId: goal.id,
      expectedRevision: goal.revision,
      operationRequestId: "memory-1",
      requestId: "discard",
    });
    goal = discarded.goal;
    expect(discarded.operation.status).toBe("discarded");
    expect(confirmation).toHaveBeenCalledTimes(2);
    await add("next");
    expect(list().items).toHaveLength(1);
  });
  it("blocks simultaneous cross-actor creators while preserving owner-only unknown recovery", async () => {
    const normal = service.memoryHostFactory;
    service.memoryHostFactory = (args) => {
      const host = normal(args);
      host.kernel.proposeMemory = async () => {
        throw new Error("interrupted");
      };
      return host;
    };
    await expect(service.create(input())).rejects.toThrow("interrupted");
    service.memoryHostFactory = normal;
    actor = second;
    await expect(service.create(input("new"))).rejects.toMatchObject({
      code: "GOAL_MEMORY_OPERATION_PENDING",
    });
    await expect(
      service.discard({
        goalId: goal.id,
        expectedRevision: goal.revision,
        operationRequestId: "memory-1",
        requestId: "discard",
      }),
    ).rejects.toMatchObject({ code: "GOAL_MEMORY_OPERATION_NOT_FOUND" });
  });
  it("denies prior output after current expiry, policy refresh and exact Kernel revision change", async () => {
    await add("short", { expiresAt: new Date(now + 1000).toISOString() });
    const before = list();
    now += 1000;
    expect(list().items[0].record).toBeNull();
    expect(() => service.revalidateOutput(before.outputToken)).toThrow(
      "GOAL_MEMORY_NOT_FOUND_OR_DENIED",
    );
    now -= 1000;
    await attest();
    expect(() => service.revalidateOutput(before.outputToken)).toThrow(
      "GOAL_MEMORY_OUTPUT_STALE",
    );
    const current = list(),
      host = hosts.at(-1),
      record = host.port.read(current.items[0].memoryId);
    const mutation = applyMemoryCommand(
      record,
      { type: "reinforce", expectedRevision: record.revision },
      { clock: () => now },
    );
    host.port.commit(mutation, record.revision);
    expect(() => service.revalidateOutput(current.outputToken)).toThrow(
      "GOAL_MEMORY_NOT_FOUND_OR_DENIED",
    );
  });
  it("denies static output after organization grant expiry", async () => {
    await add();
    const before = list();
    now = before.authorityExpiresAt;
    expect(() => service.revalidateOutput(before.outputToken)).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => list()).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
  });
  it("requires a durable goal-scoped grant despite forged current goal refs", async () => {
    await add();
    const first = list(),
      other = createGoal("goal-2");
    const forged = reviseGoalRecord(
      other,
      { memoryRefs: [first.items[0].reference] },
      new Date(now).toISOString(),
    );
    db.prepare(
      "UPDATE cc_organization_project_goals SET goal_json=?,content_digest=?,revision=? WHERE id=?",
    ).run(JSON.stringify(forged), digest(forged), forged.revision, other.id);
    const view = service.list({ goalId: other.id });
    expect(view.items).toEqual([]);
    expect(() =>
      service.revalidateOutput({
        ...view.outputToken,
        refs: first.outputToken.refs,
      }),
    ).toThrow("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
  });
  it.each(["membership", "expiry", "source", "schema"])(
    "rejects %s authority changes after a real Kernel proposal",
    async (change) => {
      afterProposal = vi.fn(() => {
        if (change === "membership")
          db.prepare(
            "UPDATE organization_members SET status='inactive' WHERE member_did=?",
          ).run(member);
        if (change === "expiry") now += 86400000;
        if (change === "source")
          db.prepare(
            "UPDATE project_tasks SET description='changed' WHERE id='t1'",
          ).run();
        if (change === "schema")
          db.exec("CREATE TABLE newly_installed_table(id TEXT)");
      });
      await expect(service.create(input())).rejects.toThrow();
      expect(afterProposal).toHaveBeenCalledTimes(1);
      expect(
        db
          .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
          .get().n,
      ).toBe(1);
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM cc_organization_project_goal_memory_links",
          )
          .get().n,
      ).toBe(0);
      expect(
        db
          .prepare(
            "SELECT revision FROM cc_organization_project_goals WHERE id=?",
          )
          .get(goal.id).revision,
      ).toBe(goal.revision);
    },
  );
  it("rolls back grants, epoch and goal CAS on a real SQLite failure while retaining recoverable Kernel evidence", async () => {
    let armed = false,
      hits = 0;
    db.function("fail_memory_goal_write", () => {
      if (armed) {
        hits++;
        throw new Error("injected goal CAS failure");
      }
      return 0;
    });
    db.exec(
      "CREATE TRIGGER fail_goal_memory_write BEFORE UPDATE ON cc_organization_project_goals BEGIN SELECT fail_memory_goal_write(); END;",
    );
    armed = true;
    await expect(service.create(input())).rejects.toThrow(
      "GOAL_STORAGE_FAILED",
    );
    expect(hits).toBe(1);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_goal_memory_links",
        )
        .get().n,
    ).toBe(0);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_goal_memory_authority",
        )
        .get().n,
    ).toBe(0);
    expect(service.operations({ goalId: goal.id }).items[0].status).toBe(
      "prepared",
    );
    armed = false;
    const result = await service.recover({
      goalId: goal.id,
      requestId: "memory-1",
    });
    goal = result.goal;
    expect(list().items).toHaveLength(1);
    expect(confirmation).toHaveBeenCalledTimes(1);
  });
  it("detects a recomputed journal whose original deletion receipt is missing", async () => {
    await add();
    const result = await service.delete(target(list().items[0], "delete"));
    goal = result.goal;
    const operation = structuredClone(result.operation);
    operation.result.receipt = null;
    db.prepare(
      "UPDATE cc_organization_project_goal_memory_operations SET record_json=?,content_digest=? WHERE request_id='delete'",
    ).run(JSON.stringify(operation), digest(operation));
    await expect(
      service.recover({ goalId: goal.id, requestId: "delete" }),
    ).rejects.toThrow("GOAL_MEMORY_RECORD_CORRUPT");
  });
  it("keeps revoked refs unreadable even when reinserted in the goal with matching digest", async () => {
    await add();
    const before = list();
    goal = (await service.revoke(target(before.items[0], "revoke"))).goal;
    const forged = reviseGoalRecord(
      goal,
      { memoryRefs: before.outputToken.refs },
      new Date(now).toISOString(),
    );
    db.prepare(
      "UPDATE cc_organization_project_goals SET goal_json=?,content_digest=?,revision=? WHERE id=?",
    ).run(JSON.stringify(forged), digest(forged), forged.revision, goal.id);
    goal = forged;
    expect(list().items[0].record).toBeNull();
    const token = list().outputToken;
    expect(() =>
      service.revalidateOutput({ ...token, refs: before.outputToken.refs }),
    ).toThrow("GOAL_MEMORY_NOT_FOUND_OR_DENIED");
  });
  it("denies oversized journal material before decoding and rejects extra body fields", async () => {
    await add();
    const row = db
      .prepare("SELECT * FROM cc_organization_project_goal_memory_operations")
      .get();
    const value = JSON.parse(row.record_json);
    value.content = "private body";
    db.prepare(
      "UPDATE cc_organization_project_goal_memory_operations SET record_json=?,content_digest=?",
    ).run(JSON.stringify(value), digest(value));
    expect(() => service.operations({ goalId: goal.id })).toThrow(
      "GOAL_MEMORY_RECORD_CORRUPT",
    );
    db.prepare(
      "UPDATE cc_organization_project_goal_memory_operations SET record_json=?",
    ).run(" ".repeat(65537));
    expect(() => service.operations({ goalId: goal.id })).toThrow(
      "GOAL_MEMORY_RECORD_CORRUPT",
    );
  });
  it("does not confuse a task or memory write with business completion", async () => {
    await add();
    expect(goal.status).toBe("active");
    expect(goal.completion).toBeNull();
    expect(goal.progress.completedAt).toBeUndefined();
  });
  it.each(["revoke", "delete"])(
    "permits %s privacy cleanup after real independent completion while preserving its proof",
    async (operation) => {
      await add();
      grants
        .find((entry) => entry.actorDid === member)
        .permissions.push(
          "goal.accept",
          "goal.update",
          "risk.read",
          "risk.evaluate",
          "task.read",
        );
      await attest();
      const completion = new OrganizationProjectGoalCompletionService({
        db,
        getActor: () => actor,
        authority,
        goals: service.goals,
        clock: () => now,
      });
      const configure = {
        goalId: goal.id,
        expectedRevision: goal.revision,
        requestId: "acceptance",
        acceptanceCriteria: [
          { id: "accepted", kind: "manual", description: "Member accepted" },
        ],
        assertions: [],
      };
      goal = completion.configure(configure, {
        expectedAuthority: completion.prepareConfigure(configure).authority,
      }).goal;
      const ack = {
        goalId: goal.id,
        expectedRevision: goal.revision,
        requestId: "ack",
        criterionIds: ["accepted"],
      };
      completion.acknowledge(ack, {
        expectedAuthority: completion.prepareAcknowledge(ack).authority,
        confirmed: true,
      });
      const finish = {
          goalId: goal.id,
          expectedRevision: goal.revision,
          requestId: "complete",
        },
        preview = completion.prepareComplete(finish);
      goal = completion.complete(finish, {
        expectedAuthority: preview.authority,
        expectedFreshnessDigest: preview.freshnessDigest,
      }).goal;
      expect(goal.status).toBe("done");
      const proof = structuredClone(goal.completion),
        refs = structuredClone(goal.memoryRefs),
        revision = goal.revision,
        item = list().items[0];
      await expect(service.create(input("after-done"))).rejects.toThrow(
        "GOAL_MEMORY_REOPEN_REQUIRED",
      );
      await expect(
        service.correct({
          ...target(item, "correct-done"),
          content: "Forbidden replacement",
          category: "user-fact",
        }),
      ).rejects.toThrow("GOAL_MEMORY_REOPEN_REQUIRED");
      goal = (await service[operation](target(item, "privacy"))).goal;
      expect(goal.status).toBe("done");
      expect(goal.completion).toEqual(proof);
      expect(goal.revision).toBe(revision);
      expect(goal.memoryRefs).toEqual(refs);
      expect(list().items[0].record).toBeNull();
      expect(completion.status({ goalId: goal.id }).goal.completion).toEqual(
        proof,
      );
    },
  );
  it("keeps shared memory accessible to a currently authorized member after its creator leaves", async () => {
    await add();
    db.prepare(
      "UPDATE organization_members SET status='inactive' WHERE member_did=?",
    ).run(member);
    grants = grants.filter((entry) => entry.actorDid !== member);
    actor = second;
    await attest();
    const shared = list();
    expect(shared.items[0].record.content).toBe(input().content);
    goal = (
      await service.correct({
        ...target(shared.items[0], "new-member-correction"),
        content: "New team fact",
        category: "user-fact",
      })
    ).goal;
    expect(list().items.find((item) => !item.unavailable).record.content).toBe(
      "New team fact",
    );
    expect(goal.ownerRef).toBe(member);
  });
  it("persists an unknown across a real database reopen and retains actor partition", async () => {
    afterProposal = () => {
      actor = second;
    };
    await expect(service.create(input())).rejects.toThrow(
      "GOAL_IDENTITY_CHANGED",
    );
    db.close();
    db = new Database(join(directory, "memory.db"));
    actor = member;
    afterProposal = null;
    reopen();
    const recovered = await service.recover({
      goalId: goal.id,
      requestId: "memory-1",
    });
    goal = recovered.goal;
    expect(list().items[0].record.content).toBe(input().content);
    expect(recovered.operation.actorDid).toBe(member);
    expect(confirmation).toHaveBeenCalledTimes(1);
  });
});
