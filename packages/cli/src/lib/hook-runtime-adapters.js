import crypto from "node:crypto";
import settingsHookLoader from "./settings-hooks.cjs";
import {
  HOOK_EXECUTION_MODE,
  HOOK_PRIORITY,
  normalizeHookPriority,
  normalizeHookTimeoutMs,
  stableStringify,
} from "./hook-runtime-contract.js";
import { computeHookDefinitionDigest } from "./hook-trust.js";

const { collectHooks, compileMatcher } = settingsHookLoader;

function adapterId(prefix, value) {
  return `${prefix}:${crypto
    .createHash("sha256")
    .update(stableStringify(value), "utf8")
    .digest("hex")}`;
}

function settingsAuthority(authoritySource = {}) {
  const scope =
    authoritySource.scope ||
    (authoritySource.kind === "plugin"
      ? "plugin"
      : authoritySource.sourceFile
        ? "project"
        : "explicit");
  return Object.freeze({
    kind: authoritySource.kind || "settings",
    sourceFile: authoritySource.sourceFile || null,
    digest: authoritySource.digest || null,
    scope,
    requiresConsent: scope === "project",
  });
}

export function adaptSettingsHookDefinitions(
  settingsHooks,
  event,
  matchTarget = "",
  { cwd = process.cwd() } = {},
) {
  const authorityErrors = settingsHooks?._authorityErrors;
  if (Array.isArray(authorityErrors) && authorityErrors.length > 0) {
    const error = new Error(
      "Settings Hook authority could not be loaded safely",
    );
    error.code = authorityErrors[0]?.code || "CC_HOOK_AUTHORITY_INVALID";
    error.authorityErrors = authorityErrors;
    throw error;
  }
  return collectHooks(settingsHooks, event, matchTarget).map((hook, index) => {
    const authority = settingsAuthority(hook.authoritySource);
    const identity = {
      event,
      command: hook.command,
      shell: hook.shell ?? true,
      authority,
      index,
    };
    const definition = {
      id: adapterId("settings", identity),
      event,
      type: "command",
      command: hook.command,
      shell: hook.shell == null ? true : hook.shell,
      cwd,
      priority: normalizeHookPriority(hook.priority, HOOK_PRIORITY.NORMAL),
      timeoutMs: normalizeHookTimeoutMs(
        hook.timeout == null ? undefined : Number(hook.timeout) * 1000,
      ),
      executionMode:
        hook.async === true
          ? HOOK_EXECUTION_MODE.ASYNC
          : HOOK_EXECUTION_MODE.BLOCKING,
      asyncRewake: hook.asyncRewake === true,
      legacyPayload: true,
      legacyAdapter: true,
      legacyHook: hook,
      origin: hook.origin || "settings",
      authority,
      environmentAllowlist:
        hook.environmentAllowlist || hook.envAllowlist || undefined,
      sandboxPolicy: hook.sandboxPolicy,
      requiredBoundaries: hook.requiredBoundaries,
      pluginId: hook.pluginId || null,
      pluginVersion: hook.pluginVersion || null,
      pluginSource: hook.pluginSource || null,
      failureMode: "fail-closed",
    };
    definition.definitionDigest = computeHookDefinitionDigest(definition);
    return Object.freeze(definition);
  });
}

function databaseMatchTarget(context, event) {
  return (
    context.target ||
    context.channel ||
    context.tool_name ||
    context.tool ||
    context.file ||
    event
  );
}

export function readDatabaseHookRows(db, event) {
  if (!db || typeof db.prepare !== "function") return [];
  return db
    .prepare(
      "SELECT * FROM hooks WHERE event = ? AND enabled = 1 ORDER BY priority ASC, id ASC",
    )
    .all(event);
}

function databaseReadFailureDefinition(event) {
  const authority = Object.freeze({
    kind: "database",
    scope: "explicit",
    subject: "database:hook-observer",
    requiresConsent: false,
  });
  const definition = {
    id: `database:adapter-read-failure:${event}`,
    event,
    type: "js",
    handler() {
      const error = new Error(
        "Database Hook observer source could not be read",
      );
      error.code = "CC_HOOK_DATABASE_READ_FAILED";
      throw error;
    },
    priority: HOOK_PRIORITY.NORMAL,
    timeoutMs: normalizeHookTimeoutMs(),
    executionMode: HOOK_EXECUTION_MODE.BLOCKING,
    origin: "database",
    authority,
    failureMode: "ignore",
    observeOnly: true,
    databaseHookName: "database-hook-observer",
  };
  definition.definitionDigest = computeHookDefinitionDigest(definition);
  return Object.freeze(definition);
}

export function adaptDatabaseHookDefinitions(db, event, context = {}) {
  const target = databaseMatchTarget(context, event);
  const definitions = [];
  let rows;
  try {
    rows = readDatabaseHookRows(db, event);
  } catch {
    // Database hooks are a legacy, observe-only source. A missing table or an
    // unavailable optional database must remain visible in the canonical
    // audit/event stream, but it cannot acquire decision authority merely by
    // failing to load.
    return [databaseReadFailureDefinition(event)];
  }
  for (const row of rows) {
    if (row.matcher && !compileMatcher(row.matcher)(target)) continue;
    const commandBacked = new Set(["command", "script"]).has(row.type);
    const authority = Object.freeze({
      kind: "database",
      scope: "explicit",
      subject: `database:${row.id}`,
      requiresConsent: false,
    });
    const definition = {
      id: `database:${row.id}`,
      event,
      type: commandBacked ? "command" : "js",
      ...(commandBacked
        ? { command: row.handler || "", shell: true }
        : { handler: () => null }),
      priority: normalizeHookPriority(row.priority, HOOK_PRIORITY.NORMAL),
      timeoutMs: normalizeHookTimeoutMs(row.timeout),
      executionMode:
        row.type === "async"
          ? HOOK_EXECUTION_MODE.ASYNC
          : HOOK_EXECUTION_MODE.BLOCKING,
      legacyPayload: true,
      legacyAdapter: true,
      origin: "database",
      authority,
      failureMode: "ignore",
      observeOnly: true,
      databaseHookId: row.id,
      databaseHookName: row.name,
      recordResult(record) {
        const success = record?.status === "success";
        const executionTime = Math.max(0, Number(record?.durationMs) || 0);
        const current = db
          .prepare(
            "SELECT execution_count, error_count, total_execution_time FROM hooks WHERE id = ?",
          )
          .get(row.id);
        if (!current) return;
        db.prepare(
          `UPDATE hooks
             SET execution_count = ?,
                 error_count = ?,
                 total_execution_time = ?,
                 updated_at = datetime('now')
           WHERE id = ?`,
        ).run(
          (current.execution_count || 0) + 1,
          (current.error_count || 0) + (success ? 0 : 1),
          (current.total_execution_time || 0) + executionTime,
          row.id,
        );
      },
    };
    definition.definitionDigest = computeHookDefinitionDigest(definition);
    definitions.push(Object.freeze(definition));
  }
  return definitions;
}

export function collectCanonicalAdapterHooks(
  event,
  context,
  { settingsHooks, hookDb, matchTarget, cwd } = {},
) {
  return [
    ...adaptSettingsHookDefinitions(settingsHooks, event, matchTarget, { cwd }),
    ...adaptDatabaseHookDefinitions(hookDb, event, context),
  ];
}
