import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  replayCliGoalEvents,
  _deps,
} from "../../src/lib/plugin-runtime/cli-goal-event-history.js";
import {
  trustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  revokeCapabilityConsent,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  ProjectGoalEventJournal,
} = require("../../../session-core/lib/project-goal-event-journal.js");
const {
  validateGoalEventHistoryPage,
} = require("../../../session-core/lib/goal-evidence-contract.js");
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
const goalRef = {
  id: "goal-1",
  storeId: "project-goals-12345678-1234-1234-1234-123456789abc",
  revision: 2,
  controlGeneration: 1,
};
let directory, options, db, journal, readEventPage, pluginDir;
function append(n) {
  db.transaction(() =>
    journal.append({
      goalRef,
      actor: "did:owner",
      sourceId: `review-${n}`,
      type: "risk.review.completed",
      state: "evaluated",
      riskTaskCount: 1,
      recordedAt: "2026-11-04T12:00:00.000Z",
    }),
  ).immediate();
}
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
const saved = () => JSON.parse(fs.readFileSync(options.checkpoint, "utf8"));
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-event-checkpoint-"));
  db = new Database(":memory:");
  journal = new ProjectGoalEventJournal(db);
  const cwd = path.join(directory, "workspace");
  pluginDir = path.join(cwd, ".chainlesschain", "plugins", sample.name);
  fs.mkdirSync(path.join(pluginDir, sample.version), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, sample.version, "plugin.json"),
    JSON.stringify(sample),
  );
  fs.writeFileSync(path.join(pluginDir, ".active"), sample.version);
  const managedSettingsFile = path.join(directory, "policy.json");
  fs.writeFileSync(managedSettingsFile, "{}");
  vi.spyOn(trustDeps, "storePath").mockReturnValue(
    path.join(directory, "trust.json"),
  );
  vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
    path.join(directory, "workspace-trust.json"),
  );
  vi.spyOn(consentDeps, "storePath").mockReturnValue(
    path.join(directory, "consent.json"),
  );
  vi.stubEnv(
    "CC_PLUGIN_TRANSACTION_HOME",
    path.join(directory, "transactions"),
  );
  options = {
    cwd,
    managedSettingsFile,
    plugin: sample.name,
    scope: "project",
    connection: path.join(directory, "history.json"),
    checkpoint: path.join(directory, "checkpoint.json"),
    env: { ...process.env, CC_PLUGINS: "1", CC_PLUGIN_SCOPES: "project" },
  };
  readEventPage = vi.fn(async (after) =>
    validateGoalEventHistoryPage(
      {
        schema: "chainlesschain.goal-event-history/v1",
        goalRef,
        ...db
          .transaction(() => journal.page(goalRef, "did:owner", after))
          .deferred(),
      },
      goalRef,
      after,
    ),
  );
  vi.spyOn(_deps, "createProjectGoalConnection").mockReturnValue({
    goalRef,
    eventHistory: true,
    readEventPage,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe("acknowledged durable event replay", () => {
  it("requires an explicit existing checkpoint for resume and refuses reusing one in new mode", async () => {
    allow();
    append(1);
    const publish = vi.fn(async () => true);
    await expect(
      replayCliGoalEvents(
        goalRef.id,
        { ...options, checkpointMode: "resume" },
        publish,
      ),
    ).rejects.toThrow("GOAL_EVENT_CHECKPOINT_MISSING");
    expect(fs.existsSync(options.checkpoint)).toBe(false);
    expect(readEventPage).not.toHaveBeenCalled();
    await replayCliGoalEvents(
      goalRef.id,
      { ...options, checkpointMode: "new" },
      publish,
    );
    const before = fs.readFileSync(options.checkpoint, "utf8");
    publish.mockClear();
    readEventPage.mockClear();
    await expect(
      replayCliGoalEvents(
        goalRef.id,
        { ...options, checkpointMode: "new" },
        publish,
      ),
    ).rejects.toThrow("GOAL_EVENT_CHECKPOINT_EXISTS");
    expect(fs.readFileSync(options.checkpoint, "utf8")).toBe(before);
    expect(publish).not.toHaveBeenCalled();
    expect(readEventPage).not.toHaveBeenCalled();
    await replayCliGoalEvents(
      goalRef.id,
      { ...options, checkpointMode: "resume" },
      publish,
    );
    expect(publish).toHaveBeenCalledOnce();
  });
  it("rejects invalid checkpoint mode before touching the connection or files", () => {
    expect(() =>
      replayCliGoalEvents(
        goalRef.id,
        { ...options, checkpointMode: "overwrite" },
        async () => true,
      ),
    ).toThrow("GOAL_EVENT_ARGUMENT_REQUIRED");
    expect(_deps.createProjectGoalConnection).not.toHaveBeenCalled();
    expect(fs.existsSync(options.checkpoint)).toBe(false);
  });
  it("resolves relative managed policy against the captured workspace", async () => {
    allow();
    append(1);
    fs.writeFileSync(
      path.join(options.cwd, "relative-policy.json"),
      JSON.stringify({ deniedPlugins: [sample.name] }),
    );
    const { managedSettingsFile, ...fromEnv } = options;
    await expect(
      replayCliGoalEvents(
        goalRef.id,
        {
          ...fromEnv,
          env: { ...options.env, CC_MANAGED_SETTINGS: "relative-policy.json" },
        },
        async () => true,
      ),
    ).rejects.toThrow("PLUGIN_UNAVAILABLE");
    expect(readEventPage).not.toHaveBeenCalled();
    expect(fs.existsSync(options.checkpoint)).toBe(false);
  });
  it("requires current trust and capability consent before reading or creating a checkpoint", async () => {
    append(1);
    await expect(
      replayCliGoalEvents(goalRef.id, options, async () => true),
    ).rejects.toThrow("PLUGIN_UNAVAILABLE");
    expect(readEventPage).not.toHaveBeenCalled();
    expect(fs.existsSync(options.checkpoint)).toBe(false);
  });
  it("emits a bounded page and resumes from a body-free credential-free checkpoint", async () => {
    allow();
    for (let i = 1; i <= 25; i++) append(i);
    const pages = [];
    await replayCliGoalEvents(goalRef.id, options, async (page) => {
      pages.push(page);
      expect(saved().after).toBeNull();
      return true;
    });
    expect(pages[0].entries).toHaveLength(20);
    expect(pages[0].hasMore).toBe(true);
    expect(saved().after).toBe(pages[0].nextCursor);
    await replayCliGoalEvents(goalRef.id, options, async (page) => {
      pages.push(page);
      return true;
    });
    expect(pages[1].entries.map((x) => x.sequence)).toEqual([
      21, 22, 23, 24, 25,
    ]);
    expect(pages[1].hasMore).toBe(false);
    expect(JSON.stringify(saved())).not.toMatch(
      /summary|review-1|endpoint|connection|"key"/,
    );
  });
  it.each(["throw", "not-acknowledged"])(
    "keeps the old cursor after output %s so the next explicit run repeats the page",
    async (mode) => {
      allow();
      append(1);
      let first;
      await expect(
        replayCliGoalEvents(goalRef.id, options, async (page) => {
          first = page;
          if (mode === "throw") throw new Error("output-failed");
          return false;
        }),
      ).rejects.toThrow();
      expect(saved().after).toBeNull();
      await replayCliGoalEvents(goalRef.id, options, async (page) => {
        expect(page.entries.map((x) => x.id)).toEqual(
          first.entries.map((x) => x.id),
        );
        return true;
      });
    },
  );
  it("does not advance the cursor after revocation while output was being acknowledged", async () => {
    allow();
    append(1);
    await expect(
      replayCliGoalEvents(goalRef.id, options, async () => {
        revokeCapabilityConsent(sample.name, { scope: "project" });
        return true;
      }),
    ).rejects.toThrow("ADMISSION_CHANGED");
    expect(saved().after).toBeNull();
  });
  it("discards a projected page after source loss before output", async () => {
    allow();
    append(1);
    const project = _deps.projectGoalExtensionEvent;
    vi.spyOn(_deps, "projectGoalExtensionEvent").mockImplementation(
      async (...args) => {
        const result = await project(...args);
        readEventPage.mockRejectedValue(new Error("SOURCE_UNAVAILABLE"));
        return result;
      },
    );
    const publish = vi.fn(async () => true);
    await expect(
      replayCliGoalEvents(goalRef.id, options, publish),
    ).rejects.toThrow("SOURCE_UNAVAILABLE");
    expect(publish).not.toHaveBeenCalled();
    expect(saved().after).toBeNull();
  });
  it("does not lose append-only arrivals while the previous page is acknowledged", async () => {
    allow();
    for (let i = 1; i <= 21; i++) append(i);
    await replayCliGoalEvents(goalRef.id, options, async () => {
      append(22);
      return true;
    });
    await replayCliGoalEvents(goalRef.id, options, async (page) => {
      expect(page.entries.map((x) => x.sequence)).toEqual([21, 22]);
      return true;
    });
  });
  it("rejects checkpoint changes during publication instead of overwriting them", async () => {
    allow();
    append(1);
    await expect(
      replayCliGoalEvents(goalRef.id, options, async () => {
        fs.writeFileSync(options.checkpoint, JSON.stringify(saved(), null, 2));
        return true;
      }),
    ).rejects.toThrow("CHECKPOINT_CHANGED");
    expect(saved().after).toBeNull();
  });
  it("does not reuse a checkpoint for a changed declaration", async () => {
    allow();
    append(1);
    await replayCliGoalEvents(goalRef.id, options, async () => true);
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
    const publish = vi.fn(async () => true);
    await expect(
      replayCliGoalEvents(goalRef.id, options, publish),
    ).rejects.toThrow("BINDING_CONFLICT");
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects a retention gap without publishing or advancing the original cursor", async () => {
    allow();
    append(1);
    await replayCliGoalEvents(goalRef.id, options, async () => true);
    const cursor = saved().after;
    db.transaction(() => {
      for (let i = 2; i <= 1002; i++)
        journal.append({
          goalRef,
          actor: "did:owner",
          sourceId: `review-${i}`,
          type: "risk.review.completed",
          state: "evaluated",
          riskTaskCount: 1,
          recordedAt: "2026-11-04T12:00:00.000Z",
        });
    }).immediate();
    const publish = vi.fn(async () => true);
    await expect(
      replayCliGoalEvents(goalRef.id, options, publish),
    ).rejects.toThrow("HISTORY_GAP");
    expect(saved().after).toBe(cursor);
    expect(publish).not.toHaveBeenCalled();
  });
  it("does not reinterpret an old connection as historical authorization", async () => {
    allow();
    _deps.createProjectGoalConnection.mockReturnValue({
      goalRef,
      events: true,
      readEvents: readEventPage,
    });
    await expect(
      replayCliGoalEvents(goalRef.id, options, async () => true),
    ).rejects.toThrow("HISTORY_CONNECTION_REQUIRED");
    expect(fs.existsSync(options.checkpoint)).toBe(false);
  });
  it("holds the strict checkpoint lock across output acknowledgement", async () => {
    allow();
    append(1);
    let finish, entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const first = replayCliGoalEvents(goalRef.id, options, async () => {
      entered();
      await new Promise((resolve) => {
        finish = resolve;
      });
      return true;
    });
    await started;
    await expect(
      replayCliGoalEvents(goalRef.id, options, async () => true),
    ).rejects.toThrow();
    finish();
    await first;
    expect(saved().after).not.toBeNull();
  });
});
