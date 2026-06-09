// Cross-language interop probe: drive the JetBrains-side Java MCP server with
// the real CLI MCP client. Usage: node interop-smoke.mjs <port> <token>
import { MCPClient } from "../cli/src/harness/mcp-client.js";

const [port, token] = process.argv.slice(2);
const url = `http://127.0.0.1:${port}/mcp`;
const client = new MCPClient();

const r = await client.connect("ide", {
  url,
  transport: "http",
  headers: { Authorization: `Bearer ${token}` },
});
const names = r.tools.map((t) => t.name).sort();
console.log("TOOLS=" + JSON.stringify(names));

const sel = await client.callTool("ide", "getSelection", {});
console.log("SELECTION=" + sel.content[0].text);

const diff = await client.callTool("ide", "openDiff", {
  path: "/abs/ws/A.java",
  modifiedText: "bar()",
});
console.log("OPENDIFF=" + diff.content[0].text);

// wrong-token must be rejected
let authRejected = false;
try {
  await new MCPClient().connect("bad", {
    url,
    transport: "http",
    headers: { Authorization: "Bearer WRONG" },
  });
} catch {
  authRejected = true;
}
console.log("AUTH_REJECTED=" + authRejected);

await client.disconnectAll();
console.log("DONE");
