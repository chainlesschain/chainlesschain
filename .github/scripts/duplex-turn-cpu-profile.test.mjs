import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Session } from "node:inspector";
import { performance } from "node:perf_hooks";
const require = createRequire(import.meta.url);
const {
  CPU_LIMITS,
  createFrameSanitizer,
  summarizeCpuProfile,
  encodeCpuSummary,
  createCpuObserver,
} = require("./duplex-turn-diagnostics-preload.cjs");
const node = (id, children = []) => ({
  id,
  children,
  callFrame: {
    functionName: `SECRET_NAME_${id}`,
    url: "",
    lineNumber: 0,
    columnNumber: 0,
  },
});
const profile = {
  nodes: [node(1, [2]), node(2, [3]), node(3)],
  samples: [3, 2, 3],
  timeDeltas: [10, 20, 30],
  startTime: 100,
  endTime: 160,
};
const label = (frame) =>
  ({ SECRET_NAME_1: "root", SECRET_NAME_2: "caller", SECRET_NAME_3: "leaf" })[
    frame.functionName
  ];

test("real local inspector produces a bounded early summary without a soak run", async () => {
  const summaries = [];
  const observer = createCpuObserver({
    createSession: () => new Session(),
    sanitizeFrame: createFrameSanitizer(process.cwd()),
    write: (text) => summaries.push(text),
  });
  observer.observe("undici:request:trailers", 2);
  await observer.settled();
  const until = performance.now() + 120;
  while (performance.now() < until) Math.sqrt(performance.now());
  observer.observe("undici:request:create", 4);
  await observer.settled();
  const text = summaries.at(-1);
  const summary = JSON.parse(text);
  assert.equal(summary.status, "completed");
  assert.ok(summary.summarizedSamples > 0);
  assert.ok(summary.sampledMicros > 0);
  assert.ok(Buffer.byteLength(text) <= CPU_LIMITS.bytes);
  assert.equal(text.includes(process.cwd()), false);
});

test("sampled self, inclusive, and root-to-leaf chains preserve weighted time", () => {
  const result = summarizeCpuProfile(profile, label);
  assert.deepEqual(result.topSelf, [
    { frame: "leaf", samples: 2, micros: 40 },
    { frame: "caller", samples: 1, micros: 20 },
  ]);
  assert.deepEqual(
    result.topInclusive.find((row) => row.frame === "caller"),
    { frame: "caller", samples: 3, micros: 60 },
  );
  assert.deepEqual(result.topChains[0], {
    frames: ["root", "caller", "leaf"],
    samples: 2,
    micros: 40,
  });
  assert.equal(result.sampledMicros, 60);
  assert.equal(result.profileDurationMicros, 60);
});

test("only existing root-relative source coordinates survive; no names, URLs, payloads, or absolute paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cpu-privacy-"));
  try {
    const source = path.join(root, "packages", "cli", "src", "known.js");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "export function known() {}\n");
    const sanitize = createFrameSanitizer(root);
    const frame = {
      functionName: "SENSITIVE_IDENTIFIER_CANARY",
      url: pathToFileURL(source).href,
      lineNumber: 0,
      columnNumber: 7,
    };
    assert.equal(sanitize(frame), "packages/cli/src/known.js:1:8");
    const inputs = [
      frame,
      { ...frame, url: "https://private.example/PRIVATE_URL?token=SECRET" },
      {
        ...frame,
        url: path.join(root, "packages", "cli", "PRIVATE_MISSING.js"),
      },
      { ...frame, url: path.join(root, "..", "SECRET_EXTERNAL.js") },
      { ...frame, url: "" },
      { ...frame, url: "node:PRIVATE_INTERNAL" },
      { ...frame, lineNumber: -1 },
    ];
    const text = encodeCpuSummary(
      summarizeCpuProfile(
        {
          nodes: inputs.map((callFrame, index) => ({ id: index, callFrame })),
          samples: inputs.map((_, index) => index),
          timeDeltas: inputs.map(() => 10),
        },
        sanitize,
      ),
    );
    for (const secret of [
      "SENSITIVE",
      "PRIVATE",
      "SECRET",
      root,
      "https:",
      "file:",
      "function known",
    ])
      assert.equal(text.includes(secret), false, secret);
    assert.ok(JSON.parse(text).unknownSamples >= 4);
    assert.equal(
      sanitize({ url: "", functionName: "(garbage collector)" }),
      "garbage-collector",
    );
  } finally {
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function mockObserver({ failure, deferredStart = false, ...window } = {}) {
  const calls = [];
  const summaries = [];
  let completeStart;
  let tick = 0;
  const observer = createCpuObserver({
    createSession: () => ({
      connect() {
        calls.push("connect");
        if (failure === "connect") throw new Error("PRIVATE_CONNECT");
      },
      disconnect() {
        calls.push("disconnect");
      },
      post(method, params, callback) {
        calls.push(method);
        if (method === "Profiler.setSamplingInterval")
          assert.deepEqual(params, { interval: 10000 });
        if (failure === method) {
          callback(new Error("PRIVATE_FAILURE"));
          return;
        }
        if (method === "Profiler.start" && deferredStart) {
          completeStart = callback;
          return;
        }
        callback(null, method === "Profiler.stop" ? { profile } : {});
      },
    }),
    sanitizeFrame: label,
    write: (text) => summaries.push(JSON.parse(text)),
    now: () => ++tick,
    ...window,
  });
  return {
    observer,
    calls,
    summaries,
    releaseStart: () => completeStart(null, {}),
  };
}

test("starts only on trailers 2 and stops only on create 4 exactly once", async () => {
  const { observer, calls, summaries } = mockObserver();
  observer.observe("undici:request:trailers", 1);
  observer.observe("undici:request:create", 2);
  assert.deepEqual(calls, []);
  observer.observe("undici:request:trailers", 2);
  observer.observe("undici:request:trailers", 2);
  await observer.settled();
  observer.observe("undici:request:headers", 4);
  assert.equal(calls.includes("Profiler.stop"), false);
  observer.observe("undici:request:create", 4);
  observer.observe("undici:request:create", 4);
  await observer.settled();
  observer.finish();
  assert.deepEqual(calls, [
    "connect",
    "Profiler.enable",
    "Profiler.setSamplingInterval",
    "Profiler.start",
    "Profiler.stop",
    "disconnect",
  ]);
  assert.equal(summaries.at(-1).status, "completed");
  assert.equal(summaries.at(-1).formalQualification, false);
});

test("late window ignores earlier requests and wrong events, then records 40/46 exactly once", async () => {
  const { observer, calls, summaries } = mockObserver({
    startRequest: 40,
    stopRequest: 46,
  });
  for (let request = 1; request < 40; request++) {
    observer.observe("undici:request:create", request);
    observer.observe("undici:request:trailers", request);
  }
  observer.observe("undici:request:create", 40);
  observer.observe("undici:request:headers", 40);
  observer.observe("undici:request:trailers", 41);
  assert.deepEqual(calls, []);
  observer.observe("undici:request:trailers", 40);
  observer.observe("undici:request:trailers", 40);
  await observer.settled();
  observer.observe("undici:request:create", 45);
  observer.observe("undici:request:trailers", 46);
  observer.observe("undici:request:create", 47);
  assert.equal(calls.includes("Profiler.stop"), false);
  observer.observe("undici:request:create", 46);
  observer.observe("undici:request:create", 46);
  await observer.settled();
  observer.finish();
  assert.equal(calls.filter((call) => call === "Profiler.start").length, 1);
  assert.equal(calls.filter((call) => call === "Profiler.stop").length, 1);
  const summary = summaries.at(-1);
  assert.equal(summary.status, "completed");
  assert.equal(summary.startRequest, 40);
  assert.equal(summary.stopRequest, 46);
  assert.equal(summary.startTrigger, "loopback-request-40-trailers");
  assert.equal(summary.stopTrigger, "loopback-request-46-create");
  assert.equal(summary.formalQualification, false);
  assert.equal(summary.limits.samples, 50000);
  assert.equal(summary.limits.bytes, 256 * 1024);
});

test("invalid request windows reject before connecting or observing", () => {
  for (const window of [
    { startRequest: 0, stopRequest: 46 },
    { startRequest: -1, stopRequest: 46 },
    { startRequest: 40.5, stopRequest: 46 },
    { startRequest: "40", stopRequest: 46 },
    { startRequest: NaN, stopRequest: 46 },
    { startRequest: 40, stopRequest: Infinity },
    { startRequest: 40, stopRequest: 46.5 },
    { startRequest: 40, stopRequest: "46" },
    { startRequest: 40, stopRequest: 40 },
    { startRequest: 46, stopRequest: 40 },
    { startRequest: 40, stopRequest: 101 },
  ])
    assert.throws(() => mockObserver(window), /invalid-cpu-request-window/);
  assert.doesNotThrow(() =>
    mockObserver({ startRequest: 1, stopRequest: 100 }),
  );
});

test("a missed late start or stop remains incomplete and never fabricates a profile", async () => {
  for (const startObserved of [false, true]) {
    const { observer, calls, summaries } = mockObserver({
      startRequest: 40,
      stopRequest: 46,
    });
    observer.observe("undici:request:trailers", 2);
    observer.observe("undici:request:create", 4);
    if (startObserved) observer.observe("undici:request:trailers", 40);
    await observer.settled();
    observer.observe("undici:request:trailers", 46);
    observer.finish();
    assert.equal(calls.includes("Profiler.stop"), false);
    assert.equal(summaries.at(-1).status, "incomplete");
    assert.equal(summaries.at(-1).topSelf, undefined);
  }
});

test("late stop during asynchronous profiler start is queued once", async () => {
  const { observer, calls, summaries, releaseStart } = mockObserver({
    startRequest: 40,
    stopRequest: 46,
    deferredStart: true,
  });
  observer.observe("undici:request:trailers", 40);
  await new Promise(setImmediate);
  observer.observe("undici:request:create", 46);
  observer.observe("undici:request:create", 46);
  releaseStart();
  await observer.settled();
  assert.equal(calls.filter((call) => call === "Profiler.stop").length, 1);
  assert.equal(summaries.at(-1).status, "completed");
});

test("stop received during inspector start is queued once and summary persists early", async () => {
  const { observer, calls, summaries, releaseStart } = mockObserver({
    deferredStart: true,
  });
  observer.observe("undici:request:trailers", 2);
  await new Promise(setImmediate);
  observer.observe("undici:request:create", 4);
  observer.observe("undici:request:create", 4);
  releaseStart();
  await observer.settled();
  assert.equal(calls.filter((call) => call === "Profiler.stop").length, 1);
  assert.equal(summaries.at(-1).status, "completed");
});

test("inspector failures are fixed-stage observer evidence and never escape", async () => {
  for (const failure of [
    "connect",
    "Profiler.enable",
    "Profiler.setSamplingInterval",
    "Profiler.start",
    "Profiler.stop",
  ]) {
    const { observer, summaries } = mockObserver({ failure });
    observer.observe("undici:request:trailers", 2);
    await observer.settled();
    observer.observe("undici:request:create", 4);
    await observer.settled();
    observer.finish();
    assert.equal(summaries.at(-1).status, "failed");
    assert.equal(JSON.stringify(summaries).includes("PRIVATE"), false);
  }
  const observer = createCpuObserver({
    createSession() {
      throw new Error("private");
    },
    sanitizeFrame: label,
    write() {
      throw new Error("private-write");
    },
  });
  observer.observe("undici:request:trailers", 2);
  await observer.settled();
  assert.doesNotThrow(() => observer.finish());
});

test("missing stop is explicitly incomplete and cannot invent samples", async () => {
  const { observer, summaries } = mockObserver();
  observer.observe("undici:request:trailers", 2);
  await observer.settled();
  observer.finish();
  assert.equal(summaries.at(-1).status, "incomplete");
  assert.equal(summaries.at(-1).topSelf, undefined);
});

test("node, sample, edge, depth, malformed, and unknown-time bounds are explicit", () => {
  const nodes = Array.from({ length: CPU_LIMITS.nodes + 1 }, (_, i) =>
    node(i + 1, [i + 2]),
  );
  nodes[0].children = Array.from(
    { length: CPU_LIMITS.edges + 1 },
    (_, i) => i + 2,
  );
  const result = summarizeCpuProfile(
    {
      nodes,
      samples: Array(CPU_LIMITS.samples + 1).fill(CPU_LIMITS.nodes + 1),
      timeDeltas: [-1],
    },
    () => "unknown",
  );
  assert.equal(result.truncated.nodes, true);
  assert.equal(result.truncated.samples, true);
  assert.equal(result.truncated.edges, true);
  assert.equal(result.unknownTimeSamples, CPU_LIMITS.samples);
  assert.equal(result.sampledMicros, 0);
  const deep = summarizeCpuProfile(
    {
      nodes: Array.from({ length: CPU_LIMITS.depth + 1 }, (_, i) =>
        node(i, [i + 1]),
      ),
      samples: [CPU_LIMITS.depth],
      timeDeltas: [10],
    },
    () => "unknown",
  );
  assert.equal(deep.truncated.depth, true);
  assert.equal(deep.topChains[0].frames.length, CPU_LIMITS.depth);
  const cycle = summarizeCpuProfile(
    { nodes: [node(1, [2]), node(2, [1])], samples: [2], timeDeltas: [10] },
    () => "unknown",
  );
  assert.ok(cycle.malformed > 0);
  assert.equal(summarizeCpuProfile(null, label).profileMissing, true);
});

test("chain aggregation and ranked output bounds preserve a bounded JSON summary", () => {
  const nodes = Array.from({ length: 1200 }, (_, i) => node(i));
  const result = summarizeCpuProfile(
    { nodes, samples: nodes.map((n) => n.id), timeDeltas: nodes.map(() => 10) },
    (frame) => frame.functionName,
  );
  assert.equal(result.truncated.chainAggregation, true);
  assert.equal(result.truncated.self, true);
  assert.equal(result.truncated.inclusive, true);
  assert.equal(result.truncated.chains, true);
  assert.equal(result.topSelf.length, CPU_LIMITS.self);
  const large = {
    topChains: Array(20).fill({
      frames: Array(CPU_LIMITS.depth).fill("x".repeat(1000)),
    }),
    topSelf: [],
    topInclusive: [],
    truncated: {},
  };
  const encoded = encodeCpuSummary(large);
  assert.ok(Buffer.byteLength(encoded) <= CPU_LIMITS.bytes);
  assert.equal(JSON.parse(encoded).truncated.output, true);
});

test("128-depth allowance preserves older truncated chains while staying bounded", () => {
  assert.equal(CPU_LIMITS.depth, 128);
  for (const depth of [40, 128]) {
    const summary = summarizeCpuProfile(
      {
        nodes: Array.from({ length: depth }, (_, i) =>
          node(i, i + 1 < depth ? [i + 1] : []),
        ),
        samples: [depth - 1],
        timeDeltas: [10],
      },
      () => "source-coordinate",
    );
    assert.equal(summary.truncated.depth, false);
    assert.equal(summary.topChains[0].frames.length, depth);
    assert.ok(Buffer.byteLength(encodeCpuSummary(summary)) <= 256 * 1024);
  }
});

test("loading helpers without diagnostic coordinates does not wrap transport", () => {
  const originalFetch = globalThis.fetch;
  delete require.cache[
    require.resolve("./duplex-turn-diagnostics-preload.cjs")
  ];
  require("./duplex-turn-diagnostics-preload.cjs");
  assert.equal(globalThis.fetch, originalFetch);
  const source = fs.readFileSync(
    new URL("./duplex-turn-diagnostics-preload.cjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /setGlobalDispatcher|globalThis\.fetch\s*=|request\.[A-Za-z]+\s*=/,
  );
});
