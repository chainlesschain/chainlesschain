import { describe, expect, it } from "vitest";
import {
  parseToolArguments,
  projectRejectedToolArguments,
  TOOL_ARGUMENTS_INVALID_CODE,
} from "../../src/runtime/tool-argument-recovery.js";

const malformed = '{"language">bash</parameter>\n<parameter: ';
const rejection = {
  code: TOOL_ARGUMENTS_INVALID_CODE,
  execution_started: false,
  error: "Invalid tool arguments",
};
function history(args = malformed, result = rejection, name = "run_code") {
  return [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "bad-call",
          type: "function",
          function: { name, arguments: args },
        },
      ],
    },
    { role: "tool", tool_call_id: "bad-call", content: JSON.stringify(result) },
  ];
}

describe("tool argument recovery", () => {
  it.each([malformed, "", "null", "[]", "true", '"text"', undefined, null])(
    "rejects non-object arguments without executable defaults: %s",
    (value) => expect(parseToolArguments(value)).toBeNull(),
  );

  it("accepts string and object arguments without changing their data", () => {
    const args = { path: "README.md" };
    expect(parseToolArguments(args)).toBe(args);
    expect(parseToolArguments(JSON.stringify(args))).toEqual(args);
  });

  it.each([malformed, "", "null", "[]", "false"])(
    "omits rejected argument text only from the derived request: %s",
    (args) => {
      const messages = history(args);
      const original = structuredClone(messages);
      const projected = projectRejectedToolArguments(messages);
      expect(projected[0].tool_calls[0].function.arguments).toBe("{}");
      expect(JSON.parse(projected[1].content)).toMatchObject({
        ...rejection,
        argumentRecovery: expect.stringContaining("rejected before execution"),
      });
      expect(messages).toEqual(original);
      expect(projectRejectedToolArguments(projected)).toBe(projected);
    },
  );

  it("recovers the exact legacy dispatch rejection while retaining result fields", () => {
    const result = {
      error: "run_code language must be a non-empty string",
      policy: {
        code: "CC_RUN_CODE_EXECUTION_SNAPSHOT_INVALID",
        via: "run-code-execution-snapshot",
        decision: "blocked",
      },
      retainedReadContext: ["Branch analysis finished"],
    };
    const projected = projectRejectedToolArguments(history(malformed, result));
    expect(projected[0].tool_calls[0].function.arguments).toBe("{}");
    expect(JSON.parse(projected[1].content)).toMatchObject(result);
    for (const policy of [
      { ...result.policy, code: "another-code" },
      { ...result.policy, via: "another-via" },
      { ...result.policy, decision: "allowed" },
    ]) {
      const messages = history(malformed, { ...result, policy });
      expect(projectRejectedToolArguments(messages)).toBe(messages);
    }
    const otherTool = history(malformed, result, "git");
    expect(projectRejectedToolArguments(otherTool)).toBe(otherTool);
  });

  it.each([null, [], false, 1, undefined].map((value) => [value]))(
    "recovers rejected non-object provider arguments: %s",
    (args) => {
      const messages = history();
      messages[0].tool_calls[0].function.arguments = args;
      const original = structuredClone(messages);
      const projected = projectRejectedToolArguments(messages);
      expect(projected[0].tool_calls[0].function.arguments).toBe("{}");
      expect(messages).toEqual(original);
    },
  );

  it("never repairs valid objects, including duplicate keys or nested malformed data", () => {
    for (const args of [
      '{"path":"first","path":"second"}',
      JSON.stringify({ note: '{"password":"secret",}' }),
      "{}",
    ]) {
      const messages = history(args);
      expect(projectRejectedToolArguments(messages)).toBe(messages);
    }
  });

  it.each([
    "missing-result",
    "duplicate-call",
    "duplicate-result",
    "other-round",
    "executed",
    "error-text",
  ])(
    "leaves ambiguous or unproven history for strict admission: %s",
    (mode) => {
      const messages = history();
      if (mode === "missing-result") messages.pop();
      if (mode === "duplicate-call")
        messages.push(structuredClone(messages[0]));
      if (mode === "duplicate-result")
        messages.push(structuredClone(messages[1]));
      if (mode === "other-round")
        messages.splice(1, 0, { role: "user", content: "Continue" });
      if (mode === "executed")
        messages[1].content = JSON.stringify({
          ...rejection,
          execution_started: true,
        });
      if (mode === "error-text")
        messages[1].content = JSON.stringify({
          error: "run_code language must be a non-empty string",
        });
      expect(projectRejectedToolArguments(messages)).toBe(messages);
    },
  );

  it("recovers multiple rejected calls in a mixed completed round", () => {
    const messages = history();
    messages[0].tool_calls.push({
      id: "second-bad-call",
      type: "function",
      function: { name: "read_file", arguments: "null" },
    });
    messages.push({
      role: "tool",
      tool_call_id: "second-bad-call",
      content: JSON.stringify(rejection),
    });
    const original = structuredClone(messages);
    const projected = projectRejectedToolArguments(messages);
    expect(
      projected[0].tool_calls.map((call) => call.function.arguments),
    ).toEqual(["{}", "{}"]);
    expect(messages).toEqual(original);
  });
});
