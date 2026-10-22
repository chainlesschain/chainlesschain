import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IMAGE_TOKEN_RESERVE,
  LOW_DETAIL_IMAGE_TOKEN_RESERVE,
  imageTransportEstimate,
} from "../../src/lib/image-token-estimate.js";
import {
  AUTO_COMPACT_TEXT_BYTES,
  estimateMessagesTextBytes,
  estimateMessagesTokens,
  PromptCompressor,
} from "../../src/harness/prompt-compressor.js";
import { messagesToContextItems } from "../../src/lib/context-memory-kernel/message-adapter.js";
import { compactLiveMessagesCanonical } from "../../src/lib/context-memory-kernel/live-compaction.js";

function message(bytes, detail = "auto") {
  return {
    role: "user",
    content: [
      { type: "text", text: "Inspect the attached screenshot" },
      {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${Buffer.alloc(bytes).toString("base64")}`,
          detail,
        },
      },
    ],
  };
}

describe("image context token estimates", () => {
  it.each([false, true])(
    "uses the text pressure target in actual canonical compaction (old images: %s)",
    async (oldImages) => {
      const directory = mkdtempSync(join(tmpdir(), "cc-text-pressure-"));
      try {
        const messages = [
          ...(oldImages ? Array.from({ length: 100 }, () => message(3)) : []),
          ...Array.from({ length: 18 }, (_, index) => ({
            role: oldImages ? "user" : "assistant",
            content: `${index}:` + "x".repeat(45000),
          })),
          { role: "user", content: "Continue the current task" },
        ];
        const compressor = new PromptCompressor({
          maxTokens: 2_000_000,
          maxMessages: 1000,
        });
        let summarized = 0;
        compressor.compress = async (dropped) => {
          summarized += dropped.length;
          return {
            messages: [
              {
                role: "assistant",
                content: "Retained findings from old output",
              },
            ],
            stats: { strategy: "semantic", saved: 1000, degraded: false },
          };
        };
        let committed = 0;
        const result = await compactLiveMessagesCanonical(messages, {
          compressor,
          persist: false,
          sessionId: "text-pressure",
          operationId: "text-pressure-compact",
          env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" },
          memoryFilePath: join(directory, "memory.json"),
          commit: async () => {
            committed++;
            return { ok: true };
          },
        });
        expect(result.receipt.status).toBe("committed");
        expect(committed).toBe(1);
        expect(summarized).toBeGreaterThan(0);
        expect(estimateMessagesTextBytes(result.messages)).toBeLessThan(
          AUTO_COMPACT_TEXT_BYTES,
        );
        expect(result.messages.at(-1).content).toBe(
          "Continue the current task",
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("compacts on bounded text pressure even when the model token window is large", () => {
    const compressor = new PromptCompressor({
      maxTokens: 1_000_000,
      maxMessages: 1000,
    });
    const messages = Array.from({ length: 18 }, (_, index) => ({
      role: "assistant",
      content: `${index}:` + "x".repeat(45000),
    }));
    expect(estimateMessagesTextBytes(messages)).toBeGreaterThan(
      AUTO_COMPACT_TEXT_BYTES,
    );
    expect(estimateMessagesTokens(messages)).toBeLessThan(compressor.maxTokens);
    expect(compressor.shouldAutoCompact(messages)).toBe(true);
    expect(compressor.getCompactionTokenBudget(messages)).toBeLessThan(
      estimateMessagesTokens(messages),
    );
    const images = [message(2 * 1024 * 1024)];
    expect(estimateMessagesTextBytes(images)).toBeLessThan(1024);
    expect(compressor.shouldAutoCompact(images)).toBe(false);
    expect(compressor.getCompactionTokenBudget(images)).toBe(
      compressor.maxTokens,
    );
  });
  it("accounts for image count and detail separately from transport size", () => {
    const small = message(300);
    const large = message(2 * 1024 * 1024);
    expect(estimateMessagesTokens([large])).toBe(
      estimateMessagesTokens([small]),
    );
    expect(estimateMessagesTokens([large])).toBeGreaterThanOrEqual(
      IMAGE_TOKEN_RESERVE,
    );
    expect(estimateMessagesTokens([large, large])).toBe(
      estimateMessagesTokens([large]) * 2,
    );
    expect(imageTransportEstimate([message(300, "low")]).tokens).toBe(
      LOW_DETAIL_IMAGE_TOKEN_RESERVE,
    );
    expect(imageTransportEstimate([large]).bytes).toBe(
      large.content[1].image_url.url.length,
    );
  });

  it("preserves captions, protocol metadata and the original image in context plans", () => {
    const large = message(2 * 1024 * 1024);
    const original = JSON.stringify(large);
    const smallItem = messagesToContextItems([message(300)], {
      sessionId: "image-estimate",
    })[0];
    const largeItem = messagesToContextItems([large], {
      sessionId: "image-estimate",
    })[0];
    expect(largeItem.tokenEstimate).toBe(smallItem.tokenEstimate);
    expect(largeItem.tokenEstimate).toBeGreaterThanOrEqual(IMAGE_TOKEN_RESERVE);
    expect(JSON.parse(largeItem.content).messages[0]).toEqual(large);
    expect(JSON.stringify(large)).toBe(original);
    const captioned = structuredClone(large);
    captioned.content[0].text += " More caption text".repeat(100);
    expect(estimateMessagesTokens([captioned])).toBeGreaterThan(
      estimateMessagesTokens([large]),
    );
  });

  it("keeps arbitrary text, remote URLs and malformed image shapes in the text estimate", () => {
    for (const data of ["YR==", "YQ=", "YQ===", "YQ", ""]) {
      const malformed = message(3);
      malformed.content[1].image_url.url = `data:image/png;base64,${data}`;
      expect(imageTransportEstimate([malformed])).toEqual({
        bytes: 0,
        tokens: 0,
      });
    }
    const invalid = message(300);
    invalid.content[1].image_url.url =
      "data:image/png;base64,not base64 " + "x".repeat(40000);
    expect(imageTransportEstimate([invalid])).toEqual({ bytes: 0, tokens: 0 });
    expect(estimateMessagesTokens([invalid])).toBeGreaterThan(10000);
    const remote = message(300);
    remote.content[1].image_url.url = "https://example.com/image.png";
    expect(imageTransportEstimate([remote])).toEqual({ bytes: 0, tokens: 0 });
    const extra = message(300);
    extra.content[1].hidden = "x".repeat(40000);
    expect(imageTransportEstimate([extra])).toEqual({ bytes: 0, tokens: 0 });
    expect(
      imageTransportEstimate([
        { role: "assistant", content: message(300).content },
      ]),
    ).toEqual({ bytes: 0, tokens: 0 });
    expect(
      imageTransportEstimate([
        { role: "user", content: "data:image/png;base64," + "A".repeat(40000) },
      ]),
    ).toEqual({ bytes: 0, tokens: 0 });
  });
});
