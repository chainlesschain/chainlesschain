/**
 * PPTX Creator Skill Handler
 *
 * Creates PowerPoint presentations from outlines, Markdown, or templates.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Theme Definitions ───────────────────────────────

const THEMES = {
  professional: {
    bgColor: "FFFFFF",
    titleColor: "1a365d",
    textColor: "2d3748",
    accentColor: "3182ce",
    fontFace: "Arial",
    titleFontSize: 36,
    bodyFontSize: 18,
  },
  dark: {
    bgColor: "1a202c",
    titleColor: "e2e8f0",
    textColor: "a0aec0",
    accentColor: "63b3ed",
    fontFace: "Arial",
    titleFontSize: 36,
    bodyFontSize: 18,
  },
  minimal: {
    bgColor: "FAFAFA",
    titleColor: "333333",
    textColor: "555555",
    accentColor: "888888",
    fontFace: "Helvetica",
    titleFontSize: 32,
    bodyFontSize: 16,
  },
  colorful: {
    bgColor: "FFF5F5",
    titleColor: "C53030",
    textColor: "2D3748",
    accentColor: "E53E3E",
    fontFace: "Arial",
    titleFontSize: 36,
    bodyFontSize: 18,
  },
};

// ── Markdown Parser ─────────────────────────────────

function parseMarkdownToSlides(text) {
  const lines = text.split("\n");
  const slides = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("# ")) {
      // Title slide
      current = { type: "title", title: trimmed.substring(2), bullets: [] };
      slides.push(current);
    } else if (trimmed.startsWith("## ")) {
      // Content slide
      current = { type: "content", title: trimmed.substring(3), bullets: [] };
      slides.push(current);
    } else if (trimmed.startsWith("### ")) {
      // Sub-content slide
      current = { type: "content", title: trimmed.substring(4), bullets: [] };
      slides.push(current);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (current) {
        current.bullets.push(trimmed.substring(2));
      }
    } else if (trimmed.match(/^\d+\.\s/)) {
      if (current) {
        current.bullets.push(trimmed.replace(/^\d+\.\s/, ""));
      }
    } else {
      if (current) {
        current.bullets.push(trimmed);
      }
    }
  }

  return slides;
}

// ── PPTX Generation ─────────────────────────────────

async function createPresentation(slides, themeName, outputPath) {
  const PptxGenJS = require("pptxgenjs");
  const theme = THEMES[themeName] || THEMES.professional;
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ChainlessChain AI";

  for (const slideData of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.bgColor };

    if (slideData.type === "title") {
      slide.addText(slideData.title, {
        x: 0.5,
        y: 1.5,
        w: "90%",
        h: 1.5,
        fontSize: theme.titleFontSize + 8,
        fontFace: theme.fontFace,
        color: theme.titleColor,
        bold: true,
        align: "center",
        valign: "middle",
      });

      if (slideData.bullets.length > 0) {
        slide.addText(slideData.bullets.join("\n"), {
          x: 1,
          y: 3.5,
          w: "80%",
          h: 1,
          fontSize: theme.bodyFontSize,
          fontFace: theme.fontFace,
          color: theme.textColor,
          align: "center",
        });
      }
    } else {
      // Content slide
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.3,
        w: "90%",
        h: 0.8,
        fontSize: theme.titleFontSize,
        fontFace: theme.fontFace,
        color: theme.titleColor,
        bold: true,
      });

      if (slideData.bullets.length > 0) {
        const bulletText = slideData.bullets.map((b) => ({
          text: b,
          options: { bullet: true, paraSpaceBefore: 6 },
        }));

        slide.addText(bulletText, {
          x: 0.8,
          y: 1.5,
          w: "85%",
          h: 4,
          fontSize: theme.bodyFontSize,
          fontFace: theme.fontFace,
          color: theme.textColor,
          valign: "top",
        });
      }
    }
  }

  if (outputPath) {
    await pptx.writeFile({ fileName: outputPath });
  }

  return {
    slides: slides.length,
    theme: themeName,
    outputPath: outputPath || null,
  };
}

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[pptx-creator] handler initialized for "${skill?.name || "pptx-creator"}"`,
    );
  },

  async execute(task, context, skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    if (!input) {
      return {
        success: true,
        result: { usage: true },
        message:
          "## PPTX Creator\n\nUsage:\n- `--create <outline> [--output file.pptx] [--template theme]`\n- `--from-md <file.md> [--output file.pptx]`\n- `--list-templates`\n\nTemplates: professional, dark, minimal, colorful",
      };
    }

    try {
      // Parse options
      const templateMatch = input.match(/--template\s+(\S+)/);
      const outputMatch = input.match(/--output\s+(\S+)/);
      const themeName = templateMatch ? templateMatch[1] : "professional";
      const outputPath = outputMatch
        ? resolvePath(outputMatch[1], projectRoot)
        : null;

      if (input.includes("--list-templates") || input.includes("--list")) {
        return {
          success: true,
          result: { templates: Object.keys(THEMES) },
          message: `## Available Templates\n\n${Object.entries(THEMES)
            .map(
              ([name, t]) =>
                `- **${name}**: bg=#${t.bgColor}, title=#${t.titleColor}, font=${t.fontFace}`,
            )
            .join("\n")}`,
        };
      }

      if (input.includes("--from-md")) {
        const fileMatch = input.match(/--from-md\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file specified",
            message: "Usage: --from-md <file.md>",
          };
        }

        const filePath = resolvePath(fileMatch[1], projectRoot);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found",
            message: `Not found: ${filePath}`,
          };
        }

        const md = fs.readFileSync(filePath, "utf-8");
        const slides = parseMarkdownToSlides(md);

        if (slides.length === 0) {
          return {
            success: false,
            error: "No slides parsed",
            message: "No headings found in Markdown file.",
          };
        }

        const result = await createPresentation(slides, themeName, outputPath);
        return {
          success: true,
          result: { ...result, source: path.basename(filePath) },
          message: `## Presentation Created\n\n- **Source**: ${path.basename(filePath)}\n- **Slides**: ${result.slides}\n- **Theme**: ${result.theme}\n${outputPath ? `- **Output**: ${path.basename(outputPath)}` : "- **Output**: (in-memory, specify --output to save)"}\n\n### Slide Titles\n${slides.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}`,
        };
      }

      // --create from inline text
      const createMatch =
        input.match(/--create\s+"([^"]+)"/) ||
        input.match(/--create\s+(.+?)(?:\s+--|\s*$)/);
      const outlineText = createMatch
        ? createMatch[1]
        : input.replace(/--\w+\s+\S+/g, "").trim();

      if (!outlineText) {
        return {
          success: false,
          error: "No outline provided",
          message: "Provide outline text or use --from-md",
        };
      }

      // If plain text without headings, auto-structure
      let slides;
      if (outlineText.includes("#")) {
        slides = parseMarkdownToSlides(outlineText);
      } else {
        // Auto-create: first line = title, rest = bullets
        const lines = outlineText
          .split(/[,;\n]/)
          .map((l) => l.trim())
          .filter(Boolean);
        slides = [
          { type: "title", title: lines[0], bullets: [] },
          ...(lines.length > 1
            ? [{ type: "content", title: "Overview", bullets: lines.slice(1) }]
            : []),
        ];
      }

      const result = await createPresentation(slides, themeName, outputPath);
      return {
        success: true,
        result,
        message: `## Presentation Created\n\n- **Slides**: ${result.slides}\n- **Theme**: ${result.theme}\n${outputPath ? `- **Output**: ${path.basename(outputPath)}` : "- **Output**: (in-memory, specify --output to save)"}\n\n### Slide Titles\n${slides.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}`,
      };
    } catch (error) {
      logger.error(`[pptx-creator] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `PPTX creation failed: ${error.message}`,
      };
    }
  },
};
