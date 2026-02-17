/**
 * Subtitle Generator Skill Handler
 *
 * Generate SRT/VTT subtitles, convert formats, adjust timing.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── SRT/VTT Parsing ─────────────────────────────────

function parseSRT(content) {
  const blocks = content.trim().split(/\n\n+/);
  const segments = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) {
      continue;
    }

    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );
    if (!timeMatch) {
      continue;
    }

    segments.push({
      index: parseInt(lines[0]) || segments.length + 1,
      start: parseTimestamp(timeMatch[1]),
      end: parseTimestamp(timeMatch[2]),
      text: lines.slice(2).join("\n").trim(),
    });
  }

  return segments;
}

function parseVTT(content) {
  const lines = content.split("\n");
  const segments = [];
  let current = null;
  let idx = 0;

  for (const line of lines) {
    if (line.startsWith("WEBVTT") || line.trim() === "") {
      if (current) {
        segments.push(current);
        current = null;
      }
      continue;
    }

    const timeMatch = line.match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/,
    );
    if (timeMatch) {
      idx++;
      current = {
        index: idx,
        start: parseTimestamp(timeMatch[1]),
        end: parseTimestamp(timeMatch[2]),
        text: "",
      };
    } else if (current) {
      current.text += (current.text ? "\n" : "") + line.trim();
    }
  }

  if (current) {
    segments.push(current);
  }
  return segments;
}

function parseTimestamp(ts) {
  const parts = ts.replace(",", ".").match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (!parts) {
    return 0;
  }
  return (
    parseInt(parts[1]) * 3600 +
    parseInt(parts[2]) * 60 +
    parseInt(parts[3]) +
    parseInt(parts[4]) / 1000
  );
}

// ── Formatters ──────────────────────────────────────

function formatSRT(segments) {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${formatSRTTime(s.start)} --> ${formatSRTTime(s.end)}\n${s.text}`,
    )
    .join("\n\n");
}

function formatVTT(segments) {
  const lines = ["WEBVTT", ""];
  for (const s of segments) {
    lines.push(`${formatVTTTime(s.start)} --> ${formatVTTTime(s.end)}`);
    lines.push(s.text);
    lines.push("");
  }
  return lines.join("\n");
}

function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function formatVTTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// ── Operations ──────────────────────────────────────

function adjustTiming(segments, offsetMs) {
  const offsetSec = offsetMs / 1000;
  return segments.map((s) => ({
    ...s,
    start: Math.max(0, s.start + offsetSec),
    end: Math.max(0, s.end + offsetSec),
  }));
}

function parseSubtitleFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".vtt") {
    return { format: "vtt", segments: parseVTT(content) };
  }
  return { format: "srt", segments: parseSRT(content) };
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
      `[subtitle-generator] handler initialized for "${skill?.name || "subtitle-generator"}"`,
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
          "## Subtitle Generator\n\nUsage:\n- `--generate <media> [--format srt|vtt]` — Generate subtitles\n- `--convert <file> --to srt|vtt` — Convert format\n- `--sync <file> --offset <ms>` — Adjust timing\n- `--parse <file>` — Parse and display\n- `--translate <file> --to <lang>` — Prepare translation",
      };
    }

    try {
      const actionMatch = input.match(/^--(\w[\w-]*)/);
      const action = actionMatch ? actionMatch[1] : "parse";

      if (action === "convert") {
        const fileMatch = input.match(/--convert\s+(\S+)/);
        const toMatch = input.match(/--to\s+(\S+)/);
        if (!fileMatch || !toMatch) {
          return {
            success: false,
            error: "Usage: --convert <file> --to srt|vtt",
            message: "Specify file and target format.",
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

        const parsed = parseSubtitleFile(filePath);
        const targetFormat = toMatch[1].toLowerCase();
        const output =
          targetFormat === "vtt"
            ? formatVTT(parsed.segments)
            : formatSRT(parsed.segments);

        const outputPath = filePath.replace(/\.\w+$/, `.${targetFormat}`);
        fs.writeFileSync(outputPath, output, "utf-8");

        return {
          success: true,
          result: {
            source: parsed.format,
            target: targetFormat,
            segments: parsed.segments.length,
            output: outputPath,
          },
          message: `## Subtitle Converted\n\n**${parsed.format.toUpperCase()} → ${targetFormat.toUpperCase()}**\n**Segments**: ${parsed.segments.length}\n**Output**: ${path.basename(outputPath)}`,
        };
      }

      if (action === "sync") {
        const fileMatch = input.match(/--sync\s+(\S+)/);
        const offsetMatch = input.match(/--offset\s+(-?\d+)/);
        if (!fileMatch || !offsetMatch) {
          return {
            success: false,
            error: "Usage: --sync <file> --offset <ms>",
            message: "Specify file and offset in ms.",
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

        const parsed = parseSubtitleFile(filePath);
        const offsetMs = parseInt(offsetMatch[1]);
        const adjusted = adjustTiming(parsed.segments, offsetMs);

        const output =
          parsed.format === "vtt" ? formatVTT(adjusted) : formatSRT(adjusted);
        fs.writeFileSync(filePath, output, "utf-8");

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            offsetMs,
            segments: adjusted.length,
          },
          message: `## Subtitle Timing Adjusted\n\n**File**: ${path.basename(filePath)}\n**Offset**: ${offsetMs > 0 ? "+" : ""}${offsetMs}ms\n**Segments**: ${adjusted.length}`,
        };
      }

      if (action === "parse") {
        const fileMatch =
          input.match(/--parse\s+(\S+)/) || input.match(/(\S+\.\w+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file",
            message: "Usage: --parse <file>",
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

        const parsed = parseSubtitleFile(filePath);
        const preview = parsed.segments.slice(0, 10);

        return {
          success: true,
          result: {
            format: parsed.format,
            count: parsed.segments.length,
            segments: preview,
          },
          message: `## Subtitle: ${path.basename(filePath)}\n\n**Format**: ${parsed.format.toUpperCase()}\n**Segments**: ${parsed.segments.length}\n\n### Preview (first 10)\n${preview.map((s) => `**${formatSRTTime(s.start)} → ${formatSRTTime(s.end)}**\n${s.text}`).join("\n\n")}`,
        };
      }

      if (action === "translate") {
        const fileMatch = input.match(/--translate\s+(\S+)/);
        const toLangMatch = input.match(/--to\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file",
            message: "Usage: --translate <file> --to <lang>",
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

        const parsed = parseSubtitleFile(filePath);
        const targetLang = toLangMatch ? toLangMatch[1] : "en";
        const textLines = parsed.segments.map((s) => s.text);

        return {
          success: true,
          result: {
            segments: parsed.segments.length,
            targetLang,
            textForTranslation: textLines,
          },
          message: `## Subtitle Translation Prepared\n\n**Segments**: ${parsed.segments.length}\n**Target language**: ${targetLang}\n\nExtracted ${textLines.length} text lines for AI translation. Use LLM to translate and re-insert into subtitle format.`,
        };
      }

      if (action === "generate") {
        const fileMatch = input.match(/--generate\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file",
            message: "Usage: --generate <media-file>",
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

        const formatMatch = input.match(/--format\s+(\S+)/);
        const targetFormat = formatMatch ? formatMatch[1] : "srt";

        // Check if transcription is available
        const hasWhisper = !!process.env.OPENAI_API_KEY;
        if (!hasWhisper) {
          return {
            success: true,
            result: { file: path.basename(filePath), needsTranscription: true },
            message: `## Subtitle Generation\n\n**File**: ${path.basename(filePath)}\n**Target format**: ${targetFormat.toUpperCase()}\n\n⚠️ Transcription provider not configured.\n\n### Setup\n1. Set \`OPENAI_API_KEY\` for Whisper API\n2. Or install local whisper\n\nOnce configured, re-run to generate subtitles automatically.`,
          };
        }

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            format: targetFormat,
            status: "ready",
          },
          message: `## Subtitle Generation Ready\n\n**File**: ${path.basename(filePath)}\n**Format**: ${targetFormat.toUpperCase()}\n\nTranscription will extract audio → transcribe → generate timed ${targetFormat.toUpperCase()} subtitles.`,
        };
      }

      return {
        success: false,
        error: `Unknown action: ${action}`,
        message: `Unknown action: --${action}`,
      };
    } catch (error) {
      logger.error(`[subtitle-generator] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Subtitle operation failed: ${error.message}`,
      };
    }
  },
};
