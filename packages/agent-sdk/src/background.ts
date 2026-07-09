/**
 * BackgroundSessionClient — attach to a running background agent.
 *
 * Speaks the NDJSON control protocol from
 * packages/cli/src/lib/background-session-transport.js over the local pipe
 * (Windows named pipe / POSIX domain socket). Auth is possession-based:
 * the token lives in the 0600 state file next to the pipe path, so any
 * same-user process may attach.
 */

import net from "node:net";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createNdjsonDecoder, encodeNdjson } from "./ndjson.js";
import type { BgClientMessage, BgServerMessage } from "./protocol.js";

export interface BackgroundAgentState {
  id: string;
  sessionId?: string;
  status?: string;
  phase?: string;
  turnCount?: number;
  transport?: { pipe?: string; token?: string };
  [key: string]: unknown;
}

export function backgroundAgentsDir(): string {
  return join(homedir(), ".chainlesschain", "background-agents");
}

/** Read a background agent's state file (`<dir>/<id>.json`). */
export function readBackgroundAgentState(
  id: string,
  dir: string = backgroundAgentsDir(),
): BackgroundAgentState {
  const raw = readFileSync(join(dir, `${id}.json`), "utf8");
  return JSON.parse(raw) as BackgroundAgentState;
}

export interface AttachOptions {
  /** Agent id — state file is read for pipe/token unless both are given. */
  id?: string;
  dir?: string;
  pipePath?: string;
  token?: string;
  timeoutMs?: number;
  onEvent?: (event: BgServerMessage) => void;
  onClose?: () => void;
}

export interface BackgroundSessionHandle {
  hello: BgServerMessage;
  send: (message: BgClientMessage) => boolean;
  prompt: (text: string) => boolean;
  requestStatus: () => boolean;
  stopTurn: () => boolean;
  detach: () => void;
}

/**
 * Connect + authenticate. Resolves only after the server's hello ack, so a
 * resolved handle is immediately usable.
 */
export function attachBackgroundSession(
  options: AttachOptions,
): Promise<BackgroundSessionHandle> {
  let pipePath = options.pipePath;
  let token = options.token;
  if (!pipePath || !token) {
    if (!options.id) {
      return Promise.reject(
        new Error("attachBackgroundSession requires id, or pipePath + token"),
      );
    }
    const state = readBackgroundAgentState(options.id, options.dir);
    pipePath = pipePath || state.transport?.pipe;
    token = token || state.transport?.token;
    if (!pipePath || !token) {
      return Promise.reject(
        new Error(
          `background agent ${options.id} has no interactive transport`,
        ),
      );
    }
  }
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.connect(pipePath as string);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("session transport handshake timed out"));
      }
    }, timeoutMs);
    timer.unref?.();

    const write = (message: BgClientMessage): boolean => {
      if (socket.destroyed) return false;
      try {
        return socket.write(encodeNdjson(message));
      } catch {
        return false;
      }
    };

    socket.on(
      "data",
      createNdjsonDecoder<BgServerMessage>((message) => {
        if (!settled) {
          if (message.type === "hello") {
            settled = true;
            clearTimeout(timer);
            resolve({
              hello: message,
              send: write,
              prompt: (text) => write({ type: "prompt", text }),
              requestStatus: () => write({ type: "status" }),
              stopTurn: () => write({ type: "stop" }),
              detach: () => {
                write({ type: "detach" });
                socket.end();
              },
            });
          }
          return;
        }
        try {
          options.onEvent?.(message);
        } catch {
          /* observer errors never kill the connection */
        }
      }),
    );
    socket.on("connect", () => {
      write({ type: "hello", token: token as string });
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
          options.onClose?.();
        } catch {
          /* observer errors are not connection errors */
        }
      }
    });
  });
}
