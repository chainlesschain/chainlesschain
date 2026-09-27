import {
  DOCUMENTED_OPENAI_MODELS,
  GPT6_PRICING_TERMS,
} from "./model-context-catalog.js";

/** Only bounded, non-secret pricing labels may enter the durable usage ledger. */
export function projectUsagePricingContext(usage = {}) {
  const projected = {};
  for (const [key, alias] of [
    ["service_tier", "serviceTier"],
    ["regional_processing", "regionalProcessing"],
  ]) {
    if (!Object.hasOwn(usage, key) && !Object.hasOwn(usage, alias)) continue;
    if (
      Object.hasOwn(usage, key) &&
      Object.hasOwn(usage, alias) &&
      usage[key] !== usage[alias]
    ) {
      throw new TypeError(`usage pricing aliases conflict: ${key}`);
    }
    const value = Object.hasOwn(usage, key) ? usage[key] : usage[alias];
    if (key === "service_tier") {
      projected[key] =
        typeof value === "string" &&
        Object.hasOwn(GPT6_PRICING_TERMS.serviceMultipliers, value)
          ? value
          : "unknown";
    } else {
      if (typeof value !== "boolean")
        throw new TypeError("usage regional processing must be boolean");
      projected[key] = value;
    }
  }
  return projected;
}

/** Preserve per-request thresholds in a bounded set of aggregate price buckets. */
export function mergeUsagePricingBucket(entry, usage) {
  if (
    String(entry.provider).toLowerCase() !== "openai" ||
    !DOCUMENTED_OPENAI_MODELS[String(entry.model).toLowerCase()]?.pricing
  )
    return;
  const metadata = projectUsagePricingContext(usage);
  const promptTokens =
    usage.requestInputTokens ??
    usage.inputTokens +
      (usage.cacheReadTokens || 0) +
      (usage.cacheCreationTokens || 0);
  const long = promptTokens > GPT6_PRICING_TERMS.longContext.threshold;
  const serviceTier = metadata.service_tier || "standard";
  const regionalProcessing = metadata.regional_processing === true;
  entry.pricingBuckets ||= [];
  let bucket = entry.pricingBuckets.find(
    (item) =>
      item.serviceTier === serviceTier &&
      item.regionalProcessing === regionalProcessing &&
      item.requestInputTokens > GPT6_PRICING_TERMS.longContext.threshold ===
        long,
  );
  if (!bucket) {
    bucket = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      calls: 0,
      serviceTier,
      regionalProcessing,
      requestInputTokens: promptTokens,
    };
    entry.pricingBuckets.push(bucket);
  }
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheCreationTokens",
    "totalTokens",
    "calls",
  ]) {
    const value = usage[key] ?? (key === "calls" ? 1 : 0);
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      !Number.isSafeInteger(bucket[key] + value)
    ) {
      throw new TypeError(`invalid pricing bucket ${key}`);
    }
    bucket[key] += value;
  }
}
