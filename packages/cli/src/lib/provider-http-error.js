/**
 * Provider HTTP error parsing shared by agent/chat streaming and `cc llm test`.
 * Keep structured provider diagnostics while redacting credential-shaped text.
 */

import {
  attachStreamRetryMetadata,
  captureStreamRetryMetadata,
} from "./stream-retry.js";

function safePart(value, secrets = []) {
  if (value == null) return "";
  let text = String(value);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret)
      text = text.replaceAll(secret, "***");
  }
  return text
    .replace(/\s+/g, " ")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*\b/gi, "$1***")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, "sk-***")
    .trim()
    .slice(0, 400);
}

function errorDetail(payload, secrets) {
  if (payload == null) return { code: "", message: "" };
  const raw =
    typeof payload === "object" && payload.error != null
      ? payload.error
      : payload;
  if (typeof raw === "string") {
    return { code: "", message: safePart(raw, secrets) };
  }
  if (!raw || typeof raw !== "object") {
    return { code: "", message: safePart(raw, secrets) };
  }
  return {
    code: safePart(raw.code || raw.type, secrets),
    message: safePart(
      raw.message || raw.error_description || raw.detail,
      secrets,
    ),
  };
}

/**
 * A 403 is not necessarily a bad key: providers also use it for overdue
 * accounts and model-access denials. Preserve the safe code/message so clients
 * can show the real corrective action.
 */
export function formatProviderHttpError(
  provider,
  status,
  payload = null,
  { secrets = [] } = {},
) {
  const base = `${provider} API error: HTTP ${status}`;
  const detail = errorDetail(payload, secrets);
  const detailText = [detail.code, detail.message].filter(Boolean).join(": ");
  const detailSentence = detailText.replace(/[.!?]+$/, "");
  const classified = `${detail.code} ${detail.message}`.toLowerCase();
  const authDetail =
    /unauthori[sz]ed|authentication|invalid.*api[\s_-]*key|api[\s_-]*key.*invalid|incorrect.*api[\s_-]*key|missing.*api[\s_-]*key/.test(
      classified,
    );
  const billingDetail =
    /account.?overdue|overdue balance|insufficient.*balance|billing|payment required/.test(
      classified,
    );

  if (status === 401 || (status === 403 && authDetail)) {
    return (
      `${base} — authentication failed: the API key for provider "${provider}" ` +
      `is missing or invalid. Check "cc config get llm.provider" and ` +
      `"cc config get llm.apiKey" (or run Configure LLM).` +
      (detailSentence ? ` Provider response: ${detailSentence}.` : "")
    );
  }
  if (status === 403 && billingDetail) {
    return (
      `${base} — ${detailSentence || "the provider account cannot be billed"}. ` +
      "Check the provider account balance/billing status, then retry."
    );
  }
  if (status === 403) {
    return (
      `${base} — access forbidden` +
      (detailSentence ? `: ${detailSentence}` : "") +
      ". Check the API key, model access permissions, and account status/balance."
    );
  }
  if (status === 429) return `${base} — rate limited; please retry shortly.`;
  return detailSentence ? `${base} — ${detailSentence}` : base;
}

export async function formatProviderResponseError(
  provider,
  response,
  { secrets = [] } = {},
) {
  let payload = null;
  try {
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
  } catch {
    // A broken/empty body still retains the HTTP status diagnosis.
  }
  return formatProviderHttpError(provider, response.status, payload, {
    secrets,
  });
}

/** Keep response status authoritative even if reading its error body fails. */
export async function createProviderResponseError(provider, response, options) {
  const metadata = captureStreamRetryMetadata(response);
  let message = await formatProviderResponseError(provider, response, options);
  const remaining = metadata.retryAfterAt - Date.now();
  if (Number.isFinite(remaining) && remaining > 0) {
    message += ` Retry-After: wait at least ${Math.ceil(remaining / 1000)}s before an explicit retry.`;
  }
  return attachStreamRetryMetadata(new Error(message), metadata);
}
