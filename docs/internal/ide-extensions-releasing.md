# Releasing the IDE-bridge editor extensions

Maintenance + publish runbook for the two editor extensions that pair with the
CLI IDE bridge (design `docs/design/modules/98_IDE桥接对标方案.md`, Phase 4):

- **VS Code** — `packages/vscode-extension/` → VS Code Marketplace (`vsce`)
- **JetBrains** — `packages/jetbrains-plugin/` → JetBrains Marketplace (`gradlew publishPlugin`)

CI: `.github/workflows/ide-extensions.yml`. A normal push to `main` that touches
either package **builds + uploads the artifact** (`.vsix` / plugin `.zip`).
Publishing happens **only** on a dedicated tag, and only when the secret exists.

## Version governance

Both extensions are versioned independently of the CLI/product line (they ship
to different marketplaces). Keep all three in sync per extension when bumping:

| Extension | Version source | CHANGELOG |
|-----------|----------------|-----------|
| VS Code | `packages/vscode-extension/package.json` `version` | `packages/vscode-extension/CHANGELOG.md` |
| JetBrains | `packages/jetbrains-plugin/build.gradle.kts` `version` + `plugin.xml` `<version>` | `packages/jetbrains-plugin/CHANGELOG.md` |

Bump → update CHANGELOG → commit → tag.

## Publishing

### VS Code — Open VSX (primary)

We publish to the **Open VSX Registry** (open-vsx.org), which serves Cursor /
VSCodium / Gitpod / etc. The official VS Code Marketplace is **blocked** for us:
publishing there needs an Azure DevOps org, which now requires an Azure
subscription we don't have (see "Notes"). Open VSX needs only a GitHub login + a
token — no Azure, no card.

- **Namespace**: `chainlesschain` (= the extension's `publisher`).
- **Token**: sign in at open-vsx.org with GitHub → **sign the Eclipse Foundation
  Open VSX Publisher Agreement** on the PROFILE page (required; otherwise token
  creation is blocked) → /user-settings/tokens → generate `ovsxat_…`.
  - Local: stored as the Windows User env var **`OVSX_PAT`** (so `ovsx publish`
    auto-authenticates).
  - CI: repo secret **`OVSX_PAT`**.

Release:
1. Bump `version` in `package.json` + CHANGELOG, commit.
2. Local: `cd packages/vscode-extension && npm run publish:ovsx`
   (= `ovsx publish --no-dependencies`; first time also
   `npx ovsx create-namespace chainlesschain`).
3. CI: `git tag ide-vscode-v0.2.2 && git push <remote> ide-vscode-v0.2.2` →
   `ide-extensions.yml` publishes to Open VSX (and to the official Marketplace
   too **iff** a `VSCE_PAT` secret is set — optional, skipped otherwise).
4. Verify: `curl -s https://open-vsx.org/api/chainlesschain/chainlesschain-ide`
   returns the version; page `https://open-vsx.org/extension/chainlesschain/chainlesschain-ide`.

### VS Code — official Marketplace (optional, blocked)
Needs a `VSCE_PAT` from an Azure DevOps org. Publisher `chainlesschain` exists,
but creating the DevOps org requires an Azure subscription → not done. If a
subscription is ever added: create the org → PAT (All accessible organizations +
Marketplace: Manage) → secret `VSCE_PAT`; the same tag then also publishes there.

### JetBrains
1. One-time: get a Marketplace **permanent token** → secret
   `JETBRAINS_PUBLISH_TOKEN`. For signed releases also set
   `JETBRAINS_CERTIFICATE_CHAIN` / `JETBRAINS_PRIVATE_KEY` /
   `JETBRAINS_PRIVATE_KEY_PASSWORD` (see the IntelliJ Platform plugin-signing
   docs).
2. Bump `version` in `build.gradle.kts` + `plugin.xml`, update CHANGELOG, commit.
3. Tag and push: `git tag ide-jetbrains-v0.1.0 && git push <remote> ide-jetbrains-v0.1.0`.
4. CI runs `./gradlew buildPlugin` then `publishPlugin`.

## Verified locally (no marketplace needed)

- **VS Code packaging**: `npx @vscode/vsce package --no-dependencies` produces a
  valid `.vsix` (≈13 KB, 11 files: manifest + LICENSE + CHANGELOG + README +
  5 src). No `node_modules`/tests (`.vscodeignore`).
- **JetBrains protocol core**: compiled with `javac --release 8` and driven by
  the real CLI MCP client (cross-language interop probe, see the plugin README).
- The IntelliJ **glue** layer + the JetBrains marketplace build require the
  IntelliJ Platform SDK, which the Gradle plugin downloads on a CI runner — it is
  not built on the SDK-less dev box.

## Notes / gotchas

- The workflow never creates a GitHub Release (avoids the immutable-release /
  tag-burn traps in `hidden-risk-traps.md`); it only uploads run artifacts +
  pushes to the marketplaces.
- No `continue-on-error` on build/publish steps — a failed package or publish
  fails the job loudly.
- Publish steps fail fast with a clear error if the required secret is missing,
  so a tag pushed without secrets configured does not silently "succeed".
- `gradle-wrapper.jar` (8.7) is vendored (same as `android-app/`); CI uses the
  wrapper, not a system Gradle.
