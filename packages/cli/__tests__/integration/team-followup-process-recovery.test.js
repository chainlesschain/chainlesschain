import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/team-followup-process-recovery.mjs", import.meta.url),
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

describe("Team follow-up cross-process recovery", () => {
  it("reconciles processed-before-ACK without repeating the durable effect", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-followup-"));
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
    expect(JSON.parse(fs.readFileSync(markerPath, "utf8"))).toEqual({
      count: 1,
    });

    const resumed = runFixture("resume", statePath, markerPath, resultPath);
    expect(resumed.error).toBeUndefined();
    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    expect(result).toMatchObject({
      summary: { success: true, executions: 1 },
      executions: [
        {
          holder: "teammate-1",
          wakeAttempt: 2,
          reconciledExistingEffect: true,
        },
      ],
      marker: { count: 1 },
      pendingMessages: 0,
    });
    expect(result.receipts).toContainEqual(
      expect.objectContaining({
        status: "processed",
        consumerKey: "cross-process-consumer-v1",
      }),
    );
  });
});
