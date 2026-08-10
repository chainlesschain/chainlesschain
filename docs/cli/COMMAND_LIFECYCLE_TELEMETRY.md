# CLI command lifecycle telemetry and alias decisions

The CLI emits opt-in, content-free lifecycle metrics for the deprecated
top-level compatibility entries. Collection alone never authorizes alias
removal. A removal recommendation requires two observed minor release cycles,
the command's `removalNotBefore` version, representative collector coverage,
sufficient per-command usage, an export manifest that covers the complete
observation window without gaps or overlaps, and a valid Ed25519 approval from
a repository-pinned trust root.

The formal lifecycle counter temporality is OTLP **DELTA** (`1`). Cumulative
input is supported only as a conservative compatibility path: every stream
start must be no earlier than the matching npm publication timestamp, snapshots
must be monotonic, and reset windows must not overlap. Resource and scope
attributes are deliberately not trusted as stream identities.
Without a stable installation/event identifier, repeated DELTA points with the
same lifecycle identity and timestamp are ambiguous rather than assumed to be
retries; the complete ingestion fails closed.

## Current release status: external NO-GO

CLI `0.162.198` and `0.163.3` are not compatible lifecycle-observation
evidence. They predate the public DELTA exporter fix, so their points must not
be combined with v2 evidence or used to satisfy either observed minor cycle.
The formal observation window restarts at the npm publication timestamp of the
first public release that contains the DELTA fix. Let that exact release be
`R`; evidence must then cover real traffic beginning at `R` across two distinct
minor cycles (the minor containing `R` and a later minor) before any alias can
be considered for removal.

The repository-owned DELTA release policy currently has no `R` configured, so
it emits `delta-release-policy-unconfigured`. A future reviewed code change
must set `R`'s exact version, release commit SHA, and npm publication timestamp
together. These values are included in `policySha256`; coverage data or API
callers cannot supply or override them. `0.162.198` and `0.163.3` remain an
explicit permanent incompatible set even if their OTLP payloads claim DELTA
temporality.

There is currently no repository-pinned command-lifecycle approval public key.
The packaged reporter therefore fails closed with
`approval-signature-trust-unavailable`; `evidence.ready` remains `false`, the
formal decision is `insufficient-data`, and every operational alias action is
`retain`. A person named in `approvedBy`, a locally supplied key, or a future
`approvedAt`/`generatedAt` timestamp cannot self-authorize a decision.

## v2 evidence bundle

Coverage uses `chainlesschain.command-lifecycle-coverage.v2`. Fields and JSON
types are strict; unknown fields, numeric strings, non-boolean `blocking`
values, or any platform set other than exactly `linux`, `macos`, and `windows`
make the evidence incomplete.

```json
{
  "schema": "chainlesschain.command-lifecycle-coverage.v2",
  "reportSchema": "chainlesschain.command-lifecycle-report.v2",
  "decisionVersion": "0.165.0",
  "observation": {
    "id": "public-cli-delta-r-through-0.165",
    "startedAt": "<R npmPublishedAt, canonical ISO timestamp>",
    "endedAt": "<closed observation end, canonical ISO timestamp>",
    "startRelease": "<R>",
    "endRelease": "0.165.0"
  },
  "publicReleases": [
    {
      "version": "<R>",
      "commitSha": "<exact 40-hex release commit>",
      "tag": "<v-npm-R-with-dots-replaced-by-dashes>",
      "tagPublishedAt": "<canonical ISO timestamp>",
      "npmPublishedAt": "<canonical ISO timestamp>"
    }
  ],
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

Raw OTLP files are bound by
`chainlesschain.command-lifecycle-export-manifest.v1`. Partition windows are
half-open (`startedAt <= point < endedAt`) and must form one contiguous cover:
the first start equals the observation start, every next start equals the prior
end, and the last end equals the observation end. Gaps, overlaps, and selective
high-usage subwindows fail closed. The partition sequence, exact-byte SHA-256,
window, and temporality are trusted metadata; the `--input` sequence must match
it exactly.

```json
{
  "schema": "chainlesschain.command-lifecycle-export-manifest.v1",
  "reportSchema": "chainlesschain.command-lifecycle-report.v2",
  "observationId": "public-cli-delta-r-through-0.165",
  "generatorSha": "<exact 40-hex reporter commit>",
  "policySha256": "<reporter's emitted policy.sha256>",
  "partitions": [
    {
      "sequence": 0,
      "id": "collector-2026-10-a",
      "sha256": "sha256:<64 lowercase hex characters>",
      "startedAt": "<canonical ISO timestamp>",
      "endedAt": "<canonical ISO timestamp>",
      "temporality": "delta"
    }
  ]
}
```

The approval schema is
`chainlesschain.command-lifecycle-approval.v2`. Its Ed25519 signature covers
the entire approval except the top-level `signature` envelope, including the
exact coverage digest, export-manifest digest, policy digest, generator commit,
observation, decision version, reviewer identity, and approval timestamp. It
uses the same canonical Ed25519 envelope and key-ID verification model as the
pack-update trust path. The approval must be produced outside this reporter;
the reporter has no option for injecting a trust key. The generator commit must
also equal the clean Git `HEAD` of the canonical `packages/cli` checkout;
installed copies, dirty trees, and caller-only SHA claims remain unverified.

## Generate a report

Keep raw exports and approval material outside the repository. Hashes are over
the exact file bytes, so do not reformat a file after its digest is recorded.

```bash
cd packages/cli
npm run commands:lifecycle:report -- \
  --coverage /secure/export/coverage.json \
  --export-manifest /secure/export/export-manifest.json \
  --generator-sha "$GITHUB_SHA" \
  --approval /secure/export/approval.json \
  --input collector-2026-10-a=/secure/export/lifecycle-a.ndjson \
  --out /secure/export/lifecycle-report.json \
  --markdown /secure/export/lifecycle-report.md \
  --fail-on-incomplete
```

The reporter enforces bounded JSON/NDJSON input sizes (including top-level JSON
array document counts), fatal UTF-8 decoding, duplicate-key rejection, unique
CLI singleton options, and output/input path separation.
`--fail-on-incomplete` exits `2` for valid but incomplete evidence; malformed
or unsafe input exits `1`.

The report emits exactly one evidence decision per compatibility entry:

- `remove`: every evidence gate passed and legacy usage is at or below 1%.
- `retain`: evidence is complete but legacy usage remains above 1%.
- `insufficient-data`: any release, coverage, bias, trust, integrity, partition,
  or sample gate is incomplete. Its operational `aliasAction` is always
  `retain`.

The tool never edits the manifest or removes aliases. A reviewed PR must apply
any future `remove` recommendation, regenerate the command
manifest/help/completions, and run the full exact-SHA CLI release gates.
Collector exports and installation counts may be sensitive operational data;
only the content-free aggregate report belongs in release evidence.

## Historical v1 snapshots

The [0.162.200 JSON snapshot](evidence/command-lifecycle/0.162.200.json) and its
[review table](evidence/command-lifecycle/0.162.200.md) are historical v1
records only. They record no approved representative Collector cohort and
retain all aliases. They are not compatible with the v2 report, coverage,
export-manifest, approval, DELTA, or repository-trust contract and cannot count
toward the restarted observation window.
