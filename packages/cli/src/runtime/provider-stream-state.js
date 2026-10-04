/**
 * Provider response state and usage normalization.
 * Pure protocol reducers: transport, ingress, retries and settlement remain in
 * agent-core. Shared usage validation also serves non-streamed responses.
 */

export function _isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function _providerUsageCount(usage, canonical, alias) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const hasCanonical = Object.prototype.hasOwnProperty.call(usage, canonical);
  const hasAlias = Object.prototype.hasOwnProperty.call(usage, alias);
  if (!hasCanonical && !hasAlias) return null;
  if (hasCanonical && hasAlias && usage[canonical] !== usage[alias])
    return null;
  const value = hasCanonical ? usage[canonical] : usage[alias];
  return _isNonNegativeSafeInteger(value) ? value : null;
}

export function _optionalProviderUsageCount(usage, canonical, alias) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const hasCanonical = Object.prototype.hasOwnProperty.call(usage, canonical);
  const hasAlias = Object.prototype.hasOwnProperty.call(usage, alias);
  if (!hasCanonical && !hasAlias) return 0;
  if (hasCanonical && hasAlias && usage[canonical] !== usage[alias])
    return null;
  const value = hasCanonical ? usage[canonical] : usage[alias];
  return _isNonNegativeSafeInteger(value) ? value : null;
}

export function _hasCompleteProviderUsage(usage) {
  return (
    _providerUsageCount(usage, "input_tokens", "prompt_tokens") != null &&
    _providerUsageCount(usage, "output_tokens", "completion_tokens") != null &&
    _optionalProviderUsageCount(
      usage,
      "cache_read_input_tokens",
      "cache_read_tokens",
    ) != null &&
    _optionalProviderUsageCount(
      usage,
      "cache_creation_input_tokens",
      "cache_creation_tokens",
    ) != null
  );
}

const PROVIDER_RECEIPT_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;

export function _providerReceiptId(value) {
  return typeof value === "string" && PROVIDER_RECEIPT_ID_RE.test(value)
    ? value
    : null;
}

// ─── Anthropic streaming (SSE → {message, usage}, tool_use reassembled) ──────
//
// Anthropic /messages with stream:true emits SSE: message_start (input usage),
// content_block_start (text or tool_use header), content_block_delta
// (text_delta → onToken, or input_json_delta accumulating a tool's JSON args),
// message_delta (output usage). We reduce per `data:` line and finalize into
// the same shape chatWithTools returns non-streamed.

export function _anthropicInitState() {
  return {
    text: "",
    blocks: {},
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    usageInvalid: false,
  };
}

export function _anthropicReduceLine(state, raw, onToken, onThinking) {
  const line = (raw || "").trim();
  if (!line.startsWith("data:")) return state;
  const payload = line.slice(5).trim();
  if (!payload) return state;
  let obj;
  try {
    obj = JSON.parse(payload);
  } catch {
    return state;
  }
  if (obj.type === "message_start") {
    const usage = obj.message?.usage;
    if (usage != null) {
      const inputTokens = _providerUsageCount(
        usage,
        "input_tokens",
        "prompt_tokens",
      );
      const cacheReadTokens = _optionalProviderUsageCount(
        usage,
        "cache_read_input_tokens",
        "cache_read_tokens",
      );
      const cacheCreationTokens = _optionalProviderUsageCount(
        usage,
        "cache_creation_input_tokens",
        "cache_creation_tokens",
      );
      if (
        inputTokens == null ||
        cacheReadTokens == null ||
        cacheCreationTokens == null
      ) {
        state.usageInvalid = true;
      } else {
        state.inputTokens = inputTokens;
        state.cacheReadTokens = cacheReadTokens;
        state.cacheCreationTokens = cacheCreationTokens;
      }
    }
  } else if (obj.type === "content_block_start") {
    const cb = obj.content_block || {};
    state.blocks[obj.index] =
      cb.type === "tool_use"
        ? { type: "tool_use", id: cb.id, name: cb.name, json: "" }
        : cb.type === "thinking"
          ? { type: "thinking", thinking: "", signature: "" }
          : cb.type === "redacted_thinking"
            ? { type: "redacted_thinking", data: cb.data || "" }
            : { type: "text" };
  } else if (obj.type === "content_block_delta") {
    const d = obj.delta || {};
    if (d.type === "text_delta" && d.text) {
      state.text += d.text;
      if (typeof onToken === "function") {
        try {
          onToken(d.text);
        } catch {
          // a failing UI hook must never break the run
        }
      }
    } else if (d.type === "input_json_delta" && state.blocks[obj.index]) {
      state.blocks[obj.index].json += d.partial_json || "";
    } else if (d.type === "thinking_delta" && state.blocks[obj.index]) {
      state.blocks[obj.index].thinking =
        (state.blocks[obj.index].thinking || "") + (d.thinking || "");
      if (typeof onThinking === "function" && d.thinking) {
        try {
          onThinking(d.thinking);
        } catch {
          // a failing UI hook must never break the run
        }
      }
    } else if (d.type === "signature_delta" && state.blocks[obj.index]) {
      state.blocks[obj.index].signature =
        (state.blocks[obj.index].signature || "") + (d.signature || "");
    }
  } else if (obj.type === "message_delta") {
    if (obj.usage != null) {
      const outputTokens = _providerUsageCount(
        obj.usage,
        "output_tokens",
        "completion_tokens",
      );
      if (outputTokens == null) {
        state.usageInvalid = true;
      } else {
        state.outputTokens = outputTokens;
      }
    }
  }
  return state;
}

export function _anthropicFinalize(state) {
  const toolCalls = [];
  const thinkingBlocks = [];
  for (const k of Object.keys(state.blocks).sort(
    (a, b) => Number(a) - Number(b),
  )) {
    const b = state.blocks[k];
    if (b.type === "tool_use") {
      let input = {};
      try {
        input = b.json ? JSON.parse(b.json) : {};
      } catch {
        input = {};
      }
      toolCalls.push({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(input) },
      });
    } else if (b.type === "thinking") {
      thinkingBlocks.push({
        type: "thinking",
        thinking: b.thinking || "",
        signature: b.signature || "",
      });
    } else if (b.type === "redacted_thinking") {
      thinkingBlocks.push({ type: "redacted_thinking", data: b.data || "" });
    }
  }
  const message = { role: "assistant", content: state.text };
  if (toolCalls.length) message.tool_calls = toolCalls;
  // Preserve thinking blocks verbatim (incl. signature) for replay on the next
  // tool turn — required by the API when extended thinking is on.
  if (thinkingBlocks.length) message._thinkingBlocks = thinkingBlocks;
  const out = { message };
  if (
    state.usageInvalid !== true &&
    _isNonNegativeSafeInteger(state.inputTokens) &&
    _isNonNegativeSafeInteger(state.outputTokens)
  ) {
    out.usage = {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      cache_read_input_tokens: state.cacheReadTokens,
      cache_creation_input_tokens: state.cacheCreationTokens,
    };
  }
  return out;
}

/** Pure reducer over Anthropic SSE lines — exported for tests (no HTTP). */
export function _accumulateAnthropicStream(lines, onToken, onThinking) {
  const state = _anthropicInitState();
  for (const line of lines)
    _anthropicReduceLine(state, line, onToken, onThinking);
  return _anthropicFinalize(state);
}

// ─── OpenAI-compatible streaming (SSE → {message, usage}) ────────────────────
//
// `data:` lines carry choices[0].delta.{content, tool_calls[]}; tool_calls
// arrive fragmented and keyed by `index` (name in the first chunk, arguments
// concatenated across chunks). usage rides the terminal chunk when
// stream_options.include_usage was requested. Terminator: `data: [DONE]`.

// OpenAI-compatible cached-prompt-token count. OpenAI / volcengine report it as
// usage.prompt_tokens_details.cached_tokens; DeepSeek as
// usage.prompt_cache_hit_tokens. In BOTH, prompt_tokens already INCLUDES the
// cached count (unlike Anthropic, where input_tokens is the uncached remainder)
// — so callers subtract it to recover the uncached input and avoid pricing the
// cached prefix twice. Verified live against volcengine (field present, 0 when
// the provider does not auto-cache).
export function _openaiCachedTokens(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const candidates = [];
  const hasDirect =
    Object.prototype.hasOwnProperty.call(usage, "cache_read_input_tokens") ||
    Object.prototype.hasOwnProperty.call(usage, "cache_read_tokens");
  if (hasDirect) {
    const direct = _optionalProviderUsageCount(
      usage,
      "cache_read_input_tokens",
      "cache_read_tokens",
    );
    if (direct == null) return null;
    candidates.push(direct);
  }

  if (Object.prototype.hasOwnProperty.call(usage, "prompt_tokens_details")) {
    const details = usage.prompt_tokens_details;
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(details, "cached_tokens")) {
      if (!_isNonNegativeSafeInteger(details.cached_tokens)) return null;
      candidates.push(details.cached_tokens);
    }
  }

  if (Object.prototype.hasOwnProperty.call(usage, "prompt_cache_hit_tokens")) {
    if (!_isNonNegativeSafeInteger(usage.prompt_cache_hit_tokens)) return null;
    candidates.push(usage.prompt_cache_hit_tokens);
  }

  if (candidates.some((value) => value !== candidates[0])) return null;
  return candidates[0] ?? 0;
}

export function _openaiInitState() {
  return {
    responseId: null,
    text: "",
    tools: [],
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: 0,
    usageInvalid: false,
  };
}

export function _openaiReduceLine(state, raw, onToken) {
  const line = (raw || "").trim();
  if (!line.startsWith("data:")) return state;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return state;
  let obj;
  try {
    obj = JSON.parse(payload);
  } catch {
    return state;
  }
  if (!state.responseId) state.responseId = _providerReceiptId(obj.id);
  const delta = obj.choices?.[0]?.delta;
  if (delta?.content) {
    state.text += delta.content;
    if (typeof onToken === "function") {
      try {
        onToken(delta.content);
      } catch {
        // a failing UI hook must never break the run
      }
    }
  }
  if (Array.isArray(delta?.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      if (!state.tools[idx])
        state.tools[idx] = { id: undefined, name: "", args: "" };
      if (tc.id) state.tools[idx].id = tc.id;
      if (tc.function?.name) state.tools[idx].name = tc.function.name;
      if (tc.function?.arguments)
        state.tools[idx].args += tc.function.arguments;
    }
  }
  if (obj.usage != null) {
    const usage = obj.usage;
    const prompt = _providerUsageCount(usage, "input_tokens", "prompt_tokens");
    const completion = _providerUsageCount(
      usage,
      "output_tokens",
      "completion_tokens",
    );
    const cached = _openaiCachedTokens(obj.usage);
    if (
      !_hasCompleteProviderUsage(usage) ||
      cached == null ||
      cached > prompt
    ) {
      state.usageInvalid = true;
    } else {
      state.inputTokens = Math.max(0, prompt - cached);
      state.outputTokens = completion;
      state.cacheReadTokens = cached;
    }
  }
  return state;
}

export function _openaiFinalize(state) {
  const toolCalls = state.tools.filter(Boolean).map((t) => ({
    id: t.id || `call_${t.name || "tool"}`,
    type: "function",
    function: { name: t.name, arguments: t.args || "{}" },
  }));
  const message = { role: "assistant", content: state.text };
  if (toolCalls.length) message.tool_calls = toolCalls;
  const out = { message };
  if (
    state.usageInvalid !== true &&
    _isNonNegativeSafeInteger(state.inputTokens) &&
    _isNonNegativeSafeInteger(state.outputTokens)
  ) {
    out.usage = {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      cache_read_input_tokens: state.cacheReadTokens,
    };
  }
  return out;
}

/** Pure reducer over OpenAI-compatible SSE lines — exported for tests. */
export function _accumulateOpenAIStream(lines, onToken) {
  const state = _openaiInitState();
  for (const line of lines) _openaiReduceLine(state, line, onToken);
  return _openaiFinalize(state);
}
