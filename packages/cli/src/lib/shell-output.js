import { diagnosticExcerpt } from "./diagnostic-excerpt.js";

/** Page size includes JSON escaping so later serialization does not lose data. */
export function shellOutputPage(value, budget) {
  const text = String(value ?? "");
  let low = 0;
  let high = Math.min(text.length, budget);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (JSON.stringify(text.slice(0, mid)).length <= budget) low = mid;
    else high = mid - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1])) low--;
  return { text: text.slice(0, low), remaining: text.length - low };
}

/** Foreground commands cannot be repolled; expose omitted diagnostic context. */
export function shellOutputPreview(value, field, budget) {
  const text = String(value ?? "");
  const page = shellOutputPage(text, budget);
  if (!page.remaining) return { [field]: page.text };
  return {
    [`${field}_truncated`]: true,
    [`${field}_total_chars`]: text.length,
    [`${field}_diagnostics`]: diagnosticExcerpt(text),
    [field]: page.text,
    output_hint:
      "Output is incomplete. Diagnostic excerpts are source evidence, not a root-cause verdict. For long reproductions use run_in_background and drain check_shell with task_id; preserve a full CI log once before filtering it.",
  };
}
