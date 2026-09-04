import { createHash } from "node:crypto";

export const PROGRESSIVE_CANARY_WATCHDOG_PLAN_SCHEMA =
  "chainlesschain.progressive-canary-watchdog-plan/v2";
export const PROGRESSIVE_CANARY_HOST_HEARTBEAT_SCHEMA =
  "chainlesschain.progressive-canary-host-heartbeat/v2";
export const PROGRESSIVE_CANARY_WATCHDOG_INCIDENT_SCHEMA =
  "chainlesschain.progressive-canary-watchdog-incident/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const PILOT_STAGES = new Set([
  "candidate",
  "shadow",
  "canary",
  "active-probation",
  "active",
  "rolled-back",
]);
const WATCHED_STAGES = new Set(["shadow", "canary", "active-probation"]);
const HEARTBEAT_AUTHORITIES = new WeakSet();
const HEARTBEAT_SOURCES = new WeakSet();
const ROLLBACK_AUTHORITIES = new WeakSet();
const INCIDENT_STORES = new WeakSet();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(schema, value) {
  return `sha256:${createHash("sha256")
    .update(schema)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonical(Object.keys(value).sort()) !== canonical([...keys].sort())
  )
    throw new TypeError(`${label} has unexpected or missing fields`);
}

function id(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} is invalid`);
  return value;
}

function authorityDescriptor(value, label) {
  exact(
    value,
    ["id", "revision", "handlerDigest", "publicKeySpkiDigest"],
    label,
  );
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new TypeError(`${label}.revision is invalid`);
  return Object.freeze({
    id: id(value.id, `${label}.id`),
    revision: value.revision,
    handlerDigest: digest(value.handlerDigest, `${label}.handlerDigest`),
    publicKeySpkiDigest: digest(
      value.publicKeySpkiDigest,
      `${label}.publicKeySpkiDigest`,
    ),
  });
}

export function createProgressiveCanaryWatchdogPlan(input = {}) {
  exact(
    input,
    [
      "tenantId",
      "pilotId",
      "descriptorDigest",
      "baselineDigest",
      "hostId",
      "leaseDurationMs",
      "heartbeatAuthority",
      "rollbackAuthority",
    ],
    "watchdog plan",
  );
  if (
    !Number.isSafeInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < 1_000 ||
    input.leaseDurationMs > 86_400_000
  )
    throw new TypeError("leaseDurationMs is invalid");
  const core = {
    schema: PROGRESSIVE_CANARY_WATCHDOG_PLAN_SCHEMA,
    tenantId: id(input.tenantId, "tenantId"),
    pilotId: id(input.pilotId, "pilotId"),
    descriptorDigest: digest(input.descriptorDigest, "descriptorDigest"),
    baselineDigest: digest(input.baselineDigest, "baselineDigest"),
    hostId: id(input.hostId, "hostId"),
    leaseDurationMs: input.leaseDurationMs,
    heartbeatAuthority: authorityDescriptor(
      input.heartbeatAuthority,
      "heartbeatAuthority",
    ),
    rollbackAuthority: authorityDescriptor(
      input.rollbackAuthority,
      "rollbackAuthority",
    ),
  };
  return Object.freeze({
    ...core,
    planDigest: hash(PROGRESSIVE_CANARY_WATCHDOG_PLAN_SCHEMA, core),
  });
}

function verifyPlan(plan) {
  if (plan?.schema !== PROGRESSIVE_CANARY_WATCHDOG_PLAN_SCHEMA)
    throw new TypeError("a canonical watchdog plan is required");
  const core = structuredClone(plan);
  delete core.planDigest;
  if (hash(PROGRESSIVE_CANARY_WATCHDOG_PLAN_SCHEMA, core) !== plan.planDigest)
    throw new Error("watchdog plan digest mismatch");
  return plan;
}

export function createProgressiveCanaryHeartbeatAuthority({
  plan: planInput,
  attestor,
  verifier,
  now = Date.now,
} = {}) {
  const plan = verifyPlan(planInput);
  if (
    typeof attestor !== "function" ||
    typeof verifier !== "function" ||
    typeof now !== "function"
  )
    throw new TypeError("heartbeat authority ports are required");

  async function verify(receipt) {
    exact(
      receipt,
      [
        "schema",
        "planDigest",
        "tenantId",
        "pilotId",
        "descriptorDigest",
        "hostId",
        "sequence",
        "stage",
        "activeStateDigest",
        "issuedAt",
        "expiresAt",
        "authorityId",
        "authorityRevision",
        "handlerDigest",
        "publicKeySpkiDigest",
        "signature",
        "receiptDigest",
      ],
      "host heartbeat",
    );
    if (
      receipt.schema !== PROGRESSIVE_CANARY_HOST_HEARTBEAT_SCHEMA ||
      receipt.planDigest !== plan.planDigest ||
      receipt.tenantId !== plan.tenantId ||
      receipt.pilotId !== plan.pilotId ||
      receipt.descriptorDigest !== plan.descriptorDigest ||
      receipt.hostId !== plan.hostId ||
      !Number.isSafeInteger(receipt.sequence) ||
      receipt.sequence < 0 ||
      !PILOT_STAGES.has(receipt.stage) ||
      !DIGEST.test(receipt.activeStateDigest ?? "") ||
      !Number.isSafeInteger(receipt.issuedAt) ||
      !Number.isSafeInteger(receipt.expiresAt) ||
      receipt.expiresAt !== receipt.issuedAt + plan.leaseDurationMs ||
      receipt.authorityId !== plan.heartbeatAuthority.id ||
      receipt.authorityRevision !== plan.heartbeatAuthority.revision ||
      receipt.handlerDigest !== plan.heartbeatAuthority.handlerDigest ||
      receipt.publicKeySpkiDigest !==
        plan.heartbeatAuthority.publicKeySpkiDigest ||
      typeof receipt.signature !== "string" ||
      receipt.signature.length < 32
    )
      throw new Error("host heartbeat binding is invalid");
    const core = structuredClone(receipt);
    delete core.receiptDigest;
    if (
      hash(PROGRESSIVE_CANARY_HOST_HEARTBEAT_SCHEMA, core) !==
      receipt.receiptDigest
    )
      throw new Error("host heartbeat digest mismatch");
    const payload = structuredClone(core);
    delete payload.signature;
    if (!(await verifier({ payload, signature: receipt.signature })))
      throw new Error("host heartbeat signature rejected");
    return Object.freeze(structuredClone(receipt));
  }

  const authority = Object.freeze({
    planDigest: plan.planDigest,
    async issue({ sequence, stage, activeStateDigest } = {}) {
      const payload = {
        schema: PROGRESSIVE_CANARY_HOST_HEARTBEAT_SCHEMA,
        planDigest: plan.planDigest,
        tenantId: plan.tenantId,
        pilotId: plan.pilotId,
        descriptorDigest: plan.descriptorDigest,
        hostId: plan.hostId,
        sequence: timestamp(sequence, "heartbeat sequence"),
        stage: id(stage, "heartbeat stage"),
        activeStateDigest: digest(activeStateDigest, "activeStateDigest"),
        issuedAt: timestamp(Number(now()), "heartbeat clock"),
        expiresAt: Number(now()) + plan.leaseDurationMs,
        authorityId: plan.heartbeatAuthority.id,
        authorityRevision: plan.heartbeatAuthority.revision,
        handlerDigest: plan.heartbeatAuthority.handlerDigest,
        publicKeySpkiDigest: plan.heartbeatAuthority.publicKeySpkiDigest,
      };
      if (payload.expiresAt !== payload.issuedAt + plan.leaseDurationMs)
        throw new Error("heartbeat clock changed during issuance");
      const signature = await attestor(Object.freeze(structuredClone(payload)));
      const core = { ...payload, signature };
      return verify(
        Object.freeze({
          ...core,
          receiptDigest: hash(PROGRESSIVE_CANARY_HOST_HEARTBEAT_SCHEMA, core),
        }),
      );
    },
    verify,
  });
  HEARTBEAT_AUTHORITIES.add(authority);
  return authority;
}

function verifyActionReceipt(receipt, action, plan, incidentDigest) {
  if (
    receipt?.authenticated !== true ||
    receipt?.durable !== true ||
    receipt.action !== action ||
    receipt.planDigest !== plan.planDigest ||
    receipt.incidentDigest !== incidentDigest ||
    receipt.authorityId !== plan.rollbackAuthority.id ||
    receipt.authorityRevision !== plan.rollbackAuthority.revision ||
    receipt.handlerDigest !== plan.rollbackAuthority.handlerDigest ||
    receipt.publicKeySpkiDigest !==
      plan.rollbackAuthority.publicKeySpkiDigest ||
    !DIGEST.test(receipt.receiptDigest ?? "")
  )
    throw new Error(`external ${action} authority receipt is invalid`);
  if (action === "kill" && receipt.hostId !== plan.hostId)
    throw new Error("external kill receipt targets another host");
  if (
    action === "rollback" &&
    (receipt.baselineDigest !== plan.baselineDigest ||
      !DIGEST.test(receipt.activeStateDigest ?? ""))
  )
    throw new Error("external rollback receipt targets another baseline");
  return Object.freeze(structuredClone(receipt));
}

export function createProgressiveCanaryExternalRollbackAuthority({
  plan: planInput,
  killHost,
  rollbackToBaseline,
  verifyKill,
  verifyRollback,
} = {}) {
  const plan = verifyPlan(planInput);
  if (
    typeof killHost !== "function" ||
    typeof rollbackToBaseline !== "function" ||
    typeof verifyKill !== "function" ||
    typeof verifyRollback !== "function"
  )
    throw new TypeError("external rollback authority ports are required");
  const authority = Object.freeze({
    planDigest: plan.planDigest,
    async engage({ incidentDigest, heartbeatReceiptDigest, observedAt }) {
      digest(incidentDigest, "incidentDigest");
      digest(heartbeatReceiptDigest, "heartbeatReceiptDigest");
      timestamp(observedAt, "observedAt");
      const request = Object.freeze({
        planDigest: plan.planDigest,
        incidentDigest,
        heartbeatReceiptDigest,
        observedAt,
      });
      const killReceipt = verifyActionReceipt(
        await killHost({ ...request, hostId: plan.hostId }),
        "kill",
        plan,
        incidentDigest,
      );
      if ((await verifyKill({ request, receipt: killReceipt })) !== true)
        throw new Error("external kill receipt signature rejected");
      const rollbackReceipt = verifyActionReceipt(
        await rollbackToBaseline({
          ...request,
          baselineDigest: plan.baselineDigest,
        }),
        "rollback",
        plan,
        incidentDigest,
      );
      if (
        (await verifyRollback({ request, receipt: rollbackReceipt })) !== true
      )
        throw new Error("external rollback receipt signature rejected");
      return Object.freeze({ killReceipt, rollbackReceipt });
    },
  });
  ROLLBACK_AUTHORITIES.add(authority);
  return authority;
}

export function createProgressiveCanaryWatchdogIncidentStore({
  reserve,
  load,
  commit,
} = {}) {
  if (
    typeof reserve !== "function" ||
    typeof load !== "function" ||
    typeof commit !== "function"
  )
    throw new TypeError("watchdog incident store ports are required");
  const store = Object.freeze({ reserve, load, commit });
  INCIDENT_STORES.add(store);
  return store;
}

export function createProgressiveCanaryHeartbeatSource({ readLatest } = {}) {
  if (typeof readLatest !== "function")
    throw new TypeError("heartbeat source readLatest() is required");
  const source = Object.freeze({ readLatest });
  HEARTBEAT_SOURCES.add(source);
  return source;
}

function verifyIncident(value, plan, incidentDigest) {
  if (
    value?.schema !== PROGRESSIVE_CANARY_WATCHDOG_INCIDENT_SCHEMA ||
    value.planDigest !== plan.planDigest ||
    value.incidentDigest !== incidentDigest ||
    !DIGEST.test(value.killReceipt?.receiptDigest ?? "") ||
    !DIGEST.test(value.rollbackReceipt?.receiptDigest ?? "")
  )
    throw new Error("watchdog incident binding is invalid");
  const trigger = {
    schema: value.schema,
    planDigest: value.planDigest,
    heartbeatReceiptDigest: value.heartbeatReceiptDigest,
    leaseExpiredAt: value.leaseExpiredAt,
  };
  if (
    hash(PROGRESSIVE_CANARY_WATCHDOG_INCIDENT_SCHEMA, trigger) !==
      incidentDigest ||
    value.killReceipt.incidentDigest !== incidentDigest ||
    value.rollbackReceipt.incidentDigest !== incidentDigest
  )
    throw new Error("watchdog incident digest mismatch");
  return Object.freeze(structuredClone(value));
}

export class ProgressiveCanaryExternalWatchdog {
  constructor({
    plan: planInput,
    heartbeatAuthority,
    heartbeatSource,
    rollbackAuthority,
    incidentStore,
  } = {}) {
    this.plan = verifyPlan(planInput);
    if (
      !HEARTBEAT_AUTHORITIES.has(heartbeatAuthority) ||
      heartbeatAuthority.planDigest !== this.plan.planDigest
    )
      throw new TypeError("a plan-bound heartbeat authority is required");
    if (
      !ROLLBACK_AUTHORITIES.has(rollbackAuthority) ||
      rollbackAuthority.planDigest !== this.plan.planDigest
    )
      throw new TypeError(
        "a plan-bound external rollback authority is required",
      );
    if (!HEARTBEAT_SOURCES.has(heartbeatSource))
      throw new TypeError("a branded durable heartbeat source is required");
    if (!INCIDENT_STORES.has(incidentStore))
      throw new TypeError("a branded durable incident store is required");
    this._heartbeats = heartbeatAuthority;
    this._heartbeatSource = heartbeatSource;
    this._rollback = rollbackAuthority;
    this._store = incidentStore;
    Object.freeze(this);
  }

  async inspect({ observedAt } = {}) {
    timestamp(observedAt, "observedAt");
    const latest = await this._heartbeatSource.readLatest({
      planDigest: this.plan.planDigest,
      hostId: this.plan.hostId,
    });
    if (
      latest?.authenticated !== true ||
      latest?.durable !== true ||
      !latest.receipt
    )
      throw new Error("latest host heartbeat was not durably authenticated");
    const heartbeat = await this._heartbeats.verify(latest.receipt);
    if (!WATCHED_STAGES.has(heartbeat.stage))
      return Object.freeze({
        healthy: true,
        rolledBack: false,
        incident: null,
        inactive: true,
      });
    if (observedAt <= heartbeat.expiresAt)
      return Object.freeze({
        healthy: true,
        rolledBack: false,
        incident: null,
      });
    const incidentCore = {
      schema: PROGRESSIVE_CANARY_WATCHDOG_INCIDENT_SCHEMA,
      planDigest: this.plan.planDigest,
      heartbeatReceiptDigest: heartbeat.receiptDigest,
      leaseExpiredAt: heartbeat.expiresAt,
    };
    const incidentDigest = hash(
      PROGRESSIVE_CANARY_WATCHDOG_INCIDENT_SCHEMA,
      incidentCore,
    );
    const prior = await this._store.load({
      planDigest: this.plan.planDigest,
      incidentDigest,
    });
    if (prior)
      return Object.freeze({
        healthy: false,
        rolledBack: true,
        incident: verifyIncident(prior, this.plan, incidentDigest),
        recovered: true,
      });
    const reservation = await this._store.reserve({
      planDigest: this.plan.planDigest,
      incidentDigest,
    });
    if (
      reservation?.authenticated !== true ||
      reservation?.durable !== true ||
      reservation.incidentDigest !== incidentDigest ||
      typeof reservation.acquired !== "boolean"
    )
      throw new Error("watchdog incident reservation was not authenticated");
    if (!reservation.acquired) {
      const completed = await this._store.load({
        planDigest: this.plan.planDigest,
        incidentDigest,
      });
      if (!completed)
        throw new Error("watchdog incident is reserved by another process");
      return Object.freeze({
        healthy: false,
        rolledBack: true,
        incident: verifyIncident(completed, this.plan, incidentDigest),
        recovered: true,
      });
    }
    const { killReceipt, rollbackReceipt } = await this._rollback.engage({
      incidentDigest,
      heartbeatReceiptDigest: heartbeat.receiptDigest,
      observedAt,
    });
    const incident = Object.freeze({
      ...incidentCore,
      observedAt,
      killReceipt,
      rollbackReceipt,
      incidentDigest,
    });
    const acknowledgement = await this._store.commit(incident);
    if (
      acknowledgement?.authenticated !== true ||
      acknowledgement?.durable !== true ||
      acknowledgement.incidentDigest !== incidentDigest
    )
      throw new Error("watchdog incident was not durably authenticated");
    const readback = verifyIncident(
      await this._store.load({
        planDigest: this.plan.planDigest,
        incidentDigest,
      }),
      this.plan,
      incidentDigest,
    );
    return Object.freeze({
      healthy: false,
      rolledBack: true,
      incident: readback,
      recovered: false,
    });
  }
}
