/**
 * Mock LLM Provider — Phase 7 Parity Harness foundation.
 *
 * Produces a deterministic `chatWithTools`-shaped function from a scripted
 * sequence of responses. Each script entry describes what the mock returns
 * for the next LLM call, in order. This is the foundation for golden-
 * transcript parity tests in `packages/cli/__tests__/integration/parity-*`.
 *
 * Design goals:
 *   - Zero network, zero provider SDK — pure in-memory dispatch
 *   - Same return shape as real `chatWithTools`: `{ message: { role, content, tool_calls? } }`
 *   - Supports tool_calls to drive multi-turn agent loops
 *   - Runs out of steps cleanly (throws a descriptive error) so tests can't
 *     silently loop forever
 *   - Optional match predicates per step let tests assert that the loop
 *     is feeding back the expected messages before the mock replies
 *
 * Example:
 *
 *   const mock = createMockLLMProvider([
 *     {
 *       // First LLM call — ask for a tool invocation
 *       response: {
 *         message: {
 *           role: "assistant",
 *           content: "",
 *           tool_calls: [
 *             {
 *               id: "call_1",
 *               type: "function",
 *               function: {
 *                 name: "read_file",
 *                 arguments: JSON.stringify({ path: "README.md" }),
 *               },
 *             },
 *           ],
 *         },
 *       },
 *     },
 *     {
 *       // Second LLM call — produce the final assistant text
 *       expect: (messages) =>
 *         messages.some((m) => m.role === "tool" && m.name === "read_file"),
 *       response: {
 *         message: { role: "assistant", content: "Done." },
 *       },
 *     },
 *   ]);
 *
 *   // Drop-in replacement for chatWithTools:
 *   await agentLoop(messages, { ...opts, chatFn: mock.chatFn });
 *
 *   mock.assertDrained(); // verify the loop consumed every scripted response
 */

/**
 * @typedef {object} MockScriptStep
 * @property {(messages: Array<object>, options: object) => boolean} [expect]
 *   Optional predicate run against the messages passed to the mock. If it
 *   returns false, the mock throws — this lets tests assert that the loop
 *   is in the expected state before it receives the next scripted reply.
 * @property {object} response
 *   The value the mock returns. Must match the `chatWithTools` shape:
 *   `{ message: { role, content, tool_calls? } }`.
 */

/**
 * Create a mock LLM provider backed by a scripted sequence.
 *
 * @param {Array<MockScriptStep>} script
 * @returns {{ chatFn: Function, calls: Array<{messages, options}>, assertDrained: Function, remaining: () => number }}
 */
export function createMockLLMProvider(script) {
  if (!Array.isArray(script)) {
    throw new TypeError("Mock LLM script must be an array");
  }

  const calls = [];
  let cursor = 0;

  const chatFn = async function mockChatWithTools(messages, options) {
    if (cursor >= script.length) {
      throw new Error(
        `Mock LLM script exhausted after ${cursor} call(s). The agent loop made ` +
          `an unexpected extra LLM call. Add another script step or tighten the ` +
          `loop's stop condition.`,
      );
    }

    const step = script[cursor];
    cursor += 1;

    // Snapshot-before-mutation so test assertions see exactly what the mock
    // was called with (agentLoop mutates its messages array in place).
    const snapshot = messages.map((m) => ({ ...m }));
    calls.push({ messages: snapshot, options });

    if (typeof step.expect === "function") {
      const ok = step.expect(snapshot, options);
      if (!ok) {
        throw new Error(
          `Mock LLM script step ${cursor - 1} expectation failed. Messages ` +
            `passed to the mock did not match the expected predicate. Received ` +
            `${snapshot.length} messages; last role = "${snapshot[snapshot.length - 1]?.role}".`,
        );
      }
    }

    if (!step.response || !step.response.message) {
      throw new Error(
        `Mock LLM script step ${cursor - 1} is missing response.message. ` +
          `Every step must return a chatWithTools-shaped { message: {...} }.`,
      );
    }

    // Deep clone the response so tests can safely reuse script objects across
    // multiple runs without the loop mutating their contents.
    return {
      message: JSON.parse(JSON.stringify(step.response.message)),
    };
  };

  return {
    chatFn,
    calls,
    remaining: () => script.length - cursor,
    assertDrained() {
      if (cursor !== script.length) {
        throw new Error(
          `Mock LLM script not fully consumed: ${cursor}/${script.length} steps called. ` +
            `The agent loop stopped before reaching the end of the script.`,
        );
      }
    },
  };
}

/**
 * Convenience builder for a single tool_call assistant message.
 * @param {string} toolName
 * @param {object} args
 * @param {string} [callId]
 */
export function mockToolCallMessage(toolName, args, callId = "call_1") {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: callId,
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(args),
        },
      },
    ],
  };
}

/**
 * Convenience builder for a final assistant text message.
 * @param {string} text
 */
export function mockTextMessage(text) {
  return { role: "assistant", content: text };
}
