import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createProgressiveCanaryExternalRollbackAuthority,
  createProgressiveCanaryHeartbeatAuthority,
  createProgressiveCanaryHeartbeatSource,
  createProgressiveCanaryWatchdogIncidentStore,
  createProgressiveCanaryWatchdogPlan,
  ProgressiveCanaryExternalWatchdog,
} from "../../src/lib/evolution/progressive-canary-external-watchdog.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function planFixture() {
  return createProgressiveCanaryWatchdogPlan({
    tenantId: "tenant-a",
    pilotId: "pilot-a",
    descriptorDigest: D("pilot-descriptor"),
    baselineDigest: D("last-known-good"),
    hostId: "pilot-host-a",
    leaseDurationMs: 5_000,
    heartbeatAuthority: {
      id: "heartbeat-authority-a",
      revision: 1,
      handlerDigest: D("heartbeat-handler"),
    },
    rollbackAuthority: {
      id: "rollback-authority-a",
      revision: 2,
      handlerDigest: D("rollback-handler"),
    },
  });
}

function heartbeatAuthority(plan, clock) {
  const sign = (payload) =>
    createHmac("sha256", "heartbeat-secret")
      .update(canonical(payload))
      .digest("base64url");
  return createProgressiveCanaryHeartbeatAuthority({
    plan,
    now: () => clock.value,
    attestor: async (payload) => sign(payload),
    verifier: async ({ payload, signature }) => signature === sign(payload),
  });
}

function actionReceipt(plan, request, action) {
  const core = {
    authenticated: true,
    durable: true,
    action,
    planDigest: plan.planDigest,
    incidentDigest: request.incidentDigest,
    authorityId: plan.rollbackAuthority.id,
    authorityRevision: plan.rollbackAuthority.revision,
    handlerDigest: plan.rollbackAuthority.handlerDigest,
    ...(action === "kill"
      ? { hostId: plan.hostId }
      : {
          baselineDigest: plan.baselineDigest,
          activeStateDigest: D(`active:${request.incidentDigest}`),
        }),
  };
  return { ...core, receiptDigest: D(canonical(core)) };
}

function watchdogFixture() {
  const plan = planFixture();
  const clock = { value: 1_000 };
  const heartbeats = heartbeatAuthority(plan, clock);
  const latest = { value: null };
  const heartbeatSource = createProgressiveCanaryHeartbeatSource({
    async readLatest() {
      return {
        authenticated: true,
        durable: true,
        receipt: structuredClone(latest.value),
      };
    },
  });
  const calls = [];
  const rollback = createProgressiveCanaryExternalRollbackAuthority({
    plan,
    killHost: async (request) => {
      calls.push(["kill", request.incidentDigest]);
      return actionReceipt(plan, request, "kill");
    },
    rollbackToBaseline: async (request) => {
      calls.push(["rollback", request.incidentDigest]);
      return actionReceipt(plan, request, "rollback");
    },
    verifyKill: async ({ request, receipt }) =>
      receipt.receiptDigest ===
      actionReceipt(plan, { incidentDigest: request.incidentDigest }, "kill")
        .receiptDigest,
    verifyRollback: async ({ request, receipt }) =>
      receipt.receiptDigest ===
      actionReceipt(
        plan,
        { incidentDigest: request.incidentDigest },
        "rollback",
      ).receiptDigest,
  });
  const incidents = new Map();
  const reservations = new Set();
  const store = createProgressiveCanaryWatchdogIncidentStore({
    async reserve({ incidentDigest }) {
      const acquired = !reservations.has(incidentDigest);
      reservations.add(incidentDigest);
      return {
        authenticated: true,
        durable: true,
        acquired,
        incidentDigest,
      };
    },
    async load({ incidentDigest }) {
      return structuredClone(incidents.get(incidentDigest) ?? null);
    },
    async commit(incident) {
      incidents.set(incident.incidentDigest, structuredClone(incident));
      return {
        authenticated: true,
        durable: true,
        incidentDigest: incident.incidentDigest,
      };
    },
  });
  const watchdog = new ProgressiveCanaryExternalWatchdog({
    plan,
    heartbeatAuthority: heartbeats,
    heartbeatSource,
    rollbackAuthority: rollback,
    incidentStore: store,
  });
  return { plan, clock, heartbeats, latest, calls, incidents, watchdog };
}

describe("progressive Canary external watchdog", () => {
  it("does nothing while an independently verified host lease is live", async () => {
    const { heartbeats, latest, watchdog, calls } = watchdogFixture();
    const heartbeatReceipt = await heartbeats.issue({
      sequence: 1,
      stage: "canary",
      activeStateDigest: D("candidate-active"),
    });
    latest.value = heartbeatReceipt;
    await expect(watchdog.inspect({ observedAt: 6_000 })).resolves.toEqual({
      healthy: true,
      rolledBack: false,
      incident: null,
    });
    expect(calls).toEqual([]);
  });

  it("kills the lost host before rolling back to LKG and durably recovers", async () => {
    const { heartbeats, latest, watchdog, calls } = watchdogFixture();
    const heartbeatReceipt = await heartbeats.issue({
      sequence: 2,
      stage: "active-probation",
      activeStateDigest: D("candidate-active"),
    });
    latest.value = heartbeatReceipt;
    const first = await watchdog.inspect({
      observedAt: 6_001,
    });
    expect(first.healthy).toBe(false);
    expect(first.rolledBack).toBe(true);
    expect(first.incident.rollbackReceipt.baselineDigest).toBe(
      D("last-known-good"),
    );
    expect(calls.map(([action]) => action)).toEqual(["kill", "rollback"]);

    const second = await watchdog.inspect({
      observedAt: 7_001,
    });
    expect(second.recovered).toBe(true);
    expect(second.incident.incidentDigest).toBe(first.incident.incidentDigest);
    expect(calls).toHaveLength(2);
  });

  it("rejects a forged heartbeat before invoking external effects", async () => {
    const { heartbeats, latest, watchdog, calls } = watchdogFixture();
    const heartbeatReceipt = await heartbeats.issue({
      sequence: 3,
      stage: "canary",
      activeStateDigest: D("candidate-active"),
    });
    latest.value = { ...heartbeatReceipt, expiresAt: 100 };
    await expect(
      watchdog.inspect({
        observedAt: 6_001,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("allows only one watchdog process to own an expired-lease incident", async () => {
    const { heartbeats, latest, watchdog, calls } = watchdogFixture();
    const heartbeatReceipt = await heartbeats.issue({
      sequence: 4,
      stage: "active-probation",
      activeStateDigest: D("candidate-active"),
    });
    latest.value = heartbeatReceipt;
    const results = await Promise.allSettled([
      watchdog.inspect({ observedAt: 6_001 }),
      watchdog.inspect({ observedAt: 6_001 }),
    ]);
    expect(results.some(({ status }) => status === "fulfilled")).toBe(true);
    expect(calls.map(([action]) => action)).toEqual(["kill", "rollback"]);
  });

  it("does not roll back a terminal active deployment after monitoring ends", async () => {
    const { heartbeats, latest, watchdog, calls } = watchdogFixture();
    latest.value = await heartbeats.issue({
      sequence: 5,
      stage: "active",
      activeStateDigest: D("stable-active"),
    });
    await expect(watchdog.inspect({ observedAt: 99_000 })).resolves.toEqual({
      healthy: true,
      rolledBack: false,
      incident: null,
      inactive: true,
    });
    expect(calls).toEqual([]);
  });
});
