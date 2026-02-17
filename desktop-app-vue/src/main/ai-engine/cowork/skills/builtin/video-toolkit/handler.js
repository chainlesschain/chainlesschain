/**
 * Video Toolkit Skill Handler
 *
 * Video operations: info, thumbnails, extract audio, compress, clip, convert.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Constants ───────────────────────────────────────

const COMPRESSION_PRESETS = {
  "1080p": { width: 1920, height: 1080, videoBitrate: "4000k" },
  "720p": { width: 1280, height: 720, videoBitrate: "2500k" },
  "480p": { width: 854, height: 480, videoBitrate: "1000k" },
  "360p": { width: 640, height: 360, videoBitrate: "500k" },
};

// ── Helpers ─────────────────────────────────────────

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

function formatDuration(seconds) {
  if (!seconds) {
    return "0:00";
  }
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
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Video Operations ────────────────────────────────

function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const ffmpeg = require("fluent-ffmpeg");
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          resolve({
            file: path.basename(filePath),
            error: `ffprobe error: ${err.message}`,
          });
          return;
        }

        const video = metadata.streams.find((s) => s.codec_type === "video");
        const audio = metadata.streams.find((s) => s.codec_type === "audio");
        const subs = metadata.streams.filter(
          (s) => s.codec_type === "subtitle",
        );

        resolve({
          file: path.basename(filePath),
          duration: metadata.format.duration,
          durationFormatted: formatDuration(metadata.format.duration),
          size: metadata.format.size,
          sizeFormatted: formatBytes(metadata.format.size),
          bitrate: metadata.format.bit_rate,
          format: metadata.format.format_name,
          video: video
            ? {
                codec: video.codec_name,
                width: video.width,
                height: video.height,
                fps:
                  (video.r_frame_rate && video.r_frame_rate.includes("/")
                    ? video.r_frame_rate
                        .split("/")
                        .reduce((a, b) => Number(a) / Number(b))
                    : Number(video.r_frame_rate)) || 0,
                bitrate: video.bit_rate,
              }
            : null,
          audio: audio
            ? {
                codec: audio.codec_name,
                sampleRate: audio.sample_rate,
                channels: audio.channels,
                bitrate: audio.bit_rate,
              }
            : null,
          subtitles: subs.length,
        });
      });
    } catch (err) {
      resolve({
        file: path.basename(filePath),
        error: `ffmpeg not available: ${err.message}`,
      });
    }
  });
}

function extractThumbnail(filePath, time, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = require("fluent-ffmpeg");
    const output = outputPath || filePath.replace(/\.\w+$/, "_thumb.png");

    ffmpeg(filePath)
      .seekInput(time || "00:00:01")
      .frames(1)
      .output(output)
      .on("end", () => resolve({ output, success: true }))
      .on("error", (err) => resolve({ error: err.message, success: false }))
      .run();
  });
}

function extractAudio(filePath, outputPath, format) {
  return new Promise((resolve, reject) => {
    const ffmpeg = require("fluent-ffmpeg");
    const ext = format || "mp3";
    const output = outputPath || filePath.replace(/\.\w+$/, `.${ext}`);

    ffmpeg(filePath)
      .noVideo()
      .audioCodec(
        ext === "mp3" ? "libmp3lame" : ext === "wav" ? "pcm_s16le" : "aac",
      )
      .output(output)
      .on("end", () => resolve({ output, format: ext, success: true }))
      .on("error", (err) => resolve({ error: err.message, success: false }))
      .run();
  });
}

function compressVideo(filePath, quality, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = require("fluent-ffmpeg");
    const preset = COMPRESSION_PRESETS[quality] || COMPRESSION_PRESETS["720p"];
    const output = outputPath || filePath.replace(/(\.\w+)$/, `_${quality}$1`);

    ffmpeg(filePath)
      .size(`${preset.width}x${preset.height}`)
      .videoBitrate(preset.videoBitrate)
      .output(output)
      .on("end", () => resolve({ output, quality, success: true }))
      .on("error", (err) => resolve({ error: err.message, success: false }))
      .run();
  });
}

function clipVideo(filePath, start, end, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = require("fluent-ffmpeg");
    const output = outputPath || filePath.replace(/(\.\w+)$/, `_clip$1`);

    let cmd = ffmpeg(filePath).seekInput(start);
    if (end) {
      cmd = cmd.duration(end);
    }
    cmd
      .output(output)
      .outputOptions("-c copy")
      .on("end", () => resolve({ output, start, end, success: true }))
      .on("error", (err) => resolve({ error: err.message, success: false }))
      .run();
  });
}

function convertVideo(filePath, targetFormat, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = require("fluent-ffmpeg");
    const output = outputPath || filePath.replace(/\.\w+$/, `.${targetFormat}`);

    ffmpeg(filePath)
      .output(output)
      .on("end", () => resolve({ output, format: targetFormat, success: true }))
      .on("error", (err) => resolve({ error: err.message, success: false }))
      .run();
  });
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[video-toolkit] handler initialized for "${skill?.name || "video-toolkit"}"`,
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
          "## Video Toolkit\n\nUsage:\n- `--info <file>` — Video metadata\n- `--thumbnail <file> [--time HH:MM:SS]` — Extract frame\n- `--extract-audio <file> [--format mp3]` — Extract audio\n- `--compress <file> --quality 720p` — Compress\n- `--clip <file> --start 00:01:00 --end 00:02:00` — Cut\n- `--convert <file> --to mp4` — Convert format",
      };
    }

    try {
      const actionMatch = input.match(/^--(\w[\w-]*)/);
      const action = actionMatch ? actionMatch[1] : "info";

      // Extract file path
      const cleaned = input
        .replace(/--\w[\w-]*(\s+"[^"]*"|\s+\S+)?/g, "")
        .trim();
      const fileFromAction = input.match(
        /--(?:info|thumbnail|extract-audio|compress|clip|convert)\s+(\S+)/,
      );
      const filePath = fileFromAction
        ? resolvePath(fileFromAction[1], projectRoot)
        : cleaned
          ? resolvePath(cleaned.split(/\s+/)[0], projectRoot)
          : "";

      if (!filePath || !fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found",
          message: `Video file not found: ${filePath || "(none)"}`,
        };
      }

      switch (action) {
        case "info": {
          const info = await getVideoInfo(filePath);
          if (info.error) {
            return { success: false, error: info.error, message: info.error };
          }

          return {
            success: true,
            result: info,
            message: `## Video Info: ${info.file}\n\n| Property | Value |\n|----------|-------|\n| Duration | ${info.durationFormatted} |\n| Size | ${info.sizeFormatted} |\n| Format | ${info.format} |\n| Resolution | ${info.video ? `${info.video.width}x${info.video.height}` : "N/A"} |\n| FPS | ${info.video ? info.video.fps.toFixed(1) : "N/A"} |\n| Video Codec | ${info.video ? info.video.codec : "N/A"} |\n| Audio Codec | ${info.audio ? info.audio.codec : "N/A"} |\n| Subtitles | ${info.subtitles} tracks |`,
          };
        }

        case "thumbnail": {
          const timeMatch = input.match(/--time\s+(\S+)/);
          const time = timeMatch ? timeMatch[1] : "00:00:01";
          const outputMatch = input.match(/--output\s+(\S+)/);
          const outputPath = outputMatch
            ? resolvePath(outputMatch[1], projectRoot)
            : undefined;

          const result = await extractThumbnail(filePath, time, outputPath);
          return {
            success: result.success,
            result,
            message: result.success
              ? `Thumbnail extracted at ${time} → ${path.basename(result.output)}`
              : `Thumbnail extraction failed: ${result.error}`,
          };
        }

        case "extract-audio": {
          const fmtMatch = input.match(/--format\s+(\S+)/);
          const fmt = fmtMatch ? fmtMatch[1] : "mp3";
          const outputMatch = input.match(/--output\s+(\S+)/);
          const outputPath = outputMatch
            ? resolvePath(outputMatch[1], projectRoot)
            : undefined;

          const result = await extractAudio(filePath, outputPath, fmt);
          return {
            success: result.success,
            result,
            message: result.success
              ? `Audio extracted as ${fmt} → ${path.basename(result.output)}`
              : `Audio extraction failed: ${result.error}`,
          };
        }

        case "compress": {
          const qualityMatch = input.match(/--quality\s+(\S+)/);
          const quality = qualityMatch ? qualityMatch[1] : "720p";
          const outputMatch = input.match(/--output\s+(\S+)/);
          const outputPath = outputMatch
            ? resolvePath(outputMatch[1], projectRoot)
            : undefined;

          if (!COMPRESSION_PRESETS[quality]) {
            return {
              success: false,
              error: `Unknown quality: ${quality}`,
              message: `Available presets: ${Object.keys(COMPRESSION_PRESETS).join(", ")}`,
            };
          }

          const result = await compressVideo(filePath, quality, outputPath);
          return {
            success: result.success,
            result,
            message: result.success
              ? `Compressed to ${quality} → ${path.basename(result.output)}`
              : `Compression failed: ${result.error}`,
          };
        }

        case "clip": {
          const startMatch = input.match(/--start\s+(\S+)/);
          const endMatch = input.match(/--end\s+(\S+)/);
          if (!startMatch) {
            return {
              success: false,
              error: "No start time",
              message: "Specify --start HH:MM:SS",
            };
          }

          const outputMatch = input.match(/--output\s+(\S+)/);
          const outputPath = outputMatch
            ? resolvePath(outputMatch[1], projectRoot)
            : undefined;

          const result = await clipVideo(
            filePath,
            startMatch[1],
            endMatch ? endMatch[1] : null,
            outputPath,
          );
          return {
            success: result.success,
            result,
            message: result.success
              ? `Clipped ${startMatch[1]}${endMatch ? ` to ${endMatch[1]}` : ""} → ${path.basename(result.output)}`
              : `Clip failed: ${result.error}`,
          };
        }

        case "convert": {
          const toMatch = input.match(/--to\s+(\S+)/);
          if (!toMatch) {
            return {
              success: false,
              error: "No target format",
              message: "Specify --to <format>",
            };
          }

          const outputMatch = input.match(/--output\s+(\S+)/);
          const outputPath = outputMatch
            ? resolvePath(outputMatch[1], projectRoot)
            : undefined;

          const result = await convertVideo(filePath, toMatch[1], outputPath);
          return {
            success: result.success,
            result,
            message: result.success
              ? `Converted to ${toMatch[1]} → ${path.basename(result.output)}`
              : `Conversion failed: ${result.error}`,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            message: `Unknown action: --${action}`,
          };
      }
    } catch (error) {
      logger.error(`[video-toolkit] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Video operation failed: ${error.message}`,
      };
    }
  },
};
