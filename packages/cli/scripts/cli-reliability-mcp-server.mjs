#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const CALL_LOG = process.env.CC_CLI_RELIABILITY_MCP_CALL_LOG || null;
const CANARY = "CC_RELIABILITY_MCP_PRIVATE_CANARY";
const RESULT_BYTES = 1536 * 1024;

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  );
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id == null) return;
  switch (request.method) {
    case "initialize":
      send(request.id, {
        protocolVersion: request.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cli-reliability-output", version: "1.0.0" },
      });
      break;
    case "tools/list":
      send(request.id, {
        tools: [
          {
            name: "oversized_output",
            description: "Return a deterministic oversized reliability result.",
            inputSchema: { type: "object", additionalProperties: false },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
        ],
      });
      break;
    case "resources/list":
      send(request.id, { resources: [] });
      break;
    case "resources/templates/list":
      send(request.id, { resourceTemplates: [] });
      break;
    case "prompts/list":
      send(request.id, { prompts: [] });
      break;
    case "tools/call":
      if (request.params?.name !== "oversized_output") {
        sendError(request.id, -32602, "Invalid tool");
        break;
      }
      if (CALL_LOG) {
        appendFileSync(
          CALL_LOG,
          `${JSON.stringify({
            called: true,
            resultBytes: RESULT_BYTES,
            serverPid: process.pid,
          })}\n`,
          "utf8",
        );
      }
      send(request.id, {
        content: [
          {
            type: "text",
            text: CANARY.repeat(Math.ceil(RESULT_BYTES / CANARY.length)),
          },
        ],
      });
      break;
    default:
      sendError(request.id, -32601, "Method not found");
  }
});
