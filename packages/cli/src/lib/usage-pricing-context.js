import {
  DOCUMENTED_OPENAI_MODELS,
  DOCUMENTED_ANTHROPIC_MODELS,
  GPT6_PRICING_TERMS,
} from "./model-context-catalog.js";

const KNOWN_SERVICE_TIERS = new Set([
  ...Object.keys(GPT6_PRICING_TERMS.serviceMultipliers),
  ...Object.values(DOCUMENTED_OPENAI_MODELS).flatMap((model) =>
    Object.keys(model.serviceMultipliers || {}),
  ),
]);

/** Preserve response-envelope pricing labels, rejecting conflicting evidence. */
export function projectEnvelopePricingContext(usage = {}, envelope = {}) {
  const input = { ...usage };
  for (const key of ["service_tier", "regional_processing", "inference_geo"]) {
    if (!Object.hasOwn(envelope, key)) continue;
    if (Object.hasOwn(input, key) && input[key] !== envelope[key])
      input.pricingContextInvalid = true;
    input[key] = envelope[key];
  }
  return projectUsagePricingContext(input);
}

/** Requested paid tiers require actual response evidence for settlement. */
export function preserveRequestedServiceTierEvidence(usage, requested) {
  if (
    usage &&
    requested != null &&
    requested !== "standard" &&
    (!usage.service_tier || usage.service_tier === "auto")
  ) {
    return { ...usage, pricingContextInvalid: true };
  }
  return usage;
}

/** Keep TTL evidence distinct from the aggregate cache-write count. */
export function projectCacheCreationUsage(usage = {}) {
  if (usage.cacheCreationInvalid === true)
    return { cacheCreationInvalid: true };
  if (
    Object.hasOwn(usage, "cache_creation_input_tokens") &&
    Object.hasOwn(usage, "cacheCreationTokens") &&
    usage.cache_creation_input_tokens !== usage.cacheCreationTokens
  )
    return { cacheCreationInvalid: true };
  const nested = usage.cache_creation;
  const hasFlat =
    Object.hasOwn(usage, "cacheCreation5mTokens") ||
    Object.hasOwn(usage, "cacheCreation1hTokens");
  if (!Object.hasOwn(usage, "cache_creation") && !hasFlat) return {};
  if (
    Object.hasOwn(usage, "cache_creation") &&
    (nested === null || typeof nested !== "object" || Array.isArray(nested))
  )
    return { cacheCreationInvalid: true };
  const five = nested?.ephemeral_5m_input_tokens ?? usage.cacheCreation5mTokens;
  const hour = nested?.ephemeral_1h_input_tokens ?? usage.cacheCreation1hTokens;
  const total = usage.cache_creation_input_tokens ?? usage.cacheCreationTokens;
  if (
    ![five, hour, total].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    five + hour !== total ||
    (hasFlat &&
      nested != null &&
      (five !== usage.cacheCreation5mTokens ||
        hour !== usage.cacheCreation1hTokens))
  ) {
    return { cacheCreationInvalid: true };
  }
  return { cacheCreation5mTokens: five, cacheCreation1hTokens: hour };
}

/** Only bounded, non-secret pricing labels may enter the durable usage ledger. */
export function projectUsagePricingContext(usage = {}) {
  const projected = projectCacheCreationUsage(usage);
  if (usage.pricingContextInvalid === true)
    projected.pricingContextInvalid = true;
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
        typeof value === "string" && KNOWN_SERVICE_TIERS.has(value)
          ? value
          : "unknown";
    } else {
      if (typeof value !== "boolean")
        throw new TypeError("usage regional processing must be boolean");
      projected[key] = value;
    }
  }
  if (Object.hasOwn(usage, "inference_geo")) {
    const geo = usage.inference_geo;
    if (geo !== "us" && geo !== "global") {
      projected.inference_geo = "unknown";
      projected.pricingContextInvalid = true;
    } else {
      if (
        Object.hasOwn(projected, "regional_processing") &&
        projected.regional_processing !== (geo === "us")
      ) {
        throw new TypeError(
          "usage inference_geo conflicts with regional processing",
        );
      }
      projected.inference_geo = geo;
      projected.regional_processing = geo === "us";
    }
  }
  return projected;
}

/** Preserve per-request thresholds in a bounded set of aggregate price buckets. */
export function mergeUsagePricingBucket(entry, usage) {
  const provider = String(entry.provider).toLowerCase();
  const model = String(entry.model).toLowerCase();
  const terms =
    provider === "openai" && DOCUMENTED_OPENAI_MODELS[model]?.pricing
      ? GPT6_PRICING_TERMS
      : provider === "anthropic"
        ? DOCUMENTED_ANTHROPIC_MODELS[model]?.pricingTerms
        : null;
  if (!terms?.longContext) return;
  const metadata = projectUsagePricingContext(usage);
  const pricingContextInvalid =
    metadata.pricingContextInvalid === true ||
    (provider === "anthropic" &&
      model === "claude-haiku-5-5" &&
      metadata.regional_processing == null);
  const promptTokens =
    usage.requestInputTokens ??
    usage.inputTokens +
      (usage.cacheReadTokens || 0) +
      (usage.cacheCreationTokens || 0);
  const long = promptTokens > terms.longContext.threshold;
  const cache = projectCacheCreationUsage(usage);
  const cacheEvidence = cache.cacheCreationInvalid
    ? "invalid"
    : cache.cacheCreation5mTokens != null
      ? "split"
      : "missing";
  const serviceTier = metadata.service_tier || "standard";
  const regionalProcessing = metadata.regional_processing === true;
  entry.pricingBuckets ||= [];
  let bucket = entry.pricingBuckets.find(
    (item) =>
      item.serviceTier === serviceTier &&
      item.regionalProcessing === regionalProcessing &&
      (item.pricingContextInvalid === true) === pricingContextInvalid &&
      (item.cacheEvidence || "missing") === cacheEvidence &&
      item.requestInputTokens > terms.longContext.threshold === long,
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
      ...(pricingContextInvalid ? { pricingContextInvalid: true } : {}),
      ...(provider === "anthropic"
        ? {
            cacheEvidence,
            ...(cacheEvidence === "split"
              ? { cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 }
              : {}),
            ...(cacheEvidence === "invalid"
              ? { cacheCreationInvalid: true }
              : {}),
          }
        : {}),
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
    ...(cacheEvidence === "split"
      ? ["cacheCreation5mTokens", "cacheCreation1hTokens"]
      : []),
  ]) {
    const value = cache[key] ?? usage[key] ?? (key === "calls" ? 1 : 0);
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
