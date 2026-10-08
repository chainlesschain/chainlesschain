import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { withFileLock } from "../src/lib/with-file-lock.js";

const filename = fileURLToPath(import.meta.url);
const writers = 4;
const writes = 60;
if (process.argv[2] === "--writer") {
  const root = process.argv[3];
  let directoryFd;
  try {
    if (process.platform === "linux")
      directoryFd = fs.openSync(
        root,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      );
    const target = path.join(
      directoryFd === undefined ? root : `/proc/self/fd/${directoryFd}`,
      "ledger.json",
    );
    for (let iteration = 0; iteration < writes; iteration++) {
      withFileLock(
        target,
        (context) => {
          context.assertOwnership();
          const ledger = JSON.parse(fs.readFileSync(target, "utf8"));
          ledger.push(`${process.pid}:${iteration}`);
          fs.writeFileSync(target, JSON.stringify(ledger));
        },
        {
          failIfUnavailable: true,
          timeoutMs: 20000,
          retryMs: 1,
          maxRetryMs: 10,
          retryJitterMs: 2,
          yieldAfterReleaseMs: 1,
        },
      );
    }
    process.stdout.write(JSON.stringify({ pid: process.pid, writes }) + "\n");
  } catch (error) {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
  } finally {
    if (directoryFd !== undefined) fs.closeSync(directoryFd);
  }
} else {
  test(
    "strict file locks preserve every concurrent write through real process ownership",
    { timeout: 120000 },
    async () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-real-lock-writers-"),
      );
      const children = [];
      try {
        fs.writeFileSync(path.join(root, "ledger.json"), "[]");
        const completions = Array.from(
          { length: writers },
          () =>
            new Promise((resolve, reject) => {
              const child = spawn(
                process.execPath,
                [filename, "--writer", root],
                { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
              );
              children.push(child);
              let stdout = "",
                stderr = "",
                failure;
              const timer = setTimeout(() => {
                failure = new Error("lock writer exceeded its deadline");
                child.kill();
              }, 90000);
              child.on("error", (error) => {
                failure = error;
              });
              child.stdout.on("data", (data) => {
                stdout += data;
              });
              child.stderr.on("data", (data) => {
                stderr += data;
              });
              child.on("close", (status, signal) => {
                clearTimeout(timer);
                if (failure) reject(failure);
                else if (status !== 0 || signal)
                  reject(
                    new Error(
                      `writer ${child.pid} failed (${status}/${signal}): ${stderr}`,
                    ),
                  );
                else {
                  try {
                    const result = JSON.parse(stdout);
                    assert.equal(result.pid, child.pid);
                    assert.equal(result.writes, writes);
                    resolve(result);
                  } catch (error) {
                    reject(error);
                  }
                }
              });
            }),
        );
        const results = await Promise.allSettled(completions);
        const failures = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason);
        assert.equal(
          failures.length,
          0,
          failures.map((error) => error.stack).join("\n"),
        );
        const ledger = JSON.parse(
          fs.readFileSync(path.join(root, "ledger.json"), "utf8"),
        );
        assert.equal(ledger.length, writers * writes);
        assert.equal(new Set(ledger).size, writers * writes);
        for (const child of children)
          assert.deepEqual(
            ledger.filter((item) => item.startsWith(child.pid + ":")),
            Array.from(
              { length: writes },
              (_, iteration) => `${child.pid}:${iteration}`,
            ),
          );
        assert.equal(fs.existsSync(path.join(root, "ledger.json.lock")), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
