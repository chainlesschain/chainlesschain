import fs from "node:fs";
import path from "node:path";
import { VERSION } from "../../constants.js";
import { createProjectGoalConnection } from "../project-goal-connection.js";
import { collectGoalExtensions } from "./goal-extensions.js";
import { createGoalDraftRequest } from "@chainlesschain/session-core/goal-draft-request-contract";
import { digestBusinessObjectContent as digest } from "@chainlesschain/session-core/business-object-contract";
const HOST = Object.freeze({
  id: "cli",
  version: VERSION,
  capabilities: Object.freeze(["proposal:task.description.update"]),
});
function fail(code) {
  throw new Error(code);
}
export function readGoalDraftDescription(file) {
  const target = path.resolve(file),
    before = fs.lstatSync(target);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > 8192 ||
    before.nlink !== 1
  )
    fail("GOAL_DRAFT_DESCRIPTION_INVALID");
  const fd = fs.openSync(
    target,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fs.fstatSync(fd),
      raw = Buffer.alloc(8193),
      length = fs.readSync(fd, raw, 0, raw.length, 0),
      after = fs.fstatSync(fd),
      current = fs.lstatSync(target);
    if (
      length > 8192 ||
      [opened, after, current].some(
        (stat) =>
          stat.dev !== before.dev ||
          stat.ino !== before.ino ||
          stat.size !== before.size ||
          stat.mtimeMs !== before.mtimeMs ||
          stat.ctimeMs !== before.ctimeMs,
      )
    )
      fail("GOAL_DRAFT_DESCRIPTION_INVALID");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      raw.subarray(0, length),
    );
  } finally {
    fs.closeSync(fd);
  }
}
export async function exportCliGoalDraftRequest(id, options = {}) {
  options = Object.freeze({
    ...options,
    env: Object.freeze({ ...(options.env || process.env) }),
  });
  const cwd = path.resolve(options.cwd || process.cwd()),
    env = Object.freeze({ ...(options.env || process.env) });
  if (
    !options.connection ||
    !options.plugin ||
    !["user", "project", "local"].includes(options.scope) ||
    !options.descriptionFile ||
    !options.out
  )
    fail("GOAL_DRAFT_EXPORT_ARGUMENTS_REQUIRED");
  const connection = createProjectGoalConnection(options.connection),
    snapshot = await connection.read(id);
  if (
    options.expectedStore !== undefined &&
    options.expectedStore !== snapshot.goalRef.storeId
  )
    fail("CLI_GOAL_STORE_MISMATCH");
  const hostOptions = {
    cwd,
    env,
    host: HOST,
    managedSettingsFile: options.managedSettingsFile,
  };
  const admitted = () =>
    collectGoalExtensions(hostOptions).extensions.find(
      (entry) => entry.name === options.plugin && entry.scope === options.scope,
    );
  const plugin = admitted();
  if (
    !plugin ||
    !plugin.declaration.proposals.includes("task.description.update")
  )
    fail("GOAL_DRAFT_PLUGIN_NOT_ADMITTED");
  const request = createGoalDraftRequest({
    declaredPlugin: {
      name: plugin.name,
      scope: plugin.scope,
      version: plugin.version,
    },
    declarationDigest: digest(plugin.declaration),
    proposal: {
      type: "task.description.update",
      goalRef: snapshot.goalRef,
      sourceRef: options.source,
      requestId: options.requestId,
      title: options.title,
      description: readGoalDraftDescription(
        path.resolve(cwd, options.descriptionFile),
      ),
    },
  });
  const latest = await connection.read(id),
    current = admitted();
  if (
    !current ||
    digest(current) !== digest(plugin) ||
    latest.objective !== snapshot.objective ||
    latest.status !== snapshot.status ||
    digest(latest.goalRef) !== digest(snapshot.goalRef)
  )
    fail("GOAL_DRAFT_EXPORT_SOURCE_CHANGED");
  const file = path.resolve(cwd, options.out),
    fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(request));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return {
    schema: "chainlesschain.goal-draft-export/v1",
    state: "request-exported",
    goalRef: request.proposal.goalRef,
    declaredPlugin: request.declaredPlugin,
    requestId: request.proposal.requestId,
    contentDigest: request.contentDigest,
    file,
  };
}
