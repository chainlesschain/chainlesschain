// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/mock/userData") },
}));

const { WhisperClient, _deps } = await import("../whisper-client");

function createDependencies() {
  return {
    fs: {
      existsSync: vi.fn().mockReturnValue(true),
      accessSync: vi.fn(),
      statSync: vi.fn().mockReturnValue({ size: 142000000 }),
      mkdirSync: vi.fn(),
      createReadStream: vi.fn(),
    },
    spawn: vi.fn(),
    getAxios: vi.fn(() => ({ post: vi.fn() })),
  };
}

describe("WhisperClient governed multimodal ingress", () => {
  let deps;
  let client;

  beforeEach(() => {
    deps = createDependencies();
    _deps.fs = deps.fs;
    _deps.spawn = deps.spawn;
    _deps.getAxios = deps.getAxios;
    _deps.uuidv4 = vi.fn(() => "stream-id");
    client = new WhisperClient({ apiKey: "private-key" });
  });

  it("retains configuration and non-model management helpers", async () => {
    expect(client.mode).toBe("local");
    expect(client._parseTimestamp("00:01:30.500")).toBe(90.5);
    expect(
      client._parseWhisperOutput(JSON.stringify({ text: "parsed" })).text,
    ).toBe("parsed");
    expect(client._getModelPath("tiny")).toContain("ggml-tiny.bin");
    expect((await client.listModels()).map((model) => model.size)).toHaveLength(
      5,
    );
  });

  it.each([
    ["public transcription", (instance) => instance.transcribe("/private.wav")],
    [
      "local transcription helper",
      (instance) => instance._transcribeLocal("/private.wav"),
    ],
    [
      "API transcription helper",
      (instance) => instance._transcribeAPI("/private.wav"),
    ],
    ["live transcription", (instance) => instance.startStream()],
    [
      "voice-chat pipeline",
      (instance) =>
        instance.voiceChat(
          "/private.wav",
          { chatWithMessages: vi.fn() },
          { synthesize: vi.fn() },
        ),
    ],
  ])(
    "rejects %s before touching audio or a provider",
    async (_name, invoke) => {
      await expect(invoke(client)).rejects.toMatchObject({
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      });

      expect(deps.fs.existsSync).not.toHaveBeenCalled();
      expect(deps.fs.createReadStream).not.toHaveBeenCalled();
      expect(deps.spawn).not.toHaveBeenCalled();
      expect(deps.getAxios).not.toHaveBeenCalled();
    },
  );

  it("does not mutate stream state when live transcription is denied", async () => {
    await expect(client.startStream()).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
    expect(client.activeStreams.size).toBe(0);
    expect(client.getStats().totalTranscriptions).toBe(0);
  });

  it("keeps stream teardown safe without starting a transcription", async () => {
    await expect(client.stopStream("missing")).rejects.toThrow(
      "Stream not found",
    );
    await client.terminate();
    expect(client.activeStreams.size).toBe(0);
  });
});
