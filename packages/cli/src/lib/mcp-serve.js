/**
 * `cc mcp serve` — expose cc's local file tools as an MCP server so OTHER
 * MCP clients (Claude Desktop, another cc, any Streamable-HTTP client) can
 * use this machine's workspace. Claude-Code `claude mcp serve` parity.
 *
 * Protocol: Streamable-HTTP MCP, same shape the IDE-bridge work verified
 * against the real CLI MCPClient — every request is POST JSON-RPC answered
 * with application/json (no persistent SSE GET needed): `initialize`,
 * `notifications/initialized`, `tools/list`, `tools/call`; tool failures are
 * `isError` results, transport failures JSON-RPC errors.
 *
 * Security: tools are CONFINED to the serve root (path resolves inside root
 * or the call fails), Bearer-token auth is on by default (random token,
 * printed once), `--read-only` drops write_file. Zero npm deps (node http).
 */

import http from "http";
import fsDefault from "fs";
import pathDefault from "path";
import { randomBytes, timingSafeEqual } from "crypto";

export const MAX_READ_BYTES = 200 * 1024;
export const MAX_LIST_ENTRIES = 500;
export const MAX_SEARCH_RESULTS = 200;
export const MAX_SEARCH_ENTRIES = 50_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

export const _deps = { fs: fsDefault, path: pathDefault };

/** Resolve `rel` inside `root`; throws on escape (.. traversal, abs paths out). */
export function confine(root, rel, deps = _deps) {
  const { path } = deps;
  const fs = deps.fs;
  const normRoot = path.resolve(root);
  const abs = path.resolve(normRoot, rel || ".");
  // Fast string guard: blocks `..` traversal and absolute-path escapes.
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`path escapes serve root: ${rel}`);
  }
  // Symlink guard: path.resolve does NOT follow symlinks, so a symlink INSIDE
  // root pointing OUTSIDE would pass the string check yet the fs op (read/write/
  // list) would escape the serve boundary — e.g. reading ~/.ssh through a
  // workspace symlink, defeating a `--read-only` exposure. Resolve the real path
  // of the deepest EXISTING ancestor (a not-yet-created file can't be a symlink)
  // and re-check containment against the real root.
  if (fs && typeof fs.realpathSync === "function") {
    let realRoot;
    try {
      realRoot = fs.realpathSync(normRoot);
    } catch {
      return abs; // root itself unresolvable → the string guard is all we have
    }
    let probe = abs;
    for (;;) {
      let real;
      try {
        real = fs.realpathSync(probe);
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) break; // reached fs root, nothing existed
        probe = parent;
        continue;
      }
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new Error(`path escapes serve root (symlink): ${rel}`);
      }
      break;
    }
  }
  return abs;
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against the
 * expected token. A plain `!==` leaks timing that could let a caller recover the
 * token byte-by-byte; hash-length differs are rejected up front (the token is a
 * fixed-length random value, so its length is not secret), then `timingSafeEqual`
 * compares the bytes. Mirrors the ws-server's token check.
 */
export function bearerMatches(authHeader, token) {
  const prefix = "Bearer ";
  if (typeof authHeader !== "string" || !authHeader.startsWith(prefix)) {
    return false;
  }
  const a = Buffer.from(authHeader.slice(prefix.length), "utf-8");
  const b = Buffer.from(String(token), "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function ok(text) {
  return { content: [{ type: "text", text: String(text) }] };
}
function fail(message) {
  return { content: [{ type: "text", text: String(message) }], isError: true };
}

/** Build the tool table (name → {description, inputSchema, handler}). */
export function buildTools({ root, readOnly = false, deps = _deps }) {
  const fs = deps.fs;
  const tools = {
    read_file: {
      description: `Read a UTF-8 file under the serve root (${MAX_READ_BYTES} byte cap)`,
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      handler: ({ path: rel }) => {
        const abs = confine(root, rel, deps);
        const buf = fs.readFileSync(abs);
        const truncated = buf.length > MAX_READ_BYTES;
        const text = (truncated ? buf.slice(0, MAX_READ_BYTES) : buf).toString(
          "utf-8",
        );
        return ok(
          truncated ? `${text}\n… [truncated ${buf.length} bytes]` : text,
        );
      },
    },
    list_dir: {
      description:
        "List a directory under the serve root (dirs get trailing /)",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
      },
      handler: ({ path: rel } = {}) => {
        const abs = confine(root, rel || ".", deps);
        const entries = fs
          .readdirSync(abs, { withFileTypes: true })
          .slice(0, MAX_LIST_ENTRIES)
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return ok(entries.join("\n"));
      },
    },
    search_files: {
      description:
        "Find files under the serve root whose RELATIVE PATH contains the query (case-insensitive, bounded walk)",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          dir: { type: "string" },
        },
        required: ["query"],
      },
      handler: ({ query, dir } = {}) => {
        const base = confine(root, dir || ".", deps);
        const q = String(query).toLowerCase();
        const hits = [];
        let seen = 0;
        const walk = (d) => {
          if (hits.length >= MAX_SEARCH_RESULTS || seen >= MAX_SEARCH_ENTRIES)
            return;
          let list;
          try {
            list = fs.readdirSync(d, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of list) {
            if (
              hits.length >= MAX_SEARCH_RESULTS ||
              ++seen >= MAX_SEARCH_ENTRIES
            )
              return;
            const abs = deps.path.join(d, e.name);
            if (e.isDirectory()) {
              if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(abs);
            } else {
              const rel = deps.path.relative(root, abs).replace(/\\/g, "/");
              if (rel.toLowerCase().includes(q)) hits.push(rel);
            }
          }
        };
        walk(base);
        return ok(hits.join("\n") || "(no matches)");
      },
    },
  };
  if (!readOnly) {
    tools.write_file = {
      description:
        "Write a UTF-8 file under the serve root (creates parent dirs)",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      handler: ({ path: rel, content }) => {
        const abs = confine(root, rel, deps);
        fs.mkdirSync(deps.path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(content), "utf-8");
        return ok(
          `wrote ${Buffer.byteLength(String(content))} bytes to ${rel}`,
        );
      },
    };
  }
  return tools;
}

function rpcResult(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function rpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * Start the server. Returns { server, port, token, url, close() }.
 *
 * @param {object} opts { root, port=0, token (null → random, false → no auth),
 *                        readOnly, deps }
 */
export function startMcpServe(opts = {}) {
  const deps = { ..._deps, ...(opts.deps || {}) };
  const root = deps.path.resolve(opts.root || process.cwd());
  const readOnly = Boolean(opts.readOnly);
  const token =
    opts.token === false ? null : opts.token || randomBytes(16).toString("hex");
  const tools = buildTools({ root, readOnly, deps });

  // Guardrails for the request-collection phase: a JSON-RPC request is small,
  // so cap the body and bound how long we wait for it. Without these a large
  // body grows `raw` unbounded (memory) and a stalled client holds the socket
  // forever (req.on("end") never fires). Both overridable for tests / tuning.
  const maxRequestBytes = Number.isFinite(opts.maxRequestBytes)
    ? opts.maxRequestBytes
    : 1024 * 1024; // 1 MB
  const requestTimeoutMs = Number.isFinite(opts.requestTimeoutMs)
    ? opts.requestTimeoutMs
    : 30000;

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    };
    if (req.method !== "POST") {
      return send(405, rpcError(null, -32600, "POST only"));
    }
    if (token) {
      if (!bearerMatches(req.headers.authorization, token)) {
        return send(401, rpcError(null, -32001, "unauthorized"));
      }
    }
    let raw = "";
    let bytes = 0;
    let aborted = false;
    const collectTimer = setTimeout(() => {
      if (aborted) return;
      aborted = true;
      try {
        send(408, rpcError(null, -32001, "request timeout"));
      } catch {
        /* socket already gone */
      }
      req.destroy();
    }, requestTimeoutMs);
    req.on("error", () => {
      if (aborted) return;
      aborted = true;
      clearTimeout(collectTimer);
      // Request stream errored (client reset/dropped): no response is
      // deliverable on a broken socket — just stop, don't crash the process.
      try {
        if (!res.writableEnded) res.destroy();
      } catch {
        /* ignore */
      }
    });
    req.on("data", (c) => {
      if (aborted) return;
      bytes += c.length;
      if (bytes > maxRequestBytes) {
        aborted = true;
        clearTimeout(collectTimer);
        try {
          send(413, rpcError(null, -32600, "request too large"));
        } catch {
          /* socket already gone */
        }
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on("end", () => {
      if (aborted) return;
      clearTimeout(collectTimer);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return send(400, rpcError(null, -32700, "parse error"));
      }
      const { id, method, params } = msg || {};
      try {
        if (method === "initialize") {
          return send(
            200,
            rpcResult(id, {
              protocolVersion: params?.protocolVersion || "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "cc-mcp-serve", version: "1.0.0" },
            }),
          );
        }
        if (method === "notifications/initialized") {
          res.writeHead(202);
          return res.end();
        }
        if (method === "tools/list") {
          return send(
            200,
            rpcResult(id, {
              tools: Object.entries(tools).map(([name, t]) => ({
                name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            }),
          );
        }
        if (method === "tools/call") {
          const tool = tools[params?.name];
          if (!tool) {
            return send(
              200,
              rpcResult(id, fail(`unknown tool: ${params?.name}`)),
            );
          }
          let result;
          try {
            result = tool.handler(params?.arguments || {});
          } catch (err) {
            result = fail(err.message);
          }
          return send(200, rpcResult(id, result));
        }
        return send(200, rpcError(id, -32601, `method not found: ${method}`));
      } catch (err) {
        return send(500, rpcError(id, -32603, err.message));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port || 0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        token,
        root,
        readOnly,
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
