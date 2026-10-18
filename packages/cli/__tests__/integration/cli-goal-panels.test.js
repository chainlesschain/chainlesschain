import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

let temp;
afterEach(() => {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});

describe("CLI goal panel subprocess journey", () => {
  it("installs, trusts, consents, reads, disables and uninstalls while retaining the goal", () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-panel-journey-"));
    const cwd = path.join(temp, "workspace");
    fs.mkdirSync(cwd);
    const bootstrap = path.join(temp, "test-security-stores.mjs");
    // Only storage locations are replaced. The real CLI, discovery, workspace
    // trust, durable consent and lifecycle implementations run in fresh children.
    fs.writeFileSync(
      bootstrap,
      `
import { _deps as trust } from ${JSON.stringify(new URL("../../src/lib/plugin-runtime/trust.js", import.meta.url).href)};
import { _deps as consent } from ${JSON.stringify(new URL("../../src/lib/plugin-runtime/capability-consent.js", import.meta.url).href)};
trust.storePath = () => process.env.DMM_TEST_TRUST_FILE;
trust.workspaceTrustStorePath = () => process.env.DMM_TEST_WORKSPACE_TRUST_FILE;
consent.storePath = () => process.env.DMM_TEST_CONSENT_FILE;
`,
    );
    const env = {
      ...process.env,
      CHAINLESSCHAIN_HOME: path.join(temp, "home"),
      CC_PLUGINS: "1",
      CC_PLUGIN_SCOPES: "project",
      CC_PLUGIN_TRANSACTION_HOME: path.join(temp, "transactions"),
      CC_MANAGED_SETTINGS: path.join(temp, "no-managed-settings.json"),
      DMM_TEST_TRUST_FILE: path.join(temp, "trust.json"),
      DMM_TEST_WORKSPACE_TRUST_FILE: path.join(temp, "workspace-trust.json"),
      DMM_TEST_CONSENT_FILE: path.join(temp, "consent.json"),
    };
    const bin = fileURLToPath(
      new URL("../../bin/chainlesschain.js", import.meta.url),
    );
    const sample = fileURLToPath(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-progress-viewer",
        import.meta.url,
      ),
    );
    function text(...args) {
      return execFileSync(
        process.execPath,
        ["--import", pathToFileURL(bootstrap).href, bin, ...args],
        {
          cwd,
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
    }
    function run(...args) {
      return JSON.parse(text(...args));
    }
    const goal = run("goal", "set", "Ship a real subprocess journey", "--json");
    const goalFile = path.join(
      env.CHAINLESSCHAIN_HOME,
      "goals",
      `${goal.id}.json`,
    );
    const original = fs.readFileSync(goalFile, "utf8");
    const catalog = run("goal", "catalog", "--limit", "1", "--json");
    expect(catalog.entries).toEqual([
      expect.objectContaining({ id: goal.id, status: "active" }),
    ]);
    expect(catalog).toMatchObject({
      scannedCount: 1,
      skippedCount: 0,
      invalidNameCount: 0,
      nextCursor: null,
    });
    run("plugin", "add", sample, "--scope", "project", "--json");
    const read = () =>
      run(
        "goal",
        "panels",
        goal.id,
        "--plugin=goal-progress-viewer",
        "--scope",
        "project",
        `--expected-store=${catalog.storeId}`,
        "--json",
      );
    expect(read().panels).toEqual([]);
    text("plugin", "trust", "goal-progress-viewer", "--scope", "project");
    expect(read().dropped).toContainEqual(
      expect.objectContaining({ reason: "consent_required" }),
    );
    run(
      "plugin",
      "consent",
      "goal-progress-viewer",
      "--scope",
      "project",
      "--grant",
      "--json",
    );
    expect(read().panels[0].text).toContain("Ship a real subprocess journey");
    expect(() =>
      text(
        "goal",
        "panels",
        goal.id,
        `--expected-store=cli-goals-${"b".repeat(64)}`,
        "--json",
      ),
    ).toThrow("CLI_GOAL_STORE_MISMATCH");
    run(
      "plugin",
      "disable",
      "goal-progress-viewer",
      "--scope",
      "project",
      "--json",
    );
    expect(read().panels).toEqual([]);
    run(
      "plugin",
      "enable",
      "goal-progress-viewer",
      "--scope",
      "project",
      "--json",
    );
    expect(read().panels).toHaveLength(1);
    text("plugin", "uninstall", "goal-progress-viewer", "--scope", "project");
    expect(read().panels).toEqual([]);
    expect(run("goal", "show", goal.id, "--json").objective).toBe(
      goal.objective,
    );
    expect(fs.readFileSync(goalFile, "utf8")).toBe(original);
  }, 90000);
});
