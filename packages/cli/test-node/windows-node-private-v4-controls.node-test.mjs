import assert from "node:assert/strict";
import test from "node:test";
import {
  privateV4BehaviorControls,
  inspectPrivateV4ControlResults,
} from "../scripts/windows-node-private-v4-controls.mjs";
import { diagnosticCandidate } from "../scripts/verify01-review-pack-diagnostic.mjs";
import { VERIFY01_REVIEW_SPECS } from "../scripts/verify01-review-specs.mjs";

const ids = ["verify-12", "verify-20", "verify-29", "verify-30"];
function reporter(controls, mutant = false) {
  return {
    testResults: controls.map((control) => ({
      name: "X:/workspace/tree/" + control.relativePath,
      assertionResults: control.names.map((fullName, index) => ({
        fullName,
        status: mutant && index === 0 ? "failed" : "passed",
        failureMessages:
          mutant && index === 0
            ? ["AssertionError: expected wrong to equal correct"]
            : [],
      })),
    })),
  };
}
for (const id of ids)
  test(`${id} reuses Linux behavior control bytes without frozen baseline imports`, () => {
    const [control] = privateV4BehaviorControls([id]);
    const spec = VERIFY01_REVIEW_SPECS.find((row) => row.taskId === id);
    const linux = diagnosticCandidate(
      { expectedFiles: [control.relativePath] },
      spec,
    );
    assert.ok(linux.endsWith(control.text));
    for (const file of spec.baselineTests)
      assert.ok(!control.text.includes(file));
    assert.equal(control.names.length, id === "verify-30" ? 2 : 1);
  });
test("control selection is deterministic and excludes tasks without supplemental coverage", () => {
  assert.deepEqual(
    privateV4BehaviorControls([...ids].reverse()),
    privateV4BehaviorControls(ids),
  );
  assert.deepEqual(privateV4BehaviorControls(["verify-01"]), []);
  for (const invalid of [[], ["unknown"], ["verify-12", "verify-12"], null])
    assert.throws(() => privateV4BehaviorControls(invalid));
});
for (const mutant of [false, true])
  test(`${mutant ? "mutant" : "baseline"} requires every generated assertion`, () => {
    const controls = privateV4BehaviorControls(ids);
    assert.equal(
      inspectPrivateV4ControlResults(
        JSON.stringify(reporter(controls, mutant)),
        controls,
        { mutant },
      ).verified,
      true,
    );
  });
const negatives = [
  [
    "extra unrelated file",
    (r) =>
      r.testResults.push({
        name: "X:/workspace/tree/unrelated.test.js",
        assertionResults: [{ fullName: "unrelated", status: "passed" }],
      }),
  ],
  ["missing file", (r) => r.testResults.pop()],
  ["duplicate file", (r) => r.testResults.push(r.testResults[0])],
  [
    "wrong directory",
    (r) => {
      r.testResults[0].name = r.testResults[0].name.replace(
        "workspace/tree",
        "scratch",
      );
    },
  ],
  ["missing assertion", (r) => r.testResults[0].assertionResults.pop()],
  [
    "duplicate assertion",
    (r) =>
      r.testResults[0].assertionResults.push(
        r.testResults[0].assertionResults[0],
      ),
  ],
  [
    "unknown assertion",
    (r) => {
      r.testResults[0].assertionResults[0].fullName = "unrelated";
    },
  ],
  [
    "pending assertion",
    (r) => {
      r.testResults[0].assertionResults[0].status = "pending";
    },
  ],
  [
    "skipped assertion",
    (r) => {
      r.testResults[0].assertionResults[0].status = "skipped";
    },
  ],
  [
    "failed baseline",
    (r) => {
      r.testResults[0].assertionResults[0].status = "failed";
    },
  ],
];
test("frozen baseline files must actually be present and nonempty in reporter", () => {
  const controls = privateV4BehaviorControls(["verify-12"]);
  const frozenTests = [
    "packages/cli/__tests__/unit/background-command-argv.test.js",
  ];
  const raw = reporter(controls);
  const inspect = () =>
    inspectPrivateV4ControlResults(JSON.stringify(raw), controls, {
      frozenTests,
    });
  assert.equal(inspect().verified, false);
  const baseline = {
    name: "X:/workspace/tree/" + frozenTests[0],
    assertionResults: [],
  };
  raw.testResults.push(baseline);
  assert.equal(inspect().verified, false);
  baseline.assertionResults.push({
    fullName: "original baseline case",
    status: "passed",
  });
  assert.equal(inspect().verified, true);
  raw.testResults.push(baseline);
  assert.equal(inspect().verified, false);
});
test("an unrelated baseline assertion cannot substitute for a surviving control", () => {
  const controls = privateV4BehaviorControls(["verify-12"]),
    raw = reporter(controls);
  const frozenTests = ["baseline.test.js"];
  raw.testResults.push({
    name: "X:/workspace/tree/baseline.test.js",
    assertionResults: [
      {
        fullName: "unrelated",
        status: "failed",
        failureMessages: ["AssertionError: expected bad to equal good"],
      },
    ],
  });
  assert.equal(
    inspectPrivateV4ControlResults(JSON.stringify(raw), controls, {
      frozenTests,
      mutant: true,
    }).verified,
    false,
  );
});
test("a timeout or application error alongside a genuine control failure is rejected", () => {
  const controls = privateV4BehaviorControls(["verify-30"]);
  for (const message of [
    "Error: Test timed out in 90000ms",
    "Error: Hook timed out in 120000ms",
    "TimeoutError: worker deadline",
    "Error: unexpected application error",
  ]) {
    const raw = reporter(controls, true);
    raw.testResults[0].assertionResults[1].status = "failed";
    raw.testResults[0].assertionResults[1].failureMessages = [message];
    assert.equal(
      inspectPrivateV4ControlResults(JSON.stringify(raw), controls, {
        mutant: true,
      }).verified,
      false,
    );
  }
});
for (const [name, change] of negatives)
  test(`rejects ${name}`, () => {
    const controls = privateV4BehaviorControls(ids),
      raw = reporter(controls);
    change(raw);
    assert.equal(
      inspectPrivateV4ControlResults(JSON.stringify(raw), controls).verified,
      false,
    );
  });
for (const message of [
  "Error: expected application failure",
  "SyntaxError: invalid source",
  "Error: Cannot find module",
  "ordinary AssertionError inside prose",
])
  test(`does not accept application or loader failure: ${message}`, () => {
    const controls = privateV4BehaviorControls(["verify-12"]),
      raw = reporter(controls, true);
    raw.testResults[0].assertionResults[0].failureMessages = [message];
    assert.equal(
      inspectPrivateV4ControlResults(JSON.stringify(raw), controls, {
        mutant: true,
      }).verified,
      false,
    );
  });
test("passing mutant and missing or truncated reporter cannot become success", () => {
  const controls = privateV4BehaviorControls(ids);
  for (const stdout of [
    JSON.stringify(reporter(controls)),
    undefined,
    "{",
    "{}",
    "{}\n{}",
  ]) {
    assert.equal(
      inspectPrivateV4ControlResults(stdout, controls, { mutant: true })
        .verified,
      false,
    );
  }
});
