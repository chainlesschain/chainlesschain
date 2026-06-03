/**
 * Unit tests for the ai-media-creator template in init.js.
 *
 * These tests validate the SKILL_TEMPLATES constant (SKILL.md content and
 * handler.js JS syntax) and the WORKFLOW_README content, all without
 * touching the filesystem or spawning subprocesses.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const initSrc = readFileSync(
  join(__dirname, "../../src/commands/init.js"),
  "utf-8",
);

// ─── Extract SKILL_TEMPLATES from source ───────────────────────────────────
// We need the actual runtime values — use a restricted eval inside a VM
// We strip the ESM export lines and import statements so it becomes runnable CJS.

function extractTemplatesFromSource() {
  // Turn the ES module into something we can run in a VM to extract constants.
  // Replace ESM imports (we don't need them for the templates) with stubs.
  const stripped = initSrc
    .replace(/^import\s.+?;$/gm, "") // remove import lines
    .replace(/^export\s+function.+$/ms, "") // remove export function
    .replace(/registerInitCommand[\s\S]*$/m, "") // stop at the export fn
    .trim();

  const sandbox = { module: { exports: {} }, exports: {} };
  try {
    // Wrap in a function that returns the vars we care about
    const wrapped = `
(function() {
  ${stripped}
  return { SKILL_TEMPLATES, WORKFLOW_README, TEMPLATES };
})()`;
    const result = vm.runInNewContext(wrapped, {
      ...sandbox,
      console,
      process,
      require: () => ({}),
    });
    return result;
  } catch {
    return null;
  }
}

const extracted = extractTemplatesFromSource();
const SKILL_TEMPLATES = extracted?.SKILL_TEMPLATES ?? null;
const WORKFLOW_README = extracted?.WORKFLOW_README ?? null;
const TEMPLATES = extracted?.TEMPLATES ?? null;

// ─── YAML frontmatter parser (minimal) ─────────────────────────────────────
function parseYamlFrontmatter(md) {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) result[key] = val;
  }
  return result;
}

// ─── JS syntax check via vm.Script ─────────────────────────────────────────
function isValidJS(code) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(code);
    return true;
  } catch {
    return false;
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("init.js: SKILL_TEMPLATES extraction", () => {
  it("can extract SKILL_TEMPLATES from source", () => {
    expect(SKILL_TEMPLATES).not.toBeNull();
    expect(typeof SKILL_TEMPLATES).toBe("object");
  });

  it("contains the 3 ai-media-creator skill template entries", () => {
    expect(SKILL_TEMPLATES).toHaveProperty("comfyui-image");
    expect(SKILL_TEMPLATES).toHaveProperty("comfyui-video");
    expect(SKILL_TEMPLATES).toHaveProperty("audio-gen");
  });

  it("each entry has md and handler string properties", () => {
    for (const [key, tmpl] of Object.entries(SKILL_TEMPLATES)) {
      expect(typeof tmpl.md, `${key}.md should be string`).toBe("string");
      expect(tmpl.md.length, `${key}.md should not be empty`).toBeGreaterThan(
        100,
      );
      expect(typeof tmpl.handler, `${key}.handler should be string`).toBe(
        "string",
      );
      expect(
        tmpl.handler.length,
        `${key}.handler should not be empty`,
      ).toBeGreaterThan(200);
    }
  });
});

describe("SKILL_TEMPLATES: SKILL.md frontmatter validation", () => {
  it("comfyui-image SKILL.md has required YAML fields", () => {
    const fm = parseYamlFrontmatter(SKILL_TEMPLATES["comfyui-image"].md);
    expect(fm).not.toBeNull();
    expect(fm.name).toBe("comfyui-image");
    expect(fm.category).toBe("media");
    expect(fm["execution-mode"]).toBe("direct");
    expect(fm.version).toBe("1.0.0");
    expect(fm.description).toBeTruthy();
  });

  it("comfyui-image SKILL.md has prompt parameter documented", () => {
    const md = SKILL_TEMPLATES["comfyui-image"].md;
    expect(md).toContain("name: prompt");
    expect(md).toContain("required: true");
  });

  it("comfyui-image SKILL.md documents ComfyUI API usage", () => {
    const md = SKILL_TEMPLATES["comfyui-image"].md;
    expect(md).toContain("ComfyUI");
    expect(md).toContain("localhost:8188");
  });

  it("comfyui-video SKILL.md has required YAML fields", () => {
    const fm = parseYamlFrontmatter(SKILL_TEMPLATES["comfyui-video"].md);
    expect(fm).not.toBeNull();
    expect(fm.name).toBe("comfyui-video");
    expect(fm.category).toBe("media");
    expect(fm["execution-mode"]).toBe("direct");
    expect(fm.version).toBe("1.0.0");
  });

  it("comfyui-video SKILL.md mentions AnimateDiff", () => {
    const md = SKILL_TEMPLATES["comfyui-video"].md;
    expect(md).toContain("AnimateDiff");
  });

  it("comfyui-video SKILL.md requires workflow parameter", () => {
    const md = SKILL_TEMPLATES["comfyui-video"].md;
    expect(md).toContain("name: workflow");
    expect(md).toContain("required: true");
  });

  it("audio-gen SKILL.md has required YAML fields", () => {
    const fm = parseYamlFrontmatter(SKILL_TEMPLATES["audio-gen"].md);
    expect(fm).not.toBeNull();
    expect(fm.name).toBe("audio-gen");
    expect(fm.category).toBe("media");
    expect(fm["execution-mode"]).toBe("direct");
    expect(fm.version).toBe("1.0.0");
  });

  it("audio-gen SKILL.md documents all 4 TTS backends", () => {
    const md = SKILL_TEMPLATES["audio-gen"].md;
    expect(md).toContain("edge-tts");
    expect(md).toContain("piper-tts");
    expect(md).toContain("ElevenLabs");
    expect(md).toContain("OpenAI");
  });

  it("audio-gen SKILL.md text parameter is required", () => {
    const md = SKILL_TEMPLATES["audio-gen"].md;
    expect(md).toContain("name: text");
    expect(md).toContain("required: true");
  });

  it("all SKILL.md files mention cli-anything integration", () => {
    for (const [key, tmpl] of Object.entries(SKILL_TEMPLATES)) {
      expect(tmpl.md, `${key} should mention cli-anything`).toContain(
        "cli-anything",
      );
    }
  });
});

describe("SKILL_TEMPLATES: handler.js syntax validation", () => {
  it("comfyui-image handler.js is valid JavaScript", () => {
    expect(isValidJS(SKILL_TEMPLATES["comfyui-image"].handler)).toBe(true);
  });

  it("comfyui-video handler.js is valid JavaScript", () => {
    expect(isValidJS(SKILL_TEMPLATES["comfyui-video"].handler)).toBe(true);
  });

  it("audio-gen handler.js is valid JavaScript", () => {
    expect(isValidJS(SKILL_TEMPLATES["audio-gen"].handler)).toBe(true);
  });

  it("comfyui-image handler exports a function via module.exports", () => {
    const handler = SKILL_TEMPLATES["comfyui-image"].handler;
    expect(handler).toContain("module.exports");
    expect(handler).toContain("async function");
  });

  it("comfyui-video handler exports a function via module.exports", () => {
    const handler = SKILL_TEMPLATES["comfyui-video"].handler;
    expect(handler).toContain("module.exports");
    expect(handler).toContain("async function");
  });

  it("audio-gen handler exports a function via module.exports", () => {
    const handler = SKILL_TEMPLATES["audio-gen"].handler;
    expect(handler).toContain("module.exports");
    expect(handler).toContain("async function");
  });

  it("comfyui-image handler uses COMFYUI_URL env variable", () => {
    const handler = SKILL_TEMPLATES["comfyui-image"].handler;
    expect(handler).toContain("COMFYUI_URL");
    expect(handler).toContain("localhost:8188");
  });

  it("comfyui-image handler validates prompt parameter", () => {
    const handler = SKILL_TEMPLATES["comfyui-image"].handler;
    expect(handler).toContain("Missing required parameter: prompt");
  });

  it("comfyui-video handler requires workflow file", () => {
    const handler = SKILL_TEMPLATES["comfyui-video"].handler;
    expect(handler).toContain("Missing required parameter: workflow");
    expect(handler).toContain("AnimateDiff");
  });

  it("comfyui-image handler polls /history/{promptId}", () => {
    const handler = SKILL_TEMPLATES["comfyui-image"].handler;
    expect(handler).toContain("/history/");
    expect(handler).toContain("prompt_id");
  });

  it("comfyui-video handler collects videos/gifs/images outputs", () => {
    const handler = SKILL_TEMPLATES["comfyui-video"].handler;
    expect(handler).toContain('"videos"');
    expect(handler).toContain('"gifs"');
    expect(handler).toContain('"images"');
  });

  it("audio-gen handler checks edge-tts first", () => {
    const handler = SKILL_TEMPLATES["audio-gen"].handler;
    // edge-tts should appear before piper and ElevenLabs
    const edgeTtsIdx = handler.indexOf("edge-tts");
    const piperIdx = handler.indexOf("piper");
    const elevenIdx = handler.indexOf("ElevenLabs");
    expect(edgeTtsIdx).toBeGreaterThan(0);
    expect(piperIdx).toBeGreaterThan(edgeTtsIdx);
    expect(elevenIdx).toBeGreaterThan(piperIdx);
  });

  it("audio-gen handler has checkPythonModule helper", () => {
    const handler = SKILL_TEMPLATES["audio-gen"].handler;
    expect(handler).toContain("checkPythonModule");
    expect(handler).toContain("edge_tts");
  });

  it("audio-gen handler returns install hint when no backends available", () => {
    const handler = SKILL_TEMPLATES["audio-gen"].handler;
    expect(handler).toContain("No TTS backend available");
    expect(handler).toContain("pip install edge-tts");
  });

  it("handlers use utf8 encoding for child process output", () => {
    // Verify no bare data.toString() without encoding
    const audioHandler = SKILL_TEMPLATES["audio-gen"].handler;
    // stderr listener should use utf8
    expect(audioHandler).toContain('toString("utf8")');
  });
});

describe("WORKFLOW_README content", () => {
  it("can extract WORKFLOW_README from source", () => {
    expect(WORKFLOW_README).not.toBeNull();
    expect(typeof WORKFLOW_README).toBe("string");
    expect(WORKFLOW_README.length).toBeGreaterThan(200);
  });

  it("contains ComfyUI workflow export instructions", () => {
    expect(WORKFLOW_README).toContain("ComfyUI");
    expect(WORKFLOW_README).toContain("API Format");
  });

  it("documents comfyui-image and comfyui-video skill usage", () => {
    expect(WORKFLOW_README).toContain("comfyui-image");
    expect(WORKFLOW_README).toContain("comfyui-video");
  });

  it("mentions cli-anything integration", () => {
    expect(WORKFLOW_README).toContain("cli-anything");
    expect(WORKFLOW_README).toContain("cli-anything scan");
    expect(WORKFLOW_README).toContain("cli-anything register");
  });

  it("lists FFmpeg and yt-dlp as cli-anything candidates", () => {
    expect(WORKFLOW_README).toContain("FFmpeg");
    expect(WORKFLOW_README).toContain("yt-dlp");
  });
});

describe("TEMPLATES: ai-media-creator entry", () => {
  it("can extract TEMPLATES from source", () => {
    expect(TEMPLATES).not.toBeNull();
    expect(TEMPLATES).toHaveProperty("ai-media-creator");
  });

  it("ai-media-creator has required fields", () => {
    const tmpl = TEMPLATES["ai-media-creator"];
    expect(typeof tmpl.description).toBe("string");
    expect(tmpl.description.length).toBeGreaterThan(10);
    expect(typeof tmpl.rules).toBe("string");
    expect(Array.isArray(tmpl.skills)).toBe(true);
    expect(tmpl.persona).toBeDefined();
    expect(Array.isArray(tmpl.generateSkills)).toBe(true);
  });

  it("ai-media-creator skills include comfyui-image, comfyui-video, audio-gen", () => {
    const { skills } = TEMPLATES["ai-media-creator"];
    expect(skills).toContain("comfyui-image");
    expect(skills).toContain("comfyui-video");
    expect(skills).toContain("audio-gen");
  });

  it("ai-media-creator generateSkills matches the 3 media skills", () => {
    const { generateSkills } = TEMPLATES["ai-media-creator"];
    expect(generateSkills).toHaveLength(3);
    expect(generateSkills).toContain("comfyui-image");
    expect(generateSkills).toContain("comfyui-video");
    expect(generateSkills).toContain("audio-gen");
  });

  it("ai-media-creator persona has name, role, behaviors", () => {
    const { persona } = TEMPLATES["ai-media-creator"];
    expect(typeof persona.name).toBe("string");
    expect(persona.name.length).toBeGreaterThan(0);
    expect(typeof persona.role).toBe("string");
    expect(persona.role.length).toBeGreaterThan(20);
    expect(Array.isArray(persona.behaviors)).toBe(true);
    expect(persona.behaviors.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(persona.toolsPriority)).toBe(true);
    expect(Array.isArray(persona.toolsDisabled)).toBe(true);
  });

  it("ai-media-creator rules.md explains ComfyUI is REST-first (not cli-anything)", () => {
    const { rules } = TEMPLATES["ai-media-creator"];
    expect(rules).toContain("ComfyUI");
    expect(rules).toContain("cli-anything");
    // Should explicitly say ComfyUI is NOT suitable for cli-anything
    expect(rules).toMatch(/ComfyUI[^]*不适合通过 cli-anything/);
  });

  it("all 8 templates still exist in TEMPLATES", () => {
    const expected = [
      "code-project",
      "data-science",
      "devops",
      "medical-triage",
      "agriculture-expert",
      "general-assistant",
      "ai-media-creator",
      "empty",
    ];
    for (const key of expected) {
      expect(TEMPLATES, `Template '${key}' should exist`).toHaveProperty(key);
    }
  });
});
