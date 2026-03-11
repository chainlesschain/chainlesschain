/**
 * Knowledge exporter — export notes to Markdown files or static HTML site.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * Ensure the notes table exists
 */
function ensureNotesTable(db) {
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
 * Fetch all active notes from the database.
 */
export function fetchNotes(db, { category, tag, limit } = {}) {
  ensureNotesTable(db);

  let sql = "SELECT * FROM notes WHERE deleted_at IS NULL";
  const params = [];

  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }

  sql += " ORDER BY created_at DESC";

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  let notes = db.prepare(sql).all(...params);

  // Filter by tag in-memory
  if (tag) {
    notes = notes.filter((n) => {
      try {
        const tags = JSON.parse(n.tags || "[]");
        return tags.includes(tag);
      } catch {
        return false;
      }
    });
  }

  return notes;
}

/**
 * Sanitize a filename (remove invalid characters).
 */
export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 200);
}

// ─── Markdown Export ────────────────────────────────────────────────

/**
 * Convert a note to markdown with YAML frontmatter.
 */
export function noteToMarkdown(note) {
  const tags = JSON.parse(note.tags || "[]");
  const lines = [
    "---",
    `title: "${note.title.replace(/"/g, '\\"')}"`,
    `category: ${note.category || "general"}`,
    `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    `date: ${note.created_at || ""}`,
    `id: ${note.id}`,
    "---",
    "",
    `# ${note.title}`,
    "",
    note.content || "",
  ];

  return lines.join("\n");
}

/**
 * Export notes to a directory as individual markdown files.
 * Groups notes by category into subdirectories.
 */
export function exportToMarkdown(db, outputDir, options = {}) {
  const notes = fetchNotes(db, options);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const exported = [];

  for (const note of notes) {
    const category = note.category || "general";
    const catDir = join(outputDir, sanitizeFilename(category));
    if (!existsSync(catDir)) {
      mkdirSync(catDir, { recursive: true });
    }

    const filename = `${sanitizeFilename(note.title)}.md`;
    const filePath = join(catDir, filename);
    const markdown = noteToMarkdown(note);

    writeFileSync(filePath, markdown, "utf-8");
    exported.push({
      id: note.id,
      title: note.title,
      path: `${category}/${filename}`,
    });
  }

  return exported;
}

// ─── Static HTML Site Export ────────────────────────────────────────

/**
 * Generate a minimal HTML page for a note.
 */
export function noteToHtml(note) {
  const tags = JSON.parse(note.tags || "[]");
  const tagsHtml = tags
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join(" ");
  const contentHtml = markdownToSimpleHtml(note.content || "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(note.title)}</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <nav><a href="../index.html">Home</a></nav>
  <article>
    <h1>${escapeHtml(note.title)}</h1>
    <div class="meta">
      <time>${note.created_at || ""}</time>
      <span class="category">${escapeHtml(note.category || "general")}</span>
      ${tagsHtml}
    </div>
    <div class="content">${contentHtml}</div>
  </article>
</body>
</html>`;
}

/**
 * Generate the index page listing all notes.
 */
export function generateIndexHtml(
  notes,
  siteTitle = "ChainlessChain Knowledge Base",
) {
  const noteLinks = notes
    .map((n) => {
      const tags = JSON.parse(n.tags || "[]");
      const tagsHtml = tags
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join(" ");
      const cat = sanitizeFilename(n.category || "general");
      const file = sanitizeFilename(n.title) + ".html";
      return `<li>
        <a href="${cat}/${file}">${escapeHtml(n.title)}</a>
        <span class="category">${escapeHtml(n.category || "general")}</span>
        ${tagsHtml}
        <time>${n.created_at || ""}</time>
      </li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header><h1>${escapeHtml(siteTitle)}</h1></header>
  <main>
    <p>${notes.length} notes</p>
    <ul class="note-list">${noteLinks}</ul>
  </main>
</body>
</html>`;
}

/**
 * Generate a minimal CSS stylesheet.
 */
export function generateStyleCss() {
  return `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #333; line-height: 1.6; }
nav { margin-bottom: 2rem; }
nav a { color: #0066cc; text-decoration: none; }
h1 { margin-bottom: 1rem; }
.meta { color: #666; margin-bottom: 1.5rem; font-size: 0.9rem; }
.tag { background: #e8f0fe; color: #1a73e8; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; margin-right: 4px; }
.category { color: #5f6368; margin-right: 8px; }
.content { line-height: 1.8; }
.content p { margin-bottom: 1rem; }
.content pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; margin-bottom: 1rem; }
.content code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
.note-list { list-style: none; }
.note-list li { padding: 0.75rem 0; border-bottom: 1px solid #eee; }
.note-list a { color: #1a73e8; text-decoration: none; font-weight: 500; margin-right: 8px; }
time { color: #999; font-size: 0.85rem; }
header { border-bottom: 2px solid #1a73e8; padding-bottom: 1rem; margin-bottom: 2rem; }`;
}

/**
 * Export notes as a static HTML site.
 */
export function exportToSite(db, outputDir, options = {}) {
  const notes = fetchNotes(db, options);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write CSS
  writeFileSync(join(outputDir, "style.css"), generateStyleCss(), "utf-8");

  // Write index
  writeFileSync(
    join(outputDir, "index.html"),
    generateIndexHtml(notes, options.title),
    "utf-8",
  );

  // Write individual pages
  const exported = [];
  for (const note of notes) {
    const category = note.category || "general";
    const catDir = join(outputDir, sanitizeFilename(category));
    if (!existsSync(catDir)) {
      mkdirSync(catDir, { recursive: true });
    }

    const filename = `${sanitizeFilename(note.title)}.html`;
    const filePath = join(catDir, filename);
    writeFileSync(filePath, noteToHtml(note), "utf-8");

    exported.push({
      id: note.id,
      title: note.title,
      path: `${sanitizeFilename(category)}/${filename}`,
    });
  }

  return exported;
}

// ─── Helpers ────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Very simple markdown→HTML for note content.
 * Handles headings, paragraphs, code blocks, bold, italic, links.
 */
function markdownToSimpleHtml(md) {
  return md
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}
