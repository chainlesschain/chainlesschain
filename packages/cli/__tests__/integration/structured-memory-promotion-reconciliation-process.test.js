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

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runPhase(phase, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, phase, root], {
      cwd: process.cwd(),
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

describe("structured Memory promotion process reconciliation", () => {
  it("discovers a durable promotion receipt after restart and appends Memory once", async () => {
    const root = fs.mkdtempSync(
      path.join(
        fs.realpathSync(os.tmpdir()),
        "cc-promotion-reconcile-process-",
      ),
    );
    roots.push(root);

    const seeded = await runPhase("seed", root);
    const reconciled = await runPhase("reconcile", root);
    const verified = await runPhase("verify", root);

    expect(seeded).toMatchObject({
      code: 0,
      signal: null,
      result: {
        ok: true,
        phase: "seed",
        receiptDigest: expect.stringMatching(/^sha256:/u),
        memoryId: expect.stringMatching(/^skill-release:/u),
        projection: { sequence: 0 },
      },
    });
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
              receiptDigest: seeded.result.receiptDigest,
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
              receiptDigest: seeded.result.receiptDigest,
              status: "recovered",
            },
          ],
          projection: { sequence: 1 },
        },
        projection: { sequence: 1 },
      },
    });
    expect(
      new Set([seeded.result.pid, reconciled.result.pid, verified.result.pid])
        .size,
    ).toBe(3);
    expect(
      verified.result.projection.memories[seeded.result.memoryId],
    ).toMatchObject({
      status: "active",
      receipts: { promotion: seeded.result.receiptDigest },
    });
  }, 30_000);
});
