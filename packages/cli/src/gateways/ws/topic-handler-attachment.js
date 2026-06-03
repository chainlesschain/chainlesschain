/**
 * topic-handler-attachment — wrap a `ChainlessChainWSServer` instance with
 * custom topic handlers, mirroring the existing dispatcher.
 *
 * Extracted from `desktop-app-vue/src/main/web-shell/ws-cli-loader.js` so
 * both consumers (desktop web-shell AND `cc ui`) get the same protocol
 * features:
 *
 *   - id + auth gates (token-protected servers reject unauthenticated
 *     custom-topic calls; native CLI dispatch is untouched)
 *   - plain async handler → `{type:"<topic>.result", ok, result}`
 *   - async generator handler → `{type:"<topic>.chunk", ok, chunk}` *N +
 *     terminal `{type:"<topic>.result", ok, result}`
 *   - `<topic>.cancel` frame → `gen.return("client_cancel")` for in-flight
 *     streams (keyed by request id, not topic)
 *   - `ws.on("close")` → unwind every stream the client owned
 *
 * Single call site contract:
 *
 *   const handle = attachTopicHandlers(server, {
 *     handlers: { 'terminal.create': async (frame, ctx) => {...}, ... },
 *   });
 *   handle.register('extra.topic', fn);
 *   handle.broadcast({type:'terminal.stdout', payload:{...}});
 *
 * Returns `{ register, broadcast, topicHandlers }`. The server's
 * `_dispatcher` is mutated in place — calling this twice on the same
 * server stacks wrappers (each falls through to the previous), which is
 * fine but usually unnecessary.
 */

/**
 * @typedef {(frame: any, ctx: { topic: string, id: string, server: any, ws: any, clientId: string }) => (Promise<any> | any | AsyncIterable<any>)} TopicHandler
 */

/**
 * @param {any} server  ChainlessChainWSServer instance (post-start())
 * @param {object} [opts]
 * @param {Record<string, TopicHandler>} [opts.handlers]
 * @returns {{
 *   register: (topic: string, fn: TopicHandler) => void,
 *   broadcast: (frame: any) => void,
 *   topicHandlers: Map<string, TopicHandler>,
 * }}
 */
export function attachTopicHandlers(server, opts = {}) {
  /** @type {Map<string, TopicHandler>} */
  const topicHandlers = new Map();
  if (opts.handlers) {
    for (const [topic, fn] of Object.entries(opts.handlers)) {
      if (typeof fn !== "function") {
        throw new TypeError(
          `attachTopicHandlers: handler for "${topic}" must be a function`,
        );
      }
      topicHandlers.set(topic, fn);
    }
  }

  /** @type {Map<string, { gen: AsyncIterator<any>, clientId: string }>} */
  const inFlightStreams = new Map();

  async function unwindStream(id, reason) {
    const entry = inFlightStreams.get(id);
    if (!entry) return;
    inFlightStreams.delete(id);
    try {
      if (typeof entry.gen.return === "function") {
        await entry.gen.return(reason);
      }
    } catch {
      // Generator throw on unwind is non-fatal.
    }
  }

  const wsCloseHooked = new WeakSet();
  function ensureWsCloseHook(ws, clientId) {
    if (!ws || typeof ws.on !== "function") return;
    if (wsCloseHooked.has(ws)) return;
    wsCloseHooked.add(ws);
    ws.on("close", () => {
      for (const [id, entry] of inFlightStreams) {
        if (entry.clientId === clientId) {
          unwindStream(id, "ws_close").catch(() => {});
        }
      }
    });
  }

  const originalDispatcher = server._dispatcher;
  server._dispatcher = {
    async dispatch(clientId, ws, message) {
      const { id, type } = message || {};
      ensureWsCloseHook(ws, clientId);

      if (id && typeof type === "string" && type.endsWith(".cancel")) {
        await unwindStream(id, "client_cancel");
        return;
      }

      if (id && type && topicHandlers.has(type)) {
        const client = server.clients.get(clientId);
        if (server.token && (!client || !client.authenticated)) {
          server._send(ws, {
            id,
            type: "error",
            code: "AUTH_REQUIRED",
            message: "Authentication required. Send an auth message first.",
          });
          return;
        }

        const handler = topicHandlers.get(type);
        try {
          const ret = handler(message, {
            topic: type,
            id,
            server,
            ws,
            clientId,
          });

          if (ret && typeof ret[Symbol.asyncIterator] === "function") {
            inFlightStreams.set(id, { gen: ret, clientId });
            let finalReturn = null;
            try {
              for (;;) {
                const step = await ret.next();
                if (step.done) {
                  finalReturn = step.value ?? null;
                  break;
                }
                if (ws.readyState !== 1) {
                  await unwindStream(id, "readyState_closed");
                  return;
                }
                server._send(ws, {
                  id,
                  type: `${type}.chunk`,
                  ok: true,
                  chunk: step.value ?? null,
                });
              }
              server._send(ws, {
                id,
                type: `${type}.result`,
                ok: true,
                result: finalReturn,
              });
            } catch (streamErr) {
              server._send(ws, {
                id,
                type: `${type}.result`,
                ok: false,
                error:
                  streamErr instanceof Error
                    ? streamErr.message
                    : String(streamErr),
              });
            } finally {
              inFlightStreams.delete(id);
            }
            return;
          }

          const result = await ret;
          server._send(ws, {
            id,
            type: `${type}.result`,
            ok: true,
            result: result ?? null,
          });
        } catch (err) {
          server._send(ws, {
            id,
            type: `${type}.result`,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      return originalDispatcher.dispatch(clientId, ws, message);
    },
  };

  function register(topic, fn) {
    if (typeof topic !== "string" || !topic) {
      throw new TypeError(
        "attachTopicHandlers: topic must be a non-empty string",
      );
    }
    if (typeof fn !== "function") {
      throw new TypeError("attachTopicHandlers: handler must be a function");
    }
    topicHandlers.set(topic, fn);
  }

  function broadcast(frame) {
    if (!frame || typeof frame !== "object") return;
    try {
      server._broadcast(frame);
    } catch {
      // _send is readyState-guarded inside the server; the only path here
      // would be an internal CLI ws-server bug. Don't crash the caller.
    }
  }

  return { register, broadcast, topicHandlers };
}
