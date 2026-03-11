/**
 * RAG / hybrid search commands
 * chainlesschain search <query> [--mode vector|bm25|hybrid] [--top-k <n>]
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import { BM25Search } from "../lib/bm25-search.js";

/**
 * Ensure the notes table exists (same as note.js)
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
 * Load all notes from DB for indexing
 */
function loadNotes(db) {
  ensureNotesTable(db);
  return db
    .prepare(
      "SELECT id, title, content, tags, category, created_at FROM notes WHERE deleted_at IS NULL",
    )
    .all();
}

/**
 * Simple vector embedding using character/word frequency (fallback when no LLM)
 * Produces a 128-dim feature vector
 */
function simpleEmbed(text) {
  if (!text) return new Array(128).fill(0);

  const normalized = text.toLowerCase();
  const vec = new Array(128).fill(0);

  // Character frequency features (first 64 dims)
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    vec[code % 64] += 1;
  }

  // Word-level features (next 64 dims)
  const words = normalized.split(/\s+/);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) & 0x7fffffff;
    }
    vec[64 + (hash % 64)] += 1;
  }

  // Normalize
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / mag);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

/**
 * Vector search using simple embeddings
 */
function vectorSearch(query, notes, topK) {
  const queryVec = simpleEmbed(query);
  const scored = notes.map((note) => {
    const text = [note.title || "", note.content || ""].join(" ");
    const noteVec = simpleEmbed(text);
    return {
      id: note.id,
      score: cosineSimilarity(queryVec, noteVec),
      doc: note,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Reciprocal Rank Fusion to combine results from multiple methods
 */
function rrfFusion(resultSets, k = 60) {
  const scores = new Map();

  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const id = results[rank].id;
      const rrfScore = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) || 0) + rrfScore);
    }
  }

  // Get original docs
  const allDocs = new Map();
  for (const results of resultSets) {
    for (const r of results) {
      if (!allDocs.has(r.id)) {
        allDocs.set(r.id, r.doc);
      }
    }
  }

  const fused = Array.from(scores.entries()).map(([id, score]) => ({
    id,
    score,
    doc: allDocs.get(id),
  }));

  fused.sort((a, b) => b.score - a.score);
  return fused;
}

export function registerSearchCommand(program) {
  program
    .command("search")
    .description("Search knowledge base (BM25 + vector hybrid)")
    .argument("<query>", "Search query")
    .option("--mode <mode>", "Search mode: bm25, vector, hybrid", "hybrid")
    .option("--top-k <n>", "Number of results", "10")
    .option("--threshold <n>", "Minimum score threshold", "0")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      const spinner = ora("Searching...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const notes = loadNotes(db);

        if (notes.length === 0) {
          spinner.info("No notes in knowledge base. Use 'note add' first.");
          await shutdown();
          return;
        }

        const topK = Math.max(1, parseInt(options.topK) || 10);
        const threshold = parseFloat(options.threshold) || 0;
        const mode = options.mode;
        let results = [];

        if (mode === "bm25") {
          const bm25 = new BM25Search();
          bm25.indexDocuments(notes);
          results = bm25.search(query, { topK, threshold });
        } else if (mode === "vector") {
          results = vectorSearch(query, notes, topK);
          if (threshold > 0) {
            results = results.filter((r) => r.score >= threshold);
          }
        } else {
          // Hybrid: BM25 + vector → RRF fusion
          const bm25 = new BM25Search();
          bm25.indexDocuments(notes);
          const bm25Results = bm25.search(query, { topK: topK * 2 });
          const vecResults = vectorSearch(query, notes, topK * 2);
          results = rrfFusion([bm25Results, vecResults]).slice(0, topK);
          if (threshold > 0) {
            results = results.filter((r) => r.score >= threshold);
          }
        }

        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              results.map((r) => ({
                id: r.id,
                score: r.score,
                title: r.doc.title,
                category: r.doc.category,
                created_at: r.doc.created_at,
                snippet: (r.doc.content || "").substring(0, 200),
              })),
              null,
              2,
            ),
          );
        } else if (results.length === 0) {
          logger.info(`No results for "${query}"`);
        } else {
          logger.log(
            chalk.bold(
              `Search results for "${query}" (${results.length}, mode: ${mode}):\n`,
            ),
          );
          for (const r of results) {
            const tags = JSON.parse(r.doc.tags || "[]");
            const tagStr =
              tags.length > 0 ? chalk.gray(` [${tags.join(", ")}]`) : "";
            const snippet = (r.doc.content || "")
              .substring(0, 120)
              .replace(/\n/g, " ");
            logger.log(
              `  ${chalk.yellow(r.score.toFixed(4))}  ${chalk.gray(r.id.slice(0, 8))}  ${chalk.white(r.doc.title)}${tagStr}`,
            );
            if (snippet) {
              logger.log(`         ${chalk.gray(snippet)}`);
            }
          }
        }

        await shutdown();
      } catch (err) {
        spinner.fail(`Search failed: ${err.message}`);
        process.exit(1);
      }
    });
}
