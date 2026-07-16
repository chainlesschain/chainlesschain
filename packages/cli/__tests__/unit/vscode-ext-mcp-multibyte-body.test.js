/**
 * Regression: the IDE MCP server must reassemble a UTF-8 multi-byte character
 * (中文) that is split across two socket 'data' chunks. Before req.setEncoding,
 * `body += chunk` stringified each Buffer independently, so a straddling char
 * decoded to U+FFFD in both halves — an openDiff modifiedText with CJK content
 * >64KB was then written to disk corrupted on Accept.
 *
 * Drives _onRequest directly with a stream.PassThrough (which honors
 * setEncoding via a StringDecoder, exactly like a real socket) so the split is
 * deterministic.
 */
import { describe, it, expect } from "vitest";
import { PassThrough } from "stream";
import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";

function fakeRes() {
  let statusCode = null;
  let bodyStr = "";
  return {
    writeHead(code) {
      statusCode = code;
    },
    end(s) {
      bodyStr = s || "";
      this._done = true;
    },
    get status() {
      return statusCode;
    },
    get json() {
      try {
        return JSON.parse(bodyStr);
      } catch {
        return null;
      }
    },
  };
}

/** POST one JSON-RPC body, split into Buffer halves at `splitAt` bytes. */
async function postSplit(server, obj, splitAt) {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  const req = new PassThrough();
  req.method = "POST";
  req.headers = {};
  const res = fakeRes();
  const done = new Promise((resolve) => {
    const orig = res.end.bind(res);
    res.end = (s) => {
      orig(s);
      resolve();
    };
  });
  server._onRequest(req, res);
  req.write(buf.subarray(0, splitAt));
  req.write(buf.subarray(splitAt));
  req.end();
  await done;
  return res;
}

describe("IdeMcpServer — multi-byte body reassembly", () => {
  it("reassembles a CJK character split across chunk boundaries", async () => {
    // Echo tool returns its `text` argument verbatim.
    const server = new IdeMcpServer({
      tools: [
        {
          name: "echo",
          description: "echo",
          inputSchema: { type: "object" },
          handler: async (args) => String(args.text),
        },
      ],
    });

    const text = "你好世界".repeat(4); // all 3-byte CJK chars
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "echo", arguments: { text } },
    };
    const full = Buffer.from(JSON.stringify(body), "utf8");

    // Split at a byte index guaranteed to fall INSIDE a multi-byte character:
    // find the first CJK byte run and cut one byte into it.
    let cut = -1;
    for (let i = 0; i < full.length - 1; i++) {
      if (full[i] >= 0x80) {
        cut = i + 1; // mid-character
        break;
      }
    }
    expect(cut).toBeGreaterThan(0);

    const res = await postSplit(server, body, cut);
    expect(res.status).toBe(200);
    const echoed = res.json?.result?.content?.[0]?.text;
    expect(echoed).toBe(text);
    expect(echoed).not.toContain("�"); // no replacement chars
  });

  it("responds 413 exactly once when chunks keep arriving past the cap", async () => {
    const server = new IdeMcpServer({ tools: [] });
    const req = new PassThrough();
    req.method = "POST";
    req.headers = {};
    let heads = 0;
    const res = fakeRes();
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (code) => {
      heads++;
      origWriteHead(code);
    };
    const done = new Promise((resolve) => {
      const orig = res.end.bind(res);
      res.end = (s) => {
        orig(s);
        resolve();
      };
    });
    server._onRequest(req, res);
    // 5 chunks of 1MB cross the 4MB cap on the fifth; the sixth emit models a
    // chunk that was already buffered when destroy() ran — the case that used
    // to re-enter _send on the finished response and throw
    // ERR_HTTP_HEADERS_SENT uncaught inside the listener. Emitted directly so
    // stream teardown timing cannot swallow the re-entry.
    const mb = "a".repeat(1024 * 1024);
    for (let i = 0; i < 6; i++) req.emit("data", mb);
    await done;
    expect(res.status).toBe(413);
    expect(res.json).toEqual({ error: "payload too large" });
    expect(heads).toBe(1); // no double writeHead after the abort
  });
});
