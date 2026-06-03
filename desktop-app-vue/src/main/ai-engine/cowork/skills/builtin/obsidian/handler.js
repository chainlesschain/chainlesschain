/**
 * Obsidian Vault Manager Skill Handler
 */
const { logger } = require("../../../../../utils/logger.js");
const fs = require("fs");
const path = require("path");

const _deps = { fs, path };

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[Obsidian] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    const vaultPath = resolveVaultPath(context);
    if (!vaultPath) {
      return {
        success: false,
        error:
          "Obsidian vault not found. Set OBSIDIAN_VAULT_PATH environment variable or ensure vault exists in a standard location.",
      };
    }

    try {
      switch (parsed.action) {
        case "create-note":
          return handleCreateNote(vaultPath, parsed.title, parsed.options);
        case "search":
          return handleSearch(vaultPath, parsed.query, parsed.options);
        case "list-tags":
          return handleListTags(vaultPath, parsed.options);
        case "link-notes":
          return handleLinkNotes(vaultPath, parsed.source, parsed.target);
        case "list-recent":
          return handleListRecent(vaultPath, parsed.options);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Available: create-note, search, list-tags, link-notes, list-recent`,
          };
      }
    } catch (error) {
      logger.error("[Obsidian] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return {
      action: "list-recent",
      title: "",
      query: "",
      source: "",
      target: "",
      options: {},
    };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "list-recent").toLowerCase();

  const contentMatch =
    input.match(/--content\s+["']([^"']+)["']/) ||
    input.match(/--content\s+(\S+)/);
  const folderMatch = input.match(/--folder\s+(\S+)/);
  const tagsMatch = input.match(/--tags\s+(\S+)/);
  const limitMatch = input.match(/--limit\s+(\d+)/);
  const sortMatch = input.match(/--sort\s+(\S+)/);

  // Extract quoted titles
  const quotedTitles = input.match(/["']([^"']+)["']/g) || [];
  const cleanTitles = quotedTitles.map((t) => t.replace(/["']/g, ""));

  const plainParts = parts.slice(1).filter((p) => !p.startsWith("--"));
  const query = plainParts
    .filter((p) => !p.startsWith("'") && !p.startsWith('"'))
    .join(" ");

  return {
    action,
    title: cleanTitles[0] || plainParts[0] || "",
    query: query || cleanTitles[0] || "",
    source: cleanTitles[0] || plainParts[0] || "",
    target: cleanTitles[1] || plainParts[1] || "",
    options: {
      content: contentMatch ? contentMatch[1] : null,
      folder: folderMatch ? folderMatch[1] : null,
      tags: tagsMatch ? tagsMatch[1].split(",") : [],
      limit: limitMatch ? parseInt(limitMatch[1], 10) : 20,
      sort: sortMatch ? sortMatch[1] : "count",
    },
  };
}

function resolveVaultPath(context) {
  // 1. Explicit env var
  const envPath = process.env.OBSIDIAN_VAULT_PATH || context.obsidianVaultPath;
  if (envPath && _deps.fs.existsSync(envPath)) {
    return envPath;
  }

  // 2. Common locations
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    _deps.path.join(home, "Documents", "Obsidian"),
    _deps.path.join(home, "Documents", "Obsidian Vault"),
    _deps.path.join(home, "Obsidian"),
    _deps.path.join(home, "obsidian-vault"),
    _deps.path.join(home, "Notes"),
    _deps.path.join(home, "Documents", "Notes"),
  ];

  // Check for .obsidian folder (confirms it's an Obsidian vault)
  for (const candidate of candidates) {
    if (_deps.fs.existsSync(candidate)) {
      if (_deps.fs.existsSync(_deps.path.join(candidate, ".obsidian"))) {
        return candidate;
      }
      // Check subdirectories for .obsidian
      try {
        const entries = _deps.fs.readdirSync(candidate, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const sub = _deps.path.join(candidate, entry.name);
            if (_deps.fs.existsSync(_deps.path.join(sub, ".obsidian"))) {
              return sub;
            }
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  // 3. Fall back to any directory with .md files in common locations
  for (const candidate of candidates) {
    if (_deps.fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function handleCreateNote(vaultPath, title, options) {
  if (!title) {
    return { success: false, error: "Provide a note title." };
  }

  const folder = options.folder
    ? _deps.path.join(vaultPath, options.folder)
    : vaultPath;
  if (!_deps.fs.existsSync(folder)) {
    _deps.fs.mkdirSync(folder, { recursive: true });
  }

  const filename = sanitizeFilename(title) + ".md";
  const filePath = _deps.path.join(folder, filename);

  if (_deps.fs.existsSync(filePath)) {
    return {
      success: false,
      error: `Note "${title}" already exists at ${filePath}`,
    };
  }

  // Build frontmatter
  const lines = ["---"];
  lines.push(`title: "${title}"`);
  lines.push(`created: ${new Date().toISOString()}`);
  if (options.tags.length) {
    lines.push(`tags: [${options.tags.join(", ")}]`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${title}`);
  lines.push("");
  if (options.content) {
    lines.push(options.content);
  } else {
    lines.push("");
  }

  try {
    _deps.fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  } catch (err) {
    return { success: false, error: `Failed to write note: ${err.message}` };
  }

  return {
    success: true,
    action: "create-note",
    result: {
      title,
      path: filePath,
      folder: options.folder || "/",
      tags: options.tags,
    },
    message: `Note "${title}" created at ${filePath}`,
  };
}

function handleSearch(vaultPath, query, options) {
  if (!query) {
    return { success: false, error: "Provide a search query." };
  }

  const limit = options.limit || 20;
  const results = [];
  const lowerQuery = query.toLowerCase();

  walkMarkdownFiles(vaultPath, (filePath) => {
    if (results.length >= limit) {
      return;
    }

    const relativePath = _deps.path.relative(vaultPath, filePath);
    const basename = _deps.path.basename(filePath, ".md");

    // Title match (higher priority)
    const titleMatch = basename.toLowerCase().includes(lowerQuery);

    // Content match
    let contentMatch = false;
    let matchLine = null;
    let lineNumber = 0;
    try {
      const content = _deps.fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          contentMatch = true;
          matchLine = lines[i].trim().substring(0, 200);
          lineNumber = i + 1;
          break;
        }
      }
    } catch {
      /* skip unreadable */
    }

    if (titleMatch || contentMatch) {
      const stat = _deps.fs.statSync(filePath);
      results.push({
        title: basename,
        path: relativePath,
        titleMatch,
        contentMatch,
        matchLine,
        lineNumber,
        modified: stat.mtime.toISOString(),
        size: stat.size,
      });
    }
  });

  // Sort: title matches first, then by modified date
  results.sort((a, b) => {
    if (a.titleMatch && !b.titleMatch) {
      return -1;
    }
    if (!a.titleMatch && b.titleMatch) {
      return 1;
    }
    return new Date(b.modified) - new Date(a.modified);
  });

  return {
    success: true,
    action: "search",
    result: { query, results: results.slice(0, limit), total: results.length },
    message: `Found ${results.length} note(s) matching "${query}".`,
  };
}

function handleListTags(vaultPath, options) {
  const tagCounts = {};

  walkMarkdownFiles(vaultPath, (filePath) => {
    try {
      const content = _deps.fs.readFileSync(filePath, "utf-8");

      // YAML frontmatter tags
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const tagsLine = fmMatch[1].match(/tags:\s*\[([^\]]+)\]/);
        if (tagsLine) {
          tagsLine[1].split(",").forEach((t) => {
            const tag = t.trim().replace(/["']/g, "");
            if (tag) {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
          });
        }
      }

      // Inline #tags
      const inlineTags = content.match(/#([a-zA-Z0-9_-]+)/g) || [];
      for (const tag of inlineTags) {
        const clean = tag.substring(1); // Remove #
        if (clean.length > 1 && !clean.match(/^\d+$/)) {
          // Skip headings and pure numbers
          tagCounts[clean] = (tagCounts[clean] || 0) + 1;
        }
      }
    } catch {
      /* skip */
    }
  });

  const tags = Object.entries(tagCounts).map(([tag, count]) => ({
    tag,
    count,
  }));

  if (options.sort === "alpha") {
    tags.sort((a, b) => a.tag.localeCompare(b.tag));
  } else {
    tags.sort((a, b) => b.count - a.count);
  }

  return {
    success: true,
    action: "list-tags",
    result: { tags, total: tags.length },
    message: `Found ${tags.length} unique tag(s) across vault.`,
  };
}

function handleLinkNotes(vaultPath, sourceTitle, targetTitle) {
  if (!sourceTitle || !targetTitle) {
    return {
      success: false,
      error: "Provide both source and target note titles.",
    };
  }

  const sourceFile = findNoteByTitle(vaultPath, sourceTitle);
  const targetFile = findNoteByTitle(vaultPath, targetTitle);

  if (!sourceFile) {
    return {
      success: false,
      error: `Source note "${sourceTitle}" not found in vault.`,
    };
  }
  if (!targetFile) {
    return {
      success: false,
      error: `Target note "${targetTitle}" not found in vault.`,
    };
  }

  const content = _deps.fs.readFileSync(sourceFile, "utf-8");
  const wikiLink = `[[${_deps.path.basename(targetFile, ".md")}]]`;

  // Check if link already exists
  if (content.includes(wikiLink)) {
    return {
      success: true,
      action: "link-notes",
      result: { source: sourceTitle, target: targetTitle, alreadyLinked: true },
      message: `Link from "${sourceTitle}" to "${targetTitle}" already exists.`,
    };
  }

  // Append link at end of file
  const separator = content.endsWith("\n") ? "" : "\n";
  const updatedContent =
    content + separator + `\n## Related\n\n- ${wikiLink}\n`;
  try {
    _deps.fs.writeFileSync(sourceFile, updatedContent, "utf-8");
  } catch (err) {
    return { success: false, error: `Failed to update note: ${err.message}` };
  }

  return {
    success: true,
    action: "link-notes",
    result: {
      source: sourceTitle,
      target: targetTitle,
      link: wikiLink,
      sourceFile,
      targetFile,
    },
    message: `Added link ${wikiLink} from "${sourceTitle}" to "${targetTitle}".`,
  };
}

function handleListRecent(vaultPath, options) {
  const limit = options.limit || 20;
  const files = [];

  walkMarkdownFiles(vaultPath, (filePath) => {
    try {
      const stat = _deps.fs.statSync(filePath);
      files.push({
        title: _deps.path.basename(filePath, ".md"),
        path: _deps.path.relative(vaultPath, filePath),
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
        size: stat.size,
      });
    } catch {
      /* skip */
    }
  });

  files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  const recent = files.slice(0, limit);

  return {
    success: true,
    action: "list-recent",
    result: { notes: recent, total: files.length, showing: recent.length },
    message: `Showing ${recent.length} most recently modified note(s) out of ${files.length} total.`,
  };
}

function walkMarkdownFiles(dir, callback, depth = 0) {
  if (depth > 10) {
    return;
  } // Prevent infinite recursion
  try {
    const entries = _deps.fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      } // Skip hidden dirs/files
      const fullPath = _deps.path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkMarkdownFiles(fullPath, callback, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        callback(fullPath);
      }
    }
  } catch {
    /* skip inaccessible dirs */
  }
}

function findNoteByTitle(vaultPath, title) {
  const sanitized = sanitizeFilename(title);
  let found = null;

  walkMarkdownFiles(vaultPath, (filePath) => {
    if (found) {
      return;
    }
    const basename = _deps.path.basename(filePath, ".md");
    if (
      basename.toLowerCase() === sanitized.toLowerCase() ||
      basename.toLowerCase() === title.toLowerCase()
    ) {
      found = filePath;
    }
  });

  return found;
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
