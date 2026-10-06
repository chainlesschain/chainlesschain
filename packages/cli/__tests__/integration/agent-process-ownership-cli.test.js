import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cli = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ownership-cli-"));
  roots.push(root);
  const anchor = path.join(root, "anchor");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const env = {
    ...process.env,
    CHAINLESSCHAIN_HOME: path.join(root, "home"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: anchor,
  };
  return {
    root,
    anchor,
    run: (...args) =>
      spawnSync(
        process.execPath,
        [cli, "agent", "process-ownership", ...args],
        {
          cwd: workspace,
          env,
          encoding: "utf8",
          timeout: 20000,
        },
      ),
  };
}

describe("process ownership real CLI routing", () => {
  it("exposes explicit recovery help without creating an authority", () => {
    const f = fixture();
    const result = f.run("recover", "--help");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("recover [options] <execution-id>");
    expect(result.stdout).toContain("--timeout-ms");
    expect(fs.existsSync(f.anchor)).toBe(false);
  });

  it("inspects an empty Linux anchor read-only or rejects an unsupported host", () => {
    const f = fixture();
    const result = f.run("status", "--json");
    expect(result.error).toBeUndefined();
    if (process.platform === "linux") {
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schema: "chainlesschain.process-ownership-status/v1",
        blocked: false,
        unresolvedExecutionIds: [],
        recoverableExecutionIds: [],
        restartSafe: false,
      });
    } else {
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "CC_PROCESS_OWNERSHIP_PLATFORM_UNSUPPORTED",
      );
    }
    expect(fs.existsSync(f.anchor)).toBe(false);
  });

  it.skipIf(process.platform !== "linux")(
    "retains a PID-only record after explicit recovery is refused",
    () => {
      const f = fixture();
      const directory = path.join(f.anchor, "process-ownership-v1");
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const id = "f790cfa4-7ba3-4baf-a9e8-43b3f4c2a747";
      const bytes = JSON.stringify({
        schema: "chainlesschain.process-ownership-journal/v1",
        pending: [
          {
            executionId: id,
            ownerPid: 2147483647,
            token: "cb9857fe-a8bf-4304-a7c1-15530522dc30",
          },
        ],
      });
      const journal = path.join(directory, "journal.json");
      fs.writeFileSync(journal, bytes, { mode: 0o600 });
      const before = f.run("status", "--json");
      expect(before.status, before.stderr).toBe(0);
      expect(JSON.parse(before.stdout)).toMatchObject({
        blocked: true,
        unresolvedExecutionIds: [id],
        recoverableExecutionIds: [],
      });
      const recovery = f.run("recover", id, "--json");
      expect(recovery.error).toBeUndefined();
      expect(recovery.status).toBe(1);
      expect(recovery.stdout).toBe("");
      expect(recovery.stderr).toContain("BROKER_PROCESS_OWNERSHIP_PENDING");
      expect(fs.readFileSync(journal, "utf8")).toBe(bytes);
      expect(fs.readdirSync(directory)).toEqual(["journal.json"]);
      const after = f.run("status", "--json");
      expect(after.status, after.stderr).toBe(0);
      expect(JSON.parse(after.stdout)).toEqual(JSON.parse(before.stdout));
    },
  );
});
