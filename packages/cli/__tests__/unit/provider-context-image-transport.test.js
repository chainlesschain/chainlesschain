import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import { messagesToContextItems } from "../../src/lib/context-memory-kernel/message-adapter.js";
import {
  captureContextImageTransport,
  restoreContextImageTransport,
} from "../../src/lib/context-memory-kernel/context-image-transport.js";

const CONTEXT_ENV = {
  CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
};
const WINDOW = 65_536;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_value, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cc-provider-image-transport-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunkBody = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(chunkBody));
  return Buffer.concat([length, chunkBody, checksum]);
}

function pngDataUrl(textBytes = 32) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const text = Buffer.concat([
    Buffer.from("Comment\0", "ascii"),
    Buffer.alloc(textBytes, 0x41),
  ]);
  const pixels = deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("tEXt", text),
    pngChunk("IDAT", pixels),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function imageMessage(url, detail = "auto") {
  return {
    role: "user",
    content: [
      { type: "text", text: "Describe the image." },
      { type: "image_url", image_url: { url, detail } },
    ],
  };
}

function options(sessionId) {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    sessionId,
    contextMemoryEnv: CONTEXT_ENV,
    contextMemoryFilePath: join(directory, "memory", `${sessionId}.json`),
    contextMemoryModelWindowTokens: WINDOW,
    contextMemorySkipPlanning: false,
    contextMemorySelectedToolNames: [],
  };
}

describe("canonical provider context image transport", () => {
  it("allows ordinary captions and code discussion to mention image transport markers", async () => {
    const text =
      "Explain cc-context-image://v1/ and the cc-context-image marker.";
    const plain = await prepareCanonicalProviderContext(
      [{ role: "user", content: text }],
      options("provider-image-marker-discussion"),
    );
    expect(plain.messages).toEqual([{ role: "user", content: text }]);
    const message = imageMessage(pngDataUrl());
    message.content[0].text = text;
    const image = await prepareCanonicalProviderContext(
      [message],
      options("provider-image-marker-caption"),
    );
    expect(image.messages).toEqual([message]);
  });

  it("plans a valid 5 MiB PNG by digest and restores the complete user image block", async () => {
    const url = pngDataUrl(5 * 1024 * 1024);
    const message = imageMessage(url, "high");
    const before = structuredClone(message);
    const prepared = await prepareCanonicalProviderContext(
      [message],
      options("provider-image-transport-large"),
    );

    expect(Buffer.byteLength(url, "utf8")).toBeGreaterThan(4 * 1024 * 1024);
    expect(prepared.plan).not.toBeNull();
    expect(JSON.stringify(prepared.plan.selected)).not.toContain(url);
    expect(
      prepared.plan.selected.find((item) => item.kind === "task-state").content
        .length,
    ).toBeLessThan(4 * 1024 * 1024);
    expect(prepared.messages).toEqual([before]);
    expect(prepared.messages[0].content[0]).toEqual({
      type: "text",
      text: "Describe the image.",
    });
    expect(prepared.messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url, detail: "high" },
    });
    expect(message).toEqual(before);
  });

  it("retains the separate low and standard reserves for multiple images", async () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these images." },
          {
            type: "image_url",
            image_url: { url: pngDataUrl(20), detail: "low" },
          },
          {
            type: "image_url",
            image_url: { url: pngDataUrl(40), detail: "high" },
          },
        ],
      },
    ];
    const sessionId = "provider-image-transport-multiple";
    const expected = messagesToContextItems(messages, { sessionId })[0];
    const prepared = await prepareCanonicalProviderContext(
      messages,
      options(sessionId),
    );
    const selected = prepared.plan.selected.find(
      (item) => item.kind === "task-state",
    );

    expect(selected.tokenEstimate).toBe(expected.tokenEstimate);
    expect(selected.tokenEstimate).toBeGreaterThanOrEqual(1024 + 8192);
    expect(JSON.stringify(selected)).not.toContain("data:image/png;base64,");
    expect(prepared.messages).toEqual(messages);
  });

  it("rejects forged and tampered transport placeholders", async () => {
    const forged =
      "cc-context-image://v1/" + "a".repeat(32) + "/sha256-" + "0".repeat(64);
    await expect(
      prepareCanonicalProviderContext(
        [imageMessage(forged)],
        options("provider-image-transport-forged"),
      ),
    ).rejects.toMatchObject({ code: "CC_CONTEXT_IMAGE_TRANSPORT_INVALID" });

    const captured = captureContextImageTransport([imageMessage(pngDataUrl())]);
    const tampered = structuredClone(captured.messages);
    tampered[0].content[1].image_url.url =
      tampered[0].content[1].image_url.url.replace(
        /sha256-[a-f0-9]{64}$/u,
        `sha256-${"f".repeat(64)}`,
      );
    expect(() =>
      restoreContextImageTransport(tampered, captured.captures),
    ).toThrowError(
      expect.objectContaining({ code: "CC_CONTEXT_IMAGE_TRANSPORT_INVALID" }),
    );
    const changedDetail = structuredClone(captured.messages);
    changedDetail[0].content[1].image_url.detail = "high";
    expect(() =>
      restoreContextImageTransport(changedDetail, captured.captures),
    ).toThrowError(
      expect.objectContaining({ code: "CC_CONTEXT_IMAGE_TRANSPORT_INVALID" }),
    );
    const removedDetail = structuredClone(captured.messages);
    delete removedDetail[0].content[1].image_url.detail;
    expect(() =>
      restoreContextImageTransport(removedDetail, captured.captures),
    ).toThrowError(
      expect.objectContaining({ code: "CC_CONTEXT_IMAGE_TRANSPORT_INVALID" }),
    );
    const leaked = structuredClone(captured.messages);
    leaked[0].content[0].text = leaked[0].content[1].image_url.url;
    expect(() =>
      restoreContextImageTransport(leaked, captured.captures),
    ).toThrowError(
      expect.objectContaining({ code: "CC_CONTEXT_IMAGE_TRANSPORT_INVALID" }),
    );
  });

  it("keeps the no-image plan and provider messages unchanged", async () => {
    const messages = [{ role: "user", content: "Say hello." }];
    const sessionId = "provider-image-transport-no-image";
    const expectedItem = messagesToContextItems(messages, { sessionId })[0];
    const prepared = await prepareCanonicalProviderContext(
      messages,
      options(sessionId),
    );

    expect(prepared.messages).toEqual(messages);
    expect(
      prepared.plan.selected.find((item) => item.itemId === expectedItem.itemId)
        .content,
    ).toBe(expectedItem.content);
  });
});
