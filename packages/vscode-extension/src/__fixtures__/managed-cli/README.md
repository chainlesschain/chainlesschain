# Managed-CLI twin fixtures

Shared, platform-neutral JSON fixtures for the **managed CLI runtime** decision
core (`packages/vscode-extension/src/managed-cli.js`). The JetBrains plugin
twin implements the same pure functions and MUST produce **byte-identical
decisions** on these files — do not edit a case without updating both sides'
tests.

All fixtures are UTF-8 JSON. Nothing here is platform-dependent: paths inside
inputs/outputs are opaque strings the core passes through, never joined or
normalized per-OS. (Filesystem-shaped functions — `resolveManagedBinary`,
shim writing — are intentionally NOT fixture-locked; each side tests those
natively.)

## Files

### `registry-meta.json`

Sample npm registry metadata for the `chainlesschain` package, keyed by shape:

- `versionManifest` — what `GET https://registry.npmjs.org/chainlesschain/latest`
  returns: `{name, version, dist:{tarball, integrity, shasum}}`.
- `versionManifestShasumOnly` — legacy manifest without `dist.integrity`.
- `packument` — the full-document shape: `{name, "dist-tags", versions:{…}}`.
- Broken variants (`noDist`, `httpTarball`, `wrongName`) for the fail-closed
  paths.

### `plan-cases.json`

Array of cases for `planManagedInstall`:

```json
{
  "name": "human-readable id",
  "input": {
    "requestedVersion": "latest" | "x.y.z",
    "metaRef": "<key into registry-meta.json>" | null,
    "floorVersion": "x.y.z" | null
  },
  "expected": { …exact deep-equal of the return value… }
}
```

`metaRef: null` means call with `registryMeta: undefined`. The `expected`
object is compared with **deep equality** — key order irrelevant, but every
key must be present (`ok`, `version`, `tarballUrl`, `integrity{algorithm,value}`
on success; `ok:false, error[, version, floorVersion, name]` on failure).
Integrity contract: sha512 value is the **base64** payload of the npm SRI
string; sha1 value is the **lowercase hex** shasum.

### `verify-cases.json`

Cases for `verifyTarball`. The buffer is `payloadUtf8` encoded as UTF-8 bytes;
`expected` mirrors the return contract `{ok, algorithm, expected, actual}`.
Digests were precomputed with Node's crypto; JVM `MessageDigest` must agree.

### `state-cases.json`

State-machine transitions:

- `op:"next"` → `nextState({version, previousState, now})`
- `op:"rollback"` → `rollbackPlan(state, hasVersionDir, {now})`, where the
  injected `hasVersionDir(v)` returns `input.diskVersions.includes(v)`.

`expected` is a deep-equal of the return value. Timestamps are the literal
injected `now` (no clock reads in the core).

### `candidate-cases.json`

The decision matrix for `deriveCliCandidates`. Input shape:

```json
{
  "configured": {"path": "…", "usable": true|false} | null,
  "global": {"binary": "…", "version": "x.y.z"} | null,
  "managed": {"command": "…", "version": "x.y.z"} | null,
  "managedEnabled": true|false,
  "nodeOnPath": true|false,
  "floorVersion": "x.y.z" | null
}
```

Output contract (deep-equal, `diagnostics` order is significant):

```json
{
  "use": "explicit" | "global" | "managed" | "none",
  "command": "…" | null,
  "offerManaged": true|false,
  "diagnostics": ["explicit-path-broken" | "global-below-floor" |
                  "managed-disabled" | "no-node-on-path", …]
}
```

Decision order (normative):

| # | Condition | Result |
|---|-----------|--------|
| 1 | `configured` present | `use:"explicit"` **always** (broken ⇒ diagnostic `explicit-path-broken` + at most an OFFER — never a silent replacement) |
| 2 | `global` present and version ≥ floor | `use:"global"` |
| 3 | `managed` present, `managedEnabled`, `nodeOnPath` | `use:"managed"` (`global-below-floor` diagnostic added if a stale global exists) |
| 4 | `global` present (below floor) | `use:"global"` + `global-below-floor`; offer managed if none installed and possible |
| 5 | nothing | `use:"none"`; `offerManaged` iff enabled **and** node on PATH, else diagnostic says exactly why (`managed-disabled` / `no-node-on-path`) |
