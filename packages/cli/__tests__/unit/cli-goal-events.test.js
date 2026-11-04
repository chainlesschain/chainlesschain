import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  createGoal,
  setStatus,
  recordProgress,
} from "../../src/lib/goal-store.js";
import {
  watchCliGoalExtensionEvents,
  _deps,
} from "../../src/lib/plugin-runtime/cli-goal-events.js";
import {
  trustPlugin,
  untrustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  revokeCapabilityConsent,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";
import { registerGoalCommand } from "../../src/commands/goal.js";

const sample = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-status-observer/plugin.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
let temp, root, nameDir, options, goal, controller;
function allow() {
  trustPlugin(sample.name, {
    scope: "project",
    version: sample.version,
    workspaceRoot: options.cwd,
  });
  consentPluginCapabilities(sample.name, {
    scope: "project",
    version: sample.version,
    capabilities: normalizeCapabilities(sample.permissions),
  });
}
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-events-"));
  root = path.join(temp, "home", "goals");
  const cwd = path.join(temp, "workspace");
  nameDir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
  fs.mkdirSync(path.join(nameDir, sample.version), { recursive: true });
  fs.writeFileSync(
    path.join(nameDir, sample.version, "plugin.json"),
    JSON.stringify(sample),
  );
  fs.writeFileSync(path.join(nameDir, ".active"), sample.version);
  const managedSettingsFile = path.join(temp, "policy.json");
  fs.writeFileSync(managedSettingsFile, "{}");
  vi.spyOn(trustDeps, "storePath").mockReturnValue(
    path.join(temp, "trust.json"),
  );
  vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
    path.join(temp, "workspace-trust.json"),
  );
  vi.spyOn(consentDeps, "storePath").mockReturnValue(
    path.join(temp, "consent.json"),
  );
  vi.stubEnv("CC_PLUGIN_TRANSACTION_HOME", path.join(temp, "transactions"));
  controller = new AbortController();
  options = {
    cwd,
    root,
    managedSettingsFile,
    plugin: sample.name,
    scope: "project",
    intervalMs: 250,
    durationMs: 5000,
    signal: controller.signal,
    env: {
      ...process.env,
      CC_PLUGINS: "1",
      CC_PLUGIN_SCOPES: "project",
      CHAINLESSCHAIN_HOME: path.join(temp, "home"),
    },
  };
  goal = createGoal(
    { objective: "Private objective must never enter events" },
    { root },
  );
});
afterEach(() => {
  controller.abort();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  fs.rmSync(temp, { recursive: true, force: true });
});

describe("explicit standalone status subscriptions", () => {
  it("requires real trust and explicit event consent before exposing a source", async () => {
    await expect(
      watchCliGoalExtensionEvents(goal.id, options).next(),
    ).rejects.toThrow("PLUGIN_UNAVAILABLE");
    trustPlugin(sample.name, {
      scope: "project",
      version: sample.version,
      workspaceRoot: options.cwd,
    });
    await expect(
      watchCliGoalExtensionEvents(goal.id, options).next(),
    ).rejects.toThrow("PLUGIN_UNAVAILABLE");
    allow();
    expect(
      (await watchCliGoalExtensionEvents(goal.id, options).next()).value.kind,
    ).toBe("ready");
  });
  it("emits only observed status transitions, carries current revision and leaves the source unchanged", async () => {
    allow();
    const events = watchCliGoalExtensionEvents(goal.id, options);
    const ready = (await events.next()).value;
    expect(ready).toMatchObject({
      kind: "ready",
      replay: false,
      delivery: "polling",
      goalRef: { revision: 1 },
    });
    const changed = setStatus(goal.id, "paused", { root });
    const bytes = fs.readFileSync(path.join(root, `${goal.id}.json`));
    const event = (await events.next()).value;
    expect(event).toMatchObject({
      kind: "event",
      event: {
        type: "goal.status.changed",
        summary: "status: active -> paused",
        goalRef: { revision: changed.revision },
      },
    });
    expect(JSON.stringify([ready, event])).not.toContain(goal.objective);
    expect(fs.readFileSync(path.join(root, `${goal.id}.json`))).toEqual(bytes);
    controller.abort();
    expect((await events.next()).done).toBe(true);
  });
  it("does not repeat identical observations or turn progress into status events", async () => {
    allow();
    const events = watchCliGoalExtensionEvents(goal.id, {
      ...options,
      durationMs: 1000,
    });
    await events.next();
    recordProgress(goal.id, { pct: 50 }, { root });
    expect((await events.next()).done).toBe(true);
    expect(_deps.projectGoalExtensionEvent).toBeTypeOf("function");
  });
  it.each([
    "disable",
    "consent",
    "trust",
    "uninstall",
    "policy",
    "declaration",
  ])("stops after %s, even without a source change", async (mode) => {
    allow();
    const events = watchCliGoalExtensionEvents(goal.id, options);
    await events.next();
    if (mode === "disable")
      fs.writeFileSync(path.join(nameDir, ".disabled"), "disabled");
    if (mode === "consent")
      revokeCapabilityConsent(sample.name, { scope: "project" });
    if (mode === "trust")
      untrustPlugin(sample.name, {
        scope: "project",
        workspaceRoot: options.cwd,
      });
    if (mode === "uninstall") fs.unlinkSync(path.join(nameDir, ".active"));
    if (mode === "policy")
      fs.writeFileSync(
        options.managedSettingsFile,
        JSON.stringify({ deniedPlugins: [sample.name] }),
      );
    if (mode === "declaration")
      fs.writeFileSync(
        path.join(nameDir, sample.version, "plugin.json"),
        JSON.stringify({
          ...sample,
          goalExtension: {
            ...sample.goalExtension,
            hosts: { cli: ">=0.166.140" },
          },
        }),
      );
    await expect(events.next()).rejects.toThrow("ADMISSION_CHANGED");
  });
  it.each(["revoke", "source", "abort"])(
    "discards a completed projection after %s before delivery",
    async (mode) => {
      allow();
      const events = watchCliGoalExtensionEvents(goal.id, options);
      await events.next();
      setStatus(goal.id, "paused", { root });
      const original = _deps.projectGoalExtensionEvent;
      vi.spyOn(_deps, "projectGoalExtensionEvent").mockImplementation(
        async (...args) => {
          const event = await original(...args);
          if (mode === "revoke")
            revokeCapabilityConsent(sample.name, { scope: "project" });
          if (mode === "source") setStatus(goal.id, "active", { root });
          if (mode === "abort") controller.abort();
          return event;
        },
      );
      if (mode === "abort") expect((await events.next()).done).toBe(true);
      else
        await expect(events.next()).rejects.toThrow(
          mode === "source" ? "SOURCE_CHANGED" : "ADMISSION_CHANGED",
        );
    },
  );
  it.each(["delete", "corrupt", "regress"])(
    "terminates on %s instead of displaying stale data",
    async (mode) => {
      allow();
      setStatus(goal.id, "paused", { root });
      const events = watchCliGoalExtensionEvents(goal.id, options);
      await events.next();
      const file = path.join(root, `${goal.id}.json`);
      if (mode === "delete") fs.unlinkSync(file);
      if (mode === "corrupt") fs.writeFileSync(file, "broken");
      if (mode === "regress") fs.writeFileSync(file, JSON.stringify(goal));
      await expect(events.next()).rejects.toThrow();
    },
  );
  it("aborts the pending timer promptly and removes its abort listener", async () => {
    allow();
    const events = watchCliGoalExtensionEvents(goal.id, {
      ...options,
      intervalMs: 60000,
    });
    await events.next();
    const pending = events.next();
    controller.abort();
    expect((await pending).done).toBe(true);
  });
  it("captures options before the first iteration and pins the selected store", async () => {
    allow();
    const events = watchCliGoalExtensionEvents(goal.id, options);
    options.cwd = path.join(temp, "other-workspace");
    options.plugin = "other-plugin";
    options.env.CC_PLUGIN_SCOPES = "user";
    expect((await events.next()).value.plugin.name).toBe(sample.name);
    await expect(
      watchCliGoalExtensionEvents(goal.id, {
        ...options,
        expectedStore: "wrong",
      }).next(),
    ).rejects.toThrow("STORE_MISMATCH");
  });
  it.each([
    { intervalMs: 0 },
    { intervalMs: 249 },
    { intervalMs: Infinity },
    { durationMs: 999 },
    { durationMs: 900001 },
    { plugin: "" },
    { scope: "unknown" },
    { connection: "" },
    { signal: {} },
  ])("rejects invalid selection/limits %j", (invalid) => {
    expect(() =>
      watchCliGoalExtensionEvents(goal.id, { ...options, ...invalid }),
    ).toThrow();
  });
  it("does not read anything for an already cancelled iterator", async () => {
    controller.abort();
    expect(
      (await watchCliGoalExtensionEvents(goal.id, options).next()).done,
    ).toBe(true);
  });
  it("CLI prints JSON lines and cleans up signal handlers on a rejected source", async () => {
    const program = new Command();
    registerGoalCommand(program);
    const before = [
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
    ];
    vi.spyOn(console, "error").mockImplementation(() => {});
    await program.parseAsync([
      "node",
      "cc",
      "goal",
      "watch",
      goal.id,
      "--plugin",
      sample.name,
      "--interval",
      "0",
      "--json",
    ]);
    expect(process.exitCode).toBe(1);
    expect([
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
    ]).toEqual(before);
  });
});
