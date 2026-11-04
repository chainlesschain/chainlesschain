/** Explicit, bounded polling of standalone goal status. No durable event log. */
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { cliGoalExtensionHost } from "./cli-goal-capabilities.js";
import { resolveConfigDataRoot } from "../paths.js";
import { managedSettingsPath } from "../settings-loader.cjs";
import { createCliGoalSnapshotReader } from "../cli-goal-source.js";
import {
  collectGoalExtensions,
  projectGoalExtensionEvent,
} from "./goal-extensions.js";

const TYPE = "goal.status.changed";
export const CLI_GOAL_EVENT_SCHEMA = "chainlesschain.goal-extension-stream/v1";
export const _deps = { projectGoalExtensionEvent };
const fail = (code) => {
  throw new Error(code);
};

/** Capture selection synchronously; retained iterators never change workspace. */
export function watchCliGoalExtensionEvents(id, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const env = Object.freeze({ ...(options.env || process.env) });
  const root = path.resolve(
    options.root ||
      path.join(resolveConfigDataRoot({ cwd, env }).path, "goals"),
  );
  const managedSettingsFile = managedSettingsPath({
    env,
    managedSettingsFile: options.managedSettingsFile,
  });
  const name = options.plugin,
    scope = options.scope;
  const expectedStore = options.expectedStore;
  const intervalMs = options.intervalMs ?? 1000;
  const durationMs = options.durationMs ?? 60000;
  const signal = options.signal;
  if (options.connection !== undefined) fail("CLI_GOAL_EVENTS_STANDALONE_ONLY");
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
  const host = cliGoalExtensionHost([`event:${TYPE}`]);
  const admission = Object.freeze({ cwd, env, managedSettingsFile, host });

  return (async function* () {
    if (signal?.aborted) return;
    const source = createCliGoalSnapshotReader(root);
    if (expectedStore !== undefined && expectedStore !== source.storeId)
      fail("CLI_GOAL_STORE_MISMATCH");
    const matches = collectGoalExtensions(admission).extensions.filter(
      (entry) =>
        entry.name === name &&
        (!scope || entry.scope === scope) &&
        entry.declaration.events.includes(TYPE),
    );
    if (matches.length !== 1) fail("CLI_GOAL_EVENT_PLUGIN_UNAVAILABLE");
    const plugin = matches[0];
    const ref = Object.freeze({
      name: plugin.name,
      scope: plugin.scope,
      version: plugin.version,
    });
    const declaration = JSON.stringify(plugin.declaration);
    function revalidatePlugin() {
      const current = collectGoalExtensions(admission).extensions.find(
        (entry) =>
          entry.name === ref.name &&
          entry.scope === ref.scope &&
          entry.version === ref.version,
      );
      if (!current || JSON.stringify(current.declaration) !== declaration)
        fail("CLI_GOAL_EVENT_ADMISSION_CHANGED");
    }
    const reference = (goal) =>
      Object.freeze({
        id: goal.id,
        storeId: goal.storeId,
        revision: goal.revision,
        controlGeneration: goal.controlGeneration,
      });
    let snapshot = source.read(id);
    source.revalidate(snapshot);
    revalidatePlugin();
    const deadline = performance.now() + durationMs;
    yield Object.freeze({
      schema: CLI_GOAL_EVENT_SCHEMA,
      kind: "ready",
      plugin: ref,
      goalRef: reference(snapshot.goal),
      observedAt: new Date().toISOString(),
      delivery: "polling",
      replay: false,
    });
    while (!signal?.aborted && performance.now() < deadline) {
      try {
        await delay(
          Math.min(intervalMs, Math.max(1, deadline - performance.now())),
          undefined,
          { signal },
        );
      } catch (error) {
        if (signal?.aborted && error.name === "AbortError") return;
        throw error;
      }
      if (signal?.aborted || performance.now() >= deadline) return;
      revalidatePlugin();
      const current = source.read(id);
      if (
        current.goal.revision < snapshot.goal.revision ||
        current.goal.controlGeneration < snapshot.goal.controlGeneration
      )
        fail("CLI_GOAL_EVENT_SOURCE_REGRESSED");
      if (current.digest === snapshot.digest) continue;
      const previousStatus = snapshot.goal.status;
      if (current.goal.status === previousStatus) {
        snapshot = current;
        continue;
      }
      const goalRef = reference(current.goal);
      // occurredAt is observation time: polling cannot establish mutation time.
      const observedAt = new Date().toISOString();
      const event = await _deps.projectGoalExtensionEvent(
        ref,
        { type: TYPE, goalRef },
        {
          ...admission,
          authorize(context) {
            if (
              context.operation !== "read-event" ||
              context.type !== TYPE ||
              JSON.stringify(context.goalRef) !== JSON.stringify(goalRef)
            )
              return false;
            source.revalidate(current);
            revalidatePlugin();
            return true;
          },
          readEvent() {
            source.revalidate(current);
            return {
              summary: `status: ${previousStatus} -> ${current.goal.status}`,
              occurredAt: observedAt,
            };
          },
        },
      );
      source.revalidate(current);
      revalidatePlugin();
      if (signal?.aborted || performance.now() >= deadline) return;
      snapshot = current;
      yield Object.freeze({
        schema: CLI_GOAL_EVENT_SCHEMA,
        kind: "event",
        plugin: ref,
        observedAt,
        delivery: "polling",
        replay: false,
        event,
      });
    }
  })();
}
