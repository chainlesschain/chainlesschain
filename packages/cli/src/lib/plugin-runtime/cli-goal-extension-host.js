/** Explicit goal panels from standalone files or a short-lived desktop read lease. */
import path from "node:path";
import { createHash } from "node:crypto";
import { VERSION } from "../../constants.js";
import { resolveConfigDataRoot } from "../paths.js";
import { managedSettingsPath } from "../settings-loader.cjs";
import { createCliGoalSnapshotReader } from "../cli-goal-source.js";
import { createProjectGoalConnection } from "../project-goal-connection.js";
import { formatGoalEvidenceProjection } from "@chainlesschain/session-core/goal-evidence-contract";
import {
  collectGoalExtensions,
  projectGoalExtensionPanel,
} from "./goal-extensions.js";

export const CLI_GOAL_PANEL_SCHEMA = "chainlesschain.goal-extension-panels.v1";
export const CLI_GOAL_EXTENSION_HOST = Object.freeze({
  id: "cli",
  version: VERSION,
  capabilities: Object.freeze(["panel:goal.summary"]),
});
export const _deps = { collectGoalExtensions, projectGoalExtensionPanel };

function fail(code) {
  throw new Error(code);
}
function digest(record) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}
/** Explicit user read; all source/plugin revalidation completes before return. */
export async function readCliGoalExtensionPanels(id, options = {}) {
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
  const pluginName = options.plugin;
  const scope = options.scope;
  if (scope !== undefined && !["user", "project", "local"].includes(scope))
    fail("CLI_GOAL_INVALID_PLUGIN_SCOPE");
  if (
    pluginName !== undefined &&
    (typeof pluginName !== "string" || !pluginName || pluginName.length > 256)
  )
    fail("CLI_GOAL_INVALID_PLUGIN_NAME");
  const connection =
    options.connection !== undefined
      ? createProjectGoalConnection(options.connection)
      : null;
  const source = connection
    ? { storeId: connection.goalRef.storeId }
    : createCliGoalSnapshotReader(root);
  if (
    options.expectedStore !== undefined &&
    options.expectedStore !== source.storeId
  )
    fail("CLI_GOAL_STORE_MISMATCH");
  const remote = connection ? await connection.read(id) : null;
  const snapshot = connection ? null : source.read(id);
  const goal = remote
    ? { ...remote.goalRef, objective: remote.objective, status: remote.status }
    : snapshot.goal;
  const goalRef = Object.freeze({
    id: goal.id,
    storeId: goal.storeId,
    revision: goal.revision,
    controlGeneration: goal.controlGeneration,
  });
  const currentGoal = async () => {
    if (!connection) return source.revalidate(snapshot);
    const latest = await connection.read(id);
    if (
      latest.objective !== goal.objective ||
      latest.status !== goal.status ||
      (connection.evidence &&
        digest({ risk: latest.risk, receipts: latest.receipts }) !==
          digest({ risk: remote.risk, receipts: remote.receipts }))
    )
      fail("CLI_GOAL_CONNECTION_CHANGED");
    return {
      ...latest.goalRef,
      objective: latest.objective,
      status: latest.status,
      ...(connection.evidence
        ? { risk: latest.risk, receipts: latest.receipts }
        : {}),
    };
  };
  const hostOptions = Object.freeze({
    cwd,
    env,
    managedSettingsFile,
    host: connection?.evidence
      ? Object.freeze({
          ...CLI_GOAL_EXTENSION_HOST,
          capabilities: Object.freeze([
            "panel:goal.summary",
            "panel:goal.evidence",
          ]),
        })
      : CLI_GOAL_EXTENSION_HOST,
    async authorize(context) {
      if (
        context.operation !== "read-panel" ||
        context.goalRef.id !== id ||
        context.goalRef.storeId !== source.storeId ||
        context.goalRef.revision !== goalRef.revision ||
        context.goalRef.controlGeneration !== goalRef.controlGeneration
      )
        return false;
      await currentGoal();
      return true;
    },
    async readPanel(context) {
      if (
        ![
          "goal.summary",
          ...(connection?.evidence ? ["goal.evidence"] : []),
        ].includes(context.panel.slot) ||
        context.panel.fields.some(
          (field) =>
            ![
              "objective",
              "status",
              ...(connection?.evidence && context.panel.slot === "goal.evidence"
                ? ["riskSummary", "receiptSummary"]
                : []),
            ].includes(field),
        )
      )
        fail("CLI_GOAL_PANEL_FIELDS_UNSUPPORTED");
      const current = await currentGoal();
      const objective =
        current.objective.length > 4096
          ? `${current.objective.slice(0, 4075)}… [truncated]`
          : current.objective;
      return {
        objective,
        status: current.status,
        ...(connection?.evidence && context.panel.slot === "goal.evidence"
          ? formatGoalEvidenceProjection({
              risk: current.risk,
              receipts: current.receipts,
            })
          : {}),
      };
    },
  });
  const selected = (entry) =>
    (!pluginName || entry.name === pluginName) &&
    (!scope || entry.scope === scope);
  const initial = _deps.collectGoalExtensions(hostOptions);
  const plugins = initial.extensions.filter(selected);
  const dropped = initial.dropped.filter(
    (entry) => !entry.name || selected(entry),
  );
  if (plugins.length > 32) fail("CLI_GOAL_PANEL_LIMIT_EXCEEDED");
  let panels = [];
  for (const plugin of plugins) {
    const ref = {
      name: plugin.name,
      scope: plugin.scope,
      version: plugin.version,
    };
    const projected = [];
    try {
      for (const panel of plugin.declaration.panels) {
        projected.push({
          plugin: ref,
          ...(await _deps.projectGoalExtensionPanel(
            ref,
            { panelId: panel.id, goalRef },
            hostOptions,
          )),
        });
      }
      panels.push(...projected);
    } catch {
      dropped.push({
        name: plugin.name,
        scope: plugin.scope,
        reason: "panel_unavailable",
      });
    }
    if (panels.length > 16) fail("CLI_GOAL_PANEL_LIMIT_EXCEEDED");
  }
  await currentGoal();
  const latest = _deps.collectGoalExtensions(hostOptions);
  panels = panels.filter((panel) => {
    const before = plugins.find(
      (plugin) =>
        plugin.name === panel.plugin.name &&
        plugin.scope === panel.plugin.scope,
    );
    const after = latest.extensions.find(
      (plugin) =>
        plugin.name === panel.plugin.name &&
        plugin.scope === panel.plugin.scope &&
        plugin.version === panel.plugin.version,
    );
    const allowed =
      after && digest(after.declaration) === digest(before.declaration);
    if (
      !allowed &&
      !dropped.some(
        (entry) =>
          entry.name === panel.plugin.name &&
          entry.scope === panel.plugin.scope,
      )
    )
      dropped.push({
        name: panel.plugin.name,
        scope: panel.plugin.scope,
        reason: "admission_changed",
      });
    return allowed;
  });
  const result = {
    schema: CLI_GOAL_PANEL_SCHEMA,
    ...(connection ? { source: "desktop-project" } : {}),
    goalRef,
    snapshot: true,
    observedAt: new Date().toISOString(),
    panels,
    dropped,
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 128 * 1024)
    fail("CLI_GOAL_PANEL_LIMIT_EXCEEDED");
  return result;
}
