import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TeamControlStore } from "../../src/lib/agent-team/team-control-store.js";

const roots = [];
const BOUND_ATTEMPT = Object.freeze({
  holder: "teammate-1",
  leaseId: "lease-epoch:1",
  fencingToken: "lease-epoch:1",
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-control-"));
  roots.push(root);
  const statePath = path.join(root, "team-state.json");
  fs.writeFileSync(statePath, "{}\n", { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") fs.chmodSync(statePath, 0o600);
  return {
    root,
    statePath,
    stateId: "team_state_test-authority",
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("TeamControlStore", () => {
  it("durably requests and acknowledges human takeover", () => {
    const input = fixture();
    let now = 1000;
    const store = new TeamControlStore({
      ...input,
      now: () => now++,
    });

    const created = store.requestInterrupt({
      requestId: "tctl_request-1",
      taskKey: "deploy",
      ...BOUND_ATTEMPT,
      actor: "alice",
      reason: "take over deployment",
    });
    expect(created).toMatchObject({
      ok: true,
      request: {
        type: "interrupt.request",
        sequence: 1,
        requestId: "tctl_request-1",
        taskKey: "deploy",
        holder: "teammate-1",
        leaseId: "lease-epoch:1",
        fencingToken: "lease-epoch:1",
      },
    });
    expect(created.request.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(store.pending()).toEqual([
      expect.objectContaining({
        requestId: "tctl_request-1",
        digest: created.request.digest,
      }),
    ]);

    expect(
      store.acknowledge({
        requestId: "tctl_request-1",
        outcome: "accepted",
        workerId: "coordinator-1",
      }),
    ).toMatchObject({
      ok: true,
      acknowledgement: {
        type: "interrupt.ack",
        sequence: 2,
      },
    });
    expect(store.pending()).toEqual([]);
    expect(store.cursor()).toMatchObject({
      version: 2,
      stateId: input.stateId,
      lastSequence: 2,
    });
  });

  it("makes identical requests and acknowledgements idempotent", () => {
    const store = new TeamControlStore(fixture());
    const request = {
      requestId: "tctl_idempotent",
      taskKey: "task-a",
      ...BOUND_ATTEMPT,
      actor: "operator",
      reason: "inspect",
    };
    expect(store.requestInterrupt(request)).toMatchObject({ ok: true });
    expect(store.requestInterrupt(request)).toMatchObject({
      ok: true,
      idempotent: true,
    });
    expect(() =>
      store.requestInterrupt({ ...request, taskKey: "task-b" }),
    ).toThrowError(expect.objectContaining({ code: "TEAM_CONTROL_CONFLICT" }));
    for (const changedBinding of [
      { holder: "teammate-2" },
      { leaseId: "lease-epoch:2" },
      { fencingToken: "lease-epoch:2" },
      { fencingToken: 1 },
    ]) {
      expect(() =>
        store.requestInterrupt({ ...request, ...changedBinding }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_CONTROL_CONFLICT" }),
      );
    }
    const ack = {
      requestId: request.requestId,
      outcome: "accepted",
      workerId: "worker-a",
    };
    expect(store.acknowledge(ack)).toMatchObject({ ok: true });
    expect(store.acknowledge(ack)).toMatchObject({
      ok: true,
      idempotent: true,
    });
    expect(() =>
      store.acknowledge({ ...ack, outcome: "rejected" }),
    ).toThrowError(expect.objectContaining({ code: "TEAM_CONTROL_CONFLICT" }));
  });

  it("detects corrupt events and cursor rollback", () => {
    const input = fixture();
    const store = new TeamControlStore(input);
    store.requestInterrupt({
      requestId: "tctl_first",
      taskKey: "a",
      ...BOUND_ATTEMPT,
      actor: "operator",
      reason: "first",
    });
    const firstDocument = fs.readFileSync(store.filePath, "utf8");
    store.requestInterrupt({
      requestId: "tctl_second",
      taskKey: "b",
      ...BOUND_ATTEMPT,
      actor: "operator",
      reason: "second",
    });
    const anchor = store.cursor();
    fs.writeFileSync(store.filePath, firstDocument, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") fs.chmodSync(store.filePath, 0o600);

    expect(() => store.pending({ anchor })).toThrowError(
      expect.objectContaining({ code: "TEAM_CONTROL_ROLLBACK" }),
    );

    const document = JSON.parse(firstDocument);
    document.events[0].taskKey = "tampered";
    fs.writeFileSync(store.filePath, JSON.stringify(document), {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") fs.chmodSync(store.filePath, 0o600);
    expect(() => store.pending()).toThrowError(
      expect.objectContaining({ code: "TEAM_CONTROL_CORRUPT" }),
    );
  });

  it("rejects a store rebound to another state authority", () => {
    const input = fixture();
    const first = new TeamControlStore(input);
    first.requestInterrupt({
      requestId: "tctl_bound",
      taskKey: "a",
      ...BOUND_ATTEMPT,
      actor: "operator",
      reason: "bound",
    });
    const rebound = new TeamControlStore({
      ...input,
      stateId: "team_state_other-authority",
    });
    expect(() => rebound.pending()).toThrowError(
      expect.objectContaining({ code: "TEAM_CONTROL_CORRUPT" }),
    );
  });

  it("rejects hard-linked authority files", () => {
    const input = fixture();
    const linked = path.join(input.root, "linked-state.json");
    fs.linkSync(input.statePath, linked);
    expect(
      () =>
        new TeamControlStore({
          statePath: linked,
          stateId: input.stateId,
        }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_CONTROL_UNSAFE_PATH" }),
    );
  });

  it("requires a typed exact-attempt binding and rejects legacy stores", () => {
    const input = fixture();
    const store = new TeamControlStore(input);
    const request = {
      requestId: "tctl_attempt-binding",
      taskKey: "deploy",
      actor: "operator",
      reason: "take over",
    };
    for (const invalidBinding of [
      {},
      { ...BOUND_ATTEMPT, holder: " teammate-1" },
      { ...BOUND_ATTEMPT, leaseId: "" },
      { ...BOUND_ATTEMPT, fencingToken: 0 },
      { ...BOUND_ATTEMPT, fencingToken: 1.5 },
      { ...BOUND_ATTEMPT, fencingToken: "lease\n1" },
    ]) {
      expect(() =>
        store.requestInterrupt({ ...request, ...invalidBinding }),
      ).toThrowError(expect.objectContaining({ code: "TEAM_CONTROL_INVALID" }));
    }

    store.requestInterrupt({ ...request, ...BOUND_ATTEMPT });
    const document = JSON.parse(fs.readFileSync(store.filePath, "utf8"));
    expect(document).toMatchObject({
      schemaVersion: 2,
      events: [
        {
          version: 2,
          holder: BOUND_ATTEMPT.holder,
          leaseId: BOUND_ATTEMPT.leaseId,
          fencingToken: BOUND_ATTEMPT.fencingToken,
        },
      ],
    });
    document.schemaVersion = 1;
    fs.writeFileSync(store.filePath, JSON.stringify(document), {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") fs.chmodSync(store.filePath, 0o600);
    expect(() => store.pending()).toThrowError(
      expect.objectContaining({ code: "TEAM_CONTROL_CORRUPT" }),
    );
  });

  it("accepts a durable stale-attempt acknowledgement", () => {
    const store = new TeamControlStore(fixture());
    store.requestInterrupt({
      requestId: "tctl_stale-attempt",
      taskKey: "deploy",
      ...BOUND_ATTEMPT,
      actor: "operator",
      reason: "take over",
    });
    expect(
      store.acknowledge({
        requestId: "tctl_stale-attempt",
        outcome: "stale_attempt",
        workerId: "coordinator-1",
      }),
    ).toMatchObject({
      ok: true,
      acknowledgement: { outcome: "stale_attempt" },
    });
    expect(store.pending()).toEqual([]);
  });
});
