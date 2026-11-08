import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const sourceUrl = new URL(
  "../../src/main/llm/permanent-memory-manager.js",
  import.meta.url,
);
const require = createRequire(sourceUrl);
const source = fs.readFileSync(sourceUrl, "utf8");

function loadManager(loadHybrid) {
  const module = { exports: {} };
  const warnings = [];
  new vm.Script(source, { filename: fileURLToPath(sourceUrl) }).runInNewContext(
    {
      module,
      exports: module.exports,
      require(name) {
        if (name === "../utils/logger.js")
          return {
            logger: {
              info() {},
              warn: (...args) => warnings.push(args),
              error() {},
            },
          };
        if (name === "../rag/hybrid-search-engine") return loadHybrid();
        if (name === "./memory-file-watcher")
          return { MemoryFileWatcher: class {} };
        if (name === "../rag/embedding-cache")
          return { EmbeddingCache: class {} };
        return require(name);
      },
    },
  );
  return { ...module.exports, warnings };
}

const options = {
  memoryDir: "synthetic-memory",
  database: {},
  enableEmbeddingCache: false,
};

test("Memory without a RAG manager does not load the unused NLP dependency", () => {
  const { PermanentMemoryManager } = loadManager(() => {
    throw new Error("unused NLP dependency must not be loaded");
  });
  const manager = new PermanentMemoryManager(options);
  assert.equal(manager.hybridSearchEngine, null);
  assert.equal(manager.db, options.database);
});

test("Memory with RAG retains the existing HybridSearchEngine parameters", () => {
  let loaded = 0,
    configuration;
  class HybridSearchEngine {
    constructor(input) {
      configuration = input;
    }
  }
  const { PermanentMemoryManager } = loadManager(() => {
    loaded++;
    return { HybridSearchEngine };
  });
  const ragManager = {};
  const manager = new PermanentMemoryManager({ ...options, ragManager });
  assert.equal(loaded, 1);
  assert.ok(manager.hybridSearchEngine instanceof HybridSearchEngine);
  assert.equal(configuration.ragManager, ragManager);
  assert.equal(configuration.vectorWeight, 0.6);
  assert.equal(configuration.textWeight, 0.4);
  assert.equal(configuration.rrfK, 60);
  assert.equal(configuration.language, "zh");
});

test("a required RAG dependency load failure still propagates", () => {
  const failure = Object.assign(new Error("synthetic missing RAG dependency"), {
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(
    () => {
      const { PermanentMemoryManager } = loadManager(() => {
        throw failure;
      });
      new PermanentMemoryManager({ ...options, ragManager: {} });
    },
    (error) => error === failure,
  );
});

test("an engine constructor failure retains the existing warning fallback", () => {
  const { PermanentMemoryManager, warnings } = loadManager(() => ({
    HybridSearchEngine: class {
      constructor() {
        throw new Error("synthetic constructor failure");
      }
    },
  }));
  const manager = new PermanentMemoryManager({ ...options, ragManager: {} });
  assert.equal(manager.hybridSearchEngine, null);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1], "synthetic constructor failure");
});
