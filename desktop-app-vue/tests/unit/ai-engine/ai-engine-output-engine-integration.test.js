import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PPTEngine = require("../../../src/main/engines/ppt-engine.js");
const {
  createAIEngineOutputResolver,
} = require("../../../src/main/ai-engine/ai-engine-ipc-output.js");

const context = Object.freeze({
  actorDid: "did:key:operator",
  operation: "generate-ppt",
  purpose: "project-presentation-generate",
  senderId: 17,
  tenantId: "did:key:operator",
});

describe("AI Engine managed output with production document engines", () => {
  let projectRoot;
  let resolver;
  let wordEngine;

  beforeEach(async () => {
    globalThis.__WORD_ENGINE_DOCX__ = await vi.importActual("docx");
    globalThis.__WORD_ENGINE_FS__ = await vi.importActual("node:fs/promises");
    delete globalThis.__WORD_ENGINE_FILE_HANDLER__;
    vi.resetModules();
    const wordEngineModule =
      await import("../../../src/main/engines/word-engine.js");
    wordEngine = wordEngineModule.default;

    projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "cc-ai-engine-write-"),
    );
    resolver = createAIEngineOutputResolver({
      database: {
        getProjectById: (projectId) => ({
          id: projectId,
          user_id: "device-user",
          root_path: projectRoot,
          root_path_local_attested: 1,
          deleted: 0,
        }),
      },
    });
  });

  afterEach(async () => {
    globalThis.__WORD_ENGINE_DOCX__ = {};
    globalThis.__WORD_ENGINE_FS__ = {};
    globalThis.__WORD_ENGINE_FILE_HANDLER__ = {};

    const resolvedRoot = path.resolve(projectRoot);
    const relative = path.relative(path.resolve(os.tmpdir()), resolvedRoot);
    if (
      relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    ) {
      await fs.rm(resolvedRoot, { recursive: true, force: true });
    }
  });

  it("lets the production PPT engine replace and commit its reserved file", async () => {
    const lease = await resolver.reserve(context, {
      projectId: "project-123",
      title: "Managed slides",
      extension: ".pptx",
    });
    const engine = new PPTEngine();

    await engine.generateFromOutline(
      { title: "Managed slides", sections: [] },
      { outputPath: lease.outputPath },
    );
    const committed = await lease.commit();
    const prefix = await fs.readFile(lease.outputPath);

    expect(committed.fileSize).toBeGreaterThan(0);
    expect(prefix.subarray(0, 2).toString("ascii")).toBe("PK");
  }, 30000);

  it("lets the production Word engine replace and commit its reserved file", async () => {
    const lease = await resolver.reserve(
      { ...context, operation: "generate-word" },
      {
        projectId: "project-123",
        title: "Managed document",
        extension: ".docx",
      },
    );

    await wordEngine.writeWord(lease.outputPath, {
      title: "Managed document",
      paragraphs: [{ text: "Generated inside the project root." }],
    });
    const committed = await lease.commit();
    const prefix = await fs.readFile(lease.outputPath);

    expect(committed.fileSize).toBeGreaterThan(0);
    expect(prefix.subarray(0, 2).toString("ascii")).toBe("PK");
  }, 30000);
});
