#!/usr/bin/env node

import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SchedulerRuntime } from "../src/lib/scheduler-kernel/runtime.js";
import { openSchedulerStore } from "../src/lib/scheduler-kernel/store.js";

const DEFAULT_WORKER_ADAPTER_KIND = "scheduler.soak.local";
const PAUSE_MODES = new Set(["none", "before-execute", "after-execute"]);
const MAX_CONTROL_LINE_BYTES = 64 * 1024;

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is required`);
  }
  return value.trim();
}

function boundedInteger(value, label, { minimum, maximum }) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return number;
}

export function parseSchedulerSoakWorkerOptions(argv = []) {
  const options = {
    db: null,
    effectsDir: null,
    owner: null,
    workerId: null,
    jobKind: DEFAULT_WORKER_ADAPTER_KIND,
    pause: "none",
    once: false,
    leaseMs: 2_000,
    pollMs: 50,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new TypeError(`${argument} requires a value`);
      }
      return argv[index];
    };
    if (argument === "--db") options.db = next();
    else if (argument === "--effects-dir") options.effectsDir = next();
    else if (argument === "--owner") options.owner = next();
    else if (argument === "--worker-id") options.workerId = next();
    else if (argument === "--job-kind") options.jobKind = next();
    else if (argument === "--pause") options.pause = next();
    else if (argument === "--lease-ms") options.leaseMs = next();
    else if (argument === "--poll-ms") options.pollMs = next();
    else if (argument === "--once") options.once = true;
    else
      throw new TypeError(`unknown scheduler soak worker option: ${argument}`);
  }
  options.db = path.resolve(requiredText(options.db, "--db"));
  options.effectsDir = path.resolve(
    requiredText(options.effectsDir, "--effects-dir"),
  );
  options.owner = requiredText(options.owner, "--owner");
  options.workerId = requiredText(
    options.workerId ?? options.owner,
    "--worker-id",
  );
  options.jobKind = requiredText(options.jobKind, "--job-kind");
  if (!PAUSE_MODES.has(options.pause)) {
    throw new TypeError(
      "--pause must be one of none, before-execute, or after-execute",
    );
  }
  options.leaseMs = boundedInteger(options.leaseMs, "--lease-ms", {
    minimum: 1_000,
    maximum: 60_000,
  });
  options.pollMs = boundedInteger(options.pollMs, "--poll-ms", {
    minimum: 1,
    maximum: 10_000,
  });
  return options;
}

function sleep(delayMs, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", abort);
      resolve(completed);
    };
    const abort = () => {
      clearTimeout(timer);
      finish(false);
    };
    const timer = setTimeout(() => finish(true), delayMs);
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function safeError(error) {
  return {
    name: typeof error?.name === "string" ? error.name.slice(0, 128) : "Error",
    code: typeof error?.code === "string" ? error.code.slice(0, 128) : null,
    message:
      typeof error?.message === "string"
        ? error.message.slice(0, 2_000)
        : String(error).slice(0, 2_000),
  };
}

function occurrenceEvidence(occurrence) {
  if (!occurrence) return null;
  return {
    id: occurrence.id,
    jobId: occurrence.jobId,
    status: occurrence.status,
    attempt: occurrence.attempt,
    fence: occurrence.fence,
    leaseOwner: occurrence.leaseOwner,
    leaseExpiresAt: occurrence.leaseExpiresAt,
  };
}

export function createSchedulerSoakWorker({
  options,
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  openStore = openSchedulerStore,
  Runtime = SchedulerRuntime,
  now = Date.now,
  delay = sleep,
} = {}) {
  const normalized = parseSchedulerSoakWorkerOptions(
    Array.isArray(options)
      ? options
      : [
          "--db",
          options?.db,
          "--owner",
          options?.owner,
          "--worker-id",
          options?.workerId ?? options?.owner,
          "--effects-dir",
          options?.effectsDir,
          "--job-kind",
          options?.jobKind ?? DEFAULT_WORKER_ADAPTER_KIND,
          "--pause",
          options?.pause ?? "none",
          "--lease-ms",
          String(options?.leaseMs ?? 2_000),
          "--poll-ms",
          String(options?.pollMs ?? 50),
          ...(options?.once ? ["--once"] : []),
        ],
  );
  const abortController = new AbortController();
  const waiters = new Map();
  let sequence = 0;
  let stopped = false;
  let reader = null;
  let store = null;

  const emit = (event) =>
    new Promise((resolve, reject) => {
      const envelope = {
        ...event,
        pid: process.pid,
        timestamp: new Date(now()).toISOString(),
        workerId: normalized.workerId,
        owner: normalized.owner,
        sequence: ++sequence,
      };
      output.write(`${JSON.stringify(envelope)}\n`, (error) => {
        if (error) reject(error);
        else resolve(envelope);
      });
    });

  const release = (checkpoint) => {
    const waiter = waiters.get(checkpoint);
    if (!waiter) return false;
    waiters.delete(checkpoint);
    waiter.resolve();
    return true;
  };

  const releaseAll = () => {
    for (const [checkpoint, waiter] of waiters) {
      waiters.delete(checkpoint);
      waiter.resolve();
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    abortController.abort(new Error("scheduler soak worker stopped"));
    releaseAll();
  };

  const pauseAt = async (checkpoint, context, result = undefined) => {
    if (normalized.pause !== checkpoint) return;
    let resolveWaiter;
    const waiting = new Promise((resolve) => {
      resolveWaiter = resolve;
    });
    waiters.set(checkpoint, { resolve: resolveWaiter });
    await emit({
      type: "checkpoint",
      checkpoint,
      occurrence: occurrenceEvidence(context.occurrence),
      ...(result === undefined ? {} : { result }),
    });
    await waiting;
    if (!stopped) {
      await emit({
        type: "resumed",
        checkpoint,
        occurrence: occurrenceEvidence(context.occurrence),
      });
    }
  };

  const writeEffect = (context, result) => {
    fs.mkdirSync(normalized.effectsDir, { recursive: true, mode: 0o700 });
    const effectPath = path.join(
      normalized.effectsDir,
      `${context.occurrence.id}.json`,
    );
    const effect = {
      kind: "scheduler-soak-local-effect",
      occurrenceId: context.occurrence.id,
      jobId: context.job.id,
      jobRevision: context.job.revision,
      attempt: context.occurrence.attempt,
      fence: context.occurrence.fence,
      owner: normalized.owner,
      workerId: normalized.workerId,
      pid: process.pid,
      resultDigest: createHash("sha256")
        .update(JSON.stringify(result), "utf8")
        .digest("hex"),
    };
    let descriptor;
    try {
      descriptor = fs.openSync(effectPath, "wx", 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(effect)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (error?.code === "EEXIST") {
        const duplicate = new Error(
          `scheduler soak effect already exists: ${context.occurrence.id}`,
          { cause: error },
        );
        duplicate.code = "SCHEDULER_SOAK_DUPLICATE_EFFECT";
        duplicate.retryable = false;
        throw duplicate;
      }
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    return { path: effectPath, ...effect };
  };

  const adapter = {
    kind: normalized.jobKind,
    async execute(context) {
      await emit({
        type: "claimed",
        occurrence: occurrenceEvidence(context.occurrence),
      });
      await pauseAt("before-execute", context);
      if (context.signal.aborted) {
        const error = new Error("scheduler soak execution aborted");
        error.code = "SCHEDULER_SOAK_ABORTED";
        error.retryable = true;
        throw error;
      }
      const payload = context.occurrence.payload;
      const executionDelayMs = boundedInteger(
        payload?.executionDelayMs ?? 0,
        "occurrence.payload.executionDelayMs",
        { minimum: 0, maximum: 300_000 },
      );
      if (executionDelayMs > 0) {
        const completed = await delay(executionDelayMs, context.signal);
        if (!completed || context.signal.aborted) {
          const error = new Error("scheduler soak execution delay aborted");
          error.code = "SCHEDULER_SOAK_ABORTED";
          error.retryable = true;
          throw error;
        }
      }
      // Deliberately local and deterministic: no network, model, filesystem,
      // subprocess, or user-controlled side effect occurs at this boundary.
      const result = {
        kind: "scheduler-soak-local-result",
        occurrenceId: context.occurrence.id,
        jobRevision: context.job.revision,
        attempt: context.occurrence.attempt,
        fence: context.occurrence.fence,
        owner: normalized.owner,
        resultValue: payload?.resultValue ?? null,
      };
      const effect = writeEffect(context, result);
      await emit({
        type: "effect-written",
        occurrence: occurrenceEvidence(context.occurrence),
        effect,
      });
      await pauseAt("after-execute", context, { result, effect });
      return result;
    },
  };

  const onControl = async (line) => {
    if (Buffer.byteLength(line, "utf8") > MAX_CONTROL_LINE_BYTES) {
      throw new TypeError("scheduler soak control line exceeds 64 KiB");
    }
    const command = JSON.parse(line);
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new TypeError("scheduler soak control must be an object");
    }
    if (command.type === "resume") {
      const checkpoint = requiredText(command.checkpoint, "checkpoint");
      await emit({
        type: "control",
        command: "resume",
        checkpoint,
        accepted: release(checkpoint),
      });
      return;
    }
    if (command.type === "status") {
      await emit({
        type: "status",
        stopped,
        waitingAt: [...waiters.keys()],
      });
      return;
    }
    if (command.type === "stop") {
      stop();
      await emit({ type: "control", command: "stop", accepted: true });
      return;
    }
    throw new TypeError(`unsupported scheduler soak control: ${command.type}`);
  };

  const startControlReader = () => {
    reader = createInterface({ input, crlfDelay: Infinity });
    reader.on("line", (line) => {
      if (!line.trim()) return;
      void onControl(line).catch(async (error) => {
        await emit({ type: "control-error", error: safeError(error) }).catch(
          () => {},
        );
        stop();
      });
    });
    reader.on("close", stop);
  };

  const run = async () => {
    startControlReader();
    try {
      store = openStore({ file: normalized.db });
      const schema = {
        ...store.schemaInfo(),
        quickCheck: store.db.pragma("quick_check(1)", { simple: true }),
      };
      const runtime = new Runtime({
        store,
        adapters: [adapter],
        ownerId: normalized.owner,
        leaseMs: normalized.leaseMs,
        renewIntervalMs: Math.max(1, Math.floor(normalized.leaseMs / 3)),
        authorize: ({ job }) => ({
          allowed: job.kind === normalized.jobKind,
          reason:
            job.kind === normalized.jobKind
              ? "scheduler_soak_local_only"
              : "scheduler_soak_kind_denied",
        }),
      });
      await emit({
        type: "ready",
        db: normalized.db,
        effectsDir: normalized.effectsDir,
        schema,
        pause: normalized.pause,
        once: normalized.once,
        leaseMs: normalized.leaseMs,
        pollMs: normalized.pollMs,
        adapterKind: normalized.jobKind,
      });

      let consecutiveIdlePolls = 0;
      let lastIdleEventAt = 0;
      do {
        const result = await runtime.runNext({
          signal: abortController.signal,
          jobKind: normalized.jobKind,
        });
        if (result.status === "idle") {
          consecutiveIdlePolls += 1;
          const idleEventAt = now();
          if (
            consecutiveIdlePolls === 1 ||
            idleEventAt - lastIdleEventAt >= 5_000
          ) {
            await emit({
              type: "idle",
              consecutivePolls: consecutiveIdlePolls,
            });
            lastIdleEventAt = idleEventAt;
          }
          if (normalized.once) break;
          await delay(normalized.pollMs, abortController.signal);
          continue;
        }
        if (result.status === "aborted") break;
        consecutiveIdlePolls = 0;
        lastIdleEventAt = 0;
        await emit({
          type: "settled",
          status: result.status,
          occurrence: occurrenceEvidence(result.occurrence),
          result: result.result ?? null,
          error: result.error ?? null,
        });
        if (result.status !== "succeeded") {
          const error = new Error(
            `scheduler soak occurrence settled as ${result.status}`,
          );
          error.code =
            typeof result.error?.code === "string"
              ? result.error.code
              : "SCHEDULER_SOAK_SETTLEMENT_FAILED";
          throw error;
        }
        if (normalized.once) break;
      } while (!stopped);
      await emit({ type: "stopped", graceful: true });
      return 0;
    } catch (error) {
      await emit({ type: "fatal", error: safeError(error) }).catch(() => {});
      errorOutput.write(`${error?.stack || error}\n`);
      return 1;
    } finally {
      stop();
      reader?.close();
      store?.close();
    }
  };

  return { options: normalized, run, stop };
}

async function main() {
  let worker;
  try {
    worker = createSchedulerSoakWorker({
      options: process.argv.slice(2),
    });
    process.exitCode = await worker.run();
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

const invokedAsMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) await main();
