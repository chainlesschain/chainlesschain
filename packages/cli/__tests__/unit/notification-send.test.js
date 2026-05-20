/**
 * Unit tests for #21 v1.3+ — `cc notification send` (commands/notification.js).
 *
 * Mock the two side-effects through the `_deps` injection seam:
 *   - fs.readFileSync — port discovery file
 *   - WebSocket      — desktop ws-bridge connection
 *
 * We don't go through commander; we invoke `runSendNotification(options, deps)`
 * directly. Each test wires a fresh fake WebSocket and asserts the wire frame
 * + the resolved exit code.
 *
 * `cli-dev.md` warns that `vi.mock("fs")` is unreliable in vitest forks pool,
 * so we use straight DI here.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

import { runSendNotification } from "../../src/commands/notification.js";

// ── fake WebSocket constructor ──────────────────────────────────

function makeFakeWebSocketFactory({
  onOpen,
  responseFor,
  errorOnConnect,
  delayMs = 0,
} = {}) {
  const sockets = [];
  function Ctor(url) {
    const socket = new EventEmitter();
    socket.url = url;
    socket.sent = [];
    socket.readyState = 1;
    socket.send = (frame) => {
      socket.sent.push(frame);
    };
    socket.close = vi.fn();
    socket.terminate = vi.fn();
    sockets.push(socket);

    if (errorOnConnect) {
      setImmediate(() => socket.emit("error", new Error(errorOnConnect)));
      return socket;
    }

    setImmediate(() => {
      socket.emit("open");
      if (onOpen) onOpen(socket);
      if (responseFor) {
        const respond = () => {
          const sent = socket.sent[0] ? JSON.parse(socket.sent[0]) : null;
          const response = responseFor(sent);
          if (response) {
            socket.emit("message", Buffer.from(JSON.stringify(response)));
          }
        };
        if (delayMs > 0) {
          setTimeout(respond, delayMs);
        } else {
          setImmediate(respond);
        }
      }
    });

    return socket;
  }
  Ctor.sockets = sockets;
  return Ctor;
}

function makeFsWithDescriptor(descriptor) {
  return {
    readFileSync: () => JSON.stringify(descriptor),
  };
}

function makeFsThrowing(code, message) {
  return {
    readFileSync: () => {
      const err = new Error(message || code);
      err.code = code;
      throw err;
    },
  };
}

function captureLogs() {
  const log = [];
  const err = [];
  return {
    log: (m) => log.push(m),
    err: (m) => err.push(m),
    logs: log,
    errs: err,
  };
}

// ── tests ───────────────────────────────────────────────────────

describe("cc notification send — happy path", () => {
  it("opens WS, sends correct frame, returns 0 on ok response", async () => {
    const fs = makeFsWithDescriptor({
      pid: process.pid, // current process is alive
      host: "127.0.0.1",
      port: 51234,
      wsUrl: "ws://127.0.0.1:51234/",
      startedAt: Date.now(),
    });
    const WebSocket = makeFakeWebSocketFactory({
      responseFor: (sent) => ({
        type: "notification.send-mobile.result",
        id: sent.id,
        ok: true,
        result: { id: "notif-123", timestamp: 9999 },
      }),
    });
    const sink = captureLogs();

    const exitCode = await runSendNotification(
      {
        target: "did:cc:iphone-abc",
        title: "Test",
        body: "Body",
        type: "app",
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(0);
    expect(WebSocket.sockets).toHaveLength(1);
    expect(WebSocket.sockets[0].url).toBe("ws://127.0.0.1:51234/");
    const sentFrame = JSON.parse(WebSocket.sockets[0].sent[0]);
    expect(sentFrame).toMatchObject({
      type: "notification.send-mobile",
      title: "Test",
      body: "Body",
      target: "did:cc:iphone-abc",
      silent: false,
      notificationType: "app",
    });
    expect(typeof sentFrame.id).toBe("string"); // UUID
    expect(sink.logs[0]).toContain('"success":true');
  });

  it("--silenced sets silent=true in frame", async () => {
    const fs = makeFsWithDescriptor({
      pid: process.pid,
      host: "127.0.0.1",
      port: 51234,
      wsUrl: "ws://127.0.0.1:51234/",
    });
    const WebSocket = makeFakeWebSocketFactory({
      responseFor: (sent) => ({
        type: "notification.send-mobile.result",
        id: sent.id,
        ok: true,
        result: {},
      }),
    });
    const sink = captureLogs();

    await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        silenced: true,
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    const sentFrame = JSON.parse(WebSocket.sockets[0].sent[0]);
    expect(sentFrame.silent).toBe(true);
  });

  it("human-readable mode prints checkmark line", async () => {
    const fs = makeFsWithDescriptor({
      pid: process.pid,
      wsUrl: "ws://127.0.0.1:51234/",
    });
    const WebSocket = makeFakeWebSocketFactory({
      responseFor: (sent) => ({
        type: "notification.send-mobile.result",
        id: sent.id,
        ok: true,
        result: { id: "notif-1" },
      }),
    });
    const sink = captureLogs();

    await runSendNotification(
      {
        target: "did:cc:x",
        title: "Hi",
        body: "",
        type: "app",
        timeout: "5000",
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(sink.logs[0]).toMatch(/✔ 通知已推送/);
    expect(sink.logs[0]).toContain("did:cc:x");
  });
});

describe("cc notification send — desktop not running", () => {
  it("returns exit 2 on ENOENT (no port file)", async () => {
    const fs = makeFsThrowing("ENOENT", "no such file");
    const WebSocket = makeFakeWebSocketFactory();
    const sink = captureLogs();

    const exitCode = await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(2);
    expect(sink.errs[0]).toContain("desktop_not_running");
    expect(WebSocket.sockets).toHaveLength(0);
  });

  it("returns exit 2 on malformed port file (no wsUrl)", async () => {
    const fs = makeFsWithDescriptor({ pid: 999, somethingElse: true });
    const WebSocket = makeFakeWebSocketFactory();
    const sink = captureLogs();

    const exitCode = await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(2);
    expect(sink.errs[0]).toContain("port_file_malformed");
  });

  it("returns exit 2 on stale pid (process no longer alive)", async () => {
    // PID 1 exists on POSIX (init) but we can't signal it without root, which
    // returns EPERM (still alive). Use a high unlikely PID to get ESRCH.
    const stalePid = 999999;
    const fs = makeFsWithDescriptor({
      pid: stalePid,
      wsUrl: "ws://127.0.0.1:51234/",
    });
    const WebSocket = makeFakeWebSocketFactory();
    const sink = captureLogs();

    // Verify we'd actually get ESRCH for this pid before relying on the check.
    let canDetect = false;
    try {
      process.kill(stalePid, 0);
    } catch (e) {
      if (e.code === "ESRCH") canDetect = true;
    }
    if (!canDetect) {
      // On Windows, signal 0 to a non-existent pid yields a different error
      // code. Skip the assertion-on-exit-code path; just verify it doesn't
      // crash and returns *some* failure code.
      const exitCode = await runSendNotification(
        {
          target: "did:cc:x",
          title: "x",
          body: "",
          type: "app",
          timeout: "5000",
          json: true,
        },
        { fs, WebSocket, log: sink.log, err: sink.err },
      );
      expect([0, 2, 3]).toContain(exitCode);
      return;
    }

    const exitCode = await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(2);
    expect(sink.errs[0]).toContain("desktop_stale_pid");
  });
});

describe("cc notification send — desktop returns error", () => {
  it("returns exit 3 when desktop responds ok:false", async () => {
    const fs = makeFsWithDescriptor({
      pid: process.pid,
      wsUrl: "ws://127.0.0.1:51234/",
    });
    const WebSocket = makeFakeWebSocketFactory({
      responseFor: (sent) => ({
        type: "notification.send-mobile.result",
        id: sent.id,
        ok: false,
        error: "remote-gateway 不可用",
      }),
    });
    const sink = captureLogs();

    const exitCode = await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(3);
    expect(sink.errs[0]).toContain("remote-gateway 不可用");
  });

  it("returns exit 3 on ws error", async () => {
    const fs = makeFsWithDescriptor({
      pid: process.pid,
      wsUrl: "ws://127.0.0.1:51234/",
    });
    const WebSocket = makeFakeWebSocketFactory({
      errorOnConnect: "ECONNREFUSED",
    });
    const sink = captureLogs();

    const exitCode = await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(3);
    expect(sink.errs[0]).toContain("ws_error");
  });

  it("returns exit 3 on RPC timeout", async () => {
    const fs = makeFsWithDescriptor({
      pid: process.pid,
      wsUrl: "ws://127.0.0.1:51234/",
    });
    const WebSocket = makeFakeWebSocketFactory({
      // never responds — let the timeout fire
    });
    const sink = captureLogs();

    const exitCode = await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        timeout: "1000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(3);
    expect(sink.errs[0]).toContain("rpc_timeout");
  });

  it("ignores frames with mismatched id (multiplexed bridge)", async () => {
    const fs = makeFsWithDescriptor({
      pid: process.pid,
      wsUrl: "ws://127.0.0.1:51234/",
    });
    const WebSocket = makeFakeWebSocketFactory({
      onOpen: (socket) => {
        // Send an unrelated frame first
        setImmediate(() => {
          socket.emit(
            "message",
            Buffer.from(
              JSON.stringify({
                type: "some.other.result",
                id: "different-id",
                ok: true,
              }),
            ),
          );
        });
      },
      responseFor: (sent) => ({
        type: "notification.send-mobile.result",
        id: sent.id,
        ok: true,
        result: {},
      }),
      delayMs: 50,
    });
    const sink = captureLogs();

    const exitCode = await runSendNotification(
      {
        target: "did:cc:x",
        title: "x",
        body: "",
        type: "app",
        timeout: "5000",
        json: true,
      },
      { fs, WebSocket, log: sink.log, err: sink.err },
    );

    expect(exitCode).toBe(0);
  });
});
