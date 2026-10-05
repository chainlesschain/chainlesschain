// Test host only: unmodified, pinned Everything server + official SDK transport.
// The listener is loopback-only; no provider or account credentials are used.
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const meta = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(meta.name, "@modelcontextprotocol/server-everything");
assert.equal(meta.version, "2026.8.31");
const require = createRequire(join(root, "package.json"));
const transportPath =
  require.resolve("@modelcontextprotocol/sdk/server/streamableHttp.js");
const sdk = JSON.parse(
  readFileSync(join(dirname(transportPath), "../../../package.json"), "utf8"),
);
assert.equal(sdk.version, "1.32.0");
const { StreamableHTTPServerTransport } = await import(
  pathToFileURL(transportPath)
);
const { createServer } = await import(
  pathToFileURL(join(root, "dist/server/index.js"))
);
const sessions = new Map();
const listener = http.createServer(async (req, res) => {
  try {
    let entry = sessions.get(req.headers["mcp-session-id"]);
    if (!entry && req.method === "POST" && !req.headers["mcp-session-id"]) {
      const upstream = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => sessions.set(id, entry),
      });
      entry = { ...upstream, transport };
      await upstream.server.connect(transport);
    }
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    await entry.transport.handleRequest(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
listener.listen(0, "127.0.0.1", () =>
  process.send({ port: listener.address().port, sdkVersion: sdk.version }),
);
process.on("disconnect", async () => {
  for (const [id, entry] of sessions) {
    entry.cleanup(id);
    await entry.server.close();
  }
  listener.closeAllConnections();
  listener.close(() => process.exit(0));
});
