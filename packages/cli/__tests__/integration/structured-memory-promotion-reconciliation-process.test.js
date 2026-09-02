import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots = [];
const fixture = fileURLToPath(
  new URL(
    "../fixtures/structured-memory-promotion-reconciliation-process.mjs",
    import.meta.url,
  ),
);
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const vitest = path.join(repositoryRoot, "node_modules/vitest/vitest.mjs");
const producerTest =
  "runs two real accepted Gate cells sharing an environment and verifies the signed conjunction receipt";

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runPhase(phase, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, phase, root], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CC_TEST_PROMOTION_TENANT_ID: "tenant-primary",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
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
    child.once("error", reject);
    child.once("close", (code, signal) => {
      try {
        resolve({
          code,
          signal,
          stderr,
          result: JSON.parse(stdout.trim()),
        });
      } catch (cause) {
        reject(
          new Error(
            `invalid reconciliation process output: ${stdout || stderr}`,
            {
              cause,
            },
          ),
        );
      }
    });
  });
}

function runCrashProducer(root) {
  return new Promise((resolve, reject) => {
    const markerPath = path.join(root, "producer-ready.json");
    const child = spawn(
      process.execPath,
      [
        vitest,
        "run",
        "__tests__/unit/skill-target-matrix-eval.test.js",
        "-t",
        producerTest,
        "--pool=threads",
        "--maxWorkers=1",
        "--reporter=dot",
      ],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          CC_TEST_PROMOTION_CRASH_ROOT: root,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let marker = null;
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      callback();
    };
    const poll = setInterval(() => {
      try {
        marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
        child.kill();
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
          finish(() => reject(error));
        }
      }
    }, 20);
    const timeout = setTimeout(() => {
      child.kill();
      finish(() =>
        reject(
          new Error(
            `timed out waiting for committed promotion marker: ${stdout || stderr}`,
          ),
        ),
      );
    }, 60_000);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => {
      finish(() => {
        if (!marker) {
          reject(
            new Error(
              `promotion producer exited before its durable marker (${code}/${signal}): ${stdout || stderr}`,
            ),
          );
          return;
        }
        resolve({ code, signal, pid: child.pid, marker, stdout, stderr });
      });
    });
  });
}

describe("structured Memory promotion process reconciliation", () => {
  it("kills the real release producer and reconciles Memory in fresh processes", async () => {
    const root = fs.mkdtempSync(
      path.join(
        fs.realpathSync(os.tmpdir()),
        "cc-promotion-reconcile-process-",
      ),
    );
    roots.push(root);

    const producer = await runCrashProducer(root);
    const reconciled = await runPhase("reconcile", root);
    const verified = await runPhase("verify", root);

    expect(producer.marker).toMatchObject({
      pid: producer.pid,
      receiptDigest: expect.stringMatching(/^sha256:/u),
      memoryId: expect.stringMatching(/^skill-release:/u),
      releaseDigest: expect.stringMatching(/^sha256:/u),
      stateRevision: 1,
    });
    expect(producer.code === null || producer.code !== 0).toBe(true);
    expect(reconciled).toMatchObject({
      code: 0,
      signal: null,
      result: {
        ok: true,
        phase: "reconcile",
        reconciliation: {
          status: "converged",
          receiptCount: 1,
          reconciled: [
            {
              receiptDigest: producer.marker.receiptDigest,
              status: "persisted",
            },
          ],
          projection: { sequence: 1 },
        },
        projection: { sequence: 1 },
      },
    });
    expect(verified).toMatchObject({
      code: 0,
      signal: null,
      result: {
        ok: true,
        phase: "verify",
        reconciliation: {
          status: "converged",
          receiptCount: 1,
          reconciled: [
            {
              receiptDigest: producer.marker.receiptDigest,
              status: "recovered",
            },
          ],
          projection: { sequence: 1 },
        },
        projection: { sequence: 1 },
      },
    });
    expect(
      new Set([producer.pid, reconciled.result.pid, verified.result.pid]).size,
    ).toBe(3);
    expect(
      verified.result.projection.memories[producer.marker.memoryId],
    ).toMatchObject({
      status: "active",
      artifactRef: producer.marker.releaseDigest,
      receipts: { promotion: producer.marker.receiptDigest },
    });
  }, 90_000);
});
