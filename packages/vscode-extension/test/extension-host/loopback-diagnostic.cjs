"use strict";

const fs = require("node:fs");
const net = require("node:net");

// This probe deliberately has no VS Code or extension dependency. Running it
// with the exact host executable in ELECTRON_RUN_AS_NODE mode separates an
// executable-level network failure from extension activation and proxy hooks.
async function probeLoopback({ host, timeoutMs = 1500 } = {}) {
  if (!["127.0.0.1", "::1"].includes(host))
    throw new TypeError("Only loopback addresses may be probed");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError("Invalid loopback deadline");
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.end();
  });
  let client;
  let timer;
  const result = { host, listening: false, connected: false, errorCode: null };
  try {
    await new Promise((resolve) => {
      let settled = false;
      const finish = (errorCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        result.errorCode = errorCode;
        resolve();
      };
      timer = setTimeout(() => finish("PROBE_TIMEOUT"), timeoutMs);
      server.on("error", (error) => finish(error.code || "LISTEN_ERROR"));
      server.listen(0, host, () => {
        if (settled) return;
        result.listening = true;
        client = new net.Socket();
        client.once("error", (error) => finish(error.code || "CONNECT_ERROR"));
        client.once("connect", () => {
          result.connected = true;
          finish(null);
        });
        client.connect(server.address().port, host);
      });
    });
  } finally {
    clearTimeout(timer);
    client?.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
  return result;
}

async function collectLoopbackDiagnostic() {
  const cases = [];
  for (const host of ["127.0.0.1", "::1"])
    cases.push(await probeLoopback({ host }));
  return {
    schema: "chainlesschain.host-loopback-diagnostic/v1",
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron || null,
    platform: process.platform,
    architecture: process.arch,
    extensionLoaded: false,
    cases,
  };
}

module.exports = { probeLoopback, collectLoopbackDiagnostic };

if (require.main === module) {
  collectLoopbackDiagnostic().then(
    (receipt) => {
      const text = `${JSON.stringify(receipt, null, 2)}\n`;
      // No environment, process arguments, paths, credentials or port tokens
      // enter the receipt. The parent archives it with the failed journey.
      if (process.argv[2])
        fs.writeFileSync(process.argv[2], text, { flag: "wx", mode: 0o600 });
      else process.stdout.write(text);
    },
    () => {
      process.exitCode = 1;
    },
  );
}
