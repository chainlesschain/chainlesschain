/**
 * Notion 导入器
 * 解析 Notion 导出的 ZIP 文件（Markdown + CSV 格式），转换为内部笔记格式
 */

const { logger } = require("../utils/logger.js");
const path = require("path");

class NotionImporter {
  constructor(database) {
    this.database = database;
  }

  /**
   * Import from Notion export ZIP buffer
   * @param {Buffer} zipBuffer - ZIP file buffer
   * @param {string} targetFolder - Target folder for imported notes
   * @returns {Object} Import result with counts
   */
  async importFromZip(zipBuffer, targetFolder = "Notion Import") {
    const AdmZip = require("adm-zip"); // lazy require
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    const result = { imported: 0, skipped: 0, errors: [], files: [] };

    for (const entry of entries) {
      if (entry.isDirectory) {
        continue;
      }

      const ext = path.extname(entry.entryName).toLowerCase();
      try {
        if (ext === ".md" || ext === ".markdown") {
          const content = entry.getData().toString("utf8");
          const title = this._extractTitle(entry.entryName, content);
          const parsed = this._parseNotionMarkdown(content);

          const noteId = this._saveNote({
            title,
            content: parsed.content,
            folder: targetFolder,
            tags: parsed.tags,
            source: "notion",
            sourceFile: entry.entryName,
          });

          result.imported++;
          result.files.push({ name: entry.entryName, noteId });
        } else if (ext === ".csv") {
          const csvContent = entry.getData().toString("utf8");
          const rows = this._parseCSV(csvContent);
          for (const row of rows) {
            if (row.Name || row.Title) {
              this._saveNote({
                title: row.Name || row.Title,
                content: this._csvRowToMarkdown(row),
                folder: targetFolder + "/Database",
                tags: row.Tags ? row.Tags.split(",").map((t) => t.trim()) : [],
                source: "notion-csv",
                sourceFile: entry.entryName,
              });
              result.imported++;
            }
          }
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.errors.push({ file: entry.entryName, error: error.message });
      }
    }

    logger.info(
      `[NotionImporter] Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} errors`,
    );
    return result;
  }

  _extractTitle(filePath, content) {
    // Try to get title from first H1
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      return h1Match[1].trim();
    }

    // Fall back to filename without Notion hash suffix
    const basename = path.basename(filePath, path.extname(filePath));
    // Notion adds a hash like "Page Title abc123def456"
    return basename.replace(/\s+[a-f0-9]{32}$/, "").trim() || basename;
  }

  _parseNotionMarkdown(content) {
    const tags = [];
    let cleanContent = content;

    // Extract Notion properties block (if any)
    const propsMatch = content.match(/^((?:.*?:\s*.*\n)+)\n/);
    if (propsMatch) {
      const propsBlock = propsMatch[1];
      const tagsLine = propsBlock.match(/Tags?:\s*(.+)/i);
      if (tagsLine) {
        tags.push(
          ...tagsLine[1]
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        );
      }
      cleanContent = content.slice(propsMatch[0].length);
    }

    return { content: cleanContent.trim(), tags };
  }

  _parseCSV(csvContent) {
    const lines = csvContent.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      return [];
    }

    const headers = this._splitCSVLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this._splitCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = (values[idx] || "").trim();
      });
      rows.push(row);
    }

    return rows;
  }

  _splitCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  _csvRowToMarkdown(row) {
    const lines = [];
    for (const [key, value] of Object.entries(row)) {
      if (key && value) {
        lines.push(`**${key}**: ${value}`);
      }
    }
    return lines.join("\n\n");
  }

  _saveNote({ title, content, folder, tags, source, sourceFile }) {
    const { v4: uuidv4 } = require("uuid");
    const id = uuidv4();
    const now = Date.now();

    const db = this.database.db;
    db.prepare(
      `
      INSERT OR IGNORE INTO notes (id, title, content, folder, tags, source, source_file, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      title,
      content,
      folder,
      JSON.stringify(tags || []),
      source,
      sourceFile,
      now,
      now,
    );

    return id;
  }
}

module.exports = { NotionImporter };
