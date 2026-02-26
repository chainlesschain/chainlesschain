/**
 * Evernote 导入器
 * 解析 Evernote 导出的 .enex XML 格式文件
 */

const { logger } = require("../utils/logger.js");

class EvernoteImporter {
  constructor(database) {
    this.database = database;
  }

  /**
   * Import from .enex file content
   * @param {string|Buffer} enexContent - ENEX file content
   * @param {string} targetFolder - Target folder
   * @returns {Object} Import result
   */
  async importFromEnex(enexContent, targetFolder = "Evernote Import") {
    const content = Buffer.isBuffer(enexContent)
      ? enexContent.toString("utf8")
      : enexContent;
    const result = { imported: 0, skipped: 0, errors: [], attachments: 0 };

    // Parse notes from ENEX XML
    const notes = this._parseEnexXml(content);

    for (const note of notes) {
      try {
        const markdown = this._enmlToMarkdown(note.content);

        this._saveNote({
          title: note.title,
          content: markdown,
          folder: targetFolder,
          tags: note.tags,
          source: "evernote",
          createdAt: note.created
            ? this._parseEnexDate(note.created)
            : Date.now(),
          updatedAt: note.updated
            ? this._parseEnexDate(note.updated)
            : Date.now(),
        });

        result.imported++;
        result.attachments += (note.resources || []).length;
      } catch (error) {
        result.errors.push({ title: note.title, error: error.message });
      }
    }

    logger.info(
      `[EvernoteImporter] Import complete: ${result.imported} notes, ${result.attachments} attachments`,
    );
    return result;
  }

  _parseEnexXml(xml) {
    const notes = [];
    const noteRegex = /<note>([\s\S]*?)<\/note>/gi;
    let match;

    while ((match = noteRegex.exec(xml)) !== null) {
      const noteXml = match[1];
      const note = {
        title: this._extractTag(noteXml, "title") || "Untitled",
        content: this._extractTag(noteXml, "content") || "",
        created: this._extractTag(noteXml, "created"),
        updated: this._extractTag(noteXml, "updated"),
        tags: [],
        resources: [],
      };

      // Extract tags
      const tagRegex = /<tag>(.*?)<\/tag>/gi;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(noteXml)) !== null) {
        note.tags.push(tagMatch[1].trim());
      }

      // Count resources (attachments)
      const resourceRegex = /<resource>/gi;
      while (resourceRegex.exec(noteXml) !== null) {
        note.resources.push({});
      }

      notes.push(note);
    }

    return notes;
  }

  _extractTag(xml, tagName) {
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i");
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  _enmlToMarkdown(enml) {
    if (!enml) {
      return "";
    }

    // Remove CDATA wrapper
    let html = enml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

    // Remove en-note wrapper
    html = html.replace(/<\/?en-note[^>]*>/gi, "");

    // Convert common HTML to markdown
    html = html.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n");
    html = html.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n");
    html = html.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n");
    html = html.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
    html = html.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
    html = html.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
    html = html.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
    html = html.replace(/<br\s*\/?>/gi, "\n");
    html = html.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
    html = html.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
    html = html.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");

    // Handle checkboxes (en-todo)
    html = html.replace(/<en-todo\s+checked="true"\s*\/?>/gi, "- [x] ");
    html = html.replace(/<en-todo\s*\/?>/gi, "- [ ] ");

    // Remove remaining HTML tags
    html = html.replace(/<[^>]+>/g, "");

    // Clean up whitespace
    html = html.replace(/\n{3,}/g, "\n\n");

    // Decode HTML entities
    html = html.replace(/&amp;/g, "&");
    html = html.replace(/&lt;/g, "<");
    html = html.replace(/&gt;/g, ">");
    html = html.replace(/&quot;/g, '"');
    html = html.replace(/&#39;/g, "'");
    html = html.replace(/&nbsp;/g, " ");

    return html.trim();
  }

  _parseEnexDate(dateStr) {
    if (!dateStr) {
      return Date.now();
    }
    // Evernote date format: 20130502T075520Z
    const match = dateStr.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
    if (match) {
      return new Date(
        `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
      ).getTime();
    }
    return Date.now();
  }

  _saveNote({ title, content, folder, tags, source, createdAt, updatedAt }) {
    const { v4: uuidv4 } = require("uuid");
    const id = uuidv4();

    const db = this.database.db;
    db.prepare(
      `
      INSERT OR IGNORE INTO notes (id, title, content, folder, tags, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      title,
      content,
      folder,
      JSON.stringify(tags || []),
      source,
      createdAt,
      updatedAt,
    );

    return id;
  }
}

module.exports = { EvernoteImporter };
