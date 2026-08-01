import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const roots = [];
const originalHome = process.env.CHAINLESSCHAIN_HOME;
const worker = fileURLToPath(
  new URL("../fixtures/session-concurrency-writer.mjs", import.meta.url),
);

function temporaryHome() {
  const root = mkdtempSync(join(tmpdir(), "cc-session-concurrency-"));
  roots.push(root);
  return root;
}

function runWriter(home, sessionId, writerId, count) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [worker, sessionId, writerId, String(count)],
      {
        env: { ...process.env, CHAINLESSCHAIN_HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`writer ${writerId} exited ${code ?? signal}: ${stderr}`),
        );
    });
  });
}

afterEach(() => {
  if (originalHome == null) delete process.env.CHAINLESSCHAIN_HOME;
  else process.env.CHAINLESSCHAIN_HOME = originalHome;
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function assertConcurrentWriters({ writers, perWriter }) {
  const home = temporaryHome();
  process.env.CHAINLESSCHAIN_HOME = home;
  const store = await import("../../src/harness/jsonl-session-store.js");
  const sessionId = `concurrent-${writers}-${perWriter}-${Date.now()}`;
  store.startSession(sessionId, { title: "concurrency" });

  await Promise.all(
    Array.from({ length: writers }, (_, index) =>
      runWriter(home, sessionId, `w${index}`, perWriter),
    ),
  );

  const events = store.readEvents(sessionId);
  const probes = events.filter((event) => event.type === "concurrency_probe");
  expect(probes).toHaveLength(writers * perWriter);
  expect(
    new Set(
      probes.map((event) => `${event.data.writerId}:${event.data.sequence}`),
    ).size,
  ).toBe(writers * perWriter);
  expect(store.verifySession(sessionId)).toMatchObject({
    status: "verified",
    chainedEvents: 1 + writers * perWriter,
  });
}

describe("cross-process JSONL session writers", () => {
  it("serializes concurrent writers without hash-chain forks or lost events", async () => {
    await assertConcurrentWriters({ writers: 5, perWriter: 40 });
  }, 60_000);

  const soak = process.env.CC_SESSION_STORE_SOAK === "1" ? it : it.skip;
  soak(
    "meets the 20 writers x 1,000 events acceptance matrix",
    async () => {
      await assertConcurrentWriters({ writers: 20, perWriter: 1_000 });
    },
    15 * 60_000,
  );
});
