import { resolveModelCapabilityProfile } from "./model-capabilities.js";
import { lookupRate } from "./llm-pricing.js";
import { isDeepStrictEqual } from "node:util";

function codexReleaseVersion(source) {
  const trimmed = source.trim();
  if (!trimmed.startsWith("<")) {
    let release;
    try {
      release = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
    const match =
      /^rust-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(
        release?.tag_name,
      );
    if (
      !release ||
      Array.isArray(release) ||
      !match ||
      release.draft !== false ||
      release.prerelease !== false ||
      release.html_url !==
        `https://github.com/openai/codex/releases/tag/${release.tag_name}`
    )
      return undefined;
    return match[1];
  }
  // Retain explicit release-heading snapshots. Product navigation, mobile/app
  // versions and links in old release notes are not CLI release identities.
  const visible = source
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(script|style|template|nav|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // This mixed product feed no longer supplies a CLI release-version contract.
  // Its tags classify feature notes too, not just versioned CLI releases.
  if (/\bdata-codex-topics\s*=/iu.test(visible)) return undefined;
  for (const heading of visible.matchAll(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
  )) {
    const text = heading[2].replace(/<[^>]+>/gu, " ").trim();
    const match =
      /^Codex CLI\s+((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(
        text,
      );
    if (match) return match[1];
  }
  return undefined;
}

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
    const content = source
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    const text = content.replace(/<[^>]+>/g, " ");
    const version =
      name === "codex"
        ? codexReleaseVersion(source)
        : /<Update\s+label="(\d+\.\d+\.\d+)"/u.exec(content)?.[1] ||
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
