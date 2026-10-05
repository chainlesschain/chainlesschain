/** Explicit Linux controlled-host entry. Provisioning and reopening are separate. */
import path from "node:path";
import persistentSettings from "../lib/settings-permission-authority.cjs";
import settingsLoader from "../lib/settings-loader.cjs";
import { ScopedPermissionStore } from "../lib/scoped-permission-store.js";
import { assessAgentSandboxCapabilities } from "../lib/agent-sandbox.js";
import { describeExecutionSupport } from "../lib/execution-support.js";
import {
  createPermissionRulesProvider,
  permissionRulesProviderAuthority,
} from "../lib/permission-authority.js";

export const initializePermissionAuthorityHost =
  persistentSettings.initializeSettingsPermissionAuthority;

export function openPermissionAuthorityHost({
  launch,
  contextId,
  env = process.env,
}) {
  const binding = persistentSettings.openSettingsPermissionAuthority({
    launch,
    contextId,
  });
  const bound = persistentSettings.settingsPermissionAuthorityOptions(binding);
  let scopedStore;
  let provider;
  try {
    scopedStore = new ScopedPermissionStore({
      cwd: bound.cwd,
      filePath: bound.scopedFile,
      settingsAuthority: binding,
    });
    provider = createPermissionRulesProvider({
      cwd: bound.cwd,
      settingsAuthority: binding,
      scopedStore,
      env,
    });
    provider();
  } catch (error) {
    persistentSettings.closeSettingsPermissionAuthority(binding);
    throw error;
  }
  let closed = false;
  let running = 0;
  function assertOpen() {
    if (closed)
      throw Object.assign(new Error("Permission authority host is closed"), {
        code: "CC_SETTINGS_PERMISSION_BINDING_INVALID",
      });
  }
  function runtimeOptions(options = {}) {
    assertOpen();
    if (
      (options.cwd && path.resolve(options.cwd) !== bound.cwd) ||
      (options.settingsFile &&
        path.resolve(bound.cwd, options.settingsFile) !== bound.settingsFile) ||
      (options.managedSettingsFile &&
        path.resolve(options.managedSettingsFile) !==
          bound.managedSettingsFile) ||
      options.permissionRules ||
      options.permissionRulesProvider ||
      options.hermeticExecution
    )
      throw new TypeError(
        "controlled-host permission authority options mismatch",
      );
    permissionRulesProviderAuthority(provider).assertWritableRoots([
      bound.cwd,
      ...(options.additionalDirectories || []).map((root) =>
        path.resolve(bound.cwd, root),
      ),
      ...(options.sandbox?.policy?.allowWrite || []),
    ]);
    provider(); // Reopen/read failures never fall back to sampled permissions.
    return {
      ...options,
      cwd: bound.cwd,
      settingsFile: bound.settingsFile,
      managedSettingsFile: bound.managedSettingsFile,
      permissionRulesProvider: provider,
    };
  }
  return Object.freeze({
    capabilities(sandbox, options = {}) {
      assertOpen();
      runtimeOptions({ sandbox });
      const report = assessAgentSandboxCapabilities(sandbox, options);
      return {
        ...report,
        support: describeExecutionSupport({
          capabilityReport: report,
          permissionRulesProvider: provider,
        }),
      };
    },
    exportLaunch() {
      assertOpen();
      return persistentSettings.exportSettingsPermissionAuthority(binding);
    },
    runtimeOptions,
    readPermissions() {
      assertOpen();
      return provider();
    },
    addRule(options) {
      assertOpen();
      return settingsLoader.addRule({
        ...options,
        cwd: bound.cwd,
        settingsAuthority: binding,
      });
    },
    addScopedRule(options) {
      assertOpen();
      return scopedStore.add(options);
    },
    revokeScopedRule(options) {
      assertOpen();
      return scopedStore.revoke(options);
    },
    async runHeadless(options, deps) {
      const captured = runtimeOptions(options);
      running++;
      try {
        const { runAgentHeadless } = await import("./headless-runner.js");
        return await runAgentHeadless(captured, deps);
      } finally {
        running--;
      }
    },
    async runHeadlessStream(options, deps) {
      const captured = runtimeOptions(options);
      running++;
      try {
        const { runAgentHeadlessStream } = await import("./headless-stream.js");
        return await runAgentHeadlessStream(captured, deps);
      } finally {
        running--;
      }
    },
    close() {
      assertOpen();
      if (running)
        throw new Error("Permission authority host still has active runtimes");
      persistentSettings.closeSettingsPermissionAuthority(binding);
      closed = true;
    },
  });
}
