import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

let temp;
afterEach(() => {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});

describe("CLI status observer subprocess journey", () => {
  it("uses real installation, trust and consent, emits a transition and exits on disable", async () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-watch-journey-"));
    const cwd = path.join(temp, "workspace");
    fs.mkdirSync(cwd);
    const bootstrap = path.join(temp, "security-stores.mjs");
    // Redirect only security storage; discovery, trust, consent and CLI run real.
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
    const prefix = ["--import", pathToFileURL(bootstrap).href, bin];
    const invoke = (...args) =>
      execFileSync(process.execPath, [...prefix, ...args], {
        cwd,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
      });
    const goal = JSON.parse(
      invoke("goal", "set", "Private journey objective", "--json"),
    );
    const sample = fileURLToPath(
      new URL(
        "../../src/lib/plugin-runtime/examples/goal-status-observer",
        import.meta.url,
      ),
    );
    invoke("plugin", "add", sample, "--scope", "project", "--json");
    invoke("plugin", "trust", "goal-status-observer", "--scope", "project");
    invoke(
      "plugin",
      "consent",
      "goal-status-observer",
      "--scope",
      "project",
      "--grant",
      "--json",
    );
    const child = spawn(
      process.execPath,
      [
        ...prefix,
        "goal",
        "watch",
        goal.id,
        "--plugin",
        "goal-status-observer",
        "--scope",
        "project",
        "--interval",
        "250",
        "--duration",
        "30",
        "--expected-store",
        goal.storeId,
        "--json",
      ],
      { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      closed = false;
    const completion = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        closed = true;
        resolve(code);
      });
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const records = () =>
      stdout
        .split("\n")
        .filter((line) => line.trim().endsWith("}"))
        .map((line) => JSON.parse(line));
    function waitFor(kind) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error(`No ${kind}: ${stderr}`)),
          10000,
        );
        const finish = (error, record) => {
          clearTimeout(timer);
          child.stdout.removeListener("data", check);
          child.removeListener("close", check);
          if (error) reject(error);
          else resolve(record);
        };
        function check() {
          try {
            const record = records().find((entry) => entry.kind === kind);
            if (record) finish(null, record);
            else if (closed)
              finish(new Error(`Exited before ${kind}: ${stderr}`));
          } catch (error) {
            finish(error);
          }
        }
        child.stdout.on("data", check);
        child.on("close", check);
        check();
      });
    }
    try {
      expect(await waitFor("ready")).toMatchObject({
        replay: false,
        goalRef: { id: goal.id },
      });
      invoke("goal", "pause", goal.id);
      expect(await waitFor("event")).toMatchObject({
        event: {
          summary: "status: active -> paused",
          goalRef: { id: goal.id, revision: 2 },
        },
      });
      const goalFile = path.join(
        env.CHAINLESSCHAIN_HOME,
        "goals",
        `${goal.id}.json`,
      );
      const unchanged = fs.readFileSync(goalFile, "utf8");
      invoke(
        "plugin",
        "disable",
        "goal-status-observer",
        "--scope",
        "project",
        "--json",
      );
      expect(await completion).toBe(1);
      expect(stderr).toContain("CLI_GOAL_EVENT_ADMISSION_CHANGED");
      expect(records().map((entry) => entry.kind)).toEqual(["ready", "event"]);
      expect(stdout).not.toContain(goal.objective);
      expect(fs.readFileSync(goalFile, "utf8")).toBe(unchanged);
    } finally {
      if (!closed) child.kill();
      await completion;
    }
  }, 90000);
});
