import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  canonicalTraceOffset,
  waitForCanonicalCommands,
} from "../lib/verify01-diagnostic-command-drain.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-command-drain-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "trace.jsonl");
  fs.writeFileSync(file, "");
  const write = (command, commandId, extra = {}) =>
    fs.appendFileSync(
      file,
      `${JSON.stringify({ direction: "command", command, commandId, ...extra })}\n`,
    );
  return {
    file,
    start: (id, sessionId) =>
      write("canonical-session-show", id, {
        args: ["session", "show", "--json", "--history", "--", sessionId],
      }),
    complete: (id, extra = {}) =>
      write("canonical-session-show-complete", id, {
        code: 0,
        signal: null,
        ...extra,
      }),
  };
}

test("waits for every real-close record including a command started while draining", async (t) => {
  const f = fixture(t);
  f.start("prior");
  f.complete("prior", { code: 9 });
  const offset = canonicalTraceOffset(f.file);
  f.start("first");
  let done = false;
  const waiting = waitForCanonicalCommands(f.file, {
    offset,
    deadline: Date.now() + 2000,
  }).then((result) => {
    done = true;
    return result;
  });
  await delay(80);
  assert.equal(done, false);
  f.start("second");
  f.complete("first");
  await delay(80);
  assert.equal(done, false);
  f.complete("second");
  assert.deepEqual(await waiting, { started: 2, completed: 2 });
});

test("missing close acknowledgement exhausts the existing deadline", async (t) => {
  const f = fixture(t);
  f.start("pending");
  await assert.rejects(
    waitForCanonicalCommands(f.file, { offset: 0, deadline: Date.now() + 120 }),
    /drain deadline exceeded/u,
  );
});

test("nonzero and signal exits cannot authorize IDE cleanup", async (t) => {
  for (const result of [{ code: 7 }, { code: null, signal: "SIGTERM" }]) {
    const f = fixture(t);
    f.start("failed");
    f.complete("failed", result);
    await assert.rejects(
      waitForCanonicalCommands(f.file, {
        offset: 0,
        deadline: Date.now() + 1000,
      }),
      /command failed/u,
    );
  }
});

test("a partial completion line is not mistaken for a drained trace", async (t) => {
  const f = fixture(t);
  f.start("split");
  const record = JSON.stringify({
    direction: "command",
    command: "canonical-session-show-complete",
    commandId: "split",
    code: 0,
    signal: null,
  });
  fs.appendFileSync(f.file, record.slice(0, 30));
  const waiting = waitForCanonicalCommands(f.file, {
    offset: 0,
    deadline: Date.now() + 1000,
  });
  await delay(80);
  fs.appendFileSync(f.file, `${record.slice(30)}\n`);
  assert.deepEqual(await waiting, { started: 1, completed: 1 });
});

test("a completion from a different command cannot release a pending command", async (t) => {
  const f = fixture(t);
  f.start("pending");
  f.complete("unrelated");
  await assert.rejects(
    waitForCanonicalCommands(f.file, {
      offset: 0,
      deadline: Date.now() + 1000,
    }),
    /Unmatched/u,
  );
});

test("unused restored tabs are drained and retained without failing the target history", async (t) => {
  const f = fixture(t);
  f.start("empty", "unused-tab");
  f.complete("empty", { code: 1 });
  f.start("target", "task-session");
  f.complete("target");
  assert.deepEqual(
    await waitForCanonicalCommands(f.file, {
      offset: 0,
      deadline: Date.now() + 1000,
      requiredSessionId: "task-session",
    }),
    {
      started: 2,
      completed: 2,
      requiredSessionId: "task-session",
      targetCompleted: 1,
      unrelatedFailures: [{ commandId: "empty", code: 1 }],
    },
  );
  await assert.rejects(
    waitForCanonicalCommands(f.file, {
      offset: 0,
      deadline: Date.now() + 1000,
      requiredSessionId: "unused-tab",
    }),
    /command failed/u,
  );
  await assert.rejects(
    waitForCanonicalCommands(f.file, {
      offset: 0,
      deadline: Date.now() + 1000,
      requiredSessionId: "unobserved-session",
    }),
    /no completed/u,
  );
});
