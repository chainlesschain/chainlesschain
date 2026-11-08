import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  withGoalJourneyTimeout,
  writeGoalJourneyEvidence,
  summarizeGoalJourneyError,
} = require("../lib/project-goal-journey-observer.cjs");

test("evidence does not publish success before terminal cleanup", () => {
  const parent = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "cc-journey-evidence-"));
  try {
    const evidence = { status: "passed", stages: [] };
    assert.equal(writeGoalJourneyEvidence(directory, evidence), true);
    const read = () =>
      JSON.parse(fs.readFileSync(path.join(directory, "journey.json"), "utf8"));
    assert.equal(read().status, "finalizing");
    assert.equal(
      writeGoalJourneyEvidence(directory, evidence, { terminal: true }),
      true,
    );
    assert.equal(read().status, "passed");
    evidence.watchdogExpired = true;
    assert.equal(
      writeGoalJourneyEvidence(directory, evidence, { terminal: true }),
      true,
    );
    assert.equal(read().status, "failed");
    assert.deepEqual(fs.readdirSync(directory), ["journey.json"]);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), parent);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a persistence failure does not throw across cleanup or replace the business error", () => {
  const parent = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "cc-journey-evidence-"));
  try {
    const blocked = path.join(directory, "not-a-directory");
    fs.writeFileSync(blocked, "synthetic");
    const original = { message: "original business failure" };
    const evidence = { status: "failed", error: original };
    assert.equal(
      writeGoalJourneyEvidence(blocked, evidence, { required: false }),
      false,
    );
    assert.equal(evidence.error, original);
    assert.ok(evidence.persistenceError);
    evidence.status = "passed";
    assert.equal(
      writeGoalJourneyEvidence(directory, evidence, { terminal: true }),
      true,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, "journey.json"), "utf8"))
        .status,
      "failed",
    );
    assert.throws(() => writeGoalJourneyEvidence(blocked, evidence));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), parent);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("public error summaries cannot include the driver's appended application log", () => {
  const error = new Error(
    "fake-key-in-first-line\nCall log:\nprivate-application-log",
  );
  error.stack = "private-stack";
  const summary = JSON.stringify(summarizeGoalJourneyError(error));
  for (const privateValue of [
    "fake-key",
    "Call log",
    "private-application-log",
    "private-stack",
  ])
    assert.equal(summary.includes(privateValue), false);
  const timeout = Object.assign(
    new Error(
      "electronApplication.firstWindow: Timeout 180000ms exceeded\nCall log:\nprivate",
    ),
    { name: "TimeoutError" },
  );
  assert.deepEqual(summarizeGoalJourneyError(timeout), {
    name: "TimeoutError",
    message: "Journey driver timeout after 180000ms",
  });
});

test("journey observations retain resolved results", async () => {
  const value = { diagnostics: ["synthetic"] };
  assert.equal(await withGoalJourneyTimeout(() => value), value);
});

test("a hung driver observation has a bounded failure", async () => {
  await assert.rejects(
    withGoalJourneyTimeout(() => new Promise(() => {}), 10),
    { code: "GOAL_JOURNEY_OBSERVATION_TIMEOUT" },
  );
});

test("original synchronous and asynchronous driver failures are retained", async () => {
  const failure = new Error("synthetic driver failure");
  await assert.rejects(
    withGoalJourneyTimeout(() => {
      throw failure;
    }),
    (error) => error === failure,
  );
  await assert.rejects(
    withGoalJourneyTimeout(() => Promise.reject(failure)),
    (error) => error === failure,
  );
});

test("a rejection arriving after the deadline is observed without an unhandled rejection", async () => {
  let reject;
  const pending = new Promise((_, fail) => {
    reject = fail;
  });
  await assert.rejects(
    withGoalJourneyTimeout(() => pending, 10),
    { code: "GOAL_JOURNEY_OBSERVATION_TIMEOUT" },
  );
  reject(new Error("synthetic late driver failure"));
  await new Promise(setImmediate);
});

test("invalid observation deadlines fail before invoking the driver", async () => {
  for (const timeoutMs of [0, -1, 1.5, NaN]) {
    let called = false;
    await assert.rejects(
      withGoalJourneyTimeout(() => {
        called = true;
      }, timeoutMs),
      RangeError,
    );
    assert.equal(called, false);
  }
});
