import assert from "node:assert/strict";
import test from "node:test";

import { isRobotStartupFailure } from "./run-ui-host-journey.mjs";

test("recognizes the UI test's Remote Robot startup timeout", () => {
  const error = new Error("Gradle UI smoke test failed");
  error.processOutput =
    "robot server at http://127.0.0.1:8082 did not come up within 180s";

  assert.equal(isRobotStartupFailure(error), true);
});

test("recognizes the host driver's Remote Robot startup timeout", () => {
  assert.equal(
    isRobotStartupFailure(
      new Error("Remote Robot did not become ready within 1200000ms"),
    ),
    true,
  );
});

test("recognizes an IDE process that exits during startup", () => {
  assert.equal(
    isRobotStartupFailure(
      new Error("sandbox IDE exited before Remote Robot became ready"),
    ),
    true,
  );
});

test("does not retry a real journey assertion failure", () => {
  assert.equal(
    isRobotStartupFailure(new Error("expected the approval card to be visible")),
    false,
  );
});
