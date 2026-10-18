/** Append-only, complete provider assistant/tool exchanges. No policy or user
 * messages may enter durable replay through this event. */
export const TOOL_ROUND_EVENT = "tool_round";
export const TOOL_ROUND_SCHEMA = "chainlesschain.session-tool-round/v1";

export function assertCompleteToolRounds(messages) {
  if (!Array.isArray(messages) || messages.length === 0)
    throw new TypeError("Tool rounds require a non-empty message array");
  const pending = new Set();
  for (const message of messages) {
    if (message?.role === "assistant" && pending.size === 0) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0)
        throw new TypeError("Tool round assistant must contain tool calls");
      for (const call of message.tool_calls) {
        if (typeof call?.id !== "string" || !call.id || pending.has(call.id))
          throw new TypeError("Malformed or duplicate tool call");
        pending.add(call.id);
      }
    } else if (
      message?.role === "tool" &&
      pending.delete(message.tool_call_id)
    ) {
      // Every result settles exactly one call in the immediately preceding round.
    } else {
      throw new TypeError(
        "Tool round contains an orphan result or forbidden message",
      );
    }
  }
  if (pending.size) throw new TypeError("Tool round is incomplete");
  return messages;
}

export function projectToolRoundMessages(event) {
  if (event?.type !== TOOL_ROUND_EVENT) return null;
  if (event.data?.schema !== TOOL_ROUND_SCHEMA)
    throw new TypeError("Unsupported session tool round schema");
  return assertCompleteToolRounds(event.data.messages);
}
