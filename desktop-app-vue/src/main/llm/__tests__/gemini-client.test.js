import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { GeminiClient } = require("../gemini-client");

describe("GeminiClient", () => {
  let client;

  beforeEach(() => {
    client = new GeminiClient({
      apiKey: "test-api-key",
      model: "gemini-1.5-pro",
    });
  });

  describe("constructor", () => {
    it("should set default values", () => {
      const c = new GeminiClient({});
      expect(c.model).toBe("gemini-1.5-pro");
      expect(c.embeddingModel).toBe("text-embedding-004");
      expect(c.baseURL).toBe(
        "https://generativelanguage.googleapis.com/v1beta",
      );
    });

    it("should accept custom config", () => {
      const c = new GeminiClient({
        apiKey: "key",
        model: "gemini-2.0-flash",
        baseURL: "https://custom.api",
      });
      expect(c.apiKey).toBe("key");
      expect(c.model).toBe("gemini-2.0-flash");
      expect(c.baseURL).toBe("https://custom.api");
    });
  });

  describe("_convertMessages", () => {
    it("should convert system messages to systemInstruction", () => {
      const messages = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ];
      const result = client._convertMessages(messages);
      expect(result.systemInstruction).toEqual({
        parts: [{ text: "You are helpful." }],
      });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe("user");
    });

    it("should merge multiple system messages", () => {
      const messages = [
        { role: "system", content: "First instruction." },
        { role: "system", content: "Second instruction." },
        { role: "user", content: "Hi" },
      ];
      const result = client._convertMessages(messages);
      expect(result.systemInstruction.parts).toHaveLength(2);
    });

    it("should map assistant to model role", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const result = client._convertMessages(messages);
      expect(result.contents[1].role).toBe("model");
    });

    it("should add empty user message if no contents", () => {
      const messages = [{ role: "system", content: "System only" }];
      const result = client._convertMessages(messages);
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe("user");
    });

    it("converts provider-neutral images to Gemini inlineData", () => {
      const data = Buffer.from("private-image").toString("base64");
      const result = client._convertMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "inspect" },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${data}` },
            },
          ],
        },
      ]);

      expect(result.contents[0].parts).toEqual([
        { text: "inspect" },
        { inlineData: { mimeType: "image/jpeg", data } },
      ]);
    });

    it("rejects remote or malformed Gemini vision input", () => {
      expect(() =>
        client._convertMessages([
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://example.test/private.png" },
              },
            ],
          },
        ]),
      ).toThrow(/supported base64 data URL/u);
    });

    it("projects provider-neutral bytes before Gemini wire conversion", async () => {
      const ingress = require("../../evolution/desktop-model-ingress");
      const data = Buffer.from("private-image").toString("base64");
      const messages = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${data}` },
            },
            { type: "text", text: "private prompt" },
          ],
        },
      ];
      const projected = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${data}` },
            },
            { type: "text", text: "redacted prompt" },
          ],
        },
      ];
      const prepare = vi
        .spyOn(ingress, "prepareDesktopModelRequest")
        .mockResolvedValue({ body: { messages: projected } });

      const prepared = await client._prepareChatRequest(messages, {
        max_tokens: 64,
      });

      expect(prepare).toHaveBeenCalledWith(client, { messages });
      expect(prepared.body.contents[0].parts).toEqual([
        { inlineData: { mimeType: "image/jpeg", data } },
        { text: "redacted prompt" },
      ]);
      expect(JSON.stringify(prepare.mock.calls[0][1])).toContain(
        "private prompt",
      );
      expect(JSON.stringify(prepared.body)).not.toContain("private prompt");
      prepare.mockRestore();
    });
  });

  describe("_extractError", () => {
    it("should extract error from response data", () => {
      const error = {
        response: { data: { error: { message: "Invalid API key" } } },
        message: "Request failed",
      };
      expect(client._extractError(error)).toBe("Invalid API key");
    });

    it("should fallback to error.message", () => {
      const error = { message: "Network error" };
      expect(client._extractError(error)).toBe("Network error");
    });
  });
});
