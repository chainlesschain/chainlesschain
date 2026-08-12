import { createHash } from "node:crypto";
import { normalizeRoutineDefinition } from "./routine-store.js";
import {
  canonicalJson,
  normalizeIdentifier,
} from "./scheduler-kernel/contract.js";

export const AUTOMATION_CENTER_ROUTINE_ACTIONS = Object.freeze([
  "run_now",
  "retry_failed",
  "pause",
  "resume",
  "disable",
  "delete",
  "edit",
]);

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value, domain), "utf8")
    .digest("hex")}`;
}

function boundedText(value, maximum = 400) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, maximum);
}

function definitionOf(routine) {
  return {
    name: routine.name,
    prompt: routine.prompt,
    trigger: routine.trigger,
  };
}

function catalogEntry(routine) {
  return {
    id: routine.id,
    definition: definitionOf(routine),
    enabled: routine.enabled === true,
    createdAt: Number(routine.createdAt) || 0,
  };
}

export function routineCatalogRevision(routinesOrMap) {
  const routines = Array.isArray(routinesOrMap)
    ? routinesOrMap
    : Object.values(routinesOrMap || {});
  return digest(
    "chainlesschain.automation-center.routine-catalog.v1",
    routines
      .map(catalogEntry)
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function action(id, available, reason, routineId, itemRevision) {
  const edit = id === "edit";
  return {
    id,
    available,
    reason: available ? null : reason,
    preview: available
      ? {
          executor: "cli",
          argv: [
            "automation",
            edit ? "center-routine-edit" : "center-routine-action",
            routineId,
            ...(edit ? [] : [id]),
            "--expected-revision",
            itemRevision,
            ...(edit ? ["--json-stdin"] : []),
            "--json",
          ],
          ...(edit ? { stdin: "json" } : {}),
          mutates: true,
        }
      : null,
  };
}

function projectTrigger(routine) {
  const trigger = routine.trigger;
  let scope = {};
  if (trigger.kind === "cron") scope = { cron: trigger.cron };
  else if (trigger.kind === "once") {
    scope = { at: new Date(trigger.at).toISOString() };
  } else if (trigger.kind === "github") {
    scope = { repo: trigger.repo, events: trigger.events || [] };
  } else {
    scope = { entryPoint: `cc routine trigger ${routine.id}` };
  }
  return {
    id: `routine:${routine.id}:${trigger.kind}`,
    type: trigger.kind,
    enabled: routine.enabled === true,
    scope,
    triggerCount: 0,
    lastTriggeredAt: routine.lastFiredAt
      ? new Date(routine.lastFiredAt).toISOString()
      : null,
  };
}

function projectRun(run) {
  return {
    id: run.runId,
    status: run.status === "ok" ? "success" : run.status,
    triggerType: boundedText(run.trigger, 80) || null,
    durationMs: Number(run.durationMs) || 0,
    startedAt: Number.isFinite(run.startedAt)
      ? new Date(run.startedAt).toISOString()
      : null,
    completedAt: Number.isFinite(run.endedAt)
      ? new Date(run.endedAt).toISOString()
      : null,
    error:
      run.status === "failed"
        ? boundedText(run.summary, 400) || "failed"
        : null,
  };
}

function scheduleOf(trigger) {
  if (trigger.kind === "cron") return trigger.cron;
  if (trigger.kind === "once") return new Date(trigger.at).toISOString();
  if (trigger.kind === "github") {
    return `${trigger.repo}${trigger.events?.length ? ` · ${trigger.events.join(", ")}` : ""}`;
  }
  return null;
}

export function projectAutomationCenterRoutine(
  store,
  routine,
  { historyLimit = 20 } = {},
) {
  const history = store
    .listRuns({ routineId: routine.id, limit: historyLimit })
    .map(projectRun);
  const content = {
    kind: "routine",
    id: routine.id,
    name: boundedText(routine.name, 200),
    description: `Routine · ${routine.trigger.kind}`,
    status: routine.enabled === true ? "active" : "paused",
    schedule: scheduleOf(routine.trigger),
    updatedAt: routine.lastFiredAt
      ? new Date(routine.lastFiredAt).toISOString()
      : new Date(routine.createdAt).toISOString(),
    definition: definitionOf(routine),
    triggers: [projectTrigger(routine)],
    history,
    security: {
      state: "snapshot_bound",
      ready: true,
      principalId: `routine:${routine.id}`,
      connectors: [],
      permissions: [{ permission: "agent.execute", allowed: true }],
      budget: null,
      issue: null,
    },
  };
  const revision = digest(
    "chainlesschain.automation-center.routine-item.v1",
    content,
  );
  const active = routine.enabled === true;
  return {
    ...content,
    revision,
    actions: [
      action("run_now", active, "routine is paused", routine.id, revision),
      action(
        "retry_failed",
        false,
        "routine failed-run retry is not yet unified",
        routine.id,
        revision,
      ),
      action(
        "pause",
        active,
        "routine is already paused",
        routine.id,
        revision,
      ),
      action(
        "resume",
        !active,
        "routine is already active",
        routine.id,
        revision,
      ),
      action(
        "disable",
        active,
        "routine is already disabled",
        routine.id,
        revision,
      ),
      action(
        "delete",
        !active,
        "disable the routine before deleting it",
        routine.id,
        revision,
      ),
      action("edit", true, null, routine.id, revision),
    ],
  };
}

export function buildRoutineCenterProjection(
  store,
  { limit = 100, historyLimit = 20 } = {},
) {
  const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const routines = store.list();
  const catalogRevision = routineCatalogRevision(routines);
  return {
    catalogRevision,
    createRoutine: {
      available: true,
      reason: null,
      preview: {
        executor: "cli",
        argv: [
          "automation",
          "center-routine-create",
          "--expected-revision",
          catalogRevision,
          "--json-stdin",
          "--json",
        ],
        stdin: "json",
        mutates: true,
      },
    },
    items: routines
      .slice(0, boundedLimit)
      .map((routine) =>
        projectAutomationCenterRoutine(store, routine, { historyLimit }),
      ),
  };
}

function assertExpectedRevision(store, routineId, expectedRevision) {
  return store.readIfRevision(
    routineId,
    expectedRevision,
    (routine) => projectAutomationCenterRoutine(store, routine).revision,
  );
}

export function createAutomationCenterRoutine(
  store,
  { expectedRevision, definition } = {},
) {
  const created = store.createIfRevision(
    expectedRevision,
    routineCatalogRevision,
    normalizeRoutineDefinition(definition),
  );
  return {
    schema: "chainlesschain.automation-center-routine-mutation/v1",
    schemaVersion: 1,
    authority: "cli",
    action: "create",
    routineId: created.id,
    previousRevision: expectedRevision,
    result: created,
  };
}

export function editAutomationCenterRoutine(
  store,
  { routineId, expectedRevision, definition } = {},
) {
  const id = normalizeIdentifier(routineId, "routineId");
  const normalized = normalizeRoutineDefinition(definition);
  const result = store.mutateIfRevision(
    id,
    expectedRevision,
    (routine) => projectAutomationCenterRoutine(store, routine).revision,
    (routine, map) => {
      const next = {
        ...routine,
        ...normalized,
        lastSeenGithubEventId: null,
      };
      map[id] = next;
      return next;
    },
  );
  return {
    schema: "chainlesschain.automation-center-routine-mutation/v1",
    schemaVersion: 1,
    authority: "cli",
    action: "edit",
    routineId: id,
    previousRevision: expectedRevision,
    result,
  };
}

export async function runAutomationCenterRoutineAction(
  store,
  { routineId, action: requestedAction, expectedRevision, triggerRoutine } = {},
) {
  const id = normalizeIdentifier(routineId, "routineId");
  if (
    !AUTOMATION_CENTER_ROUTINE_ACTIONS.includes(requestedAction) ||
    requestedAction === "edit"
  ) {
    throw new Error(`unsupported routine center action: ${requestedAction}`);
  }
  const snapshot = assertExpectedRevision(store, id, expectedRevision);
  const item = projectAutomationCenterRoutine(store, snapshot);
  const capability = item.actions.find((entry) => entry.id === requestedAction);
  if (!capability?.available) {
    throw new Error(capability?.reason || "routine action is unavailable");
  }

  let result;
  if (requestedAction === "run_now") {
    if (typeof triggerRoutine !== "function") {
      throw new Error("routine trigger executor is required");
    }
    result = await triggerRoutine(snapshot);
  } else {
    result = store.mutateIfRevision(
      id,
      expectedRevision,
      (routine) => projectAutomationCenterRoutine(store, routine).revision,
      (routine, map) => {
        if (requestedAction === "delete") {
          delete map[id];
          return { deleted: true };
        }
        const next = {
          ...routine,
          enabled: requestedAction === "resume",
        };
        map[id] = next;
        return next;
      },
    );
  }
  return {
    schema: "chainlesschain.automation-center-routine-action/v1",
    schemaVersion: 1,
    authority: "cli",
    routineId: id,
    action: requestedAction,
    previousRevision: expectedRevision,
    result,
  };
}
