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

module.exports = {
  EntityResolver,
  entityResolverRuleStage: ruleStage,
  entityResolverSharedIdentifier: findSharedIdentifier,
  entityResolverFieldOverlap: countFieldOverlap,
  entityResolverNormalizeIdValue: normalizeIdValue,
  ENTITY_RESOLVER_STRONG_IDENTIFIER_KEYS: STRONG_IDENTIFIER_KEYS,
};
