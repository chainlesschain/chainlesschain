/**
 * useLlmChat — streams chat tokens from the embedded desktop's LLMManager
 * via the `llm.chat` topic (see desktop-app-vue/src/main/web-shell/handlers/
 * llm-handlers.js + the streaming envelope in ws-cli-loader.js).
 *
 * Two API shapes for caller convenience:
 *
 *   1. Async iterable (recommended) — natural for `for await`:
 *
 *        const { stream, result } = useLlmChat().chat({
 *          messages: [{ role: 'user', content: 'Hi' }],
 *        })
 *        for await (const { delta, content } of stream) { … }
 *        const final = await result   // { message, model, tokens? }
 *
 *   2. Callback — for code paths that already have a writer pattern:
 *
 *        const final = await useLlmChat().chatTo({
 *          messages: [...],
 *          onDelta: (chunk) => append(chunk.delta),
 *        })
 *
 * The underlying topic is `llm.chat`; chunks are `{delta, content}` and
 * the terminal result is whatever LLMManager.chatStream resolved with —
 * typically `{ message: {role, content}, model, tokens? }`.
 */

import { useWsStore } from '../stores/ws.js'

function makeQueue() {
  const items = []
  let waker = null
  let done = false
  let err = null
  return {
    push(item) {
      items.push(item)
      if (waker) {
        const w = waker
        waker = null
        w()
      }
    },
    finish(error) {
      done = true
      err = error || null
      if (waker) {
        const w = waker
        waker = null
        w()
      }
    },
    async *iterate() {
      while (true) {
        while (items.length > 0) {
          yield items.shift()
        }
        if (done) {
          if (err) throw err
          return
        }
        await new Promise((r) => { waker = r })
      }
    },
  }
}

export function useLlmChat() {
  const ws = useWsStore()

  /**
   * Start a streaming chat. Returns `{stream, result}`:
   *   - stream: AsyncIterable<{delta, content}>
   *   - result: Promise<{message, model, tokens?}> (resolves on terminal frame)
   *
   * Cancellation: closing the WS aborts the stream (sendStream rejects,
   * which propagates through `result`). Future per-call abort would need
   * a server-side cancel topic — not built yet.
   *
   * @param {{ messages: any[], options?: object, idleMs?: number }} args
   */
  function chat(args) {
    if (!args || !Array.isArray(args.messages)) {
      throw new Error('messages array is required')
    }
    const queue = makeQueue()
    const result = ws
      .sendStream(
        { type: 'llm.chat', messages: args.messages, options: args.options || {} },
        {
          onChunk: (chunk) => queue.push(chunk),
          idleMs: args.idleMs ?? 60000,
        },
      )
      .then(
        (final) => {
          queue.finish(null)
          return final
        },
        (err) => {
          queue.finish(err)
          throw err
        },
      )
    return { stream: queue.iterate(), result }
  }

  /**
   * Convenience wrapper around chat(): drains the stream feeding each
   * chunk into onDelta, returns the terminal result. Throws on stream
   * error (same as chat().result).
   *
   * @param {{
   *   messages: any[], options?: object, idleMs?: number,
   *   onDelta?: (chunk: {delta:string, content:string}) => void
   * }} args
   */
  async function chatTo(args) {
    const onDelta = typeof args.onDelta === 'function' ? args.onDelta : () => {}
    const { stream, result } = chat(args)
    try {
      for await (const c of stream) {
        onDelta(c)
      }
    } catch {
      // Swallow — the same error will surface via `result` below, which
      // we always await so it never becomes an unhandled rejection.
    }
    return result
  }

  return { chat, chatTo }
}
