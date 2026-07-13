/**
 * background-session-transport — local control channel for interactive attach.
 *
 * The background-agent worker hosts a per-session NDJSON server on a local
 * pipe (Windows named pipe / POSIX domain socket). `cc attach <id>` connects
 * to it to send follow-up prompts into the running session and receive
 * lifecycle events (turn-started / turn-ended / idle), turning the log-only
 * attach into a real interactive takeover.
 *
 * Auth model: the worker generates a random token, stored in the 0600 state
 * file next to the pipe path. A client must open with
 * `{type:"hello", token}` — anything else (or a wrong token, or silence for
 * 5s) destroys the connection. Named pipes are reachable by other local
 * users on Windows, so possession of the state file IS the capability.
 *
 * Protocol (one JSON object per line, both directions):
 *   client → worker: {type:"hello", token} · {type:"prompt", text}
 *                    · {type:"status"} · {type:"stop"} · {type:"detach"}
 *   worker → client: {type:"hello", ...status} · {type:"accepted", queued}
 *                    · {type:"status", ...status} · {type:"error", message}
 *                    · {type:"turn-started"|"turn-ended"|"idle", ...}
 */

import net from "node:net";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

const HELLO_TIMEOUT_MS = 5000;
const MAX_LINE_BYTES = 1024 * 1024;

/** Pipe endpoint for a session id (Windows named pipe / POSIX socket file). */
export function transportPipePath(id, dir) {
  if (process.platform === "win32") return `\\\\.\\pipe\\cc-bg-${id}`;
  return join(dir, `${id}.sock`);
}

/**
 * NDJSON line framing with a carry buffer — a chunk boundary can split a
 * line, so the remainder must carry into the next chunk instead of being
 * parsed (and dropped) as its own line.
 */
export function createNdjsonReader(onMessage, onError = () => {}) {
  let carry = "";
  return (chunk) => {
    carry += chunk.toString("utf8");
    if (carry.length > MAX_LINE_BYTES) {
      carry = "";
      onError(new Error("line too long"));
      return;
    }
    let index;
    while ((index = carry.indexOf("\n")) !== -1) {
      const line = carry.slice(0, index).replace(/\r$/, "");
      carry = carry.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        onError(error);
        continue;
      }
      onMessage(message);
    }
  };
}

function writeMessage(socket, message) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(`${JSON.stringify(message)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the worker-side control server.
 *
 * @param {object} opts
 * @param {string} opts.id background agent id
 * @param {string} opts.dir backgroundAgentsDir() (POSIX socket location)
 * @param {string} opts.token shared secret from the session state file
 * @param {(text:string)=>{queued:number}} opts.onPrompt queue a follow-up
 *        prompt; throw to reject (message is relayed to the client)
 * @param {()=>void} [opts.onStop] kill the current agent turn
 * @param {(count:number)=>void} [opts.onClientChange]
 * @param {()=>object} [opts.getStatus] session status payload for hello/status
 * @returns {Promise<{pipePath:string, clientCount:()=>number,
 *          broadcast:(msg:object)=>void, close:()=>Promise<void>}>}
 */
export function startBackgroundSessionServer(opts) {
  const { id, dir, token, onPrompt, onStop, onClientChange, getStatus } = opts;
  const pipePath = opts.pipePath || transportPipePath(id, dir);
  if (process.platform !== "win32") {
    try {
      unlinkSync(pipePath); // stale socket from a crashed prior worker
    } catch {
      /* fine — usually ENOENT */
    }
  }
  const clients = new Set();
  const notifyClients = () => {
    try {
      onClientChange?.(clients.size);
    } catch {
      /* observer errors never take the server down */
    }
  };

  const server = net.createServer((socket) => {
    let authed = false;
    const helloTimer = setTimeout(() => {
      if (!authed) socket.destroy();
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    socket.on(
      "data",
      createNdjsonReader(
        (message) => {
          if (!authed) {
            if (message.type === "hello" && message.token === token) {
              authed = true;
              clearTimeout(helloTimer);
              clients.add(socket);
              writeMessage(socket, {
                type: "hello",
                ...(getStatus ? getStatus() : { id }),
              });
              notifyClients();
            } else {
              socket.destroy();
            }
            return;
          }
          switch (message.type) {
            case "prompt": {
              const text = String(message.text || "").trim();
              if (!text) {
                writeMessage(socket, {
                  type: "error",
                  message: "prompt text is empty",
                });
                return;
              }
              try {
                const result = onPrompt(text);
                writeMessage(socket, {
                  type: "accepted",
                  queued: result?.queued ?? 1,
                });
              } catch (error) {
                writeMessage(socket, {
                  type: "error",
                  message: error?.message || String(error),
                });
              }
              return;
            }
            case "status": {
              writeMessage(socket, {
                type: "status",
                ...(getStatus ? getStatus() : { id }),
              });
              return;
            }
            case "stop": {
              try {
                onStop?.();
                writeMessage(socket, { type: "stopping" });
              } catch (error) {
                writeMessage(socket, {
                  type: "error",
                  message: error?.message || String(error),
                });
              }
              return;
            }
            case "detach": {
              socket.end();
              return;
            }
            default:
              writeMessage(socket, {
                type: "error",
                message: `unknown message type: ${message.type}`,
              });
          }
        },
        () => {
          // Unparseable input on an authed connection is a broken client —
          // and on an unauthed one, a probe. Either way, drop it.
          socket.destroy();
        },
      ),
    );

    const drop = () => {
      clearTimeout(helloTimer);
      if (clients.delete(socket)) notifyClients();
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipePath, () => {
      server.removeListener("error", reject);
      server.on("error", () => {
        /* post-listen errors must not crash the worker */
      });
      resolve({
        pipePath,
        clientCount: () => clients.size,
        broadcast: (message) => {
          for (const socket of clients) writeMessage(socket, message);
        },
        close: () =>
          new Promise((done) => {
            for (const socket of clients) socket.destroy();
            clients.clear();
            server.close(() => {
              if (process.platform !== "win32") {
                try {
                  unlinkSync(pipePath);
                } catch {
                  /* already gone */
                }
              }
              done();
            });
          }),
      });
    });
  });
}

/**
 * Client side: connect, authenticate, and expose send/close. Resolves only
 * after the server's hello ack — so a resolved connection is usable.
 *
 * @param {object} opts
 * @param {string} opts.pipePath from the session state file `transport.pipe`
 * @param {string} opts.token from the session state file `transport.token`
 * @param {(msg:object)=>void} [opts.onEvent] server-pushed messages
 * @param {()=>void} [opts.onClose]
 * @returns {Promise<{send:(msg:object)=>boolean, close:()=>void, hello:object}>}
 */
export function connectBackgroundSession(opts) {
  const { pipePath, token, onEvent, onClose, timeoutMs = 5000 } = opts;
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.connect(pipePath);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("session transport handshake timed out"));
      }
    }, timeoutMs);
    timer.unref?.();

    socket.on(
      "data",
      createNdjsonReader((message) => {
        if (!settled) {
          if (message.type === "hello") {
            settled = true;
            clearTimeout(timer);
            // The transport client socket must never be the sole reason its
            // owner's event loop stays alive — real callers are held open by
            // their own handles (attach: stdin/readline; WS bridge: the
            // WebSocket server), both of which already unref their poll timers.
            // A still-open (or half-closed) socket lingering at teardown was
            // pinning vitest's forks-pool worker past its terminate deadline
            // → "Worker exited unexpectedly" flake on CI.
            socket.unref?.();
            resolve({
              hello: message,
              send: (msg) => writeMessage(socket, msg),
              close: () => {
                writeMessage(socket, { type: "detach" });
                socket.end();
                // Release the handle immediately rather than lingering in a
                // half-open FIN wait if the peer never FINs back (worker still
                // finalizing / already gone). Best-effort: end() has already
                // flushed the detach frame.
                const reaper = setTimeout(() => socket.destroy(), 1000);
                reaper.unref?.();
              },
            });
          }
          return;
        }
        try {
          onEvent?.(message);
        } catch {
          /* rendering errors never kill the connection */
        }
      }),
    );
    socket.on("connect", () => {
      writeMessage(socket, { type: "hello", token });
    });
    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    socket.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("session transport closed during handshake"));
      } else {
        try {
          onClose?.();
        } catch {
          /* observer errors are not connection errors */
        }
      }
    });
  });
}
