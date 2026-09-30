// Prefer test-runner verdicts over arbitrary "Error:" lines printed by tests.
// A verdict is evidence to retain, not a claim about which defect caused it.
const TEST_FAILURE =
  /\bFAIL(?:ED)?\s+[^\r\n]*\.(?:[cm]?[jt]sx?|py|go|rs|java)(?=[:\s]|$)|(?:^|\s)not ok \d+\s+-|\bTest Files\s+\d+ failed/;
export function hasTestFailureVerdict(value) {
  return (
    typeof value === "string" &&
    TEST_FAILURE.test(stripVTControlCharacters(value))
  );
}

/** Retain source context for several errors; an error line is not a root cause. */
export function diagnosticExcerpt(value, limit = 1600) {
  const text = stripVTControlCharacters(
    typeof value === "string" ? value : JSON.stringify(value ?? ""),
  );
  if (text.length <= limit) return text;
  if (limit < 256) return text.slice(0, Math.max(0, limit));
  const marker = "\n[... omitted ...]\n";
  // gh prefixes every log line with job/step/timestamp. Keep the original
  // head/tail, but spend diagnostic windows on the actual failure and stack.
  const lines = text
    .split("\n")
    .map((line) =>
      line.replace(/^[^\t\r\n]+\t[^\t\r\n]+\t\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ""),
    );
  const errors = [];
  const workers = [];
  const failures = [];
  const summaries = [];
  for (let i = 0; i < lines.length; i++) {
    if (TEST_FAILURE.test(lines[i])) failures.push(i);
    if (
      /\b(?:Test Files|Tests)\s+\d+ (?:failed|passed)|\b[\w -]+ tests (?:PASSED|FAILED)\b|\b(?:PASS|ok \d+ -)\b.*(?:negative|spawn|gate)/i.test(
        lines[i],
      )
    )
      summaries.push(i);
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
  // A middle failed-test block used to disappear between an expected early
  // error and the final gate error. Keep its location and adjacent assertion,
  // alongside process summaries; never infer causality from their ordering.
  const lastError = errors.at(-1);
  const finalError =
    lastError !== undefined &&
    /Process completed with exit code/.test(lines[lastError]) &&
    errors.at(-2) >= lastError - 2
      ? errors.at(-2)
      : lastError;
  const indices = [
    ...new Set(
      [failures[0], workers[0], errors[0], finalError].filter(
        (i) => i !== undefined,
      ),
    ),
  ].sort((a, b) => a - b);
  if (!indices.length) {
    const head = Math.floor((limit - marker.length) / 2);
    return (
      text.slice(0, head) + marker + text.slice(-(limit - marker.length - head))
    );
  }
  const failedSuites = summaries.filter((index) =>
    /tests FAILED\b/.test(lines[index]),
  );
  const verdictIndices = failedSuites.length
    ? [
        ...new Set(
          [
            ...failedSuites,
            summaries.find((index) => /tests PASSED\b/.test(lines[index])),
            ...failedSuites.map((index) => {
              const suite = /([\w-]+ tests) FAILED\b/.exec(lines[index])?.[1];
              return suite
                ? summaries.findLast((next) =>
                    lines[next].includes(`${suite} PASSED`),
                  )
                : undefined;
            }),
          ].filter((index) => index !== undefined),
        ),
      ]
    : summaries.slice(-5);
  const verdicts = verdictIndices
    .map((index) => lines[index])
    .join("\n")
    .slice(0, Math.floor(limit * 0.2));
  const available =
    limit -
    marker.length * (indices.length + 1 + (verdicts ? 1 : 0)) -
    verdicts.length;
  const head = Math.floor(available * 0.1);
  const tail = Math.floor(available * 0.15);
  const windowBudget = available - head - tail;
  const failureBudget = failures.length
    ? Math.floor(windowBudget * (indices.length > 1 ? 0.55 : 1))
    : 0;
  const perWindow = Math.floor(
    (windowBudget - failureBudget) /
      Math.max(1, indices.length - (failures.length ? 1 : 0)),
  );
  const windows = indices.map((index) => {
    const size = index === failures[0] ? failureBudget : perWindow;
    const before = lines
      .slice(Math.max(0, index - 2), index)
      .join("\n")
      .slice(-Math.floor(size * 0.1));
    return (before + "\n" + lines.slice(index, index + 10).join("\n")).slice(
      0,
      size,
    );
  });
  return [
    text.slice(0, head),
    ...windows,
    ...(verdicts ? [verdicts] : []),
    text.slice(-tail),
  ].join(marker);
}
import { stripVTControlCharacters } from "node:util";
