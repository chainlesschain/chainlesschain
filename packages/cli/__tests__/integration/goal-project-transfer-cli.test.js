import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3"),
  execute = promisify(execFile);
const {
  ProjectGoalTransferService,
} = require("@chainlesschain/session-core/project-goal-transfer");
const binary = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
describe("real CLI binary project handoff", () => {
  let root, db, service, target, env;
  const file = (name) => path.join(root, name);
  const run = (args) =>
    execute(process.execPath, [binary, "goal", ...args], {
      env,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1048576,
    });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-transfer-cli-"));
    fs.mkdirSync(file("home"));
    env = {
      ...process.env,
      CHAINLESSCHAIN_HOME: file("home"),
      CLAUDE_CONFIG_DIR: "",
      NO_COLOR: "1",
    };
    db = new Database(file("project.db"));
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0)",
    );
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      "did:chainless:owner",
      "active",
      10,
    );
    service = new ProjectGoalTransferService({
      db,
      getActor: () => "did:chainless:owner",
    });
    target = service.prepare({
      projectId: "p1",
      requestId: "cli-binary-transfer",
    }).target;
    fs.writeFileSync(file("target.json"), JSON.stringify(target));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("requires explicit freeze, hands off once and restores only after native signed cancellation", async () => {
    const goal = JSON.parse(
      (await run(["set", "CLI goal to transfer", "--json"])).stdout,
    );
    const sourceFile = file(`home/goals/${goal.id}.json`),
      original = fs.readFileSync(sourceFile, "utf8");
    const args = [
      "transfer-to-project",
      goal.id,
      "--target",
      file("target.json"),
      "--output",
      file("transfer.json"),
      "--revision",
      "1",
      "--json",
    ];
    await expect(run(args)).rejects.toMatchObject({ code: 1 });
    expect(fs.readFileSync(sourceFile, "utf8")).toBe(original);
    const frozen = JSON.parse(
      (await run([...args, "--confirm-transfer"])).stdout,
    );
    expect(frozen.state).toBe("frozen");
    expect(fs.existsSync(sourceFile)).toBe(false);
    expect(JSON.parse((await run(["list", "--json"])).stdout)).toEqual([]);
    const transfer = JSON.parse(fs.readFileSync(file("transfer.json"), "utf8")),
      imported = service.importTransfer(transfer);
    expect(imported.goal.status).toBe("paused");
    expect(
      JSON.parse((await run([...args, "--confirm-transfer"])).stdout).digest,
    ).toBe(frozen.digest);
    expect(service.importTransfer(transfer).goal.id).toBe(imported.goal.id);
    const cancelled = service.cancel({ targetId: target.id });
    fs.writeFileSync(
      file("receipt.json"),
      JSON.stringify(cancelled.cancellation),
    );
    const restored = JSON.parse(
      (
        await run([
          "restore-transfer",
          goal.id,
          "--cancellation",
          file("receipt.json"),
          "--json",
        ])
      ).stdout,
    );
    expect(restored.state).toBe("restored");
    expect(fs.readFileSync(sourceFile, "utf8")).toBe(original);
    expect(() => service.importTransfer(transfer)).toThrow(
      "GOAL_TRANSFER_CANCELLED",
    );
  });
});
