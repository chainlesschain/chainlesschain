/**
 * `llm.chat` WS handler — Phase 2 streaming first consumer (2026-04-30).
 *
 * Async-generator topic handler that bridges desktop's
 * `LLMManager.chatStream(messages, onChunk, options)` (callback-style) to
 * the streaming envelope landed in `da1fc0caa` (yield → `<topic>.chunk`,
 * generator return → `<topic>.result`).
 *
 * Routes through LLMManager (not OllamaClient) so the web-panel inherits
 * the desktop's whole multi-provider stack — Ollama for local, Anthropic /
 * Gemini / OpenAI for cloud — plus its budget alert / cache / state-bus.
 * Topic is `llm.chat` rather than `ollama.chat` to reflect that.
 *
 * Frames:
 *   client → server: { id, type: "llm.chat",
 *                     messages: [{role, content}, ...],
 *                     options?: { model?, temperature?, top_p?, top_k? } }
 *
 *   server → client (streaming):
 *     { id, type: "llm.chat.chunk", ok: true,
 *       chunk: { delta: "tok", content: "accumulated so far" } }
 *     ... (one frame per onChunk) ...
 *     { id, type: "llm.chat.result", ok: true,
 *       result: { message, model, tokens?, totalDuration? } }
 *
 *   On error (mid-stream or before first chunk):
 *     { id, type: "llm.chat.result", ok: false, error: "<msg>" }
 *
 * Construction (DI for unit tests):
 *
 *     createLlmChatHandler({ llmManager })
 *
 * `llmManager` is captured by ref. Re-checked at call time so a null
 * (LLM not initialised) throws `llm_unavailable` cleanly. The handler
 * does NOT perform any auth gate of its own — the dispatcher already
 * mirrors CLI's auth-required gate before invoking topic handlers.
 */

/**
 * Map one provider onChunk invocation to the wire envelope `{delta, content}`.
 *
 * `delta`   = the new token(s) since the previous chunk (string).
 * `content` = the full accumulated assistant text so far (string).
 *
 * Inputs handled:
 *   - `(deltaText, fullContent)` — ollama / anthropic / llava
 *   - `({content, delta, fullContent})` — openai-style; `content` is the
 *     new token, `delta` is the raw choice-delta object (ignored), and
 *     `fullContent` is provider-supplied accumulator
 *   - `({content, done})` — gemini; `content` is the new token, terminal
 *     frame has empty content + done:true (yielded as a no-op chunk so
 *     callers see a stable stream)
 *
 * `accumulator` is the running content from the bridge; used as a fallback
 * when the provider didn't supply one (gemini, defensive ollama path).
 *
 * Returns strings only — never undefined / non-string — so downstream
 * `string += chunk.delta` is always string concatenation.
 */
function normalizeChunk(rawArgs, accumulator) {
  const first = rawArgs[0];
  const second = rawArgs[1];

  if (typeof first === "string") {
    const delta = first;
    const content = typeof second === "string" ? second : accumulator + delta;
    return { delta, content };
  }

  if (first && typeof first === "object") {
    const delta = typeof first.content === "string" ? first.content : "";
    const content =
      typeof first.fullContent === "string"
        ? first.fullContent
        : accumulator + delta;
    return { delta, content };
  }

  return { delta: "", content: accumulator };
}

/**
 * Bridge a (messages, onChunk, options) -> Promise<finalResult> stream
 * into an async iterable. Each onChunk invocation becomes a yielded
 * `{delta:string, content:string}`; the resolved value of the underlying
 * promise becomes the generator's `return value`. Rejection re-throws so
 * the dispatcher's mid-stream-error handler turns it into ok:false.
 *
 * Provider clients call onChunk in three different shapes — this bridge
 * is the seam that hides that from the wire protocol:
 *   - ollama/anthropic/llava: `onChunk(deltaText, fullContent)`  (2 strings)
 *   - openai (incl. Doubao/Volcengine): `onChunk({content, delta, fullContent})`
 *   - gemini: `onChunk({content, done})`
 * Normalization here means downstream sees a single `{delta, content}`
 * envelope regardless of provider. (Without this, the openai/gemini
 * object-form chunk gets bound to the `delta` parameter, then concatenated
 * by callers as `string + Object`, surfacing as `[object Object]`.)
 *
 * @param {(messages: any[], onChunk: Function, options: object) => Promise<any>} streamFn
 * @param {any[]} messages
 * @param {object} options
 */
async function* streamFromCallback(streamFn, messages, options) {
  let queue = [];
  let done = false;
  let waker = null;
  let accumulator = "";

  const wake = () => {
    if (waker) {
      const fn = waker;
      waker = null;
      fn();
    }
  };

  const finalPromise = streamFn(
    messages,
    (...rawArgs) => {
      const normalized = normalizeChunk(rawArgs, accumulator);
      accumulator = normalized.content;
      queue.push(normalized);
      wake();
    },
    options,
  ).then(
    (value) => {
      done = true;
      wake();
      return value;
    },
    (err) => {
      done = true;
      wake();
      throw err;
    },
  );

  // If the generator is returned mid-stream (e.g. WS close → AbortController
  // triggers AbortError on the underlying fetch), `return await finalPromise`
  // below never runs and the rejection becomes orphaned. Pre-attach a noop
  // .catch so it never surfaces as an unhandled rejection. The "real"
  // awaiter is still the `return await` on the happy path.
  finalPromise.catch(() => {});

  try {
    while (true) {
      // Drain whatever the callback has buffered while we were yielding.
      if (queue.length > 0) {
        const batch = queue;
        queue = [];
        for (const item of batch) {
          yield item;
        }
        continue;
      }
      if (done) {
        break;
      }
      await new Promise((resolve) => {
        waker = resolve;
      });
    }
  } finally {
    waker = null;
  }

  // Re-await the final promise so its resolved value becomes the generator's
  // return value (or its rejection re-throws). We've already drained the
  // queue, so no chunks are lost.
  return await finalPromise;
}

function getManager(options) {
  const mgr = options.llmManager;
  if (!mgr || typeof mgr.chatStream !== "function") {
    throw new Error("llm_unavailable");
  }
  return mgr;
}

/**
 * Build the `llm.chat` topic handler. Returns an *async generator function*
 * — the dispatcher detects `Symbol.asyncIterator` on the return and routes
 * through the streaming envelope.
 *
 * @param {{ llmManager: object | null }} options
 * @returns {(frame: any) => AsyncGenerator<{delta:string, content:string}, object, void>}
 */
function createLlmChatHandler(options = {}) {
  return async function* llmChatHandler(frame) {
    const mgr = getManager(options);

    const messages = frame?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages_required");
    }
    for (const m of messages) {
      if (
        !m ||
        typeof m !== "object" ||
        typeof m.role !== "string" ||
        typeof m.content !== "string"
      ) {
        throw new Error("invalid_message_shape");
      }
    }

    const opts =
      frame?.options && typeof frame.options === "object" ? frame.options : {};

    // AbortController threads cancellation from the dispatcher's
    // generator.return() (called on WS close or `<topic>.cancel` frame)
    // through to the underlying fetch in ollama/anthropic/openai clients,
    // which all read `options.signal`. Aborting after the underlying
    // request has already settled is a no-op, so always abort in finally
    // — keeps the happy and cancelled paths uniform.
    const ac = new AbortController();
    try {
      const result = yield* streamFromCallback(
        mgr.chatStream.bind(mgr),
        messages,
        { ...opts, signal: ac.signal },
      );
      return result;
    } finally {
      ac.abort();
    }
  };
}

module.exports = {
  createLlmChatHandler,
  // Exported for unit tests of the bridge in isolation.
  streamFromCallback,
  normalizeChunk,
};
