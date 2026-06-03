/**
 * Media Metadata Skill Handler
 *
 * Extract metadata from images, audio, and video files.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Type Detection ──────────────────────────────────

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tiff",
  ".tif",
  ".bmp",
  ".svg",
]);
const AUDIO_EXTS = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".ogg",
  ".aac",
  ".wma",
]);
const VIDEO_EXTS = new Set([
  ".mp4",
  ".avi",
  ".mkv",
  ".mov",
  ".webm",
  ".wmv",
  ".flv",
  ".m4v",
]);

function detectMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    return "image";
  }
  if (AUDIO_EXTS.has(ext)) {
    return "audio";
  }
  if (VIDEO_EXTS.has(ext)) {
    return "video";
  }
  return "unknown";
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

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

// ── Metadata Extractors ─────────────────────────────

async function extractImageMeta(filePath) {
  try {
    const sharp = require("sharp");
    const image = sharp(filePath);
    const meta = await image.metadata();
    const stat = fs.statSync(filePath);

    return {
      type: "image",
      file: path.basename(filePath),
      width: meta.width,
      height: meta.height,
      format: meta.format,
      space: meta.space,
      channels: meta.channels,
      depth: meta.depth,
      density: meta.density,
      hasAlpha: meta.hasAlpha,
      orientation: meta.orientation,
      fileSize: stat.size,
      fileSizeFormatted: formatBytes(stat.size),
      exif: meta.exif ? "present" : "none",
    };
  } catch (err) {
    return {
      type: "image",
      file: path.basename(filePath),
      error: `Sharp error: ${err.message}`,
      fileSize: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
    };
  }
}

function extractAudioMeta(filePath) {
  return new Promise((resolve) => {
    try {
      const ffmpeg = require("fluent-ffmpeg");
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          resolve({
            type: "audio",
            file: path.basename(filePath),
            error: `ffprobe error: ${err.message}`,
          });
          return;
        }

        const audio = metadata.streams.find((s) => s.codec_type === "audio");
        resolve({
          type: "audio",
          file: path.basename(filePath),
          duration: metadata.format.duration,
          durationFormatted: formatDuration(metadata.format.duration),
          codec: audio ? audio.codec_name : "unknown",
          sampleRate: audio ? parseInt(audio.sample_rate) : 0,
          channels: audio ? audio.channels : 0,
          bitrate: metadata.format.bit_rate
            ? parseInt(metadata.format.bit_rate)
            : 0,
          bitrateFormatted: metadata.format.bit_rate
            ? `${Math.round(parseInt(metadata.format.bit_rate) / 1000)} kbps`
            : "N/A",
          format: metadata.format.format_name,
          fileSize: parseInt(metadata.format.size) || 0,
          fileSizeFormatted: formatBytes(metadata.format.size),
          tags: metadata.format.tags || {},
        });
      });
    } catch (err) {
      resolve({
        type: "audio",
        file: path.basename(filePath),
        error: `ffmpeg not available: ${err.message}`,
      });
    }
  });
}

function extractVideoMeta(filePath) {
  return new Promise((resolve) => {
    try {
      const ffmpeg = require("fluent-ffmpeg");
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          resolve({
            type: "video",
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
          type: "video",
          file: path.basename(filePath),
          duration: metadata.format.duration,
          durationFormatted: formatDuration(metadata.format.duration),
          format: metadata.format.format_name,
          fileSize: parseInt(metadata.format.size) || 0,
          fileSizeFormatted: formatBytes(metadata.format.size),
          bitrate: metadata.format.bit_rate
            ? parseInt(metadata.format.bit_rate)
            : 0,
          video: video
            ? {
                codec: video.codec_name,
                width: video.width,
                height: video.height,
                fps: video.r_frame_rate
                  ? parseFloat(
                      video.r_frame_rate.includes("/")
                        ? video.r_frame_rate
                            .split("/")
                            .reduce((a, b) => Number(a) / Number(b))
                        : Number(video.r_frame_rate),
                    ).toFixed(1)
                  : "N/A",
                bitrate: video.bit_rate
                  ? `${Math.round(parseInt(video.bit_rate) / 1000)} kbps`
                  : "N/A",
              }
            : null,
          audio: audio
            ? {
                codec: audio.codec_name,
                sampleRate: audio.sample_rate,
                channels: audio.channels,
                bitrate: audio.bit_rate
                  ? `${Math.round(parseInt(audio.bit_rate) / 1000)} kbps`
                  : "N/A",
              }
            : null,
          subtitleTracks: subs.length,
          tags: metadata.format.tags || {},
        });
      });
    } catch (err) {
      resolve({
        type: "video",
        file: path.basename(filePath),
        error: `ffmpeg not available: ${err.message}`,
      });
    }
  });
}

async function extractMeta(filePath) {
  const type = detectMediaType(filePath);
  switch (type) {
    case "image":
      return await extractImageMeta(filePath);
    case "audio":
      return await extractAudioMeta(filePath);
    case "video":
      return await extractVideoMeta(filePath);
    default:
      return {
        type: "unknown",
        file: path.basename(filePath),
        error: "Unsupported media type",
      };
  }
}

// ── Formatters ──────────────────────────────────────

function formatImageTable(meta) {
  if (meta.error) {
    return `**${meta.file}**: ${meta.error}`;
  }
  return `## Image: ${meta.file}\n\n| Property | Value |\n|----------|-------|\n| Dimensions | ${meta.width} × ${meta.height} |\n| Format | ${meta.format} |\n| Color Space | ${meta.space} |\n| Channels | ${meta.channels} |\n| Depth | ${meta.depth} |\n| DPI | ${meta.density || "N/A"} |\n| Alpha | ${meta.hasAlpha ? "Yes" : "No"} |\n| Orientation | ${meta.orientation || "Normal"} |\n| EXIF | ${meta.exif} |\n| File Size | ${meta.fileSizeFormatted} |`;
}

function formatAudioTable(meta) {
  if (meta.error) {
    return `**${meta.file}**: ${meta.error}`;
  }
  return `## Audio: ${meta.file}\n\n| Property | Value |\n|----------|-------|\n| Duration | ${meta.durationFormatted} |\n| Codec | ${meta.codec} |\n| Sample Rate | ${meta.sampleRate} Hz |\n| Channels | ${meta.channels} |\n| Bitrate | ${meta.bitrateFormatted} |\n| Format | ${meta.format} |\n| Size | ${meta.fileSizeFormatted} |${meta.tags.title ? `\n| Title | ${meta.tags.title} |` : ""}${meta.tags.artist ? `\n| Artist | ${meta.tags.artist} |` : ""}`;
}

function formatVideoTable(meta) {
  if (meta.error) {
    return `**${meta.file}**: ${meta.error}`;
  }
  return `## Video: ${meta.file}\n\n| Property | Value |\n|----------|-------|\n| Duration | ${meta.durationFormatted} |\n| Size | ${meta.fileSizeFormatted} |\n| Format | ${meta.format} |${meta.video ? `\n| Resolution | ${meta.video.width}×${meta.video.height} |\n| FPS | ${meta.video.fps} |\n| Video Codec | ${meta.video.codec} |` : ""}${meta.audio ? `\n| Audio Codec | ${meta.audio.codec} |\n| Audio Channels | ${meta.audio.channels} |` : ""}\n| Subtitles | ${meta.subtitleTracks} tracks |`;
}

function formatMeta(meta) {
  switch (meta.type) {
    case "image":
      return formatImageTable(meta);
    case "audio":
      return formatAudioTable(meta);
    case "video":
      return formatVideoTable(meta);
    default:
      return `**${meta.file}**: Unknown type`;
  }
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[media-metadata] handler initialized for "${skill?.name || "media-metadata"}"`,
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
          "## Media Metadata\n\nUsage:\n- `--extract <file>` — Auto-detect and extract\n- `--image <file>` — Image metadata\n- `--audio <file>` — Audio metadata\n- `--video <file>` — Video metadata\n- `--batch <dir>` — Batch extract\n\nSupported: jpg, png, gif, webp, mp3, wav, flac, mp4, avi, mkv, mov",
      };
    }

    try {
      const actionMatch = input.match(/^--(\w[\w-]*)/);
      const action = actionMatch ? actionMatch[1] : "extract";

      if (action === "batch") {
        const dirMatch = input.match(/--batch\s+(\S+)/);
        if (!dirMatch) {
          return {
            success: false,
            error: "No directory",
            message: "Usage: --batch <dir>",
          };
        }

        const dir = resolvePath(dirMatch[1], projectRoot);
        if (!fs.existsSync(dir)) {
          return {
            success: false,
            error: "Directory not found",
            message: `Not found: ${dir}`,
          };
        }

        const allExts = new Set([...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS]);
        const files = fs
          .readdirSync(dir)
          .filter((f) => allExts.has(path.extname(f).toLowerCase()));

        const results = [];
        for (const file of files.slice(0, 30)) {
          const meta = await extractMeta(path.join(dir, file));
          results.push(meta);
        }

        const byType = { image: 0, audio: 0, video: 0 };
        results.forEach((r) => {
          if (byType[r.type] !== undefined) {
            byType[r.type]++;
          }
        });

        return {
          success: true,
          result: {
            dir: path.basename(dir),
            count: results.length,
            byType,
            files: results,
          },
          message: `## Batch Metadata: ${path.basename(dir)}\n\n**${results.length} files**: ${byType.image} images, ${byType.audio} audio, ${byType.video} video\n\n${results
            .slice(0, 10)
            .map(
              (r) =>
                `- **${r.file}** (${r.type}): ${r.error || (r.type === "image" ? `${r.width}×${r.height} ${r.format}` : r.durationFormatted || "")}`,
            )
            .join(
              "\n",
            )}${results.length > 10 ? `\n- ... and ${results.length - 10} more` : ""}`,
        };
      }

      // Single file extraction
      const fileMatch =
        input.match(/--(?:extract|image|audio|video)\s+(\S+)/) ||
        input.match(/(\S+\.\w+)/);
      if (!fileMatch) {
        return {
          success: false,
          error: "No file",
          message: "Please provide a media file.",
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

      // Force type if specified
      let meta;
      if (action === "image") {
        meta = await extractImageMeta(filePath);
      } else if (action === "audio") {
        meta = await extractAudioMeta(filePath);
      } else if (action === "video") {
        meta = await extractVideoMeta(filePath);
      } else {
        meta = await extractMeta(filePath);
      }

      const formatMatch = input.match(/--format\s+(\S+)/);
      if (formatMatch && formatMatch[1] === "json") {
        return {
          success: true,
          result: meta,
          message: `\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\``,
        };
      }

      return {
        success: !meta.error,
        result: meta,
        message: formatMeta(meta),
      };
    } catch (error) {
      logger.error(`[media-metadata] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Metadata extraction failed: ${error.message}`,
      };
    }
  },
};
