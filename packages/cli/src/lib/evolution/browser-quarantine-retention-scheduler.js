import { createHash } from "node:crypto";
import { types } from "node:util";

import { captureBrowserQuarantineRetentionAuthority } from "./browser-quarantine-retention-authority.js";

export const BROWSER_QUARANTINE_RETENTION_SCHEDULER_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-quarantine-retention-scheduler-descriptor/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const schedulers = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  )
    throw new TypeError(`${label} has unexpected or accessor fields`);
}

function normalizeDescriptor(value, authorityDescriptor) {
  exact(
    value,
    [
      "schema",
      "schedulerId",
      "tenantId",
      "handlerArtifactDigest",
      "intervalMs",
      "runOnStart",
      "overlapMode",
      "shutdownMode",
    ],
    "browser quarantine retention scheduler descriptor",
  );
  if (
    value.schema !== BROWSER_QUARANTINE_RETENTION_SCHEDULER_DESCRIPTOR_SCHEMA ||
    !ID.test(value.schedulerId) ||
    value.tenantId !== authorityDescriptor.tenantId ||
    value.handlerArtifactDigest !== authorityDescriptor.handlerArtifactDigest ||
    !Number.isSafeInteger(value.intervalMs) ||
    value.intervalMs < 1000 ||
    value.intervalMs > 24 * 60 * 60 * 1000 ||
    typeof value.runOnStart !== "boolean" ||
    value.overlapMode !== "skip" ||
    value.shutdownMode !== "drain"
  )
    throw new TypeError(
      "browser quarantine retention scheduler descriptor is invalid",
    );
  return Object.freeze({ ...value });
}

export function createBrowserQuarantineRetentionScheduler(options) {
  exact(
    options,
    ["descriptor", "authority", "setIntervalFn", "clearIntervalFn", "now"],
    "browser quarantine retention scheduler",
  );
  const authority = captureBrowserQuarantineRetentionAuthority(
    options.authority,
  );
  const descriptor = normalizeDescriptor(
    options.descriptor,
    authority.descriptor,
  );
  for (const [name, port] of Object.entries({
    setIntervalFn: options.setIntervalFn,
    clearIntervalFn: options.clearIntervalFn,
    now: options.now,
  })) {
    if (typeof port !== "function" || types.isProxy(port))
      throw new TypeError(
        `browser quarantine retention scheduler ${name} is invalid`,
      );
  }
  const scheduler = Object.freeze({});
  schedulers.set(scheduler, {
    descriptor,
    runExpirySweep: authority.runExpirySweep,
    setIntervalFn: options.setIntervalFn,
    clearIntervalFn: options.clearIntervalFn,
    now: options.now,
    started: false,
    timer: null,
    active: null,
    lastRun: null,
  });
  return scheduler;
}

async function runOnce(state, trigger) {
  if (state.active !== null)
    return Object.freeze({ status: "skipped", reason: "already-active" });
  const startedAtMs = state.now();
  if (!Number.isFinite(startedAtMs))
    throw new Error("browser quarantine retention scheduler clock is invalid");
  state.active = (async () => {
    try {
      const result = await state.runExpirySweep();
      if (
        !result ||
        typeof result !== "object" ||
        types.isProxy(result) ||
        !DIGEST.test(result.resultDigest) ||
        result.authenticated !== true ||
        result.durable !== true ||
        result.readbackVerified !== true
      )
        throw new Error("browser quarantine retention sweep result is invalid");
      state.lastRun = Object.freeze({
        status: "succeeded",
        trigger,
        startedAt: new Date(startedAtMs).toISOString(),
        resultDigest: result.resultDigest,
        failureDigest: null,
      });
    } catch (error) {
      state.lastRun = Object.freeze({
        status: "failed",
        trigger,
        startedAt: new Date(startedAtMs).toISOString(),
        resultDigest: null,
        failureDigest: digest(
          "chainlesschain.browser-quarantine-retention-scheduler-failure/v1",
          { name: error?.name ?? "Error", code: error?.code ?? null },
        ),
      });
    }
    return state.lastRun;
  })();
  try {
    return await state.active;
  } finally {
    state.active = null;
  }
}

export function captureBrowserQuarantineRetentionScheduler(value) {
  const state = schedulers.get(value);
  if (!state)
    throw new TypeError(
      "A branded browser quarantine retention scheduler is required",
    );
  return Object.freeze({
    descriptor: state.descriptor,
    start: async () => {
      if (state.started)
        throw new Error(
          "browser quarantine retention scheduler is already started",
        );
      const callback = () => {
        if (!state.started) return;
        void runOnce(state, "interval").catch(() => {});
      };
      const timer = state.setIntervalFn(callback, state.descriptor.intervalMs);
      if (timer === null || timer === undefined)
        throw new Error(
          "browser quarantine retention scheduler timer is invalid",
        );
      state.timer = timer;
      state.started = true;
      if (state.descriptor.runOnStart) await runOnce(state, "startup");
      return Object.freeze({ status: "started" });
    },
    runNow: async () => runOnce(state, "manual"),
    stop: async () => {
      if (state.started) {
        state.clearIntervalFn(state.timer);
        state.timer = null;
        state.started = false;
      }
      if (state.active !== null) await state.active;
      return Object.freeze({ status: "stopped", lastRun: state.lastRun });
    },
    inspect: () =>
      Object.freeze({
        started: state.started,
        running: state.active !== null,
        lastRun: state.lastRun,
      }),
  });
}
