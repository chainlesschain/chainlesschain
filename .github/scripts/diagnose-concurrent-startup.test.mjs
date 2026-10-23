// Offline checks only: no listening socket, CLI process or PowerShell launch.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  createCleanupOwner,
  createEvidenceCheckpoint,
  createFixture,
  createObserver,
} from "./diagnose-concurrent-startup.mjs";

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
