import { expect, it } from "vitest";
import {
  executionLocationFailureSite,
  formatExecutionLocationFailureSite,
  readExecutionLocationFailureSite,
  readExecutionLocationStorageFailure,
} from "../../src/lib/execution-location-failure-site.js";
import { prepareSessionReplicaHandoff } from "../../src/commands/session-location.js";

it.each([
  "repair-lock:0x80070005",
  "repair-write:0x80070522",
  "timeout",
  "output",
])(
  "preserves a fixed native ACL diagnostic without private content: %s",
  (diagnostic) => {
    expect(
      readExecutionLocationStorageFailure(
        `private-session [windows-acl:${diagnostic}] private-path`,
      ),
    ).toBe(diagnostic);
  },
);

it.each([
  "[windows-acl:private-path:0x80070005]",
  "[windows-acl:lookup:private-session]",
  "[windows-acl:lookup:0x800700050]",
  "[windows-acl:lookup:0x80070005:private-session]",
  "x".repeat(8192) + "[windows-acl:timeout]",
])("rejects arbitrary or oversized native ACL diagnostics", (stderr) => {
  expect(readExecutionLocationStorageFailure(stderr)).toBeNull();
});

it("extracts a public source label from a real command failure without private text", () => {
  let failure;
  try {
    prepareSessionReplicaHandoff(
      "fixture",
      {},
      {
        readSessionReplicaInput() {
          throw new Error("private-session-sentinel");
        },
      },
    );
  } catch (error) {
    failure = error;
  }
  const site = executionLocationFailureSite(failure);
  expect(site).toMatch(/^session-location:[1-9][0-9]+$/u);
  const diagnostic = formatExecutionLocationFailureSite(failure);
  expect(readExecutionLocationFailureSite(diagnostic)).toBe(site);
  expect(diagnostic).not.toContain("private-session-sentinel");
  expect(diagnostic).not.toContain(process.cwd());
});

it.each([
  "file:///D:/private-account/repo/packages/cli/src/lib/secure-fs.js:1134:13",
  "D:\\private-account\\repo\\packages\\cli\\src\\lib\\secure-fs.js:1134:13",
  "file:///private-account/repo/packages/cli/src/lib/secure-fs.js:1134:13",
])("normalizes supported stack paths without releasing them: %s", (site) => {
  const stack = `Error: private-text\n    at inspect (${site})`;
  expect(executionLocationFailureSite({ stack })).toBe("private-storage:1134");
  expect(readExecutionLocationFailureSite(stack)).toBe("private-storage:1134");
});

it.each([
  "CC_EXECUTION_LOCATION_FAILURE_SITE=private-text:123\n",
  "CC_EXECUTION_LOCATION_FAILURE_SITE=session-store:123:private-text\n",
  "CC_EXECUTION_LOCATION_FAILURE_SITE=session-store:1234567\n",
  "CC_EXECUTION_LOCATION_FAILURE_SITE=session-store:0\n",
  "Error: private-text\n    at inspect (file:///private-text/secret.js:123:4)",
  "Error: private-text\n    at inspect (file:///repo/packages/cli/src/lib/secret.js:123:4)",
])(
  "discards unknown labels, locations and malformed marker fields",
  (stderr) => {
    expect(readExecutionLocationFailureSite(stderr)).toBeNull();
  },
);

it("bounds scanning of untrusted diagnostics", () => {
  expect(
    readExecutionLocationFailureSite(
      "x".repeat(8192) +
        "\nCC_EXECUTION_LOCATION_FAILURE_SITE=session-store:123\n",
    ),
  ).toBeNull();
});
