import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");
const {
  ContextMemoryKernel,
  NativeSqliteMemoryPort,
} = require("@chainlesschain/context-memory-kernel");
const {
  registerOrganizationProjectIPC,
  CHANNELS,
} = require("../organization-project-ipc");

describe("organization goal memory trusted native IPC boundaries", () => {
  let f,
    dialog,
    goal,
    database,
    permissions,
    workflowIds,
    send,
    faultStage,
    faultHits;
  const content = "Explicit team memory: confidential delivery context";
  const input = (extra = {}) => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId: "create-memory",
    content,
    category: "user-fact",
    ...extra,
  });
  const listing = () => f.host.listGoalMemories(f.event, { goalId: goal.id });
  const operations = () =>
    f.host.listGoalMemoryOperations(f.event, { goalId: goal.id });
  const target = (item, requestId) => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId,
    memoryId: item.memoryId,
    memoryVersion: item.currentVersion,
  });
  async function create(extra) {
    const result = await f.host.createGoalMemory(f.event, input(extra));
    if (result.goal) goal = result.goal;
    return result;
  }
  async function attest() {
    f.setActor(f.identities.owner);
    const policy = { orgId: "org1", permissions, workflowIds };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
  }
  function afterKernelProposal(change) {
    const propose = ContextMemoryKernel.prototype.proposeMemory;
    const reached = vi.fn(change);
    vi.spyOn(ContextMemoryKernel.prototype, "proposeMemory").mockImplementation(
      async function (request) {
        const result = await propose.call(this, request);
        await reached();
        return result;
      },
    );
    return reached;
  }
  function uncertainKernelWrite(message) {
    let committed = false;
    const read = NativeSqliteMemoryPort.prototype.read;
    const original = ContextMemoryKernel.prototype.proposeMemory;
    const reading = vi
      .spyOn(NativeSqliteMemoryPort.prototype, "read")
      .mockImplementation(function (memoryId) {
        if (committed) throw new Error(message);
        return read.call(this, memoryId);
      });
    const proposing = vi
      .spyOn(ContextMemoryKernel.prototype, "proposeMemory")
      .mockImplementation(async function (value) {
        await original.call(this, value);
        committed = true;
        throw new Error(message);
      });
    return () => {
      reading.mockRestore();
      proposing.mockRestore();
    };
  }
  beforeEach(async () => {
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog, {
      database: { getDatabase: () => database },
      goalMonitoringController: { initialize: vi.fn(), close: async () => {} },
    });
    database = f.db;
    send = vi.fn();
    f.parent.webContents = { isDestroyed: () => false, send };
    f.electron.BrowserWindow.getAllWindows = () => [f.parent];
    ({ permissions, workflowIds } = await f.setup());
    faultStage = null;
    faultHits = 0;
    f.db.function("test_memory_write_fault", (stage) => {
      if (faultStage === stage) {
        faultHits++;
        throw new Error(`memory ${stage} write failed`);
      }
      return 1;
    });
    // Install before any memory admission captures a native schema revision.
    f.db.exec(
      "CREATE TRIGGER test_memory_refs_fault AFTER UPDATE OF goal_json ON cc_organization_project_goals WHEN json_extract(NEW.goal_json,'$.memoryRefs')<>json_extract(OLD.goal_json,'$.memoryRefs') BEGIN SELECT test_memory_write_fault('goal'); END;",
    );
    f.db.exec(
      "CREATE TRIGGER test_memory_receipt_fault AFTER UPDATE ON cc_organization_project_goal_memory_operations WHEN json_extract(NEW.record_json,'$.status')='complete' BEGIN SELECT test_memory_write_fault('receipt'); END;",
    );
    for (const grant of permissions)
      grant.permissions.push(
        "goal.read",
        "goal.create",
        "goal.update",
        "goal.memory.read",
        "goal.memory.write",
        "goal.memory.delete",
      );
    await attest();
    ({ goal } = await f.host.createGoal(f.event, {
      projectId: "p1",
      requestId: "goal",
      objective: "Share explicit team context",
    }));
    dialog.mockClear();
    send.mockClear();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await f?.host.close();
    f?.db.close();
  });
  it("registers exactly eight fixed goal memory methods", () => {
    f.electron.ipcMain.handle = vi.fn();
    const registeredHost = registerOrganizationProjectIPC(
      { getDatabase: () => f.db },
      {
        electron: f.electron,
        getCurrentUserDid: f.getActor,
        getAuthenticationGeneration: () => 1,
        validateSender: () => ({ trusted: true }),
        goalMonitoringController: {
          initialize: vi.fn(),
          close: async () => {},
        },
      },
    );
    const memoryChannels = f.electron.ipcMain.handle.mock.calls
      .map(([channel]) => channel)
      .filter((channel) =>
        channel.startsWith("organization-project:goal-memory-"),
      );
    const mapping = {
      listGoalMemories: "organization-project:goal-memory-list",
      createGoalMemory: "organization-project:goal-memory-create",
      correctGoalMemory: "organization-project:goal-memory-correct",
      revokeGoalMemory: "organization-project:goal-memory-revoke",
      deleteGoalMemory: "organization-project:goal-memory-delete",
      listGoalMemoryOperations: "organization-project:goal-memory-operations",
      recoverGoalMemory: "organization-project:goal-memory-recover",
      discardGoalMemory: "organization-project:goal-memory-discard",
    };
    expect(memoryChannels.sort()).toEqual(Object.values(mapping).sort());
    for (const [method, channel] of Object.entries(mapping)) {
      expect(CHANNELS[method]).toBe(channel);
      expect(typeof registeredHost[method]).toBe("function");
    }
  });
  it("requires default-cancel native confirmation and stores only references in the goal", async () => {
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(await create()).toMatchObject({
      cancelled: true,
      operation: "create",
    });
    expect((await listing()).items).toEqual([]);
    await create();
    expect(dialog.mock.calls[1][0]).toBe(f.parent);
    expect(dialog.mock.calls[1][1]).toMatchObject({
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    expect(dialog.mock.calls[1][1].detail).toContain(content);
    expect((await listing()).items[0].record.content).toBe(content);
    expect(
      JSON.stringify(f.host.getGoal(f.event, { id: goal.id })),
    ).not.toContain(content);
    expect(JSON.stringify(await operations())).not.toContain(content);
    expect(
      JSON.stringify(
        f.db
          .prepare(
            "SELECT record_json FROM cc_organization_project_goal_memory_operations",
          )
          .all(),
      ),
    ).not.toContain(content);
    expect(
      JSON.stringify(
        f.db
          .prepare("SELECT event_json FROM context_memory_sqlite_events")
          .all(),
      ),
    ).not.toContain(content);
  });
  it("shares current memory across authorized members while retaining creator attribution", async () => {
    const saved = await create();
    expect(saved.operation.actorDid).toBe(f.identities.requester);
    f.setActor(f.identities.first);
    const original = (await listing()).items[0];
    expect(original.record.content).toBe(content);
    const corrected = await f.host.correctGoalMemory(f.event, {
      ...target(original, "correct-shared"),
      content: "A member corrected the shared fact",
      category: "user-fact",
    });
    goal = corrected.goal;
    expect(corrected.operation.actorDid).toBe(f.identities.first);
    f.setActor(f.identities.second);
    const current = await listing();
    expect(current.items.find((item) => !item.unavailable).record.content).toBe(
      "A member corrected the shared fact",
    );
    expect(
      current.items.find((item) => item.memoryId === original.memoryId).record,
    ).toBeNull();
    expect(JSON.stringify(await operations())).not.toContain(
      "A member corrected the shared fact",
    );
    expect((await operations()).items).toEqual([]);
  });
  it("revokes before output and broadcasts only a body-free invalidation before purge", async () => {
    await create();
    const original = (await listing()).items[0];
    send.mockClear();
    const revoked = await f.host.revokeGoalMemory(
      f.event,
      target(original, "revoke"),
    );
    goal = revoked.goal;
    const hidden = (await listing()).items[0];
    expect(hidden.record).toBeNull();
    expect(send).toHaveBeenCalled();
    for (const [channel, payload] of send.mock.calls) {
      expect(channel).toBe("organization-project:goal-memory-invalidated");
      expect(JSON.stringify(payload)).not.toContain(content);
    }
    const deleted = await f.host.deleteGoalMemory(
      f.event,
      target(hidden, "delete"),
    );
    goal = deleted.goal;
    expect(deleted.operation.result.receipt.status).toBe("purged");
    expect((await listing()).items[0]).toMatchObject({
      record: null,
      state: "purged",
    });
  });
  it.each([
    "actorDid",
    "scope",
    "allowedSinks",
    "activate",
    "approved",
    "expectedAuthority",
  ])(
    "rejects injected renderer field %s before opening native confirmation",
    async (key) => {
      await expect(create({ [key]: "forged" })).rejects.toThrow();
      expect(dialog).not.toHaveBeenCalled();
      expect((await listing()).items).toEqual([]);
    },
  );
  it.each([
    "identity",
    "database",
    "frame",
    "navigation",
    "window",
    "membership",
    "expiry",
  ])("rejects %s changes while native confirmation is open", async (change) => {
    dialog.mockImplementationOnce(async () => {
      if (change === "identity") f.setActor(f.identities.requester);
      if (change === "database") database = {};
      if (change === "frame") {
        f.event.senderFrame = { ...f.event.senderFrame };
        f.event.sender.mainFrame = f.event.senderFrame;
      }
      if (change === "navigation")
        f.event.sender.emit(
          "did-start-navigation",
          {},
          "http://localhost:5173/other",
          false,
          true,
        );
      if (change === "window") f.parent.isDestroyed = () => true;
      if (change === "membership")
        f.db
          .prepare(
            "UPDATE organization_members SET status='removed' WHERE member_did=?",
          )
          .run(f.identities.requester);
      if (change === "expiry") f.setNow(100000001);
      return { response: 1 };
    });
    await expect(create()).rejects.toThrow();
    expect(dialog).toHaveBeenCalledTimes(1);
  });
  it.each(["identity", "navigation", "database", "membership"])(
    "rechecks %s after awaited Kernel work and suppresses late output",
    async (change) => {
      const reached = afterKernelProposal(() => {
        if (change === "identity") f.setActor(f.identities.requester);
        if (change === "navigation")
          f.event.sender.emit(
            "did-start-navigation",
            {},
            "http://localhost:5173/other",
            false,
            true,
          );
        if (change === "database") database = {};
        if (change === "membership")
          f.db
            .prepare(
              "UPDATE organization_members SET status='removed' WHERE member_did=?",
            )
            .run(f.identities.requester);
      });
      await expect(create()).rejects.toThrow();
      expect(reached).toHaveBeenCalledTimes(1);
      expect(
        f.db
          .prepare(
            "SELECT count(*) AS n FROM cc_organization_project_goal_memory_links",
          )
          .get().n,
      ).toBe(0);
    },
  );
  it("recovers an uncertain Kernel commit using the original nonce without duplicate memory", async () => {
    const restore = uncertainKernelWrite("commit reply lost");
    await expect(create()).rejects.toThrow("commit reply lost");
    restore();
    const before = f.db
      .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
      .get().n;
    const recovered = await f.host.recoverGoalMemory(f.event, {
      goalId: goal.id,
      requestId: "create-memory",
    });
    goal = recovered.goal;
    expect(
      (await listing()).items.filter(
        (item) => item.record?.content === content,
      ),
    ).toHaveLength(1);
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(before);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await operations())).not.toContain(content);
  });
  it("requires explicit read authority even from the memory creator", async () => {
    await create();
    permissions.find(
      (grant) => grant.actorDid === f.identities.requester,
    ).permissions = ["goal.read"];
    await attest();
    dialog.mockClear();
    await expect(Promise.resolve().then(listing)).rejects.toThrow();
    await expect(create({ requestId: "not-authorized" })).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
    f.setActor(f.identities.first);
    expect((await listing()).items[0].record.content).toBe(content);
  });
  it("does not accept another goal's memory identifier or expose its content", async () => {
    await create();
    const item = (await listing()).items[0];
    const { goal: other } = await f.host.createGoal(f.event, {
      projectId: "p1",
      requestId: "other-goal",
      objective: "Separate goal context",
    });
    dialog.mockClear();
    expect(
      (await f.host.listGoalMemories(f.event, { goalId: other.id })).items,
    ).toEqual([]);
    await expect(
      f.host.correctGoalMemory(f.event, {
        ...target(item, "wrong-goal"),
        goalId: other.id,
        expectedRevision: other.revision,
        content: "Cross-goal injection",
        category: "user-fact",
      }),
    ).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
    expect((await listing()).items[0].record.content).toBe(content);
  });
  it.each(["correct", "revoke", "delete"])(
    "preserves current content when native %s confirmation is cancelled",
    async (operation) => {
      await create();
      const item = (await listing()).items[0];
      dialog.mockResolvedValueOnce({ response: 0 });
      const params = {
        ...target(item, `cancel-${operation}`),
        ...(operation === "correct"
          ? { content: "Cancelled correction", category: "user-fact" }
          : {}),
      };
      const method = {
        correct: "correctGoalMemory",
        revoke: "revokeGoalMemory",
        delete: "deleteGoalMemory",
      }[operation];
      expect(await f.host[method](f.event, params)).toMatchObject({
        cancelled: true,
        operation,
      });
      expect((await listing()).items[0].record.content).toBe(content);
    },
  );
  it("confirms discard of an uncertain original write without keeping candidate output", async () => {
    const restore = uncertainKernelWrite("uncertain candidate");
    await expect(create()).rejects.toThrow("uncertain candidate");
    restore();
    const params = {
      goalId: goal.id,
      expectedRevision: goal.revision,
      operationRequestId: "create-memory",
      requestId: "discard-original",
    };
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(await f.host.discardGoalMemory(f.event, params)).toMatchObject({
      cancelled: true,
    });
    const discarded = await f.host.discardGoalMemory(f.event, params);
    expect(discarded.operation.status).toBe("discarded");
    expect((await listing()).items.every((item) => item.record === null)).toBe(
      true,
    );
    expect(JSON.stringify(await operations())).not.toContain(content);
  });
  it("rejects membership revocation and restoration during awaited Kernel work", async () => {
    const reached = afterKernelProposal(() => {
      f.db
        .prepare(
          "UPDATE organization_members SET status='removed' WHERE member_did=?",
        )
        .run(f.identities.requester);
      f.db
        .prepare(
          "UPDATE organization_members SET status='active' WHERE member_did=?",
        )
        .run(f.identities.requester);
    });
    await expect(create()).rejects.toThrow();
    expect(reached).toHaveBeenCalledTimes(1);
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_goal_memory_links",
        )
        .get().n,
    ).toBe(0);
  });
  it("does not emit late candidate output after a concurrent native revoke changes the goal", async () => {
    await create();
    const before = (await listing()).items[0];
    afterKernelProposal(async () => {
      const revoked = await f.host.revokeGoalMemory(
        f.event,
        target(before, "revoke-during-create"),
      );
      goal = revoked.goal;
    });
    await expect(
      create({
        requestId: "late-create",
        content: "Late candidate must remain hidden",
      }),
    ).rejects.toThrow();
    const current = await listing();
    expect(
      current.items.find((item) => item.memoryId === before.memoryId).record,
    ).toBeNull();
    expect(JSON.stringify(current)).not.toContain(
      "Late candidate must remain hidden",
    );
  });
  it("replays the original create request without a second native confirmation", async () => {
    const request = input();
    const saved = await f.host.createGoalMemory(f.event, request);
    goal = saved.goal;
    const replay = await f.host.createGoalMemory(f.event, request);
    expect(replay.replayed).toBe(true);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect((await listing()).items).toHaveLength(1);
  });
  it("recovers the original deletion with delete permission and no memory read or write grant", async () => {
    await create();
    const item = (await listing()).items[0];
    permissions.find(
      (grant) => grant.actorDid === f.identities.requester,
    ).permissions = ["goal.read", "goal.memory.delete"];
    await attest();
    dialog.mockClear();
    const original = ContextMemoryKernel.prototype.deleteMemory;
    const spy = vi
      .spyOn(ContextMemoryKernel.prototype, "deleteMemory")
      .mockImplementation(async function (request) {
        await original.call(this, request);
        throw new Error("delete response lost");
      });
    await expect(
      f.host.deleteGoalMemory(f.event, target(item, "delete-uncertain")),
    ).rejects.toThrow("delete response lost");
    spy.mockRestore();
    const recovered = await f.host.recoverGoalMemory(f.event, {
      goalId: goal.id,
      requestId: "delete-uncertain",
    });
    expect(recovered.operation.result.receipt.status).toBe("purged");
    expect(dialog).toHaveBeenCalledTimes(1);
    await expect(Promise.resolve().then(operations)).rejects.toThrow();
  });
  it.each([
    ["create", "goal"],
    ["create", "receipt"],
    ["correct", "goal"],
    ["correct", "receipt"],
  ])(
    "rolls back the complete %s association transaction after a real %s write failure",
    async (operation, stage) => {
      if (operation === "correct") await create();
      const original = (await listing()).items[0];
      const refs = f.host.getGoal(f.event, { id: goal.id });
      const links = f.db
        .prepare(
          "SELECT * FROM cc_organization_project_goal_memory_links ORDER BY memory_id",
        )
        .all();
      const epochs = f.db
        .prepare("SELECT * FROM cc_organization_project_goal_memory_authority")
        .all();
      const kernelCount = f.db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n;
      dialog.mockClear();
      faultStage = stage;
      const body = "Durable candidate awaiting native association";
      const params =
        operation === "create"
          ? input({ requestId: "faulted-write", content: body })
          : {
              ...target(original, "faulted-write"),
              content: body,
              category: "user-fact",
            };
      await expect(
        f.host[
          operation === "create" ? "createGoalMemory" : "correctGoalMemory"
        ](f.event, params),
      ).rejects.toThrow();
      expect(faultHits).toBe(1);
      expect(f.host.getGoal(f.event, { id: goal.id })).toEqual(refs);
      expect(
        f.db
          .prepare(
            "SELECT * FROM cc_organization_project_goal_memory_links ORDER BY memory_id",
          )
          .all(),
      ).toEqual(links);
      expect(
        f.db
          .prepare(
            "SELECT * FROM cc_organization_project_goal_memory_authority",
          )
          .all(),
      ).toEqual(epochs);
      const pending = (await operations()).items.find(
        (item) => item.requestId === "faulted-write",
      );
      expect(pending).toMatchObject({ status: "prepared", result: null });
      expect(JSON.stringify(await listing())).not.toContain(body);
      expect(
        f.db
          .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
          .get().n,
      ).toBe(kernelCount + 1);
      faultStage = null;
      const recovered = await f.host.recoverGoalMemory(f.event, {
        goalId: goal.id,
        requestId: "faulted-write",
      });
      goal = recovered.goal;
      expect(recovered.operation.status).toBe("complete");
      expect(
        (await listing()).items.filter((item) => item.record?.content === body),
      ).toHaveLength(1);
      expect(
        f.db
          .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
          .get().n,
      ).toBe(kernelCount + 1);
      expect(dialog).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["revoke", "delete"])(
    "rolls back %s admission including denied grant and journal when memory-ref CAS fails",
    async (operation) => {
      await create();
      const item = (await listing()).items[0];
      const before = await listing();
      const beforeOps = await operations();
      const epochs = f.db
        .prepare("SELECT * FROM cc_organization_project_goal_memory_authority")
        .all();
      const deleting = vi.spyOn(ContextMemoryKernel.prototype, "deleteMemory");
      faultStage = "goal";
      dialog.mockClear();
      const params = target(item, "failed-denial");
      await expect(
        f.host[
          operation === "revoke" ? "revokeGoalMemory" : "deleteGoalMemory"
        ](f.event, params),
      ).rejects.toThrow();
      expect(faultHits).toBe(1);
      expect(await listing()).toEqual(before);
      expect(await operations()).toEqual(beforeOps);
      expect(
        f.db
          .prepare(
            "SELECT * FROM cc_organization_project_goal_memory_authority",
          )
          .all(),
      ).toEqual(epochs);
      expect(deleting).not.toHaveBeenCalled();
      faultStage = null;
    },
  );
  it.each(["revoke", "delete"])(
    "keeps the %s grant denied when its final receipt write fails and recovers the same operation",
    async (operation) => {
      await create();
      const item = (await listing()).items[0];
      const params = target(item, "failed-receipt");
      dialog.mockClear();
      faultStage = "receipt";
      await expect(
        f.host[
          operation === "revoke" ? "revokeGoalMemory" : "deleteGoalMemory"
        ](f.event, params),
      ).rejects.toThrow();
      expect(faultHits).toBe(1);
      expect((await listing()).items[0].record).toBeNull();
      expect(
        (await operations()).items.find(
          (item) => item.requestId === "failed-receipt",
        ),
      ).toMatchObject({ status: "denied", result: null });
      if (operation === "delete") {
        const stored = JSON.parse(
          f.db
            .prepare(
              "SELECT record_json FROM context_memory_sqlite_records WHERE memory_id=?",
            )
            .get(item.memoryId).record_json,
        );
        expect(stored.state).toBe("purged");
      }
      faultStage = null;
      const recovered = await f.host.recoverGoalMemory(f.event, {
        goalId: goal.id,
        requestId: "failed-receipt",
      });
      expect(recovered.operation.status).toBe("complete");
      if (operation === "delete")
        expect(recovered.operation.result.receipt.status).toBe("purged");
      expect((await listing()).items[0].record).toBeNull();
      expect(dialog).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps recovery tied to its admitting actor and rechecks newly attested permissions", async () => {
    const restore = uncertainKernelWrite("readback unavailable");
    await expect(create()).rejects.toThrow("readback unavailable");
    restore();
    const recover = () =>
      f.host.recoverGoalMemory(f.event, {
        goalId: goal.id,
        requestId: "create-memory",
      });
    f.setActor(f.identities.first);
    await expect(recover()).rejects.toThrow();
    expect((await operations()).items).toEqual([]);
    permissions.find(
      (grant) => grant.actorDid === f.identities.requester,
    ).permissions = ["goal.read", "goal.memory.read"];
    await attest();
    dialog.mockClear();
    await expect(recover()).rejects.toThrow();
    expect((await listing()).items).toEqual([]);
    expect(dialog).not.toHaveBeenCalled();
    permissions
      .find((grant) => grant.actorDid === f.identities.requester)
      .permissions.push("goal.memory.write");
    await attest();
    dialog.mockClear();
    const result = await recover();
    goal = result.goal;
    expect(result.operation.actorDid).toBe(f.identities.requester);
    expect(
      (await listing()).items.filter(
        (item) => item.record?.content === content,
      ),
    ).toHaveLength(1);
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM context_memory_sqlite_records")
        .get().n,
    ).toBe(1);
    expect(dialog).not.toHaveBeenCalled();
  });
});
