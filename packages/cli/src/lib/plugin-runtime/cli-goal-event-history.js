/** One acknowledged page at a time; checkpoints contain no credentials or bodies. */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { VERSION } from "../../constants.js";
import { managedSettingsPath } from "../settings-loader.cjs";
import { withFileLockAsync } from "../with-file-lock.js";
import { createProjectGoalConnection } from "../project-goal-connection.js";
import {
  collectGoalExtensions,
  projectGoalExtensionEvent,
} from "./goal-extensions.js";
import { parseGoalEventCursor } from "@chainlesschain/session-core/goal-evidence-contract";
const TYPES = ["risk.review.completed", "action.receipt.updated"];
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
export const _deps = { createProjectGoalConnection, projectGoalExtensionEvent };
const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
function readFile(file) {
  const entry = fs.lstatSync(file);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    entry.size > 8192
  )
    fail("GOAL_EVENT_CHECKPOINT_INVALID");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    if (!sameFile(entry, fs.fstatSync(fd)))
      fail("GOAL_EVENT_CHECKPOINT_CHANGED");
    const bytes = Buffer.alloc(entry.size + 1),
      n = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (
      n !== entry.size ||
      !sameFile(entry, fs.fstatSync(fd)) ||
      !sameFile(entry, fs.lstatSync(file))
    )
      fail("GOAL_EVENT_CHECKPOINT_CHANGED");
    const body = bytes.subarray(0, n).toString("utf8");
    return { record: JSON.parse(body), digest: hash(body) };
  } finally {
    fs.closeSync(fd);
  }
}
/** Publish must acknowledge flushed output; a crash before checkpoint commit replays. */
export function replayCliGoalEvents(id, raw = {}, publish) {
  const cwd = path.resolve(raw.cwd || process.cwd()),
    env = Object.freeze({ ...(raw.env || process.env) });
  const required = (value) => {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 4096 ||
      /[\u0000-\u001f]/u.test(value)
    )
      fail("GOAL_EVENT_ARGUMENT_REQUIRED");
    return value;
  };
  const connection = path.resolve(cwd, required(raw.connection)),
    checkpoint = path.resolve(cwd, required(raw.checkpoint));
  const name = required(raw.plugin),
    scope = raw.scope,
    expectedStore = raw.expectedStore;
  const signal = raw.signal;
  const checkpointMode = raw.checkpointMode ?? "auto";
  if (!["auto", "new", "resume"].includes(checkpointMode))
    fail("GOAL_EVENT_ARGUMENT_REQUIRED");
  if (
    !["user", "project", "local"].includes(scope) ||
    typeof publish !== "function"
  )
    fail("GOAL_EVENT_ARGUMENT_REQUIRED");
  const policyEnv = { ...env };
  if (policyEnv.CC_MANAGED_SETTINGS)
    policyEnv.CC_MANAGED_SETTINGS = path.resolve(
      cwd,
      required(policyEnv.CC_MANAGED_SETTINGS),
    );
  const policyFile = managedSettingsPath({
    env: policyEnv,
    managedSettingsFile:
      raw.managedSettingsFile === undefined
        ? undefined
        : path.resolve(cwd, required(raw.managedSettingsFile)),
  });
  const options = Object.freeze({
    cwd,
    env,
    managedSettingsFile: policyFile,
    host: Object.freeze({
      id: "cli",
      version: VERSION,
      capabilities: Object.freeze(TYPES.map((type) => `event:${type}`)),
    }),
  });
  return (async () => {
    const source = _deps.createProjectGoalConnection(connection);
    if (!source.eventHistory || typeof source.readEventPage !== "function")
      fail("GOAL_EVENT_HISTORY_CONNECTION_REQUIRED");
    const goalRef = source.goalRef;
    if (
      goalRef.id !== id ||
      (expectedStore !== undefined && expectedStore !== goalRef.storeId)
    )
      fail("CLI_GOAL_STORE_MISMATCH");
    const selected = collectGoalExtensions(options).extensions.find(
      (entry) =>
        entry.name === name &&
        entry.scope === scope &&
        entry.declaration.events.some((type) => TYPES.includes(type)),
    );
    if (!selected) fail("CLI_GOAL_EVENT_PLUGIN_UNAVAILABLE");
    const plugin = Object.freeze({
        name: selected.name,
        scope: selected.scope,
        version: selected.version,
      }),
      declarationDigest = hash(selected.declaration);
    function admission() {
      if (signal?.aborted) fail("GOAL_EVENT_REPLAY_ABORTED");
      const current = collectGoalExtensions(options).extensions.find(
        (entry) =>
          entry.name === name &&
          entry.scope === scope &&
          entry.version === plugin.version,
      );
      if (!current || hash(current.declaration) !== declarationDigest)
        fail("CLI_GOAL_EVENT_ADMISSION_CHANGED");
    }
    admission();
    const root = path.dirname(checkpoint),
      realRoot = fs.realpathSync(root),
      rootStat = fs.statSync(root);
    const checkRoot = () => {
      const stat = fs.statSync(root);
      if (
        fs.realpathSync(root) !== realRoot ||
        !stat.isDirectory() ||
        stat.dev !== rootStat.dev ||
        stat.ino !== rootStat.ino
      )
        fail("GOAL_EVENT_CHECKPOINT_CHANGED");
    };
    const binding = {
      schema: "chainlesschain.goal-event-checkpoint/v1",
      goalRef,
      plugin,
      declarationDigest,
    };
    return withFileLockAsync(
      checkpoint,
      async (lock) => {
        checkRoot();
        admission();
        const exists = fs.existsSync(checkpoint);
        if (checkpointMode === "new" && exists)
          fail("GOAL_EVENT_CHECKPOINT_EXISTS");
        if (checkpointMode === "resume" && !exists)
          fail("GOAL_EVENT_CHECKPOINT_MISSING");
        if (!fs.existsSync(checkpoint)) {
          const fd = fs.openSync(checkpoint, "wx", 0o600);
          try {
            fs.writeFileSync(fd, JSON.stringify({ ...binding, after: null }));
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
        }
        const initial = readFile(checkpoint),
          record = initial.record;
        if (
          !record ||
          Object.keys(record).sort().join() !==
            "after,declarationDigest,goalRef,plugin,schema" ||
          hash({ ...record, after: null }) !== hash({ ...binding, after: null })
        )
          fail("GOAL_EVENT_CHECKPOINT_BINDING_CONFLICT");
        if (record.after !== null) parseGoalEventCursor(record.after);
        const after = record.after ?? undefined;
        const page = await source.readEventPage(after, { signal });
        admission();
        const events = [];
        for (const entry of page.entries) {
          if (!selected.declaration.events.includes(entry.type)) continue;
          const summary =
            entry.type === "risk.review.completed"
              ? `Historical risk check ${entry.sourceId}: ${entry.state}; risk task count ${entry.riskTaskCount ?? "unknown"}. This does not prove current risk or goal completion.`
              : `Historical action receipt ${entry.sourceId}: ${entry.state} (${entry.actionType}). This does not prove goal completion.`;
          const event = await _deps.projectGoalExtensionEvent(
            plugin,
            { type: entry.type, goalRef },
            {
              ...options,
              authorize(context) {
                admission();
                return (
                  context.operation === "read-event" &&
                  context.type === entry.type &&
                  hash(context.goalRef) === hash(goalRef)
                );
              },
              readEvent() {
                return { summary, occurredAt: entry.recordedAt };
              },
            },
          );
          events.push({
            id: entry.id,
            sequence: entry.sequence,
            sourceRef: entry.sourceRef,
            recordedAt: entry.recordedAt,
            event,
          });
        }
        async function revalidate() {
          admission();
          checkRoot();
          if (readFile(checkpoint).digest !== initial.digest)
            fail("GOAL_EVENT_CHECKPOINT_CHANGED");
          const current = await source.readEventPage(after, { signal });
          if (
            hash(current.entries.slice(0, page.entries.length)) !==
              hash(page.entries) ||
            (page.nextCursor === null && current.nextCursor !== null) ||
            (page.nextCursor &&
              parseGoalEventCursor(page.nextCursor).epoch !==
                parseGoalEventCursor(current.nextCursor).epoch)
          )
            fail("GOAL_EVENT_HISTORY_CHANGED");
          admission();
        }
        await revalidate();
        const result = {
          schema: "chainlesschain.goal-extension-history/v1",
          goalRef,
          plugin,
          observedAt: new Date().toISOString(),
          delivery: "at-least-once",
          entries: events,
          scannedCount: page.entries.length,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          truncated: page.truncated,
          retainedFrom: page.retainedFrom,
          highWatermark: page.highWatermark,
        };
        if ((await publish(Object.freeze(result))) !== true)
          fail("GOAL_EVENT_OUTPUT_NOT_ACKNOWLEDGED");
        await revalidate();
        lock.assertOwnership();
        const temporary = `${checkpoint}.${randomUUID()}.tmp`;
        try {
          const fd = fs.openSync(temporary, "wx", 0o600);
          try {
            fs.writeFileSync(
              fd,
              JSON.stringify({ ...binding, after: page.nextCursor }),
            );
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
          checkRoot();
          lock.assertOwnership();
          if (readFile(checkpoint).digest !== initial.digest)
            fail("GOAL_EVENT_CHECKPOINT_CHANGED");
          fs.renameSync(temporary, checkpoint);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        return { checkpoint, hasMore: page.hasMore };
      },
      { failIfUnavailable: true, timeoutMs: 2000 },
    );
  })();
}
