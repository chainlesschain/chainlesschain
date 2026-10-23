// Component checks only: tiny Node helpers; no listening socket, CLI cohort or PowerShell launch.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const { install, markers, callsite } = createRequire(import.meta.url)(
  "./concurrent-startup-preload.cjs",
);
import {
  createCleanupOwner,
  createEvidenceCheckpoint,
  createFixture,
  createObserver,
  redactStderr,
} from "./diagnose-concurrent-startup.mjs";

test("real external preload observes ESM builtins without leaking helper content", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-preload-test-"));
  try {
    const file = path.join(directory, "events.jsonl");
    const preload = fileURLToPath(
      new URL("./concurrent-startup-preload.cjs", import.meta.url),
    );
    const script = `import { spawnSync, spawn } from 'node:child_process';
      const result = spawnSync(process.execPath, ['-e', 'process.stdout.write("CC_PRIVATE_CANARY")']);
      if (result.stdout.toString() !== 'CC_PRIVATE_CANARY') process.exit(2);
      const child = spawn(process.execPath, ['-e', 'process.stderr.write("CC_PRIVATE_CANARY")']);
      child.stderr.resume(); child.stdout.resume();
      child.once('close', code => { process.exitCode = code; });`;
    const result = spawnSync(
      process.execPath,
      ["--require", preload, "--input-type=module", "-e", script],
      {
        env: { ...process.env, CC_STARTUP_OBSERVATION_FILE: file },
        windowsHide: true,
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0);
    const bytes = fs.readFileSync(file, "utf8");
    assert.equal(bytes.includes("CC_PRIVATE_CANARY"), false);
    const rows = bytes.trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      rows.filter((row) => row.kind === "begin").map((row) => row.method),
      ["spawnSync", "spawn"],
    );
    assert.equal(
      rows.find((row) => row.kind === "return" && row.id === 1).stdoutBytes,
      17,
    );
    assert.equal(rows.find((row) => row.kind === "close").stderrBytes, 17);
  } finally {
    assert.equal(
      path.dirname(fs.realpathSync.native(directory)),
      fs.realpathSync.native(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("cc-preload-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sync observation preserves receiver, arguments, result and throw identity while redacting secrets", () => {
  const events = [];
  const secret = "CC_PRIVATE_CANARY";
  const args = [
    "C:\\private\\powershell.exe",
    [secret],
    { env: { TOKEN: secret }, input: secret },
  ];
  const result = {
    pid: 123,
    status: 1,
    stdout: Buffer.from(secret),
    stderr: Buffer.from(
      "CC_WINDOWS_ACL_STAGE=lookup\nCC_WINDOWS_ACL_ELAPSED_MS=lookup:12\n" +
        secret,
    ),
    error: new Error(secret),
  };
  let time = 0;
  const object = {
    spawnSync(...received) {
      assert.equal(this, object);
      assert.deepEqual(received, args);
      time = 25;
      return result;
    },
    spawn() {},
  };
  install({
    childProcess: object,
    write: (row) => events.push(row),
    now: () => time,
    stack: () =>
      "Error: " +
      secret +
      "\n at C:\\secret\\packages\\session-core\\lib\\private-storage.js:820:17",
    pid: 10,
  });
  assert.equal(object.spawnSync(...args), result);
  assert.equal(events[1].program, "powershell.exe");
  assert.deepEqual(events[1].callsite, [
    {
      file: "packages/session-core/lib/private-storage.js",
      line: 820,
      column: 17,
    },
  ]);
  assert.equal(events[2].durationMs, 25);
  assert.equal(events[2].stdoutBytes, Buffer.byteLength(secret));
  assert.equal(events[2].pid, 123);
  assert.equal(events[2].exitCode, 1);
  assert.deepEqual(events[2].aclMarkers, [
    { stage: "lookup" },
    { stage: "lookup", elapsedMs: 12 },
  ]);
  assert.equal(JSON.stringify(events).includes(secret), false);
  const error = new Error(secret);
  const throwing = {
    spawnSync() {
      throw error;
    },
    spawn() {},
  };
  install({
    childProcess: throwing,
    write: () => {
      throw Error(secret);
    },
  });
  assert.throws(
    () => throwing.spawnSync(secret),
    (actual) => actual === error,
  );
});

test("async observation never starts draining a paused stream and counts emitted bytes", () => {
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const object = {
    spawnSync() {},
    spawn() {
      return child;
    },
  };
  install({ childProcess: object, write: (row) => events.push(row) });
  assert.equal(object.spawn("CC_PRIVATE_CANARY"), child);
  assert.equal(child.stdout.readableFlowing, null);
  assert.equal(child.stdout.listenerCount("data"), 0);
  child.stdout.emit("data", Buffer.from("abc"));
  child.stderr.emit("data", "de");
  child.emit("close", 0);
  assert.equal(events[1].program, "OTHER");
  assert.equal(events.at(-1).stdoutBytes, 3);
  assert.equal(events.at(-1).stderrBytes, 2);
  assert.equal(JSON.stringify(events).includes("PRIVATE"), false);
});

test("marker and stderr projections admit only bounded fixed grammar", () => {
  assert.deepEqual(
    markers(
      "CC_WINDOWS_ACL_STAGE=secret\nCC_WINDOWS_ACL_STAGE=lookup secret\nCC_WINDOWS_ACL_ELAPSED_MS=lookup:300001\nCC_WINDOWS_ACL_ELAPSED_MS=lookup:0001\nCC_WINDOWS_ACL_STAGE=verify\r\n",
    ),
    [{ stage: "verify" }],
  );
  assert.equal(markers("CC_WINDOWS_ACL_STAGE=lookup\n".repeat(100)).length, 64);
  assert.deepEqual(callsite("Error: SECRET\n at C:/SECRET/file.js:1:2"), []);
  const redacted = redactStderr(
    "Database initialized: SECRET\nError: SECRET\nAuthorization: Bearer SECRET\n".repeat(
      100,
    ),
  );
  assert.equal(redacted.length, 64);
  assert.equal(JSON.stringify(redacted).includes("SECRET"), false);
});

test("outer ACL callsites are allowlisted and stack limits restore even if capture throws", () => {
  const originalLimit = Error.stackTraceLimit;
  const events = [];
  const args = [
    "powershell.exe",
    ["CC_PRIVATE_CANARY"],
    { input: "CC_PRIVATE_CANARY" },
  ];
  const result = { pid: 42, status: 0 };
  const object = {
    spawnSync(...received) {
      assert.deepEqual(received, args);
      return result;
    },
    spawn() {},
  };
  let failed = false;
  try {
    Error.stackTraceLimit = 3;
    install({
      childProcess: object,
      write: (row) => events.push(row),
      stack() {
        assert.equal(Error.stackTraceLimit, 32);
        if (failed) throw new Error("CC_PRIVATE_CANARY");
        return (
          "Error: CC_PRIVATE_CANARY\n" +
          " at C:/private/file.js:1:2\n".repeat(15) +
          " at C:/private/packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js:123:4\n" +
          " at C:/private/packages/cli/src/lib/artifact-store.js:456:7\n"
        );
      },
    });
    assert.equal(object.spawnSync(...args), result);
    assert.equal(Error.stackTraceLimit, 3);
    assert.deepEqual(
      events[1].callsite.map((site) => site.file),
      [
        "packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js",
        "packages/cli/src/lib/artifact-store.js",
      ],
    );
    failed = true;
    assert.equal(object.spawnSync(...args), result);
    assert.equal(Error.stackTraceLimit, 3);
    assert.deepEqual(events[3].callsite, []);
    assert.equal(JSON.stringify(events).includes("CC_PRIVATE_CANARY"), false);
  } finally {
    Error.stackTraceLimit = originalLimit;
  }
});

test("checkpoint failures retain the primary timeout and do not prevent cleanup", async () => {
  const report = { failure: { kind: "original-120000ms-timeout" } };
  const checkpoint = createEvidenceCheckpoint(report, () => {
    throw Object.assign(new Error("CC_PRIVATE_CANARY"), {
      code: "CC_PRIVATE_CANARY",
    });
  });
  assert.equal(checkpoint("interrupt"), false);
  let cleaned = false;
  const cleanup = createCleanupOwner({
    records: [],
    retire: async () => {
      cleaned = true;
      return { confirmed: false };
    },
    observer: { stop: async () => ({ closed: true }) },
  });
  await cleanup(true);
  assert.equal(cleaned, true);
  assert.equal(report.failure.kind, "original-120000ms-timeout");
  assert.deepEqual(report.finalizationFailures, [
    { stage: "interrupt", code: "OTHER" },
  ]);
  assert.equal(JSON.stringify(report).includes("PRIVATE"), false);
});

test("timeout, interrupt and finalization reuse one shrinking cleanup deadline", async () => {
  let now = 100;
  let retires = 0;
  let stops = 0;
  const records = [{ closed: false }];
  const cleanup = createCleanupOwner({
    records,
    now: () => now,
    retire: async (owned, timeout) => {
      retires++;
      assert.equal(owned, records);
      assert.equal(timeout, 9900);
      return { confirmed: false };
    },
    observer: {
      stop: async (deadline) => {
        stops++;
        assert.equal(deadline, 10100);
        return { closed: true };
      },
    },
  });
  const timedOut = cleanup(true);
  now = 200;
  assert.equal(cleanup(true), timedOut);
  assert.equal(cleanup(false), timedOut);
  assert.equal((await timedOut).safeToRemove, false);
  assert.equal(retires, 1);
  assert.equal(stops, 1);
});

test("normal close never invents tree retirement or calls forced cleanup", async () => {
  const cleanup = createCleanupOwner({
    records: [{ closed: true }],
    retire: () => assert.fail("forced retirement"),
    observer: { stop: async () => ({ closed: true }) },
  });
  const result = await cleanup(false);
  assert.equal(result.safeToRemove, true);
  assert.deepEqual(result.cohort, {
    scope: "direct-children",
    allClosed: true,
    treeTermination: "unverified",
  });
  assert.equal(result.cohort.confirmed, undefined);
});

test("observer uncertainty preserves the home despite confirmed cohort retirement", async () => {
  const cleanup = createCleanupOwner({
    records: [],
    retire: async () => ({ confirmed: true }),
    observer: { stop: async () => ({ closed: false }) },
  });
  assert.equal((await cleanup(true)).safeToRemove, false);
});

test("a rejected helper does not replace cleanup evidence or reset its budget", async () => {
  let attempts = 0;
  const cleanup = createCleanupOwner({
    records: [],
    retire: async () => {
      attempts++;
      throw new Error("PRIVATE");
    },
    observer: { stop: async () => ({ closed: true }) },
  });
  assert.equal((await cleanup(true)).safeToRemove, false);
  assert.equal((await cleanup(true)).safeToRemove, false);
  assert.equal(attempts, 1);
});

test("one hidden observer emits only allowlisted numeric samples and stops without signals", async () => {
  const report = { observer: { stdoutBytes: 0, stderrBytes: 0 }, samples: [] };
  const limitations = [];
  let launches = 0;
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => assert.fail("observer must not signal"),
  });
  const observer = createObserver({
    script: "CONTROLLED_SCRIPT",
    report,
    elapsed: () => 5,
    limit: (value) => limitations.push(value),
    spawnProcess(command, _args, options) {
      launches++;
      assert.equal(command, "powershell.exe");
      assert.equal(options.windowsHide, true);
      return child;
    },
  });
  const records = [
    {
      index: 0,
      child: { pid: 123 },
      closed: false,
      beforeMs: 1,
      afterMs: 2,
      completion: { exit: () => null },
    },
  ];
  observer.start(records);
  observer.start(records);
  child.stdout.write('{"kind":"ready"}\n');
  child.stdout.write(
    '{"kind":"sample","agentIndex":0,"observerMs":1,"available":true,"cpuMs":2,"rssBytes":3,"private":"CC_PRIVATE_CANARY"}\n',
  );
  assert.equal(launches, 1);
  assert.equal(report.samples.length, 1);
  assert.equal(JSON.stringify(report).includes("PRIVATE"), false);
  records[0].closed = true;
  child.stdout.write(
    '{"kind":"sample","agentIndex":0,"observerMs":2,"available":true,"cpuMs":2,"rssBytes":3}\n',
  );
  assert.equal(report.samples.length, 1);
  const stopped = observer.stop(performance.now() + 1000);
  child.emit("close", 0);
  assert.deepEqual(await stopped, { closed: true, started: true });
  assert.deepEqual(limitations, []);
});

test("late observer close stays unknown without killing or resetting a timer", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => assert.fail("unexpected signal"),
  });
  const limitations = [];
  const observer = createObserver({
    script: "CONTROLLED",
    report: { observer: { stdoutBytes: 0, stderrBytes: 0 }, samples: [] },
    elapsed: () => 0,
    limit: (value) => limitations.push(value),
    spawnProcess: () => child,
  });
  observer.start([]);
  assert.equal((await observer.stop(performance.now())).closed, false);
  assert(limitations.includes("observer-close-unconfirmed"));
  child.emit("close", 0);
});

for (const stream of [false, true])
  test(`fixture preserves formal response bytes (stream=${stream}) without storing content`, async () => {
    const report = { requests: [] };
    const server = createFixture({
      report,
      elapsed: () => 1,
      limit: () => assert.fail("unexpected fixture limitation"),
    });
    const request = new EventEmitter();
    const bodies = [];
    let complete;
    const done = new Promise((resolve) => {
      complete = resolve;
    });
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      destroyed: false,
      writeHead(code) {
        assert.equal(code, 200);
      },
      write(value) {
        bodies.push(value);
        return true;
      },
      end(value) {
        bodies.push(value);
        this.writableEnded = true;
        this.emit("finish");
        this.emit("close");
        complete();
      },
    });
    server.emit("request", request, response);
    request.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          messages: [
            { role: "system", content: "CC_PRIVATE_CANARY" },
            { role: "user", content: "agent-7" },
          ],
          stream,
        }),
      ),
    );
    request.emit("end");
    await done;
    const expected = stream
      ? JSON.stringify({
          message: { role: "assistant", content: "reliability-ok" },
          done: false,
        }) +
        "\n" +
        JSON.stringify({ done: true, prompt_eval_count: 1, eval_count: 1 }) +
        "\n"
      : JSON.stringify({
          message: { role: "assistant", content: "reliability-ok" },
          done: true,
          prompt_eval_count: 1,
          eval_count: 1,
        });
    assert.equal(bodies.join(""), expected);
    assert.equal(report.requests[0].agentIndex, 7);
    assert.equal(report.requests[0].responseBytes, Buffer.byteLength(expected));
    assert.equal(JSON.stringify(report).includes("PRIVATE"), false);
  });
