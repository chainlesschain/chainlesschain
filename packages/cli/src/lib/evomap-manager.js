/**
 * EvoMap Manager — local gene management for CLI.
 *
 * Manages downloaded genes on disk, tracks installed versions,
 * and provides gene packaging for publishing.
 */

import fs from "fs";
import path from "path";

// Exported for test injection
export const _deps = {
  fs,
  path,
};

export class EvoMapManager {
  /**
   * @param {object} options
   * @param {string} options.genesDir - Directory to store downloaded genes
   * @param {object|null} options.db - Database for tracking (optional)
   */
  constructor({ genesDir, db } = {}) {
    this.genesDir = genesDir || "";
    this.db = db || null;
    this._initialized = false;
  }

  /**
   * Initialize: create directories, DB table.
   */
  initialize() {
    if (this._initialized) return;
    this._initialized = true;

    if (this.genesDir) {
      try {
        if (!_deps.fs.existsSync(this.genesDir)) {
          _deps.fs.mkdirSync(this.genesDir, { recursive: true });
        }
      } catch (_err) {
        // Non-critical
      }
    }

    if (this.db) {
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS evomap_genes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT DEFAULT '1.0.0',
            author TEXT DEFAULT '',
            description TEXT DEFAULT '',
            category TEXT DEFAULT 'general',
            source_hub TEXT DEFAULT '',
            local_path TEXT DEFAULT '',
            installed_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);
      } catch (_err) {
        // Non-critical
      }
    }
  }

  /**
   * Save a downloaded gene to disk and register in DB.
   */
  saveGene(gene, content) {
    this.initialize();
    if (!gene || !gene.id) throw new Error("Gene ID required");

    const geneDir = _deps.path.join(this.genesDir, gene.id);
    if (!_deps.fs.existsSync(geneDir)) {
      _deps.fs.mkdirSync(geneDir, { recursive: true });
    }

    // Save metadata
    _deps.fs.writeFileSync(
      _deps.path.join(geneDir, "gene.json"),
      JSON.stringify(gene, null, 2),
      "utf-8",
    );

    // Save content
    if (content) {
      _deps.fs.writeFileSync(
        _deps.path.join(geneDir, "content.md"),
        content,
        "utf-8",
      );
    }

    // Register in DB
    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO evomap_genes (id, name, version, author, description, category, source_hub, local_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            gene.id,
            gene.name || gene.id,
            gene.version || "1.0.0",
            gene.author || "",
            gene.description || "",
            gene.category || "general",
            gene.sourceHub || "",
            geneDir,
          );
      } catch (_err) {
        // Non-critical
      }
    }

    return { path: geneDir };
  }

  /**
   * List locally installed genes.
   */
  listGenes() {
    this.initialize();

    if (this.db) {
      try {
        return this.db
          .prepare("SELECT * FROM evomap_genes ORDER BY installed_at DESC")
          .all();
      } catch (_err) {
        // Fall through to file-based
      }
    }

    // File-based fallback
    if (!this.genesDir || !_deps.fs.existsSync(this.genesDir)) return [];

    try {
      const dirs = _deps.fs
        .readdirSync(this.genesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      return dirs.map((d) => {
        const metaPath = _deps.path.join(this.genesDir, d.name, "gene.json");
        try {
          const meta = JSON.parse(_deps.fs.readFileSync(metaPath, "utf-8"));
          return {
            id: d.name,
            ...meta,
            local_path: _deps.path.join(this.genesDir, d.name),
          };
        } catch {
          return {
            id: d.name,
            name: d.name,
            local_path: _deps.path.join(this.genesDir, d.name),
          };
        }
      });
    } catch (_err) {
      return [];
    }
  }

  /**
   * Get a gene by ID.
   */
  getGene(geneId) {
    this.initialize();
    const geneDir = _deps.path.join(this.genesDir, geneId);

    if (!_deps.fs.existsSync(geneDir)) return null;

    try {
      const metaPath = _deps.path.join(geneDir, "gene.json");
      const meta = JSON.parse(_deps.fs.readFileSync(metaPath, "utf-8"));
      const contentPath = _deps.path.join(geneDir, "content.md");
      const content = _deps.fs.existsSync(contentPath)
        ? _deps.fs.readFileSync(contentPath, "utf-8")
        : null;
      return { ...meta, content, local_path: geneDir };
    } catch (_err) {
      return null;
    }
  }

  /**
   * Remove a gene.
   */
  removeGene(geneId) {
    this.initialize();
    const geneDir = _deps.path.join(this.genesDir, geneId);

    if (_deps.fs.existsSync(geneDir)) {
      _deps.fs.rmSync(geneDir, { recursive: true, force: true });
    }

    if (this.db) {
      try {
        this.db.prepare("DELETE FROM evomap_genes WHERE id = ?").run(geneId);
      } catch (_err) {
        // Non-critical
      }
    }

    return { removed: true };
  }

  /**
   * Package a local skill/prompt as a gene for publishing.
   */
  packageGene({ name, description, category, content, author }) {
    return {
      id: `gene-${name}-${Date.now()}`,
      name,
      description: description || "",
      category: category || "general",
      author: author || "anonymous",
      version: "1.0.0",
      content: content || "",
      createdAt: new Date().toISOString(),
    };
  }
}
