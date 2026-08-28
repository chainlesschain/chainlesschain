import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestProcessContext } from "./helpers/bundled-skill-process.js";

const require = createRequire(import.meta.url);
const audioTranscriber = require("../builtin/audio-transcriber/handler.js");
const mediaMetadata = require("../builtin/media-metadata/handler.js");
const videoToolkit = require("../builtin/video-toolkit/handler.js");

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-media-process-"));
  temporaryDirectories.push(directory);
  return directory;
}

function probeFixture() {
  return JSON.stringify({
    format: {
      duration: "3.5",
      size: "128",
      bit_rate: "64000",
      format_name: "fixture",
      tags: {},
    },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1280,
        height: 720,
        r_frame_rate: "30/1",
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
      },
    ],
  });
}

function processContext(skillId, root, adapter) {
  return {
    projectRoot: root,
    ...createTestProcessContext(skillId, adapter, { allowedRoots: [root] }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("bundled media process handlers", () => {
  it("extracts audio metadata through bounded ffprobe argv", async () => {
    const root = temporaryDirectory();
    const input = path.join(root, "sample.mp3");
    fs.writeFileSync(input, "fixture\n");
    const adapter = vi.fn(() => probeFixture());
    const result = await mediaMetadata.execute(
      { input: `--audio ${input}` },
      processContext("media-metadata", root, adapter),
    );
    expect(result.success).toBe(true);
    expect(result.result.codec).toBe("aac");
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "ffprobe",
        args: expect.arrayContaining(["-show_streams", input]),
      }),
    );
  });

  it("runs video transforms through exact ffmpeg argv", async () => {
    const root = temporaryDirectory();
    const input = path.join(root, "sample.mp4");
    const output = path.join(root, "thumb.png");
    fs.writeFileSync(input, "fixture\n");
    const adapter = vi.fn(() => "");
    const result = await videoToolkit.execute(
      { input: `--thumbnail ${input} --time 00:00:01 --output ${output}` },
      processContext("video-toolkit", root, adapter),
    );
    expect(result.success).toBe(true);
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "ffmpeg",
        args: ["-y", "-ss", "00:00:01", "-i", input, "-frames:v", "1", output],
      }),
    );
  });

  it("rejects ffmpeg option injection and escaped outputs before execution", async () => {
    const root = temporaryDirectory();
    const input = path.join(root, "sample.mp4");
    fs.writeFileSync(input, "fixture\n");
    const adapter = vi.fn(() => "");
    const context = processContext("video-toolkit", root, adapter);
    const injected = await videoToolkit.execute(
      { input: `--thumbnail ${input} --time 00:00:01;whoami` },
      context,
    );
    const escaped = await videoToolkit.execute(
      { input: `--thumbnail ${input} --output ../escaped.png` },
      context,
    );
    expect(injected.success).toBe(false);
    expect(escaped.success).toBe(false);
    expect(adapter).not.toHaveBeenCalled();
  });

  it("fails closed without branded process authority", async () => {
    const root = temporaryDirectory();
    const audio = path.join(root, "sample.mp3");
    const video = path.join(root, "sample.mp4");
    fs.writeFileSync(audio, "fixture\n");
    fs.writeFileSync(video, "fixture\n");
    const metadataResult = await mediaMetadata.execute(
      { input: `--audio ${audio}` },
      { projectRoot: root },
    );
    const videoResult = await videoToolkit.execute(
      { input: `--info ${video}` },
      { projectRoot: root },
    );
    expect(metadataResult.success).toBe(false);
    expect(videoResult.success).toBe(false);
    expect(metadataResult.error).toMatch(/process authority/i);
    expect(videoResult.error).toMatch(/process authority/i);
  });

  it("keeps media handlers free of implicit fluent-ffmpeg execution", () => {
    for (const skillId of [
      "audio-transcriber",
      "media-metadata",
      "video-toolkit",
    ]) {
      const source = fs.readFileSync(
        path.resolve(
          `src/main/ai-engine/cowork/skills/builtin/${skillId}/handler.js`,
        ),
        "utf8",
      );
      expect(source, skillId).not.toContain("fluent-ffmpeg");
    }
    expect(audioTranscriber.execute).toBeTypeOf("function");
  });
});
