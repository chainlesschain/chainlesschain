import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withFileLock } from "../with-file-lock.js";
import { writeSecurityStore } from "../durable-security-store.js";
import { ensurePrivateDirectory } from "../secure-fs.js";
import { performance } from "node:perf_hooks";
import {
  openRecoveryCgroup,
  validateRecoveryCgroup,
} from "./process-recovery-cgroup.js";

export const PROCESS_OWNERSHIP_PENDING = "BROKER_PROCESS_OWNERSHIP_PENDING";
export const PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE =
  "BROKER_PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE";
const SCHEMA = "chainlesschain.process-ownership-journal/v1";
const RECOVERY_SCHEMA = "chainlesschain.process-ownership-journal/v2";
const MAX_BYTES = 1024 * 1024;
const MAX_PENDING = 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function unavailable(cause) {
  const error = new Error(
    "Process ownership journal is unavailable; execution is denied",
    { cause },
  );
  error.code = PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE;
  error.executionStarted = false;
  error.recoveryRequired = true;
  return error;
}

function validate(state) {
  if (
    !state ||
    !(
      (state.schema === SCHEMA &&
        Object.keys(state).sort().join() === "pending,schema") ||
      (state.schema === RECOVERY_SCHEMA &&
        Object.keys(state).sort().join() === "pending,recoveries,schema")
    ) ||
    !Array.isArray(state.pending) ||
    state.pending.length > MAX_PENDING
  )
    throw new Error("Invalid ownership journal schema");
  const ids = new Set();
  for (const entry of state.pending) {
    if (
      !entry ||
      ![
        "executionId,ownerPid,token",
        ...(state.schema === RECOVERY_SCHEMA
          ? ["executionId,ownerPid,recovery,token"]
          : []),
      ].includes(Object.keys(entry).sort().join()) ||
      !UUID.test(entry.executionId) ||
      !UUID.test(entry.token) ||
      !Number.isSafeInteger(entry.ownerPid) ||
      entry.ownerPid < 1 ||
      ids.has(entry.executionId)
    )
      throw new Error("Invalid ownership journal entry");
    if (Object.hasOwn(entry, "recovery"))
      validateRecoveryCgroup(entry.recovery, entry.executionId);
    ids.add(entry.executionId);
  }
  if (state.schema === RECOVERY_SCHEMA) {
    if (
      !Array.isArray(state.recoveries) ||
      state.recoveries.length > MAX_PENDING
    )
      throw new Error("Invalid recovery audit inventory");
    for (const receipt of state.recoveries) {
      if (
        !receipt ||
        Object.keys(receipt).sort().join() !==
          "completedAt,executionId,group,killIssued,populated,token" ||
        !UUID.test(receipt.executionId) ||
        !UUID.test(receipt.token) ||
        receipt.killIssued !== true ||
        receipt.populated !== false ||
        !Number.isFinite(Date.parse(receipt.completedAt))
      )
        throw new Error("Invalid recovery audit receipt");
      validateRecoveryCgroup(receipt.group, receipt.executionId);
    }
  }
  return state;
}

function privateEntry(entry, directory) {
  return (
    (directory ? entry.isDirectory() : entry.isFile() && entry.nlink === 1) &&
    entry.uid === process.getuid() &&
    (entry.mode & 0o077) === 0
  );
}

/**
 * Linux cooperative restart fence. Uses the existing strict file lock and
 * atomic security-store writer; this is not a workspace lock or a sandbox.
 * Peers must wait for outstanding supervised launches to close. PID liveness,
 * age, owner death and reboot are never authorities to erase a pending launch.
 */
export class ProcessOwnershipJournal {
  #directory;
  #local = new Map();
  #fault = null;
  #initialized = false;

  constructor(directory) {
    if (process.platform !== "linux" || !path.isAbsolute(directory))
      throw new TypeError(
        "Linux ownership journal requires an absolute directory",
      );
    this.#directory = path.resolve(directory);
  }

  #withDirectory(create, operation) {
    let descriptor;
    try {
      let before;
      try {
        before = fs.lstatSync(this.#directory);
      } catch (error) {
        if (error.code !== "ENOENT" || this.#initialized) throw error;
        if (!create) return operation(null);
        ensurePrivateDirectory(this.#directory, { failIfUnavailable: true });
        // Publish the new authority directory before admitting its first launch.
        const parent = fs.openSync(
          path.dirname(this.#directory),
          fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
        );
        try {
          fs.fsyncSync(parent);
        } finally {
          fs.closeSync(parent);
        }
        before = fs.lstatSync(this.#directory);
      }
      if (!privateEntry(before, true))
        throw new Error("Unsafe ownership directory");
      if (fs.realpathSync(this.#directory) !== this.#directory)
        throw new Error("Ownership directory contains a link");
      descriptor = fs.openSync(
        this.#directory,
        fs.constants.O_RDONLY |
          fs.constants.O_DIRECTORY |
          fs.constants.O_NOFOLLOW,
      );
      const opened = fs.fstatSync(descriptor);
      if (
        before.dev !== opened.dev ||
        before.ino !== opened.ino ||
        !privateEntry(opened, true)
      )
        throw new Error("Ownership directory changed");
      const result = operation(`/proc/self/fd/${descriptor}/journal.json`);
      const after = fs.lstatSync(this.#directory);
      if (
        after.dev !== opened.dev ||
        after.ino !== opened.ino ||
        !privateEntry(after, true)
      )
        throw new Error("Ownership directory replaced");
      return result;
    } catch (error) {
      if (error.code === PROCESS_OWNERSHIP_PENDING) throw error;
      this.#fault = unavailable(error);
      throw this.#fault;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #read(file) {
    if (file === null) return { schema: SCHEMA, pending: [] };
    let descriptor;
    try {
      try {
        descriptor = fs.openSync(
          file,
          fs.constants.O_RDONLY |
            fs.constants.O_NOFOLLOW |
            fs.constants.O_NONBLOCK,
        );
      } catch (error) {
        if (error.code === "ENOENT" && !this.#initialized)
          return { schema: SCHEMA, pending: [] };
        throw error;
      }
      const before = fs.fstatSync(descriptor);
      if (!privateEntry(before, false) || before.size > MAX_BYTES)
        throw new Error("Unsafe ownership journal");
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(
          descriptor,
          bytes,
          length,
          bytes.length - length,
          null,
        );
        if (count === 0) break;
        length += count;
      }
      const after = fs.fstatSync(descriptor);
      if (
        length !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error("Ownership journal changed during read");
      const state = validate(
        JSON.parse(bytes.subarray(0, length).toString("utf8")),
      );
      this.#initialized = true;
      return state;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #assertState(state) {
    const blocked = state.pending.filter(
      (entry) => this.#local.get(entry.executionId)?.token !== entry.token,
    );
    if (blocked.length) {
      const error = new Error(
        "Process ownership is pending in another runtime; confirmed cleanup is required before execution",
      );
      error.code = PROCESS_OWNERSHIP_PENDING;
      error.executionStarted = false;
      error.recoveryRequired = true;
      throw error;
    }
    // Removal/replacement of our admitted record must not make this process
    // forget a live launch. Cross-restart deletion of the whole anchor is
    // outside this cooperative same-user persistence boundary.
    for (const [id, local] of this.#local) {
      if (
        !state.pending.some(
          (entry) => entry.executionId === id && entry.token === local.token,
        )
      )
        throw new Error("Admitted ownership record disappeared");
    }
  }

  #write(file, state, label = "Process ownership") {
    validate(state);
    if (Buffer.byteLength(`${JSON.stringify(state, null, 2)}\n`) > MAX_BYTES)
      throw new Error("Ownership journal byte capacity is exhausted");
    writeSecurityStore(file, label, state);
  }

  assertAvailable() {
    if (this.#fault) throw this.#fault;
    this.#withDirectory(false, (file) => this.#assertState(this.#read(file)));
  }

  inspect() {
    if (this.#fault) throw this.#fault;
    return this.#withDirectory(false, (file) => {
      const state = this.#read(file);
      return {
        pendingExecutionIds: state.pending.map((entry) => entry.executionId),
        recoverableExecutionIds: state.pending
          .filter((entry) => entry.recovery)
          .map((entry) => entry.executionId),
        blocked: state.pending.some(
          (entry) => this.#local.get(entry.executionId)?.token !== entry.token,
        ),
      };
    });
  }

  prepare(executionId, recovery = null) {
    if (!UUID.test(executionId))
      throw new TypeError("Invalid ownership execution id");
    if (this.#fault) throw this.#fault;
    if (recovery) validateRecoveryCgroup(recovery, executionId);
    const entry = {
      executionId,
      ownerPid: process.pid,
      token: randomUUID(),
      ...(recovery ? { recovery: { ...recovery } } : {}),
    };
    this.#withDirectory(true, (file) =>
      withFileLock(
        file,
        () => {
          const state = this.#read(file);
          this.#assertState(state);
          if (recovery && state.schema === SCHEMA) {
            state.schema = RECOVERY_SCHEMA;
            state.recoveries = [];
          }
          if (
            state.pending.length >= MAX_PENDING ||
            state.pending.some((item) => item.executionId === executionId)
          )
            throw new Error("Ownership journal admission limit");
          state.pending.push(entry);
          this.#write(file, state);
          this.#initialized = true;
          this.#local.set(executionId, entry);
        },
        { failIfUnavailable: true, timeoutMs: 2000 },
      ),
    );
    let settled = false;
    let retained = false;
    return Object.freeze({
      retain: () => {
        retained = true;
        this.#local.delete(executionId);
      },
      // Broker calls this only before entering native spawn or after its
      // authentic child close fence. No public reset/reclaim-by-PID endpoint.
      settle: () => {
        if (settled) return;
        if (retained)
          throw unavailable(
            new Error("Retained ownership cannot be settled without recovery"),
          );
        this.#withDirectory(false, (file) =>
          withFileLock(
            file,
            () => {
              const state = this.#read(file);
              if (
                !state.pending.some(
                  (item) =>
                    item.executionId === executionId &&
                    item.token === entry.token,
                )
              )
                throw new Error("Ownership settlement lost its record");
              state.pending = state.pending.filter(
                (item) => item.executionId !== executionId,
              );
              this.#write(file, state);
              this.#local.delete(executionId);
              settled = true;
            },
            { failIfUnavailable: true, timeoutMs: 2000 },
          ),
        );
      },
    });
  }

  /** Explicitly cancel an orphaned, identity-bound cgroup. Old PID-only records
   * remain quarantined. Neither process death nor age is a cleanup authority.
   */
  async recover(executionId, { timeoutMs = 5000, pollMs = 10 } = {}) {
    if (
      !UUID.test(executionId) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 30000 ||
      !Number.isSafeInteger(pollMs) ||
      pollMs < 1 ||
      pollMs > 1000
    )
      throw new TypeError("Invalid process recovery request");
    if (this.#fault) throw this.#fault;
    if (this.#local.has(executionId))
      throw unavailable(
        new Error(
          "A locally owned live launch must use its normal cancellation fence",
        ),
      );
    const entry = this.#withDirectory(false, (file) => {
      const state = this.#read(file);
      const found = state.pending.find(
        (item) => item.executionId === executionId,
      );
      if (!found?.recovery) {
        const error = new Error(
          "This pending execution has no recoverable kernel group identity",
        );
        error.code = PROCESS_OWNERSHIP_PENDING;
        error.recoveryRequired = true;
        throw error;
      }
      if (state.recoveries.length >= MAX_PENDING)
        throw new Error("Recovery audit capacity is exhausted");
      return { ...found, recovery: { ...found.recovery } };
    });
    const group = openRecoveryCgroup(entry.recovery, executionId);
    let settled = false;
    try {
      group.kill();
      const deadline = performance.now() + timeoutMs;
      while (group.populated()) {
        if (performance.now() >= deadline) {
          const error = new Error(
            "Recovered process group has not reached its empty kernel fence",
          );
          error.code = PROCESS_OWNERSHIP_PENDING;
          error.recoveryRequired = true;
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      const receipt = {
        executionId,
        token: entry.token,
        group: entry.recovery,
        killIssued: true,
        populated: false,
        completedAt: new Date().toISOString(),
      };
      this.#withDirectory(false, (file) =>
        withFileLock(
          file,
          () => {
            const state = this.#read(file);
            const current = state.pending.find(
              (item) => item.executionId === executionId,
            );
            if (
              !current ||
              current.token !== entry.token ||
              JSON.stringify(current.recovery) !==
                JSON.stringify(entry.recovery)
            )
              throw new Error("Ownership recovery lost its original record");
            if (state.recoveries.length >= MAX_PENDING)
              throw new Error("Recovery audit capacity is exhausted");
            // Check the kernel fence again while committing the durable receipt.
            group.confirmEmpty();
            state.pending = state.pending.filter(
              (item) => item.executionId !== executionId,
            );
            state.recoveries.push(receipt);
            this.#write(file, state, "Process ownership recovery");
            settled = true;
          },
          { failIfUnavailable: true, timeoutMs: 2000 },
        ),
      );
      return { ...receipt, cleanupConfirmed: true, executionResumed: false };
    } finally {
      // Publish settlement before removing the empty group. If journal IO
      // fails, its kernel identity remains available for a safe retry.
      try {
        group.close({ remove: settled });
      } catch {
        group.close(); /* Empty directory leftovers never certify a run. */
      }
    }
  }
}
