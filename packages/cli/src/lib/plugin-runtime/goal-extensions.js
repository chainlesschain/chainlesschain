import {
  goalExtensionRef as goalRef,
  normalizeGoalExtensionProposal,
} from "@chainlesschain/session-core/goal-extension-proposal-contract";
/**
 * DMM-07 host boundary. Only trusted host code calls this module; plugins supply
 * declarations, never callbacks. Re-discover for every delivery/proposal so a
 * retained session cannot outlive disable, uninstall, policy or consent changes.
 */
import { discoverPlugins } from "./scopes.js";
import { loadManagedPluginPolicy, filterByManagedPolicy } from "./policy.js";
import { isPluginTrusted } from "./trust.js";
import { isPluginCapabilityConsented } from "./capability-consent.js";
import { checkGoalExtensionCompatibility } from "./goal-extension-contract.js";
import path from "node:path";
import { managedSettingsPath } from "../settings-loader.cjs";

export const _deps = {
  discoverPlugins,
  loadManagedPluginPolicy,
  filterByManagedPolicy,
  isPluginTrusted,
  isPluginCapabilityConsented,
};

function fixedHostOptions(options) {
  const env = Object.freeze({ ...(options.env || process.env) });
  return Object.freeze({
    cwd: path.resolve(options.cwd || process.cwd()),
    env,
    managedSettingsFile: managedSettingsPath({
      env,
      managedSettingsFile: options.managedSettingsFile,
    }),
    host: Object.freeze({
      id: options.host?.id,
      version: options.host?.version,
      capabilities: Object.freeze([...(options.host?.capabilities || [])]),
    }),
    authorize: options.authorize,
    readEvent: options.readEvent,
    readPanel: options.readPanel,
    enqueueProposal: options.enqueueProposal,
  });
}

/** Compatibility and mandatory consent are independent of legacy policy flags. */
export function collectGoalExtensions(options = {}) {
  const extensions = [];
  const dropped = [];
  try {
    const { cwd, env, managedSettingsFile, host } = fixedHostOptions(options);
    const managed = _deps.loadManagedPluginPolicy({
      env,
      managedSettingsFile,
      fresh: true,
    });
    const plugins = _deps.discoverPlugins({
      cwd,
      env,
      managedSettingsFile,
      skipPolicy: true,
      includeDisabled: true,
      includeBlocked: true,
    });
    for (const plugin of plugins) {
      let reason = null;
      try {
        if (plugin.runtimeBlocked || plugin.manifest?.ok !== true)
          reason = "invalid_plugin";
        else if (plugin.enabled === false) reason = "disabled";
        else if (!_deps.filterByManagedPolicy([plugin], managed).kept.length)
          reason = "policy_blocked";
        else {
          const compatibility = checkGoalExtensionCompatibility(
            plugin.manifest.goalExtension,
            host,
          );
          if (!compatibility.compatible) reason = compatibility.reason;
          else if (plugin.manifest.capabilitiesDeclared !== true)
            reason = "capabilities_undeclared";
          else if (
            !_deps.isPluginTrusted({
              ...plugin,
              workspaceRoot: cwd || process.cwd(),
            })
          )
            reason = "untrusted";
          else if (
            !_deps.isPluginCapabilityConsented(
              plugin,
              plugin.manifest.capabilities,
            )
          )
            reason = "consent_required";
        }
      } catch {
        reason = "authorization_unavailable";
      }
      if (reason)
        dropped.push({ name: plugin.name, scope: plugin.scope, reason });
      else
        extensions.push({
          name: plugin.name,
          scope: plugin.scope,
          version: plugin.version,
          declaration: JSON.parse(
            JSON.stringify(plugin.manifest.goalExtension),
          ),
        });
    }
  } catch {
    // Management I/O failure is never permission to continue with old state.
    return { extensions: [], dropped: [{ reason: "discovery_unavailable" }] };
  }
  return { extensions, dropped };
}

function admittedPlugin(ref, options, kind, value) {
  const plugin = collectGoalExtensions(options).extensions.find(
    (entry) =>
      entry.name === ref?.name &&
      entry.scope === ref?.scope &&
      entry.version === ref?.version,
  );
  if (!plugin) throw new Error("goal extension is not currently admitted");
  if (kind && !plugin.declaration[kind].includes(value))
    throw new Error(`goal extension ${kind} is undeclared`);
  return plugin;
}

async function authorize(callback, context) {
  if (typeof callback !== "function" || (await callback(context)) !== true)
    throw new Error("goal extension source authorization denied");
}

/** Deliver a bounded read-only view, checking source access again after I/O. */
export async function projectGoalExtensionEvent(ref, request, options = {}) {
  options = fixedHostOptions(options);
  const type = request?.type;
  const plugin = admittedPlugin(ref, options, "events", type);
  const source = goalRef(request.goalRef);
  const context = Object.freeze({
    plugin: Object.freeze({
      name: plugin.name,
      scope: plugin.scope,
      version: plugin.version,
    }),
    goalRef: source,
    operation: "read-event",
    type,
  });
  await authorize(options.authorize, context);
  if (typeof options.readEvent !== "function")
    throw new Error("host event reader unavailable");
  const data = await options.readEvent(context);
  await authorize(options.authorize, context);
  admittedPlugin(context.plugin, options, "events", type);
  // The host reader owns object access. Never spread raw goal/memory/receipt data.
  if (
    !data ||
    typeof data.summary !== "string" ||
    data.summary.length > 4096 ||
    typeof data.occurredAt !== "string" ||
    data.occurredAt.length > 64 ||
    !Number.isFinite(Date.parse(data.occurredAt))
  )
    throw new Error("invalid host event projection");
  return Object.freeze({
    type,
    goalRef: source,
    summary: data.summary,
    occurredAt: data.occurredAt,
  });
}

/** Fixed-slot UI has a plain-text fallback; extensions cannot supply markup. */
export async function projectGoalExtensionPanel(ref, request, options = {}) {
  options = fixedHostOptions(options);
  const plugin = admittedPlugin(ref, options);
  const panel = plugin.declaration.panels.find(
    (entry) => entry.id === request?.panelId,
  );
  if (!panel) throw new Error("goal extension panel is undeclared");
  const source = goalRef(request.goalRef);
  const context = Object.freeze({
    plugin: Object.freeze({
      name: plugin.name,
      scope: plugin.scope,
      version: plugin.version,
    }),
    goalRef: source,
    operation: "read-panel",
    panel: Object.freeze({
      ...panel,
      fields: Object.freeze([...panel.fields]),
    }),
  });
  await authorize(options.authorize, context);
  if (typeof options.readPanel !== "function")
    throw new Error("host panel reader unavailable");
  const data = await options.readPanel(context);
  await authorize(options.authorize, context);
  const current = admittedPlugin(context.plugin, options);
  if (
    !current.declaration.panels.some(
      (entry) => JSON.stringify(entry) === JSON.stringify(panel),
    )
  )
    throw new Error("goal extension panel changed during projection");
  const lines = [panel.title];
  for (const field of panel.fields) {
    if (typeof data?.[field] !== "string" || data[field].length > 4096)
      throw new Error(`invalid host panel field ${field}`);
    lines.push(`${field}: ${data[field]}`);
  }
  return Object.freeze({
    id: panel.id,
    slot: panel.slot,
    format: "text",
    text: lines.join("\n"),
  });
}

/** Queue an unapproved proposal through a host adapter; no action execution API. */
export async function proposeGoalExtensionAction(ref, raw, options = {}) {
  options = fixedHostOptions(options);
  const plugin = admittedPlugin(ref, options);
  raw = normalizeGoalExtensionProposal(raw);
  if (!plugin.declaration.proposals.includes(raw.type))
    throw new Error("goal extension proposal is undeclared");
  const source = raw.goalRef;
  const title = raw.title;
  const description = raw.description;
  const context = Object.freeze({
    plugin: Object.freeze({
      name: plugin.name,
      scope: plugin.scope,
      version: plugin.version,
    }),
    goalRef: source,
    operation: "propose-action",
    type: raw.type,
    sourceRef: raw.sourceRef,
    requestId: raw.requestId,
  });
  await authorize(options.authorize, context);
  if (typeof options.enqueueProposal !== "function")
    throw new Error("host proposal queue unavailable");
  admittedPlugin(context.plugin, options, "proposals", context.type);
  // The host queue must revalidate source revision/control generation in its
  // transaction, and deduplicate requestId within plugin/version/goal identity.
  // It stores a pending suggestion; native confirmation stays later.
  const result = await options.enqueueProposal(
    Object.freeze({
      ...context,
      title,
      description,
      state: "pending-confirmation",
    }),
  );
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    Object.keys(result).some((key) => !["proposalId", "state"].includes(key)) ||
    result.state !== "pending-confirmation" ||
    typeof result.proposalId !== "string" ||
    !result.proposalId ||
    result.proposalId.length > 256
  )
    throw new Error("invalid host proposal receipt");
  return Object.freeze({
    proposalId: result.proposalId,
    state: "pending-confirmation",
  });
}
