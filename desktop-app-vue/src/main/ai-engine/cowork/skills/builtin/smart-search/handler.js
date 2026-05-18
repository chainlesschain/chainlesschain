/**
 * Smart Search Skill Handler
 *
 * Provides hybrid Vector+BM25 search across the knowledge base.
 */

const { logger } = require("../../../../../utils/logger.js");

let hybridSearchEngine = null;
let ragManager = null;

module.exports = {
  async init(skill) {
    try {
      hybridSearchEngine = require("../../../../../rag/hybrid-search-engine.js");
      logger.info("[SmartSearch] HybridSearchEngine loaded");
    } catch (error) {
      logger.warn(
        "[SmartSearch] HybridSearchEngine not available:",
        error.message,
      );
    }

    try {
      ragManager = require("../../../../../rag/rag-manager.js");
      logger.info("[SmartSearch] RAGManager loaded");
    } catch (error) {
      logger.warn("[SmartSearch] RAGManager not available:", error.message);
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { mode, query } = parseSearchInput(input);

    logger.info(`[SmartSearch] Executing mode: ${mode}, query: "${query}"`);

    if (!query) {
      return {
        success: false,
        error: "No search query provided. Usage: /smart-search <query>",
      };
    }

    try {
      switch (mode) {
        case "similar":
          return await handleSimilar(query);
        case "vector":
          return await handleVectorSearch(query);
        case "keyword":
        case "bm25":
          return await handleKeywordSearch(query);
        case "search":
        default:
          return await handleHybridSearch(query);
      }
    } catch (error) {
      logger.error(`[SmartSearch] Search error:`, error);
      return { success: false, error: error.message, mode, query };
    }
  },
};

function parseSearchInput(input) {
  if (!input || typeof input !== "string") {
    return { mode: "search", query: "" };
  }

  const trimmed = input.trim();
  const modes = ["similar", "vector", "keyword", "bm25", "search"];

  for (const mode of modes) {
    if (trimmed.toLowerCase().startsWith(mode + " ")) {
      return {
        mode: mode === "bm25" ? "keyword" : mode,
        query: trimmed.substring(mode.length + 1).trim(),
      };
    }
  }

  return { mode: "search", query: trimmed };
}

async function handleHybridSearch(query) {
  if (!hybridSearchEngine) {
    // Fallback to vector search
    if (ragManager) {
      return await handleVectorSearch(query);
    }
    return { success: false, error: "Search engine not available." };
  }

  const engine =
    typeof hybridSearchEngine.getInstance === "function"
      ? hybridSearchEngine.getInstance()
      : hybridSearchEngine;

  let results = [];
  if (typeof engine.search === "function") {
    results = await engine.search(query, { limit: 10 });
  } else if (typeof engine.hybridSearch === "function") {
    results = await engine.hybridSearch(query, { limit: 10 });
  }

  return {
    success: true,
    mode: "hybrid",
    query,
    results: Array.isArray(results) ? results : [],
    resultCount: Array.isArray(results) ? results.length : 0,
  };
}

async function handleVectorSearch(query) {
  if (!ragManager) {
    return { success: false, error: "RAG manager not available." };
  }

  const manager =
    typeof ragManager.getInstance === "function"
      ? ragManager.getInstance()
      : ragManager;

  let results = [];
  if (typeof manager.search === "function") {
    results = await manager.search(query, { limit: 10 });
  } else if (typeof manager.findSimilar === "function") {
    results = await manager.findSimilar(query, 10);
  }

  return {
    success: true,
    mode: "vector",
    query,
    results: Array.isArray(results) ? results : [],
    resultCount: Array.isArray(results) ? results.length : 0,
  };
}

async function handleKeywordSearch(query) {
  if (!hybridSearchEngine) {
    return { success: false, error: "BM25 search engine not available." };
  }

  const engine =
    typeof hybridSearchEngine.getInstance === "function"
      ? hybridSearchEngine.getInstance()
      : hybridSearchEngine;

  let results = [];
  if (typeof engine.bm25Search === "function") {
    results = await engine.bm25Search(query, { limit: 10 });
  } else if (typeof engine.keywordSearch === "function") {
    results = await engine.keywordSearch(query, { limit: 10 });
  }

  return {
    success: true,
    mode: "keyword",
    query,
    results: Array.isArray(results) ? results : [],
    resultCount: Array.isArray(results) ? results.length : 0,
  };
}

async function handleSimilar(reference) {
  if (!ragManager) {
    return { success: false, error: "RAG manager not available." };
  }

  const manager =
    typeof ragManager.getInstance === "function"
      ? ragManager.getInstance()
      : ragManager;

  let results = [];
  if (typeof manager.findSimilar === "function") {
    results = await manager.findSimilar(reference, 10);
  }

  return {
    success: true,
    mode: "similar",
    reference,
    results: Array.isArray(results) ? results : [],
    resultCount: Array.isArray(results) ? results.length : 0,
  };
}
