/**
 * StreamRouter — stream-first 统一适配器
 *
 * Phase F of Managed Agents parity plan.
 *
 * 对齐 Managed Agents 的"所有 agent 路径默认 stream":
 *   - 统一事件协议: { type, ... }
 *     type ∈ start | token | tool_call | tool_result | message | error | end
 *   - 把非 stream provider 的一次性响应"假流式化"为单个 message + end
 *   - 提供 collect() 聚合 token 得到最终文本(兼容旧调用点)
 *   - 可选 onToken/onEvent 回调,便于 UI 逐字渲染
 *
 * 与 llm-manager/category-routing 解耦 — 只做事件流整形。
 */

const EventEmitter = require("events");

const EVENT = Object.freeze({
  START: "start",
  TOKEN: "token",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  MESSAGE: "message",
  ERROR: "error",
  END: "end",
});

const VALID_EVENTS = new Set(Object.values(EVENT));

function isAsyncIterable(x) {
  return x != null && typeof x[Symbol.asyncIterator] === "function";
}

/**
 * 把各种 provider 输入整形为 async iterable of StreamEvent
 *
 * source 可以是:
 *   - AsyncIterable<StreamEvent>  — 直接透传
 *   - AsyncIterable<string>       — 包装成 token 事件
 *   - string                      — 单条 message
 *   - { message: string }         — 单条 message
 *   - { error: Error|string }     — 单条 error
 *   - Promise<上述任意>           — await 后再整形
 */
async function* normalize(source) {
  if (source && typeof source.then === "function") {
    source = await source;
  }

  yield { type: EVENT.START, ts: Date.now() };

  try {
    if (source == null) {
      // no-op
    } else if (typeof source === "string") {
      yield { type: EVENT.MESSAGE, content: source };
    } else if (source instanceof Error) {
      yield { type: EVENT.ERROR, error: source.message, cause: source };
    } else if (isAsyncIterable(source)) {
      for await (const chunk of source) {
        if (chunk == null) continue;
        if (typeof chunk === "string") {
          yield { type: EVENT.TOKEN, text: chunk };
          continue;
        }
        if (typeof chunk === "object") {
          if (chunk.type && VALID_EVENTS.has(chunk.type)) {
            yield chunk;
            continue;
          }
          if (typeof chunk.text === "string") {
            yield { type: EVENT.TOKEN, text: chunk.text };
            continue;
          }
          if (typeof chunk.content === "string") {
            yield { type: EVENT.MESSAGE, content: chunk.content };
            continue;
          }
        }
      }
    } else if (typeof source === "object") {
      if (source.error) {
        yield {
          type: EVENT.ERROR,
          error: source.error instanceof Error ? source.error.message : String(source.error),
        };
      } else if (typeof source.message === "string") {
        yield { type: EVENT.MESSAGE, content: source.message };
      } else if (typeof source.content === "string") {
        yield { type: EVENT.MESSAGE, content: source.content };
      }
    }
  } catch (err) {
    yield { type: EVENT.ERROR, error: err.message, cause: err };
  }

  yield { type: EVENT.END, ts: Date.now() };
}

class StreamRouter extends EventEmitter {
  constructor({ onEvent = null, onToken = null } = {}) {
    super();
    this._onEvent = onEvent;
    this._onToken = onToken;
  }

  /**
   * stream(source) → async iterable of StreamEvent,同时转发到 EventEmitter / callbacks
   */
  async *stream(source) {
    for await (const ev of normalize(source)) {
      try {
        if (this._onEvent) this._onEvent(ev);
      } catch {
        /* swallow */
      }
      if (ev.type === EVENT.TOKEN && this._onToken) {
        try {
          this._onToken(ev.text);
        } catch {
          /* swallow */
        }
      }
      // EventEmitter treats "error" as fatal if no listener — prefix to avoid
      const emitName = ev.type === EVENT.ERROR ? "stream-error" : ev.type;
      this.emit(emitName, ev);
      this.emit("event", ev);
      yield ev;
    }
  }

  /**
   * collect(source) → { text, events, errored, error }
   * 把整条流聚合成最终文本(token 拼接 + 最后一条 message 覆盖)
   */
  async collect(source) {
    const events = [];
    let tokens = "";
    let message = null;
    let errored = false;
    let error = null;

    for await (const ev of this.stream(source)) {
      events.push(ev);
      if (ev.type === EVENT.TOKEN) tokens += ev.text || "";
      else if (ev.type === EVENT.MESSAGE) message = ev.content;
      else if (ev.type === EVENT.ERROR) {
        errored = true;
        error = ev.error;
      }
    }

    // message 覆盖 token 聚合(provider 一次性返回时走这条);否则用 token 拼接
    const text = message != null ? message : tokens;
    return { text, events, errored, error };
  }
}

module.exports = {
  StreamRouter,
  EVENT: EVENT,
  STREAM_EVENT: EVENT,
  VALID_EVENTS,
  normalize,
  isAsyncIterable,
};
