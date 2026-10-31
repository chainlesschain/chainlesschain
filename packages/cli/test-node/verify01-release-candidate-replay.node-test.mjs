import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adaptSessionStoreFixture,
  summarizeReplay,
  validateReplayOutput,
} from "../scripts/verify01-release-candidate-replay.mjs";

test("fixture adaptation adds only the current storage helper and preserves behavioral assertions", () => {
  const source = [
    'vi.mock("../src/lib/paths.js", () => ({',
    '  getHomeDir: () => join(root, "home"),',
    "}));",
    'expect(resolve(capability, "wrong-parent", messages)).toThrow();',
  ].join("\n");
  const adapted = adaptSessionStoreFixture(source);
  assert.equal(adapted.changed, true);
  assert.equal(adapted.source.replace(adapted.addition, ""), source);
  assert.deepEqual(adaptSessionStoreFixture(adapted.source), {
    source: adapted.source,
    changed: false,
  });
  assert.throws(
    () => adaptSessionStoreFixture(source + "\n" + source),
    /Ambiguous/,
  );
  assert.throws(() =>
    adaptSessionStoreFixture(source.replace('join(root, "home")', '"other"')),
  );
  assert.deepEqual(adaptSessionStoreFixture("expect(allowed).toEqual([]);"), {
    source: "expect(allowed).toEqual([]);",
    changed: false,
  });
});

function result(statuses, messages = [], fileMessage = "") {
  return {
    numTotalTests: statuses.length,
    numPassedTests: statuses.filter((status) => status === "passed").length,
    numFailedTests: statuses.filter((status) => status === "failed").length,
    numPendingTests: statuses.filter((status) => status === "pending").length,
    numTodoTests: 0,
    success: !statuses.includes("failed"),
    testResults: [
      {
        name: "/fixture/candidate.test.js",
        status:
          statuses.includes("failed") || fileMessage ? "failed" : "passed",
        message: fileMessage,
        assertionResults: statuses.map((status, index) => ({
          fullName: "case " + index,
          status,
          failureMessages: status === "failed" ? messages : [],
        })),
      },
    ],
  };
}

test("only a normal failed assertion rejects a mutation; loading, runner and timeout errors do not", () => {
  const failed = result(
    ["failed"],
    ["AssertionError: expected false to be true"],
  );
  const execution = { status: 1, signal: null, error: null };
  assert.equal(summarizeReplay(failed, execution).rejectedByAssertions, true);
  for (const message of [
    "TypeError: value is undefined",
    "Error: ENOENT",
    "SyntaxError: invalid token",
  ]) {
    assert.equal(
      summarizeReplay(result(["failed"], [message]), execution)
        .rejectedByAssertions,
      false,
    );
  }
  assert.equal(
    summarizeReplay(failed, { ...execution, status: 2 }).rejectedByAssertions,
    false,
  );
  assert.equal(
    summarizeReplay(failed, { ...execution, signal: "SIGTERM" })
      .rejectedByAssertions,
    false,
  );
  assert.equal(
    summarizeReplay(failed, { ...execution, error: "timeout", status: null })
      .rejectedByAssertions,
    false,
  );
  assert.equal(
    summarizeReplay(result([], [], "Failed to load module"), execution)
      .rejectedByAssertions,
    false,
  );
  assert.equal(
    summarizeReplay(
      result(
        ["failed"],
        failed.testResults[0].assertionResults[0].failureMessages,
        "ERR_MODULE_NOT_FOUND",
      ),
      execution,
    ).rejectedByAssertions,
    false,
  );
});

test("zero cases, skipped candidate controls and teardown failures cannot become clean candidate passes", () => {
  const execution = { status: 0, signal: null, error: null };
  assert.equal(
    summarizeReplay(result(["passed"]), execution).passedCleanly,
    true,
  );
  assert.equal(summarizeReplay(result([]), execution).passedCleanly, false);
  assert.equal(
    summarizeReplay(result(["passed", "pending"]), execution).passedCleanly,
    false,
  );
  assert.equal(
    summarizeReplay(result(["passed", "pending"]), execution, {
      baseline: true,
    }).passedCleanly,
    true,
  );
  assert.equal(
    summarizeReplay(result(["passed"]), { ...execution, status: 1 })
      .passedCleanly,
    false,
  );
});

test("a replay cannot overwrite any input evidence, including through a directory junction", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-replay-paths-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, "archive");
  fs.mkdirSync(archive);
  const proof = path.join(root, "proof.json");
  fs.writeFileSync(proof, "{}");
  assert.throws(() =>
    validateReplayOutput(path.join(archive, "new.json"), archive, proof),
  );
  assert.throws(() => validateReplayOutput(proof, archive, proof));
  const alias = path.join(root, "alias");
  fs.symlinkSync(
    archive,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() =>
    validateReplayOutput(path.join(alias, "new.json"), archive, proof),
  );
  const output = path.join(root, "results", "new.json");
  assert.equal(validateReplayOutput(output, archive, proof), output);
});
