export const TOOL_ARGUMENTS_INVALID_CODE = "CC_TOOL_ARGUMENTS_INVALID";

// Never infer executable arguments from a partial provider response. In
// particular, a parse failure must not become an executable empty object.
export function parseToolArguments(value) {
  try {
    const args = typeof value === "string" ? JSON.parse(value) : value;
    if (!args || typeof args !== "object" || Array.isArray(args)) return null;
    const prototype = Object.getPrototypeOf(args);
    return prototype === Object.prototype || prototype === null ? args : null;
  } catch {
    return null;
  }
}

function isUnexecutedArgumentRejection(result) {
  return (
    (result?.code === TOOL_ARGUMENTS_INVALID_CODE &&
      result.execution_started === false) ||
    (result?.policy?.code === "CC_RUN_CODE_EXECUTION_SNAPSHOT_INVALID" &&
      result.policy.via === "run-code-execution-snapshot" &&
      result.policy.decision === "blocked")
  );
}

// Old sessions can contain a malformed provider call paired with a dispatch
// rejection. Keep the durable transcript intact; derive a model-only copy so
// that strict JSON projection and strict providers can admit the next turn.
// This grants no execution authority and never repairs or forwards the bad text.
export function projectRejectedToolArguments(messages) {
  const callCounts = new Map();
  const resultCounts = new Map();
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        callCounts.set(call?.id, (callCounts.get(call?.id) || 0) + 1);
      }
    }
    if (message.role === "tool") {
      const id = message.tool_call_id;
      resultCounts.set(id, (resultCounts.get(id) || 0) + 1);
    }
  }
  let output = messages;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls))
      continue;
    for (
      let callIndex = 0;
      callIndex < message.tool_calls.length;
      callIndex++
    ) {
      const call = message.tool_calls[callIndex];
      if (
        typeof call?.id !== "string" ||
        !call.id ||
        callCounts.get(call.id) !== 1 ||
        resultCounts.get(call.id) !== 1 ||
        !call.function ||
        (call.function.arguments !== null &&
          typeof call.function.arguments === "object" &&
          !Array.isArray(call.function.arguments)) ||
        ["function", "symbol", "bigint"].includes(
          typeof call.function.arguments,
        ) ||
        parseToolArguments(call.function.arguments) !== null
      )
        continue;
      let resultIndex = index + 1;
      while (
        resultIndex < messages.length &&
        messages[resultIndex].role === "tool" &&
        messages[resultIndex].tool_call_id !== call.id
      )
        resultIndex++;
      const result = messages[resultIndex];
      if (result?.role !== "tool" || result.tool_call_id !== call.id) continue;
      let content;
      try {
        content = JSON.parse(result.content);
      } catch {
        continue;
      }
      if (!isUnexecutedArgumentRejection(content)) continue;
      // The legacy dispatch code belongs only to run_code.
      if (
        content.code !== TOOL_ARGUMENTS_INVALID_CODE &&
        call.function.name !== "run_code"
      )
        continue;
      if (output === messages) output = [...messages];
      const calls = [...output[index].tool_calls];
      calls[callIndex] = {
        ...call,
        function: { ...call.function, arguments: "{}" },
      };
      output[index] = { ...output[index], tool_calls: calls };
      output[resultIndex] = {
        ...result,
        content: JSON.stringify({
          ...content,
          argumentRecovery:
            "Malformed original arguments were omitted from this model request. " +
            "The call was rejected before execution. Issue a new call with a valid JSON object if still appropriate.",
        }),
      };
    }
  }
  return output;
}
