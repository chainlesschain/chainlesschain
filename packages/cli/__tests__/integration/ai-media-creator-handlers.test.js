/**
 * Integration tests for ai-media-creator generated skill handlers.
 *
 * Flow:
 *   1. Run `cc init --template ai-media-creator --yes` in a temp dir
 *   2. Load the generated handler.js files using createRequire
 *   3. Test handler logic at the Node.js module level
 *
 * These tests focus on paths that don't need real HTTP servers or TTS tools:
 *   - Parameter validation errors
 *   - Missing workflow file errors
 *   - "No TTS backends available" fallback (in clean CI environment)
 *   - ComfyUI connection failure (no server running on random port)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

let tempDir;
let require;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cc-media-handlers-"));
  // Run init to generate the skill handlers on disk
  execSync(`node ${bin} init --template ai-media-creator --yes`, {
    cwd: tempDir,
    encoding: "utf-8",
    timeout: 15000,
  });
  // Create a require function rooted at the temp dir
  require = createRequire(pathToFileURL(join(tempDir, "index.js")).href);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── comfyui-image handler ─────────────────────────────────────────────────

describe("comfyui-image handler (generated)", () => {
  let handler;

  beforeAll(() => {
    const handlerPath = join(
      tempDir,
      ".chainlesschain",
      "skills",
      "comfyui-image",
      "handler.js",
    );
    expect(existsSync(handlerPath)).toBe(true);
    handler = require(handlerPath);
  });

  it("is a function", () => {
    expect(typeof handler).toBe("function");
  });

  it("returns error when prompt is missing", async () => {
    const result = await handler({});
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("prompt");
  });

  it("returns error when prompt is empty string", async () => {
    const result = await handler({ prompt: "" });
    // "" is falsy, so should hit the same missing param guard
    expect(result).toHaveProperty("error");
  });

  it("returns connection error when ComfyUI is not running", async () => {
    // We point to a port that nothing is listening on
    const originalEnv = process.env.COMFYUI_URL;
    process.env.COMFYUI_URL = "http://127.0.0.1:19999";
    try {
      const result = await handler({ prompt: "test image" });
      expect(result).toHaveProperty("error");
      // Should indicate a connection failure
      expect(result.error).toMatch(/connect|running|ComfyUI/i);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.COMFYUI_URL;
      } else {
        process.env.COMFYUI_URL = originalEnv;
      }
    }
  });

  it("returns error with hint when ComfyUI not running", async () => {
    const originalEnv = process.env.COMFYUI_URL;
    process.env.COMFYUI_URL = "http://127.0.0.1:19999";
    try {
      const result = await handler({ prompt: "mountain landscape" });
      // Should include a hint about starting ComfyUI
      expect(result.hint || result.error).toBeTruthy();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.COMFYUI_URL;
      } else {
        process.env.COMFYUI_URL = originalEnv;
      }
    }
  });
});

// ─── comfyui-video handler ─────────────────────────────────────────────────

describe("comfyui-video handler (generated)", () => {
  let handler;

  beforeAll(() => {
    const handlerPath = join(
      tempDir,
      ".chainlesschain",
      "skills",
      "comfyui-video",
      "handler.js",
    );
    expect(existsSync(handlerPath)).toBe(true);
    handler = require(handlerPath);
  });

  it("is a function", () => {
    expect(typeof handler).toBe("function");
  });

  it("returns error when prompt is missing", async () => {
    const result = await handler({});
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("prompt");
  });

  it("returns error with AnimateDiff hint when workflow is missing", async () => {
    const result = await handler({ prompt: "a walking cat" });
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("workflow");
    // Should provide install/setup hint
    expect(result.hint).toBeTruthy();
    expect(result.hint).toContain("AnimateDiff");
  });

  it("returns error when workflow file does not exist", async () => {
    const result = await handler({
      prompt: "a walking cat",
      workflow: "workflows/nonexistent.json",
    });
    // If ComfyUI is not running, connection error fires first
    // If it happens to connect, it should fail on missing workflow file
    // Both are valid error outcomes
    expect(result).toHaveProperty("error");
  });

  it("returns error when workflow file has invalid JSON", async () => {
    // Create a temp bad JSON file in the tempDir
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const wfDir = join(tempDir, "workflows");
    mkdirSync(wfDir, { recursive: true });
    const badFile = join(wfDir, "bad.json");
    writeFileSync(badFile, "{ not valid json }", "utf-8");

    const originalEnv = process.env.COMFYUI_URL;
    // Point to running ComfyUI mock (we'll test connection error first)
    process.env.COMFYUI_URL = "http://127.0.0.1:19999";
    try {
      const result = await handler({
        prompt: "test video",
        workflow: "workflows/bad.json",
      });
      // Either connection error or JSON parse error
      expect(result).toHaveProperty("error");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.COMFYUI_URL;
      } else {
        process.env.COMFYUI_URL = originalEnv;
      }
    }
  });
});

// ─── audio-gen handler ─────────────────────────────────────────────────────

describe("audio-gen handler (generated)", () => {
  let handler;

  beforeAll(() => {
    const handlerPath = join(
      tempDir,
      ".chainlesschain",
      "skills",
      "audio-gen",
      "handler.js",
    );
    expect(existsSync(handlerPath)).toBe(true);
    handler = require(handlerPath);
  });

  it("is a function", () => {
    expect(typeof handler).toBe("function");
  });

  it("returns error when text is missing", async () => {
    const result = await handler({});
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("text");
  });

  it("returns error when text is empty string", async () => {
    const result = await handler({ text: "" });
    expect(result).toHaveProperty("error");
  });

  it("returns install guidance when no TTS backends are available", async () => {
    // In CI / clean environment without edge-tts/piper/API keys,
    // the handler should fall through all backends and return install hint.
    const originalEleven = process.env.ELEVENLABS_API_KEY;
    const originalOpenai = process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await handler({ text: "Hello world" });
      // Either produces audio (if edge-tts happens to be installed on this machine)
      // or returns install hint
      if (!result.success) {
        expect(result).toHaveProperty("error");
        expect(result.hint || result.error).toBeTruthy();
        // Hint should mention at least one install option
        const combined = `${result.error || ""} ${result.hint || ""}`;
        expect(combined).toMatch(/edge-tts|piper|ElevenLabs|OpenAI/i);
      } else {
        // If it somehow succeeded (edge-tts installed), that's also valid
        expect(result.success).toBe(true);
        expect(result.output).toBeTruthy();
      }
    } finally {
      if (originalEleven !== undefined)
        process.env.ELEVENLABS_API_KEY = originalEleven;
      if (originalOpenai !== undefined)
        process.env.OPENAI_API_KEY = originalOpenai;
    }
  });

  it("uses default output filename when not specified", async () => {
    // Check the handler code contains default output path logic
    const handlerPath = join(
      tempDir,
      ".chainlesschain",
      "skills",
      "audio-gen",
      "handler.js",
    );
    const src = readFileSync(handlerPath, "utf-8");
    expect(src).toContain("output.mp3");
  });

  it("creates output directory if it does not exist", async () => {
    // Check the handler has mkdirSync call for outputDir
    const handlerPath = join(
      tempDir,
      ".chainlesschain",
      "skills",
      "audio-gen",
      "handler.js",
    );
    const src = readFileSync(handlerPath, "utf-8");
    expect(src).toContain("mkdirSync");
    expect(src).toContain("recursive: true");
  });
});

// ─── Cross-skill tests ─────────────────────────────────────────────────────

describe("generated skill files: content validation", () => {
  const SKILLS = ["comfyui-image", "comfyui-video", "audio-gen"];

  for (const skillName of SKILLS) {
    it(`${skillName}/SKILL.md starts with YAML frontmatter`, () => {
      const skillMd = readFileSync(
        join(tempDir, ".chainlesschain", "skills", skillName, "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toMatch(/^---\r?\n/);
      expect(skillMd).toContain("---\n");
    });

    it(`${skillName}/SKILL.md has correct name field`, () => {
      const skillMd = readFileSync(
        join(tempDir, ".chainlesschain", "skills", skillName, "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain(`name: ${skillName}`);
    });

    it(`${skillName}/SKILL.md has category: media`, () => {
      const skillMd = readFileSync(
        join(tempDir, ".chainlesschain", "skills", skillName, "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("category: media");
    });

    it(`${skillName}/handler.js has no Chinese character encoding issues`, () => {
      const handlerSrc = readFileSync(
        join(tempDir, ".chainlesschain", "skills", skillName, "handler.js"),
        "utf-8",
      );
      // Should not contain U+FFFD replacement characters (encoding corruption)
      expect(handlerSrc).not.toContain("\uFFFD");
    });

    it(`${skillName}/SKILL.md has no Chinese character encoding issues`, () => {
      const skillMd = readFileSync(
        join(tempDir, ".chainlesschain", "skills", skillName, "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).not.toContain("\uFFFD");
    });
  }

  it("workflows/README.md is valid UTF-8 with no replacement chars", () => {
    const readme = readFileSync(
      join(tempDir, "workflows", "README.md"),
      "utf-8",
    );
    expect(readme).not.toContain("\uFFFD");
    expect(readme).toContain("ComfyUI");
  });

  it("all 3 handler.js files are loadable as CJS modules", () => {
    for (const skillName of SKILLS) {
      const handlerPath = join(
        tempDir,
        ".chainlesschain",
        "skills",
        skillName,
        "handler.js",
      );
      expect(
        () => require(handlerPath),
        `${skillName} handler should be loadable`,
      ).not.toThrow();
    }
  });
});
