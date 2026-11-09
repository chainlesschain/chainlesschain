import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createDurableMemoryFixture } from "./persistent-capacity-benchmark.mjs";
import {
  measureMemoryStop,
  summarizeMemoryStopSamples,
} from "./memory-query-responsiveness-benchmark.mjs";

const records = Object.values(createDurableMemoryFixture(20).records);

async function timedSample(
  t,
  { settleMs, deliverMs, abort = false, lock = false },
) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "cc-memory-stop-timing-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("cc-memory-stop-timing-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolvePage, rejectPage, signal;
  const filePath = path.join(root, "authority.json");
  const pendingPage = new Promise((resolve, reject) => {
    resolvePage = resolve;
    rejectPage = reject;
  });
  const measurement = measureMemoryStop({
    filePath,
    listPage(options) {
      signal = options.signal;
      return pendingPage;
    },
  });
  // A deliberate retained-lock case can reject before the helper returns.
  // Observe it now while still returning the original promise to the test.
  measurement.catch(() => {});
  if (lock) fs.writeFileSync(`${filePath}.lock`, "retained");
  const deliver = () => {
    now = deliverMs;
    t.mock.timers.tick(10);
    assert.equal(signal.aborted, true);
  };
  const settle = async () => {
    now = settleMs;
    if (abort) rejectPage(new DOMException("Stopped", "AbortError"));
    else resolvePage({ records, nextCursor: null, storeRevision: 20 });
    // Drain both the service and measurement continuations before delivery.
    await setImmediate();
  };
  if (deliverMs <= settleMs) {
    deliver();
    await settle();
  } else {
    await settle();
    assert.equal(signal.aborted, false);
    deliver();
  }
  return measurement;
}

test("the original macOS sample completed before actual Stop delivery, without an ACK", async (t) => {
  const sample = await timedSample(t, {
    settleMs: 10.76879100000042,
    deliverMs: 10.799666000000343,
  });
  assert.equal(sample.queryMs, 10.76879100000042);
  assert.equal(sample.resultCount, 20);
  assert.equal(sample.completedBeforeStopDeadline, false);
  assert.equal(sample.deliveredStopMs, 10.799666000000343);
  assert.equal(sample.completedBeforeStopDelivery, true);
  const summary = summarizeMemoryStopSamples([sample]);
  assert.equal(summary.acknowledged, 0);
  assert.equal(summary.lateSuccessfulCompletion, 1);
  assert.equal(summary.completedBeforeStopDelivery, 1);
  assert.equal(summary.successfulCompletionAfterStopDelivery, 0);
  assert.equal(summary.targetMet, true);
});

test("successful completion after Stop delivery must fail even before its nominal deadline", async (t) => {
  const sample = await timedSample(t, { settleMs: 9.5, deliverMs: 9 });
  assert.equal(sample.completedBeforeStopDeadline, true);
  assert.equal(sample.resultCount, 20);
  assert.equal(sample.completedBeforeStopDelivery, false);
  assert.equal(summarizeMemoryStopSamples([sample]).targetMet, false);
});

test("successful completion after the actual Stop and nominal deadline must fail", async (t) => {
  const sample = await timedSample(t, { settleMs: 10.8, deliverMs: 10.7 });
  assert.equal(summarizeMemoryStopSamples([sample]).targetMet, false);
});

test("completed work before Stop remains completed work, never cancellation acknowledgement", async (t) => {
  const sample = await timedSample(t, { settleMs: 8, deliverMs: 10 });
  const summary = summarizeMemoryStopSamples([sample]);
  assert.equal(sample.resultCount, 20);
  assert.equal(summary.acknowledged, 0);
  assert.equal(summary.targetMet, true);
});

test("both original 500 ms bounds still reject excessive latency", async (t) => {
  const sample = await timedSample(t, {
    settleMs: 15,
    deliverMs: 10,
    abort: true,
  });
  assert.equal(sample.outcome, "aborted");
  assert.equal(sample.resultCount, null);
  assert.equal(summarizeMemoryStopSamples([sample]).acknowledged, 1);
  assert.equal(summarizeMemoryStopSamples([sample]).targetMet, true);
  assert.equal(
    summarizeMemoryStopSamples([{ ...sample, stopDeliveryDelayMs: 500.001 }])
      .targetMet,
    false,
  );
  assert.equal(
    summarizeMemoryStopSamples([{ ...sample, stopAcknowledgementMs: 500.001 }])
      .targetMet,
    false,
  );
});

test("retaining an authority lock still rejects a settled query", async (t) => {
  await assert.rejects(
    timedSample(t, { settleMs: 15, deliverMs: 10, abort: true, lock: true }),
    /settled query retained its authority lock/,
  );
});
