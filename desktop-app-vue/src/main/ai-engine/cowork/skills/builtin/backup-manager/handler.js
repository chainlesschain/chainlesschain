/**
 * Backup Manager Skill Handler
 *
 * Backup and restore application data (database, config, memory, skills)
 * with ZIP archives in .chainlesschain/backups/.
 * Uses archiver for ZIP creation and adm-zip for reading/extraction.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Constants ──────────────────────────────────────

const CFG = ".chainlesschain";
const VALID_ITEMS = ["db", "config", "memory", "skills"];
const ITEM_PATHS = {
  db: "data",
  config: CFG,
  memory: path.join(CFG, "memory"),
  skills: path.join(CFG, "skills"),
};

// ── Helpers ────────────────────────────────────────

function fmtBytes(b) {
  if (!b) {
    return "0 B";
  }
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function fmtDate(d) {
  const t = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function backupsDir(root) {
  return path.join(root, CFG, "backups");
}

function filesRecursive(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const res = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "backups") {
        res.push(...filesRecursive(fp));
      }
    } else {
      res.push(fp);
    }
  }
  return res;
}

function parseInput(input) {
  const parts = (input || "").trim().split(/\s+/);
  const f = {
    action: null,
    name: null,
    items: null,
    file: null,
    keep: 5,
    interval: null,
  };

  for (let i = 0; i < parts.length; i++) {
    const v = parts[i];
    if (v === "--create" || v === "create") {
      f.action = "create";
    } else if (v === "--list" || v === "list") {
      f.action = "list";
    } else if (v === "--restore" || v === "restore") {
      f.action = "restore";
      if (parts[i + 1] && !parts[i + 1].startsWith("--")) {
        f.file = parts[++i];
      }
    } else if (v === "--info" || v === "info") {
      f.action = "info";
      if (parts[i + 1] && !parts[i + 1].startsWith("--")) {
        f.file = parts[++i];
      }
    } else if (v === "--clean" || v === "clean") {
      f.action = "clean";
    } else if (v === "--schedule" || v === "schedule") {
      f.action = "schedule";
    } else if (v === "--name" && parts[i + 1]) {
      f.name = parts[++i];
    } else if (v === "--items" && parts[i + 1]) {
      f.items = parts[++i].split(",").filter(Boolean);
    } else if (v === "--keep") {
      const n = parseInt(parts[++i], 10);
      if (n > 0) {
        f.keep = n;
      }
    } else if (v === "--interval") {
      const n = parseInt(parts[++i], 10);
      if (n > 0) {
        f.interval = n;
      }
    }
  }
  return f;
}

function resolveZip(file, root) {
  if (!file) {
    return null;
  }
  return path.isAbsolute(file) ? file : path.join(backupsDir(root), file);
}

function categorize(entryName) {
  const p = entryName.replace(/\\/g, "/");
  if (p.startsWith("data/")) {
    return "db";
  }
  if (p.startsWith(`${CFG}/memory/`)) {
    return "memory";
  }
  if (p.startsWith(`${CFG}/skills/`)) {
    return "skills";
  }
  if (p.startsWith(`${CFG}/`)) {
    return "config";
  }
  return "other";
}

// ── Create ─────────────────────────────────────────

async function createBackup(flags, root) {
  const archiver = require("archiver");
  const items = flags.items || VALID_ITEMS;
  const bad = items.filter((i) => !VALID_ITEMS.includes(i));
  if (bad.length) {
    return {
      success: false,
      error: `Invalid items: ${bad}`,
      message: `Invalid items: ${bad.join(", ")}. Valid: ${VALID_ITEMS.join(", ")}`,
    };
  }

  const dir = backupsDir(root);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const base = flags.name ? `${flags.name}-${dateStr}` : `backup-${dateStr}`;
  let fileName = `${base}.zip`,
    counter = 1;
  while (fs.existsSync(path.join(dir, fileName))) {
    fileName = `${base}-${counter++}.zip`;
  }

  const outputPath = path.join(dir, fileName);
  const ws = fs.createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  return new Promise((resolve) => {
    let fileCount = 0;
    const included = [];

    ws.on("close", () => {
      const size = archive.pointer();
      logger.info(`[backup-manager] Created: ${fileName} (${fmtBytes(size)})`);
      resolve({
        success: true,
        result: {
          file: fileName,
          path: outputPath,
          size,
          items: included,
          fileCount,
        },
        message: `## Backup Created\n\n- **File**: ${fileName}\n- **Size**: ${fmtBytes(size)}\n- **Items**: ${included.join(", ")}\n- **Files**: ${fileCount}`,
      });
    });

    archive.on("error", (err) => {
      resolve({
        success: false,
        error: err.message,
        message: `Backup failed: ${err.message}`,
      });
    });
    archive.pipe(ws);

    for (const item of items) {
      const itemPath = path.join(root, ITEM_PATHS[item]);
      if (!fs.existsSync(itemPath)) {
        continue;
      }
      if (fs.statSync(itemPath).isDirectory()) {
        for (const f of filesRecursive(itemPath)) {
          archive.file(f, { name: path.relative(root, f) });
          fileCount++;
        }
      } else {
        archive.file(itemPath, { name: path.relative(root, itemPath) });
        fileCount++;
      }
      included.push(item);
    }

    if (!fileCount) {
      archive.abort();
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
      return resolve({
        success: false,
        error: "No files",
        message: "No files found for specified items.",
      });
    }
    archive.finalize();
  });
}

// ── List ───────────────────────────────────────────

function listBackups(root) {
  const dir = backupsDir(root);
  if (!fs.existsSync(dir)) {
    return {
      success: true,
      result: { backups: [], count: 0 },
      message: "## Backups\n\nNo backups found. Use `--create` first.",
    };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".zip"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, date: st.mtime };
    })
    .sort((a, b) => b.date - a.date);

  if (!files.length) {
    return {
      success: true,
      result: { backups: [], count: 0 },
      message: "## Backups\n\nNo backup files found.",
    };
  }

  const rows = files.map(
    (f) => `| ${f.name} | ${fmtBytes(f.size)} | ${fmtDate(f.date)} |`,
  );
  return {
    success: true,
    result: { backups: files, count: files.length },
    message: `## Backups (${files.length})\n\n| Name | Size | Date |\n|------|------|------|\n${rows.join("\n")}`,
  };
}

// ── Restore ────────────────────────────────────────

function restoreBackup(file, root) {
  const zipPath = resolveZip(file, root);
  if (!zipPath) {
    return {
      success: false,
      error: "No file",
      message: "Specify a backup file. Use `--list` to see available.",
    };
  }
  if (!fs.existsSync(zipPath)) {
    return {
      success: false,
      error: "Not found",
      message: `Backup not found: ${zipPath}`,
    };
  }

  const AdmZip = require("adm-zip");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) {
    return {
      success: false,
      error: "Empty",
      message: "Backup archive is empty.",
    };
  }

  const items = new Set();
  let totalSize = 0;
  for (const e of entries) {
    items.add(categorize(e.entryName));
    totalSize += e.header.size;
  }

  zip.extractAllTo(root, true);
  logger.info(
    `[backup-manager] Restored ${entries.length} files from ${path.basename(zipPath)}`,
  );

  return {
    success: true,
    result: {
      file: path.basename(zipPath),
      fileCount: entries.length,
      totalSize,
      items: [...items],
    },
    message: `## Backup Restored\n\n- **Source**: ${path.basename(zipPath)}\n- **Files**: ${entries.length}\n- **Size**: ${fmtBytes(totalSize)}\n- **Items**: ${[...items].join(", ")}`,
  };
}

// ── Info ───────────────────────────────────────────

function backupInfo(file, root) {
  const zipPath = resolveZip(file, root);
  if (!zipPath) {
    return {
      success: false,
      error: "No file",
      message: "Specify a backup file. Use `--list` to see available.",
    };
  }
  if (!fs.existsSync(zipPath)) {
    return {
      success: false,
      error: "Not found",
      message: `Backup not found: ${zipPath}`,
    };
  }

  const AdmZip = require("adm-zip");
  const entries = new AdmZip(zipPath)
    .getEntries()
    .filter((e) => !e.isDirectory);
  const st = fs.statSync(zipPath);
  const cats = {};
  let origSize = 0,
    compSize = 0;

  for (const e of entries) {
    const cat = categorize(e.entryName);
    (cats[cat] = cats[cat] || []).push(e.entryName);
    origSize += e.header.size;
    compSize += e.header.compressedSize;
  }

  const ratio = origSize ? ((compSize / origSize) * 100).toFixed(1) : "0";
  const catRows = Object.entries(cats)
    .map(([k, v]) => `| ${k} | ${v.length} |`)
    .join("\n");
  const MAX = 30;
  const fileRows = entries
    .slice(0, MAX)
    .map((e) => `| ${e.entryName} | ${fmtBytes(e.header.size)} |`)
    .join("\n");
  const more =
    entries.length > MAX ? `\n\n*...and ${entries.length - MAX} more*` : "";

  return {
    success: true,
    result: {
      file: path.basename(zipPath),
      archiveSize: st.size,
      fileCount: entries.length,
      totalOriginal: origSize,
      totalCompressed: compSize,
      ratio: `${ratio}%`,
      date: st.mtime,
      categories: cats,
    },
    message: `## Backup Info: ${path.basename(zipPath)}\n\n| Property | Value |\n|----------|-------|\n| Archive size | ${fmtBytes(st.size)} |\n| Files | ${entries.length} |\n| Original | ${fmtBytes(origSize)} |\n| Compressed | ${fmtBytes(compSize)} |\n| Ratio | ${ratio}% |\n| Created | ${fmtDate(st.mtime)} |\n\n### Categories\n\n| Category | Count |\n|----------|-------|\n${catRows}\n\n### Contents\n\n| File | Size |\n|------|------|\n${fileRows}${more}`,
  };
}

// ── Clean ──────────────────────────────────────────

function cleanBackups(keep, root) {
  const dir = backupsDir(root);
  if (!fs.existsSync(dir)) {
    return {
      success: true,
      result: { removed: 0, kept: 0 },
      message: "## Cleanup\n\nNo backups directory.",
    };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".zip"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return {
        name: f,
        path: path.join(dir, f),
        mtime: st.mtime,
        size: st.size,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length <= keep) {
    return {
      success: true,
      result: { removed: 0, kept: files.length },
      message: `## Cleanup\n\n${files.length} backup(s), keeping ${keep}. Nothing to remove.`,
    };
  }

  const toRemove = files.slice(keep);
  let freed = 0;
  const removed = [];

  for (const f of toRemove) {
    try {
      fs.unlinkSync(f.path);
      freed += f.size;
      removed.push(f.name);
      logger.info(`[backup-manager] Removed: ${f.name}`);
    } catch (err) {
      logger.error(`[backup-manager] Remove failed: ${err.message}`);
    }
  }

  return {
    success: true,
    result: {
      removed: removed.length,
      kept: keep,
      freedBytes: freed,
      removedFiles: removed,
    },
    message: `## Cleanup\n\n- **Removed**: ${removed.length}\n- **Freed**: ${fmtBytes(freed)}\n- **Kept**: ${keep}${removed.length ? "\n\n" + removed.map((n) => `- ${n}`).join("\n") : ""}`,
  };
}

// ── Schedule ───────────────────────────────────────

function scheduleSuggestion(interval) {
  const hours = interval || 24;
  const cron =
    hours >= 24 ? `0 2 */${Math.floor(hours / 24)} * *` : `0 */${hours} * * *`;

  const hookCfg = {
    event: "SessionStart",
    type: "script",
    script: `${CFG}/hooks/auto-backup.js`,
    description: `Auto-backup every ${hours}h`,
    priority: 900,
  };
  const script = [
    `// Auto-backup hook — place in ${CFG}/hooks/auto-backup.js`,
    `const INTERVAL = ${hours} * 3600000;`,
    "module.exports = async (ctx) => {",
    '  const last = ctx.store?.get("lastAutoBackup") || 0;',
    "  if (Date.now() - last < INTERVAL) return;",
    '  ctx.store?.set("lastAutoBackup", Date.now());',
    '  return { action: "backup-manager --create --name auto --items db,config,memory" };',
    "};",
  ].join("\n");

  return {
    success: true,
    result: { interval: hours, cron, hookCfg, script },
    message: `## Auto-Backup Schedule\n\n**Interval**: ${hours}h | **Cron**: \`${cron}\`\n\n### hooks.json entry\n\n\`\`\`json\n${JSON.stringify(hookCfg, null, 2)}\n\`\`\`\n\n### Hook script\n\n\`\`\`javascript\n${script}\n\`\`\``,
  };
}

// ── Main Handler ───────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[backup-manager] handler initialized for "${skill?.name || "backup-manager"}"`,
    );
  },

  async execute(task, context, _skill) {
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
        message: `## Backup Manager\n\nUsage:\n- \`--create [--name <name>] [--items db,config,memory,skills]\` -- Create backup\n- \`--list\` -- List backups\n- \`--restore <file>\` -- Restore from backup\n- \`--info <file>\` -- Show backup details\n- \`--clean [--keep <n>]\` -- Remove old backups (default: keep 5)\n- \`--schedule [--interval <hours>]\` -- Auto-backup config\n\nValid items: ${VALID_ITEMS.join(", ")}`,
      };
    }

    try {
      const flags = parseInput(input);
      switch (flags.action) {
        case "create":
          return await createBackup(flags, projectRoot);
        case "list":
          return listBackups(projectRoot);
        case "restore":
          return restoreBackup(flags.file, projectRoot);
        case "info":
          return backupInfo(flags.file, projectRoot);
        case "clean":
          return cleanBackups(flags.keep, projectRoot);
        case "schedule":
          return scheduleSuggestion(flags.interval);
        default:
          return {
            success: false,
            error: `Unknown: ${flags.action}`,
            message:
              "Use --create, --list, --restore, --info, --clean, or --schedule.",
          };
      }
    } catch (error) {
      logger.error(`[backup-manager] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Backup operation failed: ${error.message}`,
      };
    }
  },
};
