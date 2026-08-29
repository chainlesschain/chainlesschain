import events from "./settings-hook-events.cjs";
import { executeHooksV2Event } from "./hooks-v2-producers.js";

export const { withDeliveryId, partitionAsyncHooks } = events;

function canonicalContext(results = []) {
  const values = [];
  for (const entry of results) {
    if (entry?.status !== "success" || !entry.result) continue;
    const result = entry.result;
    const value =
      typeof result.additionalContext === "string"
        ? result.additionalContext
        : typeof result.raw === "string"
          ? result.raw
          : null;
    const text = value?.trim();
    if (text) values.push(text);
  }
  return values.length > 0 ? values.join("\n") : null;
}

export function aggregateContext(results = []) {
  return canonicalContext(results) || events.aggregateContext(results);
}

async function executeCanonicalSettingsEvent(
  settingsHooks,
  event,
  payload,
  { cwd, matchTarget, failClosed = false, supervisor, broker } = {},
) {
  const envelope = withDeliveryId(event, {
    ...payload,
    hook_event_name: event,
    cwd: cwd || payload.cwd || null,
  });
  return executeHooksV2Event(event, envelope, {
    settingsHooks,
    matchTarget: matchTarget || "",
    cwd: cwd || payload.cwd || process.cwd(),
    failClosed,
    asyncDispatcher:
      supervisor && typeof supervisor.dispatch === "function"
        ? (hook, context) =>
            supervisor.dispatch([hook.legacyHook || hook], context, {
              cwd: cwd || payload.cwd || process.cwd(),
              broker,
            })
        : null,
  });
}

export async function runUserPromptSubmitHooks(
  settingsHooks,
  { prompt, cwd, sessionId } = {},
) {
  const outcome = await executeCanonicalSettingsEvent(
    settingsHooks,
    "UserPromptSubmit",
    { prompt: String(prompt || ""), cwd, session_id: sessionId || null },
    { cwd, failClosed: true },
  );
  const result = {
    blocked: outcome.blocked || outcome.decision === "ask",
    additionalContext: canonicalContext(outcome.results),
  };
  const reason = outcome.blockingResult?.reason || null;
  const hook = outcome.results?.find((entry) =>
    ["block", "ask"].includes(entry.decision),
  )?.hookId;
  if (reason) result.reason = reason;
  if (hook) result.hook = hook;
  return result;
}

export async function runSessionStartHooks(
  settingsHooks,
  { source, cwd, sessionId } = {},
) {
  const outcome = await executeCanonicalSettingsEvent(
    settingsHooks,
    "SessionStart",
    {
      source: source || "startup",
      cwd,
      session_id: sessionId || null,
    },
    { cwd, matchTarget: source || "" },
  );
  return { additionalContext: canonicalContext(outcome.results) };
}

export async function runCwdChangedHooks(
  settingsHooks,
  { oldCwd, newCwd, cwd, sessionId } = {},
) {
  const targetCwd = newCwd || cwd;
  const outcome = await executeCanonicalSettingsEvent(
    settingsHooks,
    "CwdChanged",
    {
      old_cwd: oldCwd || null,
      cwd: targetCwd || null,
      session_id: sessionId || null,
    },
    { cwd: targetCwd, matchTarget: newCwd || "" },
  );
  return { additionalContext: canonicalContext(outcome.results) };
}

export async function runWorktreeCreateHooks(
  settingsHooks,
  { worktreePath, branch, baseSha, cwd, sessionId } = {},
) {
  const targetCwd = cwd || worktreePath;
  const outcome = await executeCanonicalSettingsEvent(
    settingsHooks,
    "WorktreeCreate",
    {
      worktree_path: worktreePath || null,
      branch: branch || null,
      base_sha: baseSha || null,
      cwd: targetCwd || null,
      session_id: sessionId || null,
    },
    { cwd: targetCwd, matchTarget: branch || "" },
  );
  return { additionalContext: canonicalContext(outcome.results) };
}

export async function runWorktreeRemoveHooks(
  settingsHooks,
  { worktreePath, branch, removed, reason, cwd, sessionId } = {},
) {
  const targetCwd = cwd || worktreePath;
  const outcome = await executeCanonicalSettingsEvent(
    settingsHooks,
    "WorktreeRemove",
    {
      worktree_path: worktreePath || null,
      branch: branch || null,
      removed: removed === true,
      reason: reason || null,
      cwd: targetCwd || null,
      session_id: sessionId || null,
    },
    { cwd: targetCwd, matchTarget: branch || "" },
  );
  return { additionalContext: canonicalContext(outcome.results) };
}

export async function runInstructionsLoadedHooks(
  settingsHooks,
  { files, cwd, sessionId } = {},
) {
  const list = Array.isArray(files) ? files : [];
  const outcome = await executeCanonicalSettingsEvent(
    settingsHooks,
    "InstructionsLoaded",
    {
      files: list.map((file) => ({
        path: file?.path || null,
        scope: file?.scope || null,
        truncated: file?.truncated === true,
      })),
      count: list.length,
      cwd: cwd || null,
      session_id: sessionId || null,
    },
    { cwd },
  );
  return { additionalContext: canonicalContext(outcome.results) };
}

export async function runObserveHooks(
  settingsHooks,
  event,
  payload = {},
  { cwd, matchTarget, traceId, parentId, supervisor, broker } = {},
) {
  const outcome = await executeCanonicalSettingsEvent(
    settingsHooks,
    event,
    {
      ...payload,
      ...(traceId ? { trace_id: traceId } : {}),
      ...(parentId ? { parent_id: parentId } : {}),
    },
    { cwd, matchTarget, supervisor, broker },
  );
  return {
    ...outcome,
    reason:
      outcome.blockingResult?.reason || outcome.blockingResult?.message || null,
    hook:
      outcome.results?.find((entry) =>
        ["block", "ask"].includes(entry.decision),
      )?.hookId || null,
  };
}

// Async definitions are selected and scheduled exactly once by the canonical
// runtime. This compatibility function prevents legacy callers from dispatching
// the same definition a second time.
export function dispatchAsyncHooks() {
  return [];
}

export default {
  withDeliveryId,
  aggregateContext,
  partitionAsyncHooks,
  runUserPromptSubmitHooks,
  runSessionStartHooks,
  runCwdChangedHooks,
  runWorktreeCreateHooks,
  runWorktreeRemoveHooks,
  runInstructionsLoadedHooks,
  runObserveHooks,
  dispatchAsyncHooks,
};
