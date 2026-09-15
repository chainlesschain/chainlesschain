/** Retain source context for several errors; an error line is not a root cause. */
export function diagnosticExcerpt(value, limit = 1600) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (text.length <= limit) return text;
  const marker = "\n[... omitted ...]\n";
  const lines = text.split("\n");
  const errors = [];
  const workers = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      /\b\w*Error:|Exception in thread|Caused by:|\bpanic:|panicked at|\bFAIL\b|error TS\d+|##\[error\]/.test(
        lines[i],
      )
    )
      errors.push(i);
    if (
      /\[vitest-pool\]|Worker.*(?:error|exited)|Unhandled (?:Error|Rejection)/i.test(
        lines[i],
      )
    )
      workers.push(i);
  }
  // Keep both an early diagnostic (possibly expected negative-test output)
  // and later runner failures. Never infer causality from their ordering.
  const indices = [
    ...new Set(
      [workers[0], errors[0], errors.at(-1)].filter((i) => i !== undefined),
    ),
  ].sort((a, b) => a - b);
  if (!indices.length) {
    const head = Math.floor((limit - marker.length) / 2);
    return (
      text.slice(0, head) + marker + text.slice(-(limit - marker.length - head))
    );
  }
  const available = limit - marker.length * (indices.length + 1);
  const head = Math.floor(available * 0.1);
  const tail = Math.floor(available * 0.15);
  const perWindow = Math.floor((available - head - tail) / indices.length);
  const windows = indices.map((index) => {
    const before = lines
      .slice(Math.max(0, index - 2), index)
      .join("\n")
      .slice(-Math.floor(perWindow * 0.2));
    return (before + "\n" + lines.slice(index, index + 10).join("\n")).slice(
      0,
      perWindow,
    );
  });
  return [text.slice(0, head), ...windows, text.slice(-tail)].join(marker);
}
