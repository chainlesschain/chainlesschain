import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { compileGraphDefinition } from "../../src/lib/graph-kernel/compiler.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import { GraphKernel } from "../../src/lib/graph-kernel/runtime.js";

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "graph-kernel-writer-worker.mjs",
);
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function graph() {
  return compileGraphDefinition({
    schemaVersion: 1,
    id: "process-writer-fencing",
    revision: 1,
    nodes: [
      {
        id: "only",
        kind: "task",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass: "none",
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: {},
    allowedCapabilities: [],
    metadata: {},
  });
}

function contender(directory, runId, writerId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fixture, directory, runId, writerId, `${writerId}-lease`, "2"],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `writer worker exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (cause) {
        reject(
          new Error(`invalid writer worker output: ${stdout || stderr}`, {
            cause,
          }),
        );
      }
    });
  });
}

describe("Graph Kernel cross-process writer fencing", () => {
  it("allows exactly one generation-2 writer and fences the old process", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-graph-writer-race-"),
    );
    directories.push(directory);
    const eventStore = new GraphEventStore({
      rolloutStore: new JsonlRolloutStore({ directory }),
    });
    const first = new GraphKernel({
      eventStore,
      writerId: "writer-generation-1",
      writerLeaseId: "writer-generation-1-lease",
      authorityGeneration: 1,
    });
    const runId = "process-writer-race";
    first.startRun(graph(), { runId, originSurface: "cli_team" });

    const results = await Promise.all([
      contender(directory, runId, "writer-generation-2-a"),
      contender(directory, runId, "writer-generation-2-b"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({
        code: expect.stringMatching(
          /^(CC_ROLLOUT_HEAD_CONFLICT|CC_ROLLOUT_IDEMPOTENCY_CONFLICT|CC_GRAPH_STALE_GENERATION)$/u,
        ),
      }),
    ]);
    expect(
      eventStore
        .read(runId)
        .filter((event) => event.type === "run.authority_transferred"),
    ).toHaveLength(1);
    expect(() => first.sealRun(runId)).toThrowError(
      expect.objectContaining({ code: "CC_ROLLOUT_HEAD_CONFLICT" }),
    );
  }, 30_000);
});
