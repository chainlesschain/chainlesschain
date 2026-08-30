import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

describe("ProcessExecutionBroker ambient process context", () => {
  it("grants only the exact absolute command and restores outer state", async () => {
    const allowed = resolve(process.execPath);
    const denied = resolve(process.cwd(), "not-the-browser");

    expect(executionBroker._withAmbientProcessContext(allowed, {})).toEqual({});

    await executionBroker.runWithProcessContext(
      {
        origin: "record-replay:test-browser",
        policy: "allow",
        scope: "test",
        allowedCommands: [allowed],
        auditContext: { actor: "test" },
      },
      async () => {
        await Promise.resolve();
        expect(
          executionBroker._withAmbientProcessContext(allowed, {
            origin: "caller-override",
            scope: "caller-override",
            policy: "deny",
            auditContext: { actor: "caller-override" },
          }),
        ).toMatchObject({
          origin: "record-replay:test-browser",
          policy: "allow",
          scope: "test",
          auditContext: { actor: "test" },
        });
        expect(
          executionBroker._withAmbientProcessContext(denied, {}),
        ).toMatchObject({
          origin: "record-replay:test-browser",
          policy: "deny",
        });
      },
    );

    expect(executionBroker._withAmbientProcessContext(allowed, {})).toEqual({});
  });

  it("rejects relative command grants", () => {
    expect(() =>
      executionBroker.runWithProcessContext(
        {
          origin: "record-replay:test-browser",
          allowedCommands: ["chromium"],
        },
        () => {},
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PROCESS_CONTEXT_INVALID" }),
    );
  });
});
