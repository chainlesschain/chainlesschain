/**
 * Production bridges — wire the hub's pluggable sinks to ChainlessChain's
 * existing LLM / KG / RAG infrastructure.
 *
 * These adapters use dependency injection (caller supplies addEntity /
 * addRelation / chat / addDocument) so the hub package stays decoupled
 * from cc's module system (cli is ESM, desktop main is CJS, hub is CJS).
 *
 * Typical wiring in desktop-app-vue/src/main:
 *
 *   const llmManager = require("./llm/llm-manager").getInstance();
 *   const { addEntity, addRelation } = require("../../../packages/cli/src/lib/knowledge-graph");
 *   const bm25 = ...;
 *   const {
 *     CcLLMAdapter, CcKgSink, CcRagSink
 *   } = require("@chainlesschain/personal-data-hub/bridges");
 *
 *   const llm = new CcLLMAdapter({
 *     chat: (m, o) => llmManager.chat(m, o),
 *     getActiveProvider: () => llmManager.getActiveProvider(),
 *     getActiveModel: () => llmManager.getActiveModel(),
 *   });
 *   const kgSink = new CcKgSink({ addEntity, addRelation, db });
 *   const ragSink = new CcRagSink({ bm25 });
 *
 *   const registry = new AdapterRegistry({
 *     vault, kgSink: kgSink.write.bind(kgSink), ragSink: ragSink.write.bind(ragSink),
 *   });
 *   const engine = new AnalysisEngine({ vault, llm });
 */

"use strict";

const { CcLLMAdapter, LOCAL_PROVIDERS } = require("./cc-llm-adapter");
const { CcKgSink, HUB_TO_CC_TYPE } = require("./cc-kg-sink");
const { CcRagSink } = require("./cc-rag-sink");

module.exports = {
  CcLLMAdapter,
  LOCAL_PROVIDERS,
  CcKgSink,
  HUB_TO_CC_TYPE,
  CcRagSink,
};
