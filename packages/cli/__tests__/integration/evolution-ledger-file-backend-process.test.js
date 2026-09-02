import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots = [];
const fixture = fileURLToPath(
  new URL(
    "../fixtures/evolution-ledger-file-backend-process.mjs",
    import.meta.url,
  ),
);

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runBackendProcess(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, root], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CC_TEST_LEDGER_SECRET: "test-only-process-ledger-secret",
        CC_TEST_WITNESS_SECRET: "test-only-process-witness-secret",
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
          new Error(`invalid backend process output: ${stdout || stderr}`, {
            cause,
          }),
        );
      }
    });
  });
}

describe("EvolutionLedger file backend process restart", () => {
  it("reopens across OS processes and rejects local reincarnation behind the witness", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-ledger-process-restart-"),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });

    const first = await runBackendProcess(root);
    const second = await runBackendProcess(root);
    expect(first).toMatchObject({
      code: 0,
      signal: null,
      result: {
        ok: true,
        verification: { sequence: 0, eventCount: 0 },
        witness: { generation: 1, status: "committed" },
      },
    });
    expect(second).toMatchObject({
      code: 0,
      signal: null,
      result: {
        ok: true,
        verification: {
          ledgerId: first.result.verification.ledgerId,
          epoch: first.result.verification.epoch,
          witnessDigest: first.result.verification.witnessDigest,
        },
        witness: {
          witnessDigest: first.result.witness.witnessDigest,
        },
      },
    });
    expect(second.result.pid).not.toBe(first.result.pid);

    const eventRoot = path.resolve(root, "events");
    const authorityRoot = path.resolve(root, "authority");
    expect(eventRoot.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(true);
    expect(authorityRoot.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(
      true,
    );
    fs.rmSync(eventRoot, { recursive: true, force: true });
    fs.rmSync(authorityRoot, { recursive: true, force: true });

    const reincarnation = await runBackendProcess(root);
    expect(reincarnation).toMatchObject({
      code: 2,
      signal: null,
      result: {
        ok: false,
        code: "CC_EVOLUTION_LEDGER_CORRUPT",
      },
    });
  }, 30_000);
});
