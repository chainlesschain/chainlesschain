/**
 * TTS Synthesizer Skill Handler
 *
 * Text-to-speech: speak text, read files, multiple voices/engines.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── TTS Manager Access ──────────────────────────────

let ttsManager = null;

function getTTS() {
  if (ttsManager) {
    return ttsManager;
  }
  try {
    const { getTTSManager } = require("../../../../../speech/tts-manager.js");
    ttsManager = getTTSManager();
    return ttsManager;
  } catch (err) {
    logger.warn(`[tts-synthesizer] TTS manager not available: ${err.message}`);
    return null;
  }
}

// ── Built-in Voice List ─────────────────────────────

const DEFAULT_VOICES = [
  { name: "en-US-JennyNeural", language: "en-US", gender: "Female" },
  { name: "en-US-GuyNeural", language: "en-US", gender: "Male" },
  { name: "en-GB-SoniaNeural", language: "en-GB", gender: "Female" },
  { name: "zh-CN-XiaoxiaoNeural", language: "zh-CN", gender: "Female" },
  { name: "zh-CN-YunxiNeural", language: "zh-CN", gender: "Male" },
  { name: "ja-JP-NanamiNeural", language: "ja-JP", gender: "Female" },
  { name: "ko-KR-SunHiNeural", language: "ko-KR", gender: "Female" },
  { name: "fr-FR-DeniseNeural", language: "fr-FR", gender: "Female" },
  { name: "de-DE-KatjaNeural", language: "de-DE", gender: "Female" },
  { name: "es-ES-ElviraNeural", language: "es-ES", gender: "Female" },
];

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
      `[tts-synthesizer] handler initialized for "${skill?.name || "tts-synthesizer"}"`,
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
          "## TTS Synthesizer\n\nUsage:\n- `--speak <text> [--voice name] [--output file]`\n- `--file <txt/md> [--voice name]`\n- `--list-voices [--language lang]`\n- `--providers`",
      };
    }

    try {
      // Parse common flags
      const voiceMatch = input.match(/--voice\s+(\S+)/);
      const outputMatch = input.match(/--output\s+(\S+)/);
      const langMatch = input.match(/--language\s+(\S+)/);
      const voice = voiceMatch ? voiceMatch[1] : null;
      const outputPath = outputMatch
        ? resolvePath(outputMatch[1], projectRoot)
        : null;
      const language = langMatch ? langMatch[1] : null;

      if (input.includes("--providers")) {
        const tts = getTTS();
        let providers = [];

        if (tts && typeof tts.checkProviders === "function") {
          try {
            providers = await tts.checkProviders();
          } catch {
            providers = [
              { name: "edge", available: false, note: "TTS manager error" },
            ];
          }
        } else {
          providers = [
            { name: "edge", available: false, note: "TTS manager not loaded" },
            { name: "local", available: false, note: "TTS manager not loaded" },
          ];
        }

        return {
          success: true,
          result: { providers },
          message: `## TTS Providers\n\n${providers.map((p) => `- **${p.name}**: ${p.available ? "Available" : p.note || "Unavailable"}`).join("\n")}`,
        };
      }

      if (input.includes("--list-voices") || input.includes("--list")) {
        const tts = getTTS();
        let voices = DEFAULT_VOICES;

        if (tts && typeof tts.getVoices === "function") {
          try {
            const fetched = await tts.getVoices(language);
            if (fetched && fetched.length > 0) {
              voices = fetched;
            }
          } catch {
            // fallback to defaults
          }
        }

        const filtered = language
          ? voices.filter((v) => v.language && v.language.startsWith(language))
          : voices;

        return {
          success: true,
          result: { voices: filtered, count: filtered.length },
          message: `## Available Voices${language ? ` (${language})` : ""}\n\n| Voice | Language | Gender |\n|-------|----------|--------|\n${filtered.map((v) => `| ${v.name} | ${v.language} | ${v.gender || "—"} |`).join("\n")}\n\n**Total**: ${filtered.length} voices`,
        };
      }

      if (input.includes("--file")) {
        const fileMatch = input.match(/--file\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file",
            message: "Usage: --file <txt/md-file>",
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

        const content = fs.readFileSync(filePath, "utf-8");
        // Strip markdown formatting for TTS
        const plainText = content
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/`[^`]+`/g, "")
          .replace(/```[\s\S]*?```/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .trim();

        const tts = getTTS();
        if (tts && typeof tts.synthesizeToFile === "function") {
          try {
            const output = outputPath || filePath.replace(/\.\w+$/, ".mp3");
            await tts.synthesizeToFile(plainText, output, { voice });
            return {
              success: true,
              result: {
                file: path.basename(filePath),
                output: path.basename(output),
                chars: plainText.length,
                voice,
              },
              message: `## TTS: File Synthesized\n\n- **Source**: ${path.basename(filePath)}\n- **Output**: ${path.basename(output)}\n- **Characters**: ${plainText.length}\n- **Voice**: ${voice || "default"}`,
            };
          } catch (err) {
            return {
              success: false,
              error: err.message,
              message: `TTS synthesis failed: ${err.message}`,
            };
          }
        }

        return {
          success: true,
          result: {
            file: path.basename(filePath),
            chars: plainText.length,
            preview: plainText.substring(0, 500),
          },
          message: `## TTS: File Ready\n\n- **Source**: ${path.basename(filePath)}\n- **Characters**: ${plainText.length}\n- **Voice**: ${voice || "default"}\n\nTTS engine not available. Text extracted and ready for synthesis.\n\n### Preview\n${plainText.substring(0, 500)}${plainText.length > 500 ? "..." : ""}`,
        };
      }

      // --speak (default)
      const textMatch =
        input.match(/--speak\s+"([^"]+)"/) ||
        input.match(/--speak\s+(.+?)(?:\s+--|\s*$)/);
      const text = textMatch
        ? textMatch[1]
        : input
            .replace(/--\w+\s+\S+/g, "")
            .replace(/^--speak\s*/, "")
            .trim();

      if (!text) {
        return {
          success: false,
          error: "No text",
          message: "Provide text to speak.",
        };
      }

      const tts = getTTS();
      if (tts && typeof tts.synthesizeToFile === "function") {
        try {
          const output = outputPath || path.join(projectRoot, "tts_output.mp3");
          await tts.synthesizeToFile(text, output, { voice });
          return {
            success: true,
            result: {
              text: text.substring(0, 200),
              output: path.basename(output),
              voice,
            },
            message: `## TTS: Speech Synthesized\n\n- **Output**: ${path.basename(output)}\n- **Voice**: ${voice || "default"}\n- **Text**: "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"`,
          };
        } catch (err) {
          return {
            success: false,
            error: err.message,
            message: `TTS synthesis failed: ${err.message}`,
          };
        }
      }

      return {
        success: true,
        result: { text: text.substring(0, 200), chars: text.length, voice },
        message: `## TTS: Text Ready\n\n- **Characters**: ${text.length}\n- **Voice**: ${voice || "default"}\n\nTTS engine not available. Configure a TTS provider to synthesize speech.\n\n### Text\n"${text.substring(0, 300)}${text.length > 300 ? "..." : ""}"`,
      };
    } catch (error) {
      logger.error(`[tts-synthesizer] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `TTS failed: ${error.message}`,
      };
    }
  },
};
