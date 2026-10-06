import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { waitForInitGate } from "../../tests/fixtures/ide-roadmap/init-gate.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function gate(t, timeoutMs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-init-gate-"));
  const file = path.join(root, "gate.json");
  const prior = process.env.CC_UI_INIT_GATE;
  process.env.CC_UI_INIT_GATE = file;
  t.after(() => {
    if (prior === undefined) delete process.env.CC_UI_INIT_GATE;
    else process.env.CC_UI_INIT_GATE = prior;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const value = { sessionId: "cold-session", nonce: "nonce-1", timeoutMs };
  fs.writeFileSync(file, JSON.stringify(value));
  return { file, value };
}

test("init waits for the exact session and nonce, ignoring a stale release", async (t) => {
  const { file, value } = gate(t, 1000),
    trace = [];
  fs.writeFileSync(
    `${file}.release`,
    JSON.stringify({ ...value, nonce: "stale" }),
  );
  const waiting = waitForInitGate(value.sessionId, (r) => trace.push(r));
  await delay(60);
  assert.deepEqual(
    trace.map((r) => r.command),
    ["init-gate-waiting"],
  );
  fs.writeFileSync(`${file}.release`, JSON.stringify(value));
  await waiting;
  assert.deepEqual(
    trace.map((r) => r.command),
    ["init-gate-waiting", "init-gate-released"],
  );
});

test("a never-released fixture has its own bounded deadline", async (t) => {
  const { value } = gate(t, 50);
  await assert.rejects(
    waitForInitGate(value.sessionId, () => {}),
    /within 50 milliseconds/u,
  );
});

test("invalid or unbounded fixture deadlines are refused", async (t) => {
  const { file, value } = gate(t, 180001);
  for (const timeoutMs of [0, -1, "180000", 1.5, 180001]) {
    fs.writeFileSync(file, JSON.stringify({ ...value, timeoutMs }));
    await assert.rejects(
      waitForInitGate(value.sessionId, () => {}),
      /1..180000/u,
    );
  }
});

test("the actual peer can exit before init with a drained nonzero process result", (t) => {
  const { file, value } = gate(t, 1000);
  fs.writeFileSync(
    `${file}.release`,
    JSON.stringify({ ...value, exitBeforeInit: true }),
  );
  const trace = path.join(path.dirname(file), "trace.jsonl");
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../../tests/fixtures/ide-roadmap/fake-stream-json-agent.mjs",
          import.meta.url,
        ),
      ),
      "agent",
      "--resume",
      value.sessionId,
    ],
    {
      env: { ...process.env, CC_UI_FIXTURE_TRACE: trace },
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    },
  );
  assert.equal(result.status, 86, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  const records = fs
    .readFileSync(trace, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(
    records.some(
      (r) => r.command === "init-gate-exit-before-init" && r.code === 86,
    ),
  );
  assert.ok(!records.some((r) => r.event?.subtype === "init"));
});
