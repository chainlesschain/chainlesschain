import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { VolcengineToolsClient, _deps } = require("../volcengine-tools");

const originalFetch = _deps.fetch;

describe("Volcengine tools privacy", () => {
  afterEach(() => {
    _deps.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not read or return an HTTP failure body", async () => {
    const secret = "private-service-body-with-key-and-prompt";
    const text = vi.fn(async () => secret);
    _deps.fetch = vi.fn(async () => ({ ok: false, status: 500, text }));
    const client = new VolcengineToolsClient({
      apiKey: "private-api-key",
      baseURL: "https://private-tenant.example.test",
    });

    let received;
    try {
      await client._callAPI("/private-tool-endpoint", { messages: [] });
    } catch (error) {
      received = error;
    }

    expect(text).not.toHaveBeenCalled();
    expect(received).toMatchObject({
      message: "LLM provider operation failed",
      code: "CC_LLM_PROVIDER_OPERATION_FAILED",
      provider: "volcengine",
      operation: "chat",
    });
    expect(JSON.stringify(received)).not.toContain(secret);
  });

  it("returns a fixed tool failure to the model loop", async () => {
    const secret = "private-tool-stack-and-result";
    const client = new VolcengineToolsClient({ apiKey: "private-api-key" });
    client.chatWithFunctionCalling = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call-1",
                  function: {
                    name: "private-tool",
                    arguments: secret,
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "complete" } }],
        model: "private-model",
      });

    const result = await client._executeFunctionCalling(
      [{ role: "user", content: "private-prompt" }],
      [],
      {
        execute: vi.fn(),
      },
      {},
    );

    const toolMessage = result.messages.find(
      (message) => message.role === "tool",
    );
    expect(JSON.parse(toolMessage.content)).toEqual({
      error: "Tool execution failed",
      code: "CC_LLM_TOOL_EXECUTION_FAILED",
    });
    expect(JSON.stringify(toolMessage)).not.toContain(secret);
  });

  it("returns configuration receipts without endpoint or model values", () => {
    const client = new VolcengineToolsClient({
      apiKey: "private-api-key",
      baseURL: "https://private-tenant.example.test",
      model: "private-model",
      timeout: 1234,
    });

    expect(client.getConfig()).toEqual({
      endpointConfigured: true,
      modelConfigured: true,
      timeout: 1234,
      hasApiKey: true,
    });
  });

  it("prevents direct logging and service-body propagation", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "volcengine-tools.js"),
      "utf8",
    );

    expect(source).not.toMatch(/utils\/logger\.js/u);
    expect(source).not.toMatch(
      /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
    );
    expect(source).not.toMatch(/console\.(?:debug|info|warn|error|log)\s*\(/u);
    expect(source).not.toMatch(/\berror\.message\b/u);
    expect(source).not.toMatch(/response\.text\s*\(/u);
  });
});
