# Local semantic Memory candidate source (unreleased, opt-in)

This implementation connects the canonical CLI Memory `search`, `recallScoped`, and provider-context planning paths to an actual local BGE encoder. It is off by default. This document describes an unreleased implementation, not a change to the public npm release or closure of the Memory quality/performance acceptance item.

## Configuration

Use an already-installed Python environment with CPU PyTorch, Transformers and their dependencies, and an already-cached model snapshot. The CLI does not install dependencies or download models. The existing offline evaluation used Python 3.13.7, PyTorch 2.9.0+cpu, Transformers 4.57.1 and NumPy 2.3.4; the production worker's three-entry real-model smoke has now passed on the recorded Windows host, using that existing local cache.

The only supported model is `BAAI/bge-base-en-v1.5` revision `a5beb1e3e68b9ab74eb54cfd186867f64f240e1a`. The worker checks the exact SHA-256 of six model/tokenizer files before and after inference. An incomplete, different or changed snapshot fails the request.

| Environment variable               | Meaning                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `CC_MEMORY_SEMANTIC_MODE`          | `off` (default) or `local-bge`                                  |
| `CC_MEMORY_SEMANTIC_PYTHON`        | Absolute path to the existing Python executable; no PATH lookup |
| `CC_MEMORY_SEMANTIC_PYTHON_SHA256` | Lowercase, 64-character SHA-256 of the approved executable      |
| `CC_MEMORY_SEMANTIC_MODEL_DIR`     | Absolute path to the pinned BGE snapshot directory              |
| `CC_MEMORY_SEMANTIC_THREADS`       | CPU threads, 1–8; default 2                                     |
| `CC_MEMORY_SEMANTIC_TIMEOUT_MS`    | Worker deadline, 1000–300000 ms; default 60000                  |

Example in PowerShell, after independently checking the executable and cached model:

```powershell
$semanticPython = 'C:/Users/admin/AppData/Local/Programs/Python/Python313/python.exe'
$env:CC_MEMORY_SEMANTIC_MODE = 'local-bge'
$env:CC_MEMORY_SEMANTIC_PYTHON = $semanticPython
$env:CC_MEMORY_SEMANTIC_PYTHON_SHA256 = (Get-FileHash -LiteralPath $semanticPython -Algorithm SHA256).Hash.ToLowerInvariant()
$env:CC_MEMORY_SEMANTIC_MODEL_DIR = 'C:/Users/admin/.cache/huggingface/hub/models--BAAI--bge-base-en-v1.5/snapshots/a5beb1e3e68b9ab74eb54cfd186867f64f240e1a'
$env:CC_MEMORY_SEMANTIC_THREADS = '2'
```

These variables enable the source only where the existing canonical Memory rollout already admits the operation. They do not migrate legacy Memory or override its rollout policy. Start the CLI/IDE-owned CLI process with these variables in its environment. Setting them in a different terminal does not modify an already-running host.

Set `CC_MEMORY_SEMANTIC_MODE=off` to retain lexical retrieval. A malformed enabled configuration, missing model, executable digest mismatch, worker failure or resource limit produces an error; there is no silent fake-vector or lexical fallback. Existing `--no-recall-memory`, review exclusions and sub-agent Memory restrictions continue to disable provider recall. Those disabled paths and shadow planning do not inspect model paths or launch a worker.

## Retrieval and authority

All three entry points use the concrete runtime source. A host's explicit existing semantic-candidate override still takes precedence in provider planning; providing an override does not attest that the local encoder ran.

The source asks the Memory port for the complete scope/sink-admitted corpus using a wildcard scan, without forwarding the caller's top-k or token budget. It excludes inactive/deleted/purged records, expired records and records outside the exact admitted scopes or allowed sink before sending content to the local worker. Global scope accepts an omitted or null scope ID, as the canonical contract does.

The worker uses normalized CLS embeddings, the BGE retrieval query instruction and a 512-token tokenizer limit that preserves special tokens. It scores every admitted record, then the source supplies up to 1000 positive candidates. Scores are the actual normalized-vector dot products, clipped to [0, 1]. Negative values do not expand recall. Full document text after the 512-token limit is not represented by this first encoder version; chunking and long-record quality remain future work.

Candidates carry the captured `memoryId`, `revision` and `recordDigest`. The Kernel again applies lifecycle, TTL, scope and sink gates and verifies exact record versions before its existing hybrid ranking. The runtime also compares the store revision spanning the entire local inference and canonical recall, so even newly inserted records invalidate an old semantic corpus snapshot. Concurrent mutation yields `revision_conflict`; the caller must prepare a fresh request.

Provider planning retains its existing final dispatch authorization checks and revision guard. A memory deletion, revision change, expiry or destination-provider change cannot turn previously prepared semantic context into permission to dispatch it.

No vectors, plaintext corpus copies, or queries are persisted by this source. Every enabled query starts an encoder and re-encodes the current admitted corpus; this intentionally does not claim interactive latency or large-store performance acceptance.

## Resource bounds and Stop

- At most 10000 admitted records and an 8 MiB serialized worker input. Exceeding either fails explicitly before launch; the source never silently searches a truncated corpus.
- Worker stdout is bounded at 12 MiB, stderr at 64 KiB. Output uses UTF-8 without ASCII-escaping Unicode IDs. The host checks request digest, model revision, record-ID cardinality, uniqueness and finite score range.
- One local encoder per CLI process. A competing request receives `CC_MEMORY_SEMANTIC_BUSY`; it does not cancel the owner. This is not a machine-wide limiter across separate CLI processes.
- Stop and deadline expiration terminate the owned worker. Normal settlement waits for its `close` event. If termination is not confirmed within five seconds, the request fails with `CC_MEMORY_SEMANTIC_CLEANUP_UNCONFIRMED`, and further workers in that CLI process remain fenced until the original close is observed. That diagnostic is not proof of process cleanup.
- The worker is launched through the normal execution broker, with no shell, isolated Python mode and a limited environment without inherited provider credentials. Python socket networking is refused, Transformers is offline, remote model code is disabled, and safetensors is required. These controls are not an attestation of a complete dependency closure or an independent OS network sandbox.

Useful failure codes include `CC_MEMORY_SEMANTIC_CONFIG`, `CC_MEMORY_SEMANTIC_IDENTITY`, `CC_MEMORY_SEMANTIC_CAPACITY`, `CC_MEMORY_SEMANTIC_BUSY`, `CC_MEMORY_SEMANTIC_TIMEOUT`, `CC_MEMORY_SEMANTIC_WORKER`, `CC_MEMORY_SEMANTIC_OUTPUT` and `revision_conflict`. Raw worker exception text is suppressed to avoid leaking Memory content into logs.

## Validation and remaining work

Run the lightweight contract suite without any model or Python dependency:

```text
node --test packages/cli/test-node/local-memory-semantic.node-test.mjs
```

The existing Context Memory Kernel CI Linux/Windows/macOS matrix runs this suite with real-model tests disabled. Protocol-fixture scores in these tests validate wiring and authority; they are not semantic-quality measurements.

After configuring the existing local model, and only when a CPU window is available, the explicit real test is:

```powershell
$env:CC_MEMORY_SEMANTIC_REAL_TEST = '1'
node --test --test-name-pattern='optional real offline BGE' packages/cli/test-node/local-memory-semantic.node-test.mjs
Remove-Item Env:CC_MEMORY_SEMANTIC_REAL_TEST
```

That test compares the same Memory corpus with semantic mode off, requires actual broker-launched Python workers at all three production entry points, and checks canonical hybrid/semantic evidence. It performs no paid-provider request.

The actual three-entry offline production smoke passed on 2026-11-08: search, scoped recall and provider planning each launched the real BGE worker, with semantic-off controls and canonical semantic evidence assertions. The test took about 15.7 seconds (suite about 17.7 seconds); this is a two-record functional smoke, not a latency SLO or relevance benchmark. The nine measured source hashes matched before and after the run. This subsequent documentation update changes no executable source; the six executable/test files are separately checked against the retained smoke hashes. [Archived evidence](evidence/local-memory-semantic-20261108/manifest.json) preserves the measured source manifest, 17 passing lightweight contracts, real smoke state and stdout/stderr, and the npm dry-run file listing.

Required remaining acceptance includes fixed-source production-path relevance evaluation, cold/hot and large-corpus performance, real Stop/process-cleanup evidence, and exact-source three-OS workflow results. Prior SciFact offline measurements cannot substitute for these checks; they were explicitly recorded with `productionCandidateSourceConnected:false`. Chinese/multilingual quality, no-relevant-memory behavior and complete dependency/supply-chain closure remain unaccepted. No release, paid-readiness, or whole-item completion is claimed.
