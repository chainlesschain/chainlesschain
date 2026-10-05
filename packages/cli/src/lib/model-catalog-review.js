import { resolveModelCapabilityProfile } from "./model-capabilities.js";
import { lookupRate } from "./llm-pricing.js";
import { isDeepStrictEqual } from "node:util";

/** Compare reviewed release facts with local behavior; never change a catalog. */
export function reviewModelCatalog(review, snapshots = {}) {
  if (
    review?.schema !== "chainlesschain.model-catalog-review/v1" ||
    !Array.isArray(review.models) ||
    !review.models.length
  ) {
    throw new TypeError("Invalid reviewed model catalog");
  }
  const mismatches = [];
  for (const expected of review.models) {
    const actual = resolveModelCapabilityProfile(expected);
    const rate = lookupRate(expected.provider, expected.model);
    for (const field of [
      "runtimeProtocol",
      "contextWindowTokens",
      "advertisedMaxOutputTokens",
    ]) {
      if (Object.hasOwn(expected, field) && actual[field] !== expected[field])
        mismatches.push({
          model: expected.model,
          field,
          expected: expected[field],
          actual: actual[field],
        });
    }
    if (!actual.sources.length)
      mismatches.push({
        model: expected.model,
        field: "official-source",
        actual: null,
      });
    for (const field of ["in", "out"]) {
      if (rate?.[field] !== expected.pricing[field])
        mismatches.push({
          model: expected.model,
          field,
          expected: expected.pricing[field],
          actual: rate?.[field] ?? null,
        });
    }
    for (const field of [
      "cacheReadMultiplier",
      "cacheWriteMultiplier",
      "longContext",
      "serviceMultipliers",
    ]) {
      if (
        Object.hasOwn(expected.pricing, field) &&
        !isDeepStrictEqual(
          rate?.terms?.[field] ?? null,
          expected.pricing[field],
        )
      ) {
        mismatches.push({
          model: expected.model,
          field,
          expected: expected.pricing[field],
          actual: rate?.terms?.[field] ?? null,
        });
      }
    }
    if (
      expected.reasoningEfforts &&
      JSON.stringify(actual.reasoningEfforts) !==
        JSON.stringify(expected.reasoningEfforts)
    )
      mismatches.push({
        model: expected.model,
        field: "reasoningEfforts",
        expected: expected.reasoningEfforts,
        actual: actual.reasoningEfforts ?? null,
      });
  }
  const upstream = [];
  for (const [name, source] of Object.entries(snapshots)) {
    if (
      !["codex", "claude"].includes(name) ||
      typeof source !== "string" ||
      source.length > 16 * 1024 * 1024
    )
      throw new TypeError("Invalid upstream release snapshot");
    const text = source
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, " ");
    const version =
      name === "codex"
        ? /Codex CLI\s+(\d+\.\d+\.\d+)/.exec(text)?.[1]
        : /<Update\s+label="(\d+\.\d+\.\d+)"/u.exec(source)?.[1] ||
          /^##\s+(\d+\.\d+\.\d+)/m.exec(text)?.[1];
    if (!version)
      throw new Error(
        `Cannot identify the ${name} release in the official snapshot`,
      );
    upstream.push({
      name,
      reviewedVersion: review.upstream[name],
      observedVersion: version,
      reviewRequired: version !== review.upstream[name],
    });
  }
  return {
    schema: "chainlesschain.model-catalog-review-result/v1",
    reviewedAt: review.reviewedAt,
    localContractPassed: mismatches.length === 0,
    mismatches,
    upstream,
    reviewRequired:
      mismatches.length > 0 || upstream.some((row) => row.reviewRequired),
    automaticEnablement: false,
  };
}
