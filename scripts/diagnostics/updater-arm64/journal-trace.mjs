import fs from "node:fs";
import { hash } from "./shared.mjs";

// Diagnostic-only timing of generated helper code; no source checkout edits.
export function instrumentJournal(description) {
  const helper = description.paths.JOURNAL_HELPER;
  if (!helper) return null;
  const trace = `${helper}.trace.jsonl`;
  description.paths.JOURNAL_TRACE = trace;
  const original = fs.readFileSync(helper, "utf8");
  if (original.includes("function Write-CcDiagnosticMarker")) return null;
  const marker = String.raw`function Write-CcDiagnosticMarker([string] $Stage) {
  [IO.File]::AppendAllText($PSCommandPath + '.trace.jsonl', ('{"at":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ',"pid":' + $PID + ',"stage":"' + $Stage + '"}' + [Environment]::NewLine))
}
Write-CcDiagnosticMarker 'entry'
`;
  let instrumented = original.replace(/^param\(\)\r?\n/, `param()\n${marker}`);
  const checkpoints = [
    [
      [
        "  $Journal = [Text.Encoding]::UTF8.GetString($Bytes) | ConvertFrom-Json",
        "  $Journal = $Serializer.DeserializeObject([Text.Encoding]::UTF8.GetString($Bytes))",
      ],
      "initial-json",
    ],
    [
      "  Add-Type -TypeDefinition $ParentSource -Language CSharp",
      "parent-type",
    ],
    [
      [
        "  $Journal = Get-Content -Raw -LiteralPath $JournalPath | ConvertFrom-Json",
        "  $Journal = $Serializer.DeserializeObject([IO.File]::ReadAllText($JournalPath, [Text.Encoding]::UTF8))",
      ],
      "read-json",
    ],
    [
      [
        "  $Payload = $Journal | ConvertTo-Json -Compress -Depth 8",
        "  $Payload = $Serializer.Serialize($Journal)",
      ],
      "encode-json",
    ],
    ["    $Stream.Flush($true)", "staging-flush"],
    [
      "  try { $Final.Flush($true) } finally { $Final.Dispose() }",
      "final-flush",
    ],
  ];
  for (const [candidates, label] of checkpoints) {
    const line = (Array.isArray(candidates) ? candidates : [candidates]).find(
      (candidate) => instrumented.includes(candidate),
    );
    if (!line) throw new Error(`Missing journal trace boundary: ${label}`);
    instrumented = instrumented.replaceAll(
      line,
      `Write-CcDiagnosticMarker '${label}-before'\n${line}\nWrite-CcDiagnosticMarker '${label}-after'`,
    );
  }
  if (instrumented === original)
    throw new Error("Journal trace was not installed");
  fs.writeFileSync(helper, instrumented);
  return {
    originalSha256: hash(Buffer.from(original)),
    instrumentedSha256: hash(Buffer.from(instrumented)),
    trace,
  };
}
