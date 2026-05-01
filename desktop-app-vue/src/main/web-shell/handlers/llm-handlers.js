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
 * Bridge a (messages, onChunk, options) -> Promise<finalResult> stream
 * into an async iterable. Each onChunk(delta, content) becomes a yielded
 * `{delta, content}`; the resolved value of the underlying promise becomes
 * the generator's `return value`. Rejection re-throws so the dispatcher's
 * mid-stream-error handler turns it into ok:false.
 *
 * @param {(messages: any[], onChunk: Function, options: object) => Promise<any>} streamFn
 * @param {any[]} messages
 * @param {object} options
 */
async function* streamFromCallback(streamFn, messages, options) {
  let queue = [];
  let done = false;
  let waker = null;

  const wake = () => {
    if (waker) {
      const fn = waker;
      waker = null;
      fn();
    }
  };

  const finalPromise = streamFn(
    messages,
    (delta, content) => {
      queue.push({ delta, content });
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
};
