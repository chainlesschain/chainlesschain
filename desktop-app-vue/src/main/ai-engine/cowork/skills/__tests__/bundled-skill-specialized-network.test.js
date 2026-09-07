import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvironmentContext } from "./helpers/bundled-skill-environment.js";
import { withTestFilesystemHandler } from "./helpers/bundled-skill-filesystem.js";

const { logger } = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../../../utils/logger.js", () => ({ logger, default: logger }));
vi.mock("child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("local whisper unavailable in broker tests");
  }),
}));

const audioHandler = withTestFilesystemHandler(
  require("../builtin/audio-transcriber/handler.js"),
  "audio-transcriber",
);
const imageHandler = withTestFilesystemHandler(
  require("../builtin/image-generator/handler.js"),
  "image-generator",
);
const {
  createBundledSkillFixedNetworkBroker,
} = require("../bundled-skill-egress-broker.js");
const {
  createBundledSkillLocalServiceBroker,
} = require("../bundled-skill-local-service-broker.js");

function createTransport(body, statusCode = 200) {
  const calls = [];
  const transport = {
    request: vi.fn((options, callback) => {
      const req = new EventEmitter();
      const end = vi.fn();
      req.end = end;
      req.write = vi.fn();
      req.destroy = vi.fn();
      req.setTimeout = vi.fn();
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.statusMessage = statusCode === 200 ? "OK" : "Error";
      res.headers = { "content-type": "application/json" };
      res.destroy = vi.fn();
      calls.push({ end, options, req, res });
      callback(res);
      process.nextTick(() => {
        res.emit(
          "data",
          typeof body === "string" ? body : JSON.stringify(body),
        );
        res.emit("end");
      });
      return req;
    }),
  };
  return { calls, transport };
}

describe("specialized bundled Skill network paths", () => {
  let temporaryDirectory;
  const audioEnvironment = createEnvironmentContext("audio-transcriber", {
    "openai-api-key": "test-openai-secret",
  });
  const dalleEnvironment = createEnvironmentContext("image-generator", {
    "openai-api-key": "test-openai-secret",
  });
  const stableDiffusionEnvironment = createEnvironmentContext(
    "image-generator",
    { "stable-diffusion-endpoint": "http://localhost:7860" },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    temporaryDirectory = mkdtempSync(
      path.join(os.tmpdir(), "cc-specialized-network-"),
    );
  });

  afterEach(() => {
    if (temporaryDirectory && existsSync(temporaryDirectory)) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("blocks Whisper API upload before the network broker", async () => {
    const audioPath = path.join(temporaryDirectory, "sample.wav");
    writeFileSync(audioPath, Buffer.from("test-audio"));
    const { calls, transport: https } = createTransport({
      text: "hello",
      language: "en",
      duration: 1,
      segments: [],
    });
    const auditSink = vi.fn();
    const networkBroker = createBundledSkillFixedNetworkBroker(
      "audio-transcriber",
      { https, auditSink },
    );

    const result = await audioHandler.execute(
      { input: `--transcribe ${audioPath} --language en` },
      { ...audioEnvironment, networkBroker, projectRoot: temporaryDirectory },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("governed multimodal ingress");
    expect(calls).toHaveLength(0);
    expect(auditSink).not.toHaveBeenCalled();
  });

  it("rejects a plain object pretending to be the Whisper broker", async () => {
    const audioPath = path.join(temporaryDirectory, "sample.wav");
    writeFileSync(audioPath, Buffer.from("test-audio"));
    const request = vi.fn();

    const result = await audioHandler.execute(
      { input: `--transcribe ${audioPath}` },
      {
        ...audioEnvironment,
        networkBroker: { request },
        projectRoot: temporaryDirectory,
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("governed multimodal ingress");
    expect(request).not.toHaveBeenCalled();
  });

  it("blocks DALL-E generation before the network broker", async () => {
    const outputPath = path.join(temporaryDirectory, "dalle.png");
    const { calls, transport: https } = createTransport({
      data: [{ b64_json: Buffer.from("dalle-image").toString("base64") }],
    });
    const networkBroker = createBundledSkillFixedNetworkBroker(
      "image-generator",
      { https, auditSink: vi.fn() },
    );

    const result = await imageHandler.execute(
      {
        input: `--generate "sunset" --provider dalle --output ${outputPath}`,
      },
      { ...dalleEnvironment, networkBroker, projectRoot: temporaryDirectory },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("governed multimodal ingress");
    expect(calls).toHaveLength(0);
  });

  it("blocks Stable Diffusion generation before the local service broker", async () => {
    const outputPath = path.join(temporaryDirectory, "sd.png");
    const { calls, transport: http } = createTransport({
      images: [Buffer.from("sd-image").toString("base64")],
    });
    const localServiceBroker = createBundledSkillLocalServiceBroker(
      {
        skillId: "image-generator",
        serviceId: "stable-diffusion",
        baseUrl: "http://localhost:7860/",
        authorityId: "test:stable-diffusion",
      },
      { http, auditSink: vi.fn() },
    );

    const result = await imageHandler.execute(
      {
        input: `--generate "sunset" --provider stable-diffusion --output ${outputPath}`,
      },
      {
        ...stableDiffusionEnvironment,
        localServiceBroker,
        projectRoot: temporaryDirectory,
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("governed multimodal ingress");
    expect(calls).toHaveLength(0);
  });
});
