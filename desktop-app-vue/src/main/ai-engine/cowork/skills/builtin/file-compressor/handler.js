/**
 * File Compressor Skill Handler
 *
 * File compression and decompression: ZIP creation/extraction, directory
 * compression, archive listing, and size analysis.
 * Uses adm-zip for ZIP operations.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Helpers ─────────────────────────────────────────

function formatBytes(bytes) {
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

function resolvePath(input, projectRoot) {
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(projectRoot, input);
}

function getFilesRecursive(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function parseFlags(input) {
  const flags = {};
  const actionMatch = input.match(/^--(\w[\w-]*)/);
  if (actionMatch) {
    flags.action = actionMatch[1];
  }

  const outputMatch = input.match(/--output\s+(\S+)/);
  if (outputMatch) {
    flags.output = outputMatch[1];
  }

  const toMatch = input.match(/--to\s+(\S+)/);
  if (toMatch) {
    flags.to = toMatch[1];
  }

  // Collect file/directory paths (non-flag arguments)
  const cleaned = input
    .replace(/--output\s+\S+/g, "")
    .replace(/--to\s+\S+/g, "")
    .replace(/^--\w[\w-]*/, "")
    .trim();
  flags.files = cleaned.split(/\s+/).filter((f) => f && !f.startsWith("--"));

  return flags;
}

// ── Compress ────────────────────────────────────────

function compressFiles(paths, outputPath, projectRoot) {
  const AdmZip = require("adm-zip");
  const zip = new AdmZip();

  let fileCount = 0;
  let totalOriginalSize = 0;

  for (const p of paths) {
    const resolved = resolvePath(p, projectRoot);
    if (!fs.existsSync(resolved)) {
      return {
        success: false,
        error: `Path not found: ${resolved}`,
        message: `Path not found: ${resolved}`,
      };
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      const files = getFilesRecursive(resolved);
      for (const file of files) {
        const relativePath = path.relative(path.dirname(resolved), file);
        zip.addLocalFile(file, path.dirname(relativePath));
        totalOriginalSize += fs.statSync(file).size;
        fileCount++;
      }
    } else {
      zip.addLocalFile(resolved);
      totalOriginalSize += stat.size;
      fileCount++;
    }
  }

  if (fileCount === 0) {
    return {
      success: false,
      error: "No files to compress",
      message: "No files found in the specified paths.",
    };
  }

  const resolvedOutput = resolvePath(outputPath, projectRoot);
  const outputDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  zip.writeZip(resolvedOutput);

  const compressedSize = fs.statSync(resolvedOutput).size;
  const ratio =
    totalOriginalSize > 0
      ? ((compressedSize / totalOriginalSize) * 100).toFixed(1)
      : "0";

  return {
    success: true,
    result: {
      output: resolvedOutput,
      fileCount,
      originalSize: totalOriginalSize,
      compressedSize,
      ratio: `${ratio}%`,
    },
    message: `## Compressed to ${path.basename(resolvedOutput)}\n\n- **Files**: ${fileCount}\n- **Original size**: ${formatBytes(totalOriginalSize)}\n- **Compressed size**: ${formatBytes(compressedSize)}\n- **Ratio**: ${ratio}%`,
  };
}

// ── Extract ─────────────────────────────────────────

function extractArchive(zipPath, targetDir) {
  const AdmZip = require("adm-zip");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  zip.extractAllTo(targetDir, true);

  const fileEntries = entries.filter((e) => !e.isDirectory);
  let totalSize = 0;
  for (const entry of fileEntries) {
    totalSize += entry.header.size;
  }

  return {
    success: true,
    result: {
      target: targetDir,
      fileCount: fileEntries.length,
      totalSize,
    },
    message: `## Extracted ${path.basename(zipPath)}\n\n- **Files extracted**: ${fileEntries.length}\n- **Total size**: ${formatBytes(totalSize)}\n- **Target directory**: ${targetDir}`,
  };
}

// ── List ────────────────────────────────────────────

function listArchive(zipPath) {
  const AdmZip = require("adm-zip");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  const MAX_DISPLAY = 50;
  const fileEntries = entries.filter((e) => !e.isDirectory);

  const rows = fileEntries.slice(0, MAX_DISPLAY).map((entry) => {
    const method =
      entry.header.compressedSize < entry.header.size ? "deflate" : "store";
    return `| ${entry.entryName} | ${formatBytes(entry.header.size)} | ${formatBytes(entry.header.compressedSize)} | ${method} |`;
  });

  let totalCompressed = 0;
  let totalOriginal = 0;
  for (const entry of fileEntries) {
    totalCompressed += entry.header.compressedSize;
    totalOriginal += entry.header.size;
  }

  const truncated =
    fileEntries.length > MAX_DISPLAY
      ? `\n\n*... and ${fileEntries.length - MAX_DISPLAY} more entries*`
      : "";

  return {
    success: true,
    result: {
      entryCount: fileEntries.length,
      totalCompressed,
      totalOriginal,
      entries: fileEntries.slice(0, MAX_DISPLAY).map((e) => ({
        name: e.entryName,
        size: e.header.size,
        compressedSize: e.header.compressedSize,
      })),
    },
    message: `## Archive Contents: ${path.basename(zipPath)}\n\n**Entries**: ${fileEntries.length} files\n\n| Name | Original | Compressed | Method |\n|------|----------|------------|--------|\n${rows.join("\n")}${truncated}\n\n**Total**: ${formatBytes(totalOriginal)} original, ${formatBytes(totalCompressed)} compressed`,
  };
}

// ── Info ────────────────────────────────────────────

function archiveInfo(zipPath) {
  const AdmZip = require("adm-zip");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  const fileEntries = entries.filter((e) => !e.isDirectory);
  const dirEntries = entries.filter((e) => e.isDirectory);

  let totalCompressed = 0;
  let totalOriginal = 0;
  let largest = { name: "", size: 0 };
  let smallest = { name: "", size: Infinity };

  for (const entry of fileEntries) {
    totalCompressed += entry.header.compressedSize;
    totalOriginal += entry.header.size;

    if (entry.header.size > largest.size) {
      largest = { name: entry.entryName, size: entry.header.size };
    }
    if (entry.header.size < smallest.size) {
      smallest = { name: entry.entryName, size: entry.header.size };
    }
  }

  if (fileEntries.length === 0) {
    smallest = { name: "(none)", size: 0 };
  }

  const ratio =
    totalOriginal > 0
      ? ((totalCompressed / totalOriginal) * 100).toFixed(1)
      : "0";

  const archiveSize = fs.statSync(zipPath).size;

  return {
    success: true,
    result: {
      file: path.basename(zipPath),
      archiveSize,
      fileCount: fileEntries.length,
      dirCount: dirEntries.length,
      totalCompressed,
      totalOriginal,
      ratio: `${ratio}%`,
      largest,
      smallest,
    },
    message: `## ZIP Info: ${path.basename(zipPath)}\n\n| Property | Value |\n|----------|-------|\n| Archive size | ${formatBytes(archiveSize)} |\n| Files | ${fileEntries.length} |\n| Directories | ${dirEntries.length} |\n| Original size | ${formatBytes(totalOriginal)} |\n| Compressed size | ${formatBytes(totalCompressed)} |\n| Ratio | ${ratio}% |\n| Largest | ${largest.name} (${formatBytes(largest.size)}) |\n| Smallest | ${smallest.name} (${formatBytes(smallest.size)}) |`,
  };
}

// ── Main Handler ────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[file-compressor] handler initialized for "${skill?.name || "file-compressor"}"`,
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
          "## File Compressor\n\nUsage:\n- `--compress <path(s)> --output <file.zip>` — Compress files or directory\n- `--extract <file.zip> --to <dir>` — Extract ZIP archive\n- `--list <file.zip>` — List archive contents\n- `--info <file.zip>` — Show archive statistics",
      };
    }

    try {
      const flags = parseFlags(input);
      const action = flags.action || "compress";

      switch (action) {
        case "compress": {
          if (flags.files.length === 0) {
            return {
              success: false,
              error: "No input paths specified",
              message: "Please provide file or directory paths to compress.",
            };
          }
          const outputFile = flags.output || `archive-${Date.now()}.zip`;
          return compressFiles(flags.files, outputFile, projectRoot);
        }

        case "extract": {
          const firstFile = flags.files[0];
          if (!firstFile) {
            return {
              success: false,
              error: "No archive specified",
              message: "Please provide a ZIP file path to extract.",
            };
          }
          const zipPath = resolvePath(firstFile, projectRoot);
          if (!fs.existsSync(zipPath)) {
            return {
              success: false,
              error: "File not found",
              message: `Archive not found: ${zipPath}`,
            };
          }
          const targetDir = flags.to
            ? resolvePath(flags.to, projectRoot)
            : path.join(path.dirname(zipPath), path.basename(zipPath, ".zip"));
          return extractArchive(zipPath, targetDir);
        }

        case "list": {
          const firstFile = flags.files[0];
          if (!firstFile) {
            return {
              success: false,
              error: "No archive specified",
              message: "Please provide a ZIP file path to list.",
            };
          }
          const zipPath = resolvePath(firstFile, projectRoot);
          if (!fs.existsSync(zipPath)) {
            return {
              success: false,
              error: "File not found",
              message: `Archive not found: ${zipPath}`,
            };
          }
          return listArchive(zipPath);
        }

        case "info": {
          const firstFile = flags.files[0];
          if (!firstFile) {
            return {
              success: false,
              error: "No archive specified",
              message: "Please provide a ZIP file path to analyze.",
            };
          }
          const zipPath = resolvePath(firstFile, projectRoot);
          if (!fs.existsSync(zipPath)) {
            return {
              success: false,
              error: "File not found",
              message: `Archive not found: ${zipPath}`,
            };
          }
          return archiveInfo(zipPath);
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            message: `Unknown action: --${action}. Use --compress, --extract, --list, or --info.`,
          };
      }
    } catch (error) {
      logger.error(`[file-compressor] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `File compression operation failed: ${error.message}`,
      };
    }
  },
};
