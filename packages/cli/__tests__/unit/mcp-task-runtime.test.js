import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Command } from "commander";

const root = mkdtempSync(join(tmpdir(), "cc-mcp-task-runtime-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getSessionStoreDir: () => join(root, "home", "sessions"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const { startSession, readEvents, appendCompactEvent } =
  await import("../../src/harness/jsonl-session-store.js");
const { acquireSessionHostLease, revokeSessionHostAuthority } =
  await import("../../src/lib/session-host-lease.js");
const { createDurableMcpTaskRuntime, listDurableMcpTasks } =
  await import("../../src/lib/mcp-task-runtime.js");
const { readMcpTaskJournal, appendMcpTaskJournalEvent } =
  await import("../../src/lib/mcp-task-journal.js");
const { loadMcpLedgerRecovery } =
  await import("../../src/lib/mcp-call-ledger-store.js");
const { createRecoveryGuardedMcpCallLedger } =
  await import("../../src/lib/mcp-ledger-recovery-admission.js");
const { createSecretStore } = await import("../../src/lib/secret-store.js");
const { MCPClient } = await import("../../src/harness/mcp-client.js");
const { registerMcpTaskCommands } =
  await import("../../src/commands/mcp-tasks.js");

const cleanup = [];
afterEach(async () => {
  process.exitCode = 0;
  for (const close of cleanup.splice(0).reverse()) await close();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function fixture() {
  const requests = [];
  let status = "working";
  let createFailure = null;
  let cancelFailure = false;
  let missing = false;
  let blockPolls = false;
  const task = () => ({
    taskId: "remote:opaque/task",
    status,
    createdAt: "2026-11-08T00:00:00Z",
    lastUpdatedAt: "2026-11-08T00:00:01Z",
    ttl: null,
    pollInterval: 5000,
  });
  const result = () => ({
    content: [{ type: "text", text: "delivered artifact" }],
    _meta: {
      "io.modelcontextprotocol/related-task": { taskId: task().taskId },
    },
  });
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(204).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(message);
    if (message.method === "tasks/get" && blockPolls) return;
    if (message.id == null) {
      res.writeHead(202).end();
      return;
    }
    let output;
    if (message.method === "initialize") {
      output = {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "durable", version: "1" },
        capabilities: {
          tools: {},
          tasks: {
            requests: { tools: { call: {} } },
            cancel: {},
            list: {},
          },
        },
      };
    } else if (message.method === "tools/list") {
      output = {
        tools: [
          {
            name: "export",
            inputSchema: { type: "object" },
            execution: { taskSupport: "optional" },
          },
        ],
      };
    } else if (message.method === "tools/call") {
      if (createFailure === "disconnect") {
        req.socket.destroy();
        return;
      }
      if (createFailure === "404") {
        res.writeHead(404).end();
        return;
      }
      output = { task: task() };
    } else if (message.method === "tasks/cancel") {
      if (cancelFailure) {
        req.socket.destroy();
        return;
      }
      status = "cancelled";
      output = task();
    } else if (missing) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32602, message: "Task expired or unavailable" },
        }),
      );
      return;
    } else if (message.method === "tasks/result") {
      status = "completed";
      output = result();
    } else if (message.method === "tasks/get") output = task();
    else output = { tasks: [task()] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: output }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const sessionId = "durable-" + randomUUID();
  startSession(sessionId, { model: "fixture", provider: "fixture" });
  const secrets = createSecretStore({ backend: "memory" });
  const connect = async (authorization = "initial-secret") => {
    const client = new MCPClient();
    cleanup.push(() => client.disconnectAll());
    await client.connect("remote", {
      transport: "http",
      url: "http://127.0.0.1:" + server.address().port + "/rpc",
      headers: { Authorization: authorization },
    });
    return client;
  };
  const open = async (authorization, suppliedLease) => {
    const client = await connect(authorization);
    const lease =
      suppliedLease ||
      acquireSessionHostLease(sessionId, { hostKind: "mcp-tasks" });
    cleanup.push(() => lease.release());
    return {
      client,
      lease,
      runtime: createDurableMcpTaskRuntime({
        client,
        sessionId,
        lease,
        secretStore: secrets,
      }),
    };
  };
  return {
    requests,
    sessionId,
    secrets,
    open,
    connect,
    task,
    result,
    calls: (method) => requests.filter((item) => item.method === method),
    blockPolls: (value) => {
      blockPolls = value;
    },
    createFails: (value) => {
      createFailure = value;
    },
    cancelFails: (value) => {
      cancelFailure = value;
    },
    unavailable: () => {
      missing = true;
    },
    complete: () => {
      status = "completed";
    },
    async closeHost(host) {
      await host.client.disconnectAll();
      host.lease.release();
    },
  };
}

describe("durable MCP task auxiliary runtime", () => {
  it("recovers acceptance on a new client and saves one final result across compaction", async () => {
    const f = await fixture();
    const first = await f.open();
    const accepted = await first.runtime.create("remote", "export", {
      secret: "private-tool-input",
    });
    expect(accepted).toMatchObject({
      phase: "accepted",
      callStatus: "started",
      resultSaved: false,
    });
    expect(loadMcpLedgerRecovery(f.sessionId).unsettled).toHaveLength(1);
    await f.closeHost(first);
    appendCompactEvent(f.sessionId, {
      messages: [{ role: "assistant", content: "summary" }],
    });
    const resumed = await f.open();
    expect(await resumed.runtime.poll(accepted.localId)).toMatchObject({
      remoteStatus: "working",
    });
    const delivered = await resumed.runtime.result(accepted.localId);
    expect(delivered).toMatchObject({
      cached: false,
      callStatus: "completed",
      resultSaved: true,
    });
    expect(await resumed.runtime.result(accepted.localId)).toMatchObject({
      cached: true,
      result: delivered.result,
    });
    expect(f.calls("tools/call")).toHaveLength(1);
    expect(f.calls("tasks/result")).toHaveLength(1);
    expect(
      readEvents(f.sessionId).filter(
        (event) =>
          event.type === "mcp_task_ledger" &&
          event.data.phase === "result_saved",
      ),
    ).toHaveLength(1);
    expect(loadMcpLedgerRecovery(f.sessionId).unsettled).toHaveLength(0);
    expect(JSON.stringify(readEvents(f.sessionId))).not.toContain(
      "private-tool-input",
    );
    expect(JSON.stringify(readEvents(f.sessionId))).not.toContain(
      "initial-secret",
    );
    expect(JSON.stringify(listDurableMcpTasks(f.sessionId))).not.toContain(
      "delivered artifact",
    );
  });

  it("watches a remote task and delivers its verified result exactly once", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export", {});
    const updates = [];
    const deliveries = [];
    setTimeout(() => f.complete(), 5);
    const receipt = await host.runtime.watch(accepted.localId, {
      intervalMs: 10,
      timeoutMs: 500,
      onUpdate: (value) => updates.push(value.remoteStatus),
      onDelivery: (value, delivery) =>
        deliveries.push({
          id: value.deliveryId,
          sessionId: delivery.sessionId,
          messageName: delivery.message.name,
        }),
    });
    expect(receipt).toMatchObject({
      localId: accepted.localId,
      delivered: true,
      duplicate: false,
      watched: true,
    });
    expect(updates).toContain("completed");
    expect(deliveries).toEqual([
      {
        id: `mcp-task-delivery:${accepted.localId}`,
        sessionId: f.sessionId,
        messageName: "mcp_task_result",
      },
    ]);
    expect((await host.runtime.list()).records[0]).toMatchObject({
      resultSaved: true,
      delivered: true,
      pollIntervalMs: 5000,
    });
    const duplicate = await host.runtime.deliver(accepted.localId);
    expect(duplicate).toMatchObject({ delivered: true, duplicate: true });
  });

  it("rejects unbounded watch options before contacting the server", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export", {});
    await expect(
      host.runtime.watch(accepted.localId, { intervalMs: 60_001 }),
    ).rejects.toMatchObject({ code: "CC_MCP_TASK_WATCH_OPTIONS_INVALID" });
    expect(f.calls("tasks/get")).toHaveLength(0);
  });

  it.each(["network", "interval"])(
    "bounds the whole watch during a stalled %s without cancelling or replaying the remote task",
    async (stage) => {
      const f = await fixture();
      const host = await f.open();
      const accepted = await host.runtime.create("remote", "export", {});
      f.blockPolls(stage === "network");
      const started = Date.now();
      await expect(
        host.runtime.watch(accepted.localId, {
          intervalMs: 60_000,
          timeoutMs: 100,
        }),
      ).rejects.toMatchObject({ code: "CC_MCP_TASK_WATCH_TIMEOUT" });
      expect(Date.now() - started).toBeLessThan(2000);
      expect(f.calls("tasks/get")).toHaveLength(1);
      expect(f.calls("tools/call")).toHaveLength(1);
      expect(f.calls("tasks/cancel")).toHaveLength(0);
      expect(host.runtime.list().records[0]).toMatchObject({
        remoteStatus: "working",
        resultSaved: false,
        delivered: false,
      });
      f.blockPolls(false);
      f.complete();
      expect(
        await host.runtime.watch(accepted.localId, { timeoutMs: 1000 }),
      ).toMatchObject({ delivered: true });
      expect(f.calls("tools/call")).toHaveLength(1);
    },
    10_000,
  );

  it("times out behind a queued poll and never dispatches that expired queued request", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export", {});
    f.blockPolls(true);
    const prior = new AbortController();
    const pending = host.runtime.poll(accepted.localId, {
      signal: prior.signal,
    });
    const observed = pending.catch(() => {});
    await vi.waitFor(() => expect(f.calls("tasks/get")).toHaveLength(1));
    await expect(
      host.runtime.watch(accepted.localId, { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "CC_MCP_TASK_WATCH_TIMEOUT" });
    expect(f.calls("tasks/get")).toHaveLength(1);
    prior.abort();
    await observed;
    f.blockPolls(false);
    expect(await host.runtime.poll(accepted.localId)).toMatchObject({
      remoteStatus: "working",
    });
    expect(f.calls("tasks/get")).toHaveLength(2);
    expect(f.calls("tools/call")).toHaveLength(1);
  });

  it("honors caller cancellation between a cached observation and delivery", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export", {});
    await host.runtime.result(accepted.localId);
    const controller = new AbortController();
    const reason = new Error("stop before publishing");
    await expect(
      host.runtime.watch(accepted.localId, {
        signal: controller.signal,
        onUpdate: () => controller.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(host.runtime.list().records[0].delivered).toBe(false);
  });

  it("keeps an already-aborted caller authoritative and never publishes a cached result", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export", {});
    await host.runtime.result(accepted.localId);
    const controller = new AbortController();
    const reason = new Error("caller stopped tracking");
    controller.abort(reason);
    await expect(
      host.runtime.watch(accepted.localId, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(host.runtime.list().records[0].delivered).toBe(false);
  });

  it("recovers a saved but undelivered result without refetching it", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export", {});
    await host.runtime.result(accepted.localId);
    const resultCallsBefore = f.calls("tasks/result").length;
    const receipt = await host.runtime.watch(accepted.localId, {
      intervalMs: 0,
      timeoutMs: 500,
    });
    expect(receipt).toMatchObject({ delivered: true, duplicate: false });
    expect(f.calls("tasks/result")).toHaveLength(resultCallsBefore);
  });

  it.each(["disconnect", "404"])(
    "keeps prepare-only %s unknown and blocks both task and ordinary replay",
    async (mode) => {
      const f = await fixture();
      f.createFails(mode);
      const host = await f.open();
      await expect(
        host.runtime.create("remote", "export", { n: 1 }),
      ).rejects.toMatchObject({
        dispatched: true,
        outcomeUnknown: true,
      });
      const records = host.runtime.list().records;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        phase: "prepared",
        outcomeUnknown: true,
        taskId: null,
      });
      await expect(host.runtime.poll(records[0].localId)).rejects.toMatchObject(
        { code: "CC_MCP_TASK_ACCEPTANCE_UNKNOWN" },
      );
      await expect(
        host.runtime.create("remote", "export", { n: 1 }),
      ).rejects.toMatchObject({ code: "CC_MCP_LEDGER_RECOVERY_BLOCKED" });
      const recovery = loadMcpLedgerRecovery(f.sessionId);
      const ledger = createRecoveryGuardedMcpCallLedger({ recovery });
      await expect(
        ledger.begin({
          sessionId: f.sessionId,
          serverName: "remote",
          toolName: "export",
          input: { n: 1 },
        }),
      ).rejects.toThrow();
      expect(f.calls("tools/call")).toHaveLength(1);
      expect(f.calls("tasks/get")).toHaveLength(0);
    },
  );

  it("rejects changed credentials after restart without task query", async () => {
    const f = await fixture();
    const first = await f.open();
    const accepted = await first.runtime.create("remote", "export");
    await f.closeHost(first);
    const resumed = await f.open("different-tenant-token");
    await expect(resumed.runtime.poll(accepted.localId)).rejects.toMatchObject({
      code: "CC_MCP_TASK_RECOVERY_IDENTITY_CHANGED",
    });
    expect(f.calls("tasks/get")).toHaveLength(0);
  });

  it("fails closed if the recovery secret was lost", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export");
    const record = readMcpTaskJournal(f.sessionId).records[0];
    f.secrets.delete(record.secretRef);
    await expect(host.runtime.result(accepted.localId)).rejects.toMatchObject({
      code: "CC_MCP_TASK_RECOVERY_KEY_UNAVAILABLE",
    });
    expect(f.calls("tasks/result")).toHaveLength(0);
  });

  it("does not confuse expired/revoked task errors with effects never executing", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export");
    f.unavailable();
    await expect(host.runtime.poll(accepted.localId)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    await expect(host.runtime.result(accepted.localId)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    expect(host.runtime.list().records[0]).toMatchObject({
      remoteStatus: "working",
      callStatus: "started",
    });
    expect(f.calls("tools/call")).toHaveLength(1);
  });

  it("requires reconciliation before repeating a lost cancellation", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export");
    f.cancelFails(true);
    await expect(host.runtime.cancel(accepted.localId)).rejects.toMatchObject({
      outcomeUnknown: true,
    });
    expect(host.runtime.list().records[0]).toMatchObject({
      phase: "cancel_unknown",
      cancelUnknown: true,
    });
    await expect(host.runtime.cancel(accepted.localId)).rejects.toMatchObject({
      code: "CC_MCP_TASK_CANCEL_RECONCILIATION_REQUIRED",
    });
    expect(f.calls("tasks/cancel")).toHaveLength(1);
    await host.runtime.poll(accepted.localId);
    f.cancelFails(false);
    expect(await host.runtime.cancel(accepted.localId)).toMatchObject({
      remoteStatus: "cancelled",
      callStatus: "started",
    });
  });

  it("fences cancellation revoked between journal preparation and the actual send", async () => {
    const f = await fixture();
    const lease = acquireSessionHostLease(f.sessionId, {
      hostKind: "mcp-tasks",
    });
    let revokeCancel = false;
    const wrapped = {
      ...lease,
      admitMcpDispatch(metadata, send) {
        if (revokeCancel && metadata.method === "tasks/cancel") {
          revokeSessionHostAuthority(f.sessionId, {
            requestId: "cancel-revoke",
            reasonCode: "test",
          });
        }
        return lease.admitMcpDispatch(metadata, send);
      },
    };
    const host = await f.open(undefined, wrapped);
    const accepted = await host.runtime.create("remote", "export");
    revokeCancel = true;
    await expect(host.runtime.cancel(accepted.localId)).rejects.toThrow();
    expect(f.calls("tasks/cancel")).toHaveLength(0);
    expect(f.calls("tools/call")).toHaveLength(1);
  });

  it("repairs a crash after result_saved without retrieving it again", async () => {
    const f = await fixture();
    const host = await f.open();
    const accepted = await host.runtime.create("remote", "export");
    const saved = readMcpTaskJournal(f.sessionId).records[0];
    // Simulate the exact durable checkpoint immediately before call settlement.
    const result = await host.client.getTaskResult("remote", saved.task.taskId);
    appendMcpTaskJournalEvent(f.sessionId, {
      schemaVersion: 1,
      sessionId: f.sessionId,
      localId: saved.localId,
      revision: saved.revision + 1,
      phase: "result_saved",
      result,
      at: new Date().toISOString(),
    });
    expect(loadMcpLedgerRecovery(f.sessionId).unsettled).toHaveLength(1);
    await f.closeHost(host);
    const resumed = await f.open();
    expect(await resumed.runtime.result(accepted.localId)).toMatchObject({
      cached: true,
      callStatus: "completed",
    });
    expect(f.calls("tasks/result")).toHaveLength(1);
    expect(f.calls("tools/call")).toHaveLength(1);
    expect(loadMcpLedgerRecovery(f.sessionId).unsettled).toHaveLength(0);
  });

  it("rejects another session's local task ID", async () => {
    const f = await fixture();
    const first = await f.open();
    const accepted = await first.runtime.create("remote", "export");
    const otherId = "other-" + randomUUID();
    startSession(otherId, {});
    const lease = acquireSessionHostLease(otherId, { hostKind: "mcp-tasks" });
    cleanup.push(() => lease.release());
    const other = createDurableMcpTaskRuntime({
      client: first.client,
      sessionId: otherId,
      lease,
      secretStore: f.secrets,
    });
    await expect(other.result(accepted.localId)).rejects.toMatchObject({
      code: "CC_MCP_TASK_NOT_FOUND",
    });
    expect(f.calls("tasks/result")).toHaveLength(0);
  });

  it("does not dispatch when OS secret storage refuses the key", async () => {
    const f = await fixture();
    const host = await f.open();
    const denied = createDurableMcpTaskRuntime({
      client: host.client,
      sessionId: f.sessionId,
      lease: host.lease,
      secretStore: {
        set() {
          throw new Error("vault unavailable");
        },
        get() {
          return null;
        },
      },
    });
    await expect(denied.create("remote", "export")).rejects.toThrow(
      "vault unavailable",
    );
    expect(f.calls("tools/call")).toHaveLength(0);
    expect(loadMcpLedgerRecovery(f.sessionId).records).toHaveLength(0);
  });

  it("routes real CLI commands through the durable service and keeps list offline", async () => {
    const f = await fixture();
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const connect = vi.fn(async () => ({
      client: await f.connect(),
      connected: ["remote"],
    }));
    const run = async (args) => {
      const program = new Command();
      registerMcpTaskCommands(program.command("mcp"), {
        connect,
        secretStore: f.secrets,
      });
      await program.parseAsync(
        ["mcp", "tasks", ...args, "--session", f.sessionId, "--json"],
        { from: "user" },
      );
      return JSON.parse(output.mock.calls.at(-1)[0]);
    };
    try {
      const accepted = await run([
        "create",
        "export",
        "--server",
        "remote",
        "--args",
        '{"n":1}',
      ]);
      expect(accepted).toMatchObject({ phase: "accepted" });
      expect(await run(["list"])).toMatchObject({
        records: [{ localId: accepted.localId }],
      });
      expect(connect).toHaveBeenCalledTimes(1);
      expect(await run(["poll", accepted.localId])).toMatchObject({
        remoteStatus: "working",
      });
      expect(await run(["result", accepted.localId])).toMatchObject({
        callStatus: "completed",
        cached: false,
      });
      connect.mockRejectedValue(new Error("remote configuration removed"));
      expect(await run(["result", accepted.localId])).toMatchObject({
        cached: true,
      });
      const delivered = await run(["deliver", accepted.localId]);
      expect(delivered).toMatchObject({ delivered: true, duplicate: false });
      expect(await run(["deliver", accepted.localId])).toMatchObject({
        delivered: true,
        duplicate: true,
        eventHash: delivered.eventHash,
      });
      expect(connect).toHaveBeenCalledTimes(3);
      expect(f.calls("tools/call")).toHaveLength(1);
      expect(f.calls("tasks/result")).toHaveLength(1);
    } finally {
      output.mockRestore();
    }
  });
});
