/** A separately consented v4 lease observes bounded native evidence snapshots. */
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { cliGoalExtensionHost } from "./cli-goal-capabilities.js";
import { managedSettingsPath } from "../settings-loader.cjs";
import { createProjectGoalConnection } from "../project-goal-connection.js";
import {
  collectGoalExtensions,
  projectGoalExtensionEvent,
} from "./goal-extensions.js";

const TYPES = ["risk.review.completed", "action.receipt.updated"];
const SCHEMA = "chainlesschain.goal-extension-stream/v1";
export const _deps = { createProjectGoalConnection, projectGoalExtensionEvent };
const fail = (code) => {
  throw new Error(code);
};
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Capture options before any I/O. Never reinterpret another lease as events. */
export function watchCliProjectGoalEvents(id, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const env = Object.freeze({ ...(options.env || process.env) });
  const managedSettingsFile = managedSettingsPath({
    env,
    managedSettingsFile: options.managedSettingsFile,
  });
  const name = options.plugin,
    scope = options.scope,
    expectedStore = options.expectedStore;
  const connectionFile = options.connection;
  const intervalMs = options.intervalMs ?? 1000,
    durationMs = options.durationMs ?? 60000;
  const signal = options.signal;
  if (typeof name !== "string" || !name || name.length > 256)
    fail("CLI_GOAL_INVALID_PLUGIN_NAME");
  if (scope !== undefined && !["user", "project", "local"].includes(scope))
    fail("CLI_GOAL_INVALID_PLUGIN_SCOPE");
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 250 ||
    intervalMs > 60000 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1000 ||
    durationMs > 900000
  )
    fail("CLI_GOAL_INVALID_WATCH_LIMIT");
  if (signal !== undefined && !(signal instanceof AbortSignal))
    fail("CLI_GOAL_INVALID_WATCH_SIGNAL");
  const host = cliGoalExtensionHost(TYPES.map((type) => `event:${type}`));
  const admission = Object.freeze({ cwd, env, managedSettingsFile, host });
  return (async function* () {
    if (signal?.aborted) return;
    const source = _deps.createProjectGoalConnection(connectionFile);
    if (!source.events || typeof source.readEvents !== "function")
      fail("CLI_GOAL_EVENT_CONNECTION_REQUIRED");
    const goalRef = source.goalRef;
    if (
      id !== goalRef.id ||
      (expectedStore !== undefined && expectedStore !== goalRef.storeId)
    )
      fail("CLI_GOAL_STORE_MISMATCH");
    const matches = collectGoalExtensions(admission).extensions.filter(
      (entry) =>
        entry.name === name &&
        (!scope || entry.scope === scope) &&
        entry.declaration.events.some((type) => TYPES.includes(type)),
    );
    if (matches.length !== 1) fail("CLI_GOAL_EVENT_PLUGIN_UNAVAILABLE");
    const plugin = matches[0];
    const ref = Object.freeze({
      name: plugin.name,
      scope: plugin.scope,
      version: plugin.version,
    });
    const declaration = digest(plugin.declaration);
    function revalidatePlugin() {
      const current = collectGoalExtensions(admission).extensions.find(
        (entry) =>
          entry.name === ref.name &&
          entry.scope === ref.scope &&
          entry.version === ref.version,
      );
      if (!current || digest(current.declaration) !== declaration)
        fail("CLI_GOAL_EVENT_ADMISSION_CHANGED");
    }
    const deadline = performance.now() + durationMs;
    const controller = new AbortController();
    const stop = () => controller.abort();
    const timer = setTimeout(stop, durationMs);
    timer.unref();
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    async function read() {
      revalidatePlugin();
      const value = await source.readEvents(id, { signal: controller.signal });
      revalidatePlugin();
      return value;
    }
    async function revalidate(snapshot) {
      if (digest(await read()) !== digest(snapshot))
        fail("CLI_GOAL_EVENT_SOURCE_CHANGED");
    }
    try {
      let previous = await read();
      await revalidate(previous);
      if (controller.signal.aborted) return;
      yield Object.freeze({
        schema: SCHEMA,
        kind: "ready",
        source: "desktop-project",
        plugin: ref,
        goalRef,
        observedAt: new Date().toISOString(),
        delivery: "polling",
        replay: false,
      });
      while (!controller.signal.aborted && performance.now() < deadline) {
        await delay(
          Math.min(intervalMs, Math.max(1, deadline - performance.now())),
          undefined,
          { signal: controller.signal },
        );
        if (controller.signal.aborted || performance.now() >= deadline) return;
        const current = await read();
        if (digest(current) === digest(previous)) continue;
        const events = [];
        if (
          (previous.risk.reviewId && !current.risk.reviewId) ||
          (previous.receipts.state === "recorded" &&
            current.receipts.state !== "recorded")
        )
          fail("CLI_GOAL_EVENT_SOURCE_REGRESSED");
        if (
          current.risk.reviewId &&
          digest(current.risk) !== digest(previous.risk) &&
          plugin.declaration.events.includes(TYPES[0])
        )
          events.push({
            type: TYPES[0],
            summary: `Historical risk check ${current.risk.reviewId}: ${current.risk.state}; risk task count ${current.risk.riskTaskCount ?? "unknown"}. Current risk and goal completion require native verification.`,
          });
        for (const receipt of current.receipts.entries) {
          const before = previous.receipts.entries.find(
            (entry) => entry.id === receipt.id,
          );
          if (
            before &&
            before.status !== "unresolved" &&
            digest(before) !== digest(receipt)
          )
            fail("CLI_GOAL_EVENT_SOURCE_REGRESSED");
          if (
            (!before || digest(receipt) !== digest(before)) &&
            plugin.declaration.events.includes(TYPES[1])
          )
            events.push({
              type: TYPES[1],
              summary: `Historical action receipt ${receipt.id}: ${receipt.status} (${receipt.actionType}). This does not prove goal completion.`,
            });
        }
        for (const candidate of events) {
          const observedAt = new Date().toISOString();
          const event = await _deps.projectGoalExtensionEvent(
            ref,
            { type: candidate.type, goalRef },
            {
              ...admission,
              async authorize(context) {
                if (
                  context.operation !== "read-event" ||
                  context.type !== candidate.type ||
                  JSON.stringify(context.goalRef) !== JSON.stringify(goalRef)
                )
                  return false;
                await revalidate(current);
                return true;
              },
              async readEvent() {
                await revalidate(current);
                return { summary: candidate.summary, occurredAt: observedAt };
              },
            },
          );
          await revalidate(current);
          if (controller.signal.aborted || performance.now() >= deadline)
            return;
          yield Object.freeze({
            schema: SCHEMA,
            kind: "event",
            source: "desktop-project",
            plugin: ref,
            observedAt,
            delivery: "polling",
            replay: false,
            event,
          });
        }
        previous = current;
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      controller.abort();
    }
  })();
}
