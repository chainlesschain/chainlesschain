/**
 * Crash-safe driver for one production DeliveryCoordinator action.
 *
 * The provider call deliberately sits between two short, synchronous locked
 * transactions:
 *
 *   lock -> request + persist pending effect -> unlock
 *        -> invoke provider exactly once
 *   lock -> verify exact pending binding + settle + persist -> unlock
 *
 * A provider exception, process crash, or settlement write failure therefore
 * leaves the durable snapshot pending. A later caller must reconcile that
 * exact effect; this runner never replays a pending provider operation.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DELIVERY_ACTION,
  projectDeliveryFlow,
  requestDeliveryAction,
  restoreDeliveryFlow,
  settleDeliveryAction,
} from "./delivery-coordinator.js";
import { withFileLock } from "./with-file-lock.js";

const ACTION_TO_METHOD = Object.freeze({
  [DELIVERY_ACTION.RUN_GATES]: "runGates",
  [DELIVERY_ACTION.RUN_PREVIEW]: "runPreview",
  [DELIVERY_ACTION.RUN_REVIEW]: "runReview",
  [DELIVERY_ACTION.APPLY_FIX]: "applyFix",
  [DELIVERY_ACTION.CREATE_PR]: "createPr",
  [DELIVERY_ACTION.REFRESH_CI]: "refreshCi",
  [DELIVERY_ACTION.PUBLISH_EVIDENCE]: "publishEvidence",
  [DELIVERY_ACTION.MERGE]: "merge",
  [DELIVERY_ACTION.ARCHIVE]: "archive",
});

function normalizeError(error) {
  if (error instanceof Error) return error;
  return new Error(String(error || "delivery provider failed"));
}

function attachPendingEffect(error, state, effect) {
  const failure = normalizeError(error);
  failure.deliveryState = state;
  failure.pendingEffect = effect;
  return failure;
}

function assertCallerExpectation(state, options) {
  if (options.expectedRevision != null) {
    const expected = Number(options.expectedRevision);
    if (!Number.isInteger(expected) || expected < 0) {
      throw new Error("expected revision must be a non-negative integer");
    }
    if (state.revision !== expected) {
      throw new Error(
        `stale delivery revision: expected ${expected}, found ${state.revision}`,
      );
    }
  }
  if (
    options.expectedStateDigest != null &&
    state.stateDigest !== String(options.expectedStateDigest)
  ) {
    throw new Error("stale delivery state digest");
  }
}

function assertSettlementBinding(current, requested, effect) {
  if (current.flowId !== requested.flowId) {
    throw new Error("stale delivery flow id before settlement");
  }
  if (current.revision !== requested.revision) {
    throw new Error(
      `stale delivery revision before settlement: expected ${requested.revision}, found ${current.revision}`,
    );
  }
  if (current.stateDigest !== requested.stateDigest) {
    throw new Error("stale delivery state digest before settlement");
  }
  if (!current.pendingEffect || current.pendingEffect.id !== effect.id) {
    throw new Error("stale delivery effect id before settlement");
  }
}

/** Read and integrity-check one delivery snapshot. */
export function readDeliveryProductionState(statePath, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  return restoreDeliveryFlow(
    JSON.parse(readFileSync(path.resolve(String(statePath)), "utf8")),
  );
}

/**
 * Durably and atomically replace a delivery snapshot with owner-only JSON
 * bytes (file fsync before rename; parent-directory fsync on POSIX).
 * The caller is responsible for holding the state lock.
 */
export function writeDeliveryProductionState(statePath, state, deps = {}) {
  const verified = restoreDeliveryFlow(state);
  const openSync = deps.openSync || fs.openSync;
  const writeFileSync = deps.writeFileSync || fs.writeFileSync;
  const fsyncSync = deps.fsyncSync || fs.fsyncSync;
  const closeSync = deps.closeSync || fs.closeSync;
  const renameSync = deps.renameSync || fs.renameSync;
  const rmSync = deps.rmSync || fs.rmSync;
  const uuid = deps.randomUUID || randomUUID;
  const platform = deps.platform || process.platform;
  const target = path.resolve(String(statePath));
  const temporary = `${target}.${process.pid}.${uuid()}.tmp`;
  let temporaryDescriptor = null;
  let directoryDescriptor = null;
  let renamed = false;
  try {
    temporaryDescriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(
      temporaryDescriptor,
      `${JSON.stringify(verified, null, 2)}\n`,
      "utf8",
    );
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = null;
    renameSync(temporary, target);
    renamed = true;
    // POSIX rename durability requires syncing the containing directory too.
    // Windows does not support opening a directory with fs.openSync("r").
    if (platform !== "win32") {
      directoryDescriptor = openSync(path.dirname(target), "r");
      fsyncSync(directoryDescriptor);
      closeSync(directoryDescriptor);
      directoryDescriptor = null;
    }
  } catch (error) {
    for (const descriptor of [temporaryDescriptor, directoryDescriptor]) {
      if (descriptor == null) continue;
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the authoritative write error.
      }
    }
    try {
      if (!renamed) rmSync(temporary, { force: true });
    } catch {
      // Preserve the authoritative write error.
    }
    throw error;
  }
  return verified;
}

function lockedTransaction(statePath, operation, deps) {
  const lock = deps.withFileLock || withFileLock;
  return lock(statePath, operation, {
    ...(deps.lockOptions || {}),
    failIfUnavailable: true,
  });
}

/**
 * Execute one available action through a production adapter.
 *
 * The adapter surface matches DeliveryCoordinator.execute(): each method gets
 * `(payload, { effect, state })`, where `state` is the requested projection.
 * Throws retain `pendingEffect` and `deliveryState` for explicit reconciliation.
 */
export async function runDeliveryProductionAction(options = {}, deps = {}) {
  const statePath = path.resolve(String(options.statePath || ""));
  if (!options.statePath) throw new Error("statePath is required");

  const method = ACTION_TO_METHOD[options.action];
  if (!method) {
    throw new Error(`unsupported delivery action: ${options.action}`);
  }
  const provider = options.adapter?.[method];
  if (typeof provider !== "function") {
    throw new Error(`delivery adapter does not implement ${method}`);
  }

  const readState =
    deps.readState || ((target) => readDeliveryProductionState(target, deps));
  const writeState =
    deps.writeState ||
    ((target, state) => writeDeliveryProductionState(target, state, deps));

  const requested = lockedTransaction(
    statePath,
    () => {
      const current = readState(statePath);
      assertCallerExpectation(current, options);
      if (current.pendingEffect) {
        throw new Error(
          `delivery effect ${current.pendingEffect.id} is already pending; reconcile it before another provider call`,
        );
      }
      const next = requestDeliveryAction(
        current,
        options.action,
        options.payload || {},
        { now: deps.now },
      );
      writeState(statePath, next);
      return next;
    },
    deps,
  );
  const effect = requested.pendingEffect;

  let result;
  try {
    result = await provider.call(options.adapter, effect.payload, {
      effect,
      state: projectDeliveryFlow(requested),
    });
  } catch (error) {
    throw attachPendingEffect(error, requested, effect);
  }

  try {
    return lockedTransaction(
      statePath,
      () => {
        const current = readState(statePath);
        assertSettlementBinding(current, requested, effect);
        const settled = settleDeliveryAction(current, effect.id, result, {
          now: deps.now,
        });
        writeState(statePath, settled);
        return settled;
      },
      deps,
    );
  } catch (error) {
    throw attachPendingEffect(error, requested, effect);
  }
}
