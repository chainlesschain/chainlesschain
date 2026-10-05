/** Parse raw agent NDJSON. A declaration of success is never terminal evidence. */
export function verifyAgentTerminal(output) {
  try {
    const events = output
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const results = events.filter((event) => event?.type === "result");
    const terminal = results[0];
    const usage = terminal?.usage;
    const normalizedUsage =
      usage &&
      [
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
      ].every((value) => Number.isSafeInteger(value) && value >= 0)
        ? {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadInputTokens: usage.cache_read_input_tokens,
            cacheCreationInputTokens: usage.cache_creation_input_tokens,
          }
        : null;
    return {
      terminalVerified:
        results.length === 1 &&
        events.at(-1) === terminal &&
        terminal.subtype === "success" &&
        terminal.is_error === false &&
        !events.some((event) => event?.type === "error"),
      observedFallback: events.some((event) =>
        ["provider_fallback", "model_fallback"].includes(event?.subtype),
      ),
      usage: normalizedUsage,
      totalCostUsd:
        Number.isFinite(terminal?.total_cost_usd) &&
        terminal.total_cost_usd >= 0
          ? terminal.total_cost_usd
          : null,
    };
  } catch {
    return {
      terminalVerified: false,
      observedFallback: null,
      usage: null,
      totalCostUsd: null,
    };
  }
}
