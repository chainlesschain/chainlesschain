import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  watchCliProjectGoalEvents,
  _deps,
} from "../../src/lib/plugin-runtime/cli-project-goal-events.js";
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

const sample = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-project-observer/plugin.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
const goalRef = Object.freeze({
  id: "goal-1",
  storeId: "native-store",
  revision: 2,
  controlGeneration: 1,
});
const risk = (id = "review-1") => ({
  state: "evaluated",
  reviewId: id,
  checkedAt: "2026-11-04T12:00:00.000Z",
  goalRevision: 2,
  controlGeneration: 1,
  riskTaskCount: 1,
  reasonCodes: [],
  history: true,
});
const receipt = (status = "succeeded") => ({
  id: "run-1",
  status,
  actionType: "task.update-description",
  goalRevision: 2,
  controlGeneration: 1,
  history: true,
});
let temp, pluginDir, options, controller, data, readEvents;
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
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-project-events-"));
  const cwd = path.join(temp, "workspace");
  pluginDir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
  fs.mkdirSync(path.join(pluginDir, sample.version), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, sample.version, "plugin.json"),
    JSON.stringify(sample),
  );
  fs.writeFileSync(path.join(pluginDir, ".active"), sample.version);
  const managedSettingsFile = path.join(temp, "managed.json");
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
    managedSettingsFile,
    plugin: sample.name,
    scope: "project",
    connection: "explicit-events.json",
    expectedStore: goalRef.storeId,
    intervalMs: 250,
    durationMs: 5000,
    signal: controller.signal,
    env: { ...process.env, CC_PLUGINS: "1", CC_PLUGIN_SCOPES: "project" },
  };
  data = {
    schema: "chainlesschain.project-goal-events/v1",
    goalRef,
    risk: { state: "not-recorded" },
    receipts: { state: "recorded", entries: [], hasMore: false },
  };
  readEvents = vi.fn(async () => structuredClone(data));
  vi.spyOn(_deps, "createProjectGoalConnection").mockImplementation(() => ({
    goalRef,
    events: true,
    readEvents,
  }));
});
afterEach(() => {
  controller.abort();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(temp, { recursive: true, force: true });
});

describe("separately authorized project event observer", () => {
  it("requires real trust and event consent before reading any evidence", async () => {
    await expect(
      watchCliProjectGoalEvents(goalRef.id, options).next(),
    ).rejects.toThrow("PLUGIN_UNAVAILABLE");
    expect(readEvents).not.toHaveBeenCalled();
    allow();
    const stream = watchCliProjectGoalEvents(goalRef.id, options);
    expect((await stream.next()).value).toMatchObject({
      kind: "ready",
      source: "desktop-project",
      replay: false,
    });
    await stream.return();
  });
  it("does not replay baseline history, and emits a new risk observation without raw evidence", async () => {
    allow();
    data.risk = risk();
    const stream = watchCliProjectGoalEvents(goalRef.id, options);
    await stream.next();
    data.risk = risk("review-2");
    const result = (await stream.next()).value;
    expect(result).toMatchObject({
      kind: "event",
      event: { type: "risk.review.completed", goalRef },
    });
    expect(result.event.summary).toContain("review-2");
    expect(result.event.summary).not.toContain("review-1");
    expect(result.event).not.toHaveProperty("risk");
    expect(result.event.occurredAt).toBe(result.observedAt);
    await stream.return();
  });
  it("emits new receipts and unresolved-to-terminal changes with stable source references", async () => {
    allow();
    const stream = watchCliProjectGoalEvents(goalRef.id, options);
    await stream.next();
    data.receipts.entries = [receipt("unresolved")];
    const first = (await stream.next()).value;
    expect(first.event).toMatchObject({
      type: "action.receipt.updated",
      goalRef,
    });
    expect(first.event.summary).toContain("unresolved");
    data.receipts.entries = [receipt()];
    const second = (await stream.next()).value;
    expect(second.event.summary).toContain("succeeded");
    await stream.return();
  });
  it("does not turn repeated snapshots or receipt page eviction into new events", async () => {
    allow();
    data.risk = risk();
    data.receipts.entries = [receipt()];
    const stream = watchCliProjectGoalEvents(goalRef.id, {
      ...options,
      durationMs: 1000,
    });
    await stream.next();
    data.receipts.entries = [];
    expect((await stream.next()).done).toBe(true);
  });
  it.each([
    "disable",
    "uninstall",
    "trust",
    "consent",
    "policy",
    "declaration",
  ])("stops on %s without requiring evidence changes", async (mode) => {
    allow();
    const stream = watchCliProjectGoalEvents(goalRef.id, options);
    await stream.next();
    if (mode === "disable")
      fs.writeFileSync(path.join(pluginDir, ".disabled"), "disabled");
    if (mode === "uninstall") fs.unlinkSync(path.join(pluginDir, ".active"));
    if (mode === "trust")
      untrustPlugin(sample.name, {
        scope: "project",
        workspaceRoot: options.cwd,
      });
    if (mode === "consent")
      revokeCapabilityConsent(sample.name, { scope: "project" });
    if (mode === "policy")
      fs.writeFileSync(
        options.managedSettingsFile,
        JSON.stringify({ deniedPlugins: [sample.name] }),
      );
    if (mode === "declaration")
      fs.writeFileSync(
        path.join(pluginDir, sample.version, "plugin.json"),
        JSON.stringify({
          ...sample,
          goalExtension: {
            ...sample.goalExtension,
            hosts: { cli: ">=0.166.140" },
          },
        }),
      );
    await expect(stream.next()).rejects.toThrow("ADMISSION_CHANGED");
  });
  it.each(["source", "revoke", "cancel"])(
    "discards a projected event after %s before output",
    async (mode) => {
      allow();
      const stream = watchCliProjectGoalEvents(goalRef.id, options);
      await stream.next();
      data.risk = risk();
      const original = _deps.projectGoalExtensionEvent;
      vi.spyOn(_deps, "projectGoalExtensionEvent").mockImplementation(
        async (...args) => {
          const result = await original(...args);
          if (mode === "source") data.risk = risk("changed-during-output");
          if (mode === "revoke")
            revokeCapabilityConsent(sample.name, { scope: "project" });
          if (mode === "cancel") controller.abort();
          return result;
        },
      );
      if (mode === "cancel") expect((await stream.next()).done).toBe(true);
      else
        await expect(stream.next()).rejects.toThrow(
          mode === "source" ? "SOURCE_CHANGED" : "ADMISSION_CHANGED",
        );
    },
  );
  it.each(["risk", "receipts", "terminal"])(
    "does not label %s regression as a completed event",
    async (mode) => {
      allow();
      data.risk = risk();
      data.receipts.entries = [receipt()];
      const stream = watchCliProjectGoalEvents(goalRef.id, options);
      await stream.next();
      if (mode === "risk") data.risk = { state: "unavailable" };
      if (mode === "receipts")
        data.receipts = { state: "unavailable", entries: [], hasMore: false };
      if (mode === "terminal") data.receipts.entries = [receipt("unresolved")];
      await expect(stream.next()).rejects.toThrow("SOURCE_REGRESSED");
    },
  );
  it("rejects old connection capabilities without reading evidence", async () => {
    allow();
    _deps.createProjectGoalConnection.mockReturnValue({
      goalRef,
      evidence: true,
      read: readEvents,
    });
    await expect(
      watchCliProjectGoalEvents(goalRef.id, options).next(),
    ).rejects.toThrow("EVENT_CONNECTION_REQUIRED");
    expect(readEvents).not.toHaveBeenCalled();
  });
  it("pins the selected goal and store", async () => {
    allow();
    await expect(
      watchCliProjectGoalEvents("another-goal", options).next(),
    ).rejects.toThrow("STORE_MISMATCH");
    await expect(
      watchCliProjectGoalEvents(goalRef.id, {
        ...options,
        expectedStore: "wrong",
      }).next(),
    ).rejects.toThrow("STORE_MISMATCH");
    expect(readEvents).not.toHaveBeenCalled();
  });
  it("captures environment, connection and selection before the first await", async () => {
    allow();
    const stream = watchCliProjectGoalEvents(goalRef.id, options);
    options.connection = "other.json";
    options.plugin = "other";
    options.cwd = temp;
    options.env.CC_PLUGIN_SCOPES = "user";
    expect((await stream.next()).value.plugin.name).toBe(sample.name);
    expect(_deps.createProjectGoalConnection).toHaveBeenCalledExactlyOnceWith(
      "explicit-events.json",
    );
    await stream.return();
  });
  it("propagates AbortSignal to pending reads and cleans up after cancellation", async () => {
    allow();
    readEvents.mockImplementation(
      (_id, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
          controller.abort();
        }),
    );
    expect(
      (await watchCliProjectGoalEvents(goalRef.id, options).next()).done,
    ).toBe(true);
  });
  it("applies the watch deadline during a pending HTTP read", async () => {
    allow();
    readEvents.mockImplementation(
      (_id, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    expect(
      (
        await watchCliProjectGoalEvents(goalRef.id, {
          ...options,
          durationMs: 1000,
        }).next()
      ).done,
    ).toBe(true);
  });
});
