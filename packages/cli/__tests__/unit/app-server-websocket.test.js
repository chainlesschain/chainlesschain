import { once } from "node:events";
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";

import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import {
  APP_SERVER_WEBSOCKET_PROTOCOL,
  WebSocketAppServerHost,
  WebSocketConnectionTransport,
  validateWebSocketAppServerOptions,
} from "../../src/lib/app-server/websocket-transport.js";
import { APP_SERVER_PROTOCOL_VERSION } from "../../src/lib/app-server/protocol.js";
import { createEvolutionWorkbenchCliHost } from "../../src/lib/evolution/evolution-workbench-cli-host.js";

const TEST_TOKEN = "app-server-websocket-test-token-0001";

function workbenchHost() {
  return createEvolutionWorkbenchCliHost({
    tenantId: "tenant:websocket",
    projectionLoader: { load: vi.fn() },
    projectionAuthority: { retain: vi.fn() },
    identityProvider: { current: vi.fn() },
    activeStateReader: { read: vi.fn() },
    batchExecutor: { execute: vi.fn() },
    rollbackExecutor: { execute: vi.fn() },
  });
}

function initialize(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: APP_SERVER_PROTOCOL_VERSION,
      minimumProtocolVersion: 1,
      client: { name: "websocket-test", version: "1" },
      features: ["thread_turn_item", "bounded_transport"],
    },
  };
}

function openSocket(url, options = {}) {
  const { protocols, token = TEST_TOKEN, headers, ...socketOptions } = options;
  const requestHeaders = { ...headers };
  if (token != null && requestHeaders.Authorization == null) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  const socket = new WebSocket(
    url,
    protocols || [APP_SERVER_WEBSOCKET_PROTOCOL],
    {
      ...socketOptions,
      headers: requestHeaders,
    },
  );
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

describe("experimental App Server WebSocket transport", () => {
  it("requires explicit remote opt-in, a strong token, and TLS", () => {
    expect(
      validateWebSocketAppServerOptions({
        host: "127.0.0.1",
        token: TEST_TOKEN,
      }),
    ).toMatchObject({ remote: false, secure: false });
    expect(() =>
      validateWebSocketAppServerOptions({ host: "127.0.0.1" }),
    ).toThrow(/token of at least 32 bytes/u);
    expect(() =>
      validateWebSocketAppServerOptions({
        host: "0.0.0.0",
        token: TEST_TOKEN,
      }),
    ).toThrow(/--allow-remote/u);
    expect(() =>
      validateWebSocketAppServerOptions({
        host: "0.0.0.0",
        allowRemote: true,
        token: "short",
      }),
    ).toThrow(/at least 32 bytes/u);
    expect(() =>
      validateWebSocketAppServerOptions({
        host: "0.0.0.0",
        allowRemote: true,
        token: "x".repeat(32),
      }),
    ).toThrow(/TLS certificate and key/u);
    expect(
      validateWebSocketAppServerOptions({
        host: "0.0.0.0",
        allowRemote: true,
        token: "x".repeat(32),
        tlsCertPath: "server.crt",
        tlsKeyPath: "server.key",
      }),
    ).toMatchObject({ remote: true, secure: true });

    const unsafeTlsHost = new WebSocketAppServerHost({
      host: "0.0.0.0",
      allowRemote: true,
      token: TEST_TOKEN,
      tlsCertPath: "server.crt",
      tlsKeyPath: "server.key",
      fs: {
        lstatSync: () => ({ isSymbolicLink: () => true }),
      },
    });
    expect(() => unsafeTlsHost._createHttpHost()).toThrow(/symbolic link/u);
  });

  it("authenticates the fixed subprotocol and negotiates canonical JSON-RPC", async () => {
    const token = TEST_TOKEN;
    const host = new WebSocketAppServerHost({
      host: "127.0.0.1",
      port: 0,
      token: TEST_TOKEN,
      store: new MemoryRolloutStore(),
      kernelFactory: () => ({ close: vi.fn() }),
    });
    const info = await host.start();

    const unauthorized = new WebSocket(`${info.url}?token=${token}`, [
      APP_SERVER_WEBSOCKET_PROTOCOL,
    ]);
    const statusCode = await new Promise((resolve, reject) => {
      unauthorized.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode);
      });
      unauthorized.once("open", () => reject(new Error("unexpected open")));
      unauthorized.once("error", () => {});
    });
    expect(statusCode).toBe(401);

    const socket = await openSocket(info.url, {
      token,
    });
    expect(socket.protocol).toBe(APP_SERVER_WEBSOCKET_PROTOCOL);
    const response = nextMessage(socket);
    socket.send(JSON.stringify(initialize()));
    await expect(response).resolves.toMatchObject({
      id: 1,
      result: {
        protocolVersion: APP_SERVER_PROTOCOL_VERSION,
        transports: ["websocket"],
        websocket: { stability: "experimental" },
      },
    });

    socket.close();
    await once(socket, "close");
    await host.close();
  });

  it("injects only a branded Workbench host into each server connection", async () => {
    expect(
      () =>
        new WebSocketAppServerHost({
          host: "127.0.0.1",
          token: TEST_TOKEN,
          evolutionWorkbenchHost: {},
        }),
    ).toThrow(/branded Workbench host/u);

    const host = new WebSocketAppServerHost({
      host: "127.0.0.1",
      port: 0,
      token: TEST_TOKEN,
      store: new MemoryRolloutStore(),
      kernelFactory: () => ({ close: vi.fn() }),
      evolutionWorkbenchHost: workbenchHost(),
    });
    const info = await host.start();
    const socket = await openSocket(info.url);
    const response = nextMessage(socket);
    socket.send(JSON.stringify(initialize()));
    await expect(response).resolves.toMatchObject({
      id: 1,
      result: {
        evolutionWorkbench: {
          available: true,
          methods: ["list", "compare", "review", "rollback"],
        },
      },
    });

    socket.close();
    await once(socket, "close");
    await host.close();
  });

  it("accepts a browser-compatible bearer subprotocol without echoing it", async () => {
    const token = "browser-compatible-token-00000001";
    const host = new WebSocketAppServerHost({
      host: "127.0.0.1",
      port: 0,
      token,
      serverFactory: () => ({
        receive: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const info = await host.start();
    const socket = await openSocket(info.url, {
      token: null,
      protocols: [
        APP_SERVER_WEBSOCKET_PROTOCOL,
        `bearer.${Buffer.from(token).toString("base64url")}`,
      ],
    });
    expect(socket.protocol).toBe(APP_SERVER_WEBSOCKET_PROTOCOL);
    socket.close();
    await once(socket, "close");
    await host.close();
  });

  it("bounds cleanup when a connection receive never settles", async () => {
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const host = new WebSocketAppServerHost({
      host: "127.0.0.1",
      port: 0,
      token: TEST_TOKEN,
      cleanupTimeoutMs: 5,
      serverFactory: () => ({
        receive: () => {
          markStarted();
          return new Promise(() => {});
        },
        close: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const connectionError = once(host, "connection-error");
    const info = await host.start();
    const socket = await openSocket(info.url);
    socket.send(JSON.stringify(initialize()));
    await started;
    socket.close();
    await once(socket, "close");
    await host.close();
    await expect(connectionError).resolves.toEqual([
      expect.objectContaining({
        message: "App Server WebSocket cleanup deadline exceeded",
      }),
    ]);
  });

  it("returns OVERLOADED with retry guidance before pending receives grow", async () => {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const receive = vi.fn(async () => held);
    const host = new WebSocketAppServerHost({
      host: "127.0.0.1",
      port: 0,
      token: TEST_TOKEN,
      maxPendingReceives: 1,
      serverFactory: () => ({
        receive,
        close: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const info = await host.start();
    const socket = await openSocket(info.url);
    socket.send(JSON.stringify(initialize(1)));
    const overloaded = nextMessage(socket);
    socket.send(JSON.stringify(initialize(2)));

    await expect(overloaded).resolves.toMatchObject({
      id: 2,
      error: {
        code: -32001,
        data: { retry_after_ms: 100 },
      },
    });
    expect(receive).toHaveBeenCalledTimes(1);
    release();
    socket.close();
    await once(socket, "close");
    await host.close();
  });

  it("trips the slow-consumer breaker when buffered output cannot drain", async () => {
    class FakeSocket {
      readyState = 1;
      bufferedAmount = 1024;
      close = vi.fn(() => {
        this.readyState = 3;
      });
      send = vi.fn((_frame, _options, callback) => callback());
    }
    const socket = new FakeSocket();
    const transport = new WebSocketConnectionTransport({
      socket,
      maxBufferedBytes: 1,
      slowConsumerTimeoutMs: 5,
    });
    const breaker = once(transport, "breaker");
    await transport.send({ jsonrpc: "2.0", id: 1, result: null });
    await breaker;

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1013, "App Server slow consumer");
    await transport.close();
  });

  it("keeps the formal exact-SHA overload gate at or above 30 minutes", () => {
    const workflow = readFileSync(
      new URL(
        "../../../../.github/workflows/app-server-overload-soak.yml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(workflow).toMatch(/default: ["']1800["']/u);
    expect(workflow).toContain("CC_APP_SERVER_SOAK_EXPECTED_SHA");
    expect(workflow).toContain("node --expose-gc");
    expect(workflow).toContain("if-no-files-found: error");
  });
});
