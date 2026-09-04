import { createHash, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { resolve as resolvePath } from "node:path";
import { createSecureContext } from "node:tls";
import { WebSocketServer } from "ws";

import { BoundedAsyncQueue, QueueOverloadedError } from "./bounded-queue.js";
import { CcAppServer } from "./server.js";
import { JSON_RPC_ERROR, JsonRpcError, rpcError } from "./protocol.js";
import { isEvolutionWorkbenchCliHost } from "../evolution/evolution-workbench-cli-host.js";
import { isGovernedKnowledgeReviewHost } from "../evolution/governed-knowledge-review-host.js";

export const APP_SERVER_WEBSOCKET_PROTOCOL =
  "chainlesschain.app-server.experimental.v1";
export const APP_SERVER_WEBSOCKET_PATH = "/app-server";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const MAX_TLS_FILE_BYTES = 1024 * 1024;

function boundedInteger(value, fallback, minimum = 1, maximum = 1_000_000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(
    String(host || "")
      .trim()
      .toLowerCase(),
  );
}

export function validateWebSocketAppServerOptions(options = {}) {
  const host = String(options.host || "127.0.0.1").trim();
  const remote = !isLoopbackHost(host);
  const token = typeof options.token === "string" ? options.token : "";
  const tlsCertPath = options.tlsCertPath
    ? resolvePath(options.tlsCertPath)
    : null;
  const tlsKeyPath = options.tlsKeyPath
    ? resolvePath(options.tlsKeyPath)
    : null;

  if (Buffer.byteLength(token, "utf8") < 32) {
    throw new Error(
      "App Server WebSocket binding requires a token of at least 32 bytes",
    );
  }
  if (remote && options.allowRemote !== true) {
    throw new Error(
      "Non-loopback App Server WebSocket binding requires --allow-remote",
    );
  }
  if (remote && (!tlsCertPath || !tlsKeyPath)) {
    throw new Error(
      "Non-loopback App Server WebSocket binding requires TLS certificate and key",
    );
  }
  if ((tlsCertPath && !tlsKeyPath) || (!tlsCertPath && tlsKeyPath)) {
    throw new Error(
      "App Server WebSocket TLS requires both certificate and key",
    );
  }

  return Object.freeze({
    host,
    remote,
    token,
    tlsCertPath,
    tlsKeyPath,
    secure: Boolean(tlsCertPath && tlsKeyPath),
  });
}

function constantTimeTokenEqual(expected, actual) {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

function parseProtocols(request) {
  return new Set(
    String(request.headers?.["sec-websocket-protocol"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function presentedToken(request, protocols) {
  const authorization = String(request.headers?.authorization || "");
  const bearer = /^Bearer\s+(.+)$/iu.exec(authorization)?.[1];
  if (bearer) return bearer;
  const encoded = [...protocols]
    .find((protocol) => protocol.startsWith("bearer."))
    ?.slice("bearer.".length);
  if (!encoded) return "";
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readTlsFile(filePath, label, fsImpl) {
  let descriptor = null;
  try {
    const link = fsImpl.lstatSync(filePath);
    if (link.isSymbolicLink()) {
      throw new Error(`App Server TLS ${label} must not be a symbolic link`);
    }
    descriptor = fsImpl.openSync(
      filePath,
      fsImpl.constants.O_RDONLY | (fsImpl.constants.O_NOFOLLOW || 0),
    );
    const stat = fsImpl.fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_TLS_FILE_BYTES) {
      throw new Error(
        `App Server TLS ${label} must be a non-empty regular file no larger than 1 MiB`,
      );
    }
    if (
      label === "private key" &&
      process.platform !== "win32" &&
      (stat.mode & 0o077) !== 0
    ) {
      throw new Error(
        "App Server TLS private key must not be accessible by group or other users",
      );
    }
    return fsImpl.readFileSync(descriptor);
  } finally {
    if (descriptor != null) fsImpl.closeSync(descriptor);
  }
}

export class WebSocketConnectionTransport extends EventEmitter {
  constructor({
    socket,
    maxQueuedMessages = 256,
    maxQueuedBytes = 4 * 1024 * 1024,
    maxBufferedBytes = 2 * 1024 * 1024,
    slowConsumerTimeoutMs = 5_000,
  } = {}) {
    super();
    if (!socket || typeof socket.send !== "function") {
      throw new TypeError("WebSocket transport requires a socket");
    }
    this.socket = socket;
    this.maxBufferedBytes = boundedInteger(maxBufferedBytes, 2 * 1024 * 1024);
    this.slowConsumerTimeoutMs = boundedInteger(
      slowConsumerTimeoutMs,
      5_000,
      1,
      120_000,
    );
    this.queue = new BoundedAsyncQueue({
      maxItems: boundedInteger(maxQueuedMessages, 256),
      maxBytes: boundedInteger(maxQueuedBytes, 4 * 1024 * 1024),
      sizeOf: (frame) => Buffer.byteLength(frame, "utf8"),
    });
    this.closed = false;
    this.failure = null;
    this.pump = this._pump();
    this.pump.catch(() => {});
  }

  async _waitUntilWritable(frameBytes) {
    const deadline = Date.now() + this.slowConsumerTimeoutMs;
    while (
      Number(this.socket.bufferedAmount || 0) + frameBytes >
      this.maxBufferedBytes
    ) {
      if (Date.now() >= deadline) {
        throw new QueueOverloadedError(
          "App Server WebSocket slow consumer exceeded the buffer deadline",
          { retryAfterMs: 1_000 },
        );
      }
      await wait(10);
    }
  }

  async _sendFrame(frame) {
    if (this.socket.readyState !== 1) {
      throw new Error("App Server WebSocket is not open");
    }
    const frameBytes = Buffer.byteLength(frame, "utf8");
    await this._waitUntilWritable(frameBytes);
    await new Promise((resolve, reject) => {
      this.socket.send(frame, { binary: false }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  async _pump() {
    try {
      for await (const frame of this.queue) await this._sendFrame(frame);
    } catch (error) {
      this.failure = error;
      this.queue.close(error);
      this._tripSlowConsumer();
      throw error;
    }
  }

  _tripSlowConsumer() {
    if (this.socket.readyState === 0 || this.socket.readyState === 1) {
      try {
        this.socket.close(1013, "App Server slow consumer");
      } catch {
        this.socket.terminate?.();
      }
    }
    this.emit("breaker", this.failure);
  }

  send(message) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed)
      return Promise.reject(new Error("WebSocket transport closed"));
    const frame = JSON.stringify(message);
    try {
      this.queue.push(frame);
      return Promise.resolve();
    } catch (error) {
      if (error instanceof QueueOverloadedError) {
        this.failure = error;
        this._tripSlowConsumer();
      }
      return Promise.reject(error);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.queue.close();
    await this.pump.catch(() => {});
  }
}

export class WebSocketAppServerHost extends EventEmitter {
  constructor(options = {}) {
    super();
    if (
      options.evolutionWorkbenchHost != null &&
      !isEvolutionWorkbenchCliHost(options.evolutionWorkbenchHost)
    ) {
      throw new TypeError(
        "WebSocket App Server evolutionWorkbenchHost must be a branded Workbench host",
      );
    }
    if (
      options.governedKnowledgeReviewHost != null &&
      !isGovernedKnowledgeReviewHost(options.governedKnowledgeReviewHost)
    ) {
      throw new TypeError(
        "WebSocket App Server governedKnowledgeReviewHost must be a branded review host",
      );
    }
    this.options = options;
    this.binding = validateWebSocketAppServerOptions(options);
    this.port = boundedInteger(options.port, 18800, 0, 65_535);
    this.path = options.path || APP_SERVER_WEBSOCKET_PATH;
    this.maxConnections = boundedInteger(options.maxConnections, 10, 1, 1_000);
    this.maxPayloadBytes = boundedInteger(options.maxPayloadBytes, 1024 * 1024);
    this.maxPendingReceives = boundedInteger(options.maxPendingReceives, 512);
    this.cleanupTimeoutMs = boundedInteger(
      options.cleanupTimeoutMs,
      10_000,
      1,
      120_000,
    );
    this.store = options.store;
    this.kernelFactory = options.kernelFactory;
    this.serverFactory = options.serverFactory;
    this.WebSocketServerClass = options.WebSocketServerClass || WebSocketServer;
    this.createHttpServer = options.createHttpServer || createHttpServer;
    this.createHttpsServer = options.createHttpsServer || createHttpsServer;
    this.fs = options.fs || fs;
    this.createSecureContext =
      options.createSecureContext || createSecureContext;
    this.connections = new Map();
    this.cleanups = new Set();
    this.httpServer = null;
    this.wss = null;
    this.on("error", () => {});
  }

  _authorize(info, done) {
    const protocols = parseProtocols(info.req);
    if (!protocols.has(APP_SERVER_WEBSOCKET_PROTOCOL)) {
      done(false, 426, "App Server WebSocket subprotocol required");
      return;
    }
    if (
      this.binding.token &&
      !constantTimeTokenEqual(
        this.binding.token,
        presentedToken(info.req, protocols),
      )
    ) {
      done(false, 401, "Unauthorized");
      return;
    }
    if (this.connections.size >= this.maxConnections) {
      done(false, 503, "Connection limit reached");
      return;
    }
    done(true);
  }

  _createHttpHost() {
    const requestHandler = (_request, response) => {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      response.end("Not Found");
    };
    if (!this.binding.secure) return this.createHttpServer(requestHandler);
    const cert = readTlsFile(this.binding.tlsCertPath, "certificate", this.fs);
    const key = readTlsFile(this.binding.tlsKeyPath, "private key", this.fs);
    try {
      this.createSecureContext({ cert, key, minVersion: "TLSv1.2" });
    } catch {
      throw new Error(
        "App Server TLS certificate and private key are invalid or do not match",
      );
    }
    return this.createHttpsServer(
      {
        cert,
        key,
        minVersion: "TLSv1.2",
      },
      requestHandler,
    );
  }

  async start() {
    if (this.httpServer)
      throw new Error("App Server WebSocket already started");
    this.httpServer = this._createHttpHost();
    this.wss = new this.WebSocketServerClass({
      server: this.httpServer,
      path: this.path,
      maxPayload: this.maxPayloadBytes,
      perMessageDeflate: false,
      clientTracking: true,
      verifyClient: (info, done) => this._authorize(info, done),
      handleProtocols: (protocols) =>
        protocols.has(APP_SERVER_WEBSOCKET_PROTOCOL)
          ? APP_SERVER_WEBSOCKET_PROTOCOL
          : false,
    });
    this.wss.on("connection", (socket, request) =>
      this._accept(socket, request),
    );
    this.wss.on("error", (error) => this.emit("error", error));

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.httpServer.off("error", onError);
        resolve();
      };
      this.httpServer.once("error", onError);
      this.httpServer.once("listening", onListening);
      this.httpServer.listen(this.port, this.binding.host);
    });
    const address = this.httpServer.address();
    const port =
      typeof address === "object" && address ? address.port : this.port;
    this.port = port;
    const displayHost = this.binding.host.includes(":")
      ? `[${this.binding.host.replace(/^\[|\]$/gu, "")}]`
      : this.binding.host;
    return Object.freeze({
      host: this.binding.host,
      port,
      path: this.path,
      secure: this.binding.secure,
      stability: "experimental",
      url: `${this.binding.secure ? "wss" : "ws"}://${displayHost}:${port}${this.path}`,
    });
  }

  _accept(socket, request) {
    const transport = new WebSocketConnectionTransport({
      socket,
      maxQueuedMessages: this.options.maxQueuedMessages,
      maxQueuedBytes: this.options.maxQueuedBytes,
      maxBufferedBytes: this.options.maxBufferedBytes,
      slowConsumerTimeoutMs: this.options.slowConsumerTimeoutMs,
    });
    const send = (message) => transport.send(message);
    const server = this.serverFactory
      ? this.serverFactory({ send, request, transport: "websocket" })
      : new CcAppServer({
          send,
          store: this.store,
          kernel: this.kernelFactory?.(),
          evolutionCompositionFactory:
            this.options.evolutionCompositionFactory ?? null,
          skillOutcomeIndex: this.options.skillOutcomeIndex ?? null,
          skillVectorAuthority: this.options.skillVectorAuthority ?? null,
          skillRetrievalRevocationReader:
            this.options.skillRetrievalRevocationReader ?? null,
          evolutionWorkbenchHost: this.options.evolutionWorkbenchHost ?? null,
          governedKnowledgeReviewHost:
            this.options.governedKnowledgeReviewHost ?? null,
          transport: "websocket",
          maxQueuedRequests: this.options.maxQueuedRequests,
          maxQueuedRequestBytes: this.options.maxQueuedRequestBytes,
          maxConcurrentRequests: this.options.maxConcurrentRequests,
          requestTimeoutMs: this.options.requestTimeoutMs,
          interruptSettlementMs: this.options.interruptSettlementMs,
        });
    const context = {
      socket,
      transport,
      server,
      pending: new Set(),
      closing: false,
      cleanup: null,
    };
    this.connections.set(socket, context);
    socket.on("message", (data, isBinary) =>
      this._receive(context, data, isBinary),
    );
    socket.on("close", () => void this._cleanup(context));
    socket.on("error", (error) => {
      this.emit("connection-error", error);
      void this._cleanup(context);
    });
    transport.on("breaker", () => void this._cleanup(context));
    this.emit("connection", { remoteAddress: request.socket?.remoteAddress });
  }

  _receive(context, data, isBinary) {
    if (context.closing) return;
    if (isBinary) {
      context.socket.close(1003, "JSON text frames required");
      return;
    }
    const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (frame.length > this.maxPayloadBytes) {
      context.socket.close(1009, "App Server frame too large");
      return;
    }
    let message;
    try {
      message = JSON.parse(frame.toString("utf8"));
    } catch {
      this._sendControl(
        context,
        rpcError(
          null,
          new JsonRpcError(JSON_RPC_ERROR.PARSE_ERROR, "Invalid JSON"),
        ),
      );
      return;
    }

    const isClientResponse =
      message?.method == null && Object.hasOwn(message || {}, "id");
    if (!isClientResponse && context.pending.size >= this.maxPendingReceives) {
      this._sendControl(
        context,
        rpcError(
          message?.id,
          new JsonRpcError(
            JSON_RPC_ERROR.OVERLOADED,
            "App Server WebSocket receive queue is overloaded",
            { retry_after_ms: 100 },
          ),
        ),
      );
      return;
    }

    const pending = Promise.resolve()
      .then(() => context.server.receive(message))
      .catch((error) => {
        this.emit("connection-error", error);
        void this._cleanup(context);
      });
    context.pending.add(pending);
    pending.finally(() => context.pending.delete(pending));
  }

  _sendControl(context, message) {
    void context.transport.send(message).catch((error) => {
      this.emit("connection-error", error);
      void this._cleanup(context);
    });
  }

  async _cleanup(context) {
    if (context.cleanup) return context.cleanup;
    context.closing = true;
    this.connections.delete(context.socket);
    context.cleanup = this._finishCleanup(context);
    this.cleanups.add(context.cleanup);
    void context.cleanup.then(
      () => this.cleanups.delete(context.cleanup),
      () => this.cleanups.delete(context.cleanup),
    );
    return context.cleanup;
  }

  async _finishCleanup(context) {
    const settlement = Promise.allSettled([
      context.transport.close(),
      Promise.resolve().then(() => context.server.close?.()),
      ...context.pending,
    ]);
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, this.cleanupTimeoutMs, "timeout");
      timer.unref?.();
    });
    try {
      if ((await Promise.race([settlement, deadline])) === "timeout") {
        this.emit(
          "connection-error",
          new Error("App Server WebSocket cleanup deadline exceeded"),
        );
        context.socket.terminate?.();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async close() {
    const contexts = [...this.connections.values()];
    for (const context of contexts) {
      try {
        context.socket.close(1001, "App Server shutting down");
      } catch {
        context.socket.terminate?.();
      }
    }
    await Promise.all(contexts.map((context) => this._cleanup(context)));
    await Promise.allSettled([...this.cleanups]);
    for (const context of contexts) {
      if (context.socket.readyState !== 3) context.socket.terminate?.();
    }
    if (this.wss) {
      await new Promise((resolve) => this.wss.close(() => resolve()));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(() => resolve()));
      this.httpServer = null;
    }
  }
}
