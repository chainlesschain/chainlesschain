import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  OrganizationProjectAuthority,
} = require("../../../session-core/lib/organization-project-authority");
const {
  OrganizationProjectGoalService,
} = require("../../../session-core/lib/organization-project-goal-service");
const {
  OrganizationProjectGoalMonitoringEngine,
} = require("../../../session-core/lib/organization-project-goal-monitoring");
const {
  PersonalProjectGoalService,
} = require("../../../session-core/lib/project-goal-service");
const {
  GoalUsageLedger,
} = require("../../../session-core/lib/goal-usage-ledger");
const {
  createGoalRecord,
  validateGoalRecord,
} = require("../../../session-core/lib/goal-contract");
const {
  openSchedulerStore,
} = require("../../../session-core/lib/scheduler-store");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract");

describe("organization shared goals and manual scheduler occurrences", () => {
  const owner = "did:owner",
    member = "did:member",
    second = "did:second",
    reader = "did:reader",
    riskReader = "did:risk-reader",
    updater = "did:updater";
  let directory,
    db,
    store,
    engine,
    goals,
    authority,
    actor,
    now,
    permissions,
    personal,
    personalGoal;
  function open() {
    db = new Database(join(directory, "domain.db"));
    db.pragma("foreign_keys=ON");
    authority = new OrganizationProjectAuthority({
      db,
      getActor: () => actor,
      now: () => now,
      confirm: async () => true,
    });
    store = openSchedulerStore({
      file: join(directory, "scheduler.db"),
      Database,
      protectStorage: () => true,
      clock: () => now,
    });
    engine = new OrganizationProjectGoalMonitoringEngine({
      db,
      store,
      authority,
      getActor: () => actor,
      clock: () => now,
      leaseMs: 60000,
    });
    goals = engine.state.goals;
  }
  async function attest() {
    actor = owner;
    const input = { orgId: "org1", permissions };
    await authority.attestPolicy({
      ...input,
      expectedDigest: authority.previewPolicy(input).digest,
    });
    actor = member;
  }
  function create(extra = {}) {
    const input = {
      projectId: "p1",
      requestId: "create-1",
      objective: "Track delivery risk",
      ...extra,
    };
    return goals.create(input, {
      expectedAuthority: goals.prepareCreate(input).authority,
    }).goal;
  }
  function revise(goal, patch, requestId = "revise-1") {
    const input = {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId,
      patch,
    };
    return goals.revise(input, {
      expectedAuthority: goals.prepareRevise(input).authority,
    }).goal;
  }
  const checkInput = (goal, requestId = "check-1") => ({
    id: goal.id,
    expectedRevision: goal.revision,
    requestId,
  });
  const count = (table) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-organization-goal-"));
    now = 1791244800000;
    actor = owner;
    db = new Database(join(directory, "domain.db"));
    db.exec(`CREATE TABLE organization_info(org_id TEXT PRIMARY KEY,org_did TEXT,owner_did TEXT);
      CREATE TABLE organization_members(id TEXT PRIMARY KEY,org_id TEXT,member_did TEXT,role TEXT,status TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT,owner_did TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT,description TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
      INSERT INTO organization_info VALUES('org1','did:org:1','${owner}');
      INSERT INTO organization_projects VALUES('op1','org1','${owner}');
      INSERT INTO projects VALUES('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES('t1','p1','pending',10,0,1,NULL,'Original',NULL,NULL);`);
    for (const [index, did] of [
      owner,
      member,
      second,
      reader,
      riskReader,
      updater,
    ].entries())
      db.prepare(
        "INSERT INTO organization_members VALUES(?,'org1',?,?,'active')",
      ).run(`m${index}`, did, did === owner ? "owner" : "member");
    db.close();
    open();
    personal = new PersonalProjectGoalService({
      db,
      getActor: () => actor,
      now: () => new Date(now).toISOString(),
    });
    personalGoal = personal.create({
      projectId: "p1",
      objective: "Private before migration",
    });
    permissions = [owner, member, second, reader, riskReader, updater].map(
      (actorDid) => ({
        actorDid,
        projectId: "p1",
        expiresAt: now + 86400000,
        permissions:
          actorDid === reader
            ? ["goal.read"]
            : actorDid === riskReader
              ? ["goal.read", "risk.read"]
              : actorDid === updater
                ? ["goal.read", "goal.update"]
                : [
                    "goal.read",
                    "goal.create",
                    "goal.update",
                    "goal.check",
                    "risk.read",
                    "risk.evaluate",
                  ],
      }),
    );
    await attest();
    actor = owner;
    const input = {
      orgId: "org1",
      projectId: "p1",
      organizationProjectId: "op1",
    };
    await authority.bindProject({
      ...input,
      expectedDigest: authority.previewBinding(input).digest,
    });
    actor = member;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await engine?.close();
    store?.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("shares goals across current goal.read grants and preserves the creator solely as attribution", () => {
    const goal = create();
    expect(goal).toMatchObject({
      ownerRef: member,
      projectRef: {
        scope: { kind: "organization", id: "org1" },
        sourceKind: "desktop.organization-project-goals",
      },
      status: "active",
      revision: 1,
      allowedActionTypes: [],
    });
    actor = reader;
    expect(goals.get({ id: goal.id })).toEqual(goal);
    expect(goals.list({ projectId: "p1" })).toEqual({
      goals: [goal],
      nextCursor: null,
    });
    expect(engine.status({ id: goal.id })).toMatchObject({
      goal,
      usage: { totalRuns: 0 },
      manualOnly: false,
    });
    expect(() => engine.history({ id: goal.id })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => create({ requestId: "reader-create" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    expect(() => revise(goal, { title: "Reader edit" })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
    actor = updater;
    const next = revise(goal, { title: "Shared edit" });
    expect(next).toMatchObject({
      ownerRef: member,
      title: "Shared edit",
      revision: 2,
      controlGeneration: 1,
    });
    actor = member;
    expect(goals.get({ id: goal.id })).toEqual(next);
    expect(() =>
      revise(goal, { title: "Stale overwrite" }, "other-update"),
    ).toThrow("GOAL_REVISION_CONFLICT");
  });

  it("keeps personal records and personal usage paths isolated after migration", () => {
    const goal = create();
    expect(goals.get({ id: personalGoal.id })).toBeNull();
    actor = owner;
    expect(() => personal.get({ id: personalGoal.id })).toThrow(
      "GOAL_ORGANIZATION_UNSUPPORTED",
    );
    expect(personal.get({ id: goal.id })).toBeNull();
    const ledger = new GoalUsageLedger({ db });
    expect(() =>
      db.transaction(() => ledger.summary(goal, member)).immediate(),
    ).toThrow("GOAL_USAGE_SCOPE_DENIED");
    expect(
      () => new GoalUsageLedger({ db, namespace: "organization" }),
    ).toThrow("GOAL_USAGE_SCOPE_DENIED");
    expect(() =>
      validateGoalRecord({
        ...goal,
        projectRef: { ...goal.projectRef, sourceKind: "desktop.project-goals" },
      }),
    ).toThrow("GOAL_INVALID_PROJECT_SCOPE");
    expect(() =>
      validateGoalRecord({
        ...goal,
        projectRef: {
          ...goal.projectRef,
          scope: { kind: "personal", id: "did:other" },
        },
      }),
    ).toThrow("GOAL_INVALID_PROJECT_SCOPE");
    expect(validateGoalRecord(goal)).toEqual(goal);
  });

  it("persists idempotent create/update receipts without treating retries as new intent", () => {
    const input = {
        projectId: "p1",
        requestId: "unique-create",
        objective: "Idempotent",
      },
      prepared = goals.prepareCreate(input);
    const first = goals.create(input, {
      expectedAuthority: prepared.authority,
    });
    expect(first.replayed).toBe(false);
    expect(goals.create(input)).toEqual({ goal: first.goal, replayed: true });
    expect(goals.prepareCreate(input).replayed).toBe(true);
    expect(() => goals.create({ ...input, objective: "Different" })).toThrow(
      "GOAL_REQUEST_CONFLICT",
    );
    const update = {
        id: first.goal.id,
        expectedRevision: 1,
        requestId: "update-key",
        patch: { title: "Edited" },
      },
      admission = goals.prepareRevise(update);
    expect(admission.previous).toEqual(first.goal);
    const written = goals.revise(update, {
      expectedAuthority: admission.authority,
    });
    expect(goals.revise(update)).toEqual({
      goal: written.goal,
      replayed: true,
    });
    expect(count("cc_organization_project_goals")).toBe(1);
    expect(count("cc_organization_project_goal_mutations")).toBe(2);
  });

  it.each([
    "authorizationRefs",
    "memoryRefs",
    "nextCheckAt",
    "triggerRefs",
    "acceptanceCriteria",
    "completion",
  ])("rejects unsupported goal capability %s", (field) => {
    const goal = create();
    expect(() => revise(goal, { [field]: [] })).toThrow("GOAL_INVALID_REQUEST");
    expect(() =>
      goals.prepareCreate({
        projectId: "p1",
        requestId: "unsupported",
        objective: "Goal",
        [field]: [],
      }),
    ).toThrow("GOAL_INVALID_REQUEST");
  });

  it("rejects stale native create/update authorizations and leaves all mutations atomic", async () => {
    const input = {
        projectId: "p1",
        requestId: "create-stale",
        objective: "Goal",
      },
      prepared = goals.prepareCreate(input);
    await attest();
    expect(() =>
      goals.create(input, { expectedAuthority: prepared.authority }),
    ).toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(count("cc_organization_project_goals")).toBe(0);
    const goal = create(),
      update = {
        id: goal.id,
        expectedRevision: 1,
        requestId: "u",
        patch: { title: "Denied" },
      },
      old = goals.prepareRevise(update);
    db.prepare(
      "UPDATE project_tasks SET description='changed' WHERE id='t1'",
    ).run();
    expect(() =>
      goals.revise(update, { expectedAuthority: old.authority }),
    ).toThrow("ORG_AUTH_VERSION_CONFLICT");
    expect(goals.get({ id: goal.id }).revision).toBe(1);
    db.exec(
      "CREATE TRIGGER fail_goal_receipt BEFORE INSERT ON cc_organization_project_goal_mutations BEGIN SELECT RAISE(ABORT,'FAIL'); END",
    );
    const fresh = goals.prepareRevise(update);
    expect(() =>
      goals.revise(update, { expectedAuthority: fresh.authority }),
    ).toThrow("GOAL_STORAGE_FAILED");
    expect(goals.get({ id: goal.id })).toEqual(goal);
  });

  it("runs actual manual scheduler checks without task.read and shares history through risk.read", async () => {
    const goal = create(),
      result = await engine.checkNow(checkInput(goal));
    expect(result).toMatchObject({
      status: "succeeded",
      replayed: false,
      result: { goalId: goal.id, status: "evaluated", riskTaskCount: 1 },
    });
    expect(store.getOccurrence(result.occurrenceId).status).toBe("succeeded");
    expect(
      store.getJob(store.getOccurrence(result.occurrenceId).jobId).authority,
    ).toMatchObject({
      principal: { type: "user", id: member },
      workspaceId: "org1",
    });
    actor = riskReader;
    expect(engine.history({ id: goal.id }).checks[0]).toMatchObject({
      occurrenceId: result.occurrenceId,
      actorDid: member,
      reviewId: result.result.reviewId,
      result: result.result,
    });
    expect(
      engine.getCheck({ id: goal.id, occurrenceId: result.occurrenceId }),
    ).toEqual(engine.history({ id: goal.id }).checks[0]);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
    actor = reader;
    expect(engine.status({ id: goal.id })).not.toHaveProperty("checks");
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
    expect(() =>
      engine.getCheck({ id: goal.id, occurrenceId: result.occurrenceId }),
    ).toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_project_goal_checks'",
        )
        .get(),
    ).toBeUndefined();
  });

  it("uses one shared goal budget across checking members", async () => {
    const goal = create({ budgetPolicy: { maxRuns: 2 } });
    expect((await engine.checkNow(checkInput(goal, "first"))).status).toBe(
      "succeeded",
    );
    actor = second;
    expect((await engine.checkNow(checkInput(goal, "second"))).status).toBe(
      "succeeded",
    );
    expect(engine.status({ id: goal.id }).usage).toMatchObject({
      checks: 2,
      totalRuns: 2,
      modelTokens: 0,
      modelCostUsd: 0,
    });
    await expect(engine.checkNow(checkInput(goal, "third"))).rejects.toThrow(
      "GOAL_USAGE_BUDGET_EXHAUSTED",
    );
    expect(count("cc_organization_project_risk_reviews")).toBe(2);
    expect(
      engine.history({ id: goal.id }).checks.map((check) => check.actorDid),
    ).toEqual([second, member]);
  });

  it("returns the same committed check after goal revision, pause, budget exhaustion and policy renewal", async () => {
    const goal = create({ budgetPolicy: { maxRuns: 1 } }),
      input = checkInput(goal),
      first = await engine.checkNow(input);
    revise(goal, { status: "paused", title: "Paused afterwards" });
    await attest();
    expect(await engine.checkNow(input)).toEqual({ ...first, replayed: true });
    expect(count("cc_organization_project_risk_reviews")).toBe(1);
    expect(
      store.db.prepare("SELECT count(*) AS n FROM occurrences").get().n,
    ).toBe(1);
    await expect(
      engine.checkNow({ ...input, expectedRevision: 2 }),
    ).rejects.toThrow("GOAL_MONITOR_REQUEST_VERSION_CONFLICT");
    await expect(
      engine.checkNow({ ...input, requestId: "new", expectedRevision: 2 }),
    ).rejects.toThrow("GOAL_MONITOR_NOT_ACTIVE");
  });

  it("requires all four explicit check permissions, and replays only through current read access", async () => {
    const goal = create(),
      result = await engine.checkNow(checkInput(goal));
    for (const missing of ["goal.check", "risk.read", "risk.evaluate"]) {
      permissions.find((grant) => grant.actorDid === member).permissions = [
        "goal.read",
        "goal.update",
        "goal.check",
        "risk.read",
        "risk.evaluate",
      ].filter((permission) => permission !== missing);
      await attest();
      await expect(
        engine.checkNow(checkInput(goal, `missing-${missing}`)),
      ).rejects.toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    }
    permissions.find((grant) => grant.actorDid === member).permissions = [
      "goal.read",
      "risk.read",
    ];
    await attest();
    expect((await engine.checkNow(checkInput(goal))).result).toEqual(
      result.result,
    );
    permissions.find((grant) => grant.actorDid === member).permissions = [
      "risk.read",
    ];
    await attest();
    await expect(engine.checkNow(checkInput(goal))).rejects.toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
  });

  it("pins the trusted session guard across async dispatch including same-DID reauthentication", async () => {
    const goal = create();
    let generation = 1;
    const pinned = generation;
    const request = engine.checkNow(checkInput(goal), {
      guard: () => {
        if (generation !== pinned)
          throw Object.assign(new Error("ORG_AUTH_IDENTITY_CHANGED"), {
            code: "ORG_AUTH_IDENTITY_CHANGED",
          });
        return actor;
      },
    });
    generation++;
    await expect(request).rejects.toThrow("ORG_AUTH_IDENTITY_CHANGED");
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
    expect(count("cc_organization_project_goal_manual_requests")).toBe(0);
  });

  it("rechecks scope and budget after risk evaluation and rolls back provisional evidence", async () => {
    const goal = create({ budgetPolicy: { maxTimeMs: 5 } });
    const evaluate = engine.risk.evaluateInTransaction.bind(engine.risk);
    vi.spyOn(engine.risk, "evaluateInTransaction").mockImplementation(
      (input) => {
        const result = evaluate(input);
        now += 10;
        return result;
      },
    );
    const result = await engine.checkNow(checkInput(goal));
    expect(result.status).not.toBe("succeeded");
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
    expect(count("cc_organization_project_goal_checks")).toBe(0);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(0);
  });

  it("denies source and policy ABA while an unexecuted manual occurrence is awaiting dispatch", async () => {
    const goal = create(),
      original = engine._job.bind(engine);
    vi.spyOn(engine, "_job").mockImplementation((request) => {
      const job = original(request);
      db.exec(
        "UPDATE project_tasks SET description='temporary' WHERE id='t1'; UPDATE project_tasks SET description='Original' WHERE id='t1'",
      );
      return job;
    });
    const result = await engine.checkNow(checkInput(goal));
    expect(result.status).not.toBe("succeeded");
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
    expect(count("cc_organization_project_goal_checks")).toBe(0);
  });

  it("persists shared checks and idempotent mutation receipts across a reopen without background work", async () => {
    const goal = create(),
      result = await engine.checkNow(checkInput(goal));
    await engine.close();
    store.close();
    db.close();
    open();
    expect(goals.get({ id: goal.id })).toEqual(goal);
    expect((await engine.checkNow(checkInput(goal))).replayed).toBe(true);
    actor = riskReader;
    expect(
      engine.getCheck({ id: goal.id, occurrenceId: result.occurrenceId })
        .result,
    ).toEqual(result.result);
    expect(engine.backgroundTimer).toBeNull();
    expect((await engine.tick()).checks).toEqual([]);
    expect(count("cc_organization_project_risk_reviews")).toBe(1);
  });

  it("does not create domain schema during first engine construction after service preparation", async () => {
    await engine.close();
    const service = new OrganizationProjectGoalService({
      db,
      getActor: () => actor,
      authority,
      clock: () => now,
    });
    const input = {
        projectId: "p1",
        requestId: "schema",
        objective: "No hidden DDL",
      },
      prepared = service.prepareCreate(input),
      schema = db.pragma("schema_version", { simple: true });
    engine = new OrganizationProjectGoalMonitoringEngine({
      db,
      store,
      getActor: () => actor,
      authority,
      clock: () => now,
    });
    expect(db.pragma("schema_version", { simple: true })).toBe(schema);
    expect(
      service.create(input, { expectedAuthority: prepared.authority }).replayed,
    ).toBe(false);
  });

  it("paginates shared goals and checks without crossing a goal cursor", async () => {
    const first = create(),
      secondGoal = create({ requestId: "second-goal" });
    const page = goals.list({ projectId: "p1", limit: 1 }),
      next = goals.list({
        projectId: "p1",
        limit: 1,
        afterId: page.nextCursor,
      });
    expect(
      new Set([...page.goals, ...next.goals].map((goal) => goal.id)),
    ).toEqual(new Set([first.id, secondGoal.id]));
    expect(next.nextCursor).toBeNull();
    expect(() => goals.list({ projectId: "p1", afterId: "missing" })).toThrow(
      "GOAL_INVALID_CURSOR",
    );
    const a = await engine.checkNow(checkInput(first, "a")),
      b = await engine.checkNow(checkInput(first, "b")),
      other = await engine.checkNow(checkInput(secondGoal, "other"));
    actor = riskReader;
    const history = engine.history({ id: first.id, limit: 1 });
    expect(history.checks.map((row) => row.occurrenceId)).toEqual([
      b.occurrenceId,
    ]);
    expect(
      engine
        .history({ id: first.id, beforeId: history.nextCursor, limit: 1 })
        .checks.map((row) => row.occurrenceId),
    ).toEqual([a.occurrenceId]);
    expect(() =>
      engine.history({ id: first.id, beforeId: other.occurrenceId }),
    ).toThrow("GOAL_INVALID_CURSOR");
    expect(() =>
      engine.getCheck({ id: first.id, occurrenceId: other.occurrenceId }),
    ).toThrow("GOAL_NOT_FOUND_OR_DENIED");
  });

  it("detects valid-JSON goal tampering and rejects oversized goal input before writes", () => {
    const goal = create();
    expect(() =>
      create({ requestId: "large", title: "界".repeat(342) }),
    ).toThrow("GOAL_INVALID_TEXT");
    expect(() =>
      create({
        requestId: "large-objective",
        objective: "x".repeat(8193),
        title: "Short",
      }),
    ).toThrow("GOAL_INVALID_TEXT");
    db.prepare(
      "UPDATE cc_organization_project_goals SET goal_json=? WHERE id=?",
    ).run(
      JSON.stringify({ ...goal, objective: "Tampered outside CAS" }),
      goal.id,
    );
    expect(() => goals.get({ id: goal.id })).toThrow("GOAL_RECORD_CORRUPT");
    expect(() => goals.list({ projectId: "p1" })).toThrow(
      "GOAL_RECORD_CORRUPT",
    );
  });

  it.each(["record", "risk", "missing-request"])(
    "fails closed on corrupt %s check evidence",
    async (kind) => {
      const goal = create(),
        result = await engine.checkNow(checkInput(goal));
      if (kind === "record") {
        db.exec(
          "DROP TRIGGER cc_organization_project_goal_checks_update_immutable",
        );
        db.prepare(
          "UPDATE cc_organization_project_goal_checks SET record_json='{}' WHERE occurrence_id=?",
        ).run(result.occurrenceId);
      } else if (kind === "risk") {
        db.exec(
          "DROP TRIGGER cc_organization_project_risk_reviews_update_immutable",
        );
        db.prepare(
          "UPDATE cc_organization_project_risk_reviews SET evaluation_json='{}' WHERE id=?",
        ).run(result.result.reviewId);
      } else {
        db.exec(
          "DROP TRIGGER cc_organization_project_goal_manual_requests_delete_immutable",
        );
        db.prepare(
          "DELETE FROM cc_organization_project_goal_manual_requests",
        ).run();
      }
      expect(() => engine.history({ id: goal.id })).toThrow(
        /GOAL_MONITOR_(RECORD|CHECK)_CORRUPT|PROJECT_RISK_REVIEW_CORRUPT/,
      );
    },
  );

  it("rejects revised goal bindings at dispatch and retains no review or budget charge", async () => {
    const goal = create(),
      original = engine._job.bind(engine);
    vi.spyOn(engine, "_job").mockImplementation((request) => {
      const job = original(request);
      revise(goal, { title: "Changed before dispatch" });
      return job;
    });
    expect((await engine.checkNow(checkInput(goal))).status).not.toBe(
      "succeeded",
    );
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(0);
  });

  it("rejects new checks for expired and abandoned goals without pretending they completed", async () => {
    const goal = create({ expiresAt: new Date(now + 10).toISOString() });
    now += 10;
    await expect(engine.checkNow(checkInput(goal))).rejects.toThrow(
      "GOAL_MONITOR_EXPIRED",
    );
    const next = revise(goal, { status: "abandoned" });
    await expect(
      engine.checkNow(checkInput(next, "after-abandon")),
    ).rejects.toThrow("GOAL_MONITOR_NOT_ACTIVE");
    expect(() => revise(next, { status: "done" }, "fake-complete")).toThrow(
      "GOAL_INVALID_REQUEST",
    );
    expect(engine.status({ id: goal.id }).goal.progress).toBe(0);
    expect(
      store.db.prepare("SELECT count(*) AS n FROM occurrences").get().n,
    ).toBe(0);
  });

  it("rolls back risk evidence if the durable check write fails", async () => {
    db.exec(
      "CREATE TRIGGER fail_org_goal_check BEFORE INSERT ON cc_organization_project_goal_checks BEGIN SELECT RAISE(ABORT,'NO CHECK'); END",
    );
    const goal = create(),
      result = await engine.checkNow(checkInput(goal));
    expect(result.status).not.toBe("succeeded");
    expect(count("cc_organization_project_risk_reviews")).toBe(0);
    expect(count("cc_organization_project_goal_checks")).toBe(0);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(0);
  });

  it("returns committed domain evidence after scheduler settlement fails without double evaluation", async () => {
    const goal = create();
    const original = store.settle.bind(store);
    vi.spyOn(store, "settle").mockImplementation(() => {
      throw Object.assign(new Error("scheduler outcome lost"), {
        code: "SCHEDULER_STORAGE_FAILED",
      });
    });
    const first = await engine
      .checkNow(checkInput(goal))
      .catch((error) => error);
    expect(count("cc_organization_project_goal_checks")).toBe(1);
    store.settle.mockImplementation(original);
    const recovered = await engine.checkNow(checkInput(goal));
    expect(recovered.status).toBe("succeeded");
    expect(recovered.replayed).toBe(true);
    expect(count("cc_organization_project_risk_reviews")).toBe(1);
    expect(engine.status({ id: goal.id }).usage.totalRuns).toBe(1);
    expect(first).toBeDefined();
  });

  it("keeps the goal shared after its creator leaves the organization", async () => {
    const goal = create();
    db.prepare(
      "UPDATE organization_members SET status='removed' WHERE member_did=?",
    ).run(member);
    permissions = permissions.filter((grant) => grant.actorDid !== member);
    await attest();
    actor = updater;
    expect(goals.get({ id: goal.id }).ownerRef).toBe(member);
    expect(
      revise(goal, { title: "Maintained by another member" }).ownerRef,
    ).toBe(member);
    actor = member;
    expect(() => goals.get({ id: goal.id })).toThrow(
      "ORG_AUTH_NOT_FOUND_OR_DENIED",
    );
  });
});
