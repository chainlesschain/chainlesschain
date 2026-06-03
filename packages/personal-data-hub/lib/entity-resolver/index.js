"use strict";

const { EntityResolver } = require("./entity-resolver");
const {
  ruleStage,
  findSharedIdentifier,
  countFieldOverlap,
  sharesAnyName,
  normalizeIdValue,
  STRONG_IDENTIFIER_KEYS,
} = require("./rule-stage");
const {
  EmbeddingStage,
  cosineSimilarity,
  ollamaEmbed,
} = require("./embedding-stage");
const {
  LLMStage,
  SYSTEM_PROMPT: LLM_SYSTEM_PROMPT,
  parseLLMResponse,
  defaultBuildProfile,
} = require("./llm-stage");
const { EntityResolverWorker } = require("./worker");

module.exports = {
  EntityResolver,
  entityResolverRuleStage: ruleStage,
  entityResolverSharedIdentifier: findSharedIdentifier,
  entityResolverFieldOverlap: countFieldOverlap,
  entityResolverNormalizeIdValue: normalizeIdValue,
  ENTITY_RESOLVER_STRONG_IDENTIFIER_KEYS: STRONG_IDENTIFIER_KEYS,
  // Phase 8.3 + 8.4
  EntityResolverEmbeddingStage: EmbeddingStage,
  entityResolverCosineSimilarity: cosineSimilarity,
  entityResolverOllamaEmbed: ollamaEmbed,
  EntityResolverLLMStage: LLMStage,
  ENTITY_RESOLVER_LLM_SYSTEM_PROMPT: LLM_SYSTEM_PROMPT,
  parseEntityResolverLLMResponse: parseLLMResponse,
  entityResolverDefaultProfile: defaultBuildProfile,
  // Phase 8.5
  EntityResolverWorker,
};
