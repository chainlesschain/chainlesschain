import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const CLI_BIN = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const riskFixtures = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../session-core/__fixtures__/project-risk/risk-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-project-offline-cli-"));
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

function invoke(command, snapshot, options = ["--json"]) {
  const file = path.join(directory, "snapshot.json");
  fs.writeFileSync(file, JSON.stringify(snapshot));
  const before = fs.readFileSync(file);
  const result = spawnSync(
    process.execPath,
    [CLI_BIN, "project", command, "--snapshot", file, ...options],
    { encoding: "utf8", timeout: 15000 },
  );
  expect(fs.readFileSync(file)).toEqual(before);
  expect(result.error).toBeUndefined();
  return result;
}

function previewSnapshot() {
  return {
    task: {
      id: "task-1",
      project_id: "project-1",
      task_type: "edit_file",
      description: "old description",
      status: "pending",
      updated_at: 1791158400000,
    },
    project: {
      id: "project-1",
      user_id: "did:key:owner-1",
      status: "active",
      updated_at: 1791158400000,
    },
    description: "proposed description",
    idempotencyKey: "preview-1",
  };
}

describe("cc project offline snapshots", () => {
  it("evaluates a fixed independent snapshot through the real CLI dispatcher", () => {
    const result = invoke("risk-evaluate", riskFixtures[0].input);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.status).toBe("evaluated");
    expect(output.summary).toEqual(riskFixtures[0].expected.summary);
    expect(output.tasks.map((task) => task.taskRef.id)).toEqual([
      "before",
      "failed",
    ]);
    expect(output.ruleVersion).toBe("project-risk/v1");
    expect(output.projectRef.type).toBe("Project");
  });

  it("reports insufficient-data with exit 2 for incomplete empty reads", () => {
    const input = { ...riskFixtures[3].input, readStatus: "failed" };
    const result = invoke("risk-evaluate", input);
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "insufficient-data",
      reasonCodes: ["READ_NOT_COMPLETE"],
      tasks: [],
      summary: null,
    });
  });

  it("labels human output as offline and unverified", () => {
    const result = invoke("risk-evaluate", riskFixtures[0].input, []);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Offline project risk evaluation (unverified snapshot)",
    );
    expect(result.stdout).toContain("before: OVERDUE_INCOMPLETE_TASK");
  });

  it("creates a description request while preserving unverified authority", () => {
    const result = invoke("task-description-preview", previewSnapshot());
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.authority).toBe("unverified-snapshot");
    expect(output.before).toEqual({ description: "old description" });
    expect(output.after).toEqual({ description: "proposed description" });
    expect(output.request.actionType).toBe("task.update-description");
    expect(output.request.expectedVersion).toBe(output.request.target.version);
    expect(output.request.actionDigest).toMatch(/^sha256:/u);
    expect(Object.hasOwn(output, "actionRun")).toBe(false);
  });

  it("rejects unsupported organization preview with exit 2", () => {
    const input = previewSnapshot();
    input.task.org_id = "organization-1";
    const result = invoke("task-description-preview", input);
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "error",
      error: "ACTION_ORGANIZATION_UNSUPPORTED",
    });
  });

  it.each(["--actor", "--execute"])(
    "provides no snapshot authority/execution flag %s",
    (option) => {
      const result = invoke("task-description-preview", previewSnapshot(), [
        "--json",
        option,
        "did:key:other",
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("unknown option");
    },
  );

  it("does not expose malformed JSON contents in error output", () => {
    const file = path.join(directory, "malformed.json");
    fs.writeFileSync(file, '{"description":"sensitive internal text');
    const result = spawnSync(
      process.execPath,
      [CLI_BIN, "project", "risk-evaluate", "--snapshot", file, "--json"],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "error",
      error: "SNAPSHOT_INVALID_JSON",
    });
    expect(result.stdout + result.stderr).not.toContain(
      "sensitive internal text",
    );
  });

  it("requires an explicit snapshot file", () => {
    const result = spawnSync(
      process.execPath,
      [CLI_BIN, "project", "risk-evaluate"],
      {
        encoding: "utf8",
        timeout: 15000,
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--snapshot");
  });
});
