import fs from "node:fs";
import path from "node:path";
import { VERSION } from "../../constants.js";
import { managedSettingsPath } from "../settings-loader.cjs";
import { createProjectGoalConnection } from "../project-goal-connection.js";
import {
  collectGoalExtensions,
  proposeGoalExtensionAction,
} from "./goal-extensions.js";
import { readGoalDraftDescription } from "./cli-goal-draft-request.js";
import { digestBusinessObjectContent as digest } from "@chainlesschain/session-core/business-object-contract";
import {
  ACCESS_SCHEMA,
  MAX_SUBMISSION_REFERENCE_BYTES,
  validateGoalDraftAccess,
  validateGoalDraftProposal,
  validateGoalDraftReceipt,
  validateGoalDraftSources,
  createGoalDraftSubmissionReference,
  validateGoalDraftSubmissionReference,
} from "@chainlesschain/session-core/goal-draft-connection-contract";

const HOST = Object.freeze({
  id: "cli",
  version: VERSION,
  capabilities: Object.freeze(["proposal:task.description.update"]),
});
export const CLI_GOAL_DRAFT_SUBMISSION_SCHEMA =
  "chainlesschain.goal-draft-submission/v1";
export const CLI_GOAL_DRAFT_SOURCES_SCHEMA =
  "chainlesschain.goal-draft-source-page/v1";
export const _deps = {
  createProjectGoalConnection,
  collectGoalExtensions,
  proposeGoalExtensionAction,
};
const same = (a, b) => digest(a) === digest(b);
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function required(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    fail("CLI_GOAL_DRAFT_ARGUMENTS_REQUIRED");
  return value;
}
function fixedOptions(raw) {
  const options = { ...raw },
    env = Object.freeze({ ...(options.env || process.env) });
  const cwd = path.resolve(options.cwd || process.cwd());
  required(options.plugin);
  if (!["user", "project", "local"].includes(options.scope))
    fail("CLI_GOAL_DRAFT_ARGUMENTS_REQUIRED");
  for (const key of [
    "connection",
    "record",
    "out",
    "descriptionFile",
    "managedSettingsFile",
  ])
    if (options[key] !== undefined)
      options[key] = path.resolve(cwd, required(options[key]));
  const policyEnv = { ...env };
  if (policyEnv.CC_MANAGED_SETTINGS)
    policyEnv.CC_MANAGED_SETTINGS = path.resolve(
      cwd,
      policyEnv.CC_MANAGED_SETTINGS,
    );
  return Object.freeze({
    ...options,
    cwd,
    env,
    managedSettingsFile: managedSettingsPath({
      env: policyEnv,
      managedSettingsFile: options.managedSettingsFile,
    }),
  });
}
function hostOptions(options) {
  return Object.freeze({
    cwd: options.cwd,
    env: options.env,
    managedSettingsFile: options.managedSettingsFile,
    host: HOST,
  });
}
function admitted(options, expected) {
  const entry = _deps
    .collectGoalExtensions(hostOptions(options))
    .extensions.find(
      (item) => item.name === options.plugin && item.scope === options.scope,
    );
  if (
    !entry ||
    !entry.declaration.proposals.includes("task.description.update")
  )
    fail("CLI_GOAL_DRAFT_NOT_ADMITTED");
  const access = validateGoalDraftAccess({
    schema: ACCESS_SCHEMA,
    plugin: { name: entry.name, scope: entry.scope, version: entry.version },
    declarationDigest: digest(entry.declaration),
  });
  if (expected && !same(access, expected))
    fail("CLI_GOAL_DRAFT_ADMISSION_CHANGED");
  return access;
}
function connected(id, options) {
  required(id);
  required(options.connection);
  const connection = _deps.createProjectGoalConnection(options.connection);
  if (
    connection.drafts !== true ||
    !["read", "sources", "receipt", "enqueue"].every(
      (key) => typeof connection[key] === "function",
    )
  )
    fail("CLI_GOAL_DRAFT_CONNECTION_REQUIRED");
  if (
    connection.goalRef.id !== id ||
    (options.expectedStore !== undefined &&
      options.expectedStore !== connection.goalRef.storeId)
  )
    fail("CLI_GOAL_STORE_MISMATCH");
  const access = admitted(options);
  if (
    !same(access.plugin, connection.plugin) ||
    access.declarationDigest !== connection.declarationDigest
  )
    fail("CLI_GOAL_DRAFT_CONNECTION_MISMATCH");
  return { connection, access };
}
function sameFile(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    !b.isSymbolicLink() &&
    b.nlink === 1 &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
function readReference(file) {
  const before = fs.lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > MAX_SUBMISSION_REFERENCE_BYTES
  )
    fail("CLI_GOAL_DRAFT_RECORD_INVALID");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    if (!sameFile(before, fs.fstatSync(fd)))
      fail("CLI_GOAL_DRAFT_RECORD_CHANGED");
    const bytes = Buffer.alloc(MAX_SUBMISSION_REFERENCE_BYTES + 1);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (
      length !== before.size ||
      !sameFile(before, fs.fstatSync(fd)) ||
      !sameFile(before, fs.lstatSync(file))
    )
      fail("CLI_GOAL_DRAFT_RECORD_CHANGED");
    const reference = validateGoalDraftSubmissionReference(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, length),
        ),
      ),
    );
    return {
      reference,
      verify() {
        if (!sameFile(before, fs.lstatSync(file)))
          fail("CLI_GOAL_DRAFT_RECORD_CHANGED");
      },
    };
  } finally {
    fs.closeSync(fd);
  }
}
function writeNew(file, value) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Persist the new directory entry as well on systems that support it.
  if (process.platform !== "win32") {
    const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }
}
function persistReference(file, expected) {
  let created = false;
  try {
    writeNew(file, expected);
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const saved = readReference(file);
  if (!same(saved.reference, expected)) fail("CLI_GOAL_DRAFT_RECORD_CONFLICT");
  return { ...saved, created };
}
function referenceFor(connection, access, requestId, inputDigest) {
  return createGoalDraftSubmissionReference({
    goalRef: connection.goalRef,
    ...Object.fromEntries(
      ["plugin", "declarationDigest"].map((key) => [key, access[key]]),
    ),
    grantRef: connection.grantRef,
    requestId,
    inputDigest,
  });
}
function outcome(reference, file, receipt) {
  return {
    schema: CLI_GOAL_DRAFT_SUBMISSION_SCHEMA,
    state: receipt?.state ?? "unknown",
    goalRef: reference.goalRef,
    plugin: reference.plugin,
    declarationDigest: reference.declarationDigest,
    grantRef: reference.grantRef,
    requestId: reference.requestId,
    inputDigest: reference.inputDigest,
    proposalId: receipt?.proposalId ?? null,
    record: file,
  };
}
async function queryReceipt(connection, saved, file) {
  saved.verify();
  try {
    const receipt = validateGoalDraftReceipt(
      await connection.receipt({
        requestId: saved.reference.requestId,
        inputDigest: saved.reference.inputDigest,
      }),
    );
    if (
      receipt.requestId !== saved.reference.requestId ||
      receipt.inputDigest !== saved.reference.inputDigest
    )
      fail("CLI_GOAL_DRAFT_RECEIPT_MISMATCH");
    return outcome(saved.reference, file, receipt);
  } catch {
    return outcome(saved.reference, file);
  }
}

/** Exports an identity label and declaration digest, never native authority. */
export async function exportCliGoalDraftAccess(raw = {}) {
  const options = fixedOptions(raw);
  required(options.out);
  const access = admitted(options);
  writeNew(options.out, access);
  return {
    schema: "chainlesschain.goal-draft-access-export/v1",
    state: "access-exported",
    plugin: access.plugin,
    declarationDigest: access.declarationDigest,
    file: options.out,
  };
}
export async function readCliGoalDraftSources(id, raw = {}) {
  const options = fixedOptions(raw),
    { connection, access } = connected(id, options);
  if (
    options.after !== undefined &&
    (typeof options.after !== "string" ||
      !/^goal-proposal-[a-f0-9]{64}$/u.test(options.after))
  )
    fail("CLI_GOAL_DRAFT_INVALID_CURSOR");
  const sources = validateGoalDraftSources(
    await connection.sources(options.after),
  );
  admitted(options, access);
  return {
    schema: CLI_GOAL_DRAFT_SOURCES_SCHEMA,
    goalRef: connection.goalRef,
    plugin: access.plugin,
    declarationDigest: access.declarationDigest,
    grantRef: connection.grantRef,
    sources,
  };
}
export async function sendCliGoalDraft(id, raw = {}) {
  const options = fixedOptions(raw);
  required(options.record);
  required(options.descriptionFile);
  const { connection, access } = connected(id, options);
  const proposal = validateGoalDraftProposal({
    type: "task.description.update",
    goalRef: connection.goalRef,
    sourceRef: options.source,
    requestId: options.requestId,
    title: options.title,
    description: readGoalDraftDescription(options.descriptionFile),
  });
  const reference = referenceFor(
    connection,
    access,
    proposal.requestId,
    digest(proposal),
  );
  const saved = persistReference(options.record, reference);
  // Existing durable identity is always reconciled. Even a not-found response
  // does not authorize this retry path to send another mutation automatically.
  if (!saved.created) return queryReceipt(connection, saved, options.record);
  let nativeReceipt;
  let dispatched = false;
  try {
    await _deps.proposeGoalExtensionAction(access.plugin, proposal, {
      ...hostOptions(options),
      async authorize(context) {
        if (
          context.operation !== "propose-action" ||
          !same(context.plugin, access.plugin) ||
          !same(context.goalRef, proposal.goalRef) ||
          context.requestId !== proposal.requestId ||
          context.sourceRef !== proposal.sourceRef ||
          context.type !== proposal.type
        )
          return false;
        saved.verify();
        const current = await connection.read(id);
        if (
          !same(current.goalRef, proposal.goalRef) ||
          current.status !== "active"
        )
          return false;
        admitted(options, access);
        saved.verify();
        return true;
      },
      async enqueueProposal(context) {
        const projected = validateGoalDraftProposal(
          Object.fromEntries(
            [
              "type",
              "goalRef",
              "sourceRef",
              "requestId",
              "title",
              "description",
            ].map((key) => [key, context[key]]),
          ),
        );
        if (
          !same(context.plugin, access.plugin) ||
          context.operation !== "propose-action" ||
          context.state !== "pending-confirmation" ||
          !same(projected, proposal)
        )
          fail("CLI_GOAL_DRAFT_CONTEXT_CHANGED");
        admitted(options, access);
        saved.verify();
        dispatched = true;
        const receipt = validateGoalDraftReceipt(
          await connection.enqueue(projected),
        );
        if (
          receipt.state !== "saved" ||
          receipt.requestId !== reference.requestId ||
          receipt.inputDigest !== reference.inputDigest
        )
          fail("CLI_GOAL_DRAFT_RECEIPT_MISMATCH");
        nativeReceipt = receipt;
        return {
          proposalId: receipt.proposalId,
          state: "pending-confirmation",
        };
      },
    });
    if (!nativeReceipt) fail("CLI_GOAL_DRAFT_RECEIPT_MISMATCH");
    // A verified saved receipt is not undone by a later local admission change.
    return outcome(reference, options.record, nativeReceipt);
  } catch (error) {
    if (nativeReceipt) return outcome(reference, options.record, nativeReceipt);
    if (dispatched || error.outcomeUnknown)
      return outcome(reference, options.record);
    throw error;
  }
}
export async function readCliGoalDraftReceipt(id, raw = {}) {
  const options = fixedOptions(raw);
  required(options.record);
  const { connection, access } = connected(id, options),
    saved = readReference(options.record);
  const expected = referenceFor(
    connection,
    access,
    saved.reference.requestId,
    saved.reference.inputDigest,
  );
  if (!same(expected, saved.reference)) fail("CLI_GOAL_DRAFT_RECORD_CONFLICT");
  return queryReceipt(connection, saved, options.record);
}
