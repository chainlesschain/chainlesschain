import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/team-handoff-process-recovery.mjs", import.meta.url),
);
const temporaryRoots = [];

function runFixture(phase, statePath, markerPath, resultPath) {
  return spawnSync(
    process.execPath,
    [FIXTURE, phase, statePath, markerPath, resultPath],
    {
      cwd: path.resolve(path.dirname(FIXTURE), "../.."),
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    },
  );
}

afterAll(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Team custody handoff cross-process recovery", () => {
  it("resumes commit-before-dispatch once with a fresh fence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-handoff-"));
    temporaryRoots.push(root);
    const statePath = path.join(root, "team-state.json");
    const markerPath = path.join(root, "effect-marker.json");
    const resultPath = path.join(root, "result.json");

    const crashed = runFixture(
      "prepare-crash",
      statePath,
      markerPath,
      resultPath,
    );
    expect(crashed.error).toBeUndefined();
    expect(crashed.status).toBe(73);
    expect(fs.existsSync(markerPath)).toBe(false);

    const resumed = runFixture("resume", statePath, markerPath, resultPath);
    expect(resumed.error).toBeUndefined();
    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    expect(result).toMatchObject({
      summary: { success: true, executions: 1 },
      marker: { count: 1 },
      startedBeforeEffect: true,
      recoveredAuthority: {
        holder: "teammate-2",
        taskKey: "source",
      },
      handoff: {
        id: "cross-process-handoff",
        status: "committed",
        targetSettlement: "completed",
      },
    });
    expect(result.recoveredAuthority.leaseId).not.toBe(result.oldLeaseId);
    expect(result.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "handoff:recovered" }),
        expect.objectContaining({ type: "handoff:target-started" }),
      ]),
    );
  });
});
