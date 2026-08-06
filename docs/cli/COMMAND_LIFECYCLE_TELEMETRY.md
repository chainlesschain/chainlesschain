# CLI command lifecycle telemetry and alias decisions

The CLI emits opt-in, content-free lifecycle metrics for the 25 deprecated
top-level compatibility entries. Collection alone does not authorize alias
removal. A removal recommendation requires two observed minor release cycles,
the command's `removalNotBefore` version, representative collector coverage,
documented sampling bias and sufficient per-command usage.

## Generate a report

Export OTLP/JSON metric requests from the approved Collector into one JSON,
JSON-array or NDJSON file. Create a separate aggregated coverage statement:

```json
{
  "schema": "chainlesschain.command-lifecycle-coverage.v1",
  "decisionVersion": "0.164.0",
  "observedReleases": ["0.162.198", "0.163.4"],
  "window": {
    "startedAt": "2026-08-07T00:00:00.000Z",
    "endedAt": "2026-09-07T00:00:00.000Z"
  },
  "collector": {
    "eligibleInstallations": 100,
    "reportingInstallations": 80,
    "sampleRate": 1,
    "platforms": { "linux": 30, "macos": 20, "windows": 30 },
    "knownBiases": [
      {
        "id": "opt-in-collector",
        "description": "Only the explicitly configured cohort is represented.",
        "blocking": false
      }
    ]
  }
}
```

Run:

```bash
cd packages/cli
npm run commands:lifecycle:report -- \
  --input /secure/export/lifecycle.ndjson \
  --coverage /secure/export/coverage.json \
  --out /secure/export/lifecycle-report.json \
  --markdown /secure/export/lifecycle-report.md \
  --fail-on-incomplete
```

The report emits exactly one of these recommendations per compatibility entry:

- `remove`: every evidence gate passed and legacy usage is at or below 1%.
- `retain`: evidence is complete but legacy usage remains above 1%.
- `insufficient-data`: any release, coverage, bias, integrity or sample gate is
  incomplete. This is the mandatory result before the observation window ends.

The tool never edits the manifest or removes aliases. A reviewed PR must apply
any `remove` recommendation, regenerate the command manifest/help/completions,
and run the full exact-SHA CLI release gates. Collector exports and installation
counts may be sensitive operational data and must remain outside the repository;
only the content-free aggregate report should be retained as release evidence.
