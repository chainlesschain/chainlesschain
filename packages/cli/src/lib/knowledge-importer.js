/**
 * Knowledge importer — parse Markdown, Evernote ENEX, and Notion exports
 * into the notes table.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename, extname, relative } from "path";

/**
 * Ensure the notes table exists
 */
export function ensureNotesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT DEFAULT NULL
    )
  `);
}

/**
 * Generate a simple UUID-like ID
 */
function generateId() {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * Insert a note into the database
 */
export function insertNote(db, { title, content, tags, category, createdAt }) {
  const id = generateId();
  const tagsJson = JSON.stringify(tags || []);
  const cat = category || "general";
  const created =
    createdAt || new Date().toISOString().replace("T", " ").slice(0, 19);

  db.prepare(
    "INSERT INTO notes (id, title, content, tags, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, title, content || "", tagsJson, cat, created, created);

  return { id, title, tags: tags || [], category: cat, created_at: created };
}

// ─── Markdown Import ────────────────────────────────────────────────

/**
 * Parse a single markdown file into a note object.
 * Extracts YAML frontmatter if present.
 */
export function parseMarkdownFile(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  const name = basename(filePath, extname(filePath));

  let title = name;
  let content = raw;
  let tags = [];
  let category = "markdown";
  let createdAt = null;

  // Try to extract YAML frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    content = fmMatch[2].trim();

    // Parse simple YAML fields
    const titleMatch = frontmatter.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) title = titleMatch[1];

    const tagsMatch = frontmatter.match(/^tags:\s*\[([^\]]*)\]/m);
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/["']/g, ""))
        .filter(Boolean);
    }

    const catMatch = frontmatter.match(/^category:\s*["']?(.+?)["']?\s*$/m);
    if (catMatch) category = catMatch[1];

    const dateMatch = frontmatter.match(/^date:\s*["']?(.+?)["']?\s*$/m);
    if (dateMatch) createdAt = dateMatch[1];
  }

  // Use first H1 as title if no frontmatter title
  if (title === name && !fmMatch) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1];
  }

  return { title, content, tags, category, createdAt };
}

/**
 * Recursively collect all .md files from a directory.
 */
export function collectMarkdownFiles(dir) {
  const results = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (extname(entry).toLowerCase() === ".md") {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Import all markdown files from a directory into the database.
 */
export function importMarkdownDir(db, dir) {
  ensureNotesTable(db);
  const files = collectMarkdownFiles(dir);
  const imported = [];

  for (const file of files) {
    const parsed = parseMarkdownFile(file);
    const note = insertNote(db, parsed);
    note.source = relative(dir, file);
    imported.push(note);
  }

  return imported;
}

// ─── Evernote ENEX Import ───────────────────────────────────────────

/**
 * Parse an ENEX (Evernote Export) XML string into note objects.
 * ENEX format: <en-export><note><title>...</title><content>...</content><tag>...</tag></note>...</en-export>
 */
export function parseEnex(xmlString) {
  const notes = [];
  const noteRegex = /<note>([\s\S]*?)<\/note>/gi;
  let noteMatch;

  while ((noteMatch = noteRegex.exec(xmlString)) !== null) {
    const noteXml = noteMatch[1];

    const titleMatch = noteXml.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    // Content is wrapped in CDATA inside <content>
    const contentMatch = noteXml.match(/<content>([\s\S]*?)<\/content>/i);
    let content = "";
    if (contentMatch) {
      let raw = contentMatch[1];
      // Strip CDATA wrapper
      const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      if (cdataMatch) raw = cdataMatch[1];
      // Strip ENML/HTML tags for plain text
      content = stripHtml(raw);
    }

    // Tags
    const tags = [];
    const tagRegex = /<tag>([\s\S]*?)<\/tag>/gi;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(noteXml)) !== null) {
      tags.push(tagMatch[1].trim());
    }

    // Created date
    const createdMatch = noteXml.match(/<created>([\s\S]*?)<\/created>/i);
    let createdAt = null;
    if (createdMatch) {
      // ENEX dates: 20210315T120000Z → 2021-03-15 12:00:00
      const d = createdMatch[1].trim();
      const parsed = d.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
      if (parsed) {
        createdAt = `${parsed[1]}-${parsed[2]}-${parsed[3]} ${parsed[4]}:${parsed[5]}:${parsed[6]}`;
      }
    }

    notes.push({ title, content, tags, category: "evernote", createdAt });
  }

  return notes;
}

/**
 * Strip HTML/ENML tags to plain text.
 */
export function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Import an Evernote ENEX file into the database.
 */
export function importEnexFile(db, filePath) {
  ensureNotesTable(db);
  const xmlString = readFileSync(filePath, "utf-8");
  const parsed = parseEnex(xmlString);
  const imported = [];

  for (const note of parsed) {
    const result = insertNote(db, note);
    imported.push(result);
  }

  return imported;
}

// ─── Notion Export Import ───────────────────────────────────────────

/**
 * Parse a Notion export directory.
 * Notion exports contain markdown files and may have metadata in filenames
 * or accompanying JSON/CSV files.
 */
export function parseNotionExport(dir) {
  const notes = [];
  const files = collectMarkdownFiles(dir);

  for (const file of files) {
    const raw = readFileSync(file, "utf-8");
    const fileName = basename(file, ".md");

    // Notion filenames often have a UUID suffix: "My Page abc123def456"
    // Remove the hex suffix to get the clean title
    const title = fileName.replace(/\s+[a-f0-9]{32}$/i, "") || fileName;

    // Notion uses # for the first heading, which is usually the page title
    let content = raw;
    const h1Match = raw.match(/^#\s+(.+)\n([\s\S]*)$/);
    if (h1Match) {
      content = h1Match[2].trim();
    }

    // Try to detect tags from Notion properties (sometimes at the top)
    const tags = [];
    const relPath = relative(dir, file);
    const parts = relPath.split(/[/\\]/);
    if (parts.length > 1) {
      // Use parent folder as a tag
      tags.push(parts[0]);
    }

    notes.push({ title, content, tags, category: "notion", createdAt: null });
  }

  return notes;
}

/**
 * Import a Notion export directory into the database.
 */
export function importNotionDir(db, dir) {
  ensureNotesTable(db);
  const parsed = parseNotionExport(dir);
  const imported = [];

  for (const note of parsed) {
    const result = insertNote(db, note);
    imported.push(result);
  }

  return imported;
}
