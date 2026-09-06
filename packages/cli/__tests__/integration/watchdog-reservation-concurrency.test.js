import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { createProgressiveCanaryWatchdogFileStore } from "../../src/lib/evolution/progressive-canary-watchdog-file-store.js";

const children = new Set();
const helper = fileURLToPath(
  new URL("./helpers/watchdog-reservation-contender.mjs", import.meta.url),
);
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  children.clear();
});

function contender(rootDir, planDigest, hostId) {
  const child = fork(helper, [rootDir, planDigest, hostId], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.add(child);
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-16_384);
  });
  const message = (type) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`contender ${type} timed out: ${diagnostics}`)),
        10_000,
      );
      const finish = (error, value) => {
        clearTimeout(timer);
        child.off("message", receive);
        child.off("error", failed);
        child.off("exit", exited);
        if (error) reject(error);
        else resolve(value);
      };
      const receive = (value) => {
        if (value.type === "error") finish(new Error(value.message));
        else if (value.type === type) finish(null, value);
      };
      const failed = (error) => finish(error);
      const exited = (code) =>
        finish(new Error(`contender exited ${code}: ${diagnostics}`));
      child.on("message", receive);
      child.once("error", failed);
      child.once("exit", exited);
    });
  return { child, ready: message("ready"), message };
}

it.each([false, true])(
  "grants exactly one reservation across four real processes (expired=%s)",
  async (expired) => {
    const rootDir = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-watchdog-contention-"),
    );
    const planDigest = digest("plan");
    const hostId = "process-host";
    const binding = {
      planDigest,
      incidentDigest: digest("incident"),
      observedAt: 10_000,
      leaseDurationMs: 5_000,
    };
    const store = await createProgressiveCanaryWatchdogFileStore({
      rootDir,
      planDigest,
      hostId,
    });
    if (expired) {
      await store.incidentStore.reserve(binding);
      binding.observedAt = 15_001;
    }
    const contenders = Array.from({ length: 4 }, () =>
      contender(rootDir, planDigest, hostId),
    );
    const ready = await Promise.all(contenders.map((entry) => entry.ready));
    expect(new Set(ready.map((entry) => entry.pid)).size).toBe(4);
    expect(ready.every((entry) => entry.pid !== process.pid)).toBe(true);
    const results = contenders.map((entry) => entry.message("result"));
    for (const entry of contenders) entry.child.send(binding);
    const records = await Promise.all(results);
    expect(records.filter((entry) => entry.result.acquired)).toHaveLength(1);
    expect(
      records.every(
        (entry) => entry.result.authenticated && entry.result.durable,
      ),
    ).toBe(true);
    await expect(store.incidentStore.reserve(binding)).resolves.toMatchObject({
      acquired: false,
    });
  },
  30_000,
);
