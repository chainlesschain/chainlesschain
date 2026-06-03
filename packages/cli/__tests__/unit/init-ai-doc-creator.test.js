/**
 * Unit tests for the ai-doc-creator template in init.js.
 *
 * Validates SKILL_TEMPLATES (doc-generate, libre-convert) structure,
 * YAML frontmatter, handler.js JS syntax, DOC_TEMPLATES_README content,
 * and the ai-doc-creator TEMPLATES entry — without any filesystem or
 * subprocess access.
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

// ─── Extract constants via VM ───────────────────────────────────────────────

function extractFromSource() {
  const stripped = initSrc
    .replace(/^import\s.+?;$/gm, "")
    .replace(/^export\s+function.+$/ms, "")
    .replace(/registerInitCommand[\s\S]*$/m, "")
    .trim();

  try {
    const wrapped = `(function() { ${stripped}; return { SKILL_TEMPLATES, WORKFLOW_README, DOC_TEMPLATES_README, TEMPLATES }; })()`;
    return vm.runInNewContext(wrapped, {
      console,
      process,
      require: () => ({}),
    });
  } catch {
    return null;
  }
}

const extracted = extractFromSource();
const SKILL_TEMPLATES = extracted?.SKILL_TEMPLATES ?? null;
const DOC_TEMPLATES_README = extracted?.DOC_TEMPLATES_README ?? null;
const TEMPLATES = extracted?.TEMPLATES ?? null;

function parseYamlFrontmatter(md) {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split("\n")) {
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

function isValidJS(code) {
  try {
    new vm.Script(code);
    return true;
  } catch {
    return false;
  }
}

// ─── SKILL_TEMPLATES: doc-generate ─────────────────────────────────────────

describe("SKILL_TEMPLATES: doc-generate SKILL.md", () => {
  it("doc-generate entry exists in SKILL_TEMPLATES", () => {
    expect(SKILL_TEMPLATES).not.toBeNull();
    expect(SKILL_TEMPLATES).toHaveProperty("doc-generate");
  });

  it("has md and handler strings", () => {
    const { md, handler } = SKILL_TEMPLATES["doc-generate"];
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(100);
    expect(typeof handler).toBe("string");
    expect(handler.length).toBeGreaterThan(200);
  });

  it("YAML frontmatter has required fields", () => {
    const fm = parseYamlFrontmatter(SKILL_TEMPLATES["doc-generate"].md);
    expect(fm).not.toBeNull();
    expect(fm.name).toBe("doc-generate");
    expect(fm.category).toBe("document");
    expect(fm["execution-mode"]).toBe("direct");
    expect(fm.version).toBe("1.0.0");
    expect(fm.description).toBeTruthy();
  });

  it("topic parameter is required", () => {
    const md = SKILL_TEMPLATES["doc-generate"].md;
    expect(md).toContain("name: topic");
    expect(md).toContain("required: true");
  });

  it("documents all 4 output formats", () => {
    const md = SKILL_TEMPLATES["doc-generate"].md;
    expect(md).toContain("md");
    expect(md).toContain("docx");
    expect(md).toContain("pdf");
    expect(md).toContain("html");
  });

  it("documents LibreOffice as cli-anything candidate", () => {
    const md = SKILL_TEMPLATES["doc-generate"].md;
    expect(md).toContain("cli-anything");
    expect(md).toContain("soffice");
  });

  it("mentions pandoc as docx conversion tool", () => {
    const md = SKILL_TEMPLATES["doc-generate"].md;
    expect(md).toContain("pandoc");
  });
});

describe("SKILL_TEMPLATES: doc-generate handler.js", () => {
  it("handler.js is valid JavaScript", () => {
    expect(isValidJS(SKILL_TEMPLATES["doc-generate"].handler)).toBe(true);
  });

  it("uses module.exports async function", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    expect(h).toContain("module.exports");
    expect(h).toContain("async function");
  });

  it("validates topic parameter", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    expect(h).toContain("Missing required parameter: topic");
  });

  it("supports 4 document styles", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    expect(h).toContain("report");
    expect(h).toContain("proposal");
    expect(h).toContain("manual");
    expect(h).toContain("readme");
  });

  it("generates markdown first, then converts", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    // md file should be written before any conversion call-site
    const mdWriteIdx = h.indexOf("writeFileSync(mdFile");
    // find the call-site of convertWithPandoc that appears AFTER writeFileSync(mdFile)
    const convertCallIdx = h.indexOf("convertWithPandoc(", mdWriteIdx + 1);
    expect(mdWriteIdx).toBeGreaterThan(0);
    expect(convertCallIdx).toBeGreaterThan(mdWriteIdx);
  });

  it("detects soffice on Windows default install path", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    expect(h).toContain("Program Files");
    expect(h).toContain("soffice.exe");
  });

  it("returns install hint when neither pandoc nor soffice is available", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    expect(h).toContain("pandoc");
    expect(h).toContain("libreoffice");
    expect(h).toContain("hint");
  });

  it("produces fallback template when LLM is unavailable", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    expect(h).toContain("LLM 调用失败");
    expect(h).toContain("chainlesschain ask");
  });

  it("uses utf-8 for child_process output (no bare toString())", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    // spawnSync uses encoding: "utf-8" option
    expect(h).toContain('"utf-8"');
  });

  it("unsupported format returns structured error", () => {
    const h = SKILL_TEMPLATES["doc-generate"].handler;
    expect(h).toContain("Unsupported format:");
    expect(h).toContain("Supported formats:");
  });
});

// ─── SKILL_TEMPLATES: libre-convert ────────────────────────────────────────

describe("SKILL_TEMPLATES: libre-convert SKILL.md", () => {
  it("libre-convert entry exists", () => {
    expect(SKILL_TEMPLATES).toHaveProperty("libre-convert");
  });

  it("YAML frontmatter has required fields", () => {
    const fm = parseYamlFrontmatter(SKILL_TEMPLATES["libre-convert"].md);
    expect(fm).not.toBeNull();
    expect(fm.name).toBe("libre-convert");
    expect(fm.category).toBe("document");
    expect(fm["execution-mode"]).toBe("direct");
    expect(fm.version).toBe("1.0.0");
  });

  it("input_file parameter is required", () => {
    const md = SKILL_TEMPLATES["libre-convert"].md;
    expect(md).toContain("name: input_file");
    expect(md).toContain("required: true");
  });

  it("documents cli-anything registration for soffice", () => {
    const md = SKILL_TEMPLATES["libre-convert"].md;
    expect(md).toContain("cli-anything");
    expect(md).toContain("cli-anything register soffice");
  });

  it("documents all supported target formats", () => {
    const md = SKILL_TEMPLATES["libre-convert"].md;
    expect(md).toContain("pdf");
    expect(md).toContain("docx");
    expect(md).toContain("html");
    expect(md).toContain("odt");
  });

  it("includes installation instructions for LibreOffice", () => {
    const md = SKILL_TEMPLATES["libre-convert"].md;
    expect(md).toContain("winget install");
    expect(md).toContain("brew install");
    expect(md).toContain("apt install");
  });
});

describe("SKILL_TEMPLATES: libre-convert handler.js", () => {
  it("handler.js is valid JavaScript", () => {
    expect(isValidJS(SKILL_TEMPLATES["libre-convert"].handler)).toBe(true);
  });

  it("uses module.exports async function", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("module.exports");
    expect(h).toContain("async function");
  });

  it("validates input_file parameter", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("Missing required parameter: input_file");
  });

  it("validates against SUPPORTED_FORMATS set", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("SUPPORTED_FORMATS");
    expect(h).toContain("Unsupported format:");
  });

  it("checks if input file exists", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("existsSync(inputPath)");
    expect(h).toContain("Input file not found:");
  });

  it("includes LibreOffice not-found error with install hint", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("LibreOffice not found");
    expect(h).toContain("cli-anything register soffice");
  });

  it("searches Windows default install paths", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("Program Files");
    expect(h).toContain("LibreOffice");
  });

  it("creates output directory if it does not exist", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("mkdirSync");
    expect(h).toContain("recursive: true");
  });

  it("uses headless mode for soffice", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain("--headless");
    expect(h).toContain("--convert-to");
  });

  it("uses utf-8 encoding in spawnSync", () => {
    const h = SKILL_TEMPLATES["libre-convert"].handler;
    expect(h).toContain('"utf-8"');
  });
});

// ─── DOC_TEMPLATES_README ───────────────────────────────────────────────────

describe("DOC_TEMPLATES_README content", () => {
  it("can extract DOC_TEMPLATES_README from source", () => {
    expect(DOC_TEMPLATES_README).not.toBeNull();
    expect(typeof DOC_TEMPLATES_README).toBe("string");
    expect(DOC_TEMPLATES_README.length).toBeGreaterThan(200);
  });

  it("documents doc-generate and libre-convert usage", () => {
    expect(DOC_TEMPLATES_README).toContain("doc-generate");
    expect(DOC_TEMPLATES_README).toContain("libre-convert");
  });

  it("mentions cli-anything integration for LibreOffice and pandoc", () => {
    expect(DOC_TEMPLATES_README).toContain("cli-anything");
    expect(DOC_TEMPLATES_README).toContain("soffice");
    expect(DOC_TEMPLATES_README).toContain("pandoc");
  });

  it("explains the design boundary between workspace skills and cli-anything", () => {
    expect(DOC_TEMPLATES_README).toContain("设计边界");
  });

  it("shows custom template usage example", () => {
    expect(DOC_TEMPLATES_README).toContain("outline");
  });
});

// ─── TEMPLATES: ai-doc-creator entry ───────────────────────────────────────

describe("TEMPLATES: ai-doc-creator entry", () => {
  it("ai-doc-creator exists in TEMPLATES", () => {
    expect(TEMPLATES).toHaveProperty("ai-doc-creator");
  });

  it("has required fields", () => {
    const tmpl = TEMPLATES["ai-doc-creator"];
    expect(typeof tmpl.description).toBe("string");
    expect(typeof tmpl.rules).toBe("string");
    expect(Array.isArray(tmpl.skills)).toBe(true);
    expect(tmpl.persona).toBeDefined();
    expect(Array.isArray(tmpl.generateSkills)).toBe(true);
  });

  it("generateSkills contains doc-generate and libre-convert", () => {
    const { generateSkills } = TEMPLATES["ai-doc-creator"];
    expect(generateSkills).toContain("doc-generate");
    expect(generateSkills).toContain("libre-convert");
  });

  it("uses templates/ companion directory (not workflows/)", () => {
    const tmpl = TEMPLATES["ai-doc-creator"];
    expect(tmpl.generateDir).toBe("templates");
  });

  it("persona has correct name and role", () => {
    const { persona } = TEMPLATES["ai-doc-creator"];
    expect(persona.name).toBe("AI文档助手");
    expect(typeof persona.role).toBe("string");
    expect(persona.role).toContain("文档");
    expect(Array.isArray(persona.behaviors)).toBe(true);
    expect(persona.behaviors.length).toBeGreaterThanOrEqual(3);
  });

  it("rules.md explains LibreOffice is suitable for cli-anything", () => {
    const { rules } = TEMPLATES["ai-doc-creator"];
    expect(rules).toContain("cli-anything");
    expect(rules).toContain("soffice");
    // rules should say LibreOffice IS suitable (opposite of ComfyUI)
    expect(rules).toMatch(/cli-anything.*注册|注册.*cli-anything/);
  });

  it("rules.md mentions pandoc as docx conversion tool", () => {
    const { rules } = TEMPLATES["ai-doc-creator"];
    expect(rules).toContain("pandoc");
  });

  it("all 9 templates exist (8 named + empty)", () => {
    const expected = [
      "code-project",
      "data-science",
      "devops",
      "medical-triage",
      "agriculture-expert",
      "general-assistant",
      "ai-media-creator",
      "ai-doc-creator",
      "empty",
    ];
    for (const key of expected) {
      expect(TEMPLATES).toHaveProperty(key);
    }
  });

  it("generateSkills contains doc-edit", () => {
    const { generateSkills } = TEMPLATES["ai-doc-creator"];
    expect(generateSkills).toContain("doc-edit");
  });

  it("rules.md mentions doc-edit skill", () => {
    const { rules } = TEMPLATES["ai-doc-creator"];
    expect(rules).toContain("doc-edit");
  });
});

// ─── SKILL_TEMPLATES: doc-edit ──────────────────────────────────────────────

describe("SKILL_TEMPLATES: doc-edit SKILL.md", () => {
  it("doc-edit entry exists in SKILL_TEMPLATES", () => {
    expect(SKILL_TEMPLATES).not.toBeNull();
    expect(SKILL_TEMPLATES).toHaveProperty("doc-edit");
  });

  it("has md and handler strings", () => {
    const { md, handler } = SKILL_TEMPLATES["doc-edit"];
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(200);
    expect(typeof handler).toBe("string");
    expect(handler.length).toBeGreaterThan(500);
  });

  it("YAML frontmatter has required fields", () => {
    const fm = parseYamlFrontmatter(SKILL_TEMPLATES["doc-edit"].md);
    expect(fm).not.toBeNull();
    expect(fm.name).toBe("doc-edit");
    expect(fm.category).toBe("document");
    expect(fm["execution-mode"]).toBe("direct");
    expect(fm.version).toBe("1.0.0");
    expect(fm.description).toBeTruthy();
  });

  it("input_file and instruction are required parameters", () => {
    const md = SKILL_TEMPLATES["doc-edit"].md;
    expect(md).toContain("input_file");
    expect(md).toContain("instruction");
    expect(md).toContain("required: [input_file, instruction]");
  });

  it("documents action enum with all 3 values", () => {
    const md = SKILL_TEMPLATES["doc-edit"].md;
    expect(md).toContain("edit");
    expect(md).toContain("append");
    expect(md).toContain("rewrite-section");
  });

  it("documents all 6 supported formats (md/txt/html/docx/xlsx/pptx)", () => {
    const md = SKILL_TEMPLATES["doc-edit"].md;
    expect(md).toContain("md");
    expect(md).toContain("txt");
    expect(md).toContain("html");
    expect(md).toContain("docx");
    expect(md).toContain("xlsx");
    expect(md).toContain("pptx");
  });

  it("mentions openpyxl and python-pptx installation hints", () => {
    const md = SKILL_TEMPLATES["doc-edit"].md;
    expect(md).toContain("openpyxl");
    expect(md).toContain("python-pptx");
    expect(md).toContain("pip install");
  });

  it("explains _edited output naming convention (no overwrite)", () => {
    const md = SKILL_TEMPLATES["doc-edit"].md;
    expect(md).toContain("_edited");
  });
});

describe("SKILL_TEMPLATES: doc-edit handler.js", () => {
  it("handler.js is valid JavaScript", () => {
    expect(isValidJS(SKILL_TEMPLATES["doc-edit"].handler)).toBe(true);
  });

  it("uses module.exports async function", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("module.exports");
    expect(h).toContain("async function");
  });

  it("validates input_file parameter", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("Missing required parameter: input_file");
  });

  it("validates instruction parameter", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("Missing required parameter: instruction");
  });

  it("checks input file existence", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("Input file not found:");
    expect(h).toContain("existsSync(input_file)");
  });

  it("routes xlsx to Python openpyxl handler", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("openpyxl");
    expect(h).toContain("data_only=False");
  });

  it("routes pptx to Python python-pptx handler", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("python-pptx");
    expect(h).toContain("from pptx import Presentation");
  });

  it("includes detectPython function", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("detectPython");
    expect(h).toContain("python3");
  });

  it("includes checkPythonModule function", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("checkPythonModule");
  });

  it("output uses _edited naming (never overwrites original)", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("_edited");
    expect(h).toContain("buildOutputPath");
  });

  it("uses utf-8 encoding throughout", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain('"utf-8"');
  });

  it("handles unsupported format with structured error and hint", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("不支持的格式");
    expect(h).toContain("hint");
  });

  it("xlsx handler provides pip install hint when openpyxl missing", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("pip install openpyxl");
  });

  it("pptx handler provides pip install hint when python-pptx missing", () => {
    const h = SKILL_TEMPLATES["doc-edit"].handler;
    expect(h).toContain("pip install python-pptx");
  });
});
