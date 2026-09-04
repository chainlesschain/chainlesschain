import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const WORKER = fileURLToPath(
  new URL(
    "./helpers/evolution-release-train-process-worker.mjs",
    import.meta.url,
  ),
);
const roots = [];

function sync(root, operation = "run", crashStage = "none") {
  return spawnSync(process.execPath, [WORKER, root, operation, crashStage], {
    cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
    encoding: "utf8",
    timeout: 120_000,
  });
}

function asyncRun(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, root, "run", "none"], {
      cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const output = (result) => JSON.parse(result.stdout.trim());

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("EvolutionReleaseTrain real process recovery", () => {
  it("recovers all eight real domain controllers across a hard exit", () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-train-real-prefix-"),
    );
    roots.push(root);
    expect(sync(root, "init").status).toBe(0);
    expect(sync(root, "real-prefix-run", "review").status).toBe(75);
    const recovered = sync(root, "real-prefix-run");
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(output(recovered)).toMatchObject({
      ok: true,
      stageIndex: 8,
      effectCount: 8,
      ledgerEventCount: 16,
    });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "real-prefix-wiki-state.json"), "utf8"),
      ),
    ).toMatchObject({
      tenantId: "tenant-process",
      patterns: { "pat-safe-refactor": { actionable: true } },
    });
    expect(fs.readdirSync(path.join(root, "stage-effects"))).toHaveLength(8);
  }, 180_000);

  it("recovers a stage-effect hard exit without repeating any of eight effects", () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-train-crash-"),
    );
    roots.push(root);
    expect(sync(root, "init").status).toBe(0);
    expect(sync(root, "run", "review").status).toBe(75);
    const recovered = sync(root);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(output(recovered)).toMatchObject({
      ok: true,
      stageIndex: 8,
      effectCount: 8,
      ledgerEventCount: 8,
    });
    expect(fs.readdirSync(path.join(root, "stage-effects"))).toHaveLength(8);
  }, 180_000);

  it("converges two competing OS processes to one deterministic lineage", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-train-race-"),
    );
    roots.push(root);
    expect(sync(root, "init").status).toBe(0);
    const competitors = await Promise.all([asyncRun(root), asyncRun(root)]);
    const final = sync(root);
    expect(final.status, final.stderr).toBe(0);
    const settled = output(final);
    expect(settled).toMatchObject({
      stageIndex: 8,
      effectCount: 8,
      ledgerEventCount: 8,
    });
    const successes = competitors.filter(({ code }) => code === 0).map(output);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(
      successes.every(({ stateDigest }) => stateDigest === settled.stateDigest),
    ).toBe(true);
    expect(fs.readdirSync(path.join(root, "stage-effects"))).toHaveLength(8);
  }, 240_000);
});
