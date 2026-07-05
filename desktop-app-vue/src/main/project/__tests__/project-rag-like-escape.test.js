/**
 * ProjectRAGManager._findRelatedFiles resolves each import to candidate project
 * files with `file_name LIKE ?`. The bound pattern is built as `${baseName}%`
 * with NO escaping, so LIKE metacharacters in the import's base name act as
 * wildcards. Underscores are ubiquitous in real file names, and `_` is LIKE's
 * single-character wildcard — so an import of `./my_module` matches not only
 * `my_module.js` but also `myXmodule.js`, `my-module.js`, etc., wrongly linking
 * unrelated files into the RAG relationship graph.
 *
 * This file otherwise uses SqlSecurity.likeContains + `ESCAPE '\'` correctly for
 * its content search (line ~367); line ~1172 is a missed site. The fix escapes
 * the operands and adds `ESCAPE '\'`.
 *
 * Runs on a real in-memory better-sqlite3 with a real on-disk source file.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const Database = require("better-sqlite3");
const { MultiFileRetriever } = require("../project-rag");

function makeProjectFilesTable(sqlite) {
  sqlite.exec(`
    CREATE TABLE project_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT
    )
  `);
}

describe("ProjectRAGManager._findRelatedFiles — LIKE wildcard escaping", () => {
  let sqlite;
  let rag;
  let dir;
  let srcPath;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    makeProjectFilesTable(sqlite);

    dir = mkdtempSync(join(tmpdir(), "rag-like-"));
    srcPath = join(dir, "src.js");
    // The source imports a module whose base name contains an underscore.
    writeFileSync(srcPath, "import x from './my_module';\n", "utf-8");

    const insert = sqlite.prepare(
      "INSERT INTO project_files (id, project_id, file_name, file_path, file_type) VALUES (?,?,?,?,?)",
    );
    insert.run("src", "p1", "src.js", srcPath, "js");
    // The genuine import target.
    insert.run("intended", "p1", "my_module.js", "/proj/my_module.js", "js");
    // A decoy: the `_` in the unescaped `my_module%` pattern matches the `X`,
    // so this file is wrongly linked. Its path deliberately does NOT contain
    // "./my_module", so it can only match via the buggy file_name LIKE.
    insert.run("decoy", "p1", "myXmodule.js", "/proj/myXmodule.js", "js");

    rag = new MultiFileRetriever(sqlite, null);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not wildcard-match an unrelated file whose name differs only where the import has an underscore", async () => {
    const related = await rag._findRelatedFiles(["src"], "p1", 1);
    const ids = related.map((f) => f.id);

    // The genuine target must still be linked.
    expect(ids).toContain("intended");
    // The decoy must NOT be linked — `_` must be treated literally.
    expect(ids).not.toContain("decoy");
  });
});
