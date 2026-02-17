/**
 * Audio Transcriber Skill Handler
 *
 * Speech-to-text transcription using Whisper API or local engines.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Audio Info ──────────────────────────────────────

function getAudioInfo(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const ffmpeg = require("fluent-ffmpeg");
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          resolve({
            file: path.basename(filePath),
            size: fs.statSync(filePath).size,
            error: `ffprobe error: ${err.message}`,
          });
          return;
        }

        const audio = metadata.streams.find((s) => s.codec_type === "audio");
        resolve({
          file: path.basename(filePath),
          duration: metadata.format.duration,
          durationFormatted: formatDuration(metadata.format.duration || 0),
          codec: audio ? audio.codec_name : "unknown",
          sampleRate: audio ? audio.sample_rate : 0,
          channels: audio ? audio.channels : 0,
          bitrate: metadata.format.bit_rate,
          size: metadata.format.size,
          format: metadata.format.format_name,
        });
      });
    } catch (err) {
      resolve({
        file: path.basename(filePath),
        size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
        error: `ffmpeg not available: ${err.message}`,
      });
    }
  });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Provider Detection ──────────────────────────────

function detectProviders() {
  const providers = [];

  if (process.env.OPENAI_API_KEY) {
    providers.push({
      name: "whisper-api",
      available: true,
      description: "OpenAI Whisper API",
    });
  } else {
    providers.push({
      name: "whisper-api",
      available: false,
      description: "Set OPENAI_API_KEY to enable",
    });
  }

  // Check for local whisper
  try {
    const { execSync } = require("child_process");
    execSync("whisper --help", { stdio: "pipe" });
    providers.push({
      name: "local-whisper",
      available: true,
      description: "Local Whisper CLI",
    });
  } catch {
    providers.push({
      name: "local-whisper",
      available: false,
      description: "Install whisper locally",
    });
  }

  return providers;
}

// ── Transcription ───────────────────────────────────

async function transcribeWithAPI(filePath, language) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      error: "OPENAI_API_KEY not set. Configure it to use Whisper API.",
    };
  }

  try {
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer]);
    formData.append("file", blob, path.basename(filePath));
    formData.append("model", "whisper-1");
    if (language) {
      formData.append("language", language);
    }
    formData.append("response_format", "verbose_json");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      return { error: `Whisper API error (${response.status}): ${errText}` };
    }

    const data = await response.json();
    return {
      text: data.text,
      language: data.language,
      duration: data.duration,
      segments: data.segments || [],
    };
  } catch (err) {
    return { error: `API request failed: ${err.message}` };
  }
}

async function transcribeLocal(filePath, language) {
  try {
    const { execSync } = require("child_process");
    const langFlag = language ? `--language ${language}` : "";
    const output = execSync(
      `whisper "${filePath}" --output_format json ${langFlag}`,
      {
        encoding: "utf-8",
        timeout: 300000,
      },
    );
    const result = JSON.parse(output);
    return { text: result.text, segments: result.segments || [] };
  } catch (err) {
    return { error: `Local whisper failed: ${err.message}` };
  }
}

// ── Output Formatters ───────────────────────────────

function formatAsSRT(segments) {
  return segments
    .map((seg, i) => {
      const start = formatSRTTime(seg.start || 0);
      const end = formatSRTTime(seg.end || 0);
      return `${i + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
    })
    .join("\n");
}

function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
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
      `[audio-transcriber] handler initialized for "${skill?.name || "audio-transcriber"}"`,
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
          "## Audio Transcriber\n\nUsage:\n- `--transcribe <file> [--format txt|srt|json] [--language en]`\n- `--info <file>` — Audio file info\n- `--providers` — List available providers",
      };
    }

    try {
      if (input.includes("--providers")) {
        const providers = detectProviders();
        return {
          success: true,
          result: { providers },
          message: `## Transcription Providers\n\n${providers.map((p) => `- **${p.name}**: ${p.available ? "✅" : "❌"} ${p.description}`).join("\n")}`,
        };
      }

      if (input.includes("--info")) {
        const fileMatch = input.match(/--info\s+(\S+)/);
        if (!fileMatch) {
          return {
            success: false,
            error: "No file",
            message: "Usage: --info <file>",
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

        const info = await getAudioInfo(filePath);
        return {
          success: true,
          result: info,
          message: info.error
            ? `## Audio Info: ${info.file}\n\n**Size**: ${formatBytes(info.size)}\n\n⚠️ ${info.error}`
            : `## Audio Info: ${info.file}\n\n| Property | Value |\n|----------|-------|\n| Duration | ${info.durationFormatted} |\n| Codec | ${info.codec} |\n| Sample Rate | ${info.sampleRate} Hz |\n| Channels | ${info.channels} |\n| Bitrate | ${Math.round((info.bitrate || 0) / 1000)} kbps |\n| Size | ${formatBytes(info.size)} |\n| Format | ${info.format} |`,
        };
      }

      // --transcribe
      const fileMatch =
        input.match(/--transcribe\s+(\S+)/) || input.match(/(\S+\.\w+)/);
      if (!fileMatch) {
        return {
          success: false,
          error: "No file specified",
          message: "Usage: --transcribe <file>",
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
      const langMatch = input.match(/--language\s+(\S+)/);
      const outputFormat = formatMatch ? formatMatch[1] : "txt";
      const language = langMatch ? langMatch[1] : null;

      // Try providers in order
      const providers = detectProviders();
      const available = providers.filter((p) => p.available);

      let result;
      if (available.find((p) => p.name === "whisper-api")) {
        result = await transcribeWithAPI(filePath, language);
      } else if (available.find((p) => p.name === "local-whisper")) {
        result = await transcribeLocal(filePath, language);
      } else {
        const info = await getAudioInfo(filePath);
        return {
          success: true,
          result: { info, providers },
          message: `## Transcription Not Available\n\nNo transcription provider is configured.\n\n**Audio file**: ${path.basename(filePath)} (${info.durationFormatted || "unknown duration"})\n\n### Setup Options\n1. Set \`OPENAI_API_KEY\` environment variable for Whisper API\n2. Install whisper CLI locally\n\nThe audio file has been analyzed and is ready for transcription once a provider is configured.`,
        };
      }

      if (result.error) {
        return { success: false, error: result.error, message: result.error };
      }

      let output;
      switch (outputFormat) {
        case "srt":
          output =
            result.segments.length > 0
              ? formatAsSRT(result.segments)
              : result.text;
          break;
        case "json":
          output = JSON.stringify(result, null, 2);
          break;
        default:
          output = result.text;
      }

      return {
        success: true,
        result: {
          text: result.text,
          language: result.language,
          segments: result.segments?.length || 0,
        },
        message: `## Transcription Complete\n\n**Language**: ${result.language || "auto"}\n**Duration**: ${result.duration ? formatDuration(result.duration) : "N/A"}\n**Segments**: ${result.segments?.length || 0}\n\n### Output (${outputFormat})\n\`\`\`\n${output.substring(0, 3000)}${output.length > 3000 ? "\n... (truncated)" : ""}\n\`\`\``,
      };
    } catch (error) {
      logger.error(`[audio-transcriber] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Transcription failed: ${error.message}`,
      };
    }
  },
};
