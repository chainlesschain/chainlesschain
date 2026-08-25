import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TeamSessionMessageAdapter } from "../../src/lib/agent-team/team-session-message-adapter.js";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";

const temporaryDirectories = [];
const PROCESS_FIXTURE = fileURLToPath(
  new URL("../fixtures/team-session-message-process.mjs", import.meta.url),
);

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-fabric-"));
  temporaryDirectories.push(directory);
  return new TeamSessionMessageAdapter({
    statePath: path.join(directory, "messages.json"),
    teamId: "team_state_test",
    recipients: ["teammate-1", "teammate-2"],
    ...options,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("TeamSessionMessageAdapter", () => {
  it("binds offline promotion to the TeamRunner member lifecycle", async () => {
    const adapter = fixture();
    adapter.setRecipientState("teammate-1", "idle");
    const message = adapter.send({
      from: "coordinator",
      to: "teammate-1",
      body: "run-scoped",
      idempotencyKey: "runner-message",
    });
    const registry = new TaskLeaseRegistry();
    registry.addTask({ key: "task", title: "task" });
    const runner = new TeamRunner(registry, {
      teammates: 1,
      mailbox: adapter,
      realtimeMessaging: true,
      runTask: async ({ inbox, messageAuthority }) => {
        expect(inbox.map((entry) => entry.id)).toEqual([message.id]);
        adapter.acknowledge("teammate-1", {
          messageIds: [message.id],
          consumerKey: "runner-consumer",
          status: "processed",
          recipientAttempt: messageAuthority(),
        });
        return "ok";
      },
    });
    await expect(runner.run()).resolves.toMatchObject({ success: true });
    expect(adapter.peek("teammate-1")).toEqual([]);
    expect(adapter.snapshot().receipts).toContainEqual([
      `teammate-1\0${message.id}`,
      expect.objectContaining({ status: "processed" }),
    ]);
  });

  it("holds an offline follow-up, redelivers after restart and persists processed ACK", () => {
    const adapter = fixture();
    adapter.setRecipientState("teammate-2", "idle");
    const sent = adapter.send({
      from: "teammate-1",
      to: "teammate-2",
      mode: "followup",
      subject: "review",
      body: { path: "src/a.js" },
      idempotencyKey: "followup-1",
      senderAttempt: { taskKey: "task-a", leaseId: "lease-a" },
    });
    expect(adapter.peek("teammate-2")).toEqual([]);
    expect(adapter.snapshot()).toMatchObject({
      authority: "session-message-fabric",
      fabricRevision: expect.any(Number),
    });

    const restarted = TeamSessionMessageAdapter.restore(adapter.snapshot());
    restarted.setRecipientState("teammate-2", "running");
    const [delivery] = restarted.receive("teammate-2", { markRead: true });
    expect(delivery).toMatchObject({
      id: sent.id,
      mode: "followup",
      delivery: { status: "read", deliveryCount: 1 },
    });
    restarted.acknowledge("teammate-2", {
      messageIds: [sent.id],
      consumerKey: "task-b:attempt-1",
      status: "processed",
      recipientAttempt: { taskKey: "task-b", fencingToken: 2 },
    });

    expect(
      TeamSessionMessageAdapter.restore(restarted.snapshot()).peek(
        "teammate-2",
      ),
    ).toEqual([]);
    expect(restarted.snapshot().receipts).toContainEqual([
      `teammate-2\0${sent.id}`,
      expect.objectContaining({
        status: "processed",
        consumerKey: "task-b:attempt-1",
      }),
    ]);
  });

  it("shares one sender-rate bucket across adapters and preserves idempotent sends", () => {
    let now = 1_000;
    const adapter = fixture({
      now: () => now,
      maxMessagesPerSenderWindow: 2,
      senderRateWindowMs: 100,
    });
    const base = {
      from: "teammate-1",
      to: "teammate-2",
      senderAttempt: { taskKey: "task-a" },
    };
    const first = adapter.send({
      ...base,
      body: "first",
      idempotencyKey: "rate-1",
    });
    expect(
      adapter.send({
        ...base,
        body: "first",
        idempotencyKey: "rate-1",
      }).id,
    ).toBe(first.id);
    adapter.send({ ...base, body: "second", idempotencyKey: "rate-2" });

    const peer = new TeamSessionMessageAdapter({
      statePath: adapter.statePath,
      teamId: adapter.teamId,
      recipients: ["teammate-1", "teammate-2"],
      now: () => now,
      maxMessagesPerSenderWindow: 2,
      senderRateWindowMs: 100,
    });
    expect(() =>
      peer.send({ ...base, body: "third", idempotencyKey: "rate-3" }),
    ).toThrowError(expect.objectContaining({ retryAfterMs: 100 }));
    expect(peer.peek("teammate-2")).toHaveLength(2);
  });

  it("recovers offline processing and enforces rate limits in separate processes", () => {
    const adapter = fixture({
      maxMessagesPerSenderWindow: 2,
      senderRateWindowMs: 60_000,
    });
    adapter.setRecipientState("teammate-2", "idle");
    const offline = adapter.send({
      from: "coordinator",
      to: "teammate-2",
      body: "offline process recovery",
      idempotencyKey: "offline-process",
    });
    const recovered = JSON.parse(
      execFileSync(
        process.execPath,
        [PROCESS_FIXTURE, "recover", adapter.statePath, adapter.teamId],
        { encoding: "utf8" },
      ),
    );
    expect(recovered).toEqual({ messages: [offline.id], pending: 0 });

    const rateBase = {
      from: "teammate-1",
      to: "teammate-2",
      senderAttempt: { taskKey: "rate-task" },
    };
    adapter.send({
      ...rateBase,
      body: "process first",
      idempotencyKey: "process-rate-1",
    });
    adapter.send({
      ...rateBase,
      body: "process second",
      idempotencyKey: "process-rate-2",
    });
    const limited = JSON.parse(
      execFileSync(
        process.execPath,
        [PROCESS_FIXTURE, "rate", adapter.statePath, adapter.teamId],
        { encoding: "utf8" },
      ),
    );
    expect(limited).toMatchObject({
      admitted: false,
      retryAfterMs: expect.any(Number),
    });
  });

  it("expands broadcasts once per recipient and dead-letters poison durably", () => {
    const adapter = fixture();
    const sent = adapter.send({
      from: "coordinator",
      to: "*",
      body: { kind: "invalid" },
      idempotencyKey: "broadcast-1",
    });
    expect(adapter.receive("teammate-1")[0].id).toBe(sent.id);
    expect(adapter.receive("teammate-2")[0].id).toBe(sent.id);
    adapter.acknowledge("teammate-1", {
      messageIds: [sent.id],
      consumerKey: "poison-handler-1",
      status: "dead_letter",
      reason: "schema rejected",
    });
    expect(adapter.peek("teammate-1")).toEqual([]);
    expect(adapter.peek("teammate-2")).toHaveLength(1);
    expect(
      TeamSessionMessageAdapter.restore(adapter.snapshot()).status().counters
        .deadLetteredMessages,
    ).toBe(1);
  });

  it("migrates a legacy v3 mailbox once and keeps its terminal receipts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-legacy-"));
    temporaryDirectories.push(directory);
    const legacy = new TeamMailbox({ recipients: ["teammate-1"] });
    const message = legacy.send({
      from: "coordinator",
      to: "teammate-1",
      body: "legacy",
      idempotencyKey: "legacy-1",
    });
    legacy.receive("teammate-1", { markRead: true });
    legacy.acknowledge("teammate-1", {
      messageIds: [message.id],
      consumerKey: "legacy-consumer",
      status: "processed",
    });

    const migrated = TeamSessionMessageAdapter.migrateLegacy(
      legacy.snapshot(),
      {
        statePath: path.join(directory, "messages.json"),
        teamId: "team_state_legacy",
      },
    );
    expect(migrated.log()).toContainEqual(
      expect.objectContaining({ id: message.id, body: "legacy" }),
    );
    expect(migrated.snapshot().receipts).toContainEqual([
      `teammate-1\0${message.id}`,
      expect.objectContaining({
        status: "processed",
        consumerKey: "legacy-consumer",
      }),
    ]);
  });
});
