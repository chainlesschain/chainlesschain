const RESPONSES_FAILURE_CODE = "CC_OPENAI_RESPONSES_FAILED";
const MAX_REASONING_ITEMS = 16;
const MAX_REASONING_SUMMARY_CHARS = 8_192;

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function printableString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function jsonText(value) {
  if (typeof value === "string") return value;
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded : "";
  } catch {
    return String(value ?? "");
  }
}

function responseFailure(data) {
  const providerCode = printableString(
    data?.error?.code || data?.incomplete_details?.reason || data?.status,
    "unknown",
  ).slice(0, 128);
  const error = new Error(`OpenAI Responses request failed (${providerCode})`);
  error.code = RESPONSES_FAILURE_CODE;
  error.providerCode = providerCode;
  return error;
}

function normalizeImageBlock(block) {
  const imageUrl =
    typeof block?.image_url === "string"
      ? block.image_url
      : block?.image_url?.url;
  if (typeof imageUrl !== "string" || !imageUrl) return null;
  return {
    type: "input_image",
    image_url: imageUrl,
    ...(typeof block?.image_url?.detail === "string"
      ? { detail: block.image_url.detail }
      : typeof block?.detail === "string"
        ? { detail: block.detail }
        : {}),
  };
}

function normalizeMessageContent(content, role) {
  if (!Array.isArray(content)) return jsonText(content);
  const assistant = role === "assistant";
  return content.map((block) => {
    if (block?.type === "image_url" || block?.type === "input_image") {
      return (
        normalizeImageBlock(block) || {
          type: assistant ? "output_text" : "input_text",
          text: "[invalid image input]",
        }
      );
    }
    if (block?.type === "input_file" && !assistant) return block;
    const text = printableString(
      block?.text ?? block?.refusal,
      jsonText(block),
    );
    return {
      type: assistant ? "output_text" : "input_text",
      text,
    };
  });
}

function sanitizeReasoningItems(items) {
  if (!Array.isArray(items)) return [];
  const output = [];
  for (const item of items.slice(0, MAX_REASONING_ITEMS)) {
    if (!item || item.type !== "reasoning") continue;
    const id = printableString(item.id);
    const encryptedContent = printableString(item.encrypted_content);
    const status = ["completed", "in_progress", "incomplete"].includes(
      item.status,
    )
      ? item.status
      : null;
    const summary = Array.isArray(item.summary)
      ? item.summary
          .filter((part) => part?.type === "summary_text")
          .map((part) => ({
            type: "summary_text",
            text: printableString(part.text).slice(
              0,
              MAX_REASONING_SUMMARY_CHARS,
            ),
          }))
      : [];
    if (!id && !encryptedContent && summary.length === 0) continue;
    output.push({
      type: "reasoning",
      ...(id ? { id } : {}),
      ...(encryptedContent ? { encrypted_content: encryptedContent } : {}),
      ...(summary.length ? { summary } : {}),
      ...(status ? { status } : {}),
    });
  }
  return output;
}

/** Convert the internal Chat-Completions-shaped history into Responses items. */
export function toOpenAIResponsesInput(messages) {
  const input = [];
  for (const message of messages || []) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: printableString(message.tool_call_id),
        output: jsonText(message.content),
      });
      continue;
    }
    if (message.role === "assistant") {
      input.push(...sanitizeReasoningItems(message._openaiReasoningItems));
    }
    const content = normalizeMessageContent(message.content, message.role);
    const hasContent = Array.isArray(content)
      ? content.length > 0
      : content.length > 0;
    if (hasContent || message.role !== "assistant") {
      input.push({
        role: ["system", "developer", "assistant", "user"].includes(
          message.role,
        )
          ? message.role
          : "user",
        content,
      });
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const name = printableString(toolCall?.function?.name);
        const callId = printableString(toolCall?.id);
        if (!name || !callId) continue;
        input.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: printableString(toolCall?.function?.arguments, "{}"),
        });
      }
    }
  }
  return input;
}

/** Flatten Chat Completions function descriptors into Responses tools. */
export function toOpenAIResponsesTools(tools) {
  return (tools || [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: printableString(tool.function.description),
      parameters: tool.function.parameters || { type: "object" },
      ...(typeof tool.function.strict === "boolean"
        ? { strict: tool.function.strict }
        : {}),
    }));
}

export function createOpenAIResponsesBody({
  model,
  messages,
  tools,
  maxOutputTokens = null,
  reasoning = null,
  stream = false,
}) {
  return {
    model,
    input: toOpenAIResponsesInput(messages),
    tools: toOpenAIResponsesTools(tools),
    store: false,
    include: ["reasoning.encrypted_content"],
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

export function normalizeOpenAIResponsesUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const input = nonNegativeInteger(usage.input_tokens);
  const output = nonNegativeInteger(usage.output_tokens);
  if (input === null || output === null) return null;
  const details = usage.input_tokens_details;
  let cached = 0;
  if (details != null) {
    if (typeof details !== "object" || Array.isArray(details)) return null;
    if (Object.hasOwn(details, "cached_tokens")) {
      cached = nonNegativeInteger(details.cached_tokens);
      if (cached === null || cached > input) return null;
    }
  }
  return {
    input_tokens: input - cached,
    output_tokens: output,
    cache_read_input_tokens: cached,
  };
}

function responseOutput(data) {
  return Array.isArray(data?.output) ? data.output : [];
}

/** Normalize one completed/incomplete Responses object for the existing loop. */
export function normalizeOpenAIResponsesResponse(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw responseFailure({ status: "invalid_response" });
  }
  if (data.error || ["failed", "cancelled"].includes(data.status)) {
    throw responseFailure(data);
  }
  if (data.status && !["completed", "incomplete"].includes(data.status)) {
    throw responseFailure(data);
  }

  const output = responseOutput(data);
  const text = [];
  const toolCalls = [];
  const reasoningItems = [];
  const reasoningSummary = [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          text.push(part.text);
        } else if (
          part?.type === "refusal" &&
          typeof part.refusal === "string"
        ) {
          text.push(part.refusal);
        }
      }
    } else if (item?.type === "function_call") {
      const id = printableString(item.call_id || item.id);
      const name = printableString(item.name);
      if (id && name) {
        toolCalls.push({
          id,
          type: "function",
          function: {
            name,
            arguments: printableString(item.arguments, "{}"),
          },
        });
      }
    } else if (item?.type === "reasoning") {
      reasoningItems.push(item);
      for (const part of item.summary || []) {
        if (part?.type === "summary_text" && typeof part.text === "string") {
          reasoningSummary.push(part.text);
        }
      }
    }
  }

  const message = { role: "assistant", content: text.join("") };
  if (toolCalls.length) message.tool_calls = toolCalls;
  const safeReasoning = sanitizeReasoningItems(reasoningItems);
  if (safeReasoning.length) message._openaiReasoningItems = safeReasoning;
  if (reasoningSummary.length) {
    message._openaiReasoningSummary = reasoningSummary
      .join("")
      .slice(0, MAX_REASONING_SUMMARY_CHARS);
  }
  if (data.status === "incomplete") {
    delete message.tool_calls;
    delete message._openaiReasoningItems;
    message._truncated = true;
  }
  const result = {
    message,
    responseId: printableString(data.id) || null,
  };
  const usage = normalizeOpenAIResponsesUsage(data.usage);
  if (usage) result.usage = usage;
  return result;
}

export function createOpenAIResponsesStreamState() {
  return {
    responseId: null,
    text: "",
    reasoningSummary: "",
    outputItems: [],
    normalized: null,
    terminalError: null,
  };
}

function streamItem(state, event) {
  const index = Number.isSafeInteger(event.output_index)
    ? event.output_index
    : state.outputItems.length;
  if (!state.outputItems[index]) {
    state.outputItems[index] = {
      type: "function_call",
      call_id: printableString(event.call_id || event.item_id),
      name: printableString(event.name),
      arguments: "",
    };
  }
  return state.outputItems[index];
}

export function reduceOpenAIResponsesStreamLine(
  state,
  raw,
  onToken,
  onThinking,
) {
  const line = printableString(raw).trim();
  if (!line.startsWith("data:")) return state;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return state;
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return state;
  }
  state.responseId ||= printableString(event.response_id || event.response?.id);
  if (event.type === "response.output_text.delta") {
    const delta = printableString(event.delta);
    state.text += delta;
    onToken?.(delta);
  } else if (event.type === "response.refusal.delta") {
    const delta = printableString(event.delta);
    state.text += delta;
    onToken?.(delta);
  } else if (event.type === "response.reasoning_summary_text.delta") {
    const delta = printableString(event.delta);
    state.reasoningSummary += delta;
    onThinking?.(delta);
  } else if (event.type === "response.output_item.added" && event.item) {
    const index = Number.isSafeInteger(event.output_index)
      ? event.output_index
      : state.outputItems.length;
    state.outputItems[index] = event.item;
  } else if (event.type === "response.output_item.done" && event.item) {
    const index = Number.isSafeInteger(event.output_index)
      ? event.output_index
      : state.outputItems.length;
    state.outputItems[index] = event.item;
  } else if (event.type === "response.function_call_arguments.delta") {
    const item = streamItem(state, event);
    item.arguments = `${printableString(item.arguments)}${printableString(event.delta)}`;
  } else if (event.type === "response.function_call_arguments.done") {
    const item = streamItem(state, event);
    item.arguments = printableString(event.arguments, item.arguments || "{}");
  } else if (
    event.type === "response.completed" ||
    event.type === "response.incomplete"
  ) {
    try {
      state.normalized = normalizeOpenAIResponsesResponse(event.response);
    } catch (error) {
      state.terminalError = error;
    }
  } else if (event.type === "response.failed" || event.type === "error") {
    state.terminalError = responseFailure(event.response || event);
  }
  return state;
}

export function finalizeOpenAIResponsesStream(state) {
  if (state.terminalError) throw state.terminalError;
  if (state.normalized) return state.normalized;
  const output = state.outputItems.filter(Boolean);
  let normalized;
  if (output.length) {
    normalized = normalizeOpenAIResponsesResponse({
      id: state.responseId,
      status: "completed",
      output,
    });
  } else {
    normalized = {
      message: { role: "assistant", content: state.text },
      responseId: state.responseId,
    };
  }
  if (!normalized.message.content && state.text) {
    normalized.message.content = state.text;
  }
  if (!normalized.message._openaiReasoningSummary && state.reasoningSummary) {
    normalized.message._openaiReasoningSummary = state.reasoningSummary.slice(
      0,
      MAX_REASONING_SUMMARY_CHARS,
    );
  }
  return normalized;
}

export function accumulateOpenAIResponsesStream(lines, onToken, onThinking) {
  const state = createOpenAIResponsesStreamState();
  for (const line of lines) {
    reduceOpenAIResponsesStreamLine(state, line, onToken, onThinking);
  }
  return finalizeOpenAIResponsesStream(state);
}
