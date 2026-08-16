import net from "node:net";
import { randomBytes } from "node:crypto";
import { createNdjsonReader } from "./background-session-transport.js";
import {
  BACKGROUND_AGENT_KEEPER_ARM,
  BACKGROUND_AGENT_KEEPER_ARMED,
  BACKGROUND_AGENT_KEEPER_HELLO,
  BACKGROUND_AGENT_KEEPER_HEARTBEAT,
  BACKGROUND_AGENT_KEEPER_HEARTBEAT_INTERVAL_MS,
  BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION,
  BACKGROUND_AGENT_KEEPER_READY,
  BACKGROUND_AGENT_KEEPER_RETIRE,
  BACKGROUND_AGENT_KEEPER_RETIRED,
  createBackgroundAgentKeeperMessage,
  normalizeBackgroundAgentKeeperHello,
  normalizeBackgroundAgentKeeperTurn,
  resolveBackgroundAgentKeeperRetireTimeoutMs,
  sameBackgroundAgentKeeperTurn,
} from "./background-agent-keeper-protocol.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function keeperError(message, code = "BACKGROUND_AGENT_KEEPER_UNAVAILABLE") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function writeMessage(socket, message) {
  if (!socket || socket.destroyed) {
    throw keeperError("background agent keeper channel is closed");
  }
  socket.write(`${JSON.stringify(message)}\n`);
}

function connectOnce(pipePath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath);
    const onError = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.removeListener("error", onError);
      resolve(socket);
    });
  });
}

async function connectWithDeadline(pipePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await connectOnce(pipePath);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw keeperError(
    `timed out connecting to background agent keeper: ${lastError?.message || "unavailable"}`,
  );
}

export async function connectBackgroundAgentKeeper(options = {}) {
  const hello = normalizeBackgroundAgentKeeperHello(options);
  const connectTimeoutMs = Math.max(
    1,
    Number(options.connectTimeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS,
  );
  const requestTimeoutMs = Math.max(
    1,
    Number(options.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const retireTimeoutMs = resolveBackgroundAgentKeeperRetireTimeoutMs(
    options.retireTimeoutMs,
  );
  const heartbeatIntervalMs = Math.max(
    10,
    Number(options.heartbeatIntervalMs) ||
      BACKGROUND_AGENT_KEEPER_HEARTBEAT_INTERVAL_MS,
  );
  const socket = await connectWithDeadline(options.pipePath, connectTimeoutMs);
  const pending = new Map();
  let ready = false;
  let closing = false;
  let activeTurn = null;
  let heartbeatTimer = null;
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const failPending = (error) => {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    readyReject(error);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  socket.on(
    "data",
    createNdjsonReader(
      (message) => {
        if (
          message?.protocolVersion !== BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION
        ) {
          socket.destroy(
            keeperError("background agent keeper protocol mismatch"),
          );
          return;
        }
        if (!ready) {
          if (
            message.type !== BACKGROUND_AGENT_KEEPER_READY ||
            message.id !== hello.id ||
            message.workerGeneration !== hello.workerGeneration
          ) {
            socket.destroy(
              keeperError("background agent keeper ready binding mismatch"),
            );
            return;
          }
          ready = true;
          readyResolve();
          return;
        }
        const entry = pending.get(message.requestId);
        if (!entry) return;
        if (message.type === "background-agent-keeper-error") {
          pending.delete(message.requestId);
          clearTimeout(entry.timer);
          entry.reject(
            keeperError(
              message.message || "background agent keeper rejected request",
              message.code || "BACKGROUND_AGENT_KEEPER_REJECTED",
            ),
          );
          return;
        }
        if (message.type !== entry.expectedType) return;
        if (!sameBackgroundAgentKeeperTurn(message, entry.turn)) {
          socket.destroy(
            keeperError("background agent keeper response binding mismatch"),
          );
          return;
        }
        pending.delete(message.requestId);
        clearTimeout(entry.timer);
        entry.resolve(message);
      },
      (error) => socket.destroy(error),
    ),
  );
  socket.on("error", (error) => failPending(error));
  socket.on("close", () => {
    const error = keeperError("background agent keeper channel disconnected");
    failPending(error);
    if (!closing) options.onDisconnect?.(error, activeTurn);
  });

  writeMessage(
    socket,
    createBackgroundAgentKeeperMessage(BACKGROUND_AGENT_KEEPER_HELLO, hello),
  );
  const helloTimer = setTimeout(
    () =>
      socket.destroy(
        keeperError("timed out waiting for background agent keeper ready"),
      ),
    requestTimeoutMs,
  );
  helloTimer.unref?.();
  await readyPromise.finally(() => clearTimeout(helloTimer));
  const sendHeartbeat = () => {
    try {
      writeMessage(
        socket,
        createBackgroundAgentKeeperMessage(BACKGROUND_AGENT_KEEPER_HEARTBEAT, {
          id: hello.id,
          workerGeneration: hello.workerGeneration,
          workerPid: hello.workerPid,
        }),
      );
    } catch (error) {
      socket.destroy(error);
    }
  };
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  const request = (
    type,
    expectedType,
    turnValue,
    timeoutMs = requestTimeoutMs,
  ) => {
    const turn = normalizeBackgroundAgentKeeperTurn(turnValue);
    const requestId = randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(
          keeperError(
            `timed out waiting for background agent keeper ${type} after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      pending.set(requestId, { expectedType, reject, resolve, timer, turn });
      try {
        writeMessage(
          socket,
          createBackgroundAgentKeeperMessage(type, { requestId, ...turn }),
        );
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  };

  return Object.freeze({
    async arm(turn) {
      const normalized = normalizeBackgroundAgentKeeperTurn(turn);
      if (activeTurn) {
        throw keeperError(
          "background agent keeper is already armed",
          "BACKGROUND_AGENT_KEEPER_BUSY",
        );
      }
      await request(
        BACKGROUND_AGENT_KEEPER_ARM,
        BACKGROUND_AGENT_KEEPER_ARMED,
        normalized,
      );
      activeTurn = normalized;
      return normalized;
    },
    async retire(turn) {
      const normalized = normalizeBackgroundAgentKeeperTurn(turn);
      if (!sameBackgroundAgentKeeperTurn(normalized, activeTurn)) {
        throw keeperError(
          "background agent keeper retire binding mismatch",
          "BACKGROUND_AGENT_KEEPER_BINDING_MISMATCH",
        );
      }
      await request(
        BACKGROUND_AGENT_KEEPER_RETIRE,
        BACKGROUND_AGENT_KEEPER_RETIRED,
        normalized,
        retireTimeoutMs,
      );
      activeTurn = null;
      return true;
    },
    close() {
      if (closing) return;
      closing = true;
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      socket.end();
    },
    activeTurn: () => activeTurn,
  });
}
