import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  createAIEngineOutputResolver,
  sanitizeBaseName,
} = require("../../../src/main/ai-engine/ai-engine-ipc-output.js");

const context = Object.freeze({
  actorDid: "did:key:operator",
  operation: "generate-ppt",
  purpose: "project-presentation-generate",
  senderId: 17,
  tenantId: "tenant:alpha",
});

describe("AI Engine managed output resolver", () => {
  let projectRoot;
  let database;

  beforeEach(async () => {
    projectRoot = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "cc-ai-output-")),
    );
    database = {
      getProjectById: vi.fn((projectId) => ({
        id: projectId,
        user_id: "device-user",
        root_path: projectRoot,
        root_path_local_attested: 1,
        deleted: 0,
      })),
    };
  });

  afterEach(() => {
    const resolvedRoot = path.resolve(projectRoot);
    const relative = path.relative(path.resolve(os.tmpdir()), resolvedRoot);
    if (
      relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    ) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  });

  it("reserves, verifies, and commits a file inside the attested project root", async () => {
    const resolver = createAIEngineOutputResolver({ database });
    const lease = await resolver.reserve(context, {
      projectId: "project-123",
      title: "Roadmap",
      extension: ".pptx",
    });

    expect(lease.fileName).toBe("Roadmap.pptx");
    expect(lease.outputPath).toBe(path.join(projectRoot, "Roadmap.pptx"));
    expect(fs.existsSync(lease.outputPath)).toBe(true);

    fs.writeFileSync(lease.outputPath, "ppt-data");
    await expect(lease.commit()).resolves.toEqual({ fileSize: 8 });
    await lease.cleanup();
    expect(fs.readFileSync(lease.outputPath, "utf8")).toBe("ppt-data");
  });

  it("never overwrites an existing output and cleans an uncommitted lease", async () => {
    const resolver = createAIEngineOutputResolver({ database });
    const first = await resolver.reserve(context, {
      projectId: "project-123",
      title: "Roadmap",
      extension: ".pptx",
    });
    fs.writeFileSync(first.outputPath, "first");
    await first.commit();

    const second = await resolver.reserve(context, {
      projectId: "project-123",
      title: "Roadmap",
      extension: ".pptx",
    });
    expect(second.fileName).toBe("Roadmap-2.pptx");
    expect(fs.readFileSync(first.outputPath, "utf8")).toBe("first");

    await second.cleanup();
    expect(fs.existsSync(second.outputPath)).toBe(false);
  });

  it("sanitizes renderer-derived titles before resolving the child path", async () => {
    const resolver = createAIEngineOutputResolver({ database });
    const lease = await resolver.reserve(context, {
      projectId: "project-123",
      title: "../CON<>: report. ",
      extension: ".docx",
    });

    expect(lease.fileName).toBe("_CON___ report.docx");
    expect(path.dirname(lease.outputPath)).toBe(projectRoot);
    await lease.cleanup();
    expect(sanitizeBaseName("CON", "document")).toBe("_CON");
    expect(sanitizeBaseName("CON.txt", "document")).toBe("_CON.txt");
    expect(sanitizeBaseName(`${"a".repeat(95)}.tail`, "document")).toBe(
      "a".repeat(95),
    );
  });

  it("binds the optional project authority without disclosing the root path", async () => {
    const authorizeProjectOutput = vi.fn(async () => ({ authorized: true }));
    const resolver = createAIEngineOutputResolver({
      database,
      authorizeProjectOutput,
    });
    const lease = await resolver.reserve(context, {
      projectId: "project-123",
      title: "Plan",
      extension: ".pptx",
    });

    expect(authorizeProjectOutput).toHaveBeenCalledWith({
      actorDid: "did:key:operator",
      operation: "generate-ppt",
      projectId: "project-123",
      projectUserId: "device-user",
      purpose: "project-presentation-generate",
      senderId: 17,
      tenantId: "tenant:alpha",
    });
    expect(authorizeProjectOutput.mock.calls[0][0]).not.toHaveProperty(
      "rootPath",
    );
    await lease.cleanup();
  });

  it("fails closed when project authority refuses before reserving a file", async () => {
    const resolver = createAIEngineOutputResolver({
      database,
      authorizeProjectOutput: vi.fn(async () => false),
    });

    await expect(
      resolver.reserve(context, {
        projectId: "project-123",
        title: "Plan",
        extension: ".pptx",
      }),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_OUTPUT_UNAVAILABLE" });
    expect(fs.readdirSync(projectRoot)).toEqual([]);
  });

  it.each([
    ["missing project", null],
    [
      "deleted project",
      {
        id: "project-123",
        root_path: "ROOT",
        root_path_local_attested: 1,
        deleted: 1,
      },
    ],
    [
      "unattested root",
      {
        id: "project-123",
        root_path: "ROOT",
        root_path_local_attested: 0,
        deleted: 0,
      },
    ],
    [
      "mismatched project row",
      {
        id: "project-other",
        root_path: "ROOT",
        root_path_local_attested: 1,
        deleted: 0,
      },
    ],
  ])("rejects %s", async (_label, row) => {
    database.getProjectById.mockReturnValueOnce(
      row && { ...row, root_path: row.root_path.replace("ROOT", projectRoot) },
    );
    const resolver = createAIEngineOutputResolver({ database });

    await expect(
      resolver.reserve(context, {
        projectId: "project-123",
        title: "Plan",
        extension: ".pptx",
      }),
    ).rejects.toMatchObject({ code: "CC_AI_ENGINE_OUTPUT_UNAVAILABLE" });
  });

  it("rejects an empty placeholder as a completed document", async () => {
    const resolver = createAIEngineOutputResolver({ database });
    const lease = await resolver.reserve(context, {
      projectId: "project-123",
      title: "Empty",
      extension: ".pptx",
    });

    await expect(lease.commit()).rejects.toMatchObject({
      code: "CC_AI_ENGINE_OUTPUT_UNAVAILABLE",
    });
    await lease.cleanup();
  });
});
